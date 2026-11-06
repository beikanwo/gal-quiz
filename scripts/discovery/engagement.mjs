import { qualifies, dedupe, matchWork } from './core.mjs';
export const fields=['favorites','comments','shares','views','coins'];
export const ageHours=r=>(Date.parse(r.collectedAt)-Date.parse(r.publishedAt))/3600000;
export const ageBucket=r=>ageHours(r)>=12&&ageHours(r)<36?'day1':ageHours(r)>=60&&ageHours(r)<84?'day3':null;
const median=values=>{const a=[...values].sort((a,b)=>a-b),n=a.length;return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;};
const format=r=>r.kind==='image'?'image':Number.isFinite(r.durationSeconds)&&r.durationSeconds>0?r.durationSeconds<=90?'short':r.durationSeconds<=600?'medium':'long':null;
const incentives=r=>/抽奖|抽獎|关注.{0,5}领取|关注.{0,5}領取|送激活码|送激活碼|有偿推广|有償推廣|赞助广告|贊助廣告/.test(`${r.title} ${r.description}`);
export function observe(state,records,works,overrides={}) {
  state.posts??={};state.identityPending??={};
  for(const r of dedupe(records)){
    if(!qualifies(r,{start:'2000-01-01T00:00:00Z',end:'2100-01-01T00:00:00Z'},0))continue;
    const key=`${r.platform}:${r.id}`,identity=matchWork(r,works,overrides);
    if(identity.status!=='matched'){state.identityPending[key]={platform:r.platform,id:r.id,url:r.url,title:r.title,reason:identity.reason,candidates:identity.candidates??[]};continue;}
    const old=state.posts[key];
    if(old&&old.record.workId!==identity.workId){state.identityPending[key]={platform:r.platform,id:r.id,url:r.url,title:r.title,reason:'作品关联改变，须人工核对'};continue;}
    if(old&&Date.parse(old.record.collectedAt)>Date.parse(r.collectedAt))continue;
    const record={...r,workId:identity.workId,matchMethod:identity.method,matchedNames:identity.matchedNames??[]};
    const post=state.posts[key]={...old,record,firstSeenAt:old?.firstSeenAt??r.collectedAt,ageSnapshots:{...(old?.ageSnapshots??{})}};
    const bucket=ageBucket(record),target=bucket==='day1'?24:72,previous=bucket&&post.ageSnapshots[bucket];
    if(bucket&&(!previous||Math.abs(ageHours(record)-target)<Math.abs(ageHours(previous)-target)))post.ageSnapshots[bucket]=record;
    delete state.identityPending[key];
  }
}
export function baseline(post,posts) {
  const r=post.record,bucket=post.ageSnapshots?.day3?'day3':post.ageSnapshots?.day1?'day1':null,target=bucket&&post.ageSnapshots[bucket];
  if(!r.author?.id||!bucket||!format(r)||incentives(r))return {status:'insufficient',sampleCount:0,reason:'缺少作者、同龄快照或可比较的内容类型'};
  const refs=posts.filter(p=>p.record.platform===r.platform&&p.record.id!==r.id&&p.record.author?.id===r.author.id&&format(p.record)===format(r)&&!incentives(p.record)&&p.ageSnapshots?.[bucket]&&Date.parse(p.record.publishedAt)<Date.parse(r.publishedAt)&&Date.parse(p.record.publishedAt)>=Date.parse(r.publishedAt)-60*86400000).sort((a,b)=>Date.parse(b.record.publishedAt)-Date.parse(a.record.publishedAt)).slice(0,20);
  if(refs.length<8)return {status:'insufficient',sampleCount:refs.length,reason:'同类同龄观测少于8条',scope:'observed-candidates'};
  const metrics={};
  for(const [field,floor]of [['likes',20],['favorites',10],['comments',5]]){
    const value=field==='likes'?target.likes:target.metrics?.[field];
    const values=refs.map(p=>field==='likes'?p.ageSnapshots[bucket].likes:p.ageSnapshots[bucket].metrics?.[field]).filter(v=>Number.isSafeInteger(v)&&v>=0);
    if(value==null||values.length<8)continue;const usual=median(values);if(usual<floor)continue;
    metrics[field]={value,median:usual,ratio:Number((value/usual).toFixed(2)),sampleCount:values.length};
  }
  return Object.keys(metrics).length?{status:'available',sampleCount:refs.length,ageBucket:bucket,observedAt:target.collectedAt,scope:'observed-candidates',metrics,exceedsNormal:Object.values(metrics).some(m=>m.ratio>=2)}:{status:'insufficient',sampleCount:refs.length,reason:'参考数据缺失或基数过低'};
}
const ownerKey=(r,settings)=>r.author?.id?(settings.authorGroups?.[`${r.platform}:${r.author.id}`]??r.author.id):null;
export function buildSignals(records,period,settings,posts=[]) {
  const valid=dedupe(records).filter(r=>qualifies(r,period,0)&&r.workId&&!settings.excludeEvidence?.[`${r.platform}:${r.id}`]);
  const postMap=new Map(posts.map(p=>[`${p.record.platform}:${p.record.id}`,p]));
  const groups=new Map();
  for(const r of valid){const key=`${r.platform}:${r.workId}`;if(!groups.has(key))groups.set(key,{workId:r.workId,platform:r.platform,evidence:[]});groups.get(key).evidence.push(r);}
  const popular=[],favorites=[],discussion=[],watch=[],review=[];
  for(const {workId,platform,evidence}of groups.values()){
    const eligible=evidence.filter(r=>!incentives(r)&&!settings.duplicateOf?.[`${r.platform}:${r.id}`]);
    const hot=eligible.filter(r=>r.likes>=settings.hotMinLikes),owners=new Map();
    for(const r of hot){const key=ownerKey(r,settings);if(key&&(!owners.has(key)||r.likes>owners.get(key).likes))owners.set(key,r);}
    if(hot.length){const authorEvidence=[...owners.values()],sum=authorEvidence.reduce((n,r)=>n+r.likes,0);popular.push({workId,platform,authorCount:owners.size,missingAuthors:hot.filter(r=>!r.author?.id).length,layer:owners.size>=3?'多账号传播':owners.size===2?'多账号出现':owners.size===1?'单账号线索':'作者信息不足',aboveNormalAuthors:authorEvidence.filter(r=>baseline(postMap.get(`${r.platform}:${r.id}`)??{record:r},posts).exceedsNormal).length,maxLikes:Math.max(...hot.map(r=>r.likes)),concentration:hot.some(r=>!r.author?.id)?null:sum?Number((Math.max(...authorEvidence.map(r=>r.likes))/sum).toFixed(4)):null,evidence:hot});}
    const fav=[];
    for(const r of eligible.filter(r=>r.likes<settings.hotMinLikes)){
      const count=r.metrics?.favorites,views=r.metrics?.views,comments=r.metrics?.comments;
      const minimum=r.platform==='douyin'?(settings.douyinFavoritesMin??settings.favoritesMin):settings.favoritesMin;
      const hasFavoriteSignal=Number.isSafeInteger(count)&&count>=minimum&&(r.platform==='douyin'?(r.likes===0||count/r.likes>=settings.douyinFavoriteLikeRatio):Number.isSafeInteger(views)&&views>=settings.bilibiliViewsMin&&count/views>=settings.bilibiliFavoriteViewRatio);
      if(hasFavoriteSignal){if(ageHours(r)<24||r.likes===0)watch.push({workId,platform,reason:r.likes===0?'零点赞基数，暂不计算收藏赞比':'发布不足24小时',evidence:[r]});else fav.push(r);}
      if(Number.isSafeInteger(comments)&&comments>=settings.commentsMin){const approval=settings.discussions?.[`${r.platform}:${r.id}`];const verified=approval?.approved===true&&approval.aboutGame===true&&approval.note&&Number.isFinite(Date.parse(approval.reviewedAt));(verified?discussion:review).push({workId,platform,reason:verified?'人工确认讨论围绕作品':'评论较多，需排查作者自答、抽奖及与作品无关的讨论',evidence:[r]});}
    }
    if(fav.length){const accounts=new Set(fav.map(r=>ownerKey(r,settings)).filter(Boolean));favorites.push({workId,platform,authorCount:accounts.size,layer:accounts.size>=2?'多账号收藏突出':accounts.size===1?'单账号观察':'作者信息不足',maxFavorites:Math.max(...fav.map(r=>r.metrics.favorites)),evidence:fav});}
    for(const r of evidence.filter(incentives))review.push({workId,platform,reason:'疑似抽奖或推广内容，暂不计入传播和收藏信号',evidence:[r]});
  }
  popular.sort((a,b)=>b.authorCount-a.authorCount||b.aboveNormalAuthors-a.aboveNormalAuthors||b.maxLikes-a.maxLikes||a.workId.localeCompare(b.workId));
  favorites.sort((a,b)=>b.authorCount-a.authorCount||b.maxFavorites-a.maxFavorites||a.workId.localeCompare(b.workId));
  return {popular,favorites,discussion,watch,review:review.sort((a,b)=>(b.evidence[0].metrics?.comments??0)-(a.evidence[0].metrics?.comments??0)).slice(0,10)};
}

export const signalRules=settings=>Object.fromEntries(['hotMinLikes','favoritesMin','douyinFavoriteLikeRatio','bilibiliViewsMin','bilibiliFavoriteViewRatio','commentsMin'].map(key=>[key,settings[key]]).concat([['douyinFavoritesMin',settings.douyinFavoritesMin??settings.favoritesMin]]));

export function reclassifyReport(report,posts,settings,generatedAt=new Date().toISOString()) {
  if(report.finalized||report.generatedAt&&Date.parse(report.period.supplementUntil)<Date.parse(generatedAt))return report;
  return {...report,settings:signalRules(settings),generatedAt,platforms:Object.fromEntries(Object.entries(report.platforms).map(([platform,data])=>{
    const records=posts.filter(p=>p.record.platform===platform).map(p=>({...p.record,baseline:baseline(p,posts)}));
    return [platform,{...data,...buildSignals(records,report.period,settings,posts)}];
  }))};
}
