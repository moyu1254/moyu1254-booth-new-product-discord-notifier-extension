# BOOTH New Product Discord Notifier Extension

![JavaScript](https://img.shields.io/badge/JavaScript-ES2020-F7DF1E?logo=javascript&logoColor=000)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=fff)
![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-FF7139?logo=firefoxbrowser&logoColor=fff)
![License](https://img.shields.io/badge/license-MIT-blue)

BOOTH の指定タグに新商品が追加されたとき、ブラウザ拡張内の新着商品一覧に追加し、必要に応じて Discord Webhook へ通知するツールです。

このリポジトリは [moyu1254/booth-new-product-discord-notifier.git](https://github.com/moyu1254/booth-new-product-discord-notifier.git) をブラウザ拡張として移植したものです。

## 目次

- [概要](#概要)
- [主な機能](#主な機能)
- [使用技術](#使用技術)
- [対応ブラウザ](#対応ブラウザ)
- [導入方法](#導入方法)
- [設定方法](#設定方法)
- [成人向け商品の扱い](#成人向け商品の扱い)
- [開発環境での使い方](#開発環境での使い方)
- [ディレクトリ構成](#ディレクトリ構成)
- [利用できるスクリプト](#利用できるスクリプト)
- [リリース手順](#リリース手順)
- [トラブルシューティング](#トラブルシューティング)
- [ライセンス](#ライセンス)

## 概要

この拡張機能は、BOOTH の検索結果ページを定期的に取得し、指定したタグの新着商品を検出します。

検出した商品は拡張機能のポップアップにある `新着商品一覧` に追加されます。Discord 通知を有効にしている場合は、同じ商品を Discord Webhook にも送信します。

ブラウザを開いている間だけ動作します。ブラウザが閉じている間や PC がスリープしている間はチェックされません。

## 主な機能

- ブラウザ起動時の自動チェック
- ブラウザ起動中の定期チェック
- 複数の BOOTH タグ監視
- 拡張機能ポップアップへの新着商品一覧表示
- 拡張機能アイコンへの未読件数表示
- Discord Webhook への通知
- 成人向け商品のバッジ表示
- 初回設定時の既存商品スキップ
- Chromium 系ブラウザと Firefox 向けのパッケージ生成

## 使用技術

| 項目 | 内容 |
| --- | --- |
| 言語 | JavaScript / HTML / CSS / PowerShell |
| ブラウザ拡張 | Manifest V3（Chromium 系） / Manifest V2（Firefox） |
| 定期実行 | `chrome.alarms` / `browser.alarms` |
| データ保存 | Extension Storage |
| HTML 解析 | `DOMParser` / Chromium 系では offscreen document |
| 通知先 | Discord Webhook |
| CI / Release | GitHub Actions |
| ライセンス | MIT License |

## 対応ブラウザ

| ブラウザ | 状態 | 使用する manifest |
| --- | --- | --- |
| Chrome | 対応 | `manifest.json` |
| Microsoft Edge | 対応 | `manifest.json` |
| Brave | 対応 | `manifest.json` |
| Vivaldi | 対応 | `manifest.json` |
| Firefox | 対応 | `manifests/firefox.json` から生成 |

## 導入方法

### Chromium 系ブラウザ

1. GitHub Releases から `booth-new-product-discord-notifier-extension-chromium-v*.zip` をダウンロードします
2. ZIP を展開します
3. `chrome://extensions` を開きます
4. `デベロッパー モード` を有効にします
5. `パッケージ化されていない拡張機能を読み込む` を選択します
6. 展開したフォルダを指定します
7. 拡張機能の設定画面を開き、BOOTH タグなどを設定します

### Firefox

1. GitHub Releases から `booth-new-product-discord-notifier-extension-firefox-v*.zip` をダウンロードします
2. ZIP を展開します
3. `about:debugging#/runtime/this-firefox` を開きます
4. `Load Temporary Add-on...` を選択します
5. 展開したフォルダ内の `manifest.json` を選択します
6. 拡張機能の設定画面を開き、BOOTH タグなどを設定します

Firefox の一時読み込みは、ブラウザを再起動すると解除されます。再起動後はもう一度読み込んでください。

## 設定方法

拡張機能の設定画面で以下を入力します。

| 項目 | 必須 | 説明 |
| --- | --- | --- |
| Discord Webhook URL | Discord 通知を使う場合のみ必須 | 通知先の Discord Webhook URL |
| BOOTH タグ | 必須 | 監視する BOOTH タグ。1 行に 1 タグ |
| 定期チェック間隔（分） | 必須 | 新着商品の確認間隔 |
| 検索ページ数 | 任意 | 1 回のチェックで確認する BOOTH 検索結果ページ数。1〜5 ページ。初期値は 1 ページ |
| 新着商品一覧の表示件数 | 任意 | ポップアップ内に保存・表示する商品数。20〜500 件。初期値は 100 件 |
| 成人向け商品を検索結果に含める | 任意 | BOOTH の年齢確認が済んでいるブラウザで `adult=include` を使います |
| 初回は既存商品を通知せず、次回以降の新商品だけ通知する | 任意 | 初回設定時の大量通知を防ぎます |
| Discord に通知する | 任意 | Discord Webhook への送信を有効にします |

Discord 通知を無効にしても、拡張機能内の `新着商品一覧` と未読バッジは更新されます。

## 成人向け商品の扱い

成人向け商品を検出しやすくするため、以下の表示を行います。

- `新着商品一覧` に `成人向け` バッジを表示
- Discord 通知のタイトルに `[成人向け]` を追加
- Discord 通知の区分欄に `成人向け` を表示
- Discord 通知の埋め込み色を通常商品と変更

成人向け商品を検索結果に含めるには、同じブラウザで BOOTH の年齢確認を完了し、成人向けページを表示できる状態にしてください。BOOTH へのログイン自体は必須ではありません。

成人向け検索で BOOTH の年齢確認ページが返った場合は、成人向け商品を検索できなかった旨を表示し、通常検索へフォールバックします。通常検索で取得できる商品はそのまま新着商品一覧に追加します。

## 開発環境での使い方

### Chromium 系ブラウザで読み込む

1. このリポジトリをローカルに用意します
2. `chrome://extensions` を開きます
3. `デベロッパー モード` を有効にします
4. `パッケージ化されていない拡張機能を読み込む` を選択します
5. リポジトリのルートフォルダを指定します

### Firefox 用にビルドして読み込む

```powershell
./scripts/build-firefox.ps1
```

生成された `dist/firefox/manifest.json` を `about:debugging#/runtime/this-firefox` から読み込んでください。

## ディレクトリ構成

```text
.
├── .github/workflows/
│   └── package-extension.yml
├── docs/
│   └── release-notes/
├── icons/
│   └── notification-128.png
├── manifests/
│   └── firefox.json
├── scripts/
│   ├── build-chromium.ps1
│   ├── build-firefox.ps1
│   └── build-release.ps1
├── src/
│   ├── background.js
│   ├── offscreen.html
│   ├── offscreen.js
│   ├── options.html
│   ├── options.js
│   ├── popup.html
│   ├── popup.js
│   ├── product-parser.js
│   └── styles.css
├── LICENSE
├── README.md
└── manifest.json
```

## 利用できるスクリプト

| コマンド | 内容 |
| --- | --- |
| `./scripts/build-chromium.ps1` | Chromium 系ブラウザ向けに `dist/chromium` を生成 |
| `./scripts/build-firefox.ps1` | Firefox 向けに `dist/firefox` を生成 |
| `./scripts/build-release.ps1` | Chromium / Firefox 両方の ZIP を `dist/packages` に生成 |

## リリース手順

1. `manifest.json` の `version` を更新します
2. 変更をコミットします
3. `vX.Y.Z` 形式のタグを作成します
4. タグを GitHub に push します

```bash
git tag v1.0.0
git push origin main
git push origin v1.0.0
```

タグを push すると、GitHub Actions の `Package Extension` workflow が実行されます。成功すると GitHub Release が作成され、`dist/packages/*.zip` が添付されます。

ローカルでパッケージだけ確認する場合は、以下を実行します。

```powershell
./scripts/build-release.ps1
```

## 権限

| 権限 | 用途 |
| --- | --- |
| `alarms` | 定期チェック |
| `storage` | 設定、通知済み商品 ID、新着商品一覧、未読件数の保存 |
| `offscreen` | Chromium 系で BOOTH の HTML を解析 |
| `https://booth.pm/*` | BOOTH 商品検索ページの取得 |
| `https://discord.com/api/webhooks/*` | Discord Webhook への通知 |

## データ保存

- 設定、通知済み商品 ID、新着商品一覧、未読件数は端末ローカルの Extension Storage に保存します
- Discord Webhook URL も同期ストレージではなく、端末ローカルに保存します
- 旧バージョンで同期ストレージに保存済みの設定は、起動時または設定画面表示時にローカルへ移行し、同期ストレージから削除します

## トラブルシューティング

### 新着商品が表示されない

- BOOTH タグが正しく入力されているか確認してください
- 初回実行時は既存商品を既読登録するため、通知されない場合があります
- 設定画面の `最終実行結果` を確認してください

### 成人向け商品が出てこない

- 同じブラウザで BOOTH の年齢確認を完了してください
- 成人向けページが表示できる状態になっているか確認してください
- `成人向け商品を検索結果に含める` を有効にしてください

### Discord に通知されない

- `Discord に通知する` が有効か確認してください
- Discord Webhook URL が `https://discord.com/api/webhooks/` で始まっているか確認してください
- Webhook が削除されていないか、Discord 側の設定を確認してください

### Firefox で拡張機能が消えた

Firefox の `Load Temporary Add-on...` は一時読み込みです。ブラウザ再起動後は、`about:debugging#/runtime/this-firefox` から再度読み込んでください。

## 制限事項

- BOOTH の HTML 構造が変わると商品カードの解析に失敗する可能性があります
- 成人向け商品の判定は、BOOTH の商品カード上に表示される文言をもとに行います
- ブラウザが閉じている間や PC がスリープしている間はチェックされません

## 参考


## ライセンス

このリポジトリは [MIT License](./LICENSE) です。
