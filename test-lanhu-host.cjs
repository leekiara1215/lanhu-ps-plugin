"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLanhuHost } = require("./Panel/lanhu-host.js");
const PROJECT = "cfea1199-7c07-48d9-86ef-cdbd3385c237";

class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.listeners = []; this._text = ""; }
    set textContent(value) { this._text = value; this.children = []; }
    get textContent() { return this._text; }
    setAttribute(key, value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key]; }
    appendChild(child) { this.children.push(child); return child; }
    querySelectorAll(selector) {
        const all = [...this.children];
        for (let index = 0; index < all.length; index++) all.push(...all[index].children);
        if (selector === "[id]") return all.filter(item => item.getAttribute("id") !== undefined);
        if (selector[0] === "#") return all.filter(item => item.getAttribute("id") === selector.slice(1));
        return all.filter(item => item.tag === selector);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(...args) { this.listeners.push(args); }
    removeEventListener(...args) { this.listeners = this.listeners.filter(item => !item.every((value, index) => value === args[index])); }
    dispatchEvent(event) {
        for (const [type, callback] of this.listeners) if (type === event.type) callback(event);
        return true;
    }
}

function fixture(overrides = {}) {
    const created = [], outside = new Element("outside"), messages = [];
    outside.setAttribute("id", "outside");
    const document = {
        head: new Element("global-head"), body: new Element("global-body"), documentElement: new Element("global-html"),
        getElementById(id) { return id === "outside" ? outside : null; },
        createElement(tag) { assert.equal(this, document); const element = new Element(tag); created.push(element); return element; },
        createTextNode(text) { assert.equal(this, document); return { textContent: text }; }
    };
    const window = new Element("window");
    window.localStorage = { marker: "actual-private-storage" };
    window.Promise = Promise;
    window.boundMethod = function () { assert.equal(this, window); return "bound"; };
    Object.defineProperty(window, "document", { value: document, configurable: false, writable: false });
    const state = { loads: 0, factories: 0, uploads: 0, destroys: 0, modalCalls: [], timers: new Map(), notifications: [], removedNotifications: [] };
    let nextTimer = 1;
    for (const [start, clear, kind] of [["setTimeout", "clearTimeout", "timeout"], ["setInterval", "clearInterval", "interval"], ["requestAnimationFrame", "cancelAnimationFrame", "animation"]]) {
        window[start] = function (callback, delay) {
            assert.equal(this, window);
            const id = nextTimer++; state.timers.set(id, { callback, delay, kind }); return id;
        };
        window[clear] = function (id) { assert.equal(this, window); state.timers.delete(id); };
    }
    const home = { projectId: PROJECT, token: "FAKE_PRIVATE_TOKEN", $children: [], async uploadArtboard() { state.uploads++; } };
    const vm = { $children: [{ $children: [home] }], $destroy() { state.destroys++; } };
    const photoshop = {
        core: { async executeAsModal(action, options) { state.modalCalls.push(options); return action({ marker: "execution" }); } },
        action: {
            async addNotificationListener(events, callback) { state.notifications.push({ events: Array.from(events), callback }); },
            async removeNotificationListener(events, callback) {
                state.removedNotifications.push({ events: Array.from(events), callback });
                state.notifications = state.notifications.filter(item => item.callback !== callback || JSON.stringify(item.events) !== JSON.stringify(events));
            }
        }
    };
    const nativeRequire = name => name === "photoshop" ? photoshop : name;
    const args = {
        ps: photoshop,
        uxp: {}, document, window, nativeRequire, onStatus: message => messages.push(message),
        async loadRuntime() {
            state.loads++;
            return context => { state.factories++; state.context = context; context.window.VM = vm; return context.window.VM; };
        }, ...overrides
    };
    const host = createLanhuHost(args);
    return { host, args, state, home, vm, get root() { return created[0]; }, outside, document, window, messages, nativeRequire, photoshop };
}

test("Lanhu factory initializes once in a detached root and scopes document/window without exposing VM globally", async () => {
    const env = fixture();
    assert.deepEqual(env.host.status(), { connected: false, uploading: false, projectId: null, loggedIn: false });
    assert.deepEqual(await env.host.connect(), { connected: true, uploading: false, projectId: PROJECT, loggedIn: true });
    await env.host.connect();
    assert.equal(env.state.loads, 1); assert.equal(env.state.factories, 1);
    const context = env.state.context;
    assert.equal(context.localStorage, env.window.localStorage);
    assert.notEqual(context.require, env.nativeRequire);
    assert.equal(context.require("other"), env.nativeRequire("other"));
    assert.equal(context.require("photoshop").core, env.photoshop.core);
    assert.equal(context.document.head, env.root);
    assert.notEqual(context.document.body, env.document.body);
    assert.equal(context.document.querySelector("head"), env.root);
    assert.equal(context.document.querySelector("body"), context.document.body);
    assert.equal(context.document.querySelector("#app"), context.document.getElementById("app"));
    assert.equal(context.document.querySelector("#outside"), null);
    assert.equal(context.document.getElementById("outside"), null);
    assert.equal(context.document.querySelectorAll("#app").length, 1);
    assert.equal(context.window.document, context.document);
    assert.equal(context.window.window, context.window); assert.equal(context.window.self, context.window);
    assert.equal(context.window.globalThis, context.window);
    assert.equal(context.window.VM, env.vm); assert.equal(env.window.VM, undefined);
    assert.equal(context.window.boundMethod(), "bound");
    assert.equal(context.window.Promise, Promise); assert.equal(typeof context.window.Promise.resolve, "function");
    assert.equal(context.document.createElement("div").tag, "div");
    assert.equal(context.document.createTextNode("test").textContent, "test");
    assert.equal(env.document.head.children.length, 0); assert.equal(env.document.body.children.length, 0);
    assert.equal(await context.runModal(execution => execution.marker), "execution");
    assert.deepEqual(env.state.modalCalls, [{ commandName: "蓝湖导出" }]);
    assert.ok(!JSON.stringify([env.host.status(), env.messages]).includes(env.home.token));
});

test("Lanhu upload requires login and exact test project before calling the real Home method", async () => {
    const env = fixture(); await env.host.connect();
    env.home.token = "";
    await assert.rejects(env.host.upload(), { code: "LANHU_LOGIN_REQUIRED" });
    assert.equal(env.state.uploads, 0);
    env.home.token = "FAKE_PRIVATE_TOKEN"; env.home.projectId = "other-project";
    await assert.rejects(env.host.upload(), { code: "LANHU_PROJECT_NOT_ALLOWED" });
    assert.equal(env.state.uploads, 0);
    assert.throws(() => env.state.context.assertUploadAllowed(env.home), { code: "LANHU_PROJECT_NOT_ALLOWED" });
    env.home.projectId = PROJECT;
    const result = await env.host.upload();
    assert.equal(env.state.uploads, 1); assert.equal(result.uploading, false);
    assert.match(env.messages.at(-1), /已交给蓝湖上传流程/);
    assert.doesNotMatch(env.messages.at(-1), /上传成功/);
    assert.ok(!JSON.stringify([result, env.messages]).includes(env.home.token));
});

test("Lanhu scoped host preserves lodash and never invokes a function's own bind utility", async () => {
    const env = fixture();
    function utility() { assert.equal(this, env.window); return "called"; }
    utility.bind = () => { throw new TypeError("Expected a function"); };
    utility.marker = "static method owner";
    env.window._ = utility;
    env.window.hostMethod = utility;
    env.document.hostMethod = function () { assert.equal(this, env.document); return "document"; };
    env.document.hostMethod.bind = utility.bind;
    await env.host.connect();
    const context = env.state.context;
    assert.equal(context.window._, utility);
    assert.equal(context.window._.marker, "static method owner");
    assert.equal(context.window.hostMethod(), "called");
    assert.equal(context.document.hostMethod(), "document");
    await env.host.destroy();
});

test("Lanhu connect and upload reject concurrent operations without loading or uploading twice", async () => {
    let release, arrived;
    const gate = new Promise(resolve => { release = resolve; });
    const waiting = new Promise(resolve => { arrived = resolve; });
    const env = fixture({ async loadRuntime() { arrived(); await gate; return () => env.vm; } });
    const connecting = env.host.connect(); await waiting;
    await assert.rejects(env.host.connect(), { code: "LANHU_HOST_BUSY" });
    await assert.rejects(env.host.upload(), { code: "LANHU_HOST_BUSY" });
    release(); await connecting;
    let releaseUpload, arrivedUpload;
    const uploadGate = new Promise(resolve => { releaseUpload = resolve; });
    const uploading = new Promise(resolve => { arrivedUpload = resolve; });
    env.home.uploadArtboard = async () => { env.state.uploads++; arrivedUpload(); await uploadGate; };
    const pending = env.host.upload(); await uploading;
    assert.equal(env.host.status().uploading, true);
    await assert.rejects(env.host.upload(), { code: "LANHU_HOST_BUSY" });
    await assert.rejects(env.host.connect(), { code: "LANHU_HOST_BUSY" });
    releaseUpload(); await pending;
    assert.equal(env.state.uploads, 1); assert.equal(env.host.status().uploading, false);
});

test("Lanhu status remains busy across the asynchronous upload route and follows actual progress status", async () => {
    const env = fixture(); await env.host.connect();
    env.vm.$store = { state: { projectInfo: { projectId: PROJECT }, userInfo: { token: env.home.token } } };
    env.vm.$router = { currentRoute: { name: "home" } };
    env.home.uploadArtboard = async () => {
        env.state.uploads++;
        env.vm.$router.currentRoute = { name: "upload" };
        env.vm.$children = [];
    };
    const handoff = await env.host.upload();
    assert.equal(handoff.uploading, true);
    assert.deepEqual(env.host.status(), { connected: true, uploading: true, projectId: PROJECT, loggedIn: true });
    await assert.rejects(env.host.upload(), { code: "LANHU_HOST_BUSY" });
    const progress = { uploadArtboards() {}, UploadStatusConfig: { uploading: 1, complete: 2, failed: 3 }, uploadStatus: 1 };
    env.vm.$children = [progress];
    assert.equal(env.host.status().uploading, true);
    progress.uploadStatus = progress.UploadStatusConfig.complete;
    assert.equal(env.host.status().uploading, false, "The completed upload page can remain mounted without locking authoring forever.");
    assert.equal(env.host.status().loggedIn, true, "Auth status comes from Vuex after Home is destroyed.");
    assert.ok(!JSON.stringify([env.host.status(), env.messages]).includes(env.home.token));
    await assert.rejects(env.host.upload(), { code: "LANHU_HOME_UNAVAILABLE" });
    progress.uploadStatus = progress.UploadStatusConfig.failed;
    assert.equal(env.host.status().uploading, false);
});

test("Lanhu host works without Shadow DOM or a page mount and wraps external errors without leaking credentials", async () => {
    const noShadow = fixture();
    await noShadow.host.connect();
    assert.equal(noShadow.state.loads, 1); assert.equal(noShadow.document.head.children.length, 0);
    assert.equal(noShadow.document.body.children.length, 0);
    const style = noShadow.document.createElement("style"); style.textContent = "body { color: red; }";
    noShadow.state.context.document.head.appendChild(style);
    assert.equal(noShadow.document.head.children.length, 0, "Runtime styles stay detached from the panel.");
    assert.equal(noShadow.host.openOfficial, undefined);
    await noShadow.host.destroy();
    assert.equal(noShadow.root.children.length, 0);
    const env = fixture({ async loadRuntime() {
        const failure = new Error("FAKE_PRIVATE_TOKEN"); failure.code = "LANHU_VENDOR_FAILURE"; throw failure;
    } });
    await assert.rejects(env.host.connect(), failure => failure.code === "LANHU_RUNTIME_LOAD_FAILED" && !failure.message.includes("FAKE_PRIVATE_TOKEN"));
    assert.match(env.messages.at(-1), /重新安装带蓝湖功能的集成版/);
    assert.ok(!JSON.stringify(env.messages).includes("FAKE_PRIVATE_TOKEN"));
    assert.equal(env.root.children.length, 0);
});

test("Lanhu destroy cleans Vue, scoped listeners and mount and ignores a delayed connect result", async () => {
    const env = fixture(); await env.host.connect();
    const listener = () => {};
    env.state.context.window.addEventListener("resize", listener);
    env.state.context.document.addEventListener("click", listener);
    assert.equal(env.window.listeners.length, 1); assert.equal(env.root.listeners.length, 1);
    await env.host.destroy(); await env.host.destroy();
    assert.equal(env.state.destroys, 1); assert.equal(env.window.listeners.length, 0);
    assert.equal(env.root.listeners.length, 0); assert.equal(env.root.children.length, 0);
    assert.deepEqual(env.host.status(), { connected: false, uploading: false, projectId: null, loggedIn: false });
    await assert.rejects(env.host.connect(), { code: "LANHU_HOST_DESTROYED" });
    await assert.rejects(env.host.upload(), { code: "LANHU_HOST_DESTROYED" });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const pendingEnv = fixture({ async loadRuntime() { await gate; return () => pendingEnv.vm; } });
    const pending = pendingEnv.host.connect();
    await pendingEnv.host.destroy(); release();
    await assert.rejects(pending, { code: "LANHU_HOST_DESTROYED" });
    assert.equal(pendingEnv.state.factories, 0); assert.ok(!pendingEnv.root || !pendingEnv.root.children.length);
});

test("Lanhu scoped timers and Photoshop notifications clean up without touching parent registrations", async () => {
    const env = fixture();
    const parentCallback = () => {};
    const parentTimer = env.window.setInterval(parentCallback, 100);
    await env.photoshop.action.addNotificationListener(["select"], parentCallback);
    env.window.VM = "parent-vm";
    await env.host.connect();
    const context = env.state.context;
    assert.equal("document" in context.window, true); assert.equal("Promise" in context.window, true);
    assert.equal("body" in context.document, true); assert.equal("querySelector" in context.document, true);
    assert.equal("not-a-real-property" in context.window, false);
    assert.equal(context.window.VM, env.vm); assert.equal(env.window.VM, "parent-vm");
    assert.equal(context.setTimeout, context.window.setTimeout);
    let fired = 0;
    context.setTimeout(() => fired++, 50);
    const interval = context.setInterval(() => fired++, 100);
    context.window.requestAnimationFrame(() => fired++);
    context.clearInterval(interval);
    context.clearTimeout(parentTimer);
    assert.equal(env.state.timers.has(parentTimer), true);
    const officialCallback = () => {};
    const wrapped = context.require("photoshop");
    assert.equal(context.require("photoshop"), wrapped);
    await wrapped.action.addNotificationListener(["open"], officialCallback);
    await wrapped.action.removeNotificationListener(["select"], parentCallback);
    assert.equal(env.state.notifications.length, 2);
    const registeredCallback = env.state.notifications.find(item => item.events[0] === "open").callback;
    assert.notEqual(registeredCallback, officialCallback);
    const staleTimerCallbacks = Array.from(env.state.timers).filter(([id]) => id !== parentTimer).map(([, value]) => value.callback);
    await env.host.destroy();
    assert.deepEqual(Array.from(env.state.timers.keys()), [parentTimer]);
    assert.deepEqual(env.state.notifications, [{ events: ["select"], callback: parentCallback }]);
    assert.deepEqual(env.state.removedNotifications, [{ events: ["open"], callback: registeredCallback }]);
    for (const callback of staleTimerCallbacks) callback();
    assert.equal(fired, 0, "Already queued callbacks from an invalidated context cannot run target code.");
    assert.equal(context.setTimeout(() => fired++, 0), null);
});

test("Lanhu late Photoshop notification registration is removed after destroy and failed connect cleanup", async () => {
    for (const failConnect of [false, true]) {
        let release, arrived, registration;
        const gate = new Promise(resolve => { release = resolve; });
        const waiting = new Promise(resolve => { arrived = resolve; });
        const callback = () => {};
        const env = fixture({ async loadRuntime() {
            return context => {
                registration = context.require("photoshop").action.addNotificationListener(["open"], callback);
                context.setInterval(() => {}, 100);
                if (failConnect) throw new Error("FAKE_PRIVATE_TOKEN");
                return env.vm;
            };
        } });
        const original = env.photoshop.action.addNotificationListener;
        env.photoshop.action.addNotificationListener = async (...args) => { arrived(); await gate; return original(...args); };
        const connecting = env.host.connect();
        const result = failConnect ? assert.rejects(connecting, { code: "LANHU_CONNECT_FAILED" }) : connecting;
        await waiting; await result;
        if (!failConnect) await env.host.destroy();
        assert.equal(env.state.notifications.length, 0); assert.equal(env.state.timers.size, 0);
        release(); await registration;
        assert.equal(env.state.notifications.length, 0);
        assert.equal(env.state.removedNotifications.length, 1);
        assert.deepEqual(env.state.removedNotifications[0].events, ["open"]);
        assert.notEqual(env.state.removedNotifications[0].callback, callback);
        assert.ok(!JSON.stringify(env.messages).includes("FAKE_PRIVATE_TOKEN"));
    }
});

test("Lanhu uses private Photoshop notification callbacks even when a parent callback identity is reused", async () => {
    const env = fixture(); let called = 0;
    const callback = () => called++;
    await env.photoshop.action.addNotificationListener(["select"], callback);
    await env.host.connect();
    const wrapped = env.state.context.require("photoshop");
    await wrapped.action.addNotificationListener(["select"], callback);
    assert.equal(env.state.notifications.length, 2);
    const scopedCallback = env.state.notifications.find(item => item.callback !== callback).callback;
    scopedCallback(); assert.equal(called, 1);
    await wrapped.action.removeNotificationListener(["select"], callback);
    assert.deepEqual(env.state.notifications, [{ events: ["select"], callback }]);
    scopedCallback(); assert.equal(called, 1, "A removed scoped callback cannot fire again even if it was queued.");
    await env.host.destroy();
    assert.deepEqual(env.state.notifications, [{ events: ["select"], callback }]);
});

test("Lanhu project guard accepts projectID alias and rejects conflicting aliases", async () => {
    const env = fixture(); await env.host.connect();
    const guard = env.state.context.assertUploadAllowed;
    assert.doesNotThrow(() => guard({ projectID: PROJECT }));
    assert.doesNotThrow(() => guard({ projectId: PROJECT }));
    assert.doesNotThrow(() => guard({ projectId: PROJECT, projectID: PROJECT }));
    assert.throws(() => guard({ projectId: PROJECT, projectID: "other" }), { code: "LANHU_PROJECT_CONFLICT" });
    assert.throws(() => guard({ projectID: PROJECT, projectId: undefined }), { code: "LANHU_PROJECT_CONFLICT" });
    assert.throws(() => guard({ projectID: "other" }), { code: "LANHU_PROJECT_NOT_ALLOWED" });
    assert.equal(env.state.uploads, 0);
});

function nativeFixture() {
    const env = fixture(), calls = [];
    const state = { userInfo: { token: "" }, projectInfo: {}, setting: { artboardType: 1 },
        artboards: { allArtboard: [{ id: "10", name: "真实画板" }], selectedArtboard: [] } };
    const result = { ...env, calls, data: state, readArtboards: async () => state.artboards };
    env.vm.$store = { state, async dispatch(name, value) {
        calls.push({ name, value });
        if (name === "refreshArtBoard") return env.state.context.refreshArtboards(result.readArtboards, boards => {
            Object.assign(state.artboards, boards);
        });
        if (name === "loginSuccess") Object.assign(state.userInfo, value);
        if (name === "loginOut") state.userInfo = { token: "" };
        if (name === "projectInfoClear") state.projectInfo = {};
        if (name === "modifyProjecInfo") Object.assign(state.projectInfo, value);
        if (name === "modifySetting") Object.assign(state.setting, value);
    } };
    env.vm.$router = { currentRoute: { name: "home" }, async push(route) { calls.push({ route }); this.currentRoute = route; } };
    const services = env.vm.$gameuiServices = {
        auth: { async login(value) { calls.push({ login: value }); return { code: "00000", token: "PRIVATE_SESSION", email: value.email }; }, async checkToken() { return { code: "00000" }; } },
        account: { async getPluginUserTeams() { return { code: "00000", result: [{ id: "team", name: "团队", secret: "NOT_FOR_UI" }] }; } },
        project: { async getAllProjects() { return { code: "00000", result: [{ id: PROJECT, name: "测试项目" }, { id: "other", name: "其他项目" }] }; }, async searchGroup() { return [{ id: "group", label: "设计分组" }]; } },
        scales: { Web: [{ label: "@1x", value: "网页" }] }, sliceScales: { Web: { "@1x": "2" } }
    };
    env.vm.$lanhuApi = { async sliceWithLayer() { calls.push({ slice: true }); } };
    return Object.assign(result, { services });
}

test("native artboard changes use the detached event bridge and never publish a previous document's list", async () => {
    const env = nativeFixture();
    env.photoshop.app = { activeDocument: { id: 50 } };
    const makeBoards = name => ({ allArtboard: [{ id: "10", name }], selectedArtboard: [] });
    env.readArtboards = async () => makeBoards("文档 A");
    await env.host.connect();
    const { document, canRefreshArtboards } = env.state.context;
    let eventRead;
    document.addEventListener("LanhuJSBridgeSelectedArtBoardChanged", () => {
        assert.equal(canRefreshArtboards(), true);
        eventRead = env.vm.$store.dispatch("refreshArtBoard");
    });
    document.dispatchEvent({ type: "LanhuJSBridgeSelectedArtBoardChanged" });
    assert.equal(await eventRead, true);
    assert.equal(env.host.workspace().allArtboards[0].name, "文档 A");

    let finishOld, markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    env.readArtboards = async () => {
        markStarted();
        return new Promise(resolve => { finishOld = resolve; });
    };
    const old = env.vm.$store.dispatch("refreshArtBoard");
    await started;
    env.photoshop.app.activeDocument = { id: 51 };
    assert.deepEqual(env.host.workspace().allArtboards, []);
    assert.equal(env.host.workspace().artboardsPending, true);
    env.readArtboards = async () => makeBoards("文档 B");
    document.dispatchEvent({ type: "LanhuJSBridgeSelectedArtBoardChanged" });
    finishOld(makeBoards("过期的文档 A"));
    assert.equal(await old, false);
    assert.equal(await eventRead, true);
    assert.equal(env.host.workspace().allArtboards[0].name, "文档 B");

    env.photoshop.app.activeDocument = { id: 52 };
    env.readArtboards = async () => makeBoards("无通知的文档 C");
    const timer = [...env.state.timers.values()].find(item => item.kind === "interval");
    timer.callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.host.workspace().allArtboards[0].name, "无通知的文档 C");
    const calls = env.calls.length;
    timer.callback();
    assert.equal(env.calls.length, calls, "A current snapshot does not reread Photoshop on every tick.");
    env.photoshop.app.activeDocument = null;
    timer.callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(env.host.workspace().allArtboards, []);
    assert.equal(env.host.workspace().artboardsPending, false);
    await env.host.destroy();
});

test("native workspace uses real account/project adapters and exposes an allowlisted snapshot without credentials", async () => {
    const env = nativeFixture();
    env.photoshop.app = { activeDocument: { id: 50 } };
    await env.host.connect();
    await env.host.perform("login", { account: " test@example.com ", password: "PRIVATE_PASSWORD" });
    assert.equal(env.host.workspace().loggedIn, true);
    assert.equal(env.host.workspace().userName, "test@example.com");
    assert.deepEqual(env.host.workspace().teams, [{ id: "team", name: "团队" }]);
    assert.doesNotMatch(JSON.stringify(env.host.workspace()), /PRIVATE_|NOT_FOR_UI/);
    await env.host.perform("team", "team");
    assert.equal(env.host.workspace().projects.length, 2);
    await assert.rejects(env.host.perform("project", "other"), { code: "LANHU_PROJECT_NOT_ALLOWED" });
    assert.equal(env.data.projectInfo.projectId, "");
    await env.host.perform("project", PROJECT);
    await env.host.perform("group", "group");
    assert.equal(env.host.workspace().groupId, "group");
    await env.host.perform("settings", { deviceType: "Web", deviceScale: "@1x", artboardType: 2 });
    assert.equal(env.data.setting.sliceScale, "2");
    assert.equal(env.host.workspace().selectedArtboards.length, 0);
    assert.deepEqual(env.host.workspace().allArtboards, [{ id: "10", name: "真实画板" }]);
    assert.equal(env.state.uploads, 0); assert.equal(env.state.modalCalls.length, 0, "Login, project and settings must not mutate PSD.");
    await env.host.perform("logout"); assert.equal(env.host.workspace().loggedIn, false);
    assert.deepEqual(env.host.workspace().teams, []);
    await env.host.destroy(); assert.equal(env.state.timers.size, 0);
});

test("native workspace rejects failed auth, invalid settings and unknown groups without dispatching changes", async () => {
    const env = nativeFixture(); await env.host.connect();
    env.services.auth.login = async () => ({ code: "10002", msg: "do not echo private server text" });
    await assert.rejects(env.host.perform("login", { account: "test", password: "PRIVATE" }), /登录失败/);
    assert.equal(env.calls.length, 0);
    await assert.rejects(env.host.perform("settings", { deviceType: "Web", deviceScale: "@8x", artboardType: 1 }), { code: "LANHU_SETTING_INVALID" });
    await assert.rejects(env.host.perform("group", "missing"), { code: "LANHU_GROUP_UNAVAILABLE" });
    assert.equal(env.calls.length, 0);
    await env.host.perform("settings", { deviceType: "", deviceScale: "", artboardType: 2 });
    assert.equal(env.data.setting.artboardType, 2, "Board scope can be set before design scale, as in the original workflow.");
    assert.equal(env.state.uploads, 0); assert.equal(env.state.modalCalls.length, 0);
});

test("native controls follow actual upload progress and block settings, slices and a second upload until completion", async () => {
    const env = nativeFixture(); await env.host.connect();
    env.data.userInfo.token = "PRIVATE"; env.data.projectInfo.projectId = PROJECT;
    await assert.rejects(env.host.upload(), { code: "LANHU_DESIGN_SCALE_REQUIRED" });
    env.data.setting.deviceType = "Web"; env.data.setting.deviceScale = "@1x";
    const progress = { uploadArtboards() {}, UploadStatusConfig: { uploading: 1, success: 2, fail: 3, unChange: 4 }, uploadStatus: 1,
        percentage: 24, totalCount: 2, successCount: 0, failCount: 0,
        artboardPoolList: [{ id: "board-a", name: "商城" }, { id: "board-b", name: "首页" }] };
    env.home.uploadArtboard = async () => { env.state.uploads++; env.vm.$children.push(progress); env.vm.$router.currentRoute = { name: "upload" }; };
    await env.host.upload();
    assert.deepEqual(env.host.workspace().upload, { phase: "uploading", percentage: 24, total: 2, success: 0, fail: 0, unchanged: 0,
        rows: [{ id: "BOARD-A", name: "商城", state: "pending" }, { id: "BOARD-B", name: "首页", state: "pending" }] });
    for (const name of ["refresh", "logout", "sliceWithLayer", "settings"]) await assert.rejects(env.host.perform(name, {}), { code: "LANHU_HOST_BUSY" });
    await assert.rejects(env.host.upload(), { code: "LANHU_HOST_BUSY" });
    assert.equal(env.state.uploads, 1);
    progress.successList = [{ id: "BOARD-A", name: "商城", token: "PRIVATE_TOKEN" }];
    progress.successCount = 1;
    assert.equal(env.host.workspace().upload.rows[0].state, "prepared");
    progress.failList = [{ id: "BOARD-B", message: "PRIVATE_SERVER_PAYLOAD" }];
    progress.uploadStatus = 3;
    assert.deepEqual(env.host.workspace().upload.rows, [
        { id: "BOARD-A", name: "商城", state: "success" }, { id: "BOARD-B", name: "首页", state: "fail" }
    ]);
    await env.host.perform("back"); assert.equal(env.vm.$router.currentRoute.name, "home");
    assert.equal(env.state.modalCalls.length, 0);
});

test("frame slicing delegates explicit dimensions, fills a blank axis from the selection, and preserves native empty defaults", async () => {
    const env = nativeFixture();
    const layer = { id: 9, name: "图标", bounds: { left: 2, top: 3, right: 42, bottom: 33 } };
    env.photoshop.app = { activeDocument: { id: 50, activeLayers: [layer] } };
    const sizes = [];
    env.vm.$lanhuApi.sliceWithGroup = async (...args) => sizes.push(args);
    await env.host.connect();
    const view = env.host.workspace().slice;
    assert.equal(view.canMark, true);
    assert.deepEqual([view.width, view.height], [40, 30]);
    await env.host.perform("sliceWithGroup", { width: "120", height: "64" });
    await env.host.perform("sliceWithGroup", { width: "80", height: "" });
    await env.host.perform("sliceWithGroup", { width: "", height: "" });
    layer.bounds = null;
    await env.host.perform("sliceWithGroup", { width: "", height: "" });
    await assert.rejects(env.host.perform("sliceWithGroup", { width: "2.5", height: "32" }), { code: "LANHU_SLICE_SIZE_INVALID" });
    layer.parent = { id: 10, name: "-s-已有切图" };
    await assert.rejects(env.host.perform("sliceWithGroup", { width: "80", height: "" }), { code: "LANHU_SLICE_SELECTION_INVALID" });
    assert.deepEqual(sizes, [[120, 64], [80, 30], [40, 30], []]);
});

test("cancelling a frame mark ungroups its original layers and rolls back on an unexpected guide or changed selection", async () => {
    const env = nativeFixture();
    const history = [];
    const doc = { id: 50, activeLayers: [], layers: [] };
    const guide = { id: 12, name: "-slice-", delete() { group.layers = [layer]; } };
    const layer = { id: 9, name: "图标", delete() { assert.fail("must preserve source"); } };
    const group = { id: 10, name: "-s-图标", layers: [guide, layer], delete() { assert.fail("must preserve the group"); } };
    layer.parent = group;
    guide.parent = group;
    env.photoshop.app = { activeDocument: doc };
    env.photoshop.action.batchPlay = async ([command]) => {
        if (command._obj === "select") {
            assert.equal(command._target[0]._id, group.id);
            doc.activeLayers = [group];
        } else {
            assert.equal(command._obj, "ungroupLayersEvent");
            assert.equal(doc.activeLayers[0], group);
            doc.layers = [layer];
            doc.activeLayers = doc.layers;
            layer.parent = null;
        }
        return [{ _obj: command._obj }];
    };
    env.photoshop.core.executeAsModal = async action => action({ hostControl: {
        suspendHistory(value) { history.push(value); return 1; },
        resumeHistory(id, commit) { history.push({ id, commit }); }
    } });
    await env.host.connect();
    doc.layers = [group];
    doc.activeLayers = [group, layer];
    assert.equal(env.host.workspace().slice.marked, 1);
    await env.host.perform("unslice");
    assert.deepEqual(doc.layers, [layer]);
    assert.equal(layer.name, "图标");
    assert.deepEqual(history, [{ documentID: 50, name: "取消蓝湖切图" }, { id: 1, commit: true }]);

    group.name = "-s-图标";
    group.layers = [guide, layer];
    doc.layers = [group];
    doc.activeLayers = [group];
    guide.layers = [layer];
    await assert.rejects(env.host.perform("unslice"), { code: "LANHU_SLICE_GUIDE_INVALID" });
    assert.deepEqual(history.at(-1), { id: 1, commit: false });
    assert.equal(group.name, "-s-图标");

    env.photoshop.core.executeAsModal = async action => {
        doc.activeLayers = [{ id: 19, name: "另一个图层" }];
        return action({});
    };
    await assert.rejects(env.host.perform("unslice"), { code: "LANHU_SLICE_SELECTION_CHANGED" });
    assert.equal(group.name, "-s-图标");
});

test("frame conversion and visibility follow the original slice controls", async () => {
    const env = nativeFixture(), calls = [];
    const layer = { id: 2, name: "-h-图标", bounds: { width: 12, height: 16 } };
    const guide = { name: "-slice-", visible: true };
    env.photoshop.app = { activeDocument: { id: 50, activeLayers: [layer], layers: [layer, guide] } };
    env.vm.$lanhuApi.sliceWithGroup = async (...args) => calls.push(args);
    env.vm.$lanhuApi.hiddenSlice = async () => { guide.visible = false; };
    env.vm.$lanhuApi.showSlice = async () => { guide.visible = true; };
    await env.host.connect();
    assert.equal(env.host.workspace().slice.canMark, false);
    assert.equal(env.host.workspace().slice.canFrame, true);
    await env.host.perform("sliceWithGroup", { width: "32", height: "" });
    assert.deepEqual(calls, [[32, 16]]);
    await env.host.perform("hiddenSlice");
    assert.equal(env.host.workspace().slice.regionsVisible, false);
    const newGuide = { visible: true };
    env.state.context.initSliceGuideVisibility(newGuide);
    assert.equal(newGuide.visible, false);
    await env.host.perform("showSlice");
    assert.equal(env.host.workspace().slice.regionsVisible, true);
});

test("upload recovery reuses only the failed in-scope boards and blocks uncertain submissions", async () => {
    const env = nativeFixture();
    const doc = { id: 50 };
    const boards = [{ id: "10", name: "首页" }, { id: "20", name: "设置" }];
    const prepare = id => ({ id, image: { sid: "sid-" + id, url: "cover", json_url: "meta" } });
    const retries = [];
    const progress = {
        projectId: PROJECT, UploadStatusConfig: { uploading: 1, success: 2, fail: 3, unChange: 4 },
        uploadStatus: 3, totalCount: 2, successCount: 1, failCount: 1,
        successList: [prepare("10")], failList: [{ ...boards[1], message: "token获取失败" }],
        uploadArtboards() {}, stopSubmitLanhu() {},
        continueUpload() {
            retries.push(env.state.context.takeUploadScope(this.failList));
            this.uploadStatus = 1;
        }
    };
    env.photoshop.app = { activeDocument: doc };
    env.data.userInfo.token = "PRIVATE";
    Object.assign(env.data.projectInfo, { projectId: PROJECT, teamId: "team" });
    Object.assign(env.data.setting, { deviceType: "Web", deviceScale: "@1x", artboardType: 1 });
    env.data.artboards.allArtboard = boards;
    env.home.uploadArtboard = async () => {
        env.state.context.takeUploadScope(boards);
        env.vm.$children.push(progress);
        env.vm.$router.currentRoute = { name: "upload" };
    };
    env.vm.$lanhuApi.openURI = async url => env.calls.push({ url });
    await env.host.connect();
    await env.host.upload({ documentId: 50, boardIds: ["10", "20"] });
    assert.equal(env.host.workspace().upload.canRetry, true);
    assert.equal(env.host.workspace().upload.rows.at(-1).reason, "无法取得文件上传授权");
    doc.id = 51;
    await assert.rejects(env.host.perform("retryUpload"), { code: "LANHU_UPLOAD_SCOPE_CHANGED" });
    doc.id = 50;
    await env.host.perform("retryUpload");
    assert.deepEqual(retries, [{ documentId: 50, boardIds: ["20"] }]);
    assert.throws(() => env.state.context.assertUploadSubmission(progress), { code: "LANHU_SUBMIT_SCOPE_CHANGED" });
    progress.successList = [prepare("20")];
    env.state.context.assertUploadSubmission(progress);
    env.state.context.reportUploadSubmissionIssue(progress);
    assert.equal(env.host.workspace().upload.phase, "unknown");
    assert.equal(env.host.workspace().upload.canRetry, false);
    await assert.rejects(env.host.perform("retryUpload"), { code: "LANHU_RETRY_UNAVAILABLE" });
    await env.host.perform("viewUpload");
    assert.equal(env.calls.at(-1).url, "https://lanhuapp.com/web/#/item/project/stage?pid=" + PROJECT + "&tid=team&see=all");
});

test("force-upload delegates only an unchanged board with the native submission payload", async () => {
    const env = nativeFixture();
    let submissions = 0;
    const progress = {
        projectId: PROJECT, UploadStatusConfig: { uploading: 1, success: 2, fail: 3, unChange: 4 },
        uploadStatus: 4, uploadArtboards() {}, unChangeList: [{ id: "10" }],
        async forceUpload() {
            this.successList = this.unChangeList.splice(0);
            env.state.context.assertUploadSubmission(this);
            submissions++;
            this.uploadStatus = 2;
        }
    };
    env.photoshop.app = { activeDocument: { id: 50 } };
    env.data.userInfo.token = "PRIVATE";
    env.data.projectInfo.projectId = PROJECT;
    Object.assign(env.data.setting, { deviceType: "Web", deviceScale: "@1x" });
    env.home.uploadArtboard = async () => {
        env.state.context.takeUploadScope(env.data.artboards.allArtboard);
        env.vm.$children.push(progress);
        env.vm.$router.currentRoute = { name: "upload" };
    };
    await env.host.connect();
    await env.host.upload({ documentId: 50, boardIds: ["10"] });
    await assert.rejects(env.host.perform("forceUpload"), { code: "LANHU_FORCE_UNAVAILABLE" });
    progress.unChangeList[0].image = { sid: "sid", url: "cover", json_url: "meta" };
    assert.equal(env.host.workspace().upload.canForce, true);
    await env.host.perform("forceUpload");
    assert.equal(submissions, 1);
    assert.equal(env.host.workspace().upload.phase, "success");
});

test("upload refreshes native scope and never widens an empty or changed selection", async () => {
    const env = nativeFixture(); await env.host.connect();
    env.data.userInfo.token = "PRIVATE"; env.data.projectInfo.projectId = PROJECT;
    Object.assign(env.data.setting, { deviceType: "Web", deviceScale: "@1x", artboardType: 2 });
    env.photoshop.app = { activeDocument: { id: 50 } };
    const expected = { documentId: 50, boardIds: ["10"] };
    await assert.rejects(env.host.upload(expected), { code: "LANHU_UPLOAD_SCOPE_CHANGED" });
    assert.equal(env.data.setting.artboardType, 2);
    assert.equal(env.calls.at(-1).name, "refreshArtBoard");
    env.data.artboards.selectedArtboard = [{ id: "10", name: "真实画板" }];
    await assert.rejects(env.host.upload({ ...expected, documentId: 51 }), { code: "LANHU_UPLOAD_SCOPE_CHANGED" });
    assert.equal(env.state.uploads, 0);
    env.home.uploadArtboard = async () => { env.state.uploads++; env.vm.$router.currentRoute = { name: "upload" }; };
    await env.host.upload(expected);
    assert.equal(env.state.uploads, 1);
});

test("the delayed native upload only consumes the confirmed list for the same active PSD", async () => {
    const env = nativeFixture(); await env.host.connect();
    env.data.userInfo.token = "PRIVATE";
    env.data.projectInfo.projectId = PROJECT;
    Object.assign(env.data.setting, { deviceType: "Web", deviceScale: "@1x", artboardType: 2 });
    env.data.artboards.selectedArtboard = [{ id: 10 }, { id: 20 }];
    env.photoshop.app = { activeDocument: { id: 50 } };
    env.home.uploadArtboard = async () => { env.vm.$router.currentRoute = { name: "upload" }; };
    const expected = { documentId: 50, boardIds: ["20", "10"] };
    await env.host.upload(expected);
    const { checkUploadScope, takeUploadScope, reportUploadAnalysisFailure } = env.state.context;
    expected.boardIds.push("30");
    assert.throws(() => checkUploadScope([{ id: 10 }, { id: 20 }, { id: 30 }]), { code: "LANHU_UPLOAD_SCOPE_CHANGED" });
    assert.throws(() => checkUploadScope([]), { code: "LANHU_UPLOAD_SCOPE_CHANGED" });
    checkUploadScope([{ id: 10 }, { id: "20" }]);
    env.photoshop.app.activeDocument.id = 51;
    assert.throws(() => takeUploadScope([{ id: 10 }, { id: 20 }]), { code: "LANHU_UPLOAD_SCOPE_CHANGED" });
    env.photoshop.app.activeDocument.id = 50;
    const selection = [{ id: 20 }, { id: 10 }];
    assert.deepEqual(takeUploadScope(selection), { documentId: 50, boardIds: ["10", "20"] });
    assert.throws(() => takeUploadScope(selection), { code: "LANHU_UPLOAD_SCOPE_CHANGED" });
    const cause = Object.assign(new Error("Cannot prove PSD artboard"), { code: "GAMEUI_UPLOAD_SCOPE" });
    reportUploadAnalysisFailure(cause);
    assert.match(env.messages.at(-1), /已停止导出.*图层归属/);
});

function browserFixture() {
    const env = nativeFixture();
    env.home.browserConnection = () => ({ id: "11111111-1111-4111-8111-111111111111", domain: "https://lanhuapp.com" });
    env.vm.$lanhuApi.openURI = async url => { env.calls.push({ browserURL: url }); };
    env.services.auth.authorizedLogin = async id => { env.calls.push({ authId: id }); return { data: { token: "BROWSER_PRIVATE_TOKEN", team_id: "team" } }; };
    return env;
}
function browserTimer(env, delay) {
    const entry = Array.from(env.state.timers.entries()).find(([, item]) => item.kind === "timeout" && item.delay === delay);
    assert.ok(entry, "Expected authorization timer " + delay);
    return { callback() { env.state.timers.delete(entry[0]); return entry[1].callback(); } };
}
async function settleBrowser() { for (let index = 0; index < 12; index++) await new Promise(resolve => setImmediate(resolve)); }

test("browser authorization opens the original Lanhu binding URL and retrieves login without exposing the handshake or token", async () => {
    const env = browserFixture(); await env.host.connect();
    await env.host.perform("browserAuth");
    assert.equal(env.host.workspace().browserAuthorizing, true);
    assert.equal(env.calls.find(item => item.browserURL).browserURL, "https://lanhuapp.com/web/#/user/plug-bind-account?uselocal=true&pluginuuid=11111111-1111-4111-8111-111111111111&pluginType=Ps");
    assert.doesNotMatch(JSON.stringify(env.host.workspace()), /11111111|BROWSER_PRIVATE/);
    await assert.rejects(env.host.perform("browserAuth"), { code: "LANHU_BROWSER_AUTH_PENDING" });
    browserTimer(env, 1000).callback(); await settleBrowser();
    assert.equal(env.host.workspace().loggedIn, true); assert.equal(env.host.workspace().browserAuthorizing, false);
    assert.equal(env.data.projectInfo.teamId, "team"); assert.equal(env.host.workspace().projects.length, 2);
    assert.match(env.messages.at(-1), /已取得浏览器授权/);
    assert.equal(env.state.uploads, 0); assert.equal(env.state.modalCalls.length, 0);
    await env.host.destroy(); assert.equal(env.state.timers.size, 0);
});

test("cancelled or destroyed browser authorization ignores a late network result and clears its timers", async () => {
    for (const destroy of [false, true]) {
        const env = browserFixture(); await env.host.connect();
        let resolve;
        env.services.auth.authorizedLogin = () => new Promise(done => { resolve = done; });
        await env.host.perform("browserAuth"); browserTimer(env, 1000).callback(); await settleBrowser();
        if (destroy) await env.host.destroy(); else await env.host.perform("cancelBrowserAuth");
        resolve({ data: { token: "LATE_PRIVATE_TOKEN", team_id: "team" } }); await settleBrowser();
        assert.equal(env.data.userInfo.token, "");
        assert.equal(env.calls.some(item => item.name === "loginSuccess"), false);
        assert.equal(env.host.workspace().browserAuthorizing, false);
        if (!destroy) { await env.host.perform("browserAuth"); assert.equal(env.host.workspace().browserAuthorizing, true); await env.host.destroy(); }
        assert.equal(env.state.timers.size, 0);
    }
});

test("browser authorization has an independent five-minute expiry and refuses an unexpected destination", async () => {
    const env = browserFixture(); await env.host.connect();
    env.home.browserConnection = () => ({ id: "11111111-1111-4111-8111-111111111111", domain: "https://unexpected.invalid" });
    await assert.rejects(env.host.perform("browserAuth"), { code: "LANHU_BROWSER_AUTH_INVALID" });
    assert.equal(env.calls.length, 0);
    env.home.browserConnection = () => ({ id: "11111111-1111-4111-8111-111111111111", domain: "https://lanhuapp.com" });
    env.services.auth.authorizedLogin = async () => ({ data: {} });
    await env.host.perform("browserAuth"); browserTimer(env, 1000).callback(); await settleBrowser();
    assert.equal(env.host.workspace().browserAuthorizing, true);
    browserTimer(env, 300000).callback();
    assert.equal(env.host.workspace().browserAuthorizing, false); assert.match(env.messages.at(-1), /已超时/);
    assert.equal(env.data.userInfo.token, ""); assert.equal(env.state.uploads, 0);
    await env.host.destroy();
});
