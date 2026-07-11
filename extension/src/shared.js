const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE_PATTERN = /^[A-Za-z0-9._-]{3,30}$/;

function isYouTubeHost(hostname) {
  return ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(hostname);
}

export function videoIdFromUrl(urlString) {
  try {
    const url = new URL(urlString);

    if (url.protocol !== "https:" || !isYouTubeHost(url.hostname)) {
      return null;
    }

    const videoId =
      url.pathname === "/watch"
        ? url.searchParams.get("v")
        : url.pathname.startsWith("/shorts/")
          ? url.pathname.slice(8)
          : null;

    return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
  } catch (error) {
    if (error instanceof TypeError) {
      return null;
    }

    throw error;
  }
}

export function pageTargetFromUrl(urlString) {
  const videoId = videoIdFromUrl(urlString);
  if (videoId) {
    return { kind: "video", videoId };
  }

  try {
    const url = new URL(urlString);
    if (url.protocol !== "https:" || !isYouTubeHost(url.hostname)) {
      return null;
    }

    const handleMatch = url.pathname.match(/^\/@([^/]+)/);
    if (handleMatch) {
      const handle = handleMatch[1];
      return HANDLE_PATTERN.test(handle) ? { kind: "handle", handle } : null;
    }

    const channelMatch = url.pathname.match(/^\/channel\/([^/]+)/);
    if (channelMatch) {
      const channelId = channelMatch[1];
      return CHANNEL_ID_PATTERN.test(channelId) ? { kind: "channel", channelId } : null;
    }

    return null;
  } catch (error) {
    if (error instanceof TypeError) {
      return null;
    }

    throw error;
  }
}

export function isUnsupportedChannelPage(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === "https:" && isYouTubeHost(url.hostname) && /^\/c\//.test(url.pathname);
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }

    throw error;
  }
}

const AUTHOR_IMAGE_HOSTS = new Set([
  "yt3.ggpht.com",
  "yt3.googleusercontent.com",
  "lh3.googleusercontent.com",
]);

function httpsYouTubeChannelUrl(urlString) {
  if (typeof urlString !== "string") {
    return null;
  }

  try {
    const authorUrl = new URL(urlString);
    if (["http:", "https:"].includes(authorUrl.protocol) && isYouTubeHost(authorUrl.hostname)) {
      authorUrl.protocol = "https:";
      return authorUrl.toString();
    }
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
  }

  return null;
}

function authorProfileImageUrl(urlString) {
  if (typeof urlString !== "string") {
    return null;
  }

  try {
    const imageUrl = new URL(urlString);
    if (imageUrl.protocol === "https:" && AUTHOR_IMAGE_HOSTS.has(imageUrl.hostname)) {
      return imageUrl.toString();
    }
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
  }

  return null;
}

function nonNegativeCount(value) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** m:ss or h:mm:ss; seconds always two digits; not adjacent to other digits. */
const TIMESTAMP_PATTERN = /(?<!\d)(?:(\d{1,3}):)?(\d{1,3}):(\d{2})(?!\d)/g;

export function timestampMatches(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const matches = [];
  for (const match of text.matchAll(TIMESTAMP_PATTERN)) {
    const hours = match[1] == null ? 0 : Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (seconds >= 60 || (match[1] != null && minutes >= 60)) {
      continue;
    }
    matches.push({
      index: match.index,
      label: match[0],
      seconds: hours * 3600 + minutes * 60 + seconds,
    });
  }
  return matches;
}

export function relativeTimeFrom(isoDate, now = Date.now()) {
  if (typeof isoDate !== "string") {
    return null;
  }

  const then = Date.parse(isoDate);
  if (Number.isNaN(then)) {
    return null;
  }

  const seconds = Math.round((then - now) / 1000);
  const divisions = [
    { amount: 60, unit: "second" },
    { amount: 60, unit: "minute" },
    { amount: 24, unit: "hour" },
    { amount: 7, unit: "day" },
    { amount: 4.34524, unit: "week" },
    { amount: 12, unit: "month" },
    { amount: Number.POSITIVE_INFINITY, unit: "year" },
  ];

  let duration = seconds;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
        Math.round(duration),
        division.unit,
      );
    }
    duration /= division.amount;
  }

  throw new Error("relativeTimeFrom exhausted unit divisions");
}

export function commentResourceView(comment, videoId, ownerChannelId = null, channelId = null) {
  const snippet = comment?.snippet;

  if (!comment || !snippet || typeof comment.id !== "string") {
    return null;
  }

  if (typeof videoId !== "string" && typeof channelId !== "string") {
    return null;
  }

  let commentUrl;
  if (typeof videoId === "string") {
    const url = new URL("https://www.youtube.com/watch");
    url.searchParams.set("v", videoId);
    url.searchParams.set("lc", comment.id);
    commentUrl = url.toString();
  } else {
    commentUrl = `https://www.youtube.com/channel/${channelId}`;
  }

  const authorChannelId = typeof snippet.authorChannelId?.value === "string" ? snippet.authorChannelId.value : null;
  const isVideoAuthor = ownerChannelId != null && ownerChannelId === authorChannelId;

  return {
    authorChannelUrl: httpsYouTubeChannelUrl(snippet.authorChannelUrl),
    authorName: typeof snippet.authorDisplayName === "string" ? snippet.authorDisplayName : "YouTube user",
    authorProfileImageUrl: authorProfileImageUrl(snippet.authorProfileImageUrl),
    commentUrl,
    id: comment.id,
    isVideoAuthor,
    likeCount: Number.isFinite(snippet.likeCount) ? snippet.likeCount : 0,
    publishedAt: typeof snippet.publishedAt === "string" ? snippet.publishedAt : null,
    text: typeof snippet.textOriginal === "string" ? snippet.textOriginal : "",
    videoId: typeof videoId === "string" ? videoId : null,
  };
}

export function commentView(thread, fallbackVideoId, ownerChannelId = null, channelId = null) {
  const videoId =
    typeof thread?.snippet?.videoId === "string" && VIDEO_ID_PATTERN.test(thread.snippet.videoId)
      ? thread.snippet.videoId
      : fallbackVideoId;
  const view = commentResourceView(thread?.snippet?.topLevelComment, videoId, ownerChannelId, channelId);
  if (!view) {
    return null;
  }

  const bundled = Array.isArray(thread?.replies?.comments) ? thread.replies.comments : null;
  if (!bundled) {
    return view;
  }

  const replies = [];
  for (const item of bundled) {
    const mapped = commentResourceView(item, videoId, ownerChannelId, channelId);
    if (mapped) {
      replies.push(mapped);
    }
  }
  if (replies.length > 0) {
    view.replies = replies;
    const totalReplyCount = Number.isFinite(thread?.snippet?.totalReplyCount) ? thread.snippet.totalReplyCount : 0;
    view.hasMoreReplies = totalReplyCount > replies.length;
  }

  return view;
}

export function videoMetadata(response) {
  const item = response?.items?.[0];
  const snippet = item?.snippet;

  if (!snippet || typeof snippet.title !== "string" || typeof snippet.channelTitle !== "string") {
    return null;
  }

  const rawCount = item?.statistics?.commentCount;
  const commentCount = nonNegativeCount(rawCount);

  return { channelId: typeof snippet.channelId === "string" ? snippet.channelId : null, channelTitle: snippet.channelTitle, commentCount, title: snippet.title };
}

export function channelMetadata(response) {
  const item = response?.items?.[0];
  const snippet = item?.snippet;

  if (!item || !snippet || typeof item.id !== "string" || typeof snippet.title !== "string") {
    return null;
  }

  const customUrl = typeof snippet.customUrl === "string" ? snippet.customUrl : null;
  const handle = customUrl?.startsWith("@") ? customUrl.slice(1) : customUrl;
  const thumbnails = snippet.thumbnails;
  const thumbnailUrl = authorProfileImageUrl(
    thumbnails?.medium?.url ?? thumbnails?.default?.url ?? thumbnails?.high?.url ?? null,
  );
  const statistics = item.statistics;
  const hiddenSubscriberCount = statistics?.hiddenSubscriberCount === true;

  return {
    channelId: item.id,
    handle: handle && HANDLE_PATTERN.test(handle) ? handle : null,
    hiddenSubscriberCount,
    subscriberCount: hiddenSubscriberCount ? null : nonNegativeCount(statistics?.subscriberCount),
    thumbnailUrl,
    title: snippet.title,
    videoCount: nonNegativeCount(statistics?.videoCount),
  };
}

export function videoTitlesFromResponse(response) {
  const titles = {};
  for (const item of Array.isArray(response?.items) ? response.items : []) {
    if (typeof item?.id === "string" && typeof item?.snippet?.title === "string") {
      titles[item.id] = item.snippet.title;
    }
  }
  return titles;
}

export function apiErrorMessage(error) {
  if (error?.name === "AbortError") {
    return null;
  }

  const reason = error?.body?.error?.errors?.[0]?.reason;

  if (reason === "commentsDisabled") {
    return "Comments are disabled for this video in the YouTube Data API.";
  }

  if (error?.status === 429 || reason === "quotaExceeded") {
    return "The search service is busy or has reached its quota. Please try again later.";
  }

  if (error?.status === 404 || reason === "videoNotFound" || reason === "channelNotFound") {
    return "This page is not available through the YouTube Data API.";
  }

  if (error?.status === 400) {
    return "YouTube could not process this search. Try a shorter or different keyword.";
  }

  if (error?.status >= 500) {
    return "The search service is temporarily unavailable. Please try again.";
  }

  return "Unable to search comments right now. Please try again.";
}
