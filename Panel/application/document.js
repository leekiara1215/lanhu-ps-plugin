"use strict";

function createDocumentActions({ ps, store, author, core, catalog }) {
    async function read(doc) {
        return (await store.readMetadata(doc.id)).metadata;
    }
    async function metadata(doc) {
        const value = await read(doc);
        if (!value) throw new Error("当前 PSD 未初始化。先使用初始化按钮。");
        author.validateMetadata(value);
        if (!value.documentId || !value.artboardId) throw new Error("文档身份缺失；请明确分配全新身份。");
        return value;
    }
    async function collision(doc, value) {
        for (const other of ps.app.documents) {
            if (other.id === doc.id) continue;
            const candidate = await read(other);
            if (candidate && (candidate.documentId === value.documentId || candidate.artboardId === value.artboardId)) {
                throw new Error("检测到文档复制身份冲突（" + other.name + "）。请对副本分配全新身份。");
            }
        }
    }
    async function update(doc, next) {
        next.uploadScope = author.createMetadata().uploadScope;
        author.validateMetadata(next);
        await collision(doc, next);
        // Keep the portable source available even if the Photoshop history transaction rolls back.
        await catalog.saveDocument(next);
        await store.writeMetadata(doc.id, next);
    }
    function selectionKey() {
        const doc = ps.app.activeDocument;
        return doc ? doc.id + ":" + Array.from(doc.activeLayers).map(layer => layer.id).sort().join(",") : "none";
    }
    async function modal(name, action) {
        const expectedSelection = selectionKey();
        return ps.core.executeAsModal(async execution => {
            const doc = ps.app.activeDocument;
            if (!doc) throw new Error("请先打开 PSD。");
            if (selectionKey() !== expectedSelection) throw new Error("当前 PSD 或选层已变化，请确认后重试。");
            const suspension = await execution.hostControl.suspendHistory({ documentID: doc.id, name });
            try {
                if (selectionKey() !== expectedSelection) throw new Error("当前 PSD 或选层已变化，请确认后重试。");
                const result = await action(doc);
                await execution.hostControl.resumeHistory(suspension);
                return result;
            } catch (error) {
                await execution.hostControl.resumeHistory(suspension, false);
                throw error;
            }
        }, { commandName: name });
    }
    function initialize() {
        return modal("初始化 GameUI 试用 PSD", async doc => {
            if (await read(doc)) throw new Error("已存在 GameUI 元数据；请检查、修复或分配全新文档身份。");
            await update(doc, author.createMetadata());
        });
    }
    function repairIdentity() {
        return modal("修复选层 GameUI 身份", async doc => {
            const { layer } = store.selectedLayer(); await store.assertSupportedLayer(doc, layer);
            const value = await read(doc);
            const marker = value?.nodes?.[layer.id];
            if (!marker) throw new Error("请先显式引用一个资源。");
            // The writer still rejects unknown schemas and required capabilities.
            const previousId = marker.nodeId;
            marker.nodeId = core.createId();
            const targets = value.authoring?.targets;
            if (targets?.[previousId]) {
                targets[marker.nodeId] = JSON.parse(JSON.stringify(targets[previousId]));
                if (!Object.values(value.nodes).some(node => node.nodeId === previousId)) delete targets[previousId];
            }
            for (const key of ["sampling", "sourceSize", "nineSlice"]) delete marker[key];
            await update(doc, value);
        });
    }
    function copy() {
        return modal("复制 GameUI 引用实例", async doc => {
            const { layer } = store.selectedLayer(); await store.assertSupportedLayer(doc, layer);
            const value = await metadata(doc); await collision(doc, value);
            const original = value.nodes[layer.id];
            if (!original) throw new Error("请先显式绑定选层资源。");
            const target = value.authoring?.targets?.[original.nodeId];
            if (target) store.assertTargetLayer(layer, target);
            const duplicate = await layer.duplicate();
            if (target) store.assertTargetLayer(duplicate, target);
            await update(doc, author.copyNode(value, layer.id, duplicate.id));
            await store.locateLayer(doc.id, duplicate.id);
        });
    }
    function fork() {
        return modal("分配全新 GameUI 文档身份", async doc => {
            const value = await read(doc);
            if (!value) throw new Error("请先初始化 PSD。");
            await update(doc, author.forkDocument(value, store.flattenLayers(doc.layers).map(layer => layer.id)));
        });
    }
    function requireDocument(doc, expectedId) {
        if (doc.id !== expectedId) throw new Error("当前 PSD 已变化，请重新检查。");
    }
    function locate(docId, layerId) {
        return modal("定位检查图层", doc => {
            requireDocument(doc, docId);
            return store.locateLayer(doc.id, layerId);
        });
    }
    function removeStaleBinding(docId, layerId) {
        return modal("移除失效绑定", async doc => {
            requireDocument(doc, docId);
            const value = await metadata(doc);
            if (store.flattenLayers(doc.layers).some(layer => String(layer.id) === String(layerId))) throw new Error("图层已存在，请重新检查。");
            const nodeId = value.nodes[layerId]?.nodeId;
            delete value.nodes[layerId];
            if (nodeId && value.authoring?.targets) delete value.authoring.targets[nodeId];
            await update(doc, value);
        });
    }
    return { read, metadata, collision, update, selectionKey, modal, initialize, repairIdentity, copy, fork, locate, removeStaleBinding };
}

module.exports = { createDocumentActions };
