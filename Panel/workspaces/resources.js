"use strict";

const { Route } = require("../ui/navigation.js");
const { displayText } = require("../ui/messages.js");
const { Sampling, SIDES, nineSliceSettings, pixelInsets, targetSize } = require("../domain/parameters.js");

function createResourcesWorkspace({ ps, $, document, controls, author, store, catalog, documents, actions, lanhu,
    getRoute, isDestroyed, errorText }) {
    const { createButton, onClick, onValueChange, makeSelect, closeSelectMenus, display, toggleSection, scheduleInputClipping } = controls;
    const { selectionKey } = documents;
    makeSelect("sampling", [{ id: Sampling.POINT, name: "点采样（Point）" },
        { id: Sampling.BILINEAR, name: "双线性（Bilinear）" }], Sampling.BILINEAR);

    let busy = false;
    let catalogLoading = true;
    let catalogFailure = null;
    let explicitResourceRef = null;
    let selectedResourceRef = "";
    let selectedPublicRef = "";
    let resourceChoicesSignature = null;
    let selectionIdentity = null;
    let lastBoundRef = null;
    let resourceChoicesOpen = false;
    let catalogLoad;
    let renderedRef = null;
    let advancedOpen = false;
    let listenerRegistered = false;
    let notificationFailure = null;
    let editRevision = 0;
    let resourceChoice = null;
    const fieldEdits = new Map();
    const selectionEvents = ["select", "open", "close"];

    function status(message) {
        if (isDestroyed()) return;
        $(getRoute() === Route.PUBLIC_SOURCES ? "publicResourceStatus" : "status").textContent = displayText(message);
        scheduleInputClipping();
    }
    function samplingText(asset) { return asset.sampling && asset.sampling.filterMode === Sampling.POINT ? "点采样（Point）" : "双线性（Bilinear）"; }
    function options() {
        return nineSliceSettings({ ...readSides(side => side), displayName: $("displayName").value, filterMode: $("sampling").value });
    }
    function readSides(fieldId) {
        return Object.fromEntries(SIDES.map(side => [side, $(fieldId(side)).value]));
    }
    function padding() {
        return pixelInsets(readSides(side => "pad" + side[0].toUpperCase() + side.slice(1)));
    }
    function size() {
        return targetSize($("targetWidth").value, $("targetHeight").value);
    }
    function resource() {
        const ref = selectedResourceRef;
        if (!ref || !catalog.current().assets[ref]) throw new Error("请先选择资源版本。");
        return ref;
    }
    function defaultField(id, value, pending) {
        const edit = fieldEdits.get(id);
        if (!pending || !edit || edit.key !== pending.key || edit.revision <= pending.revision) $(id).value = value;
    }
    function assetFields(pending) {
        const asset = catalog.current().assets[selectedResourceRef];
        if (!asset) {
            $("identityInfo").textContent = "新建九宫格源图；内部引用与版本由工具自动维护。";
            $("resourceInfo").textContent = "";
            updateMode(); return;
        }
        defaultField("displayName", asset.displayName || asset.assetKey || "", pending);
        $("identityInfo").textContent = displayText("诊断引用（工具维护）：\n" + selectedResourceRef);
        for (const side of SIDES) defaultField(side, String(asset.nineSlice?.[side] ?? 0), pending);
        defaultField("sampling", asset.sampling ? asset.sampling.filterMode : Sampling.BILINEAR, pending);
        $("sampling").setAttribute("value", $("sampling").value);
        $("resourceInfo").textContent = displayText(selectedResourceRef) + "\n" + asset.sourceSize.width + "×" + asset.sourceSize.height + " 源像素";
        updateMode();
    }
    function updateMode() {
        const asset = catalog.current().assets[selectedResourceRef];
        const bound = !!asset && lastBoundRef === selectedResourceRef;
        display("toggleResourceChoices", !!lastBoundRef);
        const open = !lastBoundRef || resourceChoicesOpen;
        display("resourceChoices", open);
        $("toggleResourceChoices").setAttribute("aria-expanded", String(open));
        $("toggleResourceChoices").textContent = open ? "收起资源列表" : "更换资源";
        $("resourceHeading").textContent = bound ? "当前绑定" : "选择资源";
        const configured = !!asset?.nineSlice;
        display("newResourceSettings", !configured || advancedOpen);
        display("newResourceName", !asset || advancedOpen);
        display("togglePadding", !asset || advancedOpen && configured);
        if (asset && !configured) display("sourcePadding", false);
        $("inheritedContract").style.display = asset ? "block" : "none";
        $("inheritedContract").textContent = asset ? (asset.displayName || "未命名资源") + " · v" + asset.version + " · " +
            asset.sourceSize.width + " × " + asset.sourceSize.height + " px · " + (configured ? samplingText(asset) : "待设置九宫格") : "";
        display("targetMinimum", configured);
        if (configured) {
            const border = asset.nineSlice;
            $("targetMinimum").textContent = "固定边要求目标画布至少为 " +
                Math.max(1, border.left + border.right) + " × " + Math.max(1, border.top + border.bottom) + " px。";
        }
        $("primaryAction").textContent = bound ? "应用尺寸" : configured ? "应用此资源版本" : asset ? "记录九宫格并应用" : "创建并应用";
        display("preview", configured);
        scheduleInputClipping();
    }
    function renderResources(preferred, syncFields = true, pending) {
        const prior = preferred === undefined ? explicitResourceRef || "" : preferred;
        const { assets } = catalog.current();
        const entries = Object.keys(assets).sort().map(ref => {
            const asset = assets[ref];
            const label = (typeof asset.displayName === "string" && asset.displayName.trim() || "未命名资源") + " · v" + asset.version;
            return { ref, label, details: asset.sourceSize.width + " × " + asset.sourceSize.height + " · " +
                (asset.nineSlice ? samplingText(asset) : "待设置九宫格") };
        });
        const counts = new Map();
        for (const entry of entries) counts.set(entry.label, (counts.get(entry.label) || 0) + 1);
        const choices = [{ ref: "", label: "新建九宫格源图" }, ...entries.map((entry, index) => ({ ref: entry.ref,
            label: entry.label + (counts.get(entry.label) > 1 ? " · 条目 " + (index + 1) : "") + " · " + entry.details }))];
        const signature = JSON.stringify(choices);
        if (signature !== resourceChoicesSignature) {
            const list = $("resources"); list.textContent = "";
            for (const choice of choices) {
                const button = createButton(); button.className = "ui-button resource-choice";
                button.setAttribute("data-resource-ref", choice.ref);
                button.setAttribute("data-resource-label", choice.label);
                button.disabled = busy || catalogLoading || !!catalogFailure;
                onClick(button, () => chooseResource(choice.ref));
                list.appendChild(button);
            }
            resourceChoicesSignature = signature;
        }
        const selected = assets[prior] ? prior : "";
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
        if (isDestroyed() || busy || catalogLoading || catalogFailure) return;
        if (ref && !catalog.current().assets[ref]) { status("该资源已不在目录中，请刷新后明确选择。"); return; }
        resourceChoice = { key: selectionKey(), revision: ++editRevision };
        explicitResourceRef = selectedResourceRef = ref;
        display("previewResult", false);
        if (!ref) $("displayName").value = "";
        assetFields(); renderedRef = ref;
        markResourceChoice();
    }
    function renderIssues(issues, documentId) {
        $("issues").textContent = "";
        for (const issue of issues) {
            const row = document.createElement("div"); row.className = "issue";
            const issueMessages = {
                UNBOUND: "尚未绑定资源或来自原生复制，请显式选择资源，面板不会猜测来源。",
                MISSING_LAYER: "原图层已不存在，请确认后显式移除失效绑定。",
                MISSING_SOURCE: "缺少原始源快照，请选择原始源图层重新定义，或导入有效备份。"
            };
            const label = document.createElement("span");
            label.textContent = displayText("图层 " + issue.layerId + "：" + (issueMessages[issue.code] || "请检查图层与资源绑定。"));
            row.appendChild(label);
            if (issue.layerId && issue.code !== "MISSING_LAYER") {
                const button = createButton(); button.textContent = "定位";
                onClick(button, () => run(() => documents.locate(documentId, issue.layerId)));
                row.appendChild(button);
            }
            if (issue.code === "MISSING_LAYER") {
                const button = createButton(); button.textContent = "移除失效绑定";
                onClick(button, () => run(() => documents.removeStaleBinding(documentId, issue.layerId)));
                row.appendChild(button);
            }
            $("issues").appendChild(row);
        }
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
        while (!isDestroyed()) {
            const key = selectionKey(), pending = { key, revision };
            const doc = ps.app.activeDocument;
            if (!doc) {
                selectionIdentity = key; lastBoundRef = null; explicitResourceRef = null; resourceChoicesOpen = false;
                display("previewResult", false);
                $("selection").textContent = "请打开 PSD"; renderResources(undefined, false); renderIssues([]);
                status("请先打开 PSD；图层切换后会自动刷新。"); return;
            }
            const selected = doc.activeLayers.length === 1 ? doc.activeLayers[0] : null;
            let value;
            try {
                value = await documents.read(doc);
                if (isDestroyed()) return;
                if (key !== selectionKey()) continue;
                if (value) { author.validateMetadata(value); await documents.collision(doc, value); }
            } catch (error) {
                if (isDestroyed()) return;
                if (key !== selectionKey()) continue;
                throw error;
            }
            if (isDestroyed()) return;
            if (key !== selectionKey()) continue;
            if (value) catalog.includeDocument(value);
            const changed = key !== selectionIdentity;
            selectionIdentity = key;
            $("selection").textContent = displayText(doc.name + "\n" + (selected ? "已选：" + selected.name : "请选择一个像素层"));
            const marker = selected && value && value.nodes[selected.id];
            const boundRef = marker ? marker.assetRef : null;
            const chosenWhilePending = resourceChoice && resourceChoice.key === key && resourceChoice.revision > revision;
            if ((changed || lastBoundRef !== boundRef) && !chosenWhilePending) {
                explicitResourceRef = boundRef;
                resourceChoicesOpen = false;
                display("previewResult", false);
                for (const field of ["padLeft", "padTop", "padRight", "padBottom"]) defaultField(field, "0", pending);
                if (!boundRef) {
                    defaultField("displayName", "", pending);
                    for (const side of SIDES) defaultField(side, "0", pending);
                    defaultField("sampling", Sampling.BILINEAR, pending);
                }
            }
            lastBoundRef = boundRef;
            renderResources(explicitResourceRef || "", changed, pending);
            if (changed) targetDefaults(value, selected, pending);
            if (!value) { renderIssues([]); status("当前 PSD 未初始化；主按钮会自动初始化并创建 / 引用资源。完成后 Cmd+S 保存。"); return; }
            const leaves = store.flattenLayers(doc.layers).filter(layer => !layer.layers || !layer.layers.length);
            const issues = author.inspect(value, leaves);
            renderIssues(issues, doc.id);
            status(issues.length ? issues.length + " 项待处理；未绑定层不会猜绑。可使用主按钮处理选层，其余检查见高级操作。" : "身份和资源契约检查通过。请随 PSD 保存。");
            return;
        }
    }

    async function run(action) {
        if (busy || lanhu.isBusy() || isDestroyed()) return;
        if (lanhu.isUploading()) { status("蓝湖上传尚在进行，请完成后再修改资源或PSD。"); return; }
        busy = true;
        closeSelectMenus(); lanhu.updateControls();
        for (const button of document.querySelectorAll(".ui-button")) button.disabled = true;
        try {
            const result = await action();
            if (isDestroyed()) return;
            if (getRoute() === Route.PUBLIC_SOURCES) renderPublicResources();
            else if (action !== refresh) await refresh();
            if (typeof result === "string") status(result);
        }
        catch (error) { if (!isDestroyed()) status(errorText(error)); }
        finally {
            busy = false;
            if (!isDestroyed()) {
                for (const button of document.querySelectorAll(".ui-button")) button.disabled = false;
                lanhu.updateControls();
            }
        }
    }
    function bind(id, action) {
        onClick($(id), () => run(async () => {
            if (catalogLoading) throw new Error("目录正在加载，请稍候再操作。");
            if (catalogFailure && !["refresh", "import"].includes(id)) throw new Error("本地目录不可读，已阻止覆盖。请显式导入备份目录恢复。");
            return action();
        }));
    }
    async function primaryAction() {
        const previousCatalog = catalog.current();
        try {
            explicitResourceRef = await actions.useAndApply({ assetRef: selectedResourceRef, settings: options(), padding: padding(), size: size() });
        } catch (error) {
            if (catalog.current() !== previousCatalog && !isDestroyed()) {
                renderResources(undefined, false);
                const failure = new Error(error.message + "。目录已保留合法源快照，可显式引用恢复；PSD 操作已回滚。");
                Object.defineProperty(failure, "cause", { value: error });
                if (error.code) failure.code = error.code;
                throw failure;
            }
            throw error;
        }
        return "已创建 / 引用并应用到选层；原始源快照保留。请使用 Cmd+S 保存 PSD。";
    }
    bind("primaryAction", primaryAction);
    onClick($("toggleResourceChoices"), () => {
        closeSelectMenus();
        if (resourceChoicesOpen && selectedResourceRef !== lastBoundRef) chooseResource(lastBoundRef);
        resourceChoicesOpen = !resourceChoicesOpen;
        updateMode();
    });
    onClick($("togglePadding"), () => {
        const open = $("sourcePadding").style.display !== "block";
        toggleSection("togglePadding", "sourcePadding", open, open ? "收起源图透明留白" : "设置源图透明留白（可选）");
    });
    onClick($("toggleAdvanced"), () => {
        advancedOpen = !advancedOpen;
        $("advancedPanel").style.display = advancedOpen ? "block" : "none";
        $("toggleAdvanced").textContent = advancedOpen ? "隐藏高级操作" : "显示高级操作";
        updateMode();
    });
    bind("refresh", refresh);
    bind("initialize", documents.initialize);
    bind("createResource", () => actions.define("create", { settings: options(), padding: padding() }));
    bind("define", () => actions.rename(resource(), $("displayName").value.trim()));
    bind("publishVersion", () => actions.define("publish", { assetRef: resource(), settings: options(), padding: padding() }));
    bind("reference", () => actions.reference(resource()));
    bind("repairIdentity", documents.repairIdentity);
    bind("copy", documents.copy);
    bind("fork", documents.fork);
    bind("apply", () => actions.apply(resource(), size()));
    bind("preview", () => {
        const result = actions.preview(resource(), size());
        $("previewImage").src = "data:image/png;base64," + result.png;
        $("previewImage").style.imageRendering = result.sampling === Sampling.POINT ? "pixelated" : "auto";
        display("previewResult", true);
    });
    bind("import", async () => {
        if (!await catalog.importDirectory()) return;
        const recovered = !!catalogFailure;
        catalogFailure = null;
        if (recovered && !listenerRegistered && !isDestroyed()) await registerSelectionEvents();
        return "已导入资源目录。";
    });
    bind("export", catalog.exportDirectory);
    function renderPublicResources() {
        const list = $("publicResources");
        list.textContent = "";
        const entries = Object.entries(catalog.current().assets);
        if (!entries.length) list.textContent = "目录为空。可从选层收录源图或导入目录。";
        for (const [ref, asset] of entries) {
            const row = createButton();
            row.className = "ui-button resource-choice";
            row.setAttribute("data-public-resource-ref", ref);
            row.setAttribute("aria-pressed", String(selectedPublicRef === ref));
            row.textContent = (asset.displayName || "未命名资源") + " · v" + (asset.version || 1) + " · " +
                asset.sourceSize.width + " × " + asset.sourceSize.height + " px";
            onClick(row, () => {
                if (busy || catalogLoading || catalogFailure) return;
                selectedPublicRef = ref;
                for (const button of list.children) {
                    button.setAttribute("aria-pressed", String(button.getAttribute("data-public-resource-ref") === ref));
                }
            });
            list.appendChild(row);
        }
        scheduleInputClipping();
    }
    bind("collectPublicResource", async () => {
        selectedPublicRef = await actions.collect($("publicResourceName").value.trim());
        if (!isDestroyed()) $("publicResourceName").value = "";
        return "已收录源图。";
    });
    bind("exportPublicSource", async () => {
        if (await catalog.exportSource(selectedPublicRef)) return "已导出原始源 PNG。";
    });
    for (const id of ["displayName", "left", "top", "right", "bottom", "sampling", "padLeft", "padTop", "padRight", "padBottom", "targetWidth", "targetHeight"]) {
        const edited = () => fieldEdits.set(id, { key: selectionKey(), revision: ++editRevision });
        $(id).addEventListener("input", edited);
        onValueChange($(id), edited);
    }
    async function onSelectionEvent() {
        if (isDestroyed() || busy || lanhu.isBusy()) return;
        if (getRoute() === Route.SLICE) { lanhu.render(); return; }
        if (catalogLoading || getRoute() !== Route.NINE_SLICE) return;
        try {
            if (selectionKey() !== selectionIdentity) await run(refresh);
        } catch (error) { status("自动选择刷新失败，请使用高级刷新 / 检查：" + errorText(error)); }
    }
    async function registerSelectionEvents() {
        try {
            await ps.action.addNotificationListener(selectionEvents, onSelectionEvent);
            if (isDestroyed()) { await ps.action.removeNotificationListener(selectionEvents, onSelectionEvent); return; }
            listenerRegistered = true;
        } catch (error) { if (!isDestroyed()) notificationFailure = errorText(error); }
    }
    async function loadCatalog() {
        status("资源目录正在加载，请稍候。");
        try {
            await catalog.load(isDestroyed);
            if (isDestroyed()) return;
            catalogFailure = null;
            catalogLoading = false;
            await registerSelectionEvents();
            if (isDestroyed()) return;
            if (getRoute() === Route.NINE_SLICE) await run(refresh);
            if (getRoute() === Route.PUBLIC_SOURCES) { renderPublicResources(); status("资源目录已加载。"); }
            if (notificationFailure) status("自动选择刷新不可用，请使用高级操作中的刷新 / 检查：" + notificationFailure);
        } catch (error) {
            if (isDestroyed()) return;
            if (catalogLoading || catalogFailure) {
                catalogLoading = false;
                catalogFailure = errorText(error);
                reportCatalogFailure();
            }
            else status("PSD 检查失败：" + errorText(error));
        }
    }

    function reportCatalogFailure() {
        status("目录检查失败，已阻止覆盖：" + catalogFailure + "。可从「公共资源」导入有效备份。");
    }
    function open(route) {
        if (!catalogLoad) return (catalogLoad = loadCatalog());
        if (catalogLoading) { status("资源目录正在加载，请稍候。"); return; }
        if (catalogFailure) { reportCatalogFailure(); return; }
        if (route === Route.PUBLIC_SOURCES) { renderPublicResources(); return; }
        renderResources(undefined, false);
        if (selectionKey() !== selectionIdentity) return run(refresh);
    }
    function show(route) {
        if (!catalogLoad || catalogLoading || catalogFailure) return open(route);
        if (route === Route.NINE_SLICE && !busy && !catalogLoading) return run(refresh);
        if (route === Route.PUBLIC_SOURCES) renderPublicResources();
    }
    async function destroy() {
        if (listenerRegistered) await ps.action.removeNotificationListener(selectionEvents, onSelectionEvent);
    }
    return { open, show, destroy, isBusy: () => busy };
}

module.exports = { createResourcesWorkspace };
