export const MAX_PAGE_STATES = 20;
export const METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
export const PAGE_ORDER_KEY = "pageOrder";
export const PAGE_KEY_PREFIX = "page:";

export function pageTargetKey(target) {
  if (target?.kind === "video" && typeof target.videoId === "string") {
    return `video:${target.videoId}`;
  }

  if (target?.kind === "channel" && typeof target.channelId === "string") {
    return `channel:${target.channelId}`;
  }

  if (target?.kind === "handle" && typeof target.handle === "string") {
    return `handle:${target.handle}`;
  }

  return null;
}

export function pageStorageKey(targetKey) {
  return `${PAGE_KEY_PREFIX}${targetKey}`;
}

export function isPageState(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.keyword === "string" &&
    typeof value.status === "string" &&
    typeof value.statusState === "string" &&
    typeof value.updatedAt === "number" &&
    Array.isArray(value.comments) &&
    (value.nextPageToken === null || typeof value.nextPageToken === "string") &&
    (value.metadata === null || typeof value.metadata === "object") &&
    (value.metadataUpdatedAt === undefined ||
      value.metadataUpdatedAt === null ||
      typeof value.metadataUpdatedAt === "number") &&
    (value.videoTitles === undefined || (value.videoTitles !== null && typeof value.videoTitles === "object"))
  );
}

export function hasFreshMetadata(page, now = Date.now()) {
  return (
    page?.metadata !== null &&
    typeof page?.metadata === "object" &&
    typeof page.metadataUpdatedAt === "number" &&
    page.metadataUpdatedAt <= now &&
    now - page.metadataUpdatedAt < METADATA_CACHE_TTL_MS
  );
}

export function nextPageOrder(order, targetKey, max = MAX_PAGE_STATES) {
  const previous = Array.isArray(order) ? order.filter((id) => typeof id === "string") : [];
  const next = [targetKey, ...previous.filter((id) => id !== targetKey)].slice(0, max);
  const removed = previous.filter((id) => !next.includes(id));
  return { next, removed };
}
