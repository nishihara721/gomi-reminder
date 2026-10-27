import assert from "node:assert/strict";
import {
  buildMessage, garbageOn, jstToday, scheduleFrom, upcoming, validateRules, validateSkipDates, type UserSchedule,
} from "./schedule";

const s: UserSchedule = {
  rules: [
    { name: "燃えるゴミ", emoji: "🔥", days: [1, 4] },
    { name: "プラスチック", emoji: "♻️", days: [3] },
    { name: "資源ゴミ", emoji: "🥫", days: [5], weeks: [2, 4] },
  ],
  skipDates: ["12-31", "01-01", "01-02", "01-03"],
};
const d = (x: string) => new Date(`${x}T00:00:00Z`);
const names = (x: string) => garbageOn(d(x), s).map((r) => r.name);

// 判定
assert.deepEqual(names("2026-11-02"), ["燃えるゴミ"]);   // 月
assert.deepEqual(names("2026-11-04"), ["プラスチック"]); // 水
assert.deepEqual(names("2026-11-06"), []);               // 第1金
assert.deepEqual(names("2026-11-13"), ["資源ゴミ"]);     // 第2金
assert.deepEqual(names("2026-11-27"), ["資源ゴミ"]);     // 第4金
assert.deepEqual(names("2026-12-31"), []);               // 木だが休止日
assert.equal(buildMessage(d("2026-11-01"), "tomorrow", s), null);
// weeks が空配列なら毎週扱い
assert.equal(garbageOn(d("2026-11-06"), { rules: [{ name: "x", emoji: "", days: [5], weeks: [] }], skipDates: [] }).length, 1);

// ルール未登録のユーザー
const empty = scheduleFrom({});
assert.deepEqual(empty.rules, []);
assert.equal(empty.skipDates.length, 4);
assert.equal(upcoming(empty).every((x) => x.items.length === 0), true);

// JST の日付境界
assert.equal(jstToday(new Date("2026-10-27T15:30:00Z")).toISOString().slice(0, 10), "2026-10-28");
assert.equal(jstToday(new Date("2026-10-27T14:59:00Z")).toISOString().slice(0, 10), "2026-10-27");

// バリデーション
assert.deepEqual(
  validateRules([{ name: " 燃える ", emoji: "🔥", days: [4, 1, 1, 9], weeks: [] }]),
  [{ name: "燃える", emoji: "🔥", days: [1, 4] }],
);
assert.deepEqual(validateRules([{ name: "資源", days: [5], weeks: [4, 2, 6] }])[0].weeks, [2, 4]);
assert.throws(() => validateRules([{ name: "", days: [1] }]));
assert.throws(() => validateRules([{ name: "曜日なし", days: [] }]));
assert.throws(() => validateRules("nope"));
assert.deepEqual(validateSkipDates(["01-02", "13-01", "12-31", "01-02", "x"]), ["01-02", "12-31"]);

console.log(buildMessage(d("2026-11-02"), "tomorrow", s));
console.log("✅ all tests passed");
