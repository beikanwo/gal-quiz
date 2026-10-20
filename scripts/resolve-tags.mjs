// 把 config/questions.json 里的标签英文名解析成 VNDB 标签 ID。
//
// 用法：
//   node scripts/resolve-tags.mjs            用已下载的标签数据（没有就自动下载）
//   node scripts/resolve-tags.mjs --refresh  重新下载 VNDB 标签数据
//
// 数据来源：VNDB 官方每日标签导出 https://dl.vndb.org/dump/vndb-tags-latest.json.gz
// （和 /tag 接口同源，但多了父子关系。VNDB 的作品 tags 字段只含直接打上的标签，
//  不含子标签，所以要知道每个标签有哪些子标签，打分时一并算上。）
//
// 输出：
//   config/tag-ids.json   名称 → { id, name, match, descendants }，只含成功解析的
//   data/tag-report.md    给人看的核对表：描述、作品数、子标签、片库覆盖、未解析项的候选

import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

const DUMP_URL = 'https://dl.vndb.org/dump/vndb-tags-latest.json.gz';
const DUMP_FILE = 'data/raw/vndb-tags.json.gz';
const CONFIG = 'config/questions.json';
const OUT_IDS = 'config/tag-ids.json';
const OUT_REPORT = 'data/tag-report.md';
const RAW_PAGES = 'data/raw/vns';

const REFRESH = process.argv.includes('--refresh');

const exists = (p) => access(p).then(() => true, () => false);

async function loadDump() {
  if (REFRESH || !(await exists(DUMP_FILE))) {
    console.log(`下载 ${DUMP_URL}`);
    const res = await fetch(DUMP_URL);
    if (!res.ok) throw new Error(`下载标签数据失败：HTTP ${res.status}`);
    await mkdir(path.dirname(DUMP_FILE), { recursive: true });
    await writeFile(DUMP_FILE, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(gunzipSync(await readFile(DUMP_FILE)));
}

// 收集配置里用到的所有标签名，以及每个标签被哪些题/选项用到
function collectTagNames(config) {
  const uses = new Map();
  const add = (name, where) => {
    if (!uses.has(name)) uses.set(name, []);
    uses.get(name).push(where);
  };
  for (const q of config.questions) {
    for (const o of q.options) {
      for (const [name, w] of Object.entries(o.tags ?? {})) add(name, `${q.text} → ${o.label}（${w > 0 ? '+' : ''}${w}）`);
      for (const name of o.filter?.excludeTags ?? []) add(name, `${q.text} → ${o.label}（排除）`);
      for (const name of o.filter?.requireTags ?? []) add(name, `${q.text} → ${o.label}（必须有）`);
    }
  }
  for (const o of config.dealbreakers.options) {
    for (const name of o.tags ?? []) add(name, `雷点 → ${o.label}`);
  }
  return uses;
}

const norm = (s) => s.toLowerCase().replace(/[\s\-_]+/g, ' ').trim();

const stripBBCode = (s) =>
  s.replace(/\[url=[^\]]*\]([^[]*)\[\/url\]/g, '$1').replace(/\[\/?[a-z]+[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();

// 片库覆盖：已抓到的作品里，直接带该标签 / 带该标签或其子标签（分数 ≥ 1，非 lie）的数量
async function loadRawVns() {
  if (!(await exists(RAW_PAGES))) return [];
  const files = (await readdir(RAW_PAGES)).filter((f) => f.endsWith('.json'));
  const vns = [];
  for (const f of files) vns.push(...JSON.parse(await readFile(path.join(RAW_PAGES, f), 'utf8')).vns);
  return vns;
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG, 'utf8'));
  const tags = await loadDump();
  const vns = await loadRawVns();

  const byId = new Map(tags.map((t) => [t.id, t]));
  const children = new Map();
  for (const t of tags) for (const p of t.parents) {
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(t.id);
  }
  const descendantsOf = (id) => {
    const out = [];
    const stack = [...(children.get(id) ?? [])];
    while (stack.length) {
      const c = stack.pop();
      out.push(c);
      stack.push(...(children.get(c) ?? []));
    }
    return out;
  };

  const byName = new Map(tags.map((t) => [norm(t.name), t]));
  const byAlias = new Map();
  for (const t of tags) for (const a of t.aliases) byAlias.set(norm(a), t);

  const vnTagSets = vns.map((v) => new Set(v.tags.filter((t) => !t.lie && t.rating >= 1).map((t) => t.id)));
  const coverage = (ids) => vnTagSets.filter((s) => ids.some((id) => s.has(id))).length;

  const uses = collectTagNames(config);
  const resolved = {};
  const rows = [];

  for (const [name, where] of uses) {
    const key = norm(name);
    let tag = byName.get(key);
    let match = tag ? 'exact' : null;
    if (!tag && byAlias.has(key)) {
      tag = byAlias.get(key);
      match = 'alias';
    }

    if (!tag) {
      // 候选：名字或别名包含查询词里任意一个词的标签，按作品数排序
      const words = key.split(' ').filter((w) => w.length > 2);
      const cands = tags
        .filter((t) => [t.name, ...t.aliases].some((n) => words.some((w) => norm(n).includes(w))))
        .sort((a, b) => b.vns - a.vns)
        .slice(0, 8);
      rows.push({ name, where, match: 'missing', cands });
      continue;
    }

    const gid = `g${tag.id}`;
    const desc = descendantsOf(tag.id).map((id) => `g${id}`);
    // 口味打分不算 H 类子标签，单独列出来给 build 用
    const descNonEro = desc.filter((id) => byId.get(Number(id.slice(1))).cat !== 'ero');
    resolved[name] = { id: gid, name: tag.name, match, descendants: desc, descendantsNonEro: descNonEro };
    rows.push({
      name, where, match, tag, gid, desc,
      direct: coverage([gid]),
      withChildren: coverage([gid, ...desc]),
    });
  }

  await writeFile(OUT_IDS, JSON.stringify(resolved, null, 2) + '\n');

  // ---------- 报告 ----------
  const lines = [];
  const ok = rows.filter((r) => r.match === 'exact').length;
  const alias = rows.filter((r) => r.match === 'alias').length;
  const missing = rows.filter((r) => r.match === 'missing').length;
  lines.push('# 标签核对表', '');
  lines.push(`共 ${rows.length} 个标签：名称完全一致 ${ok}，通过别名匹配 ${alias}，查不到 ${missing}。`);
  lines.push(`片库覆盖基于已抓到的 ${vns.length} 部作品，计分数 ≥ 1 的标签。`, '');

  for (const r of rows) {
    lines.push(`## ${r.name}`, '');
    lines.push(`- 用在：${r.where.join('；')}`);
    if (r.match === 'missing') {
      lines.push('- **查不到**。候选：');
      for (const c of r.cands) lines.push(`  - g${c.id} ${c.name}（${c.vns} 部${c.applicable ? '' : '，不能直接打'}）${c.aliases.length ? '，别名：' + c.aliases.join(' / ') : ''}`);
      lines.push('');
      continue;
    }
    const t = r.tag;
    const parents = t.parents.map((p) => byId.get(p)?.name).filter(Boolean).join(' / ') || '无';
    lines.push(`- 结果：${r.gid} **${t.name}**${r.match === 'alias' ? '（通过别名匹配）' : ''}，分类 ${t.cat}，VNDB 上 ${t.vns} 部${t.applicable ? '' : '，**不能直接打，只能靠子标签**'}`);
    if (t.aliases.length) lines.push(`- 别名：${t.aliases.join(' / ')}`);
    lines.push(`- 父标签：${parents}`);
    if (r.desc.length) {
      const names = r.desc.map((id) => byId.get(Number(id.slice(1)))?.name);
      lines.push(`- 子标签（${names.length}）：${names.slice(0, 15).join(' / ')}${names.length > 15 ? ' …' : ''}`);
    }
    lines.push(`- 片库覆盖：直接 ${r.direct} 部，含子标签 ${r.withChildren} 部`);
    lines.push(`- 描述：${stripBBCode(t.description).slice(0, 400)}`, '');
  }

  await mkdir(path.dirname(OUT_REPORT), { recursive: true });
  await writeFile(OUT_REPORT, lines.join('\n'));

  console.log(`完全一致 ${ok}，别名 ${alias}，查不到 ${missing}`);
  for (const r of rows.filter((r) => r.match !== 'exact')) {
    console.log(r.match === 'alias' ? `  [别名] ${r.name} → ${r.tag.name}` : `  [查不到] ${r.name}`);
  }
  console.log(`写入 ${OUT_IDS} 和 ${OUT_REPORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
