const ALARM_NAME = "booth-product-check";
if (typeof importScripts === "function") {
  importScripts("product-parser.js");
}

const ext = globalThis.browser || chrome;
const RECENT_PRODUCTS_LIMIT = 100;
const DEFAULT_SETTINGS = {
  boothTags: [],
  checkIntervalMinutes: 30,
  discordWebhookUrl: "",
  includeAdult: false,
  notifyDiscord: true,
  skipInitialExistingProducts: true
};

ext.runtime.onInstalled.addListener(() => {
  scheduleChecks();
  runCheck({ reason: "installed" });
});

ext.runtime.onStartup.addListener(() => {
  scheduleChecks();
  runCheck({ reason: "startup" });
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runCheck({ reason: "alarm" });
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

  runCheck({ reason: "manual" })
    .then(() => sendResponse({ ok: true }))
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

async function runCheck({ reason } = {}) {
  const settings = await getSettings();
  const webhookUrl = settings.discordWebhookUrl.trim();
  const tags = normalizeTags(settings.boothTags);
  const { monitorInitialized = false } = await ext.storage.local.get("monitorInitialized");
  const shouldBootstrapOnly = settings.skipInitialExistingProducts && !monitorInitialized;

  if (tags.length === 0) {
    await setLastRun({
      checkedAt: new Date().toISOString(),
      reason,
      status: "skipped",
      message: "BOOTHタグが設定されていません。",
      notifiedCount: 0,
      summary: emptySummary(),
      tags: []
    });
    return;
  }

  if (settings.notifyDiscord && !webhookUrl) {
    await setLastRun({
      checkedAt: new Date().toISOString(),
      reason,
      status: "skipped",
      message: "Discord通知が有効ですが、Webhook URLが設定されていません。",
      notifiedCount: 0,
      summary: emptySummary(),
      tags: []
    });
    return;
  }

  if (settings.notifyDiscord && !isDiscordWebhookUrl(webhookUrl)) {
    await setLastRun({
      checkedAt: new Date().toISOString(),
      reason,
      status: "skipped",
      message: "Discord Webhook URL は https://discord.com/api/webhooks/ で始まる必要があります。",
      notifiedCount: 0,
      summary: emptySummary(),
      tags: []
    });
    return;
  }

  const seenIds = await getSeenProductIds();
  let notifiedCount = 0;
  const errors = [];
  const newlySeenProducts = [];
  const tagResults = [];
  const summary = emptySummary();

  for (const tag of tags) {
    const tagResult = {
      tag,
      fetchedCount: 0,
      newCount: 0,
      discordNotifiedCount: 0,
      discordFailedCount: 0,
      sourceUrl: "",
      fallbackFromUrl: "",
      adultSearchFallback: false,
      bootstrappedCount: 0
    };

    try {
      const { products, sourceUrl, fallbackFromUrl, adultSearchFallback } = await fetchProductsByTag(
        tag,
        settings.includeAdult
      );
      tagResult.sourceUrl = sourceUrl;
      tagResult.fallbackFromUrl = fallbackFromUrl;
      tagResult.adultSearchFallback = adultSearchFallback;
      tagResult.fetchedCount = products.length;
      summary.fetchedCount += products.length;

      if (adultSearchFallback) {
        summary.adultSearchFallbackCount += 1;
      }

      if (shouldBootstrapOnly) {
        const unseenProducts = products.filter((product) => !seenIds.includes(product.id));
        for (const product of unseenProducts) {
          seenIds.push(product.id);
        }
        tagResult.bootstrappedCount = unseenProducts.length;
        summary.bootstrappedCount += unseenProducts.length;
        await sleep(2000);
        tagResults.push(tagResult);
        continue;
      }

      for (const product of products) {
        if (seenIds.includes(product.id)) {
          continue;
        }

        tagResult.newCount += 1;
        summary.newCount += 1;

        const discordNotified = settings.notifyDiscord
          ? await sendDiscordNotification(webhookUrl, product, tag)
          : false;

        if (discordNotified) {
          tagResult.discordNotifiedCount += 1;
          summary.discordNotifiedCount += 1;
        }

        if (settings.notifyDiscord && !discordNotified) {
          tagResult.discordFailedCount += 1;
          summary.discordFailedCount += 1;
        }

        seenIds.push(product.id);
        newlySeenProducts.push({ ...product, tag, detectedAt: new Date().toISOString() });
        notifiedCount += 1;
        await sleep(1000);
      }

      await sleep(2000);
    } catch (error) {
      errors.push(`${tag}: ${error.message}`);
    }

    tagResults.push(tagResult);
  }

  await ext.storage.local.set({ seenProductIds: unique(seenIds) });
  if (shouldBootstrapOnly) {
    await ext.storage.local.set({ monitorInitialized: true });
  }
  await saveRecentProducts(newlySeenProducts);
  await updateBadge();
  await setLastRun({
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
    boothTags: normalizeTags(settings?.boothTags)
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

async function saveRecentProducts(products) {
  if (products.length === 0) {
    return;
  }

  const { recentProducts = [], unreadCount = 0 } = await ext.storage.local.get([
    "recentProducts",
    "unreadCount"
  ]);
  const merged = [...products, ...recentProducts.filter((product) => !products.some((p) => p.id === product.id))]
    .slice(0, RECENT_PRODUCTS_LIMIT);

  await ext.storage.local.set({
    recentProducts: merged,
    unreadCount: unreadCount + products.length
  });
}

async function fetchProductsByTag(tag, includeAdult) {
  const primaryResult = await fetchProductsByTagUrl(buildBoothSearchUrl(tag, includeAdult));

  if (!includeAdult || primaryResult.products.length > 0) {
    return { ...primaryResult, adultSearchFallback: false };
  }

  const fallbackResult = await fetchProductsByTagUrl(buildBoothSearchUrl(tag, false));
  return {
    ...fallbackResult,
    fallbackFromUrl: primaryResult.sourceUrl,
    adultSearchFallback: true
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
  const products = await parseProductsInOffscreenDocument(html);
  return { products, sourceUrl, fallbackFromUrl: "" };
}

function buildBoothSearchUrl(tag, includeAdult) {
  const params = new URLSearchParams();
  params.set("sort", "new");
  params.append("tags[]", tag);

  if (includeAdult) {
    params.set("adult", "include");
  }

  return `https://booth.pm/ja/items?${params.toString()}`;
}

async function sendDiscordNotification(webhookUrl, product, tag) {
  const embed = {
    title: `${product.isAdult ? "[成人向け] " : ""}${product.title}`.slice(0, 256),
    url: product.url,
    color: product.isAdult ? 0xd63b3b : 0xff6fae,
    fields: [
      { name: "価格", value: product.price.slice(0, 1024), inline: true },
      { name: "タグ", value: tag.slice(0, 1024), inline: true },
      { name: "区分", value: product.isAdult ? "成人向け" : "一般向け", inline: true }
    ],
    footer: { text: "BOOTH新着監視" }
  };

  if (product.imageUrl) {
    embed.thumbnail = { url: product.imageUrl };
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "BOOTH通知Bot",
      embeds: [embed]
    })
  });

  return response.ok;
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
    adultSearchFallbackCount: 0,
    bootstrappedCount: 0
  };
}

function buildRunMessage(errors, summary) {
  const messages = [...errors];

  if (summary.adultSearchFallbackCount > 0) {
    messages.push(
      `成人向け検索で結果が0件だったため、通常検索へ ${summary.adultSearchFallbackCount} 件フォールバックしました。BOOTHへのログイン状態と成人向け表示設定を確認してください。`
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

  return messages.join("\n");
}
