// Idempotent migration. Preserve all storage keys and the original recommendation engine.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
await mkdir('site/quiz', { recursive: true });
let html;
try { html = await readFile('site/quiz/index.html', 'utf8'); }
catch { html = await readFile('site/index.html', 'utf8'); }
if (!html.includes('gal-discovery-quiz-migration')) {
  html = html.replaceAll('href="https://www.scurra.top/"', 'href="https://www.scurra.top/quiz/"')
    .replaceAll('content="https://www.scurra.top/"', 'content="https://www.scurra.top/quiz/"')
    .replace(/(href|src)="((?:app\.js|engine\.js|style\.css|data\/)[^"]*)"/g, '$1="../$2"')
    .replaceAll('href="beginners/"', 'href="../beginners/"')
    .replace('<body>', '<body>\n  <!-- gal-discovery-quiz-migration -->\n  <nav aria-label="网站导航" style="padding:20px 24px;font-size:14px"><a href="../" style="color:inherit">返回 Gal 热门发现</a></nav>');
  await writeFile('site/quiz/index.html', html);
}
html = html.replaceAll('app.js?v=20261025-seo', 'app.js?v=20261101-discovery');
await writeFile('site/quiz/index.html', html);
let app = await readFile('site/app.js', 'utf8');
app = app.replace("fetch(u).then", "fetch(new URL(u, import.meta.url)).then")
  .replace('href="beginners/"', 'href="${new URL(\'beginners/\', import.meta.url).href}"');
await writeFile('site/app.js', app);
let guide = await readFile('site/beginners/index.html', 'utf8');
guide = guide.replaceAll('href="../#app"', 'href="../quiz/#app"').replace('href="../">去做', 'href="../quiz/">去做').replace('href="../">返回 Gal 推荐测试', 'href="../quiz/">返回 Gal 推荐测试');
await writeFile('site/beginners/index.html', guide);
console.log('原问卷保留在 /quiz/；localStorage / sessionStorage 键保持不变。');
