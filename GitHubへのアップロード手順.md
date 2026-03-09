---
title: GitHubへのアップロード手順
type: guide
bu: axis-ads
updated: 2026-03-05
---

# GitHubへのアップロード手順

## 事前準備

- GitHubアカウントを持っていること
- このフォルダでコミット済みであること（✅ 済み）

---

## STEP 1: GitHubでリポジトリを作成

1. [github.com](https://github.com) にログイン
2. 右上の「+」→「New repository」
3. 設定：
   - **Repository name**: `ad-request-tool`（または任意の名前）
   - **Description**: TOアド管理依頼ツール（任意）
   - **Public** または **Private** を選択
   - **README は追加しない**（既にローカルにあるため）
4. 「Create repository」をクリック

---

## STEP 2: リモートを追加してプッシュ

GitHubでリポジトリ作成後、表示されるコマンドを実行します。

**HTTPS の場合**（推奨）:

```bash
cd "c:\Users\tomor\OneDrive\ドキュメント\MyVault\30_Projects\axis-ads\ad-request-tool"

git remote add origin https://github.com/あなたのユーザー名/ad-request-tool.git

git push -u origin master
```

**SSH の場合**:

```bash
git remote add origin git@github.com:あなたのユーザー名/ad-request-tool.git

git push -u origin master
```

※ `あなたのユーザー名` と `ad-request-tool` は、作成したリポジトリのURLに合わせて変更してください。

---

## 注意事項

- **機密情報は含まれていません**：APIトークン等はスクリプト プロパティで管理しているため、コードには含まれていません
- **Private リポジトリ**：社内のコードであれば Private を推奨します
