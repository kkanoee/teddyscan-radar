import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SITE_DATA_DIR = path.join(ROOT, "site", "data");
const JSON_OUTPUT = path.join(SITE_DATA_DIR, "teddyscans.json");
const CANDIDATE_OUTPUT = path.join(SITE_DATA_DIR, "teddyscan-candidates.json");
const JS_OUTPUT = path.join(SITE_DATA_DIR, "teddyscans.js");

const NEGATIVE_PATTERNS = [
  /scan google/,
  /scan gratos/,
  /camille scan/,
  /scanner/,
  /body scan/,
  /irm/,
  /radio scan/,
];

const POSITIVE_PATTERNS = [
  /teddyscan/,
  /teddy scan/,
  /\bte scan\b/,
  /\btd scan\b/,
  /\bpetit scan\b/,
  /\bdeuxieme scan\b/,
  /\bmeilleur scan\b/,
  /\bscan est hs\b/,
  /\bscan qui est visiblement correct\b/,
  /\bje vous l avais dit scan\b/,
  /\bj avais fait .*scan\b/,
  /\bje vous fais .*scan\b/,
  /\bscan sur\b/,
  /\bscan de\b/,
  /\bscan du\b/,
  /\bfuture\b/,
  /\bfutur\b/,
  /\bavenir\b/,
  /\barrive\b/,
  /\barriver\b/,
  /\bva\b/,
  /\bvont\b/,
  /\bsonge\b/,
  /\bpotentiellement\b/,
  /\bpari\b/,
  /\b2027\b/,
  /\bpolitique\b/,
  /\bcandidat\b/,
];

const FUTURE_HINTS = [
  "va",
  "vont",
  "arrive",
  "arriver",
  "avenir",
  "future",
  "futur",
  "potentiellement",
  "songe",
  "candidat",
  "2027",
  "polémique",
  "politique",
  "pari",
];

const ENTRY_BRAND_PATTERN = /\b(?:teddyscan|teddy scan|te scan|td scan|tiscan)\b/;
const ENTRY_SCAN_PATTERN = /\b(?:scan|scanne)\b/;

function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  if (value == null) {
    return "";
  }

  return value
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
}

function timecodeToSeconds(label) {
  const [hours, minutes, rest] = label.split(":");
  const [seconds] = rest.split(",");
  return (
    Number.parseInt(hours, 10) * 3600 +
    Number.parseInt(minutes, 10) * 60 +
    Number.parseInt(seconds, 10)
  );
}

function formatTimecode(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((part, index) => String(part).padStart(index === 0 ? 1 : 2, "0"))
      .join(":");
  }

  return [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function parseSrt(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const chunks = raw.split(/\r?\n\r?\n+/);
  const entries = [];

  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 3) {
      continue;
    }

    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex === -1) {
      continue;
    }

    const [start, end] = lines[timeLineIndex].split("-->").map((part) => part.trim());
    const text = cleanText(lines.slice(timeLineIndex + 1).join(" "));
    if (!text) {
      continue;
    }

    entries.push({
      index: entries.length + 1,
      start,
      end,
      startSeconds: timecodeToSeconds(start),
      text,
      normalized: normalize(text),
    });
  }

  return entries;
}

function extractVideoId(filename) {
  const match = filename.match(/\[([A-Za-z0-9_-]{11})\]/);
  return match ? match[1] : null;
}

function extractTitle(filename) {
  return filename
    .replace(/^\d{8}\s*-\s*/, "")
    .replace(/\s*\[[A-Za-z0-9_-]{11}\]\.fr-orig\.srt$/i, "")
    .trim();
}

function buildExcerpt(entries, index) {
  const slice = entries.slice(Math.max(0, index - 2), index + 4);
  return cleanText(slice.map((entry) => entry.text).join(" "));
}

function sentenceCandidates(context) {
  return context
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanText(sentence))
    .filter(Boolean);
}

function scoreCandidate(entry, context, title) {
  const entryNorm = entry.normalized;
  const contextNorm = normalize(context);
  let score = 0;
  const reasons = [];

  const explicitBrand = ENTRY_BRAND_PATTERN.test(entryNorm);
  const titleBrand = /\bteddyscan\b/.test(normalize(title));

  if (explicitBrand) {
    score += 4;
    reasons.push("marque explicite");
  }

  if (titleBrand) {
    score += 1;
    reasons.push("video centree scan");
  }

  if (ENTRY_SCAN_PATTERN.test(entryNorm)) {
    score += 1;
    reasons.push("mot-clé présent");
  }

  for (const pattern of POSITIVE_PATTERNS) {
    if (pattern.test(contextNorm)) {
      score += 1;
    }
  }

  const negativeHits = NEGATIVE_PATTERNS.filter((pattern) => pattern.test(contextNorm));
  if (negativeHits.length > 0) {
    score -= negativeHits.length * 3;
    reasons.push("contexte parasite");
  }

  if (/\bscan direct\b/.test(contextNorm) && !/\bje vous fais\b/.test(contextNorm)) {
    score -= 2;
    reasons.push("expression ambigue");
  }

  const confidence = score >= 6 ? "high" : score >= 3 ? "medium" : "low";
  const included = score >= 3;

  return { confidence, included, score, reasons };
}

function clipWords(value, maxWords = 18) {
  const words = cleanText(value).split(" ").filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function isUsablePhrase(value) {
  const cleaned = cleanText(value);
  return /[a-zA-ZÀ-ÿ]/.test(cleaned) && cleaned.replace(/[^\p{L}\p{N}]/gu, "").length >= 8;
}

function isGoodTopic(value) {
  const cleaned = cleanText(value).replace(/^[^a-zA-ZÀ-ÿ0-9]+/, "");
  const words = cleaned.split(" ").filter(Boolean);
  const filler =
    /^(?:bah|et oui|allez|donc|ok|ouais|voila|voilà|il y a|c est|ça c est|ca c est)\b/i;
  return isUsablePhrase(cleaned) && cleaned.length >= 14 && words.length >= 3 && !filler.test(cleaned);
}

function stripScanLead(sentence) {
  return cleanText(
    sentence.replace(
      /\b(?:petit|deuxieme|deuxième|mon|ma|le|la|un|une)?\s*(?:teddyscan|teddy scan|te scan|td scan|tiscan|scan|scanne)\b[:,.]?\s*/i,
      "",
    ),
  );
}

function extractTopic(context) {
  const cleaned = cleanText(context);
  const patterns = [
    /scan[^.?!]{0,24}\bsur le fait que\b\s+([^.!?]+)/i,
    /scan[^.?!]{0,24}\bsur\b\s+([^.!?]+)/i,
    /scan[^.?!]{0,24}\bdeux?\b\s+([^.!?]+)/i,
    /scan[^.?!]{0,24}\bdu\b\s+([^.!?]+)/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1] && isUsablePhrase(match[1])) {
      return clipWords(match[1], 14);
    }
  }

  return null;
}

function extractPrediction(context, quote) {
  const sentences = sentenceCandidates(context);
  const quoteNorm = normalize(quote);

  const futureSentence = sentences.find((sentence) => {
    const normalizedSentence = normalize(sentence);
    return FUTURE_HINTS.some((hint) => normalizedSentence.includes(hint));
  });

  if (futureSentence) {
    return clipWords(futureSentence, 22);
  }

  const quoteIndex = sentences.findIndex((sentence) => normalize(sentence).includes(quoteNorm));
  if (quoteIndex !== -1 && sentences[quoteIndex + 1]) {
    return clipWords(sentences[quoteIndex + 1], 22);
  }

  if (quoteIndex > 0 && sentences[quoteIndex - 1]) {
    return clipWords(sentences[quoteIndex - 1], 22);
  }

  return clipWords(quote, 22);
}

function fallbackTopic(context) {
  const sentences = sentenceCandidates(context);
  const fallback = sentences
    .filter((sentence) => {
      const normalizedSentence = normalize(sentence);
      return (
        !ENTRY_BRAND_PATTERN.test(normalizedSentence) &&
        !ENTRY_SCAN_PATTERN.test(normalizedSentence) &&
        isGoodTopic(sentence)
      );
    })
    .sort((left, right) => right.length - left.length)[0];

  if (fallback) {
    return clipWords(fallback, 14);
  }

  const scanSentence = sentences.find((sentence) => {
    const normalizedSentence = normalize(sentence);
    return ENTRY_BRAND_PATTERN.test(normalizedSentence) || ENTRY_SCAN_PATTERN.test(normalizedSentence);
  });

  if (scanSentence) {
    const stripped = stripScanLead(scanSentence);
    if (isGoodTopic(stripped)) {
      return clipWords(stripped, 14);
    }
  }

  return "Contexte à confirmer";
}

function buildRecord(fileName, entries, index) {
  const entry = entries[index];
  const videoId = extractVideoId(fileName);
  if (!videoId) {
    return null;
  }

  const title = extractTitle(fileName);
  const context = buildExcerpt(entries, index);
  const scored = scoreCandidate(entry, context, title);
  const publishedAt = fileName.slice(0, 8);
  const extractedTopic = extractTopic(context);
  const prediction = extractPrediction(context, entry.text);
  const topic = isGoodTopic(extractedTopic) ? extractedTopic : fallbackTopic(context);

  return {
    id: `${videoId}-${entry.startSeconds}`,
    videoId,
    title,
    publishedAt,
    quote: entry.text,
    context,
    topic,
    prediction,
    timestamp: entry.start,
    timestampLabel: formatTimecode(entry.startSeconds),
    startSeconds: entry.startSeconds,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}&t=${entry.startSeconds}s`,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    confidence: scored.confidence,
    score: scored.score,
    included: scored.included,
    reasons: scored.reasons,
    sourceFile: fileName,
  };
}

function sortRecords(records) {
  return [...records].sort((left, right) => {
    if (left.publishedAt === right.publishedAt) {
      return left.startSeconds - right.startSeconds;
    }
    return right.publishedAt.localeCompare(left.publishedAt);
  });
}

function main() {
  fs.mkdirSync(SITE_DATA_DIR, { recursive: true });

  const files = fs
    .readdirSync(ROOT)
    .filter((file) => file.endsWith(".srt"))
    .sort((left, right) => left.localeCompare(right));

  const candidates = [];

  for (const file of files) {
    const filePath = path.join(ROOT, file);
    const entries = parseSrt(filePath);

    entries.forEach((entry, index) => {
      if (!ENTRY_BRAND_PATTERN.test(entry.normalized) && !ENTRY_SCAN_PATTERN.test(entry.normalized)) {
        return;
      }

      const record = buildRecord(file, entries, index);
      if (record) {
        candidates.push(record);
      }
    });
  }

  const included = sortRecords(candidates.filter((record) => record.included));
  const sortedCandidates = sortRecords(candidates);
  const meta = {
    generatedAt: new Date().toISOString(),
    scannedVideos: files.length,
    candidateCount: sortedCandidates.length,
    includedCount: included.length,
    videosWithScans: new Set(included.map((record) => record.videoId)).size,
  };

  fs.writeFileSync(JSON_OUTPUT, JSON.stringify({ meta, records: included }, null, 2));
  fs.writeFileSync(CANDIDATE_OUTPUT, JSON.stringify({ meta, records: sortedCandidates }, null, 2));
  fs.writeFileSync(
    JS_OUTPUT,
    `window.TEDDYSCAN_META = ${JSON.stringify(meta, null, 2)};\nwindow.TEDDYSCAN_DATA = ${JSON.stringify(
      included,
      null,
      2,
    )};\n`,
  );

  console.log(`Generated ${included.length} TeddyScan entries from ${files.length} transcript files.`);
}

main();
