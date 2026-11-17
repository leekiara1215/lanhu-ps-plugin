# 独立仓迁移核对

日期：2026-11-17。基线独立仓提交 `d2b1fcb4e89249ee6eac996a85dbece1347a2b23`，
来源 Framework `e75e5263a309f91da13e80f6ca4795cefba942a8`；完整原始文件哈希见 [INTEGRATION-SOURCE.json](../INTEGRATION-SOURCE.json)。
此轮只整理文档与入口，不修改运行时代码、测试逻辑、打包器或 Framework，不构建 0.4.5 发布包。

## 来源与差异

- 35 个导入文件中 32 个与导入 SHA-256 完全匹配；31 个非 Markdown 文件（runtime、测试、生成器、清单及辅助文件）全部匹配。
- 三份授权说明变化：根 `README.md` 改为独立仓入口；`DELIVERY.md` 修正契约路径并区分历史执行范围；
  `Fixtures/README.md` 改为独立仓根命令和本地验收链接，材料历史内容保留。
- 旧 README 的原型/早期验证正文迁入 [HISTORY.md](HISTORY.md)，仅调整交付说明的相对链接并增加历史上下文提示；不将历史成功外推到新面板闭环。
- 新增 [ACCEPTANCE.md](ACCEPTANCE.md)、[MAINTENANCE.md](MAINTENANCE.md) 及本迁移记录；不复制整个 Framework 验收台账制造第二份持续维护的总账。
- `Docs/CONTRACT.md` 与导入提交字节一致，SHA-256 `4c7e71ffc70f4b2271f41bc31bdb497347957c50d4c9bf2b97c2a3565ff94cc9`。
  `INTEGRATION-SOURCE.json` 原样保留，没有重写导入哈希以掩盖文档变化。

## 实际定点验证

项目路径：`/Users/betta/Worktrees/lanhu-ps-plugin-delivery-20261117`。执行通道为 Node 原生 test runner；
staging 用例只在临时目录构建并清理，未创建发布归档。

```sh
node --test --test-name-pattern='panel staging contains standalone runtime and refuses destructive overwrite' test-authoring.cjs
node --test --test-name-pattern='large previews|undersized targets' test-gameui.cjs
```

实际结果：第一条 `tests 1 / pass 1 / fail 0 / skipped 0`；第二条 `tests 2 / pass 2 / fail 0 / skipped 0`。
分别覆盖新仓根 staging 复制依赖与拒绝破坏性覆盖，以及 core 九宫角点/完整目标与非法尺寸拒绝。
未重跑历史全量 Node、Python 16 项或 Unity；未访问实装官方插件、控制 PS/Unity、改设置、安装或上传。

静态核对读取导入清单逐文件比较 SHA-256，结果为上述 31/31 非 Markdown 不变、32/35 导入文件一致；
同时与 `git show d2b1fcb:Docs/CONTRACT.md` 和 `git show d2b1fcb:INTEGRATION-SOURCE.json` 比较原始字节。
授权文档中的本地 Markdown 文件链接均检查实际存在，原 Framework 相对 `Docs~` 链接均已移除；保留明确的绝对主证据/RESULTS 链接。
提交前执行 `git diff --check`，只提交三份说明修改和四份新增 Docs 文档。
