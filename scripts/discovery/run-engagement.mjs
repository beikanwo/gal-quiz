import { appendFile,readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { args,readJson,writeJson } from './io.mjs';
import { PLATFORMS,chinaDate,matchWork } from './core.mjs';
import { canonicalWorks } from './identity-names.mjs';
import { BilibiliSource,DouyinSource } from './sources.mjs';
import { observe,buildSignals,baseline,fields } from './engagement.mjs';
const DAY=86400000;
export const trialPeriods=config=>Array.from({length:config.trialPeriods},(_,i)=>{
  const end=Date.parse(`${config.firstPeriod}T00:00:00+08:00`)+i*config.intervalDays*DAY;
  return {id:chinaDate(end),start:new Date(end-config.intervalDays*DAY).toISOString(),end:new Date(end).toISOString(),supplementUntil:new Date(end+2*DAY).toISOString()};
});
export async function runEngagement(options=args()) {
  const settings=await readJson('config/engagement.json'),now=Date.now(),periods=trialPeriods(settings);
  const state=await readJson('data/discovery/engagement-state.json',{version:1,posts:{},identityPending:{},reports:{}});
  const expired=now>Date.parse(periods.at(-1).supplementUntil),due=!expired||Boolean(state.updatedAt&&!state.trial?.endedAt);
  if(options.due){if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`due=${due}\n`);console.log(JSON.stringify({due,mode:'shadow'}));return;}
  if(!due){console.log('两期影子观测及48小时补充窗口已结束，等待评估。');return;}
  if(expired){
    for(const r of Object.values(state.reports??{}))r.finalized=true;
    state.trial={...state.trial,endedAt:new Date(now).toISOString()};state.updatedAt=state.trial.endedAt;
    await writeJson('data/discovery/engagement-state.json',state);console.log('已封存影子试运行，正式榜单未改动。');return;
  }
  const catalog=await readJson('data/discovery/catalog.json'),overrides=await readJson('config/discovery-overrides.json');
  const formalRaw=await readFile('data/discovery/periods.json','utf8'),formal=JSON.parse(formalRaw);
  const canonical=new Map();for(const w of await readJson('site/data/vns.json',[]))for(const alt of w.altIds??[])canonical.set(alt,w.id);
  const identities=canonicalWorks(catalog.works,canonical),window={start:new Date(now-5*DAY).toISOString(),end:new Date(now+1000).toISOString()};
  const deadline=now+Number(options.minutes??16)*60000;
  const report={startedAt:new Date(now).toISOString(),mode:'shadow',formalRankingChanged:false,searchWindow:window,platforms:{}};
  const activeWorks=[...new Set(Object.values(formal.periods[0]?.platforms??{}).flatMap(p=>p.ranking.map(r=>r.workId)))];
  const queries=[...settings.keywords,...activeWorks.slice(0,settings.maxExpansionWorks).map(id=>catalog.works[id]?.title).filter(Boolean)];
  for(const platform of PLATFORMS){
    const source=platform==='douyin'?new DouyinSource():new BilibiliSource(),fresh=[],failures=[];let searches=0;
    for(const keyword of queries){
      if(Date.now()>deadline-(platform==='douyin'?5:1)*60000)break;
      try{const batch=await source.search(keyword,1,window,{order:'pubdate'});fresh.push(...batch.records);searches++;if(batch.partial)failures.push({stage:'search',keyword});}
      catch{failures.push({stage:'search',keyword});}
      if(searches===0&&failures.length>=2)break;
    }
    // Latest-first discovers low-like posts; a small separate high-view sample
    // provides a meaningful popular comparator over the same posting window.
    if(platform==='bilibili')for(const keyword of settings.comparisonKeywords??[]){
      if(Date.now()>deadline-2*60000)break;
      try{const batch=await source.search(keyword,1,window,{order:'click'});fresh.push(...batch.records);searches++;if(batch.partial)failures.push({stage:'comparison-search',keyword});}catch{failures.push({stage:'comparison-search',keyword});}
    }
    observe(state,fresh,identities,overrides);
    // Refresh observed posts, especially the young videos and validation sample.
    const priority=p=>{
      const age=(now-Date.parse(p.record.publishedAt))/3600000,observedAge=(Date.parse(p.record.collectedAt)-Date.parse(p.record.publishedAt))/3600000;
      if(age>=24&&observedAge<24)return 0;
      if(age>=12&&age<36&&!p.ageSnapshots?.day1||age>=60&&age<84&&!p.ageSnapshots?.day3)return 0;
      return now-Date.parse(p.record.collectedAt)>20*3600000?1:2;
    };
    const candidates=Object.values(state.posts).filter(p=>p.record.platform===platform&&Date.parse(p.record.publishedAt)>=now-7*DAY).sort((a,b)=>priority(a)-priority(b)||Date.parse(a.record.collectedAt)-Date.parse(b.record.collectedAt));
    const refresh=candidates.slice(0,settings.maxRefreshPerPlatform).map(p=>p.record);
    if(refresh.length&&Date.now()<deadline-60000){
      for(let i=0;i<refresh.length&&Date.now()<deadline-30000;i+=platform==='douyin'?10:5){
        const batch=refresh.slice(i,i+(platform==='douyin'?10:5));
        try{const result=await source.refreshMany(batch);fresh.push(...result.records);observe(state,result.records,identities,overrides);for(const id of result.failedIds)failures.push({stage:'refresh',id});}catch{for(const r of batch)failures.push({stage:'refresh',id:r.id});}
      }
    }
    const sample=[...new Map(fresh.map(r=>[r.id,r])).values()].slice(0,settings.sampleTargetPerPlatform);
    const available=Object.fromEntries(['author',...fields].map(field=>[field,sample.filter(r=>field==='author'?Boolean(r.author?.id):Number.isSafeInteger(r.metrics?.[field])&&r.metrics[field]>=0).length]));
    const required=platform==='douyin'?['author','favorites','comments','shares']:['author',...fields];
    const current={status:searches||fresh.length?(failures.length?'partial':'success'):'failed',fieldVerificationStatus:required.every(f=>available[f]>=settings.sampleTargetPerPlatform)?'complete':'incomplete',lastAttemptAt:new Date().toISOString(),searches,queries,failures,sampleCount:sample.length,sampleTarget:settings.sampleTargetPerPlatform,available,zeroValues:Object.fromEntries(fields.map(f=>[f,sample.filter(r=>r.metrics?.[f]===0).length]))};
    if(fresh.length)current.lastSuccessAt=current.lastAttemptAt;else current.lastSuccessAt=state.platforms?.[platform]?.lastSuccessAt??null;
    state.platforms??={};state.platforms[platform]=current;report.platforms[platform]=current;
    await writeJson(`data/raw/engagement/${platform}-samples.json`,sample);
    await writeJson('data/discovery/engagement-state.json',state);
    console.log(`${platform}: ${current.status}, ${sample.length}条字段样本, ${Object.values(state.posts).filter(p=>p.record.platform===platform).length}条明确作品候选`);
  }
  // Recheck identity after every run, including cached observations.
  for(const [key,post]of Object.entries(state.posts)){
    const record=post.record;const match=matchWork(record,identities,overrides);
    if(match.status!=='matched'||match.workId!==record.workId){state.identityPending[key]={platform:record.platform,id:record.id,url:record.url,reason:'已有观测身份复核未通过'};delete state.posts[key];}
  }
  // Bounded retention; do not fabricate historic age snapshots from mature counts.
  for(const [key,p]of Object.entries(state.posts))if(Date.parse(p.record.publishedAt)<now-60*DAY)delete state.posts[key];
  const posts=Object.values(state.posts);
  const makeReport=period=>({period,generatedAt:new Date().toISOString(),platforms:Object.fromEntries(PLATFORMS.map(platform=>{
    const records=posts.filter(p=>p.record.platform===platform).map(p=>({...p.record,baseline:baseline(p,posts)}));
    return [platform,{...(state.platforms?.[platform]??{status:'unavailable'}),...buildSignals(records,period,settings,posts)}];
  }))});
  for(const period of periods){
    if(Date.parse(period.end)>now)continue;
    if(state.reports[period.id]?.finalized)continue;
    if(now>Date.parse(period.supplementUntil)&&state.reports[period.id]){state.reports[period.id].finalized=true;continue;}
    state.reports[period.id]={...makeReport(period),finalized:now>Date.parse(period.supplementUntil)};
  }
  const rehearsal={id:`preview-${chinaDate(now)}`,start:window.start,end:window.end,rehearsal:true};
  state.preview=makeReport(rehearsal);state.updatedAt=new Date().toISOString();
  state.trial={periods,closed:periods.filter(p=>Date.parse(p.end)<=now).length,finalized:periods.filter(p=>state.reports[p.id]?.finalized).length,target:settings.trialPeriods};
  report.finishedAt=state.updatedAt;report.observedPosts=posts.length;report.identityPending=Object.keys(state.identityPending??{}).length;report.trial=state.trial;
  report.formalRankingChanged=(await readFile('data/discovery/periods.json','utf8'))!==formalRaw;
  if(report.formalRankingChanged)throw Error('正式榜单在观测期间发生变化，请从最新版本重试');
  await writeJson('data/discovery/engagement-state.json',state);
  await writeJson('data/discovery/engagement-report.json',report);
  await writeJson('data/raw/engagement/report.json',report);
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## 互动影子验证\n正式榜单未改动。\n${PLATFORMS.map(p=>`${p}：${report.platforms[p].status}；样本 ${report.platforms[p].sampleCount}/20；字段返回 ${JSON.stringify(report.platforms[p].available)}`).join('\n')}\n`);
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runEngagement();
