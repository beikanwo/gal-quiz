import { Metadata } from './metadata.mjs';
import { readJson, writeJson } from './io.mjs';
import { vndbNames, communityNames, refreshIdentityNames } from './identity-names.mjs';
const catalog=await readJson('data/discovery/catalog.json'),metadata=new Metadata(catalog);
const ids=Object.keys(catalog.works).filter(id=>/^v\d+$/.test(id));
const pending=[];
for(let offset=0;offset<ids.length;offset+=100){
  const batch=ids.slice(offset,offset+100);
  const rows=await metadata.all('vn',batch.length===1?['id','=',batch[0]]:['or',...batch.map(id=>['id','=',id])],'title,alttitle,titles{lang,title},aliases');
  pending.push(...rows);
  console.log(`核实名称 ${pending.length}/${ids.length}`);
}
// Commit the migration only after every batch has succeeded.
if(pending.length!==ids.length)throw Error('名称核对不完整，保留原目录等待重试');
const periods=await readJson('data/discovery/periods.json');
const active=new Set(periods.periods.flatMap(p=>Object.values(p.platforms).flatMap(d=>d.ranking.map(r=>r.workId))));
for(const row of pending){
  const w=catalog.works[row.id];w.vndbNames=vndbNames(row);
  w.communityNames=[];w.communitySearchNames=[];refreshIdentityNames(w);
}
for(const id of active){
  const w=catalog.works[id],communityId=w?.community?.kungal?.id;
  if(!communityId)continue;
  try{const data=await metadata.community.fetchKun(communityId);if((data.external_refs??[]).some(r=>r.site==='vndb'&&r.external_id===id)){w.communityNames=communityNames(data);w.communitySearchNames=communityNames(data,true);refreshIdentityNames(w);}}catch{/* VNDB names remain the safe fallback. */}
}
await writeJson('data/discovery/catalog.json',catalog);
console.log('已重建全库可用于识别的名称，社区检索关键词不再参与作品匹配。');
