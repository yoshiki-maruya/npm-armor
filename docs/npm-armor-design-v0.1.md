# npm-armor 詳細設計書

**Version:** 0.1 (Draft) | **Date:** 2026-07-18 | **Status:** レビュー待ち

---

## 1. 目的とスコープ

npm-armor は、JavaScript プロジェクトのサプライチェーン防御設定 — クールダウン、ライフサイクルスクリプト制御、lockfile 運用、CI でのインストール方法など — を診断(check)・生成(fix)・維持(ci)する CLI ツールである。

Socket や Snyk のようなマルウェア検出・脅威インテリジェンス(「何が悪いか」を見つける層)とは競合しない。本ツールが担うのは「パッケージマネージャに既に備わっている防御機能が、正しく有効化され、維持されているか」という設定レイヤーであり、両者は補完関係にある。

スコープ外とするもの: マルウェアの静的解析、脆弱性データベースの照会(npm audit / osv-scanner の領分)、パッケージ公開者側のワークフロー保護、マシン全体の IOC スキャン(性質が異なるため別ツールとして検討)。

## 2. 設計原則

本ツールは「侵害された可能性のあるリポジトリの上で実行される」ことを前提とする。この前提から、交渉不能な原則を 6 つ定める。すべての機能設計・実装判断はこの原則への適合を先に確認する。

**原則 1: ゼロ実行。** 対象リポジトリ由来のコード・バイナリを一切実行しない。`node_modules/.bin` はもちろん、`npm config get` のようなパッケージマネージャ(PM)バイナリの呼び出しも行わない。侵害済みリポジトリでは PM の shim 自体が差し替えられている可能性があるためで、すべて設定ファイル・lockfile の直接パースで完結させる。`child_process` / `vm` / `eval` / `new Function` / 対象リポジトリ由来パスの動的 import はコードベース全体で禁止し、自プロジェクトの lint ルールで機械的に強制する。

**原則 2: ゼロ依存。** ランタイム依存は 0 個。本ツール自身がサプライチェーン攻撃の踏み台にならないことが信頼の前提であり、これは同種ツール(lockfile-lint 等)との差別化点でもある。

**原則 3: ゼロネットワーク。** v1 系は一切の通信を行わない。全検査はローカルファイルのみで完結する。レジストリ照会を要する機能(新規依存の公開経過時間の注釈など)は v2 以降で opt-in フラグ付きでのみ導入し、通信先を実行時に明示する。テレメトリ・利用統計の収集は永久に実装しない(README に明記)。

**原則 4: 読み取り専用デフォルト。** 既定動作は dry-run。書き込みは `--write` 明示時のみで、差分表示とアトミック書き込みを伴う。CI モードでは書き込み機能自体を無効化する。

**原則 5: 設定はデータ。** 本ツール自身の設定ファイルは JSON のみ(`armor.config.json`)。ESLint のような JS 設定ファイル方式は採用しない。対象リポジトリの JS を読み込む経路を一切作らないため。

**原則 6: 安全側フォールバック。** パース不能・判定不能な入力に遭遇した場合、「OK」ではなく「判定不能(warn)」として報告する。攻撃者が解析困難なファイルを作ることで検査をすり抜ける経路を塞ぐ。

## 3. 全体アーキテクチャ

### 3.1 レイヤ構成

```
bin/armor                  CLI エントリポイント
src/
  cli/        引数解釈・コマンドディスパッチ(自前実装、依存なし)
  engine/     ルール実行・結果集約・severity 判定
  detect/     PM 検出・プロジェクト構造(モノレポ等)の把握
  adapters/   PM 別の設定リーダ / ライタ
              npmrc(INI) / pnpm(YAML サブセット) / yarnrc(YAML サブセット)
              bunfig(TOML サブセット) / ci-yaml(GitHub Actions 等)
  rules/      ルールカタログ(1 ルール = 1 モジュール、宣言的)
  report/     tty / json / sarif / github レポータ
  io/         安全な FS 層(パス検証・サイズ制限・アトミック書込・サニタイズ)
```

設計上の要点が 2 つある。第一に、adapters は「フルパーサ」ではなく「必要キーの抽出とパッチに特化した制限付きパーサ」とする。YAML のアンカー・エイリアス・タグのような高リスク機能は非対応とし、遭遇した場合は該当ファイルを「解析不能」として原則 6 に従い warn で報告する。第二に、ファイルアクセスは必ず `src/io` を経由する(`fs` の直接 import を lint で禁止)。パス検証・サイズ上限・サニタイズを一箇所に集約し、抜け漏れを構造的に防ぐ。

### 3.2 実行フロー(check)

1. プロジェクトルートの確定(`--dir` または cwd を realpath 化)
2. detect: lockfile 群・`packageManager` フィールド・設定ファイルの存在から使用 PM を推定
3. io: 対象ファイルをサイズ上限(既定 64MB/ファイル)内で読込
4. adapters: 必要キーのみ抽出し、PM 差を吸収した正規化モデル(NormalizedConfig)へ変換
5. engine: 有効ルールを正規化モデル上で実行し、Finding 列を生成
6. report: 指定フォーマットで出力し、exit code を決定

ルールは正規化モデルのみを見るため、PM ごとの差異(設定名・単位・ファイル位置)はルール実装から完全に隠蔽される。新 PM 対応はアダプタ追加のみで済む。

### 3.3 対応環境

Node.js >= 20(LTS 下限)、ESM のみ。OS は Linux / macOS / Windows(パス区切り・CRLF・ユーザー設定ファイルの位置差はアダプタで吸収)。対応 PM は npm >= 9、pnpm >= 9、Yarn Berry >= 4、Bun >= 1.1。それ以前の版も検出自体は行い、防御機能が存在しない版には「PM 自体の更新」を提案する専用ルール(AR014)で対応する。

## 4. 機能設計

### 4.1 コマンド体系

```
armor check   [--dir <path>] [--format tty|json|sarif|github] [--config <path>]
armor fix     [--write] [--rule <id>...] [--preset recommended|strict]
armor ci      [--policy <path>] [--format github|sarif|json]
armor rules   [--json]
armor explain <ruleId>
```

check は診断のみ。fix は既定で dry-run(差分プレビュー)、`--write` で書込。ci は check にポリシー照合と CI 向け出力を加えたもので、書込系機能は無効。rules はルール一覧、explain は個別ルールの背景(なぜ必要か・対応する実攻撃事例・参考リンク)を表示する。

exit code は安定契約とする: `0` = 違反なし / `1` = error レベル違反あり / `2` = 実行エラー / `3` = 設定・ポリシーファイル不正。

### 4.2 ルールカタログ v1

各ルールは `id` / `severity`(error・warn・info)/ `check()` / `fix()`(任意)/ 対応攻撃事例への参照、を持つ宣言的モジュールとして実装する。★ = MVP(M1)対象。

| ID | ルール名 | 検査内容 | fix | 主に防ぐ攻撃・根拠 |
|---|---|---|---|---|
| AR001 ★ | cooldown-enabled | クールダウン設定(npm `min-release-age` / pnpm `minimumReleaseAge` / Yarn `npmMinimalAgeGate` / Bun `minimumReleaseAge`)が存在し、閾値(既定 24h、strict 7d)以上か | 可 | 公開直後の汚染版の即時取込(Axios 2026-03 等) |
| AR002 ★ | lifecycle-scripts-restricted | npm/Yarn: `ignore-scripts=true`。pnpm: v10+ の既定ブロックが無効化されていない・`onlyBuiltDependencies` が明示的 allowlist。Bun: `trustedDependencies` 運用 | 一部可 | postinstall 経由の RAT 投下(Axios)、ワーム自己増殖(Shai-Hulud) |
| AR003 ★ | git-deps-restricted | npm 11.10+ の `allow-git=none`、または git 依存が存在しないこと | 可 | git 依存が持ち込む `.npmrc` による scripts 再有効化 |
| AR004 ★ | lockfile-committed | lockfile が存在し、git 管理下にあり、`.gitignore` に含まれない | 不可(手順提示) | 版の非決定的解決による汚染版取込 |
| AR005 ★ | ci-clean-install | CI 設定内で `npm ci` / `--frozen-lockfile` / `--immutable` を使用 | 提案のみ | CI での lockfile 無視インストール |
| AR006 | ci-scripts-disabled | CI のインストールに `--ignore-scripts` が付与されている | 提案のみ | CI 環境での秘密情報窃取(OIDC トークン・キャッシュ汚染) |
| AR007 ★ | lockfile-trusted-sources | lockfile 内の resolved URL が許可レジストリ + https のみ(lockfile-lint 相当を依存ゼロでネイティブ実装) | 不可 | lockfile poisoning(不可視の取得元差替え) |
| AR008 | phantom-root-deps | lockfile ルート直下に package.json から到達不能な直接依存が存在しない | 不可 | 幽霊依存の注入(Axios の `plain-crypto-js` 型) |
| AR009 ★ | npmrc-integrity | `.npmrc` 内の危険設定(registry 差替え、`strict-ssl=false`、`script-shell` 変更、平文トークン)検出 | 一部可 | プロジェクト同梱 `.npmrc` による環境改変 |
| AR010 ★ | single-lockfile | 複数 PM の lockfile が混在していない | 不可 | 実効 PM の曖昧化による防御すり抜け |
| AR011 | save-exact | `save-exact=true`(新規追加依存の完全ピン留め) | 可 | キャレット範囲による汚染 minor/patch の自動取込 |
| AR012 | provenance-verified-in-ci | CI に `npm audit signatures` 等の署名・プロベナンス検証ステップが存在 | 提案のみ | プロベナンス降格・非正規ビルドの混入 |
| AR013 | config-layering | クールダウン等がプロジェクト層・ユーザー層の両方に設定されている(片側のみを warn) | 可 | 未設定リポジトリでの防御の暗黙バイパス |
| AR014 | pm-version-pinned | `packageManager` フィールド(Corepack)で PM とバージョンを固定。防御機能を持たない古い PM 版を検出 | 可 | PM バージョン差による設定の無効化 |

ルールセットはタグ付きで凍結する(`recommended@1`)。新ルール追加や既定 severity の強化は `recommended@2` として別版で提供し、ツールのアップデートが利用者の CI を突然壊さないことを保証する(ESLint の設定共有で繰り返された問題への対策)。

### 4.3 単位変換仕様(fix の中核)

クールダウン値は内部表現を「分」に統一し、書込時に各 PM の方言へ変換する。この変換テーブル自体が本ツールの主要な提供価値の一つであるため、往復変換のプロパティテストで保証する。

| PM | 設定キー | 単位 | 7 日の場合の出力 | 除外リスト |
|---|---|---|---|---|
| npm (>= 11.10) | `min-release-age`(.npmrc) | 日(切上げ) | `min-release-age=7` | 非対応 → 指定時は警告と代替案提示 |
| pnpm (>= 10.16) | `minimumReleaseAge`(pnpm-workspace.yaml) | 分 | `minimumReleaseAge: 10080` | `minimumReleaseAgeExclude` |
| Yarn (>= 4.10) | `npmMinimalAgeGate`(.yarnrc.yml) | 分 | `npmMinimalAgeGate: 10080` | `npmPreapprovedPackages` |
| Bun (>= 1.3) | `minimumReleaseAge`(bunfig.toml) | 秒 | `minimumReleaseAge = 604800` | `minimumReleaseAgeExcludes` |

npm の除外リスト非対応のように「等価な設定が存在しない」場合、fix は無言で近似せず、差分プレビューに制約事項として明示する。

### 4.4 fix の書き込み安全性

書き込みは既知の設定ファイル(`.npmrc` / `pnpm-workspace.yaml` / `.yarnrc.yml` / `bunfig.toml`)のみを対象とする。方式は「最小テキストパッチ」: ファイル全体を再シリアライズせず、対象キーの行のみを挿入・置換し、コメントと既存の順序を保持する。構造が複雑で安全にパッチできない場合(YAML アンカー等)は書込を諦め、貼り付け用スニペットの提示にフォールバックする。

安全機構として、(a) 書込直前にファイルを再読込し、読込時と内容が変化していれば中止する(TOCTOU 緩和)、(b) 一時ファイルへ書き込み fsync 後に同一ディレクトリ内で rename するアトミック書込、パーミッション保持、(c) 書込先が symlink の場合は拒否、(d) 不変条件「fix は設定を強くする方向にしか変更しない」— 既存値が推奨より厳しい場合は一切変更しない — を実装しプロパティテストで保証する(fix 後の check は必ず pass、fix は冪等)。

### 4.5 ci モードとポリシー

`armor.policy.json` はルールごとの要求レベルを宣言する。ルールセットのタグ凍結版(`"extends": "recommended@1"`)を基点に、個別ルールの上書きを許す。ci は check 結果をポリシーと照合し、GitHub Actions annotations(`::error file=...`)、SARIF 2.1.0(code scanning 連携)、JSON のいずれかで出力する。姿勢の「劣化」(誰かがクールダウンを外した、`ignore-scripts` を無効化した等)は、このポリシー照合が PR 上で検出する — 既存ツールが扱っていない、本ツール固有の防御レイヤーである。

### 4.6 設定ファイル仕様

```jsonc
// armor.config.json(JSON のみ。JS 設定は原則 5 により非対応)
{
  "$schema": "https://npm-armor.dev/schema/config-v1.json",
  "ruleset": "recommended@1",
  "rules": {
    "cooldown-enabled": ["error", { "min": "24h", "exclude": ["typescript", "@types/*"] }],
    "save-exact": "off"
  },
  "ignoreWorkspaces": ["examples/*"]
}
```

### 4.7 モノレポ対応

`workspaces` / `pnpm-workspace.yaml` を検出し、ユーザー層 → プロジェクト層 → ワークスペース層の設定階層を合成した実効値で判定する。CI では `--no-user-config` を既定とし、実行環境のユーザー設定に依存しない再現的な判定を行う。AR013 が層の片寄りを別途警告する。

---

## 5. 非機能設計

### 5.1 脅威モデル(本ツール自体への攻撃)

前提を再掲する: 本ツールは侵害された可能性のあるリポジトリの上で実行される。したがって lockfile・設定ファイル・CI YAML など、読み込む入力はすべて攻撃者が制御しうる敵対的入力として扱う。

| # | 攻撃面 | シナリオ | 対策 |
|---|---|---|---|
| T1 | 敵対的入力による DoS | 巨大 lockfile・深いネストでメモリ枯渇 / ハング | ファイルサイズ上限(既定 64MB、`--max-file-size`)、O(n) の行指向パース、ネスト深度上限 |
| T2 | prototype pollution | lockfile JSON 内の `__proto__` / `constructor` / `prototype` キー | パース直後に `Object.create(null)` ベースの Map へ移送し危険キーを破棄。オブジェクトのディープマージを実装しない |
| T3 | ReDoS | パッケージ名・URL 検証用の正規表現への攻撃入力 | 線形時間パターンのみ使用。`eslint-plugin-regexp` を自プロジェクト CI で強制 |
| T4 | 端末エスケープ注入 | lockfile 内のパッケージ名に ANSI 制御文字を仕込み、レポート表示で端末を操作 | 出力層(`src/io` のサニタイザ)で C0/C1 制御文字・ESC を全除去。表示は必ずこの層を経由 |
| T5 | 出力先インジェクション | GitHub annotation / Markdown / SARIF への改行・構文注入 | レポータごとに専用エスケープ。annotation は 1 行化 + 長さ上限 |
| T6 | symlink 脱出 | 設定ファイルをリポジトリ外への symlink にし、任意ファイルを読ませる / 書かせる | 読込は lstat で symlink を検出し追跡せず「判定不能」。書込は symlink 先を拒否(4.4-c) |
| T7 | TOCTOU | check と fix --write の間にファイルを差し替え | 書込直前の再読込・内容一致検証(4.4-a) |
| T8 | PM バイナリ偽装 | リポジトリ内に npm / pnpm の偽 shim を配置 | 原則 1(ゼロ実行)により経路自体が存在しない |
| T9 | 本パッケージのサプライチェーン汚染 | 依存・ビルド・公開経路の侵害 | 5.2 で詳述 |
| T10 | fix の悪用 | 「修復」と称して設定を弱める方向へ誘導する入力 | 不変条件「強化のみ」(4.4-d) |
| T11 | 設定ファイル経由のコード実行 | 対象リポジトリの armor.config.js を読み込ませる | JSON 設定のみサポート(原則 5)。`.js` 設定を発見した場合は無視し warn |
| T12 | 環境変数経由の情報接触 | 誤って認証情報系環境変数に触れる実装 | `process.env` 参照を色制御(`NO_COLOR` 等)と CI 検出のみに lint で限定 |

### 5.2 セルフサプライチェーン規約(本パッケージの開発・リリース)

自分が推奨する防御をすべて自分に適用する(dogfooding)ことを最低条件とし、さらに配布物の監査可能性を確保する。

**依存管理。** ランタイム依存 0。devDependencies も最小構成(TypeScript コンパイラのみを基本とし、テストは `node:test` を使用して追加依存を回避。パーサ fuzz 用の fast-check のみ導入を検討)。devDependencies は exact 固定、lockfile コミット、クールダウン 7 日を自リポジトリに設定、CI は `npm ci --ignore-scripts`。自リポジトリで `armor ci` を常時実行し、pass しない状態ではリリースできないようにする。

**パッケージ内容。** install scripts(preinstall / postinstall 等)を一切含めない。`files` フィールドで `dist` + README + LICENSE のみの allowlist 配布。bin は 1 つ。プリビルドバイナリなし(純 JS 配布)。公開前 CI で「tarball 内容の allowlist 検査」を行い、想定外ファイルの混入でリリースを失敗させる。

**ビルド。** tsc のみ。バンドラ・ミニファイアは使わない。難読化された配布物はユーザーによる監査可能性を損ない、この種のツールでは信頼の毀損に直結するため。リリース CI ではクリーン環境での再ビルドを行い、公開予定 tarball との差分がゼロであること(再現ビルド)を検証する。

**公開経路。** GitHub Actions の OIDC Trusted Publishing + provenance attestation で公開する。長期 npm トークンによる手動公開は運用上禁止し、可能な設定があればレジストリ側でも無効化する — 2026 年 3 月の Axios 侵害は、盗まれたトークンによる手動公開で OIDC 保護を迂回した事例であり、この経路を残すこと自体がリスクである。npm アカウントは WebAuthn による 2FA。公開は保護ブランチ上のタグからのみ。

**名前防御。** 公開名の確保を最優先タスクとする(未確保のまま設計・実装を進めない)。同時に主要な typo 候補(npmarmor、npm-armour 等)の空き状況を確認し、確保またはドキュメントでの注意喚起を行う。README・公式サイトでインストールコマンドを常に明記し、コピー元を一意にする。

### 5.3 実装セキュリティ規約(コーディング標準)

原則 1 と脅威モデルをコードレベルで機械的に強制する。`child_process`・`vm`・`eval`・`new Function`・動的 import の使用は自プロジェクトの ESLint(`no-restricted-imports` / `no-restricted-syntax`)で禁止し、CI で違反をブロックする。`fs` の直接 import も禁止し、すべてのファイルアクセスをパス検証・サイズ制限・サニタイズを内蔵した `src/io` に集約する。外部入力由来の文字列は、いかなるレポータに渡る前にも必ずサニタイズ層を通す型設計(生文字列と検証済み文字列を型で区別)とする。乱数・暗号・ネットワーク API は使用箇所が存在しないこと自体をテストで確認する(v1 のゼロネットワーク保証)。

### 5.4 性能設計

npx での単発実行が主要な利用形態であるため、「ダウンロードが軽い・起動が速い・大入力でも破綻しない」の 3 点を予算化し、CI のベンチマーク回帰テスト(±20% 閾値)で守る。

| 項目 | 予算 | 実現手段 |
|---|---|---|
| パッケージサイズ | unpacked < 300KB、ファイル数 < 40 | 依存ゼロ + tsc のみ + files allowlist |
| 起動オーバーヘッド | `--version` 応答 < 50ms(Node 起動除く) | コマンド別 lazy import、トップレベルでの重い処理禁止 |
| check(中規模) | lockfile 5MB / 依存 2,000 で < 300ms | `JSON.parse` 一発 + 単一パス正規化、入力の再走査なし |
| check(大規模) | lockfile 20MB で < 1.5s | 同上。上限 64MB 超は明示エラー |
| メモリ | ピーク < 256MB(20MB lockfile 時) | 正規化モデルは必要フィールドのみ保持 |

YAML / TOML サブセットパーサは行指向の O(n) 実装とし、バックトラックを持たない。ルールは正規化済みモデル上でのみ動作するため、ルール数の増加が入力パースコストに影響しない構造を保つ。

### 5.5 互換性・安定性契約

exit code(4.1)、JSON 出力(`schemaVersion` フィールド付き)、ルール ID は後方互換の安定契約とする。ルールの追加は minor、既定 severity の強化や推奨セットの変更は新しいルールセットタグ(`recommended@2`)として提供し、既存タグを参照する CI の挙動を変えない。Node・PM のサポートポリシー(それぞれ最新 LTS-1 まで / 各 PM の直近メジャー 2 版)を README に明記し、乖離が生じたら major で更新する。

### 5.6 テスト戦略

**ゴールデンフィクスチャ。** {npm, pnpm, Yarn, Bun} × {未設定 / 推奨設定 / 推奨より厳しい設定 / 壊れた設定} × {単一パッケージ / モノレポ} の組合せで check 出力のスナップショットを固定する。

**敵対的フィクスチャ。** 脅威モデルの各項目に対応する入力 — `__proto__` キー入り lockfile、ANSI 制御文字入りパッケージ名、64MB 境界の巨大ファイル、深いネスト、リポジトリ外 symlink、CRLF / BOM / 非 UTF-8 — で、クラッシュせず安全側の判定になることを検証する。

**プロパティテスト。** fix → check が必ず pass する、fix が冪等である、単位変換が往復一致する、fix が設定を弱めない、の 4 不変条件。パーサには fast-check(dev 限定依存)による fuzz を適用する。

**マトリクス。** OS(ubuntu / macos / windows)× Node(20 / 22 / 24)。加えて自リポジトリでの `armor ci` 常時実行(dogfood)をリリースゲートとする。

### 5.7 運用

SECURITY.md に私的な脆弱性報告窓口と初動応答目標(48 時間)を明記する。ルールごとに explain コマンドと同内容のドキュメントページを持ち、対応する実攻撃事例へのリンクを付す。新しい攻撃手法が公表された際は、対応ルールの追補を patch / minor で即応するプロセス(トリアージ → ルール草案 → 敵対的フィクスチャ追加 → リリース)を定義しておく。この即応性がツールの信頼と認知の主要な獲得手段になる。

## 6. ロードマップ

**M1(MVP、目安 6 週間)。** check + fix、対応 PM は npm / pnpm、ルールは AR001–005 / 007 / 009 / 010 の 8 個、レポータは tty + json。テスト基盤(ゴールデン + 敵対的フィクスチャ + プロパティテスト)と 5.2 のリリースパイプラインを M1 の必須スコープに含める — セルフセキュリティは後付けできないため。

**M2。** Yarn / Bun アダプタ、ci コマンド + ポリシーファイル + SARIF + GitHub Action ラッパー、全 14 ルール、Windows の正式サポート。

**M3。** `armor diff`(lockfile のセキュリティ観点セマンティック差分、PR コメント出力)。ここで初のネットワーク機能(新規依存の公開経過時間・プロベナンス状態の注釈)を opt-in で導入。AR012 をローカル検証可能な実装へ強化。

## 7. 未決事項

| # | 論点 | 選択肢 | 推奨案 |
|---|---|---|---|
| 1 | パッケージ名 | `npm-armor` の可用性未確認。スコープ付き(`@armor/cli` 等)も候補 | 着手前に名前確保を完了させる |
| 2 | 実装言語 | TypeScript(tsc ビルドのみ) vs 純 JS + JSDoc 型注釈 | TS。ビルドが tsc 一段なら監査可能性は保てる |
| 3 | クールダウン推奨既定値 | 24h(pnpm 11 の既定と整合) vs 7d(保守的) | 既定 24h、`--preset strict` で 7d |
| 4 | .yarnrc.yml の書換 | 最小テキストパッチ vs 提案(スニペット)のみ | M2 で最小パッチ、複雑構造は提案へフォールバック |
| 5 | ユーザー層設定の扱い | 両層の設定を要求 vs プロジェクト層のみで pass | 既定はプロジェクト層で pass、片側のみは AR013 が warn |
