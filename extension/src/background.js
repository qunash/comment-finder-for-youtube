const ACTIVE_ICONS = {
  16: "assets/icon-active-16.png",
  32: "assets/icon-active-32.png",
  48: "assets/icon-active-48.png",
  128: "assets/icon-active-128.png",
};

const SUPPORTED_YOUTUBE_URL_PATTERN = "^https://(www\\.|m\\.)?youtube\\.com/(watch|shorts/|channel/|@)";

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
