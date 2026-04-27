import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const AUDIT_INPUT = path.join(ROOT, "site", "data", "teddyscan-audit.json");
const CURATED_JSON_OUTPUT = path.join(ROOT, "site", "data", "teddyscans-curated.json");
const CURATED_JS_OUTPUT = path.join(ROOT, "site", "data", "teddyscans-curated.js");
const OBSIDIAN_ROOT = path.join(ROOT, "obsidian-vault");
const OBSIDIAN_INDEX_DIR = path.join(OBSIDIAN_ROOT, "00 Index");
const OBSIDIAN_SCAN_DIR = path.join(OBSIDIAN_ROOT, "01 Scans");
const OBSIDIAN_VIDEO_DIR = path.join(OBSIDIAN_ROOT, "02 Videos");
const OBSIDIAN_TRANSCRIPT_DIR = path.join(OBSIDIAN_ROOT, "03 Transcripts");
const TRANSCRIPT_BUCKET_SECONDS = 300;
const TRANSCRIPT_SOURCE_CANDIDATES = [
  { source: "public", dirNames: ["Public", "public"] },
  { source: "patreon", dirNames: ["Patreon", "patreon"] },
];
const SCAN_PATTERN = /\b(?:teddyscan|teddy scan|te scan|td scan|tiscan|scan|scanne)\b/;
const FUTURE_HINTS = [
  " va ",
  " vont ",
  " arriver",
  " arrive",
  " songe",
  " candidat",
  " election",
  " 2027",
  " se presenter",
  " se reconvertir",
  " ecroulement",
  " reviendra",
  " reviend",
  " vont dire",
  " je sens que",
];
const FILLER_START = /^(?:bah|bon|donc|voila|voila bah|oui|ouais|alors|hein|ben|du coup)\b/i;

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
}

function compactDateToFrench(compactDate) {
  if (!compactDate || compactDate.length !== 8) {
    return "Date inconnue";
  }

  const isoDate = `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTimecode(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((part, index) => String(part).padStart(index === 0 ? 1 : 2, "0"))
      .join(":");
  }

  return [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
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

    const [start] = lines[timeLineIndex].split("-->").map((part) => part.trim());
    const text = cleanText(lines.slice(timeLineIndex + 1).join(" "));
    if (!text) {
      continue;
    }

    entries.push({
      start,
      startSeconds: timecodeToSeconds(start),
      text,
    });
  }

  return entries;
}

function clipWords(value, maxWords = 50) {
  const words = cleanText(value).split(" ").filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function sentenceCandidates(text) {
  return cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanText(sentence))
    .filter((sentence) => sentence.length >= 10);
}

function hasFutureHint(text) {
  const normalized = ` ${normalize(text)} `;
  return FUTURE_HINTS.some((hint) => normalized.includes(hint));
}

function sanitizeFileSegment(value, fallback = "note") {
  const cleaned = String(value ?? fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || fallback;
}

function yamlEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '\\"')}"`;
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

function uniqueCandidates(values) {
  const seen = new Set();
  const output = [];

  for (const value of values.map((item) => cleanText(item)).filter(Boolean)) {
    const normalized = normalize(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(value);
  }

  return output;
}

function scoreTopicCandidate(candidate) {
  const normalized = normalize(candidate);
  if (!normalized) {
    return -100;
  }

  let score = 0;
  if (!SCAN_PATTERN.test(normalized)) {
    score += 5;
  } else {
    score -= 4;
  }
  if (normalized.length >= 28) {
    score += 3;
  }
  if (normalized.length >= 50) {
    score += 2;
  }
  if (normalized.length > 180) {
    score -= 3;
  }
  if (!FILLER_START.test(candidate)) {
    score += 1;
  }
  if (hasFutureHint(candidate)) {
    score += 1;
  }

  return score;
}

function scorePredictionCandidate(candidate, semanticType) {
  const normalized = normalize(candidate);
  if (!normalized) {
    return -100;
  }

  let score = 0;
  if (semanticType === "retrospective" && /avais|avait|visiblement correct|a eu raison/.test(normalized)) {
    score += 5;
  }
  if (hasFutureHint(candidate)) {
    score += 6;
  }
  if (!SCAN_PATTERN.test(normalized)) {
    score += 2;
  } else {
    score -= 2;
  }
  if (normalized.length >= 24) {
    score += 2;
  }
  if (normalized.length > 180) {
    score -= 2;
  }

  return score;
}

function pickBest(candidates, scoreFn, fallback) {
  const items = uniqueCandidates(candidates);
  if (items.length === 0) {
    return cleanText(fallback);
  }

  const ranked = items
    .map((candidate) => ({ candidate, score: scoreFn(candidate) }))
    .sort((left, right) => right.score - left.score || right.candidate.length - left.candidate.length);

  return ranked[0]?.candidate ?? cleanText(fallback);
}

function quoteCoreLength(value) {
  return normalize(value)
    .replace(SCAN_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

function chooseBestQuote(records) {
  return [...records]
    .sort((left, right) => {
      return quoteCoreLength(right.quote) - quoteCoreLength(left.quote) || right.quote.length - left.quote.length;
    })[0]?.quote;
}

function isWeakTopic(value) {
  const normalized = normalize(value);
  return !normalized || SCAN_PATTERN.test(normalized) || normalized.length < 24 || FILLER_START.test(value);
}

function isWeakPrediction(value, semanticType) {
  const normalized = normalize(value);
  if (!normalized || normalized.length < 18) {
    return true;
  }
  if (semanticType === "prediction") {
    return !hasFutureHint(value) && SCAN_PATTERN.test(normalized);
  }
  return SCAN_PATTERN.test(normalized) && !/avais|avait|raison|correct/.test(normalized);
}

function sameMeaning(left, right) {
  return normalize(left) === normalize(right);
}

function titleTopicFallback(title) {
  const cleaned = cleanText(
    String(title ?? "")
      .replace(/\b(?:teddyscan|teddy scan|scan)\b/gi, " ")
      .replace(/\s+/g, " "),
  );
  return cleaned || "Contexte du scan";
}

function distinctTopic(topicCandidates, prediction, currentTopic, title) {
  const predictionNorm = normalize(prediction);
  if (normalize(currentTopic) && normalize(currentTopic) !== predictionNorm) {
    return currentTopic;
  }

  const candidate = uniqueCandidates(topicCandidates)
    .map((value) => ({
      value,
      score: scoreTopicCandidate(value) - (normalize(value) === predictionNorm ? 10 : 0),
    }))
    .sort((left, right) => right.score - left.score)[0]?.value;

  if (candidate && normalize(candidate) !== predictionNorm && !isWeakTopic(candidate)) {
    return clipWords(candidate, 24);
  }

  const fromTitle = clipWords(titleTopicFallback(title), 24);
  if (!sameMeaning(fromTitle, prediction)) {
    return fromTitle;
  }

  return "Contexte du scan";
}

function obsidianLink(pathWithoutExtension, label) {
  return `[[${pathWithoutExtension}${label ? `|${label}` : ""}]]`;
}

function transcriptNoteBaseName(source, videoId, title) {
  const sourceLabel = source === "patreon" ? "Patreon" : "Public";
  return `${sourceLabel} - ${videoId} - ${sanitizeFileSegment(title)}`;
}

function videoNoteBaseName(source, videoId, title) {
  const sourceLabel = source === "patreon" ? "Patreon" : "Public";
  return `${sourceLabel} - ${videoId} - ${sanitizeFileSegment(title)}`;
}

function scanNoteBaseName(record) {
  const topic = sanitizeFileSegment(clipWords(record.topic, 10), "scan");
  const sourceLabel = record.source === "patreon" ? "Patreon" : "Public";
  return `${sourceLabel} ${record.videoId} ${record.timestampLabel.replace(/:/g, "-")} - ${topic}`;
}

function buildTranscriptSections(entries) {
  const sections = [];

  for (const entry of entries) {
    const bucketStart = Math.floor(entry.startSeconds / TRANSCRIPT_BUCKET_SECONDS) * TRANSCRIPT_BUCKET_SECONDS;
    let section = sections[sections.length - 1];

    if (!section || section.bucketStart !== bucketStart) {
      section = {
        bucketStart,
        label: formatTimecode(bucketStart),
        lines: [],
      };
      sections.push(section);
    }

    section.lines.push(entry.text);
  }

  return sections;
}

function buildTranscriptCache() {
  const cache = new Map();
  const seenDirs = new Set();

  for (const descriptor of TRANSCRIPT_SOURCE_CANDIDATES) {
    let absoluteDir = null;
    for (const dirName of descriptor.dirNames) {
      const candidate = path.join(ROOT, dirName);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        absoluteDir = candidate;
        break;
      }
    }
    if (!absoluteDir) {
      continue;
    }
    const realDir = fs.realpathSync(absoluteDir).toLowerCase();
    if (seenDirs.has(realDir)) {
      continue;
    }
    seenDirs.add(realDir);

    const files = fs
      .readdirSync(absoluteDir)
      .filter((file) => file.endsWith(".srt"))
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      const videoId = extractVideoId(file);
      if (!videoId) {
        continue;
      }

      const key = `${descriptor.source}:${videoId}`;
      if (cache.has(key)) {
        continue;
      }

      const absolutePath = path.join(absoluteDir, file);
      const relativePath = path.relative(ROOT, absolutePath).replace(/\\/g, "/");
      cache.set(key, {
        source: descriptor.source,
        fileName: file,
        relativePath,
        videoId,
        title: extractTitle(file),
        publishedAt: file.slice(0, 8),
        entries: parseSrt(absolutePath),
      });
    }
  }

  return cache;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function resetDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  ensureDir(dirPath);
}

function main() {
  const audit = JSON.parse(fs.readFileSync(AUDIT_INPUT, "utf8"));
  const transcriptCache = buildTranscriptCache();
  const recordsByCluster = new Map();

  for (const record of audit.records) {
    if (!recordsByCluster.has(record.clusterId)) {
      recordsByCluster.set(record.clusterId, []);
    }
    recordsByCluster.get(record.clusterId).push(record);
  }

  const clusterAnchors = [...recordsByCluster.values()]
    .map((records) => records.find((record) => record.clusterAnchor) ?? records[0])
    .sort((left, right) => {
      if (left.publishedAt === right.publishedAt) {
        return left.startSeconds - right.startSeconds;
      }
      return right.publishedAt.localeCompare(left.publishedAt);
    });

  const curatedRecords = clusterAnchors
    .filter((anchor) => anchor.auditStatus !== "drop")
    .filter((anchor) => anchor.semanticType === "prediction" || anchor.semanticType === "retrospective")
    .map((anchor) => {
      const clusterRecords = recordsByCluster.get(anchor.clusterId) ?? [anchor];
      const contextSentences = clusterRecords.flatMap((record) => sentenceCandidates(record.expandedContext));
      const topicCandidates = [
        ...clusterRecords.map((record) => record.topic),
        ...contextSentences.filter((sentence) => !SCAN_PATTERN.test(normalize(sentence))),
      ];
      const predictionCandidates = [
        ...clusterRecords.map((record) => record.prediction),
        ...contextSentences,
      ];

      const quote = cleanText(chooseBestQuote(clusterRecords) ?? anchor.quote);
      let topic = clipWords(
        pickBest(topicCandidates, scoreTopicCandidate, anchor.topic),
        24,
      );
      let prediction = clipWords(
        pickBest(
          predictionCandidates,
          (candidate) => scorePredictionCandidate(candidate, anchor.semanticType),
          anchor.prediction,
        ),
        28,
      );
      const topicScore = scoreTopicCandidate(topic);
      const predictionAsTopicScore = scoreTopicCandidate(prediction);
      if (
        (isWeakTopic(topic) || predictionAsTopicScore > topicScore + 2) &&
        !isWeakPrediction(prediction, anchor.semanticType)
      ) {
        topic = prediction;
      }
      if (!hasFutureHint(topic) && hasFutureHint(prediction)) {
        topic = prediction;
      }
      if (anchor.semanticType === "retrospective" && !isWeakPrediction(anchor.prediction, anchor.semanticType)) {
        prediction = clipWords(anchor.prediction, 28);
      }
      topic = distinctTopic(topicCandidates, prediction, topic, anchor.title);
      const context = clipWords(anchor.expandedContext, 110);
      const recommendedStartSeconds = anchor.recommendedStartSeconds;
      const recommendedEndSeconds = anchor.recommendedEndSeconds;
      const confidence = anchor.auditStatus === "keep" ? "high" : "medium";
      const reviewState = anchor.auditStatus === "keep" ? "validated" : "needs-review";

      return {
        id: anchor.clusterId,
        videoId: anchor.videoId,
        source: anchor.source ?? "public",
        title: anchor.title,
        publishedAt: anchor.publishedAt,
        quote,
        topic,
        prediction,
        context,
        timestamp: anchor.timestamp,
        timestampLabel: anchor.timestampLabel,
        startSeconds: anchor.startSeconds,
        clipStartSeconds: recommendedStartSeconds,
        clipStartLabel: anchor.recommendedStartLabel,
        clipEndSeconds: recommendedEndSeconds,
        clipEndLabel: anchor.recommendedEndLabel,
        youtubeUrl: anchor.youtubeUrl,
        contextYoutubeUrl: `https://www.youtube.com/watch?v=${anchor.videoId}&t=${recommendedStartSeconds}s`,
        videoUrl: anchor.videoUrl,
        thumbnailUrl: anchor.thumbnailUrl,
        confidence,
        reviewState,
        scanType: anchor.semanticType,
        clusterSize: anchor.clusterSize,
        sourceRecordIds: clusterRecords.map((record) => record.id),
        auditFlags: anchor.auditFlags,
        sourceFile: anchor.sourceFile,
        obsidianScanNote: scanNoteBaseName({
          source: anchor.source ?? "public",
          videoId: anchor.videoId,
          timestampLabel: anchor.timestampLabel,
          topic,
        }),
        obsidianVideoNote: videoNoteBaseName(anchor.source ?? "public", anchor.videoId, anchor.title),
        obsidianTranscriptNote: transcriptNoteBaseName(anchor.source ?? "public", anchor.videoId, anchor.title),
      };
    });

  const curatedMeta = {
    generatedAt: new Date().toISOString(),
    sourceAuditGeneratedAt: audit.meta.generatedAt,
    sourceTranscriptScanCount: audit.meta.includedCount,
    canonicalScanCount: curatedRecords.length,
    canonicalVideoCount: new Set(curatedRecords.map((record) => `${record.source}:${record.videoId}`)).size,
    semanticCounts: curatedRecords.reduce((accumulator, record) => {
      accumulator[record.scanType] = (accumulator[record.scanType] ?? 0) + 1;
      return accumulator;
    }, {}),
    reviewCounts: curatedRecords.reduce((accumulator, record) => {
      accumulator[record.reviewState] = (accumulator[record.reviewState] ?? 0) + 1;
      return accumulator;
    }, {}),
    sourceCounts: curatedRecords.reduce((accumulator, record) => {
      accumulator[record.source] = (accumulator[record.source] ?? 0) + 1;
      return accumulator;
    }, {}),
  };

  writeFile(CURATED_JSON_OUTPUT, JSON.stringify({ meta: curatedMeta, records: curatedRecords }, null, 2));
  writeFile(
    CURATED_JS_OUTPUT,
    `window.TEDDYSCAN_META = ${JSON.stringify(curatedMeta, null, 2)};\nwindow.TEDDYSCAN_DATA = ${JSON.stringify(
      curatedRecords,
      null,
      2,
    )};\n`,
  );

  resetDir(OBSIDIAN_INDEX_DIR);
  resetDir(OBSIDIAN_SCAN_DIR);
  resetDir(OBSIDIAN_VIDEO_DIR);
  resetDir(OBSIDIAN_TRANSCRIPT_DIR);

  for (const transcript of transcriptCache.values()) {
    const transcriptBaseName = transcriptNoteBaseName(transcript.source, transcript.videoId, transcript.title);
    const transcriptSections = buildTranscriptSections(transcript.entries);
    const transcriptBody = [
      "---",
      `type: ${yamlEscape("transcript")}`,
      `videoId: ${yamlEscape(transcript.videoId)}`,
      `source: ${yamlEscape(transcript.source)}`,
      `title: ${yamlEscape(transcript.title)}`,
      `publishedAt: ${yamlEscape(compactDateToFrench(transcript.publishedAt))}`,
      `sourceFile: ${yamlEscape(transcript.relativePath)}`,
      "---",
      "",
      `# ${transcript.title}`,
      "",
      `- Video YouTube: https://www.youtube.com/watch?v=${transcript.videoId}`,
      `- Source: ${transcript.source === "patreon" ? "Patreon" : "Public YouTube"}`,
      `- Date: ${compactDateToFrench(transcript.publishedAt)}`,
      `- Transcript nettoye et groupe par blocs de ${Math.floor(TRANSCRIPT_BUCKET_SECONDS / 60)} minutes.`,
      "",
      ...transcriptSections.flatMap((section) => [
        `## ${section.label}`,
        "",
        cleanText(section.lines.join(" ")),
        "",
      ]),
    ].join("\n");

    writeFile(path.join(OBSIDIAN_TRANSCRIPT_DIR, `${transcriptBaseName}.md`), transcriptBody);
  }

  const recordsByVideo = new Map();
  for (const record of curatedRecords) {
    const key = `${record.source}:${record.videoId}`;
    if (!recordsByVideo.has(key)) {
      recordsByVideo.set(key, []);
    }
    recordsByVideo.get(key).push(record);
  }

  for (const record of curatedRecords) {
    const scanNotePath = path.join(OBSIDIAN_SCAN_DIR, `${record.obsidianScanNote}.md`);
    const scanNoteBody = [
      "---",
      `type: ${yamlEscape("teddyscan")}`,
      `videoId: ${yamlEscape(record.videoId)}`,
      `clusterId: ${yamlEscape(record.id)}`,
      `scanType: ${yamlEscape(record.scanType)}`,
      `reviewState: ${yamlEscape(record.reviewState)}`,
      `source: ${yamlEscape(record.source)}`,
      `timecode: ${yamlEscape(record.timestampLabel)}`,
      `clipStart: ${yamlEscape(record.clipStartLabel)}`,
      `clipEnd: ${yamlEscape(record.clipEndLabel)}`,
      "---",
      "",
      `# ${record.topic}`,
      "",
      `- Video: ${obsidianLink(`02 Videos/${record.obsidianVideoNote}`, record.title)}`,
      `- Transcript: ${obsidianLink(`03 Transcripts/${record.obsidianTranscriptNote}`, "Transcript complet")}`,
      `- Type: ${record.scanType === "prediction" ? "Prediction" : "Rappel de scan"}`,
      `- Source: ${record.source === "patreon" ? "Patreon" : "Public YouTube"}`,
      `- Etat: ${record.reviewState === "validated" ? "Valide" : "Contexte elargi a relire"}`,
      `- Moment exact: ${record.timestampLabel}`,
      `- Fenetre conseillee: ${record.clipStartLabel} -> ${record.clipEndLabel}`,
      `- Lien contexte: ${record.contextYoutubeUrl}`,
      `- Lien exact: ${record.youtubeUrl}`,
      "",
      "## Citation",
      "",
      `> ${record.quote}`,
      "",
      "## Prediction",
      "",
      record.prediction,
      "",
      "## Contexte",
      "",
      record.context,
      "",
      "## Liens",
      "",
      ...record.sourceRecordIds.map((sourceId) => `- Source brute: ${sourceId}`),
      "",
    ].join("\n");

    writeFile(scanNotePath, scanNoteBody);
  }

  for (const [videoId, videoRecords] of recordsByVideo.entries()) {
    const first = videoRecords[0];
    const videoNotePath = path.join(OBSIDIAN_VIDEO_DIR, `${first.obsidianVideoNote}.md`);
    const transcriptLink = obsidianLink(`03 Transcripts/${first.obsidianTranscriptNote}`, "Transcript complet");
    const scanLinks = videoRecords
      .sort((left, right) => left.startSeconds - right.startSeconds)
      .flatMap((record) => [
        `## ${record.timestampLabel} - ${record.topic}`,
        "",
        `- Scan: ${obsidianLink(`01 Scans/${record.obsidianScanNote}`, record.scanType === "prediction" ? "Prediction" : "Rappel")}`,
        `- Etat: ${record.reviewState === "validated" ? "Valide" : "A relire"}`,
        `- Lien exact: ${record.youtubeUrl}`,
        `- Lien contexte: ${record.contextYoutubeUrl}`,
        "",
        record.prediction,
        "",
      ])
      .join("\n");

    const videoNoteBody = [
      "---",
      `type: ${yamlEscape("video")}`,
      `videoId: ${yamlEscape(videoId)}`,
      `title: ${yamlEscape(first.title)}`,
      `publishedAt: ${yamlEscape(compactDateToFrench(first.publishedAt))}`,
      `scanCount: ${videoRecords.length}`,
      `source: ${yamlEscape(first.source)}`,
      "---",
      "",
      `# ${first.title}`,
      "",
      `- Video YouTube: ${first.videoUrl}`,
      `- Date: ${compactDateToFrench(first.publishedAt)}`,
      `- Transcript: ${transcriptLink}`,
      `- Source: ${first.source === "patreon" ? "Patreon" : "Public YouTube"}`,
      `- Nombre de scans canoniques: ${videoRecords.length}`,
      "",
      scanLinks,
    ].join("\n");

    writeFile(videoNotePath, videoNoteBody);
  }

  const indexContent = [
    "# TeddyScan Radar - Obsidian",
    "",
    `Generation: ${curatedMeta.generatedAt}`,
    `Scans canoniques: ${curatedMeta.canonicalScanCount}`,
    `Videos concernees: ${curatedMeta.canonicalVideoCount}`,
    "",
    "## Index des scans",
    "",
    "| Date | Source | Type | Video | Timecode | Etat | Note |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...curatedRecords.map((record) => {
      const type = record.scanType === "prediction" ? "Prediction" : "Rappel";
      const source = record.source === "patreon" ? "Patreon" : "Public";
      const state = record.reviewState === "validated" ? "Valide" : "A relire";
      const note = obsidianLink(`01 Scans/${record.obsidianScanNote}`, clipWords(record.topic, 10));
      return `| ${markdownEscape(compactDateToFrench(record.publishedAt))} | ${source} | ${type} | ${markdownEscape(record.title)} | ${record.timestampLabel} | ${state} | ${note} |`;
    }),
    "",
    "## Index des videos",
    "",
    ...[...recordsByVideo.values()]
      .sort((left, right) => right[0].publishedAt.localeCompare(left[0].publishedAt))
      .map((videoRecords) => {
        const first = videoRecords[0];
        return `- ${obsidianLink(`02 Videos/${first.obsidianVideoNote}`, first.title)} (${videoRecords.length} scan${videoRecords.length > 1 ? "s" : ""})`;
      }),
    "",
    "## Notes",
    "",
    "- Les transcripts complets sont ranges dans `03 Transcripts`.",
    "- Les scans de type `meta` et `negated` restent dans l'audit, mais ne sont pas publies dans le site canonique.",
    "- Les scans `needs-review` meritent encore une validation manuelle, meme s'ils ont maintenant un contexte elargi.",
    "",
  ].join("\n");

  writeFile(path.join(OBSIDIAN_INDEX_DIR, "TeddyScans Radar.md"), indexContent);

  console.log(
    `Published ${curatedRecords.length} canonical TeddyScans and exported ${transcriptCache.size} transcript notes to Obsidian.`,
  );
}

main();
