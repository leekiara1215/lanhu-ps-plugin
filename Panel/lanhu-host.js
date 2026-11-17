"use strict";

const TEST_PROJECT_ID = "cfea1199-7c07-48d9-86ef-cdbd3385c237";

function createLanhuHost({ ps, uxp, document, window, loadRuntime, nativeRequire, onStatus = () => {}, onChange = () => {} }) {
    let vm = null;
    let operation = null;
    let destroyed = false;
    let runtimeFactory = null;
    let shadow = null;
    let epoch = 0;
    const listeners = [];
    const timers = new Set();
    const photoshopListeners = new Set();
    const ownErrors = new WeakSet();
    let teams = [], projects = [], groups = [];

    function workspace() {
        const state = vm && vm.$store && vm.$store.state || {};
        const user = state.userInfo || {}, project = state.projectInfo || {}, setting = state.setting || {};
        const boards = state.artboards || {}, services = vm && vm.$gameuiServices;
        const list = values => (Array.isArray(values) ? values : []).map(item => ({ id: String(item.id), name: String(item.name || item.label || "未命名") }));
        const progress = components().find(item => typeof item.uploadArtboards === "function" && item.UploadStatusConfig);
        let upload = null;
        if (progress) {
            const config = progress.UploadStatusConfig;
            const phase = progress.uploadStatus === config.uploading ? "uploading" : progress.uploadStatus === config.success ? "success" : progress.uploadStatus === config.fail ? "fail" : progress.uploadStatus === config.unChange ? "unchanged" : "unknown";
            upload = { phase, percentage: Number.isFinite(progress.percentage) ? progress.percentage : 0,
                total: Number(progress.totalCount) || 0, success: Number(progress.successCount) || 0, fail: Number(progress.failCount) || 0 };
        }
        return { ...status(), userName: String(user.nickname || user.name || user.email || ""),
            teamId: String(project.teamId || ""), projectName: String(project.projectName || ""), groupId: String(project.groupId || ""),
            teams: list(teams), projects: list(projects), groups: list(groups),
            deviceType: String(setting.deviceType || ""), deviceScale: String(setting.deviceScale || ""),
            scales: services && services.scales || {}, artboardType: Number(setting.artboardType) || 1,
            allArtboards: list(boards.allArtboard), selectedArtboards: list(boards.selectedArtboard), upload };
    }
    function services() {
        if (!vm || !vm.$gameuiServices || !vm.$store) reject("LANHU_ADAPTER_UNAVAILABLE", "蓝湖业务模块尚未就绪，请刷新连接或使用最新集成候选。");
        return vm.$gameuiServices;
    }
    function checkResponse(response, message) {
        if (!response || (response.code !== undefined && !["00000", "0"].includes(String(response.code)))) {
            reject("LANHU_SERVICE_REJECTED", message + "，请检查账号权限和网络后重试。");
        }
        return response;
    }
    async function refreshWorkspace() {
        const api = services(), state = vm.$store.state;
        await vm.$store.dispatch("refreshArtBoard");
        if (status().loggedIn) {
            teams = [];
            projects = [];
            groups = [];
            teams = checkResponse(await api.account.getPluginUserTeams(state.userInfo.token), "读取团队失败").result || [];
            if (state.projectInfo.teamId) projects = checkResponse(await api.project.getAllProjects({ team_id: state.projectInfo.teamId, token: state.userInfo.token }), "读取项目失败").result || [];
            if (state.projectInfo.projectId === TEST_PROJECT_ID) groups = await api.project.searchGroup({ teamId: state.projectInfo.teamId, projectId: TEST_PROJECT_ID, token: state.userInfo.token });
        }
        return workspace();
    }
    async function perform(name, value) {
        ready();
        const api = services();
        operation = name;
        try {
            const state = vm.$store.state;
            if (name === "refresh") return await refreshWorkspace();
            if (name === "login") {
                if (!value || !String(value.account || "").trim() || !value.password) reject("LANHU_LOGIN_REQUIRED", "请填写蓝湖账号和密码。");
                const response = checkResponse(await api.auth.login({ email: value.account.trim(), password: value.password, password_type: 0 }), "登录失败");
                if (!response.token) reject("LANHU_LOGIN_FAILED", "登录未返回有效会话，请检查账号和密码。");
                await vm.$store.dispatch("loginSuccess", { token: response.token, email: response.email, phone: response.mobile, nickname: response.nickname, avatar: response.avatar });
                await vm.$router.push({ name: "home" });
                await refreshWorkspace();
                notify("蓝湖已登录，请选择团队与测试项目。");
            } else if (name === "logout") {
                await vm.$store.dispatch("loginOut");
                await vm.$store.dispatch("projectInfoClear");
                teams = []; projects = []; groups = [];
                await vm.$router.push({ name: "login" });
                notify("已退出蓝湖账号。");
            } else if (name === "team") {
                const team = teams.find(item => String(item.id) === value);
                if (!team) reject("LANHU_TEAM_UNAVAILABLE", "请刷新并选择有效团队。");
                checkResponse(await api.auth.checkToken(state.userInfo.token, team.id), "当前团队需要重新授权");
                await vm.$store.dispatch("modifyProjecInfo", { teamId: team.id, teamInfo: { ...team }, teamName: team.name, projectId: "", projectName: "", groupId: "", groupName: "" });
                await refreshWorkspace();
            } else if (name === "project") {
                const project = projects.find(item => String(item.id) === value);
                if (!project || value !== TEST_PROJECT_ID) reject("LANHU_PROJECT_NOT_ALLOWED", "当前仅允许选择隔离测试项目；其他项目暂不可上传。");
                await vm.$store.dispatch("modifyProjecInfo", { projectId: project.id, projectName: project.name, groupId: "", groupName: "" });
                await refreshWorkspace();
            } else if (name === "group") {
                const group = groups.find(item => String(item.id) === value);
                if (value && !group) reject("LANHU_GROUP_UNAVAILABLE", "请刷新并选择有效分组。");
                await vm.$store.dispatch("modifyProjecInfo", { groupId: value, groupName: group ? group.label : "" });
            } else if (name === "settings") {
                const device = value.deviceType, scale = value.deviceScale;
                if (![1, 2].includes(value.artboardType) || ((device || scale) && (!api.scales[device] || !api.scales[device].some(item => item.label === scale)))) reject("LANHU_SETTING_INVALID", "请选择有效的平台、设计倍数和画板范围。");
                await vm.$store.dispatch("modifySetting", device ? { deviceType: device, deviceScale: scale, sliceScale: api.sliceScales[device][scale], artboardType: value.artboardType } : { artboardType: value.artboardType });
                await vm.$store.dispatch("refreshArtBoard");
            } else if (name === "back") {
                await vm.$router.push({ name: "home" });
            } else if (["sliceWithLayer", "sliceWithGroup", "unslice", "showSlice", "hiddenSlice"].includes(name)) {
                if (!vm.$lanhuApi || typeof vm.$lanhuApi[name] !== "function") reject("LANHU_SLICE_UNAVAILABLE", "当前候选不支持此切图操作。");
                await vm.$lanhuApi[name]();
                notify("切图操作已完成；请检查当前选层，正常保存由你决定。");
            } else reject("LANHU_ACTION_UNKNOWN", "此操作尚未接入。");
            return workspace();
        } catch (cause) {
            if (ownErrors.has(cause)) throw cause;
            reject("LANHU_ACTION_FAILED", "蓝湖操作未完成，请检查网络、账号权限和当前文档后重试。", cause);
        } finally { operation = null; if (!destroyed) onChange(); }
    }

    function notify(message) { if (!destroyed) onStatus(message); }
    function error(code, message, cause) {
        const failure = new Error(message);
        failure.code = code;
        if (cause) Object.defineProperty(failure, "cause", { value: cause });
        ownErrors.add(failure);
        return failure;
    }
    function reject(code, message, cause) {
        notify(message);
        throw error(code, message, cause);
    }
    function ready() {
        if (destroyed) reject("LANHU_HOST_DESTROYED", "蓝湖工具已关闭，请重新加载插件。");
        if (operation || status().uploading) reject("LANHU_HOST_BUSY", "蓝湖工具正在处理中，请稍候。");
    }
    function components() {
        const queue = vm ? [vm] : [], seen = new Set();
        const result = [];
        for (let index = 0; index < queue.length; index++) {
            const item = queue[index];
            if (!item || seen.has(item)) continue;
            seen.add(item);
            result.push(item);
            try {
                if (Array.isArray(item.$children)) queue.push(...item.$children);
            } catch (_) { /* A component that is being destroyed may no longer expose its children. */ }
        }
        return result;
    }
    function homeComponent() {
        return components().find(item => typeof item.uploadArtboard === "function") || null;
    }
    function pipelineBusy() {
        let completedProgress = false;
        for (const item of components()) {
            try {
                if (typeof item.uploadArtboards !== "function" || !item.UploadStatusConfig ||
                    item.UploadStatusConfig.uploading === undefined || item.uploadStatus === undefined) continue;
                if (item.uploadStatus === item.UploadStatusConfig.uploading) return true;
                completedProgress = true;
            } catch (_) { /* Fall back to the upload route during component transitions. */ }
        }
        if (completedProgress) return false;
        const route = vm && (vm.$router && vm.$router.currentRoute || vm.$route);
        return !!(route && route.name === "upload");
    }
    function status() {
        const result = { connected: !!vm && !destroyed, uploading: operation === "upload" && !destroyed,
            projectId: null, loggedIn: false };
        if (!result.connected) return result;
        try { result.uploading = result.uploading || pipelineBusy(); }
        catch (_) { result.uploading = true; }
        try {
            const state = vm.$store && vm.$store.state;
            const home = homeComponent();
            if (state && state.projectInfo) {
                result.projectId = typeof state.projectInfo.projectId === "string" ? state.projectInfo.projectId : null;
            } else if (home) {
                result.projectId = typeof home.projectId === "string" ? home.projectId : null;
            }
            if (state && state.userInfo) {
                result.loggedIn = typeof state.userInfo.token === "string" && !!state.userInfo.token.trim();
            } else if (home) {
                result.loggedIn = typeof home.token === "string" && !!home.token.trim();
            }
        } catch (_) { /* Status is deliberately limited to non-secret readiness fields. */ }
        return result;
    }
    function assertUploadAllowed(component) {
        if (destroyed) reject("LANHU_HOST_DESTROYED", "蓝湖工具已关闭，请重新加载插件。");
        let projectId;
        try {
            const value = component == null ? {} : Object(component);
            const hasShort = "projectId" in value, hasLong = "projectID" in value;
            if (hasShort && hasLong && value.projectId !== value.projectID) {
                reject("LANHU_PROJECT_CONFLICT", "蓝湖项目配置冲突，请重新选择测试项目。");
            }
            projectId = hasShort ? value.projectId : hasLong ? value.projectID : undefined;
        }
        catch (cause) {
            if (ownErrors.has(cause)) throw cause;
            reject("LANHU_PROJECT_UNAVAILABLE", "无法读取蓝湖项目，请重新选择测试项目。", cause);
        }
        if (projectId !== TEST_PROJECT_ID) {
            reject("LANHU_PROJECT_NOT_ALLOWED", "仅允许向隔离测试项目上传，请在蓝湖工具中选择测试项目。");
        }
    }
    function track(target, type, callback, options) {
        target.addEventListener(type, callback, options);
        listeners.push({ target, type, callback, options });
    }
    function untrack(target, type, callback, options) {
        target.removeEventListener(type, callback, options);
        for (let index = listeners.length - 1; index >= 0; index--) {
            const item = listeners[index];
            if (item.target === target && item.type === type && item.callback === callback && item.options === options) listeners.splice(index, 1);
        }
    }
    async function removePhotoshopListener(item) {
        item.cancelled = true;
        if (!item.added || item.removed) return;
        if (item.removing) return item.removing;
        item.removing = Promise.resolve().then(() => item.action.removeNotificationListener(item.events, item.registeredCallback)).then(() => {
            item.removed = true;
            photoshopListeners.delete(item);
        }).catch(cause => {
            item.removing = null;
            throw error("LANHU_NOTIFICATION_CLEANUP_FAILED", "蓝湖通知清理失败，请重新加载插件。", cause);
        });
        return item.removing;
    }
    function clearTimer(item) {
        item.clear(item.id);
        timers.delete(item);
    }
    async function cleanup() {
        epoch++;
        const failures = [];
        for (const item of listeners.splice(0)) {
            try { item.target.removeEventListener(item.type, item.callback, item.options); } catch (cause) { failures.push(cause); }
        }
        for (const item of timers) {
            try { clearTimer(item); } catch (cause) { failures.push(cause); }
        }
        const removals = [];
        for (const item of photoshopListeners) removals.push(removePhotoshopListener(item));
        if (shadow) {
            try { shadow.textContent = ""; } catch (cause) { failures.push(cause); }
        }
        for (const result of await Promise.allSettled(removals)) if (result.status === "rejected") failures.push(result.reason);
        if (failures.length) throw error("LANHU_CLEANUP_FAILED", "蓝湖运行环境清理失败，请重新加载插件。", failures[0]);
    }
    async function hostContext() {
        await cleanup();
        if (destroyed) throw error("LANHU_HOST_DESTROYED", "蓝湖工具已关闭，请重新加载插件。");
        const contextEpoch = epoch;
        const active = () => !destroyed && epoch === contextEpoch;
        const mount = document.getElementById("lanhuMount");
        if (!mount || typeof mount.attachShadow !== "function") {
            reject("LANHU_SHADOW_UNAVAILABLE", "当前宿主不支持隔离蓝湖界面，请使用官方蓝湖面板。");
        }
        if (!shadow) {
            if (mount.shadowRoot) reject("LANHU_MOUNT_IN_USE", "蓝湖界面挂载区已被占用，请重新加载插件。");
            shadow = mount.attachShadow({ mode: "open" });
        }
        const style = document.createElement("style");
        style.textContent = ":host { display: block; width: 100%; min-height: 632px; } [data-gameui-lanhu-body] { width: 100%; min-height: 632px; font-size: 12px; }";
        shadow.appendChild(style);
        const body = document.createElement("div"); body.setAttribute("data-gameui-lanhu-body", "");
        const app = document.createElement("div"); app.setAttribute("id", "app");
        body.appendChild(app); shadow.appendChild(body);
        let scopedWindow;
        function schedule(kind, callback, delay, ...args) {
            if (!active()) return null;
            if (typeof callback !== "function") throw error("LANHU_TIMER_INVALID", "蓝湖计时任务无效，请重新连接工具。");
            const startName = kind === "timeout" ? "setTimeout" : kind === "interval" ? "setInterval" : "requestAnimationFrame";
            const clearName = kind === "timeout" ? "clearTimeout" : kind === "interval" ? "clearInterval" : "cancelAnimationFrame";
            if (typeof window[startName] !== "function" || typeof window[clearName] !== "function") {
                throw error("LANHU_TIMER_UNAVAILABLE", "当前宿主缺少蓝湖运行所需的计时接口。");
            }
            const item = { kind, id: null, epoch: contextEpoch, clear: window[clearName].bind(window) };
            const invoke = (...nativeArgs) => {
                if (kind !== "interval") timers.delete(item);
                if (active()) callback.apply(scopedWindow, kind === "animation" ? nativeArgs : args);
            };
            timers.add(item);
            try { item.id = kind === "animation" ? window[startName](invoke) : window[startName](invoke, delay); }
            catch (cause) { timers.delete(item); throw error("LANHU_TIMER_FAILED", "蓝湖计时任务启动失败。", cause); }
            return item.id;
        }
        function cancelTimer(id, animation = false) {
            for (const item of timers) {
                if (item.epoch === contextEpoch && item.id === id && (animation ? item.kind === "animation" : item.kind !== "animation")) clearTimer(item);
            }
        }
        const timerFunctions = {
            setTimeout: (callback, delay, ...args) => schedule("timeout", callback, delay, ...args),
            clearTimeout: id => cancelTimer(id),
            setInterval: (callback, delay, ...args) => schedule("interval", callback, delay, ...args),
            clearInterval: id => cancelTimer(id)
        };
        if (typeof window.requestAnimationFrame === "function" && typeof window.cancelAnimationFrame === "function") {
            timerFunctions.requestAnimationFrame = callback => schedule("animation", callback);
            timerFunctions.cancelAnimationFrame = id => cancelTimer(id, true);
        }
        let photoshopProxy;
        function scopedRequire(name) {
            if (name !== "photoshop") return nativeRequire(name);
            if (photoshopProxy) return photoshopProxy;
            const original = nativeRequire(name), action = original && original.action;
            if (!action) throw error("LANHU_PHOTOSHOP_UNAVAILABLE", "蓝湖 Photoshop 模块连接失败。");
            const sameEvents = (left, right) => {
                if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => value === right[index]);
                return left === right;
            };
            const actionProxy = new Proxy(Object.create(null), {
                get(_, key) {
                    if (key === "addNotificationListener") return async (events, callback) => {
                        if (!active()) return;
                        if (typeof callback !== "function") throw error("LANHU_NOTIFICATION_INVALID", "蓝湖通知回调无效，请重新连接工具。");
                        const item = { events: Array.isArray(events) ? events.slice() : events, callback, action, epoch: contextEpoch,
                            added: false, removed: false, removing: null, cancelled: false };
                        item.registeredCallback = function (...args) { if (active() && !item.cancelled) return callback.apply(this, args); };
                        photoshopListeners.add(item);
                        try {
                            await action.addNotificationListener(events, item.registeredCallback);
                            item.added = true;
                            if (!active() || item.cancelled) await removePhotoshopListener(item);
                        } catch (cause) {
                            if (!item.added) photoshopListeners.delete(item);
                            if (ownErrors.has(cause)) throw cause;
                            throw error("LANHU_NOTIFICATION_FAILED", "蓝湖通知注册失败，请重新连接工具。", cause);
                        }
                    };
                    if (key === "removeNotificationListener") return async (events, callback) => {
                        const matches = Array.from(photoshopListeners).filter(item => item.epoch === contextEpoch && item.action === action && item.callback === callback && sameEvents(item.events, events));
                        await Promise.all(matches.map(removePhotoshopListener));
                    };
                    const value = Reflect.get(action, key, action);
                    return typeof value === "function" ? value.bind(action) : value;
                },
                has(_, key) { return Reflect.has(action, key); }
            });
            photoshopProxy = new Proxy(Object.create(null), {
                get(_, key) {
                    if (key === "action") return actionProxy;
                    const value = Reflect.get(original, key, original);
                    return typeof value === "function" ? value.bind(original) : value;
                },
                has(_, key) { return Reflect.has(original, key); }
            });
            return photoshopProxy;
        }
        const localDocument = new Map();
        const specialSelector = selector => selector === "head" ? shadow : selector === "body" || selector === "html" ? body : null;
        const scopedDocument = new Proxy(Object.create(null), {
            get(_, key) {
                const target = document;
                if (key === "head") return shadow;
                if (key === "body" || key === "documentElement") return body;
                if (key === "defaultView") return scopedWindow;
                if (key === "querySelector") return selector => specialSelector(selector) || shadow.querySelector(selector);
                if (key === "querySelectorAll") return selector => {
                    const special = specialSelector(selector); return special ? [special] : shadow.querySelectorAll(selector);
                };
                if (key === "getElementById") return id => {
                    if (typeof shadow.getElementById === "function") return shadow.getElementById(String(id));
                    return Array.from(shadow.querySelectorAll("[id]")).find(node => node.getAttribute("id") === String(id)) || null;
                };
                if (key === "addEventListener") return (type, callback, options) => { if (active()) track(shadow, type, callback, options); };
                if (key === "removeEventListener") return (type, callback, options) => untrack(shadow, type, callback, options);
                if (localDocument.has(key)) return localDocument.get(key);
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
            set(_, key, value) { localDocument.set(key, value); return true; },
            has(_, key) {
                return localDocument.has(key) || ["head", "body", "documentElement", "defaultView", "querySelector", "querySelectorAll", "getElementById", "addEventListener", "removeEventListener"].includes(key) || Reflect.has(document, key);
            }
        });
        const localWindow = new Map();
        scopedWindow = new Proxy(Object.create(null), {
            get(_, key) {
                const target = window;
                if (key === "document") return scopedDocument;
                if (key === "window" || key === "self" || key === "globalThis") return scopedWindow;
                if (key === "VM") return localWindow.get(key);
                if (Object.prototype.hasOwnProperty.call(timerFunctions, key)) return timerFunctions[key];
                if (key === "addEventListener") return (type, callback, options) => { if (active()) track(target, type, callback, options); };
                if (key === "removeEventListener") return (type, callback, options) => untrack(target, type, callback, options);
                if (localWindow.has(key)) return localWindow.get(key);
                const value = Reflect.get(target, key, target);
                if (typeof key === "string" && /^[A-Z]/.test(key)) return value;
                return typeof value === "function" ? value.bind(target) : value;
            },
            set(_, key, value) { localWindow.set(key, value); return true; },
            has(_, key) {
                if (key === "VM") return localWindow.has(key);
                return localWindow.has(key) || Object.prototype.hasOwnProperty.call(timerFunctions, key) ||
                    ["document", "window", "self", "globalThis"].includes(key) || Reflect.has(window, key);
            }
        });
        return { document: scopedDocument, window: scopedWindow, localStorage: window.localStorage,
            require: scopedRequire, assertUploadAllowed, ...timerFunctions,
            runModal(action) {
                if (destroyed) reject("LANHU_HOST_DESTROYED", "蓝湖工具已关闭，请重新加载插件。");
                if (typeof action !== "function") reject("LANHU_MODAL_INVALID", "蓝湖导出任务无效，请重新连接工具。");
                return ps.core.executeAsModal(action, { commandName: "蓝湖导出" });
            } };
    }
    async function connect() {
        ready();
        if (vm) return status();
        operation = "connect";
        try {
            if (typeof nativeRequire !== "function") throw error("LANHU_REQUIRE_UNAVAILABLE", "蓝湖原生模块连接缺失，请重新构建集成包。");
            const context = await hostContext();
            if (!runtimeFactory) runtimeFactory = await loadRuntime();
            if (destroyed) throw error("LANHU_HOST_DESTROYED", "蓝湖工具已关闭，请重新加载插件。");
            if (typeof runtimeFactory !== "function") throw error("LANHU_RUNTIME_INVALID", "蓝湖运行模块无效，请重新构建集成包。");
            const instance = await runtimeFactory(context);
            if (destroyed) {
                if (instance && typeof instance.$destroy === "function") await instance.$destroy();
                await cleanup();
                throw error("LANHU_HOST_DESTROYED", "蓝湖工具已关闭，请重新加载插件。");
            }
            if (!instance || typeof instance !== "object") throw error("LANHU_RUNTIME_INVALID", "蓝湖界面未完成初始化，请重新连接工具。");
            vm = instance;
            if (typeof context.setInterval === "function") context.setInterval(() => onChange(), 750);
            notify("蓝湖工具已加载，请登录并选择测试项目。");
            return status();
        } catch (cause) {
            let cleanupCause;
            try { await cleanup(); } catch (failure) { cleanupCause = failure; }
            const failure = ownErrors.has(cause) ? cause : error("LANHU_CONNECT_FAILED", "蓝湖工具连接失败，请检查候选包后重试。", cause);
            if (cleanupCause) Object.defineProperty(failure, "cleanupCause", { value: cleanupCause });
            if (!ownErrors.has(cause)) notify(failure.message);
            throw failure;
        } finally { operation = null; }
    }
    async function upload() {
        ready();
        if (!vm) reject("LANHU_NOT_CONNECTED", "请先连接蓝湖工具、登录并选择测试项目。");
        operation = "upload";
        try {
            const home = homeComponent();
            if (!home) reject("LANHU_HOME_UNAVAILABLE", "请在蓝湖工具中返回项目页面后再上传。");
            let loggedIn;
            try { loggedIn = typeof home.token === "string" && !!home.token.trim(); }
            catch (cause) { reject("LANHU_AUTH_UNAVAILABLE", "无法读取蓝湖登录状态，请重新登录。", cause); }
            if (!loggedIn) reject("LANHU_LOGIN_REQUIRED", "请先在蓝湖工具中登录。");
            assertUploadAllowed(home);
            if (vm.$gameuiServices) {
                const state = vm.$store.state, setting = state.setting || {}, boards = state.artboards || {};
                if (!setting.deviceType || !setting.deviceScale) reject("LANHU_DESIGN_SCALE_REQUIRED", "请先选择平台与设计倍数。");
                const selected = Number(setting.artboardType) === 2 ? boards.selectedArtboard : boards.allArtboard;
                if (!Array.isArray(selected) || !selected.length) reject("LANHU_ARTBOARDS_REQUIRED", "当前范围没有画板，请调整选区并刷新。");
            }
            await home.uploadArtboard();
            if (destroyed) throw error("LANHU_HOST_DESTROYED", "蓝湖工具已关闭，请重新加载插件。");
            if (vm.$gameuiServices && !pipelineBusy()) {
                const dialog = components().find(item => item.dialogPluginErrVisible && typeof item.pluginErrMessage === "string");
                reject("LANHU_UPLOAD_NOT_STARTED", dialog ? dialog.pluginErrMessage : "蓝湖尚未进入上传流程，请检查团队权限、设计倍数和画板后重试。");
            }
            notify("已交给蓝湖上传流程，请在蓝湖工具中查看后续结果。");
            return { ...status(), uploading: pipelineBusy() };
        } catch (cause) {
            if (ownErrors.has(cause)) throw cause;
            reject("LANHU_UPLOAD_FAILED", "蓝湖上传流程未能启动，请在蓝湖工具中检查状态。", cause);
        } finally { operation = null; }
    }
    async function destroy() {
        if (destroyed) { await cleanup(); return; }
        destroyed = true;
        const instance = vm; vm = null;
        let failure;
        try { if (instance && typeof instance.$destroy === "function") await instance.$destroy(); }
        catch (cause) { failure = error("LANHU_DESTROY_FAILED", "蓝湖界面清理失败，请重新加载插件。", cause); }
        try { await cleanup(); }
        catch (cause) {
            if (failure) Object.defineProperty(failure, "cleanupCause", { value: cause });
            else failure = cause;
        }
        if (failure) throw failure;
    }
    async function openOfficial() {
        reject("LANHU_OFFICIAL_OPEN_UNAVAILABLE", "当前构建尚未接入打开官方蓝湖面板，请从 Photoshop 增效工具菜单打开。");
    }
    return { connect, upload, status, workspace, perform, destroy, openOfficial };
}

module.exports = { createLanhuHost };
