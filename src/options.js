const DEFAULT_SETTINGS = {
  boothTags: [],
  checkIntervalMinutes: 30,
  discordWebhookUrl: "",
  includeAdult: false,
  browserNotificationMode: "summary",
  notifyBrowser: true,
  notifyDiscord: true
};
const ext = globalThis.browser || chrome;

const form = document.querySelector("#settings-form");
const webhookUrlInput = document.querySelector("#discord-webhook-url");
const tagsInput = document.querySelector("#booth-tags");
const intervalInput = document.querySelector("#check-interval-minutes");
const includeAdultInput = document.querySelector("#include-adult");
const browserNotificationModeInput = document.querySelector("#browser-notification-mode");
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
  const { settings } = await ext.storage.sync.get("settings");
  const { lastRun } = await ext.storage.local.get("lastRun");
  const currentSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };

  webhookUrlInput.value = currentSettings.discordWebhookUrl;
  tagsInput.value = normalizeTags(currentSettings.boothTags).join("\n");
  intervalInput.value = currentSettings.checkIntervalMinutes;
  includeAdultInput.checked = currentSettings.includeAdult;
  browserNotificationModeInput.value = currentSettings.browserNotificationMode || "summary";
  notifyDiscordInput.checked = currentSettings.notifyDiscord;
  notifyBrowserInput.checked = currentSettings.notifyBrowser;
  lastRunOutput.textContent = lastRun ? JSON.stringify(lastRun, null, 2) : "No run yet.";
}

async function saveOptions(event) {
  event.preventDefault();
  await saveCurrentOptions();
  showStatus("保存しました。");
}

async function saveCurrentOptions() {
  const settings = {
    discordWebhookUrl: webhookUrlInput.value.trim(),
    boothTags: normalizeTags(tagsInput.value.split("\n")),
    checkIntervalMinutes: Math.max(1, Number(intervalInput.value) || 30),
    includeAdult: includeAdultInput.checked,
    browserNotificationMode: browserNotificationModeInput.value,
    notifyBrowser: notifyBrowserInput.checked,
    notifyDiscord: notifyDiscordInput.checked
  };

  await ext.storage.sync.set({ settings });
  return settings;
}

function normalizeTags(tags) {
  const rawTags = Array.isArray(tags) ? tags : [];

  return rawTags
    .flatMap((tag) => String(tag).split(/[\n,、]/))
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function runNow() {
  await saveCurrentOptions();
  const response = await ext.runtime.sendMessage({ type: "RUN_CHECK_NOW" });
  if (response?.ok) {
    await restoreOptions();
    showStatus("実行しました。");
    return;
  }

  showStatus(response?.message || "実行に失敗しました。");
}

async function resetSeenProducts() {
  await ext.storage.local.set({ seenProductIds: [] });
  showStatus("通知済み履歴をリセットしました。");
}

function showStatus(message) {
  statusOutput.textContent = message;
  setTimeout(() => {
    statusOutput.textContent = "";
  }, 3000);
}
