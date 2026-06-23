# ข้อ 5 — ระบบสลับกะ (Shift Swapping) + เบี้ยเลี้ยงกะดึก (Full-stack จริง)

PostgreSQL (port **5433**) + Node/Express + Web UI สาธิตการสลับกะที่ **อนุมัติโดยหัวหน้า**
และ **คิดเบี้ยเลี้ยงกะดึกให้ผู้ปฏิบัติงานจริง (effective)** ถูกต้องแม้มีการแลกกะ

## วิธีรัน
```bash
cd solutions/part2/shift-swap-app
npm install                 # ติดตั้ง express, pg
docker compose up -d        # สตาร์ท PostgreSQL จริงที่ port 5433 (+ seed อัตโนมัติ)
node server.js              # เว็บที่ http://localhost:3001
```
เปิดเบราว์เซอร์ → http://localhost:3001

รีเซ็ตข้อมูลให้สดใหม่: `docker compose down && docker compose up -d` แล้ว `node server.js` ใหม่

> หมายเหตุ: ใช้ port **5433 / 3001** เพื่อเลี่ยงชนกับ audit-app (ข้อ 3) ที่ใช้ 5432 / 3000

## แท็บในแอป
1. **ตารางเวรการปฏิบัติงาน** — แยก "พนักงานเดิม (original)" vs "ผู้ทำงานจริง (effective)"
2. **ยื่นคำขอสลับกะ** — รองรับ One-Way Cover (มาแทนฝ่ายเดียว) และ Mutual Swap (แลกกะสองฝ่าย)
3. **คอนโซลหัวหน้างาน** — อนุมัติ/ปฏิเสธ (อัปเดต effective อัตโนมัติใน transaction เดียว)
4. **รายงานเบี้ยเลี้ยงกะดึก** — คิดจาก `effective_emp_id`

## สคริปต์สาธิตสำหรับวิดีโอ
1. แท็บ **รายงานเบี้ยเลี้ยง** — ดูยอดก่อนสลับ: Somchai มี 2 กะดึก (฿1,000), Charlie 1 กะ (฿500)
2. แท็บ **คอนโซลหัวหน้างาน** — อนุมัติคำขอ #REQ-1 (Somchai ขอให้ Charlie มาทำกะดึกแทน 25 มิ.ย.)
3. กลับไป **ตารางเวร** — แถวนั้น effective เปลี่ยนเป็น Charlie + ป้าย "สลับกะแล้ว"
4. กลับไป **รายงานเบี้ยเลี้ยง** — ยอดย้าย: Somchai เหลือ ฿500, **Charlie ได้ ฿1,000** (จ่ายให้คนทำจริง ✅)

## key design (ตอบโจทย์ข้อ 5)
- **แยก `original_emp_id` / `effective_emp_id`** ในตาราง `shift_assignments`
  → เก็บทั้ง "แผนเดิม" และ "ความจริงหลังสลับ"
- **สถานะอนุมัติจากหัวหน้า** ในตาราง `shift_swap_requests` (PENDING/APPROVED/REJECTED)
- **เบี้ยเลี้ยงกะดึกคิดจาก `effective_emp_id`** → ถูกต้องเสมอแม้สลับกะ
- การอนุมัติทำใน **transaction เดียว** (อัปเดต assignment + ปิดคำขอ)

## โครงสร้าง
```
shift-swap-app/
├── docker-compose.yml   PostgreSQL 16 → port 5433
├── db/init.sql          schema 4 ตาราง + seed
├── server.js            Express + pg : /api/state, swaps, approve, reject
├── app.js               front-end เรียก API + render
├── index.html / style.css
└── package.json
```
