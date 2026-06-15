// ====================================================
// TOアド管理 API - Cloudflare Worker (Unified)
// ====================================================

const ALLOWED_EMAIL_DOMAINS = ['axis-ads.co.jp', 'axis-hd.co.jp', 'shibuya-ad.com', 'axis-company.jp'];
const ALLOWED_ORIGINS = ['https://axis-ad.github.io', 'http://localhost:3000', 'http://localhost:3456'];
const PREVIEW_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.adkanri-task\.pages\.dev$/;
const REQ_PREFIX = 'REQ-ID:';

const OVERDUE_ALERT_ROOM_ID = '376867208';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkOverdueTasks(env));
  },
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
      } else if (path === '/api/my-requests' && request.method === 'GET') {
        response = await handleGetMyRequests(request, env);
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
      // ── チャットワークメッセージ送信 ──
      else if (path === '/api/dashboard/send-message' && request.method === 'POST') {
        response = await handleSendMessage(request, env);
      }
      // ── 出勤報告保存・取得 ──
      else if (path === '/api/dashboard/morning-sent' && request.method === 'POST') {
        response = await handleSaveMorningSent(request, env);
      } else if (path === '/api/dashboard/morning-sent' && request.method === 'GET') {
        response = await handleGetMorningSent(request, env);
      }
      // ── 今日の完了タスク ──
      else if (path === '/api/dashboard/completed-today' && request.method === 'GET') {
        response = await handleGetCompletedToday(request, env);
      }
      // ── スプレッドシート連携 ──
      else if (path === '/api/sheet-options' && request.method === 'GET') {
        response = await handleGetSheetOptions(request, env);
      } else if (path === '/api/departments' && request.method === 'GET') {
        response = await handleGetDepartments(request, env);
      } else if (path === '/api/project-progress' && request.method === 'GET') {
        response = await handleGetProjectProgress(request, env);
      }
      // ── 権限管理 ──
      else if (path === '/api/role' && request.method === 'POST') {
        response = await handleCheckRole(request, env);
      } else if (path === '/api/admin/roles' && request.method === 'GET') {
        response = await handleGetAdminRoles(request, env);
      } else if (path === '/api/admin/roles' && request.method === 'POST') {
        response = await handleUpdateAdminRoles(request, env);
      }
      // ── カスタムカテゴリ ──
      else if (path === '/api/categories' && request.method === 'GET') {
        response = await handleGetCategories(request, env);
      } else if (path === '/api/categories' && request.method === 'POST') {
        response = await handleSaveCategories(request, env);
      }
      // ── 非表示カテゴリ ──
      else if (path === '/api/hidden-categories' && request.method === 'GET') {
        response = await handleGetHiddenCategories(request, env);
      } else if (path === '/api/hidden-categories' && request.method === 'POST') {
        response = await handleSaveHiddenCategories(request, env);
      }
      // ── セッション認証 ──
      else if (path === '/api/auth/session' && request.method === 'POST') {
        response = await handleCreateSession(request, env);
      }
      // ── タスク振り分け設定 ──
      else if (path === '/api/admin/assign-map' && request.method === 'GET') {
        response = await handleGetAssignMap(request, env);
      } else if (path === '/api/admin/assign-map' && request.method === 'POST') {
        response = await handleSaveAssignMap(request, env);
      }
      // ── 依頼分析（過去データ） ──
      else if (path === '/api/dashboard/request-stats' && request.method === 'GET') {
        response = await handleGetRequestStats(request, env);
      }
      // ── サイドバーメモ ──
      else if (path === '/api/dashboard/memo' && request.method === 'GET') {
        response = await handleGetMemo(request, env);
      } else if (path === '/api/dashboard/memo' && request.method === 'POST') {
        response = await handleSaveMemo(request, env);
      }
      // ── デプロイ通知 ──
      else if (path === '/api/deploy-notify' && request.method === 'POST') {
        response = await handleDeployNotify(request, env);
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

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin) || PREVIEW_ORIGIN_RE.test(origin);
}

function corsPreflightResponse(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = isAllowedOrigin(origin);
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowed ? origin : '',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function addCorsHeaders(response, request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = isAllowedOrigin(origin);
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
// 認証（セッションJWT + Google ID Token フォールバック）
// ====================================================

class AuthError extends Error {
  constructor(message) {
    super(message);
    this.status = 401;
  }
}

// --- UTF-8 safe base64url ---
function base64urlEncode(input) {
  let bytes;
  if (input instanceof ArrayBuffer) { bytes = new Uint8Array(input); }
  else if (input instanceof Uint8Array) { bytes = input; }
  else { bytes = new TextEncoder().encode(input); }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// --- セッションJWT 発行・検証 ---
const SESSION_EXPIRY_DAYS = 30;

async function createSessionJwt(env, payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    email: payload.email,
    name: payload.name,
    picture: payload.picture || null,
    iat: now,
    exp: now + SESSION_EXPIRY_DAYS * 86400,
  };
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const bodyB64 = base64urlEncode(JSON.stringify(body));
  const signingInput = headerB64 + '.' + bodyB64;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  return signingInput + '.' + base64urlEncode(sig);
}

async function verifySessionJwt(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('不正なトークン形式');

  const signingInput = parts[0] + '.' + parts[1];
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  // 署名はバイナリなのでbase64urlDecodeではなく直接デコード
  let sigStr = parts[2].replace(/-/g, '+').replace(/_/g, '/');
  while (sigStr.length % 4) sigStr += '=';
  const sigBinary = atob(sigStr);
  const sigBuffer = new Uint8Array(sigBinary.length);
  for (let i = 0; i < sigBinary.length; i++) sigBuffer[i] = sigBinary.charCodeAt(i);

  const valid = await crypto.subtle.verify(
    'HMAC', key, sigBuffer, new TextEncoder().encode(signingInput)
  );
  if (!valid) throw new AuthError('トークンの署名が不正です');

  const payload = JSON.parse(base64urlDecode(parts[1]));
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    throw new AuthError('セッションが切れました。再度ログインしてください');
  }
  return payload;
}

// --- Google ID Token 検証（セッション発行時に使用） ---
async function verifyGoogleIdToken(token, env) {
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + token);
  if (!res.ok) {
    throw new AuthError('Google認証に失敗しました。再度ログインしてください');
  }
  const payload = await res.json();
  if (payload.aud !== env.GOOGLE_CLIENT_ID) {
    throw new AuthError('認証情報が不正です');
  }
  const email = (payload.email || '').toLowerCase();
  const domain = email.includes('@') ? email.split('@')[1] : '';
  if (!ALLOWED_EMAIL_DOMAINS.some((d) => domain === d)) {
    throw new AuthError('AXIS・shibuya-ad.com・axis-company.jp のアドレスのみ利用可能です');
  }
  return { email, name: payload.name || email, picture: payload.picture || null };
}

// --- 統合認証: セッションJWT優先、Google ID Tokenフォールバック ---
async function verifyGoogleToken(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    throw new AuthError('ログインが必要です');
  }
  const token = auth.slice(7);

  // セッションJWTを試す（3パーツ＆ヘッダーがeyJで始まる）
  const parts = token.split('.');
  if (parts.length === 3) {
    try {
      const header = JSON.parse(base64urlDecode(parts[0]));
      if (header.alg === 'HS256' && header.typ === 'JWT') {
        const payload = await verifySessionJwt(token, env);
        return { email: payload.email, name: payload.name, picture: payload.picture };
      }
    } catch (e) {
      if (e instanceof AuthError) throw e;
      // セッションJWTでなければGoogle ID Tokenとして試す
    }
  }

  // フォールバック: Google ID Token
  return await verifyGoogleIdToken(token, env);
}

// --- セッション発行エンドポイント ---
async function handleCreateSession(request, env) {
  const { idToken } = await request.json();
  if (!idToken) return jsonResponse({ error: 'idToken is required' }, 400);

  const user = await verifyGoogleIdToken(idToken, env);
  const sessionToken = await createSessionJwt(env, user);
  return jsonResponse({ token: sessionToken, email: user.email, name: user.name, picture: user.picture });
}

// ====================================================
// ハンドラ: フォーム送信
// ====================================================

async function handleSubmit(request, env) {
  const user = await verifyGoogleToken(request, env);
  const formData = await request.json();
  formData.name = user.name || user.email;
  formData.email = user.email;

  const reqId = 'REQ-' + formatJST(new Date(), 'yyyyMMdd-HHmmss');
  const taskId = await sendChatworkTask(formData, reqId, env);

  if (taskId) {
    await saveTaskMeta(env, taskId, reqId, formData, '未対応');
    const assigneeName = await resolveAssigneeName(env, formData);
    const fieldsDetail = (formData.fields || []).map((f) => f.label + '：' + f.value).join('\n');
    await appendTaskLog(env, String(taskId), formatJST(new Date(), 'yyyy/MM/dd HH:mm'), formData.category, formData.subCategory || '', formData.name, assigneeName, fieldsDetail);
  }

  return jsonResponse({ success: true, id: reqId });
}

// ====================================================
// ハンドラ: 依頼タスク一覧取得
// ====================================================

async function handleGetTasks(request, env) {
  await verifyGoogleToken(request, env);

  const cfg = await getChatworkConfig(env);
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
// ハンドラ: 自分の依頼一覧（ダッシュボードルームから取得）
// ====================================================

async function handleGetMyRequests(request, env) {
  await verifyGoogleToken(request, env);
  const cfg = await getChatworkConfig(env);
  const local = await getDashboardLocal(env);

  const res = await fetch(
    `https://api.chatwork.com/v2/rooms/${DASHBOARD_ROOM_ID}/tasks?status=open`,
    { headers: { 'X-ChatWorkToken': cfg.apiToken } }
  );
  if (!res.ok) return jsonResponse([]);
  const tasks = await res.json();

  const doneRes = await fetch(
    `https://api.chatwork.com/v2/rooms/${DASHBOARD_ROOM_ID}/tasks?status=done`,
    { headers: { 'X-ChatWorkToken': cfg.apiToken } }
  ).catch(() => null);
  const doneTasks = doneRes && doneRes.ok ? await doneRes.json() : [];

  const allTasks = [...tasks, ...doneTasks];
  const result = [];

  const memberIds = DEFAULT_PEOPLE.map((p) => p.id);

  for (const t of allTasks) {
    const assigneeId = t.account?.account_id || 0;
    if (!memberIds.includes(assigneeId)) continue;

    const body = t.body || '';
    const reqName = extractRequesterName(body);
    if (!reqName) continue;

    const meta = local[String(t.task_id)] || {};
    const statusMap = { open: '\u672A\u7740\u624B', in_progress: '\u7740\u624B\u4E2D', waiting: '\u76F8\u624B\u5F85\u3061', done: '\u5B8C\u4E86' };
    const displayStatus = statusMap[meta.localStatus] || (t.status === 'done' ? '\u5B8C\u4E86' : '\u672A\u7740\u624B');

    if (displayStatus === '\u5B8C\u4E86') continue;

    const catMatch = body.match(/\u5927\u5206\u985E\uFF1A([^\n]+)/);
    const subMatch = body.match(/\u5C0F\u5206\u985E\uFF1A([^\n]+)/);
    const titleMatch = body.match(/\u3010([^\u3011]+)\u3011/);

    result.push({
      taskId: t.task_id,
      title: meta.title || (titleMatch ? titleMatch[1] : extractTitle(body)),
      category: catMatch ? catMatch[1].trim() : '-',
      subCategory: subMatch ? subMatch[1].trim() : '',
      status: displayStatus,
      requester: reqName,
      assignee: meta.assigneeName || resolvePersonName(t.account),
      createdAt: t.limit_time ? new Date(t.limit_time * 1000).toISOString().slice(0, 10) : '-',
      body: body.replace(/\[.*?\]/g, '').trim(),
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
    const cfg = await getChatworkConfig(env);
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
  { name: '\u897F\u6751', id: 5420288 },
];

function getTokenForAssignee(env, assigneeId) {
  const TOKEN_MAP = {
    9797164: env.CHATWORK_TOKEN_TSUTSUI,
    5420288: env.CHATWORK_TOKEN_NISHIMURA,
    10696465: env.CHATWORK_TOKEN_ISHIDA,
    10034061: env.CHATWORK_TOKEN_TOMORI,
  };
  return TOKEN_MAP[assigneeId] || null;
}

function resolvePersonName(account) {
  if (!account) return '';
  const match = DEFAULT_PEOPLE.find((p) => p.id === account.account_id);
  return match ? match.name : (account.name || '');
}

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

  const cfg = await getChatworkConfig(env);
  const myId = Number(env.MY_ACCOUNT_ID || 0);
  const room2 = env.CHATWORK_ROOM_2 || '';

  const roomSet = new Set();
  if (cfg.roomId) roomSet.add(cfg.roomId);
  if (room2) roomSet.add(room2);
  roomSet.add(DASHBOARD_ROOM_ID);
  roomSet.add('383531534');
  roomSet.add('396113113');
  roomSet.add('430726410');
  const rooms = [...roomSet];

  const local = await getDashboardLocal(env);
  const reqMeta = await getTaskMeta(env);
  const allTasksList = [];

  const todayStr = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

  // クリーンアップ済み（v5完了）

  const memberIds = DEFAULT_PEOPLE.map((p) => p.id);
  const seen = new Set();
  let localChanged = false;

  // 今日openだったタスクIDを追跡（日替わりリセット）
  const openTodayKey = 'OPEN_TODAY_' + todayStr;
  let openToday = {};
  try { const d = await env.TASK_STORE.get(openTodayKey); if (d) openToday = JSON.parse(d); } catch(_) {}

  for (const roomId of rooms) {
    let openTasks = [], doneTasks = [];
    try {
      [openTasks, doneTasks] = await Promise.all([
        fetchChatworkTasksForDashboard(roomId, cfg.apiToken, null, 'open'),
        fetchChatworkTasksForDashboard(roomId, cfg.apiToken, null, 'done').catch(() => []),
      ]);
    } catch (e) {
      console.error(`[room ${roomId}] fetch error:`, e.message);
      continue;
    }
    // openタスクを記録
    openTasks.forEach(function(t) { openToday[String(t.id)] = true; });
    const allRoomTasks = openTasks.concat(doneTasks);
    for (const t of allRoomTasks) {
      if (!memberIds.includes(t.assigneeId)) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const meta = local[t.id] || {};
      const title = meta.title || extractTitle(t.body);
      const category = meta.category || autoCategory(t.body);
      if (!local[t.id]) local[t.id] = {};
      if (!meta.title) { local[t.id].title = title; localChanged = true; }
      // Chatworkの担当者が変わったらKVも更新（アプリで手動変更した場合はmeta._assigneeOverride=trueで保護）
      if (!meta._assigneeOverride && Number(meta.assigneeId) !== t.assigneeId) {
        local[t.id].assigneeId = t.assigneeId;
        local[t.id].assigneeName = t.assigneeName;
        localChanged = true;
      }
      if (!meta.assigneeId) { local[t.id].assigneeId = t.assigneeId; localChanged = true; }
      if (!meta.body && t.body) { local[t.id].body = t.body; localChanged = true; }
      if (!meta.firstSeen) { local[t.id].firstSeen = todayStr; localChanged = true; }
      const firstSeen = local[t.id].firstSeen || todayStr;
      const isDoneOnCw = t.status === 'done';
      let localStatus = meta.localStatus || 'open';
      let doneDate = meta.doneDate || null;
      // Chatworkでdone + 今日openだった = 今日完了
      if (isDoneOnCw && !doneDate && openToday[String(t.id)]) {
        doneDate = todayStr;
        local[t.id].localStatus = 'done';
        local[t.id].doneDate = todayStr;
        localChanged = true;
      }
      if (isDoneOnCw) localStatus = 'done';
      // 完了タスクはdoneDate=今日のみ表示
      if (localStatus === 'done' && doneDate !== todayStr) continue;
      const effectiveAssigneeId = Number(meta.assigneeId || t.assigneeId);
      const effectiveAssigneeName = meta.assigneeName || t.assigneeName;
      if (accountId !== null && effectiveAssigneeId !== accountId) continue;
      const bodyText = (meta.body || t.body || '');
      const isFromForm = 'isFromForm' in (local[t.id] || {})
        ? local[t.id].isFromForm
        : !!reqMeta[String(t.id)] || (t.assignedBy || '').includes('ぽち太');
      allTasksList.push({
        ...t,
        title,
        category,
        priority: meta.priority || 'medium',
        localStatus,
        doneDate,
        note: 'note' in meta ? meta.note : '',
        todos: meta.todos || [],
        limit: 'limit' in meta ? (meta.limit || null) : t.limit,
        scheduledDate: 'scheduledDate' in meta ? (meta.scheduledDate || null) : null,
        scheduledKey: meta.scheduledKey || null,
        firstSeen,
        assigneeId: effectiveAssigneeId,
        assigneeName: effectiveAssigneeName,
        isFromForm,
      });
    }
  }
  if (localChanged) await saveDashboardLocal(env, local);
  await env.TASK_STORE.put(openTodayKey, JSON.stringify(openToday));

  // 今日完了したタスクをDASHBOARD_LOCALから復元（Chatwork status=openでは取得できない）
  for (const [taskId, meta] of Object.entries(local)) {
    if (taskId.startsWith('_')) continue;
    if (seen.has(taskId)) continue;
    if (meta.doneDate !== todayStr) continue;
    if (meta.localStatus !== 'done') continue;
    const metaAssigneeId = meta.assigneeId || 0;
    if (accountId !== null && metaAssigneeId !== accountId) continue;
    const doneBodyText = (meta.body || '');
    const isFromFormDone = 'isFromForm' in meta
      ? meta.isFromForm
      : !!reqMeta[String(taskId)];
    allTasksList.push({
      id: taskId,
      roomId: meta.roomId || DASHBOARD_ROOM_ID,
      body: meta.body || '',
      title: meta.title || '(完了済みタスク)',
      category: meta.category || 'other',
      priority: meta.priority || 'medium',
      localStatus: 'done',
      doneDate: todayStr,
      note: meta.note || '',
      limit: meta.limit || null,
      scheduledDate: meta.scheduledDate || null,
      scheduledKey: meta.scheduledKey || null,
      assigneeId: metaAssigneeId,
      assigneeName: meta.assigneeName || '',
      assignedBy: '',
      isFromForm: isFromFormDone,
    });
  }

  // 手動タスクを追加（担当者フィルタあり）
  const manualTasks = await getManualTasks(env);
  for (const mt of manualTasks) {
    if (accountId !== null && Number(mt.assigneeId) !== accountId) continue;
    // status と localStatus を同期
    const localStatus = mt.localStatus || mt.status || 'open';
    const status = mt.status || mt.localStatus || 'open';
    allTasksList.push({ ...mt, status, localStatus, isFromForm: false });
  }

  return jsonResponse(allTasksList);
}

async function handleGetRequestStats(request, env) {
  await verifyGoogleToken(request, env);

  const local = await getDashboardLocal(env);
  const reqMeta = await getTaskMeta(env);
  const seenIds = new Set();
  const tasks = [];
  const sheetDataById = {};

  // 1. スプシ（タスク収集）を先に読む — フォーム経由タスクの正確なデータ
  let sheetTotal = 0;
  let sheetAdded = 0;
  let sheetSkipped = 0;
  try {
    const token = await getGoogleAccessToken(env);
    const range = encodeURIComponent(`${TASK_LOG_SHEET_NAME}!A:F`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${TASK_LOG_SHEET_ID}/values/${range}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const data = await res.json();
      const rows = data.values || [];
      sheetTotal = rows.length - 1;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0]) continue;
        sheetDataById[String(row[0])] = {
          formCategory: row[2] || '',
          formSubCategory: row[3] || '',
          assigneeName: row[5] || '',
          createdAt: row[1] || '',
        };
      }
    }
  } catch (_) {}

  // 2. DASHBOARD_LOCAL の全タスク
  for (const [taskId, meta] of Object.entries(local)) {
    if (taskId.startsWith('_')) continue;
    if (!meta.title && !meta.body) continue;
    seenIds.add(String(taskId));

    const sheet = sheetDataById[String(taskId)];
    const isFromForm = !!sheet || (
      'isFromForm' in meta ? meta.isFromForm
      : !!reqMeta[String(taskId)] || /依頼者：/.test(meta.body || '')
    );

    tasks.push({
      id: taskId,
      title: meta.title || '(不明)',
      category: meta.category || 'other',
      formCategory: sheet ? sheet.formCategory : '',
      assigneeName: sheet ? sheet.assigneeName : (meta.assigneeName || ''),
      firstSeen: meta.firstSeen || '',
      isFromForm,
      localStatus: meta.localStatus || 'open',
    });
  }

  // 3. スプシにあってDASHBOARD_LOCALにないタスクを追加
  for (const [taskId, sheet] of Object.entries(sheetDataById)) {
    if (seenIds.has(taskId)) { sheetSkipped++; continue; }
    seenIds.add(taskId);
    sheetAdded++;
    tasks.push({
      id: taskId,
      title: [sheet.formCategory, sheet.formSubCategory].filter(Boolean).join(' / ') || '(不明)',
      category: 'other',
      formCategory: sheet.formCategory,
      assigneeName: sheet.assigneeName,
      firstSeen: sheet.createdAt ? sheet.createdAt.slice(0, 10) : '',
      isFromForm: true,
      localStatus: 'done',
    });
  }

  return jsonResponse({ tasks, _debug: { dashboardLocal: seenIds.size - sheetAdded, sheetTotal, sheetAdded, sheetSkipped } });
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

  if (body.localStatus) {
    const cfg = await getChatworkConfig(env);
    const cwStatus = body.localStatus === 'done' ? 'done' : 'open';
    const roomId = body.roomId || local[id].roomId || DASHBOARD_ROOM_ID;
    if (roomId) local[id].roomId = roomId;
    await saveDashboardLocal(env, local);

    const roomsToTry = new Set();
    roomsToTry.add(roomId);
    const room2 = env.CHATWORK_ROOM_2 || '';
    if (room2) roomsToTry.add(room2);
    roomsToTry.add(DASHBOARD_ROOM_ID);
    if (cfg.roomId) roomsToTry.add(cfg.roomId);

    const assigneeId = body.assigneeId || local[id]?.assigneeId || null;
    const tokens = new Set();
    if (assigneeId) {
      const at = getTokenForAssignee(env, Number(assigneeId));
      if (at) tokens.add(at);
    }
    tokens.add(cfg.apiToken);
    if (env.CHATWORK_DONE_TOKEN) tokens.add(env.CHATWORK_DONE_TOKEN);
    if (env.CHATWORK_TOKEN_TOMORI) tokens.add(env.CHATWORK_TOKEN_TOMORI);
    if (env.CHATWORK_TOKEN_TSUTSUI) tokens.add(env.CHATWORK_TOKEN_TSUTSUI);
    if (env.CHATWORK_TOKEN_NISHIMURA) tokens.add(env.CHATWORK_TOKEN_NISHIMURA);
    if (env.CHATWORK_TOKEN_ISHIDA) tokens.add(env.CHATWORK_TOKEN_ISHIDA);
    const tokenList = [...tokens];
    console.log(`[DEBUG] task=${id} assigneeId=${assigneeId} rooms=${[...roomsToTry].join(',')} tokens=${tokenList.length}`);

    const cwResults = [];
    let successRoom = null;
    for (const tryRoom of roomsToTry) {
      for (let ti = 0; ti < tokenList.length; ti++) {
        const token = tokenList[ti];
        try {
          const res = await fetch(
            `https://api.chatwork.com/v2/rooms/${tryRoom}/tasks/${id}/status`,
            {
              method: 'PUT',
              headers: { 'X-ChatWorkToken': token },
              body: new URLSearchParams({ body: cwStatus }),
            }
          );
          const resBody = await res.text();
          cwResults.push({ room: tryRoom, status: res.status, body: resBody, tokenIdx: ti });
          console.log(`[CW_TASK_UPDATE] room=${tryRoom} task=${id} token=${ti} status=${res.status} body=${resBody}`);
          if (res.status === 200) {
            successRoom = { room: tryRoom };
            break;
          }
        } catch (e) {
          cwResults.push({ room: tryRoom, status: 'error', body: e.message });
          console.log(`[CW_TASK_UPDATE_ERROR] room=${tryRoom} task=${id} error=${e.message}`);
        }
      }
      if (successRoom) break;
    }
    if (!successRoom) {
      console.log(`[CW_TASK_UPDATE_FAILED] task=${id} tried=${JSON.stringify(cwResults)}`);
    }

    if (body.localStatus === 'done') {
      const effectiveRoom = successRoom ? successRoom.room : (local[id].roomId || roomId);
      if (successRoom && successRoom.room !== local[id].roomId) {
        local[id].roomId = successRoom.room;
        await saveDashboardLocal(env, local);
      }
      try {
        const assigneeToken = assigneeId ? getTokenForAssignee(env, Number(assigneeId)) : null;
        const sendAsToken = assigneeToken || env.CHATWORK_DONE_TOKEN || cfg.apiToken;
        const savedTitle = local[id]?.title || null;
        await sendDoneReplyMessage(id, effectiveRoom, body.replyMessage || '', cfg.apiToken, sendAsToken, savedTitle);
      } catch (_) {}
      const completedDate = formatJST(new Date(), 'yyyy/MM/dd HH:mm');
      await updateTaskLogCompletion(env, id, completedDate, body.replyMessage || '');
    }
  }

  return jsonResponse({ ok: true });
}

// ====================================================
// ハンドラ: 手動タスク作成・削除
// ====================================================

const REPORT_ROOM_ID = '376867208';

async function handleSendMessage(request, env) {
  await verifyGoogleToken(request, env);
  const { message, roomId, personId } = await request.json();
  if (!message) return jsonResponse({ error: 'message is required' }, 400);
  const cfg = await getChatworkConfig(env);
  const targetRoom = roomId || REPORT_ROOM_ID;
  let token = cfg.apiToken;
  if (personId) {
    const personalToken = getTokenForAssignee(env, Number(personId));
    if (personalToken) token = personalToken;
  }
  const res = await fetch(`https://api.chatwork.com/v2/rooms/${targetRoom}/messages`, {
    method: 'POST',
    headers: { 'X-ChatWorkToken': token, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'body=' + encodeURIComponent(message),
  });
  if (!res.ok) return jsonResponse({ error: 'Failed to send message' }, 500);
  return jsonResponse({ ok: true });
}

async function handleSaveMorningSent(request, env) {
  await verifyGoogleToken(request, env);
  const { personId, date, message } = await request.json();
  if (!personId || !date || !message) return jsonResponse({ error: 'missing params' }, 400);
  const key = `morningSent_${personId}_${date}`;
  await env.TASK_STORE.put(key, message, { expirationTtl: 86400 * 3 });
  return jsonResponse({ ok: true });
}

async function handleDeployNotify(request, env) {
  const { key, message } = await request.json();
  if (!key || key !== env.DEPLOY_NOTIFY_KEY) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  if (!message) return jsonResponse({ error: 'message is required' }, 400);
  const cfg = await getChatworkConfig(env);
  const res = await fetch(`https://api.chatwork.com/v2/rooms/${REPORT_ROOM_ID}/messages`, {
    method: 'POST',
    headers: { 'X-ChatWorkToken': cfg.apiToken, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'body=' + encodeURIComponent(message),
  });
  if (!res.ok) return jsonResponse({ error: 'Failed to send' }, 500);
  return jsonResponse({ ok: true });
}

async function handleGetMemo(request, env) {
  const payload = await verifyGoogleToken(request, env);
  const email = payload.email;
  if (!email) return jsonResponse({ error: 'missing email' }, 400);
  const key = `sidebarMemo_${email}`;
  const memo = await env.TASK_STORE.get(key);
  return jsonResponse({ memo: memo || '' });
}

async function handleSaveMemo(request, env) {
  const payload = await verifyGoogleToken(request, env);
  const email = payload.email;
  const { memo } = await request.json();
  if (!email) return jsonResponse({ error: 'missing email' }, 400);
  const key = `sidebarMemo_${email}`;
  await env.TASK_STORE.put(key, memo || '');
  return jsonResponse({ ok: true });
}

async function handleGetMorningSent(request, env) {
  await verifyGoogleToken(request, env);
  const url = new URL(request.url);
  const personId = url.searchParams.get('personId');
  const date = url.searchParams.get('date');
  if (!personId || !date) return jsonResponse({ error: 'missing params' }, 400);
  const key = `morningSent_${personId}_${date}`;
  const message = await env.TASK_STORE.get(key);
  return jsonResponse({ message: message || '' });
}

async function handleCreateManualTask(request, env) {
  await verifyGoogleToken(request, env);

  const body = await request.json();
  const cfg = await getChatworkConfig(env);
  const isNormalCategory = body.category && !['teiki', 'long_term'].includes(body.category);

  let cwTaskId = null;

  if (isNormalCategory) {
    const assigneeId = body.assigneeId ? Number(body.assigneeId) : null;
    const toId = assigneeId || Number(env.MY_ACCOUNT_ID || 10034061);
    const taskBody = body.title + (body.note ? '\n' + body.note : '');

    let limitTs = '';
    if (body.limit) {
      limitTs = String(Math.floor(new Date(body.limit + 'T23:59:59+09:00').getTime() / 1000));
    }

    const params = new URLSearchParams({ body: taskBody, to_ids: String(toId) });
    if (limitTs) params.append('limit', limitTs);
    params.append('limit_type', 'date');

    try {
      const res = await fetch(`https://api.chatwork.com/v2/rooms/${TASK_CREATE_ROOM_ID}/tasks`, {
        method: 'POST',
        headers: { 'X-ChatWorkToken': cfg.apiToken },
        body: params,
      });
      const result = await res.json();
      if (result.task_ids && result.task_ids[0]) {
        cwTaskId = result.task_ids[0];
      }
    } catch (e) {
      console.error('[createManualTask] Chatwork task creation failed:', e);
    }
  }

  if (cwTaskId && isNormalCategory) {
    const local = await getDashboardLocal(env);
    local[cwTaskId] = {
      title: body.title,
      category: body.category,
      priority: body.priority || 'medium',
      localStatus: body.localStatus || 'open',
      note: body.note || '',
      limit: body.limit || null,
      scheduledDate: body.scheduledDate || null,
      scheduledKey: body.scheduledKey || null,
    };
    await saveDashboardLocal(env, local);
    return jsonResponse({ ok: true, id: cwTaskId, chatworkTaskId: cwTaskId });
  }

  const tasks = await getManualTasks(env);
  const id = 'manual-' + Date.now();
  tasks.push({ id, isManual: true, ...body });
  await saveManualTasks(env, tasks);

  return jsonResponse({ ok: true, id });
}

async function handleGetCompletedToday(request, env) {
  await verifyGoogleToken(request, env);
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

  const local = await getDashboardLocal(env);
  const manualTasks = await getManualTasks(env);
  const completed = [];

  for (const [taskId, meta] of Object.entries(local)) {
    if (meta.localStatus === 'done' && meta.doneDate === date) {
      completed.push({ id: taskId, title: meta.title || null, assigneeId: meta.assigneeId || null });
    }
  }
  for (const mt of manualTasks) {
    if ((mt.localStatus === 'done' || mt.status === 'done') && mt.doneDate === date) {
      completed.push({ id: mt.id, title: mt.title || null, assigneeId: mt.assigneeId || null });
    }
  }

  return jsonResponse(completed);
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
  }

  const users = await getRegisteredUsers(env);
  const existing = users.find((u) => u.email === user.email);
  if (!existing) {
    users.push({ email: user.email, name: user.name || user.email, picture: user.picture || null, lastLogin: new Date().toISOString() });
  } else {
    existing.name = user.name || existing.name;
    existing.picture = user.picture || existing.picture;
    existing.lastLogin = new Date().toISOString();
  }
  await saveRegisteredUsers(env, users);

  return jsonResponse({ role: isFirstUser || isAdmin ? 'admin' : 'user' });
}

async function handleGetAdminRoles(request, env) {
  await verifyGoogleToken(request, env);
  const roles = await getAdminRoles(env);
  const users = await getRegisteredUsers(env);
  return jsonResponse({ admins: roles.admins, users });
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

async function handleGetAssignMap(request, env) {
  await verifyGoogleToken(request, env);
  const stored = await env.TASK_STORE.get('ASSIGN_MAP_CUSTOM');
  const assignMap = stored ? JSON.parse(stored) : null;
  const lineYahooAssignee = await env.TASK_STORE.get('LINE_YAHOO_ASSIGNEE_CUSTOM');
  const googleYtAssignee = await env.TASK_STORE.get('GOOGLE_YT_ASSIGNEE_CUSTOM');
  return jsonResponse({
    assignMap: assignMap || HARDCODED_ASSIGN_MAP,
    lineYahooAssignee: lineYahooAssignee || LINE_YAHOO_ASSIGNEE,
    googleYtAssignee: googleYtAssignee || GOOGLE_YT_ASSIGNEE,
    people: DEFAULT_PEOPLE,
    categories: Object.keys(HARDCODED_ASSIGN_MAP),
  });
}

async function handleSaveAssignMap(request, env) {
  await verifyGoogleToken(request, env);
  const { assignMap, lineYahooAssignee, googleYtAssignee } = await request.json();
  if (assignMap) {
    await env.TASK_STORE.put('ASSIGN_MAP_CUSTOM', JSON.stringify(assignMap));
  }
  if (lineYahooAssignee) {
    await env.TASK_STORE.put('LINE_YAHOO_ASSIGNEE_CUSTOM', lineYahooAssignee);
  }
  if (googleYtAssignee) {
    await env.TASK_STORE.put('GOOGLE_YT_ASSIGNEE_CUSTOM', googleYtAssignee);
  }
  return jsonResponse({ ok: true });
}

// ====================================================
// カスタムカテゴリ
// ====================================================

const CUSTOM_CATEGORIES_KEY = 'CUSTOM_CATEGORIES';

async function handleGetCategories(request, env) {
  await verifyGoogleToken(request, env);
  const data = await env.TASK_STORE.get(CUSTOM_CATEGORIES_KEY);
  return jsonResponse({ categories: data ? JSON.parse(data) : [] });
}

async function handleSaveCategories(request, env) {
  await verifyGoogleToken(request, env);
  const { categories } = await request.json();
  if (!Array.isArray(categories)) {
    return jsonResponse({ error: 'categories array required' }, 400);
  }
  await env.TASK_STORE.put(CUSTOM_CATEGORIES_KEY, JSON.stringify(categories));
  return jsonResponse({ ok: true });
}

const HIDDEN_CATEGORIES_KEY = 'HIDDEN_CATEGORIES';

async function handleGetHiddenCategories(request, env) {
  await verifyGoogleToken(request, env);
  const data = await env.TASK_STORE.get(HIDDEN_CATEGORIES_KEY);
  return jsonResponse({ hidden: data ? JSON.parse(data) : [] });
}

async function handleSaveHiddenCategories(request, env) {
  await verifyGoogleToken(request, env);
  const { hidden } = await request.json();
  if (!Array.isArray(hidden)) {
    return jsonResponse({ error: 'hidden array required' }, 400);
  }
  await env.TASK_STORE.put(HIDDEN_CATEGORIES_KEY, JSON.stringify(hidden));
  return jsonResponse({ ok: true });
}

// ====================================================
// ハンドラ: スプレッドシート連携
// ====================================================

async function handleGetSheetOptions(request, env) {
  await verifyGoogleToken(request, env);

  const url = new URL(request.url);
  const spreadsheetId = url.searchParams.get('id');
  const range = url.searchParams.get('range');
  const condRange = url.searchParams.get('condRange');
  const condValue = url.searchParams.get('condValue');
  const condReplace = url.searchParams.get('condReplace');
  const condFilter = url.searchParams.get('condFilter');
  if (!spreadsheetId || !range) {
    return jsonResponse({ error: 'id and range required' }, 400);
  }

  const cacheKey = `SHEET_CACHE_${spreadsheetId}_${range}_${condRange || ''}_${condValue || ''}_${condFilter || ''}`;
  const cached = await env.TASK_STORE.get(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    if (Date.now() - parsed.ts < 300000) return jsonResponse(parsed.data);
  }

  const accessToken = await getGoogleAccessToken(env);

  let unique;
  if (condRange && condValue) {
    const [mainRes, condRes] = await Promise.all([
      fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(condRange)}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);
    if (!mainRes.ok || !condRes.ok) return jsonResponse({ error: 'Sheets API error' }, 500);
    const mainData = await mainRes.json();
    const condData = await condRes.json();
    const mainVals = (mainData.values || []).map((r) => (r[0] || '').trim());
    const condVals = (condData.values || []).map((r) => (r[0] || '').trim());
    const merged = [];
    for (let i = 0; i < mainVals.length; i++) {
      if (condFilter === 'true') {
        if (condVals[i] === condValue && mainVals[i]) merged.push(mainVals[i]);
      } else {
        const val = condVals[i] === condValue ? (condReplace || condValue) : mainVals[i];
        if (val) merged.push(val);
      }
    }
    unique = [...new Set(merged)];
  } else {
    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
    const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const err = await res.text();
      return jsonResponse({ error: 'Sheets API error', detail: err }, res.status);
    }
    const data = await res.json();
    const values = (data.values || []).flat().filter((v) => v && String(v).trim());
    unique = [...new Set(values)];
  }

  await env.TASK_STORE.put(cacheKey, JSON.stringify({ ts: Date.now(), data: unique }));
  return jsonResponse(unique);
}

function base64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const PROGRESS_SHEET_ID = '1SuehlbrriiXAAiMOSlaJbq5sYeBuS8GnX1QkfNLKFtU';
const PROGRESS_RANGE = '【新規案件】進捗管理!A5:N';

async function handleGetProjectProgress(request, env) {
  await verifyGoogleToken(request, env);

  const cacheKey = 'PROGRESS_CACHE';
  const cached = await env.TASK_STORE.get(cacheKey);
  if (cached) return jsonResponse(JSON.parse(cached));

  const token = await getGoogleAccessToken(env);
  const range = encodeURIComponent(PROGRESS_RANGE);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${PROGRESS_SHEET_ID}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const errText = await res.text();
    return jsonResponse({ error: 'Sheet error: ' + res.status + ' ' + errText.slice(0, 200) }, 500);
  }
  const data = await res.json();
  const rows = data.values || [];

  if (rows.length < 2) return jsonResponse([]);

  const result = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const person = (r[0] || '').trim();
    const project = (r[4] || '').trim();
    if (!person && !project) continue;
    result.push({
      person: person,
      type: (r[1] || '').trim(),
      offer: (r[2] || '').trim(),
      status: (r[3] || '').trim(),
      project: project,
      distributor: (r[5] || '').trim(),
      media: (r[6] || '').trim(),
      article: (r[7] || '').trim(),
      operator: (r[8] || '').trim(),
      shipDate: (r[9] || '').trim(),
      releaseDate: (r[10] || '').trim(),
      startDate: (r[11] || '').trim(),
      progress: (r[13] || '').trim(),
    });
  }

  await env.TASK_STORE.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 });
  return jsonResponse(result);
}

const DEPT_SHEET_ID = '1Xk-p_-6Np-e5keqOy5fcgmU-TF28H5dU7UeEYDUX_7k';
const DEPT_RANGE = 'DB!D7:F';

async function handleGetDepartments(request, env) {
  await verifyGoogleToken(request, env);

  // キャッシュ確認（10分）
  const cacheKey = 'DEPT_CACHE';
  const cached = await env.TASK_STORE.get(cacheKey);
  if (cached) return jsonResponse(JSON.parse(cached));

  const token = await getGoogleAccessToken(env);
  const range = encodeURIComponent(DEPT_RANGE);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${DEPT_SHEET_ID}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return jsonResponse({ error: 'Failed to fetch sheet' }, 500);
  const data = await res.json();
  const rows = data.values || [];

  const departments = [];
  const mapping = {};
  const seen = {};
  for (const row of rows) {
    const name = (row[0] || '').trim();
    const dept = (row[2] || '').trim();
    if (!name || !dept) continue;
    if (!seen[dept]) { departments.push(dept); seen[dept] = true; }
    mapping[name] = dept;
  }

  const result = { departments, mapping };
  await env.TASK_STORE.put(cacheKey, JSON.stringify(result), { expirationTtl: 600 });
  return jsonResponse(result);
}

async function getGoogleAccessToken(env) {
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })));

  const signingInput = `${header}.${payload}`;

  const pemContents = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64url(signature)}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to get Google access token');
  return tokenData.access_token;
}

// ====================================================
// タスクログ（Google Sheets書き込み）
// ====================================================

const TASK_LOG_SHEET_ID = '1bpRgvylc3l0DaJHOX8yY-FIDPz_L1zmOUZwYMPxX67I';
const TASK_LOG_SHEET_NAME = '\u30BF\u30B9\u30AF\u53CE\u96C6';

const TASK_LOG_HEADERS = [
  '\u30BF\u30B9\u30AFID', '\u4F5C\u6210\u65E5', '\u5927\u5206\u985E', '\u5C0F\u5206\u985E',
  '\u4F9D\u983C\u8005', '\u62C5\u5F53\u8005', '\u30BF\u30B9\u30AF\u8A73\u7D30', '\u5B8C\u4E86\u65E5', '\u5B8C\u4E86\u30B3\u30E1\u30F3\u30C8',
];

async function ensureTaskLogHeaders(token) {
  const range = encodeURIComponent(`${TASK_LOG_SHEET_NAME}!A1:I1`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${TASK_LOG_SHEET_ID}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.ok) {
    const data = await res.json();
    if (data.values && data.values[0] && data.values[0].length > 0) return;
  }
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${TASK_LOG_SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [TASK_LOG_HEADERS] }),
    }
  );
}

async function appendTaskLog(env, taskId, createdDate, category, subCategory, requester, assignee, fieldsDetail) {
  try {
    const token = await getGoogleAccessToken(env);
    await ensureTaskLogHeaders(token);
    const range = encodeURIComponent(`${TASK_LOG_SHEET_NAME}!A:I`);
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${TASK_LOG_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[taskId, createdDate, category, subCategory || '', requester, assignee, fieldsDetail, '', '']] }),
      }
    );
  } catch (_) {}
}

async function updateTaskLogCompletion(env, taskId, completedDate, comment) {
  try {
    const token = await getGoogleAccessToken(env);
    const range = encodeURIComponent(`${TASK_LOG_SHEET_NAME}!A:A`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${TASK_LOG_SHEET_ID}/values/${range}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const rows = data.values || [];
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === String(taskId)) { rowIndex = i + 1; break; }
    }
    if (rowIndex < 0) return;
    const updateRange = encodeURIComponent(`${TASK_LOG_SHEET_NAME}!H${rowIndex}:I${rowIndex}`);
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${TASK_LOG_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[completedDate, comment]] }),
      }
    );
  } catch (_) {}
}

// ====================================================
// Chatwork 連携
// ====================================================

const DASHBOARD_ROOM_ID = '333632829';
const TASK_CREATE_ROOM_ID = '376867208';

const HARDCODED_ASSIGN_MAP = {
  '\u30A2\u30AB\u30A6\u30F3\u30C8\u95A2\u9023\uFF08\u4F5C\u6210\u30FB\u7D10\u3065\u3051\u30FB\u30A8\u30E9\u30FC\uFF09': '10696465',
  '\u30EA\u30F3\u30AF\u767A\u884C\u4F9D\u983C': '10696465',
  '\u30B9\u30D7\u30B7\u95A2\u9023': '10034061',
  '\u65B0\u898F\u6848\u4EF6': '10034061',
  '\u65B0\u898F\u30AA\u30D5\u30A1\u30FC\u8FFD\u52A0': '10034061',
  '\u5358\u4FA1\u5909\u66F4': '10034061',
  'CSV\u4FDD\u7BA1\u4FEE\u6B63/\u5F8C\u7740\u706B\u4FEE\u6B63': '10034061',
  '\u305D\u306E\u4ED6/\u30A8\u30E9\u30FC\u95A2\u9023': '10034061',
  '\u8CB8\u8A18\u4E8B': '10034061',
};

async function getChatworkConfig(env) {
  // KVのカスタム設定を優先
  let assignMap = null;
  const customMap = await env.TASK_STORE.get('ASSIGN_MAP_CUSTOM');
  if (customMap) {
    try { assignMap = JSON.parse(customMap); } catch (_) {}
  }
  if (!assignMap) {
    try { assignMap = JSON.parse(env.ASSIGN_MAP_JSON || '{}'); } catch (_) { assignMap = {}; }
    const hasValidKeys = Object.keys(assignMap).some((k) => !/\?/.test(k) && k.length > 2);
    if (!hasValidKeys) assignMap = HARDCODED_ASSIGN_MAP;
  }
  return {
    apiToken: env.CHATWORK_API_TOKEN || '',
    roomId: env.CHATWORK_ROOM_ID || '',
    allUserIds: env.ALL_USER_IDS || '',
    assignMap,
  };
}

async function resolveAssigneeName(env, formData) {
  const cfg = await getChatworkConfig(env);
  const lyAssignee = await env.TASK_STORE.get('LINE_YAHOO_ASSIGNEE_CUSTOM') || LINE_YAHOO_ASSIGNEE;
  const gytAssignee = await env.TASK_STORE.get('GOOGLE_YT_ASSIGNEE_CUSTOM') || GOOGLE_YT_ASSIGNEE;
  const toId = hasLineYahooMedia(formData) ? lyAssignee : hasGoogleYtContent(formData) ? gytAssignee : resolveAssignee(cfg, formData.category, true);
  const ids = String(toId).split(',');
  const names = ids.map((id) => { const p = DEFAULT_PEOPLE.find((pp) => String(pp.id) === id.trim()); return p ? p.name : id.trim(); });
  return names.join(', ');
}

function resolveAssignee(cfg, category, bh) {
  if (!bh) return cfg.allUserIds;
  let toId = cfg.assignMap[category];
  if (!toId) {
    for (const key of Object.keys(cfg.assignMap)) {
      if (category && category.includes(key)) { toId = cfg.assignMap[key]; break; }
    }
  }
  return toId || cfg.allUserIds;
}

const LINE_YAHOO_ASSIGNEE = '9797164';
const LINE_YAHOO_KEYWORDS = ['LINE', 'LY', 'Yahoo', 'ヤフー'];
const GOOGLE_YT_ASSIGNEE = '10696465';
const GOOGLE_YT_KEYWORDS = ['YT', 'YouTube', 'YTs', 'Google'];
const GOOGLE_YT_CATEGORIES = ['アカウント関連（作成・紐づけ・エラー）', 'リンク発行依頼'];

function hasLineYahooMedia(formData) {
  if (!formData.fields) return false;
  for (const f of formData.fields) {
    if (f.label && /媒体/.test(f.label) && f.value) {
      const val = String(f.value);
      if (LINE_YAHOO_KEYWORDS.some((kw) => val.includes(kw))) return true;
    }
  }
  return false;
}

function hasGoogleYtContent(formData) {
  if (!formData.category || !GOOGLE_YT_CATEGORIES.includes(formData.category)) return false;
  if (!formData.fields) return false;
  for (const f of formData.fields) {
    if (f.value) {
      const val = String(f.value);
      if (GOOGLE_YT_KEYWORDS.some((kw) => val.includes(kw))) return true;
    }
  }
  return false;
}

const NOTIFY_MEMBERS = [
  { name: '\u897F\u6751 \u77E5\u8F1D', id: 5420288 },
  { name: '\u7B52\u4E95 \u306F\u306A\u4E43', id: 9797164 },
  { name: '\u53CB\u5229 \u304D\u3089\u3089', id: 10034061 },
];

async function sendChatworkTask(formData, reqId, env) {
  const cfg = await getChatworkConfig(env);
  const bh = isBusinessHours();
  const lyAssignee = await env.TASK_STORE.get('LINE_YAHOO_ASSIGNEE_CUSTOM') || LINE_YAHOO_ASSIGNEE;
  const gytAssignee = await env.TASK_STORE.get('GOOGLE_YT_ASSIGNEE_CUSTOM') || GOOGLE_YT_ASSIGNEE;
  const toId = hasLineYahooMedia(formData) ? lyAssignee : hasGoogleYtContent(formData) ? gytAssignee : resolveAssignee(cfg, formData.category, true);

  const subLabel = formData.subCategory || formData.category;
  const fieldLines = [];
  if (formData.fields) {
    for (const f of formData.fields) {
      if (f.value && String(f.value).trim()) fieldLines.push(f.label + '\uFF1A' + f.value);
    }
  }

  const infoBlock = '\n\n\u3010' + subLabel + '\u3011\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\u4F9D\u983C\u8005\uFF1A' + formData.name
    + (formData.subCategory ? '\n\u5C0F\u5206\u985E\uFF1A' + formData.subCategory : '')
    + (fieldLines.length ? '\n' + fieldLines.join('\n') : '')
    + '\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501';

  // ダッシュボード用ルーム (333632829) — メインのタスク
  let dashBody = '\u4F9D\u983C\u304C\u304D\u307E\u3057\u305F\u3002\u5BFE\u5FDC\u304A\u9858\u3044\u3057\u307E\u3059\uFF01';
  dashBody += infoBlock;

  const dashRes = await fetch(`https://api.chatwork.com/v2/rooms/${DASHBOARD_ROOM_ID}/tasks`, {
    method: 'POST',
    headers: { 'X-ChatWorkToken': cfg.apiToken },
    body: new URLSearchParams({
      body: dashBody,
      limit: String(Math.floor(Date.now() / 1000) + 86400),
      to_ids: toId,
    }),
  });
  const dashResult = await dashRes.json();

  // 追跡用ルームが別にある場合のみ、REQ-ID付きタスクも作成
  if (cfg.roomId && cfg.roomId !== DASHBOARD_ROOM_ID) {
    let trackingBody = REQ_PREFIX + ' ' + reqId + '\n\n';
    trackingBody += '\u4F9D\u983C\u304C\u304D\u307E\u3057\u305F\u3002\u5BFE\u5FDC\u304A\u9858\u3044\u3057\u307E\u3059\uFF01';
    if (!bh) trackingBody += '\n\u26A0\uFE0F \u55B6\u696D\u6642\u9593\u5916\u306E\u305F\u3081\u5168\u54E1\u306B\u30BF\u30B9\u30AF\u5316\u3057\u3066\u3044\u307E\u3059';
    trackingBody += infoBlock;
    try {
      const res = await fetch(`https://api.chatwork.com/v2/rooms/${cfg.roomId}/tasks`, {
        method: 'POST',
        headers: { 'X-ChatWorkToken': cfg.apiToken },
        body: new URLSearchParams({
          body: trackingBody,
          limit: String(Math.floor(Date.now() / 1000) + 86400),
          to_ids: toId,
        }),
      });
      const result = await res.json();
      if (result.task_ids && result.task_ids[0]) return result.task_ids[0];
    } catch (_) {}
  }

  const taskId = dashResult.task_ids && dashResult.task_ids[0] ? dashResult.task_ids[0] : null;

  if (!bh && taskId) {
    try {
      const msgsRes = await fetch(
        `https://api.chatwork.com/v2/rooms/${DASHBOARD_ROOM_ID}/messages?force=1`,
        { headers: { 'X-ChatWorkToken': cfg.apiToken } }
      );
      let quoteBlock = '';
      if (msgsRes.ok) {
        const msgs = await msgsRes.json();
        if (Array.isArray(msgs) && msgs.length > 0) {
          const taskMsg = msgs[msgs.length - 1];
          quoteBlock = '[qt][qtmeta aid=' + taskMsg.account.account_id + ' time=' + taskMsg.send_time + ']' + taskMsg.body.replace(/\[.*?\]/g, '').trim().slice(0, 500) + '[/qt]';
        }
      }
      const toMentions = NOTIFY_MEMBERS.map((m) => '[To:' + m.id + ']' + m.name + '\u3055\u3093').join('\n');
      let notifyBody = toMentions + '\n\n\u4E0B\u8A18\u30BF\u30B9\u30AF\u306E\u5BFE\u5FDC\u304A\u9858\u3044\u3057\u307E\u3059\u3002\n\n' + quoteBlock;
      await fetch(`https://api.chatwork.com/v2/rooms/${DASHBOARD_ROOM_ID}/messages`, {
        method: 'POST',
        headers: { 'X-ChatWorkToken': cfg.apiToken, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'body=' + encodeURIComponent(notifyBody),
      });
    } catch (_) {}
  }

  if (taskId) return taskId;
  throw new Error('\u30C1\u30E3\u30C3\u30C8\u30EF\u30FC\u30AF\u901A\u77E5\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ' + JSON.stringify(dashResult));
}

// ====================================================
// ダッシュボード: Chatwork タスク取得
// ====================================================

function extractRequester(body) {
  const m = (body || '').match(/依頼者[：:]\s*([^\s\n]+@[^\s\n]+)/);
  return m ? m[1].trim().toLowerCase() : null;
}

function extractRequesterName(body) {
  const b = (body || '').replace(/\[.*?\]/g, '');
  const patterns = [
    /依頼者[：:]\s*([^\n]+)/,
    /氏名[：:]\s*([^\n]+)/,
    /名前[：:]\s*([^\n]+)/,
    /from[：:]\s*([^\n]+)/i,
  ];
  for (const p of patterns) {
    const m = b.match(p);
    if (m && m[1].trim().length > 0) return m[1].trim();
  }
  return null;
}

function findPersonByName(list, name) {
  if (!list || !name) return null;
  const exact = list.find((m) => m.name === name);
  if (exact) return exact;
  const contains = list.find((m) => name.includes(m.name) || m.name.includes(name));
  if (contains) return contains;
  const surname = name.replace(/\s+/g, '').slice(0, 2);
  if (surname.length >= 2) {
    const partial = list.find((m) => m.name && m.name.replace(/\s+/g, '').startsWith(surname));
    if (partial) return partial;
  }
  return null;
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

  const subCat = (b.match(/依頼内容（小分類）[：:](.+)/) || b.match(/小分類[：:](.+)/) || [])[1];
  const mainCat = (b.match(/依頼内容（大分類）[：:](.+)/) || b.match(/大分類[：:](.+)/) || [])[1];
  const project = (b.match(/案件[：:](.+)/) || b.match(/案件名[：:](.+)/) || [])[1];
  const account = (b.match(/アカウント名[：:](.+)/) || b.match(/アカウント[：:](.+)/) || [])[1];
  const media = (b.match(/媒体[：:](.+)/) || [])[1];

  const parts = [];
  const usefulCat = (v) => v && !/^その他$/.test(v.trim()) && !/^（/.test(v.trim());
  if (subCat && usefulCat(subCat)) parts.push(subCat.trim());
  else if (mainCat && usefulCat(mainCat)) parts.push(mainCat.trim());

  if (project && usefulCat(project)) parts.push(project.trim().slice(0, 30));
  else if (account) parts.push(account.trim().slice(0, 30));
  else if (media) parts.push(media.trim().slice(0, 30));

  if (parts.length > 0) return parts.join(' / ').slice(0, 60);

  const bracketMatch = b.match(/【(.+?)】/);
  if (bracketMatch && usefulCat(bracketMatch[1])) return bracketMatch[1].trim().slice(0, 40);

  const SKIP = /^(依頼がきました|対応お願い|営業時間外|お疲れ|下記タスク|⚠|依頼日[：:]|氏名[：:]|エンターキー確認中$)/;
  const META = /^(依頼内容|大分類|小分類|案件|媒体|ASP|商流|アカウント|ピクセル|備考)[：:]/;
  const lines = b.trim().split('\n').map((l) => l.trim()).filter((l) => l.length > 3);

  const contentLines = lines.filter((l) => !SKIP.test(l) && !META.test(l));
  if (contentLines.length > 0) return contentLines[0].slice(0, 50);

  const metaVal = lines.find((l) => META.test(l) && !SKIP.test(l));
  if (metaVal) {
    const val = metaVal.split(/[：:]/)[1];
    if (val && val.trim().length > 0 && usefulCat(val)) return metaVal.slice(0, 50);
  }

  const any = lines.find((l) => !SKIP.test(l));
  return any ? any.slice(0, 50) : '無題';
}

async function sendDoneReplyMessage(taskId, roomId, replyMessage, readToken, sendToken, savedTitle) {
  const taskRes = await fetch(
    `https://api.chatwork.com/v2/rooms/${roomId}/tasks`,
    { headers: { 'X-ChatWorkToken': readToken } }
  );
  if (!taskRes.ok) return;
  const tasks = await taskRes.json();
  const allTasks = [...tasks];

  const doneRes = await fetch(
    `https://api.chatwork.com/v2/rooms/${roomId}/tasks?status=done`,
    { headers: { 'X-ChatWorkToken': readToken } }
  );
  if (doneRes.ok) {
    const doneTasks = await doneRes.json();
    allTasks.push(...doneTasks);
  }

  const task = allTasks.find((t) => String(t.task_id) === String(taskId));
  if (!task) return;

  const assignerAid = task.assigned_by_account?.account_id;
  const assignerTime = task.assign_time || Math.floor(Date.now() / 1000);
  const taskBody = task.body || '';
  const taskTitle = savedTitle || extractTitle(taskBody);

  const requesterName = extractRequesterName(taskBody);
  let requesterAid = null;
  if (requesterName) {
    const knownMatch = DEFAULT_PEOPLE.find((p) => requesterName.includes(p.name));
    if (knownMatch) {
      requesterAid = knownMatch.id;
    }
    if (!requesterAid) {
      try {
        const membersRes = await fetch(
          `https://api.chatwork.com/v2/rooms/${roomId}/members`,
          { headers: { 'X-ChatWorkToken': readToken } }
        );
        if (membersRes.ok) {
          const members = await membersRes.json();
          const match = findPersonByName(members, requesterName);
          if (match) requesterAid = match.account_id;
        }
      } catch (_) {}
    }
    if (!requesterAid) {
      try {
        const contactsRes = await fetch(
          'https://api.chatwork.com/v2/contacts',
          { headers: { 'X-ChatWorkToken': readToken } }
        );
        if (contactsRes.ok) {
          const contacts = await contactsRes.json();
          const match = findPersonByName(contacts, requesterName);
          if (match) requesterAid = match.account_id;
        }
      } catch (_) {}
    }
  }
  const toAid = requesterAid || assignerAid;

  let toName = requesterName || '';
  if (!toName && assignerAid) {
    const assignerName = task.assigned_by_account?.name || '';
    toName = assignerName;
  }
  let msg = '';
  if (toAid) {
    msg += '[To:' + toAid + '] ' + toName + '\u3055\u3093\n';
  }
  if (replyMessage) {
    msg += '[info][title]\u2705\u300C' + taskTitle + '\u300D\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\uFF01[/title]';
    msg += replyMessage + '\n';
    msg += '[/info]\n';
  } else {
    msg += '\u2705\u300C' + taskTitle + '\u300D\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\uFF01\n';
  }
  msg += '[qt][qtmeta aid=' + (assignerAid || 0) + ' time=' + assignerTime + ']' + taskBody.replace(/\[.*?\]/g, '').trim().slice(0, 500) + '[/qt]';

  await fetch(
    `https://api.chatwork.com/v2/rooms/${roomId}/messages`,
    {
      method: 'POST',
      headers: { 'X-ChatWorkToken': sendToken, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'body=' + encodeURIComponent(msg),
    }
  );
}

async function fetchChatworkTasksForDashboard(roomId, apiToken, targetId, status) {
  const url = `https://api.chatwork.com/v2/rooms/${roomId}/tasks?status=${status || 'open'}`;
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
    assigneeName: resolvePersonName(t.account),
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

async function getRegisteredUsers(env) {
  const data = await env.TASK_STORE.get('REGISTERED_USERS');
  return data ? JSON.parse(data) : [];
}

async function saveRegisteredUsers(env, users) {
  await env.TASK_STORE.put('REGISTERED_USERS', JSON.stringify(users));
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

// ====================================================
// 期限超過アラート（Cron Trigger）
// ====================================================

function isJSTBusinessDay() {
  const jst = new Date(Date.now() + 9 * 3600000);
  const day = jst.getUTCDay();
  return day >= 1 && day <= 5;
}

async function checkOverdueTasks(env) {
  if (!isJSTBusinessDay()) return;

  const cfg = await getChatworkConfig(env);
  const local = await getDashboardLocal(env);
  const manualTasks = await getManualTasks(env);

  const jstNow = new Date(Date.now() + 9 * 3600000);
  const todayStr = jstNow.toISOString().slice(0, 10);
  const todayMs = new Date(todayStr).getTime();
  const THREE_DAYS_MS = 3 * 24 * 3600000;
  const overdueItems = [];
  const memberIds = DEFAULT_PEOPLE.map((p) => p.id);

  const rooms = new Set();
  rooms.add(DASHBOARD_ROOM_ID);
  if (cfg.roomId && cfg.roomId !== DASHBOARD_ROOM_ID) rooms.add(cfg.roomId);

  for (const roomId of rooms) {
    try {
      const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/tasks?status=open`, {
        headers: { 'X-ChatWorkToken': cfg.apiToken },
      });
      if (!res.ok) continue;
      const tasks = await res.json();
      for (const t of tasks) {
        const meta = local[t.task_id] || {};
        const effectiveAssigneeId = meta.assigneeId || (t.account && t.account.account_id);
        if (!memberIds.includes(effectiveAssigneeId)) continue;
        if (meta.localStatus === 'done') continue;
        const limitDate = t.limit_time ? new Date(t.limit_time * 1000).toISOString().slice(0, 10) : null;
        const effectiveLimit = meta.limit || limitDate;
        if (!effectiveLimit) continue;
        const diffMs = todayMs - new Date(effectiveLimit).getTime();
        if (diffMs >= THREE_DAYS_MS) {
          const daysOver = Math.floor(diffMs / (24 * 3600000));
          const taskTitle = meta.title || extractTitle(t.body);
          const body = (t.body || '').replace(/\[.*?\]/g, '');
          const project = (body.match(/案件[：:](.+)/) || body.match(/案件名[：:](.+)/) || [])[1];
          let detail = taskTitle;
          if (project) detail += ' / ' + project.trim().slice(0, 30);
          overdueItems.push({
            title: detail.slice(0, 80),
            assignee: meta.assigneeName || (t.account && t.account.name) || '不明',
            deadline: effectiveLimit,
            daysOver: daysOver,
          });
        }
      }
    } catch (_) {}
  }

  for (const mt of manualTasks) {
    if (mt.status === 'done' || mt.category === 'teiki') continue;
    if (!mt.deadline) continue;
    const diffMs = todayMs - new Date(mt.deadline).getTime();
    if (diffMs >= THREE_DAYS_MS) {
      overdueItems.push({
        title: mt.title || '(タイトルなし)',
        assignee: mt.assigneeName || '不明',
        deadline: mt.deadline,
        daysOver: Math.floor(diffMs / (24 * 3600000)),
      });
    }
  }

  if (overdueItems.length === 0) return;

  overdueItems.sort((a, b) => b.daysOver - a.daysOver);

  const ALERT_MEMBERS = [
    { name: '\u897F\u6751', id: 5420288 },
    { name: '\u7B52\u4E95', id: 9797164 },
    { name: '\u53CB\u5229', id: 10034061 },
  ];
  let msg = ALERT_MEMBERS.map((m) => '[To:' + m.id + ']' + m.name + '\u3055\u3093').join('\n') + '\n\n';
  msg += '[info][title]\u26A0\uFE0F \u671F\u65E5\u8D85\u904E\u30BF\u30B9\u30AF\u30A2\u30E9\u30FC\u30C8\uFF083\u65E5\u4EE5\u4E0A\uFF09[/title]';
  for (const item of overdueItems) {
    msg += '\u30FB ' + item.title + '\uFF08\u62C5\u5F53: ' + item.assignee + ' / \u671F\u65E5: ' + item.deadline + ' / ' + item.daysOver + '\u65E5\u8D85\u904E\uFF09\n';
  }
  msg += '\n\u8A08' + overdueItems.length + '\u4EF6\u306E\u30BF\u30B9\u30AF\u304C\u671F\u65E5\u3092\u904E\u304E\u3066\u3044\u307E\u3059\u3002[/info]';

  await fetch(`https://api.chatwork.com/v2/rooms/${OVERDUE_ALERT_ROOM_ID}/messages`, {
    method: 'POST',
    headers: { 'X-ChatWorkToken': cfg.apiToken, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'body=' + encodeURIComponent(msg),
  });
}
