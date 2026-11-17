"use strict";
const ps = require("photoshop");
const uxp = require("uxp");
const store = require("./gameui-ps.js");
const author = require("./gameui-authoring.js");
const fs = uxp.storage.localFileSystem;
const $ = id => document.getElementById(id);
let catalog = author.createMetadata();
let catalogFile;
let busy = false;
let catalogLoading = true;
let catalogFailure = null;

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
    const ref = $("resources").value;
    if (!ref || !catalog.assets[ref]) throw new Error("请先选择资源版本。");
    return ref;
}
function assetFields() {
    const asset = catalog.assets[$("resources").value];
    if (!asset) return;
    $("displayName").value = asset.displayName || asset.assetKey || "";
    $("identityInfo").textContent = displayText("诊断引用（工具维护）：\n" + $("resources").value);
    for (const side of ["left", "top", "right", "bottom"]) $(side).value = String(asset.nineSlice[side]);
    $("sampling").value = asset.sampling ? asset.sampling.filterMode : "Bilinear";
    $("sampling").setAttribute("value", $("sampling").value);
    $("resourceInfo").textContent = displayText($("resources").value) + "\n" + asset.sourceSize.width + "×" + asset.sourceSize.height + " 源像素";
}
function renderResources(preferred) {
    const select = $("resources");
    const prior = preferred || select.value;
    select.textContent = "";
    const entries = Object.keys(catalog.assets).sort().map(ref => ({ ref,
        label: (typeof catalog.assets[ref].displayName === "string" && catalog.assets[ref].displayName.trim() || "未命名资源") + " · v" + catalog.assets[ref].version }));
    const counts = new Map();
    for (const entry of entries) counts.set(entry.label, (counts.get(entry.label) || 0) + 1);
    for (const [index, entry] of entries.entries()) {
        const option = document.createElement("option");
        option.value = entry.ref;
        option.textContent = entry.label + (counts.get(entry.label) > 1 ? " · 条目 " + (index + 1) : "");
        select.appendChild(option);
    }
    if (catalog.assets[prior]) { select.value = prior; select.setAttribute("value", prior); }
    assetFields();
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
async function refresh() {
    if (catalogLoading) { status("目录正在加载，请稍候。"); return; }
    if (catalogFailure) throw new Error("本地目录不可读，已阻止覆盖：" + catalogFailure + "。请显式导入备份目录恢复。");
    const doc = ps.app.activeDocument;
    if (!doc) { $("selection").textContent = "请打开 PSD"; renderResources(); renderIssues([]); status("请先打开 PSD，再点击刷新 / 检查。"); return; }
    const selected = doc.activeLayers.length === 1 ? doc.activeLayers[0] : null;
    $("selection").textContent = displayText(doc.name + "\n" + (selected ? selected.name + " [" + selected.id + "]" : "请选择一个像素层"));
    const value = (await store.readMetadata(doc.id)).metadata;
    if (!value) { renderResources(); renderIssues([]); status("当前 PSD 未初始化。"); return; }
    author.validateMetadata(value);
    await collision(doc, value);
    // Legacy PSDs remain readable; missing snapshots are reported rather than fabricated.
    const portable = JSON.parse(JSON.stringify(value)); portable.nodes = {};
    if (portable.authoring) delete portable.authoring.targets;
    for (const ref of Object.keys(portable.assets)) {
        if (!portable.authoring || !portable.authoring.sources[ref]) delete portable.assets[ref];
    }
    catalog = author.importDirectory(catalog, portable);
    renderResources(selected && value.nodes[selected.id] && value.nodes[selected.id].assetRef);
    const leaves = store.flattenLayers(doc.layers).filter(layer => !layer.layers || !layer.layers.length);
    const issues = author.inspect(value, leaves);
    renderIssues(issues);
    status(issues.length ? issues.length + " 项待处理；未绑定层不会猜绑。" : "身份和资源契约检查通过。请随 PSD 保存。");
}
async function run(action) {
    if (busy) return;
    busy = true;
    for (const button of document.querySelectorAll("button")) button.disabled = true;
    try { await action(); await refresh(); }
    catch (error) { status(String(error.message || error)); }
    finally { busy = false; for (const button of document.querySelectorAll("button")) button.disabled = false; }
}
function bind(id, action) {
    $(id).addEventListener("click", () => run(async () => {
        if (catalogLoading) throw new Error("目录正在加载，请稍候再操作。");
        if (catalogFailure && !["refresh", "import"].includes(id)) throw new Error("本地目录不可读，已阻止覆盖。请显式导入备份目录恢复。");
        await action();
    }));
}
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
$("resources").addEventListener("change", assetFields);
uxp.entrypoints.setup({ panels: { gameuiAuthoring: { show() { if (!busy) run(refresh); } } } });
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
        await refresh();
    } catch (error) {
        if (catalogLoading || catalogFailure) { catalogLoading = false; catalogFailure = error.message; status("目录检查失败，已阻止覆盖：" + error.message); }
        else status("PSD 检查失败：" + error.message);
    }
})();
