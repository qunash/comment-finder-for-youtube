export const MAX_PAGE_STATES = 20;
export const PAGE_ORDER_KEY = "pageOrder";
export const PAGE_KEY_PREFIX = "page:";

export function pageStorageKey(videoId) {
  return `${PAGE_KEY_PREFIX}${videoId}`;
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
    (value.metadata === null || typeof value.metadata === "object")
  );
}

export function nextPageOrder(order, videoId, max = MAX_PAGE_STATES) {
  const previous = Array.isArray(order) ? order.filter((id) => typeof id === "string") : [];
  const next = [videoId, ...previous.filter((id) => id !== videoId)].slice(0, max);
  const removed = previous.filter((id) => !next.includes(id));
  return { next, removed };
}
