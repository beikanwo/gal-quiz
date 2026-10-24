// 把 data/raw/ 里的原始数据清洗成前端用的 JSON。
//
// 用法：node scripts/build-data.mjs
//
// 输入：data/raw/vns/*.json（fetch-vndb）、config/questions.json、config/tag-ids.json（resolve-tags）
// 输出：
//   site/data/vns.json   片库，每部只保留问卷和雷点用到的标签，子标签已经合并好
//   site/data/quiz.json  问卷配置，标签名换成了 ID，前端直接读

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const RAW_PAGES = 'data/raw/vns';
const CONFIG = 'config/questions.json';
const TAG_IDS = 'config/tag-ids.json';
const OUT_DIR = 'site/data';

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// ---------- 标签 ----------

// 问卷里每个标签名的用途：taste = 口味打分，strict = 硬条件 / 雷点
function tagRoles(config) {
  const taste = new Set();
  const strict = new Set();
  for (const q of config.questions) {
    for (const o of q.options) {
      for (const name of Object.keys(o.tags ?? {})) taste.add(name);
      for (const name of [...(o.filter?.excludeTags ?? []), ...(o.filter?.requireTags ?? [])]) strict.add(name);
    }
  }
  for (const o of config.dealbreakers.options) for (const name of o.tags ?? []) strict.add(name);
  return { taste, strict };
}

// 合并父标签和子标签的分数，返回 [分数, 剧透等级] 或 null。
// 取分数最高的那个来源；分数相同时取剧透等级低的。
function effectiveTag(vnTags, resolved, { childIds, childFactor }) {
  let best = null;
  const consider = (id, factor) => {
    const t = vnTags.get(id);
    if (!t) return;
    const score = t.rating * factor;
    if (score <= 0) return;
    if (!best || score > best[0] || (score === best[0] && t.spoiler < best[1])) best = [score, t.spoiler];
  };
  consider(resolved.id, 1);
  for (const id of childIds) consider(id, childFactor);
  return best && [round(best[0], 2), best[1]];
}

// ---------- 作品 ----------

const ZH = ['zh-Hans', 'zh-Hant'];

// 封面露骨程度上限。国内有法律风险，只放完全安全的封面
const MAX_COVER_SEXUAL = 0;

// VNDB 关系是"对方相对于我"：preq = 对方是我的前作，par = 对方是我的本篇，orig = 对方是我的原作（我是 FD）
const NEEDS_PRIOR = new Set(['preq', 'par', 'orig']);

// 只认官方关系（同人作品常把名作标成自己的"前作"），而且对方要比本作早发售
// （VNDB 的"前作"指故事时间线，后出的前传也算，比如很多名作都有后来补的前传）。
const isDate = (s) => typeof s === 'string' && /^\d{4}/.test(s);
function needsPrior(v) {
  return (v.relations ?? []).some(
    (r) => NEEDS_PRIOR.has(r.relation) && r.relation_official && isDate(r.released) && isDate(v.released) && r.released < v.released,
  );
}

// 同一作品的不同版本（VNDB 关系 alt，比如重制版、移植版）合并成一部：
// 保留投票最多的那个条目，"有中文 / 有全年龄版 / 语音"取所有版本里最好的。
function mergeAltVersions(raw, built) {
  const byId = new Map(built.map((b) => [b.id, b]));
  const parent = new Map(built.map((b) => [b.id, b.id]));
  const find = (id) => (parent.get(id) === id ? id : (parent.set(id, find(parent.get(id))), parent.get(id)));
  for (const v of raw) {
    for (const r of v.relations ?? []) {
      if (r.relation === 'alt' && byId.has(r.id) && byId.has(v.id)) parent.set(find(v.id), find(r.id));
    }
  }
  const groups = new Map();
  for (const b of built) {
    const root = find(b.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(b);
  }
  const out = [];
  let merged = 0;
  for (const group of groups.values()) {
    group.sort((a, b) => b.votes - a.votes);
    const [main, ...rest] = group;
    if (rest.length) {
      merged += rest.length;
      main.zh = group.some((b) => b.zh);
      main.allAges = group.some((b) => b.allAges);
      const voiced = group.map((b) => b.voiced).filter((x) => x != null);
      main.voiced = voiced.length ? Math.max(...voiced) : null;
      main.altIds = rest.map((b) => b.id);
    }
    out.push(main);
  }
  return { vns: out, merged };
}

function pickTitles(v) {
  const main = v.titles.find((t) => t.main)?.title ?? v.alttitle ?? v.title;
  let zh = null;
  for (const lang of ZH) {
    const cands = v.titles.filter((t) => t.lang === lang);
    zh = (cands.find((t) => t.official) ?? cands[0])?.title ?? null;
    if (zh) break;
  }
  return { title: zh ?? main, orig: main, hasZhTitle: Boolean(zh) };
}

function buildVn(v, tagSpecs) {
  const vnTags = new Map(v.tags.filter((t) => !t.lie).map((t) => [t.id, t]));
  const tags = {};
  for (const spec of tagSpecs) {
    const eff = effectiveTag(vnTags, spec.resolved, spec);
    if (eff) tags[spec.resolved.id] = eff;
  }
  const { title, orig, hasZhTitle } = pickTitles(v);
  return {
    out: {
      id: v.id,
      // 续作 / 外传 / FD：要先玩过别的作品，不直接推荐
      sequel: needsPrior(v),
      title,
      orig,
      length: v.length ?? null,
      mins: v.length_minutes ?? null,
      year: v.released && /^\d{4}/.test(v.released) ? Number(v.released.slice(0, 4)) : null,
      rating: round(v.rating, 1),
      votes: v.votecount,
      zh: v.languages.some((l) => ZH.includes(l)),
      allAges: v.allAges,
      voiced: v.voiced,
      tags,
      dev: v.developers.map((d) => d.name).join(' / '),
      // 只保留露骨程度为 0 的封面（VNDB 投票平均：0 安全，1 擦边，2 露骨），其余连地址都不写进数据
      img: v.image && v.image.sexual <= MAX_COVER_SEXUAL ? v.image.url : null,
    },
    hasZhTitle,
  };
}

// ---------- 问卷配置 ----------

function buildQuiz(config, ids) {
  const id = (name) => ids[name].id;
  const mapTags = (obj) => Object.fromEntries(Object.entries(obj).map(([n, w]) => [id(n), w]));
  const questions = config.questions.map(({ _说明, ...q }) => ({
    ...q,
    options: q.options.map((o) => {
      const out = { ...o };
      if (o.tags) out.tags = mapTags(o.tags);
      if (o.filter?.excludeTags || o.filter?.requireTags) {
        out.filter = { ...o.filter };
        if (o.filter.excludeTags) out.filter.excludeTags = o.filter.excludeTags.map(id);
        if (o.filter.requireTags) out.filter.requireTags = o.filter.requireTags.map(id);
      }
      return out;
    }),
  }));
  const { _说明, ...db } = config.dealbreakers;
  const dealbreakers = {
    ...db,
    options: db.options.map((o) => {
      const out = { ...o };
      if (o.tags) out.tags = o.tags.map(id);
      if (o.softPenaltyTags) out.softPenaltyTags = o.softPenaltyTags.map(id);
      return out;
    }),
  };
  const noNotes = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_')));
  const scoring = noNotes(config.scoring);
  const playerTypes = noNotes(config.playerTypes);

  // 正权重的口味标签都要有中文文案，否则推荐理由会漏
  const tagText = noNotes(config.tagText);
  for (const q of config.questions) {
    for (const o of q.options) {
      for (const [name, w] of Object.entries(o.tags ?? {})) {
        if (w > 0 && !tagText[name]) throw new Error(`标签 "${name}" 缺少中文文案（questions.json → tagText）`);
      }
    }
  }
  // 标签 ID → { name: VNDB 英文名, label: 中文短标签, phrase: 推荐理由短语 }
  const tags = Object.fromEntries(
    Object.entries(ids).map(([name, r]) => [r.id, { name: r.name, label: tagText[name]?.[0], phrase: tagText[name]?.[1] }]),
  );
  return { questions, dealbreakers, scoring, playerTypes, tags };
}

// ---------- 主流程 ----------

async function main() {
  const config = await readJson(CONFIG);
  const ids = await readJson(TAG_IDS);
  const childFactor = config.scoring.childTagFactor;

  const { taste, strict } = tagRoles(config);
  for (const name of [...taste, ...strict]) {
    if (!ids[name]) throw new Error(`标签 "${name}" 没有解析结果，先跑 node scripts/resolve-tags.mjs`);
  }
  // 同一个标签既用于口味又用于雷点时，两种合并规则结果会不同，目前不支持
  for (const name of taste) {
    if (strict.has(name) && ids[name].descendants.length) {
      throw new Error(`标签 "${name}" 同时用于口味和雷点，且有子标签，合并规则冲突`);
    }
  }
  const tagSpecs = [
    ...[...strict].map((n) => ({ resolved: ids[n], childIds: ids[n].descendants, childFactor: 1 })),
    ...[...taste].filter((n) => !strict.has(n)).map((n) => ({ resolved: ids[n], childIds: ids[n].descendantsNonEro, childFactor })),
  ];

  const files = (await readdir(RAW_PAGES)).filter((f) => f.endsWith('.json')).sort();
  const raw = [];
  for (const f of files) raw.push(...(await readJson(path.join(RAW_PAGES, f))).vns);

  const seen = new Set();
  const built = [];
  const zhTitleIds = new Set();
  for (const v of raw) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    const { out, hasZhTitle } = buildVn(v, tagSpecs);
    built.push(out);
    if (hasZhTitle) zhTitleIds.add(out.id);
  }
  const { vns, merged } = mergeAltVersions(raw, built);
  // 可选的中文口碑快照通过明确 VNDB ID 对应，未匹配的作品不受影响。
  let reception;
  try { reception = await readJson('config/chinese-reception.json'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const v of vns) {
    const ratings = reception?.entries?.[v.id];
    if (!ratings) continue;
    v.cn = Object.fromEntries(Object.entries(ratings).map(([source, r]) => [source, { id: r.id, score: r.score, votes: r.votes }]));
  }
  vns.sort((a, b) => b.votes - a.votes);
  const zhTitles = vns.filter((v) => zhTitleIds.has(v.id)).length;
  const zhNoTitle = vns.filter((v) => v.zh && !zhTitleIds.has(v.id)).length;

  await mkdir(OUT_DIR, { recursive: true });
  const vnsJson = JSON.stringify(vns);
  const quizJson = JSON.stringify(buildQuiz(config, ids));
  await writeFile(path.join(OUT_DIR, 'vns.json'), vnsJson);
  await writeFile(path.join(OUT_DIR, 'quiz.json'), quizJson);

  // ---------- 报告 ----------
  const n = vns.length;
  const pct = (x) => `${x}（${((100 * x) / n).toFixed(1)}%）`;
  const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB（gzip 后 ${(gzipSync(s).length / 1024).toFixed(0)} KB）`;
  const count = (f) => vns.filter(f).length;
  console.log(`作品总数：${n}（另有 ${merged} 个重制 / 移植版本已合并进原作）`);
  console.log(`有中文口碑数据：${count((v) => Boolean(v.cn))}`);
  console.log(`续作 / 外传 / FD（不直接推荐）：${pct(count((v) => v.sequel))}`);
  console.log(`有中文（官中或汉化）：${pct(count((v) => v.zh))}`);
  console.log(`有中文标题：${pct(zhTitles)}；能玩中文但 VNDB 没有中文标题：${zhNoTitle}`);
  console.log(`有全年龄版：${pct(count((v) => v.allAges))}`);
  console.log(`中文 + 全年龄：${pct(count((v) => v.zh && v.allAges))}`);
  console.log(`没有时长数据：${pct(count((v) => v.length == null && v.mins == null))}`);
  console.log(`无角色语音（voiced=1）：${pct(count((v) => v.voiced === 1))}，语音未知：${pct(count((v) => v.voiced == null))}`);
  console.log(`平均每部保留标签：${(vns.reduce((s, v) => s + Object.keys(v.tags).length, 0) / n).toFixed(1)}`);
  console.log(`vns.json：${kb(vnsJson)}`);
  console.log(`quiz.json：${kb(quizJson)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
