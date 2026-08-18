/* ═══════════════════════════════════════════════════════════════
 *  payroll.js — Frontend สลิปเงินเดือน (SOM HR System)
 *  ยึดโครงจาก ot.js — ใช้ gasRun, S, go, showToast จาก index.html
 * ═══════════════════════════════════════════════════════════════ */

const PAY = {
  periods: [],
  currentPeriod: null,   // งวดที่กำลังตรวจสอบ
  rows: [],
  editRowId: null,
  pdfToken: 0,           // token กัน batch PDF วนข้ามงวด/ซ้ำ
  pdfPeriodId: null,
};

function payEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
// จำนวนเงิน → คั่นหลักพัน
function payMoney(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
// yyyy-MM-dd → dd/MM/yyyy
function payFmtDate(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
function payTypeText(t) { return t === 'BONUS' ? 'โบนัส' : 'ปกติ'; }

// ════════ หน้าจัดการงวด ════════
function loadPayPeriods() {
  const box = document.getElementById('pay-periods-list');
  if (box) box.innerHTML = '<div style="text-align:center;padding:20px;color:var(--tx3)">กำลังโหลด...</div>';
  // ซ่อนฟอร์มสร้าง
  const cf = document.getElementById('pay-create-form'); if (cf) cf.style.display = 'none';

  gasRun('payGetPeriods', { hrToken: S.hrToken })
    .withSuccessHandler(r => {
      if (!r || !r.success) { if (box) box.innerHTML = '<div style="padding:20px;color:var(--er)">' + payEsc((r && r.message) || 'โหลดไม่สำเร็จ') + '</div>'; return; }
      PAY.periods = r.periods || [];
      renderPayPeriods();
    })
    .withFailureHandler(() => { if (box) box.innerHTML = '<div style="padding:20px;color:var(--er)">เกิดข้อผิดพลาด</div>'; });
}

function renderPayPeriods() {
  const box = document.getElementById('pay-periods-list');
  if (!box) return;
  if (!PAY.periods.length) {
    box.innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">ยังไม่มีงวด กด “สร้างงวดใหม่” เพื่อเริ่ม</div>';
    return;
  }

  box.innerHTML = PAY.periods.map(p => {
    const isOpen = p.status === 'OPEN';
    const dot = isOpen ? 'background:var(--ok)' : 'background:var(--tx3)';
    const badge = isOpen
      ? '<span class="lv-badge" style="background:rgba(5,150,105,.1);color:var(--ok)">🟢 เปิดอยู่</span>'
      : '<span class="lv-badge" style="background:rgba(148,163,184,.15);color:var(--tx2)">🔒 ปิดแล้ว</span>';
    const actions = isOpen
      ? `<button class="btn p sm pay-review-btn" data-id="${payEsc(p.periodId)}" style="width:auto;padding:6px 14px;font-size:13px">ตรวจสอบ/โหลด</button>
         <button class="btn o sm pay-lock2-btn" data-id="${payEsc(p.periodId)}" style="width:auto;padding:6px 14px;font-size:13px">🔒 ปิดงวด</button>`
      : `<button class="btn o sm pay-review-btn" data-id="${payEsc(p.periodId)}" style="width:auto;padding:6px 14px;font-size:13px">ดูข้อมูล</button>
         <button class="btn o sm pay-unlock-btn" data-id="${payEsc(p.periodId)}" style="width:auto;padding:6px 14px;font-size:13px">🔓 เปิดงวด</button>`;
    return `<div class="lv-card" style="display:flex;align-items:flex-start;gap:12px">
      <div style="width:12px;height:12px;border-radius:50%;flex-shrink:0;margin-top:5px;${dot}"></div>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="font-weight:600;font-size:16px">${payEsc(p.payRound)} · จ่าย ${payEsc(payFmtDate(p.payDate))}</div>
          ${badge}
        </div>
        <div style="font-size:13px;color:var(--tx3);margin-top:3px">รหัสงวด ${payEsc(p.periodId)} · ${payTypeText(p.payType)} · ${p.headcount} คน</div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">${actions}</div>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('.pay-review-btn').forEach(b => b.addEventListener('click', () => openPayReview(b.getAttribute('data-id'))));
  box.querySelectorAll('.pay-lock2-btn').forEach(b => b.addEventListener('click', () => paySetStatus(b.getAttribute('data-id'), 'LOCKED')));
  box.querySelectorAll('.pay-unlock-btn').forEach(b => b.addEventListener('click', () => paySetStatus(b.getAttribute('data-id'), 'OPEN')));
}

// สร้างงวด
function payCreatePeriod() {
  const round = document.getElementById('pay-f-round').value.trim();
  const date = document.getElementById('pay-f-date').value;
  const type = document.getElementById('pay-f-type').value;
  if (!round) { showToast('กรอกรอบการจ่าย'); return; }
  if (!date) { showToast('เลือกวันที่จ่าย'); return; }

  const btn = document.getElementById('pay-create-save');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังสร้าง...'; }
  gasRun('payCreatePeriod', { hrToken: S.hrToken, payRound: round, payDate: date, payType: type })
    .withSuccessHandler(r => {
      if (btn) { btn.disabled = false; btn.textContent = 'สร้างงวด'; }
      if (!r || !r.success) { showToast((r && r.message) || 'สร้างไม่สำเร็จ'); return; }
      showToast(r.message || 'สร้างงวดแล้ว', true);
      document.getElementById('pay-f-round').value = '';
      document.getElementById('pay-f-date').value = '';
      loadPayPeriods();
    })
    .withFailureHandler(() => { if (btn) { btn.disabled = false; btn.textContent = 'สร้างงวด'; } showToast('เกิดข้อผิดพลาด'); });
}

function paySetStatus(periodId, status) {
  const msg = status === 'LOCKED' ? 'ปิดงวดนี้? (จะแก้ไขไม่ได้จนกว่าจะเปิดใหม่)' : 'เปิดงวดนี้กลับมาแก้ไข?';
  if (!confirm(msg)) return;
  gasRun('paySetPeriodStatus', { hrToken: S.hrToken, periodId: periodId, status: status })
    .withSuccessHandler(r => {
      if (!r || !r.success) { showToast((r && r.message) || 'ไม่สำเร็จ'); return; }
      showToast(r.message || 'เรียบร้อย', true);
      loadPayPeriods();
    })
    .withFailureHandler(() => showToast('เกิดข้อผิดพลาด'));
}

function openPayReview(periodId) {
  PAY.currentPeriod = PAY.periods.find(p => p.periodId === periodId) || null;
  go('pay-review');
}

// ════════ หน้าตรวจสอบข้อมูล ════════
function loadPayReview() {
  const p = PAY.currentPeriod;
  const info = document.getElementById('pay-review-periodinfo');
  const title = document.getElementById('pay-review-title');
  const lockBtn = document.getElementById('pay-lock-btn');
  const uploadLabel = document.getElementById('pay-upload-file');

  if (!p) { if (info) info.textContent = 'ไม่พบงวด'; return; }
  if (title) title.textContent = 'ตรวจสอบ — ' + p.payRound;

  const isOpen = p.status === 'OPEN';
  if (info) {
    info.innerHTML = `<b>${payEsc(p.payRound)}</b> · รหัสงวด ${payEsc(p.periodId)} · จ่าย ${payEsc(payFmtDate(p.payDate))} · ${payTypeText(p.payType)}
      · <span style="color:${isOpen ? 'var(--ok)' : 'var(--tx3)'}">${isOpen ? '🟢 เปิดอยู่' : '🔒 ปิดแล้ว'}</span>`;
  }
  // งวดปิด → ปิดปุ่มโหลด + เปลี่ยนปุ่มเป็นเปิดงวด
  if (uploadLabel) uploadLabel.disabled = !isOpen;
  const upLabel = document.getElementById('pay-upload-label');
  if (upLabel) upLabel.parentElement.style.opacity = isOpen ? '1' : '.4';
  if (lockBtn) {
    lockBtn.textContent = isOpen ? '🔒 ปิดงวด' : '🔓 เปิดงวด';
    lockBtn.onclick = () => paySetStatusFromReview(p.periodId, isOpen ? 'LOCKED' : 'OPEN');
  }

  document.getElementById('pay-upload-status').textContent = '';
  document.getElementById('pay-load-result').innerHTML = '';
  // reset progress + ยกเลิก batch เก่า (กัน progress ค้างจากงวดก่อน)
  PAY.pdfToken = (PAY.pdfToken || 0) + 1;
  const prog = document.getElementById('pay-pdf-progress');
  if (prog) prog.style.display = 'none';
  loadPayTable();
}

function paySetStatusFromReview(periodId, status) {
  const msg = status === 'LOCKED' ? 'ปิดงวดนี้? (จะแก้ไขไม่ได้)' : 'เปิดงวดนี้กลับมาแก้ไข?';
  if (!confirm(msg)) return;
  gasRun('paySetPeriodStatus', { hrToken: S.hrToken, periodId: periodId, status: status })
    .withSuccessHandler(r => {
      if (!r || !r.success) { showToast((r && r.message) || 'ไม่สำเร็จ'); return; }
      showToast(r.message || 'เรียบร้อย', true);
      if (PAY.currentPeriod) PAY.currentPeriod.status = status;
      loadPayReview();
    })
    .withFailureHandler(() => showToast('เกิดข้อผิดพลาด'));
}

// โหลดไฟล์ Excel
function payHandleUpload(file) {
  if (!file) return;
  const p = PAY.currentPeriod;
  if (!p) return;
  const status = document.getElementById('pay-upload-status');
  if (status) { status.style.color = 'var(--tx3)'; status.textContent = 'กำลังอ่านไฟล์...'; }

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    if (status) status.textContent = 'กำลังนำเข้าข้อมูล... (อาจใช้เวลาสักครู่)';
    gasRun('payUploadExcel', { hrToken: S.hrToken, periodId: p.periodId, fileData: base64, fileName: file.name })
      .withSuccessHandler(r => {
        if (!r || !r.success) {
          if (status) { status.style.color = 'var(--er)'; status.textContent = '✗ ' + ((r && r.message) || 'นำเข้าไม่สำเร็จ'); }
          return;
        }
        if (status) { status.style.color = 'var(--ok)'; status.textContent = '✓ นำเข้าเรียบร้อย'; }
        renderLoadResult(r.result);
        loadPayTable();
      })
      .withFailureHandler(() => { if (status) { status.style.color = 'var(--er)'; status.textContent = '✗ เกิดข้อผิดพลาด'; } });
  };
  reader.readAsDataURL(file);
}

// สรุปผลโหลด
function renderLoadResult(res) {
  const box = document.getElementById('pay-load-result');
  if (!box || !res) return;
  let html = `<div class="card" style="margin-bottom:14px">
    <div style="font-weight:600;font-size:15px;margin-bottom:10px">ผลการนำเข้า</div>
    <div style="display:flex;flex-direction:column;gap:5px;font-size:14px">
      <div><b style="font-size:16px">${res.total}</b> นำเข้าทั้งหมด</div>
      <div><b style="font-size:16px;color:var(--ok)">${res.success}</b> ✓ สำเร็จ</div>
      <div><b style="font-size:16px;color:var(--er)">${res.failed}</b> ✗ ไม่สำเร็จ</div>`;
  if (res.failList && res.failList.length) {
    html += res.failList.map(f => `<div style="font-size:13px;color:var(--er);padding-left:20px">• ${payEsc(f)}</div>`).join('');
  }
  html += `<div><b style="font-size:16px;color:var(--wn)">${res.warned}</b> ⚠️ ยอดรวมไม่ตรง (ให้ตรวจสอบ)</div>`;
  if (res.warnList && res.warnList.length) {
    html += res.warnList.map(w => `<div style="font-size:13px;color:var(--wn);padding-left:20px">• ${payEsc(w)}</div>`).join('');
  }
  html += `</div></div>`;
  box.innerHTML = html;
}

// ตารางข้อมูล
function loadPayTable() {
  const box = document.getElementById('pay-review-table');
  if (!box) return;
  const p = PAY.currentPeriod;
  if (!p) return;
  box.innerHTML = '<div style="text-align:center;padding:20px;color:var(--tx3)">กำลังโหลดตาราง...</div>';

  gasRun('payGetPeriodData', { hrToken: S.hrToken, periodId: p.periodId })
    .withSuccessHandler(r => {
      if (!r || !r.success) { box.innerHTML = '<div style="padding:20px;color:var(--er)">โหลดไม่สำเร็จ</div>'; return; }
      PAY.rows = r.rows || [];
      renderPayTable();
    })
    .withFailureHandler(() => { box.innerHTML = '<div style="padding:20px;color:var(--er)">เกิดข้อผิดพลาด</div>'; });
}

function renderPayTable() {
  const box = document.getElementById('pay-review-table');
  if (!box) return;
  if (!PAY.rows.length) {
    box.innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">ยังไม่มีข้อมูลในงวดนี้ — โหลดไฟล์ Excel เพื่อเริ่ม</div>';
    return;
  }
  const isOpen = PAY.currentPeriod && PAY.currentPeriod.status === 'OPEN';

  const slipBadge = (st) => {
    if (st === 'ส่งแล้ว') return '<span class="lv-badge" style="background:rgba(5,150,105,.1);color:var(--ok)">ส่งแล้ว</span>';
    if (st === 'สร้างแล้ว') return '<span class="lv-badge" style="background:rgba(37,99,235,.1);color:var(--ac)">สร้างแล้ว</span>';
    return '<span class="lv-badge" style="background:rgba(148,163,184,.15);color:var(--tx2)">ยังไม่สร้าง</span>';
  };

  let html = `<div class="table-wrap" style="background:var(--sf);border:1px solid var(--bd);border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.04)">
    <div style="padding:14px 16px;border-bottom:1px solid var(--bd);font-weight:600">พนักงาน ${PAY.rows.length} คน</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr>
        <th style="text-align:center;padding:10px 8px;background:var(--sf2)"><input type="checkbox" id="pay-check-all" style="cursor:pointer"></th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;font-weight:600;color:var(--tx2);background:var(--sf2)">#</th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;font-weight:600;color:var(--tx2);background:var(--sf2)">รหัส</th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;font-weight:600;color:var(--tx2);background:var(--sf2)">ชื่อ</th>
        <th style="text-align:right;padding:10px 12px;font-size:12px;font-weight:600;color:var(--tx2);background:var(--sf2)">เงินได้</th>
        <th style="text-align:right;padding:10px 12px;font-size:12px;font-weight:600;color:var(--tx2);background:var(--sf2)">เงินหัก</th>
        <th style="text-align:right;padding:10px 12px;font-size:12px;font-weight:600;color:var(--tx2);background:var(--sf2)">สุทธิ</th>
        <th style="text-align:center;padding:10px 12px;font-size:12px;font-weight:600;color:var(--tx2);background:var(--sf2)">สลิป</th>
        <th style="text-align:center;padding:10px 12px;font-size:12px;font-weight:600;color:var(--tx2);background:var(--sf2)">ตรวจ</th>
        <th style="background:var(--sf2)"></th>
      </tr></thead><tbody>`;

  html += PAY.rows.map((row, i) => {
    const warn = row.checkFlag === '⚠️';
    const rowBg = warn ? 'background:rgba(217,119,6,.05)' : '';
    const pdfLink = row.urlPDF ? `<a href="${payEsc(row.urlPDF)}" target="_blank" style="color:var(--ok);font-size:13px;text-decoration:none">📄 เปิด</a>` : '';
    return `<tr style="${rowBg}">
      <td style="padding:11px 8px;border-top:1px solid var(--bd);text-align:center"><input type="checkbox" class="pay-row-check" data-id="${payEsc(row.rowId)}" style="cursor:pointer"></td>
      <td style="padding:11px 12px;border-top:1px solid var(--bd)">${i + 1}</td>
      <td style="padding:11px 12px;border-top:1px solid var(--bd)">${payEsc(row.empId)}</td>
      <td style="padding:11px 12px;border-top:1px solid var(--bd);white-space:nowrap">${payEsc(row.name)}</td>
      <td style="padding:11px 12px;border-top:1px solid var(--bd);text-align:right;font-variant-numeric:tabular-nums">${payMoney(row.income)}</td>
      <td style="padding:11px 12px;border-top:1px solid var(--bd);text-align:right;font-variant-numeric:tabular-nums">${payMoney(row.deduct)}</td>
      <td style="padding:11px 12px;border-top:1px solid var(--bd);text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${payMoney(row.net)}</td>
      <td style="padding:11px 12px;border-top:1px solid var(--bd);text-align:center">${slipBadge(row.statusSlip)} ${pdfLink}</td>
      <td style="padding:11px 12px;border-top:1px solid var(--bd);text-align:center;font-size:16px">${warn ? '⚠️' : '<span style="color:var(--ok)">✓</span>'}</td>
      <td style="padding:11px 12px;border-top:1px solid var(--bd);white-space:nowrap">
        ${isOpen ? `<span class="pay-edit-link" data-id="${payEsc(row.rowId)}" style="color:var(--ac);cursor:pointer;font-weight:600;font-size:13px">แก้ไข</span>` : ''}
      </td>
    </tr>`;
  }).join('');

  html += `</tbody></table></div>
    <div style="font-size:12px;color:var(--tx3);padding:12px 16px;border-top:1px solid var(--bd)">
      แถวสีส้ม = ยอดรวมไม่ตรง (⚠️) คลิก "แก้ไข" เพื่อตรวจสอบ · เลือกเช็คบ็อกซ์เพื่อสร้าง PDF เฉพาะคน ${isOpen ? '' : '· งวดนี้ปิดแล้ว แก้ไขไม่ได้'}
    </div></div>`;

  box.innerHTML = html;
  box.querySelectorAll('.pay-edit-link').forEach(el => el.addEventListener('click', () => openPayEdit(el.getAttribute('data-id'))));
  // เช็คบ็อกซ์
  const checkAll = document.getElementById('pay-check-all');
  if (checkAll) checkAll.addEventListener('change', () => {
    box.querySelectorAll('.pay-row-check').forEach(c => { c.checked = checkAll.checked; });
    payUpdateSelCount();
  });
  box.querySelectorAll('.pay-row-check').forEach(c => c.addEventListener('change', payUpdateSelCount));
  payUpdateSelCount();
}

// นับจำนวนที่เลือก + toggle ปุ่มสร้าง PDF ที่เลือก
function payUpdateSelCount() {
  const checks = document.querySelectorAll('.pay-row-check:checked');
  const count = checks.length;
  const el = document.getElementById('pay-sel-count');
  if (el) el.textContent = count;
  const selBtn = document.getElementById('pay-genpdf-sel-btn');
  if (selBtn) selBtn.style.display = count > 0 ? '' : 'none';
}

// ════════ ฟอร์มแก้ไขรายคน (accordion แบ่งกลุ่ม) ════════
// นิยามฟิลด์: [index ใน values(A-BG), label, hint?]
const PAY_GROUPS = [
  { title: 'ข้อมูลพนักงาน', fields: [
    [0, 'A รอบการจ่าย'], [1, 'B วันที่จ่าย'], [2, 'C เลขที่บัญชี'], [3, 'D ลำดับที่'],
    [4, 'E รหัสพนักงาน'], [5, 'F ชื่อ-นามสกุล'], [6, 'G ชื่อเล่น'], [7, 'H วันเริ่มงาน'],
    [8, 'I ตำแหน่ง'], [9, 'J หน่วยต้นทุน', 'DL=ค่าแรงทางตรง, OH=ค่าใช้จ่ายการผลิต, SA=ขาย&บริหาร'],
    [10, 'K ต้นทุนธุรกิจ', 'รหัสแผนก (Department ID)'], [11, 'L แผนก'],
    [12, 'M ฐานเงินเดือน'], [13, 'N วันทำงาน'], [14, 'O วันเข้ากะ'],
  ]},
  { title: 'เงินเดือน + OT', fields: [
    [15, 'P เงินเดือน'], [16, 'Q เงินเดือนอื่นๆ'], [17, 'R ขาดงาน(วัน)'], [18, 'S หักขาดงานวัน'],
    [19, 'T ขาดงาน(นาที)'], [20, 'U หักขาดงานนาที'], [21, 'V เงินเดือนรวم', 'auto: P+Q-S-U'],
    [22, 'W ชม.OT ปกติ1.5'], [23, 'X ชม.OT หยุด1.5'], [24, 'Y ชม.OT หยุด2'], [25, 'Z ชม.OT หยุด3'],
    [26, 'AA เงินOT ปกติ1.5'], [27, 'AB เงินOT หยุด1.5'], [28, 'AC เงินOT หยุด2'], [29, 'AD เงินOT หยุด3'],
    [30, 'AE เงินOT รวม', 'auto: AA+AB+AC+AD'],
  ]},
  { title: 'สวัสดิการ', fields: [
    [31, 'AF ค่าเดินทาง'], [32, 'AG ค่าอาหาร'], [33, 'AH ค่าครองชีพ'], [34, 'AI เงินเพิ่มพิเศษ'],
    [35, 'AJ ค่าตำแหน่ง'], [36, 'AK เบี้ยขยัน'], [37, 'AL ค่ากะ'], [38, 'AM สวัสดิการอื่นๆ'],
    [39, 'AN สวัสดิการรวม', 'auto: AF..AM'],
  ]},
  { title: 'เงินหัก', fields: [
    [40, 'AO เงินหักอื่น(ภาษี)'], [41, 'AP รวมเงินได้ภาษี', 'auto: V+OT+สวัสดิการ-AO'],
    [42, 'AQ ภาษีหัก ณ ที่จ่าย'], [43, 'AR อัตรา PVD'], [44, 'AS PVD'], [45, 'AT ประกันสังคม'],
    [46, 'AU EWF'], [47, 'AV หักฝึกงานJP'], [48, 'AW หักออมสิน'], [49, 'AX หักกยศ.'],
    [50, 'AY หักชุดพนักงาน'], [51, 'AZ เงินหักอื่นๆ'], [52, 'BA รวมเงินหัก', 'auto: AQ+AS..AZ'],
    [53, 'BB รายได้ไม่มีภาษี'], [54, 'BC เงินได้สุทธิ', 'auto: AP-BA+BB'], [55, 'BD หมายเหตุ'],
    [56, 'BE สมทบ PVD(นายจ้าง)'], [57, 'BF สมทบ SSO(นายจ้าง)'], [58, 'BG สมทบ EWF(นายจ้าง)'],
  ]},
];

function openPayEdit(rowId) {
  PAY.editRowId = rowId;
  const body = document.getElementById('pay-edit-body');
  const overlay = document.getElementById('pay-edit-overlay');
  body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--tx3)">กำลังโหลด...</div>';
  overlay.style.display = 'flex';

  gasRun('payGetRow', { hrToken: S.hrToken, rowId: rowId })
    .withSuccessHandler(r => {
      if (!r || !r.success) { body.innerHTML = '<div style="color:var(--er)">' + payEsc((r && r.message) || 'โหลดไม่สำเร็จ') + '</div>'; return; }
      renderPayEditForm(r.values || []);
    })
    .withFailureHandler(() => { body.innerHTML = '<div style="color:var(--er)">เกิดข้อผิดพลาด</div>'; });
}

function renderPayEditForm(values) {
  const body = document.getElementById('pay-edit-body');
  const title = document.getElementById('pay-edit-title');
  if (title) title.textContent = 'แก้ไข: ' + (values[5] || '') + ' (' + (values[4] || '') + ')';

  body.innerHTML = PAY_GROUPS.map((grp, gi) => {
    const fields = grp.fields.map(f => {
      const idx = f[0], label = f[1], hint = f[2] || '';
      const val = (values[idx] !== undefined && values[idx] !== null) ? values[idx] : '';
      const isAuto = hint.indexOf('auto:') === 0;
      return `<div class="field" style="margin-bottom:10px">
        <label style="font-size:12px">${payEsc(label)}${hint ? ` <span style="color:var(--tx3);font-weight:400">— ${payEsc(hint)}</span>` : ''}</label>
        <input class="inp pay-edit-inp" data-idx="${idx}" value="${payEsc(val)}"${isAuto ? ' style="background:var(--sf2);color:var(--tx3)"' : ''}>
      </div>`;
    }).join('');
    return `<details ${gi === 0 ? 'open' : ''} style="margin-bottom:10px;border:1px solid var(--bd);border-radius:10px;overflow:hidden">
      <summary style="padding:12px 14px;font-weight:600;cursor:pointer;background:var(--sf2);font-size:14px">${payEsc(grp.title)}</summary>
      <div style="padding:14px">${fields}</div>
    </details>`;
  }).join('');
  body.innerHTML += `<div style="font-size:12px;color:var(--tx3);margin-top:6px">ช่องพื้นเทา = ระบบคำนวณ (auto) แก้ได้ถ้าต้องการ · ยอดสะสม BH-BO ระบบคำนวณให้อัตโนมัติหลังบันทึก</div>`;

  // งวดปิด → ซ่อนปุ่มบันทึก/ลบ (ดูอย่างเดียว)
  const isOpen = PAY.currentPeriod && PAY.currentPeriod.status === 'OPEN';
  const saveBtn = document.getElementById('pay-edit-save');
  const delBtn = document.getElementById('pay-edit-delete');
  if (saveBtn) saveBtn.style.display = isOpen ? '' : 'none';
  if (delBtn) delBtn.style.display = isOpen ? '' : 'none';
  // งวดปิด → input อ่านอย่างเดียว
  if (!isOpen) {
    setTimeout(() => body.querySelectorAll('.pay-edit-inp').forEach(inp => { inp.disabled = true; }), 0);
  }
}

function savePayEdit() {
  const inputs = document.querySelectorAll('.pay-edit-inp');
  const values = [];
  inputs.forEach(inp => { values[parseInt(inp.getAttribute('data-idx'), 10)] = inp.value; });

  const btn = document.getElementById('pay-edit-save');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
  gasRun('payUpdateRow', { hrToken: S.hrToken, rowId: PAY.editRowId, values: values })
    .withSuccessHandler(r => {
      if (btn) { btn.disabled = false; btn.textContent = 'บันทึก + คำนวณสะสมใหม่'; }
      if (!r || !r.success) { showToast((r && r.message) || 'บันทึกไม่สำเร็จ'); return; }
      showToast('บันทึกแล้ว ' + (r.checkFlag === '⚠️' ? '(ยอดยังไม่ตรง ⚠️)' : '✓'), true);
      document.getElementById('pay-edit-overlay').style.display = 'none';
      loadPayTable();
    })
    .withFailureHandler(() => { if (btn) { btn.disabled = false; btn.textContent = 'บันทึก + คำนวณสะสมใหม่'; } showToast('เกิดข้อผิดพลาด'); });
}

function deletePayRow() {
  if (!PAY.editRowId) return;
  if (!confirm('ลบข้อมูลพนักงานคนนี้ออกจากงวด?')) return;
  gasRun('payDeleteRow', { hrToken: S.hrToken, rowId: PAY.editRowId })
    .withSuccessHandler(r => {
      if (!r || !r.success) { showToast((r && r.message) || 'ลบไม่สำเร็จ'); return; }
      showToast('ลบแล้ว', true);
      document.getElementById('pay-edit-overlay').style.display = 'none';
      loadPayTable();
    })
    .withFailureHandler(() => showToast('เกิดข้อผิดพลาด'));
}

// ════════ สร้าง PDF ════════
// 2 โหมด: ทั้งงวด (backend หยิบ batch เอง วนจนหมด) / เลือกเฉพาะคน (frontend แบ่ง batch เอง)
// forceAll=true = สร้างใหม่ทั้งงวด (ทับของเดิม)
function payGenPDF(rowIds, forceAll) {
  const p = PAY.currentPeriod;
  if (!p) return;
  const progress = document.getElementById('pay-pdf-progress');
  const bar = document.getElementById('pay-pdf-progress-bar');
  const txt = document.getElementById('pay-pdf-progress-text');
  if (progress) progress.style.display = 'block';
  if (bar) bar.style.width = '0%';

  const btns = ['pay-genpdf-btn', 'pay-genpdf-all-btn', 'pay-genpdf-sel-btn'];
  btns.forEach(id => { const b = document.getElementById(id); if (b) b.disabled = true; });

  // token กันวนข้ามงวด/ซ้ำ
  PAY.pdfToken = (PAY.pdfToken || 0) + 1;
  const myToken = PAY.pdfToken;
  PAY.pdfPeriodId = p.periodId;

  const finish = (msg) => {
    if (txt) txt.textContent = msg;
    btns.forEach(id => { const b = document.getElementById(id); if (b) b.disabled = false; });
    loadPayTable();
    setTimeout(() => { if (progress && myToken === PAY.pdfToken) progress.style.display = 'none'; }, 2500);
  };

  const stillValid = () => (myToken === PAY.pdfToken && PAY.currentPeriod && PAY.currentPeriod.periodId === PAY.pdfPeriodId);

  if (rowIds && rowIds.length) {
    // ═══ โหมดเลือกเฉพาะคน — frontend แบ่ง batch ทีละ 5 ส่งไปเรื่อยๆ ═══
    const BATCH = 5;
    const allIds = rowIds.slice();
    const totalSel = allIds.length;
    let idx = 0, errCount = 0, retries = 0;
    const MAX_RETRY = 2;

    const runChunk = () => {
      if (!stillValid()) return;
      if (idx >= totalSel) { finish(`✓ สร้าง PDF เสร็จ ${totalSel - errCount}/${totalSel} ใบ`); return; }
      const chunk = allIds.slice(idx, idx + BATCH);
      gasRun('payGeneratePDF', { hrToken: S.hrToken, periodId: p.periodId, rowIds: chunk })
        .withSuccessHandler(r => {
          if (!stillValid()) return;
          if (!r || !r.success) {
            // retry chunk เดิมก่อนยอมแพ้
            if (retries < MAX_RETRY) { retries++; if (txt) txt.textContent = `ลองใหม่... ${idx}/${totalSel}`; setTimeout(runChunk, 800); return; }
            finish('✗ ' + ((r && r.message) || 'สร้างไม่สำเร็จ') + ` (สร้างได้ ${idx}/${totalSel})`);
            return;
          }
          retries = 0;   // สำเร็จ → reset retry
          if (r.errors && r.errors.length) errCount += r.errors.length;
          idx += chunk.length;
          const pct = Math.min(100, Math.round((idx / totalSel) * 100));
          if (bar) bar.style.width = pct + '%';
          if (txt) txt.textContent = `กำลังสร้าง PDF... ${idx}/${totalSel}`;
          setTimeout(runChunk, 150);   // หน่วงเล็กน้อยกัน quota
        })
        .withFailureHandler(() => {
          if (!stillValid()) return;
          // การเชื่อมต่อล้ม → retry
          if (retries < MAX_RETRY) { retries++; if (txt) txt.textContent = `ลองใหม่... ${idx}/${totalSel}`; setTimeout(runChunk, 1000); return; }
          finish(`✗ การเชื่อมต่อขัดข้อง (สร้างได้ ${idx}/${totalSel} — กดสร้างอีกครั้งเพื่อทำต่อ)`);
        });
    };
    runChunk();
    return;
  }

  // ═══ โหมดทั้งงวด — backend หยิบ batch, วนจน done (forceAll=true สร้างใหม่ทั้งงวด) ═══
  let guardRounds = 0, allRetries = 0;
  const maxRounds = 300, MAX_RETRY_ALL = 2;
  const runBatch = () => {
    if (!stillValid()) return;
    if (++guardRounds > maxRounds) { finish('✗ หยุด (เกินจำนวนรอบที่กำหนด)'); return; }
    gasRun('payGeneratePDF', { hrToken: S.hrToken, periodId: p.periodId, rowIds: null, force: !!forceAll })
      .withSuccessHandler(r => {
        if (!stillValid()) return;
        if (!r || !r.success) {
          if (allRetries < MAX_RETRY_ALL) { allRetries++; if (txt) txt.textContent = 'ลองใหม่...'; setTimeout(runBatch, 900); return; }
          finish('✗ ' + ((r && r.message) || 'สร้างไม่สำเร็จ'));
          return;
        }
        allRetries = 0;
        const total = r.scopeTotal || 0;
        const done = r.doneCount || 0;
        const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 100;
        if (bar) bar.style.width = pct + '%';
        if (txt) txt.textContent = `กำลังสร้าง PDF... ${done}/${total}`;
        if (r.done || r.remaining <= 0) {
          finish(`✓ สร้าง PDF เสร็จ ${done}/${total} ใบ`);
        } else if (r.generatedThisBatch === 0) {
          finish(`⚠️ หยุด — สร้างได้ ${done}/${total} (บางรายการสร้างไม่สำเร็จ ลองใหม่)`);
        } else {
          runBatch();
        }
      })
      .withFailureHandler(() => { if (stillValid()) finish('✗ เกิดข้อผิดพลาดในการเชื่อมต่อ'); });
  };
  runBatch();
}

function payGenPDFSelected() {
  const ids = Array.from(document.querySelectorAll('.pay-row-check:checked')).map(c => c.getAttribute('data-id'));
  if (!ids.length) { showToast('เลือกพนักงานก่อน'); return; }
  payGenPDF(ids);
}

// ════════ ผูก event ════════
function initPayrollBindings() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  // เมนู HR
  on('hr-menu-payroll', 'click', () => go('pay-periods'));
  // หน้าจัดการงวด
  on('pay-periods-back', 'click', () => go('hr-dash'));
  on('pay-periods-refresh', 'click', loadPayPeriods);
  on('pay-create-btn', 'click', () => {
    const f = document.getElementById('pay-create-form');
    if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
  });
  on('pay-create-save', 'click', payCreatePeriod);
  on('pay-create-cancel', 'click', () => { document.getElementById('pay-create-form').style.display = 'none'; });
  // หน้าตรวจสอบ
  on('pay-review-back', 'click', () => go('pay-periods'));
  on('pay-genpdf-btn', 'click', () => payGenPDF(null, false));
  on('pay-genpdf-all-btn', 'click', () => { if (confirm('สร้าง PDF ใหม่ทั้งงวด (ทับของเดิมทุกคน)?')) payGenPDF(null, true); });
  on('pay-genpdf-sel-btn', 'click', payGenPDFSelected);
  on('pay-upload-file', 'change', function(e) {
    const f = e.target.files && e.target.files[0];
    if (f) payHandleUpload(f);
    e.target.value = '';   // reset ให้เลือกไฟล์เดิมซ้ำได้
  });
  // dialog แก้ไข
  on('pay-edit-save', 'click', savePayEdit);
  on('pay-edit-delete', 'click', deletePayRow);
  on('pay-edit-cancel', 'click', () => { document.getElementById('pay-edit-overlay').style.display = 'none'; });
  on('pay-edit-close', 'click', () => { document.getElementById('pay-edit-overlay').style.display = 'none'; });
}

// ════════ การ์ดสลิปเงินเดือนพนักงาน ════════
function loadMyPayslips() {
  const box = document.getElementById('my-payslip-list');
  if (box) box.innerHTML = '<div style="text-align:center;padding:20px;color:var(--tx3)">กำลังโหลด...</div>';
  gasRun('payGetMySlips', { token: S.hrToken })
    .withSuccessHandler(r => {
      if (!r || !r.success) { if (box) box.innerHTML = '<div style="padding:20px;color:var(--er)">' + payEsc((r && r.message) || 'โหลดไม่สำเร็จ') + '</div>'; return; }
      renderMyPayslips(r.slips || []);
    })
    .withFailureHandler(() => { if (box) box.innerHTML = '<div style="padding:20px;color:var(--er)">เกิดข้อผิดพลาด</div>'; });
}

function renderMyPayslips(slips) {
  const box = document.getElementById('my-payslip-list');
  if (!box) return;
  if (!slips.length) {
    box.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--tx3)">ยังไม่มีสลิปเงินเดือน</div>';
    return;
  }

  box.innerHTML = slips.map(s => `
    <div class="lv-card" style="padding:0;overflow:hidden">
      <div style="background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;padding:14px 16px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:16px;font-weight:700">${payEsc(s.payRound)}</div>
          <div style="font-size:12px;opacity:.9">จ่าย ${payEsc(payFmtDate(s.payDate))}</div>
        </div>
      </div>
      <div style="padding:14px 16px">
        <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:14px">
          <span style="color:var(--tx2)">รวมเงินได้</span>
          <span style="font-weight:600;font-variant-numeric:tabular-nums">${payMoney(s.income)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:14px">
          <span style="color:var(--tx2)">รวมเงินหัก</span>
          <span style="font-weight:600;color:var(--er);font-variant-numeric:tabular-nums">${payMoney(s.deduct)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:9px 0 5px;margin-top:5px;border-top:1.5px solid var(--bd);font-size:16px">
          <span style="font-weight:700">เงินได้สุทธิ</span>
          <span style="font-weight:700;color:var(--ac);font-variant-numeric:tabular-nums">${payMoney(s.net)} บาท</span>
        </div>
        ${s.bankAcct ? `<div style="font-size:12px;color:var(--tx3);margin-top:6px">เลขบัญชี ${payEsc(s.bankAcct)}</div>` : ''}
        <a href="${payEsc(s.url)}" target="_blank" class="btn p" style="display:block;text-align:center;text-decoration:none;margin-top:12px">📄 เปิดสลิป PDF</a>
      </div>
    </div>`).join('');
}
