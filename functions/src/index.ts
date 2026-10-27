import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { addDays, buildMessage, jstToday, upcoming, validateRules, validateSkipDates } from "./schedule";
import { multicast, reply, verifyIdToken, verifySignature } from "./line";
import { Households, UserError } from "./household";

initializeApp();
const db = getFirestore();
const homes = new Households(db);

const CHANNEL_SECRET = defineSecret("LINE_CHANNEL_SECRET");
const ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");
const LOGIN_CHANNEL_ID = defineString("LINE_LOGIN_CHANNEL_ID"); // LIFFを置いたLINEログインチャネル
const LIFF_URL = defineString("LIFF_URL");                      // https://liff.line.me/xxxx

const REGION = "asia-northeast1";
type Timing = "evening" | "morning";

// ───────── Webhook：友だち追加・ブロック・キーワード応答 ─────────
export const webhook = onRequest(
  { region: REGION, secrets: [CHANNEL_SECRET, ACCESS_TOKEN] },
  async (req, res) => {
    const raw = req.rawBody.toString("utf8");
    if (!verifySignature(raw, req.get("x-line-signature"), CHANNEL_SECRET.value())) {
      res.status(401).send("bad signature");
      return;
    }
    const token = ACCESS_TOKEN.value();
    const setupLink = `収集ルールの登録・変更はこちら👇\n${LIFF_URL.value()}`;

    for (const ev of req.body.events ?? []) {
      const userId: string | undefined = ev.source?.userId;
      if (!userId) continue;
      const ref = db.collection("users").doc(userId);

      try {
        if (ev.type === "follow") {
          const snap = await ref.get();
          await ref.set(
            snap.exists
              ? { active: true } // ブロック解除・LIFFから先に参加していた人：設定はそのまま
              : { timing: "evening", active: true, createdAt: FieldValue.serverTimestamp() },
            { merge: true },
          );
          const { schedule } = await homes.householdOf(userId);
          await reply(token, ev.replyToken, schedule.rules.length
            ? `友だち追加ありがとうございます！\n登録済みのルールで、ゴミの日をお知らせします🗑️\n\n${setupLink}`
            : `友だち追加ありがとうございます！\nまずはゴミの収集ルールを登録してください。\n家族から招待コードをもらった人は「参加 ABC234」のように送ってください。\n\n${setupLink}`);
        } else if (ev.type === "unfollow") {
          await ref.set({ active: false }, { merge: true });
        } else if (ev.type === "message" && ev.message.type === "text") {
          await handleText(ev.message.text.trim(), userId, ev.replyToken, token, setupLink);
        }
      } catch (e) {
        logger.error(e);
      }
    }
    res.status(200).send("ok");
  },
);

async function handleText(text: string, userId: string, replyToken: string, token: string, setupLink: string) {
  const join = /^参加\s*(.+)$/.exec(text);
  if (join) {
    try {
      await homes.join(userId, join[1]);
      const { schedule } = await homes.householdOf(userId);
      const names = schedule.rules.map((r) => `${r.emoji} ${r.name}`).join("\n") || "（まだルールがありません）";
      await reply(token, replyToken, `家族に参加しました🏠\n共有されているルール：\n${names}`);
    } catch (e) {
      await reply(token, replyToken, e instanceof UserError ? e.message : "参加できませんでした。時間をおいて試してください。");
    }
    return;
  }
  if (/招待|家族|共有/.test(text)) {
    await reply(token, replyToken, `設定画面の「家族と共有」から招待コードを発行できます👇\n${LIFF_URL.value()}`);
    return;
  }
  if (/設定|登録|変更/.test(text)) {
    await reply(token, replyToken, setupLink);
    return;
  }
  if (!/今日|明日|今週|予定/.test(text)) return; // 関係ないメッセージには反応しない

  const { schedule: s } = await homes.householdOf(userId);
  const today = jstToday();
  if (s.rules.length === 0) {
    await reply(token, replyToken, `まだ収集ルールが登録されていません。\n${setupLink}`);
  } else if (text.includes("今日")) {
    await reply(token, replyToken, buildMessage(today, "today", s) ?? "今日はゴミの日ではありません🙆");
  } else if (text.includes("明日")) {
    await reply(token, replyToken, buildMessage(addDays(today, 1), "tomorrow", s) ?? "明日はゴミの日ではありません🙆");
  } else {
    const lines = upcoming(s).map((x) => `${x.date} ${x.items.join("・") || "—"}`);
    await reply(token, replyToken, `📅 これから1週間\n${lines.join("\n")}`);
  }
}

// ───────── LIFF用API ─────────
// POST body:
//   { timing?, rules?, skipDates? }   設定の保存（timing は本人だけ、rules/skipDates は家族共通）
//   { action: "invite" }              招待コード発行
//   { action: "join", code }          招待コードで参加
//   { action: "leave" }               家族から抜ける
export const api = onRequest({ region: REGION, cors: true }, async (req, res) => {
  let userId: string;
  try {
    const idToken = (req.get("authorization") ?? "").replace(/^Bearer\s+/, "");
    const v = await verifyIdToken(idToken, LOGIN_CHANNEL_ID.value());
    userId = v.userId;
    // LIFFから先に開いた人は active にしない（友だち追加＝follow で active になる）
    await db.collection("users").doc(userId).set({ name: v.name }, { merge: true });
  } catch (e) {
    logger.warn(e);
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  let invite: { code: string; expiresAt: string } | undefined;
  if (req.method === "POST") {
    try {
      const body = req.body ?? {};
      switch (body.action) {
        case "invite":
          invite = await homes.invite(userId);
          break;
        case "join":
          await homes.join(userId, body.code);
          break;
        case "leave":
          await homes.leave(userId);
          break;
        default: {
          if (body.timing !== undefined) {
            if (body.timing !== "evening" && body.timing !== "morning") throw new UserError("通知タイミングが不正です");
            await db.collection("users").doc(userId).set({ timing: body.timing }, { merge: true });
          }
          const patch: Record<string, unknown> = {};
          if (body.rules !== undefined) patch.rules = validateRules(body.rules);
          if (body.skipDates !== undefined) patch.skipDates = validateSkipDates(body.skipDates);
          if (Object.keys(patch).length) await homes.saveSchedule(userId, patch);
        }
      }
    } catch (e) {
      const msg = e instanceof UserError ? e.message : "うまく保存できませんでした。時間をおいて試してください";
      if (!(e instanceof UserError)) logger.error(e);
      res.status(400).json({ error: msg });
      return;
    }
  }

  const user = await db.collection("users").doc(userId).get();
  const { id, schedule } = await homes.householdOf(userId);
  const members = await homes.members(id);
  res.json({
    timing: (user.get("timing") as Timing) ?? "evening",
    rules: schedule.rules,
    skipDates: schedule.skipDates,
    members: members.map((m) => ({ name: m.name, me: m.id === userId })),
    ...(invite ? { invite } : {}),
  });
});

// ───────── 定期送信：同じ文面の人をまとめて multicast ─────────
async function sendTo(timing: Timing) {
  const today = jstToday();
  const target = timing === "evening" ? addDays(today, 1) : today;
  const when = timing === "evening" ? "tomorrow" : "today";

  const snap = await db.collection("users").where("active", "==", true).where("timing", "==", timing).get();
  const schedules = await homes.schedulesFor(snap.docs);
  const groups = new Map<string, string[]>();
  for (const [userId, s] of schedules) {
    const text = buildMessage(target, when, s);
    if (text) groups.set(text, [...(groups.get(text) ?? []), userId]);
  }

  const token = ACCESS_TOKEN.value();
  let sent = 0;
  for (const [text, ids] of groups) {
    try {
      await multicast(token, ids, text);
      sent += ids.length;
    } catch (e) {
      logger.error(e); // 1グループの失敗で他を止めない
    }
  }
  logger.info(`${timing}: ${sent}人に送信（${groups.size}パターン）`);
}

export const eveningPush = onSchedule(
  { schedule: "0 20 * * *", timeZone: "Asia/Tokyo", region: REGION, secrets: [ACCESS_TOKEN] },
  () => sendTo("evening"),
);

export const morningPush = onSchedule(
  { schedule: "0 7 * * *", timeZone: "Asia/Tokyo", region: REGION, secrets: [ACCESS_TOKEN] },
  () => sendTo("morning"),
);
