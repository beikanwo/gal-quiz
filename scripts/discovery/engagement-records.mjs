export const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function biliEngagement(data) {
  const stat=data.stat??{},id=String(data.owner?.mid??'');
  return {kind:'video',durationSeconds:count(data.duration),author:/^\d+$/.test(id)?{id,name:String(data.owner.name??'').slice(0,100),url:`https://space.bilibili.com/${id}`} : null,
    metrics:{favorites:count(stat.favorite),comments:count(stat.reply),shares:count(stat.share),views:count(stat.view),coins:count(stat.coin)},
    metricAvailability:Object.fromEntries([['favorites','favorite'],['comments','reply'],['shares','share'],['views','view'],['coins','coin']].map(([key,raw])=>[key,count(stat[raw])===null?'missing':'available']))};
}
