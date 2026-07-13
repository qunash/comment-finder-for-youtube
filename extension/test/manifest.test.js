import { expect, test } from "bun:test";

const manifest = JSON.parse(await Bun.file(new URL("../manifest.template.json", import.meta.url)).text());
const privacyPolicy = await Bun.file(new URL("../privacy.html", import.meta.url)).text();
const popupSource = await Bun.file(new URL("../src/popup.js", import.meta.url)).text();

test("keeps the manifest narrowly permissioned with popup and optional side panel", () => {
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.minimum_chrome_version).toBe("142");
  expect(manifest.action.default_popup).toBe("popup.html");
  expect(manifest.side_panel).toEqual({ default_path: "sidepanel.html" });
  expect(manifest.commands["open-side-panel"]).toEqual({
    suggested_key: {
      default: "Alt+Shift+C",
      mac: "Option+Shift+C",
    },
    description: "Open Comment Finder in the side panel",
  });
  expect(manifest.background).toEqual({ service_worker: "background.js", type: "module" });
  expect(manifest.permissions).toContain("activeTab");
  expect(manifest.permissions).toContain("declarativeContent");
  expect(manifest.permissions).toContain("sidePanel");
  // Prefer YouTube host_permissions over broad `tabs` for reading page URLs.
  expect(manifest.permissions).not.toContain("tabs");
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.permissions).not.toContain("scripting");
  expect(manifest.host_permissions).toEqual([
    "__API_ORIGIN__/*",
    "https://www.youtube.com/*",
    "https://m.youtube.com/*",
    "https://youtube.com/*",
  ]);
  expect(manifest.icons["128"]).toBe("assets/icon-active-128.png");
  expect(manifest.action.default_icon["128"]).toBe("assets/icon-inactive-128.png");
});

test("includes the required privacy links and never uses HTML comment rendering", () => {
  expect(privacyPolicy).toContain("https://www.youtube.com/t/terms");
  expect(privacyPolicy).toContain("https://policies.google.com/privacy");
  expect(privacyPolicy).toContain("session storage");
  expect(popupSource).not.toContain("innerHTML");
  expect(popupSource).toContain("chrome.storage.session");
});
