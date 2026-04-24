const data = Array.isArray(window.TEDDYSCAN_DATA) ? window.TEDDYSCAN_DATA : [];
const meta = window.TEDDYSCAN_META ?? {};

const state = {
  search: "",
  confidence: "all",
};

const grid = document.querySelector("#card-grid");
const template = document.querySelector("#scan-card-template");
const searchInput = document.querySelector("#search");
const resultCount = document.querySelector("#results-count");
const confidenceButtons = document.querySelectorAll("[data-confidence]");

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
    return "Fort";
  }
  if (value === "medium") {
    return "Probable";
  }
  return "À revoir";
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

  const haystack = [record.title, record.topic, record.prediction, record.context, record.quote]
    .join(" ")
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
}

function applyFilters(records) {
  return records.filter((record) => {
    const confidenceOk =
      state.confidence === "all" ? true : record.confidence === state.confidence;

    return confidenceOk && matchesSearch(record, state.search);
  });
}

function createEmptyState() {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent =
    "Aucun TeddyScan ne correspond aux filtres actuels. Essaie une autre recherche ou élargis la confiance.";
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

    thumbLink.href = record.youtubeUrl;
    thumb.src = record.thumbnailUrl;
    thumb.alt = `Miniature de ${record.title}`;

    confidence.textContent = confidenceLabel(record.confidence);
    confidence.dataset.confidence = record.confidence;

    clone.querySelector('[data-role="date"]').textContent = formatFrenchDate(record.publishedAt);
    clone.querySelector('[data-role="timecode"]').textContent = record.timestampLabel;
    clone.querySelector('[data-role="title"]').textContent = record.title;
    clone.querySelector('[data-role="quote"]').textContent = `“${record.quote}”`;
    clone.querySelector('[data-role="topic"]').textContent = record.topic;
    clone.querySelector('[data-role="prediction"]').textContent = record.prediction;
    clone.querySelector('[data-role="context"]').textContent = record.context;

    timeLink.href = record.youtubeUrl;
    videoLink.href = record.videoUrl;

    card.dataset.confidence = record.confidence;
    fragment.appendChild(clone);
  }

  grid.appendChild(fragment);
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

    confidenceButtons.forEach((item) => {
      item.classList.toggle("chip--active", item === button);
    });

    render();
  });
});

render();
