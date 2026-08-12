/*═══════════════════════════════════════════════════════════════
  leave.js — Frontend ระบบลางาน (เฟส 1)
  แยกจาก index.html เพื่อไม่กระทบระบบบันทึกเวลาเดิม
  ใช้ฟังก์ชันกลางจาก index.html: gasRun, go, showToast, S (state)

  โหลดหลัง index.html <script> หลัก (ต้องมี gasRun/S/go พร้อมก่อน)
  ผูก event ใน initLeaveBindings() เรียกตอนท้าย
═══════════════════════════════════════════════════════════════*/

// state ของระบบลา (แยก namespace กันชนกับของเดิม)
const LV = {
  types: [],            // ประเภทการลา (cache จาก server)
  myRequests: [],       // ประวัติของฉัน
  pending: [],          // รายการรออนุมัติ
  currentReject: null,  // requestId ที่กำลังจะปฏิเสธ
};

// ป้ายชื่อสถานะ (ไทย) + สี
const LV_STATUS = {
  PENDING_L1: { text: 'รออนุมัติ (หัวหน้าแผนก)', cls: 'lv-wait' },
  PENDING_L2: { text: 'รออนุมัติ (ผู้จัดการ)',   cls: 'lv-wait' },
  PENDING_HR: { text: 'รออนุมัติ (ฝ่ายบุคคล)',   cls: 'lv-wait' },
  APPROVED:   { text: 'อนุมัติแล้ว',             cls: 'lv-ok' },
  REJECTED:   { text: 'ไม่อนุมัติ',              cls: 'lv-no' },
};

// ป้ายชื่อโหมดการลา
const LV_MODE = {
  FULL:    'เต็มวัน',
  HALF_AM: 'ครึ่งเช้า',
  HALF_PM: 'ครึ่งบ่าย',
  HOURLY:  'รายชั่วโมง',
};

function lvEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// map TypeID → ชื่อไทย (จาก LV.types)
function lvTypeName(id) {
  const t = LV.types.find(x => x.id === id);
  return t ? t.name : id;
}

// ═══════════════ หน้า "ขอลา" ═══════════════

// โหลดประเภทการลาลง dropdown (เรียกตอนเปิดหน้าขอลา)
function loadLeaveForm() {
  // reset ฟอร์ม (เคลียร์ทีละช่อง)
  ['lv-date-from','lv-date-to','lv-hourly','lv-reason','lv-file'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const modeEl = document.getElementById('lv-mode'); if (modeEl) modeEl.value = '';
  const fileInput = document.getElementById('lv-file-input'); if (fileInput) fileInput.value = '';
  const fileStatus = document.getElementById('lv-file-status'); if (fileStatus) fileStatus.textContent = '';
  const prev = document.getElementById('lv-preview'); if (prev) prev.style.display = 'none';
  document.getElementById('lv-hourly-wrap').style.display = 'none';

  // โหลดประเภท (ถ้ายังไม่มี cache)
  if (LV.types.length > 0) { lvFillTypes(); return; }
  const sel = document.getElementById('lv-type');
  sel.innerHTML = '<option>กำลังโหลด...</option>';
  gasRun('leaveGetTypes', { hrToken: S.hrToken })
    .withSuccessHandler(r => {
      if (!r || !r.success) { showToast((r && r.message) || 'โหลดประเภทการลาไม่สำเร็จ'); return; }
      LV.types = r.types || [];
      lvFillTypes();
    })
    .withFailureHandler(e => showToast('เกิดข้อผิดพลาด: ' + (e && e.message ? e.message : e)));
}

function lvFillTypes() {
  const sel = document.getElementById('lv-type');
  if (!LV.types.length) { sel.innerHTML = '<option value="">— ไม่มีประเภทการลา —</option>'; return; }
  sel.innerHTML = '<option value="">— เลือกประเภท —</option>' +
    LV.types.map(t => `<option value="${lvEsc(t.id)}">${lvEsc(t.name)}${t.maxDays ? ` (สิทธิ์ ${t.maxDays} วัน)` : ''}</option>`).join('');
}

// ── อัปโหลดไฟล์แนบ (รูป/PDF) ──
function lvOnFilePick() {
  const input = document.getElementById('lv-file-input');
  const status = document.getElementById('lv-file-status');
  const hidden = document.getElementById('lv-file');
  hidden.value = '';
  if (!input.files || !input.files[0]) { status.textContent = ''; return; }

  const file = input.files[0];
  // จำกัดชนิด
  const okType = /^image\//.test(file.type) || file.type === 'application/pdf';
  if (!okType) { status.textContent = 'รองรับเฉพาะรูปภาพหรือ PDF'; status.style.color = 'var(--er)'; input.value = ''; return; }
  // จำกัดขนาด 10MB
  if (file.size > 10 * 1024 * 1024) { status.textContent = 'ไฟล์ใหญ่เกิน 10MB'; status.style.color = 'var(--er)'; input.value = ''; return; }

  status.textContent = 'กำลังอัปโหลด...'; status.style.color = 'var(--tx3)';
  const reader = new FileReader();
  reader.onload = () => {
    gasRun('leaveUploadFile', {
      hrToken: S.hrToken,
      fileData: reader.result,   // data URL base64
      fileName: file.name,
      mimeType: file.type,
    })
      .withSuccessHandler(r => {
        if (!r || !r.success) { status.textContent = (r && r.message) || 'อัปโหลดไม่สำเร็จ'; status.style.color = 'var(--er)'; return; }
        hidden.value = r.fileUrl;
        status.textContent = '✓ แนบไฟล์แล้ว'; status.style.color = 'var(--ok)';
      })
      .withFailureHandler(e => { status.textContent = 'อัปโหลดไม่สำเร็จ'; status.style.color = 'var(--er)'; });
  };
  reader.onerror = () => { status.textContent = 'อ่านไฟล์ไม่สำเร็จ'; status.style.color = 'var(--er)'; };
  reader.readAsDataURL(file);
}

// เปลี่ยนโหมดการลา → แสดง/ซ่อนช่อง + อัปเดตสรุปเวลา
function lvOnModeChange() {
  const mode = document.getElementById('lv-mode').value;
  const hourlyWrap = document.getElementById('lv-hourly-wrap');
  const datetoWrap = document.getElementById('lv-dateto-wrap');

  // HOURLY = แสดงช่องเวลา + ซ่อนช่อง "ถึงวันที่" (ลาชั่วโมง = วันเดียว)
  hourlyWrap.style.display = (mode === 'HOURLY') ? 'block' : 'none';
  // ครึ่งวัน/ชั่วโมง = วันเดียว ซ่อน "ถึงวันที่"
  const singleDay = (mode === 'HALF_AM' || mode === 'HALF_PM' || mode === 'HOURLY');
  datetoWrap.style.visibility = singleDay ? 'hidden' : 'visible';

  lvUpdatePreview();
}

// อัปเดตข้อความสรุปช่วงเวลาที่จะลา (ตามโหมด)
function lvUpdatePreview() {
  const mode = document.getElementById('lv-mode').value;
  const prev = document.getElementById('lv-preview');
  const df = document.getElementById('lv-date-from').value;
  if (!mode || !df) { prev.style.display = 'none'; return; }

  const fmt = (d) => {
    const [y,m,dd] = d.split('-');
    return `${dd}/${m}/${y}`;
  };
  const dt = document.getElementById('lv-date-to').value || df;
  let text = '';

  if (mode === 'FULL') {
    text = `${fmt(df)} (08:30) – ${fmt(dt)} (18:00) · เต็มวัน`;
  } else if (mode === 'HALF_AM') {
    text = `${fmt(df)} (08:30) – ${fmt(df)} (12:00) · ครึ่งวันเช้า 3.5 ชม.`;
  } else if (mode === 'HALF_PM') {
    text = `${fmt(df)} (13:00) – ${fmt(df)} (18:00) · ครึ่งวันบ่าย 5 ชม.`;
  } else if (mode === 'HOURLY') {
    const tf = document.getElementById('lv-time-from').value;
    const tt = document.getElementById('lv-time-to').value;
    if (tf && tt) {
      const hrs = lvCalcHourlyClient(tf, tt);
      text = `${fmt(df)} (${tf}) – ${fmt(df)} (${tt}) · ${hrs > 0 ? hrs + ' ชม.' : 'เวลาไม่ถูกต้อง'}`;
    } else {
      text = 'กรุณาเลือกเวลาเริ่ม-สิ้นสุด';
    }
  }
  prev.textContent = text;
  prev.style.display = 'block';
}

// คำนวณชั่วโมงฝั่ง client (หักพักเที่ยง 12:00-13:00) — โชว์ preview เท่านั้น server คำนวณจริง
function lvCalcHourlyClient(tf, tt) {
  const [h1,m1] = tf.split(':').map(Number);
  const [h2,m2] = tt.split(':').map(Number);
  let s = h1*60+m1, e = h2*60+m2;
  if (e <= s) return 0;
  const overlap = Math.max(0, Math.min(e,780) - Math.max(s,720));
  return +((e - s - overlap)/60).toFixed(2);
}

// ส่งคำขอลา
function submitLeave() {
  const btn = document.getElementById('lv-submit');
  const leaveType = document.getElementById('lv-type').value;
  const dateFrom  = document.getElementById('lv-date-from').value;
  const dateTo    = document.getElementById('lv-date-to').value || dateFrom;
  const mode      = document.getElementById('lv-mode').value;
  const timeFrom  = document.getElementById('lv-time-from') ? document.getElementById('lv-time-from').value : '';
  const timeTo    = document.getElementById('lv-time-to') ? document.getElementById('lv-time-to').value : '';
  const reason    = document.getElementById('lv-reason').value.trim();
  const fileUrl   = document.getElementById('lv-file').value.trim();

  // ตรวจเบื้องต้นฝั่ง client (server ตรวจซ้ำ)
  if (!leaveType) { showToast('กรุณาเลือกประเภทการลา'); return; }
  if (!dateFrom)  { showToast('กรุณาเลือกวันที่ลา'); return; }
  if (!mode)      { showToast('กรุณาเลือกรูปแบบการลา'); return; }
  if (!reason)    { showToast('กรุณากรอกเหตุผลการลา'); return; }
  if (mode === 'HOURLY' && (!timeFrom || !timeTo)) {
    showToast('กรุณาเลือกเวลาเริ่มและสิ้นสุด'); return;
  }
  // ครึ่งวัน/รายชั่วโมง = วันเดียว (บังคับ dateTo = dateFrom)
  const singleDay = (mode === 'HALF_AM' || mode === 'HALF_PM' || mode === 'HOURLY');
  const finalDateTo = singleDay ? dateFrom : dateTo;

  btn.disabled = true; btn.textContent = 'กำลังส่ง...';
  gasRun('leaveSubmit', {
    hrToken: S.hrToken,
    leaveType, dateFrom, dateTo: finalDateTo, mode,
    timeFrom: mode === 'HOURLY' ? timeFrom : '',
    timeTo:   mode === 'HOURLY' ? timeTo : '',
    reason, fileUrl,
  })
    .withSuccessHandler(r => {
      btn.disabled = false; btn.textContent = 'ส่งคำขอลา';
      if (!r || !r.success) { showToast((r && r.message) || 'ส่งคำขอไม่สำเร็จ'); return; }
      showToast('ส่งคำขอลาเรียบร้อย (' + r.hoursText + ')', true);
      go('leave-history');   // ไปหน้าประวัติ
    })
    .withFailureHandler(e => {
      btn.disabled = false; btn.textContent = 'ส่งคำขอลา';
      showToast('เกิดข้อผิดพลาด: ' + (e && e.message ? e.message : e));
    });
}

// ═══════════════ หน้า "ประวัติการลา" ═══════════════

function loadLeaveHistory() {
  const box = document.getElementById('lv-history-list');
  const sum = document.getElementById('lv-history-summary');
  box.innerHTML = '<div style="text-align:center;padding:20px;color:var(--tx3)">กำลังโหลด...</div>';
  sum.innerHTML = '';

  gasRun('leaveGetMyRequests', { hrToken: S.hrToken })
    .withSuccessHandler(r => {
      if (!r || !r.success) { box.innerHTML = '<div style="padding:20px;color:var(--er)">' + lvEsc((r && r.message) || 'โหลดไม่สำเร็จ') + '</div>'; return; }
      LV.myRequests = r.requests || [];
      lvRenderSummary(r.summary || {});
      lvRenderHistory(LV.myRequests);
    })
    .withFailureHandler(e => { box.innerHTML = '<div style="padding:20px;color:var(--er)">เกิดข้อผิดพลาด</div>'; });
}

function lvRenderSummary(summary) {
  const sum = document.getElementById('lv-history-summary');
  const keys = Object.keys(summary);
  if (!keys.length) { sum.innerHTML = ''; return; }
  sum.innerHTML = '<div style="font-size:13px;font-weight:600;margin-bottom:8px">สรุปการลาที่อนุมัติแล้ว (ปีนี้)</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
    keys.map(t => `<div style="background:var(--sf2);border:1px solid var(--bd);border-radius:8px;padding:8px 12px;font-size:13px">
      <span style="color:var(--tx2)">${lvEsc(lvTypeName(t))}:</span> <b>${lvEsc(summary[t].text)}</b></div>`).join('') +
    '</div>';
}

function lvRenderHistory(list) {
  const box = document.getElementById('lv-history-list');
  if (!list.length) {
    box.innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">ยังไม่มีประวัติการลา</div>';
    return;
  }

  // แยก 3 กลุ่ม: รออนุมัติ (แยกการ์ด), อนุมัติแล้ว (รวมตามประเภท), ปฏิเสธ (ไม่แสดง)
  const pending = list.filter(r => r.status.indexOf('PENDING') === 0);
  const approved = list.filter(r => r.status === 'APPROVED');

  let html = '';

  // ── รออนุมัติ: แยกการ์ดแต่ละรายการ ──
  if (pending.length) {
    html += '<div style="font-size:13px;font-weight:600;margin-bottom:8px;color:#c47d0a">รออนุมัติ</div>';
    html += pending.map(r => lvHistoryCard(r)).join('');
  }

  // ── อนุมัติแล้ว: รวมการ์ดตามประเภท ──
  if (approved.length) {
    // จัดกลุ่มตาม leaveType
    const byType = {};
    approved.forEach(r => { (byType[r.leaveType] = byType[r.leaveType] || []).push(r); });

    html += '<div style="font-size:13px;font-weight:600;margin:16px 0 8px">อนุมัติแล้ว</div>';
    Object.keys(byType).forEach(type => {
      const items = byType[type];
      const totalHours = items.reduce((s, r) => s + (r.hours || 0), 0);
      html += `<div class="lv-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
          <div style="font-weight:600">${lvEsc(lvTypeName(type))}: ${lvEsc(hoursToDayTextClient(totalHours))}</div>
          <span class="lv-badge lv-ok">อนุมัติแล้ว</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${items.map(r => `<div style="font-size:13px;color:var(--tx2);padding-left:8px;border-left:2px solid var(--bd)">
            ${lvEsc(lvFormatRange(r))} · ${lvEsc(LV_MODE[r.mode] || r.mode)} · ${lvEsc(r.hoursText)}
          </div>`).join('')}
        </div>
      </div>`;
    });
  }

  if (!html) html = '<div style="text-align:center;padding:30px;color:var(--tx3)">ยังไม่มีรายการ</div>';
  box.innerHTML = html;
}

// การ์ดรายการเดี่ยว (สำหรับรออนุมัติ)
function lvHistoryCard(r) {
  const st = LV_STATUS[r.status] || { text: r.status, cls: '' };
  return `<div class="lv-card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div style="font-weight:600">${lvEsc(lvTypeName(r.leaveType))}</div>
      <span class="lv-badge ${st.cls}">${lvEsc(st.text)}</span>
    </div>
    <div style="font-size:13px;color:var(--tx2);margin-top:4px">
      ${lvEsc(lvFormatRange(r))} · ${lvEsc(LV_MODE[r.mode] || r.mode)} · ${lvEsc(r.hoursText)}
    </div>
    <div style="font-size:13px;margin-top:6px">${lvEsc(r.reason)}</div>
    ${r.fileUrl ? `<a href="${lvEsc(r.fileUrl)}" target="_blank" style="font-size:12px;color:var(--ac)">📎 ไฟล์แนบ</a>` : ''}
  </div>`;
}

// format ช่วงวันเวลาแบบ dd/mm/yyyy (HH:mm) ตามโหมด
function lvFormatRange(r) {
  const fmt = (d) => { if (!d) return ''; const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };
  const df = fmt(r.dateFrom), dt = fmt(r.dateTo);
  if (r.mode === 'FULL')    return `${df} (08:30) – ${dt} (18:00)`;
  if (r.mode === 'HALF_AM') return `${df} (08:30) – ${df} (12:00)`;
  if (r.mode === 'HALF_PM') return `${df} (13:00) – ${df} (18:00)`;
  if (r.mode === 'HOURLY')  return `${df} (${r.timeFrom || '?'}) – ${df} (${r.timeTo || '?'})`;
  return `${df} – ${dt}`;
}

// แปลงชั่วโมง → "X วัน Y ชม." ฝั่ง client (ตรงกับ server, WORK_HOURS_PER_DAY=8.5)
function hoursToDayTextClient(hours) {
  const perDay = 8.5;
  const h = Number(hours) || 0;
  const days = Math.floor(h / perDay);
  const rem = +(h - days * perDay).toFixed(2);
  if (days > 0 && rem > 0) return `${days} วัน ${rem} ชม.`;
  if (days > 0) return `${days} วัน`;
  return `${rem} ชม.`;
}

// ═══════════════ หน้า "รออนุมัติ" (ผู้อนุมัติ) ═══════════════

function loadLeaveApprovals() {
  const box = document.getElementById('lv-approval-list');
  box.innerHTML = '<div style="text-align:center;padding:20px;color:var(--tx3)">กำลังโหลด...</div>';

  gasRun('leaveGetPendingApprovals', { hrToken: S.hrToken })
    .withSuccessHandler(r => {
      if (!r || !r.success) { box.innerHTML = '<div style="padding:20px;color:var(--er)">' + lvEsc((r && r.message) || 'โหลดไม่สำเร็จ') + '</div>'; return; }
      LV.pending = r.requests || [];
      lvRenderApprovals(LV.pending);
    })
    .withFailureHandler(e => { box.innerHTML = '<div style="padding:20px;color:var(--er)">เกิดข้อผิดพลาด</div>'; });
}

function lvRenderApprovals(list) {
  const box = document.getElementById('lv-approval-list');
  if (!list.length) {
    box.innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">ไม่มีคำขอรออนุมัติ</div>';
    return;
  }
  box.innerHTML = list.map(r => {
    const st = LV_STATUS[r.status] || { text: r.status, cls: '' };
    return `<div class="lv-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div>
          <div style="font-weight:600">${lvEsc(r.empName)} <span style="color:var(--tx3);font-weight:400;font-size:12px">(${lvEsc(r.empId)})</span></div>
          <div style="font-size:13px;color:var(--ac);margin-top:2px">${lvEsc(lvTypeName(r.leaveType))}</div>
        </div>
        <span class="lv-badge lv-wait">${lvEsc(st.text)}</span>
      </div>
      <div style="font-size:13px;color:var(--tx2);margin-top:6px">
        ${lvEsc(lvFormatRange(r))} · ${lvEsc(LV_MODE[r.mode] || r.mode)} · ${lvEsc(r.hoursText)}
      </div>
      <div style="font-size:13px;margin-top:6px;padding:8px;background:var(--sf2);border-radius:6px">${lvEsc(r.reason)}</div>
      ${r.fileUrl ? `<a href="${lvEsc(r.fileUrl)}" target="_blank" style="font-size:12px;color:var(--ac)">📎 ไฟล์แนบ</a>` : ''}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn lv-approve-btn" data-id="${lvEsc(r.requestId)}" style="flex:1;background:var(--ok)">อนุมัติ</button>
        <button class="btn lv-reject-btn" data-id="${lvEsc(r.requestId)}" style="flex:1;background:var(--er)">ไม่อนุมัติ</button>
      </div>
    </div>`;
  }).join('');

  // ผูก event ปุ่มอนุมัติ/ปฏิเสธ (สร้างใหม่ทุกครั้งที่ render)
  box.querySelectorAll('.lv-approve-btn').forEach(b => {
    b.addEventListener('click', () => approveLeave(b.getAttribute('data-id')));
  });
  box.querySelectorAll('.lv-reject-btn').forEach(b => {
    b.addEventListener('click', () => openRejectDialog(b.getAttribute('data-id')));
  });
}

function approveLeave(reqId) {
  if (!reqId) return;
  gasRun('leaveApprove', { hrToken: S.hrToken, requestId: reqId })
    .withSuccessHandler(r => {
      if (!r || !r.success) { showToast((r && r.message) || 'อนุมัติไม่สำเร็จ'); return; }
      showToast(r.message || 'อนุมัติเรียบร้อย', true);
      loadLeaveApprovals();   // refresh
    })
    .withFailureHandler(e => showToast('เกิดข้อผิดพลาด'));
}

// ── ปฏิเสธ: เปิด dialog กรอกเหตุผล ──
function openRejectDialog(reqId) {
  LV.currentReject = reqId;
  document.getElementById('lv-reject-reason').value = '';
  document.getElementById('lv-reject-overlay').style.display = 'flex';
}

function closeRejectDialog() {
  LV.currentReject = null;
  document.getElementById('lv-reject-overlay').style.display = 'none';
}

function confirmReject() {
  const reason = document.getElementById('lv-reject-reason').value.trim();
  if (!reason) { showToast('กรุณาระบุเหตุผลที่ไม่อนุมัติ'); return; }
  if (!LV.currentReject) return;

  gasRun('leaveReject', { hrToken: S.hrToken, requestId: LV.currentReject, rejectReason: reason })
    .withSuccessHandler(r => {
      closeRejectDialog();
      if (!r || !r.success) { showToast((r && r.message) || 'ปฏิเสธไม่สำเร็จ'); return; }
      showToast('ปฏิเสธคำขอเรียบร้อย', true);
      loadLeaveApprovals();
    })
    .withFailureHandler(e => { closeRejectDialog(); showToast('เกิดข้อผิดพลาด'); });
}

// ═══════════════ ผูก event (เรียกตอนโหลดเสร็จ) ═══════════════
function initLeaveBindings() {
  const on = (id, evt, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(evt, fn); };

  // เมนู
  on('tab-leave', 'click', () => go('leave-form'));
  on('hr-menu-leave-approve', 'click', () => go('leave-approve'));
  on('menu-leave-request', 'click', () => go('leave-form'));
  on('menu-leave-history', 'click', () => go('leave-history'));

  // หน้าขอลา
  on('lv-mode', 'change', lvOnModeChange);
  on('lv-date-from', 'change', lvUpdatePreview);
  on('lv-date-to', 'change', lvUpdatePreview);
  on('lv-time-from', 'change', lvUpdatePreview);
  on('lv-time-to', 'change', lvUpdatePreview);
  on('lv-file-input', 'change', lvOnFilePick);
  on('lv-submit', 'click', submitLeave);
  on('lv-to-history', 'click', () => go('leave-history'));

  // หน้าประวัติ
  on('lv-to-form', 'click', () => go('leave-form'));

  // dialog ปฏิเสธ
  on('lv-reject-cancel', 'click', closeRejectDialog);
  on('lv-reject-confirm', 'click', confirmReject);

  // back buttons
  on('lv-form-back', 'click', () => go(S.role === 'HR' ? 'hr-dash' : 'checkin'));
  on('lv-history-back', 'click', () => go(S.role === 'HR' ? 'hr-dash' : 'checkin'));
  on('lv-approve-back', 'click', () => go(S.role === 'HR' ? 'hr-dash' : 'checkin'));
}
