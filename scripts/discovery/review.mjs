import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readJson, args } from './io.mjs';
const options = args();
const review = await readJson(options.input ?? 'data/discovery/review.json', { pending: [], warnings: [] });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rows = review.pending ?? [];
await mkdir('design/discovery', { recursive: true });
await writeFile('design/discovery/review.html', `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scurra 本地审核</title><style>body{font:14px/1.7 system-ui;background:#121212;color:#eee;max-width:1000px;margin:32px auto;padding:24px}a{color:#b8dbff}article{padding:24px 0;border-bottom:1px solid #444}textarea{width:100%;height:90px;background:#222;color:white}code{overflow-wrap:anywhere}h1{font-size:24px}</style><h1>${esc(review.periodId ?? '本期')} · 待核对 ${rows.length} 条</h1><p>核实原片段后，将对应配置复制到 <code>config/discovery-overrides.json</code> 的 evidence 中。confirmedGame 仅在确认画面来自该游戏时填写 true。删除不用的 exclude 或 workId 字段。</p>${rows.map((r) => `<article><h2>${esc(r.title)}</h2><p>${esc(r.reason)} · ${r.likes} 赞</p><p><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">打开原片段</a></p><p>候选：${(r.candidates ?? []).map(esc).join('、') || '暂无，需核对 VNDB ID'}</p><textarea readonly>${esc(JSON.stringify({ [`${r.platform}:${r.id}`]: { workId: r.candidates?.[0] ?? 'v填写ID', confirmedGame: true } }, null, 2))}</textarea></article>`).join('') || '<p>没有待核对内容。</p>'}<h2>资料补全提醒</h2><pre>${esc(JSON.stringify(review.warnings ?? [], null, 2))}</pre>`);
console.log('本地审核页：design/discovery/review.html');
