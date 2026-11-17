# 2026-11-17 主流程集成记录

独立插件源提交 `4034d1fef2db2dd66a9a0d5db818564573f52cdc`（A 原提交 `2c374969289a84fe4260b6342b0fb0926ce8854b`）。Framework 前置 `4723d8bb7e9b7b23ab3694b1bf8754838917ec09`，集成提交 `b8ddb3eb8f2ab8e531bd3d30c51bf536c4c6cef1`。B 的独立说明 b60a5f2 保留；首次导入哈希不改写。

只同步 `Panel/index.html`、`Panel/panel.css`、`Panel/panel.js`、`Panel/README.md`、`test-authoring.cjs` 到 Framework `Tools~/Photoshop/` 同名路径。逐文件 SHA-256 与运行时不变检查见 [framework-sync.json](/Users/betta/.codex/visualizations/2026/11/17/01a1e8ae-131c-7b21-a7ef-6c0bbc5780d6/lanhu-production/framework-sync.json)。主按钮沿用 gameui-ps 的源捕获/九宫/目标记录与 modal history，未改 schema、导出/上传适配器或 Unity；官方实装增强继续为 0.4.4。

主集成在插件主树执行 10 项受影响用例：

```sh
node --test --test-name-pattern='primary action|selection notifications|panel actions initialize, define, apply and controlled copy|panel rejects a trimmed duplicate display name|panel distinguishes existing and imported same-name|panel name update keeps identity/source and publishing' test-authoring.cjs
```

结果 10 pass / 0 fail，`node --check Panel/panel.js` 与 diff 检查通过。[原始输出](/Users/betta/.codex/visualizations/2026/11/17/01a1e8ae-131c-7b21-a7ef-6c0bbc5780d6/lanhu-production/minimal-authoring-tests.log)。没有重复全量或 Unity。

候选 `0.5.0-test-panel` 从该提交构建，staging manifest.version 明确设为 0.5.0，三份共享模块原样复制。[包与清单记录](/Users/betta/.codex/visualizations/2026/11/17/01a1e8ae-131c-7b21-a7ef-6c0bbc5780d6/lanhu-production/final-package.json)：ZIP 167,990 字节，SHA-256 `bb4ae681f8fc7823d8beb06473b456167e186382595e24436e5bdedfb608130e`，15 个清单文件及 ZIP 字节核对通过。UDT 添加此 staging manifest 后实际显示 Loaded 与 Plugin Load Successful；这只证明新版加载，不代表主按钮操作通过。

当前新主流程的真实点按、跨稿同 ref、单次 Undo、通知时序仍待验证；既有 First 180×40 不重做。仅请求 Second 显式选 First ref `g-mwkenw8x-bu0gso0npyu@1`，一次主按钮应用 192×96 并 Cmd+S，随后独立检查 doc/node 稳定性。不得按同名或像素合并，也不删除合法未使用目录项。新上传与真实新素材 Unity 闭环、CCX/美术/设备和最终宿主恢复仍保留门槛。
