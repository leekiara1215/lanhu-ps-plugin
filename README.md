# GameUI Photoshop 插件

此独立仓库是 Photoshop 插件的开发源，主工作目录为 `/Users/betta/Workspace/lanhu_ps_plugin`。
Framework 只保留经过审查的集成快照；后续从本仓库显式同步指定提交并记录双方 commit，禁止两份 runtime 各自发展。
导入来源为 Framework `e75e5263a309f91da13e80f6ca4795cefba942a8`，原始文件哈希见 [INTEGRATION-SOURCE.json](INTEGRATION-SOURCE.json)。

当前为隔离试用：独立美术面板维护 PNG 源快照、资源版本与实例，上传适配器接入蓝湖官方流程；仅允许测试项目
`cfea1199-7c07-48d9-86ef-cdbd3385c237`，尚未通过正式推广门槛。运行不依赖 Framework 目录；Unity 导入实现留在 Framework。

## 从这里开始

- 当前交互、模块职责及数据契约以设计主文档为准。插件代码和设计文档在同一次变更中同步。[插件设计与变更规则](Docs/DESIGN.md)
- [面板操作与支持范围](Panel/README.md)：仅 sRGB、8-bit RGB 普通像素层，源透明留白须明确填写。
- [蓝湖官方功能对照](Docs/LANHU-PARITY.md)：已接入、尚未复刻与真机验收边界。
- [交付、安装与恢复](DELIVERY.md)：固定官方插件版本与哈希、事务 CLI、升级及卸载。
- [当前验收快照](Docs/ACCEPTANCE.md)：实际 PS 证据与尚未通过的门槛。
- [PS 上传插件验收标准](Docs/PS-UPLOAD-ACCEPTANCE-STANDARD.md)：上传职责、可扩展元数据、逐项验收和放行条件。
- [冻结契约](Docs/CONTRACT.md)、[开发与集成同步](Docs/MAINTENANCE.md)、[迁移核对](Docs/MIGRATION.md)。
- [合成测试材料](Fixtures/README.md)、[原型历史记录](Docs/HISTORY.md)。

面板默认打开「上传」，普通切图从「切图」进入。收录源图走「资源 → 公共资源」，制作九宫格走「资源 → 九宫格资源」。新建或明确选择已有版本，填目标宽高后应用。已绑定时直接改宽高，使用 Photoshop 的正常保存方式保存 PSD。详见 [面板说明](Panel/README.md)。

## 构建与加载

0.6.17 的「公共资源」用于收录和导出原始源图。「九宫格资源」独立配置固定边、采样和目标尺寸，可复用同一源图版本。GitHub 的独立面板包包含这两个本地功能；需要蓝湖上传与切图时，用自己持有的固定原版按下文生成集成包。

命令从仓库根目录执行；构建/离线测试使用 Node.js，事务 CLI 使用 Python 3，无第三方包依赖。
Panel staging 必须在源码树外，目标目录须为新目录或空目录：

```sh
node Panel/build-panel.cjs /absolute/new/staging/GameUIAuthoring
```

基础输出包含面板运行文件、说明和 CCX 所需图标。用 Adobe UXP Developer Tool 添加输出的 `manifest.json` 后 Load；
UDT 与 Photoshop「设置 → 增效工具 → Enable Developer Mode」均须启用。Panel 要求 Photoshop >=25、API 2；
当前 PS28 / UDT2.4.0.2 已有加载证据。修改源码后重新构建到新目录，再由负责人 Reload/Load。
接收试用版的同事可双击 CCX，通过 Creative Cloud Desktop 安装。0.6.21 已在 macOS 的 Photoshop 28 验证安装。开发加载、安装包和官方目录适配器流程见 [交付说明](DELIVERY.md#隔离试用-ccx)。

构建带官方运行时的集成候选需显式提供经哈希校验的原版。

```sh
node Panel/build-panel.cjs /absolute/new/staging/GameUIIntegrated --official-plugin /absolute/pinned/original/lanhu
```

构建前验证原包SHA，在输出目录生成运行时与来源清单，不修改实装官方插件；详情、权限与未过门槛见[面板说明](Panel/README.md)。真实登录、Shadow界面、API2切图/上传及云端/Unity仍需总控验收。

归档入口如下，需使用新的 release 与输出路径；不包含官方二进制：

```sh
python3 -B gameui-delivery.py build --output /absolute/new/dist/gameui-candidate --release '<new-release>' --panel-staging /absolute/new/staging/GameUIAuthoring
```

## 离线测试

迁移定点检查只需面板 staging 依赖/拒绝覆盖和两个 core 用例：

```sh
node --test --test-name-pattern='panel staging contains standalone runtime and refuses destructive overwrite' test-authoring.cjs
node --test --test-name-pattern='large previews|undersized targets' test-gameui.cjs
```

开发时按改动选用 `test-authoring.cjs`、`test-export.cjs` 或 `test-production-fixtures.cjs`；
完整官方 uploader harness 与 Python 生命周期测试需明确提供白名单原版副本，见 [DELIVERY.md](DELIVERY.md)。
当前实装增强版本不能冒充原版输入。离线测试不会启动 PS/Unity，也不能替代实际面板、云端和设备验收。

## 适配器安装与恢复

先由集成负责人关闭 Photoshop，使用明确的插件目录、独立持久 state 和已审查 bundle。
已有托管增强用 `upgrade`，原版首次安装用 `install`；运行 `diagnose` 确认当前磁盘状态。
`uninstall` 恢复官方入口，`rollback` 撤销最近成功操作；中断事务先 `recover`。
每次变更后由负责人重新启动宿主。完整命令与外部改动拒绝规则见 [DELIVERY.md](DELIVERY.md)。
不在此仓提交官方包、PSD、凭据、安装状态、生成的 staging/dist；不自动推送或修改生产资源。
