"use client";

import { useEffect, useMemo, useState } from "react";
import liff from "@line/liff";
import {
  DAY_LABEL, EMOJIS, NEW_YEAR, PRESETS, describe, formatSkip, preview, type Rule, type Timing,
} from "@/lib/garbage";
import { MOCK, api, type Member, type State } from "@/lib/api";
import Family from "./Family";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID!;
const OA_URL = process.env.NEXT_PUBLIC_OA_URL; // 友だち追加URL（https://lin.ee/xxxx）

type Saved = { timing: Timing; rules: Rule[]; skipDates: string[] };

export default function Page() {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [timing, setTiming] = useState<Timing>("evening");
  const [rules, setRules] = useState<Rule[]>([]);
  const [skipDates, setSkipDates] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [isFriend, setIsFriend] = useState(true);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  function apply(s: State) {
    setSaved({ timing: s.timing, rules: s.rules, skipDates: s.skipDates });
    setTiming(s.timing);
    setRules(s.rules);
    setSkipDates(s.skipDates);
    setMembers(s.members);
    setEditing(null);
  }

  useEffect(() => {
    (async () => {
      try {
        if (!MOCK) {
          await liff.init({ liffId: LIFF_ID });
          if (!liff.isLoggedIn()) return liff.login();
          liff.getFriendship().then((f) => setIsFriend(f.friendFlag)).catch(() => {});
        }
        setPendingCode(new URLSearchParams(location.search).get("invite"));
        apply(await api());
        setPhase("ready");
      } catch {
        setPhase("error");
      }
    })();
  }, []);

  const dirty = useMemo(
    () => !!saved && JSON.stringify({ timing, rules, skipDates }) !== JSON.stringify(saved),
    [saved, timing, rules, skipDates],
  );
  const week = useMemo(() => preview(rules, skipDates), [rules, skipDates]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  async function save() {
    const bad = rules.find((r) => !r.name.trim() || r.days.length === 0);
    if (bad) {
      setEditing(rules.indexOf(bad));
      return flash(!bad.name.trim() ? "名前を入力してください" : `「${bad.name}」の曜日を選んでください`);
    }
    setSaving(true);
    try {
      apply(await api({ timing, rules, skipDates }));
      flash("保存しました ✓");
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const update = (i: number, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toggle = (arr: number[] = [], n: number) =>
    (arr.includes(n) ? arr.filter((x) => x !== n) : [...arr, n]).sort((a, b) => a - b);
  const addRule = (r: Rule) => {
    setRules((rs) => [...rs, { ...r }]);
    setEditing(rules.length);
  };

  if (phase === "loading") return <main className="wrap"><p className="muted">読み込み中…</p></main>;
  if (phase === "error") return <main className="wrap"><p>うまく読み込めませんでした。LINEアプリから開き直してください。</p></main>;

  const unused = PRESETS.filter((p) => !rules.some((r) => r.name === p.name));
  const shared = members.length > 1;

  return (
    <main className="wrap">
      <h1>🗑️ ゴミの日通知</h1>

      {!isFriend && (
        <div className="notice">
          <p>通知を受け取るには、公式アカウントを友だち追加してください。</p>
          {OA_URL && <a className="primary small" href={OA_URL}>友だち追加する</a>}
        </div>
      )}

      {pendingCode && (
        <a className="notice invited" href="#family">
          <p><b>🏠 家族から招待されています</b></p>
          <p className="muted">下の「家族と共有」で「参加」を押すと、同じルールで通知が届きます。</p>
        </a>
      )}

      {/* 通知タイミング */}
      <section>
        <h2>通知のタイミング{shared && <span className="tag">あなただけ</span>}</h2>
        <div className="choices">
          {([["evening", "🌙 前日の夜", "20時"], ["morning", "☀️ 当日の朝", "7時"]] as const).map(([t, label, time]) => (
            <button key={t} className={timing === t ? "on" : ""} onClick={() => setTiming(t)}>
              <span className="big">{label}</span>
              <span className="muted">{time}にお知らせ</span>
            </button>
          ))}
        </div>
      </section>

      {/* 収集ルール */}
      <section>
        <h2>収集ルール{shared && <span className="tag">家族共通</span>}</h2>
        {rules.length === 0 && <p className="muted">下のボタンから、ゴミの種類を追加してください。</p>}

        <ul className="rules">
          {rules.map((r, i) =>
            editing === i ? (
              <li key={i} className="rule editing">
                <div className="row">
                  <select value={r.emoji} onChange={(e) => update(i, { emoji: e.target.value })} aria-label="アイコン">
                    {EMOJIS.map((e) => <option key={e}>{e}</option>)}
                  </select>
                  <input value={r.name} maxLength={20} placeholder="例：燃えるゴミ"
                    onChange={(e) => update(i, { name: e.target.value })} />
                </div>

                <p className="label">曜日</p>
                <div className="chips">
                  {DAY_LABEL.map((l, d) => (
                    <button key={d} className={r.days.includes(d) ? "on" : ""} onClick={() => update(i, { days: toggle(r.days, d) })}>{l}</button>
                  ))}
                </div>

                <p className="label">頻度 <span className="muted">（選ばなければ毎週）</span></p>
                <div className="chips">
                  {[1, 2, 3, 4, 5].map((w) => (
                    <button key={w} className={r.weeks?.includes(w) ? "on" : ""} onClick={() => update(i, { weeks: toggle(r.weeks, w) })}>第{w}</button>
                  ))}
                </div>

                <div className="row end">
                  <button className="text danger" onClick={() => { setRules((rs) => rs.filter((_, j) => j !== i)); setEditing(null); }}>削除</button>
                  <button className="text" onClick={() => setEditing(null)}>完了</button>
                </div>
              </li>
            ) : (
              <li key={i} className="rule" onClick={() => setEditing(i)}>
                <span className="emoji">{r.emoji}</span>
                <span className="grow">
                  <span className="big">{r.name || "（名前なし）"}</span>
                  <span className={`muted ${r.days.length ? "" : "warn"}`}>{describe(r)}</span>
                </span>
                <span className="muted">編集 ›</span>
              </li>
            ),
          )}
        </ul>

        <div className="presets">
          {unused.map((p) => <button key={p.name} onClick={() => addRule(p)}>＋ {p.emoji} {p.name}</button>)}
          <button onClick={() => addRule({ name: "", emoji: "🗑️", days: [] })}>＋ その他</button>
        </div>
      </section>

      {/* お休みの日 */}
      <section>
        <h2>収集がお休みの日{shared && <span className="tag">家族共通</span>}</h2>
        <SkipEditor value={skipDates} onChange={setSkipDates} />
      </section>

      <Family
        members={members}
        hasRules={(saved?.rules.length ?? 0) > 0}
        dirty={dirty}
        pendingCode={pendingCode}
        onState={(s) => { apply(s); setPendingCode(null); }}
        onToast={flash}
      />

      {/* プレビュー */}
      <section>
        <h2>これから1週間</h2>
        <ul className="week">
          {week.map((d) => (
            <li key={d.date} className={d.items.length ? "" : "none"}>
              <span className="date">{d.date}</span>
              <span>{d.skip ? "お休み" : d.items.length ? d.items.join("・") : "なし"}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="bar">
        {dirty ? (
          <button className="primary" onClick={save} disabled={saving}>{saving ? "保存中…" : "保存する"}</button>
        ) : (
          <button className="secondary" onClick={() => liff.closeWindow()}>閉じる</button>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function SkipEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [m, setM] = useState(12);
  const [d, setD] = useState(31);
  const add = (list: string[]) => onChange([...new Set([...value, ...list])].sort());
  const hasNewYear = NEW_YEAR.every((x) => value.includes(x));

  return (
    <>
      {value.length === 0 ? (
        <p className="muted">お休みの日はありません</p>
      ) : (
        <div className="chips wrap-chips">
          {value.map((x) => (
            <button key={x} className="on" onClick={() => onChange(value.filter((y) => y !== x))} aria-label={`${formatSkip(x)}を削除`}>
              {formatSkip(x)} ×
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <select value={m} onChange={(e) => setM(+e.target.value)} aria-label="月">
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}月</option>)}
        </select>
        <select value={d} onChange={(e) => setD(+e.target.value)} aria-label="日">
          {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}日</option>)}
        </select>
        <button className="text" onClick={() => add([`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`])}>追加</button>
      </div>
      {!hasNewYear && <button className="text" onClick={() => add(NEW_YEAR)}>＋ 年末年始（12/31〜1/3）をまとめて追加</button>}
    </>
  );
}
