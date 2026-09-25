<script lang="ts">
// 修仙修炼游戏核心组件 v6
// 三转盘创角 + 气血/攻防/战力属性 + 持续打坐（事件全即时结算，不中断）
// 斗法台（参数化对手、回合制战力模拟）+ 炼丹失败率 + 战斗丹药
// 数据存储在 localStorage，纯前端实现

import { onDestroy } from "svelte";

// ==================== 类型定义 ====================

interface Realm {
	name: string;
	level: number;
	requiredXp: number;
	description: string;
	thunderTrial: boolean;
}

type PillId =
	| "juqi" | "huichun" | "ningshen" | "pojing"
	| "quti" | "zengyuan" | "tianyuan" | "wudao" | "jiuzhuan";

interface Pill {
	id: PillId;
	name: string;
	color: string;
	desc: string;
	cost: number;
	minRealm: number;
}

interface Aptitude {
	id: string;
	name: string;
	color: string;
	desc: string;
	weight: number;
	xpMult: number;
	breakBonus: number;
	fortuneBonus: number;
}

interface RootCombo {
	id: string;
	name: string;
	count: number;
	mult: number;
	weight: number;
	desc: string;
	allEventBonus?: number;
}

interface RootElement { id: string; name: string; color: string }

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
	fortuneMult?: number;
	demonImmune?: boolean;
	atkMult?: number; // 攻击加成（大力真武体）
}

/** 斗法台对手模板（数值参数化生成） */
interface EnemyTemplate {
	id: string;
	name: string;
	title: string;
	/** 对手等级相对玩家的偏移（-1 ~ +3） */
	levelOffset: number;
	/** 奖励系数（基于对手战力） */
	rewardFactor: number;
}

/** 运行时敌人数值 */
interface EnemyStats {
	tpl: EnemyTemplate;
	level: number;
	hp: number;
	atk: number;
	def: number;
	power: number;
}

interface PlayerState {
	xp: number;
	realmIndex: number;
	hp: number; // 当前气血
	lastBreakthrough: string | null;
	totalBreaths: number;
	pills: Record<PillId, number>;
	ningshenLeft: number;
	springLeft: number;
	wudaoLeft: number;
	veinLeft: number;
	pojingActive: boolean;
	aptitude: string | null;
	rootCombo: string | null;
	spiritualRoots: string[];
	physique: string | null;
	thunderPassed: number;
	battlesWon: number;
	battlesLost: number;
	qutiUsed: number; // 累计已服淬体丹数（永久 +80 气血上限/颗）
	zengyuanUsed: number; // 累计已服增元丹数（永久 +8 攻击/颗）
	cooldowns: Record<string, number>; // 对手 id → 剩余冷却息数
	log: LogEntry[];
}

interface LogEntry {
	time: string;
	message: string;
	type: "info" | "success" | "danger" | "warning";
}

interface EventResult {
	mult?: number;
	delta?: number;
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

/**
 * 丹药表：效果恒大于成本；高阶丹药需对应境界炼制，且炼制有失败率。
 * 永久属性丹：淬体丹（+气血上限）、增元丹（+攻击）；回春丹为战斗补给。
 */
const PILLS: Pill[] = [
	{ id: "juqi", name: "聚气丹", color: "#34d399", desc: "服下 +120 修为", cost: 50, minRealm: 0 },
	{ id: "huichun", name: "回春丹", color: "#f87171", desc: "立即恢复 50% 气血", cost: 40, minRealm: 0 },
	{ id: "ningshen", name: "凝神丹", color: "#60a5fa", desc: "30 息修炼收益翻倍", cost: 250, minRealm: 1 },
	{ id: "pojing", name: "破境丹", color: "#c084fc", desc: "突破+25%；渡劫可挡一道天雷", cost: 600, minRealm: 2 },
	{ id: "quti", name: "淬体丹", color: "#fb923c", desc: "永久 +80 气血上限（立即回满差值）", cost: 700, minRealm: 2 },
	{ id: "zengyuan", name: "增元丹", color: "#ef4444", desc: "永久 +8 攻击", cost: 900, minRealm: 3 },
	{ id: "tianyuan", name: "天元丹", color: "#fbbf24", desc: "服下 +2500 修为", cost: 1200, minRealm: 3 },
	{ id: "wudao", name: "悟道丹", color: "#f472b6", desc: "60 息内机缘类事件概率 ×3", cost: 2500, minRealm: 4 },
	{ id: "jiuzhuan", name: "九转金丹", color: "#e879f9", desc: "服下 +15000 修为", cost: 6000, minRealm: 5 },
];

/** 炼丹成功率：随丹药所需境界递减（97% → 67%） */
function craftSuccessRate(minRealm: number): number {
	return Math.max(0.55, 0.97 - minRealm * 0.06);
}

const APTITUDES: Aptitude[] = [
	{ id: "jia", name: "甲等资质", color: "#fbbf24", desc: "九成空窍真元 · 修炼+40%，突破+8%", weight: 8, xpMult: 1.4, breakBonus: 0.08, fortuneBonus: 0 },
	{ id: "yi", name: "乙等资质", color: "#60a5fa", desc: "上等之资 · 修炼+20%", weight: 30, xpMult: 1.2, breakBonus: 0, fortuneBonus: 0 },
	{ id: "bing", name: "丙等资质", color: "#9ca3af", desc: "中人之姿 · 无加成，稳打稳扎", weight: 42, xpMult: 1, breakBonus: 0, fortuneBonus: 0 },
	{ id: "ding", name: "丁等资质", color: "#a8a29e", desc: "大器晚成 · 修炼-15%，但机缘+8%", weight: 20, xpMult: 0.85, breakBonus: 0, fortuneBonus: 0.08 },
];

const ROOT_ELEMENTS: RootElement[] = [
	{ id: "jin", name: "金", color: "#eab308" },
	{ id: "mu", name: "木", color: "#22c55e" },
	{ id: "shui", name: "水", color: "#3b82f6" },
	{ id: "huo", name: "火", color: "#ef4444" },
	{ id: "tu", name: "土", color: "#a8a29e" },
];

const ROOT_COMBOS: RootCombo[] = [
	{ id: "tian", name: "天灵根", count: 1, mult: 3, weight: 8, desc: "单一灵根，纯度极致，单项效果 ×3" },
	{ id: "shuang", name: "双灵根", count: 2, mult: 1.5, weight: 25, desc: "两条灵根相生相辅，单项效果 ×1.5" },
	{ id: "san", name: "三灵根", count: 3, mult: 1, weight: 40, desc: "寻常修士之资，单项效果 ×1" },
	{ id: "si", name: "四灵根", count: 4, mult: 0.6, weight: 22, desc: "灵根驳杂，单项效果 ×0.6" },
	{ id: "wei", name: "伪灵根", count: 5, mult: 0.3, weight: 5, desc: "五行俱全皆不精（×0.3），然悟性惊人：全事件概率 +3%", allEventBonus: 0.03 },
];

const PHYSIQUES: Physique[] = [
	{ id: "fantai", name: "凡体", color: "#9ca3af", desc: "芸芸众生，大道靠己", weight: 40, xpMult: 1, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "lingti", name: "灵体", color: "#34d399", desc: "天生近道 · 收益 +15%", weight: 20, xpMult: 1.15, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "zhenwu", name: "大力真武体", color: "#ef4444", desc: "十绝体 · 收益+30%，攻击+15%，但心魔+3%", weight: 10, xpMult: 1.3, breakBonus: 0, demonProbDelta: 0.03, thunderLossMult: 1, atkMult: 1.15 },
	{ id: "bingpo", name: "北冥冰魄体", color: "#7dd3fc", desc: "十绝体 · 心魔免疫，但突破 -5%", weight: 8, xpMult: 1, breakBonus: -0.05, demonProbDelta: 0, thunderLossMult: 1, demonImmune: true },
	{ id: "senhai", name: "森海轮回体", color: "#4ade80", desc: "十绝体 · 机缘翻倍，但打坐收益 -10%", weight: 8, xpMult: 0.9, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 1, fortuneMult: 2 },
	{ id: "daoti", name: "道体", color: "#60a5fa", desc: "道韵天成 · 突破与渡劫 +8%", weight: 8, xpMult: 1, breakBonus: 0.08, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "daotai", name: "先天圣体道胎", color: "#fbbf24", desc: "万古无一 · 收益+50%，突破+10%", weight: 4, xpMult: 1.5, breakBonus: 0.1, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "zhizun", name: "至尊仙胎体", color: "#e879f9", desc: "仙胎无瑕 · 收益+80%，突破+15%，雷劫损失减半", weight: 2, xpMult: 1.8, breakBonus: 0.15, demonProbDelta: 0, thunderLossMult: 0.5 },
];

/** 斗法台对手（由弱到强） */
const ENEMY_TEMPLATES: EnemyTemplate[] = [
	{ id: "yaolang", name: "落霞妖狼", title: "炼气级妖兽", levelOffset: -1, rewardFactor: 0.8 },
	{ id: "sanxiu", name: "黑风寨散修", title: "同境修士", levelOffset: 0, rewardFactor: 1.0 },
	{ id: "mangyao", name: "碧波潭蟒妖", title: "越境妖兽", levelOffset: 1, rewardFactor: 1.4 },
	{ id: "jianxiu", name: "逐风剑修", title: "越境剑修", levelOffset: 1, rewardFactor: 1.5 },
	{ id: "yaowang", name: "赤焰妖王", title: "两境妖王", levelOffset: 2, rewardFactor: 2.2 },
	{ id: "mingjiao", name: "九幽冥蛟", title: "三境凶兽", levelOffset: 3, rewardFactor: 3.2 },
];

/** 挑战冷却（息） */
const BATTLE_COOLDOWN = 20;
/** 挑战所需最低气血比例 */
const MIN_HP_RATIO = 0.3;

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

const BEAST_NAMES = ["赤炎狼", "碧鳞蟒", "铁背苍熊", "幽冥豹", "金翅雕", "九尾妖狐", "墨玉麒麟幼兽"];

const THUNDER_TEXTS = [
	"乌云压顶，第一道天雷轰然劈落！",
	"雷光如龙，第二道天雷撕裂长空！",
	"紫霄神雷，第三道天雷携毁天灭地之势砸下！",
];

const ROOT_BASE = {
	jin: { breakBonus: 0.02 },
	mu: { fortuneProb: 0.03 },
	shui: { xpMult: 0.07 },
	huo: { demonLossCut: 0.15 },
	tu: { demonProbCut: 0.015 },
};

// ==================== 状态 ====================

const EMPTY_PILLS: Record<PillId, number> = {
	juqi: 0, huichun: 0, ningshen: 0, pojing: 0, quti: 0,
	zengyuan: 0, tianyuan: 0, wudao: 0, jiuzhuan: 0,
};

let player = $state<PlayerState>({
	xp: 0,
	realmIndex: 0,
	hp: 100,
	lastBreakthrough: null,
	totalBreaths: 0,
	pills: { ...EMPTY_PILLS },
	ningshenLeft: 0,
	springLeft: 0,
	wudaoLeft: 0,
	veinLeft: 0,
	pojingActive: false,
	aptitude: null,
	rootCombo: null,
	spiritualRoots: [],
	physique: null,
	thunderPassed: 0,
	battlesWon: 0,
	battlesLost: 0,
	qutiUsed: 0,
	zengyuanUsed: 0,
	cooldowns: {},
	log: [],
});

let isMeditating = $state(false);
let lastGain = $state<number | null>(null);
let showBreakthroughModal = $state(false);
let breakthroughResult = $state<"idle" | "success" | "fail">("idle");
let lastSuccessRate = $state(0);

// ---- 创角三转盘 ----
type WheelKind = "aptitude" | "root" | "physique";
let spinningKind = $state<WheelKind | null>(null);
let aptitudeResult = $state<Aptitude | null>(null);
let rootComboResult = $state<RootCombo | null>(null);
let physiqueResult = $state<Physique | null>(null);
let wheelIndex = $state(0);

// ---- 雷劫（主动突破，保留交互）----
let showThunderModal = $state(false);
let thunderRound = $state(0);
let thunderResults = $state<("pending" | "pass" | "fail")[]>([]);
let thunderStriking = $state(false);
let thunderPenalty = $state(0);

// ==================== 属性计算 ====================

const currentRealm = $derived(REALMS[player.realmIndex]);
const nextRealm = $derived(REALMS[player.realmIndex + 1] ?? null);
const progressPercent = $derived(
	nextRealm ? Math.min(100, Math.round((player.xp / nextRealm.requiredXp) * 100)) : 100,
);
const canBreakthrough = $derived(Boolean(nextRealm && player.xp >= nextRealm.requiredXp));

const needCreation = $derived(!player.aptitude || !player.rootCombo || !player.physique);

const currentAptitude = $derived(APTITUDES.find((a) => a.id === player.aptitude) ?? null);
const currentCombo = $derived(ROOT_COMBOS.find((c) => c.id === player.rootCombo) ?? null);
const currentPhysique = $derived(PHYSIQUES.find((p) => p.id === player.physique) ?? null);
const comboMult = $derived(currentCombo?.mult ?? 0);

const hasRoot = (id: string) => player.spiritualRoots.includes(id);
const rootBreakBonus = $derived(hasRoot("jin") ? ROOT_BASE.jin.breakBonus * comboMult : 0);
const rootFortuneProb = $derived(hasRoot("mu") ? ROOT_BASE.mu.fortuneProb * comboMult : 0);
const rootXpMult = $derived(1 + (hasRoot("shui") ? ROOT_BASE.shui.xpMult * comboMult : 0));
const rootDemonLossMult = $derived(1 - (hasRoot("huo") ? ROOT_BASE.huo.demonLossCut * comboMult : 0));
const rootDemonProbCut = $derived(hasRoot("tu") ? ROOT_BASE.tu.demonProbCut * comboMult : 0);

const fortuneFactor = $derived(
	(1 + rootFortuneProb * 5 + (currentAptitude?.fortuneBonus ?? 0) * 5) *
		(player.wudaoLeft > 0 ? 3 : 1) *
		(currentPhysique?.fortuneMult ?? 1),
);

const demonWeight = $derived.by(() => {
	if (currentPhysique?.demonImmune) return 0;
	const p = Math.max(
		0,
		0.06 - rootDemonProbCut + (currentPhysique?.demonProbDelta ?? 0) + (currentCombo?.allEventBonus ?? 0),
	);
	return p * 400;
});

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

const breathXp = $derived(
	Math.round(
		(5 + currentRealm.level * 3) *
			(currentAptitude?.xpMult ?? 1) *
			rootXpMult *
			(currentPhysique?.xpMult ?? 1),
	),
);

// ---- 战斗属性：气血上限 / 攻击 / 防御 / 战力 ----

/** 气血上限：境界 + 已服淬体丹的永久加成（注意：服用后才生效，与背包库存无关） */
const maxHp = $derived(100 + currentRealm.level * 60 + player.qutiUsed * 80);
/** 攻击：境界 + 已服增元丹的永久加成 + 真武体 */
const atk = $derived(
	Math.round(
		(8 + currentRealm.level * 7 + player.zengyuanUsed * 8) *
			(currentPhysique?.atkMult ?? 1),
	),
);
/** 防御：仅随境界成长 */
const def = $derived(4 + currentRealm.level * 4);
/** 综合战力 */
const battlePower = $derived(Math.round(maxHp * 0.5 + atk * 4 + def * 3));
const hpPercent = $derived(Math.max(0, Math.round((player.hp / maxHp) * 100)));

const eventChance = $derived(0.28 + (currentCombo?.allEventBonus ?? 0));

// ==================== 持久化 ====================

const STORAGE_KEY = "xiuxian_save_v6";
const LEGACY_KEYS = ["xiuxian_save_v4", "xiuxian_save_v3", "xiuxian_save_v2", "xiuxian_save_v1"];

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
			player = {
				...player,
				...data,
				pills: { ...EMPTY_PILLS, ...(data.pills ?? {}) },
				cooldowns: data.cooldowns ?? {},
			};
			// 突破后可能出现气血超上限（理论不会），兜底修正
			player.hp = Math.min(player.hp, maxHp);
		} catch {
			// 存档损坏用默认值
		}
		return;
	}
	// 迁移旧档：继承修为、境界、丹药，天命需重测；气血回满
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
				player.battlesWon = old.battlesWon ?? 0;
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
// 迁移/加载后将气血补满（旧档或新档）
if (player.hp <= 0 || player.hp > maxHp) {
	player.hp = maxHp;
	save();
}

// ==================== 通用工具 ====================

function addLog(message: string, type: LogEntry["type"] = "info") {
	const time = new Date().toLocaleString("zh-CN");
	player.log = [{ time, message, type }, ...player.log].slice(0, 50);
}

function availablePills(): Pill[] {
	return PILLS.filter((p) => p.minRealm <= player.realmIndex);
}

function grantRandomPill(): boolean {
	const pool = availablePills();
	if (pool.length === 0) return false;
	const pill = pool[Math.floor(Math.random() * pool.length)];
	player.pills[pill.id] += 1;
	return true;
}

/** 造成伤害（气血最低为 0） */
function damageHp(amount: number) {
	player.hp = Math.max(0, player.hp - Math.round(amount));
}

/** 治疗气血（不超上限） */
function healHp(amount: number) {
	player.hp = Math.min(maxHp, player.hp + Math.round(amount));
}

// ==================== 创角三转盘 ====================

function weightedPick<T extends { weight: number }>(items: T[]): T {
	const total = items.reduce((s, i) => s + i.weight, 0);
	let roll = Math.random() * total;
	for (const item of items) {
		roll -= item.weight;
		if (roll <= 0) return item;
	}
	return items[0];
}

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

const spinAptitude = () => spinWheelFor("aptitude", APTITUDES, (r) => { aptitudeResult = r; });
const spinRootCombo = () => spinWheelFor("root", ROOT_COMBOS, (r) => { rootComboResult = r; });
const spinPhysique = () => spinWheelFor("physique", PHYSIQUES, (r) => { physiqueResult = r; });

function confirmCreation() {
	if (!aptitudeResult || !rootComboResult || !physiqueResult || player.aptitude) return;
	player.aptitude = aptitudeResult.id;
	player.rootCombo = rootComboResult.id;
	player.physique = physiqueResult.id;

	const pool = [...ROOT_ELEMENTS];
	const picked: string[] = [];
	for (let i = 0; i < rootComboResult.count; i++) {
		const idx = Math.floor(Math.random() * pool.length);
		picked.push(pool.splice(idx, 1)[0].id);
	}
	player.spiritualRoots = picked;
	player.hp = maxHp;

	const rootNames = picked.map((id) => ROOT_ELEMENTS.find((e) => e.id === id)?.name).join("、");
	addLog(
		`天命已定！资质「${aptitudeResult.name}」· 灵根「${rootComboResult.name}（${rootNames}）」· 体质「${physiqueResult.name}」。`,
		"success",
	);
	addLog("你踏上修仙之路，先从打坐吐纳开始吧。");
	save();
}

// ==================== 随机事件池（全部即时结算，不中断打坐）====================

interface PoolEntry {
	weight: number;
	run: (base: number) => EventResult | void;
}

/**
 * 参数化生成敌人：等级 → 气血/攻击/防御，战力同源计算。
 * 用于打坐随机妖兽与斗法台，杜绝硬编码导致的强度漂移。
 */
function makeEnemy(level: number, hpMul = 1, atkMul = 1): { hp: number; atk: number; def: number; power: number } {
	const lv = Math.max(1, level);
	const hp = Math.round((100 + lv * 60) * hpMul);
	const eAtk = Math.round((8 + lv * 7) * atkMul);
	const eDef = 4 + lv * 4;
	return { hp, atk: eAtk, def: eDef, power: Math.round(hp * 0.5 + eAtk * 4 + eDef * 3) };
}

/**
 * 回合制战斗模拟：玩家先手，伤害 = 攻击 - 防御×0.5（保底 1）。
 * 以玩家当前实际气血开战，返回胜负、剩余气血、回合数。
 */
function simulateBattle(): { win: boolean; remainHp: number; rounds: number } {
	const enemy = makeEnemy(currentRealm.level + (Math.random() < 0.5 ? 0 : 1), 0.9 + Math.random() * 0.3);
	let php = Math.round(player.hp);
	let ehp = enemy.hp;
	let rounds = 0;
	while (php > 0 && ehp > 0 && rounds < 60) {
		ehp -= Math.max(1, atk - enemy.def * 0.5);
		if (ehp <= 0) break;
		php -= Math.max(1, enemy.atk - def * 0.5);
		rounds += 1;
	}
	return { win: ehp <= 0, remainHp: Math.max(0, php), rounds: rounds + 1 };
}

function rollRandomEvent(base: number): EventResult {
	const ff = fortuneFactor;
	const pool: PoolEntry[] = [];

	// ===== 正面 · 机缘类 =====
	pool.push({
		weight: 50 * ff,
		run: () => {
			const event = FORTUNE_EVENTS[Math.floor(Math.random() * FORTUNE_EVENTS.length)];
			if (Math.random() < 0.4 && grantRandomPill()) {
				addLog(`${event.text} 丹缘也随之而至！`, "success");
			} else {
				addLog(event.text, "success");
			}
			return { mult: event.xpMultiplier };
		},
	});

	pool.push({
		weight: 6 * ff,
		run: () => {
			const mult = 8 + Math.floor(Math.random() * 5);
			addLog(`你忽闻大道之声，当场顿悟！本息修为 ×${mult}！`, "success");
			return { mult };
		},
	});

	pool.push({
		weight: 26 * ff,
		run: () => {
			const mult = 2 + Math.floor(Math.random() * 3);
			addLog(`有道友登门论道，一番印证让你获益匪浅（收益 ×${mult}）！`, "success");
			return { mult };
		},
	});

	pool.push({
		weight: 9 * ff,
		run: () => {
			player.veinLeft += 30;
			addLog("地底灵脉喷发！灵气如潮，30 息内修炼收益 ×3！", "success");
		},
	});

	pool.push({
		weight: 18 * ff,
		run: () => {
			player.springLeft += 20;
			addLog("你寻得一处上古灵泉，泉水沁体，20 息内修炼收益 ×2！", "success");
		},
	});

	pool.push({
		weight: 16 * ff,
		run: () => {
			if (grantRandomPill()) {
				addLog("山中采药的白发老人见你顺眼，笑着塞给你一颗丹药便飘然而去。", "success");
			} else {
				addLog("一位采药老人与你攀谈半日，临走传了你一句吐纳口诀。", "success");
			}
			return { mult: 2 };
		},
	});

	pool.push({
		weight: 12 * ff,
		run: () => {
			const delta = base * 15;
			const gotPill = Math.random() < 0.35 && grantRandomPill();
			addLog(
				gotPill
					? `你误入一座古修遗府，搜得灵石丹药，修为 +${delta}！`
					: `你误入一座古修遗府，将府中残余灵气尽数炼化，修为 +${delta}！`,
				"success",
			);
			return { delta };
		},
	});

	pool.push({
		weight: 6 * ff,
		run: () => {
			grantRandomPill();
			addLog("夜空流星坠于身前，竟是一枚包裹丹药的奇异玉盒！", "success");
			return { mult: 3 };
		},
	});

	pool.push({
		weight: 14 * ff,
		run: () => {
			if (Math.random() < 0.3 && grantRandomPill()) {
				addLog("一只通灵白鹿衔来一枚丹丸赠予你，转身跃入林间。", "success");
			} else {
				addLog("一只通灵白鹿绕你三圈而逝，鹿鸣洗心，你灵台一片空明。", "success");
			}
			return { mult: 2 };
		},
	});

	// ===== 负面 · 天灾类（损修为 + 损气血，打坐会自行回血）=====
	pool.push({
		weight: 14,
		run: () => {
			const loss = base * (3 + Math.floor(Math.random() * 3));
			damageHp(maxHp * 0.08);
			addLog(`天地灵气骤然倒灌，你经脉一阵刺痛，损失 ${loss} 点修为、少许气血。`, "danger");
			return { delta: -loss };
		},
	});

	pool.push({
		weight: 9,
		run: () => {
			const loss = base * (2 + Math.floor(Math.random() * 2));
			damageHp(maxHp * 0.05);
			addLog(`昔日征战留下的暗伤隐隐发作，散去 ${loss} 点修为与些许气血。`, "warning");
			return { delta: -loss };
		},
	});

	pool.push({
		weight: 4,
		run: () => {
			const loss = base * (8 + Math.floor(Math.random() * 4));
			damageHp(maxHp * 0.15);
			addLog(`一道空间裂缝在身侧撕开，虚空乱流绞散灵力，损失 ${loss} 点修为、15% 气血！`, "danger");
			return { delta: -loss };
		},
	});

	pool.push({
		weight: 10,
		run: () => {
			const loss = base * (1 + Math.floor(Math.random() * 2));
			damageHp(maxHp * 0.04);
			addLog(`山中毒瘴飘过，你屏息驱毒，耗去 ${loss} 点修为。`, "warning");
			return { delta: -loss };
		},
	});

	// ===== 心魔劫：自动硬抗（70% 反获修为，30% 损修为+气血）=====
	if (demonWeight > 0) {
		pool.push({
			weight: demonWeight,
			run: () => {
				if (Math.random() < 0.7) {
					const gain = base * 2;
					addLog(`心魔骤起，你剑心通明一剑斩灭，反获 ${gain} 点修为！`, "success");
					return { delta: gain };
				}
				const loss = Math.floor(player.xp * 0.08 * rootDemonLossMult);
				damageHp(maxHp * 0.1);
				addLog(`心魔反噬！你强行压下幻念，损失 ${loss} 修为与一成气血。`, "danger");
				return { delta: -loss };
			},
		});
	}

	// ===== 妖兽突袭：按战力自动战斗（不中断打坐）=====
	pool.push({
		weight: 34,
		run: () => {
			const beast = BEAST_NAMES[Math.floor(Math.random() * BEAST_NAMES.length)];
			const result = simulateBattle();
			player.hp = result.remainHp;
			if (result.win) {
				const gain = base * (4 + Math.floor(Math.random() * 4));
				player.battlesWon += 1;
				if (Math.random() < 0.3 && grantRandomPill()) {
					addLog(`一头「${beast}」突袭洞府，被你 ${result.rounds} 合斩杀！获 ${gain} 修为，妖丹炼成丹药。`, "success");
				} else {
					addLog(`一头「${beast}」突袭洞府，被你 ${result.rounds} 合斩杀！获 ${gain} 修为。`, "success");
				}
				return { delta: gain };
			}
			player.battlesLost += 1;
			const loss = Math.floor(player.xp * 0.05);
			addLog(`一头「${beast}」突袭洞府，你苦战败退（剩 ${result.remainHp} 气血），损失 ${loss} 修为。`, "danger");
			return { delta: -loss };
		},
	});

	// ===== 坊市奇遇：六折划算且修为足够时自动成交 =====
	const marketPool = availablePills();
	if (marketPool.length > 0) {
		pool.push({
			weight: 20,
			run: () => {
				const pill = marketPool[Math.floor(Math.random() * marketPool.length)];
				const price = Math.floor(pill.cost * 0.6);
				if (player.xp >= price) {
					player.xp -= price;
					player.pills[pill.id] += 1;
					addLog(`云游商贩六折兜售「${pill.name}」，你果断买下（-${price} 修为）。`, "success");
				} else {
					addLog(`云游商贩六折兜售「${pill.name}」，可惜你修为不足，只能目送。`);
				}
			},
		});
	}

	// ===== 拍卖会：七折拍高一阶丹药 =====
	const higherPill = PILLS.find((p) => p.minRealm === player.realmIndex + 1) ?? null;
	if (higherPill) {
		pool.push({
			weight: 12,
			run: () => {
				const price = Math.floor(higherPill.cost * 0.7);
				if (player.xp >= price) {
					player.xp -= price;
					player.pills[higherPill.id] += 1;
					addLog(`修士拍卖会上你七折拍下高一阶的「${higherPill.name}」（-${price} 修为）。`, "success");
				} else {
					addLog("修士拍卖会上奇丹频出，你囊中羞涩，旁观一场。");
				}
			},
		});
	}

	// ===== 散修求助：修为足够则解囊（60% 知恩图报）=====
	pool.push({
		weight: 18,
		run: () => {
			const fee = base * 10;
			if (player.xp < fee) {
				addLog("一名重伤散修求助于你，你自身修为也不宽裕，只好闭门不见。");
				return;
			}
			player.xp -= fee;
			if (Math.random() < 0.6) {
				if (Math.random() < 0.5) {
					player.xp += fee * 2;
					addLog(`重伤散修三日后归来报恩，双倍奉还（+${fee} 修为）！`, "success");
				} else {
					grantRandomPill();
					addLog("重伤散修三日后归来，赠你一颗丹药以报救命之恩！", "success");
				}
			} else {
				addLog("那散修拿了修为便再无音讯……修仙界果然人心难测。", "warning");
			}
		},
	});

	const totalWeight = pool.reduce((s, e) => s + e.weight, 0);
	let roll = Math.random() * totalWeight;
	for (const entry of pool) {
		roll -= entry.weight;
		if (roll <= 0) return entry.run(base) ?? {};
	}
	return {};
}

// ==================== 打坐 ====================

let breathTimer: ReturnType<typeof setInterval> | null = null;

function breathTick() {
	let xpGain = breathXp + Math.floor(Math.random() * (breathXp * 0.6 + 1));

	if (player.ningshenLeft > 0) { xpGain *= 2; player.ningshenLeft -= 1; }
	if (player.springLeft > 0) { xpGain *= 2; player.springLeft -= 1; }
	if (player.veinLeft > 0) { xpGain *= 3; player.veinLeft -= 1; }
	if (player.wudaoLeft > 0) player.wudaoLeft -= 1;

	// 打坐同时疗伤：每息恢复 3% 上限气血；冷却递减
	if (player.hp < maxHp) healHp(maxHp * 0.03);
	for (const id of Object.keys(player.cooldowns)) {
		if (player.cooldowns[id] > 0) player.cooldowns[id] -= 1;
	}

	// 事件即时结算，不中断打坐
	if (Math.random() < eventChance) {
		const result = rollRandomEvent(xpGain);
		xpGain = xpGain * (result.mult ?? 1) + (result.delta ?? 0);
	} else if (Math.random() < 0.12) {
		addLog(CULTIVATE_TEXTS[Math.floor(Math.random() * CULTIVATE_TEXTS.length)]);
	}

	player.xp = Math.max(0, player.xp + xpGain);
	player.totalBreaths += 1;
	lastGain = xpGain;
	save();
}

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

onDestroy(() => stopMeditation());

/**
 * 传送门动作：把弹窗节点直接挂到 <body> 下。
 * 原因：外层布局的页面过渡动画带有 transform，会使内部 position:fixed
 * 相对该容器而非浏览器视口定位，导致弹窗偏下、遮罩盖不全；挂到 body 后恢复正常。
 */
function portal(node: HTMLElement) {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		},
	};
}

// 任意弹窗打开时锁定背景滚动，关闭后恢复
$effect(() => {
	if (showThunderModal || showBreakthroughModal) {
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = prev;
		};
	}
});

// ==================== 丹药 ====================

function usePill(pill: Pill) {
	if (player.pills[pill.id] <= 0) return;
	player.pills[pill.id] -= 1;

	switch (pill.id) {
		case "juqi":
			player.xp += 120;
			addLog("你服下一颗聚气丹，灵力增长 120 点。", "success");
			break;
		case "huichun":
			healHp(maxHp * 0.5);
			addLog("你服下回春丹，温润药力游走四肢百骸，恢复 50% 气血。", "success");
			break;
		case "ningshen":
			player.ningshenLeft += 30;
			addLog("你服下一颗凝神丹，接下来 30 息修炼收益翻倍。", "success");
			break;
		case "pojing":
			player.pojingActive = true;
			addLog("你服下一颗破境丹，下次突破成功率大增。", "success");
			break;
		case "quti":
			// 累计服用数 +1，derived 上限同步 +80，再把新增的 80 点补满
			player.qutiUsed += 1;
			healHp(80);
			addLog("淬体丹药力淬炼筋骨，气血上限永久 +80！", "success");
			break;
		case "zengyuan":
			// 累计服用数 +1，攻击 derived 同步 +8
			player.zengyuanUsed += 1;
			addLog("增元丹真元入体，攻击永久 +8！", "success");
			break;
		case "tianyuan":
			player.xp += 2500;
			addLog("你服下一颗天元丹，修为暴涨 2500 点！", "success");
			break;
		case "wudao":
			player.wudaoLeft += 60;
			addLog("你服下一颗悟道丹，60 息内机缘类事件概率三倍！", "success");
			break;
		case "jiuzhuan":
			player.xp += 15000;
			addLog("九转金丹入口即化，修为狂涨 15000 点！！", "success");
			break;
	}
	save();
}

/** 炼丹：按丹药境界决定成功率，失败损失修为材料 */
function buyPill(pill: Pill) {
	if (player.xp < pill.cost || player.realmIndex < pill.minRealm) return;
	player.xp -= pill.cost;
	const rate = craftSuccessRate(pill.minRealm);
	if (Math.random() < rate) {
		player.pills[pill.id] += 1;
		addLog(`丹炉开启，你成功炼制出一颗「${pill.name}」（成功率 ${Math.round(rate * 100)}%）。`);
	} else {
		addLog(`「${pill.name}」炼制失败，丹炉炸响，${pill.cost} 修为的药材尽数报废（成功率 ${Math.round(rate * 100)}%）。`, "danger");
	}
	save();
}

// ==================== 斗法台 ====================

/** 生成某对手当前数值（随玩家境界动态变化） */
function getEnemy(tpl: EnemyTemplate): EnemyStats {
	const level = Math.max(1, currentRealm.level + tpl.levelOffset);
	const base = makeEnemy(level, 1, 1);
	return { tpl, level, ...base };
}

/** 主动挑战斗法台对手 */
function challengeEnemy(tpl: EnemyTemplate) {
	const cd = player.cooldowns[tpl.id] ?? 0;
	if (cd > 0) return;
	if (player.hp < maxHp * MIN_HP_RATIO) {
		addLog(`你气血不足三成，不宜斗法，先打坐疗伤或服回春丹吧。`, "warning");
		return;
	}

	const enemy = getEnemy(tpl);
	// 回合制模拟：玩家先手
	let php = player.hp;
	let ehp = enemy.hp;
	let rounds = 0;
	while (php > 0 && ehp > 0 && rounds < 60) {
		ehp -= Math.max(1, atk - enemy.def * 0.5);
		if (ehp <= 0) break;
		php -= Math.max(1, enemy.atk - def * 0.5);
		rounds += 1;
	}
	const win = ehp <= 0;
	player.hp = Math.max(0, php);

	if (win) {
		const reward = Math.round(enemy.power * tpl.rewardFactor * 0.6);
		player.xp += reward;
		player.battlesWon += 1;
		player.cooldowns[tpl.id] = BATTLE_COOLDOWN;
		const gotPill = Math.random() < 0.35 && grantRandomPill();
		addLog(
			`斗法台 · 你 ${rounds + 1} 合击败「${tpl.name}」（战力 ${enemy.power}），获 ${reward} 修为${gotPill ? "与一颗丹药" : ""}！`,
			"success",
		);
	} else {
		const loss = Math.floor(player.xp * 0.05);
		player.xp = Math.max(0, player.xp - loss);
		player.battlesLost += 1;
		addLog(
			`斗法台 · 你不敌「${tpl.name}」（战力 ${enemy.power}），力竭败退，损失 ${loss} 修为，气血见底！`,
			"danger",
		);
	}
	save();
}

// ==================== 突破与雷劫 ====================

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
			damageHp(maxHp * 0.1);
			thunderPenalty += 0.12;
			addLog(`第 ${thunderRound} 道天雷将你劈得皮开肉绽，损失 ${loss} 修为、一成气血！`, "danger");
		}
		thunderStriking = false;
		thunderRound += 1;
		save();
		if (thunderRound > 3) {
			setTimeout(() => {
				showThunderModal = false;
				doBreakthroughCheck(Math.max(0.15, lastSuccessRate - thunderPenalty));
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
				doBreakthroughCheck(Math.max(0.15, lastSuccessRate - 0.25 - thunderPenalty));
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
		if (Math.random() < rate) {
			player.realmIndex += 1;
			player.lastBreakthrough = new Date().toLocaleString("zh-CN");
			// 境界提升后气血回满，以示庆贺且避免新境界残血
			player.hp = maxHp;
			breakthroughResult = "success";
			addLog(`恭喜！你成功突破至 ${REALMS[player.realmIndex].name}！${usedPojing ? "（破境丹之效）" : ""}`, "success");
		} else {
			const loss = Math.floor(player.xp * 0.15);
			player.xp = Math.max(0, player.xp - loss);
			damageHp(maxHp * 0.1);
			breakthroughResult = "fail";
			addLog(`突破失败！真元逆流，损失 ${loss} 修为与一成气血。`, "danger");
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
		hp: 100,
		lastBreakthrough: null,
		totalBreaths: 0,
		pills: { ...EMPTY_PILLS },
		ningshenLeft: 0,
		springLeft: 0,
		wudaoLeft: 0,
		veinLeft: 0,
		pojingActive: false,
		aptitude: null,
		rootCombo: null,
		spiritualRoots: [],
		physique: null,
		thunderPassed: 0,
		battlesWon: 0,
		battlesLost: 0,
		qutiUsed: 0,
		zengyuanUsed: 0,
		cooldowns: {},
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
		<!-- ========== 创角：三转盘 ========== -->
		<div class="realm-card creation-card">
			<h2 class="creation-title">天命三测</h2>
			<p class="creation-desc">资质、灵根、体质，三者定汝仙途。依次启动转盘，各测天命。</p>

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
		<!-- ========== 主界面 ========== -->
		<div class="realm-card">
			<div class="realm-header">
				<span class="realm-badge">第 {currentRealm.level} 重</span>
				<h2 class="realm-name">{currentRealm.name}</h2>
				{#if player.ningshenLeft > 0}
					<span class="buff-badge buff-blue">凝神 ×2 · {player.ningshenLeft} 息</span>
				{/if}
				{#if player.springLeft > 0}
					<span class="buff-badge buff-cyan">灵泉 ×2 · {player.springLeft} 息</span>
				{/if}
				{#if player.wudaoLeft > 0}
					<span class="buff-badge buff-pink">悟道 ×3 · {player.wudaoLeft} 息</span>
				{/if}
				{#if player.veinLeft > 0}
					<span class="buff-badge buff-green">灵脉 ×3 · {player.veinLeft} 息</span>
				{/if}
			</div>

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

			<!-- 修为进度 -->
			<div class="xp-section">
				<div class="xp-bar">
					<div class="xp-fill" class:glowing={isMeditating} style="width: {progressPercent}%"></div>
				</div>
				<div class="xp-text">
					<span>修为: {player.xp.toLocaleString()}</span>
					{#if nextRealm}<span>/ {nextRealm.requiredXp.toLocaleString()}</span>{:else}<span>（已臻化境）</span>{/if}
				</div>
			</div>

			<!-- 战力面板：气血 / 攻击 / 防御 / 战力 -->
			<div class="power-panel">
				<div class="hp-block">
					<div class="stat-label">
						<span>气血</span>
						<span class:hp-low={hpPercent < 30}>{Math.round(player.hp)} / {maxHp}（{hpPercent}%）</span>
					</div>
					<div class="hp-bar">
						<div class="hp-fill" class:hp-low-fill={hpPercent < 30} style="width: {hpPercent}%"></div>
					</div>
				</div>
				<div class="stat-grid">
					<div class="stat-cell"><span class="stat-num">{atk}</span><span class="stat-key">攻击</span></div>
					<div class="stat-cell"><span class="stat-num">{def}</span><span class="stat-key">防御</span></div>
					<div class="stat-cell stat-power"><span class="stat-num">{battlePower.toLocaleString()}</span><span class="stat-key">战力</span></div>
				</div>
			</div>

			<!-- 打坐面板 -->
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
							<span class="status-running">运转周天中 · 每息约 +{lastGain ?? breathXp}（同步疗伤）</span>
						{:else}
							<span class="status-idle">入定吐纳 · 奇遇天灾自动降临，不再中断</span>
						{/if}
					</div>
					<button class="btn meditate-btn" class:pause={isMeditating} onclick={toggleMeditation}>
						{isMeditating ? "暂停打坐" : "开始打坐"}
					</button>
				</div>
			</div>

			{#if canBreakthrough}
				<button class="btn breakthrough-btn" onclick={attemptBreakthrough}>
					{nextRealm.thunderTrial ? "渡劫突破" : "尝试突破"} → {nextRealm.name}（成功率 {(successRate * 100).toFixed(0)}%{player.pojingActive ? " · 破境丹已备" : ""}）
				</button>
				{#if nextRealm.thunderTrial}
					<p class="thunder-hint">大境界突破需硬渡三道天雷，每道失败损修为气血并削弱突破之势；破境丹可祭出抵挡一道。</p>
				{/if}
			{:else if nextRealm}
				<div class="breakthrough-hint">距「{nextRealm.name}」还需 {(nextRealm.requiredXp - player.xp).toLocaleString()} 点修为</div>
			{/if}

			<div class="stats">
				<span>累计吐纳: {player.totalBreaths} 息</span>
				<span>斗法战绩: {player.battlesWon} 胜 / {player.battlesLost} 负</span>
				{#if player.lastBreakthrough}<span>上次突破: {player.lastBreakthrough}</span>{/if}
				<button class="reset-btn" onclick={resetGame}>兵解转世</button>
			</div>
		</div>

		<!-- ========== 斗法台 ========== -->
		<div class="arena-card">
			<div class="pill-header">
				<h3 class="pill-title">斗法台</h3>
				<span class="pill-subtitle">我方战力 {battlePower.toLocaleString()} · 气血低于 30% 不可挑战 · 胜后冷却 {BATTLE_COOLDOWN} 息</span>
			</div>
			<div class="arena-list">
				{#each ENEMY_TEMPLATES as tpl (tpl.id)}
					{@const enemy = getEnemy(tpl)}
					{@const cd = player.cooldowns[tpl.id] ?? 0}
					{@const weaker = enemy.power < battlePower}
					<div class="arena-item">
						<div class="arena-info">
							<div class="arena-name">
								{tpl.name}
								<span class="arena-title">{tpl.title}</span>
								<span class="arena-tag" class:tag-danger={!weaker} class:tag-safe={weaker}>
									{weaker ? "势弱" : "势强"}
								</span>
							</div>
							<div class="arena-stats">
								战力 {enemy.power.toLocaleString()} · 胜赏约 {Math.round(enemy.power * tpl.rewardFactor * 0.6).toLocaleString()} 修为
								{#if cd > 0}<span class="arena-cd"> · 冷却 {cd} 息</span>{/if}
							</div>
						</div>
						<button
							class="btn arena-btn"
							disabled={cd > 0 || player.hp < maxHp * MIN_HP_RATIO}
							onclick={() => challengeEnemy(tpl)}
						>
							{cd > 0 ? "休整中" : "挑战"}
						</button>
					</div>
				{/each}
			</div>
		</div>

		<!-- ========== 炼丹坊 ========== -->
		<div class="pill-card">
			<div class="pill-header">
				<h3 class="pill-title">丹药 · 炼丹坊</h3>
				<span class="pill-subtitle">高阶丹药需对应境界 · 炼制有失败率，失败损失药材</span>
			</div>
			<div class="pill-list">
				{#each PILLS as pill (pill.id)}
					{@const locked = player.realmIndex < pill.minRealm}
					{@const craftRate = Math.round(craftSuccessRate(pill.minRealm) * 100)}
					<div class="pill-item" class:pill-locked={locked}>
						<span class="pill-orb" style={`background: radial-gradient(circle at 35% 30%, ${pill.color}, ${pill.color}88)`}></span>
						<div class="pill-info">
							<div class="pill-name">{pill.name} <span class="pill-count">×{player.pills[pill.id]}</span></div>
							<div class="pill-desc">
								{#if locked}
									需达「{REALMS[pill.minRealm].name}」方可炼制
								{:else}
									{pill.desc} · 炼丹成功率 {craftRate}%
									{#if pill.id === "quti"} · 已淬体 {player.qutiUsed} 次（+{player.qutiUsed * 80} 上限）{/if}
									{#if pill.id === "zengyuan"} · 已增元 {player.zengyuanUsed} 次（+{player.zengyuanUsed * 8} 攻击）{/if}
								{/if}
							</div>
						</div>
						<div class="pill-actions">
							<button class="btn pill-use" disabled={player.pills[pill.id] <= 0} onclick={() => usePill(pill)}>服用</button>
							<button class="btn pill-buy" disabled={locked || player.xp < pill.cost} onclick={() => buyPill(pill)}>
								炼制 {pill.cost}
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- ========== 日志 ========== -->
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
		<div class="modal-overlay" use:portal>
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
						<button class="btn pill-use" disabled={thunderStriking || player.pills.pojing <= 0} onclick={usePillForThunder}>
							祭出破境丹（余 {player.pills.pojing}）
						</button>
					</div>
				{:else}
					<p class="thunder-text">天雷已尽，成败在此一举...</p>
				{/if}
			</div>
		</div>
	{/if}

	<!-- ========== 突破结果弹窗 ========== -->
	{#if showBreakthroughModal}
		<div class="modal-overlay" use:portal onclick={closeModal}>
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
						<p>真元逆流，损失 15% 修为与一成气血。再战！</p>
						<button class="btn" onclick={closeModal}>继续修炼</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
.xiuxian-game { display: flex; flex-direction: column; gap: 1.5rem; }

.realm-card, .pill-card, .log-card, .arena-card {
	background: var(--card-bg, rgba(255, 255, 255, 0.03));
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.15));
	border-radius: 1rem;
	padding: 1.5rem;
}

.realm-header { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.realm-badge {
	font-size: 0.75rem; padding: 0.2rem 0.6rem; border-radius: 999px;
	background: var(--primary, #6366f1); color: #fff;
}
.realm-name { font-size: 1.75rem; font-weight: 700; margin: 0; }
.buff-badge { font-size: 0.75rem; padding: 0.2rem 0.6rem; border-radius: 999px; }
.buff-blue { background: rgba(96, 165, 250, 0.15); color: #60a5fa; }
.buff-cyan { background: rgba(125, 211, 252, 0.15); color: #7dd3fc; }
.buff-pink { background: rgba(244, 114, 182, 0.15); color: #f472b6; }
.buff-green { background: rgba(52, 211, 153, 0.15); color: #34d399; }

.talent-row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; }
.talent-tag { font-size: 0.75rem; padding: 0.15rem 0.6rem; border-radius: 999px; border: 1px solid; }
.root-tag { border-color: rgba(96, 165, 250, 0.4); color: #60a5fa; }
.thunder-tag { border-color: rgba(250, 204, 21, 0.4); color: #facc15; }
.battle-tag { border-color: rgba(239, 68, 68, 0.4); color: #ef4444; }

.realm-desc { color: var(--content-meta, #9ca3af); margin: 0.75rem 0 1.25rem; font-size: 0.9rem; }

/* ===== 修为条 ===== */
.xp-bar { height: 0.75rem; background: rgba(128, 128, 128, 0.15); border-radius: 999px; overflow: hidden; }
.xp-fill {
	height: 100%; background: linear-gradient(90deg, var(--primary, #6366f1), #a78bfa);
	border-radius: 999px; transition: width 0.5s ease;
}
.xp-fill.glowing { animation: xpGlow 2s ease-in-out infinite; }
@keyframes xpGlow { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.35); } }
.xp-text { display: flex; gap: 0.35rem; font-size: 0.85rem; color: var(--content-meta, #9ca3af); margin-top: 0.4rem; }

/* ===== 战力面板 ===== */
.power-panel {
	margin-top: 1.25rem;
	padding: 1rem 1.25rem;
	border-radius: 0.75rem;
	background: rgba(128, 128, 128, 0.06);
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.12));
}
.hp-block { margin-bottom: 0.85rem; }
.stat-label {
	display: flex; justify-content: space-between;
	font-size: 0.8rem; font-weight: 600; margin-bottom: 0.35rem;
}
.hp-low { color: #f87171; }
.hp-bar { height: 0.65rem; border-radius: 999px; background: rgba(128, 128, 128, 0.18); overflow: hidden; }
.hp-fill {
	height: 100%; border-radius: 999px;
	background: linear-gradient(90deg, #22c55e, #4ade80);
	transition: width 0.4s ease;
}
.hp-fill.hp-low-fill { background: linear-gradient(90deg, #dc2626, #f87171); }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; }
.stat-cell {
	display: flex; flex-direction: column; align-items: center; gap: 0.15rem;
	padding: 0.5rem; border-radius: 0.6rem; background: rgba(128, 128, 128, 0.08);
}
.stat-num { font-size: 1.2rem; font-weight: 800; color: var(--primary, #818cf8); }
.stat-power .stat-num { color: #fbbf24; }
.stat-key { font-size: 0.72rem; color: var(--content-meta, #9ca3af); }

/* ===== 打坐 ===== */
.meditation-panel {
	display: flex; align-items: center; gap: 1.25rem;
	margin-top: 1.25rem; padding: 1rem 1.25rem;
	border-radius: 0.75rem; border: 1px dashed var(--line-divider, rgba(128, 128, 128, 0.25));
	transition: border-color 0.3s;
}
.meditation-panel.active { border-color: var(--primary, #6366f1); }
.meditation-orb {
	width: 3.5rem; height: 3.5rem; border-radius: 50%;
	display: flex; align-items: center; justify-content: center;
	background: rgba(128, 128, 128, 0.12); flex-shrink: 0;
}
.meditation-orb.breathing {
	background: radial-gradient(circle at 35% 30%, var(--primary, #6366f1), #312e81);
	animation: breathe 2s ease-in-out infinite;
}
@keyframes breathe {
	0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
	50% { transform: scale(1.12); box-shadow: 0 0 24px 6px rgba(99, 102, 241, 0.35); }
}
.orb-inner { width: 1rem; height: 1rem; border-radius: 50%; background: rgba(255, 255, 255, 0.85); }
.orb-idle { color: var(--content-meta, #9ca3af); font-size: 1.1rem; }
.meditation-info { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex: 1; flex-wrap: wrap; }
.status-running { color: var(--primary, #6366f1); font-size: 0.9rem; }
.status-idle { color: var(--content-meta, #9ca3af); font-size: 0.9rem; }

/* ===== 按钮 ===== */
.btn {
	padding: 0.55rem 1.25rem; border-radius: 0.6rem; font-size: 0.9rem; font-weight: 600;
	cursor: pointer; border: none; background: var(--primary, #6366f1); color: #fff;
	transition: transform 0.15s, opacity 0.15s, filter 0.15s;
}
.btn:hover:not(:disabled) { filter: brightness(1.1); }
.btn:active:not(:disabled) { transform: scale(0.96); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.meditate-btn.pause { background: #f59e0b; }
.breakthrough-btn {
	width: 100%; margin-top: 1rem;
	background: linear-gradient(90deg, #7c3aed, #6366f1); padding: 0.8rem;
}
.thunder-actions .breakthrough-btn { width: auto; margin-top: 0; }
.thunder-hint { font-size: 0.78rem; color: #fbbf24; margin-top: 0.5rem; line-height: 1.5; }
.breakthrough-hint { text-align: center; font-size: 0.85rem; color: var(--content-meta, #9ca3af); margin-top: 1rem; }

.stats {
	display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;
	font-size: 0.78rem; color: var(--content-meta, #9ca3af); margin-top: 1rem;
}
.reset-btn {
	margin-left: auto; font-size: 0.75rem; color: #f87171;
	background: none; border: none; cursor: pointer; opacity: 0.7;
}
.reset-btn:hover { opacity: 1; text-decoration: underline; }

/* ===== 斗法台 ===== */
.arena-list { display: flex; flex-direction: column; gap: 0.75rem; }
.arena-item {
	display: flex; align-items: center; gap: 0.85rem;
	padding: 0.75rem 0.9rem; border-radius: 0.75rem;
	background: rgba(128, 128, 128, 0.06);
	border: 1px solid transparent;
}
.arena-info { flex: 1; min-width: 0; }
.arena-name { font-weight: 700; font-size: 0.95rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.arena-title { font-size: 0.72rem; font-weight: 400; color: var(--content-meta, #9ca3af); }
.arena-tag { font-size: 0.68rem; padding: 0.05rem 0.45rem; border-radius: 999px; }
.tag-safe { background: rgba(52, 211, 153, 0.15); color: #34d399; }
.tag-danger { background: rgba(248, 113, 113, 0.15); color: #f87171; }
.arena-stats { font-size: 0.76rem; color: var(--content-meta, #9ca3af); margin-top: 0.2rem; }
.arena-cd { color: #fbbf24; }
.arena-btn {
	flex-shrink: 0; padding: 0.45rem 1.1rem;
	background: linear-gradient(90deg, #dc2626, #ef4444);
}

/* ===== 丹药 ===== */
.pill-header { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; }
.pill-title { font-size: 1.1rem; font-weight: 700; margin: 0; }
.pill-subtitle { font-size: 0.78rem; color: var(--content-meta, #9ca3af); }
.pill-list { display: flex; flex-direction: column; gap: 0.75rem; }
.pill-item {
	display: flex; align-items: center; gap: 0.85rem;
	padding: 0.6rem 0.75rem; border-radius: 0.6rem; background: rgba(128, 128, 128, 0.06);
}
.pill-item.pill-locked { opacity: 0.55; }
.pill-orb { width: 2rem; height: 2rem; border-radius: 50%; flex-shrink: 0; }
.pill-info { flex: 1; min-width: 0; }
.pill-name { font-weight: 600; font-size: 0.9rem; }
.pill-count { color: var(--primary, #6366f1); font-size: 0.8rem; }
.pill-desc { font-size: 0.75rem; color: var(--content-meta, #9ca3af); margin-top: 0.1rem; white-space: pre-line; }
.pill-actions { display: flex; gap: 0.4rem; flex-shrink: 0; }
.pill-use, .pill-buy { padding: 0.35rem 0.7rem; font-size: 0.78rem; }
.pill-buy { background: rgba(128, 128, 128, 0.2); color: inherit; }

/* ===== 日志 ===== */
.log-title { font-size: 1.1rem; font-weight: 700; margin: 0 0 0.75rem; }
.log-list { display: flex; flex-direction: column; gap: 0.35rem; max-height: 16rem; overflow-y: auto; }
.log-empty { font-size: 0.85rem; color: var(--content-meta, #9ca3af); }
.log-entry { display: flex; gap: 0.6rem; font-size: 0.8rem; line-height: 1.45; }
.log-time { color: var(--content-meta, #9ca3af); flex-shrink: 0; font-size: 0.72rem; padding-top: 0.1rem; }
.log-success .log-msg { color: #34d399; }
.log-danger .log-msg { color: #f87171; }
.log-warning .log-msg { color: #fbbf24; }

/* ===== 弹窗 ===== */
.modal-overlay {
	position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);
	display: flex; align-items: center; justify-content: center; z-index: 9999;
}
.modal-content {
	background: var(--card-bg-solid, #1e1e2e);
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.25));
	border-radius: 1rem; padding: 2rem; max-width: 26rem; width: calc(100% - 3rem); text-align: center;
	max-height: calc(100vh - 4rem); overflow-y: auto;
}
.breakthrough-loading .spinner {
	width: 2.5rem; height: 2.5rem;
	border: 3px solid rgba(128, 128, 128, 0.2); border-top-color: var(--primary, #6366f1);
	border-radius: 50%; margin: 0 auto 1rem; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.breakthrough-success .icon, .breakthrough-fail .icon { font-size: 1.5rem; font-weight: 800; margin-bottom: 0.5rem; }
.breakthrough-success .icon { color: #34d399; }
.breakthrough-fail .icon { color: #f87171; }
.modal-content h3 { margin: 0.25rem 0 0.5rem; }
.modal-content .desc { font-size: 0.85rem; color: var(--content-meta, #9ca3af); margin-bottom: 1rem; }

/* ===== 雷劫 ===== */
.thunder-modal { border-color: rgba(250, 204, 21, 0.35); }
.thunder-title { font-size: 1.3rem; font-weight: 800; color: #facc15; margin: 0; }
.thunder-sub { font-size: 0.8rem; color: var(--content-meta, #9ca3af); margin: 0.4rem 0 1.25rem; }
.thunder-track { display: flex; gap: 0.6rem; justify-content: center; margin-bottom: 1.25rem; }
.thunder-bolt {
	padding: 0.5rem 0.9rem; border-radius: 0.6rem; font-size: 0.8rem; font-weight: 600;
	background: rgba(128, 128, 128, 0.12); color: var(--content-meta, #9ca3af); transition: all 0.3s;
}
.thunder-bolt.current { background: rgba(250, 204, 21, 0.15); color: #facc15; border: 1px solid rgba(250, 204, 21, 0.4); }
.thunder-bolt.current.striking { animation: strike 0.5s ease-in-out infinite; }
@keyframes strike { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.8); } }
.thunder-bolt.pass { background: rgba(52, 211, 153, 0.15); color: #34d399; }
.thunder-bolt.fail { background: rgba(248, 113, 113, 0.15); color: #f87171; }
.thunder-text { font-size: 0.9rem; margin-bottom: 0.5rem; }
.thunder-penalty { font-size: 0.78rem; color: #f87171; margin-bottom: 0.75rem; }
.thunder-actions { display: flex; gap: 0.6rem; justify-content: center; flex-wrap: wrap; }

/* ===== 创角 ===== */
.creation-card { text-align: center; }
.creation-title { font-size: 1.6rem; font-weight: 800; margin: 0 0 0.5rem; }
.creation-desc { font-size: 0.9rem; color: var(--content-meta, #9ca3af); margin-bottom: 0.5rem; }
.creation-step { font-size: 1rem; font-weight: 700; margin: 1.5rem 0 0.75rem; text-align: left; }
.wheel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: 0.6rem; margin-bottom: 0.75rem; }
.wheel-item {
	display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
	padding: 0.85rem 0.6rem; border-radius: 0.75rem;
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.2));
	background: rgba(128, 128, 128, 0.05); transition: all 0.12s;
}
.wheel-item.highlight { border-color: var(--primary, #6366f1); background: rgba(99, 102, 241, 0.18); transform: scale(1.04); }
.wheel-item.final { border-color: #fbbf24; background: rgba(251, 191, 36, 0.12); box-shadow: 0 0 16px rgba(251, 191, 36, 0.3); }
.wheel-name { font-weight: 700; font-size: 0.92rem; }
.wheel-weight { font-size: 0.7rem; color: var(--content-meta, #9ca3af); }
.wheel-desc { font-size: 0.72rem; color: var(--content-meta, #9ca3af); line-height: 1.4; }
.creation-actions { margin-top: 1.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.75rem; }
.spin-btn { background: linear-gradient(90deg, #f59e0b, #fbbf24); color: #1c1917; padding: 0.6rem 1.8rem; }
.creation-result { font-size: 0.95rem; font-weight: 600; margin: 0; }
</style>
