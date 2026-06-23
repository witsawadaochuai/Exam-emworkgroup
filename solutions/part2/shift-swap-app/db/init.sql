-- ============================================================================
-- ข้อ 5 — Schema รองรับ Shift Swapping (PostgreSQL)
-- เก็บสถานะ approve จากหัวหน้า + คิดเบี้ยเลี้ยงกะดึกให้ "คนที่ทำงานจริง" หลังสลับ
-- ============================================================================

CREATE TABLE IF NOT EXISTS employees (
  emp_id        BIGINT PRIMARY KEY,
  full_name     TEXT   NOT NULL,
  is_supervisor BOOLEAN NOT NULL DEFAULT FALSE
);

-- ประเภทกะ + อัตราเบี้ยเลี้ยงกะดึก (เก็บเวลาเป็น text เพื่อแสดงผลตรงกับ UI)
CREATE TABLE IF NOT EXISTS shifts (
  shift_id               SERIAL PRIMARY KEY,
  shift_type             TEXT NOT NULL,            -- 'MORNING' | 'EVENING' | 'NIGHT'
  start_time             TEXT NOT NULL,
  end_time               TEXT NOT NULL,
  crosses_midnight       BOOLEAN NOT NULL DEFAULT FALSE,
  night_allowance_satang BIGINT NOT NULL DEFAULT 0 -- เบี้ยเลี้ยงกะดึก (สตางค์)
);

-- ตารางมอบหมายกะ: แยก "คนเดิม (original)" กับ "คนที่ทำงานจริง (effective)"
CREATE TABLE IF NOT EXISTS shift_assignments (
  assignment_id    BIGSERIAL PRIMARY KEY,
  work_date        DATE   NOT NULL,
  shift_id         INT    NOT NULL REFERENCES shifts(shift_id),
  original_emp_id  BIGINT NOT NULL REFERENCES employees(emp_id),
  effective_emp_id BIGINT NOT NULL REFERENCES employees(emp_id),
  swap_request_id  BIGINT,                          -- ถ้ามาจากการสลับ ชี้คำขอที่อนุมัติ
  UNIQUE (work_date, shift_id, original_emp_id)
);

-- คำขอสลับกะ + สถานะอนุมัติจากหัวหน้า (target_assignment_id = NULL คือ one-way cover)
CREATE TABLE IF NOT EXISTS shift_swap_requests (
  swap_request_id         BIGSERIAL PRIMARY KEY,
  requester_emp_id        BIGINT NOT NULL REFERENCES employees(emp_id),
  requester_assignment_id BIGINT NOT NULL REFERENCES shift_assignments(assignment_id),
  target_emp_id           BIGINT NOT NULL REFERENCES employees(emp_id),
  target_assignment_id    BIGINT REFERENCES shift_assignments(assignment_id),
  reason                  TEXT,
  status                  TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  approved_by             BIGINT REFERENCES employees(emp_id),
  approved_at             TEXT,
  created_at              TEXT NOT NULL,
  CHECK (requester_emp_id <> target_emp_id)
);

-- ---------------- Seed ----------------
INSERT INTO employees (emp_id, full_name, is_supervisor) VALUES
  (1, 'Somchai Dev', FALSE),
  (2, 'Alice HR', FALSE),
  (3, 'Bob Manager (Supervisor)', TRUE),
  (4, 'Charlie Staff', FALSE)
ON CONFLICT (emp_id) DO NOTHING;

INSERT INTO shifts (shift_id, shift_type, start_time, end_time, crosses_midnight, night_allowance_satang) VALUES
  (1, 'MORNING', '08:00', '16:00', FALSE, 0),
  (2, 'EVENING', '16:00', '24:00', FALSE, 0),
  (3, 'NIGHT',   '00:00', '08:00', TRUE, 50000)   -- กะดึกได้เบี้ยเลี้ยง 500 บาท
ON CONFLICT (shift_id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('shifts','shift_id'), 3, true);

INSERT INTO shift_assignments (assignment_id, work_date, shift_id, original_emp_id, effective_emp_id, swap_request_id) VALUES
  (1, '2026-06-24', 3, 1, 1, NULL),  -- Somchai กะดึก
  (2, '2026-06-24', 1, 2, 2, NULL),  -- Alice กะเช้า
  (3, '2026-06-25', 3, 1, 1, NULL),  -- Somchai กะดึก
  (4, '2026-06-25', 1, 4, 4, NULL),  -- Charlie กะเช้า
  (5, '2026-06-26', 3, 4, 4, NULL),  -- Charlie กะดึก
  (6, '2026-06-26', 2, 2, 2, NULL)   -- Alice กะบ่าย
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('shift_assignments','assignment_id'), 6, true);

-- คำขอตัวอย่าง: Somchai ขอให้ Charlie มาทำกะดึกแทนวันที่ 25 (one-way cover)
INSERT INTO shift_swap_requests
  (swap_request_id, requester_emp_id, requester_assignment_id, target_emp_id, target_assignment_id, reason, status, created_at) VALUES
  (1, 1, 3, 4, NULL, 'Have a family dinner', 'PENDING', '2026-06-23T10:00:00')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('shift_swap_requests','swap_request_id'), 1, true);
