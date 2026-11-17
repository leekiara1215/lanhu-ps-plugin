"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { generate, crc32, sourcePixels, renderBilinear, composite, border, sha256 } =
    require("./Fixtures/generate-production-fixtures.cjs");
const { renderNineSlice } = require("./gameui-core.js");

function decodeFixturePng(bytes) {
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    let width, height;
    const parts = [], types = [];
    for (let offset = 8; offset < bytes.length;) {
        const length = bytes.readUInt32BE(offset);
        const type = bytes.toString("ascii", offset + 4, offset + 8);
        const payload = bytes.subarray(offset + 8, offset + 8 + length);
        assert.equal(bytes.readUInt32BE(offset + 8 + length), crc32(bytes.subarray(offset + 4, offset + 8 + length)));
        types.push(type);
        if (type === "IHDR") {
            width = payload.readUInt32BE(0); height = payload.readUInt32BE(4);
            assert.deepEqual([...payload.subarray(8)], [8, 6, 0, 0, 0]);
        }
        if (type === "IDAT") parts.push(payload);
        offset += length + 12;
    }
    assert.deepEqual(types, ["IHDR", "IDAT", "IEND"]);
    const scanlines = zlib.inflateSync(Buffer.concat(parts));
    assert.equal(scanlines.length, height * (width * 4 + 1));
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        assert.equal(scanlines[y * (width * 4 + 1)], 0);
        scanlines.copy(pixels, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
    }
    return { width, height, pixels };
}

test("fixture package reproduces exact PNG bytes, raw pixels, manifests and two explicit material lists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gameui-synthetic-"));
    try {
        const first = path.join(root, "a"), second = path.join(root, "b");
        const manifest = generate(first);
        assert.deepEqual(generate(second), manifest);
        assert.deepEqual(manifest.documents.map(doc => doc.name),
            ["LanhuGameUIProductionFirst20261117", "LanhuGameUIProductionSecond20261117"]);
        assert.equal(manifest.assets.length, 3);
        assert.equal(manifest.files.length, 39);
        const expected = JSON.parse(fs.readFileSync(path.join(__dirname, "Fixtures/expected-materials.json"), "utf8"));
        assert.deepEqual({ fixtureVersion: manifest.fixtureVersion, assets: manifest.assets.map(asset => ({
            resourceKey: asset.key, sourceSize: asset.sourceSize, nineSlice: asset.nineSlice, sampling: asset.sampling,
            source: asset.source, references: asset.references.map(reference => ({ width: reference.width,
                height: reference.height, pointReference: reference.pointReference,
                bilinearReference: reference.bilinearReference }))
        })), documents: manifest.documents }, expected, "Changing frozen materials requires reviewing the expected list.");
        for (const file of fs.readdirSync(first)) assert.deepEqual(fs.readFileSync(path.join(first, file)),
            fs.readFileSync(path.join(second, file)), file);
        for (const image of manifest.files) {
            const bytes = fs.readFileSync(path.join(first, image.stem + ".png"));
            const raw = fs.readFileSync(path.join(first, image.stem + ".rgba"));
            const decoded = decodeFixturePng(bytes);
            assert.deepEqual([decoded.width, decoded.height], [image.width, image.height]);
            assert.deepEqual(decoded.pixels, raw);
            assert.equal(sha256(raw), image.rgbaSha256);
            assert.equal(sha256(bytes), image.pngSha256);
        }
        for (const doc of manifest.documents) {
            assert.equal(doc.layers.length, 12);
            assert.equal(doc.layers.filter(layer => layer.role === "instance").length, 9);
            assert.equal(new Set(doc.layers.map(layer => layer.name)).size, 12);
            for (const layer of doc.layers) {
                assert.ok(layer.left + layer.width <= doc.width && layer.top + layer.height <= doc.height);
                assert.equal(fs.readFileSync(path.join(first, layer.file)).length, layer.width * layer.height * 4);
            }
        }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Point oracle preserves every asymmetric corner and independently calculated center texels", () => {
    assert.equal(new Set([border.left, border.top, border.right, border.bottom]).size, 4);
    const source = sourcePixels("asymmetric-point");
    for (const [width, height] of [[128, 80], [192, 96], [96, 128]]) {
        const result = renderNineSlice(source, 64, 48, border, width, height);
        for (const [sx0, sy0, tx0, ty0, cw, ch] of [
            [0, 0, 0, 0, 7, 5], [53, 0, width - 11, 0, 11, 5],
            [0, 39, 0, height - 9, 7, 9], [53, 39, width - 11, height - 9, 11, 9]
        ]) for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
            assert.deepEqual(result.slice(((ty0 + y) * width + tx0 + x) * 4, ((ty0 + y) * width + tx0 + x) * 4 + 4),
                source.slice(((sy0 + y) * 64 + sx0 + x) * 4, ((sy0 + y) * 64 + sx0 + x) * 4 + 4));
        }
        // At center start: src center is 46x34, destination center excludes 18x14 border pixels.
        for (const [x, y] of [[7, 5], [width - 12, height - 10], [Math.floor(width / 2), Math.floor(height / 2)]]) {
            const sx = 7 + Math.floor((2 * (x - 7) + 1) * 46 / (2 * (width - 18)));
            const sy = 5 + Math.floor((2 * (y - 5) + 1) * 34 / (2 * (height - 14)));
            assert.deepEqual(result.slice((y * width + x) * 4, (y * width + x) * 4 + 4),
                source.slice((sy * 64 + sx) * 4, (sy * 64 + sx) * 4 + 4));
        }
    }
});

test("transparent rim and soft gradient retain alpha, with black and white composite references", () => {
    for (const key of ["transparent-point", "soft-bilinear"]) {
        const pixels = sourcePixels(key);
        const alpha = new Set();
        for (let i = 3; i < pixels.length; i += 4) alpha.add(pixels[i]);
        assert.ok(alpha.has(0) && alpha.has(255));
        assert.ok(alpha.size >= (key === "soft-bilinear" ? 6 : 3));
        assert.equal(pixels[(1 * 64 + 20) * 4 + 3], 0);
        const black = composite(pixels, 0), white = composite(pixels, 255);
        assert.deepEqual([...black.subarray(0, 4)], [0, 0, 0, 255]);
        assert.deepEqual([...white.subarray(0, 4)], [255, 255, 255, 255]);
        for (let i = 0; i < pixels.length; i += 4) {
            assert.equal(black[i + 3], 255);
            assert.equal(white[i + 3], 255);
            assert.ok(white[i] >= black[i]);
            if (pixels[i + 3] === 255) assert.equal(black[i], pixels[i]);
        }
    }
});

test("Bilinear oracle has a known interpolation result and is separate from sharp Point references", () => {
    const pixels = new Uint8Array([0, 20, 40, 60, 100, 120, 140, 160]);
    const smooth = renderBilinear(pixels, 2, 1, { left: 0, top: 0, right: 0, bottom: 0 }, 4, 1);
    assert.deepEqual([...smooth], [0, 20, 40, 60, 25, 45, 65, 85, 75, 95, 115, 135, 100, 120, 140, 160]);
    const seam = renderBilinear(new Uint8Array([200, 0, 0, 255, 0, 0, 0, 255,
        0, 0, 0, 255, 100, 0, 0, 255]), 4, 1,
        { left: 1, top: 0, right: 1, bottom: 0 }, 6, 1);
    assert.equal(seam[4], 50, "First stretched texel must blend with the left border, not clamp to center.");
    assert.equal(seam[16], 25, "Last stretched texel must blend with the right border.");
    const source = sourcePixels("soft-bilinear");
    assert.deepEqual(renderBilinear(source, 64, 48, border, 64, 48), source);
    assert.notDeepEqual(renderBilinear(source, 64, 48, border, 128, 80),
        renderNineSlice(source, 64, 48, border, 128, 80));
});

test("PSD preparation is explicitly synthetic, preserves existing documents and never marks XMP", () => {
    const script = fs.readFileSync(path.join(__dirname, "Fixtures/create-production-documents.psjs"), "utf8");
    assert.ok(script.includes('panelAcceptance: "pending"'));
    assert.ok(script.includes('overwrite: false'));
    assert.doesNotMatch(script, /writeMetadata|XMPMeta|setXmp|\.close\(|\.upload\(/);
    assert.ok(script.includes("LanhuGameUIProductionFirst20261117"));
    assert.ok(script.includes("LanhuGameUIProductionSecond20261117"));
});
