"use strict";

function validateNineSlice(width, height, border) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new Error("Source dimensions must be positive integer pixels.");
    }
    if (!border || typeof border !== "object" ||
        (border.unit !== undefined && border.unit !== "sourcePixel") ||
        (border.center !== undefined && border.center !== "stretch")) {
        throw new Error("Unsupported nine-slice unit or center mode.");
    }
    for (const side of ["left", "top", "right", "bottom"]) {
        if (!Number.isInteger(border[side]) || border[side] < 0) {
            throw new Error("Invalid nine-slice border: " + side);
        }
    }
    if (border.left + border.right >= width || border.top + border.bottom >= height) {
        throw new Error("Nine-slice border leaves no stretchable center.");
    }
}

function renderNineSlice(pixels, width, height, border, targetWidth, targetHeight) {
    validateNineSlice(width, height, border);
    if (pixels.length !== width * height * 4 || !Number.isInteger(targetWidth) ||
        !Number.isInteger(targetHeight) || targetWidth < border.left + border.right ||
        targetHeight < border.top + border.bottom) {
        throw new Error("Invalid RGBA data or target dimensions.");
    }
    const result = new Uint8Array(targetWidth * targetHeight * 4);
    function sourceCoordinate(position, sourceSize, targetSize, before, after) {
        if (position < before) return position;
        if (position >= targetSize - after) return sourceSize - (targetSize - position);
        return before + Math.min(sourceSize - before - after - 1,
            Math.floor((position - before + 0.5) * (sourceSize - before - after) /
                (targetSize - before - after)));
    }
    for (let y = 0; y < targetHeight; y++) {
        const sy = sourceCoordinate(y, height, targetHeight, border.top, border.bottom);
        for (let x = 0; x < targetWidth; x++) {
            const sx = sourceCoordinate(x, width, targetWidth, border.left, border.right);
            const from = (sy * width + sx) * 4;
            const to = (y * targetWidth + x) * 4;
            result.set(pixels.subarray(from, from + 4), to);
        }
    }
    return result;
}

function createId() {
    return "g-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function validateSampling(sampling) {
    if (sampling === undefined) return "Bilinear";
    if (!sampling || (sampling.filterMode !== "Point" && sampling.filterMode !== "Bilinear")) {
        throw new Error("GameUI sampling.filterMode must be Point or Bilinear.");
    }
    return sampling.filterMode;
}

module.exports = { validateNineSlice, renderNineSlice, createId, validateSampling };

// UXP has no Node zlib dependency. Bound inflation to the declared RGBA scanlines.
function inflatePng(data, expected) {
    function fail() { throw new Error("Invalid PNG deflate stream."); }
    if (data.length < 6 || (data[0] & 15) !== 8 || (data[0] >>> 4) > 7 ||
        ((data[0] << 8) + data[1]) % 31 || (data[1] & 32)) fail();
    let bit = 16;
    function read(count) {
        if (bit + count > (data.length - 4) * 8) fail();
        let value = 0;
        for (let i = 0; i < count; i++, bit++) value |= ((data[bit >>> 3] >>> (bit & 7)) & 1) << i;
        return value;
    }
    function tree(lengths) {
        const counts = new Uint16Array(16), next = new Uint16Array(16), tables = [];
        for (const length of lengths) { if (length > 15) fail(); counts[length]++; }
        let code = 0;
        for (let size = 1; size <= 15; size++) {
            code = (code + (size === 1 ? 0 : counts[size - 1])) << 1;
            if (code + counts[size] > (1 << size)) fail();
            next[size] = code;
            tables[size] = new Map();
        }
        lengths.forEach((size, symbol) => {
            if (!size) return;
            let canonical = next[size]++, reversed = 0;
            for (let i = 0; i < size; i++) { reversed = (reversed << 1) | (canonical & 1); canonical >>>= 1; }
            tables[size].set(reversed, symbol);
        });
        return tables;
    }
    function symbol(tables) {
        let code = 0;
        for (let size = 1; size <= 15; size++) {
            code |= read(1) << (size - 1);
            if (tables[size].has(code)) return tables[size].get(code);
        }
        fail();
    }
    const lengthBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    const lengthExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    const distanceBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
    const distanceExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
    const output = new Uint8Array(expected);
    let used = 0, final = 0;
    function put(value) { if (used >= expected) fail(); output[used++] = value; }
    while (!final) {
        final = read(1);
        const type = read(2);
        if (type === 0) {
            bit = (bit + 7) & ~7;
            const length = read(16);
            if ((length ^ read(16)) !== 65535) fail();
            for (let i = 0; i < length; i++) put(read(8));
            continue;
        }
        let literals, distances;
        if (type === 1) {
            literals = tree(Array.from({ length: 288 }, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8));
            distances = tree(new Array(32).fill(5));
        } else if (type === 2) {
            const nl = read(5) + 257, nd = read(5) + 1, nc = read(4) + 4;
            if (nl > 286) fail();
            // RFC 1951 code-length alphabet order.
            const alphabet = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
            const codeLengths = new Array(19).fill(0);
            for (let i = 0; i < nc; i++) codeLengths[alphabet[i]] = read(3);
            const codes = tree(codeLengths), lengths = [];
            while (lengths.length < nl + nd) {
                const code = symbol(codes);
                if (code < 16) { lengths.push(code); continue; }
                if (code === 16 && !lengths.length) fail();
                const count = code === 16 ? read(2) + 3 : code === 17 ? read(3) + 3 : read(7) + 11;
                const value = code === 16 ? lengths[lengths.length - 1] : 0;
                if (lengths.length + count > nl + nd) fail();
                for (let i = 0; i < count; i++) lengths.push(value);
            }
            if (!lengths[256]) fail();
            literals = tree(lengths.slice(0, nl)); distances = tree(lengths.slice(nl));
        } else fail();
        for (;;) {
            const code = symbol(literals);
            if (code === 256) break;
            if (code < 256) { put(code); continue; }
            if (code > 285) fail();
            const length = lengthBase[code - 257] + read(lengthExtra[code - 257]);
            const d = symbol(distances);
            if (d > 29) fail();
            const distance = distanceBase[d] + read(distanceExtra[d]);
            if (distance > used || distance > (1 << ((data[0] >>> 4) + 8))) fail();
            for (let i = 0; i < length; i++) put(output[used - distance]);
        }
    }
    if (used !== expected || Math.ceil(bit / 8) !== data.length - 4) fail();
    let a = 1, b = 0;
    for (const value of output) { a = (a + value) % 65521; b = (b + a) % 65521; }
    const actual = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(data.length - 4);
    if ((((b << 16) | a) >>> 0) !== actual) fail();
    return output;
}

function decodeSourcePng(source, size) {
    const limit = 64 * 1024 * 1024;
    if (!source || !size || source.width !== size.width || source.height !== size.height ||
        !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width <= 0 || size.height <= 0 ||
        size.width > 8192 || size.height > 8192 || (size.width * 4 + 1) * size.height > limit) {
        throw new Error("Authoring source dimensions differ or exceed the PNG limit.");
    }
    const encoded = source.pngBase64;
    if (typeof encoded !== "string" || encoded.length > Math.ceil(limit / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) || !encoded.length) {
        throw new Error("Authoring source must contain canonical PNG base64.");
    }
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    if ((padding === 2 && (alphabet.indexOf(encoded[encoded.length - 3]) & 15)) ||
        (padding === 1 && (alphabet.indexOf(encoded[encoded.length - 2]) & 3))) {
        throw new Error("Noncanonical PNG base64 padding.");
    }
    const bytes = new Uint8Array(encoded.length / 4 * 3 - padding);
    for (let i = 0, j = 0; i < encoded.length; i += 4) {
        const value = (alphabet.indexOf(encoded[i]) << 18) | (alphabet.indexOf(encoded[i + 1]) << 12) |
            (Math.max(0, alphabet.indexOf(encoded[i + 2])) << 6) | Math.max(0, alphabet.indexOf(encoded[i + 3]));
        bytes[j++] = value >>> 16; if (j < bytes.length) bytes[j++] = value >>> 8; if (j < bytes.length) bytes[j++] = value;
    }
    function fail() { throw new Error("Invalid 1x 8-bit RGBA PNG source."); }
    const signature = [137,80,78,71,13,10,26,10];
    if (bytes.length < 57 || !signature.every((v, i) => bytes[i] === v)) fail();
    const view = new DataView(bytes.buffer), parts = [];
    let offset = 8, ended = false, afterData = false, total = 0, header = false, palette = false;
    while (offset < bytes.length) {
        if (offset + 12 > bytes.length) fail();
        const length = view.getUint32(offset), end = offset + 12 + length;
        if (end > bytes.length) fail();
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (!/^[A-Za-z]{4}$/.test(type) || (bytes[offset + 6] & 32)) fail();
        let crc = 0xffffffff;
        for (let i = offset + 4; i < end - 4; i++) {
            crc ^= bytes[i]; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4)) fail();
        if (!header && type !== "IHDR") fail();
        if (type === "IHDR") {
            if (header || length !== 13 || view.getUint32(offset + 8) !== size.width ||
                view.getUint32(offset + 12) !== size.height || bytes[offset + 16] !== 8 ||
                bytes[offset + 17] !== 6 || bytes[offset + 18] || bytes[offset + 19] || bytes[offset + 20]) fail();
            header = true;
        } else if (type === "IDAT") {
            if (afterData) fail();
            parts.push(bytes.subarray(offset + 8, end - 4)); total += length;
        } else if (type === "IEND") {
            if (length || !parts.length || end !== bytes.length) fail();
            ended = true;
        } else {
            if (parts.length) afterData = true;
            if (type === "PLTE") {
                if (palette || parts.length || !length || length % 3 || length > 768) fail();
                palette = true;
            }
            else if (!(bytes[offset + 4] & 32) || ["acTL","fcTL","fdAT","tRNS"].includes(type)) fail();
        }
        offset = end;
    }
    if (!ended) fail();
    const compressed = new Uint8Array(total);
    let position = 0;
    for (const part of parts) { compressed.set(part, position); position += part.length; }
    const scanlines = inflatePng(compressed, (size.width * 4 + 1) * size.height);
    for (let row = 0; row < size.height; row++) if (scanlines[row * (size.width * 4 + 1)] > 4) fail();
    return bytes.buffer;
}

module.exports.decodeSourcePng = decodeSourcePng;
