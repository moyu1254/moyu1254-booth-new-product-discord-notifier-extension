const ext = globalThis.browser || chrome;
const summary = document.querySelector("#summary");
const recentProducts = document.querySelector("#recent-products");
const openOptions = document.querySelector("#open-options");

document.addEventListener("DOMContentLoaded", async () => {
  const { lastRun, recentProducts: products = [] } = await ext.storage.local.get(["lastRun", "recentProducts"]);
  if (!lastRun) {
    summary.textContent = "まだ実行されていません。";
  } else {
    const checkedAt = new Date(lastRun.checkedAt).toLocaleString();
    const runSummary = lastRun.summary || {};
    summary.textContent = `${checkedAt}: ${formatStatus(lastRun.status)} / 新規 ${runSummary.newCount ?? 0} 件 / Discord通知 ${runSummary.discordNotifiedCount ?? 0} 件 / 一覧追加 ${lastRun.notifiedCount ?? 0} 件`;
  }

  renderRecentProducts(products);
  await ext.runtime.sendMessage({ type: "CLEAR_BADGE" });
});

openOptions.addEventListener("click", () => {
  ext.runtime.openOptionsPage();
});

function renderRecentProducts(products) {
  if (products.length === 0) {
    recentProducts.textContent = "新商品履歴はまだありません。";
    return;
  }

  recentProducts.replaceChildren(
    ...products.map((product) => {
      const link = document.createElement("a");
      link.className = "recent-product";
      link.href = product.url;
      link.target = "_blank";
      link.rel = "noreferrer";

      const titleRow = document.createElement("span");
      titleRow.className = "recent-product-title-row";

      const title = document.createElement("span");
      title.className = "recent-product-title";
      title.textContent = product.title;

      titleRow.append(title);

      if (product.isAdult) {
        const badge = document.createElement("span");
        badge.className = "recent-product-badge recent-product-badge-adult";
        badge.textContent = "成人向け";
        titleRow.append(badge);
      }

      const meta = document.createElement("span");
      meta.className = "recent-product-meta";
      meta.textContent = `${product.price} / ${product.tag}`;

      link.append(titleRow, meta);
      return link;
    })
  );
}

function formatStatus(status) {
  switch (status) {
    case "ok":
      return "正常";
    case "error":
      return "エラー";
    case "skipped":
      return "未実行";
    default:
      return status || "不明";
  }
}
