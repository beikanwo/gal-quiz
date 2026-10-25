// www.scurra.top 的 HTTPS 入口。固定读取 GitHub Pages 的静态文件，推荐逻辑仍在浏览器运行。
const ORIGIN = 'https://beikanwo.github.io/gal-quiz/';
const FILES = new Set(['', 'index.html', 'beginners/index.html', 'app.js', 'engine.js', 'feedback.js', 'style.css', 'robots.txt', 'sitemap.xml', 'data/vns.json', 'data/quiz.json']);

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
});

export async function submitFeedback(request, env) {
  if (request.method !== 'POST') return json({ error: '请通过网站上的反馈表单提交。' }, 405, { Allow: 'POST' });
  if (request.headers.get('Origin') !== 'https://www.scurra.top') return json({ error: '请从网站重新打开反馈。' }, 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: '提交格式不正确。' }, 415);
  if (Number(request.headers.get('Content-Length')) > 8192) return json({ error: '内容太长了，请精简后再试。' }, 413);
  let data;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: '请填写反馈内容。' }, 400);
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return json({ error: '内容太长了，请精简后再试。' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return json({ error: '提交格式不正确，请刷新后重试。' }, 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: '提交格式不正确。' }, 400);
  if (data.website) return json({ error: '请刷新页面后重试。' }, 400);
  const kinds = ['问题反馈', '推荐不合口味', '资料纠错', '功能建议', '其他'];
  const message = typeof data.message === 'string' ? data.message.trim() : '';
  const contact = typeof data.contact === 'string' ? data.contact.trim() : '';
  if (!kinds.includes(data.kind) || message.length < 10 || message.length > 2000 || contact.length > 100) return json({ error: '请填写 10–2000 字的反馈，联系方式最多 100 字。' }, 400);
  if (!/^[0-9a-f-]{36}$/i.test(data.requestId ?? '')) return json({ error: '请重新打开反馈表单。' }, 400);
  if (!env.FEEDBACK) return json({ error: '反馈暂时无法接收，请稍后重试。' }, 503);
  try {
    const id = data.requestId;
    // 同一次提交重试使用相同 ID，不重复保存。
    if (await env.FEEDBACK.get(`feedback:${id}`)) return json({ ok: true, id });
    // 只保存短期摘要用于限频，不保存原始 IP、浏览器指纹或完整答题记录。
    const ip = request.headers.get('CF-Connecting-IP');
    let rateKey;
    if (ip) {
      const hour = Math.floor(Date.now() / 3600000);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${hour}:${ip}`));
      rateKey = 'rate:' + Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
      if (await env.FEEDBACK.get(rateKey)) return json({ error: '提交得有点快，请等一分钟再试。' }, 429, { 'Retry-After': '60' });
    }
    const createdAt = new Date().toISOString();
    const context = data.context && typeof data.context === 'object' ? {
      screen: ['start', 'quiz', 'dealbreakers', 'result', 'wants'].includes(data.context.screen) ? data.context.screen : null,
      works: Array.isArray(data.context.works) ? [...new Set(data.context.works.filter((x) => typeof x === 'string' && /^v\d+$/.test(x)))].slice(0, 3) : [],
    } : null;
    const record = { id, createdAt, kind: data.kind, message, contact, context, version: 1 };
    await env.FEEDBACK.put(`feedback:${id}`, JSON.stringify(record), { metadata: { createdAt, kind: data.kind } });
    // 反馈已经落库后，限频记录的临时错误不能让用户误以为内容丢失。
    if (rateKey) await env.FEEDBACK.put(rateKey, '1', { expirationTtl: 60 }).catch(() => {});
    return json({ ok: true, id }, 201);
  } catch { return json({ error: '暂时没有保存成功，内容还在，请稍后重试。' }, 503); }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 保留旧推广链接的路径和查询参数，将入口统一到正式域名。
    if (url.hostname === 'gal.scurra.top') {
      url.hostname = 'www.scurra.top';
      url.protocol = 'https:';
      return Response.redirect(url.href, 301);
    }
    if (url.protocol !== 'https:') {
      url.protocol = 'https:';
      return Response.redirect(url.href, 308);
    }
    if (url.pathname === '/api/feedback') return submitFeedback(request, env);
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    // 专题页统一使用带斜杠的网址，避免回源触发 GitHub Pages 的目录跳转。
    if (url.pathname === '/beginners' || url.pathname === '/beginners/index.html') {
      url.pathname = '/beginners/';
      return Response.redirect(url.href, 301);
    }
    const file = url.pathname === '/beginners/' ? 'beginners/index.html' : url.pathname.slice(1);
    if (!FILES.has(file)) return new Response('Not found', { status: 404 });

    // 只让文件版本参与缓存，推广链接上的来源参数不会产生重复缓存。
    const keyUrl = new URL(url.origin + '/' + file);
    const version = url.searchParams.get('v');
    if (version) keyUrl.searchParams.set('v', version);
    const key = new Request(keyUrl.href);
    const cache = caches.default;
    let response = await cache.match(key);
    const hit = Boolean(response);
    if (!response) {
      const target = new URL(file, ORIGIN);
      if (version) target.searchParams.set('v', version);
      let upstream;
      try {
        // 不转发 Cookie 和认证信息；固定源站，保留正常的 TLS 证书验证。
        upstream = await fetch(target.href, { redirect: 'manual' });
      } catch {
        return new Response('网站暂时连接不上，请稍后重试。', { status: 502 });
      }
      if (upstream.status >= 300 && upstream.status < 400) {
        return new Response('网站源站仍在切换，请稍后重试。', { status: 502 });
      }
      const headers = new Headers(upstream.headers);
      headers.delete('set-cookie');
      headers.set('Cache-Control', upstream.ok ? 'public, max-age=60, s-maxage=300' : 'no-store');
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      response = new Response(upstream.body, { status: upstream.status, headers });
      if (upstream.ok) ctx.waitUntil(cache.put(key, response.clone()));
    }
    const headers = new Headers(response.headers);
    headers.set('X-Gal-Cache', hit ? 'HIT' : 'MISS');
    headers.set('X-Gal-Edge', 'cloudflare');
    if (headers.has('ETag') && request.headers.get('If-None-Match') === headers.get('ETag')) {
      headers.delete('Content-Length');
      return new Response(null, { status: 304, headers });
    }
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
  },
};
