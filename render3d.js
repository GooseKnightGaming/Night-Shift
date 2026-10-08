/*
  NIGHT SHIFT — 3D renderer (Three.js r128)
  The game rules stay 2D (side-on). This file turns each frame of that 2D state into a 3D scene:
  a cut-away building, articulated thief and guard models, security hardware, loot and vision cones.

  World units are tiles. x runs left→right, y runs bottom→top, z points toward the viewer.
  The back wall sits at z = -1.5 and the gameplay plane is z = 0.

  Public API (used by game.js):
    NightShiftRender.init(canvas)
    NightShiftRender.build(level, helpers)   — call when a level loads
    NightShiftRender.frame(level, ctx)       — call every frame
    NightShiftRender.project(px, py)         — game pixels → HUD pixels (960×544)
*/
window.NightShiftRender = (() => {
  'use strict';
  const T = 32, COLS = 30, ROWS = 17;
  const HUD_W = 960, HUD_H = 544;
  const DEPTH = 3, ZB = -DEPTH / 2;
  const wx = (px) => px / T;
  const wy = (py) => ROWS - py / T;

  const ACTS = [
    { wall: 0x4a3a5a, wall2: 0x544266, trim: 0xb8925a, floor: 0x6b4a33, mass: 0x1a1522, section: 0x221b2c, lamp: 0xffd4a0, sky: 0x3a3360 }, // gallery
    { wall: 0x34473f, wall2: 0x3c5249, trim: 0x9aa782, floor: 0x5a4632, mass: 0x111a17, section: 0x18231f, lamp: 0xfff0cc, sky: 0x2c4a44 }, // museum
    { wall: 0x313c55, wall2: 0x38445f, trim: 0x8aa0c0, floor: 0x4a505e, mass: 0x10141e, section: 0x181e2b, lamp: 0xe8f1ff, sky: 0x2e3b5c }, // bank
    { wall: 0x253b42, wall2: 0x2c464e, trim: 0x67b3b0, floor: 0x37454a, mass: 0x0b1618, section: 0x132327, lamp: 0xd9fff8, sky: 0x214a50 }, // tower
    { wall: 0x10141f, wall2: 0x141a28, trim: 0x39ffb0, floor: 0x1a2030, mass: 0x05070c, section: 0x0a0f18, lamp: 0x7dffd0, sky: 0x1a3a40, grid: true }, // the machine
  ];

  let renderer, scene, camera, keyLight, hemi;
  let world = null, B = null;     // B = everything built for the current level
  let fitDist = 40, aspect = HUD_W / HUD_H;
  const camTarget = new THREE.Vector3(COLS / 2, ROWS / 2, 0);
  const tmpV = new THREE.Vector3();

  // ───────────── helpers ─────────────
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({
    color, roughness: o.r ?? 0.8, metalness: o.m ?? 0, map: o.map || null,
    emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1,
    transparent: !!o.transparent, opacity: o.opacity ?? 1,
  });
  const basic = (color, o = {}) => new THREE.MeshBasicMaterial({
    color, transparent: !!o.transparent, opacity: o.opacity ?? 1, depthWrite: o.depthWrite ?? true,
    blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending, side: o.side || THREE.FrontSide, toneMapped: false,
  });
  function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    if (parent) parent.add(m);
    return m;
  }
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  let seed = 1;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  // ───────────── shared textures ─────────────
  let glowTex, stripeTex;
  function makeShared() {
    glowTex = canvasTex(64, 64, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
    stripeTex = canvasTex(64, 64, (g) => {
      g.fillStyle = '#26262f'; g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#4a4a58'; for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 7);
    }, [2, 3]);
  }

  // ───────────── init / resize / camera ─────────────
  function init(canvas) {
    if (!window.THREE) throw new Error('Three.js did not load');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050508);
    camera = new THREE.PerspectiveCamera(24, aspect, 0.5, 400);

    hemi = new THREE.HemisphereLight(0x9aa6d8, 0x1c1418, 0.55);
    scene.add(hemi);
    keyLight = new THREE.DirectionalLight(0xfff2e0, 0.55);
    keyLight.position.set(COLS / 2 - 8, ROWS + 12, 22);
    keyLight.target.position.set(COLS / 2, ROWS / 2, 0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    const sc = keyLight.shadow.camera;
    sc.left = -20; sc.right = 20; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 80;
    keyLight.shadow.bias = -0.0008;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight, keyLight.target);

    makeShared();
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      renderer.setSize(r.width, r.height, false);
      aspect = r.width / r.height;
      camera.aspect = aspect;
      const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      fitDist = Math.max(17.3 / (2 * half), 30.3 / (2 * half * aspect));
      camera.updateProjectionMatrix();
    };
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); else addEventListener('resize', resize);
  }

  function project(px, py) {
    tmpV.set(wx(px), wy(py), 0).project(camera);
    return { x: (tmpV.x + 1) / 2 * HUD_W, y: (1 - tmpV.y) / 2 * HUD_H };
  }

  // ───────────── level build ─────────────
  function disposeWorld() {
    if (!world) return;
    world.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map && m.map !== stripeTex && m.map !== glowTex) m.map.dispose(); m.dispose(); });
    });
    scene.remove(world);
    world = null;
  }

  function instanced(geo, mat, cells, place) {
    if (!cells.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, cells.length);
    const m4 = new THREE.Matrix4();
    cells.forEach((c, i) => { place(m4, c); im.setMatrixAt(i, m4); });
    im.castShadow = true; im.receiveShadow = true;
    world.add(im);
    return im;
  }

  function build(L, h) {
    disposeWorld();
    seed = 1000 + L.index * 77;
    world = new THREE.Group();
    scene.add(world);
    const st = ACTS[L.act] || ACTS[0];
    B = { L, h, st, objs: new Map(), loot: [], guards: [], cones: [], lights: [] };
    hemi.color.setHex(st.sky).lerp(new THREE.Color(0xa0a8d0), 0.5);

    buildBuilding(L, h, st);
    buildShadows(L, st);
    buildDoor(L);
    L.loot.forEach((it) => B.loot.push({ it, node: buildLoot(it, h) }));
    L.objects.forEach((o) => ensureObject(o));
    B.player = makeHuman('thief');
    world.add(B.player.root);
    buildParticles();

    // snap the camera straight to the new level
    camTarget.set(COLS / 2, ROWS / 2, 0);
  }

  function buildBuilding(L, h, st) {
    // back wall with wallpaper
    const wallTex = canvasTex(256, 256, (g, w) => {
      g.fillStyle = hex(st.wall); g.fillRect(0, 0, w, w);
      g.fillStyle = hex(st.wall2);
      for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 14, w);
      g.fillStyle = 'rgba(255,255,255,0.035)';
      for (let y = 8; y < w; y += 32) for (let x = 7; x < w; x += 32) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
      if (st.grid) { // the machine: a circuit-board grid instead of wallpaper
        g.fillStyle = hex(st.wall); g.fillRect(0, 0, w, w);
        g.strokeStyle = 'rgba(57,255,176,0.18)'; g.lineWidth = 1;
        for (let k = 0; k <= w; k += 32) { g.beginPath(); g.moveTo(k + 0.5, 0); g.lineTo(k + 0.5, w); g.moveTo(0, k + 0.5); g.lineTo(w, k + 0.5); g.stroke(); }
        g.fillStyle = 'rgba(57,255,176,0.35)';
        for (let k = 0; k < 14; k++) g.fillRect(Math.floor(rand() * 8) * 32 + 14, Math.floor(rand() * 8) * 32 + 14, 4, 4);
        g.fillStyle = 'rgba(57,255,176,0.12)'; g.font = '10px monospace';
        for (let k = 0; k < 6; k++) g.fillText(rand() > 0.5 ? '0x' + Math.floor(rand() * 65535).toString(16) : 'NS_' + Math.floor(rand() * 99), Math.floor(rand() * 7) * 32 + 4, Math.floor(rand() * 8) * 32 + 26);
      }
    }, [COLS / 4, ROWS / 4]);
    const back = mesh(new THREE.PlaneGeometry(COLS, ROWS), std(0xffffff, { map: wallTex, r: 0.95 }), COLS / 2, ROWS / 2, ZB, world);
    back.castShadow = false;

    const solidCells = [], floorCells = [], ladderCells = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (h.solid(x, y)) { solidCells.push([x, y]); if (y > 0 && !h.solid(x, y - 1)) floorCells.push([x, y]); }
      if (h.ladder(x, y)) ladderCells.push([x, y]);
    }

    // cut-away concrete: front faces show a hatched section, other faces plain
    const hatch = canvasTex(64, 64, (g) => {
      g.fillStyle = hex(st.section); g.fillRect(0, 0, 64, 64);
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 2;
      for (let k = -64; k < 128; k += 12) { g.beginPath(); g.moveTo(k, 64); g.lineTo(k + 64, 0); g.stroke(); }
    });
    const concrete = std(st.mass, { r: 0.95 });
    const section = std(0xffffff, { map: hatch, r: 1 });
    instanced(new THREE.BoxGeometry(1, 1, DEPTH), [concrete, concrete, concrete, concrete, section, concrete], solidCells,
      (m, [x, y]) => m.makeTranslation(x + 0.5, ROWS - y - 0.5, 0));

    // floors: wooden planks / tiles on every exposed slab top, plus a front edge strip
    const plankTex = canvasTex(128, 64, (g) => {
      g.fillStyle = hex(st.floor); g.fillRect(0, 0, 128, 64);
      for (let y = 0; y < 64; y += 8) {
        g.fillStyle = `rgba(0,0,0,${0.15 + rand() * 0.15})`; g.fillRect(0, y, 128, 1);
        const off = Math.floor(rand() * 128);
        g.fillRect(off, y, 1, 8);
        g.fillStyle = `rgba(255,255,255,${rand() * 0.05})`; g.fillRect(0, y + 1, 128, 7);
      }
    }, [1, 1]);
    instanced(new THREE.BoxGeometry(1, 0.08, DEPTH), std(0xffffff, { map: plankTex, r: 0.6 }), floorCells,
      (m, [x, y]) => m.makeTranslation(x + 0.5, ROWS - y + 0.04, 0));
    instanced(new THREE.BoxGeometry(1, 0.06, 0.04), std(st.trim, { r: 0.5, m: 0.3 }), floorCells,
      (m, [x, y]) => m.makeTranslation(x + 0.5, ROWS - y + 0.02, DEPTH / 2 + 0.02));

    // skirting boards and dado rails along the back wall
    const trimDark = std(new THREE.Color(st.trim).multiplyScalar(0.45).getHex(), { r: 0.6 });
    instanced(new THREE.BoxGeometry(1, 0.22, 0.06), trimDark, floorCells,
      (m, [x, y]) => m.makeTranslation(x + 0.5, ROWS - y + 0.19, ZB + 0.03));
    instanced(new THREE.BoxGeometry(1, 0.05, 0.05), trimDark, floorCells,
      (m, [x, y]) => m.makeTranslation(x + 0.5, ROWS - y + 1.05, ZB + 0.03));

    // ladders
    const steel = std(0x9da3b5, { r: 0.4, m: 0.7 });
    instanced(new THREE.BoxGeometry(0.06, 1, 0.06), steel, ladderCells.flatMap((c) => [[...c, -1], [...c, 1]]),
      (m, [x, y, s]) => m.makeTranslation(x + 0.5 + s * 0.3, ROWS - y - 0.5, -0.35));
    const rung = new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6); rung.rotateZ(Math.PI / 2);
    instanced(rung, steel, ladderCells.flatMap((c) => [[...c, 0.17], [...c, 0.5], [...c, 0.83]]),
      (m, [x, y, f]) => m.makeTranslation(x + 0.5, ROWS - y - f, -0.35));

    // glitch blocks: two groups that take turns flickering in and out
    B.glitch = [3, 4].map((kind) => {
      const cells = [];
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (h.glitch && h.glitch(x, y) === kind) cells.push([x, y]);
      if (!cells.length) return null;
      const col = kind === 3 ? 0x39ffb0 : 0xff4fd8;
      const mat = new THREE.MeshStandardMaterial({ color: 0x0c1a1a, emissive: col, emissiveIntensity: 0.7, roughness: 0.4, transparent: true, opacity: 0.85 });
      const im = instanced(new THREE.BoxGeometry(0.96, 0.96, DEPTH - 0.3), mat, cells, (m, [x, y]) => m.makeTranslation(x + 0.5, ROWS - y - 0.5, 0));
      im.castShadow = false;
      return { im, mat, kind };
    });

    // ceiling lamps with real light (a limited number so it stays fast)
    const lampSpots = [];
    for (let y = 1; y < ROWS - 1; y++) {
      let run = [];
      for (let x = 0; x <= COLS; x++) {
        const ok = x < COLS && h.solid(x, y - 1) && !h.solid(x, y);
        if (ok) run.push(x);
        if ((!ok || x === COLS) && run.length) {
          const n = Math.max(1, Math.round(run.length / 7));
          for (let k = 0; k < n; k++) lampSpots.push([run[0] + (run.length * (k + 0.5)) / n, y]);
          run = [];
        }
      }
    }
    const shade = std(0x2a2a30, { r: 0.5, m: 0.6 });
    const bulb = basic(st.lamp);
    lampSpots.forEach(([x, y], i) => {
      const g = new THREE.Group();
      g.position.set(x, ROWS - y, -0.6);
      mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.25, 4), shade, 0, -0.12, 0, g);
      const cone = mesh(new THREE.ConeGeometry(0.22, 0.16, 16, 1, true), shade, 0, -0.3, 0, g);
      cone.material.side = THREE.DoubleSide;
      mesh(new THREE.SphereGeometry(0.07, 10, 8), bulb, 0, -0.36, 0, g).castShadow = false;
      if (i < 9) {
        const pl = new THREE.PointLight(st.lamp, 0.9, 7.5, 2);
        pl.position.set(0, -0.5, 0.4);
        g.add(pl);
      }
      world.add(g);
    });
  }

  function buildShadows(L, st) {
    const velvet = std(0x1a1224, { r: 1 });
    const dark = basic(0x000000, { transparent: true, opacity: 0.72, depthWrite: false });
    for (const s of L.shadows) {
      const w = s.w / T, hgt = s.h / T, cx = wx(s.x) + w / 2, cy = wy(s.y) - hgt / 2;
      // curtain with folds on the back wall
      const geo = new THREE.PlaneGeometry(w, hgt, Math.max(4, Math.round(w * 10)), 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 22) * 0.06);
      geo.computeVertexNormals();
      const c = mesh(geo, velvet, cx, cy, ZB + 0.1, world); c.castShadow = false;
      // the darkness itself: a volume the player can stand inside
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, DEPTH - 0.4), dark);
      box.position.set(cx, cy, -0.1);
      box.renderOrder = 2;
      world.add(box);
      // valance rail across the top
      mesh(new THREE.BoxGeometry(w + 0.1, 0.08, 0.1), std(st.trim, { r: 0.4, m: 0.5 }), cx, cy + hgt / 2 - 0.05, ZB + 0.2, world);
    }
  }

  function buildDoor(L) {
    const x = L.exit.x + 0.5, y = ROWS - L.exit.y - 1;
    const g = new THREE.Group(); g.position.set(x, y, ZB + 0.05); world.add(g);
    const frame = std(0x4b4757, { r: 0.6, m: 0.3 });
    mesh(new THREE.BoxGeometry(0.08, 1.85, 0.14), frame, -0.43, 0.92, 0, g);
    mesh(new THREE.BoxGeometry(0.08, 1.85, 0.14), frame, 0.43, 0.92, 0, g);
    mesh(new THREE.BoxGeometry(0.94, 0.08, 0.14), frame, 0, 1.86, 0, g);
    mesh(new THREE.BoxGeometry(0.78, 1.78, 0.05), std(0x2b2733, { r: 0.7, m: 0.2 }), 0, 0.89, 0.02, g);
    mesh(new THREE.BoxGeometry(0.05, 0.16, 0.06), std(0xd8d2c4, { r: 0.3, m: 0.8 }), 0.28, 0.9, 0.06, g);
    mesh(new THREE.BoxGeometry(0.5, 0.06, 0.04), std(0x9a9aa8, { r: 0.4, m: 0.6 }), 0, 0.95, 0.06, g);
    const signTex = canvasTex(128, 48, (c) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, 128, 48);
      c.fillStyle = '#000'; c.font = 'bold 30px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(L.def.final ? 'QUIT' : 'EXIT', 64, 26);
    });
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, color: 0xff4040, toneMapped: false });
    mesh(new THREE.BoxGeometry(0.6, 0.22, 0.06), signMat, 0, 2.1, 0.03, g).castShadow = false;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff4040, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
    glow.scale.set(1.4, 0.8, 1); glow.position.set(0, 2.1, 0.15); g.add(glow);
    B.door = { signMat, glow };
  }

  function paintingTexture(hue) {
    return canvasTex(128, 96, (g, w, hgt) => {
      const sky = g.createLinearGradient(0, 0, 0, hgt);
      sky.addColorStop(0, `hsl(${hue},45%,70%)`); sky.addColorStop(1, `hsl(${(hue + 30) % 360},40%,40%)`);
      g.fillStyle = sky; g.fillRect(0, 0, w, hgt);
      g.fillStyle = `hsl(${(hue + 50) % 360},70%,80%)`;
      g.beginPath(); g.arc(30 + rand() * 60, 26, 10, 0, Math.PI * 2); g.fill();
      for (let k = 0; k < 3; k++) {
        g.fillStyle = `hsl(${(hue + 180 + k * 20) % 360},${30 + k * 8}%,${34 - k * 8}%)`;
        g.beginPath(); g.moveTo(0, hgt);
        for (let x = 0; x <= w; x += 16) g.lineTo(x, hgt * (0.5 + k * 0.13) + Math.sin(x * 0.05 + k * 2 + rand()) * 8);
        g.lineTo(w, hgt); g.fill();
      }
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 6; g.strokeRect(0, 0, w, hgt);
    });
  }

  function buildLoot(it, h) {
    const g = new THREE.Group();
    const x = it.x + 0.5, y = ROWS - it.y - 0.5;
    world.add(g);
    if (it.kind === 'art' && it.variant === 'cartridge') {
      // the final prize: the game cartridge itself, floating and glowing
      g.position.set(x, y, 0);
      const cart = new THREE.Group(); g.add(cart);
      mesh(new THREE.BoxGeometry(0.62, 0.7, 0.12), std(0x3a3d48, { r: 0.45, m: 0.2 }), 0, 0, 0, cart);
      mesh(new THREE.BoxGeometry(0.5, 0.12, 0.13), std(0x2a2c34, { r: 0.5 }), 0, -0.36, 0, cart);
      const labelTex = canvasTex(128, 112, (c) => {
        c.fillStyle = '#0b0c14'; c.fillRect(0, 0, 128, 112);
        c.fillStyle = '#f2c46d'; c.font = 'bold 26px Impact, Arial Narrow, sans-serif'; c.textAlign = 'center';
        c.fillText('NIGHT', 64, 46); c.fillText('SHIFT', 64, 76);
        c.fillStyle = '#39ffb0'; c.font = '11px monospace'; c.fillText('GOOSEKNIGHT', 64, 98);
      });
      mesh(new THREE.PlaneGeometry(0.48, 0.42), new THREE.MeshBasicMaterial({ map: labelTex, toneMapped: false }), 0, 0.06, 0.065, cart).castShadow = false;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x39ffb0, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
      halo.scale.set(1.8, 1.8, 1); g.add(halo);
      return { g, spin: cart, bob: true, halo, cartridge: true };
    }
    if (it.kind === 'art') {
      g.position.set(x, y, ZB + 0.06);
      const gold = std(0xc9a14a, { r: 0.35, m: 0.75 });
      const fw = 0.86, fh = 0.7, t = 0.07;
      mesh(new THREE.BoxGeometry(fw, t, 0.07), gold, 0, fh / 2, 0, g);
      mesh(new THREE.BoxGeometry(fw, t, 0.07), gold, 0, -fh / 2, 0, g);
      mesh(new THREE.BoxGeometry(t, fh, 0.07), gold, -fw / 2, 0, 0, g);
      mesh(new THREE.BoxGeometry(t, fh, 0.07), gold, fw / 2, 0, 0, g);
      mesh(new THREE.PlaneGeometry(fw - t, fh - t), std(0xffffff, { map: paintingTexture(it.hue), r: 0.85 }), 0, 0, 0.01, g);
      // little brass picture light
      mesh(new THREE.BoxGeometry(0.4, 0.04, 0.08), std(0xb08a4a, { r: 0.3, m: 0.8 }), 0, fh / 2 + 0.1, 0.06, g);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffcf7a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 }));
      halo.scale.set(1.5, 1.2, 1); halo.position.set(0, 0, 0.05); g.add(halo);
      // pale patch left behind on the wall once it's taken
      const ghost = mesh(new THREE.PlaneGeometry(fw - 0.04, fh - 0.04), std(0xffffff, { r: 1, transparent: true, opacity: 0.12 }), x, y, ZB + 0.01, world);
      ghost.visible = false;
      return { g, ghost, halo };
    }
    g.position.set(x, y, 0);
    const onFloor = h.solid(it.x, it.y + 1);
    if (it.kind === 'gem') {
      const gem = mesh(new THREE.OctahedronGeometry(0.2, 0), std(0x6fe6ff, { r: 0.08, m: 0.3, e: 0x2bb8e8, ei: 0.9 }), 0, 0.05, 0, g);
      gem.scale.set(1, 1.35, 1);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x6fe6ff, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 }));
      glow.scale.set(1, 1, 1); g.add(glow);
      return { g, spin: gem, bob: true };
    }
    // valuables sit on a display plinth when on the floor, otherwise on a wall shelf
    let top = -0.2;
    if (onFloor) {
      mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), std(0xe8e4dc, { r: 0.35 }), 0, -0.29, 0, g);
      mesh(new THREE.BoxGeometry(0.48, 0.05, 0.48), std(0xd0cabe, { r: 0.4 }), 0, -0.06, 0, g);
      top = -0.03;
    } else {
      mesh(new THREE.BoxGeometry(0.5, 0.05, 0.4), std(0x5a4a3a, { r: 0.7 }), 0, -0.25, -0.1, g);
      top = -0.22;
    }
    const item = new THREE.Group(); item.position.y = top; g.add(item);
    if (it.variant === 'cash') {
      const note = std(0x6d9a5a, { r: 0.8 }), band = std(0xeae2c8, { r: 0.6 });
      [[0, 0.04, 0], [0.05, 0.12, 0.02], [-0.04, 0.2, -0.01]].forEach(([dx, dy, rot]) => {
        const b = mesh(new THREE.BoxGeometry(0.3, 0.07, 0.15), note, dx, dy, 0, item); b.rotation.y = rot * 10;
        mesh(new THREE.BoxGeometry(0.06, 0.075, 0.155), band, 0, 0, 0, b);
      });
    } else if (it.variant === 'watch') {
      const gold = std(0xe2b84c, { r: 0.25, m: 0.9 });
      const face = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 20), gold, 0, 0.13, 0, item); face.rotation.x = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.032, 20), std(0xf4f0e6, { r: 0.4 }), 0, 0, 0, face).position.y = 0.002;
      const strap = mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 20), std(0x4a2f1f, { r: 0.7 }), 0, 0.12, -0.03, item);
      strap.scale.set(1, 1.15, 1);
    } else {
      const wood = std(0x6a1f2c, { r: 0.5 }), gold = std(0xe2b84c, { r: 0.3, m: 0.85 });
      mesh(new THREE.BoxGeometry(0.28, 0.12, 0.18), wood, 0, 0.06, 0, item);
      const lid = mesh(new THREE.BoxGeometry(0.28, 0.03, 0.18), wood, 0, 0.17, -0.1, item); lid.rotation.x = -1.1;
      mesh(new THREE.BoxGeometry(0.29, 0.015, 0.185), gold, 0, 0.12, 0, item);
      for (let k = 0; k < 4; k++) mesh(new THREE.SphereGeometry(0.035, 8, 6), std(0xf5efe6, { r: 0.15, m: 0.1 }), -0.09 + k * 0.06, 0.14, 0.02, item);
    }
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe6a8, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 }));
    glint.scale.set(0.8, 0.8, 1); glint.position.y = top + 0.12; g.add(glint);
    return { g, spin: item, glint };
  }

  // ───────────── security hardware ─────────────
  function ensureObject(o) {
    if (B.objs.has(o)) return B.objs.get(o);
    let node = null;
    if (o.kind === 'camera' || o.kind === 'sentry') node = buildCamera(o);
    else if (o.kind === 'guard') { node = makeHuman('guard'); world.add(node.root); }
    else if (o.kind === 'drone') node = buildDrone();
    else if (o.kind === 'laser') node = buildLaser(o);
    else if (o.kind === 'panel') node = buildPanel(o);
    if (node) B.objs.set(o, node);
    return node;
  }

  function buildCamera(o) {
    const sentry = o.kind === 'sentry';
    const g = new THREE.Group(); g.position.set(wx(o.x), wy(o.y), 0); world.add(g);
    const metal = std(0x3b3f4c, { r: 0.5, m: 0.6 });
    // bracket up to the ceiling
    mesh(new THREE.BoxGeometry(0.06, 0.25, 0.06), metal, 0, 0.13, 0, g);
    mesh(new THREE.BoxGeometry(0.22, 0.04, 0.22), metal, 0, 0.26, 0, g);
    const head = new THREE.Group(); g.add(head);
    if (sentry) {
      mesh(new THREE.SphereGeometry(0.17, 16, 12), std(0x6a2228, { r: 0.4, m: 0.5 }), 0, 0, 0, head);
      for (const s of [-0.06, 0.06]) { const b = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), metal, 0.2, 0, s, head); b.rotation.z = Math.PI / 2; }
    } else {
      const body = std(0xd9dbe2, { r: 0.35, m: 0.1 });
      mesh(new THREE.BoxGeometry(0.42, 0.2, 0.22), body, 0.08, 0, 0, head);
      mesh(new THREE.BoxGeometry(0.46, 0.04, 0.26), body, 0.1, 0.12, 0, head); // sun hood
      const lens = mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.08, 16), std(0x10131a, { r: 0.1, m: 0.4 }), 0.32, 0, 0, head);
      lens.rotation.z = Math.PI / 2;
      mesh(new THREE.CircleGeometry(0.055, 16), std(0x203050, { r: 0.05, m: 0.2, e: 0x112244, ei: 0.6 }), 0.365, 0, 0, head).rotation.y = Math.PI / 2;
    }
    const ledMat = basic(0xff3030);
    const led = mesh(new THREE.SphereGeometry(0.025, 8, 6), ledMat, -0.08, 0.07, 0.115, head); led.castShadow = false;
    const ledGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff3030, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
    ledGlow.scale.set(0.25, 0.25, 1); ledGlow.position.copy(led.position); head.add(ledGlow);
    return { g, head, ledMat, ledGlow };
  }

  function buildDrone() {
    const g = new THREE.Group(); world.add(g);
    const shell = std(0x2b3142, { r: 0.35, m: 0.5 });
    const b = mesh(new THREE.SphereGeometry(0.22, 16, 12), shell, 0, 0, 0, g); b.scale.set(1.3, 0.55, 1);
    const rotors = [];
    for (const [dx, dz] of [[-0.42, -0.3], [0.42, -0.3], [-0.42, 0.3], [0.42, 0.3]]) {
      const arm = mesh(new THREE.BoxGeometry(Math.hypot(dx, dz), 0.03, 0.04), shell, dx / 2, 0.02, dz / 2, g);
      arm.rotation.y = -Math.atan2(dz, dx);
      mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8), shell, dx, 0.05, dz, g);
      const r = new THREE.Group(); r.position.set(dx, 0.09, dz); g.add(r);
      mesh(new THREE.BoxGeometry(0.34, 0.008, 0.04), std(0x9aa3b5, { r: 0.3, m: 0.6 }), 0, 0, 0, r);
      rotors.push(r);
    }
    const lensMat = basic(0xffd479);
    mesh(new THREE.SphereGeometry(0.06, 10, 8), lensMat, 0, -0.12, 0, g).castShadow = false;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd479, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
    glow.scale.set(0.5, 0.5, 1); glow.position.y = -0.14; g.add(glow);
    return { g, rotors, lensMat, glow };
  }

  function buildLaser(o) {
    const g = new THREE.Group(); world.add(g);
    const x1 = wx(o.x1), y1 = wy(o.y1), x2 = wx(o.x2), y2 = wy(o.y2);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const metal = std(0x4d5262, { r: 0.4, m: 0.7 });
    const emitters = [];
    for (const [ex, ey] of [[x1, y1], [x2, y2]]) {
      const e = mesh(new THREE.BoxGeometry(0.16, 0.16, 0.22), metal, ex, ey, 0, g);
      e.rotation.z = ang;
      emitters.push(e);
    }
    const beamGeo = new THREE.CylinderGeometry(0.018, 0.018, len, 6);
    const beamMat = basic(0xff3a32, { transparent: true });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    const glowMat = basic(0xff2a20, { transparent: true, opacity: 0.25, add: true, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, len, 8, 1, true), glowMat);
    for (const m of [beam, glow]) { m.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0); m.rotation.z = ang - Math.PI / 2; g.add(m); }
    const ledMat = basic(0xff3a32);
    emitters.forEach((e) => mesh(new THREE.SphereGeometry(0.03, 6, 4), ledMat, 0, 0, 0.115, e).castShadow = false);
    return { g, beam, glow, beamMat, glowMat, ledMat };
  }

  function buildPanel(o) {
    const g = new THREE.Group(); g.position.set(wx(o.x) + 0.5, wy(o.y) - 0.5, ZB + 0.06); world.add(g);
    mesh(new THREE.BoxGeometry(0.46, 0.66, 0.1), std(0x2c3142, { r: 0.5, m: 0.4 }), 0, 0, 0, g);
    const screenMat = basic(0x3f86ff);
    mesh(new THREE.PlaneGeometry(0.32, 0.2), screenMat, 0, 0.15, 0.052, g).castShadow = false;
    const key = std(0x5b6278, { r: 0.5 });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) mesh(new THREE.BoxGeometry(0.07, 0.05, 0.03), key, -0.1 + i * 0.1, -0.06 - j * 0.08, 0.06, g);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x3f86ff, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
    glow.scale.set(0.9, 0.7, 1); glow.position.set(0, 0.15, 0.1); g.add(glow);
    return { g, screenMat, glow };
  }

  // ───────────── characters ─────────────
  // An articulated figure built from simple shapes. Joints are groups so they can be posed.
  function makeHuman(kind) {
    const guard = kind === 'guard';
    const M = {
      skin: std(guard ? 0xb98868 : 0xd8b08a, { r: 0.7 }),
      top: guard ? std(0x34447f, { r: 0.75 }) : std(0xffffff, { map: stripeTex, r: 0.9 }),
      legs: std(guard ? 0x1f2747 : 0x1b1b22, { r: 0.85 }),
      shoe: std(0x0c0c0f, { r: 0.55 }),
      hat: std(guard ? 0x1a2246 : 0x141419, { r: 0.9 }),
      dark: std(0x07070a, { r: 0.5 }),
      gold: std(0xe2be5a, { r: 0.3, m: 0.8 }),
      white: std(0xf4f0e6, { r: 0.4 }),
      sack: std(0x8a6b45, { r: 1 }),
      glove: std(guard ? 0xb98868 : 0x15151a, { r: 0.7 }),
    };
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const hips = new THREE.Group(); hips.position.y = 0.86; body.add(hips);
    mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.18, 14), M.legs, 0, 0, 0, hips).scale.z = 0.7;
    const torso = new THREE.Group(); hips.add(torso);
    const chest = mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.52, 14), M.top, 0, 0.3, 0, torso);
    chest.scale.z = 0.72;
    mesh(new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.top, 0, 0.56, 0, torso).scale.set(1, 0.35, 0.72);
    mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8), M.skin, 0, 0.64, 0, torso);
    const head = new THREE.Group(); head.position.y = 0.76; torso.add(head);
    mesh(new THREE.SphereGeometry(0.13, 18, 14), M.skin, 0, 0, 0, head);
    mesh(new THREE.BoxGeometry(0.04, 0.05, 0.05), M.skin, 0, -0.01, 0.13, head); // nose
    if (guard) {
      mesh(new THREE.CylinderGeometry(0.142, 0.135, 0.08, 18), M.hat, 0, 0.09, 0, head);
      mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 18), M.hat, 0, 0.13, 0, head);
      mesh(new THREE.BoxGeometry(0.2, 0.02, 0.12), M.dark, 0, 0.055, 0.15, head);
      mesh(new THREE.BoxGeometry(0.04, 0.035, 0.01), M.gold, 0, 0.1, 0.142, head);
      for (const s of [-0.045, 0.045]) mesh(new THREE.SphereGeometry(0.015, 6, 4), M.dark, s, 0.02, 0.122, head);
      mesh(new THREE.BoxGeometry(0.08, 0.012, 0.01), std(0x3a2418), 0, -0.05, 0.125, head); // moustache
      // belt, badge, radio
      mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.05, 14), M.dark, 0, 0.06, 0, torso).scale.z = 0.75;
      mesh(new THREE.BoxGeometry(0.05, 0.035, 0.01), M.gold, 0, 0.06, 0.12, torso);
      mesh(new THREE.BoxGeometry(0.05, 0.06, 0.01), M.gold, 0.07, 0.44, 0.115, torso);
      mesh(new THREE.BoxGeometry(0.05, 0.09, 0.03), M.dark, -0.1, 0.48, 0.1, torso);
    } else {
      // beanie with turned-up cuff, bandit mask, swag sack
      mesh(new THREE.SphereGeometry(0.138, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.hat, 0, 0.02, 0, head);
      mesh(new THREE.TorusGeometry(0.135, 0.025, 8, 20), M.hat, 0, 0.03, 0, head).rotation.x = Math.PI / 2;
      mesh(new THREE.SphereGeometry(0.03, 8, 6), M.hat, 0, 0.16, 0, head);
      mesh(new THREE.CylinderGeometry(0.136, 0.136, 0.055, 18, 1, true), M.dark, 0, -0.005, 0, head);
      for (const s of [-0.045, 0.045]) {
        mesh(new THREE.SphereGeometry(0.022, 8, 6), M.white, s, 0, 0.124, head);
        mesh(new THREE.SphereGeometry(0.011, 6, 4), M.dark, s, 0, 0.142, head);
      }
      const sack = mesh(new THREE.SphereGeometry(0.17, 12, 10), M.sack, 0, 0.36, -0.2, torso);
      sack.scale.set(1, 1.15, 0.75);
      mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.08, 8), M.sack, 0, 0.56, -0.2, torso);
      const strap = mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 16, Math.PI), M.sack, 0, 0.36, -0.02, torso);
      strap.rotation.set(0, Math.PI / 2, -0.5);
    }
    const limb = (parentY, x, upperLen, lowerLen, rU, rL, matU, matL, end) => {
      const top = new THREE.Group(); top.position.set(x, parentY, 0);
      mesh(new THREE.CylinderGeometry(rU, rU * 0.9, upperLen, 10), matU, 0, -upperLen / 2, 0, top);
      mesh(new THREE.SphereGeometry(rU, 10, 8), matU, 0, 0, 0, top);
      const mid = new THREE.Group(); mid.position.y = -upperLen; top.add(mid);
      mesh(new THREE.SphereGeometry(rL, 10, 8), matL, 0, 0, 0, mid);
      mesh(new THREE.CylinderGeometry(rL, rL * 0.85, lowerLen, 10), matL, 0, -lowerLen / 2, 0, mid);
      end(mid, -lowerLen);
      return { top, mid };
    };
    const arms = [-1, 1].map((s) => {
      const a = limb(0.52, s * 0.22, 0.27, 0.25, 0.052, 0.045, M.top, guard ? M.top : M.top, (mid, y) => {
        mesh(new THREE.SphereGeometry(0.055, 10, 8), M.glove, 0, y - 0.03, 0, mid);
      });
      torso.add(a.top);
      return a;
    });
    if (guard) { // torch held out in the right hand; his vision cone starts here
      const torch = mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.24, 12), M.dark, 0, -0.34, 0, arms[1].mid);
      const lens = mesh(new THREE.CircleGeometry(0.038, 12), basic(0xfff3c8), 0, -0.121, 0, torch);
      lens.rotation.x = Math.PI / 2; lens.castShadow = false;
      const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff0c0, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
      flare.scale.set(0.45, 0.45, 1); flare.position.y = -0.14; torch.add(flare);
    }
    const legs = [-1, 1].map((s) => {
      const l = limb(-0.04, s * 0.09, 0.42, 0.4, 0.075, 0.06, M.legs, M.legs, (mid, y) => {
        mesh(new THREE.BoxGeometry(0.11, 0.07, 0.22), M.shoe, 0, y - 0.01, 0.04, mid);
      });
      hips.add(l.top);
      return l;
    });
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    return { root, body, hips, torso, head, arms, legs, kind, face: 1, faceAngle: Math.PI / 2 };
  }

  // Pose a figure. s = { phase, speed (0..1), crouch, climb, air, facing, dt, alert }
  function pose(hm, s) {
    const lerp = (a, b, t) => a + (b - a) * t;
    const k = Math.min(1, s.dt * 14);
    const target = s.climb ? Math.PI : s.facing * (Math.PI / 2 - 0.45);
    let d = target - hm.faceAngle;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    hm.faceAngle += d * Math.min(1, s.dt * 16);
    hm.body.rotation.y = hm.faceAngle;

    const sw = Math.sin(s.phase) * s.speed;
    const [aL, aR] = hm.arms, [lL, lR] = hm.legs;
    let hipY = 0.86, lean = 0.04 + s.speed * 0.08, headX = 0;
    let legA = [-sw * 0.75, sw * 0.75], kneeA = [Math.max(0, Math.sin(s.phase + 1.6)) * s.speed * 0.9, Math.max(0, Math.sin(s.phase + 1.6 + Math.PI)) * s.speed * 0.9];
    let armA = [sw * 0.7, -sw * 0.7], elbowA = [-0.25 - s.speed * 0.4, -0.25 - s.speed * 0.4], armZ = 0.08;
    if (s.crouch) {
      const cs = Math.sin(s.phase) * Math.min(1, s.speed * 2);
      hipY = 0.38; lean = 1.0; headX = -0.75;
      legA = [-1.35 - cs * 0.35, -1.35 + cs * 0.35]; kneeA = [2.1 + cs * 0.2, 2.1 - cs * 0.2];
      armA = [-0.9 + cs * 0.4, -0.9 - cs * 0.4]; elbowA = [-0.7, -0.7];
    } else if (s.climb) {
      const c = Math.sin(s.phase * 1.3);
      hipY = 0.86; lean = 0; headX = -0.15;
      armA = [-2.6 + c * 0.35, -2.6 - c * 0.35]; elbowA = [-0.5, -0.5]; armZ = 0.12;
      legA = [-0.5 - c * 0.4, -0.5 + c * 0.4]; kneeA = [0.9 + c * 0.3, 0.9 - c * 0.3];
    } else if (s.air) {
      legA = [-0.7, -0.15]; kneeA = [1.1, 0.5]; armA = [-1.6, -0.6]; elbowA = [-0.6, -0.4]; lean = 0.1;
    } else if (s.speed < 0.05) {
      const br = Math.sin(s.phase * 0.4 + performance.now() / 700) * 0.015;
      lean = 0.03 + br; armA = [0.05, -0.05];
    }
    if (s.torch && !s.climb) { armA[1] = -1.25; elbowA[1] = -0.1; }   // torch arm points the beam forward
    hm.hips.position.y = lerp(hm.hips.position.y, hipY, k);
    hm.torso.rotation.x = lerp(hm.torso.rotation.x, lean, k);
    hm.head.rotation.x = lerp(hm.head.rotation.x, headX, k);
    for (let i = 0; i < 2; i++) {
      hm.legs[i].top.rotation.x = lerp(hm.legs[i].top.rotation.x, legA[i], k);
      hm.legs[i].mid.rotation.x = lerp(hm.legs[i].mid.rotation.x, kneeA[i], k);
      hm.arms[i].top.rotation.x = lerp(hm.arms[i].top.rotation.x, armA[i], k);
      hm.arms[i].top.rotation.z = (i ? -1 : 1) * armZ;
      hm.arms[i].mid.rotation.x = lerp(hm.arms[i].mid.rotation.x, elbowA[i], k);
    }
  }

  // ───────────── vision cones ─────────────
  const coneVert = `attribute float aD; varying float vD; void main(){ vD = aD; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
  const coneFrag = `uniform vec3 uColor; uniform float uA; varying float vD; void main(){ float a = uA * (1.0 - 0.8*vD); gl_FragColor = vec4(uColor * a, a); }`;
  const STEPS = 40;
  function makeCone() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((STEPS + 2) * 3), dist = new Float32Array(STEPS + 2);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aD', new THREE.BufferAttribute(dist, 1));
    const idx = []; for (let i = 1; i <= STEPS; i++) idx.push(0, i, i + 1);
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      vertexShader: coneVert, fragmentShader: coneFrag, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(1, 0.88, 0.6) }, uA: { value: 0.22 } },
    });
    const layers = [-0.8, -0.25, 0.3].map((z) => { const m = new THREE.Mesh(geo, mat); m.position.z = z; m.frustumCulled = false; m.renderOrder = 3; world.add(m); return m; });
    // a pool of light on whatever the cone lands on
    return { geo, mat, layers };
  }
  function updateCones(ctx) {
    const cones = ctx.getCones();
    while (B.cones.length < cones.length) B.cones.push(makeCone());
    B.cones.forEach((c, i) => {
      const on = i < cones.length;
      c.layers.forEach((m) => { m.visible = on; });
      if (!on) return;
      const cn = cones[i];
      const pos = c.geo.attributes.position.array, dd = c.geo.attributes.aD.array;
      pos[0] = wx(cn.ox); pos[1] = wy(cn.oy); pos[2] = 0; dd[0] = 0;
      for (let k = 0; k <= STEPS; k++) {
        const a = cn.angle - cn.fov / 2 + (cn.fov * k) / STEPS;
        const d = ctx.castRay(cn.ox, cn.oy, a, cn.range);
        pos[(k + 1) * 3] = wx(cn.ox + Math.cos(a) * d);
        pos[(k + 1) * 3 + 1] = wy(cn.oy + Math.sin(a) * d);
        pos[(k + 1) * 3 + 2] = 0;
        dd[k + 1] = d / cn.range;
      }
      c.geo.attributes.position.needsUpdate = true;
      c.geo.attributes.aD.needsUpdate = true;
      c.geo.computeBoundingSphere();
      const seeing = cn.src.seeing;
      if (seeing) { c.mat.uniforms.uColor.value.setRGB(1, 0.22, 0.16); c.mat.uniforms.uA.value = 0.75; }
      else if (cn.kind === 'sentry') { c.mat.uniforms.uColor.value.setRGB(1, 0.4, 0.3); c.mat.uniforms.uA.value = 0.5; }
      else { c.mat.uniforms.uColor.value.setRGB(1, 0.86, 0.55); c.mat.uniforms.uA.value = 0.42; }
    });
  }

  // ───────────── particles ─────────────
  function buildParticles() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(300 * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(300 * 3), 3));
    const mat = new THREE.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    B.particles = new THREE.Points(geo, mat);
    B.particles.frustumCulled = false;
    world.add(B.particles);
  }
  const pc = new THREE.Color();
  function updateParticles(L) {
    const geo = B.particles.geometry, p = geo.attributes.position.array, c = geo.attributes.color.array;
    const n = Math.min(300, L.particles.length);
    for (let i = 0; i < n; i++) {
      const pt = L.particles[i];
      p[i * 3] = wx(pt.x); p[i * 3 + 1] = wy(pt.y); p[i * 3 + 2] = 0.3;
      pc.set(pt.color).multiplyScalar(Math.max(0, Math.min(1, pt.life)));
      c[i * 3] = pc.r; c[i * 3 + 1] = pc.g; c[i * 3 + 2] = pc.b;
    }
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  }

  // ───────────── decoys ─────────────
  function buildDecoy() {
    const g = new THREE.Group(); world.add(g);
    mesh(new THREE.BoxGeometry(0.22, 0.16, 0.16), std(0xc9c2b0, { r: 0.4, m: 0.3 }), 0, 0.08, 0, g);
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 14), std(0xf4f0e6, { r: 0.3 }), 0, 0.09, 0.085, g).rotation.x = Math.PI / 2;
    for (const s of [-0.07, 0.07]) mesh(new THREE.SphereGeometry(0.035, 8, 6), std(0xb08a3a, { r: 0.3, m: 0.8 }), s, 0.19, 0, g);
    const ledMat = basic(0xff4040);
    mesh(new THREE.SphereGeometry(0.022, 6, 4), ledMat, 0.08, 0.13, 0.085, g).castShadow = false;
    const ringMat = basic(0xffd479, { transparent: true, opacity: 0.6, add: true, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.015, 6, 32), ringMat);
    ring.position.y = 0.1; g.add(ring);
    return { g, ledMat, ring, ringMat };
  }
  function updateDecoys(L, t, dt) {
    if (!B.decoys) { B.decoys = new Map(); B.noises = new Map(); }
    // lookalike decoys: a copy of the thief, standing still; topples over when a guard busts it
    const live = new Set(L.decoys || []);
    for (const [d, n] of B.decoys) if (!live.has(d)) { world.remove(n.root); B.decoys.delete(d); }
    for (const d of L.decoys || []) {
      let n = B.decoys.get(d);
      if (!n) { n = makeHuman('thief'); world.add(n.root); n.faceAngle = d.facing * (Math.PI / 2 - 0.45); B.decoys.set(d, n); }
      n.root.position.set(wx(d.x), wy(d.feet), 0.05);
      pose(n, { phase: 0, speed: 0, facing: d.facing, dt });
      n.root.rotation.z = d.busted > 0 ? -d.facing * Math.min(1, d.busted * 3) * (Math.PI / 2) : 0;
    }
    // noisemakers
    const liveN = new Set(L.noises || []);
    for (const [d, n] of B.noises) if (!liveN.has(d)) { world.remove(n.g); B.noises.delete(d); }
    for (const d of L.noises || []) {
      let n = B.noises.get(d);
      if (!n) { n = buildDecoy(); B.noises.set(d, n); }
      n.g.position.set(wx(d.x), wy(d.feet), 0.2);
      const on = d.ringing > 0;
      n.ring.visible = on;
      n.g.rotation.z = on ? Math.sin(t * 40) * 0.08 : 0;
      if (on) { const k = (t * 1.6) % 1; n.ring.scale.setScalar(0.5 + k * 3); n.ringMat.opacity = 0.6 * (1 - k); }
      n.ledMat.color.setHex(on ? (Math.sin(t * 20) > 0 ? 0xff4040 : 0xffd479) : (Math.sin(t * 3) > 0.6 ? 0x40ff8a : 0x0a3a1a));
    }
  }

  function updateGlitch(L, t) {
    if (!B.glitch) return;
    const per = L.glitch.on + L.glitch.off;
    for (const gl of B.glitch) {
      if (!gl) continue;
      const ph = (L.time + (gl.kind === 4 ? per / 2 : 0)) % per;
      const on = ph < L.glitch.on;
      const warn = !on && ph > per - 0.35;     // about to appear: flicker
      gl.mat.opacity = on ? 0.88 : warn ? (Math.sin(t * 60) > 0 ? 0.5 : 0.08) : 0.08;
      gl.mat.emissiveIntensity = on ? 0.7 + Math.sin(t * 23) * 0.15 : 0.25;
    }
  }

  // ───────────── per-frame sync ─────────────
  function frame(L, ctx) {
    if (!B || B.L !== L) return;
    const t = ctx.clock, dt = Math.max(0.001, Math.min(0.05, ctx.dt));
    const menu = ctx.mode === 'title' || ctx.mode === 'select' || ctx.mode === 'shop';

    // player
    const p = L.player;
    const pm = B.player;
    pm.root.visible = !menu;
    pm.root.position.set(wx(p.x + p.w / 2), wy(p.y + p.h), p.climbing ? -0.15 : 0);
    pose(pm, {
      phase: p.walk * 2.2, speed: p.climbing ? 1 : Math.min(1, Math.abs(p.vx) / 175),
      crouch: p.ducking, climb: p.climbing, air: !p.onGround && !p.climbing, facing: p.facing, dt,
    });

    // security
    for (const o of L.objects) {
      const n = ensureObject(o);
      if (!n) continue;
      if (o.kind === 'guard') {
        n.root.position.set(wx(o.x), wy(o.feet), 0.05);
        const walking = o.wait <= 0;
        pose(n, { phase: o.step * 2.2, speed: walking ? 0.75 : 0, facing: o.dir, dt, torch: true });
      } else if (o.kind === 'camera' || o.kind === 'sentry') {
        n.head.rotation.z = -o.angle;
        const off = o.off > 0;
        const col = off ? 0x7cf2c4 : o.seeing ? 0xff2020 : (Math.sin(t * 6 + o.x) > 0 ? 0xff4a4a : 0x501010);
        n.ledMat.color.setHex(col); n.ledGlow.material.color.setHex(col);
        n.ledGlow.material.opacity = off ? 0.6 : o.seeing ? 1 : 0.5;
      } else if (o.kind === 'drone') {
        n.g.position.set(wx(o.x), wy(o.y) + Math.sin(t * 2 + o.x) * 0.05, 0);
        n.rotors.forEach((r, i) => { r.rotation.y = o.spin * (i % 2 ? 1 : -1); });
        const col = o.seeing ? 0xff3030 : 0xffd479;
        n.lensMat.color.setHex(col); n.glow.material.color.setHex(col);
      } else if (o.kind === 'laser') {
        let warn = false;
        if (!o.disabled && o.on && !o.live) { const ph = (L.time + o.offset) % (o.on + o.off); warn = ph > o.on + o.off - 0.35; }
        n.beam.visible = o.live || warn;
        n.glow.visible = o.live;
        n.beamMat.opacity = o.live ? 1 : 0.35;
        n.glowMat.opacity = 0.2 + 0.08 * Math.sin(t * 30 + o.x1);
        n.ledMat.color.setHex(o.disabled ? 0x2bbf88 : o.live ? 0xff3a32 : 0x6a1a18);
      } else if (o.kind === 'panel') {
        const col = o.used ? 0x2bbf88 : o.cooldown > 0 ? 0xc9a13a : 0x3f86ff;
        n.screenMat.color.setHex(col); n.glow.material.color.setHex(col);
        n.glow.material.opacity = 0.35 + 0.15 * Math.sin(t * 5);
      }
    }

    // loot
    for (const { it, node } of B.loot) {
      node.g.visible = !it.got;
      if (node.ghost) node.ghost.visible = it.got;
      if (it.got) continue;
      if (node.spin) node.spin.rotation.y = node.cartridge ? Math.sin(t * 1.2) * 0.6 : t * (it.kind === 'gem' ? 1.6 : 0.6);
      if (node.bob) node.g.position.y = ROWS - it.y - 0.5 + Math.sin(t * 2.5 + it.x) * 0.06;
      if (node.halo) node.halo.material.opacity = 0.25 + 0.12 * Math.sin(t * 2 + it.x);
    }
    const open = L.loot.every((i) => i.kind !== 'art' || i.got);
    const dc = open ? 0x40ff8a : 0xff4040;
    B.door.signMat.color.setHex(dc); B.door.glow.material.color.setHex(dc);

    updateDecoys(L, t, dt);
    updateGlitch(L, t);
    updateCones(ctx);
    updateParticles(L);

    // camera: frames the whole building, leans gently toward the player
    const cx = COLS / 2, cy = ROWS / 2;
    let tx = cx, ty = cy;
    if (!menu) { tx = cx + (wx(p.x) - cx) * 0.1; ty = cy + (wy(p.y) - cy) * 0.08; }
    else { tx = cx + Math.sin(t * 0.15) * 0.6; }
    const follow = Math.min(1, dt * 3);
    camTarget.x += (tx - camTarget.x) * follow;
    camTarget.y += (ty - camTarget.y) * follow;
    let sx = 0, sy = 0;
    if (L.shake > 0) { sx = (Math.random() - 0.5) * 0.25; sy = (Math.random() - 0.5) * 0.25; }
    if (L.act === 4 && !menu && Math.sin(t * 0.7) > 0.985) { sx += (Math.random() - 0.5) * 0.5; scene.background.setHex(Math.random() > 0.5 ? 0x0a1a14 : 0x050508); }
    else if (scene.background.getHex() !== 0x050508) scene.background.setHex(0x050508);
    camera.position.set(camTarget.x + sx, camTarget.y + 1.6 + sy, fitDist * 1.035);
    camera.lookAt(camTarget.x + sx, camTarget.y + sy, 0);
    if (api.debugCam) { const d = api.debugCam; camera.position.set(d.x, d.y + 0.6, d.dist); camera.lookAt(d.x, d.y, 0); }

    renderer.render(scene, camera);
  }

  const api = { init, build, frame, project, debugCam: null };
  return api;
})();
