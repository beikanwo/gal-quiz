const root = new URL('./', import.meta.url);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const normalize = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\p{S}\s]/gu, '');
const url = new URL(location.href);
// Keep old quiz entry URLs and interrupted quiz sessions usable at the old root.
if (url.pathname === root.pathname) {
  let resume = false;
  try { const s = JSON.parse(sessionStorage.getItem('galquiz.session') ?? 'null'); resume = ['quiz', 'dealbreakers', 'result', 'wants'].includes(s?.screen) && !sessionStorage.getItem('galdiscovery.quiz-migrated'); } catch {}
  const legacy = ['result', 'wants', 'quiz', 'dealbreakers'].includes(url.hash.slice(1)) || ['result', 'answers', 'quiz'].some((key) => url.searchParams.has(key));
  if (resume || legacy) {
    try { sessionStorage.setItem('galdiscovery.quiz-migrated', 'true'); } catch {}
    location.replace(new URL(`quiz/${url.search}${url.hash}`, root));
  }
}
for (const controls of document.querySelectorAll('[data-rail-controls]')) {
  const rail = document.getElementById(controls.dataset.railControls);
  if (!rail) continue;
  const previous = controls.querySelector('[data-rail-direction="-1"]');
  const next = controls.querySelector('[data-rail-direction="1"]');
  const update = () => {
    const end = Math.max(0, rail.scrollWidth - rail.clientWidth);
    previous.disabled = rail.scrollLeft <= 1;
    next.disabled = rail.scrollLeft >= end - 1;
  };
  controls.hidden = false;
  for (const button of [previous, next]) button.addEventListener('click', () => {
    const card = rail.querySelector('.work-card');
    const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
    const stride = (card?.getBoundingClientRect().width ?? rail.clientWidth) + gap;
    const visible = Math.max(1, Math.floor((rail.clientWidth + gap) / stride));
    rail.scrollBy({ left: Number(button.dataset.railDirection) * visible * stride, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });
  rail.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(rail);
  update();
}
for (const gallery of document.querySelectorAll('.gallery-group')) {
  gallery.addEventListener('toggle', () => {
    if (!gallery.open) return;
    for (const image of gallery.querySelectorAll('[data-gallery-src]')) {
      image.src = image.dataset.gallerySrc;
      delete image.dataset.gallerySrc;
    }
  });
}
document.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement && e.target.closest('.cover')) e.target.closest('.cover').classList.add('image-missing'); }, true);
const status = document.getElementById('search-status');
if (status) {
  let entries = [];
  let type = 'all';
  const input = document.querySelector('.search input');
  input.value = url.searchParams.get('q') ?? '';
  const results = document.getElementById('search-results');
  const render = () => {
    const q = normalize(input.value.trim());
    const found = entries.filter((e) => (type === 'all' || e.type === type) && (!q || [e.name, ...(e.aliases ?? [])].some((s) => normalize(s).includes(q))));
    status.textContent = found.length ? `${input.value.trim() ? `“${input.value.trim()}” · ` : ''}找到 ${found.length} 项` : '没有找到对应结果。试试原名、其他别名，或缩短关键词。';
    results.innerHTML = found.slice(0, 100).map((e) => {
      const href = new URL(e.path, root).href;
      if (e.type !== 'work') return `<a class="search-person" href="${esc(href)}"><span class="person-placeholder">${esc(e.name.slice(0, 1))}</span><h3>${esc(e.name)}</h3><p>${esc(e.subtitle)}</p></a>`;
      return `<article class="work-card"><a href="${esc(href)}"><div class="cover">${e.image && /^https:\/\//.test(e.image) ? `<img src="${esc(e.image)}" alt="${esc(e.name)}封面" loading="lazy" referrerpolicy="no-referrer">` : `<span class="cover-fallback">${esc(e.name)}</span>`}</div><h3>${esc(e.name)}</h3><p>${esc(e.subtitle)}</p></a></article>`;
    }).join('');
    if (found.length > 100) status.textContent += '，当前显示前100项，请输入更具体的名字。';
  };
  try {
    const response = await fetch(new URL('data/discovery.json', root));
    if (!response.ok) throw new Error();
    entries = (await response.json()).entries;
    render();
    document.querySelector('.search').addEventListener('submit', (e) => {
      e.preventDefault();
      const next = new URL(location.href); next.searchParams.set('q', input.value.trim()); history.replaceState(null, '', next); render();
    });
    for (const filter of document.querySelectorAll('[data-type]')) {
      filter.setAttribute('aria-pressed', String(filter.dataset.type === type));
      filter.addEventListener('click', () => { type = filter.dataset.type; for (const f of document.querySelectorAll('[data-type]')) { f.classList.toggle('active', f === filter); f.setAttribute('aria-pressed', String(f === filter)); } render(); });
    }
  } catch { status.textContent = '搜索资料暂时加载失败，请刷新重试；你仍可通过“作品与创作者”浏览。'; }
}
const dialog = document.getElementById('correction');
const form = document.getElementById('correction-form');
document.querySelector('[data-correct]')?.addEventListener('click', () => dialog.showModal());
let requestId = null;
let lastPayload = '';
let busy = false;
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy || !form.reportValidity()) return;
  const message = form.elements.message.value.trim();
  const note = form.querySelector('[role=status]');
  if (message.length < 10) { note.textContent = '请填写至少10个字，方便核对。'; return; }
  const payload = { kind: '资料纠错', message, contact: form.elements.contact.value.trim(), website: '' };
  const fingerprint = JSON.stringify(payload);
  if (fingerprint !== lastPayload || !requestId) { requestId = crypto.randomUUID(); lastPayload = fingerprint; }
  const button = form.querySelector('[type=submit]');
  busy = true; button.disabled = true; note.textContent = '正在发送…';
  try {
    const response = await fetch(new URL('api/feedback', root), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, requestId }), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || '没有保存成功，请稍后重试。');
    note.textContent = '已收到，谢谢你帮忙核对。'; form.reset(); requestId = null;
  } catch (error) { note.textContent = error.name === 'Error' ? error.message : '没有保存成功，内容还在，可以稍后重试。'; }
  finally { busy = false; button.disabled = false; }
});
