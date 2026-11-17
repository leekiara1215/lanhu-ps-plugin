# PS 插件独立开发：需求、协议与回交约定

交接日期：2026-11-17。治理版本：2026-08-31.2，PV2-DEC-0035。

本文件供新的 Codex 在独立插件仓开发，完成后交回原集成对话验证 PS → 蓝湖 → Unity 全链路。它汇总已有要求，不变更 [冻结契约](CONTRACT.md)。协议细节以该契约及现有校验器为准；不能通过修改校验器让不兼容数据“通过”。

## 1. 工作入口和职责

- 唯一插件开发源：`/Users/betta/Workspace/lanhu_ps_plugin`。接手基线提交：`37a9f3494e50295389aaee15ea30168b031ad8ec`，运行代码包含生命周期修复 `e0d1746`。
- 新 Codex 负责独立仓内 PS 面板、创作逻辑、上传适配器、安装交付及相关专项测试。旧 A/B 文件分工是历史，不将新负责人限制为原 A 的五个文件。允许在现有协议内改善 UI 和内部实现。
- 原集成对话负责指定提交审查、显式同步 Framework 快照、正式候选加载安排、蓝湖真实上传/回取和 Unity 验证。新会话不要自行修改 Framework 或操作 Unity。
- Framework 集成快照在 `/Users/betta/Worktrees/meatloaf_client-feat-lanhu_ui_skill-422718cc/client/Assets/BettaFramework/Scripts/Editor/UI/LanhuDesign/Tools~/Photoshop`。交接时主仓 `3cc8d10437fba4ac156b1cfe6cde6d28c37efa5e`，Framework `cc40ba5f234c8ff28729ef3553f73348c7cdf527`。
- 后续新会话独立开发期间，原总控不继续写插件 runtime 或并行安排宿主加载；回交后再统一集成。不要同时发展两份 runtime。
- 先检查本地 HEAD/status，保留他人的编辑；使用专属分支或 worktree，及时本地提交。远程 push、生产迁移和正式推广仍须最后审批。

优先阅读：[面板说明](../Panel/README.md)、[冻结契约](CONTRACT.md)、[维护与同步](MAINTENANCE.md)、[交付与回滚](../DELIVERY.md)、[当前验收](ACCEPTANCE.md)、[最近集成与问题记录](SYNC-20261117-PRIMARY.md)。

## 2. 产品目标与最小操作

目标：美术在 PS 中使用小尺寸公共源图搭建不同尺寸的真实界面实例，工具保存原始源图、身份、九宫与采样信息。经蓝湖传递后，Unity 可以恢复布局并让跨界面实例引用同一公共 Sprite。

日常主流程必须尽量少操作：

1. 打开 PSD，选择一个普通像素层。
2. 选择“新建公共资源”或明确选择已有资源版本。新建时配置一次名称、九宫、采样、必要源透明留白；引用时自动继承。
3. 填目标画布宽高，点击一个主按钮，完成自动初始化 + 新建/引用 + 应用目标像素。
4. 正常 Cmd+S 保存 PSD。工具不暗中保存到磁盘。

不要求每次另外初始化、定义、引用或预览；不要求手存小源图、手填 ID/版本或在稿内摆源样本。预览可选。诊断、分步操作、名称更新、发布版本、复制、身份修复、文档 fork、目录导入导出放在高级区。

选择器空值明确表示新建，不能自动猜第一项。已明确选择/创建的资源可延续到下一未绑定实例；切回已绑定实例应显示它自己的持久引用和完整目标尺寸。切换文档/图层自动刷新，同一选层输入不能被异步刷新覆盖。需要有限视口纵向滚动、紧凑布局和可换行提示；实际列表可见性、可选择性必须验收，DOM 存在不等于可操作。

## 3. 冻结身份与版本协议

- `schemaVersion=1`。`documentId`、`artboardId`、`nodeId` 为持久身份，不能由名称、位置或像素哈希重算。
- 本地 `nodes` 的键是 Photoshop layer ID 的字符串；值包含持久 `nodeId` 和资源引用。`assets` 的键是完整 `assetRef`。
- 面板管理的 `assetRef = assetKey + "@" + version`。assetKey 自动生成，version 为正整数；新建为 1，新版本取该资源目录中已有最高版本 + 1。
- 资源级信息是源像素、sourceSize、nineSlice、sampling；实例只能引用并继承，不允许在实例上覆盖这些字段。
- 同一 assetRef 的源像素、源尺寸、border、sampling 及其它资源契约字段不可变；变更必须发布新版本，旧版本保留。仅显示名称可更新，不重采样源、不改身份/版本。
- `displayName` 不是复用键。新建同名资源应拒绝并提示显式引用；已有或导入的同名同版本条目必须可区分，其选项值仍是完整 assetRef。序号不参与身份。
- 复制实例须新 nodeId、同 assetRef；受控复制和文档 fork 须同步重键 target。改名/移动/正常保存重开保持身份。
- 任意原生复制不能可靠确定来源时不猜绑，提供显式引用/身份修复。PSD 原生另存或复制应明确为副本分配新文档身份；原稿关闭时无法自动辨认副本来源，必须如实说明限制。
- 未知可选字段保留；未知 schema、authoring 版本或必需 capability 拒绝。已知能力为 `nineSlice.v1`、`sampling.v1`；显式 sampling 要求根 requiredCapabilities 含 sampling.v1，旧数据缺省采样为 Bilinear。

## 4. 本地 PSD / 目录协议

PSD 使用 Photoshop XMP 自定义命名空间 `https://bettagames.com/ns/gameUI/1.0/`，属性名 `metadata`，属性内容是 JSON 字符串。写后立即回读；正常保存 PSD 后持久化。该机制属于 Photoshop，不是蓝湖原生公共资源库。

以下为结构示例，ID 是示意值，`pngBase64` 必须替换为实际源 PNG，不能将此示例作为有效测试资源：

```json
{
  "schemaVersion": 1,
  "documentId": "g-document",
  "artboardId": "g-artboard",
  "requiredCapabilities": ["nineSlice.v1", "sampling.v1"],
  "nodes": {
    "3": {
      "nodeId": "g-instance",
      "kind": "image",
      "assetRef": "g-resource@1",
      "renderMode": "nineSlice",
      "nativeImageUsage": "validationReference"
    }
  },
  "assets": {
    "g-resource@1": {
      "assetKey": "g-resource",
      "version": 1,
      "displayName": "蓝色按钮",
      "sourceSize": {"width": 64, "height": 48},
      "nineSlice": {
        "left": 7, "top": 5, "right": 11, "bottom": 9,
        "unit": "sourcePixel", "center": "stretch"
      },
      "sampling": {"filterMode": "Point"}
    }
  },
  "authoring": {
    "version": 1,
    "sources": {
      "g-resource@1": {"width": 64, "height": 48, "pngBase64": "<实际源PNG的base64>"}
    },
    "targets": {
      "g-instance": {
        "width": 192, "height": 96,
        "insetLeft": 0, "insetTop": 0,
        "contentWidth": 192, "contentHeight": 96
      }
    }
  },
  "uploadScope": {
    "version": 1,
    "projectId": "cfea1199-7c07-48d9-86ef-cdbd3385c237",
    "purpose": "gameui-productionization-test"
  }
}
```

具体要求：

- `authoring.sources[assetRef]` 保存未经拉伸的 1× 8-bit RGBA PNG，尺寸与 sourceSize/PNG IHDR 完全一致；后续拉伸仍从该快照生成，不能从效果图反推。
- 九宫 L/T/R/B 为源像素非负整数，左右之和小于源宽、上下之和小于源高，必须留出中心；unit=sourcePixel，center=stretch。目标画布须满足现有九宫最小尺寸约束，不引入 tile 模式。
- 源透明外沿通过显式 padding 补齐，默认 0 按非空 bounds 捕获，不猜原图画布；padding 与九宫边框是两个概念。
- `authoring.targets[nodeId]` 是完整实例画布及非空内容范围。所有字段为安全整数，尺寸/内容尺寸严格正值，inset 非负，内容落在完整画布内，只能绑定 image 节点。
- PS 会裁掉透明外沿，不能要求非空 bounds 等于完整目标尺寸。应用后核对真实内容 bbox；上传按当前内容原点减 inset 恢复完整 frame，移动后仍正确。原生缩放使 target 过期时必须拒绝并要求重新应用，不能猜修复。
- 私有目录文件为 `gameui-resource-catalog.json`，使用现有 metadata envelope 携带 assets 与 authoring.sources；导出时 nodes 为空、不携带实例 targets，去掉资产上的 sourceLayerId/sourceNodeId/image 传输定位字段。导入只合并目录，显式引用只将选定资源加入 PSD，不能把整个目录灌入 PSD。
- 同机目录自动继承，跨机器可导出/导入；PSD 自带源快照。不要随意更换测试 plugin ID，否则私有目录路径会变化；如需变化必须提供明确的目录迁移/恢复方式。

## 5. 蓝湖上传交接协议

保留 `capture(payload, config, documentId, formatter)` 与 `finalize(payload, config)` 接口，不另造不兼容上传协议。

1. 官方 formatter 生成原生 artboard/layers 数据后，capture 读取 XMP、验证身份和契约，把公共元数据放入根 `payload.gameUI`，画板放 `artboard.gameUI.artboardId`，实例标记放对应 `layer.gameUI`。依原生 id/originID 对应 PSD layer ID，不能按名字配对。
2. 有本地源快照时，为资源在上传 payload 中注入确定身份的 `resourceSource` 叶节点，设置 `image.bitmap` 与 `gameUISourceExportScale=1`。不要求向 PSD 增加可见源样本层；同一资源版本不能有多个冲突源。
3. 沿用官方递归图片上传和 URL 回填，finalize 在图片上传后、设计 JSON 提交前检查源图上传完成，再填写 `gameUI.assets[assetRef].sourceNodeId` 和 `image={url,exportScale:1,width,height}`。
4. 云端仍是 gameUI schemaVersion=1。必须删除根 gameUI 的本地 `authoring` 与 `uploadScope`，不上传 base64 快照或私有目录。源 PNG 作为普通图片走官方上传。
5. 实例原生效果图保留为 validationReference；Unity 用声明的原始源资源构建实际 Sprite，不把每个拉伸效果图当独立公共资源。根 nodes 的 PSD layer ID 映射不是 Unity 的复用身份。
6. 透明实例恢复完整 frame/realFrame，原生裁剪矩形放在实例可选 `gameUI.nativeReferenceFrame`。不要把本地 target 改造成新云端协议。
7. 当前只允许测试 projectId `cfea1199-7c07-48d9-86ef-cdbd3385c237`，目的为 gameui-productionization-test；错误项目/冲突配置拒绝。无标记旧稿沿官方行为；坏 GameUI XMP 不得降级为无标记绕过。

这是对已审计蓝湖官方插件两个内部位置的受保护适配，不是蓝湖公开承诺的游戏 UI 扩展 API。蓝湖提供原生设计结构、图片上传/URL 与云端设计数据存取；资源身份、九宫、采样、版本不可变规则和 Unity GUID 复用由本工具实现。自定义字段随云端回取的行为须真实验证，不能仅凭本地 JSON 宣称通过。

## 6. 宿主、像素与失败处理

- 独立 Panel：manifestVersion=5、测试 ID `com.bettagames.gameui.authoring.test`、Photoshop >=25、API 2。实测环境为 PS28.0.0 / UXP9.4.1 / UDT2.4.0.2，不能外推所有版本通过。
- 官方蓝湖适配包：只白名单 `com.lanhu.ps` 1.0.32(303)、manifestVersion=4、API 1；manifest SHA `5d5cd21a66772664ee00cbcc8dc7d31b920e74892d84287826e4f9059285680b`，入口 SHA `067760dc58d167e413f60a8d45dc61e97ce670ba3b4564e2b68ef3d9fd594194`。未知包即使版本号相同也拒绝，不删除哈希门禁。
- PS 版本要求、官方插件包校验、自有 release、GameUI schema/资源版本各自独立。源码 manifest 的历史版本字符串不等于实际加载候选版本；每次交付写明 staging manifest.version、release、来源 commit 和包哈希。
- 仅支持已为 sRGB IEC61966-2.1 的 8-bit RGB 文档、普通非背景像素叶子、整数边界；层及父层可见且符合现有 opacity/fill/blend 约束。不隐式转换颜色、不自动栅格化破坏原稿。蒙版、样式、剪贴、调整层、智能对象、文字、形状、画板等沿现有明确拒绝范围。
- 源采集要求 level=0、RGB(A)、8-bit、applyAlpha=false，保留透明 RGB；不使用只输出 JPEG 的 encodeImageData 冒充无损 PNG。Panel 当前源/预览上限 4,194,304 像素，目录读取器接受本面板的确定性 PNG；上传解码器有独立 8192 单维/64MiB 等校验，不能混用两个上限或放松检查。
- Point 在约定整数像素条件下做独立精确比较；Bilinear 须对齐颜色空间、alpha、背景、采样模型，不能以 Point 参考要求零差异。
- 主按钮的 PSD 像素和 XMP 在一次 modal history 中变更，失败请求回滚，正常操作一次 Undo 应恢复。目录先存源再写 XMP；后续失败可保留合法未使用目录项，不能误称跨文件完全原子事务，也不能删除这些项或覆盖外部更新。
- 原错误 cause/错误码与可操作恢复提示保留；目录损坏不静默重置，坏 XMP 用 GAMEUI_METADATA_INVALID 等明确阻止。写后回读不等于断电原子性。
- `uxp.entrypoints.setup` 声明 plugin 对象时必须定义 create；destroy 解绑监听。不要重引入0.5.0缺create的启动缺陷。select/open/close 通知只在身份变化时刷新，避免忙碌重入和覆盖输入。
- 不新增复杂文字渐变、字体材质/渲染系统或大型图集系统。Point 仍可独立纹理，Draw Call 成本交集成验证记录。

## 7. 交接时的事实与优先问题

当前候选为 0.5.1-test-panel，已实际 UDT Load 并只读确认初始化执行。0.5.0 缺 plugin.create 的真实启动错误已修复；主流程受影响10项、后续生命周期/启动/通知4项分别取得通过记录，不机械相加为一次全量。

首要未解问题：用户明确反馈“展开使用资源列表后也只有条目1”；真实 UDT Elements 却有“新建”空值、条目1与条目2完整值。只读复核未找到确定源码根因。不要宣称目录已丢失、自动过滤，或把 overflow/异步刷新理论风险当定论；先取得完整展开菜单的实际画面/可定位证据。CUA当前只能捕获PS主窗、不能看到UXP浮层；不要重复无变化点击，也不通过DevTools eval/DOM事件代替面板操作。

两份合成稿已通过旧面板Point资源定义、正常保存重开及源/目标像素检查：

- First：source64×48，target180×40，ref `g-mwkenw8x-bu0gso0npyu@1`；document `g-mwkcznt6-qhzs2l8nfcf`，artboard `g-mwkcznt6-fcsgjtx301`，node `g-mwkenw92-9llvuurabis`。
- Second：source64×48，target192×96，ref `g-mwken6w2-v3crcmridx@1`；document `g-mwken3ke-883svpjmzmq`，artboard `g-mwken3ke-l70ssitfne`，node `g-mwken6wm-qvf008wypn`。
- 两者均为九宫7/5/11/9、Point，名字相同，但ref不同，跨PSD同ref仍未过。不要按同名/零像素差合并，不删原合法未用条目。First180×40已经通过，无需为了示例128×80重做。
- 列表恢复后，最小验证是Second显式选择First ref，一次主按钮保留192×96并正常保存，再核对Second原doc/artboard/node不变、两稿ref一致。条目2只表示当前排序，不能硬编码它或绑定第一项。
- 新主按钮真实创建/引用、一次Undo、通知时序、透明/软边完整UI、两稿新上传/云端回取/Unity新源闭环仍待。已有旧真实云源Unity83独立用例、跨模块复用和fresh repeat通过，不冒充新版两稿通过，也不因纯PS改动重复全量Unity。
- 官方插件交接时仍为隔离增强0.4.4，未恢复原版；不能把这个增强目录当原版测试输入。持久state与备份保留，由总控统一安排最终恢复，不自行覆盖宿主文件。

详细现场记录见[验收快照](ACCEPTANCE.md)与[最近同步记录](SYNC-20261117-PRIMARY.md)。历史主证据位于 `/Users/betta/.codex/visualizations/2026/11/17/01a1e7c5-ba46-7533-bcc1-580af0395c6a/lanhu-production`，本轮证据位于 `/Users/betta/.codex/visualizations/2026/11/17/01a1e8ae-131c-7b21-a7ef-6c0bbc5780d6/lanhu-production`；保留原证据，不重写历史结果。

## 8. 插件方完成标准与回交材料

插件开发阶段按实际改动冻结最小充分验证，不默认重跑全量。相关入口：

- `test-authoring.cjs`：面板、身份、快照、目标几何、生命周期与选择通知。
- `test-gameui.cjs`：九宫、采样与公共核心逻辑。
- `test-export.cjs`：capture/finalize、源注入、透明frame恢复及拒绝路径。
- `test-production-fixtures.cjs`：合成材料。
- `test-official-upload.cjs`：需GAMEUI_OFFICIAL_INDEX指向白名单原版；真实官方上传器模块但网络stub，不是云端上传证据。
- `test-delivery.py`：安装事务/兼容/回滚专项，按DELIVERY说明提供白名单原版临时副本，不能使用增强实装包冒充。

本次纯文档交接不要求执行上述测试。开发后至少给出受影响测试、语法和diff检查；发生失败先分类并有新证据/实际变化再重验。需要真实PS观察时与用户集中安排，不与原总控同时操作；真实蓝湖上传与Unity全流程留给总控回交后执行。

回交必须提供：

1. 仓库、分支/worktree、完整commit SHA、精确改动文件，工作区未提交内容说明；不能只交未提交目录。
2. 实现了哪些需求、修复根因与复现/前后行为；协议是否保持兼容，未解决项如实列出。
3. 实际测试命令、过滤范围、通过/失败数及日志；mock、宿主API、真实面板、云端证据分开。
4. 如构包，提供新/空staging路径、实际manifest版本、全新release、ZIP SHA和文件清单，拒绝覆盖旧包或同release换内容。`Panel/build-panel.cjs`与`gameui-delivery.py build`仍是现有入口，ZIP不冒充正式CCX。
5. 具体交给总控的最小操作步骤、预期PSD/XMP/云端字段；若涉及协议变化，先提出字段差异与迁移/兼容方案，不能静默更改冻结协议。
6. 所有真实安装/目录/PSD状态变化与恢复方法；不提交官方二进制、凭据、PSD、私有catalog、安装state、staging/dist或Unity代码。

总控收到后依次做：指定commit审查与Framework快照同步 → 新候选与真实PS保存重开/像素检查 → 隔离蓝湖上传与gameUI/1×RGBA回取 → 现有Unity workflow生成/公共Sprite GUID复用/重复稳定性 → 记录成本、门槛及官方插件最终恢复。开发完成、可隔离试用、正式推广分开，不提前宣称全链路通过。

## 9. 可直接发给新 Codex 的启动指令

```text
请在 /Users/betta/Workspace/lanhu_ps_plugin 独立继续开发PS插件。
先完整读取 Docs/PLUGIN-DEVELOPMENT-HANDOFF.md，并按其入口阅读CONTRACT、Panel/README、MAINTENANCE、DELIVERY和当前ACCEPTANCE。
这是已有实现的接续，不重新设计云端协议。保持gameUI schemaVersion=1、持久身份、assetRef版本不可变、authoring.sources/targets及capture/finalize接口兼容；美术日常一个主按钮，正常CmdS。
先核对HEAD/status，使用专属分支或worktree，不覆盖他人编辑；只在独立插件仓开发并及时本地提交，不修改Framework/Unity、不自行远程push或正式推广。
当前优先问题是0.5.1实际展开资源列表只见条目1，但宿主DOM含条目2；先取得实际可见菜单证据定位，不把DOM存在当UI通过，也不按名称/像素猜绑或删除资源。缺plugin.create的旧启动错误已修复，勿重复归因。
允许在协议内改善UI和内部实现，保留已有PSD与目录；协议变更先列差异与兼容影响交总控协调。
按真实改动选择必要专项测试，未发生变化不重跑全量；区分mock、宿主API和真实面板证据。
完成后给我完整commit、改动范围、实际验证命令与日志、候选版本/包哈希、未过门槛和最小回交步骤。我会交回原总控做蓝湖真实上传和Unity整个流程验证。
```
