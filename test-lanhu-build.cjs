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
const { fixture } = require("./test-export-fixtures.cjs");
const official = process.env.GAMEUI_OFFICIAL_PLUGIN;

function loadPinnedFormatter(runtime, context, photoshop, batchPlay) {
    const begin = runtime.indexOf("96262:function(M,t,e){"), end = runtime.indexOf("},49467:(M,t)=>", begin);
    assert.ok(begin > 0 && end > begin);
    const factory = vm.runInNewContext("(" + runtime.slice(begin + "96262:".length, end + 1) + ")", context);
    const exports = {};
    factory({}, exports, id => {
        if (id === 49467) return { LHPSBaseFormatter: function () {} };
        if (id === 95913) return { batchPlay, selectLayer: layerId => layerId };
        if (id === 43192) return photoshop;
        if (id === 86876) return { host: { version: "offline" } };
        if (id === 14388) return { md5StringToUUID: key => key };
        if (id === 8322) return { hash: key => key };
        if (id === 39858) return { layerIsGroup: layer => layer.type === "layerSection", formatLayerType: layer => layer.type, fixFrame() {} };
        if (id === 78088) return {};
        throw new Error("Unexpected pinned formatter dependency " + id);
    });
    return new exports.LHPS2021Formatter();
}

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
        assert.match(fs.readFileSync(path.join(output, "index.html"), "utf8"), /data-lanhu-runtime="included"/);
        assert.ok(fs.existsSync(path.join(output, "gameui-export.js")));
        assert.equal(cp.spawnSync(process.execPath, ["Panel/build-panel.cjs", output, "--official-plugin", official]).status, 1);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("generated Popper initializes against the detached runtime without registering scroll or resize listeners", { skip: !official }, () => {
    const { runtime } = prepareRuntime(official);
    const marker = "12975:";
    const begin = runtime.indexOf(marker), end = runtime.indexOf("},55798:", begin);
    assert.ok(begin > 0 && end > begin);
    const listeners = [], pending = [];
    const window = { getComputedStyle: () => ({}), addEventListener: name => listeners.push(name) };
    const body = { nodeName: "DIV", nodeType: 1, parentNode: null, addEventListener: name => listeners.push(name) };
    const document = { body, defaultView: window };
    body.ownerDocument = document;
    const reference = { nodeName: "DIV", nodeType: 1, ownerDocument: document, parentNode: body };
    const factory = vm.runInNewContext("(" + runtime.slice(begin + marker.length, end + 1) + ")", {
        window, document, navigator: { userAgent: "Photoshop UXP" }, setTimeout: callback => pending.push(callback)
    });
    const module = {};
    factory(module, {}, {});
    const Popper = module.exports;
    Popper.Defaults.modifiers = {};
    let updates = 0;
    Popper.prototype.update = () => { updates++; };
    const instance = new Popper(reference, {}, { eventsEnabled: true });
    assert.equal(instance.state.eventsEnabled, false);
    assert.equal(pending.length, 1);
    pending[0]();
    assert.equal(updates, 1);
    assert.deepEqual(listeners, []);
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

test("generated pinned formatter scopes the actual native analysis loop and stops a mismatched batch before cover export", { skip: !official }, async () => {
    const { runtime } = prepareRuntime(official);
    const f = fixture();
    delete f.metadata.optionalFuture;
    const bounds = { left: 0, top: 0, right: 80, bottom: 80 };
    const document = { id: 55, name: "Synthetic.psd", bounds, layers: [
        { id: 101, type: "artboardSection", bounds, name: "Same title", layers: [{ id: 12 }] },
        { id: 102, type: "artboardSection", bounds, name: "Same title", layers: [{ id: 32 }] }
    ] };
    const failures = [], coverExports = [], seen = [];
    let expected = { documentId: 55, boardIds: ["101", "102"] };
    let modal = false, sliceChanges = 0;
    const photoshop = { app: { activeDocument: { _id: 55, title: document.name, name: document.name } } };
    const context = { Promise, console: { log() {}, error() {} }, gameuiHost: {
        assertUploadAllowed(config) { assert.equal(config.projectID, projectId); },
        async runModal(action) {
            modal = true;
            try { return await action(); } finally { modal = false; }
        },
        takeUploadScope() { assert.equal(modal, true); return expected; },
        reportUploadAnalysisFailure(error) { failures.push(error); }
    }, require(name) {
        if (name === "photoshop") return photoshop;
        assert.equal(name, "./gameui-export.js");
        return f.exporter;
    } };
    const formatter = loadPinnedFormatter(runtime, context, photoshop, async () => {
        assert.equal(modal, true);
        return [{ json: JSON.stringify(document) }];
    });
    formatter.hiddenSlice = formatter.showSlice = () => { sliceChanges++; };
    formatter.exportArtboard = async (_, __, board) => { assert.equal(modal, true); coverExports.push(board); return "mock-cover"; };
    formatter.formatLayer = async layer => ({
        id: layer.id, originID: layer.id, frame: { width: 20, height: 14 }, image: { imageUrl: "https://test.invalid/image" }
    });
    const run = ids => formatter.analysis({ projectID: projectId, selectArtboards: ids.map(id => ({ id })) },
        (ok, board) => seen.push([ok, board.id]));
    const mixed = await run(["102", "101"]);
    assert.equal(failures.length, 0, failures[0]?.stack);
    assert.deepEqual(Array.from(mixed, item => item.json.artboard.originID), ["101", "102"]);
    assert.equal(mixed[0].json.gameUI.nodes[12].nodeId, "persistent-instance");
    assert.equal(mixed[1].json.gameUI, undefined);
    assert.deepEqual(coverExports, [101, 102]);
    assert.deepEqual(seen, [[true, 101], [true, 102]]);
    assert.equal(sliceChanges, 2);
    expected = { documentId: 55, boardIds: ["102"] };
    const selected = await run(["102"]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].json.artboard.originID, "102");
    assert.equal(selected[0].json.gameUI, undefined);
    const wrong = await run(["101", "102"]);
    assert.equal(wrong.length, 0);
    assert.deepEqual(coverExports, [101, 102, 102]);
    assert.equal(sliceChanges, 4);
    assert.equal(failures[0].code, "GAMEUI_UPLOAD_SCOPE");
    assert.deepEqual(seen.at(-1), [false, undefined]);
});

test("native formatter exports validation images for scoped GameUI instances without slice prefixes", { skip: !official }, async () => {
    const { runtime } = prepareRuntime(official);
    const f = fixture();
    delete f.metadata.optionalFuture;
    const marked = { id: 12, name: "Ordinary-name nine-slice", type: "layer" };
    const ordinary = { id: 13, name: "Ordinary unmarked layer", type: "layer" };
    const nativeSlice = { id: 14, name: "-h-Native slice", type: "layer" };
    const artboard = { id: 101, type: "artboardSection", layers: [marked, ordinary, nativeSlice] };
    const otherBoard = { id: 102, type: "artboardSection", layers: [{ ...marked, id: 22 }] };
    f.metadata.nodes[22] = { ...f.metadata.nodes[12], nodeId: "other-instance" };
    const document = { id: 55, layers: [artboard, otherBoard] };
    const active = { id: 55, activeLayers: [] };
    const photoshop = { app: { activeDocument: active } };
    const settings = { projectID: projectId, selectArtboards: [{ id: "101" }], sliceScale: 3 };
    const layers = [...artboard.layers, ...otherBoard.layers];
    const bounds = { left: 15, top: 30, right: 35, bottom: 44 };
    const frame = { left: 0, top: 0, width: 100, height: 100 };
    const formatter = loadPinnedFormatter(runtime, { Promise, console: { log() {} }, require: () => f.exporter }, photoshop, async id => {
        const layer = layers.find(value => value.id === id);
        active.activeLayers = [{ _id: id, name: layer.name, bounds }];
    });
    const crops = [];
    const nativeCalls = [];
    const bitmap = Uint8Array.of(1, 2, 3).buffer;
    formatter.formatFrame = async () => ({ left: 15, top: 30, width: 20, height: 14 });
    formatter._exportSlicedCopy = async (...args) => { crops.push(args); return bitmap; };
    formatter.exportSlice = async (...args) => { nativeCalls.push(args); return bitmap; };
    await f.exporter.prepareAnalysis(document, settings, active);
    const instance = await formatter.formatLayer(marked, frame, settings);
    assert.equal(instance.name, marked.name);
    assert.equal(instance.hasExportImage, true);
    assert.equal(instance.image.bitmap, bitmap);
    assert.deepEqual(crops, [[bounds, frame, 3, active]]);
    for (const layer of [ordinary, otherBoard.layers[0]]) {
        assert.equal((await formatter.formatLayer(layer, frame, settings)).image, undefined);
    }
    assert.equal((await formatter.formatLayer(marked, frame, { ...settings })).image, undefined);
    const alreadySliced = await formatter.formatLayer(nativeSlice, frame, settings);
    assert.equal(alreadySliced.name, "Native slice");
    assert.equal(alreadySliced.image.bitmap, bitmap);
    assert.deepEqual(nativeCalls, [[nativeSlice.id, 3, bounds, frame]]);
    assert.equal(crops.length, 1);
});

test("standalone adapter keeps the native canvas path for prior bundles and projects outside isolation", { skip: !official }, async () => {
    const result = cp.spawnSync("python3", ["-B", "-c", [
        "import runpy, sys",
        "from pathlib import Path",
        'build = runpy.run_path("build-audit-patch.py")["build"]',
        "sys.stdout.buffer.write(build(Path(sys.argv[1]).read_bytes()))"
    ].join("\n"), path.join(official, "index.js")], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);

    const document = { id: 55, name: "Plain.psd", bounds: { left: 0, top: 0, right: 80, bottom: 80 }, layers: [] };
    const photoshop = { app: { activeDocument: { id: 55, name: document.name, title: document.name } } };
    const calls = [];
    const adapter = { capture(payload, _, __, ___, scope) { calls.push(scope?.mode); return payload; } };
    const formatter = loadPinnedFormatter(result.stdout, {
        Promise, console: { log() {}, error() {} }, require(name) {
            return name === "photoshop" ? photoshop : adapter;
        }
    }, photoshop, async () => [{ json: JSON.stringify(document) }]);
    formatter.exportArtboard = async () => "mock-cover";
    const run = (projectID, selectArtboards = []) => formatter.analysis({ projectID, selectArtboards });
    assert.equal((await run(projectId)).length, 1);
    adapter.prepareAnalysis = input => { calls.push("prepare"); return input; };
    assert.equal((await run("other-project")).length, 1);
    assert.equal((await run(projectId, [{ id: "55" }])).length, 1);
    assert.deepEqual(calls, [undefined, undefined, "prepare", "Background"]);
});

test("generated Home waits for the pinned Vue Router's callbacks and keeps precheck failures local", { skip: !official }, async () => {
    const { runtime } = prepareRuntime(official);
    const check = runtime.indexOf("t.next=59,ct.postImagePreCheck(M.token,M.projectId,c);");
    const start = runtime.indexOf("case 59:", check);
    const end = runtime.indexOf("case 61:", start);
    assert.ok(check > 0 && start > check && end > start);
    const routerModule = "78345:";
    const routerStart = runtime.indexOf(routerModule + "(M,t,e)=>"), routerEnd = runtime.indexOf("},17378:(M,t,e)=>", routerStart);
    assert.ok(routerStart > 0 && routerEnd > routerStart);
    const createRouterModule = vm.runInNewContext("(" + runtime.slice(routerStart + routerModule.length, routerEnd + 1) + ")");
    const exports = {};
    createRouterModule({}, exports, { r() {}, d(target, definitions) {
        for (const key of Object.keys(definitions)) Object.defineProperty(target, key, { get: definitions[key] });
    } });
    assert.equal(exports.default.version, "2.8.1");
    function UploadPage() {}
    UploadPage.cid = 1;
    UploadPage.options = {};
    const router = new exports.default({ mode: "abstract", routes: [{ name: "upload", path: "/upload", component: UploadPage }] });
    let finishNavigation;
    router.beforeEach((_, __, next) => { finishNavigation = next; });
    const errors = [];
    const home = { $router: router, showPluginErr(code, message) { errors.push([code, message]); } };
    const runPrecheck = vm.runInNewContext(
        "(function(M,t){var g,u,n=[];" + runtime.slice(start + "case 59:".length, end) + "})",
        { w: { lanhuLogger: { setLogPoint() {} } } }
    );
    function run(response) {
        return runPrecheck(home, { sent: response, abrupt(type, value) { assert.equal(type, "return"); return value; } });
    }
    assert.equal(run({ code: "00000", data: { img_num_overrun: true } }), undefined);
    assert.equal(run({ code: "test-denied", msg: "denied" }), undefined);
    assert.deepEqual(errors, [["20007", ""], ["test-denied", "denied"]]);
    assert.equal(finishNavigation, undefined);

    let settled = false;
    const handoff = run({ code: "00000" });
    assert.equal(typeof handoff?.then, "function");
    const committed = handoff.then(route => { settled = true; return route; });
    await Promise.resolve();
    assert.notEqual(router.currentRoute.name, "upload");
    assert.equal(settled, false);
    finishNavigation();
    assert.equal((await committed).name, "upload");
    assert.equal(router.currentRoute.name, "upload");
    await assert.rejects(run({ code: "00000" }), /upload navigation aborted/);
});

test("generated upload route stops a changed or empty queue before calling the official business adapter", { skip: !official }, () => {
    const { runtime } = prepareRuntime(official);
    const start = runtime.indexOf("uploadArtboards:function(){var M=this;try{gameuiHost.checkUploadScope");
    const end = runtime.indexOf(",submitLanhu:function", start);
    assert.ok(start > 0 && end > start);
    let reported, transfers = 0;
    const scopeError = new Error("scope changed");
    const component = vm.runInNewContext("({" + runtime.slice(start, end) + "})", {
        gameuiHost: {
            checkUploadScope(boards) { if (boards.length !== 1 || boards[0].id !== "101") throw scopeError; },
            reportUploadAnalysisFailure(error) { reported = error; }
        },
        HN: { Z: { setIntervalTime() {} } }, GN: () => ({ uploadArtboards() { transfers++; } })
    });
    component.$route = { query: {} };
    component.$store = { state: {} };
    component.UploadStatusConfig = { fail: 3 };
    for (const boards of [[], [{ id: "102" }], [{ id: "101" }, { id: "102" }]]) {
        component.artboardPoolList = boards;
        component.uploadArtboards();
        assert.equal(component.uploadStatus, 3);
        assert.equal(reported, scopeError);
    }
    assert.equal(transfers, 0);
    component.artboardPoolList = [{ id: "101" }];
    component.uploadArtboards();
    assert.equal(transfers, 1);
});

test("generated submit waits for group assignment and marks a missing confirmation as uncertain", { skip: !official }, async () => {
    const { runtime } = prepareRuntime(official);
    const prefix = "40404:";
    const start = runtime.indexOf(prefix + "function(M,t,e)"), end = runtime.indexOf("},80863:", start);
    assert.ok(start > 0 && end > start);
    const factory = vm.runInNewContext("(" + runtime.slice(start + prefix.length, end + 1) + ")", { console: { log() {} } });
    const exports = {}, calls = [];
    let confirm, entered;
    const groupEntered = new Promise(resolve => { entered = resolve; });
    const api = {
        async uploadToLanhu(payload) {
            assert.equal(payload.artboardList, undefined);
            assert.equal(payload.images[0].sid, "prepared");
            return { result: [{ id: "cloud-id" }] };
        },
        uploadDataToGroup(payload) {
            calls.push(payload);
            entered();
            return new Promise(resolve => { confirm = resolve; });
        }
    };
    factory({}, exports, id => id === 94924 ? api : {});
    const input = () => ({ project_id: "project", images: [], artboardList: [{ image: { sid: "prepared" } }] });
    let completed = false;
    const pending = exports.default.submitLanhu(input(), "token", "group").then(value => { completed = true; return value; });
    await groupEntered;
    assert.equal(completed, false);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { add_image_ids: ["cloud-id"], sector_id: "group", project_id: "project" });
    confirm(undefined);
    assert.equal(await pending, undefined);
    api.uploadDataToGroup = async () => ({ code: "00000" });
    assert.equal((await exports.default.submitLanhu(input(), "token", "group")).result[0].id, "cloud-id");
});

test("generated ordinary slice crops with public coordinates from a Photoshop Rectangle", { skip: !official }, () => {
    const { runtime } = prepareRuntime(official);
    const method = runtime.indexOf("t.prototype._exportSlicedCopy=function");
    const start = runtime.indexOf("case 2:return r.sent(),", method), end = runtime.indexOf("case 3:", start);
    assert.ok(method > 0 && start > method && end > start);
    const cropped = [];
    const runCrop = vm.runInNewContext(
        "(function(M,t){var A,r={sent(){}};" + runtime.slice(start + "case 2:".length, end) + "})",
        { j: { app: { activeDocument: { crop(bounds) { cropped.push({ ...bounds }); } } } },
            console: { log() {} }, o: Object.assign }
    );
    class Rectangle {
        constructor(left, top, right, bottom) {
            this._left = left; this._top = top; this._right = right; this._bottom = bottom;
        }
        get left() { return this._left; }
        get top() { return this._top; }
        get right() { return this._right; }
        get bottom() { return this._bottom; }
    }
    const frame = { left: 0, top: 0, width: 100, height: 140 };
    runCrop(new Rectangle(-4, 8, 130, 160), frame);
    runCrop({ left: 3, top: 4, right: 18, bottom: 24 }, frame);
    assert.deepEqual(cropped, [
        { left: 0, top: 8, right: 100, bottom: 140 },
        { left: 3, top: 4, right: 18, bottom: 24 }
    ]);
});

test("generated frame slice export reads the API2 LayerCollection and retains the group fallback", { skip: !official }, async () => {
    const { runtime } = prepareRuntime(official);
    const document = { activeLayers: [] };
    const guide = { name: "-slice-", boundsNoEffects: { left: 12, top: 5, right: 54, bottom: 23 } };
    const group = { name: "-s-frame", boundsNoEffects: { left: 10, top: 3, right: 56, bottom: 25 } };
    const formatter = loadPinnedFormatter(runtime, { console: { log() {}, error() {} } },
        { app: { activeDocument: document } }, async id => {
            assert.equal(id, 37);
            document.activeLayers = [group];
        });
    const frame = { left: 0, top: 0, width: 100, height: 100 };
    const cropBounds = [];
    formatter._exportSlicedCopy = async (bounds, area, scale, source) => {
        assert.equal(area, frame);
        assert.equal(scale, 2);
        assert.equal(source, document);
        cropBounds.push(bounds);
        return "slice";
    };
    group.layers = { 0: { name: "content" }, 1: guide, length: 2 };
    assert.equal(await formatter.exportSlice(37, 2, null, frame), "slice");
    group.layers = { 0: { name: "content" }, length: 1 };
    assert.equal(await formatter.exportSlice(37, 2, null, frame), "slice");
    assert.deepEqual(cropBounds, [guide.boundsNoEffects, group.boundsNoEffects]);
});

test("generated actual official slice API keeps the API2 modal active until native grouping finishes", { skip: !official }, async () => {
    const value = prepareRuntime(official);
    const begin = value.runtime.indexOf("86350:function(M,t,e){"), end = value.runtime.indexOf("},14388:(M,t)=>", begin);
    assert.ok(begin > 0 && end > begin);
    let release, entered, modalActive = false, calls = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const grouping = new Promise(resolve => { entered = resolve; });
    const context = { Promise, console: { log() {}, error() {} }, gameuiHost: { async runModal(action, historyName) {
        assert.equal(historyName, "蓝湖切图");
        calls++; modalActive = true;
        try { return await action(); } finally { modalActive = false; }
    } } };
    const factory = vm.runInNewContext("(" + value.runtime.slice(begin + "86350:".length, end + 1) + ")", context);
    const exports = {};
    class Formatter {
        async sliceWithGroup(width, height) { assert.equal(width, 80); assert.equal(height, 48); assert.equal(modalActive, true); entered(); await gate; assert.equal(modalActive, true); return "grouped"; }
    }
    factory({}, exports, id => {
        if (id === 96262) return { LHPS2021Formatter: Formatter };
        if ([43192, 86876, 49992, 95913, 12578, 39858].includes(id)) return {};
        throw new Error("Unexpected dependency " + id);
    });
    const pending = exports.sliceWithGroup(80, 48); await grouping;
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

test("generated actual bootstrap attaches pinned business adapters to the private VM for native controls", { skip: !official }, () => {
    const value = prepareRuntime(official);
    const start = value.runtime.indexOf('window.VM=new k.default(');
    const end = value.runtime.indexOf('})()})();', start);
    assert.ok(start > 0 && end > start);
    const modules = new Map([62824, 62909, 78578, 94878].map(id => [id, { id, DeviceScaleDic: { Web: [] }, SelectScaleConfig: {} }]));
    const context = { window: {}, k: { default: class { constructor(options) { this.options = options; } $mount(selector) { assert.equal(selector, "#app"); return this; } } }, q: () => "router", MM: () => "store", X: "app", e(id) { assert.ok(modules.has(id)); return modules.get(id); } };
    vm.runInNewContext(value.runtime.slice(start, end), context);
    assert.equal(context.window.VM.$gameuiServices.auth, modules.get(62824));
    assert.equal(context.window.VM.$gameuiServices.project, modules.get(78578));
    assert.equal(context.window.VM.$gameuiServices.scales, modules.get(94878).DeviceScaleDic);
});

test("generated official slice visibility adapter retains the API2 completion promise", { skip: !official }, async () => {
    const value = prepareRuntime(official), start = value.runtime.indexOf("M.prototype.showSlice=function"), end = value.runtime.indexOf(",M.prototype.sliceWithLayer=", start);
    assert.ok(start > 0 && end > start);
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    function Adapter() {}
    vm.runInNewContext(value.runtime.slice(start, end), { M: Adapter, N: { showSlice: () => pending, hiddenSlice: () => pending } });
    const adapter = new Adapter();
    assert.equal(adapter.showSlice(), pending); assert.equal(adapter.hiddenSlice(), pending);
    finish("native completion"); assert.equal(await adapter.showSlice(), "native completion");
});

test("generated actual login component exposes the original browser handshake helpers without starting authorization", { skip: !official }, () => {
    const runtime = prepareRuntime(official).runtime, start = runtime.indexOf("browserConnection:function"), end = runtime.indexOf(",toSelect:function", start);
    assert.ok(start > 0 && end > start);
    let created = 0;
    const method = vm.runInNewContext("({" + runtime.slice(start, end) + "})", { p() { created++; return "official-generated-id"; }, Mt: { getDomain: () => "https://lanhuapp.com" } });
    assert.equal(created, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(method.browserConnection())), { id: "official-generated-id", domain: "https://lanhuapp.com" });
    assert.equal(created, 1);
});
