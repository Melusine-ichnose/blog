<script lang="ts">
	import { onMount } from "svelte";

	// ====================================================================
	// 俄罗斯方块 · Canvas 实现
	// 操作：←→ 移动 · ↓ 软降 · ↑ 旋转 · 空格硬降 · P 暂停
	// 规则：消行计分 [100/300/500/800]×等级，每 10 行升一级提速，最高分存本地
	// 布局：棋盘高度按视口自适应，整个界面无需滚动
	// ====================================================================

	const COLS = 10;
	const ROWS = 20;
	const BEST_KEY = "tetris-best-score";
	const LINE_SCORE = [0, 100, 300, 500, 800]; // 一次消 1~4 行基础分

	// 七种方块的旋转态（4×4 网格内定义，用字符串紧凑表示）
	const SHAPES: { color: string; cells: number[][] }[] = [
		{ color: "#22d3ee", cells: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]] }, // I
		{ color: "#facc15", cells: [[1,1],[1,1]] },                              // O
		{ color: "#c084fc", cells: [[0,1,0],[1,1,1],[0,0,0]] },                  // T
		{ color: "#4ade80", cells: [[0,1,1],[1,1,0],[0,0,0]] },                  // S
		{ color: "#f87171", cells: [[1,1,0],[0,1,1],[0,0,0]] },                  // Z
		{ color: "#60a5fa", cells: [[1,0,0],[1,1,1],[0,0,0]] },                  // J
		{ color: "#fb923c", cells: [[0,0,1],[1,1,1],[0,0,0]] },                  // L
	];

	type GameState = "ready" | "running" | "paused" | "over";
	interface Piece {
		shape: number; // SHAPES 索引
		cells: number[][];
		x: number;
		y: number;
	}

	let canvasEl: HTMLCanvasElement;
	let nextCanvasEl: HTMLCanvasElement;

	let gameState = $state<GameState>("ready");
	let score = $state(0);
	let lines = $state(0);
	let level = $state(1);
	let best = $state(0);

	// 矩阵旋转（顺时针）
	function rotate(cells: number[][]): number[][] {
		const n = cells.length;
		const out: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
		for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[x][n - 1 - y] = cells[y][x];
		return out;
	}

	onMount(() => {
		const canvas = canvasEl;
		const ctx = canvas.getContext("2d")!;
		const nctx = nextCanvasEl.getContext("2d")!;

		let board: (string | null)[][] = []; // 已落定方块（存颜色）
		let cur: Piece | null = null;
		let next: Piece | null = null;
		let interval = 800;
		let acc = 0;
		let lastT = performance.now();
		let raf = 0;
		let cell = 20;

		best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;

		function newPiece(shapeIdx: number): Piece {
			const cells = SHAPES[shapeIdx].cells.map((r) => [...r]);
			return { shape: shapeIdx, cells, x: Math.floor((COLS - cells.length) / 2), y: 0 };
		}

		function collides(cells: number[][], px: number, py: number): boolean {
			for (let y = 0; y < cells.length; y++)
				for (let x = 0; x < cells[y].length; x++) {
					if (!cells[y][x]) continue;
					const bx = px + x;
					const by = py + y;
					if (bx < 0 || bx >= COLS || by >= ROWS) return true;
					if (by >= 0 && board[by][bx]) return true;
				}
			return false;
		}

		function reset() {
			board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
			score = 0;
			lines = 0;
			level = 1;
			interval = 800;
			acc = 0;
			cur = newPiece(Math.floor(Math.random() * SHAPES.length));
			next = newPiece(Math.floor(Math.random() * SHAPES.length));
		}

		function lockPiece() {
			if (!cur) return;
			for (let y = 0; y < cur.cells.length; y++)
				for (let x = 0; x < cur.cells[y].length; x++) {
					if (!cur.cells[y][x]) continue;
					const by = cur.y + y;
					if (by < 0) {
						// 锁定在顶部之上 → 游戏结束
						gameState = "over";
						if (score > best) {
							best = score;
							localStorage.setItem(BEST_KEY, String(best));
						}
						return;
					}
					board[by][cur.x + x] = SHAPES[cur.shape].color;
				}
			// 消行检测
			let cleared = 0;
			for (let y = ROWS - 1; y >= 0; y--) {
				if (board[y].every((c) => c)) {
					board.splice(y, 1);
					board.unshift(Array(COLS).fill(null));
					cleared++;
					y++;
				}
			}
			if (cleared > 0) {
				lines += cleared;
				score += LINE_SCORE[cleared] * level;
				level = Math.floor(lines / 10) + 1;
				interval = Math.max(80, 800 - (level - 1) * 70);
			}
			cur = next;
			next = newPiece(Math.floor(Math.random() * SHAPES.length));
			// 新方块一出生就碰撞 → 结束
			if (cur && collides(cur.cells, cur.x, cur.y)) {
				gameState = "over";
				if (score > best) {
					best = score;
					localStorage.setItem(BEST_KEY, String(best));
				}
			}
		}

		function step() {
			if (!cur) return;
			if (!collides(cur.cells, cur.x, cur.y + 1)) {
				cur.y++;
			} else {
				lockPiece();
			}
		}

		function move(dx: number) {
			if (cur && !collides(cur.cells, cur.x + dx, cur.y)) cur.x += dx;
		}
		function rotateCur() {
			if (!cur) return;
			const r = rotate(cur.cells);
			// 踢墙：依次尝试原位、左移、右移
			for (const dx of [0, -1, 1, -2, 2]) {
				if (!collides(r, cur.x + dx, cur.y)) {
					cur.cells = r;
					cur.x += dx;
					return;
				}
			}
		}
		function softDrop() {
			if (!cur) return;
			if (!collides(cur.cells, cur.x, cur.y + 1)) {
				cur.y++;
				score += 1;
			}
		}
		function hardDrop() {
			if (!cur) return;
			let d = 0;
			while (!collides(cur.cells, cur.x, cur.y + 1)) {
				cur.y++;
				d++;
			}
			score += d * 2;
			lockPiece();
		}

		// ---------------- 渲染 ----------------
		function drawBlock(c: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
			c.fillStyle = color;
			c.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
			// 顶部高光 + 底部阴影，营造立体感
			c.fillStyle = "rgba(255,255,255,0.22)";
			c.fillRect(x * size + 1, y * size + 1, size - 2, size * 0.18);
			c.fillStyle = "rgba(0,0,0,0.25)";
			c.fillRect(x * size + 1, (y + 1) * size - size * 0.18 - 1, size - 2, size * 0.18);
		}

		function draw() {
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			ctx.fillStyle = "#0b0f1a";
			ctx.fillRect(0, 0, w, h);
			// 网格
			ctx.strokeStyle = "rgba(129,140,248,0.06)";
			ctx.lineWidth = 1;
			for (let x = 1; x < COLS; x++) {
				ctx.beginPath();
				ctx.moveTo(x * cell, 0);
				ctx.lineTo(x * cell, h);
				ctx.stroke();
			}
			for (let y = 1; y < ROWS; y++) {
				ctx.beginPath();
				ctx.moveTo(0, y * cell);
				ctx.lineTo(w, y * cell);
				ctx.stroke();
			}
			// 落定方块
			for (let y = 0; y < ROWS; y++)
				for (let x = 0; x < COLS; x++) {
					const c = board[y][x];
					if (c) drawBlock(ctx, x, y, cell, c);
				}
			// 幽灵投影（落点提示）
			if (cur && gameState === "running") {
				let gy = cur.y;
				while (!collides(cur.cells, cur.x, gy + 1)) gy++;
				ctx.globalAlpha = 0.18;
				for (let y = 0; y < cur.cells.length; y++)
					for (let x = 0; x < cur.cells[y].length; x++)
						if (cur.cells[y][x]) drawBlock(ctx, cur.x + x, gy + y, cell, SHAPES[cur.shape].color);
				ctx.globalAlpha = 1;
			}
			// 当前方块
			if (cur) {
				for (let y = 0; y < cur.cells.length; y++)
					for (let x = 0; x < cur.cells[y].length; x++)
						if (cur.cells[y][x]) drawBlock(ctx, cur.x + x, cur.y + y, cell, SHAPES[cur.shape].color);
			}
			// 下一块预览
			const nw = nextCanvasEl.clientWidth;
			nctx.fillStyle = "#0b0f1a";
			nctx.fillRect(0, 0, nw, nw);
			if (next) {
				const n = next.cells.length;
				const ncell = Math.floor(nw / (n + 1.5));
				const offX = (nw - n * ncell) / 2 / ncell;
				const offY = offX;
				for (let y = 0; y < n; y++)
					for (let x = 0; x < n; x++)
						if (next.cells[y][x]) drawBlock(nctx, x + offX, y + offY, ncell, SHAPES[next.shape].color);
			}
		}

		function resize() {
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			canvas.width = Math.round(canvas.clientWidth * dpr);
			canvas.height = Math.round(canvas.clientHeight * dpr);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			cell = canvas.clientWidth / COLS;
			const nsize = nextCanvasEl.clientWidth;
			nextCanvasEl.width = Math.round(nsize * dpr);
			nextCanvasEl.height = Math.round(nsize * dpr);
			nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			draw();
		}

		function frame(now: number) {
			const dt = now - lastT;
			lastT = now;
			if (gameState === "running") {
				acc += dt;
				while (acc >= interval) {
					acc -= interval;
					step();
					if (gameState !== "running") break;
				}
			}
			draw();
			raf = requestAnimationFrame(frame);
		}

		// ---------------- 输入 ----------------
		function onKey(e: KeyboardEvent) {
			const handled = ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " ", "p", "P"];
			if (!handled.includes(e.key)) return;
			e.preventDefault();
			if (e.key === "p" || e.key === "P") {
				togglePause();
				return;
			}
			if (gameState === "ready" || gameState === "over") {
				reset();
				gameState = "running";
				return;
			}
			if (gameState !== "running") return;
			if (e.key === "ArrowLeft") move(-1);
			else if (e.key === "ArrowRight") move(1);
			else if (e.key === "ArrowDown") softDrop();
			else if (e.key === "ArrowUp") rotateCur();
			else if (e.key === " ") hardDrop();
		}

		window.addEventListener("keydown", onKey);
		window.addEventListener("resize", resize);
		reset();
		resize();
		raf = requestAnimationFrame(frame);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("resize", resize);
		};
	});

	function togglePause() {
		if (gameState === "running") gameState = "paused";
		else if (gameState === "paused") gameState = "running";
	}

	// 触屏按钮桥接：通过键盘事件复用同一套逻辑
	function pressKey(key: string) {
		window.dispatchEvent(new KeyboardEvent("keydown", { key }));
	}
</script>

<div class="tetris-game">
	<div class="play-row">
		<!-- 棋盘：高度自适应视口，保证整屏可见 -->
		<div class="board-wrap">
			<canvas bind:this={canvasEl} class="board" aria-label="俄罗斯方块棋盘"></canvas>
			{#if gameState !== "running"}
				<div class="overlay">
					{#if gameState === "ready"}
						<p class="overlay-title">俄罗斯方块</p>
						<p class="overlay-sub">←→ 移动 · ↑ 旋转 · ↓ 软降 · 空格硬降</p>
						<p class="overlay-hint">点下方方向键开始（或按键盘方向键）</p>
					{:else if gameState === "paused"}
						<p class="overlay-title">已暂停</p>
						<p class="overlay-hint">按 P 继续</p>
					{:else}
						<p class="overlay-title over">游戏结束</p>
						<p class="overlay-sub">得分 {score}{score >= best && score > 0 ? " · 新纪录！" : ""}</p>
						<p class="overlay-hint">点下方方向键重新开始</p>
					{/if}
				</div>
			{/if}
		</div>

		<!-- 侧栏：下一块 + 数据 -->
		<div class="side">
			<div class="side-box">
				<span class="side-label">下一块</span>
				<canvas bind:this={nextCanvasEl} class="next-canvas"></canvas>
			</div>
			<div class="side-box stats">
				<div class="stat"><span class="side-label">得分</span><span class="stat-value">{score}</span></div>
				<div class="stat"><span class="side-label">消行</span><span class="stat-value">{lines}</span></div>
				<div class="stat"><span class="side-label">等级</span><span class="stat-value lv">{level}</span></div>
				<div class="stat"><span class="side-label">最高</span><span class="stat-value best">{best}</span></div>
			</div>
			<button class="pause-btn" onclick={togglePause} disabled={gameState !== "running" && gameState !== "paused"}>
				{gameState === "paused" ? "继续" : "暂停"}
			</button>
		</div>
	</div>

	<!-- 移动端触控按钮 -->
	<div class="touch-pad">
		<button class="tp-btn" onclick={() => pressKey("ArrowLeft")} aria-label="左移">←</button>
		<button class="tp-btn" onclick={() => pressKey("ArrowRight")} aria-label="右移">→</button>
		<button class="tp-btn" onclick={() => pressKey("ArrowDown")} aria-label="软降">↓</button>
		<button class="tp-btn" onclick={() => pressKey("ArrowUp")} aria-label="旋转">⟳</button>
		<button class="tp-btn drop" onclick={() => pressKey(" ")} aria-label="硬降">⇓</button>
	</div>
</div>

<style>
	.tetris-game {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
	}
	.play-row {
		display: flex;
		gap: 0.9rem;
		align-items: stretch;
		justify-content: center;
		width: 100%;
	}
	/* 棋盘高度：视口高度减去导航/标题/边距，保证免滚轮 */
	.board-wrap {
		position: relative;
		height: min(62vh, 30rem);
		aspect-ratio: 1 / 2;
	}
	.board {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: 0.6rem;
		border: 1px solid rgba(129, 140, 248, 0.25);
		box-shadow: 0 0 32px rgba(99, 102, 241, 0.12);
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		width: 7rem;
	}
	.side-box {
		background: rgba(11, 15, 26, 0.8);
		border: 1px solid rgba(129, 140, 248, 0.2);
		border-radius: 0.6rem;
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
	}
	.next-canvas {
		width: 4.5rem;
		height: 4.5rem;
	}
	.side-label {
		font-size: 0.68rem;
		color: #94a3b8;
		letter-spacing: 0.1em;
	}
	.stats {
		gap: 0.5rem;
	}
	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.stat-value {
		font-family: ui-monospace, "JetBrains Mono", Consolas, monospace;
		font-size: 1.05rem;
		font-weight: 800;
		color: #e2e8f0;
	}
	.stat-value.lv {
		color: #22d3ee;
	}
	.stat-value.best {
		color: #fbbf24;
	}
	.pause-btn {
		padding: 0.4rem 0;
		border-radius: 0.5rem;
		border: 1px solid rgba(129, 140, 248, 0.4);
		background: rgba(99, 102, 241, 0.12);
		color: #c7d2fe;
		font-size: 0.82rem;
		cursor: pointer;
		transition: background 0.2s;
	}
	.pause-btn:hover:not(:disabled) {
		background: rgba(99, 102, 241, 0.25);
	}
	.pause-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		border-radius: 0.6rem;
		background: rgba(5, 8, 18, 0.72);
		backdrop-filter: blur(3px);
		text-align: center;
		padding: 1rem;
	}
	.overlay-title {
		font-size: 1.4rem;
		font-weight: 800;
		color: #e0e7ff;
		margin: 0;
		letter-spacing: 0.12em;
	}
	.overlay-title.over {
		color: #fb7185;
	}
	.overlay-sub {
		font-size: 0.82rem;
		color: #cbd5e1;
		margin: 0;
	}
	.overlay-hint {
		font-size: 0.76rem;
		color: #94a3b8;
		margin: 0.5rem 0 0;
		animation: hint-blink 1.6s ease-in-out infinite;
	}
	@keyframes hint-blink {
		50% {
			opacity: 0.35;
		}
	}

	/* 触控按钮：宽屏隐藏 */
	.touch-pad {
		display: none;
		gap: 0.5rem;
	}
	.tp-btn {
		width: 3rem;
		height: 3rem;
		border-radius: 0.6rem;
		border: 1px solid rgba(129, 140, 248, 0.4);
		background: rgba(99, 102, 241, 0.12);
		color: #c7d2fe;
		font-size: 1.2rem;
		cursor: pointer;
		touch-action: manipulation;
	}
	.tp-btn:active {
		background: rgba(99, 102, 241, 0.3);
	}
	.tp-btn.drop {
		border-color: rgba(251, 191, 36, 0.5);
		color: #fbbf24;
	}
	@media (pointer: coarse) {
		.touch-pad {
			display: flex;
		}
	}

	/* 窄屏：侧栏改到棋盘下方一行 */
	@media (max-width: 520px) {
		.play-row {
			flex-direction: column;
			align-items: center;
		}
		.side {
			flex-direction: row;
			width: 100%;
			max-width: 22rem;
			align-items: stretch;
		}
		.side-box {
			flex: 1;
		}
		.stats {
			flex-direction: row;
			gap: 0.8rem;
		}
		.pause-btn {
			padding: 0.4rem 0.8rem;
		}
		.board-wrap {
			height: min(52vh, 26rem);
		}
	}
</style>
