<script lang="ts">
	import { onMount } from "svelte";

	// ====================================================================
	// 数字星河 · 3D 粒子变形引擎
	// 灵感来自热门 "python星际轨道" 视频：发光粒子构成立体图形，
	// 爱心 → 蝴蝶 → 火箭 循环变形；火箭成形后会带拖尾飞行一段再散开。
	// 交互：指针视差旋转视角；点击任意处立即散开并切换下一个图形。
	// ====================================================================

	let canvasEl: HTMLCanvasElement;

	// 蓝白全息色板（与视频一致：蓝为主，白为芯）
	const HUES = ["#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#818cf8", "#a78bfa"];
	const PARTICLE_COUNT = 900;

	type Phase = "form" | "hold" | "scatter";

	interface P {
		x: number;
		y: number;
		z: number;
		vx: number;
		vy: number;
		vz: number;
		color: string;
		size: number;
		tw: number;
		bright: boolean;
	}

	// ---------------- 3D 图形点云（单位空间，约 -1~1） ----------------

	// 经典 3D 爱心隐式曲面：(x²+9/4z²+y²-1)³ - x²y³ - 9/80·z²y³ < 0
	function heartPoints(n: number): number[][] {
		const pts: number[][] = [];
		let guard = 0;
		while (pts.length < n && guard++ < n * 200) {
			const x = (Math.random() * 2 - 1) * 1.3;
			const y = (Math.random() * 2 - 1) * 1.3;
			const z = (Math.random() * 2 - 1) * 1.3;
			const a = x * x + (9 / 4) * z * z + y * y - 1;
			const f = a * a * a - x * x * y * y * y - (9 / 80) * z * z * y * y * y;
			// 只保留贴近曲面的点（壳层），形成轮廓感
			if (f < 0.02 && f > -0.12) pts.push([x / 1.3, y / 1.3, z / 1.3]);
		}
		return pts;
	}

	// 蝴蝶参数曲线（经典 butterfly curve），加轻微厚度
	function butterflyPoints(n: number): number[][] {
		const pts: number[][] = [];
		for (let i = 0; i < n; i++) {
			const t = (i / n) * Math.PI * 12;
			const f = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) - Math.pow(Math.sin(t / 12), 5);
			const x = Math.sin(t) * f;
			const y = Math.cos(t) * f;
			pts.push([x / 3.4 + (Math.random() - 0.5) * 0.06, -y / 3.4 + (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.14]);
		}
		return pts;
	}

	// 火箭：圆锥头部 + 圆柱箭体 + 四片尾翼，机头朝 +X
	function rocketPoints(n: number): number[][] {
		const pts: number[][] = [];
		const put = (x: number, y: number, z: number) => pts.push([x, y, z]);
		const surface = (count: number, fn: (u: number, v: number) => number[]) => {
			for (let i = 0; i < count; i++) fn(Math.random(), Math.random());
		};
		const nb = Math.floor(n * 0.16); // 头锥
		const ny = Math.floor(n * 0.5); // 箭体
		const nf = Math.floor(n * 0.26); // 尾翼
		const nw = n - nb - ny - nf; // 舷窗
		// 头锥：x 0.45→0.95，半径 0.22→0
		surface(nb, (u, v) => {
			const x = 0.45 + u * 0.5;
			const r = 0.22 * (1 - u);
			const a = v * Math.PI * 2;
			put(x, Math.cos(a) * r, Math.sin(a) * r);
		});
		// 箭体：x -0.55→0.45，半径 0.22
		surface(ny, (u, v) => {
			const x = -0.55 + u * 1.0;
			const a = v * Math.PI * 2;
			put(x, Math.cos(a) * 0.22, Math.sin(a) * 0.22);
		});
		// 尾翼：四片三角翼面
		surface(nf, (u, v) => {
			const wing = Math.floor(u * 4);
			const a0 = (wing / 4) * Math.PI * 2;
			const r = 0.22 + v * 0.3;
			const x = -0.55 + v * 0.25;
			put(x, Math.cos(a0) * r, Math.sin(a0) * r);
		});
		// 舷窗：前部小圆环
		surface(nw, (u) => {
			const a = u * Math.PI * 2;
			put(0.15, Math.cos(a) * 0.225, Math.sin(a) * 0.225);
		});
		return pts;
	}

	// 图形表：火箭标记 fly=true（成形后带拖尾飞行）
	const SHAPES: { name: string; points: number[][]; fly?: boolean }[] = [
		{ name: "heart", points: [] },
		{ name: "butterfly", points: [] },
		{ name: "rocket", points: [], fly: true },
	];

	onMount(() => {
		const canvas = canvasEl;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// 屏幕就绪后生成点云（避免 SSR 阶段无谓计算）
		SHAPES[0].points = heartPoints(420);
		SHAPES[1].points = butterflyPoints(420);
		SHAPES[2].points = rocketPoints(420);

		let w = 0;
		let h = 0;
		let dpr = 1;
		let raf = 0;
		let lastT = performance.now();
		let elapsed = 0;

		const particles: P[] = [];
		let phase: Phase = "form";
		let phaseT = 0;
		let shapeIdx = 0;
		let rotY = 0; // 图形自转
		let rotX = -0.25; // 基础倾角
		// 火箭飞行状态
		let flyX = 0;
		let flyY = 0;
		let flyDX = 1;
		let flyDY = 0;
		// 指针视差
		let mx = 0;
		let my = 0;

		const PHASE_DUR: Record<Phase, number> = { form: 2.2, hold: 5.5, scatter: 1.4 };

		const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

		function makeParticle(): P {
			return {
				x: (Math.random() - 0.5) * 4,
				y: (Math.random() - 0.5) * 4,
				z: (Math.random() - 0.5) * 4,
				vx: 0,
				vy: 0,
				vz: 0,
				color: pick(HUES),
				size: 0.9 + Math.random() * 1.5,
				tw: Math.random() * Math.PI * 2,
				bright: Math.random() < 0.22,
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

		function nextPhase() {
			phaseT = 0;
			if (phase === "form") {
				phase = "hold";
				if (SHAPES[shapeIdx].fly) {
					// 火箭：选定飞行方向（避开当前位置指向界外）
					let a = Math.random() * Math.PI * 2;
					if (Math.hypot(flyX, flyY) > 0.8) a = Math.atan2(-flyY, -flyX) + (Math.random() - 0.5) * 0.8;
					flyDX = Math.cos(a);
					flyDY = Math.sin(a);
				}
			} else if (phase === "hold") {
				phase = "scatter";
				// 散开：外向爆发初速度
				for (const p of particles) {
					const a = Math.random() * Math.PI * 2;
					const b = Math.random() * Math.PI * 2;
					const sp = 0.5 + Math.random() * 0.9;
					p.vx += Math.cos(a) * Math.cos(b) * sp;
					p.vy += Math.sin(a) * sp;
					p.vz += Math.cos(a) * Math.sin(b) * sp;
				}
			} else {
				phase = "form";
				shapeIdx = (shapeIdx + 1) % SHAPES.length;
				flyX = 0;
				flyY = 0;
			}
		}

		function onPointerMove(e: PointerEvent) {
			mx = e.clientX / window.innerWidth - 0.5;
			my = e.clientY / window.innerHeight - 0.5;
		}
		function onPointerDown(e: PointerEvent) {
			const t = e.target;
			if (t instanceof Element && t.closest("a,button,#navbar-wrapper,input")) return;
			// 点击：立即散开并跳到下一图形
			if (phase !== "scatter") {
				phase = "hold";
				nextPhase();
			}
		}
		function onEnterWarp() {
			if (phase === "form") {
				phaseT = PHASE_DUR.form;
			}
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

		function frame(now: number) {
			const dt = Math.min((now - lastT) / 1000, 0.05);
			lastT = now;
			elapsed += dt;
			phaseT += dt;
			if (phaseT >= PHASE_DUR[phase]) nextPhase();

			const S = Math.min(w, h) * 0.21;
			const shape = SHAPES[shapeIdx];
			const pts = shape.points;

			// 自转：成形与展示阶段持续绕 Y 旋转，散开时停
			if (phase !== "scatter") rotY += dt * 0.45;
			const cosY = Math.cos(rotY);
			const sinY = Math.sin(rotY);
			const cosX = Math.cos(rotX);
			const sinX = Math.sin(rotX);

			// 火箭展示期飞行
			if (phase === "hold" && shape.fly) {
				const sp = 0.55 + 0.3 * Math.sin((phaseT / PHASE_DUR.hold) * Math.PI);
				flyX += flyDX * sp * dt;
				flyY += flyDY * sp * dt;
			}

			// 趋近刚度
			const stiffness = phase === "form" ? 6.5 : phase === "hold" ? 8 : 1.4;
			const rate = 1 - Math.exp(-dt * stiffness);
			const damp = Math.exp(-dt * (phase === "scatter" ? 1.1 : 4.2));

			for (let i = 0; i < particles.length; i++) {
				const p = particles[i];
				let tx = 0;
				let ty = 0;
				let tz = 0;

				if (phase !== "scatter") {
					const pt = pts[i % pts.length];
					// 目标点：绕 Y 自转 + 绕 X 倾角
					const x1 = pt[0] * cosY + pt[2] * sinY;
					const z1 = -pt[0] * sinY + pt[2] * cosY;
					const y1 = pt[1] * cosX - z1 * sinX;
					const z2 = pt[1] * sinX + z1 * cosX;
					tx = x1 + flyX;
					ty = y1 + flyY;
					tz = z2;
					p.vx += (tx - p.x) * rate * 6 * dt;
					p.vy += (ty - p.y) * rate * 6 * dt;
					p.vz += (tz - p.z) * rate * 6 * dt;
				}
				p.vx *= damp;
				p.vy *= damp;
				p.vz *= damp;
				p.x += p.vx * dt + (phase === "scatter" ? 0 : (tx - p.x) * rate);
				p.y += p.vy * dt + (phase === "scatter" ? 0 : (ty - p.y) * rate);
				p.z += p.vz * dt + (phase === "scatter" ? 0 : (tz - p.z) * rate);
			}

			// ====================================================================
			// 渲染
			// ====================================================================
			// 拖影：火箭飞行时拉更长光轨
			const flying = phase === "hold" && shape.fly;
			ctx!.globalCompositeOperation = "source-over";
			ctx!.fillStyle = `rgba(1, 3, 10, ${flying ? 0.12 : phase === "scatter" ? 0.3 : 0.24})`;
			ctx!.fillRect(0, 0, w, h);

			ctx!.globalCompositeOperation = "lighter";
			// 相机视差倾角
			const camY = mx * 0.5;
			const camX = my * 0.35;
			const ccY = Math.cos(camY);
			const csY = Math.sin(camY);
			const ccX = Math.cos(camX);
			const csX = Math.sin(camX);

			for (const p of particles) {
				// 相机旋转 + 透视投影
				const x1 = p.x * ccY + p.z * csY;
				const z1 = -p.x * csY + p.z * ccY;
				const y1 = p.y * ccX - z1 * csX;
				const z2 = p.y * csX + z1 * ccX;
				const persp = 2.8 / (2.8 + z2);
				const sx = w / 2 + x1 * persp * S;
				const sy = h / 2 + y1 * persp * S;
				if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;

				const twinkle = 0.6 + 0.4 * Math.sin(elapsed * 3.2 + p.tw);
				const depthBoost = Math.min(1.2, persp);
				ctx!.globalAlpha = Math.min(1, twinkle * depthBoost + 0.08);
				if (p.bright) {
					ctx!.shadowColor = p.color;
					ctx!.shadowBlur = 9;
				}
				ctx!.fillStyle = p.color;
				ctx!.beginPath();
				ctx!.arc(sx, sy, p.size * persp, 0, Math.PI * 2);
				ctx!.fill();
				ctx!.shadowBlur = 0;
			}
			ctx!.globalAlpha = 1;
			ctx!.globalCompositeOperation = "source-over";

			raf = requestAnimationFrame(frame);
		}
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
