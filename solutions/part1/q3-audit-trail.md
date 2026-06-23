# ข้อ 3 — System Design & Audit Trail (15 คะแนน)

ออกแบบ REST API + Database Schema สำหรับระบบ **"แก้ไขเงินเดือนย้อนหลัง"**
ที่มี Audit Trail ครบ และป้องกันไม่ให้ IT แอบแก้เงินเดือนตัวเองในฐานข้อมูล

---

## 1) Database Schema (รองรับ Audit Trail)

```sql
-- ตารางสถานะปัจจุบันของเงินเดือน (current state)
CREATE TABLE salary_records (
  id           BIGSERIAL PRIMARY KEY,
  emp_id       BIGINT NOT NULL REFERENCES employees(emp_id),
  effective_from DATE NOT NULL,           -- งวดที่ค่านี้มีผล (รองรับย้อนหลัง)
  amount_satang  BIGINT NOT NULL,          -- เก็บเป็นสตางค์ ไม่ใช้ float
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (emp_id, effective_from)
);

-- คำขอแก้ไข (maker-checker): ทุกการแก้ต้องผ่าน "คำขอ" ก่อน เขียนตารางจริงไม่ได้ตรง ๆ
CREATE TABLE salary_change_requests (
  id            BIGSERIAL PRIMARY KEY,
  emp_id        BIGINT  NOT NULL,          -- พนักงานที่ถูกแก้เงินเดือน
  effective_from DATE   NOT NULL,
  old_amount_satang BIGINT,                -- ค่าเก่า (snapshot ตอนสร้างคำขอ)
  new_amount_satang BIGINT NOT NULL,       -- ค่าใหม่ที่เสนอ
  reason        TEXT    NOT NULL,          -- เหตุผล (บังคับ)
  requested_by  BIGINT  NOT NULL,          -- "ใครแก้" (maker)
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT    NOT NULL DEFAULT 'PENDING'  -- PENDING|APPROVED|REJECTED
                CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  approved_by   BIGINT,                    -- "ใครอนุมัติ" (checker)
  approved_at   TIMESTAMPTZ,
  -- กฎแยกหน้าที่ระดับฐานข้อมูล:
  CHECK (requested_by <> approved_by),     -- ผู้ขอ != ผู้อนุมัติ
  CHECK (requested_by <> emp_id)           -- ห้ามแก้เงินเดือนของตัวเอง
);

-- Audit log แบบ append-only + hash chain (ตรวจจับการแก้ย้อนหลังในตาราง log เอง)
CREATE TABLE salary_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  request_id   BIGINT NOT NULL REFERENCES salary_change_requests(id),
  emp_id       BIGINT NOT NULL,
  field_name   TEXT   NOT NULL,            -- เช่น 'amount_satang'
  old_value    TEXT,                       -- ค่าเก่า
  new_value    TEXT,                       -- ค่าใหม่
  changed_by   BIGINT NOT NULL,            -- ใคร
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),  -- เมื่อไหร่
  prev_hash    TEXT,                       -- hash ของแถวก่อนหน้า
  row_hash     TEXT NOT NULL               -- SHA-256(ข้อมูลแถวนี้ + prev_hash)
);
```

**ครบเงื่อนไข Audit Trail:** เก็บ `old_value`, `new_value`, `changed_by` (ใคร), `changed_at` (เมื่อไหร่)
และเชื่อมโยงกับ `reason` + คำขอ/ผู้อนุมัติ

---

## 2) REST API

| Method | Endpoint | หน้าที่ | สิทธิ์ |
|--------|----------|---------|--------|
| `POST` | `/api/v1/salary-change-requests` | สร้างคำขอแก้เงินเดือนย้อนหลัง | HR Maker |
| `GET`  | `/api/v1/salary-change-requests?status=PENDING` | ดูคำขอที่รออนุมัติ | HR Manager |
| `POST` | `/api/v1/salary-change-requests/{id}/approve` | อนุมัติ → ระบบเขียน `salary_records` + `salary_audit_log` ใน transaction เดียว | HR Manager (≠ ผู้ขอ) |
| `POST` | `/api/v1/salary-change-requests/{id}/reject` | ปฏิเสธ | HR Manager |
| `GET`  | `/api/v1/employees/{empId}/salary-history` | ดูประวัติย้อนหลังทั้งหมด (อ่านจาก audit log) | HR / Auditor |

ตัวอย่าง request:
```json
POST /api/v1/salary-change-requests
{
  "empId": 1024,
  "effectiveFrom": "2026-01-01",
  "newAmountSatang": 3500000,
  "reason": "ปรับฐานย้อนหลังตามมติคณะกรรมการ ครั้งที่ 3/2026"
}
```

**หลักการ:** API เป็น **ทางเข้าเดียว** (single write path) ที่แก้เงินเดือนได้
ทุกการเปลี่ยนแปลงต้องผ่าน maker-checker และถูกบันทึก audit อัตโนมัติในทรานแซกชันเดียว

---

## 3) กลไกป้องกัน IT แอบแก้เงินเดือนตัวเองใน Database

> ภัยคุกคาม: พนักงาน IT/DBA มีสิทธิ์เข้าถึง DB โดยตรง อาจ `UPDATE salary_records`
> ของตัวเองโดยไม่ผ่าน API

### ความจริงที่ต้องยอมรับก่อน
คนที่ถือสิทธิ์ระดับ superuser/DBA จริง ๆ เรา **ห้ามแบบ 100% ไม่ได้** ฉะนั้นกลยุทธ์คือ
**ป้องกัน (เอาสิทธิ์ออกจากมือคนส่วนใหญ่) + ตรวจจับ (ถ้าแอบทำต้องจับได้และลบหลักฐานไม่ได้)** ควบคู่กัน
— "ป้องกันล้วน" ไม่มีจริงกับคนที่ถือกุญแจ root

### ด่าน 1 — สิทธิ์การเข้าถึง DB (ตัวที่กันได้จริง = พระเอก)

**1.1 IT ไม่มี credential ของ production DB เลย ← 80% ของคำตอบ**
แอปต่อ DB ด้วย service account (เก็บใน secret manager) ที่คนเข้าไม่ถึง พนักงาน IT/dev
**ไม่มีรหัสเข้า DB จริง** ตั้งแต่แรก ทุกการแก้ต้องผ่าน "หน้าจอแอป" เท่านั้น — ไม่มีทางลัดไป DB

**1.2 Least Privilege — แม้แต่ service account ก็แก้ตรง ๆ ไม่ได้**
```sql
-- แอปใช้ role จำกัดสิทธิ์ ไม่ใช่ superuser
CREATE ROLE payroll_app LOGIN PASSWORD '...';

-- ตัดสิทธิ์เขียน "ตรง ๆ" บนตารางเงินเดือน
REVOKE INSERT, UPDATE, DELETE ON salary_records FROM payroll_app;

-- audit log = append-only: ให้ INSERT อย่างเดียว ห้าม UPDATE/DELETE เด็ดขาด
REVOKE UPDATE, DELETE ON salary_audit_log FROM payroll_app;
GRANT  INSERT, SELECT ON salary_audit_log TO payroll_app;

-- แก้เงินเดือนได้ "ผ่านฟังก์ชันที่บังคับ maker-checker" เท่านั้น (SECURITY DEFINER)
GRANT EXECUTE ON FUNCTION approve_salary_change(...) TO payroll_app;
```

**1.3 Separation of Duties** — บังคับด้วย `CHECK (requested_by <> emp_id)` และ
`requested_by <> approved_by` ที่ระดับ DB — คนดูแลระบบ ≠ คนที่เงินเดือนอยู่ในระบบ

### ด่าน 2 — คุมการเข้าถึงของ DBA ที่จำเป็น (PAM)
ถ้าจำเป็นต้องมี DBA เข้า production ได้: เข้าผ่าน bastion + **ขออนุมัติชั่วคราว (just-in-time)** +
**บันทึก session** + แจ้งเตือนเมื่อแตะตารางเงินเดือน → เข้าแบบเงียบ ๆ ไม่ได้

### ด่าน 3 — ถ้าหลุดมาแก้ได้จริง ต้อง "จับได้" (= ที่ web app เดโม)
- **Append-only Audit + Hash Chain** — `row_hash = SHA-256(ข้อมูล + prev_hash)` ต่อกันเป็นโซ่
  แก้/ลบแถวในอดีต → โซ่ hash ขาด → ตรวจจับได้ทันที (tamper-evident)
- **Reconciliation** — งานประจำเทียบ `salary_records` กับค่าล่าสุดใน audit log
  ถ้าไม่ตรง = มีการแก้นอกระบบ → แจ้งเตือน
- **แยกที่เก็บ Log + ส่ง SIEM/WORM** ภายนอกที่ IT ระบบนี้เข้าไม่ถึง → ลบหลักฐานไม่ได้

---

### จริง ๆ ต้องทำครบทุกชั้นไหม? (ใช้ตามความเสี่ยง vs ต้นทุน)

| ระดับ | ใครทำ | ทำแค่ไหน |
|------|-------|----------|
| **ขั้นต่ำ (เกือบทุกที่ทำ)** | บริษัททั่วไป / SME | Least Privilege + Maker-Checker + Audit Log |
| **มาตรฐาน** | บริษัทกลาง-ใหญ่ | + แยก dev/prod, จำกัด credential prod, log การเข้าถึง |
| **เต็มสูบ** | ธนาคาร / รพ. / บริษัทมหาชน | + PAM + Hash Chain + SIEM/WORM |

**3 อย่างแรก = "ต้องมี" สำหรับข้อมูลเงินเดือน** ส่วน PAM/Hash Chain/SIEM เพิ่มตามระดับความเสี่ยง

### บทพูดสำหรับวิดีโอ (เปิดอ่านได้เลย)
> "ตัวที่กัน IT แก้ DB ได้จริงคือ **เอา credential ออกจากมือ IT แล้วบังคับให้ทุกการแก้ผ่านแอป** —
> ถ้าไม่มีกุญแจก็เปิดประตูไม่ได้ ส่วนคนระดับ DBA ที่ห้าม 100% ไม่ได้ เราคุมด้วย PAM และต่อให้
> หลุดมาแก้ได้จริง ก็ **จับได้** ด้วย hash chain กับ reconciliation อย่างที่เห็นในเดโม
> สำหรับเคสนี้ (โรงงาน 800 คน) ผมเริ่มที่ 3 อย่างที่ต้องมีก่อน แล้วออกแบบให้ต่อยอดไป
> เต็มสูบได้เมื่อบริษัทต้องผ่าน audit — ไม่ over-engineer ตั้งแต่วันแรก แต่ scale ได้"
