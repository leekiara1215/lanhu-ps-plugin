"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const zlib = require("node:zlib");
const config = { projectId: "cfea1199-7c07-48d9-86ef-cdbd3385c237" };
function chunk(type, data) {
    const value = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of value) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, value, checksum]);
}
function png(width = 8, height = 6, options = {}) {
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
    header[8] = 8; header[9] = options.color === undefined ? 6 : options.color;
    const rows = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) for (let x = 1; x < width * 4 + 1; x++) rows[y * (width * 4 + 1) + x] = (x * 31 + y * 7) & 255;
    if (options.filter) rows[0] = options.filter;
    const deflated = options.stream || zlib.deflateSync(rows, options.zlib || {});
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflated), chunk("IEND", Buffer.alloc(0))]);
}
function fixture() {
    const ref = "test.soft-edge@1";
    const snapshot = { width: 8, height: 6, pngBase64: png().toString("base64") };
    const metadata = { schemaVersion: 1, documentId: "doc-1", artboardId: "board-1",
        uploadScope: { version: 1, projectId: config.projectId, purpose: "gameui-productionization-test" },
        authoring: { version: 1, sources: { [ref]: snapshot } },
        requiredCapabilities: ["nineSlice.v1", "sampling.v1"], optionalFuture: { retained: true },
        nodes: { 12: { nodeId: "persistent-instance", kind: "image", assetRef: ref, renderMode: "nineSlice", nativeImageUsage: "validationReference" } },
        assets: { [ref]: { sourceSize: { width: 8, height: 6 },
            nineSlice: { left: 1, top: 2, right: 3, bottom: 1, unit: "sourcePixel", center: "stretch" },
            sampling: { filterMode: "Point" }, optionalFuture: true } } };
    const payload = { meta: { sliceScale: 4 / 3 }, artboard: { name: "Explicit synthetic test", layers: [
        { id: "12", originID: 12, frame: { width: 20, height: 14 }, image: { imageUrl: "https://test.invalid/preview.png" } }
    ] } };
    let reads = 0, exports = 0;
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(__dirname + "/gameui-export.js", "utf8"), {
        module, require(name) {
            if (name === "./gameui-core.js") return require(name);
            if (name === "./gameui-ps.js") return {
                async readMetadata() {
                    reads++;
                    if (metadata.readError) {
                        const error = metadata.readError === "syntax" ? new SyntaxError("XMP parse failed") : new Error("XMP read failed");
                        if (metadata.readErrorCode) error.code = metadata.readErrorCode;
                        throw error;
                    }
                    return { metadata };
                },
                async exportSourcePng() { exports++; return png().buffer; }
            };
            throw new Error(name);
        }
    });
    return { ref, metadata, payload, exporter: module.exports, counts: () => ({ reads, exports }) };
}
function uploaded(payload) {
    for (const layer of payload.artboard.layers) if (layer.image.bitmap) {
        layer.image.imageUrl = "https://test.invalid/official-upload-" + encodeURIComponent(layer.id) + ".png";
        delete layer.image.bitmap;
    }
}

module.exports = { config, fixture, uploaded, png, chunk };
