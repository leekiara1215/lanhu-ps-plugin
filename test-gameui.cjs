"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { renderNineSlice } = require("./gameui-core.js");
const border = { left: 2, top: 2, right: 2, bottom: 2 };
const fs = require("node:fs");
const vm = require("node:vm");

function sourceExporter(doc) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(__dirname + "/gameui-ps.js", "utf8"), {
        module, console, Uint8Array, DataView,
        require(name) {
            if (name === "photoshop") return { app: { activeDocument: doc } };
            if (name === "uxp") return { xmp: { XMPMeta: { registerNamespace() {} } } };
            throw new Error("Unexpected dependency " + name);
        }
    });
    return module.exports;
}

test("source export uses 1x and plain pixel bounds, rejecting incorrect native PNGs", async () => {
    const bounds = {};
    for (const [key, value] of Object.entries({ left: 32, top: 40, right: 160, bottom: 104 })) {
        Object.defineProperty(bounds, key, { get() { return value; } });
    }
    const module = sourceExporter({ id: 44, width: 640, height: 560, layers: [{ id: 2, boundsNoEffects: bounds }] });
    const png = new ArrayBuffer(33);
    const bytes = new Uint8Array(png);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    const view = new DataView(png);
    view.setUint32(12, 0x49484452);
    view.setUint32(16, 128);
    view.setUint32(20, 64);
    bytes[24] = 8;
    bytes[25] = 6;
    let calls = 0;
    const formatter = { async exportSlice(id, scale, crop, board) {
        calls++;
        assert.equal(id, 2);
        assert.equal(scale, 1);
        assert.deepEqual(Object.keys(crop).sort(), ["bottom", "left", "right", "top"]);
        assert.equal(crop.left, 32);
        assert.equal(board.width, 640);
        return png;
    } };
    assert.equal(await module.exportSourcePng(formatter, 44, 2, { width: 128, height: 64 }), png);
    // Lanhu's manifest selects Photoshop API 1, where native objects expose _id
    // and groups expose children. Standalone .psjs scripts use the newer DOM.
    const legacy = sourceExporter({ _id: 44, width: 640, height: 560,
        layers: [{ _id: 9, children: [{ _id: 2, boundsNoEffects: bounds }] }] });
    assert.equal(await legacy.exportSourcePng(formatter, 44, 2, { width: 128, height: 64 }), png);
    view.setUint32(16, 171);
    await assert.rejects(module.exportSourcePng(formatter, 44, 2, { width: 128, height: 64 }), /expected 1x/);
    await assert.rejects(module.exportSourcePng(formatter, 45, 2, { width: 128, height: 64 }), /original document/);
    assert.equal(calls, 3);
});

function exporter(metadata, exports = []) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(__dirname + "/gameui-export.js", "utf8"), {
        module, console: { log() {} },
        require(name) {
            if (name === "./gameui-ps.js") return {
                async readMetadata() { return { metadata }; },
                async exportSourcePng(formatter, documentId, layerId, size) {
                    exports.push({ formatter, documentId, layerId, size });
                    return new ArrayBuffer(33);
                }
            };
            if (name === "./gameui-core.js") return require(name);
            throw new Error("Unexpected dependency " + name);
        }
    });
    return module.exports;
}

test("native payload without meta.fileName still captures XMP by its artboard name", async () => {
    const assetRef = "audit.button.primary@1";
    const metadata = { schemaVersion: 1, documentId: "document", artboardId: "board", nodes: {
        2: { nodeId: "source", kind: "resourceSource", assetRef },
        3: { nodeId: "instance", kind: "image", assetRef, renderMode: "nineSlice", nativeImageUsage: "validationReference" }
    }, assets: { [assetRef]: { sourceSize: { width: 128, height: 64 },
        nineSlice: { left: 24, top: 20, right: 24, bottom: 20 } } } };
    const payload = { meta: { sliceScale: 4 / 3 }, artboard: { name: "LanhuGameUIFoundation20261116", layers: [
        { id: "2", originID: "2", frame: { width: 128, height: 64 }, image: { imageUrl: "https://exports.example.test/source.png" } },
        { id: "3", originID: "3", frame: { width: 240, height: 96 }, image: { imageUrl: "https://exports.example.test/preview.png" } }
    ] } };
    const exports = [];
    const module = exporter(metadata, exports);
    const config = { projectId: "cfea1199-7c07-48d9-86ef-cdbd3385c237" };
    await module.capture(payload, config, 44, "native-formatter");
    assert.deepEqual(exports, [{ formatter: "native-formatter", documentId: 44, layerId: 2,
        size: metadata.assets[assetRef].sourceSize }]);
    assert.equal(payload.artboard.layers[0].image.gameUISourceExportScale, 1);
    assert.equal(payload.artboard.layers[1].image.gameUISourceExportScale, undefined);
    assert.equal(payload.meta.sliceScale, 4 / 3, "Panel setting and ordinary exports must retain their scale.");
    payload.artboard.layers[0].image.imageUrl = "https://exports.example.test/source-1x.png";
    delete payload.artboard.layers[0].image.bitmap;
    module.finalize(payload, config);
    assert.equal(payload.gameUI.documentId, "document");
    assert.equal(payload.gameUI.assets[assetRef].sourceNodeId, "2");
    assert.equal(payload.gameUI.assets[assetRef].image.url, payload.artboard.layers[0].image.imageUrl);
    assert.equal(payload.gameUI.assets[assetRef].image.exportScale, 1);
    assert.equal(payload.artboard.layers[1].gameUI.nodeId, "instance");
    await assert.rejects(module.capture(payload, { projectId: "production-project" }, 44));
    assert.equal(exports.length, 1, "Wrong destination must fail before source export.");
});

test("large previews retain every corner texel and fill the full target", () => {
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) pixels.set([i, 255 - i, 100, 255], i * 4);
    for (const [width, height] of [[24, 8], [36, 8], [24, 16]]) {
        const target = renderNineSlice(pixels, 8, 8, border, width, height);
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 2; x++) {
                for (const [sx, sy, tx, ty] of [
                    [x, y, x, y], [6 + x, y, width - 2 + x, y],
                    [x, 6 + y, x, height - 2 + y], [6 + x, 6 + y, width - 2 + x, height - 2 + y]
                ]) {
                    assert.deepEqual(target.slice((ty * width + tx) * 4, (ty * width + tx) * 4 + 4),
                        pixels.slice((sy * 8 + sx) * 4, (sy * 8 + sx) * 4 + 4));
                }
            }
        }
        for (let i = 3; i < target.length; i += 4) assert.equal(target[i], 255);
        assert.equal(pixels[0], 0, "Rendering must not alter the source buffer.");
    }
});

test("sampling remains on each shared resource through capture and finalization", async () => {
    const metadata = { schemaVersion: 1, documentId: "sampling-document", artboardId: "sampling-board",
        requiredCapabilities: ["nineSlice.v1", "sampling.v1"], nodes: {}, assets: {} };
    const payload = { meta: { sliceScale: 4 / 3 }, artboard: { name: "LanhuGameUIFoundation20261116", layers: [] } };
    for (const [index, mode] of ["Point", "Bilinear"].entries()) {
        const assetRef = "audit.sampling." + mode + "@1";
        metadata.assets[assetRef] = { sampling: { filterMode: mode }, sourceSize: { width: 128, height: 64 },
            nineSlice: { left: 24, top: 20, right: 24, bottom: 20 } };
        for (const kind of ["resourceSource", "image"]) {
            const id = String(index * 2 + (kind === "resourceSource" ? 1 : 2));
            metadata.nodes[id] = { nodeId: "stable-" + id, kind, assetRef, renderMode: "nineSlice", nativeImageUsage: "validationReference" };
            payload.artboard.layers.push({ id, frame: { width: kind === "image" ? 240 : 128, height: 64 },
                image: { imageUrl: "https://exports.example.test/" + id + ".png" } });
        }
    }
    const exports = [];
    const module = exporter(metadata, exports);
    const config = { projectId: "cfea1199-7c07-48d9-86ef-cdbd3385c237" };
    await module.capture(payload, config, 44, "formatter");
    for (const layer of payload.artboard.layers) {
        if (layer.gameUI.kind === "resourceSource") {
            layer.image.imageUrl = "https://exports.example.test/1x-" + layer.id + ".png";
            delete layer.image.bitmap;
        }
        assert.equal(layer.gameUI.sampling, undefined, "Instances inherit the shared resource contract.");
    }
    module.finalize(payload, config);
    assert.equal(exports.length, 2);
    for (const mode of ["Point", "Bilinear"]) {
        const asset = payload.gameUI.assets["audit.sampling." + mode + "@1"];
        assert.equal(asset.sampling.filterMode, mode);
        assert.equal(asset.image.exportScale, 1);
    }
    metadata.assets["audit.sampling.Point@1"].sampling.filterMode = "Trilinear";
    await assert.rejects(module.capture(payload, config, 44, "formatter"), /Point or Bilinear/);
    metadata.assets["audit.sampling.Point@1"].sampling.filterMode = "Point";
    metadata.requiredCapabilities = ["nineSlice.v1"];
    await assert.rejects(module.capture(payload, config, 44, "formatter"), /sampling.v1/);
    metadata.requiredCapabilities.push("sampling.v1");
    metadata.nodes["2"].sampling = { filterMode: "Bilinear" };
    await assert.rejects(module.capture(payload, config, 44, "formatter"), /shared resource/);
    assert.equal(exports.length, 2, "Invalid sampling must fail before another source export.");
});

test("undersized targets, overlapping borders and fractional pixels are rejected", () => {
    const pixels = new Uint8Array(8 * 8 * 4);
    assert.throws(() => renderNineSlice(pixels, 8, 8, border, 3, 8));
    assert.throws(() => renderNineSlice(pixels, 8, 8, { ...border, left: 6 }, 24, 8));
    assert.throws(() => renderNineSlice(pixels, 8, 8, { ...border, top: 1.5 }, 24, 8));
});
