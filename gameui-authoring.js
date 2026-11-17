"use strict";

const core = require("./gameui-core.js");
const MAX_PIXELS = 4194304;
const CAPABILITIES = ["nineSlice.v1", "sampling.v1"];
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const clone = value => JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function dimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
        width * height > MAX_PIXELS) throw new Error("Use positive integer dimensions, at most 4,194,304 pixels.");
}

function base64(bytes) {
    const parts = [];
    let part = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
        part += alphabet[n >>> 18] + alphabet[(n >>> 12) & 63] +
            (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : "=") + (i + 2 < bytes.length ? alphabet[n & 63] : "=");
        if (part.length >= 16384) { parts.push(part); part = ""; }
    }
    parts.push(part);
    return parts.join("");
}

function unbase64(value) {
    if (typeof value !== "string" || !value.length || value.length > MAX_PIXELS * 6 + 100000 ||
        value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
        throw new Error("Invalid PNG base64.");
    }
    const out = new Uint8Array(value.length / 4 * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0));
    let p = 0;
    for (let i = 0; i < value.length; i += 4) {
        const n = (alphabet.indexOf(value[i]) << 18) | (alphabet.indexOf(value[i + 1]) << 12) |
            (Math.max(0, alphabet.indexOf(value[i + 2])) << 6) | Math.max(0, alphabet.indexOf(value[i + 3]));
        for (const shift of [16, 8, 0]) if (p < out.length) out[p++] = (n >>> shift) & 255;
    }
    return out;
}

function crc32(data) {
    let crc = -1;
    for (const byte of data) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ -1) >>> 0;
}

function adler32(data) {
    let a = 1, b = 0;
    for (const byte of data) { a = (a + byte) % 65521; b = (b + a) % 65521; }
    return ((b << 16) | a) >>> 0;
}

function concat(arrays) {
    const out = new Uint8Array(arrays.reduce((sum, data) => sum + data.length, 0));
    let p = 0;
    for (const data of arrays) { out.set(data, p); p += data.length; }
    return out;
}

function chunk(name, data) {
    const out = new Uint8Array(data.length + 12);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[i + 4] = name.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
    return out;
}

function encodePng(pixels, width, height) {
    dimensions(width, height);
    if (!(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) throw new Error("Expected 8-bit RGBA pixels.");
    const raw = new Uint8Array(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
    const blocks = [new Uint8Array([0x78, 0x01])];
    for (let p = 0; p < raw.length; p += 65535) {
        const n = Math.min(65535, raw.length - p);
        blocks.push(new Uint8Array([p + n === raw.length ? 1 : 0, n & 255, n >>> 8, (~n) & 255, ((~n) >>> 8) & 255]), raw.subarray(p, p + n));
    }
    const checksum = new Uint8Array(4);
    new DataView(checksum.buffer).setUint32(0, adler32(raw));
    blocks.push(checksum);
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width); view.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6;
    return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", concat(blocks)), chunk("IEND", new Uint8Array())]);
}

function decodeSnapshot(source) {
    if (!source) throw new Error("Source snapshot is missing; define the resource from its original layer.");
    dimensions(source.width, source.height);
    const bytes = unbase64(source.pngBase64);
    const view = new DataView(bytes.buffer);
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) throw new Error("Source is not PNG.");
    let p = 8;
    const chunks = [];
    for (const expected of ["IHDR", "IDAT", "IEND"]) {
        if (p + 12 > bytes.length) throw new Error("Truncated PNG.");
        const n = view.getUint32(p);
        if (p + n + 12 > bytes.length || String.fromCharCode(...bytes.subarray(p + 4, p + 8)) !== expected ||
            crc32(bytes.subarray(p + 4, p + n + 8)) !== view.getUint32(p + n + 8)) throw new Error("Invalid PNG chunks or CRC.");
        chunks.push(bytes.subarray(p + 8, p + n + 8)); p += n + 12;
    }
    const h = chunks[0];
    const hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    if (p !== bytes.length || h.length !== 13 || hv.getUint32(0) !== source.width || hv.getUint32(4) !== source.height ||
        h[8] !== 8 || h[9] !== 6 || h[10] || h[11] || h[12] || chunks[2].length) throw new Error("Expected 1x 8-bit RGBA snapshot dimensions.");
    const z = chunks[1];
    if (z[0] !== 0x78 || z[1] !== 1) throw new Error("Import a GameUI panel directory with deterministic source snapshots.");
    const raw = new Uint8Array(source.height * (source.width * 4 + 1));
    let at = 2, written = 0, last = false;
    while (!last) {
        if (at + 5 > z.length - 4 || (z[at] !== 0 && z[at] !== 1)) throw new Error("Invalid snapshot deflate block.");
        last = z[at++] === 1;
        const n = z[at] | (z[at + 1] << 8), inverted = z[at + 2] | (z[at + 3] << 8); at += 4;
        if ((n ^ inverted) !== 65535 || written + n > raw.length || at + n > z.length - 4) throw new Error("Invalid snapshot block length.");
        raw.set(z.subarray(at, at + n), written); written += n; at += n;
    }
    if (written !== raw.length || at + 4 !== z.length || adler32(raw) !== new DataView(z.buffer, z.byteOffset).getUint32(at)) throw new Error("Invalid snapshot checksum.");
    const pixels = new Uint8Array(source.width * source.height * 4);
    for (let y = 0; y < source.height; y++) {
        const row = y * (source.width * 4 + 1);
        if (raw[row] !== 0) throw new Error("Unsupported snapshot row filter.");
        pixels.set(raw.subarray(row + 1, row + 1 + source.width * 4), y * source.width * 4);
    }
    return pixels;
}

function snapshot(pixels, width, height) {
    return { width, height, pngBase64: base64(encodePng(pixels, width, height)) };
}

function validateTarget(target) {
    if (!target || typeof target !== "object" || Array.isArray(target)) throw new Error("Invalid target canvas record.");
    dimensions(target.width, target.height);
    for (const key of ["insetLeft", "insetTop", "contentWidth", "contentHeight"]) {
        if (!Number.isSafeInteger(target[key]) || target[key] < 0) throw new Error("Target canvas values must be integer source pixels.");
    }
    if (!target.contentWidth || !target.contentHeight || target.insetLeft + target.contentWidth > target.width ||
        target.insetTop + target.contentHeight > target.height) throw new Error("Target content bounds are empty or outside the canvas.");
    return target;
}

function targetFromPixels(pixels, width, height) {
    dimensions(width, height);
    if (!(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) throw new Error("Expected target RGBA pixels.");
    let left = width, top = height, right = 0, bottom = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] === 0) continue;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
    return validateTarget({ width, height, insetLeft: left, insetTop: top, contentWidth: right - left, contentHeight: bottom - top });
}

function withTarget(metadata, layerId, target) {
    validateTarget(target);
    const result = clone(metadata), marker = result.nodes[layerId];
    if (!marker) throw new Error("Target canvas needs an explicitly bound node.");
    result.authoring = result.authoring || { version: 1, sources: {} };
    result.authoring.targets = result.authoring.targets || {};
    result.authoring.targets[marker.nodeId] = Object.assign({}, result.authoring.targets[marker.nodeId], clone(target));
    return validateMetadata(result);
}

function capabilities(value) {
    if (value.requiredCapabilities !== undefined && (!Array.isArray(value.requiredCapabilities) ||
        value.requiredCapabilities.some(name => !CAPABILITIES.includes(name)))) throw new Error("Unknown required capability; use a compatible GameUI panel.");
}

function validateAsset(asset, source) {
    capabilities(asset);
    if (!asset.sourceSize || !asset.nineSlice || asset.nineSlice.unit !== "sourcePixel" || asset.nineSlice.center !== "stretch") throw new Error("Resource needs sourcePixel borders and stretch center.");
    core.validateNineSlice(asset.sourceSize.width, asset.sourceSize.height, asset.nineSlice);
    core.validateSampling(asset.sampling);
    if (source) {
        if (source.width !== asset.sourceSize.width || source.height !== asset.sourceSize.height) throw new Error("Source size differs from PNG dimensions.");
        decodeSnapshot(source);
    }
}

function validateMetadata(metadata) {
    if (!metadata || metadata.schemaVersion !== 1) throw new Error("Unsupported GameUI schema version.");
    capabilities(metadata);
    if (typeof metadata.documentId !== "string" || !metadata.documentId.trim() ||
        typeof metadata.artboardId !== "string" || !metadata.artboardId.trim()) throw new Error("Document and artboard identities must be nonempty strings.");
    if (!metadata.nodes || !metadata.assets || typeof metadata.nodes !== "object" || typeof metadata.assets !== "object" ||
        Array.isArray(metadata.nodes) || Array.isArray(metadata.assets)) throw new Error("Invalid nodes/assets map.");
    if (metadata.authoring && (metadata.authoring.version !== 1 || !metadata.authoring.sources || typeof metadata.authoring.sources !== "object")) throw new Error("Unsupported authoring snapshot version.");
    if (metadata.authoring) capabilities(metadata.authoring);
    const sources = metadata.authoring ? metadata.authoring.sources : {};
    for (const [ref, asset] of Object.entries(metadata.assets)) {
        if (!ref.trim() || ["__proto__", "constructor", "prototype"].includes(ref)) throw new Error("Invalid assetRef key.");
        if ((asset.assetKey !== undefined || asset.version !== undefined) &&
            (typeof asset.assetKey !== "string" || !Number.isInteger(asset.version) || asset.version <= 0 ||
                asset.assetKey + "@" + asset.version !== ref)) throw new Error("Resource key/version differs from assetRef: " + ref);
        validateAsset(asset, sources[ref]);
        if (asset.sampling !== undefined && !(metadata.requiredCapabilities || []).includes("sampling.v1")) throw new Error("Explicit sampling requires sampling.v1.");
    }
    for (const ref of Object.keys(sources)) if (!own(metadata.assets, ref)) throw new Error("Snapshot has no resource contract: " + ref);
    const ids = new Set();
    for (const marker of Object.values(metadata.nodes)) {
        capabilities(marker);
        if (typeof marker.nodeId !== "string" || !marker.nodeId.trim() || typeof marker.assetRef !== "string" || !marker.assetRef.trim() || ids.has(marker.nodeId)) throw new Error("Duplicate or missing nodeId; explicitly repair the selected layer identity.");
        ids.add(marker.nodeId);
        if (!["image", "resourceSource"].includes(marker.kind) || !own(metadata.assets, marker.assetRef)) throw new Error("Invalid node kind or resource reference.");
        if (marker.sampling !== undefined || marker.sourceSize !== undefined || marker.nineSlice !== undefined) throw new Error("Instances inherit the resource contract; remove instance overrides explicitly.");
        if (marker.kind === "image" && (marker.renderMode !== "nineSlice" || marker.nativeImageUsage !== "validationReference")) throw new Error("Unsupported image render mode.");
    }
    if (metadata.authoring && metadata.authoring.targets !== undefined) {
        const targets = metadata.authoring.targets;
        if (!targets || typeof targets !== "object" || Array.isArray(targets)) throw new Error("Invalid target canvas map.");
        for (const [nodeId, target] of Object.entries(targets)) {
            if (!ids.has(nodeId)) throw new Error("Target canvas has no matching nodeId: " + nodeId);
            if (!Object.values(metadata.nodes).some(marker => marker.nodeId === nodeId && marker.kind === "image")) throw new Error("Target canvas requires an image node: " + nodeId);
            validateTarget(target);
        }
    }
    return metadata;
}

function createMetadata() {
    return { schemaVersion: 1, documentId: core.createId(), artboardId: core.createId(),
        uploadScope: { version: 1, projectId: "cfea1199-7c07-48d9-86ef-cdbd3385c237", purpose: "gameui-productionization-test" },
        nodes: {}, assets: {}, requiredCapabilities: ["nineSlice.v1", "sampling.v1"], authoring: { version: 1, sources: {} } };
}

function stable(value) {
    if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
    if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
    return JSON.stringify(value);
}

function contract(asset) {
    const value = clone(asset);
    for (const key of ["displayName", "sourceLayerId", "sourceNodeId", "image"]) delete value[key];
    value.sampling = Object.assign({}, value.sampling, { filterMode: core.validateSampling(asset.sampling) });
    return stable(value);
}

function mergeResource(metadata, ref, asset, source) {
    validateAsset(asset, source);
    if (!source) throw new Error("A portable resource requires its original source snapshot.");
    metadata.authoring = metadata.authoring || { version: 1, sources: {} };
    const previous = metadata.assets[ref];
    if (previous && (contract(previous) !== contract(asset) ||
        (metadata.authoring.sources[ref] && stable(metadata.authoring.sources[ref]) !== stable(source)))) {
        throw new Error("Immutable assetRef conflict: " + ref + ". Increment the resource version; pixels, size, borders and sampling cannot change.");
    }
    metadata.assets[ref] = clone(asset);
    metadata.authoring.sources[ref] = clone(source);
    metadata.requiredCapabilities = Array.from(new Set([...(metadata.requiredCapabilities || []), "nineSlice.v1", "sampling.v1"]));
}

function bind(metadata, layerId, ref, freshIdentity = false) {
    if (!own(metadata.assets, ref)) throw new Error("Select an existing resource version.");
    const old = metadata.nodes[layerId] || {};
    metadata.nodes[layerId] = Object.assign({}, old, { nodeId: freshIdentity || !old.nodeId ? core.createId() : old.nodeId,
        kind: "image", assetRef: ref, renderMode: "nineSlice", nativeImageUsage: "validationReference" });
    for (const key of ["sampling", "sourceSize", "nineSlice"]) delete metadata.nodes[layerId][key];
    return metadata;
}

function define(metadata, layerId, options, source) {
    validateMetadata(metadata);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.assetKey) || !Number.isInteger(options.version) || options.version <= 0 ||
        typeof options.displayName !== "string" || !options.displayName.trim()) throw new Error("Enter a name, resource key and positive integer version.");
    const result = clone(metadata);
    const ref = options.assetKey + "@" + options.version;
    const previous = result.assets[ref] || options.baseAsset || {};
    const asset = Object.assign({}, previous, { assetKey: options.assetKey, version: options.version,
        displayName: options.displayName.trim(), sourceSize: Object.assign({}, previous.sourceSize, { width: source.width, height: source.height }),
        nineSlice: Object.assign({}, previous.nineSlice, options.nineSlice, { unit: "sourcePixel", center: "stretch" }),
        sampling: Object.assign({}, previous.sampling, { filterMode: options.filterMode }) });
    mergeResource(result, ref, asset, source);
    bind(result, layerId, ref);
    return withTarget(result, layerId, targetFromPixels(decodeSnapshot(source), source.width, source.height));
}

function reference(metadata, layerId, ref, freshIdentity = false, target) {
    validateMetadata(metadata);
    const result = clone(metadata);
    if (!result.authoring || !result.authoring.sources[ref]) throw new Error("This legacy resource needs a source snapshot before it can be referenced portably.");
    const previousId = result.nodes[layerId] && result.nodes[layerId].nodeId;
    bind(result, layerId, ref, freshIdentity);
    if (freshIdentity && result.authoring.targets && previousId) {
        const previous = result.authoring.targets[previousId];
        delete result.authoring.targets[previousId];
        if (previous) result.authoring.targets[result.nodes[layerId].nodeId] = previous;
    }
    return target ? withTarget(result, layerId, target) : validateMetadata(result);
}

function copyNode(metadata, sourceLayerId, newLayerId) {
    validateMetadata(metadata);
    if (!metadata.nodes[sourceLayerId] || own(metadata.nodes, newLayerId)) throw new Error("Controlled copy needs a known source and a new Photoshop layer ID.");
    const result = clone(metadata);
    result.nodes[newLayerId] = Object.assign({}, result.nodes[sourceLayerId], { nodeId: core.createId(), kind: "image", renderMode: "nineSlice", nativeImageUsage: "validationReference" });
    const targets = result.authoring && result.authoring.targets;
    if (targets && targets[result.nodes[sourceLayerId].nodeId]) {
        targets[result.nodes[newLayerId].nodeId] = clone(targets[result.nodes[sourceLayerId].nodeId]);
    }
    return validateMetadata(result);
}

function forkDocument(metadata, layerIds) {
    const input = clone(metadata);
    input.documentId = core.createId(); input.artboardId = core.createId();
    validateMetadata(input);
    const known = new Set(layerIds.map(String));
    if (Object.keys(metadata.nodes).some(id => !known.has(id))) throw new Error("Document copy changed layer IDs; repair references explicitly before assigning new document identity.");
    const result = input;
    const targets = result.authoring && result.authoring.targets;
    const rekeyed = {};
    for (const marker of Object.values(result.nodes)) {
        const previous = marker.nodeId;
        marker.nodeId = core.createId();
        if (targets && targets[previous]) rekeyed[marker.nodeId] = targets[previous];
    }
    if (targets) result.authoring.targets = rekeyed;
    return validateMetadata(result);
}

function directory(metadata) {
    validateMetadata(metadata);
    const result = clone(metadata);
    result.nodes = {};
    if (result.authoring) delete result.authoring.targets;
    for (const asset of Object.values(result.assets)) {
        for (const field of ["sourceLayerId", "sourceNodeId", "image"]) delete asset[field];
    }
    for (const ref of Object.keys(result.assets)) {
        if (!result.authoring || !result.authoring.sources[ref]) throw new Error("Directory export requires original snapshots for every resource: " + ref);
    }
    return result;
}

function importDirectory(metadata, input) {
    validateMetadata(metadata); validateMetadata(input);
    const result = clone(metadata);
    for (const [ref, asset] of Object.entries(input.assets)) {
        mergeResource(result, ref, asset, input.authoring && input.authoring.sources[ref]);
    }
    return validateMetadata(result);
}

function importResource(metadata, input, ref) {
    validateMetadata(metadata); validateMetadata(input);
    if (!own(input.assets, ref)) throw new Error("Select an existing resource version.");
    const result = clone(metadata);
    mergeResource(result, ref, input.assets[ref], input.authoring && input.authoring.sources[ref]);
    return validateMetadata(result);
}

function resourceOptions(catalog, ref, mode, settings) {
    validateMetadata(catalog);
    if (mode === "create") return Object.assign({}, settings, { assetKey: core.createId(), version: 1 });
    const selected = catalog.assets[ref];
    if (!selected || !["update", "publish"].includes(mode) || !selected.assetKey || !selected.version) {
        throw new Error("Select a resource with a managed internal identity.");
    }
    let version = selected.version;
    if (mode === "publish") {
        version = Math.max(...Object.values(catalog.assets).filter(asset => asset.assetKey === selected.assetKey).map(asset => asset.version)) + 1;
    }
    return Object.assign({}, settings, { assetKey: selected.assetKey, version, baseAsset: clone(selected) });
}

function inspect(metadata, layers) {
    validateMetadata(metadata);
    const issues = [], current = new Set(layers.map(layer => String(layer.id)));
    for (const layer of layers) {
        if (!own(metadata.nodes, layer.id)) issues.push({ layerId: layer.id, code: "UNBOUND", message: layer.name + ": unbound layer or arbitrary copy. Choose its resource explicitly; the panel never guesses." });
    }
    for (const [id, marker] of Object.entries(metadata.nodes)) {
        if (!current.has(id)) issues.push({ layerId: id, code: "MISSING_LAYER", message: "Layer " + id + " no longer exists. Remove this stale binding explicitly." });
        if (!metadata.authoring || !metadata.authoring.sources[marker.assetRef]) issues.push({ layerId: id, code: "MISSING_SOURCE", message: "Original snapshot missing: " + marker.assetRef + ". Select the original source and define this version." });
    }
    return issues;
}

function preview(source, border, width, height, sampling) {
    dimensions(width, height);
    const pixels = decodeSnapshot(source);
    const result = core.renderNineSlice(pixels, source.width, source.height, border, width, height);
    if (core.validateSampling(sampling) === "Point") return result;
    function coordinate(p, src, dst, before, after) {
        if (p < before) return p;
        if (p >= dst - after) return src - (dst - p);
        return Math.max(0, Math.min(src - 1, before + (p - before + 0.5) * (src - before - after) / (dst - before - after) - 0.5));
    }
    for (let y = 0; y < height; y++) {
        const sy = coordinate(y, source.height, height, border.top, border.bottom);
        for (let x = 0; x < width; x++) {
            const sx = coordinate(x, source.width, width, border.left, border.right);
            const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
            for (let c = 0; c < 4; c++) {
                const value = (xx, yy) => pixels[(Math.min(source.height - 1, yy) * source.width + Math.min(source.width - 1, xx)) * 4 + c];
                result[(y * width + x) * 4 + c] = Math.round((value(x0, y0) * (1 - fx) + value(x0 + 1, y0) * fx) * (1 - fy) +
                    (value(x0, y0 + 1) * (1 - fx) + value(x0 + 1, y0 + 1) * fx) * fy);
            }
        }
    }
    return result;
}

module.exports = { MAX_PIXELS, base64, unbase64, encodePng, decodeSnapshot, snapshot, validateMetadata, createMetadata,
    define, reference, copyNode, forkDocument, directory, importDirectory, inspect, preview, contract,
    validateTarget, targetFromPixels, withTarget, importResource, resourceOptions };
