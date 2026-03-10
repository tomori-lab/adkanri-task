---
title: Netlifyデプロイ手順（adkanri-task.netlify.app）
type: guide
bu: axis-ads
updated: 2026-03-05
---

# Netlifyデプロイ手順

**https://adkanri-task.netlify.app** でリダイレクトURLを取得する手順です。

---

## 方法A: ワンクリックデプロイ（約2分）

1. 以下のボタンをクリック：
   [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/AXIS-AD/adkanri-task)

2. Netlifyの画面で：
   - GitHubでログイン（初回のみ）
   - 「Connect to Git provider」→ リポジトリアクセスを許可
   - **Publish directory** に `docs` が入っていることを確認
   - 「Deploy site」をクリック

3. デプロイ完了後（1〜2分）：
   - 「Domain settings」→「Options」→「Change site name」
   - `adkanri-task` と入力（使われていなければ）
   - 保存 → **https://adkanri-task.netlify.app** でアクセス可能

---

## 方法B: 手動でサイトを追加

1. [app.netlify.com](https://app.netlify.com) にアクセス
2. 「Add new site」→「Import an existing project」
3. 「GitHub」を選択 → `AXIS-AD/adkanri-task` を選択
4. 設定：
   - **Branch to deploy**: master
   - **Publish directory**: `docs`
   - **Build command**: 空のまま
5. 「Deploy site」をクリック
6. デプロイ後、サイト名を `adkanri-task` に変更

---

## 完了後

- **https://adkanri-task.netlify.app** にアクセス → 依頼ツール（GAS）へリダイレクト
- リポジトリを更新してプッシュすると、Netlifyが自動で再デプロイします
