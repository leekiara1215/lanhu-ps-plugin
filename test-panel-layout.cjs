"use strict";
// Optional real browser layout regression. UXP/Photoshop remains a separate host check.
// GAMEUI_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core node --test test-panel-layout.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const modulePath = process.env.GAMEUI_PLAYWRIGHT_MODULE;
const author = require("./gameui-authoring.js");

test("all six floating pickers leave layout unchanged and stay inside the viewport across sizes and tab switches", { skip: !modulePath, timeout: 60000 }, async t => {
    const { chromium } = require(modulePath);
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
        for (const [width, height] of [[320, 480], [360, 600], [400, 640], [800, 600]]) {
            const page = await browser.newPage({ viewport: { width, height } });
            page.setDefaultTimeout(5000);
            const errors = [];
            page.on("pageerror", error => errors.push(error.message));
            const html = fs.readFileSync(path.join(__dirname, "Panel/index.html"), "utf8")
                .replace('<link rel="stylesheet" href="panel.css">', () => "<style>" + fs.readFileSync(path.join(__dirname, "Panel/panel.css"), "utf8") + "</style>")
                .replace('<script src="panel.js"></script>', "");
            await page.setContent(html);
            await page.evaluate(metadata => {
                const rows = Array.from({ length: 20 }, (_, index) => ({ id: "item-" + index, name: "布局测试条目 " + index + " / 较长名称" }));
                const view = { connected: true, loggedIn: true, uploading: false, userName: "布局测试", teams: rows, projects: rows, groups: rows,
                    scales: { iOS: [{ label: "1x", value: 1 }, { label: "2x", value: 2 }], Android: [{ label: "mdpi", value: 1 }, { label: "xhdpi", value: 2 }] },
                    deviceType: "iOS", deviceScale: "1x", allArtboards: [], selectedArtboards: [] };
                window.layoutSettings = [];
                const host = { status: () => view, workspace: () => view, async destroy() {}, async perform(action, value) {
                    if (action === "settings") { window.layoutSettings.push(value); Object.assign(view, value); }
                } };
                window.require = name => {
                    if (name === "photoshop") return { app: { activeDocument: null, documents: [] }, action: { async addNotificationListener() {}, async removeNotificationListener() {} } };
                    if (name === "uxp") return { entrypoints: { setup(value) { window.layoutEntrypoints = value; value.plugin.create(); } },
                        storage: { localFileSystem: { async getDataFolder() { return { async getEntries() { return []; } }; } } } };
                    if (name === "./gameui-authoring.js") return { createCatalog: () => structuredClone(metadata) };
                    if (name === "./lanhu-host.js") return { createLanhuHost: () => host };
                    if (name === "./gameui-ps.js") return {};
                    throw new Error("Unexpected module in layout test: " + name);
                };
            }, author.createMetadata());
            await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, "Panel/panel.js"), "utf8") });
            assert.equal(await page.locator("#lanhuUploadTab").getAttribute("aria-selected"), "true");
            assert.equal(await page.locator("#authoringPane").isVisible(), false);
            await page.locator("#tabPublicResources").click();
            assert.equal(await page.locator("#publicResourcesPane").isVisible(), true);
            assert.equal(await page.locator("#authoringPane").isVisible(), false);
            assert.equal(await page.locator("#sampling").isVisible(), false);
            const publicTab = await page.locator("#tabPublicResources").boundingBox();
            assert.ok(publicTab && publicTab.x + publicTab.width <= width);
            await page.locator("#lanhuUploadTab").click();
            const footer = await page.locator("#lanhuUploadAction").boundingBox();
            assert.ok(footer && footer.y + footer.height <= height);
            if (!await page.locator("#lanhuDestination").isVisible()) await page.locator("#lanhuToggleDestination").click();
            const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            for (const id of ["sampling", "lanhuTeam", "lanhuProject", "lanhuGroup", "lanhuDevice", "lanhuScale"]) {
                await page.locator(id === "sampling" ? "#tabAuthoring" : "#lanhuUploadTab").click();
                if (id === "sampling") await page.waitForFunction(() => document.getElementById("resources").children.length === 1);
                await page.evaluate(id => {
                    const trigger = document.querySelector("#" + id + " .ui-select-trigger").getBoundingClientRect();
                    const viewport = document.getElementById("panelViewport").getBoundingClientRect();
                    scrollPanelTo(contentScrollTop + trigger.top - viewport.top - 30);
                }, id);
                await settle();
                const snapshot = () => page.evaluate(id => {
                    const rect = element => { const b = element.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height }; };
                    const menu = document.getElementById(id + "-options").parentNode.parentNode;
                    return { content: rect(document.getElementById("panelContent")), field: rect(document.getElementById(id)),
                        range: document.getElementById("panelScrollbar").getAttribute("aria-valuemax"),
                        next: rect(id === "sampling" ? document.getElementById("padLeft") : document.getElementById("lanhuBoardsAll")),
                        menu: rect(menu), overlay: rect(menu.parentNode), viewport: rect(document.getElementById("panelViewport")), expanded: document.querySelector("#" + id + " .ui-select-trigger").getAttribute("aria-expanded") };
                }, id);
                const before = await snapshot();
                await page.locator("#" + id + " .ui-select-trigger").click(); await settle();
                const after = await snapshot();
                assert.equal(after.expanded, "true", `${width}x${height} ${id} opens`);
                for (const key of ["content", "field", "next", "range"]) assert.deepEqual(after[key], before[key], `${width}x${height} ${id}: ${key} must not move`);
                assert.ok(after.menu.top >= after.viewport.top && after.menu.bottom <= after.viewport.bottom, `${id} vertical bounds`);
                assert.ok(after.menu.left >= after.viewport.left && after.menu.right <= after.viewport.right, `${id} horizontal bounds`);
                assert.ok(after.menu.height > 20, `${id} visible menu`);
                assert.deepEqual(after.overlay, after.menu, `${id}: the menu must fit in its parent hit area`);
                const hit = await page.evaluate(id => {
                    const option = document.getElementById(id + "-options").children[1], b = option.getBoundingClientRect();
                    return option.contains(document.elementFromPoint(b.left + 8, b.top + Math.min(8, b.height / 2)));
                }, id);
                assert.equal(hit, true, `${id} is above the content and receives pointer input`);
                const uncoveredEditors = await page.evaluate(id => {
                    const popup = document.getElementById(id + "-options").parentNode.parentNode.getBoundingClientRect();
                    return [...document.querySelectorAll("input")].filter(input => {
                        const b = input.getBoundingClientRect();
                        return b.width && b.height && b.left < popup.right && b.right > popup.left && b.top < popup.bottom && b.bottom > popup.top && getComputedStyle(input).visibility !== "hidden";
                    }).map(input => input.id);
                }, id);
                assert.deepEqual(uncoveredEditors, [], `${id}: covered native editors must be hidden`);
                if (process.env.GAMEUI_LAYOUT_EVIDENCE_DIR && width === 320 && ["sampling", "lanhuDevice"].includes(id)) {
                    fs.mkdirSync(process.env.GAMEUI_LAYOUT_EVIDENCE_DIR, { recursive: true });
                    await page.screenshot({ path: path.join(process.env.GAMEUI_LAYOUT_EVIDENCE_DIR, id + "-320.png") });
                }
                if (id === "lanhuDevice") {
                    await page.setViewportSize({ width: width + 16, height: height - 20 }); await settle();
                    const resized = await snapshot();
                    assert.equal(resized.expanded, "true");
                    assert.ok(resized.menu.top >= resized.viewport.top && resized.menu.bottom <= resized.viewport.bottom);
                    assert.ok(resized.menu.left >= resized.viewport.left && resized.menu.right <= resized.viewport.right);
                    await page.setViewportSize({ width, height }); await settle();
                    const placeholder = await page.locator('#lanhuDevice-options [data-value=""]').boundingBox();
                    assert.ok(placeholder, "Disabled placeholder has a visible hit area");
                    await page.mouse.click(placeholder.x + placeholder.width / 2, placeholder.y + placeholder.height / 2);
                    assert.equal((await snapshot()).expanded, "true", "Disabled placeholder leaves the menu open");
                    await page.locator('#lanhuDevice-options [data-value="Android"]').click(); await settle();
                    assert.equal(await page.locator("#lanhuDevice").evaluate(element => element.value), "Android");
                    assert.equal(await page.locator("#lanhuScale").evaluate(element => element.value), "mdpi");
                }
                if (id === "lanhuScale") {
                    await page.locator('#lanhuScale-options [data-value="xhdpi"]').click(); await settle();
                    assert.deepEqual(await page.evaluate(() => window.layoutSettings), [
                        { deviceType: "Android", deviceScale: "mdpi", artboardType: 1 },
                        { deviceType: "Android", deviceScale: "xhdpi", artboardType: 1 }
                    ]);
                }
                await page.locator("#" + id + " .ui-select-trigger").press("Escape"); await settle();
                assert.deepEqual((await snapshot()).content, before.content);
            }
            // A floating list owns wheel gestures even at its end.
            await page.evaluate(() => {
                const b = document.querySelector("#lanhuTeam .ui-select-trigger").getBoundingClientRect();
                scrollPanelTo(contentScrollTop + b.top - 280);
            });
            await page.locator("#lanhuTeam .ui-select-trigger").click(); await settle();
            await page.locator("#lanhuTeam .ui-select-trigger").press("End");
            const offset = await page.locator("#panelContent").evaluate(element => element.style.top);
            await page.locator("#lanhuTeam-viewport").hover(); await page.mouse.wheel(0, 500); await settle();
            assert.equal(await page.locator("#panelContent").evaluate(element => element.style.top), offset);
            assert.deepEqual(await page.locator("#lanhuUploadAction").boundingBox(), footer, "Scrolling keeps the upload action fixed");
            await page.locator("#lanhuSliceTab").click(); await settle();
            assert.equal(await page.locator("#lanhuTeam .ui-select-trigger").getAttribute("aria-expanded"), "false");
            assert.equal(await page.locator("#lanhuSliceView").isVisible(), true);
            await page.locator("#tabAuthoring").click(); await settle();
            assert.equal(await page.locator("#panelOverlays .ui-select-menu:visible").count(), 0);
            // Resize the real viewport and anchor a menu near its lower edge.
            await page.setViewportSize({ width, height: 360 });
            await page.locator("#lanhuUploadTab").click();
            await page.evaluate(() => {
                const b = document.querySelector("#lanhuGroup .ui-select-trigger").getBoundingClientRect();
                const v = document.getElementById("panelViewport").getBoundingClientRect();
                scrollPanelTo(contentScrollTop + b.bottom - v.bottom + 12);
            });
            await settle(); await page.locator("#lanhuGroup .ui-select-trigger").click(); await settle();
            const groupMenu = page.locator("#lanhuGroup-options").locator("../..");
            assert.equal(await groupMenu.getAttribute("data-placement"), "top", `${width}: flip upwards near bottom`);
            const menuBottom = await groupMenu.evaluate(element => element.getBoundingClientRect().bottom);
            await page.evaluate(() => scrollPanelTo(contentScrollTop + 10)); await settle();
            assert.equal(await groupMenu.evaluate(element => element.getBoundingClientRect().bottom), menuBottom - 10, "Menu follows its anchor even if its top is clamped");
            // Focus on the portalled rail still tabs forward from the owning field.
            const groupRail = groupMenu.locator(".ui-select-scrollbar");
            await groupRail.focus(); await groupRail.press("Tab"); await settle();
            assert.equal(await page.evaluate(() => document.activeElement.id), "connectLanhu");
            await page.locator("#lanhuGroup .ui-select-trigger").click();
            await page.evaluate(() => scrollPanelTo(contentScrollTop + 500)); await settle();
            assert.equal(await page.locator("#lanhuGroup .ui-select-trigger").getAttribute("aria-expanded"), "false");
            await page.evaluate(() => window.layoutEntrypoints.plugin.destroy());
            assert.deepEqual(errors, []);
            t.diagnostic(`${width}x${height}: six menus, bounds, unchanged layout, wheel isolation, upward placement, follow/close and tab focus passed`);
            await page.close();
        }
    } finally { await browser.close(); }
});
