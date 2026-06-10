const ALARM_NAME = "booth-product-check";
const MAX_PENDING_DISCORD_NOTIFICATIONS = 500;
if (typeof importScripts === "function") {
  importScripts("product-parser.js");
}

const ext = globalThis.browser || chrome;
let activeRun = null;
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

ext.runtime.onInstalled.addListener(() => {
  scheduleChecks();
  startRunCheck({ reason: "installed" });
});

ext.runtime.onStartup.addListener(() => {
  scheduleChecks();
  startRunCheck({ reason: "startup" });
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    startRunCheck({ reason: "alarm" });
  }
});

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CLEAR_BADGE") {
    clearBadge()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message?.type !== "RUN_CHECK_NOW") {
    return false;
  }

  const run = startRunCheck({ reason: "manual" });
  if (!run) {
    sendResponse({ ok: true, started: false, alreadyRunning: true });
    return false;
  }

  run
    .then((lastRun) => sendResponse({ ok: true, started: true, alreadyRunning: false, lastRun }))
    .catch((error) => sendResponse({ ok: false, message: error.message }));

  return true;
});

ext.storage.onChanged.addListener((changes, areaName) => {
  if ((areaName === "local" || areaName === "sync") && changes.settings) {
    scheduleChecks();
  }
});

async function scheduleChecks() {
  const settings = await getSettings();
  const periodInMinutes = Math.max(1, Number(settings.checkIntervalMinutes) || 30);

  await ext.alarms.clear(ALARM_NAME);
  await ext.alarms.create(ALARM_NAME, { periodInMinutes });
}

function startRunCheck({ reason } = {}) {
  if (activeRun) {
    console.info(`BOOTH新着チェックは既に実行中のため、${reason || "unknown"} 実行をスキップしました。`);
    return null;
  }

  activeRun = runCheckSafely({ reason })
    .finally(() => {
      activeRun = null;
    });

  return activeRun;
}

async function runCheckSafely({ reason } = {}) {
  try {
    return await runCheck({ reason });
  } catch (error) {
    console.error("BOOTH新着チェックに失敗しました。", error);
    return finishRun({
      checkedAt: new Date().toISOString(),
      reason,
      status: "error",
      message: error.message || "BOOTH新着チェックに失敗しました。",
      notifiedCount: 0,
      summary: emptySummary(),
      tags: []
    });
  }
}

async function runCheck({ reason } = {}) {
  const settings = await getSettings();
  const webhookUrl = settings.discordWebhookUrl.trim();
  const tags = normalizeTags(settings.boothTags);
  const searchPageLimit = normalizeSearchPageLimit(settings.searchPageLimit);
  const { monitorInitialized = false } = await ext.storage.local.get("monitorInitialized");
  const shouldBootstrapOnly = settings.skipInitialExistingProducts && !monitorInitialized;

  if (tags.length === 0) {
    return finishRun({
      checkedAt: new Date().toISOString(),
      reason,
      status: "skipped",
      message: "BOOTH タグが設定されていません。",
      notifiedCount: 0,
      summary: emptySummary(),
      tags: []
    });
  }

  if (settings.notifyDiscord && !webhookUrl) {
    return finishRun({
      checkedAt: new Date().toISOString(),
      reason,
      status: "skipped",
      message: "Discord通知が有効ですが、Webhook URLが設定されていません。",
      notifiedCount: 0,
      summary: emptySummary(),
      tags: []
    });
  }

  if (settings.notifyDiscord && !isDiscordWebhookUrl(webhookUrl)) {
    return finishRun({
      checkedAt: new Date().toISOString(),
      reason,
      status: "skipped",
      message: "Discord Webhook URL は https://discord.com/api/webhooks/ で始まる必要があります。",
      notifiedCount: 0,
      summary: emptySummary(),
      tags: []
    });
  }

  const seenIds = await getSeenProductIds();
  let notifiedCount = 0;
  const errors = [];
  const tagResults = [];
  const summary = emptySummary();
  let discordStopReason = "";

  await finishRun({
    checkedAt: new Date().toISOString(),
    reason,
    status: "running",
    message: "BOOTH新着チェックを実行中です。",
    notifiedCount: 0,
    summary,
    tags: []
  });

  if (settings.notifyDiscord) {
    const retryResult = await retryPendingDiscordNotifications(webhookUrl);
    if (retryResult.notifiedCount > 0) {
      summary.discordNotifiedCount += retryResult.notifiedCount;
      summary.pendingDiscordNotifiedCount += retryResult.notifiedCount;
    }

    if (retryResult.failedCount > 0) {
      summary.discordFailedCount += retryResult.failedCount;
      summary.pendingDiscordFailedCount += retryResult.failedCount;
    }

    if (retryResult.stopFurtherAttempts) {
      discordStopReason = retryResult.message;
      errors.push(`保留中のDiscord通知を停止しました: ${discordStopReason}`);
    }
  }

  for (const tag of tags) {
    const tagResult = {
      tag,
      fetchedCount: 0,
      newCount: 0,
      discordNotifiedCount: 0,
      discordFailedCount: 0,
      discordSkippedCount: 0,
      discordStopReason: "",
      sourceUrl: "",
      sourceUrls: [],
      fallbackFromUrl: "",
      fallbackFromUrls: [],
      adultSearchFallback: false,
      adultSearchBlocked: false,
      fetchedPageCount: 0,
      searchPageLimit,
      bootstrappedCount: 0
    };

    try {
      const {
        products,
        sourceUrl,
        sourceUrls,
        fallbackFromUrl,
        fallbackFromUrls,
        adultSearchFallback,
        adultSearchBlocked,
        fetchedPageCount
      } = await fetchProductsByTag(
        tag,
        settings.includeAdult,
        searchPageLimit
      );
      tagResult.sourceUrl = sourceUrl;
      tagResult.sourceUrls = sourceUrls;
      tagResult.fallbackFromUrl = fallbackFromUrl;
      tagResult.fallbackFromUrls = fallbackFromUrls;
      tagResult.adultSearchFallback = adultSearchFallback;
      tagResult.adultSearchBlocked = adultSearchBlocked;
      tagResult.fetchedPageCount = fetchedPageCount;
      tagResult.fetchedCount = products.length;
      summary.fetchedCount += products.length;

      if (adultSearchFallback) {
        summary.adultSearchFallbackCount += 1;
      }

      if (adultSearchBlocked) {
        summary.adultSearchBlockedCount += 1;
      }

      const unseenProducts = products.filter((product) => !seenIds.includes(product.id));

      if (shouldBootstrapOnly) {
        for (const product of unseenProducts) {
          seenIds.push(product.id);
        }
        tagResult.bootstrappedCount = unseenProducts.length;
        summary.bootstrappedCount += unseenProducts.length;
        await ext.storage.local.set({ seenProductIds: unique(seenIds) });
        tagResults.push(tagResult);
        await finishRun(buildRunningRun({ reason, summary, tagResults, notifiedCount, tags }));
        continue;
      }

      for (const product of unseenProducts) {
        tagResult.newCount += 1;
        summary.newCount += 1;

        seenIds.push(product.id);
        notifiedCount += 1;
      }

      const newlySeenProducts = unseenProducts.map((product) => ({
        ...product,
        tag,
        detectedAt: new Date().toISOString()
      }));
      const discordProducts = unseenProducts.map((product) => ({ ...product, tag }));

      await ext.storage.local.set({ seenProductIds: unique(seenIds) });
      await saveRecentProducts(newlySeenProducts, settings.recentProductsLimit);
      await updateBadge();

      if (settings.notifyDiscord && unseenProducts.length > 0) {
        if (discordStopReason) {
          tagResult.discordSkippedCount += unseenProducts.length;
          tagResult.discordStopReason = discordStopReason;
          summary.discordSkippedCount += unseenProducts.length;
          summary.pendingDiscordQueuedCount += await enqueuePendingDiscordNotifications(
            discordProducts,
            discordStopReason
          );
        } else {
          const discordResult = await sendDiscordNotifications(webhookUrl, discordProducts);
          tagResult.discordNotifiedCount += discordResult.notifiedCount;
          tagResult.discordFailedCount += discordResult.failedCount;
          summary.discordNotifiedCount += discordResult.notifiedCount;
          summary.discordFailedCount += discordResult.failedCount;

          if (discordResult.failedProducts.length > 0) {
            summary.pendingDiscordQueuedCount += await enqueuePendingDiscordNotifications(
              discordResult.failedProducts,
              discordResult.message
            );
          }

          if (discordResult.stopFurtherAttempts) {
            discordStopReason = discordResult.message;
            tagResult.discordStopReason = discordStopReason;
            errors.push(`Discord通知を停止しました: ${discordStopReason}`);
          }
        }
      }
    } catch (error) {
      errors.push(`${tag}: ${error.message}`);
    }

    tagResults.push(tagResult);
    await finishRun(buildRunningRun({ reason, summary, tagResults, notifiedCount, tags }));
  }

  if (shouldBootstrapOnly) {
    await ext.storage.local.set({ seenProductIds: unique(seenIds) });
    await ext.storage.local.set({ monitorInitialized: true });
  }
  await updateBadge();
  return finishRun({
    checkedAt: new Date().toISOString(),
    reason,
    status:
      errors.length > 0 || summary.discordFailedCount > 0
        ? "error"
        : "ok",
    message: buildRunMessage(errors, summary),
    notifiedCount,
    summary,
    tags: tagResults
  });
}

async function getSettings() {
  const [{ settings: localSettings }, { settings: syncedSettings }] = await Promise.all([
    ext.storage.local.get("settings"),
    ext.storage.sync.get("settings")
  ]);
  const settings = localSettings || syncedSettings || {};

  if (!localSettings && syncedSettings) {
    await ext.storage.local.set({ settings });
    await removeSyncedSettings();
  }

  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    boothTags: normalizeTags(settings?.boothTags),
    recentProductsLimit: normalizeRecentProductsLimit(settings?.recentProductsLimit),
    searchPageLimit: normalizeSearchPageLimit(settings?.searchPageLimit)
  };
}

async function removeSyncedSettings() {
  try {
    await ext.storage.sync.remove("settings");
  } catch (error) {
    console.warn("同期ストレージの設定削除に失敗しました。", error);
  }
}

async function getSeenProductIds() {
  const { seenProductIds } = await ext.storage.local.get("seenProductIds");
  return Array.isArray(seenProductIds) ? seenProductIds : [];
}

async function setLastRun(lastRun) {
  await ext.storage.local.set({ lastRun });
}

async function finishRun(lastRun) {
  await setLastRun(lastRun);
  return lastRun;
}

function buildRunningRun({ reason, summary, tagResults, notifiedCount, tags }) {
  return {
    checkedAt: new Date().toISOString(),
    reason,
    status: "running",
    message: `BOOTH新着チェックを実行中です。${tagResults.length}/${tags.length} タグを確認しました。`,
    notifiedCount,
    summary,
    tags: tagResults
  };
}

async function saveRecentProducts(products, limit) {
  if (products.length === 0) {
    return;
  }

  const recentProductsLimit = normalizeRecentProductsLimit(limit);
  const { recentProducts = [], unreadCount = 0 } = await ext.storage.local.get([
    "recentProducts",
    "unreadCount"
  ]);
  const recentProductIds = new Set(recentProducts.map((product) => product.id));
  const newProducts = products.filter((product) => !recentProductIds.has(product.id));
  if (newProducts.length === 0) {
    return;
  }

  const merged = [...newProducts, ...recentProducts.filter((product) => !newProducts.some((p) => p.id === product.id))]
    .slice(0, recentProductsLimit);

  await ext.storage.local.set({
    recentProducts: merged,
    unreadCount: unreadCount + newProducts.length
  });
}

async function retryPendingDiscordNotifications(webhookUrl) {
  const pendingNotifications = await getPendingDiscordNotifications();
  if (pendingNotifications.length === 0) {
    return {
      notifiedCount: 0,
      failedCount: 0,
      message: "",
      stopFurtherAttempts: false
    };
  }

  const sortedNotifications = [...pendingNotifications].sort((a, b) =>
    String(a.queuedAt || "").localeCompare(String(b.queuedAt || ""))
  );
  const result = await sendDiscordNotifications(webhookUrl, sortedNotifications);
  const failedKeys = new Set(result.failedProducts.map(getDiscordNotificationKey));
  const now = new Date().toISOString();
  const remainingNotifications = sortedNotifications
    .filter((notification) => failedKeys.has(getDiscordNotificationKey(notification)))
    .map((notification) => ({
      ...notification,
      attempts: (Number(notification.attempts) || 0) + 1,
      lastAttemptAt: now,
      lastError: result.message || notification.lastError || ""
    }));

  await setPendingDiscordNotifications(remainingNotifications);

  return {
    notifiedCount: result.notifiedCount,
    failedCount: remainingNotifications.length,
    message: result.message,
    stopFurtherAttempts: result.stopFurtherAttempts
  };
}

async function enqueuePendingDiscordNotifications(products, message) {
  if (products.length === 0) {
    return 0;
  }

  const pendingNotifications = await getPendingDiscordNotifications();
  const queuedAt = new Date().toISOString();
  const normalizedProducts = products
    .map((product) => normalizeDiscordNotification(product, { queuedAt, lastError: message }))
    .filter(Boolean);
  const normalizedKeys = new Set(normalizedProducts.map(getDiscordNotificationKey));
  const mergedNotifications = [
    ...pendingNotifications.filter((notification) => !normalizedKeys.has(getDiscordNotificationKey(notification))),
    ...normalizedProducts
  ];
  const cappedNotifications = mergedNotifications.slice(-MAX_PENDING_DISCORD_NOTIFICATIONS);

  await setPendingDiscordNotifications(cappedNotifications);
  const cappedKeys = new Set(cappedNotifications.map(getDiscordNotificationKey));
  return normalizedProducts.filter((product) => cappedKeys.has(getDiscordNotificationKey(product))).length;
}

async function getPendingDiscordNotifications() {
  const { pendingDiscordNotifications = [] } = await ext.storage.local.get("pendingDiscordNotifications");
  if (!Array.isArray(pendingDiscordNotifications)) {
    return [];
  }

  return pendingDiscordNotifications
    .map((notification) => normalizeDiscordNotification(notification))
    .filter(Boolean);
}

async function setPendingDiscordNotifications(notifications) {
  await ext.storage.local.set({
    pendingDiscordNotifications: notifications.slice(-MAX_PENDING_DISCORD_NOTIFICATIONS)
  });
}

function normalizeDiscordNotification(product, defaults = {}) {
  const id = String(product?.id || "").trim();
  const tag = String(product?.tag || "").trim();
  if (!id || !tag) {
    return null;
  }

  return {
    id,
    title: String(product.title || "無題の商品"),
    url: String(product.url || `https://booth.pm/ja/items/${id}`),
    price: String(product.price || "価格不明"),
    imageUrl: String(product.imageUrl || ""),
    isAdult: Boolean(product.isAdult),
    tag,
    queuedAt: String(product.queuedAt || defaults.queuedAt || new Date().toISOString()),
    attempts: Number(product.attempts) || 0,
    lastAttemptAt: String(product.lastAttemptAt || ""),
    lastError: String(defaults.lastError || product.lastError || "")
  };
}

function getDiscordNotificationKey(notification) {
  return `${notification.tag}\n${notification.id}`;
}

async function fetchProductsByTag(tag, includeAdult, searchPageLimit) {
  const primaryResult = await fetchProductsByTagPages(tag, includeAdult, searchPageLimit);

  if (!includeAdult || primaryResult.products.length > 0) {
    return { ...primaryResult, adultSearchFallback: false, adultSearchBlocked: false };
  }

  const fallbackResult = await fetchProductsByTagPages(tag, false, searchPageLimit);
  return {
    ...fallbackResult,
    fallbackFromUrl: primaryResult.sourceUrl,
    fallbackFromUrls: primaryResult.sourceUrls,
    adultSearchFallback: true,
    adultSearchBlocked: primaryResult.adultSearchBlocked
  };
}

async function fetchProductsByTagPages(tag, includeAdult, searchPageLimit) {
  const products = [];
  const sourceUrls = [];
  let adultSearchBlocked = false;
  let fetchedPageCount = 0;

  for (let page = 1; page <= searchPageLimit; page += 1) {
    const pageResult = await fetchProductsByTagUrl(buildBoothSearchUrl(tag, includeAdult, page));
    sourceUrls.push(pageResult.sourceUrl);
    fetchedPageCount += 1;

    if (pageResult.adultSearchBlocked) {
      adultSearchBlocked = true;
      break;
    }

    if (pageResult.products.length === 0) {
      break;
    }

    products.push(...pageResult.products);
  }

  return {
    products: uniqueProducts(products),
    sourceUrl: sourceUrls[0] || "",
    sourceUrls,
    fallbackFromUrl: "",
    fallbackFromUrls: [],
    adultSearchBlocked,
    fetchedPageCount
  };
}

async function fetchProductsByTagUrl(sourceUrl) {
  const response = await fetch(sourceUrl, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`BOOTHが ${response.status} を返しました。`);
  }

  const html = await response.text();
  if (isBoothAgeConfirmationPage(html)) {
    return { products: [], sourceUrl, fallbackFromUrl: "", adultSearchBlocked: true };
  }

  const products = await parseProductsInOffscreenDocument(html);
  return { products, sourceUrl, fallbackFromUrl: "", adultSearchBlocked: false };
}

function isBoothAgeConfirmationPage(html) {
  return html.includes("年齢確認") &&
    html.includes("あなたは18歳以上ですか") &&
    html.includes("js-approve-adult");
}

function buildBoothSearchUrl(tag, includeAdult, page = 1) {
  const params = new URLSearchParams();
  params.set("sort", "new");
  params.append("tags[]", tag);
  params.set("page", String(page));

  if (includeAdult) {
    params.set("adult", "include");
  }

  return `https://booth.pm/ja/items?${params.toString()}`;
}

function uniqueProducts(products) {
  const seenProductIds = new Set();
  return products.filter((product) => {
    if (seenProductIds.has(product.id)) {
      return false;
    }
    seenProductIds.add(product.id);
    return true;
  });
}

async function sendDiscordNotifications(webhookUrl, products) {
  let notifiedCount = 0;
  let failedCount = 0;
  const failedProducts = [];
  let message = "";
  let stopFurtherAttempts = false;

  for (let index = 0; index < products.length; index += 10) {
    const chunk = products.slice(index, index + 10);
    let result = await sendDiscordWebhook(
      webhookUrl,
      chunk.map(buildDiscordEmbed),
      chunk.length
    );

    if (result.status === 429 && result.retryAfterMs > 0 && result.retryAfterMs <= 5000) {
      await sleep(result.retryAfterMs);
      result = await sendDiscordWebhook(
        webhookUrl,
        chunk.map(buildDiscordEmbed),
        chunk.length
      );
    }

    if (result.ok) {
      notifiedCount += chunk.length;
      continue;
    }

    failedCount += chunk.length;
    message = result.message;

    if (shouldStopDiscordAttemptsAfterFailure(result)) {
      stopFurtherAttempts = true;
      failedProducts.push(...products.slice(index));
      break;
    }

    failedProducts.push(...chunk);
  }

  if (stopFurtherAttempts) {
    failedCount = failedProducts.length;
  }

  return { notifiedCount, failedCount, failedProducts, message, stopFurtherAttempts };
}

function shouldStopDiscordAttemptsAfterFailure(result) {
  return result.stopFurtherAttempts ||
    result.status === 429 ||
    result.status >= 500 ||
    !result.status;
}

function buildDiscordEmbed(product) {
  const embed = {
    title: `${product.isAdult ? "[成人向け] " : ""}${product.title}`.slice(0, 256),
    url: product.url,
    color: product.isAdult ? 0xd63b3b : 0xff6fae,
    fields: [
      { name: "価格", value: product.price.slice(0, 1024), inline: true },
      { name: "タグ", value: String(product.tag || "").slice(0, 1024), inline: true },
      { name: "区分", value: product.isAdult ? "成人向け" : "一般向け", inline: true }
    ],
    footer: { text: "BOOTH新着監視" }
  };

  if (product.imageUrl) {
    embed.thumbnail = { url: product.imageUrl };
  }

  return embed;
}

async function sendDiscordWebhook(webhookUrl, embeds, productCount) {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "BOOTH通知Bot",
        embeds
      })
    });

    if (response.ok) {
      return { ok: true };
    }

    const retryAfterMs = await getDiscordRetryAfterMs(response);
    const message = response.status === 429
      ? "Discord Webhook がレート制限を返しました。少し時間を置いて再実行してください。"
      : `Discord Webhook が ${response.status} を返しました。Webhook URL、削除状態、チャンネル権限を確認してください。`;
    return {
      ok: false,
      message,
      status: response.status,
      productCount,
      retryAfterMs,
      stopFurtherAttempts: [401, 403, 404].includes(response.status)
    };
  } catch (error) {
    return {
      ok: false,
      message: error.message || "Discord通知に失敗しました。",
      stopFurtherAttempts: false
    };
  }
}

async function getDiscordRetryAfterMs(response) {
  if (response.status !== 429) {
    return 0;
  }

  const retryAfterHeader = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0) {
    return Math.ceil(retryAfterHeader * 1000);
  }

  try {
    const body = await response.clone().json();
    const retryAfter = Number(body.retry_after);
    return Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter * 1000) : 0;
  } catch (error) {
    return 0;
  }
}

async function updateBadge() {
  const { unreadCount = 0 } = await ext.storage.local.get("unreadCount");
  await getActionApi().setBadgeBackgroundColor({ color: "#e75493" });
  await getActionApi().setBadgeText({
    text: unreadCount > 0 ? String(Math.min(unreadCount, 99)) : ""
  });
}

async function clearBadge() {
  await ext.storage.local.set({ unreadCount: 0 });
  await getActionApi().setBadgeText({ text: "" });
}

async function parseProductsInOffscreenDocument(html) {
  if (typeof DOMParser !== "undefined") {
    return parseProductsFromHtml(html);
  }

  await ensureOffscreenDocument();
  const response = await ext.runtime.sendMessage({
    type: "PARSE_PRODUCTS",
    html
  });

  if (!response?.ok) {
    throw new Error(response?.message || "BOOTH商品の解析に失敗しました。");
  }

  return response.products;
}

async function ensureOffscreenDocument() {
  if (!ext.offscreen || !ext.runtime.getContexts) {
    throw new Error("このブラウザではDOMParserまたはoffscreen documentが利用できません。");
  }

  const offscreenUrl = ext.runtime.getURL("src/offscreen.html");
  const contexts = await ext.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) {
    return;
  }

  await ext.offscreen.createDocument({
    url: "src/offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "BOOTH検索結果のHTMLを拡張機能内で解析するため。"
  });
}

function unique(values) {
  return Array.from(new Set(values));
}

function getActionApi() {
  return ext.action || ext.browserAction;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTags(tags) {
  const rawTags = Array.isArray(tags) ? tags : [];

  return rawTags
    .flatMap((tag) => String(tag).split(/[\n,、]/))
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeSearchPageLimit(value) {
  const pageLimit = Number(value) || DEFAULT_SETTINGS.searchPageLimit;
  return Math.min(5, Math.max(1, Math.floor(pageLimit)));
}

function normalizeRecentProductsLimit(value) {
  const productsLimit = Number(value) || DEFAULT_SETTINGS.recentProductsLimit;
  return Math.min(500, Math.max(20, Math.floor(productsLimit)));
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

function emptySummary() {
  return {
    fetchedCount: 0,
    newCount: 0,
    discordNotifiedCount: 0,
    discordFailedCount: 0,
    discordSkippedCount: 0,
    adultSearchFallbackCount: 0,
    adultSearchBlockedCount: 0,
    bootstrappedCount: 0,
    pendingDiscordNotifiedCount: 0,
    pendingDiscordFailedCount: 0,
    pendingDiscordQueuedCount: 0
  };
}

function buildRunMessage(errors, summary) {
  const messages = [...errors];

  if (summary.adultSearchBlockedCount > 0) {
    messages.push(
      `BOOTH の年齢確認が未完了のため、成人向け商品は ${summary.adultSearchBlockedCount} タグで検索できませんでした。通常検索の結果だけ取得しました。`
    );
  }

  const normalFallbackCount = summary.adultSearchFallbackCount - summary.adultSearchBlockedCount;
  if (normalFallbackCount > 0) {
    messages.push(
      `成人向け検索で結果が 0 件だったため、通常検索へ ${normalFallbackCount} 件フォールバックしました。`
    );
  }

  if (summary.bootstrappedCount > 0) {
    messages.push(
      `既存商品 ${summary.bootstrappedCount} 件を通知せずに既読として登録しました。`
    );
  }

  if (summary.discordFailedCount > 0) {
    messages.push(`Discord通知 ${summary.discordFailedCount} 件に失敗しました。`);
  }

  if (summary.discordSkippedCount > 0) {
    messages.push(`Discord通知 ${summary.discordSkippedCount} 件をスキップしました。`);
  }

  if (summary.pendingDiscordNotifiedCount > 0) {
    messages.push(`保留中のDiscord通知 ${summary.pendingDiscordNotifiedCount} 件を再送しました。`);
  }

  if (summary.pendingDiscordQueuedCount > 0) {
    messages.push(`Discord通知に失敗した ${summary.pendingDiscordQueuedCount} 件を次回再送します。`);
  }

  return messages.join("\n");
}
