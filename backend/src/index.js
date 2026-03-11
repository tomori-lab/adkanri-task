// ====================================================
// TOアド管理 API - Cloudflare Worker (Unified)
// ====================================================

const ALLOWED_EMAIL_DOMAINS = ['axis-ads.co.jp', 'axis-hd.co.jp', 'shibuya-ad.com'];
const ALLOWED_ORIGINS = ['https://axis-ad.github.io', 'http://localhost:3000', 'http://localhost:3456'];
const REQ_PREFIX = 'REQ-ID:';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return corsPreflightResponse(request);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    let response;

    try {
      // ── 依頼フォーム ──
      if (path === '/api/submit' && request.method === 'POST') {
        response = await handleSubmit(request, env);
      } else if (path === '/api/tasks' && request.method === 'GET') {
        response = await handleGetTasks(request, env);
      } else if (/^\/api\/tasks\/\d+\/status$/.test(path) && request.method === 'PUT') {
        response = await handleUpdateStatus(request, env);
      }
      // ── ダッシュボード ──
      else if (path === '/api/people' && request.method === 'GET') {
        response = await handleGetPeople(request, env);
      } else if (path === '/api/dashboard/tasks' && request.method === 'GET') {
        response = await handleGetDashboardTasks(request, env);
      } else if (/^\/api\/dashboard\/tasks\/[^/]+$/.test(path) && request.method === 'POST') {
        response = await handleUpdateDashboardTask(request, env);
      } else if (path === '/api/dashboard/manual-tasks' && request.method === 'POST') {
        response = await handleCreateManualTask(request, env);
      } else if (/^\/api\/dashboard\/manual-tasks\/[^/]+$/.test(path) && request.method === 'DELETE') {
        response = await handleDeleteManualTask(request, env);
      }
      // ── 権限管理 ──
      else if (path === '/api/role' && request.method === 'POST') {
        response = await handleCheckRole(request, env);
      } else if (path === '/api/admin/roles' && request.method === 'GET') {
        response = await handleGetAdminRoles(request, env);
      } else if (path === '/api/admin/roles' && request.method === 'POST') {
        response = await handleUpdateAdminRoles(request, env);
      }
      else {
        response = jsonResponse({ error: 'Not Found' }, 404);
      }
    } catch (e) {
      const status = e.status || 500;
      response = jsonResponse({ error: e.message }, status);
    }

    return addCorsHeaders(response, request);
  },
};

// ====================================================
// CORS
// ====================================================

function corsPreflightResponse(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowed ? origin : '',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function addCorsHeaders(response, request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  const headers = new Headers(response.headers);
  if (allowed) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return new Response(response.body, { status: response.status, headers });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ====================================================
// 認証（Google ID Token 検証）
// ====================================================

class AuthError extends Error {
  constructor(message) {
    super(message);
    this.status = 401;
  }
}

async function verifyGoogleToken(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    throw new AuthError('ログインが必要です');
  }

  const token = auth.slice(7);
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + token);
  if (!res.ok) {
    throw new AuthError('セッションが切れました。再度ログインしてください');
  }

  const payload = await res.json();
  if (payload.aud !== env.GOOGLE_CLIENT_ID) {
    throw new AuthError('認証情報が不正です');
  }

  const email = (payload.email || '').toLowerCase();
  const domain = email.includes('@') ? email.split('@')[1] : '';
  if (!ALLOWED_EMAIL_DOMAINS.some((d) => domain === d)) {
    throw new AuthError('AXIS・shibuya-ad.com のアドレスのみ利用可能です');
  }

  return { email, name: payload.name || email };
}

// ====================================================
// ハンドラ: フォーム送信
// ====================================================

async function handleSubmit(request, env) {
  const user = await verifyGoogleToken(request, env);
  const formData = await request.json();
  formData.name = user.email;

  const reqId = 'REQ-' + formatJST(new Date(), 'yyyyMMdd-HHmmss');
  const taskId = await sendChatworkTask(formData, reqId, env);

  if (taskId) {
    await saveTaskMeta(env, taskId, reqId, formData, '未対応');
  }

  return jsonResponse({ success: true, id: reqId });
}

// ====================================================
// ハンドラ: 依頼タスク一覧取得
// ====================================================

async function handleGetTasks(request, env) {
  await verifyGoogleToken(request, env);

  const cfg = getChatworkConfig(env);
  const res = await fetch(
    `https://api.chatwork.com/v2/rooms/${cfg.roomId}/tasks`,
    { headers: { 'X-ChatWorkToken': cfg.apiToken } }
  );

  if (!res.ok) return jsonResponse([]);

  const tasks = await res.json();
  const meta = await getTaskMeta(env);
  const result = [];

  for (const t of tasks) {
    const firstLine = (t.body || '').split('\n')[0];
    if (!firstLine.startsWith(REQ_PREFIX)) continue;

    const reqIdFromBody = firstLine.replace(REQ_PREFIX, '').trim();
    const m = meta[String(t.task_id)] || {};
    result.push({
      taskId: t.task_id,
      reqId: m.reqId || reqIdFromBody,
      status: m.status || (t.status === 'done' ? '完了' : '未対応'),
      requester: m.requester || '-',
      category: m.category || '-',
      subCategory: m.subCategory || '',
      createdAt: m.createdAt || '-',
    });
  }

  result.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return jsonResponse(result);
}

// ====================================================
// ハンドラ: 依頼タスクステータス更新
// ====================================================

async function handleUpdateStatus(request, env) {
  await verifyGoogleToken(request, env);

  const taskId = new URL(request.url).pathname.split('/')[3];
  const { status } = await request.json();

  const meta = await getTaskMeta(env);
  if (!meta[taskId]) {
    return jsonResponse({ success: false, error: 'タスクが見つかりません' }, 404);
  }

  meta[taskId].status = status;
  await env.TASK_STORE.put('AD_REQUEST_TASKS', JSON.stringify(meta));

  if (status === '完了') {
    const cfg = getChatworkConfig(env);
    await fetch(
      `https://api.chatwork.com/v2/rooms/${cfg.roomId}/tasks/${taskId}/status`,
      {
        method: 'PUT',
        headers: { 'X-ChatWorkToken': cfg.apiToken },
        body: new URLSearchParams({ status: 'done' }),
      }
    );
  }

  return jsonResponse({ success: true });
}

// ====================================================
// ハンドラ: 担当者リスト
// ====================================================

const DEFAULT_PEOPLE = [
  { name: '\u7B52\u4E95', id: 9797164 },
  { name: '\u53CB\u5229', id: 10034061 },
  { name: '\u77F3\u7530', id: 5420288 },
];

async function handleGetPeople(request, env) {
  await verifyGoogleToken(request, env);

  const myId = Number(env.MY_ACCOUNT_ID || 10034061);
  let people = DEFAULT_PEOPLE;

  try {
    const parsed = JSON.parse(env.PERSONS_JSON || '[]');
    if (parsed.length > 0 && parsed[0].name && !/\?/.test(parsed[0].name)) {
      people = parsed;
    }
  } catch (_) {}

  return jsonResponse({ people, myId });
}

// ====================================================
// ハンドラ: ダッシュボード タスク一覧
// ====================================================

async function handleGetDashboardTasks(request, env) {
  await verifyGoogleToken(request, env);

  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId') ? Number(url.searchParams.get('accountId')) : null;

  const cfg = getChatworkConfig(env);
  const myId = Number(env.MY_ACCOUNT_ID || 0);
  const room2 = env.CHATWORK_ROOM_2 || '';

  const rooms = [cfg.roomId];
  if (room2 && room2 !== cfg.roomId) rooms.push(room2);

  const local = await getDashboardLocal(env);
  const allTasksList = [];

  const memberIds = DEFAULT_PEOPLE.map((p) => p.id);
  const targetIds = accountId !== null ? [accountId] : memberIds;
  const seen = new Set();

  for (const roomId of rooms) {
    const allRoomTasks = await fetchChatworkTasksForDashboard(roomId, cfg.apiToken, null);
    for (const t of allRoomTasks) {
      if (!targetIds.includes(t.assigneeId)) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const meta = local[t.id] || {};
      allTasksList.push({
        ...t,
        title: meta.title || extractTitle(t.body),
        category: meta.category || autoCategory(t.body),
        priority: meta.priority || 'medium',
        localStatus: meta.localStatus || 'open',
        note: meta.note || '',
      });
    }
  }

  // 手動タスクを追加（担当者フィルタなし＝全員に表示）
  const manualTasks = await getManualTasks(env);
  for (const mt of manualTasks) {
    allTasksList.push(mt);
  }

  return jsonResponse(allTasksList);
}

async function handleUpdateDashboardTask(request, env) {
  await verifyGoogleToken(request, env);

  const id = new URL(request.url).pathname.split('/').pop();
  const body = await request.json();

  // 手動タスクの場合はMANUAL_TASKSを更新
  if (id.startsWith('manual-')) {
    const tasks = await getManualTasks(env);
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx >= 0) {
      Object.assign(tasks[idx], body);
      await saveManualTasks(env, tasks);
    }
    return jsonResponse({ ok: true });
  }

  const local = await getDashboardLocal(env);
  local[id] = { ...(local[id] || {}), ...body };
  await saveDashboardLocal(env, local);

  return jsonResponse({ ok: true });
}

// ====================================================
// ハンドラ: 手動タスク作成・削除
// ====================================================

async function handleCreateManualTask(request, env) {
  await verifyGoogleToken(request, env);

  const body = await request.json();
  const tasks = await getManualTasks(env);
  const id = 'manual-' + Date.now();
  tasks.push({ id, isManual: true, ...body });
  await saveManualTasks(env, tasks);

  return jsonResponse({ ok: true, id });
}

async function handleDeleteManualTask(request, env) {
  await verifyGoogleToken(request, env);

  const id = new URL(request.url).pathname.split('/').pop();
  const tasks = await getManualTasks(env);
  const filtered = tasks.filter((t) => t.id !== id);
  await saveManualTasks(env, filtered);

  return jsonResponse({ ok: true });
}

// ====================================================
// ハンドラ: 権限管理
// ====================================================

async function handleCheckRole(request, env) {
  const user = await verifyGoogleToken(request, env);

  const roles = await getAdminRoles(env);
  const isAdmin = roles.admins.includes(user.email);
  const isFirstUser = roles.admins.length === 0;

  if (isFirstUser) {
    roles.admins.push(user.email);
    await saveAdminRoles(env, roles);
    return jsonResponse({ role: 'admin', firstSetup: true });
  }

  return jsonResponse({ role: isAdmin ? 'admin' : 'user' });
}

async function handleGetAdminRoles(request, env) {
  await verifyGoogleToken(request, env);
  return jsonResponse(await getAdminRoles(env));
}

async function handleUpdateAdminRoles(request, env) {
  await verifyGoogleToken(request, env);

  const { admins } = await request.json();
  if (!Array.isArray(admins)) {
    return jsonResponse({ error: 'admins array required' }, 400);
  }

  await saveAdminRoles(env, { admins: admins.map((e) => e.trim().toLowerCase()) });
  return jsonResponse({ ok: true });
}

// ====================================================
// Chatwork 連携
// ====================================================

function getChatworkConfig(env) {
  let assignMap = {};
  try { assignMap = JSON.parse(env.ASSIGN_MAP_JSON || '{}'); } catch (_) {}
  return {
    apiToken: env.CHATWORK_API_TOKEN || '',
    roomId: env.CHATWORK_ROOM_ID || '',
    allUserIds: env.ALL_USER_IDS || '',
    assignMap,
  };
}

async function sendChatworkTask(formData, reqId, env) {
  const cfg = getChatworkConfig(env);
  const bh = isBusinessHours();
  let toId = bh ? cfg.assignMap[formData.category] : cfg.allUserIds;
  if (!toId) toId = cfg.allUserIds;

  let body = REQ_PREFIX + ' ' + reqId + '\n\n';
  body += '依頼がきました。対応お願いします！';
  if (!bh) body += '\n⚠️ 営業時間外のため全員にタスク化しています';

  const subLabel = formData.subCategory || formData.category;
  body += '\n\n【' + subLabel + '】\n[info]\n依頼者：' + formData.name + '\n大分類：' + formData.category;
  if (formData.subCategory) body += '\n小分類：' + formData.subCategory;
  if (formData.fields) {
    for (const f of formData.fields) {
      if (f.value && String(f.value).trim()) {
        body += '\n' + f.label + '：' + f.value;
      }
    }
  }
  body += '\n[/info]';

  const res = await fetch(`https://api.chatwork.com/v2/rooms/${cfg.roomId}/tasks`, {
    method: 'POST',
    headers: { 'X-ChatWorkToken': cfg.apiToken },
    body: new URLSearchParams({
      body,
      limit: String(Math.floor(Date.now() / 1000) + 86400),
      to_ids: toId,
    }),
  });

  const result = await res.json();
  if (result.task_ids && result.task_ids[0]) return result.task_ids[0];
  throw new Error('チャットワーク通知に失敗しました: ' + JSON.stringify(result));
}

// ====================================================
// ダッシュボード: Chatwork タスク取得
// ====================================================

function extractRequester(body) {
  const m = (body || '').match(/依頼者[：:]\s*([^\s\n]+@[^\s\n]+)/);
  return m ? m[1].trim().toLowerCase() : null;
}

function autoCategory(body) {
  const b = body || '';
  if (/つなぎこみ|新規案件/.test(b)) return 'tsunagikomi';
  if (/スプシ|シート/.test(b)) return 'sheet';
  if (/数字合わせ|数値確認/.test(b)) return 'number_match';
  if (/ASP/.test(b)) return 'asp';
  if (/定期|月末|月初/.test(b)) return 'teiki';
  return 'other';
}

function extractTitle(body) {
  const b = (body || '').replace(/\[.*?\]/g, '');
  const patterns = [/案件名[：:](.+)/, /【(.+?)】/, /▼(.+)/, /依頼内容（小分類）[：:](.+)/];
  for (const p of patterns) {
    const m = b.match(p);
    if (m) return m[1].trim().slice(0, 40);
  }
  const first = b.trim().split('\n').find((l) => l.trim().length > 0);
  return first ? first.trim().slice(0, 40) : '無題';
}

async function fetchChatworkTasksForDashboard(roomId, apiToken, targetId) {
  const url = `https://api.chatwork.com/v2/rooms/${roomId}/tasks?status=open`;
  const res = await fetch(url, { headers: { 'X-ChatWorkToken': apiToken } });
  if (!res.ok) throw new Error(`Chatwork API error: ${res.status}`);
  const tasks = await res.json();

  const filtered = targetId ? tasks.filter((t) => t.account.account_id === targetId) : tasks;

  return filtered.map((t) => ({
    id: String(t.task_id),
    roomId,
    body: t.body,
    limit: t.limit_time ? new Date(t.limit_time * 1000).toISOString().slice(0, 10) : null,
    assignedBy: t.assigned_by_account?.name || '',
    assigneeId: t.account?.account_id || 0,
    assigneeName: t.account?.name || '',
    status: t.status,
    requester: extractRequester(t.body),
  }));
}

// ====================================================
// KV ストレージ
// ====================================================

async function saveTaskMeta(env, taskId, reqId, formData, status) {
  const meta = await getTaskMeta(env);
  meta[String(taskId)] = {
    reqId,
    status,
    requester: formData.name,
    category: formData.category,
    subCategory: formData.subCategory || '',
    createdAt: formatJST(new Date(), 'yyyy/MM/dd HH:mm'),
  };
  await env.TASK_STORE.put('AD_REQUEST_TASKS', JSON.stringify(meta));
}

async function getTaskMeta(env) {
  const data = await env.TASK_STORE.get('AD_REQUEST_TASKS');
  return data ? JSON.parse(data) : {};
}

async function getDashboardLocal(env) {
  const data = await env.TASK_STORE.get('DASHBOARD_LOCAL');
  return data ? JSON.parse(data) : {};
}

async function saveDashboardLocal(env, data) {
  await env.TASK_STORE.put('DASHBOARD_LOCAL', JSON.stringify(data));
}

async function getManualTasks(env) {
  const data = await env.TASK_STORE.get('MANUAL_TASKS');
  return data ? JSON.parse(data) : [];
}

async function saveManualTasks(env, tasks) {
  await env.TASK_STORE.put('MANUAL_TASKS', JSON.stringify(tasks));
}

async function getAdminRoles(env) {
  const data = await env.TASK_STORE.get('ADMIN_ROLES');
  return data ? JSON.parse(data) : { admins: [] };
}

async function saveAdminRoles(env, roles) {
  await env.TASK_STORE.put('ADMIN_ROLES', JSON.stringify(roles));
}

// ====================================================
// 営業時間判定
// ====================================================

function isBusinessHours() {
  const jst = new Date(Date.now() + 9 * 3600000);
  const day = jst.getUTCDay();
  const hours = jst.getUTCHours();
  if (day === 0 || day === 6) return false;
  if (isJapaneseHoliday(jst)) return false;
  return hours >= 10 && hours < 19;
}

function isJapaneseHoliday(jst) {
  const month = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  const year = jst.getUTCFullYear();
  const fixed = [[1,1],[2,11],[2,23],[4,29],[5,3],[5,4],[5,5],[8,11],[11,3],[11,23]];
  for (const [m, d] of fixed) {
    if (month === m && day === d) return true;
  }
  const nthMonday = (n) => {
    const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const firstMon = firstDay <= 1 ? 1 - firstDay + 1 : 8 - firstDay + 1;
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

// ====================================================
// ユーティリティ
// ====================================================

function formatJST(date, pattern) {
  const jst = new Date(date.getTime() + 9 * 3600000);
  const y = jst.getUTCFullYear();
  const M = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  const H = String(jst.getUTCHours()).padStart(2, '0');
  const m = String(jst.getUTCMinutes()).padStart(2, '0');
  const s = String(jst.getUTCSeconds()).padStart(2, '0');
  return pattern
    .replace('yyyy', y).replace('MM', M).replace('dd', d)
    .replace('HH', H).replace('mm', m).replace('ss', s);
}
