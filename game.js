/*
  NIGHT SHIFT — game engine
  A small 2D stealth platformer. Plain JavaScript + one <canvas>, no libraries.

  Sections:
    1. Constants and setup
    2. Input (all keys go through one controls layer)
    3. Save data
    4. Level loading
    5. Tiles, collision and line of sight
    6. Player movement
    7. Security: cameras, sentries, guards, drones, lasers, panels
    8. Heat, loot, exit
    9. Drawing
   10. Menus and the main loop
*/
(() => {
  'use strict';

  // ───────────────────────── 1. Constants and setup ─────────────────────────
  const T = 32, COLS = 30, ROWS = 17;
  const W = COLS * T, H = ROWS * T;
  const LEVELS = window.NIGHT_SHIFT_LEVELS || [];
  const ACTS = window.NIGHT_SHIFT_ACTS || [];

  const P_W = 20, P_HS = 54, P_HD = 28;          // player width, standing height, ducking height
  const WALK = 175, DUCK_WALK = 100, CLIMB = 135;  // pixels per second
  const GRAV = 1900, JUMP_V = 610, MAX_FALL = 950;
  const HACK_TIME = 1.2;

  // How fast each kind of security fills the heat bar (per second while it sees you)
  const RATES = { camera: 45, guard: 70, drone: 55, sentry: 140 };
  const INSTANT_MULT = 6;   // before heat is introduced, detection is near-instant

  const FONT_DISPLAY = '"Saira Stencil One", Impact, "Arial Narrow", sans-serif';
  const FONT_MONO = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
  const FONT_UI = '"Barlow Semi Condensed", "Arial Narrow", Arial, sans-serif';

  const ACT_STYLE = [
    { wall: '#2a2134', stripe: '#2f2639', trim: '#8a6f4a', mass: '#100d16', edge: '#4a3b55' }, // gallery: plum
    { wall: '#1e2a27', stripe: '#22302c', trim: '#6f7f63', mass: '#0b1110', edge: '#3a4b45' }, // museum: green slate
    { wall: '#1c2333', stripe: '#212939', trim: '#5f7290', mass: '#0b0e16', edge: '#36425a' }, // bank: steel
    { wall: '#16242a', stripe: '#1a2a31', trim: '#4f8a8c', mass: '#081114', edge: '#2d4a52' }, // tower: teal glass
  ];

  const PAINTINGS = [
    ['Harbour at Dusk', '£1.2m'], ['Woman with a Lantern', '£3.4m'], ['Study in Blue', '£860k'],
    ['The Coal Barge', '£2.1m'], ['Still Life with Pears', '£640k'], ['Mersey Fog', '£1.7m'],
    ['Portrait of a Clerk', '£920k'], ['The Last Tram', '£2.8m'], ['Orchard in Rain', '£1.1m'],
    ['Saint in Red', '£4.0m'], ['Two Swimmers', '£1.5m'], ['The Night Ferry', '£2.3m'],
  ];
  const PAINT_HUES = [18, 205, 42, 160, 330, 260, 95, 10, 190, 280];

  const canvas = document.getElementById('game');
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
  let save = { unlocked: 1, best: {} };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === 'object') save = { unlocked: s.unlocked || 1, best: s.best || {} };
  } catch (e) { /* storage unavailable: progress lasts for this visit only */ }
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
        grid[y].push(ch === '#' ? 1 : ch === 'H' ? 2 : 0);
        if (ch === 'P') start = { x, y };
        if (ch === 'E') exit = { x, y };
        if (ch === '$') {
          const p = PAINTINGS[(index * 3 + artCount) % PAINTINGS.length];
          loot.push({ kind: 'art', x, y, got: false, title: p[0], value: p[1], hue: PAINT_HUES[(index + artCount * 3) % PAINT_HUES.length] });
          artCount++;
        }
        if (ch === '*') loot.push({ kind: 'gem', x, y, got: false });
      }
    }
    L = {
      index, def, grid, loot, exit,
      act: def.act || 0,
      heatMode: !!def.heat,
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
    L.bg = buildBackground();
    L.fg = buildForeground();
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
  function tileAt(tx, ty) { return tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS ? 1 : L.grid[ty][tx]; }
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
      if (Input.hit('jumpOnly')) { p.climbing = false; p.vy = -JUMP_V * 0.8; p.vx = (right - left) * WALK; }
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

    p.vy = Math.min(p.vy + GRAV * dt, MAX_FALL);
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
        if (o.wait > 0) {
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
        const face = o.wait > 0 ? o.dir : o.dir;
        cones.push({
          src: o, kind: 'guard', ox: o.x + face * 6, oy: o.feet - 46,
          angle: face > 0 ? rad(10) : Math.PI - rad(10), fov: rad(52), range: (7 + alert * 1.5) * T,
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
      L.heat += rate * (L.heatMode ? 1 : INSTANT_MULT) * dt;
      L.everSeen = true; L.unseen = 0; L.cause = cause;
    } else {
      L.unseen += dt;
      const delay = L.heatMode ? 1.5 : 0.15, decay = L.heatMode ? 7 : 160;
      if (L.unseen > delay) L.heat -= decay * dt;
    }

    // Lasers
    if (L.laserCooldown > 0) L.laserCooldown -= dt;
    for (const o of L.objects) {
      if (o.kind === 'laser' && o.live && L.laserCooldown <= 0 && segHitsRect(o.x1, o.y1, o.x2, o.y2, p)) {
        L.everSeen = true; L.cause = 'laser'; L.flash = 0.35;
        if (!L.heatMode) { L.heat = 100; break; }
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
        o.progress += dt / HACK_TIME;
        L.prompt = 'Hacking…';
        if (o.progress >= 1) {
          o.progress = 0; o.used = true;
          for (const t of L.objects) {
            if (!o.targets.includes(t.id)) continue;
            if (t.kind === 'laser') t.disabled = true;
            if (t.kind === 'camera' || t.kind === 'sentry') t.off = o.duration;
          }
          o.cooldown = permanent ? 0 : o.duration + 2;
          showToast(permanent ? 'Lasers offline' : `Camera looped for ${o.duration} seconds`);
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
          showToast(`Lifted “${it.title}” (${it.value})`);
          burst(it.x * T + T / 2, it.y * T + T / 2, '#f2c46d', 18);
        } else {
          showToast('Bonus gem');
          burst(it.x * T + T / 2, it.y * T + T / 2, '#8fe9ff', 14);
        }
      }
    }
    const door = { x: L.exit.x * T + 6, y: (L.exit.y - 1) * T + 4, w: T - 12, h: 2 * T - 4 };
    if (overlap(p, door)) {
      const left = L.loot.filter((i) => i.kind === 'art' && !i.got).length;
      if (left === 0) win();
      else L.prompt = left === 1 ? 'Locked · take the painting first' : `Locked · ${left} paintings still on the walls`;
    }
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

    updatePlayer(dt);
    updateObjects(dt);
    updatePanels(dt);
    updateLoot();
    if (mode === 'play') updateSecurity(dt);
  }

  // ───────────────────────── 9. Drawing ─────────────────────────
  function makeLayer() {
    const c = document.createElement('canvas');
    c.width = W * RES; c.height = H * RES;
    const g = c.getContext('2d');
    g.scale(RES, RES);
    return [c, g];
  }

  function buildBackground() {
    const [c, g] = makeLayer();
    const st = ACT_STYLE[L.act] || ACT_STYLE[0];
    g.fillStyle = st.wall; g.fillRect(0, 0, W, H);
    // wallpaper stripes
    g.fillStyle = st.stripe;
    for (let x = 0; x < W; x += 24) g.fillRect(x, 0, 10, H);
    // dado rail one tile above every floor, skirting board along every floor
    for (let y = 1; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (solid(x, y) && !solid(x, y - 1)) {
        g.fillStyle = st.trim; g.globalAlpha = 0.35; g.fillRect(x * T, y * T - 34, T, 2);
        g.globalAlpha = 0.6; g.fillRect(x * T, y * T - 6, T, 6);
        g.globalAlpha = 1;
      }
    }
    // soft ceiling lights
    for (let y = 1; y < ROWS; y++) for (let x = 2; x < COLS - 2; x += 6) {
      if (solid(x, y - 1) && !solid(x, y)) {
        const gr = g.createRadialGradient(x * T + 16, y * T, 2, x * T + 16, y * T, 90);
        gr.addColorStop(0, 'rgba(255,230,190,0.10)'); gr.addColorStop(1, 'rgba(255,230,190,0)');
        g.fillStyle = gr; g.fillRect(x * T - 80, y * T, 192, 100);
      }
    }
    return c;
  }

  function buildForeground() {
    const [c, g] = makeLayer();
    const st = ACT_STYLE[L.act] || ACT_STYLE[0];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!solid(x, y)) continue;
      g.fillStyle = st.mass; g.fillRect(x * T, y * T, T, T);
      // concrete hatching
      g.strokeStyle = st.edge; g.globalAlpha = 0.18; g.lineWidth = 1;
      g.beginPath();
      for (let k = -T; k < T; k += 8) { g.moveTo(x * T + k, y * T + T); g.lineTo(x * T + k + T, y * T); }
      g.save(); g.beginPath(); g.rect(x * T, y * T, T, T); g.clip();
      g.beginPath();
      for (let k = -T; k < T; k += 8) { g.moveTo(x * T + k, y * T + T); g.lineTo(x * T + k + T, y * T); }
      g.stroke(); g.restore();
      g.globalAlpha = 1;
      // exposed edges
      g.fillStyle = st.edge;
      if (!solid(x, y - 1) && y > 0) { g.fillRect(x * T, y * T, T, 4); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x * T, y * T, T, 1); g.fillStyle = st.edge; }
      if (!solid(x, y + 1) && y < ROWS - 1) g.fillRect(x * T, y * T + T - 2, T, 2);
      if (!solid(x - 1, y) && x > 0) g.fillRect(x * T, y * T, 2, T);
      if (!solid(x + 1, y) && x < COLS - 1) g.fillRect(x * T + T - 2, y * T, 2, T);
    }
    // ladders
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!ladder(x, y)) continue;
      g.fillStyle = '#7d8197';
      g.fillRect(x * T + 6, y * T, 3, T); g.fillRect(x * T + T - 9, y * T, 3, T);
      g.fillStyle = '#9ea2b6';
      for (let k = 4; k < T; k += 9) g.fillRect(x * T + 6, y * T + k, T - 12, 3);
    }
    return c;
  }

  function drawCones() {
    for (const c of getCones()) {
      const seeing = c.src.seeing;
      const sentry = c.kind === 'sentry';
      const steps = 40;
      ctx.beginPath();
      ctx.moveTo(c.ox, c.oy);
      for (let i = 0; i <= steps; i++) {
        const a = c.angle - c.fov / 2 + (c.fov * i) / steps;
        const d = castRay(c.ox, c.oy, a, c.range);
        ctx.lineTo(c.ox + Math.cos(a) * d, c.oy + Math.sin(a) * d);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(c.ox, c.oy, 4, c.ox, c.oy, c.range);
      const col = seeing ? '255,72,64' : sentry ? '255,110,90' : '255,226,150';
      g.addColorStop(0, `rgba(${col},${seeing ? 0.42 : 0.26})`);
      g.addColorStop(1, `rgba(${col},${seeing ? 0.14 : 0.04})`);
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  function drawShadows() {
    for (const s of L.shadows) {
      ctx.fillStyle = 'rgba(3,3,9,0.78)';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      // faint curtain folds so dark areas read as places, not holes
      ctx.strokeStyle = 'rgba(120,110,160,0.10)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = s.x + 5; x < s.x + s.w; x += 7) { ctx.moveTo(x, s.y + 2); ctx.lineTo(x, s.y + s.h - 2); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(150,140,200,0.22)';
      ctx.setLineDash([3, 4]);
      ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
      ctx.setLineDash([]);
    }
  }

  function drawDoor() {
    const x = L.exit.x * T, y = (L.exit.y - 1) * T;
    const open = L.loot.every((i) => i.kind !== 'art' || i.got);
    ctx.fillStyle = '#3c3a4a'; ctx.fillRect(x + 2, y + 2, T - 4, 2 * T - 2);
    ctx.fillStyle = open ? '#1d3b2f' : '#231c22'; ctx.fillRect(x + 6, y + 8, T - 12, 2 * T - 8);
    ctx.fillStyle = '#c9c3b5'; ctx.fillRect(x + T - 12, y + 34, 3, 6);
    // EXIT sign
    ctx.fillStyle = open ? '#4be08f' : '#e25050';
    ctx.globalAlpha = 0.85 + 0.15 * Math.sin(clock * 4);
    ctx.fillRect(x + 4, y - 8, T - 8, 8);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#071008'; ctx.font = `bold 7px ${FONT_MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', x + T / 2, y - 3.5);
  }

  function drawLoot() {
    for (const it of L.loot) {
      if (it.got) continue;
      const x = it.x * T, y = it.y * T;
      if (it.kind === 'art') {
        ctx.fillStyle = '#b8903f'; ctx.fillRect(x + 3, y + 4, 26, 22);
        ctx.fillStyle = '#e7c76f'; ctx.fillRect(x + 4, y + 5, 24, 1);
        const g = ctx.createLinearGradient(0, y + 7, 0, y + 23);
        g.addColorStop(0, `hsl(${it.hue},45%,62%)`); g.addColorStop(1, `hsl(${(it.hue + 40) % 360},40%,32%)`);
        ctx.fillStyle = g; ctx.fillRect(x + 6, y + 7, 20, 16);
        ctx.fillStyle = `hsl(${(it.hue + 180) % 360},35%,25%)`;
        ctx.beginPath(); ctx.moveTo(x + 6, y + 23); ctx.lineTo(x + 13, y + 15); ctx.lineTo(x + 18, y + 19); ctx.lineTo(x + 26, y + 13); ctx.lineTo(x + 26, y + 23); ctx.fill();
        ctx.strokeStyle = 'rgba(242,196,109,0.5)'; ctx.globalAlpha = 0.4 + 0.3 * Math.sin(clock * 3 + it.x);
        ctx.strokeRect(x + 1.5, y + 2.5, 29, 25); ctx.globalAlpha = 1;
      } else {
        const bob = Math.sin(clock * 3 + it.x) * 2;
        const cx = x + T / 2, cy = y + T / 2 + bob;
        ctx.fillStyle = '#8fe9ff';
        ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx + 7, cy - 1); ctx.lineTo(cx, cy + 8); ctx.lineTo(cx - 7, cy - 1); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e6fbff';
        ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx + 3, cy - 1); ctx.lineTo(cx, cy + 1); ctx.lineTo(cx - 3, cy - 1); ctx.closePath(); ctx.fill();
      }
    }
  }

  function drawLaser(o) {
    // emitters
    ctx.fillStyle = '#545867';
    const horiz = Math.abs(o.y2 - o.y1) < Math.abs(o.x2 - o.x1);
    for (const [ex, ey] of [[o.x1, o.y1], [o.x2, o.y2]]) {
      if (horiz) ctx.fillRect(ex - 3, ey - 6, 6, 12); else ctx.fillRect(ex - 6, ey - 3, 12, 6);
    }
    if (o.live) {
      const pulse = 0.75 + 0.25 * Math.sin(clock * 30 + o.x1);
      ctx.strokeStyle = `rgba(255,60,60,${0.25 * pulse})`; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
      ctx.strokeStyle = '#ff5a52'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
      ctx.strokeStyle = '#ffd4cf'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
    } else {
      let warn = false;
      if (!o.disabled && o.on) { const ph = (L.time + o.offset) % (o.on + o.off); warn = ph > o.on + o.off - 0.35; }
      ctx.strokeStyle = o.disabled ? 'rgba(124,242,196,0.18)' : warn ? 'rgba(255,90,82,0.6)' : 'rgba(255,90,82,0.14)';
      ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.lineWidth = 1;
  }

  function drawPanel(o) {
    const x = o.x + 7, y = o.y + 5;
    ctx.fillStyle = '#2b3040'; ctx.fillRect(x, y, 18, 22);
    ctx.fillStyle = o.used ? '#2bbf88' : o.cooldown > 0 ? '#c9a13a' : '#3f86ff';
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(clock * 5);
    ctx.fillRect(x + 3, y + 3, 12, 8); ctx.globalAlpha = 1;
    ctx.fillStyle = '#596079';
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) ctx.fillRect(x + 3 + i * 4, y + 14 + j * 4, 3, 3);
    if (o.progress > 0) {
      ctx.strokeStyle = '#7cf2c4'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(o.x + T / 2, o.y - 12, 9, -Math.PI / 2, -Math.PI / 2 + o.progress * Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  function drawCamera(o) {
    const sentry = o.kind === 'sentry';
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.fillStyle = '#3a3e4e'; ctx.fillRect(-2, -6, 4, 6);
    ctx.rotate(o.angle);
    ctx.fillStyle = o.off > 0 ? '#555a66' : sentry ? '#6b2a2a' : '#c7c9d3';
    ctx.fillRect(-6, -5, 16, 10);
    ctx.fillStyle = '#20232c'; ctx.fillRect(9, -3, 4, 6);
    ctx.restore();
    const blink = Math.sin(clock * 6 + o.x) > 0;
    ctx.fillStyle = o.off > 0 ? '#7cf2c4' : o.seeing ? '#ff3b3b' : blink ? '#ff6b6b' : '#5a2020';
    ctx.beginPath(); ctx.arc(o.x, o.y - 1, 1.6, 0, Math.PI * 2); ctx.fill();
    if (o.off > 0) {
      ctx.fillStyle = '#7cf2c4'; ctx.font = `600 9px ${FONT_MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`LOOP ${Math.ceil(o.off)}`, o.x, o.y + 10);
    }
  }

  function drawDrone(o) {
    ctx.save(); ctx.translate(o.x, o.y);
    ctx.strokeStyle = '#9aa3b5'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-14, -4); ctx.lineTo(14, -4); ctx.stroke();
    for (const s of [-14, 14]) {
      const w = 7 * Math.abs(Math.cos(o.spin + s));
      ctx.beginPath(); ctx.moveTo(s - w, -7); ctx.lineTo(s + w, -7); ctx.stroke();
    }
    ctx.fillStyle = '#2e3445'; ctx.beginPath(); ctx.ellipse(0, 0, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = o.seeing ? '#ff3b3b' : '#ffd479'; ctx.beginPath(); ctx.arc(0, 5, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); ctx.lineWidth = 1;
  }

  // A simple figure: used for the thief and the guards.
  function drawFigure(x, feet, h, facing, step, look) {
    const ducking = h < P_HS - 4;
    const legH = ducking ? 6 : 16;
    const swing = Math.sin(step * 2) * (ducking ? 2 : 4);
    ctx.fillStyle = look.legs;
    ctx.fillRect(x - 6 + swing * 0.5, feet - legH, 5, legH);
    ctx.fillRect(x + 1 - swing * 0.5, feet - legH, 5, legH);
    const bodyTop = feet - h + 14;
    ctx.fillStyle = look.body;
    roundRect(x - 8, bodyTop, 16, h - 14 - legH + 3, 4); ctx.fill();
    if (look.stripes) {
      ctx.fillStyle = look.stripes;
      for (let y = bodyTop + 4; y < feet - legH - 2; y += 6) ctx.fillRect(x - 8, y, 16, 2);
    }
    if (look.badge) { ctx.fillStyle = look.badge; ctx.fillRect(x + facing * 3 - 1.5, bodyTop + 4, 3, 3); }
    // head
    const hy = feet - h + 7;
    ctx.fillStyle = look.skin; ctx.beginPath(); ctx.arc(x + facing * 1, hy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = look.hat; ctx.beginPath(); ctx.arc(x + facing * 1, hy - 1, 7.2, Math.PI, 0); ctx.fill();
    if (look.brim) ctx.fillRect(x + facing * 1 - 2 + facing * 4, hy - 2, 7, 2);
    if (look.mask) { ctx.fillStyle = look.mask; ctx.fillRect(x + facing * 1 - 6, hy - 1, 12, 3); ctx.fillStyle = '#f4efe2'; ctx.fillRect(x + facing * 4, hy - 0.5, 2, 2); }
    else { ctx.fillStyle = '#1a1a22'; ctx.fillRect(x + facing * 4, hy, 2, 2); }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  const THIEF = { legs: '#16161f', body: '#1f1f2a', stripes: '#3a3a4c', skin: '#d9b48f', hat: '#14141c', mask: '#0b0b10' };
  const GUARD = { legs: '#1f2747', body: '#34437e', skin: '#c99a76', hat: '#1b2348', brim: true, badge: '#e8c35a' };

  function drawPlayer() {
    const p = L.player;
    if (mode === 'title' || mode === 'select') return;
    ctx.save();
    if (p.hidden) ctx.globalAlpha = 0.45;
    drawFigure(p.x + p.w / 2, p.y + p.h, p.h, p.facing, p.walk, THIEF);
    ctx.restore();
    if (p.hidden) {
      ctx.strokeStyle = 'rgba(160,150,230,0.7)'; ctx.setLineDash([2, 3]);
      ctx.strokeRect(p.x - 3.5, p.y - 2.5, p.w + 7, p.h + 3); ctx.setLineDash([]);
    }
  }

  function drawHUD() {
    // top bar sits over the building's roof line
    ctx.fillStyle = 'rgba(6,6,12,0.82)'; ctx.fillRect(0, 0, W, 26);
    ctx.textBaseline = 'middle';
    ctx.font = `600 12px ${FONT_MONO}`; ctx.textAlign = 'left'; ctx.fillStyle = '#9c96b3';
    ctx.fillText(`${pad2(L.index + 1)}`, 12, 13);
    ctx.font = `16px ${FONT_DISPLAY}`; ctx.fillStyle = '#f0ead8';
    ctx.fillText(L.def.name.toUpperCase(), 36, 14);

    // heat / detection meter
    const bx = W / 2 - 110, bw = 220;
    ctx.font = `600 10px ${FONT_MONO}`; ctx.fillStyle = '#9c96b3'; ctx.textAlign = 'right';
    ctx.fillText(L.heatMode ? 'HEAT' : 'SEEN', bx - 8, 13);
    ctx.fillStyle = '#1b1a26'; ctx.fillRect(bx, 8, bw, 10);
    if (L.heatMode) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(bx + bw * 0.33, 6, 1, 14); ctx.fillRect(bx + bw * 0.66, 6, 1, 14);
    }
    const hc = L.heat >= 66 ? '#ff4d43' : L.heat >= 33 ? '#ffae3d' : '#f2d46d';
    ctx.fillStyle = hc; ctx.fillRect(bx, 8, (bw * L.heat) / 100, 10);
    const tier = L.heatMode ? (L.heat >= 66 ? 'LOCKDOWN' : L.heat >= 33 ? 'ALERT' : 'QUIET') : L.seenNow ? 'SPOTTED' : 'UNSEEN';
    ctx.textAlign = 'left'; ctx.fillStyle = L.seenNow ? '#ff6b61' : '#9c96b3';
    ctx.fillText(tier, bx + bw + 8, 13);

    // loot + time
    const arts = L.loot.filter((i) => i.kind === 'art'), gems = L.loot.filter((i) => i.kind === 'gem');
    ctx.textAlign = 'right'; ctx.fillStyle = '#f2c46d'; ctx.font = `600 12px ${FONT_MONO}`;
    let rx = W - 12;
    ctx.fillStyle = '#cfc9dc'; ctx.fillText(fmtTime(L.time), rx, 13); rx -= 62;
    if (gems.length) { ctx.fillStyle = '#8fe9ff'; ctx.fillText(`◆ ${gems.filter((g) => g.got).length}/${gems.length}`, rx, 13); rx -= 56; }
    ctx.fillStyle = '#f2c46d'; ctx.fillText(`▣ ${arts.filter((a) => a.got).length}/${arts.length}`, rx, 13);

    // hint along the bottom
    ctx.fillStyle = 'rgba(6,6,12,0.7)'; ctx.fillRect(0, H - 24, W, 24);
    ctx.font = `500 13px ${FONT_UI}`; ctx.fillStyle = '#b9b3cc'; ctx.textAlign = 'center';
    ctx.fillText(L.def.hint || '', W / 2, H - 12);

    // prompts and toasts
    const p = L.player;
    if (L.prompt && mode === 'play') {
      ctx.font = `600 11px ${FONT_MONO}`;
      const tw = ctx.measureText(L.prompt).width + 14;
      const px = clamp(p.x + p.w / 2, tw / 2 + 4, W - tw / 2 - 4), py = p.y - 20;
      ctx.fillStyle = 'rgba(8,8,14,0.85)'; ctx.fillRect(px - tw / 2, py - 9, tw, 18);
      ctx.fillStyle = '#e9e4f5'; ctx.fillText(L.prompt, px, py);
    }
    if (L.toast) {
      ctx.globalAlpha = Math.min(1, L.toast.t * 2);
      ctx.font = `600 13px ${FONT_UI}`;
      const tw = ctx.measureText(L.toast.text).width + 24;
      ctx.fillStyle = 'rgba(8,8,14,0.9)'; ctx.fillRect(W / 2 - tw / 2, 36, tw, 24);
      ctx.fillStyle = '#f2c46d'; ctx.fillRect(W / 2 - tw / 2, 36, 3, 24);
      ctx.fillStyle = '#f0ead8'; ctx.fillText(L.toast.text, W / 2, 48.5);
      ctx.globalAlpha = 1;
    }
  }

  function render() {
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    if (!L) { ctx.fillStyle = '#07070c'; ctx.fillRect(0, 0, W, H); return; }
    ctx.save();
    if (L.shake > 0) ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    ctx.drawImage(L.bg, 0, 0, W, H);
    drawCones();
    drawShadows();
    ctx.drawImage(L.fg, 0, 0, W, H);
    drawDoor();
    drawLoot();
    for (const o of L.objects) if (o.kind === 'panel') drawPanel(o);
    for (const o of L.objects) if (o.kind === 'laser') drawLaser(o);
    for (const o of L.objects) if (o.kind === 'guard') {
      drawFigure(o.x, o.feet, P_HS, o.dir, o.step, GUARD);
      if (o.seeing) { ctx.fillStyle = '#ff4d43'; ctx.font = `bold 16px ${FONT_DISPLAY}`; ctx.textAlign = 'center'; ctx.fillText('!', o.x, o.feet - P_HS - 10); }
    }
    for (const o of L.objects) if (o.kind === 'camera' || o.kind === 'sentry') drawCamera(o);
    for (const o of L.objects) if (o.kind === 'drone') drawDrone(o);
    drawPlayer();
    for (const pt of L.particles) { ctx.globalAlpha = clamp(pt.life, 0, 1); ctx.fillStyle = pt.color; ctx.fillRect(pt.x - 1.5, pt.y - 1.5, 3, 3); }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (L.flash > 0 || mode === 'caught') {
      ctx.fillStyle = `rgba(255,40,40,${mode === 'caught' ? 0.22 : L.flash * 0.6})`; ctx.fillRect(0, 0, W, H);
    }
    if (mode !== 'title' && mode !== 'select') drawHUD();
    else { ctx.fillStyle = 'rgba(5,5,10,0.35)'; ctx.fillRect(0, 0, W, H); }
  }

  // ───────────────────────── 10. Menus and main loop ─────────────────────────
  const screens = ['title', 'select', 'pause', 'caught', 'won'];
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
    const allLoot = L.loot.every((i) => i.got);
    const stars = [true, !L.everSeen, allLoot];
    const count = stars.filter(Boolean).length;
    const prev = save.best[L.index];
    save.best[L.index] = {
      stars: Math.max(count, prev?.stars || 0),
      time: prev?.time ? Math.min(prev.time, L.time) : L.time,
    };
    save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, L.index + 2));
    persist();
    $('won-title').textContent = !L.everSeen ? 'Clean getaway' : count >= 2 ? 'Got away' : 'Made it out';
    const labels = ['Escaped', 'Never spotted', allLoot ? 'Took everything' : 'Left something behind'];
    $('won-stars').innerHTML = stars.map((s, k) => `<li class="${s ? 'earned' : ''}"><span class="star" aria-hidden="true">★</span>${k === 2 ? labels[2] : labels[k]}</li>`).join('');
    const arts = L.loot.filter((i) => i.kind === 'art' && i.got);
    $('won-haul').textContent = arts.map((a) => `“${a.title}” (${a.value})`).join(' · ');
    $('won-time').textContent = fmtTime(L.time);
    $('won-next').hidden = L.index >= LEVELS.length - 1;
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
          `<span class="stars" aria-label="${best?.stars || 0} of 3 stars">${[0, 1, 2].map((k) => `<i class="${best && best.stars > k ? 'on' : ''}">★</i>`).join('')}</span>`;
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
    show('select');
    if (!L) { loadLevel(4); }
  }

  function openTitle() {
    mode = 'title';
    loadLevel(4);
    const next = Math.min(save.unlocked, LEVELS.length) - 1;
    $('btn-play').textContent = Object.keys(save.best).length ? `Continue · ${pad2(next + 1)} ${LEVELS[next].name}` : 'Start the job';
    show('title');
  }

  function onMenuKey(e) {
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
    render();
    requestAnimationFrame(frame);
  }

  // Exposed for testing in the browser console: NightShift.load(5) etc.
  window.NightShift = {
    load: (i) => startLevel(i),
    get state() { return { mode, level: L && L.index, heat: L && L.heat, player: L && { ...L.player } }; },
    _level: () => L,
  };

  openTitle();
  requestAnimationFrame(frame);
})();
