# ข้อ 3 — ระบบแก้เงินเดือนย้อนหลัง + Audit Trail (Full-stack จริง)

PostgreSQL (port 5432) + Node/Express + Web UI สาธิต **Audit Trail**, **Maker-Checker**
และ **Hash Chain จับการแก้ไขนอกระบบ** ตอบโจทย์ข้อ 3 ครบทั้ง schema + API + กลไกกัน IT

## วิธีรัน
```bash
cd solutions/part1/audit-app
npm install                 # ติดตั้ง express, pg
docker compose up -d        # สตาร์ท PostgreSQL จริงที่ port 5432 (+ seed อัตโนมัติ)
node server.js              # เว็บที่ http://localhost:3000
```
เปิดเบราว์เซอร์ → http://localhost:3000

รีเซ็ตข้อมูลให้สดใหม่: `docker compose down && docker compose up -d`

## บัญชีทดสอบ (password = 1234 ทุกบัญชี)
| username | บทบาท | ทำอะไรได้ |
|----------|-------|-----------|
| `maker`   | HR Maker    | สร้างคำขอแก้เงินเดือน (ของตัวเองไม่ได้) |
| `manager` | HR Manager  | อนุมัติ/ปฏิเสธคำขอ (ของตัวเองไม่ได้) |
| `it`      | IT Admin    | จำลองการเข้าถึง DB ตรง ๆ เพื่อทดสอบการตรวจจับ |

## สคริปต์สาธิตสำหรับวิดีโอ
1. **Audit Trail** — login `maker` → สร้างคำขอแก้เงินเดือน "มานะ" 25,000→30,000
   → login `manager` → อนุมัติ → ดูตาราง `salary_audit_log` มีแถวใหม่ (เก่า→ใหม่, ใคร, เมื่อไหร่, hash)
2. **Separation of Duties** — login `maker` → ลองเลือกแก้เงินเดือนตัวเอง → ระบบบล็อก (CHECK ใน DB)
3. **กัน IT แก้เงินตัวเอง** — login `it` → กด "แก้ DB ตรง ๆ" เป็น 99,999
   → กด **Integrity Check** → ระบบฟ้องว่าเงินเดือนไม่ตรงกับ audit (แก้นอกระบบ)
4. **Tamper-evident** — login `it` → กด "แก้ Audit Log กลบร่องรอย"
   → กด **Integrity Check** → โซ่ hash ขาด แถวที่ถูกแก้ถูกไฮไลต์แดง

## โครงสร้าง
```
audit-app/
├── docker-compose.yml   PostgreSQL 16 → port 5432
├── db/init.sql          schema 3 ตาราง + seed + CHECK no_self_request
├── server.js            Express + pg : login, requests, approve, verify, attack
├── app.js               front-end เรียก API + render ตาราง DB
├── index.html / style.css
└── package.json
```

## สิ่งที่ตอบโจทย์ข้อ 3
- **Schema + Audit Trail**: เก็บ `old_value`, `new_value`, `changed_by`, `changed_at` ครบ
- **REST API**: maker สร้างคำขอ → manager อนุมัติ → เขียน audit ใน transaction เดียว
- **กัน IT แก้เงินตัวเอง**: `CHECK (requested_by <> emp_id)` + maker-checker +
  audit append-only + **hash chain** + **reconciliation** ตรวจจับการแก้ไขนอกระบบได้
