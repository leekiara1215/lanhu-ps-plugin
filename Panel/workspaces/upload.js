"use strict";

const { Route } = require("../ui/navigation.js");
const { BoardScope, boardsForScope, freezeUploadSelection, readBoardScope, uploadSettings } = require("../domain/parameters.js");

function createUploadWorkspace({ $, controls, document, hostWindow, host, task, view, activeDocument, getRoute, testProjectId }) {
    const { display, fillSelect, toggleSection, onClick, onValueChange, makeSelect, scrollPanelTo, hasOpenPicker, openPicker } = controls;
    let boardScope = BoardScope.ALL;
    let lastLanhuLogin = false;
    makeSelect("lanhuDevice", [{ id: "", name: "请选择平台", disabled: true }, ...["iOS", "Android", "Web"].map(id => ({ id, name: id }))]);
    makeSelect("lanhuTeam", [{ id: "", name: "请先登录" }], "", { headerAnchor: true });
    makeSelect("lanhuGroup", [{ id: "", name: "项目根目录" }]);
    for (const id of ["lanhuProject", "lanhuScale"]) makeSelect(id, [{ id: "", name: "请先登录或选择项目" }]);

    function updateControls(view, doc, locked) {
        const settingsLocked = locked || !!view.upload;
        const canUpload = view.connected && view.loggedIn && view.projectId === testProjectId;
        $("lanhuUploadAction").disabled = settingsLocked || !canUpload || !doc || !boardsForScope(view).length || !view.deviceType || !view.deviceScale;
        $("lanhuLoginAction").disabled = locked || !view.connected || view.loggedIn || view.browserAuthorizing;
        const authorizing = !!view.browserAuthorizing;
        $("lanhuBrowserAuth").disabled = locked || !view.connected || authorizing || view.loggedIn;
        $("lanhuCancelAuth").disabled = locked || !authorizing;
        $("lanhuCancelAuth").style.display = authorizing ? "block" : "none";
        if (authorizing) $("lanhuLoginAction").disabled = true;
        $("lanhuAuthHint").textContent = authorizing ? "等待浏览器授权…完成后将自动更新账号状态。" : "在浏览器登录蓝湖并授权，完成后将自动返回登录状态。";
        $("lanhuLogout").disabled = settingsLocked || !view.loggedIn;
        for (const id of ["lanhuTeam", "lanhuProject", "lanhuGroup", "lanhuToggleSettings"]) $(id).disabled = settingsLocked || !view.loggedIn;
        for (const id of ["lanhuDevice", "lanhuScale", "lanhuBoardsAll", "lanhuBoardsSelected"]) $(id).disabled = settingsLocked || !view.connected;
        for (const id of ["lanhuBack", "lanhuRetryUpload", "lanhuForceUpload", "lanhuViewUpload", "lanhuNotifyUpload"]) {
            $(id).disabled = locked || !view.connected;
        }
        $("lanhuFooterHint").textContent = view.uploading ? "正在上传，请稍候。" : view.upload ? "" : !canUpload ? "请先选择隔离测试项目。" :
            !doc ? "请先打开 Photoshop 文档。" : view.artboardsPending ? "正在读取当前文档画板…" :
            !view.deviceType || !view.deviceScale ? "请选择平台和设计倍数。" :
            !boardsForScope(view).length ? "当前范围没有可上传的画板。" : "";
    }

    function render(view, doc) {
        $("lanhuAccountSummary").textContent = view.loggedIn ? (view.userName || "已登录") : "未登录";
        if (view.loggedIn !== lastLanhuLogin) {
            lastLanhuLogin = view.loggedIn;
            toggleSection("lanhuTogglePassword", "lanhuPasswordForm", false, "使用账号密码");
            $("lanhuPassword").value = "";
        }
        display("lanhuLogin", view.connected && !view.loggedIn);
        const uploadForm = view.loggedIn && !view.upload && !view.uploading;
        display("lanhuSettings", uploadForm);
        $("lanhuToggleSettings").style.display = uploadForm ? "flex" : "none";
        if (!uploadForm && $("lanhuToggleSettings").getAttribute("aria-expanded") === "true") {
            toggleSection("lanhuToggleSettings", "lanhuAccountSettings", false);
        }
        display("lanhuFooter", getRoute() === Route.UPLOAD && (view.loggedIn || view.upload || view.uploading));
        fillSelect("lanhuTeam", view.teams || [], view.teamId, view.loggedIn ? "请选择团队" : "登录后选择团队");
        fillSelect("lanhuProject", (view.projects || []).map(item => ({ ...item, disabled: item.id !== testProjectId, name: item.name + (item.id === testProjectId ? "（测试项目）" : "（当前不可上传）") })), view.projectId, "请选择测试项目");
        fillSelect("lanhuGroup", view.groups || [], view.groupId, "项目根目录", true);
        $("lanhuDevice").value = view.deviceType || "";
        renderLanhuScales(view.deviceType, view.deviceScale, view.scales);
        boardScope = readBoardScope(view.artboardType);
        $("lanhuBoardsAll").textContent = "全部画板（" + (view.allArtboards || []).length + "）";
        $("lanhuBoardsSelected").textContent = "选中画板（" + (view.selectedArtboards || []).length + "）";
        $("lanhuBoardsAll").setAttribute("aria-pressed", boardScope === BoardScope.ALL ? "true" : "false");
        $("lanhuBoardsSelected").setAttribute("aria-pressed", boardScope === BoardScope.SELECTED ? "true" : "false");
        $("lanhuDocument").textContent = "当前文档：" + (doc ? doc.title || doc.name || "未命名" : "未打开 PSD");
        const boards = doc ? boardsForScope(view) : [];
        const signature = JSON.stringify([!!doc, view.artboardsPending, boardScope, boards]);
        if ($("lanhuBoardList").workspaceSignature !== signature) {
            $("lanhuBoardList").textContent = boards.length ? "" : !doc ? "请先打开 Photoshop 文档。" :
                view.artboardsPending ? "正在读取当前文档画板…" :
                boardScope === BoardScope.SELECTED ? "请在 Photoshop 选中要上传的画板，或手动切换为全部画板。" : "当前文档没有可上传的画板。";
            for (const board of boards) {
                const row = document.createElement("div"); row.className = "lanhu-board-row"; row.setAttribute("role", "listitem"); row.textContent = board.name; $("lanhuBoardList").appendChild(row);
            }
            $("lanhuBoardList").workspaceSignature = signature;
        }
        display("lanhuUploadResults", !!view.upload || !!view.uploading);
        const result = view.uploading ? null : view.upload;
        $("lanhuResultActions").style.display = result ? "flex" : "none";
        display("lanhuRetryUpload", !!result?.canRetry);
        display("lanhuForceUpload", !!result?.canForce);
        display("lanhuViewUpload", !!result?.canView);
        display("lanhuNotifyUpload", !!result?.canView && result.phase === "success");
        $("lanhuBack").textContent = result?.phase === "success" ? "完成" : result?.phase === "unchanged" ? "好的" : "返回";
        display("lanhuUploadAction", !view.upload && !view.uploading);
        $("lanhuUploadAction").textContent = boards.length ? "上传 " + boards.length + " 个画板" : "上传到蓝湖";
        renderLanhuUploadResults(view);
    }
    function renderLanhuUploadResults(view) {
        const progress = $("lanhuProgress"), list = $("lanhuUploadRows");
        const { phase, percentage, total, success, fail, unchanged = 0, rows = [] } = view.upload || {};
        const titles = { uploading: "正在上传", success: "上传成功", fail: "上传失败", unchanged: "画板无变化", blocked: "已停止提交" };
        const partial = phase === "fail" && success > 0 && fail > 0;
        const hint = partial && view.upload?.canRetry ? "\n可以只重试失败画板。" :
            partial || !titles[phase] ? "\n请先在蓝湖核对已收到的画板，不要直接重传整批。" : "";
        const successLabel = phase === "uploading" ? "待提交 " : phase === "unknown" ? "待确认 " : phase === "blocked" ? "未提交 " : "成功 ";
        const counts = "共 " + total + " 项 · " + successLabel + success +
            " 项 · 失败 " + fail + " 项 · 无变化 " + unchanged + " 项";
        const title = partial ? "部分画板上传成功" : titles[phase] || "上传结果待确认";
        const summary = view.upload ? title + "\n" + (phase === "uploading" ? "进度 " + percentage + "% · " : "") + counts + hint :
            view.uploading ? "正在准备上传…" : "";
        if (progress.textContent !== summary) progress.textContent = summary;
        const signature = JSON.stringify(rows);
        if (list.workspaceSignature === signature) return;
        list.textContent = "";
        const labels = { pending: "处理中", prepared: "等待提交", success: "已上传", fail: "失败", unchanged: "无变化", unknown: "待确认", unsubmitted: "未提交" };
        for (const item of rows) {
            const row = document.createElement("div");
            row.className = "lanhu-board-row";
            row.setAttribute("role", "listitem");
            row.setAttribute("data-state", item.state);
            row.textContent = item.name + " · " + labels[item.state] + (item.reason ? "\n" + item.reason : "");
            list.appendChild(row);
        }
        list.workspaceSignature = signature;
    }
    function renderLanhuScales(device, selected, scales) {
        const rows = scales && scales[device] || [];
        fillSelect("lanhuScale", rows.map(item => ({ id: item.label, name: item.label + " · " + item.value })), selected, "请选择设计倍数");
    }
    async function uploadLanhu() {
        if ($("lanhuUploadAction").disabled) return;
        const doc = activeDocument(), boards = boardsForScope(view());
        if (!doc || !boards.length) return;
        const selection = freezeUploadSelection(doc.id, boards);
        return task(async () => {
            scrollPanelTo(0);
            await host.upload(selection);
        });
    }
    onClick($("lanhuToggleSettings"), () => {
        const open = $("lanhuAccountSettings").style.display === "none";
        toggleSection("lanhuToggleSettings", "lanhuAccountSettings", open);
    });
    onClick($("lanhuTogglePassword"), () => {
        const open = $("lanhuPasswordForm").style.display !== "block";
        if (!open) $("lanhuPassword").value = "";
        toggleSection("lanhuTogglePassword", "lanhuPasswordForm", open, open ? "收起账号登录" : "使用账号密码");
    });
    onClick($("lanhuUploadAction"), uploadLanhu);
    onClick($("lanhuLoginAction"), () => task(async () => {
        const credentials = { account: $("lanhuAccount").value, password: $("lanhuPassword").value };
        $("lanhuPassword").value = "";
        await host.perform("login", credentials);
    }));
    onClick($("lanhuLogout"), () => task(() => host.perform("logout")));
    onClick($("lanhuBrowserAuth"), () => task(() => host.perform("browserAuth")));
    onClick($("lanhuCancelAuth"), () => task(() => host.perform("cancelBrowserAuth")));
    for (const [id, action] of [["lanhuTeam", "team"], ["lanhuProject", "project"], ["lanhuGroup", "group"]]) {
        onValueChange($(id), () => { const value = $(id).value; return task(() => host.perform(action, value)); });
    }
    function saveLanhuSettings(scope = boardScope) {
        const draft = uploadSettings($("lanhuDevice").value, $("lanhuScale").value, scope);
        const { deviceType, deviceScale } = draft;
        return task(() => host.perform("settings", { deviceType, deviceScale,
            artboardType: draft.scope === BoardScope.SELECTED ? 2 : 1 }));
    }
    onValueChange($("lanhuDevice"), async () => {
        const device = $("lanhuDevice").value, scales = view().scales;
        const first = scales && scales[device] && scales[device][0];
        renderLanhuScales(device, first && first.label, scales);
        await saveLanhuSettings();
        const openScale = () => {
            if (!hasOpenPicker() && first && getRoute() === Route.UPLOAD && view().deviceType === device) {
                openPicker("lanhuScale");
            }
        };
        // Let the platform option's click finish bubbling before opening another popup.
        if (typeof hostWindow?.requestAnimationFrame === "function") hostWindow.requestAnimationFrame(openScale);
        else openScale();
    });
    onValueChange($("lanhuScale"), () => saveLanhuSettings());
    onClick($("lanhuBoardsAll"), () => saveLanhuSettings(BoardScope.ALL));
    onClick($("lanhuBoardsSelected"), () => saveLanhuSettings(BoardScope.SELECTED));

    for (const [id, action] of [["lanhuRetryUpload", "retryUpload"], ["lanhuForceUpload", "forceUpload"], ["lanhuViewUpload", "viewUpload"],
        ["lanhuNotifyUpload", "notifyUpload"], ["lanhuBack", "back"]]) {
        onClick($(id), () => task(() => host.perform(action)));
    }
    return { render, updateControls };
}

module.exports = { createUploadWorkspace };
