const DEFAULT_SETTINGS = {
  boothTags: [],
  checkIntervalMinutes: 30,
  discordWebhookUrl: "",
  includeAdult: true,
  notifyBrowser: true,
  notifyDiscord: true
};

const form = document.querySelector("#settings-form");
const webhookUrlInput = document.querySelector("#discord-webhook-url");
const tagsInput = document.querySelector("#booth-tags");
const intervalInput = document.querySelector("#check-interval-minutes");
const includeAdultInput = document.querySelector("#include-adult");
const notifyDiscordInput = document.querySelector("#notify-discord");
const notifyBrowserInput = document.querySelector("#notify-browser");
const runNowButton = document.querySelector("#run-now");
const resetSeenButton = document.querySelector("#reset-seen");
const statusOutput = document.querySelector("#status");
const lastRunOutput = document.querySelector("#last-run");

document.addEventListener("DOMContentLoaded", restoreOptions);
form.addEventListener("submit", saveOptions);
runNowButton.addEventListener("click", runNow);
resetSeenButton.addEventListener("click", resetSeenProducts);

async function restoreOptions() {
  const { settings } = await chrome.storage.sync.get("settings");
  const { lastRun } = await chrome.storage.local.get("lastRun");
  const currentSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };

  webhookUrlInput.value = currentSettings.discordWebhookUrl;
  tagsInput.value = currentSettings.boothTags.join("\n");
  intervalInput.value = currentSettings.checkIntervalMinutes;
  includeAdultInput.checked = currentSettings.includeAdult;
  notifyDiscordInput.checked = currentSettings.notifyDiscord;
  notifyBrowserInput.checked = currentSettings.notifyBrowser;
  lastRunOutput.textContent = lastRun ? JSON.stringify(lastRun, null, 2) : "No run yet.";
}

async function saveOptions(event) {
  event.preventDefault();

  const settings = {
    discordWebhookUrl: webhookUrlInput.value.trim(),
    boothTags: tagsInput.value
      .split("\n")
      .map((tag) => tag.trim())
      .filter(Boolean),
    checkIntervalMinutes: Math.max(1, Number(intervalInput.value) || 30),
    includeAdult: includeAdultInput.checked,
    notifyBrowser: notifyBrowserInput.checked,
    notifyDiscord: notifyDiscordInput.checked
  };

  await chrome.storage.sync.set({ settings });
  showStatus("保存しました。");
}

async function runNow() {
  const response = await chrome.runtime.sendMessage({ type: "RUN_CHECK_NOW" });
  if (response?.ok) {
    await restoreOptions();
    showStatus("実行しました。");
    return;
  }

  showStatus(response?.message || "実行に失敗しました。");
}

async function resetSeenProducts() {
  await chrome.storage.local.set({ seenProductIds: [] });
  showStatus("通知済み履歴をリセットしました。");
}

function showStatus(message) {
  statusOutput.textContent = message;
  setTimeout(() => {
    statusOutput.textContent = "";
  }, 3000);
}
