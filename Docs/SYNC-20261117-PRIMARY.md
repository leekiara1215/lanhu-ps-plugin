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

## 真实宿主启动缺陷与0.5.1修复

0.5.0 UDT Loaded后真实控制台出现 `create method is not defined for plugin`（panel.js:413）。plugin对象仅声明destroy，缺少必需create，初始化IIFE未执行；用户看到资源列表没有条目2。分类为实现缺陷和mock入口契约缺口，不归因UDT环境或目录丢失。两份保存PSD仍与旧验收值一致。

A13a091b90bf36b33824277e3421b4360f1db926c → 插件e0d1746bd52e40ff4379064776381c7cbf71778b → Framework e8f78087b959640f047db613ca7b1f77caf4acd8，只改Panel/panel.js和test-authoring.cjs，增加同步create并保留既有IIFE与destroy解绑。新增负控在未修runtime复现同一错误；主集成 `node --test --test-name-pattern='plugin lifecycle registration|panel startup show before delayed catalog load|selection notifications' test-authoring.cjs` 为4/4通过，语法/diff检查通过。没有重复全量或Unity。

新候选0.5.1，ZIP 168,023字节，SHA-256 `d7e6c7ad6e3b386785622c9599571e0bc8f5f1b83ec04760f6fce5012710fd50`，15清单文件及ZIP字节核对通过。0.5.0已实际Unload，0.5.1实际Load成功；只读UDT Elements确认Second layer3、继承Point九宫、条目1/2精确refs、primaryAction与默认折叠高级区。当前仅证明真实初始化/目录呈现修复，用户主按钮及保存后同ref仍待。原失败证据保留，[当前包记录](/Users/betta/.codex/visualizations/2026/11/17/01a1e8ae-131c-7b21-a7ef-6c0bbc5780d6/lanhu-production/final-package.json)、[定点输出](/Users/betta/.codex/visualizations/2026/11/17/01a1e8ae-131c-7b21-a7ef-6c0bbc5780d6/lanhu-production/lifecycle-fix-tests.log)、[失败原因](/Users/betta/.codex/visualizations/2026/11/17/01a1e8ae-131c-7b21-a7ef-6c0bbc5780d6/lanhu-production/host-0.5.0-initialization-failure.json)。

Adobe专门入口文档要求定义plugin对象时必须定义create：[官方entrypoints参考](https://github.com/AdobeDocs/uxp-photoshop/blob/main/src/pages/uxp-api/reference-js/modules/uxp/entry-points/entry-points.md)。

当前0.5.1仍有未解可见列表问题：用户明确确认“展开后也只有条目1”；只读真实Elements内却有新建空值、条目1与条目2完整ref。CUA截图仍不包含UXP浮层，停止重复捕获；不能把DOM存在选项宣称为可见列表/跨稿引用通过。待用户提供展开列表的可见截图或其它可定位的新证据后继续，期间不应用、不改目录/PSD、不按名称猜绑。
