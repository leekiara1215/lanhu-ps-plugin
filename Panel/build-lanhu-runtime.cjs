"use strict";
// The official artifact is an explicit, hash-pinned build input, never repository source.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const compatibility = require("../compatibility.json");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function replaceOnce(source, seam, replacement) {
    if (source.split(seam).length !== 2) throw new Error("Official integration seam changed; refusing to build: " + seam.slice(0, 70));
    return source.replace(seam, replacement);
}

function prepareRuntime(plugin) {
    const manifestBytes = fs.readFileSync(path.join(plugin, "manifest.json"));
    const bytes = fs.readFileSync(path.join(plugin, "index.js"));
    const supported = compatibility.official;
    if (sha(manifestBytes) !== supported.manifestSha256 || sha(bytes) !== supported.indexSha256) {
        throw new Error("Unsupported official manifest/index hash; use the pinned original package, not an installed enhanced copy.");
    }
    const manifest = JSON.parse(manifestBytes);
    if (manifest.id !== supported.id || manifest.version !== supported.version || manifest.host.data.apiVersion !== 1) {
        throw new Error("Unsupported official package identity.");
    }
    let source = bytes.toString("utf8");
    const seam = "t.prototype.formatFrame=function";
    const wrappers = 't.prototype.analysis=(function(original){return function(){var self=this,args=arguments;gameuiHost.assertUploadAllowed(args[0]);return gameuiHost.runModal(function(){return original.apply(self,args)})}})(t.prototype.analysis),'
        + 't.prototype.formatPluginData=(function(original){return function(M,t,e,i){return original.apply(this,arguments).then(function(payload){return require("./gameui-export.js").capture(payload,e,M.id,this)}.bind(this))}})(t.prototype.formatPluginData),';
    source = replaceOnce(source, seam, wrappers + seam);
    const finalize = 'case 4:return s=O.sent(),i({type:r.UploadCallBackType.artboard';
    source = replaceOnce(source, finalize, 'case 4:return s=O.sent(),s=require("./gameui-export.js").finalize(s,e),i({type:r.UploadCallBackType.artboard');
    const upload = 'methods:{uploadArtboard:function(){var M=this;return';
    source = replaceOnce(source, upload, 'methods:{uploadArtboard:function(){var M=this;gameuiHost.assertUploadAllowed(M);return');
    const uploadItem = 't.uploadSingleArtboart=function(M,t,e){return';
    source = replaceOnce(source, uploadItem, 't.uploadSingleArtboart=function(M,t,e){gameuiHost.assertUploadAllowed(t);return');
    const submit = 'submitLanhu:function(M){var t=this;return';
    source = replaceOnce(source, submit, 'submitLanhu:function(M){var t=this;gameuiHost.assertUploadAllowed(t);return');
    // API 1 allowed these DOM mutations implicitly. Wrap the public API boundary,
    // leaving recursive formatter calls inside an existing analysis modal synchronous.
    const group = 'return D.sliceWithGroup(M,t),[2]';
    source = replaceOnce(source, group, 'return[2,D.sliceWithGroup(M,t)]');
    const sliceBoundary = 't.getSelectArtBoard=function';
    const sliceWrappers = '["sliceWithLayer","sliceWithGroup","unSlice","showSlice","hiddenSlice"].forEach(function(name){var original=t[name];t[name]=function(){var self=this,args=arguments;return gameuiHost.runModal(function(){return original.apply(self,args)})}}),';
    source = replaceOnce(source, sliceBoundary, sliceWrappers + sliceBoundary);
    source = replaceOnce(source, 'console.clear(),window.alert', 'void 0,window.alert');
    source = replaceOnce(source, 'window.crypto||(window.crypto=', 'crypto=window.crypto||(window.crypto=');
    // The factory is lazy. Loading this module does not bootstrap Vue, read a session or access the network.
    const runtime = '"use strict";\nmodule.exports = function(gameuiHost) {\n'
        + 'const window=gameuiHost.window,document=gameuiHost.document,localStorage=gameuiHost.localStorage,require=gameuiHost.require,self=window,globalThis=window;\n'
        + 'const setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;\n'
        + 'const btoa=function(value){return window.btoa(value)},atob=function(value){return window.atob(value)},alert=function(){return window.alert.apply(window,arguments)};let crypto=window.crypto;\n'
        + source + '\nreturn window.VM;\n};\n';
    return { runtime, identity: { schemaVersion: 1, officialId: manifest.id, officialVersion: manifest.version,
        officialManifestSha256: sha(manifestBytes), officialIndexSha256: sha(bytes), runtimeSha256: sha(runtime),
        projectId: compatibility.projectId, format: "lazy-scoped-vue-factory", apiVersion: 2,
        seams: ["analysis modal/project guard", "capture", "finalize", "Home upload project guard", "uploader project guard", "submit project guard", "slice API modal", "slice group promise ownership", "console preservation", "scoped crypto fallback"] } };
}

module.exports = { prepareRuntime };
