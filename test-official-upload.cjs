"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { config, fixture, png } = require("./test-export-fixtures.cjs");
const officialIndex = process.env.GAMEUI_OFFICIAL_INDEX;
if (!officialIndex) throw new Error("GAMEUI_OFFICIAL_INDEX must point to the pinned original official index.js (read-only).");
const original = fs.readFileSync(officialIndex, "utf8");
assert.equal(crypto.createHash("sha256").update(original).digest("hex"),
    "067760dc58d167e413f60a8d45dc61e97ce670ba3b4564e2b68ef3d9fd594194");

function nativeUploader(exporter, expected, uploads) {
    const start = original.indexOf("70567:function(M,t,e){");
    const end = original.indexOf("},76163:function(M,t,e){", start);
    assert.ok(start > 0 && end > start, "Pinned native uploader module seams");
    let moduleSource = original.slice(start + "70567:".length, end + 1);
    const seam = 'case 4:return s=O.sent(),i({type:r.UploadCallBackType.artboard';
    assert.equal(moduleSource.split(seam).length, 2);
    moduleSource = moduleSource.replace(seam, 'case 4:return s=O.sent(),s=require("./gameui-export.js").finalize(s,e),i({type:r.UploadCallBackType.artboard');
    let finalizations = 0;
    const context = {
        Promise, Uint8Array, console: { log() {}, error() {} },
        btoa: value => Buffer.from(value, "binary").toString("base64"), unescape, encodeURIComponent,
        require(name) {
            assert.equal(name, "./gameui-export.js");
            return { finalize(payload, settings) {
                finalizations++;
                assert.equal(payload, expected, "Actual official uploader preserves the captured root object");
                return exporter.finalize(payload, settings);
            } };
        }
    };
    const factory = vm.runInNewContext("(" + moduleSource + ")", context);
    const result = {};
    factory({}, result, id => {
        if (id === 49992) return { UploadCallBackType: { artboard: "artboard" },
            UploadItemStatusConfig: { uploadOSS: "uploadOSS", success: "success", error: "error" } };
        if (id === 8322) return { ArrayBuffer: { hash: buffer => crypto.createHash("md5").update(Buffer.from(buffer)).digest("hex") } };
        if (id === 76163) return {
            async initUploadToken() { return { url: "https://offline-oss.invalid" }; },
            async uploadToOSS(value, name) {
                uploads.push({ value, name }); return "https://offline-oss.invalid/" + name;
            }
        };
        throw new Error("Unexpected official dependency: " + id);
    });
    return { upload: result.uploadSingleArtboart, finalizations: () => finalizations };
}

test("pinned official uploader traverses injected/nested bitmaps, preserves root identity and serializes v1 without authoring", async () => {
    const f = fixture();
    f.payload.meta.id = "board-native";
    f.payload.artboard.frame = { left: 0, top: 0, width: 80, height: 80 };
    const instance = f.payload.artboard.layers.pop();
    instance.image = { bitmap: Uint8Array.from(png(20, 14)).buffer };
    instance.layers = [];
    instance.frame = { left: 12, top: 22, width: 20, height: 14 };
    f.metadata.authoring.targets = { "persistent-instance": {
        width: 24, height: 18, insetLeft: 2, insetTop: 2, contentWidth: 20, contentHeight: 14
    } };
    f.payload.artboard.layers.push({ id: "group", type: "groupLayer", layers: [instance] });
    await f.exporter.capture(f.payload, config, 55);
    const source = f.payload.artboard.layers[1];
    assert.equal(source.type, "shapeLayer");
    const uploads = [];
    const native = nativeUploader(f.exporter, f.payload, uploads);
    const events = [];
    await new Promise((resolve, reject) => {
        native.upload({ json: f.payload, image: Uint8Array.from(png()).buffer, info: { id: "board-native", name: "test" } },
            { ...config, sizeInfo: { deviceType: "Android", deviceScale: "xxhdpi" } }, event => {
                events.push(event);
                if (event.artboard.code === "success") resolve();
                if (event.artboard.code === "error") reject(new Error(event.artboard.message));
            }).catch(reject);
    });
    assert.equal(native.finalizations(), 1);
    assert.equal(events.at(-1).artboard.code, "success");
    const serialized = uploads.find(entry => entry.name.endsWith(".json"));
    assert.ok(serialized);
    const cloud = JSON.parse(serialized.value);
    assert.equal(cloud.gameUI.schemaVersion, 1);
    assert.equal(cloud.gameUI.assets[f.ref].sourceNodeId, source.id);
    assert.equal(cloud.gameUI.assets[f.ref].image.url, source.image.imageUrl);
    assert.equal(cloud.gameUI.assets[f.ref].image.exportScale, 1);
    assert.deepEqual(Buffer.from(uploads.find(entry => entry.name === source.image.imageUrl.split("/").at(-1)).value), png());
    assert.ok(cloud.assets.includes(source.image.imageUrl));
    assert.ok(cloud.assets.includes(instance.image.imageUrl));
    const cloudInstance = cloud.artboard.layers[0].layers[0];
    assert.deepEqual(cloudInstance.frame, { left: 10, top: 20, width: 24, height: 18 });
    assert.deepEqual(cloudInstance.gameUI.nativeReferenceFrame, { left: 12, top: 22, width: 20, height: 14 });
    assert.doesNotMatch(serialized.value, /pngBase64|uploadScope|authoring|bitmap/);
});
