import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { args, readJson, writeJson, publicError } from './io.mjs';
import { periodFor, qualifies, dedupe, matchWork, combinePeriod, PLATFORMS, canonicalEvidenceUrl } from './core.mjs';
import { BilibiliSource, DouyinSource } from './sources.mjs';
import { Metadata, seedAliases } from './metadata.mjs';

export async function run(options = args()) {
  const config = await readJson('config/discovery.json');
  const index = await readJson('data/discovery/periods.json');
  const catalog = await readJson('data/discovery/catalog.json');
  const overrides = await readJson('config/discovery-overrides.json');
  const priorReview = await readJson('data/discovery/review.json', { records: [], pending: [], warnings: [] });
  const now = options.at ?? new Date().toISOString();
  const period = periodFor(index.anchorDate ?? config.anchorDate, now, config.intervalDays);
  const existing = index.periods.find((p) => p.id === period?.id);
  const complete = existing && PLATFORMS.every((p) => existing.platforms[p]?.status === 'success');
  const due = Boolean(period && (!complete || options.force));
  if (options.due) {
    const enabled = options.manual || config.scheduleEnabled;
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `due=${due && enabled ? 'true' : 'false'}\n`);
    console.log(JSON.stringify({ due: due && Boolean(enabled), period: period?.id, scheduleEnabled: config.scheduleEnabled }));
    return;
  }
  if (!period || (!due && !options.probe && !options['review-only'])) { console.log('本期已经完成，无需重复发布。'); return; }
  const metadata = new Metadata(catalog, overrides);
  metadata.unknownQueryLimit = config.maxUnknownTitleQueries;
  const seeds = await seedAliases(catalog, overrides);
  const canonical = new Map();
  for (const w of await readJson('site/data/vns.json', [])) for (const alt of w.altIds ?? []) canonical.set(alt, w.id);
  const matchingWorks = () => {
    const rows = { ...seeds, ...catalog.works };
    for (const [alt, primary] of canonical) if (rows[alt]) {
      const variant = rows[alt];
      const main = rows[primary] ?? { id: primary, title: variant.title };
      rows[primary] = { ...main, aliases: [...new Set([...(main.aliases ?? []), variant.title, variant.original, ...(variant.aliases ?? [])].filter(Boolean))] };
      delete rows[alt];
    }
    return rows;
  };
  const report = { version: 1, period, startedAt: now, platforms: {}, pending: [], warnings: [] };
  const attempts = {};
  const selected = options.platform ? [options.platform] : PLATFORMS;
  if (selected.some((p) => !PLATFORMS.includes(p))) throw new Error('未知平台');
  const saved = options['review-only'] ? await readJson('data/discovery/review.json', { records: [] }) : null;
  for (const platform of selected) {
    if (existing?.platforms?.[platform]?.status === 'success' && !options.force && !options.probe && !options['review-only']) {
      const previous = existing.platforms[platform];
      attempts[platform] = { ...previous, records: previous.ranking.flatMap((r) => r.evidence), reviewRecords: priorReview.periodId === period.id ? priorReview.records.filter((r) => r.platform === platform) : previous.ranking.flatMap((r) => r.evidence) };
      if (priorReview.periodId === period.id) {
        report.pending.push(...priorReview.pending.filter((r) => r.platform === platform));
        report.warnings.push(...priorReview.warnings);
      }
      report.platforms[platform] = { status: 'success', collectedAt: previous.collectedAt, reused: true, coverage: previous.coverage };
      continue;
    }
    const source = platform === 'bilibili' ? new BilibiliSource() : new DouyinSource();
    const collectedAt = new Date().toISOString();
    let records = !saved && priorReview.periodId === period.id ? priorReview.records.filter((r) => r.platform === platform) : [];
    let queries = 0;
    let pages = 0;
    let status = 'success';
    let error = null;
    const failedQueries = [];
    const keywords = options.probe ? config.keywords.slice(0, 1) : config.keywords;
    try {
      if (saved) {
        const snapshot = saved.platforms?.[platform];
        if (saved.periodId !== period.id) throw new Error('审核记录不属于本期');
        records = saved.records.filter((r) => r.platform === platform);
        const coverage = index.lastAttempt?.platforms?.[platform]?.coverage;
        if (snapshot?.status !== 'success') {
          if (!records.length || !(coverage?.queries > 0)) throw new Error('没有可验证的成功搜索记录');
          status = 'partial'; error = '本期仅完成部分搜索，以下只展示已经核实的片段。';
          queries = coverage.queries; pages = coverage.pages;
        }
      } else {
        for (const keyword of keywords) {
          console.log(`${platform}：搜索 ${keyword}`);
          try {
            const batch = await source.search(keyword, options.probe ? 1 : config.pagesPerKeyword, period);
            records.push(...batch.records); queries++; pages += batch.pages;
            if (batch.partial) failedQueries.push(keyword);
          } catch (e) { failedQueries.push(keyword); error = publicError(e); }
        }
        if (failedQueries.length) status = queries ? 'partial' : 'failed';
      }
    } catch (e) { status = 'failed'; error = publicError(e); }
    const qualified = dedupe(records).filter((r) => qualifies(r, period, config.minLikes) && canonicalEvidenceUrl(r.platform, r.id, r.kind) === r.url);
    const matched = [];
    const identify = async (record) => {
      let decision = matchWork(record, matchingWorks(), overrides);
      try {
        if (!saved && decision.status === 'pending' && !decision.candidates?.length) {
          await metadata.resolveUnknown(record);
          decision = matchWork(record, matchingWorks(), overrides);
        }
        if (decision.status === 'matched') {
          decision.workId = canonical.get(decision.workId) ?? decision.workId;
          const work = await metadata.enrichWork(decision.workId);
          if (!options.probe) {
            try { await metadata.enrichPeople(work); }
            catch { report.warnings.push({ workId: work.id, message: '作者或制作商资料未补全，保留已有资料并等待重试。' }); }
          }
          matched.push({ ...record, workId: decision.workId, matchMethod: decision.method });
        } else if (decision.status === 'pending') report.pending.push({ ...record, reason: decision.reason, candidates: decision.candidates ?? [] });
      } catch { report.pending.push({ ...record, reason: '作品资料查询失败，需要重试或人工补充', candidates: decision.workId ? [decision.workId] : [] }); }
    };
    for (const record of qualified) await identify(record);
    if (!options.probe && !saved && status !== 'failed') {
      for (const keyword of config.discoveryQueries ?? []) {
        if (new Set(matched.map((r) => r.workId)).size >= (config.targetWorksPerPlatform ?? 10)) break;
        try {
          console.log(`${platform}：补足作品搜索 ${keyword}`);
          const batch = await source.search(keyword, config.targetSearchPages ?? 2, period);
          queries++; pages += batch.pages; records.push(...batch.records);
          if (batch.partial) { status = 'partial'; failedQueries.push(keyword); }
          for (const record of dedupe(batch.records).filter((r) => qualifies(r, period, config.minLikes))) await identify(record);
        } catch { status = 'partial'; failedQueries.push(keyword); }
      }
    }
    // Supplement topic discovery with exact names of explicitly identified games.
    if (!options.probe && !saved && status !== 'failed') {
      for (const id of [...new Set(matched.map((r) => r.workId))].slice(0, config.maxExpansionWorks)) {
        if (new Set(matched.map((r) => r.workId)).size >= (config.targetWorksPerPlatform ?? 10)) break;
        const names = [...new Set([catalog.works[id].title, catalog.works[id].original])].filter(Boolean);
        for (const name of names) {
          try {
            const batch = await source.search(name, config.pagesPerKeyword, period); queries++; pages += batch.pages;
            for (const record of batch.records.filter((r) => qualifies(r, period, config.minLikes))) {
              records.push(record);
              const decision = matchWork(record, matchingWorks(), overrides);
              if (decision.status === 'matched' && (canonical.get(decision.workId) ?? decision.workId) === id) matched.push({ ...record, workId: id, matchMethod: decision.method });
              else if (decision.status === 'pending') report.pending.push({ ...record, reason: decision.reason, candidates: decision.candidates ?? [] });
            }
          } catch { status = 'partial'; error = '作品名称补搜未完成，已注明本轮搜索范围。'; failedQueries.push(name); }
        }
      }
    }
    attempts[platform] = { status, error, collectedAt: saved ? saved.platforms[platform].collectedAt : new Date().toISOString(), records: dedupe(matched), coverage: { keywords, queries, pages, failedQueries, maxPagesPerQuery: options.probe ? 1 : config.pagesPerKeyword, candidateCount: dedupe(records).length, qualifiedCount: qualified.length } };
    report.platforms[platform] = { status, error, collectedAt, fetched: dedupe(records).length, qualified: qualified.length, matched: dedupe(matched).length, sample: dedupe(matched).slice(0, 5), coverage: attempts[platform].coverage };
    console.log(`${platform}：${status}；候选 ${dedupe(records).length}，达标 ${qualified.length}，明确对应 ${dedupe(matched).length}`);
    // Persist sanitized qualified evidence for corrections without storing credentials or media payloads.
    attempts[platform].reviewRecords = dedupe(records).filter((r) => qualifies(r, period, config.minLikes));
  }
  report.finishedAt = new Date().toISOString();
  await writeJson(options.report ?? 'data/raw/discovery/report.json', report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ['## 真实采集验证', `期次：${period.id}；窗口：${period.start} 至 ${period.end}`, '', '| 平台 | 状态 | 达标 | 明确匹配 |', '| --- | --- | ---: | ---: |', ...Object.entries(report.platforms).map(([p, value]) => `| ${p} | ${value.status}${value.reused ? '（复用本期）' : ''} | ${value.qualified ?? '—'} | ${value.matched ?? '—'} |`), '', '工作流执行成功不代表每个平台采集成功。失败原因及原链接见验证 Artifact。', ''];
    await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  }
  if (options.probe) return report;
  const previous = existing ?? index.periods[0];
  const snapshot = combinePeriod(period, attempts, previous, config.minLikes);
  const success = selected.some((p) => ['success', 'partial'].includes(attempts[p]?.status));
  index.lastAttempt = { at: report.finishedAt, periodId: period.id, platforms: report.platforms };
  if (success) {
    if (!index.anchorDate) index.anchorDate = period.id;
    index.periods = [snapshot, ...index.periods.filter((p) => p.id !== period.id)].sort((a, b) => b.id.localeCompare(a.id));
  }
  catalog.updatedAt = report.finishedAt;
  await writeJson('data/discovery/catalog.json', catalog);
  await metadata.community.saveIndex();
  await writeJson('data/discovery/periods.json', index);
  await writeJson('data/discovery/review.json', { version: 1, periodId: period.id, platforms: Object.fromEntries(Object.entries(attempts).map(([p, a]) => [p, { status: a.status, collectedAt: a.collectedAt }])), records: dedupe(Object.values(attempts).flatMap((a) => a.reviewRecords ?? [])), pending: dedupe(report.pending), warnings: report.warnings });
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
