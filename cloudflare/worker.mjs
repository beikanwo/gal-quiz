// www.scurra.top 的 HTTPS 入口。固定读取 GitHub Pages 的静态文件，推荐逻辑仍在浏览器运行。
const ORIGIN = 'https://beikanwo.github.io/gal-quiz/';
const FILES = new Set(['', 'index.html', 'app.js', 'engine.js', 'style.css', 'robots.txt', 'sitemap.xml', 'data/vns.json', 'data/quiz.json']);

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
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const file = url.pathname.slice(1);
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
