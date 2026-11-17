# GameUI 独立 UXP 美术面板（隔离试用）

入口：`Panel/build-panel.cjs`。从 Photoshop 工具目录执行：

```sh
node Panel/build-panel.cjs /absolute/new-or-empty/staging/GameUIAuthoring
```

输出为自包含插件目录，包含 `manifest.json`、面板 HTML/CSS/JS、`lanhu-host.js`、README，以及原样复制的 `gameui-core.js`、`gameui-ps.js`、`gameui-authoring.js`、`gameui-export.js`，基础构建共10文件。由交付安装脚本负责归档/安装；构建器拒绝覆盖非空目录。开发加载入口为输出目录的 `manifest.json`，Photoshop >=25.0，UXP API 2。本面板不改官方蓝湖插件。Node 构建和测试不启动 PS/Unity。

## 资源创作与蓝湖工具页签

0.6.1在插件名称和“资源创作”页签上直接标明版本；正确候选应显示“资源创作 · 0.6.1 / 蓝湖工具”。若仍看到只有原生资源下拉框的旧界面，说明当前加载的不是此候选，修改源码或构建ZIP不会自动更新已加载的staging。

日常错误提示使用中文；底层原始诊断和错误码保留在“高级操作”底部，便于排查。Point/Bilinear的传输值保持不变，界面分别显示“点采样 / 双线性”。

顶部可切换“资源创作 / 蓝湖工具”，切换不重置名称、资源选择和目标尺寸。带蓝湖运行时的候选在蓝湖页点击“加载蓝湖工具”后挂载原版 Vue 界面，可通过该界面登录、选择团队/项目、设计倍数/画板并进入上传与切图等原版流程。云端服务仍由蓝湖提供，不是自建蓝湖后台。

资源创作页有登录/项目状态和实际上传快捷入口，还可点击“在本页展开蓝湖工具”直接使用同一蓝湖界面。两个位置移动同一个挂载节点，复用同一会话和项目状态，不创建第二个登录实例。内联展开时上传进度保留在当前页；普通快捷上传进入蓝湖页显示后续结果。面板仅提示“已交给上传流程”，不把入口返回当作云端成功。官方上传进行时阻止资源创作写入PSD。

蓝湖界面使用 Shadow DOM 隔离。仅在加载时启动；缺隔离支持明确拒绝并保留“打开官方蓝湖面板”入口。销毁时清理所跟踪的定时器、窗口事件、Photoshop通知与Vue挂载；该机制不是权限沙箱，也不保证取消已发出的网络请求。API 2 适配在解析与切图的公共入口进入 modal，不更改冻结 gameUI 契约。当前所有集成上传只允许测试项目 `cfea1199-7c07-48d9-86ef-cdbd3385c237`，并兼容官方配置的 projectId/projectID 两种拼写且拒绝冲突。

### 构建带蓝湖功能的候选

```sh
node Panel/build-panel.cjs /absolute/new/staging/GameUIIntegrated --official-plugin /absolute/pinned/original/lanhu
```

输入须是 `compatibility.json` 白名单的原版 manifest/index，构建前逐字节核对SHA；已安装增强包、未知版本/同版本异字节均拒绝，失败不创建staging。构建仅在新输出中生成 `lanhu-runtime.js` 和带原包/生成文件哈希的 `lanhu-runtime.json`，不将官方代码写入源码仓，不修改实装目录。包含蓝湖时共12文件；基础10文件候选没有内置蓝湖界面，仍可通过IPC打开已有官方面板。

完整集成候选在 staging manifest 增加 network.domains=`all`（原版服务动态返回OSS端点）及 http/https 外部打开权限，基础构建不增加网络权限。登录使用当前独立插件自己的存储，不读取或复制官方插件的私有登录数据。候选尚未证明实际PS中的Shadow CSS/弹层、登录回调、切图/上传和云端回取兼容；真实宿主、网络及Unity仍交总控验证，不将离线测试当作正式替代蓝湖插件通过。

## 日常操作

1. 打开 PSD 并选一个普通像素层。选择器空值明确表示“新建公共资源”，不会自动选择库中的第一条。首次新建只填名称、源像素 L/T/R/B、Point/Bilinear 和需要的源透明留白；内部ID与版本仍自动维护。同名新建会阻止并提示引用现有资源，独立资源需不同名称。
2. 填目标画布宽高，点击唯一主按钮。新建时先从当前原尺寸采源快照，再创建引用并应用目标像素；引用时明确选择已有资源，由资源继承九宫/采样，不从效果图推断源。未标记 PSD 在同一次操作中自动初始化，无需另点初始化。
3. 使用正常 Cmd+S 保存 PSD。面板不执行隐式磁盘保存。下一未绑定图层或 PSD 可继续使用刚明确选择 / 创建的资源，一次主操作完成引用与应用；绑定层切回来会显示自己的持久 assetRef。

目标尺寸默认取当前绑定实例已登记的完整画布，或当前选层整数非空边界；后者不代表原始透明画布，需保留外沿时填写完整尺寸。source透明留白仍须明确填写，默认0不会猜原图画布。创建后原始1×快照始终保留在`authoring.sources`，目标几何保存在`authoring.targets`，不需要另摆源样本层。

资源以面板内可滚动的按钮列表显示，无需展开原生下拉菜单。第一行“新建公共资源”明确表示空引用；已有版本显示名字与版本，同名同版本附当前列表内区分序号。当前行显示“已选”并高亮；下方显示资源版本数量。各行的 `data-resource-ref` 及内部选择值始终为完整 assetRef，序号不参与身份、不会合并用户资源。默认界面显示当前资源的继承契约；内部全引用在高级诊断中查看。点击资源行只更新面板选择，不写 PSD 或目录，主按钮才执行引用与应用。

## 高级与自动刷新

“显示高级操作”展开既有分步操作，保留原控件ID与行为：单独初始化、仅创建、更新名字、发布新版本、仅引用、复制/fork/身份修复、可选预览、仅应用、目录导入导出及检查定位。发布新版本仍按私有目录同资源最高版本+1；名称更新不重采样源。引用只把所选版本加入PSD，导入目录只更新私有库。

使用Adobe Photoshop API2 `action.addNotificationListener(["select","open","close"], callback)`，只在文档/图层身份改变时刷新；忙碌或加载中跳过，同一选层内的输入不会被通知重置。销毁插件时移除同一监听；API注册失败会提示使用高级刷新，不轮询。实际宿主事件时序仍由负责人验收。[官方API](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/photoshopaction)、[事件名](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/eventcodes)。

异步读取 XMP / 检查文档身份期间若继续切层、切文档或关闭文档，刷新会丢弃旧选层的结果并读取最新选择，再更新界面。读取期间在当前选层编辑的目标宽高及资源设置会保留；未编辑的字段仍接收该实例默认值。资源行与其它按钮在忙碌期间禁用，完成后恢复，避免操作中途切换资源。列表内容未变化时复用现有行，避免刷新重建列表而丢失滚动位置。插件销毁后不呈现未完成的读取结果。这些行为已有离线回归，真实 PS 中的可见、可选、滚动及通知时序仍需验收；旧原生菜单的宿主根因未确定。

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
