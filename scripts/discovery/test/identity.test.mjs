import test from 'node:test';
import assert from 'node:assert/strict';
import { matchWork } from '../core.mjs';
import { applyKunMetadata } from '../community.mjs';
import { refreshIdentityNames, canonicalWorks } from '../identity-names.mjs';
test('社区关键词不能成为作品名；旧目录内污染的aliases也不能用于自动识别',()=>{
  const work={id:'v10078',title:'愛する妻、真理子が隣室で抱かれるまで',aliases:['妻子','公司','NTR']};
  const record={platform:'douyin',id:'7698635646419619107',title:'《铅雨》是一款2D像素动作游戏。一位女王自称是你的妻子。#游戏实况',tags:['游戏实况']};
  assert.equal(matchWork(record,{v10078:work}).status,'pending');
  applyKunMetadata(work,{id:'4671',display_name:work.title,external_refs:[{site:'vndb',external_id:work.id}],aliases:['妻子','公司','NTR'],localized:{'zh-Hans':{value:'爱妻',is_machine:true}}});
  assert.ok(!work.matchingAliases.includes('妻子'));assert.ok(!work.matchingAliases.includes('爱妻'));
  assert.ok(!work.aliases.includes('公司'));assert.ok(work.aliases.includes('爱妻'));
  assert.equal(matchWork(record,{v10078:work}).status,'pending');
});
test('短名称出现在普通句子中须核对，明确标注完整标题才能识别',()=>{
  const games={v2561:{id:'v2561',title:'こくはく',matchingAliases:['告白']}};
  assert.equal(matchWork({title:'雨宫美亚的告白 游戏CG'},games).status,'pending');
  assert.equal(matchWork({title:'《告白》游戏CG'},games).workId,'v2561');
});
test('副标题不能只因含有本篇名就自动归到本篇',()=>{
  const games={v30960:{id:'v30960',title:'Mycorrhiza',matchingAliases:['Mycorrhiza']}};
  assert.equal(matchWork({title:'【Mycorrhiza:Pet】视觉小说解说'},games).status,'pending');
  const result=matchWork({title:'《Mycorrhiza》视觉小说'},games);
  assert.equal(result.workId,'v30960');assert.deepEqual(result.matchedNames,['Mycorrhiza']);
});
test('名称重建清除旧关键词，正规名称和已核实的合并版本名称仍可使用',()=>{
  const w={id:'v1',title:'本篇',vndbNames:['Original Game'],aliases:['公司','妻子']};refreshIdentityNames(w);
  assert.ok(!w.aliases.includes('妻子'));
  const games=canonicalWorks({v1:w,v2:{id:'v2',title:'重制本篇',matchingAliases:['Original Game Remake']}},new Map([['v2','v1']]));
  assert.equal(matchWork({title:'《Original Game Remake》游戏CG'},games).workId,'v1');
});
