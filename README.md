# BOOTH New Product Discord Notifier Extension

BOOTH の指定タグに新商品が追加されたら Discord Webhook に通知する Chrome / Edge 向け拡張機能です。

## Features

- ブラウザ起動時にチェック
- ブラウザを開いている間の定期チェック
- BOOTH タグを複数指定
- Discord Webhook へ embed 通知
- ブラウザ通知
- 拡張機能アイコンの未読バッジとポップアップ内の新商品一覧
- 通知済み商品 ID をブラウザ内に保存

## Install from GitHub

### Quick Start

1. GitHub Releases からブラウザに合う ZIP をダウンロードして展開する
2. ブラウザに拡張機能を読み込む（下記の browser 別手順）
3. 拡張機能の Options で `Discord Webhook URL` と `BOOTH Tags` を設定する

### Chromium browsers

1. GitHub Releases から `booth-new-product-discord-notifier-extension-chromium-v*.zip` をダウンロードする
2. ZIP を展開する
3. Chrome / Edge / Brave / Vivaldi で `chrome://extensions` を開く
4. Developer mode を有効にする
5. `Load unpacked` を選択し、展開したフォルダを指定する
6. 拡張機能の Options で `Discord Webhook URL` と `BOOTH Tags` を設定する

### Firefox

1. GitHub Releases から `booth-new-product-discord-notifier-extension-firefox-v*.zip` をダウンロードする
2. ZIP を展開する
3. Firefox で `about:debugging#/runtime/this-firefox` を開く
4. `Load Temporary Add-on...` から展開したフォルダの `manifest.json` を選択する
5. 拡張機能の Options で `Discord Webhook URL` と `BOOTH Tags` を設定する

## Install for Development

### Chrome / Edge / Brave / Vivaldi

1. Chrome または Edge で `chrome://extensions` を開く
2. Developer mode を有効にする
3. Load unpacked を選択する
4. このリポジトリのフォルダを選択する
5. 拡張機能の Options で Discord Webhook URL と BOOTH タグを設定する

### Firefox

Firefox は Chrome と background の仕組みが違うため、別manifestでビルドします。

```powershell
./scripts/build-firefox.ps1
```

その後、Firefox で `about:debugging#/runtime/this-firefox` を開き、`Load Temporary Add-on...` から `dist/firefox/manifest.json` を選択してください。

Chrome系ブラウザはルートの `manifest.json` を使います。Firefoxは `manifests/firefox.json` を使うため、Chrome版を壊さないように分離しています。

## Release

リリース用 ZIP は GitHub Actions で自動生成されます。

1. `manifest.json` の `version` を更新する（Firefox 版はビルド時に同期）
2. `git tag vX.Y.Z` を作成し、GitHub Release を公開する
3. `Package Extension` workflow が `dist/packages/*.zip` を Release assets に添付する

ローカルで確認する場合は以下を実行します。

```powershell
./scripts/build-release.ps1
```

## Settings

| Item | Description |
| --- | --- |
| Discord Webhook URL | 通知先 Discord Webhook URL |
| BOOTH Tags | 監視する BOOTH タグ。1 行に 1 タグ |
| Check Interval Minutes | 定期チェック間隔 |
| Include adult products | BOOTH 検索に `adult=include` を付ける。BOOTHへログインし、成人向け表示設定を有効にしてください |
| Skip initial existing products | 初回は既存商品を通知せず、通知済みとして登録 |
| Notification Destinations | Discord 通知とブラウザ通知の有効/無効 |
| Browser Notification Mode | 集約通知または商品ごとの通知 |

## Notification Strategy

ブラウザ通知は既定で `集約通知` を使います。理由は、BOOTH の新商品が複数件出たときに OS やブラウザが大量通知を抑制しやすく、1件ごとの通知は見逃しやすいからです。

- `集約通知`: 1回の巡回で新商品が何件あったかを1件の通知にまとめます
- `商品ごとに通知`: 詳細は出ますが、環境によっては通知が間引かれたり表示されない場合があります

通常利用では `集約通知` を推奨します。詳細確認は Discord 通知、拡張アイコンのバッジ、ポップアップ内の新商品一覧で補完する前提です。

## Browser Behavior

### Chrome系

Chrome / Edge / Brave / Vivaldi では、ルートの `manifest.json` を使います。
Manifest V3 の service worker、`chrome.alarms`、`chrome.offscreen` を使います。

- ブラウザ起動時に `chrome.runtime.onStartup` でチェックします。
- インストールまたは更新時に `chrome.runtime.onInstalled` でチェックします。
- ブラウザが起動している間は `chrome.alarms` で定期チェックします。
- ブラウザが閉じている間や PC がスリープしている間は実行されません。

### Firefox

Firefox では `dist/firefox/manifest.json` を使います。
Firefox は `background.service_worker` と `chrome.offscreen` に依存しない構成に分けています。
HTML解析は Firefox の background script 上の `DOMParser` で行います。

## Permissions

| Permission | Reason |
| --- | --- |
| `alarms` | 定期チェック |
| `storage` | 設定と通知済み商品 ID の保存 |
| `notifications` | ブラウザ通知 |
| `offscreen` | BOOTH の HTML を DOMParser で解析 |
| `https://booth.pm/*` | BOOTH 商品検索ページの取得 |
| `https://discord.com/api/webhooks/*` | Discord Webhook への通知 |

## Notes

BOOTH の HTML 構造が変わると商品カードの解析が失敗する可能性があります。

成人向け商品を通知するには、同じブラウザでBOOTHへログインし、BOOTH側の成人向け表示設定を有効にしてください。成人向け検索が0件だった場合、通常検索へフォールバックし、`Last Run.message` に警告を出します。
