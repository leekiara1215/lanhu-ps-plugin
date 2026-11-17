# GameUI 独立 UXP 美术面板（隔离试用）

入口：`Panel/build-panel.cjs`。从 Photoshop 工具目录执行：

```sh
node Panel/build-panel.cjs /absolute/new-or-empty/staging/GameUIAuthoring
```

输出为自包含插件目录，包含 `manifest.json`、面板 HTML/CSS/JS、原样复制的 `gameui-core.js`、`gameui-ps.js`、`gameui-authoring.js`。由交付安装脚本负责归档/安装；构建器拒绝覆盖非空目录。开发加载入口为输出目录的 `manifest.json`，Photoshop >=25.0，UXP API 2。本面板不改官方蓝湖插件。Node 构建和测试不启动 PS/Unity。

## 日常操作

1. 打开 PSD 并选一个普通像素层。选择器空值明确表示“新建公共资源”，不会自动选择库中的第一条。首次新建只填名称、源像素 L/T/R/B、Point/Bilinear 和需要的源透明留白；内部ID与版本仍自动维护。同名新建会阻止并提示引用现有资源，独立资源需不同名称。
2. 填目标画布宽高，点击唯一主按钮。新建时先从当前原尺寸采源快照，再创建引用并应用目标像素；引用时明确选择已有资源，由资源继承九宫/采样，不从效果图推断源。未标记 PSD 在同一次操作中自动初始化，无需另点初始化。
3. 使用正常 Cmd+S 保存 PSD。面板不执行隐式磁盘保存。下一未绑定图层或 PSD 可继续使用刚明确选择 / 创建的资源，一次主操作完成引用与应用；绑定层切回来会显示自己的持久 assetRef。

目标尺寸默认取当前绑定实例已登记的完整画布，或当前选层整数非空边界；后者不代表原始透明画布，需保留外沿时填写完整尺寸。source透明留白仍须明确填写，默认0不会猜原图画布。创建后原始1×快照始终保留在`authoring.sources`，目标几何保存在`authoring.targets`，不需要另摆源样本层。

选择器显示名字与版本；既有同名同版本条目附当前列表内区分序号，`option.value`始终为完整assetRef。序号不参与身份、不会合并用户资源。默认界面只显示当前资源的继承契约；内部全引用在高级诊断中查看。

## 高级与自动刷新

“显示高级操作”展开既有分步操作，保留原控件ID与行为：单独初始化、仅创建、更新名字、发布新版本、仅引用、复制/fork/身份修复、可选预览、仅应用、目录导入导出及检查定位。发布新版本仍按私有目录同资源最高版本+1；名称更新不重采样源。引用只把所选版本加入PSD，导入目录只更新私有库。

使用Adobe Photoshop API2 `action.addNotificationListener(["select","open","close"], callback)`，只在文档/图层身份改变时刷新；忙碌或加载中跳过，同一选层内的输入不会被通知重置。销毁插件时移除同一监听；API注册失败会提示使用高级刷新，不轮询。实际宿主事件时序仍由负责人验收。[官方API](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/photoshopaction)、[事件名](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/eventcodes)。

异步读取 XMP / 检查文档身份期间若继续切层、切文档或关闭文档，刷新会丢弃旧选层的结果并读取最新选择，再更新界面。读取期间在当前选层编辑的目标宽高、资源设置及明确选择的“新建 / 已有资源”会保留；未编辑的字段仍接收该实例默认值。插件销毁后不呈现未完成的读取结果。这些时序保护已有离线回归，仍需真实面板验收；不据此宣称原生资源菜单的可见性问题已解决。

主按钮将自动初始化、创建/引用、像素应用及XMP写入置于一次modal history；失败请求回滚PSD像素与XMP。未知schema/必需能力、损坏XMP或身份冲突仍严格阻止，不覆盖已有标记。目录沿用先存源后写XMP：后续XMP失败最多留下合法未使用条目，面板保留原错误并提示可显式引用恢复，不回写或删除可能被外部更新的目录。

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
