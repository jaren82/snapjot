#!/usr/bin/env node
// Build store-ready zips for Chrome and Firefox from the single source tree.
//
//   node tools/build.js
//
// Output: dist/snapjot-chrome-v<version>.zip, dist/snapjot-firefox-v<version>.zip
//
// The repo's manifest.json is the Chrome manifest (source of truth).
// The Firefox manifest is derived from it here — differences:
//   - background: event page (`scripts`) instead of a service worker
//   - browser_specific_settings.gecko: AMO add-on id + strict_min_version 127
//     (127 ships ClipboardItem/navigator.clipboard.write by default — the
//     core copy-to-clipboard path; older versions would silently fall back
//     to PNG download)
//   - data_collection_permissions: "none" (required for new AMO submissions)
//   - keyboard shortcut Alt+Shift+S — Firefox reserves Cmd/Ctrl+Shift+S for
//     its built-in screenshot tool, so the Chrome default would never bind
//   - minimum_chrome_version dropped

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const FILES = ["manifest.json", "background.js", "content.js"];
const DIRS = ["_locales", "icons"];

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const version = manifest.version;

function firefoxManifest(m) {
  const ff = structuredClone(m);
  ff.background = { scripts: ["background.js"] };
  delete ff.minimum_chrome_version;
  ff.browser_specific_settings = {
    gecko: {
      id: "snapjot@jaren82.dev",
      strict_min_version: "127.0",
      data_collection_permissions: { required: ["none"] },
    },
  };
  ff.commands._execute_action.suggested_key = {
    default: "Alt+Shift+S",
    mac: "Alt+Shift+S",
  };
  return ff;
}

function stage(browser, manifestObj) {
  const dir = path.join(DIST, browser);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of FILES) {
    if (f === "manifest.json") {
      fs.writeFileSync(path.join(dir, f), JSON.stringify(manifestObj, null, 2) + "\n");
    } else {
      fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    }
  }
  for (const d of DIRS) {
    fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  }
  // never ship Finder litter
  execFileSync("find", [dir, "-name", ".DS_Store", "-delete"]);
  return dir;
}

function zip(dir, name) {
  const out = path.join(DIST, name);
  fs.rmSync(out, { force: true });
  execFileSync("zip", ["-r", "-X", out, "."], { cwd: dir, stdio: "pipe" });
  return out;
}

fs.mkdirSync(DIST, { recursive: true });

const chromeDir = stage("chrome", manifest);
const chromeZip = zip(chromeDir, `snapjot-chrome-v${version}.zip`);

const ffDir = stage("firefox", firefoxManifest(manifest));
const ffZip = zip(ffDir, `snapjot-firefox-v${version}.zip`);

for (const z of [chromeZip, ffZip]) {
  console.log(`${path.relative(ROOT, z)}  (${(fs.statSync(z).size / 1024).toFixed(1)} KB)`);
}
