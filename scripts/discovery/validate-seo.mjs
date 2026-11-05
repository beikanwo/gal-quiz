import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readJson} from './io.mjs';
const {origin}=await readJson('config/discovery.json'),seo=await readJson('config/seo.json');
const state=await readJson('data/discovery/seo-state.json'),sitemap=await readFile('site/sitemap.xml','utf8');
const locations=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
assert.equal(new Set(locations).size,locations.length,'站点地图重复网址');
const titles=new Map();let pages=0;
for(const [url,entry]of Object.entries(state.pages)){
  const route=url.slice(origin.length+1),html=await readFile(`site/${route}index.html`,'utf8');pages++;
  assert.ok(html.includes(`<link rel="canonical" href="${url}">`),`规范网址错误 ${url}`);
  const title=html.match(/<title>([^<]+)<\/title>/)?.[1];assert.ok(title,`缺少标题 ${url}`);
  // Same-name editions legitimately share the displayed game title; route identity is canonical.
  if(!route.startsWith('works/')&&!route.startsWith('staff/')&&!route.startsWith('producers/')){assert.ok(!titles.has(title),`目录标题重复 ${url}`);titles.set(title,url);}
  assert.ok(html.match(/<meta name="description" content="[^"]+"/),`缺少描述 ${url}`);
  for(const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))JSON.parse(match[1]);
  if(!['quiz/','beginners/'].includes(route))assert.equal((html.match(/<h1(?:\s[^>]*)?>/g)??[]).length,1,`主标题数量错误 ${url}`);
  assert.equal(locations.includes(url),entry.indexable,`索引与站点地图不一致 ${url}`);
  if(!entry.indexable)assert.ok(html.includes('noindex,follow'),`缺少noindex ${url}`);
  assert.ok(Number.isFinite(Date.parse(entry.lastmod)),'无效更新时间');
}
assert.equal((await readFile(`site/${seo.indexNowKeyFile}`,'utf8')).trim(),seo.indexNowKey);
assert.ok((await readFile('site/robots.txt','utf8')).includes(`Sitemap: ${origin}/sitemap.xml`));
console.log(`SEO校验通过：${pages}页、${locations.length}个规范可索引网址。`);
