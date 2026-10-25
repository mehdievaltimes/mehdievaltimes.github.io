// The SAE page's chat. All the heavy lifting (download, patch, inference) happens in sae-worker.js;
// this file only drives the UI. See steer/ for how the features were found.
const $ = (id) => document.getElementById(id);
const worker = new Worker('/js/sae-worker.js', { type: 'module' });

const history = [];
let ready = false, busy = false, bubbleEl = null;

const status = (t) => ($('sae-status').textContent = t);
const feature = () => document.querySelector('input[name="sae-feature"]:checked');

function bubble(role, text, tag) {
  const el = document.createElement('div');
  el.className = `sae-msg sae-${role}`;
  if (tag) {
    const t = document.createElement('span');
    t.className = 'sae-tag';
    t.textContent = tag;
    el.append(t);
  }
  el.append(document.createTextNode(text));
  $('sae-log').append(el);
  el.scrollIntoView({ block: 'nearest' });
  return el;
}

function setText(el, text) {
  el.lastChild.textContent = text;
  el.scrollIntoView({ block: 'nearest' });
}

function finish(reply) {
  bubbleEl.classList.remove('sae-thinking');
  if (reply) history.push({ role: 'assistant', content: reply });
  else history.pop();
  busy = false;
  $('sae-send').hidden = false;
  $('sae-stop').hidden = true;
  $('sae-input').focus();
}

worker.onmessage = ({ data }) => {
  if (data.type === 'progress') {
    $('sae-progress').hidden = false;
    $('sae-progress').value = data.value;
    $('sae-load').textContent = data.starting ? 'Starting the model…' : `Downloading… ${Math.round(data.value * 100)}%`;
  } else if (data.type === 'ready') {
    ready = true;
    $('sae-loader').hidden = true;
    $('sae-chat').hidden = false;
    status(data.gpu ? '' : 'No WebGPU in this browser, so the model runs on the CPU: expect a few words a second.');
    $('sae-input').focus();
  } else if (data.type === 'token') {
    bubbleEl.classList.remove('sae-thinking');
    setText(bubbleEl, data.text);
  } else if (data.type === 'done') {
    finish(data.text);
  } else if (data.type === 'error') {
    if (data.during === 'load') {
      $('sae-load').disabled = false;
      $('sae-load').textContent = 'Try again';
      status(`Couldn't load the model: ${data.message}`);
    } else {
      setText(bubbleEl, `(something broke: ${data.message})`);
      finish('');
    }
  }
};
worker.onerror = (e) => status(`Couldn't start the model: ${e.message || 'the worker failed to load'}`);

function send(text) {
  text = text.trim();
  if (!text || busy || !ready) return;
  busy = true;
  $('sae-send').hidden = true;
  $('sae-stop').hidden = false;
  $('sae-input').value = '';
  history.push({ role: 'user', content: text });
  bubble('user', text);
  const strength = Number($('sae-strength').value);
  const f = feature();
  bubbleEl = bubble('assistant', '…', strength === 0 ? 'plain model' : `${f.dataset.label} at ${Math.round(strength * 100)}%`);
  bubbleEl.classList.add('sae-thinking');
  worker.postMessage({ type: 'generate', msgs: history.slice(-6), feature: Number(f.value), strength });
}

function label() {
  const v = Number($('sae-strength').value);
  $('sae-strength-label').textContent = v === 0 ? 'off: the plain model' : `${Math.round(v * 100)}%`;
}

function pick() {
  const f = feature();
  document.querySelectorAll('.sae-fires').forEach((el) => (el.hidden = el.dataset.feature !== f.value));
  $('sae-strength').value = f.dataset.default;
  label();
}

$('sae-load').addEventListener('click', () => {
  $('sae-load').disabled = true;
  status('');
  worker.postMessage({ type: 'load' });
});
$('sae-form').addEventListener('submit', (e) => { e.preventDefault(); send($('sae-input').value); });
$('sae-stop').addEventListener('click', () => worker.postMessage({ type: 'stop' }));
$('sae-strength').addEventListener('input', label);
document.querySelectorAll('input[name="sae-feature"]').forEach((r) => r.addEventListener('change', pick));
$('sae-reset').addEventListener('click', () => { if (!busy) { history.length = 0; $('sae-log').replaceChildren(); } });
document.querySelectorAll('[data-sae-ask]').forEach((b) => b.addEventListener('click', () => send(b.dataset.saeAsk)));
label();
