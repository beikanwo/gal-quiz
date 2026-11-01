// Backfill original/romanized names without refetching every participation list.
import { Metadata } from './metadata.mjs';
import { readJson, writeJson } from './io.mjs';
const catalog = await readJson('data/discovery/catalog.json');
const metadata = new Metadata(catalog);
let count = 0;
for (const [type, rows] of [['staff', catalog.staff], ['producer', catalog.producers]]) {
  const missing = Object.values(rows).filter((entry) => !entry.aliases?.length);
  for (let offset = 0; offset < missing.length; offset += 100) {
    const batch = missing.slice(offset, offset + 100);
    const predicates = batch.map((entry) => ['id', '=', entry.id]);
    const values = await metadata.all(type, predicates.length === 1 ? predicates[0] : ['or', ...predicates], 'name,original');
    for (const value of values) if (rows[value.id]) { rows[value.id].aliases = [...new Set([value.name, value.original].filter(Boolean))]; count++; }
  }
}
await writeJson('data/discovery/catalog.json', catalog);
console.log(`补全 ${count} 个作者或制作商的名称检索。`);
