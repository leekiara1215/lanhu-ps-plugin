# 隔离试用验收快照

日期：2026-11-17。独立仓已建立为开发源；当前 Framework 集成来源为 `e75e5263a309f91da13e80f6ca4795cefba942a8`。
状态：已有实际 PS 面板、落盘重开和适配器生命周期证据，**新面板两稿的云端到 Unity 闭环与正式推广仍未通过**。
本页区分历史迁移与后续主流程集成；0.5.0虽Loaded但初始化失败，0.5.1修复后已真实显示目录；未重跑Unity。

主证据目录为 [/Users/betta/.codex/visualizations/2026/11/17/01a1e7c5-ba46-7533-bcc1-580af0395c6a/lanhu-production](/Users/betta/.codex/visualizations/2026/11/17/01a1e7c5-ba46-7533-bcc1-580af0395c6a/lanhu-production)。
集成总账与历史范围见 [Framework RESULTS.md](/Users/betta/Worktrees/meatloaf_client-feat-lanhu_ui_skill-422718cc/client/Assets/BettaFramework/Scripts/Editor/UI/LanhuDesign/Docs~/Productionization/RESULTS.md)。
本页下面的资源保存/重开证据是比早期“仅初始化、资源为空”记录更晚的观察，不能把不同阶段的状态混为一个结论。

## 0.5.1 主流程接续

主按钮实现已集成插件 `4034d1f` 与 Framework `b8ddb3e`；定点 10/10 通过，新候选在 UDT 实际 Loaded / Plugin Load Successful。默认自动初始化、明确新建/引用并应用，常用操作一次按钮后正常 Cmd+S；原维修等入口在高级操作。真实主按钮与跨稿同 ref 尚待点按和落盘核验，历史两个 ref 不自动合并。完整来源、包哈希与测试见 [集成记录](SYNC-20261117-PRIMARY.md)。当前上传适配器仍为已观察的增强 0.4.4，最终恢复未执行。

0.5.0声明plugin.destroy时缺必需create，真实控制台在panel.js:413拒绝，目录初始化未执行。A13a091b→插件e0d1746→Framework e8f7808已最小修复，生命周期定点4/4通过；0.5.1实际Load成功后只读Elements确认Second layer3、Point继承和条目2完整ref均呈现。用户点击/同ref保存仍待，详见[同步记录](SYNC-20261117-PRIMARY.md)。

## 已观察的面板与保存行为

- UDT 2.4.0.2、Photoshop 28.0.0、UXP 9.4.1。宿主 Developer Mode 从关闭到启用并重启后，同一 0.4.2 包 Load 成功，无代码变化；
  已观察旧候选 Unload 和后续 Load。[加载事件](/Users/betta/.codex/visualizations/2026/11/17/01a1e7c5-ba46-7533-bcc1-580af0395c6a/lanhu-production/ps-panel-load-events.json)
- 0.4.4 面板 Loaded；用户实际确认“能滚动，顶部和底部均可见”。这只通过所述视口的显示与滚动，
  不代表每个按钮和所有窗口尺寸均验收。[滚动证据](/Users/betta/.codex/visualizations/2026/11/17/01a1e7c5-ba46-7533-bcc1-580af0395c6a/lanhu-production/panel-scroll-acceptance.json)
- 两份合成 PSD 经真实面板定义/应用、正常保存后只读提取，均登记一份 64×48 非对称 Point 源，L7/T5/R11/B9。
  目标分别为 First 180×40、Second 192×96。源 PNG 解码 RGBA 与独立原材料均零通道差异。
  documentId/artboardId/nodeId 均不同，**assetRef 也不同，crossPsdReusePassed=false**；这没有证明两稿引用了同一资源。
  [落盘资源证据](/Users/betta/.codex/visualizations/2026/11/17/01a1e7c5-ba46-7533-bcc1-580af0395c6a/lanhu-production/panel-resource-save-acceptance.json)
- 正常重开后 XMP 与保存值一致；两份实际 Point 目标像素与独立整数九宫参考均为 0 差异。
  该结论只覆盖上述两个非对称 Point 目标，不能外推为新透明/软边实例的 UI 验收。
  [目标像素与重开比较](/Users/betta/.codex/visualizations/2026/11/17/01a1e7c5-ba46-7533-bcc1-580af0395c6a/lanhu-production/panel-point-native-pixel-comparison.json)

## 已观察的宿主与安装行为

负责人在每次操作前实际关闭 PS 并核对宿主进程不存在，完成 install 0.4.3、upgrade 0.4.4、uninstall、rollback 到 0.4.4，
每次重新启动看到 PS 主窗；卸载时官方入口 SHA 恢复且三份增强模块不存在。
[实装生命周期](/Users/betta/.codex/visualizations/2026/11/17/01a1e7c5-ba46-7533-bcc1-580af0395c6a/lanhu-production/host-adapter-lifecycle.json)
记录末态是隔离测试增强 0.4.4，并非已清理为原版；后续实际状态须由负责人另记。
这证明文件事务和宿主启动，不证明新上传运行时成功。当前增强目录不能作为 `GAMEUI_OFFICIAL_PLUGIN` 的白名单原版输入。

<a id="materials"></a>

## 材料与像素证据

两份合成 PSD 已在实际 PS 创建并保存，sRGB/8-bit，各 12 输入材料层。[创建报告](/Users/betta/.codex/visualizations/2026/11/17/01a1e7c5-ba46-7533-bcc1-580af0395c6a/lanhu-production/synthetic-fixtures/production-fixture-ps-result.json)
初轮硬边、透明外沿、软边共六份 64×48 源 PNG 与独立 RGBA 均零差异；透明/软边源使用显式四边留白 2px。
[源像素比较](/Users/betta/.codex/visualizations/2026/11/17/01a1e7c5-ba46-7533-bcc1-580af0395c6a/lanhu-production/synthetic-fixtures/host-source-pixel-comparison.json)

之后在两份原 PSD 的临时副本实际应用透明 128×80 目标，PS 内容 bounds 为 124×76，恢复画布原点为 312,32；
副本关闭且不保存，原 PSD 不变。[透明目标宿主证据](/Users/betta/.codex/visualizations/2026/11/17/01a1e7c5-ba46-7533-bcc1-580af0395c6a/lanhu-production/ps-target-host-summary.json)
这是宿主 API 采集/应用检查，不替代面板点击后保存重开。

## 已有离线与 Unity 记录的边界

历史集成 Node 51/51、Python 临时原版包生命周期 16/16，以及 Unity 83 个独立用例的通过证据见主 RESULTS；本次不重跑这些门禁。
官方 uploader harness 保留原始上传算法但 stub 网络，不能当作真实云上传。既有 Unity 跨模块 workflow 使用旧基线真实云源，
虽已有两模块复用及 fresh workflow 资源变化 0 的证据，也不能当作新面板两稿的闭环。
[跨模块旧源证据](/Users/betta/.codex/visualizations/2026/11/17/01a1e7c5-ba46-7533-bcc1-580af0395c6a/lanhu-production/actual-cross-module-reuse.json)

<a id="remaining"></a>

## 尚未通过的门槛

- 两稿通过同一目录显式引用相同 assetRef；改名、移动、受控复制与跨 PSD 引用的完整实际面板验收。已保存的同名资源目前是两个身份，不按名字或像素自动合并。
- 新透明/软边素材通过面板生成全部目标、保存重开；临时副本 host-smoke 不替代该项。
- 新面板两稿真实蓝湖上传、云端字段/源 PNG 回读，以及该输入下实际 Unity Prefab 与渲染检查。
- 真实美术、Canvas 合批/性能、移动设备压缩/颜色空间；Bilinear 需对齐采样、alpha、背景与颜色空间。
- 正式 CCX 分发与最终恢复原版状态。未过上述门槛前不称生产推广完成，也不执行生产迁移。

迁移的定点测试、文件哈希与文档差异见 [MIGRATION.md](MIGRATION.md)；冻结 [CONTRACT.md](CONTRACT.md) 保持原样。

当前0.5.1仍有未解可见列表问题：用户明确确认“展开后也只有条目1”；只读真实Elements内却有新建空值、条目1与条目2完整ref。CUA截图仍不包含UXP浮层，停止重复捕获；不能把DOM存在选项宣称为可见列表/跨稿引用通过。待用户提供展开列表的可见截图或其它可定位的新证据后继续，期间不应用、不改目录/PSD、不按名称猜绑。

## 独立开发的未加载候选 0.5.2

2026-11-17：独立分支运行代码提交 `21c8f6435007d0329501616407e616d852df08b3` 修复 XMP 异步刷新期间旧选层结果/默认值覆盖当前选择或编辑的问题。旧 runtime 加最终回归用例负控4项均失败，修复后 authoring 41/41通过；没有宿主加载、PSD写入、蓝湖上传或Unity验证。全新release为 `0.5.2-test-panel-refresh`，staging manifest.version=0.5.2，完整包哈希、文件清单、证据和最小回交步骤见[独立开发回交](RETURN-20261117-REFRESH.md)。

资源菜单的真实可见性问题仍未定位、未关闭；不能将上述独立刷新缺陷当作其确定根因。现有0.5.1实际加载记录和增强0.4.4历史状态未被本候选替换，待总控统一审查、同步及安排宿主试用。

## 最新未加载候选 0.5.3：面板内资源列表

用户补充确认“整个菜单里唯一可选的一行”。运行代码提交 `3f689b3b8943505ab902fec38b385b1c0003eebe` 将资源选择改为面板内可滚动按钮列表，明确空引用新建、同名版本区分、已选标记与版本数，沿用完整assetRef和冻结数据协议。旧原生弹出菜单的确定根因仍未知；新列表真实可见/可选/滚动尚待总控验收，不能用DOM测试宣称通过。

最新authoring为43/43通过，语法/diff及15项包清单核对通过；release=`0.5.3-test-panel-inline-list`，manifest.version=0.5.3，仍未加载/安装，也未写真实PSD或目录。指定commit、完整包哈希、测试证据与最小PS→蓝湖→Unity回交步骤见[最新列表回交](RETURN-20261117-INLINE-LIST.md)。0.5.2包和历史结果保留。

## 最新未加载候选 0.6.0：蓝湖页签与同页整合

按用户新增要求，经REA静态分析固定原包，源码提交 `600a8d6f34775a0dd1d2121674ddd28f78f59f7d` 增加资源创作/蓝湖工具页签、创作页内联同一原版Vue界面及实际上传入口，并提供白名单原版输入的独立构建模式。固定测试项目、API2 modal、作用域与生命周期保护已离线验证；冻结gameUI及共用模块不变，实装官方目录未改。

Node61/61、Python17/17、语法/diff及19项包清单通过。release=`0.6.0-test-integrated-tabs`，实际manifest0.6.0。完整REA Evidence/局限、源码和包哈希、权限及最小回交步骤见[蓝湖页签回交](RETURN-20261117-LANHU-TABS.md)。本候选没有真实PS/UDT、Vue/Shadow样式与登录、网络上传或Unity通过证据，不将其称为完整替代蓝湖插件验收通过。

## 0.6.1中文提示与当前旧界面确认

用户反馈看不到蓝湖内容后，只读真实UDT Elements仍呈现旧原生select资源结构，无0.6页签，准确加载manifest版本未取得；本会话此前没有将新候选加载进PS。源码 `1963d7fef266237b47209be5d58acefc97242eac` 加入明确中文名称/0.6.1版本标识和中文操作错误，原始诊断保留高级区；定点8/8通过。新release=`0.6.1-test-integrated-cn`，蓝湖运行时未变，仍未实载。实际manifest、包哈希和最小改载步骤见[0.6.1接续记录](RETURN-20261117-CN-061.md)。

## 接续实载0.6.1至0.6.4：自绘蓝湖、浏览器授权与全局风格

上述“未实载”为当时历史；后续用户明确授权本对话直接UDT加载，依次完成0.6.1/0.6.2/0.6.3/0.6.4，最新实际状态0.6.4 Loaded / Plugin Load Successful。用户已确认0.6.1双页签及0.6.2账号/团队项目/设计倍数/画板等自绘控件可见。原先说明+加载按钮不是蓝湖运行错误的证据；按用户澄清改为原生自绘工作区，后台沿官方受保护业务链路。

源码提交依次为 `1343048eeaab2efc222b5c323c177a04e769d906`、`9d7589973acca8ba8f3b072f7070d569cbcb4990`、`4a4cf8e3d72baa64913165a18f544482d8988f12`。0.6.3新增浏览器授权、取消/超时与迟到响应保护，相关离线73/73通过；0.6.4统一整个插件蓝白风格、定点7/7通过，业务运行时与0.6.3一致，不机械合计为一次80项全量。冻结协议/共用模块未变，官方目录未改，未登录/授权/上传/切图/写PSD，两稿磁盘哈希不变。

最新release=`0.6.4-test-lanhu-theme`；实际授权回调、0.6.4视觉/滚动/点击以及新两稿PS→蓝湖→Unity仍待原集成对话验收。完整源码/候选、哈希、专项日志、真实证据边界及最小回交步骤见[自绘蓝湖回交](RETURN-20261117-NATIVE-LANHU.md)。
