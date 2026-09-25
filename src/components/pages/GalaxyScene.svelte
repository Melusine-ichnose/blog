<script lang="ts">
	import { onMount } from "svelte";
	import * as THREE from "three";
	import { OrbitControls } from "three/addons/controls/OrbitControls.js";

	// ====================================================================
	// 星际轨道 · Three.js 星系引擎
	// 移植自 three.js-works/Amphoreus：背景星野 + 参数方程螺旋星系 + 核心恒星
	// 适配博客：npm 打包 three（不走 CDN）、Svelte 卸载时完整释放资源、
	//          swup 软导航返回时组件重建、移动端自动降粒子数
	// 交互：拖拽旋转 · 滚轮缩放 · 右键平移（移动端单指旋转双指缩放）
	// ====================================================================

	let containerEl: HTMLDivElement;

	onMount(() => {
		const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

		const CONFIG = {
			starCount: isMobile ? 8000 : 20000, // 背景星野粒子数
			galaxyParticleCount: isMobile ? 10000 : 33550, // 螺旋星系粒子数
			galaxySpeed: 0.1, // 星系旋转速度
			galaxyTubeWidth: 150, // 螺旋管道径向宽度
			bgRadiusMin: 2000,
			bgRadiusMax: 5000,
			pixelRatioLimit: isMobile ? 1 : 2,
			colors: {
				background: 0x000510,
				star1: 0xaaddff,
				star2: 0xffddaa,
				star3: 0xffffff,
				galaxy: [0x46e8ff, 0xd946ff, 0xffe633], // 蓝→紫→金渐变
			},
			galaxyShape: { x_A: 1000, y_A: 400, z_A: 100 }, // 星系形状振幅
		};

		// ---------------- 着色器（与原作一致的辉光+十字星芒） ----------------
		const commonFragmentShader = `
			varying vec3 vColor;
			varying float vAlpha;
			void main() {
				vec2 coord = gl_PointCoord - vec2(0.5);
				float dist = length(coord);
				if (dist > 0.5) discard;
				float glow = 1.0 - smoothstep(0.0, 0.5, dist);
				float crossWidth = 0.02;
				float xMask = 1.0 - smoothstep(crossWidth * 0.5, crossWidth * 1.5, abs(coord.x));
				float yMask = 1.0 - smoothstep(crossWidth * 0.5, crossWidth * 1.5, abs(coord.y));
				float crossGlow = max(xMask, yMask) * 0.3 * (1.0 - dist * 2.0);
				float finalAlpha = (glow * 0.8 + crossGlow) * vAlpha;
				gl_FragColor = vec4(vColor + vec3(crossGlow), finalAlpha);
			}
		`;

		const starfieldVertexShader = `
			attribute float size;
			attribute vec3 color;
			attribute float phase;
			uniform float uTime;
			uniform float uPixelRatio;
			varying vec3 vColor;
			varying float vAlpha;
			void main() {
				vColor = color;
				vAlpha = 0.6 + 0.4 * sin(uTime * 3.0 + phase);
				vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
				float depth = max(-mvPosition.z, 1.0);
				gl_PointSize = size * (600.0 / depth) * uPixelRatio;
				gl_Position = projectionMatrix * mvPosition;
			}
		`;

		const galaxyVertexShader = `
			attribute float size;
			attribute vec3 color;
			attribute float initialT;
			attribute float offset;
			uniform float uTime;
			uniform float uSpeed;
			uniform float uPixelRatio;
			uniform float uXA;
			uniform float uYA;
			uniform float uZA;
			varying vec3 vColor;
			varying float vAlpha;
			void main() {
				vColor = color;
				vAlpha = 1.0;
				float t = initialT + uTime * uSpeed;
				float x = uXA * sin(t) + offset * cos(t);
				float y = uYA * sin(t * 2.0) + offset * sin(t);
				float z = uZA * cos(t) + offset * sin(t);
				vec4 mvPosition = modelViewMatrix * vec4(x, y, z, 1.0);
				float depth = max(-mvPosition.z, 1.0);
				gl_PointSize = size * (2000.0 / depth) * uPixelRatio;
				gl_Position = projectionMatrix * mvPosition;
			}
		`;

		const coreStarVertexShader = `
			attribute float size;
			uniform float uPixelRatio;
			varying vec3 vColor;
			varying float vAlpha;
			void main() {
				vColor = vec3(0.6, 0.7, 0.8);
				vAlpha = 1.0;
				vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
				gl_PointSize = size * 40.0 * uPixelRatio;
				gl_Position = projectionMatrix * mvPosition;
			}
		`;

		// ---------------- 场景初始化 ----------------
		const container = containerEl;
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(CONFIG.colors.background);
		if (!isMobile) scene.fog = new THREE.FogExp2(CONFIG.colors.background, 0.0005);

		const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 10000);
		camera.position.set(0, 0, 4000);

		const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, alpha: false, powerPreference: "high-performance" });
		renderer.setSize(container.clientWidth, container.clientHeight);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.pixelRatioLimit));
		container.appendChild(renderer.domElement);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.05;
		controls.minDistance = 10;
		controls.maxDistance = 5000;
		if (isMobile) {
			controls.enablePan = false;
			controls.rotateSpeed = 0.5;
			controls.zoomSpeed = 0.5;
		}

		// ---------------- 几何体构建 ----------------
		function createStarfield(): THREE.Points {
			const geometry = new THREE.BufferGeometry();
			const count = CONFIG.starCount;
			const positions = new Float32Array(count * 3);
			const colors = new Float32Array(count * 3);
			const sizes = new Float32Array(count);
			const phases = new Float32Array(count);

			const c1 = new THREE.Color(CONFIG.colors.star1);
			const c2 = new THREE.Color(CONFIG.colors.star2);
			const c3 = new THREE.Color(CONFIG.colors.star3);

			for (let i = 0; i < count; i++) {
				const u = Math.random();
				const v = Math.random();
				const theta = 2 * Math.PI * u;
				const phi = Math.acos(2 * v - 1);
				const radius = CONFIG.bgRadiusMin + Math.random() * (CONFIG.bgRadiusMax - CONFIG.bgRadiusMin);

				positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
				positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
				positions[i * 3 + 2] = radius * Math.cos(phi);

				let c = c3;
				if (Math.random() < 0.33) c = c1;
				else if (Math.random() < 0.66) c = c2;
				const variation = 0.8 + Math.random() * 0.4;
				colors[i * 3] = c.r * variation;
				colors[i * 3 + 1] = c.g * variation;
				colors[i * 3 + 2] = c.b * variation;

				const distRatio = (radius - CONFIG.bgRadiusMin) / (CONFIG.bgRadiusMax - CONFIG.bgRadiusMin);
				sizes[i] = (10.0 + Math.random() * 20.0) * (1 - distRatio * 0.8);
				phases[i] = Math.random() * Math.PI * 2;
			}

			geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
			geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
			geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
			geometry.setAttribute("phase", new THREE.BufferAttribute(phases, 1));

			return new THREE.Points(
				geometry,
				new THREE.ShaderMaterial({
					uniforms: { uPixelRatio: { value: renderer.getPixelRatio() }, uTime: { value: 0 } },
					vertexShader: starfieldVertexShader,
					fragmentShader: commonFragmentShader,
					transparent: true,
					blending: THREE.AdditiveBlending,
					depthWrite: false,
				}),
			);
		}

		function createStarCenter(): THREE.Points {
			const geometry = new THREE.BufferGeometry();
			const count = CONFIG.galaxyParticleCount;
			const positions = new Float32Array(count * 3);
			const initialTArray = new Float32Array(count);
			const particleSizes = new Float32Array(count);
			const particleColors = new Float32Array(count * 3);
			const offsets = new Float32Array(count);

			const galaxyColors = CONFIG.colors.galaxy.map((c) => new THREE.Color(c));

			for (let i = 0; i < count; ++i) {
				const t = (i / count) * Math.PI * 2;
				initialTArray[i] = t;
				offsets[i] = (Math.random() - 0.5) * CONFIG.galaxyTubeWidth;

				positions[i * 3] = CONFIG.galaxyShape.x_A * Math.sin(t) + offsets[i] * Math.cos(t);
				positions[i * 3 + 1] = CONFIG.galaxyShape.y_A * Math.sin(t * 2) + offsets[i] * Math.sin(t);
				positions[i * 3 + 2] = CONFIG.galaxyShape.z_A * Math.cos(t) + offsets[i] * Math.sin(t);

				particleSizes[i] = 0.4 + Math.random() * 1.0;

				const norm = t / (Math.PI * 2);
				const p = (norm * 3) % 3;
				let c: THREE.Color;
				if (p < 1) c = galaxyColors[0].clone().lerp(galaxyColors[1], p);
				else if (p < 2) c = galaxyColors[1].clone().lerp(galaxyColors[2], p - 1);
				else c = galaxyColors[2].clone().lerp(galaxyColors[0], p - 2);
				particleColors[i * 3] = c.r;
				particleColors[i * 3 + 1] = c.g;
				particleColors[i * 3 + 2] = c.b;
			}

			geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
			geometry.setAttribute("initialT", new THREE.BufferAttribute(initialTArray, 1));
			geometry.setAttribute("offset", new THREE.BufferAttribute(offsets, 1));
			geometry.setAttribute("size", new THREE.BufferAttribute(particleSizes, 1));
			geometry.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));

			return new THREE.Points(
				geometry,
				new THREE.ShaderMaterial({
					uniforms: {
						uTime: { value: 0 },
						uSpeed: { value: CONFIG.galaxySpeed },
						uPixelRatio: { value: renderer.getPixelRatio() },
						uXA: { value: CONFIG.galaxyShape.x_A },
						uYA: { value: CONFIG.galaxyShape.y_A },
						uZA: { value: CONFIG.galaxyShape.z_A },
					},
					vertexShader: galaxyVertexShader,
					fragmentShader: commonFragmentShader,
					transparent: true,
					blending: THREE.AdditiveBlending,
					depthWrite: false,
				}),
			);
		}

		function createCoreStar(): THREE.Points {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
			geometry.setAttribute("size", new THREE.BufferAttribute(new Float32Array([1.0]), 1));
			return new THREE.Points(
				geometry,
				new THREE.ShaderMaterial({
					uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } },
					vertexShader: coreStarVertexShader,
					fragmentShader: commonFragmentShader,
					transparent: true,
					blending: THREE.AdditiveBlending,
					depthWrite: false,
					depthTest: true,
				}),
			);
		}

		scene.add(createStarfield());
		scene.add(createStarCenter());
		scene.add(createCoreStar());

		// ---------------- 渲染循环 ----------------
		const clock = new THREE.Clock();
		let isPaused = false;

		function animate() {
			if (document.hidden || isPaused) return;
			const elapsedTime = clock.getElapsedTime();
			for (const child of scene.children) {
				if (child instanceof THREE.Points) {
					const mat = child.material as THREE.ShaderMaterial;
					if (mat.uniforms.uTime) mat.uniforms.uTime.value = elapsedTime;
				}
			}
			// 背景星野整体缓慢自旋
			if (scene.children[0]) {
				scene.children[0].rotation.x -= 0.0002;
				scene.children[0].rotation.y += 0.0002;
				scene.children[0].rotation.z += 0.0002;
			}
			controls.update();
			renderer.render(scene, camera);
		}
		renderer.setAnimationLoop(animate);

		function onVisibility() {
			isPaused = document.hidden;
			if (!isPaused) clock.start();
		}

		function onResize() {
			camera.aspect = container.clientWidth / container.clientHeight;
			camera.updateProjectionMatrix();
			renderer.setSize(container.clientWidth, container.clientHeight);
			const pr = Math.min(window.devicePixelRatio, CONFIG.pixelRatioLimit);
			renderer.setPixelRatio(pr);
			for (const child of scene.children) {
				if (child instanceof THREE.Points) {
					const mat = child.material as THREE.ShaderMaterial;
					if (mat.uniforms.uPixelRatio) mat.uniforms.uPixelRatio.value = pr;
				}
			}
		}

		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("resize", onResize);

		// 卸载（含 swup 软导航离开）时完整释放 GPU 资源
		return () => {
			renderer.setAnimationLoop(null);
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("resize", onResize);
			controls.dispose();
			for (const child of scene.children) {
				if (child instanceof THREE.Points) {
					child.geometry.dispose();
					(child.material as THREE.Material).dispose();
				}
			}
			renderer.dispose();
			renderer.domElement.remove();
		};
	});
</script>

<div bind:this={containerEl} class="orbit-scene" aria-hidden="true"></div>

<style>
	.orbit-scene {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
	}
	.orbit-scene :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
