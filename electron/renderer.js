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

const PREFERENCES_STORAGE_KEY = "desktop-log-preferences";

function readStoredPreferences() {
  try {
    const raw = window.localStorage?.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch (error) {
    console.warn("[preferences] Failed to read stored preferences", error);
    return {};
  }
}

let storedPreferences = readStoredPreferences();

function persistPreferences(patch) {
  storedPreferences = { ...storedPreferences, ...patch };
  try {
    window.localStorage?.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify(storedPreferences),
    );
  } catch (error) {
    console.warn("[preferences] Failed to persist preferences", error);
  }
}

const INFO_MESSAGE_LIGHTNESS_START = 0.5;

const state = {
  paused: false,
  autoScroll:
    typeof storedPreferences.autoScroll === "boolean"
      ? storedPreferences.autoScroll
      : true,
  colorMessages:
    typeof storedPreferences.colorMessages === "boolean"
      ? storedPreferences.colorMessages
      : false,
  filters: new Set(["messages", "http", "desktop"]),
  logs: [],
};

function scrollToBottom(reason = "unknown") {
  if (!logContainer) {
    console.warn("[scrollToBottom] Missing log container", { reason });
    return;
  }

  if (!state.autoScroll) {
    console.debug("[scrollToBottom] Skipped because auto-scroll is disabled", {
      reason,
      scrollTop: logContainer.scrollTop,
      scrollHeight: logContainer.scrollHeight,
      clientHeight: logContainer.clientHeight,
    });
    return;
  }

  const before = {
    scrollTop: logContainer.scrollTop,
    scrollHeight: logContainer.scrollHeight,
    clientHeight: logContainer.clientHeight,
  };

  requestAnimationFrame(() => {
    const lastEntry = logContainer.lastElementChild;
    if (lastEntry instanceof HTMLElement) {
      lastEntry.scrollIntoView({ block: "end" });
    }
    logContainer.scrollTop = logContainer.scrollHeight;
    const after = {
      scrollTop: logContainer.scrollTop,
      scrollHeight: logContainer.scrollHeight,
      clientHeight: logContainer.clientHeight,
    };
    console.debug("[scrollToBottom] Applied", { reason, before, after, hasEntry: Boolean(lastEntry) });
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

function hashStringToUnitInterval(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0; // Convert to 32bit integer
  }
  return (hash >>> 0) / 0xffffffff;
}

function resolveInfoMessageColor(message) {
  if (!message) {
    return null;
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }

  const firstWhitespaceIndex = trimmed.search(/\s/);
  const identifier =
    firstWhitespaceIndex === -1 ? trimmed : trimmed.slice(0, firstWhitespaceIndex);
  if (!identifier) {
    return null;
  }

  const normalized = hashStringToUnitInterval(identifier);
  const start = Math.max(0, Math.min(1, INFO_MESSAGE_LIGHTNESS_START));
  const component = Math.round(255 * (start + (1 - start) * normalized));
  const clamped = Math.max(0, Math.min(255, component));
  const componentHex = clamped.toString(16).padStart(2, "0");
  return `#${componentHex}${componentHex}${componentHex}`;
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
  if (entry.level === "info" || entry.level === "verbose") {
    const infoColor = resolveInfoMessageColor(entry.message);
    if (infoColor) {
      messageElement.style.setProperty("--message-color", infoColor);
    } else {
      messageElement.style.removeProperty("--message-color");
    }
  } else {
    messageElement.style.removeProperty("--message-color");
  }
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
  scrollToBottom("renderAll");
}

function handleLog(entry) {
  state.logs.push(entry);
  if (state.paused) {
    console.debug("[handleLog] Received log while paused", entry);
    return;
  }
  renderEntry(entry);
  scrollToBottom("handleLog");
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
    console.debug("[autoscroll] Enabled");
    scrollToBottom("autoScrollToggle");
  } else {
    console.debug("[autoscroll] Disabled");
  }
  persistPreferences({ autoScroll: state.autoScroll });
});

colorMessagesToggle.addEventListener("change", () => {
  state.colorMessages = colorMessagesToggle.checked;
  logContainer.classList.toggle("color-messages", state.colorMessages);
  persistPreferences({ colorMessages: state.colorMessages });
});

desktopBridge.onLog(handleLog);
desktopBridge.onBotState((stateInfo) => {
  updateStatus(stateInfo.running);
});

window.addEventListener("DOMContentLoaded", () => {
  updateStatus(false);
  renderAll();
  autoScrollToggle.checked = state.autoScroll;
  colorMessagesToggle.checked = state.colorMessages;
  logContainer.classList.toggle("color-messages", state.colorMessages);
  desktopBridge.notifyReady();
});
