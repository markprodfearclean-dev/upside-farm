// live/sim.js — «Огород у Изнанки»: a cozy-horror farm defense. Deterministic 120 Hz sim (ref2game contract).
// A two-screen-wide farm (camera scrolls) with four 4×4 garden sections (one owned, three for sale) on a 25×6 field grid;
// crops grow and are harvested with the scythe (LMB drag) and fly to the cart / barn to be sold for coins + XP. Rifts (one at
// first, three by the end) spread corruption cell by cell and release creatures of seven kinds that eat or poison crops and
// smash lights. Light (flashlight on RMB/Space, posts, garlands, searchlights, scarecrows, sunflowers) stops and pushes back
// the corruption and scares creatures; salt blocks it; turrets and the rifle kill. XP researches (the book), coins buy and
// place (the build menu), diamonds buy medicine. Weather and events per night; three difficulty modes; 20 waves, bosses on 10
// and 20. All balance numbers live in BAL / CROPS / RESEARCH; live/balance.cjs runs bots through whole games.
(function (root) {
  const DT = 1 / 120, VIEW = { W: 1920, H: 1080 }, WORLD = { W: 4290 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // ---------------------------------------------------------------- layout (world px; the scene draws from these)
  const NC = 28, NR = 6, CW = 150, CH = 136, FX0 = 45, FY0 = 119;               // field grid (corruption lives here)
  const cellXY = (c, r) => [FX0 + c * CW + CW / 2, FY0 + r * CH + CH / 2];
  const cellAt = (x, y) => { const c = Math.floor((x - FX0) / CW), r = Math.floor((y - FY0) / CH); return c >= 0 && c < NC && r >= 0 && r < NR ? [c, r] : null; };
  const SECTS = [{ id: 'A', c0: 10, price: 0 }, { id: 'B', c0: 15, price: 250 }, { id: 'C', c0: 5, price: 450 }, { id: 'D', c0: 20, price: 800 }];
  const PLOTS = []; SECTS.forEach((s, si) => { for (let r = 1; r <= 4; r++) for (let c = s.c0; c < s.c0 + 4; c++) { const [x, y] = cellXY(c, r); PLOTS.push({ c, r, x, y, sec: si }); } });
  const PLOT_AT = {}; PLOTS.forEach((P, i) => (PLOT_AT[P.r * NC + P.c] = i));
  const plotAt = (c, r) => (PLOT_AT[r * NC + c] === undefined ? -1 : PLOT_AT[r * NC + c]);
  const secAt = (c, r) => SECTS.findIndex((s) => r >= 1 && r <= 4 && c >= s.c0 && c < s.c0 + 4);
  const PORTALS = [                                                              // y = ground contact of the rift; wave = the night it opens
    { x: 4095, y: 470, wave: 1, scale: 1, core: [[26, 1], [27, 1], [26, 2], [27, 2]] },
    { x: 195, y: 606, wave: 6, scale: 1, core: [[0, 2], [1, 2], [0, 3], [1, 3]], young: 1.3 },
    { x: 2220, y: 250, wave: 14, scale: 0.72, core: [[14, 0]], young: 1.5 }];
  const CORE = {}; PORTALS.forEach((p, i) => p.core.forEach(([c, r]) => (CORE[r * NC + c] = i)));
  const isCore = (c, r) => CORE[r * NC + c] !== undefined;
  const CART = { x: 1470, y: 905, c: 9, r: 5 };                                  // sell point (crops fly here)
  const HAND = { x: 1650, y: 1068 };                                             // flashlight hand, screen space
  // ---------------------------------------------------------------- balance (live/balance.cjs tunes these)
  const CROPS = [
    { id: 'wheat', name: 'Пшеница', seed: 2, grow: 9, sell: 5, xp: 1 },
    { id: 'carrot', name: 'Морковь', seed: 4, grow: 13, sell: 10, xp: 1 },
    { id: 'cabbage', name: 'Капуста', seed: 7, grow: 18, sell: 17, xp: 2 },
    { id: 'garlic', name: 'Лунный чеснок', seed: 8, grow: 16, sell: 13, xp: 2, ward: 1 },      // its bed can't be corrupted, nobody eats it
    { id: 'tomato', name: 'Помидоры', seed: 10, grow: 22, sell: 25, xp: 2 },
    { id: 'sunflower', name: 'Подсолнух', seed: 12, grow: 24, sell: 24, xp: 3, glow: 1 },     // glows when ripe: a small light
    { id: 'corn', name: 'Кукуруза', seed: 14, grow: 27, sell: 33, xp: 3 },
    { id: 'pumpkin', name: 'Тыква', seed: 20, grow: 33, sell: 48, xp: 4, gold: 0.05 },         // 5 %: a golden pumpkin (×5, +1 алмаз)
  ];
  const RESEARCH = [                                                             // XP unlocks; buildables then cost coins per piece
    { id: 'carrot', name: 'Морковь', xp: 10, crop: 1, desc: 'Новая культура' },
    { id: 'lamp', name: 'Фонарный столб', xp: 15, desc: 'Свет держит заразу' },
    { id: 'scarecrow', name: 'Пугало-фонарь', xp: 20, desc: 'Гоняет мелочь' },
    { id: 'salt', name: 'Соль', xp: 25, desc: 'Зараза не пройдёт' },
    { id: 'cabbage', name: 'Капуста', xp: 30, req: 'carrot', crop: 2, desc: 'Новая культура' },
    { id: 'garland', name: 'Гирлянда', xp: 30, req: 'lamp', desc: 'Дешёвый свет' },
    { id: 'garlic', name: 'Лунный чеснок', xp: 40, req: 'carrot', crop: 3, desc: 'Зараза не берёт' },
    { id: 'torch', name: 'Мощный фонарь', xp: 40, desc: 'Заряд и луч больше' },
    { id: 'tomato', name: 'Помидоры', xp: 50, req: 'cabbage', crop: 4, desc: 'Новая культура' },
    { id: 'sprinkler', name: 'Поливалка', xp: 55, desc: 'Рост ×1,5 рядом' },
    { id: 'autosow', name: 'Автопосев', xp: 65, desc: 'Сам сажает снова' },
    { id: 'sunflower', name: 'Подсолнух', xp: 70, req: 'tomato', crop: 5, desc: 'Светится ночью' },
    { id: 'generator', name: 'Генератор', xp: 85, req: 'lamp', desc: 'Свет ярче, не гаснет' },
    { id: 'corn', name: 'Кукуруза', xp: 90, req: 'tomato', crop: 6, desc: 'Новая культура' },
    { id: 'search', name: 'Прожектор', xp: 105, req: 'lamp', desc: 'Луч гоняет тварей' },
    { id: 'lamp2', name: 'Яркие лампы', xp: 120, req: 'generator', desc: 'Весь свет +25%' },
    { id: 'pumpkin', name: 'Тыква', xp: 135, req: 'corn', crop: 7, desc: 'Бывает золотая' },
    { id: 'gun', name: 'Ружьё', xp: 155, req: 'search', desc: 'Отстрел тварей' },
    { id: 'barn', name: 'Амбар', xp: 175, desc: 'Урожай +25%' },
    { id: 'torch2', name: 'Супер-фонарь', xp: 195, req: 'torch', desc: 'Ещё мощнее' },
    { id: 'turret', name: 'Турель', xp: 230, req: 'gun', desc: 'Стреляет сама' },
    { id: 'lamp3', name: 'Лампы Изнанки', xp: 280, req: 'lamp2', desc: 'Весь свет ещё +25%' },
    { id: 'gun2', name: 'Картечь', xp: 315, req: 'turret', desc: 'Бьёт по площади' },
  ];
  const KINDS = {                                                                // creature kinds: speed ×, fear to scare, hp, eat time (s), from wave
    mob: { sp: 1, fear: 1, hp: 1, eat: 2.0 }, big: { sp: 0.85, fear: 2.4, hp: 3, eat: 2.0 }, boss: { sp: 0.6, fear: 7, hp: 14, eat: 1.2 },
    jumper: { sp: 1.7, fear: 0.6, hp: 1, eat: 1.4 }, flyer: { sp: 1.25, fear: 0.9, hp: 1, eat: 2.2 }, digger: { sp: 0.9, fear: 1.2, hp: 2, eat: 2.6 },
    swarm: { sp: 1.05, fear: 0.25, hp: 1, eat: 3.0 } };
  const MODES = [
    { name: 'Лёгкий', spread: 0.55, spawns: 0.55, speed: 0.88, coins: 100, gems: 3, lose: 0.9 },
    { name: 'Нормальный', spread: 0.85, spawns: 0.85, speed: 1, coins: 50, gems: 2, lose: 0.66 },
    { name: 'Изнанка', spread: 1.12, spawns: 1.12, speed: 1.05, coins: 35, gems: 1, lose: 0.6 }];
  const WAVES = 20;
  const BAL = {
    day0: 28, day: 20,                                    // first calm day and the day between nights (s)
    night: (n) => 48 + 3 * n,                             // night length (s)
    units: (n) => Math.round(1.5 + 0.8 * n + 0.015 * n * n),   // creature groups per night (a swarm group = 5 swarmlings)
    mix: (n) => ({ big: n >= 6 ? 0.08 + 0.01 * n : 0, jumper: n >= 3 ? 0.22 : 0, swarm: n >= 4 ? 0.1 : 0, flyer: n >= 7 ? 0.13 : 0, digger: n >= 9 ? 0.1 : 0 }),
    spread: (n) => 0.06 * (1 + 0.06 * (n - 1)),           // corruption gain per s next to infected cells (×1…1.4 by how many)
    tended: 0.6,                                          // owned beds resist: their gain ×this
    dawn: [0.02, 0.05],                                    // by day corruption burns back per s: next to a rift … 8+ cells away
    surge: (n) => Math.max(8, 26 - 1.0 * n),              // each rift pushes a tendril every … s
    clean: { torch: 0.8, lamp: 0.3, garland: 0.22, search: 0.5, scarecrow: 0.2, sun: 0.15 },   // corruption removed per s at full light
    fear: { torch: 1.35, lamp: 0.55, garland: 0, search: 1.6, scarecrow: 0.3, sun: 0.2 },        // creature fear per s at full light
    smallFear: 6,                                         // scarecrows and sunflowers scare swarmlings and jumpers ×this
    torch: { r: [150, 190, 230], bat: [6, 10, 14], rate: 0.55 },
    lightR: { lamp: 205, garland: 120, scarecrow: 115, sun: 95 }, searchLen: 560, searchHalf: 0.21, genR: 380, sprinkR: 230, turretR: 340,
    lampUp: 0.25,                                         // lamp2 / lamp3: radius and strength + per level
    price: { lamp: [70, 35], garland: [35, 12], search: [320, 220], salt: [20, 4], scarecrow: [45, 15], sprinkler: [110, 60], generator: [260, 160],
      turret: [380, 220], barn: [500, 0], gun: 450, shot: 4, tshot: 1, med: 1, fix: 0.3, gem: [200, 80] },   // [base, + per placed]
    salt: { decay: 0.012 },                               // salt wears away per s per infected neighbour
    barn: 1.25, fair: 1.5, sprinkler: 1.5,
    creature: { speed: 74, fearGrow: 0.05, speedGrow: 0.03, smash: 3.0 },
    reward: { scare: 2, kill: 4, pop: 1, gemKill: 0.15, cleanGems: 1, waveCoins: 10, early: 1 },
    events: { from: 3, chance: 0.42 },                    // weather/event chance per night from wave …
  };
  // ---------------------------------------------------------------- UI layout (screen px; shared with the scene for hit tests)
  const SLOTS = ['seed0', 'seed1', 'seed2', 'seed3', 'seed4', 'seed5', 'seed6', 'seed7', 'build', 'med', 'gun', 'book'];
  const SLOT = { w: 86, h: 88, gap: 8, y: 982 }; SLOT.x0 = 150;
  const slotRect = (i) => [SLOT.x0 + i * (SLOT.w + SLOT.gap) + (i >= 8 ? 24 : 0) + (i >= 11 ? 24 : 0), SLOT.y, SLOT.w, SLOT.h];
  const BUILDS = ['lamp', 'garland', 'search', 'salt', 'scarecrow', 'sprinkler', 'generator', 'turret', 'barn'];
  const menuRect = (i) => [slotRect(8)[0] - 360 + i * 98, SLOT.y - 118, 90, 100];
  const NIGHT_BTN = [1060, 22, 200, 56], GEM_BTN = [588, 24, 50, 50], MAP = [1496, 14, 404, 92];
  const PANEL = { x: 330, y: 120, w: 1260, h: 820 };
  const cardRect = (i) => { const col = i % 6, row = Math.floor(i / 6), w = 196, h = 160; return [PANEL.x + 18 + col * (w + 8), PANEL.y + 92 + row * (h + 10), w, h]; };
  const CLOSE = [PANEL.x + PANEL.w - 74, PANEL.y + 18, 56, 56];
  const modeRect = (i) => [960 - 3 * 190 / 2 - 20 + i * 210, 560, 190, 200];
  const inR = (x, y, r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];

  // ---------------------------------------------------------------- state
  const rng = (S) => { let t = (S.rs = (S.rs + 0x6D2B79F5) | 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const L_hash = (a, b, c) => { const v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return v - Math.floor(v); };
  function create(seed = 7, mode = 1) {
    const M = MODES[mode], S = { t: 0, steps: 0, wt0: 0, rs: seed, ev: [], x: 1845, y: 560, sx: 960, sy: 560, cam: 885, press: 0, mode,
      coins: M.coins, xp: 0, gems: M.gems, xpTotal: 0, earned: 0, gemsBought: 0,
      wave: 0, phase: 'day', pt: 0, plen: BAL.day0, lostWave: 0, event: '', dayEvent: '', blackout: 0, bolt: 0,
      stats: { harvest: 0, sold: 0, scared: 0, killed: 0, lost: 0, eaten: 0, gold: 0 },
      tool: 'scythe', seed: 0, panel: 0, menu: 0, drag: '', res: {}, owned: { gun: 0 }, built: {}, sec: [1, 0, 0, 0],
      inf: Array(NC * NR).fill(0), flag: Array(NC * NR).fill(0), infT: 0, surge: [0, 0, 0],
      plots: PLOTS.map(() => ({ crop: -1, g: 0, dead: 0, from: null, hop: -9, gold: 0 })),
      props: [], mobs: [], fly: [], spawnQ: [], nid: 1, bat: BAL.torch.bat[0], batLock: 0, gunCd: 0, beam: 0, toast: null };
    BUILDS.forEach((k) => (S.built[k] = 0));
    openPortal(S, 0, true);
    for (let i = 0; i < 8; i++) { const p = S.plots[i]; p.crop = 0; p.g = rng(S) * CROPS[0].grow; }
    return S;
  }
  function openPortal(S, i, quiet) { for (const [c, r] of PORTALS[i].core) { S.inf[r * NC + c] = 1; S.flag[r * NC + c] = 1; } if (!quiet) say(S, 'portal', PORTALS[i].x, PORTALS[i].y - 150, { i }); }
  const portalOpen = (S, i) => S.wave >= PORTALS[i].wave || i === 0;
  const spawn = (worldT) => Object.assign(create(1 + (Math.floor(worldT * 1000) % 9973)), { wt0: worldT, phase: 'menu' });
  const has = (S, id) => !!S.res[id];
  const priceOf = (S, k) => (k === 'gun' ? BAL.price.gun : k === 'gem' ? BAL.price.gem[0] + BAL.price.gem[1] * S.gemsBought : BAL.price[k][0] + BAL.price[k][1] * S.built[k]);
  const cropUnlocked = (S, i) => i === 0 || has(S, CROPS[i].id);
  const say = (S, k, x, y, o = {}) => { S.ev.push(Object.assign({ k, t: S.t, x, y }, o)); if (S.ev.length > 128) S.ev.splice(0, S.ev.length - 128); };
  const toast = (S, txt) => { if (!S.toast || S.toast.txt !== txt || S.t - S.toast.t > 1.5) S.toast = { txt, t: S.t }; };
  const torchLvl = (S) => (has(S, 'torch2') ? 2 : has(S, 'torch') ? 1 : 0);
  const lampLvl = (S) => 1 + BAL.lampUp * ((has(S, 'lamp2') ? 1 : 0) + (has(S, 'lamp3') ? 1 : 0));
  const owned = (S, i) => !!S.sec[PLOTS[i].sec];
  const ownedCount = (S) => PLOTS.reduce((n, P, i) => n + (owned(S, i) ? 1 : 0), 0);
  const loseAt = (S) => Math.max(6, Math.ceil(ownedCount(S) * MODES[S.mode].lose));

  // ---------------------------------------------------------------- light
  const searchAng = (S, p) => p.a0 + Math.sin((S.wt0 + S.t) * 0.55 + p.ph) * 0.95;
  const torchR = (S) => BAL.torch.r[torchLvl(S)];
  const powered = (S, p) => S.props.some((g) => g.k === 'generator' && !g.broken && Math.hypot(g.x - p.x, g.y - p.y) < BAL.genR);
  const propOn = (S, p) => !p.broken && (!S.blackout || p.k === 'salt' || p.k === 'sprinkler' || p.k === 'barn' || p.k === 'generator' || powered(S, p));
  function lights(S) {                    // every light source this step → [kind, x, y, r, strength] (searchlights: cones)
    const fog = S.event === 'fog' && S.phase === 'night' ? 0.72 : 1, up = lampLvl(S), out = [];
    if (S.beam) out.push(['torch', S.x, S.y, torchR(S) * fog, 1]);
    for (const p of S.props) { if (!propOn(S, p)) continue; const gen = powered(S, p) ? 1.25 : 1;
      if (p.k === 'lamp' || p.k === 'garland' || p.k === 'scarecrow') out.push([p.k, p.x, p.y, BAL.lightR[p.k] * up * gen * fog, (p.k === 'lamp' ? 0.9 : 0.75) * Math.min(1.3, up * gen)]);
      else if (p.k === 'search') out.push(['search', p.x, p.y, BAL.searchLen * fog, Math.min(1.3, up * gen), searchAng(S, p)]); }
    S.plots.forEach((p, i) => { if (p.crop >= 0 && !p.dead && CROPS[p.crop].glow && p.g >= CROPS[p.crop].grow) out.push(['sun', PLOTS[i].x, PLOTS[i].y, BAL.lightR.sun * fog, 0.7]); });
    return out;
  }
  function lightAt(S, x, y, kind, LS) {   // → { l: max light 0..1, clean: corruption removed per s, fear: fear per s }
    let l = 0, clean = 0, fear = 0; const small = kind === 'swarm' || kind === 'jumper', tough = kind === 'big' || kind === 'boss';
    for (const s of LS || lights(S)) { const [k, sx, sy, R, str] = s; let v = 0;
      if (k === 'search') { const dx = x - sx, dy = (y - sy) * 1.15, d = Math.hypot(dx, dy); if (d < R && d > 20) { let da = Math.atan2(dy, dx) - s[5]; da = Math.atan2(Math.sin(da), Math.cos(da));
        v = Math.min(1, 1.6 * (1 - Math.abs(da) / BAL.searchHalf)) * (1 - 0.5 * d / R) * str; } }
      else { const d = Math.hypot(x - sx, (y - sy) * 1.15); v = Math.min(1, (k === 'torch' ? 1.25 : 1.3) * (1 - d / R)) * str; }
      if (v <= 0) continue;
      let f = BAL.fear[k]; if (small && (k === 'scarecrow' || k === 'sun')) f *= BAL.smallFear; if (tough && (k === 'lamp' || k === 'garland' || k === 'scarecrow')) f *= 0.35;
      l = Math.max(l, v); clean = Math.max(clean, v * BAL.clean[k]); fear = Math.max(fear, v * f); }
    return { l, clean, fear };
  }

  // ---------------------------------------------------------------- commands (UI clicks and the bot both land here)
  function command(S, cmd, x, y) {
    if (cmd.startsWith('mode:')) { const m = +cmd[5]; const n = create((S.rs & 0xffff) + 3, m); for (const k of Object.keys(S)) delete S[k]; Object.assign(S, n); say(S, 'ui', x, y); return; }
    if (cmd === 'book') { S.panel = S.panel ? 0 : 1; S.menu = 0; say(S, 'ui', x, y); return; }
    if (cmd === 'build') { S.menu = S.menu ? 0 : 1; say(S, 'ui', x, y); return; }
    if (cmd.startsWith('map:')) { S.cam = clamp(+cmd.slice(4) - VIEW.W / 2, 0, WORLD.W - VIEW.W); return; }
    if (cmd === 'gem') { const p = priceOf(S, 'gem'); if (S.coins < p) { toast(S, 'Алмаз стоит ' + p + ' монет'); return; } S.coins -= p; S.gems++; S.gemsBought++; say(S, 'gem', S.cam + 610, 50, { buy: p }); return; }
    if (cmd === 'night') { if (S.phase === 'day' && S.wave < WAVES) { const bonus = Math.floor((S.plen - S.pt) * BAL.reward.early); S.coins += bonus; if (bonus) say(S, 'coin', S.cam + 1160, 50, { v: bonus }); startNight(S); } return; }
    if (cmd.startsWith('seed')) { const i = +cmd[4]; if (cropUnlocked(S, i)) { S.seed = i; S.tool = 'scythe'; S.menu = 0; say(S, 'ui', x, y); } else toast(S, 'Изучи в книге: ' + CROPS[i].name); return; }
    if (BUILDS.includes(cmd)) { S.menu = 0; if (!has(S, cmd)) { toast(S, 'Сначала изучи в книге'); return; }
      if (cmd === 'barn' && S.built.barn) { toast(S, 'Амбар уже построен'); return; }
      S.tool = S.tool === cmd ? 'scythe' : cmd; say(S, 'ui', x, y); return; }
    if (cmd === 'med') { if (S.gems < BAL.price.med) { toast(S, 'Нужен алмаз'); return; } S.tool = S.tool === 'med' ? 'scythe' : 'med'; S.menu = 0; say(S, 'ui', x, y); return; }
    if (cmd === 'gun') { S.menu = 0; if (!has(S, 'gun')) { toast(S, 'Сначала изучи в книге'); return; }
      if (!S.owned.gun) { if (S.coins < BAL.price.gun) { toast(S, 'Ружьё стоит ' + BAL.price.gun); return; } S.coins -= BAL.price.gun; S.owned.gun = 1; say(S, 'buy', x, y); }
      S.tool = S.tool === 'gun' ? 'scythe' : 'gun'; say(S, 'ui', x, y); return; }
    if (cmd.startsWith('sec:')) { buySection(S, +cmd[4]); return; }
    if (cmd.startsWith('res:')) { const R = RESEARCH.find((r) => r.id === cmd.slice(4)); if (!R || has(S, R.id)) return;
      if (R.req && !has(S, R.req)) { toast(S, 'Сначала: ' + RESEARCH.find((r) => r.id === R.req).name); return; }
      if (S.xp < R.xp) { toast(S, 'Не хватает опыта'); return; }
      S.xp -= R.xp; S.res[R.id] = S.t; say(S, 'research', x, y, { id: R.id });
      if (R.id === 'torch' || R.id === 'torch2') S.bat = BAL.torch.bat[torchLvl(S)]; if (R.crop) S.seed = R.crop; return; }
  }
  function uiHit(S, x, y) {        // screen px → command string, 'none' (swallowed), or '' (the field)
    if (S.phase === 'menu') { for (let i = 0; i < 3; i++) if (inR(x, y, modeRect(i))) return 'mode:' + i; return 'none'; }
    if (S.panel) { if (inR(x, y, CLOSE)) return 'book'; for (let i = 0; i < RESEARCH.length; i++) if (inR(x, y, cardRect(i))) return 'res:' + RESEARCH[i].id;
      return inR(x, y, [PANEL.x, PANEL.y, PANEL.w, PANEL.h]) ? 'none' : 'book'; }
    if (S.menu) { for (let i = 0; i < BUILDS.length; i++) if (inR(x, y, menuRect(i))) return BUILDS[i]; }
    for (let i = 0; i < SLOTS.length; i++) if (inR(x, y, slotRect(i))) return SLOTS[i];
    if (S.phase === 'day' && S.wave < WAVES && inR(x, y, NIGHT_BTN)) return 'night';
    if (inR(x, y, GEM_BTN)) return 'gem';
    if (inR(x, y, MAP)) return 'map:' + Math.round((x - MAP[0]) / MAP[2] * WORLD.W);
    if (S.menu) { S.menu = 0; return 'none'; }
    return '';
  }

  // ---------------------------------------------------------------- field actions
  function buySection(S, si) { if (S.sec[si]) return; const pr = SECTS[si].price;
    if (S.coins < pr) { toast(S, 'Участок стоит ' + pr + ' монет'); return; }
    S.coins -= pr; S.sec[si] = 1; const [x, y] = cellXY(SECTS[si].c0 + 1.5, 2.5); say(S, 'buysec', x, y, { si });
    for (let r = 1; r <= 4; r++) for (let c = SECTS[si].c0; c < SECTS[si].c0 + 4; c++) { S.inf[r * NC + c] = 0; S.flag[r * NC + c] = 0; const p = S.plots[plotAt(c, r)]; Object.assign(p, { crop: -1, g: 0, dead: 0, from: null, hop: S.t }); } }   // freshly tilled: clean soil
  function plant(S, i) { const p = S.plots[i], C = CROPS[S.seed]; if (!owned(S, i) || p.crop >= 0 || p.dead || S.flag[PLOTS[i].r * NC + PLOTS[i].c]) return false;
    if (S.coins < C.seed) { toast(S, 'Не хватает монет на семена'); return false; }
    S.coins -= C.seed; p.crop = S.seed; p.g = 0; p.gold = 0; p.hop = S.t; say(S, 'plant', PLOTS[i].x, PLOTS[i].y, { c: S.seed }); return true; }
  function sellPoint(S) { const b = S.props.find((p) => p.k === 'barn'); return b ? { x: b.x, y: b.y - 40 } : CART; }
  function harvest(S, i) { const p = S.plots[i];
    if (p.dead) { if (S.flag[PLOTS[i].r * NC + PLOTS[i].c]) return false; p.dead = 0; p.from = null; p.hop = S.t; say(S, 'clear', PLOTS[i].x, PLOTS[i].y); return true; }
    if (p.crop < 0 || p.g < CROPS[p.crop].grow) return false;
    const c = p.crop, sp = sellPoint(S), d = Math.hypot(sp.x - PLOTS[i].x, sp.y - PLOTS[i].y);
    S.fly.push({ c, gold: p.gold, x: PLOTS[i].x, y: PLOTS[i].y - 20, t0: S.t, dur: 0.55 + d / 2600, tx: sp.x, ty: sp.y }); S.stats.harvest++;
    say(S, 'harvest', PLOTS[i].x, PLOTS[i].y, { c }); p.crop = -1; p.g = 0; p.hop = S.t; p.gold = 0;
    if (has(S, 'autosow')) { const keep = S.seed; S.seed = c; plant(S, i); S.seed = keep; }
    return true; }
  function medicine(S, x, y) { const cr = cellAt(x, y); if (!cr || S.gems < BAL.price.med) return false;
    S.gems -= BAL.price.med; say(S, 'med', x, y);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const c = cr[0] + dc, r = cr[1] + dr; if (c < 0 || c >= NC || r < 0 || r >= NR || isCore(c, r)) continue;
      S.inf[r * NC + c] = 0; S.flag[r * NC + c] = 0; const pi = plotAt(c, r);
      if (pi >= 0 && S.plots[pi].dead && S.plots[pi].from) { const p = S.plots[pi]; p.crop = p.from.crop; p.g = p.from.g; p.dead = 0; p.from = null; p.hop = S.t; say(S, 'cure', PLOTS[pi].x, PLOTS[pi].y); } }
    S.tool = 'scythe'; return true; }
  const buildable = (S, c, r) => c >= 0 && c < NC && r >= 0 && r < NR && plotAt(c, r) < 0 && !isCore(c, r) && !(c === CART.c && r === CART.r)
    && !S.props.some((p) => p.c === c && p.r === r);
  function build(S, k, x, y) { const cr = cellAt(x, y); if (!cr || !buildable(S, cr[0], cr[1])) { toast(S, 'Ставить можно на траву и землю'); return false; }
    const price = priceOf(S, k); if (S.coins < price) { toast(S, 'Не хватает монет'); return false; }
    const [cx, cy] = cellXY(cr[0], cr[1]); S.coins -= price; S.built[k]++;
    const P = PORTALS.reduce((a, p) => (Math.abs(p.x - cx) < Math.abs(a.x - cx) ? p : a));
    S.props.push({ k, c: cr[0], r: cr[1], x: cx, y: cy + (k === 'salt' ? 0 : cr[1] === 0 ? 62 : 30), t0: S.t, a0: Math.atan2(P.y - cy, P.x - cx), ph: rng(S) * 6.28, hp: 1, cd: 0 });
    if (k === 'salt') { S.inf[cr[1] * NC + cr[0]] = 0; S.flag[cr[1] * NC + cr[0]] = 0; }
    say(S, 'build', cx, cy + 30, { kind: k }); if (S.coins < priceOf(S, k) || k === 'barn') S.tool = 'scythe'; return true; }
  function repair(S, x, y) { const p = S.props.find((q) => q.broken && Math.abs(q.x - x) < 60 && y > q.y - 170 && y < q.y + 30); if (!p) return false;
    const cost = Math.round(BAL.price[p.k][0] * BAL.price.fix); if (S.coins < cost) { toast(S, 'Ремонт: ' + cost + ' монет'); return true; }
    S.coins -= cost; p.broken = 0; p.t0 = S.t; say(S, 'fix', p.x, p.y - 80, { v: cost }); return true; }
  function damage(S, m, n, src) { if (m.st === 'die' || m.under) return; m.hp -= n; m.hit = S.t;
    if (m.hp <= 0) { m.st = 'die'; m.t0 = S.t; S.stats.killed++; const big = m.kind === 'big' || m.kind === 'boss'; const xp = BAL.reward.kill * (m.kind === 'boss' ? 10 : big ? 2 : 1);
      S.xp += xp; S.xpTotal += xp; say(S, 'kill', m.x, m.y - (m.alt || 0), { kind: m.kind });
      if (rng(S) < BAL.reward.gemKill * (m.kind === 'boss' ? 20 : big ? 3 : 1)) { S.gems++; say(S, 'gem', m.x, m.y - 60); } }
    else m.fear += 0.5 * m.fearMax; }
  function shoot(S, x, y) { if (S.gunCd > 0) return; if (S.coins < BAL.price.shot) { toast(S, 'Нет монет на патроны'); return; }
    S.coins -= BAL.price.shot; S.gunCd = 0.55; const R = has(S, 'gun2') ? 95 : 0;
    let best = null, bd = 70, hit = 0;
    for (const m of S.mobs) { if (m.st === 'die' || m.under) continue; const d = Math.hypot(m.x - x, m.y - (m.alt || 0) - 60 * m.sz - y);
      if (R && d < R) { damage(S, m, 1); hit = 1; } else if (d < bd + 30 * (m.sz - 1)) { bd = d; best = m; } }
    if (best && !R) { damage(S, best, 1); hit = 1; } else if (best && R && !hit) damage(S, best, 1);
    say(S, 'shot', x, y, { hit, wide: R ? 1 : 0 }); }

  // ---------------------------------------------------------------- waves and events
  function startNight(S) { S.wave++; S.phase = 'night'; S.pt = 0; S.plen = BAL.night(S.wave); S.lostWave = 0; S.dayEvent = ''; S.menu = 0;
    PORTALS.forEach((p, i) => { if (i && p.wave === S.wave) openPortal(S, i); });
    S.surge = PORTALS.map(() => BAL.surge(S.wave) * (0.4 + 0.4 * rng(S)));
    // event of the night
    S.event = ''; if (S.wave === WAVES) S.event = 'bloodmoon';
    else if (S.wave >= BAL.events.from && rng(S) < BAL.events.chance) S.event = ['bloodmoon', 'fog', 'storm', 'blackout'][Math.floor(rng(S) * 4)];
    if (S.event === 'blackout' && !has(S, 'lamp')) S.event = 'fog';
    S.bolt = 4 + rng(S) * 4; S.blackout = 0;
    const M = MODES[S.mode], blood = S.event === 'bloodmoon' ? 1.3 : 1, n = Math.max(1, Math.round(BAL.units(S.wave) * M.spawns * blood)), mix = BAL.mix(S.wave), win = S.plen - 14; S.spawnQ = [];
    const open = PORTALS.map((p, i) => i).filter((i) => portalOpen(S, i));
    for (let i = 0; i < n; i++) { let kind = 'mob', r = rng(S);
      for (const k of ['big', 'jumper', 'swarm', 'flyer', 'digger']) { if (r < mix[k]) { kind = k; break; } r -= mix[k]; }
      const pi = open[Math.floor(rng(S) * open.length)], t0 = 3 + win * (i + 0.7 * rng(S)) / n;
      if (kind === 'swarm') for (let j = 0; j < 4; j++) S.spawnQ.push({ t: t0 + j * 0.25, kind, pi });
      else S.spawnQ.push({ t: t0, kind, pi }); }
    if (S.wave === 10 || S.wave === WAVES) S.spawnQ.push({ t: S.plen * 0.4, kind: 'boss', pi: 0 });
    if (S.wave === WAVES) S.spawnQ.push({ t: S.plen * 0.55, kind: 'boss', pi: 1 });
    S.spawnQ.sort((a, b) => a.t - b.t); say(S, 'wave', S.cam + 960, 300, { n: S.wave, event: S.event }); }
  function endNight(S) {
    for (const m of S.mobs) if (m.st !== 'die') { m.st = 'flee'; m.fear = 99; m.under = 0; }
    const g = S.lostWave === 0 ? BAL.reward.cleanGems : 0, c = BAL.reward.waveCoins * S.wave;
    S.gems += g; S.coins += c; S.event = ''; S.blackout = 0; say(S, 'dawn', S.cam + 960, 300, { gems: g, coins: c, clean: S.lostWave === 0 });
    if (S.wave >= WAVES) { S.phase = 'won'; S.pt = 0; say(S, 'won', S.cam + 960, 400); return; }
    S.phase = 'day'; S.pt = 0; S.plen = BAL.day; S.dayEvent = S.wave >= 2 && rng(S) < 0.22 ? 'fair' : '';
    if (S.dayEvent) say(S, 'fair', S.cam + 960, 300); }
  function stepEvents(S) {
    if (S.phase !== 'night') return;
    if (S.event === 'blackout') { const on = S.pt > S.plen * 0.3 && S.pt < S.plen * 0.62; if (on !== !!S.blackout) { S.blackout = on ? 1 : 0; say(S, on ? 'blackout' : 'power', S.cam + 960, 300); } }
    if (S.event === 'storm') { S.bolt -= DT; if (S.bolt <= 0) { S.bolt = 5 + rng(S) * 6;
      const c = 2 + Math.floor(rng(S) * (NC - 4)), r = Math.floor(rng(S) * NR), [x, y] = cellXY(c, r); say(S, 'bolt', x, y);
      for (const m of S.mobs) if (!m.under && m.st !== 'die') m.fear += 0.5 * m.fearMax;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= NC || rr < 0 || rr >= NR || isCore(cc, rr)) continue; S.inf[rr * NC + cc] *= 0.4; } } }
  }

  // ---------------------------------------------------------------- creatures
  function pickTarget(S, m, LS) { let best = -1, bs = 1e9;
    S.plots.forEach((p, i) => { if (!owned(S, i) || p.crop < 0 || p.dead || (CROPS[p.crop].ward && m.kind !== 'boss')) return;
      if (S.mobs.some((o) => o !== m && o.tgt === i && o.st !== 'flee' && o.st !== 'die')) return;
      const P = PLOTS[i], d = Math.hypot(P.x - m.x, P.y - m.y), ripe = p.g >= CROPS[p.crop].grow ? 0.75 : 1;
      const s = d * ripe + 700 * lightAt(S, P.x, P.y, m.kind, LS).l; if (s < bs) { bs = s; best = i; } });
    return best; }
  function newMob(S, q) { const P = PORTALS[q.pi], K = KINDS[q.kind], M = MODES[S.mode], blood = S.event === 'bloodmoon' ? 1.5 : 1;
    const hp = q.kind === 'boss' ? (S.wave >= WAVES ? 24 : 14) : K.hp;
    const m = { id: S.nid++, kind: q.kind, pi: q.pi, x: P.x + (rng(S) - 0.5) * 60, y: P.y + 8 + (rng(S) - 0.5) * 30, st: 'emerge', t0: S.t, fear: 0, hp,
      fearMax: K.fear * (1 + BAL.creature.fearGrow * (S.wave - 1)) * blood, tgt: -1, face: P.x > 1920 ? -1 : 1, dist: 0, side: rng(S) < 0.5 ? -1 : 1, hit: -9, lit: -9, ph: rng(S),
      sz: { mob: 1, big: 1.3, boss: S.wave >= WAVES ? 2 : 1.75, jumper: 0.85, flyer: 0.8, digger: 1, swarm: 0.42 }[q.kind], alt: q.kind === 'flyer' ? 130 : 0, under: q.kind === 'digger' ? 1 : 0 };
    if (q.kind === 'digger') m.st = 'burrow';
    S.mobs.push(m); say(S, 'spawn', P.x, P.y - 100, { boss: q.kind === 'boss', kind: q.kind, pi: q.pi }); }
  function stepMob(S, m, LS) {
    const K = KINDS[m.kind], age = S.t - m.t0, M = MODES[S.mode], blood = S.event === 'bloodmoon' ? 1.25 : 1;
    const sp = BAL.creature.speed * (1 + BAL.creature.speedGrow * (S.wave - 1)) * K.sp * M.speed * blood;
    if (m.st === 'die') { if (age > 1.6) m.gone = 1; return; }
    const home = PORTALS[m.pi];
    // fear from light (diggers are safe underground)
    if (m.st !== 'flee' && m.st !== 'dive' && !m.under) { const Lt = lightAt(S, m.x, m.y - m.alt - 40 * m.sz, m.kind, LS);
      if (Lt.fear > 0) { m.fear += Lt.fear * DT; m.lit = S.t; } else m.fear = Math.max(0, m.fear - 0.35 * DT);
      if (m.fear >= m.fearMax) {
        if (m.kind === 'swarm') { m.st = 'die'; m.t0 = S.t; S.stats.killed++; S.xp += BAL.reward.pop; S.xpTotal += BAL.reward.pop; say(S, 'pop', m.x, m.y - 20); return; }
        m.st = m.kind === 'digger' ? 'dive' : 'flee'; m.t0 = S.t; m.tgt = -1; m.prop = null; S.stats.scared++; S.xp += BAL.reward.scare; S.xpTotal += BAL.reward.scare; say(S, 'scare', m.x, m.y - m.alt - 80 * m.sz); } }
    if (m.st === 'emerge') { if (age > 1.1) { m.st = 'seek'; m.t0 = S.t; } return; }
    if (m.st === 'dive') { if (age > 0.6) { m.under = 1; m.st = m.fear >= m.fearMax ? 'flee' : 'burrow'; m.t0 = S.t; } return; }
    if (m.st === 'surface') { if (age > 0.8) { m.st = 'eat'; m.t0 = S.t; say(S, 'growl', m.x, m.y); } return; }
    let tx = home.x, ty = home.y + 10, v = sp;
    // big ones smash lights first
    if (m.st === 'seek' && (m.kind === 'big' || m.kind === 'boss') && !m.prop) { const p = S.props.find((q) => !q.broken && q.k !== 'salt' && !S.mobs.some((o) => o.prop === q) && Math.hypot(q.x - m.x, q.y - m.y) < 230); if (p) m.prop = p; }
    if (m.st === 'seek' && m.prop) { const p = m.prop; if (p.broken) { m.prop = null; return; }
      const dx = p.x + 40 - m.x, dy = p.y + 6 - m.y, d = Math.hypot(dx, dy);
      if (d < 8) { m.st = 'smash'; m.t0 = S.t; m.face = -1; say(S, 'growl', m.x, m.y); return; }
      const st = Math.min(d, sp * DT); m.x += dx / d * st; m.y += dy / d * st; m.dist += st; m.face = dx < 0 ? -1 : 1; return; }
    if (m.st === 'smash') { if (age >= BAL.creature.smash) { if (m.prop) { m.prop.broken = 1; say(S, 'smash', m.prop.x, m.prop.y - 80, { kind: m.prop.k }); } m.prop = null; m.st = 'seek'; m.t0 = S.t; } return; }
    if (m.st === 'seek' || m.st === 'burrow') { if (m.tgt < 0 || S.plots[m.tgt].crop < 0 || S.plots[m.tgt].dead) m.tgt = pickTarget(S, m, LS);
      if (m.tgt < 0) { tx = home.x + (home.x > 1920 ? -260 : 260); ty = home.y + 40 * Math.sin(S.t + m.id); v = sp * 0.5; }
      else { const P = PLOTS[m.tgt]; tx = P.x + (m.kind === 'flyer' || m.kind === 'digger' ? 0 : 54 * m.side * m.sz); ty = P.y + (m.kind === 'flyer' ? 30 : 18);
        if (Math.hypot(tx - m.x, ty - m.y) < 10) { if (m.st === 'burrow') { m.st = 'surface'; m.under = 0; m.t0 = S.t; say(S, 'dig', m.x, m.y); }
          else { m.st = 'eat'; m.t0 = S.t; m.face = m.kind === 'flyer' ? m.face : -m.side; say(S, 'growl', m.x, m.y); } return; } }
      const cr = cellAt(m.x, m.y);
      if (cr && m.kind !== 'flyer' && !m.under) { if (S.flag[cr[1] * NC + cr[0]]) v *= 1.3; if (S.props.some((p) => p.k === 'salt' && p.c === cr[0] && p.r === cr[1])) v *= 0.4; } }
    else if (m.st === 'eat') { const p = S.plots[m.tgt];
      if (!p || p.crop < 0 || p.dead) { m.st = m.kind === 'digger' ? 'dive' : 'seek'; m.t0 = S.t; m.tgt = -1; return; }
      if (age >= K.eat) { const P = PLOTS[m.tgt], k = P.r * NC + P.c;
        if (m.kind === 'flyer') { S.inf[k] = Math.min(0.99, S.inf[k] + 0.5); say(S, 'spit', P.x, P.y); }        // flyers poison the bed instead of eating
        else { say(S, 'eat', P.x, P.y, { c: p.crop }); S.stats.eaten++; p.crop = -1; p.g = 0; p.hop = S.t; p.gold = 0; S.inf[k] = Math.min(0.99, S.inf[k] + (m.kind === 'boss' ? 0.8 : 0.3)); }
        m.st = m.kind === 'digger' ? 'dive' : 'seek'; m.t0 = S.t; m.tgt = -1; }
      return; }
    else if (m.st === 'flee') { v = sp * 1.7; if (Math.hypot(home.x - m.x, home.y + 10 - m.y) < 30) { m.gone = 1; if (!m.under) say(S, 'vanish', m.x, m.y); return; } }
    if (m.kind === 'jumper' && m.st !== 'flee') { const hop = Math.sin(Math.PI * ((m.dist / 70) % 1)); v *= 0.4 + 1.2 * hop; }
    const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy) || 1, stp = Math.min(d, v * DT);
    m.x += dx / d * stp; m.y += dy / d * stp; m.dist += stp; if (Math.abs(dx) > 2) m.face = dx < 0 ? -1 : 1;
  }
  function stepTurrets(S) {
    for (const p of S.props) { if (p.k !== 'turret' || !propOn(S, p)) continue; p.cd = Math.max(0, p.cd - DT); if (p.cd > 0) continue;
      let best = null, bd = BAL.turretR; for (const m of S.mobs) { if (m.st === 'die' || m.st === 'flee' || m.under || m.st === 'emerge') continue; const d = Math.hypot(m.x - p.x, m.y - p.y); if (d < bd) { bd = d; best = m; } }
      if (!best || S.coins < BAL.price.tshot) continue; S.coins -= BAL.price.tshot; p.cd = 1.2; p.aim = Math.atan2(best.y - best.alt - 50 * best.sz - (p.y - 70), best.x - p.x);
      say(S, 'tshot', p.x, p.y - 70, { tx: best.x, ty: best.y - best.alt - 50 * best.sz }); damage(S, best, 1); }
  }

  // ---------------------------------------------------------------- corruption (field) at 20 Hz
  function stepField(S, dt, LS) {
    const night = S.phase === 'night', rate = BAL.spread(Math.max(1, S.wave)) * MODES[S.mode].spread, add = [];
    const salt = {}; for (const p of S.props) if (p.k === 'salt') salt[p.r * NC + p.c] = p;
    for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) { const k = r * NC + c; if (isCore(c, r)) continue;
      if (salt[k]) { let n = 0; for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const cc = c + dc, rr = r + dr; if (cc >= 0 && cc < NC && rr >= 0 && rr < NR && S.flag[rr * NC + cc]) n++; }
        if (night) salt[k].hp -= BAL.salt.decay * n * dt; if (salt[k].hp <= 0) { salt[k].gone = 1; say(S, 'saltgone', salt[k].x, salt[k].y); } add.push([k, 0, c, r]); continue; }
      const [x, y] = cellXY(c, r), Lt = lightAt(S, x, y, '', LS);
      let n = 0, o = 0; for (const [dc, dr, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 0.3], [-1, 1, 0.3], [1, -1, 0.3], [-1, -1, 0.3]]) {
        const cc = c + dc, rr = r + dr; if (cc >= 0 && cc < NC && rr >= 0 && rr < NR && S.flag[rr * NC + cc]) { n += w; if (w === 1) o++; } }
      let v = S.inf[k];
      const gain = night && n > 0 ? rate * (0.6 + 0.4 * Math.min(2, n)) * (0.75 + 0.5 * L_hash(c, r, Math.floor(S.t / 4))) : 0;
      const pi = plotAt(c, r), tend = pi >= 0 && owned(S, pi) ? BAL.tended : 1;
      v += (gain * tend - Lt.clean) * dt;
      if (!night && (S.flag[k] || v > 0)) { const dc = Math.min(...PORTALS.map((P, i) => (portalOpen(S, i) ? Math.hypot(x - P.x, y - P.y) : 1e9))) / CW; v -= (BAL.dawn[0] + (BAL.dawn[1] - BAL.dawn[0]) * Math.min(1, dc / 8)) * dt * (o <= 3 ? 1 : 0.25); }
      if (pi >= 0 && S.plots[pi].crop >= 0 && CROPS[S.plots[pi].crop].ward) v = Math.min(v, 0.9);        // moon garlic
      add.push([k, Math.max(0, Math.min(1, v)), c, r]); }
    if (S.props.some((p) => p.gone)) S.props = S.props.filter((p) => !p.gone);
    for (const [k, v, c, r] of add) { const was = S.flag[k]; S.inf[k] = v;
      if (!was && v >= 1) { S.flag[k] = 1; const pi = plotAt(c, r); const [x, y] = cellXY(c, r); say(S, 'infect', x, y);
        if (pi >= 0 && owned(S, pi)) { const p = S.plots[pi]; if (p.crop >= 0 && !p.dead) { p.from = { crop: p.crop, g: p.g }; p.dead = 1; p.crop = -1; } else if (!p.dead) { p.dead = 1; p.from = null; }
          S.lostWave++; S.stats.lost++; say(S, 'plotlost', x, y); } }
      else if (was && v <= 0.35) { S.flag[k] = 0; const [x, y] = cellXY(c, r); say(S, 'cleanse', x, y); } }
    if (night) PORTALS.forEach((P, pi) => { if (!portalOpen(S, pi)) return; S.surge[pi] -= dt; if (S.surge[pi] > 0) return; S.surge[pi] = BAL.surge(S.wave) * (P.young || 1) * (0.7 + 0.6 * rng(S));
      let best = null, bd = 1e9; for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) { const k = r * NC + c; if (S.flag[k] || isCore(c, r)) continue;
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => c + a >= 0 && c + a < NC && r + b >= 0 && r + b < NR && S.flag[(r + b) * NC + c + a]);
        if (!nb) continue; const [x, y] = cellXY(c, r); if (lightAt(S, x, y, '', LS).l > 0.2 || salt[k]) continue; const d = Math.hypot(x - P.x, y - P.y) + 400 * rng(S); if (d < bd) { bd = d; best = k; } }
      if (best !== null) { S.inf[best] = Math.max(S.inf[best], 0.97); const [x, y] = cellXY(best % NC, Math.floor(best / NC)); say(S, 'surge', x, y); } });
  }
  const infectedPlots = (S) => PLOTS.reduce((n, P, i) => n + (owned(S, i) && S.flag[P.r * NC + P.c] ? 1 : 0), 0);

  // ---------------------------------------------------------------- step
  function step(S, inp) {
    const t = S.t + DT;
    // camera and pointer: screen px from the page, or world px from the bot
    if (inp.wx !== undefined) { S.x = inp.wx; S.y = inp.wy; S.cam = clamp(inp.cam !== undefined ? inp.cam : S.x - VIEW.W / 2, 0, WORLD.W - VIEW.W); S.sx = S.x - S.cam; S.sy = S.y; }
    else { if (inp.px !== undefined) { S.sx = inp.px; S.sy = inp.py; }
      const pan = (inp.right ? 1 : 0) - (inp.left ? 1 : 0) + (S.phase !== 'menu' && !S.panel && inp.px !== undefined && S.sy > 120 && S.sy < SLOT.y - 130 ? (S.sx > VIEW.W - 26 ? 1 : S.sx < 26 ? -1 : 0) : 0);
      if (pan && !S.panel) S.cam = clamp(S.cam + pan * 1500 * DT, 0, WORLD.W - VIEW.W);
      S.x = S.sx + S.cam; S.y = S.sy; }
    for (const k of inp.kp || []) { const d = /^Digit([1-8])$/.exec(k); if (d) command(S, 'seed' + (+d[1] - 1), S.x, S.y);
      if (k === 'KeyB' || k === 'Tab') command(S, 'book', S.x, S.y); if (k === 'KeyQ') command(S, 'build', S.x, S.y); if (k === 'KeyG') command(S, 'gun', S.x, S.y);
      if (k === 'KeyM') command(S, 'med', S.x, S.y); if (k === 'KeyN') command(S, 'night', S.x, S.y); if (k === 'Escape') { S.menu = 0; S.panel = 0; if (S.tool !== 'scythe') S.tool = 'scythe'; } }
    if (inp.cmd) command(S, inp.cmd, S.x, S.y);
    if (S.phase === 'menu') { if (inp.click) { const u = uiHit(S, S.sx, S.sy); if (u && u !== 'none') command(S, u, S.x, S.y); } S.t = t; S.steps++; return S; }
    if (S.phase === 'won' || S.phase === 'lost') { S.pt += DT; S.beam = 0; S.t = t; S.steps++;
      if (inp.click && S.pt > 1.2) { const n = Object.assign(create((S.rs & 0xffff) + 1), { phase: 'menu', wt0: S.wt0 || 0 }); for (const k of Object.keys(S)) delete S[k]; Object.assign(S, n); }
      return S; }
    if (inp.click) { const u = uiHit(S, S.sx, S.sy);                                  // clicks: UI first, then the field
      if (u) { if (u !== 'none') command(S, u, S.x, S.y); S.drag = 'ui'; }
      else if (S.tool === 'med') { medicine(S, S.x, S.y); S.drag = 'ui'; }
      else if (BUILDS.includes(S.tool)) { build(S, S.tool, S.x, S.y); S.drag = S.tool === 'salt' ? 'salt' : 'ui'; }
      else if (S.tool === 'gun') { shoot(S, S.x, S.y); S.drag = 'gun'; }
      else if (repair(S, S.x, S.y)) S.drag = 'ui';
      else { const cr = cellAt(S.x, S.y), pi = cr ? plotAt(cr[0], cr[1]) : -1, si = cr ? secAt(cr[0], cr[1]) : -1;
        if (si >= 0 && !S.sec[si]) { buySection(S, si); S.drag = 'ui'; }
        else { S.drag = pi >= 0 && S.plots[pi].crop < 0 && !S.plots[pi].dead ? 'plant' : 'reap';
          if (pi >= 0) { if (S.drag === 'plant') plant(S, pi); else harvest(S, pi); } } } }
    if (!inp.press) S.drag = '';
    S.press = inp.press ? 1 : 0;
    if (S.panel) { S.t = t; S.steps++; S.beam = 0; return S; }                         // the research book pauses the world
    if (S.drag === 'reap' || S.drag === 'plant') { const cr = cellAt(S.x, S.y), pi = cr ? plotAt(cr[0], cr[1]) : -1;
      if (pi >= 0 && Math.abs(S.x - PLOTS[pi].x) < 70 && Math.abs(S.y - PLOTS[pi].y) < 64) { if (S.drag === 'reap') harvest(S, pi); else plant(S, pi); } }
    if (S.drag === 'salt' && S.tool === 'salt') { const cr = cellAt(S.x, S.y); if (cr && buildable(S, cr[0], cr[1]) && S.coins >= priceOf(S, 'salt')) build(S, 'salt', S.x, S.y); }   // salt is poured by dragging
    if (S.drag === 'gun' && S.tool === 'gun' && S.gunCd <= 0 && inp.press) shoot(S, S.x, S.y);
    S.gunCd = Math.max(0, S.gunCd - DT);
    // flashlight
    const want = inp.alt && S.sy < SLOT.y - 10 && S.sy > 100 ? 1 : 0, batMax = BAL.torch.bat[torchLvl(S)];
    if (want && !S.batLock && S.bat > 0) { if (!S.beam) say(S, 'click', S.x, S.y); S.beam = 1; S.bat = Math.max(0, S.bat - DT); if (S.bat <= 0) { S.batLock = 1; S.beam = 0; say(S, 'empty', S.cam + HAND.x, HAND.y); } }
    else { S.beam = 0; S.bat = Math.min(batMax, S.bat + BAL.torch.rate * DT); if (S.batLock && S.bat >= batMax * 0.35) S.batLock = 0; }
    // growth (sprinklers, rain)
    const rain = S.event === 'storm' && S.phase === 'night' ? 1.25 : 1, sprk = S.props.filter((p) => p.k === 'sprinkler' && propOn(S, p));
    S.plots.forEach((p, i) => { if (p.crop < 0 || p.dead) return; const C = CROPS[p.crop], was = p.g < C.grow, P = PLOTS[i];
      const k = rain * (sprk.some((s) => Math.hypot(s.x - P.x, s.y - 30 - P.y) < BAL.sprinkR) ? BAL.sprinkler : 1); p.g += DT * k;
      if (was && p.g >= C.grow) { p.ripe = t; if (C.gold && rng(S) < C.gold) { p.gold = 1; say(S, 'golden', P.x, P.y - 40); } } });
    // flying crops → sale
    const mult = (S.built.barn ? BAL.barn : 1) * (S.dayEvent === 'fair' && S.phase === 'day' ? BAL.fair : 1);
    S.fly = S.fly.filter((f) => { if (t - f.t0 < f.dur) return true; const C = CROPS[f.c], v = Math.round(C.sell * mult * (f.gold ? 5 : 1));
      S.coins += v; S.xp += C.xp; S.xpTotal += C.xp; S.earned += v; S.stats.sold++; if (f.gold) { S.gems++; S.stats.gold++; say(S, 'gem', f.tx, f.ty - 90); }
      say(S, 'sell', f.tx, f.ty - 60, { v, xp: C.xp, c: f.c }); return false; });
    // phases
    S.pt += DT;
    if (S.phase === 'day' && S.pt >= S.plen) startNight(S);
    else if (S.phase === 'night') { while (S.spawnQ.length && S.spawnQ[0].t <= S.pt) newMob(S, S.spawnQ.shift()); if (S.pt >= S.plen) endNight(S); }
    stepEvents(S);
    const LS = lights(S);
    S.infT += DT; if (S.infT >= 0.05) { stepField(S, S.infT, LS); S.infT = 0; }
    for (const m of S.mobs) stepMob(S, m, LS);
    stepTurrets(S);
    S.mobs = S.mobs.filter((m) => !m.gone);
    if (infectedPlots(S) >= loseAt(S) && S.phase !== 'lost') { S.phase = 'lost'; S.pt = 0; say(S, 'lost', S.cam + 960, 400); }
    S.t = t; S.steps++; return S;
  }

  // ---------------------------------------------------------------- bot: plays the attract demo and the balance runs (world coords)
  // skill: react (s between decisions), speed (cursor px/s), lapse (chance to stay on its chore), build (spends), reserve, early
  function botInput(S, B) {
    const sk = B.skill || { react: 0.18, speed: 2600, build: 1 };
    if (B.x === undefined) { B.x = S.x; B.y = S.y; B.next = 0; B.goal = null; B.cam = S.cam; }
    const inp = { wx: B.x, wy: B.y, cam: B.cam, press: 0, click: 0, alt: 0 };
    if (S.phase === 'menu') { inp.cmd = 'mode:' + (sk.mode === undefined ? 1 : sk.mode); return inp; }
    if (S.panel) { inp.cmd = 'book'; return inp; }
    if (S.t >= B.next) { B.next = S.t + sk.react * (0.6 + 0.8 * L_hash(S.steps, 3, 9));
      if (!(sk.lapse && B.goal && L_hash(S.steps, 7, 1) < sk.lapse)) { const g = decide(S, sk, B); if (!(B.goal && g.k === B.goal.k && g.x === B.goal.x && g.y === B.goal.y && !g.cmd)) B.goal = g; } }
    const g = B.goal; if (!g) return inp;
    const dx = g.x - B.x, dy = g.y - B.y, d = Math.hypot(dx, dy), stp = Math.min(d, sk.speed * DT);
    if (d > 0.5) { B.x += dx / d * stp; B.y += dy / d * stp; }
    const want = clamp(B.x - VIEW.W / 2, 0, WORLD.W - VIEW.W); if (Math.abs(want - B.cam) > 520) B.cam += clamp(want - B.cam, -2600 * DT, 2600 * DT);   // the camera follows lazily
    Object.assign(inp, { wx: B.x, wy: B.y, cam: B.cam });
    const near = d < 30;
    if (g.k === 'light') inp.alt = near ? 1 : 0;
    if (B.heldGoal !== g) { B.held = 0; B.heldGoal = g; }
    if (g.k === 'reap' || g.k === 'plant') { inp.press = near && B.held !== 2 ? 1 : 0; if (near && !B.held) { inp.click = 1; B.held = 1; } else if (near && B.held === 1 && g.k === 'plant' && S.drag === 'reap') B.held = 2; if (!near) B.held = 0; } else B.held = 0;
    if ((g.k === 'build' || g.k === 'med' || g.k === 'shoot' || g.k === 'fix') && near && !g.done) { inp.click = 1; g.done = 1; }
    if (g.cmd && !g.sent) { inp.cmd = g.cmd; g.sent = 1; }
    return inp;
  }
  const WANT = ['lamp', 'carrot', 'salt', 'cabbage', 'scarecrow', 'torch', 'garlic', 'tomato', 'autosow', 'garland', 'sprinkler', 'generator', 'search', 'sunflower', 'corn',
    'lamp2', 'gun', 'pumpkin', 'barn', 'turret', 'torch2', 'lamp3', 'gun2'];
  function decide(S, sk, B) {
    const C = (cmd) => ({ k: 'cmd', x: B.x, y: B.y, cmd }), LS = lights(S);
    for (const id of WANT) { const R = RESEARCH.find((r) => r.id === id); if (has(S, id)) continue; if ((!R.req || has(S, R.req)) && S.xp >= R.xp) return C('res:' + id); break; }
    let best = 0; for (const i of [7, 6, 4, 2, 1, 0]) if (cropUnlocked(S, i)) { best = i; break; }
    const want = sk.ward && cropUnlocked(S, 3) && S.wave >= 8 && L_hash(S.wave, 2, 2) < 0.3 ? 3 : best;
    if (S.seed !== want && S.coins > CROPS[want].seed * 4) return C('seed' + want);
    if (S.seed > 0 && S.coins < CROPS[S.seed].seed) return C('seed0');
    // 1) the creature nearest to an owned crop → light it (or shoot)
    let threat = null, td = 1e9;
    for (const m of S.mobs) { if ((m.st !== 'seek' && m.st !== 'eat' && m.st !== 'surface') || m.under) continue;
      const tgt = m.tgt >= 0 ? PLOTS[m.tgt] : null, d = tgt ? Math.hypot(tgt.x - m.x, tgt.y - m.y) : 9999; if (d < td) { td = d; threat = m; } }
    if (threat && (threat.st !== 'seek' || td < 420)) { const ty = threat.y - threat.alt - 45 * threat.sz;
      if (S.owned.gun && S.coins > 40 && (threat.kind === 'big' || threat.kind === 'boss' || threat.kind === 'digger' || threat.st === 'eat')) { if (S.tool !== 'gun') return C('gun'); return { k: 'shoot', x: threat.x, y: ty - 15 }; }
      if (has(S, 'gun') && !S.owned.gun && S.coins > BAL.price.gun + 60) return C('gun');
      if (!S.batLock && S.bat > 0.4) return { k: 'light', x: threat.x, y: ty }; }
    if (S.tool === 'gun') return C('gun');
    // 2) medicine on an infected bed that held a valuable crop
    if (S.gems >= 1 && sk.build) for (let i = 0; i < PLOTS.length; i++) { const p = S.plots[i]; if (p.dead && p.from && p.from.crop >= 2 && owned(S, i)) { if (S.tool !== 'med') return C('med'); return { k: 'med', x: PLOTS[i].x, y: PLOTS[i].y }; } }
    if (S.tool === 'med') return C('med');
    const br = sk.build && S.props.find((p) => p.broken && S.coins >= Math.round(BAL.price[p.k][0] * BAL.price.fix) + 10);
    if (br) { if (S.tool !== 'scythe') return C(S.tool); return { k: 'fix', x: br.x, y: br.y - 60 }; }
    // 3) corruption creeping onto owned beds → push it back
    let hot = null, hv = 0.25;
    for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) { const k = r * NC + c; if (isCore(c, r) || (!S.inf[k] && !S.flag[k])) continue;
      const own = (cc, rr) => { const pi = plotAt(cc, rr); return pi >= 0 && owned(S, pi); }, pi = plotAt(c, r);
      const nearG = own(c, r) || own(c - 1, r) || own(c + 1, r) || own(c, r - 1) || own(c, r + 1);
      const v = (nearG ? S.inf[k] + (S.flag[k] ? 0.6 : 0) : 0) + (pi >= 0 && own(c, r) ? 0.2 * S.inf[k] : 0);
      if (v > hv) { hv = v; hot = cellXY(c, r); } }
    if (hot && !S.batLock && S.bat > 0.5) return { k: 'light', x: hot[0], y: hot[1] };
    // 4) spend: sections, lights, salt, the rest
    if (sk.build) {
      for (let si = 1; si < 4; si++) if (!S.sec[si] && S.coins >= SECTS[si].price + (sk.reserve || 60) + 60 && S.wave >= si) return { k: 'build', x: cellXY(SECTS[si].c0 + 1, 2)[0], y: cellXY(SECTS[si].c0 + 1, 2)[1], sec: si };
      const caps = { search: 2 + S.sec.filter(Boolean).length, lamp: 4 + 3 * S.sec.filter(Boolean).length, garland: 6, salt: 18, scarecrow: 4, sprinkler: S.sec.filter(Boolean).length, generator: 2, turret: 4, barn: 1 };
      for (const kind of ['barn', 'turret', 'generator', 'search', 'lamp', 'sprinkler', 'scarecrow', 'garland', 'salt']) { if (!has(S, kind)) continue; const price = priceOf(S, kind);
        if (S.coins < price + (sk.reserve || 60) || S.built[kind] >= caps[kind]) continue;
        const spot = buildSpot(S, kind); if (!spot) continue;
        if (S.tool !== kind) return C(kind); return { k: 'build', x: spot[0], y: spot[1] }; }
      if (S.coins > priceOf(S, 'gem') + 300 && S.wave >= 4) return C('gem'); }
    if (S.tool !== 'scythe') return C(S.tool);
    // 5) harvest the nearest ripe bed, else plant the nearest empty one, else clear dead plants
    let tgt = null, bd = 1e9, kind = '';
    S.plots.forEach((p, i) => { if (!owned(S, i)) return; const P = PLOTS[i], d = Math.hypot(P.x - B.x, P.y - B.y);
      if (p.crop >= 0 && p.g >= CROPS[p.crop].grow && d < bd) { bd = d; tgt = P; kind = 'reap'; } });
    if (!tgt) S.plots.forEach((p, i) => { if (!owned(S, i)) return; const P = PLOTS[i], d = Math.hypot(P.x - B.x, P.y - B.y); if (S.flag[P.r * NC + P.c]) return;
      if (((p.crop < 0 && !p.dead && S.coins >= CROPS[S.seed].seed) || p.dead) && d < bd) { bd = d; tgt = P; kind = p.dead ? 'reap' : 'plant'; } });
    if (tgt) return { k: kind, x: tgt.x, y: tgt.y };
    if (S.phase === 'day' && S.pt > 6 && sk.early) return C('night');
    return { k: 'idle', x: B.x, y: B.y };
  }
  function buildSpot(S, kind) {          // the buildable cell that guards owned beds best against the open rifts
    const own = PLOTS.filter((P, i) => owned(S, i)); let best = null, bs = -1e9;
    const openP = PORTALS.filter((p, i) => portalOpen(S, i) || S.wave + 2 >= p.wave);
    for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) { if (!buildable(S, c, r)) continue; const [x, y] = cellXY(c, r);
      const dOwn = Math.min(...own.map((P) => Math.hypot(P.x - x, P.y - y))); if (dOwn > 330) continue;
      const dP = Math.min(...openP.map((p) => Math.hypot(p.x - x, p.y - y)));
      let s = -dP * 0.01 - Math.abs(dOwn - (kind === 'salt' ? 160 : kind === 'sprinkler' || kind === 'barn' ? 0 : 200)) * 0.02;
      if (kind === 'sprinkler') s = -dOwn * 0.02 - Math.abs(r - 2.5);
      if (kind === 'barn') s = -Math.abs(x - 1650) * 0.01 - (r === 0 ? 0 : 5);
      const spacing = { lamp: 260, search: 400, garland: 170, scarecrow: 200, sprinkler: 300, generator: 500, turret: 300, salt: 0, barn: 0 }[kind];
      if (spacing && S.props.some((p) => p.k === kind && Math.hypot(p.x - x, p.y - y) < spacing)) s -= 50;
      if (kind === 'generator' && !S.props.some((p) => (p.k === 'lamp' || p.k === 'search') && Math.hypot(p.x - x, p.y - y) < BAL.genR)) s -= 30;
      if (kind === 'salt') { const k = r * NC + c; s += S.inf[k] * 2 + (S.flag[k] ? 3 : 0); }
      if (s > bs) { bs = s; best = [x, y]; } }
    return best; }

  // ---------------------------------------------------------------- attract demo: the bot plays a mid-game night
  const L = 48;
  function demoStart() { const S = create(11, 1); S.coins = 420; S.xp = 30; S.gems = 2; S.sec = [1, 1, 0, 0];
    S.res = { carrot: 1, cabbage: 1, lamp: 1, torch: 1, salt: 1, scarecrow: 1, garlic: 1, tomato: 1 }; S.bat = BAL.torch.bat[1];
    S.wave = 7; S.phase = 'day'; S.pt = BAL.day - 3; S.plen = BAL.day; S.seed = 4;
    S.plots.forEach((p, i) => { if (!owned(S, i)) return; const c = [4, 1, 2, 3, 0, 2, 4, 1][i % 8]; p.crop = c; p.g = CROPS[c].grow * (0.35 + 0.65 * L_hash(i, 3, 1)); });
    const put = (k, c, r) => { const [x, y] = cellXY(c, r); S.props.push({ k, c, r, x, y: y + (k === 'salt' ? 0 : 30), t0: -5, a0: Math.PI * 0.05, ph: c, hp: 1, cd: 0 }); S.built[k]++; };
    put('lamp', 19, 2); put('lamp', 14, 3); put('scarecrow', 19, 4); put('salt', 20, 1); put('salt', 20, 3); put('garland', 14, 1);
    for (let c = 21; c <= 24; c++) for (let r = 1; r <= 3; r++) { S.inf[r * NC + c] = 1; S.flag[r * NC + c] = 1; }
    S.cam = 1750; S.x = 2600; S.bot = { skill: { react: 0.16, speed: 2400, build: 1, reserve: 200 } }; return S; }
  const scriptInput = (t, S) => botInput(S, S.bot || (S.bot = { skill: { react: 0.16, speed: 2400, build: 1 } }));
  let cache = null;
  function at(t) {
    const loop = Math.floor(t / L), q = t - loop * L, n = Math.round(q / DT);
    if (!cache || cache.loop !== loop || cache.S.steps > n) cache = { loop, S: Object.assign(demoStart(), { wt0: loop * L }) };
    const S = cache.S; while (S.steps < n) step(S, scriptInput(S.t, S));
    return Object.assign({}, S, { loop, q });
  }
  const demoCheck = (S) => S.stats.harvest >= 8 && S.stats.scared + S.stats.killed >= 1 && S.phase !== 'lost';
  const HINT = 'ЛКМ — коса, ПКМ / Пробел — фонарик, A/D — камера, 1–8 семена, Q — стройка, B — книга, N — ночь, O — звук';

  root.SIM = { DT, L, VIEW, WORLD, HINT, NC, NR, CW, CH, FX0, FY0, SECTS, PLOTS, PORTALS, CART, HAND, CROPS, RESEARCH, KINDS, MODES, WAVES, BAL,
    SLOTS, SLOT, BUILDS, NIGHT_BTN, GEM_BTN, MAP, PANEL, CLOSE, cellXY, cellAt, plotAt, secAt, isCore, slotRect, menuRect, cardRect, modeRect,
    lights, lightAt, searchAng, torchR, torchLvl, priceOf, has, cropUnlocked, infectedPlots, ownedCount, loseAt, owned, portalOpen, propOn, powered, buildable, uiHit, sellPoint,
    create, spawn, step, at, scriptInput, botInput, demoStart, demoCheck };
  if (typeof module !== 'undefined') module.exports = root.SIM;
})(typeof window !== 'undefined' ? window : globalThis);
