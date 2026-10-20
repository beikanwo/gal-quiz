// 从 VNDB API 抓作品和发行版信息，输出到 data/raw/。
//
// 用法：
//   node scripts/fetch-vndb.mjs              全量抓取（支持断点续抓，直接重跑即可）
//   node scripts/fetch-vndb.mjs --limit 100  只抓前 100 部试跑
//   node scripts/fetch-vndb.mjs --out data/raw-trial --limit 100
//   node scripts/fetch-vndb.mjs --fresh      清掉已有进度重新抓
//
// 输出：<out>/vns/page-0001.json ...，每页 100 部作品，附带这些作品的发行版汇总
//       （allAges、voiced）。每写完一页就算存档，中断后重跑会从下一页继续。

import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.vndb.org/kana';

// 抓取门槛（初始值，之后可调）
const MIN_VOTES = 50;
const MIN_RATING = 65;

const VN_FIELDS = [
  'id', 'title', 'alttitle',
  'titles{lang,title,official,main}',
  'released', 'length', 'length_minutes',
  'rating', 'votecount', 'languages',
  'image{url,sexual}',
  'tags{id,rating,spoiler,lie}',
  'developers{name}',
  // 作品关系：用来识别续作 / FD / 外传，以及同一作品的不同版本
  'relations{relation,relation_official,released,title}',
].join(',');

const RELEASE_FIELDS = 'id,minage,voiced,vns{id}';

// 限速：每 5 分钟 200 次 → 平均 1.5 秒一次，留点余量
const MIN_INTERVAL_MS = 1600;
const MAX_RETRIES = 6;

// ---------- 参数 ----------

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const LIMIT = arg('--limit') ? Number(arg('--limit')) : Infinity;
const OUT = path.resolve(arg('--out', 'data/raw'));
const FRESH = Boolean(arg('--fresh', false));
const PAGE_DIR = path.join(OUT, 'vns');

// ---------- 请求 ----------

let lastRequestAt = 0;
let requestCount = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(endpoint, body) {
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    requestCount++;

    let res;
    try {
      res = await fetch(`${API}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      console.warn(`  网络错误（${err.message}），${attempt * 5} 秒后重试`);
      await sleep(attempt * 5000);
      continue;
    }

    if (res.ok) return res.json();

    const text = await res.text();
    // 429 = 超限速，5xx = 服务器问题，都等一会儿再试
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const backoff = res.status === 429 ? 60_000 : attempt * 5000;
      console.warn(`  HTTP ${res.status}，${backoff / 1000} 秒后重试：${text.slice(0, 200)}`);
      await sleep(backoff);
      continue;
    }
    throw new Error(`VNDB ${endpoint} 返回 HTTP ${res.status}：${text.slice(0, 500)}`);
  }
}

// ---------- 抓取 ----------

const vnFilter = (afterId) => {
  const f = [
    'and',
    ['votecount', '>=', MIN_VOTES],
    ['rating', '>=', MIN_RATING],
    ['devstatus', '=', 0],
  ];
  if (afterId) f.push(['id', '>', afterId]);
  return f;
};

// 一页作品（按 id 升序，用"id > 上一页最后一个"做游标，比页码稳定）
async function fetchVnPage(afterId, results) {
  return post('vn', {
    filters: vnFilter(afterId),
    fields: VN_FIELDS,
    sort: 'id',
    results,
  });
}

// 这批作品的所有官方、非补丁发行版
async function fetchReleases(vnIds) {
  const filters = [
    'and',
    ['official', '=', 1],
    ['patch', '!=', 1],
    ['vn', '=', ['or', ...vnIds.map((id) => ['id', '=', id])]],
  ];
  const all = [];
  for (let page = 1; ; page++) {
    const data = await post('release', { filters, fields: RELEASE_FIELDS, sort: 'id', results: 100, page });
    all.push(...data.results);
    if (!data.more) break;
  }
  return all;
}

// 按作品汇总发行版：
//   allAges   = 存在 minage < 18 的官方发行版
//   voiced    = 官方发行版里最高的语音档位（1 无语音，2 仅 H 场景，3 部分，4 全语音；null 未知）
//   releases  = 参与统计的发行版数量
function summarizeReleases(vnIds, releases) {
  const out = Object.fromEntries(vnIds.map((id) => [id, { allAges: false, voiced: null, releases: 0 }]));
  for (const r of releases) {
    for (const { id } of r.vns) {
      const s = out[id];
      if (!s) continue;
      s.releases++;
      if (r.minage != null && r.minage < 18) s.allAges = true;
      if (r.voiced != null && (s.voiced == null || r.voiced > s.voiced)) s.voiced = r.voiced;
    }
  }
  return out;
}

// ---------- 断点 ----------

async function loadProgress() {
  await mkdir(PAGE_DIR, { recursive: true });
  const files = (await readdir(PAGE_DIR)).filter((f) => /^page-\d+\.json$/.test(f)).sort();
  let count = 0;
  let lastId = null;
  for (const f of files) {
    const page = JSON.parse(await readFile(path.join(PAGE_DIR, f), 'utf8'));
    count += page.vns.length;
    if (page.vns.length) lastId = page.vns.at(-1).id;
  }
  return { pages: files.length, count, lastId };
}

// ---------- 主流程 ----------

async function main() {
  if (FRESH) await rm(OUT, { recursive: true, force: true });

  let { pages, count, lastId } = await loadProgress();
  if (pages) console.log(`已有 ${pages} 页、${count} 部，从 ${lastId} 之后继续`);

  const total = (await post('vn', { filters: vnFilter(null), count: true, results: 0 })).count;
  console.log(`符合门槛的作品共 ${total} 部（投票 ≥ ${MIN_VOTES}，评分 ≥ ${MIN_RATING}，已完成）`);

  while (count < LIMIT) {
    const want = Math.min(100, LIMIT - count);
    const data = await fetchVnPage(lastId, want);
    if (!data.results.length) break;

    const vns = data.results;
    const ids = vns.map((v) => v.id);
    const releases = await fetchReleases(ids);
    const summary = summarizeReleases(ids, releases);
    for (const v of vns) Object.assign(v, summary[v.id]);

    pages++;
    count += vns.length;
    lastId = ids.at(-1);
    const file = path.join(PAGE_DIR, `page-${String(pages).padStart(4, '0')}.json`);
    await writeFile(file, JSON.stringify({ fetchedAt: new Date().toISOString(), vns }));
    console.log(`第 ${pages} 页：${ids[0]}–${lastId}，${releases.length} 个发行版，累计 ${count}/${total}（请求 ${requestCount} 次）`);

    if (!data.more) break;
  }

  await writeFile(
    path.join(OUT, 'meta.json'),
    JSON.stringify({ finishedAt: new Date().toISOString(), total, fetched: count, minVotes: MIN_VOTES, minRating: MIN_RATING }, null, 2),
  );
  console.log(`完成：${count} 部，输出在 ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
