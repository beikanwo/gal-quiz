import test from 'node:test';
import assert from 'node:assert/strict';
import { recurringRanking, renderRecurringRanking } from '../recurring-ranking.mjs';
import { periodFor, canonicalEvidenceUrl } from '../core.mjs';

const config = { intervalDays: 5, minLikes: 500, recurringRanking: {
  startDate: '2026-11-06', windowPeriods: 6, minimumAppearances: 2, limit: 3,
} };
const works = Object.fromEntries(['v1', 'v2', 'v3', 'v4'].map(id => [id, { id, title: id }]));
function snapshot(id, rows = {}, changes = {}) {
  const period = { ...periodFor('2026-11-01', `${id}T09:00:00+08:00`, 5), minLikes: 500 };
  const platforms = Object.fromEntries(['douyin', 'bilibili'].map(platform => [platform, {
    ...period, periodId: id, status: 'success', ranking: (rows[platform] ?? []).map((workId, i) => {
      const postId = platform === 'douyin' ? `${id.replaceAll('-', '')}${i}` : `BV${id.replaceAll('-', '')}${i}`;
      return { workId, evidence: [{ workId, platform, id: postId,
        url: canonicalEvidenceUrl(platform, postId), publishedAt: period.start,
        collectedAt: period.end, likes: 600 }] };
    }),
  }]));
  return { ...period, platforms, ...changes };
}
const rank = periods => recurringRanking({ periods }, config, works);

test('同一期跨平台与多片段只计一次，重跑与输入顺序不增加期数且不修改源数据', () => {
  const first = snapshot('2026-11-06', { douyin: ['v1', 'v1'], bilibili: ['v1'] });
  const second = snapshot('2026-11-11', { bilibili: ['v1'] });
  const periods = [first, second, first];
  const before = JSON.stringify(periods);
  const result = rank(periods);
  assert.deepEqual(result.periods, ['2026-11-11', '2026-11-06']);
  assert.equal(result.entries[0].appearances, 2);
  assert.equal(result.entries[0].evidenceCount, 4);
  assert.equal(JSON.stringify(periods), before);
});

test('只取最近六期，旧15天/1000赞期和其他规则不混入，新一期使最老一期退出', () => {
  const dates = ['2026-11-06', '2026-11-11', '2026-11-16', '2026-11-21', '2026-11-26', '2026-12-01', '2026-12-06'];
  const periods = dates.map((id, i) => snapshot(id, { douyin: i < 2 ? ['v1'] : ['v2'] }));
  const old = snapshot('2026-11-01', { douyin: ['v1'] }, { minLikes: 1000 });
  const wrongWindow = snapshot('2026-12-11', {}, { start: '2026-11-25T16:00:00.000Z' });
  const result = rank([...periods, old, wrongWindow]);
  assert.equal(result.periods.length, 6);
  assert.equal(result.periods.at(-1), '2026-11-11');
  assert.deepEqual(result.entries.map(e => e.workId), ['v2']);
});

test('失败沿用旧数据与冒充当期的来源不重复计数，部分采集的有效内容可计入并标记覆盖不足', () => {
  const first = snapshot('2026-11-06', { douyin: ['v1'] });
  const second = snapshot('2026-11-11', { bilibili: ['v1'] });
  second.platforms.douyin = { ...first.platforms.douyin, status: 'failed' };
  second.platforms.bilibili.status = 'partial';
  const third = snapshot('2026-11-16');
  third.platforms.douyin = { ...first.platforms.douyin, periodId: third.id };
  const result = rank([first, second, third]);
  assert.equal(result.entries[0].appearances, 2);
  assert.equal(result.entries[0].latestPeriod, '2026-11-11');
  assert.equal(result.incomplete, true);
});

test('数量栏不能代替真实证据，低赞、越界、错作品、错平台与未知作品均不计入', () => {
  const first = snapshot('2026-11-06', { douyin: ['v1', 'v2', 'v3', 'v4', 'unknown'] });
  const second = snapshot('2026-11-11', { douyin: ['v1', 'v2', 'v3', 'v4', 'unknown'] });
  const rows = second.platforms.douyin.ranking;
  rows[0].evidence[0].likes = 499;
  rows[1].evidence[0].publishedAt = first.start;
  rows[2].evidence[0].workId = 'v1';
  rows[3].evidence[0].platform = 'bilibili';
  assert.deepEqual(rank([first, second]).entries, []);
});

test('排名依次看期数、最近期次、去重片段数，完全相同保持稳定，只展示前三', () => {
  const periods = [
    snapshot('2026-11-06', { douyin: ['v1', 'v2', 'v3', 'v4'] }),
    snapshot('2026-11-11', { douyin: ['v1', 'v2', 'v3', 'v4'] }),
    snapshot('2026-11-16', { douyin: ['v2', 'v3', 'v4', 'v4'] }),
  ];
  assert.deepEqual(rank(periods).entries.map(e => e.workId), ['v4', 'v2', 'v3']);
  const olderMorePosts = snapshot('2026-11-06', { douyin: ['v1', 'v1', 'v1', 'v1'] });
  assert.deepEqual(rank([olderMorePosts, snapshot('2026-11-11', { douyin: ['v1', 'v2'] }),
    snapshot('2026-11-16', { douyin: ['v2'] })]).entries.map(e => e.workId), ['v2', 'v1']);
});

test('初期和未满三位展示真实进度，不生成虚构作品；入榜期次链接可追溯', () => {
  const helpers = { esc: s => String(s).replaceAll('<', '&lt;'), cover: () => '<div class="cover"></div>' };
  const empty = renderRecurringRanking(rank([]), config, works, helpers);
  assert.ok(empty.includes('已积累 0 / 6 期'));
  assert.ok(!empty.includes('class="recurring-item"'));
  const periods = [snapshot('2026-11-06', { douyin: ['v1'] }), snapshot('2026-11-11', { douyin: ['v1'] })];
  const html = renderRecurringRanking(rank(periods), config, works, helpers);
  assert.ok(html.includes('近 2 期出现 <strong>2</strong> 期'));
  assert.ok(html.includes('目前 1 部作品符合条件'));
  assert.ok(html.includes('@@ROOT@@periods/2026-11-06/'));
  assert.ok(html.includes('@@ROOT@@works/v1/'));
});
