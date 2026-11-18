# GameUI 隔离试用交付

当前独立仓库是插件开发源；Framework 保留经过审查的集成快照。后续按 [维护与同步](Docs/MAINTENANCE.md) 记录指定提交，禁止两份 runtime 独立演进。
治理版本 2026-08-31.2；冻结接口见 [Docs/CONTRACT.md](Docs/CONTRACT.md)，最新实际宿主证据见 [验收快照](Docs/ACCEPTANCE.md)。
本文下方 B 实现阶段的“未验证”是历史执行范围；后续 UDT 加载和实装生命周期已由集成负责人观察，不能继续当作当前未执行，也不能外推为新上传闭环通过。
本交付仅覆盖测试项目 `cfea1199-7c07-48d9-86ef-cdbd3385c237`。开发完成与实机可试用分开验收。

## 两部分入口

- 独立 Panel：A 维护资源目录、实例和本地 XMP，通过 `authoring.sources[assetRef]` 提供 1× 8-bit RGBA PNG。
- 上传适配器在原版读取 PSD 图层树后核对选传范围。`capture/finalize` 为标记画板注入源节点，由同一次原版上传填回 URL。源节点仅存在于 payload，PSD 不必摆放源小图。

读取的官方 1.0.32 包 manifestVersion=4、Photoshop apiVersion=1，仅声明 `showlanhu` 面板，无上传 command 入口。
Adobe 的 IPC 支持调用另一插件显式暴露的 command/panel，不能凭空拦截其私有上传流程。
独立 Panel 负责创作，受项目门禁保护的适配器接入原版上传和序列化流程。

依据：[Adobe IPC](https://developer.adobe.com/uxp/guides/how-to/inter-plugin-comm/)。

## 兼容边界与本地字段

仅支持 `compatibility.json` 中逐项固定的官方包：插件 `com.lanhu.ps`，1.0.32(303)，manifestVersion 4，API 1。
manifest 原始文件 SHA-256 为 `5d5cd21a66772664ee00cbcc8dc7d31b920e74892d84287826e4f9059285680b`，
入口 SHA-256 为 `067760dc58d167e413f60a8d45dc61e97ce670ba3b4564e2b68ef3d9fd594194`。
未知 manifest、入口哈希或 seam 均拒绝；即使格式化 manifest 也需重新审计。build 303 为该已审计二进制的标识。

原审计合成稿 `LanhuGameUIFoundation20261116[Second][.psd]` 保持支持。
其他测试稿必须在本地 XMP 根明确标记：

```json
{"uploadScope":{"version":1,"projectId":"cfea1199-7c07-48d9-86ef-cdbd3385c237","purpose":"gameui-productionization-test"}}
```

已标记稿选错 projectId 会拒绝，projectId/projectID 同时存在但不一致也拒绝。
未标记稿保持原生 payload；普通稿遇未知是否标记的宿主访问错误时不启用增强，固定审计合成名读取失败会拒绝。
存在 GameUI metadata 属性但解析失败时，store 的 GAMEUI_METADATA_INVALID 或 SyntaxError 会明确阻止上传并提示修复/恢复；不输出 XMP 正文。
`authoring` 和 `uploadScope` 在 capture 中去除，云端仍为 gameUI schemaVersion=1。
已知必需能力仅 nineSlice.v1 / sampling.v1；未知可选字段保留。
实例必须显式 `nativeImageUsage=validationReference`，不得覆盖资源级 sampling/sourceSize/nineSlice。

自动源节点使用稳定的 documentId/assetRef 派生身份，既有原生 source 节点优先沿用；同一版本只允许一个 source。
PNG 逐 chunk 检查 CRC、IHDR、IDAT/IEND、实际尺寸、非交错 8-bit RGBA、DEFLATE 和 Adler-32、scanline filter。
拒绝 APNG、tRNS、未知 critical chunk、非法 base64、坏流和尺寸冲突；单维上限 8192，PNG 及展开 scanline 上限各 64 MiB。
旧原生审计 source 沿用 `exportSourcePng` 的官方 1× 导出。原始 PNG 文件可有不同压缩，但不重编码 authoring PNG。

## 实例透明边距恢复（2026-11-17 补充）

本地 `authoring.targets[nodeId]` 可包含 `{width,height,insetLeft,insetTop,contentWidth,contentHeight}`。
全部字段必须为安全整数；尺寸严格正值，inset 非负，内容矩形必须位于完整 target 内，且只能绑定已登记 image 的持久 nodeId。
面板在 define/apply 后维护该记录，复制实例更换 nodeId 时由面板同步重键；资源目录不携带实例 targets。

capture 核对原生 frame 宽高等于 contentWidth/Height，再用当前 left/top 减 inset 恢复完整 target 矩形。
有 realFrame 时，原宽高和位置必须与 frame 一致，随后一并恢复；若带 right/bottom 也同步。
实例图层移动后仍以新位置恢复；原生缩放导致内容尺寸变化、非法/遗留 target 或矩形不一致会在 payload 修改前拒绝，要求面板重新应用。
无 targets 的旧稿沿用原流程，不推测透明边距。修正后的完整 frame/realFrame 沿用云端 v1 契约，
原始裁剪矩形保存在可选 `gameUI.nativeReferenceFrame` 中供 validationReference 对照，authoring.targets 不上传。
参考 PNG 保留原生裁剪内容，资源源 PNG 的尺寸与字节不变；Unity 实例实际绑定完整源资源，仍使用既有流程。

## 确定性构建

从独立仓库根目录执行。`--output` 是新的输出目录，ZIP 自动位于同名 `.zip`；已有输出拒绝覆盖。
构建不访问实装插件、不启动 Photoshop、不包含官方二进制。ZIP 排序、时间戳和文件权限固定，使用 STORED 压缩方式，
相同输入及 release 产生相同字节。`bundle.json` 记录全部文件哈希；校验值必须为 64 位小写十六进制 SHA-256，文件必须存在且为普通文件，实际文件清单必须一致。
相同 release 的内容变更不允许升级，必须新 release。

```sh
python3 -B gameui-delivery.py build --output '/绝对路径/新目录/gameui-test-0.4.0' --release '0.4.0-test'
```

先运行 `node Panel/build-panel.cjs /absolute/new/staging/GameUIAuthoring` 得到自包含 staging，再按以下入口归档：

```sh
python3 -B gameui-delivery.py build --output '/绝对路径/新目录/gameui-test-with-panel' --release '0.4.0-test-panel' --panel-staging '/绝对路径/A构建的Panel目录'
```

Panel staging 必须包含 manifest.json、index.html、panel.css、panel.js、README.md、gameui-core.js、gameui-ps.js、gameui-authoring.js 八个文件，
以及 manifest.main 指向的实际文件；manifest 需使用独立插件 ID 和 Photoshop host。panelIncluded 必须为布尔值，并与目录和文件清单一致。
构建时与安装读取时使用同一套完整校验；缺文件搭配 null 哈希仍明确拒绝，不会继续写入入口。CLI 禁止产生 Python bytecode 缓存污染包清单。

0.6.17 的面板构建包含 Adobe CCX 所需图标。可用 `Panel/build-panel.cjs <新绝对路径> --official-plugin <白名单原版绝对路径>` 生成集成版，并在 staging 中生成 `lanhu-runtime.js` 和 `lanhu-runtime.json`。原包来源 SHA、生成 SHA、测试项目及 API 版本由清单核对。内嵌运行时和原版目录适配器分别安装、分别验收。

ZIP 是可审查的交付归档，解压为目录后调用随包 CLI；不是已验证的 CCX 安装器，不应改名冒充 CCX。
不含 Panel 时 `panelIncluded=false`，这时只提供上传适配器；不能据此声称面板安装成功。

## 上传适配器安装、诊断、升级、卸载与回滚

由集成负责人统一安排。先关闭 Photoshop，再指定实际官方插件目录和独立的持久状态目录；完成后重新启动 Photoshop。
本 CLI 不控制/检查正在运行的宿主，不声称已观测宿主加载。状态目录须在插件之外，路径需为真实绝对路径（如 macOS 用 `/private/tmp`）。
状态目录保留原版备份和事务历史，卸载后也不删除它。不要在装有其它补丁、已有未托管增强模块的插件上强行安装。

```sh
python3 -B gameui-delivery.py diagnose --plugin '/绝对路径/官方插件目录' --state '/绝对路径/GameUI状态目录'
python3 -B gameui-delivery.py install --plugin '/绝对路径/官方插件目录' --state '/绝对路径/GameUI状态目录' --bundle '/绝对路径/解压的bundle'
python3 -B gameui-delivery.py upgrade --plugin '/绝对路径/官方插件目录' --state '/绝对路径/GameUI状态目录' --bundle '/绝对路径/新release的bundle'
python3 -B gameui-delivery.py uninstall --plugin '/绝对路径/官方插件目录' --state '/绝对路径/GameUI状态目录'
python3 -B gameui-delivery.py rollback --plugin '/绝对路径/官方插件目录' --state '/绝对路径/GameUI状态目录'
```

行为：

- 首次 install 需要白名单原版；重复相同 bundle 返回 already_installed；已有不同 bundle 必须显式 upgrade。
- upgrade 需要已托管安装且 release 内容身份不同；官方更新到未知版本后拒绝，不把旧增强自动套上新版本。
- uninstall 恢复固定原版 index.js，删除三份所管增强模块；重复返回 already_uninstalled。
- rollback 撤销最近一次成功 install/upgrade/uninstall，恢复该次之前的文件及逻辑状态；随后再次 rollback 返回 nothing_to_rollback。
- 诊断和任何变更先核对 manifest、原版备份、入口及三份增强模块。外部编辑任一所管文件、丢失文件、符号链接或备份损坏均拒绝覆盖。
  官方目录其他文件不被本 CLI 写入。
- 使用锁避免并行 CLI 写入；每个文件在同目录写临时文件、fsync、os.replace，变更前/后保存内容和哈希。
  安装/升级先模块后入口，卸载先入口后模块。多文件整体由日志恢复，并非断电下的整目录原子交换。
- 普通写入错误会回读并恢复此前状态；进程中断遗留 active.json 时，后续变更拒绝，必须先 recover。

```sh
python3 -B gameui-delivery.py recover --plugin '/绝对路径/官方插件目录' --state '/绝对路径/GameUI状态目录'
python3 -B gameui-delivery.py recover --plugin '/绝对路径/官方插件目录' --state '/绝对路径/GameUI状态目录' --clear-stale-lock
```

recover 恢复中断操作前的文件，且仅允许当前字节等于事务记录的 before/after；有第三方新改动时保留全部文件并拒绝。
`--clear-stale-lock` 仅在记录的 PID 已退出时解除锁，不终止进程。不要删除日志或手工覆盖备份来绕过拒绝。
`build-audit-patch.py` 保留只读补丁构建 API；原先 `--install/--restore` 明确拒绝，防止走无事务的旧安装流程。

## 独立 Panel 的宿主加载与分发（保留 B 实现阶段记录）

本任务未下载或安装 UXP Developer Tool（UDT），未控制 Photoshop，未生成/安装 CCX。
当前交付的独立面板路径是 A 的 staging（若打入 bundle 则为 `Panel/manifest.json`）。
试用加载按 Adobe UDT：开启宿主开发模式，在 UDT 添加该 manifest，选择 Load；升级 staging 后 Reload，移除时 Unload/Remove。
这些是官方文档支持的操作入口，本机是否能完成须由集成负责人实际观察，CLI 的 adapter 安装结果不代表 Panel 已加载。

Adobe 文档说明 Photoshop 分发包为 `.ccx`，通过 UDT Package 创建；对外分发前需有效插件 ID。
独立 CCX 通过 Creative Cloud 安装入口/双击安装，文档也列 UPIA。
本任务未核实本机 UPIA/CLI 的存在或可用性，未验证 CCX 打包、签名/信任及实际宿主加载，不将这些列为通过。
纯 JS 插件是否需要额外签名不由本交付推定；以正式分发流程和实际安装结果为准。

依据：[UDT Load](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/udt-walkthrough/)、
[Photoshop Package](https://developer.adobe.com/photoshop/uxp/guides/distribution/packaging-your-plugin/)、
[UXP Install](https://developer.adobe.com/uxp/guides/how-to/distribution/install/)。

## 专项测试与已知未验证项（历史范围）

```sh
node --test test-gameui.cjs test-export.cjs
GAMEUI_OFFICIAL_INDEX='/绝对路径/官方原版/index.js' node --test test-official-upload.cjs
GAMEUI_OFFICIAL_PLUGIN='/绝对路径/官方原版目录' python3 -B test-delivery.py
```

2026-11-17：Node 19 项通过（含实际官方 uploader 模块 harness）；Python 16 项通过。
Node harness 校验原始 SHA 后直接执行官方模块 70567，仅 stub OSS/MD5 外部依赖，保留其实际 awaiter/generator、
递归 bitmap 遍历与 JSON 序列化。已证明 Q=A、最终返回原捕获对象，满足 finalize 的进程内 WeakSet 检查；
没有自行 mock URL 遍历来替代原生算法。harness 同时验证含透明边距的 nested 实例经过真实上传处理后，
最终 JSON 保留恢复后的完整 target 及 nativeReferenceFrame；网络层被 stub，因此不等于真实上传通过。

Python 使用完整实装官方包的只读临时复制，验证 install/upgrade/uninstall/rollback、重复操作、未知版本/hash/seam 拒绝、
备份损坏和外部改动保护、写入故障恢复、模拟进程中断恢复及确定性归档；卸载后全目录文件哈希恢复，测试前后实装包全目录哈希一致。
第一次故障注入因升级样例仅变更一个文件，未触发第二次写入失败；修正样例为两文件变更后全部通过。
透明目标几何与损坏 XMP 补充通过 Node 19 项；随后安装包 null 哈希缺陷触发 Python 专项，修复后 16 项全部通过，
包括缺模块/null/坏哈希、Panel 必需清单与 main、实际目录清单和标志不一致拒绝，均核对拒绝后官方目录未变。未重建旧交付包。

本次未验证：UDT/CCX 实装及 Panel 加载；真实面板源读取与 PSD 保存重开；PS→蓝湖网络上传与云回读；
Unity 资源导入与 Prefab；真实软边美术、设备渲染及生产部署。上述由集成负责人集中执行，不能用本专项通过替代。
