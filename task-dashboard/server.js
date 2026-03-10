const express = require("express");
const fs = require("fs");
const path = require("path");

// Load .env
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

const TOKEN = process.env.CHATWORK_API_TOKEN;
const ROOMS = [process.env.CHATWORK_ROOM_1, process.env.CHATWORK_ROOM_2].filter(Boolean);
const ROOM_AD = process.env.CHATWORK_ROOM_AD;
const MY_ID = Number(process.env.CHATWORK_MY_ACCOUNT_ID);
const AD_MEMBER_IDS = (process.env.AD_MEMBER_IDS || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);
const PORT = Number(process.env.PORT) || 3456;
const LOCAL_DATA = path.join(__dirname, "tasks-local.json");

const PERSONS = (process.env.PERSONS || "")
  .split(",")
  .map((s) => {
    const [name, id] = s.split(":").map((x) => x.trim());
    return name && id ? { name, id: Number(id) } : null;
  })
  .filter(Boolean);

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const time = new Date().toLocaleTimeString("ja-JP");
  console.log(`[${time}] ${req.method} ${req.url}`);
  next();
});
app.use(express.static(path.join(__dirname, "public")));

function loadLocal() {
  if (fs.existsSync(LOCAL_DATA)) {
    return JSON.parse(fs.readFileSync(LOCAL_DATA, "utf-8"));
  }
  return {};
}

function saveLocal(data) {
  fs.writeFileSync(LOCAL_DATA, JSON.stringify(data, null, 2), "utf-8");
}

function extractRequester(body) {
  const m = (body || "").match(/依頼者[：:]\s*([^\s\n]+@[^\s\n]+)/);
  return m ? m[1].trim().toLowerCase() : null;
}

async function fetchChatworkTasks(roomId, options = {}) {
  const { allTasks = false, accountId = null } = options;
  const url = `https://api.chatwork.com/v2/rooms/${roomId}/tasks?status=open`;
  const res = await fetch(url, { headers: { "X-ChatWorkToken": TOKEN } });
  if (!res.ok) throw new Error(`Chatwork API error: ${res.status}`);
  const tasks = await res.json();
  const targetId = accountId || (allTasks ? null : MY_ID);
  const filtered = targetId ? tasks.filter((t) => t.account.account_id === targetId) : tasks;
  return filtered.map((t) => ({
      id: String(t.task_id),
      roomId,
      body: t.body,
      limit: t.limit_time
        ? new Date(t.limit_time * 1000).toISOString().slice(0, 10)
        : null,
      assignedBy: t.assigned_by_account?.name || "",
      status: t.status,
      requester: extractRequester(t.body),
    }));
}

function autoCategory(body) {
  const b = body || "";
  if (/新規案件/.test(b)) return "new_project";
  if (/エラー/.test(b)) return "error";
  if (/キャップ通知/.test(b)) return "cap_notify";
  if (/スプシ|シート/.test(b)) return "sheet";
  if (/ツール|作り替え/.test(b)) return "tool";
  if (/周知|アナウンス/.test(b)) return "announce";
  return "other";
}

function extractTitle(body) {
  const b = (body || "").replace(/\[.*?\]/g, "");
  const patterns = [
    /案件名[：:](.+)/,
    /【(.+?)】/,
    /▼(.+)/,
    /依頼内容（小分類）[：:](.+)/,
  ];
  for (const p of patterns) {
    const m = b.match(p);
    if (m) return m[1].trim().slice(0, 40);
  }
  const first = b.trim().split("\n").find((l) => l.trim().length > 0);
  return first ? first.trim().slice(0, 40) : "無題";
}

app.get("/api/people", (_req, res) => {
  let people;
  if (PERSONS.length > 0) {
    people = PERSONS;
  } else {
    const ids = [...new Set(AD_MEMBER_IDS.filter(Boolean))];
    const idTsutsui = ids.find((id) => id !== MY_ID) || ids[0] || MY_ID;
    const idIshida = ids.find((id) => id !== MY_ID && id !== idTsutsui) || ids[1] || ids[0];
    people = [
      { name: "筒井", id: idTsutsui },
      { name: "友利", id: MY_ID },
      { name: "石田", id: idIshida },
    ].filter((p) => p.id);
  }
  res.json({ people, myId: MY_ID });
});

app.get("/api/debug", (_req, res) => {
  res.json({
    tokenLoaded: !!TOKEN,
    rooms: ROOMS,
    roomAd: ROOM_AD,
    myId: MY_ID,
  });
});

app.get("/api/tasks", async (req, res) => {
  try {
    const local = loadLocal();
    const view = req.query.view || "my";
    const requestorEmail = (req.query.email || "").trim().toLowerCase();
    const accountId = req.query.accountId ? Number(req.query.accountId) : null;
    const rooms = accountId != null ? ROOMS : (view === "all" || view === "requestor") && ROOM_AD ? [ROOM_AD] : ROOMS;
    const allTasksMode = view === "all" || view === "requestor" || accountId != null;

    const allTasks = [];

    for (const roomId of rooms) {
      console.log(`  [Chatwork] ルーム ${roomId} からタスク取得中...`);
      const tasks = await fetchChatworkTasks(roomId, {
        allTasks: allTasksMode,
        accountId: accountId || (view === "my" ? undefined : null),
      });
      console.log(`  [Chatwork] → ${tasks.length} 件取得`);
      for (const t of tasks) {
        if (view === "requestor" && requestorEmail) {
          if (t.requester !== requestorEmail) continue;
        }
        const meta = local[t.id] || {};
        allTasks.push({
          ...t,
          title: meta.title || extractTitle(t.body),
          category: meta.category || autoCategory(t.body),
          priority: meta.priority || "medium",
          localStatus: meta.localStatus || "open",
          note: meta.note || "",
        });
      }
    }

    console.log(`  [Chatwork] 合計: ${allTasks.length} 件`);
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json(allTasks);
  } catch (err) {
    console.error("  [Chatwork] エラー:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks/:id", (req, res) => {
  const local = loadLocal();
  const id = req.params.id;
  local[id] = { ...(local[id] || {}), ...req.body };
  saveLocal(local);
  res.json({ ok: true });
});

app.get("/api/monthly", (_req, res) => {
  const local = loadLocal();
  const monthly = local._monthly || [
    { id: "m1", title: "アセクリのシフト集め", done: false },
    { id: "m2", title: "出稿部のシフト作成", done: false },
  ];
  res.json(monthly);
});

app.post("/api/monthly", (req, res) => {
  const local = loadLocal();
  local._monthly = req.body;
  saveLocal(local);
  res.json({ ok: true });
});

app.get("/api/tools", (_req, res) => {
  const local = loadLocal();
  const tools = local._tools || [
    { id: "t1", name: "TikTok出稿ツール", status: "blocked", note: "Smart+動画エラーで停止中" },
    { id: "t2", name: "FB作り替えツール", status: "not_started", note: "" },
    { id: "t3", name: "TikTok作り替え", status: "not_started", note: "" },
    { id: "t4", name: "FB API出稿ツール", status: "not_started", note: "" },
  ];
  res.json(tools);
});

app.post("/api/tools", (req, res) => {
  const local = loadLocal();
  local._tools = req.body;
  saveLocal(local);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log("========================================");
  console.log(`Task Dashboard: http://localhost:${PORT}`);
  console.log(`  Token: ${TOKEN ? "設定済" : "未設定"}`);
  console.log(`  ルーム: ${ROOMS.length} 件`);
  console.log("========================================");
});
