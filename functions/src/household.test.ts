// Firestore エミュレータ上で家族共有を通しで確認する
//   npm run test:household
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Households, makeCode, normalizeCode } from "./household";
import { UserError } from "./schedule";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "エミュレータ上で実行してください");

// コード生成・正規化
assert.match(makeCode(), /^[A-HJ-NP-Z2-9]{6}$/);
assert.equal(normalizeCode(" k7m-p2q "), "K7MP2Q");
assert.equal(normalizeCode("K7MP2"), null);   // 短い
assert.equal(normalizeCode("K7MP2O"), null);  // O は使わない

initializeApp({ projectId: "demo-gomi" });
const db = getFirestore();
const h = new Households(db);
const rules = [{ name: "燃えるゴミ", emoji: "🔥", days: [1, 4] }];

async function rejects(p: Promise<unknown>, msg: RegExp) {
  await assert.rejects(p, (e: unknown) => e instanceof UserError && msg.test((e as Error).message));
}

(async () => {
  // 旧データ（users に直接 rules）の自動移行
  await db.doc("users/mom").set({ timing: "evening", active: true, name: "母", rules, skipDates: ["01-01"] });
  const momHome = await h.householdOf("mom");
  assert.deepEqual(momHome.schedule.rules, rules);
  const momDoc = (await db.doc("users/mom").get()).data()!;
  assert.equal(momDoc.householdId, momHome.id);
  assert.equal(momDoc.rules, undefined, "旧フィールドは消える");

  // 招待コードは使い回される
  const inv = await h.invite("mom");
  assert.equal((await h.invite("mom")).code, inv.code);

  // 子が参加 → 子の空の家族は削除され、母のルールが見える
  await db.doc("users/kid").set({ timing: "morning", active: true, name: "子" });
  const kidOld = await h.householdOf("kid");
  await h.join("kid", inv.code.toLowerCase());
  assert.equal((await h.householdOf("kid")).id, momHome.id);
  assert.deepEqual((await h.householdOf("kid")).schedule.rules, rules);
  assert.equal((await db.doc(`households/${kidOld.id}`).get()).exists, false, "空になった家族は片付く");
  assert.equal((await h.members(momHome.id)).length, 2);

  // 子がルールを変更 → 母にも反映
  const newRules = [...rules, { name: "プラ", emoji: "♻️", days: [3] }];
  await h.saveSchedule("kid", { rules: newRules });
  assert.equal((await h.householdOf("mom")).schedule.rules.length, 2);

  // 定期送信用の一括取得（通知タイミングは別々のまま）
  const users = (await db.collection("users").where("active", "==", true).get()).docs;
  const map = await h.schedulesFor(users);
  assert.equal(map.get("mom")!.rules.length, 2);
  assert.equal(map.get("kid")!.rules.length, 2);

  // エラー系
  await rejects(h.join("kid", inv.code), /すでに/);
  await rejects(h.join("kid", "ZZZZZZ"), /見つからない/);
  await rejects(h.join("kid", "abc"), /6文字/);
  await db.doc("invites/EXP234").set({ householdId: momHome.id, expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  await db.doc("users/dad").set({ active: true, name: "父" });
  await rejects(h.join("dad", "EXP234"), /期限切れ/);

  // 子が抜ける → ルールのコピーを持って独立。母の家族は残る
  await h.leave("kid");
  const kidNew = await h.householdOf("kid");
  assert.notEqual(kidNew.id, momHome.id);
  assert.equal(kidNew.schedule.rules.length, 2);
  assert.equal((await h.members(momHome.id)).length, 1);
  await rejects(h.leave("mom"), /あなただけ/);

  console.log("✅ household tests passed");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
