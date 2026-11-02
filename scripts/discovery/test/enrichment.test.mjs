import test from 'node:test';
import assert from 'node:assert/strict';
import { stageDue, recordStage, missingMessage, enrichmentSummary } from '../enrichment-state.mjs';
import { renderRatings } from '../render-details.mjs';
const now='2026-11-02T00:00:00.000Z';
test('从未补全的关联作品进入队列；成功和没有匹配条目都有复查时间',()=>{
  const work={id:'v1',detailComplete:false};
  assert.ok(stageDue(work,'community',Date.parse(now)));
  recordStage(work,'community','unavailable',{now,matched:false});
  assert.ok(!stageDue(work,'community',Date.parse(now)+1000));
  assert.ok(stageDue(work,'community',Date.parse(now)+31*86400000));
  assert.match(missingMessage(work,'bangumi'),/暂未匹配/);
  recordStage(work,'community','success',{now,matched:true});
  assert.equal(missingMessage(work,'bangumi'),'所查来源暂无评分');
});
test('失败采用退避重试，保留历史成功和原来的评分',()=>{
  const work={id:'v1',ratings:{bangumi:{score:7.2,votes:3,via:'原站'}}};
  recordStage(work,'community','success',{now});
  recordStage(work,'community','failed',{now});
  assert.equal(work.metadataStatus.community.lastSuccessAt,now);
  assert.equal(work.metadataStatus.community.nextAttemptAt,'2026-11-02T00:05:00.000Z');
  recordStage(work,'community','failed',{now});
  assert.equal(work.metadataStatus.community.nextAttemptAt,'2026-11-02T00:10:00.000Z');
  assert.equal(work.ratings.bangumi.score,7.2);
  assert.match(renderRatings(work),/7.2/);
  assert.equal(missingMessage(work,'erogamescape'),'采集失败，等待重试');
});
test('断点可序列化恢复，待采集、失败、无数据分别统计和显示',()=>{
  const works={a:{},b:{},c:{descriptionLanguage:'中文'}};
  recordStage(works.b,'community','failed',{now});
  recordStage(works.c,'community','unavailable',{now,matched:true});
  const restored=JSON.parse(JSON.stringify({works}));
  const stats=enrichmentSummary(restored);
  assert.equal(stats.total,3);assert.equal(stats.failed,1);assert.equal(stats.communityPending,1);assert.equal(stats.communityChecked,1);
  assert.equal(missingMessage(restored.works.a,'bangumi'),'尚未采集');
  assert.equal(missingMessage(restored.works.b,'bangumi'),'采集失败，等待重试');
  assert.equal(missingMessage(restored.works.c,'bangumi'),'所查来源暂无评分');
});
