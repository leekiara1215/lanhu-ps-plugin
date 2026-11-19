"use strict";

const BoardScope = Object.freeze({ ALL: "all", SELECTED: "selected" });
const Sampling = Object.freeze({ POINT: "Point", BILINEAR: "Bilinear" });
const SIDES = Object.freeze(["left", "top", "right", "bottom"]);
const SLICE_MAX_SIZE = 9999;
const SLICE_MAX_DIGITS = String(SLICE_MAX_SIZE).length;

/**
 * @typedef {"all" | "selected"} ArtboardScope
 * @typedef {{deviceType: string, deviceScale: string, scope: ArtboardScope}} UploadDraft
 * @typedef {{width: string, height: string}} SliceFrameDraft
 * @typedef {{left: number, top: number, right: number, bottom: number}} SourceInsets
 * @typedef {{displayName: string, filterMode: string, nineSlice: SourceInsets}} NineSliceSettings
 * @typedef {{width: number, height: number}} TargetSize
 */

function readBoardScope(nativeValue) {
    return Number(nativeValue) === 2 ? BoardScope.SELECTED : BoardScope.ALL;
}

/**
 * @param {string} deviceType
 * @param {string} deviceScale
 * @param {ArtboardScope} scope
 * @returns {UploadDraft}
 */
function uploadSettings(deviceType, deviceScale, scope) {
    return { deviceType, deviceScale, scope };
}

function boardsForScope(view) {
    return (readBoardScope(view.artboardType) === BoardScope.SELECTED ? view.selectedArtboards : view.allArtboards) || [];
}

/** Keep precisely the PSD and artboard IDs the user confirmed, even if the host then refreshes. */
function freezeUploadSelection(documentId, boards) {
    return Object.freeze({ documentId, boardIds: Object.freeze(boards.map(board => board.id)) });
}

function sliceDimensionInput(value) {
    return value.replace(/\D/g, "").slice(0, SLICE_MAX_DIGITS);
}

/** @returns {SliceFrameDraft} */
function sliceFrameDraft(width, height) {
    return { width: String(width ?? "").trim(), height: String(height ?? "").trim() };
}

/** Blank frame dimensions delegate to the relevant selection bounds. */
function validSliceDimension(value) {
    if (value === "") return true;
    const size = Number(value);
    return value.length <= SLICE_MAX_DIGITS && /^\d+$/.test(value) && size >= 1 && size <= SLICE_MAX_SIZE;
}

function pixelInsets(values) {
    return Object.fromEntries(SIDES.map(side => [side, Number(values[side])]));
}

/**
 * Authoring validates the draft before storage or application.
 * @returns {NineSliceSettings}
 */
function nineSliceSettings({ displayName, filterMode, ...insets }) {
    return { displayName, filterMode, nineSlice: pixelInsets(insets) };
}

/**
 * Instance dimensions count the whole target canvas in pixels.
 * @returns {TargetSize}
 */
function targetSize(width, height) {
    return { width: Number(width), height: Number(height) };
}

module.exports = {
    BoardScope, Sampling, SIDES, boardsForScope, freezeUploadSelection, nineSliceSettings,
    pixelInsets, readBoardScope, sliceDimensionInput, sliceFrameDraft, targetSize, uploadSettings, validSliceDimension
};
