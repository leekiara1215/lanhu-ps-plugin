# GameUI 独立 UXP 美术面板（隔离试用）

入口：`Panel/build-panel.cjs`。从 Photoshop 工具目录执行：

```sh
node Panel/build-panel.cjs /absolute/new-or-empty/staging/GameUIAuthoring
```

输出为自包含插件目录，包含 `manifest.json`、面板 HTML/CSS/JS、原样复制的 `gameui-core.js`、`gameui-ps.js`、`gameui-authoring.js`。由交付安装脚本负责归档/安装；构建器拒绝覆盖非空目录。开发加载入口为输出目录的 `manifest.json`，Photoshop >=25.0，UXP API 2。本面板不改官方蓝湖插件。Node 构建和测试不启动 PS/Unity。

## 操作

1. 打开隔离 PSD，初始化当前 PSD。写入本地 uploadScope 测试标记，限制仅 `cfea1199-7c07-48d9-86ef-cdbd3385c237`；上传由单独适配器完成。
2. 选中普通像素层，只填写名字、源像素 L/T/R/B、Point/Bilinear，点击“从选层新建资源”。内部assetKey由工具生成、初始version=1，只读诊断引用显示于面板；美术无需填写ID或版本。“更新所选资源名称”只更改名字并保持原快照；像素/边框/采样变更使用“发布所选资源新版本”，工具按同资源已有最高版本+1采集当前选层新源，保留旧版本。透明外沿需通过“源画布透明留白 L/T/R/B”显式补齐；默认0按图层非空 bounds 裁切，不能自动推断原图画布。自动保存原始源快照到 XMP `authoring.sources[assetRef]` 和插件私有资源目录。工具校验派生的资源键/版本与assetRef一致；实际复用身份始终为assetRef。
3. 在任何 PSD 初始化后，选择目录中的版本、选中普通像素层，显式引用。引用只把所选assetRef契约和PNG加入PSD，不写入整个目录；该操作明确以当前非空图层bounds声明目标画布，不推测透明外沿，后续重新应用目标尺寸可生成含留白的画布。只有源尺寸/边框/采样属于公共资源，实例写入新的或原有 nodeId 和引用；无需在画布摆源图。
4. 目标尺寸预览在面板显示 PNG；“应用目标尺寸到选层”从已存源快照生成新像素并替换同一图层，保留 nodeId/assetRef 和最初快照，因此原始小源图无需继续保留在画面。本地`authoring.targets[nodeId]`记录width/height/insetLeft/insetTop/contentWidth/contentHeight，来自目标RGBA中alpha非零的包围框；应用后严格核对真实PS内容边界，避免原生导出裁掉透明外沿后把128×80画布误作124×76。Point 使用既有 renderNineSlice；Bilinear 使用相同切片坐标和逐通道线性插值作为检查预览，不能替代 Unity 纹理/图集实测。
5. “复制选层”直接使用 PS 返回的新 layer ID，生成新nodeId、继承assetRef和目标画布记录。“当前文档分配全新身份”明确重置当前副本的 documentId/artboardId/各nodeId并重键目标记录；资源身份保持。此操作面向已通过 Photoshop 复制/另存出的文档，不会另建或保存文件。
6. 点击刷新/检查，定位未绑定层、源缺失、失效绑定。任意原生复制一律不猜测来源，用选择器明确绑定；重复 nodeId 可对选层显式重新生成。关闭、保存重开、重命名、移动均使用 XMP 中按 Photoshop layer ID 持久的身份，不按名称或像素重算。两个同时打开且同身份的 PSD 阻止写入，需对副本分配新身份。关闭原稿后再打开未分配身份的原生副本无法自动判断其来源，必须执行明确的新身份操作。
7. 导出目录 JSON 交给另一台机器或其他 PSD 使用，导入后仅合并到插件私有目录，显式引用时再加入PSD。便携目录不携带实例targets。插件私有 JSON 每次写入后立即回读；文件选择器导出亦回读。目录与 PSD 的 XMP 修改均需在实际 PS 中验收；PSD 使用正常保存操作持久化到磁盘。

## 支持边界

- 仅已使用 sRGB IEC61966-2.1 配置的 8-bit RGB 文档普通非背景像素层，拒绝隐式色彩转换。层及父层必须可见、100% opacity/fill、Normal（父组允许 Pass Through）。拒绝样式、蒙版、剪贴、调整层、智能对象、形状、文字、画板或无法读取描述符的层。请由美术明确在单独副本栅格化/合并，不自动破坏原层。
- 按整数 boundsNoEffects 加用户显式透明留白获取源像素，不猜测原始画布、不缩放，要求 imaging 返回 level=0、8-bit RGB(A)。请求 sRGB IEC61966-2.1、applyAlpha=false；RGB 返回补 alpha=255，RGBA 保留透明 RGB。宿主若裁剪无像素区，仅在声明的整数源画布边界内补透明 0。已有target时，“应用”按当前非空图层左上角减记录inset还原画布原点，普通移动后可继续保持同一画布；无target旧稿首次应用以当前非空左上角为画布原点。应用会刷新target并核对实际内容bbox；纯透明目标明确拒绝。最多 4,194,304 源/预览像素。
- PNG 为纯 JS 编码，RGBA8、filter 0、zlib stored blocks、CRC32/Adler32，确定性无损，不调用只输出 JPEG 的 imaging.encodeImageData。目录读取器只支持本面板生成的确定性 PNG 编码；任意外部 PNG 请从 PS 普通像素层重新定义。
- assetRef 版本的像素、源尺寸、border、sampling 以及未知资源契约字段不可改变；显示名字可更改。未知可选字段经复制/目录导出保留；未知 schema、authoring 版本或 requiredCapabilities 阻止。旧稿缺快照时保留旧契约并报告，需选择原始源重新定义；不会由拉伸实例反推原图。
- XMP 沿用 nodes/assets，writeMetadata每次写后立即回读。命中GameUI metadata属性但JSON解析失败时抛`GAMEUI_METADATA_INVALID`并保留非枚举cause，错误消息不包含XMP正文；无该属性的未标记稿仍返回null。目录先存后写 XMP，XMP 失败最多留下未使用目录条目；PSD 的未提交修改由 modal history 回滚。文件写入断电原子性不在当前宿主 API 保证范围，目录解析异常会显示并保留原文件，不静默覆盖。
- 真实 PS UI、保存重开、宿主透明 RGB 保真、蓝湖上传及 Unity 最终表现由负责人统一验证；专项 Node 通过不代表这些宿主验收已完成。

API 依据：[Adobe Imaging API](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging)、[Layer duplicate](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/layer)。

新建资源会拒绝与目录中已有资源相同的显示名称，提示使用选择器引用；独立资源应使用不同名称。发布同一资源的新版本仍可沿用名字。已存在或导入的同名同版本条目会显示不同的“条目 N”，选项值始终为完整 assetRef，不按名称或像素合并。条目序号只用于当前列表识别，诊断引用仍显示在资源信息中。

## 负责人可选宿主诊断入口

`Panel/host-smoke.psjs` 仅供负责人通过 Photoshop 的 Scripts/Browse 手动运行，从源码目录 require 上一级模块（不包含在插件 staging 中）。选择审计输出文件夹，脚本只读取当前已打开的 `LanhuGameUIProductionFirst20261117.psd` / `LanhuGameUIProductionSecond20261117.psd`，严格检查固定源 layer ID 3/7/11、名字与坐标。透明/软边源显式四边留白2px，均输出64×48源PNG。随后对每份合成稿创建临时副本，仅将副本透明源应用128×80、核对实际124×76内容与画布原点312,32，finally关闭副本且不保存。报告为`gameui-panel-target-host-smoke-result.json`；错误写报告，不采集其他稿件。不修改原稿、不写XMP、不保存PSD、不上传。该诊断仅验证真实宿主采集/应用，不代替面板加载、点击及持久化验收。

`Panel/resource-readback.psjs` 用于已经由美术通过面板标记、正常保存并重开的上述两份固定合成稿。先用独立 PSD 检查器从磁盘提取 `saved-panel-first-metadata.json` / `saved-panel-second-metadata.json`，放在所选审计输出目录。脚本只读比较重开后的完整 XMP、资源/实例身份与 target，采集已标记 layer 3 的真实目标 PNG，输出 `gameui-panel-resource-readback-result.json`。它不补写缺失标记，也不把不同 assetRef 按相同像素合并；目标 PNG 应再由独立参考比较。
