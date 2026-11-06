// Reapply trial thresholds to existing observations without another collection.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readJson,writeJson } from './io.mjs';
import { reclassifyReport } from './engagement.mjs';

const settings=await readJson('config/engagement.json');
const state=await readJson('data/discovery/engagement-state.json');
const formal=await readFile('data/discovery/periods.json','utf8');
const observed=JSON.stringify(state.posts),now=new Date().toISOString(),posts=Object.values(state.posts);
for(const [id,report]of Object.entries(state.reports??{}))state.reports[id]=reclassifyReport(report,posts,settings,now);
if(state.preview)state.preview=reclassifyReport(state.preview,posts,settings,now);
state.rulesUpdatedAt=now;
assert.equal(JSON.stringify(state.posts),observed,'门槛重算不得修改原观测数值或采集时间');
assert.equal(await readFile('data/discovery/periods.json','utf8'),formal,'门槛重算不得改写正式热榜');
await writeJson('data/discovery/engagement-state.json',state);
console.log('已按新门槛重算未封存互动报告；原始观测与正式热榜未变。');
