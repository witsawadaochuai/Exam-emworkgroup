document.addEventListener('DOMContentLoaded', () => {
    const divideAndRound = (numerator, denominator) =>
        (numerator + denominator / 2n) / denominator;

    const tabs = document.querySelectorAll('.tab-btn');
    const pages = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => tab.addEventListener('click', () => {
        tabs.forEach(item => item.classList.remove('active'));
        pages.forEach(page => page.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
    }));

    document.getElementById('run-decimal').addEventListener('click', () => {
        const result = 0.1 + 0.2;
        document.getElementById('decimal-output').innerHTML =
            `ผลลัพธ์จริง: <strong>${result}</strong><br>เท่ากับ 0.3 หรือไม่? <strong>${result === 0.3}</strong>`;
    });

    document.getElementById('run-payroll').addEventListener('click', () => {
        const baseSalary = Number(document.getElementById('salary').value);
        const otHours = Number(document.getElementById('hours').value);

        const sso = baseSalary * 0.05;
        const otRate = (baseSalary / 30 / 8) * 1.5;
        const floatNet = baseSalary + (otHours * otRate) - sso;

        const salarySatang = BigInt(Math.round(baseSalary * 100));
        const hoursHundredths = BigInt(Math.round(otHours * 100));
        const ssoSatang = divideAndRound(salarySatang * 5n, 100n);
        const otSatang = divideAndRound(
            salarySatang * hoursHundredths * 3n,
            30n * 8n * 2n * 100n
        );
        const netSatang = salarySatang + otSatang - ssoSatang;

        document.getElementById('payroll-output').innerHTML = `
            <div><span class="bad">ก่อนแก้ — Float ดิบ:</span> <code>${floatNet.toPrecision(17)} บาท</code></div>
            <div><span class="good">หลังแก้ — Integer:</span> <code>${netSatang.toLocaleString()} สตางค์ = ${(Number(netSatang) / 100).toFixed(2)} บาท</code></div>
            <div>ค่าที่บันทึกลงบัญชีถูกกำหนดให้จบที่ระดับสตางค์อย่างชัดเจน</div>`;
    });

    document.getElementById('run-sql').addEventListener('click', () => {
        const payload = '1 OR 1=1';
        const employees = [
            { id: 1, name: 'สมชาย', balance: 30000 },
            { id: 2, name: 'สุดา', balance: 25000 },
            { id: 3, name: 'อนันต์', balance: 40000 }
        ];
        const rows = (mode) => employees.map(employee => {
            const after = mode === 'buggy' ? employee.balance + 1000 : employee.balance;
            const changed = after !== employee.balance;
            return `<tr>
                <td>${employee.id}</td><td>${employee.name}</td>
                <td>${employee.balance.toLocaleString()}</td>
                <td class="${changed ? 'bad' : 'good'}">${after.toLocaleString()}</td>
                <td>${changed ? '+1,000 ❌' : 'ไม่เปลี่ยน ✅'}</td>
            </tr>`;
        }).join('');

        document.getElementById('sql-output').innerHTML = `
            <h3 class="bad">❌ ก่อนแก้ — ถูกบวกครบทั้ง 3 คน</h3>
            <code>UPDATE salaries SET balance = balance + 1000 WHERE emp_id = ${payload};</code>
            <div class="table-wrap"><table class="result-table"><thead><tr><th>ID</th><th>พนักงาน</th><th>ก่อนยิง (บาท)</th><th>หลังยิง (บาท)</th><th>ผลต่าง</th></tr></thead><tbody>${rows('buggy')}</tbody></table></div>
            <p>ยอดรวมก่อนยิง: <strong>95,000 บาท</strong> → หลังยิง: <strong class="bad">98,000 บาท</strong> (เพิ่มผิดทั้งหมด 3,000 บาท)</p>
            <hr>
            <h3 class="good">✅ หลังแก้ — ไม่มีพนักงาน ID "${payload}"</h3>
            <code>WHERE emp_id = $2 &nbsp; Params: [1000, "${payload}"]</code>
            <div class="table-wrap"><table class="result-table"><thead><tr><th>ID</th><th>พนักงาน</th><th>ก่อนยิง (บาท)</th><th>หลังยิง (บาท)</th><th>ผลต่าง</th></tr></thead><tbody>${rows('fixed')}</tbody></table></div>
            <p>ยอดรวมยังคงเป็น <strong class="good">95,000 บาท</strong> เพราะ payload ถูกมองเป็นข้อมูลธรรมดา</p>`;
    });

    function getRaceInputs() {
        const startBalance = Math.max(0, Number(document.getElementById('race-start-balance').value) || 0);
        const payment = Math.max(0, Number(document.getElementById('race-payment').value) || 0);
        const requestCount = Math.min(100, Math.max(1, Math.floor(Number(document.getElementById('race-request-count').value) || 1)));
        return { startBalance, payment, requestCount };
    }

    function money(value) {
        return value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    document.getElementById('run-race-buggy').addEventListener('click', () => {
        const { startBalance, payment, requestCount } = getRaceInputs();
        const finalBalance = startBalance + (payment * requestCount);
        const overpaid = payment * (requestCount - 1);
        document.getElementById('race-output').innerHTML = `
            <h3 class="bad">❌ ก่อนแก้ — สำเร็จ ${requestCount} คำขอ</h3>
            <div class="balance-flow">
                <div><small>Balance ก่อนยิง</small><strong>฿${money(startBalance)}</strong></div>
                <span>＋ ฿${money(payment)} × ${requestCount} คำขอ →</span>
                <div><small>Balance หลังยิง</small><strong class="bad">฿${money(finalBalance)}</strong></div>
            </div>
            <p>ควรจ่ายเพียง ฿${money(payment)} แต่จ่ายเกิน <strong class="bad">฿${money(overpaid)}</strong></p>`;
    });

    document.getElementById('run-race-fixed').addEventListener('click', () => {
        const { startBalance, payment, requestCount } = getRaceInputs();
        const finalBalance = startBalance + payment;
        const rejected = requestCount - 1;
        document.getElementById('race-output').innerHTML = `
            <h3 class="good">✅ หลังแก้ — สำเร็จ 1 คำขอ · ปฏิเสธรายการซ้ำ ${rejected} คำขอ</h3>
            <div class="balance-flow">
                <div><small>Balance ก่อนยิง</small><strong>฿${money(startBalance)}</strong></div>
                <span>＋ ฿${money(payment)} × 1 คำขอ →</span>
                <div><small>Balance หลังยิง</small><strong class="good">฿${money(finalBalance)}</strong></div>
            </div>
            <p>ทุกคำขอใช้ Idempotency Key เดิม ระบบจึงเพิ่ม Balance เพียงครั้งเดียว และจ่ายเกิน <strong class="good">฿0.00</strong></p>`;
    });

    // ========================= ข้อ 2: Night Shift SQL =========================
    const nightAttendance = [
        { empId: 201, name: 'สมชาย',  clockIn: '2026-03-18 23:55', note: 'สแกนก่อนเที่ยงคืน (เข้ากะวันที่ 19)' },
        { empId: 201, name: 'สมชาย',  clockIn: '2026-03-19 04:00', note: 'สแกนซ้ำระหว่างกะ' },
        { empId: 202, name: 'สมหญิง', clockIn: '2026-03-19 00:20', note: 'สแกนหลัง 00:05 → สายจริง' },
        { empId: 203, name: 'วิชัย',   clockIn: '2026-03-19 00:02', note: 'สแกนก่อน 00:05 → ตรงเวลา' },
    ];
    const tsNight = (s) => new Date(s.replace(' ', 'T')).getTime();
    const LATE_CUTOFF = tsNight('2026-03-19 00:05');
    const nameOfNight = (id) => nightAttendance.find(r => r.empId === id).name;
    const fmtNight = (ids) => ids.length ? ids.map(id => `${id} ${nameOfNight(id)}`).join(', ') : '(ไม่มี)';

    const nightDataBody = document.getElementById('nightshift-data');
    if (nightDataBody) {
        nightDataBody.innerHTML = nightAttendance.map(r =>
            `<tr><td>${r.empId}</td><td>${r.name}</td><td>${r.clockIn}</td><td>${r.note}</td></tr>`
        ).join('');
    }

    // ❌ ก่อนแก้: กรอง DATE=2026-03-19 และ TIME>00:05 (ไม่ดูสแกนครั้งแรก, ตัดสแกนก่อนเที่ยงคืนทิ้ง)
    function findLateBuggy(rows) {
        const lateIds = new Set();
        for (const r of rows) {
            const [datePart, timePart] = r.clockIn.split(' ');
            if (datePart === '2026-03-19' && timePart > '00:05') lateIds.add(r.empId);
        }
        return [...lateIds];
    }

    // ✅ หลังแก้: ใช้ช่วงเวลาวันทำงาน (23:00 วันก่อน → 08:00) + MIN(clock_in) > 00:05
    function findLateFixed(rows) {
        const WINDOW_START = tsNight('2026-03-18 23:00');
        const WINDOW_END = tsNight('2026-03-19 08:00');
        const firstScan = new Map();
        for (const r of rows) {
            const t = tsNight(r.clockIn);
            if (t >= WINDOW_START && t < WINDOW_END) {
                if (!firstScan.has(r.empId) || t < firstScan.get(r.empId)) firstScan.set(r.empId, t);
            }
        }
        const lateIds = [];
        for (const [empId, t] of firstScan) if (t > LATE_CUTOFF) lateIds.push(empId);
        return lateIds;
    }

    const btnNightBuggy = document.getElementById('run-nightshift-buggy');
    if (btnNightBuggy) btnNightBuggy.addEventListener('click', () => {
        document.getElementById('nightshift-output').innerHTML = `
            <h3 class="bad">❌ ก่อนแก้ — ระบุว่ามาสาย: ${fmtNight(findLateBuggy(nightAttendance))}</h3>
            <p>เกิด <strong class="bad">False Positive</strong>: ไป flag "201 สมชาย" เป็นมาสาย เพราะเห็นแถวสแกน 04:00 (เกิน 00:05) ทั้งที่จริงเขาสแกนเข้าตั้งแต่ 23:55 (มาก่อนเวลา) — ทั้งยังตัดแถวก่อนเที่ยงคืนทิ้งไปด้วย</p>`;
    });

    const btnNightFixed = document.getElementById('run-nightshift-fixed');
    if (btnNightFixed) btnNightFixed.addEventListener('click', () => {
        document.getElementById('nightshift-output').innerHTML = `
            <h3 class="good">✅ หลังแก้ — ระบุว่ามาสาย: ${fmtNight(findLateFixed(nightAttendance))}</h3>
            <p>ถูกต้อง! flag เฉพาะ "202 สมหญิง" คนเดียว เพราะดูจากการสแกน<strong>ครั้งแรก (MIN)</strong> ภายในช่วงวันทำงาน — สมชายสแกนครั้งแรก 23:55 จึงไม่สาย</p>`;
    });
});
