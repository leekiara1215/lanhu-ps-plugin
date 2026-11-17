"use strict";

const photoshop = require("photoshop");
const { XMPMeta } = require("uxp").xmp;
const namespace = "https://bettagames.com/ns/gameUI/1.0/";
XMPMeta.registerNamespace(namespace, "gameUI");

async function readMetadata(documentId) {
    const values = await photoshop.action.batchPlay([{
        _obj: "get",
        _target: [{ _property: "XMPMetadataAsUTF8" }, { _ref: "document", _id: documentId }],
        _options: { dialogOptions: "dontDisplay" }
    }], {});
    if (values[0]._obj === "error") throw new Error(values[0].message);
    const xmp = new XMPMeta(values[0].XMPMetadataAsUTF8 || "");
    const property = xmp.getProperty(namespace, "metadata");
    if (property === undefined || property === null) return { xmp, metadata: null };
    try { return { xmp, metadata: JSON.parse(String(property)) }; }
    catch (cause) {
        const error = new Error("GameUI metadata JSON is invalid. Repair the PSD metadata before upload.");
        error.code = "GAMEUI_METADATA_INVALID";
        Object.defineProperty(error, "cause", { value: cause });
        throw error;
    }
}

async function writeMetadata(documentId, metadata) {
    const { xmp } = await readMetadata(documentId);
    xmp.setProperty(namespace, "metadata", JSON.stringify(metadata));
    const values = await photoshop.action.batchPlay([{
        _obj: "set",
        _target: [{ _property: "XMPMetadataAsUTF8" }, { _ref: "document", _id: documentId }],
        to: { _obj: "XMPMetadataAsUTF8", XMPMetadataAsUTF8: xmp.serialize() },
        _options: { dialogOptions: "dontDisplay" }
    }], {});
    if (values[0]._obj === "error") throw new Error(JSON.stringify(values[0]));
    const readback = (await readMetadata(documentId)).metadata;
    if (JSON.stringify(readback) !== JSON.stringify(metadata)) throw new Error("PSD XMP readback differs.");
}

async function exportSourcePng(formatter, documentId, layerId, size) {
    const doc = photoshop.app.activeDocument;
    // The official Lanhu panel uses API 1; standalone .psjs uses API 2.
    const objectId = object => object.id === undefined ? object._id : object.id;
    if (!doc || objectId(doc) !== documentId) {
        throw new Error("GameUI source export requires the original document: expected " + documentId +
            ", active " + (doc ? objectId(doc) : "none") + ".");
    }
    if (!formatter || typeof formatter.exportSlice !== "function") {
        throw new Error("GameUI source export requires the native formatter.");
    }
    function find(layers) {
        for (const layer of layers) {
            if (objectId(layer) === layerId) return layer;
            const children = layer.layers || layer.children;
            const nested = children && find(children);
            if (nested) return nested;
        }
    }
    const layer = find(doc.layers);
    if (!layer) throw new Error("GameUI source layer no longer exists: " + layerId);
    const nativeBounds = layer.boundsNoEffects;
    const bounds = { left: nativeBounds.left, top: nativeBounds.top,
        right: nativeBounds.right, bottom: nativeBounds.bottom };
    if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isInteger) ||
        bounds.right - bounds.left !== size.width || bounds.bottom - bounds.top !== size.height) {
        throw new Error("GameUI source requires integer 1x pixel bounds matching its declared size.");
    }
    const png = await formatter.exportSlice(layerId, 1, bounds,
        { left: 0, top: 0, width: doc.width, height: doc.height });
    const bytes = new Uint8Array(png);
    const view = new DataView(png);
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value) ||
        view.getUint32(12) !== 0x49484452 || view.getUint32(16) !== size.width ||
        view.getUint32(20) !== size.height || bytes[24] !== 8 || (bytes[25] !== 2 && bytes[25] !== 6)) {
        throw new Error("Native source export is not the expected 1x 8-bit RGB/RGBA PNG.");
    }
    return png;
}

module.exports = { readMetadata, writeMetadata, exportSourcePng, namespace };

function flattenLayers(layers, result = []) {
    for (const layer of layers) {
        result.push(layer);
        if (layer.layers && layer.layers.length) flattenLayers(layer.layers, result);
    }
    return result;
}

function selectedLayer() {
    const doc = photoshop.app.activeDocument;
    if (!doc || doc.activeLayers.length !== 1) throw new Error("Open a PSD and select exactly one pixel layer.");
    return { doc, layer: doc.activeLayers[0] };
}

async function assertSupportedLayer(doc, layer) {
    if (layer.kind !== photoshop.constants.LayerKind.NORMAL || layer.isBackgroundLayer) {
        throw new Error("Only ordinary pixel layers are supported. Rasterize a separate copy explicitly; text, shapes, smart objects and groups are rejected.");
    }
    if (doc.mode !== photoshop.constants.DocumentMode.RGB || doc.bitsPerChannel !== photoshop.constants.BitsPerChannelType.EIGHT) {
        throw new Error("Use an 8-bit RGB document. Source snapshots are captured in sRGB.");
    }
    if (doc.colorProfileName !== "sRGB IEC61966-2.1") throw new Error("Only documents already using sRGB IEC61966-2.1 are supported. Convert a separate PSD explicitly before authoring.");
    for (let current = layer; current && current !== doc && current.typename !== "Document"; current = current.parent) {
        if (current.opacity !== 100 || current.fillOpacity !== 100 || current.isClippingMask || current.visible !== true ||
            (current.blendMode !== photoshop.constants.BlendMode.NORMAL &&
                !(current !== layer && current.blendMode === photoshop.constants.BlendMode.PASSTHROUGH))) {
            throw new Error("Use visible layers and parents at 100% opacity/fill with Normal (parent Pass Through allowed), without clipping.");
        }
        const values = await photoshop.action.batchPlay([{ _obj: "get", _target: [{ _ref: "layer", _id: current.id },
            { _ref: "document", _id: doc.id }], _options: { dialogOptions: "dontDisplay" } }], {});
        const descriptor = values[0];
        if (!descriptor || descriptor._obj === "error") throw new Error("Cannot prove this layer's appearance; Photoshop descriptor unavailable.");
        if (descriptor.hasUserMask || descriptor.hasVectorMask || descriptor.hasFilterMask || descriptor.layerEffects ||
            descriptor.blendOptions || descriptor.adjustment || descriptor.smartObject || descriptor.artboardEnabled) {
            throw new Error("Masks, styles, advanced blending, adjustments, smart objects and artboards require explicit flattening into an ordinary pixel copy.");
        }
    }
    const bounds = layer.boundsNoEffects;
    const b = { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
    if (!Object.values(b).every(Number.isInteger) || b.right <= b.left || b.bottom <= b.top) {
        throw new Error("Layer bounds must be nonempty integer source pixels.");
    }
    return b;
}

async function captureLayerSource(doc, layer, padding = { left: 0, top: 0, right: 0, bottom: 0 }) {
    const authoring = require("./gameui-authoring.js");
    const original = await assertSupportedLayer(doc, layer);
    for (const side of ["left", "top", "right", "bottom"]) {
        if (!Number.isInteger(padding[side]) || padding[side] < 0) throw new Error("Source canvas padding must be nonnegative integer pixels.");
    }
    const bounds = { left: original.left - padding.left, top: original.top - padding.top,
        right: original.right + padding.right, bottom: original.bottom + padding.bottom };
    const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
    if (width * height > authoring.MAX_PIXELS) throw new Error("Source exceeds the panel's 4,194,304 pixel limit.");
    const value = await photoshop.imaging.getPixels({ documentID: doc.id, layerID: layer.id, sourceBounds: bounds,
        colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1", componentSize: 8, applyAlpha: false });
    try {
        const image = value.imageData, actual = value.sourceBounds;
        if (!image || image.componentSize !== 8 || image.colorSpace !== "RGB" || ![3, 4].includes(image.components) || value.level !== 0 ||
            !actual || !Object.values(actual).every(Number.isInteger) || actual.left < bounds.left || actual.top < bounds.top ||
            actual.right > bounds.right || actual.bottom > bounds.bottom || image.width !== actual.right - actual.left || image.height !== actual.bottom - actual.top) {
            throw new Error("Photoshop did not return provable full-resolution 8-bit RGB(A) pixels.");
        }
        const raw = await image.getData({ chunky: true });
        if (raw.length !== image.width * image.height * image.components) throw new Error("Unexpected imaging buffer length.");
        const pixels = new Uint8Array(width * height * 4);
        for (let y = 0; y < image.height; y++) {
            for (let x = 0; x < image.width; x++) {
                const src = (y * image.width + x) * image.components;
                const dst = ((y + actual.top - bounds.top) * width + x + actual.left - bounds.left) * 4;
                pixels.set(raw.subarray(src, src + 3), dst);
                pixels[dst + 3] = image.components === 4 ? raw[src + 3] : 255;
            }
        }
        return authoring.snapshot(pixels, width, height);
    } finally { if (value.imageData) value.imageData.dispose(); }
}

async function locateLayer(documentId, layerId) {
    const values = await photoshop.action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: Number(layerId) },
        { _ref: "document", _id: documentId }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }], {});
    if (values[0]._obj === "error") throw new Error(values[0].message);
}

Object.assign(module.exports, { flattenLayers, selectedLayer, assertSupportedLayer, captureLayerSource, locateLayer });

function assertTargetLayer(layer, target, canvasOrigin) {
    require("./gameui-authoring.js").validateTarget(target);
    const bounds = layer.boundsNoEffects;
    if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isInteger) ||
        bounds.right - bounds.left !== target.contentWidth || bounds.bottom - bounds.top !== target.contentHeight ||
        (canvasOrigin && (bounds.left !== canvasOrigin.left + target.insetLeft || bounds.top !== canvasOrigin.top + target.insetTop))) {
        throw new Error("Layer content bounds differ from the recorded target canvas. Reapply the target size using the GameUI panel.");
    }
    return { left: bounds.left - target.insetLeft, top: bounds.top - target.insetTop };
}

async function applyLayerPreview(doc, layer, source, asset, width, height, previousTarget) {
    const authoring = require("./gameui-authoring.js");
    const bounds = await assertSupportedLayer(doc, layer);
    if (previousTarget) authoring.validateTarget(previousTarget);
    const origin = { left: bounds.left - (previousTarget ? previousTarget.insetLeft : 0),
        top: bounds.top - (previousTarget ? previousTarget.insetTop : 0) };
    const pixels = authoring.preview(source, asset.nineSlice, width, height, asset.sampling);
    const target = authoring.targetFromPixels(pixels, width, height);
    const imageData = await photoshop.imaging.createImageDataFromBuffer(pixels, {
        width, height, components: 4, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1"
    });
    try {
        await photoshop.imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData,
            targetBounds: origin, replace: true });
        assertTargetLayer(layer, target, origin);
        return target;
    } finally { imageData.dispose(); }
}

Object.assign(module.exports, { applyLayerPreview, assertTargetLayer });
