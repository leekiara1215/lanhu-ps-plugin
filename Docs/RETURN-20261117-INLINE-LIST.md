# 2026-11-17 继续回交：面板内资源列表 0.5.3

本记录接续[异步刷新回交](RETURN-20261117-REFRESH.md)，作为最新候选入口。用户已明确补充：**“整个菜单里唯一可选的一行”**。这确认问题发生在展开后的菜单，而非仅收起栏显示当前选项。旧原生菜单的宿主根因仍未确定；本次在现有协议内改用面板内列表，移除资源选择对该弹出菜单的依赖。新列表已完成离线验证，真实 PS 的可见、可选与滚动验收仍待总控执行。

## 提交与范围

- 仓库：`/Users/betta/Workspace/lanhu_ps_plugin`；分支：`codex/resource-picker-20261117`，沿用同一工作目录，未创建额外 worktree。
- 接手基线：`3858c5bf8b83f75d5bdee1d66359fe169224285d`。
- 最新运行代码提交：`3f689b3b8943505ab902fec38b385b1c0003eebe`；包含先前刷新修复 `21c8f6435007d0329501616407e616d852df08b3`。
- 本次代码提交精确修改：`Panel/index.html`、`Panel/panel.css`、`Panel/panel.js`、`Panel/manifest.json`、`Panel/README.md`、`test-authoring.cjs`。
- 后续文档提交新增本文件，在旧回交顶部加接续说明并更新 `Docs/ACCEPTANCE.md`；完整文档提交 SHA 由最终回复提供。无需复制未提交目录。

资源选择现为固定高度144px、纵向滚动的普通按钮列表。保留 `resources` 控件 ID；第一行“新建公共资源”为明确空引用，其余行逐一对应完整 `assetRef`，同名同版本仍附区分序号。当前行显示“已选”并高亮，下方显示版本数量。内部选择状态和行的 `data-resource-ref` 保存完整引用，不以显示文字、序号或像素匹配绑定。

点击资源行只更新面板选择及继承契约，不写 PSD / XMP / 私有目录，不改变目标宽高；主按钮继续执行创建/引用与应用。忙碌期间所有资源行禁用，完成后恢复；增加逻辑守卫，使已排队的点击也不能在像素应用途中切换引用。列表内容不变时保留现有行，减少刷新对滚动位置/焦点的影响。既有显示名称更新、版本发布、导入、跨文档选择及已绑定实例恢复均沿用完整引用。

参考阅读：[Adobe UXP Known Issues 的 HTML 控件说明](https://developer.adobe.com/photoshop/uxp/2022/uxp/known-issues/)。该资料说明 UXP 原生控件存在特定属性要求，但不构成本次 PS28 菜单问题的确定根因。本次没有用模拟 DOM 结果来宣称原生菜单已经修复。

## 冻结兼容与真实状态

`CONTRACT.md`、所有 `gameui-*.js` 共用模块、上传适配器与安装构建脚本未改。schemaVersion=1、资源版本不可变、持久 doc/artboard/node、authoring.sources/targets、capture/finalize 及测试上传门禁不变。UI 从 `option.value` 改为完整引用的行属性和内部选择状态，不增加本地或云端协议字段。

测试 plugin ID 仍为 `com.bettagames.gameui.authoring.test`；manifest.version=`0.5.3`。本轮没有读取/写入真实私有目录、修改 PSD、安装/加载候选、操作官方插件目录、上传蓝湖、修改 Framework / Unity 或远程 push。0.5.1 的历史实载、增强0.4.4的历史安装记录及0.5.2归档均保留。回滚无需迁移资源目录或PSD格式。

## 实际验证

证据根目录：`/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/ps-plugin`。

- `node --test test-authoring.cjs`：**43 pass / 0 fail**。[完整日志](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/ps-plugin/inline-list-authoring-tests.log)。包括同名完整引用区分、25版本末项点击、空引用新建、选择不写PSD/目录、宽高保持、未变列表复用、主操作忙碌时拒绝切换、跨PSD引用、主按钮回滚、身份和源/目标契约。
- 测试 harness 现在从实际资源行点击回调驱动选择，枚举动态按钮验证禁用/恢复；旧的直接赋值 `resources.value` 不再作为新列表测试入口。新增的渲染节点断言只证明面板内列表结构和选择逻辑，不证明 UXP 的可见面积、滚动、鼠标/键盘可达性。
- `node --check Panel/panel.js`、`node --check test-authoring.cjs`、`git diff --check 3858c5bf8b83f75d5bdee1d66359fe169224285d HEAD`：全部退出码0。[语法与diff日志](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/ps-plugin/inline-list-syntax-diff.log)。
- 此次UI入口变化后重新运行了受影响的authoring完整文件；未改核心/导出/安装事务，未重跑对应全量及Unity。先前0.5.2四项负控仍属于其当时测试版本，原始证据保留，不将历史计数叠加为新版本独立用例。
- 宿主API、真实面板点击、PSD保存重开、云端与Unity：本候选均无新的通过结论。

## 新候选包

从运行代码提交构建新的空 staging，未覆盖0.5.2或旧包。以下 `EVIDENCE` 代指上述证据根目录；再次构建须使用新路径。

```sh
node Panel/build-panel.cjs "$EVIDENCE/candidate-0.5.3/GameUIAuthoring"
python3 -B gameui-delivery.py build --output "$EVIDENCE/gameui-0.5.3-test-panel-inline-list" --release 0.5.3-test-panel-inline-list --panel-staging "$EVIDENCE/candidate-0.5.3/GameUIAuthoring"
```

- [staging manifest](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/ps-plugin/candidate-0.5.3/GameUIAuthoring/manifest.json)：实际版本0.5.3；全新release=`0.5.3-test-panel-inline-list`。
- [ZIP归档](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/ps-plugin/gameui-0.5.3-test-panel-inline-list.zip)：172,341字节，SHA-256=`a8e169ae23c39920157dca45d49b3018f66a2616852502dc86cdc92937bb63c9`。不是CCX。
- [15项文件清单与核对结果](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/ps-plugin/inline-list-package-verification.json)：每项SHA与实际文件一致，ZIP内另含bundle.json，归档路径/字节与目录完全一致；staging八文件逐一与指定commit内容比对通过，三个共用模块原样复制。未带官方二进制、PSD、私有catalog、凭据、安装state或Unity文件。

## 给原总控的最小步骤

1. 审查运行代码 `3f689b3b8943505ab902fec38b385b1c0003eebe` 及最新文档提交，按维护约定显式同步六个源码/测试文件到Framework快照，记录哈希及Framework提交。由总控统一安排候选 Load；开发会话未自行加载。
2. 加载0.5.3后，先确认面板内列表确实显示“新建公共资源”及两条既有同名资源，能够点击两行、显示相应“已选”和继承契约。通过高级区诊断引用核对每行完整ref，不能按“条目2”硬编码First。保存实际画面及点击结果。资源较多时还需确认列表自身能滚至末项；同时保留外层面板顶部/底部滚动检查。若仍不可操作，保留PSD和目录不变，回交画面/候选版本，不开始上传。旧0.5.1截图可补作诊断，不再作为试用新列表的前置阻碍。
3. 在Second layer3显式选择First ref `g-mwkenw8x-bu0gso0npyu@1`，确认目标保持192×96，一次主按钮应用。先一次Undo核对像素/XMP回退，再重新显式选择并应用，正常Cmd+S保存、关闭重开只读核对。First既有180×40保持原验收输入。切层/切文档时核对自身绑定及完整target恢复；编辑宽高时核对不被刷新覆盖。
4. Second应保留 document=`g-mwken3ke-883svpjmzmq`、artboard=`g-mwken3ke-l70ssitfne`、node=`g-mwken6wm-qvf008wypn`，node.assetRef与First相同；source仍64×48原始PNG、Point、L/T/R/B=7/5/11/9，target完整192×96。点击行本身不应修改这些持久值。原合法资源不删除，不按同名合并。
5. PS门槛通过后，总控在限定测试projectId安排蓝湖上传/回取，核对schemaVersion=1、去除authoring/uploadScope、原始1×RGBA源及sourceNodeId/image.url/exportScale=1；透明实例frame/realFrame/nativeReferenceFrame沿原约定。再执行既有Unity workflow的公共Sprite GUID复用、重复稳定性及成本记录，并统一处理官方插件最终恢复。新透明/软边等其它未过门槛仍按原验收单处理。

没有本轮真实安装/PSD/目录写入需要恢复。试用后若回退，Unload0.5.3再Load保留的旧候选，保持同一plugin ID并保留catalog；官方适配器恢复沿原持久state及CLI，由总控安排。本次交付状态是“开发实现和离线检查完成，等待指定提交审查与真实面板验收”，不能称已完成PS→蓝湖→Unity闭环。
