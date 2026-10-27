# ゴミの日リマインダー（LINE）

前日20時 or 当日7時に、その日のゴミをLINEでお知らせするボット。
収集ルールは各ユーザーがLINE上（LIFF画面）で自分で登録します。家族はそれぞれ友だち追加して登録すれば各自に届きます。

```
functions/   Firebase Functions（Webhook・LIFF用API・定期送信）
  src/schedule.ts   判定ロジックと入力チェック
web/         Next.js（LIFF設定画面）
  lib/garbage.ts    画面の即時プレビュー用の判定・プリセット
```

## できること
- 友だち追加 → 自動登録し、ルール登録画面へのリンクを送信
- LIFF画面で
  - 通知タイミング（前日の夜20時／当日の朝7時）を選択
  - ゴミの種類をプリセット（燃える・燃えない・プラ・ペット・びん缶・古紙）か自由入力で追加
  - 曜日と頻度（毎週／第n週）を選択、編集・削除
  - お休みの日を追加（年末年始はワンタップ）
  - 1週間の予定を、保存前にその場でプレビュー
- トークで「今日」「明日」「今週」→ 即答、「設定」「登録」「変更」→ 設定画面のリンク
- ブロックで送信停止、ブロック解除すると以前のルールのまま再開

## 家族と共有（招待コード）
- 設定画面の「家族を招待する」で6文字の招待コードを発行（7日間有効、残り1日を切ると作り直し）
- 「LINEで送る」でトークを選んで招待リンクを送信。受け取った人はリンクを開いて「参加」を押すだけ
- コードを手入力するか、トークで「参加 K7MP2Q」と送っても参加可能
- 共有されるのは収集ルールとお休みの日。通知のタイミングは一人ずつ選択
- 参加すると、それまで自分だけで登録していたルールは家族のものに置き換わる（確認ダイアログあり）
- 「家族から抜ける」で、今のルールをコピーして自分だけの管理に戻る
- 招待リンクを開いた人が未友だちなら、画面上で友だち追加を案内

## データ（Firestore）
```
users/{LINEユーザーID}   { timing: "evening"|"morning", active, name, householdId }
households/{id}          { rules: [{ name, emoji, days: [0-6], weeks?: [1-5] }], skipDates: ["MM-DD"], inviteCode? }
invites/{code}           { householdId, expiresAt }
```
- ルールは最大20件、お休みの日は最大40件
- 旧バージョンで users に直接保存していたルールは、最初のアクセス時に自動で households へ移行
- 定期送信では、同じ文面になる人をまとめて multicast

## セットアップ

### 1. LINE側
1. LINE Developers で **Messaging APIチャネル** を作成 → チャネルシークレットと長期アクセストークンを控える
2. 同じプロバイダーに **LINEログインチャネル** を作成 → LIFFアプリを追加
   - サイズ：Full、エンドポイントURL：Vercel にデプロイした web のURL
   - Scope：`openid`、`profile`（表示名を家族一覧に出すため）
   - 「shareTargetPicker」をオン（招待をLINEで送るため）
   - 「友だち追加オプション」で Messaging APIチャネルを紐付け（未友だちの判定に使用）
   - LIFF ID と、このログインチャネルの **チャネルID** を控える
3. LINE公式アカウントの応答設定で「応答メッセージ」をオフ、「Webhook」をオン
4. リッチメニューに LIFF URL（「ルール設定」など）を置くとすぐ開けて便利

### 2. Firebase（Functions）
定期実行（Cloud Scheduler）を使うので **Blazeプラン** が必要です（家族利用なら無料枠内に収まります）。

```bash
cd functions
npm install
firebase use --add <プロジェクトID>
firebase functions:secrets:set LINE_CHANNEL_SECRET
firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
# functions/.env に書く
#   LINE_LOGIN_CHANNEL_ID=xxxxxxxxxx
#   LIFF_URL=https://liff.line.me/xxxxxxxxxx-xxxxxxxx
npm test                      # 判定・入力チェックのテスト
npm run test:household        # 家族共有のテスト（Firestoreエミュレータ、要Java）
firebase deploy --only functions,firestore:rules
```

デプロイ後、`webhook` のURLを Messaging API の Webhook URL に設定 → 「検証」。

### 3. Next.js（LIFF画面）
```bash
cd web
cp .env.local.example .env.local   # LIFF ID・api のURL・友だち追加URLを入れる
npm install
NEXT_PUBLIC_MOCK=1 npm run dev     # LINEなしで画面だけ確認（サンプルデータ）
```
Vercel にデプロイして、そのURLを LIFF のエンドポイントURLに設定。
