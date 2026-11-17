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
