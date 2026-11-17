# 2026-11-17 独立开发回交：异步刷新候选 0.5.2

本轮修复了可独立复现的选择刷新时序问题，并提供未加载的候选。**首要的“展开资源菜单只见条目1”问题仍未定位、未关闭。** 不将刷新缺陷推定为该菜单问题的根因，不将离线选项测试表述为真实可见或可选择验收通过。

## 来源与改动

- 开发仓库：`/Users/betta/Workspace/lanhu_ps_plugin`；专属分支：`codex/resource-picker-20261117`，在同一工作目录开发，未创建额外 worktree。
- 接手 HEAD：`3858c5bf8b83f75d5bdee1d66359fe169224285d`；接手时工作区干净。
- 运行代码提交：`21c8f6435007d0329501616407e616d852df08b3`，包含 `Panel/panel.js`、`Panel/manifest.json`、`Panel/README.md`、`test-authoring.cjs` 四个文件。
- 后续仅文档提交增加本文件并更新 `Docs/ACCEPTANCE.md`；交付完整 SHA 见本轮最终回复及 `git log`。候选严格对应上述运行代码提交，不依赖未提交文件。

`refresh` 原先在 XMP 读取前就记住选择身份，读取后直接写回该选层的资源和默认尺寸；busy 期间的通知跳过。连续切层可能在刷新结束后仍显示旧选层；异步等待期间修改的宽高、资源设置及显式“新建”选择也可能被旧默认值覆盖。旧代码使用新回归用例进行负控，四项全部失败，具体值见原始日志。

本次刷新在读完 XMP / 文档冲突检查后重新核对当前选择，过期则读取最新选择，最终才提交界面状态。按选层身份与输入修订保留读取期间的编辑，未编辑字段仍继承默认值；销毁后忽略未完成结果。启动刷新进入既有 busy 管理，直接刷新动作不再重复读一遍 XMP。

源码 manifest 版本改为 `0.5.2`；测试 plugin ID 仍为 `com.bettagames.gameui.authoring.test`，同机私有目录路径不因 ID 变化而迁移。

## 协议与状态边界

冻结 `CONTRACT.md` 未改。`gameui-core.js`、`gameui-authoring.js`、`gameui-ps.js`、`gameui-export.js` 及安装构建脚本均未改。schemaVersion=1、持久身份、assetRef 不可变版本、sources/targets、capture/finalize 与上传门禁保持现有实现。

本轮未写 PSD、XMP 或真实私有 catalog，未加载/卸载候选，未安装或升级官方适配器，未上传蓝湖，未修改 Framework / Unity，未远程 push。仅通过 CUA 只读检查 PS 主窗；当前截图仍未包含 UXP 浮层，因此停止重复操作，没有使用 DevTools eval 或 DOM 事件代替面板操作。历史增强 0.4.4 的状态仍按原总控记录保留，本轮未重新诊断安装文件。

资源菜单仍需用户提供完整展开画面或新的可定位证据；本轮已请求可见文字及展开/收起状态的补充说明，尚未收到回复。不得为绕过问题重写目录、合并同名资源、默认选第一条，或宣称目录已丢失。此候选供审查刷新修复，不能当作菜单缺陷已修复的版本。

## 实际验证与证据

证据根目录（不入 git）：
`/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/ps-plugin`。

- `node --test test-authoring.cjs`：**41 pass / 0 fail**，新增四项覆盖输入与继承、显式新建选择、连续切层、关闭文档/销毁。日志：[authoring-tests.log](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/ps-plugin/authoring-tests.log)。使用模拟 Photoshop API / XMP / 目录与简化 DOM，不证明真实 UXP 菜单可见性、宿主时序或 Undo。
- 在证据目录 `baseline-negative-control` 放入同一份最终测试及必要模块，将 `Panel/panel.js` 替换为 `git show 3858c5bf8b83f75d5bdee1d66359fe169224285d:Panel/panel.js`，运行 `node --test --test-name-pattern='selection refresh' test-authoring.cjs`：预期 **0 pass / 4 fail，退出码1**。日志：[refresh-final-negative-control.log](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/ps-plugin/refresh-final-negative-control.log)。负控副本未写回源码。
- `node --check Panel/panel.js`、`node --check test-authoring.cjs`、`git diff --check 3858c5bf8b83f75d5bdee1d66359fe169224285d HEAD`：退出码0。manifest 升版后定点运行 `node --test --test-name-pattern='panel staging' test-authoring.cjs`：**1 pass / 0 fail**。日志：[syntax-diff-build-checks.log](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/ps-plugin/syntax-diff-build-checks.log)。该一项包含在前面的41项内，不机械相加为42项独立用例。
- 未改公共核心、导出或安装事务，不重跑 export / official uploader / delivery / Unity 全量；无新的真实面板、云端或 Unity 通过证据。

## 新候选与构建

实际入口仍是 `Panel/build-panel.cjs` 和 `gameui-delivery.py build`。下列 `EVIDENCE` 代指上述证据根目录；产物路径已存在，重新构建必须另选新/空路径，不能覆盖。

```sh
node Panel/build-panel.cjs "$EVIDENCE/candidate-0.5.2/GameUIAuthoring"
python3 -B gameui-delivery.py build --output "$EVIDENCE/gameui-0.5.2-test-panel-refresh" --release 0.5.2-test-panel-refresh --panel-staging "$EVIDENCE/candidate-0.5.2/GameUIAuthoring"
```

- staging：[GameUIAuthoring](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/ps-plugin/candidate-0.5.2/GameUIAuthoring/manifest.json)。实际 manifest.version=`0.5.2`，release=`0.5.2-test-panel-refresh`。
- [ZIP](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/ps-plugin/gameui-0.5.2-test-panel-refresh.zip)：170,222 字节；SHA-256：`4d8ee7a6cb80767493825eabae367fa7ae1f92ae0c5247c84a3eba73d436f007`。这是交付归档，未构建或验证 CCX。
- [文件清单与核对结果](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/ps-plugin/package-verification.json)：15 个内容文件均通过 SHA 校验，ZIP 内另有 `bundle.json`；ZIP 文件名/字节与目录完全一致。staging 的8个文件与指定提交一致，共用三模块原样复制。未带官方二进制、PSD、私有 catalog、凭据或安装 state。

## 总控最小回交步骤

1. 审查指定提交及文档提交。仅由总控按 `MAINTENANCE.md` 同步四个运行/测试文件到 Framework 快照并记录来源、哈希与 Framework commit。本轮没有进行同步，也不需要因本次面板改动重跑全部 Unity 用例。
2. **先补齐资源菜单真实证据。** 在现有0.5.1完整展开资源选择器，保存包括菜单边界、选项文字和面板上下文的画面；确认新建空值与两条不同完整 ref 的可见性和可选性。若仍只能看到条目1，保持 PSD/目录不变，将该证据交回插件开发处理；不要直接进入引用/上传以绕过此门槛。
3. 总控统一安排新候选 Load，保留旧0.5.1 staging与合法私有目录。快速切换隔离测试稿/图层并编辑尺寸，核对最终显示当前选层且输入未被异步覆盖，绑定层返回后显示自身引用与完整 target。新增修复仍需此真实宿主验证；不声称 Node 定时门闩能模拟全部 PS 通知。
4. 菜单可操作后，在 Second 已绑定 layer3 显式选择 First 的 `g-mwkenw8x-bu0gso0npyu@1`，主按钮一次应用 **192×96**。先做一次 Undo，核对像素和 XMP 同步回退，再重新显式引用/应用并正常 Cmd+S，关闭重开只读核对。First 保持既有180×40，无需重做。
5. 预期 Second document=`g-mwken3ke-883svpjmzmq`、artboard=`g-mwken3ke-l70ssitfne`、node=`g-mwken6wm-qvf008wypn` 不变，node.assetRef 与 First 相同；`authoring.sources[ref]` 保留64×48原始PNG，Point、九宫7/5/11/9。Second `targets[node]` 完整尺寸192×96；不删旧合法资源。新透明/软边、通知及其它未过UI门槛仍按原验收单执行。
6. PS 门槛通过后，由总控统一安排测试项目上传与回取：云端 gameUI 仍schemaVersion=1，不含authoring/uploadScope；sourceNodeId/image.url 指向原始1×RGBA资源，exportScale=1、width=64、height=48；实例保留validationReference，透明实例按原契约恢复完整frame/realFrame及nativeReferenceFrame。然后使用既有Unity workflow验证两稿公共Sprite GUID复用及重复稳定性，记录Point成本与最终官方插件恢复。此次候选不提供这些通过结论。

本轮没有需要恢复的真实PSD/目录/安装写入。若总控试用后回退面板，Unload新候选再Load保留的0.5.1 staging，沿用相同plugin ID并保留私有目录；官方适配器的恢复仍走原持久state及交付CLI，由总控安排，不覆盖增强安装目录。
