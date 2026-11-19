"use strict";

const { Route } = require("../ui/navigation.js");
const { createUploadWorkspace } = require("./upload.js");
const { createSliceWorkspace } = require("./slice.js");

const installMessage = "当前安装的是 GameUI 独立版。蓝湖上传和切图需要安装带蓝湖功能的集成版。";

function createLanhuWorkspace({ ps, uxp, $, controls, document, hostWindow, nativeRequire, loadRuntime,
    createLanhuHost, testProjectId, getRoute, isResourceBusy, isDestroyed, errorText }) {
    const { onClick, display, scheduleInputClipping } = controls;
    const included = $("lanhuPane").getAttribute("data-lanhu-runtime") === "included";
    const reconnectButtons = [$("lanhuReconnect"), $("lanhuSliceReconnect")];
    let busy = false;
    const host = createLanhuHost({ ps, uxp, document, window: hostWindow || {}, nativeRequire, loadRuntime,
        onStatus: message, onChange: render });
    const context = { $, controls, document, hostWindow, host, task, view, activeDocument, getRoute };
    const upload = createUploadWorkspace({ ...context, testProjectId });
    const slice = createSliceWorkspace(context);

    function message(text) {
        if (isDestroyed()) return;
        $(getRoute() === Route.SLICE ? "lanhuSliceStatus" : "lanhuStatus").textContent = text;
        scheduleInputClipping();
    }
    function activeDocument() {
        try { return ps.app.activeDocument; } catch (_) { return null; }
    }
    function view() {
        return typeof host.workspace === "function" ? host.workspace({ includeSlice: getRoute() === Route.SLICE }) :
            { ...host.status(), teams: [], projects: [], groups: [], allArtboards: [], selectedArtboards: [], scales: {} };
    }
    function updateControls(state = view(), doc = activeDocument()) {
        const locked = isResourceBusy() || busy || state.uploading;
        $("connectLanhu").disabled = locked;
        const retryLabel = busy ? "正在连接蓝湖…" : "重新连接蓝湖";
        for (const button of reconnectButtons) {
            button.disabled = locked;
            if (button.textContent !== retryLabel) button.textContent = retryLabel;
        }
        for (const id of ["lanhuUploadTab", "lanhuSliceTab", "resourcesTab", "tabPublicResources", "tabAuthoring", "authoringBack"]) {
            $(id).disabled = locked;
        }
        upload.updateControls(state, doc, locked);
        slice.updateControls(state, doc, locked);
    }
    function render() {
        if (isDestroyed()) return;
        const state = view(), doc = activeDocument(), route = getRoute();
        if (!included && (route === Route.UPLOAD || route === Route.SLICE)) message(installMessage);
        display("lanhuTeam", state.loggedIn && (route === Route.UPLOAD || route === Route.SLICE));
        for (const button of reconnectButtons) button.style.display = included && !state.connected ? "flex" : "none";
        upload.render(state, doc);
        slice.render(state, doc);
        updateControls(state, doc);
        scheduleInputClipping();
    }
    async function task(action) {
        if (!included || busy || isResourceBusy() || isDestroyed() || host.status().uploading) return;
        busy = true;
        try {
            updateControls();
            if (!host.status().connected) { message("正在加载蓝湖工具…"); await host.connect(); }
            if (!isDestroyed()) await action();
        } catch (error) { message(errorText(error)); }
        finally { busy = false; render(); }
    }
    function connect() {
        return task(async () => {
            if (typeof host.perform === "function") await host.perform("refresh");
            message(host.status().loggedIn ? "账号与项目已刷新。" : "请使用蓝湖账号登录。");
        });
    }
    function open() {
        if (included && !host.status().connected) return connect();
    }

    onClick($("connectLanhu"), connect);
    for (const button of reconnectButtons) onClick(button, connect);
    return {
        render, updateControls, open, destroy: () => host.destroy(),
        isBusy: () => busy,
        isUploading: () => !!host.status().uploading
    };
}

module.exports = { createLanhuWorkspace };
