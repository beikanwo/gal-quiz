const unique = values => [...new Set(values.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()))];
export const vndbNames = row => unique([row.title,row.alttitle,...(row.titles ?? []).map(t => t.title),...(row.aliases ?? [])]);
// Community aliases can contain search keywords, character names and genres.
// Only canonical names can establish a video's identity; machine titles remain search-only.
export const communityNames = (data, machine = false) => unique([data.display_name,data.latin,...Object.values(data.localized ?? {}).filter(v => typeof v === 'string' || machine || !v.is_machine).map(v => typeof v === 'string' ? v : v.value)]);
export function refreshIdentityNames(work) {
  work.matchingAliases=unique([work.title,work.original,...(work.vndbNames ?? []),...(work.communityNames ?? [])]);
  work.aliases=unique([...work.matchingAliases,...(work.communitySearchNames ?? [])]);
}
export function canonicalWorks(works, canonical) {
  const rows={...works};
  for(const [alt,primary]of canonical)if(rows[alt]){
    const variant=rows[alt],main=rows[primary]??{id:primary,title:variant.title};
    rows[primary]={...main,matchingAliases:unique([...(main.matchingAliases??[]),variant.title,variant.original,...(variant.matchingAliases??[])])};
    delete rows[alt];
  }
  return rows;
}
