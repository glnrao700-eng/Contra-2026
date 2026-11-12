// CONTRA 2026 — fan-made 3D run & gun tribute.
// Three.js renderer (PBR, soft shadows, bloom) + custom fixed-step 2.5D physics.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

window.__gameLoaded = true;

// ======================================================================
// CONFIG
// ======================================================================
const G = -38;            // gravity (m/s²) – a little heavier than Earth for snappy arcade feel
const FIXED = 1 / 120;    // physics step
const RUN = 7;            // player run speed
const JUMP = 15;        // player jump impulse
const FOV = 45;
const CAM_DIST = 18;
const CAM_MAX_X = 290;    // camera locks here for the boss arena
const WATER_Y = -1.5;
const DEATH_Y = -1.7;

const WEAPONS = {
  R: { name: 'RIFLE',       cd: 0.15,  speed: 24, max: 6 },
  M: { name: 'MACHINE GUN', cd: 0.075, speed: 26, max: 14 },
  S: { name: 'SPREAD GUN',  cd: 0.24,  speed: 19, max: 30 },
  L: { name: 'LASER',       cd: 0.32,  speed: 42, max: 4 },
};

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const lerp = (a, b, t) => a + (b - a) * t;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ======================================================================
// RENDERER / SCENE
// ======================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0xcdb79a);
scene.background = FOG_COLOR.clone();
scene.fog = new THREE.Fog(FOG_COLOR, 35, 175);

const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 500);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.45, 0.88);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- Lights ----------
const hemi = new THREE.HemisphereLight(0xd8ecff, 0x4a3a22, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffdcae, 3.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 20, bottom: -12, near: 1, far: 140 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// Pool of point lights for muzzle flashes / explosions (fixed count = no shader recompiles)
const flashLights = [];
for (let i = 0; i < 5; i++) {
  const l = new THREE.PointLight(0xffaa55, 0, 16, 2);
  l.userData.t = 0; l.userData.max = 1; l.userData.peak = 0;
  scene.add(l);
  flashLights.push(l);
}
function flash(x, y, z, color, intensity, dur) {
  let best = flashLights[0];
  for (const l of flashLights) if (l.userData.t < best.userData.t) best = l;
  best.position.set(x, y, z);
  best.color.set(color);
  best.userData.t = dur; best.userData.max = dur; best.userData.peak = intensity;
  best.intensity = intensity;
}
function updateFlashes(dt) {
  for (const l of flashLights) {
    if (l.userData.t > 0) {
      l.userData.t -= dt;
      l.intensity = Math.max(0, l.userData.peak * (l.userData.t / l.userData.max));
    } else l.intensity = 0;
  }
}

// ======================================================================
// PROCEDURAL TEXTURES
// ======================================================================
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function speckle(g, w, h, n, colors, rMin, rMax) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    g.globalAlpha = rand(0.15, 0.6);
    g.beginPath();
    g.arc(Math.random() * w, Math.random() * h, rand(rMin, rMax), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}
const texCliff = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#6a5038'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) {             // sediment strata
    g.fillStyle = `rgba(${40 + Math.random() * 40},${28 + Math.random() * 25},${15},${rand(0.05, 0.25)})`;
    g.fillRect(0, y, w, rand(1, 4));
  }
  speckle(g, w, h, 900, ['#3b2a1c', '#8a6a48', '#4d3a28', '#9b7d5a'], 1, 3);
  speckle(g, w, h, 40, ['#5c5650', '#7a746c', '#3e3a36'], 4, 11); // embedded stones
});
const texGrass = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#4a7a2a'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 1600, ['#2f5a1a', '#6a9a36', '#3d6a22', '#86b048', '#5b4a2a'], 1, 2.5);
});
const texPanel = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#50565c'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 500, ['#3a3f44', '#666d74', '#5a4a3a'], 1, 3);
  g.strokeStyle = '#2a2e32'; g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); }
  for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, h); g.stroke(); }
  g.fillStyle = '#8a9096';
  for (let x = 8; x < w; x += 24) for (let y = 8; y < h; y += 64) { g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(120,60,20,.35)';                       // rust streaks
  for (let i = 0; i < 14; i++) g.fillRect(Math.random() * w, Math.random() * h, rand(2, 5), rand(20, 70));
});
const texWood = canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = '#6e4a2a'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x, 0, 3, h); }
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(30,15,5,${rand(.1, .3)})`; g.fillRect(Math.random() * w, Math.random() * h, rand(10, 40), 1); }
});
const texSoft = canvasTex(64, 64, (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
}, false);
const texSmoke = canvasTex(128, 128, (g, w) => {
  for (let i = 0; i < 22; i++) {
    const x = w / 2 + rand(-26, 26), y = w / 2 + rand(-26, 26), r = rand(14, 36);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }
}, false);
texSoft.colorSpace = texSmoke.colorSpace = THREE.NoColorSpace;

function stdMat(color, rough = 0.8, metal = 0, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  m.userData.baseEm = m.emissive.clone();
  return m;
}
function texMat(tex, rx, ry, extra = {}) {
  const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry);
  return stdMat(0xffffff, 0.92, 0, { map: t, ...extra });
}

// ======================================================================
// SKY + ENVIRONMENT (image-based lighting generated from the sky)
// ======================================================================
function buildSky() {
  const geo = new THREE.SphereGeometry(320, 40, 20);
  const pos = geo.attributes.position, cols = [];
  const zen = new THREE.Color(0x2f62a6), hor = new THREE.Color(0xf3cf9c), gnd = new THREE.Color(0x6a5a40), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 320;
    if (t >= 0) c.copy(hor).lerp(zen, Math.pow(t, 0.55)); else c.copy(hor).lerp(gnd, Math.min(1, -t * 4));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}
const sky = buildSky();
sky.renderOrder = -10;
scene.add(sky);
const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: texSoft, color: new THREE.Color(8, 6, 3.5), fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
sunDisc.scale.setScalar(70);
scene.add(sunDisc);
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(buildSky());
  const s = new THREE.Mesh(new THREE.SphereGeometry(20, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(30, 24, 16) }));
  s.position.set(-150, 160, 200);
  envScene.add(s);
  scene.environment = pmrem.fromScene(envScene, 0.02, 0.1, 1000).texture;
}

// ======================================================================
// AUDIO (fully synthesized with WebAudio)
// ======================================================================
const sfx = {
  ctx: null, master: null, musicBus: null, noise: null, musicOn: true, step: 0, nextT: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.22; this.musicBus.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.nextT = this.ctx.currentTime + 0.1;
  },
  burst(dur, freq, vol, type = 'lowpass', dest, when = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.12), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(dest || this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  },
  tone(f0, f1, dur, vol, type = 'square', dest, when = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  shoot(w) {
    if (w === 'L') { this.tone(2200, 260, 0.22, 0.12, 'sawtooth'); return; }
    if (w === 'S') { this.burst(0.12, 2600, 0.22); this.tone(700, 160, 0.1, 0.07, 'sawtooth'); return; }
    this.burst(w === 'M' ? 0.06 : 0.09, 3400, 0.22); this.tone(260, 70, 0.06, 0.1, 'square');
  },
  enemyShot() { this.tone(520, 240, 0.08, 0.06, 'square'); },
  hit() { this.tone(1100, 500, 0.04, 0.05, 'square'); },
  explode(s = 1) { this.burst(0.5 + 0.4 * s, 1400, 0.5 * Math.min(1.4, s)); this.tone(130, 28, 0.6, 0.4 * Math.min(1.3, s), 'sine'); },
  jump() { this.tone(280, 620, 0.12, 0.06, 'triangle'); },
  land() { this.burst(0.06, 600, 0.08); },
  pickup() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.09, 0.09, 'square', null, i * 0.07)); },
  death() { this.tone(500, 40, 0.9, 0.18, 'sawtooth'); this.burst(0.3, 900, 0.2); },
  splash() { this.burst(0.45, 3000, 0.25, 'bandpass'); },
  alarm() { for (let i = 0; i < 4; i++) this.tone(880, 440, 0.25, 0.08, 'square', null, i * 0.32); },
  // tiny step sequencer — driving E-minor bass + drums
  BASS: [82.4, 0, 82.4, 98, 0, 82.4, 110, 0, 82.4, 0, 82.4, 123.5, 0, 110, 98, 0,
         73.4, 0, 73.4, 87.3, 0, 73.4, 98, 0, 65.4, 0, 65.4, 82.4, 0, 98, 110, 123.5],
  LEAD: [0, 0, 0, 0, 329.6, 0, 392, 0, 440, 0, 0, 0, 493.9, 0, 440, 392,
         0, 0, 0, 0, 293.7, 0, 349.2, 0, 392, 0, 0, 0, 329.6, 0, 0, 0],
  music() {
    const c = this.ctx; if (!c || !this.musicOn) return;
    const stepDur = 60 / 152 / 4;
    while (this.nextT < c.currentTime + 0.12) {
      const when = this.nextT - c.currentTime, i = this.step % 32;
      const b = this.BASS[i];
      if (b) { this.tone(b, b * 0.98, stepDur * 1.6, 0.35, 'sawtooth', this.musicBus, when); this.tone(b / 2, b / 2, stepDur * 1.6, 0.3, 'square', this.musicBus, when); }
      const l = this.LEAD[i];
      if (l && this.step % 64 >= 32) this.tone(l, l, stepDur * 2.2, 0.12, 'square', this.musicBus, when);
      if (i % 4 === 0) this.tone(150, 40, 0.16, 0.9, 'sine', this.musicBus, when);
      if (i % 8 === 4) this.burst(0.14, 4000, 0.4, 'highpass', this.musicBus, when);
      if (i % 2 === 1) this.burst(0.03, 9000, 0.12, 'highpass', this.musicBus, when);
      this.step++; this.nextT += stepDur;
    }
  },
};

// ======================================================================
// INPUT (keyboard + gamepad + touch)
// ======================================================================
const keys = new Set();
const BLOCK = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
window.addEventListener('keydown', (e) => {
  if (BLOCK.includes(e.code)) e.preventDefault();
  if (!e.repeat) onKeyPress(e.code);
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  document.getElementById('touch').classList.remove('hidden');
  document.querySelectorAll('#touch button').forEach((b) => {
    const k = b.dataset.key;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); keys.add(k); onKeyPress(k === 'Space' ? 'Enter' : k); });
    const up = () => keys.delete(k);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  });
}

const input = { left: false, right: false, up: false, down: false, jump: false, fire: false };
let prevJump = false, prevStart = false;
function readInput() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) if (p && p.connected) { gp = p; break; }
  const ax = gp ? gp.axes[0] || 0 : 0, ay = gp ? gp.axes[1] || 0 : 0;
  const btn = (i) => !!(gp && gp.buttons[i] && gp.buttons[i].pressed);
  input.left = keys.has('ArrowLeft') || keys.has('KeyA') || ax < -0.4 || btn(14);
  input.right = keys.has('ArrowRight') || keys.has('KeyD') || ax > 0.4 || btn(15);
  input.up = keys.has('ArrowUp') || keys.has('KeyW') || ay < -0.45 || btn(12);
  input.down = keys.has('ArrowDown') || keys.has('KeyS') || ay > 0.45 || btn(13);
  input.jump = keys.has('Space') || keys.has('KeyZ') || keys.has('KeyK') || btn(0);
  input.fire = keys.has('KeyX') || keys.has('KeyJ') || keys.has('ControlLeft') || btn(2) || btn(7) || btn(5);
  const jumpPressed = input.jump && !prevJump;
  prevJump = input.jump;
  const start = btn(9);
  if (start && !prevStart) onKeyPress('Enter');
  prevStart = start;
  return jumpPressed;
}

// ======================================================================
// WORLD: collision solids
// ======================================================================
const solids = []; // {x0,x1,y0,y1,oneWay,alive}
function addSolid(x0, x1, y0, y1, o = {}) {
  const s = { x0, x1, y0, y1, oneWay: !!o.oneWay, alive: true, dynamic: !!o.dynamic };
  solids.push(s);
  return s;
}
/** Highest walkable surface at x that is at or below fromY. */
function groundTopAt(x, fromY = 60) {
  let best = -Infinity;
  for (const s of solids) {
    if (!s.alive) continue;
    if (x >= s.x0 && x <= s.x1 && s.y1 <= fromY + 1e-3 && s.y1 > best) best = s.y1;
  }
  return best;
}
function solidAtPoint(x, y) {
  for (const s of solids) if (s.alive && !s.oneWay && x > s.x0 && x < s.x1 && y > s.y0 && y < s.y1) return s;
  return null;
}

/** AABB physics for any body {x (center), y (feet), vx, vy, w, h}. Separate-axis resolution. */
function moveBody(b, dt) {
  b.vy += G * (b.gravScale || 1) * dt;
  if (b.vy < -42) b.vy = -42;
  b.hitWall = false;
  b.x += b.vx * dt;
  const hw = b.w / 2;
  for (const s of solids) {
    if (!s.alive || s.oneWay) continue;
    if (b.x - hw < s.x1 && b.x + hw > s.x0 && b.y < s.y1 - 1e-4 && b.y + b.h > s.y0 + 1e-4) {
      if (b.vx > 0) b.x = s.x0 - hw; else if (b.vx < 0) b.x = s.x1 + hw;
      else b.x = (b.x < (s.x0 + s.x1) / 2) ? s.x0 - hw : s.x1 + hw;
      b.vx = 0; b.hitWall = true;
    }
  }
  const prevY = b.y;
  b.y += b.vy * dt;
  b.onGround = false;
  for (const s of solids) {
    if (!s.alive) continue;
    if (!(b.x - hw < s.x1 && b.x + hw > s.x0)) continue;
    if (b.vy <= 0 && prevY >= s.y1 - 0.001 && b.y < s.y1 && !(s.oneWay && b.dropTimer > 0)) {
      b.y = s.y1; b.vy = 0; b.onGround = true; b.ground = s;
    } else if (!s.oneWay && b.vy > 0 && b.y + b.h > s.y0 && prevY + b.h <= s.y0 + 0.001) {
      b.y = s.y0 - b.h; b.vy = 0;
    }
  }
}

// ======================================================================
// LEVEL GEOMETRY
// ======================================================================
const GROUND = [[-30, 60, 0], [64, 110, 0], [134, 160, 0], [160, 190, 2], [190, 200, 0], [204, 340, 0]];
const LEDGES = [[74, 82, 2.6], [86, 94, 5.2], [140, 148, 2.6], [214, 222, 2.6], [226, 234, 5.4], [240, 248, 2.6], [283, 290, 2.6]];
const BRIDGE = { x0: 110, seg: 4, count: 6 };
const DEPTH_FRONT = 3, DEPTH_BACK = -7;

function buildGround(x0, x1, top) {
  const w = x1 - x0, h = top + 20, d = DEPTH_FRONT - DEPTH_BACK;
  const cliff = texMat(texCliff, w / 6, h / 6), side = texMat(texCliff, d / 6, h / 6), grass = texMat(texGrass, w / 5, d / 5);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, grass, cliff, cliff, cliff]);
  mesh.position.set(x0 + w / 2, top - h / 2, (DEPTH_FRONT + DEPTH_BACK) / 2);
  mesh.receiveShadow = true;
  scene.add(mesh);
  // grassy lip on the front edge
  const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, 0.5), texMat(texGrass, w / 3, 1));
  lip.position.set(x0 + w / 2, top - 0.08, DEPTH_FRONT - 0.15);
  lip.receiveShadow = true;
  scene.add(lip);
  addSolid(x0, x1, top - h, top);
}
function buildLedge(x0, x1, top) {
  const w = x1 - x0;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, 3.4), [texMat(texCliff, 0.5, 0.2), texMat(texCliff, 0.5, 0.2), texMat(texGrass, w / 4, 1), texMat(texCliff, w / 5, 0.2), texMat(texCliff, w / 5, 0.15), texMat(texCliff, w / 5, 0.15)]);
  m.position.set(x0 + w / 2, top - 0.4, -0.4);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  // hanging roots / stalactite rocks under the ledge
  for (let x = x0 + 0.6; x < x1 - 0.4; x += rand(0.7, 1.4)) {
    const r = new THREE.Mesh(new THREE.ConeGeometry(rand(0.15, 0.35), rand(0.5, 1.3), 5), stdMat(0x5a4330, 1));
    r.rotation.x = Math.PI;
    r.position.set(x, top - 0.9 - r.geometry.parameters.height / 2 + 0.2, rand(-1.5, 0.8));
    r.castShadow = true;
    scene.add(r);
  }
  addSolid(x0, x1, top - 0.8, top, { oneWay: true });
}
GROUND.forEach((g) => buildGround(...g));
LEDGES.forEach((l) => buildLedge(...l));
addSolid(300, 340, -20, 60); // fortress wall (boss)

// jungle floor behind the play lane
{
  const m = new THREE.Mesh(new THREE.BoxGeometry(460, 2, 48), texMat(texGrass, 90, 10, { color: 0x9ab080 }));
  m.position.set(150, -1.2, DEPTH_BACK - 24);
  m.receiveShadow = true;
  scene.add(m);
}

// ---------- Water ----------
const waterGeo = new THREE.PlaneGeometry(460, 70, 230, 35);
const water = new THREE.Mesh(waterGeo, stdMat(0x1c5560, 0.08, 0.15, { transparent: true, opacity: 0.86 }));
water.rotation.x = -Math.PI / 2;
water.position.set(150, WATER_Y, -5);
water.receiveShadow = true;
scene.add(water);
const waterBase = Float32Array.from(waterGeo.attributes.position.array);
function updateWater(t) {
  const p = waterGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = waterBase[i * 3], y = waterBase[i * 3 + 1];
    p.setZ(i, Math.sin(x * 0.45 + t * 1.8) * 0.07 + Math.cos(y * 0.6 + t * 1.3 + x * 0.1) * 0.06);
  }
  p.needsUpdate = true;
  waterGeo.computeVertexNormals();
}

// ---------- Scenery ----------
function buildScenery() {
  // distant mountains
  const mMat = stdMat(0x5d6e7d, 1, 0, { flatShading: true });
  for (let i = 0; i < 34; i++) {
    const h = rand(25, 55), r = rand(18, 34);
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7, 2), mMat);
    m.position.set(-60 + i * 14 + rand(-6, 6), h / 2 - 4, rand(-150, -105));
    m.rotation.y = rand(0, 6);
    m.scale.x = rand(0.8, 1.4);
    scene.add(m);
  }
  // instanced jungle trees
  const N = 300;
  const trunkG = new THREE.CylinderGeometry(0.22, 0.42, 1, 6); trunkG.translate(0, 0.5, 0);
  const coneG = new THREE.ConeGeometry(1, 1, 8); coneG.translate(0, 0.5, 0);
  const ballG = new THREE.IcosahedronGeometry(1, 1);
  const trunks = new THREE.InstancedMesh(trunkG, stdMat(0x4a3424, 1), N);
  const cones = new THREE.InstancedMesh(coneG, stdMat(0xffffff, 0.9, 0, { flatShading: true }), N);
  const balls = new THREE.InstancedMesh(ballG, stdMat(0xffffff, 0.9, 0, { flatShading: true }), N);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const x = rand(-40, 340), z = rand(-38, -9), h = rand(5, 13);
    p.set(x, -0.2, z); s.set(1, h, 1); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, 6));
    M.compose(p, q, s); trunks.setMatrixAt(i, M);
    const round = Math.random() < 0.5;
    p.set(x, -0.2 + h * (round ? 0.95 : 0.45), z);
    if (round) s.set(rand(2, 3.4), rand(1.8, 2.8), rand(2, 3.4)); else s.set(rand(1.8, 2.8), h * 0.75, rand(1.8, 2.8));
    M.compose(p, q, s);
    col.setHSL(rand(0.24, 0.33), rand(0.35, 0.6), rand(0.18, 0.32));
    if (round) { balls.setMatrixAt(i, M); balls.setColorAt(i, col); cones.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); }
    else { cones.setMatrixAt(i, M); cones.setColorAt(i, col); balls.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); }
  }
  for (const im of [trunks, cones, balls]) { im.castShadow = true; im.receiveShadow = true; scene.add(im); }
  // palm trees close to the play lane
  const palmTrunk = stdMat(0x7a5c3c, 1), palmLeaf = stdMat(0x3c7a2a, 0.8, 0, { side: THREE.DoubleSide });
  const leafG = new THREE.BoxGeometry(2.6, 0.05, 0.55); leafG.translate(1.3, 0, 0);
  for (let i = 0; i < 36; i++) {
    const x = rand(-20, 320), z = rand(-8.5, -6.2);
    const palm = new THREE.Group(); palm.position.set(x, -0.2, z);
    let px = 0, py = 0; const lean = rand(-0.25, 0.25), segs = 6, segH = rand(1.1, 1.5);
    for (let k = 0; k < segs; k++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.2 - k * 0.015, 0.24 - k * 0.015, segH, 7), palmTrunk);
      px += Math.sin(lean * (k + 1) * 0.5) * segH * 0.3; py += segH * 0.97;
      seg.position.set(px, py - segH / 2, 0); seg.rotation.z = -lean * (k + 1) * 0.15;
      seg.castShadow = true; palm.add(seg);
    }
    for (let k = 0; k < 8; k++) {
      const leaf = new THREE.Mesh(leafG, palmLeaf);
      leaf.position.set(px, py, 0);
      leaf.rotation.set(0, (k / 8) * Math.PI * 2 + rand(-0.2, 0.2), -rand(0.25, 0.6));
      leaf.castShadow = true; palm.add(leaf);
    }
    scene.add(palm);
  }
  // rocks and bushes on the walkable ground (behind the action lane)
  const rockMat = stdMat(0x77706a, 0.95, 0, { flatShading: true });
  const bushMat = stdMat(0x3a6a26, 0.9, 0, { flatShading: true });
  for (let i = 0; i < 140; i++) {
    const x = rand(-25, 298), top = groundTopAt(x, 10);
    if (top < -1) continue;
    const isRock = Math.random() < 0.45;
    const m = new THREE.Mesh(isRock ? new THREE.DodecahedronGeometry(rand(0.3, 1.1), 0) : new THREE.IcosahedronGeometry(rand(0.5, 1.2), 0), isRock ? rockMat : bushMat);
    m.position.set(x, top + (isRock ? 0.1 : 0.2), rand(-6.5, -2.5));
    m.scale.y = isRock ? rand(0.5, 0.9) : rand(0.6, 0.9);
    m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
}
buildScenery();

// floating dust / pollen in sunlight
const dust = (() => {
  const n = 500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = rand(-20, 20); pos[i * 3 + 1] = rand(-1, 14); pos[i * 3 + 2] = rand(-10, 8); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.07, color: 0xfff0c8, transparent: true, opacity: 0.7, depthWrite: false, map: texSoft }));
  scene.add(pts);
  return pts;
})();

// ======================================================================
// PARTICLES (sprite pools) + RIGID DEBRIS
// ======================================================================
class SpritePool {
  constructor(n, map, blending) {
    this.list = []; this.i = 0;
    for (let k = 0; k < n; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, blending, fog: true }));
      s.visible = false; scene.add(s);
      this.list.push({ s, on: false, vel: new THREE.Vector3(), c0: new THREE.Color(), c1: new THREE.Color(), life: 0, max: 1, s0: 1, s1: 1, grav: 0, drag: 0, alpha: 1, fade: 1, useC1: false });
    }
  }
  spawn(x, y, z, o) {
    const p = this.list[this.i]; this.i = (this.i + 1) % this.list.length;
    p.on = true; p.s.visible = true; p.s.position.set(x, y, z);
    p.vel.set(o.vx || 0, o.vy || 0, o.vz || 0);
    p.life = p.max = o.life || 1; p.s0 = o.s0 ?? 1; p.s1 = o.s1 ?? p.s0;
    p.grav = o.grav || 0; p.drag = o.drag || 0; p.alpha = o.alpha ?? 1;
    p.c0.copy(o.color); p.useC1 = !!o.color1; if (o.color1) p.c1.copy(o.color1);
    p.s.material.color.copy(o.color); p.s.material.rotation = Math.random() * 6.28; p.s.material.opacity = p.alpha;
    p.s.scale.setScalar(p.s0);
  }
  update(dt) {
    for (const p of this.list) {
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) { p.on = false; p.s.visible = false; continue; }
      const k = 1 - p.life / p.max;
      p.vel.y += p.grav * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(lerp(p.s0, p.s1, k));
      p.s.material.opacity = p.alpha * (1 - k * k);
      if (p.useC1) p.s.material.color.lerpColors(p.c0, p.c1, k);
    }
  }
  clear() { for (const p of this.list) { p.on = false; p.s.visible = false; } }
}
const fx = new SpritePool(420, texSoft, THREE.AdditiveBlending);
const smoke = new SpritePool(260, texSmoke, THREE.NormalBlending);
const C = {
  fire: new THREE.Color(5, 2.6, 0.7), ember: new THREE.Color(0.9, 0.12, 0.02), spark: new THREE.Color(6, 4, 1.5),
  smoke: new THREE.Color(0.22, 0.2, 0.19), dust: new THREE.Color(0.62, 0.52, 0.4), water: new THREE.Color(0.8, 0.9, 1),
  muzzle: new THREE.Color(7, 4.5, 1.6), blue: new THREE.Color(1.2, 2.5, 7), red: new THREE.Color(6, 0.8, 0.4),
};

const debris = [];
const geoCube = new THREE.BoxGeometry(1, 1, 1);
const matDebris = [stdMat(0x3a3530, 0.9), stdMat(0x55504a, 0.7, 0.4), stdMat(0x6a4a2a, 0.9), stdMat(0x2a2a2c, 0.5, 0.7)];
const matBrass = stdMat(0xd4a24a, 0.3, 1);
function spawnDebris(x, y, z, o = {}) {
  if (debris.length > 220) { const d = debris.shift(); scene.remove(d.mesh); }
  const size = o.size || rand(0.12, 0.45);
  const mesh = new THREE.Mesh(geoCube, o.mat || matDebris[(Math.random() * matDebris.length) | 0]);
  mesh.scale.set(size * (o.sx || rand(0.6, 1.6)), size * (o.sy || rand(0.4, 1)), size * (o.sz || rand(0.6, 1.4)));
  mesh.position.set(x, y, z);
  mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
  mesh.castShadow = true;
  scene.add(mesh);
  debris.push({
    mesh, r: size * 0.4, life: o.life || rand(2.5, 4), bounce: o.bounce ?? 0.35, smoke: o.smoke || 0,
    vel: new THREE.Vector3(o.vx ?? rand(-6, 6), o.vy ?? rand(4, 12), o.vz ?? rand(-4, 4)),
    ang: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)), wet: false, rest: false,
  });
}
function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i], p = d.mesh.position;
    d.life -= dt;
    if (d.life <= 0) { scene.remove(d.mesh); debris.splice(i, 1); continue; }
    if (!d.rest) {
      d.vel.y += G * dt * (d.wet ? 0.12 : 1);
      if (d.wet) d.vel.multiplyScalar(1 - 3 * dt);
      const prevY = p.y;
      p.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.ang.x * dt; d.mesh.rotation.y += d.ang.y * dt; d.mesh.rotation.z += d.ang.z * dt;
      let top = -Infinity;
      if (p.z > DEPTH_BACK && p.z < DEPTH_FRONT) top = groundTopAt(p.x, prevY - d.r + 0.05);
      else if (p.z <= DEPTH_BACK) top = -0.2;
      if (top > -Infinity && p.y - d.r < top && prevY - d.r >= top - 0.06) {
        p.y = top + d.r;
        d.vel.y = -d.vel.y * d.bounce; d.vel.x *= 0.65; d.vel.z *= 0.65; d.ang.multiplyScalar(0.6);
        if (Math.abs(d.vel.y) < 1.2 && Math.abs(d.vel.x) < 0.6) { d.rest = true; d.vel.set(0, 0, 0); }
      }
      if (!d.wet && p.y < WATER_Y) {
        d.wet = true;
        for (let k = 0; k < 4; k++) smoke.spawn(p.x, WATER_Y + 0.1, p.z, { vx: rand(-1, 1), vy: rand(2, 4), life: 0.6, s0: 0.3, s1: 0.9, grav: -8, color: C.water, alpha: 0.7 });
      }
      if (d.smoke > 0 && Math.random() < 0.35) smoke.spawn(p.x, p.y, p.z, { vy: 0.8, life: 0.9, s0: 0.3, s1: 1.1, color: C.smoke, alpha: 0.5 });
    } else if (groundTopAt(p.x, p.y) < p.y - d.r - 0.05 && p.z > DEPTH_BACK) {
      d.rest = false;            // support vanished (bridge exploded) – fall again
    }
    if (d.life < 0.6) d.mesh.scale.multiplyScalar(1 - 3 * dt);
  }
}

// ---------- Effects ----------
let shakeAmt = 0;
function shake(a) { shakeAmt = Math.min(1.2, shakeAmt + a); }

function explode(x, y, z = 0, scale = 1) {
  sfx.explode(scale);
  shake(0.32 * scale);
  flash(x, y + 0.6, z + 1.2, 0xff9a40, 260 * scale, 0.35 + 0.1 * scale);
  const n = Math.round(18 * scale);
  for (let i = 0; i < n; i++) {
    fx.spawn(x + rand(-0.4, 0.4) * scale, y + rand(0, 0.8) * scale, z + rand(-0.4, 0.4), {
      vx: rand(-4.5, 4.5) * scale, vy: rand(1, 7) * scale, vz: rand(-3, 3), life: rand(0.35, 0.75),
      s0: rand(0.8, 1.6) * scale, s1: rand(2, 3.4) * scale, drag: 3.5, grav: 3, color: C.fire, color1: C.ember,
    });
  }
  for (let i = 0; i < n * 0.6; i++) {
    smoke.spawn(x + rand(-0.6, 0.6) * scale, y + rand(0.2, 1) * scale, z + rand(-0.6, 0.6), {
      vx: rand(-1.5, 1.5), vy: rand(1, 3.2), vz: rand(-1, 1), life: rand(1.4, 2.6), s0: 1.2 * scale, s1: rand(3.5, 5) * scale,
      drag: 1.4, grav: 0.8, color: C.smoke, alpha: 0.75,
    });
  }
  for (let i = 0; i < n * 0.9; i++) {
    fx.spawn(x, y + 0.4, z, { vx: rand(-14, 14), vy: rand(-2, 16), vz: rand(-8, 8), life: rand(0.4, 0.9), s0: 0.18, s1: 0.04, grav: -26, drag: 1, color: C.spark });
  }
  for (let i = 0; i < Math.round(6 * scale); i++) spawnDebris(x + rand(-0.4, 0.4), y + 0.5, z + rand(-0.4, 0.4), { smoke: Math.random() < 0.4 ? 1 : 0 });
}
function sparks(x, y, n = 6, color = C.spark) {
  for (let i = 0; i < n; i++) fx.spawn(x, y, 0.2, { vx: rand(-7, 7), vy: rand(-3, 8), vz: rand(-4, 4), life: rand(0.15, 0.4), s0: 0.16, s1: 0.03, grav: -20, color });
}
function puff(x, y, n = 6, color = C.dust, spread = 2) {
  for (let i = 0; i < n; i++) smoke.spawn(x + rand(-0.3, 0.3), y + 0.1, rand(-0.4, 0.4), { vx: rand(-spread, spread), vy: rand(0.3, 1.5), life: rand(0.5, 0.9), s0: 0.3, s1: 1.1, drag: 3, color, alpha: 0.6 });
}
function splash(x, big = 1) {
  sfx.splash();
  for (let i = 0; i < 20 * big; i++) smoke.spawn(x + rand(-0.5, 0.5), WATER_Y + 0.1, rand(-0.5, 0.5), { vx: rand(-2.5, 2.5), vy: rand(3, 9) * big, vz: rand(-2, 2), life: rand(0.5, 1), s0: 0.25, s1: 0.8, grav: -22, color: C.water, alpha: 0.8 });
}
const flashEl = document.getElementById('flash');
function screenFlash() { flashEl.style.transition = 'none'; flashEl.style.opacity = 1; requestAnimationFrame(() => { flashEl.style.transition = 'opacity .6s'; flashEl.style.opacity = 0; }); }

// ======================================================================
// CHARACTER MODELS
// ======================================================================
const PLAYER_PAL = { torso: 0xc98d6a, skin: 0xc98d6a, pants: 0x2d4e8c, band: 0xd8241c, boot: 0x2a2018, vest: 0x5a4632 };
const RUNNER_PAL = { torso: 0x6b6f58, skin: 0xb88a6a, pants: 0x55593f, band: 0x3d4030, boot: 0x1c1a17, vest: 0x40432f };
const RIFLE_PAL = { torso: 0x8a3b2c, skin: 0xb88a6a, pants: 0x4a3a30, band: 0x2a2a2a, boot: 0x1c1a17, vest: 0x3a2c22 };

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
function buildSoldier(pal) {
  const mats = {
    torso: stdMat(pal.torso, 0.65), skin: stdMat(pal.skin, 0.6), pants: stdMat(pal.pants, 0.9), band: stdMat(pal.band, 0.6),
    boot: stdMat(pal.boot, 0.7), vest: stdMat(pal.vest, 0.85), gun: stdMat(0x24272c, 0.35, 0.85), hair: stdMat(0x1c140e, 0.9),
  };
  const root = new THREE.Group(), spin = new THREE.Group(), body = new THREE.Group();
  spin.position.y = 0.9; body.position.y = -0.9;
  root.add(spin); spin.add(body);
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0, 0.95, side * 0.12); body.add(hip);
    hip.add(mesh(new THREE.BoxGeometry(0.24, 0.55, 0.22), mats.pants, 0, -0.27, 0));
    const knee = new THREE.Group(); knee.position.y = -0.52; hip.add(knee);
    knee.add(mesh(new THREE.BoxGeometry(0.21, 0.42, 0.2), mats.pants, 0, -0.2, 0));
    knee.add(mesh(new THREE.BoxGeometry(0.34, 0.14, 0.22), mats.boot, 0.05, -0.41, 0));
    legs.push({ hip, knee, side });
  }
  body.add(mesh(new THREE.BoxGeometry(0.34, 0.2, 0.46), mats.pants, 0, 0.98, 0));
  body.add(mesh(new THREE.BoxGeometry(0.36, 0.08, 0.48), mats.vest, 0, 1.08, 0));               // belt
  body.add(mesh(new THREE.BoxGeometry(0.34, 0.6, 0.5), mats.torso, 0, 1.38, 0));
  const strap = mesh(new THREE.BoxGeometry(0.38, 0.07, 0.52), mats.vest, 0, 1.3, 0); strap.rotation.x = 0.5; body.add(strap); // ammo strap
  body.add(mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.1, 8), mats.skin, 0, 1.72, 0));
  body.add(mesh(new THREE.SphereGeometry(0.165, 16, 12), mats.skin, 0.02, 1.88, 0));
  body.add(mesh(new THREE.SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.hair, -0.01, 1.9, 0));
  body.add(mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.07, 16), mats.band, 0, 1.94, 0));
  const tail = mesh(new THREE.BoxGeometry(0.32, 0.05, 0.08), mats.band, -0.3, 1.9, 0); tail.rotation.z = 0.5; body.add(tail);
  const gunPivot = new THREE.Group(); gunPivot.position.set(0.02, 1.52, 0); body.add(gunPivot);
  gunPivot.add(mesh(new THREE.BoxGeometry(0.42, 0.13, 0.13), mats.skin, 0.2, -0.06, 0.22));
  gunPivot.add(mesh(new THREE.BoxGeometry(0.5, 0.12, 0.12), mats.skin, 0.32, -0.08, -0.2));
  gunPivot.add(mesh(new THREE.BoxGeometry(0.78, 0.13, 0.1), mats.gun, 0.6, 0, 0));
  gunPivot.add(mesh(new THREE.BoxGeometry(0.1, 0.24, 0.08), mats.gun, 0.48, -0.16, 0));
  const barrel = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8), mats.gun, 1.13, 0.02, 0);
  barrel.rotation.z = Math.PI / 2; gunPivot.add(barrel);
  return { root, spin, body, legs, gunPivot, mats: Object.values(mats), phase: Math.random() * 6 };
}
function buildTurret() {
  const mats = { metal: stdMat(0x4b5258, 0.45, 0.8), dark: stdMat(0x22262a, 0.5, 0.8), eye: stdMat(0x330000, 0.4, 0, { emissive: new THREE.Color(3, 0.1, 0.05) }) };
  mats.eye.userData.baseEm = mats.eye.emissive.clone();
  const root = new THREE.Group();
  root.add(mesh(new THREE.CylinderGeometry(0.95, 1.15, 0.8, 14), mats.dark, 0, 0.4, 0));
  root.add(mesh(new THREE.SphereGeometry(0.8, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.metal, 0, 0.8, 0));
  root.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), mats.eye, 0, 1.25, 0.65));
  const pivot = new THREE.Group(); pivot.position.y = 1.05; root.add(pivot);
  const b = mesh(new THREE.CylinderGeometry(0.13, 0.16, 1.5, 10), mats.dark, 0.85, 0, 0); b.rotation.z = Math.PI / 2; pivot.add(b);
  const b2 = mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.3, 10), mats.metal, 1.55, 0, 0); b2.rotation.z = Math.PI / 2; pivot.add(b2);
  return { root, pivot, mats: Object.values(mats) };
}
function buildFlyer() {
  const mats = { hull: stdMat(0xb8c0c8, 0.25, 0.9), dark: stdMat(0x2a2e33, 0.4, 0.8), glow: stdMat(0x000000, 1, 0, { emissive: new THREE.Color(1, 2.4, 6) }) };
  mats.glow.userData.baseEm = mats.glow.emissive.clone();
  const root = new THREE.Group();
  const hull = mesh(new THREE.CapsuleGeometry(0.32, 0.9, 6, 12), mats.hull); hull.rotation.z = Math.PI / 2; root.add(hull);
  for (const s of [-1, 1]) { const w = mesh(new THREE.BoxGeometry(0.5, 0.06, 0.9), mats.dark, -0.1, 0.05, s * 0.55); w.rotation.y = s * 0.3; root.add(w); }
  root.add(mesh(new THREE.SphereGeometry(0.18, 10, 8), mats.glow, -0.75, 0, 0));
  return { root, mats: Object.values(mats) };
}
const pickupTex = {};
function letterTex(ch) {
  if (pickupTex[ch]) return pickupTex[ch];
  const t = canvasTex(128, 128, (g) => {
    g.fillStyle = '#c8101a'; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#ffd34d'; g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 72px Orbitron, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 64, 70);
  }, false);
  return (pickupTex[ch] = t);
}
function buildPickup(kind) {
  const g = new THREE.Group();
  const gold = stdMat(0xffc040, 0.25, 1, { emissive: new THREE.Color(0.4, 0.25, 0) });
  const core = mesh(new THREE.OctahedronGeometry(0.32, 0), gold);
  g.add(core);
  for (const s of [-1, 1]) { const w = mesh(new THREE.BoxGeometry(0.6, 0.05, 0.25), gold, s * 0.45, 0.05, 0); w.rotation.z = -s * 0.35; g.add(w); }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterTex(kind), depthTest: true }));
  sp.scale.setScalar(0.62); sp.position.set(0, 0, 0.42); g.add(sp);
  g.userData.core = core;
  return g;
}

/** Pose a soldier model from its physics body. */
function animateSoldier(m, e, dt, aimAng) {
  m.root.position.set(e.x, e.y, 0);
  m.root.rotation.y = e.facing > 0 ? 0 : Math.PI;
  const legsTo = (h, k) => { for (const l of m.legs) { l.hip.rotation.z = lerp(l.hip.rotation.z, h, Math.min(1, dt * 18)); l.knee.rotation.z = lerp(l.knee.rotation.z, k, Math.min(1, dt * 18)); } };
  if (e.dead) {
    if (e.onGround) { m.spin.rotation.z = lerp(m.spin.rotation.z, Math.round(m.spin.rotation.z / Math.PI - 0.5) * Math.PI + Math.PI / 2, Math.min(1, dt * 10)); m.spin.position.y = lerp(m.spin.position.y, 0.2, Math.min(1, dt * 10)); }
    else m.spin.rotation.z += (e.spinV || 8) * dt;
    legsTo(0.3, -0.4);
    return;
  }
  if (e.prone) {
    m.spin.rotation.z = -Math.PI / 2; m.spin.position.y = 0.22; m.gunPivot.rotation.z = Math.PI / 2; m.body.position.y = -0.9;
    legsTo(0, 0);
    return;
  }
  m.spin.position.y = 0.9;
  if (e.somersault && !e.onGround) {
    m.spin.rotation.z -= 16 * dt;
    legsTo(1.6, -2.2);
  } else {
    m.spin.rotation.z = 0;
    if (e.onGround && Math.abs(e.vx) > 0.5) {
      m.phase += Math.abs(e.vx) * dt * 1.75;
      for (const l of m.legs) {
        const ph = m.phase + (l.side > 0 ? Math.PI : 0);
        l.hip.rotation.z = Math.sin(ph) * 0.85;
        l.knee.rotation.z = -Math.max(0, -Math.cos(ph)) * 1.25;
      }
      m.body.position.y = -0.9 + Math.abs(Math.sin(m.phase)) * 0.06;
    } else if (!e.onGround) legsTo(0.5, -0.9);
    else { legsTo(0, 0); m.body.position.y = -0.9; }
  }
  m.gunPivot.rotation.z = lerp(m.gunPivot.rotation.z, aimAng, Math.min(1, dt * 25));
}
function setFlash(mats, on) {
  for (const mt of mats) {
    if (!mt.emissive) continue;
    if (on) mt.emissive.setRGB(2.5, 2.5, 2.5); else mt.emissive.copy(mt.userData.baseEm || new THREE.Color(0));
  }
}

// ======================================================================
// GAME STATE
// ======================================================================
let state = 'title';  // title | play | paused | over | win
let camX = 12, camY = 3.2, halfW = 13, time = 0;
let score = 0, hiScore = +(localStorage.getItem('contra2026_hi') || 0);
let spawnIdx = 0;
const enemies = [], corpses = [], bullets = [], bombs = [], pickups = [], timers = [], junk = [], wrecks = [];
const bridgeSegs = [];

const player = {
  x: 3, y: 2, vx: 0, vy: 0, w: 0.6, h: 1.8, facing: 1, onGround: false, ground: null, coyote: 0, jumpBuf: 0, dropTimer: 0,
  somersault: false, prone: false, weapon: 'R', fireCd: 0, invuln: 0, dead: false, deadT: 0, lives: 3, aim: { x: 1, y: 0 },
  model: buildSoldier(PLAYER_PAL), gravScale: 1, splashed: false,
};
scene.add(player.model.root);

function after(t, fn) { timers.push({ t, fn }); }
function addScore(n) { score += n; if (score > hiScore) { hiScore = score; localStorage.setItem('contra2026_hi', hiScore); } }

// ---------- Bridge (explodes under your feet) ----------
const woodMat = texMat(texWood, 1, 1), railMat = stdMat(0x3a3d40, 0.4, 0.85);
function buildBridge() {
  for (const b of bridgeSegs) { scene.remove(b.mesh); const k = solids.indexOf(b.solid); if (k >= 0) solids.splice(k, 1); }
  bridgeSegs.length = 0;
  for (let i = 0; i < BRIDGE.count; i++) {
    const x0 = BRIDGE.x0 + i * BRIDGE.seg, x1 = x0 + BRIDGE.seg;
    const g = new THREE.Group(); g.position.set((x0 + x1) / 2, 0, -0.5);
    g.add(mesh(new THREE.BoxGeometry(BRIDGE.seg - 0.06, 0.3, 3.2), woodMat, 0, -0.15, 0));
    for (const z of [-1.5, 1.5]) {
      g.add(mesh(new THREE.BoxGeometry(BRIDGE.seg, 0.08, 0.08), railMat, 0, 1.0, z));
      for (const px of [-BRIDGE.seg / 2 + 0.1, 0]) g.add(mesh(new THREE.BoxGeometry(0.1, 1.0, 0.1), railMat, px, 0.5, z));
    }
    g.add(mesh(new THREE.BoxGeometry(BRIDGE.seg, 0.18, 0.2), railMat, 0, -0.35, 1.5));
    scene.add(g);
    bridgeSegs.push({ x0, x1, mesh: g, solid: addSolid(x0, x1, -0.4, 0, { dynamic: true }), state: 'intact', t: 0 });
  }
}
function updateBridge(dt) {
  for (const b of bridgeSegs) {
    if (b.state === 'intact' && !player.dead && player.x > b.x0 - 1.2) { b.state = 'armed'; b.t = 0.7; }
    if (b.state === 'armed') {
      b.t -= dt;
      b.mesh.position.y = Math.sin(time * 80) * 0.03;          // rattles before it blows
      if (b.t <= 0) {
        b.state = 'gone'; b.solid.alive = false; scene.remove(b.mesh);
        explode((b.x0 + b.x1) / 2, 0, -0.3, 1.1);
        for (let k = 0; k < 7; k++) spawnDebris(rand(b.x0, b.x1), 0, rand(-1.4, 1.4), { mat: woodMat, size: rand(0.5, 0.9), sx: 3, sy: 0.4, sz: 0.8, vy: rand(6, 13), bounce: 0.25, life: 4 });
      }
    }
  }
}

// ---------- Spawns ----------
const SPAWNS = [
  { x: 14, t: 'runners', n: 2 }, { x: 22, t: 'flyer', drop: 'M' }, { x: 28, t: 'rifle', px: 38, py: 0 },
  { x: 40, t: 'runners', n: 3 }, { x: 50, t: 'runners', n: 2, side: -1 }, { x: 68, t: 'rifle', px: 90, py: 5.2 },
  { x: 72, t: 'runners', n: 3 }, { x: 86, t: 'turret', px: 104, py: 0 }, { x: 96, t: 'flyer', drop: 'S' },
  { x: 112, t: 'runners', n: 3 }, { x: 128, t: 'rifle', px: 145, py: 2.6 }, { x: 140, t: 'runners', n: 3 },
  { x: 155, t: 'rifle', px: 176, py: 2 }, { x: 160, t: 'turret', px: 186, py: 2 }, { x: 170, t: 'runners', n: 4 },
  { x: 178, t: 'flyer', drop: 'L' }, { x: 194, t: 'runners', n: 3 }, { x: 205, t: 'rifle', px: 230, py: 5.4 },
  { x: 210, t: 'turret', px: 237, py: 0 }, { x: 220, t: 'runners', n: 4 }, { x: 232, t: 'flyer', drop: 'S' },
  { x: 240, t: 'rifle', px: 256, py: 0 }, { x: 250, t: 'runners', n: 4 }, { x: 258, t: 'rifle', px: 274, py: 0 },
  { x: 264, t: 'runners', n: 3 }, { x: 276, t: 'boss' },
];
function handleSpawns() {
  while (spawnIdx < SPAWNS.length && camX >= SPAWNS[spawnIdx].x) {
    const s = SPAWNS[spawnIdx++];
    if (s.t === 'runners') for (let i = 0; i < s.n; i++) after(i * 0.75, () => spawnRunner(s.side || 1));
    else if (s.t === 'rifle') { const y = groundTopAt(s.px, s.py + 0.5); if (y > -5) makeSoldier('rifle', s.px, y, -1); }
    else if (s.t === 'turret') makeTurret(s.px, groundTopAt(s.px, s.py + 0.5));
    else if (s.t === 'flyer') makeFlyer(s.drop);
    else if (s.t === 'boss') activateBoss();
  }
}
function spawnRunner(side) {
  const x = side > 0 ? camX + halfW + 1.5 : camX - halfW - 1.5;
  if (x > 298.5) return;
  const top = groundTopAt(x, camY + 8);
  if (top < -5) return;
  makeSoldier('runner', x, top, -side);
}

function makeSoldier(type, x, y, dir) {
  const m = buildSoldier(type === 'rifle' ? RIFLE_PAL : RUNNER_PAL);
  scene.add(m.root);
  const e = {
    type, x, y, vx: 0, vy: 0, w: 0.6, h: 1.8, facing: dir, dir, onGround: false, hp: type === 'rifle' ? 2 : 1, alive: true,
    model: m, mats: m.mats, flash: 0, score: type === 'rifle' ? 200 : 100, fireT: rand(0.6, 1.4), burst: 0, aimAng: 0,
    jumpy: Math.random() < 0.75, dropTimer: 0, gravScale: 1,
  };
  e.box = () => ({ x0: e.x - 0.38, x1: e.x + 0.38, y0: e.y, y1: e.y + e.h });
  enemies.push(e);
  return e;
}
function makeTurret(x, y) {
  const m = buildTurret(); m.root.position.set(x, y, 0); scene.add(m.root);
  const e = { type: 'turret', x, y, hp: 12, alive: true, model: m, mats: m.mats, flash: 0, ang: Math.PI, fireT: 1.2, score: 500 };
  e.box = () => ({ x0: x - 1.0, x1: x + 1.0, y0: y, y1: y + 1.8 });
  enemies.push(e);
}
function makeFlyer(drop) {
  const m = buildFlyer(); scene.add(m.root);
  const e = { type: 'flyer', x: camX - halfW - 2, y: 0, baseY: camY + 3.2, t: 0, hp: 1, alive: true, model: m, mats: m.mats, flash: 0, drop, score: 300 };
  e.box = () => ({ x0: e.x - 0.85, x1: e.x + 0.85, y0: e.y - 0.5, y1: e.y + 0.5 });
  enemies.push(e);
}

// ---------- Bullets ----------
const geoBullet = new THREE.SphereGeometry(0.11, 10, 8);
const geoLaser = new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8); geoLaser.rotateZ(Math.PI / 2);
const BMAT = {
  R: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.5, 1.6) }),
  M: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.5, 1.6) }),
  S: new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 1.4, 0.8) }),
  L: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 3.5, 9) }),
  E: new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 2.2, 0.6) }),
};
const GLOW = {
  hot: new THREE.SpriteMaterial({ map: texSoft, color: new THREE.Color(3, 1.8, 0.5), blending: THREE.AdditiveBlending, depthWrite: false }),
  red: new THREE.SpriteMaterial({ map: texSoft, color: new THREE.Color(4, 0.6, 0.2), blending: THREE.AdditiveBlending, depthWrite: false }),
  blue: new THREE.SpriteMaterial({ map: texSoft, color: new THREE.Color(0.6, 1.5, 5), blending: THREE.AdditiveBlending, depthWrite: false }),
};
function fireBullet(x, y, dx, dy, speed, o) {
  const m = new THREE.Mesh(o.laser ? geoLaser : geoBullet, o.mat);
  if (o.laser) m.rotation.z = Math.atan2(dy, dx);
  if (o.scale) m.scale.setScalar(o.scale);
  const glow = new THREE.Sprite(o.glow); glow.scale.setScalar(o.laser ? 1.2 : 0.75 / (o.scale || 1)); m.add(glow);
  m.position.set(x, y, 0);
  scene.add(m);
  bullets.push({ x, y, vx: dx * speed, vy: dy * speed, mesh: m, life: o.life || 1.4, dmg: o.dmg || 1, friendly: !!o.friendly, pierce: !!o.laser, hit: new Set(), r: o.r || 0.15 });
}
function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    let dead = b.life <= 0 || Math.abs(b.x - camX) > halfW + 5 || b.y > camY + 14 || b.y < -3;
    if (!dead && b.friendly) {
      for (const e of enemies) {
        if (!e.alive || b.hit.has(e)) continue;
        const bx = e.box();
        if (b.x > bx.x0 - b.r && b.x < bx.x1 + b.r && b.y > bx.y0 - b.r && b.y < bx.y1 + b.r) {
          b.hit.add(e);
          sparks(b.x, b.y, 5);
          damageEnemy(e, b.dmg, b.vx);
          if (!b.pierce) { dead = true; break; }
        }
      }
    } else if (!dead && !player.dead && player.invuln <= 0 && pointInPlayer(b.x, b.y, 0.08)) {
      killPlayer(); dead = true;
    }
    if (!dead && solidAtPoint(b.x, b.y)) { dead = true; sparks(b.x, b.y, 4); puff(b.x, b.y, 2, C.dust, 1); }
    if (dead) { scene.remove(b.mesh); bullets.splice(i, 1); } else b.mesh.position.set(b.x, b.y, 0);
  }
}
function pointInPlayer(x, y, pad = 0) {
  const p = player;
  let y0 = p.y, y1 = p.y + 1.7;
  if (p.prone) y1 = p.y + 0.6;
  else if (p.somersault && !p.onGround) { y0 = p.y + 0.35; y1 = p.y + 1.45; }
  const hw = p.prone ? 0.9 : 0.3;
  const cx = p.prone ? p.x + p.facing * 0.1 : p.x;
  return x > cx - hw - pad && x < cx + hw + pad && y > y0 - pad && y < y1 + pad;
}

// ---------- Enemy logic ----------
function damageEnemy(e, dmg, dirX) {
  e.hp -= dmg; e.flash = 0.06; sfx.hit();
  if (e.hp <= 0) killEnemy(e, dirX);
}
function killEnemy(e, dirX) {
  e.alive = false;
  addScore(e.score);
  const dir = Math.sign(dirX || 1);
  if (e.type === 'runner' || e.type === 'rifle') {
    e.dead = true; e.deadT = 0; e.vx = dir * rand(3, 5); e.vy = rand(7, 10); e.spinV = rand(8, 12) * (Math.random() < 0.5 ? 1 : -1);
    e.dropTimer = 0;
    sfx.tone(300, 90, 0.25, 0.1, 'sawtooth');
    sparks(e.x, e.y + 1.2, 8, C.red);
    corpses.push(e);
  } else if (e.type === 'turret') {
    explode(e.x, e.y + 0.8, 0, 1.3);
    e.model.pivot.visible = false;
    for (const m of e.mats) { m.color.multiplyScalar(0.35); m.userData.baseEm = new THREE.Color(0); m.emissive.set(0); }
    junk.push(e.model.root);
    wrecks.push({ x: e.x, y: e.y + 1.1, t: 8 });
  } else if (e.type === 'flyer') {
    explode(e.x, e.y, 0, 0.8);
    scene.remove(e.model.root);
    spawnPickup(e.x, e.y, e.drop);
  } else if (e.type === 'cannon') {
    explode(e.x - 0.6, e.y, 0.3, 1.5);
    e.pivot.visible = false;
    wrecks.push({ x: e.x - 0.3, y: e.y, t: 99 });
  } else if (e.type === 'core') bossDefeated();
}
function updateEnemies(dt) {
  const px = player.x, py = player.y + 0.9;
  const n = enemies.length;
  for (let i = 0; i < n; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    if (e.flash > 0) { e.flash -= dt; setFlash(e.mats, e.flash > 0); }
    switch (e.type) {
      case 'runner': {
        if (e.onGround) {
          e.vx = e.dir * 5.5; e.facing = e.dir;
          const ahead = groundTopAt(e.x + e.dir * 1.1, e.y + 0.5);
          if ((ahead < e.y - 0.5 && e.jumpy) || e.hitWall) e.vy = 14;
        }
        moveBody(e, dt);
        animateSoldier(e.model, e, dt, 0);
        if (e.y < DEATH_Y) { splash(e.x, 0.7); e.alive = false; scene.remove(e.model.root); }
        if (e.x < camX - halfW - 6 || e.x > camX + halfW + 8) { e.alive = false; scene.remove(e.model.root); }
        break;
      }
      case 'rifle': {
        e.vx = 0;
        moveBody(e, dt);
        const dx = px - e.x, dy = py - (e.y + 1.5);
        e.facing = dx >= 0 ? 1 : -1;
        const ang = Math.round(Math.atan2(dy, Math.abs(dx)) / (Math.PI / 4)) * (Math.PI / 4);
        e.aimAng = clamp(ang, -Math.PI / 4, Math.PI / 2);
        animateSoldier(e.model, e, dt, e.aimAng);
        const onScreen = Math.abs(e.x - camX) < halfW + 0.5;
        e.fireT -= dt;
        if (onScreen && !player.dead && e.fireT <= 0) {
          const dX = Math.cos(e.aimAng) * e.facing, dY = Math.sin(e.aimAng);
          fireBullet(e.x + dX * 1.2, e.y + 1.5 + dY * 1.2, dX, dY, 10, { mat: BMAT.E, glow: GLOW.red, life: 3 });
          sfx.enemyShot();
          fx.spawn(e.x + dX * 1.25, e.y + 1.5 + dY * 1.2, 0.2, { life: 0.06, s0: 0.8, color: C.muzzle });
          e.burst++;
          if (e.burst >= 3) { e.burst = 0; e.fireT = rand(1.4, 2.2); } else e.fireT = 0.18;
        }
        if (e.y < DEATH_Y || e.x < camX - halfW - 6) { e.alive = false; scene.remove(e.model.root); }
        break;
      }
      case 'turret': {
        const mx = e.x, my = e.y + 1.05;
        const target = Math.atan2(py - my, px - mx);
        const d = wrapAngle(target - e.ang);
        e.ang += clamp(d, -1.6 * dt, 1.6 * dt);
        e.model.pivot.rotation.z = e.ang;
        e.fireT -= dt;
        if (Math.abs(e.x - camX) < halfW && Math.abs(d) < 0.12 && e.fireT <= 0 && !player.dead) {
          const dX = Math.cos(e.ang), dY = Math.sin(e.ang);
          fireBullet(mx + dX * 1.8, my + dY * 1.8, dX, dY, 9, { mat: BMAT.E, glow: GLOW.red, life: 3, scale: 1.4 });
          fx.spawn(mx + dX * 1.8, my + dY * 1.8, 0.3, { life: 0.08, s0: 1.4, color: C.muzzle });
          flash(mx + dX * 1.8, my + dY * 1.8, 1, 0xff7030, 60, 0.12);
          sfx.enemyShot(); e.fireT = 1.7;
        }
        if (e.x < camX - halfW - 4) { e.alive = false; junk.push(e.model.root); }
        break;
      }
      case 'flyer': {
        e.t += dt; e.x += 5.2 * dt; e.y = e.baseY + Math.sin(e.t * 2.4) * 1.3;
        e.model.root.position.set(e.x, e.y, 0);
        e.model.root.rotation.set(Math.sin(e.t * 3) * 0.4, 0, Math.cos(e.t * 2.4) * 0.25);
        if (Math.random() < 0.5) fx.spawn(e.x - 0.9, e.y, 0, { vx: -3, life: 0.25, s0: 0.5, s1: 0.1, color: C.blue });
        if (e.x > camX + halfW + 3) { e.alive = false; scene.remove(e.model.root); }
        break;
      }
      case 'cannon': updateCannon(e, dt); break;
      case 'core': updateCore(e, dt); break;
    }
    // contact damage
    if (e.alive && (e.type === 'runner' || e.type === 'rifle') && !player.dead && player.invuln <= 0) {
      const b = e.box();
      const p0 = player.y, p1 = player.y + (player.prone ? 0.6 : 1.6);
      if (player.x + 0.3 > b.x0 && player.x - 0.3 < b.x1 && p1 > b.y0 && p0 < b.y1) killPlayer();
    }
  }
  for (let i = enemies.length - 1; i >= 0; i--) if (!enemies[i].alive) enemies.splice(i, 1);
}
function updateCorpses(dt) {
  for (let i = corpses.length - 1; i >= 0; i--) {
    const e = corpses[i];
    e.deadT += dt;
    const wasGround = e.onGround;
    moveBody(e, dt);
    if (e.onGround) { e.vx = approach(e.vx, 0, 25 * dt); if (!wasGround) puff(e.x, e.y, 4); }
    animateSoldier(e.model, e, dt, 0);
    if (e.deadT > 1.2) e.model.root.visible = Math.floor(e.deadT * 20) % 2 === 0;
    if (e.y < DEATH_Y && !e.splashed) { e.splashed = true; splash(e.x, 0.7); }
    if (e.deadT > 1.8 || e.y < -6) { scene.remove(e.model.root); corpses.splice(i, 1); }
  }
}
function updateWrecks(dt) {
  for (let i = wrecks.length - 1; i >= 0; i--) {
    const w = wrecks[i]; w.t -= dt;
    if (Math.random() < 0.3) smoke.spawn(w.x + rand(-0.3, 0.3), w.y, rand(-0.3, 0.3), { vx: rand(-0.3, 0.3), vy: rand(1.2, 2), life: 2, s0: 0.5, s1: 2.2, drag: 0.5, color: C.smoke, alpha: 0.6 });
    if (Math.random() < 0.12) fx.spawn(w.x, w.y, 0.2, { vy: 1.5, life: 0.4, s0: 0.5, s1: 0.2, color: C.fire, color1: C.ember });
    if (w.t <= 0) wrecks.splice(i, 1);
  }
}

// ---------- Pickups ----------
function spawnPickup(x, y, kind) {
  const m = buildPickup(kind); scene.add(m);
  pickups.push({ x, y, vx: 2.5, vy: 9, w: 0.8, h: 0.8, onGround: false, kind, mesh: m, t: 0, dropTimer: 0, gravScale: 0.7 });
}
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i]; p.t += dt;
    const vyBefore = p.vy;
    moveBody(p, dt);
    if (p.onGround) {
      if (vyBefore < -4) { p.vy = -vyBefore * 0.4; p.onGround = false; puff(p.x, p.y, 3); }
      p.vx = approach(p.vx, 0, 6 * dt);
    }
    p.mesh.position.set(p.x, p.y + 0.45 + Math.sin(p.t * 4) * 0.06, 0);
    p.mesh.userData.core.rotation.y += dt * 3;
    if (p.t > 12) p.mesh.visible = Math.floor(p.t * 10) % 2 === 0;
    let remove = p.t > 15 || p.y < DEATH_Y || p.x < camX - halfW - 2;
    if (!remove && !player.dead && Math.abs(player.x - p.x) < 0.8 && player.y < p.y + 0.9 && player.y + player.h > p.y) {
      player.weapon = p.kind; addScore(1000); sfx.pickup();
      for (let k = 0; k < 16; k++) fx.spawn(p.x, p.y + 0.5, 0, { vx: rand(-5, 5), vy: rand(-2, 7), life: 0.5, s0: 0.3, s1: 0.05, grav: -10, color: C.spark });
      remove = true;
    }
    if (remove) { scene.remove(p.mesh); pickups.splice(i, 1); }
  }
}

// ---------- Boss: fortress wall ----------
const boss = { active: false, dying: 0, core: null, cannons: [], group: null, coreMesh: null, coreMat: null, lights: [], spawnT: 3, maxHp: 60 };
function buildBossModel() {
  const g = new THREE.Group();
  const panel = texMat(texPanel, 3, 5, { metalness: 0.7, roughness: 0.5, color: 0xd0d0d0 });
  const dark = stdMat(0x1e2226, 0.5, 0.8), metal = stdMat(0x5a6168, 0.35, 0.9);
  g.add(mesh(new THREE.BoxGeometry(16, 24, 12), panel, 308, 12, -2));
  g.add(mesh(new THREE.BoxGeometry(3, 6, 14), panel, 301.5, 25, -2));                   // tower
  g.add(mesh(new THREE.BoxGeometry(1.4, 1.2, 9), dark, 300.1, 12, -2));                  // cornice
  for (let y = 0.5; y < 22; y += 2.2) g.add(mesh(new THREE.BoxGeometry(0.25, 0.2, 11.6), metal, 299.95, y, -2));
  g.add(mesh(new THREE.BoxGeometry(0.4, 4.6, 3.6), dark, 299.9, 2.3, 0));                // core recess
  const coreMat = stdMat(0x400000, 0.2, 0.3, { emissive: new THREE.Color(4, 0.3, 0.1) });
  coreMat.userData.baseEm = coreMat.emissive.clone();
  const coreMesh = mesh(new THREE.SphereGeometry(0.72, 24, 16), coreMat, 299.55, 2.0, 0.2);
  g.add(coreMesh);
  const ring = mesh(new THREE.TorusGeometry(1.0, 0.16, 10, 28), metal, 299.6, 2.0, 0.2);
  g.add(ring);
  const cannons = [];
  for (const y of [6.2, 9.6]) {
    const cDark = stdMat(0x1e2226, 0.5, 0.8), cMetal = stdMat(0x5a6168, 0.35, 0.9); // own materials so hit-flash is local
    g.add(mesh(new THREE.BoxGeometry(1.6, 1.4, 1.8), cDark, 299.6, y, 0));
    const pivot = new THREE.Group(); pivot.position.set(299.2, y, 0); g.add(pivot);
    const b = mesh(new THREE.CylinderGeometry(0.24, 0.3, 1.9, 12), cMetal, -0.95, 0, 0); b.rotation.z = Math.PI / 2; pivot.add(b);
    cannons.push({ y, pivot, mats: [cDark, cMetal] });
  }
  for (let i = 0; i < 3; i++) {
    const lm = stdMat(0x200000, 0.4, 0, { emissive: new THREE.Color(5, 0.4, 0.1) });
    lm.userData.baseEm = lm.emissive.clone();
    g.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), lm, 300, 14 + i * 3, 2.5));
    boss.lights.push(lm);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 6), metal, 302, 31, -2));          // antenna
  scene.add(g);
  boss.group = g; boss.coreMesh = coreMesh; boss.coreMat = coreMat; boss.cannonDefs = cannons;
}
buildBossModel();

function activateBoss() {
  boss.active = true; boss.dying = 0; boss.spawnT = 3;
  sfx.alarm();
  document.getElementById('boss').classList.remove('hidden');
  const core = { type: 'core', x: 299.55, y: 2.0, hp: boss.maxHp, alive: true, mats: [], flash: 0, score: 10000 };
  core.box = () => ({ x0: 298.7, x1: 300.4, y0: 1.0, y1: 3.0 });
  boss.core = core;
  enemies.push(core);
  boss.cannons = boss.cannonDefs.map((d, i) => {
    d.pivot.visible = true;
    const c = { type: 'cannon', x: 299.2, y: d.y, hp: 16, alive: true, mats: d.mats, flash: 0, score: 1500, pivot: d.pivot, fireT: 1.5 + i * 1.1 };
    c.box = () => ({ x0: 297.9, x1: 300.4, y0: c.y - 0.75, y1: c.y + 0.75 });
    enemies.push(c);
    return c;
  });
}
function lobVelocity(x0, y0, x1, y1) {
  const T = clamp(Math.abs(x1 - x0) / 9, 0.8, 1.6);
  return { vx: (x1 - x0) / T, vy: (y1 - y0 - 0.5 * G * T * T) / T };
}
function updateCannon(e, dt) {
  const tx = player.x + player.vx * 0.35, ty = player.y + 0.5;
  const mx = e.x - 1.9, my = e.y;
  const v = lobVelocity(mx, my, tx, ty);
  const target = Math.atan2(v.vy, v.vx) - Math.PI;
  e.pivot.rotation.z = lerp(e.pivot.rotation.z, target, Math.min(1, dt * 4));
  e.fireT -= dt;
  if (e.fireT <= 0 && !player.dead) {
    e.fireT = rand(2.0, 2.8);
    const m = mesh(new THREE.SphereGeometry(0.28, 12, 10), stdMat(0x1a1a1a, 0.4, 0.8, { emissive: new THREE.Color(1.5, 0.2, 0) }));
    m.position.set(mx, my, 0); scene.add(m);
    bombs.push({ x: mx, y: my, vx: v.vx, vy: v.vy, mesh: m });
    explodeMuzzle(mx, my);
  }
}
function explodeMuzzle(x, y) {
  sfx.burst(0.25, 1800, 0.35); sfx.tone(160, 50, 0.2, 0.25, 'sine');
  flash(x, y, 1, 0xff8040, 120, 0.15);
  for (let i = 0; i < 8; i++) smoke.spawn(x, y, 0, { vx: rand(-3, -0.5), vy: rand(-0.5, 1.5), life: 0.9, s0: 0.5, s1: 1.8, drag: 2, color: C.smoke, alpha: 0.7 });
  fx.spawn(x, y, 0.2, { life: 0.1, s0: 2, color: C.muzzle });
}
function updateCore(e, dt) {
  const pulse = 0.6 + 0.4 * Math.sin(time * 6);
  if (e.flash > 0) boss.coreMat.emissive.setRGB(6, 6, 6);
  else boss.coreMat.emissive.setRGB(4 * pulse + 1, 0.3, 0.1);
  boss.lights.forEach((l, i) => l.emissive.setRGB(Math.sin(time * 5 + i * 2) > 0 ? 6 : 0.2, 0.4, 0.1));
  boss.spawnT -= dt;
  if (boss.spawnT <= 0) {
    boss.spawnT = 3.6;
    if (enemies.filter((x) => x.type === 'runner').length < 3) {
      const r = makeSoldier('runner', 298.4, 0, -1); r.jumpy = false;
      puff(298.4, 0.2, 5);
    }
  }
  document.getElementById('bossfill').style.width = `${Math.max(0, (e.hp / boss.maxHp) * 100)}%`;
}
function bossDefeated() {
  boss.dying = 3.6;
  boss.coreMesh.visible = false;
  for (const c of boss.cannons) if (c.alive) { c.alive = false; c.pivot.visible = false; }
  for (const e of enemies) if (e.type === 'runner') { e.alive = false; scene.remove(e.model.root); explode(e.x, e.y + 0.8, 0, 0.6); }
  document.getElementById('bossfill').style.width = '0%';
  explode(299.5, 2.0, 0.5, 2.2);
  sfx.musicOn = false;
}
function updateBossDeath(dt) {
  if (boss.dying <= 0) return;
  boss.dying -= dt;
  if (Math.random() < dt * 9) explode(rand(298.8, 301), rand(0.5, 13), rand(-0.5, 1.5), rand(0.8, 1.6));
  if (boss.dying <= 0) {
    explode(300, 4, 1, 3);
    wrecks.push({ x: 299.6, y: 2.0, t: 99 }, { x: 300, y: 8, t: 99 }, { x: 300.5, y: 13, t: 99 });
    after(2.0, () => winGame());
  }
}

// ---------- Bombs (gravity-affected artillery shells) ----------
function updateBombs(dt) {
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    const prevY = b.y;
    b.vy += G * dt; b.x += b.vx * dt; b.y += b.vy * dt;
    b.mesh.position.set(b.x, b.y, 0); b.mesh.rotation.z += dt * 8;
    if (Math.random() < 0.5) smoke.spawn(b.x, b.y, 0, { life: 0.6, s0: 0.25, s1: 0.8, color: C.smoke, alpha: 0.5 });
    const top = groundTopAt(b.x, prevY);
    let boom = b.y - 0.28 <= top;
    if (!boom && !player.dead && player.invuln <= 0 && pointInPlayer(b.x, b.y, 0.2)) boom = true;
    if (boom || b.y < -4) {
      if (b.y > WATER_Y) {
        explode(b.x, Math.max(b.y, top), 0, 0.9);
        const d = Math.hypot(player.x - b.x, player.y + 0.8 - b.y);
        if (d < 1.9 && !player.dead && player.invuln <= 0) killPlayer();
      } else splash(b.x, 1);
      scene.remove(b.mesh); bombs.splice(i, 1);
    }
  }
}

// ======================================================================
// PLAYER
// ======================================================================
function killPlayer(fromWater = false) {
  const p = player;
  if (p.dead || state !== 'play' || boss.dying > 0) return;
  if (!fromWater && p.invuln > 0) return;
  p.dead = true; p.deadT = 0; p.splashed = fromWater;
  p.prone = false; p.h = 1.8; p.somersault = false;
  if (!fromWater) { p.vy = 11; p.vx = -p.facing * 4; } else { p.vy = -2; p.vx = 0; }
  p.dropTimer = 0;
  sfx.death(); shake(0.5); screenFlash();
  if (!fromWater) sparks(p.x, p.y + 1, 10, C.red);
}
function respawnPlayer() {
  const p = player;
  p.lives--;
  if (p.lives < 0) { gameOver(); return; }
  let x = camX - halfW + 3;
  for (let k = 0; k < 60; k++) { if (groundTopAt(x, 40) > -5) break; x += 0.5; }
  Object.assign(p, { x, y: camY + 7, vx: 0, vy: 0, dead: false, invuln: 3, weapon: 'R', somersault: true, onGround: false, splashed: false });
  p.model.spin.rotation.z = 0; p.model.root.visible = true;
}
function updatePlayer(dt, jumpPressed) {
  const p = player, inp = input, m = p.model;
  if (jumpPressed) p.jumpBuf = 0.13;
  if (p.dead) {
    p.deadT += dt;
    p.gravScale = 1;
    moveBody(p, dt);
    if (p.onGround) p.vx = approach(p.vx, 0, 20 * dt);
    if (p.y < DEATH_Y && !p.splashed) { p.splashed = true; splash(p.x, 1); }
    p.model.root.visible = true;
    animateSoldier(m, p, dt, 0);
    if (p.deadT > 1.8) respawnPlayer();
    return;
  }
  p.invuln = Math.max(0, p.invuln - dt); p.fireCd -= dt; p.dropTimer -= dt; p.jumpBuf -= dt;

  p.prone = p.onGround && inp.down && !inp.left && !inp.right;
  p.h = p.prone ? 0.7 : 1.8;
  let dir = 0;
  if (!p.prone) { if (inp.left) dir -= 1; if (inp.right) dir += 1; }
  if (dir) p.facing = dir;
  p.vx = approach(p.vx, dir * RUN, (p.onGround ? 70 : 38) * dt);

  if (p.jumpBuf > 0 && (p.onGround || p.coyote > 0)) {
    if (inp.down && p.onGround && p.ground && p.ground.oneWay) { p.dropTimer = 0.3; p.y -= 0.02; p.onGround = false; }
    else { p.vy = JUMP; p.somersault = true; sfx.jump(); puff(p.x, p.y, 5); }
    p.jumpBuf = 0; p.coyote = 0; p.prone = false; p.h = 1.8;
  }
  // variable jump height: release early = heavier gravity on the way up; slightly heavier fall
  p.gravScale = p.vy > 0 ? (inp.jump ? 1 : 2.1) : 1.1;
  const wasGround = p.onGround;
  moveBody(p, dt);
  if (p.onGround) {
    if (!wasGround) { p.somersault = false; sfx.land(); puff(p.x, p.y, 4); }
    p.coyote = 0.1;
  } else p.coyote -= dt;
  const minX = camX - halfW + 0.6;
  if (p.x < minX) { p.x = minX; if (p.vx < 0) p.vx = 0; }
  if (p.y < DEATH_Y) { splash(p.x, 1.2); killPlayer(true); return; }

  // ----- aim (8 directions) -----
  let ax = 0, ay = 0;
  if (inp.left) ax = -1; else if (inp.right) ax = 1;
  if (inp.up) ay = 1;
  else if (inp.down && (!p.onGround || ax !== 0)) ay = -1;
  if (ax === 0 && ay === 0) ax = p.facing;
  if (ay !== 0 && ax === 0) ax = 0;
  const len = Math.hypot(ax, ay); ax /= len; ay /= len;
  p.aim.x = ax; p.aim.y = ay;
  const aimAng = Math.atan2(ay, Math.abs(ax));

  // ----- fire -----
  const w = WEAPONS[p.weapon];
  if (inp.fire && p.fireCd <= 0 && bullets.filter((b) => b.friendly).length < w.max) {
    p.fireCd = w.cd;
    let ox, oy;
    if (p.prone) { ox = p.x + p.facing * 1.7; oy = p.y + 0.24; }
    else if (p.somersault && !p.onGround) { ox = p.x + ax * 0.8; oy = p.y + 0.9 + ay * 0.8; }
    else { ox = p.x + ax * 1.25 + p.facing * 0.04; oy = p.y + 1.52 + ay * 1.2; }
    if (p.weapon === 'S') {
      const base = Math.atan2(ay, ax);
      for (const da of [-0.26, -0.13, 0, 0.13, 0.26]) fireBullet(ox, oy, Math.cos(base + da), Math.sin(base + da), w.speed, { friendly: true, mat: BMAT.S, glow: GLOW.red, scale: 1.5, r: 0.22 });
    } else if (p.weapon === 'L') {
      fireBullet(ox + ax * 1.2, oy + ay * 1.2, ax, ay, w.speed, { friendly: true, laser: true, mat: BMAT.L, glow: GLOW.blue, dmg: 3, r: 0.25 });
    } else {
      const spread = p.weapon === 'M' ? rand(-0.03, 0.03) : 0;
      const a = Math.atan2(ay, ax) + spread;
      fireBullet(ox, oy, Math.cos(a), Math.sin(a), w.speed, { friendly: true, mat: BMAT[p.weapon], glow: GLOW.hot });
    }
    sfx.shoot(p.weapon);
    fx.spawn(ox, oy, 0.25, { life: 0.05, s0: p.weapon === 'L' ? 1.0 : 0.9, color: p.weapon === 'L' ? C.blue : C.muzzle });
    flash(ox, oy, 0.8, p.weapon === 'L' ? 0x60a0ff : 0xffb060, 35, 0.06);
    if (p.weapon !== 'L') spawnDebris(p.x + p.facing * 0.3, p.y + (p.prone ? 0.4 : 1.45), 0.1,
      { mat: matBrass, size: 0.07, sx: 1, sy: 1, sz: 2.2, vx: -p.facing * rand(1.5, 3), vy: rand(3, 5.5), vz: rand(0.5, 2), bounce: 0.45, life: 1.4 });
  }

  animateSoldier(m, p, dt, aimAng);
  m.root.visible = p.invuln <= 0 || Math.floor(p.invuln * 18) % 2 === 0;
}

// ======================================================================
// CAMERA
// ======================================================================
function updateCamera(dt) {
  const aspect = window.innerWidth / window.innerHeight;
  halfW = CAM_DIST * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect;
  if (!player.dead) {
    const desired = Math.min(CAM_MAX_X, player.x + 1.5);
    if (desired > camX) camX = lerp(camX, desired, Math.min(1, dt * 8));
    const ty = clamp(player.y * 0.55, 0, 6) + 3.2;
    camY = lerp(camY, ty, Math.min(1, dt * 3));
  }
  shakeAmt = Math.max(0, shakeAmt - dt * 1.8);
  const s = shakeAmt * shakeAmt;
  camera.position.set(camX - 1.4 + rand(-s, s), camY + 2.0 + rand(-s, s), CAM_DIST);
  camera.lookAt(camX, camY + 0.3, 0);
  sun.target.position.set(camX, 0, 0);
  sun.position.set(camX - 26, 42, 32);
  sky.position.set(camX, 0, 0);
  sunDisc.position.set(camX - 120, 95, -260);
  dust.position.x = camX;
}

// ======================================================================
// HUD + SCREENS
// ======================================================================
const $ = (id) => document.getElementById(id);
let hudCache = '';
function updateHud() {
  const key = `${player.lives}|${score}|${player.weapon}`;
  if (key === hudCache) return;
  hudCache = key;
  $('lives').innerHTML = '<div class="medal"></div>'.repeat(Math.max(0, player.lives));
  $('score').textContent = String(score).padStart(6, '0');
  $('hi').textContent = 'HI ' + String(hiScore).padStart(6, '0');
  $('weapon').textContent = WEAPONS[player.weapon].name;
}
function showScreen(title, sub, hint) {
  const s = $('screen');
  s.querySelector('h1').innerHTML = title;
  s.querySelector('.sub').textContent = sub;
  $('screen-hint').textContent = hint;
  s.classList.remove('hidden');
}
function hideScreen() { $('screen').classList.add('hidden'); }

function onKeyPress(code) {
  if (code === 'Enter' || code === 'NumpadEnter' || (state !== 'play' && state !== 'paused' && code === 'Space')) {
    sfx.init();
    if (state === 'title' || state === 'over' || state === 'win') startGame();
    else if (state === 'paused') togglePause();
    return;
  }
  if ((code === 'KeyP' || code === 'Escape') && (state === 'play' || state === 'paused')) togglePause();
  if (code === 'KeyM') { sfx.musicOn = !sfx.musicOn; if (sfx.ctx) sfx.nextT = sfx.ctx.currentTime + 0.05; }
}
function togglePause() {
  if (state === 'play') { state = 'paused'; showScreen('PAUSED', 'STAGE 1 · JUNGLE ASSAULT', 'PRESS P / ESC / ENTER TO RESUME'); }
  else if (state === 'paused') { state = 'play'; hideScreen(); last = performance.now(); }
}
function gameOver() {
  state = 'over';
  document.getElementById('boss').classList.add('hidden');
  showScreen('GAME <em>OVER</em>', `SCORE ${String(score).padStart(6, '0')}`, 'PRESS ENTER TO CONTINUE');
}
function winGame() {
  state = 'win';
  addScore(player.lives * 5000);
  showScreen('MISSION <em>COMPLETE</em>', `SCORE ${String(score).padStart(6, '0')} · HI ${String(hiScore).padStart(6, '0')}`, 'PRESS ENTER TO PLAY AGAIN');
}

function clearDynamic() {
  for (const e of enemies) if (e.model) scene.remove(e.model.root);
  for (const e of corpses) scene.remove(e.model.root);
  for (const b of bullets) scene.remove(b.mesh);
  for (const b of bombs) scene.remove(b.mesh);
  for (const p of pickups) scene.remove(p.mesh);
  for (const d of debris) scene.remove(d.mesh);
  for (const j of junk) scene.remove(j);
  for (const a of [enemies, corpses, bullets, bombs, pickups, debris, junk, timers, wrecks]) a.length = 0;
  fx.clear(); smoke.clear();
}
function startGame() {
  clearDynamic();
  buildBridge();
  boss.active = false; boss.dying = 0;
  boss.coreMesh.visible = true;
  for (const d of boss.cannonDefs) d.pivot.visible = true;
  document.getElementById('boss').classList.add('hidden');
  document.getElementById('bossfill').style.width = '100%';
  spawnIdx = 0; camX = 12; camY = 3.2; score = 0; hudCache = '';
  Object.assign(player, { x: 3, y: 6, vx: 0, vy: 0, dead: false, lives: 3, weapon: 'R', invuln: 2, somersault: true, prone: false, h: 1.8, onGround: false, fireCd: 0 });
  player.model.spin.rotation.z = 0;
  sfx.musicOn = true; if (sfx.ctx) sfx.nextT = sfx.ctx.currentTime + 0.1;
  state = 'play';
  hideScreen();
  $('hud').classList.remove('hidden');
}

// ======================================================================
// MAIN LOOP
// ======================================================================
function step(dt, jumpPressed) {
  time += dt;
  for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const t = timers[i]; timers.splice(i, 1); t.fn(); } }
  handleSpawns();
  updatePlayer(dt, jumpPressed);
  updateBridge(dt);
  updateEnemies(dt);
  updateCorpses(dt);
  updateBullets(dt);
  updateBombs(dt);
  updatePickups(dt);
  updateBossDeath(dt);
  updateWrecks(dt);
  updateDebris(dt);
  fx.update(dt); smoke.update(dt);
  updateFlashes(dt);
  updateCamera(dt);
}

let last = performance.now(), acc = 0, visualT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  visualT += dt;
  let jumpPressed = readInput();
  if (state === 'play' || state === 'win') {
    acc += dt;
    while (acc >= FIXED) { step(FIXED, jumpPressed); jumpPressed = false; acc -= FIXED; }
    updateHud();
  } else if (state === 'title') {
    // attract mode: slow cinematic drift over the jungle
    camX = 12 + Math.sin(visualT * 0.15) * 6;
    updateCamera(dt);
    animateSoldier(player.model, { x: 3, y: 0, vx: 0, facing: 1, onGround: true }, dt, 0);
    fx.update(dt); smoke.update(dt);
  }
  updateWater(visualT);
  dust.rotation.y = Math.sin(visualT * 0.05) * 0.05;
  if (sfx.ctx && state === 'play') sfx.music();
  composer.render();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') togglePause(); });

buildBridge();
updateCamera(0);
$('screen-hint').textContent = 'PRESS ENTER / START';
requestAnimationFrame(frame);
