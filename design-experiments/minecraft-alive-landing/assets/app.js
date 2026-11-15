/* ═══════════════════════════════════════════════════════════════
   ALOSTAD CLASSROOM — Alive Voxel World
   three.js living twilight scene + UI life (GSAP)
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ───────── helpers ───────── */
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (min, max) => min + Math.random() * (max - min);
  const TAU = Math.PI * 2;
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ───────── world boot ───────── */
  const canvas = document.getElementById('world');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    canvas.style.display = 'none';
    document.body.classList.add('no-webgl');
  }

  const mouse = { nx: 0, ny: 0, tx: 0, ty: 0 }; // normalized -1..1 (target + smoothed)
  let W = 0, H = 0;

  let scene, camera, world;
  const IMG_ASPECT = 1920 / 1080;
  const CAM_Z = 100;
  let planeH = 0, planeW = 0;

  // collections that must re-layout on resize
  const anchored = [];      // { obj, nx, ny, z, yOff, xOff }
  const bobbers = [];       // floating cubes
  let bgPlane = null;
  let bgVideo = null, videoTex = null, videoStarted = false;
  let mistA = null, mistB = null;
  let fireflies = null;

  /* ───────── looping background video ───────── */
  function startBackgroundVideo() {
    if (bgVideo || REDUCED) return; // reduced motion: keep the still plate
    const v = document.createElement('video');
    v.src = W <= 820 ? 'assets/alostad-bg-720.mp4' : 'assets/alostad-bg-1080.mp4';
    v.muted = true;
    v.loop = true;
    v.autoplay = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('playsinline', ''); // iOS
    const swap = () => {
      if (videoStarted || !bgPlane) return;
      videoTex = new THREE.VideoTexture(v);
      videoTex.minFilter = THREE.LinearFilter;
      videoTex.magFilter = THREE.LinearFilter;
      bgPlane.material.map = videoTex;
      bgPlane.material.needsUpdate = true;
      videoStarted = true;
    };
    v.addEventListener('playing', swap, { once: true });
    v.addEventListener('canplay', () => { v.play().catch(() => {}); }, { once: true });
    v.addEventListener('error', () => { /* keep the still plate */ }, { once: true });
    document.body.appendChild(v);
    v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
    bgVideo = v;
    // pause when the tab is hidden (saves battery alongside the paused RAF)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) v.pause();
      else if (videoStarted) v.play().catch(() => {});
    });
  }

  if (renderer) {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 1, 400);
    camera.position.set(0, 0, CAM_Z);
    world = new THREE.Group();
    scene.add(world);
    renderer.setClearColor(0x000000, 0);
  }

  /* ───────── canvas textures ───────── */
  function glowTexture(color) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, color + 'ff');
    grad.addColorStop(0.35, color + '88');
    grad.addColorStop(1, color + '00');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); return t;
  }
  function streakTexture() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 8;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(.75, 'rgba(200,190,255,.85)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 8);
    return new THREE.CanvasTexture(c);
  }

  /* ───────── fireflies shader points ───────── */
  function makeFireflies(items) {
    // items: {nx, ny, z, count, color, spread, rise}
    const pos = [], col = [], size = [], phase = [], seeds = [];
    const tmpC = new THREE.Color();
    items.forEach(it => {
      for (let i = 0; i < it.count; i++) {
        const p = imgToWorld(it.nx + rand(-it.spread, it.spread) * IMG_ASPECT * 0.5,
                             it.ny + rand(-it.spread, it.spread));
        pos.push(p.x, p.y + rand(-1, 1), it.z + rand(-1.5, 1.5));
        tmpC.set(it.color).offsetHSL(rand(-0.02, 0.02), 0, rand(-0.15, 0.15));
        col.push(tmpC.r, tmpC.g, tmpC.b);
        size.push(rand(0.7, 2.0));
        phase.push(rand(0, TAU));
        seeds.push({ bx: p.x, by: p.y, rise: it.rise, sp: rand(.5, 1.6), ph: rand(0, TAU), amp: rand(0.6, 1.8) });
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPR: { value: Math.min(devicePixelRatio || 1, 1.75) } },
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
        }`
    });
    const pts = new THREE.Points(geo, mat);
    pts.userData.seeds = seeds;
    return pts;
  }

  /* ───────── layout / anchoring ───────── */
  function imgToWorld(nx, ny) {
    return { x: (nx - 0.5) * planeW, y: (0.5 - ny) * planeH };
  }

  function layout() {
    W = innerWidth; H = innerHeight;
    if (!renderer) return;
    renderer.setSize(W, H, false);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
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

    anchored.forEach(a => {
      const p = imgToWorld(a.nx, a.ny);
      a.obj.position.set(p.x + (a.xOff || 0), p.y + (a.yOff || 0), a.z);
    });

    if (mistA) { mistA.scale.set(planeW * 0.55, planeH * 0.3, 1); mistB.scale.set(planeW * 0.6, planeH * 0.32, 1); }

    bobbers.forEach(b => {
      const p = imgToWorld(b.nx, b.ny);
      b.mesh.position.set(p.x, p.y, b.z);
      b.mesh.scale.setScalar(planeH * b.k);
    });
    if (fireflies) {
      // rebuild positions from seeds
      const posAttr = fireflies.geometry.attributes.position;
      fireflies.userData.seeds.forEach((sd, i) => {
        posAttr.setXYZ(i, sd.bx, sd.by, posAttr.getZ(i));
      });
      posAttr.needsUpdate = true;
    }
  }

  function anchor(obj, nx, ny, z, yOff = 0, xOff = 0) {
    anchored.push({ obj, nx, ny, z, yOff, xOff });
    world.add(obj);
    return obj;
  }

  /* ───────── scene construction ───────── */
  function build() {
    const loaderTex = new THREE.TextureLoader();
    // background: looping video texture; the still plate (WebP when supported)
    // shows first and remains the fallback if the video can't play
    const supportsWebp = (() => {
      try { return document.createElement('canvas').toDataURL('image/webp').indexOf('data:image/webp') === 0; }
      catch (e) { return false; }
    })();
    const tex = loaderTex.load(supportsWebp ? 'assets/bg-plate.webp' : 'assets/bg-plate.png', () => { /* ready */ });
    tex.minFilter = THREE.LinearFilter;
    bgPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ map: tex, depthWrite: false })
    );
    bgPlane.position.z = 0;
    world.add(bgPlane);
    startBackgroundVideo();

    // ── floating magic cubes (the video already owns clouds, islands & portal) ──
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const cubeSpots = [
      { nx: 0.57, ny: 0.20 }, { nx: 0.35, ny: 0.12 }, { nx: 0.55, ny: 0.58 },
      { nx: 0.24, ny: 0.22 }, { nx: 0.94, ny: 0.12 }, { nx: 0.44, ny: 0.32 },
      { nx: 0.62, ny: 0.44 }, { nx: 0.33, ny: 0.50 }, { nx: 0.16, ny: 0.14 },
    ];
    const cubeCols = [0x9d86ff, 0xffb054, 0x7be0ff, 0xff8a3d, 0xc9b6ff];
    cubeSpots.forEach(sp => {
      const k = rand(0.004, 0.007);
      const m = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: cubeCols[(Math.random() * cubeCols.length) | 0], transparent: true, opacity: 0.95 }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(m.material.color.getHexString() === 'ffb054' || m.material.color.getHexString() === 'ff8a3d' ? '#ffb066' : '#b49aff'),
        transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      glow.scale.setScalar(3);
      m.add(glow);
      bobbers.push({ mesh: m, nx: sp.nx, ny: sp.ny, z: rand(3, 9), k,
        ph: rand(0, TAU), sp: rand(0.5, 1.2), rr: rand(0.15, 0.5) });
      world.add(m);
    });

    // ── mist ──
    const mistMat = op => new THREE.SpriteMaterial({
      map: glowTexture('#cdb8ff'), transparent: true, opacity: op,
      depthWrite: false, blending: THREE.NormalBlending
    });
    mistA = new THREE.Sprite(mistMat(0.10));
    mistA.scale.set(planeW * 0.55, planeH * 0.3, 1);
    anchor(mistA, 0.28, 0.88, 3);
    mistB = new THREE.Sprite(mistMat(0.085));
    mistB.scale.set(planeW * 0.6, planeH * 0.32, 1);
    anchor(mistB, 0.72, 0.9, 4);

    // ── fireflies, re-anchored to the video composition ──
    // (lanterns 0.16/0.27 + 0.06/0.42 · portal 0.93/0.60 · explorer 0.68/0.75 · castle 0.79/0.30)
    fireflies = makeFireflies([
      { nx: 0.155, ny: 0.29, z: 2,    count: 24, color: '#ffc477', spread: 0.05,  rise: 0.4 },
      { nx: 0.055, ny: 0.43, z: 2,    count: 20, color: '#ffc477', spread: 0.045, rise: 0.4 },
      { nx: 0.92,  ny: 0.79, z: 2,    count: 16, color: '#ffcf8a', spread: 0.05,  rise: 0.5 },
      { nx: 0.93,  ny: 0.60, z: 1.6,  count: 30, color: '#c07bff', spread: 0.05,  rise: 0.7 },
      { nx: 0.66,  ny: 0.86, z: 2.5,  count: 26, color: '#ffd9a0', spread: 0.10,  rise: 0.35 },
      { nx: 0.47,  ny: 0.60, z: 3,    count: 16, color: '#ffe9c9', spread: 0.09,  rise: 0.6 },
      { nx: 0.79,  ny: 0.32, z: 2,    count: 12, color: '#d9a8ff', spread: 0.04,  rise: 0.5 },
      { nx: 0.50,  ny: 0.72, z: 2.5,  count: 18, color: '#ffd9a0', spread: 0.14,  rise: 0.45 },
    ]);
    world.add(fireflies);

    // ── shooting stars pool ──
    const streaks = [];
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Mesh(
        new THREE.PlaneGeometry(planeH * 0.16, planeH * 0.006),
        new THREE.MeshBasicMaterial({ map: streakTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      st.visible = false;
      scene.add(st);
      streaks.push({ mesh: st, active: false, t: 0, dur: 1, from: null, to: null, next: 1.2 + i * 2.2 + rand(0, 1.5) });
    }
    scene.userData.streaks = streaks;
  }

  /* ───────── click bursts ───────── */
  const burstPool = [];
  function spawnBurst(wx, wy) {
    for (let i = 0; i < 12; i++) {
      let b = burstPool.find(x => !x.active);
      if (!b) {
        b = { mesh: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true })), active: false };
        burstPool.push(b); scene.add(b.mesh);
      }
      b.active = true; b.t = 0;
      b.dur = rand(0.7, 1.2);
      b.mesh.visible = true;
      b.mesh.material.opacity = 1;
      b.mesh.material.color.setHex(Math.random() < 0.6 ? 0xffb054 : 0xb49aff);
      const s = rand(0.5, 1.3);
      b.mesh.scale.setScalar(s);
      b.mesh.position.set(wx + rand(-1, 1), wy + rand(-1, 1), 2);
      b.v = { x: rand(-6, 6), y: rand(4, 12), z: rand(-1, 1) };
      b.rv = { x: rand(-4, 4), y: rand(-4, 4) };
    }
  }

  /* ───────── animation loop ───────── */
  const clock = new THREE.Clock();
  const rayZ = 2;
  function screenToWorld2(clientX, clientY) {
    const dist = CAM_Z - rayZ;
    const wh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    const ww = wh * camera.aspect;
    return {
      x: ((clientX / W) * 2 - 1) * ww / 2,
      y: -((clientY / H) * 2 - 1) * wh / 2
    };
  }

  function tick() {
    requestAnimationFrame(tick);
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // smoothed mouse
    mouse.nx = lerp(mouse.nx, mouse.tx, 0.045);
    mouse.ny = lerp(mouse.ny, mouse.ty, 0.045);

    // camera drift + parallax (depth does the rest)
    const drift = REDUCED ? 0 : 1;
    camera.position.x = mouse.nx * 4.6 + Math.sin(t * 0.11) * 0.9 * drift;
    camera.position.y = -mouse.ny * 2.8 + Math.cos(t * 0.09) * 0.6 * drift;
    camera.lookAt(0, 0, 0);

    // bobbers
    bobbers.forEach(b => {
      b.mesh.rotation.y += b.rr * dt;
      b.mesh.rotation.x = Math.sin(t * b.sp + b.ph) * 0.18;
      b.mesh.position.y += Math.sin(t * b.sp + b.ph) * 0.012;
    });

    // mist drift
    if (mistA) {
      mistA.position.x += dt * 0.35; mistB.position.x -= dt * 0.28;
      if (mistA.position.x > planeW * 0.75) mistA.position.x = -planeW * 0.75;
      if (mistB.position.x < -planeW * 0.75) mistB.position.x = planeW * 0.75;
    }

    // streaks (shooting stars)
    scene.userData.streaks.forEach(st => {
      if (!st.active) {
        st.next -= dt;
        if (st.next <= 0 && !REDUCED) {
          st.active = true; st.t = 0; st.dur = rand(0.9, 1.4);
          // streaks fly through the upper sky (image-normalized: small ny = top), down-left
          const fx = rand(0.30, 0.62), fy = rand(0.08, 0.22);
          const f = imgToWorld(fx, fy);
          const tox = rand(0.05, 0.28), toy = rand(0.30, 0.45);
          const to = imgToWorld(tox, toy);
          st.from = f; st.to = to;
          st.mesh.visible = true;
          st.mesh.scale.setScalar(planeH / 83);
        }
        return;
      }
      st.t += dt;
      const k = st.t / st.dur;
      if (k >= 1) { st.active = false; st.mesh.visible = false; st.next = rand(6, 10); return; }
      const x = lerp(st.from.x, st.to.x, k), y = lerp(st.from.y, st.to.y, k) - k * k * 6;
      st.mesh.position.set(x, y, 5);
      st.mesh.rotation.z = Math.atan2((st.to.y - st.from.y) - 6, st.to.x - st.from.x);
      st.mesh.material.opacity = Math.sin(k * Math.PI) * 0.9;
    });

    // bursts
    burstPool.forEach(b => {
      if (!b.active) return;
      b.t += dt;
      const k = b.t / b.dur;
      if (k >= 1) { b.active = false; b.mesh.visible = false; return; }
      b.v.y -= 22 * dt;
      b.mesh.position.x += b.v.x * dt;
      b.mesh.position.y += b.v.y * dt;
      b.mesh.rotation.x += b.rv.x * dt;
      b.mesh.rotation.y += b.rv.y * dt;
      b.mesh.material.opacity = 1 - k;
    });

    if (fireflies) fireflies.material.uniforms.uTime.value = t;

    // sync UI mood to the video's day→night loop (dark half gets a deeper grade)
    if (bgVideo && videoStarted) {
      const night = bgVideo.currentTime > 9.4;
      if (night !== document.body.classList.contains('phase-night')) {
        document.body.classList.toggle('phase-night', night);
      }
    }

    renderer.render(scene, camera);
  }

  /* ───────── input ───────── */
  let downAt = 0;
  window.addEventListener('pointermove', e => {
    mouse.px = e.clientX; mouse.py = e.clientY;
    mouse.tx = (e.clientX / W) * 2 - 1;
    mouse.ty = (e.clientY / H) * 2 - 1;
    const torch = document.getElementById('torch');
    torch.style.setProperty('--tx', e.clientX + 'px');
    torch.style.setProperty('--ty', e.clientY + 'px');
  }, { passive: true });

  window.addEventListener('pointerdown', e => {
    if (e.target.closest('button, a, input, .prompt-card, .rrow, .podium-card')) return;
    if (!renderer) return;
    const w = screenToWorld2(e.clientX, e.clientY);
    spawnBurst(w.x, w.y);
  }, { passive: true });

  window.addEventListener('resize', () => { layout(); });

  /* ═════════════ UI LIFE (GSAP) ═════════════ */
  function uiLife() {
    if (!window.gsap) return;
    gsap.registerPlugin(ScrollTrigger);

    // ── intro timeline ──
    const set = gsap.set, tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    const g = s => document.querySelector(s);
    set('[data-anim]', { opacity: 0 });
    set(g('[data-anim="brand"]'), { y: -26 });
    set(g('[data-anim="pill"]'), { y: -26 });
    set(g('[data-anim="badge"]'), { y: 18, scale: 0.92 });
    set(g('[data-anim="l1"]'), { y: 34, opacity: 0 });
    set(g('[data-anim="l2"]'), { y: 34, opacity: 0 });
    set(g('[data-anim="card"]'), { y: 44, scale: 0.97 });
    set(g('[data-anim="cta"]'), { y: 30, scale: 0.94 });
    set(g('[data-anim="features"]'), { y: 36 });
    set(g('[data-anim="scroll"]'), { opacity: 0 });

    tl.to(g('[data-anim="brand"]'), { opacity: 1, y: 0, duration: 0.7 }, 0.15)
      .to(g('[data-anim="pill"]'), { opacity: 1, y: 0, duration: 0.7 }, 0.25)
      .to(g('[data-anim="badge"]'), { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(2)' }, 0.45)
      .to(g('[data-anim="l1"]'), { opacity: 1, y: 0, duration: 0.9 }, 0.6)
      .to(g('[data-anim="l2"]'), { opacity: 1, y: 0, duration: 0.9 }, 0.75)
      .to(g('[data-anim="card"]'), { opacity: 1, y: 0, scale: 1, duration: 0.9 }, 0.95)
      .to(g('[data-anim="cta"]'), { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'back.out(1.8)' }, 1.2)
      .to(g('[data-anim="features"]'), { opacity: 1, y: 0, duration: 0.8 }, 1.35)
      .to(g('[data-anim="scroll"]'), { opacity: 1, duration: 0.8 }, 1.7);

    // card tools stagger
    tl.from('.card-tools .tpill, .card-tools .tdiv', { opacity: 0, y: 14, stagger: 0.07, duration: 0.5 }, 1.1);

    // ── chip typing rotator ──
    const topics = [
      'اكتشف درسًا حول أفعال اللغة الإنجليزية',
      'اشرح الكسور بطريقة مضحكة',
      'أنشئ لعبة تفاعلية عن جدول الضرب',
      'لخّص قصة «السدّ» في 5 مشاهد'
    ];
    const target = document.getElementById('typeTarget');
    const rotator = target.closest('.chip-rotator');
    let ti = 0, ci = 0, deleting = false;
    (function typeLoop() {
      const cur = topics[ti];
      if (!deleting) {
        ci++;
        target.textContent = cur.slice(0, ci);
        rotator.classList.toggle('empty', ci === 0);
        if (ci >= cur.length) { deleting = true; setTimeout(typeLoop, 1900); return; }
      } else {
        ci -= 2;
        if (ci <= 0) { ci = 0; deleting = false; ti = (ti + 1) % topics.length; }
        target.textContent = cur.slice(0, Math.max(ci, 0));
        rotator.classList.toggle('empty', ci === 0);
        if (!deleting && ci === 0) { setTimeout(typeLoop, 120); return; } // near-instant: never leave the pill blank
      }
      setTimeout(typeLoop, deleting ? 22 : rand(42, 78));
    })();

    // ── card spotlight ──
    const card = document.querySelector('.prompt-card');
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--sx', ((e.clientX - r.left) / r.width * 100) + '%');
      card.style.setProperty('--sy', ((e.clientY - r.top) / r.height * 100) + '%');
    });

    // ── scroll hint ──
    document.querySelector('.scroll-hint').addEventListener('click', () => {
      document.getElementById('board').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
    });

    // ── leaderboard reveal ──
    gsap.utils.toArray('[data-board]').forEach(el => {
      gsap.to(el, {
        opacity: 1, y: 0, duration: 0.9, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%' }
      });
    });
    // xp fills grow when visible
    gsap.utils.toArray('.xp-fill').forEach(el => {
      const w = el.style.getPropertyValue('--w');
      gsap.fromTo(el, { scaleX: 0.02 }, {
        scaleX: 1, duration: 1.3, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 92%' },
        onStart: () => { el.style.width = w; }
      });
    });

    // ── voxel avatars: deterministic 8×8 pixel faces from name seeds ──
    function hashSeed(str) {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    }
    function mulberry(seed) {
      return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    function drawAvatar(seedStr) {
      const rng = mulberry(hashSeed(seedStr));
      const skins = ['#eab38b', '#c98d63', '#8d5a3b', '#f0c9a0'];
      const hairs = ['#3a2a18', '#59361f', '#141018', '#7a3b1e', '#2c3a5c', '#5c2c3a'];
      const bgs   = ['#5b48c9', '#3e7fca', '#c95b8a', '#48a97e', '#c9793e', '#7d53c9'];
      const skin = skins[(rng() * skins.length) | 0];
      const hair = hairs[(rng() * hairs.length) | 0];
      const bg = bgs[(rng() * bgs.length) | 0];
      const style = (rng() * 3) | 0; // 0 short, 1 fringe, 2 long
      const eyeCol = ['#1d1a2e', '#233a1d'][(rng() * 2) | 0];
      const c = document.createElement('canvas'); c.width = c.height = 8;
      const g = c.getContext('2d');
      // backdrop
      g.fillStyle = bg; g.fillRect(0, 0, 8, 8);
      // darker bg frame (vignette-ish pixel border)
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 7, 8, 1); g.fillRect(7, 0, 1, 8);
      // head 4x4 centered
      const hx = 2, hy = 2;
      g.fillStyle = skin; g.fillRect(hx, hy, 4, 4);
      // hair
      g.fillStyle = hair;
      g.fillRect(hx, hy - 1, 4, 1);
      if (style === 0) g.fillRect(hx - 1, hy, 1, 2), g.fillRect(hx + 4, hy, 1, 2);
      if (style === 1) { g.fillRect(hx, hy, 4, 1); g.fillRect(hx + 3, hy + 1, 1, 1); }
      if (style === 2) { g.fillRect(hx - 1, hy - 1, 6, 1); g.fillRect(hx - 1, hy, 1, 4); g.fillRect(hx + 4, hy, 1, 4); }
      // eyes
      g.fillStyle = eyeCol;
      g.fillRect(hx, hy + 1, 1, 1); g.fillRect(hx + 3, hy + 1, 1, 1);
      // mouth
      g.fillStyle = 'rgba(0,0,0,.45)';
      g.fillRect(hx + 1, hy + 3, 2, 1);
      // hoodie collar at bottom
      g.fillStyle = ['#7c5cf0', '#ff8a3d', '#3ea9a0'][(rng() * 3) | 0];
      g.fillRect(hx - 1, hy + 4, 6, 2);
      return c.toDataURL();
    }
    document.querySelectorAll('.avatar').forEach(el => {
      el.style.backgroundImage = `url(${drawAvatar(el.dataset.seed || 'x')})`;
      el.style.backgroundSize = '100% 100%';
    });

    // ── live counter ──
    const liveEl = document.getElementById('liveCount');
    let live = 1248;
    setInterval(() => {
      live = Math.max(1200, live + ((Math.random() * 9) | 0) - 3);
      liveEl.textContent = live.toLocaleString('en-US');
    }, 1500);

    // ── rank rows: XP ticks + bubble-up swaps ──
    // honest fills: every bar maps to the same XP→% scale (top XP = 98%)
    (function normalizeXPBars() {
      const readXP = el => {
        const bdi = el.querySelector('.p-xp-num bdi, .r-xp bdi');
        return parseInt(bdi.textContent.replace(/[,\u200f]/g, ''), 10) || 0;
      };
      const cards = [...document.querySelectorAll('.podium-card, .rrow')];
      const max = Math.max(...cards.map(readXP));
      cards.forEach(c => {
        const pct = Math.round(6 + (readXP(c) / max) * 92);
        c.querySelector('.xp-fill').style.setProperty('--w', pct + '%');
      });
    })();
    function renumber() {
      document.querySelectorAll('.rrow').forEach((r, i) => {
        r.querySelector('.r-num').textContent = String(i + 4);
      });
    }
    function getXP(r) {
      return parseInt(r.querySelector('.r-xp bdi').textContent.replace(/[,\u200f]/g, ''), 10);
    }
    function tickRow() {
      const domRows = Array.from(document.querySelectorAll('.rrow'));
      const i = (Math.random() * domRows.length) | 0;
      const r = domRows[i];
      const xpEl = r.querySelector('.r-xp bdi');
      const fill = r.querySelector('.xp-fill');
      const cur = getXP(r);
      const add = ((Math.random() * 5) | 0) * 10 + 10;
      xpEl.textContent = (cur + add).toLocaleString('en-US');
      const w = parseFloat(getComputedStyle(fill).getPropertyValue('--w')) || 50;
      fill.style.setProperty('--w', Math.min(97, w + add / 60) + '%');
      r.classList.add('flash');
      setTimeout(() => r.classList.remove('flash'), 900);
      // bubble up: overtook the row above → swap upward (keeps XP descending)
      if (i > 0 && (cur + add) > getXP(domRows[i - 1])) {
        const above = domRows[i - 1];
        const ra = above.getBoundingClientRect(), rb = r.getBoundingClientRect();
        const parent = above.parentElement;
        const marker = document.createElement('div');
        parent.insertBefore(marker, above);
        parent.insertBefore(r, marker);
        parent.insertBefore(above, marker.nextSibling);
        parent.removeChild(marker);
        const ra2 = above.getBoundingClientRect(), rb2 = r.getBoundingClientRect();
        gsap.from(above, { y: ra.top - ra2.top, duration: 0.7, ease: 'power2.inOut' });
        gsap.from(r, { y: rb.top - rb2.top, duration: 0.7, ease: 'power2.inOut' });
        renumber();
        gsap.from([above, r].map(x => x.querySelector('.r-num')), {
          scale: 1.4, backgroundColor: 'rgba(255,176,84,.4)', duration: 0.5, ease: 'back.out(2)', clearProps: 'backgroundColor,scale'
        });
        gsap.fromTo(r, { backgroundColor: 'rgba(255,200,120,.2)' }, { backgroundColor: 'rgba(255,200,120,0)', duration: 1.4, clearProps: 'backgroundColor' });
      }
    }
    setInterval(tickRow, 3200);

    // ── activity ticker (short messages on narrow screens) ──
    const msgsFull = [
      'سارة أكملت درس «الكسور» وحصلت على ‎+50 خبرة ✦',
      'عمر بنى «قلعة جدول الضرب» — درس تفاعلي جديد ✦',
      'ليان رفعت مستواها إلى 17 بعد تحدي المساواة',
      'خالد أتقن درس «أفعال اللغة الإنجليزية» في 4 دقائق',
      'نور شاركت درسها مع الفصل — 12 طالبًا انضموا الآن',
      'زياد فتح صندوق الإنجازات ووجد درسًا جديدًا ✦'
    ];
    const msgsShort = [
      'سارة أكملت درس «الكسور» ✦',
      'عمر بنى قلعة الجداول الضربية ✦',
      'ليان وصلت للمستوى 17',
      'خالد أتقن درس الأفعال ✦',
      'نور شاركت درسها مع الفصل',
      'زياد فتح صندوق الإنجازات ✦'
    ];
    const line = document.getElementById('tickerLine');
    line.textContent = (innerWidth < 640 ? msgsShort : msgsFull)[0];
    let mi = 0;
    setInterval(() => {
      const pool = innerWidth < 640 ? msgsShort : msgsFull;
      mi = (mi + 1) % pool.length;
      gsap.to(line, {
        y: -28, opacity: 0, duration: 0.35, ease: 'power2.in',
        onComplete: () => {
          line.textContent = pool[mi];
          gsap.fromTo(line, { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: 'power2.out' });
        }
      });
    }, 3800);
  }

  /* ───────── boot ───────── */
  function boot() {
    if (renderer) {
      layout();   // computes planeW/planeH before anything anchors to the plate
      build();
      layout();   // applies anchors with real sizes
      clock.getDelta();
      if (REDUCED) {
        renderer.render(scene, camera);
      } else {
        tick();
      }
    }
    // loader out + intro
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      document.getElementById('loader').classList.add('done');
      document.body.classList.add('ready');
      uiLife();
    };
    if (document.readyState === 'complete') setTimeout(finish, 500);
    else window.addEventListener('load', () => setTimeout(finish, 500));
    // safety: never keep loader > 4s
    setTimeout(finish, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
