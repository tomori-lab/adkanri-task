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
      // ── スプレッドシート連携 ──
      else if (path === '/api/sheet-options' && request.method === 'GET') {
        response = await handleGetSheetOptions(request, env);
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
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
  formData.name = user.name || user.email;
  formData.email = user.email;

  const reqId = 'REQ-' + formatJST(new Date(), 'yyyyMMdd-HHmmss');
  const taskId = await sendChatworkTask(formData, reqId, env);

  if (taskId) {
    await saveTaskMeta(env, taskId, reqId, formData, '未対応');
    const subLabel = formData.subCategory || formData.category;
    const fieldSummary = (formData.fields || []).map((f) => f.label + ':' + f.value).join(' / ');
    const content = '\u3010' + subLabel + '\u3011' + (fieldSummary ? ' ' + fieldSummary : '');
    const assigneeName = resolveAssigneeName(env, formData);
    await appendTaskLog(env, String(taskId), formatJST(new Date(), 'yyyy/MM/dd HH:mm'), content, formData.name, assigneeName);
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
// ハンドラ: 自分の依頼一覧（ダッシュボードルームから取得）
// ====================================================

async function handleGetMyRequests(request, env) {
  await verifyGoogleToken(request, env);
  const cfg = getChatworkConfig(env);
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

  for (const t of allTasks) {
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
      title: titleMatch ? titleMatch[1] : extractTitle(body),
      category: catMatch ? catMatch[1].trim() : '-',
      subCategory: subMatch ? subMatch[1].trim() : '',
      status: displayStatus,
      requester: reqName,
      assignee: t.account ? t.account.name : '',
      createdAt: t.limit_time ? new Date(t.limit_time * 1000).toISOString().slice(0, 10) : '-',
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
  { name: '\u77F3\u7530', id: 10696465 },
  { name: '\u897F\u6751', id: 5420288 },
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

  const roomSet = new Set();
  if (cfg.roomId) roomSet.add(cfg.roomId);
  if (room2) roomSet.add(room2);
  roomSet.add(DASHBOARD_ROOM_ID);
  const rooms = [...roomSet];

  const local = await getDashboardLocal(env);
  const allTasksList = [];

  const memberIds = DEFAULT_PEOPLE.map((p) => p.id);
  const seen = new Set();

  for (const roomId of rooms) {
    const allRoomTasks = await fetchChatworkTasksForDashboard(roomId, cfg.apiToken, null);
    for (const t of allRoomTasks) {
      if (!memberIds.includes(t.assigneeId)) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const meta = local[t.id] || {};
      const effectiveAssigneeId = meta.assigneeId || t.assigneeId;
      if (accountId !== null && effectiveAssigneeId !== accountId) continue;
      allTasksList.push({
        ...t,
        title: meta.title || extractTitle(t.body),
        category: meta.category || autoCategory(t.body),
        priority: meta.priority || 'medium',
        localStatus: meta.localStatus || 'open',
        note: meta.note || '',
        assigneeId: effectiveAssigneeId,
        assigneeName: meta.assigneeName || t.assigneeName,
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

  if (body.localStatus) {
    const cfg = getChatworkConfig(env);
    const cwStatus = body.localStatus === 'done' ? 'done' : 'open';
    const roomId = body.roomId || local[id].roomId || DASHBOARD_ROOM_ID;
    if (roomId) local[id].roomId = roomId;
    await saveDashboardLocal(env, local);
    try {
      await fetch(
        `https://api.chatwork.com/v2/rooms/${roomId}/tasks/${id}/status`,
        {
          method: 'PUT',
          headers: { 'X-ChatWorkToken': cfg.apiToken, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `body=${cwStatus}`,
        }
      );
    } catch (_) {}

    if (body.localStatus === 'done') {
      try {
        const doneToken = env.CHATWORK_DONE_TOKEN || cfg.apiToken;
        await sendDoneReplyMessage(id, roomId, body.replyMessage || '', cfg.apiToken, doneToken);
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
  if (!spreadsheetId || !range) {
    return jsonResponse({ error: 'id and range required' }, 400);
  }

  const cacheKey = `SHEET_CACHE_${spreadsheetId}_${range}_${condRange || ''}_${condValue || ''}`;
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
      const val = condVals[i] === condValue ? (condReplace || condValue) : mainVals[i];
      if (val) merged.push(val);
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

async function appendTaskLog(env, taskId, createdDate, content, requester, assignee) {
  try {
    const token = await getGoogleAccessToken(env);
    const range = encodeURIComponent(`${TASK_LOG_SHEET_NAME}!A:G`);
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${TASK_LOG_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[taskId, createdDate, content, requester, assignee, '', '']] }),
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
    const updateRange = encodeURIComponent(`${TASK_LOG_SHEET_NAME}!F${rowIndex}:G${rowIndex}`);
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

const HARDCODED_ASSIGN_MAP = {
  '\u30A2\u30AB\u30A6\u30F3\u30C8\u95A2\u9023\uFF08\u4F5C\u6210\u30FB\u7D10\u3065\u3051\u30FB\u30A8\u30E9\u30FC\uFF09': '10696465',
  '\u30EA\u30F3\u30AF\u767A\u884C\u4F9D\u983C': '10696465',
  '\u30B9\u30D7\u30B7\u95A2\u9023': '10034061',
  '\u65B0\u898F\u6848\u4EF6': '10034061',
  '\u65B0\u898F\u30AA\u30D5\u30A1\u30FC\u8FFD\u52A0': '10034061',
  '\u5358\u4FA1\u5909\u66F4': '10034061',
  'CSV\u4FDD\u7BA1\u4FEE\u6B63/\u5F8C\u7740\u706B\u4FEE\u6B63': '10034061',
  '\u30AD\u30E3\u30C3\u30D7\u901A\u77E5\u4F9D\u983C': '10034061',
  '\u305D\u306E\u4ED6/\u30A8\u30E9\u30FC\u95A2\u9023': '10034061',
};

function getChatworkConfig(env) {
  let assignMap = {};
  try { assignMap = JSON.parse(env.ASSIGN_MAP_JSON || '{}'); } catch (_) {}
  const hasValidKeys = Object.keys(assignMap).some((k) => !/\?/.test(k) && k.length > 2);
  if (!hasValidKeys) assignMap = HARDCODED_ASSIGN_MAP;
  return {
    apiToken: env.CHATWORK_API_TOKEN || '',
    roomId: env.CHATWORK_ROOM_ID || '',
    allUserIds: env.ALL_USER_IDS || '',
    assignMap,
  };
}

function resolveAssigneeName(env, formData) {
  const cfg = getChatworkConfig(env);
  const toId = hasLineYahooMedia(formData) ? LINE_YAHOO_ASSIGNEE : resolveAssignee(cfg, formData.category, true);
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
const LINE_YAHOO_KEYWORDS = ['LINE', 'LY', 'Yahoo'];

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

const NOTIFY_MEMBERS = [
  { name: '\u7B52\u4E95', id: 9797164 },
  { name: '\u53CB\u5229', id: 10034061 },
  { name: '\u897F\u6751', id: 5420288 },
];

async function sendChatworkTask(formData, reqId, env) {
  const cfg = getChatworkConfig(env);
  const bh = isBusinessHours();
  const toId = hasLineYahooMedia(formData) ? LINE_YAHOO_ASSIGNEE : resolveAssignee(cfg, formData.category, true);

  const subLabel = formData.subCategory || formData.category;
  const fieldLines = [];
  if (formData.fields) {
    for (const f of formData.fields) {
      if (f.value && String(f.value).trim()) fieldLines.push(f.label + '\uFF1A' + f.value);
    }
  }

  const infoBlock = '\n\n\u3010' + subLabel + '\u3011\n[info]\n\u4F9D\u983C\u8005\uFF1A' + formData.name
    + (formData.subCategory ? '\n\u5C0F\u5206\u985E\uFF1A' + formData.subCategory : '')
    + (fieldLines.length ? '\n' + fieldLines.join('\n') : '')
    + '\n[/info]';

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
      const toMentions = NOTIFY_MEMBERS.map((m) => '[To:' + m.id + '] ' + m.name + '\u3055\u3093').join('\n');
      let notifyBody = toMentions + '\n\u4E0B\u8A18\u30BF\u30B9\u30AF\u5BFE\u5FDC\u304A\u9858\u3044\u3057\u307E\u3059\u3002';
      notifyBody += infoBlock;
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
  const m = (body || '').match(/依頼者[：:]\s*([^\n]+)/);
  return m ? m[1].trim() : null;
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
  const patterns = [/案件名[：:](.+)/, /【(.+?)】/, /▼(.+)/, /依頼内容（小分類）[：:](.+)/];
  for (const p of patterns) {
    const m = b.match(p);
    if (m) return m[1].trim().slice(0, 40);
  }
  const first = b.trim().split('\n').find((l) => l.trim().length > 0);
  return first ? first.trim().slice(0, 40) : '無題';
}

async function sendDoneReplyMessage(taskId, roomId, replyMessage, readToken, sendToken) {
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
  const taskTitle = extractTitle(taskBody);

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

  const toName = requesterName || '';
  let msg = '';
  if (toAid) {
    msg += '[To:' + toAid + '] ' + toName + '\u3055\u3093\n';
  }
  msg += '[info][title]\u2705\u300C' + taskTitle + '\u300D\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\uFF01[/title]';
  if (replyMessage) {
    msg += replyMessage + '\n';
  }
  msg += '[/info]\n';
  msg += '[qt][qtmeta aid=' + (assignerAid || 0) + ' time=' + assignerTime + ']' + taskBody.slice(0, 500) + '[/qt]';

  await fetch(
    `https://api.chatwork.com/v2/rooms/${roomId}/messages`,
    {
      method: 'POST',
      headers: { 'X-ChatWorkToken': sendToken, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'body=' + encodeURIComponent(msg),
    }
  );
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
