"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const cp = require("node:child_process");
const author = require("./gameui-authoring.js");
const core = require("./gameui-core.js");
const clone = value => JSON.parse(JSON.stringify(value));
const border = { left: 1, top: 1, right: 2, bottom: 1, unit: "sourcePixel", center: "stretch" };
const options = { assetKey: "ui.button.primary", version: 1, displayName: "蓝色按钮", filterMode: "Point", nineSlice: border };
function pixels(width = 6, height = 5) {
    return Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? (i * 13) % 256 : (i * 37 + 11) % 256);
}
function fixture() {
    const data = pixels();
    // Keep nonzero RGB under alpha=0 so JPEG/matting/premultiplication cannot pass.
    data.set([213, 71, 39, 0], 0);
    const source = author.snapshot(data, 6, 5);
    return { data, source, metadata: author.define(author.createMetadata(), 10, options, source), ref: "ui.button.primary@1" };
}
function independentDecode(source) {
    const png = Buffer.from(source.pngBase64, "base64");
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), source.width); assert.equal(png.readUInt32BE(20), source.height);
    assert.deepEqual([...png.subarray(24, 29)], [8, 6, 0, 0, 0]);
    const compressed = [];
    let p = 8;
    while (p < png.length) {
        const n = png.readUInt32BE(p), type = png.toString("ascii", p + 4, p + 8);
        if (type === "IDAT") compressed.push(png.subarray(p + 8, p + 8 + n));
        p += n + 12;
    }
    const raw = zlib.inflateSync(Buffer.concat(compressed));
    const out = new Uint8Array(source.width * source.height * 4);
    for (let y = 0; y < source.height; y++) {
        const at = y * (source.width * 4 + 1); assert.equal(raw[at], 0);
        out.set(raw.subarray(at + 1, at + 1 + source.width * 4), y * source.width * 4);
    }
    return out;
}

test("PNG is deterministic, independently inflatable RGBA8 and preserves hidden RGB / soft alpha", () => {
    for (const [width, height] of [[1, 1], [6, 5], [257, 90]]) {
        const data = pixels(width, height); data.set([243, 15, 91, 0]);
        const source = author.snapshot(data, width, height);
        assert.deepEqual(independentDecode(source), data);
        assert.deepEqual(author.decodeSnapshot(source), data);
        assert.equal(source.pngBase64, author.snapshot(data, width, height).pngBase64);
        assert.deepEqual(Buffer.from(author.unbase64(source.pngBase64)), Buffer.from(source.pngBase64, "base64"));
    }
});

test("corrupt, truncated, wrong-size, non-RGBA and excessive PNG snapshots fail", () => {
    const { source } = fixture();
    const bytes = Buffer.from(source.pngBase64, "base64");
    const corrupt = Buffer.from(bytes); corrupt[45] ^= 1;
    for (const value of [
        { ...source, pngBase64: corrupt.toString("base64") }, { ...source, width: 7 },
        { ...source, pngBase64: bytes.subarray(0, 25).toString("base64") },
        { ...source, pngBase64: "not PNG" }, { ...source, height: 1e9 }
    ]) assert.throws(() => author.decodeSnapshot(value));
    assert.throws(() => author.snapshot(new Uint8Array(3), 1, 1), /RGBA/);
    assert.throws(() => author.snapshot(new Uint8Array(), 0, 5), /positive/);
    assert.throws(() => author.preview(source, border, 0, 4));
});

test("same assetRef freezes pixel, dimensions, full border, sampling and unknown resource contract", () => {
    const { metadata, source, data, ref } = fixture();
    const before = JSON.stringify(metadata);
    const same = author.define(metadata, 10, { ...options, displayName: "改显示名字" }, source);
    assert.equal(same.assets[ref].displayName, "改显示名字");
    assert.equal(same.nodes[10].nodeId, metadata.nodes[10].nodeId);
    assert.equal(JSON.stringify(metadata), before);
    const changedPixels = data.slice(); changedPixels[0] ^= 1;
    for (const [opts, src] of [
        [options, author.snapshot(changedPixels, 6, 5)],
        [{ ...options, filterMode: "Bilinear" }, source],
        [{ ...options, nineSlice: { ...border, left: 2 } }, source],
        [options, author.snapshot(pixels(7, 5), 7, 5)]
    ]) assert.throws(() => author.define(metadata, 10, opts, src), /Immutable assetRef conflict/);
    const directory = author.directory(metadata); directory.assets[ref].optionalFutureContract = { value: 3 };
    assert.throws(() => author.importDirectory(metadata, directory), /Immutable assetRef conflict/);
    const next = author.define(metadata, 10, { ...options, version: 2, filterMode: "Bilinear" }, source);
    assert.ok(next.assets[ref]); assert.ok(next.assets["ui.button.primary@2"]);
    assert.equal(next.nodes[10].nodeId, metadata.nodes[10].nodeId);
});

test("identity survives JSON save/reopen, rename and move; controlled copy gets new nodeId with same assetRef", () => {
    const { metadata, ref } = fixture();
    const reopened = JSON.parse(JSON.stringify(metadata));
    assert.deepEqual(author.inspect(reopened, [{ id: 10, name: "重命名并移动后" }]), []);
    const copied = author.copyNode(reopened, 10, 20);
    assert.equal(copied.nodes[20].assetRef, ref);
    assert.notEqual(copied.nodes[20].nodeId, reopened.nodes[10].nodeId);
    assert.equal(copied.nodes[20].nativeImageUsage, "validationReference");
    assert.equal(copied.nodes[20].sampling, undefined);
    assert.equal(copied.nodes[20].nineSlice, undefined);
    assert.throws(() => author.copyNode(reopened, 30, 40), /known source/);
    assert.throws(() => author.copyNode(reopened, 10, 10), /new Photoshop/);
    const fork = author.forkDocument(copied, [10, 20]);
    assert.notEqual(fork.documentId, copied.documentId); assert.notEqual(fork.artboardId, copied.artboardId);
    assert.notEqual(fork.nodes[10].nodeId, copied.nodes[10].nodeId);
    assert.deepEqual(fork.assets, copied.assets); assert.deepEqual(fork.authoring.sources, copied.authoring.sources);
    assert.deepEqual(fork.authoring.targets[fork.nodes[10].nodeId], copied.authoring.targets[copied.nodes[10].nodeId]);
    assert.equal(fork.authoring.targets[copied.nodes[10].nodeId], undefined);
    assert.throws(() => author.forkDocument(copied, [88]), /changed layer IDs/);
});

test("arbitrary duplicates remain unbound and require explicit repair; missing layer bindings are reported", () => {
    const { metadata, ref } = fixture();
    const issues = author.inspect(metadata, [{ id: 20, name: "原生拷贝" }]);
    assert.deepEqual(issues.map(value => value.code), ["UNBOUND", "MISSING_LAYER"]);
    assert.equal(metadata.nodes[20], undefined);
    const repaired = author.reference(metadata, 20, ref);
    assert.notEqual(repaired.nodes[20].nodeId, metadata.nodes[10].nodeId);
    const duplicate = clone(metadata); duplicate.nodes[20] = clone(duplicate.nodes[10]);
    assert.throws(() => author.validateMetadata(duplicate), /Duplicate/);
});

test("cross-PSD portable directory carries original snapshots and names, preserving unknown optional fields", () => {
    const { metadata, ref } = fixture();
    metadata.futureDocument = { opaque: true }; metadata.assets[ref].optionalFutureContract = { order: [2, 1] };
    metadata.nodes[10].optionalNode = "keep"; metadata.authoring.optionalAuthoring = { keep: true };
    const output = author.directory(metadata);
    assert.deepEqual(output.nodes, {}); assert.deepEqual(output.futureDocument, { opaque: true });
    assert.deepEqual(output.authoring.optionalAuthoring, { keep: true });
    const second = author.importDirectory(author.createMetadata(), JSON.parse(JSON.stringify(output)));
    const referenced = author.reference(second, 99, ref);
    assert.notEqual(referenced.documentId, metadata.documentId);
    assert.deepEqual(referenced.assets[ref], metadata.assets[ref]);
    assert.deepEqual(referenced.authoring.sources[ref], metadata.authoring.sources[ref]);
    assert.equal(author.reference(metadata, 10, ref).nodes[10].optionalNode, "keep");
    const reversed = clone(output); reversed.assets[ref].optionalFutureContract = { order: [2, 1] };
    assert.doesNotThrow(() => author.importDirectory(metadata, reversed));
});

test("unsupported schema/capability, malformed identities and instance overrides block writes", () => {
    const { metadata, ref } = fixture();
    const mutations = [
        value => value.schemaVersion = 2,
        value => value.documentId = "",
        value => value.artboardId = null,
        value => value.nodes[10].nodeId = 12,
        value => value.nodes[10].assetRef = {},
        value => value.nodes[10].nativeImageUsage = "unknown",
        value => value.requiredCapabilities.push("future.required"),
        value => value.assets[ref].requiredCapabilities = ["future.asset"],
        value => value.nodes[10].requiredCapabilities = ["future.node"],
        value => value.authoring.version = 2,
        value => value.nodes[10].sampling = { filterMode: "Point" },
        value => value.assets[ref].version = 3,
        value => value.assets[ref].nineSlice.left = 0.5,
        value => value.assets[ref].nineSlice.unit = "targetPixel",
        value => value.assets[ref].sampling.filterMode = "Trilinear"
    ];
    for (const mutate of mutations) { const value = clone(metadata); mutate(value); assert.throws(() => author.validateMetadata(value)); }
    assert.throws(() => author.define(metadata, 10, { ...options, version: 0 }, metadata.authoring.sources[ref]));
    const noSnapshot = clone(metadata); delete noSnapshot.authoring;
    assert.ok(author.inspect(noSnapshot, [{ id: 10, name: "source" }]).some(issue => issue.code === "MISSING_SOURCE"));
    assert.throws(() => author.directory(noSnapshot), /requires original snapshots/);
    assert.throws(() => author.reference(noSnapshot, 20, ref), /legacy resource/);
});

test("Point matches core and Bilinear interpolates across nine-slice seams while retaining fixed corners", () => {
    const { source, data } = fixture();
    assert.deepEqual(author.preview(source, border, 18, 15, { filterMode: "Point" }), core.renderNineSlice(data, 6, 5, border, 18, 15));
    const bilinear = author.preview(source, border, 18, 15, { filterMode: "Bilinear" });
    const expected = new Uint8Array(18 * 15 * 4);
    function coordinate(p, n, target, a, b) {
        return Math.max(0, Math.min(n - 1, p < a ? p : p >= target - b ? n - target + p : a + ((p - a + .5) / (target - a - b)) * (n - a - b) - .5));
    }
    for (let y = 0; y < 15; y++) for (let x = 0; x < 18; x++) {
        const sx = coordinate(x, 6, 18, 1, 2), sy = coordinate(y, 5, 15, 1, 1);
        const x0 = Math.floor(sx), y0 = Math.floor(sy), dx = sx % 1, dy = sy % 1;
        for (let c = 0; c < 4; c++) {
            let total = 0;
            for (const [ox, wx] of [[0, 1 - dx], [1, dx]]) for (const [oy, wy] of [[0, 1 - dy], [1, dy]]) {
                total += data[(Math.min(4, y0 + oy) * 6 + Math.min(5, x0 + ox)) * 4 + c] * wx * wy;
            }
            expected[(y * 18 + x) * 4 + c] = Math.round(total);
        }
    }
    assert.deepEqual(bilinear, expected);
    assert.deepEqual(bilinear.subarray(0, 4), data.subarray(0, 4));
    assert.notDeepEqual(bilinear, author.preview(source, border, 18, 15, { filterMode: "Point" }));
});

function host(overrides = {}) {
    const constants = { LayerKind: { NORMAL: "normal" }, DocumentMode: { RGB: "RGB" }, BitsPerChannelType: { EIGHT: 8 }, BlendMode: { NORMAL: "normal", PASSTHROUGH: "passThrough" } };
    const doc = { id: 1, mode: "RGB", bitsPerChannel: 8, colorProfileName: "sRGB IEC61966-2.1", typename: "Document" };
    const layer = { id: 10, name: "plain", kind: "normal", isBackgroundLayer: false, opacity: 100, fillOpacity: 100,
        visible: true, isClippingMask: false, blendMode: "normal", parent: doc,
        boundsNoEffects: { left: 5, top: 7, right: 11, bottom: 12 } };
    doc.layers = [layer]; doc.activeLayers = [layer];
    const data = fixture().data;
    const imageData = { width: 6, height: 5, components: 4, componentSize: 8, colorSpace: "RGB",
        async getData(options) { assert.equal(options.chunky, true); return data; }, dispose() { state.disposed++; } };
    const state = { disposed: 0, imagingCalls: [], writes: [], stored: null, descriptor: { _obj: "layer" }, xmp: {}, ...overrides };
    class XMPMeta {
        static registerNamespace() {}
        constructor(text) { this.values = text ? JSON.parse(text) : {}; }
        getProperty(_ns, key) { return this.values[key]; }
        setProperty(_ns, key, value) { this.values[key] = value; }
        serialize() { return JSON.stringify(this.values); }
    }
    const photoshop = { constants, app: { activeDocument: doc },
        action: { async batchPlay(commands) {
            const command = commands[0];
            if (command._target[0]._ref === "layer") return [state.descriptor];
            if (command._obj === "set") { state.stored = command.to.XMPMetadataAsUTF8; return [{}]; }
            return [{ XMPMetadataAsUTF8: state.stored || "" }];
        } },
        imaging: { async getPixels(options) {
            state.imagingCalls.push(options);
            return { imageData, level: 0, sourceBounds: { ...layer.boundsNoEffects }, ...(state.pixelResult || {}) };
        }, async createImageDataFromBuffer(raw, options) {
            return { raw, options, dispose() { state.disposed++; } };
        }, async putPixels(options) {
            state.writes.push(options);
            const { width, height } = options.imageData.options;
            const target = author.targetFromPixels(options.imageData.raw, width, height);
            const targetDocument = photoshop.app.documents && photoshop.app.documents.find(value => value.id === options.documentID) || doc;
            const active = targetDocument.layers.find(value => value.id === options.layerID);
            active.pixelData = options.imageData.raw.slice();
            active.boundsNoEffects = { left: options.targetBounds.left + target.insetLeft,
                top: options.targetBounds.top + target.insetTop,
                right: options.targetBounds.left + target.insetLeft + target.contentWidth,
                bottom: options.targetBounds.top + target.insetTop + target.contentHeight };
        } }
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "gameui-ps.js"), "utf8"), {
        module, Uint8Array, DataView, console, require(name) {
            if (name === "photoshop") return photoshop;
            if (name === "uxp") return { xmp: { XMPMeta } };
            if (name === "./gameui-authoring.js") return author;
            throw new Error("Unexpected dependency " + name);
        }
    });
    return { store: module.exports, photoshop, state, doc, layer, data, imageData };
}

test("PS capture stops parent traversal at Document and preserves RGBA with alpha disabled and no scaling", async () => {
    const { store, doc, layer, state, data } = host();
    const source = await store.captureLayerSource(doc, layer);
    assert.deepEqual(author.decodeSnapshot(source), data);
    assert.equal(state.disposed, 1); assert.equal(state.imagingCalls.length, 1);
    const args = state.imagingCalls[0];
    assert.equal(args.applyAlpha, false); assert.equal(args.targetSize, undefined);
    assert.equal(args.componentSize, 8); assert.equal(args.colorProfile, doc.colorProfileName);
    assert.equal(args.layerID, 10); assert.equal(args.documentID, 1);
});

test("PS opaque RGB capture adds alpha=255; trimmed empty bounds are padded transparently", async () => {
    const { store, doc, layer, imageData, state } = host();
    imageData.components = 3; imageData.width = 2; imageData.height = 1;
    imageData.getData = async () => new Uint8Array([13, 45, 87, 210, 33, 9]);
    state.pixelResult = { sourceBounds: { left: 6, top: 8, right: 8, bottom: 9 } };
    const source = await store.captureLayerSource(doc, layer);
    const out = author.decodeSnapshot(source);
    assert.deepEqual(out.subarray(28, 36), new Uint8Array([13, 45, 87, 255, 210, 33, 9, 255]));
    assert.deepEqual(out.subarray(0, 24), new Uint8Array(24));
    assert.equal(state.disposed, 1);
});

test("PS rejects non-sRGB, nonpixel, masked/styled/clipped/translucent and fractional sources before reading pixels", async () => {
    for (const change of [
        env => env.doc.colorProfileName = "Adobe RGB (1998)", env => env.doc.bitsPerChannel = 16,
        env => env.layer.kind = "smartObject", env => env.layer.isBackgroundLayer = true,
        env => env.layer.opacity = 99, env => env.layer.isClippingMask = true,
        env => env.layer.boundsNoEffects.left = .5, env => env.state.descriptor.hasUserMask = true,
        env => env.state.descriptor.layerEffects = {}, env => env.state.descriptor.hasVectorMask = true,
        env => env.layer.parent = { ...env.layer, id: 11, opacity: 50, parent: env.doc }
    ]) {
        const env = host(); change(env);
        await assert.rejects(env.store.captureLayerSource(env.doc, env.layer));
        assert.equal(env.state.imagingCalls.length, 0);
    }
});

test("PS rejects pyramid/non-RGBA invalid imaging results and disposes host image on failure", async () => {
    for (const change of [env => env.state.pixelResult = { level: 1 }, env => env.imageData.components = 2,
        env => env.imageData.getData = async () => { throw new Error("host buffer failed"); }]) {
        const env = host(); change(env);
        await assert.rejects(env.store.captureLayerSource(env.doc, env.layer)); assert.equal(env.state.disposed, 1);
    }
});

test("applying preview replaces same layer from immutable source without recapturing its stretched pixels", async () => {
    const { metadata, source, ref } = fixture();
    const before = JSON.stringify(metadata), env = host();
    await env.store.applyLayerPreview(env.doc, env.layer, source, metadata.assets[ref], 18, 15);
    assert.equal(JSON.stringify(metadata), before); assert.equal(env.state.imagingCalls.length, 0);
    const write = env.state.writes[0];
    assert.equal(write.layerID, 10); assert.equal(write.replace, true);
    assert.equal(write.targetBounds.left, 5); assert.equal(write.targetBounds.top, 7);
    assert.equal(write.imageData.options.width, 18); assert.equal(write.imageData.options.height, 15);
    assert.deepEqual(write.imageData.raw, author.preview(source, border, 18, 15, { filterMode: "Point" }));
    assert.equal(env.state.disposed, 1);
});

test("XMP write immediately reads back exact authoring sources and stable identities", async () => {
    const { metadata } = fixture(); const env = host();
    await env.store.writeMetadata(1, metadata);
    assert.equal(JSON.stringify((await env.store.readMetadata(1)).metadata), JSON.stringify(metadata));
    const original = env.photoshop.action.batchPlay;
    env.photoshop.action.batchPlay = async commands => {
        const result = await original(commands);
        if (commands[0]._obj === "set") env.state.stored = "{}";
        return result;
    };
    await assert.rejects(env.store.writeMetadata(1, metadata), /readback differs/);
});

test("panel staging contains standalone runtime and refuses destructive overwrite", () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "gameui-panel-test-"));
    try {
        const target = path.join(temporary, "plugin");
        const script = path.join(__dirname, "Panel/build-panel.cjs");
        const result = cp.spawnSync(process.execPath, [script, target], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        const manifest = JSON.parse(fs.readFileSync(path.join(target, "manifest.json")));
        assert.equal(manifest.host.data.apiVersion, 2);
        assert.equal(manifest.id, "com.bettagames.gameui.authoring.test");
        for (const file of ["gameui-core.js", "gameui-ps.js", "gameui-authoring.js"]) assert.equal(fs.readFileSync(path.join(target, file), "utf8"), fs.readFileSync(path.join(__dirname, file), "utf8"));
        assert.equal(cp.spawnSync(process.execPath, [script, target]).status, 1);
        assert.equal(cp.spawnSync(process.execPath, [script, path.join(__dirname, "Panel")]).status, 1);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("explicit transparent source canvas keeps 64x48 dimensions around 60x44 content without guessing", async () => {
    const env = host();
    env.layer.boundsNoEffects = { left: 20, top: 30, right: 80, bottom: 74 };
    env.imageData.width = 60; env.imageData.height = 44;
    const content = pixels(60, 44);
    env.imageData.getData = async () => content;
    const source = await env.store.captureLayerSource(env.doc, env.layer, { left: 2, top: 2, right: 2, bottom: 2 });
    assert.equal(source.width, 64); assert.equal(source.height, 48);
    const data = independentDecode(source);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
        const actual = data.subarray((y * 64 + x) * 4, (y * 64 + x + 1) * 4);
        assert.deepEqual(actual, x < 2 || x >= 62 || y < 2 || y >= 46 ? new Uint8Array(4) : content.subarray(((y - 2) * 60 + x - 2) * 4, ((y - 2) * 60 + x - 1) * 4));
    }
    const args = env.state.imagingCalls[0].sourceBounds;
    assert.equal(args.left, 18); assert.equal(args.right, 82); assert.equal(args.top, 28); assert.equal(args.bottom, 76);
    await assert.rejects(env.store.captureLayerSource(env.doc, env.layer, { left: -1, top: 0, right: 0, bottom: 0 }), /padding/);
    const noPadding = await env.store.captureLayerSource(env.doc, env.layer);
    assert.equal(noPadding.width, 60); assert.equal(noPadding.height, 44);
});

async function panelHarness(catalogText, initialMetadata, startup = {}) {
    class Element {
        constructor(tag) { this.tag = tag; this.children = []; this.value = ""; this.listeners = {}; this.style = {}; this._text = ""; }
        set textContent(value) { this._text = value; for (const child of this.children) child.parentNode = null; this.children = []; if (this.tag === "select") this.value = ""; }
        get textContent() { return this._text; }
        appendChild(child) {
            if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(item => item !== child);
            child.parentNode = this; this.children.push(child);
            if (this.tag === "select" && this.children.length === 1) this.value = child.value;
        }
        setAttribute(name, value) { this[name] = value; }
        getAttribute(name) { return this[name] === undefined ? null : this[name]; }
        addEventListener(name, callback) { this.listeners[name] = callback; }
    }
    const html = fs.readFileSync(path.join(__dirname, "Panel/index.html"), "utf8");
    const elements = {};
    for (const match of html.matchAll(/<(\w+)[^>]*id="([^"]+)"[^>]*>/g)) {
        const element = elements[match[2]] = new Element(match[1]);
        const value = match[0].match(/value="([^"]*)"/); if (value) element.value = value[1];
    }
    elements.sampling.value = "Bilinear";
    assert.match(html, /option value="Point"/); assert.match(html, /option value="Bilinear"/);
    const env = host(); env.doc.name = "IsolatedPanelTest.psd"; env.photoshop.app.documents = [env.doc];
    env.state.documentsXmp = {};
    env.state.history = [];
    env.layer.pixelData = env.data.slice();
    env.photoshop.core = { async executeAsModal(action) {
        let before;
        return action({ hostControl: {
            async suspendHistory({ documentID, name }) {
                const doc = env.photoshop.app.documents.find(value => value.id === documentID);
                before = { doc, stored: env.state.stored, documentsXmp: { ...env.state.documentsXmp },
                    layers: doc.layers.map(layer => ({ layer, bounds: { ...layer.boundsNoEffects }, pixelData: layer.pixelData && layer.pixelData.slice() })) };
                env.state.history.push({ name, documentID, committed: null }); return env.state.history.length;
            },
            async resumeHistory(id, commit = true) {
                env.state.history[id - 1].committed = commit;
                if (!commit) {
                    env.state.stored = before.stored; env.state.documentsXmp = before.documentsXmp;
                    before.doc.layers = before.layers.map(value => value.layer);
                    for (const value of before.layers) { value.layer.boundsNoEffects = value.bounds; value.layer.pixelData = value.pixelData; }
                }
            }
        } });
    } };
    if (initialMetadata) await env.store.writeMetadata(1, initialMetadata);
    env.layer.duplicate = async () => {
        const layer = { ...env.layer, id: 20, name: "controlled-copy" }; env.doc.layers.push(layer); return layer;
    };
    const originalBatch = env.photoshop.action.batchPlay;
    env.photoshop.action.batchPlay = async commands => {
        const command = commands[0];
        const docTarget = command._target.find(value => value._ref === "document");
        if (command._obj === "set" && env.state.failXmpWrite) throw new Error("injected XMP write failure");
        if (command._target[0]._property === "XMPMetadataAsUTF8" && docTarget && docTarget._id !== env.doc.id) {
            if (command._obj === "set") { env.state.documentsXmp[docTarget._id] = command.to.XMPMetadataAsUTF8; return [{}]; }
            return [{ XMPMetadataAsUTF8: env.state.documentsXmp[docTarget._id] || "" }];
        }
        if (command._obj === "select") {
            env.doc.activeLayers = [env.doc.layers.find(layer => layer.id === command._target[0]._id)]; return [{}];
        }
        return originalBatch(commands);
    };
    let notification;
    env.photoshop.action.addNotificationListener = async (events, callback) => {
        env.state.notificationEvents = Array.from(events); notification = callback;
    };
    env.photoshop.action.removeNotificationListener = async (events, callback) => {
        assert.equal(callback, notification); assert.deepEqual(Array.from(events), env.state.notificationEvents);
        env.state.notificationRemoveCalls = (env.state.notificationRemoveCalls || 0) + 1; notification = null;
    };
    const file = { name: "gameui-resource-catalog.json", text: catalogText,
        async write(value) { this.text = value; }, async read() { return this.text; } };
    const folder = { async getEntries() { return file.text === undefined ? [] : [file]; }, async createFile() { return file; } };
    let releaseCatalog;
    const catalogReady = startup.deferCatalog ? new Promise(resolve => { releaseCatalog = resolve; }) : Promise.resolve();
    const entrypoints = {};
    if (startup.noDocument) { env.photoshop.app.activeDocument = null; env.photoshop.app.documents = []; }
    const uxp = { entrypoints: { setup(value) {
        if (startup.omitPluginCreate) delete value.plugin.create;
        if (value.plugin && typeof value.plugin === "object" && typeof value.plugin.create !== "function") {
            throw new Error("create method is not defined for plugin.");
        }
        entrypoints.value = value;
        if (value.plugin) { value.plugin.create(); env.state.pluginCreateCalls = (env.state.pluginCreateCalls || 0) + 1; }
        if (startup.showDuringSetup) value.panels.gameuiAuthoring.show();
    } }, storage: { localFileSystem: { async getDataFolder() { await catalogReady; return folder; },
        async getFileForOpening() { return { async read() { return JSON.stringify(startup.importDirectory || author.directory(fixture().metadata)); } }; } } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "Panel/panel.js"), "utf8"), {
        document: { getElementById(id) { assert.ok(elements[id], id); return elements[id]; }, createElement(tag) { return new Element(tag); },
            querySelectorAll(tag) {
                const all = Object.values(elements);
                const seen = new Set(all);
                for (let i = 0; i < all.length; i++) for (const child of all[i].children) {
                    if (!seen.has(child)) { seen.add(child); all.push(child); }
                }
                return all.filter(element => element.tag === tag);
            } },
        console, require(name) {
            if (name === "photoshop") return env.photoshop; if (name === "uxp") return uxp;
            if (name === "./gameui-ps.js") return env.store; if (name === "./gameui-authoring.js") return author;
            if (name === "./lanhu-host.js") return startup.lanhuHost ? { createLanhuHost: startup.lanhuHost } : require("./Panel/lanhu-host.js");
            if (name === "./gameui-core.js") return core; throw new Error(name);
        }
    });
    await new Promise(resolve => setImmediate(resolve));
    return { ...env, elements, file, releaseCatalog, entrypoints,
        async notify(name = "select") { if (notification) await notification(name, {}); },
        async click(id) { await elements[id].listeners.click(); },
        chosenResource() { return elements.resources.children.find(row => row.getAttribute("aria-pressed") === "true")?.getAttribute("data-resource-ref"); },
        chooseResource(ref) {
            const row = elements.resources.children.find(row => row.getAttribute("data-resource-ref") === ref);
            assert.ok(row, "Resource row must exist: " + ref); row.listeners.click();
        },
        async metadata() { return clone((await env.store.readMetadata(env.doc.id)).metadata); } };
}

test("panel actions initialize, define, apply and controlled copy without requiring a source sample layer", async () => {
    const env = await panelHarness();
    await env.click("initialize");
    assert.match(env.elements.status.textContent, /待处理/);
    const initialized = await env.metadata();
    assert.equal(initialized.uploadScope.projectId, "cfea1199-7c07-48d9-86ef-cdbd3385c237");
    env.elements.displayName.value = options.displayName; env.elements.sampling.value = "Point";
    for (const side of ["left", "top", "right", "bottom"]) env.elements[side].value = String(border[side]);
    await env.click("createResource");
    const value = await env.metadata();
    assert.ok(value.nodes[10], env.elements.status.textContent);
    const ref = value.nodes[10].assetRef;
    const source = clone(value.authoring.sources[ref]);
    assert.equal(value.assets[ref].version, 1);
    assert.notEqual(value.assets[ref].assetKey, options.assetKey);
    assert.equal(env.doc.layers.length, 1);
    assert.equal(value.nodes[10].kind, "image");
    env.elements.targetWidth.value = "18"; env.elements.targetHeight.value = "15";
    await env.click("apply");
    const stretched = await env.metadata();
    assert.equal(stretched.nodes[10].nodeId, value.nodes[10].nodeId);
    assert.deepEqual(stretched.authoring.sources[ref], source);
    assert.equal(env.state.writes[0].layerID, 10);
    await env.click("copy");
    const copied = await env.metadata();
    assert.ok(copied.nodes[20], env.elements.status.textContent);
    assert.notEqual(copied.nodes[20].nodeId, value.nodes[10].nodeId);
    assert.equal(copied.nodes[20].assetRef, ref);
    assert.deepEqual(copied.authoring.sources[ref], source);
    assert.equal(env.doc.layers.length, 2);
    assert.equal(Object.values(copied.nodes).some(marker => marker.kind === "resourceSource"), false);
    assert.deepEqual(JSON.parse(env.file.text).authoring.sources[ref], source);
});

test("corrupt automatic catalog blocks writes until explicit valid directory import", async () => {
    const env = await panelHarness("{broken");
    await env.click("initialize");
    assert.match(env.elements.status.textContent, /阻止覆盖/);
    assert.equal(env.file.text, "{broken"); assert.equal(await env.metadata(), null);
    await env.click("import");
    assert.ok(JSON.parse(env.file.text).assets["ui.button.primary@1"]);
    // Import recovers the catalog, while the unopened/uninitialized PSD still requires explicit init.
    await env.click("initialize");
    assert.equal((await env.metadata()).schemaVersion, 1);
});

test("invalid PSD identities do not lock a valid local catalog and selected identity can be repaired", async () => {
    const { metadata } = fixture(); metadata.nodes[20] = clone(metadata.nodes[10]);
    const env = await panelHarness(undefined, metadata);
    assert.match(env.elements.status.textContent, /身份缺失或重复/);
    assert.match(env.elements.errorDetails.textContent, /Duplicate/);
    await env.click("repairIdentity");
    const repaired = await env.metadata();
    assert.notEqual(repaired.nodes[10].nodeId, repaired.nodes[20].nodeId);
    assert.equal(repaired.nodes[10].assetRef, repaired.nodes[20].assetRef);
    assert.equal(repaired.nodes[10].nativeImageUsage, "validationReference");
});

function transparentSource() {
    const data = new Uint8Array(64 * 48 * 4);
    for (let y = 2; y < 46; y++) for (let x = 2; x < 62; x++) data.set([23, 121, 231, 255], (y * 64 + x) * 4);
    const source = author.snapshot(data, 64, 48);
    const opts = { ...options, nineSlice: { left: 8, top: 8, right: 8, bottom: 8, unit: "sourcePixel", center: "stretch" } };
    return { source, metadata: author.define(author.createMetadata(), 10, opts, source) };
}

test("target canvas is derived from nonzero alpha and copied/rekeyed with instance identity", () => {
    const { metadata } = transparentSource(), id = metadata.nodes[10].nodeId;
    assert.deepEqual(metadata.authoring.targets[id], { width: 64, height: 48, insetLeft: 2, insetTop: 2, contentWidth: 60, contentHeight: 44 });
    const copied = author.copyNode(metadata, 10, 20);
    assert.deepEqual(copied.authoring.targets[copied.nodes[20].nodeId], metadata.authoring.targets[id]);
    const fork = author.forkDocument(copied, [10, 20]);
    for (const marker of Object.values(fork.nodes)) assert.ok(fork.authoring.targets[marker.nodeId]);
    assert.equal(fork.authoring.targets[id], undefined);
    assert.equal(author.directory(metadata).authoring.targets, undefined);
    const referenced = author.reference(metadata, 20, options.assetKey + "@1", false,
        { width: 92, height: 124, insetLeft: 0, insetTop: 0, contentWidth: 92, contentHeight: 124 });
    assert.equal(referenced.authoring.targets[referenced.nodes[20].nodeId].width, 92);
});

test("invalid, fractional, empty and orphan target canvas records fail while legacy metadata remains valid", () => {
    const { metadata } = transparentSource(), id = metadata.nodes[10].nodeId;
    for (const change of [target => target.width = 0, target => target.insetLeft = .5, target => target.insetTop = -1,
        target => target.contentHeight = 0, target => target.contentWidth = 64]) {
        const value = clone(metadata); change(value.authoring.targets[id]); assert.throws(() => author.validateMetadata(value));
    }
    const orphan = clone(metadata); orphan.authoring.targets.orphan = clone(orphan.authoring.targets[id]);
    assert.throws(() => author.validateMetadata(orphan), /matching nodeId/);
    const resourceSource = clone(metadata); resourceSource.nodes[10].kind = "resourceSource";
    assert.throws(() => author.validateMetadata(resourceSource), /requires an image node/);
    const legacy = clone(metadata); delete legacy.authoring.targets; assert.doesNotThrow(() => author.validateMetadata(legacy));
    assert.throws(() => author.targetFromPixels(new Uint8Array(4 * 3 * 4), 4, 3), /integer|empty/);
});

test("128x80 target preserves full canvas around native124x76 content and stable origin after moves/reapply", async () => {
    const { source, metadata } = transparentSource();
    const env = host();
    env.layer.boundsNoEffects = { left: 314, top: 34, right: 374, bottom: 78 };
    const id = metadata.nodes[10].nodeId, asset = metadata.assets[options.assetKey + "@1"];
    const first = await env.store.applyLayerPreview(env.doc, env.layer, source, asset, 128, 80, metadata.authoring.targets[id]);
    assert.deepEqual(first, { width: 128, height: 80, insetLeft: 2, insetTop: 2, contentWidth: 124, contentHeight: 76 });
    assert.equal(env.state.writes[0].targetBounds.left, 312); assert.equal(env.state.writes[0].targetBounds.top, 32);
    const updated = author.withTarget(metadata, 10, first);
    assert.equal(updated.authoring.targets[id].width, 128);
    assert.equal(env.layer.boundsNoEffects.right - env.layer.boundsNoEffects.left, 124);
    assert.equal(env.layer.boundsNoEffects.bottom - env.layer.boundsNoEffects.top, 76);
    env.layer.boundsNoEffects.left += 17; env.layer.boundsNoEffects.right += 17;
    env.layer.boundsNoEffects.top += 21; env.layer.boundsNoEffects.bottom += 21;
    await env.store.applyLayerPreview(env.doc, env.layer, source, asset, 128, 80, first);
    assert.equal(env.state.writes[1].targetBounds.left, 329); assert.equal(env.state.writes[1].targetBounds.top, 53);
    env.layer.boundsNoEffects.right++;
    assert.throws(() => env.store.assertTargetLayer(env.layer, first), /Reapply/);
    const repaired = await env.store.applyLayerPreview(env.doc, env.layer, source, asset, 128, 80, first);
    assert.equal(repaired.contentWidth, 124); assert.equal(env.state.writes.length, 3);
});

test("unexpected host content bounds after applying pixels are rejected", async () => {
    const { source, metadata } = transparentSource(), env = host();
    const original = env.photoshop.imaging.putPixels;
    env.photoshop.imaging.putPixels = async args => { await original(args); env.layer.boundsNoEffects.right++; };
    await assert.rejects(env.store.applyLayerPreview(env.doc, env.layer, source, metadata.assets[options.assetKey + "@1"], 128, 80), /Reapply/);
    assert.equal(env.state.disposed, 1);
});

test("malformed GameUI XMP JSON has a typed error without exposing property contents; unmarked PSD stays null", async () => {
    const env = host();
    assert.equal((await env.store.readMetadata(1)).metadata, null);
    for (const broken of ["", "private-garbage-marker"]) {
        env.state.stored = JSON.stringify({ metadata: broken });
        await assert.rejects(env.store.readMetadata(1), error => {
            assert.equal(error.code, "GAMEUI_METADATA_INVALID"); assert.ok(error.cause);
            assert.equal(error.message.includes("private-garbage-marker"), false);
            assert.equal(JSON.stringify(error).includes("private-garbage-marker"), false);
            return true;
        });
    }
});

test("resource creation assigns internal identity and publishing chooses the catalog maximum version plus one", () => {
    const { source } = fixture();
    const settings = { displayName: "美术只需填写名称", nineSlice: border, filterMode: "Point" };
    const empty = author.createMetadata();
    const firstOptions = author.resourceOptions(empty, null, "create", settings);
    assert.equal(firstOptions.version, 1); assert.match(firstOptions.assetKey, /^g-/);
    let catalog = author.define(empty, 10, firstOptions, source);
    const ref = catalog.nodes[10].assetRef;
    catalog = author.define(catalog, 20, { ...firstOptions, version: 3 }, source);
    const publishOptions = author.resourceOptions(catalog, ref, "publish", { ...settings, filterMode: "Bilinear" });
    assert.equal(publishOptions.assetKey, firstOptions.assetKey); assert.equal(publishOptions.version, 4);
    const updated = author.define(catalog, 10, publishOptions, source);
    assert.equal(updated.nodes[10].assetRef, firstOptions.assetKey + "@4");
    assert.equal(updated.assets[ref].sampling.filterMode, "Point");
});

test("panel directory import stays private and referencing adds only the selected version to PSD", async () => {
    const { metadata, source, ref } = fixture();
    const library = author.directory(author.define(metadata, 20, { ...options, version: 2 }, source));
    const env = await panelHarness(JSON.stringify(library));
    await env.click("initialize");
    assert.deepEqual((await env.metadata()).assets, {});
    env.chooseResource(ref);
    await env.click("reference");
    const value = await env.metadata();
    assert.deepEqual(Object.keys(value.assets), [ref]);
    assert.deepEqual(Object.keys(value.authoring.sources), [ref]);
    assert.deepEqual(value.authoring.targets[value.nodes[10].nodeId], { width: 6, height: 5, insetLeft: 0, insetTop: 0, contentWidth: 6, contentHeight: 5 });
    const imported = await panelHarness();
    await imported.click("initialize"); await imported.click("import");
    assert.deepEqual((await imported.metadata()).assets, {});
    assert.ok(JSON.parse(imported.file.text).assets[ref]);
});

test("panel name update keeps identity/source and publishing assigns the next version without artist ID input", async () => {
    const env = await panelHarness();
    assert.equal(env.elements.assetKey, undefined); assert.equal(env.elements.version, undefined);
    await env.click("initialize"); env.elements.displayName.value = "按钮";
    await env.click("createResource");
    const initial = await env.metadata(), ref = initial.nodes[10].assetRef;
    const calls = env.state.imagingCalls.length;
    env.elements.displayName.value = "更新名称"; await env.click("define");
    const renamed = await env.metadata();
    assert.equal(renamed.assets[ref].displayName, "更新名称");
    assert.equal(renamed.nodes[10].nodeId, initial.nodes[10].nodeId);
    assert.deepEqual(renamed.authoring.sources[ref], initial.authoring.sources[ref]);
    assert.equal(env.state.imagingCalls.length, calls);
    env.elements.left.value = "1";
    await env.click("publishVersion");
    const published = await env.metadata();
    assert.equal(published.nodes[10].nodeId, initial.nodes[10].nodeId);
    assert.equal(published.nodes[10].assetRef, initial.assets[ref].assetKey + "@2");
    assert.equal(published.assets[ref].version, 1); assert.equal(published.assets[published.nodes[10].assetRef].version, 2);
});

test("panel startup show before delayed catalog load clears loading status and refreshes a subsequently opened PSD", async () => {
    const env = await panelHarness(undefined, undefined, { deferCatalog: true, showDuringSetup: true, noDocument: true });
    assert.match(env.elements.status.textContent, /正在加载/);
    assert.doesNotMatch(env.elements.status.textContent, /不可读|备份目录/);
    await env.click("initialize");
    assert.match(env.elements.status.textContent, /正在加载/);
    env.releaseCatalog();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.elements.selection.textContent, "请打开 PSD");
    assert.match(env.elements.status.textContent, /请先打开 PSD/);
    assert.doesNotMatch(env.elements.status.textContent, /不可读|加载/);
    env.photoshop.app.activeDocument = env.doc; env.photoshop.app.documents = [env.doc];
    await env.click("refresh");
    assert.match(env.elements.selection.textContent, /IsolatedPanelTest/);
    assert.match(env.elements.status.textContent, /未初始化/);
    await env.click("initialize");
    assert.equal((await env.metadata()).schemaVersion, 1);
});

test("panel rejects a trimmed duplicate display name before new resource creation without writing PSD or catalog", async () => {
    const { metadata, ref } = fixture();
    const env = await panelHarness(JSON.stringify(author.directory(metadata)));
    await env.click("initialize");
    const beforeMetadata = await env.metadata(), beforeFile = env.file.text, beforeStored = env.state.stored;
    const beforeCapture = env.state.imagingCalls.length;
    env.elements.displayName.value = "  " + options.displayName + "  ";
    await env.click("createResource");
    assert.equal(env.elements.status.textContent, "已有同名公共资源，请从选择器引用；独立资源请用不同名称");
    assert.deepEqual(await env.metadata(), beforeMetadata);
    assert.equal(env.state.stored, beforeStored); assert.equal(env.file.text, beforeFile);
    assert.equal(env.state.imagingCalls.length, beforeCapture);
    assert.deepEqual(Object.keys(JSON.parse(env.file.text).assets), [ref]);
    env.elements.displayName.value = "独立资源使用不同名称";
    await env.click("createResource");
    const created = await env.metadata();
    assert.notEqual(created.nodes[10].assetRef, ref);
    assert.equal(Object.keys(JSON.parse(env.file.text).assets).length, 2);
    assert.ok(JSON.parse(env.file.text).assets[ref]);
});

test("panel distinguishes existing and imported same-name same-version options while preserving exact reference values", async () => {
    const { metadata, source, ref } = fixture();
    const secondRef = "ui.independent@1", uniqueRef = "ui.unique@1";
    let library = author.define(metadata, 20, { ...options, assetKey: "ui.independent" }, source);
    library = author.directory(author.define(library, 30, { ...options, assetKey: "ui.unique", displayName: "唯一名称" }, source));
    library.assets[secondRef].displayName = "  " + options.displayName + "  ";
    for (const imported of [false, true]) {
        const env = imported ? await panelHarness(undefined, undefined, { importDirectory: library }) : await panelHarness(JSON.stringify(library));
        if (imported) await env.click("import");
        const items = env.elements.resources.children.filter(item => item.getAttribute("data-resource-ref"));
        assert.equal(items.length, 3);
        const first = items.find(item => item.getAttribute("data-resource-ref") === ref), second = items.find(item => item.getAttribute("data-resource-ref") === secondRef);
        assert.notEqual(first.textContent, second.textContent);
        assert.match(first.textContent, /条目 [1-3]$/); assert.match(second.textContent, /条目 [1-3]$/);
        assert.equal(items.find(item => item.getAttribute("data-resource-ref") === uniqueRef).textContent, "唯一名称 · v1");
        assert.deepEqual(items.map(item => item.getAttribute("data-resource-ref")).sort(), [ref, secondRef, uniqueRef].sort());
        await env.click("initialize");
        env.chooseResource(secondRef);
        assert.ok(env.elements.resourceInfo.textContent.replace(/\n/g, "").includes(secondRef));
        await env.click("reference");
        const value = await env.metadata();
        assert.equal(value.nodes[10].assetRef, secondRef);
        assert.deepEqual(Object.keys(value.assets), [secondRef]);
        assert.equal(Object.keys(JSON.parse(env.file.text).assets).length, 3);
    }
});

function primarySource64(env) {
    const raw = pixels(64, 48);
    env.layer.boundsNoEffects = { left: 32, top: 40, right: 96, bottom: 88 };
    env.layer.pixelData = raw.slice();
    env.imageData.width = 64; env.imageData.height = 48; env.imageData.getData = async () => raw;
    env.elements.displayName.value = "一键公共按钮";
    env.elements.sampling.value = "Point";
    for (const [side, value] of Object.entries({ left: 7, top: 5, right: 11, bottom: 9 })) env.elements[side].value = String(value);
    return raw;
}

test("primary action initializes and creates from source64 before applying the complete target in one history step", async () => {
    const env = await panelHarness();
    const raw = primarySource64(env);
    env.elements.targetWidth.value = "128"; env.elements.targetHeight.value = "80";
    assert.equal(env.chosenResource(), "");
    await env.click("primaryAction");
    const value = await env.metadata();
    assert.ok(value && value.nodes[10], env.elements.status.textContent);
    const marker = value.nodes[10], source = value.authoring.sources[marker.assetRef];
    assert.equal(source.width, 64); assert.equal(source.height, 48);
    assert.deepEqual(author.decodeSnapshot(source), raw);
    assert.equal(value.authoring.targets[marker.nodeId].width, 128); assert.equal(value.authoring.targets[marker.nodeId].height, 80);
    assert.equal(env.layer.boundsNoEffects.right - env.layer.boundsNoEffects.left, 128);
    assert.equal(env.state.history.length, 1); assert.equal(env.state.history[0].committed, true);
    assert.equal(env.chosenResource(), marker.assetRef);
    assert.equal(env.elements.newResourceSettings.style.display, "none");
    assert.match(env.elements.inheritedContract.textContent, /7\/5\/11\/9/);
    assert.match(env.elements.status.textContent, /Cmd\+S/);
    await env.click("primaryAction");
    const reapplied = await env.metadata();
    assert.equal(reapplied.nodes[10].nodeId, marker.nodeId);
    assert.equal(reapplied.nodes[10].assetRef, marker.assetRef);
    assert.equal(env.state.imagingCalls.length, 1, "Bound reapplication must reuse source, not capture the stretched effect.");
});

test("primary action references an explicitly chosen resource in a second unmarked PSD with independent identities", async () => {
    const env = await panelHarness(); primarySource64(env);
    env.elements.targetWidth.value = "128"; env.elements.targetHeight.value = "80";
    await env.click("primaryAction");
    const first = await env.metadata(), ref = first.nodes[10].assetRef;
    const second = { ...env.doc, id: 2, name: "Second.psd" };
    const layer = { ...env.layer, parent: second, boundsNoEffects: { left: 50, top: 60, right: 114, bottom: 108 } };
    second.layers = [layer]; second.activeLayers = [layer];
    env.photoshop.app.documents.push(second); env.photoshop.app.activeDocument = second;
    await env.notify("open");
    assert.equal(env.chosenResource(), ref, "An already explicit resource choice may carry to the next unbound instance.");
    assert.equal(env.elements.targetWidth.value, "64"); assert.equal(env.elements.targetHeight.value, "48");
    assert.match(env.elements.targetHint.textContent, /非空边界/);
    env.elements.targetWidth.value = "192"; env.elements.targetHeight.value = "96";
    env.elements.left.value = "0"; env.elements.sampling.value = "Bilinear";
    await env.click("primaryAction");
    const value = (await env.store.readMetadata(2)).metadata;
    assert.ok(value, env.elements.status.textContent);
    assert.equal(value.nodes[10].assetRef, ref);
    assert.notEqual(value.nodes[10].nodeId, first.nodes[10].nodeId);
    assert.notEqual(value.documentId, first.documentId); assert.notEqual(value.artboardId, first.artboardId);
    assert.equal(value.assets[ref].nineSlice.left, 7); assert.equal(value.assets[ref].sampling.filterMode, "Point");
    assert.equal(value.authoring.targets[value.nodes[10].nodeId].width, 192);
    assert.equal(value.authoring.targets[value.nodes[10].nodeId].height, 96);
    assert.deepEqual(author.decodeSnapshot(value.authoring.sources[ref]), author.decodeSnapshot(first.authoring.sources[ref]));
    assert.equal(env.state.imagingCalls.length, 1);
    assert.equal(env.state.history.length, 2); assert.ok(env.state.history.every(item => item.committed));
});

test("primary action failure rolls back pixels and XMP in one history step and preserves a legal unused catalog snapshot", async () => {
    const env = await panelHarness(), raw = primarySource64(env);
    const bounds = { ...env.layer.boundsNoEffects };
    env.elements.targetWidth.value = "128"; env.elements.targetHeight.value = "80";
    env.state.failXmpWrite = true;
    await env.click("primaryAction");
    assert.match(env.elements.status.textContent, /操作未完成/);
    assert.doesNotMatch(env.elements.status.textContent, /injected XMP write failure/);
    assert.match(env.elements.errorDetails.textContent, /injected XMP write failure/);
    assert.match(env.elements.status.textContent, /显式引用恢复/);
    assert.equal(await env.metadata(), null);
    assert.deepEqual(env.layer.boundsNoEffects, bounds); assert.deepEqual(env.layer.pixelData, raw);
    assert.equal(env.state.history.length, 1); assert.equal(env.state.history[0].committed, false);
    const catalog = JSON.parse(env.file.text);
    assert.equal(Object.keys(catalog.assets).length, 1); assert.equal(Object.keys(catalog.nodes).length, 0);
    assert.equal(catalog.authoring.targets, undefined); assert.doesNotThrow(() => author.validateMetadata(catalog));
});

test("primary action rejects same-name creation and unsafe existing metadata without overwriting or guessing a first resource", async () => {
    const { metadata } = fixture();
    const env = await panelHarness(JSON.stringify(author.directory(metadata)));
    assert.equal(env.chosenResource(), "");
    env.elements.displayName.value = "  " + options.displayName + "  ";
    const before = env.file.text;
    await env.click("primaryAction");
    assert.match(env.elements.status.textContent, /已有同名公共资源/);
    assert.equal(await env.metadata(), null); assert.equal(env.file.text, before); assert.equal(env.state.imagingCalls.length, 0);
    for (const unsafe of ["bad-json", null, { ...metadata, schemaVersion: 2 }, { ...metadata, requiredCapabilities: ["future.required"] }]) {
        env.state.stored = JSON.stringify({ metadata: typeof unsafe === "string" ? unsafe : JSON.stringify(unsafe) });
        const stored = env.state.stored;
        await env.click("primaryAction");
        assert.equal(env.state.stored, stored); assert.equal(env.file.text, before);
        assert.equal(env.state.imagingCalls.length, 0);
    }
    env.state.stored = null;
    const another = { ...env.doc, id: 2, name: "Copied.psd", layers: [], activeLayers: [] };
    env.photoshop.app.documents.push(another);
    env.state.stored = JSON.stringify({ metadata: JSON.stringify(metadata) });
    env.state.documentsXmp[2] = env.state.stored;
    await env.click("primaryAction");
    assert.match(env.elements.status.textContent, /身份冲突/);
    assert.equal(env.file.text, before); assert.equal(env.state.imagingCalls.length, 0);
});

test("selection notifications refresh only document or layer identity and preserve same-selection form edits", async () => {
    const env = await panelHarness();
    assert.deepEqual(env.state.notificationEvents, ["select", "open", "close"]);
    env.elements.displayName.value = "正在输入的名字";
    env.elements.left.value = "3"; env.elements.targetWidth.value = "123";
    await env.notify("select"); await env.notify("open");
    assert.equal(env.elements.displayName.value, "正在输入的名字");
    assert.equal(env.elements.left.value, "3"); assert.equal(env.elements.targetWidth.value, "123");
    const layer = { ...env.layer, id: 20, name: "new-layer", boundsNoEffects: { left: 1, top: 2, right: 25, bottom: 18 } };
    env.doc.layers.push(layer); env.doc.activeLayers = [layer];
    await env.notify("select");
    assert.match(env.elements.selection.textContent, /new-layer/);
    assert.equal(env.elements.targetWidth.value, "24"); assert.equal(env.elements.targetHeight.value, "16");
    assert.equal(env.chosenResource(), "");
    await env.click("toggleAdvanced");
    assert.equal(env.elements.advancedPanel.style.display, "block");
    await env.click("toggleAdvanced"); assert.equal(env.elements.advancedPanel.style.display, "none");
    await env.entrypoints.value.plugin.destroy();
    env.doc.activeLayers = [env.layer]; await env.notify("select");
    assert.match(env.elements.selection.textContent, /new-layer/, "Destroy must remove the notification callback.");
    const invalid = fixture().metadata; invalid.schemaVersion = 2;
    const initiallyInvalid = await panelHarness(undefined, invalid);
    assert.deepEqual(initiallyInvalid.state.notificationEvents, ["select", "open", "close"]);
    initiallyInvalid.photoshop.app.activeDocument = null; initiallyInvalid.photoshop.app.documents = [];
    await initiallyInvalid.notify("close");
    assert.equal(initiallyInvalid.elements.selection.textContent, "请打开 PSD");
});

test("selection notifications skip while the primary action is busy and bound layers restore their own resource and target", async () => {
    const env = await panelHarness(); primarySource64(env);
    env.elements.targetWidth.value = "128"; env.elements.targetHeight.value = "80";
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const original = env.photoshop.imaging.getPixels;
    env.photoshop.imaging.getPixels = async value => { await gate; return original(value); };
    const action = env.click("primaryAction");
    await new Promise(resolve => setImmediate(resolve));
    const other = { ...env.layer, id: 20, name: "other", boundsNoEffects: { left: 0, top: 0, right: 20, bottom: 20 } };
    env.doc.layers.push(other); env.doc.activeLayers = [other];
    await env.notify("select");
    assert.doesNotMatch(env.elements.selection.textContent, /other/);
    assert.equal(env.elements.targetWidth.value, "128");
    release(); await action;
    const value = await env.metadata(), ref = value.nodes[10].assetRef;
    assert.match(env.elements.selection.textContent, /other/);
    assert.equal(env.chosenResource(), ref);
    env.chooseResource("");
    env.doc.activeLayers = [env.layer]; await env.notify("select");
    assert.equal(env.chosenResource(), ref); assert.equal(env.elements.targetWidth.value, "128");
    assert.equal(env.elements.targetHeight.value, "80");
});

test("plugin lifecycle registration rejects missing create and starts with create plus destroy cleanup", async () => {
    await assert.rejects(panelHarness(undefined, undefined, { omitPluginCreate: true }), /create method is not defined for plugin/);
    const env = await panelHarness(undefined, undefined, { showDuringSetup: true });
    assert.equal(env.state.pluginCreateCalls, 1);
    assert.match(env.elements.selection.textContent, /IsolatedPanelTest/);
    assert.match(env.elements.status.textContent, /主按钮会自动初始化/);
    assert.deepEqual(env.state.notificationEvents, ["select", "open", "close"]);
    await env.entrypoints.value.plugin.destroy();
    assert.equal(env.state.notificationRemoveCalls, 1);
    env.photoshop.app.activeDocument = null; env.photoshop.app.documents = [];
    await env.notify("close");
    assert.match(env.elements.selection.textContent, /IsolatedPanelTest/, "Destroy must detach the selection callback.");
});

function pauseMetadataReads(env, count) {
    const original = env.store.readMetadata;
    const reads = Array.from({ length: count }, () => {
        let arrived, release;
        return { arrived: new Promise(resolve => { arrived = resolve; }),
            gate: new Promise(resolve => { release = resolve; }),
            signal: () => arrived(), release: () => release() };
    });
    let index = 0;
    env.store.readMetadata = async id => {
        const packet = await original(id), read = reads[index++];
        if (read) { read.signal(); await read.gate; }
        return packet;
    };
    return reads;
}

test("selection refresh preserves edited fields while untouched fields inherit the bound resource", async () => {
    const { metadata } = fixture();
    const value = author.copyNode(metadata, 10, 20);
    const env = await panelHarness(JSON.stringify(author.directory(value)), value);
    const other = { ...env.layer, id: 20, name: "other-bound-layer" };
    env.doc.layers.push(other); env.doc.activeLayers = [other];
    const [read] = pauseMetadataReads(env, 1);
    const pending = env.notify(); await read.arrived;
    env.elements.targetWidth.value = "123";
    env.elements.targetWidth.listeners.input?.();
    env.elements.displayName.value = "尚未发布的名称";
    env.elements.displayName.listeners.input?.();
    env.elements.left.value = "2"; env.elements.left.listeners.change?.();
    env.elements.sampling.value = "Bilinear"; env.elements.sampling.listeners.change?.();
    read.release(); await pending;
    assert.equal(env.elements.targetWidth.value, "123");
    assert.equal(env.elements.targetHeight.value, "5", "Untouched fields still receive the selected instance defaults.");
    assert.equal(env.chosenResource(), value.nodes[20].assetRef);
    assert.equal(env.elements.displayName.value, "尚未发布的名称");
    assert.equal(env.elements.left.value, "2"); assert.equal(env.elements.sampling.value, "Bilinear");
    assert.equal(env.elements.right.value, String(value.assets[value.nodes[20].assetRef].nineSlice.right));
    assert.deepEqual(await env.metadata(), value);
    assert.equal(env.file.text, JSON.stringify(author.directory(value)));
});

test("selection refresh blocks resource clicks while pending and accepts explicit new choice when idle", async () => {
    const { metadata } = fixture();
    const value = author.copyNode(metadata, 10, 20);
    const env = await panelHarness(JSON.stringify(author.directory(value)), value);
    const other = { ...env.layer, id: 20, name: "other-bound-layer" };
    env.doc.layers.push(other); env.doc.activeLayers = [other];
    const [read] = pauseMetadataReads(env, 1);
    const pending = env.notify(); await read.arrived;
    env.chooseResource("");
    assert.equal(env.chosenResource(), value.nodes[10].assetRef);
    assert.ok(env.elements.resources.children.every(row => row.disabled));
    read.release(); await pending;
    env.chooseResource("");
    env.elements.displayName.value = "新资源草稿"; env.elements.displayName.listeners.input?.();
    assert.equal(env.chosenResource(), "");
    assert.equal(env.elements.displayName.value, "新资源草稿");
    assert.equal(env.elements.newResourceSettings.style.display, "block");
    assert.deepEqual(await env.metadata(), value);
});

test("selection refresh catches consecutive changes during XMP reads without waiting for another notification", async () => {
    const env = await panelHarness();
    const layers = [20, 30, 40].map(id => ({ ...env.layer, id, name: "layer-" + id,
        boundsNoEffects: { left: 0, top: 0, right: id, bottom: id + 1 } }));
    env.doc.layers.push(...layers); env.doc.activeLayers = [layers[0]];
    const [first, second] = pauseMetadataReads(env, 2);
    const pending = env.notify(); await first.arrived;
    env.doc.activeLayers = [layers[1]]; await env.notify(); first.release();
    await second.arrived;
    env.doc.activeLayers = [layers[2]]; await env.notify(); second.release();
    await pending;
    assert.match(env.elements.selection.textContent, /layer-40/);
    assert.equal(env.elements.targetWidth.value, "40");
    assert.equal(env.elements.targetHeight.value, "41");
    assert.equal(await env.metadata(), null); assert.equal(env.file.text, undefined);
    assert.equal(env.state.history.length, 0);
});

test("selection refresh handles closing the document and ignores pending results after destroy", async () => {
    for (const destroy of [false, true]) {
        const env = await panelHarness();
        const [read] = pauseMetadataReads(env, 1);
        const pending = env.click("refresh"); await read.arrived;
        const before = env.elements.selection.textContent;
        env.photoshop.app.activeDocument = null; env.photoshop.app.documents = [];
        if (destroy) await env.entrypoints.value.plugin.destroy();
        else await env.notify("close");
        read.release(); await pending;
        assert.equal(env.elements.selection.textContent, destroy ? before : "请打开 PSD");
        assert.equal(env.state.history.length, 0);
        assert.equal(env.file.text, undefined);
    }
});

test("inline resource rows choose the exact last version without writing PSD and retain rows on unchanged refresh", async () => {
    const { metadata, source } = fixture();
    let library = metadata;
    for (let index = 0; index < 24; index++) {
        library = author.define(library, 100 + index, { ...options, assetKey: "ui.catalog-" + String(index).padStart(2, "0") }, source);
    }
    library = author.directory(library);
    const env = await panelHarness(JSON.stringify(library));
    const rows = env.elements.resources.children.slice();
    assert.equal(env.elements.resources.tag, "div", "Resource choices must use in-panel controls, not a native select popup.");
    assert.equal(rows.length, 26);
    assert.equal(rows[0].getAttribute("data-resource-ref"), "");
    assert.equal(env.chosenResource(), "");
    assert.ok(rows.every(row => row.tag === "button" && row.getAttribute("type") === "button" && !row.disabled));
    assert.match(env.elements.resourceCount.textContent, /^25 个资源版本/);
    const lastRef = rows.at(-1).getAttribute("data-resource-ref");
    env.elements.targetWidth.value = "192"; env.elements.targetHeight.value = "96";
    env.chooseResource(lastRef);
    assert.equal(env.chosenResource(), lastRef);
    assert.equal(rows.filter(row => row.getAttribute("aria-pressed") === "true").length, 1);
    assert.match(rows.at(-1).textContent, /^已选 · /);
    assert.equal(env.elements.targetWidth.value, "192"); assert.equal(env.elements.targetHeight.value, "96");
    await env.click("refresh");
    assert.ok(env.elements.resources.children.every((row, index) => row === rows[index]), "Unchanged choices retain their mounted buttons and scroll container.");
    env.chooseResource("");
    assert.equal(env.chosenResource(), ""); assert.match(rows[0].textContent, /^已选 · 新建公共资源$/);
    assert.equal(await env.metadata(), null); assert.equal(env.file.text, JSON.stringify(library));
    assert.equal(env.state.history.length, 0);
});

test("inline resource rows cannot change the chosen version while primary action is applying pixels", async () => {
    const { metadata, source, ref } = fixture();
    const library = author.directory(author.define(metadata, 20, { ...options, assetKey: "ui.other" }, source));
    const env = await panelHarness(JSON.stringify(library));
    env.chooseResource(ref);
    let release, arrived;
    const gate = new Promise(resolve => { release = resolve; });
    const applying = new Promise(resolve => { arrived = resolve; });
    const original = env.photoshop.imaging.putPixels;
    env.photoshop.imaging.putPixels = async value => { arrived(); await gate; return original(value); };
    const pending = env.click("primaryAction"); await applying;
    assert.ok(env.elements.resources.children.every(row => row.disabled));
    env.chooseResource("ui.other@1");
    assert.equal(env.chosenResource(), ref);
    release(); await pending;
    assert.equal((await env.metadata()).nodes[10].assetRef, ref);
    assert.ok(env.elements.resources.children.every(row => !row.disabled));
    env.chooseResource("ui.other@1");
    assert.equal(env.chosenResource(), "ui.other@1");
    assert.equal((await env.metadata()).nodes[10].assetRef, ref, "Choosing another row alone must not write a binding.");
});

test("tool tabs show native controls immediately, preserve inputs and share one inline workspace and upload connection", async () => {
    const state = { connected: false, uploading: false, loggedIn: false, projectId: null };
    let connections = 0, uploads = 0, destroyed = 0;
    const env = await panelHarness(undefined, undefined, { lanhuHost: ({ onStatus }) => ({
        status: () => state,
        async connect() { connections++; state.connected = true; state.loggedIn = true; state.projectId = "cfea1199-7c07-48d9-86ef-cdbd3385c237"; onStatus("connected"); },
        async upload() { uploads++; onStatus("handed to official upload"); },
        async destroy() { destroyed++; }
    }) });
    assert.equal(env.elements.authoringUploadLanhu.disabled, true, "Generic refresh completion must not enable an unconnected upload action.");
    env.elements.displayName.value = "正在创作的名称"; env.elements.targetWidth.value = "192";
    await env.click("tabLanhu");
    assert.equal(connections, 1, "Entering the tab initializes the business connection without a load-interface landing page.");
    assert.equal(env.elements.lanhuPane.style.display, "block"); assert.equal(env.elements.authoringPane.style.display, "none");
    assert.equal(env.elements.tabLanhu.getAttribute("aria-selected"), "true");
    await env.click("connectLanhu"); assert.equal(connections, 1);
    await env.click("tabAuthoring");
    assert.equal(env.elements.displayName.value, "正在创作的名称"); assert.equal(env.elements.targetWidth.value, "192");
    assert.equal(env.elements.authoringUploadLanhu.disabled, false);
    await env.click("authoringToggleLanhu");
    assert.equal(env.elements.lanhuWorkspace.parentNode, env.elements.authoringLanhuInline);
    assert.equal(connections, 1, "Moving the same mount must not create another login/session instance.");
    await env.click("authoringUploadLanhu"); assert.equal(uploads, 1);
    assert.equal(env.elements.lanhuWorkspace.parentNode, env.elements.authoringLanhuInline);
    await env.click("tabLanhu");
    assert.equal(env.elements.lanhuWorkspace.parentNode, env.elements.lanhuFullMount);
    await env.click("tabAuthoring");
    assert.equal(env.elements.lanhuWorkspace.parentNode, env.elements.authoringLanhuInline);
    assert.equal(await env.metadata(), null); assert.equal(env.file.text, undefined); assert.equal(env.state.history.length, 0);
    await env.entrypoints.value.plugin.destroy(); assert.equal(destroyed, 1);
});

test("official upload progress blocks authoring writes and a failed Lanhu connection leaves upload disabled", async () => {
    const state = { connected: true, uploading: true, loggedIn: true, projectId: "test" };
    const env = await panelHarness(undefined, undefined, { lanhuHost: () => ({ status: () => state,
        async connect() { throw new Error("controlled connection failure"); }, async destroy() {} }) });
    await env.click("primaryAction");
    assert.match(env.elements.status.textContent, /蓝湖上传尚在进行/);
    assert.equal(env.state.history.length, 0); assert.equal(await env.metadata(), null);
    state.connected = false; state.uploading = false;
    await env.click("connectLanhu");
    assert.match(env.elements.lanhuStatus.textContent, /操作未完成/);
    assert.match(env.elements.errorDetails.textContent, /controlled connection failure/);
    assert.equal(env.elements.authoringUploadLanhu.disabled, true);
});

test("panel reports supported-layer failures in Chinese and retains original diagnostics without changing metadata", async () => {
    const env = await panelHarness();
    env.layer.kind = "text";
    await env.click("primaryAction");
    assert.match(env.elements.status.textContent, /仅支持普通像素层/);
    assert.doesNotMatch(env.elements.status.textContent, /Only ordinary/);
    assert.match(env.elements.errorDetails.textContent, /Only ordinary pixel layers/);
    assert.equal(await env.metadata(), null); assert.equal(env.file.text, undefined);
    assert.equal(env.state.imagingCalls.length, 0);
});

test("native Lanhu workspace renders real lists and wires account, selection and scope without PSD writes", async () => {
    const project = "cfea1199-7c07-48d9-86ef-cdbd3385c237";
    const view = { connected: false, loggedIn: false, uploading: false, projectId: "", teams: [], projects: [], groups: [],
        allArtboards: [{ id: "board", name: "主界面" }], selectedArtboards: [], artboardType: 1,
        deviceType: "", deviceScale: "", scales: { Web: [{ label: "@1x", value: "网页" }] } };
    const calls = [];
    const env = await panelHarness(undefined, undefined, { lanhuHost: () => ({
        status: () => view, workspace: () => view,
        async connect() { view.connected = true; },
        async perform(name, value) {
            calls.push({ name, value });
            if (name === "login") { view.loggedIn = true; view.userName = "美术"; view.teams = [{ id: "team", name: "游戏团队" }]; }
            if (name === "team") { view.teamId = value; view.projects = [{ id: project, name: "隔离项目" }, { id: "other", name: "其他项目" }]; }
            if (name === "project") view.projectId = value;
            if (name === "settings") Object.assign(view, value);
        }, async destroy() {}
    }) });
    await env.click("tabLanhu");
    assert.ok(env.elements.lanhuLoginAction.listeners.click);
    assert.equal(env.elements.lanhuWorkspace.parentNode, env.elements.lanhuFullMount);
    assert.equal(env.elements.lanhuBoardList.children[0].textContent, "主界面");
    assert.equal(env.elements.lanhuUploadAction.disabled, true);
    env.elements.lanhuAccount.value = "account"; env.elements.lanhuPassword.value = "PRIVATE";
    await env.click("lanhuLoginAction");
    assert.equal(env.elements.lanhuPassword.value, "");
    assert.equal(env.elements.lanhuLogin.style.display, "none");
    assert.equal(env.elements.lanhuAccountSummary.textContent, "美术");
    env.elements.lanhuTeam.value = "team"; await env.elements.lanhuTeam.listeners.change();
    assert.equal(env.elements.lanhuProject.children.find(item => item.value === "other").disabled, true);
    env.elements.lanhuProject.value = project; await env.elements.lanhuProject.listeners.change();
    env.elements.lanhuDevice.value = "Web"; await env.elements.lanhuDevice.listeners.change();
    assert.equal(view.deviceScale, "@1x");
    assert.equal(env.elements.lanhuUploadAction.disabled, false);
    await env.click("lanhuBoardsSelected");
    assert.equal(view.artboardType, 2);
    assert.match(env.elements.lanhuBoardList.textContent, /暂无可上传画板/);
    await env.click("lanhuSliceTab");
    assert.equal(env.elements.lanhuSliceView.style.display, "block");
    assert.equal(env.elements.lanhuUploadView.style.display, "none");
    await env.click("tabAuthoring"); await env.click("authoringToggleLanhu");
    assert.equal(env.elements.lanhuWorkspace.parentNode, env.elements.authoringLanhuInline);
    assert.equal(env.elements.lanhuAccountSummary.textContent, "美术");
    assert.equal(await env.metadata(), null); assert.equal(env.file.text, undefined);
    assert.equal(env.state.history.length, 0); assert.equal(env.state.imagingCalls.length, 0);
    assert.equal(calls.some(item => /upload|slice/i.test(item.name)), false);
});
