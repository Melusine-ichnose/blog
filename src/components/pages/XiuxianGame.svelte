<script lang="ts">
// 修仙修炼游戏核心组件 v3
// 创角（灵根选择 + 体质转盘）+ 持续打坐 + 雷劫渡劫 + 心魔劫 + 丹药体系
// 数据存储在 localStorage，纯前端实现

import { onDestroy } from "svelte";

// ==================== 类型定义 ====================

/** 境界定义 */
interface Realm {
	name: string;
	level: number;
	requiredXp: number;
	description: string;
	/** 突破至此境界是否触发雷劫（金丹期及以后） */
	thunderTrial: boolean;
}

/** 丹药定义 */
interface Pill {
	id: PillId;
	name: string;
	color: string;
	desc: string;
	cost: number;
}

type PillId = "juqi" | "ningshen" | "pojing" | "tianyuan";

/** 灵根定义 */
interface SpiritRoot {
	id: string;
	name: string;
	color: string;
	desc: string;
}

/** 体质定义（转盘产出） */
interface Physique {
	id: string;
	name: string;
	color: string;
	desc: string;
	weight: number; // 转盘权重
	xpMult: number; // 修为收益倍率
	breakBonus: number; // 突破/渡劫成功率加成
	demonProbDelta: number; // 心魔概率增减
	thunderLossMult: number; // 雷劫失败损失倍率
}

/** 玩家状态 */
interface PlayerState {
	xp: number;
	realmIndex: number;
	lastBreakthrough: string | null;
	totalBreaths: number; // 累计打坐息数
	pills: Record<PillId, number>;
	ningshenLeft: number; // 凝神丹剩余加成息数
	pojingActive: boolean; // 破境丹 buff（下次突破生效）
	spiritualRoot: string | null; // 灵根 id，null 表示未创角
	physique: string | null; // 体质 id
	thunderPassed: number; // 累计渡过天雷数
	log: LogEntry[];
}

/** 日志条目 */
interface LogEntry {
	time: string;
	message: string;
	type: "info" | "success" | "danger" | "warning";
}

// ==================== 常量 ====================

/** 九大境界 */
const REALMS: Realm[] = [
	{ name: "炼气期", level: 1, requiredXp: 100, description: "初入修仙之门，吐纳天地灵气", thunderTrial: false },
	{ name: "筑基期", level: 2, requiredXp: 300, description: "筑基成功，寿元增至两百载", thunderTrial: false },
	{ name: "金丹期", level: 3, requiredXp: 800, description: "凝结金丹，可御剑飞行", thunderTrial: true },
	{ name: "元婴期", level: 4, requiredXp: 2000, description: "元婴出窍，神识覆盖千里", thunderTrial: true },
	{ name: "化神期", level: 5, requiredXp: 5000, description: "化神归一，可移山填海", thunderTrial: true },
	{ name: "合体期", level: 6, requiredXp: 12000, description: "天人合一，万法归宗", thunderTrial: true },
	{ name: "渡劫期", level: 7, requiredXp: 30000, description: "渡九九天劫，成就不灭之躯", thunderTrial: true },
	{ name: "大乘期", level: 8, requiredXp: 80000, description: "大乘圆满，可破碎虚空", thunderTrial: true },
	{ name: "飞升境", level: 9, requiredXp: Infinity, description: "飞升仙界，与天地同寿", thunderTrial: true },
];

/** 丹药体系 */
const PILLS: Pill[] = [
	{ id: "juqi", name: "聚气丹", color: "#34d399", desc: "服下立即获得 80 点修为", cost: 120 },
	{ id: "ningshen", name: "凝神丹", color: "#60a5fa", desc: "接下来 30 息修炼收益翻倍", cost: 400 },
	{ id: "pojing", name: "破境丹", color: "#c084fc", desc: "突破+25%；渡劫时可祭出抵挡一道天雷", cost: 1000 },
	{ id: "tianyuan", name: "天元丹", color: "#fbbf24", desc: "服下立即获得 600 点修为", cost: 2000 },
];

/** 五行灵根（创角时选择） */
const SPIRIT_ROOTS: SpiritRoot[] = [
	{ id: "jin", name: "金灵根", color: "#eab308", desc: "锋锐无匹 · 突破与渡劫成功率 +5%" },
	{ id: "mu", name: "木灵根", color: "#22c55e", desc: "生生不息 · 机缘概率翻倍（6%→12%）" },
	{ id: "shui", name: "水灵根", color: "#3b82f6", desc: "上善若水 · 打坐修为收益 +20%" },
	{ id: "huo", name: "火灵根", color: "#ef4444", desc: "焚魔炼心 · 心魔造成的损失减半" },
	{ id: "tu", name: "土灵根", color: "#a8a29e", desc: "不动如山 · 心魔概率减半（6%→3%）" },
];

/** 体质（创角转盘抽取） */
const PHYSIQUES: Physique[] = [
	{ id: "fantai", name: "凡体", color: "#9ca3af", desc: "芸芸众生，大道靠己", weight: 50, xpMult: 1, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "lingti", name: "灵体", color: "#34d399", desc: "天生近道 · 修为收益 +15%", weight: 26, xpMult: 1.15, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "daoti", name: "道体", color: "#60a5fa", desc: "道韵天成 · 突破与渡劫 +8%", weight: 14, xpMult: 1, breakBonus: 0.08, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "hundun", name: "混沌体", color: "#c084fc", desc: "收益 +30%，但心魔概率 +5%（祸福相依）", weight: 8, xpMult: 1.3, breakBonus: 0, demonProbDelta: 0.05, thunderLossMult: 1 },
	{ id: "daotai", name: "先天道胎", color: "#fbbf24", desc: "万古无一 · 收益 +50%，突破 +10%，雷劫损失减半", weight: 2, xpMult: 1.5, breakBonus: 0.1, demonProbDelta: 0, thunderLossMult: 0.5 },
];

/** 修炼文案（低频输出，避免刷屏） */
const CULTIVATE_TEXTS = [
	"你盘膝而坐，吐纳天地灵气...",
	"灵气入体，经脉微微发热...",
	"你运转周天，灵力缓缓增长...",
	"一缕紫气东来，被你炼化吸收...",
	"灵台清明，心境澄澈...",
	"丹田之中，灵力如江河奔涌...",
];

/** 机缘事件：修为倍率 + 概率掉落丹药 */
const FORTUNE_EVENTS = [
	{ text: "你发现了一株百年灵药，修为大涨！", xpMultiplier: 3 },
	{ text: "你在古洞府中领悟了前辈留下的功法，修为大增！", xpMultiplier: 5 },
	{ text: "你参悟了天地法则，顿悟之下修为大进！", xpMultiplier: 6 },
	{ text: "你捡到了一块灵石，吸收后修为提升！", xpMultiplier: 2 },
	{ text: "有高人路过，见你资质不俗，随手点拨了一番！", xpMultiplier: 4 },
];

/** 雷劫文案 */
const THUNDER_TEXTS = [
	"乌云压顶，第一道天雷轰然劈落！",
	"雷光如龙，第二道天雷撕裂长空！",
	"紫霄神雷，第三道天雷携毁天灭地之势砸下！",
];

// ==================== 状态 ====================

const EMPTY_PILLS: Record<PillId, number> = { juqi: 0, ningshen: 0, pojing: 0, tianyuan: 0 };

let player = $state<PlayerState>({
	xp: 0,
	realmIndex: 0,
	lastBreakthrough: null,
	totalBreaths: 0,
	pills: { ...EMPTY_PILLS },
	ningshenLeft: 0,
	pojingActive: false,
	spiritualRoot: null,
	physique: null,
	thunderPassed: 0,
	log: [],
});

let isMeditating = $state(false); // 是否持续打坐中
let lastGain = $state<number | null>(null); // 最近一息获得的修为
let breathGlow = $state(false); // 打坐呼吸动画开关
let showBreakthroughModal = $state(false);
let breakthroughResult = $state<"idle" | "success" | "fail">("idle");
let lastSuccessRate = $state(0); // 弹窗里展示的本次成功率

// ---- 创角状态 ----
let selectedRoot = $state<string | null>(null); // 创角界面已选灵根
let wheelSpinning = $state(false); // 转盘转动中
let wheelResult = $state<Physique | null>(null); // 转盘结果
let wheelIndex = $state(0); // 转盘高亮指针

// ---- 雷劫状态 ----
let showThunderModal = $state(false);
let thunderRound = $state(0); // 当前第几道雷（0=未开始，1-3）
let thunderResults = $state<("pending" | "pass" | "fail")[]>([]); // 每道雷结果
let thunderStriking = $state(false); // 雷击动画中
let thunderPenalty = $state(0); // 雷劫失败累计降低的突破率

// ---- 心魔劫状态 ----
let showDemonModal = $state(false);
let demonResolving = $state(false);

// ==================== 计算属性 ====================

const currentRealm = $derived(REALMS[player.realmIndex]);
const nextRealm = $derived(REALMS[player.realmIndex + 1] ?? null);
const progressPercent = $derived(
	nextRealm
		? Math.min(100, Math.round((player.xp / nextRealm.requiredXp) * 100))
		: 100,
);
const canBreakthrough = $derived(Boolean(nextRealm && player.xp >= nextRealm.requiredXp));

/** 是否需要创角（有灵根体质才算完成） */
const needCreation = $derived(!player.spiritualRoot || !player.physique);

const currentRoot = $derived(SPIRIT_ROOTS.find((r) => r.id === player.spiritualRoot) ?? null);
const currentPhysique = $derived(PHYSIQUES.find((p) => p.id === player.physique) ?? null);

/** 灵根加成辅助 */
const rootBreakBonus = $derived(player.spiritualRoot === "jin" ? 0.05 : 0);
const rootXpMult = $derived(player.spiritualRoot === "shui" ? 1.2 : 1);
const rootFortuneProb = $derived(player.spiritualRoot === "mu" ? 0.12 : 0.06);
const rootDemonProb = $derived(
	(player.spiritualRoot === "tu" ? 0.03 : 0.06) + (currentPhysique?.demonProbDelta ?? 0),
);
const rootDemonLossMult = $derived(player.spiritualRoot === "huo" ? 0.5 : 1);

/** 突破成功率：目标境界越高越难，保底 30%；灵根/体质/破境丹加成 */
const successRate = $derived.by(() => {
	if (!nextRealm) return 0;
	const base = Math.max(0.3, 0.9 - nextRealm.level * 0.06);
	const bonus =
		rootBreakBonus +
		(currentPhysique?.breakBonus ?? 0) +
		(player.pojingActive ? 0.25 : 0);
	return Math.min(0.95, base + bonus);
});

/** 每息基础修为：随境界增长，水灵根与体质加成 */
const breathXp = $derived(
	Math.round((5 + currentRealm.level * 3) * rootXpMult * (currentPhysique?.xpMult ?? 1)),
);

// ==================== 持久化 ====================

const STORAGE_KEY = "xiuxian_save_v3";
const LEGACY_KEYS = ["xiuxian_save_v2", "xiuxian_save_v1"];

function save() {
	if (typeof localStorage !== "undefined") {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(player));
	}
}

function load() {
	if (typeof localStorage === "undefined") return;
	const raw = localStorage.getItem(STORAGE_KEY);
	if (raw) {
		try {
			const data = JSON.parse(raw);
			player = { ...player, ...data, pills: { ...EMPTY_PILLS, ...(data.pills ?? {}) } };
		} catch {
			// 存档损坏，使用默认值
		}
		return;
	}
	// 迁移旧档：继承修为、境界、丹药，灵根体质需补测
	for (const key of LEGACY_KEYS) {
		const oldRaw = localStorage.getItem(key);
		if (oldRaw) {
			try {
				const old = JSON.parse(oldRaw);
				player.xp = old.xp ?? 0;
				player.realmIndex = old.realmIndex ?? 0;
				player.lastBreakthrough = old.lastBreakthrough ?? null;
				player.totalBreaths = old.totalBreaths ?? old.totalCultivations ?? 0;
				player.pills = { ...EMPTY_PILLS, ...(old.pills ?? {}) };
				player.ningshenLeft = old.ningshenLeft ?? 0;
				player.log = old.log ?? [];
				addLog("检测到旧存档，修为与丹药已继承，请补测灵根与体质。", "warning");
				save();
				return;
			} catch {
				// 旧档损坏则忽略
			}
		}
	}
}

// 初始化
load();

// ==================== 游戏逻辑 ====================

function addLog(message: string, type: LogEntry["type"] = "info") {
	const time = new Date().toLocaleString("zh-CN");
	player.log = [{ time, message, type }, ...player.log].slice(0, 50);
}

// ---------- 创角：灵根 + 体质转盘 ----------

function selectRoot(id: string) {
	if (player.spiritualRoot) return; // 已有灵根不可重选（防刷）
	selectedRoot = id;
}

/** 转盘：加权随机抽体质，带滚动动画 */
function spinWheel() {
	if (wheelSpinning || !selectedRoot || player.physique) return;
	wheelSpinning = true;
	wheelResult = null;

	// 加权随机
	const total = PHYSIQUES.reduce((s, p) => s + p.weight, 0);
	let roll = Math.random() * total;
	let result = PHYSIQUES[0];
	for (const p of PHYSIQUES) {
		roll -= p.weight;
		if (roll <= 0) {
			result = p;
			break;
		}
	}
	const targetIndex = PHYSIQUES.indexOf(result);

	// 滚动动画：先快速循环，逐渐减速停在结果上
	let step = 0;
	const totalSteps = 20 + targetIndex; // 至少滚 4 圈
	const interval = setInterval(() => {
		wheelIndex = step % PHYSIQUES.length;
		step += 1;
		if (step > totalSteps) {
			clearInterval(interval);
			wheelIndex = targetIndex;
			wheelSpinning = false;
			wheelResult = result;
		}
	}, 60 + Math.min(400, step * step * 1.2)); // 越来越慢
}

/** 确认创角：写入灵根体质 */
function confirmCreation() {
	if (!selectedRoot || !wheelResult || player.spiritualRoot) return;
	player.spiritualRoot = selectedRoot;
	player.physique = wheelResult.id;
	const root = SPIRIT_ROOTS.find((r) => r.id === selectedRoot);
	addLog(`天命已定！你身怀「${root?.name}」，测得体质「${wheelResult.name}」。${wheelResult.desc}`, "success");
	if (player.xp > 0 || player.realmIndex > 0) {
		addLog("旧日修为犹在，新的修行路就此展开。", "info");
	} else {
		addLog("你踏上修仙之路，先从打坐吐纳开始吧。", "info");
	}
	save();
}

// ---------- 打坐 ----------

/** 每息修炼 tick（持续打坐时每 2 秒触发一次） */
function breathTick() {
	// 基础收益 + 随机浮动
	let xpGain = breathXp + Math.floor(Math.random() * (breathXp * 0.6 + 1));

	// 凝神丹 buff：双倍收益
	if (player.ningshenLeft > 0) {
		xpGain *= 2;
		player.ningshenLeft -= 1;
	}

	// 随机事件
	const roll = Math.random();
	if (roll < rootFortuneProb) {
		// 机缘：修为倍率 + 40% 掉落丹药
		const event = FORTUNE_EVENTS[Math.floor(Math.random() * FORTUNE_EVENTS.length)];
		xpGain *= event.xpMultiplier;
		if (Math.random() < 0.4) {
			const pill = PILLS[Math.floor(Math.random() * PILLS.length)];
			player.pills[pill.id] += 1;
			addLog(`${event.text} 并获得一颗「${pill.name}」！`, "success");
		} else {
			addLog(event.text, "success");
		}
	} else if (roll > 1 - rootDemonProb) {
		// 心魔劫：暂停打坐，弹出抉择
		stopMeditation();
		showDemonModal = true;
		demonResolving = false;
		addLog("心魔骤起！你的打坐被迫中断，必须立刻做出抉择...", "danger");
	} else if (Math.random() < 0.12) {
		// 普通息低频输出文案，避免日志刷屏
		addLog(CULTIVATE_TEXTS[Math.floor(Math.random() * CULTIVATE_TEXTS.length)]);
	}

	player.xp += xpGain;
	player.totalBreaths += 1;
	lastGain = xpGain;
	save();
}

/** 心魔劫抉择：挥剑斩之（70% 得双倍收益，失败损修为） */
function fightDemon() {
	if (demonResolving) return;
	demonResolving = true;
	if (Math.random() < 0.7) {
		const gain = breathXp * 2;
		player.xp += gain;
		addLog(`你一剑斩灭心魔，心境愈发通透，反获 ${gain} 点修为！`, "success");
	} else {
		const loss = Math.floor(player.xp * 0.1 * rootDemonLossMult);
		player.xp = Math.max(0, player.xp - loss);
		addLog(`心魔反噬！你强行压制，损失 ${loss} 点修为。`, "danger");
	}
	setTimeout(() => {
		showDemonModal = false;
		save();
	}, 1200);
}

/** 心魔劫抉择：避其锋芒（无损，打坐保持停止） */
function avoidDemon() {
	if (demonResolving) return;
	demonResolving = true;
	addLog("你收功避魔，道心无损，待心神平复可再度入定。", "warning");
	setTimeout(() => {
		showDemonModal = false;
		save();
	}, 800);
}

/** 开始 / 暂停持续打坐 */
let breathTimer: ReturnType<typeof setInterval> | null = null;

function toggleMeditation() {
	if (isMeditating) {
		stopMeditation();
		addLog("你收功止息，结束了这一轮打坐。");
		save();
		return;
	}
	isMeditating = true;
	breathGlow = true;
	breathTimer = setInterval(breathTick, 2000);
	addLog("你盘膝入定，开始持续吐纳。");
	save();
}

function stopMeditation() {
	isMeditating = false;
	breathGlow = false;
	if (breathTimer) {
		clearInterval(breathTimer);
		breathTimer = null;
	}
}

// 组件销毁时清掉定时器
onDestroy(() => {
	stopMeditation();
});

// ---------- 丹药 ----------

/** 使用丹药 */
function usePill(pill: Pill) {
	if (player.pills[pill.id] <= 0) return;
	player.pills[pill.id] -= 1;

	switch (pill.id) {
		case "juqi":
			player.xp += 80;
			addLog("你服下一颗聚气丹，灵力增长 80 点。", "success");
			break;
		case "ningshen":
			player.ningshenLeft += 30;
			addLog("你服下一颗凝神丹，接下来 30 息修炼收益翻倍。", "success");
			break;
		case "pojing":
			player.pojingActive = true;
			addLog("你服下一颗破境丹，下次突破成功率大增。", "success");
			break;
		case "tianyuan":
			player.xp += 600;
			addLog("你服下一颗天元丹，修为暴涨 600 点！", "success");
			break;
	}
	save();
}

/** 炼丹坊：用修为兑换丹药 */
function buyPill(pill: Pill) {
	if (player.xp < pill.cost) return;
	player.xp -= pill.cost;
	player.pills[pill.id] += 1;
	addLog(`你耗费 ${pill.cost} 修为，炼制出一颗「${pill.name}」。`);
	save();
}

// ---------- 突破与雷劫 ----------

/** 尝试突破：大境界（金丹及以后）先渡三道天雷 */
function attemptBreakthrough() {
	if (!canBreakthrough || !nextRealm) return;
	lastSuccessRate = successRate;

	if (nextRealm.thunderTrial) {
		// 进入雷劫流程
		thunderRound = 1;
		thunderResults = ["pending", "pending", "pending"];
		thunderPenalty = 0;
		showThunderModal = true;
		addLog(`天劫将至！突破「${nextRealm.name}」需硬渡三道天雷。`, "warning");
		return;
	}

	// 小境界直接判定
	doBreakthroughCheck(successRate);
}

/** 硬抗一道天雷 */
function tankThunder() {
	if (thunderStriking || thunderRound < 1 || thunderRound > 3) return;
	thunderStriking = true;

	const pass = Math.random() < lastSuccessRate;
	setTimeout(() => {
		thunderResults[thunderRound - 1] = pass ? "pass" : "fail";
		if (pass) {
			player.thunderPassed += 1;
			addLog(`第 ${thunderRound} 道天雷被你硬生生扛下！`, "success");
		} else {
			const loss = Math.floor(player.xp * 0.08 * (currentPhysique?.thunderLossMult ?? 1));
			player.xp = Math.max(0, player.xp - loss);
			thunderPenalty += 0.12;
			addLog(`第 ${thunderRound} 道天雷将你劈得皮开肉绽，损失 ${loss} 修为，突破之势受挫！`, "danger");
		}
		thunderStriking = false;
		thunderRound += 1;
		save();

		// 三道雷渡完，进入最终突破判定
		if (thunderRound > 3) {
			setTimeout(() => {
				showThunderModal = false;
				const finalRate = Math.max(0.15, lastSuccessRate - thunderPenalty);
				doBreakthroughCheck(finalRate);
			}, 900);
		}
	}, 1000);
}

/** 祭出破境丹抵挡一道天雷（必过，同时消耗突破 buff） */
function usePillForThunder() {
	if (thunderStriking || player.pills.pojing <= 0) return;
	player.pills.pojing -= 1;
	player.pojingActive = false; // 破境丹被用来挡雷，突破加成失效
	thunderStriking = true;
	setTimeout(() => {
		thunderResults[thunderRound - 1] = "pass";
		player.thunderPassed += 1;
		addLog(`你祭出破境丹，丹光化作护盾，第 ${thunderRound} 道天雷被尽数化解！`, "success");
		thunderStriking = false;
		thunderRound += 1;
		save();
		if (thunderRound > 3) {
			setTimeout(() => {
				showThunderModal = false;
				// 破境丹已消耗，用灵根+体质的基础率判定
				const baseRate = Math.max(
					0.15,
					lastSuccessRate - 0.25 - thunderPenalty, // 去掉破境丹加成
				);
				doBreakthroughCheck(baseRate);
			}, 900);
		}
	}, 1000);
}

/** 最终突破判定 */
function doBreakthroughCheck(rate: number) {
	const usedPojing = player.pojingActive;
	player.pojingActive = false;

	showBreakthroughModal = true;
	breakthroughResult = "idle";
	lastSuccessRate = rate;

	setTimeout(() => {
		const success = Math.random() < rate;
		if (success) {
			player.realmIndex += 1;
			player.lastBreakthrough = new Date().toLocaleString("zh-CN");
			breakthroughResult = "success";
			addLog(`恭喜！你成功突破至 ${REALMS[player.realmIndex].name}！${usedPojing ? "（破境丹之效）" : ""}`, "success");
		} else {
			// 突破失败，损失 15% 修为（不清空，保留进度感）
			const loss = Math.floor(player.xp * 0.15);
			player.xp = Math.max(0, player.xp - loss);
			breakthroughResult = "fail";
			addLog(`突破失败！真元逆流，损失 ${loss} 点修为。`, "danger");
		}
		save();
	}, 2000);
}

/** 重置存档 */
function resetGame() {
	if (!confirm("确定要兵解转世，重新来过吗？（修为、境界、丹药、灵根体质全部清空）")) return;
	stopMeditation();
	player = {
		xp: 0,
		realmIndex: 0,
		lastBreakthrough: null,
		totalBreaths: 0,
		pills: { ...EMPTY_PILLS },
		ningshenLeft: 0,
		pojingActive: false,
		spiritualRoot: null,
		physique: null,
		thunderPassed: 0,
		log: [],
	};
	selectedRoot = null;
	wheelResult = null;
	addLog("你兵解转世，一缕真灵投入轮回，静待天命重测。", "warning");
	save();
}

/** 关闭突破弹窗 */
function closeModal() {
	showBreakthroughModal = false;
	breakthroughResult = "idle";
}
</script>

<div class="xiuxian-game">
	{#if needCreation}
		<!-- ========== 创角：灵根选择 + 体质转盘 ========== -->
		<div class="realm-card creation-card">
			<h2 class="creation-title">天命初测</h2>
			<p class="creation-desc">修仙先修命。测一测你的灵根与体质，再踏上修行之路。</p>

			<!-- 第一步：选灵根 -->
			<h3 class="creation-step">第一步 · 择灵根</h3>
			<div class="root-grid">
				{#each SPIRIT_ROOTS as root (root.id)}
					<button
						class="root-item"
						class:selected={selectedRoot === root.id}
						onclick={() => selectRoot(root.id)}
					>
						<span class="root-orb" style={`background: radial-gradient(circle at 35% 30%, ${root.color}, ${root.color}88)`}></span>
						<span class="root-name">{root.name}</span>
						<span class="root-desc">{root.desc}</span>
					</button>
				{/each}
			</div>

			<!-- 第二步：体质转盘 -->
			<h3 class="creation-step">第二步 · 测体质</h3>
			<div class="wheel-grid">
				{#each PHYSIQUES as p, i (p.id)}
					<div
						class="wheel-item"
						class:highlight={wheelSpinning && wheelIndex === i}
						class:final={wheelResult?.id === p.id && !wheelSpinning}
					>
						<span class="wheel-name" style={wheelResult?.id === p.id && !wheelSpinning ? `color: ${p.color}` : ""}>{p.name}</span>
						<span class="wheel-weight">{p.weight}% 概率</span>
						<span class="wheel-desc">{p.desc}</span>
					</div>
				{/each}
			</div>

			<div class="creation-actions">
				{#if !wheelResult}
					<button class="btn spin-btn" disabled={!selectedRoot || wheelSpinning} onclick={spinWheel}>
						{wheelSpinning ? "天机推演中..." : selectedRoot ? "启动体质转盘" : "请先选择灵根"}
					</button>
				{:else}
					<p class="creation-result">
						灵根「{SPIRIT_ROOTS.find((r) => r.id === selectedRoot)?.name}」 · 体质「{wheelResult.name}」
					</p>
					<button class="btn meditate-btn" onclick={confirmCreation}>天命已定，踏入仙途</button>
				{/if}
			</div>
		</div>
	{:else}
		<!-- ========== 主游戏界面 ========== -->
		<div class="realm-card">
			<div class="realm-header">
				<span class="realm-badge">第 {currentRealm.level} 重</span>
				<h2 class="realm-name">{currentRealm.name}</h2>
				{#if player.ningshenLeft > 0}
					<span class="buff-badge buff-blue">凝神 ×2 · 余 {player.ningshenLeft} 息</span>
				{/if}
			</div>

			<!-- 灵根体质标签 -->
			<div class="talent-row">
				{#if currentRoot}
					<span class="talent-tag" style={`border-color: ${currentRoot.color}66; color: ${currentRoot.color}`}>{currentRoot.name}</span>
				{/if}
				{#if currentPhysique}
					<span class="talent-tag" style={`border-color: ${currentPhysique.color}66; color: ${currentPhysique.color}`}>{currentPhysique.name}</span>
				{/if}
				{#if player.thunderPassed > 0}
					<span class="talent-tag thunder-tag">已渡天雷 ×{player.thunderPassed}</span>
				{/if}
			</div>

			<p class="realm-desc">{currentRealm.description}</p>

			<!-- 修为进度条 -->
			<div class="xp-section">
				<div class="xp-bar">
					<div class="xp-fill" class:glowing={isMeditating} style="width: {progressPercent}%"></div>
				</div>
				<div class="xp-text">
					<span>修为: {player.xp.toLocaleString()}</span>
					{#if nextRealm}
						<span>/ {nextRealm.requiredXp.toLocaleString()}</span>
					{:else}
						<span>（已臻化境）</span>
					{/if}
				</div>
			</div>

			<!-- 持续打坐面板 -->
			<div class="meditation-panel" class:active={isMeditating}>
				<div class="meditation-orb" class:breathing={isMeditating}>
					{#if isMeditating}
						<span class="orb-inner"></span>
					{:else}
						<span class="orb-idle">静</span>
					{/if}
				</div>
				<div class="meditation-info">
					<div class="meditation-status">
						{#if isMeditating}
							<span class="status-running">运转周天中 · 每息约 +{lastGain ?? breathXp}</span>
						{:else}
							<span class="status-idle">入定可积累修为，心魔来时需抉择</span>
						{/if}
					</div>
					<button class="btn meditate-btn" class:pause={isMeditating} onclick={toggleMeditation}>
						{#if isMeditating}
							暂停打坐
						{:else}
							开始打坐
						{/if}
					</button>
				</div>
			</div>

			<!-- 突破 -->
			{#if canBreakthrough}
				<button class="btn breakthrough-btn" onclick={attemptBreakthrough}>
					{nextRealm.thunderTrial ? "渡劫突破" : "尝试突破"} → {nextRealm.name}（成功率 {(successRate * 100).toFixed(0)}%{player.pojingActive ? " · 破境丹已备" : ""}）
				</button>
				{#if nextRealm.thunderTrial}
					<p class="thunder-hint">大境界突破需硬渡三道天雷，每道天雷失败将损失修为并削弱突破之势；破境丹可祭出抵挡一道。</p>
				{/if}
			{:else if nextRealm}
				<div class="breakthrough-hint">
					距「{nextRealm.name}」还需 {(nextRealm.requiredXp - player.xp).toLocaleString()} 点修为
				</div>
			{/if}

			<div class="stats">
				<span>累计吐纳: {player.totalBreaths} 息</span>
				{#if player.lastBreakthrough}
					<span>上次突破: {player.lastBreakthrough}</span>
				{/if}
				<button class="reset-btn" onclick={resetGame}>兵解转世</button>
			</div>
		</div>

		<!-- 丹药面板 -->
		<div class="pill-card">
			<div class="pill-header">
				<h3 class="pill-title">丹药 · 炼丹坊</h3>
				<span class="pill-subtitle">机缘可获丹，修为可炼丹</span>
			</div>
			<div class="pill-list">
				{#each PILLS as pill (pill.id)}
					<div class="pill-item">
						<span class="pill-orb" style={`background: radial-gradient(circle at 35% 30%, ${pill.color}, ${pill.color}88)`}></span>
						<div class="pill-info">
							<div class="pill-name">{pill.name} <span class="pill-count">×{player.pills[pill.id]}</span></div>
							<div class="pill-desc">{pill.desc}</div>
						</div>
						<div class="pill-actions">
							<button
								class="btn pill-use"
								disabled={player.pills[pill.id] <= 0}
								onclick={() => usePill(pill)}
							>
								服用
							</button>
							<button
								class="btn pill-buy"
								disabled={player.xp < pill.cost}
								onclick={() => buyPill(pill)}
								title="炼制"
							>
								炼制 {pill.cost}
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- 修炼日志 -->
		<div class="log-card">
			<h3 class="log-title">修炼日志</h3>
			<div class="log-list">
				{#if player.log.length === 0}
					<p class="log-empty">尚未开始修炼，点击上方「开始打坐」入定吐纳。</p>
				{:else}
					{#each player.log.slice(0, 12) as entry}
						<div class="log-entry log-{entry.type}">
							<span class="log-time">{entry.time}</span>
							<span class="log-msg">{entry.message}</span>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}

	<!-- ========== 雷劫弹窗 ========== -->
	{#if showThunderModal}
		<div class="modal-overlay">
			<div class="modal-content thunder-modal" onclick={(e) => e.stopPropagation()}>
				<h3 class="thunder-title">天雷劫 · {nextRealm?.name}</h3>
				<p class="thunder-sub">三道天雷，道道要命。硬抗凭运，祭丹可解。</p>

				<!-- 三道雷的状态指示 -->
				<div class="thunder-track">
					{#each thunderResults as r, i}
						<div
							class="thunder-bolt"
							class:current={thunderRound === i + 1}
							class:pass={r === "pass"}
							class:fail={r === "fail"}
							class:striking={thunderStriking && thunderRound === i + 1}
						>
							{r === "pass" ? "已抗下" : r === "fail" ? "被劈中" : `第 ${i + 1} 道`}
						</div>
					{/each}
				</div>

				{#if thunderRound <= 3}
					<p class="thunder-text">{THUNDER_TEXTS[thunderRound - 1]}</p>
					{#if thunderPenalty > 0}
						<p class="thunder-penalty">雷伤累计：突破成功率 -{Math.round(thunderPenalty * 100)}%</p>
					{/if}
					<div class="thunder-actions">
						<button class="btn breakthrough-btn" disabled={thunderStriking} onclick={tankThunder}>
							{thunderStriking ? "天雷落下..." : "硬抗此雷"}
						</button>
						<button
							class="btn pill-use"
							disabled={thunderStriking || player.pills.pojing <= 0}
							onclick={usePillForThunder}
						>
							祭出破境丹（余 {player.pills.pojing}）
						</button>
					</div>
				{:else}
					<p class="thunder-text">天雷已尽，成败在此一举...</p>
				{/if}
			</div>
		</div>
	{/if}

	<!-- ========== 心魔劫弹窗 ========== -->
	{#if showDemonModal}
		<div class="modal-overlay">
			<div class="modal-content demon-modal" onclick={(e) => e.stopPropagation()}>
				<h3 class="demon-title">心魔劫</h3>
				<p class="demon-text">修行路上心魔骤起，幻境丛生。是挥剑斩魔，还是避其锋芒？</p>
				<div class="thunder-actions">
					<button class="btn breakthrough-btn" disabled={demonResolving} onclick={fightDemon}>
						挥剑斩之（70% 反获修为）
					</button>
					<button class="btn pill-buy" disabled={demonResolving} onclick={avoidDemon}>
						避其锋芒（无损收功）
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- ========== 突破结果弹窗 ========== -->
	{#if showBreakthroughModal}
		<div class="modal-overlay" onclick={closeModal}>
			<div class="modal-content" onclick={(e) => e.stopPropagation()}>
				{#if breakthroughResult === "idle"}
					<div class="breakthrough-loading">
						<div class="spinner"></div>
						<p>正在冲击关隘...（成功率 {(lastSuccessRate * 100).toFixed(0)}%）</p>
					</div>
				{:else if breakthroughResult === "success"}
					<div class="breakthrough-success">
						<div class="icon">破境！</div>
						<h3>突破成功</h3>
						<p>恭喜道友晋升 <strong>{currentRealm.name}</strong></p>
						<p class="desc">{currentRealm.description}</p>
						<button class="btn" onclick={closeModal}>继续修炼</button>
					</div>
				{:else}
					<div class="breakthrough-fail">
						<div class="icon">失败</div>
						<h3>突破失败</h3>
						<p>真元逆流，损失 15% 修为。道友莫慌，积攒修为再战。</p>
						<button class="btn" onclick={closeModal}>继续修炼</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
.xiuxian-game {
	display: flex;
	flex-direction: column;
	gap: 1.5rem;
}

/* ===== 通用卡片 ===== */
.realm-card, .pill-card, .log-card {
	background: var(--card-bg, rgba(255, 255, 255, 0.03));
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.15));
	border-radius: 1rem;
	padding: 1.5rem;
}

.realm-header {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	flex-wrap: wrap;
}
.realm-badge {
	font-size: 0.75rem;
	padding: 0.2rem 0.6rem;
	border-radius: 999px;
	background: var(--primary, #6366f1);
	color: #fff;
}
.realm-name {
	font-size: 1.75rem;
	font-weight: 700;
	margin: 0;
}
.buff-badge {
	font-size: 0.75rem;
	padding: 0.2rem 0.6rem;
	border-radius: 999px;
}
.buff-blue { background: rgba(96, 165, 250, 0.15); color: #60a5fa; }

/* ===== 灵根体质标签 ===== */
.talent-row {
	display: flex;
	gap: 0.5rem;
	flex-wrap: wrap;
	margin-top: 0.5rem;
}
.talent-tag {
	font-size: 0.75rem;
	padding: 0.15rem 0.6rem;
	border-radius: 999px;
	border: 1px solid;
}
.thunder-tag {
	border-color: rgba(250, 204, 21, 0.4);
	color: #facc15;
}

.realm-desc {
	color: var(--content-meta, #9ca3af);
	margin: 0.75rem 0 1.25rem;
	font-size: 0.9rem;
}

/* ===== 修为进度条 ===== */
.xp-bar {
	height: 0.75rem;
	background: rgba(128, 128, 128, 0.15);
	border-radius: 999px;
	overflow: hidden;
}
.xp-fill {
	height: 100%;
	background: linear-gradient(90deg, var(--primary, #6366f1), #a78bfa);
	border-radius: 999px;
	transition: width 0.5s ease;
}
.xp-fill.glowing {
	animation: xpGlow 2s ease-in-out infinite;
}
@keyframes xpGlow {
	0%, 100% { filter: brightness(1); }
	50% { filter: brightness(1.35); }
}
.xp-text {
	display: flex;
	gap: 0.35rem;
	font-size: 0.85rem;
	color: var(--content-meta, #9ca3af);
	margin-top: 0.4rem;
}

/* ===== 打坐面板 ===== */
.meditation-panel {
	display: flex;
	align-items: center;
	gap: 1.25rem;
	margin-top: 1.25rem;
	padding: 1rem 1.25rem;
	border-radius: 0.75rem;
	border: 1px dashed var(--line-divider, rgba(128, 128, 128, 0.25));
	transition: border-color 0.3s;
}
.meditation-panel.active {
	border-color: var(--primary, #6366f1);
}
.meditation-orb {
	width: 3.5rem;
	height: 3.5rem;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(128, 128, 128, 0.12);
	flex-shrink: 0;
}
.meditation-orb.breathing {
	background: radial-gradient(circle at 35% 30%, var(--primary, #6366f1), #312e81);
	animation: breathe 2s ease-in-out infinite;
}
@keyframes breathe {
	0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
	50% { transform: scale(1.12); box-shadow: 0 0 24px 6px rgba(99, 102, 241, 0.35); }
}
.orb-inner {
	width: 1rem;
	height: 1rem;
	border-radius: 50%;
	background: rgba(255, 255, 255, 0.85);
}
.orb-idle {
	color: var(--content-meta, #9ca3af);
	font-size: 1.1rem;
}
.meditation-info {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	flex: 1;
	flex-wrap: wrap;
}
.status-running { color: var(--primary, #6366f1); font-size: 0.9rem; }
.status-idle { color: var(--content-meta, #9ca3af); font-size: 0.9rem; }

/* ===== 按钮 ===== */
.btn {
	padding: 0.55rem 1.25rem;
	border-radius: 0.6rem;
	font-size: 0.9rem;
	font-weight: 600;
	cursor: pointer;
	border: none;
	background: var(--primary, #6366f1);
	color: #fff;
	transition: transform 0.15s, opacity 0.15s, filter 0.15s;
}
.btn:hover:not(:disabled) { filter: brightness(1.1); }
.btn:active:not(:disabled) { transform: scale(0.96); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.meditate-btn.pause { background: #f59e0b; }
.breakthrough-btn {
	width: 100%;
	margin-top: 1rem;
	background: linear-gradient(90deg, #7c3aed, #6366f1);
	padding: 0.8rem;
}
.thunder-hint {
	font-size: 0.78rem;
	color: #fbbf24;
	margin-top: 0.5rem;
	line-height: 1.5;
}
.breakthrough-hint {
	text-align: center;
	font-size: 0.85rem;
	color: var(--content-meta, #9ca3af);
	margin-top: 1rem;
}

.stats {
	display: flex;
	gap: 1rem;
	flex-wrap: wrap;
	align-items: center;
	font-size: 0.78rem;
	color: var(--content-meta, #9ca3af);
	margin-top: 1rem;
}
.reset-btn {
	margin-left: auto;
	font-size: 0.75rem;
	color: #f87171;
	background: none;
	border: none;
	cursor: pointer;
	opacity: 0.7;
}
.reset-btn:hover { opacity: 1; text-decoration: underline; }

/* ===== 丹药 ===== */
.pill-header {
	display: flex;
	align-items: baseline;
	gap: 0.75rem;
	margin-bottom: 1rem;
}
.pill-title { font-size: 1.1rem; font-weight: 700; margin: 0; }
.pill-subtitle { font-size: 0.78rem; color: var(--content-meta, #9ca3af); }
.pill-list {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}
.pill-item {
	display: flex;
	align-items: center;
	gap: 0.85rem;
	padding: 0.6rem 0.75rem;
	border-radius: 0.6rem;
	background: rgba(128, 128, 128, 0.06);
}
.pill-orb {
	width: 2rem;
	height: 2rem;
	border-radius: 50%;
	flex-shrink: 0;
}
.pill-info { flex: 1; min-width: 0; }
.pill-name { font-weight: 600; font-size: 0.9rem; }
.pill-count { color: var(--primary, #6366f1); font-size: 0.8rem; }
.pill-desc {
	font-size: 0.75rem;
	color: var(--content-meta, #9ca3af);
	margin-top: 0.1rem;
}
.pill-actions { display: flex; gap: 0.4rem; flex-shrink: 0; }
.pill-use, .pill-buy {
	padding: 0.35rem 0.7rem;
	font-size: 0.78rem;
}
.pill-buy {
	background: rgba(128, 128, 128, 0.2);
	color: inherit;
}

/* ===== 日志 ===== */
.log-title { font-size: 1.1rem; font-weight: 700; margin: 0 0 0.75rem; }
.log-list {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
	max-height: 16rem;
	overflow-y: auto;
}
.log-empty {
	font-size: 0.85rem;
	color: var(--content-meta, #9ca3af);
}
.log-entry {
	display: flex;
	gap: 0.6rem;
	font-size: 0.8rem;
	line-height: 1.45;
}
.log-time {
	color: var(--content-meta, #9ca3af);
	flex-shrink: 0;
	font-size: 0.72rem;
	padding-top: 0.1rem;
}
.log-success .log-msg { color: #34d399; }
.log-danger .log-msg { color: #f87171; }
.log-warning .log-msg { color: #fbbf24; }

/* ===== 弹窗 ===== */
.modal-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.6);
	backdrop-filter: blur(4px);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 100;
}
.modal-content {
	background: var(--card-bg-solid, #1e1e2e);
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.25));
	border-radius: 1rem;
	padding: 2rem;
	max-width: 26rem;
	width: calc(100% - 3rem);
	text-align: center;
}
.breakthrough-loading .spinner {
	width: 2.5rem;
	height: 2.5rem;
	border: 3px solid rgba(128, 128, 128, 0.2);
	border-top-color: var(--primary, #6366f1);
	border-radius: 50%;
	margin: 0 auto 1rem;
	animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.breakthrough-success .icon, .breakthrough-fail .icon {
	font-size: 1.5rem;
	font-weight: 800;
	margin-bottom: 0.5rem;
}
.breakthrough-success .icon { color: #34d399; }
.breakthrough-fail .icon { color: #f87171; }
.modal-content h3 { margin: 0.25rem 0 0.5rem; }
.modal-content .desc {
	font-size: 0.85rem;
	color: var(--content-meta, #9ca3af);
	margin-bottom: 1rem;
}

/* ===== 雷劫弹窗 ===== */
.thunder-modal { border-color: rgba(250, 204, 21, 0.35); }
.thunder-title {
	font-size: 1.3rem;
	font-weight: 800;
	color: #facc15;
	margin: 0;
}
.thunder-sub {
	font-size: 0.8rem;
	color: var(--content-meta, #9ca3af);
	margin: 0.4rem 0 1.25rem;
}
.thunder-track {
	display: flex;
	gap: 0.6rem;
	justify-content: center;
	margin-bottom: 1.25rem;
}
.thunder-bolt {
	padding: 0.5rem 0.9rem;
	border-radius: 0.6rem;
	font-size: 0.8rem;
	font-weight: 600;
	background: rgba(128, 128, 128, 0.12);
	color: var(--content-meta, #9ca3af);
	transition: all 0.3s;
}
.thunder-bolt.current {
	background: rgba(250, 204, 21, 0.15);
	color: #facc15;
	border: 1px solid rgba(250, 204, 21, 0.4);
}
.thunder-bolt.current.striking {
	animation: strike 0.5s ease-in-out infinite;
}
@keyframes strike {
	0%, 100% { filter: brightness(1); }
	50% { filter: brightness(1.8); }
}
.thunder-bolt.pass {
	background: rgba(52, 211, 153, 0.15);
	color: #34d399;
}
.thunder-bolt.fail {
	background: rgba(248, 113, 113, 0.15);
	color: #f87171;
}
.thunder-text {
	font-size: 0.9rem;
	margin-bottom: 0.5rem;
}
.thunder-penalty {
	font-size: 0.78rem;
	color: #f87171;
	margin-bottom: 0.75rem;
}
.thunder-actions {
	display: flex;
	gap: 0.6rem;
	justify-content: center;
	flex-wrap: wrap;
}

/* ===== 心魔劫弹窗 ===== */
.demon-modal { border-color: rgba(248, 113, 113, 0.4); }
.demon-title {
	font-size: 1.3rem;
	font-weight: 800;
	color: #f87171;
	margin: 0 0 0.5rem;
}
.demon-text {
	font-size: 0.9rem;
	color: var(--content-meta, #9ca3af);
	margin-bottom: 1.25rem;
}

/* ===== 创角 ===== */
.creation-card { text-align: center; }
.creation-title {
	font-size: 1.6rem;
	font-weight: 800;
	margin: 0 0 0.5rem;
}
.creation-desc {
	font-size: 0.9rem;
	color: var(--content-meta, #9ca3af);
	margin-bottom: 1.5rem;
}
.creation-step {
	font-size: 1rem;
	font-weight: 700;
	margin: 1.25rem 0 0.75rem;
	text-align: left;
}
.root-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
	gap: 0.6rem;
}
.root-item {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.35rem;
	padding: 0.9rem 0.6rem;
	border-radius: 0.75rem;
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.2));
	background: rgba(128, 128, 128, 0.05);
	cursor: pointer;
	transition: all 0.2s;
}
.root-item:hover { border-color: var(--primary, #6366f1); }
.root-item.selected {
	border-color: var(--primary, #6366f1);
	background: rgba(99, 102, 241, 0.1);
	box-shadow: 0 0 12px rgba(99, 102, 241, 0.25);
}
.root-orb { width: 1.75rem; height: 1.75rem; border-radius: 50%; }
.root-name { font-weight: 700; font-size: 0.9rem; }
.root-desc {
	font-size: 0.72rem;
	color: var(--content-meta, #9ca3af);
	line-height: 1.4;
}

.wheel-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
	gap: 0.6rem;
}
.wheel-item {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.25rem;
	padding: 0.85rem 0.6rem;
	border-radius: 0.75rem;
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.2));
	background: rgba(128, 128, 128, 0.05);
	transition: all 0.12s;
}
.wheel-item.highlight {
	border-color: var(--primary, #6366f1);
	background: rgba(99, 102, 241, 0.18);
	transform: scale(1.04);
}
.wheel-item.final {
	border-color: #fbbf24;
	background: rgba(251, 191, 36, 0.12);
	box-shadow: 0 0 16px rgba(251, 191, 36, 0.3);
}
.wheel-name { font-weight: 700; font-size: 0.92rem; }
.wheel-weight { font-size: 0.7rem; color: var(--content-meta, #9ca3af); }
.wheel-desc {
	font-size: 0.72rem;
	color: var(--content-meta, #9ca3af);
	line-height: 1.4;
}

.creation-actions {
	margin-top: 1.5rem;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.75rem;
}
.spin-btn {
	background: linear-gradient(90deg, #f59e0b, #fbbf24);
	color: #1c1917;
	padding: 0.7rem 2rem;
}
.creation-result {
	font-size: 0.95rem;
	font-weight: 600;
	margin: 0;
}
</style>
