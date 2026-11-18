"use strict";

const store = require("./gameui-ps.js");
const { validateNineSlice, validateSampling, decodeSourcePng } = require("./gameui-core.js");
const TEST_PROJECT = "cfea1199-7c07-48d9-86ef-cdbd3385c237";
const TEST_DOCUMENT = /^LanhuGameUIFoundation20261116(?:Second)?(?:\.psd)?$/;
const CAPABILITIES = new Set(["nineSlice.v1", "sampling.v1"]);
const DOCUMENT_FIELDS = new Set(["schemaVersion", "documentId", "artboardId", "nodes", "assets",
    "requiredCapabilities", "authoring", "uploadScope"]);
const captured = new WeakSet();
const analyses = new WeakMap();
const clone = value => JSON.parse(JSON.stringify(value));
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const identity = value => typeof value === "string" && value.trim().length > 0;
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

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
    if (!record(config) || ("projectId" in config && "projectID" in config && config.projectId !== config.projectID) ||
        (config.projectId || config.projectID) !== TEST_PROJECT) {
        throw new Error("GameUI test upload guard rejected this destination.");
    }
}

function validateDocument(metadata) {
    if (!record(metadata) || metadata.schemaVersion !== 1 || !identity(metadata.documentId) ||
        !identity(metadata.artboardId) || !record(metadata.nodes) || !record(metadata.assets)) {
        throw new Error("GameUI document metadata is missing or unsupported.");
    }
}

function validateMetadata(metadata) {
    validateDocument(metadata);
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
        !owns(assets, marker.assetRef) ||
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

async function scopedMetadata(config, documentId, name, mustRead = false) {
    const namedTest = TEST_DOCUMENT.test(name);
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
        if (namedTest || mustRead) throw error;
        return null;
    }
    if (metadata && metadata.uploadScope !== undefined && !explicitScope(metadata)) {
        throw new Error("Unsupported GameUI test upload scope.");
    }
    if (!namedTest && !explicitScope(metadata)) {
        if (mustRead && metadata && (!record(metadata.nodes) || Object.keys(metadata.nodes).length)) {
            throw scopeError("GameUI metadata has no approved test upload scope.");
        }
        return null;
    }
    destination(config);
    validateDocument(metadata);
    return metadata;
}

function nativeId(value) {
    return (typeof value === "number" || typeof value === "string") &&
        /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? String(value) : null;
}

function scopeError(message) {
    const error = new Error(message);
    error.code = "GAMEUI_UPLOAD_SCOPE";
    return error;
}

function authoringData(metadata) {
    const authoring = metadata.authoring;
    if (authoring !== undefined && (!record(authoring) || authoring.version !== 1 || !record(authoring.sources))) {
        throw new Error("Unsupported GameUI authoring version or sources.");
    }
    return authoring;
}

function partitionMetadata(document, boards, selected, metadata) {
    const owners = new Map();
    function index(layers, owner) {
        for (const layer of layers) {
            const id = nativeId(layer.id);
            if (!id || owners.has(id) || layer.type === "artboardSection" ||
                (layer.layers !== undefined && !Array.isArray(layer.layers))) {
                throw scopeError("Cannot prove GameUI ownership from the PSD layer tree.");
            }
            owners.set(id, owner);
            if (layer.layers) index(layer.layers, owner);
        }
    }
    for (const layer of document.layers) {
        if (layer.type !== "artboardSection") index([layer], null);
        else {
            // The artboard layer itself is not present in the native board's exported layers.
            if (owners.has(String(layer.id)) || (layer.layers !== undefined && !Array.isArray(layer.layers))) {
                throw scopeError("Cannot prove GameUI ownership from the PSD artboard tree.");
            }
            owners.set(String(layer.id), null);
            index(layer.layers || [], String(layer.id));
        }
    }
    const partitions = new Map();
    const nodeIds = new Map();
    const firstAssetOwners = new Map(), sharedRefs = new Set();
    for (const [key, marker] of Object.entries(metadata.nodes)) {
        const owner = owners.get(key);
        if (!owner) throw scopeError("Cannot prove the PSD artboard for GameUI layer " + key + ".");
        if (record(marker) && identity(marker.nodeId)) {
            nodeIds.set(marker.nodeId, (nodeIds.get(marker.nodeId) || 0) + 1);
            if (identity(marker.assetRef)) {
                const firstOwner = firstAssetOwners.get(marker.assetRef);
                if (firstOwner && firstOwner !== owner) sharedRefs.add(marker.assetRef);
                else firstAssetOwners.set(marker.assetRef, owner);
            }
        }
        if (!selected.has(owner)) continue;
        if (!partitions.has(owner)) partitions.set(owner, []);
        partitions.get(owner).push([key, marker]);
    }
    const result = new Map();
    for (const [owner, entries] of partitions) {
        if (boards.size > 1 && Object.keys(metadata).some(key => !DOCUMENT_FIELDS.has(key))) {
            throw scopeError("Unscoped GameUI document fields cannot be exported to multiple PSD artboards.");
        }
        const refs = new Set(), targets = new Set(), ids = new Set();
        for (const [, marker] of entries) {
            validateMarker(marker, metadata.assets, ids);
            if (nodeIds.get(marker.nodeId) !== 1) throw scopeError("Duplicate GameUI node identity across PSD artboards.");
            refs.add(marker.assetRef);
            if (marker.kind === "image") targets.add(marker.nodeId);
        }
        const nodes = Object.fromEntries(entries);
        const assets = Object.fromEntries([...refs].map(ref => [ref, metadata.assets[ref]]));
        const scoped = { ...metadata,
            artboardId: "ps-artboard:" + encodeURIComponent(metadata.documentId) + ":" + owner, nodes, assets };
        const authoring = authoringData(metadata);
        for (const ref of refs) {
            if (sharedRefs.has(ref) && (!authoring || !owns(authoring.sources, ref))) {
                throw scopeError("GameUI source snapshot is missing for a version shared across PSD artboards.");
            }
        }
        if (authoring) {
            if (authoring.targets !== undefined && !record(authoring.targets)) {
                throw new Error("GameUI authoring targets must be a nodeId map.");
            }
            scoped.authoring = { version: 1,
                sources: Object.fromEntries(Object.entries(authoring.sources).filter(([ref]) => refs.has(ref))),
                targets: Object.fromEntries(Object.entries(authoring.targets || {}).filter(([id]) => targets.has(id))) };
        }
        result.set(owner, scoped);
    }
    return { owners, metadataByBoard: result };
}

async function prepareAnalysis(document, config, activeDocument, expected) {
    const documentId = nativeId(document && document.id);
    const activeId = nativeId(activeDocument && (activeDocument.id ?? activeDocument._id));
    if (!documentId || activeId !== documentId || !Array.isArray(document.layers)) {
        throw scopeError("Cannot verify the active PSD for this upload.");
    }
    const boards = new Map();
    for (const layer of document.layers) {
        if (layer.type !== "artboardSection") continue;
        const id = nativeId(layer.id);
        if (!id || boards.has(id)) throw scopeError("Invalid or duplicate PSD artboard layer ID.");
        boards.set(id, layer);
    }
    const requested = Array.isArray(config.selectArtboards) ? config.selectArtboards.map(board => nativeId(board && board.id)) : [];
    const selected = new Set(requested);
    if (!selected.size || selected.size !== requested.length ||
        requested.some(id => boards.size ? !boards.has(id) : id !== documentId)) {
        throw scopeError("The upload list does not match the available PSD artboards.");
    }
    if (expected && (String(expected.documentId) !== documentId ||
        expected.boardIds.length !== selected.size || requested.some(id => !expected.boardIds.includes(id)))) {
        throw scopeError("The document or selected artboards changed before export.");
    }
    const metadata = await scopedMetadata(config, document.id, activeDocument.name || activeDocument.title || document.name,
        (config.projectId || config.projectID) === TEST_PROJECT);
    const plan = { config, documentId, boards, selected, metadata };
    if (metadata && boards.size && Object.keys(metadata.nodes).length) {
        Object.assign(plan, partitionMetadata(document, boards, selected, metadata));
    }
    analyses.set(document, plan);
    return document;
}

async function capture(payload, config, documentId, formatter, input) {
    let metadata, owners, boardId;
    if (input) {
        const plan = analyses.get(input.document);
        if (!plan || plan.config !== config || plan.documentId !== nativeId(documentId)) {
            throw scopeError("GameUI upload has no verified PSD selection.");
        }
        const isArtboard = plan.boards.size > 0;
        boardId = isArtboard ? nativeId(input.board && input.board.id) : plan.documentId;
        if (input.mode !== (isArtboard ? "ArtBoard" : "Background") || !plan.selected.has(boardId) ||
            (isArtboard ? plan.boards.get(boardId) !== input.board : input.board !== undefined) ||
            !payload.artboard || nativeId(payload.artboard.originID) !== boardId ||
            payload.artboard.documentMode !== (isArtboard ? "artboard" : "document")) {
            throw scopeError("The formatted artboard does not match the selected PSD artboard.");
        }
        if (isArtboard) {
            metadata = plan.metadataByBoard && plan.metadataByBoard.get(boardId);
            owners = plan.owners;
        } else if (plan.metadata && Object.keys(plan.metadata.nodes).length) metadata = plan.metadata;
    } else {
        metadata = await scopedMetadata(config, documentId, documentName(payload));
        if (metadata && payload.artboard && payload.artboard.documentMode === "artboard") {
            throw scopeError("GameUI artboard upload requires a verified PSD selection.");
        }
    }
    const layers = payload.artboard && payload.artboard.layers;
    if (owners) {
        if (!Array.isArray(layers)) throw scopeError("Missing formatted PSD artboard layers.");
        const origins = new Set();
        walk(layers, layer => {
            const key = nativeId(layer.originID);
            if (!key || owners.get(key) !== boardId || origins.has(key)) {
                throw scopeError("The formatted layer has ambiguous origin in the selected PSD artboard.");
            }
            origins.add(key);
        });
    }
    if (!metadata) return payload;
    validateMetadata(metadata);
    if (!Array.isArray(layers)) throw new Error("Missing native artboard layers.");
    const authoring = authoringData(metadata);
    const targets = validateTargets(authoring, metadata.nodes);
    const corrections = [];
    const snapshots = new Map();
    for (const [ref, source] of Object.entries(authoring ? authoring.sources : {})) {
        if (!owns(metadata.assets, ref)) throw new Error("Unknown authoring asset: " + ref);
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
        if (!owns(metadata.nodes, key)) return;
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
        if (!found.has(key)) throw scopeError("GameUI node was not exported: " + key);
    }
    const injected = [];
    for (const [ref, asset] of Object.entries(metadata.assets)) {
        if (sources.has(ref)) continue;
        if (!snapshots.has(ref)) throw new Error("GameUI source snapshot is missing: " + ref);
        const sourceScope = owners ? metadata.artboardId : metadata.documentId;
        const id = "gameui-source:" + (owners ? encodeURIComponent(sourceScope) + ":" : "") + encodeURIComponent(ref);
        const nodeId = "gameui-resource:" + encodeURIComponent(sourceScope) + ":" + encodeURIComponent(ref);
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
    if (!payload.gameUI && !captured.has(payload)) return payload;
    destination(config);
    // capture removes the local scope. Only payloads captured in this process are eligible.
    if (!captured.has(payload)) throw new Error("GameUI payload was not captured by this adapter.");
    validateMetadata(payload.gameUI);
    if (payload.artboard?.gameUI?.artboardId !== payload.gameUI.artboardId) {
        throw scopeError("The uploaded GameUI artboard identity differs from its metadata.");
    }
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

module.exports = { capture, finalize, prepareAnalysis };
