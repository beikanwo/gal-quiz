import test from 'node:test';
import assert from 'node:assert/strict';
import {applyKunMetadata,chineseText} from '../community.mjs';
import {renderRatings,renderDescription,renderGallery} from '../render-details.mjs';
const community={id:'258',external_refs:[{site:'vndb',external_id:'v22636'},{site:'bangumi',external_id:'239680'},{site:'erogamescape',external_id:'26604'}],intros:[{locale:'en',value:'English synopsis'},{locale:'zh-Hans',value:'青年跟随手记走进来待村，被村民当成来访神迎接。',is_machine:false}],external_ratings:[{site:'bangumi',rating_value:7.1,vote_count:1349},{site:'erogamescape',rating_value:80,vote_count:391},{site:'vndb',rating_value:7.44,vote_count:429}]};
test('Chinese community metadata requires explicit VNDB identity and keeps score scales separate',()=>{
 const work={id:'v22636',ratings:{vndb:{score:7.38,scale:10,votes:429,via:'原站'}}};
 assert.equal(applyKunMetadata(work,community,'2026-11-01T00:00:00Z'),true);
 assert.equal(work.descriptionLanguage,'中文');assert.match(work.description,/来待村/);
 assert.equal(work.ratings.vndb.score,7.38);assert.equal(work.ratings.bangumi.score,7.1);assert.equal(work.ratings.erogamescape.scale,100);
 assert.equal(applyKunMetadata({id:'v1'},community),false);
});
test('language detection accepts Chinese with Japanese proper-name annotations, rejects English and Japanese prose',()=>{
 assert.ok(chineseText('这里是来待（きまち）村。青年被村民当成来访神迎接，故事由此展开。'));
 assert.ok(!chineseText('Yukihito visits a strange village after finding a mysterious notebook.'));
 assert.ok(!chineseText('青年はその村に来訪神として迎えられる。ふたりは毎夜交代で伽に参ります。'));
});
test('default story area never falls back to English; unavailable scores are not zero',()=>{
 const w={id:'v1',title:'Test',source:'https://vndb.org/v1',description:'English synopsis',descriptionLanguage:'原文'};
 assert.ok(!renderDescription(w).includes('English synopsis'));
 assert.ok(renderDescription(w).includes('中文故事简介仍待补全'));
 const html=renderRatings(w);assert.equal((html.match(/尚未采集/g)??[]).length,3);
});
test('one gallery toggle reveals a single horizontal row; images have no src until it opens',()=>{
 const w={title:'游戏',screenshots:[1,2,3].map(i=>({url:`https://t.vndb.org/sf/${i}.jpg`,source:'VNDB',spoiler:true}))};
 const html=renderGallery(w);
 assert.equal((html.match(/<details /g)??[]).length,1);
 assert.equal((html.match(/data-gallery-src=/g)??[]).length,3);
 assert.ok(!/<img\s+src=/.test(html));assert.match(html,/gallery-row/);assert.match(html,/查看全部画面/);
 assert.ok(!renderGallery({screenshots:[{url:'javascript:alert(1)'}]}).includes('javascript:'));
});
test('ratings and descriptions escape source markup',()=>{
 const w={source:'https://vndb.org/v1',descriptionLanguage:'中文',description:'中文<script>alert(1)</script>',ratings:{bangumi:{score:7.1,scale:10,votes:100,url:'javascript:alert(1)',via:'<unsafe>',fetchedAt:'2026-11-01'}}};
 assert.ok(!renderDescription(w).includes('<script>'));assert.ok(!renderRatings(w).includes('href="javascript:'));
});
