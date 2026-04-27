import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INPUT = path.join(ROOT, "site", "data", "teddyscans.json");
const OUTPUT_JSON = path.join(ROOT, "site", "data", "teddyscan-audit.json");
const OUTPUT_MD = path.join(ROOT, "TEDDYSCAN_AUDIT.md");
const CLUSTER_GAP_SECONDS = 20;
const CONTEXT_BEFORE_SECONDS = 18;
const CONTEXT_AFTER_SECONDS = 55;

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
  " va revenir",
  " se presenter",
  " se reconvertir",
  " ecroulement",
];
const NEGATION_HINTS = [
  "pas du tout un tiscan",
  "pas du tout un teddyscan",
  "pas du tout un scan",
  "c est pas un tiscan",
  "c est pas un scan",
  "ce n est pas un tiscan",
  "ce n est pas un scan",
];
const RETROSPECTIVE_HINTS = [
  "je vous l avais dit",
  "j avais fait un td scan",
  "j avais fait un te scan",
  "j avais fait un scan",
  "j en ai parle",
  "scan a eu raison",
  "scan qui est visiblement correct",
  "on me l a encore dit",
  "c etait petit scan",
  "je viens de m en rappeler",
];
const META_HINTS = [
  "ce soir",
  "live",
  "en prive",
  "pour vous",
  "scan secret",
  "bouton qui marche pas",
  "attention attention les yeux",
  "allez on y va",
  "on est en mode",
];
const UNCERTAIN_HINTS = [
  "je sais pas si c est un tiscan",
  "je sais pas si c est un scan",
  "peut etre un petit tiscan",
  "peut etre un petit scan",
];

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
  return String(value ?? "")
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
      start,
      end,
      startSeconds: timecodeToSeconds(start),
      text,
      normalized: normalize(text),
    });
  }

  return entries;
}

function findEntryIndex(entries, startSeconds) {
  const exact = entries.findIndex((entry) => entry.startSeconds === startSeconds);
  if (exact !== -1) {
    return exact;
  }

  let nearestIndex = -1;
  let nearestGap = Number.POSITIVE_INFINITY;
  for (let index = 0; index < entries.length; index += 1) {
    const gap = Math.abs(entries[index].startSeconds - startSeconds);
    if (gap < nearestGap) {
      nearestGap = gap;
      nearestIndex = index;
    }
  }

  return nearestGap <= 2 ? nearestIndex : -1;
}

function textWindow(entries, startSeconds, endSeconds) {
  return entries.filter(
    (entry) => entry.startSeconds >= startSeconds && entry.startSeconds <= endSeconds,
  );
}

function clipWords(value, maxWords = 40) {
  const words = cleanText(value).split(" ").filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function quoteCoreLength(quote) {
  return normalize(quote)
    .replace(SCAN_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

function hasFutureHint(text) {
  const normalized = ` ${normalize(text)} `;
  return FUTURE_HINTS.some((hint) => normalized.includes(hint));
}

function hasNegation(text) {
  const normalized = normalize(text);
  return NEGATION_HINTS.some((hint) => normalized.includes(hint));
}

function containsHint(text, hints) {
  const normalized = normalize(text);
  return hints.some((hint) => normalized.includes(hint));
}

function looksWeakTopic(topic) {
  const normalized = normalize(topic);
  if (!normalized || normalized === "contexte a confirmer") {
    return true;
  }
  if (normalized.length < 16) {
    return true;
  }
  return SCAN_PATTERN.test(normalized);
}

function looksWeakPrediction(prediction) {
  const normalized = normalize(prediction);
  if (!normalized || normalized.length < 18) {
    return true;
  }
  return !hasFutureHint(prediction) && SCAN_PATTERN.test(normalized);
}

function buildClusters(records) {
  const clusters = [];

  for (const record of records) {
    const current = clusters[clusters.length - 1];
    if (
      current &&
      current.source === (record.source ?? "public") &&
      current.videoId === record.videoId &&
      record.startSeconds - current.endSeconds <= CLUSTER_GAP_SECONDS
    ) {
      current.records.push(record);
      current.endSeconds = record.startSeconds;
      continue;
    }

    clusters.push({
      source: record.source ?? "public",
      videoId: record.videoId,
      title: record.title,
      sourceFile: record.sourceFile,
      startSeconds: record.startSeconds,
      endSeconds: record.startSeconds,
      records: [record],
    });
  }

  return clusters.map((cluster, index) => ({
    ...cluster,
    clusterId: `${cluster.source}-${cluster.videoId}-cluster-${index + 1}`,
  }));
}

function recommendStatus(record, cluster, expandedContext) {
  const flags = [];
  const quoteShort = record.quote.split(/\s+/).filter(Boolean).length <= 5 || quoteCoreLength(record.quote) < 10;
  const weakTopic = looksWeakTopic(record.topic);
  const weakPrediction = looksWeakPrediction(record.prediction);
  const hasFuture = hasFutureHint(expandedContext);
  const negated = hasNegation(expandedContext);
  const retrospective = containsHint(expandedContext, RETROSPECTIVE_HINTS);
  const meta = containsHint(expandedContext, META_HINTS);
  const uncertain = containsHint(expandedContext, UNCERTAIN_HINTS);
  const duplicateCluster = cluster.records.length > 1;
  const clusterAnchor = cluster.records[0].id === record.id;

  if (negated) {
    flags.push("negated_scan");
  }
  if (retrospective) {
    flags.push("retrospective_scan");
  }
  if (meta) {
    flags.push("meta_scan");
  }
  if (uncertain) {
    flags.push("uncertain_scan");
  }
  if (duplicateCluster) {
    flags.push("duplicate_cluster");
  }
  if (quoteShort) {
    flags.push("quote_too_short");
  }
  if (weakTopic) {
    flags.push("weak_topic");
  }
  if (weakPrediction) {
    flags.push("weak_prediction");
  }
  if (!hasFuture) {
    flags.push("no_future_hint_in_expanded_context");
  }

  let semanticType = "prediction";
  if (negated) {
    semanticType = "negated";
  } else if (uncertain) {
    semanticType = "uncertain";
  } else if (meta) {
    semanticType = "meta";
  } else if (retrospective) {
    semanticType = "retrospective";
  }

  let status = "keep";

  if (negated) {
    status = "drop";
  } else if (duplicateCluster && !clusterAnchor) {
    status = "merge";
  } else if (
    quoteShort ||
    weakTopic ||
    weakPrediction ||
    !hasFuture ||
    duplicateCluster ||
    meta ||
    uncertain
  ) {
    status = "expand";
  }

  return { status, flags, semanticType };
}

function mdEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

function main() {
  const data = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const records = [...data.records].sort((left, right) => {
    const leftSource = left.source ?? "public";
    const rightSource = right.source ?? "public";
    if (leftSource !== rightSource) {
      return leftSource.localeCompare(rightSource);
    }
    if (left.videoId === right.videoId) {
      return left.startSeconds - right.startSeconds;
    }
    return left.videoId.localeCompare(right.videoId);
  });

  const parsedSrtCache = new Map();
  const clusters = buildClusters(records);
  const clusterByRecordId = new Map();

  for (const cluster of clusters) {
    for (const record of cluster.records) {
      clusterByRecordId.set(record.id, cluster);
    }
  }

  const auditedRecords = records.map((record) => {
    const sourcePath = path.join(ROOT, record.sourceFile);
    if (!parsedSrtCache.has(sourcePath)) {
      parsedSrtCache.set(sourcePath, parseSrt(sourcePath));
    }

    const entries = parsedSrtCache.get(sourcePath);
    const entryIndex = findEntryIndex(entries, record.startSeconds);
    const cluster = clusterByRecordId.get(record.id);

    const recommendedStartSeconds = Math.max(
      0,
      cluster.startSeconds - CONTEXT_BEFORE_SECONDS,
    );
    const recommendedEndSeconds = cluster.endSeconds + CONTEXT_AFTER_SECONDS;
    const expandedEntries = textWindow(entries, recommendedStartSeconds, recommendedEndSeconds);
    const expandedContext = cleanText(expandedEntries.map((entry) => entry.text).join(" "));
    const { status, flags, semanticType } = recommendStatus(record, cluster, expandedContext);

    return {
      ...record,
      source: record.source ?? "public",
      auditStatus: status,
      auditFlags: flags,
      semanticType,
      clusterId: cluster.clusterId,
      clusterSize: cluster.records.length,
      clusterAnchor: cluster.records[0].id === record.id,
      matchedTranscriptEntry: entryIndex !== -1 ? entries[entryIndex].text : null,
      recommendedStartSeconds,
      recommendedStartLabel: formatTimecode(recommendedStartSeconds),
      recommendedEndSeconds,
      recommendedEndLabel: formatTimecode(recommendedEndSeconds),
      expandedContext: clipWords(expandedContext, 180),
    };
  });

  const statusCounts = auditedRecords.reduce((accumulator, record) => {
    accumulator[record.auditStatus] = (accumulator[record.auditStatus] ?? 0) + 1;
    return accumulator;
  }, {});
  const semanticCounts = auditedRecords.reduce((accumulator, record) => {
    accumulator[record.semanticType] = (accumulator[record.semanticType] ?? 0) + 1;
    return accumulator;
  }, {});

  const auditPayload = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceGeneratedAt: data.meta.generatedAt,
      scannedVideos: data.meta.scannedVideos,
      includedCount: data.meta.includedCount,
      auditedClusters: clusters.length,
      statusCounts,
      semanticCounts,
    },
    records: auditedRecords,
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(auditPayload, null, 2));

  const markdown = [
    "# TeddyScan Audit",
    "",
    `Generated: ${auditPayload.meta.generatedAt}`,
    `Source dataset: ${auditPayload.meta.sourceGeneratedAt}`,
    "",
    `Records audited: ${auditedRecords.length}`,
    `Clusters detected: ${clusters.length}`,
    `Keep: ${statusCounts.keep ?? 0}`,
    `Expand: ${statusCounts.expand ?? 0}`,
    `Merge: ${statusCounts.merge ?? 0}`,
    `Drop: ${statusCounts.drop ?? 0}`,
    "",
    `Predictions: ${semanticCounts.prediction ?? 0}`,
    `Retrospectives: ${semanticCounts.retrospective ?? 0}`,
    `Meta scans: ${semanticCounts.meta ?? 0}`,
    `Uncertain: ${semanticCounts.uncertain ?? 0}`,
    `Negated: ${semanticCounts.negated ?? 0}`,
    "",
    "| Status | Type | Video | Timecode | Cluster | Flags | Topic | Prediction |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...auditedRecords.map((record) => {
      const flags = record.auditFlags.join(", ");
      return `| ${mdEscape(record.auditStatus)} | ${mdEscape(record.semanticType)} | ${mdEscape(`${record.source}:${record.videoId}`)} | ${mdEscape(record.timestampLabel)} | ${mdEscape(record.clusterId)} | ${mdEscape(flags)} | ${mdEscape(clipWords(record.topic, 16))} | ${mdEscape(clipWords(record.prediction, 20))} |`;
    }),
    "",
    "## Detailed Review",
    "",
    ...auditedRecords.flatMap((record) => [
      `### ${record.videoId} ${record.timestampLabel} [${record.auditStatus}]`,
      "",
      `- Title: ${record.title}`,
      `- Source: ${record.source}`,
      `- Cluster: ${record.clusterId} (${record.clusterSize} occurrence${record.clusterSize > 1 ? "s" : ""})`,
      `- Current quote: ${record.quote}`,
      `- Current topic: ${record.topic}`,
      `- Current prediction: ${record.prediction}`,
      `- Type: ${record.semanticType}`,
      `- Suggested clip: ${record.recommendedStartLabel} -> ${record.recommendedEndLabel}`,
      `- Flags: ${record.auditFlags.join(", ") || "none"}`,
      `- Expanded context: ${record.expandedContext}`,
      "",
    ]),
  ].join("\n");

  fs.writeFileSync(OUTPUT_MD, markdown);
  console.log(`Audited ${auditedRecords.length} TeddyScan entries into ${clusters.length} clusters.`);
}

main();
