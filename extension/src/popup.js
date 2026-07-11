import { ApiError, fetchVideoMetadata, searchCommentThreads } from "./api.js";
import { apiErrorMessage, commentView, isDeferredChannelPage, videoIdFromUrl, videoMetadata } from "./shared.js";

const CONSENT_STORAGE_KEY = "privacyConsentVersion";
const PRIVACY_POLICY_VERSION = "2026-07-11";

const elements = {
  acceptConsent: document.querySelector("#accept-consent"),
  app: document.querySelector("#app"),
  channelTitle: document.querySelector("#channel-title"),
  consentCheckbox: document.querySelector("#consent-checkbox"),
  keyword: document.querySelector("#keyword"),
  loadMore: document.querySelector("#load-more"),
  pageContext: document.querySelector("#page-context"),
  privacyGate: document.querySelector("#privacy-gate"),
  resultList: document.querySelector("#result-list"),
  resultsSection: document.querySelector("#results-section"),
  searchButton: document.querySelector("#search-button"),
  searchForm: document.querySelector("#search-form"),
  status: document.querySelector("#status"),
  videoMetadata: document.querySelector("#video-metadata"),
  videoTitle: document.querySelector("#video-title"),
};

const state = {
  controller: null,
  metadata: null,
  nextPageToken: null,
  requestSequence: 0,
  videoId: null,
};

function setStatus(message, stateName = "") {
  elements.status.textContent = message;
  elements.status.dataset.state = stateName;
}

function setSearchControls(enabled, loading = false) {
  elements.keyword.disabled = !enabled || loading;
  elements.searchButton.disabled = !enabled || loading;
  elements.loadMore.disabled = loading;
}

function setLoadMoreVisibility() {
  elements.loadMore.hidden = !state.nextPageToken;
}

function showVideoMetadata() {
  elements.videoTitle.textContent = state.metadata.title;
  elements.channelTitle.textContent = state.metadata.channelTitle;
  elements.videoMetadata.hidden = false;
}

function renderComment(thread) {
  const view = commentView(thread, state.videoId);

  if (!view) {
    return null;
  }

  const card = document.createElement("article");
  card.className = "comment-card";

  const text = document.createElement("p");
  text.className = "comment-text";
  text.textContent = view.text;
  card.append(text);

  const meta = document.createElement("div");
  meta.className = "comment-meta";

  const author = document.createElement(view.authorChannelUrl ? "a" : "span");
  author.textContent = view.authorName;
  if (view.authorChannelUrl) {
    author.href = view.authorChannelUrl;
    author.target = "_blank";
    author.rel = "noreferrer";
  }
  meta.append(author);

  const likes = document.createElement("span");
  likes.textContent = `${new Intl.NumberFormat().format(view.likeCount)} likes`;
  meta.append(likes);

  const published = document.createElement("time");
  if (view.publishedAt) {
    const date = new Date(view.publishedAt);
    if (!Number.isNaN(date.getTime())) {
      published.dateTime = date.toISOString();
      published.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
    } else {
      published.textContent = "Date unavailable";
    }
  } else {
    published.textContent = "Date unavailable";
  }
  meta.append(published);

  const source = document.createElement("a");
  source.className = "youtube-link";
  source.href = view.commentUrl;
  source.target = "_blank";
  source.rel = "noreferrer";
  source.textContent = "View on YouTube";
  meta.append(source);

  card.append(meta);
  return card;
}

function renderPage(response, append) {
  const fragment = document.createDocumentFragment();
  let renderedCount = 0;

  for (const thread of Array.isArray(response.items) ? response.items : []) {
    const card = renderComment(thread);
    if (card) {
      fragment.append(card);
      renderedCount += 1;
    }
  }

  if (!append) {
    elements.resultList.replaceChildren();
  }
  elements.resultList.append(fragment);

  state.nextPageToken = typeof response.nextPageToken === "string" ? response.nextPageToken : null;
  setLoadMoreVisibility();

  if (renderedCount === 0 && !append) {
    elements.resultsSection.hidden = true;
    setStatus("No matching comments were returned for this keyword.");
    return;
  }

  elements.resultsSection.hidden = false;
  setStatus(append ? "More comments loaded." : "Matching comments loaded.");
}

function stopCurrentRequest() {
  state.controller?.abort();
  state.controller = null;
}

async function loadMetadata(sequence, signal) {
  if (state.metadata) {
    return true;
  }

  const response = await fetchVideoMetadata(state.videoId, signal);
  if (sequence !== state.requestSequence) {
    return false;
  }

  state.metadata = videoMetadata(response);
  if (!state.metadata) {
    setStatus("Video details are unavailable through the YouTube Data API.", "error");
    return false;
  }

  showVideoMetadata();
  return true;
}

async function search(pageToken = null) {
  const searchTerms = elements.keyword.value.trim();
  if (!searchTerms) {
    setStatus("Enter a keyword or phrase to search.", "error");
    elements.keyword.focus();
    return;
  }

  stopCurrentRequest();
  state.requestSequence += 1;
  const sequence = state.requestSequence;
  const controller = new AbortController();
  state.controller = controller;
  setSearchControls(true, true);
  setStatus(pageToken ? "Loading more comments…" : "Searching comments…");

  if (!pageToken) {
    state.nextPageToken = null;
    setLoadMoreVisibility();
    elements.resultsSection.hidden = true;
    elements.resultList.replaceChildren();
  }

  try {
    if (!(await loadMetadata(sequence, controller.signal))) {
      return;
    }

    const response = await searchCommentThreads(state.videoId, searchTerms, pageToken, controller.signal);
    if (sequence !== state.requestSequence) {
      return;
    }

    renderPage(response, Boolean(pageToken));
  } catch (error) {
    if (sequence !== state.requestSequence) {
      return;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }

    if (error instanceof ApiError || error instanceof TypeError) {
      setStatus(apiErrorMessage(error), "error");
      return;
    }

    throw error;
  } finally {
    if (sequence === state.requestSequence) {
      state.controller = null;
      setSearchControls(true);
    }
  }
}

async function showApplication() {
  elements.privacyGate.hidden = true;
  elements.app.hidden = false;

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const pageUrl = tab?.url;
  state.videoId = typeof pageUrl === "string" ? videoIdFromUrl(pageUrl) : null;

  if (!state.videoId) {
    setSearchControls(false);
    elements.pageContext.textContent = typeof pageUrl === "string" && isDeferredChannelPage(pageUrl)
      ? "Channel search is planned next. Open a video page to search comments now."
      : "Open a YouTube watch page, then reopen this popup.";
    return;
  }

  elements.pageContext.textContent = "Ready to search public comments for this video.";
  setSearchControls(true);
}

async function initialize() {
  const stored = await chrome.storage.local.get(CONSENT_STORAGE_KEY);
  if (stored[CONSENT_STORAGE_KEY] !== PRIVACY_POLICY_VERSION) {
    elements.privacyGate.hidden = false;
    return;
  }

  await showApplication();
}

elements.consentCheckbox.addEventListener("change", () => {
  elements.acceptConsent.disabled = !elements.consentCheckbox.checked;
});

elements.acceptConsent.addEventListener("click", async () => {
  await chrome.storage.local.set({ [CONSENT_STORAGE_KEY]: PRIVACY_POLICY_VERSION });
  await showApplication();
});

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void search();
});

elements.loadMore.addEventListener("click", () => {
  if (state.nextPageToken) {
    void search(state.nextPageToken);
  }
});

void initialize();
