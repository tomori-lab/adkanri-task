# TOアド管理依頼ツール v2

アド管理チームへの依頼をWebフォームで受け付け、チャットワークにタスク化し、進捗を管理するGAS Webアプリ。**スプシ不要**。**AXISアドレスのみ利用可能**。

## リダイレクトURL（adkanri-task.netlify.app）

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/tomori-lab/adkanri-task)

↑ クリックで Netlify にデプロイ。サイト名を `adkanri-task` にすると **https://adkanri-task.netlify.app** でアクセス可能。

## 機能

- **依頼者名**：ログイン中のGoogleメールアドレスをそのまま依頼者名に使用（AXISアドレスのみ許可）
- **依頼フォーム**：わかりやすいUIで大分類・小分類・詳細を入力
- **チャットワーク通知**：担当者にタスク化（営業時間内は担当別、時間外は全員）
- **タスク一覧**：依頼ツール上でタスク一覧を表示
- **進捗管理**：未対応 / 対応中 / 完了 をツール上で更新可能

## 技術スタック

- Google Apps Script（GAS）
- HTML / CSS / JavaScript
- Chatwork API

## セットアップ

### 1. GASプロジェクト作成

1. スプレッドシート（任意）または新規GASプロジェクト → 拡張機能 → Apps Script
2. `Code.gs` の内容を貼り付け
3. 「+」→「HTML」→ ファイル名 `index` で `index.html` の内容を貼り付け
4. `Code.gs` の設定値を編集（`YOUR_*` を実際の値に置換）：
   - `CHATWORK_API_TOKEN`：Chatwork APIトークン
   - `CHATWORK_ROOM_ID`：通知先ルームID
   - `ALLOWED_EMAIL_DOMAINS`：許可するメールドメイン（例: `['axis-ads.co.jp', 'axis-hd.co.jp']`）
   - `ASSIGN_MAP`：`USER_ID_1` / `USER_ID_2` を担当者のChatworkユーザーIDに
   - `ALL_USER_IDS`：営業時間外の通知先（カンマ区切り）

### 2. デプロイ

1. デプロイ → 新しいデプロイ → ウェブアプリ
2. 設定:
   - **次のユーザーとして実行: `ユーザー`**（氏名取得のため必須）
   - アクセスできるユーザー: 組織内 or リンクを知っている全員
3. 発行されたURLを共有

## ファイル構成

```
ad-request-tool/
├── Code.gs                  # サーバーサイド
├── index.html               # フロントエンドUI
├── appsscript.json          # OAuthスコープ
├── README.md
├── セットアップ_やることリスト.md  # ★ まずここから
├── 設定値メモ.md             # 設定値をメモする用
├── GAS貼り付け用.md          # コピペ手順
├── セットアップ手順.md
└── 要件定義_v2.md
```

## 注意

- **「ユーザーとして実行」が必須**：メールアドレス取得のため、デプロイ時に「次のユーザーとして実行」を「ユーザー」に設定してください。
- **AXISアドレスのみ**：`ALLOWED_EMAIL_DOMAINS` に含まれるドメインのメールアドレスでのみ利用可能です。
- **スプシ不要**：v2 ではスプレッドシートを使いません。タスクはチャットワーク＋PropertiesServiceで管理します。
