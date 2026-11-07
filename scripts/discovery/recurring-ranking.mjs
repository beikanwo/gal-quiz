import { PLATFORMS, qualifies, canonicalEvidenceUrl } from './core.mjs';

// Derive from published snapshots only: retries and engagement observations are not periods.
export function recurringRanking(index, config, works) {
  const settings = config.recurringRanking;
  const periods = [...new Map((index.periods ?? [])
    .filter(p => p.id >= settings.startDate && p.minLikes === config.minLikes &&
      Date.parse(p.end) - Date.parse(p.start) === config.intervalDays * 86400000)
    .map(p => [p.id, p])).values()]
    .sort((a, b) => b.id.localeCompare(a.id)).slice(0, settings.windowPeriods);
  const groups = new Map();
  let incomplete = false;
  for (const period of periods) {
    for (const platform of PLATFORMS) {
      const source = period.platforms?.[platform];
      const current = source?.periodId === period.id &&
        ['success', 'partial'].includes(source.status) &&
        source.start === period.start && source.end === period.end &&
        source.minLikes === (config.platformMinLikes?.[platform] ?? period.minLikes);
      if (!current || source.status !== 'success') incomplete = true;
      if (!current) continue;
      for (const row of source.ranking ?? []) {
        if (!works[row.workId]) continue;
        const evidence = (row.evidence ?? []).filter(e => e.workId === row.workId &&
          e.platform === platform && qualifies(e, period, source.minLikes) &&
          e.url === canonicalEvidenceUrl(platform, e.id, e.kind));
        if (!evidence.length) continue;
        if (!groups.has(row.workId)) groups.set(row.workId, { workId: row.workId, periods: new Set(), evidence: new Set() });
        const group = groups.get(row.workId);
        group.periods.add(period.id);
        for (const e of evidence) group.evidence.add(`${platform}:${e.id}`);
      }
    }
  }
  const entries = [...groups.values()].map(group => ({
    workId: group.workId,
    periods: [...group.periods].sort().reverse(),
    appearances: group.periods.size,
    evidenceCount: group.evidence.size,
    latestPeriod: [...group.periods].sort().at(-1),
  })).filter(row => row.appearances >= settings.minimumAppearances)
    .sort((a, b) => b.appearances - a.appearances || b.latestPeriod.localeCompare(a.latestPeriod) ||
      b.evidenceCount - a.evidenceCount || a.workId.localeCompare(b.workId))
    .slice(0, settings.limit);
  return { periods: periods.map(p => p.id), incomplete, entries };
}

export function renderRecurringRanking(result, config, works, { esc, cover }) {
  const settings = config.recurringRanking;
  const date = value => value.replaceAll('-', '.');
  const total = result.periods.length;
  const rules = `从 ${date(settings.startDate)} 期起，统计最近 ${settings.windowPeriods} 个已发布的正式期次（约 ${settings.windowPeriods * config.intervalDays} 天）。同一作品在抖音、B站同时出现，每期仍只计一次；重跑采集不增加次数。至少出现 ${settings.minimumAppearances} 期才能入榜，先按出现期数排序，并列时依次比较最近出现日期、去重后的合格片段数量。仅使用当期真实采集的合格片段，失败后保留的旧榜单不计入新一期。部分采集可能漏掉作品，结果仅代表本站收录范围。`;
  const cards = result.entries.map((row, i) => {
    const w = works[row.workId];
    return `<li class="recurring-item"><a class="recurring-work" href="@@ROOT@@works/${esc(w.id)}/"><span class="recurring-rank" aria-label="第${i + 1}名">${i + 1}</span>${cover(w)}<div class="recurring-copy"><h3>${esc(w.title)}</h3><p class="recurring-count">近 ${total} 期出现 <strong>${row.appearances}</strong> 期</p><p class="recurring-latest">最近出现 ${date(row.latestPeriod)}</p></div></a><details class="recurring-history"><summary>入榜期次与片段来源</summary><p>${row.periods.map(id => `<a href="@@ROOT@@periods/${id}/">${date(id)}</a>`).join(' ')}<span>共 ${row.evidenceCount} 条合格片段，原链接见作品页。</span></p></details></li>`;
  }).join('');
  const empty = total < settings.minimumAppearances
    ? `从 ${date(settings.startDate)} 期开始积累，作品至少出现 ${settings.minimumAppearances} 期后上榜。`
    : `这 ${total} 期还没有作品重复出现 ${settings.minimumAppearances} 期，下一期采集后会自动更新。`;
  return `<section class="recurring-section" id="recurring" aria-labelledby="heading-recurring"><div class="section-header"><div><h2 id="heading-recurring">近期常客 <span class="recurring-top">TOP ${settings.limit}</span></h2><p>看看哪些作品，接连几期都能遇见。</p></div><div class="recurring-progress"><span>已积累 ${total} / ${settings.windowPeriods} 期</span><div class="recurring-segments" aria-hidden="true">${Array.from({ length: settings.windowPeriods }, (_, i) => `<span${i < total ? ' class="filled"' : ''}></span>`).join('')}</div></div></div>${cards ? `<ol class="recurring-list">${cards}</ol>` : `<div class="recurring-empty"><h3>${total < settings.minimumAppearances ? '正在积累多期记录' : '还没有重复上榜的作品'}</h3><p>${empty}</p></div>`}${cards && result.entries.length < settings.limit ? `<p class="recurring-note">目前 ${result.entries.length} 部作品符合条件，按实际数量展示。</p>` : ''}${result.incomplete ? '<p class="recurring-note">统计范围含部分采集或平台缺失，未收录不代表没有热度。</p>' : ''}<details class="recurring-rules"><summary>怎么算排名</summary><p>${rules}</p></details></section>`;
}
