// Roaree's chat page. All the heavy lifting (download, patch, inference) happens in
// roaree-worker.js; this file only drives the UI. See steer/ for how the steering was built.
const $ = (id) => document.getElementById(id);
const worker = new Worker('/js/roaree-worker.js', { type: 'module' });

const history = [];
let ready = false, busy = false, bubbleEl = null;

const status = (t) => ($('rr-status').textContent = t);

function bubble(role, text) {
  const el = document.createElement('div');
  el.className = `rr-msg rr-${role}`;
  el.textContent = text;
  $('rr-log').append(el);
  el.scrollIntoView({ block: 'nearest' });
  return el;
}

function finish(reply) {
  bubbleEl.classList.remove('rr-thinking');
  if (reply) history.push({ role: 'assistant', content: reply });
  else history.pop();
  busy = false;
  $('rr-send').hidden = false;
  $('rr-stop').hidden = true;
  $('rr-input').focus();
}

worker.onmessage = ({ data }) => {
  if (data.type === 'progress') {
    $('rr-progress').hidden = false;
    $('rr-progress').value = data.value;
    $('rr-load').textContent = data.starting ? 'Starting the model…' : `Waking Roaree… ${Math.round(data.value * 100)}%`;
  } else if (data.type === 'ready') {
    ready = true;
    $('rr-loader').hidden = true;
    $('rr-chat').hidden = false;
    status(data.gpu ? '' : 'No WebGPU in this browser, so Roaree runs on the CPU: expect a few words a second.');
    $('rr-input').focus();
  } else if (data.type === 'token') {
    bubbleEl.classList.remove('rr-thinking');
    bubbleEl.textContent = data.text;
    bubbleEl.scrollIntoView({ block: 'nearest' });
  } else if (data.type === 'done') {
    finish(data.text);
  } else if (data.type === 'error') {
    if (data.during === 'load') {
      $('rr-load').disabled = false;
      $('rr-load').textContent = 'Try again';
      status(`Couldn't wake Roaree: ${data.message}`);
    } else {
      bubbleEl.textContent = `(Roaree tripped: ${data.message})`;
      finish('');
    }
  }
};
worker.onerror = (e) => status(`Couldn't start Roaree: ${e.message || 'the worker failed to load'}`);

function send(text) {
  text = text.trim();
  if (!text || busy || !ready) return;
  busy = true;
  $('rr-send').hidden = true;
  $('rr-stop').hidden = false;
  $('rr-input').value = '';
  history.push({ role: 'user', content: text });
  bubble('user', text);
  bubbleEl = bubble('assistant', '…');
  bubbleEl.classList.add('rr-thinking');
  worker.postMessage({ type: 'generate', msgs: history.slice(-6), strength: Number($('rr-strength').value) });
}

function label() {
  const v = Number($('rr-strength').value);
  $('rr-strength-label').textContent = v === 0 ? 'off: the plain model' : v < 0.45 ? 'a little Roaree' : v < 0.8 ? 'Roaree' : 'all Roaree';
}

$('rr-load').addEventListener('click', () => {
  $('rr-load').disabled = true;
  status('');
  worker.postMessage({ type: 'load' });
});
$('rr-form').addEventListener('submit', (e) => { e.preventDefault(); send($('rr-input').value); });
$('rr-stop').addEventListener('click', () => worker.postMessage({ type: 'stop' }));
$('rr-strength').addEventListener('input', label);
$('rr-reset').addEventListener('click', () => { if (!busy) { history.length = 0; $('rr-log').replaceChildren(); } });
document.querySelectorAll('[data-rr-ask]').forEach((b) => b.addEventListener('click', () => send(b.dataset.rrAsk)));
label();
