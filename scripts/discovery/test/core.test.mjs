import test from 'node:test';
import assert from 'node:assert/strict';
import { periodFor, qualifies, dedupe, matchWork, rankEvidence, combinePeriod, publicScreenshot, safeUrl } from '../core.mjs';
import { Metadata } from '../metadata.mjs';
import { isAllowedFile } from '../../../cloudflare/worker.mjs';
const period = periodFor('2026-11-01', '2026-11-01T09:17:00+08:00');
const record = (changes = {}) => ({ platform: 'bilibili', id: 'BV1abcdef', url: 'https://www.bilibili.com/video/BV1abcdef', title: '《海猫鸣泣之时》游戏 CG', publishedAt: '2026-10-20T00:00:00Z', collectedAt: '2026-11-01T01:17:00Z', likes: 3000, ...changes });
const works = { v1: { id: 'v1', title: '海猫鸣泣之时', aliases: ['Umineko no Naku Koro ni'] }, v2: { id: 'v2', title: '海猫鸣泣之时散' }, v3: { id: 'v3', title: 'AIR' }, v4: { id: 'v4', title: '白色相簿2' } };
test('15-day China calendar periods remain anchored across months and delayed runs', () => {
  assert.equal(period.id, '2026-11-01');
  assert.equal(period.start, '2026-10-16T16:00:00.000Z');
  assert.equal(period.end, '2026-10-31T16:00:00.000Z');
  assert.equal(periodFor('2026-11-01', '2026-11-15T23:59:00+08:00').id, '2026-11-01');
  assert.equal(periodFor('2026-11-01', '2026-12-02T10:00:00+08:00').id, '2026-12-01');
  assert.equal(periodFor('2026-11-10', '2026-11-01T10:00:00+08:00'), null);
});
test('3000 likes and inclusive start/exclusive end, invalid dates/counts rejected', () => {
  assert.ok(qualifies(record(), period));
  assert.ok(!qualifies(record({ likes: 2999 }), period));
  assert.ok(qualifies(record({ publishedAt: period.start }), period));
  assert.ok(!qualifies(record({ publishedAt: period.end }), period));
  assert.ok(!qualifies(record({ likes: '3000' }), period));
  assert.ok(!qualifies(record({ publishedAt: 'not a date' }), period));
  assert.ok(!qualifies(record({ publishedAt: '2026-10-20T00:00:00Z', collectedAt: '2026-10-19T00:00:00Z' }), period));
});
test('deduplicate post snapshots and never combine platforms', () => {
  const records = [record(), record({ likes: 4000, collectedAt: '2026-11-01T02:17:00Z' }), record({ platform: 'douyin' })];
  assert.equal(dedupe(records).length, 2);
  assert.equal(dedupe(records)[0].likes, 4000);
  assert.equal(dedupe(records.reverse()).find((r) => r.platform === 'bilibili').likes, 4000);
});
test('explicit title matching, sequel specificity, anime and multi-work ambiguity', () => {
  assert.equal(matchWork(record(), works).workId, 'v1');
  assert.equal(matchWork(record({ title: '海猫鸣泣之时散 游戏CG' }), works).workId, 'v2');
  assert.equal(matchWork(record({ title: '海猫鸣泣之时 动画MAD' }), works).status, 'pending');
  assert.equal(matchWork(record({ title: '海猫鸣泣之时和白色相簿2 游戏CG合集' }), works).status, 'pending');
  assert.equal(matchWork(record({ title: 'chair galgame' }), works).status, 'pending');
  assert.equal(matchWork(record({ title: 'AIR galgame' }), works).workId, 'v3');
  assert.equal(matchWork(record({ title: '海猫鸣泣之时' }), works).status, 'pending');
  const duplicate = { ...works, v5: { id: 'v5', title: '海猫鸣泣之时' } };
  assert.equal(matchWork(record(), duplicate).status, 'pending');
});
test('manual mapping requires explicit game confirmation and supports exclusion', () => {
  const key = 'bilibili:BV1abcdef';
  assert.equal(matchWork(record({ title: '只有画面' }), works, { evidence: { [key]: { workId: 'v4' } } }).status, 'pending');
  assert.equal(matchWork(record({ title: '只有画面' }), works, { evidence: { [key]: { workId: 'v4', confirmedGame: true } } }).workId, 'v4');
  assert.equal(matchWork(record(), works, { evidence: { [key]: { exclude: true } } }).status, 'excluded');
});
test('a game named in a fan animation or crossover is not proof of the original footage', () => {
  const games = { v19073: { id: 'v19073', title: '千恋万花' } };
  assert.equal(matchWork(record({ title: '鸣潮玩家自己的Galgame', description: '千恋万花x鸣潮的op还在画', tags: ['GMV', '手机游戏'] }), games).status, 'pending');
  assert.equal(matchWork(record({ title: '千恋万花 CG游戏片段' }), games).workId, 'v19073');
});
test('rank by highest single-post likes then unique evidence count', () => {
  const a = record({ workId: 'v1', likes: 5000 });
  const b = record({ id: 'BV2abcdef', workId: 'v2', likes: 5000 });
  const c = record({ id: 'BV3abcdef', workId: 'v2', likes: 3000 });
  const ranks = rankEvidence([a, a, b, c]);
  assert.deepEqual(ranks.map((r) => r.workId), ['v2', 'v1']);
  assert.equal(ranks[0].maxLikes, 5000);
  assert.equal(ranks[1].count, 1);
});
test('partial failure retains prior platform window while successful empty replaces it', () => {
  const prior = { platforms: { douyin: { periodId: '2026-10-17', ranking: [{ workId: 'v1' }], lastSuccessAt: '2026-10-17T01:17:00Z' }, bilibili: { ranking: [{ workId: 'v2' }] } } };
  const current = combinePeriod(period, { douyin: { status: 'failed', error: '登录失效' }, bilibili: { status: 'success', records: [], collectedAt: '2026-11-01T01:17:00Z' } }, prior);
  assert.equal(current.platforms.douyin.periodId, '2026-10-17');
  assert.equal(current.platforms.douyin.ranking.length, 1);
  assert.equal(current.platforms.douyin.status, 'failed');
  assert.equal(current.platforms.bilibili.status, 'success');
  assert.equal(current.platforms.bilibili.ranking.length, 0);
});
test('unrated/explicit images never published; unknown spoiler state is folded', () => {
  const image = { id: 'sf1', url: 'https://t.vndb.org/sf/1.jpg', sexual: 0, violence: 0 };
  assert.equal(publicScreenshot(image).spoiler, true);
  assert.equal(publicScreenshot(image, { spoiler: false }).spoiler, false);
  assert.equal(publicScreenshot({ ...image, sexual: null }), null);
  assert.equal(publicScreenshot({ ...image, sexual: 0.2 }), null);
  assert.equal(publicScreenshot({ ...image, violence: 1 }), null);
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('https://name:password@example.com/'), null);
});
test('VNDB pagination retrieves all pages without quiz thresholds', async () => {
  const metadata = new Metadata({ works: {}, staff: {}, producers: {} });
  const calls = [];
  metadata.query = async (endpoint, filters, fields, page) => { calls.push({ filters, page }); return { results: [{ id: `v${page}` }], more: page < 3 }; };
  const rows = await metadata.all('vn', ['developer', '=', ['id', '=', 'p1']], 'title');
  assert.deepEqual(rows.map((r) => r.id), ['v1', 'v2', 'v3']);
  assert.ok(calls.every((c) => !JSON.stringify(c.filters).includes('rating')));
});
test('summary refresh does not destroy detailed metadata or drop low-vote sequels', () => {
  const catalog = { works: {}, staff: {}, producers: {} };
  const metadata = new Metadata(catalog);
  metadata.work({ id: 'v1', title: 'low-vote sequel', description: 'intro [spoiler]ending[/spoiler]', staff: [], screenshots: [] }, true);
  metadata.work({ id: 'v1', title: 'low-vote sequel' });
  assert.equal(catalog.works.v1.detailComplete, true);
  assert.equal(catalog.works.v1.description, 'intro （剧情内容已隐藏）');
});
test('edge route whitelist accepts new documents and rejects arbitrary files', () => {
  for (const route of ['quiz/index.html', 'works/v1/index.html', 'staff/s1/index.html', 'producers/p1/index.html', 'periods/2026-11-01/index.html', 'data/discovery.json']) assert.ok(isAllowedFile(route), route);
  for (const route of ['.env', '../secret', 'works/v1/secret.json', 'api/other', 'data/raw/cookie.json', 'https://example.com/']) assert.ok(!isAllowedFile(route), route);
});
