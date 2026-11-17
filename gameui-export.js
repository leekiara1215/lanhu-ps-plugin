"use strict";

const store = require("./gameui-ps.js");
const { validateNineSlice, validateSampling, decodeSourcePng } = require("./gameui-core.js");
const TEST_PROJECT = "cfea1199-7c07-48d9-86ef-cdbd3385c237";
const TEST_DOCUMENT = /^LanhuGameUIFoundation20261116(?:Second)?(?:\.psd)?$/;
const CAPABILITIES = new Set(["nineSlice.v1", "sampling.v1"]);
const captured = new WeakSet();
const clone = value => JSON.parse(JSON.stringify(value));
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const identity = value => typeof value === "string" && value.trim().length > 0;

function walk(layers, visit) {
    for (const layer of layers || []) {
        visit(layer);
        walk(layer.layers, visit);
    }
}

function documentName(payload) {
    return (payload.meta && payload.meta.fileName) || (payload.artboard && payload.artboard.name) || "";
}

function explicitScope(metadata) {
    const scope = metadata && metadata.uploadScope;
    return record(scope) && scope.version === 1 && scope.projectId === TEST_PROJECT &&
        scope.purpose === "gameui-productionization-test";
}

function destination(config) {
    if (!config || (config.projectId && config.projectID && config.projectId !== config.projectID) ||
        (config.projectId || config.projectID) !== TEST_PROJECT) {
        throw new Error("GameUI test upload guard rejected this destination.");
    }
}

function validateMetadata(metadata) {
    if (!record(metadata) || metadata.schemaVersion !== 1 || !identity(metadata.documentId) ||
        !identity(metadata.artboardId) || !record(metadata.nodes) || !record(metadata.assets)) {
        throw new Error("GameUI document metadata is missing or unsupported.");
    }
    const required = metadata.requiredCapabilities === undefined ? [] : metadata.requiredCapabilities;
    if (!Array.isArray(required) || required.some(value => !CAPABILITIES.has(value))) {
        throw new Error("Unsupported required GameUI capability.");
    }
    const ids = new Set();
    for (const marker of Object.values(metadata.nodes)) {
        validateMarker(marker, metadata.assets, ids);
    }
    for (const asset of Object.values(metadata.assets)) {
        if (!record(asset) || !record(asset.sourceSize)) throw new Error("Missing GameUI source size.");
        validateNineSlice(asset.sourceSize.width, asset.sourceSize.height, asset.nineSlice);
        validateSampling(asset.sampling);
        if (asset.sampling !== undefined && !required.includes("sampling.v1")) {
            throw new Error("Explicit GameUI sampling requires the sampling.v1 capability.");
        }
    }
}

function validateMarker(marker, assets, ids) {
    if (!record(marker) || !identity(marker.nodeId) || ids.has(marker.nodeId)) {
        throw new Error("Invalid or duplicate GameUI node identity.");
    }
    ids.add(marker.nodeId);
    if (marker.sampling !== undefined || marker.sourceSize !== undefined || marker.nineSlice !== undefined) {
        throw new Error("GameUI sourceSize, nineSlice and sampling belong to the shared resource.");
    }
    if (!["image", "resourceSource"].includes(marker.kind) || !identity(marker.assetRef) ||
        !Object.prototype.hasOwnProperty.call(assets, marker.assetRef) ||
        (marker.kind === "image" && (marker.renderMode !== "nineSlice" ||
            marker.nativeImageUsage !== "validationReference"))) {
        throw new Error("Invalid GameUI node kind or asset reference.");
    }
}

function validateInstance(layer, asset) {
    if (!layer.image || !layer.frame || !Number.isFinite(layer.frame.width) || !Number.isFinite(layer.frame.height) ||
        layer.frame.width < asset.nineSlice.left + asset.nineSlice.right ||
        layer.frame.height < asset.nineSlice.top + asset.nineSlice.bottom) {
        throw new Error("Invalid nine-slice instance: " + layer.id);
    }
}

function validateTargets(authoring, nodes) {
    const targets = authoring && authoring.targets;
    if (targets === undefined) return new Map();
    if (!record(targets)) throw new Error("GameUI authoring targets must be a nodeId map.");
    const images = new Set(Object.values(nodes).filter(marker => marker.kind === "image").map(marker => marker.nodeId));
    const result = new Map();
    for (const [nodeId, target] of Object.entries(targets)) {
        if (!images.has(nodeId) || !record(target) ||
            !["width", "height", "contentWidth", "contentHeight"].every(key => Number.isSafeInteger(target[key]) && target[key] > 0) ||
            !["insetLeft", "insetTop"].every(key => Number.isSafeInteger(target[key]) && target[key] >= 0) ||
            target.contentWidth > target.width - target.insetLeft ||
            target.contentHeight > target.height - target.insetTop) {
            throw new Error("Invalid GameUI target geometry or image nodeId: " + nodeId);
        }
        result.set(nodeId, target);
    }
    return result;
}

function restoreTargetFrame(layer, target) {
    const frame = layer.frame;
    if (!frame || !Number.isFinite(frame.left) || !Number.isFinite(frame.top) ||
        frame.width !== target.contentWidth || frame.height !== target.contentHeight ||
        (layer.realFrame !== undefined && (!record(layer.realFrame) ||
            ["left", "top", "width", "height"].some(key => layer.realFrame[key] !== frame[key])))) {
        throw new Error("GameUI native content geometry changed; reapply this instance in the panel: " + layer.id);
    }
    function restored(original) {
        const result = { ...original, left: original.left - target.insetLeft, top: original.top - target.insetTop,
            width: target.width, height: target.height };
        if (Object.prototype.hasOwnProperty.call(result, "right")) result.right = result.left + result.width;
        if (Object.prototype.hasOwnProperty.call(result, "bottom")) result.bottom = result.top + result.height;
        return result;
    }
    return { layer, nativeReferenceFrame: clone(frame), frame: restored(frame),
        realFrame: layer.realFrame === undefined ? undefined : restored(layer.realFrame) };
}

async function capture(payload, config, documentId, formatter) {
    const namedTest = TEST_DOCUMENT.test(documentName(payload));
    if (namedTest) destination(config);
    let metadata;
    try {
        metadata = (await store.readMetadata(documentId)).metadata;
    } catch (error) {
        if (error && (error.code === "GAMEUI_METADATA_INVALID" || error.name === "SyntaxError")) {
            const failure = new Error("GameUI XMP metadata is damaged; repair or restore the document metadata in the panel before uploading.");
            failure.code = "GAMEUI_METADATA_INVALID";
            throw failure;
        }
        if (namedTest) throw error;
        return payload;
    }
    if (metadata && metadata.uploadScope !== undefined && !explicitScope(metadata)) {
        throw new Error("Unsupported GameUI test upload scope.");
    }
    if (!namedTest && !explicitScope(metadata)) {
        return payload;
    }
    destination(config);
    validateMetadata(metadata);
    if (!payload.artboard || !Array.isArray(payload.artboard.layers)) throw new Error("Missing native artboard layers.");
    const authoring = metadata.authoring;
    if (authoring !== undefined && (!record(authoring) || authoring.version !== 1 || !record(authoring.sources))) {
        throw new Error("Unsupported GameUI authoring version or sources.");
    }
    const targets = validateTargets(authoring, metadata.nodes);
    const corrections = [];
    const snapshots = new Map();
    for (const [ref, source] of Object.entries(authoring ? authoring.sources : {})) {
        if (!Object.prototype.hasOwnProperty.call(metadata.assets, ref)) throw new Error("Unknown authoring asset: " + ref);
        snapshots.set(ref, decodeSourcePng(source, metadata.assets[ref].sourceSize));
    }
    const nativeIds = new Set(), nodeIds = new Set(Object.values(metadata.nodes).map(marker => marker.nodeId));
    const found = new Set(), sources = new Map(), assignments = [];
    walk(payload.artboard.layers, layer => {
        const nativeId = String(layer.id);
        if (layer.id === undefined || nativeIds.has(nativeId)) throw new Error("Duplicate or missing native node identity.");
        nativeIds.add(nativeId);
        if (layer.gameUI) throw new Error("Native payload already contains GameUI metadata.");
        const key = String(layer.originID === undefined ? layer.id : layer.originID);
        if (!Object.prototype.hasOwnProperty.call(metadata.nodes, key)) return;
        if (found.has(key)) throw new Error("GameUI layer mapping exported more than once: " + key);
        found.add(key);
        const marker = metadata.nodes[key], asset = metadata.assets[marker.assetRef];
        if (marker.kind === "resourceSource") {
            if (sources.has(marker.assetRef) || !layer.image || (layer.layers && layer.layers.length)) {
                throw new Error("Multiple sources or missing native source image: " + marker.assetRef);
            }
            if (!layer.frame || layer.frame.width !== asset.sourceSize.width || layer.frame.height !== asset.sourceSize.height) {
                throw new Error("Native source dimensions differ: " + marker.assetRef);
            }
            sources.set(marker.assetRef, layer);
        } else {
            const target = targets.get(marker.nodeId);
            const correction = target && restoreTargetFrame(layer, target);
            validateInstance(correction ? { ...layer, frame: correction.frame } : layer, asset);
            if (correction) corrections.push(correction);
        }
        assignments.push([layer, marker]);
    });
    for (const id of nodeIds) if (nativeIds.has(id)) throw new Error("GameUI identity collides with native node identity.");
    for (const key of Object.keys(metadata.nodes)) {
        if (!found.has(key)) throw new Error("GameUI node was not exported: " + key);
    }
    const injected = [];
    for (const [ref, asset] of Object.entries(metadata.assets)) {
        if (sources.has(ref)) continue;
        if (!snapshots.has(ref)) throw new Error("GameUI source snapshot is missing: " + ref);
        const id = "gameui-source:" + encodeURIComponent(ref);
        const nodeId = "gameui-resource:" + encodeURIComponent(metadata.documentId) + ":" + encodeURIComponent(ref);
        if (nativeIds.has(id) || nodeIds.has(id) || nodeIds.has(nodeId) || nativeIds.has(nodeId)) {
            throw new Error("Injected resource identity collision: " + ref);
        }
        nativeIds.add(id); nodeIds.add(nodeId);
        const frame = { left: 0, top: 0, width: asset.sourceSize.width, height: asset.sourceSize.height };
        const layer = { id, name: "GameUI source " + ref, type: "shapeLayer", visible: true, opacity: 1,
            clipped: false, hasExportImage: true, hasExportDDSImage: false, isMask: false,
            frame, realFrame: clone(frame), rotation: 0, radius: [], layers: [],
            transform: [[1, 0, 0], [0, 1, 0]], image: {},
            style: { isEnabled: true, opacity: 1, blendMode: 0, fills: [], borders: [], shadows: [], blurs: [] },
            gameUI: { nodeId, kind: "resourceSource", assetRef: ref } };
        injected.push(layer); sources.set(ref, layer);
    }
    // Perform all contract checks before calling the native exporter or mutating the payload.
    const bitmaps = new Map();
    for (const [ref, layer] of sources) {
        bitmaps.set(ref, snapshots.has(ref) ? snapshots.get(ref) :
            await store.exportSourcePng(formatter, documentId,
                Number(layer.originID === undefined ? layer.id : layer.originID), metadata.assets[ref].sourceSize));
    }
    payload.gameUI = clone(metadata);
    delete payload.gameUI.authoring;
    delete payload.gameUI.uploadScope;
    payload.gameUI.exporter = { version: "0.4.0-test", baseLanhuPluginVersion: "1.0.32(303)" };
    payload.artboard.gameUI = { artboardId: metadata.artboardId };
    for (const [layer, marker] of assignments) layer.gameUI = clone(marker);
    for (const correction of corrections) {
        correction.layer.gameUI.nativeReferenceFrame = correction.nativeReferenceFrame;
        correction.layer.frame = correction.frame;
        if (correction.realFrame !== undefined) correction.layer.realFrame = correction.realFrame;
    }
    payload.artboard.layers.push(...injected);
    for (const [ref, layer] of sources) {
        layer.image.bitmap = bitmaps.get(ref);
        delete layer.image.imageUrl;
        layer.image.gameUISourceExportScale = 1;
    }
    captured.add(payload);
    return payload;
}

function finalize(payload, config) {
    if (!payload.gameUI) return payload;
    destination(config);
    // capture removes the local scope. Only payloads captured in this process are eligible.
    if (!captured.has(payload)) throw new Error("GameUI payload was not captured by this adapter.");
    validateMetadata(payload.gameUI);
    if (payload.gameUI.authoring !== undefined || payload.gameUI.uploadScope !== undefined) {
        throw new Error("Local GameUI authoring data must not be uploaded.");
    }
    const sources = new Map(), ids = new Set(), nativeIds = new Set();
    walk(payload.artboard.layers, layer => {
        if (nativeIds.has(String(layer.id))) throw new Error("Duplicate native node identity.");
        nativeIds.add(String(layer.id));
        if (!layer.gameUI) return;
        validateMarker(layer.gameUI, payload.gameUI.assets, ids);
        if (layer.gameUI.kind === "resourceSource") {
            if (sources.has(layer.gameUI.assetRef)) throw new Error("Multiple sources for one asset version.");
            sources.set(layer.gameUI.assetRef, layer);
        } else {
            validateInstance(layer, payload.gameUI.assets[layer.gameUI.assetRef]);
            if (layer.image.bitmap || !layer.image.imageUrl) throw new Error("Native instance upload is incomplete.");
        }
    });
    for (const id of ids) if (nativeIds.has(id)) throw new Error("GameUI identity collides with native node identity.");
    for (const [ref, asset] of Object.entries(payload.gameUI.assets)) {
        const source = sources.get(ref);
        if (!source || !source.image || source.image.bitmap || !source.image.imageUrl || !source.frame ||
            source.frame.width !== asset.sourceSize.width || source.frame.height !== asset.sourceSize.height ||
            (source.realFrame && (source.realFrame.width !== asset.sourceSize.width || source.realFrame.height !== asset.sourceSize.height)) ||
            (source.layers && source.layers.length)) {
            throw new Error("Unstretched source PNG is missing or has incorrect dimensions: " + ref);
        }
        if (source.image.gameUISourceExportScale !== 1) throw new Error("GameUI source was not exported at 1x.");
        asset.sourceNodeId = String(source.id);
        asset.image = { ...(asset.image || {}), url: source.image.imageUrl, exportScale: 1,
            width: asset.sourceSize.width, height: asset.sourceSize.height };
    }
    return payload;
}

module.exports = { capture, finalize };
