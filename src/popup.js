const summary = document.querySelector("#summary");
const openOptions = document.querySelector("#open-options");

document.addEventListener("DOMContentLoaded", async () => {
  const { lastRun } = await chrome.storage.local.get("lastRun");
  if (!lastRun) {
    summary.textContent = "まだ実行されていません。";
    return;
  }

  const checkedAt = new Date(lastRun.checkedAt).toLocaleString();
  const runSummary = lastRun.summary || {};
  summary.textContent = `${checkedAt}: ${lastRun.status} / 新規${runSummary.newCount ?? 0}件 / Discord ${runSummary.discordNotifiedCount ?? lastRun.notifiedCount}件 / ブラウザ ${runSummary.browserNotifiedCount ?? 0}件`;
});

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
