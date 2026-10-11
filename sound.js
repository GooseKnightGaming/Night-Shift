/*
  NIGHT SHIFT — sound (V5)
  Every sound is made in the browser with the Web Audio API: no audio files.
  It listens rather than being told: each frame it looks at the game's state (window.NightShift)
  and plays what has changed - a footstep as a foot comes down, a landing, a pickup, a hack,
  the heat rising, the alarm, getting caught, getting out. The game's rules are untouched.
  Under it all: the building at night - a low hum, distant traffic, and a slow, quiet pulse
  that quickens as the heat rises. M turns it on and off (remembered).
*/
(() => {
  'use strict';
  let ctx = null, out = null, sfx = null, bed = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('nightshift.muted') === '1'; } catch (e) { /* storage blocked */ }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    out = ctx.createGain(); out.gain.value = muted ? 0 : 0.7; out.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.connect(out);
    sfx = ctx.createGain(); sfx.gain.value = 1; sfx.connect(comp);
    // a small room: the building's corridors
    const verb = ctx.createConvolver(), len = Math.floor(ctx.sampleRate * 1.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.5); }
    verb.buffer = ir; const wet = ctx.createGain(); wet.gain.value = 0.18; sfx.connect(verb); verb.connect(wet); wet.connect(comp);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startBed(comp);
  }
  const now = () => ctx.currentTime;
  function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  function noise(t, dur, type, f0, f1, peak, q) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); if (q) f.Q.value = q;
    const g = ctx.createGain(); env(g, t, 0.004, peak, dur);
    src.connect(f); f.connect(g); g.connect(sfx); src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  function tone(t, type, f0, f1, dur, peak, a) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); env(g, t, a || 0.005, peak, dur);
    o.connect(g); g.connect(sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  const ok = () => ctx && !muted;

  const S = {
    step(soft) { if (!ok()) return; const t = now(); noise(t, 0.05, 'bandpass', soft ? 900 : 1300, soft ? 500 : 700, soft ? 0.05 : 0.09, 1.2); tone(t, 'sine', 120, 70, 0.05, soft ? 0.03 : 0.06); },
    jump() { if (!ok()) return; const t = now(); noise(t, 0.12, 'bandpass', 600, 1800, 0.06, 0.8); },
    land(h) { if (!ok()) return; const t = now(); noise(t, 0.1 + h * 0.08, 'lowpass', 500 + h * 400, 120, 0.12 + h * 0.15); tone(t, 'sine', 90, 50, 0.12, 0.1 + h * 0.1); },
    rung() { if (!ok()) return; const t = now(); tone(t, 'triangle', 820 + Math.random() * 60, 0, 0.09, 0.035); noise(t, 0.03, 'highpass', 3000, 0, 0.02); },
    duck() { if (!ok()) return; const t = now(); noise(t, 0.08, 'lowpass', 700, 300, 0.04); },
    coin() { if (!ok()) return; const t = now(); tone(t, 'triangle', 1320, 0, 0.12, 0.08); tone(t + 0.07, 'triangle', 1760, 0, 0.22, 0.08); },
    painting() { if (!ok()) return; const t = now(); [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.07, 'triangle', f, 0, 0.5, 0.07)); noise(t, 0.25, 'bandpass', 2500, 900, 0.05); },
    gem() { if (!ok()) return; const t = now(); [1568, 2093, 2637, 3136].forEach((f, i) => tone(t + i * 0.05, 'sine', f, 0, 0.35, 0.05)); },
    hackTick(p) { if (!ok()) return; const t = now(); tone(t, 'square', 600 + p * 900, 0, 0.03, 0.025); },
    hacked() { if (!ok()) return; const t = now(); tone(t, 'square', 880, 0, 0.06, 0.04); tone(t + 0.08, 'square', 1320, 0, 0.12, 0.04); },
    laserHit() { if (!ok()) return; const t = now(); tone(t, 'sawtooth', 1400, 200, 0.35, 0.09); noise(t, 0.2, 'highpass', 2000, 0, 0.06); },
    spotted() { if (!ok()) return; const t = now(); tone(t, 'sawtooth', 220, 0, 0.18, 0.06); tone(t, 'sawtooth', 233, 0, 0.18, 0.05); },
    alert() { if (!ok()) return; const t = now(); [440, 554].forEach((f, i) => tone(t + i * 0.16, 'square', f, 0, 0.14, 0.05)); },
    lockdown() { if (!ok()) return; const t = now(); for (let i = 0; i < 3; i++) tone(t + i * 0.42, 'sawtooth', 520, 880, 0.38, 0.06, 0.02); },
    calm() { if (!ok()) return; const t = now(); tone(t, 'sine', 660, 440, 0.4, 0.04); },
    caught() { if (!ok()) return; const t = now(); for (let i = 0; i < 4; i++) { tone(t + i * 0.3, 'square', 960, 0, 0.14, 0.07); tone(t + i * 0.3 + 0.15, 'square', 720, 0, 0.14, 0.07); } noise(t, 0.3, 'lowpass', 400, 80, 0.15); },
    won() { if (!ok()) return; const t = now(); [392, 494, 587, 784].forEach((f, i) => tone(t + i * 0.11, 'triangle', f, 0, 0.6, 0.07)); },
    door() { if (!ok()) return; const t = now(); noise(t, 0.35, 'bandpass', 400, 200, 0.07, 2); tone(t + 0.25, 'sine', 140, 80, 0.15, 0.06); },
    gadget() { if (!ok()) return; const t = now(); noise(t, 0.15, 'bandpass', 1200, 500, 0.05); tone(t, 'sine', 500, 900, 0.08, 0.03); },
    ring() { if (!ok()) return; const t = now(); for (let i = 0; i < 6; i++) tone(t + i * 0.06, 'square', i % 2 ? 2100 : 2600, 0, 0.05, 0.03); },
    bust() { if (!ok()) return; const t = now(); noise(t, 0.2, 'lowpass', 600, 150, 0.12); },
    loop() { if (!ok()) return; const t = now(); for (let i = 0; i < 5; i++) tone(t + i * 0.035, 'square', 200 + Math.random() * 1800, 0, 0.03, 0.02); },
  };

  // the building at night: a hum, far traffic, a slow pulse that quickens with the heat
  let pulse = null;
  function startBed(dest) {
    bed = ctx.createGain(); bed.gain.value = 0.0; bed.connect(dest);
    const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 55;
    const hum2 = ctx.createOscillator(); hum2.type = 'sine'; hum2.frequency.value = 110.4;
    const hg = ctx.createGain(); hg.gain.value = 0.05; hum.connect(hg); hum2.connect(hg); hg.connect(bed); hum.start(); hum2.start();
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const tg = ctx.createGain(); tg.gain.value = 0.12; src.connect(lp); lp.connect(tg); tg.connect(bed); src.start();
    pulse = { next: 0 };
  }
  function tickBed(heat, playing) {
    if (!bed) return;
    const target = muted ? 0 : playing ? 0.9 : 0.5;
    bed.gain.setTargetAtTime(target, now(), 0.4);
    if (!playing || muted) return;
    // a soft low pulse, like a heartbeat in the dark: every ~1.4 s quiet, ~0.45 s at full heat
    const gap = 1.4 - Math.min(1, heat / 100) * 0.95;
    if (now() >= pulse.next) {
      pulse.next = now() + gap;
      const t = now(), peak = 0.035 + heat / 100 * 0.06;
      tone(t, 'sine', 62, 48, 0.22, peak); tone(t + 0.16, 'sine', 58, 44, 0.2, peak * 0.7);
    }
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('nightshift.muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (out) out.gain.setTargetAtTime(m ? 0 : 0.7, now(), 0.05);
  }
  addEventListener('keydown', (e) => {
    init();
    if (e.code === 'KeyM' && !e.repeat) { setMuted(!muted); if (window.NightShift && window.NightShift._level()) { const L = window.NightShift._level(); L.toast = { text: muted ? 'Sound off (M)' : 'Sound on (M)', t: 1.6 }; } }
  });
  addEventListener('pointerdown', init);

  // ── watching the game ──
  let prev = null;
  function watch() {
    requestAnimationFrame(watch);
    const NS = window.NightShift;
    if (!NS || !ctx) return;
    const L = NS._level(), st = NS.state, mode = st.mode;
    if (!L) return;
    const p = L.player;
    const playing = mode === 'play';
    tickBed(L.heat || 0, playing);
    const cur = {
      L, mode, onGround: p.onGround, climbing: p.climbing, ducking: p.ducking, vy: p.vy,
      step: Math.floor(p.walk * 2.2 / Math.PI), got: L.loot.map((i) => i.got),
      used: L.objects.filter((o) => o.kind === 'panel').map((o) => o.used ? 1 : 0),
      progress: Math.max(0, ...L.objects.filter((o) => o.kind === 'panel').map((o) => o.progress || 0)),
      tier: !L.heatMode ? 0 : L.heat >= 66 ? 2 : L.heat >= 33 ? 1 : 0, seen: !!L.seenNow, flash: L.flash > 0.3,
      decoys: (L.decoys || []).length, busted: (L.decoys || []).filter((d) => d.busted > 0).length,
      noises: (L.noises || []).length, ringing: (L.noises || []).some((n) => n.ringing > 0),
      looped: L.objects.filter((o) => (o.kind === 'camera' || o.kind === 'sentry') && o.off > 0).length,
    };
    if (prev && prev.L === L) {
      if (playing) {
        if (cur.onGround && !prev.onGround && !cur.climbing && prev.vy > 150) S.land(Math.min(1, prev.vy / 700));
        if (!cur.onGround && prev.onGround && cur.vy < -100) S.jump();
        if (cur.step !== prev.step) { if (cur.climbing) S.rung(); else if (cur.onGround) S.step(cur.ducking); }
        if (cur.ducking && !prev.ducking) S.duck();
        cur.got.forEach((g, i) => { if (g && !prev.got[i]) { const it = L.loot[i]; if (it.kind === 'art') S.painting(); else if (it.kind === 'gem') S.gem(); else S.coin(); } });
        if (cur.used.some((u, i) => u && !prev.used[i]) || cur.looped > prev.looped) { S.hacked(); if (cur.looped > prev.looped) S.loop(); }
        if (cur.progress > 0 && Math.floor(cur.progress * 8) !== Math.floor(prev.progress * 8)) S.hackTick(cur.progress);
        if (cur.flash && !prev.flash) S.laserHit();
        if (cur.seen && !prev.seen) S.spotted();
        if (cur.tier > prev.tier) { if (cur.tier === 2) S.lockdown(); else S.alert(); }
        if (cur.tier === 0 && prev.tier > 0) S.calm();
        if (cur.decoys > prev.decoys || cur.noises > prev.noises) S.gadget();
        if (cur.busted > prev.busted) S.bust();
      }
      if (cur.ringing && !prev.ringing) S.ring();
      if (cur.ringing && Math.random() < 0.05) S.ring();
      if (mode === 'caught' && prev.mode !== 'caught') S.caught();
      if (mode === 'won' && prev.mode !== 'won') { S.door(); setTimeout(S.won, 250); }
    }
    prev = cur;
  }
  requestAnimationFrame(watch);
  window.NightShiftSound = Object.assign(S, { init, setMuted, get muted() { return muted; } });
})();
