import { expect, test } from "bun:test";

const manifest = JSON.parse(await Bun.file(new URL("../manifest.template.json", import.meta.url)).text());
const privacyPolicy = await Bun.file(new URL("../privacy.html", import.meta.url)).text();
const popupSource = await Bun.file(new URL("../src/popup.js", import.meta.url)).text();

test("keeps the manifest popup-only and narrowly permissioned", () => {
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.action.default_popup).toBe("popup.html");
  expect(manifest.permissions).toContain("activeTab");
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.permissions).not.toContain("scripting");
  expect(manifest.host_permissions).toEqual(["__API_ORIGIN__/*"]);
});

test("includes the required privacy links and never uses HTML comment rendering", () => {
  expect(privacyPolicy).toContain("https://www.youtube.com/t/terms");
  expect(privacyPolicy).toContain("https://policies.google.com/privacy");
  expect(privacyPolicy).toContain("session storage");
  expect(popupSource).not.toContain("innerHTML");
  expect(popupSource).toContain("chrome.storage.session");
});
