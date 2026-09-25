<script lang="ts">
	import { onMount } from "svelte";

	// ====================================================================
	// 数字星河 · 3D 全息光效引擎（Canvas 2D 软投影）
	// 场景：中央能量球 + 多层涡旋光带 + 立体几何粒子 + 星芒 + 光束
	// 配色：冷冽蓝白紫全息（#38bdf8 #818cf8 #a78bfa #e0f2fe）
	// 交互：指针视差旋转镜头 + 点击能量脉冲 + 曲速冲刺
	// ====================================================================

	let canvasEl: HTMLCanvasElement;

	// 全息蓝色板
	const HUES = ["#38bdf8", "#818cf8", "#a78bfa", "#c084fc", "#e0f2fe", "#67e8f9"];
	const GEO_SHAPES = ["cube", "tetra", "octa", "ring", "star"] as const;
	type GeoShape = (typeof GEO_SHAPES)[number];

	interface Particle3D {
		// 球坐标
		theta: number; // 方位角
		phi: number; // 极角
		radius: number; // 到核心距离（世界单位）
		speed: number; // 自转速度
		shape: GeoShape;
		size: number;
		color: string;
		phase: number; // 闪烁相位
		bright: boolean;
	}

	interface RingParticle {
		theta: number;
		radius: number;
		speed: number;
		size: number;
		color: string;
		phase: number;
	}

	interface Beam {
		x1: number; y1: number;
		x2: number; y2: number;
		life: number;
		width: number;
		color: string;
	}

	interface Spark {
		x: number; y: number;
		vx: number; vy: number;
		life: number;
		size: number;
		color: string;
		shape: GeoShape;
	}

	onMount(() => {
		const canvas = canvasEl;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let w = 0, h = 0, dpr = 1;
		let raf = 0;
		let lastT = performance.now();
		let elapsed = 0;

		// ---- 状态 ----
		const coreParticles: Particle3D[] = [];
		const ringParticles: RingParticle[] = [];
		const beams: Beam[] = [];
		const sparks: Spark[] = [];

		// 镜头视差
		let camX = 0, camY = 0, camZ = 0;
		let camTargetX = 0, camTargetY = 0;
		let warp = 0;

		// 核心球参数
		const CORE_R = 1.0;
		const CORE_PARTICLES = 400;
		const RING_COUNT = 6;
		const RING_PARTICLES_PER = 200;
		const FOCAL = 1.5;

		const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

		function makeCoreParticle(): Particle3D {
			// 均匀球面分布
			const u = Math.random();
			const v = Math.random();
			const theta = 2 * Math.PI * u;
			const phi = Math.acos(2 * v - 1);
			return {
				theta,
				phi,
				radius: CORE_R + (Math.random() - 0.5) * 0.15,
				speed: 0.1 + Math.random() * 0.2,
				shape: pick(GEO_SHAPES),
				size: 10 + Math.random() * 16,
				color: pick(HUES),
				phase: Math.random() * Math.PI * 2,
				bright: Math.random() < 0.4,
			};
		}

		function makeRingParticle(ringIdx: number): RingParticle {
			const baseR = 1.2 + ringIdx * 0.45;
			return {
				theta: Math.random() * Math.PI * 2,
				radius: baseR + (Math.random() - 0.5) * 0.25,
				speed: (0.08 + Math.random() * 0.12) * (ringIdx % 2 === 0 ? 1 : -1),
				size: 6 + Math.random() * 8,
				color: pick(HUES),
				phase: Math.random() * Math.PI * 2,
			};
		}

		function spawnBeam() {
			// 随机方向的光束
			const angle = Math.random() * Math.PI * 2;
			const len = Math.max(w, h) * (0.3 + Math.random() * 0.4);
			const cx = w / 2 + (Math.random() - 0.5) * w * 0.3;
			const cy = h / 2 + (Math.random() - 0.5) * h * 0.3;
			beams.push({
				x1: cx - Math.cos(angle) * len / 2,
				y1: cy - Math.sin(angle) * len / 2,
				x2: cx + Math.cos(angle) * len / 2,
				y2: cy + Math.sin(angle) * len / 2,
				life: 1,
				width: 1 + Math.random() * 2,
				color: pick(HUES),
			});
			if (beams.length > 8) beams.shift();
		}

		function spawnSparkBurst(x: number, y: number) {
			for (let i = 0; i < 32; i++) {
				const a = Math.random() * Math.PI * 2;
				const sp = 80 + Math.random() * 320;
				sparks.push({
					x, y,
					vx: Math.cos(a) * sp,
					vy: Math.sin(a) * sp,
					life: 1,
					size: 2 + Math.random() * 4,
					color: pick(HUES),
					shape: pick(GEO_SHAPES),
				});
			}
			if (sparks.length > 100) sparks.splice(0, sparks.length - 100);
		}

		function resize() {
			dpr = Math.min(window.devicePixelRatio || 1, 1.5);
			w = canvas.clientWidth;
			h = canvas.clientHeight;
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
			// 初始化粒子
			if (coreParticles.length === 0) {
				for (let i = 0; i < CORE_PARTICLES; i++) coreParticles.push(makeCoreParticle());
				for (let r = 0; r < RING_COUNT; r++) {
					for (let i = 0; i < RING_PARTICLES_PER; i++) ringParticles.push(makeRingParticle(r));
				}
			}
		}

		function onPointerMove(e: PointerEvent) {
			camTargetX = (e.clientX / window.innerWidth - 0.5) * 0.6;
			camTargetY = (e.clientY / window.innerHeight - 0.5) * 0.4;
		}
		function onPointerDown(e: PointerEvent) {
			const t = e.target;
			if (t instanceof Element && t.closest("a,button,#navbar-wrapper,input")) return;
			warp = Math.min(warp + 2.0, 3.0);
			spawnSparkBurst(e.clientX, e.clientY);
			spawnBeam();
		}
		function onEnterWarp() {
			warp = 3.5;
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
		// 3D 投影
		// ====================================================================
		function project(x: number, y: number, z: number): [number, number, number] {
			// 绕 Y 轴旋转（镜头水平视差）
			const cosY = Math.cos(camX);
			const sinY = Math.sin(camX);
			const rx = x * cosY - z * sinY;
			const rz = x * sinY + z * cosY;
			// 绕 X 轴旋转（镜头垂直视差）
			const cosX = Math.cos(camY);
			const sinX = Math.sin(camY);
			const ry = y * cosX - rz * sinX;
			const rz2 = y * sinX + rz * cosX;
			// 透视
			const s = FOCAL / (FOCAL + rz2);
			return [w / 2 + rx * s * w * 0.5, h / 2 + ry * s * h * 0.5, s];
		}

		// 球坐标 → 笛卡尔
		function sph2cart(theta: number, phi: number, r: number): [number, number, number] {
			return [r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
		}

		// ====================================================================
		// 绘制几何体
		// ====================================================================
		function drawShape(shape: GeoShape, x: number, y: number, size: number, color: string, alpha: number, rotation: number) {
			ctx!.save();
			ctx!.translate(x, y);
			ctx!.rotate(rotation);
			ctx!.globalAlpha = alpha;
			ctx!.strokeStyle = color;
			ctx!.lineWidth = 1;
			ctx!.fillStyle = color;

			switch (shape) {
				case "cube": {
					// 等轴测立方体
					const s = size * 0.6;
					ctx!.beginPath();
					ctx!.moveTo(0, -s);
					ctx!.lineTo(s, -s * 0.5);
					ctx!.lineTo(s, s * 0.5);
					ctx!.lineTo(0, s);
					ctx!.lineTo(-s, s * 0.5);
					ctx!.lineTo(-s, -s * 0.5);
					ctx!.closePath();
					ctx!.stroke();
					ctx!.beginPath();
					ctx!.moveTo(0, -s);
					ctx!.lineTo(0, 0);
					ctx!.moveTo(s, -s * 0.5);
					ctx!.lineTo(0, 0);
					ctx!.moveTo(-s, -s * 0.5);
					ctx!.lineTo(0, 0);
					ctx!.stroke();
					break;
				}
				case "tetra": {
					// 四面体（三角锥）
					const s = size * 0.7;
					ctx!.beginPath();
					ctx!.moveTo(0, -s);
					ctx!.lineTo(s * 0.866, s * 0.5);
					ctx!.lineTo(-s * 0.866, s * 0.5);
					ctx!.closePath();
					ctx!.stroke();
					ctx!.beginPath();
					ctx!.moveTo(0, -s);
					ctx!.lineTo(0, s * 0.3);
					ctx!.stroke();
					break;
				}
				case "octa": {
					// 八面体（双锥）
					const s = size * 0.6;
					ctx!.beginPath();
					ctx!.moveTo(0, -s);
					ctx!.lineTo(s * 0.7, 0);
					ctx!.lineTo(0, s);
					ctx!.lineTo(-s * 0.7, 0);
					ctx!.closePath();
					ctx!.stroke();
					break;
				}
				case "ring": {
					ctx!.beginPath();
					ctx!.arc(0, 0, size * 0.5, 0, Math.PI * 2);
					ctx!.stroke();
					break;
				}
				case "star": {
					// 四角星芒
					const s = size * 0.8;
					ctx!.beginPath();
					for (let i = 0; i < 8; i++) {
						const a = (i / 8) * Math.PI * 2;
						const r = i % 2 === 0 ? s : s * 0.3;
						const px = Math.cos(a) * r;
						const py = Math.sin(a) * r;
						if (i === 0) ctx!.moveTo(px, py);
						else ctx!.lineTo(px, py);
					}
					ctx!.closePath();
					ctx!.fill();
					break;
				}
			}
			ctx!.restore();
		}

		// ====================================================================
		// 渲染层
		// ====================================================================
		function drawBackground() {
			ctx!.fillStyle = "#010208";
			ctx!.fillRect(0, 0, w, h);
			// 中心冷蓝辉光
			const breathe = 1 + 0.08 * Math.sin(elapsed * 0.6);
			const g = ctx!.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * 0.7 * breathe);
			g.addColorStop(0, "rgba(56, 189, 248, 0.4)");
			g.addColorStop(0.25, "rgba(129, 140, 248, 0.25)");
			g.addColorStop(0.5, "rgba(56, 189, 248, 0.1)");
			g.addColorStop(1, "rgba(1, 2, 8, 0)");
			ctx!.fillStyle = g;
			ctx!.fillRect(0, 0, w, h);
		}

		function drawCore() {
			ctx!.globalCompositeOperation = "lighter";
			const coreScale = 1 + 0.05 * Math.sin(elapsed * 2) + warp * 0.15;

			// 先画核心光晕（在粒子之下）
			const coreGlow = ctx!.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, 180 * coreScale);
			coreGlow.addColorStop(0, "rgba(255, 255, 255, 0.95)");
			coreGlow.addColorStop(0.1, "rgba(224, 242, 254, 0.9)");
			coreGlow.addColorStop(0.25, "rgba(165, 243, 252, 0.6)");
			coreGlow.addColorStop(0.5, "rgba(56, 189, 248, 0.3)");
			coreGlow.addColorStop(0.8, "rgba(129, 140, 248, 0.1)");
			coreGlow.addColorStop(1, "rgba(56, 189, 248, 0)");
			ctx!.fillStyle = coreGlow;
			ctx!.globalAlpha = 1;
			ctx!.beginPath();
			ctx!.arc(w / 2, h / 2, 180 * coreScale, 0, Math.PI * 2);
			ctx!.fill();

			// 核心球体粒子（在光晕之上）
			for (const p of coreParticles) {
				p.theta += p.speed * 0.016;
				const [x3, y3, z3] = sph2cart(p.theta, p.phi, p.radius * coreScale);
				const [sx, sy, s] = project(x3, y3, z3);
				if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) continue;

				const twinkle = 0.75 + 0.25 * Math.sin(elapsed * 4 + p.phase);
				const alpha = Math.min(1, 0.8 + s * 0.4) * twinkle;
				const size = p.size * s * (1 + warp * 0.3);

				if (p.bright) {
					ctx!.shadowColor = p.color;
					ctx!.shadowBlur = 24 * s;
				}
				drawShape(p.shape, sx, sy, size, p.color, alpha, elapsed * 0.5 + p.phase);
				ctx!.shadowBlur = 0;
			}
			ctx!.globalAlpha = 1;
			ctx!.globalCompositeOperation = "source-over";
		}

		function drawRings() {
			ctx!.globalCompositeOperation = "lighter";
			for (const p of ringParticles) {
				p.theta += p.speed * 0.016;
				// 环带粒子在同一平面（y=0），带轻微波动
				const wave = Math.sin(p.theta * 3 + elapsed * 2) * 0.1;
				const x3 = Math.cos(p.theta) * p.radius;
				const z3 = Math.sin(p.theta) * p.radius;
				const y3 = wave;
				const [sx, sy, s] = project(x3, y3, z3);
				if (sx < -30 || sx > w + 30 || sy < -30 || sy > h + 30) continue;

				const twinkle = 0.7 + 0.3 * Math.sin(elapsed * 3 + p.phase);
				const alpha = Math.min(1, 0.7 + s * 0.5) * twinkle;
				const size = p.size * s * 2;

				ctx!.shadowColor = p.color;
				ctx!.shadowBlur = 15 * s;
				drawShape(p.shape, sx, sy, size, p.color, alpha, p.phase);
				ctx!.shadowBlur = 0;
			}
			ctx!.globalAlpha = 1;
			ctx!.globalCompositeOperation = "source-over";
		}

		function drawBeams(dt: number) {
			ctx!.globalCompositeOperation = "lighter";
			for (let i = beams.length - 1; i >= 0; i--) {
				const b = beams[i];
				b.life -= dt * 1.5;
				if (b.life <= 0) {
					beams.splice(i, 1);
					continue;
				}
				const alpha = b.life;
				ctx!.strokeStyle = b.color;
				ctx!.globalAlpha = alpha * 0.8;
				ctx!.lineWidth = b.width;
				ctx!.shadowColor = b.color;
				ctx!.shadowBlur = 8;
				ctx!.beginPath();
				ctx!.moveTo(b.x1, b.y1);
				ctx!.lineTo(b.x2, b.y2);
				ctx!.stroke();
				ctx!.shadowBlur = 0;
			}
			ctx!.globalAlpha = 1;
			ctx!.globalCompositeOperation = "source-over";
		}

		function drawSparks(dt: number) {
			ctx!.globalCompositeOperation = "lighter";
			for (let i = sparks.length - 1; i >= 0; i--) {
				const s = sparks[i];
				s.life -= dt * 1.8;
				if (s.life <= 0) {
					sparks.splice(i, 1);
					continue;
				}
				s.x += s.vx * dt;
				s.y += s.vy * dt;
				s.vx *= 1 - dt * 2;
				s.vy *= 1 - dt * 2;
				const alpha = s.life;
				ctx!.shadowColor = s.color;
				ctx!.shadowBlur = 10;
				drawShape(s.shape, s.x, s.y, s.size * s.life, s.color, alpha, elapsed * 2);
				ctx!.shadowBlur = 0;
			}
			ctx!.globalAlpha = 1;
			ctx!.globalCompositeOperation = "source-over";
		}

		function frame(now: number) {
			const dt = Math.min((now - lastT) / 1000, 0.05);
			lastT = now;
			elapsed += dt;
			warp *= Math.exp(-dt * 1.2);
			camX += (camTargetX - camX) * dt * 3;
			camY += (camTargetY - camY) * dt * 3;

			drawBackground();
			drawRings();
			drawCore();
			drawBeams(dt);
			drawSparks(dt);
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
