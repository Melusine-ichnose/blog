import {
	type NavBarConfig,
	type NavBarLink,
	type NavBarSearchConfig,
	NavBarSearchMethod,
} from "../types/navBarConfig";

// ============================================================================
// 导航栏配置 - 根据顺序动态生成导航栏链接
// NavBar Configuration - Dynamically generate navigation bar links based on order
// ============================================================================
const getDynamicNavBarConfig = (): NavBarConfig => {
	// 基础导航栏链接
	const links: NavBarLink[] = [];

	// 主页
	links.push(LinkPresets.Home);

	// 学习
	links.push({
		name: "学习",
		url: "#",
		icon: "material-symbols:book",
		children: [
			// 归档
			LinkPresets.Archive,

			// 分类
			LinkPresets.Categories,

			// 标签
			LinkPresets.Tags,

			// 系列
			LinkPresets.Series,
		],
	});

	// 项目
	links.push({
		name: "项目",
		url: "#",
		icon: "material-symbols:rocket-launch",
		children: [
			// 项目展示
			LinkPresets.Projects,

			// 源码解析（指向归档页的源码解析分类筛选）
			{
				name: "源码解析",
				url: "/archive/?category=%E6%BA%90%E7%A0%81%E8%A7%A3%E6%9E%90",
				icon: "material-symbols:code",
			},
		],
	});

	// 银河漫游：Three.js 螺旋星系沉浸页（一级入口，整页加载不走 swup）
	links.push({
		name: "银河漫游",
		url: "/galaxy/",
		icon: "material-symbols:travel-explore",
	});

	// 娱乐（修仙 + 小游戏）
	links.push({
		name: "娱乐",
		url: "#",
		icon: "material-symbols:gamepad",
		children: [
			{
				name: "修仙面板",
				url: "/xiuxian/",
				icon: "material-symbols:stars",
			},
			{
				name: "贪吃蛇",
				url: "/snake/",
				icon: "material-symbols:score",
			},
			{
				name: "俄罗斯方块",
				url: "/tetris/",
				icon: "material-symbols:grid-view",
			},
			{
				name: "扫雷",
				url: "/minesweeper/",
				icon: "material-symbols:flag",
			},
		],
	});

	// 社交
	links.push({
		name: "社交",
		url: "#",
		icon: "material-symbols:group",
		children: [
			// 友链
			LinkPresets.Friends,

			// 留言
			LinkPresets.Guestbook,

			// 动态
			LinkPresets.Dynamic,
		],
	});

	// 关于
	links.push({
		name: "关于",
		url: "#",
		icon: "material-symbols:info",
		children: [
			// 关于页面
			LinkPresets.About,

			// GitHub
			{
				name: "GitHub",
				url: "https://github.com/Melusine-ichnose",
				external: true,
				icon: "fa7-brands:github",
			},
		],
	});

	// 文档链接
	// links.push({
	// 	name: "文档",
	// 	url: "https://docs-firefly.cuteleaf.cn",
	// 	external: true,
	// 	icon: "material-symbols:docs",
	// });

	return { links } as NavBarConfig;
};

// 导航搜索配置
export const navBarSearchConfig: NavBarSearchConfig = {
	method: NavBarSearchMethod.PageFind,
};

// ============================================================================
// 链接预设 - 可自由自定义导航栏链接的名称、图标和URL
// Link Presets - Allows free customization of the name, icon, and URL of navigation bar links
// ============================================================================
export const LinkPresets: Record<string, NavBarLink> = {
	Home: {
		name: "主页",
		url: "/",
		icon: "material-symbols:home",
	},
	Archive: {
		name: "归档",
		url: "/archive/",
		icon: "material-symbols:archive",
	},
	Categories: {
		name: "分类",
		url: "/categories/",
		icon: "material-symbols:folder-open-rounded",
	},
	Tags: {
		name: "标签",
		url: "/tags/",
		icon: "material-symbols:tag-rounded",
	},
	Series: {
		name: "系列",
		url: "/series/",
		icon: "material-symbols:layers",
	},
	Friends: {
		name: "友链",
		url: "/friends/",
		icon: "material-symbols:link-2-rounded",
		pageKey: "friends",
	},
	Guestbook: {
		name: "留言",
		url: "/guestbook/",
		icon: "material-symbols:chat",
		pageKey: "guestbook",
	},
	Dynamic: {
		name: "动态",
		url: "/dynamic/",
		icon: "material-symbols:forum-rounded",
		pageKey: "dynamic",
	},
	Projects: {
		name: "项目",
		url: "/projects/",
		icon: "material-symbols:rocket-launch",
		pageKey: "projects",
	},
	Gallery: {
		name: "相册",
		url: "/gallery/",
		icon: "material-symbols:photo-library",
		pageKey: "gallery",
	},
	Booknav: {
		name: "书签导航",
		url: "/booknav/",
		icon: "material-symbols:bookmarks",
		pageKey: "booknav",
	},
	Bilibili: {
		name: "哔哩哔哩",
		url: "/bilibili/",
		icon: "fa7-brands:bilibili",
		pageKey: "bilibili",
	},
	Bangumi: {
		name: "番组计划",
		url: "/bangumi/",
		icon: "material-symbols:movie",
		pageKey: "bangumi",
	},
	VNDB: {
		name: "VNDB",
		url: "/vndb/",
		icon: "material-symbols:chrome-reader-mode-rounded",
		pageKey: "vndb",
	},
	MAL: {
		name: "AnimeList",
		url: "/myanimelist/",
		icon: "material-symbols:menu-book",
		pageKey: "mal",
	},
	Sponsor: {
		name: "打赏",
		url: "/sponsor/",
		icon: "material-symbols:favorite",
		pageKey: "sponsor",
	},
	About: {
		name: "关于我",
		url: "/about/",
		icon: "material-symbols:person",
	},
};

export const navBarConfig: NavBarConfig = getDynamicNavBarConfig();
