# 2026-11-17 接续：浅色选择器与输入层裁剪0.6.6

独立仓 `/Users/betta/Workspace/lanhu_ps_plugin`，分支 `codex/resource-picker-20261117`。运行代码完整commit=`bb0b9ffab5cab5a75897030db61e700417dd9ba0`。实际manifest.version=0.6.6，release=`0.6.6-test-pickers-clipping`，已在UDT加载成功。后端和冻结协议未改；不操作Framework/Unity，不远程push。

## 用户证据与处理

用户补充的两张0.6.5实机截图显示：原生select仍为深灰色；滚动后某个白色输入编辑层越过内容视口，覆盖固定蓝色头栏。此前对主按钮/页签/目标输入框“三处正常”的确认仍是当时事实，不能外推下拉和滚动层级已通过。

- [深灰选择器截图](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-pickers-0.6.6/user-065-gray-pickers.png)。
- [输入框覆盖顶部栏截图](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-pickers-0.6.6/user-065-editor-overlap.png)。

0.6.6不再使用原生select：团队、项目、分组、平台、设计倍数和采样共六个选择器采用自绘combobox/listbox，白底细边框、浅色禁用态，列表在内容区正常流内展开并独立滚动。仅展开一个；点击外部或Escape/Tab关闭，上下/Home/End导航，Enter/空格提交。状态快照相同时不重建已展开菜单。禁用字段与禁用项目无法提交，未登录不能选择团队/项目，错误项目仍由原host再次拒绝。

保留value/disabled读取方式和完整选项值：采样仍是Point/Bilinear，不按显示文字代替值；空分组仍为项目根目录；团队/项目/平台等提示项不当作可提交值，不自动猜选第一项。采样选择仅编辑当前表单，不写PSD；刷新期间编辑保护继续保留。

输入框仍使用原生编辑能力。在内容区scroll、布局和resize后检查编辑层几何；越过内容视口上下边界的输入设为不可见/透明，完整回到内容区时恢复。保留输入值、不重建字段、不清空表单、不写PSD或XMP。销毁时移除点击/滚动/resize监听并取消布局帧。这是针对原生编辑层越界的UI处理，不声称用z-index重新排列了宿主内部渲染层。部分剪裁的输入会在完整进入视口后才显示；实际键盘焦点/编辑与面板尺寸仍需宿主验收。

改动为 `Panel/panel.js`、`Panel/panel.css`、`Panel/index.html`、`Panel/manifest.json`、`Panel/README.md`、`test-authoring.cjs`。相对0.6.5，CONTRACT、四份gameui共用模块、compatibility、lanhu-host与运行时生成器逐字节一致。持久身份、assetRef不可变版本、source/target、capture/finalize及测试项目限制不变；生成蓝湖运行时SHA也与0.6.5一致。

## 实际验证

```sh
node --test --test-timeout=10000 test-authoring.cjs
node --check Panel/panel.js
git diff --check
```

面板专项 **52/52通过，0失败/跳过**。[实际日志](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-pickers-0.6.6/authoring-tests.log)。覆盖既有主流程/回滚/刷新/资源身份、鼠标和键盘选择、精确值与取消行为、禁用选项、状态刷新不关闭菜单、滚动后输入值恢复及监听清理。实际服务/宿主不包含在此离线harness里。

HTML标签平衡、87个静态ID唯一；静态button/select/option均为0，六个选择器由同一组件初始化。Panel仍12文件，bundle仍19项清单；构包和ZIP/目录逐字节核对通过。后端未变，不重跑其授权/上传/交付/Unity全量；不与前序测试机械相加。

UDT已Unload0.6.5、移除工作区旧路径注册并Add新manifest，观察到0.6.6 Loaded / Plugin Load Successful。只读Debug当前默认Console无消息，插件context已连接且显示No Issues；未eval或改变DOM。随后用户针对浅色细边框下拉与滚动后不再遮挡蓝色顶部栏，明确回复“两处都已正常”。这是两项用户实机确认；CUA仍未捕获PS浮层像素，不外推全部选项/键盘/编辑路径均已实机通过。

未由代理应用、上传、切图、授权或修改PSD；两份既有PSD磁盘SHA与0.6.5只读基线相同。[宿主与磁盘核对](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-pickers-0.6.6/host-load-066-evidence.json)。

## 候选与最小回交

- [已加载UDT manifest](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-pickers-0.6.6/GameUIIntegrated/manifest.json)。
- [交付ZIP](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-pickers-0.6.6/gameui-0.6.6-test-pickers-clipping.zip)，SHA-256=`0a70d4f078c5632b8af7f327e11c02a48dd25443fbf99090da7e3d93ed06dec2`。
- [完整文件清单、大小、逐项SHA和包核对](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-pickers-0.6.6/package-verification.json)。沿用build-panel/gameui-delivery入口，不覆盖旧候选或同release换内容。

原集成对话审查该完整commit并显式同步后，使用当前0.6.6：先不写PSD，确认六个选择器浅色外观、禁用态与鼠标/键盘、列表滚动、顶部栏无输入遮挡，以及目标宽高滚回后值保留；再继续[前序回交](RETURN-20261117-NATIVE-LANHU.md)中的浏览器授权、两稿PS保存重开/像素、固定测试项目蓝湖上传回取和Unity公共Sprite复用。当前UI回归不代表全链路通过。恢复时可Unload并重新Add保留的0.6.5候选，不动原目录/PSD/官方插件。
