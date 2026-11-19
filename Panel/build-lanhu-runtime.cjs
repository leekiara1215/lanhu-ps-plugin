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
    // A GameUI instance can come from an ordinary pixel layer with no Lanhu slice
    // prefix. Produce its native validation image from the selected layer copy.
    source = replaceOnce(source, 'case 2:return E=g.sent(),c||s?(w=void 0',
        'case 2:return E=g.sent(),c||s||require("./gameui-export.js").needsInstanceReference(M,e)?(w=void 0');
    source = replaceOnce(source, 'case 6:return[4,this.exportSlice(M.id,e.sliceScale,w,t)];case 7:return l=g.sent(),L=M.name.slice(3,M.name.length)',
        'case 6:return[4,c||s?this.exportSlice(M.id,e.sliceScale,w,t):this._exportSlicedCopy(w,t,e.sliceScale,j.app.activeDocument)];'
        + 'case 7:return l=g.sent(),L=c||s?M.name.slice(3,M.name.length):M.name');
    const finalize = 'case 4:return s=O.sent(),i({type:r.UploadCallBackType.artboard';
    source = replaceOnce(source, finalize, 'case 4:return s=O.sent(),s=require("./gameui-export.js").finalize(s,e),i({type:r.UploadCallBackType.artboard');
    const upload = 'methods:{uploadArtboard:function(){var M=this;return';
    source = replaceOnce(source, upload, 'methods:{uploadArtboard:function(){var M=this;gameuiHost.assertUploadAllowed(M);return');
    source = replaceOnce(source, 'return y.y.error({message:"不支持 ".concat(i.mode," 色彩模式")',
        'return gameuiHost.reportUploadPrecheckFailure("color",i.mode),y.y.error({message:"不支持 ".concat(i.mode," 色彩模式")');
    source = replaceOnce(source, 'return M.$message({message:"请先加入或创建团队"',
        'return gameuiHost.reportUploadPrecheckFailure("team"),M.$message({message:"请先加入或创建团队"');
    source = replaceOnce(source, 'return M.$message({message:"无操作权限，请联系管理员"',
        'return gameuiHost.reportUploadPrecheckFailure("permission"),M.$message({message:"无操作权限，请联系管理员"');
    source = replaceOnce(source, 'return M.$message({message:"请选中要上传的画板"',
        'return gameuiHost.reportUploadPrecheckFailure("boards"),M.$message({message:"请选中要上传的画板"');
    source = replaceOnce(source, 'showPluginErr:function(M,t){this.$refs.pluginErr.showDialog(M,t)}',
        'showPluginErr:function(M,t){gameuiHost.reportUploadPrecheckFailure("server",M);this.$refs.pluginErr.showDialog(M,t)}');
    source = replaceOnce(source, 'return null===(N=M.$refs.errorCatch)||void 0===N||N.dealError(o),t.abrupt("return")',
        'return gameuiHost.reportUploadPrecheckFailure("server","60007"),null===(N=M.$refs.errorCatch)||void 0===N||N.dealError(o),t.abrupt("return")');
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
    // API 2 groups expose a LayerCollection as layers. Keep the original
    // group-bounds fallback for marked groups without a slice guide.
    const frameGuide = 'c=n.children.find((function(M){return"-slice-"===M.name}))';
    source = replaceOnce(source, frameGuide, 'c=Array.from(n.layers??n.children??[]).find((function(M){return"-slice-"===M.name}))');
    const refreshArtboards = 'actions:{refreshArtBoard:function(M){var t=M.commit;return A(this,void 0,void 0,(function(){var M,e;return o(this,(function(i){switch(i.label){case 0:return i.trys.push([0,2,,3]),[4,n.default.getArtboards()];case 1:return(M=i.sent())&&t("refreshArtBoard",M),[3,3];case 2:return e=i.sent(),console.log(e),[3,3];case 3:return[2]}}))}))}}';
    source = replaceOnce(source, refreshArtboards, 'actions:{refreshArtBoard:function(M){return gameuiHost.refreshArtboards(function(){return n.default.getArtboards()},function(boards){M.commit("refreshArtBoard",boards)})}}');
    const artboardNotification = 'D.default.on("LanhuJSBridgeSelectedArtBoardChanged",(function(){console.log("--监听到画板变化--"),M()}))';
    source = replaceOnce(source, artboardNotification, 'D.default.on("LanhuJSBridgeSelectedArtBoardChanged",(function(){if(gameuiHost.canRefreshArtboards())M()}))');
    const queue = 'uploadArtboards:function(){var M=this;HN.Z.setIntervalTime';
    source = replaceOnce(source, queue, 'uploadArtboards:function(){var M=this;try{gameuiHost.checkUploadScope(this.artboardPoolList)}catch(error){this.uploadStatus=this.UploadStatusConfig.fail;gameuiHost.reportUploadAnalysisFailure(error);return}HN.Z.setIntervalTime');
    const queueComplete = '(function(){HN.Z.setIntervalTime("uploadTime"),console.log("------上传总耗时-----:",HN.Z.getIntervalTime("uploadTime")),M.failList.length>0?';
    source = replaceOnce(source, queueComplete, '(function(){HN.Z.setIntervalTime("uploadTime");'
        + 'if(!M.totalCount||new Set(M.successList.concat(M.failList,M.unChangeList).map(function(item){return item.id})).size!==M.totalCount){gameuiHost.reportIncompleteUpload(M);return}M.failList.length>0?');
    const itemComplete = '(null===(i=null==M?void 0:M.artboard)||void 0===i?void 0:i.code)!==u.UploadItemStatusConfig.success||n--';
    source = replaceOnce(source, itemComplete, itemComplete.replace('||n--', '&&(M&&M.artboard&&M.artboard.code)!==u.UploadItemStatusConfig.unChange||n--'));
    const uploadItem = 't.uploadSingleArtboart=function(M,t,e){return';
    source = replaceOnce(source, uploadItem, 't.uploadSingleArtboart=function(M,t,e){gameuiHost.assertUploadAllowed(t);return');
    source = replaceOnce(source, 't.uploadSingleArtboardOss=function(M,e,i){(0,t.uploadSingleArtboart)(M,e,i)}',
        't.uploadSingleArtboardOss=function(M,e,i){return Promise.resolve().then(function(){return(0,t.uploadSingleArtboart)(M,e,i)}).catch(function(){i({type:r.UploadCallBackType.artboard,artboard:{code:r.UploadItemStatusConfig.error,id:M.info.id,name:M.info.name,message:"文件传输失败"}})})}');
    const submit = 'submitLanhu:function(M){var t=this;return';
    source = replaceOnce(source, submit, 'submitLanhu:function(M){var t=this;try{gameuiHost.assertUploadSubmission(t)}catch(error){gameuiHost.reportUploadSubmissionIssue(t,error);return Promise.resolve()}return');
    source = replaceOnce(source, 'case 6:return i.new_image_cnt=e.sent,e.next=9,GN().submitLanhu(i,t.token,t.groupId)',
        'case 6:return i.new_image_cnt=e.sent,gameuiHost.assertUploadSubmission(t),e.next=9,GN().submitLanhu(i,t.token,t.groupId)');
    source = replaceOnce(source, 'A&&A.result&&A.result.length?("forceUpload"!==M',
        'Array.isArray(A&&A.result)&&A.result.length===t.successList.length&&new Set(A.result.map(function(item){return item&&item.id}).filter(Boolean)).size===t.successList.length?("forceUpload"!==M');
    source = replaceOnce(source, '(t.submitFailLogic(M),w.lanhuLogger.setLogPoint',
        '(gameuiHost.reportUploadSubmissionIssue(t),w.lanhuLogger.setLogPoint');
    source = replaceOnce(source, 'case 14:e.prev=14,e.t0=e.catch(2),console.log(e.t0);case 17:case"end":return e.stop()}}),e,null,[[2,14]])',
        'case 14:e.prev=14,e.t0=e.catch(2),gameuiHost.reportUploadSubmissionIssue(t,e.t0);case 17:case"end":return e.stop()}}),e,null,[[2,14]])');
    // A design may already exist if attaching it to a group fails. Keep that result
    // uncertain and let the user inspect it before starting another submission.
    const nativeSubmit = 'case 1:return o.trys.push([1,3,,4]),[4,c.default.uploadToLanhu(M,t)];case 2:return(i=o.sent())&&i.result&&i.result.length&&e&&(N=i.result.map((function(M){return M.id})),c.default.uploadDataToGroup({add_image_ids:N,sector_id:e,project_id:M.project_id},t)),[3,4];case 3:return n=o.sent(),console.log(n),u.lanhuLogger.setLogPoint("sketch_plugin_submit_to_lanhu",{eventId:"sketch_plugin_submit_to_lanhu_fail",eventName:"上传画板数据到主站失败：未知异常"},n),[3,4];case 4:return[2,i]';
    source = replaceOnce(source, nativeSubmit, 'case 1:return o.trys.push([1,4,,5]),[4,c.default.uploadToLanhu(M,t)];'
        + 'case 2:return(i=o.sent())&&Array.isArray(i.result)&&i.result.length&&e?(N=i.result.map(function(item){return item.id}),[4,c.default.uploadDataToGroup({add_image_ids:N,sector_id:e,project_id:M.project_id},t)]):[3,5];'
        + 'case 3:return(r=o.sent())&&(r.code===void 0||["00000","0"].includes(String(r.code)))|| (i=void 0),[3,5];'
        + 'case 4:return n=o.sent(),i=void 0,[3,5];case 5:return[2,i]');
    // API 1 allowed these DOM mutations implicitly. Wrap the public API boundary,
    // leaving recursive formatter calls inside an existing analysis modal synchronous.
    const group = 'return D.sliceWithGroup(M,t),[2]';
    source = replaceOnce(source, group, 'return[2,D.sliceWithGroup(M,t)]');
    const groupSelection = 'console.log("sliceWithGroup",typeof M,typeof t),[4,this.unSlice()];case 1:g.sent(),i=j.app.activeDocument.activeLayers.map((function(M){return{id:M._id,bounds:M.bounds}})),A=0';
    source = replaceOnce(source, groupSelection, 'i=j.app.activeDocument.activeLayers.map((function(M){return{id:M._id,bounds:M.bounds}})),[4,this.unSlice()];case 1:g.sent(),A=0');
    source = replaceOnce(source, '(w=j.app.activeDocument.activeLayers[0]).name="-slice-",',
        '(w=j.app.activeDocument.activeLayers[0]).name="-slice-",gameuiHost.initSliceGuideVisibility(w),');
    source = replaceOnce(source, 'case 15:return x=g.sent(),console.error(x),[3,16];case 16:return[2]',
        'case 15:throw g.sent();case 16:return[2]');
    source = replaceOnce(source, 'case 6:return A=o.sent(),console.error(A),[3,7];case 7:return[2]',
        'case 6:throw o.sent();case 7:return[2]');
    source = replaceOnce(source, 'e.name.startsWith("-h")||', 'e.name.startsWith("-h-")||');
    const sliceBoundary = 't.getSelectArtBoard=function';
    const sliceWrappers = '["sliceWithLayer","sliceWithGroup","unSlice","showSlice","hiddenSlice"].forEach(function(name){var original=t[name];t[name]=function(){var self=this,args=arguments;return gameuiHost.runModal(function(){return original.apply(self,args)},"蓝湖切图")}}),';
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
    source = replaceOnce(source, bootstrap, bootstrap + ',window.VM.$gameuiServices={auth:e(62824),account:e(62909),project:e(78578),scales:e(94878).DeviceScaleDic,sliceScales:e(94878).SelectScaleConfig,uploadErrors:e(94878).ErrMessageDicConfig}');
    // The factory is lazy. Loading this module does not bootstrap Vue, read a session or access the network.
    const runtime = '"use strict";\nmodule.exports = function(gameuiHost) {\n'
        + 'const window=gameuiHost.window,document=gameuiHost.document,localStorage=gameuiHost.localStorage,require=gameuiHost.require,self=window,globalThis=window;\n'
        + 'const setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;\n'
        + 'const btoa=function(value){return window.btoa(value)},atob=function(value){return window.atob(value)},alert=function(){return window.alert.apply(window,arguments)};let crypto=window.crypto;\n'
        + source + '\nreturn window.VM;\n};\n';
    return { runtime, identity: { schemaVersion: 1, officialId: manifest.id, officialVersion: manifest.version,
        officialManifestSha256: sha(manifestBytes), officialIndexSha256: sha(bytes), runtimeSha256: sha(runtime),
        projectId: compatibility.projectId, format: "lazy-scoped-vue-factory", apiVersion: 2,
        seams: ["analysis modal/project guard", "verified PSD selection", "analysis failure handling", "scoped GameUI instance preview", "capture", "finalize", "Home upload project guard", "upload precheck feedback", "await upload route navigation", "upload queue scope check", "uploader project guard", "scoped cloud submission", "cloud and group confirmation", "slice API modal", "slice Rectangle coordinates", "frame slice LayerCollection", "artboard refresh document scope", "slice group selection and promise ownership", "slice visibility", "console preservation", "scoped crypto fallback", "native browser authorization handshake", "disable detached Popper event tracking", "native workspace business adapters"] } };
}

module.exports = { prepareRuntime };
