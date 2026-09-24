<script lang="ts">
// 修仙修炼游戏核心组件 v4
// 三转盘创角（资质/灵根/体质，仿蛊真人体系）+ 持续打坐 + 雷劫渡劫
// 事件系统：心魔劫、妖兽来袭、坊市奇遇、道友论道、灵脉喷发
// 丹药体系：按境界解锁炼制，收益恒大于成本
// 数据存储在 localStorage，纯前端实现

import { onDestroy } from "svelte";

// ==================== 类型定义 ====================

interface Realm {
	name: string;
	level: number;
	requiredXp: number;
	description: string;
	thunderTrial: boolean; // 突破至此境界是否触发雷劫
}

type PillId = "juqi" | "ningshen" | "pojing" | "tianyuan" | "wudao" | "jiuzhuan";

interface Pill {
	id: PillId;
	name: string;
	color: string;
	desc: string;
	cost: number;
	minRealm: number; // 炼制所需最低境界 index
}

/** 资质（蛊真人甲乙丙丁） */
interface Aptitude {
	id: string;
	name: string;
	color: string;
	desc: string;
	weight: number;
	xpMult: number;
	breakBonus: number;
	fortuneBonus: number; // 机缘概率加成
}

/** 灵根组合（凡人修仙传体系：越少越纯） */
interface RootCombo {
	id: string;
	name: string;
	count: number; // 灵根数量
	mult: number; // 单项灵根效果倍率
	weight: number;
	desc: string;
	allEventBonus?: number; // 伪灵根的全事件概率加成
}

interface RootElement {
	id: string;
	name: string;
	color: string;
}

/** 体质（仿蛊真人十绝体：强大但多有缺陷） */
interface Physique {
	id: string;
	name: string;
	color: string;
	desc: string;
	weight: number;
	xpMult: number;
	breakBonus: number;
	demonProbDelta: number;
	thunderLossMult: number;
	fortuneMult?: number; // 机缘概率倍率
	demonImmune?: boolean; // 心魔免疫
	battleBonus?: number; // 战斗胜率加成
}

interface PlayerState {
	xp: number;
	realmIndex: number;
	lastBreakthrough: string | null;
	totalBreaths: number;
	pills: Record<PillId, number>;
	ningshenLeft: number; // 凝神丹剩余息数
	wudaoLeft: number; // 悟道丹剩余息数（机缘×3）
	veinLeft: number; // 灵脉剩余息数（收益×3）
	pojingActive: boolean;
	aptitude: string | null; // 资质 id
	rootCombo: string | null; // 灵根组合 id
	spiritualRoots: string[]; // 五行灵根 id 数组
	physique: string | null;
	thunderPassed: number;
	battlesWon: number; // 累计战胜妖兽数
	log: LogEntry[];
}

interface LogEntry {
	time: string;
	message: string;
	type: "info" | "success" | "danger" | "warning";
}

// ==================== 常量 ====================

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

/** 丹药：效果恒大于成本，高阶丹药需对应境界炼制 */
const PILLS: Pill[] = [
	{ id: "juqi", name: "聚气丹", color: "#34d399", desc: "服下 +120 修为", cost: 50, minRealm: 0 },
	{ id: "ningshen", name: "凝神丹", color: "#60a5fa", desc: "30 息修炼收益翻倍", cost: 250, minRealm: 1 },
	{ id: "pojing", name: "破境丹", color: "#c084fc", desc: "突破+25%；渡劫可挡一道天雷", cost: 600, minRealm: 2 },
	{ id: "tianyuan", name: "天元丹", color: "#fbbf24", desc: "服下 +2500 修为", cost: 1200, minRealm: 3 },
	{ id: "wudao", name: "悟道丹", color: "#f472b6", desc: "60 息内机缘概率 ×3", cost: 2500, minRealm: 4 },
	{ id: "jiuzhuan", name: "九转金丹", color: "#fb923c", desc: "服下 +15000 修为", cost: 6000, minRealm: 5 },
];

/** 资质（蛊真人：甲乙丙丁） */
const APTITUDES: Aptitude[] = [
	{ id: "jia", name: "甲等资质", color: "#fbbf24", desc: "九成空窍真元 · 修炼+40%，突破+8%", weight: 8, xpMult: 1.4, breakBonus: 0.08, fortuneBonus: 0 },
	{ id: "yi", name: "乙等资质", color: "#60a5fa", desc: "上等之资 · 修炼+20%", weight: 30, xpMult: 1.2, breakBonus: 0, fortuneBonus: 0 },
	{ id: "bing", name: "丙等资质", color: "#9ca3af", desc: "中人之姿 · 无加成，稳打稳扎", weight: 42, xpMult: 1, breakBonus: 0, fortuneBonus: 0 },
	{ id: "ding", name: "丁等资质", color: "#a8a29e", desc: "大器晚成 · 修炼-15%，但机缘+8%", weight: 20, xpMult: 0.85, breakBonus: 0, fortuneBonus: 0.08 },
];

/** 五行灵根元素 */
const ROOT_ELEMENTS: RootElement[] = [
	{ id: "jin", name: "金", color: "#eab308" },
	{ id: "mu", name: "木", color: "#22c55e" },
	{ id: "shui", name: "水", color: "#3b82f6" },
	{ id: "huo", name: "火", color: "#ef4444" },
	{ id: "tu", name: "土", color: "#a8a29e" },
];

/** 灵根组合转盘（凡人体系：灵根越少越精纯） */
const ROOT_COMBOS: RootCombo[] = [
	{ id: "tian", name: "天灵根", count: 1, mult: 3, weight: 8, desc: "单一灵根，纯度极致，单项效果 ×3" },
	{ id: "shuang", name: "双灵根", count: 2, mult: 1.5, weight: 25, desc: "两条灵根相生相辅，单项效果 ×1.5" },
	{ id: "san", name: "三灵根", count: 3, mult: 1, weight: 40, desc: "寻常修士之资，单项效果 ×1" },
	{ id: "si", name: "四灵根", count: 4, mult: 0.6, weight: 22, desc: "灵根驳杂，单项效果 ×0.6" },
	{ id: "wei", name: "伪灵根", count: 5, mult: 0.3, weight: 5, desc: "五行俱全皆不精（×0.3），然悟性惊人：全事件概率 +3%", allEventBonus: 0.03 },
];

/** 体质转盘（仿蛊真人十绝体：强大而多舛） */
const PHYSIQUES: Physique[] = [
	{ id: "fantai", name: "凡体", color: "#9ca3af", desc: "芸芸众生，大道靠己", weight: 40, xpMult: 1, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "lingti", name: "灵体", color: "#34d399", desc: "天生近道 · 收益 +15%", weight: 20, xpMult: 1.15, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "zhenwu", name: "大力真武体", color: "#ef4444", desc: "十绝体 · 收益+30%，战妖+15%，但心魔+3%", weight: 10, xpMult: 1.3, breakBonus: 0, demonProbDelta: 0.03, thunderLossMult: 1, battleBonus: 0.15 },
	{ id: "bingpo", name: "北冥冰魄体", color: "#7dd3fc", desc: "十绝体 · 心魔免疫，但突破 -5%", weight: 8, xpMult: 1, breakBonus: -0.05, demonProbDelta: 0, thunderLossMult: 1, demonImmune: true },
	{ id: "senhai", name: "森海轮回体", color: "#4ade80", desc: "十绝体 · 机缘翻倍，但打坐收益 -10%", weight: 8, xpMult: 0.9, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 1, fortuneMult: 2 },
	{ id: "daoti", name: "道体", color: "#60a5fa", desc: "道韵天成 · 突破与渡劫 +8%", weight: 8, xpMult: 1, breakBonus: 0.08, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "daotai", name: "先天圣体道胎", color: "#fbbf24", desc: "万古无一 · 收益+50%，突破+10%", weight: 4, xpMult: 1.5, breakBonus: 0.1, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "zhizun", name: "至尊仙胎体", color: "#e879f9", desc: "仙胎无瑕 · 收益+80%，突破+15%，雷劫损失减半", weight: 2, xpMult: 1.8, breakBonus: 0.15, demonProbDelta: 0, thunderLossMult: 0.5 },
];

const CULTIVATE_TEXTS = [
	"你盘膝而坐，吐纳天地灵气...",
	"灵气入体，经脉微微发热...",
	"你运转周天，灵力缓缓增长...",
	"一缕紫气东来，被你炼化吸收...",
	"灵台清明，心境澄澈...",
	"丹田之中，灵力如江河奔涌...",
];

const FORTUNE_EVENTS = [
	{ text: "你发现了一株百年灵药，修为大涨！", xpMultiplier: 3 },
	{ text: "你在古洞府中领悟了前辈留下的功法，修为大增！", xpMultiplier: 5 },
	{ text: "你参悟了天地法则，顿悟之下修为大进！", xpMultiplier: 6 },
	{ text: "你捡到了一块灵石，吸收后修为提升！", xpMultiplier: 2 },
	{ text: "有高人路过，见你资质不俗，随手点拨了一番！", xpMultiplier: 4 },
];

const THUNDER_TEXTS = [
	"乌云压顶，第一道天雷轰然劈落！",
	"雷光如龙，第二道天雷撕裂长空！",
	"紫霄神雷，第三道天雷携毁天灭地之势砸下！",
];

/** 灵根单项效果基数（乘以组合倍率后生效） */
const ROOT_BASE = {
	jin: { breakBonus: 0.02 },
	mu: { fortuneProb: 0.03 },
	shui: { xpMult: 0.07 },
	huo: { demonLossCut: 0.15 },
	tu: { demonProbCut: 0.015 },
};

// ==================== 状态 ====================

const EMPTY_PILLS: Record<PillId, number> = { juqi: 0, ningshen: 0, pojing: 0, tianyuan: 0, wudao: 0, jiuzhuan: 0 };

let player = $state<PlayerState>({
	xp: 0,
	realmIndex: 0,
	lastBreakthrough: null,
	totalBreaths: 0,
	pills: { ...EMPTY_PILLS },
	ningshenLeft: 0,
	wudaoLeft: 0,
	veinLeft: 0,
	pojingActive: false,
	aptitude: null,
	rootCombo: null,
	spiritualRoots: [],
	physique: null,
	thunderPassed: 0,
	battlesWon: 0,
	log: [],
});

let isMeditating = $state(false);
let lastGain = $state<number | null>(null);
let showBreakthroughModal = $state(false);
let breakthroughResult = $state<"idle" | "success" | "fail">("idle");
let lastSuccessRate = $state(0);

// ---- 创角三转盘状态 ----
type WheelKind = "aptitude" | "root" | "physique";
let spinningKind = $state<WheelKind | null>(null);
let aptitudeResult = $state<Aptitude | null>(null);
let rootComboResult = $state<RootCombo | null>(null);
let physiqueResult = $state<Physique | null>(null);
let wheelIndex = $state(0); // 当前转动的转盘高亮指针

// ---- 雷劫状态 ----
let showThunderModal = $state(false);
let thunderRound = $state(0);
let thunderResults = $state<("pending" | "pass" | "fail")[]>([]);
let thunderStriking = $state(false);
let thunderPenalty = $state(0);

// ---- 心魔劫状态 ----
let showDemonModal = $state(false);
let demonResolving = $state(false);

// ---- 妖兽来袭状态 ----
let showBeastModal = $state(false);
let beastResolving = $state(false);
let beastName = $state("");

// ---- 坊市奇遇状态 ----
let showMarketModal = $state(false);
let marketOffer = $state<{ pill: Pill; price: number } | null>(null);

// ==================== 计算属性 ====================

const currentRealm = $derived(REALMS[player.realmIndex]);
const nextRealm = $derived(REALMS[player.realmIndex + 1] ?? null);
const progressPercent = $derived(
	nextRealm
		? Math.min(100, Math.round((player.xp / nextRealm.requiredXp) * 100))
		: 100,
);
const canBreakthrough = $derived(Boolean(nextRealm && player.xp >= nextRealm.requiredXp));

/** 三项天命都测完才算完成创角 */
const needCreation = $derived(!player.aptitude || !player.rootCombo || !player.physique);

const currentAptitude = $derived(APTITUDES.find((a) => a.id === player.aptitude) ?? null);
const currentCombo = $derived(ROOT_COMBOS.find((c) => c.id === player.rootCombo) ?? null);
const currentPhysique = $derived(PHYSIQUES.find((p) => p.id === player.physique) ?? null);
const comboMult = $derived(currentCombo?.mult ?? 0);

/** 灵根效果（基数 × 组合倍率 × 数量不叠加同种） */
const hasRoot = (id: string) => player.spiritualRoots.includes(id);
const rootBreakBonus = $derived(hasRoot("jin") ? ROOT_BASE.jin.breakBonus * comboMult : 0);
const rootFortuneProb = $derived(hasRoot("mu") ? ROOT_BASE.mu.fortuneProb * comboMult : 0);
const rootXpMult = $derived(1 + (hasRoot("shui") ? ROOT_BASE.shui.xpMult * comboMult : 0));
const rootDemonLossMult = $derived(1 - (hasRoot("huo") ? ROOT_BASE.huo.demonLossCut * comboMult : 0));
const rootDemonProbCut = $derived(hasRoot("tu") ? ROOT_BASE.tu.demonProbCut * comboMult : 0);

/** 机缘概率：基础 6% + 木灵根 + 丁等资质 + 伪灵根全事件加成；森海轮回体翻倍；悟道丹 ×3 */
const fortuneProb = $derived.by(() => {
	let p = 0.06 + rootFortuneProb + (currentAptitude?.fortuneBonus ?? 0) + (currentCombo?.allEventBonus ?? 0);
	p *= currentPhysique?.fortuneMult ?? 1;
	if (player.wudaoLeft > 0) p *= 3;
	return p;
});

/** 心魔概率：基础 6% - 土灵根 + 体质增减 + 伪灵根加成；冰魄体免疫 */
const demonProb = $derived.by(() => {
	if (currentPhysique?.demonImmune) return 0;
	let p = 0.06 - rootDemonProbCut + (currentPhysique?.demonProbDelta ?? 0) + (currentCombo?.allEventBonus ?? 0);
	return Math.max(0, p);
});

/** 突破成功率：目标越高越难，保底 30% */
const successRate = $derived.by(() => {
	if (!nextRealm) return 0;
	const base = Math.max(0.3, 0.9 - nextRealm.level * 0.06);
	const bonus =
		rootBreakBonus +
		(currentAptitude?.breakBonus ?? 0) +
		(currentPhysique?.breakBonus ?? 0) +
		(player.pojingActive ? 0.25 : 0);
	return Math.min(0.95, base + bonus);
});

/** 每息修为：随境界增长 × 资质 × 水灵根 × 体质；灵脉中 ×3 */
const breathXp = $derived(
	Math.round(
		(5 + currentRealm.level * 3) *
			(currentAptitude?.xpMult ?? 1) *
			rootXpMult *
			(currentPhysique?.xpMult ?? 1),
	),
);

/** 妖兽战斗胜率 */
const battleWinRate = $derived(
	Math.min(0.95, 0.55 + player.realmIndex * 0.05 + (currentPhysique?.battleBonus ?? 0)),
);

// ==================== 持久化 ====================

const STORAGE_KEY = "xiuxian_save_v4";
const LEGACY_KEYS = ["xiuxian_save_v3", "xiuxian_save_v2", "xiuxian_save_v1"];

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
	// 迁移旧档：继承修为、境界、丹药，天命需重测
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
				player.thunderPassed = old.thunderPassed ?? 0;
				player.log = old.log ?? [];
				addLog("检测到旧存档，修为与丹药已继承。天道重铸，请重测资质、灵根与体质。", "warning");
				save();
				return;
			} catch {
				// 旧档损坏则忽略
			}
		}
	}
}

load();

// ==================== 游戏逻辑 ====================

function addLog(message: string, type: LogEntry["type"] = "info") {
	const time = new Date().toLocaleString("zh-CN");
	player.log = [{ time, message, type }, ...player.log].slice(0, 50);
}

// ---------- 创角：三转盘 ----------

/** 加权随机抽取 */
function weightedPick<T extends { weight: number }>(items: T[]): T {
	const total = items.reduce((s, i) => s + i.weight, 0);
	let roll = Math.random() * total;
	for (const item of items) {
		roll -= item.weight;
		if (roll <= 0) return item;
	}
	return items[0];
}

/** 通用转盘动画：快速滚动逐渐减速，停在加权随机结果上 */
function spinWheelFor<T extends { weight: number }>(
	kind: WheelKind,
	items: T[],
	onDone: (result: T) => void,
) {
	if (spinningKind) return;
	spinningKind = kind;
	wheelIndex = 0;

	const result = weightedPick(items);
	const targetIndex = items.indexOf(result);

	let step = 0;
	const totalSteps = 20 + targetIndex;
	const tick = () => {
		wheelIndex = step % items.length;
		step += 1;
		if (step > totalSteps) {
			wheelIndex = targetIndex;
			spinningKind = null;
			onDone(result);
			return;
		}
		setTimeout(tick, 60 + Math.min(400, step * step * 1.2));
	};
	tick();
}

function spinAptitude() {
	spinWheelFor("aptitude", APTITUDES, (r) => { aptitudeResult = r; });
}

function spinRootCombo() {
	spinWheelFor("root", ROOT_COMBOS, (r) => { rootComboResult = r; });
}

function spinPhysique() {
	spinWheelFor("physique", PHYSIQUES, (r) => { physiqueResult = r; });
}

/** 确认创角：灵根按组合数量随机分配五行 */
function confirmCreation() {
	if (!aptitudeResult || !rootComboResult || !physiqueResult || player.aptitude) return;
	player.aptitude = aptitudeResult.id;
	player.rootCombo = rootComboResult.id;
	player.physique = physiqueResult.id;

	// 随机分配五行灵根（伪灵根=五行俱全）
	const pool = [...ROOT_ELEMENTS];
	const picked: string[] = [];
	for (let i = 0; i < rootComboResult.count; i++) {
		const idx = Math.floor(Math.random() * pool.length);
		picked.push(pool.splice(idx, 1)[0].id);
	}
	player.spiritualRoots = picked;

	const rootNames = picked.map((id) => ROOT_ELEMENTS.find((e) => e.id === id)?.name).join("、");
	addLog(
		`天命已定！资质「${aptitudeResult.name}」· 灵根「${rootComboResult.name}（${rootNames}）」· 体质「${physiqueResult.name}」。`,
		"success",
	);
	addLog(
		player.xp > 0 || player.realmIndex > 0
			? "旧日修为犹在，新的修行路就此展开。"
			: "你踏上修仙之路，先从打坐吐纳开始吧。",
	);
	save();
}

// ---------- 打坐与事件 ----------

/** 每息修炼 tick（持续打坐时每 2 秒触发一次） */
function breathTick() {
	let xpGain = breathXp + Math.floor(Math.random() * (breathXp * 0.6 + 1));

	// 凝神丹双倍
	if (player.ningshenLeft > 0) {
		xpGain *= 2;
		player.ningshenLeft -= 1;
	}
	// 悟道丹剩余消耗（概率在 fortuneProb 里已算）
	if (player.wudaoLeft > 0) player.wudaoLeft -= 1;
	// 灵脉三倍
	if (player.veinLeft > 0) {
		xpGain *= 3;
		player.veinLeft -= 1;
	}

	// 事件判定（一次 roll，按优先级互斥）
	const roll = Math.random();
	if (roll < fortuneProb) {
		// 机缘：修为倍率 + 40% 掉丹（只掉当前境界可炼的）
		const event = FORTUNE_EVENTS[Math.floor(Math.random() * FORTUNE_EVENTS.length)];
		xpGain *= event.xpMultiplier;
		const available = PILLS.filter((p) => p.minRealm <= player.realmIndex);
		if (Math.random() < 0.4 && available.length > 0) {
			const pill = available[Math.floor(Math.random() * available.length)];
			player.pills[pill.id] += 1;
			addLog(`${event.text} 并获得一颗「${pill.name}」！`, "success");
		} else {
			addLog(event.text, "success");
		}
	} else if (roll < fortuneProb + demonProb) {
		// 心魔劫：中断打坐，弹出抉择
		stopMeditation();
		showDemonModal = true;
		demonResolving = false;
		addLog("心魔骤起！你的打坐被迫中断，必须立刻做出抉择...", "danger");
	} else if (roll < fortuneProb + demonProb + 0.04) {
		// 妖兽来袭：中断打坐，战斗抉择
		stopMeditation();
		beastName = ["赤炎狼", "碧鳞蟒", "铁背苍熊", "幽冥豹", "金翅雕"][Math.floor(Math.random() * 5)];
		showBeastModal = true;
		beastResolving = false;
		addLog(`一头「${beastName}」盯上了你的洞府！`, "warning");
	} else if (roll < fortuneProb + demonProb + 0.04 + 0.03) {
		// 坊市奇遇：六折丹药，可买可走（不打断打坐）
		const available = PILLS.filter((p) => p.minRealm <= player.realmIndex);
		if (available.length > 0) {
			const pill = available[Math.floor(Math.random() * available.length)];
			marketOffer = { pill, price: Math.floor(pill.cost * 0.6) };
			stopMeditation();
			showMarketModal = true;
			addLog(`云游商贩路过，愿以六折出售「${pill.name}」！`);
		}
	} else if (roll < fortuneProb + demonProb + 0.04 + 0.03 + 0.03) {
		// 道友论道：直接收益，不打断
		const mult = 2 + Math.floor(Math.random() * 3);
		xpGain *= mult;
		addLog(`有道友登门论道，一番印证让你获益匪浅（收益 ×${mult}）！`, "success");
	} else if (roll < fortuneProb + demonProb + 0.04 + 0.03 + 0.03 + 0.01) {
		// 灵脉喷发：30 息三倍收益
		player.veinLeft += 30;
		addLog("地底灵脉喷发！灵气如潮，30 息内修炼收益 ×3！", "success");
	} else if (Math.random() < 0.12) {
		addLog(CULTIVATE_TEXTS[Math.floor(Math.random() * CULTIVATE_TEXTS.length)]);
	}

	player.xp += xpGain;
	player.totalBreaths += 1;
	lastGain = xpGain;
	save();
}

// ---------- 心魔劫 ----------

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
	setTimeout(() => { showDemonModal = false; save(); }, 1200);
}

function avoidDemon() {
	if (demonResolving) return;
	demonResolving = true;
	addLog("你收功避魔，道心无损，待心神平复可再度入定。", "warning");
	setTimeout(() => { showDemonModal = false; save(); }, 800);
}

// ---------- 妖兽来袭 ----------

function fightBeast() {
	if (beastResolving) return;
	beastResolving = true;
	if (Math.random() < battleWinRate) {
		const gain = breathXp * (4 + Math.floor(Math.random() * 4));
		player.xp += gain;
		player.battlesWon += 1;
		// 30% 掉妖丹（随机丹药）
		if (Math.random() < 0.3) {
			const available = PILLS.filter((p) => p.minRealm <= player.realmIndex);
			if (available.length > 0) {
				const pill = available[Math.floor(Math.random() * available.length)];
				player.pills[pill.id] += 1;
				addLog(`你斩杀了「${beastName}」！获 ${gain} 修为，并取其妖丹炼出「${pill.name}」！`, "success");
			} else {
				addLog(`你斩杀了「${beastName}」！获 ${gain} 修为！`, "success");
			}
		} else {
			addLog(`你斩杀了「${beastName}」！获 ${gain} 修为！`, "success");
		}
	} else {
		const loss = Math.floor(player.xp * 0.08);
		player.xp = Math.max(0, player.xp - loss);
		addLog(`你不敌「${beastName}」，负伤遁走，损失 ${loss} 修为。`, "danger");
	}
	setTimeout(() => { showBeastModal = false; save(); }, 1200);
}

function fleeBeast() {
	if (beastResolving) return;
	beastResolving = true;
	const loss = Math.floor(player.xp * 0.03);
	player.xp = Math.max(0, player.xp - loss);
	addLog(`你施展遁术避开了「${beastName}」，耗费 ${loss} 修为。`, "warning");
	setTimeout(() => { showBeastModal = false; save(); }, 800);
}

// ---------- 坊市奇遇 ----------

function buyMarketPill() {
	if (!marketOffer || player.xp < marketOffer.price) return;
	player.xp -= marketOffer.price;
	player.pills[marketOffer.pill.id] += 1;
	addLog(`你以六折价 ${marketOffer.price} 修为购得「${marketOffer.pill.name}」，血赚！`, "success");
	showMarketModal = false;
	marketOffer = null;
	save();
}

function leaveMarket() {
	addLog("你婉拒了商贩，对方悻悻离去。");
	showMarketModal = false;
	marketOffer = null;
	save();
}

// ---------- 打坐开关 ----------

let breathTimer: ReturnType<typeof setInterval> | null = null;

function toggleMeditation() {
	if (isMeditating) {
		stopMeditation();
		addLog("你收功止息，结束了这一轮打坐。");
		save();
		return;
	}
	isMeditating = true;
	breathTimer = setInterval(breathTick, 2000);
	addLog("你盘膝入定，开始持续吐纳。");
	save();
}

function stopMeditation() {
	isMeditating = false;
	if (breathTimer) {
		clearInterval(breathTimer);
		breathTimer = null;
	}
}

onDestroy(() => {
	stopMeditation();
});

// ---------- 丹药 ----------

function usePill(pill: Pill) {
	if (player.pills[pill.id] <= 0) return;
	player.pills[pill.id] -= 1;

	switch (pill.id) {
		case "juqi":
			player.xp += 120;
			addLog("你服下一颗聚气丹，灵力增长 120 点。", "success");
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
			player.xp += 2500;
			addLog("你服下一颗天元丹，修为暴涨 2500 点！", "success");
			break;
		case "wudao":
			player.wudaoLeft += 60;
			addLog("你服下一颗悟道丹，60 息内机缘概率三倍！", "success");
			break;
		case "jiuzhuan":
			player.xp += 15000;
			addLog("九转金丹入口即化，修为狂涨 15000 点！！", "success");
			break;
	}
	save();
}

/** 炼丹：需达到对应境界 */
function buyPill(pill: Pill) {
	if (player.xp < pill.cost || player.realmIndex < pill.minRealm) return;
	player.xp -= pill.cost;
	player.pills[pill.id] += 1;
	addLog(`你耗费 ${pill.cost} 修为，炼制出一颗「${pill.name}」。`);
	save();
}

// ---------- 突破与雷劫 ----------

function attemptBreakthrough() {
	if (!canBreakthrough || !nextRealm) return;
	lastSuccessRate = successRate;

	if (nextRealm.thunderTrial) {
		thunderRound = 1;
		thunderResults = ["pending", "pending", "pending"];
		thunderPenalty = 0;
		showThunderModal = true;
		addLog(`天劫将至！突破「${nextRealm.name}」需硬渡三道天雷。`, "warning");
		return;
	}

	doBreakthroughCheck(successRate);
}

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

		if (thunderRound > 3) {
			setTimeout(() => {
				showThunderModal = false;
				const finalRate = Math.max(0.15, lastSuccessRate - thunderPenalty);
				doBreakthroughCheck(finalRate);
			}, 900);
		}
	}, 1000);
}

function usePillForThunder() {
	if (thunderStriking || player.pills.pojing <= 0) return;
	player.pills.pojing -= 1;
	player.pojingActive = false;
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
				const baseRate = Math.max(0.15, lastSuccessRate - 0.25 - thunderPenalty);
				doBreakthroughCheck(baseRate);
			}, 900);
		}
	}, 1000);
}

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
			const loss = Math.floor(player.xp * 0.15);
			player.xp = Math.max(0, player.xp - loss);
			breakthroughResult = "fail";
			addLog(`突破失败！真元逆流，损失 ${loss} 点修为。`, "danger");
		}
		save();
	}, 2000);
}

function resetGame() {
	if (!confirm("确定要兵解转世，重新来过吗？（修为、境界、丹药、天命全部清空）")) return;
	stopMeditation();
	player = {
		xp: 0,
		realmIndex: 0,
		lastBreakthrough: null,
		totalBreaths: 0,
		pills: { ...EMPTY_PILLS },
		ningshenLeft: 0,
		wudaoLeft: 0,
		veinLeft: 0,
		pojingActive: false,
		aptitude: null,
		rootCombo: null,
		spiritualRoots: [],
		physique: null,
		thunderPassed: 0,
		battlesWon: 0,
		log: [],
	};
	aptitudeResult = null;
	rootComboResult = null;
	physiqueResult = null;
	addLog("你兵解转世，一缕真灵投入轮回，静待天命重测。", "warning");
	save();
}

function closeModal() {
	showBreakthroughModal = false;
	breakthroughResult = "idle";
}
</script>

<div class="xiuxian-game">
	{#if needCreation}
		<!-- ========== 创角：三转盘测天命 ========== -->
		<div class="realm-card creation-card">
			<h2 class="creation-title">天命三测</h2>
			<p class="creation-desc">资质、灵根、体质，三者定汝仙途。依次启动转盘，各测天命。</p>

			<!-- 资质转盘 -->
			<h3 class="creation-step">一测 · 修行资质</h3>
			<div class="wheel-grid">
				{#each APTITUDES as a, i (a.id)}
					<div
						class="wheel-item"
						class:highlight={spinningKind === "aptitude" && wheelIndex === i}
						class:final={aptitudeResult?.id === a.id && spinningKind !== "aptitude"}
					>
						<span class="wheel-name" style={aptitudeResult?.id === a.id && spinningKind !== "aptitude" ? `color: ${a.color}` : ""}>{a.name}</span>
						<span class="wheel-weight">{a.weight}% 概率</span>
						<span class="wheel-desc">{a.desc}</span>
					</div>
				{/each}
			</div>
			{#if !aptitudeResult}
				<button class="btn spin-btn" disabled={spinningKind !== null} onclick={spinAptitude}>
					{spinningKind === "aptitude" ? "天机推演中..." : "测资质"}
				</button>
			{/if}

			<!-- 灵根转盘 -->
			<h3 class="creation-step">二测 · 灵根多寡</h3>
			<div class="wheel-grid">
				{#each ROOT_COMBOS as c, i (c.id)}
					<div
						class="wheel-item"
						class:highlight={spinningKind === "root" && wheelIndex === i}
						class:final={rootComboResult?.id === c.id && spinningKind !== "root"}
					>
						<span class="wheel-name">{c.name}</span>
						<span class="wheel-weight">{c.weight}% 概率</span>
						<span class="wheel-desc">{c.desc}</span>
					</div>
				{/each}
			</div>
			{#if aptitudeResult && !rootComboResult}
				<button class="btn spin-btn" disabled={spinningKind !== null} onclick={spinRootCombo}>
					{spinningKind === "root" ? "天机推演中..." : "测灵根"}
				</button>
			{/if}

			<!-- 体质转盘 -->
			<h3 class="creation-step">三测 · 先天体质</h3>
			<div class="wheel-grid">
				{#each PHYSIQUES as p, i (p.id)}
					<div
						class="wheel-item"
						class:highlight={spinningKind === "physique" && wheelIndex === i}
						class:final={physiqueResult?.id === p.id && spinningKind !== "physique"}
					>
						<span class="wheel-name" style={physiqueResult?.id === p.id && spinningKind !== "physique" ? `color: ${p.color}` : ""}>{p.name}</span>
						<span class="wheel-weight">{p.weight}% 概率</span>
						<span class="wheel-desc">{p.desc}</span>
					</div>
				{/each}
			</div>
			{#if rootComboResult && !physiqueResult}
				<button class="btn spin-btn" disabled={spinningKind !== null} onclick={spinPhysique}>
					{spinningKind === "physique" ? "天机推演中..." : "测体质"}
				</button>
			{/if}

			<!-- 确认 -->
			{#if aptitudeResult && rootComboResult && physiqueResult}
				<div class="creation-actions">
					<p class="creation-result">
						「{aptitudeResult.name}」 · 「{rootComboResult.name}」 · 「{physiqueResult.name}」
					</p>
					<button class="btn meditate-btn" onclick={confirmCreation}>天命已定，踏入仙途</button>
				</div>
			{/if}
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
				{#if player.wudaoLeft > 0}
					<span class="buff-badge buff-pink">悟道 ×3 · 余 {player.wudaoLeft} 息</span>
				{/if}
				{#if player.veinLeft > 0}
					<span class="buff-badge buff-green">灵脉 ×3 · 余 {player.veinLeft} 息</span>
				{/if}
			</div>

			<!-- 天命标签 -->
			<div class="talent-row">
				{#if currentAptitude}
					<span class="talent-tag" style={`border-color: ${currentAptitude.color}66; color: ${currentAptitude.color}`}>{currentAptitude.name}</span>
				{/if}
				{#if currentCombo}
					<span class="talent-tag root-tag">
						{currentCombo.name}（{player.spiritualRoots.map((id) => ROOT_ELEMENTS.find((e) => e.id === id)?.name).join("")}）
					</span>
				{/if}
				{#if currentPhysique}
					<span class="talent-tag" style={`border-color: ${currentPhysique.color}66; color: ${currentPhysique.color}`}>{currentPhysique.name}</span>
				{/if}
				{#if player.thunderPassed > 0}
					<span class="talent-tag thunder-tag">渡雷 ×{player.thunderPassed}</span>
				{/if}
				{#if player.battlesWon > 0}
					<span class="talent-tag battle-tag">斩妖 ×{player.battlesWon}</span>
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
							<span class="status-idle">入定吐纳 · 途中或有机缘、心魔、妖兽、坊市、论道、灵脉</span>
						{/if}
					</div>
					<button class="btn meditate-btn" class:pause={isMeditating} onclick={toggleMeditation}>
						{isMeditating ? "暂停打坐" : "开始打坐"}
					</button>
				</div>
			</div>

			<!-- 突破 -->
			{#if canBreakthrough}
				<button class="btn breakthrough-btn" onclick={attemptBreakthrough}>
					{nextRealm.thunderTrial ? "渡劫突破" : "尝试突破"} → {nextRealm.name}（成功率 {(successRate * 100).toFixed(0)}%{player.pojingActive ? " · 破境丹已备" : ""}）
				</button>
				{#if nextRealm.thunderTrial}
					<p class="thunder-hint">大境界突破需硬渡三道天雷，每道失败损修为并削弱突破之势；破境丹可祭出抵挡一道。</p>
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
				<span class="pill-subtitle">收益大于成本 · 高阶丹药需对应境界方可炼制</span>
			</div>
			<div class="pill-list">
				{#each PILLS as pill (pill.id)}
					{@const locked = player.realmIndex < pill.minRealm}
					<div class="pill-item" class:pill-locked={locked}>
						<span class="pill-orb" style={`background: radial-gradient(circle at 35% 30%, ${pill.color}, ${pill.color}88)`}></span>
						<div class="pill-info">
							<div class="pill-name">{pill.name} <span class="pill-count">×{player.pills[pill.id]}</span></div>
							<div class="pill-desc">
								{#if locked}
									需达「{REALMS[pill.minRealm].name}」方可炼制
								{:else}
									{pill.desc}
								{/if}
							</div>
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
								disabled={locked || player.xp < pill.cost}
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

	<!-- ========== 妖兽来袭弹窗 ========== -->
	{#if showBeastModal}
		<div class="modal-overlay">
			<div class="modal-content beast-modal" onclick={(e) => e.stopPropagation()}>
				<h3 class="beast-title">妖兽来袭 · {beastName}</h3>
				<p class="demon-text">妖兽循着灵气找到了你的洞府。迎战可夺其妖丹精华，遁走则耗费修为。</p>
				<div class="thunder-actions">
					<button class="btn breakthrough-btn" disabled={beastResolving} onclick={fightBeast}>
						拔剑迎战（胜率 {(battleWinRate * 100).toFixed(0)}%）
					</button>
					<button class="btn pill-buy" disabled={beastResolving} onclick={fleeBeast}>
						遁走避战（损 3% 修为）
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- ========== 坊市奇遇弹窗 ========== -->
	{#if showMarketModal && marketOffer}
		<div class="modal-overlay">
			<div class="modal-content market-modal" onclick={(e) => e.stopPropagation()}>
				<h3 class="market-title">坊市奇遇</h3>
				<p class="demon-text">
					云游商贩愿以 <strong class="market-price">{marketOffer.price}</strong> 修为（原价 {marketOffer.pill.cost}）
					出售「{marketOffer.pill.name}」——{marketOffer.pill.desc}
				</p>
				<div class="thunder-actions">
					<button class="btn breakthrough-btn" disabled={player.xp < marketOffer.price} onclick={buyMarketPill}>
						{player.xp < marketOffer.price ? "修为不足" : "买下（六折）"}
					</button>
					<button class="btn pill-buy" onclick={leaveMarket}>离去</button>
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
.buff-pink { background: rgba(244, 114, 182, 0.15); color: #f472b6; }
.buff-green { background: rgba(52, 211, 153, 0.15); color: #34d399; }

/* ===== 天命标签 ===== */
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
.root-tag {
	border-color: rgba(96, 165, 250, 0.4);
	color: #60a5fa;
}
.thunder-tag {
	border-color: rgba(250, 204, 21, 0.4);
	color: #facc15;
}
.battle-tag {
	border-color: rgba(239, 68, 68, 0.4);
	color: #ef4444;
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
.thunder-actions .breakthrough-btn { width: auto; margin-top: 0; }
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
	flex-wrap: wrap;
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
.pill-item.pill-locked { opacity: 0.55; }
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

/* ===== 心魔劫 / 妖兽 / 坊市弹窗 ===== */
.demon-modal { border-color: rgba(248, 113, 113, 0.4); }
.beast-modal { border-color: rgba(239, 68, 68, 0.45); }
.beast-title {
	font-size: 1.3rem;
	font-weight: 800;
	color: #ef4444;
	margin: 0 0 0.5rem;
}
.market-modal { border-color: rgba(251, 191, 36, 0.45); }
.market-title {
	font-size: 1.3rem;
	font-weight: 800;
	color: #fbbf24;
	margin: 0 0 0.5rem;
}
.market-price { color: #fbbf24; }
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

/* ===== 创角三转盘 ===== */
.creation-card { text-align: center; }
.creation-title {
	font-size: 1.6rem;
	font-weight: 800;
	margin: 0 0 0.5rem;
}
.creation-desc {
	font-size: 0.9rem;
	color: var(--content-meta, #9ca3af);
	margin-bottom: 0.5rem;
}
.creation-step {
	font-size: 1rem;
	font-weight: 700;
	margin: 1.5rem 0 0.75rem;
	text-align: left;
}
.wheel-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
	gap: 0.6rem;
	margin-bottom: 0.75rem;
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
	padding: 0.6rem 1.8rem;
}
.creation-result {
	font-size: 0.95rem;
	font-weight: 600;
	margin: 0;
}
</style>
