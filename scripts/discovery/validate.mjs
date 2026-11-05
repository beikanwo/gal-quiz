import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { readJson } from './io.mjs';
import { qualifies, canonicalEvidenceUrl, rankEvidence, matchWork } from './core.mjs';
import { canonicalWorks } from './identity-names.mjs';
import { isAllowedFile } from '../../cloudflare/worker.mjs';
const catalog = await readJson('data/discovery/catalog.json');
const periods = await readJson('data/discovery/periods.json');
const manifest = await readJson('site/discovery-manifest.json');
const root = path.resolve('site');
const overrides=await readJson('config/discovery-overrides.json');
const canonical=new Map();for(const w of await readJson('site/data/vns.json',[]))for(const id of w.altIds??[])canonical.set(id,w.id);
const identities=canonicalWorks(catalog.works,canonical);
for (const file of manifest.files) {
  assert.ok(isAllowedFile(file), `边缘入口没有允许 ${file}`);
  await access(path.join(root, file));
  if (!file.endsWith('.html')) continue;
  const html = await readFile(path.join(root, file), 'utf8');
  assert.ok(!html.includes('@@ROOT@@'), `${file} 残留模板标记`);
  assert.ok(html.includes('<h1>') || file === 'quiz/index.html' || file === 'beginners/index.html', `${file} 缺少标题`);
  for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const url = match[1].split(/[?#]/)[0];
    if (/^(https?:|mailto:|data:)/.test(url)) continue;
    const target = path.resolve(path.dirname(path.join(root, file)), url);
    assert.ok(target.startsWith(root + path.sep) || target === root, `路径越界 ${file}: ${url}`);
    await access(url.endsWith('/') ? path.join(target, 'index.html') : target);
  }
}
for (const period of periods.periods) for (const [platform, data] of Object.entries(period.platforms)) {
  const records = data.ranking.flatMap((r) => r.evidence ?? []);
  for (const r of records) {
    assert.equal(r.platform, platform);
    assert.equal(r.url, canonicalEvidenceUrl(platform, r.id, r.kind));
    assert.ok(catalog.works[r.workId], `片段引用不存在作品 ${r.workId}`);
    assert.ok(qualifies(r, data.start ? data : period, data.minLikes ?? period.minLikes), `片段不符合所属期次 ${r.id}`);
    const identity=matchWork(r,identities,overrides);
    assert.ok(identity.status==='matched'&&identity.workId===r.workId,`来源身份复核未通过 ${platform}:${r.id}`);
  }
  assert.deepEqual(data.ranking, rankEvidence(records), '排名或去重不正确');
}
for (const w of Object.values(catalog.works)) {
  assert.ok((w.screenshots?.length ?? 0) <= 6);
  for (const s of w.screenshots ?? []) assert.equal(typeof s.spoiler, 'boolean');
}
const app = await readFile('site/app.js', 'utf8');
for (const key of ['galquiz.played', 'galquiz.notInterested', 'galquiz.want', 'galquiz.session']) assert.ok(app.includes(key));
assert.ok(app.includes('fetch(new URL(u, import.meta.url))'), '问卷数据路径必须相对根模块解析');
const publicData = await readFile('site/data/discovery.json', 'utf8');
assert.ok(!/DOUYIN_COOKIE|BILIBILI_COOKIE|SESSDATA|msToken|sessionid/i.test(publicData), '公开数据含有登录材料');
const interaction=await readJson('site/data/engagement.json',{preview:null,reports:[]});
for(const report of [interaction.preview,...interaction.reports].filter(Boolean))for(const [platform,data]of Object.entries(report.platforms)){
  for(const kind of ['popular','favorites','discussion','watch','review'])for(const item of data[kind]??[])for(const record of item.evidence){
    assert.equal(record.platform,platform,'影子数据混合了平台');
    assert.ok(qualifies(record,report.period,0),'影子证据超出原投稿范围或数值无效');
    const identity=matchWork(record,identities,overrides);
    assert.ok(identity.status==='matched'&&identity.workId===item.workId,'影子证据的作品身份未通过');
    for(const value of Object.values(record.metrics??{}))assert.ok(value===null||Number.isSafeInteger(value)&&value>=0,'互动指标不能伪造零或保留无效数值');
  }
}
assert.ok(!/DOUYIN_COOKIE|BILIBILI_COOKIE|SESSDATA|msToken|sessionid/i.test(JSON.stringify(interaction)),'影子页面含有登录材料');
console.log(`校验通过：${manifest.files.length} 个路由、${Object.keys(catalog.works).length} 部作品、${periods.periods.length} 期及问卷兼容。`);
await import('./validate-seo.mjs');
