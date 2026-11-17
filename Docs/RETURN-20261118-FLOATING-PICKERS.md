# 2026-11-18：统一下拉浮层与滚动边界 0.6.12

针对菜单展开推动下方内容、滚动裁剪及页签切换，团队、项目、分组、平台、设计倍数和采样共六个菜单统一使用滚动内容之外的绝对定位浮层。主内容高度和滚动范围不含菜单；菜单根据字段坐标选择上下展开，按内容视口限制宽高，随滚动/缩放重新定位，字段部分离开视口时关闭。菜单拥有自己的滚轮边界，点击菜单内部不会触发外部关闭。

主页签和上传/切图子页签共用切换逻辑，关闭菜单并结束内容/主滚动条拖动，分别保存、恢复并限制三个页面的滚动位置。浮层与原生输入框相交时隐藏输入编辑层，关闭或移开浮层后恢复，值不变；保留既有越界输入裁剪。这是针对 [Adobe记录的原生编辑层绘制限制](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/known-issues) 的处理。

仅修改面板、版本标识和相关测试。`gameui-*.js`、蓝湖host/运行时生成器、云端协议、测试项目门禁、PSD/XMP及Unity契约未改。

## 验证与边界

证据目录：`/Users/betta/.codex/visualizations/2026/11/18/lanhu-floating-pickers-0612`。

- `node --test --test-timeout=10000 test-authoring.cjs`：61通过，0失败/跳过。包括新增的浮层定位、可用高度、越界关闭、原生编辑层恢复、主/子页签滚动恢复及拖动释放。[日志](/Users/betta/.codex/visualizations/2026/11/18/lanhu-floating-pickers-0612/authoring-tests.log)。
- `GAMEUI_PLAYWRIGHT_MODULE=<Playwright Core路径> node --test test-panel-layout.cjs`：真实Chrome排版专项1通过，0失败/跳过。四种尺寸320×480、360×600、400×640、800×600，逐一展开六个菜单，比较字段/后续控件/内容高度/主滚动范围；验证浮层命中、原生输入遮挡、展开时缩放、向上展开、滚动跟随/越界关闭、滚轮边界和页签/键盘焦点。测试使用当前面板源文件与隔离业务桩，不访问真实账号、PSD或私有目录。[日志](/Users/betta/.codex/visualizations/2026/11/18/lanhu-floating-pickers-0612/browser-layout-tests.log)。
- `node --check Panel/panel.js`、`node --check test-panel-layout.cjs`、`git diff --check`：通过。
- 集成staging与源文件逐字节匹配，运行时SHA与构建元数据匹配，ZIP逐项与交付目录匹配。[构建核对](/Users/betta/.codex/visualizations/2026/11/18/lanhu-floating-pickers-0612/package-verification.json)。

当前没有重新加载Photoshop，也没有新的UXP实机通过结论。Chrome验证不代表原生编辑层、滚轮和键盘在Photoshop中的实际显示已验收。

## 候选

- [UDT加载入口](/Users/betta/.codex/visualizations/2026/11/18/lanhu-floating-pickers-0612/GameUIIntegrated/manifest.json)，插件ID沿用 `com.bettagames.gameui.authoring.test`，版本0.6.12，包含蓝湖业务运行时。
- [ZIP](/Users/betta/.codex/visualizations/2026/11/18/lanhu-floating-pickers-0612/gameui-0.6.12-test-floating-pickers.zip)，release=`0.6.12-test-floating-pickers`，SHA-256=`0a54c662e8beef5e0cd22c57b601e363ef44cc802a00aeef60db61d2d4c84fc5`。
- [320px平台浮层预览](/Users/betta/.codex/visualizations/2026/11/18/lanhu-floating-pickers-0612/lanhuDevice-320.png)，为Chrome隔离布局预览。

旧候选保留。本轮未安装、上传或修改PSD。后续宿主验收需加载上述新manifest，检查六菜单展开、底部向上、主滚动跟随/越界关闭、输入层恢复、主/子页签与键盘切换；不要将旧0.6.11加载状态视为本轮通过。
