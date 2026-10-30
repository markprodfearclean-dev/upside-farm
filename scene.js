// live/scene.js — «Огород у Изнанки»: everything drawn. A pure function of t and the sim state (ref2game contract).
// The world is two screens wide: the camera (ST.cam) scrolls it. Layers: painted world → soil beds (owned / for sale) →
// corruption (shader over a field mask) → y-sorted crops, props, creatures → night light pass (ambient × lights) → emissive
// glows, veins, beams → weather → event FX → grade → HUD (counters, wave + event, minimap, edge alerts, toolbar, build menu,
// research book, mode select, cursor tool).
(function () {
  const S = (window.SCENE = {}), L = LIB, M = L.M, W = SIM.VIEW.W, H = SIM.VIEW.H, WW = SIM.WORLD.W;
  const SS = L.SS, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), frac = (v) => v - Math.floor(v), TAU = Math.PI * 2;
  S.REPEAT = ['infect_tex'];
  const CROPN = SIM.CROPS.map((c) => c.id);
  // ---------------------------------------------------------------- sizes (view px) — the art scale lives here, not in texture sizes
  const SZ = { soil: 138, ripe: 112, young: 84, sprout: 46, dead: 96, lamp: 250, search: 250, garland: 150, cart: 190, portal: 360, mob: 200,
    turret: 150, generator: 120, scarecrow: 200, sprinkler: 95, barn: 230, salt: 30, flyer: 120, digger: 150, mound: 64, swarm: 52 };
  const HEAD = { lamp: [17, -SZ.lamp * 0.88 + 4], search: [10, -SZ.search * 0.89 + 4], scarecrow: [-36, -SZ.scarecrow * 0.62] };   // light sources on the art (offset from the base)
  // creature rig (fractions of each part drawing, measured on the part sheet; the body faces LEFT; one scale for all parts)
  const RIG = { body: { h: 0.534, hip: [0.87, 0.86], sh: [0.64, 0.36], shB: [0.71, 0.33], head: [0.15, 0.16] },
    leg: { h: 0.608, root: [0.60, 0.08], joint: [0.78, 0.43], ankle: [0.80, 0.85], sole: 0.97 },
    arm: { h: 0.594, root: [0.45, 0.07], joint: [0.70, 0.42], wrist: [0.60, 0.72] },
    flyer: { sh: [0.465, 0.30], wing: [0.04, 0.40] } };
  const STEP = 52;                                                                     // step length (px) of a normal creature
  const dirA = (a, b, w, h) => Math.atan2(-(b[0] - a[0]) * w, (b[1] - a[1]) * h);       // twoBone angle of a drawn bone (0 = straight down)
  const hasTex = (n) => !!(window.ASSETS && ASSETS[n]);
  // ---------------------------------------------------------------- shaders
  const CORRUPT = `
uniform sampler2D u_mask, u_tex; uniform vec4 u_rect; uniform float u_mode, u_cam;
void main(){
  vec2 wp = v_px + vec2(u_cam, 0.0), uv = (wp - u_rect.xy) / u_rect.zw;
  float n = fbm(wp * 0.0065 + vec2(u_t * 0.012, 0.0)), n2 = fbm(wp * 0.03 + 3.0);
  float m = texture(u_mask, uv).a;
  float e = m * 1.15 + ((n - 0.5) * 1.5 + (n2 - 0.5) * 0.5) * smoothstep(0.02, 0.3, m);
  float a = smoothstep(0.50, 0.57, e);
  float rim = smoothstep(0.50, 0.555, e) - smoothstep(0.58, 0.72, e);
  float vein = smoothstep(0.62, 0.78, fbm(wp * 0.022 + vec2(0.0, u_t * 0.04))) * smoothstep(0.62, 0.8, e);
  float pulse = 0.55 + 0.45 * sin(u_t * 2.1 - n * 11.0);
  if (u_mode < 0.5) { vec3 c = texture(u_tex, wp / 430.0).rgb * vec3(0.92, 0.86, 0.98); c = mix(c, c * 0.45, rim * 0.9); o = vec4(c * a, a); }
  else { float g = (rim * 0.55 + vein * 0.8) * pulse * a; o = vec4(vec3(1.0, 0.08, 0.12) * g, 0.0); }
}`;
  const NIGHT = `
uniform sampler2D u_src; uniform vec3 u_amb; uniform float u_n, u_nc;
uniform vec4 u_lp[40]; uniform vec3 u_lc[40]; uniform vec4 u_co[8]; uniform vec4 u_cp[8]; uniform vec3 u_cc[8];
void main(){
  vec3 c = texture(u_src, scr(v_px)).rgb, l = u_amb;
  for (int i = 0; i < 40; i++) { if (float(i) >= u_n) break;
    vec2 d = v_px - u_lp[i].xy; d.y *= 1.18; float r = length(d) / u_lp[i].z;
    l += u_lc[i] * u_lp[i].w * pow(clamp(1.0 - r, 0.0, 1.0), 1.7); }
  for (int i = 0; i < 8; i++) { if (float(i) >= u_nc) break;
    vec2 d = v_px - u_co[i].xy; d.y *= 1.18; float dist = length(d), an = atan(d.y, d.x) - u_co[i].z;
    float da = abs(atan(sin(an), cos(an)));
    float f = smoothstep(u_cp[i].x, u_cp[i].x * 0.45, da) * pow(clamp(1.0 - dist / u_co[i].w, 0.0, 1.0), 0.7) * smoothstep(10.0, 70.0, dist);
    l += u_cc[i] * u_cp[i].y * f; }
  float lum = dot(c, vec3(0.3, 0.55, 0.15)), lit = clamp(max(l.r, max(l.g, l.b)), 0.0, 1.5);
  c = mix(vec3(lum) * vec3(0.8, 0.9, 1.15), c, clamp(0.45 + 0.6 * lit, 0.0, 1.0));
  vec3 outc = c * l; outc = outc / (1.0 + max(outc - 1.0, 0.0) * 0.6);
  o = vec4(outc, 1.0);
}`;
  let TB = null, maskCv = null, maskTex = null;
  S.programs = () => {
    L.init(W, H, { corrupt: CORRUPT, night: NIGHT }); L.glyphs('0123456789×+/:-');
    TB = G.target(W, H, true);
    maskCv = document.createElement('canvas'); maskCv.width = SIM.NC + 2; maskCv.height = SIM.NR + 2; maskTex = G.canvasTex('mask', maskCv);
  };
  const updMask = (ST) => { const g = maskCv.getContext('2d'); g.clearRect(0, 0, SIM.NC + 2, SIM.NR + 2);
    for (let r = 0; r < SIM.NR; r++) for (let c = 0; c < SIM.NC; c++) { const v = ST.flag[r * SIM.NC + c] ? 1 : ST.inf[r * SIM.NC + c] * 0.62; if (v <= 0.002) continue;
      g.fillStyle = `rgba(255,255,255,${v.toFixed(3)})`; g.fillRect(c + 1, r + 1, 1, 1); }
    const gl = G.gl; gl.bindTexture(gl.TEXTURE_2D, maskTex.t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); };
  const FR = [SIM.FX0 - SIM.CW, SIM.FY0 - SIM.CH, (SIM.NC + 2) * SIM.CW, (SIM.NR + 2) * SIM.CH];   // mask rect in world px (1 empty cell of border)

  // ---------------------------------------------------------------- helpers
  const spr = (n, x, yb, h, o = {}) => { const w = L.hsz(n, h); return L.sprite(n, 0, 0, Object.assign({ m: M.of(M.t(x, yb), M.s((o.flip ? -1 : 1) * (o.sx || 1), o.sy || 1), M.r(o.rot || 0)), w, h, pivot: [w * (o.px === undefined ? 0.5 : o.px), h * (o.py === undefined ? 1 : o.py)] }, o)); };
  const nightAmt = (ST) => { const p = ST.phase, pt = ST.pt;
    if (p === 'night') return Math.max(0.55, SS(0, 2.5, pt));
    if (p === 'day') return ST.wave === 0 ? 0.42 * SS(ST.plen - 4, ST.plen, pt) + 0.18 : Math.max(1 - SS(0, 3.5, pt), 0.18, 0.55 * SS(ST.plen - 3, ST.plen, pt));
    if (p === 'won') return Math.max(0, 1 - SS(0, 4, pt)) * 0.8; if (p === 'menu') return 0.75; return 1; };
  const VIS = (x, m = 200) => x > -m && x < W + m;                                     // on screen (screen px), with margin

  // ---------------------------------------------------------------- creatures
  function ik(l1, l2, lx, ly) { const D = Math.min(Math.hypot(lx, ly), l1 + l2 - 0.5), th = Math.atan2(-lx, ly);
    const A = Math.acos(clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1)), K = Math.acos(clamp((l1 * l1 + l2 * l2 - D * D) / (2 * l1 * l2), -1, 1));
    return [th - A, Math.PI - K]; }                                                  // knee bends backward (digitigrade)
  const RIMC = [0.6, 0.75, 1.0];
  function drawWalker(m, GT, t) {                                                    // mob, big, boss, jumper: the cut-out rig
    const kind = (m.kind === 'boss' || m.kind === 'big' || m.kind === 'jumper') && hasTex(m.kind + '_body') ? m.kind : 'mob';
    const TB_ = kind + '_body', TA = kind + '_arm', TL = kind + '_leg';
    const sc = m.sz * SZ.mob / 200, age = GT - m.t0, flip = m.face > 0 ? -1 : 1;
    const bodyH = SZ.mob * RIG.body.h * sc, legH = SZ.mob * RIG.leg.h * sc, armH = SZ.mob * RIG.arm.h * sc;
    const legW = L.hsz(TL, legH), armW = L.hsz(TA, armH), Lg = RIG.leg, Ar = RIG.arm;
    const l1 = Math.hypot((Lg.joint[0] - Lg.root[0]) * legW, (Lg.joint[1] - Lg.root[1]) * legH), l2 = Math.hypot((Lg.ankle[0] - Lg.joint[0]) * legW, (Lg.ankle[1] - Lg.joint[1]) * legH);
    const footH = (Lg.sole - Lg.ankle[1]) * legH, lp1 = dirA(Lg.root, Lg.joint, legW, legH), lp2 = dirA(Lg.joint, Lg.ankle, legW, legH);
    const ap1 = dirA(Ar.root, Ar.joint, armW, armH), ap2 = dirA(Ar.joint, Ar.wrist, armW, armH);
    const st = m.st, walking = st === 'seek' || st === 'flee', jump = m.kind === 'jumper', SL = STEP * sc * (st === 'flee' ? 1.25 : 1) * (jump ? 1.35 : 1);
    const ph = m.dist / (2 * SL), stand = (l1 + l2) * 0.95 + footH;
    let alpha = 1, rot = 0, drop = 0, lean = walking ? (st === 'flee' ? 0.05 : -0.08) : 0;
    if (st === 'emerge') alpha = SS(0, 0.8, age);
    if (st === 'eat') lean = -0.42 - 0.08 * Math.sin(age * 9);
    if (st === 'smash') lean = -0.25 - 0.3 * Math.max(0, Math.sin(age * 7));
    if (st === 'die') { const q = SS(0, 0.7, age); rot = 1.25 * q; drop = 0.2 * q * stand; alpha = 1 - SS(0.9, 1.6, age); }
    const fearQ = clamp(m.fear / m.fearMax, 0, 1), shake = (GT - m.lit < 0.15 && st !== 'flee' && st !== 'die') ? 3 * fearQ * Math.sin(t * 61 + m.id) : 0;
    const hopY = jump && walking ? -26 * sc * Math.abs(Math.sin(Math.PI * ((m.dist / 70) % 1))) : 0;            // jumpers bound along
    const bob = walking ? 3.5 * sc * Math.cos(4 * Math.PI * ph) : 1.5 * sc * Math.sin(t * 2.3 + m.ph * 6);
    const hipY = m.y - stand + bob + drop + hopY, hipX = m.x + shake;
    const hit = GT - m.hit < 0.12 ? 1 : 0, grade = [0.95, 1.15, 0, 1.05], tint = hit ? [1, 1, 1, 0.75] : [1, 1, 1, 0], rim = [0.9, -0.55 * flip, -0.75, 0.07];
    const feet = [0, 1].map((i) => { if (!walking || st === 'die') return [i ? 16 * sc : -14 * sc, stand - drop];
      if (jump) { const u = frac(m.dist / 70); return [(i ? 10 : -8) * sc + 14 * sc * Math.cos(Math.PI * u), stand - bob - hopY * 0.2]; }   // feet together in a bound
      const u = frac(ph + i * 0.5); if (u < 0.5) return [-SL / 2 + SL * (u / 0.5), stand - bob];
      const v = (u - 0.5) / 0.5; return [SL / 2 - SL * v, stand - bob - 18 * sc * Math.sin(Math.PI * v)]; });
    const W2S = (lx, ly) => { const c = Math.cos(rot), s = Math.sin(rot); return [hipX + flip * (lx * c - ly * s), hipY + (lx * s + ly * c)]; };
    const bodyW = L.hsz(TB_, bodyH), shQ = (u) => [(u[0] - RIG.body.hip[0]) * bodyW, (u[1] - RIG.body.hip[1]) * bodyH];
    const bodyM = M.of(M.t(hipX, hipY), M.s(flip, 1), M.r(rot + lean));
    const draw = () => {
      const legs = feet.map((f) => { const k = ik(l1, l2, f[0], f[1] - footH); return [k[0] - lp1, k[1] - (lp2 - lp1)]; });
      const limb = (tex, p, a, w, h, rt, jt, sp, far) => L.twoBone({ tex, p, a1: (a[0] + rot) * 180 / Math.PI, a2: a[1] * 180 / Math.PI, face: flip, w, h, split: sp, root: rt, joint: jt, r: 3.2 * sc, col: far ? [0.2, 0.2, 0.26] : [0.3, 0.29, 0.36], u: { alpha, grade, tint: far ? [0.55, 0.55, 0.7, 0.55] : tint, rim: far ? [0, 0, 0, 0] : rim, rimCol: RIMC } });
      const armF = (a) => [a[0] - ap1, a[1] - (ap2 - ap1)];
      const shF = shQ(RIG.body.shB), shN = shQ(RIG.body.sh), rl = (p) => { const c = Math.cos(lean), s = Math.sin(lean); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };
      const armA = (i) => { if (st === 'eat') { const k = Math.sin(age * 8 + i * 2.2); return [0.9 + 0.35 * k, -0.6 - 0.4 * Math.max(0, k)]; }
        if (st === 'smash') { const k = Math.sin(age * 7 + i * 0.5); return [1.6 + 0.9 * k, -0.4]; }
        if (st === 'flee') return [2.4 + 0.3 * Math.sin(t * 14 + i * 3), -0.9];
        if (st === 'die') return [1.8, -0.2];
        if (walking) { const s = Math.sin(TAU * (ph + i * 0.5 + 0.5)); return [0.35 * s + 0.25 + (jump ? 0.5 : 0), 0.2 + 0.25 * Math.max(0, s)]; }
        return [0.15 + 0.05 * Math.sin(t * 2 + i), 0.15]; };
      const kneeFar = limb(TL, W2S(0, 0), legs[1], legW, legH, Lg.root, Lg.joint, Lg.joint[1], 1);
      const pF = rl(shF), aF = armA(1); limb(TA, W2S(pF[0], pF[1]), armF([aF[0] + lean, aF[1]]), armW, armH, Ar.root, Ar.joint, Ar.joint[1], 1);
      L.sprite(TB_, 0, 0, { m: bodyM, w: bodyW, h: bodyH, pivot: [RIG.body.hip[0] * bodyW, RIG.body.hip[1] * bodyH], u: { alpha, grade, tint, rim, rimCol: RIMC, bulge: [0.6, 0.6, 0.25, 0.04 * Math.sin(t * 2.4 + m.id)] } });
      const kneeN = limb(TL, W2S(0, 0), legs[0], legW, legH, Lg.root, Lg.joint, Lg.joint[1], 0);
      const pN = rl(shN), aN = armA(0), elb = limb(TA, W2S(pN[0], pN[1]), armF([aN[0] + lean, aN[1]]), armW, armH, Ar.root, Ar.joint, Ar.joint[1], 0);
      if (L.TRACE && !L.sp) { const id = 'mob' + m.id, f0 = W2S(feet[0][0], feet[0][1]), f1 = W2S(feet[1][0], feet[1][1]), a0 = W2S(feet[0][0], feet[0][1] - footH), a1 = W2S(feet[1][0], feet[1][1] - footH);
        L.joint(id, 'hip', [hipX, hipY]); L.joint(id, 'ground', [m.x, m.y]); L.joint(id, 'hipL', [hipX, hipY]); L.joint(id, 'hipR', [hipX, hipY]);
        for (const [n, p] of [['ankleL', a0], ['ankleR', a1], ['toeL', f0], ['toeR', f1], ['heelL', f0], ['heelR', f1], ['kneeL', kneeN], ['kneeR', kneeFar], ['elbowL', elb], ['shL', W2S(pN[0], pN[1])]]) L.joint(id, n, p);
        L.joint(id, 'head', M.ap(bodyM, [(RIG.body.head[0] - RIG.body.hip[0]) * bodyW, (RIG.body.head[1] - RIG.body.hip[1]) * bodyH])); }
    };
    L.shadow(m.x, m.y + 2, 46 * sc * (1 + hopY / 200), 11 * sc, 0.42 * alpha);
    L.inked(draw, { r: 2.2, n: 6, col: [0.05, 0.03, 0.05] });
  }
  function drawFlyer(m, GT, t) {                                                     // body + two wings flapping about the shoulder
    const sc = m.sz, age = GT - m.t0, flip = m.face > 0 ? -1 : 1, st = m.st;
    const bh = SZ.flyer * sc, bw = L.hsz('flyer_body', bh), wh = bh * 1.05, ww = L.hsz('flyer_wing', wh);
    const rate = st === 'eat' ? 5 : st === 'flee' ? 9 : 6.5, fl = Math.sin(t * rate * TAU / 2 + m.id), alt = m.alt + 8 * Math.sin(t * 2.1 + m.id);
    const alpha = st === 'emerge' ? SS(0, 0.8, age) : st === 'die' ? 1 - SS(0.4, 1.2, age) : 1, fall = st === 'die' ? 140 * SS(0, 0.6, age) : 0;
    const bx = m.x, by = m.y - alt + fall, rot = st === 'die' ? 1.2 * SS(0, 0.6, age) : st === 'eat' ? -0.25 : 0.08 * Math.sin(t * 3 + m.id);
    const bodyM = M.of(M.t(bx, by), M.s(flip, 1), M.r(rot));
    const sh = M.ap(bodyM, [(RIG.flyer.sh[0] - 0.5) * bw, (RIG.flyer.sh[1] - 0.5) * bh]);
    const hit = GT - m.hit < 0.12, rim = [0.8, -0.55 * flip, -0.75, 0.07], u = { alpha, grade: [0.95, 1.15, 0, 1.05], tint: hit ? [1, 1, 1, 0.75] : [1, 1, 1, 0], rim, rimCol: RIMC };
    const wing = (far) => { const a = (far ? -0.55 : -0.35) - 0.95 * fl, sy = far ? 0.85 : 1;            // root at the shoulder, tips sweep up and down
      L.sprite('flyer_wing', 0, 0, { m: M.of(M.t(sh[0], sh[1]), M.s(flip, sy * (0.55 + 0.45 * Math.abs(Math.cos(t * rate * TAU / 2 + m.id)))), M.r(a)), w: ww, h: wh, pivot: [RIG.flyer.wing[0] * ww, RIG.flyer.wing[1] * wh],
        u: Object.assign({}, u, far ? { tint: [0.5, 0.5, 0.65, 0.6], rim: [0, 0, 0, 0] } : {}) }); };
    L.shadow(m.x, m.y + 4, 40 * sc * (1 - alt / 400), 9 * sc, 0.3 * alpha);
    L.inked(() => { wing(1); L.sprite('flyer_body', 0, 0, { m: bodyM, w: bw, h: bh, pivot: [bw / 2, bh / 2], u }); wing(0); }, { r: 2, n: 6, col: [0.05, 0.03, 0.05] });
    if (L.TRACE && !L.sp) { L.joint('mob' + m.id, 'ground', [m.x, m.y]); L.joint('mob' + m.id, 'head', [bx - 0.4 * bw * flip, by - 0.2 * bh]); }
  }
  function drawDigger(m, GT, t, X) {
    const age = GT - m.t0, sc = m.sz, mh = SZ.mound * sc;
    if (m.under || m.st === 'burrow' || (m.st === 'flee' && m.under)) {              // a travelling mound and flying clods
      spr('digger_mound', m.x, m.y + 10, mh * (0.9 + 0.1 * Math.sin(t * 9 + m.id)), { u: { alpha: 0.95 } });
      if (L.rnd(Math.floor(t * 8), m.id) < 0.5) L.puff(m.x + 20 * Math.sin(t * 7 + m.id), m.y - 10, 8, [0.32, 0.24, 0.18], 0.6, m.id + Math.floor(t * 8));
      return; }
    const H0 = SZ.digger * sc, q = m.st === 'surface' ? SS(0, 0.8, age) : m.st === 'dive' ? 1 - SS(0, 0.6, age) : m.st === 'die' ? 1 - SS(0.3, 1.2, age) : 1;
    spr('digger_mound', m.x, m.y + 12, mh * 1.2);
    if (q <= 0.01) return;
    const w = L.hsz('digger', H0), hit = GT - m.hit < 0.12, sway = m.st === 'eat' ? 0.08 * Math.sin(age * 9) : 0.04 * Math.sin(t * 2.5 + m.id);
    L.inked(() => L.sprite('digger', 0, 0, { m: M.of(M.t(m.x, m.y + 4), M.s(m.face > 0 ? -1 : 1, 1), M.r(sway)), w, h: H0 * q, src: [0, 0, 1, q], pivot: [w / 2, H0 * q],
      u: { tint: hit ? [1, 1, 1, 0.75] : [1, 1, 1, 0], rim: [0.8, -0.5, -0.75, 0.07], rimCol: RIMC, grade: [0.95, 1.15, 0, 1.05], bulge: [0.5, 0.35, 0.3, 0.05 * Math.sin(t * 3 + m.id)] } }), { r: 2, n: 6, col: [0.05, 0.03, 0.05] });
    spr('digger_mound', m.x, m.y + 16, mh * 1.1, { sy: 0.55 });                       // front lip of the hole over its base
    if (L.TRACE && !L.sp) { L.joint('mob' + m.id, 'ground', [m.x, m.y]); L.joint('mob' + m.id, 'head', [m.x, m.y - H0 * q]); }
  }
  function drawSwarm(m, GT, t) {                                                     // a blob: squash on its own pivot + bulge
    const age = GT - m.t0, n = 'swarm_' + (m.id % 3), h = SZ.swarm * (0.9 + 0.2 * L.rnd(m.id, 4)), walking = m.st === 'seek' || m.st === 'flee';
    const k = walking ? Math.sin(m.dist / 9) : m.st === 'eat' ? Math.sin(age * 12) : 0.3 * Math.sin(t * 3 + m.id), sq = 1 + 0.12 * k;
    const alpha = m.st === 'emerge' ? SS(0, 0.6, age) : 1;
    if (m.st === 'die') return;
    L.shadow(m.x, m.y + 2, h * 0.5, h * 0.14, 0.4);
    L.inked(() => spr(n, m.x, m.y + 2, h / sq, { sx: sq * (m.face > 0 ? -1 : 1), u: { alpha, bulge: [0.5, 0.45, 0.4, 0.06 * k], rim: [0.7, -0.5, -0.75, 0.08], rimCol: RIMC } }), { r: 1.6, n: 6, col: [0.05, 0.03, 0.05] });
    if (L.TRACE && !L.sp) { L.joint('mob' + m.id, 'ground', [m.x, m.y]); L.joint('mob' + m.id, 'head', [m.x, m.y - h]); }
  }
  function drawMob(m, GT, t, X) {
    if (m.kind === 'flyer') return drawFlyer(m, GT, t);
    if (m.kind === 'digger') return drawDigger(m, GT, t, X);
    if (m.kind === 'swarm') return drawSwarm(m, GT, t);
    return drawWalker(m, GT, t);
  }

  // ---------------------------------------------------------------- render
  let ftN = 0;
  S.render = (t) => {
    const ST = S.state || SIM.at(t), GT = ST.t, play = !!S.state, N = nightAmt(ST), CAM = ST.cam; ftN = 0;
    let tr = 0; for (const e of ST.ev) { const a = GT - e.t; if (a < 0 || a > 0.6) continue;
      const k = { plotlost: 0.5, smash: 0.55, kill: 0.35, shot: 0.2, spawn: 0.18, wave: 0.6, surge: 0.15, lost: 0.9, bolt: 0.7, portal: 0.9 }[e.k] || 0;
      const onS = e.x === undefined || VIS(e.x - CAM, 300) ? 1 : 0.25; tr = Math.max(tr, k * onS * (1 - a / 0.6)); }
    const sh = tr * tr * 14, cx = sh * (L.rnd(Math.floor(t * 40), 1) - 0.5) * 2, cy = sh * (L.rnd(Math.floor(t * 40), 2) - 0.5) * 2;
    const X = (x) => x - CAM + cx, Y = (y) => y + cy;
    const ev = ST.event && ST.phase === 'night' ? ST.event : '';

    L.beginBG([0.04, 0.05, 0.07, 1]);
    L.sprite('bg_world', X(0) - 12, Y(0) - 8, { w: WW + 24, h: H + 16 });
    L.beginComp();
    // soil beds: owned sections, and the sections for sale (overgrown, with their price)
    SIM.PLOTS.forEach((P, i) => { const x = X(P.x); if (!VIS(x, 120)) return; const p = ST.plots[i], own = SIM.owned(ST, i);
      const hop = SS(0, 0.08, GT - p.hop) * (1 - SS(0.08, 0.35, GT - p.hop)), sq = 1 + 0.06 * hop;
      L.shadow(x, Y(P.y + 52), 70, 14, own ? 0.25 : 0.12);
      spr('plot_soil', x, Y(P.y + 60), SZ.soil * 0.9 / sq, { sx: sq, u: { grade: own ? [0.95, 0.95, 0, 1] : [0.5, 0.75, 0.25, 0.9], alpha: own ? 1 : 0.55, haze: [0.2, 0.3, 0.2] } }); });
    updMask(ST);
    const corrupt = (mode) => G.draw(L.P.corrupt, { u_mask: maskTex, u_tex: G.tex('infect_tex'), u_rect: FR, u_cam: CAM - cx, u_mode: mode, u_t: t }, G.xf(0, cy, W, H));
    corrupt(0);
    // salt lines lie flat on the ground
    for (const p of ST.props) if (p.k === 'salt' && VIS(X(p.x))) spr('salt', X(p.x), Y(p.y + 40), SZ.salt, { u: { alpha: 0.35 + 0.65 * clamp(p.hp, 0, 1) }, sx: 1.05 });
    if (play && !ST.panel && !ST.tut && ST.tool === 'scythe' && ST.phase !== 'menu') { const cr = SIM.cellAt(ST.x, ST.y), pi = cr ? SIM.plotAt(cr[0], cr[1]) : -1;
      if (pi >= 0 && SIM.owned(ST, pi)) { const P = SIM.PLOTS[pi]; L.ring(X(P.x), Y(P.y + 6), 74, 60, [1, 0.95, 0.7], 0.35 + 0.2 * ST.press, 0.05); } }
    // y-sorted world
    const items = [];
    SIM.PLOTS.forEach((P, i) => { const p = ST.plots[i]; if ((p.crop < 0 && !p.dead) || !VIS(X(P.x), 120)) return; items.push({ y: P.y + 40, d: () => drawCrop(P, p, i, GT, t, X, Y) }); });
    for (const p of ST.props) if (p.k !== 'salt' && VIS(X(p.x), 260)) items.push({ y: p.y, d: () => drawProp(p, GT, t, X, Y, ST) });
    SIM.PORTALS.forEach((P, i) => { if (VIS(X(P.x), 300)) items.push({ y: P.y, d: () => drawPortal(P, i, GT, t, X, Y, ST) }); });
    if (VIS(X(SIM.CART.x))) items.push({ y: SIM.CART.y, d: () => { L.shadow(X(SIM.CART.x), Y(SIM.CART.y + 4), 90, 16, 0.4); spr('cart', X(SIM.CART.x), Y(SIM.CART.y + 10), SZ.cart); } });
    for (const m of ST.mobs) if (VIS(X(m.x), 260)) items.push({ y: m.y + (m.kind === 'flyer' ? 400 : 0), d: () => drawMob(Object.assign({}, m, { x: X(m.x), y: Y(m.y) }), GT, t, X) });
    items.sort((a, b) => a.y - b.y); for (const it of items) it.d();
    for (const f of ST.fly) { const q = clamp((GT - f.t0) / f.dur, 0, 1), e = q * q * (3 - 2 * q), x = f.x + (f.tx - f.x) * e, y = f.y + (f.ty - 90 - f.y) * e - (170 + f.dur * 120) * Math.sin(Math.PI * q);
      if (VIS(X(x))) spr(f.gold ? 'crop_pumpkin_gold' : 'crop_' + CROPN[f.c], X(x), Y(y + 30), 64 * (1 - 0.3 * q), { rot: q * 6 * (f.x > f.tx ? -1 : 1), py: 0.6 }); }
    for (const P of SIM.SECTS.map((s, i) => i)) if (!ST.sec[P]) { const s = SIM.SECTS[P], [sx0, sy0] = SIM.cellXY(s.c0 + 1.5, 2.5), x = X(sx0);
      if (VIS(x, 300)) { const txt = 'Участок — ' + s.price, w = 40 + L.labelW('sec' + P, txt, { size: 30 }); spr('ic_seed', x, Y(sy0 + 10), 70); panel('secp' + P, x - w / 2, Y(sy0 + 18), w, 46, { a: 0.8, r: 22 }); L.label('sec' + P, txt, x, Y(sy0 + 41), { size: 30, al: 0.5, col: ST.coins >= s.price ? '#ffe2a0' : '#d8b8a8' }); } }

    // ---------------- night light pass (lights culled to the view)
    const lp = [], lc = [], co = [], cp = [], cc = [];
    const light = (x, y, r, a, col) => { const sx = X(x); if (lp.length >= 40 * 4 || sx < -r || sx > W + r) return; lp.push(sx, Y(y), r, a); lc.push(...col); };
    const pr = 0.85 + 0.15 * Math.sin(t * 2.3) + 0.06 * Math.sin(t * 7.1);
    SIM.PORTALS.forEach((P, i) => { if (SIM.portalOpen(ST, i)) light(P.x, P.y - 120 * P.scale, 560 * P.scale, 0.95 * pr, [1.0, 0.16, 0.18]); else if (ST.wave + 2 >= P.wave) light(P.x, P.y - 40, 160, 0.4 * pr, [1, 0.2, 0.2]); });
    for (const m of ST.mobs) { if (m.st === 'die' || m.under) continue; const k = m.kind === 'boss' ? 1.5 : m.kind === 'big' ? 1.1 : m.kind === 'swarm' ? 0.4 : 0.8, p = 0.85 + 0.15 * Math.sin(t * 3 + m.id);
      light(m.x, m.y - m.alt - 70 * m.sz, (m.kind === 'boss' ? 300 : 190 * Math.max(0.6, m.sz)) * (m.st === 'emerge' ? SS(0, 1, GT - m.t0) : 1), 0.55 * k * p, [1.0, 0.18, 0.2]); }
    light(SIM.CART.x, SIM.CART.y - 120, 210, 0.75, [1.0, 0.75, 0.42]);
    light(1640, 120, 300, 0.7, [1.0, 0.7, 0.38]);                                     // farmhouse windows
    for (const s of SIM.lights(ST)) { const [k, x, y, R, str] = s;
      if (k === 'torch') continue;
      if (k === 'search') { const sx = X(x); if (sx > -700 && sx < W + 700 && co.length < 8 * 4) { co.push(sx, Y(y - 30), s[5], R * 1.1); cp.push(SIM.BAL.searchHalf * 1.15, 1.25 * Math.min(1.2, str), 0, 0); cc.push(0.92, 0.96, 1.0); } light(x, y - 20, 150, 0.6, [0.9, 0.95, 1]); continue; }
      const col = k === 'lamp' ? [1.0, 0.76, 0.42] : k === 'garland' ? [1.0, 0.62, 0.7] : k === 'scarecrow' ? [1.0, 0.7, 0.35] : [1.0, 0.85, 0.35];
      light(x, y - (k === 'sun' ? 20 : 30), R * 1.45, (k === 'lamp' ? 1.15 : k === 'sun' ? 0.7 : 0.85) * Math.min(1.25, str) * (0.94 + 0.06 * Math.sin(t * 9 + x)), col); }
    for (const p of ST.props) if (p.broken && L.rnd(Math.floor(t * 12), p.c * 7 + p.r) > 0.8) light(p.x, p.y - 40, 120, 0.5, [1, 0.7, 0.4]);
    if (ST.beam) { const r = SIM.torchR(ST); light(ST.x, ST.y, r * 1.45, 1.55, [1.0, 0.93, 0.76]);
      const hx = SIM.HAND.x, hy = SIM.HAND.y - 40, sx = X(ST.x), d = Math.hypot(sx - hx, ST.y - hy);
      if (co.length < 8 * 4) { co.push(hx, hy, Math.atan2((ST.y - hy) * 1.18, sx - hx), d + r * 0.5); cp.push(Math.atan2(r * 0.9, d), 0.45, 0, 0); cc.push(1.0, 0.93, 0.78); } }
    for (const e of ST.ev) { const a = GT - e.t; if (a < 0) continue;
      if (e.k === 'shot' && a < 0.12) light(e.x, e.y, 260, 1.6 * (1 - a / 0.12), [1, 0.8, 0.5]);
      if (e.k === 'tshot' && a < 0.1) light(e.x, e.y, 160, 1.2 * (1 - a / 0.1), [1, 0.8, 0.5]);
      if (e.k === 'med' && a < 1.0) light(e.x, e.y, 280, 1.2 * (1 - a), [0.4, 1, 0.8]);
      if (e.k === 'spawn' && a < 0.8) { const P = SIM.PORTALS[e.pi || 0]; light(P.x, P.y - 120, 700, 1.2 * (1 - a / 0.8), [1, 0.1, 0.12]); } }
    let amb = L.lerpP([0.88, 0.86, 0.94], [0.27, 0.33, 0.52], N);
    if (ev === 'bloodmoon') amb = L.lerpP(amb, [0.42, 0.16, 0.18], 0.7 * SS(0, 3, ST.pt));
    if (ev === 'fog') amb = L.lerpP(amb, [0.3, 0.32, 0.38], 0.5);
    const flash = ev === 'storm' ? Math.max(0, ...ST.ev.filter((e) => e.k === 'bolt').map((e) => { const a = GT - e.t; return a >= 0 && a < 0.5 ? (a < 0.06 ? 1 : 0.6 * (1 - a / 0.5)) * (0.7 + 0.3 * Math.sin(a * 60)) : 0; })) : 0;
    if (flash > 0) amb = L.lerpP(amb, [1.2, 1.2, 1.35], flash);
    G.blend('none'); G.bind(TB); G.full(L.P.copy, { u_src: L.T.comp }); G.bind(L.T.comp);
    G.full(L.P.night, { u_src: TB, u_amb: amb, u_n: lp.length / 4, u_lp: new Float32Array(lp.length ? lp : [0, 0, 1, 0]), u_lc: new Float32Array(lc.length ? lc : [0, 0, 0]),
      u_nc: co.length / 4, u_co: new Float32Array(co.length ? co : [0, 0, 0, 1]), u_cp: new Float32Array(cp.length ? cp : [0, 0, 0, 0]), u_cc: new Float32Array(cc.length ? cc : [0, 0, 0]) });
    G.blend();
    // ---------------- emissive: veins, rifts, light heads, bulbs, beams
    G.blend('add'); corrupt(1); G.blend();
    SIM.PORTALS.forEach((P, i) => { if (SIM.portalOpen(ST, i) && VIS(X(P.x), 300)) L.glow(X(P.x), Y(P.y - 170 * P.scale), 230 * P.scale, [1, 0.12, 0.16], 0.55 * pr, 2.2); });
    const lit = SIM.lights(ST);
    for (const p of ST.props) { if (!SIM.propOn(ST, p) || !VIS(X(p.x), 300)) continue; const on = SS(0, 0.4, GT - p.t0);
      if (p.k === 'lamp') { const hx = X(p.x + HEAD.lamp[0]), hy = Y(p.y + HEAD.lamp[1]); L.glow(hx, hy, 70, [1, 0.8, 0.45], 0.9 * on, 2.4); L.glow(hx, hy, 26, [1, 0.95, 0.8], 0.9 * on, 1.5); }
      if (p.k === 'scarecrow') { const hx = X(p.x + HEAD.scarecrow[0]), hy = Y(p.y + HEAD.scarecrow[1]); L.glow(hx, hy, 50, [1, 0.75, 0.4], 0.8 * on * (0.85 + 0.15 * Math.sin(t * 11 + p.ph)), 2.4); }
      if (p.k === 'generator') { L.glow(X(p.x + 20), Y(p.y - 70), 18, [0.5, 1, 0.5], 0.6 + 0.4 * Math.sin(t * 6 + p.ph), 2); }
      if (p.k === 'garland') for (let j = 0; j < 8; j++) { const bx = X(p.x + 9 * Math.sin(j * 1.9)), by = Y(p.y - SZ.garland * (0.86 - 0.095 * j)), col = [[1, 0.35, 0.35], [0.4, 1, 0.5], [0.45, 0.6, 1], [1, 0.85, 0.35]][j % 4];
        L.glow(bx, by, 22, col, 0.9 * on * (0.6 + 0.4 * Math.sin(t * 3 + j * 1.7 + p.ph)), 2); }
      if (p.k === 'search') { const s = lit.find((q) => q[0] === 'search' && q[1] === p.x && q[2] === p.y), a = s ? s[5] : 0, ox = X(p.x + HEAD.search[0]), oy = Y(p.y + HEAD.search[1]); L.glow(ox, oy, 46, [0.9, 0.95, 1], 0.95 * on, 1.6);
        for (let j = 1; j <= 7; j++) { const d = j * 66, x = ox + Math.cos(a) * d, y = oy + 50 * j / 7 + Math.sin(a) * d / 1.18; L.glow(x, y, 30 + j * 9, [0.85, 0.9, 1], 0.07 * on, 1.4); } } }
    ST.plots.forEach((p, i) => { const P = SIM.PLOTS[i]; if (p.crop >= 0 && !p.dead && SIM.CROPS[p.crop].glow && p.g >= SIM.CROPS[p.crop].grow && VIS(X(P.x))) L.glow(X(P.x), Y(P.y - 60), 40, [1, 0.85, 0.35], 0.35 * N * (0.8 + 0.2 * Math.sin(t * 2 + i)), 2);
      if (p.gold && VIS(X(P.x))) L.glow(X(P.x), Y(P.y - 20), 50, [1, 0.85, 0.3], 0.4 + 0.2 * Math.sin(t * 4 + i), 2); });
    if (ST.beam) { const hx = SIM.HAND.x, hy = SIM.HAND.y - 40, r = SIM.torchR(ST), sx = X(ST.x);
      for (let j = 1; j <= 9; j++) { const q = j / 10, x = hx + (sx - hx) * q, y = hy + (Y(ST.y) - hy) * q; L.glow(x, y, 18 + r * 0.55 * q, [1, 0.93, 0.75], 0.06, 1.3); }
      L.glow(sx, Y(ST.y), r * 1.1, [1, 0.92, 0.72], 0.16, 1.6); }
    weather(ST, ev, GT, t, X, Y, flash);
    drawFX(ST, GT, t, X, Y);
    ambient(ST, t, N, X, Y, ev);
    drawHand(ST, play, X);
    L.finish(t, { bloom: [0.26, 0.22], vignette: 0.86, warm: 0.6, roll: 1, dither: 1 });
    drawHUD(ST, GT, t, play, ev);
  };

  // ---------------------------------------------------------------- world pieces
  function drawCrop(P, p, i, GT, t, X, Y) {
    const x = X(P.x), yb = Y(P.y + 34), sw = [0.012, 2.2, t * 1.7 + i * 0.7, 1];
    if (p.dead) { spr('crop_dead', x, yb, SZ.dead, { pad: 0.06, u: { sway: [0.006, 2, t + i, 1], grade: [0.7, 0.9, 0, 1] } }); return; }
    const C = SIM.CROPS[p.crop], q = p.g / C.grow, hop = 1 + 0.12 * Math.sin(SS(0, 0.3, GT - p.hop) * Math.PI);
    const yn = 'crop_' + C.id + '_y', rn = p.gold ? 'crop_pumpkin_gold' : 'crop_' + C.id, big = C.id === 'sunflower' ? 1.35 : 1;
    if (q < 0.3) spr('sprout', x, yb, SZ.sprout * (0.7 + q) * hop, { u: { sway: sw }, pad: 0.08 });
    else if (q < 1) spr(hasTex(yn) ? yn : 'sprout', x, yb, SZ.young * big * (0.75 + 0.3 * (q - 0.3) / 0.7) * hop, { u: { sway: sw }, pad: 0.08 });
    else { const pop = 1 + 0.18 * Math.sin(Math.PI * SS(0, 0.35, GT - (p.ripe || -9)));
      spr(hasTex(rn) ? rn : 'crop_pumpkin', x, yb, SZ.ripe * big * pop, { u: { sway: [0.008, 2.2, t * 1.7 + i * 0.7, 1], rim: [0.35, -0.6, -0.7, 0.05], rimCol: [0.7, 0.85, 1] }, pad: 0.08 });
      const k = Math.floor(t / 2.7 + i * 0.37); if (L.rnd(k, i) < 0.3 || p.gold) { const a = frac(t / 2.7 + i * 0.37); L.star(x - 30 + 60 * L.rnd(k, i + 9), yb - 60 - 30 * L.rnd(k, i + 3), 14 * Math.sin(Math.PI * a), [1, 0.95, 0.7], 0.8); } }
  }
  function drawProp(p, GT, t, X, Y, ST) {
    const a = GT - p.t0, pop = p.broken ? 1 : 1 + 0.25 * Math.sin(Math.PI * SS(0, 0.35, a)) * (1 - SS(0.35, 0.6, a)), x = X(p.x), y = Y(p.y), off = !SIM.propOn(ST, p) && !p.broken;
    L.shadow(x, y + 2, p.k === 'search' ? 70 : p.k === 'barn' ? 120 : p.k === 'generator' ? 60 : 34, p.k === 'barn' ? 24 : 10, 0.45);
    const bn = p.k + '_broken', broken = p.broken && hasTex(bn);
    let sx = 1 / Math.sqrt(pop);
    if (p.k === 'generator' && !p.broken) sx *= 1 + 0.012 * Math.sin(t * 40);                     // running engine shudder
    spr(broken ? bn : p.k, x, y + 4, SZ[p.k] * pop, { rot: p.broken && !broken ? 0.12 : 0, sx, u: { grade: p.broken ? [0.5, 0.75, 0, 1] : off ? [0.7, 0.8, 0, 1] : [1, 1, 0, 1] } });
    if (p.k === 'sprinkler' && !p.broken && ST.phase === 'day') for (let j = 0; j < 10; j++) { const an = t * 2.2 + j * 0.63, q = frac(t * 1.4 + j * 0.1), d = 30 + 150 * q;      // water arcs
      L.puff(x + Math.cos(an) * d, y - SZ.sprinkler * 0.8 + Math.sin(an) * d * 0.5 - 60 * Math.sin(Math.PI * q) + 40 * q, 4, [0.7, 0.85, 1], 0.6 * (1 - q), j); }
    if (p.k === 'salt') return;
  }
  function drawPortal(P, i, GT, t, X, Y, ST) {
    const open = SIM.portalOpen(ST, i), soon = !open && ST.wave + 2 >= P.wave;
    if (!open && !soon) return;
    let kick = 0; for (const e of ST.ev) if (e.k === 'spawn' && (e.pi || 0) === i && GT >= e.t) kick = Math.max(kick, 0.08 * (1 - SS(0, 0.6, GT - e.t)));
    const x = X(P.x), y = Y(P.y), sc = P.scale * (soon ? 0.35 + 0.05 * Math.sin(t * 3) : 1), br = 1 + 0.025 * Math.sin(t * 2.3 + i) + kick;
    L.shadow(x, y, 150 * sc, 30 * sc, 0.5);
    spr('portal', x, y + 16 * sc, SZ.portal * sc * br, { sx: (1 + 0.02 * Math.sin(t * 1.7)) / br, u: { bulge: [0.5, 0.45, 0.35, 0.05 * Math.sin(t * 2.3)], alpha: soon ? 0.75 : 1 }, pad: 0.05 });
    if (soon) L.label('soon' + i, ST.wave + 1 === P.wave ? 'Портал откроется следующей ночью!' : 'Здесь трещина…', x, y - 160 * sc - 40, { size: 24, al: 0.5, col: '#ffb0a8' });
  }
  function drawHand(ST, play, X) {
    if ((!play && !ST.beam) || ST.phase === 'menu') return;
    const hx = SIM.HAND.x, hy = SIM.HAND.y - 10, sx = X(ST.x), a = Math.atan2(ST.y - (SIM.HAND.y - 40), sx - hx), w = 190, h = w / L.hsz('flashlight', 1);
    const Mh = M.of(M.t(hx, hy), M.r(a));
    L.sprite('flashlight', 0, 0, { m: Mh, w, h, pivot: [w * 0.15, h * 0.5], u: { grade: [0.9, 0.75 + 0.25 * ST.beam, 0, 1] } });
    const tip = M.ap(Mh, [w * 0.83, 0]);
    if (ST.beam) { L.glow(tip[0], tip[1], 60, [1, 0.95, 0.8], 0.9, 2); L.anchor('flashlight', [hx + Math.cos(a) * w * 0.83, hy + Math.sin(a) * w * 0.83], tip, 12); }
  }
  // ---------------------------------------------------------------- weather (fog, rain, lightning, blood moon, blackout)
  function weather(ST, ev, GT, t, X, Y, flash) {
    if (ev === 'fog') { const k = SS(0, 4, ST.pt); for (let i = 0; i < 4; i++) L.fog(240 + i * 190, 260, [0.004, 12 + i * 4, 0.35, 0.55 * k], [0.55, 0.58, 0.66], i * 3.1, t + ST.cam * 0.01, 0.5); }
    if (ev === 'storm') { const k = SS(0, 3, ST.pt); G.blend('add');
      for (let i = 0; i < 160; i++) { const per = 0.55 + 0.25 * L.rnd(i, 1), q = frac(t / per + L.rnd(i, 2)), x = ((L.rnd(i, 3) * (W + 200) - ST.cam * 0.2 + q * 120) % (W + 200) + W + 200) % (W + 200) - 100, y = -40 + q * (H + 80);
        L.solid(x, y, 2, 34, [0.6, 0.65, 0.8], 0.25, 0, 0, 0.35 * k); }
      G.blend();
      for (const e of ST.ev) { const a = GT - e.t; if (e.k !== 'bolt' || a < 0 || a > 0.35) continue; const x = X(e.x), q = 1 - a / 0.35;     // the bolt: a jagged polyline from the sky
        let px = x + 60 * (L.rnd(e.t, 1) - 0.5), py = -20; for (let j = 0; j < 9; j++) { const nx = x + 70 * (L.rnd(e.t, j + 2) - 0.5) * (1 - j / 9), ny = py + (Y(e.y) + 20) / 9; const len = Math.hypot(nx - px, ny - py);
          G.blend('add'); L.solid(px, py, len, 6 * q, [0.9, 0.92, 1], Math.atan2(ny - py, nx - px), 0, 3, q); G.blend(); px = nx; py = ny; }
        L.glow(x, Y(e.y), 200, [0.85, 0.9, 1], 0.9 * q, 2); } }
    if (ev === 'bloodmoon') L.glow(W * 0.78, 150, 120, [1, 0.12, 0.12], 0.45 * SS(0, 3, ST.pt), 2);
  }
  // ---------------------------------------------------------------- event FX
  const floatText = (s, x, y, size, col, a) => { if (a <= 0.02) return; L.label('ft' + (ftN++ % 48), s, x, y, { size, col, al: 0.5, a }); };
  function drawFX(ST, GT, t, X, Y) {
    for (const e of ST.ev) { const a = GT - e.t; if (a < 0 || a > 2.6) continue; const x = X(e.x), y = Y(e.y); if (!VIS(x, 300)) continue;
      switch (e.k) {
        case 'harvest': if (a < 0.5) { const q = a / 0.5; for (let j = 0; j < 7; j++) { const an = j * 0.9 + e.t * 3, d = 18 + 70 * (1 - (1 - q) ** 2);
          L.puff(x + Math.cos(an) * d, y - 10 + Math.sin(an) * d * 0.6 - 30 * q, 14 * (1 - q) + 4, [0.45, 0.75, 0.3], 0.8 * (1 - q), j + e.t); }
          L.ring(x, y + 10, 40 + 50 * q, 26 + 30 * q, [1, 0.95, 0.75], 0.6 * (1 - q), 0.08); } break;
        case 'plant': if (a < 0.45) { const q = a / 0.45; for (let j = 0; j < 5; j++) L.puff(x - 40 + j * 20, y + 30 - 18 * q, 16 + 10 * q, [0.42, 0.3, 0.2], 0.55 * (1 - q), j); } break;
        case 'clear': case 'dig': if (a < 0.5) { const q = a / 0.5; for (let j = 0; j < 7; j++) L.puff(x - 45 + j * 15, y + 10 - 50 * q * (0.5 + L.rnd(j, e.t)), 14 + 10 * q, [0.36, 0.28, 0.22], 0.7 * (1 - q), j); } break;
        case 'infect': if (a < 0.8) { const q = a / 0.8; for (let j = 0; j < 6; j++) { const an = j * 1.05 + e.x; L.puff(x + Math.cos(an) * 50 * q, y + Math.sin(an) * 30 * q, 22 + 18 * q, [0.25, 0.05, 0.1], 0.7 * (1 - q), j); } } break;
        case 'spit': if (a < 0.8) { const q = a / 0.8; for (let j = 0; j < 8; j++) L.puff(x - 40 + j * 11, y - 120 * (1 - q) + 10, 10 + 8 * q, [0.45, 0.08, 0.2], 0.8 * (1 - q * 0.6), j); } break;
        case 'plotlost': if (a < 1.6) { const q = a / 1.6; L.ring(x, y + 10, 50 + 80 * q, 34 + 50 * q, [1, 0.15, 0.2], 0.9 * (1 - q), 0.08); floatText('Грядка заражена!', x, y - 60 - 40 * q, 28, '#ff8a8a', 1 - SS(1.0, 1.6, a)); } break;
        case 'cleanse': if (a < 0.7) { const q = a / 0.7; for (let j = 0; j < 5; j++) L.star(x - 50 + j * 25, y - 20 - 50 * q * (0.6 + 0.4 * L.rnd(j, e.t)), 18 * (1 - q), [1, 0.95, 0.8], 0.9); } break;
        case 'sell': if (a < 1.1) { const q = a / 1.1; floatText('+' + e.v, x + 30, y - 40 * q, 34, '#ffd76a', 1 - SS(0.7, 1.1, a)); L.star(x, y + 20, 30 * (1 - q), [1, 0.85, 0.4], 1); } break;
        case 'golden': if (a < 1.4) { const q = a / 1.4; for (let j = 0; j < 8; j++) L.star(x + 60 * Math.cos(j * 0.8 + t), y - 30 + 40 * Math.sin(j * 0.8 + t), 20 * (1 - q), [1, 0.85, 0.3], 1); floatText('Золотая тыква!', x, y - 70 - 30 * q, 28, '#ffd76a', 1 - SS(1, 1.4, a)); } break;
        case 'scare': if (a < 1.0) { floatText('!', x, y - 30 - 30 * a, 64, '#fff3b0', 1 - SS(0.6, 1.0, a)); L.ring(x, y + 40, 30 + 60 * a, 20 + 40 * a, [1, 0.95, 0.7], 0.7 * (1 - a), 0.06); } break;
        case 'pop': if (a < 0.5) { const q = a / 0.5; for (let j = 0; j < 6; j++) { const an = j * 1.05; L.puff(x + Math.cos(an) * 30 * q, y + Math.sin(an) * 20 * q, 10 + 10 * q, [0.4, 0.1, 0.15], 0.8 * (1 - q), j); } L.star(x, y, 24 * (1 - q), [1, 0.95, 0.8], 1); } break;
        case 'spawn': if (a < 0.9) { const q = a / 0.9; L.ring(x, y + 60, 60 + 200 * q, 40 + 120 * q, [1, 0.1, 0.15], 0.8 * (1 - q), 0.06); } break;
        case 'portal': if (a < 2.4) { const q = a / 2.4; L.ring(x, y + 100, 80 + 400 * q, 50 + 240 * q, [1, 0.1, 0.15], 1 - q, 0.05); } break;
        case 'smash': if (a < 0.9) { const q = a / 0.9; for (let j = 0; j < 9; j++) { const an = -0.3 - j * 0.32, d = 30 + 110 * q; L.star(x + Math.cos(an) * d, y + Math.sin(an) * d + 120 * q * q, 14 * (1 - q), [1, 0.9, 0.6], 1); }
          floatText('Сломано!', x, y - 40 - 30 * q, 28, '#ffb07a', 1 - SS(0.7, 0.9, a)); } break;
        case 'saltgone': if (a < 0.8) floatText('Соль смыло', x, y - 30 - 30 * a, 22, '#d8d0c8', 1 - a / 0.8); break;
        case 'fix': if (a < 1.0) { for (let j = 0; j < 6; j++) L.star(x - 40 + j * 16, y - 50 * a, 16 * (1 - a), [1, 0.95, 0.75], 1); floatText('-' + e.v, x, y - 30 - 30 * a, 28, '#ffd76a', 1 - a); } break;
        case 'shot': if (a < 0.3) { const q = a / 0.3; L.star(x, y, (e.wide ? 90 : 60) * (1 - q), [1, 0.85, 0.5], 1); L.ring(x, y, 20 + (e.wide ? 90 : 50) * q, 20 + (e.wide ? 90 : 50) * q, [1, 0.9, 0.7], 1 - q, 0.12); } break;
        case 'tshot': if (a < 0.18) { const q = a / 0.18, tx = X(e.tx), ty = Y(e.ty); G.blend('add'); L.solid(x, y, Math.hypot(tx - x, ty - y), 3, [1, 0.9, 0.6], Math.atan2(ty - y, tx - x), 0, 1.5, 1 - q); G.blend(); L.star(x, y, 30 * (1 - q), [1, 0.85, 0.5], 1); L.star(tx, ty, 26 * (1 - q), [1, 0.8, 0.5], 1); } break;
        case 'kill': if (a < 1.0) { for (let j = 0; j < 8; j++) { const an = j * 0.8; L.puff(x + Math.cos(an) * 60 * a, y - 60 + Math.sin(an) * 40 * a - 40 * a, 26 + 20 * a, [0.12, 0.08, 0.12], 0.8 * (1 - a), j); } } break;
        case 'med': if (a < 1.2) { const q = a / 1.2; L.ring(x, y, 60 + 180 * q, 50 + 130 * q, [0.4, 1, 0.75], 1 - q, 0.06); for (let j = 0; j < 10; j++) L.star(x - 150 + 30 * j, y + 60 - 120 * q * (0.5 + L.rnd(j, 4)), 16 * (1 - q), [0.6, 1, 0.85], 1); } break;
        case 'cure': if (a < 0.9) { const q = a / 0.9; for (let j = 0; j < 5; j++) L.star(x - 40 + 20 * j, y - 10 - 60 * q, 16 * (1 - q), [0.6, 1, 0.85], 1); } break;
        case 'gem': if (a < 1.3) floatText('+1 алмаз', x, y - 40 * a + (e.buy ? 60 : 0), 30, '#9fd7ff', 1 - SS(0.9, 1.3, a)); break;
        case 'coin': if (a < 1.2) floatText('+' + e.v, x, y + 40 + 30 * a, 30, '#ffd76a', 1 - SS(0.8, 1.2, a)); break;
        case 'surge': if (a < 0.7) { const q = a / 0.7; L.ring(x, y, 30 + 60 * q, 20 + 40 * q, [1, 0.1, 0.15], 0.7 * (1 - q), 0.1); } break;
        case 'build': if (a < 0.6) { const q = a / 0.6; for (let j = 0; j < 6; j++) L.puff(x - 50 + j * 20, y - 6 * q, 18 + 12 * q, [0.5, 0.45, 0.4], 0.55 * (1 - q), j); } break;
        case 'buysec': if (a < 1.6) { const q = a / 1.6; for (let j = 0; j < 14; j++) L.puff(x - 280 + j * 40, y + 150 * Math.sin(j * 1.3) - 30 * q, 26 + 16 * q, [0.42, 0.3, 0.2], 0.6 * (1 - q), j); floatText('Участок куплен!', x, y - 60 * q, 36, '#ffe2a0', 1 - SS(1.1, 1.6, a)); } break;
      } }
    for (const e of ST.ev) { const a = GT - e.t; if (e.k === 'empty' && a >= 0 && a < 1.4) floatText('Батарея села!', 1660, 920 - 20 * a, 30, '#ffb07a', 1 - SS(1, 1.4, a)); }
  }
  function ambient(ST, t, N, X, Y, ev) {
    G.blend('add');
    SIM.PORTALS.forEach((P, pi) => { if (!SIM.portalOpen(ST, pi) || !VIS(X(P.x), 500)) return;
      for (let i = 0; i < 40; i++) { const per = 5 + 4 * L.rnd(i, 1), u = (t + per * L.rnd(i, 2)) / per, k = Math.floor(u), q = frac(u);
        const x = P.x - 220 + 440 * L.rnd(i + pi * 50, k) + 40 * Math.sin(t * 0.8 + i), y = P.y + 40 - 420 * q * P.scale + 60 * L.rnd(k, i);
        G.draw(L.P.glow, { u_col: [1, 0.25, 0.25], u_k: 2.5, u_amt: 0.35 * Math.sin(Math.PI * q) }, G.xf(X(x) - 5, Y(y) - 5, 10, 10)); } });
    G.blend();
    for (let i = 0; i < 30; i++) { const per = 7 + 3 * L.rnd(i, 7), u = (t + per * L.rnd(i, 8)) / per, k = Math.floor(u), q = frac(u);           // grey ash over the view
      const x = ST.cam + 1920 * L.rnd(i, k + 3) - 120 * q, y = 160 + 760 * L.rnd(k, i + 5) + 60 * q;
      L.puff(X(x), Y(y), 4, [0.55, 0.55, 0.6], 0.5 * Math.sin(Math.PI * q) * (0.3 + 0.7 * N), i); }
    for (const p of ST.props) { if (p.k !== 'lamp' || !SIM.propOn(ST, p) || !VIS(X(p.x))) continue; for (let j = 0; j < 3; j++) {
      const a = t * (2.4 + j * 0.7) + p.ph + j * 2, hx = p.x + HEAD.lamp[0] + Math.cos(a) * (22 + 8 * j), hy = p.y + HEAD.lamp[1] + Math.sin(a * 1.3) * (14 + 5 * j);
      L.puff(X(hx), Y(hy), 3.5, [1, 0.95, 0.8], 0.9, j); } }
    if (N < 0.5) for (let i = 0; i < 18; i++) { const x = ST.cam + 140 + 1700 * L.rnd(i, 1) + 40 * Math.sin(t * 0.6 + i), y = 200 + 640 * L.rnd(i, 2) + 25 * Math.sin(t * 0.9 + i * 2);
      L.glow(X(x), Y(y), 10, [0.9, 1, 0.5], (0.5 - N) * 1.2 * (0.5 + 0.5 * Math.sin(t * 3 + i * 2.3)), 2); }
  }

  // ---------------------------------------------------------------- HUD
  const panel = (id, x, y, w, h, o = {}) => { L.shadow(x + w / 2, y + h / 2 + 6, w * 0.56, h * 0.62, 0.35 * (o.a === undefined ? 1 : o.a));
    L.rrect(x, y, w, h, o.r || 14, o.c0 || [0.16, 0.12, 0.11], o.c1 || [0.09, 0.07, 0.08], o.a === undefined ? 0.94 : o.a); L.uiBox(id, x, y, w, h, 4); };
  const icon = (n, x, y, s, a = 1) => { if (!hasTex(n)) return; const w = L.hsz(n, s); L.sprite(n, x - w / 2, y - s / 2, { w, h: s, u: { alpha: a } }); };
  const BICON = { lamp: 'lamp', garland: 'garland', search: 'search', salt: 'ic_salt', scarecrow: 'scarecrow', sprinkler: 'sprinkler', generator: 'generator', turret: 'turret', barn: 'barn' };
  const BNAME = { lamp: 'Столб', garland: 'Гирлянда', search: 'Прожектор', salt: 'Соль', scarecrow: 'Пугало', sprinkler: 'Поливалка', generator: 'Генератор', turret: 'Турель', barn: 'Амбар' };
  const EVN = { bloodmoon: ['ev_bloodmoon', 'Кровавая луна', 'твари быстрее и смелее, их больше'], fog: ['ev_fog', 'Туман', 'свет бьёт слабее'], storm: ['ev_storm', 'Гроза', 'молнии пугают тварей, дождь растит урожай'],
    blackout: ['ev_blackout', 'Отключение света', 'посреди ночи гаснут фонари без генератора'], fair: ['ev_fair', 'Ярмарка', 'урожай днём дороже в 1,5 раза'] };
  function drawHUD(ST, GT, t, play, ev) {
    if (ST.phase === 'menu') { modeSelect(ST, play, t); return; }
    const pill = (id, ic, val, x) => { const w = 84 + L.labelW(id, val, { size: 34 }); panel(id, x, 20, w, 58, { r: 29 }); icon(ic, x + 34, 49, 46); L.label(id, val, x + 66, 49, { size: 34 }); return x + w + 12; };
    let x = pill('coins', 'ic_coin', String(Math.floor(ST.coins)), 22);
    x = pill('xp', 'ic_xp', String(Math.floor(ST.xp)), x);
    x = pill('gems', 'ic_gem', String(ST.gems), x);
    const gb = SIM.GEM_BTN; gb[0] = x;                                                    // «buy a diamond» follows the pills
    panel('gembtn', gb[0], gb[1], gb[2], gb[3], { r: 25, c0: [0.25, 0.42, 0.62], c1: [0.13, 0.23, 0.38] }); L.label('gemplus', '+', gb[0] + 25, gb[1] + 24, { size: 36, al: 0.5 });
    if (play && ST.sx > gb[0] && ST.sx < gb[0] + gb[2] && ST.sy > gb[1] && ST.sy < gb[1] + gb[3]) { const s = 'Купить алмаз: ' + SIM.priceOf(ST, 'gem') + ' монет', w = 40 + L.labelW('gemtip', s, { size: 24 });
      panel('gemtip', gb[0], 90, w, 44); L.label('gemtip', s, gb[0] + 20, 112, { size: 24 }); }
    const nightTxt = ST.phase === 'night' ? `Ночь ${ST.wave}/${SIM.WAVES}` : ST.phase === 'day' ? (ST.wave === 0 ? 'Тихий вечер' : `День · волна ${ST.wave + 1}/${SIM.WAVES}`) : ST.phase === 'won' ? 'Огород спасён!' : 'Огород поглощён';
    const bw = Math.max(300, 60 + L.labelW('wave', nightTxt, { size: 34 })), bx = 900 - bw / 2;
    panel('wave', bx, 20, bw, 62, { c0: ST.phase === 'night' ? (ev === 'bloodmoon' ? [0.45, 0.05, 0.08] : [0.32, 0.08, 0.1]) : [0.16, 0.2, 0.26], c1: [0.08, 0.06, 0.08] });
    L.label('wave', nightTxt, bx + bw / 2, 46, { size: 34, al: 0.5, col: ST.phase === 'night' ? '#ffd0c8' : '#f6e7c8' });
    const prog = ST.phase === 'won' || ST.phase === 'lost' ? 1 : clamp(ST.pt / ST.plen, 0, 1); L.rrect(bx + 20, 70, bw - 40, 7, 3, [0.1, 0.08, 0.1], [0.1, 0.08, 0.1], 0.9);
    L.rrect(bx + 20, 70, (bw - 40) * prog, 7, 3, ST.phase === 'night' ? [0.95, 0.25, 0.25] : [0.95, 0.8, 0.4], ST.phase === 'night' ? [0.7, 0.1, 0.15] : [0.85, 0.6, 0.2], 1);
    const evk = ev || (ST.phase === 'day' && ST.dayEvent) || ''; if (evk && EVN[evk]) { const [ic, nm] = EVN[evk], s = nm + (ST.blackout ? ' — свет погас!' : ''), w = 80 + L.labelW('evp', s, { size: 24 });
      panel('evp', 900 - w / 2, 92, w, 44, { c0: [0.24, 0.1, 0.14] }); icon(ic, 900 - w / 2 + 30, 114, 34); L.label('evp', s, 900 - w / 2 + 56, 114, { size: 24, col: '#ffd0c8' }); }
    if (ST.phase === 'day' && ST.wave < SIM.WAVES) { const nb = SIM.NIGHT_BTN, s = 'Ночь ▶ +' + Math.floor(ST.plen - ST.pt); nb[0] = bx + bw + 14; nb[2] = 40 + L.labelW('nightbtn', s, { size: 26 });
      const hov = play && ST.sx > nb[0] && ST.sx < nb[0] + nb[2] && ST.sy > nb[1] && ST.sy < nb[1] + nb[3];
      panel('nightbtn', nb[0], nb[1], nb[2], nb[3], { c0: hov ? [0.55, 0.2, 0.22] : [0.42, 0.14, 0.16], c1: [0.22, 0.06, 0.08] }); L.label('nightbtn', s, nb[0] + nb[2] / 2, nb[1] + nb[3] / 2, { size: 26, al: 0.5 }); }
    minimap(ST, t);
    edgeAlerts(ST, GT, t);
    const bmax = SIM.BAL.torch.bat[SIM.torchLvl(ST)], bq = ST.bat / bmax;
    panel('bat', 1730, 952, 168, 36, { r: 18 }); L.rrect(1742, 962, 144 * bq, 16, 8, ST.batLock ? [0.9, 0.3, 0.25] : [1, 0.92, 0.6], ST.batLock ? [0.7, 0.15, 0.1] : [0.95, 0.7, 0.3], 1);
    toolbar(ST, play, t);
    if (ST.menu) buildMenu(ST, play);
    if (ST.toast && GT - ST.toast.t < 2) { const a = 1 - SS(1.5, 2, GT - ST.toast.t), w = 50 + L.labelW('toast', ST.toast.txt, { size: 28 });
      panel('toast', 860 - w / 2, ST.menu ? 800 : 900, w, 52, { a: 0.9 * a, r: 26 }); L.label('toast', ST.toast.txt, 860, (ST.menu ? 800 : 900) + 26, { size: 28, al: 0.5, a }); }
    for (const e of ST.ev) { const a = GT - e.t; if (a < 0 || a > 2.6) continue; const k = a < 0.25 ? SS(0, 0.25, a) : 1 - SS(2.0, 2.6, a);
      if (e.k === 'wave') { const E = EVN[e.event]; banner('Волна ' + e.n + (e.n === SIM.WAVES ? ' — последняя!' : e.n === 10 ? ' — вожак!' : ''), E ? E[1] + ': ' + E[2] : e.n >= 6 ? 'Матёрые твари бьют фонари' : 'Твари идут из Изнанки', k, '#ffb0a8'); }
      if (e.k === 'dawn') banner('Рассвет', `+${e.coins} монет` + (e.gems ? `, +${e.gems} алмаз за чистую ночь` : ''), k, '#ffe2a0');
      if (e.k === 'fair') banner('Ярмарка!', 'Весь день урожай дороже в 1,5 раза', k, '#ffe2a0');
      if (e.k === 'portal') banner('Открылся новый портал!', 'Смотри на мини-карту', k, '#ff8a8a');
      if (e.k === 'blackout') banner('Свет погас!', 'Фонари без генератора не горят', k, '#ffb07a');
      if (e.k === 'research') banner('Изучено', SIM.RESEARCH.find((r) => r.id === e.id).name, k, '#b8f0a8'); }
    if (ST.panel) drawBook(ST, play);
    if (ST.phase === 'won' || ST.phase === 'lost') endScreen(ST, GT);
    if (ST.tut) tutorial(ST, GT, play);
    if (play) drawCursor(ST, GT, t);
  }
  function minimap(ST, t) {
    const [mx, my, mw, mh] = SIM.MAP, k = mw / WW, ky = mh / H;
    panel('map', mx - 6, my - 4, mw + 12, mh + 8, { r: 10, c0: [0.1, 0.14, 0.1], c1: [0.06, 0.08, 0.06] });
    for (let r = 0; r < SIM.NR; r++) for (let c = 0; c < SIM.NC; c++) { const kk = r * SIM.NC + c, v = ST.flag[kk] ? 1 : ST.inf[kk] * 0.5; if (v < 0.1) continue;
      const [x, y] = SIM.cellXY(c, r); L.solid(mx + (x - SIM.CW / 2) * k, my + (y - SIM.CH / 2) * ky, SIM.CW * k, SIM.CH * ky, [0.7, 0.08, 0.14], 0, 0, 0, 0.75 * v); }
    SIM.PLOTS.forEach((P, i) => { const p = ST.plots[i], own = SIM.owned(ST, i); const col = !own ? [0.25, 0.3, 0.22] : p.dead ? [0.4, 0.35, 0.4] : p.crop >= 0 ? (p.g >= SIM.CROPS[p.crop].grow ? [1, 0.8, 0.3] : [0.4, 0.75, 0.35]) : [0.35, 0.25, 0.18];
      L.solid(mx + (P.x - 60) * k, my + (P.y - 50) * ky, 120 * k, 100 * ky, col, 0, 0, 0, own ? 0.95 : 0.5); });
    for (const p of ST.props) if (p.k !== 'salt') L.solid(mx + p.x * k - 1.5, my + (p.y - 40) * ky - 1.5, 3, 3, p.broken ? [1, 0.4, 0.3] : [1, 0.95, 0.7]);
    SIM.PORTALS.forEach((P, i) => { if (SIM.portalOpen(ST, i)) L.glow(mx + P.x * k, my + (P.y - 80) * ky, 9, [1, 0.15, 0.2], 1, 2); });
    for (const m of ST.mobs) if (m.st !== 'die') L.solid(mx + m.x * k - 2, my + m.y * ky - 2, 4, 4, m.kind === 'boss' ? [1, 0.2, 0.9] : [1, 0.2, 0.2]);
    const vx = mx + ST.cam * k; L.ring(vx + W * k / 2, my + mh / 2, W * k / 2, mh / 2 + 2, [1, 1, 1], 0.7, 0.04);
    const inf = SIM.infectedPlots(ST), lose = SIM.loseAt(ST), danger = inf >= lose - 4, s = `Огород ${SIM.ownedCount(ST) - inf}/${SIM.ownedCount(ST)}` + (danger ? ` · ещё ${lose - inf} — и конец` : '');
    const w = 40 + L.labelW('garden', s, { size: 24 }); panel('garden', mx + mw - w + 6, my + mh + 12, w, 40, { c0: danger ? [0.45, 0.1, 0.12] : [0.14, 0.2, 0.14] });
    L.label('garden', s, mx + mw - w + 26, my + mh + 32, { size: 24, col: danger ? '#ffb0a8' : '#d8f0c8' });
  }
  function edgeAlerts(ST, GT, t) {                                                    // red arrows when something attacks the garden off screen
    for (const side of [-1, 1]) { let n = 0; for (const m of ST.mobs) { if (m.st !== 'eat' && m.st !== 'smash' && !(m.st === 'seek' && m.tgt >= 0)) continue; const sx = m.x - ST.cam; if (side < 0 ? sx < -20 : sx > W + 20) n++; }
      for (const e of ST.ev) { const a = GT - e.t; if (e.k === 'plotlost' && a >= 0 && a < 3) { const sx = e.x - ST.cam; if (side < 0 ? sx < 0 : sx > W) n++; } }
      if (!n) continue; const x = side < 0 ? 40 : W - 40, y = 540, p = 0.6 + 0.4 * Math.sin(t * 8);
      L.glow(x, y, 70, [1, 0.15, 0.15], 0.5 * p, 2); panel('edgep' + side, x - 40, y - 28, 80, 56, { a: 0.75, r: 26, c0: [0.4, 0.08, 0.1] }); L.label('edge' + side, side < 0 ? '◀ ' + n : n + ' ▶', x, y, { size: 36, al: 0.5, col: '#ffd0c8', a: p }); }
  }
  function toolbar(ST, play, t) {
    const SL = SIM.SLOTS, r0 = SIM.slotRect(0), rN = SIM.slotRect(SL.length - 1);
    panel('bar', r0[0] - 16, SIM.SLOT.y - 12, rN[0] + SIM.SLOT.w + 32 - r0[0], SIM.SLOT.h + 24, { r: 18 });
    SL.forEach((k, i) => { const [sx, sy, sw, sh] = SIM.slotRect(i); let ic = 'ic_lock', sub = '', on = false, ok = true, hk = '';
      const rx = (id) => SIM.RESEARCH.find((r) => r.id === id).xp + ' оп';
      if (k.startsWith('seed')) { const ci = +k[4], C = SIM.CROPS[ci]; hk = String(ci + 1);
        if (SIM.cropUnlocked(ST, ci)) { ic = 'crop_' + C.id; sub = String(C.seed); on = ST.tool === 'scythe' && ST.seed === ci; ok = ST.coins >= C.seed; } else { sub = rx(C.id); ok = false; } }
      else if (k === 'build') { ic = BICON[SIM.BUILDS.includes(ST.tool) ? ST.tool : 'lamp']; sub = 'Стройка'; hk = 'Q'; on = !!ST.menu || SIM.BUILDS.includes(ST.tool); ok = SIM.BUILDS.some((b) => SIM.has(ST, b)); }
      else if (k === 'med') { ic = 'medicine'; sub = '1 алм'; on = ST.tool === 'med'; ok = ST.gems >= 1; hk = 'M'; }
      else if (k === 'gun') { if (SIM.has(ST, 'gun')) { ic = 'rifle'; sub = ST.owned.gun ? SIM.BAL.price.shot + '/выстр' : String(SIM.BAL.price.gun); on = ST.tool === 'gun'; ok = ST.owned.gun || ST.coins >= SIM.BAL.price.gun; } else { sub = rx('gun'); ok = false; } hk = 'G'; }
      else if (k === 'book') { ic = 'ic_book'; sub = 'Книга'; hk = 'B'; on = !!ST.panel; ok = SIM.RESEARCH.some((r) => !SIM.has(ST, r.id) && ST.xp >= r.xp && (!r.req || SIM.has(ST, r.req))); }
      const hov = play && ST.sx > sx && ST.sx < sx + sw && ST.sy > sy && ST.sy < sy + sh;
      L.rrect(sx, sy, sw, sh, 12, on ? [0.55, 0.42, 0.2] : hov ? [0.3, 0.25, 0.22] : [0.2, 0.16, 0.15], on ? [0.35, 0.24, 0.1] : [0.11, 0.09, 0.09], 1); L.uiBox('slot' + i, sx, sy, sw, sh, 2);
      if (on) L.ring(sx + sw / 2, sy + sh / 2, sw * 0.62, sh * 0.62, [1, 0.85, 0.4], 0.8, 0.05);
      const isz = ic.startsWith('crop_') ? (ic === 'crop_sunflower' ? 60 : 52) : ic === 'rifle' ? 52 : ic === 'lamp' || ic === 'search' || ic === 'garland' || ic === 'scarecrow' ? 60 : 46;
      icon(ic, sx + sw / 2, sy + 35, isz, ic === 'ic_lock' ? 0.85 : 1);
      if ((k === 'book' || k === 'build') && ok && k === 'book') L.glow(sx + sw - 12, sy + 12, 16, [1, 0.8, 0.3], 0.9 + 0.3 * Math.sin(t * 5), 2);
      L.label('sub' + i, sub, sx + sw / 2, sy + sh - 14, { size: 17, al: 0.5, col: ok ? '#f6e7c8' : '#c58c80' });
      if (hk) L.label('hk' + i, hk, sx + 9, sy + 13, { size: 15, col: '#bfae90' }); });
  }
  function buildMenu(ST, play) {
    const r0 = SIM.menuRect(0), rN = SIM.menuRect(SIM.BUILDS.length - 1); panel('bmenu', r0[0] - 12, r0[1] - 12, rN[0] + rN[2] + 24 - r0[0], r0[3] + 24, { r: 16, c0: [0.22, 0.17, 0.13] });
    SIM.BUILDS.forEach((k, i) => { const [x, y, w, h] = SIM.menuRect(i), okR = SIM.has(ST, k), price = SIM.priceOf(ST, k), ok = okR && ST.coins >= price && !(k === 'barn' && ST.built.barn);
      const hov = play && ST.sx > x && ST.sx < x + w && ST.sy > y && ST.sy < y + h;
      L.rrect(x, y, w, h, 12, ST.tool === k ? [0.55, 0.42, 0.2] : hov ? [0.34, 0.27, 0.22] : [0.18, 0.14, 0.12], [0.1, 0.08, 0.08], 1); L.uiBox('bm' + i, x, y, w, h, 2);
      icon(okR ? BICON[k] : 'ic_lock', x + w / 2, y + 36, okR ? (k === 'lamp' || k === 'search' || k === 'garland' || k === 'scarecrow' ? 60 : k === 'barn' ? 50 : 46) : 40, okR ? 1 : 0.8);
      L.label('bmn' + i, BNAME[k], x + w / 2, y + h - 30, { size: 16, al: 0.5, col: okR ? '#f6e7c8' : '#9a8a7a' });
      L.label('bmp' + i, okR ? (k === 'barn' && ST.built.barn ? 'есть' : String(price)) : SIM.RESEARCH.find((r) => r.id === k).xp + ' оп', x + w / 2, y + h - 12, { size: 16, al: 0.5, col: ok ? '#ffd76a' : '#c58c80' }); });
  }
  function banner(a, b, k, col) { if (k <= 0.02) return; const w = Math.max(520, 80 + L.labelW('bn2', b, { size: 30 }), 80 + L.labelW('bn1', a, { size: 56 }));
    panel('banner', 960 - w / 2, 300, w, 140, { a: 0.85 * k, r: 22 }); L.label('bn1', a, 960, 345, { size: 56, al: 0.5, col, a: k }); L.label('bn2', b, 960, 405, { size: 30, al: 0.5, a: k }); }
  function drawBook(ST, play) {
    const P = SIM.PANEL; L.rrect(0, 0, W, H, 0, [0, 0, 0], [0, 0, 0], 0.45);
    panel('book', P.x, P.y, P.w, P.h, { c0: [0.26, 0.2, 0.15], c1: [0.14, 0.1, 0.08], r: 24 });
    L.label('bookT', 'Книга изучения', P.x + 34, P.y + 46, { size: 40, col: '#ffe2a0' });
    L.label('bookXP', 'Опыт: ' + Math.floor(ST.xp), P.x + 430, P.y + 48, { size: 30, col: '#b8f0a8' });
    const cl = SIM.CLOSE; L.rrect(cl[0], cl[1], cl[2], cl[3], 14, [0.45, 0.16, 0.16], [0.25, 0.08, 0.08], 1); L.uiBox('close', cl[0], cl[1], cl[2], cl[3], 2); L.label('closeX', '×', cl[0] + 28, cl[1] + 27, { size: 40, al: 0.5 });
    const ICON = { carrot: 'crop_carrot', cabbage: 'crop_cabbage', garlic: 'crop_garlic', tomato: 'crop_tomato', sunflower: 'crop_sunflower', corn: 'crop_corn', pumpkin: 'crop_pumpkin',
      torch: 'flashlight', torch2: 'flashlight', autosow: 'ic_seed', gun: 'rifle', gun2: 'rifle', lamp2: 'lamp', lamp3: 'lamp', ...BICON };
    SIM.RESEARCH.forEach((R, i) => { const [x, y, w, h] = SIM.cardRect(i), done = SIM.has(ST, R.id), reqOk = !R.req || SIM.has(ST, R.req), can = !done && reqOk && ST.xp >= R.xp;
      const hov = play && ST.sx > x && ST.sx < x + w && ST.sy > y && ST.sy < y + h;
      L.rrect(x, y, w, h, 14, done ? [0.2, 0.32, 0.18] : can ? (hov ? [0.5, 0.4, 0.22] : [0.4, 0.31, 0.18]) : [0.2, 0.17, 0.15], done ? [0.12, 0.2, 0.1] : [0.12, 0.1, 0.09], 1); L.uiBox('card' + i, x, y, w, h, 3);
      const ic = ICON[R.id] || 'ic_book', tall = ic === 'lamp' || ic === 'search' || ic === 'garland' || ic === 'scarecrow' || ic === 'crop_sunflower';
      icon(ic, x + 40, y + 52, ic === 'flashlight' ? 24 : ic === 'rifle' ? 54 : tall ? 76 : 56, reqOk ? 1 : 0.4);
      L.label('cn' + i, R.name, x + w / 2 + 18, y + 26, { size: 18, al: 0.5, col: reqOk ? '#f6e7c8' : '#9a8a7a' });
      L.label('cd' + i, R.desc, x + w / 2 + 18, y + 84, { size: 14, al: 0.5, col: '#c8b8a0' });
      const pr = SIM.BAL.price[R.id], buy = Array.isArray(pr) ? `${pr[0]} мон./шт.` : R.id === 'gun' ? `${SIM.BAL.price.gun} мон.` : '';
      if (buy) L.label('cb' + i, buy, x + w / 2 + 18, y + 106, { size: 14, al: 0.5, col: '#d8c090' });
      const st = done ? 'Изучено' : !reqOk ? 'Нужно: ' + SIM.RESEARCH.find((r) => r.id === R.req).name : R.xp + ' опыта';
      L.label('cs' + i, st, x + w / 2, y + h - 22, { size: st.length > 15 ? 14 : 19, al: 0.5, col: done ? '#b8f0a8' : can ? '#ffe2a0' : reqOk ? '#c58c80' : '#9a8a7a' }); });
    L.label('bookHint', 'Опыт — на изучение, монеты — на постройку. Книга ставит игру на паузу.', P.x + P.w / 2, P.y + P.h - 24, { size: 19, al: 0.5, col: '#bfae90' });
  }
  function modeSelect(ST, play, t) {
    L.rrect(0, 0, W, H, 0, [0, 0, 0], [0, 0, 0], 0.4);
    panel('titlep', 400, 250, 1120, 290, { a: 0.75, r: 30 }); panel('keysp', 220, 812, 1480, 56, { a: 0.7, r: 26 });
    L.label('title', 'Огород у Изнанки', 960, 330, { size: 92, al: 0.5, col: '#ffd0c8' });
    L.label('sub', 'Защити урожай от Изнанки двадцать ночей', 960, 420, { size: 34, al: 0.5, col: '#f6e7c8' });
    L.label('pick', 'Выбери сложность', 960, 510, { size: 30, al: 0.5, col: '#bfae90' });
    SIM.MODES.forEach((Md, i) => { const [x, y, w, h] = SIM.modeRect(i), hov = play && ST.sx > x && ST.sx < x + w && ST.sy > y && ST.sy < y + h;
      panel('mode' + i, x, y, w, h, { c0: hov ? [0.45, 0.2, 0.2] : [[0.18, 0.28, 0.18], [0.3, 0.22, 0.14], [0.36, 0.08, 0.1]][i], c1: [0.08, 0.06, 0.07], r: 20 });
      icon(['ic_seed', 'ic_coin', 'ic_skull'][i], x + w / 2, y + 62, 72);
      L.label('mn' + i, Md.name, x + w / 2, y + 130, { size: 26, al: 0.5, col: '#ffe2a0' });
      L.label('md' + i, ['для знакомства', 'как задумано', 'для смелых'][i], x + w / 2, y + 168, { size: 19, al: 0.5, col: '#d8c8b0' }); });
    L.label('keys', SIM.HINT, 960, 840, { size: 22, al: 0.5, col: '#bfae90' });
    if (play) { L.glow(ST.sx, ST.sy, 20, [1, 0.95, 0.8], 0.5, 2.5); L.ring(ST.sx, ST.sy, 12, 12, [1, 1, 1], 0.9, 0.2); }
  }
  const TUT = [
    { title: 'День: сажай и продавай', col: '#ffe2a0', items: [
      ['ic_seed', 56, 'Клик по пустой грядке — посадить.', 'Семена внизу или клавиши 1–8.'],
      ['scythe', 64, 'Спелое срезай косой: зажми левую', 'кнопку и веди по грядкам.'],
      ['ic_coin', 56, 'Урожай сам летит в тележку', 'и даёт монеты и опыт.'],
      ['ic_book', 56, 'Опыт тратится в книге (B),', 'монеты — на стройку (Q).']] },
    { title: 'Опасность: разлом справа', col: '#ffb0a8', items: [
      ['ev_bloodmoon', 56, 'Красный разлом стоит на правом', 'краю карты. На мини-карте это', 'красная точка.'],
      ['ic_skull', 56, 'Ночью от него к огороду ползёт', 'зараза и идут твари: они едят', 'урожай и заражают грядки.'],
      ['', 0, 'На 6-й и 14-й ночи откроются новые', 'разломы: слева и на севере.'],
      ['', 0, 'Смотреть по сторонам: A/D', 'или мышь у края экрана.']] },
    { title: 'Ночь: свети фонариком', col: '#ffe2a0', items: [
      ['flashlight', 26, 'Правая кнопка или Пробел — фонарик:', 'жжёт заразу и гонит тварей.', 'Заряд кончается: следи за полоской.'],
      ['medicine', 60, 'Заражённую грядку лечит', 'лекарство: клавиша M, 1 алмаз.'],
      ['lamp', 90, 'Столбы и прожекторы светят сами:', 'изучи их в книге и построй.'],
      ['ic_skull', 56, null, 'Продержись 20 ночей.']] }];
  function tutorial(ST, GT, play) {
    const p = ST.tut, [x, y, w, h] = SIM.tutCard(p), P = TUT[p - 1], bob = 7 * Math.sin(GT * 5), PO = SIM.PORTALS[0];
    L.rrect(0, 0, W, H, 0, [0, 0, 0], [0, 0, 0], 0.22);
    panel('tutp', x, y, w, h, { r: 24, a: 0.97, c0: p === 2 ? [0.34, 0.1, 0.1] : [0.2, 0.16, 0.11], c1: [0.09, 0.07, 0.08] });
    L.label('tutn', `Шаг ${p} из ${SIM.TUT_PAGES}`, x + 34, y + 40, { size: 22, col: '#bfae90' });
    L.label('tutt' + p, P.title, x + 34, y + 88, { size: 38, col: P.col });
    let ly = y + 146;
    P.items.forEach((it, i) => { const lines = it.slice(2).map((s) => s === null ? `Заражено ${SIM.loseAt(ST)} из ${SIM.ownedCount(ST)} грядок — поражение.` : s), rowH = lines.length * 33;
      if (it[0]) icon(it[0], x + 62, ly + rowH / 2 - 16, it[1]);
      lines.forEach((s, j) => L.label(`tutl${p}_${i}_${j}`, s, x + 112, ly + j * 33, { size: 24 }));
      ly += rowH + 26; });
    const btn = (id, r, txt, c0, col) => { const hov = play && ST.sx > r[0] && ST.sx < r[0] + r[2] && ST.sy > r[1] && ST.sy < r[1] + r[3];
      panel(id, r[0], r[1], r[2], r[3], { r: 29, c0: hov ? [0.5, 0.36, 0.2] : c0, c1: [0.1, 0.08, 0.08] }); L.label(id, txt, r[0] + r[2] / 2, r[1] + r[3] / 2, { size: 26, al: 0.5, col }); };
    if (p < SIM.TUT_PAGES) btn('tutskip', SIM.tutSkip(p), 'Пропустить', [0.16, 0.13, 0.12], '#bfae90');
    btn('tutnext' + p, SIM.tutNext(p), p < SIM.TUT_PAGES ? 'Дальше ▶' : 'Играть ▶', [0.42, 0.28, 0.12], '#ffe2a0');
    const mark = (id, s, mx, my) => { L.label('tutm' + id, s, mx, my - 44, { size: 28, al: 0.5, col: '#ffe2a0' }); L.label('tuta' + id, '▼', mx, my + bob, { size: 30, al: 0.5, col: '#ffe2a0' }); };
    if (p === 1) { const s = SIM.slotRect(0), [cx, cy] = SIM.cellXY(SIM.SECTS[0].c0 + 1.5, 1); mark('seed', 'Семена', s[0] + s[2] / 2, s[1] - 26); mark('cart', 'Тележка', SIM.CART.x - ST.cam, SIM.CART.y - 165); mark('beds', 'Огород', cx - ST.cam, cy - 96); }
    if (p === 2) { const rx = PO.x - ST.cam, [mx, my, mw, mh] = SIM.MAP; L.label('tutmr', 'Разлом Изнанки', rx - 330, PO.y - 150, { size: 34, al: 0.5, col: '#ffb0a8' }); L.label('tutar', '▶', rx - 170 + bob, PO.y - 150, { size: 34, al: 0.5, col: '#ffb0a8' });
      L.ring(mx + PO.x * mw / WW, my + (PO.y - 80) * mh / H, 24, 24, [1, 0.8, 0.7], 0.6 + 0.3 * Math.sin(GT * 5), 0.12); }
    if (p === 3) { mark('bat', 'Заряд', 1814, 930); mark('hand', 'Фонарик', SIM.HAND.x - 40, 960); }
  }
  function endScreen(ST, GT) { const k = SS(0, 0.8, ST.pt), won = ST.phase === 'won';
    L.rrect(0, 0, W, H, 0, [0, 0, 0], [0, 0, 0], 0.5 * k);
    panel('end', 500, 230, 920, 520, { a: 0.95 * k, r: 26, c0: won ? [0.2, 0.3, 0.18] : [0.34, 0.1, 0.1] });
    L.label('endT', won ? 'Огород спасён!' : 'Изнанка поглотила огород', 960, 300, { size: 50, al: 0.5, col: won ? '#ffe2a0' : '#ffb0a8', a: k });
    const s = ST.stats, lines = [`Сложность: ${SIM.MODES[ST.mode].name} · волна ${ST.wave}/${SIM.WAVES}`, `Собрано урожая: ${s.harvest} (золотых тыкв: ${s.gold})`, `Заработано: ${ST.earned} монет`,
      `Тварей отпугнуто: ${s.scared}, уничтожено: ${s.killed}`, `Грядок заражено: ${s.lost}`];
    lines.forEach((ln, i) => L.label('endL' + i, ln, 960, 380 + i * 46, { size: 28, al: 0.5, a: k }));
    L.label('endR', 'Клик — в меню', 960, 690, { size: 28, al: 0.5, col: '#ffe2a0', a: k * (0.6 + 0.4 * Math.sin(GT * 4)) }); }
  function drawCursor(ST, GT, t) {
    const x = ST.sx, y = ST.sy, overUI = ST.panel || ST.tut || y > SIM.SLOT.y - 20 || y < 130 || (ST.menu && y > SIM.SLOT.y - 130), tool = overUI || ST.phase === 'won' || ST.phase === 'lost' ? 'ui' : ST.tool;
    if (tool === 'ui') { L.glow(x, y, 20, [1, 0.95, 0.8], 0.5, 2.5); L.ring(x, y, 12, 12, [1, 1, 1], 0.9, 0.2); return; }
    if (tool === 'scythe') { const cr = SIM.cellAt(ST.x, ST.y), si = cr ? SIM.secAt(cr[0], cr[1]) : -1;
      if (si >= 0 && !ST.sec[si]) { const s = 'Купить участок: ' + SIM.SECTS[si].price, w = 30 + L.labelW('buytip', s, { size: 24 }); panel('buytip', x + 24, y + 10, w, 40); L.label('buytip', s, x + 39, y + 30, { size: 24, col: ST.coins >= SIM.SECTS[si].price ? '#ffe2a0' : '#d8a898' }); }
      const sw = ST.press ? -0.5 * Math.sin(GT * 18) : 0.15 * Math.sin(t * 2), w = 120, h = w / L.hsz('scythe', 1);
      L.sprite('scythe', 0, 0, { m: M.of(M.t(x, y), M.r(sw)), w, h, pivot: [w * 0.112, h * 0.264] }); return; }
    if (tool === 'gun') { const c = [1, 0.9, 0.7], R = SIM.has(ST, 'gun2') ? 95 : 34; L.ring(x, y, R, R, c, 0.95, 0.09 * 34 / R); L.solid(x - 46, y - 1.5, 30, 3, c); L.solid(x + 16, y - 1.5, 30, 3, c); L.solid(x - 1.5, y - 46, 3, 30, c); L.solid(x - 1.5, y + 16, 3, 30, c);
      if (ST.gunCd > 0) L.ring(x, y, R + 10, R + 10, [1, 0.6, 0.4], 0.6 * ST.gunCd / 0.55, 0.06); return; }
    if (tool === 'med') { const cr = SIM.cellAt(ST.x, ST.y); if (cr) { const [cx0, cy0] = SIM.cellXY(cr[0], cr[1]); L.rrect(cx0 - ST.cam - SIM.CW * 1.5, cy0 - SIM.CH * 1.5, SIM.CW * 3, SIM.CH * 3, 20, [0.3, 1, 0.75], [0.2, 0.7, 0.55], 0.16); }
      icon('medicine', x + 10, y - 20, 70); return; }
    const cr = SIM.cellAt(ST.x, ST.y); if (!cr) return; const [gx0, gy] = SIM.cellXY(cr[0], cr[1]), gx = gx0 - ST.cam, ok = SIM.buildable(ST, cr[0], cr[1]) && ST.coins >= SIM.priceOf(ST, tool);   // build ghost
    const R = { lamp: SIM.BAL.lightR.lamp, garland: SIM.BAL.lightR.garland, scarecrow: SIM.BAL.lightR.scarecrow, generator: SIM.BAL.genR, sprinkler: SIM.BAL.sprinkR, turret: SIM.BAL.turretR }[tool] || 70;
    L.ring(gx, gy + 30, R, R / 1.18, ok ? [0.6, 1, 0.6] : [1, 0.4, 0.35], 0.6, 0.02);
    if (tool === 'salt') spr('salt', gx, gy + 40, SZ.salt, { u: { alpha: 0.7 } });
    else spr(tool, gx, gy + 34, SZ[tool], { u: { alpha: 0.6, tint: ok ? [0.7, 1, 0.7, 0.3] : [1, 0.4, 0.35, 0.5] } });
  }

  // ---------------------------------------------------------------- QA hooks (scripts/qa.mjs)
  S.QA = () => {
    const run = (S0, sec) => { for (let i = 0; i < sec * 120; i++) SIM.step(S0, { wx: S0.x, wy: S0.y, cam: S0.cam }); return S0; };
    const base = () => run(Object.assign(SIM.create(5, 1)), 1);
    const night = () => { const s = SIM.demoStart(); s.pt = s.plen - 0.01; run(s, 9); return s; };
    const rich = () => { const s = base(); s.coins = 99999; s.xp = 99999; s.gems = 999; return s; };
    const book = () => { const s = rich(); s.panel = 1; s.res = { carrot: 1, lamp: 1, garland: 1, salt: 1 }; s.sx = 700; s.sy = 400; return s; };
    const menuS = () => Object.assign(SIM.create(5, 1), { phase: 'menu', sx: 760, sy: 640 });
    const bmenu = () => { const s = rich(); s.menu = 1; SIM.BUILDS.forEach((b) => (s.res[b] = 1)); s.built.barn = 1; return s; };
    const lost = () => { const s = rich(); s.phase = 'lost'; s.pt = 3; s.stats = { harvest: 99999, sold: 99999, scared: 9999, killed: 9999, lost: 999, eaten: 999, gold: 99 }; s.earned = 9999999; s.wave = 20; s.mode = 2; return s; };
    const won = () => Object.assign(lost(), { phase: 'won' });
    const toastS = () => { const s = rich(); s.toast = { txt: 'Сначала: Фонарный столб — изучи в книге', t: s.t }; return s; };
    const beam = (x, y) => () => { const s = night(); s.sx = x; s.sy = y; s.x = x + s.cam; s.y = y; s.beam = 1; return s; };
    const mob = (id, x, y, o) => Object.assign({ id, kind: 'mob', pi: 0, x, y, st: 'seek', t0: -5, fear: 0, fearMax: 1, hp: 1, tgt: -1, face: -1, dist: x * 0.7, side: 1, hit: -9, lit: -9, ph: id * 0.37, sz: 1, alt: 0, under: 0 }, o);
    const monsters = () => { const s = night(); const X0 = s.cam;
      s.mobs = [mob(1, X0 + 1320, 560), mob(2, X0 + 1480, 700, { kind: 'big', sz: 1.3 }), mob(3, X0 + 1250, 860, { kind: 'boss', sz: 1.75, fearMax: 7 }), mob(4, X0 + 1100, 520, { kind: 'jumper', sz: 0.85 }),
        mob(5, X0 + 1650, 400, { kind: 'flyer', sz: 0.8, alt: 130 }), mob(6, X0 + 1000, 760, { kind: 'digger', st: 'eat', under: 0 }), mob(7, X0 + 1560, 820, { kind: 'digger', st: 'burrow', under: 1 }),
        mob(8, X0 + 1400, 620, { kind: 'swarm', sz: 0.42 }), mob(9, X0 + 1440, 640, { kind: 'swarm', sz: 0.42 }), mob(10, X0 + 1380, 660, { kind: 'swarm', sz: 0.42 })];
      return s; };
    const props = () => { const s = night(); s.event = 'storm'; s.props = []; const put = (k, c, r, o = {}) => { const [x, y] = SIM.cellXY(c, r); s.props.push(Object.assign({ k, c, r, x, y: y + (k === 'salt' ? 0 : 30), t0: -9, a0: 3.4, ph: c, hp: 1, cd: 0 }, o)); };
      put('turret', 14, 1); put('generator', 19, 1); put('scarecrow', 14, 3); put('sprinkler', 19, 3); put('barn', 14, 5); put('salt', 20, 5); put('salt', 21, 5); put('lamp', 19, 5, { broken: 1 }); put('garland', 24, 2);
      s.plots.forEach((p, i) => { if (SIM.owned(s, i)) { const c = [5, 3, 7, 5][i % 4]; p.crop = c; p.g = SIM.CROPS[c].grow; p.gold = c === 7 ? 1 : 0; } }); return s; };
    const fog = () => Object.assign(night(), { event: 'fog' }), blood = () => Object.assign(night(), { event: 'bloodmoon' });
    const NF = 16, CYC = 2 * STEP, walk = []; for (let i = 0; i < NF; i++) { const s = SIM.demoStart(); s.mobs = [mob(1, s.cam + 1300 - i * CYC / NF, 640, { dist: i * CYC / NF, ph: 0.3 })]; walk.push(s); }
    const tutS = (p) => { const s = Object.assign(base(), { tut: p, sx: 1000, sy: 500 }); if (p === 2) s.cam = SIM.WORLD.W - W; return s; };
    return { states: [['start', base()], ['menu', menuS()], ['tut1', tutS(1)], ['tut2', tutS(2)], ['tut3', tutS(3)], ['night', night()], ['monsters', monsters()], ['props', props()], ['fog', fog()], ['blood', blood()], ['book', book()], ['buildmenu', bmenu()],
        ['lost', lost()], ['won', won()], ['toast', toastS()], ['beam', beam(1300, 400)()], ['beamFar', beam(200, 200)()], ['beamLow', beam(1500, 900)()], ['match', beam(1500, 640)()]],
      cycles: { mobWalk: walk }, sprites: { mobWalk: ['mob_body', 'mob_arm', 'mob_leg'] }, subject: { mobWalk: 'mob1' }, actors: ['mobWalk'], cycleT: { mobWalk: CYC / 74 },
      box: (n, s) => [1000, 380, 420, 320] };
  };
})();
