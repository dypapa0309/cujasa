import { Router } from 'express';
import { publicSupportConfig } from '../config/supportQa.js';

const router = Router();

function jsString(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function widgetScript(config) {
  return `(() => {
  if (window.__JASAIN_SUPPORT_WIDGET__) return;
  window.__JASAIN_SUPPORT_WIDGET__ = true;

  const config = ${jsString(config)};
  const script = document.currentScript || Array.from(document.scripts).find((item) => /\\/support\\/widget\\.js/.test(item.src));
  const apiBase = script ? new URL(script.src).origin : '';
  const productId = script?.dataset?.product || 'jasain';
  const productLabel = config.products?.[productId] || config.products?.jasain || 'JASAIN';
  const path = [];
  let currentNodeId = 'root';

  const style = document.createElement('style');
  style.textContent = \`
    .jasain-support-root, .jasain-support-root * { box-sizing: border-box; }
    .jasain-support-button { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; width: 58px; height: 58px; border: 0; border-radius: 999px; background: #2563eb; color: white; box-shadow: 0 12px 28px rgba(37, 99, 235, .35); cursor: pointer; font: 700 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .jasain-support-panel { position: fixed; right: 18px; bottom: 88px; z-index: 2147483000; width: min(380px, calc(100vw - 32px)); max-height: min(620px, calc(100vh - 112px)); overflow: hidden; border: 1px solid #d8dee6; border-radius: 14px; background: white; box-shadow: 0 24px 60px rgba(15, 23, 42, .18); color: #17202a; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: none; }
    .jasain-support-panel.is-open { display: flex; flex-direction: column; }
    .jasain-support-header { padding: 16px; background: #2563eb; color: white; }
    .jasain-support-title { margin: 0; font-size: 16px; font-weight: 800; }
    .jasain-support-subtitle { margin-top: 4px; font-size: 12px; opacity: .9; }
    .jasain-support-body { padding: 14px; overflow: auto; }
    .jasain-support-card { border: 1px solid #e5eaf1; border-radius: 10px; padding: 12px; background: #f8fafc; }
    .jasain-support-card h3 { margin: 0; font-size: 15px; }
    .jasain-support-card p { margin: 8px 0 0; font-size: 13px; line-height: 1.55; color: #475569; }
    .jasain-support-options { display: grid; gap: 8px; margin-top: 12px; }
    .jasain-support-option, .jasain-support-action, .jasain-support-back { width: 100%; border: 1px solid #d8dee6; border-radius: 9px; background: white; color: #1f2937; padding: 10px 11px; text-align: left; cursor: pointer; font-size: 13px; font-weight: 700; text-decoration: none; display: block; }
    .jasain-support-option:hover, .jasain-support-back:hover { background: #f1f5f9; }
    .jasain-support-action { text-align: center; background: #2563eb; border-color: #2563eb; color: white; }
    .jasain-support-action.secondary { background: white; border-color: #d8dee6; color: #2563eb; }
    .jasain-support-footer { display: flex; gap: 8px; border-top: 1px solid #e5eaf1; padding: 10px 14px; }
    .jasain-support-footer button { border: 0; background: transparent; color: #64748b; cursor: pointer; font-size: 12px; font-weight: 700; }
    .jasain-support-form { display: grid; gap: 8px; margin-top: 12px; }
    .jasain-support-form input, .jasain-support-form textarea { width: 100%; border: 1px solid #d8dee6; border-radius: 9px; padding: 10px; font: 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .jasain-support-form textarea { min-height: 74px; resize: vertical; }
    .jasain-support-note { margin-top: 8px; font-size: 12px; color: #64748b; line-height: 1.45; }
    .jasain-support-error { margin-top: 8px; font-size: 12px; color: #e11d48; font-weight: 700; }
    .jasain-support-success { margin-top: 8px; font-size: 12px; color: #047857; font-weight: 700; }
    @media (max-width: 520px) { .jasain-support-button { right: 14px; bottom: 14px; } .jasain-support-panel { right: 12px; bottom: 82px; width: calc(100vw - 24px); } }
  \`;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'jasain-support-root';
  root.innerHTML = \`
    <button class="jasain-support-button" type="button" aria-label="상담 열기">상담</button>
    <section class="jasain-support-panel" aria-live="polite">
      <div class="jasain-support-header">
        <p class="jasain-support-title"></p>
        <div class="jasain-support-subtitle"></div>
      </div>
      <div class="jasain-support-body"></div>
      <div class="jasain-support-footer">
        <button type="button" data-action="home">처음으로</button>
        <button type="button" data-action="close">닫기</button>
      </div>
    </section>
  \`;
  document.body.appendChild(root);

  const button = root.querySelector('.jasain-support-button');
  const panel = root.querySelector('.jasain-support-panel');
  const title = root.querySelector('.jasain-support-title');
  const subtitle = root.querySelector('.jasain-support-subtitle');
  const body = root.querySelector('.jasain-support-body');

  function currentPathLabels(nextLabel) {
    const labels = path.map((item) => item.label);
    if (nextLabel) labels.push(nextLabel);
    return labels;
  }

  function node(id) {
    return config.nodes[id] || config.nodes.root;
  }

  function go(nextId, label) {
    if (nextId !== 'root') path.push({ nodeId: currentNodeId, label });
    currentNodeId = nextId;
    renderNode();
  }

  function back() {
    const previous = path.pop();
    currentNodeId = previous?.nodeId || 'root';
    renderNode();
  }

  function renderNode() {
    const item = node(currentNodeId);
    title.textContent = config.title || 'JASAIN 상담';
    subtitle.textContent = productLabel + ' · ' + (config.subtitle || '');
    const options = (item.options || []).map((option) => {
      if (option.action === 'phone') return '<a class="jasain-support-action" href="' + (config.phone.tel ? 'tel:' + config.phone.tel : '#') + '">' + option.label + '</a>';
      if (option.action === 'link') return '<a class="jasain-support-action secondary" target="_blank" rel="noreferrer" href="' + option.href + '">' + option.label + '</a>';
      if (option.action === 'inquiry') return '<button class="jasain-support-option" type="button" data-inquiry-topic="' + (option.topic || currentNodeId) + '">' + option.label + '</button>';
      return '<button class="jasain-support-option" type="button" data-next="' + option.next + '">' + option.label + '</button>';
    }).join('');
    body.innerHTML = \`
      <div class="jasain-support-card">
        <h3>\${item.title || '상담'}</h3>
        <p>\${item.body || config.welcome || ''}</p>
      </div>
      <div class="jasain-support-options">\${options}</div>
      \${path.length ? '<button class="jasain-support-back" type="button" data-back="1">이전으로</button>' : ''}
      <div class="jasain-support-note">전화 상담: \${config.phone.display || '전화 상담'}</div>
    \`;
  }

  function renderInquiry(topic) {
    const item = node(currentNodeId);
    body.innerHTML = \`
      <div class="jasain-support-card">
        <h3>문의 남기기</h3>
        <p>연락처를 남겨주시면 담당자가 확인 후 연락드립니다.</p>
      </div>
      <form class="jasain-support-form">
        <input name="name" autocomplete="name" placeholder="성함" required />
        <input name="phone" autocomplete="tel" placeholder="연락처" required />
        <textarea name="message" placeholder="문의 내용을 적어주세요.">\${item.title || ''}</textarea>
        <button class="jasain-support-action" type="submit">문의 접수하기</button>
      </form>
      <button class="jasain-support-back" type="button" data-back="1">이전으로</button>
      <div class="jasain-support-note">선택 경로: \${currentPathLabels(item.title).join(' > ')}</div>
    \`;
    const form = body.querySelector('form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const payload = {
        name: data.name,
        phone: data.phone,
        message: data.message,
        productId,
        topic,
        questionPath: currentPathLabels(item.title),
        source: 'support_widget'
      };
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const response = await fetch(apiBase + '/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('문의 접수에 실패했습니다.');
        form.insertAdjacentHTML('afterend', '<div class="jasain-support-success">문의가 접수되었습니다. 확인 후 연락드릴게요.</div>');
        form.reset();
      } catch (error) {
        form.insertAdjacentHTML('afterend', '<div class="jasain-support-error">' + error.message + '</div>');
      } finally {
        submit.disabled = false;
      }
    });
  }

  root.addEventListener('click', (event) => {
    const target = event.target.closest('button, a');
    if (!target) return;
    if (target === button) {
      panel.classList.toggle('is-open');
      if (panel.classList.contains('is-open')) renderNode();
      return;
    }
    if (target.dataset.action === 'close') panel.classList.remove('is-open');
    if (target.dataset.action === 'home') { path.length = 0; currentNodeId = 'root'; renderNode(); }
    if (target.dataset.next) go(target.dataset.next, target.textContent.trim());
    if (target.dataset.back) back();
    if (target.dataset.inquiryTopic) renderInquiry(target.dataset.inquiryTopic);
  });
})();`;
}

router.get('/widget.js', (req, res) => {
  res
    .set('Content-Type', 'application/javascript; charset=utf-8')
    .set('Cache-Control', 'public, max-age=300')
    .send(widgetScript(publicSupportConfig()));
});

export default router;
