// 只采集公开的作品名、评分、人数和明确的站外 ID；不下载封面、评论或资源链接。
// node scripts/fetch-chinese-reception.mjs；快照缓存于被 Git 忽略的 data/raw/reception。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = 'data/raw/reception';
const REFRESH = process.argv.includes('--refresh');
const headers = { 'User-Agent': 'beikanwo/gal-quiz (https://github.com/beikanwo/gal-quiz)', 'Content-Type': 'application/json' };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(ROOT, { recursive: true });
const vns = JSON.parse(await readFile('site/data/vns.json', 'utf8'));
const idMap = new Map();
for (const v of vns) for (const id of [v.id, ...(v.altIds ?? [])]) idMap.set(id, v.id);
const normal = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\p{S}\s]/gu, '');
const names = new Map();
for (const v of vns) for (const name of [v.title, v.orig]) {
  const key = normal(name);
  if (!names.has(key)) names.set(key, new Set());
  names.get(key).add(v.id);
}
async function cached(name, url, body) {
  const file = path.join(ROOT, name + '.json');
  if (!REFRESH) { try { return JSON.parse(await readFile(file, 'utf8')); } catch {} }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      await writeFile(file, JSON.stringify(data));
      return data;
    } catch (e) {
      if (attempt === 2) throw new Error(`${name}: ${e.message}`);
      await pause(1500 * (attempt + 1));
    }
  }
}
const entries = {};
const unmatched = [];
const add = (id, site, value) => {
  entries[id] ??= {};
  const old = entries[id][site];
  // 不同版本合并时只取人数最多的条目，不把同一平台的人数相加。
  if (!old || value.votes > old.votes) entries[id][site] = value;
};
let bgmFetched = 0;
for (let offset = 0; ;) {
  const d = await cached(`bgm-${offset}`, `https://api.bgm.tv/v0/search/subjects?limit=100&offset=${offset}`, {
    keyword: '', sort: 'rank', filter: { type: [4], tag: ['Galgame'], rank: ['>0'], rating_count: ['>=100'] },
  });
  if (!Array.isArray(d.data)) throw new Error('Bangumi 返回格式不符');
  for (const x of d.data) {
    bgmFetched++;
    const ids = new Set([...(names.get(normal(x.name)) ?? []), ...(names.get(normal(x.name_cn)) ?? [])]);
    if (ids.size !== 1) { unmatched.push({ source: 'bangumi', id: x.id, title: x.name_cn || x.name, reason: ids.size ? 'ambiguous' : 'no exact title' }); continue; }
    const id = [...ids][0], vn = vns.find((v) => v.id === id);
    const year = Number(x.date?.slice(0, 4));
    if (year && vn.year && Math.abs(year - vn.year) > 1) { unmatched.push({ source: 'bangumi', id: x.id, title: x.name_cn || x.name, reason: 'release year differs' }); continue; }
    if (x.type !== 4 || !(x.rating?.total >= 100) || !Number.isFinite(x.rating.score)) continue;
    add(id, 'bangumi', { id: x.id, score: x.rating.score, votes: x.rating.total, url: `https://bgm.tv/subject/${x.id}`, via: 'bangumi-api', match: 'exact-title-and-year' });
  }
  console.log(`Bangumi: ${bgmFetched}/${d.total}`);
  if (offset + d.data.length >= d.total || !d.data.length) break;
  offset += d.data.length; // 接口可能把 limit=100 限为 20，以实际返回条数推进。
  await pause(700);
}
const works = [];
for (let page = 1; ; page++) {
  const d = await cached(`kun-list-${page}`, `https://www.kungal.com/api/v1/works?limit=100&page=${page}&min_rating_count=5&include_nsfw=true&include_resourceless=true`);
  if (!Array.isArray(d.items)) throw new Error('KUN 返回格式不符');
  works.push(...d.items);
  if (works.length >= d.total || !d.items.length) break;
  await pause(700);
}
let done = 0;
async function collect() {
  while (works.length) {
    const x = works.shift();
    try {
      const d = await cached(`kun-work-${x.id}`, `https://www.kungal.com/api/v1/works/${x.id}?include_nsfw=true`);
      const ids = new Set((d.external_refs ?? []).filter((r) => r.site === 'vndb' && /^v\d+$/.test(r.external_id)).map((r) => idMap.get(r.external_id)).filter(Boolean));
      if (ids.size !== 1) { unmatched.push({ source: 'kungal', id: d.id, title: d.display_name, reason: ids.size ? 'ambiguous identity' : 'outside catalog' }); continue; }
      const id = [...ids][0];
      const bgm = (d.external_ratings ?? []).find((r) => r.site === 'bangumi');
      const bgmId = (d.external_refs ?? []).find((r) => r.site === 'bangumi')?.external_id;
      if (bgmId && bgm?.vote_count >= 100 && Number.isFinite(bgm.rating_value)) {
        // KUN 对 Bangumi 的镜像分只作同一来源，绝不当作第二份独立投票。
        add(id, 'bangumi', { id: Number(bgmId), score: bgm.rating_value, votes: bgm.vote_count, url: `https://bgm.tv/subject/${bgmId}`, via: `https://www.kungal.com/galgame/${d.id}`, match: 'explicit-vndb-reference' });
      }
      if (d.rating_count >= 20 && Number.isFinite(d.rating_score)) add(id, 'kungal', { id: d.id, score: d.rating_score, votes: d.rating_count, url: `https://www.kungal.com/galgame/${d.id}`, match: 'explicit-vndb-reference' });
    } catch (e) { unmatched.push({ source: 'kungal', id: x.id, reason: e.message }); }
    finally { done++; if (done % 25 === 0) console.log(`KUN: ${done}`); await pause(700); }
  }
}
await Promise.all([collect(), collect()]);
const output = {
  updatedAt: new Date().toISOString(),
  method: 'Exact titles with release-year check, or explicit VNDB identity; no fuzzy matches; one rating per platform per merged VN.',
  sources: [
    { name: 'Bangumi', url: 'https://bgm.tv/game/browser?sort=rank', use: 'Main numeric signal; >=100 ratings. API plus attributed Bangumi snapshots exposed by KUN.' },
    { name: 'KUN', url: 'https://www.kungal.com/doc/galgame-rating-guide', use: 'Native Bayesian rating, >=20 ratings; separate from mirrored Bangumi data.' },
    { name: 'TouchGal', url: 'https://www.touchgal.ink/', use: 'Qualitative audit only: public index shows ratings/views, detailed pages challenge automated access; vote counts unverified.' },
    { name: 'galgame吧', url: 'https://tieba.baidu.com/p/10337946757?fr=good', use: 'Qualitative annual-poll context only; full result blocked (403), no numeric bonus assigned.' },
  ],
  stats: { bgmFetched, kunFetched: done, mapped: Object.keys(entries).length, bangumi: Object.values(entries).filter((x) => x.bangumi).length, kungal: Object.values(entries).filter((x) => x.kungal).length },
  entries,
};
await writeFile('config/chinese-reception.json', JSON.stringify(output, null, 2) + '\n');
await writeFile('data/chinese-reception-unmatched.json', JSON.stringify(unmatched, null, 2) + '\n');
console.log(JSON.stringify(output.stats));
