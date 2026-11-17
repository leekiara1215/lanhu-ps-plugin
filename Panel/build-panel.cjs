"use strict";
const fs = require("node:fs");
const path = require("node:path");
const output = process.argv[2];
const extra = process.argv.slice(3);
if (!output || !path.isAbsolute(output) || (extra.length && (extra.length !== 2 || extra[0] !== "--official-plugin" || !path.isAbsolute(extra[1])))) {
    throw new Error("Usage: node Panel/build-panel.cjs /absolute/staging/path [--official-plugin /absolute/pinned/original]");
}
const target = path.resolve(output);
if (target === __dirname || target.startsWith(path.resolve(__dirname, "..") + path.sep)) throw new Error("Staging must be outside the Photoshop source tree.");
if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error("Staging directory must be new or empty; refusing overwrite.");
// Validate the complete optional input before writing anything to staging.
const integrated = extra.length ? require("./build-lanhu-runtime.cjs").prepareRuntime(extra[1]) : null;
fs.mkdirSync(target, { recursive: true });
const files = ["manifest.json", "index.html", "panel.css", "panel.js", "lanhu-host.js", "README.md"];
for (const file of files) fs.copyFileSync(path.join(__dirname, file), path.join(target, file));
const shared = ["gameui-core.js", "gameui-ps.js", "gameui-authoring.js", "gameui-export.js"];
for (const file of shared) fs.copyFileSync(path.join(__dirname, "..", file), path.join(target, file));
if (integrated) {
    fs.writeFileSync(path.join(target, "lanhu-runtime.js"), integrated.runtime);
    fs.writeFileSync(path.join(target, "lanhu-runtime.json"), JSON.stringify(integrated.identity, null, 2) + "\n");
    const manifest = JSON.parse(fs.readFileSync(path.join(target, "manifest.json")));
    // OSS endpoints are returned by the official service. Only the integrated build needs network access.
    manifest.requiredPermissions.network = { domains: "all" };
    manifest.requiredPermissions.launchProcess = { schemes: ["https", "http"], extensions: [] };
    fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    files.push("lanhu-runtime.js", "lanhu-runtime.json");
}
console.log(JSON.stringify({ entry: path.join(target, "manifest.json"), files: files.concat(shared), lanhuIncluded: !!integrated }));
