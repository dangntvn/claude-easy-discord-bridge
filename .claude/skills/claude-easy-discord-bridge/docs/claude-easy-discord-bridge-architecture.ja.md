# 標準化アーキテクチャ: Project ↔ Channel ↔ Session ↔ Thread によるDiscordブリッジ

[English](claude-easy-discord-bridge-architecture.md) · [Tiếng Việt](claude-easy-discord-bridge-architecture.vi.md) · **日本語** · [中文](claude-easy-discord-bridge-architecture.zh.md)

ステータス: **コーディングは完了しており、実際のDiscordを使ったエンドツーエンドの
テスト**（モックではない）も実施済み — スレッド作成、実際のメッセージ送受信、
切断/resume、permission promptのリレーいずれも正しく動作している。旧来の
`discord-bridge/`フォルダとして単独で置く形ではなく、`claude-easy-discord-bridge`
スキル（`.claude/skills/claude-easy-discord-bridge/`）としてパッケージ化した。
スクリプトはAnthropicのスキルフォルダ規約どおり`scripts/`配下に置いている
（3節参照）。本ドキュメントは設計理由込みのアーキテクチャ仕様であり、実装前の
下書きではなく実際のコードに合わせて更新されたものである。確定済みの決定事項:

1. 「タグ」は使わない — **スレッド名は接続時にClaude自身が付ける**（ユーザーが
   入力するのではない）が、**名前はあくまで表示用であり、ルーティング/管理には
   使用しない**。
2. **プロジェクトごとにWebSocket Gatewayを待ち受けるプロセスは1つだけ**とし、
   全セッションで共有する。
3. **[確定済み]** ルーティング/管理に使うセッションコードは**自動生成しない**
   — `CLAUDE_CODE_SESSION_ID`をそのまま使う。これはClaude Codeが**実行中の
   まさにその会話に対して自動的に払い出す**環境変数であり、実際に存在することを
   確認済み（この同じセッション内で`env`から読み取れる:
   `CLAUDE_CODE_SESSION_ID=b41c7c22-...`）。このUUIDはシステムが払い出し、
   会話ごとに絶対的な一意性が保証されているため、**2つの異なるClaudeウィンドウが
   1つのセッションを奪い合うリスクはもはや存在しない** — 以前に挙げていた
   「所有権」の問題は自然に消滅し、追加のロックファイルは一切不要になった。
4. キューは**maildir方式**（1ファイル=1メッセージ）を使用する — 自前でファイル
   ロック機構を書く必要はない。
5. **[確定済み]** メッセージ送信は**REST APIを1回のHTTPコマンドで直接**呼び出す
   （例: `curl`）— `discord-listener.js`を経由せず、`discord.js`も使わず、
   Gateway/ログインも不要。
6. **初回接続（スレッド作成）でも再接続でも、必ずデフォルトのメッセージを
   スレッドへ即座に送信する** — 接続成功を確認するため、そしてユーザーが
   Discord上でセッションが準備完了したことをすぐ知れるようにするため。

## 1. 元々の要件

1. **プロジェクト**ごとに専用の**Discordチャンネル**1つを対応させる。
2. **セッション**（Claude Codeの具体的な1つの会話）ごとに、そのチャンネル内の
   専用**スレッド**1つを対応させる。
3. 異なるプロジェクトは異なるチャンネルを使い、互いに独立して並行動作する。
4. 明示的に要求されたときのみDiscordに接続する。
5. スレッドがまだないセッションへの接続 → 自動作成、すでにあれば → 再利用。
6. 接続時（新規作成であれ再利用であれ）は、**デフォルトで1つのメッセージを
   スレッドに送信**して確認とする。

## 2. 譲れない原則

- **ブリッジを自動起動しない** — 明示的な指示があったときのみ実行する。
- **プロジェクト間で状態を共有しない** — 各プロジェクトはそれぞれ自分自身の
  `.claude/skills/claude-easy-discord-bridge/`のコピーを個別に使用する。
- **プロジェクトごとに、ある時点で有効なGateway接続は最大1つまで。**
- **識別/ルーティングには常にコード（`CLAUDE_CODE_SESSION_ID`）を使い、名前は
  絶対に使わない。** 名前はDiscord上の表示ラベルにすぎず、接続時にClaudeが
  自分で付ける（今行っている作業を簡潔に説明したもの、例:「ログインバグ修正」、
  「HPG分析」）。一意性の制約はなく、検索・照会には使わない。

## 3. コンポーネント構成

```
.claude/skills/claude-easy-discord-bridge/
  .env                       # DISCORD_BOT_TOKEN, SERVER_ID, CHANNEL_ID, ALLOWED_USER_IDS
  scripts/
    lib.js                    # 共通ヘルパー（.envの読み込み、JSONのatomicな読み書き、
                              #   CLAUDE_CODE_SESSION_IDの読み取り、Discordへのrest呼び出し）
    discord-listener.js        # プロジェクトにつき唯一のプロセス、常駐し続け、
                              #   Gateway接続を1つ保持、受信のみを担当
    ensure-thread.js           # RESTを1回: 現在のセッション用スレッドを検索/作成
                              #   + 接続確認メッセージを送信
    listen-message.js          # パラメータ不要 — 環境変数からCLAUDE_CODE_SESSION_IDを
                              #   自分で読み、正しいinboxを読むべきだと把握する
    send.js                    # 内容をパラメータとして受け取り、自分で
                              #   CLAUDE_CODE_SESSION_IDを読んでどのスレッドに送るべきか把握し、
                              #   RESTを直接呼び出す（ログイン不要、
                              #   discord-listener.jsに依存しない）
    react.js                   # 状態を表す絵文字を付与/削除（🤔開始、✅完了）、
                              #   startとdoneを逐次呼び出し - sendと統合し
                              #   reply.jsとして並行実行させ高速化を
                              #   一度試したがrevertされた（5.1節参照）
    disconnect.js               # 1セッションの切断、またはプロジェクト全体の切断
    permission-relay.js         # Discord経由でpermission promptをリレー（8節）
  .data/
    session-map.json           # 永続的なマッピング: コード（CLAUDE_CODE_SESSION_ID）-> {name, threadId}
    active-listener.json       # discord-listener.jsのpid + heartbeat
    active-sessions.json       # 「生きている」セッションのregistry（session-map.jsonとは
                              #   異なり、こちらは永続的なマッピングではない）— {sessionId,
                              #   現在のlisten-message.jsプロセスのpid, connectedAt} —
                              #   誰かがプロジェクト全体を切断しようとした際に安全性を
                              #   判断するために使う
    inbox/
      <CLAUDE_CODE_SESSION_ID-1>/   # 受信メッセージのキュー、実際のセッションごとに専用
        1739850001234-a1b2.json
      <CLAUDE_CODE_SESSION_ID-2>/
```

フォルダ構成はAnthropicのスキル規約に正確に従っている。Claudeが実行するスクリプトは
`scripts/`配下に置き、`SKILL.md`から`${CLAUDE_SKILL_DIR}/scripts/<file>.js`という
変数経由で呼び出す（自動的に絶対パスへ置換され、cwdがどこであっても正しく動作する）。
`lib.js`は`path.join(__dirname, '..')`で`SKILL_DIR`を計算する。これは`lib.js`自身も
`scripts/`配下にあり、`.env`/`.data/`より1階層下にあるためである。

`session-map.json`:
```json
{
  "b41c7c22-d067-470e-90e2-7bd87dbcd7ef": {
    "name": "sửa lỗi login",
    "threadId": "1538900000000000001"
  },
  "9f2a1e10-55bb-4a11-8e3d-2c9a7f001122": {
    "name": "phân tích HPG",
    "threadId": "1538900000000000002"
  }
}
```
- **マップのキー = `CLAUDE_CODE_SESSION_ID`** — Claude Codeが払い出す本物のコードで、
  自動生成ではなく、異なる2つの会話の間で重複することはあり得ない。
- `name` — Discord上のスレッドタイトルとして表示するためだけのもので、
  `ensure-thread.js`を呼ぶ際にClaudeが自分で付ける。**システム内のどこにおいても
  検索・ルーティングには使用しない。** 異なる2つのセッションで名前が重複しても
  一切問題は起きない（`threadId`が異なるため、Discord上のスレッドは依然として
  分離されている）。
- `threadId` — Discordの実際のID。送受信に使う。

### なぜClaudeが識別子を覚えたり手渡ししたりする必要がないのか

すべてのスクリプト（`ensure-thread.js`、`listen-message.js`、`send.js`）は、
プロセス内で自分自身で`process.env.CLAUDE_CODE_SESSION_ID`を読み取る —
この変数は、実行中のまさにその会話に対応するBashコマンドであれば常に存在しており、
ブリッジが自前で作るのではなく、Claude Code自身が環境に注入する。そのため:
- Claudeは覚える必要も、コマンド呼び出しのたびにコードや名前を受け渡す必要もない。
- 別のセッションへ誤って呼び出してしまうことはあり得ない。環境変数には、
  そのコマンドを実行しているまさにそのプロセス自身の`CLAUDE_CODE_SESSION_ID`
  ただ1つしか含まれないからである。

### なぜmaildir方式のキュー（1ファイル=1メッセージ）なのか

- 書き込み: 同じフォルダ内に一時ファイルを作成してから`fs.renameSync()`で本来の
  ファイル名にリネームする — 同一ドライブ上での`rename`は**原子的（atomic）**な
  操作であり、書き込み途中のファイルが誤って読まれることは決してない。
- 読み込み: フォルダを列挙し、名前が最小のファイルを取得する（ファイル名が
  タイムスタンプで始まるため、自然と正しい順序になる）、読み取ってから削除する。
- 各セッションは（`CLAUDE_CODE_SESSION_ID`ごとに）専用フォルダを持つため、
  セッション間で競合は起きない。同じフォルダ内でも、書き込みと読み込みは
  別々の2つのプロセスだが、常に別々の2つのファイルを操作する → **ファイルロック
  ライブラリは一切不要。**

## 4. 待受（受信）処理 — どうやって安定させるか

`discord-listener.js`はプロジェクトの唯一の単一障害点であるため、いくつかの
自己復旧の仕組みが必要だが、いずれも小さなもので、外部のsupervisor/
process-managerは不要である。

1. **一時的なエラーで自壊しない。** discord.jsは一時的なネットワーク切断時に
   Gatewayの再接続/resumeを自動で行う — `error`/`shardError`ハンドラの中で
   `client.destroy()`/`process.exit()`を呼ば**ない**ようにし、ログに記録するだけに
   すればよい。このバージョンは常駐し続けるものであり、終了することは異常
   （旧`listen-once.js`が1メッセージ処理後に自動終了していたのとは異なる）。
2. **`active-listener.json`内のheartbeat。** 一定間隔ごと（例: 30秒）、または
   イベントを1つ処理し終えるたびに、`discord-listener.js`は`{ pid, lastHeartbeat }`
   を上書き保存する。`pid`が生きているかだけをチェックする（`process.kill(pid, 0)`）
   のでは不十分である — プロセスは生きていてもフリーズしている場合がある
   （crashせずにGateway接続だけを失う）。heartbeatが一定の閾値（例: 90秒）を
   超えて古い場合は「信頼できない」とみなし、再起動が必要と判断する。
3. **必要になった時点で自己復旧、専用の監視プロセスは不要。** あるセッションが
   `listen-message.js`を呼ぼうとするたびに、まず`active-listener.json`を確認する
   — pidが死んでいるか、heartbeatが古ければ、続行する前に`discord-listener.js`を
   自動で再起動する。これにより、独立した「見張り」用の追加プロセスが不要になる。
4. **停止を指示された際にきれいに終了する**（SIGINT/SIGTERM）: `active-listener.json`
   内の自分自身のエントリを即座に削除し、次回のチェックで停止済みだとすぐわかる
   ようにする（heartbeatの期限切れを待つ必要がない）。
5. **エラーをファイルにログ出力する**（`discord-listener.log`）。バックグラウンド
   プロセスが死んだ際にエラーの痕跡が消えてしまわないようにするためである。

## 5. セッションからDiscordへコンテンツを送信する処理

**[確定済み]** メッセージ送信は**Gateway不要、`discord.js`不要、`discord-listener.js`
が生きているかどうかにも依存しない** — 単なる**1回のHTTP REST呼び出し**で、
`POST https://discord.com/api/v10/channels/<threadId>/messages`に対して
`Authorization: Bot <token>`ヘッダーを添えて送るだけである。

```
Claudeが返信したい（CLAUDE_CODE_SESSION_ID = Xのセッション内で実行中）
        │
        ▼
send.js "<内容>"
   → 環境変数から CLAUDE_CODE_SESSION_ID = X を読む
   → コード X で session-map.json を照会し threadId を取得
   → curl/fetch による REST 呼び出しを1回、.env の Bot token を添えて Discord に
     直接送信
   → HTTP response を即座に受け取る（200 = 送信成功、エラー = その場ですぐわかる）
        │
        ▼
discord-listener.js を経由せず、正しいスレッドに即座にメッセージが表示される
```

REST直接呼び出しを選んだ理由は、(a) 送信のたびに`discord.js`で毎回ログインする、
または (b) outboxに書き込んで`discord-listener.js`に代わりに送信させる、という
方式に比べて次の利点があるためである。

- **速い** — HTTPのラウンドトリップ1回（実測 約400〜660ms、5.1節参照）で、
  Gateway接続の確立/維持に時間を取られない。
- **エラーをその場ですぐ知れる** — トークンが誤っている/期限切れ、あるいはbotが
  そのスレッドへの送信権限を失っている場合、`send.js`はHTTPエラーコードから
  即座にそれを把握できる。
- **`discord-listener.js`から完全に独立している** — listenerが死んでも受信側にしか
  影響せず、送信側には影響しない。
- **`send.js`は`discord.js`をインストールする必要がない** — 必要なのはHTTP呼び出し
  （curl、あるいはNode 18+に標準搭載の`fetch`）だけである。
- 内容が2000文字を超える場合 → `send.js`が自動で複数回の連続したREST呼び出しに
  分割する。

### 5.1. 性能 — 実測値（Windows、3回の平均）

| 項目 | 所要時間 |
|---|---|
| node起動 | 約85ms |
| Discordへの任意の1回のREST呼び出し（PUT/DELETE/POST） | 約0.4〜0.66秒 |
| `fs.watch`によるinbox内の新規ファイル検出 | 約14ms |

**遅延の唯一の有意な発生源は、待たされるREST呼び出しの回数であり、inbox読み取りの
仕組みではない。** `fs.watch`の14msは、REST呼び出し1回あたり数百msという数字に
比べれば無視できるほど小さい — `POLL_INTERVAL_MS`（2000msは`fs.watch`が使えない
場合のフォールバックにすぎず、実際にはほぼ発動しない）を最適化しに行くべきではない。

遅延を減らすための3つの原則を実際に**試した**（`reply.js`スクリプト、現在は削除済み）。

1. **REST呼び出しを1つのnodeプロセスにまとめる** — スクリプトを1回呼ぶたびに
   起動コストとして約85msを支払うことになる。`reply.js`はsendとreact ✅を1つに
   まとめた。
2. **互いに独立した呼び出しは`Promise.all`にし、`await`を連鎖させない** — 例えば
   🤔を外して✅を付けるのは異なる2つの絵文字で、互いに完全に独立している。
3. **表示上の効果しか持たない呼び出しはfire-and-forgetにする** — `react.js start`
   は`run_in_background: true`で呼び出す。実作業を始める前に絵文字が付くのを
   約0.9秒待って処理をブロックすることがない。

結果として良い数値が測れた: 1回の返信あたりのコストが**約3.2秒から約0.76秒**
まで下がった。

**しかし、ユーザーから全体をREVERTするよう要求される、2つの実際の問題が発生した。**

- バグ: 原則3（fire-and-forget）により、バックグラウンドで走る`react.js start`
  （PUT 🤔）が、直後に同じメッセージに対して呼ばれる`reply.js`（DELETE 🤔 +
  PUT ✅）と**衝突**し、Discordが429レートリミットを返した。`reply.js`は当初
  このエラーを**握りつぶし**（偽の`reacted: true`を報告していた）。
  `lib.discordFetch`にretry-on-429を追加して修正した（このリトライ処理自体は
  今も有用なので残してある）うえ、`reply.js`側でも実際の状態を正しく報告する
  ようにした。
- 運用面: 修正後、（このコードを書いた）Claudeが素早いテストを1回行った後に
  `listen-message.js`の再呼び出しを忘れてしまい、ユーザーは接続が切れたと
  思ってしまった。これは設計上の欠陥ではなく操作ミスだが、429バグと積み重なった
  ことで、ユーザーは「前より遅く、前よりバグが多い」と判断し、旧来のフローに
  戻し🤔アイコンのみを残すよう要求した。

**ユーザーと確定させた結論:** 旧来の逐次フロー（`react start`が完了するのを
待ってから → `send.js` → `react done`が完了するのを待つ、すべて`await`を
連鎖させ、`Promise.all`もプロセスの統合も行わない）を維持する。1回あたり約3.2秒は、
race conditionのリスクと比べれば許容できるコストである。明示的に要求されない
限り、この方向の再最適化は行わない。

## 6. 全体の動作フロー

### 6.1. 1つのセッションを接続する（指示されたときのみ） — 常に確認メッセージを送る

```
ユーザー: 「Discordに接続して」
        │
        ▼
1. Claudeが今行っている作業に対する簡潔な説明的名前を自分で付ける（例:「ログインバグ修正」）
        │
        ▼
2. ensure-thread.js "<Claudeが付けた名前>"
     - 環境変数から CLAUDE_CODE_SESSION_ID = X を読む（手渡し不要）
     - コード X で session-map.json を照会:
         + すでに threadId がある → 再利用する（表示名は更新してもそのままでも
           よく、ルーティングには影響しない）
         + まだない → タイトル = Claudeが今付けた名前として Discord 上に新しい
           スレッドを作成し、{ X: { name, threadId } } を session-map.json に保存
     - この手順の直後に、必ず1つのデフォルトメッセージをスレッドへ送信する
       （例: 「🟢 セッション『<name>』が接続しました。」） — スレッドが新規作成
       であれ再利用であれ、この手順は必須であり、条件付きで省略することはない
3. active-listener.json（pid + heartbeat）を確認:
     - 生きていて heartbeat も新しい → そのまま使う
     - 死んでいる/期限切れ → discord-listener.js を再起動する（バックグラウンド、
       常駐）
4. inbox/<X>/ フォルダが未作成なら空のフォルダを作成
5. ループを開始: listen-message.js を（バックグラウンドで）呼び、task-notification
   を待つ
```

### 6.2. メッセージの受信と処理

```
Discord のメッセージがセッション X の該当スレッドへ送信される
        │
        ▼
discord-listener.js が Gateway 経由で受信 → threadId を照会 → 対応するコード X を
   見つける（threadId から session-map.json を逆引き）
        │
        ▼
inbox/<X>/ へ新しいファイルを1つ書き込む（maildir方式）
        │
        ▼
listen-message.js（正しいセッション X の中で実行されており、自分で
   CLAUDE_CODE_SESSION_ID を読んで正しい inbox/<X>/ を読み取るべきだと把握している）
   が新しいファイルを検出
   → 読み取り、JSON を出力、ファイルを削除 → 終了 → harness が正しい Claude の
     フェーズを起こす
        │
        ▼
Claude が処理 → send.js "..."（X から threadId を自分で照会し、REST を直接呼ぶ）
   → Claude が再度 listen-message.js を呼んで待受を継続する
```

### 6.3. 同じプロジェクト内の複数セッション

- 受信側は1つの`discord-listener.js`を共用する。処理層では各セッションが独立
  している。`inbox/<CLAUDE_CODE_SESSION_ID>/`は専用フォルダで、各会話の
  `listen-message.js`は自分自身のフォルダだけを自分で読む — セッションAが
  忙しくてもセッションBのメッセージ受信は妨げられない。名前をルーティングに
  使わないため、「名前の取り合い」という概念は存在しない。
- 送信側（`send.js`）はlistenerからも他のセッションからも完全に独立している。

### 6.4. 複数プロジェクトの並行実行

- 変更なし: プロジェクトごとに専用の`discord-listener.js`を持ち、他のプロジェクトと
  何も共有しない。

## 7. 切断

### 7.1. いつ切断するか

1. **ユーザーがその会話の中で明示的に要求したとき**（例:「Discordの接続を切って」）
   — 基本の方式であり、常に明示的操作であって自動ではない。
2. **会話が自然に終了したとき**（ウィンドウを閉じる/セッション終了） —
   バックグラウンドで待っている`listen-message.js`プロセスは、まさにそのセッションの
   子プロセスであり、セッションが終了すればプロセスのライフサイクルに沿って
   自動的に片付けられる。追加のコードは不要。

「X分間操作がなければ自動切断」という分岐は存在しない — 指示されたときのみ
行動するという原則（2節）を厳守している。

### 7.2. 特定の1セッションを切断する

```
ユーザー: 「Discordの接続を切って」
        │
        ▼
1. ループを止める: 以降 listen-message.js を再度呼ばない
2. バックグラウンドで待機中の listen-message.js プロセスがあれば → 停止する
3. REST 経由でスレッドに通知メッセージを1つ送信する（接続時と対称的な扱い）:
     「🔴 セッション『<name>』が切断しました。」
4. active-sessions.json（「生きている」ことを表すレジストリ）からこのセッションの
   エントリを削除
```

`session-map.json`（コード↔名前↔threadIdのマッピング）は**そのまま残し、削除
しない** — 後でこの同じ会話をresumeした場合、`CLAUDE_CODE_SESSION_ID`が変わらない
ため、依然として正しい旧スレッドに再接続でき、新しいスレッドが重複作成される
ことはない。

### 7.3. プロジェクト全体を切断する（`discord-listener.js`を完全停止）

listenerを共用している**他のすべてのセッション**に影響するため、1セッションの
切断よりもはるかに慎重を要する — 1つのセッションが自ら切断したことの暗黙の
結果として扱ってはならない。

```
ユーザー: 「このプロジェクトの Discord を全部切断して」
        │
        ▼
1. active-sessions.json を読む → 実際に生きているセッションを列挙する
2. 現在のセッション以外に、生きている他のセッションはあるか?
     - ある → 実行前に警告する:「他に N 個のセッションが接続中です。プロジェクト
       全体を停止するとそれらのセッションも切断されますが、よろしいですか?」
     - ない / すでに確認済み → 続行する
3. discord-listener.js を kill する（active-listener.json 内の pid に基づく）
4. active-listener.json を削除する
```

`session-map.json`はそのまま維持する — これは単なるマッピングデータであり、
「実行中」という状態ではないため、listenerを停止する際に削除する必要はない。

## 8. Discord経由での権限リクエスト（permission prompt）のリレー

実際のテストで発見した後に追加された項目: ブリッジは当初**チャット**のみを
リレーし、**permission prompt**（Claude Codeがtool実行の許可を求める場面）は
リレーしていなかった。Discord側にいるユーザーには、元のインターフェース
（VSCode）にしか表示されないそのプロンプトが見えず、承認もできなかった。
ユーザーと確定した要件は: **Claude Codeの元の仕組みに忠実に従う** —
Claudeが権限を尋ねるタイミングでリレーし、Claudeが尋ねなければ何も送らず、
待機がタイムアウトした場合はClaude Code本来のfail-open機構にそのまま任せる
（独自ルールを勝手に作らない）。

### 8.1. 採用する仕組み: `PermissionRequest`フック

公式ドキュメント（`https://code.claude.com/docs/en/hooks.md`）で確認済み:
- `PermissionRequest`フックは**Claude Codeがまさにpermission promptを表示しようと
  する瞬間にのみfireする** — 既存のpermission-mode/ルールによってauto-allowされる
  toolであればこのフックは実行されないため、アプリケーション層で追加のフィルタ
  処理をする必要がない。
- 入力（stdin、JSON）: `session_id`、`tool_name`、`tool_input`、`permission_mode`、
  `tool_use_id`など。
- 出力（stdout、JSON、exit code 0のとき）:
  `{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": "allow"|"deny"|"escalate", "reason": "..."}}`
  - `escalate` = 元のインターフェースでの通常の確認に戻す（Discord上の回答が
    不明瞭なときに使う）。
- **Claude Code本来の設計どおりのfail-open**: フックがクラッシュする、不正な
  形式のJSONを出力する、あるいは**タイムアウトする**（デフォルト600秒。hook設定の
  `timeout`フィールドで調整可能）場合 → Claude Codeは自動的に通常のpermission
  フローに戻る（ブリッジがなかったときと同様にVSCode上でプロンプトを表示する）。
  固まって動かなくなることは**なく**、勝手に何でも許可してしまうこともない。
  これがまさにユーザーが要求していた「期限切れになったらClaudeの仕組みに従う」
  という挙動であり、独自のタイムアウトロジックを追加する必要はなく、Discordでの
  待機時間が過ぎても何も返答しなければ、それだけで正しくfail-openする。

### 8.2. ルーティングの課題: 権限承認の返答 vs 通常のチャットメッセージ

どちらも同じスレッド内のテキストメッセージであるため、`listen-message.js`
（チャットのループ）が権限承認の返答を誤って取り込んでしまわないよう、また
その逆も起きないよう、流れを分離する必要がある。

解決策: 1回限りのフラグファイルで「権限承認待ち」を示す。

```
pending-approval/<CLAUDE_CODE_SESSION_ID>.json   # { promptId, askedAt } - 質問時にhookが作成
approvals/<CLAUDE_CODE_SESSION_ID>/               # 権限承認の返答専用のmaildir
```

- `permission-relay.js`（hookによって実行されるスクリプト）は、質問をスレッドへ
  送信する前に`pending-approval/<code>.json`フラグファイルを作成し、その後
  `approvals/<code>/`フォルダをポーリングして返答を待つ。
- `discord-listener.js`: メッセージを受信するたびに、通常どおり`threadId`から
  `sessionId`を照会した後、さらに`pending-approval/<code>.json`フラグファイルが
  存在するかを確認する。
  - 存在する → これはpermission promptへの返答である: `approvals/<code>/`に
    書き込み（`inbox/<code>/`には書き込まない）、フラグファイルを**即座に削除**
    する（1回限りの使用）。これにより次のメッセージからは通常どおり`inbox/`への
    ルーティングに戻る。
  - 存在しない → 従来どおり`inbox/<code>/`へルーティングする。
- `permission-relay.js`は`approvals/<code>/`内のファイルを読み取り、意図を
  パースする: 「y」「yes」「allow」「ok」「được」「đồng ý」「duyệt」などの単語を
  含む → `allow`；「n」「no」「deny」「không」「từ chối」を含む → `deny`；
  判別できない → `escalate`（VSCode側で再度尋ねる方に倒す。当て推量するより
  安全なため）。

### 8.3. Discordへ送信する権限確認メッセージの内容

```
⚠️ [権限リクエスト] セッション '<name>' がtool '<tool_name>' を使いたがっています:
```<tool_inputを最大~1500文字程度に短縮したもの、JSON形式>```
'y' と返信すると許可、'n' と返信すると拒否します。時間内に返信がない場合は、
プロンプトは通常どおりVSCode側に自動で再表示されます。
```

### 8.4. 実装上のリスク — 本番投入前に切り分けてテストすべき理由

`.claude/settings.json`（または`.claude/settings.local.json`）に設定するフックは
**プロジェクト全体、全セッションに適用される**ものであり、Discordに接続中の
セッションだけが対象ではない。`permission-relay.js`の不具合は、このリポジトリで
実行中のあらゆるClaude Codeセッションの権限確認体験に影響しうる。Discordとは
まったく無関係なセッションも含めてである（9.1節のfail-open機構でフリーズの
リスクは軽減されているが、ロジック上の誤りのリスクを完全には排除できない）。
そのため、本番投入前に次の手順を必ず踏むこと。

1. `permission-relay.js`単体を、stdinに自分で偽のJSONを流し込んでテストする
   （`settings.json`には触れない）— 十分な分岐を確認する: Discordに接続していない
   セッション（何も出力せず沈黙するはず）、Discordに接続していてallow/deny/
   不明瞭な返答をするセッション、待機タイムアウト。
2. 手順1がすべてパスした後にのみ、hookを`settings.json`に追加し、Discordに
   接続中のセッションで実際のtool呼び出しを使って本番同様のテストを行う。
3. 手順2で何か異常な兆候（hookが正しいタイミングでfireしない、不正な形式を
   受け取ってしまう、など）があれば、原因調査を進める前にすぐ`settings.json`
   から削除する — 他のセッションへの影響を出さないことを最優先にする。

## 9. まだ対応範囲外 / 未対処のリスク

- **`session-map.json`とDiscord上の実態との同期**（Discord上で手動でスレッドが
  削除/リネームされた場合）— 検出して自動復旧する仕組みはまだない。
- **DM**にはスレッドという概念がなく、対応を維持したい場合は専用の分岐が必要。
- **botの権限**: 既存のView/Send権限に加え、各プロジェクトの親チャンネルに
  `Create Public Threads` + `Send Messages in Threads`が必要。
- **Discordの1メッセージ2000文字制限**、返信内容が長い場合 — `send.js`側に
  分割ロジックが必要だが、どう分割するか（行単位か、段落単位か）はまだ詳細
  設計していない。
- **古いセッションの整理**: `session-map.json`/`inbox/`は、これまでに接続した
  会話の数に応じて徐々に肥大化していく — 期限切れ/もう使われていない
  `CLAUDE_CODE_SESSION_ID`を定期的に整理する仕組みはまだない。

## 10. 実際にテスト済み（シミュレーションではない）

実際にスレッドを作成し、実際に確認メッセージを送信し、ユーザーが実際にスレッドへ
メッセージを打ち込んで`discord-listener.js`が正しくinboxに受信・書き込みを行い、
`listen-message.js`が正しいFIFO順で取得し、`send.js`が送信して2000文字超の
メッセージを自動分割し、bot自身のメッセージを正しくself-filterし、
`disconnect.js session`が待機中の正しいプロセスをkillしつつ切断メッセージを
送信し、`session-map.json`を保持したまま同じスレッドへのresumeを可能にし、
`disconnect.js project`が他に生きているセッションがある場合に正しく警告を出し、
`--confirm`でlistenerを正しくkillすることをすべて確認した。テスト用スレッドは
Discord上でarchive/リネーム済みである（botには`Manage Threads`権限がなく、
スレッドを完全に削除する権限は持たない）。
