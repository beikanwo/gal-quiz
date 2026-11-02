import {safeUrl} from './core.mjs';

export function safeCover(image, extra = {}) {
  if (!image || image.sexual !== 0 || image.violence !== 0 || !safeUrl(image.url)) return null;
  return {id: image.id ?? null, url: safeUrl(image.url), thumbnail: safeUrl(image.thumbnail) ?? safeUrl(image.url), sexual: 0, violence: 0, ...extra};
}

export function selectReleaseCover(workId, releases) {
  const candidates = [];
  for (const release of releases) {
    if (release.official !== true || !/^r\d+$/.test(release.id) || !release.vns?.some(v => v.id === workId)) continue;
    for (const image of release.images ?? []) {
      if (image.photo || !['pkgfront', 'dig'].includes(image.type)) continue;
      if (image.vn !== workId && !(image.vn == null && release.vns.length === 1)) continue;
      const cover = safeCover(image, {kind: 'release', releaseId: release.id, source: `https://vndb.org/${release.id}`});
      if (cover) candidates.push({cover, type: image.type, area: (image.dims?.[0] ?? 0) * (image.dims?.[1] ?? 0)});
    }
  }
  candidates.sort((a,b) => Number(b.type === 'pkgfront') - Number(a.type === 'pkgfront') || b.area - a.area || a.cover.url.localeCompare(b.cover.url));
  return candidates[0]?.cover ?? null;
}
