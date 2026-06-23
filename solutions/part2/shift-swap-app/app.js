document.addEventListener('DOMContentLoaded', () => {
    // ============================================================================
    // STATE (โหลดจาก backend จริง ผ่าน /api/state)
    // ============================================================================
    let employees = [];
    let shifts = [];
    let shiftAssignments = [];
    let shiftSwapRequests = [];

    async function api(path, method = 'GET', body) {
        const opt = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) opt.body = JSON.stringify(body);
        const res = await fetch(path, opt);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
    }

    async function loadState() {
        const s = await api('/api/state');
        employees = s.employees;
        shifts = s.shifts;
        shiftAssignments = s.assignments;
        shiftSwapRequests = s.requests;
        renderRoster();
        renderRequests();
        renderAllowanceReport();
        initFormElements();
    }

    // ============================================================================
    // NAVIGATION TABS
    // ============================================================================
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    // ============================================================================
    // HELPERS
    // ============================================================================
    function getEmployeeName(id) {
        const emp = employees.find(e => e.emp_id === id);
        return emp ? emp.full_name : 'Unknown';
    }
    function getShiftDetails(id) {
        return shifts.find(s => s.shift_id === id);
    }
    function shiftLabel(type) {
        return type === 'NIGHT' ? 'กะดึก' : type === 'MORNING' ? 'กะเช้า' : 'กะบ่าย';
    }
    function formatSatang(satang) {
        return '฿' + (Number(satang) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' บาท';
    }

    // ============================================================================
    // RENDERING
    // ============================================================================
    function renderRoster() {
        const tbody = document.getElementById('roster-tbody');
        tbody.innerHTML = '';
        shiftAssignments.forEach(sa => {
            const shift = getShiftDetails(sa.shift_id);
            const tr = document.createElement('tr');
            const isSwapped = sa.original_emp_id !== sa.effective_emp_id;
            const effectiveEmpDisplay = isSwapped
                ? `<span class="diff-highlight">${getEmployeeName(sa.effective_emp_id)}</span> <span class="swapped-pill">สลับกะแล้ว</span>`
                : getEmployeeName(sa.effective_emp_id);
            tr.innerHTML = `
                <td>${sa.work_date}</td>
                <td><strong>${shift.shift_type === 'NIGHT' ? 'กะดึก (NIGHT)' : shift.shift_type === 'MORNING' ? 'กะเช้า (MORNING)' : 'กะบ่าย (EVENING)'}</strong></td>
                <td>${shift.start_time} - ${shift.end_time} น.</td>
                <td>${getEmployeeName(sa.original_emp_id)}</td>
                <td>${effectiveEmpDisplay}</td>
                <td>${formatSatang(shift.night_allowance_satang)}</td>
                <td>${sa.swap_request_id ? `#REQ-${sa.swap_request_id}` : '-'}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    function renderRequests() {
        const tbody = document.getElementById('requests-tbody');
        tbody.innerHTML = '';
        const pendingRequests = shiftSwapRequests.filter(r => r.status === 'PENDING');
        document.getElementById('pending-count').textContent = pendingRequests.length;

        shiftSwapRequests.forEach(req => {
            const tr = document.createElement('tr');
            const reqAssign = shiftAssignments.find(a => a.assignment_id === req.requester_assignment_id);
            const reqShift = reqAssign ? getShiftDetails(reqAssign.shift_id) : null;
            const reqShiftText = reqAssign ? `${reqAssign.work_date} [${shiftLabel(reqShift.shift_type)}]` : '-';

            let targetShiftText = 'สลับข้างเดียว (ไม่มีแลกคืน)';
            if (req.target_assignment_id) {
                const targetAssign = shiftAssignments.find(a => a.assignment_id === req.target_assignment_id);
                if (targetAssign) {
                    const targetShift = getShiftDetails(targetAssign.shift_id);
                    targetShiftText = `${targetAssign.work_date} [${shiftLabel(targetShift.shift_type)}]`;
                }
            }

            const actionsHtml = req.status === 'PENDING'
                ? `<button class="btn btn-sm success-btn approve-btn" data-id="${req.swap_request_id}">อนุมัติ</button>
                   <button class="btn btn-sm danger-btn reject-btn" data-id="${req.swap_request_id}">ปฏิเสธ</button>`
                : `<span class="text-darker">-</span>`;

            const statusClass = req.status.toLowerCase();
            const statusTextTH = req.status === 'PENDING' ? 'รออนุมัติ' : req.status === 'APPROVED' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว';

            tr.innerHTML = `
                <td>#REQ-${req.swap_request_id}</td>
                <td><strong>${getEmployeeName(req.requester_emp_id)}</strong></td>
                <td>${reqShiftText}</td>
                <td><strong>${getEmployeeName(req.target_emp_id)}</strong></td>
                <td>${targetShiftText}</td>
                <td><em>"${req.reason}"</em></td>
                <td><span class="status-badge ${statusClass}">${statusTextTH}</span></td>
                <td><div style="display: flex; gap: 0.5rem;">${actionsHtml}</div></td>
            `;
            tbody.appendChild(tr);
        });

        document.querySelectorAll('.approve-btn').forEach(btn =>
            btn.addEventListener('click', () => handleApproval(parseInt(btn.dataset.id), 'APPROVED')));
        document.querySelectorAll('.reject-btn').forEach(btn =>
            btn.addEventListener('click', () => handleApproval(parseInt(btn.dataset.id), 'REJECTED')));
    }

    function renderAllowanceReport() {
        const tbody = document.getElementById('allowance-tbody');
        tbody.innerHTML = '';
        const allowanceMap = {};
        employees.forEach(emp => {
            allowanceMap[emp.emp_id] = { name: emp.full_name, shiftsCount: 0, allowanceSatang: 0 };
        });
        shiftAssignments.forEach(sa => {
            const shift = getShiftDetails(sa.shift_id);
            if (shift.shift_type === 'NIGHT') {
                const workerId = sa.effective_emp_id; // จ่ายให้ผู้ปฏิบัติงานจริง!
                if (allowanceMap[workerId]) {
                    allowanceMap[workerId].shiftsCount += 1;
                    allowanceMap[workerId].allowanceSatang += Number(shift.night_allowance_satang);
                }
            }
        });
        Object.keys(allowanceMap).forEach(empId => {
            const record = allowanceMap[empId];
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${empId}</td>
                <td><strong>${record.name}</strong></td>
                <td>${record.shiftsCount} กะ</td>
                <td class="diff-highlight">${formatSatang(record.allowanceSatang)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ============================================================================
    // FORMS & WORKFLOWS
    // ============================================================================
    const requesterSelect = document.getElementById('requesterSelect');
    const requesterAssignmentSelect = document.getElementById('requesterAssignmentSelect');
    const targetSelect = document.getElementById('targetSelect');
    const targetAssignmentSelect = document.getElementById('targetAssignmentSelect');
    const targetAssignmentGroup = document.getElementById('targetAssignmentGroup');
    const swapForm = document.getElementById('swap-form');

    function initFormElements() {
        requesterSelect.innerHTML = '<option value="">เลือกพนักงาน...</option>';
        targetSelect.innerHTML = '<option value="">เลือกพนักงาน...</option>';
        employees.forEach(emp => {
            if (emp.is_supervisor) return; // หัวหน้าไม่มีกะ แต่เป็นผู้อนุมัติ
            const opt1 = document.createElement('option');
            opt1.value = emp.emp_id; opt1.textContent = emp.full_name;
            requesterSelect.appendChild(opt1);
            const opt2 = document.createElement('option');
            opt2.value = emp.emp_id; opt2.textContent = emp.full_name;
            targetSelect.appendChild(opt2);
        });
    }

    requesterSelect.addEventListener('change', () => {
        const empId = parseInt(requesterSelect.value);
        requesterAssignmentSelect.innerHTML = '';
        if (isNaN(empId)) {
            requesterAssignmentSelect.disabled = true;
            requesterAssignmentSelect.innerHTML = '<option value="">กรุณาเลือกผู้ขอสลับก่อน...</option>';
            return;
        }
        const requesterAssignments = shiftAssignments.filter(a => a.effective_emp_id === empId);
        if (requesterAssignments.length === 0) {
            requesterAssignmentSelect.disabled = true;
            requesterAssignmentSelect.innerHTML = '<option value="">ไม่มีกะงานมอบหมายให้พนักงานคนนี้</option>';
            return;
        }
        requesterAssignmentSelect.disabled = false;
        requesterAssignments.forEach(a => {
            const shift = getShiftDetails(a.shift_id);
            const opt = document.createElement('option');
            opt.value = a.assignment_id;
            opt.textContent = `${a.work_date} - ${shiftLabel(shift.shift_type)} (${shift.start_time}-${shift.end_time} น.)`;
            requesterAssignmentSelect.appendChild(opt);
        });
    });

    targetSelect.addEventListener('change', () => {
        const empId = parseInt(targetSelect.value);
        targetAssignmentSelect.innerHTML = '<option value="">เลือกกะงานของพนักงานเป้าหมาย...</option>';
        if (isNaN(empId)) return;
        shiftAssignments.filter(a => a.effective_emp_id === empId).forEach(a => {
            const shift = getShiftDetails(a.shift_id);
            const opt = document.createElement('option');
            opt.value = a.assignment_id;
            opt.textContent = `${a.work_date} - ${shiftLabel(shift.shift_type)} (${shift.start_time}-${shift.end_time} น.)`;
            targetAssignmentSelect.appendChild(opt);
        });
    });

    document.querySelectorAll('input[name="swapType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'mutual') {
                targetAssignmentGroup.style.display = 'block';
                targetAssignmentSelect.setAttribute('required', 'required');
            } else {
                targetAssignmentGroup.style.display = 'none';
                targetAssignmentSelect.removeAttribute('required');
            }
        });
    });

    swapForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const requesterId = parseInt(requesterSelect.value);
        const reqAssignId = parseInt(requesterAssignmentSelect.value);
        const targetId = parseInt(targetSelect.value);
        const isMutual = document.querySelector('input[name="swapType"]:checked').value === 'mutual';
        const targetAssignId = isMutual ? parseInt(targetAssignmentSelect.value) : null;
        const reason = document.getElementById('swapReason').value;

        if (requesterId === targetId) { alert('ไม่สามารถสลับกะงานกับตัวเองได้!'); return; }

        try {
            await api('/api/swaps', 'POST', {
                requester_emp_id: requesterId,
                requester_assignment_id: reqAssignId,
                target_emp_id: targetId,
                target_assignment_id: targetAssignId,
                reason
            });
            swapForm.reset();
            targetAssignmentGroup.style.display = 'none';
            requesterAssignmentSelect.disabled = true;
            alert('ยื่นคำขอสลับกะสำเร็จเรียบร้อยแล้ว!');
            await loadState();
        } catch (err) { alert('❌ ' + err.message); }
    });

    async function handleApproval(requestId, actionStatus) {
        try {
            if (actionStatus === 'APPROVED') {
                await api(`/api/swaps/${requestId}/approve`, 'POST', {});
                alert(`อนุมัติคำขอสลับกะ #REQ-${requestId} สำเร็จ ตารางเวรถูกอัปเดตแล้ว`);
            } else {
                await api(`/api/swaps/${requestId}/reject`, 'POST', {});
                alert(`ปฏิเสธคำขอสลับกะ #REQ-${requestId} เรียบร้อยแล้ว`);
            }
            await loadState();
        } catch (err) { alert('❌ ' + err.message); }
    }

    // ============================================================================
    // INIT
    // ============================================================================
    loadState().catch(err => alert('โหลดข้อมูลไม่สำเร็จ: ' + err.message));
});
