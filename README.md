# GameUI Photoshop 工具

当前实现提供独立美术面板和受版本/哈希保护的上传适配器，限定隔离测试空间，尚未通过正式推广门槛。

- 美术面板构建和操作入口：[Panel/README.md](Panel/README.md)。
- 安装包构建、兼容范围、安装升级、卸载、回滚及恢复：[DELIVERY.md](DELIVERY.md)。
- 可复现合成稿：[Fixtures/README.md](Fixtures/README.md)。
- 本轮集成结果与未通过门槛：[RESULTS.md](../../Docs~/Productionization/RESULTS.md)。

下文保留 2026-11-16/17 原型及历史验证记录。旧固定名脚本仅供审计，旧补丁直接安装入口已停用。复杂文字效果未接入。

## 已实现的代码

- `gameui-core.js`：源像素单位的九宫校验与预览拼接，不修改输入原图。
- `gameui-ps.js`：通过 Photoshop UXP 读写文档级 XMP，写后立即回读。
- `gameui-export.js`：在原生格式化后捕获 XMP，在最终 JSON 序列化与哈希前补齐源图 URL 和实例关联。
- `build-audit-patch.py`：对官方 UXP 1.0.32(303) 的确定 SHA-256 构建两处适配；未知版本拒绝修改。安装与恢复均显式指定。
- `gameui-foundation.psjs`、`gameui-identity-check.psjs`、`gameui-open.psjs`：仅用于本次合成测试稿，输出路径和名称固定在 20261116 审计目录；不应用于美术生产稿。
- `gameui-verify-export.psjs`：用实际 PS XMP 和第一次原生上传数据检查本地注入；结果仅作诊断，不替代云端回读，不作为 Unity 生成源。

当前原生导出可能省略 `meta.fileName`，测试稿保护判断会回退到 `artboard.name`；两者仍受固定测试稿名称和项目 ID 限制。

上传适配器仅增强项目 `cfea1199-7c07-48d9-86ef-cdbd3385c237` 内名称匹配
`LanhuGameUIFoundation20261116[Second].psd` 的测试稿。测试稿选中其他项目时拒绝增强上传；其他稿件沿用官方行为。

## 最小数据约定

根 `gameUI` 保存 `schemaVersion: 1`、`documentId`、`artboardId`、资源定义及必需能力。
节点的 `gameUI.nodeId` 是持久身份，原生 PS / 蓝湖 ID 只定位当前快照。

资源按 `assetRef`（本次为 `audit.button.primary@1`）固定版本，包含：

- `sourceNodeId`、`sourceSize`：未拉伸的真实切图节点及源画布尺寸；
- `image.url/exportScale/width/height`：来自同次原生上传的源图；
- `nineSlice`：`left/top/right/bottom`、`unit: sourcePixel`、`center: stretch`。

源节点标为 `kind: resourceSource`，只提供资源，不生成界面节点。
实例标为 `kind: image`、`renderMode: nineSlice`、`nativeImageUsage: validationReference`；
原生大图保留在蓝湖 JSON 中供对照，Unity 的生产 Sprite 明确绑定源图。

本原型要求源图在同一快照内有原生导出节点，因此会在测试稿上展示小样本。
隐藏资源容器、直接导出智能对象内部原图及目录选择面板不在本次已实现范围。

## Unity 接入

`LanhuSourceDocument` 校验扩展后保留元数据；`LanhuGameUI` 将实例切图映射到同一源，
下载器合并相同下载并把结构化边框写入 `slices.json`。原始网页 JSON 不重写。
导入器保留每个实例的目标矩形、跳过源样本，并在原生切图映射完成后换成稳定节点 ID。
Plan 从结构化边框设置 Sprite；同契约资源沿用现有像素、尺寸及 border 校验复用。
同一资源版本若试图替换已存在目标中的不同像素或 border，预检阻塞，要求发布新版本。

无 `gameUI` 的源沿用现有路径。本文中的 GameUI schema 1 与 Unity Job/Profile schema 2 无关。
普通复制会产生未登记节点；当前由增强逻辑登记后继承资源引用，不声称已经支持自动监听任意复制和跨 PSD 粘贴。

## 历史补丁构建记录

当前安装必须使用 [DELIVERY.md](DELIVERY.md) 的事务 CLI；下列旧 --install/--restore 已明确拒绝执行，不再作为安装入口。

```sh
python3 build-audit-patch.py '<已安装官方插件目录>' '<审计输出目录>/plugin'
python3 build-audit-patch.py '<已安装官方插件目录>' '<审计输出目录>/plugin' --install
python3 build-audit-patch.py '<已安装官方插件目录>' '<审计输出目录>/plugin' --restore
```

安装和恢复后均需重启 Photoshop，清除已加载的模块。恢复拒绝覆盖安装后被外部修改的入口或增强模块。
`plugin-state.json` 记录原版、增强版和模块哈希。不要向未知官方版本套用补丁。

## 验证

PS 中通过“文件 → 脚本 → 浏览”运行 `.psjs`，脚本仅创建或操作固定名称的测试稿。
测试文件与蓝湖上传限定在新建独立测试空间。Unity 生成限定为专门的测试资源目录。

```sh
node --test test-gameui.cjs
```

Unity 开发验证使用既有 `LanhuSourceFormatTests`：覆盖单源下载、稳定身份、目标尺寸、
结构化九宫边框、资源版本冲突和无效引用拒绝。真实云上传、生成和视觉验收结果以审计记录为准，
不能用单元测试通过代替完整 PS → 蓝湖 → Unity 闭环。

## 2026-11-17 真实闭环结果

两份合成 PSD 均已通过原生上传链路发布到独立测试空间。根与节点的 GameUI 标记逐字段匹配已保存 PSD 的 XMP，
两个文档的身份不同，但共用 `audit.button.primary@1`，归一化后的源 PNG 内容一致。
Unity workflow `53ef90b522f041b3b43331b27e8ea45c` 生成两个测试 Prefab，六个实例共用一个 Sprite，
三种尺寸为 240×64、360×64、240×96，border 为 L24/T20/R24/B20。两屏均 complete，零占位、零 warning。
重复执行未新增 apply 尝试，测试目录内 17 个文件内容保持不变。验证范围为同一测试模块内跨 PSD 的复用，
尚未实现跨模块公共库登记与美术资源选择面板。

视觉核对使用实际 Sprite 和 UGUI Image 生成的 36 顶点九宫网格。四角内部采样与 PS 对照一致，但全图并非逐像素相等：
现有原生 Android xxhdpi 路径先以 4/3 倍导出，再归一化为源尺寸，边界已存在重采样差异。
后续优先实现独立的 1× 无损源图导出；不能把本原型称为生产级像素还原流程。

早期 `imaging.encodeImageData` 的尺寸诊断文件实际为 JPEG，未用于 Unity 生成；本次 Unity 输入来自经签名、尺寸检查的原生 PNG。
测试结束后官方插件已按原始 SHA-256 恢复并重启 Photoshop。增强模块源码保留在本目录，没有作为生产插件常驻安装。

## 1× 源图与跨稿复用验证结果

新一轮以 `audit.button.primary@2` 单独验证源图 1× PNG，实例参考图仍遵循蓝湖面板原设置。
第一次真实上传在 10% 自动标注阶段被增强模块的原文档检查阻止：官方插件 manifest 指定 Photoshop API 1，
原生对象使用 `_id`，而新增代码仅读取 API 2 的 `id`。独立 `.psjs` 使用新版 DOM，因此此前脚本验证未覆盖此差异。
现在兼容两种 ID，并兼容 API 1 分组的 `children`；以旧版对象形状复现相同错误后，修复后的 Node 四项测试通过。
两份修正版已通过真实上传、Unity CLI fetch 和 workflow 生成；云端所有原始 XMP 字段均与已保存 PSD 匹配。
两份 128×64 源 PNG 解码后与 PS Imaging API 读取的原始 RGBA 数据逐通道一致，差异为 0。
两份 PNG 文件字节不同，解码像素完全一致；六个实例在同一测试模块内共用一个 Sprite，GUID 为
`20d5442030565418f8c828e37e0f08f3`，导入的 PNG 像素仍与 PS 原始像素一致。

workflow `ce17156c31ac47a1b3713409611d6ccd` 的两屏 complete、零占位、零 warning。
输出限定在 `Assets/LanhuGameUI1xAudit20261117`；重复执行已完成 workflow 未新增 apply，18 个文件
（包含输出根目录的 `.meta`）内容与 GUID 不变，原测试目录和项目共享 Profile 不变。

真实生成 Prefab 保留默认 Bilinear 采样。三种尺寸的四角全部逐像素匹配，但靠近九宫分界处仍有
128/15360、256/23040、668/23040 个像素发生混色，最大通道差分别为 56、71、82。
在隔离预览中仅对 GPU 复制的临时纹理设置 Point，六张渲染与 PS 实例原始像素全部一致。
诊断未修改生成资产、导入器或共享配置；首次用 `Object.Instantiate` 复制不可读纹理产生六条诊断错误，
改用 `Graphics.CopyTexture` 后复核未新增错误。证据为 UGUI Image 生成的真实九宫网格在隔离预览中的渲染，
不涵盖运行时 Canvas 合批、移动设备压缩或真实软边美术。

结论：1× 无损源图和跨 PSD Sprite 复用已验证；默认 Bilinear 下不能声称像素级还原。
后续应把采样方式纳入资源契约，按资源选择，不能将所有美术资源统一改为 Point。
本轮结束已使用 `plugin-api1-fix` 审计状态按哈希恢复官方插件并重启 PS，增强模块没有常驻安装。

## 资源级采样契约

公共资源可在 `gameUI.assets[assetRef]` 上声明 `sampling: { "filterMode": "Point" }` 或
`sampling: { "filterMode": "Bilinear" }`；文档同时声明 `requiredCapabilities: ["nineSlice.v1", "sampling.v1"]`。
实例仅通过 `assetRef` 继承配置，不允许在节点上覆盖 `sampling`。旧稿没有采样字段时沿用 Bilinear。
未知采样值、缺少能力声明及实例覆盖都会在上传增强模块或 Unity 源校验中被拒绝。

采样值跟随原生 JSON 进入下载清单，参与计划指纹、导入器设置、像素资源复用与同版本冲突校验。
相同像素但采样方式不同的资源不会 alias；同一版本改采样必须发布新版本，不能静默修改旧 Sprite。
Point 固定进入 Profile 已有的独立纹理目录（本项目为 `Res/TextureSingle`），只复用其同名目标资源，
避免复用到其他图集中的纹理。Bilinear 沿用原来的切图目录和图集流程。
这是当前测试模块的最小实现：Point 暂不进入生成的图集，可能增加 draw call，未新增按采样拆分图集的机制。

`gameui-sampling-prepare.psjs` 仅操作两份固定测试 PSD：将原公共资源升为 `audit.button.primary@3`（Point），
并增加同像素的 `audit.button.bilinear@1`（Bilinear）。两份 PSD 均包含两套资源与各自三种实例尺寸。
本地插件五项和 Unity 四十个用例已验证。两份真实上传的云端 XMP 字段与已保存 PSD 一致，
两种采样配置均进入下载清单；四份 128×64 源 PNG 与 PS 原始 RGBA 像素一致。

workflow `5e2222354d05499498a2cf9502052b63` 在 `Assets/LanhuGameUISamplingAudit20261117` 生成两份测试 Prefab，
两屏 complete、零占位、零 warning。十二个实例共用两个 Sprite：Point 六个实例共用
`dde404cec135449c8bc495192efa8339`，Bilinear 六个实例共用 `7149e4374c055468ab7c2aebb3310087`。
两种源像素相同但未被合并，实际导入器与纹理采样值均与资源契约一致。
Point 在独立纹理目录，未被生成的 Bilinear 图集覆盖；Bilinear 则在原图集的打包目录内。

在未覆盖采样设置的实际 Image 九宫网格隔离预览中，Point 六张渲染与 PS 原始实例像素完全一致。
Bilinear 保留平滑采样，三种尺寸与锐利 PS 合成参考的差异仍为 128、256、668 个像素，四角均一致；
这些混色是本次明确配置的采样结果，不作为 Point 的精度结论。
验证范围为 Editor 中的隔离预览与图集配置检查，没有进行 Player 或设备构建。

重复执行完成的 workflow 未新增 apply，21 个输出文件（包含根目录 `.meta`）的内容和 GUID 不变。
既有测试目录与共享 Profile 的基线哈希不变，本轮 Console 无新增 error。
本轮官方 PS 插件已按原始哈希恢复并重启，增强模块未常驻安装。
