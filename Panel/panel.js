"use strict";
const ps = require("photoshop");
const uxp = require("uxp");
const store = require("./gameui-ps.js");
const author = require("./gameui-authoring.js");
const { createLanhuHost } = require("./lanhu-host.js");
const fs = uxp.storage.localFileSystem;
const $ = id => document.getElementById(id);
let catalog = author.createMetadata();
let catalogFile;
let busy = false;
let catalogLoading = true;
let catalogFailure = null;
let explicitResourceRef = null;
let selectedResourceRef = "";
let resourceChoicesSignature = null;
let selectionIdentity = null;
let lastBoundRef = null;
let renderedRef = null;
let advancedOpen = false;
let listenerRegistered = false;
let notificationFailure = null;
let destroyed = false;
let editRevision = 0;
let resourceChoice = null;
const fieldEdits = new Map();
const selectionEvents = ["select", "open", "close"];
let lanhuBusy = false;
let lanhuHost;
let activeTab = "authoring";
let inlineLanhuOpen = false;

function lanhuMessage(message) {
    $("lanhuStatus").textContent = message;
    $("authoringLanhuStatus").textContent = message;
}
function updateLanhuControls(syncStatus = false) {
    const state = lanhuHost && lanhuHost.status();
    $("authoringUploadLanhu").disabled = busy || lanhuBusy || !state || !state.connected || state.uploading || !state.loggedIn;
    $("connectLanhu").disabled = busy || lanhuBusy;
    if (syncStatus && state && state.connected && !lanhuBusy) {
        lanhuMessage(state.loggedIn ? "蓝湖已登录；当前项目：" + (state.projectId || "尚未选择") : "蓝湖已加载，请在蓝湖工具页登录并选择测试项目。");
    }
}
function showTab(name) {
    activeTab = name;
    $("authoringPane").style.display = name === "authoring" ? "block" : "none";
    $("lanhuPane").style.display = name === "lanhu" ? "block" : "none";
    $("tabAuthoring").setAttribute("aria-selected", name === "authoring" ? "true" : "false");
    $("tabLanhu").setAttribute("aria-selected", name === "lanhu" ? "true" : "false");
    positionLanhuMount();
    updateLanhuControls(true);
}
function positionLanhuMount() {
    const destination = $(activeTab === "authoring" && inlineLanhuOpen ? "authoringLanhuInline" : "lanhuFullMount");
    const mount = $("lanhuMount");
    if (mount.parentNode !== destination) destination.appendChild(mount);
}
lanhuHost = createLanhuHost({ ps, uxp, document, window: typeof window === "undefined" ? {} : window,
    nativeRequire: require,
    loadRuntime() {
        try { return require("./lanhu-runtime.js"); }
        catch (cause) {
            const error = new Error("当前候选未包含蓝湖工具，请使用带蓝湖功能的集成候选。");
            Object.defineProperty(error, "cause", { value: cause }); throw error;
        }
    }, onStatus: lanhuMessage });
async function connectLanhu() {
    if (busy || lanhuBusy) return;
    lanhuBusy = true; updateLanhuControls();
    try {
        await lanhuHost.connect(); $("lanhuSetup").style.display = "none";
    } catch (error) { lanhuMessage(error.message); }
    finally { lanhuBusy = false; updateLanhuControls(); }
}
async function uploadLanhu() {
    if (busy || lanhuBusy) return;
    lanhuBusy = true; updateLanhuControls();
    try { await lanhuHost.upload(); if (!inlineLanhuOpen || activeTab !== "authoring") showTab("lanhu"); }
    catch (error) { if (!inlineLanhuOpen || activeTab !== "authoring") showTab("lanhu"); lanhuMessage(error.message); }
    finally { lanhuBusy = false; updateLanhuControls(); }
}
$("tabAuthoring").addEventListener("click", () => showTab("authoring"));
$("tabLanhu").addEventListener("click", () => showTab("lanhu"));
$("authoringOpenLanhu").addEventListener("click", () => showTab("lanhu"));
$("authoringToggleLanhu").addEventListener("click", async () => {
    inlineLanhuOpen = !inlineLanhuOpen;
    $("authoringLanhuInline").style.display = inlineLanhuOpen ? "block" : "none";
    $("authoringToggleLanhu").textContent = inlineLanhuOpen ? "收起本页蓝湖工具" : "在本页展开蓝湖工具";
    positionLanhuMount();
    if (inlineLanhuOpen && !lanhuHost.status().connected) await connectLanhu();
    updateLanhuControls(true);
});
$("connectLanhu").addEventListener("click", connectLanhu);
$("authoringUploadLanhu").addEventListener("click", uploadLanhu);
$("openLanhuOfficial").addEventListener("click", async () => {
    try {
        if (!uxp.pluginManager) throw new Error("当前宿主未提供插件通信，请从增效工具菜单打开蓝湖。");
        const plugin = Array.from(await uxp.pluginManager.getPlugins()).find(item => item.id === "com.lanhu.ps");
        if (!plugin) throw new Error("没有找到已安装的官方蓝湖插件。");
        await plugin.showPanel("showlanhu");
    } catch (error) { lanhuMessage(error.message); }
});
showTab("authoring");

function displayText(value) {
    return String(value).replace(/[A-Za-z0-9._@:/-]{24,}/g, token => token.match(/.{1,20}/g).join("\n"));
}
function status(message) { $("status").textContent = displayText(message); }
function options() {
    return { displayName: $("displayName").value, filterMode: $("sampling").value,
        nineSlice: { left: Number($("left").value), top: Number($("top").value),
            right: Number($("right").value), bottom: Number($("bottom").value) } };
}
function resource() {
    const ref = selectedResourceRef;
    if (!ref || !catalog.assets[ref]) throw new Error("请先选择资源版本。");
    return ref;
}
function defaultField(id, value, pending) {
    const edit = fieldEdits.get(id);
    if (!pending || !edit || edit.key !== pending.key || edit.revision <= pending.revision) $(id).value = value;
}
function assetFields(pending) {
    const asset = catalog.assets[selectedResourceRef];
    if (!asset) {
        $("identityInfo").textContent = "新建公共资源；内部引用与版本由工具自动维护。";
        $("resourceInfo").textContent = "";
        updateMode(); return;
    }
    defaultField("displayName", asset.displayName || asset.assetKey || "", pending);
    $("identityInfo").textContent = displayText("诊断引用（工具维护）：\n" + selectedResourceRef);
    for (const side of ["left", "top", "right", "bottom"]) defaultField(side, String(asset.nineSlice[side]), pending);
    defaultField("sampling", asset.sampling ? asset.sampling.filterMode : "Bilinear", pending);
    $("sampling").setAttribute("value", $("sampling").value);
    $("resourceInfo").textContent = displayText(selectedResourceRef) + "\n" + asset.sourceSize.width + "×" + asset.sourceSize.height + " 源像素";
    updateMode();
}
function updateMode() {
    const asset = catalog.assets[selectedResourceRef];
    $("newResourceSettings").style.display = asset && !advancedOpen ? "none" : "block";
    $("inheritedContract").style.display = asset ? "block" : "none";
    $("inheritedContract").textContent = asset ? "自动继承：源 " + asset.sourceSize.width + "×" + asset.sourceSize.height +
        "，L/T/R/B " + [asset.nineSlice.left, asset.nineSlice.top, asset.nineSlice.right, asset.nineSlice.bottom].join("/") +
        "，" + (asset.sampling ? asset.sampling.filterMode : "Bilinear") : "";
    $("primaryAction").textContent = asset ? "引用资源并应用到选层" : "创建资源并应用到选层";
}
function renderResources(preferred, syncFields = true, pending) {
    const prior = preferred === undefined ? explicitResourceRef || "" : preferred;
    const entries = Object.keys(catalog.assets).sort().map(ref => ({ ref,
        label: (typeof catalog.assets[ref].displayName === "string" && catalog.assets[ref].displayName.trim() || "未命名资源") + " · v" + catalog.assets[ref].version }));
    const counts = new Map();
    for (const entry of entries) counts.set(entry.label, (counts.get(entry.label) || 0) + 1);
    const choices = [{ ref: "", label: "新建公共资源" }, ...entries.map((entry, index) => ({ ref: entry.ref,
        label: entry.label + (counts.get(entry.label) > 1 ? " · 条目 " + (index + 1) : "") }))];
    const signature = JSON.stringify(choices);
    if (signature !== resourceChoicesSignature) {
        const list = $("resources"); list.textContent = "";
        for (const choice of choices) {
            const button = document.createElement("button"); button.className = "resource-choice";
            button.setAttribute("type", "button");
            button.setAttribute("data-resource-ref", choice.ref);
            button.setAttribute("data-resource-label", choice.label);
            button.disabled = busy || catalogLoading || !!catalogFailure;
            button.addEventListener("click", () => chooseResource(choice.ref));
            list.appendChild(button);
        }
        resourceChoicesSignature = signature;
    }
    const selected = catalog.assets[prior] ? prior : "";
    selectedResourceRef = selected;
    markResourceChoice();
    $("resourceCount").textContent = entries.length + " 个资源版本；点击行选择，可在列表内滚动。";
    if (syncFields || renderedRef !== selected) assetFields(pending);
    else updateMode();
    renderedRef = selected;
}
function markResourceChoice() {
    for (const button of $("resources").children) {
        const selected = button.getAttribute("data-resource-ref") === selectedResourceRef;
        button.setAttribute("aria-pressed", selected ? "true" : "false");
        button.textContent = (selected ? "已选 · " : "") + button.getAttribute("data-resource-label");
    }
}
function chooseResource(ref) {
    if (destroyed || busy || catalogLoading || catalogFailure) return;
    if (ref && !catalog.assets[ref]) { status("该资源已不在目录中，请刷新后明确选择。"); return; }
    resourceChoice = { key: currentSelectionKey(), revision: ++editRevision };
    explicitResourceRef = selectedResourceRef = ref;
    if (!ref) $("displayName").value = "";
    assetFields(); renderedRef = ref;
    markResourceChoice();
}
async function persistCatalog(next) {
    author.validateMetadata(next);
    if (!catalogFile) {
        const folder = await fs.getDataFolder();
        catalogFile = await folder.createFile("gameui-resource-catalog.json", { overwrite: true });
    }
    const text = JSON.stringify(next, null, 2);
    await catalogFile.write(text);
    if (await catalogFile.read() !== text) throw new Error("目录写入回读不一致；请保留 PSD 并重试导出。");
    catalog = next;
}
async function metadata(doc) {
    const value = (await store.readMetadata(doc.id)).metadata;
    if (!value) throw new Error("当前 PSD 未初始化。先使用初始化按钮。");
    author.validateMetadata(value);
    if (!value.documentId || !value.artboardId) throw new Error("文档身份缺失；请明确分配全新身份。");
    return value;
}
async function collision(doc, value) {
    for (const other of ps.app.documents) {
        if (other.id === doc.id) continue;
        const candidate = (await store.readMetadata(other.id)).metadata;
        if (candidate && (candidate.documentId === value.documentId || candidate.artboardId === value.artboardId)) {
            throw new Error("检测到文档复制身份冲突（" + other.name + "）。请对副本分配全新身份。");
        }
    }
}
async function update(doc, next, checkCollision = true) {
    next.uploadScope = author.createMetadata().uploadScope;
    author.validateMetadata(next);
    if (checkCollision) await collision(doc, next);
    // Persist the portable copy first: an XMP failure leaves an unused catalog entry, never a lost source.
    const portable = JSON.parse(JSON.stringify(next)); portable.nodes = {};
    if (portable.authoring) delete portable.authoring.targets;
    for (const ref of Object.keys(portable.assets)) {
        if (!portable.authoring || !portable.authoring.sources[ref]) delete portable.assets[ref];
    }
    const nextCatalog = author.importDirectory(catalog, author.directory(portable));
    await persistCatalog(nextCatalog);
    await store.writeMetadata(doc.id, next);
}
async function modal(name, action) {
    return ps.core.executeAsModal(async execution => {
        const doc = ps.app.activeDocument;
        if (!doc) throw new Error("请先打开 PSD。");
        const suspension = await execution.hostControl.suspendHistory({ documentID: doc.id, name });
        try {
            const result = await action(doc);
            await execution.hostControl.resumeHistory(suspension);
            return result;
        } catch (error) {
            await execution.hostControl.resumeHistory(suspension, false);
            throw error;
        }
    }, { commandName: name });
}
function renderIssues(issues) {
    $("issues").textContent = "";
    for (const issue of issues) {
        const row = document.createElement("div"); row.className = "issue";
        const label = document.createElement("span"); label.textContent = displayText(issue.message); row.appendChild(label);
        if (issue.layerId && issue.code !== "MISSING_LAYER") {
            const button = document.createElement("button"); button.textContent = "定位";
            button.addEventListener("click", () => run(() => modal("定位检查图层", doc => store.locateLayer(doc.id, issue.layerId))));
            row.appendChild(button);
        }
        if (issue.code === "MISSING_LAYER") {
            const button = document.createElement("button"); button.textContent = "移除失效绑定";
            button.addEventListener("click", () => run(() => modal("移除失效绑定", async doc => {
                const value = await metadata(doc);
                if (store.flattenLayers(doc.layers).some(layer => String(layer.id) === String(issue.layerId))) throw new Error("图层已存在，请重新检查。");
                const nodeId = value.nodes[issue.layerId] && value.nodes[issue.layerId].nodeId;
                delete value.nodes[issue.layerId];
                if (nodeId && value.authoring && value.authoring.targets) delete value.authoring.targets[nodeId];
                await update(doc, value);
            })));
            row.appendChild(button);
        }
        $("issues").appendChild(row);
    }
}
function currentSelectionKey() {
    const doc = ps.app.activeDocument;
    return doc ? doc.id + ":" + Array.from(doc.activeLayers).map(layer => layer.id).sort().join(",") : "none";
}
function targetDefaults(value, selected, pending) {
    if (!selected) return;
    const marker = value && value.nodes[selected.id];
    const target = marker && value.authoring && value.authoring.targets && value.authoring.targets[marker.nodeId];
    const b = selected.boundsNoEffects;
    const width = target ? target.width : b.right - b.left, height = target ? target.height : b.bottom - b.top;
    if (Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0) {
        defaultField("targetWidth", String(width), pending); defaultField("targetHeight", String(height), pending);
    }
    $("targetHint").textContent = target ? "默认使用该实例已登记的完整目标画布；可直接修改宽高。" :
        "默认取当前选层整数非空边界；透明外沿不推测，需要时填写完整目标画布尺寸。";
}
async function refresh() {
    if (catalogLoading) { status("目录正在加载，请稍候。"); return; }
    if (catalogFailure) throw new Error("本地目录不可读，已阻止覆盖：" + catalogFailure + "。请显式导入备份目录恢复。");
    const revision = editRevision;
    // Notifications can arrive while XMP/collision reads are pending. Retry the latest
    // selection before committing any defaults, even when its notification was skipped as busy.
    while (!destroyed) {
        const key = currentSelectionKey(), pending = { key, revision };
        const doc = ps.app.activeDocument;
        if (!doc) {
            selectionIdentity = key; lastBoundRef = null;
            $("selection").textContent = "请打开 PSD"; renderResources(undefined, false); renderIssues([]);
            status("请先打开 PSD；图层切换后会自动刷新。"); return;
        }
        const selected = doc.activeLayers.length === 1 ? doc.activeLayers[0] : null;
        let value;
        try {
            value = (await store.readMetadata(doc.id)).metadata;
            if (destroyed) return;
            if (key !== currentSelectionKey()) continue;
            if (value) { author.validateMetadata(value); await collision(doc, value); }
        } catch (error) {
            if (destroyed) return;
            if (key !== currentSelectionKey()) continue;
            throw error;
        }
        if (destroyed) return;
        if (key !== currentSelectionKey()) continue;
        if (value) {
            const portable = JSON.parse(JSON.stringify(value)); portable.nodes = {};
            if (portable.authoring) delete portable.authoring.targets;
            for (const ref of Object.keys(portable.assets)) {
                if (!portable.authoring || !portable.authoring.sources[ref]) delete portable.assets[ref];
            }
            catalog = author.importDirectory(catalog, portable);
        }
        const changed = key !== selectionIdentity;
        selectionIdentity = key;
        $("selection").textContent = displayText(doc.name + "\n" + (selected ? selected.name + " [" + selected.id + "]" : "请选择一个像素层"));
        const marker = selected && value && value.nodes[selected.id];
        const boundRef = marker ? marker.assetRef : null;
        const chosenWhilePending = resourceChoice && resourceChoice.key === key && resourceChoice.revision > revision;
        if (boundRef && (changed || lastBoundRef !== boundRef) && !chosenWhilePending) explicitResourceRef = boundRef;
        lastBoundRef = boundRef;
        renderResources(explicitResourceRef || "", changed, pending);
        if (changed) targetDefaults(value, selected, pending);
        if (!value) { renderIssues([]); status("当前 PSD 未初始化；主按钮会自动初始化并创建 / 引用资源。完成后 Cmd+S 保存。"); return; }
        const leaves = store.flattenLayers(doc.layers).filter(layer => !layer.layers || !layer.layers.length);
        const issues = author.inspect(value, leaves);
        renderIssues(issues);
        status(issues.length ? issues.length + " 项待处理；未绑定层不会猜绑。可使用主按钮处理选层，其余检查见高级操作。" : "身份和资源契约检查通过。请随 PSD 保存。");
        return;
    }
}

async function run(action) {
    if (busy || lanhuBusy) return;
    if (lanhuHost.status().uploading) { status("蓝湖上传尚在进行，请完成后再修改资源或PSD。"); return; }
    busy = true;
    for (const button of document.querySelectorAll("button")) button.disabled = true;
    try { const result = await action(); if (action !== refresh) await refresh(); if (typeof result === "string") status(result); }
    catch (error) { status(String(error.message || error)); }
    finally { busy = false; for (const button of document.querySelectorAll("button")) button.disabled = false; updateLanhuControls(); }
}
function bind(id, action) {
    $(id).addEventListener("click", () => run(async () => {
        if (catalogLoading) throw new Error("目录正在加载，请稍候再操作。");
        if (catalogFailure && !["refresh", "import"].includes(id)) throw new Error("本地目录不可读，已阻止覆盖。请显式导入备份目录恢复。");
        return action();
    }));
}
async function primaryAction() {
    const previousCatalog = catalog;
    let ref;
    try {
        ref = await modal("创建 / 引用并应用 GameUI 资源", async doc => {
            const { layer } = store.selectedLayer();
            const packet = await store.readMetadata(doc.id), existing = packet.metadata;
            if (existing === null && packet.xmp.getProperty(store.namespace, "metadata") != null) {
                throw new Error("当前 PSD 已有无效 GameUI 标记，不能自动初始化；请先修复元数据。");
            }
            let next = existing === null ? author.createMetadata() : author.validateMetadata(existing);
            await collision(doc, next);
            const bounds = await store.assertSupportedLayer(doc, layer);
            const chosen = selectedResourceRef;
            if (chosen) {
                next = author.importResource(next, catalog, resource());
                const marker = next.nodes[layer.id];
                const prior = marker && next.authoring.targets && next.authoring.targets[marker.nodeId];
                const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
                next = author.reference(next, layer.id, chosen, false, prior || {
                    width, height, insetLeft: 0, insetTop: 0, contentWidth: width, contentHeight: height
                });
            } else {
                const settings = options();
                if (Object.values(catalog.assets).some(asset => typeof asset.displayName === "string" &&
                    asset.displayName.trim() === settings.displayName.trim())) {
                    throw new Error("已有同名公共资源，请从选择器引用；独立资源请用不同名称");
                }
                const source = await store.captureLayerSource(doc, layer, {
                    left: Number($("padLeft").value), top: Number($("padTop").value),
                    right: Number($("padRight").value), bottom: Number($("padBottom").value)
                });
                next = author.define(next, layer.id, author.resourceOptions(catalog, null, "create", settings), source);
                store.assertTargetLayer(layer, next.authoring.targets[next.nodes[layer.id].nodeId]);
            }
            const marker = next.nodes[layer.id];
            const target = await store.applyLayerPreview(doc, layer, next.authoring.sources[marker.assetRef], next.assets[marker.assetRef],
                Number($("targetWidth").value), Number($("targetHeight").value), next.authoring.targets && next.authoring.targets[marker.nodeId]);
            await update(doc, author.withTarget(next, layer.id, target));
            return marker.assetRef;
        });
    } catch (error) {
        if (catalog !== previousCatalog) {
            renderResources(undefined, false);
            const failure = new Error(error.message + "。目录已保留合法源快照，可显式引用恢复；PSD 操作已回滚。");
            Object.defineProperty(failure, "cause", { value: error });
            if (error.code) failure.code = error.code;
            throw failure;
        }
        throw error;
    }
    explicitResourceRef = ref;
    return "已创建 / 引用并应用到选层；原始源快照保留。请使用 Cmd+S 保存 PSD。";
}
bind("primaryAction", primaryAction);
$("toggleAdvanced").addEventListener("click", () => {
    advancedOpen = !advancedOpen;
    $("advancedPanel").style.display = advancedOpen ? "block" : "none";
    $("toggleAdvanced").textContent = advancedOpen ? "隐藏高级操作" : "显示高级操作";
    updateMode();
});
bind("refresh", refresh);
bind("initialize", () => modal("初始化 GameUI 试用 PSD", async doc => {
    if ((await store.readMetadata(doc.id)).metadata) throw new Error("已存在 GameUI 元数据；请检查、修复或分配全新文档身份。");
    await update(doc, author.createMetadata());
}));
function defineResource(mode) { return modal("定义 GameUI 公共资源", async doc => {
    const settings = options();
    if (mode === "create" && Object.values(catalog.assets).some(asset =>
        typeof asset.displayName === "string" && asset.displayName.trim() === settings.displayName.trim())) {
        throw new Error("已有同名公共资源，请从选择器引用；独立资源请用不同名称");
    }
    const selection = store.selectedLayer();
    let value = await metadata(doc);
    const ref = mode === "create" ? null : resource();
    const managed = author.resourceOptions(catalog, ref, mode, settings);
    if (ref) value = author.importResource(value, catalog, ref);
    const source = await store.captureLayerSource(doc, selection.layer, {
        left: Number($("padLeft").value), top: Number($("padTop").value),
        right: Number($("padRight").value), bottom: Number($("padBottom").value)
    });
    const next = author.define(value, selection.layer.id, managed, source);
    store.assertTargetLayer(selection.layer, next.authoring.targets[next.nodes[selection.layer.id].nodeId]);
    await update(doc, next);
}); }
bind("createResource", () => defineResource("create"));
bind("define", () => modal("更新 GameUI 资源名称", async doc => {
    const ref = resource(), name = $("displayName").value.trim();
    if (!name) throw new Error("请输入资源显示名称。");
    const nextCatalog = JSON.parse(JSON.stringify(catalog));
    nextCatalog.assets[ref].displayName = name;
    await persistCatalog(nextCatalog);
    const value = await metadata(doc);
    if (Object.prototype.hasOwnProperty.call(value.assets, ref)) await update(doc, author.importResource(value, catalog, ref));
}));
bind("publishVersion", () => defineResource("publish"));
bind("reference", () => modal("显式引用 GameUI 资源", async doc => {
    const { layer } = store.selectedLayer(); const bounds = await store.assertSupportedLayer(doc, layer);
    const value = author.importResource(await metadata(doc), catalog, resource());
    const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
    const target = { width, height, insetLeft: 0, insetTop: 0, contentWidth: width, contentHeight: height };
    await update(doc, author.reference(value, layer.id, resource(), false, target));
}));
bind("repairIdentity", () => modal("修复选层 GameUI 身份", async doc => {
    const { layer } = store.selectedLayer(); await store.assertSupportedLayer(doc, layer);
    // Only repair duplicate identities here; schema and unknown capability gates remain enforced.
    const value = (await store.readMetadata(doc.id)).metadata;
    if (!value || !value.nodes || !value.nodes[layer.id]) throw new Error("请先显式引用一个资源。");
    const previousId = value.nodes[layer.id].nodeId;
    value.nodes[layer.id].nodeId = require("./gameui-core.js").createId();
    const targets = value.authoring && value.authoring.targets;
    if (targets && targets[previousId]) {
        targets[value.nodes[layer.id].nodeId] = JSON.parse(JSON.stringify(targets[previousId]));
        if (!Object.values(value.nodes).some(marker => marker.nodeId === previousId)) delete targets[previousId];
    }
    for (const key of ["sampling", "sourceSize", "nineSlice"]) delete value.nodes[layer.id][key];
    await update(doc, value);
}));
bind("copy", () => modal("复制 GameUI 引用实例", async doc => {
    const { layer } = store.selectedLayer(); await store.assertSupportedLayer(doc, layer);
    const value = await metadata(doc); await collision(doc, value);
    const original = value.nodes[layer.id];
    if (!original) throw new Error("请先显式绑定选层资源。");
    const target = value.authoring && value.authoring.targets && value.authoring.targets[original.nodeId];
    if (target) store.assertTargetLayer(layer, target);
    const duplicate = await layer.duplicate();
    if (target) store.assertTargetLayer(duplicate, target);
    await update(doc, author.copyNode(value, layer.id, duplicate.id));
    await store.locateLayer(doc.id, duplicate.id);
}));
bind("fork", () => modal("分配全新 GameUI 文档身份", async doc => {
    const value = (await store.readMetadata(doc.id)).metadata;
    if (!value) throw new Error("请先初始化 PSD。");
    const next = author.forkDocument(value, store.flattenLayers(doc.layers).map(layer => layer.id));
    next.uploadScope = author.createMetadata().uploadScope;
    await update(doc, next);
}));
bind("apply", () => modal("应用 GameUI 目标尺寸", async doc => {
    const { layer } = store.selectedLayer();
    const value = await metadata(doc); await collision(doc, value);
    const marker = value.nodes[layer.id];
    if (!marker || marker.assetRef !== resource()) throw new Error("先将选层显式引用到选择器中的资源，再应用目标尺寸。");
    const source = value.authoring && value.authoring.sources[marker.assetRef];
    if (!source) throw new Error("缺少原始源快照，不能从拉伸实例推测源图。");
    const target = await store.applyLayerPreview(doc, layer, source, value.assets[marker.assetRef],
        Number($("targetWidth").value), Number($("targetHeight").value), value.authoring.targets && value.authoring.targets[marker.nodeId]);
    await update(doc, author.withTarget(value, layer.id, target));
}));
bind("preview", async () => {
    const ref = resource(), asset = catalog.assets[ref], source = catalog.authoring.sources[ref];
    const width = Number($("targetWidth").value), height = Number($("targetHeight").value);
    const pixels = author.preview(source, asset.nineSlice, width, height, asset.sampling);
    $("previewImage").src = "data:image/png;base64," + author.base64(author.encodePng(pixels, width, height));
    $("previewImage").style.imageRendering = asset.sampling && asset.sampling.filterMode === "Point" ? "pixelated" : "auto";
});
bind("import", async () => {
    const file = await fs.getFileForOpening({ types: ["json"], allowMultiple: false }); if (!file) return;
    const input = JSON.parse(await file.read());
    await persistCatalog(author.importDirectory(catalog, input));
    catalogFailure = null;
});
bind("export", async () => {
    const output = author.directory(catalog);
    const file = await fs.getFileForSaving("gameui-resources.json", { types: ["json"] }); if (!file) return;
    const text = JSON.stringify(output, null, 2); await file.write(text);
    if (await file.read() !== text) throw new Error("导出目录回读不一致。");
});
for (const id of ["displayName", "left", "top", "right", "bottom", "sampling", "targetWidth", "targetHeight"]) {
    const edited = () => fieldEdits.set(id, { key: currentSelectionKey(), revision: ++editRevision });
    $(id).addEventListener("input", edited);
    $(id).addEventListener("change", edited);
}
async function onSelectionEvent() {
    if (destroyed || busy || catalogLoading) return;
    try {
        if (currentSelectionKey() !== selectionIdentity) await run(refresh);
    } catch (error) { status("自动选择刷新失败，请使用高级刷新 / 检查：" + error.message); }
}
async function registerSelectionEvents() {
    try {
        await ps.action.addNotificationListener(selectionEvents, onSelectionEvent);
        listenerRegistered = true;
    } catch (error) { notificationFailure = error.message; }
}
uxp.entrypoints.setup({ plugin: { create() { destroyed = false; }, async destroy() {
    destroyed = true;
    await lanhuHost.destroy();
    if (listenerRegistered) await ps.action.removeNotificationListener(selectionEvents, onSelectionEvent);
} }, panels: { gameuiAuthoring: { show() { if (!busy) run(refresh); } } } });
(async () => {
    try {
        const folder = await fs.getDataFolder();
        catalogFile = (await folder.getEntries()).find(entry => entry.name === "gameui-resource-catalog.json") || null;
        if (catalogFile) {
            try { const stored = JSON.parse(await catalogFile.read()); author.validateMetadata(stored); catalog = stored; }
            catch (error) { catalogFailure = error.message; throw error; }
        }
        catalogFailure = null;
        catalogLoading = false;
        await registerSelectionEvents();
        await run(refresh);
        if (notificationFailure) status("自动选择刷新不可用，请使用高级操作中的刷新 / 检查：" + notificationFailure);
    } catch (error) {
        if (catalogLoading || catalogFailure) { catalogLoading = false; catalogFailure = error.message; status("目录检查失败，已阻止覆盖：" + error.message); }
        else status("PSD 检查失败：" + error.message);
    }
})();
