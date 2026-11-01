// Shared, deterministic rules. No network, browser or filesystem dependencies.
export const PLATFORMS = ['douyin', 'bilibili'];
export const normalize = (s) => String(s ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\p{S}\s]/gu, '');
export const chinaDate = (value = Date.now()) => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 10);
const dayMs = 86400000;
const midnight = (date) => Date.parse(`${date}T00:00:00+08:00`);
export function periodFor(anchorDate, now = new Date(), intervalDays = 15) {
  const today = chinaDate(now);
  if (!anchorDate) return { id: today, start: new Date(midnight(today) - intervalDays * dayMs).toISOString(), end: new Date(midnight(today)).toISOString(), endDate: today };
  const index = Math.floor((midnight(today) - midnight(anchorDate)) / (intervalDays * dayMs));
  if (index < 0) return null;
  const end = midnight(anchorDate) + index * intervalDays * dayMs;
  return { id: chinaDate(end), start: new Date(end - intervalDays * dayMs).toISOString(), end: new Date(end).toISOString(), endDate: chinaDate(end) };
}
export function qualifies(record, period, minLikes = 1000) {
  const time = Date.parse(record.publishedAt);
  return PLATFORMS.includes(record.platform) && typeof record.id === 'string' && record.id.length > 0 &&
    Number.isInteger(record.likes) && record.likes >= minLikes && Number.isFinite(time) &&
    time >= Date.parse(period.start) && time < Date.parse(period.end) &&
    Number.isFinite(Date.parse(record.collectedAt)) && time <= Date.parse(record.collectedAt) && Boolean(safeUrl(record.url));
}
export function safeUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function canonicalEvidenceUrl(platform, id, kind = 'video') {
  if (platform === 'douyin' && /^\d+$/.test(id)) return `https://www.douyin.com/${kind === 'image' ? 'note' : 'video'}/${id}`;
  if (platform === 'bilibili' && /^BV[0-9A-Za-z]+$/.test(id)) return `https://www.bilibili.com/video/${id}`;
  return null;
}
export function dedupe(records) {
  const map = new Map();
  for (const r of records) {
    const key = `${r.platform}:${r.id}`;
    // Latest snapshot wins. Never add observations of the same post together.
    if (!map.has(key) || Date.parse(r.collectedAt) >= Date.parse(map.get(key).collectedAt)) map.set(key, r);
  }
  return [...map.values()];
}
export function matchWork(record, works, overrides = {}) {
  const manual = overrides.evidence?.[`${record.platform}:${record.id}`];
  if (manual?.exclude) return { status: 'excluded', reason: '人工排除' };
  if (manual?.workId && works[manual.workId] && manual.confirmedGame === true) return { status: 'matched', workId: manual.workId, method: 'reviewed' };
  const text = [record.title, record.description, ...(record.tags ?? [])].join(' ');
  const normalized = normalize(text);
  const candidates = [];
  for (const w of Object.values(works)) {
    const aliases = [w.title, w.original, ...(w.aliases ?? []), ...Object.entries(overrides.aliases ?? {}).filter(([, id]) => id === w.id).map(([name]) => name)];
    const hits = aliases.filter((alias) => {
      if (!alias) return false;
      // Short Latin names need boundaries (AIR is not a match in "chair").
      if (/^[\x00-\x7F]+$/.test(alias)) {
        if (normalize(alias).length < 3) return false;
        return new RegExp(`(?<![a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(text);
      }
      return normalize(alias).length >= 2 && normalized.includes(normalize(alias));
    });
    if (hits.length) candidates.push({ id: w.id, hits });
  }
  // A title contained in a longer title is not another work mentioned in a compilation.
  const reduced = candidates.filter((a) => !candidates.some((b) => b.id !== a.id && a.hits.every((x) => b.hits.some((y) => normalize(y).length > normalize(x).length && normalize(y).includes(normalize(x))))));
  if (reduced.length !== 1) return { status: 'pending', reason: reduced.length ? '涉及多个作品或名称有歧义' : '没有找到明确作品名', candidates: reduced.map((x) => x.id) };
  if (/系列世界观|系列世界觀|系列剧情|系列劇情|系列盘点|系列作品|多部游戏|游戏盘点|游戏榜单/i.test(text)) return { status: 'pending', reason: '介绍涉及整个系列或多个游戏，需要核对具体条目', candidates: [reduced[0].id] };
  const primary=[record.title,record.description].join(' ');
  const gameFootage=/CG|游戏画面|遊戲畫面|游戏片段|配音实况|游戏实况|実況|\b(?:op|ed)\b/i.test(primary)||(record.tags??[]).some(tag=>/^(?:游戏CG|游戏实况|游戏片段|GalgameCG)$/i.test(tag));
  if (/\b(?:gmv|mmd|vtuber|minecraft|cosplay|cos)\b|手书|手書|联动|联動|手机游戏|手游|手遊|我的世界|鸣潮|原神|虚拟主播|直播背景|自己的\s*galgame/i.test(text)||(/二创|二創|同人|自制|混剪/.test(text)&&!gameFootage)) return { status: 'pending', reason: '可能是二创、联动或其他游戏，需要核对原画面', candidates: [reduced[0].id] };
  if (/动画|動漫|动漫|番剧|番劇|\b(?:amv|mad)\b/i.test(primary)||(/动画|動漫|动漫|番剧|番劇|\b(?:amv|mad)\b/i.test(text)&&!gameFootage)) return { status: 'pending', reason: '需要区分游戏与动画等改编画面', candidates: [reduced[0].id] };
  if (!/galgame|gal游戏|美少女游戏|视觉小说|遊戲|游戏|实况|実況|CG|游戏截图/i.test(text)) return { status: 'pending', reason: '作品名明确，但画面来源尚未确认', candidates: [reduced[0].id] };
  return { status: 'matched', workId: reduced[0].id, method: 'explicit-title' };
}
export function rankEvidence(records) {
  const groups = new Map();
  for (const r of dedupe(records)) {
    if (!r.workId) continue;
    if (!groups.has(r.workId)) groups.set(r.workId, []);
    groups.get(r.workId).push(r);
  }
  return [...groups].map(([workId, evidence]) => ({ workId, maxLikes: Math.max(...evidence.map((r) => r.likes)), count: evidence.length, evidence: evidence.sort((a, b) => b.likes - a.likes) }))
    .sort((a, b) => b.maxLikes - a.maxLikes || b.count - a.count || a.workId.localeCompare(b.workId));
}
export function publicScreenshot(image, override = {}) {
  if (!safeUrl(image.url) || image.sexual !== 0 || image.violence > 0) return null;
  return { id: image.id, url: safeUrl(image.url), thumbnail: safeUrl(image.thumbnail) ?? safeUrl(image.url), spoiler: override.spoiler !== false, source: override.source ?? 'VNDB', credit: override.credit ?? '画面版权归游戏权利人所有' };
}
export function combinePeriod(period, attempts, previous = null, minLikes = 1000) {
  const platforms = {};
  for (const name of PLATFORMS) {
    const attempt = attempts[name];
    const currentPartial = attempt?.status === 'partial' && (!previous?.platforms?.[name]?.periodId || previous.platforms[name].periodId === period.id);
    if (attempt?.status === 'success' || currentPartial) {
      const evidence = dedupe(attempt.records ?? []).filter((r) => r.platform === name && qualifies(r, period, minLikes) && r.workId);
      platforms[name] = { status: attempt.status, periodId: period.id, start: period.start, end: period.end, minLikes, collectedAt: attempt.collectedAt, lastSuccessAt: attempt.status === 'success' ? attempt.collectedAt : previous?.platforms?.[name]?.lastSuccessAt ?? null, error: attempt.error ?? null, coverage: attempt.coverage ?? {}, ranking: rankEvidence(evidence) };
    } else {
      const old = previous?.platforms?.[name];
      platforms[name] = { ...(old ?? { ranking: [], periodId: null, lastSuccessAt: null }), status: 'failed', attemptedAt: attempt?.collectedAt ?? new Date().toISOString(), error: attempt?.error ?? '尚未完成采集验证' };
    }
  }
  return { ...period, minLikes, platforms };
}
