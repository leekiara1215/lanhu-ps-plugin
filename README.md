# GameUI Photoshop 插件

此独立仓库是 Photoshop 插件的开发源，主工作目录为 `/Users/betta/Workspace/lanhu_ps_plugin`。
Framework 只保留经过审查的集成快照；后续从本仓库显式同步指定提交并记录双方 commit，禁止两份 runtime 各自发展。
导入来源为 Framework `e75e5263a309f91da13e80f6ca4795cefba942a8`，原始文件哈希见 [INTEGRATION-SOURCE.json](INTEGRATION-SOURCE.json)。

当前为隔离试用：独立美术面板维护 PNG 源快照、资源版本与实例，上传适配器接入蓝湖官方流程；仅允许测试项目
`cfea1199-7c07-48d9-86ef-cdbd3385c237`，尚未通过正式推广门槛。运行不依赖 Framework 目录；Unity 导入实现留在 Framework。

## 从这里开始

- [面板操作与支持范围](Panel/README.md)：仅 sRGB、8-bit RGB 普通像素层，源透明留白须明确填写。
- [交付、安装与恢复](DELIVERY.md)：固定官方插件版本与哈希、事务 CLI、升级及卸载。
- [当前验收快照](Docs/ACCEPTANCE.md)：实际 PS 证据与尚未通过的门槛。
- [冻结契约](Docs/CONTRACT.md)、[开发与集成同步](Docs/MAINTENANCE.md)、[迁移核对](Docs/MIGRATION.md)。
- [合成测试材料](Fixtures/README.md)、[原型历史记录](Docs/HISTORY.md)。

## 构建与加载

命令从仓库根目录执行；构建/离线测试使用 Node.js，事务 CLI 使用 Python 3，无第三方包依赖。
Panel staging 必须在源码树外，目标目录须为新目录或空目录：

```sh
node Panel/build-panel.cjs /absolute/new/staging/GameUIAuthoring
```

输出包含八个运行/说明文件。用 Adobe UXP Developer Tool 添加输出的 `manifest.json` 后 Load；
UDT 与 Photoshop「设置 → 增效工具 → Enable Developer Mode」均须启用。Panel 要求 Photoshop >=25、API 2；
当前 PS28 / UDT2.4.0.2 已有加载证据。修改源码后重新构建到新目录，再由负责人 Reload/Load。
ZIP 归档与 Panel 加载、官方上传适配器安装是不同步骤；CCX 正式分发尚未验证。

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
