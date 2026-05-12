import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DEFAULT_OUT = "patreon_links";
const DEFAULT_STATE_DIR = ".browser-state/patreon";
const DEFAULT_MARKER_FILE = "scrape_state.json";
const VIDEO_HOSTS = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "dailymotion.com",
  "streamable.com",
];

function parseArgs(argv) {
  const args = {
    url: "",
    out: DEFAULT_OUT,
    stateDir: DEFAULT_STATE_DIR,
    cookiesJson: "",
    markerFile: DEFAULT_MARKER_FILE,
    browserChannel: "",
    ephemeral: false,
    headless: false,
    maxRounds: 500,
    idleRounds: 8,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") args.url = argv[++i] ?? "";
    else if (arg === "--out") args.out = argv[++i] ?? DEFAULT_OUT;
    else if (arg === "--state-dir") args.stateDir = argv[++i] ?? DEFAULT_STATE_DIR;
    else if (arg === "--cookies-json") args.cookiesJson = argv[++i] ?? "";
    else if (arg === "--marker-file") args.markerFile = argv[++i] ?? DEFAULT_MARKER_FILE;
    else if (arg === "--browser-channel") args.browserChannel = argv[++i] ?? "";
    else if (arg === "--ephemeral") args.ephemeral = true;
    else if (arg === "--headless") args.headless = true;
    else if (arg === "--max-rounds") args.maxRounds = Number(argv[++i] ?? args.maxRounds);
    else if (arg === "--idle-rounds") args.idleRounds = Number(argv[++i] ?? args.idleRounds);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!args.url) {
    console.error("Missing --url.");
    printHelp();
    process.exit(1);
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  npx --yes --package playwright node scripts/collect-patreon-links.mjs --url "https://www.patreon.com/..."

Options:
  --out <dir>         Output directory. Default: ${DEFAULT_OUT}
  --state-dir <dir>   Browser session directory. Default: ${DEFAULT_STATE_DIR}
  --cookies-json      Path to exported Patreon cookies JSON.
  --marker-file       State file inside output dir. Default: ${DEFAULT_MARKER_FILE}
  --browser-channel   Browser channel, for example "chrome" if installed.
  --ephemeral         Use non-persistent browser context (recommended with cookies JSON).
  --headless          Run without a visible browser window.
  --max-rounds <n>    Maximum scroll/click rounds. Default: 500
  --idle-rounds <n>   Stop after n rounds with no new links. Default: 8

Optional login env vars:
  PATREON_EMAIL
  PATREON_PASSWORD
`);
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("Playwright is not available.");
    console.error("Run with: npx --yes --package playwright node scripts/collect-patreon-links.mjs --url \"https://www.patreon.com/...\"");
    throw error;
  }
}

function readScrapeState(outDir, markerFile) {
  const markerPath = path.join(outDir, markerFile);
  if (!fs.existsSync(markerPath)) {
    return { markerPath, state: { lastRunAt: null } };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    return { markerPath, state: parsed };
  } catch {
    return { markerPath, state: { lastRunAt: null } };
  }
}

function writeScrapeState(markerPath, lastRunAt) {
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(
    markerPath,
    `${JSON.stringify({ lastRunAt, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

function normalizeUrl(rawUrl, baseUrl) {
  try {
    const url = new URL(rawUrl, baseUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function isVideoUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return VIDEO_HOSTS.some((videoHost) => host === videoHost || host.endsWith(`.${videoHost}`));
  } catch {
    return false;
  }
}

function classifyLinks(links) {
  const allLinks = [...links].sort();
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

async function maybeLogin(page, targetUrl) {
  const email = process.env.PATREON_EMAIL;
  const password = process.env.PATREON_PASSWORD;

  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(2500);

  const passwordInputs = await page.locator("input[type='password']").count();
  const loginVisible = /login|signin|oauth/i.test(page.url()) || passwordInputs > 0;

  if (!loginVisible) return;

  if (email && password) {
    console.log("Login page detected. Filling credentials from PATREON_EMAIL/PATREON_PASSWORD.");
    await page.goto("https://www.patreon.com/login", { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.locator("input[type='email'], input[name='email']").first().fill(email);
    await page.locator("input[type='password'], input[name='password']").first().fill(password);
    await page.locator("button[type='submit']").first().click();
    await page.waitForLoadState("domcontentloaded", { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(5000);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(3000);
    return;
  }

  console.log("Login page detected. Log in manually in the browser window, then press Enter here.");
  const rl = readline.createInterface({ input, output });
  await rl.question("Press Enter after Patreon is logged in...");
  rl.close();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(3000);
}

function toPlaywrightSameSite(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "strict") return "Strict";
  if (normalized === "lax") return "Lax";
  return "None";
}

async function maybeLoadCookies(context, cookiesJsonPath) {
  if (!cookiesJsonPath) return;
  if (!fs.existsSync(cookiesJsonPath)) {
    throw new Error(`Cookies JSON not found: ${cookiesJsonPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(cookiesJsonPath, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error("Cookies JSON must be an array.");
  }

  const cookies = raw
    .filter((cookie) => cookie && cookie.name && (cookie.domain || cookie.url))
    .map((cookie) => {
      const mapped = {
        name: String(cookie.name),
        value: String(cookie.value ?? ""),
        path: String(cookie.path ?? "/"),
        httpOnly: Boolean(cookie.httpOnly),
        secure: Boolean(cookie.secure),
        sameSite: toPlaywrightSameSite(cookie.sameSite),
      };
      if (cookie.domain) mapped.domain = String(cookie.domain);
      if (cookie.expirationDate && Number.isFinite(Number(cookie.expirationDate))) {
        mapped.expires = Math.floor(Number(cookie.expirationDate));
      }
      if (!mapped.domain && cookie.url) mapped.url = String(cookie.url);
      return mapped;
    });

  if (cookies.length > 0) {
    await context.addCookies(cookies);
    console.log(`Loaded ${cookies.length} cookies from ${cookiesJsonPath}.`);
  }
}

async function oldestVisiblePostTimestamp(page) {
  return page
    .evaluate(() => {
      const nodes = [...document.querySelectorAll("time[datetime]")];
      const values = nodes
        .map((node) => node.getAttribute("datetime"))
        .filter(Boolean)
        .map((value) => Date.parse(value))
        .filter((value) => Number.isFinite(value));
      if (values.length === 0) return null;
      return Math.min(...values);
    })
    .catch(() => null);
}

async function extractLinks(page, baseUrl) {
  const rawLinks = await page.evaluate(() => {
    const fromAnchors = [...document.querySelectorAll("a[href]")].map((anchor) => anchor.href);
    const scriptText = [...document.querySelectorAll("script")]
      .map((script) => script.textContent || "")
      .join("\n");
    const fromScripts = scriptText.match(/https?:\\?\/\\?\/[^"'\\<>\s]+/g) || [];
    return [...fromAnchors, ...fromScripts];
  });

  return rawLinks
    .map((rawUrl) => rawUrl.replaceAll("\\/", "/"))
    .map((rawUrl) => normalizeUrl(rawUrl, baseUrl))
    .filter(Boolean);
}

async function clickLoadMore(page) {
  const labels = [
    /^show more$/i,
    /^load more$/i,
    /^see more$/i,
    /^voir plus$/i,
    /^afficher plus$/i,
    /^charger plus$/i,
    /^plus$/i,
  ];

  const buttons = page.locator("button");
  const count = await buttons.count();

  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    if (!(await button.isEnabled().catch(() => false))) continue;

    const label = ((await button.innerText().catch(() => "")) || "").trim().replace(/\s+/g, " ");
    if (!labels.some((pattern) => pattern.test(label))) continue;

    await button.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2000);
    return true;
  }

  return false;
}

async function collectAllLinks(page, args) {
  const links = new Set();
  let idleRounds = 0;
  let lastHeight = 0;
  const { markerPath, state } = readScrapeState(args.out, args.markerFile);
  const lastRunCutoffMs = state.lastRunAt ? Date.parse(state.lastRunAt) : null;

  if (Number.isFinite(lastRunCutoffMs)) {
    console.log(`Incremental mode: stopping when visible posts reach ${new Date(lastRunCutoffMs).toISOString()}.`);
  }

  for (let round = 1; round <= args.maxRounds; round += 1) {
    const before = links.size;
    for (const link of await extractLinks(page, args.url)) links.add(link);

    const clicked = await clickLoadMore(page);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(1800);

    const height = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
    const changed = links.size > before || clicked || height !== lastHeight;
    lastHeight = height;
    idleRounds = changed ? 0 : idleRounds + 1;

    const { videoLinks, patreonPosts } = classifyLinks(links);
    console.log(
      `Round ${round}: ${links.size} links, ${videoLinks.length} videos, ${patreonPosts.length} Patreon posts`
    );

    if (Number.isFinite(lastRunCutoffMs)) {
      const oldestVisibleMs = await oldestVisiblePostTimestamp(page);
      if (Number.isFinite(oldestVisibleMs) && oldestVisibleMs <= lastRunCutoffMs) {
        console.log(
          `Reached previously scraped date window at round ${round} (${new Date(oldestVisibleMs).toISOString()}).`,
        );
        break;
      }
    }

    if (idleRounds >= args.idleRounds) break;
  }

  writeScrapeState(markerPath, new Date().toISOString());
  return links;
}

function writeOutputs(outDir, links) {
  fs.mkdirSync(outDir, { recursive: true });
  const { allLinks, videoLinks, patreonPosts } = classifyLinks(links);
  const payload = {
    collectedAt: new Date().toISOString(),
    counts: {
      allLinks: allLinks.length,
      videoLinks: videoLinks.length,
      patreonPosts: patreonPosts.length,
    },
    videoLinks,
    patreonPosts,
    allLinks,
  };

  fs.writeFileSync(path.join(outDir, "patreon_links.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "video_links.txt"), `${videoLinks.join("\n")}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "patreon_posts.txt"), `${patreonPosts.join("\n")}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "all_links.txt"), `${allLinks.join("\n")}\n`, "utf8");

  return payload.counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = await importPlaywright();
  const useEphemeral = args.ephemeral || Boolean(args.cookiesJson);
  let browser;
  let context;
  let page;

  if (useEphemeral) {
    browser = await chromium.launch({
      headless: args.headless,
      ...(args.browserChannel ? { channel: args.browserChannel } : {}),
    });
    context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    page = await context.newPage();
  } else {
    context = await chromium.launchPersistentContext(args.stateDir, {
      headless: args.headless,
      ...(args.browserChannel ? { channel: args.browserChannel } : {}),
      viewport: { width: 1440, height: 1100 },
    });
    page = context.pages()[0] || (await context.newPage());
  }

  try {
    await maybeLoadCookies(context, args.cookiesJson);
    await maybeLogin(page, args.url);
    const links = await collectAllLinks(page, args);
    const counts = writeOutputs(args.out, links);
    console.log(`Done. Wrote ${counts.videoLinks} video links and ${counts.patreonPosts} Patreon post links to ${args.out}.`);
  } finally {
    await context.close();
    if (browser) {
      await browser.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
