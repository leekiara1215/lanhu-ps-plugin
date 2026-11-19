"use strict";

function createResourceActions({ author, store, catalog, documents }) {
    const { metadata, collision, update, modal } = documents;

    function assertUniqueName(directory, name) {
        if (Object.values(directory.assets).some(asset =>
            typeof asset.displayName === "string" && asset.displayName.trim() === name.trim())) {
            throw new Error("已有同名公共资源，请从选择器引用；独立资源请用不同名称");
        }
    }

    function useAndApply({ assetRef, settings, padding, size }) {
        return modal("创建 / 引用并应用 GameUI 资源", async doc => {
            const { layer } = store.selectedLayer();
            const directory = catalog.current();
            const packet = await store.readMetadata(doc.id), existing = packet.metadata;
            if (existing === null && packet.xmp.getProperty(store.namespace, "metadata") != null) {
                throw new Error("当前 PSD 已有无效 GameUI 标记，不能自动初始化；请先修复元数据。");
            }
            let next = existing === null ? author.createMetadata() : author.validateMetadata(existing);
            await collision(doc, next);
            const bounds = await store.assertSupportedLayer(doc, layer);
            if (assetRef) {
                const asset = directory.assets[assetRef];
                if (!asset) throw new Error("请先选择资源版本。");
                const marker = next.nodes[layer.id];
                const prior = marker && next.authoring?.targets?.[marker.nodeId];
                const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
                const target = prior || { width, height, insetLeft: 0, insetTop: 0, contentWidth: width, contentHeight: height };
                if (asset.nineSlice) {
                    next = author.reference(author.importResource(next, directory, assetRef), layer.id, assetRef, false, target);
                } else {
                    const version = author.resourceOptions(directory, assetRef, "update", { ...settings, displayName: asset.displayName });
                    next = author.withTarget(author.define(next, layer.id, version, directory.authoring.sources[assetRef]), layer.id, target);
                }
            } else {
                assertUniqueName(directory, settings.displayName);
                const source = await store.captureLayerSource(doc, layer, padding);
                next = author.define(next, layer.id, author.resourceOptions(directory, null, "create", settings), source);
                store.assertTargetLayer(layer, next.authoring.targets[next.nodes[layer.id].nodeId]);
            }
            const marker = next.nodes[layer.id];
            const target = await store.applyLayerPreview(doc, layer, next.authoring.sources[marker.assetRef], next.assets[marker.assetRef],
                size.width, size.height, next.authoring.targets?.[marker.nodeId]);
            await update(doc, author.withTarget(next, layer.id, target));
            return marker.assetRef;
        });
    }

    function define(mode, { assetRef, settings, padding }) {
        return modal("定义 GameUI 公共资源", async doc => {
            const directory = catalog.current();
            if (mode === "create") assertUniqueName(directory, settings.displayName);
            const { layer } = store.selectedLayer();
            let value = await metadata(doc);
            if (assetRef && !directory.assets[assetRef]?.nineSlice) throw new Error("请先为该源图记录九宫格设置。");
            const managed = author.resourceOptions(directory, assetRef, mode, settings);
            if (assetRef) value = author.importResource(value, directory, assetRef);
            const source = await store.captureLayerSource(doc, layer, padding);
            const next = author.define(value, layer.id, managed, source);
            store.assertTargetLayer(layer, next.authoring.targets[next.nodes[layer.id].nodeId]);
            await update(doc, next);
        });
    }

    function rename(assetRef, name) {
        return modal("更新 GameUI 资源名称", async doc => {
            if (!name) throw new Error("请输入资源显示名称。");
            const next = JSON.parse(JSON.stringify(catalog.current()));
            next.assets[assetRef].displayName = name;
            await catalog.save(next);
            const value = await metadata(doc);
            if (Object.prototype.hasOwnProperty.call(value.assets, assetRef)) await update(doc, author.importResource(value, next, assetRef));
        });
    }

    function reference(assetRef) {
        return modal("显式引用 GameUI 资源", async doc => {
            const directory = catalog.current();
            if (!directory.assets[assetRef]?.nineSlice) throw new Error("请先为该源图记录九宫格设置。");
            const { layer } = store.selectedLayer();
            const bounds = await store.assertSupportedLayer(doc, layer);
            const value = author.importResource(await metadata(doc), directory, assetRef);
            const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
            const target = { width, height, insetLeft: 0, insetTop: 0, contentWidth: width, contentHeight: height };
            await update(doc, author.reference(value, layer.id, assetRef, false, target));
        });
    }

    function apply(assetRef, { width, height }) {
        return modal("应用 GameUI 目标尺寸", async doc => {
            const { layer } = store.selectedLayer();
            const value = await metadata(doc); await collision(doc, value);
            const marker = value.nodes[layer.id];
            if (!marker || marker.assetRef !== assetRef) throw new Error("先将选层显式引用到选择器中的资源，再应用目标尺寸。");
            const source = value.authoring?.sources[assetRef];
            if (!source) throw new Error("缺少原始源快照，不能从拉伸实例推测源图。");
            const target = await store.applyLayerPreview(doc, layer, source, value.assets[assetRef],
                width, height, value.authoring.targets?.[marker.nodeId]);
            await update(doc, author.withTarget(value, layer.id, target));
        });
    }

    function preview(assetRef, { width, height }) {
        const directory = catalog.current();
        const asset = directory.assets[assetRef], source = directory.authoring.sources[assetRef];
        const pixels = author.preview(source, asset.nineSlice, width, height, asset.sampling);
        return { png: author.base64(author.encodePng(pixels, width, height)), sampling: asset.sampling?.filterMode };
    }

    async function collect(name) {
        if (!name) throw new Error("请输入公共资源名称。");
        const { doc, layer } = store.selectedLayer();
        const value = await documents.read(doc);
        if (value?.nodes?.[layer.id]) throw new Error("该图层已经绑定九宫格版本，请用资源目录中的原始源图。");
        const source = await store.captureLayerSource(doc, layer);
        const next = author.addPublicResource(catalog.current(), name, source);
        await catalog.save(next);
        return Object.keys(next.assets).at(-1);
    }

    return { useAndApply, define, rename, reference, apply, preview, collect };
}

module.exports = { createResourceActions };
