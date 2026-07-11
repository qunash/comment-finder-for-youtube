import { expect, test } from "bun:test";
import {
  MAX_PAGE_STATES,
  PAGE_KEY_PREFIX,
  isPageState,
  nextPageOrder,
  pageStorageKey,
  pageTargetKey,
} from "../src/page-state.js";

test("builds per-target storage keys and accepts settled page state", () => {
  expect(pageTargetKey({ kind: "video", videoId: "dQw4w9WgXcQ" })).toBe("video:dQw4w9WgXcQ");
  expect(pageTargetKey({ kind: "channel", channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw" })).toBe(
    "channel:UC_x5XG1OV2P6uZZ5FSM9Ttw",
  );
  expect(pageTargetKey({ kind: "handle", handle: "openai" })).toBe("handle:openai");
  expect(pageStorageKey("handle:openai")).toBe(`${PAGE_KEY_PREFIX}handle:openai`);
  expect(
    isPageState({
      comments: [],
      keyword: "hello",
      metadata: { channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw", title: "OpenAI" },
      nextPageToken: null,
      status: "",
      statusState: "",
      updatedAt: 1,
      videoTitles: { dQw4w9WgXcQ: "Example" },
    }),
  ).toBe(true);
  expect(isPageState({ keyword: "hello" })).toBe(false);
  expect(isPageState(null)).toBe(false);
});

test("moves a target to the front of the order and drops the oldest keys", () => {
  const order = Array.from({ length: MAX_PAGE_STATES }, (_, index) => `video:video${index}`);
  const { next, removed } = nextPageOrder(order, "handle:fresh");

  expect(next[0]).toBe("handle:fresh");
  expect(next).toHaveLength(MAX_PAGE_STATES);
  expect(next).not.toContain(`video:video${MAX_PAGE_STATES - 1}`);
  expect(removed).toEqual([`video:video${MAX_PAGE_STATES - 1}`]);

  const again = nextPageOrder(next, "handle:fresh");
  expect(again.next[0]).toBe("handle:fresh");
  expect(again.next.filter((id) => id === "handle:fresh")).toHaveLength(1);
  expect(again.removed).toEqual([]);
});
