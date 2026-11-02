import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { roleWorks, paginate } from '../render-library.mjs';

test('岗位分组分别计数，重复记录不重复计入', () => {
  const person = { works: [{id:'v1',roles:['scenario','art']},{id:'v1',roles:['scenario']},{id:'v2',roles:['art']},{id:'v3',roles:['music']}] };
  assert.deepEqual(roleWorks(person,'scenario'),['v1']);
  assert.deepEqual(roleWorks(person,'art'),['v1','v2']);
});
test('25部一页完整覆盖目录，越界页码收敛到有效边界', () => {
  const items = Array.from({length:2176},(_,i) => i);
  const all = Array.from({length:88},(_,i) => paginate(items,i+1,25)).flatMap(p => p.items);
  assert.deepEqual(all,items);
  assert.equal(paginate(items,88,25).items.length,1);
  assert.equal(paginate(items,999,25).current,88);
  assert.equal(paginate(items,0,25).current,1);
  assert.deepEqual(paginate([],1,25),{current:1,pages:1,items:[]});
});
test('完整列表可直接访问，最后一页禁用向后翻页', async () => {
  const data = JSON.parse(await readFile('site/data/library.json','utf8')).datasets.works;
  const lastPage = Math.ceil(data.entries.length / data.size);
  const first = await readFile('site/library/works/index.html','utf8');
  const second = await readFile('site/library/works/2/index.html','utf8');
  const last = await readFile(`site/library/works/${lastPage}/index.html`,'utf8');
  assert.equal((first.match(/class="work-card"/g) ?? []).length,25);
  assert.equal((second.match(/class="work-card"/g) ?? []).length,25);
  assert.equal((last.match(/class="work-card"/g) ?? []).length,data.entries.length % data.size || data.size);
  assert.ok(first.includes('rel="next"'));
  assert.ok(!last.includes('rel="next"'));
  assert.ok(last.includes('rel="prev"'));
});
