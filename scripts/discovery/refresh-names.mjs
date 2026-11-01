// Backfill original/romanized names without refetching every participation list.
import { Metadata } from './metadata.mjs';
import { readJson, writeJson } from './io.mjs';
const catalog = await readJson('data/discovery/catalog.json');
const metadata = new Metadata(catalog);
let count = 0;
for (const [type, rows] of [['staff', catalog.staff], ['producer', catalog.producers]]) {
  for (const entry of Object.values(rows)) {
    if (entry.aliases?.length) continue;
    const value = (await metadata.query(type, ['id', '=', entry.id], 'name,original')).results?.[0];
    if (value) { entry.aliases = [...new Set([value.name, value.original].filter(Boolean))]; count++; }
  }
}
await writeJson('data/discovery/catalog.json', catalog);
console.log(`补全 ${count} 个作者或制作商的名称检索。`);
