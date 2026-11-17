# 2026-11-17 回交：蓝湖页签与创作页整合候选 0.6.0

最新运行代码提交：`600a8d6f34775a0dd1d2121674ddd28f78f59f7d`。仓库 `/Users/betta/Workspace/lanhu_ps_plugin`，独立分支 `codex/resource-picker-20261117`，在原工作目录接续0.5.3；后续文档提交SHA见最终回复。实现和离线检查完成，**真实PS加载、原版Vue在Shadow中的表现、登录回调、网络上传及Unity闭环均未通过本候选验收**。

用户本轮明确要求：通过REA分析蓝湖工具并整合，新增可切换的蓝湖页签，同时在当前资源创作页整合蓝湖功能。本次依该授权新增可选官方运行时构建输出，没有修改现有官方安装目录，也没有将官方包加入git。

## 已实现

顶部固定“资源创作 / 蓝湖工具”页签；切换不重置名称、资源选择或目标尺寸。蓝湖页加载原版Vue界面与原版事件处理，可进入其登录、团队/项目、画板/设计倍数、上传与切图界面。资源创作页既有真实上传快捷入口，也可内联展开同一个蓝湖挂载节点，直接使用该界面；两处共用会话和项目状态，不重复初始化。内联上传在当前页保留后续进度，普通快捷上传进入蓝湖页。只显示原流程接手，不将Home入口返回当作云端成功。

`Panel/lanhu-host.js` 提供惰性加载、Shadow挂载、限定查询范围的document/window、原生模块转发、脱敏状态、登录/项目检查及并发保护。根据原版上传进度组件的 `UploadStatusConfig/uploadStatus` 持续阻止上传期间的PSD创作写入；路由切换时保守阻止，完成/失败后恢复。销毁/连接失败清理所跟踪的Vue、窗口事件、计时器和PS通知，延迟完成的通知注册会注销。PS回调使用独有包装，不删除父方监听；该隔离不是权限沙箱，不承诺取消已发出的网络请求。

官方UI的上传入口、解析、单项OSS上传和设计提交均有固定测试项目守卫。原版UI/提交使用 `projectId`，解析配置使用 `projectID`，现按字段存在性兼容并严格拒绝冲突。API1隐式修改通过API2公共入口modal适配；补齐切图分组Promise返回，保证modal等待分组结束。capture/finalize仍使用现有共用模块；不改变gameUI schema、身份、源快照、目标几何或版本契约。

## REA与原包来源证据

证据根目录（不入git）：
`/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-rea-integration`。

此前临时下载路径已不存在；从持久state的 `official-index.js` 取得原入口，逐字节核对已冻结SHA，再将安装目录的manifest/html/build-info只读复制到新的分析输入。没有把增强入口当原版。具体路径、4文件大小和哈希见[artifact-identity.json](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-rea-integration/artifact-identity.json)。分析输入在测试后再次核对未变。

REA调用 `analyze_javascript_application`，仅选择上述四文件、summary交付。完整应用Evidence为 `ev_605ee370d24c95f4c851d41bbb1340ddd1888569572ca886daa0d51d16dfeb18`，输入目录摘要 `de4c33e1766f54f2b907e549bc3f65774d12dfb33ebd08e0c08a5e8ab146d89a`。识别744模块，1个JS源语法完整、parse failure=0；语义图受别名、字符串与节点预算限制，属于partial，未执行bootstrap。`$mount`图追踪未匹配不能证明入口不存在；随后直接精读该固定源码的Vue `window.VM/$mount('#app')`、Home.uploadArtboard、formatter模块96262、公共API模块86350、上传器70567及Vuex配置/进度组件，作为编译器的固定位置依据。这些模块ID只适用于已校验原包，不是跨版本稳定标识。

完整5条Evidence已保存到[rea-checkpoint.json](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-rea-integration/rea-checkpoint.json)，之后按skill清理调查内存；没有打开native引擎，也没有运行目标应用。所有发现是静态事实/派生结论，不能当作实际登录或上传观察。UXP接口依据：[Shadow相关变更](https://developer.adobe.com/photoshop/uxp/ps_reference/changelog/)、[跨插件面板通信](https://developer.adobe.com/uxp/guides/how-to/inter-plugin-comm/)、[Manifest权限](https://developer.adobe.com/photoshop/uxp/2022/guides/uxp_guide/uxp-misc/manifest-v5/)。

## 构建与兼容

新 `Panel/build-lanhu-runtime.cjs` 仅接受冻结的manifest/index哈希。运行时在新staging内生成，不在git中保存原版源码/官方二进制。输入增强包或未知同版本字节会在创建staging前拒绝。原安装适配器 `build-audit-patch.py` 的两个seam逻辑保持原样；本次内嵌运行时另有API2、项目守卫、作用域/控制台等固定适配位置，完整清单在生成身份文件中，不能将二者当成同一个安装入口。

基础候选共10文件，没有内置原版Vue；集成候选12文件，增加 `lanhu-runtime.js` / `lanhu-runtime.json`。插件ID保持 `com.bettagames.gameui.authoring.test`，无catalog迁移。源manifest为0.6.0/API2；集成staging额外声明 network.domains=`all`（服务动态返回OSS端点）、http/https打开权限，IPC用于显示已有官方面板。基础构建没有新增网络权限。登录使用本独立插件自己的存储，不读取/复制官方私有会话。

共用 `gameui-core.js`、`gameui-authoring.js`、`gameui-ps.js`、`gameui-export.js`，以及 `CONTRACT.md`、`compatibility.json`、原安装seam脚本均无diff。交付校验增加新Panel依赖、运行时/来源文件配对及身份校验，旧8文件候选仍接受。正式推广、生产项目和CCX不在本次通过范围。

## 实际验证

以下 `OFFICIAL` 是证据目录内的 `official-1.0.32` 新只读分析副本；原安装目录未用于测试写入。实际命令在仓库根运行：

```sh
GAMEUI_OFFICIAL_PLUGIN="$OFFICIAL" GAMEUI_OFFICIAL_INDEX="$OFFICIAL/index.js" node --test --test-timeout=10000 test-authoring.cjs test-lanhu-host.cjs test-lanhu-build.cjs test-official-upload.cjs
GAMEUI_OFFICIAL_PLUGIN="$OFFICIAL" python3 -B test-delivery.py
```

- Node：**61 pass / 0 fail / 0 skip**，包括authoring45、宿主桥10、构建/实际官方模块专项5、既有实际官方上传器harness1。[最终日志](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-rea-integration/node-tests-final.log)。实际官方模块专项覆盖原生uploader错误项目在OSS token前拒绝、公共切图API持有modal直到分组完成、原版crypto fallback在隔离环境无全局crypto时可运行。
- Python：**17 pass / 0 fail**，在临时副本做安装事务、回滚/拒绝等检查，新增集成依赖/身份不全拒绝且插件副本不变。[日志](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-rea-integration/delivery-tests.log)。不将临时测试安装当真实宿主安装。
- Node语法、Python AST、diff、冻结文件检查通过。[检查日志](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-rea-integration/syntax-diff-frozen-checks.log)。未重跑Unity或全量core/export；现有capture/finalize实际官方模块harness网络被stub。
- Node中的DOM/PS是模拟对象，factory及官方选定模块确有执行，但**没有运行完整原版Vue的实际UXP界面，也没有真实网络请求**。PS API1→API2、Shadow的CSS/body/html样式与弹层、登录跳转、全部切图路径及网络生命周期仍是实机门槛。原版body/html选择器不会自动匹配隔离div，基础样式不能代替此验收。

## 完整候选

构建命令（已有路径不覆盖，再构建须改为新路径；`EVIDENCE`代指证据根）：

```sh
node Panel/build-panel.cjs "$EVIDENCE/candidate-0.6.0/GameUIIntegrated" --official-plugin "$EVIDENCE/official-1.0.32"
python3 -B gameui-delivery.py build --output "$EVIDENCE/gameui-0.6.0-test-integrated-tabs" --release 0.6.0-test-integrated-tabs --panel-staging "$EVIDENCE/candidate-0.6.0/GameUIIntegrated"
```

- [staging manifest](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-rea-integration/candidate-0.6.0/GameUIIntegrated/manifest.json)：实际version=0.6.0，release=`0.6.0-test-integrated-tabs`，源码来自 `600a8d6f34775a0dd1d2121674ddd28f78f59f7d`。
- [ZIP](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-rea-integration/gameui-0.6.0-test-integrated-tabs.zip)：4,402,409字节，SHA-256=`5b20050379f96c87c3fb689d9802f4b756c3b17957f83c7381921ea5358ef926`；不是CCX。此可选集成归档包含由原包生成的运行时，没有PSD、用户catalog、凭据、安装state或Unity文件。
- [精确源码改动、19项文件清单及包核对](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-rea-integration/package-verification.json)：每项哈希通过，ZIP另含bundle.json，ZIP路径和字节与目录一致；共用模块/Panel文件与指定源码一致，manifest仅有上述已声明权限差异。生成runtime SHA=`8521b60abfc426ca07af40473d7b0faa70008bf9dc7e1fc23b0cdf9ee9a2d713`。

## 总控最小回交

1. 审查指定源码与文档提交，按维护约定显式同步。除六个Panel界面/构建文件外，还有新 `Panel/lanhu-host.js`、`Panel/build-lanhu-runtime.cjs`，以及交付校验和专项测试；以package-verification的sourceFiles为精确清单，不从未提交目录复制。不要同步生成官方运行时进Framework源码快照，按明确原包输入重新构建候选。
2. 总控统一Unload同ID旧面板后Load本staging；先验证页签、原资源列表全部可见可选、滚动与未提交输入保持。点击蓝湖页“加载蓝湖工具”，确认真实Vue/样式/弹层及登录回调可用，正常登录并只选择限定测试项目。不使用DevTools事件伪造点按；记录控制台错误但不将凭据写入证据。
3. 回创作页展开同一蓝湖界面，核对项目/会话保持、收起/换页不重新登录。先用隔离临时PSD验证普通切图与分组、取消/错误恢复、modal无越界，再验证GameUI两稿主按钮、一次Undo、保存重开和原始源/目标像素。First保持180×40；Second显式引用First完整ref、目标192×96和原doc/artboard/node不变，沿0.5.3回交步骤核对，不按同名合并。
4. 用当前页入口或蓝湖页实际上传测试稿，确认在Home、解析、单项上传及提交阶段错误项目都拒绝；上传进度未完成时创作写入被阻止，结束/失败后恢复。真实网络成功后回取schemaVersion=1，去除authoring/uploadScope，核对原始1×RGBA源、固定assetRef及sourceNodeId/image.url/exportScale=1；透明frame契约不变。
5. 以上通过后由总控执行Unity现有workflow的公共Sprite GUID复用、重复稳定性和成本记录。内嵌候选没有改现有官方0.4.4增强目录；该目录最终恢复仍由总控按原持久state和CLI集中处理。

本轮未操作PS/UDT、未写真实PSD/XMP/catalog、未实装、未远程push。若实机界面/登录不兼容，停止该候选的上传，保留证据；Unload0.6.0再Load保留的0.5.3候选，同ID目录和PSD无迁移。开发实现完成、可供隔离试用与正式覆盖蓝湖功能是不同结论；当前仅前者及离线检查成立。
