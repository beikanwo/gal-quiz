import {safeUrl} from './core.mjs';
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHtml;
const link = (url,label) => safeUrl(url) ? `<a href="${e(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${e(label)} ↗</a>` : e(label);
export function renderRatings(work) {
  const sources=[['bangumi','Bangumi',10],['vndb','VNDB',10],['erogamescape','批评空间',100]];
  return `<aside class="ratings-panel" aria-label="作品口碑评分"><h3>口碑评分</h3><p class="rating-explanation">三个平台，分别看</p>${sources.map(([key,name,scale])=>{
    const r=work.ratings?.[key];
    const valid=r && Number.isFinite(r.score) && r.score >= 0 && r.score <= scale && r.votes > 0;
    return `<div class="rating-row"><div class="rating-heading">${link(r?.url??(key==='vndb'?work.source:null),name)}<span class="rating-value">${valid?(scale===100?Number(r.score).toFixed(0):Number(r.score).toFixed(2).replace(/0$/,'')).replace(/\.0$/,''):'—'}<small> / ${scale}</small></span></div><p>${valid?`${Number(r.votes).toLocaleString('zh-CN')} 人评分 · ${e(r.metric??'站点评分')}`:'暂无可核实评分'}</p>${valid?`<p class="rating-source">${r.viaUrl?link(r.viaUrl,r.via??'资料快照'):e(r.via??'原站')} · ${e(r.fetchedAt?.slice(0,10)??'日期未知')}</p>`:''}</div>`;
  }).join('')}<p class="rating-footnote">按各站原始量表展示，未合成总分。</p></aside>`;
}
export function renderDescription(work) {
  const chinese=work.descriptionLanguage==='中文' && /\p{Script=Han}/u.test(work.description??'');
  const copy=chinese?`<p class="body-copy">${e(work.description).replace(/\n/g,'<br>')}</p><p class="attribution">${e(work.descriptionSourceName??'中文介绍')}${work.descriptionMachine?' · 来源含机器翻译':''} · ${link(work.descriptionSource??work.source,'查看资料来源')}</p>`:`<p class="body-copy muted">中文故事简介仍待补全。${link(work.community?.kungal?.url??work.source,'查看作品资料')}</p>`;
  return `<div class="story-with-ratings"><div class="story-copy">${copy}</div>${renderRatings(work)}</div>`;
}
export function renderGallery(work) {
  const images=(work.screenshots??[]).filter(s=>safeUrl(s.url));
  if(!images.length)return '<p class="muted">暂时没有适合展示的 CG 或截图。</p>';
  return `<details class="gallery-group"><summary><span>${images.length} 张游戏画面 · 可能涉及剧情</span><span class="gallery-open-label">查看全部画面</span><span class="gallery-close-label">收起全部画面</span></summary><div class="gallery-row">${images.map((s,i)=>`<figure><a class="gallery-full-image" href="${e(s.url)}" target="_blank" rel="noopener noreferrer" aria-label="打开第${i+1}张游戏画面原图"><img data-gallery-src="${e(s.url)}" alt="${e(work.title)} 游戏画面 ${i+1}" loading="lazy" referrerpolicy="no-referrer"></a><figcaption>${e(s.source??'VNDB')} · ${e(s.credit??'画面版权归游戏权利人所有')}</figcaption></figure>`).join('')}</div></details>`;
}
