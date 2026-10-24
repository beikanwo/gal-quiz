// 独立于答题渲染，打开/关闭反馈不会改变题号、答案、推荐结果或滚动位置。
export function initFeedback(getContext) {
  const trigger = document.getElementById('feedback-open');
  const dialog = document.getElementById('feedback-dialog');
  if (!trigger || !dialog) return;
  const form = dialog.querySelector('form');
  const status = dialog.querySelector('[role="status"]');
  const send = form.querySelector('[type="submit"]');
  const include = form.elements.includeContext;
  let context = null;
  let requestId;
  let lastPayload = '';
  let busy = false;
  function open() {
    context = getContext();
    include.checked = Boolean(context?.works?.length);
    include.closest('label').hidden = !context?.works?.length;
    status.textContent = '';
    dialog.showModal();
  }
  trigger.addEventListener('click', open);
  dialog.querySelector('[data-feedback-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog && !busy) dialog.close(); });
  form.addEventListener('input', () => { if (!busy) status.textContent = ''; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !form.reportValidity()) return;
    const payload = {
      kind: form.elements.kind.value,
      message: form.elements.message.value.trim(),
      contact: form.elements.contact.value.trim(),
      website: form.elements.website.value,
      context: include.checked ? context : null,
    };
    if (payload.message.length < 10) { status.textContent = '再具体一点吧，至少填写 10 个字。'; return; }
    const fingerprint = JSON.stringify(payload);
    if (fingerprint !== lastPayload || !requestId) requestId = crypto.randomUUID();
    lastPayload = fingerprint;
    busy = true; send.disabled = true; send.textContent = '正在发送…';
    status.textContent = '';
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, requestId }), signal: AbortSignal.timeout(15000),
      });
      let result;
      try { result = await response.json(); } catch { throw new Error('暂时无法连接反馈服务，内容还在，请稍后重试。'); }
      if (!response.ok || !result.ok) throw new Error(result.error || '暂时没有发送成功，内容还在，请稍后重试。');
      status.textContent = '收到啦，谢谢你帮它变得更好。';
      form.reset(); requestId = null; lastPayload = '';
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError' ? '连接有点慢，内容还在，可以稍后重试。' : error.message;
    } finally { busy = false; send.disabled = false; send.textContent = '发送反馈'; }
  });
}
