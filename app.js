// 作業時間トラッカー（CSVにユーザー名対応・確定版）

const LS_KEY = "timeTracker.logs";

let currentTask = null;          // { id, date, category, startISO, endISO }
let selectedDate = new Date();   // Date
let editingLogId = null;

document.addEventListener("DOMContentLoaded", () => {
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

  // 安全チェック
  if (!dateInput || !statusText || !logsList || !summary) {
    alert("HTML要素が見つかりません（idの不一致の可能性）");
    return;
  }

  // 初期：今日
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

  // カテゴリ開始
  categoryButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      startCategory(btn.dataset.category);
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
  cancelEdit.addEventListener("click", closeModal);
  editModal.addEventListener("click", (e) => {
    if (e.target === editModal) closeModal();
  });

  saveEdit.addEventListener("click", () => {
    if (!editingLogId) return;
    const logs = loadLogs();
    const idx = logs.findIndex((x) => x.id === editingLogId);
    if (idx === -1) return;

    logs[idx].category = editCategory.value;

    const d = logs[idx].date;
    const s = editStartTime.value;
    const e = editEndTime.value;

    if (!s) {
      alert("開始時刻が空です");
      return;
    }

    logs[idx].startISO = toISO(d, s);
    logs[idx].endISO = e ? toISO(d, e) : null;

    if (currentTask && currentTask.id === editingLogId && logs[idx].endISO) {
      currentTask = null;
    }

    saveLogs(logs);
    closeModal();
    renderAll();
  });

  deleteLog.addEventListener("click", () => {
    if (!editingLogId) return;
    let logs = loadLogs().filter((x) => x.id !== editingLogId);
    if (currentTask && currentTask.id === editingLogId) currentTask = null;
    saveLogs(logs);
    closeModal();
    renderAll();
  });

  renderAll();

  // -------- 表示 --------

  function renderAll() {
    renderStatus();
    renderLogs();
    renderSummary();
  }

  function startCategory(category) {
    if (currentTask) stopCurrent();
    const d = toYMD(selectedDate);
    const newLog = {
      id: cryptoRandomId(),
      date: d,
      category,
      startISO: new Date().toISOString(),
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
    if (idx !== -1) logs[idx].endISO = new Date().toISOString();
    saveLogs(logs);
    currentTask = null;
  }

  function renderStatus() {
    if (!currentTask) {
      statusText.textContent = "停止中";
      return;
    }
    const s = new Date(currentTask.startISO);
    statusText.textContent = `作業中：${currentTask.category}（開始 ${fmtHM(s)}）`;
  }

  function renderLogs() {
    const d = toYMD(selectedDate);
    const logs = loadLogs().filter((x) => x.date === d);
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
      row.style.marginBottom = "8px";
      row.innerHTML = `
        <strong>${log.category}</strong><br>
        ${fmtHM(s)} → ${e ? fmtHM(e) : "進行中"} / ${mins}分
        <br><button>編集</button>
      `;
      row.querySelector("button").addEventListener("click", () => openModal(log));
      logsList.appendChild(row);
    });
  }

  function renderSummary() {
    const d = toYMD(selectedDate);
    const logs = loadLogs().filter((x) => x.date === d);
    const sums = {};
    logs.forEach((l) => {
      sums[l.category] = (sums[l.category] || 0) + calcMinutes(l.startISO, l.endISO);
    });
    summary.innerHTML = Object.entries(sums)
      .map(([k, v]) => `${k}: ${v}分`)
      .join("<br>");
  }

  // -------- CSV出力（ユーザー名対応） --------

  function exportCsvForSelectedDate() {
    const d = toYMD(selectedDate);
    const logs = loadLogs().filter((x) => x.date === d);
    logs.sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

    const userRaw = localStorage.getItem("timeTrackerUserName") || "unknown";
    const userName = userRaw.replace(/[\r\n,]/g, " ").trim() || "unknown";
    const safeUser = userName.replace(/[\\\/:*?"<>|]/g, "");

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

    const csv = [header, ...rows].map(r => r.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `time_log_${d}_${safeUser}.csv`;
    a.click();
  }

  // -------- ユーティリティ --------

  function loadLogs() {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  }
  function saveLogs(logs) {
    localStorage.setItem(LS_KEY, JSON.stringify(logs));
  }
  function calcMinutes(s, e) {
    return Math.round((new Date(e || Date.now()) - new Date(s)) / 60000);
  }
  function toYMD(d) {
    return d.toISOString().slice(0, 10);
  }
  function fromYMD(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function fmtHM(d) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function escapeCsv(v) {
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }
  function toISO(d, t) {
    const [y, m, da] = d.split("-").map(Number);
    const [h, mi] = t.split(":").map(Number);
    return new Date(y, m - 1, da, h, mi).toISOString();
  }
  function cryptoRandomId() {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
});
