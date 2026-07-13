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
  statusColIdx: -1,
  filterValue: null, // null = ทั้งหมด
  activeTab: "dashboard",
  charts: [],        // Chart instances ของแท็บที่แสดงอยู่
  projectName: "",
  reportOpts: { charts: true, freq: false, thaiNum: false },
  ui: { showFreq: false },
  user: null,        // { name, role } — จาก localStorage
  sessionId: null,   // id ของรายการประวัติที่กำลังทำงานอยู่
  theme: "auto",     // auto | light | dark
};

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
      headers: state.headers,
      rows: state.rows,
      colTypes: state.columns.map((c) => ({ type: c.type, group: c.group, item: c.item })),
    });
  } catch (e) { console.warn("บันทึกประวัติไม่สำเร็จ", e); }
}

/* ============================================================
   โหลดไฟล์
   ============================================================ */
function handleFile(file) {
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
  state.sheetName = sheetName;

  // หาแถวหัวตาราง: บางไฟล์มีแถวชื่อเรื่อง/แถวว่างนำหน้า — เลือกแถวแรกใน 10 แถวแรก
  // ที่มีจำนวนช่องไม่ว่างอย่างน้อย 60% ของแถวที่แน่นที่สุด
  const counts = aoa.slice(0, 10).map((r) => r.filter((v) => String(v ?? "").trim() !== "").length);
  const maxCount = Math.max(...counts);
  let hIdx = counts.findIndex((c) => c >= 2 && c >= maxCount * 0.6);
  if (hIdx < 0) hIdx = 0;

  // ความกว้างจริง = คอลัมน์ที่ยาวที่สุดในทุกแถว (กันข้อมูลคอลัมน์ท้าย ๆ ที่ไม่มีชื่อหัวหาย)
  const width = Math.max(...aoa.map((r) => r.length));
  state.headers = Array.from({ length: width }, (_, i) => {
    const h = String(aoa[hIdx][i] ?? "").trim();
    return h || `คอลัมน์ที่ ${i + 1}`;
  });
  state.rows = aoa.slice(hIdx + 1)
    .map((r) => state.headers.map((_, i) => normalizeCell(r[i])))
    .filter((r) => r.some((v) => v !== ""));
  state.columns = detectColumns(state.headers, state.rows);
  if (opts.colTypes && opts.colTypes.length === state.columns.length) {
    state.columns.forEach((c, i) => Object.assign(c, opts.colTypes[i]));
  }
  state.statusColIdx = state.columns.findIndex((c) => c.type === "categorical" && /สถานะ/.test(c.header));
  state.filterValue = null;
  state.projectName = opts.projectName ?? state.projectName;
  state.activeTab = "dashboard";
  bumpDataVersion();

  $$(".panel").forEach((p) => (p.innerHTML = ""));
  $("#emptyState").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  $("#fileInfo").classList.remove("hidden");
  $("#fileName").textContent = state.fileName;
  $("#fileMeta").textContent = `${state.rows.length} คำตอบ · ${state.headers.length} คอลัมน์`;
  renderFilterBar();
  switchTab("dashboard");
  toast(`โหลดข้อมูลแล้ว ${state.rows.length} คำตอบ`);

  if (!opts.fromHistory) {
    state.sessionId = (crypto.randomUUID && crypto.randomUUID()) || "id-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    saveSessionSnapshot();
  } else {
    state.sessionId = opts.sessionId;
  }
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

function detectColumns(headers, rows) {
  return headers.map((header, i) => {
    const values = rows.map((r) => r[i]).filter((v) => v !== "");
    const col = { i, header, type: "text", group: null, item: null };
    if (!values.length) { col.type = "ignore"; return col; }

    const strs = values.map((v) => String(v).trim());
    const distinct = [...new Set(strs)];
    const avgLen = strs.reduce((a, s) => a + s.length, 0) / strs.length;

    if (IGNORE_HEADER.test(header)) { col.type = "ignore"; return col; }
    if (ID_HEADER.test(header)) { col.type = "ignore"; return col; }

    // SDG / สองค่า สอดคล้อง–ไม่สอดคล้อง
    if (strs.every(isSdgLikeValue)) { col.type = "sdg"; return col; }

    // คะแนน 1–5
    const ratingOk = values.filter((v) => parseRating(v) != null).length / values.length;
    const bracket = header.match(/^(.*?)\s*\[(.+)\]\s*$/);
    if (ratingOk >= 0.9 && (bracket || !DEMOG_HEADER.test(header))) {
      col.type = "rating";
      if (bracket) { col.group = bracket[1].trim() || "ด้านที่ไม่ระบุชื่อ"; col.item = bracket[2].trim(); }
      else { col.group = "การประเมินรายข้ออื่น ๆ"; col.item = header; }
      return col;
    }

    // คำถามปลายเปิด (เช็คหลังคะแนน/SDG เพราะชื่อข้อคำถามคะแนนอาจมีคำเหล่านี้ปนอยู่)
    if (TEXT_HEADER.test(header)) { col.type = "text"; return col; }
    if (distinct.length <= 20 && avgLen <= 60) { col.type = "categorical"; return col; }
    col.type = "text";
    return col;
  });
}

/* ============================================================
   การกรองข้อมูล + สถิติ
   ============================================================ */
function filteredRows() {
  if (state.filterValue == null || state.statusColIdx < 0) return state.rows;
  return state.rows.filter((r) => String(r[state.statusColIdx]).trim() === state.filterValue);
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

function computeAnalysis() {
  const key = `${_dataVersion}|${state.filterValue ?? "\0"}`;
  if (_analysis && _analysisKey === key) return _analysis;
  const rows = filteredRows();

  // กลุ่มคำถามคะแนน — แปลงค่าแต่ละคอลัมน์ครั้งเดียว แล้ว pool ต่อจากค่าที่แปลงแล้ว
  const cols = state.columns.filter((c) => c.type === "rating");
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
  const sdgs = computeSdgs(rows);

  _analysis = { groups, overall, sdgs };
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

function computeSdgs(rows) {
  return state.columns.filter((c) => c.type === "sdg").map((c) => {
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

function catFreq(rows, colIdx) {
  const map = new Map();
  rows.forEach((r) => {
    const v = String(r[colIdx]).trim();
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

/** บังคับความกว้างขั้นต่ำของแกน Y ให้ครอบคลุมงบป้าย — กันการวัดที่คลาดของบางเครื่อง */
function yAxisFloor(scale) {
  if (scale.axis === "y") {
    scale.width = Math.max(scale.width, Math.min(scale.chart.width * 0.48, LABEL_PX + 22));
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

/** สร้าง config กราฟแท่งแนวนอนของค่าเฉลี่ย (0–5) */
function cfgMeanBar(labels, means, t, title) {
  return {
    type: "bar",
    data: {
      labels: labels.map((l) => shortLabel(l)),
      datasets: [{
        data: means,
        backgroundColor: t.series,
        borderRadius: 4, borderSkipped: "start",
        barThickness: 18, maxBarThickness: 20,
      }],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { right: 52 } },
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
      },
      scales: {
        x: { min: 0, max: 5, grid: { color: t.grid }, border: { color: t.axis }, ticks: { stepSize: 1, color: t.muted, font: { family: FONT_STACK, size: 11 } } },
        y: { afterFit: yAxisFloor, grid: { display: false }, border: { color: t.axis }, ticks: { color: t.secondary, font: { family: FONT_STACK, size: 11.5 }, autoSkip: false } },
      },
    },
    plugins: [endLabelPlugin],
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
    data: { labels: items.map((it) => shortLabel(it.label)), datasets },
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
        y: { stacked: true, afterFit: yAxisFloor, grid: { display: false }, border: { color: t.axis }, ticks: { color: t.secondary, font: { family: FONT_STACK, size: 11.5 }, autoSkip: false } },
      },
    },
  };
}

/** กราฟแท่งแนวนอนของจำนวน/ร้อยละ (ข้อมูลทั่วไป, SDG) */
function cfgCountBar(labels, values, t, { max = null, suffix = "", endLabels = null, title = null, tooltipTitles = null } = {}) {
  return {
    type: "bar",
    data: {
      labels: labels.map((l) => shortLabel(l)),
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
        y: { afterFit: yAxisFloor, grid: { display: false }, border: { color: t.axis }, ticks: { color: t.secondary, font: { family: FONT_STACK, size: 11.5 }, autoSkip: false } },
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
  if (state.statusColIdx < 0) return;
  const { entries, total } = catFreq(state.rows, state.statusColIdx);
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "กรองตามผู้ตอบ:";
  bar.appendChild(label);
  const mk = (text, val) => {
    const b = document.createElement("button");
    b.className = "chip" + ((state.filterValue ?? null) === val ? " active" : "");
    b.textContent = text;
    b.onclick = () => { state.filterValue = val; renderFilterBar(); renderActiveTab(); };
    bar.appendChild(b);
  };
  mk(`ทั้งหมด (${total})`, null);
  entries.forEach((e) => mk(`${e.label} (${e.n})`, e.label));
}

function switchTab(name) {
  state.activeTab = name;
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
    report: renderReport, history: renderHistory,
  }[state.activeTab];
  render(panel, rows);
  refreshIcons();
}

/* ============================================================
   แท็บ: แดชบอร์ด
   ============================================================ */
function renderDashboard(panel, rows) {
  const t = themeVars();
  const overall = overallRatingStats(rows);
  const groups = ratingGroups(rows);

  const tiles = document.createElement("div");
  tiles.className = "tiles";
  tiles.innerHTML = `
    <div class="tile hero"><div class="t-icon"><i data-lucide="users"></i></div><div><div class="t-label">ผู้ตอบแบบสอบถาม</div><div class="t-value">${rows.length}</div><div class="t-extra">คน${state.filterValue ? " · กรอง: " + esc(state.filterValue) : ""}</div></div></div>
    <div class="tile accent"><div class="t-icon"><i data-lucide="star"></i></div><div><div class="t-label">ค่าเฉลี่ยรวมทุกข้อ (x̄)</div><div class="t-value">${f2(overall.mean)}</div><div class="t-extra">จากคะแนนเต็ม 5</div></div></div>
    <div class="tile"><div class="t-icon"><i data-lucide="sigma"></i></div><div><div class="t-label">ส่วนเบี่ยงเบนมาตรฐาน (S.D.)</div><div class="t-value">${f2(overall.sd)}</div><div class="t-extra">จาก ${overall.n} คำตอบ</div></div></div>
    <div class="tile"><div class="t-icon"><i data-lucide="award"></i></div><div><div class="t-label">ระดับผลการประเมิน</div><div class="t-value" style="font-size:20px;padding-top:4px">${levelChip(overall.mean)}</div><div class="t-extra">เกณฑ์แปลผลค่าเฉลี่ย 5 ระดับ</div></div></div>`;
  panel.appendChild(tiles);

  // กลุ่มที่กรองไม่มีคำตอบแบบคะแนนเลย — แจ้งชัด ๆ แทนที่จะปล่อยตัวเลขว่าง
  if (!overall.n) {
    const note = document.createElement("div");
    note.className = "card";
    note.innerHTML = `<h3><i data-lucide="info"></i> ไม่มีคำตอบแบบคะแนน${state.filterValue ? `ในกลุ่ม "${esc(state.filterValue)}"` : "ในไฟล์นี้"}</h3>
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

  const grid = document.createElement("div");
  grid.className = "grid-2";
  panel.appendChild(grid);

  if (state.statusColIdx >= 0 && !state.filterValue) {
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
      (hidden ? ` · ซ่อน ${hidden} ข้อที่ไม่มีผู้ตอบ${state.filterValue ? "ในกลุ่มนี้" : ""}` : ""));

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
  const cols = state.columns.filter((c) => c.type === "categorical");
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
  rating: "คะแนน 1–5", sdg: "SDG / สองค่า", categorical: "ข้อมูลทั่วไป (ตัวเลือก)",
  text: "ข้อความปลายเปิด", ignore: "ไม่วิเคราะห์",
};
function renderColumns(panel) {
  const card = cardEl(panel, "ชนิดของแต่ละคอลัมน์", "ระบบตรวจให้อัตโนมัติ — เปลี่ยนชนิดได้หากตรวจผิด แล้วผลวิเคราะห์ทุกแท็บจะคำนวณใหม่ทันที · จำนวน \"ตอบแล้ว\" ที่ไม่เท่ากันเป็นเรื่องปกติ เพราะแบบฟอร์มแยกชุดคำถามตามกลุ่มผู้ตอบ");
  const N = state.rows.length;
  const rowsHtml = state.columns.map((c) => {
    const vals = state.rows.map((r) => String(r[c.i]).trim()).filter((v) => v !== "");
    const samples = [...new Set(vals)].slice(0, 3).join(" · ");
    const opts = Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}" ${c.type === v ? "selected" : ""}>${l}</option>`).join("");
    const pct = N ? Math.round((vals.length / N) * 100) : 0;
    return `<tr>
      <td class="item">${esc(c.header)}</td>
      <td class="num">${vals.length}/${N}<span class="meanbar" style="min-width:44px"><i style="width:${pct}%"></i></span></td>
      <td class="sample-vals">${esc(samples.slice(0, 90))}</td>
      <td><select class="coltype" data-col="${c.i}">${opts}</select></td>
    </tr>`;
  }).join("");
  card.insertAdjacentHTML("beforeend", `
    <div class="tbl-wrap"><table class="app">
      <tr><th class="item">คอลัมน์</th><th>ตอบแล้ว</th><th class="item">ตัวอย่างคำตอบ</th><th>ชนิดข้อมูล</th></tr>${rowsHtml}
    </table></div>`);
  $$("select.coltype", card).forEach((sel) => {
    sel.onchange = () => {
      const col = state.columns[+sel.dataset.col];
      col.type = sel.value;
      if (col.type === "rating" && !col.group) {
        const b = col.header.match(/^(.*?)\s*\[(.+)\]\s*$/);
        if (b) { col.group = b[1].trim() || "ด้านที่ไม่ระบุชื่อ"; col.item = b[2].trim(); }
        else { col.group = "การประเมินรายข้ออื่น ๆ"; col.item = col.header; }
      }
      state.statusColIdx = state.columns.findIndex((c) => c.type === "categorical" && /สถานะ/.test(c.header));
      bumpDataVersion();
      renderFilterBar();
      saveSessionSnapshot();
      toast(`เปลี่ยน "${col.header.slice(0, 30)}..." เป็น ${TYPE_LABELS[col.type]}`);
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
  return `<p style="${W_P}${align}${indent}${bold}">${text}</p>`;
}
function wCaption(no, title) {
  return `<p style="${W_P}text-align:left;margin-bottom:2pt;"><b>ตารางที่ ${no}</b>&nbsp;&nbsp;${esc(title)}</p>`;
}
function wTable(headCells, bodyRows) {
  const th = headCells.map((h) => `<td style="${W_TD}text-align:center;font-weight:bold;">${h}</td>`).join("");
  const trs = bodyRows.map((cells) =>
    `<tr>${cells.map((c) => `<td style="${W_TD}${c.align ? `text-align:${c.align};` : "text-align:center;"}${c.bold ? "font-weight:bold;" : ""}">${c.html}</td>`).join("")}</tr>`
  ).join("");
  return `<table style="border-collapse:collapse;width:100%;${W_FONT}" border="1"><tr>${th}</tr>${trs}</table>`;
}
const cell = (html, align, bold) => ({ html, align, bold });

function buildReportBlocks(rows) {
  const blocks = [];
  let tableNo = 0, chartNo = 0;
  const projName = state.projectName.trim();
  const projText = projName ? `โครงการ${projName.replace(/^โครงการ/, "")}` : "โครงการ";
  const filterNote = state.filterValue ? ` (เฉพาะกลุ่มผู้ตอบ: ${state.filterValue})` : "";

  // ---------- หัวรายงาน ----------
  blocks.push({
    title: "หัวรายงาน",
    html:
      `<p style="${W_P}text-align:center;font-weight:bold;font-size:18pt;">ผลการวิเคราะห์ข้อมูลแบบประเมินผลการดำเนินการ${esc(projText)}</p>` +
      wp(`การประเมินผลการดำเนินการ${esc(projText)} เก็บรวบรวมข้อมูลด้วยแบบสอบถามออนไลน์ มีผู้ตอบแบบสอบถามทั้งสิ้น <b>${rows.length}</b> คน${esc(filterNote)} ผู้จัดทำได้นำข้อมูลมาวิเคราะห์ด้วยสถิติเชิงพรรณนา ได้แก่ ความถี่ (Frequency) ร้อยละ (Percentage) ค่าเฉลี่ย (x̄) และส่วนเบี่ยงเบนมาตรฐาน (S.D.) โดยมีผลการวิเคราะห์ดังนี้`),
  });

  // ---------- ตอนที่ 1 ข้อมูลทั่วไป ----------
  const catCols = state.columns.filter((c) => c.type === "categorical");
  const catBlocksHtml = [];
  catCols.forEach((c) => {
    const { entries, total } = catFreq(rows, c.i);
    if (!entries.length) return;
    tableNo++;
    let html = wCaption(tableNo, `จำนวนและร้อยละของผู้ตอบแบบสอบถาม จำแนกตาม${c.header}`);
    html += wTable(
      [esc(c.header), "จำนวน (คน)", "ร้อยละ"],
      [
        ...entries.map((e) => [cell(esc(e.label), "left"), cell(String(e.n)), cell(e.pct.toFixed(2))]),
        [cell("รวม", "center", true), cell(String(total), "center", true), cell("100.00", "center", true)],
      ]
    );
    let narr = `จากตารางที่ ${tableNo} พบว่า ผู้ตอบแบบสอบถามส่วนใหญ่เป็น${esc(entries[0].label)} จำนวน ${entries[0].n} คน คิดเป็นร้อยละ ${entries[0].pct.toFixed(2)}`;
    if (entries.length > 2) narr += ` รองลงมาคือ${esc(entries[1].label)} จำนวน ${entries[1].n} คน คิดเป็นร้อยละ ${entries[1].pct.toFixed(2)} และน้อยที่สุดคือ${esc(entries[entries.length - 1].label)} จำนวน ${entries[entries.length - 1].n} คน คิดเป็นร้อยละ ${entries[entries.length - 1].pct.toFixed(2)} ตามลำดับ`;
    else if (entries.length === 2) narr += ` และ${esc(entries[1].label)} จำนวน ${entries[1].n} คน คิดเป็นร้อยละ ${entries[1].pct.toFixed(2)}`;
    html += wp(narr);
    catBlocksHtml.push(html);
  });
  if (catBlocksHtml.length) {
    blocks.push({
      title: "ตอนที่ 1 ข้อมูลทั่วไปของผู้ตอบแบบสอบถาม",
      html: wp("<b>ตอนที่ 1  ข้อมูลทั่วไปของผู้ตอบแบบสอบถาม</b>", { indent: false, align: "left" }) + catBlocksHtml.join(""),
    });
  }

  // ---------- ตอนที่ 2 ผลการประเมิน ----------
  const groups = ratingGroups(rows);
  if (groups.length) {
    const partHtml = [wp("<b>ตอนที่ 2  ผลการประเมินโครงการ</b>", { indent: false, align: "left" })];

    groups.forEach((g) => {
      tableNo++;
      const withFreq = state.reportOpts.freq;
      const rItems = g.items.filter((it) => it.stats.n > 0); // ตัดข้อที่ไม่มีผู้ตอบออกจากรายงาน
      const head = withFreq
        ? ["รายการประเมิน", "5", "4", "3", "2", "1", "x̄", "S.D.", "ระดับผล"]
        : ["รายการประเมิน", "x̄", "S.D.", "ระดับผลการประเมิน"];
      const body = rItems.map((it) => {
        const s = it.stats;
        const base = [cell(esc(it.label), "left")];
        if (withFreq) [5, 4, 3, 2, 1].forEach((lv) => base.push(cell(`${s.freq[lv]}<br>(${s.n ? ((s.freq[lv] / s.n) * 100).toFixed(1) : "0.0"})`)));
        base.push(cell(f2(s.mean)), cell(f2(s.sd)), cell(levelLabel(s.mean)));
        return base;
      });
      const totalRow = [cell("รวม", "center", true)];
      if (withFreq) totalRow.push(cell(""), cell(""), cell(""), cell(""), cell(""));
      totalRow.push(cell(f2(g.total.mean), "center", true), cell(f2(g.total.sd), "center", true), cell(levelLabel(g.total.mean), "center", true));
      body.push(totalRow);

      let html = wCaption(tableNo, `ค่าเฉลี่ย ส่วนเบี่ยงเบนมาตรฐาน และระดับผลการประเมิน ${g.name}${withFreq ? " (ค่าในวงเล็บคือร้อยละ)" : ""}`);
      html += wTable(head, body);

      const valid = rItems;
      const best = valid.reduce((a, b) => (b.stats.mean > a.stats.mean ? b : a), valid[0]);
      const worst = valid.reduce((a, b) => (b.stats.mean < a.stats.mean ? b : a), valid[0]);
      let narr = `จากตารางที่ ${tableNo} พบว่า ผลการประเมิน${esc(g.name)}ในภาพรวมอยู่ในระดับ${levelLabel(g.total.mean)} (x̄ = ${f2(g.total.mean)}, S.D. = ${f2(g.total.sd)})`;
      if (valid.length > 1) narr += ` เมื่อพิจารณาเป็นรายข้อ พบว่า ข้อที่มีค่าเฉลี่ยสูงสุด คือ ${esc(best.label)} (x̄ = ${f2(best.stats.mean)}, S.D. = ${f2(best.stats.sd)}) และข้อที่มีค่าเฉลี่ยต่ำสุด คือ ${esc(worst.label)} (x̄ = ${f2(worst.stats.mean)}, S.D. = ${f2(worst.stats.sd)})`;
      html += wp(narr);

      if (state.reportOpts.charts) {
        chartNo++;
        const url = cachedChartURL("grp|" + g.name, () => chartToDataURL(cfgMeanBar(rItems.map((it) => it.label), rItems.map((it) => it.stats.mean), themeVars(true)), 860, Math.max(220, rItems.length * 56 + 60)));
        html += `<p style="${W_P}text-align:center;margin-top:10pt;"><img src="${url}" style="width:100%;max-width:15.5cm;" alt=""></p>`;
        html += `<p style="${W_P}text-align:center;margin-top:0;"><b>แผนภูมิที่ ${chartNo}</b>&nbsp;&nbsp;ค่าเฉลี่ยผลการประเมิน${esc(g.name)}</p>`;
      }
      partHtml.push(html);
    });

    // ตารางสรุปรวมทุกด้าน
    if (groups.length > 1) {
      tableNo++;
      const overall = overallRatingStats(rows);
      let html = wCaption(tableNo, `สรุปผลการประเมินโดยรวมทุกด้าน`);
      html += wTable(
        ["ด้านการประเมิน", "x̄", "S.D.", "ระดับผลการประเมิน"],
        [
          ...groups.map((g) => [cell(esc(g.name), "left"), cell(f2(g.total.mean)), cell(f2(g.total.sd)), cell(levelLabel(g.total.mean))]),
          [cell("รวมทุกด้าน", "center", true), cell(f2(overall.mean), "center", true), cell(f2(overall.sd), "center", true), cell(levelLabel(overall.mean), "center", true)],
        ]
      );
      const sortedG = [...groups].sort((a, b) => b.total.mean - a.total.mean);
      html += wp(`จากตารางที่ ${tableNo} พบว่า ผลการประเมินโครงการโดยรวมทุกด้านอยู่ในระดับ${levelLabel(overallRatingStats(rows).mean)} (x̄ = ${f2(overallRatingStats(rows).mean)}, S.D. = ${f2(overallRatingStats(rows).sd)}) โดยด้านที่มีค่าเฉลี่ยสูงสุด คือ ${esc(sortedG[0].name)} (x̄ = ${f2(sortedG[0].total.mean)}) และด้านที่มีค่าเฉลี่ยต่ำสุด คือ ${esc(sortedG[sortedG.length - 1].name)} (x̄ = ${f2(sortedG[sortedG.length - 1].total.mean)})`);
      if (state.reportOpts.charts) {
        chartNo++;
        const url = cachedChartURL("summary", () => chartToDataURL(cfgMeanBar(groups.map((g) => g.name), groups.map((g) => g.total.mean), themeVars(true)), 860, Math.max(200, groups.length * 50 + 60)));
        html += `<p style="${W_P}text-align:center;margin-top:10pt;"><img src="${url}" style="width:100%;max-width:15.5cm;" alt=""></p>`;
        html += `<p style="${W_P}text-align:center;margin-top:0;"><b>แผนภูมิที่ ${chartNo}</b>&nbsp;&nbsp;เปรียบเทียบค่าเฉลี่ยผลการประเมินรายด้าน</p>`;
      }
      partHtml.push(html);
    }
    blocks.push({ title: "ตอนที่ 2 ผลการประเมินโครงการ", html: partHtml.join("") });
  }

  // ---------- ตอนที่ 3 SDGs ----------
  const sdgs = sdgResults(rows);
  if (sdgs.length) {
    tableNo++;
    let html = wp("<b>ตอนที่ 3  ความสอดคล้องกับเป้าหมายการพัฒนาที่ยั่งยืน (SDGs)</b>", { indent: false, align: "left" });
    html += wCaption(tableNo, "จำนวน ร้อยละ และผลการประเมินความสอดคล้องของโครงการกับเป้าหมายการพัฒนาที่ยั่งยืน (SDGs)");
    html += wTable(
      ["เป้าหมายการพัฒนาที่ยั่งยืน", "สอดคล้อง / บรรลุ (คน)", "ไม่สอดคล้อง (คน)", "ร้อยละที่สอดคล้อง", "ผลการประเมิน"],
      sdgs.map((s) => [cell(esc(s.header), "left"), cell(String(s.agree)), cell(String(s.disagree)), cell(s.pct.toFixed(2)), cell(s.pct >= 50 ? "สอดคล้อง" : "ไม่สอดคล้อง")])
    );
    const ok = sdgs.filter((s) => s.pct >= 50);
    const top = [...sdgs].sort((a, b) => b.pct - a.pct)[0];
    let narr = `จากตารางที่ ${tableNo} พบว่า ผู้ตอบแบบสอบถามประเมินว่าโครงการมีความสอดคล้องกับเป้าหมายการพัฒนาที่ยั่งยืน จำนวน ${ok.length} เป้าหมาย`;
    if (ok.length) narr += ` ได้แก่ ${ok.map((s) => esc(s.short)).join(", ")} โดยเป้าหมายที่มีความสอดคล้องสูงสุด คือ ${esc(top.header)} คิดเป็นร้อยละ ${top.pct.toFixed(2)}`;
    html += wp(narr);
    if (state.reportOpts.charts) {
      chartNo++;
      const url = cachedChartURL("sdg", () => {
        const c = cfgCountBar(sdgs.map((s) => s.label), sdgs.map((s) => +s.pct.toFixed(1)), themeVars(true), { max: 100, suffix: "%", endLabels: sdgs.map((s) => s.pct.toFixed(1) + "%") });
        return chartToDataURL(c, 860, Math.max(200, sdgs.length * 52 + 60));
      });
      html += `<p style="${W_P}text-align:center;margin-top:10pt;"><img src="${url}" style="width:100%;max-width:15.5cm;" alt=""></p>`;
      html += `<p style="${W_P}text-align:center;margin-top:0;"><b>แผนภูมิที่ ${chartNo}</b>&nbsp;&nbsp;ร้อยละความสอดคล้องของโครงการกับ SDGs</p>`;
    }
    blocks.push({ title: "ตอนที่ 3 SDGs", html });
  }

  // ---------- ตอนที่ 4 ข้อเสนอแนะ ----------
  const textCols = state.columns.filter((c) => c.type === "text");
  const textHtml = [];
  textCols.forEach((c) => {
    const answers = textAnswers(rows, c.i);
    if (!answers.length) return;
    let html = wp(`<b>${esc(c.header)}</b> (ผู้ตอบ ${answers.reduce((a, x) => a + x.n, 0)} คน)`, { indent: false, align: "left" });
    html += answers.map((a) => wp(`– ${esc(a.text)}${a.n > 1 ? ` (จำนวน ${a.n} คน)` : ""}`, { indent: false, align: "left" })).join("");
    textHtml.push(html);
  });
  if (textHtml.length) {
    blocks.push({
      title: "ตอนที่ 4 ข้อเสนอแนะ",
      html: wp("<b>ตอนที่ 4  ข้อเสนอแนะเพิ่มเติม</b>", { indent: false, align: "left" }) + textHtml.join(""),
    });
  }

  // ---------- หมายเหตุเกณฑ์ ----------
  if (groups.length) {
    blocks.push({
      title: "หมายเหตุเกณฑ์การแปลผล",
      html: wp(`<b>หมายเหตุ</b> ${esc(CRITERIA_NOTE)} และแปลผลความสอดคล้อง SDGs โดยถือเกณฑ์ร้อยละ 50 ขึ้นไปของผู้ตอบแบบสอบถาม`, { indent: false, align: "left" }),
    });
  }
  return blocks;
}

function renderReport(panel, rows) {
  const controls = document.createElement("div");
  controls.className = "report-controls";
  controls.innerHTML = `
    <input type="text" id="projName" placeholder="พิมพ์ชื่อโครงการ เช่น ค่ายวิศวฯ สานฝันสู่ชนบท ครั้งที่ 12 (จะปรากฏในหัวรายงาน)" value="${esc(state.projectName)}">
    <label class="ck"><input type="checkbox" id="ckCharts" ${state.reportOpts.charts ? "checked" : ""}> แนบรูปแผนภูมิ</label>
    <label class="ck"><input type="checkbox" id="ckFreq" ${state.reportOpts.freq ? "checked" : ""}> แสดงความถี่รายระดับ (5–1) ในตาราง</label>
    <label class="ck"><input type="checkbox" id="ckThai" ${state.reportOpts.thaiNum ? "checked" : ""}> ใช้เลขไทย</label>
    <button class="btn primary" id="btnCopyAll"><i data-lucide="copy"></i> คัดลอกรายงานทั้งหมด</button>
    <button class="btn" id="btnDoc"><i data-lucide="download"></i> ดาวน์โหลด .doc</button>
    <button class="btn" id="btnPrint"><i data-lucide="printer"></i> พิมพ์ / PDF</button>`;
  panel.appendChild(controls);

  const hint = document.createElement("p");
  hint.className = "card-sub";
  hint.style.margin = "0 0 12px";
  hint.textContent = "ชี้เมาส์ที่แต่ละส่วนแล้วกด \"คัดลอกส่วนนี้\" หรือคัดลอกทั้งหมดแล้วไปวางใน Microsoft Word ได้เลย — เมื่อวางใน Word ตัวอักษรจะเป็น TH Sarabun 16pt และตัวเลขเป็นเลขอารบิกตามแบบเอกสารราชการ (พรีวิวหน้านี้แสดงด้วยฟอนต์ระบบ)" + (state.filterValue ? ` · กำลังใช้ตัวกรอง: ${state.filterValue}` : "");
  panel.appendChild(hint);

  const paper = document.createElement("div");
  paper.className = "paper";
  panel.appendChild(paper);

  const blocks = buildReportBlocks(rows);
  if (state.reportOpts.thaiNum) blocks.forEach((b) => { b.html = toThaiDigits(b.html); });
  blocks.forEach((b) => {
    const div = document.createElement("div");
    div.className = "report-block";
    div.innerHTML = `<button class="btn small blk-copy"><i data-lucide="copy"></i> คัดลอกส่วนนี้</button>` + b.html;
    $(".blk-copy", div).onclick = () => copyHtmlToClipboard(b.html);
    paper.appendChild(div);
  });

  $("#projName").onchange = (e) => { state.projectName = e.target.value; saveSessionSnapshot(); renderActiveTab(); };
  $("#ckCharts").onchange = (e) => { state.reportOpts.charts = e.target.checked; renderActiveTab(); };
  $("#ckFreq").onchange = (e) => { state.reportOpts.freq = e.target.checked; renderActiveTab(); };
  $("#ckThai").onchange = (e) => { state.reportOpts.thaiNum = e.target.checked; renderActiveTab(); };
  $("#btnCopyAll").onclick = () => copyHtmlToClipboard(blocks.map((b) => b.html).join(""));
  $("#btnPrint").onclick = () => window.print();
  $("#btnDoc").onclick = () => downloadDoc(blocks.map((b) => b.html).join(""));
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
  if (!$("#emptyState").classList.contains("hidden")) {
    box.style.marginTop = "20px";
    buildHistoryListCard(box, { compact: true });
  }
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
  state.statusColIdx = state.columns.findIndex((c) => c.type === "categorical" && /สถานะ/.test(c.header));
  state.filterValue = null;
  state.projectName = s.projectName || "";
  state.sessionId = s.id;
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
function downloadDoc(innerHtml) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:2.5cm 2cm 2cm 3cm;} body{${W_FONT}font-size:16pt;}</style></head><body>${innerHtml}</body></html>`;
  const blob = new Blob(["﻿" + html], { type: "application/msword" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const name = state.projectName.trim() ? `รายงานผลประเมิน-${state.projectName.trim()}` : "รายงานผลประเมินโครงการ";
  a.download = `${name}.doc`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("ดาวน์โหลดไฟล์ .doc แล้ว");
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
  purgeOldSessions().then(renderHistoryHome);
  refreshIcons();
}
init();
