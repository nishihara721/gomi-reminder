// 家族（household）の管理：ルールの共有・招待コード・参加・脱退
//
// users/{userId}       { timing, active, name, householdId }
// households/{id}      { rules, skipDates, inviteCode? }
// invites/{code}       { householdId, expiresAt }
import { randomInt } from "crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { UserError, scheduleFrom, type UserSchedule } from "./schedule";

export { UserError };

export const INVITE_TTL_DAYS = 7;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 0/O・1/I は紛らわしいので除外
const CODE_LEN = 6;

export function makeCode(rand: (n: number) => number = randomInt): string {
  return Array.from({ length: CODE_LEN }, () => ALPHABET[rand(ALPHABET.length)]).join("");
}

/** 入力ゆれを吸収（小文字・空白・ハイフン、O→0 は存在しないので Q 等の誤入力は弾く） */
export function normalizeCode(input: unknown): string | null {
  const s = String(input ?? "").toUpperCase().replace(/[\s\-ー－]/g, "");
  return s.length === CODE_LEN && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}

export class Households {
  constructor(private db: Firestore) {}
  private users = () => this.db.collection("users");
  private homes = () => this.db.collection("households");
  private invites = () => this.db.collection("invites");

  /**
   * ユーザーの家族を返す。まだ無ければ作る。
   * 旧バージョンで users に直接保存していた rules / skipDates はここで家族側へ移す。
   */
  async householdOf(userId: string): Promise<{ id: string; schedule: UserSchedule }> {
    return this.db.runTransaction(async (tx) => {
      const uref = this.users().doc(userId);
      const u = await tx.get(uref);
      const hid = u.get("householdId") as string | undefined;
      if (hid) {
        const h = await tx.get(this.homes().doc(hid));
        if (h.exists) return { id: hid, schedule: scheduleFrom(h.data()) };
      }
      const schedule = scheduleFrom(u.data()); // 旧データ（無ければ空）
      const href = this.homes().doc();
      tx.set(href, { ...schedule, createdAt: FieldValue.serverTimestamp() });
      tx.set(uref, { householdId: href.id, rules: FieldValue.delete(), skipDates: FieldValue.delete() }, { merge: true });
      return { id: href.id, schedule };
    });
  }

  async saveSchedule(userId: string, patch: Partial<UserSchedule>) {
    const { id } = await this.householdOf(userId);
    await this.homes().doc(id).set(patch, { merge: true });
  }

  async members(householdId: string): Promise<{ id: string; name: string }[]> {
    const snap = await this.users().where("householdId", "==", householdId).get();
    return snap.docs.map((d) => ({ id: d.id, name: (d.get("name") as string) || "（名前未取得）" }));
  }

  /** 有効な招待コードがあればそれを、無ければ新しく発行 */
  async invite(userId: string): Promise<{ code: string; expiresAt: string }> {
    const { id } = await this.householdOf(userId);
    const home = await this.homes().doc(id).get();
    const current = home.get("inviteCode") as string | undefined;
    if (current) {
      const inv = await this.invites().doc(current).get();
      const exp = inv.get("expiresAt") as Timestamp | undefined;
      if (inv.exists && exp && exp.toMillis() > Date.now() + 24 * 3600 * 1000) {
        return { code: current, expiresAt: exp.toDate().toISOString() }; // 残り1日以上なら使い回す
      }
      await this.invites().doc(current).delete();
    }
    const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);
    for (let i = 0; i < 5; i++) {
      const code = makeCode();
      try {
        await this.invites().doc(code).create({ householdId: id, expiresAt }); // 既存なら失敗→再生成
        await this.homes().doc(id).set({ inviteCode: code }, { merge: true });
        return { code, expiresAt: expiresAt.toDate().toISOString() };
      } catch {
        /* 衝突。作り直す */
      }
    }
    throw new Error("招待コードを発行できませんでした");
  }

  /** 招待コードで家族に参加。元の家族に誰も残らなければ片付ける */
  async join(userId: string, rawCode: unknown): Promise<void> {
    const code = normalizeCode(rawCode);
    if (!code) throw new UserError("招待コードは英数字6文字です");

    await this.db.runTransaction(async (tx) => {
      const inv = await tx.get(this.invites().doc(code));
      const exp = inv.get("expiresAt") as Timestamp | undefined;
      if (!inv.exists || !exp || exp.toMillis() < Date.now()) {
        throw new UserError("招待コードが見つからないか、期限切れです");
      }
      const hid = inv.get("householdId") as string;
      const target = await tx.get(this.homes().doc(hid));
      if (!target.exists) throw new UserError("招待元の家族が見つかりません");

      const uref = this.users().doc(userId);
      const u = await tx.get(uref);
      const old = u.get("householdId") as string | undefined;
      if (old === hid) throw new UserError("すでにこの家族に参加しています");

      let removeOld: FirebaseFirestore.DocumentSnapshot | null = null;
      if (old) {
        const others = await tx.get(this.users().where("householdId", "==", old).limit(2));
        if (others.docs.every((d) => d.id === userId)) removeOld = await tx.get(this.homes().doc(old));
      }

      tx.set(uref, { householdId: hid, rules: FieldValue.delete(), skipDates: FieldValue.delete() }, { merge: true });
      if (removeOld?.exists) {
        tx.delete(removeOld.ref);
        const oldCode = removeOld.get("inviteCode") as string | undefined;
        if (oldCode) tx.delete(this.invites().doc(oldCode));
      }
    });
  }

  /** 家族から抜ける。今のルールをコピーした自分だけの家族に移る */
  async leave(userId: string): Promise<void> {
    const { id, schedule } = await this.householdOf(userId);
    const members = await this.members(id);
    if (members.length <= 1) throw new UserError("家族はあなただけです");
    const href = this.homes().doc();
    await href.set({ ...schedule, createdAt: FieldValue.serverTimestamp() });
    await this.users().doc(userId).set({ householdId: href.id }, { merge: true });
  }

  /** 定期送信用：ユーザーごとのルールをまとめて取得（書き込みはしない） */
  async schedulesFor(users: FirebaseFirestore.QueryDocumentSnapshot[]): Promise<Map<string, UserSchedule>> {
    const ids = [...new Set(users.map((u) => u.get("householdId") as string | undefined).filter((x): x is string => !!x))];
    const homes = new Map<string, UserSchedule>();
    for (let i = 0; i < ids.length; i += 100) {
      const snaps = await this.db.getAll(...ids.slice(i, i + 100).map((id) => this.homes().doc(id)));
      for (const s of snaps) if (s.exists) homes.set(s.id, scheduleFrom(s.data()));
    }
    const result = new Map<string, UserSchedule>();
    for (const u of users) {
      const hid = u.get("householdId") as string | undefined;
      result.set(u.id, (hid && homes.get(hid)) || scheduleFrom(u.data())); // 未移行ユーザーは旧データで
    }
    return result;
  }
}
