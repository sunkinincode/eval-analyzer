// สร้างไฟล์ sample-data.xlsx จำลองข้อมูลที่ export จาก Google Forms
// ตามโครงสร้างแบบประเมินผลการดำเนินการโครงการของสโมสร
// รัน: node tools/make-sample.js
const XLSX = require("../vendor/xlsx.full.min.js");

const rand = (() => {
  let seed = 42;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
})();

function pick(arr, weights) {
  if (!weights) return arr[Math.floor(rand() * arr.length)];
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

// คะแนน 1-5 เอนไปทางบวก (ให้เหมือนข้อมูลจริง)
const rating = (bias = 0) =>
  pick([5, 4, 3, 2, 1], [38 + bias * 6, 34, 18, 7, 3]);

const STATUS = [
  "นักศึกษา",
  "สโมสรฯ/ชุมนุม",
  "อาจารย์/บุคลากร",
  "นักเรียน",
  "ครู/ผู้บริหารโรงเรียน",
  "บุคคลทั่วไป",
];
const STATUS_W = [30, 10, 6, 32, 8, 14];

const H = {
  ts: "ประทับเวลา",
  pdpa: "คำชี้แจงและการคุ้มครองข้อมูลส่วนบุคคล (PDPA)",
  status: "สถานะของผู้ตอบแบบสอบถาม",
  sid: "รหัสนักศึกษา",
  major: "สาขา",
  year: "ชั้นปี",
  sex: "เพศ",
  grade: "ระดับชั้น",
};

const PSU = "ด้านคุณลักษณะและสมรรถนะ (PSU Identity)";
const SAT = "ความพึงพอใจต่อภาพรวมโครงการ";
const H5 = "ประเมินความสอดคล้อง 5Hs";
const QUAL = "ด้านคุณภาพกิจกรรม";
const LEARN = "ด้านการเรียนรู้และพัฒนาตนเอง";
const OVER = "ด้านภาพรวม";
const ACAD = "ประเภทวิชาการ";
const SPEC = "แบบประเมินตามวัตถุประสงค์เฉพาะของโครงการค่ายอาสาพัฒนาโรงเรียนบ้านตัวอย่าง ประจำปีการศึกษา 2569";

const matrix = (section, items) => items.map((it) => `${section} [${it}]`);

const COLS = [
  H.ts, H.pdpa, H.status, H.sid, H.major, H.year, H.sex, H.grade,
  ...matrix(PSU, [
    "ช่วยส่งเสริมความซื่อสัตย์ มีวินัย และคุณธรรม",
    "ช่วยพัฒนาทักษะทางปัญญาและการใช้ความรู้",
    "ช่วยสร้างจิตสาธารณะและการมีส่วนร่วมกับชุมชน",
  ]),
  ...matrix(SAT, [
    "รูปแบบการจัดกิจกรรมเหมาะสมและน่าสนใจ",
    "สถานที่ ระยะเวลา และสิ่งอำนวยความสะดวกเหมาะสม",
    "สามารถนำความรู้/ทักษะไปประยุกต์ใช้ได้จริง",
  ]),
  ...matrix(H5, [
    "ช่วยพัฒนาการคิดวิเคราะห์และแก้ปัญหาที่ซับซ้อน (Head/Hand)",
    "ช่วยเสริมสร้างแนวคิดนวัตกรรมและความเป็นผู้ประกอบการ (Head/Hand)",
    "ช่วยพัฒนาทักษะเทคโนโลยีและการสื่อสาร (Head/Hand/Habit)",
    "ช่วยพัฒนาความฉลาดทางอารมณ์และพฤติกรรมแบบมืออาชีพ (Head/Heart/Habit)",
  ]),
  "SDG 1 : No Poverty ขจัดความยากจน โครงการมีส่วนช่วยลดภาระค่าใช้จ่าย หรือเพิ่มโอกาสในการเข้าถึงทรัพยากรและการพัฒนาคุณภาพชีวิตของผู้เข้าร่วมหรือชุมชน",
  "SDG 3 : Good Health and Well-being สุขภาพและความเป็นอยู่ที่ดี โครงการมีส่วนส่งเสริมสุขภาพกาย สุขภาพจิต ความปลอดภัย หรือพฤติกรรมสุขภาพที่เหมาะสม",
  "SDG 4 : Quality Education การศึกษาที่มีคุณภาพ โครงการช่วยเพิ่มโอกาสในการเรียนรู้ พัฒนาความรู้ ทักษะ หรือประสบการณ์ทางการศึกษา",
  "SDG 10 : Reduced Inequalities ลดความเหลื่อมล้ำ โครงการเปิดโอกาสให้กลุ่มคนที่หลากหลายเข้าถึงกิจกรรมและประโยชน์อย่างเท่าเทียม",
  "SDG 17 : Partnerships for the Goals หุ้นส่วนเพื่อการพัฒนาที่ยั่งยืน โครงการก่อให้เกิดความร่วมมือระหว่างมหาวิทยาลัย โรงเรียน ชุมชน หรือหน่วยงานภายนอกในการพัฒนาสังคม",
  ...matrix(QUAL, [
    "กิจกรรมมีความน่าสนใจ สนุก และเหมาะสมกับผู้เข้าร่วม",
    "รูปแบบกิจกรรมช่วยให้เข้าใจเนื้อหาได้ง่าย",
    "ทีมงานดูแล ให้คำแนะนำ และอำนวยความสะดวกเป็นอย่างดี",
    "การดำเนินกิจกรรมคำนึงถึงความปลอดภัยของผู้เข้าร่วมอย่างเหมาะสม",
  ]),
  ...matrix(LEARN, [
    "ข้าพเจ้าได้รับความรู้ ทักษะ หรือประสบการณ์ใหม่จากการเข้าร่วมกิจกรรม",
    "กิจกรรมช่วยกระตุ้นให้เกิดความสนใจในการเรียนรู้มากขึ้น",
    "สิ่งที่ได้รับจากกิจกรรมสามารถนำไปใช้ในชีวิตประจำวัน การเรียน หรือการทำงานได้",
    "กิจกรรมช่วยส่งเสริมการคิด การลงมือปฏิบัติ หรือการแก้ปัญหาด้วยตนเอง",
  ]),
  ...matrix(OVER, [
    "ข้าพเจ้าพึงพอใจต่อภาพรวมของโครงการ",
    "หากมีการจัดกิจกรรมลักษณะนี้อีก ข้าพเจ้าสนใจเข้าร่วมหรือสนับสนุนอีกครั้ง",
    "ข้าพเจ้าจะแนะนำกิจกรรมลักษณะนี้ให้ผู้อื่นเข้าร่วม",
  ]),
  ...matrix(ACAD, [
    "ข้าพเจ้าได้รับความรู้หรือทักษะใหม่จากกิจกรรมทางวิชาการ",
    "ข้าพเจ้าสามารถนำความรู้หรือประสบการณ์ที่ได้รับไปประยุกต์ใช้ได้",
    "รูปแบบกิจกรรมช่วยให้เกิดความเข้าใจเนื้อหาได้ดี",
  ]),
  ...matrix(SPEC, [
    "ค่ายนี้ช่วยให้ข้าพเจ้าเข้าใจแนวทางการศึกษาต่อมากขึ้น",
    "กิจกรรมฐานการเรียนรู้ตอบโจทย์ความสนใจของข้าพเจ้า",
  ]),
  "ข้อเสนอแนะเพิ่มเติม",
];

const SUGGESTIONS = [
  "อยากให้จัดกิจกรรมแบบนี้อีกทุกปี",
  "เวลาในแต่ละฐานน้อยเกินไป อยากให้เพิ่มเวลา",
  "สถานที่ค่อนข้างร้อน อยากให้จัดในห้องที่มีแอร์",
  "พี่ ๆ ทีมงานดูแลดีมาก ประทับใจครับ",
  "อาหารว่างน้อยไปนิดหนึ่ง",
  "อยากให้มีกิจกรรมกลุ่มมากกว่านี้",
  "เสียงไมค์บางช่วงไม่ค่อยได้ยิน",
  "ขอบคุณที่มาจัดกิจกรรมให้ครับ",
  "",
  "",
  "",
  "",
];

const MAJORS = ["วิศวกรรมคอมพิวเตอร์", "วิศวกรรมไฟฟ้า", "วิศวกรรมโยธา", "วิศวกรรมเครื่องกล", "วิศวกรรมเคมี"];

const rows = [];
const N = 92;
for (let i = 0; i < N; i++) {
  const status = pick(STATUS, STATUS_W);
  const isStudentU = status === "นักศึกษา" || status === "สโมสรฯ/ชุมนุม";
  const isPupil = status === "นักเรียน";
  const day = 1 + Math.floor(rand() * 3);
  const row = {};
  row[H.ts] = `2026-07-0${day} ${9 + Math.floor(rand() * 8)}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00`;
  row[H.pdpa] = "ข้าพเจ้ารับทราบคำชี้แจงและยินยอมให้เก็บรวบรวมและใช้ข้อมูลเพื่อการประเมินผลและจัดทำรายงานโครงการตามวัตถุประสงค์ที่กำหนด";
  row[H.status] = status;
  row[H.sid] = isStudentU ? String(6500000000 + Math.floor(rand() * 99999999)) : "";
  row[H.major] = isStudentU ? pick(MAJORS) : "";
  row[H.year] = isStudentU ? pick(["ปี 1", "ปี 2", "ปี 3", "ปี 4"], [35, 30, 25, 10]) : "";
  row[H.sex] = isPupil ? pick(["ชาย", "หญิง", "ไม่ต้องการระบุ"], [45, 48, 7]) : "";
  row[H.grade] = isPupil ? pick(["ม.4", "ม.5", "ม.6"], [40, 35, 25]) : "";

  // แต่ละกลุ่มผู้ตอบตอบเฉพาะส่วนของตัวเอง (เหมือนฟอร์มจริงที่แยกเส้นทางคำถาม)
  const isStaff = status === "อาจารย์/บุคลากร";
  const answers = {
    [PSU]: isStudentU || isStaff,
    [SAT]: isStudentU || isStaff,
    [H5]: isStudentU,
    SDG: isStudentU || isStaff,
    [QUAL]: isPupil,
    [LEARN]: isPupil,
    [OVER]: true,
    [ACAD]: isPupil,
    [SPEC]: isPupil,
  };
  for (const col of COLS) {
    if (col in row) continue;
    if (col.startsWith("SDG")) {
      if (!answers.SDG) { row[col] = ""; continue; }
      const p = col.startsWith("SDG 4") ? 0.93 : col.startsWith("SDG 17") ? 0.85 : col.startsWith("SDG 3") ? 0.72 : col.startsWith("SDG 10") ? 0.66 : 0.3;
      row[col] = rand() < p ? "สอดคล้อง / บรรลุ" : "ไม่สอดคล้อง";
    } else if (col.includes("[")) {
      const section = col.slice(0, col.indexOf(" ["));
      if (!answers[section]) { row[col] = ""; continue; }
      const bias = col.startsWith(QUAL) || col.startsWith(OVER) ? 1 : col.startsWith(H5) ? -0.5 : 0;
      row[col] = rating(bias);
    } else if (col === "ข้อเสนอแนะเพิ่มเติม") {
      row[col] = pick(SUGGESTIONS);
    }
  }
  rows.push(row);
}

const ws = XLSX.utils.json_to_sheet(rows, { header: COLS });
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "การตอบแบบฟอร์ม 1");
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
require("fs").writeFileSync(__dirname + "/../sample-data.xlsx", buf);
console.log("OK: sample-data.xlsx,", rows.length, "rows,", COLS.length, "columns");
