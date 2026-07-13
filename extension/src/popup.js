import { isPageState, pageStorageKey, pageTargetKey } from "./page-state.js";
import {
  classifyPageTarget,
  relativeTimeFrom,
  timestampMatches,
} from "./shared.js";

const CONSENT_STORAGE_KEY = "privacyConsentVersion";
const PRIVACY_POLICY_VERSION = "2026-07-12-declarative";

const elements = {
  acceptConsent: document.querySelector("#accept-consent"),
  app: document.querySelector("#app"),
  brand: document.querySelector(".brand"),
  channelAvatar: document.querySelector("#channel-avatar"),
  channelSubscriberCount: document.querySelector("#channel-subscriber-count"),
  channelSubscriberCountValue: document.querySelector("#channel-subscriber-count-value"),
  channelTitle: document.querySelector("#channel-title"),
  channelVideoCount: document.querySelector("#channel-video-count"),
  channelVideoCountValue: document.querySelector("#channel-video-count-value"),
  consentCheckbox: document.querySelector("#consent-checkbox"),
  clearKeyword: document.querySelector("#clear-keyword"),
  emptyState: document.querySelector("#empty-state"),
  emptyStateCta: document.querySelector(".empty-state-cta"),
  keyword: document.querySelector("#keyword"),
  legacyChannelNote: document.querySelector("#legacy-channel-note"),
  loadMore: document.querySelector("#load-more"),
  openSidePanel: document.querySelector("#open-side-panel"),
  openSidePanelShortcut: document.querySelector("#open-side-panel-shortcut"),
  pageContext: document.querySelector("#page-context"),
  pageHeader: document.querySelector(".page-header"),
  popupShell: document.querySelector(".popup-shell"),
  privacyGate: document.querySelector("#privacy-gate"),
  resultList: document.querySelector("#result-list"),
  resultsSection: document.querySelector("#results-section"),
  searchButton: document.querySelector("#search-button"),
  searchForm: document.querySelector("#search-form"),
  status: document.querySelector("#status"),
  stickyAside: document.querySelector(".sticky-aside"),
  videoCommentCount: document.querySelector("#video-comment-count"),
  videoCommentCountValue: document.querySelector("#video-comment-count-value"),
  videoLikeCount: document.querySelector("#video-like-count"),
  videoLikeCountValue: document.querySelector("#video-like-count-value"),
  videoMetadata: document.querySelector("#video-metadata"),
  videoMetaStats: document.querySelector("#video-meta-stats"),
  videoPublished: document.querySelector("#video-published"),
  videoThumbnail: document.querySelector("#video-thumbnail"),
  videoTitle: document.querySelector("#video-title"),
  videoViewCount: document.querySelector("#video-view-count"),
  videoViewCountValue: document.querySelector("#video-view-count-value"),
};

const isSidePanel = document.body.classList.contains("is-side-panel");
let sidePanelSyncStarted = false;

const state = {
  comments: [],
  contextIdentity: null,
  contextLoadGeneration: 0,
  metadata: null,
  nextPageToken: null,
  target: null,
  videoTitles: {},
};

const ICON_PATHS = {
  like:
    "M19.017 31.992c-9.088 0-9.158-0.377-10.284-1.224-0.597-0.449-1.723-0.76-5.838-1.028-0.298-0.020-0.583-0.134-0.773-0.365-0.087-0.107-2.143-3.105-2.143-7.907 0-4.732 1.472-6.89 1.534-6.99 0.182-0.293 0.503-0.47 0.847-0.47 3.378 0 8.062-4.313 11.21-11.841 0.544-1.302 0.657-2.159 2.657-2.159 1.137 0 2.413 0.815 3.042 1.86 1.291 2.135 0.636 6.721 0.029 9.171 2.063-0.017 5.796-0.045 7.572-0.045 2.471 0 4.107 1.473 4.156 3.627 0.017 0.711-0.077 1.619-0.282 2.089 0.544 0.543 1.245 1.36 1.276 2.414 0.038 1.36-0.852 2.395-1.421 2.989 0.131 0.395 0.391 0.92 0.366 1.547-0.063 1.542-1.253 2.535-1.994 3.054 0.061 0.422 0.11 1.218-0.026 1.834-0.535 2.457-4.137 3.443-9.928 3.443zM3.426 27.712c3.584 0.297 5.5 0.698 6.51 1.459 0.782 0.589 0.662 0.822 9.081 0.822 2.568 0 7.59-0.107 7.976-1.87 0.153-0.705-0.59-1.398-0.593-1.403-0.203-0.501 0.023-1.089 0.518-1.305 0.008-0.004 2.005-0.719 2.050-1.835 0.030-0.713-0.46-1.142-0.471-1.16-0.291-0.452-0.185-1.072 0.257-1.38 0.005-0.004 1.299-0.788 1.267-1.857-0.024-0.849-1.143-1.447-1.177-1.466-0.25-0.143-0.432-0.39-0.489-0.674-0.056-0.282 0.007-0.579 0.183-0.808 0 0 0.509-0.808 0.49-1.566-0.037-1.623-1.782-1.674-2.156-1.674-2.523 0-9.001 0.025-9.001 0.025-0.349 0.002-0.652-0.164-0.84-0.443s-0.201-0.627-0.092-0.944c0.977-2.813 1.523-7.228 0.616-8.736-0.267-0.445-0.328-0.889-1.328-0.889-0.139 0-0.468 0.11-0.812 0.929-3.341 7.995-8.332 12.62-12.421 13.037-0.353 0.804-1.016 2.47-1.016 5.493 0 3.085 0.977 5.473 1.447 6.245z",
  external: "M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42L17.59 5H14V3zM5 5h6V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-6h-2v6H5V5z",
};

function isChannelScoped() {
  return state.target?.kind === "channel" || state.target?.kind === "handle";
}

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

function sidePanelShortcutKeys() {
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform) ? ["⇧", "⌥", "C"] : ["Alt", "Shift", "C"];
}

function setupOpenSidePanelTip() {
  if (!elements.openSidePanel) {
    return;
  }
  const keys = sidePanelShortcutKeys();
  elements.openSidePanelShortcut.replaceChildren(
    ...keys.map((key) => {
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      return kbd;
    }),
  );
  elements.openSidePanel.setAttribute("aria-label", `Open in side panel (${keys.join("+")})`);
}

function compactCount(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: "compact" }).format(value);
}

function clearChannelCardExtras() {
  elements.channelAvatar.hidden = true;
  elements.channelAvatar.removeAttribute("src");
  elements.channelSubscriberCount.hidden = true;
  elements.channelSubscriberCountValue.textContent = "";
  elements.channelSubscriberCount.removeAttribute("aria-label");
  elements.channelVideoCount.hidden = true;
  elements.channelVideoCountValue.textContent = "";
  elements.channelVideoCount.removeAttribute("aria-label");
}

function clearVideoCardExtras() {
  elements.videoThumbnail.hidden = true;
  elements.videoThumbnail.removeAttribute("src");
  elements.videoPublished.hidden = true;
  elements.videoPublished.textContent = "";
  elements.videoPublished.removeAttribute("datetime");
  elements.videoPublished.removeAttribute("aria-label");
  elements.videoViewCount.hidden = true;
  elements.videoViewCountValue.textContent = "";
  elements.videoViewCount.removeAttribute("aria-label");
  elements.videoLikeCount.hidden = true;
  elements.videoLikeCountValue.textContent = "";
  elements.videoLikeCount.removeAttribute("aria-label");
  elements.videoCommentCount.hidden = true;
  elements.videoCommentCountValue.textContent = "";
  elements.videoCommentCount.removeAttribute("aria-label");
  elements.videoMetaStats.hidden = true;
}

function showVideoSkeleton() {
  elements.videoTitle.textContent = "";
  elements.channelTitle.textContent = "";
  clearChannelCardExtras();
  clearVideoCardExtras();
  elements.videoMetaStats.hidden = false;
  elements.videoMetadata.classList.add("is-skeleton");
  elements.pageContext.hidden = true;
  elements.videoMetadata.hidden = false;
}

function showPageMetadata() {
  elements.videoMetadata.classList.remove("is-skeleton");

  if (isChannelScoped()) {
    clearVideoCardExtras();
    elements.videoTitle.textContent = state.metadata.title;
    elements.channelTitle.textContent =
      state.target?.kind === "handle"
        ? `@${state.target.handle}`
        : state.metadata.handle
          ? `@${state.metadata.handle}`
          : "Channel";

    if (state.metadata.thumbnailUrl) {
      elements.channelAvatar.src = state.metadata.thumbnailUrl;
      elements.channelAvatar.referrerPolicy = "no-referrer";
      elements.channelAvatar.hidden = false;
    } else {
      elements.channelAvatar.hidden = true;
      elements.channelAvatar.removeAttribute("src");
    }

    if (typeof state.metadata.subscriberCount === "number") {
      const formatted = compactCount(state.metadata.subscriberCount);
      elements.channelSubscriberCountValue.textContent =
        state.metadata.subscriberCount === 1 ? "1 sub" : `${formatted} subs`;
      elements.channelSubscriberCount.setAttribute(
        "aria-label",
        state.metadata.subscriberCount === 1 ? "1 sub" : `${formatted} subs`,
      );
      elements.channelSubscriberCount.hidden = false;
    } else {
      elements.channelSubscriberCount.hidden = true;
      elements.channelSubscriberCountValue.textContent = "";
      elements.channelSubscriberCount.removeAttribute("aria-label");
    }

    if (typeof state.metadata.videoCount === "number") {
      const formatted = compactCount(state.metadata.videoCount);
      elements.channelVideoCountValue.textContent =
        state.metadata.videoCount === 1 ? "1 video" : `${formatted} videos`;
      elements.channelVideoCount.setAttribute(
        "aria-label",
        state.metadata.videoCount === 1 ? "1 video" : `${formatted} videos`,
      );
      elements.channelVideoCount.hidden = false;
    } else {
      elements.channelVideoCount.hidden = true;
      elements.channelVideoCountValue.textContent = "";
      elements.channelVideoCount.removeAttribute("aria-label");
    }
  } else {
    clearChannelCardExtras();
    elements.videoTitle.textContent = state.metadata.title;
    elements.channelTitle.textContent = state.metadata.channelTitle;

    if (state.metadata.thumbnailUrl) {
      elements.videoThumbnail.src = state.metadata.thumbnailUrl;
      elements.videoThumbnail.referrerPolicy = "no-referrer";
      elements.videoThumbnail.hidden = false;
    } else {
      elements.videoThumbnail.hidden = true;
      elements.videoThumbnail.removeAttribute("src");
    }

    if (state.metadata.publishedAt) {
      const relative = relativeTimeFrom(state.metadata.publishedAt);
      const date = new Date(state.metadata.publishedAt);
      if (relative && !Number.isNaN(date.getTime())) {
        elements.videoPublished.dateTime = date.toISOString();
        elements.videoPublished.textContent = relative;
        elements.videoPublished.setAttribute("aria-label", `Published ${relative}`);
        elements.videoPublished.hidden = false;
      } else {
        elements.videoPublished.hidden = true;
        elements.videoPublished.textContent = "";
        elements.videoPublished.removeAttribute("datetime");
        elements.videoPublished.removeAttribute("aria-label");
      }
    } else {
      elements.videoPublished.hidden = true;
      elements.videoPublished.textContent = "";
      elements.videoPublished.removeAttribute("datetime");
      elements.videoPublished.removeAttribute("aria-label");
    }

    if (typeof state.metadata.viewCount === "number") {
      const formatted = compactCount(state.metadata.viewCount);
      const label = state.metadata.viewCount === 1 ? "1 view" : `${formatted} views`;
      elements.videoViewCountValue.textContent = label;
      elements.videoViewCount.setAttribute("aria-label", label);
      elements.videoViewCount.hidden = false;
    } else {
      elements.videoViewCount.hidden = true;
      elements.videoViewCountValue.textContent = "";
      elements.videoViewCount.removeAttribute("aria-label");
    }

    if (typeof state.metadata.likeCount === "number") {
      const formatted = compactCount(state.metadata.likeCount);
      const label = state.metadata.likeCount === 1 ? "1 like" : `${formatted} likes`;
      elements.videoLikeCountValue.textContent = label;
      elements.videoLikeCount.setAttribute("aria-label", label);
      elements.videoLikeCount.hidden = false;
    } else {
      elements.videoLikeCount.hidden = true;
      elements.videoLikeCountValue.textContent = "";
      elements.videoLikeCount.removeAttribute("aria-label");
    }

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
      elements.videoCommentCount.removeAttribute("aria-label");
    }

    elements.videoMetaStats.hidden = !(
      typeof state.metadata.viewCount === "number" ||
      typeof state.metadata.likeCount === "number" ||
      hasCount
    );
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

function highlightQueryNodes(text, query) {
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

function commentTextNodes(text, query, videoId) {
  const stamps = typeof videoId === "string" ? timestampMatches(text) : [];
  if (stamps.length === 0) {
    return highlightQueryNodes(text, query);
  }

  const nodes = [];
  let from = 0;
  for (const stamp of stamps) {
    if (stamp.index > from) {
      nodes.push(...highlightQueryNodes(text.slice(from, stamp.index), query));
    }
    const link = document.createElement("a");
    link.className = "comment-timestamp";
    link.href = `https://www.youtube.com/watch?v=${videoId}&t=${stamp.seconds}s`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = stamp.label;
    nodes.push(link);
    from = stamp.index + stamp.label.length;
  }

  if (from < text.length) {
    nodes.push(...highlightQueryNodes(text.slice(from), query));
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

function renderCommentView(view, query, options = {}) {
  const isReply = options.isReply === true;
  const comment = document.createElement("article");
  comment.className = isReply ? "comment comment-reply" : "comment";

  if (view.authorProfileImageUrl) {
    const avatar = document.createElement(view.authorChannelUrl ? "a" : "span");
    avatar.className = "comment-avatar-link";
    if (view.authorChannelUrl) {
      avatar.href = view.authorChannelUrl;
      avatar.target = "_blank";
      avatar.rel = "noreferrer";
    }
    const image = document.createElement("img");
    image.className = "comment-avatar";
    image.src = view.authorProfileImageUrl;
    image.alt = "";
    image.width = isReply ? 24 : 40;
    image.height = isReply ? 24 : 40;
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
  if (view.isVideoAuthor) {
    author.classList.add("comment-author-badge");
    author.title = isChannelScoped() ? "Channel author" : "Video author";
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

  if (!isReply && view.videoTitle && view.videoId) {
    const source = document.createElement("a");
    source.className = "comment-source-video";
    source.href = `https://www.youtube.com/watch?v=${view.videoId}`;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = view.videoTitle;
    body.append(source);
  }

  const text = document.createElement("p");
  text.className = "comment-text is-collapsed";
  text.append(...commentTextNodes(view.text, query, view.videoId));
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

  if (!isReply && Array.isArray(view.replies) && view.replies.length > 0) {
    const list = document.createElement("div");
    list.className = "comment-replies-list";
    for (const reply of view.replies) {
      const replyEl = renderCommentView(reply, query, { isReply: true });
      list.append(replyEl);
      revealReadMore(replyEl);
    }

    if (view.hasMoreReplies) {
      const fullThread = document.createElement("a");
      fullThread.className = "comment-full-thread";
      fullThread.href = view.commentUrl;
      fullThread.target = "_blank";
      fullThread.rel = "noreferrer";
      const fullThreadLabel = document.createElement("span");
      fullThreadLabel.textContent = "See full thread";
      fullThread.append(fullThreadLabel, svgIcon(ICON_PATHS.external));
      list.append(fullThread);
    }
    body.append(list);
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

function applySourceTitles(views) {
  for (const view of views) {
    const title = state.videoTitles[view.videoId];
    if (title) {
      view.videoTitle = title;
    }
    if (Array.isArray(view.replies)) {
      for (const reply of view.replies) {
        if (title) {
          reply.videoTitle = title;
        }
      }
    }
  }
}

function applyPageState(page) {
  state.comments = page.comments;
  state.metadata = page.metadata;
  state.nextPageToken = page.nextPageToken;
  state.videoTitles = page.videoTitles && typeof page.videoTitles === "object" ? page.videoTitles : {};
  elements.keyword.value = page.keyword;

  if (state.metadata) {
    showPageMetadata();
  }

  if (state.comments.length > 0) {
    applySourceTitles(state.comments);
    elements.resultsSection.hidden = false;
    renderCommentViews(state.comments, false, elements.keyword.value.trim());
  } else {
    elements.resultList.replaceChildren();
    elements.resultsSection.hidden = true;
  }

  setStatus(page.status, page.statusState);
  setLoadMoreVisibility();
  setSearchControls(true, page.statusState === "loading");
}

async function restorePageState(target, generation) {
  const targetKey = pageTargetKey(target);
  if (!targetKey) {
    return false;
  }

  const key = pageStorageKey(targetKey);
  const stored = await chrome.storage.session.get(key);
  const page = stored[key];
  if (generation !== state.contextLoadGeneration || state.target !== target) {
    return false;
  }

  if (!isPageState(page)) {
    return false;
  }

  applyPageState(page);
  return true;
}

/** Stable key for the active page; reuses session storage target keys when searchable. */
function contextIdentity(classification) {
  return pageTargetKey(classification) ?? classification.kind;
}

function resetTransientUiState() {
  state.comments = [];
  state.metadata = null;
  state.nextPageToken = null;
  state.target = null;
  state.videoTitles = {};
  elements.keyword.value = "";
  elements.resultList.replaceChildren();
  elements.resultsSection.hidden = true;
  setLoadMoreVisibility();
  setStatus("");
  setSearchControls(false);
  elements.videoMetadata.classList.remove("is-skeleton");
  elements.videoMetadata.hidden = true;
  elements.pageContext.hidden = false;
  elements.pageContext.textContent = "";
  clearChannelCardExtras();
  clearVideoCardExtras();
}

/**
 * Load (or switch) UI for the focused window’s active tab.
 * YouTube URLs come from host_permissions; other tabs have no readable URL → empty state.
 * Side panel reuses this document across navigations; popup runs it once per open.
 */
async function showApplication({ focusSearch = true } = {}) {
  elements.privacyGate.hidden = true;
  elements.app.hidden = false;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = typeof tab?.url === "string" ? tab.url : null;
  const classification = pageUrl ? classifyPageTarget(pageUrl) : { kind: "none" };
  const identity = contextIdentity(classification);

  if (identity === state.contextIdentity) {
    if (state.target) {
      void prefetchMetadata();
    }
    return;
  }

  const generation = (state.contextLoadGeneration += 1);
  state.contextIdentity = identity;

  resetTransientUiState();

  const rawTarget = pageTargetKey(classification)
    ? classification
    : null;

  if (!rawTarget) {
    elements.stickyAside.hidden = true;
    elements.brand.style.visibility = "hidden";
    elements.legacyChannelNote.hidden = classification.kind !== "legacy-channel";
    elements.emptyStateCta.hidden = classification.kind !== "none";
    elements.emptyState.hidden = false;
    return;
  }

  elements.brand.style.visibility = "";
  elements.emptyState.hidden = true;
  elements.stickyAside.hidden = false;

  state.target = rawTarget;
  setSearchControls(true);
  await restorePageState(state.target, generation);
  if (generation !== state.contextLoadGeneration) {
    return;
  }

  void prefetchMetadata();

  if (focusSearch) {
    elements.keyword.focus();
    elements.keyword.select();
  }
}

function setupPageStateSync() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "session" || !state.target) {
      return;
    }

    const key = pageStorageKey(pageTargetKey(state.target));
    const page = changes[key]?.newValue;
    if (isPageState(page)) {
      applyPageState(page);
    }
  });
}

async function setupSidePanelTabSync() {
  if (!isSidePanel || sidePanelSyncStarted) {
    return;
  }

  const panelWindow = await chrome.windows.getCurrent();
  if (typeof panelWindow.id !== "number") {
    return;
  }

  if (sidePanelSyncStarted) {
    return;
  }

  sidePanelSyncStarted = true;
  const panelWindowId = panelWindow.id;
  let debounceTimer = 0;

  const scheduleSync = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    // Coalesce activation + SPA URL events; re-query this panel's active tab.
    debounceTimer = setTimeout(() => {
      debounceTimer = 0;
      void showApplication({ focusSearch: false });
    }, 50);
  };

  chrome.tabs.onActivated.addListener(({ windowId }) => {
    if (windowId === panelWindowId) {
      scheduleSync();
    }
  });

  // URL-only: YouTube is an SPA; `status: complete` fires often without a page change.
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (tab.windowId === panelWindowId && tab.active && changeInfo.url) {
      scheduleSync();
    }
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === panelWindowId) {
      scheduleSync();
    }
  });
}

function prefetchMetadata() {
  if (!state.target) {
    return;
  }

  const target = state.target;
  if (!state.metadata) {
    showVideoSkeleton();
  }

  void chrome.runtime.sendMessage({ type: "prefetch-page-metadata", target }).then(
    ({ ok }) => {
      if (!ok && state.target === target && !state.metadata) {
        showContextMessage(
          target.kind === "video"
            ? "Video details unavailable. You can still try searching."
            : "Channel details unavailable. You can still try searching.",
        );
      }
    },
    (error) => {
      console.error("Could not fetch page metadata.", error);
    },
  );
}

async function search(pageToken = null) {
  const searchTerms = elements.keyword.value.trim();
  if (!searchTerms) {
    elements.keyword.focus();
    return;
  }

  setSearchControls(true, true);
  setStatus("");
  void chrome.runtime.sendMessage({ type: "search-comments", target: state.target, searchTerms, pageToken }).catch((error) => {
    console.error("Could not start comment search.", error);
  });
}

function setupStickyChrome() {
  const header = elements.pageHeader;
  const aside = elements.stickyAside;
  const scroller = elements.popupShell;
  if (!header || !aside || !scroller) {
    return;
  }

  let asideHeight = 0;
  let minTranslate = 0;
  let stickyStartY = 0;
  let translate = 0;
  let lastY = scroller.scrollTop;

  const measure = () => {
    asideHeight = aside.offsetHeight;
    minTranslate = -(asideHeight + 12);
    stickyStartY = aside.offsetTop;
    if (translate < minTranslate) translate = minTranslate;
    if (translate > 0) translate = 0;
  };

  const apply = () => {
    aside.style.transform = translate !== 0 ? `translateY(${translate}px)` : "";
  };

  const resizeObserver = new ResizeObserver(() => {
    measure();
    apply();
  });
  resizeObserver.observe(aside);

  window.addEventListener("resize", () => {
    measure();
    apply();
  }, { passive: true });

  scroller.addEventListener("scroll", () => {
    const y = scroller.scrollTop;
    const delta = y - lastY;
    lastY = y;

    if (asideHeight === 0) {
      aside.classList.remove("is-stuck");
      return;
    }

    const stuck = y > stickyStartY;
    aside.classList.toggle("is-stuck", stuck);

    if (stuck) {
      translate = Math.min(0, Math.max(minTranslate, translate - delta));
    } else {
      translate = 0;
    }
    apply();

    header.classList.toggle("is-scrolled", y > 4);
  }, { passive: true });
}

async function initialize() {
  const stored = await chrome.storage.local.get(CONSENT_STORAGE_KEY);
  if (stored[CONSENT_STORAGE_KEY] !== PRIVACY_POLICY_VERSION) {
    elements.privacyGate.hidden = false;
    return;
  }

  await setupSidePanelTabSync();
  await showApplication();
}

elements.consentCheckbox.addEventListener("change", () => {
  elements.acceptConsent.disabled = !elements.consentCheckbox.checked;
});

elements.acceptConsent.addEventListener("click", async () => {
  await chrome.storage.local.set({ [CONSENT_STORAGE_KEY]: PRIVACY_POLICY_VERSION });
  await setupSidePanelTabSync();
  await showApplication();
});

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void search();
});

elements.clearKeyword.addEventListener("click", () => {
  elements.keyword.focus();
  elements.keyword.select();
  document.execCommand("delete");
});

elements.loadMore.addEventListener("click", () => {
  if (state.nextPageToken) {
    void search(state.nextPageToken);
  }
});

function openSidePanelFromPopup() {
  if (isSidePanel || !elements.openSidePanel) {
    return;
  }

  elements.openSidePanel.disabled = true;
  // The callback preserves the button's user gesture for sidePanel.open().
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, "error");
      elements.openSidePanel.disabled = false;
      return;
    }

    if (typeof tab?.windowId !== "number") {
      setStatus("Could not open the side panel for this window.", "error");
      elements.openSidePanel.disabled = false;
      return;
    }

    // Window-scoped so the panel stays open when switching tabs.
    chrome.sidePanel.open({ windowId: tab.windowId }).then(
      () => {
        window.close();
      },
      (error) => {
        setStatus(error instanceof Error ? error.message : "Could not open the side panel.", "error");
        elements.openSidePanel.disabled = false;
      },
    );
  });
}

if (elements.openSidePanel && !isSidePanel) {
  elements.openSidePanel.addEventListener("click", () => {
    openSidePanelFromPopup();
  });
}

setupStickyChrome();
setupPageStateSync();
setupOpenSidePanelTip();

void initialize();
