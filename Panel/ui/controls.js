"use strict";

function createControls({ document, hostWindow, $, isBusy, isDestroyed, nestedScrollIds }) {
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
        element.disabled = isBusy();
        return element;
    }
    function onClick(element, action) {
        prepareButton(element);
        const activate = event => {
            if (isDestroyed() || element.disabled) return;
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
    function makeSelect(id, rows, selected = "", { headerAnchor = false } = {}) {
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
            let anchor, bounds, origin;
            if (typeof trigger.getBoundingClientRect === "function" && typeof $("panelViewport").getBoundingClientRect === "function") {
                anchor = trigger.getBoundingClientRect(); bounds = $("panelViewport").getBoundingClientRect();
                origin = panelFrame.getBoundingClientRect();
                const anchorTop = headerAnchor ? origin.top : bounds.top;
                if (![anchor.top, anchor.bottom, anchor.left, anchor.right, bounds.top, bounds.bottom, bounds.left, bounds.right, origin.top, origin.left].every(Number.isFinite) ||
                    anchor.bottom <= anchor.top || anchor.right <= anchor.left || bounds.right - bounds.left <= 8 ||
                    anchor.top < anchorTop - .5 || anchor.bottom > bounds.bottom + .5 || anchor.right <= bounds.left || anchor.left >= bounds.right) {
                    close(); return;
                }
                selectOverlay.style.width = Math.min(anchor.right - anchor.left, bounds.right - bounds.left - 8) + "px";
                const above = headerAnchor ? 0 : Math.max(0, anchor.top - bounds.top - 8);
                const below = Math.max(0, bounds.bottom - Math.max(anchor.bottom, bounds.top) - 8);
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
                const top = menu.getAttribute("data-placement") === "top" ? anchor.top - 4 - height : Math.max(anchor.bottom, bounds.top) + 4;
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
            if (!expanded || isDestroyed() || (event.button !== undefined && event.button !== 0) || !Number.isFinite(event.clientY)) return;
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
            if (!expanded || isDestroyed() || event.ctrlKey || event.metaKey) return;
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
            if (disabled || isDestroyed()) return;
            if (openedSelect && openedSelect !== control) openedSelect.close();
            if (typeof trigger.focus === "function") trigger.focus();
            expanded = true; openedSelect = control;
            selectOverlay.style.display = "block";
            active = choices.findIndex(row => row.id === value && !row.disabled);
            if (active < 0) active = choices.findIndex(row => !row.disabled);
            paint(); refreshScroll(); revealActive(); scheduleInputClipping();
        }
        function choose(index) {
            if (!expanded || disabled || isDestroyed() || !choices[index] || choices[index].disabled) return;
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
        const control = { element, open, close, refreshScroll, get bounds() { return popupBounds; },
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
            if (disabled || isDestroyed()) return;
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
            if (!nestedScrollIds.includes(node.id)) continue;
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
                classes.includes("ui-select") || nestedScrollIds.includes(node.id)) return false;
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
        if (isDestroyed() || contentPan || scrollDrag || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
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
        if (isDestroyed() || typeof $("panelViewport").getBoundingClientRect !== "function") return;
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
        if (isDestroyed()) return;
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

    function fillSelect(id, rows, selected, placeholder, allowEmpty = false) {
        const select = $(id), signature = JSON.stringify([rows, selected, placeholder, allowEmpty]);
        if (select.workspaceSignature === signature) return;
        selectControls.get(id).setChoices([{ id: "", name: placeholder, disabled: !allowEmpty }, ...rows], selected || "");
        select.workspaceSignature = signature;
    }
    function display(id, visible, visibleDisplay = "block") {
        const value = visible ? visibleDisplay : "none";
        if ($(id).style.display !== value) $(id).style.display = value;
    }
    function toggleSection(button, section, open, text) {
        closeSelectMenus();
        $(button).setAttribute("aria-expanded", String(open));
        if (text) $(button).textContent = text;
        display(section, open);
        scheduleInputClipping();
    }
    function beforeNavigation() {
        endContentPan();
        endScrollDrag();
        closeSelectMenus();
        return contentScrollTop;
    }
    function afterNavigation(top) {
        contentScrollTop = top;
        scheduleInputClipping();
    }
    function destroy() {
        closeSelectMenus();
        disposeScrollbar();
        document.removeEventListener("click", onOutsideSelectClick);
        document.removeEventListener("focusin", onOutsideSelectClick);
        scrollViewport.removeEventListener("scroll", scheduleInputClipping);
        if (hostWindow && typeof hostWindow.removeEventListener === "function") hostWindow.removeEventListener("resize", scheduleInputClipping);
        if (clippingFrame !== null && hostWindow && typeof hostWindow.cancelAnimationFrame === "function") hostWindow.cancelAnimationFrame(clippingFrame);
    }
    return {
        createButton, onClick, onValueChange, makeSelect, closeSelectMenus, fillSelect, display, toggleSection,
        scheduleInputClipping, scrollPanelTo, beforeNavigation, afterNavigation, destroy,
        hasOpenPicker: () => !!openedSelect,
        openPicker: id => selectControls.get(id).open()
    };
}

module.exports = { createControls };
