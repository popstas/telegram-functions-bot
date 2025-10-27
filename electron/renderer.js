const logContainer = document.getElementById("log-container");
const template = document.getElementById("log-line-template");
const statusElement = document.getElementById("bot-status");
const toggleRunButton = document.getElementById("toggle-run");
const toggleWindowButton = document.getElementById("toggle-window");
const openLogsButton = document.getElementById("open-logs");
const pauseButton = document.getElementById("pause");
const clearButton = document.getElementById("clear");
const autoScrollToggle = document.getElementById("autoscroll");
const colorMessagesToggle = document.getElementById("color-messages");
const filterCheckboxes = Array.from(document.querySelectorAll(".filters input[type='checkbox']"));

const desktopBridge = window.desktop ?? {
  onLog: () => () => {},
  onBotState: () => () => {},
  toggleBot: async () => {},
  openLogsFolder: async () => {},
  toggleWindow: async () => {},
  notifyReady: () => {},
};

if (!window.desktop) {
  console.error("Desktop preload bridge unavailable. Renderer controls will be no-ops.");
}

const state = {
  paused: false,
  autoScroll: true,
  colorMessages: false,
  filters: new Set(["messages", "desktop"]),
  logs: [],
};

function scrollToBottom() {
  if (!state.autoScroll) return;
  requestAnimationFrame(() => {
    logContainer.scrollTop = logContainer.scrollHeight;
  });
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "";
  const normalized = timestamp.includes("T") ? timestamp : timestamp.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  const seconds = `${date.getSeconds()}`.padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function renderEntry(entry) {
  if (!state.filters.has(entry.source)) {
    return;
  }
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.source = entry.source;
  const timestampElement = node.querySelector(".log-timestamp");
  timestampElement.textContent = formatTimestamp(entry.timestamp);
  timestampElement.dataset.level = entry.level;
  const levelElement = node.querySelector(".log-level");
  levelElement.textContent = entry.level.toUpperCase();
  levelElement.dataset.level = entry.level;
  const messageElement = node.querySelector(".log-message");
  messageElement.textContent = entry.message;
  messageElement.dataset.level = entry.level;
  logContainer.appendChild(node);
}

function renderAll() {
  logContainer.innerHTML = "";
  if (!state.logs.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Logs will appear here as the bot runs.";
    logContainer.appendChild(empty);
    return;
  }
  state.logs.forEach((entry) => {
    renderEntry(entry);
  });
  scrollToBottom();
}

function handleLog(entry) {
  state.logs.push(entry);
  if (state.paused) return;
  renderEntry(entry);
  scrollToBottom();
}

function updateStatus(running) {
  statusElement.textContent = running ? "running" : "stopped";
  statusElement.parentElement.dataset.state = running ? "running" : "stopped";
  toggleRunButton.textContent = running ? "Stop" : "Start";
}

filterCheckboxes.forEach((checkbox) => {
  checkbox.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.checked) {
      state.filters.add(target.dataset.source);
    } else {
      state.filters.delete(target.dataset.source);
    }
    renderAll();
  });
});

toggleRunButton.addEventListener("click", () => {
  desktopBridge.toggleBot();
});

toggleWindowButton.addEventListener("click", () => {
  desktopBridge.toggleWindow();
});

openLogsButton.addEventListener("click", () => {
  desktopBridge.openLogsFolder();
});

pauseButton.addEventListener("click", () => {
  state.paused = !state.paused;
  pauseButton.textContent = state.paused ? "Resume" : "Pause";
  if (!state.paused) {
    renderAll();
  }
});

clearButton.addEventListener("click", () => {
  state.logs = [];
  renderAll();
});

autoScrollToggle.addEventListener("change", () => {
  state.autoScroll = autoScrollToggle.checked;
  if (state.autoScroll) {
    scrollToBottom();
  }
});

colorMessagesToggle.addEventListener("change", () => {
  state.colorMessages = colorMessagesToggle.checked;
  logContainer.classList.toggle("color-messages", state.colorMessages);
});

desktopBridge.onLog(handleLog);
desktopBridge.onBotState((stateInfo) => {
  updateStatus(stateInfo.running);
});

window.addEventListener("DOMContentLoaded", () => {
  updateStatus(false);
  renderAll();
  state.colorMessages = colorMessagesToggle.checked;
  logContainer.classList.toggle("color-messages", state.colorMessages);
  desktopBridge.notifyReady();
});
