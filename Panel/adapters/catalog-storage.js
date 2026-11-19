"use strict";

const CURRENT_FILE = "gameui-resource-catalog-v2.json";
const LEGACY_FILE = "gameui-resource-catalog.json";

function createCatalogStorage(uxp) {
    const fs = uxp.storage.localFileSystem;
    let catalogFile;

    async function readLocal() {
        const folder = await fs.getDataFolder();
        const entries = await folder.getEntries();
        catalogFile = entries.find(entry => entry.name === CURRENT_FILE) || null;
        const input = catalogFile || entries.find(entry => entry.name === LEGACY_FILE);
        return input ? { data: JSON.parse(await input.read()) } : null;
    }

    async function writeLocal(output) {
        const text = JSON.stringify(output, null, 2);
        if (!catalogFile) {
            const folder = await fs.getDataFolder();
            catalogFile = await folder.createFile(CURRENT_FILE);
        }
        await catalogFile.write(text);
        if (await catalogFile.read() !== text) throw new Error("目录写入回读不一致；请保留 PSD 并重试导出。");
    }

    async function openDirectory() {
        const file = await fs.getFileForOpening({ types: ["json"], allowMultiple: false });
        return file ? { data: JSON.parse(await file.read()) } : null;
    }

    async function exportDirectory(output) {
        const file = await fs.getFileForSaving("gameui-resources.json", { types: ["json"] });
        if (!file) return;
        const text = JSON.stringify(output, null, 2);
        await file.write(text);
        if (await file.read() !== text) throw new Error("导出目录回读不一致。");
    }

    async function exportSource(name, bytes) {
        const file = await fs.getFileForSaving(name + ".png", { types: ["png"] });
        if (!file) return false;
        await file.write(bytes, { format: uxp.storage.formats.binary });
        return true;
    }

    return { readLocal, writeLocal, openDirectory, exportDirectory, exportSource };
}

module.exports = { createCatalogStorage };
