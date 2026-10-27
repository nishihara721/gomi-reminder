"use client";

import { useState } from "react";
import liff from "@line/liff";
import { MOCK, api, type Invite, type Member, type State } from "@/lib/api";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID!;

type Props = {
  members: Member[];
  hasRules: boolean;
  dirty: boolean;
  pendingCode: string | null;      // 招待リンクから開いたときのコード
  onState: (s: State) => void;
  onToast: (msg: string) => void;
};

export default function Family({ members, hasRules, dirty, pendingCode, onState, onToast }: Props) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [code, setCode] = useState(pendingCode ?? "");
  const [busy, setBusy] = useState(false);
  const shared = members.length > 1;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const issue = () => run(async () => {
    const s = await api({ action: "invite" });
    setInvite(s.invite ?? null);
  });

  const join = () => run(async () => {
    if (dirty && !confirm("保存していない変更があります。破棄して参加しますか？")) return;
    if (hasRules && !shared && !confirm("参加すると、いま登録しているルールは家族のルールに置き換わります。よろしいですか？")) return;
    const s = await api({ action: "join", code });
    onState(s);
    setCode("");
    history.replaceState(null, "", location.pathname); // ?invite= を消す
    onToast("家族に参加しました 🏠");
  });

  const leave = () => run(async () => {
    if (!confirm("家族から抜けますか？\n今のルールはコピーされ、これからは自分だけで管理します。")) return;
    onState(await api({ action: "leave" }));
    setInvite(null);
    onToast("家族から抜けました");
  });

  const link = invite ? `https://liff.line.me/${LIFF_ID}?invite=${invite.code}` : "";
  const message = invite
    ? `ゴミの日通知を一緒に使おう🗑️\n下のリンクから参加できます（${expires(invite.expiresAt)}まで有効）\n${link}\n\n招待コード：${invite.code}`
    : "";
  const canShare = !MOCK && liff.isApiAvailable?.("shareTargetPicker");

  const share = () => run(async () => {
    const res = await liff.shareTargetPicker([{ type: "text", text: message }]);
    if (res) onToast("送信しました ✓");
  });
  const copy = () => run(async () => {
    await navigator.clipboard.writeText(message);
    onToast("コピーしました ✓");
  });

  return (
    <section id="family">
      <h2>家族と共有</h2>

      <ul className="members">
        {members.map((m, i) => (
          <li key={i}>
            <span className="avatar">{m.name.slice(0, 1)}</span>
            <span>{m.name}{m.me && <span className="muted">（あなた）</span>}</span>
          </li>
        ))}
      </ul>
      <p className="muted">
        {shared
          ? "収集ルールとお休みの日は家族みんなで共通です。通知のタイミングは一人ずつ選べます。"
          : "家族を招待すると、同じ収集ルールでそれぞれのLINEに通知が届きます。"}
      </p>

      {/* 招待 */}
      {invite ? (
        <div className="invite">
          <p className="muted">招待コード（{expires(invite.expiresAt)}まで有効）</p>
          <p className="code">{invite.code}</p>
          <div className="row stack">
            {canShare && <button className="primary small" onClick={share} disabled={busy}>LINEで送る</button>}
            <button className="outline small" onClick={copy} disabled={busy}>メッセージをコピー</button>
          </div>
        </div>
      ) : (
        <button className="outline small block" onClick={issue} disabled={busy}>＋ 家族を招待する</button>
      )}

      {/* 参加 */}
      <p className="label">招待コードをもらった人</p>
      <div className="row">
        <input value={code} maxLength={8} placeholder="例：K7MP2Q" autoCapitalize="characters"
          className="code-input" onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <button className="text" onClick={join} disabled={busy || code.trim().length < 6}>参加</button>
      </div>

      {shared && <button className="text danger" onClick={leave} disabled={busy}>家族から抜ける</button>}
    </section>
  );
}

function expires(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
