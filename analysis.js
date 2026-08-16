/* Pure data-analysis functions. This module deliberately has no DOM or app-state access,
   so it can be tested in Node and reused by the browser UI.
   The IIFE keeps these names off the global scope: as a classic script they would otherwise
   collide with the same names app.js pulls out of EvalAnalysis. */
(function attachAnalysisApi(global) {

const RATING_TEXT = {
  "มากที่สุด": 5, "ดีมาก": 5, "เห็นด้วยอย่างยิ่ง": 5, "พึงพอใจมากที่สุด": 5,
  "มาก": 4, "ดี": 4, "เห็นด้วย": 4, "พึงพอใจมาก": 4,
  "ปานกลาง": 3, "เฉย ๆ": 3, "เฉยๆ": 3, "พอใช้": 3,
  "น้อย": 2, "ไม่เห็นด้วย": 2, "ควรปรับปรุง": 1, "น้อยที่สุด": 1, "ไม่เห็นด้วยอย่างยิ่ง": 1, "แย่": 1,
};

/* Match the most specific phrases first: “มากที่สุด” must win over “มาก”. */
const RATING_CONTAINS = [
  ["ไม่เห็นด้วยอย่างยิ่ง", 1], ["เห็นด้วยอย่างยิ่ง", 5], ["ไม่เห็นด้วย", 2], ["เห็นด้วย", 4],
  ["มากที่สุด", 5], ["น้อยที่สุด", 1], ["ควรปรับปรุง", 1], ["ปรับปรุง", 1],
  ["ดีมาก", 5], ["ปานกลาง", 3], ["พอใช้", 3], ["มาก", 4], ["น้อย", 2], ["ดี", 4],
];

function parseRating(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value >= 1 && value <= 5 ? value : null;
  const text = String(value).trim();
  if (RATING_TEXT[text] != null) return RATING_TEXT[text];
  const numeric = text.match(/^([1-5])(?:\s*[-–.(].*)?$/);
  if (numeric) return +numeric[1];
  for (const [word, score] of RATING_CONTAINS) if (text.includes(word)) return score;
  return null;
}

const isAgreeValue = (value) => /(สอดคล้อง|บรรลุ)/.test(value) && !/ไม่/.test(value);
const isSdgLikeValue = (value) => /(สอดคล้อง|บรรลุ)/.test(value);

function statsFromVals(values) {
  const n = values.length;
  const freq = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  if (!n) return { n: 0, mean: NaN, sd: NaN, freq };

  let sum = 0;
  for (const value of values) {
    sum += value;
    freq[Math.round(value)] = (freq[Math.round(value)] || 0) + 1;
  }
  const mean = sum / n;
  let squaredDifference = 0;
  for (const value of values) squaredDifference += (value - mean) ** 2;
  return { n, mean, sd: n > 1 ? Math.sqrt(squaredDifference / (n - 1)) : 0, freq };
}

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

function computeSdgs(rows, columns) {
  return columns.filter((column) => column.type === "sdg").map((column) => {
    let agree = 0;
    let n = 0;
    for (const row of rows) {
      const value = String(row[column.i] ?? "").trim();
      if (!value) continue;
      n++;
      if (isAgreeValue(value)) agree++;
    }
    const match = column.header.match(/SDG\s*(\d+)/i);
    const num = match ? +match[1] : null;
    const name = num && SDG_NAMES[num] ? SDG_NAMES[num] : null;
    return {
      header: column.header,
      short: num ? `SDG ${num}` : column.header.slice(0, 20),
      label: num ? `SDG ${num} · ${name || ""}`.trim() : column.header.slice(0, 40),
      name,
      num,
      icon: num && num >= 1 && num <= 17 ? `assets/sdg/sdg-${String(num).padStart(2, "0")}.jpg` : null,
      n, agree, disagree: n - agree,
      pct: n ? (agree / n) * 100 : 0,
    };
  }).filter((sdg) => sdg.n > 0);
}

function analyzeDataset(rows, columns) {
  const columnsByGroup = new Map();
  for (const column of columns) {
    if (column.type !== "rating") continue;
    if (!columnsByGroup.has(column.group)) columnsByGroup.set(column.group, []);
    columnsByGroup.get(column.group).push(column);
  }

  const allValues = [];
  const groups = [...columnsByGroup].map(([name, groupColumns]) => {
    const items = groupColumns.map((column) => {
      const values = [];
      for (const row of rows) {
        const value = parseRating(row[column.i]);
        if (value != null) values.push(value);
      }
      return { label: column.item, colIdx: column.i, _vals: values, stats: statsFromVals(values) };
    });
    const pooled = items.flatMap((item) => item._vals);
    allValues.push(...pooled);
    return { name, items, total: statsFromVals(pooled), _vals: pooled };
  }).filter((group) => group.items.some((item) => item.stats.n > 0));

  return { groups, overall: statsFromVals(allValues), sdgs: computeSdgs(rows, columns) };
}

const api = { analyzeDataset, computeSdgs, isAgreeValue, isSdgLikeValue, parseRating, statsFromVals };

// A classic script keeps the app usable when users open index.html directly via file://.
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.EvalAnalysis = api;

}(globalThis));
