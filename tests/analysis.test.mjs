import assert from "node:assert/strict";
import test from "node:test";

import analysis from "../analysis.js";

const { analyzeDataset, computeSdgs, parseRating, statsFromVals } = analysis;

test("parseRating supports numbers and Thai rating labels", () => {
  assert.equal(parseRating(5), 5);
  assert.equal(parseRating("4 - มาก"), 4);
  assert.equal(parseRating("เห็นด้วยอย่างยิ่ง"), 5);
  assert.equal(parseRating("ไม่เห็นด้วยอย่างยิ่ง"), 1);
  assert.equal(parseRating("ไม่ระบุ"), null);
  assert.equal(parseRating(6), null);
});

test("statsFromVals returns sample standard deviation and frequencies", () => {
  const stats = statsFromVals([5, 4, 4, 3]);
  assert.equal(stats.n, 4);
  assert.equal(stats.mean, 4);
  assert.equal(stats.sd, Math.sqrt(2 / 3));
  assert.deepEqual(stats.freq, { 5: 1, 4: 2, 3: 1, 2: 0, 1: 0 });
});

test("computeSdgs counts agreement while ignoring empty answers", () => {
  const result = computeSdgs([["สอดคล้อง"], ["ไม่สอดคล้อง"], [""]], [{ i: 0, header: "SDG 4", type: "sdg" }]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    header: "SDG 4", short: "SDG 4", label: "SDG 4 · การศึกษาที่มีคุณภาพ",
    name: "การศึกษาที่มีคุณภาพ", num: 4, icon: "assets/sdg/sdg-04.jpg",
    n: 2, agree: 1, disagree: 1, pct: 50,
  });
});

test("analyzeDataset groups ratings and leaves invalid values out", () => {
  const columns = [
    { i: 0, header: "ด้านกิจกรรม [ข้อ 1]", type: "rating", group: "ด้านกิจกรรม", item: "ข้อ 1" },
    { i: 1, header: "ด้านกิจกรรม [ข้อ 2]", type: "rating", group: "ด้านกิจกรรม", item: "ข้อ 2" },
  ];
  const result = analyzeDataset([[5, "มาก"], [4, "ไม่ระบุ"]], columns);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].items[1].stats.n, 1);
  assert.equal(result.overall.n, 3);
  assert.equal(result.overall.mean, 13 / 3);
});
