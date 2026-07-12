import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const extensionDirectory = new URL("../", import.meta.url);
const outputDirectory = new URL("../dist/", import.meta.url);
const apiBaseUrl = process.env.EXTENSION_API_BASE_URL;

if (!apiBaseUrl) {
  throw new Error("Set EXTENSION_API_BASE_URL to the HTTPS origin of the deployed Worker before building the extension.");
}

const apiUrl = new URL(apiBaseUrl);
const isLocalDevelopment = apiUrl.protocol === "http:" && ["127.0.0.1", "localhost"].includes(apiUrl.hostname);

if (apiUrl.protocol !== "https:" && !isLocalDevelopment) {
  throw new Error("EXTENSION_API_BASE_URL must use HTTPS outside localhost development.");
}

if (apiUrl.username || apiUrl.password) {
  throw new Error("EXTENSION_API_BASE_URL must not contain credentials.");
}

if (apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash) {
  throw new Error("EXTENSION_API_BASE_URL must be an origin without a path, query, or fragment.");
}

const apiOrigin = apiUrl.origin;
const hostPermission = `${apiUrl.protocol}//${apiUrl.hostname}/*`;
const outputPath = fileURLToPath(outputDirectory);
await rm(outputPath, { recursive: true, force: true });
await mkdir(outputPath, { recursive: true });

const manifestTemplate = JSON.parse(await readFile(new URL("manifest.template.json", extensionDirectory), "utf8"));
manifestTemplate.host_permissions = [hostPermission];

const bundle = await Bun.build({
  entrypoints: [
    fileURLToPath(new URL("src/popup.js", extensionDirectory)),
    fileURLToPath(new URL("src/background.js", extensionDirectory)),
  ],
  outdir: outputPath,
  format: "esm",
  target: "browser",
  minify: true,
  define: {
    __API_ORIGIN__: JSON.stringify(apiOrigin),
  },
});

if (!bundle.success) {
  for (const message of bundle.logs) {
    console.error(message);
  }
  throw new Error("Extension bundle failed.");
}

const assetNames = [
  "developed-with-youtube.png",
  "developed-with-youtube-light.png",
  "icon-active-16.png",
  "icon-active-32.png",
  "icon-active-48.png",
  "icon-active-128.png",
  "icon-inactive-16.png",
  "icon-inactive-32.png",
  "icon-inactive-48.png",
  "icon-inactive-128.png",
];

await Promise.all([
  Bun.write(new URL("manifest.json", outputDirectory), `${JSON.stringify(manifestTemplate, null, 2)}\n`),
  Bun.write(new URL("popup.html", outputDirectory), Bun.file(new URL("popup.html", extensionDirectory))),
  Bun.write(new URL("popup.css", outputDirectory), Bun.file(new URL("popup.css", extensionDirectory))),
  Bun.write(new URL("privacy.html", outputDirectory), Bun.file(new URL("privacy.html", extensionDirectory))),
  mkdir(fileURLToPath(new URL("assets/", outputDirectory)), { recursive: true }).then(() =>
    Promise.all(
      assetNames.map((name) =>
        Bun.write(new URL(`assets/${name}`, outputDirectory), Bun.file(new URL(`assets/${name}`, extensionDirectory))),
      ),
    ),
  ),
]);

console.log(`Built extension for ${apiOrigin}`);
