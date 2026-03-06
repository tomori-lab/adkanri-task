# TOアド管理依頼ツール

アド管理チームへの依頼をWebフォームで受け付け、スプレッドシートに記録し、チャットワークにタスク化するGAS（Google Apps Script）Webアプリ。

## 機能

- **依頼フォーム**：氏名・大分類・小分類・詳細を入力
- **スプシ連携**：依頼データを「依頼データ」シートに記録
- **チャットワーク通知**：担当者にタスク化（営業時間内は担当別、時間外は全員）
- **氏名マスタ**：スプシの「氏名マスタ」シートから氏名を取得

## 技術スタック

- Google Apps Script（GAS）
- HTML / CSS / JavaScript
- Google スプレッドシート
- Chatwork API

## セットアップ

### 1. スプレッドシート準備

- 「氏名マスタ」シートを作成
- A列：氏名、B列：ステータス（有効/無効）
- 1行目：ヘッダー

### 2. GASプロジェクト作成

1. スプレッドシート → 拡張機能 → Apps Script
2. `Code.gs` の内容を貼り付け
3. 「+」→「HTML」→ ファイル名 `index` で `index.html` の内容を貼り付け
4. `Code.gs` の設定値を編集（`YOUR_*` を実際の値に置換）：
   - `SPREADSHEET_ID`：スプレッドシートのURL内 `d/【ID】/edit` の部分
   - `CHATWORK_API_TOKEN`：Chatwork APIトークン
   - `CHATWORK_ROOM_ID`：通知先ルームID
   - `ASSIGN_MAP`：`USER_ID_1` / `USER_ID_2` を担当者のChatworkユーザーIDに
   - `ALL_USER_IDS`：営業時間外の通知先（カンマ区切り）

### 3. デプロイ

1. デプロイ → 新しいデプロイ → ウェブアプリ
2. アクセス権限を設定
3. 発行されたURLを共有

## ファイル構成

```
ad-request-tool/
├── Code.gs          # サーバーサイド
├── index.html       # フロントエンドUI
├── README.md
└── セットアップ手順.md
```

## 注意

- **既にデプロイ済みの場合**：GASエディタ内の設定値（SPREADSHEET_ID等）はそのまま残してください。リポジトリはテンプレートです。
- **プライベートリポジトリ推奨**：実運用の credentials を含める場合は、GitHub をプライベートにしてください。
