import { readJson, writeJson } from './io.mjs';
import { matchWork, rankEvidence, dedupe } from './core.mjs';
import { canonicalWorks } from './identity-names.mjs';
const catalog=await readJson('data/discovery/catalog.json'),index=await readJson('data/discovery/periods.json'),overrides=await readJson('config/discovery-overrides.json');
const canonical=new Map();for(const w of await readJson('site/data/vns.json',[]))for(const id of w.altIds??[])canonical.set(id,w.id);
const works=canonicalWorks(catalog.works,canonical),now=new Date().toISOString();
const before=JSON.stringify(index);
const prior=await readJson('data/discovery/identity-audit.json',{quarantined:[]});
await writeJson('data/raw/discovery/identity-before.json',index);
const audit={checkedAt:now,checked:0,retained:0,quarantined:[]};
for(const period of index.periods)for(const [platform,data]of Object.entries(period.platforms)){
  const keep=[];
  for(const record of data.ranking.flatMap(r=>r.evidence??[])){
    audit.checked++;const result=matchWork(record,works,overrides);
    if(result.status==='matched'&&result.workId===record.workId){keep.push({...record,matchMethod:result.method,...(result.matchedNames?{matchedNames:result.matchedNames}:{})});audit.retained++;}
    else audit.quarantined.push({...record,previousWorkId:record.workId,periodId:period.id,reason:result.reason??'重新识别结果与原关联不同，需人工核对',candidates:result.candidates??(result.workId?[result.workId]:[]),auditStatus:result.status});
  }
  const ranking=rankEvidence(keep);
  if(JSON.stringify(ranking)!==JSON.stringify(data.ranking)){data.ranking=ranking;data.identityReviewedAt=now;}
}
const review=await readJson('data/discovery/review.json',{records:[],pending:[],warnings:[]});
const reviewBefore=JSON.stringify(review);
review.pending=dedupe([...review.pending.filter(r=>!overrides.evidence?.[`${r.platform}:${r.id}`]?.exclude),...audit.quarantined.filter(r=>r.periodId===review.periodId&&r.auditStatus!=='excluded')]);
const newlyQuarantined=audit.quarantined;
audit.quarantined=[...new Map([...(prior.quarantined??[]),...newlyQuarantined].map(r=>[`${r.periodId}:${r.platform}:${r.id}`,r])).values()];
if(before!==JSON.stringify(index)||reviewBefore!==JSON.stringify(review)||!prior.checkedAt){
  await writeJson('data/discovery/periods.json',index);
  await writeJson('data/discovery/review.json',review);
  await writeJson('data/discovery/identity-audit.json',audit);
}
console.log(JSON.stringify({checked:audit.checked,retained:audit.retained,quarantined:audit.quarantined.map(r=>({platform:r.platform,id:r.id,previousWorkId:r.previousWorkId,reason:r.reason}))}));
