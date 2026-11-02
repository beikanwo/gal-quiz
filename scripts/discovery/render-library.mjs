export const libraryPath = (kind, page = 1) => `library/${kind}/${page > 1 ? `${page}/` : ''}`;
export const roleWorks = (person, role) => [...new Set((person.works ?? []).filter(w => w.roles?.includes(role)).map(w => w.id))];
export function paginate(items, page, size) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.max(1, Math.min(pages, Number.isInteger(Number(page)) ? Number(page) : 1));
  return { current, pages, items: items.slice((current - 1) * size, current * size) };
}
export function renderPagination(total, page, size, kind, esc) {
  const { current, pages } = paginate(Array.from({ length: total }), page, size);
  const href = n => `@@ROOT@@${libraryPath(kind, n)}`;
  const numbers = [...new Set([1, current - 1, current, current + 1, pages])].filter(n => n > 0 && n <= pages).sort((a,b) => a-b);
  let previous = 0;
  const links = numbers.map(n => { const gap = previous && n - previous > 1 ? '<span>…</span>' : ''; previous = n; return `${gap}<a href="${href(n)}"${n === current ? ' aria-current="page"' : ''}>${n}</a>`; }).join('');
  return `<div class="directory-pagination"><p class="page-summary" role="status">共 ${total.toLocaleString('zh-CN')} 项 · 第 ${current} / ${pages} 页</p><nav aria-label="分页">${current > 1 ? `<a rel="prev" href="${href(current - 1)}">‹ 上一页</a>` : '<span aria-disabled="true">‹ 上一页</span>'}${links}${current < pages ? `<a rel="next" href="${href(current + 1)}">下一页 ›</a>` : '<span aria-disabled="true">下一页 ›</span>'}</nav><form class="directory-jump" data-directory-jump><label>跳至 <input aria-label="页码" type="number" min="1" max="${pages}" value="${current}" required> 页</label><button type="submit">跳转</button></form></div>`;
}
export async function emitLibrary({ catalog, page, card, esc, writeJson }) {
  const works = Object.values(catalog.works), people = Object.values(catalog.staff), producers = Object.values(catalog.producers);
  const personCard = (p, role) => {
    const ids = role ? roleWorks(p, role) : [...new Set((p.works ?? []).map(w => w.id))];
    const samples = ids.map(id => catalog.works[id]).filter(Boolean).sort((a,b) => (b.ratings?.vndb?.votes ?? 0) - (a.ratings?.vndb?.votes ?? 0)).slice(0,2).map(w => w.title);
    const producer = !role;
    return `<a class="directory-person" href="@@ROOT@@${producer ? 'producers' : 'staff'}/${p.id}/"><span class="directory-avatar${producer ? ' producer' : ''}" aria-hidden="true">${esc(p.name.slice(0,1))}</span><div><h3>${esc(p.name)}</h3><p>${ids.length} 部${role === 'scenario' ? '剧本参与' : role === 'art' ? '原画参与' : '资料库收录'}作品</p><small>${esc(samples.join(' / '))}</small></div><span class="person-arrow" aria-hidden="true">↗</span></a>`;
  };
  const datasets = {
    works: { title: '作品', unit: '部', size: 25, entries: works.map(w => ({ name: w.title, aliases: [w.original,...(w.aliases ?? [])], released: w.released ?? '', html: card(w) })) },
    writers: { title: '剧本家', unit: '位', size: 12, entries: people.filter(p => roleWorks(p,'scenario').length).sort((a,b) => roleWorks(b,'scenario').length - roleWorks(a,'scenario').length).map(p => ({ name:p.name, aliases:p.aliases ?? [], count:roleWorks(p,'scenario').length, html:personCard(p,'scenario') })) },
    artists: { title: '原画师', unit: '位', size: 12, entries: people.filter(p => roleWorks(p,'art').length).sort((a,b) => roleWorks(b,'art').length - roleWorks(a,'art').length).map(p => ({ name:p.name, aliases:p.aliases ?? [], count:roleWorks(p,'art').length, html:personCard(p,'art') })) },
    producers: { title:'制作商', unit:'家', size:12, entries:producers.sort((a,b) => b.works.length - a.works.length).map(p => ({ name:p.name, aliases:p.aliases ?? [], count:new Set(p.works.map(w => w.id)).size, html:personCard(p) })) }
  };
  const heading = (title, count, href, label = '查看全部') => `<div class="library-section-heading"><h2>${title}<span>${count}</span></h2><a class="directory-more" href="@@ROOT@@${href}">${label} ↗</a></div>`;
  const previewPeople = (kind, ids) => { const data = datasets[kind].entries; return ids.map(id => data.find(e => e.html.includes(`/${id}/`))).filter(Boolean).concat(data).filter((e,i,a) => a.indexOf(e) === i).slice(0,4).map(e => e.html).join(''); };
  await page('library/', '作品与创作者', '从作品找到剧本家、原画师和制作商，浏览资料库收录的相关游戏。', `<div class="library-content"><div class="page-heading"><p class="eyebrow">资料库</p><h1>作品与创作者</h1><p>从一部喜欢的作品，继续认识写故事、画角色的人。</p></div><section class="library-section">${heading('作品资料',`${works.length.toLocaleString('zh-CN')} 部`,libraryPath('works'),'查看更多')}<div class="work-grid library-overview">${works.slice(0,10).map(w => card(w)).join('')}</div></section><section class="library-section">${heading('剧本家',`${datasets.writers.entries.length} 位`,libraryPath('writers'))}<div class="people-preview">${previewPeople('writers',['s548','s545','s820','s3580'])}</div></section><section class="library-section">${heading('原画师',`${datasets.artists.entries.length} 位`,libraryPath('artists'))}<div class="people-preview">${previewPeople('artists',['s722','s2884','s1223','s1804'])}</div></section><section class="library-section">${heading('制作商',`${producers.length} 家`,libraryPath('producers'))}<div class="people-preview">${datasets.producers.entries.slice(0,4).map(e => e.html).join('')}</div></section></div>`, 'library');
  for (const [kind, data] of Object.entries(datasets)) {
    const pages = Math.max(1,Math.ceil(data.entries.length / data.size));
    for (let n = 1; n <= pages; n++) {
      const tabs = ['writers','artists'].includes(kind) ? `<nav class="directory-tabs" aria-label="创作者岗位"><a href="@@ROOT@@${libraryPath('writers')}"${kind === 'writers' ? ' aria-current="page"' : ''}>剧本家</a><a href="@@ROOT@@${libraryPath('artists')}"${kind === 'artists' ? ' aria-current="page"' : ''}>原画师</a></nav>` : '';
      const sort = kind === 'works' ? '<option value="default">收录顺序</option><option value="released">发行时间</option>' : '<option value="default">参与作品数</option>';
      await page(libraryPath(kind,n), `全部${data.title}${n > 1 ? ` · 第${n}页` : ''}`, `浏览资料库收录的全部${data.title}，第${n}页。`, `<div class="library-content" data-directory="${kind}" data-directory-page="${n}"><div class="page-heading"><a class="back-link" href="@@ROOT@@library/">作品与创作者 /</a><h1>全部${data.title}</h1><p>共 ${data.entries.length.toLocaleString('zh-CN')} ${data.unit}，每页 ${data.size} ${data.unit}。${['writers','artists'].includes(kind) ? '参与作品按当前岗位统计。' : ''}</p></div><div class="directory-toolbar">${tabs}<form class="directory-search" role="search"><input name="q" aria-label="${kind === 'works' ? '搜索中文名、原名或别名' : '搜索姓名或别名'}" placeholder="${kind === 'works' ? '搜索中文名、原名或别名' : '搜索名称或别名'}"><button type="submit" aria-label="搜索当前目录">搜索</button></form><span class="keyboard-hint"><kbd>←</kbd><kbd>→</kbd> 快捷翻页</span><select aria-label="排序" class="directory-sort">${sort}<option value="name">名称排序</option></select></div><p class="directory-status" role="status" hidden></p><div class="${kind === 'works' ? 'work-grid library-catalog' : 'people-directory'}" data-directory-results>${data.entries.slice((n-1)*data.size,n*data.size).map(e => e.html).join('') || '<p class="muted">暂时没有收录资料。</p>'}</div><div data-directory-pagination>${renderPagination(data.entries.length,n,data.size,kind,esc)}</div></div>`, 'library');
    }
  }
  await writeJson('site/data/library.json', { version:1, datasets });
}
