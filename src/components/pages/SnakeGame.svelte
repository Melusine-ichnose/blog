<script lang="ts">
	import { onMount } from "svelte";

	// ====================================================================
	// 贪吃蛇 · Canvas 实现
	// 操作：方向键 / WASD 转向，空格暂停，手机端滑动转向、点按开始
	// 规则：撞墙或撞到自己结束；每吃一个食物 +10 分并加速，最高分存本地
	// ====================================================================

	const COLS = 20; // 棋盘列数
	const ROWS = 20; // 棋盘行数
	const BASE_INTERVAL = 150; // 初始步进毫秒
	const MIN_INTERVAL = 70; // 最快速度
	const SPEEDUP = 4; // 每吃一个食物加快的毫秒数
	const BEST_KEY = "snake-best-score";

	interface Vec {
		x: number;
		y: number;
	}

	type GameState = "ready" | "running" | "paused" | "over";

	let canvasEl: HTMLCanvasElement;
	let wrapEl: HTMLDivElement; // 棋盘容器（含遮罩层）：触摸事件绑这里，避免遮罩拦截

	// Svelte 状态（驱动 UI）
	let gameState = $state<GameState>("ready");
	let score = $state(0);
	let best = $state(0);

	onMount(() => {
		const canvas = canvasEl;
		const wrap = wrapEl;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// ---- 游戏数据（高频更新，不走响应式） ----
		let snake: Vec[] = []; // 蛇身，索引 0 为头
		let dir: Vec = { x: 1, y: 0 }; // 当前方向
		let pendingDir: Vec = { x: 1, y: 0 }; // 下一步方向（防止一帧内 180° 掉头）
		let food: Vec = { x: 5, y: 5 };
		let interval = BASE_INTERVAL;
		let acc = 0; // 时间累积器
		let lastT = performance.now();
		let raf = 0;
		let cell = 16; // 单元格像素
		let dpr = 1;

		best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;

		function reset() {
			// 初始三节蛇，居中向右
			const cy = Math.floor(ROWS / 2);
			snake = [
				{ x: 8, y: cy },
				{ x: 7, y: cy },
				{ x: 6, y: cy },
			];
			dir = { x: 1, y: 0 };
			pendingDir = { x: 1, y: 0 };
			interval = BASE_INTERVAL;
			acc = 0;
			score = 0;
			spawnFood();
		}

		function spawnFood() {
			// 在空格子上随机放食物
			const occupied = new Set(snake.map((s) => s.x + "," + s.y));
			const free: Vec[] = [];
			for (let x = 0; x < COLS; x++)
				for (let y = 0; y < ROWS; y++)
					if (!occupied.has(x + "," + y)) free.push({ x, y });
			food = free.length ? free[Math.floor(Math.random() * free.length)] : { x: -1, y: -1 };
		}

		function step() {
			dir = pendingDir;
			const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

			// 撞墙或撞自己 → 结束
			if (
				head.x < 0 ||
				head.x >= COLS ||
				head.y < 0 ||
				head.y >= ROWS ||
				snake.some((s) => s.x === head.x && s.y === head.y)
			) {
				gameState = "over";
				if (score > best) {
					best = score;
					localStorage.setItem(BEST_KEY, String(best));
				}
				return;
			}

			snake.unshift(head);
			if (head.x === food.x && head.y === food.y) {
				// 吃到食物：加分加速，尾巴不缩
				score += 10;
				interval = Math.max(MIN_INTERVAL, interval - SPEEDUP);
				spawnFood();
			} else {
				snake.pop();
			}
		}

		function resize() {
			dpr = Math.min(window.devicePixelRatio || 1, 2);
			const cssSize = canvas.clientWidth;
			canvas.width = Math.round(cssSize * dpr);
			canvas.height = Math.round(cssSize * dpr);
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
			cell = cssSize / COLS;
		}

		function draw(now: number) {
			const w = canvas.clientWidth;
			// 背景
			ctx!.fillStyle = "#0b0f1a";
			ctx!.fillRect(0, 0, w, w);
			// 网格线
			ctx!.strokeStyle = "rgba(129,140,248,0.07)";
			ctx!.lineWidth = 1;
			for (let i = 1; i < COLS; i++) {
				ctx!.beginPath();
				ctx!.moveTo(i * cell, 0);
				ctx!.lineTo(i * cell, w);
				ctx!.stroke();
				ctx!.beginPath();
				ctx!.moveTo(0, i * cell);
				ctx!.lineTo(w, i * cell);
				ctx!.stroke();
			}

			// 食物：脉动的发光浆果
			if (food.x >= 0) {
				const pulse = 1 + 0.18 * Math.sin(now / 220);
				const fx = (food.x + 0.5) * cell;
				const fy = (food.y + 0.5) * cell;
				ctx!.shadowColor = "#fb7185";
				ctx!.shadowBlur = 12;
				ctx!.fillStyle = "#fb7185";
				ctx!.beginPath();
				ctx!.arc(fx, fy, cell * 0.32 * pulse, 0, Math.PI * 2);
				ctx!.fill();
				ctx!.shadowBlur = 0;
			}

			// 蛇身：头亮尾暗的靛蓝渐变
			for (let i = snake.length - 1; i >= 0; i--) {
				const s = snake[i];
				const t = i / Math.max(1, snake.length - 1); // 0=头 1=尾
				const isHead = i === 0;
				ctx!.fillStyle = isHead
					? "#a5b4fc"
					: `rgba(99,102,241,${0.95 - t * 0.55})`;
				if (isHead) {
					ctx!.shadowColor = "#818cf8";
					ctx!.shadowBlur = 14;
				}
				const pad = isHead ? cell * 0.08 : cell * 0.14;
				const r = cell * 0.28;
				ctx!.beginPath();
				ctx!.roundRect(s.x * cell + pad, s.y * cell + pad, cell - pad * 2, cell - pad * 2, r);
				ctx!.fill();
				ctx!.shadowBlur = 0;
			}

			// 蛇头眼睛
			if (snake.length) {
				const h = snake[0];
				const cx = (h.x + 0.5) * cell;
				const cy = (h.y + 0.5) * cell;
				const ex = dir.x * cell * 0.14;
				const ey = dir.y * cell * 0.14;
				const px = -dir.y * cell * 0.16; // 垂直方向偏移出两只眼
				const py = dir.x * cell * 0.16;
				ctx!.fillStyle = "#0b0f1a";
				ctx!.beginPath();
				ctx!.arc(cx + ex + px, cy + ey + py, cell * 0.09, 0, Math.PI * 2);
				ctx!.arc(cx + ex - px, cy + ey - py, cell * 0.09, 0, Math.PI * 2);
				ctx!.fill();
			}
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
			draw(now);
			raf = requestAnimationFrame(frame);
		}

		// ---- 输入 ----
		const DIR_MAP: Record<string, Vec> = {
			ArrowUp: { x: 0, y: -1 },
			ArrowDown: { x: 0, y: 1 },
			ArrowLeft: { x: -1, y: 0 },
			ArrowRight: { x: 1, y: 0 },
			w: { x: 0, y: -1 },
			s: { x: 0, y: 1 },
			a: { x: -1, y: 0 },
			d: { x: 1, y: 0 },
			W: { x: 0, y: -1 },
			S: { x: 0, y: 1 },
			A: { x: -1, y: 0 },
			D: { x: 1, y: 0 },
		};

		function setDir(v: Vec) {
			// 禁止 180° 掉头（与当前方向相反时忽略）
			if (v.x === -dir.x && v.y === -dir.y) return;
			pendingDir = v;
		}

		function onKey(e: KeyboardEvent) {
			if (e.key === " " || e.key === "Spacebar") {
				e.preventDefault();
				togglePause();
				return;
			}
			const v = DIR_MAP[e.key];
			if (!v) return;
			e.preventDefault(); // 阻止方向键滚动页面
			if (gameState === "ready" || gameState === "over") {
				reset();
				gameState = "running";
			}
			setDir(v);
		}

		// 触屏滑动 + 点按（监听器绑在容器上：遮罩层盖住棋盘时事件照样冒泡到这里）
		let touchX = 0;
		let touchY = 0;
		function onTouchStart(e: TouchEvent) {
			touchX = e.touches[0].clientX;
			touchY = e.touches[0].clientY;
		}
		function onTouchMove(e: TouchEvent) {
			e.preventDefault(); // 阻止页面滚动
			const dx = e.touches[0].clientX - touchX;
			const dy = e.touches[0].clientY - touchY;
			if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
			if (gameState === "ready" || gameState === "over") {
				reset();
				gameState = "running";
			}
			setDir(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) });
			touchX = e.touches[0].clientX;
			touchY = e.touches[0].clientY;
		}

		// 点按棋盘/遮罩：手机无键盘也能开局或继续；running 中点击不响应（防误触）
		function onWrapTap() {
			if (gameState === "ready" || gameState === "over") {
				reset();
				gameState = "running";
			} else if (gameState === "paused") {
				gameState = "running";
			}
		}

		window.addEventListener("keydown", onKey);
		window.addEventListener("resize", resize);
		wrap.addEventListener("touchstart", onTouchStart, { passive: true });
		wrap.addEventListener("touchmove", onTouchMove, { passive: false });
		wrap.addEventListener("click", onWrapTap);

		reset();
		resize();
		raf = requestAnimationFrame(frame);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("resize", resize);
			wrap.removeEventListener("touchstart", onTouchStart);
			wrap.removeEventListener("touchmove", onTouchMove);
			wrap.removeEventListener("click", onWrapTap);
		};
	});

	function togglePause() {
		if (gameState === "running") gameState = "paused";
		else if (gameState === "paused") gameState = "running";
	}
</script>

<div class="snake-game">
	<!-- 计分板 -->
	<div class="scoreboard">
		<div class="score-item">
			<span class="score-label">得分</span>
			<span class="score-value">{score}</span>
		</div>
		<div class="score-item">
			<span class="score-label">最高分</span>
			<span class="score-value best">{best}</span>
		</div>
		<button
			class="pause-btn"
			onclick={togglePause}
			disabled={gameState !== "running" && gameState !== "paused"}
		>
			{gameState === "paused" ? "继续" : "暂停"}
		</button>
	</div>

	<!-- 棋盘 -->
	<div class="board-wrap" bind:this={wrapEl}>
		<canvas bind:this={canvasEl} class="board" aria-label="贪吃蛇棋盘"></canvas>

		<!-- 状态遮罩 -->
		{#if gameState !== "running"}
			<div class="overlay">
				{#if gameState === "ready"}
					<p class="overlay-title">贪吃蛇</p>
					<p class="overlay-sub">方向键 / WASD 控制 · 空格暂停 · 手机滑动转向</p>
					<p class="overlay-hint">点击任意处 / 滑动开始（或按方向键）</p>
				{:else if gameState === "paused"}
					<p class="overlay-title">已暂停</p>
					<p class="overlay-hint">点击棋盘 / 按空格继续</p>
				{:else}
					<p class="overlay-title over">游戏结束</p>
					<p class="overlay-sub">本局得分 {score}{score >= best && score > 0 ? " · 新纪录！" : ""}</p>
					<p class="overlay-hint">点击任意处 / 滑动重新开始</p>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.snake-game {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: center;
	}

	.scoreboard {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		width: 100%;
		justify-content: center;
	}
	.score-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		min-width: 4.5rem;
	}
	.score-label {
		font-size: 0.72rem;
		color: #94a3b8;
		letter-spacing: 0.1em;
	}
	.score-value {
		font-family: ui-monospace, "JetBrains Mono", Consolas, monospace;
		font-size: 1.4rem;
		font-weight: 800;
		color: #e2e8f0;
		line-height: 1.2;
	}
	.score-value.best {
		color: #fbbf24;
	}
	.pause-btn {
		padding: 0.4rem 1rem;
		border-radius: 0.5rem;
		border: 1px solid rgba(129, 140, 248, 0.4);
		background: rgba(99, 102, 241, 0.12);
		color: #c7d2fe;
		font-size: 0.85rem;
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

	.board-wrap {
		position: relative;
		width: 100%;
		/* 宽度随视口高度收缩，保证整屏免滚轮可见 */
		max-width: min(30rem, calc(100vh - 16rem));
		touch-action: none; /* 遮罩层上的滑动也交给游戏，不滚页面 */
	}
	.board {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		border-radius: 0.75rem;
		border: 1px solid rgba(129, 140, 248, 0.25);
		box-shadow: 0 0 40px rgba(99, 102, 241, 0.12);
		touch-action: none;
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		border-radius: 0.75rem;
		background: rgba(5, 8, 18, 0.72);
		backdrop-filter: blur(3px);
		text-align: center;
		padding: 1rem;
		cursor: pointer; /* 提示可点按开局 */
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
	}
	.overlay-title {
		font-size: 1.6rem;
		font-weight: 800;
		color: #e0e7ff;
		margin: 0;
		letter-spacing: 0.15em;
	}
	.overlay-title.over {
		color: #fb7185;
	}
	.overlay-sub {
		font-size: 0.85rem;
		color: #cbd5e1;
		margin: 0;
	}
	.overlay-hint {
		font-size: 0.78rem;
		color: #94a3b8;
		margin: 0.5rem 0 0;
		animation: hint-blink 1.6s ease-in-out infinite;
	}
	@keyframes hint-blink {
		50% {
			opacity: 0.35;
		}
	}
</style>
