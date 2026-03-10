---
title: リダイレクトURLの設定
type: guide
bu: axis-ads
updated: 2026-03-05
---

# リダイレクトURLの設定

短いURLで依頼ツールにアクセスできるようにする方法です。

---

## 方法1: Netlify（推奨・無料）

1. [netlify.com](https://www.netlify.com) にアクセス
2. 「Sign up」→ GitHubでログイン
3. 「Add new site」→「Import an existing project」
4. GitHubを接続し、`AXIS-AD/adkanri-task` を選択
5. 設定：
   - **Build command**: 空のまま
   - **Publish directory**: `docs`
6. 「Deploy site」をクリック
7. デプロイ後、`https://ランダム名.netlify.app` のようなURLが発行されます
8. （任意）「Domain settings」→「Edit site name」で `ad-request` など分かりやすい名前に変更 → `https://ad-request.netlify.app`

---

## 方法2: bit.ly（手動・簡単）

1. [bit.ly](https://bitly.com) にアクセス
2. 以下を短縮URLに登録：
   ```
   https://script.google.com/a/macros/shibuya-ad.com/s/AKfycbw_PvMq1rcHDLnCNQhwwgdRq5eazI0IEJM0K9jMl4e79L4N7pov2Ageu1-fznz-dMQ/exec
   ```
3. 発行された短いURL（例: `https://bit.ly/xxxxx`）を共有

---

## 方法3: GitHub Pages（リポジトリをPublicにする場合）

1. GitHubで `ad-request-tool` リポジトリを **Public** に変更
2. リポジトリの「Settings」→「Pages」
3. Source: 「Deploy from a branch」
4. Branch: `master` / Folder: `/docs`
5. 保存後、`https://AXIS-AD.github.io/adkanri-task` でアクセス可能

---

## 注意

- GASのURLが変わった場合、`docs/index.html` 内のURLを更新し、再デプロイが必要です
- Netlify/GitHub Pages を使う場合、リポジトリを更新してプッシュすると自動で反映されます
