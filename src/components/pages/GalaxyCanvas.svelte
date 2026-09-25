<script lang="ts">
	import { onMount } from "svelte";

	// ====================================================================
	// 数字星河 · Canvas 2D 粒子引擎
	// 场景一：代码字符组成的 3D 星尘冲向镜头（数字星河穿梭）
	// 场景二：发光行星沿"代码字符轨道"环绕运行（以代码为轨）
	// 交互：指针视差操控航向 + 点击星尘爆发 + 曲速冲刺
	// ====================================================================

	let canvasEl: HTMLCanvasElement;

	// 字符集：代码符号 + 数字，少量中文星象字
	const CODE_GLYPHS = "01{}[]<>/\\|=+*#$%&:;?^~".split("");
	const CN_GLYPHS = ["星", "河", "轨", "道", "代", "码", "灵", "辰", "乾", "坤"];
	// 低饱和青蓝紫色板，贴合站点靛蓝主色
	const PALETTE = ["#67e8f9", "#38bdf8", "#818cf8", "#a78bfa", "#e879f9", "#e2e8f0"];

	interface Star {
		x: number; // 横向世界坐标 -1~1
		y: number;
		z: number; // 深度 1(远) ~ 0.12(近)
		char: string;
		color: string;
		phase: number; // 闪烁相位
		bright: boolean; // 高亮字符（少量，带辉光）
	}

	interface Burst {
		x: number;
		y: number;
		vx: number;
		vy: number;
		life: number; // 剩余生命 0~1
		size: number;
		color: string;
	}

	interface Ring {
		radiusK: number; // 轨道半径占 min(w,h) 的比例
		tilt: number; // 绕 X 轴倾角（产生椭圆透视）
		speed: number; // 字符流动角速度
		orbitSpeed: number; // 行星公转角速度
		glyphCount: number;
		ringColor: string;
		planetColor: string;
		planetR: number; // 行星半径 px
		phase: number; // 行星初始角
	}

	// 三条代码轨道，由内到外
	const RINGS: Ring[] = [
		{ radiusK: 0.16, tilt: 0.55, speed: 0.16, orbitSpeed: 0.22, glyphCount: 20, ringColor: "#67e8f9", planetColor: "#7dd3fc", planetR: 9, phase: 0.4 },
		{ radiusK: 0.28, tilt: 0.7, speed: -0.11, orbitSpeed: -0.14, glyphCount: 28, ringColor: "#818cf8", planetColor: "#a5b4fc", planetR: 12, phase: 2.4 },
		{ radiusK: 0.42, tilt: 0.48, speed: 0.08, orbitSpeed: 0.09, glyphCount: 36, ringColor: "#c084fc", planetColor: "#d8b4fe", planetR: 15, phase: 4.4 },
	];

	const FOCAL = 1; // 透视焦距（深度归一化单位）
	const RING_DEPTH = 0.92; // 轨道环中心所在深度
	const NEAR_Z = 0.12;

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

		// ---- 状态 ----
		let stars: Star[] = [];
		const bursts: Burst[] = [];
		// 指针视差（归一化 -0.5~0.5），target 为目标值，cur 平滑跟随
		let mxTarget = 0;
		let myTarget = 0;
		let mxCur = 0;
		let myCur = 0;
		let warp = 0; // 曲速冲刺强度，指数衰减

		const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

		function makeStar(atFar: boolean): Star {
			return {
				x: Math.random() * 2 - 1,
				y: Math.random() * 2 - 1,
				z: atFar ? 0.85 + Math.random() * 0.15 : NEAR_Z + Math.random() * 0.85,
				char: Math.random() < 0.12 ? pick(CN_GLYPHS) : pick(CODE_GLYPHS),
				color: pick(PALETTE),
				phase: Math.random() * Math.PI * 2,
				bright: Math.random() < 0.12,
			};
		}

		function resize() {
			dpr = Math.min(window.devicePixelRatio || 1, 1.5);
			w = canvas.clientWidth;
			h = canvas.clientHeight;
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
			// 粒子数量随屏幕面积伸缩，移动端自动减量
			const target = Math.max(130, Math.min(380, Math.round((w * h) / 3200)));
			if (stars.length < target) {
				while (stars.length < target) stars.push(makeStar(false));
			} else {
				stars.length = target;
			}
		}

		// ---- 交互 ----
		function onPointerMove(e: PointerEvent) {
			mxTarget = e.clientX / window.innerWidth - 0.5;
			myTarget = e.clientY / window.innerHeight - 0.5;
		}
		function onPointerDown(e: PointerEvent) {
			// 点导航栏 / 按钮不触发爆发
			const t = e.target;
			if (t instanceof Element && t.closest("a,button,#navbar-wrapper,input")) return;
			warp = Math.min(warp + 1.6, 2.4);
			// 星尘爆发：26 个屏幕空间粒子向外扩散
			for (let i = 0; i < 26; i++) {
				const a = Math.random() * Math.PI * 2;
				const sp = 60 + Math.random() * 260;
				bursts.push({
					x: e.clientX,
					y: e.clientY,
					vx: Math.cos(a) * sp,
					vy: Math.sin(a) * sp,
					life: 1,
					size: 8 + Math.random() * 12,
					color: pick(PALETTE),
				});
			}
			if (bursts.length > 120) bursts.splice(0, bursts.length - 120);
		}
		// "进入星河"按钮触发曲速冲刺（由页面派发自定义事件）
		function onEnterWarp() {
			warp = 2.6;
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
		// 渲染
		// ====================================================================
		function drawBackground() {
			ctx!.fillStyle = "#05060f";
			ctx!.fillRect(0, 0, w, h);
			// 中心银河核心：缓慢呼吸的双色径向辉光
			const cx = w / 2 - mxCur * w * 0.03;
			const cy = h / 2 - myCur * h * 0.03;
			const breathe = 1 + 0.06 * Math.sin(elapsed * 0.8);
			const coreR = Math.min(w, h) * 0.55 * breathe;
			const g = ctx!.createRadialGradient(cx, cy, 0, cx, cy, coreR);
			g.addColorStop(0, "rgba(99,102,241,0.20)");
			g.addColorStop(0.45, "rgba(56,189,248,0.08)");
			g.addColorStop(1, "rgba(5,6,15,0)");
			ctx!.fillStyle = g;
			ctx!.fillRect(0, 0, w, h);
		}

		// 透视投影：世界坐标 → 屏幕坐标
		function project(wx: number, wy: number, z: number): [number, number] {
			const s = FOCAL / z;
			return [w / 2 + (wx * s * w) / 2 - mxCur * w * 0.1 * (1 / z - 0.55), h / 2 + (wy * s * h) / 2 - myCur * h * 0.1 * (1 / z - 0.55)];
		}

		function drawStars(dt: number) {
			ctx!.globalCompositeOperation = "lighter";
			const speed = (0.16 + warp * 0.22) * dt;
			for (const s of stars) {
				const prevZ = s.z;
				s.z -= speed;
				if (s.z < NEAR_Z) {
					// 冲出镜头 → 回到星河深处
					Object.assign(s, makeStar(true));
					continue;
				}
				const [sx, sy] = project(s.x, s.y, s.z);
				// 跳过屏幕外粒子
				if (sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) continue;

				const depth = 1 - s.z; // 越近越大
				const twinkle = 0.72 + 0.28 * Math.sin(elapsed * 3 + s.phase);
				const alpha = Math.min(1, 0.14 + depth * 1.05) * twinkle;
				const size = 9 + depth * 34;

				// 拖尾：从上一深度位置连到当前，曲速越快拖尾越长
				const trailZ = Math.min(1, prevZ + speed * (1.5 + warp));
				const [tx, ty] = project(s.x, s.y, trailZ);
				ctx!.strokeStyle = s.color;
				ctx!.globalAlpha = alpha * 0.45;
				ctx!.lineWidth = 1 + depth * 1.2;
				ctx!.beginPath();
				ctx!.moveTo(tx, ty);
				ctx!.lineTo(sx, sy);
				ctx!.stroke();

				// 字符本体（少量高亮字符带 shadowBlur 辉光）
				ctx!.font = `${Math.round(size * 0.62)}px ui-monospace,"JetBrains Mono",Consolas,monospace`;
				ctx!.textAlign = "center";
				ctx!.textBaseline = "middle";
				if (s.bright) {
					ctx!.shadowColor = s.color;
					ctx!.shadowBlur = 12;
				}
				ctx!.globalAlpha = alpha;
				ctx!.fillStyle = s.color;
				ctx!.fillText(s.char, sx, sy);
				ctx!.shadowBlur = 0;
			}
			ctx!.globalAlpha = 1;
			ctx!.globalCompositeOperation = "source-over";
		}

		// 轨道环上某角度的 3D 点（px 坐标 + 深度）
		function ringPoint(ring: Ring, angle: number): [number, number, number] {
			const r = Math.min(w, h) * ring.radiusK;
			const X = Math.cos(angle) * r;
			const Y0 = Math.sin(angle) * r;
			const Y = Y0 * Math.cos(ring.tilt);
			const z = RING_DEPTH + (Y0 * Math.sin(ring.tilt)) / r * 0.5;
			const s = FOCAL / z;
			const sx = w / 2 + X * s - mxCur * w * 0.05;
			const sy = h / 2 + Y * s - myCur * h * 0.05;
			return [sx, sy, z];
		}

		function drawRings() {
			ctx!.globalCompositeOperation = "lighter";
			for (const ring of RINGS) {
				// 代码字符轨道：字符沿椭圆流动，按深度明暗
				const pts: Array<[number, number, number]> = [];
				for (let i = 0; i < ring.glyphCount; i++) {
					const a = (i / ring.glyphCount) * Math.PI * 2 + elapsed * ring.speed;
					pts.push(ringPoint(ring, a));
				}
				// 轨道轮廓：相邻字符锚点连淡线
				ctx!.strokeStyle = ring.ringColor;
				ctx!.globalAlpha = 0.14;
				ctx!.lineWidth = 1;
				ctx!.beginPath();
				pts.forEach(([x, y], i) => {
					if (i === 0) ctx!.moveTo(x, y);
					else ctx!.lineTo(x, y);
				});
				ctx!.closePath();
				ctx!.stroke();

				ctx!.font = '12px ui-monospace,"JetBrains Mono",Consolas,monospace';
				ctx!.textAlign = "center";
				ctx!.textBaseline = "middle";
				pts.forEach(([x, y, z], i) => {
					if (x < -30 || x > w + 30 || y < -30 || y > h + 30) return;
					const alpha = Math.max(0.1, Math.min(0.85, 1.35 - z));
					ctx!.globalAlpha = alpha * 0.9;
					ctx!.fillStyle = ring.ringColor;
					// 每 3 个锚点换一个字符，形成流动的代码流
					const ch = CODE_GLYPHS[(i + Math.floor(elapsed * 6 * Math.abs(ring.speed))) % CODE_GLYPHS.length];
					ctx!.fillText(ch, x, y);
				});

				// 行星：沿轨道公转，径向渐变画发光球体
				const pa = elapsed * ring.orbitSpeed + ring.phase;
				const [px, py, pz] = ringPoint(ring, pa);
				const pr = ring.planetR / pz;
				const halo = pr * 3.2;
				const pg = ctx!.createRadialGradient(px, py, 0, px, py, halo);
				pg.addColorStop(0, "#ffffff");
				pg.addColorStop(0.28, ring.planetColor);
				pg.addColorStop(0.6, ring.planetColor + "55");
				pg.addColorStop(1, ring.planetColor + "00");
				ctx!.globalAlpha = Math.max(0.35, Math.min(1, 1.4 - pz));
				ctx!.fillStyle = pg;
				ctx!.beginPath();
				ctx!.arc(px, py, halo, 0, Math.PI * 2);
				ctx!.fill();
			}
			ctx!.globalAlpha = 1;
			ctx!.globalCompositeOperation = "source-over";
		}

		function drawBursts(dt: number) {
			ctx!.globalCompositeOperation = "lighter";
			for (let i = bursts.length - 1; i >= 0; i--) {
				const b = bursts[i];
				b.life -= dt * 1.25;
				if (b.life <= 0) {
					bursts.splice(i, 1);
					continue;
				}
				b.x += b.vx * dt;
				b.y += b.vy * dt;
				b.vx *= 1 - dt * 1.8;
				b.vy *= 1 - dt * 1.8;
				ctx!.globalAlpha = b.life;
				ctx!.font = `${Math.round(b.size * b.life)}px ui-monospace,"JetBrains Mono",Consolas,monospace`;
				ctx!.textAlign = "center";
				ctx!.textBaseline = "middle";
				ctx!.shadowColor = b.color;
				ctx!.shadowBlur = 10;
				ctx!.fillStyle = b.color;
				ctx!.fillText(pick(CODE_GLYPHS), b.x, b.y);
				ctx!.shadowBlur = 0;
			}
			ctx!.globalAlpha = 1;
			ctx!.globalCompositeOperation = "source-over";
		}

		function frame(now: number) {
			const dt = Math.min((now - lastT) / 1000, 0.05);
			lastT = now;
			elapsed += dt;
			warp *= Math.exp(-dt * 1.5); // 曲速自然衰减
			mxCur += (mxTarget - mxCur) * Math.min(1, dt * 4);
			myCur += (myTarget - myCur) * Math.min(1, dt * 4);

			drawBackground();
			drawStars(dt);
			drawRings();
			drawBursts(dt);
			raf = requestAnimationFrame(frame);
		}
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
