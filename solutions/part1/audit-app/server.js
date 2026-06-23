// ============================================================================
// ข้อ 3 — Backend (Express + PostgreSQL) สำหรับระบบแก้เงินเดือนย้อนหลัง
// PostgreSQL อยู่ที่ localhost:5432 (รันผ่าน docker compose)
// เว็บเสิร์ฟที่ http://localhost:3000
// ============================================================================
const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'payroll',
  password: process.env.PGPASSWORD || 'payroll',
  database: process.env.PGDATABASE || 'payroll',
});

// บัญชีผู้ใช้ทดสอบ (เก็บในแอปเพื่อความง่ายของเดโม — โฟกัสที่ 3 ตารางหลักใน DB)
const USERS = [
  { username: 'maker',   password: '1234', empId: 1001, name: 'สมศรี (HR Maker)',     role: 'HR_MAKER' },
  { username: 'manager', password: '1234', empId: 1002, name: 'ประเสริฐ (HR Manager)', role: 'HR_MANAGER' },
  { username: 'it',      password: '1234', empId: 1003, name: 'อนันต์ (IT Admin)',     role: 'IT_ADMIN' },
];
const userById = (id) => USERS.find((u) => Number(u.empId) === Number(id));

// ค่าเงินเดือนเริ่มต้น (ใช้เป็น baseline สำหรับ reconciliation ตรวจการแก้นอกระบบ)
const INITIAL_SALARY = { 1001: 3000000, 1002: 5000000, 1003: 4000000, 1004: 2500000 };

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const computeRowHash = (r, prevHash) =>
  sha256([r.id, r.emp_id, r.old_value, r.new_value, r.changed_by, r.changed_at, prevHash].join('|'));

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// ---------- Login ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const u = USERS.find((x) => x.username === username && x.password === password);
  if (!u) return res.status(401).json({ error: 'username หรือ password ไม่ถูกต้อง' });
  res.json({ empId: u.empId, name: u.name, role: u.role });
});

// ---------- มุมมองฐานข้อมูล ----------
app.get('/api/db', async (_req, res) => {
  try {
    const salaries = (await pool.query('SELECT * FROM salary_records ORDER BY emp_id')).rows;
    const requests = (await pool.query('SELECT * FROM salary_change_requests ORDER BY id')).rows;
    const audit = (await pool.query('SELECT * FROM salary_audit_log ORDER BY id')).rows;
    res.json({ salaries, requests, audit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- สร้างคำขอแก้เงินเดือน (เฉพาะ HR Maker) ----------
app.post('/api/requests', async (req, res) => {
  const { actorEmpId, targetEmpId, newAmountBaht, reason } = req.body;
  const actor = userById(actorEmpId);
  if (!actor || actor.role !== 'HR_MAKER')
    return res.status(403).json({ error: 'เฉพาะ HR Maker เท่านั้นที่สร้างคำขอได้' });
  if (Number(targetEmpId) === Number(actorEmpId))
    return res.status(403).json({ error: 'ห้ามสร้างคำขอแก้เงินเดือนของตัวเอง (Separation of Duties)' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'ต้องระบุเหตุผล' });

  try {
    const emp = (await pool.query('SELECT * FROM salary_records WHERE emp_id=$1', [targetEmpId])).rows[0];
    if (!emp) return res.status(404).json({ error: 'ไม่พบพนักงาน' });
    const newSatang = Math.round(Number(newAmountBaht) * 100);
    await pool.query(
      `INSERT INTO salary_change_requests
         (emp_id, emp_name, old_satang, new_satang, reason, requested_by, requested_by_name, requested_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [emp.emp_id, emp.name, emp.salary_satang, newSatang, reason.trim(), actor.empId, actor.name, new Date().toISOString()]
    );
    res.json({ ok: true });
  } catch (e) {
    // ถ้าชน CHECK no_self_request ก็จะมาที่นี่
    res.status(400).json({ error: e.message });
  }
});

// ---------- อนุมัติคำขอ (เฉพาะ HR Manager, ห้ามอนุมัติของตัวเอง) ----------
app.post('/api/requests/:id/approve', async (req, res) => {
  const { actorEmpId } = req.body;
  const actor = userById(actorEmpId);
  if (!actor || actor.role !== 'HR_MANAGER')
    return res.status(403).json({ error: 'เฉพาะ HR Manager เท่านั้นที่อนุมัติได้' });

  const id = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqRow = (await client.query('SELECT * FROM salary_change_requests WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!reqRow) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'ไม่พบคำขอ' }); }
    if (reqRow.status !== 'PENDING') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'คำขอนี้ถูกดำเนินการไปแล้ว' }); }
    if (Number(reqRow.requested_by) === Number(actorEmpId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'ห้ามอนุมัติคำขอที่ตัวเองสร้าง (Maker-Checker)' });
    }

    // 1) อัปเดตเงินเดือนจริง
    await client.query(
      'UPDATE salary_records SET salary_satang=$1, updated_at=$2 WHERE emp_id=$3',
      [reqRow.new_satang, new Date().toISOString().slice(0, 10), reqRow.emp_id]
    );

    // 2) เขียน audit log แบบ hash chain (append-only)
    const last = (await client.query('SELECT row_hash FROM salary_audit_log ORDER BY id DESC LIMIT 1')).rows[0];
    const prevHash = last ? last.row_hash : 'GENESIS';
    const changedAt = new Date().toISOString();
    const nextId = Number(
      (await client.query(`SELECT nextval(pg_get_serial_sequence('salary_audit_log','id')) AS id`)).rows[0].id
    );
    const r = {
      id: nextId, emp_id: reqRow.emp_id,
      old_value: String(reqRow.old_satang), new_value: String(reqRow.new_satang),
      changed_by: actor.empId, changed_at: changedAt,
    };
    const rowHash = computeRowHash(r, prevHash);
    await client.query(
      `INSERT INTO salary_audit_log
         (id, emp_id, field_name, old_value, new_value, changed_by, changed_by_name, changed_at, prev_hash, row_hash)
       VALUES ($1,$2,'salary_satang',$3,$4,$5,$6,$7,$8,$9)`,
      [r.id, r.emp_id, r.old_value, r.new_value, r.changed_by, actor.name, changedAt, prevHash, rowHash]
    );

    // 3) ปิดคำขอ
    await client.query(
      'UPDATE salary_change_requests SET status=$1, approved_by=$2, approved_by_name=$3 WHERE id=$4',
      ['APPROVED', actor.empId, actor.name, id]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------- ปฏิเสธคำขอ ----------
app.post('/api/requests/:id/reject', async (req, res) => {
  const { actorEmpId } = req.body;
  const actor = userById(actorEmpId);
  if (!actor || actor.role !== 'HR_MANAGER')
    return res.status(403).json({ error: 'เฉพาะ HR Manager เท่านั้นที่ปฏิเสธได้' });
  try {
    await pool.query(
      `UPDATE salary_change_requests SET status='REJECTED', approved_by=$1, approved_by_name=$2
       WHERE id=$3 AND status='PENDING'`,
      [actor.empId, actor.name, Number(req.params.id)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- จำลองภัยคุกคาม: IT แก้เงินเดือนตัวเองใน DB ตรง ๆ (ไม่ผ่านระบบ ไม่มี audit) ----------
app.post('/api/attack/direct-edit', async (req, res) => {
  const { actorEmpId, newAmountBaht } = req.body;
  const actor = userById(actorEmpId);
  if (!actor || actor.role !== 'IT_ADMIN')
    return res.status(403).json({ error: 'ปุ่มนี้จำลองสิทธิ์ IT ที่เข้าถึง DB โดยตรง' });
  try {
    const newSatang = Math.round(Number(newAmountBaht) * 100);
    await pool.query('UPDATE salary_records SET salary_satang=$1 WHERE emp_id=$2', [newSatang, actor.empId]);
    res.json({ ok: true, message: `อนันต์ (IT) แก้เงินเดือนตัวเองใน DB เป็น ${Number(newAmountBaht).toLocaleString()} บาท โดยไม่ผ่าน maker-checker และไม่มี audit log` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- จำลองภัยคุกคาม: IT แก้ค่าใน audit log เพื่อกลบร่องรอย (ไม่อัปเดต hash) ----------
app.post('/api/attack/tamper-log', async (req, res) => {
  const { actorEmpId } = req.body;
  const actor = userById(actorEmpId);
  if (!actor || actor.role !== 'IT_ADMIN')
    return res.status(403).json({ error: 'ปุ่มนี้จำลองสิทธิ์ IT ที่เข้าถึง DB โดยตรง' });
  try {
    const last = (await pool.query('SELECT * FROM salary_audit_log ORDER BY id DESC LIMIT 1')).rows[0];
    if (!last) return res.json({ ok: false, message: 'ยังไม่มี audit log ให้แก้ (อนุมัติคำขอสักรายการก่อน)' });
    const bumped = String(Number(last.new_value) + 100000000); // +1,000,000 บาท
    await pool.query('UPDATE salary_audit_log SET new_value=$1 WHERE id=$2', [bumped, last.id]);
    res.json({ ok: true, message: `อนันต์ (IT) แอบแก้ new_value ของ audit log id=${last.id} (แต่ไม่ได้อัปเดต row_hash)` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- ตรวจสอบความถูกต้อง (Integrity Check) ----------
app.get('/api/verify', async (_req, res) => {
  try {
    const audit = (await pool.query('SELECT * FROM salary_audit_log ORDER BY id')).rows;
    const issues = [];
    const tamperedRows = new Set();

    // 1) ตรวจ hash chain
    let prev = 'GENESIS';
    for (const r of audit) {
      const expect = computeRowHash(
        { id: Number(r.id), emp_id: Number(r.emp_id), old_value: r.old_value, new_value: r.new_value, changed_by: Number(r.changed_by), changed_at: r.changed_at },
        prev
      );
      if (r.prev_hash !== prev) { issues.push(`audit id=${r.id}: prev_hash ไม่ต่อกับโซ่`); tamperedRows.add(Number(r.id)); }
      if (expect !== r.row_hash) { issues.push(`audit id=${r.id}: row_hash ไม่ตรง — ข้อมูลในแถวถูกแก้ไข`); tamperedRows.add(Number(r.id)); }
      prev = r.row_hash;
    }

    // 2) reconcile เงินเดือนปัจจุบัน เทียบกับค่าล่าสุดที่ "ถูกต้อง" (audit ล่าสุด หรือ baseline)
    const salaries = (await pool.query('SELECT * FROM salary_records ORDER BY emp_id')).rows;
    for (const s of salaries) {
      const lastAudit = audit.filter((a) => Number(a.emp_id) === Number(s.emp_id)).slice(-1)[0];
      const expected = lastAudit ? Number(lastAudit.new_value) : INITIAL_SALARY[s.emp_id];
      if (expected !== undefined && Number(s.salary_satang) !== expected) {
        issues.push(
          `เงินเดือน emp_id=${s.emp_id} (${s.name}) = ${(s.salary_satang / 100).toFixed(2)} บาท ` +
          `ไม่ตรงกับค่าที่ผ่านระบบ (${(expected / 100).toFixed(2)} บาท) — น่าจะถูกแก้นอกระบบ`
        );
      }
    }

    res.json({ ok: issues.length === 0, issues, tamperedRows: [...tamperedRows] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Audit app: http://localhost:${PORT}  (DB: localhost:5432)`));
