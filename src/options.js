const DEFAULT_SETTINGS = {
  boothTags: [],
  checkIntervalMinutes: 30,
  discordWebhookUrl: "",
  includeAdult: false,
  notifyDiscord: true,
  recentProductsLimit: 100,
  searchPageLimit: 1,
  skipInitialExistingProducts: true
};
const ext = globalThis.browser || chrome;

const form = document.querySelector("#settings-form");
const webhookUrlInput = document.querySelector("#discord-webhook-url");
const tagsInput = document.querySelector("#booth-tags");
const intervalInput = document.querySelector("#check-interval-minutes");
const searchPageLimitInput = document.querySelector("#search-page-limit");
const recentProductsLimitInput = document.querySelector("#recent-products-limit");
const includeAdultInput = document.querySelector("#include-adult");
const skipInitialExistingProductsInput = document.querySelector("#skip-initial-existing-products");
const notifyDiscordInput = document.querySelector("#notify-discord");
const runNowButton = document.querySelector("#run-now");
const resetSeenButton = document.querySelector("#reset-seen");
const statusOutput = document.querySelector("#status");
const lastRunOutput = document.querySelector("#last-run");

document.addEventListener("DOMContentLoaded", restoreOptions);
form.addEventListener("submit", saveOptions);
runNowButton.addEventListener("click", runNow);
resetSeenButton.addEventListener("click", resetSeenProducts);

async function restoreOptions() {
  const currentSettings = await getSettings();
  const { lastRun } = await ext.storage.local.get("lastRun");

  webhookUrlInput.value = currentSettings.discordWebhookUrl;
  tagsInput.value = normalizeTags(currentSettings.boothTags).join("\n");
  intervalInput.value = currentSettings.checkIntervalMinutes;
  searchPageLimitInput.value = normalizeSearchPageLimit(currentSettings.searchPageLimit);
  recentProductsLimitInput.value = normalizeRecentProductsLimit(currentSettings.recentProductsLimit);
  includeAdultInput.checked = currentSettings.includeAdult;
  skipInitialExistingProductsInput.checked = currentSettings.skipInitialExistingProducts;
  notifyDiscordInput.checked = currentSettings.notifyDiscord;
  lastRunOutput.textContent = lastRun ? JSON.stringify(lastRun, null, 2) : "まだ実行されていません。";
}

async function saveOptions(event) {
  event.preventDefault();
  try {
    await saveCurrentOptions();
    showStatus("保存しました。");
  } catch (error) {
    showStatus(error.message);
  }
}

async function saveCurrentOptions() {
  const previousSettings = await getSettings();
  const previousTags = normalizeTags(previousSettings?.boothTags);
  const settings = {
    discordWebhookUrl: webhookUrlInput.value.trim(),
    boothTags: normalizeTags(tagsInput.value.split("\n")),
    checkIntervalMinutes: Math.max(1, Number(intervalInput.value) || 30),
    searchPageLimit: normalizeSearchPageLimit(searchPageLimitInput.value),
    recentProductsLimit: normalizeRecentProductsLimit(recentProductsLimitInput.value),
    includeAdult: includeAdultInput.checked,
    skipInitialExistingProducts: skipInitialExistingProductsInput.checked,
    notifyDiscord: notifyDiscordInput.checked
  };

  if (settings.notifyDiscord && settings.discordWebhookUrl && !isDiscordWebhookUrl(settings.discordWebhookUrl)) {
    throw new Error("Discord Webhook URL は https://discord.com/api/webhooks/ で始まる必要があります。");
  }

  await ext.storage.local.set({ settings });
  await trimRecentProducts(settings.recentProductsLimit);
  await removeSyncedSettings();
  if (tagsChanged(previousTags, settings.boothTags)) {
    await ext.storage.local.set({ monitorInitialized: false });
  }
  return settings;
}

async function getSettings() {
  const [{ settings: localSettings }, { settings: syncedSettings }] = await Promise.all([
    ext.storage.local.get("settings"),
    ext.storage.sync.get("settings")
  ]);

  if (localSettings) {
    return { ...DEFAULT_SETTINGS, ...localSettings };
  }

  if (syncedSettings) {
    const settings = { ...DEFAULT_SETTINGS, ...syncedSettings };
    await ext.storage.local.set({ settings });
    await removeSyncedSettings();
    return settings;
  }

  return { ...DEFAULT_SETTINGS };
}

async function removeSyncedSettings() {
  try {
    await ext.storage.sync.remove("settings");
  } catch (error) {
    console.warn("同期ストレージの設定削除に失敗しました。", error);
  }
}

function tagsChanged(previousTags, nextTags) {
  return previousTags.join("\n") !== nextTags.join("\n");
}

function normalizeTags(tags) {
  const rawTags = Array.isArray(tags) ? tags : [];

  return rawTags
    .flatMap((tag) => String(tag).split(/[\n,、]/))
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function isDiscordWebhookUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "https:" &&
      parsedUrl.hostname === "discord.com" &&
      parsedUrl.pathname.startsWith("/api/webhooks/");
  } catch (error) {
    return false;
  }
}

async function runNow() {
  try {
    await saveCurrentOptions();
  } catch (error) {
    showStatus(error.message);
    return;
  }

  let response;
  try {
    response = await ext.runtime.sendMessage({ type: "RUN_CHECK_NOW" });
  } catch (error) {
    showStatus(error.message || "実行の開始に失敗しました。");
    return;
  }

  if (response?.ok) {
    if (response.alreadyRunning) {
      showStatus("既に実行中です。完了後に最終実行結果が更新されます。");
      return;
    }

    showStatus("実行を開始しました。完了後に最終実行結果が更新されます。");
    return;
  }

  showStatus(response?.message || "実行に失敗しました。");
}

async function resetSeenProducts() {
  await ext.storage.local.set({
    seenProductIds: [],
    monitorInitialized: false,
    recentProducts: [],
    unreadCount: 0
  });
  showStatus("通知済み履歴をリセットしました。");
}

function normalizeSearchPageLimit(value) {
  const pageLimit = Number(value) || DEFAULT_SETTINGS.searchPageLimit;
  return Math.min(5, Math.max(1, Math.floor(pageLimit)));
}

function normalizeRecentProductsLimit(value) {
  const productsLimit = Number(value) || DEFAULT_SETTINGS.recentProductsLimit;
  return Math.min(500, Math.max(20, Math.floor(productsLimit)));
}

async function trimRecentProducts(limit) {
  const { recentProducts = [] } = await ext.storage.local.get("recentProducts");
  if (!Array.isArray(recentProducts) || recentProducts.length <= limit) {
    return;
  }
  await ext.storage.local.set({ recentProducts: recentProducts.slice(0, limit) });
}

function showStatus(message) {
  statusOutput.textContent = message;
  setTimeout(() => {
    statusOutput.textContent = "";
  }, 3000);
}
