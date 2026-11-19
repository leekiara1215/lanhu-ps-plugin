"use strict";

const { Route } = require("../ui/navigation.js");
const { sliceDimensionInput, sliceFrameDraft } = require("../domain/parameters.js");

function createSliceWorkspace({ $, controls, host, task, view, getRoute }) {
    const { display, onClick } = controls;
    let sliceSelectionKey = null;

    function updateControls(view, doc, locked) {
        const sliceLocked = locked || !view.connected;
        $("lanhuSliceLayer").disabled = sliceLocked || !view.slice?.canMark;
        for (const id of ["lanhuSliceGroup", "lanhuSliceWidth", "lanhuSliceHeight"]) {
            $(id).disabled = sliceLocked || !(view.slice?.canFrame ?? view.slice?.canMark);
        }
        $("lanhuUnslice").disabled = locked || !view.connected || !view.slice?.marked;
        $("lanhuSliceVisibility").disabled = sliceLocked || !doc;
        $("lanhuSliceHelp").disabled = sliceLocked;
    }

    function render(view, doc) {
        display("lanhuSliceTools", view.connected);
        display("lanhuSliceFooter", getRoute() === Route.SLICE && view.connected);
        if (getRoute() !== Route.SLICE) return;
        const slice = view.slice;
        const layers = doc && doc.activeLayers ? Array.from(doc.activeLayers) : [];
        const sliceLabel = layers.length === 1 ? "已选：" + layers[0].name :
            layers.length > 1 ? "已选 " + layers.length + " 个图层" : "请在 Photoshop 中选择图层或图层组。";
        const markerLabels = { frame: "已标记框选切图", tight: "已标记按内容切图", mixed: "已标记 " + slice?.marked + " 处切图" };
        const sliceState = slice?.marked ? markerLabels[slice.mode] : layers.length && slice && !slice.canMark ? "选层包含已有切图" : "";
        $("lanhuSliceSelection").textContent = sliceLabel + (sliceState ? "\n" + sliceState : "");
        display("lanhuSliceLayer", !slice?.marked);
        display("lanhuUnslice", !!slice?.marked);
        display("lanhuSliceResizeHint", slice?.mode === "frame");
        $("lanhuSliceVisibility").setAttribute("aria-checked", String(slice?.regionsVisible !== false));
        $("lanhuSliceVisibility").textContent = slice?.regionsVisible === false ? "显示切图区域 · 关" : "显示切图区域 · 开";
        const selectionKey = JSON.stringify([doc?.id, slice?.ids, slice?.marked]);
        for (const [id, size] of [["lanhuSliceWidth", slice?.width], ["lanhuSliceHeight", slice?.height]]) {
            const input = $(id);
            if (selectionKey !== sliceSelectionKey) input.value = "";
            input.setAttribute("placeholder", size > 0 ? String(size) : "随图层");
        }
        sliceSelectionKey = selectionKey;
    }
    for (const id of ["lanhuSliceWidth", "lanhuSliceHeight"]) $(id).addEventListener("input", () => {
        const input = $(id), value = sliceDimensionInput(input.value);
        if (input.value !== value) input.value = value;
    });
    onClick($("lanhuSliceGroup"), () => {
        const frame = sliceFrameDraft($("lanhuSliceWidth").value, $("lanhuSliceHeight").value);
        return task(() => host.perform("sliceWithGroup", frame));
    });
    onClick($("lanhuSliceVisibility"), () => task(() =>
        host.perform(view().slice?.regionsVisible === false ? "showSlice" : "hiddenSlice")));
    for (const [id, action] of [["lanhuSliceLayer", "sliceWithLayer"], ["lanhuUnslice", "unslice"], ["lanhuSliceHelp", "sliceHelp"]]) {
        onClick($(id), () => task(() => host.perform(action)));
    }
    return { render, updateControls };
}

module.exports = { createSliceWorkspace };
