// ============================================================================
// ข้อ 1: The Buggy Payroll Logic — FIXED VERSION
// ============================================================================
//
// โค้ดเดิมมีจุดผิดพลาดร้ายแรง 3 จุด:
//
//   1) FLOATING POINT  — คำนวณเงินด้วย float ของ JS (baseSalary * 0.05 ฯลฯ)
//                        ทำให้เกิดเศษทศนิยมเพี้ยน เช่น 0.1 + 0.2 !== 0.3
//                        เงินเดือนพันคนเพี้ยนทีละสตางค์ = งบบัญชีไม่ตรง
//      วิธีแก้: คำนวณเป็นจำนวนเต็มหน่วย "สตางค์" (1 บาท = 100 สตางค์)
//              และปัด (Math.round) ทุกขั้นที่มีการหาร/คูณอัตรา
//
//   2) SQL INJECTION   — นำ ${empId} และ ${net} ต่อสตริงเข้า query ตรง ๆ
//                        ผู้โจมตีส่ง empId = "1; DROP TABLE salaries;--" ได้
//      วิธีแก้: ใช้ parameterized query ($1, $2) ให้ driver จัดการ escaping
//
//   3) RACE CONDITION  — ไม่มี transaction / ไม่มี idempotency
//                        ถ้า processPayroll() ของพนักงานคนเดียวกันถูกเรียกพร้อมกัน
//                        (กดซ้ำ / retry / รันงวดซ้ำ) จะ "บวกเงินซ้ำ" เข้า balance
//      วิธีแก้: ครอบด้วย transaction + ล็อกแถว (SELECT ... FOR UPDATE)
//              + idempotency key (unique constraint ที่ payroll_runs)
//              เพื่อให้แต่ละงวดของแต่ละคนถูก apply ได้ครั้งเดียวเท่านั้น
//
// หมายเหตุโดเมน (โบนัส): ประกันสังคมไทย 5% แต่มีเพดาน 750 บาท/เดือน
//   (ฐานเงินเดือนสูงสุด 15,000) โค้ดเดิมไม่ได้ cap — แก้ให้ด้วย
// ============================================================================

/**
 * @param {import('pg').Pool} pool         - connection pool (ตัวอย่างใช้ node-postgres)
 * @param {object}  args
 * @param {number}  args.empId             - รหัสพนักงาน
 * @param {number}  args.baseSalary        - เงินเดือน (บาท)
 * @param {number}  args.otHours           - ชั่วโมง OT
 * @param {string}  args.payrollRunId      - คีย์งวดเงินเดือน เช่น "2026-03" (idempotency)
 */
// ---------- 1) ส่วนคำนวณเงิน (แยกเป็นฟังก์ชันบริสุทธิ์ — คำนวณเป็น "สตางค์") ----------
// แก้ BUG #1 Floating Point: ไม่คำนวณเงินด้วย float แต่ใช้จำนวนเต็มสตางค์ + Math.round
function computePayroll(baseSalary, otHours) {
  const baseSatang = Math.round(baseSalary * 100);

  // ประกันสังคม 5% เพดาน 750 บาท (= 75,000 สตางค์)
  const ssoSatang = Math.min(Math.round(baseSatang * 0.05), 750 * 100);

  // อัตรา OT = (เงินเดือน / 30 วัน / 8 ชม.) * 1.5  — ปัดอัตราต่อ ชม. ก่อน แล้วค่อยคูณ
  const otRatePerHourSatang = Math.round((baseSatang / 30 / 8) * 1.5);
  const otSatang = Math.round(otRatePerHourSatang * otHours);

  const grossSatang = baseSatang + otSatang;
  const netSatang = grossSatang - ssoSatang;

  return { baseSatang, ssoSatang, otRatePerHourSatang, otSatang, grossSatang, netSatang };
}

async function processPayroll(pool, { empId, baseSalary, otHours, payrollRunId }) {
  const { netSatang } = computePayroll(baseSalary, otHours);

  // ---------- 2) + 3) transaction + parameterized query + idempotency ----------
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotency guard:
    // ตาราง payroll_runs มี UNIQUE (emp_id, payroll_run_id)
    // ถ้างวดนี้ของคนนี้เคยถูกประมวลผลแล้ว INSERT จะชนกัน -> rowCount = 0 -> ไม่ทำซ้ำ
    const ins = await client.query(
      `INSERT INTO payroll_runs (emp_id, payroll_run_id, net_satang)
       VALUES ($1, $2, $3)
       ON CONFLICT (emp_id, payroll_run_id) DO NOTHING
       RETURNING id`,
      [empId, payrollRunId, netSatang]
    );

    if (ins.rowCount === 0) {
      await client.query('ROLLBACK');
      return { netSatang: null, alreadyProcessed: true };
    }

    // ล็อกแถวเงินเดือนก่อนอัปเดต (กัน read-modify-write ซ้อนกัน)
    await client.query('SELECT 1 FROM salaries WHERE emp_id = $1 FOR UPDATE', [empId]);

    // อัปเดตแบบ atomic (balance = balance + net) ด้วย parameter — ไม่มี SQL injection
    await client.query(
      `UPDATE salaries SET balance_satang = balance_satang + $1 WHERE emp_id = $2`,
      [netSatang, empId]
    );

    await client.query('COMMIT');
    return { netSatang, net: netSatang / 100, alreadyProcessed: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // ให้ caller จัดการ / log / alert
  } finally {
    client.release();
  }
}

module.exports = { processPayroll, computePayroll };

// ---------------------------------------------------------------------------
// DEMO: รันด้วย  node solutions/part1/q1-payroll-fix.js
// ใช้ input ชุดเดียวกับฉบับผิด (q1-payroll-buggy.js) เพื่อเทียบผลลัพธ์
// ---------------------------------------------------------------------------
if (require.main === module) {
  const show = (label, baseSalary, otHours) => {
    const r = computePayroll(baseSalary, otHours);
    const b = (s) => (s / 100).toFixed(2); // สตางค์ -> บาท 2 ตำแหน่ง
    console.log(`\n=== ${label} (baseSalary=${baseSalary}, otHours=${otHours}) ===`);
    console.log(`[Fixed] sso (5%, cap 750): ${b(r.ssoSatang)}  บาท`);
    console.log(`[Fixed] otRate (1.5x)    : ${b(r.otRatePerHourSatang)}  บาท/ชม.`);
    console.log(`[Fixed] gross            : ${b(r.grossSatang)}  บาท`);
    console.log(`[Fixed] net              : ${b(r.netSatang)}  บาท  (= ${r.netSatang} สตางค์)`);
  };

  show('Demo with typical values', 30000, 15);
  show('Demo highlighting floating point fix', 10000.07, 1.5);
  console.log('\nสังเกต: ทุกค่าจบที่ 2 ตำแหน่งทศนิยมพอดี ไม่มีหาง .000000x เหมือนฉบับผิด');
}

/* ---------------------------------------------------------------------------
   Schema ที่เกี่ยวข้อง (ตัวอย่าง PostgreSQL)

   CREATE TABLE salaries (
     emp_id         BIGINT PRIMARY KEY,
     balance_satang BIGINT NOT NULL DEFAULT 0   -- เก็บเป็นสตางค์ ไม่ใช่ float
   );

   CREATE TABLE payroll_runs (
     id             BIGSERIAL PRIMARY KEY,
     emp_id         BIGINT NOT NULL,
     payroll_run_id TEXT   NOT NULL,            -- เช่น '2026-03'
     net_satang     BIGINT NOT NULL,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (emp_id, payroll_run_id)            -- หัวใจของ idempotency
   );
--------------------------------------------------------------------------- */
