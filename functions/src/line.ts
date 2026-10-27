// LINE Messaging API の薄いラッパー
import { createHmac, timingSafeEqual } from "crypto";

const API = "https://api.line.me/v2/bot/message";

export function verifySignature(body: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(signature, "base64");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

async function post(path: string, token: string, payload: unknown) {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`LINE API ${path} ${res.status}: ${await res.text()}`);
}

export const reply = (token: string, replyToken: string, text: string) =>
  post("reply", token, { replyToken, messages: [{ type: "text", text }] });

/** 500人ずつに分けて multicast */
export async function multicast(token: string, userIds: string[], text: string) {
  for (let i = 0; i < userIds.length; i += 500) {
    await post("multicast", token, { to: userIds.slice(i, i + 500), messages: [{ type: "text", text }] });
  }
}

/** LIFFのIDトークンを検証して userId と表示名を返す */
export async function verifyIdToken(idToken: string, loginChannelId: string): Promise<{ userId: string; name: string }> {
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: loginChannelId }),
  });
  if (!res.ok) throw new Error("invalid id token");
  const data = (await res.json()) as { sub: string; name?: string };
  return { userId: data.sub, name: data.name ?? "" };
}
