import { Community, applyKunMetadata, chineseText, cleanIntro } from './community.mjs';
import { Metadata } from './metadata.mjs';
import { readJson, writeJson, pause } from './io.mjs';
import { readdir, stat } from 'node:fs/promises';
import { fetchJson } from './sources.mjs';
const catalog=await readJson('data/discovery/catalog.json');
const periods=await readJson('data/discovery/periods.json');
const overrides=await readJson('config/discovery-overrides.json');
const reception=await readJson('config/chinese-reception.json');
const community=new Community();
await community.loadIndex();
const cacheDir='data/raw/reception';
for(const file of (await readdir(cacheDir).catch(()=>[])).filter(f=>/^kun-work-\d+\.json$/.test(f))){
  const data=await readJson(`${cacheDir}/${file}`);
  const fetchedAt=(await stat(`${cacheDir}/${file}`)).mtime.toISOString();
  for(const ref of data.external_refs??[])if(ref.site==='vndb'&&catalog.works[ref.external_id])applyKunMetadata(catalog.works[ref.external_id],data,fetchedAt);
}
const metadata=new Metadata(catalog,overrides);
const ids=Object.keys(catalog.works).filter(id=>/^v\d+$/.test(id));
for(let offset=0;offset<ids.length;offset+=100){
  const group=ids.slice(offset,offset+100),filters=group.length===1?['id','=',group[0]]:['or',...group.map(id=>['id','=',id])];
  const rows=await metadata.all('vn',filters,'rating,votecount');
  for(const row of rows)if(row.rating!=null&&row.votecount>0){
    const w=catalog.works[row.id];w.ratings??={};w.ratings.vndb={score:row.rating/10,scale:10,votes:row.votecount,metric:'贝叶斯评分',via:'原站',url:w.source,fetchedAt:new Date().toISOString()};
  }
}
const active=new Set(Object.values(periods.periods[0]?.platforms??{}).flatMap(p=>p.ranking.map(r=>r.workId)));
for(const w of Object.values(catalog.works).filter(w=>w.detailComplete||active.has(w.id))){
  try{await community.enrich(w);}catch{}
  const bgmId=w.community?.bangumi?.id??reception.entries[w.id]?.bangumi?.id;
  if(w.descriptionLanguage!=='中文'&&bgmId){
    try{const b=await fetchJson(`https://api.bgm.tv/v0/subjects/${bgmId}`);if(b.type===4&&chineseText(b.summary))Object.assign(w,{description:cleanIntro(b.summary),descriptionLanguage:'中文',descriptionSource:`https://bgm.tv/subject/${bgmId}`,descriptionSourceName:'Bangumi'});}catch{}
  }
  const edit=overrides.works[w.id];
  if(edit?.title)w.title=edit.title;
  if(edit?.description&&edit.descriptionSource)Object.assign(w,{description:edit.description,descriptionLanguage:'中文',descriptionSource:edit.descriptionSource,descriptionSourceName:edit.descriptionSourceName??'中文资料整理',descriptionEdited:true,descriptionMachine:false});
  console.log(w.id,w.title,w.descriptionLanguage,Object.keys(w.ratings??{}).join(','));
  await pause(500);
}
await community.saveIndex();
await writeJson('data/discovery/catalog.json',catalog);
console.log('中文资料与三站评分已更新。');
