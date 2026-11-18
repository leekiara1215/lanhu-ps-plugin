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
    const wrappers = 't.prototype.analysis=(function(original){return function(config,callback){var self=this,failed=false;gameuiHost.assertUploadAllowed(config);'
        + 'return gameuiHost.runModal(function(){return original.call(self,config,function(ok,board){if(!ok)failed=true;if(callback)callback(ok,board)})}).catch(function(error){if(!failed&&callback)callback(false,{});gameuiHost.reportUploadAnalysisFailure(error);return []})}})(t.prototype.analysis),'
        + 't.prototype.formatPluginData=(function(original){return function(M,t,e,i){return original.apply(this,arguments).then(function(payload){return require("./gameui-export.js").capture(payload,e,M.id,this,{document:M,mode:t,board:i})}.bind(this))}})(t.prototype.formatPluginData),';
    source = replaceOnce(source, seam, wrappers + seam);
    // Use the same native JSON as the pinned formatter, before it mutates slice visibility
    // or takes the no-artboard path that would otherwise ignore an empty selection.
    const readDocument = 'case 1:return g.trys.push([1,12,,13]),[4,(0,a.batchPlay)(a.getDocumentData,y)];case 2:if((e=g.sent()).length<1)throw new Error("get document data faild");if(i=e[0].json,A=JSON.parse(i),';
    source = replaceOnce(source, readDocument, 'case 1:return g.trys.push([1,12,,13]),[4,(0,a.batchPlay)(a.getDocumentData,y).then(function(values){'
        + 'if(!values.length)throw new Error("get document data faild");return require("./gameui-export.js").prepareAnalysis(JSON.parse(values[0].json),M,require("photoshop").app.activeDocument,gameuiHost.takeUploadScope(M.selectArtboards))})];case 2:if(A=g.sent(),');
    source = replaceOnce(source, 'case 12:throw I=g.sent(),t&&t(!1,{}),console.error(I),new Error("parse document data faild");',
        'case 12:throw I=g.sent(),A&&this.showSlice(),t&&t(!1,{}),I;');
    const finalize = 'case 4:return s=O.sent(),i({type:r.UploadCallBackType.artboard';
    source = replaceOnce(source, finalize, 'case 4:return s=O.sent(),s=require("./gameui-export.js").finalize(s,e),i({type:r.UploadCallBackType.artboard');
    const upload = 'methods:{uploadArtboard:function(){var M=this;return';
    source = replaceOnce(source, upload, 'methods:{uploadArtboard:function(){var M=this;gameuiHost.assertUploadAllowed(M);return');
    // Vue Router 2.8.1 uses callbacks. Keep the Home operation and its confirmed
    // selection alive until the upload route is committed or navigation aborts.
    const pushUpload = 'M.$router.push({name:"upload"})';
    const precheck = '"00000"===(null==(g=t.sent)?void 0:g.code)?null!=g&&null!==(u=g.data)&&void 0!==u&&u.img_num_overrun?M.showPluginErr("20007",""):(w.lanhuLogger.setLogPoint("from",{eventId:"plugin_upload_artboard_num",eventName:"插件上传画板数量"+n.length},""),' + pushUpload + '):M.showPluginErr(null==g?void 0:g.code,null==g?void 0:g.msg)';
    const waitForRoute = 'new Promise(function(resolve,reject){M.$router.push({name:"upload"},resolve,function(error){reject(error||new Error("Blue Lake upload navigation aborted."))})})';
    source = replaceOnce(source, 'case 59:' + precheck + ';case 61:',
        'case 59:return t.abrupt("return",(' + precheck.replace(pushUpload, waitForRoute) + '));case 61:');
    // API 2 exposes Rectangle coordinates through getters. Copy named values
    // before clamping so Photoshop crop receives its expected plain rectangle.
    const sliceBoundsCopy = '(A=o({},M)).left<0&&(A.left=0),A.top<0&&(A.top=0)';
    const sliceBounds = '{left:M.left??M._left,top:M.top??M._top,right:M.right??M._right,bottom:M.bottom??M._bottom}';
    source = replaceOnce(source, sliceBoundsCopy, sliceBoundsCopy.replace('o({},M)', sliceBounds));
    const queue = 'uploadArtboards:function(){var M=this;HN.Z.setIntervalTime';
    source = replaceOnce(source, queue, 'uploadArtboards:function(){var M=this;try{gameuiHost.checkUploadScope(this.artboardPoolList)}catch(error){this.uploadStatus=this.UploadStatusConfig.fail;gameuiHost.reportUploadAnalysisFailure(error);return}HN.Z.setIntervalTime');
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
    source = replaceOnce(source, 'M.prototype.showSlice=function(){(0,N.showSlice)()},M.prototype.hiddenSlice=function(){(0,N.hiddenSlice)()}', 'M.prototype.showSlice=function(){return(0,N.showSlice)()},M.prototype.hiddenSlice=function(){return(0,N.hiddenSlice)()}');
    source = replaceOnce(source, 'console.clear(),window.alert', 'void 0,window.alert');
    source = replaceOnce(source, 'window.crypto||(window.crypto=', 'crypto=window.crypto||(window.crypto=');
    source = replaceOnce(source, 'toSelect:function(){var M=this;return', 'browserConnection:function(){return{id:p(),domain:(0,Mt.getDomain)()}},toSelect:function(){var M=this;return');
    const popperEvents = 'this.update();var n=this.options.eventsEnabled;n&&this.enableEventListeners(),this.state.eventsEnabled=n';
    source = replaceOnce(source, popperEvents, 'this.update();this.state.eventsEnabled=!1');
    // Expose only the pinned business adapters to our own UXP controls. The legacy
    // view stays hidden; it continues to own the audited upload state machine.
    const bootstrap = 'window.VM=new k.default({router:q(),store:MM(),render:function(M){return M(X)}}).$mount("#app")';
    source = replaceOnce(source, bootstrap, bootstrap + ',window.VM.$gameuiServices={auth:e(62824),account:e(62909),project:e(78578),scales:e(94878).DeviceScaleDic,sliceScales:e(94878).SelectScaleConfig}');
    // The factory is lazy. Loading this module does not bootstrap Vue, read a session or access the network.
    const runtime = '"use strict";\nmodule.exports = function(gameuiHost) {\n'
        + 'const window=gameuiHost.window,document=gameuiHost.document,localStorage=gameuiHost.localStorage,require=gameuiHost.require,self=window,globalThis=window;\n'
        + 'const setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;\n'
        + 'const btoa=function(value){return window.btoa(value)},atob=function(value){return window.atob(value)},alert=function(){return window.alert.apply(window,arguments)};let crypto=window.crypto;\n'
        + source + '\nreturn window.VM;\n};\n';
    return { runtime, identity: { schemaVersion: 1, officialId: manifest.id, officialVersion: manifest.version,
        officialManifestSha256: sha(manifestBytes), officialIndexSha256: sha(bytes), runtimeSha256: sha(runtime),
        projectId: compatibility.projectId, format: "lazy-scoped-vue-factory", apiVersion: 2,
        seams: ["analysis modal/project guard", "verified PSD selection", "analysis failure handling", "capture", "finalize", "Home upload project guard", "await upload route navigation", "upload queue scope check", "uploader project guard", "submit project guard", "slice API modal", "slice Rectangle coordinates", "slice group promise ownership", "slice visibility promise ownership", "console preservation", "scoped crypto fallback", "native browser authorization handshake", "disable detached Popper event tracking", "native workspace business adapters"] } };
}

module.exports = { prepareRuntime };
