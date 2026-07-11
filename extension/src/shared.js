const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function videoIdFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    const isYouTubeHost = ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname);

    if (url.protocol !== "https:" || !isYouTubeHost) {
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

export function isDeferredChannelPage(urlString) {
  try {
    const url = new URL(urlString);
    const isYouTubeHost = ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname);

    return url.protocol === "https:" && isYouTubeHost && (/^\/@[^/]+/.test(url.pathname) || /^\/(channel|c)\//.test(url.pathname));
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
    const isYouTubeHost = ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(authorUrl.hostname);

    if (["http:", "https:"].includes(authorUrl.protocol) && isYouTubeHost) {
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

export function commentResourceView(comment, videoId, videoChannelId = null) {
  const snippet = comment?.snippet;

  if (!comment || !snippet || typeof comment.id !== "string") {
    return null;
  }

  const commentUrl = new URL("https://www.youtube.com/watch");
  commentUrl.searchParams.set("v", videoId);
  commentUrl.searchParams.set("lc", comment.id);

  const authorChannelId = typeof snippet.authorChannelId?.value === "string" ? snippet.authorChannelId.value : null;
  const isVideoAuthor = videoChannelId != null && videoChannelId === authorChannelId;

  return {
    authorChannelUrl: httpsYouTubeChannelUrl(snippet.authorChannelUrl),
    authorName: typeof snippet.authorDisplayName === "string" ? snippet.authorDisplayName : "YouTube user",
    authorProfileImageUrl: authorProfileImageUrl(snippet.authorProfileImageUrl),
    commentUrl: commentUrl.toString(),
    id: comment.id,
    isVideoAuthor,
    likeCount: Number.isFinite(snippet.likeCount) ? snippet.likeCount : 0,
    publishedAt: typeof snippet.publishedAt === "string" ? snippet.publishedAt : null,
    text: typeof snippet.textOriginal === "string" ? snippet.textOriginal : "",
  };
}

export function commentView(thread, videoId, videoChannelId = null) {
  const view = commentResourceView(thread?.snippet?.topLevelComment, videoId, videoChannelId);
  if (!view) {
    return null;
  }

  const bundled = Array.isArray(thread?.replies?.comments) ? thread.replies.comments : null;
  if (!bundled) {
    return view;
  }

  const replies = [];
  for (const item of bundled) {
    const mapped = commentResourceView(item, videoId, videoChannelId);
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
  const parsed = typeof rawCount === "string" ? Number(rawCount) : rawCount;
  const commentCount = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;

  return { channelId: typeof snippet.channelId === "string" ? snippet.channelId : null, channelTitle: snippet.channelTitle, commentCount, title: snippet.title };
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

  if (error?.status === 404 || reason === "videoNotFound") {
    return "This video is not available through the YouTube Data API.";
  }

  if (error?.status === 400) {
    return "YouTube could not process this search. Try a shorter or different keyword.";
  }

  if (error?.status >= 500) {
    return "The search service is temporarily unavailable. Please try again.";
  }

  return "Unable to search comments right now. Please try again.";
}
