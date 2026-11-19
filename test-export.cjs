"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { decodeSourcePng } = require("./gameui-core.js");
const { config, fixture, uploaded, png, chunk } = require("./test-export-fixtures.cjs");
test("PNG decoder accepts stored, fixed and dynamic RGBA streams without Node dependencies", () => {
    for (const options of [{ zlib: { level: 0 } }, { zlib: { strategy: zlib.constants.Z_FIXED } }, {}, { zlib: { level: 9 } }]) {
        const data = png(33, 25, options);
        const value = decodeSourcePng({ width: 33, height: 25, pngBase64: data.toString("base64") }, { width: 33, height: 25 });
        assert.deepEqual(Buffer.from(value), data);
    }
});
test("PNG decoder rejects CRC, truncated, bad deflate/adler, color, filter, base64 and dimensions", () => {
    const data = png(), crc = Buffer.from(data); crc[32] ^= 1;
    const badDeflate = Buffer.from([0x78,0x9c,0x07,0,0,0,1]);
    const palette = chunk("PLTE", Buffer.from([1,2,3]));
    const duplicatePalette = Buffer.concat([data.subarray(0,33), palette, palette, data.subarray(33)]);
    for (const image of [crc, duplicatePalette, data.subarray(0, data.length - 1), Buffer.concat([data, Buffer.from([0])]),
        png(8, 6, { stream: badDeflate }), png(8, 6, { color: 2 }), png(8, 6, { filter: 5 })]) {
        assert.throws(() => decodeSourcePng({ width: 8, height: 6, pngBase64: image.toString("base64") }, { width: 8, height: 6 }));
    }
    for (const encoded of ["", "data:image/png;base64," + data.toString("base64"), data.toString("base64") + "\n", "aaa="]) {
        assert.throws(() => decodeSourcePng({ width: 8, height: 6, pngBase64: encoded }, { width: 8, height: 6 }));
    }
    assert.throws(() => decodeSourcePng({ width: 7, height: 6, pngBase64: data.toString("base64") }, { width: 7, height: 6 }));
    assert.throws(() => decodeSourcePng({ width: 8, height: 6, pngBase64: data.toString("base64") }, { width: 8, height: 7 }));
});
test("snapshot injects deterministic native leaf and finalizes URL through the same upload; local data removed", async () => {
    const f = fixture(), original = JSON.stringify(f.metadata);
    await f.exporter.capture(f.payload, config, 55, {});
    assert.equal(f.counts().exports, 0);
    assert.equal(f.payload.artboard.layers.length, 2);
    const source = f.payload.artboard.layers[1];
    assert.deepEqual(Buffer.from(source.image.bitmap), png());
    assert.equal(source.gameUI.kind, "resourceSource");
    assert.equal(source.realFrame.width, 8);
    assert.equal(f.payload.gameUI.authoring, undefined);
    assert.equal(f.payload.gameUI.uploadScope, undefined);
    assert.equal(f.payload.meta.sliceScale, 4 / 3);
    assert.equal(f.payload.gameUI.optionalFuture.retained, true);
    assert.equal(f.payload.gameUI.assets[f.ref].optionalFuture, true);
    uploaded(f.payload);
    f.exporter.finalize(f.payload, config);
    const asset = f.payload.gameUI.assets[f.ref];
    assert.equal(asset.sourceNodeId, source.id);
    assert.equal(asset.image.url, source.image.imageUrl);
    assert.equal(asset.image.exportScale, 1);
    assert.equal(asset.sampling.filterMode, "Point");
    assert.equal(JSON.stringify(f.metadata), original);
    assert.doesNotMatch(JSON.stringify(f.payload), /pngBase64|uploadScope|authoring/);
    const other = fixture(); await other.exporter.capture(other.payload, config, 55, {});
    assert.equal(other.payload.artboard.layers[1].id, source.id);
    assert.equal(other.payload.artboard.layers[1].gameUI.nodeId, source.gameUI.nodeId);
});
test("unmarked documents keep native payload; marked tests reject production and ambiguous destination", async () => {
    const f = fixture(); delete f.metadata.uploadScope;
    assert.equal(await f.exporter.capture(f.payload, { projectId: "production" }, 55), f.payload);
    assert.equal(f.payload.gameUI, undefined);
    f.metadata.uploadScope = { version: 1, projectId: config.projectId, purpose: "gameui-productionization-test" };
    await assert.rejects(f.exporter.capture(f.payload, { projectId: "production" }, 55), /guard/);
    await assert.rejects(f.exporter.capture(f.payload, { ...config, projectID: "other" }, 55), /guard/);
    assert.equal(f.counts().exports, 0);
});
test("duplicate nodeId and native IDs, unknown versions/capabilities, sampling conflicts reject before mutation/export", async () => {
    const changes = [
        f => { f.metadata.schemaVersion = 2; }, f => { f.metadata.authoring.version = 2; },
        f => { f.metadata.requiredCapabilities.push("future.required"); },
        f => { f.metadata.nodes[13] = { ...f.metadata.nodes[12] }; },
        f => { f.payload.artboard.layers.push({ ...f.payload.artboard.layers[0] }); },
        f => { delete f.metadata.nodes[12].nativeImageUsage; },
        f => { f.metadata.nodes[12].sampling = { filterMode: "Point" }; },
        f => { f.metadata.assets[f.ref].sampling.filterMode = "Trilinear"; },
        f => { f.metadata.requiredCapabilities = ["nineSlice.v1"]; },
        f => { f.metadata.authoring.sources[f.ref].width = 7; },
        f => { f.metadata.authoring.sources[f.ref].pngBase64 = "broken"; },
        f => { delete f.metadata.authoring.sources[f.ref]; },
        f => { f.metadata.authoring.sources.unknown = f.metadata.authoring.sources[f.ref]; },
        f => { f.metadata.nodes[12].nodeId = "12"; },
        f => { f.payload.artboard.layers[0].frame.width = 2; }
    ];
    for (const change of changes) {
        const f = fixture(); change(f); const before = JSON.stringify(f.payload);
        await assert.rejects(f.exporter.capture(f.payload, config, 55));
        assert.equal(f.counts().exports, 0); assert.equal(JSON.stringify(f.payload), before);
    }
});
test("finalize refuses an incomplete native upload, local data leak, duplicates and wrong project", async () => {
    for (const change of [f => {}, f => { uploaded(f.payload); f.payload.gameUI.authoring = {}; },
        f => { uploaded(f.payload); f.payload.artboard.layers[1].gameUI.nodeId = "persistent-instance"; }]) {
        const f = fixture(); await f.exporter.capture(f.payload, config, 55); change(f);
        assert.throws(() => f.exporter.finalize(f.payload, config));
    }
    const f = fixture(); await f.exporter.capture(f.payload, config, 55); uploaded(f.payload);
    assert.throws(() => f.exporter.finalize(f.payload, { projectId: "production" }));
    assert.throws(() => fixture().exporter.finalize(f.payload, config), /not captured/);
    f.payload.artboard.gameUI.artboardId = "other-board";
    assert.throws(() => f.exporter.finalize(f.payload, config), /artboard identity/);
    delete f.payload.gameUI;
    assert.throws(() => f.exporter.finalize(f.payload, config), /metadata is missing/);
});
test("authoring snapshot reuses existing audit source instead of creating a duplicate", async () => {
    const f = fixture();
    f.metadata.nodes[13] = { nodeId: "legacy-source", kind: "resourceSource", assetRef: f.ref };
    f.payload.artboard.layers.push({ id: "13", frame: { width: 8, height: 6 }, image: {} });
    await f.exporter.capture(f.payload, config, 55);
    assert.equal(f.payload.artboard.layers.length, 2); assert.equal(f.counts().exports, 0);
    uploaded(f.payload); f.exporter.finalize(f.payload, config);
    assert.equal(f.payload.gameUI.assets[f.ref].sourceNodeId, "13");
});

test("ordinary XMP failures preserve native behavior; named synthetic drafts and unknown local scope fail closed", async () => {
    const ordinary = fixture(); ordinary.metadata.readError = true;
    assert.equal(await ordinary.exporter.capture(ordinary.payload, config, 55), ordinary.payload);
    assert.equal(ordinary.payload.gameUI, undefined);
    ordinary.payload.artboard.name = "LanhuGameUIFoundation20261116";
    await assert.rejects(ordinary.exporter.capture(ordinary.payload, config, 55), /XMP read failed/);
    const scoped = fixture(); scoped.metadata.uploadScope.version = 2;
    scoped.payload.artboard.name = "LanhuGameUIFoundation20261116";
    await assert.rejects(scoped.exporter.capture(scoped.payload, config, 55), /scope/);
});

test("unmarked native payload cannot register itself as captured by carrying a root gameUI", async () => {
    const f = fixture(); delete f.metadata.uploadScope;
    f.payload.gameUI = f.metadata;
    await f.exporter.capture(f.payload, config, 55);
    assert.throws(() => f.exporter.finalize(f.payload, config), /not captured/);
});

test("transparent target bounds restore full dimensions after moves and preserve the native reference frame", async () => {
    for (const [left, top] of [[102, 202], [402, -18], [102.5, 202.25]]) {
        const f = fixture();
        f.metadata.authoring.targets = { "persistent-instance": {
            width: 128, height: 80, insetLeft: 2, insetTop: 2, contentWidth: 124, contentHeight: 76
        } };
        const layer = f.payload.artboard.layers[0];
        layer.frame = { left, top, width: 124, height: 76, right: left + 124, bottom: top + 76, future: "retained" };
        layer.realFrame = { ...layer.frame };
        const originalFrame = { ...layer.frame }, originalMetadata = JSON.stringify(f.metadata);
        await f.exporter.capture(f.payload, config, 55);
        assert.deepEqual(JSON.parse(JSON.stringify(layer.frame)), { left: left - 2, top: top - 2, width: 128, height: 80,
            right: left + 126, bottom: top + 78, future: "retained" });
        assert.deepEqual(JSON.parse(JSON.stringify(layer.realFrame)), JSON.parse(JSON.stringify(layer.frame)));
        assert.deepEqual(JSON.parse(JSON.stringify(layer.gameUI.nativeReferenceFrame)), originalFrame);
        assert.equal(JSON.stringify(f.metadata), originalMetadata);
        assert.equal(f.payload.gameUI.authoring, undefined);
        assert.equal(f.payload.artboard.layers[1].frame.width, 8, "Source geometry remains independent of target geometry.");
        uploaded(f.payload); f.exporter.finalize(f.payload, config);
        assert.equal(layer.frame.width, 128);
        assert.doesNotMatch(JSON.stringify(f.payload), /insetLeft|contentWidth|authoring|targets/);
    }
});

test("target restoration supports missing realFrame and zero insets, while legacy instances keep their native frame", async () => {
    const f = fixture();
    f.metadata.authoring.targets = { "persistent-instance": {
        width: 20, height: 14, insetLeft: 0, insetTop: 0, contentWidth: 20, contentHeight: 14
    } };
    f.payload.artboard.layers[0].frame = { left: 7, top: 9, width: 20, height: 14 };
    await f.exporter.capture(f.payload, config, 55);
    const layer = f.payload.artboard.layers[0];
    assert.equal(layer.realFrame, undefined);
    assert.equal(layer.frame.left, 7);
    assert.equal(layer.gameUI.nativeReferenceFrame.width, 20);
    const legacy = fixture(), original = legacy.payload.artboard.layers[0].frame;
    await legacy.exporter.capture(legacy.payload, config, 55);
    assert.equal(legacy.payload.artboard.layers[0].frame, original);
    assert.equal(legacy.payload.artboard.layers[0].gameUI.nativeReferenceFrame, undefined);
});

test("invalid or stale target geometry rejects before source export and payload mutation", async () => {
    const changes = [
        f => { f.metadata.authoring.targets = []; },
        f => { f.metadata.authoring.targets.unknown = f.metadata.authoring.targets["persistent-instance"]; },
        f => { f.metadata.authoring.targets["persistent-instance"].width = 0; },
        f => { f.metadata.authoring.targets["persistent-instance"].width = 19; },
        f => { f.metadata.authoring.targets["persistent-instance"].height = 13; },
        f => { f.metadata.authoring.targets["persistent-instance"].insetLeft = -1; },
        f => { f.metadata.authoring.targets["persistent-instance"].insetTop = 0.5; },
        f => { f.metadata.authoring.targets["persistent-instance"].contentWidth = 0; },
        f => { delete f.metadata.authoring.targets["persistent-instance"].contentHeight; },
        f => { f.metadata.authoring.targets["persistent-instance"].width = Number.MAX_SAFE_INTEGER + 1; },
        f => { f.payload.artboard.layers[0].frame.width = 21; },
        f => { f.payload.artboard.layers[0].frame.height = 15; },
        f => { f.payload.artboard.layers[0].frame.left = Infinity; },
        f => { f.payload.artboard.layers[0].realFrame = { ...f.payload.artboard.layers[0].frame, width: 19 }; },
        f => { f.payload.artboard.layers[0].realFrame = { ...f.payload.artboard.layers[0].frame, left: 9 }; },
        f => { f.metadata.nodes[13] = { nodeId: "source-target", kind: "resourceSource", assetRef: f.ref };
            f.metadata.authoring.targets["source-target"] = f.metadata.authoring.targets["persistent-instance"]; }
    ];
    for (const change of changes) {
        const f = fixture();
        f.payload.artboard.layers[0].frame = { left: 10, top: 20, width: 20, height: 14 };
        f.metadata.authoring.targets = { "persistent-instance": {
            width: 22, height: 16, insetLeft: 1, insetTop: 1, contentWidth: 20, contentHeight: 14
        } };
        change(f);
        const before = JSON.stringify(f.payload);
        await assert.rejects(f.exporter.capture(f.payload, config, 55), /target|geometry|reapply/i);
        assert.equal(f.counts().exports, 0);
        assert.equal(JSON.stringify(f.payload), before);
    }
});

test("known damaged GameUI XMP rejects with a repair prompt instead of silently dropping metadata", async () => {
    for (const typed of [true, false]) {
        const f = fixture();
        f.metadata.readError = typed ? true : "syntax";
        if (typed) f.metadata.readErrorCode = "GAMEUI_METADATA_INVALID";
        const before = JSON.stringify(f.payload);
        await assert.rejects(f.exporter.capture(f.payload, config, 55), error => {
            assert.equal(error.code, "GAMEUI_METADATA_INVALID");
            assert.match(error.message, /repair or restore/);
            assert.doesNotMatch(error.message, /parse failed|XMP read failed/);
            return true;
        });
        assert.equal(JSON.stringify(f.payload), before);
        assert.equal(f.counts().exports, 0);
    }
});

function artboardFixture() {
    const f = fixture();
    // A and B share a resource version. A also has an exclusive version.
    delete f.metadata.optionalFuture;
    const exclusive = "test.exclusive@1";
    f.metadata.assets[exclusive] = structuredClone(f.metadata.assets[f.ref]);
    f.metadata.authoring.sources[exclusive] = { ...f.metadata.authoring.sources[f.ref] };
    f.metadata.nodes[15] = { ...f.metadata.nodes[12], nodeId: "exclusive-instance", assetRef: exclusive };
    f.metadata.nodes[22] = { ...f.metadata.nodes[12], nodeId: "second-instance" };
    const board = (id, ...layers) => ({ id, type: "artboardSection", name: "Same name", layers });
    const a = board(101, { id: 10, layers: [{ id: 12 }, { id: 15 }] });
    const b = board(102, { id: 22 });
    const ordinary = board(103, { id: 32, type: "textLayer" }, { id: 33 });
    const document = { id: 55, layers: [a, b, ordinary] };
    function makePayload(board) {
        function format(layer) {
            return { id: String(layer.id), originID: layer.id, name: layer.type || "Layer",
                frame: { left: 10, top: 12, width: 20, height: 14 },
                image: { imageUrl: "https://test.invalid/native-" + layer.id + ".png" },
                layers: (layer.layers || []).map(format) };
        }
        return { meta: { fileName: "Mixed synthetic PSD" }, artboard: { name: board.name,
            id: "cloud-" + board.id, originID: String(board.id), documentMode: "artboard",
            layers: board.layers.map(format) } };
    }
    async function prepare(...boards) {
        const settings = { ...config, selectArtboards: boards.map(({ id }) => ({ id: String(id) })) };
        await f.exporter.prepareAnalysis(document, settings, { id: document.id });
        return (board, payload = makePayload(board)) =>
            f.exporter.capture(payload, settings, document.id, {}, { document, mode: "ArtBoard", board });
    }
    return { ...f, document, a, b, ordinary, exclusive, makePayload, prepare };
}

test("mixed PSD exports only each selected board's marked nodes and asset versions; ordinary boards are unchanged", async () => {
    const f = artboardFixture();
    const originalXmp = JSON.stringify(f.metadata);
    const capture = await f.prepare(f.a, f.b, f.ordinary);
    const ordinary = f.makePayload(f.ordinary), baseline = structuredClone(ordinary);
    assert.equal(await capture(f.ordinary, ordinary), ordinary);
    assert.equal(f.exporter.finalize(ordinary, config), ordinary);
    assert.deepEqual(ordinary, baseline);
    const a = await capture(f.a), b = await capture(f.b);
    assert.equal(f.counts().reads, 1);
    assert.deepEqual(Object.keys(a.gameUI.nodes), ["12", "15"]);
    assert.deepEqual(Object.keys(b.gameUI.nodes), ["22"]);
    assert.deepEqual(Object.keys(a.gameUI.assets).sort(), [f.exclusive, f.ref].sort());
    assert.deepEqual(Object.keys(b.gameUI.assets), [f.ref]);
    assert.equal(a.artboard.layers[0].layers[0].gameUI.assetRef, b.artboard.layers[0].gameUI.assetRef);
    assert.equal(a.gameUI.schemaVersion, 1);
    assert.equal(a.gameUI.documentId, b.gameUI.documentId);
    assert.notEqual(a.gameUI.artboardId, b.gameUI.artboardId);
    assert.equal(a.artboard.gameUI.artboardId, a.gameUI.artboardId);
    assert.equal(b.artboard.gameUI.artboardId, b.gameUI.artboardId);
    const aSource = a.artboard.layers.find(layer => layer.gameUI?.assetRef === f.ref);
    const bSource = b.artboard.layers.find(layer => layer.gameUI?.kind === "resourceSource");
    assert.notEqual(aSource.id, bSource.id);
    assert.notEqual(aSource.gameUI.nodeId, bSource.gameUI.nodeId);
    assert.deepEqual(Buffer.from(aSource.image.bitmap), Buffer.from(bSource.image.bitmap));
    for (const [payload, source] of [[a, aSource], [b, bSource]]) {
        uploaded(payload);
        f.exporter.finalize(payload, config);
        assert.equal(payload.gameUI.assets[f.ref].sourceNodeId, source.id);
        assert.equal(payload.gameUI.assets[f.ref].image.url, source.image.imageUrl);
        assert.equal(payload.gameUI.assets[f.ref].image.exportScale, 1);
        assert.doesNotMatch(JSON.stringify(payload), /pngBase64|authoring|uploadScope/);
    }
    assert.equal(JSON.stringify(f.metadata), originalXmp);
});

test("selecting only the ordinary board ignores unselected asset data; selecting only a marked board preserves its ID after save and reorder", async () => {
    const f = artboardFixture();
    f.metadata.authoring.sources[f.exclusive].pngBase64 = "damaged snapshot in A";
    const captureOrdinary = await f.prepare(f.ordinary);
    const ordinary = f.makePayload(f.ordinary);
    assert.equal(await captureOrdinary(f.ordinary, ordinary), ordinary);
    assert.equal(ordinary.gameUI, undefined);
    await assert.rejects(captureOrdinary(f.a), /selected PSD artboard/);
    const captureB = await f.prepare(f.b);
    const before = await captureB(f.b);
    f.document.id = 88; // Process-local document ID can change when reopened.
    f.b.name = "Renamed";
    f.b.bounds = { left: 950, top: 300, right: 1100, bottom: 400 };
    f.document.layers.reverse();
    const reopened = await (await f.prepare(f.b))(f.b);
    assert.equal(reopened.gameUI.artboardId, before.gameUI.artboardId);
    assert.equal(reopened.artboard.layers.at(-1).gameUI.nodeId, before.artboard.layers.at(-1).gameUI.nodeId);
    assert.equal(reopened.gameUI.nodes[22].nodeId, before.gameUI.nodes[22].nodeId);
    await assert.rejects((await f.prepare(f.a))(f.a), /PNG/);
});

test("the same native board keeps its identity after adding another PSD artboard; a legacy document canvas keeps its scalar ID", async () => {
    const f = artboardFixture();
    const all = f.document.layers;
    f.document.layers = [f.b];
    delete f.metadata.nodes[12]; delete f.metadata.nodes[15];
    const first = await (await f.prepare(f.b))(f.b);
    f.document.layers = all;
    const second = await (await f.prepare(f.b, f.ordinary))(f.b);
    assert.equal(first.gameUI.artboardId, second.gameUI.artboardId);
    const old = fixture(), document = { id: 55, layers: [{ id: 12 }] };
    const settings = { ...config, selectArtboards: [{ id: "55" }] };
    await old.exporter.prepareAnalysis(document, settings, { _id: 55, title: "Legacy canvas.psd" });
    Object.assign(old.payload.artboard, { originID: "55", documentMode: "document" });
    await old.exporter.capture(old.payload, settings, 55, {}, { document, mode: "Background" });
    assert.equal(old.payload.gameUI.artboardId, old.metadata.artboardId);
    assert.equal(old.payload.artboard.layers[1].gameUI.nodeId, "gameui-resource:doc-1:test.soft-edge%401");
});

test("a legacy source in a different PSD artboard is never exported through that board or guessed from its name", async () => {
    const f = artboardFixture();
    delete f.metadata.authoring.sources[f.ref];
    f.metadata.nodes[16] = { nodeId: "source-in-a", kind: "resourceSource", assetRef: f.ref };
    f.a.layers.push({ id: 16 });
    await assert.rejects(f.prepare(f.b), /source snapshot is missing/);
    await assert.rejects(f.prepare(f.a), /source snapshot is missing/);
    assert.equal(f.counts().exports, 0);
});

test("unknown PSD ownership and wrong native scope reject before mutation or source export", async () => {
    for (const change of [
        f => { f.metadata.nodes[99] = f.metadata.nodes[22]; },
        f => { f.document.layers.push({ id: 99 }); f.metadata.nodes[99] = f.metadata.nodes[22]; },
        f => { f.ordinary.layers.push({ id: 12 }); },
        f => { f.metadata.nodes[22].nodeId = f.metadata.nodes[12].nodeId; },
        f => { f.metadata.extensions = { "test.layout": { version: 1 } }; }
    ]) {
        const f = artboardFixture();
        change(f);
        await assert.rejects(f.prepare(f.b), { code: "GAMEUI_UPLOAD_SCOPE" });
        assert.equal(f.counts().exports, 0);
    }
    const f = artboardFixture();
    const capture = await f.prepare(f.a, f.b);
    const wrongPayload = f.makePayload(f.a);
    await assert.rejects(capture(f.b, wrongPayload), /formatted artboard/);
    const movedLayer = f.makePayload(f.b);
    movedLayer.artboard.layers[0].originID = 12;
    await assert.rejects(capture(f.b, movedLayer), /ambiguous origin/);
    const missingLayer = f.makePayload(f.b);
    missingLayer.artboard.layers.length = 0;
    await assert.rejects(capture(f.b, missingLayer), /node was not exported/);
    await assert.rejects(f.exporter.capture(f.makePayload(f.b), config, 55, {}), /verified PSD selection/);
    assert.equal(f.counts().exports, 0);
});

test("native analysis rejects an empty, duplicate, non-artboard or changed selection, including for a legacy canvas", async () => {
    const f = artboardFixture();
    const settings = ids => ({ ...config, selectArtboards: ids.map(id => ({ id })) });
    for (const ids of [[], [101, 101], [101, 33], ["101junk"], [55]]) {
        await assert.rejects(f.exporter.prepareAnalysis(f.document, settings(ids), { id: 55 }), /upload list/);
    }
    await assert.rejects(f.exporter.prepareAnalysis(f.document, settings([101]), { id: 56 }), /active PSD/);
    await assert.rejects(f.exporter.prepareAnalysis(f.document, settings([101, 102]), { id: 55 },
        { documentId: 55, boardIds: ["101", "101"] }), /changed before export/);
    await assert.rejects(f.exporter.prepareAnalysis({ id: 55, layers: [] }, settings([]), { id: 55 }), /upload list/);
    assert.equal(f.counts().reads, 0);
});
