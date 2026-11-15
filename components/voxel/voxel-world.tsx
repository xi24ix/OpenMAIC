'use client';

/**
 * The Minecraft voxel world background: the looping day→night cinematic video
 * rendered as a three.js VideoTexture, with the interactive layer on top
 * (mouse parallax, gold/purple fireflies anchored to video features, floating
 * magic cubes, shooting stars, click voxel-bursts, torch-light cursor glow).
 *
 * Mounted by pages that opt into the voxel style (homepage, generation
 * preview). Everything disposes cleanly on unmount or style switch. three.js
 * is lazy-loaded from /voxel/three.min.js the first time the world activates,
 * so the default Aurora style never pays for it.
 *
 * The canvas and grade layers stay `display:none` unless `<html>` carries the
 * `voxel-style` class (see app/voxel.css) — the component can stay mounted
 * across style switches cheaply.
 */
import { useEffect, useRef } from 'react';

const THREE_SRC = '/voxel/three.min.js';
const IMG_ASPECT = 1920 / 1080;
const CAM_Z = 100;
const REDUCED =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ───────── tiny helpers ───────── */
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const TAU = Math.PI * 2;

/* WebGL canvas gradients for the glow sprites */
function glowTexture(THREE: any, color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, color + 'ff');
  grad.addColorStop(0.35, color + '88');
  grad.addColorStop(1, color + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function streakTexture(THREE: any) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 8;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.75, 'rgba(200,190,255,.85)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 8);
  return new THREE.CanvasTexture(c);
}

/* ───────── the world ───────── */
function mountWorld(canvas: HTMLCanvasElement, torch: HTMLDivElement) {
  let disposed = false;
  let cleanup: (() => void) | null = null;
  const cleanups: (() => void)[] = [];

  // three.js is loaded once per session; concurrent mounts share it.
  function loadThree(): Promise<any> {
    const w = window as any;
    if (w.THREE) return Promise.resolve(w.THREE);
    if (!w.__voxelThreePromise) {
      w.__voxelThreePromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = THREE_SRC;
        s.onload = () => resolve((window as any).THREE);
        s.onerror = () => reject(new Error('three.js failed to load'));
        document.head.appendChild(s);
      });
    }
    return w.__voxelThreePromise;
  }

  loadThree()
    .then((THREE: any) => {
      if (disposed) return;

      let W = window.innerWidth;
      let H = window.innerHeight;
      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, W / H, 1, 400);
      camera.position.set(0, 0, CAM_Z);
      const world = new THREE.Group();
      scene.add(world);

      let planeH = 0;
      let planeW = 0;
      const mouse = { nx: 0, ny: 0, tx: 0, ty: 0, px: 0, py: 0 };
      const anchored: { obj: any; nx: number; ny: number; z: number }[] = [];
      const bobbers: {
        mesh: any;
        nx: number;
        ny: number;
        z: number;
        k: number;
        ph: number;
        sp: number;
        rr: number;
      }[] = [];

      function imgToWorld(nx: number, ny: number) {
        return { x: (nx - 0.5) * planeW, y: (0.5 - ny) * planeH };
      }

      function anchor(obj: any, nx: number, ny: number, z: number) {
        anchored.push({ obj, nx, ny, z });
        world.add(obj);
        return obj;
      }

      function layout() {
        W = window.innerWidth;
        H = window.innerHeight;
        renderer.setSize(W, H, false);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        camera.aspect = W / H;
        const visH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAM_Z;
        const visW = visH * camera.aspect;
        planeH = Math.max(visH, visW / IMG_ASPECT) * 1.16;
        planeW = planeH * IMG_ASPECT;
        camera.updateProjectionMatrix();
        if (bgPlane) {
          bgPlane.geometry.dispose();
          bgPlane.geometry = new THREE.PlaneGeometry(planeW, planeH);
        }
        anchored.forEach((a) => {
          const p = imgToWorld(a.nx, a.ny);
          a.obj.position.set(p.x, p.y, a.z);
        });
        if (mistA) {
          mistA.scale.set(planeW * 0.55, planeH * 0.3, 1);
          mistB.scale.set(planeW * 0.6, planeH * 0.32, 1);
        }
        bobbers.forEach((b) => {
          const p = imgToWorld(b.nx, b.ny);
          b.mesh.position.set(p.x, p.y, b.z);
          b.mesh.scale.setScalar(planeH * b.k);
        });
        if (fireflies) {
          const posAttr = fireflies.geometry.attributes.position;
          fireflies.userData.seeds.forEach((sd: any, i: number) => {
            posAttr.setXYZ(i, sd.bx, sd.by, posAttr.getZ(i));
          });
          posAttr.needsUpdate = true;
        }
        streaks.forEach((st) => st.mesh.scale.setScalar(planeH / 83));
      }

      /* ── background: looping video, still plate first ── */
      const loaderTex = new THREE.TextureLoader();
      const tex = loaderTex.load('/voxel/bg-plate.webp');
      tex.minFilter = THREE.LinearFilter;
      const bgPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ map: tex, depthWrite: false }),
      );
      bgPlane.position.z = 0;
      world.add(bgPlane);

      let bgVideo: HTMLVideoElement | null = null;
      let videoStarted = false;
      try {
        const v = document.createElement('video');
        v.src = W <= 820 ? '/voxel/alostad-bg-720.mp4' : '/voxel/alostad-bg-1080.mp4';
        v.muted = true;
        v.loop = true;
        v.autoplay = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.setAttribute('playsinline', '');
        v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
        const swap = () => {
          if (videoStarted || disposed) return;
          const videoTex = new THREE.VideoTexture(v);
          videoTex.minFilter = THREE.LinearFilter;
          videoTex.magFilter = THREE.LinearFilter;
          bgPlane.material.map = videoTex;
          bgPlane.material.needsUpdate = true;
          videoStarted = true;
        };
        v.addEventListener('playing', swap, { once: true });
        v.addEventListener('canplay', () => v.play().catch(() => {}), {
          once: true,
        });
        document.body.appendChild(v);
        bgVideo = v;
        const onVis = () => {
          if (document.hidden) v.pause();
          else if (videoStarted && !disposed) v.play().catch(() => {});
        };
        document.addEventListener('visibilitychange', onVis);
        cleanups.push(() => document.removeEventListener('visibilitychange', onVis));
      } catch {
        /* the still plate stays */
      }

      /* ── floating magic cubes ── */
      const boxGeo = new THREE.BoxGeometry(1, 1, 1);
      const cubeSpots = [
        { nx: 0.57, ny: 0.2 },
        { nx: 0.35, ny: 0.12 },
        { nx: 0.55, ny: 0.58 },
        { nx: 0.24, ny: 0.22 },
        { nx: 0.94, ny: 0.12 },
        { nx: 0.44, ny: 0.32 },
        { nx: 0.62, ny: 0.44 },
        { nx: 0.33, ny: 0.5 },
        { nx: 0.16, ny: 0.14 },
      ];
      const cubeCols = [0x9d86ff, 0xffb054, 0x7be0ff, 0xff8a3d, 0xc9b6ff];
      cubeSpots.forEach((sp) => {
        const m = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: cubeCols[(Math.random() * cubeCols.length) | 0],
            transparent: true,
            opacity: 0.95,
          }),
        );
        const glow = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: glowTexture(
              THREE,
              m.material.color.getHexString() === 'ffb054' ||
                m.material.color.getHexString() === 'ff8a3d'
                ? '#ffb066'
                : '#b49aff',
            ),
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        glow.scale.setScalar(3);
        m.add(glow);
        bobbers.push({
          mesh: m,
          nx: sp.nx,
          ny: sp.ny,
          z: rand(3, 9),
          k: rand(0.004, 0.007),
          ph: rand(0, TAU),
          sp: rand(0.5, 1.2),
          rr: rand(0.15, 0.5),
        });
        world.add(m);
      });

      /* ── mist ── */
      const mistMat = (op: number) =>
        new THREE.SpriteMaterial({
          map: glowTexture(THREE, '#cdb8ff'),
          transparent: true,
          opacity: op,
          depthWrite: false,
        });
      const mistA = new THREE.Sprite(mistMat(0.1));
      anchor(mistA, 0.28, 0.88, 3);
      const mistB = new THREE.Sprite(mistMat(0.085));
      anchor(mistB, 0.72, 0.9, 4);

      /* ── fireflies (shader points, twinkle) ── */
      const fireflyItems = [
        { nx: 0.155, ny: 0.29, z: 2, count: 24, color: '#ffc477', spread: 0.05, rise: 0.4 },
        { nx: 0.055, ny: 0.43, z: 2, count: 20, color: '#ffc477', spread: 0.045, rise: 0.4 },
        { nx: 0.92, ny: 0.79, z: 2, count: 16, color: '#ffcf8a', spread: 0.05, rise: 0.5 },
        { nx: 0.93, ny: 0.6, z: 1.6, count: 30, color: '#c07bff', spread: 0.05, rise: 0.7 },
        { nx: 0.16, ny: 0.84, z: 2.5, count: 26, color: '#ffd9a0', spread: 0.1, rise: 0.35 },
        { nx: 0.47, ny: 0.6, z: 3, count: 16, color: '#ffe9c9', spread: 0.09, rise: 0.6 },
        { nx: 0.79, ny: 0.32, z: 2, count: 12, color: '#d9a8ff', spread: 0.04, rise: 0.5 },
        { nx: 0.5, ny: 0.72, z: 2.5, count: 18, color: '#ffd9a0', spread: 0.14, rise: 0.45 },
      ];
      const pos: number[] = [];
      const col: number[] = [];
      const size: number[] = [];
      const phase: number[] = [];
      const seeds: any[] = [];
      const tmpC = new THREE.Color();
      fireflyItems.forEach((it) => {
        for (let i = 0; i < it.count; i++) {
          const p = imgToWorld(
            it.nx + rand(-it.spread, it.spread) * IMG_ASPECT * 0.5,
            it.ny + rand(-it.spread, it.spread),
          );
          pos.push(p.x, p.y + rand(-1, 1), it.z + rand(-1.5, 1.5));
          tmpC.set(it.color).offsetHSL(rand(-0.02, 0.02), 0, rand(-0.15, 0.15));
          col.push(tmpC.r, tmpC.g, tmpC.b);
          size.push(rand(0.7, 2.0));
          phase.push(rand(0, TAU));
          seeds.push({ bx: p.x, by: p.y });
        }
      });
      const fireflyGeo = new THREE.BufferGeometry();
      fireflyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      fireflyGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
      fireflyGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
      fireflyGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
      const fireflyMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uPR: { value: Math.min(window.devicePixelRatio || 1, 1.75) },
        },
        vertexShader: `
          attribute vec3 aColor; attribute float aSize; attribute float aPhase;
          uniform float uTime; uniform float uPR;
          varying vec3 vC; varying float vA;
          void main(){
            vC = aColor;
            vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 2.2 + aPhase));
            vec3 p = position;
            p.x += sin(uTime * 0.7 + aPhase) * 0.9;
            p.y += sin(uTime * 0.55 + aPhase * 1.7) * 0.7;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = aSize * uPR * (150.0 / -mv.z) * (0.75 + 0.45 * sin(uTime * 1.6 + aPhase));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          varying vec3 vC; varying float vA;
          void main(){
            float d = distance(gl_PointCoord, vec2(0.5));
            float a = smoothstep(0.5, 0.08, d);
            gl_FragColor = vec4(vC, a * vA);
          }`,
      });
      const fireflies = new THREE.Points(fireflyGeo, fireflyMat);
      fireflies.userData.seeds = seeds;
      world.add(fireflies);

      /* ── shooting stars pool ── */
      const streaks: any[] = [];
      for (let i = 0; i < 3; i++) {
        const st = new THREE.Mesh(
          new THREE.PlaneGeometry(16, 0.6),
          new THREE.MeshBasicMaterial({
            map: streakTexture(THREE),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        st.visible = false;
        scene.add(st);
        streaks.push({
          mesh: st,
          active: false,
          t: 0,
          dur: 1,
          from: null,
          to: null,
          next: 1.2 + i * 2.2 + rand(0, 1.5),
        });
      }

      /* ── click bursts ── */
      const burstPool: any[] = [];
      function spawnBurst(wx: number, wy: number) {
        for (let i = 0; i < 12; i++) {
          let b = burstPool.find((x) => !x.active);
          if (!b) {
            b = {
              mesh: new THREE.Mesh(
                boxGeo,
                new THREE.MeshBasicMaterial({
                  color: 0xffffff,
                  transparent: true,
                }),
              ),
              active: false,
              t: 0,
              dur: 1,
              v: { x: 0, y: 0, z: 0 },
              rv: { x: 0, y: 0 },
            };
            burstPool.push(b);
            scene.add(b.mesh);
          }
          b.active = true;
          b.t = 0;
          b.dur = rand(0.7, 1.2);
          b.mesh.visible = true;
          b.mesh.material.opacity = 1;
          b.mesh.material.color.setHex(Math.random() < 0.6 ? 0xffb054 : 0xb49aff);
          b.mesh.scale.setScalar(rand(0.5, 1.3));
          b.mesh.position.set(wx + rand(-1, 1), wy + rand(-1, 1), 2);
          b.v = { x: rand(-6, 6), y: rand(4, 12), z: rand(-1, 1) };
          b.rv = { x: rand(-4, 4), y: rand(-4, 4) };
        }
      }

      /* ── input ── */
      const onMove = (e: PointerEvent) => {
        mouse.px = e.clientX;
        mouse.py = e.clientY;
        mouse.tx = (e.clientX / W) * 2 - 1;
        mouse.ty = (e.clientY / H) * 2 - 1;
        torch.style.setProperty('--tx', e.clientX + 'px');
        torch.style.setProperty('--ty', e.clientY + 'px');
      };
      const onDown = (e: PointerEvent) => {
        if (
          (e.target as Element)?.closest?.(
            'button, a, input, textarea, [role="menu"], [role="dialog"]',
          )
        )
          return;
        const dist = CAM_Z - 2;
        const wh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
        const ww = wh * camera.aspect;
        spawnBurst((((e.clientX / W) * 2 - 1) * ww) / 2, (-((e.clientY / H) * 2 - 1) * wh) / 2);
      };
      const onResize = () => layout();
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerdown', onDown, { passive: true });
      window.addEventListener('resize', onResize);
      cleanups.push(() => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerdown', onDown);
        window.removeEventListener('resize', onResize);
      });

      /* ── loop ── */
      const clock = new THREE.Clock();
      let raf = 0;
      function tick() {
        raf = requestAnimationFrame(tick);
        if (document.hidden) return;
        const dt = Math.min(clock.getDelta(), 0.05);
        const t = clock.elapsedTime;

        mouse.nx = lerp(mouse.nx, mouse.tx, 0.045);
        mouse.ny = lerp(mouse.ny, mouse.ty, 0.045);
        const drift = REDUCED ? 0 : 1;
        camera.position.x = mouse.nx * 4.6 + Math.sin(t * 0.11) * 0.9 * drift;
        camera.position.y = -mouse.ny * 2.8 + Math.cos(t * 0.09) * 0.6 * drift;
        camera.lookAt(0, 0, 0);

        bobbers.forEach((b) => {
          b.mesh.rotation.y += b.rr * dt;
          b.mesh.rotation.x = Math.sin(t * b.sp + b.ph) * 0.18;
          b.mesh.position.y += Math.sin(t * b.sp + b.ph) * 0.012;
        });

        if (mistA) {
          mistA.position.x += dt * 0.35;
          mistB.position.x -= dt * 0.28;
          if (mistA.position.x > planeW * 0.75) mistA.position.x = -planeW * 0.75;
          if (mistB.position.x < -planeW * 0.75) mistB.position.x = planeW * 0.75;
        }

        streaks.forEach((st) => {
          if (!st.active) {
            st.next -= dt;
            if (st.next <= 0 && !REDUCED) {
              st.active = true;
              st.t = 0;
              st.dur = rand(0.9, 1.4);
              const f = imgToWorld(rand(0.3, 0.62), rand(0.08, 0.22));
              const to = imgToWorld(rand(0.05, 0.28), rand(0.3, 0.45));
              st.from = f;
              st.to = to;
              st.mesh.visible = true;
              st.mesh.scale.setScalar(planeH / 83);
            }
            return;
          }
          st.t += dt;
          const k = st.t / st.dur;
          if (k >= 1) {
            st.active = false;
            st.mesh.visible = false;
            st.next = rand(6, 10);
            return;
          }
          const x = lerp(st.from.x, st.to.x, k);
          const y = lerp(st.from.y, st.to.y, k) - k * k * 6;
          st.mesh.position.set(x, y, 5);
          st.mesh.rotation.z = Math.atan2(st.to.y - st.from.y - 6, st.to.x - st.from.x);
          st.mesh.material.opacity = Math.sin(k * Math.PI) * 0.9;
        });

        burstPool.forEach((b) => {
          if (!b.active) return;
          b.t += dt;
          const k = b.t / b.dur;
          if (k >= 1) {
            b.active = false;
            b.mesh.visible = false;
            return;
          }
          b.v.y -= 22 * dt;
          b.mesh.position.x += b.v.x * dt;
          b.mesh.position.y += b.v.y * dt;
          b.mesh.rotation.x += b.rv.x * dt;
          b.mesh.rotation.y += b.rv.y * dt;
          b.mesh.material.opacity = 1 - k;
        });

        fireflyMat.uniforms.uTime.value = t;

        renderer.render(scene, camera);
      }

      layout();
      clock.getDelta();
      if (REDUCED) {
        renderer.render(scene, camera);
      } else {
        tick();
      }

      cleanup = () => {
        disposed = true;
        cancelAnimationFrame(raf);
        cleanups.forEach((fn) => fn());
        bgVideo?.remove();
        document.body.classList.remove('voxel-night');
        renderer.dispose();
        scene.traverse((obj: any) => {
          obj.geometry?.dispose?.();
          if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose?.());
          else obj.material?.dispose?.();
        });
        canvas.width = 0;
        canvas.height = 0;
      };
    })
    .catch(() => {
      /* three.js unavailable: the still plate layer (CSS) carries the mood */
    });

  return () => {
    disposed = true;
    cleanup?.();
  };
}

export function VoxelWorld() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const torchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !torchRef.current) return;
    return mountWorld(canvasRef.current, torchRef.current);
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="voxel-world-canvas fixed inset-0 z-[-2] h-full w-full"
      />
      <div aria-hidden className="voxel-world-grades pointer-events-none fixed inset-0 z-[-1]">
        <div className="voxel-grade voxel-grade-vignette absolute inset-0" />
        <div className="voxel-grade voxel-grade-night absolute inset-0" />
        <div className="voxel-grade voxel-grade-ui absolute inset-0" />
      </div>
      <div ref={torchRef} aria-hidden className="voxel-torch" />
    </>
  );
}

/* z-plan: canvas -2 → grades -1 → torch -1 → page content (static or
   positioned) paints above all of them, so no host page needs z tuning. */
