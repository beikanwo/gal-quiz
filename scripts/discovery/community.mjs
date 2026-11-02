import { readdir } from 'node:fs/promises';
import { fetchJson } from './sources.mjs';
import { readJson, writeJson, pause } from './io.mjs';
import { normalize, safeUrl } from './core.mjs';
import { communityNames, refreshIdentityNames } from './identity-names.mjs';
export const chineseText = (text) => {
  const han=(String(text??'').match(/\p{Script=Han}/gu)??[]).length;
  const kana=(String(text??'').match(/[ぁ-ゔァ-ヴ]/gu)??[]).length;
  const latin=(String(text??'').match(/[a-z]/giu)??[]).length;
  return han >= 4 && han > kana * 2 && han >= latin * 0.6;
};
export const cleanIntro = (text) => String(text ?? '').replace(/\[spoiler\][\s\S]*?\[\/spoiler\]/gi, '（剧情内容已隐藏）').replace(/<[^>]*>/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\[\/?(?:b|i|u|quote|url[^\]]*)\]/gi, '').trim();
const sourceNames = { bangumi: 'Bangumi', vndb: 'VNDB', erogamescape: '批评空间' };
const namesOf = data => communityNames(data);
export function kunIdentity(data, work) {
  return (data.external_refs ?? []).some((r) => r.site === 'vndb' && r.external_id === work.id);
}
export function applyKunMetadata(work, data, fetchedAt = new Date().toISOString()) {
  if (!kunIdentity(data, work)) return false;
  const via = `https://www.kungal.com/galgame/${data.id}`;
  work.communityNames=communityNames(data);
  work.communitySearchNames=communityNames(data,true);
  refreshIdentityNames(work);
  work.community ??= {};
  work.community.kungal = { id: String(data.id), url: via };
  const bangumiRef=data.external_refs?.find(r=>r.site==='bangumi');
  if(bangumiRef)work.community.bangumi={id:Number(bangumiRef.external_id),url:`https://bgm.tv/subject/${bangumiRef.external_id}`};
  const intro = (data.intros ?? []).filter((i) => /^zh/i.test(i.locale) && chineseText(cleanIntro(i.value))).sort((a, b) => Number(a.is_machine) - Number(b.is_machine) || Number(b.locale === 'zh-Hans') - Number(a.locale === 'zh-Hans'))[0];
  if (intro && !work.descriptionEdited) {
    work.description = cleanIntro(intro.value);
    work.descriptionLanguage = '中文';
    work.descriptionSource = via;
    work.descriptionSourceName = intro.data_source === 'bangumi' ? 'Bangumi（KUN 资料镜像）' : 'KUN 社区';
    work.descriptionMachine = Boolean(intro.is_machine);
  }
  work.ratings ??= {};
  for (const item of data.external_ratings ?? []) {
    if (!sourceNames[item.site] || !Number.isFinite(item.rating_value) || !(item.vote_count > 0)) continue;
    const ref = data.external_refs?.find((r) => r.site === item.site);
    if (!ref) continue;
    const url = item.site === 'vndb' ? `https://vndb.org/${work.id}` : item.site === 'bangumi' ? `https://bgm.tv/subject/${ref.external_id}` : `https://erogamescape.dyndns.org/~ap2/ero/toukei_kaiseki/game.php?game=${ref.external_id}`;
    if (item.site === 'vndb' && work.ratings.vndb?.via === '原站') continue;
    work.ratings[item.site] = { score: item.rating_value, votes: item.vote_count, scale: item.site === 'erogamescape' ? 100 : 10, metric: item.site === 'vndb' ? '平均分' : '站点评分', url, via: 'KUN 评分快照', viaUrl: via, fetchedAt };
    if (item.site === 'bangumi') work.community.bangumi = { id: Number(ref.external_id), url };
  }
  return true;
}
export class Community {
  constructor() { this.index = null; this.cache = new Map(); this.lastRequest = 0; }
  async request(url, options) {
    await pause(Math.max(0, this.lastRequest + 500 - Date.now()));
    this.lastRequest = Date.now();
    return fetchJson(url, options);
  }
  async loadIndex() {
    if (this.index) return;
    this.index = await readJson('config/discovery-community.json', { version: 1, works: {} });
    // Bootstrap from earlier verified API snapshots; no title guessing or score thresholds.
    const files = await readdir('data/raw/reception').catch(() => []);
    for (const file of files.filter((f) => /^kun-work-\d+\.json$/.test(f))) {
      const data = await readJson(`data/raw/reception/${file}`);
      for (const ref of data.external_refs ?? []) if (ref.site === 'vndb' && /^v\d+$/.test(ref.external_id)) this.index.works[ref.external_id] ??= String(data.id);
    }
  }
  async fetchKun(id) {
    id = String(id);
    if (this.cache.has(id)) return this.cache.get(id);
    const data = await this.request(`https://www.kungal.com/api/v1/works/${id}?include_nsfw=true`, { headers: { 'User-Agent': 'beikanwo/gal-quiz (https://www.scurra.top)' } });
    this.cache.set(id, data);
    return data;
  }
  async resolveName(name) {
    const result=await this.request(`https://www.kungal.com/api/v1/search/works?${new URLSearchParams({q:name,limit:'8',include_nsfw:'true',include_resourceless:'true',include_all_original_languages:'true'})}`);
    for(const item of result.items??[]){
      if(!namesOf(item).some(x=>normalize(x)===normalize(name)))continue;
      const data=await this.fetchKun(item.id);
      if(namesOf(data).some(x=>normalize(x)===normalize(name)))return data;
    }
    return null;
  }
  async enrich(work, search = true) {
    await this.loadIndex();
    let id = work.community?.kungal?.id ?? this.index.works[work.id];
    if (!id && search) {
      for (const q of [...new Set([work.title, work.original, ...(work.aliases ?? []).slice(0,2)])].filter(Boolean)) {
        const result = await this.request(`https://www.kungal.com/api/v1/search/works?${new URLSearchParams({q,limit:'8',include_nsfw:'true',include_resourceless:'true',include_all_original_languages:'true'})}`);
        for (const candidate of result.items ?? []) {
          const data = await this.fetchKun(candidate.id);
          if (kunIdentity(data, work)) { id = String(data.id); break; }
        }
        if (id) break;
      }
    }
    if (!id) return false;
    const data = await this.fetchKun(id);
    if (!applyKunMetadata(work, data)) return false;
    this.index.works[work.id] = String(data.id);
    return true;
  }
  async saveIndex() { if (this.index) await writeJson('config/discovery-community.json', this.index); }
}
