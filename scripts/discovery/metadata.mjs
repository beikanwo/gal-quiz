import { readJson, writeJson, pause, failure } from './io.mjs';
import { normalize, publicScreenshot, safeUrl } from './core.mjs';
import { fetchJson } from './sources.mjs';
const header = { 'Content-Type': 'application/json', 'User-Agent': 'beikanwo/gal-quiz (https://www.scurra.top)' };
const summaryFields = 'title,alttitle,titles{lang,title},aliases,released,languages,length_minutes,image{url,sexual,violence},developers{id,name,original}';
const detailFields = `${summaryFields},description,screenshots{id,url,thumbnail,sexual,violence},staff{id,name,original,role,aid},extlinks{url,label}`;
const plain = (s) => String(s ?? '').replace(/\[spoiler\][\s\S]*?\[\/spoiler\]/gi, '（剧情内容已隐藏）').replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1').replace(/\[\/?[^\]]+\]/g, '').replace(/<[^>]*>/g, '').trim();
const links = (rows) => (rows ?? []).filter((r) => safeUrl(r.url)).map((r) => ({ url: safeUrl(r.url), label: r.label ?? r.name ?? new URL(r.url).hostname }));
export class Metadata {
  constructor(catalog, overrides = {}) { this.catalog = catalog; this.overrides = overrides; this.lastRequest = 0; this.fetched = new Set(); this.now = new Date().toISOString(); }
  async query(endpoint, filters, fields, page = 1) {
    await pause(Math.max(0, this.lastRequest + 1700 - Date.now()));
    this.lastRequest = Date.now();
    return fetchJson(`https://api.vndb.org/kana/${endpoint}`, { method: 'POST', headers: header, body: JSON.stringify({ filters, fields, results: 100, page }) });
  }
  async all(endpoint, filters, fields) {
    const rows = [];
    for (let page = 1; ; page++) {
      const result = await this.query(endpoint, filters, fields, page);
      if (!Array.isArray(result.results)) throw failure('VNDB 资料接口返回格式发生变化。');
      rows.push(...result.results);
      if (!result.more) return rows;
    }
  }
  work(row, detailed = false) {
    const previous = this.catalog.works[row.id];
    const titles = row.titles ?? [];
    const title = titles.find((t) => t.lang === 'zh-Hans')?.title ?? titles.find((t) => t.lang === 'zh-Hant')?.title ?? row.alttitle ?? row.title;
    const override = this.overrides.works?.[row.id] ?? {};
    const record = { ...previous, id: row.id, title, original: row.alttitle ?? row.title, aliases: [...new Set([row.title, ...titles.map((t) => t.title), ...(row.aliases ?? [])].filter(Boolean))], released: row.released, languages: row.languages ?? [], minutes: row.length_minutes, image: row.image?.sexual === 0 && row.image?.violence === 0 ? safeUrl(row.image.url) : null, developers: (row.developers ?? []).map((p) => ({ id: p.id, name: p.original ?? p.name })), source: `https://vndb.org/${row.id}`, updatedAt: this.now, detailComplete: detailed || previous?.detailComplete || false };
    if (detailed) {
      record.description = plain(row.description);
      record.descriptionLanguage = '原文';
      record.descriptionSource = record.source;
      record.staff = (row.staff ?? []).filter((s) => ['scenario', 'art'].includes(s.role)).map((s) => ({ id: s.id, name: s.original ?? s.name, role: s.role, aliasId: s.aid }));
      record.screenshots = (row.screenshots ?? []).map((image) => publicScreenshot(image, this.overrides.screenshots?.[image.id])).filter(Boolean).slice(0, 6);
      record.links = links(row.extlinks);
    }
    // Editorial overrides must declare their source. Do not silently manufacture a Chinese synopsis.
    if (override.description && safeUrl(override.descriptionSource)) Object.assign(record, { description: plain(override.description), descriptionLanguage: '中文', descriptionSource: safeUrl(override.descriptionSource) });
    if (override.title) record.title = override.title;
    this.catalog.works[row.id] = record;
    return record;
  }
  async enrichWork(id) {
    if (id.startsWith('manual-')) return this.catalog.works[id];
    if (this.fetched.has(id)) return this.catalog.works[id];
    const row = (await this.query('vn', ['id', '=', id], detailFields)).results?.[0];
    if (!row) throw failure(`VNDB 未找到作品 ${id}。`);
    const work = this.work(row, true);
    this.fetched.add(id);
    const reception = await readJson('config/chinese-reception.json', { entries: {} });
    const bgmId = reception.entries?.[id]?.bangumi?.id;
    if (bgmId && !this.overrides.works?.[id]?.description) {
      try {
        const bgm = await fetchJson(`https://api.bgm.tv/v0/subjects/${bgmId}`, { headers: header });
        if (bgm.type === 4 && bgm.summary) Object.assign(work, { description: plain(bgm.summary), descriptionLanguage: '中文', descriptionSource: `https://bgm.tv/subject/${bgmId}` });
      } catch { /* Keep attributed VNDB original if Chinese metadata is unavailable. */ }
    }
    return work;
  }
  async enrichPeople(work) {
    for (const entry of work.staff ?? []) {
      if (this.catalog.staff[entry.id]?.updatedAt?.slice(0, 10) === this.now.slice(0, 10)) continue;
      const person = (await this.query('staff', ['id', '=', entry.id], 'name,original,description,extlinks{url,name}')).results?.[0];
      if (!person) continue;
      // Fetch every page without the quiz's vote/rating/sequel filters. Do not recursively expand colleagues.
      const rows = await this.all('vn', ['staff', '=', ['id', '=', entry.id]], `${summaryFields},staff{id,role}`);
      this.catalog.staff[entry.id] = { id: entry.id, name: person.original ?? person.name, description: plain(person.description), links: links(person.extlinks), works: rows.map((r) => ({ id: r.id, roles: [...new Set((r.staff ?? []).filter((s) => s.id === entry.id).map((s) => s.role))] })), updatedAt: this.now, source: `https://vndb.org/${entry.id}` };
      rows.forEach((r) => this.work(r));
    }
    for (const entry of work.developers ?? []) {
      if (this.catalog.producers[entry.id]?.updatedAt?.slice(0, 10) === this.now.slice(0, 10)) continue;
      const producer = (await this.query('producer', ['id', '=', entry.id], 'name,original,description,extlinks{url,name}')).results?.[0];
      if (!producer) continue;
      const rows = await this.all('vn', ['developer', '=', ['id', '=', entry.id]], summaryFields);
      this.catalog.producers[entry.id] = { id: entry.id, name: producer.original ?? producer.name, description: plain(producer.description), links: links(producer.extlinks), works: rows.map((r) => ({ id: r.id })), updatedAt: this.now, source: `https://vndb.org/${entry.id}` };
      rows.forEach((r) => this.work(r));
    }
  }
  async resolveUnknown(record) {
    const text = [record.title, record.description, ...(record.tags ?? [])].join(' ');
    const phrases = [...text.matchAll(/《([^》]{2,70})》|「([^」]{2,70})」|#([^\s#]{2,35})/g)].map((m) => m[1] ?? m[2] ?? m[3]).filter((s) => !/^(galgame|gal游戏|美少女游戏|视觉小说|cg|游戏推荐)$/i.test(s));
    for (const phrase of [...new Set(phrases)].slice(0, 4)) {
      const rows = (await this.query('vn', ['search', '=', phrase], summaryFields)).results ?? [];
      for (const r of rows) if ([r.title, r.alttitle, ...(r.titles ?? []).map((t) => t.title), ...(r.aliases ?? [])].some((s) => normalize(s) === normalize(phrase))) this.work(r);
    }
  }
}
export async function seedAliases(catalog, overrides) {
  const quiz = await readJson('site/data/vns.json', []);
  const works = { ...catalog.works };
  // Seeds are a lookup aid only. They are never published as a complete new catalog.
  for (const w of quiz) if (!works[w.id]) works[w.id] = { id: w.id, title: w.title, original: w.orig, aliases: [w.title, w.orig] };
  for (const [id, value] of Object.entries(overrides.works ?? {})) {
    if (id.startsWith('manual-') && /^[a-z0-9-]+$/.test(id) && value.title && safeUrl(value.source)) {
      catalog.works[id] = { ...value, id, description: plain(value.description), image: null, screenshots: [], staff: [], developers: [], updatedAt: new Date().toISOString() };
      works[id] = catalog.works[id];
    }
  }
  return works;
}
