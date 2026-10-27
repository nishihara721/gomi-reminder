// Functions の api との通信（NEXT_PUBLIC_MOCK=1 なら LINE なしで動くダミー）
import liff from "@line/liff";
import type { Rule, Timing } from "./garbage";

export const MOCK = process.env.NEXT_PUBLIC_MOCK === "1";
const API_URL = process.env.NEXT_PUBLIC_API_URL!;

export type Member = { name: string; me: boolean };
export type Invite = { code: string; expiresAt: string };
export type State = {
  timing: Timing;
  rules: Rule[];
  skipDates: string[];
  members: Member[];
  invite?: Invite;
};
export type Body =
  | { timing?: Timing; rules?: Rule[]; skipDates?: string[] }
  | { action: "invite" }
  | { action: "join"; code: string }
  | { action: "leave" };

export async function api(body?: Body): Promise<State> {
  if (MOCK) return mockApi(body);
  const res = await fetch(API_URL, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${liff.getIDToken()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `エラー（${res.status}）`);
  return data as State;
}

// ───────── ダミー ─────────
let mock: State = {
  timing: "evening",
  rules: [
    { name: "燃えるゴミ", emoji: "🔥", days: [1, 4] },
    { name: "資源ゴミ", emoji: "🥫", days: [5], weeks: [2, 4] },
  ],
  skipDates: ["01-01", "01-02", "01-03", "12-31"],
  members: [{ name: "ちひろ", me: true }],
};

async function mockApi(body?: Body): Promise<State> {
  await new Promise((r) => setTimeout(r, 200));
  if (!body) return mock;
  if ("action" in body) {
    if (body.action === "invite") {
      return { ...mock, invite: { code: "K7MP2Q", expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() } };
    }
    if (body.action === "join") {
      if (body.code.replace(/\s|-/g, "").toUpperCase() !== "K7MP2Q") throw new Error("招待コードが見つからないか、期限切れです");
      mock = {
        ...mock,
        rules: [
          { name: "燃えるゴミ", emoji: "🔥", days: [2, 5] },
          { name: "プラスチック", emoji: "♻️", days: [3] },
        ],
        members: [{ name: "お母さん", me: false }, { name: "ちひろ", me: true }],
      };
      return mock;
    }
    if (body.action === "leave") {
      mock = { ...mock, members: mock.members.filter((m) => m.me) };
      return mock;
    }
  }
  mock = { ...mock, ...body };
  return mock;
}
