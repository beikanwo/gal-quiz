import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createEngine, chineseReceptionFactor } from '../site/engine.js';

const vns = JSON.parse(await readFile('site/data/vns.json', 'utf8'));
const quiz = JSON.parse(await readFile('site/data/quiz.json', 'utf8'));
const snapshot = JSON.parse(await readFile('config/chinese-reception.json', 'utf8'));
const previous = structuredClone(quiz);
delete previous.scoring.chineseReception;
previous.scoring.quality = { base: 0.8, span: 0.2, ratingFloor: 65, ratingRange: 35 };
const before = createEngine(vns, previous), after = createEngine(vns, quiz);
const players = [
  { name: '纯新人', answers: { lang: 'zh', length: 'medium', rating: 'allAges', pairing: 'classic', experience: 'first', feeling: 'cry', setting: 'school' }, db: [] },
  { name: '推理爱好者', answers: { lang: 'zh', length: 'any', pairing: 'classic', experience: 'some', feeling: 'twist', setting: 'scifi', protagonist: 'brain' }, db: ['horror'] },
  { name: '老资历文学党', answers: { lang: 'any', length: 'long', rating: 'any', pairing: 'classic', experience: 'veteran', feeling: 'think', humor: 'serious' }, db: ['ntr', 'nukige'] },
  { name: '甜文党', answers: { lang: 'zh', length: 'short', pairing: 'classic', experience: 'many', feeling: 'sweet', romance: 'core' }, db: ['tragic', 'gore'] },
];
const seeded = (seed) => () => {
  let t = seed += 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const cfg = quiz.scoring.chineseReception;
assert.equal(chineseReceptionFactor({}, cfg), 1);
assert.equal(chineseReceptionFactor({ cn: { bangumi: { score: 10, votes: 1 } } }, cfg), 1);
assert.equal(chineseReceptionFactor({ cn: { bangumi: { score: 6, votes: 10000 } } }, cfg), 1);
assert.ok(chineseReceptionFactor({ cn: { bangumi: { score: 9, votes: 10000 }, kungal: { score: 10, votes: 10000 } } }, cfg) <= 1.8);
for (const v of vns) {
  const factor = chineseReceptionFactor(v, cfg);
  assert.ok(Number.isFinite(factor) && factor >= 1 && factor <= 1.8);
}
const report = ['# 中文社区口碑调研与推荐调整', '', `数据快照：${snapshot.updatedAt}。测试随机种子：20261024 + 玩家编号 × 100 + 轮次。`, '',
  '## 调研结论与证据边界', '',
  '- 国内玩家并非单一口味；Bangumi 的综合评分和人数作为主要中文口碑信号，KUN 本站评分作为补充。剧情、推理、恋爱等偏好仍由问卷决定，不从几条帖子推断所有人的审美。',
  '- Bangumi 公共 API 取得的榜单并不涵盖全部成人条目；另采集 KUN 公开作品页中明确标注来源的 Bangumi 评分补齐，并注明镜像来源。镜像分不作为另一份独立投票。',
  '- KUN 的八维评分与普通算术均分不同，不与 VNDB/Bangumi 分数直接平均；本站样本至少 20 人才使用，且最多加 10%。',
  '- TouchGal 的公开搜索索引可见评分和浏览量，完整页面遇到访问验证，评分人数无法核对。浏览量不能代表口碑，未给任何作品伪造 TouchGal 加分。',
  '- galgame吧年度票选只覆盖当年作品，原帖完整结果返回 403；个人排名更不能代表社区共识。只记录研究出处，不把搜索摘要当作完整票数导入。',
  '- 映射只接受作品原名/中文名精确规范化匹配且发售年份相差不超过一年，或 KUN 明确的 VNDB ID。不同版本在同一平台取人数最多的一条，不相加；无法确认的记录留在未匹配报告。', '',
  '## 来源', '', ...snapshot.sources.map((s) => `- [${s.name}](${s.url})：${s.use}`), '',
  '## 实现规则', '',
  '- 总分仍由问卷口味主导；另乘中文口碑系数，范围 1–1.8，只有加分。没有中文数据保持 1。硬条件、雷点、剧透保护和前 15 候选不变。',
  '- Bangumi：至少 100 人；加分 = 0.7 × clamp((评分−7.2)/1.8, 0, 1) × 人数/(人数+300)。',
  '- KUN：至少 20 人；加分 = 0.1 × 同样的评分归一化 × 人数/(人数+50)。两者加分相加，上限 0.8。',
  '- VNDB 质量兜底由 0.8–1 调为 0.9–1，继续保留原始 VNDB 评分展示，不把混合推荐分伪装成某平台评分。',
  '- 第一部：原 VNDB 前 20% 人气范围之外，Bangumi 至少 500 人且评分至少 7.2 的作品也可进入；中文人气达到 2000 人、评分至少 7.2 时，也按热门处理，避免给老玩家当冷门反复推荐。',
  '- VNDB 采集门槛仍为评分≥6.5、投票≥50；不在当前 3870 部库内的国产新作等仍不会凭空出现。', '',
  `## 覆盖数字`, '', `- 原始 Bangumi 榜单样本：${snapshot.stats.bgmFetched}；KUN 作品：${snapshot.stats.kunFetched}。`,
  `- 精确对应到现有片库：${snapshot.stats.mapped} 部；Bangumi ${snapshot.stats.bangumi} 部，KUN 本站达到门槛 ${snapshot.stats.kungal} 部。`,
  `- 实际获得加分：${vns.filter((v) => chineseReceptionFactor(v, cfg) > 1).length} 部；可直接推荐（非续作）：${vns.filter((v) => !v.sequel && chineseReceptionFactor(v, cfg) > 1).length} 部。`, '',
  '## 部分作品的中文口碑系数', '', '| 作品 | VNDB | Bangumi / 人数 | KUN / 人数 | 系数 |', '|---|---|---|---|---|'];
const samples = vns.filter((v) => !v.sequel && v.cn).sort((a, b) => chineseReceptionFactor(b, cfg) - chineseReceptionFactor(a, cfg)).slice(0, 20);
for (const v of samples) {
  const r = snapshot.entries[v.id];
  const source = (key) => r[key] ? `[${r[key].score} / ${r[key].votes}](${r[key].url})` : '—';
  report.push(`| ${v.title} | ${(v.rating / 10).toFixed(2)} | ${source('bangumi')} | ${source('kungal')} | ×${chineseReceptionFactor(v, cfg).toFixed(3)} |`);
}
for (let pi = 0; pi < players.length; pi++) {
  const p = players[pi], oldRank = before.rank(p.answers, p.db), newRank = after.rank(p.answers, p.db);
  const oldPos = new Map(oldRank.map((r, i) => [r.vn.id, i + 1]));
  report.push('', `## ${p.name}：前后对比及 5 次抽取`, '', `符合条件：${oldRank.length} → ${newRank.length} 部。`, '', '| 新名次 | 原名次 | 作品 | 中文系数 | 口味分 |', '|---|---|---|---|---|');
  for (const [i, r] of newRank.slice(0, 15).entries()) report.push(`| ${i + 1} | ${oldPos.get(r.vn.id) ?? '新增中文人气候选'} | ${r.vn.title} | ×${r.reception.toFixed(3)} | ${r.match.toFixed(3)} |`);
  const rules = quiz.dealbreakers.options.filter((d) => p.db.includes(d.id));
  for (let run = 1; run <= 5; run++) {
    const picks = after.draw(newRank, 3, new Set(), seeded(20261024 + pi * 100 + run));
    assert.equal(new Set(picks.map((r) => r.vn.id)).size, picks.length);
    for (const r of picks) {
      assert.ok(!r.vn.sequel);
      if (p.answers.lang === 'zh') assert.ok(r.vn.zh);
      if (p.answers.rating === 'allAges') assert.ok(r.vn.allAges);
      for (const d of rules) if (d.tags) assert.ok(!d.tags.some((id) => (r.vn.tags[id]?.[0] ?? 0) >= quiz.dealbreakers.minTagScore));
      const prior = oldRank.find((x) => x.vn.id === r.vn.id);
      if (prior) assert.equal(prior.match, r.match, '社区口碑不得更改口味匹配分');
    }
    report.push('', `第 ${run} 次：${picks.map((r) => r.vn.title).join(' ／ ')}。`);
  }
}
report.push('', '检查通过：中文系数有上限、无数据/小样本中性；20 轮抽取无重复，未越过已选语言、全年龄、雷点和续作限制，既有作品口味分不变。', '');
await writeFile('data/chinese-reception-report.md', report.join('\n'));
console.log(`中文口碑测试通过，报告：data/chinese-reception-report.md；覆盖 ${snapshot.stats.mapped} 部。`);
