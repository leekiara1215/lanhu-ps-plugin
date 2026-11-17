# 2026-11-17 回交：自绘蓝湖工作区、浏览器授权与统一风格

后续用户实机截图确认0.6.4仍有原生控件外观覆盖，已修正并实际加载0.6.5；最新候选、三处样式用户确认和专项证据见[0.6.5控件修正回交](RETURN-20261117-CONTROLS-065.md)。下文0.6.4包与当时门槛保留为历史，不再作为最新候选。

开发仓 `/Users/betta/Workspace/lanhu_ps_plugin`，独立分支 `codex/resource-picker-20261117`。本轮保持冻结协议和共用模块原样，不修改Framework/Unity，不远程push。最新候选为0.6.4，已在UDT实际Load成功；没有执行真实授权、上传、切图或PSD写入。源代码完成与宿主/云端验收分开记账。

## 用户要求与结果

用户确认0.6.1双页签可见，但蓝湖页只有说明和“加载蓝湖工具”。用户进一步澄清需求为按蓝湖习惯自绘组件和功能，并非展示原版页面，因此没有按此前设想仅改成自动展示原版界面。

- 0.6.2直接呈现账号、团队/项目/分组、设计倍数、全部/选中画板、上传进度和切图控件。资源创作页可展开同一个工作区，复用会话和设置。用户已明确回答能看到这些控件；这是用户真实可见确认，不是自动化截图或实际点击验收。
- 0.6.3加入“从浏览器获取授权”、等待状态、取消等待和五分钟独立超时。沿原包的UUID/域名助手和 `plug-bind-account` / `authorizedLogin(connection_id)` 链路获取会话。取消、超时、销毁后的迟到响应不写入登录状态；状态快照不含token、密码和连接ID。浏览器登录/SSO由蓝湖网页处理，真实回调尚未验证。取消等待不等于撤销网页权限。
- 0.6.4将整个插件统一为原版默认浅色样式：白色内容、蓝色头栏、#2878FF主按钮、蓝色下划线页签、细边框表单和分区卡片。资源设置、目标尺寸、蓝湖协作和高级操作均覆盖。原包CSS明确包含白色home-holder/login-page-body、蓝色home-header及主按钮颜色；布局为当前插件自绘，不宣称逐像素复刻。

账号密码登录、浏览器授权、列表读取和上传设置继续使用官方业务适配；原版Vue仍在隐藏Shadow环境中维护既有路由/上传状态机，自绘控件不展示该原版页面。不是完全移除Vue或重写蓝湖服务。自绘验证码、新建云端项目和完整设置菜单尚未接入，官方面板入口保留，不宣称已完整替代蓝湖插件。

## 本地提交与文件

- 自绘组件和业务桥接：`1343048eeaab2efc222b5c323c177a04e769d906`。
- 浏览器授权：`9d7589973acca8ba8f3b072f7070d569cbcb4990`。
- 全局蓝湖风格及最新候选来源：`4a4cf8e3d72baa64913165a18f544482d8988f12`。

运行文件：`Panel/index.html`、`Panel/panel.css`、`Panel/panel.js`、`Panel/lanhu-host.js`、`Panel/build-lanhu-runtime.cjs`、`Panel/manifest.json`、`Panel/README.md`。专项回归：`test-authoring.cjs`、`test-lanhu-host.cjs`、`test-lanhu-build.cjs`。本回交及ACCEPTANCE追加事实另作本地文档提交，运行包严格来自上列0.6.4来源。

相对基线 `3858c5bf8b83f75d5bdee1d66359fe169224285d`，`Docs/CONTRACT.md`、`gameui-core.js`、`gameui-ps.js`、`gameui-authoring.js`、`gameui-export.js`、`compatibility.json` 逐字节不变。schemaVersion=1、持久身份、资源版本不可变、authoring.sources/targets、capture/finalize、1×RGBA源图与测试项目限制不变。plugin ID不改，沿用原私有目录。

原版输入仍是已核对的 `lanhu-rea-integration/official-1.0.32`，没有使用实装增强入口或改官方目录。生成器新增受控业务桥接/浏览器握手；切图显示/隐藏委托补齐Promise返回，避免API2操作尚未结束即解锁。原版哈希门禁与全部旧上传保护保留。

## 实际验证及边界

证据根目录：`/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96`。

0.6.3运行逻辑验证命令：

```sh
GAMEUI_OFFICIAL_PLUGIN=<证据根>/lanhu-rea-integration/official-1.0.32 \
GAMEUI_OFFICIAL_INDEX=<证据根>/lanhu-rea-integration/official-1.0.32/index.js \
node --test --test-timeout=10000 test-authoring.cjs test-lanhu-host.cjs test-lanhu-build.cjs test-official-upload.cjs
```

结果73/73通过，0失败/跳过。[日志](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-browser-0.6.3/node-tests.log)。包括原生控件共享/密码清空、错项目拒绝、设计范围和进度锁、授权成功/取消/销毁/超时/迟到响应、实际生成的原版桥接与API2 Promise、原版上传器网络stub。此为离线harness/原版片段证据，不能当作真实服务或宿主点击通过。

0.6.4仅HTML/CSS/版本和说明变化，业务JS及生成运行时与0.6.3相同；定点命令：

```sh
node --test --test-name-pattern='tool tabs|native Lanhu|native browser|panel staging|primary action failure|inline resource rows' test-authoring.cjs
git diff --check
```

结果7/7通过，0失败/跳过。[定点日志](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-theme-0.6.4/targeted-tests.log)。HTML标签平衡、87个控件ID唯一；语法/diff检查通过。没有为纯主题再跑完整上传/交付/Unity套件。73和7是不同范围，不能机械相加为一次80项全量。

首次回归发现此前中文化后的身份错误测试仍匹配英文，改为检查中文提示并单独检查原始诊断；原先移动原版挂载的测试更新为移动自绘工作区。浏览器定时测试修正mock未移除已触发timeout的模拟差异，最终上述用例通过。没有放松协议校验。

## 最新候选与完整性

实际manifest.version=`0.6.4`，release=`0.6.4-test-lanhu-theme`，来源commit=`4a4cf8e3d72baa64913165a18f544482d8988f12`。

- [UDT manifest](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-theme-0.6.4/GameUIIntegrated/manifest.json)。基础相同ID，PS API2，集成候选网络/外部浏览器权限沿0.6版本不扩展。
- [交付ZIP](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-theme-0.6.4/gameui-0.6.4-test-lanhu-theme.zip)，SHA-256=`ed863bbe971b4d123487ef27501379dd18cefb36e0e76e4b4116f1511a28e481`。
- [全部19项文件哈希、ZIP/目录逐字节核对](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-theme-0.6.4/package-verification.json)。Panel自包含12文件。ZIP仍为交付归档，不是CCX。
- [宿主加载和两稿磁盘哈希](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-theme-0.6.4/host-load-064-evidence.json)。

构建入口仍为 `node Panel/build-panel.cjs <新staging> --official-plugin <白名单原版>` 和 `python3 -B gameui-delivery.py build --output <新输出> --release 0.6.4-test-lanhu-theme --panel-staging <新staging>`。旧0.6.1/0.6.2/0.6.3候选与ZIP保留，没有同release换内容。

## 真实宿主状态与最小回交

已依用户授权先后UDT加载0.6.1/0.6.2/0.6.3/0.6.4；最新可见UDT状态为0.6.4 `Loaded / Plugin Load Successful`。替换时Unload、移除工作区旧路径注册、Add新manifest再Load，没有删除旧候选文件或改变官方实装目录。恢复可Unload最新候选并重新Add保留的旧manifest，plugin ID及目录不变。0.6.1双页签、0.6.2自绘组件已获用户实际可见确认；0.6.3授权按钮与0.6.4全局视觉/滚动仍需实际验收，不能从UDT Loaded外推全部通过。

CUA仍无法捕获/点击PS UXP浮层，没有通过DevTools eval/DOM事件代替点击。没有执行登录或授权、上传、切图、应用、保存；两份既有PSD磁盘SHA与0.6.1只读基线一致。0.6.3和0.6.4加载记录及包完整性已分别保存，不把用户确认误记为自动化点击证据。

交原集成对话的最小步骤：

1. 审查上述三个完整源码提交并按维护流程显式同步Framework快照；不要从未提交工作区复制。确认UDT当前0.6.4路径与版本。
2. 先只读检查两页蓝白样式、资源列表和整体视口可滚到顶部/底部，确认“从浏览器获取授权”在蓝湖页和资源页内联区使用同一状态。点击授权后在网页正常登录/授权，返回插件确认账号、团队/项目读取；取消/超时可重试。此步骤不上传、不切图、不修改PSD。
3. 按原交接完成Second显式引用First完整assetRef，保持Second 192×96及原doc/artboard/node身份，一次主按钮/Undo与正常保存重开后核对XMP/像素。不要按同名或像素相同合并已有资源。
4. 由原集成对话向固定测试项目真实上传，回取gameUI schemaVersion=1、sourceNodeId/image与1×RGBA源PNG，确认无authoring/base64/uploadScope泄漏；再执行Unity公共Sprite GUID复用及重复稳定性检查。未执行这些步骤前，不宣称PS→蓝湖→Unity通过。

真实浏览器授权、切图API2、原版隐藏后端/自绘控件交互和新两稿云端闭环仍是待验收项。正式CCX分发、生产迁移及官方插件最终恢复继续由原集成负责人安排。
