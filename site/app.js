const data = Array.isArray(window.TEDDYSCAN_DATA) ? window.TEDDYSCAN_DATA : [];
const meta = window.TEDDYSCAN_META ?? {};

const state = {
  search: "",
  confidence: "all",
  type: "all",
  source: "all",
};

const grid = document.querySelector("#card-grid");
const template = document.querySelector("#scan-card-template");
const searchInput = document.querySelector("#search");
const resultCount = document.querySelector("#results-count");
const confidenceButtons = document.querySelectorAll("[data-confidence]");
const typeButtons = document.querySelectorAll("[data-type]");
const sourceButtons = document.querySelectorAll("[data-source]");

function formatFrenchDate(compactDate) {
  if (!compactDate || compactDate.length !== 8) {
    return "Date inconnue";
  }

  const isoDate = `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatGeneratedAt(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function confidenceLabel(value) {
  if (value === "high") {
    return "Valide";
  }
  if (value === "medium") {
    return "A relire";
  }
  return "Brouillon";
}

function typeLabel(value) {
  if (value === "retrospective") {
    return "Rappel";
  }
  return "Prediction";
}

function reviewLabel(value) {
  if (value === "validated") {
    return "Contexte valide";
  }
  return "Contexte elargi";
}

function isReadableTopic(value) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return false;
  }

  const words = cleaned.split(" ").filter(Boolean);
  if (words.length < 5 || cleaned.length < 28) {
    return false;
  }

  if (/^(?:euh|bah|bon|oui|ouais|du coup|alors|ben|voila)\b/i.test(cleaned)) {
    return false;
  }

  return true;
}

function cleanSentence(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
}

function stripWeakLead(value) {
  return cleanSentence(
    String(value ?? "").replace(/^(?:euh|bah|bon|oui|ouais|du coup|alors|ben|voila)[, ]+/i, ""),
  );
}

function clipWords(value, maxWords = 18) {
  const words = cleanSentence(value).split(" ").filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function titleFallback(value) {
  return cleanSentence(
    String(value ?? "")
      .replace(/\b(?:teddyscan|scan)\b/gi, " ")
      .replace(/[|:]/g, " ")
      .replace(/\s+/g, " "),
  );
}

function readableTopic(record) {
  const topic = cleanSentence(record.topic);
  if (isReadableTopic(topic)) {
    return topic;
  }

  const fromPrediction = stripWeakLead(record.prediction);
  if (isReadableTopic(fromPrediction)) {
    if ((record.scanType ?? "prediction") === "retrospective") {
      return `Retour sur un scan: ${clipWords(fromPrediction, 20)}`;
    }
    return `Hypothese: ${clipWords(fromPrediction, 20)}`;
  }

  const fromTitle = titleFallback(record.title);
  if (fromTitle) {
    return `Sujet: ${clipWords(fromTitle, 14)}`;
  }

  return "Sujet a clarifier";
}

function sourceLabel(value) {
  if (value === "patreon") {
    return "Patreon";
  }
  return "Public";
}

function updateStats(records) {
  document.querySelector('[data-stat="count"]').textContent = String(records.length);
  document.querySelector('[data-stat="videos"]').textContent = String(
    new Set(records.map((record) => record.videoId)).size,
  );
  document.querySelector('[data-stat="generated"]').textContent = formatGeneratedAt(meta.generatedAt);
}

function matchesSearch(record, search) {
  if (!search) {
    return true;
  }

  const haystack = [
    record.title,
    record.topic,
    record.prediction,
    record.context,
    record.quote,
    record.scanType,
    record.source,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
}

function applyFilters(records) {
  return records.filter((record) => {
    const confidenceOk =
      state.confidence === "all" ? true : record.confidence === state.confidence;
    const typeOk = state.type === "all" ? true : record.scanType === state.type;
    const sourceOk = state.source === "all" ? true : (record.source ?? "public") === state.source;

    return confidenceOk && typeOk && sourceOk && matchesSearch(record, state.search);
  });
}

function createEmptyState() {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent =
    "Aucun TeddyScan canonique ne correspond aux filtres actuels. Essaie une autre recherche ou elargis les filtres.";
  return empty;
}

function renderCards(records) {
  grid.replaceChildren();
  resultCount.textContent = `${records.length} carte${records.length > 1 ? "s" : ""}`;

  if (records.length === 0) {
    grid.appendChild(createEmptyState());
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const record of records) {
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector(".scan-card");
    const thumbLink = clone.querySelector('[data-role="thumb-link"]');
    const thumb = clone.querySelector('[data-role="thumb"]');
    const confidence = clone.querySelector('[data-role="confidence"]');
    const timeLink = clone.querySelector('[data-role="time-link"]');
    const videoLink = clone.querySelector('[data-role="video-link"]');
    const type = clone.querySelector('[data-role="type"]');
    const source = clone.querySelector('[data-role="source"]');
    const review = clone.querySelector('[data-role="review"]');

    thumbLink.href = record.contextYoutubeUrl ?? record.youtubeUrl;
    thumb.src = record.thumbnailUrl;
    thumb.alt = `Miniature de ${record.title}`;

    confidence.textContent = confidenceLabel(record.confidence);
    confidence.dataset.confidence = record.confidence;

    type.textContent = typeLabel(record.scanType);
    source.textContent = sourceLabel(record.source ?? "public");
    source.dataset.source = record.source ?? "public";
    review.textContent = reviewLabel(record.reviewState);

    clone.querySelector('[data-role="date"]').textContent = formatFrenchDate(record.publishedAt);
    clone.querySelector('[data-role="timecode"]').textContent = record.timestampLabel;
    clone.querySelector('[data-role="title"]').textContent = record.title;
    clone.querySelector('[data-role="quote"]').textContent = `"${record.quote}"`;
    clone.querySelector('[data-role="topic"]').textContent = readableTopic(record);
    clone.querySelector('[data-role="prediction"]').textContent = record.prediction;
    clone.querySelector('[data-role="context"]').textContent = record.context;
    clone.querySelector('[data-role="clip-window"]').textContent =
      `${record.clipStartLabel} -> ${record.clipEndLabel}`;

    timeLink.href = record.contextYoutubeUrl ?? record.youtubeUrl;
    videoLink.href = record.youtubeUrl;

    card.dataset.confidence = record.confidence;
    card.dataset.type = record.scanType;
    fragment.appendChild(clone);
  }

  grid.appendChild(fragment);
}

function setActive(buttons, activeButton) {
  buttons.forEach((button) => {
    button.classList.toggle("chip--active", button === activeButton);
  });
}

function render() {
  const filtered = applyFilters(data);
  updateStats(filtered);
  renderCards(filtered);
}

searchInput?.addEventListener("input", (event) => {
  state.search = event.currentTarget.value.trim();
  render();
});

confidenceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.confidence = button.dataset.confidence;
    setActive(confidenceButtons, button);
    render();
  });
});

typeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.type = button.dataset.type;
    setActive(typeButtons, button);
    render();
  });
});

sourceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.source = button.dataset.source;
    setActive(sourceButtons, button);
    render();
  });
});

render();
