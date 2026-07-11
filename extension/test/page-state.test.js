import { expect, test } from "bun:test";
import {
  MAX_PAGE_STATES,
  PAGE_KEY_PREFIX,
  isPageState,
  nextPageOrder,
  pageStorageKey,
} from "../src/page-state.js";

test("builds per-video storage keys and accepts settled page state", () => {
  expect(pageStorageKey("dQw4w9WgXcQ")).toBe(`${PAGE_KEY_PREFIX}dQw4w9WgXcQ`);
  expect(
    isPageState({
      comments: [],
      keyword: "hello",
      metadata: { channelTitle: "Channel", title: "Title" },
      nextPageToken: null,
      status: "",
      statusState: "",
      updatedAt: 1,
    }),
  ).toBe(true);
  expect(isPageState({ keyword: "hello" })).toBe(false);
  expect(isPageState(null)).toBe(false);
});

test("moves a video to the front of the order and drops the oldest keys", () => {
  const order = Array.from({ length: MAX_PAGE_STATES }, (_, index) => `video${index}`);
  const { next, removed } = nextPageOrder(order, "fresh");

  expect(next[0]).toBe("fresh");
  expect(next).toHaveLength(MAX_PAGE_STATES);
  expect(next).not.toContain(`video${MAX_PAGE_STATES - 1}`);
  expect(removed).toEqual([`video${MAX_PAGE_STATES - 1}`]);

  const again = nextPageOrder(next, "fresh");
  expect(again.next[0]).toBe("fresh");
  expect(again.next.filter((id) => id === "fresh")).toHaveLength(1);
  expect(again.removed).toEqual([]);
});
