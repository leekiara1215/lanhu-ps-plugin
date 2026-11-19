"use strict";

const Route = Object.freeze({
    UPLOAD: "Upload",
    SLICE: "Slice",
    PUBLIC_SOURCES: "PublicResources",
    NINE_SLICE: "Authoring"
});

function createNavigation({ $, controls, onShow, onOpen }) {
    const { onClick, display, beforeNavigation, afterNavigation } = controls;
    const positions = new Map();
    let current = Route.UPLOAD;
    let resourceRoute = Route.PUBLIC_SOURCES;

    function show(route) {
        positions.set(current, beforeNavigation());
        current = route;
        const resources = route === Route.PUBLIC_SOURCES || route === Route.NINE_SLICE;
        if (resources) resourceRoute = route;
        display("resourceTabs", resources, "flex");
        display("resourcesWorkspace", resources);
        display("authoringPane", route === Route.NINE_SLICE);
        display("publicResourcesPane", route === Route.PUBLIC_SOURCES);
        display("lanhuPane", !resources);
        $("resourcesTab").setAttribute("aria-selected", String(resources));
        $("tabAuthoring").setAttribute("aria-selected", String(resourceRoute === Route.NINE_SLICE));
        $("tabPublicResources").setAttribute("aria-selected", String(resourceRoute === Route.PUBLIC_SOURCES));
        for (const routeName of [Route.UPLOAD, Route.SLICE]) {
            display("lanhu" + routeName + "View", route === routeName);
            $("lanhu" + routeName + "Tab").setAttribute("aria-selected", String(route === routeName));
        }
        onShow(route);
        afterNavigation(positions.get(route) || 0);
    }

    function open(route) {
        show(route);
        return onOpen(route);
    }

    onClick($("lanhuUploadTab"), () => open(Route.UPLOAD));
    onClick($("lanhuSliceTab"), () => open(Route.SLICE));
    onClick($("resourcesTab"), () => open(resourceRoute));
    onClick($("tabPublicResources"), () => open(Route.PUBLIC_SOURCES));
    onClick($("tabAuthoring"), () => open(Route.NINE_SLICE));
    onClick($("authoringBack"), () => open(Route.UPLOAD));

    return { show, open, current: () => current };
}

module.exports = { createNavigation, Route };
