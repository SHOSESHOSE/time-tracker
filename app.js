// 作業時間トラッカー（index.htmlに合わせた動作確定版）

const LS_KEY = "timeTracker.logs";

let currentTask = null;          // { id, date, category, startISO, endISO }
let selectedDate = new Date();   // Date
let editingLogId = null;

document.addEventListener("DOMContentLoaded", () => {
    // ===== ユーザー名管理 =====
  const USER_KEY = "timeTrackerUserName";

  function getUserName() {
    return localStorage.getItem(USER_KEY) || "unknown";
  }

  function setUserName(name) {
    const cleaned = String(name).replace(/[\r\n,]/g, " ").trim();
    if (!cleaned) return;
    localStorage.setItem(USER_KEY, cleaned);
    updateUserNameUI();
  }

  function updateUserNameUI() {
    const label = document.getElementById("userNameLabel");
    if (label) label.textContent = getUserName();
  }

  function bindUserNameButton() {
    const handleChangeUser = () => {
      const current = getUserName();
      const input = prompt("名前を変更してください", current);
  if (input !== null) setUserName(input);
};

btn.addEventListener("click", handleChangeUser);
btn.addEventListener("touchstart", (e) => {
  e.preventDefault(); // Safari対策
  handleChangeUser();
});

  }

  // 初期化
  if (!localStorage.getItem(USER_KEY)) {
    const first = prompt("名前を入力してください（例：松原）");
    if (first) localStorage.setItem(USER_KEY, first);
  }
  updateUserNameUI();
  bindUserNameButton();
  // =========================

  // 要素取得
  const dateInput = document.getElementById("dateInput");
  const prevDayBtn = document.getElementById("prevDay");
  const nextDayBtn = document.getElementById("nextDay");

  const currentStatusBox = document.getElementById("currentStatus");
  const statusText = currentStatusBox.querySelector(".status-text");

  const categoryButtons = document.querySelectorAll(".category-btn[data-category]");
  const stopBtn = document.getElementById("stopBtn");

  const logsList = document.getElementById("logsList");
  const summary = document.getElementById("summary");
  const exportBtn = document.getElementById("exportCsv");

  // モーダル要素
  const editModal = document.getElementById("editModal");
  const editCategory = document.getElementById("editCategory");
  const editStartTime = document.getElementById("editStartTime");
  const editEndTime = document.getElementById("editEndTime");
  const saveEdit = document.getElementById("saveEdit");
  const deleteLog = document.getElementById("deleteLog");
  const cancelEdit = document.getElementById("cancelEdit");

  // 安全チェック（ここで止まると何も動かないので即わかる）
  if (!dateInput || !statusText || !logsList || !summary) {
    alert("HTML要素が見つかりません（idの不一致の可能性）");
    return;
  }

  // 初期：今日をセット
  dateInput.value = toYMD(new Date());
  selectedDate = fromYMD(dateInput.value);

  // 日付変更
  dateInput.addEventListener("change", () => {
    selectedDate = fromYMD(dateInput.value);
    renderAll();
  });
  prevDayBtn.addEventListener("click", () => {
    selectedDate = addDays(selectedDate, -1);
    dateInput.value = toYMD(selectedDate);
    renderAll();
  });
  nextDayBtn.addEventListener("click", () => {
    selectedDate = addDays(selectedDate, +1);
    dateInput.value = toYMD(selectedDate);
    renderAll();
  });

  // カテゴリボタン
  categoryButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.category;
      startCategory(cat);
      renderAll();
    });
  });

  // 停止
  stopBtn.addEventListener("click", () => {
    stopCurrent();
    renderAll();
  });

  // CSV出力
  exportBtn.addEventListener("click", () => {
    exportCsvForSelectedDate();
  });

  // モーダル操作
  cancelEdit.addEventListener("click", () => closeModal());
  editModal.addEventListener("click", (e) => {
    if (e.target === editModal) closeModal();
  });

  saveEdit.addEventListener("click", () => {
    if (!editingLogId) return;
    const logs = loadLogs();
    const idx = logs.findIndex((x) => x.id === editingLogId);
    if (idx === -1) return;

    logs[idx].category = editCategory.value;

    const d = logs[idx].date; // YYYY-MM-DD
    const s = editStartTime.value;
    const en = editEndTime.value;

    if (!s) {
      alert("開始時刻が空です");
      return;
    }

    logs[idx].startISO = toISO(d, s);
    logs[idx].endISO = en ? toISO(d, en) : null;

    // 稼働中ログを編集して endISO を埋めたら currentTask を外す
    if (currentTask && currentTask.id === editingLogId && logs[idx].endISO) {
      currentTask = null;
    }

    saveLogs(logs);
    closeModal();
    renderAll();
  });

  deleteLog.addEventListener("click", () => {
    if (!editingLogId) return;
    let logs = loadLogs();
    logs = logs.filter((x) => x.id !== editingLogId);

    if (currentTask && currentTask.id === editingLogId) {
      currentTask = null;
    }

    saveLogs(logs);
    closeModal();
    renderAll();
  });

  // 初回レンダリング
  renderAll();

  // ------- 関数 -------

  function renderAll() {
    renderStatus();
    renderLogs();
    renderSummary();
  }

  function startCategory(category) {
    // 違うカテゴリへ切替えるとき、まず前の稼働を終了
    if (currentTask) {
      stopCurrent();
    }

    const now = new Date();
    const d = toYMD(selectedDate);

    const newLog = {
      id: cryptoRandomId(),
      date: d,
      category,
      startISO: now.toISOString(),
      endISO: null,
    };

    const logs = loadLogs();
    logs.push(newLog);
    saveLogs(logs);

    currentTask = newLog;
  }

  function stopCurrent() {
    if (!currentTask) return;

    const logs = loadLogs();
    const idx = logs.findIndex((x) => x.id === currentTask.id);
    if (idx !== -1) {
      logs[idx].endISO = new Date().toISOString();
      saveLogs(logs);
    }
    currentTask = null;
  }

  function renderStatus() {
    if (!currentTask) {
      statusText.textContent = "停止中";
      return;
    }
    const start = new Date(currentTask.startISO);
    statusText.textContent =
      `作業中：${currentTask.category}（開始 ${start.toLocaleTimeString()}）`;
  }

  function renderLogs() {
    const d = toYMD(selectedDate);
    const logs = loadLogs().filter((x) => x.date === d);

    // 開始時刻順
    logs.sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

    logsList.innerHTML = "";

    if (logs.length === 0) {
      logsList.innerHTML = `<div style="opacity:.7;">ログはまだありません</div>`;
      return;
    }

    logs.forEach((log) => {
      const s = new Date(log.startISO);
      const e = log.endISO ? new Date(log.endISO) : null;
      const mins = calcMinutes(log.startISO, log.endISO);

      const row = document.createElement("div");
      row.className = "log-item";
      row.style.padding = "10px";
      row.style.border = "1px solid rgba(0,0,0,.08)";
      row.style.borderRadius = "10px";
      row.style.marginBottom = "8px";
      row.style.background = "rgba(255,255,255,.8)";

      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
          <div>
            <div style="font-weight:700;">${log.category}</div>
            <div style="opacity:.75;font-size:12px;">
              ${fmtHM(s)} → ${e ? fmtHM(e) : "（進行中）"} / ${mins}分
            </div>
          </div>
          <button style="padding:8px 10px;border-radius:10px;border:0;cursor:pointer;">編集</button>
        </div>
      `;

      row.querySelector("button").addEventListener("click", () => openModal(log));
      logsList.appendChild(row);
    });
  }

  function renderSummary() {
    const d = toYMD(selectedDate);
    const logs = loadLogs().filter((x) => x.date === d);

    const order = ["移動", "見積", "現場", "AI", "休憩"];
    const sums = Object.fromEntries(order.map((k) => [k, 0]));

    logs.forEach((log) => {
      sums[log.category] = (sums[log.category] || 0) + calcMinutes(log.startISO, log.endISO);
    });

    const total = order.reduce((acc, k) => acc + (sums[k] || 0), 0);

    summary.innerHTML = `
      <h2 style="margin:10px 0 6px;">今日の合計</h2>
      ${order.map(k => `<div style="display:flex;justify-content:space-between;">
        <div>${k}</div><div>${fmtHMFromMinutes(sums[k] || 0)}</div>
      </div>`).join("")}
      <hr style="opacity:.2;margin:8px 0;">
      <div style="display:flex;justify-content:space-between;font-weight:700;">
        <div>合計</div><div>${fmtHMFromMinutes(total)}</div>
      </div>
    `;
  }

  function openModal(log) {
    editingLogId = log.id;
    editCategory.value = log.category;

    const s = new Date(log.startISO);
    editStartTime.value = fmtTimeInput(s);

    if (log.endISO) {
      const e = new Date(log.endISO);
      editEndTime.value = fmtTimeInput(e);
    } else {
      editEndTime.value = "";
    }

    editModal.style.display = "block";
  }

  function closeModal() {
    editingLogId = null;
    editModal.style.display = "none";
  }

function exportCsvForSelectedDate() {
  const d = toYMD(selectedDate);
  const logs = loadLogs().filter((x) => x.date === d);
  logs.sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  // ✅ ユーザー名を取得（index.html側で保存しているキー）
  const userNameRaw = localStorage.getItem("timeTrackerUserName") || "unknown";
  const userName = String(userNameRaw).replace(/[\r\n,]/g, " ").trim() || "unknown";
  const safeUserName = userName.replace(/[\\\/:*?"<>|]/g, "").trim() || "unknown";

  // ✅ ヘッダーにユーザー列を追加
  const header = ["ユーザー", "カテゴリ", "開始", "終了", "分"];

  const rows = logs.map((log) => {
    const s = new Date(log.startISO);
    const e = log.endISO ? new Date(log.endISO) : null;
    return [
      userName,
      log.category,
      `${d} ${fmtHM(s)}`,
      e ? `${d} ${fmtHM(e)}` : "",
      calcMinutes(log.startISO, log.endISO)
    ];
  });

  const csv = [header, ...rows]
    .map((r) => r.map(escapeCsv).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `time_log_${d}_${safeUserName}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

  // ------- ユーティリティ -------

  function loadLogs() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveLogs(logs) {
    localStorage.setItem(LS_KEY, JSON.stringify(logs));
  }

  function calcMinutes(startISO, endISO) {
    const start = new Date(startISO).getTime();
    const end = endISO ? new Date(endISO).getTime() : Date.now();
    const diffMs = Math.max(0, end - start);
    return Math.round(diffMs / 60000);
  }

  function toYMD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function fromYMD(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function fmtHM(date) {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function fmtTimeInput(date) {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function fmtHMFromMinutes(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h <= 0) return `${m}分`;
    return `${h}時間${m}分`;
  }

  function escapeCsv(v) {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function toISO(dateYMD, timeHHMM) {
    // ローカル時刻の YYYY-MM-DD + HH:MM を ISO に変換
    const [y, m, d] = dateYMD.split("-").map(Number);
    const [hh, mm] = timeHHMM.split(":").map(Number);
    const dt = new Date(y, m - 1, d, hh, mm, 0);
    return dt.toISOString();
  }

  function cryptoRandomId() {
    // ほぼユニークでOK
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
});



