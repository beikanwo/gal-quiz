import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createEngine, normalizeAnswers, selectedOptions, toggleSelection, sessionQuestionIndex } from '../site/engine.js';

const quiz = JSON.parse(await readFile('site/data/quiz.json', 'utf8'));
const vns = JSON.parse(await readFile('site/data/vns.json', 'utf8'));
const engine = createEngine(vns, quiz);
const feeling = quiz.questions.find((q) => q.id === 'feeling');
const setting = quiz.questions.find((q) => q.id === 'setting');
assert.equal(quiz.questions.length, 11);
assert.ok(!quiz.questions.some((q) => q.id === 'protagonist'));
assert.deepEqual(normalizeAnswers(quiz, { feeling: 'cry', setting: 'scifi', protagonist: 'brain', lang: 'zh' }), { lang: 'zh', feeling: ['cry'], setting: ['scifi'] });
assert.deepEqual(selectedOptions(feeling, ['cry', 'cry', 'invalid', 'twist', 'think']).map((o) => o.id), ['cry', 'twist']);
assert.deepEqual(toggleSelection(feeling, ['cry', 'twist'], 'think'), { ids: ['cry', 'twist'], limited: true });
assert.deepEqual(toggleSelection(feeling, ['cry', 'twist'], 'cry').ids, ['twist']);
assert.deepEqual(toggleSelection(setting, ['school', 'fantasy'], 'any').ids, ['any']);
assert.deepEqual(toggleSelection(setting, ['any'], 'scifi').ids, ['scifi']);
assert.deepEqual(toggleSelection(setting, ['any'], 'any').ids, []);
assert.equal(sessionQuestionIndex(quiz, { qIndex: 8 }), 8); // 旧主角题 → 恋爱题
assert.equal(sessionQuestionIndex(quiz, { qIndex: 9 }), 8); // 旧恋爱题不跳到笑点题
assert.equal(sessionQuestionIndex(quiz, { qIndex: 11 }), 10);
assert.equal(sessionQuestionIndex(quiz, { qIndex: 9, questionId: 'humor', questionnaireVersion: 2 }), 9);

const matches = (answers) => new Map(engine.rank(answers).map((r) => [r.vn.id, r.match]));
for (const [qid, a, b] of [['feeling', 'cry', 'twist'], ['setting', 'school', 'fantasy']]) {
  const one = matches({ [qid]: [a] }), two = matches({ [qid]: [b] });
  const combined = matches({ [qid]: [a, b] }), reversed = matches({ [qid]: [b, a] });
  const legacy = matches({ [qid]: a });
  for (const [id, value] of combined) {
    assert.equal(value, Math.max(one.get(id), two.get(id)), `${qid} 每题取最大值，不累加`);
    assert.equal(value, reversed.get(id), '选项顺序不影响得分');
    assert.equal(one.get(id), legacy.get(id), '旧单选记录与新单项数组同分');
  }
}
assert.deepEqual(engine.rank({ setting: ['any'] }).map((r) => [r.vn.id, r.match, r.total]), engine.rank({}).map((r) => [r.vn.id, r.match, r.total]));
const type = engine.playerType({ feeling: ['cry', 'twist'], setting: ['school', 'fantasy'] });
assert.ok(type.name.includes(quiz.playerTypes.cry.name) && type.name.includes(quiz.playerTypes.twist.name));
assert.deepEqual(type, engine.playerType({ feeling: ['twist', 'cry'], setting: ['fantasy', 'school'] }));
assert.equal(type.prefs.length, 2);
assert.ok(Object.keys(setting.options.find((o) => o.id === 'real').tags).every((id) => !['Crime', 'Adult Protagonist'].includes(quiz.tags[id].name)));

const real = setting.options.find((o) => o.id === 'real');
const realism = Object.entries(quiz.tags).find(([, t]) => t.name === 'Slice of Life Realism')[0];
const family = Object.entries(quiz.tags).find(([, t]) => t.name === 'Family Drama')[0];
const report = ['# 问卷易选性调整与回归检查', '', '2026-10-25：11 道问卷 + 1 道雷点；第 6 题最多两项，第 8 题多选，主角题移除。', '',
  '多选语义为“这些方向任一匹配即可”；每道题取所选选项分数最大值，再乘该题权重，不把分数相加。不在意背景与具体背景互斥。', '',
  '## 现实生活标签核对', '',
  `- 写实日常：${realism} Slice of Life Realism，现有片库 ${vns.filter((v) => v.tags[realism]).length} 部有标签。`,
  `- 家庭关系：${family} Family Drama，现有片库 ${vns.filter((v) => v.tags[family]).length} 部有标签。`,
  '- 新标签均与 VNDB 官方标签导出精确匹配。取消犯罪/成人主角代理，现代背景仅 0.25 权重；这只是偏好加分，不保证所有作品完全写实。', '',
  '## 回归检查', '',
  '- 全部可推荐作品验证：两项的每题分数恰好等于单项分数的最大值，选项顺序不影响结果。',
  '- 旧单选字符串转换为数组；主角答案清理，题号迁移保留原题语义；选满、取消及“不在意”互斥通过。',
  '- 玩家类型与偏好展示兼容两项选择，推荐理由只使用每题实际得分最高的选项，仍排除剧透标签。', '',
  '## 两组多选玩家：各 5 次', '',
];
const players = [
  { name: '感人或悬念 / 校园或科幻', answers: { lang: 'zh', rating: 'allAges', pairing: 'classic', feeling: ['cry', 'twist'], setting: ['school', 'scifi'] }, db: ['ntr', 'nukige'] },
  { name: '思考或沉重 / 现实或奇幻', answers: { lang: 'zh', length: 'long', feeling: ['think', 'haunted'], setting: ['real', 'fantasy'] }, db: ['gore'] },
];
const seeded = (seed) => () => {
  let t = seed += 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
for (const [pi, p] of players.entries()) {
  const rank = engine.rank(p.answers, p.db);
  const withoutTaste = Object.fromEntries(Object.entries(p.answers).filter(([id]) => !['feeling', 'setting'].includes(id)));
  assert.equal(rank.length, engine.filterPool(withoutTaste, p.db).length, '口味多选不得变成硬筛选');
  report.push(`### ${p.name}`, '', `符合硬条件 ${rank.length} 部。`, '');
  for (let i = 1; i <= 5; i++) {
    const picks = engine.draw(rank, 3, new Set(), seeded(20261025 + pi * 100 + i));
    assert.equal(new Set(picks.map((r) => r.vn.id)).size, 3);
    for (const { vn } of picks) {
      assert.ok(vn.zh && !vn.sequel);
      if (p.answers.rating === 'allAges') assert.ok(vn.allAges);
      if (p.answers.length === 'long') assert.ok(vn.mins != null ? vn.mins >= 1800 : [4, 5].includes(vn.length));
      for (const d of quiz.dealbreakers.options.filter((d) => p.db.includes(d.id))) assert.ok(!d.tags.some((id) => (vn.tags[id]?.[0] ?? 0) >= quiz.dealbreakers.minTagScore));
      for (const label of engine.reasons(vn, p.answers).labels) {
        const tag = Object.entries(quiz.tags).find(([, t]) => t.label === label)?.[0];
        assert.equal(vn.tags[tag][1], 0);
      }
    }
    report.push(`- 第 ${i} 次：${picks.map((r) => r.vn.title).join(' ／ ')}。`);
  }
  report.push('');
}
report.push('原 4 个测试玩家各 5 次的完整结果另见 [test-runs.md](test-runs.md)。', '');
await writeFile('data/questionnaire-update-report.md', report.join('\n'));
console.log('问卷回归检查通过：多选最大值、上限/互斥、旧会话迁移、类型/理由及硬条件；报告 data/questionnaire-update-report.md。');
