# 2026-11-17 接续：UXP控件原生外观覆盖修正0.6.5

后续两张实机截图暴露原生下拉仍深灰及滚动输入层覆盖顶部栏，最新已实载候选和验证边界见[0.6.6选择器与裁剪回交](RETURN-20261117-PICKERS-066.md)。本记录的“三处正常”限于当次用户确认范围。

仓库 `/Users/betta/Workspace/lanhu_ps_plugin`，分支 `codex/resource-picker-20261117`。运行代码完整提交 `e3413e7e37e0e910bc4c05f94386266569890457`。这是0.6.4全局主题的实际宿主问题修正，前序功能、协议与全链路回交见[自绘蓝湖工作区回交](RETURN-20261117-NATIVE-LANHU.md)。

## 实际问题与修正

用户提供0.6.4实机截图：外框和卡片已变浅色，但主按钮及页签仍为灰色胶囊，输入框仍有深色原生外观。这证明上一轮CSS/DOM回归不能代表实际控件样式通过。保留[用户原截图](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-controls-0.6.5/user-064-before.png)。

UXP原生控件绘制与普通浏览器CSS存在限制：[Adobe边框覆盖说明](https://developer.adobe.com/photoshop/uxp/2021/uxp/reference-css/Styles/border-style/index.html)、[Adobe工程师关于自定义按钮的说明](https://forums.creativeclouddeveloper.com/t/styling-buttons/1197)、[输入框appearance说明](https://forums.creativeclouddeveloper.com/t/native-inputs-have-appearance-bug/3116/2)。[近期同类宿主观察](https://forums.creativeclouddeveloper.com/t/uxp-ui-backend-update-in-photoshop-beta/11910/49)报告按钮原生外观可能覆盖CSS，作为旁证；不把另一环境报告当作本机内部引擎根因的证明。

- 将37个静态按钮/页签和动态资源行、检查操作统一为普通div自绘，保留原ID、页签角色、完整assetRef和操作入口。
- 集中实现disabled属性与aria-disabled/tabindex同步，鼠标和Enter/空格共用拦截。禁用不仅是视觉变灰，直接触发监听也不会执行；长按重复键不会重复操作。
- 输入框与下拉保留真实可编辑元素，添加appearance重置、不透明白底、前景/边框及高度的高优先级样式，保留选择和数值读取方式。
- 中文提示、资源身份、目录、上传适配和浏览器授权逻辑不改。没有更换plugin ID或迁移私有目录。

改动文件：`Panel/index.html`、`Panel/panel.css`、`Panel/panel.js`、`Panel/manifest.json`、`Panel/README.md`、`test-authoring.cjs`。冻结CONTRACT、四份gameui共用模块、compatibility，以及蓝湖host/生成器均与0.6.4来源逐字节一致。

## 验证与实际确认

```sh
node --test --test-timeout=10000 test-authoring.cjs
node --check Panel/panel.js
git diff --check
```

面板专项49/49通过，0失败/跳过。[实际日志](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-controls-0.6.5/authoring-tests.log)。覆盖既有创作/回滚/刷新/资源行/蓝湖联动及新控件的鼠标、键盘、ARIA和禁用行为。一个旧mock在改变上传状态后未通知界面，先前直接调用原生button监听绕过了disabled；修正为调用真实onChange路径，验证锁定与解锁后仍可重试。没有放松冻结校验。

HTML标签平衡、87个ID唯一，静态原生button为0；动态按钮也使用同一自绘工厂。构包12个Panel文件、19项bundle清单及ZIP/目录逐字节核对通过。生成蓝湖运行时与0.6.4完全相同，不重复运行未变的后端/云端/Unity套件，不将49与前序73机械相加。

实际UDT已Unload0.6.4，移除旧工作区注册后Add新路径，0.6.5显示 `Loaded / Plugin Load Successful`。只读Debug可见当前默认Console无消息、插件context已连接、No Issues；未执行eval或DOM事件。没有改官方实装目录，旧候选文件保留。

加载后用户针对同一目标尺寸区域明确回答“三处都已正常”，确认蓝色小圆角主按钮、非灰色胶囊页签、白底细边框输入框。这是用户实机确认，CUA本身仍未捕获UXP浮层像素；不外推所有控件/主题/尺寸或键盘路径均实机通过。[宿主与确认记录](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-controls-0.6.5/host-load-065-evidence.json)。

本轮没有应用、上传、切图、授权或PSD/XMP写入。两份既有合成PSD磁盘SHA与上次只读记录一致。

## 候选与最小回交

实际manifest.version=`0.6.5`，release=`0.6.5-test-custom-controls`，来源commit=`e3413e7e37e0e910bc4c05f94386266569890457`。

- [UDT manifest](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-controls-0.6.5/GameUIIntegrated/manifest.json)。
- [ZIP](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-controls-0.6.5/gameui-0.6.5-test-custom-controls.zip)，SHA-256=`d56017dea9449e99e22e3fdb9d2876806e1f02a66555fb996f08972ff61efc43`。
- [全部文件清单、哈希、大小及包核对](/Users/betta/.codex/visualizations/2026/11/17/01a1e8e3-bf08-7921-b31d-f142d4d9ec96/lanhu-controls-0.6.5/package-verification.json)。沿用build-panel和gameui-delivery入口，没有覆盖旧release或生成正式CCX。

原集成对话审查上述完整commit并显式同步后，使用当前0.6.5候选：先验证两页鼠标/键盘、禁用态、白底输入及顶部/底部滚动，再继续浏览器授权与既有PS保存重开/像素、隔离蓝湖上传回取和Unity公共Sprite复用验证。当前三处样式已获用户确认，不等于后续PS→蓝湖→Unity全链路通过。恢复旧候选可Unload并重新Add保留的0.6.4 manifest，不动私有目录和官方插件。
