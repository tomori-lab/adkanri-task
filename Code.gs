// ====================================================
// TOアド管理依頼ツール - サーバーサイド
// ====================================================

// ※ デプロイ時に以下を設定してください
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
const SHEET_NAME = '依頼データ';
const MASTER_SHEET_NAME = '氏名マスタ';
const CHATWORK_API_TOKEN = 'YOUR_CHATWORK_API_TOKEN';
const CHATWORK_ROOM_ID = 'YOUR_CHATWORK_ROOM_ID';

// 大分類ごとのChatworkユーザーID
const ASSIGN_MAP = {
  'アカウント関連（作成・紐づけ・エラー）': 'USER_ID_1',
  'リンク発行（ナハト・AXIS・DIO）': 'USER_ID_1',
  'リンク発行（ナハト・AXIS・DIO以外）': 'USER_ID_1',
  'スプシ関連（精査用シート・分析シート・運用シート）': 'USER_ID_2',
  '新規案件': 'USER_ID_2',
  'その他/エラー関連': 'USER_ID_2',
  'CSV保管修正': 'USER_ID_2',
  '単価変更': 'USER_ID_2',
  'キャップ通知依頼': 'USER_ID_2',
  '新規オファー追加（アカ開設・単価登録・リンク発行などまとめて依頼）': 'USER_ID_2'
};

const ALL_USER_IDS = 'YOUR_USER_IDS_COMMA_SEPARATED'; // 営業時間外の通知先

// ====================================================
// Web App エントリポイント
// ====================================================

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('TOアド管理依頼')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ====================================================
// 氏名マスタ取得
// ====================================================

function getNames() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  return data.slice(1)
    .filter(row => row[1] !== '無効')
    .map(row => row[0]);
}

// ====================================================
// フォーム送信処理
// ====================================================

function submitRequest(formData) {
  try {
    const id = writeToSheet(formData);
    sendChatworkTask(formData);
    return { success: true, id: id };
  } catch (e) {
    Logger.log('submitRequest error: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ====================================================
// スプシ書き込み
// ====================================================

function writeToSheet(formData) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'ID', 'タイムスタンプ', '氏名', '大分類', '小分類', '詳細', 'ステータス'
    ]);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }

  const lastRow = sheet.getLastRow();
  const id = 'REQ-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd') + '-' + String(lastRow).padStart(4, '0');
  const timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

  const detailObj = {};
  if (formData.fields) {
    formData.fields.forEach(function(f) {
      if (f.value && f.value.toString().trim() !== '') {
        detailObj[f.label] = f.value;
      }
    });
  }

  sheet.appendRow([
    id,
    timestamp,
    formData.name,
    formData.category,
    formData.subCategory || '',
    JSON.stringify(detailObj, null, 0),
    '未対応'
  ]);

  return id;
}

// ====================================================
// チャットワーク通知
// ====================================================

function sendChatworkTask(formData) {
  const businessHours = isBusinessHours();
  let toId;

  if (businessHours) {
    toId = ASSIGN_MAP[formData.category];
  } else {
    toId = ALL_USER_IDS;
  }

  if (!toId) {
    toId = ALL_USER_IDS;
  }

  let taskBody = '依頼がきました。対応お願いします！';

  if (!businessHours) {
    taskBody += '\n⚠️ 営業時間外のため全員にタスク化しています';
  }

  const subLabel = formData.subCategory || formData.category;
  taskBody += '\n\n【' + subLabel + '】\n[info]';
  taskBody += '\n依頼者：' + formData.name;
  taskBody += '\n大分類：' + formData.category;

  if (formData.subCategory) {
    taskBody += '\n小分類：' + formData.subCategory;
  }

  if (formData.fields) {
    formData.fields.forEach(function(f) {
      if (f.value && f.value.toString().trim() !== '') {
        taskBody += '\n' + f.label + '：' + f.value;
      }
    });
  }

  taskBody += '\n[/info]';

  const dueDateUnix = Math.floor(new Date().getTime() / 1000) + 86400;
  const url = 'https://api.chatwork.com/v2/rooms/' + CHATWORK_ROOM_ID + '/tasks';

  const options = {
    method: 'post',
    headers: { 'X-ChatWorkToken': CHATWORK_API_TOKEN },
    payload: {
      body: taskBody,
      limit: String(dueDateUnix),
      to_ids: toId
    },
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    Logger.log('Chatwork送信成功: ' + response.getContentText());
  } catch (e) {
    Logger.log('Chatwork送信失敗: ' + e.message);
    throw new Error('チャットワーク通知に失敗しました');
  }
}

// ====================================================
// 営業時間判定
// ====================================================

function isBusinessHours() {
  const now = new Date();
  const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const day = jst.getDay();
  const hours = jst.getHours();

  if (day === 0 || day === 6) return false;
  if (isJapaneseHoliday(jst)) return false;
  return hours >= 10 && hours < 19;
}

function isJapaneseHoliday(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();

  const fixed = [
    [1,1],[2,11],[2,23],[4,29],[5,3],[5,4],[5,5],
    [8,11],[11,3],[11,23]
  ];
  for (const [m, d] of fixed) {
    if (month === m && day === d) return true;
  }

  const nthMonday = (n) => {
    const first = new Date(year, month - 1, 1);
    const firstDay = first.getDay();
    const firstMon = firstDay <= 1 ? (1 - firstDay + 1) : (8 - firstDay + 1);
    return firstMon + (n - 1) * 7;
  };

  if (month === 1 && day === nthMonday(2)) return true;
  if (month === 7 && day === nthMonday(3)) return true;
  if (month === 9 && day === nthMonday(3)) return true;
  if (month === 10 && day === nthMonday(2)) return true;

  // 春分・秋分（概算）
  if (month === 3 && day === 20) return true;
  if (month === 9 && day === 23) return true;

  return false;
}
