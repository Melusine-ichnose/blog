# 交接文档（2026-09-26）

> 本文只覆盖在 Firefly 模板基础上二次开发的内容。模板通用说明见根目录 `AGENTS.md`。

## 1. 项目概览

- Astro 7 + Svelte 5（runes：`$state` / `$derived`）+ TypeScript 的个人博客
- 包管理：**pnpm**（preinstall 强制）；Node 22.23.0
- 部署：**Cloudflare Pages**，构建命令 `pnpm build`，输出 `dist`，环境变量 `NODE_VERSION=22.23.0`
- 部署后若改了 `siteConfig.ts` 的 `site_url`，需更新为实际 `*.pages.dev` 或自定义域名；线上更新后手机/浏览器用 **Ctrl+F5** 强刷（缓存激进）

## 2. 常用命令

```bash
pnpm dev        # 本地开发
pnpm check      # astro 诊断（改完必跑，要求 0 errors）
pnpm build      # 生产构建
pnpm preview    # 本地预览构建产物（默认 http://localhost:4321）
```

Windows 环境若找不到 node，PATH 前置：`F:\毕业设计\NVM\nodejs`。

## 3. 自定义模块（全部是 Svelte 单文件组件）

| 路由 | 组件 | 说明 |
| --- | --- | --- |
| `/xiuxian/` | `src/components/pages/XiuxianGame.svelte` | 修仙游戏（核心，约 5400 行） |
| `/galaxy/` | `src/components/pages/GalaxyScene.svelte` | 数字星河 3D 粒子动画（9 秒循环，鼠标牵引/点击） |
| `/snake/` | `src/components/pages/SnakeGame.svelte` | 贪吃蛇（Canvas，键盘 + 手机点按/滑动） |
| `/tetris/` | `src/components/pages/TetrisGame.svelte` | 俄罗斯方块（Canvas，屏幕方向键） |
| `/minesweeper/` | `src/components/pages/MinesweeperGame.svelte` | 扫雷 |

导航入口统一在 `src/config/navBarConfig.ts`。

### 修仙游戏结构要点（XiuxianGame.svelte）

- **常量集中在文件顶部**：境界链 `REALMS`（十三阶）、难度 `DIFFICULTY_CFG`、丹药 `PILLS`（五品 + 分类筛选）、功法 `MANUALS`、道侣 `COMPANIONS`、抉择事件由 `buildChoiceEvents()` 动态生成
- 存档：localStorage key `xiuxian_save_v6`，`SAVE_SCHEMA = 2`，旧档走 `migrateSchema()` 兜底；新增 PlayerState 字段时必须同步 `makeFreshPlayer` / `load` / `migrateSchema` / `doImport` 四处
- 战斗：回合制，`getEnemy()` 生成数值（v11 起含 1.1~1.5 倍强敌浮动），`simulateBattle()` 供事件复用，弹窗 `battle` 状态机：fighting / win / lose / retreat
- 弹窗用 `use:portal`；`modal-content` 固定实色底 `#2a3350`（勿改回主题变量，深色主题下会过暗）
- 突破：雷劫三道 → `doBreakthroughCheck()` → 「定神」小游戏（指针摆动，三次上限 +12%）→ `startBreakthroughRoll()` 结算
- 死亡：`die()` 只出本世总结，**无跨世继承**；`reincarnate()` 回难度选择重开
- 挂机修为有 1.5 倍瓶颈封顶（`capXpOverflow()`）；灵石/寿元结算在 `breathTick()` 与 `settleOffline()`
- 名词解释统一维护在 `GLOSSARY`（状态条 title + 「名词志」弹窗）

## 4. 内容更新

- 动态：Markdown 放 `src/content/dynamic/`，文件名 `YYYY-MM-DD-HHMMSS.md`，frontmatter 仅 `published` / `location`
- 文章：`src/content/posts/`，可用 `pnpm new-post`

## 5. 已知坑

1. **文件禁止 BOM 头**，否则 Astro 构建失败
2. XiuxianGame.svelte 使用 **TAB 缩进**且层级深，模板编辑前先核对实际缩进，勿凭目测
3. 工作区最外层 `E:\...\blog` 是个空 git 仓库；**真正的仓库在 `blog/blog`**，提交推送务必先进该目录（分支 `master`，远端 GitHub → Cloudflare 自动部署）
4. Cloudflare Pages 必须显式配置构建命令，否则会直接部署源码
5. 提交信息用 Conventional Commits（中文描述即可，如 `feat(xiuxian): ...`）

## 6. 近期版本

- v11（2026-09-26）：20 项反馈——抗雷丹药 bug、弹窗配色、抉择事件、去转生、挂机封顶、装备/灵虫买卖、功法丹药扩充、道侣性别/事件/死亡、强敌浮动与遁走、突破定神小游戏、名词志、贪吃蛇手机点按开局
- v10「黑暗轮回」：十三阶境界、三难度、寿元/业力/因果债/轮回、五品丹药、躯府灵虫、秘境黑市、道侣
