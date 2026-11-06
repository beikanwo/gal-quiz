import { dedupe, qualifies, canonicalEvidenceUrl, matchWork } from './core.mjs';
import { canonicalWorks } from './identity-names.mjs';

export function windowRecords(records, period) {
  return dedupe(records.filter(r => qualifies(r, period, 0) &&
    r.url === canonicalEvidenceUrl(r.platform, r.id, r.kind)));
}

export function collectionWindow(now, periods, reports = {}) {
  const active = periods.filter(p => !reports[p.id]?.finalized &&
    Date.parse(p.start) <= now && now <= Date.parse(p.supplementUntil));
  return { start: new Date(Math.min(now - 5 * 86400000, ...active.map(p => Date.parse(p.start)))).toISOString(),
    end: new Date(now + 1000).toISOString() };
}

export function engagementQueries(settings, discovery, formal, catalog, state, now) {
  const unique = values => [...new Set(values.filter(Boolean))];
  const lists = Object.values(formal.periods[0]?.platforms ?? {}).map(p => p.ranking ?? []);
  const active = Array.from({ length: Math.max(0, ...lists.map(p => p.length)) }, (_, i) =>
    lists.map(p => catalog.works[p[i]?.workId]?.title)).flat();
  const observed = unique(Object.values(state.posts ?? {}).filter(p =>
    Date.parse(p.record.publishedAt) >= now - 7 * 86400000).map(p => catalog.works[p.record.workId]?.title));
  const pool = unique([...active, ...(discovery.discoveryQueries ?? [])]);
  const offset = pool.length ? Math.floor(now / 86400000) % pool.length : 0;
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
  const names = unique([...observed.slice(0, 2), ...rotated]).slice(0, settings.maxExpansionWorks);
  return unique([...settings.keywords, ...names]);
}

// Search results are hints. Only exact, source-backed names accepted by matchWork
// become evidence, and every referenced work must exist in the public catalog.
export async function resolveEngagementWorks(records, { catalog, seeds, canonical, overrides, metadata, deadline }) {
  let identities = canonicalWorks({ ...seeds, ...catalog.works }, canonical);
  let resolved = 0, failures = 0;
  for (const record of records) {
    if (Date.now() >= deadline) break;
    let match = matchWork(record, identities, overrides);
    try {
      if (match.status === 'pending' && !match.candidates?.length) {
        await metadata.resolveUnknown(record);
        identities = canonicalWorks({ ...seeds, ...catalog.works }, canonical);
        match = matchWork(record, identities, overrides);
      }
      if (match.status === 'matched' && !catalog.works[match.workId]) {
        await metadata.enrichWork(match.workId);
        resolved++;
      }
    } catch { failures++; }
  }
  return { resolved, failures };
}
