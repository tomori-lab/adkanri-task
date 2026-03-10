// ====================================================
// TOアド管理依頼ツール v2 - サーバーサイド
// AXIS・shibuya-ad.com のアドレスで依頼可能 / ログインアドレスを依頼者名に自動設定
// ====================================================

// ※ デプロイは「ユーザーとして実行」にすること（これでログイン中のメールアドレスが取得できる）
// ※ 機密情報は「スクリプト プロパティ」で設定（プロジェクトの設定 → スクリプト プロパティ）

// スクリプト プロパティで設定するキー:
//   CHATWORK_API_TOKEN, CHATWORK_ROOM_ID, ALL_USER_IDS, ASSIGN_MAP_JSON

// 許可するメールドメイン（ログイン・依頼可能）
const ALLOWED_EMAIL_DOMAINS = ['axis-ads.co.jp', 'axis-hd.co.jp', 'shibuya-ad.com'];

const REQ_PREFIX = 'REQ-ID:';
const PROPS_KEY = 'AD_REQUEST_TASKS';

function getConfig() {
  const p = PropertiesService.getScriptProperties();
  return {
    apiToken: p.getProperty('CHATWORK_API_TOKEN') || '',
    roomId: p.getProperty('CHATWORK_ROOM_ID') || '',
    allUserIds: p.getProperty('ALL_USER_IDS') || '',
    assignMap: (function() {
      try {
        const json = p.getProperty('ASSIGN_MAP_JSON');
        return json ? JSON.parse(json) : {};
      } catch (e) { return {}; }
    })()
  };
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.getUser === '1') {
    var u = getCurrentUser();
    var text = '';
    if (u.allowed) {
      text = '依頼者: ' + (u.name || u.email || '');
    } else if (u.reason === 'no_email') {
      text = '依頼者: ログインが必要です。「権限を確認」→「許可」を押してからページを再読み込みしてください';
    } else {
      text = '依頼者: AXIS・shibuya-ad.com のアドレスのみ利用可能です';
    }
    var cb = p.callback || 'adkanriRequester';
    var js = cb + '(' + JSON.stringify(text) + ')';
    return ContentService.createTextOutput(js).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('TOアド管理依頼')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ====================================================
// 現在のユーザー取得（AXISアドレスのみ・メールアドレスを依頼者名に）
// ====================================================
// ※ デプロイは「ユーザーとして実行」にすること

function getCurrentUser() {
  const email = Session.getActiveUser().getEmail() || '';
  const domain = email.indexOf('@') >= 0 ? email.split('@')[1].toLowerCase() : '';
  const allowed = ALLOWED_EMAIL_DOMAINS.some(function(d) { return domain === d.toLowerCase(); });

  if (!email) {
    return { email: '', name: '', allowed: false, reason: 'no_email' };
  }
  if (!allowed) {
    return { email: '', name: '', allowed: false, reason: 'domain_not_allowed' };
  }

  // アドレスをそのまま依頼者名に使用
  return { email: email, name: email, allowed: true };
}

// ====================================================
// 依頼送信（チャットワークにタスク化）
// ====================================================

function submitRequest(formData) {
  try {
    const user = getCurrentUser();
    if (!user.allowed) {
      return { success: false, error: 'AXIS・shibuya-ad.com のアドレスでのみ依頼できます。' };
    }
    formData.name = user.email;

    const reqId = 'REQ-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
    const taskId = sendChatworkTask(formData, reqId);
    if (taskId) {
      saveTaskMeta(taskId, reqId, formData, '未対応');
    }
    return { success: true, id: reqId };
  } catch (e) {
    Logger.log('submitRequest error: ' + e.message);
    return { success: false, error: e.message };
  }
}

function sendChatworkTask(formData, reqId) {
  const cfg = getConfig();
  const businessHours = isBusinessHours();
  let toId = businessHours ? cfg.assignMap[formData.category] : cfg.allUserIds;
  if (!toId) toId = cfg.allUserIds;

  let taskBody = REQ_PREFIX + ' ' + reqId + '\n\n';
  taskBody += '依頼がきました。対応お願いします！';
  if (!businessHours) taskBody += '\n⚠️ 営業時間外のため全員にタスク化しています';

  const subLabel = formData.subCategory || formData.category;
  taskBody += '\n\n【' + subLabel + '】\n[info]\n依頼者：' + formData.name + '\n大分類：' + formData.category;
  if (formData.subCategory) taskBody += '\n小分類：' + formData.subCategory;
  if (formData.fields) {
    formData.fields.forEach(function(f) {
      if (f.value && f.value.toString().trim() !== '') {
        taskBody += '\n' + f.label + '：' + f.value;
      }
    });
  }
  taskBody += '\n[/info]';

  const dueDateUnix = Math.floor(new Date().getTime() / 1000) + 86400;
  const url = 'https://api.chatwork.com/v2/rooms/' + cfg.roomId + '/tasks';
  const options = {
    method: 'post',
    headers: { 'X-ChatWorkToken': cfg.apiToken },
    payload: { body: taskBody, limit: String(dueDateUnix), to_ids: toId },
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(res.getContentText());
  if (json.task_ids && json.task_ids[0]) {
    return json.task_ids[0];
  }
  throw new Error('チャットワーク通知に失敗しました');
}

// ====================================================
// タスクメタ管理（PropertiesService）
// ====================================================

function saveTaskMeta(taskId, reqId, formData, status) {
  const props = PropertiesService.getScriptProperties();
  const data = props.getProperty(PROPS_KEY);
  const map = data ? JSON.parse(data) : {};
  map[String(taskId)] = {
    reqId: reqId,
    status: status,
    requester: formData.name,
    category: formData.category,
    subCategory: formData.subCategory || '',
    createdAt: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
  };
  props.setProperty(PROPS_KEY, JSON.stringify(map));
}

function getTaskMeta() {
  const props = PropertiesService.getScriptProperties();
  const data = props.getProperty(PROPS_KEY);
  return data ? JSON.parse(data) : {};
}

// ====================================================
// タスク一覧取得
// ====================================================

function getTasks() {
  const cfg = getConfig();
  const url = 'https://api.chatwork.com/v2/rooms/' + cfg.roomId + '/tasks';
  const options = {
    method: 'get',
    headers: { 'X-ChatWorkToken': cfg.apiToken },
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch(url, options);
  if (res.getResponseCode() !== 200) return [];

  const tasks = JSON.parse(res.getContentText());
  const meta = getTaskMeta();
  const result = [];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const reqIdMatch = t.body && t.body.indexOf(REQ_PREFIX) === 0
      ? t.body.split('\n')[0].replace(REQ_PREFIX, '').trim()
      : null;

    if (!reqIdMatch) continue;

    const m = meta[String(t.task_id)] || {};
    const status = m.status || (t.status === 'done' ? '完了' : '未対応');

    result.push({
      taskId: t.task_id,
      reqId: m.reqId || reqIdMatch,
      status: status,
      requester: m.requester || '-',
      category: m.category || '-',
      subCategory: m.subCategory || '',
      createdAt: m.createdAt || '-',
      cwStatus: t.status
    });
  }

  result.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
  return result;
}

// ====================================================
// 進捗更新
// ====================================================

function updateTaskStatus(taskId, status) {
  const props = PropertiesService.getScriptProperties();
  const data = props.getProperty(PROPS_KEY);
  const map = data ? JSON.parse(data) : {};

  if (!map[String(taskId)]) return { success: false, error: 'タスクが見つかりません' };

  map[String(taskId)].status = status;
  props.setProperty(PROPS_KEY, JSON.stringify(map));

  if (status === '完了') {
    const cfg = getConfig();
    const putUrl = 'https://api.chatwork.com/v2/rooms/' + cfg.roomId + '/tasks/' + taskId + '/status';
    UrlFetchApp.fetch(putUrl, {
      method: 'put',
      headers: { 'X-ChatWorkToken': cfg.apiToken },
      payload: { status: 'done' },
      muteHttpExceptions: true
    });
  }

  return { success: true };
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
  const fixed = [[1,1],[2,11],[2,23],[4,29],[5,3],[5,4],[5,5],[8,11],[11,3],[11,23]];
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
  if (month === 3 && day === 20) return true;
  if (month === 9 && day === 23) return true;
  return false;
}
