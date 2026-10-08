/*
  NIGHT SHIFT — game engine
  A 2.5D stealth platformer: the rules are 2D (side-on, tile-based), the picture is 3D.
  This file is all the game logic plus the flat HUD. render3d.js draws the 3D scene with Three.js.

  Sections:
    1. Constants and setup
    2. Input (all keys go through one controls layer)
    3. Save data
    4. Level loading
    5. Tiles, collision and line of sight
    6. Player movement
    7. Security: cameras, sentries, guards, drones, lasers, panels
    8. Heat, loot, exit
    9. HUD (the 3D scene lives in render3d.js)
   10. Menus and the main loop
*/
(() => {
  'use strict';

  // ───────────────────────── 1. Constants and setup ─────────────────────────
  const VERSION = 'V4';
  const T = 32, COLS = 30, ROWS = 17;
  const W = COLS * T, H = ROWS * T;
  const LEVELS = window.NIGHT_SHIFT_LEVELS || [];
  const ACTS = window.NIGHT_SHIFT_ACTS || [];

  const P_W = 20, P_HS = 54, P_HD = 28;          // player width, standing height, ducking height
  const WALK = 175, DUCK_WALK = 100, CLIMB = 135;  // pixels per second
  const GRAV = 2600, FALL_GRAV = 3200, JUMP_V = 500, MAX_FALL = 1100;   // V3: jump is about 1.5 tiles
  // How fast each kind of security fills the heat bar (per second while it sees you)
  const RATES = { camera: 45, guard: 70, drone: 55, sentry: 140 };

  // Money. Every item pays out once, the first time you escape with it.
  const VAL_VALUES = { cash: 150000, watch: 250000, jewels: 400000 };
  const GEM_VALUE = 1000000;
  const DECOY_PRICE = 750000, DECOY_MAX = 3, DECOY_LIFE = 14, DECOY_INSPECT = 2.5;   // lookalike decoy
  const NOISE_PRICE = 500000, NOISE_MAX = 3, NOISE_RING = 6;                        // remote noisemaker
  const UPGRADES = [
    { id: 'hack', name: 'Quick Fingers', desc: 'Hack panels faster.', prices: [2000000, 5000000], tiers: ['Hacking takes 0.8s', 'Hacking takes 0.5s'] },
    { id: 'loop', name: 'Loop Extender', desc: 'Looped cameras stay blind for longer.', prices: [3000000, 6000000], tiers: ['+3s on every camera loop', '+6s on every camera loop'] },
    { id: 'cool', name: 'Cool Head', desc: 'Heat starts cooling sooner, and faster.', prices: [2500000, 6000000], tiers: ['Cools after 1s, 60% faster', 'Cools after 0.6s, twice as fast'] },
    { id: 'dark', name: 'Dark Clothing', desc: 'Harder to pick out in the light.', prices: [8000000], tiers: ['Heat builds 20% slower'] },
  ];
  const fmtMoney = (n) => (n >= 1e6 ? `£${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}m` : `£${Math.round(n / 1000)}k`);

  const FONT_DISPLAY = '"Saira Stencil One", Impact, "Arial Narrow", sans-serif';
  const FONT_MONO = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
  const FONT_UI = '"Barlow Semi Condensed", "Arial Narrow", Arial, sans-serif';

  const PAINTINGS = [
    ['Harbour at Dusk', 1200000], ['Woman with a Lantern', 3400000], ['Study in Blue', 860000],
    ['The Coal Barge', 2100000], ['Still Life with Pears', 640000], ['Mersey Fog', 1700000],
    ['Portrait of a Clerk', 920000], ['The Last Tram', 2800000], ['Orchard in Rain', 1100000],
    ['Saint in Red', 4000000], ['Two Swimmers', 1500000], ['The Night Ferry', 2300000],
  ];
  const PAINT_HUES = [18, 205, 42, 160, 330, 260, 95, 10, 190, 280];

  const canvas = document.getElementById('hud');   // flat HUD drawn over the 3D view
  const ctx = canvas.getContext('2d');
  const RES = 2;
  canvas.width = W * RES;
  canvas.height = H * RES;

  const $ = (id) => document.getElementById(id);
  const rad = (d) => (d * Math.PI) / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
  const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtTime = (t) => `${Math.floor(t / 60)}:${pad2(Math.floor(t % 60))}.${Math.floor((t % 1) * 10)}`;

  // ───────────────────────── 2. Input ─────────────────────────
  // The game only ever asks "is MOVE LEFT held?", never "is the A key held?".
  // To add touch controls later, set Input.virtual[action] = true/false from on-screen buttons.
  const BINDINGS = {
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    up: ['KeyW', 'ArrowUp'],
    jump: ['Space', 'KeyW', 'ArrowUp'],
    jumpOnly: ['Space'],
    down: ['KeyS', 'ArrowDown', 'ControlLeft', 'ControlRight'],
    interact: ['KeyE'],
    restart: ['KeyR'],
    pause: ['Escape', 'KeyP'],
    decoy: ['KeyQ'],
    noise: ['KeyF'],
  };
  const GAME_KEYS = new Set(Object.values(BINDINGS).flat());
  const Input = {
    held: new Set(), pressed: new Set(), released: new Set(), virtual: {},
    down(a) { return !!this.virtual[a] || BINDINGS[a].some((k) => this.held.has(k)); },
    hit(a) { return BINDINGS[a].some((k) => this.pressed.has(k)); },
    let(a) { return BINDINGS[a].some((k) => this.released.has(k)); },
    endStep() { this.pressed.clear(); this.released.clear(); },
  };
  addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code) && mode === 'play') e.preventDefault();
    if (!e.repeat) Input.pressed.add(e.code);
    Input.held.add(e.code);
    onMenuKey(e);
  });
  addEventListener('keyup', (e) => { Input.held.delete(e.code); Input.released.add(e.code); });
  addEventListener('blur', () => { Input.held.clear(); if (mode === 'play') pause(); });

  // ───────────────────────── 3. Save data ─────────────────────────
  const SAVE_KEY = 'nightshift.v1';
  let save = { unlocked: 1, best: {}, bank: 0, taken: [], upgrades: {}, decoys: 0, noise: 0 };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === 'object') save = { ...save, ...s, upgrades: { ...(s.upgrades || {}) }, taken: s.taken || [] };
  } catch (e) { /* storage unavailable: progress lasts for this visit only */ }
  const tier = (id) => save.upgrades[id] || 0;
  const hackTime = () => [1.2, 0.8, 0.5][tier('hack')];
  const loopBonus = () => [0, 3, 6][tier('loop')];
  const coolDelay = () => [1.5, 1.0, 0.6][tier('cool')];
  const coolRate = () => [7, 11, 14][tier('cool')];
  const heatGain = () => (tier('dark') ? 0.8 : 1);
  if (location.hash === '#all') save.unlocked = LEVELS.length;   // testing shortcut: add #all to the URL
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }

  // ───────────────────────── 4. Level loading ─────────────────────────
  let L = null;        // the level being played (or shown behind a menu)
  let mode = 'title';  // title | select | play | paused | caught | won
  let clock = 0;       // real time, for animation

  function loadLevel(index) {
    const def = LEVELS[index];
    const grid = [], loot = [];
    let start = { x: 2, y: 15 }, exit = { x: 27, y: 15 };
    let artCount = 0;
    for (let y = 0; y < ROWS; y++) {
      const row = def.map[y] || '';
      grid.push([]);
      for (let x = 0; x < COLS; x++) {
        const ch = row[x] || '#';
        grid[y].push(ch === '#' ? 1 : ch === 'H' ? 2 : ch === 'G' ? 3 : ch === 'g' ? 4 : 0);
        if (ch === 'P') start = { x, y };
        if (ch === 'E') exit = { x, y };
        if (ch === '$') {
          const p = def.final ? ['NIGHT SHIFT (the game itself)', 10000000] : PAINTINGS[(index * 3 + artCount) % PAINTINGS.length];
          loot.push({ kind: 'art', x, y, got: false, title: p[0], value: p[1], hue: PAINT_HUES[(index + artCount * 3) % PAINT_HUES.length], variant: def.final ? 'cartridge' : 'painting' });
          artCount++;
        }
        if (ch === '*') loot.push({ kind: 'gem', x, y, got: false, value: GEM_VALUE });
      }
    }
    const VAL_KINDS = [['cash', 'a bundle of cash'], ['watch', 'a gold watch'], ['jewels', 'a jewellery box']];
    (def.objects || []).filter((o) => o.type === 'valuable').forEach((o, k) => {
      const v = VAL_KINDS[(index + k) % VAL_KINDS.length];
      loot.push({ kind: 'val', x: o.x, y: o.y, got: false, variant: v[0], label: v[1], value: VAL_VALUES[v[0]] });
    });
    loot.forEach((it) => { it.id = `${index}:${it.kind}:${it.x},${it.y}`; it.banked = save.taken.includes(it.id); });
    L = {
      index, def, grid, loot, exit, decoys: [], noises: [],
      glitch: def.glitch || { on: 2, off: 1.5 },
      act: def.act || 0,
      heatMode: true,
      shadows: (def.shadows || []).map((s) => ({ x: s.x * T, y: s.y * T, w: s.w * T, h: s.h * T })),
      objects: [],
      reinforce: (def.reinforce || []).map((r) => ({ heat: r.heat, objects: r.objects, done: false })),
      time: 0, heat: 0, peakHeat: 0, unseen: 0, everSeen: false, seenNow: false,
      laserCooldown: 0, flash: 0, shake: 0, toast: null, prompt: null,
      particles: [], cause: '',
      player: {
        x: start.x * T + (T - P_W) / 2, y: (start.y + 1) * T - P_HS, w: P_W, h: P_HS,
        vx: 0, vy: 0, onGround: true, ducking: false, climbing: false,
        facing: 1, coyote: 0, jumpBuf: 0, walk: 0, hidden: false,
      },
    };
    (def.objects || []).forEach(spawnObject);
    if (render3dOK) R.build(L, {
      solid: (x, y) => x < 0 || y < 0 || x >= COLS || y >= ROWS || grid[y][x] === 1,
      ladder, ladderTop,
      glitch: (x, y) => (grid[y] && (grid[y][x] === 3 || grid[y][x] === 4) ? grid[y][x] : 0),
    });
  }

  function spawnObject(o) {
    const k = o.type;
    if (k === 'camera' || k === 'sentry') {
      L.objects.push({
        kind: k, id: o.id, x: o.x * T, y: o.y * T,
        base: rad(o.angle ?? 90), sweep: rad(o.sweep || 0), period: o.period || 4, phase: o.phase || 0,
        fov: rad(o.fov || (k === 'sentry' ? 30 : 40)), range: (o.range || 6) * T,
        t: 0, angle: rad(o.angle ?? 90), off: 0, seeing: false,
      });
    } else if (k === 'guard') {
      L.objects.push({
        kind: 'guard', x: (o.x + 0.5) * T, feet: o.y * T,
        from: (o.from + 0.5) * T, to: (o.to + 0.5) * T, speed: (o.speed || 1.5) * T,
        dir: 1, wait: 0, step: 0, seeing: false,
      });
    } else if (k === 'drone') {
      const path = o.path.map(([x, y]) => ({ x: x * T, y: y * T }));
      L.objects.push({
        kind: 'drone', path, seg: 0, x: path[0].x, y: path[0].y, speed: (o.speed || 2.4) * T,
        fov: rad(o.fov || 56), range: (o.range || 7) * T, seeing: false, spin: 0,
      });
    } else if (k === 'laser') {
      L.objects.push({
        kind: 'laser', id: o.id, x1: o.x1 * T, y1: o.y1 * T, x2: o.x2 * T, y2: o.y2 * T,
        on: o.on || 0, off: o.off || 0, offset: o.offset || 0, disabled: false, live: true,
      });
    } else if (k === 'panel') {
      L.objects.push({
        kind: 'panel', x: o.x * T, y: o.y * T, targets: o.targets || [], duration: o.duration || 6,
        progress: 0, used: false, cooldown: 0,
      });
    }
  }

  // ───────────────────────── 5. Tiles, collision, line of sight ─────────────────────────
  function tileAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return 1;
    const t = L.grid[ty][tx];
    if (t === 3 || t === 4) return glitchOn(t) && !(L.inside && L.inside.has(ty * COLS + tx)) ? 1 : 0;   // never appears inside the player
    return t;
  }
  // Glitch blocks (G and g) flicker on and off, taking turns
  function glitchOn(t) {
    const g = L.glitch, per = g.on + g.off;
    return ((L.time + (t === 4 ? per / 2 : 0)) % per) < g.on;
  }
  function playerInCell(tx, ty) {
    const p = L.player;
    return p.x < (tx + 1) * T && p.x + p.w > tx * T && p.y < (ty + 1) * T && p.y + p.h > ty * T;
  }
  const solid = (tx, ty) => tileAt(tx, ty) === 1;
  const ladder = (tx, ty) => tileAt(tx, ty) === 2;
  const ladderTop = (tx, ty) => ladder(tx, ty) && !ladder(tx, ty - 1);

  function hitsSolid(x, y, w, h) {
    const x0 = Math.floor(x / T), x1 = Math.floor((x + w - 0.01) / T);
    const y0 = Math.floor(y / T), y1 = Math.floor((y + h - 0.01) / T);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solid(tx, ty)) return true;
    return false;
  }

  // Distance a ray travels before hitting a wall (capped at maxD). Grid DDA.
  function castRay(ox, oy, ang, maxD) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let mx = Math.floor(ox / T), my = Math.floor(oy / T);
    if (solid(mx, my)) return 0;
    const ddx = dx === 0 ? 1e9 : Math.abs(T / dx);
    const ddy = dy === 0 ? 1e9 : Math.abs(T / dy);
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    let sdx = dx < 0 ? ((ox - mx * T) / T) * ddx : (((mx + 1) * T - ox) / T) * ddx;
    let sdy = dy < 0 ? ((oy - my * T) / T) * ddy : (((my + 1) * T - oy) / T) * ddy;
    for (let i = 0; i < 200; i++) {
      let dist;
      if (sdx < sdy) { dist = sdx; sdx += ddx; mx += sx; } else { dist = sdy; sdy += ddy; my += sy; }
      if (dist > maxD) return maxD;
      if (solid(mx, my)) return dist;
    }
    return maxD;
  }

  const inShadow = (px, py) => L.shadows.some((s) => px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h);

  function coneSees(c, px, py) {
    const dx = px - c.ox, dy = py - c.oy;
    const d = Math.hypot(dx, dy);
    if (d > c.range) return false;
    const a = Math.atan2(dy, dx);
    if (Math.abs(wrapAngle(a - c.angle)) > c.fov / 2) return false;
    return castRay(c.ox, c.oy, a, d) >= d - 1;
  }

  // Does a line segment touch a rectangle? (Liang–Barsky clipping)
  function segHitsRect(x1, y1, x2, y2, r) {
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;
    const checks = [[-dx, x1 - r.x], [dx, r.x + r.w - x1], [-dy, y1 - r.y], [dy, r.y + r.h - y1]];
    for (const [p, q] of checks) {
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }

  // ───────────────────────── 6. Player movement ─────────────────────────
  function bodyOnLadder(p, col) {
    const r0 = Math.floor(p.y / T), r1 = Math.floor((p.y + p.h - 0.01) / T);
    for (let r = r0; r <= r1; r++) if (ladder(col, r)) return true;
    return false;
  }

  function standingOnLadderTop(p, col) {
    const feet = p.y + p.h;
    const row = Math.round(feet / T);
    return p.onGround && Math.abs(feet - row * T) < 1 && ladderTop(col, row);
  }

  function moveX(p, dx) {
    if (!dx) return;
    p.x += dx;
    if (hitsSolid(p.x, p.y, p.w, p.h)) {
      p.x = dx > 0 ? Math.floor((p.x + p.w) / T) * T - p.w - 0.01 : (Math.floor(p.x / T) + 1) * T + 0.01;
      p.vx = 0;
    }
  }

  function moveY(p, dy) {
    const oldBottom = p.y + p.h;
    p.y += dy;
    if (dy > 0) {
      if (hitsSolid(p.x, p.y, p.w, p.h)) {
        p.y = Math.floor((p.y + p.h) / T) * T - p.h;
        p.vy = 0; p.onGround = true;
        return;
      }
      if (!p.climbing) { // the top rung of a ladder works as a floor you can stand on
        const bottom = p.y + p.h, row = Math.floor(bottom / T);
        if (row * T >= oldBottom - 0.01) {
          const x0 = Math.floor(p.x / T), x1 = Math.floor((p.x + p.w - 0.01) / T);
          for (let tx = x0; tx <= x1; tx++) {
            if (ladderTop(tx, row)) { p.y = row * T - p.h; p.vy = 0; p.onGround = true; return; }
          }
        }
      }
    } else if (dy < 0 && hitsSolid(p.x, p.y, p.w, p.h)) {
      p.y = (Math.floor(p.y / T) + 1) * T;
      p.vy = 0;
    }
  }

  function setDuck(p, want) {
    if (want && !p.ducking) {
      p.ducking = true; p.y += P_HS - P_HD; p.h = P_HD;
    } else if (!want && p.ducking && !hitsSolid(p.x, p.y - (P_HS - P_HD), p.w, P_HS)) {
      p.ducking = false; p.y -= P_HS - P_HD; p.h = P_HS;
    }
  }

  function updatePlayer(dt) {
    const p = L.player;
    const left = Input.down('left'), right = Input.down('right');
    const upHeld = Input.down('up'), downHeld = Input.down('down');
    const col = Math.floor((p.x + p.w / 2) / T);
    const onLadder = bodyOnLadder(p, col);
    const onTop = standingOnLadderTop(p, col);

    // Grab a ladder
    if (!p.climbing && ((onLadder && upHeld && !p.ducking) || (onTop && downHeld))) {
      setDuck(p, false);
      if (!p.ducking) {
        p.climbing = true; p.vx = 0; p.vy = 0;
        p.x = col * T + (T - p.w) / 2;
        if (onTop) p.y += 3;
      }
    }

    if (p.climbing) {
      p.onGround = false;
      if (Input.hit('jumpOnly')) { p.climbing = false; p.vy = -JUMP_V * 0.75; p.vx = (right - left) * WALK; }
      else if ((left || right) && !upHeld && !downHeld) { p.climbing = false; }
      else {
        p.vy = upHeld ? -CLIMB : downHeld ? CLIMB : 0;
        moveY(p, p.vy * dt);
        if (p.onGround) p.climbing = false;          // reached the floor at the bottom
        const feetRow = Math.floor((p.y + p.h - 0.01) / T);
        if (p.climbing && !ladder(col, feetRow) && ladderTop(col, feetRow + 1)) {
          p.y = (feetRow + 1) * T - p.h; p.vy = 0; p.climbing = false; p.onGround = true; // stepped off the top
        }
        if (p.climbing && !bodyOnLadder(p, col)) p.climbing = false;
        p.walk += Math.abs(p.vy) * dt * 0.05;
        return;
      }
    }

    // Ducking
    setDuck(p, downHeld && (p.onGround || p.ducking) && !onTop);

    // Running
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    const target = dir * (p.ducking ? DUCK_WALK : WALK);
    p.vx = approach(p.vx, target, (p.onGround ? 2600 : 1500) * dt);
    if (dir) p.facing = dir;

    // Jumping (with a little forgiveness either side of the moment you leave a ledge)
    p.coyote = p.onGround ? 0.09 : p.coyote - dt;
    const jumpHit = Input.hit('jumpOnly') || (Input.hit('jump') && !onLadder);
    p.jumpBuf = jumpHit ? 0.12 : p.jumpBuf - dt;
    if (p.jumpBuf > 0 && p.coyote > 0 && !p.ducking) {
      p.vy = -JUMP_V; p.coyote = 0; p.jumpBuf = 0; p.onGround = false;
    }
    if (Input.let('jump') && p.vy < 0) p.vy *= 0.5;

    p.vy = Math.min(p.vy + (p.vy > 0 ? FALL_GRAV : GRAV) * dt, MAX_FALL);
    p.onGround = false;
    moveX(p, p.vx * dt);
    moveY(p, p.vy * dt);
    if (p.onGround && Math.abs(p.vx) > 5) p.walk += Math.abs(p.vx) * dt * 0.06;
  }

  // ───────────────────────── 7. Security ─────────────────────────
  const alertLevel = () => (!L.heatMode ? 0 : L.heat >= 66 ? 2 : L.heat >= 33 ? 1 : 0);

  function updateObjects(dt) {
    const alert = alertLevel();
    const speedUp = 1 + alert * 0.35;
    for (const o of L.objects) {
      if (o.kind === 'camera' || o.kind === 'sentry') {
        if (o.off > 0) o.off -= dt;
        o.t += dt * speedUp;
        o.angle = o.base + (o.sweep ? o.sweep * Math.sin((2 * Math.PI * o.t) / o.period + o.phase) : 0);
      } else if (o.kind === 'guard') {
        const lure = pickLure(o);
        if (lure) {
          // a decoy or a ringing noisemaker on this floor: walk over and check it out
          o.lured = true;
          const dx = lure.x - o.x;
          if (Math.abs(dx) > 22) { o.dir = Math.sign(dx); o.x += o.dir * o.speed * 1.25 * dt; o.step += o.speed * dt * 0.07; o.wait = 0; }
          else {
            o.dir = Math.sign(dx) || o.dir; o.wait = 0.01;
            if (lure.decoy) {
              lure.decoy.inspect += dt;
              if (lure.decoy.inspect > DECOY_INSPECT) { lure.decoy.busted = 0.01; if (mode === 'play') showToast('A guard knocked your decoy over'); }
            }
          }
        } else if (o.lured || o.x < o.from - 1 || o.x > o.to + 1) {
          // decoy finished: walk back to the patrol route
          const target = clamp(o.x, o.from, o.to);
          const dx = target - o.x;
          if (Math.abs(dx) > 2) { o.dir = Math.sign(dx); o.x += o.dir * o.speed * dt; o.step += o.speed * dt * 0.06; o.wait = 0; }
          else { o.x = target; o.lured = false; o.wait = 0; }
        } else if (o.wait > 0) {
          o.wait -= dt;
          if (o.wait <= 0) o.dir *= -1;
        } else {
          o.x += o.dir * o.speed * speedUp * dt;
          o.step += o.speed * speedUp * dt * 0.06;
          const end = o.dir > 0 ? o.to : o.from;
          if ((o.dir > 0 && o.x >= end) || (o.dir < 0 && o.x <= end)) { o.x = end; o.wait = alert ? 0.6 : 1.3; }
        }
      } else if (o.kind === 'drone') {
        const next = o.path[(o.seg + 1) % o.path.length];
        const dx = next.x - o.x, dy = next.y - o.y, d = Math.hypot(dx, dy);
        const move = o.speed * speedUp * dt;
        if (d <= move) { o.x = next.x; o.y = next.y; o.seg = (o.seg + 1) % o.path.length; }
        else { o.x += (dx / d) * move; o.y += (dy / d) * move; }
        o.spin += dt * 30;
      } else if (o.kind === 'laser') {
        o.live = !o.disabled && (!o.on || ((L.time + o.offset) % (o.on + o.off)) < o.on);
      } else if (o.kind === 'panel' && o.cooldown > 0) {
        o.cooldown -= dt;
      }
    }
  }

  // Every vision cone currently active: where it starts, which way it points, how wide and far.
  function getCones() {
    const alert = alertLevel();
    const cones = [];
    for (const o of L.objects) {
      if ((o.kind === 'camera' || o.kind === 'sentry') && o.off <= 0) {
        cones.push({ src: o, kind: o.kind, ox: o.x, oy: o.y + 5, angle: o.angle, fov: o.fov, range: o.range });
      } else if (o.kind === 'guard') {
        // the guard's eyes follow his torch: the beam starts at the torch in his hand
        const face = o.dir;
        cones.push({
          src: o, kind: 'guard', ox: o.x + face * 15, oy: o.feet - 38,
          angle: face > 0 ? rad(12) : Math.PI - rad(12), fov: rad(46), range: (7 + alert * 1.5) * T,
        });
      } else if (o.kind === 'drone') {
        cones.push({ src: o, kind: 'drone', ox: o.x, oy: o.y + 8, angle: Math.PI / 2, fov: o.fov, range: o.range + alert * T });
      }
    }
    return cones;
  }

  function updateSecurity(dt) {
    const p = L.player;
    const cx = p.x + p.w / 2;
    const points = [[cx, p.y + 4], [cx, p.y + p.h / 2], [cx, p.y + p.h - 4], [p.x + 3, p.y + p.h / 2], [p.x + p.w - 3, p.y + p.h / 2]];
    const visible = points.filter(([x, y]) => !inShadow(x, y));
    p.hidden = visible.length === 0;

    let rate = 0, cause = '';
    for (const c of getCones()) {
      c.src.seeing = false;
      if (visible.some(([x, y]) => coneSees(c, x, y))) {
        c.src.seeing = true;
        if (RATES[c.kind] > rate) { rate = RATES[c.kind]; cause = c.kind; }
      }
    }

    L.seenNow = rate > 0;
    if (rate > 0) {
      L.heat += rate * heatGain() * dt;
      L.everSeen = true; L.unseen = 0; L.cause = cause;
    } else {
      L.unseen += dt;
      if (L.unseen > coolDelay()) L.heat -= coolRate() * dt;
    }

    // Lasers
    if (L.laserCooldown > 0) L.laserCooldown -= dt;
    for (const o of L.objects) {
      if (o.kind === 'laser' && o.live && L.laserCooldown <= 0 && segHitsRect(o.x1, o.y1, o.x2, o.y2, { x: p.x + 2, y: p.y + 1, w: p.w - 4, h: p.h - 1 })) {
        L.everSeen = true; L.cause = 'laser'; L.flash = 0.35;
        L.heat += 40; L.laserCooldown = 0.9; L.shake = 0.25;
        showToast('Tripwire! Heat +40');
      }
    }

    // Guards grab you if you bump into them (unless you are ducking in the dark)
    for (const o of L.objects) {
      if (o.kind !== 'guard') continue;
      const g = { x: o.x - 10, y: o.feet - P_HS, w: 20, h: P_HS };
      if (overlap(p, g) && !(p.hidden && p.ducking)) { L.heat = 100; L.cause = 'grab'; }
    }

    L.heat = clamp(L.heat, 0, 100);
    L.peakHeat = Math.max(L.peakHeat, L.heat);

    for (const r of L.reinforce) {
      if (!r.done && L.heatMode && L.heat >= r.heat) {
        r.done = true;
        r.objects.forEach(spawnObject);
        showToast('Lockdown: response drones inbound');
      }
    }

    if (L.heat >= 100) caught();
  }

  function updatePanels(dt) {
    const p = L.player;
    L.prompt = null;
    for (const o of L.objects) {
      if (o.kind !== 'panel') continue;
      const zone = { x: o.x - 8, y: o.y - 24, w: T + 16, h: T + 40 };
      if (!overlap(p, zone)) { o.progress = Math.max(0, o.progress - dt * 2); continue; }
      const permanent = o.targets.some((id) => L.objects.some((x) => x.kind === 'laser' && x.id === id));
      if (o.used && permanent) { L.prompt = 'Panel already hacked'; continue; }
      if (o.cooldown > 0) { L.prompt = `Panel rebooting… ${Math.ceil(o.cooldown)}`; continue; }
      if (Input.down('interact')) {
        o.progress += dt / hackTime();
        L.prompt = 'Hacking…';
        if (o.progress >= 1) {
          o.progress = 0; o.used = true;
          for (const t of L.objects) {
            if (!o.targets.includes(t.id)) continue;
            if (t.kind === 'laser') t.disabled = true;
            if (t.kind === 'camera' || t.kind === 'sentry') t.off = o.duration + loopBonus();
          }
          o.cooldown = permanent ? 0 : o.duration + loopBonus() + 2;
          showToast(permanent ? 'Lasers offline' : `Camera looped for ${o.duration + loopBonus()} seconds`);
          burst(o.x + T / 2, o.y + 10, '#7cf2c4', 14);
        }
      } else {
        o.progress = Math.max(0, o.progress - dt);
        L.prompt = 'Hold E to hack';
      }
    }
  }

  // ───────────────────────── 8. Heat, loot, exit ─────────────────────────
  function updateLoot() {
    const p = L.player;
    for (const it of L.loot) {
      if (it.got) continue;
      const r = it.kind === 'art' ? { x: it.x * T + 2, y: it.y * T + 2, w: T - 4, h: T - 4 } : { x: it.x * T + 8, y: it.y * T + 8, w: 16, h: 16 };
      if (overlap(p, r)) {
        it.got = true;
        if (it.kind === 'art') {
          showToast(`Lifted “${it.title}” (${fmtMoney(it.value)})`);
          burst(it.x * T + T / 2, it.y * T + T / 2, '#f2c46d', 18);
        } else if (it.kind === 'val') {
          showToast(`Pocketed ${it.label} (${fmtMoney(it.value)})`);
          burst(it.x * T + T / 2, it.y * T + T / 2, '#ffe9a8', 10);
        } else {
          showToast(`Bonus gem! (${fmtMoney(it.value)})`);
          burst(it.x * T + T / 2, it.y * T + T / 2, '#8fe9ff', 16);
        }
      }
    }
    const door = { x: L.exit.x * T + 6, y: (L.exit.y - 1) * T + 4, w: T - 12, h: 2 * T - 4 };
    if (overlap(p, door)) {
      const left = L.loot.filter((i) => i.kind === 'art' && !i.got).length;
      if (left === 0) { L.prompt = 'Press E to slip out'; if (Input.hit('interact')) win(); }
      else L.prompt = left === 1 ? 'Locked · take the painting first' : `Locked · ${left} paintings still on the walls`;
    }
  }

  // Gadgets
  // Decoy (Q): a lookalike of the thief, set up where you stand. Guards on that floor walk over to check it,
  // and knock it over after a few seconds of staring at it.
  // Noisemaker (F): press F to drop it, walk away, press F again to set it off. Guards on that floor investigate.
  function placeDecoy() {
    const p = L.player;
    if (save.decoys <= 0) { showToast('No decoys · buy them at the Safehouse'); return; }
    if (!p.onGround || p.climbing) { showToast('Stand on the floor to set up a decoy'); return; }
    save.decoys--; persist();
    L.decoys.push({ x: p.x + p.w / 2, feet: p.y + p.h, facing: p.facing, t: DECOY_LIFE, inspect: 0, busted: 0 });
    showToast(`Decoy set up · ${save.decoys} left`);
  }
  function noiseKey() {
    const p = L.player;
    const armed = L.noises.find((n) => !n.ringing && !n.done);
    if (armed) { armed.ringing = NOISE_RING; showToast('Noisemaker going off!'); return; }
    if (save.noise <= 0) { showToast('No noisemakers · buy them at the Safehouse'); return; }
    if (!p.onGround || p.climbing) { showToast('Stand on the floor to drop a noisemaker'); return; }
    save.noise--; persist();
    L.noises.push({ x: p.x + p.w / 2, feet: p.y + p.h, ringing: 0, done: false });
    showToast('Noisemaker dropped · walk away, then press F to set it off');
  }
  function updateGadgets(dt) {
    for (const d of L.decoys) { if (d.busted > 0) d.busted += dt; else if ((d.t -= dt) <= 0) d.busted = 0.01; }
    L.decoys = L.decoys.filter((d) => d.busted < 1.5);
    for (const n of L.noises) if (n.ringing > 0 && (n.ringing -= dt) <= 0) { n.ringing = 0; n.done = true; }
    L.noises = L.noises.filter((n) => !n.done);
  }
  // What a guard would go and look at: a ringing noisemaker beats a decoy; must be on his floor and close enough
  function pickLure(o) {
    let best = null, bestD = Infinity;
    for (const n of L.noises || []) {
      if (n.ringing > 0 && Math.abs(n.feet - o.feet) < 6) { const d = Math.abs(n.x - o.x); if (d < 14 * T && d < bestD) { best = { x: n.x }; bestD = d - 1000; } }
    }
    for (const dc of L.decoys || []) {
      if (dc.busted > 0 || Math.abs(dc.feet - o.feet) >= 6) continue;
      const d = Math.abs(dc.x - o.x);
      if (d < 10 * T && d < bestD) { best = { x: dc.x, decoy: dc }; bestD = d; }
    }
    return best;
  }

  function showToast(text) { L.toast = { text, t: 2.4 }; }
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 120;
      L.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.6 + Math.random() * 0.4, color });
    }
  }

  function update(dt) {
    L.time += dt;
    if (L.flash > 0) L.flash -= dt;
    if (L.shake > 0) L.shake -= dt;
    if (L.toast && (L.toast.t -= dt) <= 0) L.toast = null;
    for (const pt of L.particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 300 * dt; pt.life -= dt; }
    L.particles = L.particles.filter((pt) => pt.life > 0);

    if (mode !== 'play') { updateObjects(dt); return; }
    if (Input.hit('restart')) { startLevel(L.index); return; }
    if (Input.hit('pause')) { pause(); return; }
    // glitch blocks the player is already standing in stay open until they step out
    L.inside = new Set();
    { const p = L.player;
      for (let ty = Math.floor(p.y / T); ty <= Math.floor((p.y + p.h - 0.01) / T); ty++)
        for (let tx = Math.floor(p.x / T); tx <= Math.floor((p.x + p.w - 0.01) / T); tx++) {
          const g = L.grid[ty] && L.grid[ty][tx];
          if ((g === 3 || g === 4) && playerInCell(tx, ty)) L.inside.add(ty * COLS + tx);
        } }
    if (Input.hit('decoy')) placeDecoy();
    if (Input.hit('noise')) noiseKey();
    updateGadgets(dt);

    updatePlayer(dt);
    updateObjects(dt);
    updatePanels(dt);
    updateLoot();
    if (mode === 'play') updateSecurity(dt);
  }

  // ───────────────────────── 9. HUD ─────────────────────────
  // The 3D scene is drawn by render3d.js (window.NightShiftRender). If WebGL is missing, a message shows instead.
  const R = window.NightShiftRender;
  let render3dOK = false;
  try { R.init($('view')); render3dOK = true; } catch (e) { console.error(e); $('no-webgl').hidden = false; }

  const toScreen = (px, py) => (render3dOK ? R.project(px, py) : { x: px, y: py });

  function label(text, x, y, color, bg) {
    ctx.font = `600 11px ${FONT_MONO}`;
    const tw = ctx.measureText(text).width + 14;
    const px = clamp(x, tw / 2 + 4, W - tw / 2 - 4);
    ctx.fillStyle = bg || 'rgba(8,8,14,0.85)'; ctx.fillRect(px - tw / 2, y - 9, tw, 18);
    ctx.fillStyle = color || '#e9e4f5'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, px, y);
  }

  function drawHUD() {
    ctx.fillStyle = 'rgba(6,6,12,0.82)'; ctx.fillRect(0, 0, W, 26);
    ctx.textBaseline = 'middle';
    ctx.font = `600 12px ${FONT_MONO}`; ctx.textAlign = 'left'; ctx.fillStyle = '#9c96b3';
    ctx.fillText(`${pad2(L.index + 1)}`, 12, 13);
    ctx.font = `16px ${FONT_DISPLAY}`; ctx.fillStyle = '#f0ead8';
    ctx.fillText(L.def.name.toUpperCase(), 36, 14);

    // heat / detection meter
    const bx = W / 2 - 110, bw = 220;
    ctx.font = `600 10px ${FONT_MONO}`; ctx.fillStyle = '#9c96b3'; ctx.textAlign = 'right';
    ctx.fillText('HEAT', bx - 8, 13);
    ctx.fillStyle = '#1b1a26'; ctx.fillRect(bx, 8, bw, 10);
    if (L.heatMode) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(bx + bw * 0.33, 6, 1, 14); ctx.fillRect(bx + bw * 0.66, 6, 1, 14); }
    ctx.fillStyle = L.heat >= 66 ? '#ff4d43' : L.heat >= 33 ? '#ffae3d' : '#f2d46d';
    ctx.fillRect(bx, 8, (bw * L.heat) / 100, 10);
    const tier = L.seenNow ? 'SPOTTED' : L.heat >= 66 ? 'LOCKDOWN' : L.heat >= 33 ? 'ALERT' : 'QUIET';
    ctx.textAlign = 'left'; ctx.fillStyle = L.seenNow ? '#ff6b61' : '#9c96b3';
    ctx.fillText(tier, bx + bw + 8, 13);

    // loot counters + time (paintings ▣, valuables ●, gem ◆)
    const count = (k) => { const a = L.loot.filter((i) => i.kind === k); return [a.filter((i) => i.got).length, a.length]; };
    ctx.textAlign = 'right'; ctx.font = `600 12px ${FONT_MONO}`;
    let rx = W - 12;
    ctx.fillStyle = '#cfc9dc'; ctx.fillText(fmtTime(L.time), rx, 13); rx -= 62;
    const [g1, g2] = count('gem');
    if (g2) { ctx.fillStyle = g1 ? '#8fe9ff' : '#4f6f7a'; ctx.fillText('◆', rx, 13); rx -= 26; }
    const [v1, v2] = count('val');
    if (v2) { ctx.fillStyle = '#ffe3a0'; ctx.fillText(`● ${v1}/${v2}`, rx, 13); rx -= 56; }
    const [a1, a2] = count('art');
    ctx.fillStyle = '#f2c46d'; ctx.fillText(`▣ ${a1}/${a2}`, rx, 13);

    // haul so far and decoys, in a chip under the level name
    const haul = L.loot.filter((i) => i.got).reduce((n, i) => n + i.value, 0);
    const armed = L.noises.some((n) => !n.ringing);
    const chip = `HAUL ${fmtMoney(haul)}   DECOYS ${save.decoys} [Q]   ${armed ? 'NOISEMAKER ARMED · F TO SET OFF' : `NOISE ${save.noise} [F]`}`;
    ctx.font = `600 10px ${FONT_MONO}`; ctx.textAlign = 'left';
    const cw = ctx.measureText(chip).width + 16;
    ctx.fillStyle = 'rgba(6,6,12,0.7)'; ctx.fillRect(8, 30, cw, 18);
    ctx.fillStyle = '#cfc9dc'; ctx.fillText(chip, 16, 39.5);

    ctx.fillStyle = 'rgba(6,6,12,0.7)'; ctx.fillRect(0, H - 24, W, 24);
    ctx.font = `500 13px ${FONT_UI}`; ctx.fillStyle = '#b9b3cc'; ctx.textAlign = 'center';
    ctx.fillText(L.def.hint || '', W / 2, H - 12);
    ctx.font = `600 10px ${FONT_MONO}`; ctx.textAlign = 'right'; ctx.fillStyle = '#5d5874';
    ctx.fillText(VERSION, W - 10, H - 12);

    // markers above guards that can see you, panel progress, prompts
    for (const o of L.objects) {
      if ((o.kind === 'guard' || o.kind === 'drone') && o.seeing) {
        const s = toScreen(o.x, o.kind === 'guard' ? o.feet - P_HS - 14 : o.y - 22);
        ctx.fillStyle = '#ff4d43'; ctx.font = `20px ${FONT_DISPLAY}`; ctx.textAlign = 'center'; ctx.fillText('!', s.x, s.y);
      }
      if (o.kind === 'panel' && o.progress > 0) {
        const s = toScreen(o.x + T / 2, o.y - 14);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(s.x, s.y, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#7cf2c4'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(s.x, s.y, 10, -Math.PI / 2, -Math.PI / 2 + o.progress * Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }
      if ((o.kind === 'camera' || o.kind === 'sentry') && o.off > 0) {
        const s = toScreen(o.x, o.y + 20);
        label(`LOOP ${Math.ceil(o.off)}`, s.x, s.y, '#7cf2c4');
      }
    }
    const p = L.player;
    if (L.prompt && mode === 'play') { const s = toScreen(p.x + p.w / 2, p.y - 16); label(L.prompt, s.x, s.y); }
    else if (p.hidden && mode === 'play') { const s = toScreen(p.x + p.w / 2, p.y - 14); label('HIDDEN', s.x, s.y, '#b9a8ff', 'rgba(20,14,40,0.8)'); }
    if (L.toast) {
      ctx.globalAlpha = Math.min(1, L.toast.t * 2);
      ctx.font = `600 13px ${FONT_UI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(L.toast.text).width + 24;
      ctx.fillStyle = 'rgba(8,8,14,0.9)'; ctx.fillRect(W / 2 - tw / 2, 36, tw, 24);
      ctx.fillStyle = '#f2c46d'; ctx.fillRect(W / 2 - tw / 2, 36, 3, 24);
      ctx.fillStyle = '#f0ead8'; ctx.fillText(L.toast.text, W / 2, 48.5);
      ctx.globalAlpha = 1;
    }
  }

  function render(dt) {
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!L) return;
    if (render3dOK) R.frame(L, { mode, clock, dt, getCones, castRay });
    if (L.flash > 0 || mode === 'caught') {
      ctx.fillStyle = `rgba(255,40,40,${mode === 'caught' ? 0.18 : L.flash * 0.5})`; ctx.fillRect(0, 0, W, H);
    }
    if (mode !== 'title' && mode !== 'select' && mode !== 'shop') drawHUD();
  }

  // ───────────────────────── 10. Menus and main loop ─────────────────────────
  const screens = ['title', 'select', 'pause', 'caught', 'won', 'shop'];
  function show(name) { screens.forEach((s) => { $(`screen-${s}`).hidden = s !== name; }); }

  function startLevel(i) {
    loadLevel(i);
    mode = 'play';
    show(null);
    canvas.focus();
  }

  function pause() { if (mode !== 'play') return; mode = 'paused'; show('pause'); }
  function resume() { mode = 'play'; show(null); }

  const CAUSES = {
    camera: 'A camera caught you on tape.',
    sentry: 'A sentry locked on to you.',
    guard: 'A guard spotted you.',
    grab: 'You walked straight into a guard.',
    drone: 'A drone picked you up.',
    laser: 'You tripped a laser.',
  };

  function caught() {
    mode = 'caught'; L.shake = 0.35;
    $('caught-reason').textContent = CAUSES[L.cause] || 'The alarm went off.';
    setTimeout(() => { if (mode === 'caught') show('caught'); }, 650);
  }

  function win() {
    mode = 'won';
    const vals = L.loot.filter((i) => i.kind === 'val');
    const allVals = vals.every((i) => i.got);
    const gems = L.loot.filter((i) => i.kind === 'gem');
    const gotGem = gems.length > 0 && gems.every((i) => i.got);
    const stars = [true, !L.everSeen, allVals];
    const count = stars.filter(Boolean).length;
    const prev = save.best[L.index];
    save.best[L.index] = {
      stars: Math.max(count, prev?.stars || 0),
      gem: gotGem || !!prev?.gem,
      time: prev?.time ? Math.min(prev.time, L.time) : L.time,
    };
    save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, L.index + 2));
    // fence the haul: each item pays out the first time you escape with it
    const fresh = L.loot.filter((i) => i.got && !save.taken.includes(i.id));
    const earned = fresh.reduce((n, i) => n + i.value, 0);
    fresh.forEach((i) => save.taken.push(i.id));
    save.bank += earned;
    persist();
    $('won-title').textContent = !L.everSeen ? 'Clean getaway' : count >= 2 ? 'Got away' : 'Made it out';
    const labels = ['Escaped', 'Never spotted', allVals ? 'Took every valuable' : `Valuables ${vals.filter((v) => v.got).length} of ${vals.length}`];
    $('won-stars').innerHTML = stars.map((s, k) => `<li class="${s ? 'earned' : ''}"><span class="star" aria-hidden="true">★</span>${labels[k]}</li>`).join('') +
      (gems.length ? `<li class="gem ${gotGem ? 'earned' : ''}"><span class="star" aria-hidden="true">◆</span>${gotGem ? 'Bonus gem' : 'Bonus gem missed'}</li>` : '');
    const arts = L.loot.filter((i) => i.kind === 'art' && i.got);
    $('won-haul').textContent = arts.map((a) => `“${a.title}” (${fmtMoney(a.value)})`).join(' · ');
    $('won-earned').textContent = earned ? `+${fmtMoney(earned)}` : 'nothing new';
    $('won-bank').textContent = fmtMoney(save.bank);
    $('won-time').textContent = fmtTime(L.time);
    $('won-next').hidden = L.index >= LEVELS.length - 1;
    if (L.def.final) {
      $('won-title').textContent = 'You stole the game';
      $('won-haul').textContent = 'Night Shift is yours. Thanks for playing. · GooseKnightGaming';
    }
    burst(L.player.x + 10, L.player.y, '#4be08f', 20);
    setTimeout(() => { if (mode === 'won') show('won'); }, 300);
  }

  function buildSelect() {
    const root = $('acts');
    root.innerHTML = '';
    ACTS.forEach((act, a) => {
      const sec = document.createElement('section');
      sec.className = 'act';
      sec.innerHTML = `<h3><span>Act ${a + 1}</span>${act.name}${act.preview ? '<em>preview</em>' : ''}</h3>`;
      const list = document.createElement('div');
      list.className = 'level-list';
      act.levels.forEach((i) => {
        const lv = LEVELS[i];
        if (!lv) return;
        const locked = i >= save.unlocked;
        const best = save.best[i];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'level';
        b.disabled = locked;
        b.innerHTML = `<span class="num">${pad2(i + 1)}</span><span class="name">${locked ? 'Locked' : lv.name}</span>` +
          `<span class="stars" aria-label="${best?.stars || 0} of 3 stars${best?.gem ? ', gem collected' : ''}">${[0, 1, 2].map((k) => `<i class="${best && best.stars > k ? 'on' : ''}">★</i>`).join('')}<i class="gem ${best?.gem ? 'on' : ''}">◆</i></span>`;
        b.addEventListener('click', () => startLevel(i));
        list.appendChild(b);
      });
      sec.appendChild(list);
      root.appendChild(sec);
    });
  }

  function openSelect() {
    mode = 'select';
    buildSelect();
    $('select-bank').textContent = fmtMoney(save.bank);
    show('select');
    if (!L) { loadLevel(9); }
  }

  function openTitle() {
    mode = 'title';
    loadLevel(9);
    const next = Math.min(save.unlocked, LEVELS.length) - 1;
    $('btn-play').textContent = Object.keys(save.best).length ? `Continue · ${pad2(next + 1)} ${LEVELS[next].name}` : 'Start the job';
    $('version').textContent = VERSION;
    $('title-bank').textContent = fmtMoney(save.bank);
    show('title');
  }

  // The Safehouse: spend the bank on upgrades and decoys
  let shopReturn = 'title';
  function openShop(from) {
    shopReturn = from || 'title';
    mode = 'shop';
    buildShop();
    show('shop');
  }
  function closeShop() { if (shopReturn === 'select') openSelect(); else openTitle(); }
  function buildShop() {
    $('shop-bank').textContent = fmtMoney(save.bank);
    const root = $('shop-items');
    root.innerHTML = '';
    const card = (title, desc, status, pips, price, can, onBuy, label) => {
      const el = document.createElement('article');
      el.className = 'shop-item';
      el.innerHTML = `<header><h3>${title}</h3><span class="pips">${pips}</span></header><p>${desc}</p><p class="status">${status}</p>`;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = can ? 'primary' : '';
      b.disabled = !can && price !== null;
      b.textContent = label || (price === null ? 'Owned' : `Buy · ${fmtMoney(price)}`);
      if (price === null) b.disabled = true;
      b.addEventListener('click', () => { onBuy(); persist(); buildShop(); });
      el.appendChild(b);
      root.appendChild(el);
    };
    UPGRADES.forEach((u) => {
      const t = tier(u.id), max = u.prices.length;
      const price = t < max ? u.prices[t] : null;
      const pips = u.prices.map((_, k) => `<i class="${k < t ? 'on' : ''}"></i>`).join('');
      const status = t ? `Now: ${u.tiers[t - 1]}` : (t < max ? `Next: ${u.tiers[t]}` : '');
      const nextLine = t && t < max ? ` · Next: ${u.tiers[t]}` : '';
      card(u.name, u.desc, status + nextLine, pips, price, price !== null && save.bank >= price, () => {
        if (price === null || save.bank < price) return;
        save.bank -= price; save.upgrades[u.id] = t + 1;
      });
    });
    const full = save.decoys >= DECOY_MAX;
    card('Decoy', 'A stand-in dressed exactly like you. Press Q to set it up where you stand. Guards on that floor walk over to check it, then knock it over.',
      `Carrying ${save.decoys} of ${DECOY_MAX}`, '', full ? null : DECOY_PRICE, !full && save.bank >= DECOY_PRICE, () => {
        if (full || save.bank < DECOY_PRICE) return;
        save.bank -= DECOY_PRICE; save.decoys++;
      }, full ? 'Pockets full' : null);
    const nfull = save.noise >= NOISE_MAX;
    card('Noisemaker', 'Press F to drop it, get clear, then press F again to set it off. Guards on that floor go to investigate for six seconds.',
      `Carrying ${save.noise} of ${NOISE_MAX}`, '', nfull ? null : NOISE_PRICE, !nfull && save.bank >= NOISE_PRICE, () => {
        if (nfull || save.bank < NOISE_PRICE) return;
        save.bank -= NOISE_PRICE; save.noise++;
      }, nfull ? 'Pockets full' : null);
  }

  function onMenuKey(e) {
    if (mode === 'shop' && e.code === 'Escape') { closeShop(); return; }
    if (mode === 'title' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); $('btn-play').click(); }
    else if (mode === 'select' && e.code === 'Escape') openTitle();
    else if (mode === 'paused') {
      if (e.code === 'Escape' || e.code === 'KeyP') { if (!e.repeat) resumeSoon(); }
      else if (e.code === 'KeyR') startLevel(L.index);
    } else if (mode === 'caught' && (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); startLevel(L.index); }
    else if (mode === 'won' && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      if (L.index < LEVELS.length - 1) startLevel(L.index + 1); else openSelect();
    } else if (mode === 'won' && e.code === 'KeyR') startLevel(L.index);
  }
  // Wait one frame so the same Escape press doesn't immediately pause again
  function resumeSoon() { requestAnimationFrame(() => { Input.endStep(); resume(); }); }

  $('btn-play').addEventListener('click', () => startLevel(Math.min(save.unlocked, LEVELS.length) - 1));
  $('btn-levels').addEventListener('click', openSelect);
  $('btn-select-back').addEventListener('click', openTitle);
  $('btn-resume').addEventListener('click', resume);
  $('btn-restart').addEventListener('click', () => startLevel(L.index));
  $('btn-pause-levels').addEventListener('click', openSelect);
  $('btn-retry').addEventListener('click', () => startLevel(L.index));
  $('btn-caught-levels').addEventListener('click', openSelect);
  $('won-next').addEventListener('click', () => startLevel(L.index + 1));
  $('btn-won-retry').addEventListener('click', () => startLevel(L.index));
  $('btn-won-levels').addEventListener('click', openSelect);
  $('btn-shop').addEventListener('click', () => openShop('title'));
  $('btn-select-shop').addEventListener('click', () => openShop('select'));
  $('btn-shop-back').addEventListener('click', closeShop);
  $('btn-won-shop').addEventListener('click', () => openShop('select'));

  const STEP = 1 / 120;
  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now; clock += dt;
    if (L && mode !== 'paused') {
      acc += dt;
      while (acc >= STEP) { update(STEP); Input.endStep(); acc -= STEP; }
    } else {
      acc = 0;
      Input.endStep();
    }
    render(dt);
    requestAnimationFrame(frame);
  }

  // Exposed for testing in the browser console: NightShift.load(5) etc.
  window.NightShift = {
    load: (i) => startLevel(i),
    get state() { return { mode, level: L && L.index, heat: L && L.heat, player: L && { ...L.player } }; },
    _level: () => L,
    _debug: { castRay, coneSees, getCones, inShadow, updateObjects, alertLevel, step: (dt) => { update(dt); Input.endStep(); }, input: Input },
    version: VERSION,
  };

  openTitle();
  requestAnimationFrame(frame);
})();
