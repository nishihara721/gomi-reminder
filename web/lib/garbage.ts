// 画面上の即時プレビュー用（判定ルールは functions/src/schedule.ts と同じ）

export type Rule = { name: string; emoji: string; days: number[]; weeks?: number[] };
export type Timing = "evening" | "morning";

export const DAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];
export const NEW_YEAR = ["12-31", "01-01", "01-02", "01-03"];
export const EMOJIS = ["🔥", "♻️", "🧴", "🥫", "📰", "🧱", "🛋️", "🔋", "🌿", "🗑️"];

export const PRESETS: Rule[] = [
  { name: "燃えるゴミ", emoji: "🔥", days: [] },
  { name: "燃えないゴミ", emoji: "🧱", days: [] },
  { name: "プラスチック", emoji: "♻️", days: [] },
  { name: "ペットボトル", emoji: "🧴", days: [] },
  { name: "びん・缶", emoji: "🥫", days: [] },
  { name: "古紙・段ボール", emoji: "📰", days: [] },
];

export function jstToday(): Date {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}

export function preview(rules: Rule[], skipDates: string[], days = 7) {
  const start = jstToday();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400000);
    const mmdd = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const nth = Math.ceil(d.getUTCDate() / 7);
    const items = skipDates.includes(mmdd)
      ? []
      : rules
          .filter((r) => r.name && r.days.includes(d.getUTCDay()) && (!r.weeks?.length || r.weeks.includes(nth)))
          .map((r) => `${r.emoji} ${r.name}`);
    return { date: `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DAY_LABEL[d.getUTCDay()]})`, items, skip: skipDates.includes(mmdd) };
  });
}

/** 「毎週 月・木」「第2・第4 金」のような説明文 */
export function describe(r: Rule): string {
  if (r.days.length === 0) return "曜日が未選択です";
  const days = r.days.map((d) => DAY_LABEL[d]).join("・");
  return r.weeks?.length ? `第${r.weeks.join("・第")} ${days}曜` : `毎週 ${days}曜`;
}

export function formatSkip(mmdd: string): string {
  const [m, d] = mmdd.split("-").map(Number);
  return `${m}/${d}`;
}
