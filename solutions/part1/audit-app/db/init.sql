-- ============================================================================
-- ข้อ 3 — Schema ระบบแก้เงินเดือนย้อนหลัง + Audit Trail (PostgreSQL)
-- ไฟล์นี้รันอัตโนมัติตอน container postgres ถูกสร้างครั้งแรก
-- ============================================================================

-- สถานะเงินเดือนปัจจุบัน (เก็บเป็น "สตางค์" ไม่ใช่ float — บทเรียนจากข้อ 1)
CREATE TABLE IF NOT EXISTS salary_records (
  emp_id        BIGINT PRIMARY KEY,
  name          TEXT   NOT NULL,
  salary_satang BIGINT NOT NULL,
  updated_at    TEXT   NOT NULL
);

-- คำขอแก้ไข (maker-checker): การแก้เงินเดือนต้องผ่าน "คำขอ" ก่อนเสมอ
CREATE TABLE IF NOT EXISTS salary_change_requests (
  id                BIGSERIAL PRIMARY KEY,
  emp_id            BIGINT NOT NULL,           -- พนักงานที่ถูกแก้เงินเดือน
  emp_name          TEXT   NOT NULL,
  old_satang        BIGINT,                    -- ค่าเก่า (snapshot ตอนสร้างคำขอ)
  new_satang        BIGINT NOT NULL,           -- ค่าใหม่ที่เสนอ
  reason            TEXT   NOT NULL,           -- เหตุผล (บังคับ)
  requested_by      BIGINT NOT NULL,           -- ใครสร้างคำขอ (maker)
  requested_by_name TEXT   NOT NULL,
  status            TEXT   NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  approved_by       BIGINT,                    -- ใครอนุมัติ (checker)
  approved_by_name  TEXT,
  requested_at      TEXT   NOT NULL,
  -- กฎแยกหน้าที่ระดับฐานข้อมูล: ห้ามขอแก้เงินเดือนของตัวเอง
  CONSTRAINT no_self_request CHECK (requested_by <> emp_id)
);

-- Audit log แบบ append-only + hash chain (ตรวจจับการแก้ไขย้อนหลัง)
CREATE TABLE IF NOT EXISTS salary_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  emp_id          BIGINT NOT NULL,
  field_name      TEXT   NOT NULL,
  old_value       TEXT,                        -- ค่าเก่า
  new_value       TEXT,                        -- ค่าใหม่
  changed_by      BIGINT NOT NULL,             -- ใคร
  changed_by_name TEXT,
  changed_at      TEXT   NOT NULL,             -- เมื่อไหร่ (ISO; เก็บ text เพื่อ hash ที่ deterministic)
  prev_hash       TEXT,                        -- hash แถวก่อนหน้า
  row_hash        TEXT   NOT NULL              -- SHA-256(ข้อมูลแถว + prev_hash)
);

-- ข้อมูลเริ่มต้นพนักงาน (ค่าเงินเดือนหน่วยสตางค์)
INSERT INTO salary_records (emp_id, name, salary_satang, updated_at) VALUES
  (1001, 'สมศรี (HR Maker)',     3000000, '2026-01-01'),
  (1002, 'ประเสริฐ (HR Manager)', 5000000, '2026-01-01'),
  (1003, 'อนันต์ (IT Admin)',     4000000, '2026-01-01'),
  (1004, 'มานะ (พนักงาน)',        2500000, '2026-01-01')
ON CONFLICT (emp_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- หมายเหตุการป้องกัน IT แก้เงินเดือนตัวเอง (อธิบายในวิดีโอ):
--   * แอปเขียนผ่าน API/stored proc เท่านั้น — ในงานจริงให้ REVOKE INSERT/UPDATE/DELETE
--     บนตารางเหล่านี้จาก role ของแอป/DBA แล้วบังคับผ่าน function ที่ตรวจ maker-checker
--   * CHECK (requested_by <> emp_id) กันการขอแก้เงินเดือนตัวเองตั้งแต่ระดับ schema
--   * audit_log เป็น append-only + hash chain => ถ้ามีคนแก้ค่าใน DB ตรง ๆ
--     โซ่ hash จะขาด และ/หรือ ยอดไม่ตรงกับ audit => ตรวจจับได้ (tamper-evident)
-- ----------------------------------------------------------------------------
