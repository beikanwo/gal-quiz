const DAY = 86400000;
export function stageDue(work, stage, now = Date.now()) {
  const state = work.metadataStatus?.[stage];
  return !state?.nextAttemptAt || Date.parse(state.nextAttemptAt) <= now;
}
export function recordStage(work, stage, status, { now = new Date().toISOString(), reason, matched } = {}) {
  work.metadataStatus ??= {};
  const previous = work.metadataStatus[stage] ?? {};
  const attempts = status === 'failed' ? (previous.failures ?? 0) + 1 : 0;
  const delay = status === 'failed' ? Math.min(DAY, 5 * 60000 * 2 ** Math.min(attempts - 1, 8)) : 30 * DAY;
  work.metadataStatus[stage] = { status, checkedAt: now, nextAttemptAt: new Date(Date.parse(now) + delay).toISOString(), failures: attempts,
    ...(status === 'success' ? { lastSuccessAt: now } : previous.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
    ...(reason ? { reason } : {}), ...(matched !== undefined ? { matched } : {}) };
  return work.metadataStatus[stage];
}
export function missingMessage(work, field) {
  const stage = field === 'vndb' ? 'vndb' : field === 'cover' ? 'cover' : 'community';
  const state = work.metadataStatus?.[stage];
  const direct = field === 'bangumi' ? work.metadataStatus?.bangumi : null;
  if (state?.status === 'failed' || direct?.status === 'failed') return '采集失败，等待重试';
  if (!state || state.status === 'pending') return '尚未采集';
  if (field === 'cover') return state.status === 'unavailable' ? '暂无符合展示标准的封面' : '暂无封面';
  if (state.matched === false) return '所查来源暂未匹配到条目';
  return field === 'description' ? '所查来源暂无中文简介' : '所查来源暂无评分';
}
export function enrichmentSummary(catalog) {
  const works = Object.values(catalog.works);
  return { total: works.length, detailed: works.filter(w => w.detailComplete).length, chinese: works.filter(w => w.descriptionLanguage === '中文').length,
    covers: works.filter(w => w.image).length,
    communityChecked: works.filter(w => ['success','unavailable'].includes(w.metadataStatus?.community?.status)).length,
    communityPending: works.filter(w => !w.metadataStatus?.community).length,
    failed: works.filter(w => Object.values(w.metadataStatus ?? {}).some(s => s.status === 'failed')).length,
    ratings: Object.fromEntries(['bangumi','vndb','erogamescape'].map(site => [site, works.filter(w => w.ratings?.[site]?.votes > 0).length])) };
}
