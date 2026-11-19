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

test("v2 catalog separates shared source records while preserving v1 nine-slice versions", () => {
    const { metadata, ref } = fixture();
    const legacy = author.directory(metadata);
    const imported = author.importCatalog(author.createCatalog(), legacy);
    const catalog = author.addPublicResource(imported, "普通图标", metadata.authoring.sources[ref]);
    const stored = author.writeCatalog(catalog);
    const plain = Object.keys(stored.assets).find(key => key !== ref);
    assert.equal(stored.schemaVersion, 2);
    assert.equal(stored.assets[ref].nineSlice, undefined);
    assert.equal(stored.assets[ref].sampling, undefined);
    assert.deepEqual(stored.nineSlices[ref].nineSlice, metadata.assets[ref].nineSlice);
    assert.deepEqual(Object.keys(stored.nineSlices), [ref]);
    assert.deepEqual(author.readCatalog(stored), catalog);
    assert.deepEqual(author.importResource(author.createMetadata(), catalog, ref).assets[ref], metadata.assets[ref]);
    assert.throws(() => author.importResource(author.createMetadata(), catalog, plain), /sourcePixel borders/);
    const overlap = clone(stored);
    overlap.assets[ref].nineSlice = stored.nineSlices[ref].nineSlice;
    assert.throws(() => author.readCatalog(overlap), /nineSlices map/);
    delete overlap.assets[ref].nineSlice;
    overlap.nineSlices.orphan = stored.nineSlices[ref];
    assert.throws(() => author.readCatalog(overlap), /Invalid nine-slice directory record/);
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
        assert.match(fs.readFileSync(path.join(target, "index.html"), "utf8"), /data-lanhu-runtime="excluded"/);
        assert.equal(fs.existsSync(path.join(target, "lanhu-runtime.js")), false);
        for (const icon of [...manifest.icons, ...manifest.entrypoints[0].icons]) {
            assert.deepEqual(fs.readFileSync(path.join(target, icon.path)), fs.readFileSync(path.join(__dirname, "Panel", icon.path)));
        }
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
        removeEventListener(name, callback) { if (this.listeners[name] === callback) delete this.listeners[name]; }
        contains(target) { return this === target || this.children.some(child => child.contains(target)); }
    }
    let html = fs.readFileSync(path.join(__dirname, "Panel/index.html"), "utf8");
    if (!startup.standalone) html = html.replace('data-lanhu-runtime="excluded"', 'data-lanhu-runtime="included"');
    const elements = {};
    for (const match of html.matchAll(/<(\w+)[^>]*id="([^"]+)"[^>]*>/g)) {
        const element = elements[match[2]] = new Element(match[1]);
        element.id = match[2];
        const value = match[0].match(/value="([^"]*)"/); if (value) element.value = value[1];
        for (const attribute of match[0].matchAll(/(class|role|aria-disabled|aria-selected|aria-pressed|tabindex|data-lanhu-runtime)="([^"]*)"/g)) {
            element.setAttribute(attribute[1], attribute[2]);
            if (attribute[1] === "class") element.className = attribute[2];
        }
    }
    assert.match(html, /id="sampling" class="ui-select"/);
    assert.doesNotMatch(html, /<select\b|<option\b/);
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
    const localFiles = new Map();
    function addCatalogFile(name, text) {
        const entry = { name, text, async write(value) { this.text = value; }, async read() { return this.text; } };
        localFiles.set(name, entry);
        return entry;
    }
    const legacyName = "gameui-resource-catalog.json", currentName = "gameui-resource-catalog-v2.json";
    if (catalogText !== undefined) addCatalogFile(legacyName, catalogText);
    const file = { get text() { return (localFiles.get(currentName) || localFiles.get(legacyName))?.text; } };
    const folder = { async getEntries() { return [...localFiles.values()]; }, async createFile(name) { return addCatalogFile(name); } };
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
        if (startup.showDuringSetup) entrypoints.showReady = value.panels.gameuiAuthoring.show();
    } }, storage: { localFileSystem: { async getDataFolder() { await catalogReady; return folder; },
        async getFileForOpening() { return { async read() { return JSON.stringify(startup.importDirectory || author.directory(fixture().metadata)); } }; } } } };
    const documentEvents = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "Panel/panel.js"), "utf8"), {
        document: { getElementById(id) { assert.ok(elements[id], id); return elements[id]; }, createElement(tag) { return new Element(tag); },
            addEventListener(name, callback) { documentEvents[name] = callback; },
            removeEventListener(name, callback) { if (documentEvents[name] === callback) delete documentEvents[name]; },
            querySelectorAll(tag) {
                const all = Object.values(elements);
                const seen = new Set(all);
                for (let i = 0; i < all.length; i++) for (const child of all[i].children) {
                    if (!seen.has(child)) { seen.add(child); all.push(child); }
                }
                return all.filter(element => tag === ".ui-button" ? String(element.className || "").split(/\s+/).includes("ui-button") : element.tag === tag);
            } },
        console, require(name) {
            if (name === "photoshop") return env.photoshop; if (name === "uxp") return uxp;
            if (name === "./gameui-ps.js") return env.store; if (name === "./gameui-authoring.js") return author;
            if (name === "./lanhu-host.js") return startup.lanhuHost ? { ...require("./Panel/lanhu-host.js"), createLanhuHost: startup.lanhuHost } : require("./Panel/lanhu-host.js");
            if (name === "./gameui-core.js") return core;
            if (name.startsWith("./")) return require("./Panel/" + name.slice(2));
            throw new Error(name);
        }
    });
    await entrypoints.showReady;
    const authoringReady = startup.startOnUpload ? null : elements.tabAuthoring.listeners.click();
    if (!startup.deferCatalog) await authoringReady;
    await new Promise(resolve => setImmediate(resolve));
    return { ...env, elements, file, localFiles, releaseCatalog, entrypoints, documentEvents,
        async notify(name = "select") { if (notification) await notification(name, {}); },
        selectParts(id) {
            const [trigger] = elements[id].children;
            const menu = elements.panelOverlays.children.find(item => item.children[0].id === id + "-viewport");
            const [viewport, rail] = menu.children;
            return { trigger, menu, viewport, rail, thumb: rail.children[0], list: viewport.children[0] };
        },
        async click(id) { await elements[id].listeners.click(); },
        async chooseSelect(id, value) {
            const { trigger, list } = this.selectParts(id);
            if (trigger.getAttribute("aria-expanded") !== "true") await trigger.listeners.click();
            const option = list.children.find(row => row.getAttribute("data-value") === value);
            assert.ok(option, id + " option " + value); return option.listeners.click();
        },
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
    await env.click("tabPublicResources");
    assert.match(env.elements.publicResourceStatus.textContent, /导入有效备份/);
    await env.click("import");
    assert.ok(JSON.parse(env.file.text).assets["ui.button.primary@1"]);
    assert.deepEqual(env.state.notificationEvents, ["select", "open", "close"]);
    // Import recovers the catalog, while the uninitialized PSD still requires explicit init.
    await env.click("tabAuthoring");
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
        assert.match(first.textContent, /条目 [1-3] · .*采样/); assert.match(second.textContent, /条目 [1-3] · .*采样/);
        assert.match(items.find(item => item.getAttribute("data-resource-ref") === uniqueRef).textContent, /^唯一名称 · v1 · 6 × 5/);
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
    assert.match(env.elements.targetMinimum.textContent, /18 × 14 px/);
    assert.equal(env.elements.resourceChoices.style.display, "none");
    assert.equal(env.elements.primaryAction.textContent, "应用尺寸");
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
    assert.equal(env.chosenResource(), "", "An unbound layer must not silently inherit the previous layer's resource.");
    env.chooseResource(ref);
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

test("legacy PSD reuses a v1 directory source and writes a separate v2 directory", async () => {
    const { metadata: legacy, ref, source } = fixture();
    legacy.assets[ref].optionalFutureContract = { keep: true };
    const oldDirectoryText = JSON.stringify(author.directory(legacy));
    delete legacy.authoring;
    legacy.futureDocument = { keep: true };
    const env = await panelHarness(oldDirectoryText, legacy);
    assert.equal(env.chosenResource(), ref);
    env.elements.targetWidth.value = "12";
    env.elements.targetHeight.value = "10";
    await env.click("primaryAction");
    const applied = await env.metadata();
    assert.equal(applied.documentId, legacy.documentId);
    assert.equal(applied.artboardId, legacy.artboardId);
    assert.equal(applied.nodes[10].nodeId, legacy.nodes[10].nodeId);
    assert.equal(applied.nodes[10].assetRef, ref);
    assert.deepEqual(applied.futureDocument, legacy.futureDocument);
    assert.deepEqual(applied.assets[ref], legacy.assets[ref]);
    assert.deepEqual(applied.authoring.sources[ref], source);
    assert.equal(applied.authoring.targets[applied.nodes[10].nodeId].width, 12);
    assert.equal(env.state.imagingCalls.length, 0, "A legacy instance still uses its directory source.");
    assert.equal(env.localFiles.get("gameui-resource-catalog.json").text, oldDirectoryText);
    const v2 = JSON.parse(env.localFiles.get("gameui-resource-catalog-v2.json").text);
    assert.equal(v2.schemaVersion, 2);
    assert.deepEqual(v2.nineSlices[ref].nineSlice, legacy.assets[ref].nineSlice);
    assert.equal(v2.authoring.targets, undefined);
});

test("a queued resource command stops when Photoshop changes the selected layer", async () => {
    const env = await panelHarness();
    primarySource64(env);
    const executeAsModal = env.photoshop.core.executeAsModal;
    let continueModal;
    env.photoshop.core.executeAsModal = async action => {
        await new Promise(resolve => { continueModal = resolve; });
        return executeAsModal(action);
    };
    const pending = env.click("primaryAction");
    const differentLayer = { ...env.layer, id: 11 };
    env.doc.layers.push(differentLayer);
    env.doc.activeLayers = [differentLayer];
    continueModal();
    await pending;
    assert.match(env.elements.status.textContent, /选层已变化/);
    assert.equal(await env.metadata(), null);
    assert.equal(env.file.text, undefined);
    assert.equal(env.state.history.length, 0);
    assert.equal(env.state.imagingCalls.length, 0);
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
    assert.equal(catalog.authoring.targets, undefined); assert.doesNotThrow(() => author.readCatalog(catalog));
});

test("public resource collection leaves the PSD untouched and nine-slice setup reuses its source", async () => {
    const env = await panelHarness(); primarySource64(env);
    await env.click("tabPublicResources");
    assert.equal(env.elements.authoringPane.style.display, "none");
    env.elements.publicResourceName.value = "可复用按钮源图";
    await env.click("collectPublicResource");
    const stored = JSON.parse(env.file.text), [ref] = Object.keys(stored.assets);
    assert.deepEqual(stored.nineSlices, {});
    assert.deepEqual(stored.requiredCapabilities, []);
    assert.equal(await env.metadata(), null);
    assert.equal(env.state.history.length, 0);

    await env.click("tabAuthoring");
    env.chooseResource(ref);
    assert.equal(env.elements.primaryAction.textContent, "记录九宫格并应用");
    env.elements.left.value = "8"; env.elements.right.value = "9";
    env.elements.targetWidth.value = "128"; env.elements.targetHeight.value = "80";
    await env.click("primaryAction");

    const value = await env.metadata(), updated = JSON.parse(env.file.text);
    assert.ok(value, env.elements.status.textContent);
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.nodes[10].assetRef, ref);
    assert.equal(updated.nineSlices[ref].nineSlice.left, 8);
    assert.deepEqual(updated.assets[ref], stored.assets[ref]);
    assert.deepEqual(value.authoring.sources[ref], stored.authoring.sources[ref]);
    assert.equal(env.state.imagingCalls.length, 1);
    assert.equal(env.state.history.length, 1);
    const reloaded = await panelHarness(env.file.text);
    assert.ok(reloaded.elements.resources.children.some(row => row.getAttribute("data-resource-ref") === ref));
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
    assert.equal(env.chosenResource(), "");
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
    await env.chooseSelect("sampling", "Bilinear");
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
    assert.ok(rows.every(row => row.tag === "div" && row.getAttribute("role") === "button" && !row.disabled));
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
    assert.equal(env.chosenResource(), ""); assert.match(rows[0].textContent, /^已选 · 新建九宫格源图$/);
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

test("upload opens first without loading resources, and tabs preserve inputs and reuse one connection", async () => {
    const state = { connected: false, uploading: false, loggedIn: false, projectId: null };
    let connections = 0, destroyed = 0;
    const uploads = [];
    const env = await panelHarness("{broken", undefined, { startOnUpload: true, lanhuHost: ({ onStatus }) => ({
        status: () => state,
        workspace: () => ({ ...state, deviceType: "Web", deviceScale: "@1x", scales: { Web: [{ label: "@1x", value: "网页" }] },
            allArtboards: [{ id: "board", name: "主界面" }] }),
        async connect() { connections++; state.connected = true; state.loggedIn = true; state.projectId = "cfea1199-7c07-48d9-86ef-cdbd3385c237"; onStatus("connected"); },
        async upload(scope) { uploads.push(scope); onStatus("handed to official upload"); },
        async destroy() { destroyed++; }
    }) });
    for (const id of ["authoringUploadLanhu", "authoringOpenLanhu", "authoringToggleLanhu", "authoringLanhuStatus", "authoringLanhuInline", "openLanhuOfficial", "lanhuMount"]) assert.equal(env.elements[id], undefined);
    assert.equal(env.elements.lanhuUploadTab.getAttribute("aria-selected"), "true");
    assert.equal(env.state.notificationEvents, undefined, "Resource initialization does not run during ordinary upload.");
    await env.entrypoints.value.panels.gameuiAuthoring.show();
    assert.equal(connections, 1, "Showing the panel connects to the blue lake workspace.");
    assert.equal(env.elements.lanhuPane.style.display, "block"); assert.equal(env.elements.authoringPane.style.display, "none");
    assert.equal(env.elements.lanhuUploadAction.textContent, "上传 1 个画板");
    await env.click("lanhuUploadAction");
    assert.deepEqual(clone(uploads), [{ documentId: env.doc.id, boardIds: ["board"] }]);
    await env.click("connectLanhu"); assert.equal(connections, 1);
    await env.click("tabAuthoring");
    assert.match(env.elements.status.textContent, /目录检查失败/);
    env.elements.displayName.value = "正在创作的名称"; env.elements.targetWidth.value = "192";
    await env.click("authoringBack");
    assert.equal(env.elements.displayName.value, "正在创作的名称"); assert.equal(env.elements.targetWidth.value, "192");
    await env.click("connectLanhu");
    await env.click("lanhuUploadAction"); assert.equal(uploads.length, 2);
    assert.equal(connections, 1, "Switching tabs reuses the internal session.");
    await env.click("tabAuthoring");
    assert.equal(env.elements.authoringPane.style.display, "block");
    assert.equal(env.elements.lanhuPane.style.display, "none");
    assert.equal(env.elements.displayName.value, "正在创作的名称");
    assert.equal(await env.metadata(), null); assert.equal(env.file.text, "{broken"); assert.equal(env.state.history.length, 0);
    await env.entrypoints.value.plugin.destroy(); assert.equal(destroyed, 1);
});

test("standalone package explains the integration requirement in both Lanhu tabs without trying to connect", async () => {
    const state = { connected: false, uploading: false, loggedIn: false };
    const env = await panelHarness(undefined, undefined, { startOnUpload: true, standalone: true, showDuringSetup: true,
        lanhuHost: () => ({ status: () => state, connect() { assert.fail("Standalone must not attempt to connect"); } }) });
    assert.match(env.elements.lanhuStatus.textContent, /当前安装的是 GameUI 独立版/);
    assert.equal(env.elements.lanhuReconnect.style.display, "none");
    await env.click("lanhuSliceTab");
    assert.match(env.elements.lanhuSliceStatus.textContent, /需要安装带蓝湖功能的集成版/);
    assert.equal(env.elements.lanhuSliceReconnect.style.display, "none");
    assert.equal(env.elements.lanhuSliceTools.style.display, "none");
    await env.click("resourcesTab");
    assert.equal(env.elements.resourcesTab.getAttribute("aria-selected"), "true");
    assert.equal(env.elements.publicResourcesPane.style.display, "block");
    await env.click("tabAuthoring");
    await env.click("lanhuSliceTab");
    assert.equal(env.elements.resourceTabs.style.display, "none");
    await env.click("resourcesTab");
    assert.equal(env.elements.authoringPane.style.display, "block", "Resources reopens its last subpage.");
});

test("retry shows progress, blocks duplicate clicks, and opens login after a recovered connection", async () => {
    const state = { connected: false, uploading: false, loggedIn: false };
    let attempts = 0, finish;
    const env = await panelHarness(undefined, undefined, { startOnUpload: true, showDuringSetup: true,
        lanhuHost: () => ({ status: () => state, async connect() {
            if (++attempts === 1) throw new Error("蓝湖初始化失败，请重试。");
            await new Promise(resolve => { finish = resolve; });
            state.connected = true;
        } }) });
    assert.equal(env.elements.lanhuStatus.textContent, "蓝湖初始化失败，请重试。");
    const retry = env.click("lanhuReconnect");
    assert.equal(env.elements.lanhuReconnect.textContent, "正在连接蓝湖…");
    assert.equal(env.elements.lanhuReconnect.style.display, "flex");
    assert.equal(env.elements.lanhuReconnect.getAttribute("aria-disabled"), "true");
    await env.click("lanhuReconnect");
    assert.equal(attempts, 2);
    finish();
    await retry;
    assert.equal(env.elements.lanhuReconnect.style.display, "none");
    assert.equal(env.elements.lanhuLogin.style.display, "block");
    assert.equal(env.elements.lanhuStatus.textContent, "请使用蓝湖账号登录。");
});

test("official upload progress blocks authoring writes and a failed Lanhu connection leaves upload disabled", async () => {
    const state = { connected: true, uploading: true, loggedIn: true, projectId: "test" };
    let changed;
    const env = await panelHarness(undefined, undefined, { lanhuHost: ({ onChange }) => {
        changed = onChange;
        return { status: () => state, async connect() { throw new Error("controlled connection failure"); }, async destroy() {} };
    } });
    await env.click("primaryAction");
    assert.match(env.elements.status.textContent, /蓝湖上传尚在进行/);
    assert.equal(env.state.history.length, 0); assert.equal(await env.metadata(), null);
    assert.equal(env.elements.connectLanhu.disabled, true);
    state.connected = false; state.uploading = false;
    changed();
    await env.click("connectLanhu");
    assert.match(env.elements.lanhuStatus.textContent, /操作未完成/);
    assert.match(env.elements.errorDetails.textContent, /controlled connection failure/);
    assert.equal(env.elements.lanhuUploadAction.disabled, true);
});

test("partial and unknown upload results never expose a bulk retry button", async () => {
    const view = { connected: true, loggedIn: true, uploading: false, projectId: "cfea1199-7c07-48d9-86ef-cdbd3385c237",
        deviceType: "Web", deviceScale: "@1x", allArtboards: [{ id: "board", name: "主界面" }] };
    let changed;
    const actions = [];
    const env = await panelHarness(undefined, undefined, { startOnUpload: true, lanhuHost: ({ onChange }) => {
        changed = onChange;
        return { status: () => view, workspace: () => view, async destroy() {}, async perform(action) {
            actions.push(action);
            if (action === "back") view.upload = null;
        } };
    } });
    for (const phase of ["fail", "unknown"]) {
        view.upload = { phase, percentage: 80, total: 2, success: 1, fail: 1,
            rows: [{ id: "a", name: "主界面", state: phase === "fail" ? "success" : "unknown" }, { id: "b", name: "设置页", state: "fail" }] };
        changed();
        assert.match(env.elements.lanhuProgress.textContent, /不要直接重传整批/);
        assert.deepEqual(env.elements.lanhuUploadRows.children.map(item => item.textContent),
            [phase === "fail" ? "主界面 · 已上传" : "主界面 · 待确认", "设置页 · 失败"]);
        assert.equal(env.elements.lanhuUploadAction.style.display, "none");
        assert.equal(env.elements.lanhuUploadAction.disabled, true);
        await env.click("lanhuBack");
        assert.equal(env.elements.lanhuUploadAction.style.display, "block");
        assert.equal(env.elements.lanhuUploadRows.children.length, 0);
    }
    view.upload = { phase: "fail", percentage: 99, total: 2, success: 1, fail: 1, canRetry: true, canView: true };
    changed();
    assert.equal(env.elements.lanhuRetryUpload.style.display, "block");
    await env.click("lanhuRetryUpload");
    assert.deepEqual(actions, ["back", "back", "retryUpload"]);
    view.upload = { phase: "unknown", percentage: 99, total: 1, success: 1, fail: 0, canView: true };
    changed();
    assert.equal(env.elements.lanhuRetryUpload.style.display, "none");
    assert.equal(env.elements.lanhuViewUpload.style.display, "block");
});

test("slice panel submits frame dimensions and clears them when Photoshop changes the selection", async () => {
    const view = { connected: true, uploading: false, slice: { ids: [1], canMark: true, marked: 0, width: 64, height: 48, regionsVisible: true } };
    const calls = [];
    let changed;
    const env = await panelHarness(undefined, undefined, { startOnUpload: true, lanhuHost: ({ onChange }) => {
        changed = onChange;
        return { status: () => view, workspace: () => view, async destroy() {}, async perform(action, value) {
            calls.push([action, value?.width, value?.height]);
            if (action === "hiddenSlice") view.slice.regionsVisible = false;
        } };
    } });
    await env.click("lanhuSliceTab");
    assert.equal(env.elements.lanhuSliceHeight.getAttribute("placeholder"), "48");
    env.elements.lanhuSliceWidth.value = "96";
    changed();
    assert.equal(env.elements.lanhuSliceWidth.value, "96");
    await env.click("lanhuSliceGroup");
    assert.deepEqual(calls, [["sliceWithGroup", "96", ""]]);
    await env.click("lanhuSliceVisibility");
    assert.equal(env.elements.lanhuSliceVisibility.getAttribute("aria-checked"), "false");
    assert.equal(calls.at(-1)[0], "hiddenSlice");
    view.slice = { ids: [2], canMark: false, marked: 1, mode: "frame" };
    changed();
    assert.equal(env.elements.lanhuSliceWidth.value, "");
    assert.equal(env.elements.lanhuSliceGroup.disabled, true);
    assert.equal(env.elements.lanhuUnslice.disabled, false);
    assert.match(env.elements.lanhuSliceSelection.textContent, /已标记框选切图/);
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
    await env.click("lanhuUploadTab");
    assert.ok(env.elements.lanhuLoginAction.listeners.click);
    assert.equal(env.elements.lanhuBoardList.children[0].textContent, "主界面");
    assert.equal(env.elements.lanhuUploadAction.disabled, true);
    env.elements.lanhuAccount.value = "account"; env.elements.lanhuPassword.value = "PRIVATE";
    await env.click("lanhuLoginAction");
    assert.equal(env.elements.lanhuPassword.value, "");
    assert.equal(env.elements.lanhuLogin.style.display, "none");
    assert.equal(env.elements.lanhuAccountSummary.textContent, "美术");
    await env.chooseSelect("lanhuTeam", "team");
    assert.equal(env.selectParts("lanhuProject").list.children.find(item => item.getAttribute("data-value") === "other").getAttribute("aria-disabled"), "true");
    await env.chooseSelect("lanhuProject", project);
    await env.chooseSelect("lanhuDevice", "Web");
    assert.equal(view.deviceScale, "@1x");
    assert.equal(env.elements.lanhuUploadAction.disabled, false);
    await env.click("lanhuBoardsSelected");
    assert.equal(view.artboardType, 2);
    assert.match(env.elements.lanhuBoardList.textContent, /请在 Photoshop 选中/);
    assert.equal(env.elements.lanhuUploadAction.disabled, true);
    await env.click("lanhuSliceTab");
    assert.equal(env.elements.lanhuSliceView.style.display, "block");
    assert.equal(env.elements.lanhuUploadView.style.display, "none");
    await env.click("tabAuthoring"); await env.click("lanhuUploadTab");
    assert.equal(env.elements.lanhuPane.style.display, "block");
    assert.equal(env.elements.lanhuAccountSummary.textContent, "美术");
    assert.equal(await env.metadata(), null); assert.equal(env.file.text, undefined);
    assert.equal(env.state.history.length, 0); assert.equal(env.state.imagingCalls.length, 0);
    assert.equal(calls.some(item => /upload|slice/i.test(item.name)), false);
});

test("native browser authorization preserves pending and cancel state across tab switches", async () => {
    const view = { connected: false, loggedIn: false, uploading: false, browserAuthorizing: false, teams: [], projects: [], groups: [], scales: {} };
    const calls = [];
    const env = await panelHarness(undefined, undefined, { lanhuHost: () => ({
        status: () => view, workspace: () => view, async connect() { view.connected = true; },
        async perform(name) { calls.push(name); if (name === "browserAuth") view.browserAuthorizing = true; if (name === "cancelBrowserAuth") view.browserAuthorizing = false; }, async destroy() {}
    }) });
    await env.click("lanhuUploadTab"); await env.click("lanhuBrowserAuth");
    assert.equal(view.browserAuthorizing, true); assert.equal(env.elements.lanhuBrowserAuth.disabled, true);
    assert.equal(env.elements.lanhuLoginAction.disabled, true); assert.equal(env.elements.lanhuCancelAuth.style.display, "block");
    assert.match(env.elements.lanhuAuthHint.textContent, /等待浏览器授权/);
    await env.click("tabAuthoring"); await env.click("lanhuUploadTab");
    assert.equal(env.elements.lanhuPane.style.display, "block");
    await env.click("lanhuCancelAuth");
    assert.equal(view.browserAuthorizing, false); assert.equal(env.elements.lanhuBrowserAuth.disabled, false);
    assert.equal(env.elements.lanhuCancelAuth.style.display, "none");
    assert.ok(calls.includes("browserAuth") && calls.includes("cancelBrowserAuth"));
    assert.equal(await env.metadata(), null); assert.equal(env.state.history.length, 0); assert.equal(env.state.imagingCalls.length, 0);
});

test("custom buttons retain mouse and keyboard activation, ARIA and hard disabled gating without PSD writes", async () => {
    const env = await panelHarness();
    const button = env.elements.toggleAdvanced;
    assert.equal(button.tag, "div"); assert.equal(button.getAttribute("role"), "button");
    assert.equal(button.getAttribute("aria-disabled"), "false"); assert.equal(button.getAttribute("tabindex"), "0");
    let prevented = 0;
    const key = (key, repeat = false) => button.listeners.keydown({ key, repeat, preventDefault() { prevented++; } });
    await key("Enter"); assert.equal(env.elements.advancedPanel.style.display, "block");
    await key(" "); assert.equal(env.elements.advancedPanel.style.display, "none");
    await key("Enter", true); assert.equal(env.elements.advancedPanel.style.display, "none");
    button.disabled = true;
    assert.equal(button.getAttribute("aria-disabled"), "true"); assert.equal(button.getAttribute("tabindex"), "-1");
    await env.click("toggleAdvanced"); await key("Enter"); await key(" ");
    assert.equal(env.elements.advancedPanel.style.display, "none");
    env.elements.primaryAction.disabled = true;
    await env.click("primaryAction");
    await env.elements.primaryAction.listeners.keydown({ key: "Enter", preventDefault() {} });
    assert.equal(await env.metadata(), null); assert.equal(env.state.history.length, 0); assert.equal(env.state.imagingCalls.length, 0);
    button.disabled = false; await env.click("toggleAdvanced"); assert.equal(env.elements.advancedPanel.style.display, "block");
    assert.equal(prevented, 4);
    assert.equal(env.elements.tabAuthoring.getAttribute("role"), "tab", "Custom drawing preserves tab semantics.");
});

test("custom pickers preserve exact values, keyboard selection and cancel without native select chrome or PSD writes", async () => {
    const state = { connected: true, loggedIn: false, uploading: false, projectId: null };
    const env = await panelHarness(undefined, undefined, { lanhuHost: () => ({ status: () => state, async destroy() {} }) });
    const { trigger, list } = env.selectParts("sampling");
    assert.equal(env.elements.sampling.tag, "div"); assert.equal(trigger.getAttribute("role"), "combobox");
    assert.equal(trigger.getAttribute("aria-expanded"), "false"); assert.equal(env.elements.sampling.value, "Bilinear");
    const key = (key, repeat = false) => trigger.listeners.keydown({ key, repeat, preventDefault() {} });
    await key("Enter"); await key("ArrowUp"); await key("Enter");
    assert.equal(env.elements.sampling.value, "Point");
    assert.equal(list.children.find(item => item.getAttribute("data-value") === "Point").getAttribute("aria-selected"), "true");
    await key(" "); await key("ArrowDown"); await key("Escape");
    assert.equal(env.elements.sampling.value, "Point", "Escape must not commit the highlighted value.");
    await env.chooseSelect("sampling", "Bilinear"); assert.equal(env.elements.sampling.value, "Bilinear");
    await key("Enter"); await key("Enter", true); assert.equal(trigger.getAttribute("aria-expanded"), "true");
    env.documentEvents.click({ target: env.elements.displayName }); assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await key("Enter"); await env.elements.lanhuDevice.children[0].listeners.click();
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "Opening another picker closes the first.");
    env.elements.lanhuDevice.children[0].listeners.keydown({ key: "Tab" });
    assert.equal(env.elements.lanhuDevice.children[0].getAttribute("aria-expanded"), "false");
    assert.equal(await env.metadata(), null); assert.equal(env.state.history.length, 0); assert.equal(env.state.imagingCalls.length, 0);
});

test("custom picker stays open on unchanged state and refuses disabled fields or projects when locked", async () => {
    const project = "cfea1199-7c07-48d9-86ef-cdbd3385c237";
    const view = { connected: true, loggedIn: false, uploading: false, teams: [{ id: "team", name: "实际团队" }], projects: [{ id: "other", name: "其他项目" }, { id: project, name: "测试项目" }], groups: [], scales: {} };
    const calls = []; let changed;
    const env = await panelHarness(undefined, undefined, { lanhuHost: ({ onChange }) => {
        changed = onChange;
        return { status: () => view, workspace: () => view, async perform(name, value) { calls.push({ name, value }); if (name === "project") view.projectId = value; }, async destroy() {} };
    } });
    const teamTrigger = env.elements.lanhuTeam.children[0];
    await teamTrigger.listeners.click();
    assert.equal(teamTrigger.getAttribute("aria-expanded"), "false"); assert.equal(teamTrigger.getAttribute("aria-disabled"), "true");
    view.loggedIn = true; changed(); await teamTrigger.listeners.click(); changed();
    assert.equal(teamTrigger.getAttribute("aria-expanded"), "true", "Memory status refresh must not rebuild or close an unchanged open menu.");
    await env.chooseSelect("lanhuProject", "other");
    assert.equal(env.elements.lanhuProject.value, ""); assert.equal(calls.length, 0);
    const projectTrigger = env.elements.lanhuProject.children[0];
    await projectTrigger.listeners.keydown({ key: "Home", preventDefault() {} });
    await projectTrigger.listeners.keydown({ key: "Enter", preventDefault() {} });
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ name: "project", value: project }]);
    view.uploading = true; changed(); await teamTrigger.listeners.click();
    assert.equal(teamTrigger.getAttribute("aria-expanded"), "false");
    assert.equal(teamTrigger.getAttribute("tabindex"), "-1");
    assert.equal(await env.metadata(), null); assert.equal(env.state.history.length, 0);
});

test("picker rail scrolls clipped content with wheel, drag, paging and keys without native scrollTop", async () => {
    const view = { connected: true, loggedIn: true, uploading: false, teams: Array.from({ length: 15 }, (_, i) => ({ id: "team-" + i, name: "团队 " + i })), projects: [], groups: [], scales: {} };
    const env = await panelHarness(undefined, undefined, { lanhuHost: () => ({ status: () => view, workspace: () => view, async destroy() {} }) });
    const { trigger, menu, viewport, list, rail, thumb } = env.selectParts("lanhuTeam");
    list.scrollHeight = 480;
    Object.defineProperty(viewport, "scrollTop", { get: () => 0, set() {} });
    viewport.getBoundingClientRect = () => ({ top: 0, bottom: 160 });
    rail.getBoundingClientRect = () => ({ top: 0 });
    list.children.forEach((row, index) => { row.getBoundingClientRect = () => ({ top: index * 30 + (parseFloat(list.style.top) || 0), bottom: (index + 1) * 30 + (parseFloat(list.style.top) || 0) }); });
    const event = values => ({ target: list.children[1], preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...values });
    await trigger.listeners.click();
    assert.equal(viewport.style.height, "160px"); assert.equal(rail.style.display, "block");
    assert.equal(rail.getAttribute("aria-valuemax"), "320");
    const wheel = event({ type: "wheel", deltaY: 60 }); menu.listeners.wheel(wheel);
    assert.equal(list.style.top, "-60px"); assert.equal(wheel.stopped, true);
    env.elements.panelViewport.listeners.wheel(wheel);
    assert.equal(parseFloat(env.elements.panelContent.style.top), 0, "The same gesture must not move the outer panel.");
    menu.listeners.mousewheel(event({ type: "mousewheel", wheelDelta: -60 }));
    assert.equal(list.style.top, "-60px", "A legacy duplicate must not scroll twice.");
    rail.listeners.keydown(event({ target: rail, key: "End" }));
    assert.equal(list.style.top, "-320px"); assert.equal(thumb.style.marginTop, "104px");
    const boundary = event({ type: "wheel", deltaY: 30 }); menu.listeners.wheel(boundary);
    assert.equal(boundary.stopped, true, "A floating menu keeps boundary gestures from moving its anchor.");
    rail.listeners.mousedown(event({ target: thumb, button: 0, clientY: 100 }));
    env.documentEvents.mousemove(event({ clientY: 48 }));
    assert.equal(list.style.top, "-160px"); assert.equal(rail.getAttribute("data-dragging"), "true");
    env.documentEvents.mouseup(); assert.equal(env.documentEvents.mousemove, undefined);
    rail.listeners.mousedown(event({ target: rail, button: 0, clientY: 0 }));
    assert.equal(list.style.top, "-16px");
    trigger.listeners.keydown(event({ key: "End" }));
    assert.equal(list.style.top, "-320px", "Keyboard highlighting reveals the final option.");
    list.scrollHeight = 90; env.elements.panelViewport.listeners.scroll();
    assert.equal(list.style.top, "0px"); assert.equal(rail.style.display, "none"); assert.equal(viewport.style.height, "90px");
    list.scrollHeight = 480; env.elements.panelViewport.listeners.scroll();
    rail.listeners.mousedown(event({ target: thumb, button: 0, clientY: 20 }));
    await env.entrypoints.value.plugin.destroy();
    assert.equal(menu.style.display, "none"); assert.equal(env.documentEvents.mousemove, undefined); assert.equal(env.documentEvents.mouseup, undefined);
    assert.equal(await env.metadata(), null); assert.equal(env.state.history.length, 0);
});

test("scroll clipping hides native editors outside the content viewport and restores values and lifecycle listeners", async () => {
    const env = await panelHarness();
    env.elements.panelViewport.getBoundingClientRect = () => ({ top: 88, bottom: 450 });
    let fieldTop = 60;
    env.elements.targetWidth.getBoundingClientRect = () => ({ top: fieldTop, bottom: fieldTop + 32 });
    env.elements.targetHeight.getBoundingClientRect = () => ({ top: 150, bottom: 182 });
    env.elements.targetWidth.value = "180"; env.elements.targetHeight.value = "40";
    env.elements.panelViewport.listeners.scroll();
    assert.equal(env.elements.targetWidth.style.visibility, "hidden"); assert.equal(env.elements.targetWidth.style.opacity, "0");
    assert.equal(env.elements.targetHeight.style.visibility, "visible");
    fieldTop = 200; env.elements.panelViewport.listeners.scroll();
    assert.equal(env.elements.targetWidth.style.visibility, "visible"); assert.equal(env.elements.targetWidth.style.opacity, "1");
    assert.equal(env.elements.targetWidth.value, "180"); assert.equal(env.elements.targetHeight.value, "40");
    fieldTop = 440; env.elements.panelViewport.listeners.scroll();
    assert.equal(env.elements.targetWidth.style.visibility, "hidden", "Partially clipped editors must not paint across the viewport boundary.");
    assert.equal(await env.metadata(), null); assert.equal(env.state.history.length, 0); assert.equal(env.state.imagingCalls.length, 0);
    await env.entrypoints.value.plugin.destroy();
    assert.equal(env.documentEvents.click, undefined); assert.equal(env.elements.panelViewport.listeners.scroll, undefined);
});

test("floating pickers follow viewport bounds, flip above and restore covered native editors without changing values", async () => {
    const env = await panelHarness();
    const { trigger, menu, list, viewport } = env.selectParts("sampling");
    const box = (left, top, right, bottom) => ({ left, top, right, bottom });
    let anchor = box(200, 140, 340, 172);
    env.elements.panelViewport.getBoundingClientRect = () => box(10, 89, 310, 400);
    const overlay = env.elements.panelOverlays;
    env.elements.panelFrame.getBoundingClientRect = () => box(5, 10, 315, 410);
    trigger.getBoundingClientRect = () => anchor;
    list.scrollHeight = 60;
    env.elements.targetWidth.getBoundingClientRect = () => box(180, 180, 250, 212);
    env.elements.targetHeight.getBoundingClientRect = () => box(20, 180, 100, 212);
    env.elements.targetWidth.value = "180";
    await trigger.listeners.click();
    assert.equal(menu.parentNode, env.elements.panelOverlays, "Menus must not contribute to the field or content layout.");
    assert.equal(env.elements.sampling.children.length, 1);
    assert.equal(menu.getAttribute("data-placement"), "bottom");
    assert.equal(overlay.style.left, "161px"); assert.equal(overlay.style.top, "166px");
    assert.equal(overlay.style.width, "140px"); assert.equal(overlay.style.height, "70px");
    assert.equal(env.elements.targetWidth.style.visibility, "hidden");
    assert.equal(env.elements.targetHeight.style.visibility, "visible", "Only overlapping editors should be hidden.");
    env.documentEvents.click({ target: list.children[0] });
    assert.equal(trigger.getAttribute("aria-expanded"), "true", "Portal clicks still belong to the picker.");
    anchor = box(200, 360, 340, 392); list.scrollHeight = 480;
    env.elements.panelViewport.listeners.scroll();
    assert.equal(menu.getAttribute("data-placement"), "top"); assert.equal(overlay.style.top, "176px");
    assert.equal(viewport.style.height, "160px");
    anchor = box(200, 70, 340, 102);
    env.elements.panelViewport.listeners.scroll();
    assert.equal(menu.style.display, "none", "A partially clipped trigger closes its floating menu.");
    assert.equal(overlay.style.display, "none");
    assert.equal(env.elements.targetWidth.style.visibility, "visible");
    assert.equal(env.elements.targetWidth.value, "180");
    anchor = box(20, 200, 160, 232);
    await trigger.listeners.click();
    assert.equal(viewport.style.height, "150px", "Menu height is capped by the available viewport space.");
    env.documentEvents.focusin({ target: env.elements.targetHeight });
    assert.equal(menu.style.display, "none");
    await env.entrypoints.value.plugin.destroy(); assert.equal(env.documentEvents.focusin, undefined);
    assert.equal(await env.metadata(), null); assert.equal(env.state.history.length, 0);
});

test("top-level tabs close floating menus, release drag and restore each page's bounded scroll position", async () => {
    const view = { connected: true, loggedIn: true, uploading: false, teams: [], projects: [], groups: [], scales: {} };
    const env = await panelHarness(undefined, undefined, { lanhuHost: () => ({ status: () => view, workspace: () => view, async destroy() {} }) });
    const { panelViewport: viewport, panelContent: content, panelScrollbar: rail, panelScrollThumb: thumb } = env.elements;
    viewport.clientHeight = 300;
    Object.defineProperty(content, "scrollHeight", { get() {
        return env.elements.authoringPane.style.display !== "none" ? 1200 : env.elements.lanhuUploadView.style.display !== "none" ? 1000 : 450;
    } });
    const wheel = deltaY => viewport.listeners.wheel({ type: "wheel", deltaY, preventDefault() {} });
    wheel(200); assert.equal(content.style.top, "-200px");
    await env.click("lanhuUploadTab"); assert.equal(parseFloat(content.style.top), 0);
    wheel(300); await env.selectParts("lanhuDevice").trigger.listeners.click();
    rail.listeners.mousedown({ target: thumb, button: 0, clientY: 100, preventDefault() {} });
    assert.ok(env.documentEvents.mousemove);
    await env.click("lanhuSliceTab");
    assert.equal(env.selectParts("lanhuDevice").menu.style.display, "none");
    assert.equal(env.documentEvents.mousemove, undefined);
    assert.equal(parseFloat(content.style.top), 0); assert.equal(rail.getAttribute("aria-valuemax"), "150");
    wheel(500); assert.equal(content.style.top, "-150px");
    await env.click("lanhuUploadTab"); assert.equal(content.style.top, "-300px");
    await env.click("tabAuthoring"); assert.equal(content.style.top, "-200px");
    await env.click("lanhuUploadTab"); assert.equal(content.style.top, "-300px");
    await env.click("lanhuSliceTab"); assert.equal(content.style.top, "-150px");
    assert.equal(env.elements.lanhuSliceTab.getAttribute("aria-selected"), "true");
    assert.equal(await env.metadata(), null); assert.equal(env.state.history.length, 0);
});


test("panel scroll rail follows wheel, paging, dragging, resize and cleanup without writing PSD", async () => {
    const env = await panelHarness();
    const viewport = env.elements.panelViewport, rail = env.elements.panelScrollbar, thumb = env.elements.panelScrollThumb;
    viewport.clientHeight = 300; env.elements.panelContent.scrollHeight = 1200; viewport.scrollTop = 0;
    rail.clientHeight = 308; rail.getBoundingClientRect = () => ({ top: 88 });
    Object.defineProperty(viewport, "scrollTop", { get: () => 0, set() {} });
    let prevented = 0;
    const event = values => ({ target: viewport, preventDefault() { prevented++; }, ...values });
    viewport.listeners.wheel(event({ deltaY: 2, deltaMode: 1 }));
    assert.equal(-parseFloat(env.elements.panelContent.style.top), 40); assert.equal(thumb.style.height, "75px");
    assert.equal(rail.getAttribute("aria-valuenow"), "40");
    rail.listeners.keydown(event({ target: rail, key: "End" }));
    assert.equal(-parseFloat(env.elements.panelContent.style.top), 900); assert.equal(thumb.style.marginTop, "225px");
    rail.listeners.mousedown(event({ target: thumb, clientY: 100, button: 0 }));
    env.documentEvents.mousemove(event({ clientY: 0 }));
    assert.equal(-parseFloat(env.elements.panelContent.style.top), 500); assert.equal(rail.getAttribute("data-dragging"), "true");
    env.documentEvents.mouseup();
    assert.equal(env.documentEvents.mousemove, undefined); assert.equal(rail.getAttribute("data-dragging"), "false");
    rail.listeners.mousedown(event({ target: rail, clientY: 90, button: 0 }));
    assert.equal(-parseFloat(env.elements.panelContent.style.top), 230);
    viewport.listeners.keydown(event({ target: env.elements.targetWidth, key: "Home" }));
    assert.equal(-parseFloat(env.elements.panelContent.style.top), 230, "Editing Home/End belongs to the input.");
    viewport.listeners.wheel(event({ deltaY: 200, ctrlKey: true }));
    assert.equal(-parseFloat(env.elements.panelContent.style.top), 230);
    env.elements.panelContent.scrollHeight = 100; viewport.listeners.scroll();
    assert.equal(parseFloat(env.elements.panelContent.style.top), 0); assert.equal(rail.style.visibility, "hidden");
    assert.equal(rail.getAttribute("tabindex"), "-1");
    assert.ok(prevented >= 5);
    await env.entrypoints.value.plugin.destroy();
    assert.equal(viewport.listeners.wheel, undefined); assert.equal(rail.listeners.mousedown, undefined);
    assert.equal(rail.listeners.keydown, undefined); assert.equal(viewport.listeners.keydown, undefined);
    assert.equal(await env.metadata(), null); assert.equal(env.state.history.length, 0);
});

test("panel scrolling yields to a nested list until it reaches the wheel direction boundary", async () => {
    const env = await panelHarness(), viewport = env.elements.panelViewport, list = env.elements.resources;
    viewport.clientHeight = 300; env.elements.panelContent.scrollHeight = 1200; viewport.scrollTop = 0;
    env.elements.panelScrollbar.listeners.keydown({ target: env.elements.panelScrollbar, key: "Home", preventDefault() {} });
    viewport.listeners.wheel({ deltaY: 100, preventDefault() {} });
    list.clientHeight = 144; list.scrollHeight = 400; list.scrollTop = 0;
    let prevented = 0;
    const event = { target: list.children[0], deltaY: 50, preventDefault() { prevented++; } };
    viewport.listeners.wheel(event);
    assert.equal(-parseFloat(env.elements.panelContent.style.top), 100); assert.equal(prevented, 0);
    list.scrollTop = 256; viewport.listeners.wheel(event);
    assert.equal(-parseFloat(env.elements.panelContent.style.top), 150); assert.equal(prevented, 1);
    viewport.listeners.wheel({ ...event, deltaY: -50 });
    assert.equal(-parseFloat(env.elements.panelContent.style.top), 150, "A nested list can still scroll upward at its bottom edge.");
    list.scrollTop = 0; viewport.listeners.wheel({ ...event, deltaY: -50 });
    assert.equal(-parseFloat(env.elements.panelContent.style.top), 100);
});


test("legacy Photoshop wheel events move content and thumb even when native hidden scrollTop cannot change", async () => {
    const env = await panelHarness(), viewport = env.elements.panelViewport, content = env.elements.panelContent, rail = env.elements.panelScrollbar;
    viewport.clientHeight = 300; content.offsetHeight = 1200; rail.clientHeight = 308;
    Object.defineProperty(viewport, "scrollTop", { get: () => 0, set() {} });
    let prevented = 0;
    viewport.listeners.mousewheel({ type: "mousewheel", target: content, wheelDelta: -120, preventDefault() { prevented++; } });
    assert.equal(content.style.top, "-120px");
    assert.equal(rail.getAttribute("aria-valuenow"), "120");
    assert.equal(env.elements.panelScrollThumb.style.marginTop, "30px");
    viewport.listeners.wheel({ type: "wheel", target: content, deltaY: 50, preventDefault() { prevented++; } });
    viewport.listeners.mousewheel({ type: "mousewheel", target: content, wheelDelta: -50, preventDefault() { prevented++; } });
    assert.equal(content.style.top, "-170px", "Duplicate legacy events must not double the same gesture.");
    assert.equal(prevented, 2);
    await env.entrypoints.value.plugin.destroy();
    assert.equal(viewport.listeners.mousewheel, undefined); assert.equal(rail.listeners.mousewheel, undefined);
});

test("blank content drags with pointer capture, moves the scrollbar and releases on cancellation", async () => {
    const env = await panelHarness(), viewport = env.elements.panelViewport, content = env.elements.panelContent, rail = env.elements.panelScrollbar;
    viewport.clientHeight = 300; content.offsetHeight = 1200; rail.clientHeight = 308;
    const captures = [], releases = [];
    viewport.setPointerCapture = id => captures.push(id); viewport.releasePointerCapture = id => releases.push(id);
    const event = extra => ({ target: content, pointerId: 7, clientY: 200, button: 0, buttons: 1, preventDefault() {}, ...extra });
    viewport.listeners.wheel({ deltaY: 100, preventDefault() {} });
    viewport.listeners.pointerdown(event());
    assert.deepEqual(captures, [7]);
    viewport.listeners.mousedown(event({ pointerId: undefined }));
    assert.deepEqual(captures, [7], "Compatibility mousedown must not restart a pointer drag.");
    viewport.listeners.pointermove(event({ clientY: 198 }));
    assert.equal(content.style.top, "-100px", "A small click movement must not start panning.");
    viewport.listeners.pointermove(event({ pointerId: 8, clientY: 100 }));
    assert.equal(content.style.top, "-100px");
    viewport.listeners.pointermove(event({ clientY: 100 }));
    assert.equal(content.style.top, "-200px"); assert.equal(rail.getAttribute("aria-valuenow"), "200");
    assert.equal(env.elements.panelScrollThumb.style.marginTop, "50px");
    assert.equal(viewport.getAttribute("data-panning"), "true");
    env.documentEvents.pointermove(event({ clientY: 1000 })); assert.equal(content.style.top, "0px");
    env.documentEvents.pointermove(event({ clientY: -2000 })); assert.equal(content.style.top, "-900px");
    viewport.listeners.pointercancel(event());
    assert.deepEqual(releases, [7]); assert.equal(viewport.getAttribute("data-panning"), "false");
    assert.equal(env.documentEvents.pointermove, undefined); assert.equal(viewport.listeners.pointermove, undefined);
    assert.equal(await env.metadata(), null); assert.equal(env.state.history.length, 0);
});

test("blank content mouse dragging works without pointer capture and cleans up on release and destroy", async () => {
    const env = await panelHarness(), viewport = env.elements.panelViewport, content = env.elements.panelContent;
    viewport.clientHeight = 300; content.offsetHeight = 1200;
    const event = extra => ({ target: viewport, clientY: 200, button: 0, buttons: 1, preventDefault() {}, ...extra });
    viewport.listeners.mousedown(event());
    env.documentEvents.mousemove(event({ clientY: 120 })); assert.equal(content.style.top, "-80px");
    env.documentEvents.mouseup(event({ buttons: 0 }));
    assert.equal(env.documentEvents.mousemove, undefined); assert.equal(viewport.getAttribute("data-panning"), "false");
    viewport.listeners.mousedown(event()); env.documentEvents.mousemove(event({ buttons: 0 }));
    assert.equal(content.style.top, "-80px"); assert.equal(env.documentEvents.mousemove, undefined);
    viewport.listeners.mousedown(event());
    await env.entrypoints.value.plugin.destroy();
    for (const name of ["pointerdown", "mousedown", "pointermove", "pointerup", "pointercancel", "mousemove", "mouseup"]) assert.equal(viewport.listeners[name], undefined);
    assert.equal(env.documentEvents.mousemove, undefined); assert.equal(env.documentEvents.pointerup, undefined);
    assert.equal(await env.metadata(), null); assert.equal(env.state.history.length, 0);
});

test("content drag ignores editors, controls, text, secondary buttons and a page with no overflow", async () => {
    const env = await panelHarness(), viewport = env.elements.panelViewport, content = env.elements.panelContent;
    viewport.clientHeight = 300; content.offsetHeight = 1200;
    const event = extra => ({ target: content, clientY: 200, button: 0, preventDefault() { throw new Error("Must preserve native interaction"); }, ...extra });
    for (const target of [env.elements.targetWidth, env.elements.primaryAction, env.elements.sampling, env.elements.resources,
        { tagName: "P", parentNode: content }, { tagName: "DIV", parentNode: env.elements.primaryAction }]) {
        viewport.listeners.mousedown(event({ target })); assert.equal(env.documentEvents.mousemove, undefined);
    }
    viewport.listeners.mousedown(event({ button: 2 })); assert.equal(env.documentEvents.mousemove, undefined);
    viewport.listeners.pointerdown(event({ isPrimary: false })); assert.equal(env.documentEvents.pointermove, undefined);
    content.offsetHeight = 200; viewport.listeners.mousedown(event()); assert.equal(env.documentEvents.mousemove, undefined);
    assert.equal(await env.metadata(), null); assert.equal(env.state.history.length, 0);
});
