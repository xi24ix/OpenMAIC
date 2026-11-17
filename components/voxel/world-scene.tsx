'use client';

/**
 * The voxel world background — the "living voxel world" engine.
 *
 * One static world painting (public/voxel/world3d/world.jpg) with a hand-built
 * depth map (WebGL parallax + wind) carries everything that moves: glow
 * sprites, drifting voxel clouds cut out of the art, animated cutouts of the
 * lanterns / student / cat, portal sparks, embers, leaves, fireflies and
 * shooting stars — all on one small canvas + an optional one-pass WebGL
 * shader. No video, no three.js: this replaces the looping-cinematic world
 * with something that renders in a fraction of the GPU/CPU budget.
 *
 * Mounted by pages that opt into the voxel style (homepage, generation
 * preview). Coordinates inside are "design pixels" of the 1672x941 art; the
 * stage scales to the viewport the same way the hero UI does.
 *
 * The hero talks to the world through plain DOM: the engine binds the Create
 * button (.w3-cta), the composer (.w3-composer) and the prompt textarea
 * (#w3-prompt) when they exist, so hovering/typing/clicking reacts on the
 * world (portal flare, lantern brightening, fireflies around the composer).
 */
import { useEffect, useRef } from 'react';

const ASSET = '/voxel/world3d';
const IMG = {
  world: `${ASSET}/world.jpg`,
  depth: `${ASSET}/depth.png`,
  sky: `${ASSET}/sky.png`,
  ca: `${ASSET}/ca.png`,
  cb: `${ASSET}/cb.png`,
  cc: `${ASSET}/cc.png`,
  l1: `${ASSET}/l1.png`,
  l2: `${ASSET}/l2.png`,
  pack: `${ASSET}/pack.png`,
  sh: `${ASSET}/sh.png`,
  fr: `${ASSET}/fr.png`,
  tail: `${ASSET}/tail.png`,
  ch: `${ASSET}/ch.png`,
  el: `${ASSET}/el.png`,
  er: `${ASSET}/er.png`,
  lid: `${ASSET}/lid.png`,
} as const;

/* ───────── shaders: depth parallax + foliage wind + time of day ───────── */
const VS = 'attribute vec2 p;varying vec2 vUv;void main(){vUv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}';
const FS = `precision highp float;varying vec2 vUv;
uniform sampler2D uW,uD,uS,uC;uniform vec2 uA;uniform float uT,uWind,uTod;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
void main(){
  vec2 uv=vUv;
  float d=texture2D(uD,uv).r;
  vec2 s=uv-uA*(d-.5);
  d=texture2D(uD,s).r;
  s=uv-uA*(d-.5);
  vec4 dg=texture2D(uD,s);
  float w=dg.g*uWind;
  if(w>.002){
    float wave=sin(uT*1.35+s.y*9.+s.x*5.)*.62+sin(uT*2.7+s.y*23.-s.x*9.)*.38+.35*sin(uT*.6+s.x*3.);
    s.x-=w*2.4/1672.*wave;
    s.y-=w*.9/941.*sin(uT*1.9+s.x*17.);
  }
  vec3 col=texture2D(uW,s).rgb;
  col*=1.+w*.07*sin(uT*1.7+s.x*60.+s.y*40.);
  float band=smoothstep(.60,.70,uv.y)*(1.-smoothstep(.76,.86,uv.y))*(1.-smoothstep(.30,.55,d));
  float n=vn(vec2(uv.x*5.+uT*.03,uv.y*14.))*.6+vn(vec2(uv.x*11.-uT*.05,uv.y*30.+3.))*.4;
  col+=vec3(.55,.32,.7)*band*n*n*.07;
  float q=uTod;
  if(q>.001){
    float hm=smoothstep(.40,.62,uv.y)*(1.-smoothstep(.80,.92,uv.y))*(1.-smoothstep(.25,.5,d));
    float L=dot(col,vec3(.3,.59,.11));
    vec3 tM=vec3(1.45,.52,1.25),tI=vec3(.55,.5,1.6);
    vec3 tc=q<.5?tM:mix(tM,tI,(q-.5)*2.);
    float am=q<.5?q*2.:1.;
    vec3 hcol=mix(col,vec3(L)*tc,am)*(1.-.28*smoothstep(.5,1.,q));
    vec3 gcol=col*mix(vec3(1.),vec3(.76,.8,1.),q)*(1.-.12*q);
    vec3 night=mix(gcol,hcol,hm);
    float keep=smoothstep(.5,.85,L)*(1.-hm*.85);
    col=mix(night,col*(1.+.12*q),keep);
  }
  vec4 c=texture2D(uC,uv+uA*.5);
  float m=texture2D(uS,s).a;
  col=col*(1.-c.a*m)+c.rgb*m;
  gl_FragColor=vec4(col,1.);
}`;

/* ───────── tiny helpers ───────── */
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const TAU = Math.PI * 2;
const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((ok, bad) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = bad;
    i.src = src;
  });

type Sprite = HTMLCanvasElement;
function glowSprite(rgb: string): Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, `rgba(${rgb},1)`);
  r.addColorStop(0.22, `rgba(${rgb},.6)`);
  r.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return c;
}

/* ───────── the world ───────── */
function mountWorld(root: HTMLElement): () => void {
  const stage = root.querySelector<HTMLElement>('.w3-stage')!;
  const world = root; // CSS variables (--n/--hue/--hov/--pf) live on the world root
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STILL = reduce;
  const cleanups: (() => void)[] = [];
  let disposed = false;
  let raf = 0;

  const fx = stage.querySelector<HTMLCanvasElement>('.w3-fx')!;
  const ctx = fx.getContext('2d')!;
  const glc = stage.querySelector<HTMLCanvasElement>('.w3-gl')!;
  const cl = stage.querySelector<HTMLCanvasElement>('.w3-cl')!;
  const cctx = cl.getContext('2d')!;

  /* state */
  let ku = 1, AX = 0, AY = 0, GLOK = false, GL: any = null, DP: Uint8ClampedArray | null = null;
  let DW = 0, DH = 0, cloudDirty = true, gustNow = 0.5, frameNo = 0, glScale = 1, ema = 16;
  let TODP = 0, pf = 0, hov = 0, hovT = 0, flare = 0, lampKick = 0, typingUntil = 0, typeL = 0;
  let SKYD: Uint8ClampedArray | null = null;
  const bursts: any[] = [], puffs: any[] = [];
  let lastN = -1, lastPf = -1, lastHov = -1;

  const TOD_PERIOD = 240; // slow time of day: sunset → magenta → indigo → back
  const todAt = (T: number) => (STILL ? 0 : 0.5 - 0.5 * Math.cos((T / TOD_PERIOD) * Math.PI * 2));
  const toDesign = (el: Element) => {
    const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect(), k = s.width / 1672;
    return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k };
  };
  const perim = (r: { x: number; y: number; w: number; h: number }, u: number, off: number) => {
    let d = (u % 1) * 2 * (r.w + r.h);
    if (d < r.w) return [r.x + d, r.y - off]; d -= r.w;
    if (d < r.h) return [r.x + r.w + off, r.y + d]; d -= r.h;
    if (d < r.w) return [r.x + r.w - d, r.y + r.h + off]; d -= r.w;
    return [r.x - off, r.y + r.h - d];
  };
  const depthAt = (x: number, y: number) =>
    DP
      ? DP[
          (Math.min(DH - 1, Math.max(0, (y * DH) / 941 | 0)) * DW +
            Math.min(DW - 1, Math.max(0, (x * DW) / 1672 | 0))) *
          4
        ] / 255
      : 0.5;
  const gust = (T: number) => 0.2 + 0.8 * Math.max(0, 0.5 + 0.5 * Math.sin(T * 0.31) * Math.sin(T * 0.83 + 1.3));

  /* ---------- FX elements: glow sprites, cutout sprites, wraps ---------- */
  const REG: { e: HTMLElement; x: number; y: number; z?: number }[] = [];
  const reg = (e: HTMLElement, x: number, y: number, z?: number) => {
    REG.push({ e, x, y, z });
    return e;
  };
  const mk = (tag: string, cls: string, vars: Record<string, string | number>, parent?: HTMLElement) => {
    const e = document.createElement(tag);
    e.className = cls;
    for (const k in vars) e.style.setProperty('--' + k, String(vars[k]));
    if (parent) parent.appendChild(e);
    else stage.insertBefore(e, fx);
    return e;
  };
  const glow = (
    x: number, y: number, w: number, h: number | undefined, c: string,
    a = 'pulse', t = 5, d = 0, z?: number,
  ) =>
    // keyframes are prefixed (w3-pulse…) to stay clear of Tailwind's own
    reg(mk('i', 'w3-g', { x, y, w, h: h ?? w, c, a: 'w3-' + a, t: `${t}s`, d: `${d}s` }), x, y, z);
  const SWING: { e: HTMLElement; x: number; y: number; n: number }[] = [];
  const swing = (n: number, x: number, y: number, w: number, h: number, c: string, a: string, t: number, d: number) => {
    const e = glow(x, y, w, h, c, a, t, d, n === 1 ? 0.93 : 0.95);
    e.classList.add('w3-lamp');
    SWING.push({ e, x, y, n });
  };
  const imgEl = (src: string, cls?: string) => {
    const i = new Image();
    i.src = src;
    i.alt = '';
    if (cls) i.className = cls;
    return i;
  };
  const cutSprite = (src: string, x: number, y: number, w: number, h: number, px0: number, py0: number, parent?: HTMLElement) => {
    const e = mk('div', 'w3-sp w3-sw', { x, y, w, h, px0, py0 }, parent);
    e.appendChild(imgEl(src));
    return e;
  };

  // lanterns: cut out of the art, they swing on their chains
  const L1 = reg(cutSprite(IMG.l1, 212, 197, 71, 83, 41, 8), 253, 205, 0.93);
  const L2 = reg(cutSprite(IMG.l2, 48, 250, 72, 176, 57, 7), 105, 257, 0.95);

  // atmosphere
  glow(836, 668, 980, 190, 'rgba(255,120,80,.28)', 'breathe', 9, 0, 0.5).classList.add('w3-atm');
  glow(836, 560, 1100, 520, 'rgba(255,140,90,.06)', 'breathe', 13, -4, 0.5).classList.add('w3-atm');
  // lantern light + spill on trunk and student
  swing(1, 247, 243, 170, 170, 'rgba(255,176,80,.95)', 'flick', 3.3, 0);
  swing(1, 247, 243, 360, 360, 'rgba(255,150,60,.20)', 'flick', 3.3, -0.4);
  swing(2, 85, 380, 170, 170, 'rgba(255,176,80,.95)', 'flick', 4.1, -1.2);
  swing(2, 85, 380, 360, 360, 'rgba(255,150,60,.2)', 'flick', 4.1, -1.5);
  glow(150, 520, 300, 360, 'rgba(255,140,70,.12)', 'flick', 4.1, -1.6, 0.9);
  glow(122, 586, 80, 80, 'rgba(255,140,60,.75)', 'pulse', 2.8, 0, 0.88); // backpack emblem
  // castle
  glow(1377, 266, 170, 115, 'rgba(255,200,110,.5)', 'pulse', 5.5).classList.add('w3-lit');
  glow(1377, 334, 100, 80, 'rgba(255,170,80,.6)', 'flick', 3.7).classList.add('w3-lit');
  glow(1390, 290, 460, 300, 'rgba(255,150,90,.07)', 'breathe', 8, 0, 0.45).classList.add('w3-atm');
  [[1397, 180], [1412, 181], [1380, 212], [1421, 226], [1327, 255], [1451, 321], [1516, 281], [1607, 307], [1360, 310], [1296, 330]].forEach((p, i) =>
    glow(p[0], p[1], 30, 30, 'rgba(255,190,100,.7)', 'win', 3 + (i % 4) * 1.3, -i * 0.7).classList.add('w3-lit'),
  );
  // gem cube
  glow(1268, 78, 140, 140, 'rgba(150,170,255,.5)', 'pulse', 4.6);
  glow(1226, 275, 70, 70, 'rgba(210,180,255,.55)', 'pulse', 5.2, -2);
  reg(mk('i', 'w3-flare', {}), 1268, 78);
  // portal
  glow(1547, 626, 300, 300, 'rgba(176,90,255,.38)', 'pulse', 3.8, 0, 0.63).classList.add('w3-portal');
  glow(1547, 626, 160, 210, 'rgba(235,170,255,.5)', 'pulse', 2.6, -0.8, 0.63).classList.add('w3-portal');
  reg(mk('i', 'w3-ring w3-portal', {}), 1547, 626, 0.63);
  reg(mk('i', 'w3-ring w3-b w3-portal', {}), 1547, 626, 0.63);
  glow(1500, 700, 300, 80, 'rgba(190,110,255,.35)', 'breathe', 4, 0, 0.66).classList.add('w3-portal');
  // glowing stairs + platform + candles
  glow(1485, 708, 190, 36, 'rgba(255,160,80,.78)', 'pulse', 3.4, 0, 0.74);
  glow(1440, 733, 220, 34, 'rgba(255,150,70,.72)', 'pulse', 3.9, -1.3, 0.76);
  glow(1405, 760, 170, 28, 'rgba(255,140,70,.6)', 'pulse', 4.4, -2.1, 0.78);
  glow(836, 718, 520, 52, 'rgba(255,140,80,.78)', 'pulse', 5.2, 0, 0.62);
  glow(680, 696, 70, 70, 'rgba(255,170,80,.9)', 'flick', 2.4, 0, 0.6);
  glow(1214, 743, 82, 82, 'rgba(255,170,80,.9)', 'flick', 2.9, -0.8, 0.62);
  glow(374, 716, 46, 46, 'rgba(255,170,80,.9)', 'flick', 2.5, -0.3, 0.86);
  // aurora ribbons in the dark sky behind the headline
  const AURORAS: [number, number, number, number, string, number, number][] = [
    [760, 120, 760, 200, 'rgba(110,90,255,.9)', 19, 0],
    [980, 260, 700, 160, 'rgba(90,170,255,.8)', 25, -9],
    [640, 300, 620, 140, 'rgba(200,90,255,.8)', 31, -17],
  ];
  AURORAS.forEach((q) =>
    reg(mk('i', 'w3-aur', { x: q[0], y: q[1], w: q[2], h: q[3], c: q[4], t: `${q[5]}s`, d: `${q[6]}s` }), q[0], q[1], 0),
  );
  // waterfalls
  [[1472, 358, 50, 118, 1.1], [1366, 520, 30, 92, 1.3], [482, 648, 18, 54, 1.2], [1306, 668, 16, 36, 1.4]].forEach((q) =>
    reg(mk('i', 'w3-fall', { x: q[0], y: q[1], w: q[2], h: q[3], t: `${q[4]}s` }), q[0] + q[2] / 2, q[1] + q[3] / 2),
  );
  // characters: breathe, and their heads are separate sprites (cat looks around + blinks, student tilts)
  const wrap = (wx: number, wy: number, t: string, d: string, z: number) => reg(mk('div', 'w3-wrap', { wx, wy, t, d }), wx, wy, z);
  const worldBg = (e: HTMLElement) => {
    e.style.backgroundImage = `url(${IMG.world})`;
    return e;
  };
  const stu = wrap(198, 704, '4.6s', '-0s', 0.88);
  worldBg(mk('i', 'w3-char', { x: 92, y: 414, w: 212, h: 290 }, stu));
  const PK = cutSprite(IMG.pack, 77, 534, 123, 120, 73, 7, stu); // backpack, hangs from its straps
  const SH = cutSprite(IMG.sh, 118, 408, 135, 105, 72, 92, stu);
  const FR = cutSprite(IMG.fr, 89, 38, 46, 47, 23, 10, SH); // hair fringe
  const cat = wrap(334, 740, '3.9s', '-1.4s', 0.86);
  worldBg(mk('i', 'w3-char', { x: 280, y: 584, w: 108, h: 156 }, cat));
  const TL = cutSprite(IMG.tail, 277, 706, 37, 36, 29, 16, cat); // tail
  const CH = cutSprite(IMG.ch, 303, 584, 76, 69, 47, 56, cat);
  const EL = cutSprite(IMG.el, 5, 3, 27, 22, 12, 15, CH); // ears ride on the head
  const ER = cutSprite(IMG.er, 35, 1, 30, 24, 13, 18, CH);
  const lid = imgEl(IMG.lid, 'w3-lid');
  lid.style.left = 'calc(50 * var(--u))';
  lid.style.top = 'calc(25 * var(--u))';
  CH.appendChild(lid);
  // slow colour cycle
  mk('i', 'w3-wash', {});

  /* ---------- life: lanterns swing, the cat looks around / flicks tail + ears / blinks, the student sways ---------- */
  const catS = { a: 0, ta: 0, next: 2.2, fl: -9, nextBlink: 2.6, lidOff: 0, tail: -9, nextTail: 3, ear: -9, earSide: 0, nextEar: 4 };
  const rot = (e: HTMLElement, a: number) => e.style.setProperty('--rot', a.toFixed(3) + 'deg');
  const setVar = (k: string, v: string) => world.style.setProperty(k, v);

  function animate(T: number, dt: number) {
    const g = STILL ? 0 : gust(T), s = dt / 1000;
    gustNow = g;
    const a1 = STILL ? 0 : (1.3 + 1.9 * g) * Math.sin(T * 1.96) + 0.3 * Math.sin(T * 3.3 + 1);
    const a2 = STILL ? 0 : (0.9 + 1.4 * g) * Math.sin(T * 1.62 + 2.1) + 0.25 * Math.sin(T * 2.9);
    rot(L1, a1);
    rot(L2, a2);
    for (const w of SWING) {
      const px = w.n === 1 ? 253 : 105, py = w.n === 1 ? 205 : 257;
      const r = ((w.n === 1 ? a1 : a2) * Math.PI) / 180, vx = w.x - px, vy = w.y - py;
      w.e.style.setProperty('--sx', (((Math.cos(r) - 1) * vx - Math.sin(r) * vy) * ku).toFixed(2) + 'px');
      w.e.style.setProperty('--sy', ((Math.sin(r) * vx + (Math.cos(r) - 1) * vy) * ku).toFixed(2) + 'px');
    }
    // student: slow head tilt, hair fringe flutters in gusts, the backpack sways on its straps
    rot(SH, STILL ? 0 : 1.0 * Math.sin(T * 0.5) + 0.45 * Math.sin(T * 1.3 + 0.7) + g * 0.3 * Math.sin(T * 6.1));
    rot(FR, STILL ? 0 : (1.1 + 1.7 * g) * Math.sin(T * 2.6 + 1.1) + 0.45 * Math.sin(T * 4.7));
    rot(PK, STILL ? 0 : 0.9 * Math.sin(T * 1.15 + 0.6) + 0.5 * Math.sin(T * 0.5 + 1) + g * 0.7 * Math.sin(T * 3.4));
    if (!STILL) {
      // cat: looks around now and then
      if (T > catS.next) {
        catS.ta = pick([-4.5, -3, 2.5, 4, 0, 0, -1.5]);
        catS.next = T + rnd(2.2, 5.5);
        if (Math.random() < 0.4) catS.fl = T;
      }
      catS.a += (catS.ta - catS.a) * (1 - Math.exp(-s * 4.5));
      const fl = T - catS.fl;
      const flick = fl < 0.45 ? 1.7 * Math.sin(fl * 46) * Math.exp(-fl * 11) : 0;
      rot(CH, catS.a + flick);
      // tail: idle sway + a flick every few seconds
      if (T > catS.nextTail) {
        catS.tail = T;
        catS.nextTail = T + rnd(3.5, 8);
      }
      const tf = T - catS.tail;
      rot(TL, 1.4 * Math.sin(T * 0.9) + (tf < 1.8 ? 9 * Math.sin(tf * 13) * Math.exp(-tf * 2.6) : 0));
      // ears: an occasional twitch (left, right or both)
      if (T > catS.nextEar) {
        catS.ear = T;
        catS.earSide = pick([0, 1, 2]);
        catS.nextEar = T + rnd(2.5, 7);
      }
      const ef = T - catS.ear;
      const tw = ef < 0.5 ? Math.sin(ef * 40) * Math.exp(-ef * 10) : 0;
      rot(EL, catS.earSide !== 1 ? -11 * tw : 0);
      rot(ER, catS.earSide !== 0 ? 11 * tw : 0);
      // blink: mostly quick, now and then a slow cat-blink
      if (T > catS.nextBlink) {
        const slow = Math.random() < 0.3;
        lid.style.transitionDuration = slow ? '.28s' : '.07s';
        lid.style.opacity = '1';
        catS.lidOff = T + (slow ? 1.1 : 0.13);
        catS.nextBlink = T + (slow ? rnd(8, 14) : rnd(2.6, 6.5));
      }
      if (catS.lidOff && T > catS.lidOff) {
        lid.style.opacity = '0';
        catS.lidOff = 0;
      }
    }
    // ---- the page talks to the world: hovering Create flares the portal + brightens the lanterns
    hov += (hovT - hov) * (1 - Math.exp(-s / 0.22));
    flare = Math.max(0, flare - s * 1.1);
    lampKick = Math.max(0, lampKick - s * 1.4);
    typeL += ((T * 1000 < typingUntil ? 1 : 0) - typeL) * (1 - Math.exp(-s / 0.45));
    pf = Math.max(hov * 0.85, flare);
    const lamp = Math.max(hov, lampKick);
    if (Math.abs(pf - lastPf) > 0.004) {
      setVar('--pf', pf.toFixed(3));
      lastPf = pf;
    }
    if (Math.abs(lamp - lastHov) > 0.004) {
      setVar('--hov', lamp.toFixed(3));
      lastHov = lamp;
    }
    // ---- slow time of day (CSS variables drive the glows; the shader gets TODP)
    TODP = todAt(T);
    if (Math.abs(TODP - lastN) > 0.002) {
      lastN = TODP;
      setVar('--n', TODP.toFixed(3));
      setVar('--hue', (-(TODP < 0.5 ? TODP * 2 * 55 : 55 + (TODP - 0.5) * 2 * 75)).toFixed(1));
    }
  }

  /* ---------- the page's composer + CTA drive world reactions ----------
     Bound by delegation on document: the hero is a separate dynamic chunk, so
     it may mount after this engine (or never, on other voxel pages) and the
     hooks must survive either order. */
  const onCtaOver = (e: PointerEvent) => {
    if ((e.target as Element | null)?.closest?.('.w3-cta')) hovT = 1;
  };
  const onCtaOut = (e: PointerEvent) => {
    if ((e.target as Element | null)?.closest?.('.w3-cta')) hovT = 0;
  };
  const onFocusIn = (e: FocusEvent) => {
    if ((e.target as Element | null)?.closest?.('.w3-cta')) hovT = 1;
  };
  const onFocusOut = (e: FocusEvent) => {
    if ((e.target as Element | null)?.closest?.('.w3-cta')) hovT = 0;
  };
  const onCtaClick = (e: MouseEvent) => {
    const cta = (e.target as Element | null)?.closest?.('.w3-cta') as HTMLElement | null;
    if (!cta) return;
    const r = toDesign(cta), x0 = r.x + r.w / 2, y0 = r.y + r.h / 2, now = performance.now();
    lampKick = 1;
    for (let i = 0; i < 36; i++) {
      const x1 = 1547 + rnd(-22, 22), y1 = 626 + rnd(-34, 34);
      bursts.push({
        t0: now + rnd(0, 380), dur: rnd(900, 1500), x0: x0 + rnd(-60, 60), y0: y0 + rnd(-14, 14), x1, y1,
        cx: (x0 + x1) / 2 + rnd(-90, 90), cy: Math.min(y0, y1) - rnd(90, 260),
        k: pick([S.gold, S.gold, S.white, S.violet, S.pink]),
      });
    }
  };
  const onType = (e: Event) => {
    if ((e.target as HTMLElement | null)?.id === 'w3-prompt') typingUntil = performance.now() + 1700;
  };
  addEventListener('pointerover', onCtaOver, true);
  addEventListener('pointerout', onCtaOut, true);
  addEventListener('focusin', onFocusIn);
  addEventListener('focusout', onFocusOut);
  addEventListener('click', onCtaClick);
  addEventListener('input', onType, true);
  cleanups.push(() => {
    removeEventListener('pointerover', onCtaOver, true);
    removeEventListener('pointerout', onCtaOut, true);
    removeEventListener('focusin', onFocusIn);
    removeEventListener('focusout', onFocusOut);
    removeEventListener('click', onCtaClick);
    removeEventListener('input', onType, true);
  });

  /* ====================== PARTICLES (canvas, design px) ====================== */
  let K = 1, nextShot = 5000, shot: any = null;
  const S = {
    gold: glowSprite('255,208,112'), orange: glowSprite('255,140,70'), violet: glowSprite('190,150,255'),
    pink: glowSprite('255,150,230'), blue: glowSprite('140,190,255'), white: glowSprite('255,255,255'),
    green: glowSprite('190,255,150'),
  };

  /* ---------- drifting clouds: the real voxel clouds, cut out of the art ---------- */
  const CIMG: Record<string, HTMLImageElement> = {};
  let SKY: HTMLImageElement | null = null;
  ['a', 'b', 'c'].forEach((k) => {
    const src = (IMG as Record<string, string>)['c' + k];
    loadImg(src)
      .then((im) => {
        if (disposed) return;
        CIMG[k] = im;
        if (reduce) drawClouds(0, 0);
      })
      .catch(() => {});
  });
  loadImg(IMG.sky)
    .then((im) => {
      if (disposed) return;
      SKY = im;
      const c = document.createElement('canvas');
      c.width = 836;
      c.height = 470;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(im, 0, 0, 836, 470);
      SKYD = g.getImageData(0, 0, 836, 470).data;
      mkStars();
      if (reduce) drawClouds(0, 0);
    })
    .catch(() => {});
  const SPR: Record<string, { w: number; h: number }> = { a: { w: 112, h: 77 }, b: { w: 108, h: 73 }, c: { w: 140, h: 110 } };
  // the first three start exactly where the art had them; the rest add depth (size = distance = speed)
  const CLOUDS: any[] = [
    { k: 'a', x: 313, y: 248, s: 1, v: 14, a: 1, f: 0 },
    { k: 'b', x: 1342, y: 0, s: 1, v: 11, a: 1, f: 0, still: 1 },
    { k: 'c', x: 1533, y: 105, s: 1, v: 17, a: 1, f: 0, flipOnWrap: 1 },
    { k: 'a', x: 760, y: 24, s: 0.62, v: 8, a: 0.85, f: 1 },
    { k: 'a', x: 60, y: 96, s: 0.8, v: 12, a: 0.9, f: 0 },
    { k: 'a', x: 1100, y: 176, s: 1.15, v: 19, a: 0.95, f: 1 },
    { k: 'a', x: 980, y: 292, s: 0.5, v: 6.5, a: 0.75, f: 0 },
    { k: 'a', x: 1480, y: 58, s: 0.85, v: 13, a: 0.9, f: 1 },
  ].sort((p, q) => p.s - q.s);
  CLOUDS.forEach((c) => { c.p = rnd(0, TAU); });
  const sstep = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  function drawClouds(s: number, T: number) {
    const g = cctx, k = cl.width / 1672;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, 1672, 941);
    if (!SKY) return;
    for (const c of CLOUDS) {
      const im = CIMG[c.k];
      if (!im) continue;
      const w = SPR[c.k].w * c.s, h = SPR[c.k].h * c.s;
      if (!reduce) {
        c.x += c.v * s;
        if (c.x > 1690) {
          c.x = -w - 30 - Math.random() * 240;
          if (c.flipOnWrap) c.f = 1;
        }
      }
      const cx = c.x + w / 2, cy = c.y + h / 2;
      // thin out while behind the headline so the text stays crisp
      const vis = 1 - 0.62 * sstep(380, 520, cx) * (1 - sstep(1150, 1290, cx)) * sstep(110, 170, cy) * (1 - sstep(330, 390, cy));
      g.globalAlpha = c.a * vis * (1 - 0.35 * TODP);
      g.save();
      g.translate(cx, cy + (c.still ? 0 : Math.sin(T * 0.35 + c.p) * 1.6));
      if (c.f) g.scale(-1, 1);
      g.drawImage(im, -w / 2, -h / 2, w, h);
      g.restore();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-atop'; // sunset tint that slowly breathes
    g.fillStyle =
      'rgba(' + (255 - 135 * TODP | 0) + ',' + (150 - 30 * TODP | 0) + ',' + (100 + 150 * TODP | 0) + ',' + (0.05 + 0.05 * Math.sin(T * 0.22) + 0.12 * TODP) + ')';
    g.fillRect(0, 0, 1672, 941);
    if (!GLOK) {
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(SKY, 0, 0, 1672, 941);
    } // hide behind scenery (the shader does it when WebGL is on)
    g.globalCompositeOperation = 'source-over';
  }

  let stars: any[] = [], flies: any[] = [], embers: any[] = [], leaves: any[] = [], sparks: any[] = [], mist: any[] = [], lights: any[] = [];

  const skyAt = (x: number, y: number) => !SKYD || SKYD[((y / 2 | 0) * 836 + (x / 2 | 0)) * 4 + 3] > 140;
  function mkStars(small = innerWidth < 760) {
    const out: any[] = [], n1 = small ? 40 : 110, N = n1 + (small ? 70 : 220);
    for (let tries = 0; out.length < N && tries < 30000; tries++) {
      const x = rnd(0, 1672), y = rnd(0, 360);
      if (!skyAt(x, y)) continue;
      const day = out.length < n1;
      out.push({ x, y, r: day ? rnd(0.5, 1.5) : rnd(0.6, 1.8), p: rnd(0, TAU), s: rnd(0.6, 2), th: day ? -1 : rnd(0.04, 0.92) });
    }
    stars = out;
  }
  function mkParticles() {
    const small = innerWidth < 760;
    mkStars(small);
    flies = Array.from({ length: small ? 14 : 36 }, () => ({
      x: rnd(0, 1672), y: rnd(300, 800), vx: rnd(-6, 6), vy: rnd(-4, 4), p: rnd(0, TAU), s: rnd(0.5, 1.4), z: rnd(0.6, 1.3),
      u: rnd(0.02, 0.98), v: rnd(0.05, 0.95), k: pick([S.gold, S.gold, S.orange, S.violet, S.blue]),
    }));
    embers = Array.from({ length: small ? 12 : 30 }, () => ember(true));
    leaves = Array.from({ length: small ? 6 : 14 }, () => leaf(true));
    sparks = Array.from({ length: small ? 12 : 28 }, () => spark(true));
    mist = [[1497, 484], [1381, 614], [491, 703], [1314, 706]];
    // twinkling fairy lights along the islands
    lights = [];
    for (let x = 1310; x < 1480; x += 17) lights.push({ x, y: 492 + Math.sin(x) * 2, p: rnd(0, TAU), s: rnd(1, 3) });
    for (let x = 1570; x < 1665; x += 15) lights.push({ x, y: 352 + rnd(-3, 3), p: rnd(0, TAU), s: rnd(1, 3) });
    for (let x = 420; x < 560; x += 14) lights.push({ x, y: 690 + rnd(-3, 3), p: rnd(0, TAU), s: rnd(1, 3) });
  }
  const ember = (init: boolean) => ({
    x: pick([rnd(560, 1120), rnd(1380, 1530), rnd(1200, 1230)]), y: init ? rnd(660, 770) : rnd(720, 770),
    vy: rnd(10, 28), vx: rnd(-5, 5), life: init ? rnd(0, 1) : 0, sz: rnd(0.5, 1),
  });
  const leaf = (init: boolean) => ({
    x: rnd(30, 420), y: init ? rnd(130, 600) : rnd(130, 200), vy: rnd(14, 30), p: rnd(0, TAU), sz: rnd(3, 6), rot: rnd(0, TAU),
    c: pick(['#8ec34a', '#c9d44f', '#5f9a3a', '#e0c24a']),
  });
  const spark = (init: boolean) => {
    const a = rnd(0, TAU);
    return { a, r: init ? rnd(10, 150) : rnd(8, 24), w: rnd(0.5, 1.3) * (Math.random() < 0.5 ? 1 : -1), vr: rnd(12, 30), life: init ? rnd(0, 1) : 0, k: pick([S.violet, S.pink, S.white, S.violet]) };
  };

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = stage.clientWidth * dpr;
    const cap = Math.min(w, 2400);
    fx.width = cap;
    fx.height = Math.round((cap * 941) / 1672);
    K = cap / 1672;
    mkParticles();
    const cc = Math.min(w, 1400);
    cl.width = cc;
    cl.height = Math.round((cc * 941) / 1672);
    cloudDirty = true;
    const gw = Math.min(w, 2000) * glScale;
    glc.width = gw;
    glc.height = Math.round((gw * 941) / 1672);
    ku = stage.clientWidth / 1672;
  }
  addEventListener('resize', resize);
  cleanups.push(() => removeEventListener('resize', resize));
  // after every const it touches (ember/leaf/spark) is initialized
  resize();

  function draw(t: number, dt: number) {
    const s = dt / 1000, T = t / 1000;
    ctx.setTransform(K, 0, 0, K, 0, 0);
    ctx.clearRect(0, 0, 1672, 941);

    drawClouds(s, T);
    const P = (z: number) => ctx.setTransform(K, 0, 0, K, ((z - 0.5) * AX) * K, ((z - 0.5) * AY) * K);
    // the composer may mount after this engine — look it up only when needed
    const composerEl = typeL > 0.02 ? document.querySelector<HTMLElement>('.w3-composer') : null;
    const cmp = composerEl ? toDesign(composerEl) : null;
    ctx.globalCompositeOperation = 'lighter';

    P(0);
    for (const q of stars) {
      const vis = q.th < 0 ? 1 : sstep(q.th, q.th + 0.12, TODP);
      if (vis < 0.01) continue;
      ctx.globalAlpha = (0.2 + 0.8 * (0.5 + 0.5 * Math.sin(T * q.s + q.p))) * vis;
      ctx.fillStyle = '#fff';
      ctx.fillRect(q.x, q.y, q.r, q.r);
    }
    for (const l of lights) {
      if (l.z === undefined && DP) l.z = depthAt(l.x, l.y);
      P(l.z === undefined ? 0.5 : l.z);
      const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(T * l.s * 1.4 + l.p));
      ctx.globalAlpha = Math.min(1, a * (1 + 0.6 * TODP));
      ctx.drawImage(S.gold, l.x - 6, l.y - 6, 12, 12);
    }
    // fireflies
    for (const f of flies) {
      P(0.45 + (0.35 * (f.z - 0.6)) / 0.7);
      if (!reduce) {
        f.p += s * f.s;
        f.x += f.vx * s + Math.sin(f.p * 1.7) * 0.3;
        f.y += f.vy * s + Math.cos(f.p * 1.3) * 0.25;
        if (f.x < -20) f.x = 1692;
        if (f.x > 1692) f.x = -20;
        if (f.y < 280) f.y = 820;
        if (f.y > 830) f.y = 290;
      }
      if (cmp) {
        const k = 1 - Math.exp(-s * 1.6 * typeL), q = perim(cmp, f.u + T * 0.012 * f.s, 6 + f.v * 26);
        f.x += (q[0] - f.x) * k;
        f.y += (q[1] - f.y) * k;
      }
      ctx.globalAlpha = Math.min(1, Math.max(0.55 * typeL, (0.2 + 0.8 * (0.5 + 0.5 * Math.sin(T * 1.4 * f.s + f.p * 3))) * (1 + 0.5 * TODP + 0.6 * typeL)));
      const d = 15 * f.z * (1 + 0.7 * typeL);
      ctx.drawImage(f.k, f.x - d / 2, f.y - d / 2, d, d);
    }
    // embers
    P(0.6);
    for (const e of embers) {
      if (!reduce) {
        e.life += s * 0.26;
        e.y -= e.vy * s;
        e.x += e.vx * s + Math.sin(T * 2 + e.y * 0.05) * 0.2;
      }
      if (e.life >= 1) Object.assign(e, ember(false));
      ctx.globalAlpha = Math.sin(Math.min(e.life, 1) * Math.PI) * 0.9;
      const d = 10 * e.sz;
      ctx.drawImage(S.orange, e.x - d / 2, e.y - d / 2, d, d);
    }
    // portal sparks: spiral outward
    P(0.63);
    for (const p of sparks) {
      if (!reduce) {
        p.life += s * 0.32 * (1 + pf * 1.6);
        p.a += p.w * s;
        p.r += p.vr * s;
      }
      if (p.life >= 1) Object.assign(p, spark(false));
      const x = 1547 + Math.cos(p.a) * p.r * 0.8, y = 626 + Math.sin(p.a) * p.r * 1.05 - p.life * 20;
      ctx.globalAlpha = Math.min(1, Math.sin(Math.min(p.life, 1) * Math.PI) * (0.95 + pf * 0.3));
      const dz = 10 + pf * 5;
      ctx.drawImage(p.k, x - dz / 2, y - dz / 2, dz, dz);
    }
    // click: sparks arc from the Create button into the portal, which flares when they arrive
    P(0.5);
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i], u = (t - b.t0) / b.dur;
      if (u < 0) continue;
      if (u >= 1) {
        flare = Math.min(1, flare + 0.045);
        if (Math.random() < 0.35) puffs.push({ x: b.x1, y: b.y1, life: 0 });
        bursts.splice(i, 1);
        continue;
      }
      for (let k = 0; k < 4; k++) {
        const v = Math.max(0, u - k * 0.022), w = 1 - v;
        const x = w * w * b.x0 + 2 * w * v * b.cx + v * v * b.x1, y = w * w * b.y0 + 2 * w * v * b.cy + v * v * b.y1;
        const d = (13 - k * 2.4) * (1 - 0.25 * u);
        ctx.globalAlpha = (1 - k * 0.25) * Math.min(1, u * 6) * (1 - 0.3 * u);
        ctx.drawImage(b.k, x - d / 2, y - d / 2, d, d);
      }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const q = puffs[i];
      q.life += s * 1.6;
      if (q.life >= 1) {
        puffs.splice(i, 1);
        continue;
      }
      const d = 24 + q.life * 90;
      ctx.globalAlpha = (1 - q.life) * 0.7;
      ctx.drawImage(S.violet, q.x - d / 2, q.y - d / 2, d, d);
    }
    // waterfall mist
    for (const m of mist) {
      if (m.length < 3 && DP) m[2] = depthAt(m[0], m[1]);
      P(m.length > 2 ? m[2] : 0.5);
      for (let i = 0; i < 3; i++) {
        const ph = (T * 0.5 + i / 3) % 1;
        ctx.globalAlpha = (1 - ph) * 0.4;
        const d = 22 + ph * 36;
        ctx.drawImage(S.blue, m[0] - d / 2 + Math.sin(T + i) * 6, m[1] - d / 2 - ph * 14, d, d);
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // falling voxel leaves
    P(0.95);
    for (const l of leaves) {
      if (!reduce) {
        l.y += l.vy * s;
        l.p += s * 1.4;
        l.rot += s * 1.2;
        l.x += Math.sin(l.p) * 12 * s + (4 + 16 * gustNow) * s;
      }
      if (l.y > 640) Object.assign(l, leaf(false));
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.rot);
      ctx.globalAlpha = Math.min(1, (640 - l.y) / 120) * 0.9;
      ctx.fillStyle = l.c;
      ctx.fillRect(-l.sz / 2, -l.sz / 2, l.sz, l.sz);
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.fillRect(-l.sz / 2, -l.sz / 2, l.sz, l.sz * 0.3);
      ctx.restore();
    }

    // shooting star
    if (!reduce) {
      P(0);
      nextShot -= dt;
      if (!shot && nextShot <= 0) {
        shot = { x: rnd(300, 1000), y: rnd(20, 120), vx: rnd(520, 760), vy: rnd(140, 240), life: 0 };
        nextShot = rnd(7000, 14000) * (1 - 0.55 * TODP);
      }
      if (shot) {
        shot.x += shot.vx * s;
        shot.y += shot.vy * s;
        shot.life += s / 0.9;
        const a = Math.sin(Math.min(shot.life, 1) * Math.PI), L = 0.16;
        const g = ctx.createLinearGradient(shot.x, shot.y, shot.x - shot.vx * L, shot.y - shot.vy * L);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = g;
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(shot.x, shot.y);
        ctx.lineTo(shot.x - shot.vx * L, shot.y - shot.vy * L);
        ctx.stroke();
        if (shot.life >= 1) shot = null;
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ====================== DEPTH PARALLAX (WebGL) ====================== */
  function setupGL(worldImg: HTMLImageElement, depth: HTMLImageElement, sky: HTMLImageElement) {
    const gl = glc.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'high-performance' });
    if (!gl) return false;
    const sh = (t: number, src: string) => {
      const o = gl.createShader(t)!;
      gl.shaderSource(o, src);
      gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) ?? 'shader');
      return o;
    };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) ?? 'link');
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const tex = (unit: number, src: TexImageSource, pre?: boolean) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!pre);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      return t;
    };
    tex(0, worldImg);
    tex(1, depth);
    tex(2, sky);
    const tc = tex(3, cl, true);
    (['uW', 'uD', 'uS', 'uC'] as const).forEach((n, i) => gl.uniform1i(gl.getUniformLocation(pr, n), i));
    GL = {
      gl, tc,
      uA: gl.getUniformLocation(pr, 'uA'), uT: gl.getUniformLocation(pr, 'uT'),
      uWind: gl.getUniformLocation(pr, 'uWind'), uTod: gl.getUniformLocation(pr, 'uTod'),
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      fallback();
    };
    glc.addEventListener('webglcontextlost', onLost);
    cleanups.push(() => glc.removeEventListener('webglcontextlost', onLost));
    return true;
  }
  function renderGL(T: number) {
    const gl = GL.gl;
    gl.viewport(0, 0, glc.width, glc.height);
    if (cloudDirty) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, GL.tc);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cl);
      cloudDirty = false;
    }
    gl.uniform2f(GL.uA, AX / 1672, AY / 941);
    gl.uniform1f(GL.uT, T);
    gl.uniform1f(GL.uWind, STILL ? 0 : gustNow);
    gl.uniform1f(GL.uTod, TODP);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function fallback() {
    // no WebGL: still art + the old CSS-camera parallax
    GLOK = false;
    glc.style.display = 'none';
    cl.style.display = '';
    (stage.querySelector('.w3-dusk') as HTMLElement).style.display = 'block';
    stage.style.backgroundImage = `url(${IMG.world})`;
    stage.style.backgroundSize = '100% 100%';
  }

  /* ---------- camera: pointer parallax + idle drift ---------- */
  let tx = 0, ty = 0, cx = 0, cy = 0;
  const onMove = (e: PointerEvent) => {
    if (e.clientX === 0 && e.clientY === 0) return;
    tx = (e.clientX / innerWidth - 0.5) * 2;
    ty = (e.clientY / innerHeight - 0.5) * 2;
  };
  addEventListener('pointermove', onMove, { passive: true });
  cleanups.push(() => removeEventListener('pointermove', onMove));

  let last = performance.now();
  function frame(t: number) {
    if (disposed) return;
    const dt = Math.min(t - last, 50);
    last = t;
    // camera
    const k = 1 - Math.exp(-dt / 280);
    cx += (tx - cx) * k;
    cy += (ty - cy) * k;
    if (GLOK) {
      AX = STILL ? 0 : -cx * 8 + Math.sin(t / 7300) * 2.6 + Math.sin(t / 3100) * 0.9;
      AY = STILL ? 0 : -cy * 4 + Math.cos(t / 9100) * 1.4;
      stage.style.setProperty('--ax', (AX * ku).toFixed(2) + 'px');
      stage.style.setProperty('--ay', (AY * ku).toFixed(2) + 'px');
    } else {
      stage.style.transform = `translate3d(${(-cx * 3 + Math.sin(t / 9000)).toFixed(2)}px,${(-cy * 2 + Math.cos(t / 7000) * 0.5).toFixed(2)}px,0) scale(1.005)`;
    }
    animate(t / 1000, dt);
    draw(t, dt);
    if (GLOK) {
      frameNo++;
      if (!(frameNo & 1)) cloudDirty = true;
      renderGL(t / 1000);
    }
    // weak GPU? render the world with fewer pixels instead of dropping frames
    ema += (dt - ema) * 0.05;
    if (GLOK && !STILL && frameNo % 90 === 0 && ema > 26 && glScale > 0.55 && !document.hidden) {
      glScale = Math.max(0.55, glScale * 0.8);
      resize();
    }
    if (!reduce) raf = requestAnimationFrame(frame);
  }

  const started = Promise.all([loadImg(IMG.world), loadImg(IMG.depth), loadImg(IMG.sky)])
    .then(([w, d, s]) => {
      if (disposed) return;
      const c = document.createElement('canvas');
      c.width = DW = d.naturalWidth;
      c.height = DH = d.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(d, 0, 0);
      DP = g.getImageData(0, 0, DW, DH).data;
      REG.forEach((r) => r.e.style.setProperty('--z', (r.z === undefined ? depthAt(r.x, r.y) : r.z).toFixed(3)));
      try {
        GLOK = setupGL(w, d, s);
      } catch (err) {
        console.warn('voxel world: WebGL off', err);
        GLOK = false;
      }
      if (GLOK) {
        glc.style.display = 'block';
        cl.style.display = 'none';
        drawClouds(0, 0);
        cloudDirty = true;
        renderGL(0);
      } else {
        fallback();
      }
      raf = requestAnimationFrame(frame);
    })
    .catch((err) => {
      console.warn('voxel world: art failed to load', err);
      fallback();
      raf = requestAnimationFrame(frame);
    });

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    void started.then(() => {
      if (GLOK && GL?.gl) {
        const lose = GL.gl.getExtension('WEBGL_lose_context');
        lose?.loseContext();
      }
      GL = null;
    });
    for (const fn of cleanups) fn();
  };
}

/* ───────── React shell ───────── */
export function WorldScene() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    return mountWorld(root);
  }, []);
  return (
    <div ref={ref} className="w3-world" aria-hidden>
      <div className="w3-stage">
        <canvas className="w3-gl" />
        <canvas className="w3-cl" />
        <div className="w3-dusk" />
        <canvas className="w3-fx" />
      </div>
      <div className="w3-vig" />
    </div>
  );
}
