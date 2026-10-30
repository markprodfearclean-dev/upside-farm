// live/audio.js — all sound is synthesized (WebAudio, no files) and driven by the sim event bus (S.ev) plus a few continuous
// states (flashlight beam, night/day, wave). Night plays an original synth-arp score in the spirit of 80s synthwave; day has
// crickets. Silent in the attract demo and in ?render=1. O toggles sound (remembered per browser).
(function () {
  if (new URLSearchParams(location.search).get('render')) return;
  const A = (window.AUDIO = { on: true });
  try { A.on = localStorage.getItem('upside_sound') !== '0'; } catch (e) {}
  let ctx = null, master, sfx, mus, amb, verb, delay, noiseBuf, beamOsc, beamGain, rumble;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = A.on ? 0.9 : 0; master.connect(comp);
    sfx = ctx.createGain(); sfx.gain.value = 0.8; sfx.connect(master);
    mus = ctx.createGain(); mus.gain.value = 0; mus.connect(master);
    amb = ctx.createGain(); amb.gain.value = 0.5; amb.connect(master);
    // a short generated room reverb and a ping-pong-ish delay for the score
    verb = ctx.createConvolver(); const len = ctx.sampleRate * 1.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    verb.buffer = ir; const vg = ctx.createGain(); vg.gain.value = 0.28; verb.connect(vg); vg.connect(master);
    delay = ctx.createDelay(1); delay.delayTime.value = 0.47; const fb = ctx.createGain(); fb.gain.value = 0.33; const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2200;
    delay.connect(dl); dl.connect(fb); fb.connect(delay); dl.connect(mus);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // flashlight hum (on while the beam is on) and the rift's low rumble
    beamOsc = ctx.createOscillator(); beamOsc.type = 'sawtooth'; beamOsc.frequency.value = 118; const bf = ctx.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = 520;
    beamGain = ctx.createGain(); beamGain.gain.value = 0; beamOsc.connect(bf); bf.connect(beamGain); beamGain.connect(sfx); beamOsc.start();
    const rn = ctx.createBufferSource(); rn.buffer = noiseBuf; rn.loop = true; const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 110;
    rumble = ctx.createGain(); rumble.gain.value = 0; rn.connect(rf); rf.connect(rumble); rumble.connect(amb); rn.start();
    nextStep = ctx.currentTime + 0.1; nextChirp = ctx.currentTime + 0.5;
  }
  addEventListener('pointerdown', init); addEventListener('keydown', (e) => { init();
    if (e.code === 'KeyO' && ctx) { A.on = !A.on; try { localStorage.setItem('upside_sound', A.on ? '1' : '0'); } catch (er) {} master.gain.setTargetAtTime(A.on ? 0.9 : 0, ctx.currentTime, 0.05); } });

  // ---------------------------------------------------------------- voices
  function env(g, at, vol, a, d) { g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(vol, at + a); g.gain.exponentialRampToValueAtTime(0.0001, at + a + d); }
  function tone(f, d, o = {}) { const at = ctx.currentTime + (o.at || 0), os = ctx.createOscillator(), g = ctx.createGain();
    os.type = o.type || 'sine'; os.frequency.setValueAtTime(f, at); if (o.f2) os.frequency.exponentialRampToValueAtTime(o.f2, at + (o.glide || d));
    if (o.detune) os.detune.value = o.detune; let n = os;
    if (o.lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; fl.Q.value = o.q || 0.7; os.connect(fl); n = fl; }
    if (o.trem) { const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = o.trem; lg.gain.value = (o.vol || 0.2) * 0.6; lfo.connect(lg); lg.connect(g.gain); lfo.start(at); lfo.stop(at + d + 0.1); }
    n.connect(g); g.connect(o.dest || sfx); if (o.wet) g.connect(verb); env(g, at, o.vol || 0.2, o.a || 0.005, d); os.start(at); os.stop(at + d + 0.1); }
  function noise(d, o = {}) { const at = ctx.currentTime + (o.at || 0), s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.playbackRate.value = o.rate || 1; fl.type = o.ft || 'bandpass'; fl.frequency.setValueAtTime(o.f || 1000, at); fl.Q.value = o.q || 1;
    if (o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, at + (o.glide || d));
    s.connect(fl); fl.connect(g); g.connect(o.dest || sfx); if (o.wet) g.connect(verb); env(g, at, o.vol || 0.2, o.a || 0.004, d); s.start(at, Math.random()); s.stop(at + d + 0.1); }

  const last = {}; const gap = (k, s) => { const n = ctx.currentTime; if (last[k] && n - last[k] < s) return false; last[k] = n; return true; };
  const SND = {
    harvest: (e) => { if (!gap('harvest', 0.04)) return; noise(0.16, { f: 1800, f2: 5200, q: 1.4, vol: 0.32 }); tone(rnd(480, 560), 0.09, { type: 'triangle', f2: 300, vol: 0.18, at: 0.04 }); },
    sell: (e) => { if (!gap('sell', 0.05)) return; const k = 1 + 0.08 * (e.c || 0); tone(1320 * k, 0.07, { type: 'triangle', vol: 0.14 }); tone(1760 * k, 0.22, { type: 'triangle', vol: 0.14, at: 0.06, wet: 1 }); },
    coin: () => { tone(1320, 0.07, { type: 'triangle', vol: 0.14 }); tone(1980, 0.25, { type: 'triangle', vol: 0.14, at: 0.07, wet: 1 }); },
    plant: () => { if (!gap('plant', 0.05)) return; tone(150, 0.12, { f2: 70, vol: 0.32 }); noise(0.08, { ft: 'lowpass', f: 700, vol: 0.18 }); },
    clear: () => noise(0.16, { ft: 'lowpass', f: 900, vol: 0.2 }),
    click: () => { noise(0.02, { ft: 'highpass', f: 3500, vol: 0.25 }); tone(2100, 0.02, { type: 'square', vol: 0.05 }); },
    empty: () => tone(440, 0.4, { type: 'square', f2: 110, lp: 1500, vol: 0.12 }),
    spawn: (e) => { noise(1.3, { ft: 'lowpass', f: 180, f2: 1400, glide: 0.6, q: 4, vol: 0.4, wet: 1 }); tone(e.boss ? 38 : 55, 1.5, { f2: e.boss ? 28 : 40, vol: 0.5 });
      if (e.boss) tone(73, 2.2, { type: 'sawtooth', lp: 400, trem: 9, vol: 0.25, wet: 1 }); },
    growl: () => { if (!gap('growl', 0.6)) return; const f = rnd(62, 78); tone(f, 0.7, { type: 'sawtooth', f2: f * 0.8, lp: 520, q: 6, trem: rnd(14, 22), vol: 0.3, wet: 1 }); noise(0.5, { f: 320, q: 3, vol: 0.14 }); },
    eat: () => { for (let i = 0; i < 3; i++) noise(0.06, { f: rnd(900, 1500), q: 2, vol: 0.28, at: i * 0.11 }); },
    scare: () => { if (!gap('scare', 0.15)) return; tone(rnd(850, 950), 0.5, { type: 'sawtooth', f2: 1600, glide: 0.12, lp: 2600, q: 5, vol: 0.12, wet: 1 }); noise(0.35, { ft: 'highpass', f: 2500, vol: 0.08 }); },
    vanish: () => noise(0.5, { ft: 'bandpass', f: 1500, f2: 150, q: 2, vol: 0.12, wet: 1 }),
    shot: () => { noise(0.3, { ft: 'lowpass', f: 3500, f2: 250, vol: 0.7 }); tone(95, 0.25, { f2: 38, vol: 0.6 }); noise(0.9, { ft: 'lowpass', f: 600, vol: 0.12, at: 0.05, wet: 1 }); },
    kill: () => { tone(130, 0.35, { f2: 40, vol: 0.45 }); noise(0.25, { f: 380, q: 2, vol: 0.3 }); },
    smash: () => { noise(0.3, { ft: 'highpass', f: 4200, vol: 0.4 }); for (let i = 0; i < 6; i++) tone(rnd(2500, 5200), 0.12, { vol: 0.07, at: rnd(0, 0.25), wet: 1 }); tone(90, 0.3, { f2: 50, vol: 0.3 }); },
    fix: () => { tone(1800, 0.06, { type: 'square', lp: 4000, vol: 0.08 }); tone(1650, 0.08, { type: 'square', lp: 4000, vol: 0.08, at: 0.14 }); },
    build: () => { tone(190, 0.16, { type: 'triangle', f2: 90, vol: 0.4 }); noise(0.1, { f: 800, q: 2, vol: 0.25 }); tone(1300, 0.3, { vol: 0.06, at: 0.2, wet: 1 }); },
    research: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.13, at: i * 0.08, wet: 1 })),
    wave: (e) => { const r = e.n === 10 ? 41.2 : 55; [r, r * 1.5, r * 2].forEach((f) => tone(f, 1.8, { type: 'sawtooth', lp: 700, vol: 0.18, a: 0.08, wet: 1 })); tone(r, 1.2, { f2: r * 0.6, vol: 0.5 }); },
    dawn: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 2.2, { vol: 0.07, a: 0.5, at: i * 0.12, wet: 1 })),
    plotlost: () => { tone(233, 0.6, { type: 'sawtooth', lp: 1300, vol: 0.13, wet: 1 }); tone(247, 0.6, { type: 'sawtooth', lp: 1300, vol: 0.13 }); noise(0.4, { f: 300, q: 2, vol: 0.18 }); },
    infect: () => { if (gap('infect', 0.25)) noise(0.22, { f: 260, q: 3, vol: 0.07 }); },
    surge: () => tone(48, 0.6, { f2: 36, vol: 0.32 }),
    cleanse: () => { if (gap('cleanse', 0.12)) tone(2000, 0.12, { f2: 3000, vol: 0.05, wet: 1 }); },
    med: () => [880, 1320, 1760].forEach((f, i) => tone(f, 0.9, { vol: 0.08, trem: 7, at: i * 0.05, wet: 1 })),
    cure: () => tone(1320, 0.4, { vol: 0.07, wet: 1 }),
    gem: () => { tone(1568, 0.8, { vol: 0.12, wet: 1 }); tone(2349, 0.6, { vol: 0.08, at: 0.04, wet: 1 }); },
    buy: () => SND.coin(),
    ui: () => { if (gap('ui', 0.03)) tone(1250, 0.03, { type: 'triangle', vol: 0.08 }); },
    pop: () => { if (!gap('pop', 0.05)) return; tone(rnd(700, 900), 0.08, { f2: 200, vol: 0.18 }); noise(0.1, { f: 900, q: 2, vol: 0.15 }); },
    spit: () => { noise(0.35, { f: 600, f2: 200, q: 3, vol: 0.2 }); tone(180, 0.3, { type: 'sawtooth', f2: 90, lp: 600, vol: 0.1 }); },
    dig: () => { for (let i = 0; i < 4; i++) noise(0.08, { ft: 'lowpass', f: 500, vol: 0.25, at: i * 0.09 }); tone(70, 0.4, { f2: 45, vol: 0.3 }); },
    bolt: () => { noise(0.15, { ft: 'highpass', f: 2000, vol: 0.5 }); noise(2.2, { ft: 'lowpass', f: 300, f2: 60, glide: 2, vol: 0.6, at: 0.08, wet: 1 }); tone(45, 1.6, { f2: 30, vol: 0.4, at: 0.1 }); },
    tshot: () => { if (!gap('tshot', 0.05)) return; noise(0.18, { ft: 'lowpass', f: 2600, f2: 300, vol: 0.4 }); tone(120, 0.12, { f2: 50, vol: 0.3 }); },
    portal: () => { noise(2.5, { ft: 'lowpass', f: 120, f2: 900, glide: 1.5, q: 5, vol: 0.5, wet: 1 }); [41.2, 43.65].forEach((f) => tone(f, 2.8, { type: 'sawtooth', lp: 300, trem: 6, vol: 0.25, wet: 1 })); },
    blackout: () => { tone(220, 0.6, { type: 'square', f2: 40, lp: 900, vol: 0.15 }); noise(0.1, { ft: 'highpass', f: 3000, vol: 0.2, at: 0.05 }); },
    power: () => [330, 440, 660].forEach((f, i) => tone(f, 0.18, { type: 'square', lp: 1800, vol: 0.06, at: i * 0.07 })),
    fair: () => [523, 659, 784, 659, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.12, at: i * 0.11, wet: 1 })),
    golden: () => [1319, 1568, 2093].forEach((f, i) => tone(f, 0.9, { vol: 0.1, at: i * 0.09, wet: 1 })),
    buysec: () => { SND.coin(); [392, 523, 659].forEach((f, i) => tone(f, 0.4, { type: 'triangle', vol: 0.1, at: 0.15 + i * 0.1, wet: 1 })); },
    saltgone: () => noise(0.4, { ft: 'highpass', f: 5000, vol: 0.06 }),
    lost: () => [440, 392, 330, 220].forEach((f, i) => tone(f, 0.9, { type: 'sawtooth', lp: 900, vol: 0.12, at: i * 0.45, wet: 1 })),
    won: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i === 4 ? 1.6 : 0.3, { type: 'triangle', vol: 0.14, at: i * 0.13, wet: 1 })),
  };

  // ---------------------------------------------------------------- score: night = slow analog synth ostinato (original theme,
  // 80s horror-synth style: one pulsing 8th-note arpeggio through a resonant low-pass that opens and closes over 8 bars, a sub
  // drone, wide detuned pads); day = crickets
  const BPM = 84, STEP = 60 / BPM / 2;                                                                  // 8th notes
  const PROG = [[50, 57, 60, 64, 65], [46, 53, 57, 60, 62], [43, 50, 53, 57, 58], [45, 52, 55, 61, 64]];   // Dm(add9)  B♭maj7  Gm(add9)  A7sus→A  (MIDI, 2 bars each)
  const ARP = [0, 2, 4, 1, 3, 2, 4, 1];                                                                // own contour: root, 5th-ish, top, 3rd… (one bar)
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  let nextStep = 0, step = 0, nextChirp = 0, night = 0, wave = 0;
  function scheduleMusic() {
    while (nextStep < ctx.currentTime + 0.25) { const at = nextStep - ctx.currentTime, bar = Math.floor(step / 8), s = step % 8, ch = PROG[Math.floor(bar / 2) % 4];
      if (night > 0.05) {
        const sweep = 0.5 - 0.5 * Math.cos(2 * Math.PI * (step % 64) / 64), cut = 450 + 2600 * sweep;   // the filter breathes over 8 bars
        const m = ch[ARP[s]] + 12;
        tone(hz(m), STEP * 0.95, { type: 'sawtooth', lp: cut, q: 9, vol: 0.07, at, dest: mus });                // the ostinato: saw + square an octave down
        tone(hz(m - 12), STEP * 0.95, { type: 'square', lp: cut * 0.7, q: 6, vol: 0.035, at, dest: mus });
        tone(hz(m), STEP * 0.95, { type: 'sawtooth', lp: cut, q: 6, vol: 0.03, at, dest: delay });
        if (s === 0 && bar % 2 === 0) {                                                                   // sub drone + wide pad, held two bars
          tone(hz(ch[0] - 12), STEP * 16, { type: 'sawtooth', lp: 220, vol: 0.11, a: 0.6, at, dest: mus });
          tone(hz(ch[0] - 24), STEP * 16, { vol: 0.14, a: 0.8, at, dest: mus });
          ch.slice(1, 4).forEach((p) => [-9, 9].forEach((dt) => tone(hz(p), STEP * 16, { type: 'sawtooth', lp: 900, vol: 0.016, a: 1.2, at, detune: dt, dest: mus, wet: 1 }))); }
        if (bar % 8 === 6 && s === 4) tone(hz(ch[4] + 24), STEP * 6, { type: 'triangle', vol: 0.03, a: 0.3, at, dest: delay });   // a distant high bell now and then
        if (wave >= 6 && s % 2 === 0) tone(100, 0.22, { f2: 38, vol: 0.22, at, dest: mus });                   // heartbeat kick once it gets serious
        if (wave >= 8 && s % 2 === 1) noise(0.05, { ft: 'highpass', f: 7000, vol: 0.05, at, dest: mus }); }
      nextStep += STEP; step++; }
    if (night < 0.5 && ctx.currentTime > nextChirp) { const at = rnd(0, 0.1), f = rnd(4100, 4700), n = 2 + Math.floor(rnd(0, 3));             // crickets
      for (let i = 0; i < n; i++) tone(f, 0.035, { vol: 0.025 * (1 - night * 2), at: at + i * 0.06, dest: amb });
      nextChirp = ctx.currentTime + rnd(0.25, 1.1); }
  }

  // ---------------------------------------------------------------- per-frame update (wraps the scene's render)
  let lastT = -1;
  function update(S) {
    if (!ctx) return;
    if (!S) { mus.gain.setTargetAtTime(0, ctx.currentTime, 0.4); beamGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05); rumble.gain.setTargetAtTime(0, ctx.currentTime, 0.3); lastT = -1; return; }
    if (lastT < 0 || S.t < lastT - 0.5) lastT = S.t;
    for (const e of S.ev) if (e.t >= lastT - 1e-9 && e.t < S.t - 1e-9 && SND[e.k]) SND[e.k](e);
    lastT = S.t;
    night = S.phase === 'night' ? 1 : 0; wave = S.wave >= 12 ? 8 : S.wave;
    mus.gain.setTargetAtTime(S.panel ? 0.25 : night ? 0.75 : 0, ctx.currentTime, night ? 0.8 : 1.5);
    beamGain.gain.setTargetAtTime(S.beam ? 0.045 : 0, ctx.currentTime, 0.03);
    rumble.gain.setTargetAtTime(0.25 + 0.25 * night + 0.06 * S.mobs.length, ctx.currentTime, 0.5);
    scheduleMusic();
  }
  const render = SCENE.render; SCENE.render = (t) => { render(t); try { update(SCENE.state); } catch (e) { if (!A.err) { A.err = e; console.error(e); } } };
})();
