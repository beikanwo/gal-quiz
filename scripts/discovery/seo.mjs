import { createHash } from 'node:crypto';
const sectionNames={works:'Galgame作品库',writers:'Galgame剧本家',artists:'Galgame原画师',producers:'Galgame制作商'};
export const textSummary=s=>String(s??'').replace(/<[^>]*>/g,' ').replace(/\[\/?(?:url|b|i|quote|spoiler)[^\]]*\]/gi,'').replace(/\s+/g,' ').trim();
export function metadata(route,title,description,catalog,config,{hasReports=false}={}) {
  const url=`${config.origin}/${route}`,parts=route.split('/').filter(Boolean),id=parts[1];
  const work=parts[0]==='works'?catalog.works[id]:null;
  const person=parts[0]==='staff'?catalog.staff[id]:null,producer=parts[0]==='producers'?catalog.producers[id]:null;
  let entity=null,indexable=route!=='search/'&&!(route==='signals/'&&!hasReports);
  if(!route){title='Galgame推荐与热门作品｜抖音、B站片段找游戏';description='从抖音、B站热门片段发现Galgame与视觉小说。查看作品中文简介、评分、游戏画面，沿着剧本家、原画师和制作商寻找下一部作品，也可做Galgame推荐测试。';}
  else if(work){
    title=`${work.title}｜故事简介、评分与制作资料`;
    const original=work.original&&work.original!==work.title?`（${work.original}）`:'';
    const summary=work.descriptionLanguage==='中文'?textSummary(work.description).slice(0,100):'';
    description=`${work.title}${original}的作品资料。${summary?`${summary} `:''}查看已收录的发行信息、站点评分与创作团队，追溯相关片段来源。`;
    entity={'@type':'VideoGame','@id':`${url}#game`,name:work.title,alternateName:[work.original,...(work.vndbNames??[])].filter(x=>typeof x==='string'&&x!==work.title).slice(0,8),url,...(summary?{description:summary}:{}),...(work.image?{image:work.image}:{}),...( /^\d{4}-\d{2}-\d{2}$/.test(work.released??'')?{datePublished:work.released}:{}),...(work.source?{sameAs:[work.source]}:{})};
  }else if(person||producer){const p=person??producer;title=`${p.name}｜${person?'参与作品与创作资料':'制作商介绍与开发作品'}`;description=`${p.name}的${person?'创作资料与参与作品':'制作商资料与开发作品'}。资料库收录${new Set((p.works??[]).map(w=>w.id)).size}部相关游戏，查看作品中文简介、发行信息与资料来源。`;entity={'@type':person?'Person':'Organization','@id':`${url}#creator`,name:p.name,url,...(p.source?{sameAs:[p.source]}:{})};}
  else if(route==='library/'){title='Galgame作品库与创作者｜剧本家、原画师、制作商';}
  else if(parts[0]==='library'&&sectionNames[parts[1]]){const page=Number(parts[2]??1);title=`${sectionNames[parts[1]]}${page>1?`｜第${page}页`:''}`;description=parts[1]==='works'?`浏览Galgame与视觉小说作品资料，第${page}页。按中文名、原名或别名寻找作品，查看简介、发行时间、评分和创作团队。`:`浏览${sectionNames[parts[1]]}资料与相关作品，第${page}页，沿着喜欢的创作者寻找游戏。`;}
  else if(route==='periods/')title='Galgame热门作品往期榜单｜抖音与B站片段来源';
  else if(route==='about/')title='Galgame热榜收录标准与数据来源';
  const crumbs=[{name:'首页',url:`${config.origin}/`}];
  if(route){if(work||person||producer||parts[0]==='library'&&parts.length>1)crumbs.push({name:'作品与创作者',url:`${config.origin}/library/`});else if(parts[0]==='periods'&&parts.length>1)crumbs.push({name:'往期收录',url:`${config.origin}/periods/`});crumbs.push({name:work?.title??person?.name??producer?.name??title,url});}
  const graph=[{'@type':route?'WebPage':'CollectionPage','@id':`${url}#page`,url,name:title,description,inLanguage:'zh-CN',isPartOf:{'@id':`${config.origin}/#website`},...(entity?{mainEntity:{'@id':entity['@id']}}:{})}];
  if(!route)graph.push({'@type':'WebSite','@id':`${config.origin}/#website`,name:'Scurra Galgame热门发现',alternateName:['Scurra','Gal热门发现'],url,inLanguage:'zh-CN'});
  if(route)graph.push({'@type':'BreadcrumbList',itemListElement:crumbs.map((c,i)=>({'@type':'ListItem',position:i+1,name:c.name,item:c.url}))});
  if(entity)graph.push(entity);
  return {title,description,url,indexable,crumbs,image:work?.image??null,structured:{'@context':'https://schema.org','@graph':graph}};
}
export function recordPage(previous,pages,meta,content,now) {
  const hash=createHash('sha256').update(JSON.stringify({title:meta.title,description:meta.description,indexable:meta.indexable,structured:meta.structured,content})).digest('hex');
  const before=previous[meta.url];const current={hash,lastmod:before?.hash===hash?before.lastmod:now,indexable:meta.indexable};pages[meta.url]=current;
  return before?.hash!==hash||before?.indexable!==meta.indexable;
}
export function sitemapXml(pages){return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${Object.entries(pages).filter(([,p])=>p.indexable).map(([url,p])=>`<url><loc>${url.replaceAll('&','&amp;')}</loc><lastmod>${p.lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`;}
