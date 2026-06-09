const ALARM_NAME = "booth-product-check";
const DEFAULT_SETTINGS = {
  boothTags: [],
  checkIntervalMinutes: 30,
  discordWebhookUrl: "",
  includeAdult: false,
  notifyBrowser: true,
  notifyDiscord: true
};
const NOTIFICATION_ICON_URL = chrome.runtime.getURL("icons/notification-128.png");

chrome.runtime.onInstalled.addListener(() => {
  scheduleChecks();
  runCheck({ reason: "installed" });
});

chrome.runtime.onStartup.addListener(() => {
  scheduleChecks();
  runCheck({ reason: "startup" });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runCheck({ reason: "alarm" });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RUN_CHECK_NOW") {
    return false;
  }

  runCheck({ reason: "manual" })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, message: error.message }));

  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.settings) {
    scheduleChecks();
  }
});

async function scheduleChecks() {
  const settings = await getSettings();
  const periodInMinutes = Math.max(1, Number(settings.checkIntervalMinutes) || 30);

  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes });
}

async function runCheck({ reason } = {}) {
  const settings = await getSettings();
  const webhookUrl = settings.discordWebhookUrl.trim();
  const tags = normalizeTags(settings.boothTags);

  if (tags.length === 0 || (!settings.notifyDiscord && !settings.notifyBrowser)) {
    await setLastRun({
      checkedAt: new Date().toISOString(),
      reason,
      status: "skipped",
      message: "BOOTH tags or notification destinations are not configured.",
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
      message: "Discord notification is enabled, but Webhook URL is not configured.",
      notifiedCount: 0,
      summary: emptySummary(),
      tags: []
    });
    return;
  }

  const seenIds = await getSeenProductIds();
  let notifiedCount = 0;
  const errors = [];
  const browserNotificationErrors = [];
  const tagResults = [];
  const summary = emptySummary();

  for (const tag of tags) {
    const tagResult = {
      tag,
      fetchedCount: 0,
      newCount: 0,
      discordNotifiedCount: 0,
      discordFailedCount: 0,
      browserNotifiedCount: 0,
      browserFailedCount: 0,
      sourceUrl: "",
      fallbackFromUrl: ""
    };

    try {
      const { products, sourceUrl, fallbackFromUrl } = await fetchProductsByTag(
        tag,
        settings.includeAdult
      );
      tagResult.sourceUrl = sourceUrl;
      tagResult.fallbackFromUrl = fallbackFromUrl;
      tagResult.fetchedCount = products.length;
      summary.fetchedCount += products.length;

      for (const product of products) {
        if (seenIds.includes(product.id)) {
          continue;
        }

        tagResult.newCount += 1;
        summary.newCount += 1;

        const discordNotified = settings.notifyDiscord
          ? await sendDiscordNotification(webhookUrl, product, tag)
          : false;
        const browserNotified = settings.notifyBrowser
          ? await sendBrowserNotification(product, tag)
          : { ok: false, message: "" };

        if (discordNotified) {
          tagResult.discordNotifiedCount += 1;
          summary.discordNotifiedCount += 1;
        }

        if (settings.notifyDiscord && !discordNotified) {
          tagResult.discordFailedCount += 1;
          summary.discordFailedCount += 1;
        }

        if (browserNotified.ok) {
          tagResult.browserNotifiedCount += 1;
          summary.browserNotifiedCount += 1;
        }

        if (settings.notifyBrowser && !browserNotified.ok) {
          tagResult.browserFailedCount += 1;
          summary.browserFailedCount += 1;
          if (browserNotified.message) {
            browserNotificationErrors.push(browserNotified.message);
          }
        }

        if (discordNotified || browserNotified.ok) {
          seenIds.push(product.id);
          notifiedCount += 1;
          await sleep(1000);
        }
      }

      await sleep(2000);
    } catch (error) {
      errors.push(`${tag}: ${error.message}`);
    }

    tagResults.push(tagResult);
  }

  await chrome.storage.local.set({ seenProductIds: unique(seenIds) });
  await setLastRun({
    checkedAt: new Date().toISOString(),
    reason,
    status:
      errors.length > 0 || summary.discordFailedCount > 0 || summary.browserFailedCount > 0
        ? "error"
        : "ok",
    message: buildRunMessage(errors, summary, browserNotificationErrors),
    notifiedCount,
    summary,
    tags: tagResults
  });
}

async function getSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    boothTags: normalizeTags(settings?.boothTags)
  };
}

async function getSeenProductIds() {
  const { seenProductIds } = await chrome.storage.local.get("seenProductIds");
  return Array.isArray(seenProductIds) ? seenProductIds : [];
}

async function setLastRun(lastRun) {
  await chrome.storage.local.set({ lastRun });
}

async function fetchProductsByTag(tag, includeAdult) {
  const primaryResult = await fetchProductsByTagUrl(buildBoothSearchUrl(tag, includeAdult));

  if (!includeAdult || primaryResult.products.length > 0) {
    return primaryResult;
  }

  const fallbackResult = await fetchProductsByTagUrl(buildBoothSearchUrl(tag, false));
  return {
    ...fallbackResult,
    fallbackFromUrl: primaryResult.sourceUrl
  };
}

async function fetchProductsByTagUrl(sourceUrl) {
  const response = await fetch(sourceUrl, {
    credentials: "omit"
  });

  if (!response.ok) {
    throw new Error(`BOOTH responded with ${response.status}`);
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
    title: product.title.slice(0, 256),
    url: product.url,
    color: 0xff6fae,
    fields: [
      { name: "価格", value: product.price.slice(0, 1024), inline: true },
      { name: "タグ", value: tag.slice(0, 1024), inline: true }
    ],
    footer: { text: "BOOTH Monitor" }
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

async function sendBrowserNotification(product, tag) {
  const notificationId = `booth-${product.id}-${Date.now()}`;

  try {
    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: NOTIFICATION_ICON_URL,
      title: product.title,
      message: `${product.price} / ${tag}`,
      contextMessage: "BOOTH New Product"
    });
    return { ok: true, message: "" };
  } catch (error) {
    return { ok: false, message: error?.message || "Unknown browser notification error." };
  }
}

function cleanText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function normalizeImageUrl(url) {
  if (!url) {
    return "";
  }

  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  return url;
}

async function parseProductsInOffscreenDocument(html) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: "PARSE_PRODUCTS",
    html
  });

  if (!response?.ok) {
    throw new Error(response?.message || "Failed to parse BOOTH products.");
  }

  return response.products;
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("src/offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: "src/offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "Parse BOOTH search result HTML in a DOM-capable extension context."
  });
}

function unique(values) {
  return Array.from(new Set(values));
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

function emptySummary() {
  return {
    fetchedCount: 0,
    newCount: 0,
    discordNotifiedCount: 0,
    discordFailedCount: 0,
    browserNotifiedCount: 0,
    browserFailedCount: 0
  };
}

function buildRunMessage(errors, summary, browserNotificationErrors = []) {
  const messages = [...errors];

  if (summary.discordFailedCount > 0) {
    messages.push(`${summary.discordFailedCount} Discord notification(s) failed.`);
  }

  if (summary.browserFailedCount > 0) {
    const uniqueErrors = unique(browserNotificationErrors).slice(0, 3);
    const suffix = uniqueErrors.length > 0 ? `: ${uniqueErrors.join(" / ")}` : ".";
    messages.push(`${summary.browserFailedCount} browser notification(s) failed${suffix}`);
  }

  return messages.join("\n");
}
