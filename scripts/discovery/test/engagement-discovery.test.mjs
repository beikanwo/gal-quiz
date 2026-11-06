import test from 'node:test';
import assert from 'node:assert/strict';
import { windowRecords,collectionWindow,engagementQueries,resolveEngagementWorks } from '../engagement-discovery.mjs';
import { matchWork } from '../core.mjs';

const window={start:'2026-11-01T00:00:00Z',end:'2026-11-06T00:00:00Z'};
const record=(changes={})=>({platform:'douyin',id:'123',url:'https://www.douyin.com/video/123',
  title:'聊聊《新发现作品》 #galgame',publishedAt:'2026-11-02T00:00:00Z',collectedAt:'2026-11-06T00:00:00Z',likes:0,...changes});

test('验证样本只来自真实窗口，零赞仍采集；边界、重复、伪造链接均正确处理',()=>{
  const good=record();
  assert.deepEqual(windowRecords([good,good,record({publishedAt:window.end}),record({publishedAt:'2026-10-01T00:00:00Z'}),record({url:'https://example.com/'})],window),[good]);
});

test('补充期仍采集完整原投稿窗口，封存后不重新打开；未来期次不进入窗口',()=>{
  const periods=[{id:'first',start:'2026-11-01T00:00:00Z',supplementUntil:'2026-11-08T00:00:00Z'},
    {id:'future',start:'2026-11-11T00:00:00Z',supplementUntil:'2026-11-18T00:00:00Z'}];
  const now=Date.parse('2026-11-07T12:00:00Z');
  assert.equal(collectionWindow(now,periods).start,'2026-11-01T00:00:00.000Z');
  assert.equal(collectionWindow(now,periods,{first:{finalized:true}}).start,'2026-11-02T12:00:00.000Z');
});

test('作品补搜轮换覆盖词表，两平台作品都有机会，不固定前三部',()=>{
  const config={keywords:['galgame'],maxExpansionWorks:4};
  const catalog={works:Object.fromEntries(Array.from({length:12},(_,i)=>[`v${i}`,{title:`作品${i}`}]))};
  const formal={periods:[{platforms:{douyin:{ranking:[{workId:'v0'}]},bilibili:{ranking:[{workId:'v1'}]}}}]};
  const discovery={discoveryQueries:Array.from({length:10},(_,i)=>`作品${i+2}`)};
  const first=engagementQueries(config,discovery,formal,catalog,{},0);
  assert.deepEqual(first,['galgame','作品0','作品1','作品2','作品3']);
  assert.notDeepEqual(engagementQueries(config,discovery,formal,catalog,{},86400000),first);
});

test('未知标题接入资料查询，种子名称必须补成真实资料才能成为公开证据；歧义保持待核对',async()=>{
  const catalog={works:{}},calls=[];
  const seeds={v1:{id:'v1',title:'种子作品'}};
  const metadata={async resolveUnknown(r){calls.push('resolve');if(r.title.includes('新发现作品'))catalog.works.v2={id:'v2',title:'新发现作品',source:'https://vndb.org/v2'};},
    async enrichWork(id){calls.push(id);catalog.works[id]={...seeds[id],source:`https://vndb.org/${id}`};}};
  const records=[record(),record({title:'《种子作品》游戏CG'}),record({title:'《种子作品》和《新发现作品》对比 #galgame'})];
  const result=await resolveEngagementWorks(records,{catalog,seeds,metadata,canonical:new Map(),overrides:{},deadline:Infinity});
  assert.equal(result.resolved,2);
  assert.ok(calls.includes('resolve'));assert.ok(calls.includes('v1'));
  assert.equal(matchWork(records[0],catalog.works).workId,'v2');
  assert.equal(matchWork(records[2],catalog.works).status,'pending');
});

test('资料查询失败或预算用尽，不凭种子名称伪造公开作品',async()=>{
  const catalog={works:{}};
  const options={catalog,seeds:{v1:{id:'v1',title:'种子作品'}},metadata:{async enrichWork(){throw Error('unavailable');}},canonical:new Map(),overrides:{},deadline:Infinity};
  assert.equal((await resolveEngagementWorks([record({title:'《种子作品》游戏CG'})],options)).failures,1);
  assert.deepEqual(catalog.works,{});
  await resolveEngagementWorks([record()],{...options,deadline:0});
  assert.deepEqual(catalog.works,{});
});
