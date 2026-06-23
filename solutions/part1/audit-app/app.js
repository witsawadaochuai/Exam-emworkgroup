// ============================================================================
// ข้อ 3 — Front-end (เรียก API ของ server.js)
// ============================================================================
let currentUser = null;

const $ = (id) => document.getElementById(id);
const baht = (satang) => (Number(satang) / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (h) => (h ? h.slice(0, 10) + '…' : '—');

async function api(path, method = 'GET', body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  const res = await fetch(path, opt);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

// ---------- บัญชีทดสอบ ----------
const ACCOUNTS = [
  { username: 'maker',   name: 'สมศรี',    role: 'HR Maker' },
  { username: 'manager', name: 'ประเสริฐ', role: 'HR Manager' },
  { username: 'it',      name: 'อนันต์',   role: 'IT Admin' },
];

function renderAccountChips() {
  $('account-chips').innerHTML = ACCOUNTS.map((a) => `
    <button class="account-chip" data-user="${a.username}">
      <span class="chip-name">${a.name}</span>
      <span class="chip-role">${a.role}</span>
      <span class="chip-cred">${a.username} / 1234</span>
    </button>`).join('');
  document.querySelectorAll('.account-chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      $('login-user').value = chip.dataset.user;
      $('login-pass').value = '1234';
    })
  );
}

async function doLogin() {
  $('login-error').style.display = 'none';
  try {
    currentUser = await api('/api/login', 'POST', {
      username: $('login-user').value.trim(),
      password: $('login-pass').value,
    });
    $('login-view').style.display = 'none';
    $('app-view').style.display = 'block';
    $('session-bar').style.display = 'flex';
    $('session-name').textContent = currentUser.name;
    renderRolePanel();
    await refreshDb();
  } catch (e) {
    $('login-error').textContent = '⚠️ ' + e.message;
    $('login-error').style.display = 'flex';
  }
}

function logout() {
  currentUser = null;
  $('app-view').style.display = 'none';
  $('session-bar').style.display = 'none';
  $('login-view').style.display = 'block';
  $('login-pass').value = '';
}

// ---------- Role panel ----------
let dbCache = { salaries: [], requests: [], audit: [] };

function renderRolePanel() {
  const panel = $('role-panel');
  if (currentUser.role === 'HR_MAKER') {
    const others = dbCache.salaries.filter((s) => Number(s.emp_id) !== Number(currentUser.empId));
    panel.innerHTML = `
      <div class="card glass role-panel-card"><div class="card-header">
        <h2>สร้างคำขอแก้เงินเดือน <span class="role-badge maker">HR_MAKER</span></h2>
        <p>maker สร้างคำขอ → ต้องให้ manager คนอื่นอนุมัติ (แก้เงินเดือนตัวเองไม่ได้)</p>
      </div><div class="card-body">
        <div class="action-row">
          <label>พนักงาน
            <select id="f-emp">${others.map((s) => `<option value="${s.emp_id}">${s.emp_id} · ${s.name}</option>`).join('')}</select>
          </label>
          <label>เงินเดือนใหม่ (บาท)<input id="f-amount" type="number" value="35000" step="100"></label>
          <label>เหตุผล<input id="f-reason" type="text" value="ปรับฐานย้อนหลังตามมติ"></label>
          <button id="f-submit" class="btn primary-btn">+ สร้างคำขอ</button>
        </div>
        <div class="hint-box">ลองเลือกตัวเอง (สมศรี) ไม่ได้ — ระบบกันการแก้เงินเดือนตัวเองด้วย CHECK ใน DB</div>
      </div></div>`;
    $('f-submit').addEventListener('click', submitRequest);
  } else if (currentUser.role === 'HR_MANAGER') {
    const pending = dbCache.requests.filter((r) => r.status === 'PENDING').length;
    panel.innerHTML = `
      <div class="card glass role-panel-card"><div class="card-header">
        <h2>อนุมัติคำขอ <span class="role-badge manager">HR_MANAGER</span></h2>
        <p>มีคำขอรออนุมัติ ${pending} รายการ — กดปุ่มในตาราง salary_change_requests ด้านล่าง</p>
      </div><div class="card-body">
        <div class="hint-box">manager อนุมัติคำขอที่ "ตัวเองสร้าง" ไม่ได้ (Maker-Checker)</div>
      </div></div>`;
  } else {
    // IT_ADMIN
    panel.innerHTML = `
      <div class="card glass role-panel-card"><div class="card-header">
        <h2>บัญชี IT <span class="role-badge it">IT_ADMIN</span></h2>
        <p>IT ไม่มีสิทธิ์ในระบบเงินเดือน แต่จำลองว่าถ้า IT เข้าถึง DB ได้โดยตรง จะเกิดอะไรขึ้น</p>
      </div><div class="card-body">
        <div class="action-row">
          <label>แก้เงินเดือนตัวเองใน DB เป็น (บาท)<input id="atk-amount" type="number" value="99999" step="100"></label>
          <button id="atk-direct" class="btn danger-btn">☠️ แก้ DB ตรง ๆ (ไม่ผ่านระบบ)</button>
          <button id="atk-tamper" class="btn danger-btn">☠️ แก้ Audit Log กลบร่องรอย</button>
        </div>
        <div id="atk-output" class="demo-output" style="margin-top:1rem">ลองโจมตี แล้วกดปุ่ม Integrity Check ด้านล่างเพื่อดูว่าระบบจับได้</div>
      </div></div>`;
    $('atk-direct').addEventListener('click', attackDirect);
    $('atk-tamper').addEventListener('click', attackTamper);
  }
}

// ---------- Actions ----------
async function submitRequest() {
  try {
    await api('/api/requests', 'POST', {
      actorEmpId: currentUser.empId,
      targetEmpId: Number($('f-emp').value),
      newAmountBaht: Number($('f-amount').value),
      reason: $('f-reason').value,
    });
    await refreshDb();
  } catch (e) { alert('❌ ' + e.message); }
}

async function approve(id) {
  try { await api(`/api/requests/${id}/approve`, 'POST', { actorEmpId: currentUser.empId }); await refreshDb(); }
  catch (e) { alert('❌ ' + e.message); }
}
async function reject(id) {
  try { await api(`/api/requests/${id}/reject`, 'POST', { actorEmpId: currentUser.empId }); await refreshDb(); }
  catch (e) { alert('❌ ' + e.message); }
}

async function attackDirect() {
  try {
    const r = await api('/api/attack/direct-edit', 'POST', { actorEmpId: currentUser.empId, newAmountBaht: Number($('atk-amount').value) });
    $('atk-output').innerHTML = `<span class="bad">☠️ ${r.message}</span>`;
    await refreshDb();
  } catch (e) { alert('❌ ' + e.message); }
}
async function attackTamper() {
  try {
    const r = await api('/api/attack/tamper-log', 'POST', { actorEmpId: currentUser.empId });
    $('atk-output').innerHTML = `<span class="bad">☠️ ${r.message}</span>`;
    await refreshDb();
  } catch (e) { alert('❌ ' + e.message); }
}

// ---------- Render DB ----------
async function refreshDb() {
  dbCache = await api('/api/db');
  if (currentUser && currentUser.role === 'HR_MAKER') renderRolePanel(); // refresh dropdown
  if (currentUser && currentUser.role === 'HR_MANAGER') renderRolePanel(); // refresh pending count
  renderSalaries();
  renderRequests();
  renderAudit([]);
}

function renderSalaries() {
  $('tbl-salaries').innerHTML = `
    <thead><tr><th>emp_id</th><th>name</th><th>salary_satang</th><th>= บาท</th><th>updated_at</th></tr></thead>
    <tbody>${dbCache.salaries.map((s) => `
      <tr><td class="mono">${s.emp_id}</td><td>${s.name}</td>
      <td class="mono">${Number(s.salary_satang).toLocaleString()}</td>
      <td class="mono">${baht(s.salary_satang)}</td><td class="mono">${s.updated_at}</td></tr>`).join('')}</tbody>`;
}

function renderRequests() {
  const canApprove = currentUser && currentUser.role === 'HR_MANAGER';
  $('tbl-requests').innerHTML = `
    <thead><tr><th>id</th><th>พนักงาน</th><th>เก่า→ใหม่ (บาท)</th><th>เหตุผล</th><th>ขอโดย</th><th>สถานะ</th><th>อนุมัติโดย</th>${canApprove ? '<th>การกระทำ</th>' : ''}</tr></thead>
    <tbody>${dbCache.requests.map((r) => {
      const pillClass = r.status === 'APPROVED' ? 'approved' : r.status === 'REJECTED' ? 'rejected' : 'pending';
      const actions = canApprove && r.status === 'PENDING'
        ? `<td><button class="badge-btn" onclick="approve(${r.id})">✓ อนุมัติ</button> <button class="badge-btn" onclick="reject(${r.id})">✗ ปฏิเสธ</button></td>`
        : (canApprove ? '<td>—</td>' : '');
      return `<tr><td class="mono">${r.id}</td><td>${r.emp_name}</td>
        <td class="mono">${baht(r.old_satang)} → ${baht(r.new_satang)}</td>
        <td>${r.reason}</td><td>${r.requested_by_name}</td>
        <td><span class="pill ${pillClass}">${r.status}</span></td>
        <td>${r.approved_by_name || '—'}</td>${actions}</tr>`;
    }).join('') || `<tr><td colspan="${canApprove ? 8 : 7}" style="text-align:center;color:#9ca3af">ยังไม่มีคำขอ</td></tr>`}</tbody>`;
}

function renderAudit(tamperedRows) {
  const t = new Set(tamperedRows.map(Number));
  $('tbl-audit').innerHTML = `
    <thead><tr><th>id</th><th>emp</th><th>เก่า→ใหม่</th><th>โดย</th><th>เมื่อ</th><th>prev_hash</th><th>row_hash</th></tr></thead>
    <tbody>${dbCache.audit.map((a) => `
      <tr class="${t.has(Number(a.id)) ? 'row-tampered' : ''}">
        <td class="mono">${a.id}</td><td class="mono">${a.emp_id}</td>
        <td class="mono">${baht(a.old_value)} → ${baht(a.new_value)}</td>
        <td>${a.changed_by_name || a.changed_by}</td>
        <td class="mono">${(a.changed_at || '').slice(0, 19).replace('T', ' ')}</td>
        <td class="mono">${short(a.prev_hash)}</td><td class="mono">${short(a.row_hash)}</td></tr>`).join('')
      || '<tr><td colspan="7" style="text-align:center;color:#9ca3af">ยังไม่มีรายการ — อนุมัติคำขอเพื่อสร้าง audit แรก</td></tr>'}</tbody>`;
}

async function verify() {
  try {
    const r = await api('/api/verify');
    renderAudit(r.tamperedRows);
    if (r.ok) {
      $('verify-output').innerHTML = `<span class="good">✅ ผ่าน — ข้อมูลครบถ้วน โซ่ hash ต่อเนื่อง และเงินเดือนทุกคนตรงกับ audit log</span>`;
    } else {
      $('verify-output').innerHTML =
        `<span class="bad">🚨 พบความผิดปกติ ${r.issues.length} รายการ:</span><ul>` +
        r.issues.map((i) => `<li>${i}</li>`).join('') + '</ul>' +
        `<p>→ การแก้ไขนอกระบบถูกตรวจจับได้ทันทีจาก hash chain และการ reconcile</p>`;
    }
  } catch (e) { alert('❌ ' + e.message); }
}

// ---------- init ----------
document.addEventListener('DOMContentLoaded', () => {
  renderAccountChips();
  $('login-btn').addEventListener('click', doLogin);
  $('logout-btn').addEventListener('click', logout);
  $('verify-btn').addEventListener('click', verify);
  $('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
});
