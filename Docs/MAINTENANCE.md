# 开发源与集成快照

当前插件开发源是 `/Users/betta/Workspace/lanhu_ps_plugin`。本仓库维护 Panel、源快照/身份逻辑、官方上传适配器、交付 CLI、合成材料与专项测试。
Unity 实现仍归 Framework；Framework 的 `Scripts/Editor/UI/LanhuDesign/Tools~/Photoshop/` 保留可审查的插件集成快照。
不得在两处各自修改 runtime 后长期分叉。冻结接口见 [CONTRACT.md](CONTRACT.md)，首次导入来源见 [INTEGRATION-SOURCE.json](../INTEGRATION-SOURCE.json)。

## 一次变更

1. 在本仓专属分支/worktree 修改授权范围，保留其他开发者的编辑；代码改动与必要说明及时本地提交。
2. 按实际改动选择专项测试。纯说明修改不重跑既有完整 Node/Python、Unity 或宿主测试；迁移路径变化只验证 staging 依赖和相应 core/fixture。
3. 若需改变云端 schema、身份、源/目标几何或版本契约，先由集成负责人协调；不能擅自改冻结 [CONTRACT.md](CONTRACT.md)。
4. 记录实际执行命令、项目/版本、通过/未通过及证据位置。mock、原始官方模块离线 harness、宿主 API、真实面板点击和云端验收分别记账。

## 显式同步到 Framework

- 冻结经过审查的本仓 commit SHA，核对 Framework 当前插件快照与 Unity 侧契约。由集成负责人执行同步，不从未提交工作区复制。
- 仅同步清楚列出的插件文件及必要集成说明；不带 `.git`、安装 state、官方包、凭据、PSD、生成的 staging/dist 或本仓绝对路径改造。
- 在同步记录中写明：本仓源 SHA、原 Framework 快照 SHA、同步文件及哈希、文档路径映射、实际受影响验证，以及同步后的 Framework commit。
  可在本仓 `Docs/` 增加有日期的同步记录，并在 Framework 的集成台账记录同一来源。
- 本仓 `INTEGRATION-SOURCE.json.importedSourceFiles` 是首次导入原始证据，不能为掩盖后续差异重写；后续同步新增记录。
- 若发现 Framework 快照有紧急差异，先交负责人比较并回流本仓指定提交；禁止复制覆盖他人的未审查修复。
- Unity 项目验证、真实 PS/蓝湖上传与最终宿主安装均由负责人统一调度；本地提交不授权远程 push 或生产资源迁移。

## 构建与导出

从仓库根运行 `Panel/build-panel.cjs`，在源码树外生成新/空 staging；它原样复制三份共用模块到 Panel，使 Load 不需要 Framework。
`gameui-delivery.py build` 将审查过的 Panel staging 与上传适配器打入确定性 ZIP；每次内容变化使用新 release 和新输出路径，拒绝覆盖旧候选。
源码仓 `Docs/` 与 [验收快照](ACCEPTANCE.md) 提供维护/证据上下文；现有 bundle 固定清单不导出整个 Docs 目录，
解压包中的 DELIVERY 链接应结合对应源码提交查阅。迁移本身不改变打包清单或创建正式发布包。

Panel staging 自包含不代表 CCX 正式分发通过。UDT Load/Unload 与官方上传适配器的 install/upgrade/uninstall/rollback 是独立入口，
完整操作见 [DELIVERY.md](../DELIVERY.md)。实装已有托管增强时用原持久 state 和 `upgrade`，不要把增强目录当官方原版来跑测试。
