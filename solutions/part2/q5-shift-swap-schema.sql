-- ============================================================================
-- ข้อ 5: Database Modeling for Shifts — Shift Swapping (15 คะแนน)
-- ============================================================================
-- ต้องการ:
--   1) เก็บ "สถานะการ Approve จากหัวหน้า" ของการสลับกะ
--   2) คำนวณ "เบี้ยเลี้ยงกะดึก" ได้ถูกต้อง แม้มีการแลกงานกัน
--      => เบี้ยเลี้ยงต้องจ่ายให้ "คนที่ทำงานกะดึกจริง" หลังสลับ ไม่ใช่คนที่ถูก assign แต่แรก
--
-- แนวคิดหลัก: แยก "กะที่ถูกมอบหมายแต่แรก" ออกจาก "ผู้ปฏิบัติงานจริง (effective)"
--             การคำนวณเบี้ยเลี้ยงอ้างอิงจาก effective_emp_id เสมอ
-- ============================================================================

-- ประเภทกะ + อัตราเบี้ยเลี้ยงกะดึก
CREATE TABLE shifts (
  shift_id          SERIAL PRIMARY KEY,
  shift_type        TEXT NOT NULL,          -- 'MORNING' | 'EVENING' | 'NIGHT'
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  crosses_midnight  BOOLEAN NOT NULL DEFAULT FALSE,  -- กะ NIGHT = TRUE
  night_allowance_satang BIGINT NOT NULL DEFAULT 0   -- เบี้ยเลี้ยงกะดึก (สตางค์)
);

-- ตารางมอบหมายกะ: เก็บทั้งคนเดิม และคนที่ทำงานจริง (effective)
CREATE TABLE shift_assignments (
  assignment_id     BIGSERIAL PRIMARY KEY,
  work_date         DATE   NOT NULL,
  shift_id          INT    NOT NULL REFERENCES shifts(shift_id),
  original_emp_id   BIGINT NOT NULL REFERENCES employees(emp_id),  -- คนที่ถูก assign แต่แรก
  effective_emp_id  BIGINT NOT NULL REFERENCES employees(emp_id),  -- คนที่ทำงานจริงหลังสลับ
  swap_request_id   BIGINT,                  -- ถ้ามาจากการสลับ ชี้ไปคำขอที่อนุมัติแล้ว
  UNIQUE (work_date, shift_id, original_emp_id)
);
-- ปกติ effective_emp_id = original_emp_id
-- เมื่อสลับกะสำเร็จ (อนุมัติแล้ว) จะอัปเดต effective_emp_id เป็นคนที่มารับงานแทน

-- คำขอสลับกะ + สถานะอนุมัติจากหัวหน้า
CREATE TABLE shift_swap_requests (
  swap_request_id   BIGSERIAL PRIMARY KEY,
  requester_emp_id  BIGINT NOT NULL REFERENCES employees(emp_id),  -- ผู้ขอสลับ
  requester_assignment_id BIGINT NOT NULL REFERENCES shift_assignments(assignment_id),
  target_emp_id     BIGINT NOT NULL REFERENCES employees(emp_id),  -- คนที่จะมารับ/แลกกะ
  target_assignment_id    BIGINT REFERENCES shift_assignments(assignment_id), -- NULL = รับแทนเฉย ๆ ไม่ได้แลกกลับ
  reason            TEXT,
  -- สถานะอนุมัติจากหัวหน้า:
  status            TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  approved_by       BIGINT REFERENCES employees(emp_id),  -- หัวหน้าที่อนุมัติ
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (requester_emp_id <> target_emp_id)
);

-- ============================================================================
-- การคำนวณเบี้ยเลี้ยงกะดึก — อ้างอิง "ผู้ปฏิบัติงานจริง" (effective_emp_id)
-- => ถูกต้องแม้มีการแลกงาน: ใครทำกะ NIGHT จริง คนนั้นได้เบี้ยเลี้ยง
-- ============================================================================
-- ตัวอย่าง: สรุปเบี้ยเลี้ยงกะดึกของเดือน มี.ค. 2026 รายคน
SELECT sa.effective_emp_id              AS emp_id,
       e.full_name,
       COUNT(*)                          AS night_shifts_worked,
       SUM(s.night_allowance_satang)     AS total_night_allowance_satang
FROM   shift_assignments sa
JOIN   shifts    s ON s.shift_id = sa.shift_id
JOIN   employees e ON e.emp_id   = sa.effective_emp_id
WHERE  s.shift_type = 'NIGHT'
  AND  sa.work_date BETWEEN DATE '2026-03-01' AND DATE '2026-03-31'
GROUP BY sa.effective_emp_id, e.full_name;

-- ----------------------------------------------------------------------------
-- ขั้นตอนเมื่อหัวหน้าอนุมัติคำขอสลับ (ทำใน transaction เดียว):
--   1) UPDATE shift_swap_requests SET status='APPROVED', approved_by=?, approved_at=now()
--   2) UPDATE shift_assignments SET effective_emp_id = <ผู้รับงาน>, swap_request_id = ?
--        WHERE assignment_id = requester_assignment_id
--   3) (ถ้าเป็นการแลกสองทาง) ทำกลับด้านกับ target_assignment_id
-- => หลังจากนั้น query เบี้ยเลี้ยงด้านบนจะคิดให้คนที่ทำจริงโดยอัตโนมัติ
--
-- เหตุผลที่แยก original / effective:
--   * เก็บ "ความตั้งใจเดิม" ไว้ตรวจสอบ/ออดิท ว่าตารางเดิมเป็นใคร
--   * เก็บ "ความจริง" ไว้คิดเงิน/เบี้ยเลี้ยง — สองอย่างนี้ต่างกันหลังสลับกะ
-- ----------------------------------------------------------------------------
