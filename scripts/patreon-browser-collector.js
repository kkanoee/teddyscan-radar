(async () => {
  const CONFIG = {
    maxRounds: 700,
    idleRounds: 12,
    delayMs: 1800,
    scrollPx: 4000,
    videoHosts: [
      "youtube.com",
      "youtu.be",
      "vimeo.com",
      "dailymotion.com",
      "streamable.com",
    ],
    loadMoreLabels: [
      /^show more$/i,
      /^load more$/i,
      /^see more$/i,
      /^voir plus$/i,
      /^afficher plus$/i,
      /^charger plus$/i,
      /^plus$/i,
    ],
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const found = new Set();
  let stopped = false;

  function normalizeUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl).replaceAll("\\/", "/"), location.href);
      url.hash = "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function isVideoUrl(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      return CONFIG.videoHosts.some((videoHost) => host === videoHost || host.endsWith(`.${videoHost}`));
    } catch {
      return false;
    }
  }

  function collectLinks() {
    const anchorLinks = [...document.querySelectorAll("a[href]")].map((anchor) => anchor.href);
    const scriptText = [...document.querySelectorAll("script")]
      .map((script) => script.textContent || "")
      .join("\n");
    const scriptLinks = scriptText.match(/https?:\\?\/\\?\/[^"'\\<>\s]+/g) || [];

    for (const link of [...anchorLinks, ...scriptLinks]) {
      const normalized = normalizeUrl(link);
      if (normalized) found.add(normalized);
    }
  }

  function classify() {
    const allLinks = [...found].sort();
    const videoLinks = allLinks.filter(isVideoUrl);
    const patreonPosts = allLinks.filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.hostname.includes("patreon.com") && /\/posts\//.test(parsed.pathname);
      } catch {
        return false;
      }
    });

    return { allLinks, videoLinks, patreonPosts };
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function downloadResults() {
    const { allLinks, videoLinks, patreonPosts } = classify();
    const payload = {
      collectedAt: new Date().toISOString(),
      source: location.href,
      counts: {
        allLinks: allLinks.length,
        videoLinks: videoLinks.length,
        patreonPosts: patreonPosts.length,
      },
      videoLinks,
      patreonPosts,
      allLinks,
    };

    download("patreon_video_links.txt", `${videoLinks.join("\n")}\n`);
    download("patreon_posts.txt", `${patreonPosts.join("\n")}\n`);
    download("patreon_links.json", `${JSON.stringify(payload, null, 2)}\n`);
  }

  async function clickLoadMore() {
    const buttons = [...document.querySelectorAll("button")];

    for (const button of buttons) {
      const label = (button.innerText || button.textContent || "").trim().replace(/\s+/g, " ");
      const rect = button.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      const disabled = button.disabled || button.getAttribute("aria-disabled") === "true";

      if (!visible || disabled) continue;
      if (!CONFIG.loadMoreLabels.some((pattern) => pattern.test(label))) continue;

      button.scrollIntoView({ block: "center" });
      await sleep(250);
      button.click();
      return true;
    }

    return false;
  }

  function createPanel() {
    const panel = document.createElement("div");
    panel.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "right:16px",
      "bottom:16px",
      "width:320px",
      "padding:12px",
      "border:1px solid #d0d7de",
      "border-radius:8px",
      "background:#fff",
      "color:#111",
      "font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "box-shadow:0 12px 32px rgba(0,0,0,.18)",
    ].join(";");

    const status = document.createElement("div");
    status.textContent = "Collecte Patreon en cours...";

    const stopButton = document.createElement("button");
    stopButton.textContent = "Stop + telecharger";
    stopButton.style.cssText = "margin-top:10px;padding:7px 10px;border:1px solid #999;border-radius:6px;background:#f6f8fa;cursor:pointer";
    stopButton.addEventListener("click", () => {
      stopped = true;
      downloadResults();
      status.textContent = "Arret demande. Fichiers telecharges.";
    });

    panel.append(status, stopButton);
    document.body.append(panel);

    return status;
  }

  const status = createPanel();
  let idle = 0;
  let lastHeight = 0;

  for (let round = 1; round <= CONFIG.maxRounds && !stopped; round += 1) {
    const before = found.size;
    collectLinks();

    const clicked = await clickLoadMore();
    window.scrollBy({ top: CONFIG.scrollPx, behavior: "smooth" });
    await sleep(CONFIG.delayMs);

    const height = document.documentElement.scrollHeight;
    const changed = found.size > before || clicked || height !== lastHeight;
    lastHeight = height;
    idle = changed ? 0 : idle + 1;

    const { videoLinks, patreonPosts } = classify();
    status.textContent = `Round ${round} | ${found.size} liens | ${videoLinks.length} videos | ${patreonPosts.length} posts`;

    if (idle >= CONFIG.idleRounds) break;
  }

  collectLinks();
  downloadResults();
  const { videoLinks, patreonPosts } = classify();
  status.textContent = `Termine. ${videoLinks.length} videos, ${patreonPosts.length} posts. Fichiers telecharges.`;
})();
