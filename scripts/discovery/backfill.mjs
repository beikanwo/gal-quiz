import { pathToFileURL } from 'node:url';
import { Metadata, detailFields } from './metadata.mjs';
import { cleanIntro, chineseText } from './community.mjs';
import { fetchJson } from './sources.mjs';
import { args, readJson, writeJson, pause } from './io.mjs';
import { stageDue, recordStage, enrichmentSummary } from './enrichment-state.mjs';

export async function backfill(options = args()) {
  const bounded = (value, fallback, max) => { const n=Number(value ?? fallback); if(!Number.isInteger(n)||n<1||n>max)throw Error('Invalid metadata batch limit'); return n; };
  const limit=bounded(options.limit,120,5000), vnLimit=bounded(options['vn-limit'],2500,10000), coverLimit=bounded(options['cover-limit'],40,5000);
  bounded(options.minutes,18,40);
  const catalog = await readJson('data/discovery/catalog.json');
  const overrides = await readJson('config/discovery-overrides.json', {});
  const reception = await readJson('config/chinese-reception.json', { entries: {} });
  const periods = await readJson('data/discovery/periods.json', { periods: [] });
  const metadata = new Metadata(catalog, overrides);
  await metadata.community.loadIndex();
  const startedAt = new Date().toISOString(), duration = Number(options.minutes ?? 18) * 60000, deadline = Date.now() + duration;
  const communityDeadline = deadline - duration * .3, bangumiDeadline = deadline - duration * .12;
  metadata.deadline = deadline - 5000;
  const priority = new Set(['v26721',...Object.values(periods.periods[0]?.platforms ?? {}).flatMap(p => p.ranking.map(r => r.workId))]);
  const works = Object.values(catalog.works).filter(w => /^v\d+$/.test(w.id)).sort((a,b) => Number(priority.has(b.id)) - Number(priority.has(a.id)));
  if(!works.some(w => ['vndb','community','cover'].some(stage => stageDue(w,stage)) || ((w.community?.bangumi?.id || reception.entries?.[w.id]?.bangumi?.id) && stageDue(w,'bangumi')))) {
    console.log('资料队列暂无到期任务。');return;
  }
  const report = { startedAt, before: enrichmentSummary(catalog), stages: { vndb:0, community:0, bangumi:0, cover:0 }, failures:[] };
  const save = async () => {
    catalog.updatedAt = new Date().toISOString();
    await writeJson('data/discovery/catalog.json',catalog);
    await metadata.community.saveIndex();
    report.updatedAt = catalog.updatedAt; report.after = enrichmentSummary(catalog);
    await writeJson('data/discovery/enrichment.json',report);
  };
  const mark = (w,stage,status,extra={}) => { recordStage(w,stage,status,extra); report.stages[stage]++; if(status === 'failed')report.failures.push({workId:w.id,stage}); };
  // Fetch full records in batches; never recursively expand their colleagues.
  const vnIds = works.filter(w => stageDue(w,'vndb')).slice(0,vnLimit).map(w => w.id);
  for (let offset=0; offset<vnIds.length && Date.now()<deadline-30000; offset+=100) {
    const ids=vnIds.slice(offset,offset+100);
    try {
      const rows=await metadata.all('vn',ids.length===1?['id','=',ids[0]]:['or',...ids.map(id => ['id','=',id])],detailFields);
      const found=new Set();
      for(const row of rows){ const w=metadata.work(row,true); found.add(row.id); mark(w,'vndb','success'); }
      for(const id of ids)if(!found.has(id))mark(catalog.works[id],'vndb','unavailable',{reason:'source_record_missing'});
      console.log(`VNDB ${Math.min(offset+100,vnIds.length)}/${vnIds.length}`);
    } catch { for(const id of ids)mark(catalog.works[id],'vndb','failed'); }
    await save();
    if(report.failures.filter(f => f.stage==='vndb').length>=100)break;
  }
  // Re-read records: Metadata.work replaces record objects during summary merge.
  const ordered=works.map(w => catalog.works[w.id]);
  let errors=0;
  for(const work of ordered.filter(w => stageDue(w,'community')).slice(0,limit)) {
    if(Date.now()>communityDeadline)break;
    try {
      const matched=await metadata.community.enrich(work);
      mark(work,'community',matched?'success':'unavailable',{matched}); errors=0;
    } catch {mark(work,'community','failed');errors++;}
    console.log(`中文资料 ${report.stages.community} · ${work.id} · ${work.metadataStatus.community.status}`);
    if(report.stages.community%5===0)await save();
    if(errors>=5)break; // A source outage must not exhaust the whole queue.
  }
  await save();
  for(const work of ordered) {
    if(Date.now()>bangumiDeadline)break;
    const id=work.community?.bangumi?.id ?? reception.entries?.[work.id]?.bangumi?.id;
    if(!id || !/^\d+$/.test(String(id)) || !stageDue(work,'bangumi'))continue;
    try {
      const data=await fetchJson(`https://api.bgm.tv/v0/subjects/${id}`,{headers:{'User-Agent':'beikanwo/gal-quiz (https://www.scurra.top)'}});
      if(data.type!==4)throw Error('Wrong subject type');
      const source=`https://bgm.tv/subject/${id}`;
      if(data.rating?.total>0 && Number.isFinite(data.rating.score)) {
        work.ratings??={};work.ratings.bangumi={score:data.rating.score,scale:10,votes:data.rating.total,metric:'站点评分',url:source,via:'原站',fetchedAt:new Date().toISOString()};
      }
      if(!work.descriptionEdited && (work.descriptionLanguage!=='中文'||work.descriptionMachine) && chineseText(cleanIntro(data.summary)))Object.assign(work,{description:cleanIntro(data.summary),descriptionLanguage:'中文',descriptionSource:source,descriptionSourceName:'Bangumi',descriptionMachine:false});
      mark(work,'bangumi','success');
    } catch(error) {mark(work,'bangumi','failed',{reason: /HTTP (\d{3})/.exec(error.publicMessage ?? '')?.[1] ? `http_${/HTTP (\d{3})/.exec(error.publicMessage)[1]}` : 'request_failed'});}
    if(report.stages.bangumi%10===0)await save();
    await pause(500);
  }
  for(const work of ordered.filter(w => w.image && stageDue(w,'cover')))mark(work,'cover','success');
  for(const work of ordered.filter(w => !w.image && stageDue(w,'cover')).slice(0,coverLimit)) {
    if(Date.now()>deadline-15000)break;
    try { await metadata.enrichCover(work);mark(work,'cover',work.image?'success':'unavailable'); }
    catch {mark(work,'cover','failed');}
    if(report.stages.cover%10===0)await save();
  }
  report.finishedAt=new Date().toISOString();
  await save();console.log(JSON.stringify(report));return report;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await backfill();
