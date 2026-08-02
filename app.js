/* ============================================================
   ระบบวิเคราะห์ผลประเมินโครงการ — ทำงานฝั่งเบราว์เซอร์ทั้งหมด
   ============================================================ */
"use strict";

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : "-");

/** แปลงเลขอารบิกในเนื้อความ (เฉพาะ text node ไม่แตะ attribute/รูปภาพ) เป็นเลขไทย */
function toThaiDigits(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const map = "๐๑๒๓๔๕๖๗๘๙";
  let node;
  while ((node = walker.nextNode())) node.nodeValue = node.nodeValue.replace(/[0-9]/g, (d) => map[+d]);
  return doc.body.innerHTML;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------- เกณฑ์แปลผลค่าเฉลี่ย (แบบมาตรฐานงานประเมินโครงการ) ---------- */
const CRITERIA_NOTE = "เกณฑ์การแปลผลค่าเฉลี่ย: 4.51–5.00 = มากที่สุด, 3.51–4.50 = มาก, 2.51–3.50 = ปานกลาง, 1.51–2.50 = น้อย, 1.00–1.50 = ควรปรับปรุง";
function levelLabel(m) {
  if (!Number.isFinite(m)) return "-";
  if (m >= 4.51) return "มากที่สุด";
  if (m >= 3.51) return "มาก";
  if (m >= 2.51) return "ปานกลาง";
  if (m >= 1.51) return "น้อย";
  return "ควรปรับปรุง";
}
const LEVEL_CLASS = { "มากที่สุด": "l5", "มาก": "l4", "ปานกลาง": "l3", "น้อย": "l2", "ควรปรับปรุง": "l1" };
const levelChip = (m) => `<span class="lv ${LEVEL_CLASS[levelLabel(m)] || ""}">${levelLabel(m)}</span>`;
const meanBar = (m) => `<span class="meanbar"><i style="width:${Number.isFinite(m) ? (m / 5) * 100 : 0}%"></i></span>`;

/* ---------- แปลงค่าคำตอบเป็นคะแนน 1–5 ---------- */
const RATING_TEXT = {
  "มากที่สุด": 5, "ดีมาก": 5, "เห็นด้วยอย่างยิ่ง": 5, "พึงพอใจมากที่สุด": 5,
  "มาก": 4, "ดี": 4, "เห็นด้วย": 4, "พึงพอใจมาก": 4,
  "ปานกลาง": 3, "เฉย ๆ": 3, "เฉยๆ": 3, "พอใช้": 3,
  "น้อย": 2, "ไม่เห็นด้วย": 2, "ควรปรับปรุง": 1, "น้อยที่สุด": 1, "ไม่เห็นด้วยอย่างยิ่ง": 1, "แย่": 1,
};
/* เรียงจากคำที่ยาว/เจาะจงก่อน เพราะใช้วิธี "มีคำนี้อยู่ในคำตอบ" (เช่น "มากที่สุด" ต้องมาก่อน "มาก") */
const RATING_CONTAINS = [
  ["ไม่เห็นด้วยอย่างยิ่ง", 1], ["เห็นด้วยอย่างยิ่ง", 5], ["ไม่เห็นด้วย", 2], ["เห็นด้วย", 4],
  ["มากที่สุด", 5], ["น้อยที่สุด", 1], ["ควรปรับปรุง", 1], ["ปรับปรุง", 1],
  ["ดีมาก", 5], ["ปานกลาง", 3], ["พอใช้", 3], ["มาก", 4], ["น้อย", 2], ["ดี", 4],
];
function parseRating(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v >= 1 && v <= 5 ? v : null;
  const s = String(v).trim();
  if (RATING_TEXT[s] != null) return RATING_TEXT[s];
  const m = s.match(/^([1-5])(?:\s*[-–.(].*)?$/);
  if (m) return +m[1];
  for (const [word, score] of RATING_CONTAINS) if (s.includes(word)) return score;
  return null;
}

/* ---------- SDG / คำถามสองค่า (สอดคล้อง–ไม่สอดคล้อง) ---------- */
const isAgreeValue = (s) => /(สอดคล้อง|บรรลุ)/.test(s) && !/ไม่/.test(s);
const isSdgLikeValue = (s) => /(สอดคล้อง|บรรลุ)/.test(s);

/* ============================================================
   สถานะหลักของแอป
   ============================================================ */
const state = {
  workbook: null,
  fileName: "",
  sheetName: "",
  headers: [],
  rows: [],          // array ของ array (ตามคอลัมน์)
  columns: [],       // { i, header, type, group, item }
  statusColIdx: -1,   // (คงไว้เพื่อความเข้ากันได้ — ใช้ filterCols เป็นหลัก)
  filterCols: [],     // คอลัมน์ที่ใช้เป็นตัวกรอง (ชุดแบบประเมิน, สถานะผู้ตอบ)
  filterSel: {},      // ค่าที่เลือกของแต่ละตัวกรอง (colIdx → ค่า หรือ null = ทั้งหมด)
  filterValue: null, // null = ทั้งหมด
  activeTab: "dashboard",
  charts: [],        // Chart instances ของแท็บที่แสดงอยู่
  projectName: "",
  reportOpts: { charts: true, chartStyle: "summary", freq: false, thaiNum: false, passMark: 3.51, objectives: "", appendix: true },
  ui: { showFreq: false },
  user: null,        // { name, role } — จาก localStorage
  sessionId: null,   // id ของรายการประวัติที่กำลังทำงานอยู่
  theme: "auto",     // auto | light | dark
  respTarget: null,  // จำนวนกลุ่มเป้าหมาย/แบบที่แจก — ใช้คำนวณอัตราการตอบกลับ
  reportExtraIds: new Set(), // id ประวัติของแบบประเมินอื่นที่เลือกมารวมในเล่มเดียว
  _extraCache: {},           // ข้อมูลชุดอื่นที่โหลดมาแล้ว (id → dataset)
  mergedFrom: [],            // ชื่อชุดข้อมูลที่ถูกผนวกเข้ากับชุดปัจจุบัน (ระดับแอป)
  source: "file",            // file | gsheet | evalproj
  review: null,              // ผลการตรวจงาน (จากไฟล์ .evalproj)
  reviewMeta: null,          // ข้อมูลผู้ส่งงานมาตรวจ
  mergedIds: new Set(),      // id ประวัติที่ผนวกไปแล้ว — กันผนวกซ้ำ
  _preMerge: null,           // สำเนาข้อมูลก่อนผนวกครั้งแรก — ไว้กด "เลิกผนวก"
  roleMap: {},               // Respondent Mapping: ค่าสถานะ → { role, label ที่ใช้ในรายงาน }
  valueMap: {},              // การรวมตัวเลือกสะกดต่างที่ผู้ใช้ยืนยันแล้ว: colIdx → { from: to }
  cleanLog: [],              // บันทึกการทำความสะอาดข้อมูล (ตัดแถวซ้ำ/รวมหมวด) — ลงรายงานส่วนการจัดการข้อมูล
  mapConfirmed: false,       // ผู้ใช้ยืนยันการจำแนกชนิดคำถามแล้วหรือยัง
  fuzzyDismissed: [],        // คู่ค่าที่ผู้ใช้ยืนยันว่า "คนละค่า" — ไม่ต้องเตือนซ้ำ
};

/* ============================================================
   ผนวกชุดข้อมูล (ระดับแอป) — รวมแบบประเมินหลายชุดให้วิเคราะห์ด้วยกันทุกหน้า
   ============================================================ */

/** คอลัมน์สังเคราะห์ "ชุดแบบประเมิน" — บอกที่มาของแต่ละแถวหลังผนวก และใช้เป็นตัวกรองได้ */
function ensureSourceColumn() {
  let idx = state.headers.indexOf("ชุดแบบประเมิน");
  if (idx >= 0) return idx;
  idx = state.headers.length;
  const mainLabel = state.fileName.replace(/\.(xlsx|xls|csv).*$/i, "");
  state.headers.push("ชุดแบบประเมิน");
  state.columns.push({ i: idx, header: "ชุดแบบประเมิน", type: "categorical", group: null, item: null });
  state.rows.forEach((r) => { r[idx] = mainLabel; });
  return idx;
}

/** ผนวกรายการจากประวัติเข้ากับชุดปัจจุบัน — หัวตารางตรงกันจับคู่คอลัมน์เดิม
    หัวที่ไม่มีในชุดหลักต่อคอลัมน์ใหม่ให้ (กลายเป็นเคสเดียวกับฟอร์มแยกเส้นทางผู้ตอบ) */
function mergeRecordIntoCurrent(rec) {
  // กันผนวกชุดเดิมซ้ำ — สาเหตุหลักของจำนวนผู้ตอบพองเป็นสองเท่า
  if (rec.id && state.mergedIds.has(rec.id)) {
    toast("ชุดข้อมูลนี้ถูกผนวกไปแล้ว — ไม่ผนวกซ้ำ");
    return;
  }
  const baseHeaders = (state._preMerge?.headers ?? state.headers).filter((h) => h !== "ชุดแบบประเมิน");
  const baseRowCount = state._preMerge?.rows.length ?? state.rows.length;
  const looksSame = rec.fileName === state.fileName ||
    (JSON.stringify(rec.headers.filter((h) => h !== "ชุดแบบประเมิน")) === JSON.stringify(baseHeaders) && rec.rows.length === baseRowCount);
  if (looksSame && !confirm(`คำเตือน: "${rec.fileName}" ดูเหมือนเป็นข้อมูลชุดเดียวกับไฟล์ปัจจุบัน
ผนวกแล้วผู้ตอบจะถูกนับซ้ำเป็นสองเท่า (เช่น 74 กลาย 148)

ยืนยันว่าต้องการผนวกจริง ๆ หรือไม่?`)) {
    return;
  }
  // สำรองข้อมูลก่อนผนวกครั้งแรก — เผื่อกด "เลิกผนวก"
  if (!state._preMerge) {
    state._preMerge = {
      headers: [...state.headers],
      rows: state.rows.map((r) => [...r]),
      columns: state.columns.map((c) => ({ ...c })),
      respTarget: state.respTarget,
    };
  }
  if (rec.id) state.mergedIds.add(rec.id);
  const srcIdx = ensureSourceColumn();
  const dLabel = rec.fileName.replace(/\.(xlsx|xls|csv).*$/i, "");

  // จับคู่คอลัมน์ของชุดที่ผนวกกับชุดหลักด้วยชื่อหัวตาราง
  const map = rec.headers.map((h) => state.headers.indexOf(h));
  rec.headers.forEach((h, j) => {
    if (map[j] >= 0 || h === "ชุดแบบประเมิน") return;
    const idx = state.headers.length;
    const meta = rec.colTypes?.[j] || {};
    state.headers.push(h);
    state.columns.push({ i: idx, header: h, type: meta.type || "ignore", group: meta.group ?? null, item: meta.item ?? null });
    map[j] = idx;
  });

  // เติมช่องว่างให้แถวเดิมตามความกว้างใหม่ แล้วเพิ่มแถวของชุดที่ผนวก
  const width = state.headers.length;
  state.rows.forEach((r) => { while (r.length < width) r.push(""); });
  for (const rr of rec.rows) {
    const nr = new Array(width).fill("");
    rr.forEach((v, j) => { if (map[j] >= 0) nr[map[j]] = v; });
    nr[srcIdx] = dLabel;
    state.rows.push(nr);
  }

  state.mergedFrom.push(dLabel);
  // เป้าหมายผู้ตอบ: รวมกันได้เมื่อรู้ทั้งสองฝั่ง ไม่งั้นถือว่าไม่ทราบ
  state.respTarget = state.respTarget && rec.respTarget ? state.respTarget + rec.respTarget : null;
  state.filterSel = {};
  updateStatusCol();
  bumpDataVersion();
  saveSessionSnapshot();
  updateFileMeta();
  renderFilterBar();
  renderActiveTab();
  toast(`ผนวก "${dLabel.slice(0, 30)}" แล้ว — รวม ${state.rows.length} คำตอบ`);
}

/** ถอนการผนวกทั้งหมด — กลับไปเป็นข้อมูลไฟล์เดิมก่อนผนวกครั้งแรก */
function undoMerge() {
  if (!state._preMerge) return;
  state.headers = state._preMerge.headers;
  state.rows = state._preMerge.rows;
  state.columns = state._preMerge.columns;
  state.respTarget = state._preMerge.respTarget;
  state.mergedFrom = [];
  state.mergedIds = new Set();
  state._preMerge = null;
  state.filterSel = {};
  updateStatusCol();
  bumpDataVersion();
  saveSessionSnapshot();
  updateFileMeta();
  renderFilterBar();
  renderActiveTab();
  toast("ยกเลิกการผนวกแล้ว — กลับเป็นข้อมูลไฟล์เดิม");
}

/** modal เลือกชุดข้อมูลจากประวัติมาผนวก */
async function openMergeModal() {
  let sessions = [];
  try { sessions = await dbGetAll("sessions"); } catch { /* noop */ }
  sessions = sessions.filter((s) => s.id !== state.sessionId).sort((a, b) => b.savedAt - a.savedAt).slice(0, 10);
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `<div class="modal modal-wide">
    <h2><i data-lucide="layers"></i> ผนวกชุดข้อมูลเข้ากับไฟล์ปัจจุบัน</h2>
    <p>ข้อมูลจะรวมเป็นชุดเดียวและวิเคราะห์ด้วยกันทุกหน้า พร้อมคอลัมน์ "ชุดแบบประเมิน" ไว้กรองแยกชุด — ไฟล์คนละแบบฟอร์มระบบจะต่อคอลัมน์ให้อัตโนมัติ</p>
    ${sessions.length
      ? sessions.map((s, i) => {
          const merged = state.mergedIds.has(s.id);
          const sameFile = s.fileName === state.fileName;
          return `
        <div class="combine-item">
          <b>${esc(s.projectName || s.fileName)}</b>
          <span class="sugg-count">· ${s.rows.length} คำตอบ · ${new Date(s.savedAt).toLocaleDateString("th-TH")}</span>
          ${sameFile && !merged ? '<span class="lv l3">อาจเป็นไฟล์เดียวกัน</span>' : ""}
          ${merged
            ? '<span class="lv l5" style="margin-left:auto">✓ ผนวกแล้ว</span>'
            : `<button class="btn small primary" data-merge="${i}" style="margin-left:auto"><i data-lucide="git-merge"></i> ผนวก</button>`}
        </div>`;
        }).join("")
      : `<p class="card-sub">ยังไม่มีชุดข้อมูลอื่นในประวัติ — อัปโหลดไฟล์ที่ต้องการผนวกก่อน (ระบบบันทึกอัตโนมัติ) แล้วค่อยกลับมากดผนวก</p>`}
    <button class="btn" id="mergeClose" style="margin-top:12px">ปิด</button>
  </div>`;
  document.body.appendChild(ov);
  refreshIcons();
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  $("#mergeClose", ov).onclick = () => ov.remove();
  $$("[data-merge]", ov).forEach((b) => (b.onclick = () => { mergeRecordIntoCurrent(sessions[+b.dataset.merge]); ov.remove(); }));
}

/** หาจำนวนกลุ่มเป้าหมาย (ผู้เข้าร่วม/แบบที่แจก) จากชีตสรุปอื่น ๆ ในไฟล์ ถ้ามี
    — ต้องเป็นแถวที่พูดถึง "จำนวน...เข้าร่วม/แจก" และค่าต้องเป็นจำนวนเต็ม ≥ จำนวนผู้ตอบ */
function scanRespondTarget(wb, primarySheet, minN = 1) {
  try {
    for (const name of wb.SheetNames) {
      if (name === primarySheet) continue;
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", blankrows: false });
      for (const r of aoa.slice(0, 80)) {
        const label = String(r[0] ?? "");
        if (!/(จำนวน|ยอด|แจก|กลุ่มเป้าหมาย)/.test(label)) continue;
        if (!/(เข้าร่วม|กลุ่มเป้าหมาย|แจก)/.test(label)) continue;
        if (/(ตอบ|ค่าเฉลี่ย|พึงพอใจ|ประสงค์|อยาก|ร้อยละ)/.test(label)) continue;
        const num = r.slice(1, 6).map(Number).find((x) => Number.isFinite(x) && Number.isInteger(x) && x >= minN);
        if (num) return num;
      }
    }
  } catch { /* noop */ }
  return null;
}

/* ============================================================
   ธีม: อัตโนมัติ / สว่าง / มืด
   ============================================================ */
const THEME_META = {
  auto: { icon: "monitor", label: "ธีมตามระบบ" },
  light: { icon: "sun", label: "ธีมสว่าง" },
  dark: { icon: "moon", label: "ธีมมืด" },
};
function applyTheme(t) {
  state.theme = t;
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem("evalTheme", t); } catch { /* noop */ }
  const btn = $("#btnTheme");
  btn.innerHTML = `<i data-lucide="${THEME_META[t].icon}"></i>`;
  btn.title = `${THEME_META[t].label} — คลิกเพื่อสลับ`;
  refreshIcons();
  // กราฟอ่านสีจาก CSS variables ตอนวาด — วาดใหม่ให้ตรงธีม
  if (!$("#workspace").classList.contains("hidden")) renderActiveTab();
}
function cycleTheme() {
  const order = ["auto", "light", "dark"];
  applyTheme(order[(order.indexOf(state.theme) + 1) % order.length]);
  toast(THEME_META[state.theme].label);
}

/* ============================================================
   ฐานข้อมูลในเครื่อง (IndexedDB) — ประวัติการวิเคราะห์ + ผู้ใช้งาน
   ============================================================ */
const RETENTION_DAYS = 15;
let _db = null;
function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("evalAnalyzer", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("users")) db.createObjectStore("users", { keyPath: "name" });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(store, val) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(val);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbGetAll(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbGet(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function dbDelete(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/** ลบประวัติที่เก่ากว่า 15 วันโดยอัตโนมัติ */
async function purgeOldSessions() {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    const all = await dbGetAll("sessions");
    let purged = 0;
    for (const s of all) if (s.savedAt < cutoff) { await dbDelete("sessions", s.id); purged++; }
    if (purged) console.info(`ลบประวัติหมดอายุ ${purged} รายการ`);
  } catch (e) { console.warn("purge ล้มเหลว", e); }
}

/** บันทึก/อัปเดตสแนปช็อตข้อมูลปัจจุบันเข้าประวัติ */
async function saveSessionSnapshot() {
  if (!state.sessionId || !state.rows.length) return;
  try {
    await dbPut("sessions", {
      id: state.sessionId,
      savedAt: Date.now(),
      savedBy: state.user ? `${state.user.name}${state.user.role ? " (" + state.user.role + ")" : ""}` : "-",
      fileName: state.fileName,
      sheetName: state.sheetName,
      projectName: state.projectName,
      respTarget: state.respTarget,
      mergedFrom: state.mergedFrom,
      mergedIds: [...state.mergedIds],
      headers: state.headers,
      rows: state.rows,
      colTypes: state.columns.map((c) => ({ type: c.type, group: c.group, item: c.item, mergeInto: c.mergeInto ?? null, noReport: c.noReport ?? false })),
      overallMean: (() => { const m = analyzeDataset(state.rows, state.columns).overall.mean; return Number.isFinite(m) ? m : null; })(),
      reportOpts: { ...state.reportOpts },
      roleMap: state.roleMap, valueMap: state.valueMap, cleanLog: state.cleanLog,
      mapConfirmed: state.mapConfirmed, fuzzyDismissed: state.fuzzyDismissed,
    });
  } catch (e) { console.warn("บันทึกประวัติไม่สำเร็จ", e); }
}

/* ============================================================
   โหลดไฟล์
   ============================================================ */
function handleFile(file) {
  if (/\.(evalproj|json)$/i.test(file.name)) {
    const r = new FileReader();
    r.onload = (e) => { try { importProject(JSON.parse(e.target.result), file.name.replace(/\.[^.]+$/, "")); } catch { toast("อ่านไฟล์ตรวจงานไม่สำเร็จ"); } };
    r.readAsText(file);
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });
      state.workbook = wb;
      state.fileName = file.name;
      loadSheet(bestSheet(wb));
      setupSheetPicker(wb);
    } catch (err) {
      console.error(err);
      toast("อ่านไฟล์ไม่สำเร็จ: " + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

/** เลือกชีตที่มีข้อมูลมากที่สุดโดยอัตโนมัติ (บางไฟล์มีชีตว่าง/ชีตสรุปนำหน้า) */
function bestSheet(wb) {
  let best = wb.SheetNames[0], bestScore = -1;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) continue;
    const r = XLSX.utils.decode_range(ws["!ref"]);
    const score = (r.e.r - r.s.r) * (r.e.c - r.s.c + 1);
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return best;
}

function setupSheetPicker(wb) {
  const sp = $("#sheetPicker");
  if (wb.SheetNames.length > 1) {
    sp.innerHTML = wb.SheetNames.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
    sp.value = state.sheetName;
    sp.classList.remove("hidden");
  } else sp.classList.add("hidden");
}

function loadSheet(sheetName, opts = {}) {
  const ws = state.workbook.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true, blankrows: false });
  if (!aoa.length) { toast("ชีตนี้ไม่มีข้อมูล"); return; }
  ingestAoA(aoa, { ...opts, sheetName, workbookForScan: state.workbook });
}

/** แกนกลางอ่านข้อมูลแบบ AoA (array-of-arrays) — ใช้ร่วมกันทั้งไฟล์ xlsx, Google Sheet, และไฟล์ตรวจงาน */
function ingestAoA(aoa, opts = {}) {
  state.sheetName = opts.sheetName || "";
  if (!opts.keepReview) { state.source = opts.source || "file"; state.review = null; state.reviewMeta = null; }

  // หาแถวหัวตาราง: บางไฟล์มีแถวชื่อเรื่อง/แถวว่างนำหน้า — เลือกแถวแรกใน 10 แถวแรก
  // ที่มีจำนวนช่องไม่ว่างอย่างน้อย 60% ของแถวที่แน่นที่สุด
  const counts = aoa.slice(0, 10).map((r) => r.filter((v) => String(v ?? "").trim() !== "").length);
  const maxCount = Math.max(...counts);
  let hIdx = counts.findIndex((c) => c >= 2 && c >= maxCount * 0.6);
  if (hIdx < 0) hIdx = 0;

  // ความกว้างจริง = คอลัมน์ที่ยาวที่สุดในทุกแถว (กันข้อมูลคอลัมน์ท้าย ๆ ที่ไม่มีชื่อหัวหาย)
  const width = Math.max(...aoa.map((r) => r.length));
  state.headers = Array.from({ length: width }, (_, i) => {
    const h = String(aoa[hIdx][i] ?? "").trim().replace(/\s+/g, " ");
    return h || `คอลัมน์ที่ ${i + 1}`;
  });

  // หัวตาราง 2 ชั้น (ไฟล์กรอกมือจากแบบกระดาษ): แถวเหนือหัวตารางเป็น "แถบชื่อตอน/ด้าน"
  // ที่ครอบหลายคอลัมน์ — เติมชื่อไปข้างหน้า (forward fill) เพื่อใช้จัดหมวดคำถามคะแนน
  let bands = null;
  if (hIdx > 0) {
    const bandRow = aoa[hIdx - 1] || [];
    const cells = [];
    for (let i = 0; i < width; i++) {
      const t = String(bandRow[i] ?? "").trim().replace(/\s+/g, " ");
      if (t) cells.push([i, t]);
    }
    if (cells.length >= 2) {
      bands = new Array(width).fill(null);
      let cur = null;
      for (let i = 0; i < width; i++) {
        const hit = cells.find(([ci]) => ci === i);
        if (hit) cur = hit[1];
        bands[i] = cur;
      }
    }
  }

  state.rows = aoa.slice(hIdx + 1)
    .map((r) => state.headers.map((_, i) => normalizeCell(r[i])))
    .filter((r) => r.some((v) => v !== ""));
  state.columns = detectColumns(state.headers, state.rows, bands);
  if (opts.colTypes && opts.colTypes.length === state.columns.length) {
    state.columns.forEach((c, i) => Object.assign(c, opts.colTypes[i]));
  }
  // นับเป็นผู้ตอบเฉพาะแถวที่มีคำตอบจริง — ไฟล์กรอกมือมักมีแถวเทมเพลตที่พิมพ์เลขลำดับรอไว้
  const usedIdx = state.columns.filter((c) => c.type !== "ignore").map((c) => c.i);
  state.rows = state.rows.filter((r) => usedIdx.some((i) => String(r[i]).trim() !== ""));
  updateStatusCol();
  state.filterSel = {};
  state.projectName = opts.projectName ?? state.projectName;
  state.activeTab = "dashboard";
  if (!opts.fromHistory) state.respTarget = opts.workbookForScan ? scanRespondTarget(opts.workbookForScan, state.sheetName, state.rows.length) : (opts.respTarget ?? null);
  state.reportExtraIds = new Set();
  state.mergedFrom = [];
  state.mergedIds = new Set();
  state._preMerge = null;
  if (!opts.colTypes) {
    state.roleMap = {}; state.valueMap = {}; state.cleanLog = [];
    state.mapConfirmed = false; state.fuzzyDismissed = [];
  }
  bumpDataVersion();

  $$(".panel").forEach((p) => (p.innerHTML = ""));
  $("#emptyState").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  $("#fileInfo").classList.remove("hidden");
  $("#fileName").textContent = state.fileName;
  updateFileMeta();
  renderFilterBar();
  switchTab("dashboard");
  toast(`โหลดข้อมูลแล้ว ${state.rows.length} คำตอบ`);

  if (!opts.fromHistory) {
    state.sessionId = (crypto.randomUUID && crypto.randomUUID()) || "id-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    saveSessionSnapshot();
    // อัปโหลดไฟล์เดิมซ้ำ → ลบรายการประวัติเก่าของไฟล์เดียวกันทิ้ง (ตัดต้นตอรายการซ้ำที่ชวนให้ผนวกผิด)
    (async () => {
      try {
        const all = await dbGetAll("sessions");
        for (const old of all) {
          if (old.id !== state.sessionId && old.fileName === state.fileName) {
            await dbDelete("sessions", old.id);
          }
        }
      } catch { /* noop */ }
    })();
  } else {
    state.sessionId = opts.sessionId;
  }
}

/* ============================================================
   เชื่อม Google Sheet แบบเรียลไทม์ (ดึงตรง เบราว์เซอร์ ↔ Google)
   ต้องมี OAuth Client ID ของผู้ใช้เอง (ตั้งค่าครั้งเดียวใน Google Cloud)
   ============================================================ */
const GS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly openid email profile";
const getClientId = () => { try { return localStorage.getItem("gClientId") || ""; } catch { return ""; } };
const setClientId = (v) => { try { localStorage.setItem("gClientId", v); } catch { /* noop */ } };
function extractSheetId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(String(url).trim()) ? String(url).trim() : null;
}
let _gsiPromise = null;
function gsiLoad() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (_gsiPromise) return _gsiPromise;
  _gsiPromise = new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true; sc.defer = true;
    sc.onload = () => resolve();
    sc.onerror = () => reject(new Error("gsi load failed"));
    document.head.appendChild(sc);
  });
  return _gsiPromise;
}

function openSheetModal() {
  const cid = getClientId();
  const origin = location.origin;
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `<div class="modal modal-wide">
    <h2><i data-lucide="table-2"></i> เชื่อม Google Sheet</h2>
    <p>ดึงคำตอบตรงจาก Google Sheet ของฟอร์ม แล้วกด “ซิงค์” เมื่อไรก็ได้ค่าล่าสุด — ข้อมูลวิ่งตรงระหว่างเบราว์เซอร์กับ Google ไม่ผ่านเซิร์ฟเวอร์ของเรา</p>
    <label>ลิงก์ Google Sheet
      <input type="text" id="gsUrl" placeholder="วางลิงก์ https://docs.google.com/spreadsheets/d/..."></label>
    <details class="gs-setup" ${cid ? "" : "open"}>
      <summary>ตั้งค่าครั้งแรก (ทำครั้งเดียว) ${cid ? "· ตั้งค่าไว้แล้ว ✓" : ""}</summary>
      <ol>
        <li>เปิด <b>console.cloud.google.com</b> → สร้างโปรเจกต์</li>
        <li>เมนู APIs &amp; Services → Library → เปิดใช้ <b>Google Sheets API</b></li>
        <li>OAuth consent screen → เลือก External → เพิ่มอีเมลตัวเองใน <b>Test users</b></li>
        <li>Credentials → Create → <b>OAuth client ID</b> → ประเภท <b>Web application</b><br>
            ช่อง Authorized JavaScript origins ใส่: <code>${esc(origin)}</code> และ <code>https://sunkinincode.github.io</code></li>
        <li>คัดลอก <b>Client ID</b> มาวางด้านล่าง</li>
      </ol>
      <label>OAuth Client ID
        <input type="text" id="gsClient" value="${esc(cid)}" placeholder="xxxxxxxx.apps.googleusercontent.com"></label>
    </details>
    <button class="btn primary" id="gsConnect"><i data-lucide="link"></i> เชื่อมและดึงข้อมูล</button>
    <button class="btn" id="gsClose">ปิด</button>
  </div>`;
  document.body.appendChild(ov);
  refreshIcons();
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  $("#gsClose", ov).onclick = () => ov.remove();
  $("#gsConnect", ov).onclick = () => {
    const url = $("#gsUrl", ov).value.trim();
    const clientId = ($("#gsClient", ov) ? $("#gsClient", ov).value.trim() : "") || cid;
    connectSheet(url, clientId, ov);
  };
}

async function connectSheet(url, clientId, ov) {
  const id = extractSheetId(url);
  if (!id) { toast("ลิงก์ Google Sheet ไม่ถูกต้อง"); return; }
  if (!clientId) { toast('ใส่ OAuth Client ID ก่อน (ดูวิธีในกล่อง “ตั้งค่าครั้งแรก”)'); return; }
  setClientId(clientId);
  try { await gsiLoad(); } catch { toast("โหลด Google ไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ต"); return; }
  toast("กำลังขอสิทธิ์เข้าถึง Google Sheet…");
  try {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: GS_SCOPE,
      callback: async (resp) => {
        if (resp.error) { toast("อนุญาต Google ไม่สำเร็จ: " + resp.error); return; }
        state.gsheet = { id, token: resp.access_token, tokenAt: Date.now(), clientId };
        if (ov) ov.remove();
        await gsAfterAuth(true);
      },
    });
    state._tokenClient = tokenClient;
    tokenClient.requestAccessToken({ prompt: "" });
  } catch (e) { console.error(e); toast("เริ่มการเชื่อมต่อ Google ไม่สำเร็จ"); }
}

async function gsFetch(path) {
  const r = await fetch(path, { headers: { Authorization: "Bearer " + state.gsheet.token } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function gsAfterAuth(withIdentity) {
  try {
    if (withIdentity) {
      try {
        const info = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + state.gsheet.token } })).json();
        if (info && info.name) { state.user = { name: info.name, role: info.email || "" }; localStorage.setItem("evalUser", JSON.stringify(state.user)); updateUserChip(); touchUser(); }
      } catch { /* ตัวตนไม่สำเร็จก็ยังดึงชีตต่อได้ */ }
    }
    const meta = await gsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${state.gsheet.id}?fields=properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))`);
    // เลือกชีตที่ใหญ่ที่สุด
    let best = meta.sheets[0].properties.title, bestScore = -1;
    for (const sh of meta.sheets) {
      const g = sh.properties.gridProperties || {};
      const score = (g.rowCount || 0) * (g.columnCount || 0);
      if (score > bestScore) { bestScore = score; best = sh.properties.title; }
    }
    state.gsheet.title = meta.properties.title;
    state.gsheet.sheetTitle = best;
    state.fileName = meta.properties.title + " (Google Sheet)";
    await gsPullValues();
    toast("เชื่อม Google Sheet แล้ว — กดปุ่มซิงค์เพื่อดึงค่าล่าสุดได้ทุกเมื่อ");
  } catch (e) { console.error(e); toast("อ่าน Google Sheet ไม่สำเร็จ (สิทธิ์/ลิงก์/แชร์ไฟล์)"); }
}

async function gsPullValues() {
  const range = `'${state.gsheet.sheetTitle}'`;
  const data = await gsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${state.gsheet.id}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`);
  const aoa = data.values || [];
  if (!aoa.length) { toast("ชีตนี้ยังไม่มีข้อมูล"); return; }
  ingestAoA(aoa, { sheetName: state.gsheet.sheetTitle, source: "gsheet" });
  $("#fileName").textContent = state.fileName + " · เชื่อมสด";
}

async function syncSheet() {
  if (!state.gsheet) return;
  // token อายุ ~1 ชม. — ขอใหม่แบบเงียบถ้าใกล้หมด
  if (Date.now() - state.gsheet.tokenAt > 55 * 60 * 1000 && state._tokenClient) {
    state._tokenClient.callback = async (resp) => {
      if (resp.error) { toast("ต่ออายุสิทธิ์ Google ไม่สำเร็จ ลองเชื่อมใหม่"); return; }
      state.gsheet.token = resp.access_token; state.gsheet.tokenAt = Date.now();
      await gsSyncNow();
    };
    state._tokenClient.requestAccessToken({ prompt: "" });
    return;
  }
  await gsSyncNow();
}
async function gsSyncNow() {
  const prevSel = { ...state.filterSel };
  try { await gsPullValues(); state.filterSel = prevSel; renderFilterBar(); renderActiveTab(); toast("ซิงค์ค่าล่าสุดแล้ว"); }
  catch (e) { console.error(e); toast("ซิงค์ไม่สำเร็จ"); }
}

/* ============================================================
   ไฟล์โปรเจกต์ .evalproj — ให้คนอื่นทำแล้วส่งมาให้ตรวจ / ตรวจแล้วส่งกลับ
   (ไฟล์ JSON เดินทางเป็นไฟล์ ไม่ผ่านเซิร์ฟเวอร์ — ปลอดภัยตาม PDPA)
   ============================================================ */
function currentColTypes() {
  return state.columns.map((c) => ({ type: c.type, group: c.group, item: c.item, mergeInto: c.mergeInto ?? null, noReport: c.noReport ?? false }));
}
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
function meLabel() {
  return state.user ? `${state.user.name}${state.user.role ? " (" + state.user.role + ")" : ""}` : "-";
}
function exportProject(withReview) {
  const obj = {
    app: "eval-analyzer", kind: "project", version: 2,
    exportedAt: Date.now(),
    exportedBy: withReview ? (state.reviewMeta?.exportedBy || "-") : meLabel(),
    projectName: state.projectName, fileName: state.fileName,
    respTarget: state.respTarget, mergedFrom: state.mergedFrom,
    headers: state.headers, rows: state.rows, colTypes: currentColTypes(),
    roleMap: state.roleMap, valueMap: state.valueMap, cleanLog: state.cleanLog,
    mapConfirmed: state.mapConfirmed, fuzzyDismissed: state.fuzzyDismissed,
    reportOpts: { ...state.reportOpts },
    review: withReview ? state.review : null,
  };
  const base = (state.projectName.trim() || state.fileName.replace(/\.[^.]+$/, "") || "โครงการ");
  downloadBlob(new Blob([JSON.stringify(obj)], { type: "application/json" }), `${base}${withReview ? "-ตรวจแล้ว" : "-ส่งตรวจ"}.evalproj`);
  toast(withReview ? "ส่งกลับให้เจ้าของแล้ว (.evalproj)" : "สร้างไฟล์ส่งตรวจแล้ว — ส่งไฟล์ .evalproj ให้ผู้ตรวจได้เลย");
}
function importProject(obj, srcName) {
  if (!obj || obj.kind !== "project" || !Array.isArray(obj.headers) || !Array.isArray(obj.rows)) {
    toast("ไฟล์ .evalproj ไม่ถูกต้อง"); return;
  }
  state.workbook = null;
  state.fileName = obj.fileName || srcName || "โครงการตรวจงาน";
  state.headers = obj.headers;
  state.rows = obj.rows;
  state.columns = detectColumns(obj.headers, obj.rows);
  if (obj.colTypes && obj.colTypes.length === state.columns.length) state.columns.forEach((c, i) => Object.assign(c, obj.colTypes[i]));
  updateStatusCol();
  state.filterSel = {};
  state.projectName = obj.projectName || "";
  state.respTarget = obj.respTarget ?? null;
  state.mergedFrom = obj.mergedFrom || [];
  state.mergedIds = new Set(); state._preMerge = null; state.reportExtraIds = new Set();
  state.source = "evalproj";
  state.reviewMeta = { exportedBy: obj.exportedBy || "-", exportedAt: obj.exportedAt, note: obj.note || "" };
  state.review = obj.review || null;
  state.sessionId = (crypto.randomUUID && crypto.randomUUID()) || "id-" + Date.now();
  bumpDataVersion();
  $$(".panel").forEach((p) => (p.innerHTML = ""));
  $("#emptyState").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  $("#fileInfo").classList.remove("hidden");
  $("#fileName").textContent = state.fileName + " · ตรวจงาน";
  updateFileMeta();
  renderFilterBar();
  switchTab("dashboard");
  toast(state.review ? "เปิดไฟล์ที่ตรวจแล้ว" : "เปิดงานที่ส่งมาให้ตรวจ");
}

/** แถบตรวจงาน (บนแดชบอร์ด) — โหมดตรวจ หรือ แสดงผลตรวจ */
function reviewBanner(panel) {
  if (state.source !== "evalproj" || !state.reviewMeta) return;
  const card = document.createElement("div");
  card.className = "card review-card";
  if (state.review && state.review.status) {
    const ok = state.review.status === "ผ่าน";
    card.innerHTML = `<h3><i data-lucide="clipboard-check"></i> ผลการตรวจงาน</h3>
      <div class="sum-row"><span>สถานะ</span><b><span class="lv ${ok ? "l5" : "l3"}">${ok ? "✓ ผ่าน" : "✎ มีข้อแก้ไข"}</span></b></div>
      <div class="sum-row"><span>ผู้ตรวจ</span><b>${esc(state.review.reviewedBy || "-")}</b></div>
      ${state.review.comments && state.review.comments.length ? `<div style="margin-top:10px"><b style="font-size:13px">ความเห็น/ข้อแก้ไข</b><ul class="sugg" style="margin-top:4px">${state.review.comments.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : `<p class="card-sub" style="margin-top:8px">ไม่มีความเห็นเพิ่มเติม</p>`}`;
    panel.appendChild(card);
    return;
  }
  card.innerHTML = `<h3><i data-lucide="clipboard-pen"></i> กำลังตรวจงานที่ได้รับ</h3>
    <p class="card-sub">ส่งมาโดย <b>${esc(state.reviewMeta.exportedBy)}</b> — ตรวจตัวเลข การจัดด้าน และการตั้งค่าได้ทุกหน้า เมื่อตรวจเสร็จใส่ความเห็นแล้วส่งกลับ</p>
    <textarea id="rvComment" class="rv-ta" placeholder="ความเห็น/ข้อแก้ไข — พิมพ์หนึ่งข้อต่อหนึ่งบรรทัด (เว้นว่างได้ถ้าไม่มี)"></textarea>
    <div class="rv-actions">
      <button class="btn" id="rvPass"><i data-lucide="check"></i> ผ่าน — ส่งกลับ</button>
      <button class="btn primary" id="rvFix"><i data-lucide="pen-line"></i> มีข้อแก้ไข — ส่งกลับ</button>
    </div>`;
  panel.appendChild(card);
  const finish = (status) => {
    const ta = $("#rvComment", card);
    const comments = (ta && ta.value || "").split("\n").map((x) => x.trim()).filter(Boolean);
    state.review = { status, comments, reviewedBy: meLabel(), reviewedAt: Date.now() };
    exportProject(true);
    renderActiveTab();
  };
  $("#rvPass", card).onclick = () => finish("ผ่าน");
  $("#rvFix", card).onclick = () => finish("มีข้อแก้ไข");
}

function normalizeCell(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toLocaleString("th-TH");
  if (typeof v === "string") return v.trim();
  return v;
}

/* ============================================================
   ตรวจชนิดคอลัมน์อัตโนมัติ
   ============================================================ */
const IGNORE_HEADER = /(ประทับเวลา|timestamp|pdpa|ยินยอม|คำชี้แจง|อีเมล|e-?mail|ชื่อ\s*-\s*สกุล|ชื่อ-นามสกุล|เบอร์|โทรศัพท์)/i;
const ID_HEADER = /(รหัส)/i;
const DEMOG_HEADER = /(ชั้นปี|ปีที่ศึกษา|ระดับชั้น|อายุ|ห้อง|จำนวน)/i;
const TEXT_HEADER = /(ข้อเสนอแนะ|ความคิดเห็น|ปัญหา|อุปสรรค|สิ่งที่ควรปรับปรุง|ประทับใจ|อยากให้|เหตุผล)/i;

/* หมวดคำถามที่หัวข้อหลักว่าง (Google Forms ไม่ export ชื่อ section มา)
   — ถ้าข้อคำถามมีรหัส 5Hs (Head/Hand/Heart/Habit) ให้ใช้ชื่อมาตรฐานของแบบประเมินกลาง */
const H5_NAME = "ด้านทักษะแห่งอนาคต (Holistic Development: 5Hs)";
const H5_ITEM_RE = /\b(Head|Hand|Heart|Habit)\b/i;
function unnamedGroupName(item) {
  return H5_ITEM_RE.test(item) ? H5_NAME : "ด้านที่ไม่ระบุชื่อ";
}

function detectColumns(headers, rows, bands = null) {
  return headers.map((header, i) => {
    const values = rows.map((r) => r[i]).filter((v) => v !== "");
    const col = { i, header, type: "text", group: null, item: null };
    if (!values.length) { col.type = "ignore"; col._conf = 0.95; return col; }

    const strs = values.map((v) => String(v).trim());
    const distinct = [...new Set(strs)];
    const avgLen = strs.reduce((a, s) => a + s.length, 0) / strs.length;

    if (IGNORE_HEADER.test(header)) { col.type = "ignore"; col._conf = 0.95; return col; }
    if (ID_HEADER.test(header)) { col.type = "ignore"; col._conf = 0.9; return col; }
    // คอลัมน์เลขลำดับ/เลขที่ของไฟล์กรอกมือ — ไม่ใช่ข้อมูลประเมิน
    if (/^(ลำดับ|ลําดับ|ที่|เลขที่|no\.?|เลขประจำตัว)\s*$/i.test(header)) { col.type = "ignore"; col._conf = 0.95; return col; }

    // SDG / สองค่า สอดคล้อง–ไม่สอดคล้อง
    if (strs.every(isSdgLikeValue)) { col.type = "sdg"; col._conf = 0.95; return col; }

    // คะแนน 1–5 — ความมั่นใจ = สัดส่วนคำตอบที่แปลงเป็นคะแนนได้จริง
    const ratingOk = values.filter((v) => parseRating(v) != null).length / values.length;
    const bracket = header.match(/^(.*?)\s*\[(.+)\]\s*$/);
    if (ratingOk >= 0.9 && (bracket || !DEMOG_HEADER.test(header))) {
      col.type = "rating";
      col._conf = Math.min(0.99, ratingOk);
      if (bracket) { col.item = bracket[2].trim(); col.group = bracket[1].trim() || unnamedGroupName(col.item); }
      else { col.group = (bands && bands[i]) || "การประเมินรายข้ออื่น ๆ"; col.item = header; }
      return col;
    }

    // คำถามเชิงความเห็นที่คำตอบกระจุกเป็นตัวเลือกซ้ำ ๆ (เช่น "ฐานกิจกรรมที่ประทับใจมากที่สุด")
    // = คำถามหมวดหมู่ → วิเคราะห์ด้วยความถี่/ร้อยละ ไม่ใช่ Theme — ความมั่นใจต่ำ ให้ผู้ใช้ยืนยัน
    if (TEXT_HEADER.test(header)) {
      if (distinct.length <= 25 && distinct.length <= strs.length * 0.5 && avgLen <= 50) {
        col.type = "categorical"; col.catQ = true; col._conf = 0.72; return col;
      }
      col.type = "text"; col._conf = 0.85; return col;
    }
    if (distinct.length <= 20 && avgLen <= 60) { col.type = "categorical"; col._conf = distinct.length <= 12 ? 0.9 : 0.72; return col; }
    col.type = "text"; col._conf = 0.55; // เดาจากการตัดตัวเลือกอื่นทิ้ง — ควรได้รับการตรวจยืนยัน
    return col;
  });
}

/* ============================================================
   การกรองข้อมูล + สถิติ
   ============================================================ */
function updateStatusCol() {
  const cols = [];
  const src = state.columns.findIndex((c) => c.header === "ชุดแบบประเมิน");
  if (src >= 0) cols.push(src);
  const st = state.columns.findIndex((c) => c.type === "categorical" && /สถานะ/.test(c.header));
  if (st >= 0 && st !== src) cols.push(st);
  state.filterCols = cols;
  state.statusColIdx = st >= 0 ? st : src;
  for (const k of Object.keys(state.filterSel)) if (!cols.includes(+k)) delete state.filterSel[k];
}

/** ข้อความสรุปตัวกรองที่เลือกอยู่ (ว่าง = ไม่ได้กรอง) */
function activeFilterText() {
  return state.filterCols.map((i) => state.filterSel[i]).filter(Boolean).join(" · ");
}

function updateFileMeta() {
  $("#fileMeta").textContent = `${state.rows.length} คำตอบ · ${state.headers.length} คอลัมน์` +
    (state.mergedFrom?.length ? ` · ผนวกแล้ว ${state.mergedFrom.length + 1} ชุด` : "") +
    (state.source === "gsheet" ? " · เชื่อมสด" : "");
  $("#btnUnmerge")?.classList.toggle("hidden", !state._preMerge);
  $("#btnSync")?.classList.toggle("hidden", state.source !== "gsheet");
}

function filteredRows() {
  const active = Object.entries(state.filterSel).filter(([, v]) => v != null);
  if (!active.length) return state.rows;
  return state.rows.filter((r) => active.every(([i, v]) => rowValueCombined(r, +i) === v));
}

/** สถิติจากค่าคะแนนที่แปลงเป็นตัวเลข 1–5 แล้ว */
function statsFromVals(nums) {
  const n = nums.length;
  const freq = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  if (!n) return { n: 0, mean: NaN, sd: NaN, freq };
  let sum = 0;
  for (const v of nums) { sum += v; freq[Math.round(v)] = (freq[Math.round(v)] || 0) + 1; }
  const mean = sum / n;
  let sq = 0;
  for (const v of nums) sq += (v - mean) ** 2;
  const sd = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
  return { n, mean, sd, freq };
}

/* --- แคชผลวิเคราะห์: แปลงคะแนน/นับ SDG ครั้งเดียวต่อ (ข้อมูล, ตัวกรอง)
       สลับแท็บหรือปรับตัวเลือกรายงานไม่ต้องคำนวณซ้ำ --- */
let _dataVersion = 0;      // เพิ่มค่าเมื่อข้อมูลหรือชนิดคอลัมน์เปลี่ยน
let _analysisKey = null;
let _analysis = null;
function bumpDataVersion() { _dataVersion++; _analysisKey = null; _analysis = null; }

/** วิเคราะห์ชุดข้อมูลใด ๆ (pure) — ใช้ทั้งชุดปัจจุบันและแบบประเมินอื่นที่ดึงมารวมเล่ม */
function analyzeDataset(rows, columns) {
  // กลุ่มคำถามคะแนน — แปลงค่าแต่ละคอลัมน์ครั้งเดียว แล้ว pool ต่อจากค่าที่แปลงแล้ว
  const cols = columns.filter((c) => c.type === "rating");
  const names = [...new Set(cols.map((c) => c.group))];
  const groups = names.map((name) => {
    const items = cols.filter((c) => c.group === name).map((c) => {
      const vals = [];
      for (const r of rows) { const v = parseRating(r[c.i]); if (v != null) vals.push(v); }
      return { label: c.item, colIdx: c.i, _vals: vals, stats: statsFromVals(vals) };
    });
    const pooled = items.flatMap((it) => it._vals);
    return { name, items, total: statsFromVals(pooled), _vals: pooled };
  }).filter((g) => g.items.some((it) => it.stats.n > 0));

  const overall = statsFromVals(groups.flatMap((g) => g._vals));
  const sdgs = computeSdgs(rows, columns);
  return { groups, overall, sdgs };
}

function computeAnalysis() {
  const key = `${_dataVersion}|${state.filterCols.map((i) => `${i}=${state.filterSel[i] ?? ""}`).join("|")}`;
  if (_analysis && _analysisKey === key) return _analysis;
  _analysis = analyzeDataset(filteredRows(), state.columns);
  _analysisKey = key;
  return _analysis;
}
const ratingGroups = () => computeAnalysis().groups;
const overallRatingStats = () => computeAnalysis().overall;
const sdgResults = () => computeAnalysis().sdgs;

/* แคชรูปกราฟของรายงาน — สร้าง PNG ใหม่เฉพาะเมื่อข้อมูล/ตัวกรองเปลี่ยน */
const _reportImgCache = new Map();
function cachedChartURL(id, make) {
  const key = `${_analysisKey}|${id}`;
  if (_reportImgCache.has(key)) return _reportImgCache.get(key);
  if (_reportImgCache.size > 80) _reportImgCache.clear();
  const url = make();
  _reportImgCache.set(key, url);
  return url;
}

/* ชื่อย่อมาตรฐานของ SDGs — ใช้เป็นป้ายในกราฟแทนหัวคอลัมน์ที่มีคำอธิบายยาว */
const SDG_NAMES = {
  1: "ขจัดความยากจน", 2: "ขจัดความหิวโหย", 3: "สุขภาพและความเป็นอยู่ที่ดี",
  4: "การศึกษาที่มีคุณภาพ", 5: "ความเท่าเทียมทางเพศ", 6: "น้ำสะอาดและการสุขาภิบาล",
  7: "พลังงานสะอาดที่เข้าถึงได้", 8: "งานที่มีคุณค่าและเศรษฐกิจเติบโต",
  9: "อุตสาหกรรม นวัตกรรม โครงสร้างพื้นฐาน", 10: "ลดความเหลื่อมล้ำ",
  11: "เมืองและชุมชนที่ยั่งยืน", 12: "การผลิตและบริโภคที่ยั่งยืน",
  13: "การรับมือการเปลี่ยนแปลงสภาพภูมิอากาศ", 14: "ทรัพยากรทางทะเล",
  15: "ระบบนิเวศบนบก", 16: "สันติภาพ ยุติธรรม สถาบันเข้มแข็ง",
  17: "หุ้นส่วนเพื่อการพัฒนาที่ยั่งยืน",
};

function computeSdgs(rows, columns = state.columns) {
  return columns.filter((c) => c.type === "sdg").map((c) => {
    let agree = 0, n = 0;
    for (const r of rows) {
      const v = String(r[c.i]).trim();
      if (v === "") continue;
      n++;
      if (isAgreeValue(v)) agree++;
    }
    const m = c.header.match(/SDG\s*(\d+)/i);
    const num = m ? +m[1] : null;
    const name = num && SDG_NAMES[num] ? SDG_NAMES[num] : null;
    return {
      header: c.header,
      short: num ? `SDG ${num}` : c.header.slice(0, 20),
      label: num ? `SDG ${num} · ${name || ""}`.trim() : c.header.slice(0, 40),
      name,
      num,
      icon: num && num >= 1 && num <= 17 ? `assets/sdg/sdg-${String(num).padStart(2, "0")}.jpg` : null,
      n, agree, disagree: n - agree,
      pct: n ? (agree / n) * 100 : 0,
    };
  }).filter((s) => s.n > 0);
}

/** คอลัมน์ที่ถูก "รวมเข้ากับ" คอลัมน์นี้ (เช่น บทบาท รวมเข้ากับ สถานะ — คำถามเดียวกันคนละกิ่งของฟอร์ม) */
function mergedIntoCols(colIdx, columns = state.columns) {
  return columns.filter((c) => c.mergeInto === colIdx && c.type === "categorical").map((c) => c.i);
}
/** ค่าของแถวเมื่อรวมคอลัมน์แล้ว — ใช้ค่าแรกที่ไม่ว่าง (ฟอร์มแยกกิ่งจะกรอกช่องเดียว) */
function rowValueCombined(r, colIdx, columns = state.columns) {
  for (const i of [colIdx, ...mergedIntoCols(colIdx, columns)]) {
    const v = String(r[i] ?? "").trim();
    if (v) return mappedValue(i, v); // แปลงตามการรวมหมวดที่ผู้ใช้ยืนยันแล้ว
  }
  return "";
}

function catFreq(rows, colIdx, columns = state.columns) {
  const map = new Map();
  rows.forEach((r) => {
    const v = rowValueCombined(r, colIdx, columns);
    if (v === "") return;
    map.set(v, (map.get(v) || 0) + 1);
  });
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  const entries = [...map.entries()].map(([label, n]) => ({ label, n, pct: (n / total) * 100 }));
  entries.sort((a, b) => b.n - a.n);
  return { entries, total };
}

function textAnswers(rows, colIdx) {
  const map = new Map();
  rows.forEach((r) => {
    const v = String(r[colIdx]).trim();
    if (v === "" || v === "-" || v === "–") return;
    const key = v.replace(/\s+/g, " ");
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].map(([text, n]) => ({ text, n })).sort((a, b) => b.n - a.n);
}

/* ============================================================
   ธีมกราฟ + ตัวช่วยสร้างกราฟ
   ============================================================ */
function themeVars(paper = false) {
  if (paper) {
    return {
      surface: "#ffffff", text: "#0b0b0b", secondary: "#52514e", muted: "#898781",
      grid: "#e1e0d9", axis: "#c3c2b7", series: "#2a78d6",
      likert: ["#256abf", "#6da7ec", "#dbdad3", "#ef9392", "#e34948"],
    };
  }
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    surface: v("--surface-1"), text: v("--text-primary"), secondary: v("--text-secondary"),
    muted: v("--muted"), grid: v("--grid"), axis: v("--axis"), series: v("--series-1"),
    likert: [v("--lk5"), v("--lk4"), v("--lk3"), v("--lk2"), v("--lk1")],
  };
}

const FONT_STACK = "'Anuphan','Sarabun','Leelawadee UI','Thonburi',system-ui,-apple-system,'Segoe UI',sans-serif";

function wrapLabel(s, max = 44, maxLines = 3) {
  s = String(s);
  if (s.length <= max) return s;
  const words = s.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      if (cur) lines.push(cur);
      if (w.length > max) {
        for (let i = 0; i < w.length; i += max) lines.push(w.slice(i, i + max));
        cur = "";
      } else cur = w;
    } else cur = (cur ? cur + " " : "") + w;
  }
  if (cur) lines.push(cur);
  // จำกัดจำนวนบรรทัดกันป้ายซ้อนกันในกราฟ — ข้อความเต็มดูได้จาก tooltip/ตาราง
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].slice(0, max - 1) + "…";
    return kept;
  }
  return lines;
}

/** ป้ายแกนกราฟแบบบรรทัดเดียว ตัดด้วย … ให้พอดีงบพิกเซลจริง
    — วัดด้วย canvas ฟอนต์เดียวกับที่ Chart.js ใช้วาด จึงไม่มีทางล้น/จมเข้าไปในแท่ง
    ไม่ว่าฟอนต์ของแต่ละเครื่องจะวัดข้อความไทยกว้างแค่ไหน (ข้อความเต็มอยู่ใน tooltip) */
const LABEL_PX = 168;
let _measureCtx = null;
function shortLabel(s, maxPx = LABEL_PX) {
  s = String(s).replace(/\s+/g, " ").trim();
  if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d");
  _measureCtx.font = `11.5px ${FONT_STACK}`;
  if (_measureCtx.measureText(s).width <= maxPx) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (_measureCtx.measureText(s.slice(0, mid) + "…").width <= maxPx) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + "…";
}

/** งบพิกเซลของป้ายแกน Y แปรตามความกว้างกราฟจริง — จอกว้างป้ายยาวขึ้น ไม่โดนตัดสั้นเกินจำเป็น */
function dynLabelPx(chart) {
  const w = chart?.width || 700;
  return Math.max(LABEL_PX, Math.min(w * 0.4, 360));
}

/** บังคับความกว้างขั้นต่ำของแกน Y ให้ครอบคลุมงบป้าย — กันการวัดที่คลาดของบางเครื่อง */
function yAxisFloor(scale) {
  if (scale.axis === "y") {
    scale.width = Math.max(scale.width, Math.min(scale.chart.width * 0.5, dynLabelPx(scale.chart) + 24));
  }
}

/** plugin: เขียนตัวเลขที่ปลายแท่ง (แนวนอน) */
const endLabelPlugin = {
  id: "endLabel",
  afterDatasetsDraw(chart, _a, opts) {
    if (!opts || !opts.labels) return;
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    ctx.save();
    ctx.fillStyle = opts.color;
    ctx.font = `600 12px ${FONT_STACK}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    meta.data.forEach((bar, i) => {
      const label = opts.labels[i];
      const raw = chart.data.datasets[0].data[i];
      // ไม่วาดป้ายของแท่งที่ไม่มีข้อมูล — กันตัวเลขลอยไปกองที่แกน
      if (label == null || label === "-" || !Number.isFinite(raw) || !Number.isFinite(bar.x)) return;
      ctx.fillText(label, bar.x + 6, bar.y);
    });
    ctx.restore();
  },
};

/** plugin: เส้นประแนวตั้งแสดงเกณฑ์ความสำเร็จ (เช่น 3.51) ในกราฟแท่งแนวนอน */
const passLinePlugin = {
  id: "passLine",
  afterDatasetsDraw(chart, _a, opts) {
    if (!opts || !Number.isFinite(opts.x)) return;
    const xs = chart.scales.x, area = chart.chartArea;
    if (!xs || !area) return;
    const px = xs.getPixelForValue(opts.x);
    if (!Number.isFinite(px)) return;
    const { ctx } = chart;
    ctx.save();
    ctx.strokeStyle = opts.color || "#c2410c";
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(px, area.top); ctx.lineTo(px, area.bottom); ctx.stroke();
    ctx.setLineDash([]);
    if (opts.label) {
      ctx.font = `600 10.5px ${FONT_STACK}`;
      ctx.fillStyle = opts.color || "#c2410c";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(opts.label, px, area.top - 3);
    }
    ctx.restore();
  },
};

/** สร้าง config กราฟแท่งแนวนอนของค่าเฉลี่ย (0–5) */
function cfgMeanBar(labels, means, t, title, opts = {}) {
  return {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: means,
        backgroundColor: t.series,
        borderRadius: 4, borderSkipped: "start",
        barThickness: 18, maxBarThickness: 20,
      }],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { right: 52, top: opts.passLine ? 16 : 0 } },
      plugins: {
        legend: { display: false },
        title: title ? { display: true, text: title, color: t.text, font: { family: FONT_STACK, size: 13, weight: "600" } } : { display: false },
        tooltip: {
          callbacks: {
            title: (items) => wrapLabel(labels[items[0].dataIndex], 44, 8),
            label: (c) => ` ค่าเฉลี่ย ${f2(c.parsed.x)}`,
          },
        },
        endLabel: { color: t.text, labels: means.map(f2) },
        passLine: opts.passLine ? { x: opts.passLine, label: opts.passLabel || "", color: "#c2410c" } : false,
      },
      scales: {
        x: { min: 0, max: 5, grid: { color: t.grid }, border: { color: t.axis }, ticks: { stepSize: 1, color: t.muted, font: { family: FONT_STACK, size: 11 } } },
        y: { afterFit: yAxisFloor, grid: { display: false }, border: { color: t.axis }, ticks: { color: t.secondary, font: { family: FONT_STACK, size: 11.5 }, autoSkip: false, callback(v) { return shortLabel(this.getLabelForValue(v), dynLabelPx(this.chart)); } } },
      },
    },
    plugins: [endLabelPlugin, passLinePlugin],
  };
}

const LIKERT_LABELS = ["มากที่สุด (5)", "มาก (4)", "ปานกลาง (3)", "น้อย (2)", "ควรปรับปรุง (1)"];

/** plugin: ตัวเลขใหญ่กลางวงโดนัท */
const centerTextPlugin = {
  id: "centerText",
  afterDraw(chart) {
    const o = chart.options.plugins.centerText;
    if (!o) return;
    const m = chart.getDatasetMeta(0).data[0];
    if (!m) return;
    const { ctx } = chart;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 27px ${FONT_STACK}`;
    ctx.fillStyle = o.color;
    ctx.fillText(o.value, m.x, m.y - 9);
    ctx.font = `600 11.5px ${FONT_STACK}`;
    ctx.fillStyle = o.sub;
    ctx.fillText(o.label, m.x, m.y + 15);
    ctx.restore();
  },
};

/** โดนัทการกระจายระดับคะแนนรวม (ตัวเลขค่าเฉลี่ยอยู่กลางวง) */
function cfgDonut(stats, t) {
  const data = [5, 4, 3, 2, 1].map((lv) => stats.freq[lv]);
  return {
    type: "doughnut",
    data: {
      labels: LIKERT_LABELS,
      datasets: [{ data, backgroundColor: t.likert, borderColor: t.surface, borderWidth: 2, hoverOffset: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, cutout: "68%",
      plugins: {
        legend: { position: "right", labels: { color: t.secondary, boxWidth: 11, boxHeight: 11, padding: 10, font: { family: FONT_STACK, size: 11.5 } } },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.parsed} คำตอบ (${stats.n ? ((c.parsed / stats.n) * 100).toFixed(1) : "0.0"}%)` } },
        centerText: { value: f2(stats.mean), label: "ค่าเฉลี่ยรวม", color: t.text, sub: t.muted },
      },
    },
    plugins: [centerTextPlugin],
  };
}

/** สร้าง config กราฟแท่งซ้อนร้อยละของการกระจายคะแนน */
function cfgLikert(items, t, title) {
  const levels = [5, 4, 3, 2, 1];
  const datasets = levels.map((lv, k) => ({
    label: LIKERT_LABELS[k],
    data: items.map((it) => (it.stats.n ? (it.stats.freq[lv] / it.stats.n) * 100 : 0)),
    _counts: items.map((it) => it.stats.freq[lv]),
    backgroundColor: t.likert[k],
    borderColor: t.surface, borderWidth: 1.5,
    barThickness: 20, maxBarThickness: 22,
  }));
  return {
    type: "bar",
    data: { labels: items.map((it) => it.label), datasets },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { position: "bottom", labels: { color: t.secondary, boxWidth: 12, boxHeight: 12, font: { family: FONT_STACK, size: 11.5 } } },
        title: title ? { display: true, text: title, color: t.text, font: { family: FONT_STACK, size: 13, weight: "600" } } : { display: false },
        tooltip: {
          callbacks: {
            title: (tItems) => wrapLabel(items[tItems[0].dataIndex].label, 44, 8),
            label: (c) => ` ${c.dataset.label}: ${c.dataset._counts[c.dataIndex]} คน (${c.parsed.x.toFixed(1)}%)`,
          },
        },
      },
      scales: {
        x: { stacked: true, min: 0, max: 100, grid: { color: t.grid }, border: { color: t.axis }, ticks: { color: t.muted, callback: (v) => v + "%", font: { family: FONT_STACK, size: 11 } } },
        y: { stacked: true, afterFit: yAxisFloor, grid: { display: false }, border: { color: t.axis }, ticks: { color: t.secondary, font: { family: FONT_STACK, size: 11.5 }, autoSkip: false, callback(v) { return shortLabel(this.getLabelForValue(v), dynLabelPx(this.chart)); } } },
      },
    },
  };
}

/** กราฟแท่งแนวนอนของจำนวน/ร้อยละ (ข้อมูลทั่วไป, SDG) */
function cfgCountBar(labels, values, t, { max = null, suffix = "", endLabels = null, title = null, tooltipTitles = null } = {}) {
  return {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: values, backgroundColor: t.series,
        borderRadius: 4, borderSkipped: "start", barThickness: 18, maxBarThickness: 20,
      }],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { right: 88 } },
      plugins: {
        legend: { display: false },
        title: title ? { display: true, text: title, color: t.text, font: { family: FONT_STACK, size: 13, weight: "600" } } : { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const i = items[0].dataIndex;
              const full = tooltipTitles ? tooltipTitles[i] : labels[i];
              return wrapLabel(full, 44, 8);
            },
            label: (c) => ` ${c.parsed.x}${suffix}`,
          },
        },
        endLabel: { color: t.text, labels: endLabels },
      },
      scales: {
        x: { min: 0, ...(max ? { max } : {}), grid: { color: t.grid }, border: { color: t.axis }, ticks: { color: t.muted, font: { family: FONT_STACK, size: 11 }, precision: 0, callback: (v) => v + suffix } },
        y: { afterFit: yAxisFloor, grid: { display: false }, border: { color: t.axis }, ticks: { color: t.secondary, font: { family: FONT_STACK, size: 11.5 }, autoSkip: false, callback(v) { return shortLabel(this.getLabelForValue(v), dynLabelPx(this.chart)); } } },
      },
    },
    plugins: [endLabelPlugin],
  };
}

/** วาดกราฟลง canvas ในหน้า (เก็บ instance ไว้ทำลายตอนสลับแท็บ) */
function mountChart(container, cfg, height) {
  const box = document.createElement("div");
  box.className = "chart-box";
  box.style.height = height + "px";
  const canvas = document.createElement("canvas");
  box.appendChild(canvas);
  container.appendChild(box);
  const chart = new Chart(canvas, cfg);
  state.charts.push(chart);
  return chart;
}

/** สร้างภาพ PNG (พื้นขาว สำหรับรายงาน/คัดลอก) จาก config */
function chartToDataURL(cfg, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.style.width = width + "px"; canvas.style.height = height + "px";
  const whiteBg = { id: "whiteBg", beforeDraw(c) { const { ctx } = c; ctx.save(); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); ctx.restore(); } };
  const chart = new Chart(canvas, {
    ...cfg,
    options: { ...cfg.options, responsive: false, animation: false, devicePixelRatio: 2 },
    plugins: [...(cfg.plugins || []), whiteBg],
  });
  const url = canvas.toDataURL("image/png");
  chart.destroy();
  return url;
}

async function copyChartPNG(cfg, width, height) {
  try {
    const url = chartToDataURL(cfg, width, height);
    const blob = await (await fetch(url)).blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast("คัดลอกกราฟเป็นรูปภาพแล้ว ✓");
  } catch (err) {
    console.error(err);
    toast("คัดลอกรูปไม่สำเร็จ — เบราว์เซอร์อาจไม่รองรับ");
  }
}

/* ============================================================
   แถบกรอง + แท็บ
   ============================================================ */
function renderFilterBar() {
  const bar = $("#filterBar");
  bar.innerHTML = "";
  if (!state.filterCols.length) return;
  state.filterCols.forEach((colIdx) => {
    const col = state.columns[colIdx];
    const { entries, total } = catFreq(state.rows, colIdx);
    if (!entries.length) return;
    const row = document.createElement("div");
    row.className = "filter-row";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = (col.header === "ชุดแบบประเมิน" ? "ชุดแบบประเมิน:" : "กรองตามผู้ตอบ:");
    row.appendChild(label);
    const mk = (text, val) => {
      const b = document.createElement("button");
      b.className = "chip" + ((state.filterSel[colIdx] ?? null) === val ? " active" : "");
      b.textContent = text;
      b.title = text;
      b.onclick = () => { state.filterSel[colIdx] = val; renderFilterBar(); renderActiveTab(); };
      row.appendChild(b);
    };
    mk(`ทั้งหมด (${total})`, null);
    entries.forEach((e) => mk(`${e.label.length > 26 ? e.label.slice(0, 26) + "…" : e.label} (${e.n})`, e.label));
    bar.appendChild(row);
  });
}

/** กลับหน้าแรก (ก่อนเปิดไฟล์) — คลิกโลโก้ */
function goHome() {
  $("#workspace").classList.add("hidden");
  $("#emptyState").classList.remove("hidden");
  $("#fileInfo").classList.add("hidden");
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === "dashboard"));
  state.activeTab = "dashboard";
  renderHistoryHome();
  const es = $("#emptyState");
  es.classList.remove("anim-page"); void es.offsetWidth; es.classList.add("anim-page");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function switchTab(name) {
  const noData = !state.rows || !state.rows.length;
  // ยังไม่มีข้อมูล: เปิดได้เฉพาะคู่มือ — แท็บอื่นพากลับหน้าแรก
  if (noData && name !== "guide") { goHome(); return; }
  state.activeTab = name;
  state._justSwitched = true;
  if (!$("#emptyState").classList.contains("hidden")) {
    $("#emptyState").classList.add("hidden");
    $("#workspace").classList.remove("hidden");
    if (!noData) $("#fileInfo").classList.remove("hidden");
  }
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== "panel-" + name));
  renderActiveTab();
}

function renderActiveTab() {
  state.charts.forEach((c) => c.destroy());
  state.charts = [];
  const rows = filteredRows();
  const panel = $("#panel-" + state.activeTab);
  panel.innerHTML = "";
  const render = {
    dashboard: renderDashboard, sections: renderSections, sdg: renderSdg,
    demo: renderDemographics, text: renderTexts, columns: renderColumns,
    health: renderHealth, report: renderReport, history: renderHistory, guide: renderGuide,
  }[state.activeTab];
  render(panel, rows);
  panel.classList.remove("anim-page");
  if (state._justSwitched) { void panel.offsetWidth; panel.classList.add("anim-page"); state._justSwitched = false; }
  refreshIcons();
}

/* ============================================================
   แท็บ: แดชบอร์ด
   ============================================================ */
function renderDashboard(panel, rows) {
  const t = themeVars();
  reviewBanner(panel);
  const overall = overallRatingStats(rows);
  const groups = ratingGroups(rows);

  // แถบฮีโร่ภาพรวม — สรุปหัวใจของผลประเมินก่อนลงลึก (อัตราตอบกลับแก้ตัวเลขเป้าหมายได้)
  const totalResp = state.rows.length;
  const respPct = state.respTarget ? Math.min((totalResp / state.respTarget) * 100, 999) : null;
  const heroBars = groups.slice(0, 6).map((g) => `
    <div class="hb-row" title="${esc(g.name)} — x̄ ${f2(g.total.mean)}">
      <span class="hb-name">${esc(shortLabel(g.name, 150))}</span>
      <span class="hb-track"><i style="width:${Number.isFinite(g.total.mean) ? (g.total.mean / 5) * 100 : 0}%"></i></span>
      <span class="hb-val">${f2(g.total.mean)}</span>
    </div>`).join("");
  const hero = document.createElement("div");
  hero.className = "hero-band";
  hero.innerHTML = `
    <div class="hero-left">
      <div class="hero-label"><i data-lucide="sparkles"></i> ผลการประเมินโดยรวม${activeFilterText() ? ` · ${esc(activeFilterText())}` : ""}</div>
      <div class="hero-score">${f2(overall.mean)}<span class="hero-outof">/ 5</span></div>
      <div class="hero-meta">${levelChip(overall.mean)}<span>S.D. ${f2(overall.sd)}</span><span>ผู้ตอบ ${rows.length} คน · ${overall.n} คำตอบ</span></div>
      <div class="hero-resp">
        อัตราการตอบกลับ <b>${respPct != null ? respPct.toFixed(2) + "%" : "— %"}</b>
        · ตอบ ${totalResp} จากเป้าหมาย
        <input id="respTarget" type="number" min="1" placeholder="ระบุ" value="${state.respTarget ?? ""}"> คน
      </div>
    </div>
    <div class="hero-right">${heroBars || `<div class="hb-empty">ยังไม่มีคำถามแบบคะแนนให้สรุป</div>`}</div>`;
  panel.appendChild(hero);
  $("#respTarget", hero).onchange = (e) => {
    const v = parseInt(e.target.value, 10);
    state.respTarget = Number.isFinite(v) && v > 0 ? v : null;
    saveSessionSnapshot();
    renderActiveTab();
  };

  // กลุ่มที่กรองไม่มีคำตอบแบบคะแนนเลย — แจ้งชัด ๆ แทนที่จะปล่อยตัวเลขว่าง
  if (!overall.n) {
    const note = document.createElement("div");
    note.className = "card";
    note.innerHTML = `<h3><i data-lucide="info"></i> ไม่มีคำตอบแบบคะแนน${activeFilterText() ? `ในกลุ่ม "${esc(activeFilterText())}"` : "ในไฟล์นี้"}</h3>
      <p class="card-sub" style="margin:6px 0 0">กลุ่มผู้ตอบนี้อาจไม่ได้รับชุดคำถามแบบคะแนน 1–5 — ลองดูแท็บ "ข้อมูลผู้ตอบ" หรือ "ข้อเสนอแนะ" หรือเปลี่ยนตัวกรองด้านบน</p>`;
    panel.appendChild(note);
  }

  // โดนัทการกระจายคะแนน + สรุปใจความสำคัญ อ่านจบใน 10 วินาที
  if (groups.length) {
    const sortedG = [...groups].sort((a, b) => b.total.mean - a.total.mean);
    const best = sortedG[0], worst = sortedG[sortedG.length - 1];
    const sdgs = sdgResults(rows);
    const okSdg = sdgs.filter((s) => s.pct >= 50);

    const grid0 = document.createElement("div");
    grid0.className = "grid-2";
    panel.appendChild(grid0);

    const dCard = cardEl(grid0, "การกระจายระดับคะแนน", `รวมทุกคำถามแบบคะแนน (${overall.n} คำตอบ)`);
    addCopyChartBtn(dCard, () => cfgDonut(overall, themeVars(true)), 640, 340);
    mountChart(dCard, cfgDonut(overall, t), 218);

    const sum = cardEl(grid0, "สรุปภาพรวม", null, "pin");
    sum.insertAdjacentHTML("beforeend", `
      <div class="sum-row"><span>ผลการประเมินโดยรวม</span><b>${levelChip(overall.mean)} <span class="num">x̄ ${f2(overall.mean)}</span></b></div>
      <div class="sum-row"><span>ด้านที่ได้คะแนนสูงสุด</span><b title="${esc(best.name)}">${esc(best.name.length > 30 ? best.name.slice(0, 30) + "…" : best.name)} <span class="num" style="color:var(--good)">${f2(best.total.mean)}</span></b></div>
      ${groups.length > 1 ? `<div class="sum-row"><span>ด้านที่ควรพัฒนา</span><b title="${esc(worst.name)}">${esc(worst.name.length > 30 ? worst.name.slice(0, 30) + "…" : worst.name)} <span class="num" style="color:var(--lk1)">${f2(worst.total.mean)}</span></b></div>` : ""}
      ${sdgs.length ? `<div class="sum-row"><span>ความสอดคล้อง SDGs</span><b>${okSdg.length} จาก ${sdgs.length} เป้าหมาย</b></div>
      <div class="sdg-mini">${okSdg.filter((s) => s.icon).map((s) => `<img src="${s.icon}" alt="${esc(s.short)}" title="${esc(s.short)} · ${esc(s.name || "")} — ${s.pct.toFixed(1)}%">`).join("")}</div>` : ""}`);
  }

  if (groups.length) {
    const card = cardEl(panel, "ค่าเฉลี่ยรายด้าน", "เปรียบเทียบค่าเฉลี่ยของแต่ละด้าน/หมวดคำถาม (คะแนนเต็ม 5)");
    const labels = groups.map((g) => g.name);
    const means = groups.map((g) => g.total.mean);
    const cfg = cfgMeanBar(labels, means, t);
    addCopyChartBtn(card, () => cfgMeanBar(labels, means, themeVars(true)), 900, Math.max(200, labels.length * 54 + 70));
    mountChart(card, cfg, Math.max(170, labels.length * 54 + 40));
  }

  // แผนที่ความถี่ (heatmap) — จำนวนผู้ตอบแต่ละระดับคะแนน รายข้อ สีเข้ม = คนมาก
  if (groups.length) {
    const hm = cardEl(panel, "แผนที่ความถี่ของคะแนน", "สีเข้ม = ผู้ตอบมาก — ชี้ที่ช่องเพื่อดูจำนวนและร้อยละ", "grid-3x3");
    // ramp มรกต อ่อน→เข้ม (เน้นความสวยเข้าธีม ตัวเลขดูจาก tooltip)
    const seq = ["#dbe6f5", "#b6cdec", "#8fb2e0", "#5f8fd2", "#3a6dbd", "#1f4f9e", "#123c78"];
    let maxN = 1;
    groups.forEach((g) => g.items.forEach((it) => [5, 4, 3, 2, 1].forEach((lv) => { maxN = Math.max(maxN, it.stats.freq[lv]); })));
    const body = groups.map((g) => {
      const items = g.items.filter((it) => it.stats.n > 0);
      if (!items.length) return "";
      return `<div class="hm-group">${esc(g.name)}</div>` + items.map((it) => `
        <div class="hm-row">
          <span class="hm-name" title="${esc(it.label)}">${esc(it.label)}</span>
          ${[5, 4, 3, 2, 1].map((lv) => {
            const n = it.stats.freq[lv];
            const ci = n === 0 ? -1 : Math.min(seq.length - 1, Math.round((n / maxN) * (seq.length - 1)));
            const glow = ci >= 5 ? `;box-shadow:0 0 14px ${seq[ci]}66` : "";
            const style = ci < 0 ? "" : `background:${seq[ci]};border-color:transparent${glow}`;
            const pct = it.stats.n ? ((n / it.stats.n) * 100).toFixed(1) : "0.0";
            return `<span class="hm-cell" style="${style}" title="${esc(it.label)}\nคะแนน ${lv}: ${n} คน (${pct}%)"></span>`;
          }).join("")}
        </div>`).join("");
    }).join("");
    hm.insertAdjacentHTML("beforeend", `
      <div class="hm-wrap">
        <div class="hm-row hm-head"><span class="hm-name"></span>${[5, 4, 3, 2, 1].map((lv) => `<span class="hm-col">${lv}</span>`).join("")}</div>
        ${body}
      </div>
      <div class="hm-legend"><span>ระดับคะแนน 5 = มากที่สุด … 1 = ควรปรับปรุง</span><span class="hm-scale-wrap">น้อย <span class="hm-scale"></span> มาก</span></div>`);
  }

  const grid = document.createElement("div");
  grid.className = "grid-2";
  panel.appendChild(grid);

  if (state.statusColIdx >= 0 && !activeFilterText()) {
    const { entries } = catFreq(rows, state.statusColIdx);
    const card = cardEl(grid, "ผู้ตอบแบบสอบถามจำแนกตามสถานะ", "จำนวน (ร้อยละ)");
    const cfg = cfgCountBar(entries.map((e) => e.label), entries.map((e) => e.n), t,
      { endLabels: entries.map((e) => `${e.n} (${e.pct.toFixed(1)}%)`) });
    addCopyChartBtn(card, () => cfgCountBar(entries.map((e) => e.label), entries.map((e) => e.n), themeVars(true), { endLabels: entries.map((x) => `${x.n} (${x.pct.toFixed(1)}%)`) }), 900, Math.max(200, entries.length * 46 + 70));
    mountChart(card, cfg, Math.max(160, entries.length * 46 + 30));
  }

  // ข้อที่เด่นสุด/ควรพัฒนา
  const allItems = groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.name }))).filter((it) => it.stats.n > 0);
  if (allItems.length >= 2) {
    const sorted = [...allItems].sort((a, b) => b.stats.mean - a.stats.mean);
    const top = sorted.slice(0, 3);
    const bottom = sorted.slice(-3).reverse();
    const card = cardEl(grid, "ข้อเด่น & ข้อควรพัฒนา", "3 อันดับค่าเฉลี่ยสูงสุดและต่ำสุด");
    card.insertAdjacentHTML("beforeend", `
      <div class="tbl-wrap"><table class="app">
        <tr><th class="item">สูงสุด</th><th>x̄</th></tr>
        ${top.map((it) => `<tr><td class="item">${esc(it.label)}</td><td class="num"><b style="color:var(--good)">${f2(it.stats.mean)}</b> ${levelChip(it.stats.mean)}</td></tr>`).join("")}
        <tr><th class="item">ต่ำสุด</th><th>x̄</th></tr>
        ${bottom.map((it) => `<tr><td class="item">${esc(it.label)}</td><td class="num"><b style="color:var(--lk1)">${f2(it.stats.mean)}</b> ${levelChip(it.stats.mean)}</td></tr>`).join("")}
      </table></div>`);
  }
}

function cardEl(parent, title, sub, icon) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<div class="card-head"><div><h3>${icon ? `<i data-lucide="${icon}"></i> ` : ""}${esc(title)}</h3>${sub ? `<p class="card-sub">${esc(sub)}</p>` : ""}</div><div class="card-actions"></div></div>`;
  parent.appendChild(card);
  return card;
}

/** แปลง <i data-lucide> ที่เพิ่งสร้างให้กลายเป็นไอคอน SVG */
function refreshIcons() {
  if (window.lucide) lucide.createIcons();
}

function addCopyChartBtn(card, cfgFactory, w, h) {
  const btn = document.createElement("button");
  btn.className = "btn small";
  btn.innerHTML = `<i data-lucide="image"></i> คัดลอกกราฟ`;
  btn.onclick = () => copyChartPNG(cfgFactory(), w, h);
  $(".card-actions", card).appendChild(btn);
}

/* ============================================================
   แท็บ: ผลรายด้าน
   ============================================================ */
function renderSections(panel, rows) {
  const t = themeVars();
  const groups = ratingGroups(rows);
  if (!groups.length) {
    panel.innerHTML = `<div class="card">ไม่พบคำถามแบบคะแนน 1–5 ในไฟล์นี้ — ตรวจสอบได้ที่แท็บ "ตั้งค่าคอลัมน์"</div>`;
    return;
  }
  // สวิตช์แสดงความถี่รายระดับ (ค่าเริ่มต้นซ่อนไว้ให้ตารางอ่านง่าย)
  const ctrl = document.createElement("div");
  ctrl.className = "report-controls";
  ctrl.innerHTML = `<label class="ck"><input type="checkbox" id="ckShowFreq" ${state.ui.showFreq ? "checked" : ""}> แสดงจำนวน/ร้อยละของแต่ละระดับคะแนน (5–1) ในตาราง</label>`;
  panel.appendChild(ctrl);
  $("#ckShowFreq", ctrl).onchange = (e) => { state.ui.showFreq = e.target.checked; renderActiveTab(); };

  groups.forEach((g) => {
    // แสดงเฉพาะข้อที่มีผู้ตอบจริง — ฟอร์มแยกเส้นทางทำให้บางข้อไม่มีคำตอบในบางกลุ่ม
    const items = g.items.filter((it) => it.stats.n > 0);
    const hidden = g.items.length - items.length;
    const card = cardEl(panel, g.name,
      `ผู้ตอบ ${Math.max(...items.map((it) => it.stats.n))} คน · ค่าเฉลี่ยรวม ${f2(g.total.mean)} (${levelLabel(g.total.mean)})` +
      (hidden ? ` · ซ่อน ${hidden} ข้อที่ไม่มีผู้ตอบ${activeFilterText() ? "ในกลุ่มนี้" : ""}` : ""));

    // ตาราง — เรียงเอาผลสำคัญ (x̄ / S.D. / ระดับ) ไว้ก่อน ความถี่เป็นส่วนเสริม
    const showFreq = state.ui.showFreq;
    const freqHead = showFreq ? `<th>5</th><th>4</th><th>3</th><th>2</th><th>1</th>` : "";
    const rowsHtml = items.map((it) => {
      const s = it.stats;
      const freqCells = showFreq ? [5, 4, 3, 2, 1].map((lv) => {
        const p = s.n ? ((s.freq[lv] / s.n) * 100).toFixed(1) : "0.0";
        return `<td class="num">${s.freq[lv]}<br><span class="sugg-count">(${p}%)</span></td>`;
      }).join("") : "";
      return `<tr><td class="item">${esc(it.label)}</td><td class="num">${s.n}</td><td class="num"><b>${f2(s.mean)}</b>${meanBar(s.mean)}</td><td class="num">${f2(s.sd)}</td><td>${levelChip(s.mean)}</td>${freqCells}</tr>`;
    }).join("");
    card.insertAdjacentHTML("beforeend", `
      <div class="tbl-wrap"><table class="app">
        <tr><th class="item">รายการประเมิน</th><th>ผู้ตอบ</th><th>x̄</th><th>S.D.</th><th>ระดับ</th>${freqHead}</tr>
        ${rowsHtml}
        <tr class="total"><td class="item">รวม</td><td></td><td class="num">${f2(g.total.mean)}</td><td class="num">${f2(g.total.sd)}</td><td>${levelChip(g.total.mean)}</td>${showFreq ? `<td colspan="5"></td>` : ""}</tr>
      </table></div>`);

    // กราฟค่าเฉลี่ย + กราฟการกระจาย
    const grid = document.createElement("div");
    grid.className = "grid-2";
    card.appendChild(grid);

    const c1 = document.createElement("div");
    const c2 = document.createElement("div");
    grid.appendChild(c1); grid.appendChild(c2);

    const labels = items.map((it) => it.label);
    const means = items.map((it) => it.stats.mean);
    const h = Math.max(180, items.length * 58 + 40);
    mountChart(c1, cfgMeanBar(labels, means, t, "ค่าเฉลี่ยรายข้อ"), h);
    mountChart(c2, cfgLikert(items, t, "การกระจายของระดับคะแนน (%)"), h + 50);

    addCopyChartBtn(card, () => cfgMeanBar(labels, means, themeVars(true), g.name + " — ค่าเฉลี่ยรายข้อ"), 900, Math.max(220, items.length * 58 + 80));
    const btn2 = document.createElement("button");
    btn2.className = "btn small";
    btn2.innerHTML = `<i data-lucide="image"></i> คัดลอกกราฟการกระจาย`;
    btn2.onclick = () => copyChartPNG(cfgLikert(items, themeVars(true), g.name + " — การกระจายของระดับคะแนน (%)"), 900, Math.max(260, items.length * 58 + 120));
    $(".card-actions", card).appendChild(btn2);

    // แก้ชื่อด้านเองได้ — มีผลทั้งเว็บและรายงาน และถูกจำไว้ในประวัติ
    const btnRen = document.createElement("button");
    btnRen.className = "btn small";
    btnRen.title = "แก้ชื่อด้านนี้";
    btnRen.innerHTML = `<i data-lucide="pencil"></i>`;
    btnRen.onclick = () => {
      const name = prompt("ตั้งชื่อด้าน/หมวดคำถามนี้ (ใช้ในทุกหน้าและในรายงานราชการ)", g.name);
      if (!name || !name.trim() || name.trim() === g.name) return;
      state.columns.forEach((c) => { if (c.type === "rating" && c.group === g.name) c.group = name.trim(); });
      bumpDataVersion();
      saveSessionSnapshot();
      renderActiveTab();
      toast("เปลี่ยนชื่อด้านแล้ว");
    };
    $(".card-actions", card).appendChild(btnRen);
  });
}

/* ============================================================
   แท็บ: SDGs
   ============================================================ */
function renderSdg(panel, rows) {
  const t = themeVars();
  const sdgs = sdgResults(rows);
  if (!sdgs.length) {
    panel.innerHTML = `<div class="card">ไม่พบคำถามความสอดคล้อง SDGs (คำตอบแบบ "สอดคล้อง / บรรลุ" – "ไม่สอดคล้อง") ในไฟล์นี้</div>`;
    return;
  }
  // การ์ดพร้อมโลโก้ทางการจาก sdgs.un.org
  const grid = document.createElement("div");
  grid.className = "sdg-grid";
  grid.innerHTML = sdgs.map((s) => {
    const ok = s.pct >= 50;
    const displayName = s.name ? `${s.short} · ${s.name}` : s.header.slice(0, 60);
    return `<div class="sdg-card ${ok ? "" : "no"}" title="${esc(s.header)}">
      ${s.icon ? `<img src="${s.icon}" alt="${esc(s.short)}" loading="lazy">` : ""}
      <div class="sdg-body">
        <div class="sdg-pct">${s.pct.toFixed(1)}% <span class="lv ${ok ? "l5" : "l1"}"><i data-lucide="${ok ? "check" : "x"}"></i> ${ok ? "สอดคล้อง" : "ไม่สอดคล้อง"}</span></div>
        <div class="sdg-name">${esc(displayName)}</div>
        <div class="sdg-bar"><i style="width:${s.pct}%"></i></div>
        <div class="sdg-n">${s.agree} จาก ${s.n} คน เห็นว่าสอดคล้อง/บรรลุ</div>
      </div>
    </div>`;
  }).join("");
  panel.appendChild(grid);

  const card = cardEl(panel, "ตารางสรุปและแผนภูมิ", "ร้อยละของผู้ตอบที่เห็นว่าโครงการสอดคล้อง/บรรลุแต่ละเป้าหมาย (เกณฑ์สอดคล้อง ≥ 50%)");
  card.insertAdjacentHTML("beforeend", `
    <div class="tbl-wrap"><table class="app">
      <tr><th class="item">เป้าหมาย</th><th>สอดคล้อง / บรรลุ<br>(คน)</th><th>ไม่สอดคล้อง<br>(คน)</th><th>ร้อยละที่สอดคล้อง</th><th>สรุปผล</th></tr>
      ${sdgs.map((s) => `<tr><td class="item">${esc(s.header)}</td><td class="num">${s.agree}</td><td class="num">${s.disagree}</td><td class="num"><b>${s.pct.toFixed(2)}</b></td><td><span class="lv ${s.pct >= 50 ? "l5" : "l1"}">${s.pct >= 50 ? "สอดคล้อง" : "ไม่สอดคล้อง"}</span></td></tr>`).join("")}
    </table></div>`);
  const sdgChartOpts = (paper) => cfgCountBar(
    sdgs.map((s) => s.label),
    sdgs.map((s) => +s.pct.toFixed(1)),
    themeVars(paper),
    {
      max: 100, suffix: "%",
      endLabels: sdgs.map((s) => s.pct.toFixed(1) + "%"),
      tooltipTitles: sdgs.map((s) => s.header),
      title: paper ? "ร้อยละความสอดคล้องกับ SDGs" : null,
    }
  );
  addCopyChartBtn(card, () => sdgChartOpts(true), 900, Math.max(220, sdgs.length * 52 + 80));
  mountChart(card, sdgChartOpts(false), Math.max(170, sdgs.length * 52 + 40));
}

/* ============================================================
   แท็บ: ข้อมูลผู้ตอบ (categorical)
   ============================================================ */
function renderDemographics(panel, rows) {
  const t = themeVars();
  const cols = state.columns.filter((c) => c.type === "categorical" && !c.mergeInto);
  if (!cols.length) {
    panel.innerHTML = `<div class="card">ไม่พบคอลัมน์ข้อมูลทั่วไปแบบตัวเลือก</div>`;
    return;
  }
  const grid = document.createElement("div");
  grid.className = "grid-2";
  panel.appendChild(grid);
  cols.forEach((c) => {
    const { entries, total } = catFreq(rows, c.i);
    if (!entries.length) return;
    const card = cardEl(grid, c.header, `ผู้ตอบ ${total} คน`);
    card.insertAdjacentHTML("beforeend", `
      <div class="tbl-wrap"><table class="app">
        <tr><th class="item">ตัวเลือก</th><th>จำนวน (คน)</th><th>ร้อยละ</th></tr>
        ${entries.map((e) => `<tr><td class="item">${esc(e.label)}</td><td class="num">${e.n}</td><td class="num">${e.pct.toFixed(2)}</td></tr>`).join("")}
        <tr class="total"><td class="item">รวม</td><td class="num">${total}</td><td class="num">100.00</td></tr>
      </table></div>`);
    addCopyChartBtn(card, () => cfgCountBar(entries.map((e) => e.label), entries.map((e) => e.n), themeVars(true), { endLabels: entries.map((x) => `${x.n} (${x.pct.toFixed(1)}%)`), title: c.header }), 900, Math.max(200, entries.length * 42 + 80));
    mountChart(card, cfgCountBar(entries.map((e) => e.label), entries.map((e) => e.n), t, { endLabels: entries.map((e) => `${e.n} (${e.pct.toFixed(1)}%)`) }), Math.max(140, entries.length * 42 + 30));
  });
}

/* ============================================================
   แท็บ: ข้อเสนอแนะ (text)
   ============================================================ */
function renderTexts(panel, rows) {
  const cols = state.columns.filter((c) => c.type === "text");
  if (!cols.length) {
    panel.innerHTML = `<div class="card">ไม่พบคอลัมน์คำตอบปลายเปิด</div>`;
    return;
  }
  cols.forEach((c) => {
    const answers = textAnswers(rows, c.i);
    const card = cardEl(panel, c.header, `มีผู้ตอบ ${answers.reduce((a, x) => a + x.n, 0)} คน (${answers.length} ข้อความไม่ซ้ำ)`);
    card.insertAdjacentHTML("beforeend", answers.length
      ? `<ul class="sugg">${answers.map((a) => `<li>${esc(a.text)}${a.n > 1 ? ` <span class="sugg-count">(×${a.n})</span>` : ""}</li>`).join("")}</ul>`
      : `<p class="card-sub">— ไม่มีผู้ตอบ —</p>`);
  });
}

/* ============================================================
   แท็บ: ตั้งค่าคอลัมน์
   ============================================================ */
const TYPE_LABELS = {
  rating: "คะแนน 1–5", sdg: "SDG / สองค่า", categorical: "ตัวเลือก / หมวดหมู่ (นับความถี่)",
  text: "ข้อความปลายเปิด", ignore: "ไม่วิเคราะห์",
};
function renderColumns(panel) {
  mappingConfirmCard(panel);
  const card = cardEl(panel, "ชนิดของแต่ละคอลัมน์และการจัดด้าน", "เปลี่ยนชนิดข้อมูลหรือย้ายข้อคำถามไปด้านไหนก็ได้ — เลือก \"สร้างด้านใหม่…\" เพื่อตั้งด้านเอง แล้วผลวิเคราะห์ทุกแท็บจะคำนวณใหม่ทันที");
  const N = state.rows.length;
  const groupNames = [...new Set(state.columns.filter((c) => c.type === "rating" && c.group).map((c) => c.group))];
  const rowsHtml = state.columns.map((c) => {
    const vals = state.rows.map((r) => String(r[c.i]).trim()).filter((v) => v !== "");
    const samples = [...new Set(vals)].slice(0, 3).join(" · ");
    const opts = Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}" ${c.type === v ? "selected" : ""}>${l}</option>`).join("");
    const pct = N ? Math.round((vals.length / N) * 100) : 0;
    let groupSel;
    if (c.type === "rating") {
      groupSel = `<select class="coltype colgroup" data-col="${c.i}">
          ${groupNames.map((g) => `<option value="${esc(g)}" ${c.group === g ? "selected" : ""}>${esc(g.length > 38 ? g.slice(0, 38) + "…" : g)}</option>`).join("")}
          <option value="__new__">➕ สร้างด้านใหม่…</option>
        </select>`;
    } else if (c.type === "categorical") {
      // รวมกับคอลัมน์อื่นที่เป็นคำถามเดียวกัน (คนละกิ่งของฟอร์ม) + เลือกว่าลงรายงานไหม
      const others = state.columns.filter((o) => o.type === "categorical" && o.i !== c.i && !o.mergeInto && o.mergeInto !== c.i && !state.columns.some((x) => x.mergeInto === c.i && x.i === o.i));
      groupSel = `<select class="coltype colmerge" data-col="${c.i}">
          <option value="">— แสดงแยก</option>
          ${others.map((o) => `<option value="${o.i}" ${c.mergeInto === o.i ? "selected" : ""}>รวมกับ: ${esc(o.header.slice(0, 30))}</option>`).join("")}
        </select>
        <label class="ck" style="margin-top:4px;display:block"><input type="checkbox" class="colreport" data-col="${c.i}" ${c.noReport ? "" : "checked"}> ลงรายงาน</label>`;
    } else if (c.type === "text") {
      groupSel = `<label class="ck"><input type="checkbox" class="colreport" data-col="${c.i}" ${c.noReport ? "" : "checked"}> ลงรายงาน</label>`;
    } else {
      groupSel = `<span class="sugg-count">—</span>`;
    }
    const cf = c._conf ?? 1;
    const confChip = `<span class="conf-chip ${cf >= 0.8 ? "ok" : cf >= 0.6 ? "mid" : "low"}" title="ความมั่นใจของการจำแนกอัตโนมัติ — ต่ำกว่า 80% ควรตรวจและยืนยัน">${Math.round(cf * 100)}%</span>`;
    return `<tr class="${cf < 0.8 && !state.mapConfirmed ? "row-lowconf" : ""}">
      <td class="item">${esc(c.header)}${c.catQ ? ' <span class="lv l3">หมวดหมู่</span>' : ""}</td>
      <td class="num">${vals.length}/${N}<span class="meanbar" style="min-width:44px"><i style="width:${pct}%"></i></span></td>
      <td class="sample-vals">${esc(samples.slice(0, 90))}</td>
      <td><select class="coltype" data-col="${c.i}">${opts}</select> ${confChip}</td>
      <td>${groupSel}</td>
    </tr>`;
  }).join("");
  card.insertAdjacentHTML("beforeend", `
    <div class="tbl-wrap"><table class="app">
      <tr><th class="item">คอลัมน์</th><th>ตอบแล้ว</th><th class="item">ตัวอย่างคำตอบ</th><th>ชนิดข้อมูล · ความมั่นใจ</th><th>ด้าน/หมวด (เฉพาะคะแนน)</th></tr>${rowsHtml}
    </table></div>`);
  $$("select.coltype:not(.colgroup)", card).forEach((sel) => {
    sel.onchange = () => {
      const col = state.columns[+sel.dataset.col];
      col.type = sel.value;
      col._conf = 1; // ผู้ใช้เลือกเอง = ยืนยันแล้วรายคอลัมน์
      state.mapConfirmed = false; // การจำแนกรวมเปลี่ยน — ให้ตรวจ/ยืนยันชุดใหม่อีกครั้ง
      if (col.type === "rating" && !col.group) {
        const b = col.header.match(/^(.*?)\s*\[(.+)\]\s*$/);
        if (b) { col.item = b[2].trim(); col.group = b[1].trim() || unnamedGroupName(col.item); }
        else { col.group = "การประเมินรายข้ออื่น ๆ"; col.item = col.header; }
      }
      updateStatusCol();
      bumpDataVersion();
      renderFilterBar();
      saveSessionSnapshot();
      renderActiveTab(); // วาดตารางใหม่ให้คอลัมน์ "ด้าน" โผล่/หายตามชนิดที่เปลี่ยน
      toast(`เปลี่ยน "${col.header.slice(0, 30)}..." เป็น ${TYPE_LABELS[col.type]}`);
    };
  });
  // รวมคอลัมน์ตัวเลือกที่เป็นคำถามเดียวกัน (คนละกิ่งของฟอร์ม)
  $$("select.colmerge", card).forEach((sel) => {
    sel.onchange = () => {
      const col = state.columns[+sel.dataset.col];
      col.mergeInto = sel.value === "" ? null : +sel.value;
      updateStatusCol();
      bumpDataVersion();
      saveSessionSnapshot();
      renderFilterBar();
      renderActiveTab();
      toast(col.mergeInto != null ? `รวม "${col.header.slice(0, 22)}" เข้ากับ "${state.columns[col.mergeInto].header.slice(0, 22)}"` : `แยก "${col.header.slice(0, 25)}" ออกมาแสดงเอง`);
    };
  });
  respondentMapCard(panel);
  // เลือกว่าคอลัมน์ไหนลงรายงานราชการ
  $$("input.colreport", card).forEach((cb) => {
    cb.onchange = () => {
      const col = state.columns[+cb.dataset.col];
      col.noReport = !cb.checked;
      saveSessionSnapshot();
      toast(`${col.header.slice(0, 28)} — ${cb.checked ? "ลงรายงาน" : "ไม่ลงรายงาน (ยังแสดงบนเว็บ)"}`);
    };
  });

  // ย้ายข้อไปด้านอื่น / สร้างด้านใหม่
  $$("select.colgroup", card).forEach((sel) => {
    sel.onchange = () => {
      const col = state.columns[+sel.dataset.col];
      let g = sel.value;
      if (g === "__new__") {
        g = (prompt("ตั้งชื่อด้านใหม่ เช่น ด้านความพึงพอใจต่อกิจกรรม", "") || "").trim();
        if (!g) { renderActiveTab(); return; }
      }
      col.group = g;
      if (!col.item) col.item = col.header;
      bumpDataVersion();
      saveSessionSnapshot();
      renderActiveTab();
      toast(`ย้าย "${(col.item || col.header).slice(0, 25)}…" ไปด้าน "${g.slice(0, 30)}"`);
    };
  });
}

/* ============================================================
   แท็บ: รายงานราชการ
   ============================================================ */
const W_FONT = "font-family:'TH SarabunPSK','TH Sarabun New','Sarabun','Cordia New',sans-serif;";
const W_P = `${W_FONT}font-size:16pt;margin:6pt 0;line-height:1.35;`;
const W_TD = `border:1px solid #000;padding:1pt 8pt;${W_FONT}font-size:16pt;vertical-align:top;line-height:1.3;`;

function wp(text, opts = {}) {
  const align = opts.align ? `text-align:${opts.align};` : "text-align:justify;";
  const indent = opts.indent === false ? "" : "text-indent:36pt;";
  const bold = opts.bold ? "font-weight:bold;" : "";
  return `<p${opts.cls ? ` class="${opts.cls}"` : ""} style="${W_P}${align}${indent}${bold}">${text}</p>`;
}
function wCaption(no, title) {
  return `<p class="rp-cap" style="${W_P}text-align:left;margin-bottom:2pt;"><b>ตารางที่ ${no}</b>&nbsp;&nbsp;${esc(title)}</p>`;
}
function wTable(headCells, bodyRows) {
  const th = headCells.map((h) => `<td style="${W_TD}text-align:center;font-weight:bold;">${h}</td>`).join("");
  const trs = bodyRows.map((cells) =>
    `<tr>${cells.map((c) => `<td ${c.span ? `colspan="${c.span}" ` : ""}style="${W_TD}${c.align ? `text-align:${c.align};` : "text-align:center;"}${c.bold ? "font-weight:bold;" : ""}">${c.html}</td>`).join("")}</tr>`
  ).join("");
  return `<table class="rp-tbl" style="border-collapse:collapse;width:100%;${W_FONT}" border="1"><tr>${th}</tr>${trs}</table>`;
}
const cell = (html, align, bold, span) => ({ html, align, bold, span });

/** สร้างชุดข้อมูลจากรายการในประวัติ (สำหรับรวมหลายแบบประเมินในเล่มเดียว) */
function datasetFromRecord(s) {
  const columns = s.headers.map((h, i) => ({ i, header: h, group: null, item: null, ...(s.colTypes?.[i] || { type: "ignore" }) }));
  // ชื่อส่วนในรายงานใช้ชื่อไฟล์ — โครงการเดียวกันมักหลายไฟล์ ชื่อโครงการจะซ้ำกันจนแยกไม่ออก
  return { label: s.fileName.replace(/\.(xlsx|xls|csv).*$/i, ""), headers: s.headers, rows: s.rows, columns, respTarget: s.respTarget ?? null };
}

/** ประกอบชุดข้อมูลของรายงาน: ชุดหลัก + แบบประเมินอื่นที่เลือกจากประวัติ
    — ไฟล์ที่หัวตารางเหมือนกัน = ข้อมูลชุดเดียวกันที่แยกไฟล์ → รวมแถวเข้าชุดหลัก */
function assembleReportDatasets(mainRows) {
  const main = {
    key: "main",
    label: state.fileName.replace(/\.(xlsx|xls|csv).*$/i, ""),
    rows: mainRows, columns: state.columns,
    respTarget: state.respTarget, totalAll: state.rows.length, mergedFrom: [],
  };
  const parts = [main];
  for (const id of state.reportExtraIds) {
    const d = state._extraCache[id];
    if (!d) continue;
    if (JSON.stringify(d.headers) === JSON.stringify(state.headers)) {
      let extra = d.rows;
      const act = Object.entries(state.filterSel).filter(([, v]) => v != null);
      if (act.length) extra = extra.filter((r) => act.every(([i, v]) => String(r[+i]).trim() === v));
      main.rows = main.rows.concat(extra);
      main.totalAll += d.rows.length;
      main.mergedFrom.push(d.label);
    } else {
      parts.push({ key: "x" + id, label: d.label, rows: d.rows, columns: d.columns, respTarget: d.respTarget, totalAll: d.rows.length, mergedFrom: [] });
    }
  }
  parts.forEach((ds) => { ds.analysis = analyzeDataset(ds.rows, ds.columns); });
  return parts;
}

/** เกณฑ์ความสำเร็จ (ค่าเฉลี่ยขั้นต่ำ) — ปรับได้ในแผงตั้งค่ารายงาน */
function passMark() {
  const v = parseFloat(state.reportOpts.passMark);
  return Number.isFinite(v) && v >= 1 && v <= 5 ? v : 3.51;
}

/* ============================================================
   Guided Evaluation Analysis — ตรวจสุขภาพข้อมูล · Mapping · ความพร้อมรายงาน
   หลัก: ห้ามแก้/รวมข้อมูลอัตโนมัติ — ระบบเสนอ ผู้ใช้ยืนยันเสมอ และบันทึกทุกการแก้ลง cleanLog
   ============================================================ */

/* ---------- เครื่องมือเทียบข้อความ (หาหมวดที่สะกดต่างแต่หมายถึงสิ่งเดียวกัน) ---------- */
function normalizeCat(s) {
  return String(s).normalize("NFC").trim().toLowerCase()
    .replace(/\s+/g, " ").replace(/[.ๆ]+$/g, "").replace(/[–—]/g, "-");
}
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** ค่าที่ผู้ใช้ยืนยันการรวม — ใช้แปลงค่าทุกจุดอ่านข้อมูลตัวเลือก (rowValueCombined) */
function mappedValue(colIdx, v) {
  const m = state.valueMap[colIdx];
  return m && m[v] != null ? m[v] : v;
}

/** ชื่อกลุ่มผู้ตอบที่ใช้ในรายงาน (Respondent Mapping) — ไม่ตั้งไว้ = ใช้ค่าจริงจากไฟล์ */
function labelOfStatus(v) {
  return state.roleMap[v]?.label?.trim() || v;
}
const ROLE_OPTIONS = [
  ["", "— ยังไม่ระบุ"], ["participant", "ผู้เข้าร่วม"], ["organizer", "ผู้จัดโครงการ"],
  ["staff", "อาจารย์/บุคลากร"], ["teacher", "ครู/วิทยากร"], ["parent", "ผู้ปกครอง"],
  ["community", "ชุมชน"], ["executive", "ผู้บริหาร"], ["volunteer", "อาสาสมัคร"], ["other", "อื่น ๆ"],
];
const ORGANIZER_ROLES = new Set(["organizer", "staff", "teacher", "executive"]);

/* ---------- Data Health Check ---------- */
let _healthKey = null, _health = null;

function computeHealth() {
  if (_health && _healthKey === _dataVersion) return _health;
  const rows = state.rows, headers = state.headers, columns = state.columns;
  const h = {
    respondents: rows.length,
    dupRowIdx: [], dupHeaders: [], emptyHeaders: [],
    missing: [], outOfRange: [], unparsed: [], fuzzy: [],
    issues: [],
  };

  // หัวคอลัมน์ซ้ำ/ว่าง
  const seen = new Map();
  headers.forEach((hd, i) => {
    const t = String(hd).trim();
    if (!t) { h.emptyHeaders.push(i); return; }
    if (seen.has(t)) h.dupHeaders.push(t);
    else seen.set(t, i);
  });

  // แถวซ้ำทั้งแถว (เทียบเฉพาะคอลัมน์ที่ใช้วิเคราะห์ — ข้าม timestamp/ignore)
  const useIdx = columns.filter((c) => c.type !== "ignore").map((c) => c.i);
  const rowKey = new Map();
  rows.forEach((r, ri) => {
    const k = useIdx.map((i) => String(r[i] ?? "").trim()).join("\u0001");
    if (!k.replace(/\u0001/g, "")) return; // แถวว่างไม่ใช่แถวซ้ำ
    if (rowKey.has(k)) h.dupRowIdx.push(ri);
    else rowKey.set(k, ri);
  });

  // Missing / คะแนนนอกช่วง / ค่าที่แปลงไม่ได้
  columns.forEach((c) => {
    if (c.type === "ignore") return;
    let miss = 0;
    for (const r of rows) if (String(r[c.i] ?? "").trim() === "") miss++;
    if (miss > 0) h.missing.push({ i: c.i, header: c.header, n: miss, pct: rows.length ? (miss / rows.length) * 100 : 0 });
    if (c.type === "rating") {
      let bad = 0, unp = 0;
      const badEx = [];
      for (const r of rows) {
        const v = r[c.i];
        if (v === "" || v == null) continue;
        const num = typeof v === "number" ? v : (String(v).trim().match(/^-?\d+(\.\d+)?$/) ? parseFloat(v) : null);
        if (num != null && (num < 1 || num > 5)) { bad++; if (badEx.length < 3) badEx.push(num); continue; }
        if (parseRating(v) == null) unp++;
      }
      if (bad) h.outOfRange.push({ header: c.header, n: bad, examples: badEx });
      if (unp) h.unparsed.push({ header: c.header, n: unp });
    }
  });

  // หมวดที่อาจสะกดต่างกันแต่หมายถึงสิ่งเดียวกัน (เสนอเท่านั้น — รอผู้ใช้ยืนยัน)
  columns.filter((c) => c.type === "categorical" && !c.mergeInto).forEach((c) => {
    const freq = new Map();
    for (const r of rows) {
      const v = rowValueCombined(r, c.i);
      if (v) freq.set(v, (freq.get(v) || 0) + 1);
    }
    const vals = [...freq.keys()];
    for (let a = 0; a < vals.length; a++) {
      for (let b = a + 1; b < vals.length; b++) {
        const key = `${c.i}|${vals[a]}|${vals[b]}`;
        if (state.fuzzyDismissed.includes(key)) continue;
        const na = normalizeCat(vals[a]), nb = normalizeCat(vals[b]);
        const dist = levenshtein(na, nb);
        const maxLen = Math.max(na.length, nb.length);
        const same = na === nb;
        // ค่าที่ต่างกันเฉพาะตัวเลข (ชั้นปีที่ 1/2/3, รุ่นที่ 57/58) = คนละค่าจริง ไม่ใช่สะกดผิด
        const digitOnlyDiff = !same && na.replace(/[0-9๐-๙]+/g, "#") === nb.replace(/[0-9๐-๙]+/g, "#");
        const close = !digitOnlyDiff && maxLen > 3 && dist <= (maxLen <= 6 ? 1 : 2);
        if (same || close) {
          h.fuzzy.push({
            colIdx: c.i, colHeader: c.header, key,
            a: vals[a], b: vals[b], na: freq.get(vals[a]), nb: freq.get(vals[b]),
            conf: same ? 99 : Math.round((1 - dist / maxLen) * 100),
          });
        }
      }
    }
  });
  h.fuzzy.sort((x, y) => y.conf - x.conf);

  // สรุประดับปัญหา
  const missTotal = h.missing.reduce((a, x) => a + x.n, 0);
  if (h.outOfRange.length) h.issues.push({ lv: "crit", msg: `พบคะแนนนอกช่วง 1–5 ใน ${h.outOfRange.length} คอลัมน์ (เช่น ${esc(h.outOfRange[0].header.slice(0, 40))}: ${h.outOfRange[0].examples.join(", ")}) — ตรวจไฟล์ต้นทางหรือเปลี่ยนชนิดคอลัมน์` });
  if (h.dupHeaders.length) h.issues.push({ lv: "crit", msg: `หัวคอลัมน์ซ้ำกัน: ${h.dupHeaders.slice(0, 3).map((x) => `"${esc(x.slice(0, 30))}"`).join(", ")} — ผลอาจถูกนับรวมผิดคอลัมน์` });
  if (h.dupRowIdx.length) h.issues.push({ lv: "warn", msg: `พบแถวที่ข้อมูลซ้ำกันทั้งแถว ${h.dupRowIdx.length} แถว — อาจเป็นการกรอกซ้ำ (กดตัดได้ด้านล่าง)` });
  if (h.fuzzy.length) h.issues.push({ lv: "warn", msg: `พบตัวเลือกที่สะกดคล้ายกัน ${h.fuzzy.length} คู่ — ตรวจและยืนยันการรวมด้านล่าง (ระบบไม่รวมให้อัตโนมัติ)` });
  // ค่าว่างของคำถามปลายเปิดเป็นเรื่องปกติ — ไม่นับเป็นประเด็น; ว่างเกิน 85% มักเป็นคำถามเฉพาะกลุ่ม/กิ่งฟอร์ม → แจ้งเป็นข้อมูล
  h.missing.filter((m) => m.pct > 20 && columns[m.i]?.type !== "text").forEach((m) => {
    if (m.pct >= 85) h.issues.push({ lv: "info", msg: `"${esc(m.header.slice(0, 40))}" มีผู้ตอบเพียงบางกลุ่ม (ว่าง ${m.pct.toFixed(1)}%) — ปกติสำหรับคำถามเฉพาะกลุ่ม เช่น แบบประเมินของผู้จัด` });
    else h.issues.push({ lv: "warn", msg: `"${esc(m.header.slice(0, 40))}" มีค่าว่าง ${m.n} ช่อง (${m.pct.toFixed(1)}%)` });
  });
  h.unparsed.forEach((u) => h.issues.push({ lv: "warn", msg: `"${esc(u.header.slice(0, 40))}" มีคำตอบที่แปลงเป็นคะแนนไม่ได้ ${u.n} ค่า — ข้อนั้นถูกตัดจากการคำนวณ (available-case)` }));
  if (h.emptyHeaders.length) h.issues.push({ lv: "info", msg: `มีคอลัมน์หัวว่าง ${h.emptyHeaders.length} คอลัมน์ — ระบบตั้งชื่อให้อัตโนมัติแล้ว` });
  h.missTotal = missTotal;
  h.level = h.issues.some((x) => x.lv === "crit") ? "crit" : h.issues.some((x) => x.lv === "warn") ? "warn" : "pass";

  _health = h;
  _healthKey = _dataVersion;
  return h;
}

/* ---------- ความพร้อมของรายงาน (Report Readiness) ---------- */
function lowConfCols() {
  return state.columns.filter((c) => c.type !== "ignore" && (c._conf ?? 1) < 0.8);
}
function computeReadiness() {
  const h = computeHealth();
  const crit = [], warn = [], info = [];
  h.issues.forEach((x) => (x.lv === "crit" ? crit : x.lv === "warn" ? warn : info).push(x.msg));
  const lc = lowConfCols();
  if (lc.length && !state.mapConfirmed) {
    crit.push(`มี ${lc.length} คอลัมน์ที่ระบบไม่มั่นใจการจำแนกชนิด และยังไม่ได้รับการยืนยัน — ตรวจที่แท็บ "ตั้งค่าคอลัมน์" แล้วกดยืนยัน`);
  }
  if (!String(state.reportOpts.objectives || "").trim()) {
    warn.push("ยังไม่ได้กำหนดวัตถุประสงค์โครงการ — รายงานจะไม่สรุปการบรรลุวัตถุประสงค์");
  }
  const statusIdx = state.columns.findIndex((c) => c.type === "categorical" && /สถานะ/.test(c.header));
  if (statusIdx >= 0) {
    const { entries, total } = catFreq(filteredRows(), statusIdx);
    entries.filter((e) => e.n <= 2).forEach((e) => warn.push(`กลุ่ม "${labelOfStatus(e.label)}" มีผู้ตอบเพียง ${e.n} คน — ไม่ควรตีความเป็นตัวแทนของกลุ่ม`));
    entries.filter((e) => e.n > 2 && total && (e.n / total) < 0.05).forEach((e) => info.push(`กลุ่ม "${labelOfStatus(e.label)}" มีสัดส่วนต่ำกว่า 5% ของผู้ตอบ`));
    const unmapped = entries.filter((e) => !state.roleMap[e.label]?.role);
    if (unmapped.length) info.push(`กลุ่มผู้ตอบ ${unmapped.length} ค่า ยังไม่ได้ระบุบทบาท (Respondent Mapping) — ระบุได้ที่แท็บ "ตั้งค่าคอลัมน์"`);
  }
  const score = Math.max(0, 100 - crit.length * 25 - warn.length * 6 - info.length * 1);
  return { score, crit, warn, info, level: crit.length ? "crit" : warn.length ? "warn" : "pass" };
}

/* ---------- แท็บ: ตรวจข้อมูล ---------- */
function renderHealth(panel) {
  const h = computeHealth();
  const rd = computeReadiness();

  // การ์ดสรุป
  const card = cardEl(panel, "ตรวจสุขภาพข้อมูล (Data Health Check)", "ตรวจโครงสร้างและคุณภาพข้อมูลก่อนวิเคราะห์ — ระบบจะเสนอสิ่งที่ควรแก้ แต่ไม่แก้ข้อมูลเองจนกว่าจะกดยืนยัน", "activity");
  const nRating = state.columns.filter((c) => c.type === "rating").length;
  const nCat = state.columns.filter((c) => c.type === "categorical").length;
  const nText = state.columns.filter((c) => c.type === "text").length;
  const lvLabel = { pass: "ผ่านการตรวจ", warn: "มีข้อควรระวัง", crit: "มีปัญหาสำคัญ" };
  card.insertAdjacentHTML("beforeend", `
    <div class="hlth-grid">
      <div class="hlth-tile"><b>${h.respondents}</b><span>ผู้ตอบทั้งหมด</span></div>
      <div class="hlth-tile"><b>${nRating}</b><span>คอลัมน์คะแนน</span></div>
      <div class="hlth-tile"><b>${nCat}</b><span>ตัวเลือก/หมวดหมู่</span></div>
      <div class="hlth-tile"><b>${nText}</b><span>ปลายเปิด</span></div>
      <div class="hlth-tile"><b>${h.missTotal}</b><span>ช่องว่าง (Missing)</span></div>
      <div class="hlth-tile hlth-${h.level}"><b>${lvLabel[h.level]}</b><span>สถานะข้อมูล</span></div>
      <div class="hlth-tile hlth-${rd.level}"><b>${rd.score}/100</b><span>ความพร้อมรายงาน</span></div>
    </div>
    ${h.issues.length ? h.issues.map((x) => `<p class="hl-issue hl-${x.lv}">${issueIcon(x.lv)} ${x.msg}</p>`).join("") : `<p class="hl-issue hl-pass">${issueIcon("pass")} ไม่พบปัญหาโครงสร้างข้อมูล</p>`}`);

  // แถวซ้ำ
  if (h.dupRowIdx.length || state.cleanLog.some((x) => x.t === "dedup")) {
    const c2 = cardEl(panel, "แถวที่ซ้ำกันทั้งแถว", "คำตอบที่เหมือนกันทุกช่องอาจเป็นการกดส่งซ้ำ — ตัดออกได้โดยระบบจะบันทึกไว้ในรายงานส่วนการจัดการข้อมูล", "copy-x");
    if (h.dupRowIdx.length) {
      c2.insertAdjacentHTML("beforeend", `<button class="btn small" id="btnDedup"><i data-lucide="eraser"></i> ตัดแถวซ้ำ ${h.dupRowIdx.length} แถว (เหลือรายการแรกไว้)</button>`);
      $("#btnDedup", c2).onclick = () => {
        if (!confirm(`ตัดแถวซ้ำ ${h.dupRowIdx.length} แถวออกจากการวิเคราะห์?\nการตัดจะถูกบันทึกลงรายงาน (ส่วนการจัดการข้อมูล) และย้อนกลับได้โดยเปิดไฟล์ใหม่`)) return;
        const del = new Set(h.dupRowIdx);
        state.rows = state.rows.filter((_, i) => !del.has(i));
        state.cleanLog.push({ t: "dedup", n: del.size, at: Date.now() });
        bumpDataVersion(); saveSessionSnapshot(); renderActiveTab();
        toast(`ตัดแถวซ้ำ ${del.size} แถวแล้ว`);
      };
    }
    state.cleanLog.filter((x) => x.t === "dedup").forEach((x) => {
      c2.insertAdjacentHTML("beforeend", `<p class="hl-issue hl-info"><i data-lucide="scissors"></i> ตัดแถวซ้ำไปแล้ว ${x.n} แถว (${new Date(x.at).toLocaleString("th-TH")})</p>`);
    });
  }

  // หมวดสะกดคล้าย
  if (h.fuzzy.length || state.cleanLog.some((x) => x.t === "merge")) {
    const c3 = cardEl(panel, "ตัวเลือกที่อาจหมายถึงสิ่งเดียวกัน", "ระบบตรวจพบค่าที่สะกดใกล้กันมาก — เลือกรวมหรือยืนยันว่าเป็นคนละค่า ระบบจะไม่รวมให้เองเด็ดขาด", "git-merge");
    if (h.fuzzy.length) {
      c3.insertAdjacentHTML("beforeend", `<div class="tbl-wrap"><table class="app">
        <tr><th class="item">คอลัมน์</th><th class="item">ค่าที่พบ</th><th class="item">ค่าที่คล้ายกัน</th><th>ความมั่นใจ</th><th></th></tr>
        ${h.fuzzy.slice(0, 20).map((f, fi) => `<tr>
          <td class="item">${esc(f.colHeader.slice(0, 26))}</td>
          <td class="item">${esc(f.a)} <span class="sugg-count">(${f.na})</span></td>
          <td class="item">${esc(f.b)} <span class="sugg-count">(${f.nb})</span></td>
          <td class="num">${f.conf}%</td>
          <td style="white-space:nowrap">
            <button class="btn small" data-fz-merge="${fi}"><i data-lucide="git-merge"></i> รวมเป็น "${esc((f.na >= f.nb ? f.a : f.b).slice(0, 14))}"</button>
            <button class="btn small" data-fz-keep="${fi}">คนละค่า</button>
          </td>
        </tr>`).join("")}
      </table></div>`);
      $$("[data-fz-merge]", c3).forEach((b) => (b.onclick = () => {
        const f = h.fuzzy[+b.dataset.fzMerge];
        const to = f.na >= f.nb ? f.a : f.b;
        const from = f.na >= f.nb ? f.b : f.a;
        if (!confirm(`รวม "${from}" (${Math.min(f.na, f.nb)} รายการ) เข้ากับ "${to}"?\nบันทึกลงรายงานส่วนการจัดการข้อมูล`)) return;
        state.valueMap[f.colIdx] = state.valueMap[f.colIdx] || {};
        state.valueMap[f.colIdx][from] = to;
        state.cleanLog.push({ t: "merge", col: f.colHeader, from, to, at: Date.now() });
        bumpDataVersion(); saveSessionSnapshot(); renderFilterBar(); renderActiveTab();
        toast(`รวม "${from.slice(0, 20)}" → "${to.slice(0, 20)}" แล้ว`);
      }));
      $$("[data-fz-keep]", c3).forEach((b) => (b.onclick = () => {
        const f = h.fuzzy[+b.dataset.fzKeep];
        state.fuzzyDismissed.push(f.key);
        _healthKey = null; saveSessionSnapshot(); renderActiveTab();
        toast("บันทึกแล้วว่าเป็นคนละค่า");
      }));
    }
    state.cleanLog.filter((x) => x.t === "merge").forEach((x) => {
      c3.insertAdjacentHTML("beforeend", `<p class="hl-issue hl-info"><i data-lucide="git-merge"></i> รวม "${esc(x.from)}" → "${esc(x.to)}" ในคอลัมน์ ${esc(String(x.col).slice(0, 30))}</p>`);
    });
  }

  // Missing รายคอลัมน์
  if (h.missing.length) {
    const c4 = cardEl(panel, "ค่าว่างรายคอลัมน์ (Missing)", "การวิเคราะห์ใช้แบบ available-case: คำนวณจากผู้ที่ตอบข้อนั้นจริง ไม่แทนค่าว่างด้วยศูนย์", "circle-dashed");
    c4.insertAdjacentHTML("beforeend", `<div class="tbl-wrap"><table class="app">
      <tr><th class="item">คอลัมน์</th><th>ว่าง (ช่อง)</th><th>ร้อยละ</th><th class="item">ตอบจริง (valid)</th></tr>
      ${h.missing.sort((a, b) => b.n - a.n).slice(0, 15).map((m) => `<tr>
        <td class="item">${esc(m.header.slice(0, 48))}</td><td class="num">${m.n}</td>
        <td class="num">${m.pct.toFixed(1)}</td><td class="item">${state.rows.length - m.n} จาก ${state.rows.length}</td>
      </tr>`).join("")}
    </table></div>`);
  }
  refreshIcons();
}

/* ---------- การ์ดกลุ่มผู้ตอบ (Respondent Mapping) — ใช้ในแท็บตั้งค่าคอลัมน์ ---------- */
function respondentMapCard(panel) {
  const statusIdx = state.columns.findIndex((c) => c.type === "categorical" && /สถานะ/.test(c.header));
  if (statusIdx < 0) return;
  const { entries } = catFreq(state.rows, statusIdx);
  if (!entries.length) return;
  const card = cardEl(panel, "กลุ่มผู้ตอบและคำเรียกในรายงาน (Respondent Mapping)", "ระบุว่าแต่ละค่าในคอลัมน์สถานะคือใคร — ระบบใช้จัดฐานผู้ประเมิน (ผู้เข้าร่วม vs ผู้จัด) และใช้คำเรียกนี้ในรายงาน", "users");
  card.insertAdjacentHTML("beforeend", `<div class="tbl-wrap"><table class="app">
    <tr><th class="item">ค่าที่พบในไฟล์</th><th>จำนวน</th><th>บทบาท</th><th class="item">คำเรียกในรายงาน</th></tr>
    ${entries.map((e, i) => `<tr>
      <td class="item">${esc(e.label)}</td><td class="num">${e.n}</td>
      <td><select class="coltype" data-role-sel="${i}">${ROLE_OPTIONS.map(([v, l]) => `<option value="${v}" ${(state.roleMap[e.label]?.role || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select></td>
      <td class="item"><input type="text" class="rm-label" data-role-lb="${i}" value="${esc(state.roleMap[e.label]?.label || "")}" placeholder="${esc(e.label)}"></td>
    </tr>`).join("")}
  </table></div>
  <p class="card-sub">บทบาท "ผู้จัดโครงการ / อาจารย์-บุคลากร / ครู-วิทยากร / ผู้บริหาร" จะถูกแยกเป็นฐานผู้ประเมินคนละฐานกับผู้เข้าร่วมโดยอัตโนมัติ</p>`);
  const upd = (i, patch) => {
    const key = entries[i].label;
    state.roleMap[key] = { ...(state.roleMap[key] || {}), ...patch };
    bumpDataVersion(); saveSessionSnapshot();
  };
  $$("[data-role-sel]", card).forEach((s) => (s.onchange = () => { upd(+s.dataset.roleSel, { role: s.value }); renderActiveTab(); toast("บันทึกบทบาทแล้ว — ฐานผู้ประเมินในรายงานคำนวณใหม่"); }));
  $$("[data-role-lb]", card).forEach((inp) => (inp.onchange = () => { upd(+inp.dataset.roleLb, { label: inp.value }); toast("บันทึกคำเรียกในรายงานแล้ว"); }));
}

/* ---------- การ์ดยืนยันการจำแนกคำถาม (Question Mapping Confirmation) ---------- */
function mappingConfirmCard(panel) {
  const lc = lowConfCols();
  const card = document.createElement("div");
  card.className = "card mapping-confirm " + (state.mapConfirmed ? "ok" : lc.length ? "warn" : "ok");
  card.innerHTML = state.mapConfirmed
    ? `<p class="hl-issue hl-pass" style="margin:0">${issueIcon("pass")} การจำแนกชนิดคำถามได้รับการยืนยันแล้ว — แก้ชนิดคอลัมน์เมื่อใด สถานะจะกลับเป็นรอยืนยัน</p>`
    : `<p class="hl-issue ${lc.length ? "hl-warn" : "hl-info"}" style="margin:0 0 8px">${lc.length ? `${issueIcon("warn")} ระบบไม่มั่นใจการจำแนก ${lc.length} คอลัมน์ (ความมั่นใจต่ำกว่า 80% — ไฮไลต์ในตาราง)` : `${issueIcon("info")} ตรวจการจำแนกชนิดคำถามด้านล่าง`} แล้วกดยืนยันเพื่อให้รายงานพ้นสถานะฉบับร่าง</p>
      <button class="btn small primary" id="btnConfirmMap"><i data-lucide="check-check"></i> ตรวจแล้ว — ยืนยันการจำแนกทั้งหมด</button>`;
  panel.appendChild(card);
  const btn = $("#btnConfirmMap", card);
  if (btn) btn.onclick = () => { state.mapConfirmed = true; saveSessionSnapshot(); renderActiveTab(); toast("ยืนยันการจำแนกคำถามแล้ว"); };
}

/* ============================================================
   แท็บ: คู่มือการใช้งาน — วิธีใช้ + วิธีคิดของระบบ (เปิดได้แม้ยังไม่โหลดไฟล์)
   ============================================================ */
function renderGuide(panel) {
  const wrap = document.createElement("div");
  wrap.className = "guide-wrap";
  const sec = (icon, title, body, open = false) => `
    <details class="g-sec"${open ? " open" : ""}>
      <summary><i data-lucide="${icon}"></i> ${title}</summary>
      <div class="g-body">${body}</div>
    </details>`;

  wrap.innerHTML = `
    <div class="card guide-head">
      <h3><i data-lucide="book-open"></i> คู่มือการใช้งาน</h3>
      <p class="card-sub">อธิบายทั้ง "วิธีใช้" และ "วิธีคิด" ของระบบ — ระบบวิเคราะห์อะไร คำนวณอย่างไร และผลแต่ละส่วนอ่านอย่างไร เพื่อให้ตรวจสอบและอ้างอิงได้ทุกตัวเลข</p>
    </div>

    ${sec("rocket", "เริ่มต้นใช้งาน — 5 ขั้นตอนแนะนำ", `
      <div class="g-step"><span class="g-num">1</span><div><b>อัปโหลดไฟล์</b> — ลากไฟล์ .xlsx / .csv จาก Google Forms หรือไฟล์ที่พิมพ์จากแบบกระดาษมาวาง (รองรับหัวตาราง 2 ชั้น) หรือเชื่อม Google Sheet เพื่อซิงก์ค่าล่าสุด หรือเปิดไฟล์ตรวจงาน .evalproj ที่เพื่อนส่งมา</div></div>
      <div class="g-step"><span class="g-num">2</span><div><b>แท็บ "ตรวจข้อมูล"</b> — ดูสุขภาพข้อมูลก่อน: แถวซ้ำ ตัวเลือกสะกดคล้ายกัน ค่าว่าง คะแนนนอกช่วง ระบบจะ<b>เสนอ</b>สิ่งที่ควรแก้ แต่ไม่แก้เองจนกว่าจะกดยืนยัน และทุกการแก้ถูกบันทึกลงรายงานส่วน "การจัดการข้อมูล"</div></div>
      <div class="g-step"><span class="g-num">3</span><div><b>แท็บ "ตั้งค่าคอลัมน์"</b> — ตรวจว่าระบบจำแนกชนิดคำถามถูกไหม (มี % ความมั่นใจกำกับ) แก้ได้ทุกคอลัมน์ แล้วกด "ยืนยันการจำแนกทั้งหมด" พร้อมระบุกลุ่มผู้ตอบ (ใครคือผู้เข้าร่วม ใครคือผู้จัด) และคำเรียกที่จะใช้ในรายงาน</div></div>
      <div class="g-step"><span class="g-num">4</span><div><b>แท็บ "รายงานราชการ" → ปุ่มตั้งค่ารายงาน</b> — กรอกชื่อโครงการ เกณฑ์ความสำเร็จ และวัตถุประสงค์ (บรรทัดละข้อ ตามรูปแบบ <code>วัตถุประสงค์ | ชื่อด้านที่ใช้วัด</code>) ระบบจะสรุปการบรรลุวัตถุประสงค์ให้เฉพาะเมื่อเชื่อมด้านแล้วเท่านั้น</div></div>
      <div class="g-step"><span class="g-num">5</span><div><b>คัดลอก / ดาวน์โหลด .docx</b> — ตัวอย่างบนจอจัดรูปแบบให้อ่านง่าย แต่สิ่งที่คัดลอกหรือดาวน์โหลดจะเป็นฟอร์แมตราชการ (TH Sarabun 16pt) พร้อมวางในเล่มทันที ถ้ายังมีปัญหาสำคัญค้าง เอกสารจะติดสถานะ "ฉบับร่าง"</div></div>
    `, true)}

    ${sec("layout-dashboard", "แต่ละแท็บทำหน้าที่อะไร", `
      <div class="tbl-wrap"><table class="app">
        <tr><th class="item">แท็บ</th><th class="item">หน้าที่</th></tr>
        <tr><td class="item"><b>แดชบอร์ด</b></td><td class="item">ภาพรวมทันที: จำนวนผู้ตอบ อัตราตอบกลับ ค่าเฉลี่ยรายด้าน และการกระจายคะแนน</td></tr>
        <tr><td class="item"><b>ผลรายด้าน</b></td><td class="item">เจาะรายด้าน→รายข้อ พร้อมกราฟค่าเฉลี่ยและการกระจาย (สลับมุมมองความถี่ได้)</td></tr>
        <tr><td class="item"><b>SDGs</b></td><td class="item">ร้อยละผู้ที่เห็นว่าโครงการสอดคล้องแต่ละเป้าหมาย (เกณฑ์สอดคล้อง ≥ 50%)</td></tr>
        <tr><td class="item"><b>ข้อมูลผู้ตอบ</b></td><td class="item">โครงสร้างผู้ตอบ: สถานะ ชั้นปี สังกัด ฯลฯ เป็นความถี่และร้อยละ</td></tr>
        <tr><td class="item"><b>ข้อเสนอแนะ</b></td><td class="item">ความคิดเห็นปลายเปิดฉบับเต็ม จัดกลุ่มคำตอบซ้ำให้อัตโนมัติ</td></tr>
        <tr><td class="item"><b>ตรวจข้อมูล</b></td><td class="item">สุขภาพข้อมูล + รายการที่ควรแก้ + คะแนนความพร้อมของรายงาน</td></tr>
        <tr><td class="item"><b>ตั้งค่าคอลัมน์</b></td><td class="item">แก้ชนิดคำถาม จัดด้าน รวมคอลัมน์ กำหนดกลุ่มผู้ตอบ เลือกว่าอะไรลงรายงาน</td></tr>
        <tr><td class="item"><b>รายงานราชการ</b></td><td class="item">เล่มรายงาน 8 ส่วน + ภาคผนวก พร้อมคัดลอก/ดาวน์โหลด .docx</td></tr>
        <tr><td class="item"><b>ประวัติ</b></td><td class="item">งานที่เคยวิเคราะห์บนเครื่องนี้ (เก็บ 15 วันแล้วลบอัตโนมัติ) เปิดซ้ำ/ผนวก/รวมเล่มได้</td></tr>
      </table></div>
    `)}

    ${sec("bot", "ระบบจำแนกชนิดคำถามอย่างไร (และทำไมต้องยืนยัน)", `
      <p>ระบบอ่านทั้ง<b>หัวคอลัมน์และคำตอบจริง</b>ของแต่ละคอลัมน์ แล้วเดาชนิดตามกติกา:</p>
      <p><b>คะแนน 1–5</b> — คำตอบอย่างน้อย 90% แปลงเป็นคะแนนได้ (ตัวเลข 1–5 หรือคำอย่าง "มากที่สุด/มาก/ปานกลาง") · <b>SDG</b> — คำตอบทุกค่าเป็น "สอดคล้อง/ไม่สอดคล้อง" · <b>ตัวเลือก</b> — ค่าที่ไม่ซ้ำมีไม่เกิน ~20 แบบ · <b>คำถามหมวดหมู่</b> — หัวข้อดูเหมือนคำถามความเห็น (เช่น "ฐานกิจกรรมที่ประทับใจมากที่สุด") แต่คำตอบกระจุกเป็นตัวเลือกซ้ำ ๆ → วิเคราะห์เป็นความถี่/ร้อยละ ไม่ใช่การตีความข้อความ · <b>ปลายเปิด</b> — ข้อความอิสระ · <b>ไม่วิเคราะห์</b> — ประทับเวลา อีเมล ชื่อ เลขลำดับ</p>
      <p>ทุกคอลัมน์มี <b>% ความมั่นใจ</b> กำกับ ถ้าต่ำกว่า 80% ระบบถือว่า "ต้องตรวจ" และรายงานจะติดสถานะฉบับร่างจนกว่าจะกด<b>ยืนยันการจำแนกทั้งหมด</b> — เหตุผลคือการเดาผิดชนิดเพียงคอลัมน์เดียว (เช่น เอาคำถามหมวดหมู่ไปตีความเป็นความเรียง) ทำให้ผลทั้งเล่มผิดความหมายได้แม้ตัวเลขจะคำนวณถูก</p>
    `)}

    ${sec("sigma", "สถิติที่ใช้และสูตรคำนวณ", `
      <div class="g-formula"><b>ค่าเฉลี่ย</b> x̄ = ผลรวมของคะแนนทุกคำตอบ ÷ จำนวนคำตอบ (n)</div>
      <div class="g-formula"><b>ส่วนเบี่ยงเบนมาตรฐาน</b> S.D. = √( Σ(x − x̄)² ÷ (n − 1) ) — ใช้สูตรกลุ่มตัวอย่าง (n−1) ค่ายิ่งต่ำ = คำตอบยิ่งไปทางเดียวกัน</div>
      <div class="g-formula"><b>ร้อยละ</b> = (จำนวนในกลุ่ม ÷ จำนวนผู้ตอบข้อนั้น) × 100</div>
      <p><b>ค่าเฉลี่ยรายด้าน</b> คำนวณจากคะแนนดิบทุกคำตอบของทุกข้อในด้านนั้นรวมกัน (pooled) ไม่ใช่เฉลี่ยของค่าเฉลี่ยรายข้อ ส่วน<b>ค่าเฉลี่ยของผลการประเมินรายด้าน</b>ที่ปรากฏท้ายตารางบทสรุป คำนวณจากค่าเฉลี่ยรายด้านแบบไม่ถ่วงน้ำหนัก และมีหมายเหตุกำกับว่าใช้เพื่อภาพรวมเชิงพรรณนาเท่านั้น</p>
      <p><b>ข้อที่ไม่มีคำตอบ (missing)</b> ใช้วิธี available-case: คำนวณจากผู้ที่ตอบข้อนั้นจริง ระบุ n กำกับ และ<b>ไม่แทนค่าว่างด้วยศูนย์</b>เด็ดขาด</p>
      <div class="tbl-wrap"><table class="app">
        <tr><th>ช่วงค่าเฉลี่ย</th><th class="item">ระดับผลการประเมิน</th></tr>
        <tr><td class="num">4.51 – 5.00</td><td class="item">มากที่สุด</td></tr>
        <tr><td class="num">3.51 – 4.50</td><td class="item">มาก</td></tr>
        <tr><td class="num">2.51 – 3.50</td><td class="item">ปานกลาง</td></tr>
        <tr><td class="num">1.51 – 2.50</td><td class="item">น้อย</td></tr>
        <tr><td class="num">1.00 – 1.50</td><td class="item">ควรปรับปรุง</td></tr>
      </table></div>
      <p><b>เกณฑ์ความสำเร็จ</b> (ผ่าน/ไม่ผ่าน) ค่าเริ่มต้นคือค่าเฉลี่ยตั้งแต่ 3.51 ขึ้นไป ปรับได้ในตั้งค่ารายงาน — ผลจะอัปเดตทั้งเล่มทันที</p>
    `)}

    ${sec("users", "ฐานผู้ประเมินคืออะไร — ทำไมบางด้านแยกรายงาน", `
      <p><b>ฐานผู้ประเมิน (Cohort)</b> คือกลุ่มผู้ตอบที่ใช้วิเคราะห์ผลชุดเดียวกัน เช่น แบบประเมินมาตรฐานกลางมักให้<b>ผู้เข้าร่วมทุกคน</b>ตอบด้านความสัมพันธ์/ความพึงพอใจ (เช่น n = 864) แต่ให้<b>เฉพาะผู้จัดและบุคลากร</b>ตอบด้านทักษะแห่งอนาคต 5Hs (เช่น n = 55)</p>
      <p>ระบบตรวจจากข้อมูลจริงว่าใครตอบด้านไหน (นับรายแถว ไม่ใช้ตัวเลขที่พิมพ์เอง) ประกอบกับบทบาทที่ระบุในแท็บตั้งค่าคอลัมน์ แล้ว<b>แยกรายงานคนละส่วน ห้ามเฉลี่ยรวม ห้ามอยู่กราฟเดียวกัน และห้ามจัดอันดับข้ามฐาน</b> — เพราะคะแนนจากคน 55 คนกับ 864 คนเทียบกันตรง ๆ ไม่ได้ ทุกตารางจึงมีบรรทัด "ฐานผู้ประเมิน" ระบุว่าใครตอบ กี่คน</p>
      <p>กลุ่มที่มีผู้ตอบน้อยมาก (เช่น อาจารย์ 1 คน) ระบบจะเตือนอัตโนมัติในรายงานว่าไม่ควรตีความเป็นตัวแทนของทั้งกลุ่ม</p>
    `)}

    ${sec("message-square", "ความคิดเห็นปลายเปิดถูกวิเคราะห์อย่างไร", `
      <div class="g-step"><span class="g-num">1</span><div><b>คัดกรอง</b> — ตัดคำตอบที่ไม่มีสาระ ("ไม่มี", "-", "ดี", "โอเค") พร้อมรายงานจำนวนที่ตัดอย่างโปร่งใส แต่ไม่ตัดความคิดเห็นเชิงลบที่มีสาระ</div></div>
      <div class="g-step"><span class="g-num">2</span><div><b>จำแนกขั้ว</b> — ดูจากคอลัมน์ (คำถาม "ประทับใจ" → เชิงชื่นชอบ, "ข้อเสนอแนะ/ปรับปรุง" → เชิงพัฒนา) และคำบ่งชี้ในข้อความ เช่น "ควร/อยากให้/เพิ่ม/ลด"</div></div>
      <div class="g-step"><span class="g-num">3</span><div><b>จัดประเด็น (Theme)</b> — จับคู่คำสำคัญภาษาไทยกับประเด็นมาตรฐาน เช่น การบริหารเวลา อาหารและช่วงพัก สถานที่ การสื่อสาร ระดับเสียง คิว/การเดินทาง เอกสาร ฯลฯ ความคิดเห็นหนึ่งข้อความนับได้หลายประเด็นถ้าพูดถึงหลายเรื่อง ที่จับไม่ได้จะรวมเป็น "อื่น ๆ" ไม่ทิ้งเงียบ</div></div>
      <div class="g-step"><span class="g-num">4</span><div><b>เลือกตัวแทน</b> — ประเด็นละไม่เกิน 2 ข้อความ: ข้อความที่ถูกพูดซ้ำมากที่สุด และข้อความที่ยาวพอมีรายละเอียด โดยคงคำเดิมของผู้ตอบ</div></div>
      <p>ผลไปปรากฏในรายงานเป็นตาราง Theme × จำนวน พร้อมย่อหน้าเชื่อมกับผลคะแนน และแปลงเป็น<b>ข้อเสนอแนะเชิงปฏิบัติ</b> (ประเด็น–หลักฐาน–แนวทาง–ผู้รับผิดชอบ–ช่วงเวลา) ความคิดเห็นดิบทั้งหมดเก็บอยู่ภาคผนวก</p>
    `)}

    ${sec("globe", "SDGs อ่านอย่างไร", `
      <p>ระบบนับร้อยละของผู้ตอบที่เห็นว่าโครงการ "สอดคล้อง" กับแต่ละเป้าหมาย และถือว่าสอดคล้องเมื่อ<b>ตั้งแต่ร้อยละ 50 ขึ้นไป</b> — สำคัญ: นี่คือ<b>การรับรู้ของผู้ตอบแบบประเมิน</b> ไม่ใช่การประเมินผลกระทบตามตัวชี้วัด SDGs อย่างเป็นทางการ รายงานจึงมีหมายเหตุนี้กำกับเสมอ</p>
    `)}

    ${sec("file-text", "โครงเล่มรายงานราชการ — ใครควรอ่านส่วนไหน", `
      <p><b>ส่วนที่ 1 วิธีการประเมิน</b> เครื่องมือ/กลุ่มผู้ตอบ/สถิติ/การจัดการข้อมูล/ข้อจำกัด · <b>ส่วนที่ 2 บทสรุปผู้บริหาร</b> อ่านหน้าเดียวรู้เรื่อง: ช่วงคะแนน จุดแข็ง ประเด็นพัฒนา และข้อสรุป · <b>ส่วนถัดไป</b> ผลรายฐานผู้ประเมิน (ผู้เข้าร่วม → ผู้จัด) / การบรรลุวัตถุประสงค์ / SDGs / คำถามเชิงหมวดหมู่ / วิเคราะห์ความคิดเห็น / ข้อเสนอแนะเพื่อการพัฒนา · <b>ภาคผนวก</b> ตารางรายข้อทุกด้าน ข้อมูลผู้ตอบละเอียด ความคิดเห็นฉบับเต็ม</p>
      <p>กราฟในเนื้อหาหลักมีไม่เกิน 2 ภาพ (ค่าเฉลี่ยรายด้านของฐานหลักพร้อมเส้นเกณฑ์ และจำนวนความคิดเห็นตามประเด็น) ตารางรายข้อจำนวนมากถูกย้ายไปภาคผนวกเพื่อให้เนื้อหาหลักอ่านต่อเนื่อง</p>
      <p><b>จอ vs ไฟล์:</b> ตัวอย่างบนจอใช้ฟอนต์อ่านสบาย แต่เมื่อคัดลอกหรือดาวน์โหลด .docx จะได้ TH Sarabun 16pt เลขอารบิก ตามแบบเอกสารราชการโดยอัตโนมัติ (สลับเลขไทยได้)</p>
    `)}

    ${sec("gauge", "คะแนนความพร้อมรายงาน และสถานะฉบับร่าง", `
      <p>ระบบตรวจความพร้อมก่อนใช้เอกสารเป็นคะแนนเต็ม 100 หักตามปัญหาที่พบ: <b>ปัญหาสำคัญ (สีแดง) −25</b> เช่น คะแนนนอกช่วง หัวคอลัมน์ซ้ำ ยังไม่ยืนยันการจำแนกคำถามที่ระบบไม่มั่นใจ · <b>ข้อควรระวัง (สีส้ม) −6</b> เช่น แถวซ้ำที่ยังไม่จัดการ ตัวเลือกสะกดคล้าย ยังไม่กรอกวัตถุประสงค์ กลุ่ม n น้อย · <b>ข้อสังเกต −1</b></p>
      <p>ถ้ายังมีปัญหาสำคัญค้าง ตัวอย่างเอกสารจะติดแถบ "ฉบับร่าง" และการดาวน์โหลด .docx จะถามยืนยันพร้อมฝังบรรทัดกำกับในเอกสาร — แก้ครบเมื่อไหร่ ดาวน์โหลดได้เอกสารสะอาดทันที รายการที่ต้องแก้ดูได้ที่แท็บ "ตรวจข้อมูล" หรือปุ่มตั้งค่ารายงาน</p>
    `)}

    ${sec("layers", "รวมหลายแบบประเมิน / หลายไฟล์", `
      <p><b>ผนวก (ปุ่มบนหัวไฟล์)</b> — รวมข้อมูลอีกชุดเข้ากับชุดปัจจุบันให้วิเคราะห์ด้วยกันทุกแท็บ เหมาะกับแบบประเมินเดียวกันที่แยกเก็บหลายไฟล์ ระบบกันการผนวกซ้ำและถอนคืนได้</p>
      <p><b>รวมหลายแบบประเมิน (ในตั้งค่ารายงาน)</b> — ต่อแบบประเมินคนละชุดเป็นเล่มเดียว เลขตาราง/แผนภูมิเรียงต่อกัน เหมาะกับโครงการที่ใช้แบบประเมินมากกว่า 1 ฉบับแต่ต้องส่งเล่มสรุปเดียว</p>
    `)}

    ${sec("lock", "ข้อมูลไปอยู่ที่ไหน (PDPA)", `
      <p>ทุกอย่างประมวลผล<b>ในเบราว์เซอร์ของเครื่องนี้เท่านั้น</b> ไฟล์ประเมินไม่ถูกอัปโหลดขึ้นเซิร์ฟเวอร์ใด ๆ · ประวัติเก็บใน IndexedDB ของเครื่องและลบอัตโนมัติเมื่อครบ 15 วัน (ลบเองได้ทุกเมื่อ) · ไฟล์ .evalproj ส่งถึงกันเอง (LINE/อีเมล) ไม่ผ่านตัวกลาง · การเชื่อม Google Sheet ข้อมูลวิ่งตรงระหว่างเบราว์เซอร์กับ Google ตามสิทธิ์ที่ล็อกอิน · ควรลบคอลัมน์ชื่อ–สกุล อีเมล เบอร์โทร ออกจากไฟล์ก่อนแชร์ต่อ (ระบบตั้งค่าไม่วิเคราะห์คอลัมน์เหล่านี้ให้อยู่แล้ว)</p>
    `)}
  `;
  panel.appendChild(wrap);
  refreshIcons();
}

/* ============================================================
   รายงานราชการ — โครง 8 ส่วน + ภาคผนวก
   หลักสำคัญ: แยกฐานผู้ประเมิน (ห้ามปนตาราง/กราฟข้ามฐานโดยไม่บอก n)
   · กราฟเนื้อหาหลัก ≤ 2 · ความคิดเห็นปลายเปิดจัดเป็น Theme
   · เชื่อมผลกับวัตถุประสงค์ · รายละเอียดรายข้อย้ายไปภาคผนวก
   ============================================================ */

/* รายการที่ควรตรวจก่อนใช้เอกสาร — เก็บระหว่างสร้างรายงาน แสดงในแผงตั้งค่า (ไม่ลงในเอกสาร) */
let _reportTodos = [];
const addTodo = (t) => { if (!_reportTodos.includes(t)) _reportTodos.push(t); };
/* ไอคอนระดับปัญหา — ใช้แทนอีโมจิให้เข้าธีมเดียวกับส่วนอื่น */
const issueIcon = (lv) => `<i data-lucide="${lv === "crit" ? "x-circle" : lv === "warn" ? "alert-triangle" : lv === "pass" ? "check-circle" : "info"}"></i>`;

function joinThai(arr) {
  if (arr.length <= 1) return arr.join("");
  return arr.slice(0, -1).join(" ") + " และ" + arr[arr.length - 1];
}

/** ใครคือผู้ประเมินด้านนี้ — นับจากแถวที่ตอบข้อใดข้อหนึ่งของด้าน จำแนกตามสถานะผู้ตอบ */
function respondentsOfGroup(rows, g, columns) {
  const idxs = g.items.map((it) => it.colIdx);
  let keyIdx = columns.findIndex((c) => c.type === "categorical" && /สถานะ/.test(c.header));
  if (keyIdx < 0) keyIdx = columns.findIndex((c) => c.header === "ชุดแบบประเมิน");
  const byStatus = new Map();
  let n = 0;
  for (const r of rows) {
    if (!idxs.some((i) => parseRating(r[i]) != null)) continue;
    n++;
    if (keyIdx >= 0) {
      const v = rowValueCombined(r, keyIdx, columns) || "ไม่ระบุ";
      byStatus.set(v, (byStatus.get(v) || 0) + 1);
    }
  }
  const list = [...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  let text; // คำเรียกกลุ่มในรายงานมาจาก Respondent Mapping (labelOfStatus)
  if (!list.length) text = `ผู้เข้าร่วมโครงการที่ตอบแบบประเมิน จำนวน ${n} คน`;
  else if (list.length === 1) text = `${labelOfStatus(list[0].label)} จำนวน ${n} คน`;
  else text = joinThai(list.map((x) => `${labelOfStatus(x.label)} จำนวน ${x.count} คน`)) + ` รวม ${n} คน`;
  return { n, text, list };
}

/** จัดด้านออกเป็น "ฐานผู้ประเมิน" — ด้านที่ผู้ตอบเป็นคนละกลุ่ม/จำนวนต่างกันมาก ห้ามรายงานปนกัน
    ฐานหลัก = ด้านที่ฐานผู้ตอบใหญ่ (ผู้เข้าร่วม) · ฐานรอง = ด้านที่ตอบเฉพาะกลุ่มเล็ก (เช่น ผู้จัด/บุคลากร ประเมิน 5Hs) */
function groupBases(rows, groups, columns) {
  const infos = groups.map((g) => ({ g, who: respondentsOfGroup(rows, g, columns) }));
  const maxN = Math.max(0, ...infos.map((x) => x.who.n));
  const anyRole = infos.some((x) => x.who.list.some((st) => state.roleMap[st.label]?.role));
  const main = [], minor = [];
  infos.forEach((x) => {
    let small;
    if (anyRole) {
      // ผู้ใช้ระบุบทบาทแล้ว: ด้านที่ผู้ตอบเกือบทั้งหมดเป็นฝั่งผู้จัด/บุคลากร → ฐานผู้จัด
      const orgN = x.who.list.filter((st) => ORGANIZER_ROLES.has(state.roleMap[st.label]?.role)).reduce((a, st) => a + st.count, 0);
      small = x.who.n > 0 && orgN / x.who.n >= 0.8;
      if (!small && maxN && x.who.n < maxN * 0.6) small = true;
    } else {
      small = maxN > 0 && x.who.n < maxN * 0.6;
    }
    (small ? minor : main).push(x);
  });
  const mkBase = (list, kind) => {
    const rep = list.reduce((a, b) => (b.who.n > a.who.n ? b : a), list[0]);
    const statuses = rep.who.list.map((s) => labelOfStatus(s.label) + " " + (state.roleMap[s.label]?.role || "")).join(" ");
    let title;
    if (kind === "main") {
      title = /นักศึกษา|ผู้เข้าร่วม/.test(statuses) || !statuses ? "ผลการประเมินจากผู้เข้าร่วมโครงการ" : `ผลการประเมินจาก${rep.who.list[0]?.label || "ผู้ตอบแบบประเมิน"}`;
    } else {
      title = /สโมสร|ชุมนุม|อาจารย์|บุคลากร|กรรมการ|ผู้จัด|หลักสูตร|organizer|staff|teacher|executive/.test(statuses) ? "ผลการประเมินจากผู้จัดโครงการและบุคลากร" : `ผลการประเมินจาก${labelOfStatus(rep.who.list[0]?.label || "") || "ผู้ประเมินกลุ่มเฉพาะ"}`;
    }
    return { kind, title, n: rep.who.n, whoText: rep.who.text, list };
  };
  const bases = [];
  if (main.length) bases.push(mkBase(main, "main"));
  if (minor.length) bases.push(mkBase(minor, "minor"));
  return bases;
}

/* ---------- การวิเคราะห์ความคิดเห็นปลายเปิด (Theme coding) ---------- */

const NON_SUBSTANTIVE_RE = /^(ไม่มี(ครับ|ค่ะ|คับ|จ้า)?|ไม่|no|none|nope|-+|–|—|\.+|\*+|_+|\/+|ok(ครับ|ค่ะ)?|โอเค(ครับ|ค่ะ)?|ดี(ครับ|ค่ะ|มาก|มากๆ|มากครับ|มากค่ะ|เยี่ยม)?|เยี่ยม(มาก)?|ครับ|ค่ะ|5+\+?|❤+|👍+)$/i;

const LIKE_THEMES = [
  { key: "fun", name: "ความสนุกและบรรยากาศของกิจกรรม", re: /สนุก|บรรยากาศ|ประทับใจ|มีความสุข|ความสุข|ตื่นเต้น|น่าสนใจ|ไม่น่าเบื่อ|สนุกสนาน/ },
  { key: "staff", name: "การดูแลและความเป็นมิตรของรุ่นพี่และผู้จัด", re: /พี่ๆ|รุ่นพี่|สต[าั]ฟ|staff|ผู้จัด|วิทยากร|ดูแล|เป็นกันเอง|น่ารัก|ใจดี|friendly/i },
  { key: "friend", name: "การสร้างความสัมพันธ์และการรู้จักเพื่อนใหม่", re: /เพื่อน|รู้จักกัน|ความสัมพันธ์|สัมพันธ|สนิท|สามัคคี|ทำงานร่วมกัน|เป็นส่วนหนึ่ง|ละลายพฤติกรรม/ },
  { key: "learn", name: "ความรู้และประสบการณ์ที่ได้รับ", re: /ความรู้|ได้เรียนรู้|ได้รู้|เข้าใจ|ประสบการณ์|เปิดโลก|ได้ฝึก|พัฒนาตนเอง/ },
  { key: "joinin", name: "การมีส่วนร่วมในกิจกรรม", re: /มีส่วนร่วม|ได้ร่วม|ได้เล่น|ได้ทำกิจกรรม|ได้แสดง/ },
];

const IMPROVE_THEMES = [
  { key: "time", name: "การบริหารเวลาและกำหนดการ", re: /เวลา|ล่าช้า|เลท|เลิกดึก|ดึก|เช้า(ไป|เกิน)|นาน(ไป|เกิน)|เร่ง|รีบ|ตรงต่อเวลา|ยืดเยื้อ|เลิกช้า|delay|กระชับ/i,
    fix: "จัดทำกำหนดการ (Run Sheet) รายกิจกรรม ระบุเวลาเริ่ม–สิ้นสุด ผู้ควบคุมเวลา และเวลาสำรอง (Buffer) ระหว่างกิจกรรม พร้อมกำหนดเวลาเลิกกิจกรรมรวมที่ชัดเจนและถือปฏิบัติอย่างเคร่งครัด",
    own: "ฝ่ายกิจกรรม / ผู้ควบคุมเวที", when: "ก่อนและระหว่างโครงการ" },
  { key: "food", name: "อาหาร เครื่องดื่ม และช่วงพัก", re: /อาหาร|ข้าว|ขนม|น้ำดื่ม|น้ำไม่พอ|หิว|เบรก|ช่วงพัก|พักน้อย|พักไม่พอ|เหนื่อย|เพลีย|พักผ่อน/,
    fix: "สำรวจข้อจำกัดด้านอาหารของผู้เข้าร่วมล่วงหน้า จัดปริมาณอาหารและน้ำดื่มให้เพียงพอกับจำนวนจริง กำหนดจุดแจกและรอบรับอาหารให้ชัดเจน และจัดช่วงพักให้สอดคล้องกับความหนักของกิจกรรม",
    own: "ฝ่ายสวัสดิการ", when: "ก่อนและระหว่างโครงการ" },
  { key: "place", name: "สถานที่และสิ่งอำนวยความสะดวก", re: /สถานที่|ห้องน้ำ|ที่นั่ง|ร้อน|แอร์|อากาศ|แคบ|แออัด|ที่จอด|แสงสว่าง|สกปรก|ยุง/,
    fix: "สำรวจความพร้อมของสถานที่ล่วงหน้าโดยเทียบกับจำนวนผู้เข้าร่วมจริง จัดเตรียมที่นั่ง จุดพัก และการระบายอากาศให้เหมาะสม และกำหนดผู้รับผิดชอบประจำจุดระหว่างการจัดกิจกรรม",
    own: "ฝ่ายสถานที่", when: "ก่อนโครงการ" },
  { key: "comm", name: "การสื่อสารกำหนดการและข้อมูลกิจกรรม", re: /สื่อสาร|แจ้ง(ล่วงหน้า|ให้ทราบ)?|ประกาศ|ประชาสัมพันธ์|กำหนดการ|ตารางกิจกรรม|ไม่ทราบ|สับสน|งง/,
    fix: "เผยแพร่กำหนดการผ่านช่องทางหลักช่องทางเดียวที่ผู้เข้าร่วมทุกคนเข้าถึงได้ แจ้งการเปลี่ยนแปลงทันทีที่เกิดขึ้น และทบทวนกำหนดการร่วมกับผู้เข้าร่วมในช่วงเปิดกิจกรรมแต่ละวัน",
    own: "ฝ่ายประชาสัมพันธ์", when: "ก่อนและระหว่างโครงการ" },
  { key: "noise", name: "ระดับเสียงและบรรยากาศบางช่วง", re: /เสียงดัง|เสียงเบา|ไมค์|เครื่องเสียง|หนวกหู|ดังเกิน|เสียงแตก/,
    fix: "ทดสอบระบบเสียงก่อนเริ่มกิจกรรม ปรับระดับเสียงให้เหมาะกับขนาดพื้นที่ และจัดโซนพักที่ห่างจากลำโพงสำหรับผู้ที่ต้องการพัก",
    own: "ฝ่ายโสตทัศนูปกรณ์", when: "ก่อนและระหว่างโครงการ" },
  { key: "queue", name: "การจัดคิวและการเดินทางระหว่างจุดกิจกรรม", re: /คิว|รอนาน|ต่อแถว|เดินไกล|สลับฐาน|ย้ายจุด|เปลี่ยนฐาน|รถรับส่ง/,
    fix: "วางผังการหมุนเวียนกลุ่มระหว่างจุดกิจกรรมล่วงหน้า กระจายจุดลงทะเบียนหรือจุดรับของเพื่อลดการรอ และกำหนดเส้นทางเดินพร้อมผู้นำทางประจำกลุ่ม",
    own: "ฝ่ายกิจกรรม", when: "ก่อนและระหว่างโครงการ" },
  { key: "activity", name: "รูปแบบและสัดส่วนของกิจกรรม", re: /ซ้ำซาก|น่าเบื่อ|เบื่อ|กิจกรรมเยอะ|กิจกรรมน้อย|อยากให้มี|เพิ่มกิจกรรม|ลดกิจกรรม|ปรับกิจกรรม|หลากหลาย/,
    fix: "ทบทวนสัดส่วนประเภทกิจกรรมจากผลประเมินและความคิดเห็นในปีนี้ ลดกิจกรรมที่ซ้ำรูปแบบ และเพิ่มหรือทดลองรูปแบบกิจกรรมที่ผู้เข้าร่วมเสนอในสัดส่วนที่เหมาะสม",
    own: "ฝ่ายกิจกรรม", when: "ก่อนโครงการ" },
  { key: "docs", name: "เอกสาร ชั่วโมงกิจกรรม และหลักฐานการเข้าร่วม", re: /ทรานสคริปต์|transcript|ชั่วโมงกิจกรรม|เกียรติบัตร|ใบประกาศ|ลงทะเบียน|เช็ค?ชื่อ/i,
    fix: "ประกาศขั้นตอนและกำหนดเวลาการบันทึกชั่วโมงกิจกรรมหรือการออกหลักฐานการเข้าร่วมให้ชัดเจนตั้งแต่วันจัดกิจกรรม และกำหนดผู้รับผิดชอบตรวจสอบรายชื่อหลังเสร็จสิ้นโครงการ",
    own: "ฝ่ายทะเบียน / เลขานุการโครงการ", when: "หลังโครงการ" },
];

const ADVICE_RE = /ควร|อยากให้|น่าจะ|ขอให้|เพิ่ม|ลด|ปรับ|แก้|เสนอ|ไม่ค่อย|ไม่พอ|ไม่ทั่วถึง|แย่|ช้า/;

/** วิเคราะห์ความคิดเห็นปลายเปิดทุกคอลัมน์: คัดกรอง → จำแนกชื่นชอบ/ควรปรับปรุง → จัด Theme + นับความถี่ + เลือกตัวแทน */
function codeComments(rows, columns) {
  const textCols = columns.filter((c) => c.type === "text" && !c.noReport);
  const raw = [];
  textCols.forEach((c) => {
    const bias = /ปรับปรุง|เสนอแนะ|แก้ไข|พัฒนา|ปัญหา|อุปสรรค/.test(c.header) ? "improve"
      : /ประทับใจ|ชื่นชอบ|ชอบ|ประโยชน์|ได้รับ/.test(c.header) ? "like" : "neutral";
    textAnswers(rows, c.i).forEach((a) => raw.push({ text: a.text, n: a.n, bias, col: c.header }));
  });
  const total = raw.reduce((s, x) => s + x.n, 0);
  const clean = [];
  let dropped = 0;
  raw.forEach((x) => {
    const t = x.text.trim();
    if (t.length < 2 || NON_SUBSTANTIVE_RE.test(t)) { dropped += x.n; return; }
    clean.push(x);
  });
  const substantive = clean.reduce((s, x) => s + x.n, 0);

  const like = LIKE_THEMES.map((th) => ({ ...th, count: 0, samples: [] }));
  const improve = IMPROVE_THEMES.map((th) => ({ ...th, count: 0, samples: [] }));
  const otherLike = { key: "other", name: "อื่น ๆ", count: 0, samples: [] };
  const otherImp = { key: "other", name: "อื่น ๆ", count: 0, samples: [] };

  clean.forEach((x) => {
    const t = x.text;
    const isAdvice = x.bias === "improve" || (x.bias === "neutral" && ADVICE_RE.test(t));
    const pool = isAdvice ? improve : like;
    const other = isAdvice ? otherImp : otherLike;
    // ความเห็นหนึ่งข้ออาจแตะหลายประเด็น — นับให้ทุก Theme ที่กล่าวถึง (ระบุไว้ในหมายเหตุตาราง)
    const hits = pool.filter((th) => th.re.test(t));
    if (!hits.length) { other.count += x.n; other.samples.push(x); return; }
    hits.forEach((th) => { th.count += x.n; th.samples.push(x); });
  });

  const pickSamples = (th) => {
    const ok = th.samples.filter((s) => s.text.length >= 10 && s.text.length <= 140);
    if (!ok.length) return [];
    // ตัวแทนที่ 1: ข้อความที่ถูกกล่าวซ้ำมากที่สุด · ตัวแทนที่ 2: ข้อความยาวพอมีรายละเอียด
    const byN = [...ok].sort((a, b) => b.n - a.n || Math.abs(a.text.length - 55) - Math.abs(b.text.length - 55));
    const out = [byN[0]];
    const detailed = ok.filter((s) => s !== byN[0] && s.text.length >= 25)
      .sort((a, b) => Math.abs(a.text.length - 65) - Math.abs(b.text.length - 65))[0];
    if (detailed) out.push(detailed);
    else if (byN[1]) out.push(byN[1]);
    return out.map((s) => s.text);
  };
  const finish = (arr, other) => {
    const out = arr.filter((t) => t.count > 0).sort((a, b) => b.count - a.count)
      .map((t) => ({ ...t, samples: pickSamples(t) }));
    if (other.count > 0) out.push({ ...other, samples: pickSamples(other) });
    return out;
  };
  return { total, substantive, dropped, like: finish(like, otherLike), improve: finish(improve, otherImp) };
}

/* ---------- ตัวช่วยประกอบเอกสาร ---------- */

function wAppCaption(no, title) {
  return `<p class="rp-cap" style="${W_P}text-align:left;margin-bottom:2pt;"><b>ตารางผนวกที่ ${no}</b>&nbsp;&nbsp;${esc(title)}</p>`;
}
function secHeadHtml(no, title) {
  return `<p class="rp-sec" style="${W_P}text-align:left;font-weight:bold;font-size:17pt;margin:14pt 0 4pt 0;">ส่วนที่ ${no}  ${esc(title)}</p>`;
}
function subHeadHtml(t) {
  return wp(`<b>${esc(t)}</b>`, { indent: false, align: "left", cls: "rp-sub" });
}
function baseLine(whoText) {
  return `<p class="rp-base" style="${W_P}text-align:left;margin:0 0 6pt 0;"><b>ฐานผู้ประเมิน:</b> ${esc(whoText)}</p>`;
}
function chartImg(url, no, caption, appendix = false) {
  return `<p class="rp-img" style="${W_P}text-align:center;margin-top:10pt;"><img src="${url}" style="width:100%;max-width:15.5cm;" alt=""></p>` +
    `<p class="rp-cap rp-chartcap" style="${W_P}text-align:center;margin-top:0;"><b>${appendix ? "แผนภูมิผนวกที่" : "แผนภูมิที่"} ${no}</b>&nbsp;&nbsp;${esc(caption)}</p>`;
}

/** ตารางรายด้าน (เรียงค่าเฉลี่ยสูง→ต่ำ) + คอลัมน์ผ่านเกณฑ์ */
function groupSummaryTable(list, pm, { rank = false } = {}) {
  const sorted = [...list].sort((a, b) => b.g.total.mean - a.g.total.mean);
  const head = rank ? ["ด้านการประเมิน", "x̄", "S.D.", "ระดับผล", "ลำดับ"] : ["ด้านการประเมิน", "x̄", "S.D.", "ระดับผล", "ผลตามเกณฑ์"];
  const body = sorted.map((x, i) => [
    cell(esc(x.g.name), "left"),
    cell(f2(x.g.total.mean)), cell(f2(x.g.total.sd)), cell(levelLabel(x.g.total.mean)),
    rank ? cell(String(i + 1)) : cell(x.g.total.mean >= pm ? "ผ่าน" : "ไม่ผ่าน", "center", x.g.total.mean < pm),
  ]);
  return { sorted, html: wTable(head, body) };
}

/** ย่อหน้าวิเคราะห์หลังตารางรายด้าน: สูงสุด/รองลงมา/ต่ำสุด + ความหมาย — ไม่ไล่ตัวเลขทุกค่า */
function analysisPara(sorted, pm, ctx) {
  if (!sorted.length) return "";
  const top = sorted[0].g, second = sorted[1]?.g, low = sorted[sorted.length - 1].g;
  const failed = sorted.filter((x) => x.g.total.mean < pm);
  let t = `ผลการประเมินสะท้อนว่าจุดเด่นของ${ctx}คือ${esc(top.name)} ซึ่งมีค่าเฉลี่ยสูงสุด (x̄ = ${f2(top.total.mean)})`;
  if (second && sorted.length > 2) t += ` รองลงมาคือ${esc(second.name)} (x̄ = ${f2(second.total.mean)})`;
  if (low !== top) {
    t += ` ขณะที่ด้านที่มีค่าเฉลี่ยต่ำกว่าด้านอื่นคือ${esc(low.name)} (x̄ = ${f2(low.total.mean)})`;
    t += low.total.mean >= pm
      ? ` ซึ่งยังผ่านเกณฑ์และอยู่ในระดับ${levelLabel(low.total.mean)} จึงถือเป็นประเด็นที่มีโอกาสพัฒนาในการจัดโครงการครั้งต่อไป`
      : ` ซึ่งไม่ผ่านเกณฑ์ที่กำหนด จึงควรได้รับการพิจารณาปรับปรุงเป็นลำดับต้นในการจัดโครงการครั้งต่อไป`;
  }
  if (failed.length && low.total.mean >= pm) t += ` ทั้งนี้ มีด้านที่ไม่ผ่านเกณฑ์ ${failed.length} ด้าน`;
  return wp(t);
}

/* ---------- โครงรายงานหลัก ---------- */

function buildReportBlocks(rows) {
  _reportTodos = [];
  const datasets = assembleReportDatasets(rows);
  const multi = datasets.length > 1;
  const rk = state.reportExtraIds.size ? [...state.reportExtraIds].join(",") : "solo";
  const blocks = [];
  const num = { table: 0, chart: 0, sec: 0, appTable: 0, appChart: 0, mainCharts: 0 };
  const appendix = [];
  const pm = passMark();
  const projName = state.projectName.trim();
  const projText = projName ? `โครงการ${projName.replace(/^โครงการ/, "")}` : "โครงการ";
  const filterNote = activeFilterText() ? ` (เฉพาะกลุ่ม: ${activeFilterText()})` : "";
  const totalResp = datasets.reduce((a, d) => a + d.rows.length, 0);

  // ---------- หัวรายงาน ----------
  blocks.push({
    title: "หัวรายงาน",
    html:
      `<p class="rp-doc-title" style="${W_P}text-align:center;font-weight:bold;font-size:18pt;">ผลการประเมิน${esc(projText)}</p>` +
      wp(`การประเมินผลการดำเนินการ${esc(projText)} เก็บรวบรวมข้อมูลด้วย${multi ? `แบบประเมินจำนวน ${datasets.length} ชุด` : "แบบสอบถาม"} มีผู้ตอบแบบประเมินรวมทั้งสิ้น <b>${totalResp}</b> คน${esc(filterNote)} รายละเอียดวิธีการประเมินปรากฏในส่วนที่ 1 และสรุปผลสำคัญปรากฏในบทสรุปสำหรับผู้บริหาร (ส่วนที่ 2)`),
  });

  // ---------- ส่วนที่ 1 วิธีการประเมินโครงการ (อิงชุดหลัก) ----------
  const md = datasets[0];
  blocks.push(methodologyBlock(md, num, pm, multi, datasets));

  // ---------- ส่วนที่ 2 บทสรุปสำหรับผู้บริหาร ----------
  const execB = execSummaryBlock(datasets, num, pm, multi);
  if (execB) blocks.push(execB);

  // ---------- ผลการประเมินรายชุด (ส่วนที่ 3 เป็นต้นไป เลขต่อเนื่อง) ----------
  datasets.forEach((ds, di) => {
    if (multi) {
      blocks.push({
        title: `แบบประเมินชุดที่ ${di + 1}: ${ds.label}`,
        html: `<p class="rp-sec" style="${W_P}text-align:left;font-weight:bold;font-size:17pt;margin-top:14pt;">ผลของแบบประเมินชุดที่ ${di + 1}  ${esc(ds.label)}</p>` +
          wp(`แบบประเมินชุดนี้มีผู้ตอบ ${ds.rows.length} คน${ds.respTarget ? ` จากกลุ่มเป้าหมาย ${ds.respTarget} คน คิดเป็นอัตราการตอบกลับร้อยละ ${((ds.totalAll / ds.respTarget) * 100).toFixed(2)}` : ""}`),
      });
    }
    const r = datasetBlocks(ds, num, rk);
    blocks.push(...r.blocks);
    appendix.push(...r.appendix);
  });

  // ---------- หมายเหตุเกณฑ์ ----------
  if (datasets.some((d) => d.analysis.groups.length)) {
    blocks.push({
      title: "หมายเหตุเกณฑ์การแปลผล",
      html: wp(`<b>หมายเหตุ</b> ${esc(CRITERIA_NOTE)} · เกณฑ์ความสำเร็จของโครงการ: ค่าเฉลี่ยตั้งแต่ ${pm.toFixed(2)} ขึ้นไป · แปลผลความสอดคล้อง SDGs โดยถือเกณฑ์ร้อยละ 50 ขึ้นไปของผู้ตอบแบบสอบถาม`, { indent: false, align: "left" }),
    });
  }

  // ---------- ภาคผนวก ----------
  if (state.reportOpts.appendix && appendix.length) {
    blocks.push({
      title: "ภาคผนวก",
      html: `<p class="rp-doc-title" style="${W_P}text-align:center;font-weight:bold;font-size:18pt;margin-top:16pt;">ภาคผนวก</p>` +
        wp("ภาคผนวกรวบรวมรายละเอียดประกอบผลการประเมิน ได้แก่ ตารางผลการประเมินรายข้อ ข้อมูลทั่วไปของผู้ตอบโดยละเอียด และความคิดเห็นปลายเปิดฉบับเต็ม เพื่อใช้อ้างอิงและตรวจสอบ", { indent: false, align: "left" }),
    });
    blocks.push(...appendix);
  }
  return blocks;
}

/** ส่วนที่ 1 วิธีการประเมินโครงการ: เครื่องมือ · กลุ่มผู้ตอบ · สถิติและเกณฑ์ · ข้อจำกัด */
function methodologyBlock(ds, num, pm, multi, datasets) {
  const { rows, columns } = ds;
  const groups = ds.analysis.groups;
  num.sec++;
  const s = num.sec;
  let html = secHeadHtml(s, "วิธีการประเมินโครงการ");

  // 1.1 เครื่องมือที่ใช้ — บรรยายจากองค์ประกอบที่มีจริงในแบบประเมิน
  const parts = [];
  if (columns.some((c) => c.type === "categorical")) parts.push("ข้อมูลทั่วไปของผู้ตอบ");
  if (groups.length) parts.push(`แบบมาตรประมาณค่า (Rating Scale) 5 ระดับ จำนวน ${groups.length} ด้าน รวม ${groups.reduce((a, g) => a + g.items.length, 0)} ข้อ`);
  if (ds.analysis.sdgs.length) parts.push(`การประเมินความสอดคล้องกับเป้าหมายการพัฒนาที่ยั่งยืน (SDGs) จำนวน ${ds.analysis.sdgs.length} เป้าหมาย`);
  if (columns.some((c) => c.type === "text" && !c.noReport)) parts.push("ความคิดเห็นและข้อเสนอแนะปลายเปิด");
  html += subHeadHtml(`${s}.1  เครื่องมือที่ใช้`);
  html += wp(`เครื่องมือที่ใช้ในการประเมินเป็นแบบสอบถาม${multi ? ` จำนวน ${datasets.length} ชุด` : ""} ประกอบด้วย ${joinThai(parts)} โดยเก็บรวบรวมข้อมูลจากผู้เกี่ยวข้องกับโครงการภายหลังเสร็จสิ้นการดำเนินกิจกรรม`);

  // 1.2 กลุ่มผู้ตอบแบบประเมิน — ตารางฐานผู้ตอบ + ประเด็นที่แต่ละกลุ่มประเมิน
  const statusIdx = columns.findIndex((c) => c.type === "categorical" && /สถานะ/.test(c.header));
  const bases = groupBases(rows, groups, columns);
  if (statusIdx >= 0) {
    const { entries, total } = catFreq(rows, statusIdx, columns);
    if (entries.length) {
      // ประเด็นที่ประเมินของแต่ละกลุ่ม: ดูจากด้านที่กลุ่มนั้นปรากฏเป็นผู้ตอบ
      const topicOf = (label) => {
        const gs = groups.filter((g) => respondentsOfGroup(rows, g, columns).list.some((x) => x.label === label && x.count > 0));
        if (!gs.length) return "—";
        if (gs.length === groups.length) return "ทุกด้านของแบบประเมิน";
        if (gs.length <= 2) return joinThai(gs.map((g) => g.name));
        return `${gs.length} ด้าน ได้แก่ ${gs[0].name} ${gs[1].name} ฯลฯ`;
      };
      num.table++;
      html += subHeadHtml(`${s}.2  กลุ่มผู้ตอบแบบประเมิน`);
      html += wCaption(num.table, "จำนวนและสัดส่วนของผู้ตอบแบบประเมิน จำแนกตามกลุ่มผู้ประเมิน");
      html += wTable(
        ["กลุ่มผู้ประเมิน", "จำนวน (คน)", "ร้อยละ", "ประเด็นที่ประเมิน"],
        [
          ...entries.map((e) => [cell(esc(labelOfStatus(e.label)), "left"), cell(String(e.n)), cell(e.pct.toFixed(2)), cell(esc(topicOf(e.label)), "left")]),
          [cell("รวม", "center", true), cell(String(total), "center", true), cell("100.00", "center", true), cell("—", "center", true)],
        ]
      );
    }
  } else {
    html += subHeadHtml(`${s}.2  กลุ่มผู้ตอบแบบประเมิน`);
    html += wp(`ผู้ตอบแบบประเมินเป็นผู้เข้าร่วมโครงการ จำนวน ${rows.length} คน โดยแบบประเมินไม่ได้จำแนกสถานะของผู้ตอบ`);
  }

  // 1.3 สถิติและเกณฑ์การแปลผล
  html += subHeadHtml(`${s}.3  สถิติและเกณฑ์การแปลผล`);
  html += wp(`วิเคราะห์ข้อมูลด้วยสถิติเชิงพรรณนา ได้แก่ ความถี่ (Frequency) ร้อยละ (Percentage) ค่าเฉลี่ย (x̄) และส่วนเบี่ยงเบนมาตรฐาน (S.D.) ${esc(CRITERIA_NOTE)} ทั้งนี้ โครงการหรือประเด็นการประเมินถือว่า<b>ผ่านเกณฑ์</b>เมื่อมีค่าเฉลี่ยตั้งแต่ ${pm.toFixed(2)} ขึ้นไป`);

  // 1.4 การจัดการข้อมูล — วิธีจัดการ missing + บันทึกการทำความสะอาดที่ผู้ใช้ยืนยัน
  html += subHeadHtml(`${s}.4  การจัดการข้อมูล`);
  const mgmt = [`วิเคราะห์รายข้อแบบ available-case คือคำนวณจากผู้ที่ตอบข้อนั้นจริง (ระบุจำนวนผู้ตอบ n กำกับ) โดยไม่แทนค่าที่ว่างด้วยศูนย์`];
  const hh = computeHealth();
  if (hh.missTotal) mgmt.push(`ข้อมูลมีช่องที่ไม่ได้ตอบ (missing) รวม ${hh.missTotal} ช่อง`);
  state.cleanLog.forEach((x) => {
    if (x.t === "dedup") mgmt.push(`ตรวจพบและตัดแถวข้อมูลที่ซ้ำกันทั้งแถวออก ${x.n} แถว`);
    if (x.t === "merge") mgmt.push(`รวมตัวเลือกที่สะกดต่างกัน "${x.from}" เข้ากับ "${x.to}" หลังการตรวจยืนยัน`);
  });
  mgmt.push(state.mapConfirmed ? `การจำแนกชนิดคำถามผ่านการตรวจสอบและยืนยันโดยผู้จัดทำ` : `การจำแนกชนิดคำถามใช้การตรวจอัตโนมัติของระบบ [โปรดตรวจสอบและยืนยันที่แท็บตั้งค่าคอลัมน์]`);
  mgmt.forEach((m, i2) => { html += wp(`${i2 + 1}) ${m}`, { indent: false, align: "justify" }); });

  // 1.5 ข้อจำกัดของข้อมูล — สร้างเฉพาะข้อที่เกิดขึ้นจริงกับข้อมูลชุดนี้
  const limits = [];
  if (bases.length > 1) {
    limits.push(`การประเมินบางด้านใช้กลุ่มผู้ประเมินต่างกันและมีจำนวนผู้ตอบไม่เท่ากัน ผลของแต่ละด้านจึงควรพิจารณาภายในฐานผู้ตอบของตนเอง และไม่ควรนำค่าเฉลี่ยจากคนละกลุ่มมาเปรียบเทียบกันโดยตรง`);
  }
  const tiny = bases.flatMap((b) => b.list.flatMap((x) => x.who.list.filter((st) => st.count <= 2)));
  const tinyLabels = [...new Set(tiny.map((t) => `${t.label} (${t.count} คน)`))];
  if (tinyLabels.length) {
    limits.push(`กลุ่มผู้ตอบบางกลุ่มมีจำนวนน้อยมาก ได้แก่ ${joinThai(tinyLabels)} จึงไม่ควรตีความว่าเป็นตัวแทนความคิดเห็นของกลุ่มดังกล่าวทั้งหมด`);
  }
  if (ds.analysis.sdgs.length) {
    limits.push(`ผลความสอดคล้องกับ SDGs เป็นการประเมินการรับรู้ของผู้ตอบแบบประเมิน มิใช่การประเมินผลกระทบตามตัวชี้วัด SDGs อย่างเป็นทางการ`);
  }
  if (limits.length) {
    html += subHeadHtml(`${s}.5  ข้อจำกัดของข้อมูล`);
    limits.forEach((l, i) => { html += wp(`${i + 1}) ${l}`, { indent: false, align: "justify" }); });
  }
  return { title: `ส่วนที่ ${s} วิธีการประเมินโครงการ`, html };
}

/** ส่วนที่ 2 บทสรุปสำหรับผู้บริหาร — อ่านแยกจากส่วนอื่นได้จบในหน้าเดียว */
function execSummaryBlock(datasets, num, pm, multi) {
  const allInfos = [];
  datasets.forEach((ds, di) => {
    groupBases(ds.rows, ds.analysis.groups, ds.columns).forEach((b) => {
      b.list.forEach((x) => allInfos.push({ ds, di, base: b, ...x }));
      allInfos._bases = (allInfos._bases || 0) + 1;
    });
  });
  if (!allInfos.length) return null;
  const groupCount = allInfos.length;
  const passCount = allInfos.filter((x) => x.g.total.mean >= pm).length;
  const means = allInfos.map((x) => x.g.total.mean);
  const mn = Math.min(...means), mx = Math.max(...means);
  const meanOfMeans = means.reduce((a, b) => a + b, 0) / means.length;
  const sortAll = [...allInfos].sort((a, b) => b.g.total.mean - a.g.total.mean);
  const top = sortAll[0], low = sortAll[sortAll.length - 1];
  const allOk = passCount === groupCount;
  const totalResp = datasets.reduce((a, d) => a + d.rows.length, 0);
  const allSdgs = datasets.flatMap((d) => d.analysis.sdgs);
  const okSdg = allSdgs.filter((x) => x.pct >= 50);
  const cc = codeComments(datasets[0].rows, datasets[0].columns);
  const impTop = cc.improve.filter((t) => t.key !== "other").slice(0, 3).map((t) => t.name);

  num.sec++;
  const s = num.sec;
  let html = secHeadHtml(s, "บทสรุปผลการประเมินสำหรับผู้บริหาร");

  let p1 = `ผลการประเมินสะท้อนว่า${allOk ? "โครงการได้รับการประเมินในเชิงบวก โดยผลการประเมินทุกด้านผ่านเกณฑ์ที่กำหนด" : `โครงการผ่านเกณฑ์ความสำเร็จ ${passCount} จากทั้งหมด ${groupCount} ด้าน`} มีผู้ตอบแบบประเมินรวม ${totalResp} คน${allInfos._bases > 1 ? ` จากผู้ประเมิน ${allInfos._bases} กลุ่ม` : ""} ค่าเฉลี่ยรายด้านอยู่ระหว่าง ${f2(mn)} ถึง ${f2(mx)} คะแนน จุดแข็งสำคัญคือ${esc(top.g.name)} (x̄ = ${f2(top.g.total.mean)} ระดับ${levelLabel(top.g.total.mean)}) ขณะที่ด้านที่มีค่าเฉลี่ยต่ำกว่าด้านอื่นคือ${esc(low.g.name)} (x̄ = ${f2(low.g.total.mean)})${low.g.total.mean >= pm ? ` แม้ยังผ่านเกณฑ์และอยู่ในระดับ${levelLabel(low.g.total.mean)} จึงถือเป็นประเด็นที่มีโอกาสพัฒนา` : " ซึ่งไม่ผ่านเกณฑ์และควรได้รับการปรับปรุง"}`;
  if (okSdg.length) p1 += ` นอกจากนี้ ผู้ตอบรับรู้ว่าโครงการสอดคล้องกับเป้าหมายการพัฒนาที่ยั่งยืน ${okSdg.length} จาก ${allSdgs.length} เป้าหมายที่ประเมิน`;
  html += wp(p1);
  if (impTop.length) {
    html += wp(`เมื่อพิจารณาร่วมกับความคิดเห็นปลายเปิด พบว่าประเด็นที่ควรให้ความสำคัญในการจัดโครงการครั้งต่อไป ได้แก่ ${joinThai(impTop)} (รายละเอียดในส่วนการวิเคราะห์ความคิดเห็นและข้อเสนอแนะ)`);
  }
  // ข้อสรุปการบรรลุวัตถุประสงค์ — สรุปได้เฉพาะเมื่อผู้ใช้เชื่อมวัตถุประสงค์กับตัวชี้วัดแล้ว (Objective Mapping)
  const oe = evalObjectives(groupBases(datasets[0].rows, datasets[0].analysis.groups, datasets[0].columns), pm);
  let verdict;
  if (oe && oe.evaluable > 0) {
    if (oe.reached === oe.total) verdict = `โครงการบรรลุวัตถุประสงค์ครบทั้ง ${oe.total} ข้อ และผลการประเมินผ่านเกณฑ์ ${passCount}/${groupCount} ด้าน`;
    else if (oe.reached > 0) verdict = `โครงการบรรลุวัตถุประสงค์ ${oe.reached} จาก ${oe.evaluable} ข้อที่มีตัวชี้วัดรองรับ${oe.unresolved ? ` (อีก ${oe.unresolved} ข้อข้อมูลไม่เพียงพอสำหรับสรุป)` : ""}`;
    else verdict = `โครงการยังไม่บรรลุวัตถุประสงค์ตามเกณฑ์ที่กำหนด (0 จาก ${oe.evaluable} ข้อที่มีตัวชี้วัดรองรับ)`;
  } else {
    verdict = `ผลการประเมิน${allOk ? `ทั้ง ${groupCount} ด้าน` : `${passCount} จาก ${groupCount} ด้าน`}ผ่านเกณฑ์ที่กำหนด อย่างไรก็ตาม ยังไม่สามารถสรุปการบรรลุวัตถุประสงค์โครงการได้ เนื่องจากยังไม่ได้กำหนดความสัมพันธ์ระหว่างวัตถุประสงค์และตัวชี้วัด`;
  }
  html += wp(`<b>ข้อสรุป: ${verdict}</b> (เกณฑ์ความสำเร็จ: ค่าเฉลี่ยตั้งแต่ ${pm.toFixed(2)} ขึ้นไป)`, { indent: false, align: "left" });

  // ตารางสรุปรายด้าน แยกกลุ่มฐานด้วยแถวหัวเรื่อง — ไม่ปนฐานโดยไม่บอก และไม่เขียน n ซ้ำทุกแถว
  num.table++;
  html += wCaption(num.table, `สรุปผลการประเมินรายด้านตามเกณฑ์ความสำเร็จ (ค่าเฉลี่ย ≥ ${pm.toFixed(2)}) จำแนกตามฐานผู้ประเมิน`);
  const trs = [];
  datasets.forEach((ds, di) => {
    groupBases(ds.rows, ds.analysis.groups, ds.columns).forEach((b) => {
      trs.push([cell(`<b>ฐานผู้ประเมิน: ${esc(b.whoText)}${multi ? ` — ${esc(ds.label)}` : ""}</b>`, "left", true, 5)]);
      [...b.list].sort((x, y) => y.g.total.mean - x.g.total.mean).forEach((x) => {
        trs.push([
          cell(esc(x.g.name), "left"),
          cell(f2(x.g.total.mean)), cell(f2(x.g.total.sd)),
          cell(levelLabel(x.g.total.mean)),
          cell(x.g.total.mean >= pm ? "ผ่าน" : "ไม่ผ่าน", "center", x.g.total.mean < pm),
        ]);
      });
    });
  });
  trs.push([cell("ค่าเฉลี่ยของผลการประเมินรายด้าน", "center", true), cell(f2(meanOfMeans), "center", true), cell("—", "center", true), cell(levelLabel(meanOfMeans), "center", true), cell(meanOfMeans >= pm ? "ผ่าน" : "ไม่ผ่าน", "center", true)]);
  html += wTable(["ด้านการประเมิน", "x̄", "S.D.", "ระดับผล", "ผลตามเกณฑ์"], trs);
  html += `<p class="rp-note" style="${W_P}text-align:left;margin:2pt 0 0 0;font-size:14pt;color:#333;">หมายเหตุ: ค่าเฉลี่ยของผลการประเมินรายด้านคำนวณจากค่าเฉลี่ยรายด้านโดยไม่ถ่วงน้ำหนัก แต่ละด้านมีจำนวนผู้ตอบแตกต่างกัน จึงใช้เพื่อสรุปภาพรวมเชิงพรรณนาเท่านั้น</p>`;
  return { title: `ส่วนที่ ${s} บทสรุปสำหรับผู้บริหาร`, html };
}

/** ผลการประเมินของชุดข้อมูลหนึ่งชุด — ส่วนผลรายฐาน / วัตถุประสงค์ / SDGs / ความคิดเห็น / ข้อเสนอแนะ + ภาคผนวก */
function datasetBlocks(ds, num, rk) {
  const rows = ds.rows;
  const columns = ds.columns;
  const { groups, sdgs } = ds.analysis;
  const pm = passMark();
  const blocks = [];
  const appendix = [];
  const bases = groupBases(rows, groups, columns);
  const cc = codeComments(rows, columns);

  // ---------- ส่วนผลการประเมินรายฐานผู้ประเมิน ----------
  bases.forEach((b) => {
    num.sec++;
    const s = num.sec;
    let html = secHeadHtml(s, b.title);
    html += baseLine(b.whoText);

    // แยก "ผลลัพธ์ที่เกิดกับผู้เข้าร่วม" ออกจาก "ความพึงพอใจต่อการจัดกิจกรรม" (เฉพาะฐานหลัก)
    let satis = b.kind === "main" ? b.list.filter((x) => /พึงพอใจ/.test(x.g.name)) : [];
    let outcome = b.list.filter((x) => !satis.includes(x));
    // บางแบบประเมินทุกด้านเป็นความพึงพอใจ — รายงานเป็นผลรายด้านตามปกติ ไม่ต้องแยกหมวดซ้อน
    if (!outcome.length) { outcome = satis; satis = []; }
    let sub = 0;

    if (outcome.length) {
      sub++;
      num.table++;
      html += subHeadHtml(`${s}.${sub}  ${b.kind === "main" ? "ผลลัพธ์ที่เกิดกับผู้เข้าร่วมโครงการ" : "ผลการประเมินรายด้าน"}`);
      const useRank = b.kind === "minor";
      html += wCaption(num.table, `ค่าเฉลี่ย ส่วนเบี่ยงเบนมาตรฐาน และระดับผลการประเมิน เรียงตามค่าเฉลี่ยจากมากไปน้อย`);
      const { sorted, html: tbl } = groupSummaryTable(outcome, pm, { rank: useRank });
      html += tbl;
      html += analysisPara(sorted, pm, b.kind === "main" ? "โครงการ" : "การประเมินโดยกลุ่มผู้จัดและบุคลากร");
      if (b.kind === "minor") {
        const lowest = sorted[sorted.length - 1];
        if (lowest && sorted.length > 1) html += wp(`ผู้ประเมินมีความเห็นว่าองค์ประกอบที่ได้รับการพัฒนาชัดเจนที่สุดคือ${esc(sorted[0].g.name)} ส่วน${esc(lowest.g.name)}มีคะแนนต่ำกว่าองค์ประกอบอื่น บ่งชี้ว่าการจัดโครงการครั้งต่อไปอาจเพิ่มกิจกรรมที่ส่งเสริมด้านดังกล่าวให้ชัดเจนขึ้น`);
      }
    }

    if (satis.length) {
      sub++;
      html += subHeadHtml(`${s}.${sub}  ความพึงพอใจต่อการจัดกิจกรรม`);
      if (satis.length > 1) {
        num.table++;
        html += wCaption(num.table, "ค่าเฉลี่ย ส่วนเบี่ยงเบนมาตรฐาน และระดับความพึงพอใจรายด้าน เรียงตามค่าเฉลี่ยจากมากไปน้อย");
        html += groupSummaryTable(satis, pm).html;
      }
      // รายข้อความพึงพอใจทั้งหมด (รวมทุกด้านพึงพอใจ) — สรุปเฉพาะภาพรวม + สูงสุด/ต่ำสุด 3 รายการ
      const items = satis.flatMap((x) => x.g.items.filter((it) => it.stats.n > 0));
      const pooled = statsFromVals(satis.flatMap((x) => x.g._vals));
      const si = [...items].sort((a, b2) => b2.stats.mean - a.stats.mean);
      let t = `ความพึงพอใจต่อการจัดกิจกรรมในภาพรวมอยู่ในระดับ${levelLabel(pooled.mean)} (x̄ = ${f2(pooled.mean)}, S.D. = ${f2(pooled.sd)}) ${pooled.mean >= pm ? "ผ่าน" : "ไม่ผ่าน"}เกณฑ์ความสำเร็จที่กำหนด`;
      if (si.length > 6) {
        const top3 = si.slice(0, 3), low3 = si.slice(-3).reverse();
        t += ` รายการที่ผู้ตอบพึงพอใจสูงสุด 3 อันดับแรก ได้แก่ ${joinThai(top3.map((it) => `${it.label} (x̄ = ${f2(it.stats.mean)})`))} ส่วนรายการที่มีค่าเฉลี่ยต่ำกว่ารายการอื่น ได้แก่ ${joinThai(low3.map((it) => `${it.label} (x̄ = ${f2(it.stats.mean)})`))} รายละเอียดรายข้อปรากฏในภาคผนวก`;
      }
      html += wp(t);
      if (si.length > 1) {
        const lowIt = si[si.length - 1];
        html += wp(`ข้อค้นพบนี้บ่งชี้ว่ารายการที่มีค่าเฉลี่ยต่ำกว่ารายการอื่น${lowIt.stats.mean >= pm ? " แม้ยังอยู่ในระดับที่ผ่านเกณฑ์ " : " "}ควรได้รับการพิจารณาเป็นลำดับต้นในการวางแผนจัดกิจกรรมครั้งต่อไป`);
      }
    }

    // กราฟที่ 1 ของเล่ม: ค่าเฉลี่ยรายด้านของฐานหลักทั้งหมด (ห้ามรวมข้อมูลต่างฐานในกราฟเดียว)
    if (state.reportOpts.charts && b.kind === "main" && b.list.length > 1 && num.mainCharts < 1) {
      num.mainCharts++;
      num.chart++;
      const sortedAll = [...b.list].sort((x, y) => y.g.total.mean - x.g.total.mean);
      const names = sortedAll.map((x) => x.g.name);
      const gMeans = sortedAll.map((x) => x.g.total.mean);
      const url = cachedChartURL(`${rk}|${ds.key}|mainbar|${pm}`, () =>
        chartToDataURL(cfgMeanBar(names, gMeans, themeVars(true), null, { passLine: pm, passLabel: `เกณฑ์ ${pm.toFixed(2)}` }), 860, Math.max(220, names.length * 50 + 70)));
      html += chartImg(url, num.chart, `ค่าเฉลี่ยผลการประเมินรายด้านจาก${b.title.replace(/^ผลการประเมินจาก/, "")} (n = ${b.n}) เรียงจากมากไปน้อย เส้นประคือเกณฑ์ความสำเร็จ`);
    }
    blocks.push({ title: `ส่วนที่ ${s} ${b.title}`, html });
  });

  // ---------- ส่วนการบรรลุวัตถุประสงค์ของโครงการ ----------
  const objBlock = objectivesBlock(ds, num, pm, bases);
  if (objBlock) blocks.push(objBlock);

  // ---------- ส่วน SDGs ----------
  if (sdgs.length) {
    num.sec++;
    const s = num.sec;
    num.table++;
    let html = secHeadHtml(s, "ความสอดคล้องกับเป้าหมายการพัฒนาที่ยั่งยืน (SDGs)");
    html += wCaption(num.table, "ร้อยละของผู้ตอบที่เห็นว่าโครงการสอดคล้องกับเป้าหมายการพัฒนาที่ยั่งยืน");
    html += wTable(
      ["เป้าหมายการพัฒนาที่ยั่งยืน", "เห็นว่าสอดคล้อง (คน)", "ร้อยละ", "ข้อสรุป"],
      sdgs.map((x) => [cell(esc(x.header), "left"), cell(`${x.agree}/${x.n}`), cell(x.pct.toFixed(2)), cell(x.pct >= 50 ? "สอดคล้อง" : "ไม่สอดคล้อง", "center", x.pct < 50)])
    );
    const ok = sdgs.filter((x) => x.pct >= 50);
    let narr = ok.length
      ? `ผู้ตอบแบบประเมินส่วนใหญ่รับรู้ว่าโครงการสนับสนุนเป้าหมายการพัฒนาที่ยั่งยืน ${ok.length} จาก ${sdgs.length} เป้าหมายที่ประเมิน ได้แก่ ${joinThai(ok.map((x) => x.short))} ผ่านการดำเนินกิจกรรมและผลลัพธ์ของโครงการ`
      : `ผู้ตอบแบบประเมินส่วนใหญ่ยังไม่เห็นว่าโครงการสอดคล้องกับเป้าหมายการพัฒนาที่ยั่งยืนที่ประเมิน`;
    narr += ` ทั้งนี้ ผลดังกล่าวเป็นการประเมินการรับรู้ของผู้ตอบแบบประเมิน มิใช่การประเมินผลกระทบตามตัวชี้วัด SDGs ระดับประเทศหรือระดับสากล`;
    html += wp(narr);
    blocks.push({ title: `ส่วนที่ ${s} SDGs`, html });
  }

  // ---------- ส่วนผลคำถามเชิงหมวดหมู่ (เช่น ฐานกิจกรรมที่ประทับใจมากที่สุด) ----------
  const catQCols = columns.filter((c) => c.type === "categorical" && c.catQ && !c.noReport && !c.mergeInto);
  if (catQCols.length) {
    num.sec++;
    const sq = num.sec;
    let qh = secHeadHtml(sq, "ผลคำถามเชิงหมวดหมู่");
    catQCols.forEach((c) => {
      const { entries, total } = catFreq(rows, c.i, columns);
      if (!entries.length) return;
      num.table++;
      qh += wCaption(num.table, `จำนวนและร้อยละของคำตอบ "${c.header}" เรียงตามความถี่ (ผู้ตอบ ${total} คน)`);
      qh += wTable(
        [esc(c.header), "จำนวน (คน)", "ร้อยละ", "ลำดับ"],
        entries.slice(0, 15).map((e, i2) => [cell(esc(e.label), "left"), cell(String(e.n)), cell(e.pct.toFixed(2)), cell(String(i2 + 1))])
      );
      qh += wp(`คำตอบที่ถูกเลือกมากที่สุดคือ${esc(entries[0].label)} (${entries[0].n} คน คิดเป็นร้อยละ ${entries[0].pct.toFixed(2)})${entries.length > 15 ? ` ทั้งนี้ ตารางแสดงเฉพาะ 15 อันดับแรกจากทั้งหมด ${entries.length} ค่า` : ""}`);
    });
    blocks.push({ title: `ส่วนที่ ${sq} ผลคำถามเชิงหมวดหมู่`, html: qh });
  }

  // ---------- ส่วนการวิเคราะห์ความคิดเห็นปลายเปิด ----------
  if (cc.total > 0) {
    num.sec++;
    const s = num.sec;
    let html = secHeadHtml(s, "การวิเคราะห์ความคิดเห็นและข้อเสนอแนะปลายเปิด");
    html += wp(`ความคิดเห็นปลายเปิดมีทั้งสิ้น ${cc.total} รายการ เป็นความคิดเห็นที่มีสาระต่อการวิเคราะห์ ${cc.substantive} รายการ (ตัดคำตอบที่ไม่มีสาระ เช่น "ไม่มี" ออก ${cc.dropped} รายการ) ผู้จัดทำได้จัดกลุ่มความคิดเห็นเป็นประเด็น (Theme) โดยความคิดเห็นหนึ่งรายการอาจถูกนับในหลายประเด็นหากกล่าวถึงหลายเรื่อง ดังนี้`);
    const themeTable = (list, capt) => {
      if (!list.length) return "";
      num.table++;
      let h = wCaption(num.table, capt);
      h += wTable(
        ["ประเด็น (Theme)", "จำนวนความคิดเห็น", "ความคิดเห็นตัวแทน"],
        list.map((t) => [cell(esc(t.name), "left"), cell(String(t.count)), cell(t.samples.length ? t.samples.map((x) => `“${esc(x)}”`).join("<br>") : "—", "left")])
      );
      return h;
    };
    html += themeTable(cc.like,"ประเด็นที่ผู้เข้าร่วมชื่นชอบ จากความคิดเห็นปลายเปิด");
    html += themeTable(cc.improve, "ประเด็นที่ผู้เข้าร่วมเห็นว่าควรปรับปรุง จากความคิดเห็นปลายเปิด");

    // กราฟที่ 2 ของเล่ม: จำนวนความคิดเห็นตามประเด็นที่ควรปรับปรุง (เมื่อนับได้เป็นระบบ)
    const impReal = cc.improve.filter((t) => t.key !== "other");
    if (state.reportOpts.charts && impReal.length >= 3 && num.mainCharts < 2) {
      num.mainCharts++;
      num.chart++;
      const url = cachedChartURL(`${rk}|${ds.key}|themes`, () =>
        chartToDataURL(cfgCountBar(impReal.map((t) => t.name), impReal.map((t) => t.count), themeVars(true), { endLabels: impReal.map((t) => String(t.count)) }), 860, Math.max(180, impReal.length * 48 + 60)));
      html += chartImg(url, num.chart, "จำนวนความคิดเห็นปลายเปิด จำแนกตามประเด็นที่ควรปรับปรุง");
    }

    // สรุปเชิงวิเคราะห์: เชื่อมความเห็นกับผลเชิงปริมาณ
    const allSorted = bases.flatMap((b) => b.list).sort((a, b2) => a.g.total.mean - b2.g.total.mean);
    const lowG = allSorted[0];
    if (impReal.length && lowG) {
      html += wp(`เมื่อพิจารณาร่วมกับผลเชิงปริมาณ พบว่าประเด็นที่ถูกกล่าวถึงมากในความคิดเห็นปลายเปิด ได้แก่ ${joinThai(impReal.slice(0, 3).map((t) => t.name))} สอดคล้องกับด้านที่มีค่าเฉลี่ยต่ำกว่าด้านอื่นคือ${esc(lowG.g.name)} (x̄ = ${f2(lowG.g.total.mean)}) จึงควรให้ความสำคัญกับการบริหารจัดการด้านดังกล่าวในการจัดโครงการครั้งต่อไป`);
    }
    blocks.push({ title: `ส่วนที่ ${s} วิเคราะห์ความคิดเห็นปลายเปิด`, html });
  }

  // ---------- ส่วนข้อเสนอแนะเพื่อการพัฒนาโครงการครั้งต่อไป ----------
  const recBlock = recommendationsBlock(ds, num, pm, bases, cc);
  if (recBlock) blocks.push(recBlock);

  // ---------- ภาคผนวก ----------
  appendix.push(...appendixBlocks(ds, num, rk, bases));

  return { blocks, appendix };
}

/** ประเมินการบรรลุวัตถุประสงค์ (คำนวณอย่างเดียว — ใช้ทั้งบทสรุปผู้บริหารและส่วนวัตถุประสงค์) */
function evalObjectives(bases, pm) {
  const objText = String(state.reportOpts.objectives || "").trim();
  if (!objText) return null;
  const lines = objText.split("\n").map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return null;
  const allG = bases.flatMap((b) => b.list);
  let reached = 0, unresolved = 0;
  const rows = lines.map((line) => {
    const [obj, indPart] = line.split("|").map((x) => (x || "").trim());
    let matched = [];
    if (indPart) {
      const wants = indPart.split(",").map((x) => x.trim()).filter(Boolean);
      matched = allG.filter((x) => wants.some((w) => x.g.name.includes(w) || w.includes(x.g.name)));
    }
    if (!matched.length) { unresolved++; return { obj, indPart, matched, insufficient: true }; }
    const meanM = matched.reduce((a, x) => a + x.g.total.mean, 0) / matched.length;
    const ok = meanM >= pm;
    if (ok) reached++;
    return { obj, indPart, matched, meanM, ok };
  });
  return { rows, total: lines.length, reached, unresolved, evaluable: lines.length - unresolved };
}

/** ส่วนการบรรลุวัตถุประสงค์ — จับคู่วัตถุประสงค์ (ผู้ใช้กรอก) กับด้านการประเมิน */
function objectivesBlock(ds, num, pm, bases) {
  const oe = evalObjectives(bases, pm);
  if (!oe) {
    if (bases.length) addTodo("ยังไม่ได้กรอกวัตถุประสงค์โครงการ — รายงานจะไม่สรุปการบรรลุวัตถุประสงค์ (กรอกได้ในตั้งค่ารายงาน)");
    return null;
  }
  num.sec++;
  const s = num.sec;
  num.table++;
  let html = secHeadHtml(s, "การบรรลุวัตถุประสงค์ของโครงการ");
  html += wp(`ผู้จัดทำนำวัตถุประสงค์ของโครงการมาเชื่อมโยงกับผลการประเมินด้านที่เกี่ยวข้องโดยตรง โดยถือเกณฑ์ความสำเร็จที่ค่าเฉลี่ยตั้งแต่ ${pm.toFixed(2)} ขึ้นไป ดังตารางที่ ${num.table}`);
  html += wCaption(num.table, "การบรรลุวัตถุประสงค์ของโครงการ เทียบกับตัวชี้วัดจากผลการประเมิน");
  const trows = oe.rows.map((r) => {
    if (r.insufficient) {
      if (r.indPart) addTodo(`วัตถุประสงค์ “${r.obj.slice(0, 40)}…” ระบุด้าน “${r.indPart}” แต่จับคู่กับด้านการประเมินไม่ได้ — ตรวจชื่อด้านให้ตรง`);
      return [cell(esc(r.obj), "left"), cell("—", "left"), cell("—"), cell(`≥ ${pm.toFixed(2)}`), cell("ข้อมูลไม่เพียงพอสำหรับสรุป", "center", true)];
    }
    return [
      cell(esc(r.obj), "left"),
      cell(esc(r.matched.map((x) => x.g.name).join(", ")), "left"),
      cell(f2(r.meanM)),
      cell(`≥ ${pm.toFixed(2)}`),
      cell(r.ok ? "บรรลุ" : "ไม่บรรลุ", "center", !r.ok),
    ];
  });
  html += wTable(["วัตถุประสงค์โครงการ", "ตัวชี้วัดที่ใช้พิจารณา (ด้านการประเมิน)", "ผลการประเมิน (x̄)", "เกณฑ์", "ข้อสรุป"], trows);
  const { reached, unresolved } = oe;
  const lines = { length: oe.total };
  const evaluable = oe.evaluable;
  let concl;
  if (!evaluable) concl = "วัตถุประสงค์ทุกข้อยังไม่มีตัวชี้วัดจากแบบประเมินรองรับ จึงไม่สามารถยืนยันการบรรลุวัตถุประสงค์จากข้อมูลชุดนี้ได้";
  else if (reached === lines.length) concl = "โครงการบรรลุวัตถุประสงค์ครบทุกข้อตามเกณฑ์ที่กำหนด";
  else if (reached === evaluable) concl = `โครงการบรรลุวัตถุประสงค์ที่มีตัวชี้วัดรองรับทั้ง ${evaluable} ข้อ${unresolved ? ` ส่วนอีก ${unresolved} ข้อมีข้อมูลไม่เพียงพอสำหรับสรุป` : ""}`;
  else concl = `โครงการบรรลุวัตถุประสงค์ ${reached} จาก ${evaluable} ข้อที่มีตัวชี้วัดรองรับ${unresolved ? ` และอีก ${unresolved} ข้อมีข้อมูลไม่เพียงพอสำหรับสรุป` : ""}`;
  html += wp(`จากตารางที่ ${num.table} สรุปได้ว่า ${concl}`);
  return { title: `ส่วนที่ ${s} การบรรลุวัตถุประสงค์`, html };
}

/** ส่วนข้อเสนอแนะเพื่อการพัฒนา — แปลงประเด็นจากความคิดเห็น + ด้านคะแนนต่ำ เป็นแนวทางปฏิบัติ */
function recommendationsBlock(ds, num, pm, bases, cc) {
  const impReal = cc.improve.filter((t) => t.key !== "other" && t.fix);
  const allSorted = bases.flatMap((b) => b.list).sort((a, b2) => a.g.total.mean - b2.g.total.mean);
  const failed = allSorted.filter((x) => x.g.total.mean < pm);
  if (!impReal.length && !failed.length) return null;
  num.sec++;
  const s = num.sec;
  num.table++;
  let html = secHeadHtml(s, "ข้อเสนอแนะเพื่อการพัฒนาโครงการครั้งต่อไป");
  html += wp(`ผู้จัดทำแปลงข้อค้นพบจากผลการประเมินและความคิดเห็นปลายเปิดเป็นแนวทางที่นำไปปฏิบัติได้ ดังตารางที่ ${num.table}`);
  html += wCaption(num.table, "ข้อเสนอแนะเพื่อการพัฒนาการจัดโครงการครั้งต่อไป");
  const trows = [];
  impReal.slice(0, 6).forEach((t) => {
    trows.push([
      cell(esc(t.name), "left"),
      cell(`ความคิดเห็นปลายเปิด ${t.count} รายการ`, "left"),
      cell(esc(t.fix), "left"),
      cell(esc(t.own), "left"),
      cell(esc(t.when), "left"),
    ]);
  });
  failed.forEach((x) => {
    trows.push([
      cell(esc(x.g.name), "left"),
      cell(`ค่าเฉลี่ย ${f2(x.g.total.mean)} ต่ำกว่าเกณฑ์ ${pm.toFixed(2)}`, "left"),
      cell(`ทบทวนการออกแบบกิจกรรมที่เกี่ยวข้องกับ${esc(x.g.name)} โดยวิเคราะห์รายข้อที่มีค่าเฉลี่ยต่ำในภาคผนวกร่วมกับความคิดเห็นปลายเปิด และกำหนดผู้รับผิดชอบติดตามผลในการจัดครั้งต่อไป`, "left"),
      cell("คณะกรรมการโครงการ", "left"),
      cell("ก่อนโครงการครั้งต่อไป", "left"),
    ]);
  });
  html += wTable(["ประเด็นที่พบ", "หลักฐานจากผลประเมิน", "แนวทางปรับปรุง", "ผู้รับผิดชอบที่เกี่ยวข้อง", "ช่วงเวลาดำเนินการ"], trows);
  html += wp(`ข้อเสนอแนะข้างต้นอ้างอิงจากหลักฐานที่ปรากฏในผลการประเมินครั้งนี้ ผู้รับผิดชอบโครงการควรนำไปพิจารณาร่วมกับข้อจำกัดด้านงบประมาณและบุคลากรในการวางแผนครั้งต่อไป`);
  return { title: `ส่วนที่ ${s} ข้อเสนอแนะเพื่อการพัฒนา`, html };
}

/** ภาคผนวก: ก. ตารางรายข้อทุกด้าน (พร้อมกราฟถ้าเลือก) · ข. ข้อมูลทั่วไปโดยละเอียด · ค. ความคิดเห็นฉบับเต็ม */
function appendixBlocks(ds, num, rk, bases) {
  const rows = ds.rows, columns = ds.columns;
  const out = [];
  const withFreq = state.reportOpts.freq;
  const style = state.reportOpts.chartStyle || "summary";

  // ก. ตารางรายข้อทุกด้าน (เรียงตามฐาน → ค่าเฉลี่ยด้าน)
  const ordered = bases.flatMap((b) => [...b.list].sort((x, y) => y.g.total.mean - x.g.total.mean).map((x) => ({ ...x, base: b })));
  if (ordered.length) {
    let html = subHeadHtml("ภาคผนวก ก  ผลการประเมินรายข้อ");
    ordered.forEach((x) => {
      const g = x.g;
      const rItems = g.items.filter((it) => it.stats.n > 0);
      if (!rItems.length) return;
      num.appTable++;
      const head = withFreq
        ? ["รายการประเมิน", "n", "5", "4", "3", "2", "1", "x̄", "S.D.", "ระดับผล"]
        : ["รายการประเมิน", "n", "x̄", "S.D.", "ระดับผลการประเมิน"];
      const body = rItems.map((it) => {
        const st = it.stats;
        const base = [cell(esc(it.label), "left"), cell(String(st.n))];
        if (withFreq) [5, 4, 3, 2, 1].forEach((lv) => base.push(cell(`${st.freq[lv]}<br>(${st.n ? ((st.freq[lv] / st.n) * 100).toFixed(1) : "0.0"})`)));
        base.push(cell(f2(st.mean)), cell(f2(st.sd)), cell(levelLabel(st.mean)));
        return base;
      });
      const totalRow = [cell("รวม", "center", true), cell("")];
      if (withFreq) [5, 4, 3, 2, 1].forEach(() => totalRow.push(cell("")));
      totalRow.push(cell(f2(g.total.mean), "center", true), cell(f2(g.total.sd), "center", true), cell(levelLabel(g.total.mean), "center", true));
      body.push(totalRow);
      html += wAppCaption(num.appTable, `${g.name}${withFreq ? " (ค่าในวงเล็บคือร้อยละ)" : ""}`);
      html += `<p class="rp-note" style="${W_P}text-align:left;margin:0 0 4pt 0;font-size:14pt;color:#333;">ฐานผู้ประเมิน: ${esc(x.who.text)}</p>`;
      html += wTable(head, body);
      if (state.reportOpts.charts && (style === "mean" || style === "both")) {
        num.appChart++;
        const url = cachedChartURL(`${rk}|${ds.key}|grpM|` + g.name, () => chartToDataURL(cfgMeanBar(rItems.map((it) => it.label), rItems.map((it) => it.stats.mean), themeVars(true)), 860, Math.max(220, rItems.length * 56 + 60)));
        html += chartImg(url, num.appChart, `ค่าเฉลี่ยรายข้อ ${g.name}`, true);
      }
      if (state.reportOpts.charts && (style === "likert" || style === "both")) {
        num.appChart++;
        const url = cachedChartURL(`${rk}|${ds.key}|grpL|` + g.name, () => chartToDataURL(cfgLikert(rItems, themeVars(true)), 860, Math.max(260, rItems.length * 58 + 120)));
        html += chartImg(url, num.appChart, `ร้อยละการกระจายระดับคะแนน ${g.name}`, true);
      }
    });
    out.push({ title: "ภาคผนวก ก ผลรายข้อ", html });
  }

  // ข. ข้อมูลทั่วไปของผู้ตอบโดยละเอียด (คอลัมน์ categorical อื่นนอกจากสถานะที่สรุปไว้ในส่วนที่ 1)
  const statusIdx = columns.findIndex((c) => c.type === "categorical" && /สถานะ/.test(c.header));
  const catCols = columns.filter((c) => c.type === "categorical" && !c.catQ && !c.mergeInto && !c.noReport && c.i !== statusIdx);
  const catHtml = [];
  catCols.forEach((c) => {
    const { entries, total } = catFreq(rows, c.i, columns);
    if (!entries.length) return;
    num.appTable++;
    let h = wAppCaption(num.appTable, `จำนวนและร้อยละของผู้ตอบแบบสอบถาม จำแนกตาม${c.header}`);
    h += wTable(
      [esc(c.header), "จำนวน (คน)", "ร้อยละ"],
      [
        ...entries.map((e) => [cell(esc(e.label), "left"), cell(String(e.n)), cell(e.pct.toFixed(2))]),
        [cell("รวม", "center", true), cell(String(total), "center", true), cell("100.00", "center", true)],
      ]
    );
    catHtml.push(h);
  });
  if (catHtml.length) {
    out.push({ title: "ภาคผนวก ข ข้อมูลทั่วไป", html: subHeadHtml("ภาคผนวก ข  ข้อมูลทั่วไปของผู้ตอบแบบประเมินโดยละเอียด") + catHtml.join("") });
  }

  // ค. ความคิดเห็นปลายเปิดฉบับเต็ม
  const textCols = columns.filter((c) => c.type === "text" && !c.noReport);
  const textHtml = [];
  textCols.forEach((c) => {
    const answers = textAnswers(rows, c.i);
    if (!answers.length) return;
    let h = wp(`<b>${esc(c.header)}</b> (ผู้ตอบ ${answers.reduce((a, x) => a + x.n, 0)} คน)`, { indent: false, align: "left" });
    h += answers.map((a) => wp(`– ${esc(a.text)}${a.n > 1 ? ` (จำนวน ${a.n} คน)` : ""}`, { indent: false, align: "left" })).join("");
    textHtml.push(h);
  });
  if (textHtml.length) {
    out.push({ title: "ภาคผนวก ค ความคิดเห็นฉบับเต็ม", html: subHeadHtml("ภาคผนวก ค  ความคิดเห็นและข้อเสนอแนะปลายเปิดฉบับเต็ม") + textHtml.join("") });
  }
  return out;
}

function renderReport(panel, rows) {
  const blocks = buildReportBlocks(rows);
  const rd = computeReadiness();
  if (state.reportOpts.thaiNum) blocks.forEach((b) => { b.html = toThaiDigits(b.html); });
  const allHtml = () => blocks.map((b) => b.html).join("");
  const cs = state.reportOpts.chartStyle;
  const chartVal = state.reportOpts.charts ? cs : "none";

  const layout = document.createElement("div");
  layout.className = "report-page";
  layout.innerHTML = `
    <div class="rp-topbar anim-slide-l">
      <span class="rp-docname"><i data-lucide="file-text"></i> รายงานผลการประเมิน</span>
      <span class="rp-pages">${blocks.length} ส่วน</span>
      <span class="rp-ready rp-ready-${rd.level}" title="คะแนนความพร้อมของรายงาน — ดูรายละเอียดที่แท็บตรวจข้อมูล">${rd.crit.length ? "ฉบับร่าง · " : ""}ความพร้อม ${rd.score}/100</span>
      <span class="rp-topbar-sp"></span>
      <button class="btn small${state._rpOpen ? " active-btn" : ""}" id="btnRpSettings"><i data-lucide="settings-2"></i> ตั้งค่ารายงาน${_reportTodos.length ? `<span class="rp-badge">${_reportTodos.length}</span>` : ""}</button>
      <button class="btn small" id="btnCopyAll"><i data-lucide="copy"></i> คัดลอกทั้งหมด</button>
      <button class="btn small" id="btnPrint"><i data-lucide="printer"></i> พิมพ์</button>
      <button class="btn small primary" id="btnDoc"><i data-lucide="download"></i> ดาวน์โหลด .docx</button>
    </div>
    <div class="rp-drawer${state._rpOpen ? "" : " hidden"}" id="rpDrawer">
      <div class="rp-card">
        <div class="rp-title"><i data-lucide="settings-2"></i> ตั้งค่ารายงาน</div>
        <label class="rp-field"><span>ชื่อโครงการ</span>
          <input type="text" id="projName" placeholder="เช่น ค่ายวิศวฯ สานฝันสู่ชนบท ครั้งที่ 12" value="${esc(state.projectName)}"></label>
        <label class="rp-field"><span>เกณฑ์ความสำเร็จ (ค่าเฉลี่ยตั้งแต่)</span>
          <input type="number" id="passMarkInput" step="0.01" min="1" max="5" value="${passMark().toFixed(2)}"></label>
        <label class="rp-field"><span>วัตถุประสงค์โครงการ — บรรทัดละ 1 ข้อ (พิมพ์ | ตามด้วยชื่อด้านที่ใช้วัด คั่นหลายด้านด้วย , )</span>
          <textarea id="objInput" rows="4" placeholder="เช่น เพื่อเสริมสร้างความสัมพันธ์ระหว่างนักศึกษาใหม่ | ด้านการสร้างความสัมพันธ์">${esc(state.reportOpts.objectives || "")}</textarea></label>
        <label class="rp-field"><span>กราฟในเอกสาร</span>
          <select id="selChartStyle" class="coltype">
            <option value="summary" ${chartVal === "summary" ? "selected" : ""}>ตามมาตรฐานรายงาน — ไม่เกิน 2 กราฟ (แนะนำ)</option>
            <option value="mean" ${chartVal === "mean" ? "selected" : ""}>+ กราฟค่าเฉลี่ยรายข้อ (ในภาคผนวก)</option>
            <option value="likert" ${chartVal === "likert" ? "selected" : ""}>+ กราฟการกระจายคะแนน (ในภาคผนวก)</option>
            <option value="both" ${chartVal === "both" ? "selected" : ""}>+ ทั้งสองแบบ (ในภาคผนวก)</option>
            <option value="none" ${chartVal === "none" ? "selected" : ""}>ไม่แนบกราฟเลย</option>
          </select></label>
        <div class="rp-toggles">
          <label class="rp-switch"><input type="checkbox" id="ckAppendix" ${state.reportOpts.appendix ? "checked" : ""}><span class="sw"></span> แนบภาคผนวก (รายข้อ / ข้อมูลผู้ตอบ / ความคิดเห็นฉบับเต็ม)</label>
          <label class="rp-switch"><input type="checkbox" id="ckFreq" ${state.reportOpts.freq ? "checked" : ""}><span class="sw"></span> แสดงความถี่รายระดับ (5–1) ในตารางรายข้อ</label>
          <label class="rp-switch"><input type="checkbox" id="ckThai" ${state.reportOpts.thaiNum ? "checked" : ""}><span class="sw"></span> ใช้เลขไทยในเอกสาร</label>
        </div>
      </div>
      <div class="rp-drawer-side">
        <div id="todoBox"></div>
        <div id="combineBox"></div>
        <p class="rp-hint">ตัวอย่างบนจอจัดรูปแบบให้อ่านสบายตา — เมื่อคัดลอกหรือดาวน์โหลด .docx จะได้ฟอร์แมตเอกสารราชการ (TH Sarabun 16pt) โดยอัตโนมัติ${activeFilterText() ? ` · ตัวกรอง: ${esc(activeFilterText())}` : ""}</p>
      </div>
    </div>
    <div class="report-scroll anim-slide-r"><div class="paper doc-view"></div></div>`;
  panel.appendChild(layout);

  // การ์ดรายการที่ควรตรวจสอบก่อนใช้เอกสาร (รวมผลตรวจสุขภาพข้อมูล + ความพร้อมรายงาน)
  const todoBox = $("#todoBox", layout);
  const seenTodo = new Set();
  const todoAll = [...rd.crit.map((t) => ({ lv: "crit", t })), ...rd.warn.map((t) => ({ lv: "warn", t })), ..._reportTodos.map((t) => ({ lv: "info", t }))]
    .filter((x) => !seenTodo.has(x.t) && seenTodo.add(x.t));
  if (todoAll.length) {
    todoBox.className = "rp-card todo-card";
    todoBox.innerHTML = `<div class="rp-title"><i data-lucide="clipboard-check"></i> ควรตรวจสอบก่อนใช้เอกสาร (ความพร้อม ${rd.score}/100)</div>` +
      todoAll.map((x) => `<p class="todo-item todo-${x.lv}">${issueIcon(x.lv)} ${esc(x.t)}</p>`).join("");
  }
  if (rd.crit.length) {
    $(".report-scroll", layout).insertAdjacentHTML("afterbegin",
      `<div class="draft-band"><i data-lucide="file-warning"></i> ฉบับร่าง — พบปัญหาสำคัญ ${rd.crit.length} รายการที่ควรแก้ก่อนใช้เอกสารจริง (ดูที่แท็บ "ตรวจข้อมูล" หรือปุ่มตั้งค่ารายงาน)</div>`);
  }

  const paper = $(".paper", layout);
  blocks.forEach((b, i) => {
    const div = document.createElement("div");
    div.className = "report-block anim-block";
    div.style.animationDelay = (60 + i * 45) + "ms";
    div.innerHTML = `<button class="btn small blk-copy"><i data-lucide="copy"></i> คัดลอกส่วนนี้</button>` + b.html;
    $(".blk-copy", div).onclick = () => copyHtmlToClipboard(b.html);
    paper.appendChild(div);
  });

  // การ์ดรวมหลายแบบประเมิน (โหลดจากประวัติแบบ async)
  const combineBox = $("#combineBox", layout);
  (async () => {
    let sessions = [];
    try { sessions = await dbGetAll("sessions"); } catch { /* noop */ }
    sessions = sessions.filter((s) => s.id !== state.sessionId).sort((a, b) => b.savedAt - a.savedAt).slice(0, 8);
    if (!sessions.length) return;
    const sameProj = (s) => s.projectName && state.projectName && s.projectName.trim() === state.projectName.trim();
    sessions.sort((a, b) => (sameProj(b) ? 1 : 0) - (sameProj(a) ? 1 : 0));
    combineBox.className = "rp-card combine-card";
    combineBox.innerHTML = `
      <div class="rp-title"><i data-lucide="layers"></i> รวมหลายแบบประเมิน</div>
      <p class="card-sub" style="margin:0 0 8px">เลือกแบบประเมินอื่นมาต่อท้ายรายงานนี้ในเล่มเดียว (เลขตาราง/แผนภูมิต่อเนื่องกัน)</p>
      ${sessions.map((s) => `
        <label class="rp-switch combine-item">
          <input type="checkbox" data-sess="${s.id}" ${state.reportExtraIds.has(s.id) ? "checked" : ""}><span class="sw"></span>
          <span class="ci-body"><b>${esc(s.projectName || s.fileName)}</b>
          <span class="sugg-count">${s.rows.length} คำตอบ · ${new Date(s.savedAt).toLocaleDateString("th-TH")}</span></span>
          ${sameProj(s) ? '<span class="lv l4">โครงการเดียวกัน</span>' : ""}
        </label>`).join("")}`;
    refreshIcons();
    $$("input[data-sess]", combineBox).forEach((cb) => {
      cb.onchange = () => {
        const id = cb.dataset.sess;
        if (cb.checked) { state._extraCache[id] = datasetFromRecord(sessions.find((x) => x.id === id)); state.reportExtraIds.add(id); }
        else state.reportExtraIds.delete(id);
        renderActiveTab();
      };
    });
  })();

  $("#btnRpSettings").onclick = () => {
    state._rpOpen = !state._rpOpen;
    $("#rpDrawer", layout).classList.toggle("hidden", !state._rpOpen);
    $("#btnRpSettings", layout).classList.toggle("active-btn", state._rpOpen);
  };
  $("#projName").onchange = (e) => { state.projectName = e.target.value; saveSessionSnapshot(); renderActiveTab(); };
  $("#selChartStyle").onchange = (e) => {
    state.reportOpts.charts = e.target.value !== "none";
    if (e.target.value !== "none") state.reportOpts.chartStyle = e.target.value;
    renderActiveTab();
  };
  $("#passMarkInput").onchange = (e) => {
    const v = parseFloat(e.target.value);
    state.reportOpts.passMark = Number.isFinite(v) ? Math.min(5, Math.max(1, v)) : 3.51;
    renderActiveTab();
  };
  $("#objInput").onchange = (e) => { state.reportOpts.objectives = e.target.value; saveSessionSnapshot(); renderActiveTab(); };
  $("#ckAppendix").onchange = (e) => { state.reportOpts.appendix = e.target.checked; renderActiveTab(); };
  $("#ckFreq").onchange = (e) => { state.reportOpts.freq = e.target.checked; renderActiveTab(); };
  $("#ckThai").onchange = (e) => { state.reportOpts.thaiNum = e.target.checked; renderActiveTab(); };
  $("#btnCopyAll").onclick = () => copyHtmlToClipboard(allHtml());
  $("#btnPrint").onclick = () => window.print();
  $("#btnDoc").onclick = () => {
    const rd2 = computeReadiness();
    if (rd2.crit.length) {
      const okGo = confirm(`พบปัญหาสำคัญ ${rd2.crit.length} รายการ:\n• ${rd2.crit.join("\n• ")}\n\nกด "ตกลง" เพื่อดาวน์โหลดเป็นฉบับร่าง (มีข้อความกำกับในเอกสาร)\nกด "ยกเลิก" เพื่อกลับไปแก้ก่อน`);
      if (!okGo) return;
      downloadDocx(`<p style="${W_P}text-align:center;color:#b00020;font-weight:bold;">— รายงานฉบับร่าง: ยังไม่ผ่านการตรวจสอบข้อมูลและการจำแนกคำถามครบถ้วน —</p>` + allHtml());
      return;
    }
    downloadDocx(allHtml());
  };
}

/* ============================================================
   แท็บ: ประวัติ (IndexedDB — เก็บในเครื่อง ลบอัตโนมัติหลัง 15 วัน)
   ============================================================ */
function daysLeftHtml(savedAt) {
  const left = RETENTION_DAYS - Math.floor((Date.now() - savedAt) / 86400000);
  return `<span class="days-left ${left <= 3 ? "warn" : ""}">เหลือ ${Math.max(left, 0)} วัน</span>`;
}

async function buildHistoryListCard(container, { compact = false } = {}) {
  const card = cardEl(container, "ประวัติการวิเคราะห์", `เก็บไว้ในเบราว์เซอร์เครื่องนี้ และลบอัตโนมัติเมื่อครบ ${RETENTION_DAYS} วัน`, "history");
  let sessions = [];
  try { sessions = await dbGetAll("sessions"); } catch { /* ไม่รองรับ IndexedDB */ }
  sessions.sort((a, b) => b.savedAt - a.savedAt);
  if (compact) sessions = sessions.slice(0, 5);
  if (!sessions.length) {
    card.insertAdjacentHTML("beforeend", `<p class="card-sub">ยังไม่มีประวัติ — เมื่ออัปโหลดไฟล์ ระบบจะบันทึกให้อัตโนมัติ</p>`);
    refreshIcons();
    return;
  }
  const rowsHtml = sessions.map((s) => `
    <tr>
      <td class="item">${new Date(s.savedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}</td>
      <td class="item"><b>${esc(s.projectName || "(ยังไม่ระบุชื่อโครงการ)")}</b><br><span class="sugg-count">${esc(s.fileName)}</span></td>
      <td class="num">${s.rows.length}</td>
      <td class="item">${esc(s.savedBy || "-")}</td>
      <td>${daysLeftHtml(s.savedAt)}</td>
      <td style="white-space:nowrap">
        <button class="btn small" data-open="${s.id}"><i data-lucide="folder-open"></i> เปิด</button>
        <button class="btn small" data-del="${s.id}" title="ลบ"><i data-lucide="trash-2"></i></button>
      </td>
    </tr>`).join("");
  card.insertAdjacentHTML("beforeend", `
    <div class="tbl-wrap"><table class="app">
      <tr><th class="item">วันที่บันทึก</th><th class="item">โครงการ / ไฟล์</th><th>คำตอบ</th><th class="item">ผู้บันทึก</th><th>อายุข้อมูล</th><th></th></tr>
      ${rowsHtml}
    </table></div>`);
  $$("[data-open]", card).forEach((b) => (b.onclick = () => openSession(b.dataset.open)));
  $$("[data-del]", card).forEach((b) => (b.onclick = async () => {
    if (!confirm("ลบรายการนี้ออกจากประวัติ?")) return;
    await dbDelete("sessions", b.dataset.del);
    toast("ลบแล้ว");
    if (state.activeTab === "history") renderActiveTab();
    renderHistoryHome();
  }));
  refreshIcons();
}

function renderHistory(panel) {
  buildHistoryListCard(panel);
  // รายชื่อผู้ใช้งานระบบในเครื่องนี้
  (async () => {
    let users = [];
    try { users = await dbGetAll("users"); } catch { /* noop */ }
    users.sort((a, b) => b.lastSeen - a.lastSeen);
    const card = cardEl(panel, "ผู้ใช้งานระบบ", "ผู้ที่เคยเข้าสู่ระบบบนเบราว์เซอร์เครื่องนี้", "users");
    if (!users.length) {
      card.insertAdjacentHTML("beforeend", `<p class="card-sub">ยังไม่มีข้อมูลผู้ใช้งาน</p>`);
      refreshIcons();
      return;
    }
    card.insertAdjacentHTML("beforeend", `
      <div class="tbl-wrap"><table class="app">
        <tr><th class="item">ชื่อ</th><th class="item">ตำแหน่ง</th><th>ใช้งานล่าสุด</th><th>จำนวนครั้ง</th></tr>
        ${users.map((u) => `<tr><td class="item">${esc(u.name)}${state.user?.name === u.name ? ' <span class="lv l4">คนปัจจุบัน</span>' : ""}</td><td class="item">${esc(u.role || "-")}</td><td>${new Date(u.lastSeen).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}</td><td class="num">${u.uses || 1}</td></tr>`).join("")}
      </table></div>`);
    refreshIcons();
  })();
}

function renderHistoryHome() {
  const box = $("#historyHome");
  if (!box) return;
  box.innerHTML = "";
  if ($("#emptyState").classList.contains("hidden")) return;
  box.style.marginTop = "20px";
  (async () => {
    let sessions = [];
    try { sessions = await dbGetAll("sessions"); } catch { /* noop */ }
    sessions.sort((a, b) => b.savedAt - a.savedAt);
    if (sessions.length) {
      // สแต็กแบบประเมินซ้อนกันแบบพัดเอกสาร — กดเพื่อเปิดดูข้อมูล
      const cards = sessions.slice(0, 6);
      const mid = (cards.length - 1) / 2;
      const deck = document.createElement("div");
      deck.className = "deck-wrap";
      deck.innerHTML = `<h3 class="deck-title">เปิดจากโครงการล่าสุด</h3><div class="deck">` +
        cards.map((s, i) => `
          <button class="deck-card" style="--r:${((i - mid) * 5).toFixed(1)}deg;--y:${(Math.abs(i - mid) * 12).toFixed(0)}px" data-open="${s.id}" title="${esc(s.projectName || s.fileName)}">
            <span class="dc-icon"><i data-lucide="file-text"></i></span>
            <b>${esc((s.projectName || s.fileName.replace(/\.(xlsx|xls|csv).*$/i, "")).slice(0, 44))}</b>
            <span class="dc-meta">${s.rows.length} คำตอบ · ${new Date(s.savedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}</span>
            ${Number.isFinite(s.overallMean) ? `<span class="dc-score">${s.overallMean.toFixed(2)}<i>/5</i></span>` : ""}
          </button>`).join("") + `</div>`;
      box.appendChild(deck);
      $$("[data-open]", deck).forEach((b) => (b.onclick = () => openSession(b.dataset.open)));
      refreshIcons();
    }
    buildHistoryListCard(box, { compact: true });
  })();
}

/** เปิดข้อมูลจากประวัติ (ไม่ต้องอัปโหลดไฟล์ใหม่) */
async function openSession(id) {
  const s = await dbGet("sessions", id);
  if (!s) { toast("ไม่พบรายการนี้ในประวัติ"); return; }
  state.workbook = null;
  state.fileName = s.fileName;
  state.sheetName = s.sheetName;
  state.headers = s.headers;
  state.rows = s.rows;
  state.columns = detectColumns(s.headers, s.rows);
  if (s.colTypes && s.colTypes.length === state.columns.length) {
    state.columns.forEach((c, i) => Object.assign(c, s.colTypes[i]));
  }
  updateStatusCol();
  state.filterSel = {};
  state.projectName = s.projectName || "";
  state.respTarget = s.respTarget ?? null;
  state.mergedFrom = s.mergedFrom || [];
  state.mergedIds = new Set(s.mergedIds || []);
  state._preMerge = null;
  state.sessionId = s.id;
  if (s.reportOpts) state.reportOpts = { ...state.reportOpts, ...s.reportOpts };
  state.roleMap = s.roleMap || {};
  state.valueMap = s.valueMap || {};
  state.cleanLog = s.cleanLog || [];
  state.mapConfirmed = !!s.mapConfirmed;
  state.fuzzyDismissed = s.fuzzyDismissed || [];
  state.reportExtraIds = new Set();
  bumpDataVersion();

  $$(".panel").forEach((p) => (p.innerHTML = ""));
  $("#emptyState").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  $("#fileInfo").classList.remove("hidden");
  $("#sheetPicker").classList.add("hidden");
  $("#fileName").textContent = s.fileName + " (จากประวัติ)";
  $("#fileMeta").textContent = `${s.rows.length} คำตอบ · บันทึกเมื่อ ${new Date(s.savedAt).toLocaleDateString("th-TH")}`;
  renderFilterBar();
  switchTab("dashboard");
  toast("เปิดจากประวัติแล้ว");
}

/* ============================================================
   ผู้ใช้งาน (login แบบเก็บในเครื่อง)
   ============================================================ */
function updateUserChip() {
  const chip = $("#userChip");
  if (state.user) {
    chip.innerHTML = `<i data-lucide="user"></i> ${esc(state.user.name)}${state.user.role ? " · " + esc(state.user.role) : ""}`;
    chip.classList.remove("hidden");
  } else chip.classList.add("hidden");
  $("#greeting").textContent = state.user ? `สวัสดี ${state.user.name}` : "สวัสดีครับ";
  refreshIcons();
}

function showLogin() {
  $("#loginName").value = state.user?.name || "";
  $("#loginRole").value = state.user?.role || "";
  $("#loginModal").classList.remove("hidden");
  setTimeout(() => $("#loginName").focus(), 50);
}

async function doLogin() {
  const name = $("#loginName").value.trim();
  if (!name) { toast("กรุณากรอกชื่อก่อนเริ่มใช้งาน"); return; }
  const role = $("#loginRole").value.trim();
  state.user = { name, role };
  localStorage.setItem("evalUser", JSON.stringify(state.user));
  try {
    const ex = await dbGet("users", name);
    await dbPut("users", {
      name, role: role || ex?.role || "",
      firstSeen: ex?.firstSeen || Date.now(),
      lastSeen: Date.now(),
      uses: (ex?.uses || 0) + 1,
    });
  } catch { /* noop */ }
  updateUserChip();
  $("#loginModal").classList.add("hidden");
  toast(`สวัสดี ${name} ยินดีต้อนรับ`);
}

async function touchUser() {
  if (!state.user) return;
  try {
    const ex = await dbGet("users", state.user.name);
    await dbPut("users", {
      name: state.user.name, role: state.user.role || ex?.role || "",
      firstSeen: ex?.firstSeen || Date.now(),
      lastSeen: Date.now(),
      uses: (ex?.uses || 0) + 1,
    });
  } catch { /* noop */ }
}

/* ---------- คัดลอก HTML (คงรูปแบบ) ไปคลิปบอร์ด ---------- */
async function copyHtmlToClipboard(innerHtml) {
  const full = `<div style="${W_FONT}font-size:16pt;">${innerHtml}</div>`;
  const plain = innerHtml.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|tr|table)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([full], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      }),
    ]);
    toast("คัดลอกแล้ว ✓ นำไปวางใน Word ได้เลย");
  } catch {
    // fallback: execCommand
    const holder = document.createElement("div");
    holder.contentEditable = "true";
    holder.style.cssText = "position:fixed;left:-9999px;top:0;";
    holder.innerHTML = full;
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand("copy");
    sel.removeAllRanges();
    holder.remove();
    toast(ok ? "คัดลอกแล้ว ✓ นำไปวางใน Word ได้เลย" : "คัดลอกไม่สำเร็จ");
  }
}

/* ---------- ดาวน์โหลดเป็น .doc (Word เปิดได้) ---------- */
/* ---------- สร้างไฟล์ .docx จริง (OOXML) — ฝัง HTML ผ่าน altChunk ----------
   Word เวอร์ชันใหม่เปิดได้โดยไม่มีคำเตือน "รูปแบบเก่า" ต่างจาก .doc เดิม
   ตาราง/ฟอนต์/รูปกราฟ (data URI) ถูกนำเข้าโดยกลไกอ่าน HTML ของ Word */
const _crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = _crcTable[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const _u8 = (str) => new TextEncoder().encode(str);

/** zip แบบ store (ไม่บีบอัด) — พอสำหรับ .docx ขนาดเล็ก และ Word เปิดได้ */
function zipStore(files) {
  const body = [], central = [];
  let offset = 0;
  const w16 = (a, n) => a.push(n & 255, (n >>> 8) & 255);
  const w32 = (a, n) => a.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  for (const f of files) {
    const name = _u8(f.name);
    const data = typeof f.data === "string" ? _u8(f.data) : f.data;
    const crc = crc32(data);
    const lh = [];
    w32(lh, 0x04034b50); w16(lh, 20); w16(lh, 0x0800); w16(lh, 0); w16(lh, 0); w16(lh, 0);
    w32(lh, crc); w32(lh, data.length); w32(lh, data.length); w16(lh, name.length); w16(lh, 0);
    const lhU = new Uint8Array(lh);
    body.push(lhU, name, data);
    const ch = [];
    w32(ch, 0x02014b50); w16(ch, 20); w16(ch, 20); w16(ch, 0x0800); w16(ch, 0); w16(ch, 0); w16(ch, 0);
    w32(ch, crc); w32(ch, data.length); w32(ch, data.length);
    w16(ch, name.length); w16(ch, 0); w16(ch, 0); w16(ch, 0); w16(ch, 0); w32(ch, 0); w32(ch, offset);
    central.push(new Uint8Array(ch), name);
    offset += lhU.length + name.length + data.length;
  }
  const cenStart = offset;
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = [];
  w32(eocd, 0x06054b50); w16(eocd, 0); w16(eocd, 0);
  w16(eocd, files.length); w16(eocd, files.length);
  w32(eocd, cenSize); w32(eocd, cenStart); w16(eocd, 0);
  return new Blob([...body, ...central, new Uint8Array(eocd)],
    { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function makeDocx(innerHtml) {
  const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:2.5cm 2cm 2cm 3cm;} body{${W_FONT}font-size:16pt;}</style></head><body>${innerHtml}</body></html>`;
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return zipStore([
    { name: "[Content_Types].xml", data: XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="html" ContentType="text/html"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>' },
    { name: "_rels/.rels", data: XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>' },
    { name: "word/_rels/document.xml.rels", data: XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="htmlChunk" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="afchunk.html"/>' +
      '</Relationships>' },
    { name: "word/document.xml", data: XML +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<w:body><w:altChunk r:id="htmlChunk"/>' +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>' },
    { name: "word/afchunk.html", data: htmlDoc },
  ]);
}

function downloadDocx(innerHtml) {
  const blob = makeDocx(innerHtml);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const name = state.projectName.trim() ? `รายงานผลประเมิน-${state.projectName.trim()}` : "รายงานผลประเมินโครงการ";
  a.download = `${name}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  toast("ดาวน์โหลดไฟล์ .docx แล้ว");
}

/* ============================================================
   เริ่มต้น: ผูกเหตุการณ์
   ============================================================ */
function init() {
  const dz = $("#dropzone");
  const fi = $("#fileInput");

  dz.addEventListener("click", (e) => { if (e.target.id !== "btnDemo") fi.click(); });
  $("#btnBrowse").onclick = (e) => { e.stopPropagation(); fi.click(); };
  $("#btnChangeFile").onclick = () => fi.click();
  fi.onchange = () => { if (fi.files[0]) handleFile(fi.files[0]); fi.value = ""; };

  ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); }));
  dz.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  // ลากวางได้ทั้งหน้าแม้โหลดข้อมูลแล้ว
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f && /\.(xlsx|xls|csv)$/i.test(f.name)) handleFile(f);
  });

  $("#btnGuideHome").onclick = () => switchTab("guide");
  $("#btnDemo").onclick = async (e) => {
    e.stopPropagation();
    try {
      const res = await fetch("sample-data.xlsx", { cache: "no-store" });
      if (!res.ok) throw new Error("not found");
      const buf = await res.arrayBuffer();
      state.workbook = XLSX.read(buf, { type: "array", cellDates: true });
      state.fileName = "sample-data.xlsx (ตัวอย่าง)";
      loadSheet(state.workbook.SheetNames[0]);
      setupSheetPicker(state.workbook);
    } catch {
      toast("โหลดไฟล์ตัวอย่างไม่ได้ — เปิดผ่านเซิร์ฟเวอร์ หรือลากไฟล์ sample-data.xlsx มาวางแทน");
    }
  };

  $("#sheetPicker").onchange = (e) => { if (state.workbook) loadSheet(e.target.value); };
  $$(".tab-btn").forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));

  // ธีม: โหลดค่าที่ผู้ใช้เลือกไว้ + ปุ่มสลับ + ตามระบบเมื่อเป็นโหมดอัตโนมัติ
  let savedTheme = "auto";
  try { savedTheme = localStorage.getItem("evalTheme") || "auto"; } catch { /* noop */ }
  if (!THEME_META[savedTheme]) savedTheme = "auto";
  applyTheme(savedTheme);
  $("#btnTheme").onclick = cycleTheme;
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.theme === "auto" && !$("#workspace").classList.contains("hidden")) renderActiveTab();
  });

  // วาดกราฟใหม่หลังเว็บฟอนต์โหลดเสร็จ — กัน Chart.js วัดขนาดข้อความด้วยฟอนต์สำรองค้างไว้
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (!$("#workspace").classList.contains("hidden")) renderActiveTab();
    });
  }

  // ผู้ใช้งาน + ประวัติ
  try { state.user = JSON.parse(localStorage.getItem("evalUser") || "null"); } catch { state.user = null; }
  updateUserChip();
  if (!state.user) showLogin();
  else touchUser();
  $("#btnLogin").onclick = doLogin;
  $("#loginRole").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  $("#btnSwitchUser").onclick = showLogin;
  $("#btnMerge").onclick = openMergeModal;
  $("#btnUnmerge").onclick = undoMerge;
  $("#btnSendReview").onclick = () => exportProject(false);
  const brand = document.querySelector(".side-logo");
  if (brand) { brand.style.cursor = "pointer"; brand.title = "กลับหน้าแรก"; brand.onclick = goHome; }
  $("#btnConnectSheet").onclick = openSheetModal;
  $("#btnSync").onclick = syncSheet;
  purgeOldSessions().then(renderHistoryHome);
  // หน้าแรกครั้งแรกเลื่อนเข้า
  const es0 = $("#emptyState");
  if (es0 && !es0.classList.contains("hidden")) { es0.classList.remove("anim-page"); void es0.offsetWidth; es0.classList.add("anim-page"); }
  refreshIcons();
}
init();
