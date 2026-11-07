import test from 'node:test';
import assert from 'node:assert/strict';
import { periodFor, scheduledPeriodFor, qualifies, dedupe, matchWork, rankEvidence, combinePeriod, publicScreenshot, safeUrl, canonicalEvidenceUrl } from '../core.mjs';
import { Metadata } from '../metadata.mjs';
import { BilibiliSource } from '../sources.mjs';
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
test('5-day cadence starts with a new period and preserves the historical 15-day window', () => {
  const config={intervalDays:5,cadenceEffectiveDate:'2026-11-06'};
  const index={anchorDate:'2026-11-01',periods:[{...period}]};
  const before=JSON.stringify(index);
  assert.equal(scheduledPeriodFor(index,config,'2026-11-02T09:17:00+08:00'),null);
  assert.equal(scheduledPeriodFor(index,config,'2026-11-05T23:59:59+08:00'),null);
  const next=scheduledPeriodFor(index,config,'2026-11-06T09:17:00+08:00');
  assert.equal(next.id,'2026-11-06');
  assert.equal(next.start,'2026-10-31T16:00:00.000Z');
  assert.equal(next.end,'2026-11-05T16:00:00.000Z');
  assert.ok(qualifies(record({likes:1000,publishedAt:next.start,collectedAt:next.end}),next));
  assert.ok(!qualifies(record({publishedAt:next.end,collectedAt:next.end}),next));
  assert.ok(qualifies(record({likes:500,publishedAt:next.start,collectedAt:next.end}),next,500));
  assert.ok(!qualifies(record({likes:499,publishedAt:next.start,collectedAt:next.end}),next,500));
  assert.equal(scheduledPeriodFor(index,config,'2026-11-08T09:17:00+08:00').id,'2026-11-06');
  assert.equal(scheduledPeriodFor(index,config,'2026-12-03T09:17:00+08:00').id,'2026-12-01');
  assert.equal(JSON.stringify(index),before);
});
test('1000 likes and inclusive start/exclusive end, invalid dates/counts rejected', () => {
  assert.ok(qualifies(record({ likes: 1000 }), period));
  assert.ok(!qualifies(record({ likes: 999 }), period));
  assert.ok(!qualifies(record({ likes: 2999 }), period, 3000));
  assert.ok(qualifies(record({ publishedAt: period.start }), period));
  assert.ok(!qualifies(record({ publishedAt: period.end }), period));
  assert.ok(!qualifies(record({ likes: '3000' }), period));
  assert.ok(!qualifies(record({ publishedAt: 'not a date' }), period));
  assert.ok(!qualifies(record({ publishedAt: '2026-10-20T00:00:00' }), period));
  assert.ok(qualifies(record({ publishedAt: '2026-10-17T00:00:00+08:00' }), period));
  assert.ok(!qualifies(record({ publishedAt: '2026-10-20T00:00:00Z', collectedAt: '2026-10-19T00:00:00Z' }), period));
});
test('Bilibili search verifies detail ID and date before keeping an in-window result', async t => {
  const source = new BilibiliSource();
  source.bootstrapped = true;
  const start = Date.parse(period.start) / 1000;
  const end = Date.parse(period.end) / 1000;
  const detail = (bvid, pubdate) => ({
    detail: { code: 0, data: { bvid, pubdate, stat: { like: 361 } } }, collectedAt: period.end,
  });
  source.details.set('BV1valid', detail('BV1valid', start));
  source.details.set('BV1late', detail('BV1late', end));
  source.details.set('BV1mismatch', detail('BV1different', start));
  t.mock.method(globalThis, 'fetch', async url => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('order'), 'pubdate');
    assert.equal(params.get('pubtime_end_s'), String(end - 1));
    const result = ['BV1mismatch', 'BV1late', 'BV1valid'].map(bvid => ({ bvid, pubdate: start }));
    return Response.json({ code: 0, data: { result } });
  });
  const batch = await source.search('视觉小说', 1, period, { order: 'pubdate' });
  assert.equal(batch.partial, true);
  assert.deepEqual(batch.records.map(r => [r.id, r.publishedAt, r.likes]), [['BV1valid', period.start, 361]]);
  assert.equal(batch.records[0].collectedAt, period.end);
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
  assert.equal(matchWork(record({ title: 'DeepSeek galgame' }), { v83: {id:'v83',title:'ExE',aliases:['E × E']} }).status, 'pending');
  assert.equal(matchWork(record({ title: '运行 game.exe 视觉小说' }), { v83: {id:'v83',title:'ExE'} }).status, 'pending');
  assert.equal(matchWork(record({ title: '《海猫鸣泣之时》系列：故事回顾 galgame' }), works).status, 'pending');
  assert.equal(matchWork(record({ title: '盘点柚子社救场 海猫鸣泣之时 galgame' }), works).status, 'pending');
  assert.equal(matchWork(record({ title: '乐园 galgame' }), {v6540:{id:'v6540',title:'euphoria',aliases:['乐园']}}, {ambiguousAliases:['乐园']}).status, 'pending');
  assert.equal(matchWork(record({ title: '海猫鸣泣之时' }), works).status, 'pending');
  assert.equal(matchWork(record({ title: '海猫鸣泣之时 系列世界观 游戏解说' }), works).status, 'pending');
  const duplicate = { ...works, v5: { id: 'v5', title: '海猫鸣泣之时' } };
  assert.equal(matchWork(record(), duplicate).status, 'pending');
});
test('Douyin image posts retain the canonical note link', () => {
  assert.equal(canonicalEvidenceUrl('douyin', '123456', 'image'), 'https://www.douyin.com/note/123456');
  assert.equal(canonicalEvidenceUrl('douyin', '123456'), 'https://www.douyin.com/video/123456');
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
  assert.equal(matchWork(record({ title: '千恋万花 CG剪辑', tags:['动漫','二创'] }), games).workId, 'v19073');
  assert.equal(matchWork(record({ title: '千恋万花 动画MAD', tags:['galgame'] }), games).status, 'pending');
  assert.equal(matchWork(record({ title: '千恋万花 cosplay' }), games).status, 'pending');
  assert.equal(matchWork(record({ title: '千恋万花', tags: ['游戏', '影视剪辑'] }), games).status, 'pending');
});
test('an explicitly declared full game name cannot be assigned by a shared word', () => {
  const old = { v237: { id: 'v237', title: '誰彼', matchingAliases: ['Twilight'] } };
  const clip = record({ title: '游戏实况', description: '-游戏名：晓之缘 - Twilight Loop -' });
  assert.equal(matchWork(clip, old).status, 'pending');
  const current = { ...old, v64572: { id: 'v64572', title: '晓之缘 - Twilight Loop -' } };
  assert.equal(matchWork(clip, current).workId, 'v64572');
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
test('failed or empty platforms cannot carry an older window into the current issue', () => {
  const prior = { platforms: { douyin: { periodId: '2026-10-17', ranking: [{ workId: 'v1' }], lastSuccessAt: '2026-10-17T01:17:00Z' }, bilibili: { ranking: [{ workId: 'v2' }] } } };
  const current = combinePeriod(period, { douyin: { status: 'failed', error: '登录失效' }, bilibili: { status: 'success', records: [], collectedAt: '2026-11-01T01:17:00Z' } }, prior);
  assert.equal(current.platforms.douyin.periodId, null);
  assert.equal(current.platforms.douyin.ranking.length, 0);
  assert.equal(current.platforms.douyin.status, 'failed');
  assert.equal(current.platforms.bilibili.status, 'success');
  assert.equal(current.platforms.bilibili.ranking.length, 0);
});
test('partial collection uses the platform threshold and stays in its own window', () => {
  const partial = { status: 'partial', collectedAt: '2026-11-01T01:17:00Z', records: [record({workId:'v1'})], coverage: {queries:2} };
  const first = combinePeriod(period, {bilibili:partial});
  assert.equal(first.platforms.bilibili.status, 'partial');
  assert.equal(first.platforms.bilibili.ranking.length, 1);
  assert.equal(first.platforms.bilibili.lastSuccessAt, null);
  const old = {platforms:{bilibili:{periodId:'2026-10-17',status:'success',ranking:[],lastSuccessAt:'2026-10-17T00:00:00Z'}}};
  const recovered = combinePeriod(period, {bilibili:partial},old).platforms.bilibili;
  assert.equal(recovered.periodId,period.id);
  assert.equal(recovered.status,'partial');
  assert.equal(recovered.ranking.length,1);
  const adjusted = combinePeriod(period, {bilibili:{...partial,minLikes:350,records:[
    record({workId:'v1',likes:361}), record({id:'BV2abcdef',workId:'v2',publishedAt:period.end}),
  ]}},old).platforms.bilibili;
  assert.equal(adjusted.minLikes,350);
  assert.equal(adjusted.ranking.length,1);
  assert.deepEqual(combinePeriod(period, {bilibili:{status:'failed'}},first).platforms.bilibili,first.platforms.bilibili);
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
test('collection budget stops metadata requests before an external call',async()=>{
 const metadata=new Metadata({works:{},staff:{},producers:{}});metadata.deadline=Date.now()-1000;
 await assert.rejects(()=>metadata.query('vn',['id','=','v17'],'title'),/预算/);
});
test('summary refresh does not destroy detailed metadata or drop low-vote sequels', () => {
  const catalog = { works: {}, staff: {}, producers: {} };
  const metadata = new Metadata(catalog);
  metadata.work({ id: 'v1', title: 'low-vote sequel', description: 'intro [spoiler]ending[/spoiler]', staff: [], screenshots: [] }, true);
  catalog.works.v1.communityNames=['社区中文别名'];
  metadata.work({ id: 'v1', title: 'low-vote sequel' });
  assert.equal(catalog.works.v1.detailComplete, true);
  assert.equal(catalog.works.v1.description, 'intro （剧情内容已隐藏）');
  assert.ok(catalog.works.v1.aliases.includes('社区中文别名'));
});
test('edge route whitelist accepts new documents and rejects arbitrary files', () => {
  for (const route of ['quiz/index.html', 'works/v1/index.html', 'staff/s1/index.html', 'producers/p1/index.html', 'periods/2026-11-01/index.html', 'data/discovery.json']) assert.ok(isAllowedFile(route), route);
  for (const route of ['.env', '../secret', 'works/v1/secret.json', 'api/other', 'data/raw/cookie.json', 'https://example.com/']) assert.ok(!isAllowedFile(route), route);
});
