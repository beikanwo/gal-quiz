import test from 'node:test';
import assert from 'node:assert/strict';
import {metadata,recordPage,sitemapXml} from '../seo.mjs';
import worker from '../../../cloudflare/worker.mjs';
const config={origin:'https://www.scurra.top'};
const catalog={works:{v1:{title:'测试作品',original:'Test VN',descriptionLanguage:'中文',description:'可核实的中文简介。',released:'2000-01-01'}},staff:{},producers:{}};
test('作品元数据使用真实名称和简介；不伪造评分，分页具有独立规范网址',()=>{
  const work=metadata('works/v1/','旧标题','旧介绍',catalog,config);
  assert.ok(work.title.startsWith('测试作品'));assert.ok(work.description.includes('可核实的中文简介'));
  assert.equal(work.structured['@graph'].at(-1)['@type'],'VideoGame');assert.ok(!JSON.stringify(work.structured).includes('aggregateRating'));
  const page=metadata('library/works/2/','','',catalog,config);assert.ok(page.title.includes('第2页'));assert.equal(page.url,'https://www.scurra.top/library/works/2/');
});
test('站内搜索与尚未形成期次的调试页不进入索引；正式资料可索引',()=>{
  assert.equal(metadata('search/','','',catalog,config).indexable,false);
  assert.equal(metadata('signals/','','',catalog,config).indexable,false);
  assert.equal(metadata('signals/','','',catalog,config,{hasReports:true}).indexable,true);
});
test('内容未变化时保持lastmod；变更时更新；站点地图不包含noindex页',()=>{
  const meta=metadata('works/v1/','','',catalog,config),first={};recordPage({},first,meta,'正文','2026-11-05T00:00:00Z');
  const second={};assert.equal(recordPage(first,second,meta,'正文','2026-11-06T00:00:00Z'),false);assert.equal(second[meta.url].lastmod,first[meta.url].lastmod);
  recordPage(second,second,meta,'修改正文','2026-11-07T00:00:00Z');assert.equal(second[meta.url].lastmod,'2026-11-07T00:00:00Z');
  second['https://www.scurra.top/search/']={indexable:false};assert.ok(!sitemapXml(second).includes('/search/'));
});
test('正式域名、首页文件名和目录网址统一且保留推广参数',async()=>{
  for(const [from,to]of [['https://scurra.top/?utm_source=test','https://www.scurra.top/?utm_source=test'],['https://www.scurra.top/index.html','https://www.scurra.top/'],['https://www.scurra.top/works/v1/index.html','https://www.scurra.top/works/v1/']]){
    const response=await worker.fetch(new Request(from),{},{});assert.equal(response.status,301);assert.equal(response.headers.get('Location'),to);
  }
});
