window.addEventListener("error", (e) => {
  alert("JSエラー: " + (e.message || "unknown"));
});
window.addEventListener("unhandledrejection", (e) => {
  alert("Promiseエラー: " + (e.reason?.message || e.reason || "unknown"));
});

// 作業時間トラッカー（スマホ堅牢版）
// - ボタン不具合対策：pointerup統一 + 多重送信ロック + finallyで必ず解除
// - CSV出力にユーザー名
// - Googleフォームへ送信（1ログ=1送信 / hidden form）

const LS_KEY = "timeTracker.logs";
const USER_KEY = "timeTrackerUserName";

// ===== Googleフォーム =====
const FORM_RESPONSE_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdYEQrCid_6FzZOTMutgOQe856ifZqEph3bMCFYY6rOoo0pdA/formResponse";

// entry マッピング（確定）
const ENTRY_USER     = "entry.1740056764";
const ENTRY_DATE     = "entry.534195892";
const ENTRY_CATEGORY = "entry.2081291626";
const ENTRY_START    = "entry.1118932593";
const ENTRY_END      = "entry.1515830053";
const ENTRY_MINUTES  = "entry.1993585802";
// =========================

let currentTask = null;          // { id, date, category, startISO, endISO }
let selectedDate = new Date();   // Date
let editingLogId = null;

document.addEventListener("DOMContentLoaded", () => {
  // 要素取得
  const dateInput = document.getElementById("dateInput");
  const prevDayBtn = document.getElementById("prevDay");
  const nextDayBtn = document.getElementById("nextDay");

  const currentStatusBox = document.getElementById("currentStatus");
  const statusText = currentStatusBox?.querySelector(".status-text");

  const categoryButtons = document.querySelectorAll(".category-btn[data-category]");
  const stopBtn = document.getElementById("stopBtn");

  const logsList = document.getElementById("logsList");
  const summary = document.getElementById("summary");
  const exportBtn = document.getElementById("exportCsv");
  const sendBtn = document.getElementById("sendToSheet");

  // ユーザー名UI
  const userNameLabel = document.getElementById("userNameLabel");
  const changeUserBtn = document.getElementById("changeUserBtn");

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

  // ===== ユーザー名管理 =====
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
    if (userNameLabel) userNameLabel.textContent = getUserName();
  }

  // 初回だけ名前入力
  if (!localStorage.getItem(USER_KEY)) {
    const first = prompt("名前を入力してください（例：松原）");
    localStorage.setItem(USER_KEY, (first ? String(first).trim() : "unknown") || "unknown");
  }
  updateUserNameUI();

  // changeUserBtn（スマホ対策：pointerup 1本）
  if (changeUserBtn) {
    changeUserBtn.addEventListener("pointerup", (e) => {
      e.preventDefault();
      const current = getUserName();
      const input = prompt("名前を変更してください", current);
      if (input !== null) setUserName(input);
    });
  }
  // =========================

  // 初期：今日
  dateInput.value = toYMD(new Date());
  selectedDate = fromYMD(dateInput.value);

  // 日付変更
  dateInput.addEventListener("change", () => {
    selectedDate = fromYMD(dateInput.value);
    renderAll();
  });
  prevDayBtn?.addEventListener("click", () => {
    selectedDate = addDays(selectedDate, -1);
    dateInput.value = toYMD(selectedDate);
    renderAll();
  });
  nextDayBtn?.addEventListener("click", () => {
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
  stopBtn?.addEventListener("click", () => {
    stopCurrent();
    renderAll();
  });

  // CSV出力
  exportBtn?.addEventListener("click", () => {
    exportCsvForSelectedDate();
  });

  // スプシ送信（スマホで「押せない/一回しか押せない」対策込み）
  if (sendBtn) {
    sendBtn.type = "button"; // form内でも暴発しない
    sendBtn.addEventListener("pointerup", async (e) => {
      e.preventDefault();

      // 多重送信ロック
      if (sendBtn.dataset.busy === "1") return;
      sendBtn.dataset.busy = "1";
      sendBtn.disabled = true;

      try {
        await sendSelectedDateLogsToGoogleForm();
        alert("スプレッドシートに送信しました");
      } catch (err) {
        console.error(err);
        alert("送信に失敗しました。通信状況を確認してください。");
      } finally {
        sendBtn.disabled = false;
        sendBtn.dataset.busy = "0";
      }
    });
  }

  // モーダル操作
  cancelEdit?.addEventListener("click", () => closeModal());
  editModal?.addEventListener("click", (e) => {
    if (e.target === editModal) closeModal();
  });

  saveEdit?.addEventListener("click", () => {
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

  deleteLog?.addEventListener("click", () => {
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
    if (currentTask) stopCurrent();

    const now = new Date();
    const d = toYMD(selectedDate);

    const newLog = {
      id: cryptoRandomId(),
      date: d,
      category,
      startISO: now.toISOString(),
      endISO: null,
      sent: false,   // ★追加
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
    const allLogs = loadLogs();

const logs = allLogs
  .filter(x => x.date === d)
  .filter(x => x.sent !== true); // ★未送信のみ


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
          <button type="button" style="padding:8px 10px;border-radius:10px;border:0;cursor:pointer;">編集</button>
        </div>
      `;

      row.querySelector("button").addEventListener("click", () => openModal(log));
      logsList.appendChild(row);
    });
  }

  function renderSummary() {
    const d = toYMD(selectedDate);
    const logs = loadLogs().filter((x) => x.date === d);

    const order = ["移動", "見積", "現場", "事務", "休憩"];
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

  // CSV出力（ユーザー列追加）
  function exportCsvForSelectedDate() {
    const d = toYMD(selectedDate);
    const logs = loadLogs().filter((x) => x.date === d);
    logs.sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

    const userNameRaw = localStorage.getItem(USER_KEY) || "unknown";
    const userName = String(userNameRaw).replace(/[\r\n,]/g, " ").trim() || "unknown";
    const safeUserName = userName.replace(/[\\\/:*?"<>|]/g, "").trim() || "unknown";

    const header = ["ユーザー", "カテゴリ", "開始", "終了", "分"];
    const rows = logs.map((log) => {
      const s = new Date(log.startISO);
      const e = log.endISO ? new Date(log.endISO) : null;
      return [
        userName,
        log.category,
        `${d} ${fmtHM(s)}`,
        e ? `${d} ${fmtHM(e)}` : "",
        calcMinutes(log.startISO, log.endISO),
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

  // Googleフォーム送信（1ログ=1送信 / hidden form）
  async function sendSelectedDateLogsToGoogleForm() {
    const d = toYMD(selectedDate);
    const logs = loadLogs().filter((x) => x.date === d);
    logs.sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

    if (logs.length === 0) {
      alert("この日のログがありません");
      return;
    }

    const userNameRaw = localStorage.getItem(USER_KEY) || "unknown";
    const userName = String(userNameRaw).replace(/[\r\n,]/g, " ").trim() || "unknown";

    // hidden iframe（画面遷移しない）
    let iframe = document.getElementById("hiddenGoogleFormFrame");
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.name = "hiddenGoogleFormFrame";
      iframe.id = "hiddenGoogleFormFrame";
      iframe.style.display = "none";
      document.body.appendChild(iframe);
    }

    for (const log of logs) {
      const s = new Date(log.startISO);
      const e = log.endISO ? new Date(log.endISO) : null;

      const form = document.createElement("form");
      form.action = FORM_RESPONSE_URL;
      form.method = "POST";
      form.target = "hiddenGoogleFormFrame";

      const add = (name, value) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value ?? "";
        form.appendChild(input);
      };

      add(ENTRY_USER, userName);
      add(ENTRY_DATE, d);
      add(ENTRY_CATEGORY, log.category);
      add(ENTRY_START, fmtHM(s));                 // HH:MM
      add(ENTRY_END, e ? fmtHM(e) : "");          // HH:MM
      add(ENTRY_MINUTES, String(calcMinutes(log.startISO, log.endISO)));

      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);
      log.sent = true;     // ★送信済みにする
      saveLogs(allLogs);  // ★必ず元配列を保存


      await sleep(200); // 連投しすぎ防止
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
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
    const [y, m, d] = dateYMD.split("-").map(Number);
    const [hh, mm] = timeHHMM.split(":").map(Number);
    const dt = new Date(y, m - 1, d, hh, mm, 0);
    return dt.toISOString();
  }

  function cryptoRandomId() {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
});

// iOS Safari対策：HTML直呼び用
window.handleSendToSheet = async function () {
  const btn = document.getElementById("sendToSheet");
  if (!btn) return;

  if (btn.dataset.busy === "1") return;
  btn.dataset.busy = "1";
  btn.disabled = true;

  try {
    await sendSelectedDateLogsToGoogleForm();
    alert("スプレッドシートに送信しました");
  } catch (e) {
    console.error(e);
    alert("送信に失敗しました");
  } finally {
    btn.disabled = false;
    btn.dataset.busy = "0";
  }
};








