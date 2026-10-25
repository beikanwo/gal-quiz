// 页面渲染和交互。推荐逻辑都在 engine.js。

import { createEngine, formatLength, selectedOptions, normalizeAnswers, toggleSelection, sessionQuestionIndex } from './engine.js?v=20261025-multi';
import { initFeedback } from './feedback.js?v=20261025-multi';

const app = document.getElementById('app');
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// ---------- 本地存储（读写失败也要能正常用） ----------

const STORE_KEYS = { played: 'galquiz.played', skip: 'galquiz.notInterested', want: 'galquiz.want' };

function loadSet(key) {
  try {
    const arr = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveSet(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // 存不了就只在这次访问里生效
  }
}

const marks = {
  played: loadSet(STORE_KEYS.played),
  skip: loadSet(STORE_KEYS.skip),
  want: loadSet(STORE_KEYS.want),
};
const blocked = () => new Set([...marks.played, ...marks.skip]);

// ---------- 状态 ----------

let engine;
let quiz;
let vnById;
const state = {
  screen: 'start',  // start | quiz | dealbreakers | result | wants
  qIndex: 0,
  answers: {},
  dealbreakers: new Set(),
  ranked: [],       // 当前条件下的排名（不含已屏蔽的）
  current: [],      // 正在展示的 3 部
  shown: new Set(), // 这轮已经展示过的，换一批时尽量不重复
  back: 'start',    // 想玩清单返回到哪个画面
};

// ---------- 工具 ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');

let typing = null; // 正在逐字打出的题目

function render() {
  const screens = { start: renderStart, quiz: renderQuiz, dealbreakers: renderDealbreakers, result: renderResult, wants: renderWants };
  stopTyping();
  document.documentElement.dataset.screen = state.screen;
  app.innerHTML = screens[state.screen]();
  startTyping();
  saveSession();
}

// ---------- 会话（点开 VNDB / Bangumi 再返回时恢复原来的页面） ----------
// 手机浏览器和 App 内置浏览器常常在当前页打开外链，返回时整页重新加载。
// 所以把当前画面存进 sessionStorage（只在这个标签页里有效），加载时恢复。

const SESSION_KEY = 'galquiz.session';

function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      screen: state.screen,
      qIndex: state.qIndex,
      questionId: quiz?.questions[state.qIndex]?.id,
      questionnaireVersion: 2,
      answers: state.answers,
      dealbreakers: [...state.dealbreakers],
      current: state.current.map((r) => r.vn.id),
      shown: [...state.shown],
      back: state.back,
      scrollY: window.scrollY,
    }));
  } catch {
    // 存不了就算了，返回时从开始页重来
  }
}

function restoreSession() {
  let s;
  try {
    s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return false;
  }
  if (!s || !['quiz', 'dealbreakers', 'result', 'wants'].includes(s.screen)) return false;
  state.screen = s.screen;
  state.qIndex = sessionQuestionIndex(quiz, s);
  state.answers = normalizeAnswers(quiz, s.answers);
  state.dealbreakers = new Set(Array.isArray(s.dealbreakers) ? s.dealbreakers : []);
  state.back = s.back === 'result' ? 'result' : 'start';
  if (state.screen === 'result' || state.back === 'result') {
    // 重新排名，但保留原来那 3 部；数据更新后找不到的就补抽
    state.ranked = engine.rank(state.answers, [...state.dealbreakers], blocked());
    const byId = new Map(state.ranked.map((r) => [r.vn.id, r]));
    state.current = (s.current ?? []).map((id) => byId.get(id)).filter(Boolean);
    state.shown = new Set([...(s.shown ?? []), ...state.current.map((r) => r.vn.id)]);
    const missing = quiz.scoring.pickCount - state.current.length;
    if (missing > 0) {
      const more = engine.draw(state.ranked, missing, new Set([...state.shown]));
      state.current.push(...more);
      more.forEach((r) => state.shown.add(r.vn.id));
    }
  }
  render();
  const y = Number(s.scrollY) || 0;
  window.scrollTo(0, y);
  setTimeout(() => window.scrollTo(0, y), 50); // 版面稳定后再滚一次
  return true;
}

// 滚动位置自己管：浏览器默认的恢复发生在数据加载完之前，那时页面还是空的，会被重置到顶部
try {
  history.scrollRestoration = 'manual';
} catch {
  // 老浏览器不支持就算了
}

// 离开页面（包括点外链在当前页打开）前记下滚动位置
window.addEventListener('pagehide', saveSession);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveSession();
});

function go(screen) {
  if ((screen === 'result' || screen === 'wants') && !engine) return;
  state.screen = screen;
  if (screen === 'result') computeResult();
  render();
  window.scrollTo(0, 0);
}

// 题目像 gal 一样逐字打出；点文本框直接显示全文
function startTyping() {
  const el = app.querySelector('[data-type]');
  if (!el || reduceMotion) return;
  const full = el.dataset.type;
  let i = 0;
  el.textContent = '';
  typing = { el, full, timer: setInterval(() => {
    el.textContent = full.slice(0, ++i);
    if (i >= full.length) stopTyping();
  }, 45) };
}

function stopTyping() {
  if (!typing) return;
  clearInterval(typing.timer);
  typing.el.textContent = typing.full;
  typing = null;
}

// ---------- 封面 ----------

// 数据里只有完全安全的封面才有 img（见 build-data）；没有的用标题首字做文字卡片
function renderCover(vn) {
  if (vn.img) return `<div class="cover"><img src="${esc(vn.img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`;
  const first = Array.from(vn.title.trim())[0] ?? '?';
  return `<div class="cover text" aria-hidden="true"><span>${esc(first)}</span></div>`;
}

const links = (vn) => `
  <span class="links">
    <a href="https://vndb.org/${esc(vn.id)}" target="_blank" rel="noopener">VNDB</a>
    <a href="${vn.cn?.bangumi?.id ? `https://bgm.tv/subject/${vn.cn.bangumi.id}` : `https://bgm.tv/subject_search/${encodeURIComponent(vn.orig)}?cat=4`}" target="_blank" rel="noopener">Bangumi</a>
  </span>`;

// ---------- 开始页 ----------

function renderStart() {
  const wants = marks.want.size;
  return `
    <section class="screen title-screen">
      <div class="kicker">Gal 推荐测试</div>
      <h1>测测你适合<br>哪部 Gal</h1>
      <p class="lead">不知道下一部 Gal 玩什么？答 ${quiz.questions.length} 道题，再勾一下雷点，从 ${engine?.stats.total ?? '数千'} 部作品里给你挑 3 部 Galgame 推荐。免费，不用注册，每道题都能跳过。</p>
      <nav class="menu">
        <button class="first" data-action="begin"><span class="label">开始</span></button>
        <button data-action="wants" ${engine ? '' : 'disabled'}><span class="label">想玩清单</span><small>${wants ? `${wants} 部` : '还是空的'}</small></button>
      </nav>
      <p class="start-links"><a href="beginners/">第一次玩？先看新手 Gal 推荐</a> · <a href="#how-it-works">了解这个测试</a></p>
    </section>`;
}

// ---------- 答题页 ----------

function renderQuestionScreen({ index, total, name, text, hint, options, footer }) {
  return `
    <section class="screen">
      <div class="top">
        <span class="count">${pad(index)} <span>/ ${total}</span></span>
        <div class="bar"><i style="width:${(100 * index) / total}%"></i></div>
      </div>
      <div class="textbox" data-action="finish-typing">
        <span class="name">${esc(name)}</span>
        <p class="q" data-type="${esc(text)}">${esc(text)}</p>
        <p class="hint">${hint}</p>
      </div>
      <div class="choices">${options}</div>
      <div class="nav">${footer}</div>
    </section>`;
}

function renderQuiz() {
  const q = quiz.questions[state.qIndex];
  const picked = selectedOptions(q, state.answers[q.id]).map((o) => o.id);
  const remain = engine?.filterPool(state.answers, [], blocked()).length;
  return renderQuestionScreen({
    index: state.qIndex + 1,
    total: quiz.questions.length + 1,
    name: `第 ${state.qIndex + 1} 题`,
    text: q.text,
    hint: `${q.hint ? `${esc(q.hint)}<br>` : ''}<span class="remaining">${remain == null ? '你可以先答题，作品还在准备中…' : `目前符合条件：${remain} 部`}</span>${q.multiple ? `<br><span class="selection-count">已选 ${picked.length} 项${q.maxSelections ? ` / 最多 ${q.maxSelections} 项` : ''}</span>` : ''}`,
    options: q.options
      .map((o, i) => `<button class="choice${q.multiple ? ' multi' : ''}${picked.includes(o.id) ? ' picked' : ''}" data-action="answer" data-option="${esc(o.id)}"${q.multiple ? ` aria-pressed="${picked.includes(o.id)}"` : ''}><kbd>${i + 1}</kbd><span class="choice-label">${esc(o.label)}</span>${o.description ? `<small class="choice-description">${esc(o.description)}</small>` : ''}${q.multiple ? '<span class="choice-check" aria-hidden="true">✓</span>' : ''}</button>`)
      .join('') + (q.multiple ? '<p class="selection-status" role="status" aria-live="polite"></p>' : ''),
    footer: `
      <button data-action="prev" ${state.qIndex === 0 ? 'disabled' : ''}>‹ 上一题</button>
      <div class="nav-forward"><button data-action="skip">跳过 ›</button>${q.multiple ? `<button class="btn primary" data-action="next" ${picked.length ? '' : 'disabled'}>下一题 ›</button>` : ''}</div>`,
  });
}

function answer(optionId) {
  const q = quiz.questions[state.qIndex];
  if (q.multiple) {
    const result = toggleSelection(q, state.answers[q.id], optionId);
    if (result.ids.length) state.answers[q.id] = result.ids;
    else delete state.answers[q.id];
    app.querySelectorAll('[data-action="answer"]').forEach((btn) => {
      const picked = result.ids.includes(btn.dataset.option);
      btn.classList.toggle('picked', picked);
      btn.setAttribute('aria-pressed', String(picked));
    });
    app.querySelector('.selection-count').textContent = `已选 ${result.ids.length} 项${q.maxSelections ? ` / 最多 ${q.maxSelections} 项` : ''}`;
    app.querySelector('.selection-status').textContent = result.limited ? '最多选两项，先取消一项就能换。' : '';
    app.querySelector('[data-action="next"]').disabled = !result.ids.length;
    saveSession();
    return;
  }
  state.answers[q.id] = optionId;
  nextQuestion();
}

function nextQuestion() {
  if (state.qIndex < quiz.questions.length - 1) {
    state.qIndex++;
    render();
    window.scrollTo(0, 0);
  } else {
    go('dealbreakers');
  }
}

function skipQuestion() {
  delete state.answers[quiz.questions[state.qIndex].id];
  nextQuestion();
}

// ---------- 雷点页 ----------

function renderDealbreakers() {
  const db = quiz.dealbreakers;
  const total = quiz.questions.length + 1;
  const remain = engine?.filterPool(state.answers, [...state.dealbreakers], blocked()).length;
  return renderQuestionScreen({
    index: total,
    total,
    name: '最后一题',
    text: db.text,
    hint: `勾上的会直接排除，宁可少推荐也不让你踩雷 · ${remain == null ? '作品还在准备中…' : `目前符合条件：${remain} 部`}`,
    options: db.options
      .map((o, i) => `<button class="choice${state.dealbreakers.has(o.id) ? ' picked' : ''}" data-action="toggle-db" data-id="${esc(o.id)}" aria-pressed="${state.dealbreakers.has(o.id)}"><kbd>${i + 1}</kbd>${esc(o.label)}</button>`)
      .join(''),
    footer: `
      <button data-action="back-to-quiz">‹ 上一题</button>
      <button class="btn primary" data-action="show-result" ${engine ? '' : 'disabled'}>${engine ? '看结果' : '正在准备作品…'}</button>`,
  });
}

// ---------- 结果 ----------

function computeResult() {
  state.ranked = engine.rank(state.answers, [...state.dealbreakers], blocked());
  state.shown = new Set();
  state.current = engine.draw(state.ranked);
  state.current.forEach((r) => state.shown.add(r.vn.id));
}

function reshuffle() {
  let picks = engine.draw(state.ranked, undefined, state.shown);
  if (!picks.length) {
    // 全都看过一遍了，从头再来
    state.shown = new Set();
    picks = engine.draw(state.ranked, undefined, new Set(state.current.map((r) => r.vn.id)));
  }
  state.current = picks;
  picks.forEach((r) => state.shown.add(r.vn.id));
  render();
  window.scrollTo(0, 0);
}

// 玩过了 / 不感兴趣：记下来，从排名里拿掉，单独换掉这一张
function dismiss(id, kind) {
  marks[kind].add(id);
  saveSet(STORE_KEYS[kind], marks[kind]);
  state.ranked = state.ranked.filter((r) => r.vn.id !== id);
  const exclude = new Set([...state.shown, ...state.current.map((r) => r.vn.id)]);
  const [next] = engine.draw(state.ranked, 1, exclude);
  state.current = state.current.flatMap((r) => (r.vn.id !== id ? [r] : next ? [next] : []));
  if (next) state.shown.add(next.vn.id);
  render();
}

function toggleWant(id) {
  if (marks.want.has(id)) marks.want.delete(id);
  else marks.want.add(id);
  saveSet(STORE_KEYS.want, marks.want);
  render();
}

function relax(i) {
  const r = engine.diagnose(state.answers, [...state.dealbreakers], blocked())[i];
  if (!r) return;
  if (r.kind === 'question') state.answers[r.qid] = r.relaxTo;
  else state.dealbreakers.delete(r.id);
  go('result');
}

function renderResult() {
  const type = engine.playerType(state.answers);
  const need = quiz.scoring.pickCount;
  let notice = '';
  if (state.ranked.length < need) {
    const hints = engine.diagnose(state.answers, [...state.dealbreakers], blocked()).slice(0, 2);
    notice = `
      <div class="notice">
        <p>${state.ranked.length ? `符合条件的只有 ${state.ranked.length} 部。` : '没有符合条件的作品。'}${
          hints.length ? `主要是「${esc(hints[0].label)}」这个条件卡住了。` : ''
        }</p>
        <div class="relax">
          ${hints.map((h, i) => `<button data-action="relax" data-index="${i}">放宽「${esc(h.label)}」，会有 ${h.count} 部</button>`).join('')}
        </div>
      </div>`;
  }
  const canShuffle = state.ranked.length > need;
  return `
    <section class="screen result">
      <header class="ending">
        <div class="kicker">— ENDING —</div>
        <h2>${esc(type.name)}</h2>
        <p>${esc(type.desc)}</p>
        ${type.prefs.length ? `<div class="pills">${type.prefs.map((p) => `<span>${esc(p)}</span>`).join('')}</div>` : ''}
      </header>
      ${notice}
      <div class="cards">${state.current.map(renderCard).join('')}</div>
      <div class="actions">
        ${canShuffle ? '<button class="btn primary" data-action="reshuffle">换一批</button>' : ''}
        <button class="btn${canShuffle ? '' : ' full'}" data-action="edit">改答案</button>
      </div>
      <p class="restart">
        <button data-action="wants">想玩清单（${marks.want.size}）</button> ·
        <button data-action="restart">从头再来</button>
      </p>
    </section>`;
}

function renderCard({ vn }) {
  const re = engine.reasons(vn, state.answers);
  const reason = re.sentence || '在符合你条件的作品里口碑靠前。';
  const want = marks.want.has(vn.id);
  return `
    <article class="card">
      ${renderCover(vn)}
      <div>
        <h3>${esc(vn.title)}</h3>
        ${vn.orig !== vn.title ? `<p class="orig">${esc(vn.orig)}</p>` : ''}
        <p class="meta">${esc(formatLength(vn))} · VNDB ${(vn.rating / 10).toFixed(1)}（${vn.votes} 人评）${vn.year ? ` · ${vn.year}` : ''}</p>
        ${vn.cn?.bangumi ? `<p class="meta">Bangumi ${vn.cn.bangumi.score.toFixed(1)}（${vn.cn.bangumi.votes} 人评）</p>` : ''}
        <p class="why">${esc(reason)}</p>
        ${re.labels.length ? `<ul class="chips">${re.labels.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        <div class="row">
          <button data-action="played" data-id="${esc(vn.id)}">玩过了</button>
          <button data-action="not-interested" data-id="${esc(vn.id)}">不感兴趣</button>
          <button class="${want ? 'on' : ''}" data-action="want" data-id="${esc(vn.id)}" aria-pressed="${want}">${want ? '♥ 想玩' : '♡ 想玩'}</button>
          ${links(vn)}
        </div>
      </div>
    </article>`;
}

// ---------- 想玩清单 ----------

function renderWants() {
  const items = [...marks.want].map((id) => vnById.get(id)).filter(Boolean).reverse();
  const hidden = marks.played.size + marks.skip.size;
  return `
    <section class="screen">
      <div class="list-head">
        <h2>想玩清单</h2>
        <button data-action="close-wants">‹ 返回</button>
      </div>
      ${items.length
        ? `<div class="cards">${items.map(renderMini).join('')}</div>`
        : '<p class="empty">还没有想玩的作品。在推荐结果里点「♡ 想玩」就会出现在这里。</p>'}
      ${hidden
        ? `<p class="reset">你标过 ${marks.played.size} 部「玩过了」、${marks.skip.size} 部「不感兴趣」，它们不会再被推荐。<button data-action="clear-hidden">全部恢复</button></p>`
        : ''}
    </section>`;
}

function renderMini(vn) {
  return `
    <article class="card mini">
      ${renderCover(vn)}
      <div>
        <h3>${esc(vn.title)}</h3>
        ${vn.orig !== vn.title ? `<p class="orig">${esc(vn.orig)}</p>` : ''}
        <p class="meta">${esc(formatLength(vn))} · VNDB ${(vn.rating / 10).toFixed(1)}${vn.year ? ` · ${vn.year}` : ''}</p>
        ${vn.cn?.bangumi ? `<p class="meta">Bangumi ${vn.cn.bangumi.score.toFixed(1)}（${vn.cn.bangumi.votes} 人评）</p>` : ''}
        <div class="row">
          <button data-action="want" data-id="${esc(vn.id)}">移出清单</button>
          ${links(vn)}
        </div>
      </div>
    </article>`;
}

function clearHidden() {
  marks.played.clear();
  marks.skip.clear();
  saveSet(STORE_KEYS.played, marks.played);
  saveSet(STORE_KEYS.skip, marks.skip);
  render();
}

// ---------- 事件 ----------

app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  const { action, id } = btn.dataset;
  switch (action) {
    case 'finish-typing':
      stopTyping();
      break;
    case 'begin':
      state.qIndex = 0;
      go('quiz');
      break;
    case 'answer':
      answer(btn.dataset.option);
      break;
    case 'skip':
      skipQuestion();
      break;
    case 'next':
      nextQuestion();
      break;
    case 'prev':
      state.qIndex--;
      render();
      window.scrollTo(0, 0);
      break;
    case 'toggle-db':
      if (state.dealbreakers.has(id)) state.dealbreakers.delete(id);
      else state.dealbreakers.add(id);
      render();
      break;
    case 'back-to-quiz':
      state.qIndex = quiz.questions.length - 1;
      go('quiz');
      break;
    case 'show-result':
      go('result');
      break;
    case 'reshuffle':
      reshuffle();
      break;
    case 'played':
      dismiss(id, 'played');
      break;
    case 'not-interested':
      dismiss(id, 'skip');
      break;
    case 'want':
      toggleWant(id);
      break;
    case 'relax':
      relax(Number(btn.dataset.index));
      break;
    case 'edit':
      state.qIndex = 0;
      go('quiz');
      break;
    case 'restart':
      state.answers = {};
      state.dealbreakers = new Set();
      go('start');
      break;
    case 'wants':
      state.back = state.screen;
      go('wants');
      break;
    case 'close-wants':
      // 从结果页进来的回结果页，但不重新抽
      state.screen = state.back;
      render();
      break;
    case 'clear-hidden':
      clearHidden();
      break;
  }
});

// 数字键选选项，回车在雷点页看结果
document.addEventListener('keydown', (e) => {
  if (document.querySelector('#feedback-dialog[open]') || e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.repeat) return;
  if (state.screen !== 'quiz' && state.screen !== 'dealbreakers') return;
  if (e.key === 'Enter' && state.screen === 'dealbreakers' && engine) {
    if (e.target.closest?.('button, a')) return;
    e.preventDefault();
    go('result');
    return;
  }
  if (e.key === 'Enter' && state.screen === 'quiz' && quiz.questions[state.qIndex].multiple) {
    if (e.target.closest?.('button, a')) return;
    e.preventDefault();
    if (selectedOptions(quiz.questions[state.qIndex], state.answers[quiz.questions[state.qIndex].id]).length) nextQuestion();
    return;
  }
  const n = Number(e.key);
  if (!n) return;
  const choice = app.querySelectorAll('.choice')[n - 1];
  if (choice) { e.preventDefault(); choice.click(); }
});

// ---------- 启动 ----------

async function main() {
  try {
    const load = (u) => fetch(u).then((r) => {
      if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
      return r.json();
    });
    const works = load('data/vns.json?v=20261025-multi');
    // 问卷尚未到齐时，片库请求也可能先失败，先接住拒绝，后面 await 仍会正常报错。
    works.catch(() => {});
    quiz = await load('data/quiz.json?v=20261025-multi');
    let needsWorks = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
      needsWorks = ['result', 'wants'].includes(saved?.screen) || saved?.back === 'result';
    } catch {
      // 没有可恢复的记录就从首页开始。
    }
    if (needsWorks) {
      // 保留已存的结果，不能先渲染首页，否则 saveSession 会把原结果覆盖掉。
      app.innerHTML = '<p class="loading">正在恢复上次的页面…</p>';
      document.documentElement.dataset.screen = 'loading';
    } else if (!restoreSession()) {
      render();
    }
    const vns = await works;
    engine = createEngine(vns, quiz);
    vnById = new Map(vns.map((v) => [v.id, v]));
    if (needsWorks) {
      if (!restoreSession()) render();
    } else if (state.screen === 'quiz') {
      // 后台准备完后只更新数量，不打断用户正在看的选项、焦点和题目动画。
      const hint = app.querySelector('.remaining');
      if (hint) hint.textContent = `目前符合条件：${engine.filterPool(state.answers, [], blocked()).length} 部`;
    } else {
      render();
    }
  } catch (err) {
    app.innerHTML = `<p class="error">数据加载失败，刷新试试。（${esc(err.message)}）</p>`;
  }
}

initFeedback(() => ({ screen: state.screen, works: state.screen === 'result' ? state.current.map((r) => r.vn.id) : [] }));
main();
