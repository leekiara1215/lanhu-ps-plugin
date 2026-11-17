# 生产化合成测试材料

当前从独立插件仓库根目录维护与运行；Framework 保留显式同步的集成快照。最新验收见 [Docs/ACCEPTANCE.md](../Docs/ACCEPTANCE.md)，下方材料创建与初轮采集段落保留当时状态，不将历史 pending 覆盖后续已有证据。

状态：离线生成与 Node 检查已通过；2026-11-17 集成负责人已在 Photoshop 2027 实际创建并保存两稿，各 12 材料层、实际 sRGB/8-bit。[创建报告](/Users/betta/.codex/visualizations/2026/11/17/01a1e7c5-ba46-7533-bcc1-580af0395c6a/lanhu-production/synthetic-fixtures/production-fixture-ps-result.json) 为 `synthetic-documents-created`，PSD 哈希见 [材料证据](../Docs/ACCEPTANCE.md#materials)。本项仅通过材料创建，真实面板、安装、上传和 Unity 闭环仍为 pending。本目录不含生产素材、Cookie 或 Token。

后续 host API 源采集已通过：六份实际 PNG 与独立原始 RGBA 全部零差异、均保留 64×48，详见矩阵 D05。采集时 asymmetric-point 使用四边 padding=0，透明/软边使用四边 padding=2。这不改变实际 Panel 点击、保存重开和上传的 pending 状态。

从独立仓库根目录执行已有的 Node 命令：

```sh
node Fixtures/generate-production-fixtures.cjs
node --test test-production-fixtures.cjs
```

默认输出 `Fixtures/generated/`，也可传入 Fixtures 内的另一空目录。CLI 拒绝目录外输出；测试调用生成函数时只写临时目录。输出目录忽略提交；仓库中的 `expected-materials.json` 固定两份材料清单及源/参考像素 SHA-256。改变生成器造成清单漂移时，必须先审查原因，再显式更新预期；不能为消除失败直接覆盖。

每个 PNG 均为 1×、8-bit RGBA，配套 `.rgba` 是从左到右、从上到下的直通道 RGBA8，无头部。`manifest.json` 记录所有文件、尺寸、PNG 哈希和解码像素哈希。PNG 文件字节只作为包复现检查；跨 PS/蓝湖比较使用解码 RGBA，不能要求不同编码器输出相同 PNG 字节。

## 显式素材

三份源均为 64×48，非对称 border 均为 L7/T5/R11/B9，单位 `sourcePixel`、中心 `stretch`。三种目标尺寸均为 128×80、192×96、96×128，整数位置，缩放 1。每份源都生成 Point、Bilinear、黑底合成和白底合成的目标参考；指定资源实际使用哪一种见下列清单。

- `asymmetric-point`：九个区域颜色不同，每个角内部有位置纹理。Point；用于检测上下/左右混淆、非对称 border 和整数像素拼接。
- `transparent-point`：外沿两圈 alpha=0，下一圈 alpha=96，内部 alpha=255。Point；用于检测透明画布被裁剪、边缘 alpha 和四角位置。源应仍为 64×48；非透明边界不是源画布尺寸。
- `soft-bilinear`：有六档以上 alpha 的平滑外沿及连续颜色渐变。Bilinear；用于检查平滑、灰阶过渡、黑白背景上的暗边/亮边。本合成图只代表渐变与阴影类型，不涵盖全部真实美术效果。

`resourceKey` 只是本地用例标签，绝不能当作资源复用身份。资源在面板登记后，将真实 `assetRef`、documentId、artboardId、nodeId 与 Photoshop layer ID 单独保存到审计证据。第二稿从同一个资源目录引用，预期继承完全相同的三个 assetRef；两稿 documentId/artboardId 和所有实例 nodeId 应不同。源像素、sourceSize、border、sampling 变动都需要新资源版本。

## 两份 PSD

- `LanhuGameUIProductionFirst20261117.psd`
- `LanhuGameUIProductionSecond20261117.psd`

两稿均为 900×700、显式 sRGB IEC61966-2.1、8-bit、透明背景。每稿初始包含三个 `SyntheticSource-<resourceKey>` 输入图层以及九个 `SyntheticInstance-<resourceKey>-<width>x<height>` 参考图层，总计 12 个测试图层。三列左边缘为 32、312、592；源 top=32，三种实例 top=140、310、480。完整名称、坐标、RGBA 文件名逐项列于 `expected-materials.json` 的 `documents[].layers`。若实际 DOM 额外创建默认层，应区分默认层与上述 12 个材料层，不得将默认层登记为公共资源。

首选真实面板验收走“无样本”流程：保留初始材料副本，在操作稿移除九个预渲染参考层；三个源层分别登记一次，通过 A 的“应用目标尺寸到选层”变为第一个实例，再复制成其余尺寸。最终每稿九个真实实例，无需保留独立小源样本。第二稿引用同一目录并通过面板生成九个实例。初始 12 层清单是输入材料与参考，不代表最终上传稿层数；旧参考层留在上传稿或只对它们预写元数据不能证明无样本流程通过。

由集成负责人在 PS 手动运行 `create-production-documents.psjs` 并选择生成目录或其独立审计副本。脚本只接受固定两稿、尺寸、项目和材料层；不关闭现有文档、不覆盖已有 PSD、不写 gameUI/XMP、不上传。输出 `production-fixture-ps-result.json` 只说明脚本创建进展，`panelAcceptance` 始终为 pending。脚本记录实际 profile/depth，非 sRGB/8-bit 停止。脚本本身不是新面板的自动验收器。

创建选项 `profile` 与 `depth` 来自 [Adobe DocumentCreateOptions](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/objects/createoptions/documentcreateoptions)。本脚本沿用既有独立 `.psjs` 直接执行方式：[Adobe UXP Scripting](https://developer.adobe.com/photoshop/uxp/ps_reference/media/uxpscripting/) 展示独立脚本直接调用 DOM，并说明脚本运行于类似 executeAsModal 的上下文。这里没有把插件内 API v2 的调用约定混为脚本验证；负责人仍须在真实 PS 记录执行和异常，Node 静态检查不能证明 modal 或宿主兼容。

透明图层被 Photoshop 的 `boundsNoEffects` 裁到非透明内容是专项风险；面板实际捕获必须根据明确源画布/选区保留 64×48，否则该项失败。不要通过改小预期、填不透明定位点或预写 XMP 规避。若面板当前无保留源画布的入口，记录阻碍并交 A 修复。

## 参考口径

Point 调用现有 `gameui-core.js/renderNineSlice`；专项测试另外逐角检查源 texel，并以独立整数算式抽查中心映射。要求真实 Point 原始纹理及整数像素实例在相同坐标口径下逐像素一致，不能以平均误差掩盖偏移。

Bilinear 是独立 CPU 参考：texel center、整张纹理 clamp、无 mipmap/压缩，直接对存储的 RGBA 通道插值并四舍五入。它用于解释平滑趋势与定位边界；没有模拟 GPU 的 sRGB 转换、预乘 alpha 或 Canvas blend，不能直接作为所有 GPU 渲染的零误差门禁。真实渲染需记录颜色空间、alpha/blend、背景、缩放、导入器和实际图集采样，再与同条件参考比较。Bilinear 不与锐利 Point 图要求相等，也不能为通过而临时改为 Point。黑/白合成图均采用直 alpha 的存储空间合成，口径同样需要与实测对齐。

## 交给负责人的最短步骤

1. 先冻结安装版本/哈希并完成可回滚安装；再生成这两份全新的合成 PSD。
2. 按 [当前面板验收范围](../Docs/ACCEPTANCE.md#remaining) 通过面板登记三个源，同层应用目标尺寸并复制成九个实例、保存/重开，再在第二稿引用同一目录。实际 panelAssigned 身份写入审计，不能用生成器代填。
3. 仅在测试项目上传两稿，云端回读后执行现有 workflow；新的 `gameUIResourceRoot` 路径和跨模块输出由 C/集成负责人确认。
4. 对照 manifest 的哈希/尺寸/采样、真实 Sprite GUID 和渲染结果留证。既有三组 LanhuGameUI*Audit 与共享 Profile 的前后哈希必须不变。
