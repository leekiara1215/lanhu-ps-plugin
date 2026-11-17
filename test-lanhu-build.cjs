"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const vm = require("node:vm");
const { prepareRuntime } = require("./Panel/build-lanhu-runtime.cjs");
const { projectId } = require("./compatibility.json");
const official = process.env.GAMEUI_OFFICIAL_PLUGIN;

test("integrated build rejects an unknown official package before creating staging", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gameui-lanhu-invalid-"));
    try {
        const input = path.join(temp, "official"), output = path.join(temp, "panel");
        fs.mkdirSync(input); fs.writeFileSync(path.join(input, "manifest.json"), "{}"); fs.writeFileSync(path.join(input, "index.js"), "throw new Error('must not execute')");
        const result = cp.spawnSync(process.execPath, ["Panel/build-panel.cjs", output, "--official-plugin", input], { encoding: "utf8" });
        assert.equal(result.status, 1); assert.match(result.stderr, /Unsupported official manifest\/index hash/);
        assert.equal(fs.existsSync(output), false);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("pinned integrated runtime loads as an inert factory and staging records its identity", { skip: !official }, () => {
    const value = prepareRuntime(official);
    const context = { module: { exports: {} } };
    vm.runInNewContext(value.runtime, context);
    assert.equal(typeof context.module.exports, "function", "Loading the artifact must not bootstrap Vue or access host/network APIs.");
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gameui-lanhu-build-"));
    try {
        const output = path.join(temp, "panel");
        const result = cp.spawnSync(process.execPath, ["Panel/build-panel.cjs", output, "--official-plugin", official], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        const identity = JSON.parse(fs.readFileSync(path.join(output, "lanhu-runtime.json")));
        assert.deepEqual(identity, value.identity);
        assert.equal(fs.readFileSync(path.join(output, "lanhu-runtime.js"), "utf8"), value.runtime);
        const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json")));
        assert.equal(manifest.id, "com.bettagames.gameui.authoring.test"); assert.equal(manifest.host.data.apiVersion, 2);
        assert.equal(manifest.requiredPermissions.network.domains, "all");
        assert.ok(fs.existsSync(path.join(output, "gameui-export.js")));
        assert.equal(cp.spawnSync(process.execPath, ["Panel/build-panel.cjs", output, "--official-plugin", official]).status, 1);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("generated actual official uploader rejects a different project before requesting an OSS token", { skip: !official }, async () => {
    const value = prepareRuntime(official);
    const begin = value.runtime.indexOf("70567:function(M,t,e){"), end = value.runtime.indexOf("},76163:function(M,t,e){", begin);
    assert.ok(begin > 0 && end > begin);
    let tokenRequests = 0;
    const context = { Promise, console: { log() {}, error() {} }, gameuiHost: { assertUploadAllowed(config) {
        if (!config || config.projectId !== projectId) throw new Error("test project required");
    } } };
    const factory = vm.runInNewContext("(" + value.runtime.slice(begin + "70567:".length, end + 1) + ")", context);
    const exports = {};
    factory({}, exports, id => {
        if (id === 49992) return { UploadCallBackType: { artboard: "artboard" }, UploadItemStatusConfig: { error: "error" } };
        if (id === 8322) return { ArrayBuffer: { hash() { throw new Error("Unexpected image hashing"); } } };
        if (id === 76163) return { async initUploadToken() { tokenRequests++; return null; } };
        throw new Error("Unexpected dependency " + id);
    });
    assert.throws(() => exports.uploadSingleArtboart({}, { projectId: "production" }, () => {}), /test project required/);
    assert.equal(tokenRequests, 0);
    const events = [];
    await exports.uploadSingleArtboart({ info: {} }, { projectId }, event => events.push(event));
    assert.equal(tokenRequests, 1); assert.equal(events.length, 1);
});

test("generated actual official slice API keeps the API2 modal active until native grouping finishes", { skip: !official }, async () => {
    const value = prepareRuntime(official);
    const begin = value.runtime.indexOf("86350:function(M,t,e){"), end = value.runtime.indexOf("},14388:(M,t)=>", begin);
    assert.ok(begin > 0 && end > begin);
    let release, entered, modalActive = false, calls = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const grouping = new Promise(resolve => { entered = resolve; });
    const context = { Promise, console: { log() {}, error() {} }, gameuiHost: { async runModal(action) {
        calls++; modalActive = true;
        try { return await action(); } finally { modalActive = false; }
    } } };
    const factory = vm.runInNewContext("(" + value.runtime.slice(begin + "86350:".length, end + 1) + ")", context);
    const exports = {};
    class Formatter {
        async sliceWithGroup(name, padding) { assert.equal(name, "group"); assert.equal(padding, 4); assert.equal(modalActive, true); entered(); await gate; assert.equal(modalActive, true); return "grouped"; }
    }
    factory({}, exports, id => {
        if (id === 96262) return { LHPS2021Formatter: Formatter };
        if ([43192, 86876, 49992, 95913, 12578, 39858].includes(id)) return {};
        throw new Error("Unexpected dependency " + id);
    });
    const pending = exports.sliceWithGroup("group", 4); await grouping;
    await new Promise(resolve => setImmediate(resolve)); assert.equal(modalActive, true);
    release(); assert.equal(await pending, "grouped"); assert.equal(modalActive, false); assert.equal(calls, 1);
});

test("generated official crypto fallback resolves inside the isolated window without a host crypto global", { skip: !official }, () => {
    const value = prepareRuntime(official);
    const begin = value.runtime.indexOf("crypto=window.crypto||(window.crypto="), end = value.runtime.indexOf(",k.default.config", begin);
    assert.ok(begin > 0 && end > begin);
    const context = { window: {}, module: { exports: null }, Uint8Array, e(id) {
        assert.equal(id, 97147); return bytes => bytes.fill(0);
    } };
    vm.runInNewContext("let crypto;" + value.runtime.slice(begin, end) + ";module.exports=crypto.randomUUID();", context);
    assert.match(context.module.exports, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(context.crypto, undefined, "The scoped fallback must not assign a real host global.");
});
