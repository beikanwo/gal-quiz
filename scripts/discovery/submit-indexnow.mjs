import { appendFile,writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readJson } from './io.mjs';
const config=await readJson('config/discovery.json'),seo=await readJson('config/seo.json');
const force=process.argv.includes('--force');
if(!force){
  const files=execFileSync('git',['diff-tree','--no-commit-id','--name-only','-r','HEAD'],{encoding:'utf8'}).split(/\r?\n/);
  if(!files.includes('data/discovery/indexnow-pending.json')){console.log('本提交没有新的待通知网址。');process.exit(0);}
}
const pending=await readJson('data/discovery/indexnow-pending.json',{urls:[]});
const origin=new URL(config.origin),keyLocation=new URL(seo.indexNowKeyFile,origin).href;
const urls=[...new Set(pending.urls)];
for(const value of urls){const u=new URL(value);if(u.origin!==origin.origin||u.username||u.password||u.search||u.hash)throw Error('仅允许正式域名的规范网址');}
if(!urls.length){console.log('没有需要通知的内容更新。');process.exit(0);}
const keyResponse=await fetch(keyLocation,{signal:AbortSignal.timeout(30000)});
if(keyResponse.status!==200||(await keyResponse.text()).trim()!==seo.indexNowKey)throw Error('正式域名的IndexNow校验文件尚不可用，未发送任何网址。');
const results=[];
for(let i=0;i<urls.length;i+=10000){
  const batch=urls.slice(i,i+10000);
  let result;
  for(let attempt=0;attempt<3;attempt++){
    const response=await fetch('https://api.indexnow.org/indexnow',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({host:origin.host,key:seo.indexNowKey,keyLocation,urlList:batch}),signal:AbortSignal.timeout(30000)});
    const detail=(await response.text()).replaceAll(seo.indexNowKey,'[校验码]').slice(0,300);
    result={count:batch.length,status:response.status,received:[200,202].includes(response.status),keyValidationPending:response.status===202,...(detail?{detail}:{})};
    if(response.status!==403||attempt===2)break;
    // A newly deployed verification file may not have propagated to the verifier.
    await new Promise(resolve=>setTimeout(resolve,10000*(attempt+1)));
  }
  results.push(result);
}
const report={submittedAt:new Date().toISOString(),endpoint:'https://api.indexnow.org/indexnow',results,indexingGuaranteed:false};
await writeFile(process.env.RUNNER_TEMP?`${process.env.RUNNER_TEMP}/indexnow-result.json`:'.cache/indexnow-result.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`\n## Bing / IndexNow\n${results.map(r=>`${r.count}个规范网址：HTTP ${r.status}${r.keyValidationPending?'（等待校验文件核验）':''}`).join('\n')}\n收到通知不代表已经收录。\n`);
if(results.some(r=>!r.received))process.exitCode=1;
