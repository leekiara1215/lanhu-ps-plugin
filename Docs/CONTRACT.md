# GameUI 试用版冻结契约（2026-11-17）

负责人：当前集成对话。基线主仓 ced4ea56630d9929ddce80af79543620f86d4175；Framework b006c1a7f473d343904ca817160f9a64da6a0f44。治理 2026-08-31.2。

## 数据与接口

- 保持云端 gameUI schemaVersion=1；documentId / artboardId / nodeId 持久且与名称和位置无关。assetRef 是不可变资源版本身份，显示名称不是复用键。实例只继承资源级 sourceSize、nineSlice 和 sampling；同版本像素、尺寸、border、sampling 任一变化阻止并要求新版本。
- nineSlice 使用源像素整数 L/T/R/B，unit=sourcePixel、center=stretch；sampling 为 Point/Bilinear。显式 sampling 需要 sampling.v1，缺省 Bilinear。未知可选字段保留，未知 schema 或必需 capability 阻止，未标记旧稿沿原流程。
- 本地 XMP 延续 nodes[Photoshop layer ID] 与 assets[assetRef]。新增本地可选 authoring={version:1,sources:{[assetRef]:{width,height,pngBase64}}}，PNG 为 1× 8-bit RGBA 的原始源快照。面板自动维护，不要求美术手存小图或摆放样本。sourceSize 与 PNG 尺寸必须一致。authoring 不上传云端。
- 本地 authoring.targets[nodeId] 可选保存实例完整目标画布：{width,height,insetLeft,insetTop,contentWidth,contentHeight}，尺寸与内容尺寸为正整数、左上留白为非负整数且内容落在画布内；仅对应 image 标记。面板定义/应用后登记，复制/fork 重键，目录不携带 targets。capture 核对 native content frame 尺寸及可选 realFrame 后，以当前原生left/top减留白恢复完整 frame；不一致时拒绝并提示重新通过面板应用尺寸。原生裁剪参考保存在可选 gameUI.nativeReferenceFrame，local authoring 仍不上传。此修正由实际PS透明bounds裁切证据触发。
- 本地测试上传作用域 uploadScope={version:1,projectId:cfea1199-7c07-48d9-86ef-cdbd3385c237,purpose:gameui-productionization-test} 由面板维护；适配器消费并删除，旧未标记稿沿官方行为。资源目录复用 assets+authoring envelope，asset.displayName 可选，不参与身份或版本契约。
- 上传仍使用 capture(payload,config,documentId,formatter) / finalize(payload,config)。有 authoring source 时适配器注入原生源节点及 image.bitmap，原生上传后填写现有 sourceNodeId/image.url/exportScale=1；无 authoring 的既有原型仍兼容。根 nodes 映射不作为 Unity 资源身份依据。严格限定测试 projectId cfea1199-7c07-48d9-86ef-cdbd3385c237；不修改生产上传行为。
- 美术资源目录是面板维护的可携带目录文件，保存可理解名称、不可变 assetRef、资源契约和自动源快照。实例复制需生成新 nodeId，资源引用继承。无法确认来源的复制不得猜绑，提供检查和显式引用修复。
- Unity 沿用 workflow；新增单 Job 可选 gameUIResourceRoot 指定隔离公共登记根（Assets 下且属于已有 commonRoots/reuseRoots），不改共享 Profile。登记以 assetRef 和完整资源契约为准，实际资源通过 GUID 校验；缺失、冲突、采样/图集不符阻止，不按重名或像素推断身份。Point 保持独立纹理，首版记录 draw call 代价。

## 所有权

A：Tools~/Photoshop/Panel/**、gameui-authoring.js、gameui-ps.js、test-authoring.cjs。不要修改 export/core/installer。
B：Tools~/Photoshop/gameui-export.js、gameui-core.js（兼容保留现有 API）、build-audit-patch.py、交付安装构建脚本、兼容清单与安装专项测试。读取 A 的 sources 接口，无权另造 schema。
C：Editor/** 与 Tests/Editor/** 及对应 meta，Unity 导入和登记的实现、专项用例。不得操作任何 Unity Editor，提交后由负责人统一验证。
D：Docs~/Productionization/ 下除 CONTRACT.md、TASKS.md、RESULTS.md 外文档；Tools~/Photoshop/Fixtures/**、test-production-fixtures.cjs。不得改 A/B/C 文件。准备非对称、透明边缘、软边等合成测试；不伪造通过证据。
集成负责人：上述共享契约、台账、集成、Unity CLI、实际 PS/上传验证、最终结果与主仓/子模块提交。

## 验证冻结

Standard：必要为面板纯逻辑/身份与 PNG 测试、安装升级卸载回滚/拒绝未知版本测试、Unity 受影响契约/登记用例、所属程序集受控 build。集成必要为目标 Editor 核对后的专项测试及两份隔离 PSD 的面板保存重开/上传/取回/workflow Prefab/跨模块复用和重复稳定性。PS UI 需要人工时先准备环境后集中请求；未实际观察不能标通过。
条件：出现具体图集采样风险时检查真实图集；网络失败、缺资源、坏元数据、版本不兼容走专项故障恢复。可选：全量构建、Player/设备、多分辨率，未经具体风险不启动。

## 安全与交付

只操作隔离测试空间、合成 PSD 和独立测试输出，不修改共享 Profile/生产资源；三组未跟踪 LanhuGameUI*Audit 留存。官方插件安装前检查版本与文件哈希，失败保持或恢复原版；未知版本拒绝；无原子回滚证据不得称已安装验证。开发完成、可试用、正式推广分开；真实美术/设备不足列发布门槛。无远程推送。
