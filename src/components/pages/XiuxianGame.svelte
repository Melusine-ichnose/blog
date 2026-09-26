<script lang="ts">
// 修仙修炼游戏核心组件 v6
// 三转盘创角 + 气血/攻防/战力属性 + 持续打坐（事件全即时结算，不中断）
// 斗法台（参数化对手、回合制战力模拟）+ 炼丹失败率 + 战斗丹药
// 数据存储在 localStorage，纯前端实现

import { onDestroy, onMount } from "svelte";

// ==================== 类型定义 ====================

interface Realm {
	name: string;
	level: number;
	requiredXp: number;
	description: string;
	thunderTrial: boolean;
	/** 该境界寿元上限（年），突破时按差值一半补足当前寿元 */
	lifespan: number;
}

type PillId =
	| "juqi" | "huichun" | "ningshen" | "pojing"
	| "quti" | "zengyuan" | "tianyuan" | "wudao" | "jiuzhuan"
	| "shouyuan" | "souljade" | "timesand" | "mirror" | "karmaseal"
	| "huadu" | "peiyuan" | "humai" | "pomo" | "juling" | "bijie";

interface Pill {
	id: PillId;
	name: string;
	color: string;
	desc: string;
	cost: number;
	minRealm: number;
	/** 丹药品阶：仅作展示与定价参考 */
	grade: PillGrade;
	/** v11 丹药分类：修炼 / 突破 / 疗伤 / 奇物（丹药面板分区展示） */
	category: PillCategory;
	/** 仅坊市出售：炼丹坊不可炼制、随机掉落与战斗缴获不产出 */
	shopOnly?: boolean;
}

/** v11 丹药分类顺序（丹药界面按此分区） */
const PILL_CATEGORIES = ["修炼", "突破", "疗伤", "奇物"] as const;
type PillCategory = (typeof PILL_CATEGORIES)[number];

/** 丹药品阶 */
type PillGrade = "凡品" | "灵品" | "宝品" | "仙品" | "神品";
const GRADE_COLORS: Record<PillGrade, string> = {
	凡品: "#9ca3af",
	灵品: "#34d399",
	宝品: "#c084fc",
	仙品: "#fbbf24",
	神品: "#e879f9",
};

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
	atkMult?: number; // 攻击加成（玄金战体等战体）
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

// ==================== v10 黑暗轮回全系统类型 ====================

/** 开局难度（锁定本周目，轮回后可重选） */
type Difficulty = "gentle" | "normal" | "hard";

interface DifficultyCfg {
	id: Difficulty;
	name: string;
	color: string;
	desc: string;
	xpMult: number; // 修炼收益系数
	enemyMult: number; // 敌人伤害系数
	debtMult: number; // 因果债积累系数
	dropBonus: number; // 掉落概率加成
	gentleDeath: boolean; // 温和难度：突破失败只重伤不身死
	deathRisk: number; // v11 斗法败北身殒概率（绝地专属）
}

/** 符咒类型：strike 五雷符 / seal 镇妖符 / clear 清心符 / anti 破劫符 / life 替死符 */
type TalismanId = "strike" | "seal" | "clear" | "anti" | "life";

interface Talisman {
	id: TalismanId;
	name: string;
	color: string;
	desc: string;
	price: number; // 坊市售价（灵石）
	minRealm: number;
}

/** 灵虫：装配三槽提供被动加成，饥饿时效果减半 */
interface Worm {
	id: string;
	name: string;
	rarity: EquipRarity;
	color: string;
	desc: string;
	xpMult?: number; // 修炼加成
	atk?: number;
	def?: number;
	hp?: number;
	demonCut?: number; // 心魔抗性（降低心魔积累，点）
	gatherMult?: number; // 灵石产出系数
}

/** 功法槽位：core 主修心法 / body 炼体 / attack 攻伐 */
type ManualSlot = "core" | "body" | "attack";

/** 法宝槽位：weapon 武器（攻击）/ armor 护甲（防御）/ artifact 法宝（气血上限） */
type EquipSlot = "weapon" | "armor" | "artifact";
type EquipRarity = "凡品" | "灵品" | "宝器" | "仙器";

/** 法宝实例（掉落时生成唯一 id，强化等级记录在实例上） */
interface EquipItem {
	id: string;
	name: string;
	slot: EquipSlot;
	rarity: EquipRarity;
	base: number;
	enhance: number; // 强化等级 0~9，每级 +10%×base（向下取整）
}

interface Manual {
	id: string;
	name: string;
	slot: ManualSlot;
	rarity: "凡品" | "灵品" | "宝品" | "天品";
	color: string;
	desc: string;
	xpMult?: number; // 主修：打坐收益倍率
	breakBonus?: number; // 主修：突破成功率加成
	gatherMult?: number; // v11 主修：打坐灵石产出倍率（商道类功法）
	hpBonus?: number; // 炼体：气血上限
	defBonus?: number; // 炼体：防御
	atkBonus?: number; // 攻伐：攻击
	dmgMult?: number; // 攻伐：造成伤害倍率
	hint: string; // 未获得时展示的获取线索
}

/** 交互式斗法的运行时状态 */
interface BattleState {
	tplId: string;
	source: "arena" | "tower"; // 敌人来源：斗法台 / 试炼塔（复用同一套回合战斗）
	towerN: number; // 试炼层数（斗法台为 0）
	enemyName: string;
	enemyTitle: string;
	ehp: number;
	ehpMax: number;
	eatk: number;
	edef: number;
	epower: number;
	rounds: number;
	logs: LogEntry[];
	status: "fighting" | "win" | "lose" | "retreat";
	reward: number; // 胜利为修为奖励，失败为损失（正数）
	firstClear: boolean; // 本场是否为首通
	manualName: string | null; // 首通获得的功法名
	pillName: string | null; // 胜利额外掉落的丹药名
	stoneGain: number; // 胜利获得的灵石
	equipName: string | null; // 胜利掉落的法宝名
	stunned: boolean; // 镇妖符：本回合敌人无法反击
	killUsed: boolean; // 本场是否已用过道衍杀招
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
	julingLeft: number; // v11 聚灵丹剩余息数（期间打坐灵石产出翻倍）
	pojingActive: boolean;
	aptitude: string | null;
	rootCombo: string | null;
	spiritualRoots: string[];
	physique: string | null;
	thunderPassed: number;
	battlesWon: number;
	battlesLost: number;
	qutiUsed: number; // 累计已服淬体丹数（永久 +30×当前境界 气血上限/颗，随境界散开）
	zengyuanUsed: number; // 累计已服增元丹数（永久 +2×当前境界 攻击/颗）
	manuals: string[]; // 已获得的功法 id
	equipped: Record<ManualSlot, string | null>; // 三槽位装备中的功法
	defeated: Record<string, boolean>; // 斗法台首通记录（对手 id）
	cooldowns: Record<string, number>; // 对手 id → 剩余冷却息数
	stones: number; // 灵石（坊市货币）
	equip: Record<EquipSlot, EquipItem | null>; // 法宝三槽
	bag: EquipItem[]; // 行囊（上限 20，溢出折算灵石）
	towerFloor: number; // 无尽试炼塔已通关最高层
	lastSeen: number; // 上次存档时间戳（离线闭关结算用）
	log: LogEntry[];
	// v9 黑暗轮回系统字段
	lifespan: number; // 当前剩余寿元（年）
	karma: number; // 业力（斗法/试炼胜者累积，影响天劫通过率）
	karmaDebt: number; // 因果债（残魂玉/光阴碎片/逆术使用后累积，≥200 触发命运劫死亡）
	souljadeUsed: number; // 当前周目残魂玉已用次数（上限 3）
	// v10 全系统字段
	difficulty: Difficulty; // 开局难度（本周目锁定）
	demon: number; // 心魔值 0~100（败北/雷劫/杀招积累，高时削突破、可走火入魔）
	toxin: number; // 丹毒值 0~100（服丹积累，高时削修炼，打坐自然消解）
	talismans: Record<TalismanId, number>; // 符咒库存
	worms: string[]; // 已拥有的灵虫 id
	wormEquip: (string | null)[]; // 灵虫三槽
	wormHunger: number; // 灵虫饥饿度 0~100（越高加成越弱，需灵石喂养）
	landLevel: number; // 福地等级 0~5
	// v10.1 道侣 / 黑市 / 躯府 / 因果秘术
	schemaV: number; // 存档结构版本
	reputation: number; // 善恶声望（NPC 观感，区别于天地业力；邪道行为下降）
	companions: string[]; // 已结识道侣 id
	favor: Record<string, number>; // 各道侣好感度 0~100
	bodyWound: number; // 躯府损伤 0~100（≥60 受损，灵虫战力减半；100 崩毁）
	scout: boolean; // 下一次秘境探索是否已以神识探查
	fateCheat: boolean; // 真仙秘术「命运篡改」：下次突破无雷直过
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
	{ name: "淬体境", level: 1, requiredXp: 50, description: "凡胎锻骨，初窥门径", thunderTrial: false, lifespan: 80 },
	{ name: "引气境", level: 2, requiredXp: 130, description: "引气入体，涤荡经脉", thunderTrial: false, lifespan: 100 },
	{ name: "练气境", level: 3, requiredXp: 300, description: "吐纳天地灵气，气旋丹田", thunderTrial: false, lifespan: 120 },
	{ name: "筑基境", level: 4, requiredXp: 650, description: "筑就道基，寿元增至两百载", thunderTrial: false, lifespan: 200 },
	{ name: "金丹境", level: 5, requiredXp: 1000, description: "凝结金丹，首次小天劫降临", thunderTrial: true, lifespan: 400 },
	{ name: "元婴境", level: 6, requiredXp: 2400, description: "元婴出窍，神识覆盖千里", thunderTrial: true, lifespan: 800 },
	{ name: "化神境", level: 7, requiredXp: 5500, description: "化神归一，可移山填海", thunderTrial: true, lifespan: 1500 },
	{ name: "炼虚境", level: 8, requiredXp: 12000, description: "炼神返虚，触摸法则边缘", thunderTrial: true, lifespan: 2000 },
	{ name: "合体境", level: 9, requiredXp: 26000, description: "天人合一，万法归宗", thunderTrial: true, lifespan: 3000 },
	{ name: "洞虚境", level: 10, requiredXp: 55000, description: "洞彻虚空，初解因果之秘", thunderTrial: true, lifespan: 4500 },
	{ name: "大乘境", level: 11, requiredXp: 110000, description: "大乘度世，因果秘术加身", thunderTrial: true, lifespan: 6000 },
	{ name: "渡劫境", level: 12, requiredXp: 230000, description: "渡九九天劫，成就不灭之躯", thunderTrial: true, lifespan: 8000 },
	{ name: "真仙境", level: 13, requiredXp: Infinity, description: "破碎飞升，与天地同寿", thunderTrial: true, lifespan: 12000 },
];

/** 九阶旧档 → 十三阶新境界的迁移映射（旧 0~8 → 新 index） */
const REALM_MIGRATION = [2, 3, 4, 5, 6, 8, 11, 10, 12];
/** 旧九境界寿元上限（旧档迁比例用） */
const OLD_REALM_LIFESPANS = [100, 200, 400, 800, 1500, 2500, 4000, 6000, 10000];
/** 存档结构版本：v2 = 十三境界 + 道侣/黑市/因果秘术全系统 */
const SAVE_SCHEMA = 2;

/**
 * 丹药表：效果恒大于成本；高阶丹药需对应境界炼制，且炼制有失败率。
 * 永久属性丹：淬体丹（+气血上限）、增元丹（+攻击）；回春丹为战斗补给。
 */
const PILLS: Pill[] = [
	// —— 修炼 ——
	{ id: "juqi", name: "聚气丹", category: "修炼", color: "#34d399", desc: "服下获约 20 息周天修为（随境界精进）", cost: 50, minRealm: 0, grade: "凡品" },
	{ id: "ningshen", name: "凝神丹", category: "修炼", color: "#60a5fa", desc: "30 息修炼收益翻倍", cost: 250, minRealm: 2, grade: "灵品" },
	{ id: "quti", name: "淬体丹", category: "修炼", color: "#fb923c", desc: "永久气血上限 +30×当前境界（丹力随境界散开）", cost: 700, minRealm: 4, grade: "宝品" },
	{ id: "zengyuan", name: "增元丹", category: "修炼", color: "#ef4444", desc: "永久攻击 +2×当前境界（丹力随境界散开）", cost: 900, minRealm: 5, grade: "宝品" },
	{ id: "tianyuan", name: "天元丹", category: "修炼", color: "#fbbf24", desc: "服下获约 60 息周天修为（随境界精进）", cost: 1200, minRealm: 4, grade: "宝品" },
	{ id: "wudao", name: "悟道丹", category: "修炼", color: "#f472b6", desc: "60 息内机缘类事件概率 ×3", cost: 2500, minRealm: 6, grade: "仙品" },
	{ id: "jiuzhuan", name: "九转金丹", category: "修炼", color: "#e879f9", desc: "服下获约 250 息周天修为（随境界精进）", cost: 6000, minRealm: 7, grade: "仙品" },
	// —— 突破 ——
	{ id: "pojing", name: "破境丹", category: "突破", color: "#c084fc", desc: "突破+25%；渡劫可挡一道天雷", cost: 600, minRealm: 4, grade: "灵品" },
	{ id: "bijie", name: "避劫丹", category: "突破", color: "#fde047", desc: "天劫之中可挡下一道天雷，且不损突破之势", cost: 1500, minRealm: 5, grade: "宝品" },
	// —— 疗伤 ——
	{ id: "huichun", name: "回春丹", category: "疗伤", color: "#f87171", desc: "立即恢复 50% 气血", cost: 40, minRealm: 0, grade: "凡品" },
	{ id: "huadu", name: "化毒丹", category: "疗伤", color: "#a3e635", desc: "化解丹毒 40 点，药性中和不积新毒", cost: 150, minRealm: 1, grade: "灵品" },
	{ id: "peiyuan", name: "培元丹", category: "疗伤", color: "#fb7185", desc: "温养躯府，修复躯府损伤 30 点", cost: 400, minRealm: 3, grade: "灵品" },
	{ id: "humai", name: "护脉丹", category: "疗伤", color: "#fda4af", desc: "护住经脉，立即恢复 80% 气血", cost: 600, minRealm: 4, grade: "宝品" },
	// —— 奇物 ——
	{ id: "juling", name: "聚灵丹", category: "奇物", color: "#fbbf24", desc: "90 息内打坐灵石产出翻倍", cost: 1500, minRealm: 3, grade: "灵品" },
	{ id: "pomo", name: "破魔丹", category: "奇物", color: "#a78bfa", desc: "以正压邪，驱散心魔 25 点", cost: 900, minRealm: 5, grade: "宝品" },
	{ id: "shouyuan", name: "延寿丹", category: "奇物", color: "#4ade80", desc: "服下寿元 +120 载（不逾上限）", cost: 800, minRealm: 2, grade: "灵品" },
	// —— 神品因果道具（仅坊市有售）——
	{ id: "timesand", name: "光阴碎片", category: "奇物", color: "#67e8f9", desc: "光阴回溯 · 气血回满；代价：因果债 +30", cost: 5000, minRealm: 0, grade: "神品", shopOnly: true },
	{ id: "souljade", name: "残魂因果玉", category: "奇物", color: "#f0abfc", desc: "被动护身 · 濒死自动满血复活（每世限 3 次）；代价：因果债 +40", cost: 8000, minRealm: 0, grade: "神品", shopOnly: true },
	{ id: "mirror", name: "命运窥镜", category: "奇物", color: "#7dd3fc", desc: "窥探下一次天劫劫型；代价：因果债 +25、心魔 +10", cost: 6000, minRealm: 6, grade: "神品", shopOnly: true },
	{ id: "karmaseal", name: "因果洗印符", category: "奇物", color: "#fda4af", desc: "神品 · 抹除 40 点因果债；代价：损耗百年寿元、道韵溃散", cost: 9000, minRealm: 8, grade: "神品", shopOnly: true },
];

/** 炼丹成功率：随丹药所需境界递减（97% → 67%） */
function craftSuccessRate(minRealm: number): number {
	return Math.max(0.55, 0.97 - minRealm * 0.06);
}

// 资质 = 悟道禀赋（七类，权重合计 100；旧档 id 保留，名称已换）
const APTITUDES: Aptitude[] = [
	{ id: "jia", name: "天纵道资", color: "#fbbf24", desc: "生而知之 · 修炼+40%，突破+8%", weight: 6, xpMult: 1.4, breakBonus: 0.08, fortuneBonus: 0 },
	{ id: "yi", name: "上根利器", color: "#60a5fa", desc: "一闻千悟 · 修炼+20%", weight: 15, xpMult: 1.2, breakBonus: 0, fortuneBonus: 0 },
	{ id: "gen", name: "玄门良材", color: "#34d399", desc: "条理通达 · 修炼+10%，突破+3%", weight: 20, xpMult: 1.1, breakBonus: 0.03, fortuneBonus: 0 },
	{ id: "bing", name: "中平道资", color: "#9ca3af", desc: "中人之姿 · 无加成，稳打稳扎", weight: 23, xpMult: 1, breakBonus: 0, fortuneBonus: 0 },
	{ id: "ding", name: "驽钝苦修", color: "#a8a29e", desc: "勤能补拙 · 修炼-15%，但机缘+8%", weight: 13, xpMult: 0.85, breakBonus: 0, fortuneBonus: 0.08 },
	{ id: "su", name: "宿慧前生", color: "#c084fc", desc: "似忆前生道韵 · 突破+6%，机缘+4%", weight: 11, xpMult: 1, breakBonus: 0.06, fortuneBonus: 0.04 },
	{ id: "gu", name: "天煞孤资", color: "#fb7185", desc: "六亲缘浅道心孤 · 修炼+25%，突破-3%", weight: 12, xpMult: 1.25, breakBonus: -0.03, fortuneBonus: 0 },
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

// 先天体质（十二类，权重合计 100；旧档 id 保留，名称与设定已全部原创化）
const PHYSIQUES: Physique[] = [
	{ id: "fantai", name: "凡胎浊骨", color: "#9ca3af", desc: "芸芸众生，大道靠己", weight: 24, xpMult: 1, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "lingti", name: "清灵道体", color: "#34d399", desc: "经脉通透近道 · 收益 +15%", weight: 16, xpMult: 1.15, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "zhenwu", name: "玄金战体", color: "#ef4444", desc: "骨如玄金 · 收益+30%，攻击+15%，心魔易生（+3%）", weight: 9, xpMult: 1.3, breakBonus: 0, demonProbDelta: 0.03, thunderLossMult: 1, atkMult: 1.15 },
	{ id: "bingpo", name: "寂水寒渊体", color: "#7dd3fc", desc: "心若寒潭 · 心魔免疫，但突破 -5%", weight: 7, xpMult: 1, breakBonus: -0.05, demonProbDelta: 0, thunderLossMult: 1, demonImmune: true },
	{ id: "senhai", name: "枯荣双生体", color: "#4ade80", desc: "一枯一荣 · 机缘翻倍，但打坐收益 -10%", weight: 7, xpMult: 0.9, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 1, fortuneMult: 2 },
	{ id: "daoti", name: "太一妙道体", color: "#60a5fa", desc: "道韵天成 · 突破与渡劫 +8%", weight: 7, xpMult: 1, breakBonus: 0.08, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "wugou", name: "无垢琉璃身", color: "#67e8f9", desc: "琉璃无瑕 · 收益 +10%，雷劫损失减半", weight: 6, xpMult: 1.1, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 0.5 },
	{ id: "wanyao", name: "万妖吞天体", color: "#dc2626", desc: "吞噬万物养己 · 收益 +20%、攻击 +20%，心魔大盛（+5%）", weight: 6, xpMult: 1.2, breakBonus: 0, demonProbDelta: 0.05, thunderLossMult: 1, atkMult: 1.2 },
	{ id: "wangqing", name: "太上忘情体", color: "#a5f3fc", desc: "忘情弃欲 · 心魔免疫，收益 +10%", weight: 5, xpMult: 1.1, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 1, demonImmune: true },
	{ id: "chizi", name: "赤子明道体", color: "#fca5a5", desc: "赤子之心不染尘 · 收益 +20%，机缘 ×1.4", weight: 5, xpMult: 1.2, breakBonus: 0, demonProbDelta: 0, thunderLossMult: 1, fortuneMult: 1.4 },
	{ id: "daotai", name: "先天混沌道胎", color: "#fbbf24", desc: "一缕混沌蕴身中 · 收益+50%，突破+10%", weight: 4, xpMult: 1.5, breakBonus: 0.1, demonProbDelta: 0, thunderLossMult: 1 },
	{ id: "zhizun", name: "鸿蒙紫气仙胎", color: "#e879f9", desc: "紫气东来三万里 · 收益+80%，突破+15%，雷劫损失减半", weight: 4, xpMult: 1.8, breakBonus: 0.15, demonProbDelta: 0, thunderLossMult: 0.5 },
];

/** 斗法台对手（由弱到强） */
const ENEMY_TEMPLATES: EnemyTemplate[] = [
	{ id: "yaolang", name: "落霞妖狼", title: "淬体级妖兽", levelOffset: -1, rewardFactor: 0.8 },
	{ id: "sanxiu", name: "黑风寨散修", title: "同境修士", levelOffset: 0, rewardFactor: 1.0 },
	{ id: "mangyao", name: "碧波潭蟒妖", title: "越境妖兽", levelOffset: 1, rewardFactor: 1.4 },
	{ id: "jianxiu", name: "逐风剑修", title: "越境剑修", levelOffset: 1, rewardFactor: 1.5 },
	{ id: "yaowang", name: "赤焰妖王", title: "两境妖王", levelOffset: 2, rewardFactor: 2.2 },
	{ id: "mingjiao", name: "九幽冥蛟", title: "三境凶兽", levelOffset: 3, rewardFactor: 3.2 },
];

/** 挑战冷却（息） */
const BATTLE_COOLDOWN = 20;
/** v11 试炼塔独立短冷却（原与斗法台共用 20 息，过长劝退） */
const TOWER_COOLDOWN = 5;
/** 挑战所需最低气血比例 */
const MIN_HP_RATIO = 0.3;

// ==================== 功法（秘籍）====================

/** 功法总表：品阶随斗法进度递进，装备后提供永久被动加成 */
const MANUALS: Manual[] = [
	{ id: "tuna", name: "吐纳诀", slot: "core", rarity: "凡品", color: "#9ca3af", desc: "道门入门心法，打坐收益 +5%", xpMult: 1.05, breakBonus: 0, hint: "创角即得" },
	{ id: "tiebu", name: "铁布衫", slot: "body", rarity: "凡品", color: "#a8a29e", desc: "外门硬功，气血上限 +120、防御 +5", hpBonus: 120, defBonus: 5, hint: "首胜落霞妖狼" },
	{ id: "qingmu", name: "青木长春功", slot: "core", rarity: "灵品", color: "#34d399", desc: "木系生生不息，打坐收益 +15%、突破 +3%", xpMult: 1.15, breakBonus: 0.03, hint: "首胜黑风寨散修" },
	{ id: "liehuo", name: "烈火诀", slot: "attack", rarity: "灵品", color: "#f87171", desc: "火系攻伐，攻击 +12、造成伤害 +8%", atkBonus: 12, dmgMult: 1.08, hint: "首胜碧波潭蟒妖" },
	{ id: "zixia", name: "紫霞心法", slot: "core", rarity: "宝品", color: "#c084fc", desc: "道门正宗心法，打坐收益 +25%、突破 +5%", xpMult: 1.25, breakBonus: 0.05, hint: "首胜逐风剑修" },
	{ id: "jingang", name: "金刚不坏身", slot: "body", rarity: "宝品", color: "#fbbf24", desc: "佛门炼体绝学，气血上限 +350、防御 +14", hpBonus: 350, defBonus: 14, hint: "首胜赤焰妖王" },
	{ id: "jiuzhuanx", name: "九转玄功", slot: "core", rarity: "天品", color: "#e879f9", desc: "道门无上心法，打坐收益 +40%、突破 +8%", xpMult: 1.4, breakBonus: 0.08, hint: "首胜九幽冥蛟" },
	{ id: "zhuxian", name: "诛仙剑诀", slot: "attack", rarity: "天品", color: "#ef4444", desc: "上古攻伐第一，攻击 +35、造成伤害 +18%", atkBonus: 35, dmgMult: 1.18, hint: "修炼遗府奇遇" },
	// v11 功法扩充：奇缘 / 秘境可得
	{ id: "shenfa", name: "踏云身法", slot: "body", rarity: "凡品", color: "#94a3b8", desc: "身轻如燕步生风，气血上限 +60、防御 +6", hpBonus: 60, defBonus: 6, hint: "秘境遗府奇缘" },
	{ id: "shangdao", name: "商道聚灵术", slot: "core", rarity: "凡品", color: "#fbbf24", desc: "以商入道，打坐灵石产出 +30%", gatherMult: 1.3, hint: "奇缘事件可得" },
	{ id: "chanxin", name: "禅心不染经", slot: "core", rarity: "灵品", color: "#a5f3fc", desc: "禅意涤心魔不侵，打坐收益 +10%、突破 +2%", xpMult: 1.1, breakBonus: 0.02, hint: "奇缘事件可得" },
	{ id: "guixi", name: "龟息养元功", slot: "body", rarity: "灵品", color: "#7dd3fc", desc: "气息绵长如龟眠，气血上限 +220、防御 +8", hpBonus: 220, defBonus: 8, hint: "秘境遗府奇缘" },
	{ id: "jianyi", name: "剑心通明诀", slot: "attack", rarity: "宝品", color: "#fbbf24", desc: "以心驭剑人剑合一，攻击 +20、造成伤害 +12%", atkBonus: 20, dmgMult: 1.12, hint: "秘境遗府奇缘" },
	{ id: "yinlei", name: "引雷真解", slot: "attack", rarity: "宝品", color: "#7dd3fc", desc: "引天雷淬剑锋，攻击 +16、造成伤害 +10%", atkBonus: 16, dmgMult: 1.1, hint: "渡劫有缘人可得" },
];

/** 斗法台首通固定掉落的功法（对手 id → 功法 id） */
const FIRST_CLEAR_MANUAL: Record<string, string> = {
	yaolang: "tiebu",
	sanxiu: "qingmu",
	mangyao: "liehuo",
	jianxiu: "zixia",
	yaowang: "jingang",
	mingjiao: "jiuzhuanx",
};

/** 重复获得功法时折算的修为（按品阶） */
const MANUAL_DUP_REWARD: Record<Manual["rarity"], number> = {
	凡品: 500,
	灵品: 2000,
	宝品: 6000,
	天品: 15000,
};

/** 典籍面板的槽位展示顺序 */
const MANUAL_SLOTS: { slot: ManualSlot; label: string }[] = [
	{ slot: "core", label: "主修心法" },
	{ slot: "body", label: "炼体功法" },
	{ slot: "attack", label: "攻伐法术" },
];

// ==================== 法宝装备 ====================

/** 法宝槽位展示顺序与文案 */
const EQUIP_SLOTS: { slot: EquipSlot; label: string }[] = [
	{ slot: "weapon", label: "武器" },
	{ slot: "armor", label: "护甲" },
	{ slot: "artifact", label: "法宝" },
];

const EQUIP_RARITIES: EquipRarity[] = ["凡品", "灵品", "宝器", "仙器"];
const EQUIP_RARITY_COLORS: Record<EquipRarity, string> = {
	凡品: "#9ca3af",
	灵品: "#34d399",
	宝器: "#c084fc",
	仙器: "#fbbf24",
};
/** 掉落品质权重：凡 50 / 灵 30 / 宝 15 / 仙 5 */
const EQUIP_DROP_WEIGHTS = [50, 30, 15, 5];
/** 行囊上限，满员时掉落按 base×5 折算灵石 */
const BAG_CAP = 20;

/** 法宝模板池：每槽四件、四个品质各一，基础值按品质递增 */
const EQUIP_POOL: { tid: string; name: string; slot: EquipSlot; rarity: EquipRarity; base: number }[] = [
	// 武器：攻击 12 / 18 / 26 / 36
	{ tid: "qingfeng", name: "青锋剑", slot: "weapon", rarity: "凡品", base: 12 },
	{ tid: "xuantie", name: "玄铁重剑", slot: "weapon", rarity: "灵品", base: 18 },
	{ tid: "zidian", name: "紫电青霜", slot: "weapon", rarity: "宝器", base: 26 },
	{ tid: "zhuxianjian", name: "诛仙四剑", slot: "weapon", rarity: "仙器", base: 36 },
	// 护甲：防御 8 / 12 / 18 / 25
	{ tid: "bufu", name: "流云道袍", slot: "armor", rarity: "凡品", base: 8 },
	{ tid: "xuangui", name: "玄龟宝甲", slot: "armor", rarity: "灵品", base: 12 },
	{ tid: "zijinjia", name: "紫金锁子甲", slot: "armor", rarity: "宝器", base: 18 },
	{ tid: "taixu", name: "太虚仙衣", slot: "armor", rarity: "仙器", base: 25 },
	// 法宝：气血上限 60 / 90 / 140 / 200
	{ tid: "yangqi", name: "养气玉佩", slot: "artifact", rarity: "凡品", base: 60 },
	{ tid: "xuanwuyin", name: "玄武印", slot: "artifact", rarity: "灵品", base: 90 },
	{ tid: "shanhetu", name: "山河社稷图", slot: "artifact", rarity: "宝器", base: 140 },
	{ tid: "donghuang", name: "东皇钟", slot: "artifact", rarity: "仙器", base: 200 },
];

// ==================== 坊市 ====================

/** 坊市出售的丹药与因果道具（价格 = cost/10 取整到十位、最低 50 灵石） */
const SHOP_PILL_IDS: PillId[] = ["juqi", "huichun", "huadu", "ningshen", "pojing", "shouyuan", "peiyuan", "humai", "juling", "pomo", "bijie", "timesand", "souljade", "mirror", "karmaseal"];
const SHOP_PILLS: Pill[] = PILLS.filter((p) => SHOP_PILL_IDS.includes(p.id));
/** 炼丹坊可炼的丹药（shopOnly 的因果道具不可炼制、不掉落） */
const CRAFT_PILLS: Pill[] = PILLS.filter((p) => !p.shopOnly);

// v11 丹药界面分类过滤（修炼/突破/疗伤/奇物，避免列表过长难找）
type PillFilter = "全部" | PillCategory;
const PILL_FILTERS: PillFilter[] = ["全部", "修炼", "突破", "疗伤", "奇物"];
let craftFilter = $state<PillFilter>("全部");
let shopFilter = $state<PillFilter>("全部");

// ==================== v10 难度 / 符咒 / 灵虫常量 ====================

/** 死因：血战陨落 / 寿元耗尽 / 天劫陨落 / 因果崩溃 / 兵解转世 */
type DeathCause = "battle" | "lifespan" | "thunder" | "debt" | "bingjie";
const DEATH_TEXTS: Record<DeathCause, { title: string; desc: string }> = {
	battle: { title: "血溅当场", desc: "你气血枯竭，倒在了斗法台上。一缕真灵飘入轮回。" },
	lifespan: { title: "寿元耗尽", desc: "寿元归零，神魂枯萎。任你修为通天，亦敌不过岁月侵蚀。" },
	thunder: { title: "天劫陨落", desc: "三道天雷尽数劈落，你道基尽毁，身死道消。" },
	debt: { title: "因果崩溃", desc: "因果债过载，命运劫降临。天道收回了你透支的一切。" },
	bingjie: { title: "兵解转世", desc: "你自行兵解，散去一身修为，真灵投入轮回。" },
};

// ==================== v10 难度 / 符咒 / 灵虫常量 ====================

/** 开局三难度：风险与收益对等，本周目锁定 */
const DIFFICULTIES: DifficultyCfg[] = [
	{ id: "gentle", name: "温和修道", color: "#4ade80", desc: "新手推荐 · 修炼略缓，敌人伤害 -30%，因果反噬减半，突破失败只重伤不身死，掉落 +20%", xpMult: 0.9, enemyMult: 0.7, debtMult: 0.5, dropBonus: 0.2, gentleDeath: true, deathRisk: 0 },
	{ id: "normal", name: "乱世求索", color: "#60a5fa", desc: "标准难度 · 风险与收益均衡，机缘与危机并存", xpMult: 1, enemyMult: 1, debtMult: 1, dropBonus: 0, gentleDeath: false, deathRisk: 0 },
	{ id: "hard", name: "绝地轮回", color: "#f87171", desc: "硬核难度 · 修炼 +20%，敌人伤害 +45%，因果反噬 2.5 倍，掉落 +50%，斗法败北折寿十载且可能身殒，高风险高回报", xpMult: 1.2, enemyMult: 1.45, debtMult: 2.5, dropBonus: 0.5, gentleDeath: false, deathRisk: 0.25 },
];

/** 大境界内四小阶：按修为对下一境界需求的比例划分 */
const SUB_STAGES = ["初期", "中期", "后期", "巅峰"];
function subStageOf(realmIndex: number, xp: number): string {
	const next = REALMS[realmIndex + 1];
	if (!next) return "圆满";
	const ratio = xp / next.requiredXp;
	if (ratio < 0.25) return SUB_STAGES[0];
	if (ratio < 0.5) return SUB_STAGES[1];
	if (ratio < 0.85) return SUB_STAGES[2];
	return SUB_STAGES[3];
}

/** 符咒总表：坊市灵石购买，部分战斗/突破中使用，替死符为被动保命 */
const TALISMANS: Talisman[] = [
	{ id: "strike", name: "五雷符", color: "#fbbf24", desc: "战斗中催动：引五雷轰顶，造成相当于自身攻击 3 倍的固定伤害", price: 120, minRealm: 2 },
	{ id: "seal", name: "镇妖符", color: "#60a5fa", desc: "战斗中催动：封印敌身一回合，本回合敌人无法反击", price: 90, minRealm: 2 },
	{ id: "clear", name: "清心符", color: "#34d399", desc: "静心通神：心魔 -20（心魔过高会削减突破率、招致走火入魔）", price: 80, minRealm: 0 },
	{ id: "anti", name: "破劫符", color: "#c084fc", desc: "渡天劫时祭出：硬挡一道天雷（与破境丹同理）", price: 600, minRealm: 4 },
	{ id: "life", name: "替死符", color: "#f0abfc", desc: "本命保命法器：濒死时自动触发，满血复生且不积因果债（消耗品）", price: 1200, minRealm: 4 },
];
const EMPTY_TALISMANS: Record<TalismanId, number> = { strike: 0, seal: 0, clear: 0, anti: 0, life: 0 };

/**
 * 灵虫池：凡品→仙器四阶，装配躯府三槽提供被动。
 * 三槽全满时斗法可催动一次「道衍杀招」。
 */
const WORM_POOL: Worm[] = [
	{ id: "can", name: "金丝蚕", rarity: "凡品", color: "#fbbf24", desc: "吐纳灵气 · 修炼 +5%", xpMult: 1.05 },
	{ id: "bi", name: "碧鳞蚺", rarity: "凡品", color: "#4ade80", desc: "鳞甲护身 · 防御 +6", def: 6 },
	{ id: "feng", name: "追风蜂", rarity: "灵品", color: "#7dd3fc", desc: "采灵酿蜜 · 灵石产出 +10%", gatherMult: 1.1 },
	{ id: "huo", name: "赤焰蝎", rarity: "灵品", color: "#f87171", desc: "尾针剧毒 · 攻击 +10", atk: 10 },
	{ id: "xin", name: "静心蝉", rarity: "灵品", color: "#67e8f9", desc: "蝉鸣定心 · 心魔积累 -8", demonCut: 8 },
	{ id: "gui", name: "玄龟灵", rarity: "宝器", color: "#a78bfa", desc: "玄武血脉 · 气血 +160、防御 +8", hp: 160, def: 8 },
	{ id: "lei", name: "雷翼蛾", rarity: "宝器", color: "#facc15", desc: "翼粉带电 · 攻击 +16、修炼 +8%", atk: 16, xpMult: 1.08 },
	{ id: "hun", name: "噬魂蝶", rarity: "宝器", color: "#c084fc", desc: "噬念安神 · 心魔积累 -15、修炼 +8%", demonCut: 15, xpMult: 1.08 },
	{ id: "jiu", name: "九尾天狐", rarity: "仙器", color: "#fb923c", desc: "上古灵兽 · 攻击 +25、修炼 +15%", atk: 25, xpMult: 1.15 },
	{ id: "qilin", name: "墨玉麒麟", rarity: "仙器", color: "#e879f9", desc: "瑞兽镇世 · 气血 +300、防御 +18、灵石 +15%", hp: 300, def: 18, gatherMult: 1.15 },
];
const WORM_SLOT_LABELS = ["躯府·寅位", "躯府·午位", "躯府·戌位"];
const FEED_COST = 20; // 喂养一次 20 灵石，饥饿 -25
const FEED_AMOUNT = 25;

// ==================== v10.1 道侣 / 因果秘术 / 秘境 / 黑市 ====================

/** 可结识道侣：性格立场各异，好感达里程碑提供协同加成 */
interface Companion {
	id: string;
	name: string;
	gender: "男" | "女"; // v11 结识时可选道侣性别
	color: string;
	trait: string;
	desc: string;
}
const COMPANIONS: Companion[] = [
	{ id: "su", name: "苏挽晴", gender: "女", color: "#f9a8d4", trait: "清冷剑修", desc: "剑心通明，协同作战时锋芒最盛" },
	{ id: "xiao", name: "萧无尘", gender: "男", color: "#7dd3fc", trait: "丹鼎道种", desc: "精通炼丹，结缘后灵物资助不断" },
	{ id: "bai", name: "白鹿鸣", gender: "男", color: "#4ade80", trait: "蛮荒体修", desc: "气血如龙，并肩渡劫可分担雷威" },
	{ id: "shen", name: "沈青梧", gender: "女", color: "#c084fc", trait: "符箓世家", desc: "符道大家，符纸灵材随手相赠" },
	{ id: "ye", name: "夜玄", gender: "男", color: "#fb7185", trait: "魔道散修", desc: "亦正亦邪，手段狠辣收益惊人" },
	{ id: "jiang", name: "姜离", gender: "女", color: "#fbbf24", trait: "器宗传人", desc: "炼器宗师，道基稳固修炼安稳" },
];
/** 结识花费与赠礼花费 */
const MEET_COST = 500;
const GIFT_COST = 100;

/** 因果秘术：按境界解锁，高收益高代价 */
interface ArcaneArt {
	id: "peek" | "rewind" | "shift" | "revive" | "fate";
	name: string;
	realm: number; // 所需境界 index
	desc: string;
	cd: number; // 冷却息数
}
const ARCANE_ARTS: ArcaneArt[] = [
	{ id: "peek", name: "命运窥探", realm: 9, desc: "窥探下一次天劫劫型，不沾因果", cd: 120 },
	{ id: "rewind", name: "微末回溯", realm: 9, desc: "气血回满；因果债 +20", cd: 90 },
	{ id: "shift", name: "因果偏移", realm: 10, desc: "消解 30 点因果债；折寿 30 载", cd: 150 },
	{ id: "revive", name: "肉身返生", realm: 11, desc: "满血复生并涤尽心魔丹毒；因果债 +50", cd: 200 },
	{ id: "fate", name: "小段命运篡改", realm: 12, desc: "篡改命线：下次大境界突破无雷直过；因果债 +80", cd: 300 },
];

/** 固定经典秘境：按修为阶段进入不同古域 */
const SECRET_PLACES = ["天南古域", "乱星海", "虚天古殿", "慕兰古战场", "坠魔深渊", "灵界"];
/** 神识探查花费（避开秘境凶险，提高机缘下限） */
const SCOUT_COST = 150;

/** 黑市三桩交易（均留因果印记） */
const BLACK_DEALS = [
	{ id: "bm_life", name: "夺寿灵材", price: 800, cd: 120, desc: "邪修掠夺而来的寿元灵材：寿元 +30 载；业力 +20、因果债 +10、声望 -10" },
	{ id: "bm_talisman", name: "黑货符箓", price: 300, cd: 90, desc: "来路不明的高阶符箓：随机得符一张；因果债 +8、声望 -5" },
	{ id: "bm_pill", name: "贼赃丹药", price: 350, cd: 90, desc: "半价黑市丹：随机高阶丹药一颗；因果债 +5、声望 -3" },
];

/** 天道劫型：由业力 / 因果债 / 心魔 / 寿元动态决定 */
interface TrialKind {
	id: "thunder" | "karmaFire" | "causal" | "heart" | "years";
	name: string;
	desc: string;
}

const CULTIVATE_TEXTS = [
	"你盘膝而坐，吐纳天地灵气...",
	"灵气入体，经脉微微发热...",
	"你运转周天，灵力缓缓增长...",
	"一缕紫气东来，被你炼化吸收...",
	"灵台清明，心境澄澈...",
	"丹田之中，灵力如江河奔涌...",
];

const FORTUNE_EVENTS = [
	{ text: "你发现了一株百年灵药，修为大涨！", xpMultiplier: 2 },
	{ text: "你在古洞府中领悟了前辈留下的功法，修为大增！", xpMultiplier: 4 },
	{ text: "你参悟了天地法则，顿悟之下修为大进！", xpMultiplier: 5 },
	{ text: "你捡到了一块灵石，吸收后修为提升！", xpMultiplier: 2 },
	{ text: "有高人路过，见你资质不俗，随手点拨了一番！", xpMultiplier: 3 },
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
	shouyuan: 0, souljade: 0, timesand: 0, mirror: 0, karmaseal: 0,
	huadu: 0, peiyuan: 0, humai: 0, pomo: 0, juling: 0, bijie: 0,
};

/** 全新角色初始状态（初次进入、兵解转世、导入兜底时共用） */
function makeFreshPlayer(difficulty: Difficulty = "normal"): PlayerState {
	const fresh: PlayerState = {
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
		julingLeft: 0,
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
		// 初始赠送入门心法并自动装备
		manuals: ["tuna"],
		equipped: { core: "tuna", body: null, attack: null },
		defeated: {},
		cooldowns: {},
		stones: 100,
		equip: { weapon: null, armor: null, artifact: null },
		bag: [],
		towerFloor: 0,
		lastSeen: Date.now(),
		log: [],
		// v9 黑暗轮回默认值
		lifespan: REALMS[0].lifespan,
		karma: 0,
		karmaDebt: 0,
		souljadeUsed: 0,
		// v10 全系统默认值
		difficulty,
		demon: 0,
		toxin: 0,
		talismans: { ...EMPTY_TALISMANS },
		worms: [],
		wormEquip: [null, null, null],
		wormHunger: 0,
		landLevel: 0,
		// v10.1 默认值
		schemaV: SAVE_SCHEMA,
		reputation: 0,
		companions: [],
		favor: {},
		bodyWound: 0,
		scout: false,
		fateCheat: false,
	};
	return fresh;
}

let player = $state<PlayerState>(makeFreshPlayer());

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
// v10 开局难度选择（死亡/兵解后一切归零，需重选难度重测天命）
let chosenDifficulty = $state<Difficulty | null>(null);

// ---- 雷劫（主动突破，保留交互）----
let showThunderModal = $state(false);
let thunderRound = $state(0);
let thunderResults = $state<("pending" | "pass" | "fail")[]>([]);
let thunderStriking = $state(false);
let thunderPenalty = $state(0);
// v10 本次突破的劫型（点开突破时锁定，避免中途数值变化）
let trialKind = $state<TrialKind>({ id: "thunder", name: "天雷劫", desc: "" });

// ---- 交互式斗法 ----
let battle = $state<BattleState | null>(null);

// ---- 存档导出/导入 ----
let saveModalMode = $state<null | "export" | "import">(null);
let importCode = $state("");
let copyHint = $state("");

// ---- 法宝强化弹窗 ----
let enhanceId = $state<string | null>(null);
let enhanceMsg = $state("");

// ---- 闭关归来结算弹窗 ----
let offlineReport = $state<{ duration: string; xp: number; stones: number } | null>(null);

// ---- v9 死亡结算弹窗（v11 移除轮回继承，仅展示本世修行总结）----
let showRebirthModal = $state(false);
let deathCause = $state<DeathCause | null>(null);
let rebirthReport = $state<{
	cause: DeathCause; realm: string; xp: number; wins: number; floors: number; breaths: number; clears: number;
} | null>(null);

// ==================== v10.2 游戏内功能菜单（分页切换，压缩页面长度）====================
type GameMenuId = "battle" | "worm" | "fate" | "pill" | "log";
const MENUS: { id: GameMenuId; name: string }[] = [
	{ id: "battle", name: "斗法备战" },
	{ id: "worm", name: "虫府福地" },
	{ id: "fate", name: "仙缘因果" },
	{ id: "pill", name: "炼丹坊市" },
	{ id: "log", name: "修炼日志" },
];
let activeMenu = $state<GameMenuId>("battle");

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

// ---- 已装备功法 ----
const coreManual = $derived(MANUALS.find((m) => m.id === player.equipped.core) ?? null);
const bodyManual = $derived(MANUALS.find((m) => m.id === player.equipped.body) ?? null);
const attackManual = $derived(MANUALS.find((m) => m.id === player.equipped.attack) ?? null);

/** 当前难度配置 */
const difficultyCfg = $derived(DIFFICULTIES.find((d) => d.id === player.difficulty) ?? DIFFICULTIES[1]);
/** 大境界内小阶 */
const subStage = $derived(subStageOf(player.realmIndex, player.xp));

// ---- v10 灵虫躯府 ----
/** 已装配的灵虫实例（三槽） */
const equippedWorms = $derived(
	player.wormEquip.map((id) => WORM_POOL.find((w) => w.id === id) ?? null),
);
/** 饥饿度 ≥70 时灵虫效果减半（灵虫饥荒：属性下降、失控反噬） */
const wormEfficiency = $derived(player.wormHunger >= 70 ? 0.5 : 1);
const wormBonus = $derived.by(() => {
	const sum = { xpMult: 1, atk: 0, def: 0, hp: 0, demonCut: 0, gatherMult: 1 };
	for (const w of equippedWorms) {
		if (!w) continue;
		sum.xpMult += (w.xpMult ?? 1) - 1;
		sum.atk += w.atk ?? 0;
		sum.def += w.def ?? 0;
		sum.hp += w.hp ?? 0;
		sum.demonCut += w.demonCut ?? 0;
		sum.gatherMult += (w.gatherMult ?? 1) - 1;
	}
	// 饥饿时属性类加成减半，乘法类按比例缩水
	if (wormEfficiency < 1) {
		sum.atk = Math.round(sum.atk * wormEfficiency);
		sum.def = Math.round(sum.def * wormEfficiency);
		sum.hp = Math.round(sum.hp * wormEfficiency);
		sum.demonCut = Math.round(sum.demonCut * wormEfficiency);
		sum.xpMult = 1 + (sum.xpMult - 1) * wormEfficiency;
		sum.gatherMult = 1 + (sum.gatherMult - 1) * wormEfficiency;
	}
	// v10.1 躯府重创/崩毁：灵虫战力再减半
	if (player.bodyWound >= 60) {
		sum.atk = Math.round(sum.atk * 0.5);
		sum.def = Math.round(sum.def * 0.5);
		sum.hp = Math.round(sum.hp * 0.5);
		sum.demonCut = Math.round(sum.demonCut * 0.5);
		sum.xpMult = 1 + (sum.xpMult - 1) * 0.5;
		sum.gatherMult = 1 + (sum.gatherMult - 1) * 0.5;
	}
	return sum;
});
/** 三槽灵虫全满 → 可催动道衍杀招 */
const killMoveReady = $derived(equippedWorms.every((w) => w !== null));

// ---- v10.1 躯府损伤 / 道侣羁绊 ----
/** 躯府受损（损伤≥60）：灵虫加持再减半；躯府崩毁见 breathTick */
const bodyBroken = $derived(player.bodyWound >= 60);
const bodyStateText = $derived(
	player.bodyWound >= 100 ? "崩毁" : player.bodyWound >= 60 ? "重创" : player.bodyWound >= 30 ? "轻伤" : "完好",
);
/** 最高好感道侣及其羁绊里程碑（30 灵物资助 / 60 协同作战 / 90 并肩渡劫） */
const bestCompanion = $derived.by(() => {
	let best: { id: string; favor: number } | null = null;
	for (const id of player.companions) {
		const f = player.favor[id] ?? 0;
		if (!best || f > best.favor) best = { id, favor: f };
	}
	return best;
});
const partnerBonus = $derived.by(() => {
	const f = bestCompanion?.favor ?? 0;
	return {
		xpMult: f >= 30 ? 1.1 : 1, // 资源共享：修炼/产出 +10%
		atk: f >= 60 ? 15 : 0, // 协同作战：攻击 +15
		hp: f >= 60 ? 150 : 0, // 气血 +150
		thunder: f >= 90 ? 0.1 : 0, // 并肩渡劫：硬抗 +10%
	};
});

// ---- v10.1 附属战斗属性 ----
const speed = $derived(10 + currentRealm.level * 3);
const critRate = $derived(Math.min(35, 5 + currentRealm.level * 2));
const dodgeRate = $derived(Math.min(25, 3 + Math.floor(currentRealm.level * 1.5)));
const damageReduce = $derived(Math.min(40, Math.round((def / (def + 260)) * 100)));

// ==================== v11 名词志 ====================
/** 名词志词条：悬停状态条或打开弹窗查看释义 */
const GLOSSARY: { term: string; desc: string }[] = [
	{ term: "修为", desc: "修行积累的经验。囤积不可超过下次突破所需的一倍半，溢出部分散逸天地。" },
	{ term: "灵石", desc: "修行界通货。打坐、福地、斗法赏金、事件皆可获取；赠礼、购丹、炼制皆需它。" },
	{ term: "气血", desc: "肉身存续之本。归零触发濒死判定——替死符、残魂因果玉可救命，否则血溅当场。" },
	{ term: "寿元", desc: "剩余阳寿（年）。随时间流逝，斗法/秘境亦折耗；归零神魂枯萎。延寿丹与福地灵泉可补。" },
	{ term: "心魔", desc: "败北、雷劫、杀招所积。50 起削突破率，80 起更狠且可能走火入魔。清心符、静心蝉可解。" },
	{ term: "丹毒", desc: "服丹积累的药毒。50 起削修炼收益，打坐自然消解，化毒丹可速解。" },
	{ term: "业力", desc: "斗法试炼胜者沾染的杀业。80 起触发业火劫（败雷额外折寿）；渡劫成功可洗去三成。" },
	{ term: "因果债", desc: "使用逆天道具/秘术的代价。150 起削修炼，满 200 触发命运劫当场身死。因果洗印符可抹除。" },
	{ term: "声望", desc: "江湖善恶观感（−50~50）。正道行事得加成，黑市勾当遭折损；部分事件选项受其影响。" },
	{ term: "躯府", desc: "躯府三虫的温养状态。饥饿会反噬需定期喂食；道衍杀招需三虫齐鸣。" },
	{ term: "灵虫", desc: "躯府温养的灵虫，共三槽。提供修炼/战斗/定心增益，可放生换灵石。" },
	{ term: "遁走", desc: "斗法中七成五概率全身而退；失手则硬吃一记杀招。打不过时的赌命选项。" },
	{ term: "天劫", desc: "大境界突破的三道天雷。劫型由业力/因果债/心魔/寿元动态决定；破劫符、避劫丹可挡雷。" },
	{ term: "定神", desc: "冲关前的小游戏：指针近中心时点下，每息至多 +4% 成功率，三息为限。" },
	{ term: "命线已改", desc: "真仙秘术「小段命运篡改」之效：下次大境界突破无雷直过。" },
	{ term: "福地", desc: "洞天福地，可升级。挂机产出修为灵石；3 级起灵泉滋养补寿元。" },
];
/** 按词条名取释义（模板 title 用） */
function gloss(term: string): string {
	return GLOSSARY.find((g) => g.term === term)?.desc ?? "";
}
let showGlossaryModal = $state(false);

// ---- v10 心魔 / 丹毒 ----
/** 心魔 debuff：≥50 突破 -10%；≥80 再 -10% */
const demonBreakPenalty = $derived(player.demon >= 80 ? 0.2 : player.demon >= 50 ? 0.1 : 0);
/** 丹毒 debuff：≥50 修炼 ×0.9；≥80 ×0.75 */
const toxinMult = $derived(player.toxin >= 80 ? 0.75 : player.toxin >= 50 ? 0.9 : 1);

/** 寿元上限 = 境界基础寿元 */
const lifespanMax = $derived(currentRealm.lifespan);
/** 寿元剩余比例（驱动状态条颜色与 debuff） */
const lifespanRatio = $derived(lifespanMax > 0 ? Math.max(0, player.lifespan / lifespanMax) : 0);
/** 暮年 debuff：寿元 <30% 修炼 ×0.85；<10% 残烛 ×0.65 */
const ageMult = $derived(lifespanRatio < 0.1 ? 0.65 : lifespanRatio < 0.3 ? 0.85 : 1);
/** 因果债 debuff：≥150 时修炼 ×0.85 */
const debtMult = $derived(player.karmaDebt >= 150 ? 0.85 : 1);

const successRate = $derived.by(() => {
	if (!nextRealm) return 0;
	const base = Math.max(0.3, 0.9 - nextRealm.level * 0.06);
	const bonus =
		rootBreakBonus +
		(currentAptitude?.breakBonus ?? 0) +
		(currentPhysique?.breakBonus ?? 0) +
		(coreManual?.breakBonus ?? 0) +
		(player.pojingActive ? 0.25 : 0);
	// 业力反噬：karma ×0.1%（上限 15%）；高因果债额外 -8%；心魔削突破
	const karmaPenalty = Math.min(0.15, player.karma * 0.001);
	const debtPenalty = player.karmaDebt >= 80 ? 0.08 : 0;
	return Math.min(0.95, Math.max(0.05, base + bonus - karmaPenalty - debtPenalty - demonBreakPenalty));
});

const breathXp = $derived(
	Math.round(
		(5 + currentRealm.level * 3) *
			(currentAptitude?.xpMult ?? 1) *
			rootXpMult *
			(currentPhysique?.xpMult ?? 1) *
			(coreManual?.xpMult ?? 1) *
			ageMult *
			debtMult *
			toxinMult *
			wormBonus.xpMult *
			partnerBonus.xpMult *
			difficultyCfg.xpMult,
	),
);

// ---- 战斗属性：气血上限 / 攻击 / 防御 / 战力 ----

/** 法宝三槽提供的属性加成（含强化等级） */
const weaponBonus = $derived(player.equip.weapon ? equipValue(player.equip.weapon) : 0);
const armorBonus = $derived(player.equip.armor ? equipValue(player.equip.armor) : 0);
const artifactBonus = $derived(player.equip.artifact ? equipValue(player.equip.artifact) : 0);

/** 气血上限：境界 + 淬体丹（30×境界/颗，随境界散开）+ 炼体功法 + 法宝槽 + 灵虫 + 道侣羁绊 */
const maxHp = $derived(
	100 + currentRealm.level * 60 + player.qutiUsed * 30 * currentRealm.level + (bodyManual?.hpBonus ?? 0) + artifactBonus + wormBonus.hp + partnerBonus.hp,
);
/** 攻击：境界 + 增元丹（2×境界/颗）+ 武器 + 攻伐功法 + 灵虫 + 道侣，再乘战体加成 */
const atk = $derived(
	Math.round(
		(8 + currentRealm.level * 7 + player.zengyuanUsed * 2 * currentRealm.level + (attackManual?.atkBonus ?? 0) + weaponBonus + wormBonus.atk + partnerBonus.atk) *
			(currentPhysique?.atkMult ?? 1),
	),
);
/** 防御：境界 + 炼体功法 + 护甲 + 灵虫 */
const def = $derived(4 + currentRealm.level * 4 + (bodyManual?.defBonus ?? 0) + armorBonus + wormBonus.def);
/** 综合战力 */
const battlePower = $derived(Math.round(maxHp * 0.5 + atk * 4 + def * 3));
const hpPercent = $derived(Math.max(0, Math.round((player.hp / maxHp) * 100)));

// ---- v10 六维战力面板（肉身/灵力/神魂/道韵/因果抗性/心魔抗性，0~1000）----
/** 数值 → 0~1000 刻度（方块条按 10 格展示） */
function clampDim(v: number): number {
	return Math.max(0, Math.min(1000, Math.round(v)));
}
const sixDims = $derived.by(() => {
	const lv = currentRealm.level;
	// 各维以「同境界裸装/无灾基准」归一到 500（五格）：装备丹药灵虫天赋推高，业力心魔丹毒削低
	const norm = (v: number, base: number) => clampDim((v / Math.max(1, base)) * 500);
	const fleshBase = (100 + lv * 60) * 1.2 + (8 + lv * 7) * 4 + (4 + lv * 4) * 4;
	const flesh = maxHp * 1.2 + atk * 4 + def * 4; // 肉身强度
	const spiritBase = (5 + lv * 3) * 12 + lv * 60;
	const spirit = breathXp * 12 + lv * 60; // 灵力底蕴
	const soulBase = 120 + player.realmIndex * 20;
	const soul = soulBase + player.wudaoLeft * 2 + player.thunderPassed * 40 + player.towerFloor * 6; // 神魂力量
	const daoBase = Math.max(60, player.realmIndex * 60);
	const dao = player.realmIndex * 60 + player.manuals.length * 55 + Object.values(player.defeated).filter(Boolean).length * 20; // 道韵感悟
	const causal = 200 - Math.min(180, player.karmaDebt + player.karma * 0.5); // 因果抗性
	const heart = Math.max(0, 100 - player.demon) + wormBonus.demonCut * 3 + (currentPhysique?.demonImmune ? 400 : 0); // 心魔抗性
	return [
		{ key: "肉身", value: norm(flesh, fleshBase) },
		{ key: "灵力", value: norm(spirit, spiritBase) },
		{ key: "神魂", value: norm(soul, soulBase) },
		{ key: "道韵", value: norm(dao, daoBase) },
		{ key: "因果", value: norm(causal, 200) },
		{ key: "心魔抗", value: norm(heart, 100) },
	];
});

const eventChance = $derived(0.28 + (currentCombo?.allEventBonus ?? 0));

/**
 * 任意模态弹窗打开时，打坐周天完全暂停（不计息、不触发事件、不回血），
 * 避免雷劫/突破/斗法结算与后台事件互相干扰。
 */
const meditationPaused = $derived(
	showThunderModal ||
		showBreakthroughModal ||
		battle !== null ||
		enhanceId !== null ||
		offlineReport !== null ||
		showRebirthModal ||
		showChoiceEvent !== null ||
		needCreation,
);

// ==================== 持久化 ====================

const STORAGE_KEY = "xiuxian_save_v6";
const LEGACY_KEYS = ["xiuxian_save_v4", "xiuxian_save_v3", "xiuxian_save_v2", "xiuxian_save_v1"];

function save() {
	if (typeof localStorage !== "undefined") {
		player.lastSeen = Date.now();
		localStorage.setItem(STORAGE_KEY, JSON.stringify(player));
	}
}

/** v10.1 旧档迁移：九阶境界 → 十三阶境界（寿元按比例折算） */
function migrateSchema(rawData: unknown): Partial<PlayerState> {
	const d = { ...(rawData as Record<string, unknown>) } as Partial<PlayerState>;
	if ((d.schemaV as number | undefined) === SAVE_SCHEMA) return d;
	const oldIdx = typeof d.realmIndex === "number" ? d.realmIndex : 0;
	if (oldIdx >= 0 && oldIdx < REALM_MIGRATION.length) {
		const newIdx = REALM_MIGRATION[oldIdx];
		d.realmIndex = newIdx;
		if (typeof d.lifespan === "number") {
			const ratio = Math.min(1, d.lifespan / OLD_REALM_LIFESPANS[oldIdx]);
			d.lifespan = Math.round(REALMS[newIdx].lifespan * ratio);
		}
	}
	d.schemaV = SAVE_SCHEMA;
	return d;
}

function load() {
	if (typeof localStorage === "undefined") return;
	const raw = localStorage.getItem(STORAGE_KEY);
	if (raw) {
		try {
			const data = migrateSchema(JSON.parse(raw));
			player = {
				...player,
				...data,
				pills: { ...EMPTY_PILLS, ...(data.pills ?? {}) },
				julingLeft: typeof data.julingLeft === "number" ? data.julingLeft : 0,
				cooldowns: data.cooldowns ?? {},
				// 旧档没有功法/首通数据：补发入门心法
				manuals: Array.isArray(data.manuals) && data.manuals.length > 0 ? data.manuals : ["tuna"],
				equipped: { core: "tuna", body: null, attack: null, ...(data.equipped ?? {}) },
				defeated: data.defeated ?? {},
				// 旧档补发新系统默认值
				stones: typeof data.stones === "number" ? data.stones : 100,
				equip: { weapon: null, armor: null, artifact: null, ...(data.equip ?? {}) },
				bag: Array.isArray(data.bag) ? data.bag : [],
				towerFloor: typeof data.towerFloor === "number" ? data.towerFloor : 0,
				lastSeen: typeof data.lastSeen === "number" ? data.lastSeen : Date.now(),
				// v9 旧档兜底：寿元默认当前境界上限
				lifespan: typeof data.lifespan === "number" ? data.lifespan : REALMS[data.realmIndex ?? 0]?.lifespan ?? 100,
				karma: typeof data.karma === "number" ? data.karma : 0,
				karmaDebt: typeof data.karmaDebt === "number" ? data.karmaDebt : 0,
				souljadeUsed: typeof data.souljadeUsed === "number" ? data.souljadeUsed : 0,
				// v10 旧档兜底
				difficulty: data.difficulty === "gentle" || data.difficulty === "hard" ? data.difficulty : "normal",
				demon: typeof data.demon === "number" ? data.demon : 0,
				toxin: typeof data.toxin === "number" ? data.toxin : 0,
				talismans: { ...EMPTY_TALISMANS, ...(data.talismans ?? {}) },
				worms: Array.isArray(data.worms) ? data.worms : [],
				wormEquip: Array.isArray(data.wormEquip) && data.wormEquip.length === 3 ? data.wormEquip : [null, null, null],
				wormHunger: typeof data.wormHunger === "number" ? data.wormHunger : 0,
				landLevel: typeof data.landLevel === "number" ? data.landLevel : 0,
				// v10.1 旧档兜底
				schemaV: SAVE_SCHEMA,
				reputation: typeof data.reputation === "number" ? data.reputation : 0,
				companions: Array.isArray(data.companions) ? data.companions : [],
				favor: data.favor ?? {},
				bodyWound: typeof data.bodyWound === "number" ? data.bodyWound : 0,
				scout: Boolean(data.scout),
				fateCheat: Boolean(data.fateCheat),
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
				const old = migrateSchema(JSON.parse(oldRaw));
				player.xp = old.xp ?? 0;
				player.realmIndex = old.realmIndex ?? 0;
				player.lifespan = typeof old.lifespan === "number" ? old.lifespan : REALMS[player.realmIndex].lifespan;
				player.lastBreakthrough = old.lastBreakthrough ?? null;
				player.totalBreaths = old.totalBreaths ?? old.totalCultivations ?? 0;
				player.pills = { ...EMPTY_PILLS, ...(old.pills ?? {}) };
				player.ningshenLeft = old.ningshenLeft ?? 0;
				player.julingLeft = old.julingLeft ?? 0;
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
	return PILLS.filter((p) => !p.shopOnly && p.minRealm <= player.realmIndex);
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

// ==================== v9 业力 / 因果债 / 寿元 / 轮回 ====================

/** 业力累积：斗法/试炼胜者沾染杀业 */
function addKarma(amount: number) {
	player.karma += Math.max(1, Math.round(amount));
}

/** 因果债累积：使用逆天道具/秘术产生，难度系数放大；≥200 触发命运劫死亡 */
function addKarmaDebt(amount: number) {
	player.karmaDebt += Math.max(1, Math.round(amount * difficultyCfg.debtMult));
	if (player.karmaDebt >= 200) {
		die("debt");
	}
}

/** 寿元变化：自然流逝、战斗消耗、丹药补充；归零即死 */
function addLifespan(delta: number) {
	player.lifespan = Math.max(0, Math.min(lifespanMax, player.lifespan + delta));
	if (player.lifespan <= 0) {
		die("lifespan");
	}
}

/**
 * 濒死判定：血量归零时先检查残魂因果玉（每世限 3 次原地满血复活），
 * 无玉或次数耗尽则按死因进入轮回。返回 true 表示已由本函数处理（复活或死亡）。
 */
function checkNearDeath(cause: DeathCause): boolean {
	if (player.hp > 0) return false;
	// 本命保命法器：替死符优先，满血复生且不沾因果
	if (player.talismans.life > 0) {
		player.talismans.life -= 1;
		player.hp = maxHp;
		addLog("怀中替死符无火自燃，你于必死之局中安然复生，不沾半点因果。", "warning");
		return true;
	}
	if (player.pills.souljade > 0 && player.souljadeUsed < 3) {
		player.pills.souljade -= 1;
		player.souljadeUsed += 1;
		player.hp = maxHp;
		addKarmaDebt(40);
		addLog(`残魂因果玉碎裂，你于濒死之际原地复生（剩余 ${3 - player.souljadeUsed} 次）。`, "warning");
		return true;
	}
	die(cause);
	return true;
}

/** 死亡结算：记录本世修行总结并弹出结算弹窗（v11 一切归零，无跨世继承） */
function die(cause: DeathCause) {
	stopMeditation();
	battle = null;
	showThunderModal = false;
	showBreakthroughModal = false;
	enhanceId = null;
	saveModalMode = null;

	const firstClearCount = Object.keys(player.defeated).filter((k) => player.defeated[k]).length;
	deathCause = cause;
	rebirthReport = {
		cause,
		realm: REALMS[player.realmIndex].name,
		xp: player.xp,
		wins: player.battlesWon,
		floors: player.towerFloor,
		breaths: player.totalBreaths,
		clears: firstClearCount,
	};
	showRebirthModal = true;

	const t = DEATH_TEXTS[cause];
	addLog(`${t.title} —— ${t.desc}`, "danger");
	save();
}

/** 转世重修：清空本世一切，回到难度选择重新开始（v11 移除轮回继承，每次都是全新开始） */
function reincarnate() {
	chosenDifficulty = null;
	aptitudeResult = null;
	rootComboResult = null;
	physiqueResult = null;
	// 旧角色标记为未创角状态，驱动难度选择界面
	player.aptitude = null;
	player.rootCombo = null;
	player.physique = null;
	showRebirthModal = false;
	deathCause = null;
	rebirthReport = null;
	addLog("前世因果尽散，真灵重入轮回。请重选难度，再测天命——此世一切从零开始。", "warning");
	save();
}

/** 创角第一步：选定本周目难度并生成全新角色 */
function pickDifficulty(d: Difficulty) {
	chosenDifficulty = d;
	player = makeFreshPlayer(d);
	addLog(`你以「${DIFFICULTIES.find((x) => x.id === d)?.name}」之身踏上道途。`, "info");
	save();
}

/**
 * 自然寿元流逝：低境界岁月侵蚀快，境界越高流逝越缓，真仙几乎不损。
 * 淬体~练气 20 息/年，筑基~元婴 45，化神~合体 90，洞虚~渡劫 180，真仙不流逝。
 */
function lifespanTick() {
	if (player.realmIndex >= 12) return;
	const interval = player.realmIndex <= 2 ? 20 : player.realmIndex <= 5 ? 45 : player.realmIndex <= 8 ? 90 : 180;
	if (player.totalBreaths > 0 && player.totalBreaths % interval === 0) {
		addLifespan(-1);
	}
}

// ==================== v10 心魔 / 丹毒 ====================

/** 心魔积累：受灵虫定心与寒渊/忘情体免疫影响，封顶 100 */
function addDemon(amount: number) {
	if (currentPhysique?.demonImmune) return;
	const cut = Math.min(amount, wormBonus.demonCut * 0.5);
	player.demon = Math.max(0, Math.min(100, player.demon + amount - cut));
}

/** 丹毒积累：服丹时增加，封顶 100 */
function addToxin(amount: number) {
	player.toxin = Math.max(0, Math.min(100, player.toxin + amount));
}

// ==================== v10 符咒 ====================

/** 非战斗状态使用符咒（清心符）；战斗符在斗法弹窗内催动 */
function useTalismanOutOfBattle(t: Talisman) {
	if (player.talismans[t.id] <= 0) return;
	if (t.id === "clear") {
		player.talismans.clear -= 1;
		player.demon = Math.max(0, player.demon - 20);
		addLog("你焚化一张清心符，神思澄明，心魔 -20。", "success");
	} else {
		addLog(`「${t.name}」需在斗法或渡劫时催动。`, "warning");
	}
	save();
}

function buyTalisman(t: Talisman) {
	if (player.stones < t.price || player.realmIndex < t.minRealm) return;
	player.stones -= t.price;
	player.talismans[t.id] += 1;
	addLog(`你在坊市摊位请得一张「${t.name}」。`, "success");
	save();
}

// ==================== v10 灵虫 / 躯府 ====================

/** 按境界加权随机获得一只未拥有的灵虫；已集齐返回 null */
function rollWormDrop(minRarityIdx = 0): Worm | null {
	const unowned = WORM_POOL.filter((w) => !player.worms.includes(w.id));
	if (unowned.length === 0) return null;
	// 品阶权重：凡 45 / 灵 32 / 宝 18 / 仙 5，并受最低品阶保底
	const weights = [45, 32, 18, 5];
	let r = 0;
	let roll = Math.random() * 100;
	for (let i = 0; i < weights.length; i++) {
		roll -= weights[i];
		if (roll <= 0) { r = i; break; }
	}
	r = Math.max(r, minRarityIdx);
	const rarity = EQUIP_RARITIES[Math.min(r, EQUIP_RARITIES.length - 1)];
	let pool = unowned.filter((w) => w.rarity === rarity);
	// 该品阶已集齐则向下取最近品阶
	if (pool.length === 0) pool = [...unowned].sort((a, b) => EQUIP_RARITIES.indexOf(a.rarity) - EQUIP_RARITIES.indexOf(b.rarity)).reverse();
	return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function gainWorm(w: Worm) {
	if (player.worms.includes(w.id)) return;
	player.worms.push(w.id);
	addLog(`你收服一只灵虫「${w.name}」（${w.rarity}），可纳入躯府培育。`, "success");
}

/** 将灵虫纳入躯府指定槽位；槽内原有灵虫退回虫库（灵虫唯一，不重复持有） */
function equipWorm(slot: number, id: string) {
	if (slot < 0 || !player.worms.includes(id)) return;
	const cur = player.wormEquip[slot];
	// 若该灵虫在别的槽位，先交换
	const otherSlot = player.wormEquip.indexOf(id);
	if (otherSlot >= 0 && otherSlot !== slot) player.wormEquip[otherSlot] = cur;
	else player.wormEquip[slot] = id;
	if (otherSlot < 0 && cur) {
		// 原槽位灵虫仍在装备数组中（装备即拥有），无需操作虫库
	}
	save();
}

function unequipWorm(slot: number) {
	player.wormEquip[slot] = null;
	save();
}

/** 喂养灵虫：20 灵石 -25 饥饿度 */
function feedWorm() {
	if (player.stones < FEED_COST || player.wormHunger <= 0) return;
	player.stones -= FEED_COST;
	player.wormHunger = Math.max(0, player.wormHunger - FEED_AMOUNT);
	save();
}

// ==================== v10 福地 ====================

const LAND_COSTS = [300, 700, 1500, 3200, 6500];
function landUpgradeCost(): number | null {
	return player.landLevel >= 5 ? null : LAND_COSTS[player.landLevel];
}
function upgradeLand() {
	const cost = landUpgradeCost();
	if (cost === null || player.stones < cost) return;
	player.stones -= cost;
	player.landLevel += 1;
	addLog(`你斥资扩建福地，灵脉等级升至 ${player.landLevel} 级。`, "success");
	save();
}

// ==================== v10 秘境副本 ====================

let secretReport = $state<string | null>(null);

/** 神识探查：耗灵石锁定下一次秘境机缘，避开伏击与空境 */
function scoutSecret() {
	if ((player.cooldowns["secret"] ?? 0) > 0 || player.scout) return;
	if (player.stones < SCOUT_COST) return;
	player.stones -= SCOUT_COST;
	player.scout = true;
	addLog("你放出神识扫过秘境外围，凶机与机缘的位置已隐约在目。", "info");
	save();
}

/** 探索秘境：消耗 5 年寿元，冷却 10 息（v11 下调），高风险高回报；六古域按修为分层 */
function exploreSecret() {
	if ((player.cooldowns["secret"] ?? 0) > 0) return;
	if (player.hp < maxHp * MIN_HP_RATIO) {
		addLog("气血不足三成，入秘境与送死何异？先疗伤。", "warning");
		return;
	}
	addLifespan(-5);
	if (showRebirthModal) return; // 寿元耗尽直接入轮回
	player.cooldowns["secret"] = 10;
	// 六大古域：淬体练气入天南，洞虚以上方可踏足灵界
	const placeIdx = Math.min(SECRET_PLACES.length - 1, Math.floor(player.realmIndex / 2));
	const place = SECRET_PLACES[placeIdx];
	const scouted = player.scout;
	player.scout = false;

	let roll = Math.random();
	// 神识探查：将伏击重伤、空境等下下签替换为中上机缘
	if (scouted && roll >= 0.62) roll = 0.05 + Math.random() * 0.5;
	let report = `【${place}】`;
	if (roll < 0.18) {
		// 灵石矿脉
		const gain = 100 + Math.floor(Math.random() * 300) + player.realmIndex * 40;
		player.stones += gain;
		report += `你发现一条废弃灵石矿脉，采掘得 ${gain} 灵石。`;
	} else if (roll < 0.34) {
		// 前辈遗府：修为 + 符咒；v11 有三成半概率翻出失传功法
		const gain = breathXp * 40;
		player.xp += gain;
		const t = TALISMANS[Math.random() < 0.5 ? 0 : 3]; // 五雷符 / 破劫符
		player.talismans[t.id] += 1;
		report += `你误入古修遗府，参悟残卷得 ${gain} 修为，并拾得一张「${t.name}」。`;
		if (Math.random() < 0.35) {
			const unowned = MANUALS.filter((m) => !player.manuals.includes(m.id));
			const picked = unowned[Math.floor(Math.random() * unowned.length)];
			if (picked) {
				grantManual(picked.id);
				report += `遗府密匣中还藏着一册《${picked.name}》！`;
			}
		}
	} else if (roll < 0.48) {
		// 灵虫巢穴：高层秘境保底更高品阶
		const w = rollWormDrop(placeIdx >= 4 ? 2 : placeIdx >= 2 ? 1 : 0);
		report += w
			? `你在灵虫巢穴中收服了「${w.name}」（${w.rarity}）！`
			: "巢穴已空，灵虫早已散去。";
		if (w) gainWorm(w);
	} else if (roll < 0.62) {
		// 灵药园
		const pool = availablePills();
		const pill = pool[Math.floor(Math.random() * pool.length)];
		if (pill) {
			player.pills[pill.id] += 1;
			report += `秘境深处有一片灵药园，你采得一颗「${pill.name}」。`;
		} else {
			report += "灵药园早已枯萎，一无所获。";
		}
	} else if (roll < 0.78) {
		// 邪修伏击：黑暗博弈（未经探查才可能踩到）
		if (Math.random() < 0.55) {
			const gain = 200 + player.realmIndex * 120;
			player.xp += gain;
			player.stones += 80;
			addKarma(3);
			report += `邪修伏击反被你斩杀，夺其储物袋（${gain} 修为、80 灵石），却也沾了三分业力。`;
		} else {
			const loss = Math.round(maxHp * 0.25);
			damageHp(loss);
			addDemon(10);
			report += `你遭邪修偷袭重伤，损失 ${loss} 气血，含恨退出秘境。`;
			if (player.hp <= 0) { checkNearDeath("battle"); }
		}
	} else if (roll < 0.9) {
		// 古修遗骸：法宝（高层秘境保底宝器）
		const item = rollEquipDrop(placeIdx >= 3 ? 2 : 0, true);
		gainEquip(item);
		report += `古修遗骸旁悬着一件灵光不灭的法宝——「${item.name}」（${item.rarity}）。`;
	} else {
		// 虚无 / 福地灵泉
		if (player.landLevel > 0) {
			const s = 60 * player.landLevel;
			player.stones += s;
			report += `秘境出口恰在你福地灵脉附近，灵泉反哺，地产增收 ${s} 灵石。`;
		} else {
			report += "秘境中空空如也，只余残破阵纹。";
		}
	}
	if (scouted) report += "（神识探查已避开凶机）";
	secretReport = report;
	addLog(`秘境探索 · ${report}`, Math.random() < 0.7 ? "success" : "warning");
	save();
}

// ==================== v10.1 道侣羁绊 ====================

// v11 结识性别选择面板
let showMeetModal = $state(false);

/** 云游结识：先弹出性别选择，再从对应池随机结识 */
function meetCompanion() {
	if ((player.cooldowns["meet"] ?? 0) > 0 || player.companions.length >= COMPANIONS.length || player.stones < MEET_COST) return;
	showMeetModal = true;
}

/** 确认结识指定性别的道侣（随机取一位未结缘者） */
function confirmMeetCompanion(gender: "男" | "女") {
	const unmet = COMPANIONS.filter((c) => !player.companions.includes(c.id) && c.gender === gender);
	if ((player.cooldowns["meet"] ?? 0) > 0 || unmet.length === 0 || player.stones < MEET_COST) {
		showMeetModal = false;
		return;
	}
	player.stones -= MEET_COST;
	player.cooldowns["meet"] = 60;
	const c = unmet[Math.floor(Math.random() * unmet.length)];
	player.companions.push(c.id);
	player.favor[c.id] = 10;
	addLog(`你云游四方，与「${c.name}」（${gender}修 · ${c.trait}）一见投缘，结为道侣（好感 10）。`, "success");
	save();
	showMeetModal = false;
}

/** 赠礼：100 灵石 +5 好感，满 100 为止 */
function giftCompanion(id: string) {
	if (!player.companions.includes(id) || player.stones < GIFT_COST) return;
	if ((player.favor[id] ?? 0) >= 100) return;
	player.stones -= GIFT_COST;
	player.favor[id] = Math.min(100, (player.favor[id] ?? 0) + 5);
	save();
}

// ==================== v10.1 地下黑市 ====================

/** 黑市交易：高收益必留因果印记，损声望、积业力/因果债 */
function blackDeal(idx: number) {
	const deal = BLACK_DEALS[idx];
	if (!deal || (player.cooldowns[deal.id] ?? 0) > 0 || player.stones < deal.price) return;
	player.stones -= deal.price;
	player.cooldowns[deal.id] = deal.cd;
	if (deal.id === "bm_life") {
		addLifespan(30);
		addKarma(20);
		addKarmaDebt(10);
		player.reputation -= 10;
		addLog("黑市 · 你购下邪修夺来的寿元灵材，寿元 +30，业力与因果债缠身，正道侧目。", "warning");
	} else if (deal.id === "bm_talisman") {
		const t = TALISMANS[Math.floor(Math.random() * TALISMANS.length)];
		player.talismans[t.id] += 1;
		addKarmaDebt(8);
		player.reputation -= 5;
		addLog(`黑市 · 你低价收下一张来路不明的「${t.name}」，因果印记悄然加深。`, "warning");
	} else {
		const pool = CRAFT_PILLS.filter((p) => p.minRealm >= 4);
		const pill = pool[Math.floor(Math.random() * pool.length)] ?? PILLS[2];
		player.pills[pill.id] += 1;
		addKarmaDebt(5);
		player.reputation -= 3;
		addLog(`黑市 · 你买下贼赃丹药「${pill.name}」，声望略损。`, "warning");
	}
	save();
}

// ==================== v10.1 因果秘术 ====================

/** 催动因果秘术：按 id 结算逆天效果与代价 */
function castArcaneArt(id: ArcaneArt["id"]) {
	const art = ARCANE_ARTS.find((a) => a.id === id);
	if (!art || player.realmIndex < art.realm || (player.cooldowns[`art_${id}`] ?? 0) > 0) return;
	if (id === "peek") {
		player.cooldowns[`art_${id}`] = art.cd;
		const k = resolveTrialKind();
		addLog(`因果秘术 · 命运窥探：你窥见下一次天劫将是「${k.name}」——${k.desc}`, "info");
	} else if (id === "rewind") {
		player.cooldowns[`art_${id}`] = art.cd;
		healHp(maxHp);
		addKarmaDebt(20);
		addLog("因果秘术 · 微末回溯：时光倒流三息，你气血回满，因果债 +20。", "success");
	} else if (id === "shift") {
		if (player.lifespan < 35) {
			addLog("寿元不足三十载，强施因果偏移必当场老死，不可妄为。", "warning");
			return;
		}
		player.cooldowns[`art_${id}`] = art.cd;
		addLifespan(-30);
		if (showRebirthModal) return;
		player.karmaDebt = Math.max(0, player.karmaDebt - 30);
		addLog("因果秘术 · 因果偏移：你以三十年寿元为祭，抹除 30 点因果债。", "success");
	} else if (id === "revive") {
		if (battle) {
			addLog("斗法之中无法施展肉身返生，先退出战圈。", "warning");
			return;
		}
		player.cooldowns[`art_${id}`] = art.cd;
		player.hp = maxHp;
		addDemon(-100);
		addToxin(-100);
		addKarmaDebt(50);
		addLog("因果秘术 · 肉身返生：你重塑肉身、涤尽心魔丹毒，代价是因果债 +50。", "success");
	} else if (id === "fate") {
		player.cooldowns[`art_${id}`] = art.cd;
		player.fateCheat = true;
		addKarmaDebt(80);
		addLog("因果秘术 · 小段命运篡改：命线已改，下一次大境界突破无雷直过。天道震怒，因果债 +80！", "warning");
	}
	save();
}

/** 躯府损伤累积（杀招反噬、灵虫饥荒）；满 100 躯府崩毁：灵虫溃散、修为跌落 */
function addBodyWound(v: number) {
	player.bodyWound = Math.max(0, Math.min(100, player.bodyWound + v));
	if (player.bodyWound >= 100) {
		player.wormEquip = [null, null, null];
		const loss = Math.round(player.xp * 0.1);
		player.xp = Math.max(0, player.xp - loss);
		damageHp(maxHp * 0.3);
		player.bodyWound = 60;
		addLog(`躯府崩毁！三槽灵虫尽皆溃散，修为跌落 ${loss}，你呕血而退，重伤濒死。`, "danger");
		if (player.hp <= 0) checkNearDeath("battle");
	}
}

// ==================== v10 天道劫型 ====================

/** 本次突破的劫型：业力→业火劫，因果债→因果劫，心魔→心魔劫，暮年→岁月劫 */
function resolveTrialKind(): TrialKind {
	if (player.karma >= 80) return { id: "karmaFire", name: "业火劫", desc: "业力滔天，业火随雷而落，每败一道天雷额外折寿 20 载" };
	if (player.karmaDebt >= 100) return { id: "causal", name: "因果劫", desc: "因果缠身，硬抗天雷的成功率额外 -10%" };
	if (player.demon >= 60) return { id: "heart", name: "心魔劫", desc: "心魔外显，每败一道天雷心魔 +8" };
	if (lifespanRatio < 0.3) return { id: "years", name: "岁月劫", desc: "暮年遭劫，天雷造成的气血损失翻倍" };
	return { id: "thunder", name: "天雷劫", desc: "三道天雷，道道要命。硬抗凭运，祭丹/祭符可解" };
}

// ==================== 法宝装备 ====================

/** 法宝当前实际加成值：base × (1 + 10%×强化等级)，向下取整 */
function equipValueAt(base: number, enhance: number): number {
	return Math.floor(base * (1 + 0.1 * enhance));
}
function equipValue(item: EquipItem): number {
	return equipValueAt(item.base, item.enhance);
}

/** 法宝效果文案：武器加攻 / 护甲加防 / 法宝加气血上限 */
function equipEffectText(item: EquipItem): string {
	const key = item.slot === "weapon" ? "攻击" : item.slot === "armor" ? "防御" : "气血上限";
	return `${key} +${equipValue(item)}`;
}

/** 随机掉落一件法宝；minRarityIdx 保底品质，upgradeTier 品质升一档（斗法强敌） */
function rollEquipDrop(minRarityIdx = 0, upgradeTier = false): EquipItem {
	let r = 0;
	let roll = Math.random() * 100;
	for (let i = 0; i < EQUIP_DROP_WEIGHTS.length; i++) {
		roll -= EQUIP_DROP_WEIGHTS[i];
		if (roll <= 0) {
			r = i;
			break;
		}
	}
	if (upgradeTier) r = Math.min(EQUIP_RARITIES.length - 1, r + 1);
	r = Math.max(r, minRarityIdx);
	const rarity = EQUIP_RARITIES[r];
	const pool = EQUIP_POOL.filter((e) => e.rarity === rarity);
	const tpl = pool[Math.floor(Math.random() * pool.length)];
	return {
		id: `${tpl.tid}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
		name: tpl.name,
		slot: tpl.slot,
		rarity: tpl.rarity,
		base: tpl.base,
		enhance: 0,
	};
}

/** 法宝入囊：行囊满则按 base×5 折算灵石。返回是否入囊 */
function gainEquip(item: EquipItem): boolean {
	if (player.bag.length >= BAG_CAP) {
		const worth = item.base * 5;
		player.stones += worth;
		addLog(`行囊已满，「${item.name}」折算为 ${worth} 灵石。`, "warning");
		return false;
	}
	player.bag.push(item);
	return true;
}

/** 从行囊装备上身；原槽位法宝回囊 */
function wearEquip(item: EquipItem) {
	const idx = player.bag.findIndex((i) => i.id === item.id);
	if (idx < 0) return;
	player.bag.splice(idx, 1);
	const cur = player.equip[item.slot];
	if (cur) player.bag.push(cur);
	player.equip[item.slot] = item;
	// 卸下/更换气血法宝后上限可能下降，兜底修正
	player.hp = Math.min(player.hp, maxHp);
	addLog(`你祭起「${item.name}」（${item.rarity} · ${equipEffectText(item)}）。`, "success");
	save();
}

/** 卸下某槽位法宝回行囊 */
function unwearEquip(slot: EquipSlot) {
	const cur = player.equip[slot];
	if (!cur) return;
	if (player.bag.length >= BAG_CAP) {
		addLog("行囊已满，无法卸下法宝。", "warning");
		return;
	}
	player.equip[slot] = null;
	player.bag.push(cur);
	player.hp = Math.min(player.hp, maxHp);
	save();
}

// ==================== v11 法宝 / 灵虫卖出 ====================

/** 法宝折价：base×5 + 每级强化 +30 灵石 */
function equipSellValue(item: EquipItem): number {
	return item.base * 5 + item.enhance * 30;
}

/** 从行囊卖出法宝换灵石 */
function sellEquipFromBag(item: EquipItem) {
	const idx = player.bag.findIndex((i) => i.id === item.id);
	if (idx < 0) return;
	const worth = equipSellValue(item);
	if (!confirm(`确定将「${item.name}」卖与坊市吗？可得 ${worth} 灵石。`)) return;
	player.bag.splice(idx, 1);
	player.stones += worth;
	addLog(`「${item.name}」已卖与坊市，得 ${worth} 灵石。`, "info");
	save();
}

/** 卖出身上法宝：取下即折价，不再入囊 */
function sellEquippedEquip(slot: EquipSlot) {
	const cur = player.equip[slot];
	if (!cur) return;
	const worth = equipSellValue(cur);
	if (!confirm(`确定卖出身上「${cur.name}」（${equipEffectText(cur)}）吗？可得 ${worth} 灵石。`)) return;
	player.equip[slot] = null;
	player.stones += worth;
	player.hp = Math.min(player.hp, maxHp);
	addLog(`你将身上「${cur.name}」卖与坊市，得 ${worth} 灵石。`, "info");
	save();
}

/** 灵虫放生折价表：按品质 凡品80 / 灵品200 / 宝器500 / 仙器1200 */
const WORM_SELL_PRICE = [80, 200, 500, 1200];

/** 灵虫按品质折算灵石（未知虫按凡品计） */
function wormSellValue(id: string): number {
	const w = WORM_POOL.find((x) => x.id === id);
	if (!w) return 80;
	return WORM_SELL_PRICE[Math.max(0, EQUIP_RARITIES.indexOf(w.rarity))] ?? 80;
}

/** 放生灵虫：按品质折算灵石，若在躯府中则自动卸下 */
function releaseWorm(id: string) {
	const idx = player.worms.indexOf(id);
	if (idx < 0) return;
	const w = WORM_POOL.find((x) => x.id === id);
	if (!w) return;
	const worth = wormSellValue(id);
	if (!confirm(`确定放生灵虫「${w.name}」吗？可得 ${worth} 灵石。`)) return;
	const slot = player.wormEquip.indexOf(id);
	if (slot >= 0) player.wormEquip[slot] = null;
	player.worms.splice(idx, 1);
	player.stones += worth;
	addLog(`你将灵虫「${w.name}」放归天地，其衔来 ${worth} 灵石以谢宿主。`, "info");
	save();
}

/** 强化费用与成功率（失败不掉级不损毁，上限 +9） */
function enhanceCostOf(item: EquipItem): number {
	return 50 * (item.enhance + 1);
}
function enhanceRateOf(item: EquipItem): number {
	return Math.max(0.5, 1 - 0.06 * item.enhance);
}

/** 强化弹窗目标：按 id 从行囊/装备槽实时取，保证强化后界面同步 */
const enhanceItem = $derived.by((): EquipItem | null => {
	if (!enhanceId) return null;
	const inBag = player.bag.find((i) => i.id === enhanceId);
	if (inBag) return inBag;
	for (const { slot } of EQUIP_SLOTS) {
		const it = player.equip[slot];
		if (it && it.id === enhanceId) return it;
	}
	return null;
});

function openEnhance(item: EquipItem) {
	enhanceId = item.id;
	enhanceMsg = "";
}
function closeEnhance() {
	enhanceId = null;
	enhanceMsg = "";
}

function doEnhance() {
	const item = enhanceItem;
	if (!item || item.enhance >= 9) return;
	const cost = enhanceCostOf(item);
	if (player.stones < cost) return;
	player.stones -= cost;
	const rate = enhanceRateOf(item);
	if (Math.random() < rate) {
		item.enhance += 1;
		enhanceMsg = `强化成功！「${item.name}」升至 +${item.enhance}（${equipEffectText(item)}）。`;
		addLog(`「${item.name}」强化成功（+${item.enhance}），${equipEffectText(item)}。`, "success");
	} else {
		enhanceMsg = "强化失败，法宝灵光一暗，所幸并无损毁。";
		addLog(`「${item.name}」强化失败，${cost} 灵石打了水漂。`, "warning");
	}
	save();
}

// ==================== 坊市 ====================

/** 坊市售价：丹药耗用随境界上调（与随境界增长的效果同步），cost/10 取整到十位、最低 50 灵石 */
function pillCost(pill: Pill): number {
	return Math.round(pill.cost * (1 + currentRealm.level * 0.3));
}
function shopPrice(pill: Pill): number {
	return Math.max(50, Math.round(pillCost(pill) / 100) * 10);
}

function buyShopPill(pill: Pill) {
	const price = shopPrice(pill);
	if (player.stones < price) return;
	player.stones -= price;
	player.pills[pill.id] += 1;
	addLog(`你在坊市以 ${price} 灵石购得一颗「${pill.name}」。`, "success");
	save();
}

// ==================== 离线闭关 ====================

function formatOfflineDuration(ms: number): string {
	const totalMin = Math.floor(ms / 60000);
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	return h > 0 ? `${h} 小时 ${m} 分钟` : `${Math.max(1, m)} 分钟`;
}

/** v11 修为溢出封顶：修为最多囤到下一境界需求的 150%，超出部分散逸天地（真仙无封顶） */
let xpCapWarned = false;
function capXpOverflow() {
	const next = REALMS[player.realmIndex + 1];
	if (!next) return;
	const cap = next.requiredXp * 1.5;
	if (player.xp > cap) {
		player.xp = cap;
		if (!xpCapWarned) {
			xpCapWarned = true;
			addLog("修为已囤至瓶颈极限，再难寸进——溢出的修为正散逸天地，速速突破！", "warning");
		}
	}
}

/**
 * 离线闭关结算：超过 120 秒未在线才结算，封顶 12 小时；
 * 修为 = 在线打坐每分钟修为（基础速率，不含丹药 buff、不触发事件）× 50%，
 * 灵石按打坐产出同比例折算；出关气血回满。
 */
function settleOffline() {
	if (needCreation) {
		player.lastSeen = Date.now();
		return;
	}
	const now = Date.now();
	const elapsed = now - (player.lastSeen ?? now);
	if (elapsed < 120_000) {
		player.lastSeen = now;
		return;
	}
	const capped = Math.min(elapsed, 12 * 3600_000);
	const minutes = capped / 60000;
	// 在线速率：每息 breathXp、每 2 秒一息 → 每分钟 30 息；离线取 50%
	const xpGain = Math.round(breathXp * 30 * 0.5 * minutes);
	// 在线灵石：每 60 息（2 分钟）产出 (10+境界×6) → 每分钟一半；离线再取 50%（v11 上调）
	const stoneGain = Math.floor(((10 + player.realmIndex * 6) / 4) * minutes);
	// v11 福地离线产出：每级每分钟 6 灵石（在线为 12）
	const landGain = player.landLevel * 6 * minutes;
	player.xp += xpGain;
	capXpOverflow();
	player.stones += stoneGain + landGain;
	player.hp = maxHp;
	offlineReport = { duration: formatOfflineDuration(elapsed), xp: xpGain, stones: stoneGain + landGain };
	addLog(`闭关 ${offlineReport.duration}，出关获 ${xpGain} 修为、${stoneGain} 灵石，气血充盈。`, "success");
	save();
}

onMount(() => settleOffline());

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
		weight: 3 * ff,
		run: () => {
			const mult = 5 + Math.floor(Math.random() * 4);
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
			// 遗府灵石机缘 +100~300
			const stones = 100 + Math.floor(Math.random() * 201);
			player.stones += stones;
			let extra = `灵石 +${stones}`;
			// 10% 概率拾得一件法宝
			if (Math.random() < 0.1) {
				const item = rollEquipDrop();
				gainEquip(item);
				extra += `，另拾得法宝「${item.name}」`;
			}
			// 12% 概率在遗府深处发现上古剑修遗刻（唯一的《诛仙剑诀》产出途径）
			if (!player.manuals.includes("zhuxian") && Math.random() < 0.12) {
				grantManual("zhuxian");
				addLog(`遗府深处供着一卷上古剑修遗刻，修为另 +${delta}，${extra}！`, "success");
			} else {
				const gotPill = Math.random() < 0.35 && grantRandomPill();
				addLog(
					gotPill
						? `你误入一座古修遗府，搜得灵石丹药，修为 +${delta}，${extra}！`
						: `你误入一座古修遗府，将府中残余灵气尽数炼化，修为 +${delta}，${extra}！`,
					"success",
				);
			}
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

	// ===== v10.1 大能诅咒：业力/因果债过高时，大能降咒（耗寿、涨心魔）=====
	if (player.karma >= 60 || player.karmaDebt >= 120) {
		pool.push({
			weight: 12,
			run: () => {
				const years = 3 + Math.floor(Math.random() * 4);
				addLifespan(-years);
				addDemon(6);
				addLog(`你周身因果黑气引来一位天道大能隔空降咒，神魂被咒力啃噬，折寿 ${years} 载、心魔 +6。清心符或因果洗印符可解此厄。`, "danger");
			},
		});
	}

	// ===== v10.1 邪修封印：躯府已开灵虫时，可能被邪修隔空封印 =====
	if (player.wormEquip.some((w) => w !== null)) {
		pool.push({
			weight: 6,
			run: () => {
				addBodyWound(25);
				const loss = base * 3;
				addLog(`一名黑袍邪修隔空出手，欲封印你的躯府！你强震灵虫挣脱，仍伤了本源（躯府受损、修为 -${loss}）。`, "danger");
				return { delta: -loss };
			},
		});
	}

	// ===== 精血衰败：岁月侵蚀，寿元悄然流逝（让延寿丹/老死线有存在感）=====
	pool.push({
		weight: 7,
		run: () => {
			const loss = 4 + Math.floor(Math.random() * 4);
			addLifespan(-loss);
			addLog(`忽觉精血衰败、鬓边添霜，岁月无声流逝（寿元 -${loss} 载）。延寿丹或福地灵泉可补。`, "danger");
		},
	});

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
				const price = Math.floor(pillCost(pill) * 0.6);
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

// ==================== v11 分支抉择事件 ====================

/** 抉择选项：生成时依据玩家状态算好 disabled，run 执行并返回结算文案 */
interface ChoiceOption {
	label: string;
	hint?: string;
	disabled?: boolean;
	run: () => string;
}

/** 抉择事件：点击选项走向不同收益与风险 */
interface ChoiceEvent {
	id: string;
	title: string;
	color: string;
	desc: string;
	weight: number;
	minRealm: number;
	options: ChoiceOption[];
}

let showChoiceEvent = $state<ChoiceEvent | null>(null);
let choiceResultText = $state<string | null>(null);

/** 依据当前玩家状态实时构建抉择事件池（境界门槛 / 灵石判断即时计算） */
function buildChoiceEvents(): ChoiceEvent[] {
	const lv = currentRealm.level;
	const rate = 100 * (lv + 1); // 事件灵石基准随境界水涨船高
	const list: ChoiceEvent[] = [];

	// 1. 灵虫巢穴（灵虫获取途径）
	list.push({
		id: "wormnest", title: "灵虫巢穴", color: "#4ade80", weight: 12, minRealm: 1,
		desc: "荒洞深处传来细密虫鸣，洞壁灵光点点——似有灵虫栖居于此。",
		options: [
			{
				label: "探入捕捉",
				hint: "四成五被咬伤",
				run: () => {
					if (Math.random() < 0.55) {
						const w = rollWormDrop(lv >= 5 ? 2 : 1);
						if (w) {
							gainWorm(w);
							return `你屏息探入，一举收服「${w.name}」（${w.rarity}）！`;
						}
					}
					damageHp(maxHp * 0.1);
					return "巢中灵虫暴起伤人，你被咬伤狼狈退出（气血 -10%）。";
				},
			},
			{
				label: "焚巢取卵",
				hint: `得 ${rate} 灵石 · 业力+2 声望-2`,
				run: () => {
					player.stones += rate;
					addKarma(2);
					player.reputation = Math.max(-50, player.reputation - 2);
					return `你一把火熏出虫卵卖与药商，得 ${rate} 灵石——洞中哀鸣不绝，罪过罪过。`;
				},
			},
			{ label: "悄然离去", run: () => "你识趣退开，虫鸣渐渐远去。" },
		],
	});

	// 2. 法宝拍卖（法宝获取途径）
	list.push({
		id: "auction2", title: "蒙尘法宝", color: "#fbbf24", weight: 10, minRealm: 2,
		desc: `拍卖行正在压轴一件蒙尘法器，起拍价 ${300 * (lv + 1)} 灵石，来源神秘。`,
		options: [
			{
				label: `出价竞得（${300 * (lv + 1)} 灵石）`,
				hint: "六成得宝，四成被截胡退半款",
				disabled: player.stones < 300 * (lv + 1),
				run: () => {
					const price = 300 * (lv + 1);
					player.stones -= price;
					if (Math.random() < 0.6) {
						const e = rollEquipDrop(lv >= 5 ? 1 : 0);
						if (gainEquip(e)) return `你以 ${price} 灵石拍得「${e.name}」（${e.rarity}），天缘契合！`;
						return `拍得「${e.name}」，但行囊已满，折价换成了灵石。`;
					}
					const back = Math.floor(price / 2);
					player.stones += back;
					return `一名蒙面修士天价截胡！拍卖行退你 ${back} 灵石以表歉意。`;
				},
			},
			{ label: "转身离开", run: () => "钱财乃身外之物，你潇洒离场。" },
		],
	});

	// 3. 灵药园
	list.push({
		id: "herbgarden", title: "灵药园", color: "#a3e635", weight: 10, minRealm: 1,
		desc: "一座灵药园依山而建，园主倚着锄头打盹，药香沁人心脾。",
		options: [
			{
				label: "顺手牵丹",
				hint: "六成五得丹，三成五被抓",
				run: () => {
					if (Math.random() < 0.65) {
						const pool = availablePills();
						const pill = pool[Math.floor(Math.random() * pool.length)];
						if (pill) {
							player.pills[pill.id] += 1;
							addKarma(1);
							return `你悄然摘得一颗「${pill.name}」，转身遁走。`;
						}
					}
					const fine = Math.min(player.stones, 150 * (lv + 1));
					player.stones -= fine;
					player.reputation = Math.max(-50, player.reputation - 3);
					return `园主猛然惊醒喝破空追来！你仓皇脱身，散落 ${fine} 灵石。`;
				},
			},
			{
				label: `照价买丹（${200 * (lv + 1)} 灵石）`,
				hint: "得一颗随机丹药",
				disabled: player.stones < 200 * (lv + 1),
				run: () => {
					const price = 200 * (lv + 1);
					const pool = availablePills();
					const pill = pool[Math.floor(Math.random() * pool.length)];
					if (!pill) return "园主摊手：园中灵药皆未长成。";
					player.stones -= price;
					player.pills[pill.id] += 1;
					player.reputation = Math.min(50, player.reputation + 1);
					return `你以 ${price} 灵石买下一颗「${pill.name}」，园主还多送你两片灵叶。`;
				},
			},
			{
				label: "提醒园主防盗",
				hint: "声望 +2，赠化毒丹",
				run: () => {
					player.reputation = Math.min(50, player.reputation + 2);
					player.pills.huadu += 1;
					return "你轻咳一声替园主望风，园主感激不尽，赠你一颗「化毒丹」。";
				},
			},
		],
	});

	// 4. 落难修士
	list.push({
		id: "stranded", title: "落难修士", color: "#60a5fa", weight: 10, minRealm: 2,
		desc: "一名浑身浴血的修士倒在道旁，微弱气息中带着一丝戒备。",
		options: [
			{
				label: "出手相救（200 灵石药费）",
				hint: "声望 +3，可能获厚报",
				disabled: player.stones < 200,
				run: () => {
					player.stones -= 200;
					player.reputation = Math.min(50, player.reputation + 3);
					if (Math.random() < 0.5) {
						const gain = 300 * (lv + 1);
						player.stones += gain;
						return `修士伤愈后报出师门名号，赠你 ${gain} 灵石作谢。`;
					}
					const gain = breathXp * 30;
					player.xp += gain;
					return `修士临别传授一段行功心得，你获益 ${gain} 修为。`;
				},
			},
			{
				label: "趁火打劫",
				hint: "得灵石 · 业力+6 声望-5 · 三成五遭同伴伏击",
				run: () => {
					const gain = 250 * (lv + 1);
					player.stones += gain;
					addKarma(6);
					player.reputation = Math.max(-50, player.reputation - 5);
					if (Math.random() < 0.35) {
						damageHp(maxHp * 0.25);
						addDemon(5);
						return `你搜出 ${gain} 灵石，其同伴却从林中暴起偷袭！你带伤杀出（气血 -25%，心魔 +5）。`;
					}
					return `你搜出 ${gain} 灵石扬长而去，身后传来咒骂与哭嚎。`;
				},
			},
			{ label: "视而不见", run: () => "你垂目走过，心中微有不安。" },
		],
	});

	// 5. 邪修拦路
	list.push({
		id: "evilway", title: "邪修拦路", color: "#f87171", weight: 10, minRealm: 1,
		desc: "一名邪修拦住去路，阴笑着索要「买路财」。",
		options: [
			{
				label: "硬碰硬",
				hint: "以当前气血开战，胜得灵石",
				run: () => {
					const res = simulateBattle();
					player.hp = Math.min(player.hp, Math.max(1, res.remainHp));
					if (res.win) {
						const gain = 200 * (lv + 1);
						player.stones += gain;
						addKarma(3);
						return `恶战 ${res.rounds} 回合，你将邪修斩于马下，缴获 ${gain} 灵石！`;
					}
					damageHp(maxHp * 0.25);
					addDemon(5);
					return `邪修道行深不可测，恶战 ${res.rounds} 回合后你负伤遁走（气血 -25%，心魔 +5）。`;
				},
			},
			{
				label: `破财消灾（${150 * (lv + 1)} 灵石）`,
				disabled: player.stones < 150 * (lv + 1),
				run: () => {
					const price = 150 * (lv + 1);
					player.stones -= price;
					return `你甩出 ${price} 灵石，邪修掂了掂重量，让开了道路。`;
				},
			},
			{
				label: "施展遁法",
				hint: "七成全身而退",
				run: () => {
					if (Math.random() < 0.7) return "你身形一晃，借山势摆脱了纠缠。";
					damageHp(maxHp * 0.2);
					return "遁光未成已被邪修追上，一记黑焰拍在背心（气血 -20%）！";
				},
			},
		],
	});

	// 6. 陨铁天降
	list.push({
		id: "meteorite", title: "陨铁天降", color: "#94a3b8", weight: 8, minRealm: 2,
		desc: "夜空中一颗流星拖着青焰坠入深谷，谷底一块陨铁尚有余温。",
		options: [
			{
				label: "吞炼陨铁",
				hint: "攻击永久 +2×境界 · 心魔 +8",
				run: () => {
					const gain = 2 * currentRealm.level;
					player.zengyuanUsed += 1;
					addDemon(8);
					return `你以秘法将陨铁熔入四肢百骸，攻击永久 +${gain}——代价是心魔滋生 +8。`;
				},
			},
			{
				label: "卖与坊市",
				hint: `得 ${400 * (lv + 1)} 灵石`,
				run: () => {
					const gain = 400 * (lv + 1);
					player.stones += gain;
					return `陨铁在坊市被炼器师高价收购，你得 ${gain} 灵石。`;
				},
			},
		],
	});

	// 7. 黑市悬赏
	list.push({
		id: "bounty", title: "黑市悬赏", color: "#f0abfc", weight: 8, minRealm: 3,
		desc: "黑市墙上贴着一张悬赏令：取一名叛逃修士首级，赏金丰厚。",
		options: [
			{
				label: "接下悬赏",
				hint: "以当前气血开战 · 业力+8 声望-4",
				run: () => {
					const res = simulateBattle();
					player.hp = Math.min(player.hp, Math.max(1, res.remainHp));
					if (res.win) {
						const gain = 500 * (lv + 1);
						player.stones += gain;
						addKarma(8);
						player.reputation = Math.max(-50, player.reputation - 4);
						return `你循线追杀三昼夜，终于得手。黑市如约奉上 ${gain} 灵石。`;
					}
					damageHp(maxHp * 0.3);
					return "叛逃修士修为远超预想，你血战不敌，拖着残躯逃回（气血 -30%）。";
				},
			},
			{
				label: "向正道举报",
				hint: `声望 +3，得 ${150 * (lv + 1)} 灵石义赏`,
				run: () => {
					const gain = 150 * (lv + 1);
					player.stones += gain;
					player.reputation = Math.min(50, player.reputation + 3);
					return `正道循报缉拿叛修，义赏 ${gain} 灵石落入你手。`;
				},
			},
			{ label: "一笑而过", run: () => "多一事不如少一事，你揭下了目光。" },
		],
	});

	// 8. 云游长老论道（NPC 互动 · 禅心不染经来源）
	list.push({
		id: "elder", title: "云游长老", color: "#a5f3fc", weight: 9, minRealm: 1,
		desc: "一位白眉长老在山亭讲道，声如洪钟，听者如云。",
		options: [
			{
				label: "静心恭听",
				hint: "修为精进，或悟《禅心不染经》",
				run: () => {
					const gain = breathXp * 30;
					player.xp += gain;
					if (Math.random() < 0.4 && grantManual("chanxin")) {
						return `长老一句偈语点醒梦中人——你顿悟《禅心不染经》，另获 ${gain} 修为！`;
					}
					return `你听完一卷妙法，如醍醐灌顶，修为 +${gain}。`;
				},
			},
			{
				label: `供养灵茶（${100 * (lv + 1)} 灵石）`,
				hint: "大段感悟 + 心魔 -5",
				disabled: player.stones < 100 * (lv + 1),
				run: () => {
					const price = 100 * (lv + 1);
					const gain = breathXp * 80;
					player.stones -= price;
					player.xp += gain;
					player.demon = Math.max(0, player.demon - 5);
					return `一盏灵茶换来半日倾谈，你修为 +${gain}，心结也解开了几分（心魔 -5）。`;
				},
			},
			{ label: "不感兴趣", run: () => "道不同不相为谋，你绕亭而过。" },
		],
	});

	// 9. 行脚商人（灵虫 / 法宝 / 商道功法来源）
	list.push({
		id: "peddler", title: "行脚商人", color: "#fb923c", weight: 9, minRealm: 1,
		desc: "货郎担上奇光流转——虫笼、法器、残卷应有尽有，就是不便宜。",
		options: [
			{
				label: `买下虫笼（${250 * (lv + 1)} 灵石）`,
				hint: "必得一只灵虫",
				disabled: player.stones < 250 * (lv + 1),
				run: () => {
					player.stones -= 250 * (lv + 1);
					const w = rollWormDrop(lv >= 5 ? 2 : 1);
					if (w) {
						gainWorm(w);
						return `你买下虫笼，笼中「${w.name}」（${w.rarity}）冲你拱了拱须。`;
					}
					return "笼中灵虫奄奄一息，商人讪讪退了半款。";
				},
			},
			{
				label: `买下法器（${400 * (lv + 1)} 灵石）`,
				hint: "必得一件法宝",
				disabled: player.stones < 400 * (lv + 1),
				run: () => {
					player.stones -= 400 * (lv + 1);
					const e = rollEquipDrop(lv >= 5 ? 1 : 0);
					if (gainEquip(e)) return `你买下法器，擦去浮尘——竟是「${e.name}」（${e.rarity}）！`;
					return `买下「${e.name}」，但行囊已满，折价换成了灵石。`;
				},
			},
			{
				label: "攀谈行情",
				hint: "或悟《商道聚灵术》",
				run: () => {
					if (Math.random() < 0.35 && grantManual("shangdao")) {
						return "商人见你有缘，传你一部《商道聚灵术》——原来赚钱也是修行！";
					}
					const gain = 80 * (lv + 1);
					player.stones += gain;
					return `你与商人相谈甚欢，还倒手一批灵物小赚 ${gain} 灵石。`;
				},
			},
		],
	});

	// 10. 街角老丐（NPC 互动 · 龟息养元功来源）
	list.push({
		id: "beggar", title: "街角老丐", color: "#9ca3af", weight: 9, minRealm: 1,
		desc: "街角老丐破衣烂衫，一双眸子却深邃如渊，似藏乾坤。",
		options: [
			{
				label: "赠灵石 100",
				hint: "声望 +3 · 四成五得高人馈赠",
				disabled: player.stones < 100,
				run: () => {
					player.stones -= 100;
					player.reputation = Math.min(50, player.reputation + 3);
					if (Math.random() < 0.45) {
						if (Math.random() < 0.5 && grantManual("guixi")) {
							return "老丐哈哈大笑：「小友心善！」袖中飞出一册《龟息养元功》。";
						}
						player.pills.tianyuan += 2;
						return "老丐掌心一翻，两颗「天元丹」凭空而至——原来是位隐世高人！";
					}
					return "老丐拱手称谢，深藏功与名。";
				},
			},
			{
				label: "一脚踢开",
				hint: "声望 -4 · 业力 +2",
				run: () => {
					player.reputation = Math.max(-50, player.reputation - 4);
					addKarma(2);
					return "老丐不闪不避，只幽幽看了你一眼——那一眼让你心头莫名一寒。";
				},
			},
			{ label: "绕道而行", run: () => "你压低头颅匆匆走过，不去招惹。" },
		],
	});

	// 11. 道侣相伴修行（好感互动：助力或共险）
	const met = COMPANIONS.filter((c) => player.companions.includes(c.id));
	if (met.length > 0) {
		const c = met[Math.floor(Math.random() * met.length)];
		const f = player.favor[c.id] ?? 0;
		list.push({
			id: "companion_bond", title: `${c.name} · 相伴修行`, color: c.color, weight: 7, minRealm: 0,
			desc: `${c.name}（${c.trait}）遣传音符相邀：愿与你共入静室论道，或同赴一处新开的秘府历练。（好感 ${f}/100）`,
			options: [
				{
					label: "静室论道",
					hint: "好感 +6 · 修为小进",
					run: () => {
						player.favor[c.id] = Math.min(100, (player.favor[c.id] ?? 0) + 6);
						const gain = 30 * (lv + 1);
						player.xp += gain;
						return `你们彻夜论道，契鸣如钟——好感 +6，修为 +${gain}。`;
					},
				},
				{
					label: "同闯秘府",
					hint: "灵石丰厚 · 三成受伤",
					run: () => {
						const gain = rate * 2;
						player.stones += gain;
						player.favor[c.id] = Math.min(100, (player.favor[c.id] ?? 0) + 3);
						if (Math.random() < 0.3) {
							player.hp = Math.max(1, Math.floor(player.hp * 0.7));
							return `秘府凶险，${c.name}护你周全却受了暗伤——灵石 +${gain}，好感 +3，气血 -30%。`;
						}
						return `二人合力，满载而归——灵石 +${gain}，好感 +3。`;
					},
				},
				{
					label: "婉言推拒",
					hint: "好感 -4",
					run: () => {
						player.favor[c.id] = Math.max(0, (player.favor[c.id] ?? 0) - 4);
						return `${c.name}眼底掠过一丝落寞：「道友既忙，改日再会罢。」好感 -4。`;
					},
				},
			],
		});

		// 12. 道侣传讯求援（高风险高回报：好感大幅波动）
		list.push({
			id: "companion_danger", title: `${c.name} · 传讯求援`, color: "#fb7185", weight: 6, minRealm: 0,
			desc: `${c.name}的传音符急促震颤：「仇家寻衅，我被困于断魂崖，速来！」——驰援是生死之交，亦是生死之险。`,
			options: [
				{
					label: "仗义驰援",
					hint: "好感 +10 · 三成重伤",
					run: () => {
						player.favor[c.id] = Math.min(100, (player.favor[c.id] ?? 0) + 10);
						if (Math.random() < 0.3) {
							player.hp = Math.max(1, Math.floor(player.hp * 0.5));
							return `血战脱围，${c.name}眼含泪光——好感 +10，但你负伤不轻（气血 -50%）。`;
						}
						return `你及时赶到，一剑退敌。${c.name}紧握你的手久久无言——好感 +10。`;
					},
				},
				{
					label: `掷金雇援（${200 * (lv + 1)} 灵石）`,
					hint: "破财免险 · 好感 +5",
					disabled: player.stones < 200 * (lv + 1),
					run: () => {
						player.stones -= 200 * (lv + 1);
						player.favor[c.id] = Math.min(100, (player.favor[c.id] ?? 0) + 5);
						return `你重金雇来两位散修驰援。${c.name}虽平安归来，却知你未曾亲至——好感 +5。`;
					},
				},
				{
					label: "闭门不出",
					hint: "好感 -15 · 声望 -5",
					run: () => {
						player.favor[c.id] = Math.max(0, (player.favor[c.id] ?? 0) - 15);
						player.reputation = Math.max(-50, player.reputation - 5);
						return `你终究没有出手。${c.name}九死一生独自归来，自此再未传讯——好感 -15，风声传开，声望 -5。`;
					},
				},
			],
		});
	}

	return list;
}

/** 选择分支：执行并展示结果（弹窗停留在结算文案上） */
function pickChoiceOption(idx: number) {
	const ev = showChoiceEvent;
	if (!ev) return;
	const opt = ev.options[idx];
	if (!opt || opt.disabled) return;
	choiceResultText = opt.run();
	save();
}

/** 关闭抉择弹窗 */
function closeChoiceEvent() {
	showChoiceEvent = null;
	choiceResultText = null;
}

// ==================== 打坐 ====================

let breathTimer: ReturnType<typeof setInterval> | null = null;

function breathTick() {
	// 雷劫/突破/斗法弹窗期间周天完全暂停：不计息、不回血、不减冷却、不触发事件
	if (meditationPaused) return;

	let xpGain = breathXp + Math.floor(Math.random() * (breathXp * 0.6 + 1));

	if (player.ningshenLeft > 0) { xpGain *= 2; player.ningshenLeft -= 1; }
	if (player.julingLeft > 0) player.julingLeft -= 1;
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

	// v11 奇遇抉择：偶发弹出分支事件面板，打坐随之暂停（约每半分钟一次机会）
	if (!showChoiceEvent && Math.random() < 0.03) {
		const pool = buildChoiceEvents().filter((e) => player.realmIndex >= e.minRealm);
		const total = pool.reduce((s, e) => s + e.weight, 0);
		let r = Math.random() * total;
		for (const e of pool) {
			r -= e.weight;
			if (r <= 0) {
				showChoiceEvent = e;
				choiceResultText = null;
				break;
			}
		}
	}

	player.xp = Math.max(0, player.xp + xpGain);
	capXpOverflow();
	player.totalBreaths += 1;
	// 每 60 息凝练一批灵石（打坐的灵石产出，受功法/灵虫/福地/道侣/聚灵丹加成；v11 上调）
	if (player.totalBreaths % 60 === 0) {
		const base = (10 + player.realmIndex * 6) * (coreManual?.gatherMult ?? 1) * wormBonus.gatherMult * partnerBonus.xpMult * (player.julingLeft > 0 ? 2 : 1);
		player.stones += Math.round(base);
		// v11 福地灵脉：每级额外产出 12 灵石
		if (player.landLevel > 0) player.stones += 12 * player.landLevel;
		// v10 打坐调理：丹毒 -2、心魔 -1；灵虫饥饿 +2
		player.toxin = Math.max(0, player.toxin - 2);
		addDemon(-1);
		if (equippedWorms.some((w) => w !== null)) {
			player.wormHunger = Math.min(100, player.wormHunger + 2);
			if (player.wormHunger === 70) addLog("躯府中的灵虫饥鸣阵阵，再不喂养，其加持将大幅衰退。", "warning");
			// v10.1 重度饥荒：灵虫反噬宿主、损伤躯府
			if (player.wormHunger >= 85) addBodyWound(3);
		}
		// v10.1 躯府温养：灵虫温饱时损伤缓慢自愈
		if (player.bodyWound > 0 && player.wormHunger < 70) addBodyWound(-2);
	}
	// v10 福地 3 级以上灵泉滋养：每 120 息 +1 寿元
	if (player.landLevel >= 3 && player.totalBreaths % 120 === 0) {
		addLifespan(1);
	}
	// v9 每 30 息自然流逝 1 年寿元（归零触发轮回）
	lifespanTick();
	// v10 心魔暴走：心魔 ≥80 时每息 4% 概率走火入魔，损失 8% 气血
	if (player.demon >= 80 && Math.random() < 0.04) {
		damageHp(maxHp * 0.08);
		addLog("心魔骤然暴走！你真元逆冲，经脉受创，损失 8% 气血。", "danger");
		if (player.hp <= 0) { checkNearDeath("battle"); }
	}
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
		if (
			showThunderModal ||
			showBreakthroughModal ||
			battle !== null ||
			saveModalMode !== null ||
			enhanceId !== null ||
			offlineReport !== null ||
			showRebirthModal
		) {
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
		case "juqi": {
			const gain = Math.max(100, Math.round(breathXp * 20));
			player.xp += gain;
			addLog(`你服下一颗聚气丹，灵力增长 ${gain} 点。`, "success");
			break;
		}
		case "huichun":
			healHp(maxHp * 0.5);
			addLog("你服下回春丹，温润药力游走四肢百骸，恢复 50% 气血。", "success");
			break;
		case "ningshen":
			player.ningshenLeft += 30;
			addLog("你服下一颗凝神丹，接下来 30 息修炼收益翻倍。", "success");
			break;
		case "juling":
			player.julingLeft += 90;
			addLog("你服下一颗聚灵丹，90 息内打坐灵石产出翻倍。", "success");
			break;
		case "huadu":
			player.toxin = Math.max(0, player.toxin - 40);
			addLog("你服下一颗化毒丹，一股清凉化去体内丹毒（丹毒 -40）。", "success");
			break;
		case "peiyuan":
			player.bodyWound = Math.max(0, player.bodyWound - 30);
			addLog("你服下一颗培元丹，温热药力修复受损躯府（损伤 -30）。", "success");
			break;
		case "pomo":
			player.demon = Math.max(0, player.demon - 25);
			addLog("你服下一颗破魔丹，浩然正气涤荡神魂（心魔 -25）。", "success");
			break;
		case "humai":
			healHp(maxHp * 0.8);
			addLog("你服下一颗护脉丹，护脉之力贯通全身，气血恢复 80%。", "success");
			break;
		case "pojing":
			player.pojingActive = true;
			addLog("你服下一颗破境丹，下次突破成功率大增。", "success");
			break;
		case "quti": {
			// 累计服用数 +1，上限按「30×当前境界」折算，境界提升后旧丹药力同步散开
			const gain = 30 * currentRealm.level;
			player.qutiUsed += 1;
			healHp(gain);
			addLog(`淬体丹药力淬炼筋骨，气血上限永久 +${gain}！`, "success");
			break;
		}
		case "zengyuan": {
			// 累计服用数 +1，攻击按「2×当前境界」折算，随境界一同精进
			const gain = 2 * currentRealm.level;
			player.zengyuanUsed += 1;
			addLog(`增元丹真元入体，攻击永久 +${gain}！`, "success");
			break;
		}
		case "tianyuan": {
			const gain = Math.max(800, Math.round(breathXp * 60));
			player.xp += gain;
			addLog(`你服下一颗天元丹，修为暴涨 ${gain} 点！`, "success");
			break;
		}
		case "wudao":
			player.wudaoLeft += 60;
			addLog("你服下一颗悟道丹，60 息内机缘类事件概率三倍！", "success");
			break;
		case "jiuzhuan": {
			const gain = Math.max(4000, Math.round(breathXp * 250));
			player.xp += gain;
			addLog(`九转金丹入口即化，修为狂涨 ${gain} 点！！`, "success");
			break;
		}
		case "shouyuan":
			addLifespan(120);
			addLog("你服下一颗延寿丹，生机焕发，寿元 +120 载。", "success");
			break;
		case "timesand":
			player.hp = maxHp;
			addKarmaDebt(30);
			addLog("光阴碎片流转，你回溯至巅峰状态（气血回满），因果债 +30。", "success");
			break;
		case "mirror": {
			// 命运窥镜：预窥下一次天劫劫型
			const k = resolveTrialKind();
			addKarmaDebt(25);
			addDemon(10);
			addLog(`你催动命运窥镜，镜中映出下一次天劫——「${k.name}」：${k.desc}`, "info");
			break;
		}
		case "karmaseal":
			// 因果洗印符：抹债 40，折寿百年（寿元不足不可用，避免暴毙设计争议）
			if (player.lifespan < 110) {
				player.pills.karmaseal += 1;
				addLog("剩余寿元不足百一十年，强用洗印符必当场老死，符被你收回。", "warning");
				save();
				return;
			}
			player.karmaDebt = Math.max(0, player.karmaDebt - 40);
			addLifespan(-100);
			addLog("因果洗印符化作灰烬，你身上的恶性因果印记淡去一截（因果债 -40），百年寿元随之燃尽。", "success");
			break;
		case "souljade":
			// 残魂玉为被动护身法宝，不可主动服用：退回库存并结束
			player.pills.souljade += 1;
			addLog("残魂因果玉需贴身佩戴，濒死时会自动碎裂护主，无法主动服用。", "warning");
			save();
			return;
	}
	// v10 服药积丹毒：品阶越高丹毒越重（化毒丹药性中和；因果道具走因果债，不积丹毒）
	const noToxin = pill.id === "timesand" || pill.id === "mirror" || pill.id === "karmaseal" || pill.id === "huadu";
	if (!noToxin) addToxin(pill.id === "shouyuan" ? 2 : pill.minRealm >= 4 ? 8 : pill.minRealm >= 2 ? 5 : 2);
	save();
}

/** 炼丹：按丹药境界决定成功率，失败损失修为材料；材料耗用随境界上调 */
function buyPill(pill: Pill) {
	const cost = pillCost(pill);
	if (player.xp < cost || player.realmIndex < pill.minRealm) return;
	player.xp -= cost;
	const rate = craftSuccessRate(pill.minRealm);
	if (Math.random() < rate) {
		player.pills[pill.id] += 1;
		addLog(`丹炉开启，你成功炼制出一颗「${pill.name}」（成功率 ${Math.round(rate * 100)}%）。`);
	} else {
		addLog(`「${pill.name}」炼制失败，丹炉炸响，${cost} 修为的药材尽数报废（成功率 ${Math.round(rate * 100)}%）。`, "danger");
	}
	save();
}

// ==================== 功法 ====================

/** 获得功法：新功法自动填入空闲槽位；重复功法折算修为。返回是否为首次获得 */
function grantManual(id: string): boolean {
	const m = MANUALS.find((x) => x.id === id);
	if (!m) return false;
	if (player.manuals.includes(id)) {
		const reward = MANUAL_DUP_REWARD[m.rarity];
		player.xp += reward;
		addLog(`《${m.name}》你早已修成，残卷化作 ${reward} 修为感悟。`, "info");
		return false;
	}
	player.manuals.push(id);
	// 对应槽位若空着则自动装备，立刻生效
	if (!player.equipped[m.slot]) player.equipped[m.slot] = id;
	addLog(`你得到功法秘籍《${m.name}》（${m.rarity}）！`, "success");
	return true;
}

/** 装备某功法到其对应槽位（同槽替换） */
function equipManual(id: string) {
	const m = MANUALS.find((x) => x.id === id);
	if (!m || !player.manuals.includes(id) || player.equipped[m.slot] === id) return;
	player.equipped[m.slot] = id;
	addLog(`你改修《${m.name}》，功行切换，属性即时变化。`);
	save();
}

// ==================== 斗法台（交互式回合战）====================

/** 生成某对手当前数值（随玩家境界动态变化） */
function getEnemy(tpl: EnemyTemplate): EnemyStats {
	const level = Math.max(1, currentRealm.level + tpl.levelOffset);
	const base = makeEnemy(level, 1, 1);
	// 淬体境首敌：等级已被钳制为 1，无法再低，直接弱化属性，让新手首场稳胜
	if (currentRealm.level === 1 && tpl.levelOffset < 0) {
		base.hp = Math.round(base.hp * 0.6);
		base.atk = Math.round(base.atk * 0.6);
		base.def = Math.max(0, Math.round(base.def * 0.6));
		base.power = Math.round(base.hp * 0.5 + base.atk * 4 + base.def * 3);
		return { tpl, level, ...base };
	}
	// v11 强敌浮动：气血 1.1~1.5 倍随机波动（攻随之缓涨），绝地难度整体再凶三分——劲敌不期而遇
	const surge = (1.1 + Math.random() * 0.4) * (difficultyCfg.id === "hard" ? 1.1 : difficultyCfg.id === "normal" ? 1.05 : 1);
	base.hp = Math.round(base.hp * surge);
	base.atk = Math.round(base.atk * (1 + (surge - 1) * 0.6));
	base.power = Math.round(base.hp * 0.5 + base.atk * 4 + base.def * 3);
	return { tpl, level, ...base };
}

/** 第 index 个对手是否解锁：首个默认开放，其余需先首通前一名 */
function isEnemyUnlocked(index: number): boolean {
	if (index <= 0) return true;
	const prev = ENEMY_TEMPLATES[index - 1];
	return Boolean(prev && player.defeated[prev.id]);
}

/** 玩家一击伤害：攻防公式 × 攻伐功法倍率 × ±15% 随机浮动，保底 1 */
function rollMyDamage(enemyDef: number): number {
	// v10.1 暴击：概率造成 1.6 倍伤害
	const crit = Math.random() < critRate / 100;
	const v = (atk - enemyDef * 0.5) * (attackManual?.dmgMult ?? 1) * (0.85 + Math.random() * 0.3) * (crit ? 1.6 : 1);
	return Math.max(1, Math.round(v));
}

/** 敌人一击伤害：攻防公式 × 难度系数 × ±15% 随机浮动，保底 1 */
function rollEnemyDamage(enemyAtk: number): number {
	const v = (enemyAtk - def * 0.5) * difficultyCfg.enemyMult * (0.85 + Math.random() * 0.3);
	return Math.max(1, Math.round(v));
}

/** 向战斗播报区压入一条消息（最新在上，最多保留 12 条） */
function battlePushLog(message: string, type: LogEntry["type"] = "info") {
	if (!battle) return;
	const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
	battle.logs = [{ time, message, type }, ...battle.logs].slice(0, 12);
}

/** 主动挑战：校验解锁/冷却/气血后开启斗法弹窗 */
function startBattle(tpl: EnemyTemplate, index: number) {
	if (battle || !isEnemyUnlocked(index)) return;
	if ((player.cooldowns[tpl.id] ?? 0) > 0) return;
	if (player.hp < maxHp * MIN_HP_RATIO) {
		addLog(`你气血不足三成，不宜斗法，先打坐疗伤或服回春丹吧。`, "warning");
		return;
	}
	const enemy = getEnemy(tpl);
	// v9 每场斗法消耗 2 年寿元
	addLifespan(-2);
	if (showRebirthModal) return; // 寿元耗尽直接入轮回，不再开战
	battle = {
		tplId: tpl.id,
		source: "arena",
		towerN: 0,
		enemyName: tpl.name,
		enemyTitle: tpl.title,
		ehp: enemy.hp,
		ehpMax: enemy.hp,
		eatk: enemy.atk,
		edef: enemy.def,
		epower: enemy.power,
		rounds: 1,
		logs: [],
		status: "fighting",
		reward: 0,
		firstClear: false,
		manualName: null,
		pillName: null,
		stoneGain: 0,
		equipName: null,
		stunned: false,
		killUsed: false,
	};
	battlePushLog(`你登台对阵「${tpl.name}」（战力 ${enemy.power}），战斗开始！`, "warning");
}

/** 敌人反击；若玩家被击杀则结算败北，返回是否已结束。镇妖符封印时本回合无法反击 */
function enemyStrikeBack(): boolean {
	const b = battle;
	if (!b || b.status !== "fighting") return true;
	if (b.stunned) {
		b.stunned = false;
		battlePushLog(`「${b.enemyName}」被镇妖符钉在原地，这一合无法动弹！`, "success");
		b.rounds += 1;
		return false;
	}
	const dmg = rollEnemyDamage(b.eatk);
	// v10.1 闪避：概率完全躲过这一击
	if (Math.random() < dodgeRate / 100) {
		battlePushLog(`「${b.enemyName}」反扑而来，你身形一晃堪堪避过，毫发无伤！`, "success");
		b.rounds += 1;
		return false;
	}
	player.hp = Math.max(0, player.hp - dmg);
	battlePushLog(`「${b.enemyName}」反扑，你失去 ${dmg} 点气血。`, "danger");
	if (player.hp <= 0) {
		if (b.source === "tower") finishTowerLose();
		else finishBattleLose();
		return true;
	}
	b.rounds += 1;
	return false;
}

/** 玩家操作：出手攻击 */
function battleAttack() {
	const b = battle;
	if (!b || b.status !== "fighting") return;
	const dmg = rollMyDamage(b.edef);
	b.ehp = Math.max(0, b.ehp - dmg);
	battlePushLog(`第 ${b.rounds} 合 · 你运剑猛攻，对「${b.enemyName}」造成 ${dmg} 点伤害。`);
	if (b.ehp <= 0) {
		if (b.source === "tower") {
			finishTowerWin();
		} else {
			const tpl = ENEMY_TEMPLATES.find((t) => t.id === b.tplId);
			if (tpl) finishBattleWin(tpl);
		}
		return;
	}
	enemyStrikeBack();
	save();
}

/** 玩家操作：吞服回春丹（回复 50% 气血，但占用一回合，敌人照常反击） */
function battleUsePill() {
	const b = battle;
	if (!b || b.status !== "fighting") return;
	if (player.pills.huichun <= 0) {
		battlePushLog("你摸出药瓶——回春丹早已用尽！", "warning");
		return;
	}
	player.pills.huichun -= 1;
	const before = player.hp;
	healHp(maxHp * 0.5);
	battlePushLog(`你吞下一颗回春丹，气血回升 ${player.hp - before} 点。`, "success");
	if (!enemyStrikeBack()) save();
}

/** 玩家操作：遁走（v11 七成五全身而退；失手则硬吃一记杀招并消耗一合，打不过也能赌命逃离） */
function battleRetreat() {
	const b = battle;
	if (!b || b.status !== "fighting") return;
	if (Math.random() < 0.75) {
		b.status = "retreat";
		battlePushLog("你虚晃一招跳下斗法台，金蝉脱壳，全身而退。", "warning");
		addLog(`你从与「${b.enemyName}」的斗法中全身而退，无功无过。`, "warning");
	} else {
		const dmg = rollEnemyDamage(b.eatk);
		player.hp = Math.max(0, player.hp - dmg);
		battlePushLog(`遁走失手！「${b.enemyName}」一记杀招扫中你的后心，失去 ${dmg} 点气血。`, "danger");
		b.rounds += 1;
		if (player.hp <= 0) {
			save();
			if (b.source === "tower") finishTowerLose();
			else finishBattleLose();
			return;
		}
	}
	save();
}

/** v10 催动五雷符：3× 攻击的固定伤害，占用一回合（敌人照常反击） */
function battleTalismanStrike() {
	const b = battle;
	if (!b || b.status !== "fighting" || player.talismans.strike <= 0) return;
	player.talismans.strike -= 1;
	const dmg = Math.round(atk * 3);
	b.ehp = Math.max(0, b.ehp - dmg);
	battlePushLog(`你甩出一张五雷符，紫雷贯顶，对「${b.enemyName}」造成 ${dmg} 点固定伤害！`, "success");
	if (b.ehp <= 0) {
		if (b.source === "tower") finishTowerWin();
		else {
			const tpl = ENEMY_TEMPLATES.find((t) => t.id === b.tplId);
			if (tpl) finishBattleWin(tpl);
		}
		return;
	}
	if (!enemyStrikeBack()) save();
}

/** v10 催动镇妖符：封印敌人一回合（下一次攻击敌人不反击），不占用出手机会之外的回合 */
function battleTalismanSeal() {
	const b = battle;
	if (!b || b.status !== "fighting" || player.talismans.seal <= 0 || b.stunned) return;
	player.talismans.seal -= 1;
	b.stunned = true;
	battlePushLog("镇妖符化作金链缠上敌身，其下一次反击被封！", "success");
	save();
}

/** v10 道衍杀招：躯府三虫联动，造成 3.5× 攻击伤害；每场限一次，反噬 10% 气血、心魔 +5 */
function battleKillMove() {
	const b = battle;
	if (!b || b.status !== "fighting" || b.killUsed || !killMoveReady) return;
	b.killUsed = true;
	const dmg = Math.round(atk * 3.5);
	b.ehp = Math.max(0, b.ehp - dmg);
	const backlash = Math.round(maxHp * 0.1);
	damageHp(backlash);
	addDemon(5);
	// v10.1 强催杀招反噬躯府
	addBodyWound(18);
	battlePushLog(`躯府三虫齐鸣，道衍杀招「万灵噬天」发动，造成 ${dmg} 点伤害！反噬令你损失 ${backlash} 气血。`, "danger");
	if (b.ehp <= 0) {
		if (b.source === "tower") finishTowerWin();
		else {
			const tpl = ENEMY_TEMPLATES.find((t) => t.id === b.tplId);
			if (tpl) finishBattleWin(tpl);
		}
		return;
	}
	if (!enemyStrikeBack()) save();
}

/** 胜利结算：基础修为 + 首通双倍 + 灵石 + 35% 掉丹 + 15% 掉法宝 + 首通固定掉落功法 */
function finishBattleWin(tpl: EnemyTemplate) {
	const b = battle;
	if (!b) return;
	const idx = ENEMY_TEMPLATES.findIndex((t) => t.id === tpl.id);
	const enemy = getEnemy(tpl);
	const base = Math.round(enemy.power * tpl.rewardFactor);
	const first = !player.defeated[tpl.id];
	let total = base;
	if (first) {
		player.defeated[tpl.id] = true;
		total += base; // 首通大奖：奖励翻倍
	}
	player.xp += total;
	player.battlesWon += 1;
	player.cooldowns[tpl.id] = BATTLE_COOLDOWN;
	// v9 斗法胜者 +3 业力；v10 胜战涤荡心魔 -2；v10.1 斩妖除魔涨声望、增羁绊
	addKarma(3);
	addDemon(-2);
	player.reputation += 1;
	if (bestCompanion && (player.favor[bestCompanion.id] ?? 0) < 100) player.favor[bestCompanion.id] += 1;

	// 灵石赏金：70×(对手序号+1)，首通翻倍（v11 上调）
	const stoneGain = 70 * (idx + 1) * (first ? 2 : 1);
	player.stones += stoneGain;
	b.stoneGain = stoneGain;

	// 35% 概率额外掉一颗当前境界可炼的丹药（受难度掉落加成）
	const pool = availablePills();
	if (Math.random() < Math.min(0.8, 0.35 + difficultyCfg.dropBonus) && pool.length > 0) {
		const pill = pool[Math.floor(Math.random() * pool.length)];
		player.pills[pill.id] += 1;
		b.pillName = pill.name;
	}

	// 15% 概率掉法宝（受难度掉落加成）；对手序号 ≥4 时掉落品质升一档
	if (Math.random() < Math.min(0.6, 0.15 + difficultyCfg.dropBonus)) {
		const item = rollEquipDrop(0, idx >= 4);
		b.equipName = item.name;
		gainEquip(item);
	}

	// 首通掉落固定秘籍（grantManual 内部会写日志并自动装备空槽）
	const manualId = FIRST_CLEAR_MANUAL[tpl.id];
	if (first && manualId) {
		const m = MANUALS.find((x) => x.id === manualId);
		grantManual(manualId);
		b.manualName = m ? m.name : null;
	}

	b.status = "win";
	b.reward = total;
	b.firstClear = first;
	battlePushLog(
		`「${tpl.name}」被你斩于台下！获得 ${total} 修为、${stoneGain} 灵石${first ? "（首通双倍）" : ""}。`,
		"success",
	);
	addLog(
		`斗法台 · 你 ${b.rounds} 合击败「${tpl.name}」（战力 ${enemy.power}），获 ${total} 修为、${stoneGain} 灵石` +
			`${b.pillName ? `与一颗${b.pillName}` : ""}${b.equipName ? `，拾得法宝「${b.equipName}」` : ""}${first ? "，并解锁下一名对手" : ""}！`,
		"success",
	);
	save();
}

/** 败北结算：扣 5% 修为、气血见底；血量归零走 v9 濒死判定（残魂玉可复活，否则入轮回） */
function finishBattleLose() {
	const b = battle;
	if (!b) return;
	const loss = Math.floor(player.xp * 0.05);
	player.xp = Math.max(0, player.xp - loss);
	player.battlesLost += 1;
	b.status = "lose";
	b.reward = loss;
	battlePushLog(`你灵力枯竭倒在台上，损失 ${loss} 修为，气血见底。`, "danger");
	// v11 绝地轮回：败北代价惨重——折寿十载、心魔深种，两成五概率当场身殒
	if (difficultyCfg.id === "hard") {
		addLifespan(-10);
		addDemon(12);
		if (showRebirthModal) {
			save();
			return; // 折寿后寿元耗尽，addLifespan 内已触发轮回
		}
		battlePushLog("绝地轮回·你被打落高台，气息萎靡，折寿十载，心魔更噬三分！", "danger");
		addLog(`绝地轮回 · 败于「${b.enemyName}」之手，折寿 10 年、心魔 +12。`, "danger");
		if (Math.random() < difficultyCfg.deathRisk) {
			save();
			player.hp = 0;
			checkNearDeath("battle");
			return;
		}
	} else {
		// v10 败北滋生心魔 +8
		addDemon(8);
		addLog(`斗法台 · 你不敌「${b.enemyName}」（战力 ${b.epower}），力竭败退，损失 ${loss} 修为。`, "danger");
	}
	// v11 道侣共赴危难：乱世败北一成五、绝地败北两成五概率道侣重伤身死（优先殒落好感最低者；温和难度道侣无恙）
	if (player.companions.length > 0 && difficultyCfg.id !== "easy") {
		const bondRisk = difficultyCfg.id === "hard" ? 0.25 : 0.15;
		if (Math.random() < bondRisk) {
			const sorted = [...player.companions].sort((a, b) => (player.favor[a] ?? 0) - (player.favor[b] ?? 0));
			const dead = sorted[0];
			const dc = COMPANIONS.find((x) => x.id === dead);
			player.companions = player.companions.filter((id) => id !== dead);
			delete player.favor[dead];
			if (dc) {
				battlePushLog(`${dc.name}为护你硬撼致命一击，就此香消玉殒……`, "danger");
				addLog(`道侣殒落 · 「${dc.name}」为护你身死道消，此恨绵绵无尽期。`, "danger");
				addDemon(15);
			}
		}
	}
	save();
	// 血量归零 → 濒死判定（替死符/残魂玉复活或血溅当场入轮回；入轮回会关闭战斗弹窗）
	checkNearDeath("battle");
}

function closeBattle() {
	battle = null;
}

// ==================== 无尽试炼塔 ====================

/** 试炼塔解锁条件：斗法台六名对手全部首通 */
const towerUnlocked = $derived(ENEMY_TEMPLATES.every((t) => player.defeated[t.id]));

/** 生成第 floor 层守将：以斗法台最强者为基底，属性 ×(1 + 0.18×(层数-1)) */
function towerEnemyStats(floor: number): EnemyStats {
	const tpl = ENEMY_TEMPLATES[ENEMY_TEMPLATES.length - 1];
	const base = getEnemy(tpl);
	const mult = 1 + 0.18 * (floor - 1);
	const hp = Math.round(base.hp * mult);
	const eatk = Math.round(base.atk * mult);
	const edef = Math.round(base.def * mult);
	return { tpl, level: base.level, hp, atk: eatk, def: edef, power: Math.round(hp * 0.5 + eatk * 4 + edef * 3) };
}

/** 挑战第 N 层：复用交互式回合战斗弹窗，敌人来源标记为 tower */
function startTowerBattle() {
	if (battle || !towerUnlocked) return;
	if ((player.cooldowns["tower"] ?? 0) > 0) return;
	if (player.hp < maxHp * MIN_HP_RATIO) {
		addLog("你气血不足三成，不宜登塔，先打坐疗伤或服回春丹吧。", "warning");
		return;
	}
	const n = player.towerFloor + 1;
	const e = towerEnemyStats(n);
	// v9 每场试炼消耗 2 年寿元
	addLifespan(-2);
	if (showRebirthModal) return; // 寿元耗尽直接入轮回，不再入塔
	battle = {
		tplId: "tower",
		source: "tower",
		towerN: n,
		enemyName: `试炼守将 · 第 ${n} 层`,
		enemyTitle: "无尽试炼",
		ehp: e.hp,
		ehpMax: e.hp,
		eatk: e.atk,
		edef: e.def,
		epower: e.power,
		rounds: 1,
		logs: [],
		status: "fighting",
		reward: 0,
		firstClear: false,
		manualName: null,
		pillName: null,
		stoneGain: 0,
		equipName: null,
		stunned: false,
		killUsed: false,
	};
	battlePushLog(`你踏入试炼塔第 ${n} 层，守将现身（战力 ${e.power}）！`, "warning");
}

/** 试炼胜利：层数+1、灵石 60+20×N、小额修为；每 5 层保底掉法宝（至少灵品）；冷却独立 5 息 */
function finishTowerWin() {
	const b = battle;
	if (!b) return;
	const n = b.towerN;
	player.towerFloor = Math.max(player.towerFloor, n);
	player.battlesWon += 1;
	player.cooldowns["tower"] = TOWER_COOLDOWN;
	// v9 试炼胜者 +2 业力；v10 胜战涤荡心魔 -2；v10.1 声望与羁绊
	addKarma(2);
	addDemon(-2);
	player.reputation += 1;
	if (bestCompanion && (player.favor[bestCompanion.id] ?? 0) < 100) player.favor[bestCompanion.id] += 1;
	const stoneGain = 60 + 20 * n;
	player.stones += stoneGain;
	const xpGain = Math.round(b.epower * 0.4);
	player.xp += xpGain;
	b.stoneGain = stoneGain;
	b.reward = xpGain;
	if (n % 5 === 0) {
		const item = rollEquipDrop(1, false); // 保底灵品
		b.equipName = item.name;
		gainEquip(item);
	}
	// v10 每层 18% 概率（含难度加成）收服灵虫
	let wormName: string | null = null;
	if (Math.random() < Math.min(0.5, 0.18 + difficultyCfg.dropBonus)) {
		const w = rollWormDrop(n >= 15 ? 2 : n >= 8 ? 1 : 0);
		if (w) {
			gainWorm(w);
			wormName = w.name;
		}
	}
	b.status = "win";
	battlePushLog(`试炼守将·第 ${n} 层被击破！获 ${xpGain} 修为、${stoneGain} 灵石${wormName ? `，灵虫「${wormName}」入府` : ""}。`, "success");
	addLog(
		`试炼塔 · 你 ${b.rounds} 合攻破第 ${n} 层，获 ${xpGain} 修为、${stoneGain} 灵石${b.equipName ? `，拾得法宝「${b.equipName}」` : ""}${wormName ? `，收服灵虫「${wormName}」` : ""}！`,
		"success",
	);
	save();
}

/** 试炼失败：无死亡惩罚，保留 1 点气血被传送出塔，可随时重试 */
function finishTowerLose() {
	const b = battle;
	if (!b) return;
	player.battlesLost += 1;
	player.hp = Math.max(1, player.hp); // 试炼塔守护机制：不致死亡
	b.status = "lose";
	b.reward = 0;
	battlePushLog("你不敌试炼守将，被传送出塔。试炼并无折损，疗伤后可再战。", "danger");
	addLog(`试炼塔 · 你止步第 ${b.towerN} 层，所幸并无折损。`, "warning");
	save();
}

// ==================== 存档导出 / 导入 ====================

/** 存档码：JSON → UTF-8 安全的 base64，复制保存即可跨设备迁移 */
const exportCode = $derived(btoa(unescape(encodeURIComponent(JSON.stringify(player)))));

function openSaveModal(mode: "export" | "import") {
	saveModalMode = mode;
	importCode = "";
	copyHint = "";
}

function closeSaveModal() {
	saveModalMode = null;
}

async function copyExportCode() {
	try {
		await navigator.clipboard.writeText(exportCode);
		copyHint = "已复制到剪贴板，妥善保存即可";
	} catch {
		// 剪贴板权限被拒时，让用户在文本框内手动全选复制
		const ta = document.getElementById("xx-export-code") as HTMLTextAreaElement | null;
		ta?.select();
		copyHint = "浏览器拒绝了自动复制，请手动 Ctrl+C";
	}
}

function doImport() {
	let data: Partial<PlayerState>;
	try {
		data = migrateSchema(JSON.parse(decodeURIComponent(escape(atob(importCode.trim())))));
	} catch {
		alert("存档码无效或已损坏，无法解析。");
		return;
	}
	if (!data || typeof data !== "object" || typeof data.xp !== "number" || typeof data.realmIndex !== "number") {
		alert("存档内容缺少必要字段，不是有效的修仙存档。");
		return;
	}
	if (!confirm("导入将覆盖当前所有进度，确定继续？")) return;
	player = {
		...makeFreshPlayer(),
		...data,
		pills: { ...EMPTY_PILLS, ...(data.pills ?? {}) },
		julingLeft: typeof data.julingLeft === "number" ? data.julingLeft : 0,
		cooldowns: data.cooldowns ?? {},
		manuals: Array.isArray(data.manuals) && data.manuals.length > 0 ? data.manuals : ["tuna"],
		equipped: { core: "tuna", body: null, attack: null, ...(data.equipped ?? {}) },
		defeated: data.defeated ?? {},
		// 旧存档码补发新系统默认值（缺 lastSeen 时记为现在，避免误触发离线结算）
		stones: typeof data.stones === "number" ? data.stones : 100,
		equip: { weapon: null, armor: null, artifact: null, ...(data.equip ?? {}) },
		bag: Array.isArray(data.bag) ? data.bag : [],
		towerFloor: typeof data.towerFloor === "number" ? data.towerFloor : 0,
		lastSeen: typeof data.lastSeen === "number" ? data.lastSeen : Date.now(),
		log: Array.isArray(data.log) ? data.log : [],
		// v9 旧档兜底：寿元默认当前境界上限
		lifespan: typeof data.lifespan === "number" ? data.lifespan : REALMS[data.realmIndex ?? 0]?.lifespan ?? 100,
		karma: typeof data.karma === "number" ? data.karma : 0,
		karmaDebt: typeof data.karmaDebt === "number" ? data.karmaDebt : 0,
		souljadeUsed: typeof data.souljadeUsed === "number" ? data.souljadeUsed : 0,
		// v10 旧档兜底
		difficulty: data.difficulty === "gentle" || data.difficulty === "hard" ? data.difficulty : "normal",
		demon: typeof data.demon === "number" ? data.demon : 0,
		toxin: typeof data.toxin === "number" ? data.toxin : 0,
		talismans: { ...EMPTY_TALISMANS, ...(data.talismans ?? {}) },
		worms: Array.isArray(data.worms) ? data.worms : [],
		wormEquip: Array.isArray(data.wormEquip) && data.wormEquip.length === 3 ? data.wormEquip : [null, null, null],
		wormHunger: typeof data.wormHunger === "number" ? data.wormHunger : 0,
		landLevel: typeof data.landLevel === "number" ? data.landLevel : 0,
		// v10.1 旧档兜底
		schemaV: SAVE_SCHEMA,
		reputation: typeof data.reputation === "number" ? data.reputation : 0,
		companions: Array.isArray(data.companions) ? data.companions : [],
		favor: data.favor ?? {},
		bodyWound: typeof data.bodyWound === "number" ? data.bodyWound : 0,
		scout: Boolean(data.scout),
		fateCheat: Boolean(data.fateCheat),
	};
	// 气血兜底：炼体功法/淬体丹变化后可能超上限
	player.hp = Math.max(0, Math.min(player.hp ?? maxHp, maxHp));
	save();
	addLog("存档导入成功，道途接续。", "success");
	saveModalMode = null;
	// 导入成功后同样执行一次离线闭关结算
	settleOffline();
}

// ==================== 突破与雷劫 ====================

// v11 定神小游戏：冲关前可点「定神」至多三次，指针越近中心加成越高（总上限 12%）
let focusGameActive = $state(false);
let focusPtr = $state(50); // 指针位置 0~100，中心 50 为满分点
let focusDir = 1; // 摆动方向（非响应式）
let focusHits = $state(0); // 已定神次数
let focusBonus = $state(0); // 累计加成百分比（0~12）
let focusTimer: ReturnType<typeof setInterval> | null = null;

/** 指针摆动循环：速度随定神次数递增，越点越难 */
function startFocusLoop() {
	stopFocusLoop();
	focusTimer = setInterval(() => {
		const step = 8 + focusHits * 4;
		let next = focusPtr + focusDir * step;
		if (next >= 100) {
			next = 100;
			focusDir = -1;
		} else if (next <= 0) {
			next = 0;
			focusDir = 1;
		}
		focusPtr = next;
	}, 40);
}
function stopFocusLoop() {
	if (focusTimer !== null) {
		clearInterval(focusTimer);
		focusTimer = null;
	}
}

/** 点「定神」：按指针离中心距离折算 0~4% 加成 */
function focusHit() {
	if (!focusGameActive || focusHits >= 3) return;
	const dist = Math.abs(focusPtr - 50);
	const gain = Math.round((4 - (dist / 50) * 4) * 10) / 10;
	focusBonus = Math.min(12, Math.round((focusBonus + gain) * 10) / 10);
	focusHits += 1;
	if (focusHits >= 3) stopFocusLoop();
}

/** 凝神冲关：结算定神加成后掷出突破结果 */
function startBreakthroughRoll() {
	if (!focusGameActive) return;
	focusGameActive = false;
	stopFocusLoop();
	lastSuccessRate = Math.min(0.95, lastSuccessRate + focusBonus / 100);
	const usedPojing = player.pojingActive;
	player.pojingActive = false;
	const rate = lastSuccessRate;

	setTimeout(() => {
		if (Math.random() < rate) {
			const oldMax = lifespanMax;
			player.realmIndex += 1;
			player.lastBreakthrough = new Date().toLocaleString("zh-CN");
			xpCapWarned = false; // v11 突破后重置封顶提示
			// 境界提升后气血回满，以示庆贺且避免新境界残血
			player.hp = maxHp;
			// v9 突破增寿：补回新旧寿元上限差值的一半
			player.lifespan = Math.min(lifespanMax, player.lifespan + Math.round((lifespanMax - oldMax) * 0.5));
			// v9 渡劫成功洗涤业力（-30%）、消解部分因果债（-15）
			player.karma = Math.round(player.karma * 0.7);
			player.karmaDebt = Math.max(0, player.karmaDebt - 15);
			breakthroughResult = "success";
			addLog(
				`恭喜！你成功突破至 ${REALMS[player.realmIndex].name}！寿元得天地反哺，业力随雷劫洗去三分。${usedPojing ? "（破境丹之效）" : ""}${focusBonus > 0 ? `（定神凝息 +${focusBonus}%）` : ""}`,
				"success",
			);
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

function doBreakthroughCheck(rate: number) {
	player.pojingActive = false; // 破境丹之效并入冲关时的判定，此处仅作标记清理
	showBreakthroughModal = true;
	breakthroughResult = "idle";
	lastSuccessRate = rate;
	// v11 进入定神小游戏阶段：玩家至多点三次「定神」，再点「凝神冲关」揭晓结果
	focusGameActive = true;
	focusHits = 0;
	focusBonus = 0;
	focusPtr = 50;
	focusDir = Math.random() < 0.5 ? 1 : -1;
	startFocusLoop();
}

function attemptBreakthrough() {
	if (!canBreakthrough || !nextRealm) return;
	lastSuccessRate = successRate;

	if (nextRealm.thunderTrial) {
		// v10.1 真仙秘术「小段命运篡改」：无雷直过，命线仅此一遭
		if (player.fateCheat) {
			player.fateCheat = false;
			addLog("你此前篡改的命线在此刻生效——天劫雷云凭空散去，这一关无雷直过！", "success");
			doBreakthroughCheck(1);
			return;
		}
		// v10 突破前根据业力/因果债/心魔/寿元动态判定劫型
		trialKind = resolveTrialKind();
		thunderRound = 1;
		thunderResults = ["pending", "pending", "pending"];
		thunderPenalty = 0;
		showThunderModal = true;
		addLog(`天劫将至！突破「${nextRealm.name}」需硬渡三道天雷——此劫为「${trialKind.name}」。`, "warning");
		return;
	}
	doBreakthroughCheck(successRate);
}

function tankThunder() {
	if (thunderStriking || thunderRound < 1 || thunderRound > 3) return;
	thunderStriking = true;
	// v10 因果劫：硬抗成功率额外 -10%；v10.1 道侣好感 90 并肩渡劫 +10%
	const passRate = (trialKind.id === "causal" ? lastSuccessRate - 0.1 : lastSuccessRate) + partnerBonus.thunder;
	const pass = Math.random() < passRate;
	setTimeout(() => {
		thunderResults[thunderRound - 1] = pass ? "pass" : "fail";
		if (pass) {
			player.thunderPassed += 1;
			addLog(`第 ${thunderRound} 道天雷被你硬生生扛下！`, "success");
		} else {
			const loss = Math.floor(player.xp * 0.08 * (currentPhysique?.thunderLossMult ?? 1));
			player.xp = Math.max(0, player.xp - loss);
			// v10 岁月劫：雷伤气血翻倍
			damageHp(maxHp * (trialKind.id === "years" ? 0.2 : 0.1));
			thunderPenalty += 0.12;
			// v10 业火劫：额外折寿 20 载；心魔劫：心魔 +8；凡败雷心魔 +5
			if (trialKind.id === "karmaFire") addLifespan(-20);
			addDemon(trialKind.id === "heart" ? 8 : 5);
			addLog(`第 ${thunderRound} 道天雷将你劈得皮开肉绽，损失 ${loss} 修为${trialKind.id === "years" ? "、两成气血（岁月劫）" : "、一成气血"}！`, "danger");
		}
		thunderStriking = false;
		thunderRound += 1;
		save();
		if (thunderRound > 3) {
			const failCount = thunderResults.filter((r) => r === "fail").length;
			setTimeout(() => {
				showThunderModal = false;
				// v9 三道天雷全败 → 天劫陨落（濒死判定，替死符/残魂玉可救命）
				if (failCount >= 3) {
					// v10 温和修道：突破失败只重伤不身死
					if (difficultyCfg.gentleDeath) {
						const loss = Math.floor(player.xp * 0.15);
						player.xp = Math.max(0, player.xp - loss);
						player.hp = Math.max(1, Math.round(maxHp * 0.1));
						addLog("温和修道天道庇佑，三道天雷虽尽皆劈中，你却保得一线生机，仅重伤跌关。", "warning");
						save();
						return;
					}
					player.hp = 0;
					checkNearDeath("thunder");
					return;
				}
				doBreakthroughCheck(Math.max(0.15, lastSuccessRate - thunderPenalty));
			}, 900);
		}
	}, 1000);
}

/** v10 祭出破劫符：与破境丹同理，硬挡一道天雷 */
function useTalismanForThunder() {
	if (thunderStriking || player.talismans.anti <= 0) return;
	player.talismans.anti -= 1;
	thunderStriking = true;
	setTimeout(() => {
		thunderResults[thunderRound - 1] = "pass";
		player.thunderPassed += 1;
		addLog(`你祭出破劫符，符光化盾，第 ${thunderRound} 道天雷被卸至九霄云外！`, "success");
		thunderStriking = false;
		thunderRound += 1;
		save();
		if (thunderRound > 3) {
			setTimeout(() => {
				showThunderModal = false;
				// v11 修复：符挡天雷不再凭空罚 25% 突破率
				doBreakthroughCheck(Math.max(0.15, lastSuccessRate - thunderPenalty));
			}, 900);
		}
	}, 1000);
}

/** v11 服避劫丹：专为此劫炼制，硬挡一道天雷且不影响突破之势 */
function useBijieForThunder() {
	if (thunderStriking || player.pills.bijie <= 0) return;
	player.pills.bijie -= 1;
	thunderStriking = true;
	setTimeout(() => {
		thunderResults[thunderRound - 1] = "pass";
		player.thunderPassed += 1;
		addLog(`避劫丹化作金光护体，第 ${thunderRound} 道天雷被消弭于无形！`, "success");
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
				// v11 修复：丹挡天雷不再凭空罚 25% 突破率，破境丹增益也予以保留
				doBreakthroughCheck(Math.max(0.15, lastSuccessRate - thunderPenalty));
			}, 900);
		}
	}, 1000);
}

function resetGame() {
	if (!confirm("确定要兵解转世，自行兵解入轮回吗？（本世修为、境界、丹药、功法、法宝全部清空，一切从零开始）")) return;
	// v11 兵解：走统一死亡结算流程（无跨世继承）
	die("bingjie");
}

function closeModal() {
	showBreakthroughModal = false;
	breakthroughResult = "idle";
	// v11 弹窗关闭时停掉定神小游戏指针，避免空转
	if (focusGameActive) {
		focusGameActive = false;
		stopFocusLoop();
	}
}
</script>

<div class="xiuxian-game">
	{#if needCreation}
		{#if chosenDifficulty === null}
			<!-- ========== 创角：难度选择（本周目锁定） ========== -->
			<div class="realm-card creation-card">
				<h2 class="creation-title">择世而入</h2>
				<p class="creation-desc">三界裂隙开启，三种命格等你抉择。难度锁定本周目，轮回后方可重选。</p>
				<div class="diff-grid">
					{#each DIFFICULTIES as d (d.id)}
						<button class="diff-item" style={`border-color: ${d.color}55`} onclick={() => pickDifficulty(d.id)}>
							<span class="diff-name" style={`color: ${d.color}`}>{d.name}</span>
							<span class="diff-desc">{d.desc}</span>
						</button>
					{/each}
				</div>
			</div>
		{:else}
		<!-- ========== 创角：三转盘 ========== -->
		<div class="realm-card creation-card">
			<h2 class="creation-title">天命三测</h2>
			<p class="creation-desc">命格「{difficultyCfg.name}」已锁定。资质、灵根、体质，三者定汝仙途。依次启动转盘，各测天命。</p>

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
		{/if}
	{:else}
		<!-- ========== 主界面 ========== -->
		<div class="realm-card">
			<div class="realm-header">
				<span class="realm-badge">第 {currentRealm.level} 重</span>
				<h2 class="realm-name">{currentRealm.name} · {subStage}</h2>
				<span class="talent-tag diff-tag" style={`border-color: ${difficultyCfg.color}66; color: ${difficultyCfg.color}`}>{difficultyCfg.name}</span>
				{#if player.ningshenLeft > 0}
					<span class="buff-badge buff-blue">凝神 ×2 · {player.ningshenLeft} 息</span>
				{/if}
				{#if player.julingLeft > 0}
					<span class="buff-badge buff-blue">聚灵 · 灵石×2 · {player.julingLeft} 息</span>
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
				{#if player.karma > 0}
					<span class="talent-tag karma-tag">业力 {player.karma}</span>
				{/if}
				{#if player.karmaDebt > 0}
					<span class="talent-tag debt-tag">因果债 {player.karmaDebt}</span>
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
					<span class="stone-text">灵石 {player.stones.toLocaleString()}</span>
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
				<!-- v9 寿元条：暮年 / 残烛变色 -->
				<div class="hp-block lifespan-block">
					<div class="stat-label">
						<span>寿元</span>
						<span class:lifespan-old={lifespanRatio < 0.3} class:lifespan-candle={lifespanRatio < 0.1}>
							{lifespanRatio < 0.1 ? "残烛 " : lifespanRatio < 0.3 ? "暮年 " : ""}{player.lifespan} / {lifespanMax}
						</span>
					</div>
					<div class="hp-bar">
						<div class="hp-fill lifespan-fill" class:old-fill={lifespanRatio < 0.3} class:candle-fill={lifespanRatio < 0.1} style="width: {Math.round(lifespanRatio * 100)}%"></div>
					</div>
				</div>
				<div class="stat-grid">
					<div class="stat-cell"><span class="stat-num">{atk}</span><span class="stat-key">攻击</span></div>
					<div class="stat-cell"><span class="stat-num">{def}</span><span class="stat-key">防御</span></div>
					<div class="stat-cell stat-power"><span class="stat-num">{battlePower.toLocaleString()}</span><span class="stat-key">战力</span></div>
				</div>
			</div>

			<!-- v10 六维战力雷达面板（方块刻度，实时刷新） -->
			<div class="radar-card">
				<div class="radar-grid">
					{#each sixDims as d (d.key)}
						<div class="radar-row">
							<span class="radar-key">{d.key}</span>
							<span class="radar-blocks">
								{#each Array(10) as _, i}
									<span class="radar-block" class:on={d.value >= (i + 1) * 100}></span>
								{/each}
							</span>
							<span class="radar-val">{d.value}</span>
						</div>
					{/each}
				</div>
				<div class="radar-status">
					<span title={gloss("心魔")} class:status-danger={player.demon >= 80} class:status-warn={player.demon >= 50 && player.demon < 80}>心魔 {player.demon}</span>
					<span title={gloss("丹毒")} class:status-warn={player.toxin >= 50}>丹毒 {player.toxin}</span>
					<span title={gloss("因果债")}>因果债 {player.karmaDebt}/200</span>
					<span title={gloss("声望")}>声望 {player.reputation}</span>
					<span title={gloss("躯府")}>躯府 {bodyStateText}{player.bodyWound > 0 ? ` ${player.bodyWound}` : ""}</span>
					<span title={gloss("灵虫")}>灵虫 {player.wormEquip.filter(Boolean).length}/3{player.wormHunger >= 70 ? " · 饥荒" : ""}</span>
					{#if player.fateCheat}<span title={gloss("命线已改")} class="kill-ready">命线已改 · 下次突破无雷</span>{/if}
					{#if player.demon >= 50}<span class="radar-debuff" title={gloss("心魔")}>心魔削突破 {Math.round(demonBreakPenalty * 100)}%</span>{/if}
					{#if player.toxin >= 50}<span class="radar-debuff" title={gloss("丹毒")}>丹毒削修炼 {Math.round((1 - toxinMult) * 100)}%</span>{/if}
				</div>
				<div class="radar-attrs">
					<span>攻 {atk}</span><span>防 {def}</span><span>速 {speed}</span>
					<span>暴击 {critRate}%</span><span>闪避 {dodgeRate}%</span><span>减伤 {damageReduce}%</span>
				</div>
				<!-- v11 名词志入口 -->
				<button class="btn gloss-btn" title="看不懂的名词点这里" onclick={() => (showGlossaryModal = true)}>名词志</button>
			</div>

			<!-- 法宝三槽速览 -->
			<div class="equip-strip">
				{#each EQUIP_SLOTS as es (es.slot)}
					{@const item = player.equip[es.slot]}
					<div class="equip-slot">
						<span class="equip-slot-label">{es.label}</span>
						{#if item}
							<span class="equip-slot-name" style={`color: ${EQUIP_RARITY_COLORS[item.rarity]}`}>{item.name}{item.enhance > 0 ? ` +${item.enhance}` : ""}</span>
							<span class="equip-slot-effect">{equipEffectText(item)}</span>
						{:else}
							<span class="equip-slot-empty">虚位以待</span>
						{/if}
					</div>
				{/each}
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
					{#if isMeditating && meditationPaused}
						<span class="status-paused">周天暂停中 · 雷劫/斗法结束后自动续上</span>
					{:else if isMeditating}
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
			<span class="stats-actions">
					<button class="reset-btn" onclick={() => openSaveModal("export")}>导出存档</button>
					<button class="reset-btn" onclick={() => openSaveModal("import")}>导入存档</button>
					<button class="reset-btn" onclick={resetGame}>兵解转世</button>
				</span>
		</div>
		</div>

		<!-- v10.2 游戏内菜单：主修炼卡常驻，其余系统分页切换，买丹斗法无需长滑 -->
	<div class="game-menu">
		{#each MENUS as m (m.id)}
			<button class="game-menu-btn" class:on={activeMenu === m.id} onclick={() => (activeMenu = m.id)}>{m.name}</button>
		{/each}
	</div>

	{#if activeMenu === "battle"}
	<!-- ========== 斗法台 ========== -->
		<div class="arena-card">
			<div class="pill-header">
				<h3 class="pill-title">斗法台</h3>
				<span class="pill-subtitle">我方战力 {battlePower.toLocaleString()} · 气血低于 30% 不可挑战 · 胜后冷却 {BATTLE_COOLDOWN} 息</span>
			</div>
			<div class="arena-list">
			{#each ENEMY_TEMPLATES as tpl, i (tpl.id)}
				{@const enemy = getEnemy(tpl)}
				{@const cd = player.cooldowns[tpl.id] ?? 0}
				{@const weaker = enemy.power < battlePower}
				{@const unlocked = isEnemyUnlocked(i)}
				{@const cleared = Boolean(player.defeated[tpl.id])}
				<div class="arena-item" class:locked={!unlocked}>
					<div class="arena-info">
						<div class="arena-name">
							{unlocked ? tpl.name : "？？？"}
							{#if unlocked}<span class="arena-title">{tpl.title}</span>{/if}
							{#if unlocked}
								<span class="arena-tag" class:tag-danger={!weaker} class:tag-safe={weaker}>
									{weaker ? "势弱" : "势强"}
								</span>
								{#if cleared}<span class="arena-tag tag-cleared">已降</span>{/if}
								{#if !cleared}<span class="arena-tag tag-first">首通双倍</span>{/if}
							{/if}
						</div>
						<div class="arena-stats">
							{#if unlocked}
								战力 {enemy.power.toLocaleString()} · 胜赏约 {Math.round(enemy.power * tpl.rewardFactor).toLocaleString()} 修为（首通翻倍）
								{#if cd > 0}<span class="arena-cd"> · 冷却 {cd} 息</span>{/if}
							{:else}
								<span class="arena-locked-text">🔒 先首胜「{ENEMY_TEMPLATES[i - 1]?.name}」方可挑战</span>
							{/if}
						</div>
					</div>
					<button
						class="btn arena-btn"
						disabled={!unlocked || cd > 0 || player.hp < maxHp * MIN_HP_RATIO}
						onclick={() => startBattle(tpl, i)}
					>
						{!unlocked ? "未解锁" : cd > 0 ? "休整中" : "挑战"}
					</button>
				</div>
			{/each}
		</div>

		<!-- 无尽试炼塔入口 -->
		<div class="tower-entry">
			{#if !towerUnlocked}
				<div class="tower-locked">
					<h4 class="tower-title">无尽试炼塔</h4>
					<span class="tower-desc">通关斗法台后开启</span>
				</div>
			{:else}
				{@const nextFloor = player.towerFloor + 1}
				{@const towerCd = player.cooldowns["tower"] ?? 0}
				<div class="tower-open">
					<div class="tower-info">
						<h4 class="tower-title">无尽试炼塔 · 已通关 {player.towerFloor} 层</h4>
						<span class="tower-desc">
							下一层「试炼守将·第 {nextFloor} 层」· 胜利得 {Math.round(towerEnemyStats(nextFloor).power * 0.4)} 修为 + {40 + 15 * nextFloor} 灵石{nextFloor % 5 === 0 ? " · 保底法宝" : ""}
							{#if towerCd > 0} · 冷却 {towerCd} 息{/if}
						</span>
					</div>
					<button
						class="btn arena-btn"
						disabled={towerCd > 0 || player.hp < maxHp * MIN_HP_RATIO}
						onclick={startTowerBattle}
					>
						{towerCd > 0 ? "休整中" : `挑战第 ${nextFloor} 层`}
					</button>
				</div>
			{/if}
		</div>
	</div>

	<!-- ========== 装备管理 ========== -->
		<div class="equip-card">
			<div class="pill-header">
				<h3 class="pill-title">法宝装备</h3>
				<span class="pill-subtitle">三槽加身 · 行囊 {player.bag.length}/{BAG_CAP} · 点击强化可提升 +10% 属性</span>
			</div>
			<div class="equip-body">
				<div class="equip-slots">
					{#each EQUIP_SLOTS as es (es.slot)}
						{@const item = player.equip[es.slot]}
						<div class="equip-detail-slot">
							<div class="equip-detail-label">{es.label}</div>
							{#if item}
								<div class="equip-detail-info">
									<span class="equip-detail-name" style={`color: ${EQUIP_RARITY_COLORS[item.rarity]}`}>{item.name}{item.enhance > 0 ? ` +${item.enhance}` : ""}</span>
									<span class="equip-detail-effect">{equipEffectText(item)}</span>
								</div>
								<div class="equip-detail-actions">
									<button class="btn equip-mini" onclick={() => openEnhance(item)}>强化</button>
									<button class="btn btn-ghost equip-mini" onclick={() => unwearEquip(es.slot)}>卸下</button>
									<button class="btn btn-ghost equip-mini" onclick={() => sellEquippedEquip(es.slot)}>卖出</button>
								</div>
							{:else}
								<div class="equip-detail-empty">未装备</div>
							{/if}
						</div>
					{/each}
				</div>
				<div class="bag-list">
					<h4 class="bag-title">行囊</h4>
					{#each player.bag as item (item.id)}
						<div class="bag-item">
							<div class="bag-item-info">
								<span class="bag-name" style={`color: ${EQUIP_RARITY_COLORS[item.rarity]}`}>{item.name}{item.enhance > 0 ? ` +${item.enhance}` : ""}</span>
								<span class="bag-meta">{EQUIP_SLOTS.find((s) => s.slot === item.slot)?.label} · {equipEffectText(item)}</span>
							</div>
							<div class="bag-actions">
								<button class="btn equip-mini" onclick={() => openEnhance(item)}>强化</button>
								<button class="btn equip-mini" onclick={() => wearEquip(item)}>装备</button>
								<button class="btn btn-ghost equip-mini" onclick={() => sellEquipFromBag(item)}>卖出</button>
							</div>
						</div>
					{:else}
						<p class="bag-empty">行囊空空如也。斗法、遗府或试炼塔有机会获得法宝。</p>
					{/each}
				</div>
			</div>
		</div>

		<!-- ========== 功法典籍 ========== -->
		<div class="manual-card">
		<div class="pill-header">
			<h3 class="pill-title">功法典籍</h3>
			<span class="pill-subtitle">三槽各修一本 · 被动即时生效 · 斗法首通有秘籍掉落</span>
		</div>
		{#each MANUAL_SLOTS as { slot, label } (slot)}
			<div class="manual-slot">
				<div class="manual-slot-label">{label}</div>
				<div class="manual-items">
					{#each MANUALS.filter((m) => m.slot === slot) as m (m.id)}
						{@const owned = player.manuals.includes(m.id)}
						{@const on = player.equipped[slot] === m.id}
						<button
							class="manual-chip"
							class:owned
							class:on
							disabled={!owned}
							title={owned ? m.desc : m.hint}
							onclick={() => equipManual(m.id)}
							style={on ? `border-color: ${m.color}; color: ${m.color}; box-shadow: 0 0 0 1px ${m.color}55 inset;` : ""}
						>
							<span class="manual-chip-name">{owned ? m.name : "？？？"}</span>
							<span class="manual-chip-rarity" style={owned ? `color: ${m.color}` : ""}>{m.rarity}</span>
							<span class="manual-chip-desc">{owned ? m.desc : m.hint}</span>
						</button>
					{/each}
				</div>
			</div>
		{/each}
	</div>

		<!-- ========== v10 符咒 ========== -->
		<div class="pill-card">
			<div class="pill-header">
				<h3 class="pill-title">符咒 · 符箓阁</h3>
				<span class="pill-subtitle">灵石请符 · 战斗/渡劫时催动，替死符为被动保命法器</span>
			</div>
			<div class="pill-list">
				{#each TALISMANS as t (t.id)}
					{@const locked = player.realmIndex < t.minRealm}
					{@const afford = player.stones >= t.price}
					<div class="pill-item" class:pill-locked={locked}>
						<span class="pill-orb" style={`background: radial-gradient(circle at 35% 30%, ${t.color}, ${t.color}88)`}></span>
						<div class="pill-info">
							<div class="pill-name">{t.name} <span class="pill-count">×{player.talismans[t.id]}</span></div>
							<div class="pill-desc">{locked ? `需达「${REALMS[t.minRealm].name}」方可请符` : t.desc}</div>
						</div>
						<div class="pill-actions">
							{#if t.id === "clear"}
								<button class="btn pill-use" disabled={player.talismans.clear <= 0} onclick={() => useTalismanOutOfBattle(t)}>焚符</button>
							{/if}
							<button class="btn pill-buy" disabled={locked || !afford} onclick={() => buyTalisman(t)}>请符 {t.price}</button>
						</div>
					</div>
				{/each}
			</div>
		</div>

		{:else if activeMenu === "worm"}
		<!-- ========== v10 躯府 · 灵虫 ========== -->
		<div class="pill-card">
			<div class="pill-header">
				<h3 class="pill-title">躯府 · 灵虫</h3>
				<span class="pill-subtitle">三槽灵虫联动可悟道衍杀招 · 饥饿 ≥70 加持减半</span>
			</div>
			<div class="worm-slots">
				{#each WORM_SLOT_LABELS as label, slot (label)}
					{@const w = equippedWorms[slot]}
					<div class="worm-slot">
						<span class="worm-slot-label">{label}</span>
						{#if w}
							<span class="worm-name" style={`color: ${w.color}`}>{w.name} · {w.rarity}</span>
							<span class="worm-desc">{w.desc}</span>
							<button class="reset-btn" onclick={() => unequipWorm(slot)}>移出躯府</button>
						{:else}
							<span class="equip-slot-empty">空</span>
						{/if}
					</div>
				{/each}
			</div>
			<div class="worm-bar-row">
				<div class="worm-hunger">
					<div class="hp-bar"><div class="hp-fill worm-hunger-fill" style="width: {player.wormHunger}%"></div></div>
					<span class="worm-hunger-text">饥饿 {player.wormHunger}/100</span>
				</div>
				<button class="btn pill-use" disabled={player.stones < FEED_COST || player.wormHunger <= 0} onclick={feedWorm}>
					喂养（{FEED_COST} 灵石 · -{FEED_AMOUNT}）
				</button>
				{#if killMoveReady}
					<span class="kill-ready">道衍杀招已悟（斗法中每场可催动一次）</span>
				{:else}
					<span class="kill-locked">三槽配齐灵虫可悟道衍杀招</span>
				{/if}
			</div>
			<div class="worm-bag">
				<span class="bag-title">虫库（{player.worms.length}/{WORM_POOL.length}）：试炼塔、秘境可获</span>
				<div class="worm-bag-list">
					{#each player.worms as id (id)}
						{@const w = WORM_POOL.find((x) => x.id === id)}
						{#if w}
							{@const inSlot = player.wormEquip.includes(w.id)}
							<div class="worm-chip-row">
								<button class="manual-chip worm-chip" class:on={inSlot} title={w.desc} onclick={() => !inSlot && equipWorm(player.wormEquip.findIndex((x) => x === null), w.id)}>
									<span class="manual-chip-name" style={`color: ${w.color}`}>{w.name}</span>
									<span class="manual-chip-rarity" style={`color: ${w.color}`}>{w.rarity}</span>
								</button>
								<button class="btn btn-ghost worm-sell" title={`放生可得 ${wormSellValue(w.id)} 灵石`} onclick={() => releaseWorm(w.id)}>放生</button>
							</div>
						{/if}
					{:else}
						<span class="bag-empty">尚未收服任何灵虫，去无尽试炼塔或秘境中寻找机缘吧。</span>
					{/each}
				</div>
			</div>
		</div>

	<!-- ========== v10 福地 · 秘境 ========== -->
		<div class="pill-card">
			<div class="pill-header">
				<h3 class="pill-title">福地 · 秘境</h3>
				<span class="pill-subtitle">灵脉地产持续产出；秘境探索高风险高回报</span>
			</div>
			<div class="land-secret-body">
				<div class="land-box">
					<span class="bag-title">灵脉福地 · {player.landLevel}/5 级</span>
					<p class="worm-desc">
						每级打坐每 60 息 +8 灵石（离线同享）；3 级起灵泉滋养，每 120 息 +1 寿元。
					</p>
					{#if landUpgradeCost() !== null}
						{@const landCost = landUpgradeCost()}
						<button class="btn pill-buy" disabled={player.stones < landCost} onclick={upgradeLand}>
							扩建福地（{landCost} 灵石）
						</button>
					{:else}
						<span class="kill-ready">福地已达 5 级，灵脉圆满</span>
					{/if}
				</div>
				<div class="land-box">
					<span class="bag-title">秘境探索 · {SECRET_PLACES[Math.min(SECRET_PLACES.length - 1, Math.floor(player.realmIndex / 2))]}</span>
					<p class="worm-desc">
						六古域分层：天南古域、乱星海、虚天古殿、慕兰古战场、坠魔深渊、灵界。耗 5 年寿元，机缘与伏击并存。
						{#if (player.cooldowns["secret"] ?? 0) > 0}<strong>冷却 {player.cooldowns["secret"]} 息</strong>{/if}
					</p>
					<div class="secret-btns">
						<button class="btn breakthrough-btn" disabled={(player.cooldowns["secret"] ?? 0) > 0 || player.hp < maxHp * MIN_HP_RATIO} onclick={exploreSecret}>
							入秘境探索
						</button>
						<button class="btn pill-use" disabled={player.scout || (player.cooldowns["secret"] ?? 0) > 0 || player.stones < SCOUT_COST} onclick={scoutSecret}>
							{player.scout ? "神识已锁定机缘" : `神识探查（${SCOUT_COST} 灵石）`}
						</button>
					</div>
				</div>
			</div>
		</div>

		{:else if activeMenu === "fate"}
	<!-- ========== v10.1 道侣 · 仙缘 ========== -->
		<div class="pill-card">
			<div class="pill-header">
				<h3 class="pill-title">道侣 · 仙缘</h3>
				<span class="pill-subtitle">好感 30 资源共享 · 60 协同作战 · 90 并肩渡劫；斗法胜利可增羁绊</span>
			</div>
			<div class="companion-body">
				{#each COMPANIONS as c (c.id)}
					{#if player.companions.includes(c.id)}
						{@const f = player.favor[c.id] ?? 0}
						<div class="companion-item">
							<div class="companion-info">
								<span class="companion-name" style={`color: ${c.color}`}>{c.name}（{c.gender}） · {c.trait}</span>
								<span class="worm-desc">{c.desc}</span>
								<div class="favor-bar"><div class="favor-fill" style={`width: ${f}%; background: ${c.color}`}></div></div>
							</div>
							<div class="companion-side">
								<span class="favor-num">{f}/100{f >= 90 ? " · 并肩渡劫" : f >= 60 ? " · 协同作战" : f >= 30 ? " · 资源共享" : ""}</span>
								<button class="btn pill-buy" disabled={player.stones < GIFT_COST || f >= 100} onclick={() => giftCompanion(c.id)}>
									赠礼 {GIFT_COST}
								</button>
							</div>
						</div>
					{/if}
				{:else}
					<p class="worm-desc">尚无仙缘。道侣可赠礼结缘，亦可能因你久不往来而疏离。</p>
				{/each}
				<button
					class="btn meditate-btn meet-btn"
					disabled={player.companions.length >= COMPANIONS.length || player.stones < MEET_COST || (player.cooldowns["meet"] ?? 0) > 0}
					onclick={meetCompanion}
				>
						{player.companions.length >= COMPANIONS.length
							? "六道仙缘皆已结下"
							: `云游结识道侣（${MEET_COST} 灵石${(player.cooldowns["meet"] ?? 0) > 0 ? ` · ${player.cooldowns["meet"]}息` : ""}）`}
					</button>
					{#if showMeetModal}
						<!-- v11 结识性别选择 -->
						<div class="meet-choice-row">
							<span class="worm-desc">此番云游，欲与何人结缘？</span>
							<button
								class="btn pill-buy"
								disabled={player.stones < MEET_COST || !COMPANIONS.some((c) => c.gender === "男" && !player.companions.includes(c.id))}
								onclick={() => confirmMeetCompanion("男")}
							>结识男修</button>
							<button
								class="btn pill-buy"
								disabled={player.stones < MEET_COST || !COMPANIONS.some((c) => c.gender === "女" && !player.companions.includes(c.id))}
								onclick={() => confirmMeetCompanion("女")}
							>结识女修</button>
							<button class="btn black-btn" onclick={() => (showMeetModal = false)}>作罢</button>
						</div>
					{/if}
				</div>
			</div>

		<!-- ========== v10.1 地下黑市 ========== -->
		<div class="pill-card">
			<div class="pill-header">
				<h3 class="pill-title">地下黑市</h3>
				<span class="pill-subtitle">高收益必留因果印记：涨业力、积因果债、损善恶声望，正道坊市无此风险</span>
			</div>
			<div class="black-list">
				{#each BLACK_DEALS as deal, i (deal.id)}
					{@const cd = player.cooldowns[deal.id] ?? 0}
					<div class="black-item">
						<div class="pill-info">
							<div class="pill-name">{deal.name}</div>
							<div class="pill-desc">{deal.desc}{cd > 0 ? `（冷却 ${cd} 息）` : ""}</div>
						</div>
						<button class="btn black-btn" disabled={cd > 0 || player.stones < deal.price} onclick={() => blackDeal(i)}>
							{deal.price} 灵石
						</button>
					</div>
				{/each}
			</div>
		</div>

		<!-- ========== v10.1 因果秘术 ========== -->
		<div class="pill-card">
			<div class="pill-header">
				<h3 class="pill-title">因果秘术</h3>
				<span class="pill-subtitle">洞虚境初窥因果，真仙可篡改小段命运；逆术皆有沉重代价</span>
			</div>
			<div class="black-list">
				{#each ARCANE_ARTS as art (art.id)}
					{@const locked = player.realmIndex < art.realm}
					{@const cd = player.cooldowns[`art_${art.id}`] ?? 0}
					<div class="black-item" class:pill-locked={locked}>
						<div class="pill-info">
							<div class="pill-name">{art.name} <span class="manual-chip-rarity">需 {REALMS[art.realm].name}</span></div>
							<div class="pill-desc">{locked ? `修为达「${REALMS[art.realm].name}」后可悟` : art.desc}{!locked && cd > 0 ? `（冷却 ${cd} 息）` : ""}</div>
						</div>
						<button class="btn black-btn art-btn" disabled={locked || cd > 0} onclick={() => castArcaneArt(art.id)}>催动</button>
					</div>
				{/each}
			</div>
		</div>

		{:else if activeMenu === "pill"}
	<!-- ========== 炼丹坊 ========== -->
		<div class="pill-card">
			<div class="pill-header">
				<h3 class="pill-title">丹药 · 炼丹坊</h3>
				<span class="pill-subtitle">丹分四类可筛选 · 炼制有失败率，失败损失药材</span>
			</div>
			<div class="pill-filter-row">
				{#each PILL_FILTERS as f (f)}
					<button class="pill-filter" class:active={craftFilter === f} onclick={() => (craftFilter = f)}>{f}</button>
				{/each}
			</div>
			<div class="pill-list">
					{#each (craftFilter === "全部" ? CRAFT_PILLS : CRAFT_PILLS.filter((p) => p.category === craftFilter)) as pill (pill.id)}
					{@const locked = player.realmIndex < pill.minRealm}
					{@const craftRate = Math.round(craftSuccessRate(pill.minRealm) * 100)}
					<div class="pill-item" class:pill-locked={locked}>
						<span class="pill-orb" style={`background: radial-gradient(circle at 35% 30%, ${pill.color}, ${pill.color}88)`}></span>
						<div class="pill-info">
							<div class="pill-name">
								{pill.name}
								<span class="manual-chip-rarity" style={`color: ${GRADE_COLORS[pill.grade]}`}>{pill.grade}</span>
								<span class="pill-count">×{player.pills[pill.id]}</span>
							</div>
							<div class="pill-desc">
								{#if locked}
									需达「{REALMS[pill.minRealm].name}」方可炼制
								{:else}
									{pill.desc} · 炼丹成功率 {craftRate}%
									{#if pill.id === "quti"} · 已淬体 {player.qutiUsed} 次（+{player.qutiUsed * 30 * currentRealm.level} 上限）{/if}
									{#if pill.id === "zengyuan"} · 已增元 {player.zengyuanUsed} 次（+{player.zengyuanUsed * 2 * currentRealm.level} 攻击）{/if}
								{/if}
							</div>
						</div>
						<div class="pill-actions">
							<button class="btn pill-use" disabled={player.pills[pill.id] <= 0} onclick={() => usePill(pill)}>服用</button>
							<button class="btn pill-buy" disabled={locked || player.xp < pillCost(pill)} onclick={() => buyPill(pill)}>
								炼制 {pillCost(pill)}
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- ========== 坊市商店 ========== -->
		<div class="pill-card">
			<div class="pill-header">
				<h3 class="pill-title">坊市</h3>
				<span class="pill-subtitle">灵石交易 · 丹药奇物皆有所售 · 当前灵石 {player.stones.toLocaleString()}</span>
			</div>
			<div class="pill-filter-row">
				{#each PILL_FILTERS as f (f)}
					<button class="pill-filter" class:active={shopFilter === f} onclick={() => (shopFilter = f)}>{f}</button>
				{/each}
			</div>
			<div class="pill-list">
				{#each (shopFilter === "全部" ? SHOP_PILLS : SHOP_PILLS.filter((p) => p.category === shopFilter)) as pill (pill.id)}
					{@const price = shopPrice(pill)}
					{@const afford = player.stones >= price}
					<div class="pill-item" class:pill-locked={!afford}>
						<span class="pill-orb" style={`background: radial-gradient(circle at 35% 30%, ${pill.color}, ${pill.color}88)`}></span>
						<div class="pill-info">
							<div class="pill-name">
								{pill.name}
								<span class="manual-chip-rarity" style={`color: ${GRADE_COLORS[pill.grade]}`}>{pill.grade}</span>
								<span class="pill-count">×{player.pills[pill.id]}</span>
							</div>
							<div class="pill-desc">{pill.desc}{player.realmIndex < pill.minRealm ? ` · 需「${REALMS[pill.minRealm].name}」` : ""}</div>
						</div>
						<div class="pill-actions">
							<button class="btn pill-buy" disabled={!afford} onclick={() => buyShopPill(pill)}>
								购买 {price} 灵石
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>

		{:else if activeMenu === "log"}
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
{/if}

	<!-- ========== 雷劫弹窗 ========== -->
	{#if showThunderModal}
		<div class="modal-overlay" use:portal>
			<div class="modal-content thunder-modal" onclick={(e) => e.stopPropagation()}>
				<h3 class="thunder-title">{trialKind.name} · {nextRealm?.name}</h3>
				<p class="thunder-sub">{trialKind.desc}</p>
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
					<button class="btn pill-use" disabled={thunderStriking || player.pills.bijie <= 0} onclick={useBijieForThunder}>
						服下避劫丹（余 {player.pills.bijie}）
					</button>
					<button class="btn anti-btn" disabled={thunderStriking || player.talismans.anti <= 0} onclick={useTalismanForThunder}>
						祭出破劫符（余 {player.talismans.anti}）
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
					{#if focusGameActive}
						<!-- v11 定神小游戏：指针越近中心，冲关之势越盛 -->
						<div class="focus-game">
							<h3 class="focus-title">凝神定息</h3>
							<p class="desc">冲关之前，先凝神定息。指针掠过中线时点下「定神」，越接近中心加成越高——每息至多 +4%，三息为限。</p>
							<div class="focus-bar">
								<div class="focus-zone"></div>
								<div class="focus-needle" style={`left: ${focusPtr}%`}></div>
							</div>
							<p class="focus-status">定神 {focusHits}/3 · 定息加成 +{focusBonus}% · 冲关成功率 {(Math.min(0.95, lastSuccessRate + focusBonus / 100) * 100).toFixed(0)}%</p>
							<div class="focus-actions">
								<button class="btn meditate-btn" disabled={focusHits >= 3} onclick={focusHit}>定神</button>
								<button class="btn" onclick={startBreakthroughRoll}>凝神冲关</button>
							</div>
						</div>
					{:else}
						<div class="breakthrough-loading">
							<div class="spinner"></div>
							<p>正在冲击关隘...（成功率 {(lastSuccessRate * 100).toFixed(0)}%）</p>
						</div>
					{/if}
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

	<!-- ========== v11 名词志弹窗 ========== -->
	{#if showGlossaryModal}
		<div class="modal-overlay" use:portal onclick={() => (showGlossaryModal = false)}>
			<div class="modal-content glossary-modal" onclick={(e) => e.stopPropagation()}>
				<h3>名词志</h3>
				<p class="desc">修行界黑话速查——状态条上的名词悬停亦可查看单条释义。</p>
				<div class="glossary-list">
					{#each GLOSSARY as g (g.term)}
						<div class="glossary-item">
							<span class="glossary-term">{g.term}</span>
							<span class="glossary-desc">{g.desc}</span>
						</div>
					{/each}
				</div>
				<button class="btn" onclick={() => (showGlossaryModal = false)}>合上</button>
			</div>
		</div>
	{/if}

	<!-- ========== 交互式斗法弹窗 ========== -->
	{#if battle}
		{@const myPct = Math.max(0, Math.round((player.hp / maxHp) * 100))}
		{@const enemyPct = Math.max(0, Math.round((battle.ehp / battle.ehpMax) * 100))}
		<div
			class="modal-overlay"
			use:portal
			onclick={() => {
				if (battle.status !== "fighting") closeBattle();
			}}
		>
			<div class="modal-content battle-modal" onclick={(e) => e.stopPropagation()}>
				<h3 class="battle-title">斗法台 · 第 {battle.rounds} 合</h3>

				<!-- 敌方 -->
				<div class="battle-side enemy-side">
					<div class="stat-label">
						<span>「{battle.enemyName}」 · {battle.enemyTitle}</span>
						<span>战力 {battle.epower.toLocaleString()}</span>
					</div>
					<div class="hp-bar">
						<div class="hp-fill enemy-fill" style="width: {enemyPct}%"></div>
					</div>
					<div class="battle-hp-text">{Math.round(battle.ehp)} / {battle.ehpMax}（{enemyPct}%）</div>
				</div>

				<!-- 我方 -->
				<div class="battle-side">
					<div class="stat-label">
						<span>你 · {currentRealm.name}修士</span>
						<span>战力 {battlePower.toLocaleString()}</span>
					</div>
					<div class="hp-bar">
						<div class="hp-fill" class:hp-low-fill={myPct < 30} style="width: {myPct}%"></div>
					</div>
					<div class="battle-hp-text">{Math.round(player.hp)} / {maxHp}（{myPct}%）</div>
				</div>

				<!-- 回合播报 -->
				<div class="battle-log">
					{#each battle.logs as entry (entry.time + entry.message)}
						<div class={`battle-log-line log-${entry.type}`}>[{entry.time}] {entry.message}</div>
					{/each}
				</div>

				{#if battle.status === "fighting"}
					<div class="battle-actions">
						<button class="btn battle-btn-attack" onclick={battleAttack}>出手攻击</button>
						<button class="btn battle-btn-pill" disabled={player.pills.huichun <= 0} onclick={battleUsePill}>
							回春丹 ×{player.pills.huichun}
						</button>
						<button class="btn battle-btn-retreat" title={gloss("遁走")} onclick={battleRetreat}>遁走</button>
					</div>
					<!-- v10 符咒与道衍杀招 -->
					<div class="battle-actions battle-talisman-row">
						<button class="btn battle-btn-talisman" disabled={player.talismans.strike <= 0} onclick={battleTalismanStrike}>
							五雷符 ×{player.talismans.strike}
						</button>
						<button class="btn battle-btn-talisman" disabled={player.talismans.seal <= 0 || battle.stunned} onclick={battleTalismanSeal}>
							镇妖符 ×{player.talismans.seal}{battle.stunned ? "（已封）" : ""}
						</button>
						<button
							class="btn battle-btn-kill"
							disabled={!killMoveReady || battle.killUsed}
							onclick={battleKillMove}
							title="三只灵虫齐鸣，造成 3.5 倍攻击伤害；反噬一成气血、+5 心魔"
						>
							道衍杀招
						</button>
					</div>
					<p class="battle-tip">攻击或服丹后敌方立即反击；五雷符三倍攻伤、镇妖符封敌一合，均占用一回合。</p>
				{:else if battle.status === "win"}
					<div class="battle-result result-win">
						<div class="icon">胜</div>
						<p>
							{battle.source === "tower"
								? `攻破第 ${battle.towerN} 层！获得 ${battle.reward.toLocaleString()} 修为、${battle.stoneGain.toLocaleString()} 灵石`
								: `${battle.firstClear ? "首通大捷！" : "斗法获胜！"} 获得 ${battle.reward.toLocaleString()} 修为、${battle.stoneGain.toLocaleString()} 灵石${battle.pillName ? `，另缴获一颗${battle.pillName}` : ""}${battle.manualName ? `，夺得失传秘籍《${battle.manualName}》` : ""}`}
							{battle.equipName ? `，拾得法宝「${battle.equipName}」` : ""}
						</p>
						<button class="btn" onclick={closeBattle}>收下战果</button>
					</div>
				{:else if battle.status === "lose"}
					<div class="battle-result result-lose">
						<div class="icon">败</div>
						<p>
							{battle.source === "tower"
								? "试炼失败，并无折损，气血见底。疗伤后可随时再试。"
								: `力竭败退，损失 ${battle.reward.toLocaleString()} 修为，气血见底。回打坐或回春丹疗伤后再战。`}
						</p>
						<button class="btn" onclick={closeBattle}>黯然下台</button>
					</div>
				{:else}
					<div class="battle-result result-retreat">
						<div class="icon">退</div>
						<p>你主动抽身而退，无功无过，气血保持当前。</p>
						<button class="btn" onclick={closeBattle}>返回</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- ========== 法宝强化弹窗 ========== -->
	{#if enhanceId && enhanceItem}
		{@const item = enhanceItem}
		<div class="modal-overlay" use:portal onclick={closeEnhance}>
			<div class="modal-content enhance-modal" onclick={(e) => e.stopPropagation()}>
				<h3>法宝强化 · {item.name}</h3>
				<p class="enhance-desc">
					当前强化 +{item.enhance} · {equipEffectText(item)}
					{#if item.enhance < 9}
						<br />升至 +{item.enhance + 1} 需 <strong>{enhanceCostOf(item)}</strong> 灵石
						<br />成功率 <strong>{(enhanceRateOf(item) * 100).toFixed(0)}%</strong>
					{:else}
						<br />已达最高强化 +9
					{/if}
				</p>
				{#if enhanceMsg}
					<p class="enhance-msg">{enhanceMsg}</p>
				{/if}
				<div class="enhance-actions">
					{#if item.enhance < 9}
						<button class="btn" disabled={player.stones < enhanceCostOf(item)} onclick={doEnhance}>
							消耗 {enhanceCostOf(item)} 灵石 强化
						</button>
					{/if}
					<button class="btn btn-ghost" onclick={closeEnhance}>关闭</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- ========== 闭关归来弹窗 ========== -->
	{#if offlineReport}
		<div class="modal-overlay" use:portal onclick={() => (offlineReport = null)}>
			<div class="modal-content offline-modal" onclick={(e) => e.stopPropagation()}>
				<h3 class="offline-title">闭关归来</h3>
				<p class="offline-desc">
					离线时长：<strong>{offlineReport.duration}</strong>
				</p>
				<div class="offline-rewards">
					<div class="offline-reward">
						<span class="offline-key">获得修为</span>
						<span class="offline-val">+{offlineReport.xp.toLocaleString()}</span>
					</div>
					<div class="offline-reward">
						<span class="offline-key">获得灵石</span>
						<span class="offline-val">+{offlineReport.stones.toLocaleString()}</span>
					</div>
				</div>
				<p class="offline-tip">闭关期间气血已回满，可继续修炼。</p>
				<button class="btn" onclick={() => (offlineReport = null)}>继续修炼</button>
			</div>
		</div>
	{/if}

	<!-- ========== 秘境探索结果弹窗 ========== -->
	{#if secretReport}
		<div class="modal-overlay" use:portal onclick={() => (secretReport = null)}>
			<div class="modal-content offline-modal" onclick={(e) => e.stopPropagation()}>
				<h3 class="offline-title">秘境探索</h3>
				<p class="offline-desc secret-text">{secretReport}</p>
				<button class="btn" onclick={() => (secretReport = null)}>退出秘境</button>
			</div>
		</div>
	{/if}

	<!-- ========== 存档导出 / 导入弹窗 ========== -->
	{#if saveModalMode}
		<div class="modal-overlay" use:portal onclick={closeSaveModal}>
			<div class="modal-content save-modal" onclick={(e) => e.stopPropagation()}>
				{#if saveModalMode === "export"}
					<h3>导出存档</h3>
					<p class="save-desc">复制下面这串存档码，发给自己或存到记事本：换浏览器/换设备/清缓存后，凭它原样恢复全部进度。</p>
					<textarea id="xx-export-code" class="save-code" readonly value={exportCode} rows="6"></textarea>
					<div class="save-actions">
						<button class="btn" onclick={copyExportCode}>复制存档码</button>
						<button class="btn btn-ghost" onclick={closeSaveModal}>关闭</button>
					</div>
					{#if copyHint}<p class="save-hint">{copyHint}</p>{/if}
				{:else}
					<h3>导入存档</h3>
					<p class="save-desc">把之前导出的存档码完整粘贴到下方，导入会覆盖当前进度（建议先导出当前存档备份）。</p>
					<textarea class="save-code" bind:value={importCode} rows="6" placeholder="在此粘贴存档码..."></textarea>
					<div class="save-actions">
							<button class="btn" disabled={importCode.trim().length === 0} onclick={doImport}>确认导入</button>
							<button class="btn btn-ghost" onclick={closeSaveModal}>取消</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- ========== v11 死亡结算弹窗（本世修行总结，转世后一切归零） ========== -->
		{#if showRebirthModal && rebirthReport && deathCause}
			<div class="modal-overlay" use:portal>
				<div class="modal-content rebirth-modal" onclick={(e) => e.stopPropagation()}>
					<h3 class="rebirth-title">{DEATH_TEXTS[deathCause].title}</h3>
					<p class="rebirth-desc">{DEATH_TEXTS[deathCause].desc}</p>
					<div class="rebirth-stats">
						<div class="offline-reward">
							<span class="offline-key">止步境界</span>
							<span class="offline-val">{rebirthReport.realm}</span>
						</div>
						<div class="offline-reward">
							<span class="offline-key">累计修为</span>
							<span class="offline-val">{rebirthReport.xp.toLocaleString()}</span>
						</div>
						<div class="offline-reward">
							<span class="offline-key">斗法战绩</span>
							<span class="offline-val">{rebirthReport.wins} 胜</span>
						</div>
						<div class="offline-reward">
							<span class="offline-key">试炼塔层</span>
							<span class="offline-val">{rebirthReport.floors}</span>
						</div>
						<div class="offline-reward">
							<span class="offline-key">共度岁月</span>
							<span class="offline-val">{rebirthReport.breaths} 息</span>
						</div>
						<div class="offline-reward">
							<span class="offline-key">首通强敌</span>
							<span class="offline-val">{rebirthReport.clears} 名</span>
						</div>
					</div>
					<p class="rebirth-tip">红尘一梦，万般皆空。转世重修后，境界、修为、法宝、灵虫尽皆归零。</p>
					<button class="btn breakthrough-btn" onclick={reincarnate}>转世重修 · 从零开始</button>
				</div>
			</div>
		{/if}

		<!-- ========== v11 奇遇抉择弹窗（不同选择 → 不同收益与风险） ========== -->
		{#if showChoiceEvent}
			<div class="modal-overlay" use:portal>
				<div class="modal-content choice-modal" onclick={(e) => e.stopPropagation()}>
					<h3 class="choice-title" style={`color: ${showChoiceEvent.color}`}>{showChoiceEvent.title}</h3>
					<p class="desc">{choiceResultText ?? showChoiceEvent.desc}</p>
					<div class="choice-options">
						{#if choiceResultText}
							<button class="btn breakthrough-btn" onclick={closeChoiceEvent}>继续修行</button>
						{:else}
							{#each showChoiceEvent.options as opt, i (i)}
								<button class="btn choice-btn" disabled={opt.disabled} onclick={() => pickChoiceOption(i)}>
									<span class="choice-label">{opt.label}</span>
									{#if opt.hint}<span class="choice-hint">{opt.hint}</span>{/if}
								</button>
							{/each}
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>

<style>
.xiuxian-game { display: flex; flex-direction: column; gap: 1.1rem; }

.realm-card, .pill-card, .log-card, .arena-card {
	background: var(--card-bg, rgba(255, 255, 255, 0.03));
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.15));
	border-radius: 1rem;
	padding: 1.15rem 1.25rem;
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

.realm-desc { color: var(--content-meta, #9ca3af); margin: 0.5rem 0 1rem; font-size: 0.9rem; }

/* ===== 修为条 ===== */
.xp-bar { height: 0.75rem; background: rgba(128, 128, 128, 0.15); border-radius: 999px; overflow: hidden; }
.xp-fill {
	height: 100%; background: linear-gradient(90deg, var(--primary, #6366f1), #a78bfa);
	border-radius: 999px; transition: width 0.5s ease;
}
.xp-fill.glowing { animation: xpGlow 2s ease-in-out infinite; }
@keyframes xpGlow { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.35); } }
.xp-text { display: flex; gap: 0.35rem; font-size: 0.85rem; color: var(--content-meta, #9ca3af); margin-top: 0.4rem; }
.stone-text { margin-left: auto; color: #fbbf24; }

/* ===== 法宝装备 ===== */
.equip-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-top: 0.8rem; }
.equip-slot {
	padding: 0.5rem 0.6rem; border-radius: 0.6rem; background: rgba(128, 128, 128, 0.08);
	display: flex; flex-direction: column; gap: 0.15rem; text-align: center;
}
.equip-slot-label { font-size: 0.68rem; color: var(--content-meta, #9ca3af); }
.equip-slot-name { font-size: 0.82rem; font-weight: 700; }
.equip-slot-effect { font-size: 0.7rem; color: var(--content-meta, #9ca3af); }
.equip-slot-empty { font-size: 0.82rem; color: var(--content-meta, #9ca3af); }

.equip-card {
	background: var(--card-bg, rgba(255, 255, 255, 0.03));
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.15));
	border-radius: 1rem;
	padding: 1.15rem 1.25rem;
	display: flex; flex-direction: column; gap: 0.85rem;
}
.equip-body { display: flex; flex-direction: column; gap: 0.85rem; }
.equip-slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }
.equip-detail-slot {
	display: flex; flex-direction: column; gap: 0.35rem; align-items: center;
	padding: 0.6rem 0.4rem; border-radius: 0.75rem; background: rgba(128, 128, 128, 0.06);
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.12));
}
.equip-detail-label { font-size: 0.72rem; color: var(--content-meta, #9ca3af); }
.equip-detail-info { display: flex; flex-direction: column; align-items: center; gap: 0.1rem; }
.equip-detail-name { font-size: 0.88rem; font-weight: 700; }
.equip-detail-effect { font-size: 0.7rem; color: var(--content-meta, #9ca3af); }
.equip-detail-actions { display: flex; gap: 0.35rem; }
.equip-mini { padding: 0.25rem 0.55rem; font-size: 0.72rem; }
.equip-detail-empty { font-size: 0.8rem; color: var(--content-meta, #9ca3af); }

.bag-list { display: flex; flex-direction: column; gap: 0.4rem; }
.bag-title { font-size: 0.85rem; font-weight: 700; margin: 0; }
.bag-item {
	display: flex; align-items: center; gap: 0.7rem;
	padding: 0.5rem 0.7rem; border-radius: 0.6rem; background: rgba(128, 128, 128, 0.06);
}
.bag-item-info { flex: 1; min-width: 0; }
.bag-name { font-weight: 600; font-size: 0.88rem; display: block; }
.bag-meta { font-size: 0.72rem; color: var(--content-meta, #9ca3af); }
.bag-actions { display: flex; gap: 0.35rem; flex-shrink: 0; }
.bag-empty { font-size: 0.8rem; color: var(--content-meta, #9ca3af); margin: 0; }

/* ===== 试炼塔入口 ===== */
.tower-entry { margin-top: 0.9rem; }
.tower-locked, .tower-open {
	padding: 0.75rem; border-radius: 0.75rem; background: rgba(128, 128, 128, 0.06);
	display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
}
.tower-title { font-size: 0.95rem; font-weight: 700; margin: 0; }
.tower-desc { font-size: 0.78rem; color: var(--content-meta, #9ca3af); flex: 1; min-width: 0; }
.tower-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }

/* ===== 法宝强化 / 闭关归来弹窗补充 ===== */
.enhance-modal { max-width: 24rem; }
.enhance-desc { font-size: 0.88rem; line-height: 1.6; margin: 0.5rem 0 0.75rem; }
.enhance-msg { font-size: 0.85rem; color: #fbbf24; margin: 0 0 1rem; }
.enhance-actions { display: flex; gap: 0.6rem; justify-content: center; }
.offline-modal { max-width: 24rem; }
.offline-title { margin: 0 0 0.5rem; color: #fbbf24; }
.offline-desc { font-size: 0.9rem; margin: 0 0 1rem; color: #e2e8f0; }
.offline-desc strong { color: #fbbf24; }
.offline-rewards { display: flex; gap: 0.75rem; justify-content: center; margin-bottom: 1rem; }
.offline-reward {
	padding: 0.5rem 0.85rem; border-radius: 0.6rem; background: rgba(128, 128, 128, 0.08);
	display: flex; flex-direction: column; gap: 0.1rem; min-width: 6.5rem;
}
.offline-key { font-size: 0.72rem; color: #cbd5e1; }
.offline-val { font-size: 1.1rem; font-weight: 800; color: #4ade80; }
.offline-tip { font-size: 0.8rem; color: #cbd5e1; margin: 0 0 1rem; }

/* ===== 战力面板（宽屏气血条与攻防横向并排，压缩纵向高度）===== */
.power-panel {
	margin-top: 1rem;
	padding: 0.85rem 1rem;
	border-radius: 0.75rem;
	background: rgba(128, 128, 128, 0.06);
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.12));
	display: grid;
	grid-template-columns: 1fr;
	gap: 0.75rem;
}
@media (min-width: 640px) {
	.power-panel { grid-template-columns: 1.15fr 1.5fr; align-items: center; gap: 1.25rem; }
	.hp-block { margin-bottom: 0; }
}
.hp-block { margin-bottom: 0; }
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
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }
.stat-cell {
	display: flex; flex-direction: column; align-items: center; gap: 0.1rem;
	padding: 0.4rem; border-radius: 0.6rem; background: rgba(128, 128, 128, 0.08);
}
.stat-num { font-size: 1.2rem; font-weight: 800; color: var(--primary, #818cf8); }
.stat-power .stat-num { color: #fbbf24; }
.stat-key { font-size: 0.72rem; color: var(--content-meta, #9ca3af); }

/* ===== 打坐 ===== */
.meditation-panel {
	display: flex; align-items: center; gap: 1rem;
	margin-top: 1rem; padding: 0.8rem 1rem;
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
	font-size: 0.78rem; color: var(--content-meta, #9ca3af); margin-top: 0.75rem;
}
.reset-btn {
	font-size: 0.75rem; color: #f87171;
	background: none; border: none; cursor: pointer; opacity: 0.7;
}
.reset-btn:hover { opacity: 1; text-decoration: underline; }
/* 多个统计操作按钮挤在最右侧 */
.stats-actions { margin-left: auto; display: inline-flex; gap: 0.9rem; align-items: center; }
.stats-actions .reset-btn { margin-left: 0; }
.status-paused { color: #fbbf24; font-weight: 600; }

/* ===== 斗法台（宽屏两列排列，缩短纵向长度）===== */
.arena-list { display: grid; grid-template-columns: 1fr; gap: 0.6rem; }
@media (min-width: 640px) {
	.arena-list { grid-template-columns: 1fr 1fr; }
}
.arena-item {
	display: flex; align-items: center; gap: 0.7rem;
	padding: 0.6rem 0.75rem; border-radius: 0.75rem;
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
/* 未解锁的对手整体压暗 */
.arena-item.locked { opacity: 0.55; }
.arena-locked-text { color: #9ca3af; font-size: 0.74rem; }
.tag-cleared { background: rgba(148, 163, 184, 0.18); color: #cbd5e1; }
.tag-first { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }

/* ===== 功法典籍 ===== */
.manual-card {
	background: var(--card-bg, rgba(255, 255, 255, 0.03));
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.15));
	border-radius: 1rem;
	padding: 1.15rem 1.25rem;
	display: flex; flex-direction: column; gap: 0.85rem;
}
.manual-slot { display: flex; gap: 0.85rem; align-items: flex-start; }
.manual-slot-label {
	flex-shrink: 0; width: 4.2rem; padding-top: 0.4rem;
	font-size: 0.78rem; font-weight: 700; color: var(--content-meta, #9ca3af);
}
.manual-items { flex: 1; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.manual-chip {
	display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem;
	padding: 0.45rem 0.7rem; border-radius: 0.6rem;
	background: rgba(128, 128, 128, 0.06);
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.18));
	color: var(--content-meta, #9ca3af); cursor: pointer; text-align: left;
	min-width: 10.5rem; max-width: 13rem;
	transition: transform 0.15s, border-color 0.15s, background 0.15s;
}
button.manual-chip.owned { color: #e5e7eb; }
button.manual-chip.owned:hover { border-color: rgba(99, 102, 241, 0.6); transform: translateY(-1px); }
.manual-chip:disabled { cursor: not-allowed; opacity: 0.6; }
.manual-chip-name { font-size: 0.88rem; font-weight: 700; }
.manual-chip-rarity { font-size: 0.66rem; }
.manual-chip-desc { font-size: 0.68rem; opacity: 0.8; line-height: 1.35; }

/* ===== 交互式斗法弹窗 ===== */
.battle-modal { max-width: 30rem; text-align: left; }
.battle-title { margin: 0 0 0.9rem; font-size: 1.1rem; text-align: center; }
.battle-side { margin-bottom: 0.7rem; }
.battle-side.enemy-side .stat-label { color: #f87171; }
.battle-hp-text { font-size: 0.72rem; color: var(--content-meta, #9ca3af); margin-top: 0.2rem; text-align: right; }
.enemy-fill { background: linear-gradient(90deg, #b91c1c, #f87171); }
.battle-log {
	margin: 0.85rem 0; padding: 0.6rem 0.7rem; border-radius: 0.6rem;
	background: rgba(0, 0, 0, 0.25); border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.15));
	max-height: 8rem; overflow-y: auto;
	display: flex; flex-direction: column; gap: 0.25rem;
	font-size: 0.75rem; line-height: 1.45;
}
.battle-log-line { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
.log-success { color: #4ade80; }
.log-danger { color: #f87171; }
.log-warning { color: #fbbf24; }
.log-info { color: var(--content-meta, #9ca3af); }
.battle-actions { display: flex; gap: 0.6rem; }
.battle-actions .btn { flex: 1; padding: 0.6rem 0.5rem; }
.battle-btn-attack { background: linear-gradient(90deg, #dc2626, #ef4444); }
.battle-btn-pill { background: linear-gradient(90deg, #059669, #10b981); }
.battle-btn-retreat { background: #4b5563; }
.battle-tip { font-size: 0.7rem; color: var(--content-meta, #9ca3af); text-align: center; margin: 0.6rem 0 0; }
.battle-result { text-align: center; }
.battle-result .icon {
	width: 3.2rem; height: 3.2rem; margin: 0.2rem auto 0.8rem; border-radius: 50%;
	display: flex; align-items: center; justify-content: center;
	font-size: 1.3rem; font-weight: 800; color: #fff;
}
.result-win .icon { background: linear-gradient(135deg, #16a34a, #4ade80); }
.result-lose .icon { background: linear-gradient(135deg, #b91c1c, #f87171); }
.result-retreat .icon { background: #6b7280; }
.battle-result p { font-size: 0.88rem; line-height: 1.6; margin: 0 0 1rem; }

/* ===== 存档导出 / 导入 ===== */
.save-modal { max-width: 30rem; }
.save-desc { font-size: 0.82rem; color: var(--content-meta, #9ca3af); line-height: 1.6; margin: 0.5rem 0 0.8rem; }
.save-code {
	width: 100%; box-sizing: border-box; resize: vertical;
	padding: 0.6rem 0.7rem; border-radius: 0.6rem;
	background: rgba(0, 0, 0, 0.3);
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.25));
	color: #e5e7eb; font-size: 0.72rem; font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
	word-break: break-all;
}
.save-code:focus { outline: none; border-color: var(--primary, #6366f1); }
.save-actions { display: flex; gap: 0.6rem; margin-top: 0.8rem; }
.btn-ghost { background: transparent; border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.35)); color: var(--content-meta, #9ca3af); }
.save-hint { font-size: 0.75rem; color: #4ade80; margin: 0.6rem 0 0; }

/* ===== 丹药 ===== */
.pill-header { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
.pill-title { font-size: 1.1rem; font-weight: 700; margin: 0; }
.pill-subtitle { font-size: 0.78rem; color: var(--content-meta, #9ca3af); }
.pill-list { display: flex; flex-direction: column; gap: 0.55rem; .pill-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0.5rem; border-radius: 0.6rem; } background: rgba(128, 128, 128, 0.06);
}
.pill-filter-row { display: flex; gap: 0.4rem; margin-bottom: 0.6rem; flex-wrap: wrap; }
.pill-filter { font-size: 0.74rem; padding: 0.25rem 0.7rem; border-radius: 999px; border: 1px solid rgba(148, 163, 184, 0.35); background: transparent; color: #9aa7bd; cursor: pointer; }
.pill-filter.active { background: rgba(99, 102, 241, 0.25); border-color: #818cf8; color: #c7d2fe; }
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
.log-title { font-size: 1.1rem; font-weight: 700; margin: 0 0 0.6rem; }
.log-list { display: flex; flex-direction: column; gap: 0.3rem; max-height: 11rem; overflow-y: auto; }
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
	/* v11 提亮弹窗：改为实色亮灰蓝底并固定文字色，修复“太暗看不清字” */
	background: #2a3350;
	border: 1px solid rgba(148, 163, 184, 0.45);
	color: #e8edf7;
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
.modal-content .desc { font-size: 0.85rem; color: #bcc8de; margin-bottom: 1rem; }

/* ===== v11 定神小游戏 ===== */
.focus-game { text-align: center; }
.focus-title { margin: 0.25rem 0 0.4rem; font-size: 1.1rem; font-weight: 700; }
.focus-bar {
	position: relative; height: 1.1rem; border-radius: 0.4rem; margin: 0.9rem 0 0.6rem;
	background: linear-gradient(90deg, #7f1d1d 0%, #f59e0b 38%, #34d399 50%, #f59e0b 62%, #7f1d1d 100%);
	border: 1px solid rgba(148, 163, 184, 0.4); overflow: hidden;
}
.focus-needle {
	position: absolute; top: 0; bottom: 0; width: 3px; margin-left: -1.5px;
	background: #fff; box-shadow: 0 0 6px rgba(255, 255, 255, 0.9);
}
.focus-status { font-size: 0.8rem; color: #bcc8de; margin-bottom: 0.8rem; }
.focus-actions { display: flex; gap: 0.6rem; justify-content: center; }

/* ===== v11 名词志 ===== */
.gloss-btn { margin-top: 0.5rem; width: 100%; font-size: 0.75rem; padding: 0.3rem 0; }
.glossary-modal { text-align: left; }
.glossary-list { display: flex; flex-direction: column; gap: 0.45rem; margin: 0.6rem 0 1rem; }
.glossary-item { display: flex; flex-direction: column; gap: 0.1rem; padding-bottom: 0.45rem; border-bottom: 1px dashed rgba(148, 163, 184, 0.2); }
.glossary-term { font-weight: 700; color: #a5b4fc; font-size: 0.85rem; }
.glossary-desc { font-size: 0.78rem; color: #bcc8de; line-height: 1.5; }

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

/* ===== v9 寿元 / 业力 / 轮回 ===== */
.lifespan-block { margin-top: 0.6rem; }
.lifespan-old { color: #fbbf24; }
.lifespan-candle { color: #f87171; font-weight: 700; }
.lifespan-fill { background: linear-gradient(90deg, #38bdf8, #818cf8); }
.lifespan-fill.old-fill { background: linear-gradient(90deg, #d97706, #fbbf24); }
.lifespan-fill.candle-fill { background: linear-gradient(90deg, #b91c1c, #ef4444); animation: candleBlink 1.2s ease-in-out infinite; }
@keyframes candleBlink { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.7); } }

.karma-tag { border-color: rgba(248, 113, 113, 0.45); color: #f87171; }
.debt-tag { border-color: rgba(192, 132, 252, 0.45); color: #c084fc; }
.rebirth-tag { border-color: rgba(240, 171, 252, 0.45); color: #f0abfc; }

.rebirth-modal, .rebirth-shop-modal { max-width: 26rem; text-align: center; }
.rebirth-title { margin: 0 0 0.5rem; font-size: 1.35rem; color: #f0abfc; }
.rebirth-desc { font-size: 0.9rem; color: #e2e8f0; margin: 0 0 1rem; line-height: 1.6; }
.rebirth-desc strong { color: #f0abfc; }
.rebirth-stats { display: flex; gap: 0.75rem; justify-content: center; margin-bottom: 1rem; }
.rebirth-tip { font-size: 0.78rem; color: #cbd5e1; margin: 0 0 1rem; }
/* ===== v11 奇遇抉择 ===== */
.choice-modal { max-width: 30rem; text-align: left; }
.choice-title { font-size: 1.2rem; font-weight: 700; margin: 0 0 0.5rem; }
.choice-options { display: flex; flex-direction: column; gap: 0.55rem; margin-top: 1rem; }
.choice-btn { display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem; width: 100%; text-align: left; padding: 0.6rem 0.9rem; }
.choice-label { font-size: 0.92rem; }
.choice-hint { font-size: 0.72rem; color: #9aa7bd; }

.talent-shop-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; text-align: left; }
.talent-shop-item {
	display: flex; align-items: center; gap: 0.7rem;
	padding: 0.55rem 0.7rem; border-radius: 0.6rem;
	background: rgba(128, 128, 128, 0.06);
	border: 1px solid transparent;
}
.talent-shop-item.afford { border-color: rgba(240, 171, 252, 0.3); }
.talent-shop-item.owned { opacity: 0.6; }
.talent-shop-item .pill-info { flex: 1; min-width: 0; }

/* ===== v10 难度选择 ===== */
.diff-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.8rem; margin-top: 1rem; }
.diff-item {
	display: flex; flex-direction: column; gap: 0.5rem; align-items: center;
	padding: 1rem 0.8rem; border-radius: 0.8rem;
	background: rgba(128, 128, 128, 0.06);
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.18));
	color: var(--content-meta, #cbd5e1); cursor: pointer; text-align: center;
	transition: transform 0.15s, border-color 0.15s, background 0.15s;
}
.diff-item:hover { transform: translateY(-2px); background: rgba(99, 102, 241, 0.1); }
.diff-name { font-size: 1.05rem; font-weight: 800; }
.diff-desc { font-size: 0.72rem; line-height: 1.5; }
.diff-tag { background: rgba(128, 128, 128, 0.08); white-space: nowrap; }
@media (max-width: 640px) { .diff-grid { grid-template-columns: 1fr; } }

/* ===== v10 六维战力面板 ===== */
.radar-card {
	margin-top: 0.85rem; padding: 0.85rem 1rem; border-radius: 0.8rem;
	background: rgba(128, 128, 128, 0.05);
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.15));
	display: flex; flex-direction: column; gap: 0.6rem;
}
.radar-grid { display: flex; flex-direction: column; gap: 0.35rem; }
.radar-row { display: flex; align-items: center; gap: 0.7rem; }
.radar-key { flex-shrink: 0; width: 4.6rem; font-size: 0.76rem; color: var(--content-meta, #9ca3af); }
.radar-blocks { display: flex; gap: 0.22rem; flex: 1; }
.radar-block {
	flex: 1; height: 0.7rem; border-radius: 2px;
	background: rgba(128, 128, 128, 0.14);
}
.radar-block.on { background: linear-gradient(90deg, #6366f1, #a78bfa); box-shadow: 0 0 6px rgba(139, 92, 246, 0.5); }
.radar-val { flex-shrink: 0; width: 2.4rem; text-align: right; font-size: 0.76rem; font-weight: 700; color: #c7d2fe; }
.radar-status { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; font-size: 0.72rem; color: var(--content-meta, #9ca3af); }
.status-warn { color: #fbbf24; }
.status-danger { color: #f87171; font-weight: 700; }
.radar-debuff { color: #fb7185; }

/* ===== v10 灵虫躯府 ===== */
.worm-slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.7rem; margin: 0.85rem 0; }
.worm-slot {
	display: flex; flex-direction: column; gap: 0.3rem; align-items: flex-start;
	padding: 0.7rem 0.8rem; border-radius: 0.7rem;
	background: rgba(128, 128, 128, 0.06);
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.18));
	min-height: 6.2rem;
}
.worm-slot-label { font-size: 0.72rem; color: var(--content-meta, #9ca3af); }
.worm-name { font-size: 0.88rem; font-weight: 700; }
.worm-desc { font-size: 0.7rem; line-height: 1.45; color: var(--content-meta, #9ca3af); }
.worm-bar-row { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; margin-bottom: 0.85rem; }
.worm-hunger { flex: 1; min-width: 9rem; display: flex; flex-direction: column; gap: 0.2rem; }
.worm-hunger-fill { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.worm-hunger-text { font-size: 0.7rem; color: var(--content-meta, #9ca3af); }
.kill-ready { font-size: 0.74rem; font-weight: 700; color: #a78bfa; }
.kill-locked { font-size: 0.72rem; color: var(--content-meta, #9ca3af); }
.worm-bag { display: flex; flex-direction: column; gap: 0.5rem; }
.bag-title { font-size: 0.78rem; font-weight: 700; color: #c7d2fe; }
.bag-empty { font-size: 0.74rem; color: var(--content-meta, #9ca3af); }
.worm-bag-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.worm-chip-row { display: flex; align-items: stretch; gap: 0.35rem; }
.worm-chip-row .worm-chip { flex: 1; }
.worm-sell { font-size: 0.72rem; padding: 0.25rem 0.55rem; flex-shrink: 0; }
button.worm-chip { flex-direction: row; gap: 0.45rem; align-items: center; min-width: 0; }
.worm-chip.on { border-color: rgba(167, 139, 250, 0.6); background: rgba(99, 102, 241, 0.12); }
@media (max-width: 640px) { .worm-slots { grid-template-columns: 1fr; } }

/* ===== v10 福地 · 秘境 ===== */
.land-secret-body { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-top: 0.85rem; }
.land-box {
	display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start;
	padding: 0.8rem 0.9rem; border-radius: 0.7rem;
	background: rgba(128, 128, 128, 0.06);
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.18));
}
.land-box .worm-desc { margin: 0; }
.secret-text { white-space: pre-line; line-height: 1.7; }
@media (max-width: 640px) { .land-secret-body { grid-template-columns: 1fr; } }

/* ===== v10 战斗符咒 / 破劫符 ===== */
.battle-talisman-row { margin-top: 0.55rem; }
.battle-btn-talisman { background: linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(139, 92, 246, 0.25)); }
.battle-btn-kill { background: linear-gradient(135deg, rgba(217, 70, 239, 0.3), rgba(244, 114, 182, 0.25)); font-weight: 800; }
.anti-btn {
	padding: 0.55rem 0.8rem; border-radius: 0.6rem; font-size: 0.82rem;
	background: linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(251, 191, 36, 0.2));
	color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.35); cursor: pointer;
}
.anti-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* ===== v10.1 附属属性 / 道侣 / 黑市 / 秘术 ===== */
.radar-attrs {
	display: flex; flex-wrap: wrap; gap: 0.35rem 1rem;
	font-size: 0.72rem; color: #c7d2fe;
	padding-top: 0.45rem; border-top: 1px solid var(--line-divider, rgba(128, 128, 128, 0.15));
}
.secret-btns { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.companion-body { display: flex; flex-direction: column; gap: 0.7rem; margin-top: 0.85rem; }
.companion-item {
	display: flex; align-items: center; gap: 0.8rem; justify-content: space-between;
	padding: 0.65rem 0.8rem; border-radius: 0.7rem;
	background: rgba(128, 128, 128, 0.06);
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.18));
}
.companion-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.companion-name { font-size: 0.88rem; font-weight: 700; }
.companion-side { display: flex; flex-direction: column; align-items: flex-end; gap: 0.3rem; flex-shrink: 0; }
.favor-num { font-size: 0.7rem; color: var(--content-meta, #9ca3af); white-space: nowrap; }
.favor-bar { height: 0.4rem; border-radius: 2px; background: rgba(128, 128, 128, 0.15); overflow: hidden; min-width: 12rem; }
.favor-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
.meet-btn { margin-top: 0.2rem; }
/* v11 结识性别选择行 */
.meet-choice-row {
	display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem;
	margin-top: 0.55rem; padding: 0.55rem 0.8rem; border-radius: 0.7rem;
	background: rgba(128, 128, 128, 0.1); border: 1px solid rgba(148, 163, 184, 0.25);
}
.black-list { display: flex; flex-direction: column; gap: 0.55rem; margin-top: 0.85rem; }
.black-item {
	display: flex; align-items: center; gap: 0.7rem;
	padding: 0.6rem 0.8rem; border-radius: 0.7rem;
	background: rgba(128, 128, 128, 0.06);
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.18));
}
.black-item .pill-info { flex: 1; min-width: 0; }
.black-btn {
	flex-shrink: 0; padding: 0.5rem 0.8rem; border-radius: 0.6rem; font-size: 0.8rem;
	background: linear-gradient(135deg, rgba(217, 70, 239, 0.22), rgba(99, 102, 241, 0.22));
	color: #e9d5ff; border: 1px solid rgba(217, 70, 239, 0.3); cursor: pointer;
}
.black-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.art-btn { background: linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(99, 102, 241, 0.22)); color: #bae6fd; border-color: rgba(14, 165, 233, 0.3); }

/* ===== v10.2 游戏内功能菜单：分页切换系统，主修炼卡常驻 ===== */
.game-menu {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin: 10px 0 12px;
	padding: 5px;
	border-radius: 0.8rem;
	border: 1px solid var(--line-divider, rgba(128, 128, 128, 0.15));
	background: var(--card-bg, rgba(255, 255, 255, 0.03));
	position: sticky;
	top: 8px;
	z-index: 30;
	backdrop-filter: blur(8px);
}
.game-menu-btn {
	flex: 1 1 0;
	min-width: 84px;
	padding: 7px 10px;
	font-size: 0.85rem;
	font-weight: 600;
	border-radius: 0.55rem;
	border: 1px solid transparent;
	background: transparent;
	color: var(--content-meta, rgba(128, 128, 128, 0.9));
	cursor: pointer;
	transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.game-menu-btn:hover { color: var(--primary, #6366f1); border-color: var(--line-divider, rgba(128, 128, 128, 0.15)); }
.game-menu-btn.on {
	background: var(--primary, #6366f1);
	border-color: var(--primary, #6366f1);
	color: #fff;
}
</style>
