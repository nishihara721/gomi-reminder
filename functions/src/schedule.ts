// ゴミ収集ルールと判定ロジック（ルールはユーザーごとに Firestore に保存）

export type Rule = {
  name: string;      // 表示名（例：燃えるゴミ）
  emoji: string;     // 通知に付ける絵文字
  days: number[];    // 曜日 0=日 1=月 ... 6=土
  weeks?: number[];  // 第n週の指定（例：[2,4] で第2・第4）。省略・空で毎週
};

export type UserSchedule = {
  rules: Rule[];
  skipDates: string[]; // 収集がお休みの日 "MM-DD"
};

/** 利用者にそのまま見せてよいエラー */
export class UserError extends Error {}

export const DEFAULT_SKIP_DATES = ["12-31", "01-01", "01-02", "01-03"];

const DAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

/** 今のJST日付（時刻は0時）を UTC の Date として返す */
export function jstToday(now: Date = new Date()): Date {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

/** その日に出せるゴミの一覧 */
export function garbageOn(date: Date, s: UserSchedule): Rule[] {
  const mmdd = `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  if (s.skipDates.includes(mmdd)) return [];
  const day = date.getUTCDay();
  const nth = Math.ceil(date.getUTCDate() / 7); // 第何曜日か
  return s.rules.filter((r) => r.days.includes(day) && (!r.weeks?.length || r.weeks.includes(nth)));
}

export function formatDate(date: Date): string {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}(${DAY_LABEL[date.getUTCDay()]})`;
}

/** 通知文。ゴミがない日は null */
export function buildMessage(date: Date, when: "today" | "tomorrow", s: UserSchedule): string | null {
  const list = garbageOn(date, s);
  if (list.length === 0) return null;
  const head = when === "tomorrow" ? `明日 ${formatDate(date)} は` : `今日 ${formatDate(date)} は`;
  const items = list.map((r) => `${r.emoji} ${r.name}`).join("\n");
  const tail = when === "tomorrow" ? "忘れずに準備しておきましょう！" : "朝のうちに出しましょう！";
  return `${head}\n${items}\nの日です。${tail}`;
}

/** 今日から n 日分の予定（LIFF画面・「今週」応答用） */
export function upcoming(s: UserSchedule, days = 7, now: Date = new Date()) {
  const start = jstToday(now);
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(start, i);
    return { date: formatDate(d), items: garbageOn(d, s).map((r) => `${r.emoji} ${r.name}`) };
  });
}

/** Firestore のドキュメントから安全に読み出す */
export function scheduleFrom(data: Record<string, unknown> | undefined): UserSchedule {
  return {
    rules: Array.isArray(data?.rules) ? (data!.rules as Rule[]) : [],
    skipDates: Array.isArray(data?.skipDates) ? (data!.skipDates as string[]) : DEFAULT_SKIP_DATES,
  };
}

/** LIFFから送られてきたルールを検証・整形。不正なら Error を投げる */
export function validateRules(input: unknown): Rule[] {
  if (!Array.isArray(input) || input.length > 20) throw new UserError("ルールは20件までです");
  return input.map((r: any, i) => {
    const name = String(r?.name ?? "").trim().slice(0, 20);
    if (!name) throw new UserError(`${i + 1}件目：名前を入力してください`);
    const emoji = String(r?.emoji ?? "🗑️").slice(0, 8);
    const days = uniqInts(r?.days, 0, 6);
    if (days.length === 0) throw new UserError(`「${name}」：曜日を1つ以上選んでください`);
    const weeks = uniqInts(r?.weeks ?? [], 1, 5);
    return weeks.length ? { name, emoji, days, weeks } : { name, emoji, days };
  });
}

export function validateSkipDates(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 40) throw new UserError("お休みの日は40件までです");
  const ok = input.map(String).filter((s) => {
    const m = /^(\d{2})-(\d{2})$/.exec(s);
    return !!m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31;
  });
  return [...new Set(ok)].sort();
}

function uniqInts(v: unknown, min: number, max: number): number[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= min && n <= max))].sort((a, b) => a - b);
}
