/**
 * Web UI — một file, không build step, không framework.
 *
 * → docs/SPEC-ui.md
 *
 * Nguyên lý: người dùng nhìn thấy MỘT CÔNG TY ĐANG LÀM VIỆC, không phải một
 * terminal đang cuộn log. Nhưng log advanced luôn cách một cú click.
 *
 * Mỗi màn hình phải trả lời được, không cần click:
 *   đang ở bước mấy · ai đang làm gì · đã tốn bao nhiêu · có gì đang chờ tôi
 *   · muốn dừng thì bấm đâu (nút Dừng LUÔN thấy được)
 */

export const UI_HTML = String.raw`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentCo</title>
<style>
  :root {
    --bg: #fbfaf8; --panel: #fff; --line: #e7e3dc; --ink: #232019; --muted: #7d766a;
    --accent: #b4532a; --ok: #3f7d4a; --warn: #b4832a; --shadow: 0 1px 2px rgba(0,0,0,.05);
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16150f; --panel:#1e1c15; --line:#332f24; --ink:#ece7dc; --muted:#948c7c;
            --accent:#e08a5c; --ok:#7fb583; --warn:#d8b45e; --shadow:none; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;
         background:var(--bg); color:var(--ink); }
  header { display:flex; align-items:center; gap:16px; padding:12px 20px;
           border-bottom:1px solid var(--line); background:var(--panel); position:sticky; top:0; z-index:5; }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  .spacer { flex:1; }
  .chip { font-size:13px; color:var(--muted); white-space:nowrap; }
  .dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--muted); margin-right:6px; }
  .dot.working { background:var(--accent); animation:pulse 1.4s infinite; }
  .dot.idle { background:var(--ok); }
  .dot.paused { background:var(--warn); }
  @keyframes pulse { 50% { opacity:.3 } }
  button { font:inherit; padding:6px 14px; border-radius:7px; border:1px solid var(--line);
           background:var(--panel); color:var(--ink); cursor:pointer; }
  button:hover { border-color:var(--accent); }
  button.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
  button.danger { color:var(--accent); }
  button:disabled { opacity:.45; cursor:default; }
  main { display:grid; grid-template-columns:230px 1fr; gap:18px; padding:18px 20px; max-width:1180px; margin:0 auto; }
  @media (max-width:860px) { main { grid-template-columns:1fr } }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:11px;
          padding:15px 17px; margin-bottom:16px; box-shadow:var(--shadow); }
  .card h2 { font-size:11px; letter-spacing:.09em; text-transform:uppercase;
             color:var(--muted); margin:0 0 12px; font-weight:600; }
  .who { display:flex; gap:10px; align-items:baseline; padding:7px 0; border-bottom:1px solid var(--line); }
  .who:last-child { border-bottom:none; }
  .who .nm { font-weight:500; }
  .who .st { font-size:12px; color:var(--muted); margin-left:auto; }
  .step { display:flex; gap:11px; padding:7px 0; align-items:flex-start; }
  .step .ic { width:19px; text-align:center; flex-shrink:0; }
  .step.done { color:var(--muted); }
  .step.running { font-weight:600; }
  .live { display:flex; gap:10px; padding:8px 0; border-bottom:1px solid var(--line); }
  .live:last-child { border-bottom:none; }
  .live .txt { color:var(--muted); }
  #chat { display:flex; gap:9px; }
  #chat input { flex:1; font:inherit; padding:9px 13px; border-radius:8px;
                border:1px solid var(--line); background:var(--bg); color:var(--ink); }
  #msgs > div { padding:8px 0; border-bottom:1px solid var(--line); }
  #msgs > div:last-child { border-bottom:none; }
  #msgs .me { color:var(--muted); }
  details.drawer { border-top:1px solid var(--line); background:var(--panel); }
  details.drawer > summary { padding:11px 20px; cursor:pointer; font-size:13px; color:var(--muted); }
  pre { margin:0; padding:0 20px 16px; max-height:340px; overflow:auto;
        font:12px/1.5 ui-monospace,Menlo,Consolas,monospace; color:var(--muted); white-space:pre-wrap; }
  .empty { color:var(--muted); font-size:14px; }
</style>
</head>
<body>
<header>
  <h1 id="coname">AgentCo</h1>
  <span class="chip"><span class="dot" id="dot"></span><span id="statetext">đang tải…</span></span>
  <span class="spacer"></span>
  <span class="chip" id="cost">—</span>
  <button id="stop" class="danger">Dừng</button>
  <button id="off" title="Tắt hẳn daemon. Muốn bật lại phải chạy: agentco start">Tắt hẳn</button>
</header>

<main>
  <aside>
    <div class="card">
      <h2>Đội ngũ</h2>
      <div id="team"><div class="empty">…</div></div>
    </div>
    <div class="card">
      <h2>Tri thức</h2>
      <div id="kn" class="empty">—</div>
    </div>
  </aside>

  <section>
    <div class="card">
      <h2>Kế hoạch</h2>
      <div id="req" class="empty">Chưa có việc nào. Giao việc ở ô bên dưới.</div>
      <div id="steps"></div>
    </div>

    <div class="card">
      <h2>Đang diễn ra</h2>
      <div id="live"><div class="empty">Chưa có ai đang làm việc.</div></div>
    </div>

    <div class="card">
      <h2>Nói với giám đốc</h2>
      <div id="msgs"></div>
      <form id="chat" autocomplete="off">
        <input id="inp" placeholder="Giao việc, hoặc hỏi giám đốc…" />
        <button class="primary" id="send">Gửi</button>
      </form>
    </div>
  </section>
</main>

<details class="drawer">
  <summary>Nhật ký chi tiết</summary>
  <pre id="log"></pre>
</details>

<script>
const $ = (id) => document.getElementById(id);
const ICON = { pending:'○', running:'⟳', done:'✓', problem:'⚠', waiting_human:'⏸' };
let liveByRole = {};

function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function log(line) {
  const el = $('log');
  el.textContent += new Date().toLocaleTimeString() + '  ' + line + '\n';
  el.scrollTop = el.scrollHeight;
}

function setState(state, say) {
  $('dot').className = 'dot ' + state;
  $('statetext').textContent = { idle:'rảnh', working:'đang làm', paused:'tạm nghỉ', stopped:'đã tắt' }[state] || state;
  $('stop').disabled = state !== 'working';
  if (say) addMsg(say, false);
}

function renderSteps(plan) {
  if (!plan) return;
  $('req').textContent = plan.request;
  $('req').className = '';
  $('steps').innerHTML = plan.steps.map((s, i) =>
    '<div class="step ' + s.status + '"><span class="ic">' + (ICON[s.status] || '○') +
    '</span><span>' + (i+1) + '. ' + esc(s.title) + '</span></div>').join('');
}

function renderLive() {
  const rows = Object.entries(liveByRole);
  $('live').innerHTML = rows.length
    ? rows.map(([role, o]) =>
        '<div class="live"><b>' + esc(o.avatar || '•') + ' ' + esc(o.name || role) +
        '</b><span class="txt">' + esc(o.say) + '</span></div>').join('')
    : '<div class="empty">Chưa có ai đang làm việc.</div>';
}

function addMsg(text, mine) {
  const d = document.createElement('div');
  if (mine) d.className = 'me';
  d.textContent = (mine ? 'Bạn: ' : 'Giám đốc: ') + text;
  $('msgs').appendChild(d);
  $('msgs').scrollTop = $('msgs').scrollHeight;
}

let roles = {};
async function loadState() {
  const s = await (await fetch('/api/state')).json();
  $('coname').textContent = s.name;
  document.title = s.name + ' — AgentCo';
  roles = Object.fromEntries(s.roles.map(r => [r.id, r]));
  $('team').innerHTML = s.roles.map(r =>
    '<div class="who"><span>' + esc(r.avatar) + '</span><span class="nm" title="' + esc(r.pitch) + '">' +
    esc(r.display_name) + '</span><span class="st">' + esc(r.tier) + '</span></div>').join('');
  $('kn').textContent = s.knowledge + ' ghi chú' + (s.pending ? ' · ' + s.pending + ' việc đang chờ' : '');
  setState(s.state);
  if (s.plan) renderSteps(s.plan);
  s.history.forEach(handle);
}

function handle(e) {
  switch (e.type) {
    case 'plan.created':
      liveByRole = {}; renderLive();
      renderSteps({ request: e.request, steps: e.steps });
      log('kế hoạch: ' + e.steps.map((s,i) => (i+1)+'. '+s.title).join(' | '));
      break;
    case 'plan.step': {
      const el = $('steps').children[e.step];
      if (el) { el.className = 'step ' + e.status; el.firstChild.textContent = ICON[e.status] || '○'; }
      break;
    }
    case 'task.started':
    case 'task.progress': {
      const r = roles[e.role] || {};
      liveByRole[e.role] = { say: e.say, name: r.display_name, avatar: r.avatar };
      renderLive();
      if (e.type === 'task.started') log(e.task_id + ' bắt đầu · ' + e.role);
      break;
    }
    case 'task.done':
      delete liveByRole[e.role]; renderLive();
      log(e.task_id + ' ' + e.status + ' · ' + e.say +
          '  [in ' + e.usage.input + ' cr ' + e.usage.cacheRead + ' cw ' + e.usage.cacheWrite +
          ' out ' + e.usage.output + ' $' + e.usage.costUSD.toFixed(4) + ']');
      break;
    case 'task.blocked':
      delete liveByRole[e.role]; renderLive();
      log('⚠ ' + e.task_id + ' bị chặn: ' + e.reason);
      break;
    case 'master.message': addMsg(e.say, false); break;
    case 'company.state': setState(e.state, null); log('trạng thái: ' + e.state + ' — ' + e.say); break;
    case 'cost.tick':
      $('cost').textContent = e.totals.tasks + ' việc · $' + e.totals.costUSD.toFixed(4);
      break;
    case 'knowledge.changed': $('kn').textContent = e.count + ' ghi chú'; break;
  }
}

new EventSource('/api/events').onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch {} };

$('chat').onsubmit = async (ev) => {
  ev.preventDefault();
  const text = $('inp').value.trim();
  if (!text) return;
  $('inp').value = '';
  addMsg(text, true);
  await fetch('/api/run', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request: text }),
  });
};

$('stop').onclick = () => fetch('/api/stop', { method: 'POST' });
$('off').onclick = async () => {
  if (!confirm('Tắt hẳn daemon?\n\nCông ty sẽ ngừng chạy. Muốn bật lại phải chạy lệnh:\n\n  agentco start')) return;
  await fetch('/api/shutdown', { method: 'POST' });
  setState('stopped', 'Daemon đã tắt. Chạy lệnh "agentco start" để bật lại.');
};

loadState();
</script>
</body>
</html>`;
