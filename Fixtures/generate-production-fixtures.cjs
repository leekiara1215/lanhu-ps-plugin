"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { renderNineSlice } = require("../gameui-core.js");

const border = { left: 7, top: 5, right: 11, bottom: 9, unit: "sourcePixel", center: "stretch" };
const definitions = [
    { key: "asymmetric-point", name: "Synthetic asymmetric corners", filterMode: "Point" },
    { key: "transparent-point", name: "Synthetic transparent rim", filterMode: "Point" },
    { key: "soft-bilinear", name: "Synthetic soft shadow", filterMode: "Bilinear" }
];
const sizes = [[128, 80], [192, 96], [96, 128]];
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function png(width, height, rgba) {
    function chunk(type, data) {
        const body = Buffer.concat([Buffer.from(type), data]);
        const result = Buffer.alloc(body.length + 8);
        result.writeUInt32BE(data.length);
        body.copy(result, 4);
        result.writeUInt32BE(crc32(body), result.length - 4);
        return result;
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const rows = Buffer.alloc(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4))
        .copy(rows, y * (width * 4 + 1) + 1);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
        chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function sourcePixels(key) {
    const width = 64, height = 48;
    const data = new Uint8Array(width * height * 4);
    const colors = [[237, 51, 69], [37, 174, 93], [47, 91, 231],
        [238, 163, 31], [157, 65, 207], [26, 173, 197],
        [193, 73, 117], [103, 151, 43], [94, 81, 61]];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const col = x < border.left ? 0 : x >= width - border.right ? 2 : 1;
            const row = y < border.top ? 0 : y >= height - border.bottom ? 2 : 1;
            const distance = Math.min(x, y, width - 1 - x, height - 1 - y);
            let color = colors[row * 3 + col];
            let alpha = 255;
            if (key === "transparent-point") alpha = distance < 2 ? 0 : distance === 2 ? 96 : 255;
            if (key === "soft-bilinear") {
                const t = Math.max(0, Math.min(1, (distance - 1) / 6));
                alpha = Math.round(255 * t * t * (3 - 2 * t));
                color = [43 + x * 2, 74 + y * 2, 164];
            } else {
                // Distinct corner texels expose swaps, mirrored axes and off-by-one borders.
                color = color.map((value, channel) => Math.min(255, value + (x * 3 + y * 5 + channel) % 13));
            }
            data.set([...(alpha === 0 ? [0, 0, 0] : color), alpha], (y * width + x) * 4);
        }
    }
    return data;
}

// CPU diagnostic: top-left RGBA8, texel centers, clamp to the whole texture,
// no mipmaps/compression, interpolation in stored channel space, no compositing.
// It is not an assertion about a GPU's color space, blend state or rounding.
function renderBilinear(pixels, width, height, slice, targetWidth, targetHeight) {
    function coordinate(p, sourceSize, targetSize, before, after) {
        if (p < before) return p;
        if (p >= targetSize - after) return sourceSize - targetSize + p;
        return before + (p - before + 0.5) * (sourceSize - before - after) /
            (targetSize - before - after) - 0.5;
    }
    const result = new Uint8Array(targetWidth * targetHeight * 4);
    for (let y = 0; y < targetHeight; y++) {
        const sy = coordinate(y, height, targetHeight, slice.top, slice.bottom);
        const y0 = Math.floor(sy), fy = sy - y0;
        for (let x = 0; x < targetWidth; x++) {
            const sx = coordinate(x, width, targetWidth, slice.left, slice.right);
            const x0 = Math.floor(sx), fx = sx - x0;
            for (let c = 0; c < 4; c++) {
                let value = 0;
                for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
                    const px = Math.max(0, Math.min(width - 1, x0 + dx));
                    const py = Math.max(0, Math.min(height - 1, y0 + dy));
                    value += pixels[(py * width + px) * 4 + c] * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
                }
                result[(y * targetWidth + x) * 4 + c] = Math.round(value);
            }
        }
    }
    return result;
}

function composite(rgba, background) {
    const out = new Uint8Array(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
        for (let c = 0; c < 3; c++) out[i + c] = Math.round((rgba[i + c] * rgba[i + 3] +
            background * (255 - rgba[i + 3])) / 255);
        out[i + 3] = 255;
    }
    return out;
}

function generate(output) {
    fs.mkdirSync(output, { recursive: true });
    const files = [];
    function writeImage(stem, width, height, pixels) {
        const encoded = png(width, height, pixels);
        fs.writeFileSync(path.join(output, stem + ".png"), encoded);
        fs.writeFileSync(path.join(output, stem + ".rgba"), pixels);
        files.push({ stem, width, height, rgbaSha256: sha256(pixels), pngSha256: sha256(encoded) });
        return { png: stem + ".png", rgba: stem + ".rgba", rgbaSha256: sha256(pixels) };
    }
    const assets = definitions.map(definition => {
        const pixels = sourcePixels(definition.key);
        const source = writeImage(definition.key + "-source", 64, 48, pixels);
        const references = sizes.map(([width, height]) => {
            const point = renderNineSlice(pixels, 64, 48, border, width, height);
            const smooth = renderBilinear(pixels, 64, 48, border, width, height);
            const stem = definition.key + "-" + width + "x" + height;
            const pointReference = writeImage(stem + "-point", width, height, point);
            const bilinearReference = writeImage(stem + "-bilinear", width, height, smooth);
            const selected = definition.filterMode === "Point" ? point : smooth;
            return { width, height, pointReference, bilinearReference,
                blackComposite: writeImage(stem + "-black", width, height, composite(selected, 0)),
                whiteComposite: writeImage(stem + "-white", width, height, composite(selected, 255)) };
        });
        return { ...definition, sourceSize: { width: 64, height: 48 }, nineSlice: { ...border },
            sampling: { filterMode: definition.filterMode }, source, references };
    });
    const documents = ["LanhuGameUIProductionFirst20261117", "LanhuGameUIProductionSecond20261117"]
        .map((name, index) => ({ name, width: 900, height: 700, expectedResourceCount: 3, expectedInstanceCount: 9,
            expectedDocumentIdentity: "assign-once-in-panel-" + (index + 1),
            layers: assets.flatMap((asset, column) => [
                { name: "SyntheticSource-" + asset.key, resourceKey: asset.key, role: "authoring-input",
                    file: asset.source.rgba, width: 64, height: 48, left: 32 + column * 280, top: 32 },
                ...asset.references.map((reference, row) => ({
                    name: "SyntheticInstance-" + asset.key + "-" + reference.width + "x" + reference.height,
                    resourceKey: asset.key, role: "instance", file: (asset.filterMode === "Point" ?
                        reference.pointReference : reference.bilinearReference).rgba,
                    width: reference.width, height: reference.height, left: 32 + column * 280,
                    top: 140 + row * 170
                }))
            ]) }));
    const manifest = { fixtureVersion: 1, syntheticOnly: true,
        testProjectId: "cfea1199-7c07-48d9-86ef-cdbd3385c237",
        identityPolicy: "resourceKey is a fixture label, never an assetRef; record panel-assigned identities separately",
        referenceModel: "RGBA8 stored-space CPU; texel centers; full-texture clamp; no mipmaps, compression or GPU blend",
        assets, documents, files };
    fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
}

if (require.main === module) {
    const output = path.resolve(process.argv[2] || path.join(__dirname, "generated"));
    const relative = path.relative(__dirname, output);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Output must stay inside Fixtures; copy verified materials to an audit directory separately.");
    }
    const result = generate(output);
    process.stdout.write(JSON.stringify({ output, assets: result.assets.length,
        documents: result.documents.length, images: result.files.length }) + "\n");
}

module.exports = { generate, png, crc32, sourcePixels, renderBilinear, composite, border, sha256 };
