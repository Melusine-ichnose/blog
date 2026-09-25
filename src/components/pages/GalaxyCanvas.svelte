<script lang="ts">
	import { onMount } from "svelte";

	// ====================================================================
	// 数字星河 · 水母群引擎
	// 粒子群像水母一样脉动循环：
	//   聚集(伞盖收缩) → 冲刺(如火箭定向飞行，拖出彗尾)
	//   → 展开(粒子绽放成几何图形：爱心/立方体/五角星/双环/无限符)
	//   → 飘散(缓缓散开) → 换方向再次聚集……循环往复
	// 交互：指针轻微牵引航向；点击任意处立刻重新聚集并冲向点击位置
	// ====================================================================

	let canvasEl: HTMLCanvasElement;

	// 冷冽蓝白紫全息色板
	const HUES = ["#7dd3fc", "#38bdf8", "#818cf8", "#a78bfa", "#c084fc", "#e0f2fe"];
	const PARTICLE_COUNT = 520;

	type Phase = "gather" | "cruise" | "unfold" | "hold" | "dissolve";

	interface P {
		x: number; // 世界坐标（1 ≈ 屏幕短边的 1/4）
		y: number;
		vx: number;
		vy: number;
		color: string;
		size: number;
		tw: number; // 闪烁相位
		bright: boolean;
		jx: number; // 目标抖动偏移（让图形边缘有毛糙光感）
		jy: number;
		trailK: number; // 冲刺时的拖尾系数 0~1
	}

	// ---------------- 图形点集生成（单位空间，约 -1~1） ----------------
	function heartPoints(n: number): number[][] {
		const pts: number[][] = [];
		for (let i = 0; i < n; i++) {
			const t = (i / n) * Math.PI * 2;
			const x = 16 * Math.pow(Math.sin(t), 3);
			const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
			pts.push([x / 17, -y / 17]);
		}
		return pts;
	}

	function starPoints(n: number): number[][] {
		const verts: number[][] = [];
		for (let i = 0; i < 10; i++) {
			const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
			const r = i % 2 === 0 ? 1 : 0.45;
			verts.push([Math.cos(a) * r, Math.sin(a) * r]);
		}
		const pts: number[][] = [];
		for (let i = 0; i < n; i++) {
			const f = (i / n) * 10;
			const a = Math.floor(f) % 10;
			const b = (a + 1) % 10;
			const t = f - Math.floor(f);
			pts.push([verts[a][0] + (verts[b][0] - verts[a][0]) * t, verts[a][1] + (verts[b][1] - verts[a][1]) * t]);
		}
		return pts;
	}

	function cubePoints(n: number): number[][] {
		const v: number[][] = [];
		for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
		const edges: number[][] = [];
		for (let i = 0; i < 8; i++)
			for (let j = i + 1; j < 8; j++) {
				const diff = v[i].filter((c, k) => c !== v[j][k]).length;
				if (diff === 1) edges.push([i, j]);
			}
		// 等轴测投影：绕 Y、X 各转 35.26°
		const ry = 0.6155;
		const rx = 0.6155;
		const proj = (p: number[]): number[] => {
			const x1 = p[0] * Math.cos(ry) + p[2] * Math.sin(ry);
			const z1 = -p[0] * Math.sin(ry) + p[2] * Math.cos(ry);
			const y1 = p[1] * Math.cos(rx) - z1 * Math.sin(rx);
			return [x1 / 1.5, y1 / 1.5];
		};
		const pts: number[][] = [];
		const per = Math.ceil(n / edges.length);
		for (const [a, b] of edges)
			for (let i = 0; i < per; i++) {
				const t = i / per;
				pts.push(proj([v[a][0] + (v[b][0] - v[a][0]) * t, v[a][1] + (v[b][1] - v[a][1]) * t, v[a][2] + (v[b][2] - v[a][2]) * t]));
			}
		return pts;
	}

	function ringPoints(n: number): number[][] {
		const pts: number[][] = [];
		for (let i = 0; i < n; i++) {
			const inner = i % 2 === 0;
			const t = (i / n) * Math.PI * 2 * (inner ? 2 : 1);
			const r = inner ? 0.55 : 1;
			pts.push([Math.cos(t) * r, Math.sin(t) * r * 0.92]);
		}
		return pts;
	}

	function infinityPoints(n: number): number[][] {
		const pts: number[][] = [];
		for (let i = 0; i < n; i++) {
			const t = (i / n) * Math.PI * 2;
			const d = 1 + Math.sin(t) * Math.sin(t);
			pts.push([(Math.cos(t) / d) * 1.25, ((Math.sin(t) * Math.cos(t)) / d) * 1.25]);
		}
		return pts;
	}

	const SHAPES: { name: string; points: number[][] }[] = [
		{ name: "heart", points: heartPoints(160) },
		{ name: "cube", points: cubePoints(160) },
		{ name: "star", points: starPoints(160) },
		{ name: "rings", points: ringPoints(160) },
		{ name: "infinity", points: infinityPoints(160) },
	];

	// 各阶段时长（秒）：一个"水母脉冲"周期约 9s
	const PHASE_DUR: Record<Phase, number> = {
		gather: 1.1,
		cruise: 2.6,
		unfold: 1.8,
		hold: 2.6,
		dissolve: 1.3,
	};

	onMount(() => {
		const canvas = canvasEl;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let w = 0;
		let h = 0;
		let dpr = 1;
		let raf = 0;
		let lastT = performance.now();
		let elapsed = 0;

		// ---- 群体状态 ----
		const particles: P[] = [];
		let phase: Phase = "gather";
		let phaseT = 0; // 当前阶段已进行时长
		let hx = 0; // 头部（水母伞心）世界坐标
		let hy = 0;
		let dirX = 1; // 冲刺方向
		let dirY = 0;
		let shapeIdx = 0; // 当前展开的图形
		let shapeRot = 0; // 图形缓旋
		let pulse = 0; // 冲刺时的能量脉冲（光晕增强）

		// 指针牵引（弱化视差 + 冲刺方向偏置）
		let mx = 0;
		let my = 0;

		const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

		function makeParticle(): P {
			return {
				x: (Math.random() - 0.5) * 3,
				y: (Math.random() - 0.5) * 3,
				vx: 0,
				vy: 0,
				color: pick(HUES),
				size: 1.1 + Math.random() * 1.6,
				tw: Math.random() * Math.PI * 2,
				bright: Math.random() < 0.22,
				jx: (Math.random() - 0.5) * 0.05,
				jy: (Math.random() - 0.5) * 0.05,
				trailK: Math.pow(Math.random(), 1.6), // 越小的排越靠前
			};
		}

		function resize() {
			dpr = Math.min(window.devicePixelRatio || 1, 1.5);
			w = canvas.clientWidth;
			h = canvas.clientHeight;
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
			while (particles.length < PARTICLE_COUNT) particles.push(makeParticle());
		}

		// 世界 → 屏幕
		function scale() {
			return Math.min(w, h) * 0.24;
		}
		function toScreen(x: number, y: number): [number, number] {
			const s = scale();
			return [w / 2 + (x + mx * 0.18) * s, h / 2 + (y + my * 0.18) * s];
		}

		// 选择新的冲刺方向：随机为主，靠近边缘时偏向中心
		function chooseDirection() {
			let a = Math.random() * Math.PI * 2;
			// 头部偏离中心较多时，方向混入指向中心的分量
			const dist = Math.hypot(hx, hy);
			if (dist > 0.9) {
				const back = Math.atan2(-hy, -hx);
				a = a * 0.35 + back * 0.65;
			}
			// 指针位置轻微牵引
			a += mx * 0.3;
			dirX = Math.cos(a);
			dirY = Math.sin(a);
		}

		function nextPhase() {
			phaseT = 0;
			if (phase === "gather") {
				phase = "cruise";
				chooseDirection();
				pulse = 1;
			} else if (phase === "cruise") {
				phase = "unfold";
				shapeIdx = Math.floor(Math.random() * SHAPES.length);
			} else if (phase === "unfold") {
				phase = "hold";
			} else if (phase === "hold") {
				phase = "dissolve";
				// 飘散：给每个粒子一个外向初速度
				for (const p of particles) {
					const a = Math.random() * Math.PI * 2;
					const sp = 0.25 + Math.random() * 0.55;
					p.vx += Math.cos(a) * sp;
					p.vy += Math.sin(a) * sp;
				}
			} else {
				phase = "gather";
			}
		}

		// ---- 交互 ----
		function onPointerMove(e: PointerEvent) {
			mx = e.clientX / window.innerWidth - 0.5;
			my = e.clientY / window.innerHeight - 0.5;
		}
		function onPointerDown(e: PointerEvent) {
			const t = e.target;
			if (t instanceof Element && t.closest("a,button,#navbar-wrapper,input")) return;
			// 点击：立刻收缩并准备冲向点击位置（水母受激转向）
			const s = scale();
			hx = (e.clientX - w / 2) / s;
			hy = (e.clientY - h / 2) / s;
			phase = "gather";
			phaseT = 0;
			pulse = 1.2;
		}
		function onEnterWarp() {
			// 入场按钮：直接触发一次脉冲
			pulse = 1.5;
		}
		function onVisibility() {
			if (document.hidden) {
				cancelAnimationFrame(raf);
				raf = 0;
			} else if (!raf) {
				lastT = performance.now();
				raf = requestAnimationFrame(frame);
			}
		}

		window.addEventListener("resize", resize);
		window.addEventListener("pointermove", onPointerMove, { passive: true });
		window.addEventListener("pointerdown", onPointerDown, { passive: true });
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("galaxy:warp", onEnterWarp);
		resize();

		// ====================================================================
		// 每帧：行为 + 渲染
		// ====================================================================
		function frame(now: number) {
			const dt = Math.min((now - lastT) / 1000, 0.05);
			lastT = now;
			elapsed += dt;
			phaseT += dt;
			pulse *= Math.exp(-dt * 1.6);
			if (phaseT >= PHASE_DUR[phase]) nextPhase();

			const S = scale();
			const shape = SHAPES[shapeIdx].points;

			// ---- 头部运动 ----
			if (phase === "cruise") {
				// 火箭冲刺：速度先快后稳
				const sp = 0.9 + 0.35 * Math.sin((phaseT / PHASE_DUR.cruise) * Math.PI);
				hx += dirX * sp * dt;
				hy += dirY * sp * dt;
			} else if (phase === "gather") {
				// 收缩时头部轻微前冲（水母伞盖弹动）
				hx += dirX * 0.15 * dt;
				hy += dirY * 0.15 * dt;
			} else {
				// 展开/飘散：头部缓慢漂移
				hx += dirX * 0.06 * dt + mx * 0.05 * dt;
				hy += dirY * 0.06 * dt + my * 0.05 * dt;
			}
			// 软边界：超界轻推回中心
			hx -= hx * Math.max(0, Math.abs(hx) - 1.7) * dt * 2;
			hy -= hy * Math.max(0, Math.abs(hy) - 1.7) * dt * 2;

			shapeRot += dt * 0.22;

			// ---- 粒子行为 ----
			// 趋近速率：指数趋近，天然 dt 稳定
			const stiffness = phase === "gather" ? 5.5 : phase === "cruise" ? 8 : phase === "unfold" ? 6 : phase === "hold" ? 3.5 : 1.2;
			const rate = 1 - Math.exp(-dt * stiffness);
			const cosR = Math.cos(shapeRot);
			const sinR = Math.sin(shapeRot);

			for (let i = 0; i < particles.length; i++) {
				const p = particles[i];
				let tx = hx;
				let ty = hy;

				if (phase === "gather") {
					// 收成小球：球面随机偏移（每粒子固定的紧凑半径）
					const r = 0.1 + p.trailK * 0.22;
					const a = p.tw * 7;
					tx += Math.cos(a) * r;
					ty += Math.sin(a) * r;
				} else if (phase === "cruise") {
					// 彗尾：按 trailK 沿反方向拉开，横向加抖动
					const back = p.trailK * 1.1;
					const side = (p.jx + p.jy) * 14 * p.trailK;
					tx += -dirX * back + -dirY * side;
					ty += -dirY * back + dirX * side;
				} else if (phase === "unfold" || phase === "hold") {
					// 展开成图形：取图形点，缓旋 + 抖动，大小随阶段呼吸
					const pt = shape[i % shape.length];
					const breathe = 1 + 0.05 * Math.sin(elapsed * 1.6);
					const sx = pt[0] * breathe;
					const sy = pt[1] * breathe;
					tx += sx * cosR - sy * sinR + p.jx;
					ty += sx * sinR + sy * cosR + p.jy;
				}
				// dissolve：无目标，靠速度与阻尼自由飘散

				p.vx += (tx - p.x) * rate * 8 * dt;
				p.vy += (ty - p.y) * rate * 8 * dt;
				const damp = Math.exp(-dt * (phase === "dissolve" ? 0.8 : 3.2));
				p.vx *= damp;
				p.vy *= damp;
				p.x += p.vx * dt + (tx - p.x) * rate;
				p.y += p.vy * dt + (ty - p.y) * rate;
			}

			// ====================================================================
			// 渲染
			// ====================================================================
			// 拖影：冲刺阶段用更低的覆盖透明度，拉出长光轨
			const fade = phase === "cruise" ? 0.14 : phase === "gather" ? 0.2 : 0.26;
			ctx!.globalCompositeOperation = "source-over";
			ctx!.fillStyle = `rgba(1, 3, 10, ${fade})`;
			ctx!.fillRect(0, 0, w, h);

			ctx!.globalCompositeOperation = "lighter";

			// 头部能量光球（水母伞心）：聚集/冲刺时最亮
			const [hsx, hsy] = toScreen(hx, hy);
			const headGlow = phase === "gather" || phase === "cruise" ? 1 : phase === "unfold" ? 0.8 : 0.45;
			const hr = S * (0.16 + pulse * 0.1);
			const hg = ctx!.createRadialGradient(hsx, hsy, 0, hsx, hsy, hr);
			hg.addColorStop(0, `rgba(255,255,255,${0.85 * headGlow})`);
			hg.addColorStop(0.25, `rgba(186,230,253,${0.5 * headGlow})`);
			hg.addColorStop(0.6, `rgba(56,189,248,${0.18 * headGlow})`);
			hg.addColorStop(1, "rgba(56,189,248,0)");
			ctx!.fillStyle = hg;
			ctx!.beginPath();
			ctx!.arc(hsx, hsy, hr, 0, Math.PI * 2);
			ctx!.fill();

			// 冲刺光束：从头部向后拖 2 条亮线
			if (phase === "cruise") {
				ctx!.strokeStyle = "rgba(224,242,254,0.5)";
				ctx!.lineWidth = 1.5;
				for (const off of [-0.06, 0.06]) {
					const [x1, y1] = toScreen(hx - dirY * off, hy + dirX * off);
					const [x2, y2] = toScreen(hx - dirX * 1.1 - dirY * off, hy - dirY * 1.1 + dirX * off);
					ctx!.beginPath();
					ctx!.moveTo(x1, y1);
					ctx!.lineTo(x2, y2);
					ctx!.stroke();
				}
			}

			// 粒子
			for (const p of particles) {
				const [sx, sy] = toScreen(p.x, p.y);
				if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
				const twinkle = 0.65 + 0.35 * Math.sin(elapsed * 3.5 + p.tw);
				// 图形展开阶段整体提亮（伞盖张开时最绚丽）
				const phaseBoost = phase === "unfold" || phase === "hold" ? 1 : 0.8;
				const alpha = twinkle * phaseBoost;
				if (p.bright) {
					ctx!.shadowColor = p.color;
					ctx!.shadowBlur = 10;
				}
				ctx!.globalAlpha = alpha;
				ctx!.fillStyle = p.color;
				ctx!.beginPath();
				ctx!.arc(sx, sy, p.size, 0, Math.PI * 2);
				ctx!.fill();
				ctx!.shadowBlur = 0;
			}
			ctx!.globalAlpha = 1;
			ctx!.globalCompositeOperation = "source-over";

			raf = requestAnimationFrame(frame);
		}
		// 首帧前先铺一次纯底色，避免透明残影
		ctx.fillStyle = "#01030a";
		ctx.fillRect(0, 0, w, h);
		raf = requestAnimationFrame(frame);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", resize);
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("galaxy:warp", onEnterWarp);
		};
	});
</script>

<canvas bind:this={canvasEl} class="galaxy-canvas" aria-hidden="true"></canvas>

<style>
	.galaxy-canvas {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		display: block;
		cursor: crosshair;
	}
</style>
