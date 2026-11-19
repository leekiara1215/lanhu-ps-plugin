"use strict";

function createCatalog({ author, storage }) {
    let catalog = author.createCatalog();

    async function load(isDestroyed) {
        const input = await storage.readLocal();
        if (input && !isDestroyed()) catalog = author.readCatalog(input.data);
    }

    async function save(next) {
        await storage.writeLocal(author.writeCatalog(next));
        catalog = next;
    }

    function mergeDocument(value) {
        const portable = JSON.parse(JSON.stringify(value));
        portable.nodes = {};
        if (portable.authoring) delete portable.authoring.targets;
        for (const ref of Object.keys(portable.assets)) {
            if (!portable.authoring?.sources[ref]) delete portable.assets[ref];
        }
        return author.importCatalog(catalog, portable);
    }

    async function importDirectory() {
        const file = await storage.openDirectory();
        if (!file) return false;
        await save(author.importCatalog(catalog, file.data));
        return true;
    }

    return {
        current: () => catalog, load, save, importDirectory,
        exportDirectory: () => storage.exportDirectory(author.writeCatalog(catalog)),
        exportSource(ref) {
            const asset = catalog.assets[ref], source = catalog.authoring?.sources[ref];
            if (!asset || !source) throw new Error("请先选择要导出的源图。");
            const name = String(asset.displayName || asset.assetKey || "resource").replace(/[\\/:*?"<>|]/g, "-");
            return storage.exportSource(name, author.unbase64(source.pngBase64).buffer);
        },
        includeDocument(value) { catalog = mergeDocument(value); },
        saveDocument: value => save(mergeDocument(value))
    };
}

module.exports = { createCatalog };
