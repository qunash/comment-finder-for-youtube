import { ApiError, fetchVideoMetadata, searchCommentThreads } from "./api.js";
import { PAGE_ORDER_KEY, isPageState, nextPageOrder, pageStorageKey } from "./page-state.js";
import { apiErrorMessage, commentView, isDeferredChannelPage, relativeTimeFrom, videoIdFromUrl, videoMetadata } from "./shared.js";

const CONSENT_STORAGE_KEY = "privacyConsentVersion";
const PRIVACY_POLICY_VERSION = "2026-07-11-session";

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
  videoCommentCount: document.querySelector("#video-comment-count"),
  videoCommentCountValue: document.querySelector("#video-comment-count-value"),
  videoMetadata: document.querySelector("#video-metadata"),
  videoTitle: document.querySelector("#video-title"),
};

const state = {
  comments: [],
  controller: null,
  metadata: null,
  nextPageToken: null,
  persistQueue: Promise.resolve(),
  requestSequence: 0,
  videoId: null,
};

const ICON_PATHS = {
  like:
    "M19.017 31.992c-9.088 0-9.158-0.377-10.284-1.224-0.597-0.449-1.723-0.76-5.838-1.028-0.298-0.020-0.583-0.134-0.773-0.365-0.087-0.107-2.143-3.105-2.143-7.907 0-4.732 1.472-6.89 1.534-6.99 0.182-0.293 0.503-0.47 0.847-0.47 3.378 0 8.062-4.313 11.21-11.841 0.544-1.302 0.657-2.159 2.657-2.159 1.137 0 2.413 0.815 3.042 1.86 1.291 2.135 0.636 6.721 0.029 9.171 2.063-0.017 5.796-0.045 7.572-0.045 2.471 0 4.107 1.473 4.156 3.627 0.017 0.711-0.077 1.619-0.282 2.089 0.544 0.543 1.245 1.36 1.276 2.414 0.038 1.36-0.852 2.395-1.421 2.989 0.131 0.395 0.391 0.92 0.366 1.547-0.063 1.542-1.253 2.535-1.994 3.054 0.061 0.422 0.11 1.218-0.026 1.834-0.535 2.457-4.137 3.443-9.928 3.443zM3.426 27.712c3.584 0.297 5.5 0.698 6.51 1.459 0.782 0.589 0.662 0.822 9.081 0.822 2.568 0 7.59-0.107 7.976-1.87 0.153-0.705-0.59-1.398-0.593-1.403-0.203-0.501 0.023-1.089 0.518-1.305 0.008-0.004 2.005-0.719 2.050-1.835 0.030-0.713-0.46-1.142-0.471-1.16-0.291-0.452-0.185-1.072 0.257-1.38 0.005-0.004 1.299-0.788 1.267-1.857-0.024-0.849-1.143-1.447-1.177-1.466-0.25-0.143-0.432-0.39-0.489-0.674-0.056-0.282 0.007-0.579 0.183-0.808 0 0 0.509-0.808 0.49-1.566-0.037-1.623-1.782-1.674-2.156-1.674-2.523 0-9.001 0.025-9.001 0.025-0.349 0.002-0.652-0.164-0.84-0.443s-0.201-0.627-0.092-0.944c0.977-2.813 1.523-7.228 0.616-8.736-0.267-0.445-0.328-0.889-1.328-0.889-0.139 0-0.468 0.11-0.812 0.929-3.341 7.995-8.332 12.62-12.421 13.037-0.353 0.804-1.016 2.47-1.016 5.493 0 3.085 0.977 5.473 1.447 6.245z",
  replies: "M12 15.41L6.71 10.12 8.12 8.71 12 12.59l3.88-3.88 1.41 1.41z",
};

function setStatus(message, stateName = "") {
  elements.status.textContent = message;
  elements.status.dataset.state = stateName;
}

function setSearchControls(enabled, loading = false) {
  elements.keyword.disabled = !enabled || loading;
  elements.searchButton.disabled = !enabled || loading;
  elements.searchButton.classList.toggle("is-loading", loading);
  elements.loadMore.disabled = loading;
  elements.loadMore.classList.toggle("is-loading", loading);
}

function setLoadMoreVisibility() {
  elements.loadMore.hidden = !state.nextPageToken;
}

function showVideoSkeleton() {
  elements.videoTitle.textContent = "";
  elements.channelTitle.textContent = "";
  elements.videoCommentCountValue.textContent = "";
  elements.videoCommentCount.hidden = true;
  elements.videoMetadata.classList.add("is-skeleton");
  elements.pageContext.hidden = true;
  elements.videoMetadata.hidden = false;
}

function showVideoMetadata() {
  elements.videoMetadata.classList.remove("is-skeleton");
  elements.videoTitle.textContent = state.metadata.title;
  elements.channelTitle.textContent = state.metadata.channelTitle;

  const { commentCount } = state.metadata;
  const hasCount = typeof commentCount === "number";
  elements.videoCommentCount.hidden = !hasCount;
  if (hasCount) {
    const formatted = new Intl.NumberFormat().format(commentCount);
    elements.videoCommentCountValue.textContent = formatted;
    elements.videoCommentCount.setAttribute(
      "aria-label",
      commentCount === 1 ? "1 comment" : `${formatted} comments`,
    );
  } else {
    elements.videoCommentCountValue.textContent = "";
  }

  elements.pageContext.hidden = true;
  elements.videoMetadata.hidden = false;
}

function showContextMessage(message) {
  elements.videoMetadata.classList.remove("is-skeleton");
  elements.pageContext.hidden = false;
  elements.pageContext.textContent = message;
  elements.videoMetadata.hidden = true;
}

function svgIcon(pathData, viewBox = "0 0 24 24") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  svg.append(path);
  return svg;
}

function actionStat(iconPath, label, countText = null, viewBox = "0 0 24 24") {
  const stat = document.createElement("span");
  stat.className = "comment-action is-static";
  stat.setAttribute("aria-label", label);
  stat.append(svgIcon(iconPath, viewBox));
  if (countText) {
    const count = document.createElement("span");
    count.textContent = countText;
    stat.append(count);
  }
  return stat;
}

function commentTextNodes(text, query) {
  if (!query) {
    return [document.createTextNode(text)];
  }

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const nodes = [];
  let from = 0;
  let at = haystack.indexOf(needle, from);

  while (at !== -1) {
    if (at > from) {
      nodes.push(document.createTextNode(text.slice(from, at)));
    }
    const mark = document.createElement("mark");
    mark.className = "comment-match";
    mark.textContent = text.slice(at, at + needle.length);
    nodes.push(mark);
    from = at + needle.length;
    at = haystack.indexOf(needle, from);
  }

  if (from < text.length) {
    nodes.push(document.createTextNode(text.slice(from)));
  }

  return nodes;
}

function revealReadMore(comment) {
  const text = comment.querySelector(".comment-text");
  if (!text || !text.classList.contains("is-collapsed")) {
    return;
  }

  text.classList.remove("is-collapsed");
  const fullHeight = text.scrollHeight;
  text.classList.add("is-collapsed");
  if (fullHeight <= text.clientHeight) {
    return;
  }

  const readMore = document.createElement("button");
  readMore.type = "button";
  readMore.className = "comment-read-more";
  readMore.textContent = "Read more";
  readMore.addEventListener("click", () => {
    text.classList.remove("is-collapsed");
    readMore.remove();
  });
  text.after(readMore);
}

function renderCommentView(view, query) {
  const comment = document.createElement("article");
  comment.className = "comment";

  if (view.authorProfileImageUrl) {
    const avatar = document.createElement(view.authorChannelUrl ? "a" : "span");
    if (view.authorChannelUrl) {
      avatar.href = view.authorChannelUrl;
      avatar.target = "_blank";
      avatar.rel = "noreferrer";
    }
    const image = document.createElement("img");
    image.className = "comment-avatar";
    image.src = view.authorProfileImageUrl;
    image.alt = "";
    image.width = 40;
    image.height = 40;
    image.referrerPolicy = "no-referrer";
    avatar.append(image);
    comment.append(avatar);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "comment-avatar-fallback";
    fallback.textContent = view.authorName.slice(0, 1).toUpperCase();
    fallback.setAttribute("aria-hidden", "true");
    comment.append(fallback);
  }

  const body = document.createElement("div");
  body.className = "comment-body";

  const header = document.createElement("div");
  header.className = "comment-header";

  const author = document.createElement(view.authorChannelUrl ? "a" : "span");
  author.className = "comment-author";
  author.textContent = view.authorName;
  if (view.authorChannelUrl) {
    author.href = view.authorChannelUrl;
    author.target = "_blank";
    author.rel = "noreferrer";
  }
  header.append(author);

  const publishedLink = document.createElement("a");
  publishedLink.className = "comment-time";
  publishedLink.href = view.commentUrl;
  publishedLink.target = "_blank";
  publishedLink.rel = "noreferrer";
  const published = document.createElement("time");
  if (view.publishedAt) {
    const date = new Date(view.publishedAt);
    if (!Number.isNaN(date.getTime())) {
      published.dateTime = date.toISOString();
      published.textContent = relativeTimeFrom(view.publishedAt) ?? "Date unavailable";
    } else {
      published.textContent = "Date unavailable";
    }
  } else {
    published.textContent = "Date unavailable";
  }
  publishedLink.append(published);
  header.append(publishedLink);
  body.append(header);

  const text = document.createElement("p");
  text.className = "comment-text is-collapsed";
  text.append(...commentTextNodes(view.text, query));
  body.append(text);

  const actions = document.createElement("div");
  actions.className = "comment-actions";
  const likeLabel = view.likeCount === 0
    ? "Like on YouTube"
    : `${new Intl.NumberFormat().format(view.likeCount)} likes on YouTube`;
  actions.append(
    actionStat(
      ICON_PATHS.like,
      likeLabel,
      view.likeCount > 0 ? new Intl.NumberFormat().format(view.likeCount) : null,
      "0 0 32 32",
    ),
  );
  body.append(actions);

  if (view.replyCount > 0) {
    const replies = document.createElement("span");
    replies.className = "comment-replies is-static";
    const repliesLabel = document.createElement("span");
    repliesLabel.textContent = view.replyCount === 1 ? "1 reply" : `${new Intl.NumberFormat().format(view.replyCount)} replies`;
    replies.append(repliesLabel, svgIcon(ICON_PATHS.replies));
    body.append(replies);
  }

  comment.append(body);
  return comment;
}

function renderCommentViews(views, append, query) {
  const fragment = document.createDocumentFragment();
  const rendered = [];
  for (const view of views) {
    const comment = renderCommentView(view, query);
    rendered.push(comment);
    fragment.append(comment);
  }

  if (!append) {
    elements.resultList.replaceChildren();
  }
  elements.resultList.append(fragment);

  for (const comment of rendered) {
    revealReadMore(comment);
  }
}

function persistPageState() {
  if (!state.videoId) {
    return state.persistQueue;
  }

  const videoId = state.videoId;
  const key = pageStorageKey(videoId);
  const pageState = {
    comments: state.comments,
    keyword: elements.keyword.value,
    metadata: state.metadata,
    nextPageToken: state.nextPageToken,
    status: elements.status.textContent,
    statusState: elements.status.dataset.state ?? "",
    updatedAt: Date.now(),
  };

  const run = async () => {
    const stored = await chrome.storage.session.get(PAGE_ORDER_KEY);
    const { next, removed } = nextPageOrder(stored[PAGE_ORDER_KEY], videoId);
    await chrome.storage.session.set({ [key]: pageState, [PAGE_ORDER_KEY]: next });
    if (removed.length > 0) {
      await chrome.storage.session.remove(removed.map(pageStorageKey));
    }
  };

  state.persistQueue = state.persistQueue.then(run, run);
  return state.persistQueue;
}

function applyPageState(page) {
  state.comments = page.comments;
  state.metadata = page.metadata;
  state.nextPageToken = page.nextPageToken;
  elements.keyword.value = page.keyword;

  if (state.metadata) {
    showVideoMetadata();
  }

  if (state.comments.length > 0) {
    elements.resultsSection.hidden = false;
    renderCommentViews(state.comments, false, elements.keyword.value.trim());
  } else {
    elements.resultList.replaceChildren();
    elements.resultsSection.hidden = true;
  }

  setStatus(page.status, page.statusState);
  setLoadMoreVisibility();
}

async function restorePageState(videoId) {
  const key = pageStorageKey(videoId);
  const stored = await chrome.storage.session.get(key);
  const page = stored[key];
  if (!isPageState(page)) {
    return false;
  }

  applyPageState(page);
  return true;
}

function renderPage(response, append) {
  const views = [];
  for (const thread of Array.isArray(response.items) ? response.items : []) {
    const view = commentView(thread, state.videoId);
    if (view) {
      views.push(view);
    }
  }

  if (!append) {
    state.comments = views;
  } else {
    state.comments.push(...views);
  }

  state.nextPageToken = typeof response.nextPageToken === "string" ? response.nextPageToken : null;
  setLoadMoreVisibility();

  if (views.length === 0 && !append) {
    elements.resultsSection.hidden = true;
    setStatus("No matching comments were returned for this keyword.");
    void persistPageState();
    return;
  }

  elements.resultsSection.hidden = false;
  renderCommentViews(views, append, elements.keyword.value.trim());
  setStatus("");
  void persistPageState();
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

async function prefetchMetadata() {
  if (!state.videoId || state.metadata) {
    return;
  }

  state.requestSequence += 1;
  const sequence = state.requestSequence;
  const controller = new AbortController();
  state.controller = controller;
  showVideoSkeleton();

  try {
    if (!(await loadMetadata(sequence, controller.signal))) {
      if (sequence === state.requestSequence && !state.metadata) {
        showContextMessage("Video details unavailable. You can still try searching.");
      }
      return;
    }

    if (sequence === state.requestSequence) {
      void persistPageState();
    }
  } catch (error) {
    if (sequence !== state.requestSequence) {
      return;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }

    if (error instanceof ApiError || error instanceof TypeError) {
      showContextMessage("Video details unavailable. You can still try searching.");
      return;
    }

    throw error;
  } finally {
    if (sequence === state.requestSequence) {
      state.controller = null;
    }
  }
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
  setStatus("");

  if (!pageToken) {
    state.comments = [];
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
      void persistPageState();
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
    showContextMessage(
      typeof pageUrl === "string" && isDeferredChannelPage(pageUrl)
        ? "Channel search is planned next. Open a video page to search comments now."
        : "Open a YouTube watch page, then reopen this popup.",
    );
    return;
  }

  setSearchControls(true);
  const restored = await restorePageState(state.videoId);
  if (!restored || !state.metadata) {
    void prefetchMetadata();
  }
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
