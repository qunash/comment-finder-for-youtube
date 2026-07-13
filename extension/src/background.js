import { ApiError, fetchChannelMetadata, fetchVideoMetadata, searchCommentThreads } from "./api.js";
import { PAGE_ORDER_KEY, hasFreshMetadata, nextPageOrder, pageStorageKey, pageTargetKey } from "./page-state.js";
import { apiErrorMessage, channelMetadata, commentView, videoMetadata, videoTitlesFromResponse } from "./shared.js";

const ACTIVE_ICONS = {
  16: "assets/icon-active-16.png",
  32: "assets/icon-active-32.png",
  48: "assets/icon-active-48.png",
  128: "assets/icon-active-128.png",
};

const OPEN_SIDE_PANEL_COMMAND = "open-side-panel";
const SUPPORTED_YOUTUBE_URL_PATTERN = "^https://(www\\.|m\\.)?youtube\\.com/(watch|shorts/|channel/|@)";
const sidePanelWindowIds = new Set();
const metadataRequests = new Map();
const searches = new Map();
let pageWriteQueue = Promise.resolve();

function isChannelScoped(target) {
  return target.kind === "channel" || target.kind === "handle";
}

function searchChannelId(target, metadata) {
  return target.kind === "channel" ? target.channelId : metadata?.channelId ?? null;
}

function updatePageState(targetKey, update) {
  const write = async () => {
    const key = pageStorageKey(targetKey);
    const stored = await chrome.storage.session.get([key, PAGE_ORDER_KEY]);
    const pageState = update(stored[key]);
    if (!pageState) {
      return;
    }
    const { next, removed } = nextPageOrder(stored[PAGE_ORDER_KEY], targetKey);
    if (removed.length > 0) {
      await chrome.storage.session.remove(removed.map(pageStorageKey));
    }
    await chrome.storage.session.set({ [key]: pageState, [PAGE_ORDER_KEY]: next });
  };
  pageWriteQueue = pageWriteQueue.then(write, write);
  return pageWriteQueue;
}

async function fetchPageMetadata(target) {
  if (target.kind === "video") {
    return videoMetadata(await fetchVideoMetadata(target.videoId));
  }

  return channelMetadata(
    await fetchChannelMetadata(
      target.kind === "handle" ? { forHandle: target.handle } : { channelId: target.channelId },
    ),
  );
}

function resolvePageMetadata(target, page) {
  if (hasFreshMetadata(page)) {
    return Promise.resolve({ metadata: page.metadata, metadataUpdatedAt: page.metadataUpdatedAt });
  }

  const targetKey = pageTargetKey(target);
  const inFlight = metadataRequests.get(targetKey);
  if (inFlight) {
    return inFlight;
  }

  const request = fetchPageMetadata(target).then((metadata) => ({
    metadata,
    metadataUpdatedAt: Date.now(),
  }));
  metadataRequests.set(targetKey, request);
  void request.then(
    () => {
      if (metadataRequests.get(targetKey) === request) {
        metadataRequests.delete(targetKey);
      }
    },
    () => {
      if (metadataRequests.get(targetKey) === request) {
        metadataRequests.delete(targetKey);
      }
    },
  );
  return request;
}

async function prefetchPageMetadata({ target }) {
  const targetKey = pageTargetKey(target);
  if (!targetKey) {
    return false;
  }

  const key = pageStorageKey(targetKey);
  const stored = await chrome.storage.session.get(key);
  const page = stored[key];
  if (hasFreshMetadata(page)) {
    return true;
  }

  const { metadata, metadataUpdatedAt } = await resolvePageMetadata(target, page);
  if (!metadata) {
    return false;
  }
  await updatePageState(targetKey, (current) => {
    if (searches.has(targetKey)) {
      return null;
    }
    return {
      comments: Array.isArray(current?.comments) ? current.comments : [],
      keyword: typeof current?.keyword === "string" ? current.keyword : "",
      metadata,
      metadataUpdatedAt,
      nextPageToken: typeof current?.nextPageToken === "string" ? current.nextPageToken : null,
      status: typeof current?.status === "string" ? current.status : "",
      statusState: typeof current?.statusState === "string" ? current.statusState : "",
      updatedAt: Date.now(),
      videoTitles: current?.videoTitles && typeof current.videoTitles === "object" ? current.videoTitles : {},
    };
  });
  return true;
}

async function runSearch({ target, searchTerms, pageToken }) {
  const targetKey = pageTargetKey(target);
  if (!targetKey || typeof searchTerms !== "string" || (pageToken !== null && typeof pageToken !== "string")) {
    return;
  }

  searches.get(targetKey)?.abort();
  const controller = new AbortController();
  searches.set(targetKey, controller);
  const isCurrent = () => searches.get(targetKey) === controller;

  const stored = await chrome.storage.session.get(pageStorageKey(targetKey));
  if (!isCurrent()) {
    return;
  }
  const previous = stored[pageStorageKey(targetKey)];
  const append = pageToken !== null;
  const draft = {
    comments: append && Array.isArray(previous?.comments) ? previous.comments : [],
    keyword: searchTerms,
    metadata: previous?.metadata ?? null,
    metadataUpdatedAt: typeof previous?.metadataUpdatedAt === "number" ? previous.metadataUpdatedAt : null,
    nextPageToken: append ? previous?.nextPageToken ?? null : null,
    status: "Searching comments…",
    statusState: "loading",
    updatedAt: Date.now(),
    videoTitles: append && previous?.videoTitles && typeof previous.videoTitles === "object" ? previous.videoTitles : {},
  };
  let resolvedMetadata = draft.metadata;
  let metadataUpdatedAt = draft.metadataUpdatedAt;

  try {
    await updatePageState(targetKey, () => draft);
    if (!isCurrent()) {
      return;
    }
    const resolved = await resolvePageMetadata(target, previous);
    if (!isCurrent()) {
      return;
    }
    if (!resolved.metadata) {
      throw new ApiError(404, null);
    }
    resolvedMetadata = resolved.metadata;
    metadataUpdatedAt = resolved.metadataUpdatedAt;

    const channelId = searchChannelId(target, resolvedMetadata);
    const response = await searchCommentThreads(
      target.kind === "video" ? { videoId: target.videoId } : { channelId },
      searchTerms,
      pageToken,
      controller.signal,
    );
    if (!isCurrent()) {
      return;
    }
    const comments = [];
    const fallbackVideoId = target.kind === "video" ? target.videoId : null;
    for (const thread of Array.isArray(response.items) ? response.items : []) {
      const view = commentView(
        thread,
        fallbackVideoId,
        resolvedMetadata.channelId ?? null,
        isChannelScoped(target) ? channelId : null,
      );
      if (view) {
        comments.push(view);
      }
    }

    const videoTitles = { ...draft.videoTitles };
    if (isChannelScoped(target)) {
      const videoIds = [...new Set(comments.map((comment) => comment.videoId).filter(Boolean))];
      for (let index = 0; index < videoIds.length; index += 50) {
        Object.assign(videoTitles, videoTitlesFromResponse(await fetchVideoMetadata(videoIds.slice(index, index + 50), controller.signal)));
        if (!isCurrent()) {
          return;
        }
      }
      for (const comment of comments) {
        const title = videoTitles[comment.videoId];
        if (title) {
          comment.videoTitle = title;
          for (const reply of comment.replies ?? []) {
            reply.videoTitle = title;
          }
        }
      }
    }

    const result = {
      comments: append ? [...draft.comments, ...comments] : comments,
      keyword: searchTerms,
      metadata: resolvedMetadata,
      metadataUpdatedAt,
      nextPageToken: typeof response.nextPageToken === "string" ? response.nextPageToken : null,
      status: comments.length === 0 && !append ? "No matching comments were returned for this keyword." : "",
      statusState: "",
      updatedAt: Date.now(),
      videoTitles,
    };
    if (isCurrent()) {
      await updatePageState(targetKey, () => result);
    }
  } catch (error) {
    if (isCurrent() && !(error instanceof DOMException && error.name === "AbortError")) {
      await updatePageState(targetKey, () => ({
        ...draft,
        metadata: resolvedMetadata,
        metadataUpdatedAt,
        status: error instanceof ApiError || error instanceof TypeError ? apiErrorMessage(error) : "Unable to search comments right now. Please try again.",
        statusState: "error",
        updatedAt: Date.now(),
      }));
    }
  } finally {
    if (searches.get(targetKey) === controller) {
      searches.delete(targetKey);
    }
  }
}

async function registerIconRules() {
  // declarativeContent.SetIcon accepts imageData only (not file paths), so the
  // active icons are decoded here via OffscreenCanvas before rule registration.
  const entries = await Promise.all(
    Object.entries(ACTIVE_ICONS).map(async ([size, path]) => {
      const response = await fetch(chrome.runtime.getURL(path));
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      return [size, context.getImageData(0, 0, bitmap.width, bitmap.height)];
    }),
  );
  const imageData = Object.fromEntries(entries);

  chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
    chrome.declarativeContent.onPageChanged.addRules([
      {
        conditions: [
          new chrome.declarativeContent.PageStateMatcher({
            pageUrl: { urlMatches: SUPPORTED_YOUTUBE_URL_PATTERN },
          }),
        ],
        // The action stays enabled everywhere (default_icon is the inactive
        // set); this only swaps the icon to the active set on supported pages.
        actions: [new chrome.declarativeContent.SetIcon({ imageData })],
      },
    ]);
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await registerIconRules();
});

chrome.sidePanel.onOpened.addListener(({ windowId }) => {
  sidePanelWindowIds.add(windowId);
});

chrome.sidePanel.onClosed.addListener(({ windowId }) => {
  sidePanelWindowIds.delete(windowId);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== OPEN_SIDE_PANEL_COMMAND || typeof tab?.windowId !== "number") {
    return;
  }

  if (sidePanelWindowIds.has(tab.windowId)) {
    chrome.sidePanel.close({ windowId: tab.windowId }).catch((error) => {
      console.error("Could not close Comment Finder's side panel.", error);
    });
  } else {
    // This must run synchronously in the command handler to retain its user gesture.
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => {
      console.error("Could not open Comment Finder's side panel.", error);
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "prefetch-page-metadata") {
    prefetchPageMetadata(message).then(
      (ok) => sendResponse({ ok }),
      (error) => {
        console.error("Could not fetch page metadata.", error);
        sendResponse({ ok: false });
      },
    );
    return true;
  }

  if (message?.type !== "search-comments") {
    return undefined;
  }

  runSearch(message).then(
    () => sendResponse({ ok: true }),
    (error) => {
      console.error("Could not search comments.", error);
      sendResponse({ ok: false });
    },
  );
  return true;
});
