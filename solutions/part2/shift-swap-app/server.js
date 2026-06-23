// ============================================================================
// ข้อ 5 — Backend (Express + PostgreSQL) ระบบสลับกะ + เบี้ยเลี้ยงกะดึก
// PostgreSQL: localhost:5433 (docker)  ·  Web: http://localhost:3001
// ============================================================================
const express = require('express');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5433),
  user: process.env.PGUSER || 'shift',
  password: process.env.PGPASSWORD || 'shift',
  database: process.env.PGDATABASE || 'shift',
});

// กัน process ล่มเมื่อ DB หลุดชั่วคราว (เช่นตอน restart container) — pool จะ reconnect ให้เอง
pool.on('error', (err) => console.error('pg pool error (จะ reconnect ให้เอง):', err.message));

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// ---------- สถานะทั้งหมดของระบบ (employees / shifts / assignments / requests) ----------
// cast id และ satang เป็น int เพื่อให้ฝั่ง front-end เทียบค่าแบบ === ได้ถูกต้อง
app.get('/api/state', async (_req, res) => {
  try {
    const employees = (await pool.query(
      `SELECT emp_id::int, full_name, is_supervisor FROM employees ORDER BY emp_id`
    )).rows;
    const shifts = (await pool.query(
      `SELECT shift_id::int, shift_type, start_time, end_time, crosses_midnight,
              night_allowance_satang::int
       FROM shifts ORDER BY shift_id`
    )).rows;
    const assignments = (await pool.query(
      `SELECT assignment_id::int, to_char(work_date,'YYYY-MM-DD') AS work_date, shift_id::int,
              original_emp_id::int, effective_emp_id::int, swap_request_id::int
       FROM shift_assignments ORDER BY assignment_id`
    )).rows;
    const requests = (await pool.query(
      `SELECT swap_request_id::int, requester_emp_id::int, requester_assignment_id::int,
              target_emp_id::int, target_assignment_id::int, reason, status,
              approved_by::int, approved_at, created_at
       FROM shift_swap_requests ORDER BY swap_request_id`
    )).rows;
    res.json({ employees, shifts, assignments, requests });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- สร้างคำขอสลับกะ (one-way: target_assignment_id = null, mutual: ระบุ) ----------
app.post('/api/swaps', async (req, res) => {
  const { requester_emp_id, requester_assignment_id, target_emp_id, target_assignment_id, reason } = req.body;
  try {
    if (Number(requester_emp_id) === Number(target_emp_id))
      return res.status(400).json({ error: 'ไม่สามารถสลับกะงานกับตัวเองได้' });

    const a = (await pool.query('SELECT * FROM shift_assignments WHERE assignment_id=$1', [requester_assignment_id])).rows[0];
    if (!a) return res.status(404).json({ error: 'ไม่พบกะของผู้ขอ' });
    if (Number(a.effective_emp_id) !== Number(requester_emp_id))
      return res.status(403).json({ error: 'สลับได้เฉพาะกะของตัวเองเท่านั้น' });

    if (target_assignment_id) {
      const b = (await pool.query('SELECT * FROM shift_assignments WHERE assignment_id=$1', [target_assignment_id])).rows[0];
      if (!b) return res.status(404).json({ error: 'ไม่พบกะของพนักงานเป้าหมาย' });
      if (Number(b.effective_emp_id) !== Number(target_emp_id))
        return res.status(400).json({ error: 'กะที่จะแลกคืนไม่ใช่ของพนักงานเป้าหมาย' });
    }

    await pool.query(
      `INSERT INTO shift_swap_requests
         (requester_emp_id, requester_assignment_id, target_emp_id, target_assignment_id, reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [requester_emp_id, requester_assignment_id, target_emp_id, target_assignment_id || null, (reason || '').trim(), new Date().toISOString()]
    );
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- อนุมัติ (เฉพาะหัวหน้า) — สลับ effective_emp_id ใน transaction เดียว ----------
app.post('/api/swaps/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    // ผู้อนุมัติ = หัวหน้างาน (is_supervisor) — รับจาก body หรือ default เป็นหัวหน้าคนแรก
    const supRow = req.body.approverEmpId
      ? (await client.query('SELECT emp_id, is_supervisor FROM employees WHERE emp_id=$1', [req.body.approverEmpId])).rows[0]
      : (await client.query('SELECT emp_id, is_supervisor FROM employees WHERE is_supervisor=TRUE ORDER BY emp_id LIMIT 1')).rows[0];
    if (!supRow || !supRow.is_supervisor)
      return res.status(403).json({ error: 'เฉพาะหัวหน้างานเท่านั้นที่อนุมัติได้' });

    await client.query('BEGIN');
    const r = (await client.query('SELECT * FROM shift_swap_requests WHERE swap_request_id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!r) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'ไม่พบคำขอ' }); }
    if (r.status !== 'PENDING') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'คำขอนี้ถูกดำเนินการไปแล้ว' }); }

    // 1) กะของผู้ขอ -> ให้ผู้ปฏิบัติงานจริงเป็นพนักงานเป้าหมาย
    await client.query(
      'UPDATE shift_assignments SET effective_emp_id=$1, swap_request_id=$2 WHERE assignment_id=$3',
      [r.target_emp_id, r.swap_request_id, r.requester_assignment_id]
    );
    // 2) ถ้าเป็น mutual (มีกะแลกคืน) -> กะเป้าหมายให้ผู้ขอทำแทน
    if (r.target_assignment_id) {
      await client.query(
        'UPDATE shift_assignments SET effective_emp_id=$1, swap_request_id=$2 WHERE assignment_id=$3',
        [r.requester_emp_id, r.swap_request_id, r.target_assignment_id]
      );
    }
    // 3) ปิดคำขอ
    await client.query(
      'UPDATE shift_swap_requests SET status=$1, approved_by=$2, approved_at=$3 WHERE swap_request_id=$4',
      ['APPROVED', supRow.emp_id, new Date().toISOString(), r.swap_request_id]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ---------- ปฏิเสธ (เฉพาะหัวหน้า) ----------
app.post('/api/swaps/:id/reject', async (req, res) => {
  try {
    const supRow = req.body.approverEmpId
      ? (await pool.query('SELECT emp_id, is_supervisor FROM employees WHERE emp_id=$1', [req.body.approverEmpId])).rows[0]
      : (await pool.query('SELECT emp_id, is_supervisor FROM employees WHERE is_supervisor=TRUE ORDER BY emp_id LIMIT 1')).rows[0];
    if (!supRow || !supRow.is_supervisor)
      return res.status(403).json({ error: 'เฉพาะหัวหน้างานเท่านั้นที่ปฏิเสธได้' });
    await pool.query(
      `UPDATE shift_swap_requests SET status='REJECTED', approved_by=$1, approved_at=$2
       WHERE swap_request_id=$3 AND status='PENDING'`,
      [supRow.emp_id, new Date().toISOString(), req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Shift-swap app: http://localhost:${PORT}  (DB: localhost:5433)`));
