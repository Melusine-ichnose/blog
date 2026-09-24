<script lang="ts">
// 修仙修炼游戏核心组件 v2
// 持续打坐（开始/暂停）+ 突破概率 + 丹药体系
// 数据存储在 localStorage，纯前端实现

import { onDestroy } from "svelte";

// ==================== 类型定义 ====================

/** 境界定义 */
interface Realm {
	name: string;
	level: number;
	requiredXp: number;
	description: string;
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

/** 玩家状态 */
interface PlayerState {
	xp: number;
	realmIndex: number;
	lastBreakthrough: string | null;
	totalBreaths: number; // 累计打坐息数
	pills: Record<PillId, number>;
	ningshenLeft: number; // 凝神丹剩余加成息数
	pojingActive: boolean; // 破境丹 buff（下次突破生效）
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
	{ name: "炼气期", level: 1, requiredXp: 100, description: "初入修仙之门，吐纳天地灵气" },
	{ name: "筑基期", level: 2, requiredXp: 300, description: "筑基成功，寿元增至两百载" },
	{ name: "金丹期", level: 3, requiredXp: 800, description: "凝结金丹，可御剑飞行" },
	{ name: "元婴期", level: 4, requiredXp: 2000, description: "元婴出窍，神识覆盖千里" },
	{ name: "化神期", level: 5, requiredXp: 5000, description: "化神归一，可移山填海" },
	{ name: "合体期", level: 6, requiredXp: 12000, description: "天人合一，万法归宗" },
	{ name: "渡劫期", level: 7, requiredXp: 30000, description: "渡九九天劫，成就不灭之躯" },
	{ name: "大乘期", level: 8, requiredXp: 80000, description: "大乘圆满，可破碎虚空" },
	{ name: "飞升境", level: 9, requiredXp: Infinity, description: "飞升仙界，与天地同寿" },
];

/** 丹药体系 */
const PILLS: Pill[] = [
	{ id: "juqi", name: "聚气丹", color: "#34d399", desc: "服下立即获得 80 点修为", cost: 120 },
	{ id: "ningshen", name: "凝神丹", color: "#60a5fa", desc: "接下来 30 息修炼收益翻倍", cost: 400 },
	{ id: "pojing", name: "破境丹", color: "#c084fc", desc: "下次突破成功率 +25%", cost: 1000 },
	{ id: "tianyuan", name: "天元丹", color: "#fbbf24", desc: "服下立即获得 600 点修为", cost: 2000 },
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
];

/** 心魔事件：按当前修为比例损失 */
const DEMON_EVENTS = [
	{ text: "心魔入侵！你险些走火入魔", xpLoss: 0.08 },
	{ text: "心魔作祟！你心神不宁，灵力溃散", xpLoss: 0.12 },
	{ text: "心魔反噬！你强行压制，损耗不小", xpLoss: 0.05 },
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
	log: [],
});

let isMeditating = $state(false); // 是否持续打坐中
let lastGain = $state<number | null>(null); // 最近一息获得的修为
let breathGlow = $state(false); // 打坐呼吸动画开关
let showBreakthroughModal = $state(false);
let breakthroughResult = $state<"idle" | "success" | "fail">("idle");
let lastSuccessRate = $state(0); // 弹窗里展示的本次成功率

// ==================== 计算属性 ====================

const currentRealm = $derived(REALMS[player.realmIndex]);
const nextRealm = $derived(REALMS[player.realmIndex + 1] ?? null);
const progressPercent = $derived(
	nextRealm
		? Math.min(100, Math.round((player.xp / nextRealm.requiredXp) * 100))
		: 100,
);
const canBreakthrough = $derived(Boolean(nextRealm && player.xp >= nextRealm.requiredXp));

/** 突破成功率：目标境界越高越难，保底 30%；破境丹 +25% */
const successRate = $derived.by(() => {
	if (!nextRealm) return 0;
	const base = Math.max(0.3, 0.9 - nextRealm.level * 0.06);
	return Math.min(0.95, base + (player.pojingActive ? 0.25 : 0));
});

/** 每息基础修为：随境界增长 */
const breathXp = $derived(5 + currentRealm.level * 3);

// ==================== 持久化 ====================

const STORAGE_KEY = "xiuxian_save_v2";
const OLD_STORAGE_KEY = "xiuxian_save_v1";

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
	// 迁移 v1 旧档：只继承修为、境界、统计，丹药从零开始
	const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
	if (oldRaw) {
		try {
			const old = JSON.parse(oldRaw);
			player.xp = old.xp ?? 0;
			player.realmIndex = old.realmIndex ?? 0;
			player.lastBreakthrough = old.lastBreakthrough ?? null;
			player.totalBreaths = old.totalCultivations ?? 0;
			addLog("检测到旧存档，修为与境界已继承。", "warning");
			save();
		} catch {
			// 旧档损坏则忽略
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

/** 每息修炼 tick（持续打坐时每 2 秒触发一次） */
function breathTick() {
	// 基础收益 + 随机浮动
	let xpGain = breathXp + Math.floor(Math.random() * (breathXp * 0.6 + 1));

	// 凝神丹 buff：双倍收益
	const doubled = player.ningshenLeft > 0;
	if (doubled) {
		xpGain *= 2;
		player.ningshenLeft -= 1;
	}

	// 随机事件
	const roll = Math.random();
	if (roll < 0.06) {
		// 6% 机缘：修为倍率 + 40% 掉落丹药
		const event = FORTUNE_EVENTS[Math.floor(Math.random() * FORTUNE_EVENTS.length)];
		xpGain *= event.xpMultiplier;
		let dropText = "";
		if (Math.random() < 0.4) {
			const pill = PILLS[Math.floor(Math.random() * PILLS.length)];
			player.pills[pill.id] += 1;
			dropText = `并获得一颗「${pill.name}」！`;
			addLog(`${event.text} ${dropText}`, "success");
		} else {
			addLog(event.text, "success");
		}
	} else if (roll > 0.94) {
		// 6% 心魔：按当前修为比例损失
		const event = DEMON_EVENTS[Math.floor(Math.random() * DEMON_EVENTS.length)];
		const loss = Math.floor(player.xp * event.xpLoss);
		player.xp = Math.max(0, player.xp - loss);
		addLog(`${event.text}，损失 ${loss} 点修为。`, "danger");
	} else if (Math.random() < 0.12) {
		// 普通息低频输出文案，避免日志刷屏
		addLog(CULTIVATE_TEXTS[Math.floor(Math.random() * CULTIVATE_TEXTS.length)]);
	}

	player.xp += xpGain;
	player.totalBreaths += 1;
	lastGain = xpGain;
	save();
}

/** 开始 / 暂停持续打坐 */
let breathTimer: ReturnType<typeof setInterval> | null = null;

function toggleMeditation() {
	if (isMeditating) {
		// 暂停
		stopMeditation();
		addLog("你收功止息，结束了这一轮打坐。");
		save();
		return;
	}
	// 开始
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

/** 尝试突破 */
function attemptBreakthrough() {
	if (!canBreakthrough || !nextRealm) return;

	// 破境丹 buff 在本次突破生效后消耗
	lastSuccessRate = successRate;
	const usedPojing = player.pojingActive;
	player.pojingActive = false;

	showBreakthroughModal = true;
	breakthroughResult = "idle";

	// 模拟突破过程
	setTimeout(() => {
		const success = Math.random() < lastSuccessRate;

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
			addLog(`突破失败！天雷反噬，损失 ${loss} 点修为。`, "danger");
		}
		save();
	}, 2000);
}

/** 重置存档 */
function resetGame() {
	if (!confirm("确定要散尽修为，重新来过吗？")) return;
	stopMeditation();
	player = {
		xp: 0,
		realmIndex: 0,
		lastBreakthrough: null,
		totalBreaths: 0,
		pills: { ...EMPTY_PILLS },
		ningshenLeft: 0,
		pojingActive: false,
		log: [],
	};
	addLog("你散尽修为，重新踏上修仙之路。", "warning");
	save();
}

/** 关闭突破弹窗 */
function closeModal() {
	showBreakthroughModal = false;
	breakthroughResult = "idle";
}
</script>

<div class="xiuxian-game">
	<!-- 境界卡片 -->
	<div class="realm-card">
		<div class="realm-header">
			<span class="realm-badge">第 {currentRealm.level} 重</span>
			<h2 class="realm-name">{currentRealm.name}</h2>
			{#if player.ningshenLeft > 0}
				<span class="buff-badge buff-blue">凝神 ×2 · 余 {player.ningshenLeft} 息</span>
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
						<span class="status-idle">入定可积累修为，暂停可收功</span>
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
				尝试突破 → {nextRealm.name}（成功率 {(successRate * 100).toFixed(0)}%{player.pojingActive ? " · 破境丹已备" : ""}）
			</button>
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

	<!-- 突破弹窗 -->
	{#if showBreakthroughModal}
		<div class="modal-overlay" onclick={closeModal}>
			<div class="modal-content" onclick={(e) => e.stopPropagation()}>
				{#if breakthroughResult === "idle"}
					<div class="breakthrough-loading">
						<div class="spinner"></div>
						<p>正在引动天雷...（成功率 {(lastSuccessRate * 100).toFixed(0)}%）</p>
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
						<div class="icon">雷劫</div>
						<h3>突破失败</h3>
						<p>天雷反噬，修为受损。服丹再战！</p>
						<button class="btn" onclick={closeModal}>回去修炼</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- 重置按钮 -->
	<button class="reset-btn" onclick={resetGame}>散尽修为（重置）</button>
</div>

<style>
.xiuxian-game {
	max-width: 560px;
	margin: 0 auto;
}

/* ---------- 境界卡片 ---------- */
.realm-card {
	background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.08));
	border: 1px solid rgba(99, 102, 241, 0.15);
	border-radius: 1rem;
	padding: 1.5rem;
	margin-bottom: 1rem;
}

.realm-header {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	margin-bottom: 0.5rem;
	flex-wrap: wrap;
}

.realm-badge {
	font-size: 0.75rem;
	padding: 0.125rem 0.5rem;
	border-radius: 9999px;
	background: rgba(99, 102, 241, 0.15);
	color: var(--primary);
	font-weight: 500;
}

.realm-name {
	font-size: 1.5rem;
	font-weight: 700;
	color: var(--primary);
	margin: 0;
}

.buff-badge {
	font-size: 0.7rem;
	padding: 0.125rem 0.5rem;
	border-radius: 9999px;
	background: rgba(96, 165, 250, 0.15);
	color: #60a5fa;
}

.buff-blue {
	color: #60a5fa;
}

.realm-desc {
	color: var(--content-meta);
	font-size: 0.875rem;
	margin-bottom: 1rem;
}

.xp-section {
	margin-bottom: 1rem;
}

.xp-bar {
	height: 0.5rem;
	background: rgba(0, 0, 0, 0.08);
	border-radius: 9999px;
	overflow: hidden;
	margin-bottom: 0.5rem;
}

.xp-fill {
	height: 100%;
	background: linear-gradient(90deg, #6366f1, #8b5cf6);
	border-radius: 9999px;
	transition: width 0.5s ease;
}

.xp-fill.glowing {
	box-shadow: 0 0 8px rgba(139, 92, 246, 0.6);
}

.xp-text {
	font-size: 0.875rem;
	color: var(--content-meta);
	font-family: monospace;
	display: flex;
	justify-content: space-between;
}

/* ---------- 持续打坐面板 ---------- */
.meditation-panel {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 1rem;
	border-radius: 0.75rem;
	background: rgba(0, 0, 0, 0.03);
	border: 1px dashed rgba(99, 102, 241, 0.25);
	margin-bottom: 1rem;
	transition: all 0.3s;
}

.meditation-panel.active {
	background: rgba(99, 102, 241, 0.06);
	border-style: solid;
	border-color: rgba(99, 102, 241, 0.4);
}

.meditation-orb {
	width: 3.5rem;
	height: 3.5rem;
	border-radius: 50%;
	background: radial-gradient(circle at 35% 30%, rgba(139, 92, 246, 0.35), rgba(99, 102, 241, 0.15));
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	position: relative;
}

.orb-idle {
	color: var(--primary);
	font-weight: 700;
	font-size: 1.1rem;
	opacity: 0.7;
}

.orb-inner {
	width: 1.1rem;
	height: 1.1rem;
	border-radius: 50%;
	background: radial-gradient(circle, #c4b5fd, #8b5cf6);
	box-shadow: 0 0 12px rgba(139, 92, 246, 0.8);
}

.meditation-orb.breathing {
	animation: breathe 2s ease-in-out infinite;
}

@keyframes breathe {
	0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.35); }
	50% { transform: scale(1.12); box-shadow: 0 0 0 10px rgba(139, 92, 246, 0); }
}

.meditation-info {
	flex: 1;
	display: flex;
	align-items: center;
	gap: 1rem;
	flex-wrap: wrap;
}

.meditation-status {
	flex: 1;
	min-width: 8rem;
	font-size: 0.875rem;
}

.status-running {
	color: var(--primary);
	font-weight: 500;
}

.status-idle {
	color: var(--content-meta);
}

/* ---------- 按钮 ---------- */
.btn {
	padding: 0.625rem 1.25rem;
	border-radius: 0.5rem;
	font-weight: 500;
	border: none;
	cursor: pointer;
	transition: all 0.2s;
	font-size: 0.875rem;
}

.btn:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}

.meditate-btn {
	background: var(--primary);
	color: white;
	min-width: 7rem;
}

.meditate-btn:hover:not(:disabled) {
	opacity: 0.9;
	transform: translateY(-1px);
}

.meditate-btn.pause {
	background: linear-gradient(135deg, #64748b, #475569);
}

.breakthrough-btn {
	width: 100%;
	background: linear-gradient(135deg, #f59e0b, #ef4444);
	color: white;
	animation: pulse 2s infinite;
	margin-bottom: 0.75rem;
}

@keyframes pulse {
	0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
	50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
}

.breakthrough-hint {
	text-align: center;
	font-size: 0.8rem;
	color: var(--content-meta);
	margin-bottom: 0.75rem;
	padding: 0.5rem;
	border-radius: 0.5rem;
	background: rgba(0, 0, 0, 0.03);
}

.stats {
	font-size: 0.75rem;
	color: var(--content-meta);
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

/* ---------- 丹药面板 ---------- */
.pill-card {
	background: linear-gradient(135deg, rgba(251, 191, 36, 0.06), rgba(192, 132, 252, 0.06));
	border: 1px solid rgba(192, 132, 252, 0.2);
	border-radius: 1rem;
	padding: 1.25rem 1.5rem;
	margin-bottom: 1rem;
}

.pill-header {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	margin-bottom: 0.875rem;
	flex-wrap: wrap;
	gap: 0.25rem;
}

.pill-title {
	font-size: 1rem;
	font-weight: 700;
	margin: 0;
	color: var(--primary);
}

.pill-subtitle {
	font-size: 0.7rem;
	color: var(--content-meta);
}

.pill-list {
	display: flex;
	flex-direction: column;
	gap: 0.625rem;
}

.pill-item {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.5rem 0.625rem;
	border-radius: 0.625rem;
	background: rgba(0, 0, 0, 0.03);
}

.pill-orb {
	width: 1.6rem;
	height: 1.6rem;
	border-radius: 50%;
	flex-shrink: 0;
	box-shadow: inset -2px -3px 6px rgba(0, 0, 0, 0.25);
}

.pill-info {
	flex: 1;
	min-width: 0;
}

.pill-name {
	font-size: 0.875rem;
	font-weight: 600;
}

.pill-count {
	font-size: 0.75rem;
	color: var(--primary);
	font-family: monospace;
}

.pill-desc {
	font-size: 0.7rem;
	color: var(--content-meta);
}

.pill-actions {
	display: flex;
	gap: 0.375rem;
	flex-shrink: 0;
}

.pill-use,
.pill-buy {
	padding: 0.3rem 0.6rem;
	font-size: 0.7rem;
	border-radius: 0.4rem;
}

.pill-use {
	background: var(--primary);
	color: white;
}

.pill-buy {
	background: rgba(0, 0, 0, 0.06);
	color: inherit;
	border: 1px solid rgba(99, 102, 241, 0.3);
}

/* ---------- 日志面板 ---------- */
.log-card {
	background: rgba(0, 0, 0, 0.03);
	border: 1px solid rgba(99, 102, 241, 0.12);
	border-radius: 1rem;
	padding: 1.25rem 1.5rem;
	margin-bottom: 1rem;
}

.log-title {
	font-size: 1rem;
	font-weight: 700;
	margin: 0 0 0.75rem;
	color: var(--primary);
}

.log-list {
	display: flex;
	flex-direction: column;
	gap: 0.375rem;
	max-height: 16rem;
	overflow-y: auto;
}

.log-empty {
	font-size: 0.8rem;
	color: var(--content-meta);
	margin: 0;
}

.log-entry {
	font-size: 0.75rem;
	display: flex;
	gap: 0.5rem;
	align-items: baseline;
}

.log-time {
	color: var(--content-meta);
	font-family: monospace;
	flex-shrink: 0;
	opacity: 0.75;
}

.log-msg {
	color: inherit;
}

.log-success .log-msg {
	color: #10b981;
}

.log-danger .log-msg {
	color: #ef4444;
}

.log-warning .log-msg {
	color: #f59e0b;
}

/* ---------- 弹窗 ---------- */
.modal-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.6);
	backdrop-filter: blur(4px);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 9999;
}

.modal-content {
	background: var(--card-bg);
	border-radius: 1rem;
	padding: 2rem;
	text-align: center;
	max-width: 320px;
	margin: 1rem;
}

.breakthrough-loading .spinner {
	width: 48px;
	height: 48px;
	border: 3px solid rgba(99, 102, 241, 0.2);
	border-top-color: var(--primary);
	border-radius: 50%;
	margin: 0 auto 1rem;
	animation: spin 1s linear infinite;
}

@keyframes spin {
	to { transform: rotate(360deg); }
}

.breakthrough-loading p {
	font-size: 0.85rem;
	color: var(--content-meta);
}

.breakthrough-success .icon,
.breakthrough-fail .icon {
	font-size: 1.5rem;
	font-weight: 800;
	color: var(--primary);
	margin-bottom: 0.75rem;
	letter-spacing: 0.2em;
}

.breakthrough-fail .icon {
	color: #ef4444;
}

.breakthrough-success h3,
.breakthrough-fail h3 {
	font-size: 1.25rem;
	font-weight: 700;
	margin-bottom: 0.5rem;
}

.breakthrough-success p,
.breakthrough-fail p {
	color: var(--content-meta);
	font-size: 0.875rem;
	margin-bottom: 1rem;
}

.breakthrough-success .desc {
	font-size: 0.75rem;
	opacity: 0.8;
}

.reset-btn {
	display: block;
	margin: 2rem auto 0;
	font-size: 0.75rem;
	color: var(--content-meta);
	background: none;
	border: none;
	cursor: pointer;
	opacity: 0.6;
}

.reset-btn:hover {
	opacity: 1;
	color: #ef4444;
}
</style>
