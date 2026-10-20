// 用 CLAUDE.md 里的测试玩家跑推荐，结果写到 data/test-runs.md。
// 和网页用的是同一个 site/engine.js。
//
// 用法：node scripts/simulate.mjs [每人跑几次，默认 5]

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { createEngine, formatLength } = await import(pathToFileURL(path.resolve('site/engine.js')));

const RUNS = Number(process.argv[2] ?? 5);
const OUT = 'data/test-runs.md';

const PLAYERS = [
  {
    name: '纯新人',
    desc: '只玩中文、10–30 小时、全年龄、男主角和女孩子们、第一部、想哭、校园',
    answers: { lang: 'zh', length: 'medium', rating: 'allAges', pairing: 'classic', experience: 'first', feeling: 'cry', setting: 'school' },
    dealbreakers: [],
  },
  {
    name: '推理爱好者',
    desc: '只玩中文、不限时长、男主角和女孩子们、玩过几部、伏笔、科幻、头脑派主角；雷点：恐怖',
    answers: { lang: 'zh', length: 'any', pairing: 'classic', experience: 'some', feeling: 'twist', setting: 'scifi', protagonist: 'brain' },
    dealbreakers: ['horror'],
  },
  {
    name: '老资历文学党',
    desc: '日文也行、30 小时以上、不限范围、男主角和女孩子们、老资历、想了很多、严肃一点；雷点：NTR、拔作',
    answers: { lang: 'any', length: 'long', rating: 'any', pairing: 'classic', experience: 'veteran', feeling: 'think', humor: 'serious' },
    dealbreakers: ['ntr', 'nukige'],
  },
  {
    name: '甜文党',
    desc: '只玩中文、一个周末、男主角和女孩子们、玩过很多、甜、恋爱核心；雷点：以悲剧为主、猎奇',
    answers: { lang: 'zh', length: 'short', pairing: 'classic', experience: 'many', feeling: 'sweet', romance: 'core' },
    dealbreakers: ['tragic', 'gore'],
  },
];

const vns = JSON.parse(await readFile('site/data/vns.json', 'utf8'));
const quiz = JSON.parse(await readFile('site/data/quiz.json', 'utf8'));
const engine = createEngine(vns, quiz);

const fmt = (r, rankOf) => {
  const v = r.vn;
  const re = engine.reasons(v, playerAnswers);
  const name = v.orig !== v.title ? `${v.title}（${v.orig}）` : v.title;
  return `| ${rankOf.get(v.id)} | ${name} | ${v.year ?? '?'} | ${formatLength(v)} | ${(v.rating / 10).toFixed(1)} | ${v.votes} | ${r.match.toFixed(2)} | ${re.sentence || '（无命中标签）'} |`;
};

let playerAnswers;
const lines = [`# 测试玩家结果`, '', `生成时间：${new Date().toLocaleString('zh-CN')}，每人跑 ${RUNS} 次（每次相当于一个新访客）。`, ''];
lines.push(`列说明：名次 = 按总分的排名（前 ${quiz.scoring.poolSize} 名是候选）；口味分 = 各题得分加权和（越高越对口）。`, '');

for (const p of PLAYERS) {
  playerAnswers = p.answers;
  const ranked = engine.rank(p.answers, p.dealbreakers);
  const rankOf = new Map(ranked.map((r, i) => [r.vn.id, i + 1]));
  const type = engine.playerType(p.answers);
  lines.push(`## ${p.name}`, '', `答法：${p.desc}`, '', `符合条件 ${ranked.length} 部 · 玩家类型「${type.name}」`, '');
  for (let i = 1; i <= RUNS; i++) {
    lines.push(`**第 ${i} 次**`, '', '| 名次 | 作品 | 年份 | 时长 | 评分 | 投票 | 口味分 | 推荐理由 |', '|---|---|---|---|---|---|---|---|');
    for (const r of engine.draw(ranked)) lines.push(fmt(r, rankOf));
    lines.push('');
  }
  lines.push(`<details><summary>前 ${quiz.scoring.poolSize} 名候选</summary>`, '', '| 名次 | 作品 | 年份 | 时长 | 评分 | 投票 | 口味分 | 推荐理由 |', '|---|---|---|---|---|---|---|---|');
  for (const r of ranked.slice(0, quiz.scoring.poolSize)) lines.push(fmt(r, rankOf));
  lines.push('', '</details>', '');
}

await writeFile(OUT, lines.join('\n'));
console.log(`写入 ${OUT}`);
