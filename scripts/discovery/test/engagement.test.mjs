import test from 'node:test';
import assert from 'node:assert/strict';
import { observe,buildSignals,baseline,ageBucket } from '../engagement.mjs';
import { biliEngagement } from '../engagement-records.mjs';
import { trialPeriods } from '../run-engagement.mjs';
const settings={hotMinLikes:500,favoritesMin:50,douyinFavoriteLikeRatio:.3,bilibiliViewsMin:1000,bilibiliFavoriteViewRatio:.02,commentsMin:30};
const period={start:'2026-11-01T00:00:00Z',end:'2026-11-06T00:00:00Z'};
const r=(change={})=>({platform:'douyin',id:'123',url:'https://www.douyin.com/video/123',title:'《测试作品》游戏CG',likes:500,publishedAt:'2026-11-02T00:00:00Z',collectedAt:'2026-11-04T00:00:00Z',workId:'v1',kind:'video',durationSeconds:60,author:{id:'1'},metrics:{favorites:100,comments:30,shares:4,views:null,coins:null},...change});
test('真实零值不变成缺失，缺失或负数不补零',()=>{
  const b=biliEngagement({owner:{mid:12,name:'作者'},stat:{favorite:0,reply:-1,view:1000}});
  assert.equal(b.metrics.favorites,0);assert.equal(b.metrics.comments,null);assert.equal(b.metrics.coins,null);assert.equal(b.author.id,'12');
});
test('同账号拆条只算一个账号；不同平台不合并；缺失作者不编造账号',()=>{
  const result=buildSignals([r(),r({id:'124',url:'https://www.douyin.com/video/124'}),r({id:'125',url:'https://www.douyin.com/video/125',author:{id:'2'}}),r({id:'126',url:'https://www.douyin.com/video/126',author:null}),r({platform:'bilibili',id:'BV123',url:'https://www.bilibili.com/video/BV123'})],period,settings);
  assert.equal(result.popular.length,2);assert.equal(result.popular[0].authorCount,2);assert.equal(result.popular[0].missingAuthors,1);assert.equal(result.popular[0].concentration,null);
});
test('低赞内容进入收藏信号，比例分母和边界按平台独立处理',()=>{
  assert.equal(buildSignals([r({likes:100,metrics:{favorites:50}})],period,settings).favorites.length,1);
  assert.equal(buildSignals([r({likes:499,metrics:{favorites:50}})],period,settings).favorites.length,0);
  assert.equal(buildSignals([r({likes:0,metrics:{favorites:50}})],period,settings).watch.length,1);
  const b=r({platform:'bilibili',id:'BV123',url:'https://www.bilibili.com/video/BV123',likes:100,metrics:{favorites:50,views:2500}});
  assert.equal(buildSignals([b],period,settings).favorites.length,1);
  assert.equal(buildSignals([{...b,metrics:{favorites:50,views:2501}}],period,settings).favorites.length,0);
  assert.equal(buildSignals([{...b,metrics:{favorites:50,views:null}}],period,settings).favorites.length,0);
});
test('新发布和评论型内容先观察或人工核对，不把评论直接判成好评',()=>{
  const recent=r({likes:100,collectedAt:'2026-11-02T10:00:00Z'});
  const result=buildSignals([recent],period,settings);assert.equal(result.favorites.length,0);assert.equal(result.watch.length,1);assert.equal(result.discussion.length,0);assert.equal(result.review.length,1);
});
test('基线使用真实同龄快照，至少8条；不把旧视频现在的累计数倒算成历史',()=>{
  const target=r({publishedAt:'2026-11-02T00:00:00Z',collectedAt:'2026-11-03T00:00:00Z'});
  const refs=Array.from({length:8},(_,i)=>{const sample=r({id:String(200+i),likes:100,publishedAt:new Date(Date.parse(target.publishedAt)-(i+1)*86400000).toISOString(),collectedAt:new Date(Date.parse(target.collectedAt)-(i+1)*86400000).toISOString()});return {record:sample,ageSnapshots:{day1:sample}}});
  const post={record:target,ageSnapshots:{day1:target}};
  assert.equal(baseline(post,refs).metrics.likes.ratio,5);
  assert.equal(baseline(post,refs.slice(0,7)).status,'insufficient');
  assert.equal(baseline({record:target},refs).status,'insufficient');
  assert.equal(ageBucket(r()),null);
});
test('证据身份始终复核，关键词误匹配不进入作者观测',()=>{
  const state={};observe(state,[r({title:'女王自称是你的妻子 游戏实况'})],{v1:{id:'v1',title:'另一个作品',aliases:['妻子']}});
  assert.equal(Object.keys(state.posts).length,0);assert.equal(Object.keys(state.identityPending).length,1);
});
test('比较视频不因为仅识别到其中一部就归入该作品',()=>{
  const state={};observe(state,[r({title:'晦涩程度对比：测试作品VS另一游戏 #galgame'})],{v1:{id:'v1',title:'测试作品'}});
  assert.equal(Object.keys(state.posts).length,0);assert.equal(Object.keys(state.identityPending).length,1);
});
test('两期窗口固定，以北京时间结束，不改正式快照',()=>{
  const p=trialPeriods({firstPeriod:'2026-11-06',intervalDays:5,trialPeriods:2});
  assert.equal(p[0].start,'2026-10-31T16:00:00.000Z');assert.equal(p[1].id,'2026-11-11');assert.equal(p[1].supplementUntil,'2026-11-12T16:00:00.000Z');
});
