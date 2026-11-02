import {Metadata} from './metadata.mjs';
import {readJson,writeJson,args} from './io.mjs';
const catalog=await readJson('data/discovery/catalog.json');
const periods=await readJson('data/discovery/periods.json');
const metadata=new Metadata(catalog);
const priority=new Set([...Object.keys(catalog.works).slice(0,60),...Object.values(catalog.works).filter(w=>w.detailComplete).map(w=>w.id),...Object.values(periods.periods[0]?.platforms??{}).flatMap(p=>p.ranking.map(r=>r.workId))]);
const selected=Object.values(catalog.works).filter(w=>!w.image&&(args().all||priority.has(w.id)));
const report={checkedAt:new Date().toISOString(),checked:selected.length,restored:[],unavailable:[]};
for(const work of selected){
  try{await metadata.enrichCover(work);if(work.image){report.restored.push({workId:work.id,title:work.title,cover:work.cover});console.log(work.id,work.title,'已补齐');}else report.unavailable.push({workId:work.id,title:work.title});}
  catch{report.unavailable.push({workId:work.id,title:work.title,retry:true});}
}
if(report.restored.length){catalog.updatedAt=new Date().toISOString();await writeJson('data/discovery/catalog.json',catalog);}
await writeJson('data/raw/discovery/cover-repair.json',report);
console.log(`检查 ${report.checked} 部，补齐 ${report.restored.length} 部，剩余 ${report.unavailable.length} 部继续保留真实占位。`);
