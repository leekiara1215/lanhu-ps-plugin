"use strict";

const ps = require("photoshop");
const uxp = require("uxp");
const store = require("./gameui-ps.js");
const author = require("./gameui-authoring.js");
const core = require("./gameui-core.js");
const { createLanhuHost, TEST_PROJECT_ID } = require("./lanhu-host.js");
const { createCatalogStorage } = require("./adapters/catalog-storage.js");
const { createCatalog } = require("./application/catalog.js");
const { createDocumentActions } = require("./application/document.js");
const { createResourceActions } = require("./application/resources.js");
const { createControls } = require("./ui/controls.js");
const { errorText } = require("./ui/messages.js");
const { createNavigation, Route } = require("./ui/navigation.js");
const { createLanhuWorkspace } = require("./workspaces/lanhu.js");
const { createResourcesWorkspace } = require("./workspaces/resources.js");

const $ = id => document.getElementById(id);
const hostWindow = typeof window === "undefined" ? null : window;
const isDestroyed = () => destroyed;
const getRoute = () => navigation?.current() ?? Route.UPLOAD;
const isResourceBusy = () => resources?.isBusy() ?? false;
const isLanhuRoute = route => route === Route.UPLOAD || route === Route.SLICE;
const describeError = error => errorText(error, $("errorDetails"));
let destroyed = false, navigation, lanhu, resources;

const controls = createControls({
    document, hostWindow, $, isDestroyed, isBusy: () => isResourceBusy() || lanhu?.isBusy(),
    nestedScrollIds: ["resources", "publicResources", "lanhuBoardList"]
});
const catalog = createCatalog({ author, storage: createCatalogStorage(uxp) });
const documents = createDocumentActions({ ps, store, author, core, catalog });
const actions = createResourceActions({ author, store, catalog, documents });

lanhu = createLanhuWorkspace({ ps, uxp, $, document, hostWindow, controls, getRoute, isResourceBusy, isDestroyed,
    createLanhuHost, testProjectId: TEST_PROJECT_ID, errorText: describeError, nativeRequire: require, loadRuntime: () => require("./lanhu-runtime.js") });
resources = createResourcesWorkspace({ ps, $, document, controls, author, store, catalog, documents, actions, lanhu,
    getRoute, isDestroyed, errorText: describeError });
navigation = createNavigation({ $, controls, onShow: lanhu.render,
    onOpen: route => isLanhuRoute(route) ? lanhu.open() : resources.open(route) });
navigation.show(Route.UPLOAD);

uxp.entrypoints.setup({
    plugin: {
        create() { destroyed = false; },
        async destroy() {
            destroyed = true;
            controls.destroy();
            try { await lanhu.destroy(); }
            finally { await resources.destroy(); }
        }
    },
    panels: {
        gameuiAuthoring: {
            show() {
                const route = getRoute();
                return isLanhuRoute(route) ? lanhu.open() : resources.show(route);
            }
        }
    }
});
