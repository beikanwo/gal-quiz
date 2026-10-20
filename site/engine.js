// 推荐逻辑：筛选、打分、抽取、推荐理由、玩家类型。
// 不碰页面和存储，浏览器和 Node（测试脚本）都直接用这个文件。
//
// answers      { [题目 id]: 选项 id }，没答的题不放进来
// dealbreakers [雷点选项 id]
// blocked      Set<作品 id>，玩家标过"玩过了 / 不感兴趣"的

export function createEngine(vns, quiz) {
  const S = quiz.scoring;
  const minTag = quiz.dealbreakers.minTagScore;
  const questions = new Map(quiz.questions.map((q) => [q.id, q]));

  // ---------- 片库统计 ----------

  const votesDesc = vns.map((v) => v.votes).sort((a, b) => b - a);
  const votesAtTopPct = (pct) => votesDesc[Math.max(0, Math.ceil((votesDesc.length * pct) / 100) - 1)];
  const hotVotes = votesAtTopPct(S.hotTopVotesPct);
  const gemMaxVotes = votesAtTopPct(100 - S.hiddenGem.belowVotesPercentile);

  // 可推荐作品（不含续作）的投票中位数，人气系数以它为基准
  const eligibleVotes = vns.filter((v) => !v.sequel).map((v) => v.votes).sort((a, b) => a - b);
  const medianVotes = eligibleVotes[Math.floor(eligibleVotes.length / 2)] ?? 1;

  const isHot = (v) => v.votes >= hotVotes;
  const isGem = (v) => v.votes < gemMaxVotes && v.rating >= S.hiddenGem.minRating;
  const tagScore = (v, id) => v.tags[id]?.[0] ?? 0;

  const optionOf = (answers, qid) => {
    const oid = answers[qid];
    return oid ? questions.get(qid)?.options.find((o) => o.id === oid) : undefined;
  };

  // ---------- 筛选 ----------

  function passFilter(v, f) {
    if (f.zh && !v.zh) return false;
    if (f.allAges && !v.allAges) return false;
    if (f.minutes) {
      const [lo, hi] = f.minutes;
      if (v.mins != null) {
        if (v.mins < lo || (hi != null && v.mins >= hi)) return false;
      } else if (v.length == null || !f.lengthLevels.includes(v.length)) {
        return false;
      }
    }
    if (f.excludeTags && f.excludeTags.some((id) => tagScore(v, id) >= minTag)) return false;
    if (f.requireTags && !f.requireTags.every((id) => tagScore(v, id) >= minTag)) return false;
    return true;
  }

  function passPopularity(v, p) {
    if (p.onlyTopVotesPct) return v.votes >= votesAtTopPct(p.onlyTopVotesPct);
    return true;
  }

  function hitsDealbreaker(v, d) {
    if (d.tags) return d.tags.some((id) => tagScore(v, id) >= minTag);
    if (d.voiced != null) return v.voiced === d.voiced;
    return false;
  }

  // 把条件拆成一条条规则，方便"不到 3 部时找出是哪条太严"
  function rules(answers, dealbreakers) {
    const out = [];
    for (const q of quiz.questions) {
      const o = optionOf(answers, q.id);
      if (o?.filter) out.push({ kind: 'question', qid: q.id, label: q.short, test: (v) => passFilter(v, o.filter) });
      if (o?.popularity?.onlyTopVotesPct) out.push({ kind: 'question', qid: q.id, label: q.short, test: (v) => passPopularity(v, o.popularity) });
    }
    for (const id of dealbreakers) {
      const d = quiz.dealbreakers.options.find((o) => o.id === id);
      if (d) out.push({ kind: 'dealbreaker', id, label: d.label, test: (v) => !hitsDealbreaker(v, d) });
    }
    return out;
  }

  // 续作 / 外传 / FD 永远不直接推荐；玩家屏蔽过的也去掉
  const eligible = (v, blocked) => !v.sequel && !blocked.has(v.id);

  function filterPool(answers, dealbreakers = [], blocked = new Set()) {
    const rs = rules(answers, dealbreakers);
    return vns.filter((v) => eligible(v, blocked) && rs.every((r) => r.test(v)));
  }

  // 不到 3 部时：把每条规则单独拿掉，看能多出多少部，多的排前面
  function diagnose(answers, dealbreakers = [], blocked = new Set()) {
    const rs = rules(answers, dealbreakers);
    const base = vns.filter((v) => eligible(v, blocked));
    return rs
      .map((r) => ({ ...r, count: base.filter((v) => rs.every((x) => x === r || x.test(v))).length }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .map(({ test, ...r }) => ({ ...r, relaxTo: r.kind === 'question' ? questions.get(r.qid).relaxTo : undefined }));
  }

  // ---------- 打分 ----------

  // 已回答的口味题：[{ q, o, weight, pos, neg, maxPos, negSum }]
  function tasteAnswers(answers) {
    const out = [];
    for (const q of quiz.questions) {
      if (q.kind !== 'taste') continue;
      const o = optionOf(answers, q.id);
      if (!o?.tags) continue;
      const entries = Object.entries(o.tags);
      const pos = entries.filter(([, w]) => w > 0);
      const neg = entries.filter(([, w]) => w < 0);
      out.push({
        q,
        o,
        weight: q.weight ?? 1,
        pos,
        neg,
        maxPos: Math.max(0, ...pos.map(([, w]) => w)),
        negSum: neg.reduce((s, [, w]) => s - w, 0),
      });
    }
    return out;
  }

  // 一道口味题的得分，落在 -1 到 1：
  //   加分部分按"任一命中"：1 − Π(1 − 权重/最大权重 × 标签分数/3)。命中一个就能拿高分，多命中只是锦上添花，
  //   所以给选项多挂标签不会把分数摊薄。
  //   减分部分 = Σ(|权重| × 标签分数/3) ÷ 负权重绝对值之和。
  function questionScore(v, { pos, neg, maxPos, negSum }) {
    let miss = 1;
    for (const [id, w] of pos) miss *= 1 - ((w / maxPos) * tagScore(v, id)) / 3;
    let minus = 0;
    for (const [id, w] of neg) minus += (-w * tagScore(v, id)) / 3;
    return (pos.length ? 1 - miss : 0) - (neg.length ? minus / negSum : 0);
  }

  // 没勾的雷点里带 softPenalty 的（拔作、Netori），按标签分数降权
  function softPenalties(dealbreakers) {
    return quiz.dealbreakers.options.filter((d) => d.softPenalty && !dealbreakers.includes(d.id));
  }

  function scoreVn(v, taste, pop, penalties) {
    let match = 0;
    for (const t of taste) match += t.weight * questionScore(v, t);
    // 人气系数：口味分打平时（只答了一两道口味题很常见）把公认的作品排前面
    let popularity = Math.pow(v.votes / medianVotes, pop.votesAlpha ?? S.defaultVotesAlpha);
    if (pop.hotMultiplier && isHot(v)) popularity *= pop.hotMultiplier;
    if (pop.hiddenGemBonus && isGem(v)) popularity *= 1 + pop.hiddenGemBonus;
    const q = S.quality;
    const quality = q.base + q.span * Math.min(1, Math.max(0, (v.rating - q.ratingFloor) / q.ratingRange));
    let penalty = 1;
    for (const d of penalties) {
      const ids = d.softPenaltyTags ?? d.tags;
      penalty *= 1 - (d.softPenalty * Math.max(...ids.map((id) => tagScore(v, id)))) / 3;
    }
    return { match, total: Math.exp(S.matchSharpness * match) * popularity * quality * penalty };
  }

  // 返回按总分从高到低排好的 [{ vn, match, total }]。
  // 答了口味题时，口味分达到 minMatch 的作品整体排在前面，免得人气、评分加成把不对口的作品顶上来。
  function rank(answers, dealbreakers = [], blocked = new Set()) {
    const pool = filterPool(answers, dealbreakers, blocked);
    const taste = tasteAnswers(answers);
    const pop = optionOf(answers, 'experience')?.popularity ?? {};
    const penalties = softPenalties(dealbreakers);
    const tiered = taste.some(({ o }) => Object.values(o.tags).some((w) => w > 0));
    const tier = (r) => (tiered && r.match < S.minMatch ? 0 : 1);
    return pool
      .map((vn) => ({ vn, ...scoreVn(vn, taste, pop, penalties) }))
      .sort((a, b) => tier(b) - tier(a) || b.total - a.total);
  }

  // ---------- 抽取 ----------

  // 从排名里按总分加权抽 count 部，跳过 exclude 里的。
  // 候选是前 poolSize 部里没出现过的；不够 count 部时，改成往下数没出现过的 poolSize 部，
  // 保证"换一批"一直有新的（匹配度会逐渐下降）。
  function draw(ranked, count = S.pickCount, exclude = new Set(), random = Math.random) {
    const fresh = (list) => list.filter((r) => !exclude.has(r.vn.id));
    let cand = fresh(ranked.slice(0, S.poolSize));
    if (cand.length < count) cand = fresh(ranked).slice(0, S.poolSize);
    const picks = [];
    while (picks.length < count && cand.length) {
      const sum = cand.reduce((s, r) => s + r.total, 0);
      let x = random() * sum;
      let i = 0;
      while (i < cand.length - 1 && (x -= cand[i].total) > 0) i++;
      picks.push(cand.splice(i, 1)[0]);
    }
    return picks;
  }

  // ---------- 推荐理由 ----------

  // 对得分贡献最大的 2–3 个标签（正权重、分数够、无剧透），去重
  function reasons(v, answers, max = 3) {
    const contrib = new Map();
    for (const { weight, pos, maxPos } of tasteAnswers(answers)) {
      for (const [id, w] of pos) {
        const t = v.tags[id];
        if (!t || t[1] !== 0 || t[0] < S.minReasonTagScore || !quiz.tags[id]?.phrase) continue;
        const c = (weight * (w / maxPos) * t[0]) / 3;
        contrib.set(id, Math.max(contrib.get(id) ?? 0, c));
      }
    }
    const ids = [...contrib.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([id]) => id);
    return {
      labels: ids.map((id) => quiz.tags[id].label),
      sentence: ids.length ? ids.map((id) => quiz.tags[id].phrase).join('，') + '。' : '',
    };
  }

  // ---------- 玩家类型 ----------

  function playerType(answers) {
    const t = quiz.playerTypes[answers.feeling] ?? quiz.playerTypes.default;
    // 其他已回答口味题的选项，作为补充说明
    const prefs = quiz.questions
      .filter((q) => q.kind === 'taste' && q.id !== 'feeling')
      .map((q) => optionOf(answers, q.id))
      .filter((o) => o?.tags)
      .map((o) => o.label);
    return { ...t, prefs };
  }

  return { filterPool, diagnose, rank, draw, reasons, playerType, stats: { hotVotes, gemMaxVotes, medianVotes, total: vns.length } };
}

// ---------- 展示用小工具 ----------

const LENGTH_LEVELS = { 1: '2 小时内', 2: '2–10 小时', 3: '10–30 小时', 4: '30–50 小时', 5: '50 小时以上' };

export function formatLength(v) {
  if (v.mins != null) return v.mins < 60 ? '不到 1 小时' : `约 ${Math.round(v.mins / 60)} 小时`;
  return LENGTH_LEVELS[v.length] ?? '时长未知';
}
