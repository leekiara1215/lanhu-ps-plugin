"use strict";
const ps = require("photoshop");
const uxp = require("uxp");
const store = require("./gameui-ps.js");
const author = require("./gameui-authoring.js");
const { createLanhuHost } = require("./lanhu-host.js");
const fs = uxp.storage.localFileSystem;
const $ = id => document.getElementById(id);
let catalog = author.createCatalog();
let catalogFile;
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
let destroyed = false;
let editRevision = 0;
let resourceChoice = null;
const fieldEdits = new Map();
const selectionEvents = ["select", "open", "close"];
let lanhuBusy = false;
let lanhuHost;
let lastLanhuLogin = false;

// A div avoids the host-painted HTMLButtonElement chrome. Keep the existing
// disabled property contract, ARIA state and keyboard behavior together.
function prepareButton(element) {
    if (element.gameuiButtonReady) return element;
    element.gameuiButtonReady = true;
    let disabled = element.getAttribute("aria-disabled") === "true";
    if (!element.getAttribute("role")) element.setAttribute("role", "button");
    Object.defineProperty(element, "disabled", {
        configurable: true,
        get() { return disabled; },
        set(value) {
            disabled = !!value;
            element.setAttribute("aria-disabled", disabled ? "true" : "false");
            element.setAttribute("tabindex", disabled ? "-1" : "0");
        }
    });
    element.disabled = disabled;
    return element;
}
function createButton() {
    const element = document.createElement("div");
    element.className = "ui-button";
    prepareButton(element);
    element.disabled = busy || lanhuBusy;
    return element;
}
function onClick(element, action) {
    prepareButton(element);
    const activate = event => {
        if (destroyed || element.disabled) return;
        return action(event);
    };
    element.addEventListener("click", activate);
    element.addEventListener("keydown", event => {
        if (event.repeat || !["Enter", " ", "Spacebar"].includes(event.key)) return;
        event.preventDefault();
        return activate(event);
    });
}
for (const element of document.querySelectorAll(".ui-button")) prepareButton(element);

const selectControls = new Map();
const selectOverlay = $("panelOverlays");
const panelFrame = $("panelFrame");
let openedSelect = null;
function closeSelectMenus() { if (openedSelect) openedSelect.close(); }
function makeSelect(id, rows, selected = "") {
    const element = $(id), trigger = document.createElement("div"), caption = document.createElement("span"), arrow = document.createElement("span"), list = document.createElement("div");
    const menu = document.createElement("div"), viewport = document.createElement("div"), rail = document.createElement("div"), thumb = document.createElement("div");
    let choices = [], value = "", disabled = false, expanded = false, active = -1;
    let offset = 0, drag = null, lastWheelAt = 0, maximumHeight = 160, popupBounds = null;
    const callbacks = [];
    trigger.className = "ui-select-trigger"; trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox"); trigger.setAttribute("aria-controls", id + "-options");
    trigger.setAttribute("aria-label", element.getAttribute("aria-label") || "请选择");
    caption.className = "ui-select-caption"; arrow.className = "ui-select-arrow"; arrow.setAttribute("aria-hidden", "true");
    trigger.appendChild(caption); trigger.appendChild(arrow);
    list.className = "ui-select-list"; list.setAttribute("id", id + "-options"); list.setAttribute("role", "listbox");
    menu.className = "ui-select-menu"; viewport.className = "ui-select-viewport";
    viewport.setAttribute("id", id + "-viewport");
    rail.className = "ui-select-scrollbar"; thumb.className = "ui-select-thumb";
    rail.setAttribute("role", "scrollbar"); rail.setAttribute("aria-label", trigger.getAttribute("aria-label") + "列表滚动");
    rail.setAttribute("aria-controls", id + "-viewport"); rail.setAttribute("aria-orientation", "vertical"); rail.setAttribute("aria-valuemin", "0");
    viewport.appendChild(list); rail.appendChild(thumb); menu.appendChild(viewport); menu.appendChild(rail);
    element.appendChild(trigger); selectOverlay.appendChild(menu);
    // Avoid host-painted scrollbars and UXP's unreliable hidden scrollTop.
    // Move the option content and the light thumb from the same bounded offset.
    function metrics() {
        const content = Math.max(list.scrollHeight || 0, list.offsetHeight || 0);
        const height = Math.min(maximumHeight, content), maximum = Math.max(0, content - height);
        const track = Math.max(0, height - 4), size = maximum ? Math.min(track, Math.max(24, track * height / content)) : track;
        return { height, maximum, size, travel: track - size };
    }
    function refreshScroll() {
        if (!expanded) return;
        let anchor, bounds, origin, above = 0, below = 0;
        if (typeof trigger.getBoundingClientRect === "function" && typeof $("panelViewport").getBoundingClientRect === "function") {
            anchor = trigger.getBoundingClientRect(); bounds = $("panelViewport").getBoundingClientRect();
            origin = panelFrame.getBoundingClientRect();
            if (![anchor.top, anchor.bottom, anchor.left, anchor.right, bounds.top, bounds.bottom, bounds.left, bounds.right, origin.top, origin.left].every(Number.isFinite) ||
                anchor.bottom <= anchor.top || anchor.right <= anchor.left || bounds.right - bounds.left <= 8 ||
                anchor.top < bounds.top - .5 || anchor.bottom > bounds.bottom + .5 || anchor.right <= bounds.left || anchor.left >= bounds.right) {
                close(); return;
            }
            selectOverlay.style.width = Math.min(anchor.right - anchor.left, bounds.right - bounds.left - 8) + "px";
            above = Math.max(0, anchor.top - bounds.top - 8);
            below = Math.max(0, bounds.bottom - anchor.bottom - 8);
            // 10px is the menu's vertical padding and border; keep the list
            // within the content viewport, never over the fixed navigation.
            const desired = Math.min(160, Math.max(list.scrollHeight || 0, list.offsetHeight || 0)) + 10;
            const upwards = below < desired && above > below;
            maximumHeight = Math.min(160, Math.max(0, (upwards ? above : below) - 10));
            if (maximumHeight < 1) { close(); return; }
            menu.setAttribute("data-placement", upwards ? "top" : "bottom");
        }
        let m = metrics();
        rail.style.display = m.maximum > 0 ? "block" : "none";
        m = metrics(); // The rail can change wrapping and therefore content height.
        offset = Math.max(0, Math.min(m.maximum, offset));
        viewport.style.height = m.height + "px";
        rail.style.height = m.height + "px";
        rail.setAttribute("tabindex", m.maximum ? "0" : "-1");
        rail.setAttribute("aria-disabled", m.maximum ? "false" : "true");
        rail.setAttribute("aria-valuemax", String(Math.round(m.maximum)));
        rail.setAttribute("aria-valuenow", String(Math.round(offset)));
        list.style.top = -offset + "px";
        thumb.style.height = m.size + "px";
        thumb.style.marginTop = (m.maximum ? offset / m.maximum * m.travel : 0) + "px";
        if (anchor) {
            const width = parseFloat(selectOverlay.style.width), height = m.height + 10;
            const left = Math.max(bounds.left + 4, Math.min(anchor.left, bounds.right - width - 4));
            const top = menu.getAttribute("data-placement") === "top" ? anchor.top - 4 - height : anchor.bottom + 4;
            selectOverlay.style.left = left - origin.left + "px";
            selectOverlay.style.top = top - origin.top + "px";
            selectOverlay.style.height = height + "px";
            popupBounds = { left, top, right: left + width, bottom: top + height };
        }
    }
    function scrollTo(top) { offset = Math.max(0, Math.min(metrics().maximum, top)); refreshScroll(); }
    function revealActive() {
        const option = list.children[active];
        if (!option || typeof option.getBoundingClientRect !== "function" || typeof viewport.getBoundingClientRect !== "function") return;
        const item = option.getBoundingClientRect(), box = viewport.getBoundingClientRect();
        if (item.top < box.top) scrollTo(offset + item.top - box.top);
        else if (item.bottom > box.bottom) scrollTo(offset + item.bottom - box.bottom);
    }
    function endDrag() {
        drag = null; rail.setAttribute("data-dragging", "false");
        document.removeEventListener("mousemove", moveDrag); document.removeEventListener("mouseup", endDrag);
        if (typeof window !== "undefined") window.removeEventListener("blur", endDrag);
    }
    function moveDrag(event) {
        if (!drag || !Number.isFinite(event.clientY)) return;
        const m = metrics();
        if (m.travel > 0) scrollTo(drag.top + (event.clientY - drag.y) / m.travel * m.maximum);
        event.preventDefault();
    }
    rail.addEventListener("mousedown", event => {
        if (!expanded || destroyed || (event.button !== undefined && event.button !== 0) || !Number.isFinite(event.clientY)) return;
        const m = metrics(); if (!m.maximum) return;
        event.preventDefault(); event.stopPropagation();
        if (typeof rail.focus === "function") rail.focus();
        if (event.target !== thumb) {
            const top = rail.getBoundingClientRect().top + 2 + offset / m.maximum * m.travel;
            scrollTo(offset + (event.clientY < top ? -1 : 1) * m.height * .9); return;
        }
        drag = { y: event.clientY, top: offset }; rail.setAttribute("data-dragging", "true");
        document.addEventListener("mousemove", moveDrag); document.addEventListener("mouseup", endDrag);
        if (typeof window !== "undefined") window.addEventListener("blur", endDrag);
    });
    function onWheel(event) {
        if (!expanded || destroyed || event.ctrlKey || event.metaKey) return;
        if (event.type === "mousewheel" && Date.now() - lastWheelAt < 32) { event.preventDefault(); event.stopPropagation(); return; }
        const delta = Number.isFinite(event.deltaY) ? event.deltaY : -(event.wheelDeltaY || event.wheelDelta || 0);
        if (!Number.isFinite(delta) || !delta) return;
        if (event.type === "wheel") lastWheelAt = Date.now();
        const m = metrics();
        scrollTo(offset + delta * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? m.height : 1));
        // A floating menu owns the gesture even at its ends. Passing it through
        // would move the field and menu underneath the pointer.
        event.preventDefault(); event.stopPropagation();
    }
    menu.addEventListener("wheel", onWheel); menu.addEventListener("mousewheel", onWheel);
    rail.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (event.key === "Tab") { close(true); return; }
        const m = metrics(), destinations = { ArrowUp: offset - 30, ArrowDown: offset + 30, PageUp: offset - m.height * .9, PageDown: offset + m.height * .9, Home: 0, End: m.maximum };
        if (!expanded || !Object.prototype.hasOwnProperty.call(destinations, event.key)) return;
        event.preventDefault(); event.stopPropagation(); scrollTo(destinations[event.key]);
    });
    function paint() {
        const current = choices.find(row => row.id === value);
        caption.textContent = current ? current.name : "请选择";
        arrow.textContent = expanded ? "▴" : "▾";
        trigger.setAttribute("aria-expanded", expanded ? "true" : "false");
        trigger.setAttribute("aria-disabled", disabled ? "true" : "false");
        trigger.setAttribute("tabindex", disabled ? "-1" : "0");
        element.setAttribute("aria-disabled", disabled ? "true" : "false");
        menu.style.display = expanded ? "flex" : "none";
        for (let index = 0; index < list.children.length; index++) {
            list.children[index].setAttribute("aria-selected", choices[index].id === value ? "true" : "false");
            list.children[index].setAttribute("data-active", index === active ? "true" : "false");
        }
        trigger.setAttribute("aria-activedescendant", expanded && active >= 0 ? id + "-option-" + active : "");
    }
    function close(focus = false) {
        const wasExpanded = expanded;
        endDrag();
        expanded = false; popupBounds = null;
        if (openedSelect === control) { openedSelect = null; selectOverlay.style.display = "none"; }
        paint();
        if (wasExpanded) scheduleInputClipping();
        if (focus && typeof trigger.focus === "function") trigger.focus();
    }
    function open() {
        if (disabled || destroyed) return;
        if (openedSelect && openedSelect !== control) openedSelect.close();
        if (typeof trigger.focus === "function") trigger.focus();
        expanded = true; openedSelect = control;
        selectOverlay.style.display = "block";
        active = choices.findIndex(row => row.id === value && !row.disabled);
        if (active < 0) active = choices.findIndex(row => !row.disabled);
        paint(); refreshScroll(); revealActive(); scheduleInputClipping();
    }
    function choose(index) {
        if (!expanded || disabled || destroyed || !choices[index] || choices[index].disabled) return;
        const next = choices[index].id, changed = value !== next;
        value = next; close(true); scheduleInputClipping();
        if (changed) return Promise.all(callbacks.map(callback => callback({ target: element })));
    }
    function move(direction, end) {
        const enabled = choices.map((row, index) => !row.disabled ? index : -1).filter(index => index >= 0);
        if (!enabled.length) return;
        active = end === "first" ? enabled[0] : end === "last" ? enabled[enabled.length - 1] : enabled[(enabled.indexOf(active) + direction + enabled.length) % enabled.length];
        paint();
        revealActive();
    }
    const control = { element, close, refreshScroll, get bounds() { return popupBounds; },
        contains(target) { return element.contains(target) || menu.contains(target); },
        onChange(callback) { callbacks.push(callback); },
        setChoices(next, selectedValue) {
            close(); offset = 0; choices = next.map(row => ({ id: String(row.id), name: String(row.name), disabled: !!row.disabled }));
            list.textContent = "";
            choices.forEach((row, index) => {
                const option = document.createElement("div"); option.className = "ui-select-option"; option.textContent = row.name;
                option.setAttribute("id", id + "-option-" + index); option.setAttribute("role", "option");
                option.setAttribute("data-value", row.id); option.setAttribute("aria-disabled", row.disabled ? "true" : "false");
                option.addEventListener("mousedown", event => { if (event.button === undefined || event.button === 0) event.preventDefault(); });
                option.addEventListener("click", () => choose(index)); list.appendChild(option);
            });
            element.value = selectedValue;
        }
    };
    Object.defineProperty(element, "value", { configurable: true, get() { return value; }, set(next) {
        const text = String(next == null ? "" : next); value = choices.some(row => row.id === text) ? text : ""; paint();
    } });
    Object.defineProperty(element, "disabled", { configurable: true, get() { return disabled; }, set(next) {
        disabled = !!next; if (disabled) close(); else paint();
    } });
    trigger.addEventListener("click", () => { if (expanded) close(); else open(); });
    trigger.addEventListener("keydown", event => {
        if (event.key === "Tab") { close(); return; }
        if (disabled || destroyed) return;
        if (!["Enter", " ", "Spacebar", "Escape", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Escape") { close(); return; }
        if (["Enter", " ", "Spacebar"].includes(event.key)) {
            if (event.repeat) return;
            if (expanded) return choose(active);
            open(); return;
        }
        const wasOpen = expanded; if (!expanded) open();
        if (event.key === "Home" || event.key === "End") move(0, event.key === "Home" ? "first" : "last");
        else if (wasOpen) move(event.key === "ArrowDown" ? 1 : -1);
    });
    selectControls.set(id, control); control.setChoices(rows, selected); return control;
}
function onValueChange(element, callback) {
    const control = selectControls.get(element.id || element.getAttribute("id"));
    if (control) control.onChange(callback); else element.addEventListener("change", callback);
}
makeSelect("sampling", [{ id: "Point", name: "点采样（Point）" }, { id: "Bilinear", name: "双线性（Bilinear）" }], "Bilinear");
makeSelect("lanhuDevice", [{ id: "", name: "请选择平台", disabled: true }, ...["iOS", "Android", "Web"].map(id => ({ id, name: id }))]);
for (const id of ["lanhuTeam", "lanhuProject", "lanhuGroup", "lanhuScale"]) makeSelect(id, [{ id: "", name: id === "lanhuGroup" ? "项目根目录" : "请先登录或选择项目" }]);

const hostWindow = typeof window === "undefined" ? null : window;
let clippingFrame = null;
// UXP paints native scrollbars in the Photoshop theme. Draw this rail ourselves
// and move the content explicitly: UXP does not reliably apply scrollTop to
// overflow:hidden containers. The content and thumb share one offset.
const scrollViewport = $("panelViewport");
const scrollContent = $("panelContent");
const scrollRail = $("panelScrollbar");
const scrollThumb = $("panelScrollThumb");
let scrollDrag = null;
let contentScrollTop = 0;
let lastStandardWheelAt = 0;
function scrollMetrics() {
    const height = scrollViewport.clientHeight || 0;
    const contentHeight = Math.max(scrollContent.scrollHeight || 0, scrollContent.offsetHeight || 0);
    const maximum = Math.max(0, contentHeight - height);
    const track = Math.max(0, (scrollRail.clientHeight || height) - 8);
    const thumb = maximum ? Math.min(track, Math.max(28, track * height / (height + maximum))) : track;
    return { height, maximum, track, thumb, travel: track - thumb };
}
function updateScrollbar() {
    const metrics = scrollMetrics();
    const top = contentScrollTop = Math.max(0, Math.min(metrics.maximum, contentScrollTop));
    if (scrollViewport.scrollTop) scrollViewport.scrollTop = 0;
    scrollContent.style.top = -top + "px";
    scrollRail.style.visibility = metrics.maximum > 0 ? "visible" : "hidden";
    scrollRail.setAttribute("aria-disabled", metrics.maximum > 0 ? "false" : "true");
    scrollRail.setAttribute("tabindex", metrics.maximum > 0 ? "0" : "-1");
    scrollRail.setAttribute("aria-valuemax", String(Math.round(metrics.maximum)));
    scrollRail.setAttribute("aria-valuenow", String(Math.round(top)));
    scrollThumb.style.height = metrics.thumb + "px";
    scrollThumb.style.marginTop = (metrics.maximum ? top / metrics.maximum * metrics.travel : 0) + "px";
}
function scrollPanelTo(top) {
    contentScrollTop = Math.max(0, Math.min(scrollMetrics().maximum, top));
    scheduleInputClipping();
}
function onPanelWheel(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
    // Photoshop hosts can expose either wheel API. Ignore the legacy duplicate
    // when both are emitted for the same gesture.
    if (event.type === "mousewheel" && Date.now() - lastStandardWheelAt < 32) return;
    let delta = Number.isFinite(event.deltaY) ? event.deltaY : -(event.wheelDeltaY || event.wheelDelta || 0);
    if (!Number.isFinite(delta) || delta === 0) return;
    if (event.type === "wheel") lastStandardWheelAt = Date.now();
    // Let a list consume its own wheel movement before scrolling the whole panel.
    for (let node = event.target; node && node !== scrollViewport; node = node.parentNode) {
        if (!["resources", "publicResources", "lanhuBoardList"].includes(node.id)) continue;
        const top = node.scrollTop || 0, maximum = (node.scrollHeight || 0) - (node.clientHeight || 0);
        if (maximum > 0 && (delta < 0 ? top > 0 : top < maximum)) return;
    }
    const metrics = scrollMetrics();
    if (!metrics.maximum) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? metrics.height : 1;
    scrollPanelTo(contentScrollTop + delta * unit);
}
function onScrollKey(event) {
    const target = event.target;
    if (target && /^(INPUT|TEXTAREA)$/i.test(target.tagName || target.tag || "")) return;
    if (target && target.getAttribute && ["combobox", "listbox", "option"].includes(target.getAttribute("role"))) return;
    const metrics = scrollMetrics(), top = contentScrollTop;
    const destinations = { PageUp: top - metrics.height * .9, PageDown: top + metrics.height * .9, Home: 0, End: metrics.maximum };
    if (target === scrollRail) Object.assign(destinations, { ArrowUp: top - 32, ArrowDown: top + 32 });
    if (!Object.prototype.hasOwnProperty.call(destinations, event.key)) return;
    event.preventDefault(); scrollPanelTo(destinations[event.key]);
}
function onScrollDrag(event) {
    if (!scrollDrag || !Number.isFinite(event.clientY)) return;
    const metrics = scrollMetrics();
    if (metrics.travel > 0) scrollPanelTo(scrollDrag.top + (event.clientY - scrollDrag.y) / metrics.travel * metrics.maximum);
    event.preventDefault();
}
function endScrollDrag() {
    scrollDrag = null; scrollRail.setAttribute("data-dragging", "false");
    document.removeEventListener("mousemove", onScrollDrag);
    document.removeEventListener("mouseup", endScrollDrag);
    if (hostWindow) hostWindow.removeEventListener("blur", endScrollDrag);
}
function startScrollDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const metrics = scrollMetrics();
    if (!metrics.maximum || !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    if (typeof scrollRail.focus === "function") scrollRail.focus();
    if (event.target !== scrollThumb) {
        const box = scrollRail.getBoundingClientRect();
        const thumbTop = contentScrollTop / metrics.maximum * metrics.travel;
        scrollPanelTo(contentScrollTop + (event.clientY < box.top + 4 + thumbTop ? -1 : 1) * metrics.height * .9);
        return;
    }
    scrollDrag = { y: event.clientY, top: contentScrollTop };
    scrollRail.setAttribute("data-dragging", "true");
    document.addEventListener("mousemove", onScrollDrag);
    document.addEventListener("mouseup", endScrollDrag);
    if (hostWindow) hostWindow.addEventListener("blur", endScrollDrag);
}
scrollViewport.addEventListener("wheel", onPanelWheel);
scrollViewport.addEventListener("mousewheel", onPanelWheel);
scrollRail.addEventListener("wheel", onPanelWheel);
scrollRail.addEventListener("mousewheel", onPanelWheel);
scrollViewport.addEventListener("keydown", onScrollKey);
scrollRail.addEventListener("keydown", onScrollKey);
scrollRail.addEventListener("mousedown", startScrollDrag);
let contentPan = null;
function canPanContent(target) {
    for (let node = target; node; node = node.parentNode) {
        const tag = String(node.tagName || node.tag || "").toLowerCase();
        const role = node.getAttribute && node.getAttribute("role");
        const classes = String(node.className || "").split(/\s+/);
        if (["input", "textarea", "select", "button", "label", "a", "pre", "p", "span", "h2", "h3", "img"].includes(tag) ||
            ["button", "tab", "combobox", "listbox", "option"].includes(role) ||
            classes.includes("ui-select") || ["resources", "publicResources", "lanhuBoardList"].includes(node.id)) return false;
        if (node === scrollViewport || node === scrollContent) return true;
    }
    return false;
}
function moveContentPan(event) {
    if (!contentPan || !Number.isFinite(event.clientY)) return;
    if (contentPan.pointerId !== null && event.pointerId !== contentPan.pointerId) return;
    if (event.buttons === 0) { endContentPan(); return; }
    const distance = event.clientY - contentPan.y;
    if (!contentPan.moving && Math.abs(distance) < 4) return;
    contentPan.moving = true;
    scrollViewport.setAttribute("data-panning", "true");
    scrollPanelTo(contentPan.top - distance);
    event.preventDefault();
}
function endContentPan(event) {
    if (event && contentPan && contentPan.pointerId !== null && event.pointerId !== undefined && event.pointerId !== contentPan.pointerId) return;
    const pan = contentPan; contentPan = null;
    scrollViewport.setAttribute("data-panning", "false");
    for (const target of [scrollViewport, document]) {
        target.removeEventListener("pointermove", moveContentPan);
        target.removeEventListener("pointerup", endContentPan);
        target.removeEventListener("pointercancel", endContentPan);
        target.removeEventListener("mousemove", moveContentPan);
        target.removeEventListener("mouseup", endContentPan);
    }
    if (hostWindow) hostWindow.removeEventListener("blur", endContentPan);
    if (pan && pan.pointerId !== null && typeof scrollViewport.releasePointerCapture === "function") {
        try { scrollViewport.releasePointerCapture(pan.pointerId); } catch (_) { /* The host may already have released capture. */ }
    }
}
function startContentPan(event) {
    if (destroyed || contentPan || scrollDrag || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    if (!Number.isFinite(event.clientY) || !scrollMetrics().maximum || !canPanContent(event.target)) return;
    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
    contentPan = { pointerId, y: event.clientY, top: contentScrollTop, moving: false };
    event.preventDefault();
    for (const target of [scrollViewport, document]) {
        target.addEventListener("pointermove", moveContentPan);
        target.addEventListener("pointerup", endContentPan);
        target.addEventListener("pointercancel", endContentPan);
        target.addEventListener("mousemove", moveContentPan);
        target.addEventListener("mouseup", endContentPan);
    }
    if (hostWindow) hostWindow.addEventListener("blur", endContentPan);
    if (pointerId !== null && typeof scrollViewport.setPointerCapture === "function") {
        try { scrollViewport.setPointerCapture(pointerId); } catch (_) { /* Document listeners also cover hosts without capture. */ }
    }
}
scrollViewport.addEventListener("pointerdown", startContentPan);
scrollViewport.addEventListener("mousedown", startContentPan);
function disposeScrollbar() {
    endContentPan();
    scrollViewport.removeEventListener("pointerdown", startContentPan);
    scrollViewport.removeEventListener("mousedown", startContentPan);
    endScrollDrag();
    scrollViewport.removeEventListener("wheel", onPanelWheel);
    scrollViewport.removeEventListener("mousewheel", onPanelWheel);
    scrollRail.removeEventListener("wheel", onPanelWheel);
    scrollRail.removeEventListener("mousewheel", onPanelWheel);
    scrollViewport.removeEventListener("keydown", onScrollKey);
    scrollRail.removeEventListener("keydown", onScrollKey);
    scrollRail.removeEventListener("mousedown", startScrollDrag);
}
function updateInputClipping() {
    if (destroyed || typeof $("panelViewport").getBoundingClientRect !== "function") return;
    const viewport = $("panelViewport").getBoundingClientRect();
    if (!Number.isFinite(viewport.top) || !Number.isFinite(viewport.bottom) || viewport.bottom <= viewport.top) return;
    for (const input of document.querySelectorAll("input")) {
        if (typeof input.getBoundingClientRect !== "function") continue;
        const box = input.getBoundingClientRect();
        const popup = openedSelect && openedSelect.bounds;
        const covered = popup && box.left < popup.right && box.right > popup.left && box.top < popup.bottom && box.bottom > popup.top;
        const clipped = !Number.isFinite(box.top) || !Number.isFinite(box.bottom) || box.bottom <= box.top || box.top < viewport.top - .5 || box.bottom > viewport.bottom + .5 || covered;
        input.style.visibility = clipped ? "hidden" : "visible";
        input.style.opacity = clipped ? "0" : "1";
    }
}
function scheduleInputClipping() {
    if (destroyed) return;
    updateScrollbar();
    if (openedSelect) openedSelect.refreshScroll();
    updateInputClipping();
    if (clippingFrame !== null || !hostWindow || typeof hostWindow.requestAnimationFrame !== "function") return;
    clippingFrame = hostWindow.requestAnimationFrame(() => { clippingFrame = null; updateScrollbar(); if (openedSelect) openedSelect.refreshScroll(); updateInputClipping(); });
}
function onOutsideSelectClick(event) {
    if (openedSelect && !openedSelect.contains(event.target)) closeSelectMenus();
}
document.addEventListener("click", onOutsideSelectClick);
document.addEventListener("focusin", onOutsideSelectClick);
$("panelViewport").addEventListener("scroll", scheduleInputClipping);
if (hostWindow && typeof hostWindow.addEventListener === "function") hostWindow.addEventListener("resize", scheduleInputClipping);

function lanhuMessage(message) {
    if (destroyed) return;
    $(activePanelTab === "Slice" ? "lanhuSliceStatus" : "lanhuStatus").textContent = message;
    scheduleInputClipping();
}
const TEST_PROJECT_ID = "cfea1199-7c07-48d9-86ef-cdbd3385c237";
let boardScope = 1;
function lanhuView() {
    return typeof lanhuHost.workspace === "function" ? lanhuHost.workspace() : { ...lanhuHost.status(), teams: [], projects: [], groups: [], allArtboards: [], selectedArtboards: [], scales: {} };
}
function fillSelect(id, rows, selected, placeholder) {
    const select = $(id), signature = JSON.stringify([rows, selected, placeholder]);
    if (select.workspaceSignature === signature) return;
    selectControls.get(id).setChoices([{ id: "", name: placeholder, disabled: id !== "lanhuGroup" }, ...rows], selected || "");
    select.workspaceSignature = signature;
}
function display(id, visible) {
    const value = visible ? "block" : "none";
    if ($(id).style.display !== value) $(id).style.display = value;
}
function toggleSection(button, section, open, text) {
    closeSelectMenus();
    $(button).setAttribute("aria-expanded", String(open));
    if (text) $(button).textContent = text;
    display(section, open);
    scheduleInputClipping();
}
function activeDocument() {
    try { return ps.app.activeDocument; } catch (_) { return null; }
}
function scopedBoards(view) {
    return (Number(view.artboardType) === 2 ? view.selectedArtboards : view.allArtboards) || [];
}
function updateLanhuControls(view = lanhuView()) {
    const locked = busy || lanhuBusy || view.uploading;
    const settingsLocked = locked || !!view.upload;
    const doc = activeDocument();
    const canUpload = view.connected && view.loggedIn && view.projectId === TEST_PROJECT_ID;
    $("lanhuUploadAction").disabled = settingsLocked || !canUpload || !doc || !scopedBoards(view).length || !view.deviceType || !view.deviceScale;
    $("connectLanhu").disabled = locked;
    $("lanhuReconnect").disabled = locked;
    $("lanhuLoginAction").disabled = locked || !view.connected || view.loggedIn || view.browserAuthorizing;
    const authorizing = !!view.browserAuthorizing;
    $("lanhuBrowserAuth").disabled = locked || !view.connected || authorizing || view.loggedIn;
    $("lanhuCancelAuth").disabled = locked || !authorizing;
    $("lanhuCancelAuth").style.display = authorizing ? "block" : "none";
    if (authorizing) $("lanhuLoginAction").disabled = true;
    $("lanhuAuthHint").textContent = authorizing ? "等待浏览器授权…完成后将自动更新账号状态。" : "在浏览器登录蓝湖并授权，完成后将自动返回登录状态。";
    $("lanhuLogout").disabled = settingsLocked || !view.loggedIn;
    for (const id of ["lanhuTeam", "lanhuProject", "lanhuGroup", "lanhuToggleDestination"]) $(id).disabled = settingsLocked || !view.loggedIn;
    for (const id of ["lanhuDevice", "lanhuScale", "lanhuBoardsAll", "lanhuBoardsSelected"]) $(id).disabled = settingsLocked || !view.connected;
    for (const id of ["lanhuSliceLayer", "lanhuSliceGroup", "lanhuUnslice"]) $(id).disabled = locked || !view.connected || !doc || !doc.activeLayers || !doc.activeLayers.length;
    for (const id of ["lanhuShowSlices", "lanhuHideSlices"]) $(id).disabled = locked || !view.connected || !doc;
    $("lanhuBack").disabled = locked || !view.connected;
    for (const id of ["lanhuUploadTab", "lanhuSliceTab", "tabAuthoring", "lanhuSliceBack", "authoringBack"]) $(id).disabled = locked;
    $("lanhuFooterHint").textContent = view.uploading ? "正在上传，请稍候。" : view.upload ? "" : !canUpload ? "请先选择隔离测试项目。" :
        !doc ? "请先打开 Photoshop 文档。" : !view.deviceType || !view.deviceScale ? "请选择平台和设计倍数。" :
        !scopedBoards(view).length ? "当前范围没有可上传的画板。" : "";
}
function renderLanhuWorkspace() {
    if (destroyed || !lanhuHost) return;
    const view = lanhuView();
    $("lanhuAccountSummary").textContent = view.loggedIn ? (view.userName || "已登录") : "未登录";
    if (view.loggedIn !== lastLanhuLogin) {
        lastLanhuLogin = view.loggedIn;
        const chooseDestination = view.loggedIn && view.projectId !== TEST_PROJECT_ID;
        toggleSection("lanhuToggleDestination", "lanhuDestination", chooseDestination, chooseDestination ? "收起去向" : "更改去向");
        toggleSection("lanhuTogglePassword", "lanhuPasswordForm", false, "使用账号密码");
        $("lanhuPassword").value = "";
    }
    display("lanhuLogin", view.connected && !view.loggedIn);
    display("lanhuRefreshLogin", !view.connected && !lanhuBusy);
    display("lanhuSettings", view.loggedIn && !view.upload && !view.uploading);
    display("lanhuFooter", activePanelTab === "Upload" && (view.loggedIn || view.upload || view.uploading));
    fillSelect("lanhuTeam", view.teams || [], view.teamId, view.loggedIn ? "请选择团队" : "登录后选择团队");
    fillSelect("lanhuProject", (view.projects || []).map(item => ({ ...item, disabled: item.id !== TEST_PROJECT_ID, name: item.name + (item.id === TEST_PROJECT_ID ? "（测试项目）" : "（当前不可上传）") })), view.projectId, "请选择测试项目");
    fillSelect("lanhuGroup", view.groups || [], view.groupId, "项目根目录");
    $("lanhuDevice").value = view.deviceType || "";
    renderLanhuScales(view.deviceType, view.deviceScale, view.scales);
    boardScope = Number(view.artboardType) || 1;
    $("lanhuBoardsAll").textContent = "全部画板（" + (view.allArtboards || []).length + "）";
    $("lanhuBoardsSelected").textContent = "选中的画板（" + (view.selectedArtboards || []).length + "）";
    $("lanhuBoardsAll").setAttribute("aria-pressed", boardScope === 1 ? "true" : "false");
    $("lanhuBoardsSelected").setAttribute("aria-pressed", boardScope === 2 ? "true" : "false");
    const team = (view.teams || []).find(item => item.id === view.teamId);
    const project = (view.projects || []).find(item => item.id === view.projectId);
    const group = (view.groups || []).find(item => item.id === view.groupId);
    const destination = [team?.name || view.teamName || "未选团队",
        project?.name || view.projectName || "未选项目", view.groupId ? group?.name || view.groupName || "分组待确认" : "项目根目录"];
    $("lanhuDestinationSummary").textContent = destination.join(" / ");
    const doc = activeDocument();
    $("lanhuDocument").textContent = "当前文档：" + (doc ? doc.title || doc.name || "未命名" : "未打开 PSD");
    const layers = doc && doc.activeLayers ? Array.from(doc.activeLayers) : [];
    $("lanhuSliceSelection").textContent = layers.length === 1 ? "已选：" + layers[0].name :
        layers.length > 1 ? "已选 " + layers.length + " 个图层" : "请在 Photoshop 中选择图层或图层组。";
    const boards = doc ? scopedBoards(view) : [];
    const signature = JSON.stringify([!!doc, boardScope, boards]);
    if ($("lanhuBoardList").workspaceSignature !== signature) {
        $("lanhuBoardList").textContent = boards.length ? "" : !doc ? "请先打开 Photoshop 文档。" :
            boardScope === 2 ? "请在 Photoshop 选中要上传的画板，或手动切换为全部画板。" : "当前文档没有可上传的画板。";
        for (const board of boards) {
            const row = document.createElement("div"); row.className = "lanhu-board-row"; row.setAttribute("role", "listitem"); row.textContent = board.name; $("lanhuBoardList").appendChild(row);
        }
        $("lanhuBoardList").workspaceSignature = signature;
    }
    display("lanhuProgress", !!view.upload || !!view.uploading);
    display("lanhuBack", !!view.upload && !view.uploading);
    display("lanhuUploadAction", !view.upload && !view.uploading);
    $("lanhuUploadAction").textContent = boards.length ? "上传 " + boards.length + " 个画板" : "上传到蓝湖";
    if (view.upload) {
        const labels = { uploading: "正在上传", success: "蓝湖上传流程报告成功", fail: "上传失败", unchanged: "画板无变化" };
        const partial = view.upload.phase === "fail" && view.upload.success > 0 && view.upload.fail > 0;
        const title = partial ? "部分画板上传成功" : labels[view.upload.phase] || "上传结果待确认";
        const hint = partial || !labels[view.upload.phase] ? "\n请先在蓝湖核对已收到的画板，不要直接重传整批。" : "";
        $("lanhuProgress").textContent = title + "\n进度 " + view.upload.percentage + "% · 共 " + view.upload.total + " 项 · 成功 " + view.upload.success + " 项 · 失败 " + view.upload.fail + " 项" + hint;
    } else $("lanhuProgress").textContent = view.uploading ? "正在准备上传…" : "";
    updateLanhuControls(view);
    scheduleInputClipping();
}
function renderLanhuScales(device, selected, scales) {
    const rows = scales && scales[device] || [];
    fillSelect("lanhuScale", rows.map(item => ({ id: item.label, name: item.label + " · " + item.value })), selected, "请选择设计倍数");
}
let activePanelTab = "Upload";
const pageScrollPositions = new Map();
function showPanelView(name) {
    endContentPan();
    endScrollDrag();
    closeSelectMenus();
    pageScrollPositions.set(activePanelTab, contentScrollTop);
    activePanelTab = name;
    contentScrollTop = pageScrollPositions.get(name) || 0;
    display("authoringPane", name === "Authoring");
    display("publicResourcesPane", name === "PublicResources");
    display("lanhuPane", name === "Upload" || name === "Slice");
    $("tabAuthoring").setAttribute("aria-selected", String(name === "Authoring"));
    $("tabPublicResources").setAttribute("aria-selected", String(name === "PublicResources"));
    for (const item of ["Upload", "Slice"]) {
        display("lanhu" + item + "View", item === name);
        $("lanhu" + item + "Tab").setAttribute("aria-selected", String(item === name));
    }
    renderLanhuWorkspace();
    scheduleInputClipping();
}
lanhuHost = createLanhuHost({ ps, uxp, document, window: typeof window === "undefined" ? {} : window,
    nativeRequire: require,
    loadRuntime() {
        try { return require("./lanhu-runtime.js"); }
        catch (cause) {
            const error = new Error("当前候选未包含蓝湖业务模块，请使用带蓝湖功能的集成候选。");
            Object.defineProperty(error, "cause", { value: cause }); throw error;
        }
    }, onStatus: lanhuMessage, onChange: renderLanhuWorkspace });
async function lanhuTask(action) {
    if (busy || lanhuBusy || lanhuHost.status().uploading) return;
    lanhuBusy = true; updateLanhuControls();
    try {
        if (!lanhuHost.status().connected) { lanhuMessage("正在连接蓝湖服务…"); await lanhuHost.connect(); }
        if (destroyed) return;
        await action();
    } catch (error) { lanhuMessage(errorText(error)); }
    finally { lanhuBusy = false; renderLanhuWorkspace(); }
}
async function connectLanhu() { return lanhuTask(async () => {
    if (typeof lanhuHost.perform === "function") await lanhuHost.perform("refresh");
    lanhuMessage(lanhuHost.status().loggedIn ? "账号与项目已刷新。" : "请使用蓝湖账号登录。");
}); }
async function uploadLanhu() {
    if ($("lanhuUploadAction").disabled) return;
    const view = lanhuView(), doc = activeDocument();
    if (!doc || !scopedBoards(view).length) return;
    return lanhuTask(async () => {
        scrollPanelTo(0);
        await lanhuHost.upload({ documentId: doc.id, boardIds: scopedBoards(view).map(board => board.id) });
    });
}
function openLanhuWorkspace(name) {
    showPanelView(name);
    if (!lanhuHost.status().connected) return connectLanhu();
}
onClick($("tabAuthoring"), () => {
    showPanelView("Authoring");
    if (!catalogLoad) return (catalogLoad = loadCatalog());
    if (catalogLoading || catalogFailure) return;
    renderResources(undefined, false);
    if (currentSelectionKey() !== selectionIdentity) return run(refresh);
});
onClick($("tabPublicResources"), () => {
    showPanelView("PublicResources");
    if (!catalogLoad) return (catalogLoad = loadCatalog());
    renderPublicResources();
});
onClick($("authoringBack"), () => openLanhuWorkspace("Upload"));
onClick($("lanhuSliceBack"), () => openLanhuWorkspace("Upload"));
onClick($("connectLanhu"), connectLanhu);
onClick($("lanhuReconnect"), connectLanhu);
onClick($("lanhuToggleDestination"), () => {
    const open = $("lanhuDestination").style.display === "none";
    toggleSection("lanhuToggleDestination", "lanhuDestination", open, open ? "收起去向" : "更改去向");
});
onClick($("lanhuTogglePassword"), () => {
    const open = $("lanhuPasswordForm").style.display !== "block";
    if (!open) $("lanhuPassword").value = "";
    toggleSection("lanhuTogglePassword", "lanhuPasswordForm", open, open ? "收起账号登录" : "使用账号密码");
});
onClick($("lanhuUploadAction"), uploadLanhu);
onClick($("lanhuLoginAction"), () => lanhuTask(async () => {
    const credentials = { account: $("lanhuAccount").value, password: $("lanhuPassword").value };
    $("lanhuPassword").value = "";
    await lanhuHost.perform("login", credentials);
}));
onClick($("lanhuLogout"), () => lanhuTask(() => lanhuHost.perform("logout")));
onClick($("lanhuBrowserAuth"), () => lanhuTask(() => lanhuHost.perform("browserAuth")));
onClick($("lanhuCancelAuth"), () => lanhuTask(() => lanhuHost.perform("cancelBrowserAuth")));
for (const [id, action] of [["lanhuTeam", "team"], ["lanhuProject", "project"], ["lanhuGroup", "group"]]) {
    onValueChange($(id), () => { const value = $(id).value; return lanhuTask(() => lanhuHost.perform(action, value)); });
}
function saveLanhuSettings(scope = boardScope) {
    const value = { deviceType: $("lanhuDevice").value, deviceScale: $("lanhuScale").value, artboardType: scope };
    return lanhuTask(() => lanhuHost.perform("settings", value));
}
onValueChange($("lanhuDevice"), () => {
    const device = $("lanhuDevice").value, scales = lanhuView().scales;
    const first = scales && scales[device] && scales[device][0];
    renderLanhuScales(device, first && first.label, scales);
    return saveLanhuSettings();
});
onValueChange($("lanhuScale"), () => saveLanhuSettings());
onClick($("lanhuBoardsAll"), () => saveLanhuSettings(1));
onClick($("lanhuBoardsSelected"), () => saveLanhuSettings(2));
for (const [id, action] of [["lanhuSliceLayer", "sliceWithLayer"], ["lanhuSliceGroup", "sliceWithGroup"], ["lanhuUnslice", "unslice"], ["lanhuShowSlices", "showSlice"], ["lanhuHideSlices", "hiddenSlice"], ["lanhuBack", "back"]]) {
    onClick($(id), () => lanhuTask(() => lanhuHost.perform(action)));
}
for (const name of ["Upload", "Slice"]) onClick($("lanhu" + name + "Tab"), () => openLanhuWorkspace(name));
showPanelView("Upload");

function displayText(value) {
    return String(value).replace(/[A-Za-z0-9._@:/-]{24,}/g, token => token.match(/.{1,20}/g).join("\n"));
}
function status(message) {
    $(activePanelTab === "PublicResources" ? "publicResourceStatus" : "status").textContent = displayText(message);
    scheduleInputClipping();
}
function errorText(error) {
    const original = String(error && error.message || error);
    $("errorDetails").textContent = displayText((error && error.code ? "错误码：" + error.code + "\n" : "") + original);
    if (/^[\u3400-\u9fff]/.test(original)) return original;
    const translations = [
        [/Open a PSD and select exactly one pixel layer/i, "请打开 PSD，并只选择一个普通像素图层。"],
        [/Only ordinary pixel layers|Masks, styles, advanced blending/i, "仅支持普通像素层；请在独立副本中明确栅格化或合并样式、蒙版、智能对象等内容。"],
        [/8-bit RGB document|already using sRGB/i, "仅支持已使用 sRGB IEC61966-2.1 的八位 RGB 文档；请先在独立副本中转换。"],
        [/visible layers and parents/i, "请确保图层及父层可见、不透明度与填充均为百分之百、使用正常混合且无剪贴关系。"],
        [/descriptor unavailable/i, "无法读取图层外观信息，请重新选择受支持的普通像素层后重试。"],
        [/readback differs|readback mismatch/i, "写入后回读不一致，操作未完成；请保留原稿并重新检查后重试。"],
        [/bounds differ from the recorded target/i, "图层内容范围与已登记目标不一致，请通过面板重新应用目标尺寸。"],
        [/Immutable assetRef conflict/i, "同一资源版本的内容发生冲突；请发布新版本，不要覆盖或合并旧资源。"],
        [/snapshot is missing|legacy resource needs a source snapshot|requires its original source snapshot/i, "缺少原始源快照，请从原始源图层重新定义或导入有效备份，不要从拉伸效果图反推。"],
        [/positive integer dimensions|pixel limit/i, "宽高必须为正整数，源图或预览总像素不得超过 4,194,304。"],
        [/padding must be nonnegative|bounds must be nonempty integer/i, "源图边界须为非空整数像素，透明留白须为非负整数。"],
        [/Unknown required capability|Unsupported.*version/i, "元数据版本或必需能力不受支持；请使用兼容面板或恢复有效备份，不要覆盖现有数据。"],
        [/Duplicate or missing nodeId|Document and artboard identities/i, "文档或图层身份缺失或重复，请在高级操作中检查并显式修复身份。"],
        [/PNG|snapshot.*checksum|snapshot.*block|snapshot.*filter/i, "源图快照无效或不兼容，请保留原文件并导入有效备份，或从原始源图层重新定义。"],
        [/Target canvas|Target content bounds/i, "实例目标画布记录无效，请检查完整尺寸和内容范围并重新应用目标尺寸。"]
    ];
    const found = translations.find(([pattern]) => pattern.test(original));
    const suffixAt = original.search(/[\u3400-\u9fff]/);
    const suffix = suffixAt > 0 ? "\n" + original.slice(suffixAt) : "";
    return (found ? found[1] : "操作未完成，请在高级操作中查看原始诊断，检查文档和图层后重试。") + suffix;
}
function samplingText(asset) { return asset.sampling && asset.sampling.filterMode === "Point" ? "点采样（Point）" : "双线性（Bilinear）"; }
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
        $("identityInfo").textContent = "新建九宫格源图；内部引用与版本由工具自动维护。";
        $("resourceInfo").textContent = "";
        updateMode(); return;
    }
    defaultField("displayName", asset.displayName || asset.assetKey || "", pending);
    $("identityInfo").textContent = displayText("诊断引用（工具维护）：\n" + selectedResourceRef);
    for (const side of ["left", "top", "right", "bottom"]) defaultField(side, String(asset.nineSlice?.[side] ?? 0), pending);
    defaultField("sampling", asset.sampling ? asset.sampling.filterMode : "Bilinear", pending);
    $("sampling").setAttribute("value", $("sampling").value);
    $("resourceInfo").textContent = displayText(selectedResourceRef) + "\n" + asset.sourceSize.width + "×" + asset.sourceSize.height + " 源像素";
    updateMode();
}
function updateMode() {
    const asset = catalog.assets[selectedResourceRef];
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
    const entries = Object.keys(catalog.assets).sort().map(ref => {
        const asset = catalog.assets[ref];
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
    display("previewResult", false);
    if (!ref) $("displayName").value = "";
    assetFields(); renderedRef = ref;
    markResourceChoice();
}
async function persistCatalog(next) {
    const text = JSON.stringify(author.writeCatalog(next), null, 2);
    if (!catalogFile) {
        const folder = await fs.getDataFolder();
        catalogFile = await folder.createFile("gameui-resource-catalog-v2.json");
    }
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
    const nextCatalog = author.importCatalog(catalog, portable);
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
            onClick(button, () => run(() => modal("定位检查图层", doc => store.locateLayer(doc.id, issue.layerId))));
            row.appendChild(button);
        }
        if (issue.code === "MISSING_LAYER") {
            const button = createButton(); button.textContent = "移除失效绑定";
            onClick(button, () => run(() => modal("移除失效绑定", async doc => {
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
            selectionIdentity = key; lastBoundRef = null; explicitResourceRef = null; resourceChoicesOpen = false;
            display("previewResult", false);
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
            catalog = author.importCatalog(catalog, portable);
        }
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
                for (const side of ["left", "top", "right", "bottom"]) defaultField(side, "0", pending);
                defaultField("sampling", "Bilinear", pending);
            }
        }
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
    closeSelectMenus(); updateLanhuControls();
    for (const button of document.querySelectorAll(".ui-button")) button.disabled = true;
    try {
        const result = await action();
        if (activePanelTab === "PublicResources") renderPublicResources();
        else if (action !== refresh) await refresh();
        if (typeof result === "string") status(result);
    }
    catch (error) { status(errorText(error)); }
    finally { busy = false; for (const button of document.querySelectorAll(".ui-button")) button.disabled = false; updateLanhuControls(); }
}
function bind(id, action) {
    onClick($(id), () => run(async () => {
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
                const asset = catalog.assets[resource()];
                const marker = next.nodes[layer.id];
                const prior = marker && next.authoring.targets && next.authoring.targets[marker.nodeId];
                const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
                const target = prior || {
                    width, height, insetLeft: 0, insetTop: 0, contentWidth: width, contentHeight: height
                };
                if (asset.nineSlice) next = author.reference(author.importResource(next, catalog, chosen), layer.id, chosen, false, target);
                else {
                    const settings = author.resourceOptions(catalog, chosen, "update", { ...options(), displayName: asset.displayName });
                    next = author.withTarget(author.define(next, layer.id, settings, catalog.authoring.sources[chosen]), layer.id, target);
                }
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
    if (ref && !catalog.assets[ref].nineSlice) throw new Error("请先为该源图记录九宫格设置。");
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
    if (!catalog.assets[resource()].nineSlice) throw new Error("请先为该源图记录九宫格设置。");
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
    display("previewResult", true);
});
bind("import", async () => {
    const file = await fs.getFileForOpening({ types: ["json"], allowMultiple: false }); if (!file) return;
    const input = JSON.parse(await file.read());
    await persistCatalog(author.importCatalog(catalog, input));
    catalogFailure = null;
    return "已导入资源目录。";
});
bind("export", async () => {
    const output = author.writeCatalog(catalog);
    const file = await fs.getFileForSaving("gameui-resources.json", { types: ["json"] }); if (!file) return;
    const text = JSON.stringify(output, null, 2); await file.write(text);
    if (await file.read() !== text) throw new Error("导出目录回读不一致。");
});
function renderPublicResources() {
    const list = $("publicResources");
    list.textContent = "";
    const entries = Object.entries(catalog.assets);
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
    const name = $("publicResourceName").value.trim();
    if (!name) throw new Error("请输入公共资源名称。");
    const { doc, layer } = store.selectedLayer();
    const { metadata } = await store.readMetadata(doc.id);
    if (metadata?.nodes?.[layer.id]) throw new Error("该图层已经绑定九宫格版本，请用资源目录中的原始源图。");
    const source = await store.captureLayerSource(doc, layer);
    const next = author.addPublicResource(catalog, name, source);
    await persistCatalog(next);
    selectedPublicRef = Object.keys(next.assets).at(-1);
    $("publicResourceName").value = "";
    return "已收录源图。";
});
bind("exportPublicSource", async () => {
    const asset = catalog.assets[selectedPublicRef], source = catalog.authoring?.sources[selectedPublicRef];
    if (!asset || !source) throw new Error("请先选择要导出的源图。");
    const name = String(asset.displayName || asset.assetKey || "resource").replace(/[\\/:*?"<>|]/g, "-");
    const file = await fs.getFileForSaving(name + ".png", { types: ["png"] });
    if (!file) return;
    await file.write(author.unbase64(source.pngBase64).buffer, { format: uxp.storage.formats.binary });
    return "已导出原始源 PNG。";
});
for (const id of ["displayName", "left", "top", "right", "bottom", "sampling", "padLeft", "padTop", "padRight", "padBottom", "targetWidth", "targetHeight"]) {
    const edited = () => fieldEdits.set(id, { key: currentSelectionKey(), revision: ++editRevision });
    $(id).addEventListener("input", edited);
    onValueChange($(id), edited);
}
async function onSelectionEvent() {
    if (destroyed || busy || catalogLoading || activePanelTab !== "Authoring") return;
    try {
        if (currentSelectionKey() !== selectionIdentity) await run(refresh);
    } catch (error) { status("自动选择刷新失败，请使用高级刷新 / 检查：" + errorText(error)); }
}
async function registerSelectionEvents() {
    try {
        await ps.action.addNotificationListener(selectionEvents, onSelectionEvent);
        if (destroyed) { await ps.action.removeNotificationListener(selectionEvents, onSelectionEvent); return; }
        listenerRegistered = true;
    } catch (error) { notificationFailure = errorText(error); }
}
uxp.entrypoints.setup({ plugin: { create() { destroyed = false; }, async destroy() {
    destroyed = true;
    closeSelectMenus();
    disposeScrollbar();
    document.removeEventListener("click", onOutsideSelectClick);
    document.removeEventListener("focusin", onOutsideSelectClick);
    $("panelViewport").removeEventListener("scroll", scheduleInputClipping);
    if (hostWindow && typeof hostWindow.removeEventListener === "function") hostWindow.removeEventListener("resize", scheduleInputClipping);
    if (clippingFrame !== null && hostWindow && typeof hostWindow.cancelAnimationFrame === "function") hostWindow.cancelAnimationFrame(clippingFrame);
    await lanhuHost.destroy();
    if (listenerRegistered) await ps.action.removeNotificationListener(selectionEvents, onSelectionEvent);
} }, panels: { gameuiAuthoring: { show() {
    if (activePanelTab === "Authoring") { if (!busy && !catalogLoading) run(refresh); }
    else if (activePanelTab === "PublicResources") renderPublicResources();
    else if (!lanhuHost.status().connected) return connectLanhu();
} } } });
async function loadCatalog() {
    status("资源目录正在加载，请稍候。");
    try {
        const folder = await fs.getDataFolder();
        if (destroyed) return;
        const entries = await folder.getEntries();
        catalogFile = entries.find(entry => entry.name === "gameui-resource-catalog-v2.json") || null;
        const input = catalogFile || entries.find(entry => entry.name === "gameui-resource-catalog.json");
        if (input) {
            try { catalog = author.readCatalog(JSON.parse(await input.read())); }
            catch (error) { catalogFailure = error.message; throw error; }
        }
        if (destroyed) return;
        catalogFailure = null;
        catalogLoading = false;
        await registerSelectionEvents();
        if (activePanelTab === "Authoring") await run(refresh);
        if (activePanelTab === "PublicResources") { renderPublicResources(); status("资源目录已加载。"); }
        if (notificationFailure) status("自动选择刷新不可用，请使用高级操作中的刷新 / 检查：" + notificationFailure);
    } catch (error) {
        if (catalogLoading || catalogFailure) { catalogLoading = false; catalogFailure = errorText(error); status("目录检查失败，已阻止覆盖：" + catalogFailure); }
        else status("PSD 检查失败：" + errorText(error));
    }
}
