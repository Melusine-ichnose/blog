<script lang="ts">
	import { onDestroy } from "svelte";

	// ====================================================================
	// 扫雷 · DOM 网格实现
	// 操作：左键揭开 · 右键/长按插旗 · 点数字快速开邻格（chording）
	// 规则：首击必安全；揭开所有非雷格获胜；计时 + 难度切换
	// ====================================================================

	interface Difficulty {
		name: string;
		rows: number;
		cols: number;
		mines: number;
	}
	const DIFFICULTIES: Difficulty[] = [
		{ name: "初级 9×9", rows: 9, cols: 9, mines: 10 },
		{ name: "中级 16×16", rows: 16, cols: 16, mines: 40 },
	];

	interface Cell {
		mine: boolean;
		revealed: boolean;
		flagged: boolean;
		count: number; // 周围雷数
	}

	type GameState = "ready" | "running" | "won" | "lost";

	let diffIdx = $state(0);
	let cells = $state<Cell[]>([]);
	let gameState = $state<GameState>("ready");
	let flagCount = $state(0);
	let seconds = $state(0);

	let timer: ReturnType<typeof setInterval> | null = null;

	const diff = $derived(DIFFICULTIES[diffIdx]);
	const mineLeft = $derived(diff.mines - flagCount);

	function newGame() {
		cells = Array.from({ length: diff.rows * diff.cols }, () => ({
			mine: false,
			revealed: false,
			flagged: false,
			count: 0,
		}));
		gameState = "ready";
		flagCount = 0;
		seconds = 0;
		stopTimer();
	}

	function stopTimer() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}
	function startTimer() {
		stopTimer();
		timer = setInterval(() => seconds++, 1000);
	}

	function idx(x: number, y: number) {
		return y * diff.cols + x;
	}

	function neighbors(i: number): number[] {
		const x = i % diff.cols;
		const y = Math.floor(i / diff.cols);
		const out: number[] = [];
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++) {
				if (!dx && !dy) continue;
				const nx = x + dx;
				const ny = y + dy;
				if (nx >= 0 && nx < diff.cols && ny >= 0 && ny < diff.rows) out.push(idx(nx, ny));
			}
		return out;
	}

	// 首击后布雷：保证首击及其邻格无雷
	function plantMines(safeIdx: number) {
		const safe = new Set([safeIdx, ...neighbors(safeIdx)]);
		const candidates: number[] = [];
		for (let i = 0; i < cells.length; i++) if (!safe.has(i)) candidates.push(i);
		for (let m = 0; m < diff.mines && candidates.length; m++) {
			const pick = Math.floor(Math.random() * candidates.length);
			const mi = candidates.splice(pick, 1)[0];
			cells[mi].mine = true;
		}
		for (let i = 0; i < cells.length; i++) {
			if (cells[i].mine) continue;
			cells[i].count = neighbors(i).filter((n) => cells[n].mine).length;
		}
	}

	function reveal(i: number) {
		if (gameState === "won" || gameState === "lost") return;
		const c = cells[i];
		if (c.flagged) return;

		// 首击：布雷并启动计时
		if (gameState === "ready") {
			plantMines(i);
			gameState = "running";
			startTimer();
		}
		if (c.revealed) {
			// chording：点已揭开的数字格，旗数够则开其余邻格
			if (c.count > 0) {
				const ns = neighbors(i);
				const flags = ns.filter((n) => cells[n].flagged).length;
				if (flags === c.count) for (const n of ns) reveal(n);
			}
			return;
		}
		if (c.mine) {
			// 踩雷：揭示全部雷，标出错误旗
			c.revealed = true;
			gameState = "lost";
			stopTimer();
			for (const cell of cells) if (cell.mine) cell.revealed = true;
			return;
		}
		// 洪水填充：0 雷格自动连片揭开
		const stack = [i];
		while (stack.length) {
			const cur = stack.pop()!;
			const cc = cells[cur];
			if (cc.revealed || cc.flagged) continue;
			cc.revealed = true;
			if (cc.count === 0) for (const n of neighbors(cur)) if (!cells[n].revealed) stack.push(n);
		}
		checkWin();
	}

	function toggleFlag(i: number) {
		if (gameState !== "ready" && gameState !== "running") return;
		const c = cells[i];
		if (c.revealed) return;
		c.flagged = !c.flagged;
		flagCount += c.flagged ? 1 : -1;
	}

	function checkWin() {
		const hiddenSafe = cells.filter((c) => !c.mine && !c.revealed).length;
		if (hiddenSafe === 0) {
			gameState = "won";
			stopTimer();
			// 自动给剩余雷插旗
			for (const c of cells) if (c.mine && !c.flagged) c.flagged = true;
			flagCount = diff.mines;
		}
	}

	// 触屏长按插旗
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	function onTouchStartCell(i: number) {
		pressTimer = setTimeout(() => {
			toggleFlag(i);
			pressTimer = null;
		}, 350);
	}
	function onTouchEndCell(i: number) {
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimer = null;
			reveal(i); // 短按 = 揭开
		}
	}

	// 数字格配色（经典扫雷色板）
	const NUM_COLORS = ["", "#60a5fa", "#4ade80", "#f87171", "#c084fc", "#fb923c", "#22d3ee", "#f472b6", "#e2e8f0"];

	newGame();
	onDestroy(stopTimer);
</script>

<div class="mine-game">
	<!-- 顶栏：难度 / 雷数 / 重置 / 计时 -->
	<div class="topbar">
		<select class="diff-select" bind:value={diffIdx} onchange={newGame} aria-label="难度">
			{#each DIFFICULTIES as d, i}
				<option value={i}>{d.name} · {d.mines}雷</option>
			{/each}
		</select>
		<div class="counter" title="剩余雷数">
			<span class="counter-icon">💣</span>
			<span class="counter-value">{mineLeft}</span>
		</div>
		<button class="reset-btn" onclick={newGame} aria-label="重新开始">
			{#if gameState === "won"}😎{:else if gameState === "lost"}😵{:else}🙂{/if}
		</button>
		<div class="counter" title="用时（秒）">
			<span class="counter-icon">⏱</span>
			<span class="counter-value">{seconds}</span>
		</div>
	</div>

	<!-- 雷区：宽度自适应，保证整屏可见 -->
	<div
		class="mine-grid"
		class:lost={gameState === "lost"}
		style="--cols: {diff.cols}; --rows: {diff.rows}"
		role="grid"
		aria-label="扫雷区"
	>
		{#each cells as c, i}
			<button
				class="cell"
				class:revealed={c.revealed}
				class:mine-hit={c.revealed && c.mine && gameState === "lost"}
				class:wrong-flag={gameState === "lost" && c.flagged && !c.mine}
				disabled={gameState === "won" || gameState === "lost"}
				onclick={() => reveal(i)}
				oncontextmenu={(e) => {
					e.preventDefault();
					toggleFlag(i);
				}}
				ontouchstart={() => onTouchStartCell(i)}
				ontouchend={(e) => {
					e.preventDefault();
					onTouchEndCell(i);
				}}
				aria-label={c.revealed ? (c.mine ? "雷" : c.count ? `${c.count}` : "空") : c.flagged ? "旗" : "未揭开"}
			>
				{#if c.flagged && (!c.revealed || gameState === "lost")}
					🚩
				{:else if c.revealed && c.mine}
					💣
				{:else if c.revealed && c.count > 0}
					<span class="num" style="color: {NUM_COLORS[c.count]}">{c.count}</span>
				{/if}
			</button>
		{/each}
	</div>

	<!-- 状态提示 -->
	<p class="status-line">
		{#if gameState === "won"}
			🎉 排雷成功！用时 {seconds} 秒
		{:else if gameState === "lost"}
			💥 踩到雷了，点 🙂 重新来
		{:else}
			左键揭开 · 右键或长按插旗 · 点数字可快速开邻格
		{/if}
	</p>
</div>

<style>
	.mine-game {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.7rem;
	}

	.topbar {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		background: rgba(11, 15, 26, 0.8);
		border: 1px solid rgba(129, 140, 248, 0.2);
		border-radius: 0.6rem;
		padding: 0.4rem 0.8rem;
	}
	.diff-select {
		background: rgba(99, 102, 241, 0.12);
		color: #c7d2fe;
		border: 1px solid rgba(129, 140, 248, 0.4);
		border-radius: 0.4rem;
		font-size: 0.78rem;
		padding: 0.25rem 0.4rem;
		cursor: pointer;
	}
	.counter {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.counter-icon {
		font-size: 0.9rem;
	}
	.counter-value {
		font-family: ui-monospace, "JetBrains Mono", Consolas, monospace;
		font-weight: 800;
		font-size: 1rem;
		color: #e2e8f0;
		min-width: 2ch;
		text-align: center;
	}
	.reset-btn {
		font-size: 1.3rem;
		background: rgba(99, 102, 241, 0.12);
		border: 1px solid rgba(129, 140, 248, 0.4);
		border-radius: 0.5rem;
		padding: 0.15rem 0.55rem;
		cursor: pointer;
		transition: transform 0.15s;
	}
	.reset-btn:hover {
		transform: scale(1.08);
	}
	.reset-btn:active {
		transform: scale(0.95);
	}

	/* 雷区：尺寸随难度与视口自适应，整屏可见免滚轮 */
	.mine-grid {
		display: grid;
		grid-template-columns: repeat(var(--cols), 1fr);
		gap: 2px;
		width: min(100%, 26rem, calc((100vh - 17rem) * var(--cols) / var(--rows)));
		background: rgba(11, 15, 26, 0.8);
		border: 1px solid rgba(129, 140, 248, 0.25);
		border-radius: 0.6rem;
		padding: 6px;
		touch-action: manipulation;
	}
	.cell {
		aspect-ratio: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: clamp(0.6rem, 2.2vw, 0.95rem);
		font-weight: 800;
		border: none;
		border-radius: 0.25rem;
		background: rgba(99, 102, 241, 0.22);
		cursor: pointer;
		transition: background 0.12s;
		padding: 0;
		line-height: 1;
	}
	.cell:hover:not(:disabled):not(.revealed) {
		background: rgba(129, 140, 248, 0.4);
	}
	.cell.revealed {
		background: rgba(15, 20, 35, 0.9);
		cursor: default;
		box-shadow: inset 0 0 0 1px rgba(129, 140, 248, 0.08);
	}
	.cell.mine-hit {
		background: rgba(248, 113, 113, 0.35);
	}
	.cell.wrong-flag {
		opacity: 0.45;
	}
	.cell:disabled {
		cursor: default;
	}
	.num {
		font-family: ui-monospace, "JetBrains Mono", Consolas, monospace;
	}

	.status-line {
		font-size: 0.78rem;
		color: #94a3b8;
		margin: 0;
		text-align: center;
	}
</style>
