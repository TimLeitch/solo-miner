/* Solo Miner - the sortie (in-flight mining) scene. Canvas world + DOM HUD. */
window.SM = window.SM || {};

SM.Sortie = (function () {
  const D = SM.DATA, M = D.MATERIALS;
  const BS = 34;              // block size (world units)
  const AP_CLOSE = BS * 1.4;  // autopilot parks this close to its target so the escort wing has blocks in reach
  const W = 1400, H = 2100;   // world size
  const SHIP_R = 13;

  let canvas, g, dpr = 1, cw = 0, ch = 0, scale = 1;
  let running = false, paused = false, raf = 0, lastT = 0;
  let w = null;               // world state for the current run
  let cb = {};                // callbacks {onEnd}
  const input = { stick: null, mine: false, boost: false, keys: {} };
  let hudTimer = 0;
  let TH = { level: 1, hp: 1, value: 1, hazard: 1 }; // threat scaling for the current sortie

  const $ = id => document.getElementById(id);

  // ---------- helpers ----------
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(weights) {
    let tot = 0; for (const k in weights) tot += weights[k];
    let r = Math.random() * tot;
    for (const k in weights) { r -= weights[k]; if (r <= 0) return k; }
    return Object.keys(weights)[0];
  }
  function key(gx, gy) { return gx * 100000 + gy; }
  function settings() { return SM.State.get().settings; }
  function vibrate(ms) { if (settings().vibration && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} }
  function caption(text, kind) {
    if (!settings().captions && kind !== 'force') return;
    const el = $('captions');
    if (el.lastChild && el.lastChild.textContent === text && !el.lastChild.classList.contains('out')) return; // no duplicate spam
    const d = document.createElement('div');
    d.className = 'caption ' + (kind || '');
    d.textContent = text;
    el.appendChild(d);
    setTimeout(() => d.classList.add('out'), 2200);
    setTimeout(() => d.remove(), 2700);
    while (el.children.length > 3) el.firstChild.remove();
  }

  // ---------- world generation ----------
  function generate(region, tutorial) {
    const blocks = [], grid = new Map();
    const dock = { x: W / 2, y: H - 140 };
    function place(gx, gy, mat, hpFrac) {
      const k = key(gx, gy);
      if (grid.has(k) || gx < 1 || gy < 1 || gx * BS > W - BS || gy * BS > H - BS) return;
      const cx = gx * BS + BS / 2, cy = gy * BS + BS / 2;
      if (Math.hypot(cx - dock.x, cy - dock.y) < 150) return; // keep the dock clear
      const m = M[mat];
      const hp = m.health * TH.hp;
      const b = { gx, gy, x: cx, y: cy, mat, value: Math.round(m.value * TH.value), maxHp: hp, hp: hp * (hpFrac || 1),
        alive: true, seed: Math.random() * 1000, flash: 0 };
      blocks.push(b); grid.set(k, b);
    }
    const centers = [];
    // find a spot at least `gap` from every other deposit (gives up after 40 tries)
    function spot(gap, margin) {
      let cx, cy, tries = 0;
      const m = margin || 240;
      do { cx = rand(m, W - m); cy = rand(m, H - 460); tries++; }
      while (tries < 40 && centers.some(p => Math.hypot(p.x - cx, p.y - cy) < gap));
      const p = { x: cx, y: cy }; centers.push(p); return p;
    }
    // a wobbly round deposit; hollow = geode (thick shell, empty gap, rich centre)
    function blob(cx, cy, R, hollow) {
      const gcx = Math.round(cx / BS), gcy = Math.round(cy / BS), n = Math.ceil(R * 1.4) + 1;
      const wob = [rand(0, 6), rand(0.3, 0.9), rand(0, 6), rand(0.2, 0.6)];
      for (let dx = -n; dx <= n; dx++) for (let dy = -n; dy <= n; dy++) {
        const a = Math.atan2(dy, dx);
        const edge = R * (1 + 0.22 * Math.sin(a * 3 + wob[0]) * wob[1] + 0.15 * Math.sin(a * 5 + wob[2]) * wob[3]);
        const d = Math.hypot(dx, dy);
        if (d > edge) continue;
        if (hollow) {
          if (d < edge * 0.36) place(gcx + dx, gcy + dy, pick(region.core));
          else if (d > edge - 1.8) place(gcx + dx, gcy + dy, pick(region.shell));
        } else place(gcx + dx, gcy + dy, pick(d < edge * 0.45 ? region.core : region.shell));
      }
    }
    // gravity wells come first so the 'ring' layout can wrap rock around them
    const wells = [];
    for (let i = 0; i < (region.wells || 0); i++) {
      const p = spot(560, 300);
      wells.push({ x: p.x, y: p.y, r: 270, core: 26, t: rand(0, 6) });
    }
    const layout = region.layout || 'clusters';
    if (layout === 'clusters') {
      for (let c = 0; c < region.clusters; c++) { const p = spot(350); blob(p.x, p.y, rand(4, 6.5)); }
    } else if (layout === 'scatter') {
      for (let c = 0; c < region.clusters * 4; c++) { const p = spot(150, 120); blob(p.x, p.y, rand(2, 3.6)); }
    } else if (layout === 'geodes') {
      for (let c = 0; c < region.clusters; c++) { const p = spot(330); blob(p.x, p.y, rand(5.5, 7.5), true); }
    } else if (layout === 'veins') {
      // long seams: a wavy line of rock, ore richest along its middle
      for (let c = 0; c < Math.round(region.clusters * 1.6); c++) {
        const p = spot(220, 160);
        const len = rand(12, 22), a0 = rand(0, Math.PI), bend = rand(-0.08, 0.08), hw0 = rand(1.4, 2.3);
        let x = p.x / BS - Math.cos(a0) * len / 2, y = p.y / BS - Math.sin(a0) * len / 2, a = a0;
        for (let t = 0; t <= len; t += 0.5) {
          const hw = hw0 * (0.7 + 0.5 * Math.sin(t * 0.7 + c));
          const nx = -Math.sin(a), ny = Math.cos(a);
          for (let o = -hw; o <= hw; o += 0.5) place(Math.round(x + nx * o), Math.round(y + ny * o), pick(Math.abs(o) < hw * 0.4 ? region.core : region.shell));
          x += Math.cos(a) * 0.5; y += Math.sin(a) * 0.5; a += bend;
        }
      }
    } else if (layout === 'ring') {
      // a ring of rock around each gravity well; the rich stuff is on the inside edge
      const hubs = wells.length ? wells : [{ x: W / 2, y: H / 2 - 200 }];
      hubs.forEach(h => {
        const gcx = Math.round(h.x / BS), gcy = Math.round(h.y / BS), ri = rand(3.6, 4.6), ro = ri + rand(3.4, 4.6), ph = rand(0, 6);
        const n = Math.ceil(ro) + 1;
        for (let dx = -n; dx <= n; dx++) for (let dy = -n; dy <= n; dy++) {
          const d = Math.hypot(dx, dy), a = Math.atan2(dy, dx), wo = 0.6 * Math.sin(a * 4 + ph);
          if (d < ri + wo || d > ro + wo) continue;
          if (Math.sin(a * 3 + ph) > 0.93) continue; // a few gaps to fly through
          place(gcx + dx, gcy + dy, pick(d < ri + wo + 1.3 ? region.core : region.shell));
        }
      });
      for (let c = 0; c < region.clusters; c++) { const p = spot(260); blob(p.x, p.y, rand(2.8, 4.5)); }
    } else if (layout === 'walls') {
      // barricades: bands of rock across the field with a couple of gaps, rich pockets between them
      const cols = Math.floor(W / BS);
      for (let y = 7; y * BS < H - 520; y += Math.round(rand(6, 8))) {
        const thick = Math.round(rand(2, 3)), gaps = [rand(3, cols - 6), rand(3, cols - 6)];
        for (let gx = 1; gx < cols; gx++) {
          if (gaps.some(g0 => gx >= g0 && gx < g0 + 3.5)) continue;
          for (let k = 0; k < thick; k++) place(gx, y + k, pick(region.shell));
        }
        for (let k = 0; k < 2; k++) {
          const px = Math.round(rand(4, cols - 4)), py = y + thick + 2;
          centers.push({ x: px * BS, y: py * BS });
          for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) if (Math.abs(dx) + Math.abs(dy) < 3) place(px + dx, py + dy, pick(region.core));
        }
      }
    }
    // a few loose blocks drifting near the dock so the first targets are close
    for (let i = 0; i < 10; i++) {
      const gx = Math.round(rand(dock.x - 360, dock.x + 360) / BS);
      const gy = Math.round(rand(dock.y - 480, dock.y - 170) / BS);
      place(gx, gy, pick(region.shell));
    }
    // giant hollow rocks (DATA.GIANT): a shell the ship can't hurt around a core only the hand drill can cut
    const giants = placeGiants(region, tutorial, blocks, grid, dock, wells);
    if (tutorial) { // the README's "one damaged common block"
      const gx = Math.floor(dock.x / BS), gy = Math.floor((dock.y - 200) / BS);
      grid.delete(key(gx, gy));
      for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].gx === gx && blocks[i].gy === gy) blocks.splice(i, 1);
      place(gx, gy + 0, 'rock', 0.45);
      const t = grid.get(key(gx, gy)); if (t) t.tutorial = true;
    }
    // debris
    const debris = [];
    const dcount = region.debris.count + Math.floor(Math.log2(TH.level));
    for (let i = 0; i < dcount; i++) debris.push(newDebris(region, dock));
    // electrical fields
    const fields = [];
    for (let i = 0; i < region.fields; i++) {
      fields.push({ x: rand(150, W - 150), y: rand(150, H - 500), r: rand(70, 115), t: rand(0, 6) });
    }
    // relics: small salvage only the miner can pick up on a spacewalk
    const relics = [];
    if (!centers.length) centers.push({ x: W / 2, y: H / 2 - 200 });
    for (let i = 0, tries = 0; i < D.EVA.relicsPerField && tries < 200; tries++) {
      const c = centers[Math.floor(Math.random() * centers.length)];
      const x = c.x + rand(-200, 200), y = c.y + rand(-200, 200);
      if (x < 40 || y < 40 || x > W - 40 || y > H - 300) continue;
      if (grid.has(key(Math.floor(x / BS), Math.floor(y / BS)))) continue;
      relics.push({ x, y, value: Math.round((region.relic || 60) * TH.value * rand(0.8, 1.3)), alive: true, t: rand(0, 6) });
      i++;
    }
    // stars
    const stars = [];
    for (let i = 0; i < 260; i++) stars.push({ x: rand(0, W), y: rand(0, H), z: rand(0.2, 1), s: rand(0.5, 1.8) });
    // proximity mines (kept away from the dock and from rock so they sit in the open lanes)
    const mines = [];
    for (let i = 0, tries = 0; i < (region.mines || 0) && tries < 400; tries++) {
      const x = rand(80, W - 80), y = rand(80, H - 380);
      if (Math.hypot(x - dock.x, y - dock.y) < 380 || grid.has(key(Math.floor(x / BS), Math.floor(y / BS)))) continue;
      if (mines.some(m => Math.hypot(m.x - x, m.y - y) < 160)) continue;
      mines.push({ x, y, arm: -1, alive: true, t: rand(0, 6) }); i++;
    }
    // scavenger drones: they fly to the nearest block and eat it. Shoot them for a bounty.
    const foes = [];
    for (let i = 0; i < (region.scavs || 0); i++) {
      let x, y; do { x = rand(80, W - 80); y = rand(80, H - 600); } while (Math.hypot(x - dock.x, y - dock.y) < 600);
      const hp = M.scav.health * TH.hp;
      foes.push({ foe: true, mat: 'scav', x, y, vx: 0, vy: 0, a: 0, hp, maxHp: hp, value: Math.round(M.scav.value * TH.value),
        alive: true, seed: rand(0, 1000), flash: 0, prey: null, eat: 0, wait: rand(2, 6) });
    }
    const regrow = blocks.filter(b => M[b.mat].regen);
    const left = blocks.filter(b => !b.giant).length; // giant cells only count once the shell opens
    return { blocks, grid, dock, debris, fields, stars, relics, wells, mines, foes, regrow, giants, left };
  }
  function placeGiants(region, tutorial, blocks, grid, dock, wells) {
    const GI = D.GIANT, tier = Math.max(0, D.REGIONS.indexOf(region)), giants = [];
    const n = tutorial ? 0 : D.giantCount(region);
    const size = GI.size + (tier >= GI.bigFrom ? 1 : 0), tmul = 1 + GI.tierHp * tier, rv = (region.relic || 60) * TH.value;
    const last = size - 1, cols = Math.floor(W / BS), rows = Math.floor((H - 700) / BS);
    for (let i = 0, tries = 0; i < n && tries < 80; tries++) {
      const gx0 = Math.round(rand(3, cols - size - 3)), gy0 = Math.round(rand(3, rows - size));
      const cx = (gx0 + size / 2) * BS, cy = (gy0 + size / 2) * BS;
      if (Math.hypot(cx - dock.x, cy - dock.y) < 520) continue;
      if (wells.some(wl => Math.hypot(wl.x - cx, wl.y - cy) < wl.r + size * BS * 0.75)) continue;
      if (giants.some(o => Math.hypot(o.x - cx, o.y - cy) < (o.size + size + 4) * BS * 0.6)) continue;
      // clear the footprint plus a 2-cell moat so the ship can park at the hatch
      for (let dx = -2; dx < size + 2; dx++) for (let dy = -2; dy < size + 2; dy++) {
        const k = key(gx0 + dx, gy0 + dy), b = grid.get(k);
        if (b) { grid.delete(k); b.gone = true; }
      }
      // the hatch sits in the middle of the side that faces the dock (or a random side)
      const sides = [[Math.floor(size / 2), last, 0, 1], [Math.floor(size / 2), 0, 0, -1], [0, Math.floor(size / 2), -1, 0], [last, Math.floor(size / 2), 1, 0]];
      const side = Math.random() < 0.6 ? sides[0] : sides[Math.floor(rand(0, 4))];
      const G = { x: cx, y: cy, gx0, gy0, size, tier, cells: [], core: 0, coreLeft: 0, shellLeft: 0, open: false, cracked: false, started: false,
        jackpot: Math.round(rv * GI.jackpot), hgx: gx0 + side[0], hgy: gy0 + side[1], nx: side[2], ny: side[3] };
      G.hx = G.hgx * BS + BS / 2; G.hy = G.hgy * BS + BS / 2;
      for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) {
        const edge = dx === 0 || dy === 0 || dx === last || dy === last;
        if (edge && (dx === 0 || dx === last) && (dy === 0 || dy === last)) continue; // cut corners
        const gx = gx0 + dx, gy = gy0 + dy;
        const part = !edge ? 'core' : (gx === G.hgx && gy === G.hgy ? 'hatch' : 'shell');
        const hp = (part === 'core' ? GI.coreHp : GI.shellHp) * tmul * TH.hp;
        const b = { gx, gy, x: gx * BS + BS / 2, y: gy * BS + BS / 2, mat: part === 'core' ? pick(region.core) : 'crust',
          value: Math.round(rv * (part === 'core' ? GI.coreValue * rand(0.8, 1.25) : GI.shellValue)),
          maxHp: hp, hp, alive: true, seed: Math.random() * 1000, flash: 0, giant: G, part };
        blocks.push(b); grid.set(key(gx, gy), b); G.cells.push(b);
        if (part === 'core') G.core++; else G.shellLeft++;
      }
      G.coreLeft = G.core;
      giants.push(G); i++;
    }
    if (giants.length) for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].gone) blocks.splice(i, 1);
    return giants;
  }
  // Giant rock rules: the ship (laser, weapons, wing, scavengers) can only hurt an opened shell;
  // the hand drill can cut the core, but never a closed shell.
  function shipCan(b) { return !b.giant || (b.giant.open && b.part !== 'core'); }
  function drillCan(b) { return !b.giant || b.part === 'core' || b.giant.open; }
  function inGiant(p) { return w.giants.some(G => !G.cracked && Math.abs(p.x - G.x) < G.size * BS / 2 && Math.abs(p.y - G.y) < G.size * BS / 2); }
  function newDebris(region, dock) {
    let x, y;
    do { x = rand(60, W - 60); y = rand(60, H - 300); } while (dock && Math.hypot(x - dock.x, y - dock.y) < 400);
    const a = rand(0, Math.PI * 2), sp = region.debris.speed * Math.min(1.8, Math.pow(TH.hazard, 0.6)) * rand(0.6, 1.2);
    return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(9, 17), rot: 0, vr: rand(-2, 2) };
  }

  // ---------- lifecycle ----------
  function init() {
    canvas = $('game');
    g = canvas.getContext('2d');
    window.addEventListener('resize', resize);
    resize();
    bindInput();
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = window.innerWidth; ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    scale = Math.min(cw / 380, ch / 640);
    if (cw > ch) scale = Math.min(cw / 900, ch / 560); // landscape: see more of the field
  }

  function start(regionId, callbacks) {
    cb = callbacks || {};
    const st = SM.State.get();
    const region = D.REGIONS.find(r => r.id === regionId);
    const S = SM.State.stats();
    TH = SM.State.threat();
    const world = generate(region, st.tutorial);
    w = Object.assign(world, {
      region, S,
      ship: { x: world.dock.x, y: world.dock.y - 30, vx: 0, vy: 0, a: -Math.PI / 2, inv: 0, thrust: 0 },
      hull: Math.min(st.hull, S.hull), hullStart: Math.min(st.hull, S.hull),
      fuel: S.fuel, energy: S.energy, heat: 0, overheated: false,
      time: D.BASE.sortieTime * (S.fuel / D.BASE.fuel), elapsed: 0,
      credits: 0, byMat: {}, byMatCr: {}, broken: 0, xp: 0, damaged: false,
      target: null, firing: false, hitTick: 0,
      particles: [], pops: [], shake: 0,
      cam: { x: world.dock.x, y: world.dock.y - 200 },
      warned: {}, tut: st.tutorial ? 0 : -1, ended: false,
      boosting: false,
      wing: [], eva: false, miner: null, o2: 0, relicCount: 0, relicCredits: 0,
      proj: [], fx: [], ammo: {}, maxAmmo: {}, weapon: null, salvage: 0, ammoRun: 0, ammoWallet: 0, shotsBought: 0, shotsSalvaged: 0,
      autoCd: 2, loadCd: 0, autoShots: 0, autoLoads: 0,
      left: world.left, startRegion: region, giantsCracked: 0, giantCr: 0, cleared: 0, surveyed: {}, fieldCr: 0, clearBonus: 0,
      booms: [], flare: region.flares ? region.flares.every * 0.6 : 0, flareOn: 0, windA: rand(0, Math.PI * 2), foeKills: 0,
      // ship weapons & systems (DATA.SHIP_GEAR)
      splitTarget: null, gunTarget: null, gunTick: 0, gunSide: 1, sentries: [], sentryCd: 1, pdCd: 0, deflect: 0,
      wantFire: false, pdZaps: 0, deflected: 0,
      events: [], event: null, derelict: null, // rare sortie events (DATA.EVENTS)
      look: SM.Meta.look(), // cosmetics
    });
    w.event = rollEvent(region, st.tutorial);
    st.wing.drones.forEach((cfg, i, all) => {
      const ph = i / all.length * Math.PI * 2;
      const pod = D.WING.weapons.find(m => m.id === 'pod');
      w.wing.push({ n: i + 1, x: w.ship.x + Math.cos(ph) * 40, y: w.ship.y + Math.sin(ph) * 40, vx: 0, vy: 0, a: 0, phase: ph,
        target: null, heat: 0, venting: false, firing: false, st: SM.State.droneStats(cfg), weapon: cfg.weapon, gear: cfg.gear,
        wcd: 1 + i * 0.7, gcd: 0, ammo: cfg.weapon === 'pod' ? pod.ammo : 0, relic: null });
    });
    w.o2 = S.evaO2;
    applyEvaUi();
    const wp = st.weapons;
    Object.keys(wp.owned).forEach(id => { if (wp.owned[id]) w.ammo[id] = w.maxAmmo[id] = SM.State.weaponStats(id).ammo; });
    w.weapon = wp.owned[wp.equipped] ? wp.equipped : (Object.keys(w.ammo)[0] || null);
    $('wpnWrap').hidden = !w.weapon;
    $('btnSwap').hidden = Object.keys(w.ammo).length < 2;
    $('tglWpn').hidden = !w.weapon || !SM.State.autoLvl('fcs');
    input.mine = false; input.boost = false; input.stick = null;
    paused = false; running = true;
    document.body.classList.add('in-sortie');
    $('sortie').hidden = false;
    $('pauseMenu').hidden = true;
    $('captions').innerHTML = '';
    $('regionLabel').textContent = `${region.name} - Threat ${TH.level.toFixed(1)}`;
    applyLayout();
    if (w.tut === 0) tutorialStep(0);
    else $('tutorial').hidden = true;
    lastT = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function applyLayout() {
    const s = settings();
    document.body.classList.toggle('lefty', !!s.leftHanded);
    $('controls').style.setProperty('--ctl-opacity', String(0.35 + s.stickOpacity * 0.65));
    $('btnMine').classList.toggle('auto', !!s.autoFire);
    $('btnMine').querySelector('small').textContent = s.autoFire ? 'auto' : 'hold';
    $('btnBoost').classList.toggle('auto', !!s.autoBoost);
    $('btnBoost').querySelector('small').textContent = s.autoBoost ? 'auto' : 'hold';
    [['tglFire', 'autoFire'], ['tglBoost', 'autoBoost'], ['tglPilot', 'autopilot'], ['tglAEva', 'autoEva']].forEach(([id, k]) => {
      const el = $(id); el.classList.toggle('on', !!s[k]); el.setAttribute('aria-pressed', s[k] ? 'true' : 'false');
      el.querySelector('small').textContent = s[k] ? 'AUTO ON' : 'AUTO OFF';
    });
    const fcs = SM.State.autoOn('fcs'), tw = $('tglWpn');
    tw.classList.toggle('on', fcs); tw.setAttribute('aria-pressed', fcs ? 'true' : 'false');
    tw.querySelector('small').textContent = fcs ? 'AUTO ON' : 'AUTO OFF';
  }

  function pause(on) {
    if (!running) return;
    paused = on;
    $('pauseMenu').hidden = !on;
    input.mine = false; input.boost = false; input.stick = null;
    SM.Audio.laser(false);
    if (!on) lastT = performance.now();
  }
  function isRunning() { return running; }
  function isPaused() { return paused; }

  // reason: 'return' | 'fuel' | 'time' | 'hull' | 'abort'
  function end(reason) {
    if (!w || w.ended) return;
    w.ended = true; running = false;
    SM.Audio.laser(false);
    cancelAnimationFrame(raf);
    document.body.classList.remove('in-sortie');
    $('sortie').hidden = true;
    const emergency = reason === 'hull';
    const share = emergency ? Math.min(0.95, w.S.emergencyShare) : 1;
    const result = {
      reason, region: w.startRegion.id, raw: w.credits + w.clearBonus, credits: Math.floor(w.credits * share) + w.clearBonus, share, clearBonus: w.clearBonus,
      relicCount: w.relicCount, relicCredits: w.relicCredits,
      ammoRun: w.ammoRun, ammoWallet: w.ammoWallet, shotsBought: w.shotsBought, shotsSalvaged: w.shotsSalvaged,
      autoShots: w.autoShots, autoLoads: w.autoLoads,
      byMat: w.byMat, byMatCr: w.byMatCr, threat: TH.level, blocks: w.broken, xp: w.xp, damaged: w.damaged, emergency,
      hullEnd: Math.max(0, Math.ceil(w.hull)), hullLost: Math.max(0, Math.round(w.hullStart - w.hull)),
      time: w.elapsed, wasTutorial: w.tut >= 0,
      cleared: w.cleared, surveyed: Object.keys(w.surveyed), endRegion: w.region.id,
      giants: w.giantsCracked, giantCr: w.giantCr, foeKills: w.foeKills,
      events: w.events.map(e => ({ kind: e.kind, done: e.done, credits: e.credits })),
    };
    w = null;
    cb.onEnd && cb.onEnd(result);
  }
  // Snapshot used to bank progress if the app is killed mid-sortie.
  function snapshot() {
    if (!w || w.ended) return null;
    return { region: w.startRegion.id, credits: w.credits + w.clearBonus, byMat: w.byMat, blocks: w.broken, xp: w.xp,
      hull: Math.max(1, Math.ceil(w.hull)), damaged: w.damaged };
  }

  // ---------- tutorial ----------
  const TUT = [
    'Drag on the left side of the screen to fly.',
    'Tap a block to target it. The cracked grey block is a good start.',
    'Hold MINE to fire the laser at your target.',
    'Every destroyed block pays credits. Keep mining!',
    'Watch fuel and the timer. Tap RETURN any time to bank your credits.',
  ];
  function tutorialStep(n) {
    if (!w || w.tut < 0 || n < w.tut) return;
    w.tut = n;
    const el = $('tutorial');
    if (n >= TUT.length) { el.hidden = true; return; }
    let txt = TUT[n];
    if (settings().leftHanded) txt = txt.replace('left side', 'right side');
    if (settings().autoFire) txt = txt.replace('Hold MINE to fire the laser', 'Move close: the laser fires automatically');
    el.textContent = txt; el.hidden = false;
    if (n === 4) setTimeout(() => { if (w && w.tut === 4) tutorialStep(5); }, 6000);
  }

  // ---------- input ----------
  function bindInput() {
    let tap = null;
    canvas.addEventListener('pointerdown', e => {
      SM.Audio.unlock();
      if (!running || paused) return;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      const lefty = settings().leftHanded;
      const stickSide = lefty ? e.clientX > cw * 0.5 : e.clientX < cw * 0.5;
      tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
      if (stickSide && !input.stick) {
        input.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener('pointermove', e => {
      if (tap && tap.id === e.pointerId) tap.moved = Math.max(tap.moved, Math.hypot(e.clientX - tap.x, e.clientY - tap.y));
      if (input.stick && input.stick.id === e.pointerId) {
        input.stick.x = e.clientX; input.stick.y = e.clientY;
        // drag the base along if the finger goes far, so the stick never "runs out"
        const max = 60, dx = input.stick.x - input.stick.ox, dy = input.stick.y - input.stick.oy, d = Math.hypot(dx, dy);
        if (d > max * 1.6) { input.stick.ox += dx * (1 - max * 1.6 / d); input.stick.oy += dy * (1 - max * 1.6 / d); }
      }
    });
    const up = e => {
      if (input.stick && input.stick.id === e.pointerId) input.stick = null;
      if (tap && tap.id === e.pointerId) {
        if (performance.now() - tap.t < 300 && tap.moved < 12 && running && !paused) selectAt(e.clientX, e.clientY);
        tap = null;
      }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    function hold(btn, prop) {
      const el = $(btn);
      el.addEventListener('pointerdown', e => { e.preventDefault(); SM.Audio.unlock(); input[prop] = true; el.classList.add('down'); el.setPointerCapture && el.setPointerCapture(e.pointerId); });
      const rel = () => { input[prop] = false; el.classList.remove('down'); };
      el.addEventListener('pointerup', rel); el.addEventListener('pointercancel', rel); el.addEventListener('lostpointercapture', rel);
      el.addEventListener('contextmenu', e => e.preventDefault());
    }
    $('btnWeapon').addEventListener('pointerdown', e => { e.preventDefault(); SM.Audio.unlock(); if (running && !paused) fireWeapon(); });
    $('btnSwap').addEventListener('click', () => { SM.Audio.click(); cycleWeapon(); });
    $('tglEva').addEventListener('click', () => { SM.Audio.unlock(); SM.Audio.click(); if (running && !paused) toggleEva(); });
    $('btnReload').addEventListener('click', () => { SM.Audio.unlock(); if (running && !paused) buyReload(); });
    hold('btnMine', 'mine');
    hold('btnBoost', 'boost');
    [['tglFire', 'autoFire', 'Auto-fire'], ['tglBoost', 'autoBoost', 'Auto-boost'], ['tglPilot', 'autopilot', 'Autopilot'], ['tglAEva', 'autoEva', 'Auto EVA']].forEach(([id, k, label]) => {
      $(id).addEventListener('click', () => {
        SM.Audio.unlock(); SM.Audio.click();
        const st = settings(); st[k] = !st[k]; SM.State.save(); applyLayout();
        caption(label + (st[k] ? ' on' : ' off'));
      });
    });
    $('tglWpn').addEventListener('click', () => {
      SM.Audio.unlock(); SM.Audio.click();
      SM.State.toggleAuto('fcs'); applyLayout();
      caption('Auto-weapons ' + (SM.State.autoOn('fcs') ? 'on' : 'off'));
    });
    $('btnReturn').addEventListener('click', () => { SM.Audio.click(); end('return'); });
    $('btnPause').addEventListener('click', () => { SM.Audio.click(); pause(true); });
    $('btnResume').addEventListener('click', () => { SM.Audio.click(); pause(false); });
    $('btnPauseReturn').addEventListener('click', () => { SM.Audio.click(); paused = false; end('return'); });

    window.addEventListener('keydown', e => {
      if (!running) return;
      input.keys[e.code] = true;
      if (e.code === 'Space') { input.mine = true; e.preventDefault(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.boost = true;
      if (e.code === 'Escape' || e.code === 'KeyP') pause(!paused);
      if (e.code === 'KeyR' && !paused) end('return');
      if (e.code === 'KeyQ' && !paused) fireWeapon();
      if (e.code === 'KeyE' && !paused) cycleWeapon();
      if (e.code === 'KeyX' && !paused) buyReload();
      if (e.code === 'KeyV' && !paused) toggleEva();
      if (e.code === 'KeyF') $('tglFire').click();
      if (e.code === 'KeyB') $('tglBoost').click();
      if (e.code === 'KeyG') $('tglPilot').click();
      if (e.code === 'KeyJ') $('tglAEva').click();
      if (e.code === 'KeyH' && !$('tglWpn').hidden) $('tglWpn').click();
      if (e.code === 'Tab') { e.preventDefault(); w && (w.target = nearestBlock(w.S.range * 1.5)); }
    });
    window.addEventListener('keyup', e => {
      input.keys[e.code] = false;
      if (e.code === 'Space') input.mine = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.boost = false;
    });
  }

  function screenToWorld(sx, sy) {
    return { x: (sx - cw / 2) / scale + w.cam.x, y: (sy - ch / 2) / scale + w.cam.y };
  }
  function selectAt(sx, sy) {
    const p = screenToWorld(sx, sy);
    const foe = nearestFoe(p.x, p.y, 40);
    if (foe) { w.target = foe; SM.Audio.click(); return; }
    let best = null, bd = 34; // forgiving touch radius
    const gx = Math.floor(p.x / BS), gy = Math.floor(p.y / BS);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      const b = w.grid.get(key(gx + dx, gy + dy));
      if (!b || !b.alive) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < bd) { bd = d; best = b; }
    }
    if (best && !shipCan(best)) {
      SM.Audio.deny();
      caption('Giant rock: too thick for the laser. Park at the gold hatch, tap EVA and drill it hollow from inside', 'warn');
      return;
    }
    if (best) {
      w.target = best; SM.Audio.click();
      if (w.tut >= 0 && w.tut <= 1) tutorialStep(2);
    }
  }
  function nearestBlock(maxD) { return nearestNear(w.ship.x, w.ship.y, maxD); }
  // nearest block the ship's guns may hurt within maxD of (x, y), skipping `skip` (grid search, cheap)
  function nearestNear(x, y, maxD, skip, skip2) {
    let best = null, bd = maxD;
    const r = Math.ceil(maxD / BS), gx = Math.floor(x / BS), gy = Math.floor(y / BS);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const b = w.grid.get(key(gx + dx, gy + dy));
      if (!b || !b.alive || b === skip || b === skip2 || !shipCan(b)) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // ---------- update ----------
  function loop(t) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
    if (!paused) update(dt);
    render();
    hudTimer -= dt;
    if (hudTimer <= 0 && w) { hudTimer = 0.1; hud(); }
  }

  // Returns a steering vector {x,y} or null when the ship should hold position.
  function autopilot(dt) {
    const s = w.ship, S = w.S;
    // rare events first: chase a comet, stand off from a mothership, park by a derelict for auto EVA
    const ep = eventPilot();
    if (ep !== undefined) return ep;
    // auto EVA: park at the hatch of a giant rock that still needs hollowing (and wait there while oxygen refills)
    const eg = settings().autoEva ? evaGiant() : null;
    if (eg) { w.apGoal = null; return followRoute(eg); }
    // a giant the miner has hollowed: break its shell first (the jackpot)
    const og = settings().autoEva && w.giants.find(G => G.open && !G.cracked);
    if (og && !(w.target && w.target.alive && w.target.giant === og)) {
      let best = null, bd = Infinity;
      og.cells.forEach(c => { if (c.alive) { const d = Math.hypot(c.x - s.x, c.y - s.y); if (d < bd) { bd = d; best = c; } } });
      if (best) { w.target = best; w.apGoal = best; }
    }
    // already have something to shoot? keep mining it while easing in close,
    // so the escort wing (which works blocks near the ship) has more to hit
    if (w.target && w.target.alive && Math.hypot(w.target.x - s.x, w.target.y - s.y) <= S.range * 0.9) { w.apGoal = w.target; return closeIn(w.target); }
    const near = nearestBlock(S.range * 0.9);
    if (near) { w.target = near; w.apGoal = near; return closeIn(near); }
    // pick a goal: the player's chosen target, else the best nearby block (closer and more valuable wins)
    if (!w.apGoal || !w.apGoal.alive) {
      w.apGoal = (w.target && w.target.alive) ? w.target : null;
      if (!w.apGoal) {
        let best = null, bs = Infinity;
        for (const b of w.blocks) {
          if (!b.alive || !shipCan(b)) continue;
          const sc = Math.hypot(b.x - s.x, b.y - s.y) / (1 + Math.log(M[b.mat].value / 5 + 1) * 0.35);
          if (sc < bs) { bs = sc; best = b; }
        }
        w.apGoal = best;
      }
      w.apStuck = 0;
    }
    if (!w.apGoal) return null; // field cleared
    w.target = w.apGoal;
    const g0 = w.apGoal, dx = g0.x - s.x, dy = g0.y - s.y, d = Math.hypot(dx, dy) || 1;
    const m = Math.max(0, Math.min(1, (d - AP_CLOSE) / 80));
    // stuck against other blocks? give up on this goal and take whatever is nearest
    if (Math.hypot(s.vx, s.vy) < 12 && m > 0.5) { w.apStuck = (w.apStuck || 0) + dt; if (w.apStuck > 1.2) { w.apGoal = null; w.target = nearestBlock(400); w.apStuck = 0; } }
    else w.apStuck = 0;
    return avoid(dx / d * m, dy / d * m);
  }
  // Route planning (for auto EVA trips to a giant): cheapest way across the grid in seconds, where an open
  // cell costs its flying time and a block cell also costs the time the laser needs to cut it.
  const COLS = Math.ceil(W / BS), ROWS = Math.ceil(H / BS);
  function planRoute(tx, ty) {
    const s = w.ship, S = w.S, cellT = BS / S.speed, dps = Math.max(0.1, S.dps);
    const cl = (v, n) => Math.max(0, Math.min(n - 1, v));
    const start = cl(Math.floor(s.y / BS), ROWS) * COLS + cl(Math.floor(s.x / BS), COLS);
    const goal = cl(Math.floor(ty / BS), ROWS) * COLS + cl(Math.floor(tx / BS), COLS);
    const N = COLS * ROWS, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const hc = [], hi = []; // binary min-heap of (cost, cell)
    const push = (c, i) => { let k = hc.length; hc.push(c); hi.push(i); while (k) { const p = (k - 1) >> 1; if (hc[p] <= c) break; hc[k] = hc[p]; hi[k] = hi[p]; k = p; } hc[k] = c; hi[k] = i; };
    const pop = () => { const top = hi[0], c = hc.pop(), i = hi.pop(), n = hc.length; if (n) { let k = 0; for (;;) { let a = 2 * k + 1; if (a >= n) break; if (a + 1 < n && hc[a + 1] < hc[a]) a++; if (hc[a] >= c) break; hc[k] = hc[a]; hi[k] = hi[a]; k = a; } hc[k] = c; hi[k] = i; } return top; };
    dist[start] = 0; push(0, start);
    while (hc.length) {
      const c0 = hc[0], i = pop();
      if (c0 > dist[i]) continue;
      if (i === goal) break;
      const x = i % COLS, y = (i - x) / COLS;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const b = w.grid.get(key(nx, ny)); let step = cellT;
        if (b && b.alive) { if (!shipCan(b)) continue; step += b.hp * M[b.mat].res / dps; }
        const j = ny * COLS + nx, nc = c0 + step;
        if (nc < dist[j]) { dist[j] = nc; prev[j] = i; push(nc, j); }
      }
    }
    if (!isFinite(dist[goal])) return null;
    const cells = [];
    for (let i = goal; i !== start && i !== -1; i = prev[i]) cells.push({ gx: i % COLS, gy: Math.floor(i / COLS) });
    return { cells: cells.reverse(), cost: dist[goal] };
  }
  // the route to a giant's parking spot, replanned every 2 s (blocks break, the ship drifts)
  // (also used for rare events: the goal is then a mothership or a derelict, with its own point p)
  function giantRoute(G, p) {
    const R = w.route;
    if (R && R.giant === G && w.elapsed - R.at < 2) return R;
    p = p || parkPoint(G);
    const r = planRoute(p.x, p.y) || { cells: [], cost: Infinity };
    return (w.route = Object.assign(r, { giant: G, at: w.elapsed, i: 0 }));
  }
  // fly the route; when a block sits on it, aim the laser at that block and wait for it to break
  function followRoute(G, goal) {
    const s = w.ship, p = goal || parkPoint(G), R = giantRoute(G, p);
    while (R.i < R.cells.length - 1) {
      const c = R.cells[R.i];
      if (Math.hypot(c.gx * BS + BS / 2 - s.x, c.gy * BS + BS / 2 - s.y) < BS * 0.6) R.i++; else break;
    }
    if (R.i < R.cells.length - 1) {
      const c = R.cells[R.i], b = w.grid.get(key(c.gx, c.gy));
      const tx = c.gx * BS + BS / 2, ty = c.gy * BS + BS / 2, dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy) || 1;
      if (b && b.alive) { w.target = b; return d > BS * 0.9 ? { x: dx / d * 0.5, y: dy / d * 0.5 } : null; }
      return { x: dx / d, y: dy / d };
    }
    const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy) || 1;
    const m = Math.max(0, Math.min(1, (d - 3) / 70));
    return m < 0.05 ? null : avoid(dx / d * m, dy / d * m);
  }
  // drift toward a block we're already mining until we're parked right next to it
  function closeIn(b) {
    const s = w.ship, dx = b.x - s.x, dy = b.y - s.y, d = Math.hypot(dx, dy) || 1;
    const m = Math.max(0, Math.min(1, (d - AP_CLOSE) / 80)) * 0.6;
    return avoid(dx / d * m, dy / d * m);
  }
  // steer away from debris and live/arming electrical fields
  function avoid(x, y) {
    const s = w.ship;
    for (const d of w.debris) {
      const dx = s.x - d.x, dy = s.y - d.y, dist = Math.hypot(dx, dy);
      if (dist < 110) { const f = (110 - dist) / 110 * 1.6; x += dx / (dist || 1) * f; y += dy / (dist || 1) * f; }
    }
    for (const f of w.fields) {
      if (f.phase === 0) continue;
      const dx = s.x - f.x, dy = s.y - f.y, dist = Math.hypot(dx, dy);
      if (dist < f.r + 40) { const k = 1.5; x += dx / (dist || 1) * k; y += dy / (dist || 1) * k; }
    }
    for (const mn of w.mines) {
      if (!mn.alive) continue;
      const dx = s.x - mn.x, dy = s.y - mn.y, dist = Math.hypot(dx, dy);
      if (dist < 130) { const f = (130 - dist) / 130 * 1.8; x += dx / (dist || 1) * f; y += dy / (dist || 1) * f; }
    }
    for (const wl of w.wells) {
      const dx = s.x - wl.x, dy = s.y - wl.y, dist = Math.hypot(dx, dy);
      if (dist < wl.core + 90) { const f = 1.6; x += dx / (dist || 1) * f; y += dy / (dist || 1) * f; }
    }
    const m = Math.hypot(x, y);
    if (m < 0.05) return null;
    return m > 1 ? { x: x / m, y: y / m } : { x, y };
  }

  function update(dt) {
    const s = w.ship, S = w.S;
    w.elapsed += dt;
    w.time -= dt;
    // movement input
    let mx = 0, my = 0;
    if (input.stick) {
      const dx = input.stick.x - input.stick.ox, dy = input.stick.y - input.stick.oy, d = Math.hypot(dx, dy);
      const max = 60;
      if (d > 6) { const m = Math.min(1, (d - 6) / (max - 6)); mx = dx / d * m; my = dy / d * m; }
    }
    const k = input.keys;
    if (k.KeyW || k.ArrowUp) my -= 1; if (k.KeyS || k.ArrowDown) my += 1;
    if (k.KeyA || k.ArrowLeft) mx -= 1; if (k.KeyD || k.ArrowRight) mx += 1;
    let mag = Math.hypot(mx, my); if (mag > 1) { mx /= mag; my /= mag; mag = 1; }
    if (mag > 0.1 && w.tut === 0 && !w.tutMoved) { w.tutMoved = true; setTimeout(() => tutorialStep(1), 1200); }

    w.idle = mag > 0.1 ? 0 : (w.idle || 0) + dt; // seconds since the player last steered (ship or miner)
    // spacewalk: the stick drives the miner, the ship holds position
    if (w.eva) { updateEva(dt, mx, my, mag); mx = 0; my = 0; mag = 0; w.apIdle = 0; }
    else if (w.o2 < S.evaO2) { w.o2 = Math.min(S.evaO2, w.o2 + dt * 2); if (w.o2 >= S.evaO2) applyEvaUi(); } // refills aboard
    else if (settings().autoEva && w.tut !== 0 && w.idle > 0.6) autoEvaLaunch(); // auto EVA: full tank, hands off

    // autopilot: when the player isn't steering, fly to the next block worth mining
    w.autopilot = false;
    if (mag > 0.1) { w.apIdle = 0; w.apGoal = null; }
    else if (settings().autopilot && w.tut !== 0 && !w.eva) {
      w.apIdle = (w.apIdle || 0) + dt;
      if (w.apIdle > 0.6) {
        const ap = autopilot(dt);
        w.autopilot = true;
        if (ap) { mx = ap.x; my = ap.y; mag = Math.hypot(mx, my); }
      }
    }

    // boost: held button, or auto-boost (with hysteresis so it doesn't flicker on an empty tank)
    let wantBoost = input.boost;
    if (settings().autoBoost && mag > 0.6) {
      if (w.energy < 5) w.autoBoostLock = true;
      if (w.autoBoostLock && w.energy > S.energy * 0.5) w.autoBoostLock = false;
      if (!w.autoBoostLock) wantBoost = true;
    }
    w.boosting = wantBoost && w.energy > 1 && mag > 0.1 && w.fuel > 0;
    if (w.boosting) w.energy = Math.max(0, w.energy - D.BASE.boostDrain * dt);
    else w.energy = Math.min(S.energy, w.energy + S.energyRegen * dt);
    const sp = S.speed * (w.boosting ? D.BASE.boostMult : 1);
    const tvx = mx * sp, tvy = my * sp;
    const acc = Math.min(1, dt * (w.boosting ? 5 : 3.5));
    s.vx += (tvx - s.vx) * acc; s.vy += (tvy - s.vy) * acc;
    s.thrust = mag;
    if (mag > 0.05) {
      w.fuel = Math.max(0, w.fuel - D.BASE.fuelBurn * mag * (w.boosting ? 1.7 : 1) * dt);
      const ta = Math.atan2(my, mx);
      let da = ta - s.a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      s.a += da * Math.min(1, dt * 10);
    }
    s.x += s.vx * dt; s.y += s.vy * dt;
    // bounds
    s.x = Math.max(SHIP_R, Math.min(W - SHIP_R, s.x)); s.y = Math.max(SHIP_R, Math.min(H - SHIP_R, s.y));
    collideBlocks(s);
    if (s.inv > 0) s.inv -= dt;

    // engine particles
    if (mag > 0.1 && !settings().reducedFx && Math.random() < (w.boosting ? 0.9 : 0.45)) {
      const bx = s.x - Math.cos(s.a) * 12, by = s.y - Math.sin(s.a) * 12;
      w.particles.push({ x: bx, y: by, vx: -Math.cos(s.a) * 60 + rand(-15, 15), vy: -Math.sin(s.a) * 60 + rand(-15, 15),
        t: 0, life: 0.35, color: trailColor(w.boosting ? w.look.trail.boost : w.look.trail.color), size: w.boosting ? 3 : 2 });
    }

    // targeting
    if (w.target && !w.target.alive) w.target = null;
    // the ship keeps shooting while the miner is out (it holds position, so it never leaves tether range)
    const wantFire = w.wantFire = input.mine || settings().autoFire;
    // scavengers in range jump the queue: every second they live they are eating your field
    if (wantFire && settings().aimAssist && w.foes.length && !(w.target && w.target.foe)) {
      const f = nearestFoe(s.x, s.y, S.range); if (f) w.target = f;
    }
    let inRange = w.target && Math.hypot(w.target.x - s.x, w.target.y - s.y) <= S.range;
    if (wantFire && (!w.target || (!inRange && settings().autoFire)) && settings().aimAssist) {
      const nb = autoTarget(S.range);
      if (nb && (!w.target || !inRange)) { w.target = nb; inRange = true; }
    }
    // laser + heat
    if (w.target && !shipCan(w.target)) w.target = null;
    const canFire = wantFire && w.target && inRange && !w.overheated;
    w.firing = !!canFire;
    if (canFire) {
      const b = w.target, m = M[b.mat];
      b.hp -= S.dps / m.res * dt;
      b.flash = 0.08; b.hitAt = w.elapsed;
      w.heat += dt * (w.flareOn > 0 ? FLARE_HEAT : 1);
      // safety vent: stop before the limit, cool off, then carry on mining by itself
      if (w.heat >= S.heat * D.BASE.ventAt) { w.overheated = true; SM.Audio.overheat(); caption('Laser venting heat - resumes automatically', 'warn'); }
      w.hitTick -= dt;
      if (w.hitTick <= 0) {
        w.hitTick = 0.12; SM.Audio.hit();
        if (!settings().reducedFx) for (let i = 0; i < 2; i++) {
          w.particles.push({ x: b.x + rand(-6, 6), y: b.y + rand(-6, 6), vx: rand(-60, 60), vy: rand(-60, 60), t: 0, life: 0.3, color: m.color, size: 2 });
        }
      }
      const prevState = b.state || 0;
      const frac = b.hp / b.maxHp;
      b.state = frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;
      if (b.state > prevState) SM.Audio.crack();
      if (b.hp <= 0) { if (b.foe) killFoe(b); else breakBlock(b); }
      laserExtras(b, dt);
    } else {
      w.splitTarget = null; w.splitTarget2 = null;
      w.heat = Math.max(0, w.heat - S.cool * dt * (w.flareOn > 0 ? 0.5 : 1));
      if (w.overheated && w.heat <= S.heat * D.BASE.resumeAt) { w.overheated = false; caption('Laser cooled - mining again', 'good'); }
    }
    if (!w) return; // the sortie may have ended inside updateEva
    SM.Audio.laser(w.firing || !!(w.miner && w.miner.drilling) || w.wing.some(d => d.firing));
    updateWeapons(dt);
    updateShipGear(dt);
    if (!w) return;
    updateAuto(dt);
    updateWing(dt);

    // debris
    w.debris.forEach(d => {
      d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
      if (d.x < d.r || d.x > W - d.r) d.vx *= -1;
      if (d.y < d.r || d.y > H - d.r) d.vy *= -1;
      const dist = Math.hypot(d.x - s.x, d.y - s.y);
      if (dist < d.r + SHIP_R) {
        const nx = (s.x - d.x) / (dist || 1), ny = (s.y - d.y) / (dist || 1);
        if (s.inv <= 0) { if (!shieldBlock()) damage(w.region.debris.dmg * TH.hazard, 'Debris impact'); s.inv = 1; }
        s.vx = nx * 220; s.vy = ny * 220; d.vx = -nx * Math.hypot(d.vx, d.vy); d.vy = -ny * Math.hypot(d.vx, d.vy);
        s.x = d.x + nx * (d.r + SHIP_R + 1); s.y = d.y + ny * (d.r + SHIP_R + 1);
      }
    });
    // electrical fields: 3s dormant, 1.2s warning, 2s active
    w.fields.forEach(f => {
      f.t = (f.t + dt) % 6.2;
      f.phase = f.t < 3 ? 0 : f.t < 4.2 ? 1 : 2;
      if (f.phase === 2 && Math.hypot(f.x - s.x, f.y - s.y) < f.r) damage(11 * TH.hazard * dt, null, true);
    });
    updateHazards(dt);
    if (!w || w.ended) return;

    // particles / popups
    w.particles = w.particles.filter(p => { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; return p.t < p.life; });
    w.pops = w.pops.filter(p => { p.t += dt; p.y -= 30 * dt; return p.t < 1.2; });
    w.shake = Math.max(0, w.shake - dt * 18);

    // camera follows ship with lookahead
    const fo = w.eva && w.miner ? w.miner : s;
    const lx = fo.x + fo.vx * 0.35, ly = fo.y + fo.vy * 0.35;
    w.cam.x += (lx - w.cam.x) * Math.min(1, dt * 4); w.cam.y += (ly - w.cam.y) * Math.min(1, dt * 4);
    const hw = cw / 2 / scale, hh = ch / 2 / scale;
    w.cam.x = Math.max(Math.min(hw, W / 2), Math.min(W - Math.min(hw, W / 2), w.cam.x));
    w.cam.y = Math.max(Math.min(hh, H / 2), Math.min(H - Math.min(hh, H / 2), w.cam.y));

    // warnings
    const fuelFrac = w.fuel / S.fuel, hullFrac = w.hull / S.hull;
    if (fuelFrac < 0.25 && !w.warned.fuel) { w.warned.fuel = 1; SM.Audio.alarm(); caption('Low fuel - consider returning', 'warn'); vibrate([60, 60, 60]); }
    if (hullFrac < 0.3 && !w.warned.hull) { w.warned.hull = 1; SM.Audio.alarm(); caption('Hull critical - return to bank credits safely', 'danger'); vibrate([100, 60, 100]); }
    if (w.time < 30 && !w.warned.time) { w.warned.time = 1; caption('30 seconds left in this shift', 'warn'); }

    if (w.hull <= 0) { caption('Hull failure - emergency return', 'danger'); return end('hull'); }
    if (w.fuel <= 0) { caption('Fuel empty - towed back to the hangar', 'warn'); return end('fuel'); }
    if (w.time <= 0) return end('time');
    // field cleared with time to spare (waits for the miner, and for a giant rock you have started on)
    if (w.left <= 0 && !w.eva && !w.giants.some(G => G.started && !G.cracked)) advanceWorld();
  }

  // ---------- field features (see DATA.REGIONS) ----------
  const FLARE_HEAT = 2.2;   // laser heats this much faster during a solar flare
  function nearestFoe(x, y, maxD) {
    let best = null, bd = maxD;
    for (const f of w.foes) { if (!f.alive) continue; const d = Math.hypot(f.x - x, f.y - y); if (d < bd) { bd = d; best = f; } }
    return best;
  }
  function killFoe(f) {
    if (!f.alive) return;
    f.alive = false;
    w.credits += f.value; w.xp += f.xp || M.scav.xp;
    if (f.kind) eventDone(f.ev, f.value); else w.foeKills++;
    if (f.kind === 'comet') { w.fuel = Math.min(w.S.fuel, w.fuel + w.S.fuel * D.EVENTS.kinds.comet.fuel); caption('Comet shattered! Ice topped up your fuel', 'good'); }
    if (f.kind === 'boss') caption('Mothership destroyed!', 'good');
    SM.Audio.boom(); vibrate(40);
    for (let i = 0; i < 22; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(50, 190);
      w.particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: rand(0.4, 0.8), color: i % 2 ? M.scav.color : '#ffd76a', size: rand(2, 4) });
    }
    w.pops.push({ x: f.x, y: f.y - 8, text: '+' + f.value + (f.kind ? '' : ' bounty'), t: 0, color: '#ffd76a', size: f.kind ? 22 : 16 });
    if (w.target === f) w.target = null;
  }
  function disarmMine(m) {
    m.alive = false;
    w.pops.push({ x: m.x, y: m.y - 8, text: 'mine disarmed', t: 0, color: '#7fe3ff', size: 12 });
  }
  // is a rock between the ship and the sun (straight up the screen)? then a flare can't burn the hull
  function shaded(x, y) {
    const gx = Math.floor(x / BS), gy = Math.floor(y / BS);
    for (let dy = 1; dy <= 4; dy++) for (let dx = -1; dx <= 1; dx++) {
      const b = w.grid.get(key(gx + dx, gy - dy)); if (b && b.alive) return true;
    }
    return false;
  }
  function updateHazards(dt) {
    const s = w.ship, R = w.region;
    // giant rocks: a one-time hint when you first come near one
    w.giants.forEach(G => {
      if (G.hinted || G.open || Math.hypot(G.x - s.x, G.y - s.y) > G.size * BS / 2 + 160) return;
      G.hinted = true; SM.Audio.click();
      caption('Giant rock! Park at the gold hatch, tap EVA and drill it hollow from inside', 'good');
    });
    // solar wind: a current that drags the ship and debris
    if (R.wind) {
      w.windA += R.wind.turn * dt;
      const sp = R.wind.speed * Math.min(1.5, Math.sqrt(TH.hazard));
      const wx = Math.cos(w.windA) * sp, wy = Math.sin(w.windA) * sp;
      if (!w.eva) { s.x += wx * dt; s.y += wy * dt; s.x = Math.max(SHIP_R, Math.min(W - SHIP_R, s.x)); s.y = Math.max(SHIP_R, Math.min(H - SHIP_R, s.y)); collideBlocks(s); }
      w.debris.forEach(d => { d.x += wx * 0.6 * dt; d.y += wy * 0.6 * dt; });
      if (!settings().reducedFx && Math.random() < 0.6) {
        const hw = cw / 2 / scale, hh = ch / 2 / scale;
        w.particles.push({ x: w.cam.x + rand(-hw, hw), y: w.cam.y + rand(-hh, hh), vx: wx * 5, vy: wy * 5, t: 0, life: 0.5, color: 'rgba(210,235,255,0.45)', size: 1.5 });
      }
    }
    // gravity wells: pull toward the centre, the core crushes the hull
    w.wells.forEach(wl => {
      wl.t += dt;
      const pull = 170 * Math.min(1.6, Math.pow(TH.hazard, 0.3));
      const dx = wl.x - s.x, dy = wl.y - s.y, d = Math.hypot(dx, dy) || 1;
      if (d < wl.r && !w.eva) {
        const k = pull * (1 - d / wl.r);
        s.vx += dx / d * k * dt * 3; s.vy += dy / d * k * dt * 3;
        if (!w.warned.well) { w.warned.well = 1; caption('Gravity well - boost out of the pull', 'warn'); }
      }
      if (d < wl.core + SHIP_R && !w.eva) damage(20 * TH.hazard * dt, 'Gravity well', true);
      w.debris.forEach(o => {
        const ex = wl.x - o.x, ey = wl.y - o.y, ed = Math.hypot(ex, ey) || 1;
        if (ed < wl.r) { o.vx += ex / ed * 40 * dt; o.vy += ey / ed * 40 * dt; }
      });
    });
    // solar flares: warning, then the laser runs hot and unshaded hulls burn
    if (R.flares) {
      const F = R.flares;
      if (w.flareOn > 0) {
        w.flareOn -= dt;
        if (!shaded(s.x, s.y) && !w.eva) damage(3 * TH.hazard * dt, 'Solar flare', true);
        if (w.flareOn <= 0) { w.flare = F.every; caption('Flare passed', 'good'); }
      } else {
        w.flare -= dt;
        if (w.flare <= F.warn && !w.warned.flare) { w.warned.flare = 1; SM.Audio.alarm(); caption('Solar flare incoming - get a rock above you', 'warn'); vibrate([40, 40, 40]); }
        if (w.flare <= 0) { w.flareOn = F.dur; w.warned.flare = 0; }
      }
    }
    // mines: blink when something comes close, then blow
    w.mines.forEach(m => {
      if (!m.alive) return;
      m.t += dt;
      if (m.arm < 0) {
        const near = Math.hypot(m.x - s.x, m.y - s.y) < 80 || w.wing.some(d => Math.hypot(m.x - d.x, m.y - d.y) < 45);
        if (near) { m.arm = 0.9; SM.Audio.alarm(); }
        return;
      }
      m.arm -= dt;
      if (m.arm <= 0) {
        m.alive = false;
        explode(m.x, m.y, 95, 40 * TH.hp, '#ff4d4d');
        if (Math.hypot(m.x - s.x, m.y - s.y) < 95 + SHIP_R && !w.eva) { if (!shieldBlock()) damage(22 * TH.hazard, 'Mine blast'); }
      }
    });
    // volatile ore: queued blasts so chain reactions ripple outward instead of happening all at once
    if (w.booms.length) {
      const due = w.booms.filter(b => (b.t -= dt) <= 0);
      w.booms = w.booms.filter(b => b.t > 0);
      due.forEach(b => {
        explode(b.x, b.y, 58, 30 * TH.hp, '#ff5a36');
        if (w && Math.hypot(b.x - s.x, b.y - s.y) < 30 + SHIP_R && !w.eva && s.inv <= 0) { damage(6 * TH.hazard, 'Volatile blast'); s.inv = 0.5; } // only a ship hugging the rock gets hurt
      });
    }
    // living coral grows back when nothing has cut it for a moment
    w.regrow.forEach(b => {
      if (!b.alive || b.hp >= b.maxHp || w.elapsed - (b.hitAt || 0) < 1.5) return;
      b.hp = Math.min(b.maxHp, b.hp + M[b.mat].regen * b.maxHp * dt);
      const fr = b.hp / b.maxHp; b.state = fr > 0.66 ? 0 : fr > 0.33 ? 1 : 2;
    });
    // scavengers: fly to the nearest block, chew through it, move on
    updateEvent(dt);
    w.foes.forEach(f => {
      if (!f.alive) return;
      if (f.flash > 0) f.flash -= dt;
      if (f.kind === 'comet') return moveComet(f, dt);
      if (f.kind === 'boss') bossActs(f, dt);
      if (f.wait > 0) { f.wait -= dt; f.x += Math.cos(f.seed + w.elapsed) * 20 * dt; f.y += Math.sin(f.seed + w.elapsed * 0.7) * 20 * dt; return; }
      if (!f.prey || !f.prey.alive) { f.prey = nearestBlockTo(f.x, f.y, 3000); f.eat = 0; }
      const b = f.prey; if (!b) return;
      const dx = b.x - f.x, dy = b.y - f.y, d = Math.hypot(dx, dy) || 1;
      f.a = Math.atan2(dy, dx);
      const sp = 75 * Math.min(1.6, Math.pow(TH.hazard, 0.3)) * (f.kind === 'boss' ? 0.5 : 1);
      if (d > 26) { f.vx += (dx / d * sp - f.vx) * Math.min(1, dt * 3); f.vy += (dy / d * sp - f.vy) * Math.min(1, dt * 3); }
      else { f.vx *= 0.8; f.vy *= 0.8; }
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (d < 30) {
        b.hp -= b.maxHp / (f.kind === 'boss' ? 1.2 : 2.5) * dt; b.flash = 0.05;
        if (Math.random() < 0.3 && !settings().reducedFx) w.particles.push({ x: b.x, y: b.y, vx: rand(-40, 40), vy: rand(-40, 40), t: 0, life: 0.3, color: M[b.mat].color, size: 2 });
        if (b.hp <= 0) {
          b.alive = false; w.grid.delete(key(b.gx, b.gy)); w.left--; f.prey = null; f.wait = 0.6;
          if (b.giant) giantCellGone(b);
          if (w.target === b) w.target = null;
          if (!w.warned.scav || w.elapsed - w.warned.scav > 6) { w.warned.scav = w.elapsed; caption('A scavenger ate a block - shoot it!', 'warn'); }
        }
      }
    });
  }

  // ---------- rare sortie events (DATA.EVENTS, added 2026-11-07) ----------
  // Roll for this field's event: { kind, at (seconds into the sortie) } or null.
  function rollEvent(region, tutorial, force) {
    const E = D.EVENTS, tier = D.REGIONS.indexOf(region);
    if (!force && (tutorial || E.chance <= 0 || Math.random() >= E.chance)) return null;
    const kinds = Object.keys(E.kinds).filter(k => (E.kinds[k].minTier || 0) <= tier);
    let kind = force;
    if (!kind) {
      let r = Math.random() * kinds.reduce((a, k) => a + E.kinds[k].w, 0);
      kind = kinds.find(k => (r -= E.kinds[k].w) < 0) || kinds[0];
    }
    return { kind, at: w ? w.elapsed + rand(E.after[0], E.after[1]) : rand(E.after[0], E.after[1]) };
  }
  // Start an event now (used by the timer, and by tests / debugging).
  function startEvent(kind) {
    const E = D.EVENTS.kinds[kind], R = w.region, relic = (R.relic || 60) * TH.value, s = w.ship;
    const ev = { kind, done: false, credits: 0 };
    w.events.push(ev); w.event = null;
    if (kind === 'comet') {
      // enter from a side edge, aimed across the field past the ship's area
      const left = Math.random() < 0.5, y0 = Math.max(120, Math.min(H - 500, s.y + rand(-500, 200)));
      const x0 = left ? -30 : W + 30, tx = left ? W + 60 : -60, ty = Math.max(80, Math.min(H - 400, s.y + rand(-250, 250)));
      const d = Math.hypot(tx - x0, ty - y0), sp = E.speed * Math.min(1.5, Math.pow(TH.hazard, 0.3));
      const hp = E.hp * TH.hp;
      w.foes.push({ foe: true, kind, ev, mat: 'ice', x: x0, y: y0, vx: (tx - x0) / d * sp, vy: (ty - y0) / d * sp, a: 0, hp, maxHp: hp,
        value: Math.round(E.value * relic), xp: E.xp, alive: true, seed: rand(0, 1000), flash: 0, r: 16 });
      caption('Comet incoming! Laser it before it leaves the field', 'good');
    } else if (kind === 'derelict') {
      // a quiet open spot not too far from the ship, with crates around the hull
      let x = 0, y = 0, ok = false;
      for (let t = 0; t < 300 && !ok; t++) {
        const a = rand(0, Math.PI * 2), r = rand(250, 650);
        x = Math.max(120, Math.min(W - 120, s.x + Math.cos(a) * r)); y = Math.max(120, Math.min(H - 420, s.y + Math.sin(a) * r));
        ok = openAround(x, y, 95) && !w.wells.some(wl => Math.hypot(wl.x - x, wl.y - y) < wl.r);
      }
      if (!ok) { // nowhere open: clear a pocket instead
        for (let gx = Math.floor((x - 95) / BS); gx <= Math.floor((x + 95) / BS); gx++) for (let gy = Math.floor((y - 95) / BS); gy <= Math.floor((y + 95) / BS); gy++) {
          const b = w.grid.get(key(gx, gy)); if (b && !b.giant) { b.alive = false; w.grid.delete(key(gx, gy)); w.left--; }
        }
      }
      const value = Math.round(E.crateValue * relic * rand(0.85, 1.15));
      w.derelict = { x, y, a: rand(0, Math.PI * 2), ev, crates: [] };
      for (let i = 0; i < E.crates; i++) {
        const a = i / E.crates * Math.PI * 2 + rand(-0.3, 0.3), r = rand(42, 68);
        const c = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, value, alive: true, t: rand(0, 6), crate: true, evaOnly: true, ev };
        w.relics.push(c); w.derelict.crates.push(c);
      }
      caption('Derelict ship spotted! Spacewalk over to grab its salvage crates', 'good');
    } else if (kind === 'boss') {
      let x, y, t = 0;
      do { x = rand(150, W - 150); y = rand(150, H - 700); t++; } while (t < 50 && Math.hypot(x - s.x, y - s.y) < 500);
      const hp = M.scav.health * E.hp * TH.hp;
      w.foes.push({ foe: true, kind, ev, mat: 'scav', x, y, vx: 0, vy: 0, a: 0, hp, maxHp: hp, value: Math.round(E.value * relic), xp: E.xp,
        alive: true, seed: rand(0, 1000), flash: 0, prey: null, eat: 0, wait: 1.5, r: 30, spawn: E.spawnEvery * 0.5, pulse: E.pulseEvery, charge: 0 });
      caption('Scavenger mothership! It eats the field and launches drones - take it down', 'danger');
      SM.Audio.alarm();
    }
    vibrate([30, 30, 30]);
    return ev;
  }
  function openAround(x, y, r) {
    for (let gx = Math.floor((x - r) / BS); gx <= Math.floor((x + r) / BS); gx++)
      for (let gy = Math.floor((y - r) / BS); gy <= Math.floor((y + r) / BS); gy++) if (w.grid.has(key(gx, gy))) return false;
    return true;
  }
  function eventDone(ev, credits) {
    if (!ev || ev.done) return;
    ev.done = true; ev.credits += credits || 0;
    SM.Audio.contract(); vibrate([40, 40, 120]);
  }
  function eventFoe() { return w.foes.find(f => f.alive && f.kind); }
  function updateEvent(dt) {
    if (w.event && w.elapsed >= w.event.at && w.time > 25) startEvent(w.event.kind);
    const dr = w.derelict;
    if (dr && !dr.ev.done && dr.crates.every(c => !c.alive)) { eventDone(dr.ev, 0); caption('Derelict stripped - all crates recovered', 'good'); }
  }
  function moveComet(f, dt) {
    f.x += f.vx * dt; f.y += f.vy * dt; f.a += dt * 2;
    if (!settings().reducedFx && Math.random() < 0.9) w.particles.push({ x: f.x + rand(-5, 5), y: f.y + rand(-5, 5), vx: -f.vx * 0.6 + rand(-20, 20), vy: -f.vy * 0.6 + rand(-20, 20), t: 0, life: 0.9, color: Math.random() < 0.5 ? '#dff6ff' : '#7fd6ff', size: rand(2, 4) });
    if (f.x < -80 || f.x > W + 80 || f.y < -80 || f.y > H + 80) { // got away
      f.alive = false; f.ev.gone = true;
      if (w.target === f) w.target = null;
      caption('The comet got away', 'warn');
    }
  }
  function bossActs(f, dt) {
    const E = D.EVENTS.kinds.boss, s = w.ship;
    f.spawn -= dt;
    if (f.spawn <= 0) {
      f.spawn = E.spawnEvery;
      const adds = w.foes.filter(o => o.alive && !o.kind && o.mother === f).length;
      if (adds < E.maxAdds) {
        const hp = M.scav.health * TH.hp;
        w.foes.push({ foe: true, mat: 'scav', mother: f, x: f.x, y: f.y, vx: rand(-60, 60), vy: rand(-60, 60), a: 0, hp, maxHp: hp, value: Math.round(M.scav.value * TH.value * 0.5),
          alive: true, seed: rand(0, 1000), flash: 0, prey: null, eat: 0, wait: 0.5 });
      }
    }
    if (f.charge > 0) {
      f.charge -= dt;
      if (f.charge <= 0) {
        w.fx.push({ kind: 'ring', x: f.x, y: f.y, r: E.pulseR, t: 0, life: 0.4, color: '#ff3d71' });
        if (!w.eva && Math.hypot(s.x - f.x, s.y - f.y) < E.pulseR + SHIP_R && !shieldBlock()) damage(E.pulseDmg * TH.hazard, 'Mothership pulse');
        if (w.miner && !inGiant(w.miner) && Math.hypot(w.miner.x - f.x, w.miner.y - f.y) < E.pulseR) w.o2 = Math.max(0, w.o2 - D.EVA.debrisO2);
      }
    } else if ((f.pulse -= dt) <= 0) { f.pulse = E.pulseEvery; f.charge = 1.2; if (Math.hypot(s.x - f.x, s.y - f.y) < E.pulseR + 80) caption('Mothership charging a pulse - back off!', 'warn'); }
  }
  // Autopilot for events: a steering vector, or undefined when there is nothing to do here.
  function eventPilot() {
    const s = w.ship, S = w.S, f = eventFoe();
    if (f && Math.hypot(f.x - s.x, f.y - s.y) < 1100) {
      w.target = f; w.apGoal = null;
      const E = D.EVENTS.kinds.boss;
      const stand = f.kind === 'boss' ? Math.min(S.range * 0.9, E.pulseR + SHIP_R + 30) : Math.min(S.range * 0.6, 90);
      const far = Math.hypot(f.x - s.x, f.y - s.y);
      if (f.kind === 'boss' && far > S.range) { const r = followRoute(f, { x: f.x, y: f.y }); w.target = w.target && w.target.alive ? w.target : f; return r || { x: 0, y: 0 }; } // rock in the way: cut a path
      const lead = f.kind === 'comet' ? 0.6 : 0.2; // aim ahead of a moving comet
      const tx = f.x + f.vx * lead, ty = f.y + f.vy * lead, dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy) || 1;
      const m = Math.max(-0.8, Math.min(1, (d - stand) / 60));
      return avoid(dx / d * m, dy / d * m) || { x: 0, y: 0 };
    }
    const dr = w.derelict;
    if (dr && !dr.ev.done && settings().autoEva && dr.crates.some(c => c.alive && !c.evaSkip) && w.time > 15) {
      const dx = dr.x - s.x, dy = dr.y - s.y, d = Math.hypot(dx, dy) || 1;
      if (d < 110) return { x: 0, y: 0 }; // parked: auto EVA takes it from here
      return followRoute(dr, { x: dr.x, y: dr.y + 80 }) || { x: 0, y: 0 };
    }
    return undefined;
  }

  // Field cleared before the timer ran out: warp to the next world and keep mining with the time,
  // fuel, hull and credits that are left. Next world = the next unlocked region after this one; past
  // the last unlocked region it is a fresh field of the same region. The hangar selection follows.
  function nextRegion(region) {
    const st = SM.State.get(), i = D.REGIONS.indexOf(region);
    const n = D.REGIONS.slice(i + 1).find(r => st.unlocked.includes(r.id));
    return n || region;
  }
  // See DATA.CLEAR. Exposed for the hangar/README formula and tests.
  function clearBonus(fieldCr, secsLeft, nth, region, threatValue) {
    const C = D.CLEAR;
    const mult = (C.pct + C.perSec * secsLeft) * (1 + C.streak * (nth - 1));
    return Math.round(fieldCr * mult + region.bonus * C.regionBonus * (threatValue || 1));
  }
  function advanceWorld() {
    const next = nextRegion(w.region), same = next === w.region;
    w.cleared++;
    const bonus = clearBonus(w.fieldCr, Math.max(0, w.time), w.cleared, w.region, TH.value);
    w.clearBonus += bonus; w.xp += D.CLEAR.xp * (D.REGIONS.indexOf(w.region) + 1);
    w.time += D.CLEAR.time; if (w.time >= 30) w.warned.time = 0;
    w.fuel = Math.min(w.S.fuel, w.fuel + w.S.fuel * D.CLEAR.fuel);
    w.pops.push({ x: w.ship.x, y: w.ship.y - 30, text: `FIELD CLEARED +${bonus.toLocaleString()}`, t: 0, color: '#57e39a', size: 20 });
    w.fieldCr = 0;
    const world = generate(next, false);
    Object.assign(w, { region: next, blocks: world.blocks, grid: world.grid, debris: world.debris, fields: world.fields,
      stars: world.stars, relics: world.relics, left: world.left, giants: world.giants,
      wells: world.wells, mines: world.mines, foes: world.foes, regrow: world.regrow, booms: [],
      flare: next.flares ? next.flares.every * 0.6 : 0, flareOn: 0,
      target: null, apGoal: null, apStuck: 0, proj: [], wingPlan: 0,
      sentries: [], sentryCd: 1, splitTarget: null, splitTarget2: null, gunTarget: null, derelict: null }); // sentries are left behind; the ship drops new ones
    w.events.forEach(e => { if (!e.done) e.gone = true; }); // an unfinished event stays in the old field
    w.event = rollEvent(next, false);
    const s = w.ship;
    s.x = w.dock.x; s.y = w.dock.y - 30; s.vx = 0; s.vy = 0; s.a = -Math.PI / 2; s.inv = 1.5;
    w.cam.x = w.dock.x; w.cam.y = w.dock.y - 200;
    w.wing.forEach((d, i) => { d.target = null; d.relic = null; d.x = s.x + Math.cos(d.phase) * 40; d.y = s.y + Math.sin(d.phase) * 40; d.vx = 0; d.vy = 0; });
    const st = SM.State.get();
    if (st.region !== next.id) { st.region = next.id; SM.State.save(); }
    $('regionLabel').textContent = `${next.name} - Threat ${TH.level.toFixed(1)}`;
    caption(`Field cleared! +${bonus.toLocaleString()} cr bonus, +${D.CLEAR.time}s`, 'good');
    caption(same ? `Warping to a fresh ${next.name} field` : `Advancing to ${next.name}`, 'good');
    SM.Audio.contract();
    vibrate([40, 40, 120]);
  }

  function collideBlocks(s, R0, miner) {
    const SR = R0 || SHIP_R;
    const gx = Math.floor(s.x / BS), gy = Math.floor(s.y / BS);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const b = w.grid.get(key(gx + dx, gy + dy));
      if (!b || !b.alive || (miner && b.part === 'hatch')) continue; // the hatch lets the miner in, never the ship
      const half = BS / 2;
      const cx = Math.max(b.x - half, Math.min(s.x, b.x + half));
      const cy = Math.max(b.y - half, Math.min(s.y, b.y + half));
      const ddx = s.x - cx, ddy = s.y - cy, d = Math.hypot(ddx, ddy);
      if (d < SR) {
        const nx = d ? ddx / d : 0, ny = d ? ddy / d : -1;
        s.x = cx + nx * SR; s.y = cy + ny * SR;
        const vn = s.vx * nx + s.vy * ny;
        if (vn < 0) { s.vx -= vn * nx * 1.3; s.vy -= vn * ny * 1.3; } // soft bump, no damage
      }
    }
  }

  function damage(amount, label, silent) {
    w.hull -= amount; w.damaged = true;
    if (!silent) {
      SM.Audio.damage(); vibrate(80);
      if (settings().shake) w.shake = 8;
      if (label) caption(label + ' -' + Math.round(amount) + ' hull', 'danger');
      w.pops.push({ x: w.ship.x, y: w.ship.y - 20, text: '-' + Math.round(amount) + ' hull', t: 0, color: '#ff6b6b', size: 13 });
    } else if (!w.warned.zap || w.elapsed - w.warned.zap > 1.2) {
      w.warned.zap = w.elapsed; SM.Audio.damage(); vibrate(40); caption((label || 'Electrical field') + ' - taking damage', 'danger');
    }
  }

  // ---------- escort wing ----------
  // Teamwork (numbers in DATA.WING.team). Instead of every drone grabbing its own block, the
  // wing makes one plan together:
  //   1. rank blocks in reach by value / (seconds to break with the whole team + seconds to fly there)
  //   2. walk that list, sending the closest free drones to each block until it will break within
  //      focusSecs (the ship's laser counts when it is on that block, so drones don't overkill it)
  //   3. drones left over once every block is covered join the block that will take longest
  // Venting drones and relic runs keep what they are doing and are not counted.
  function planWing() {
    const s = w.ship, T = D.WING.team;
    const free = w.wing.filter(d => !d.relic && !d.venting);
    w.wing.forEach(d => { if (d.target && !d.target.alive) d.target = null; });
    if (!free.length) return;
    let reach = 0, teamDps = 0, speed = 0;
    free.forEach(d => { reach = Math.max(reach, d.st.reach); teamDps += d.st.dps; speed += d.st.speed / free.length; });
    const shipOn = w.firing && w.target && w.target.alive ? w.target : null;
    const cutting = new Set(w.wing.filter(d => d.target).map(d => d.target));
    const cands = [];
    const r = Math.ceil(reach / BS), gx = Math.floor(s.x / BS), gy = Math.floor(s.y / BS);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const b = w.grid.get(key(gx + dx, gy + dy));
      if (!b || !b.alive || !shipCan(b)) continue;
      const dist = Math.hypot(b.x - s.x, b.y - s.y);
      if (dist > reach) continue;
      const eff = b.hp * M[b.mat].res, shipDps = b === shipOn ? w.S.dps : 0;
      let score = b.value / (eff / (teamDps + shipDps) + dist / speed + 0.5);
      if (cutting.has(b) || b === shipOn) score *= T.stick;
      cands.push({ b, eff, shipDps, score, dps: shipDps, crew: [] });
    }
    cands.sort((a, c) => c.score - a.score);
    const left = new Set(free), used = [];
    // a drone already on the block costs nothing to send; otherwise prefer the one closest to it
    const cost = (d, b) => d.target === b ? -1 : Math.hypot(b.x - d.x, b.y - d.y);
    for (const c of cands) {
      if (!left.size) break;
      const need = c.eff / T.focusSecs;
      if (c.dps >= need) continue; // the ship alone finishes this one quickly
      const crew = [...left].filter(d => Math.hypot(c.b.x - s.x, c.b.y - s.y) <= d.st.reach)
        .sort((a, e) => cost(a, c.b) - cost(e, c.b));
      for (const d of crew) { if (c.dps >= need) break; c.crew.push(d); c.dps += d.st.dps; left.delete(d); }
      if (c.crew.length) used.push(c);
    }
    // everything in reach is covered: leftovers join whichever block will take longest
    left.forEach(d => {
      let best = null, bt = -1;
      used.forEach(c => { if (Math.hypot(c.b.x - s.x, c.b.y - s.y) > d.st.reach) return; const t = c.eff / c.dps; if (t > bt) { bt = t; best = c; } });
      if (best) { best.crew.push(d); best.dps += d.st.dps; }
      else d.target = null; // nothing in reach: orbit the ship
    });
    // fan the crew of each block out on the ship's side of it, keeping drones in the same slots
    used.forEach(c => {
      const base = Math.atan2(s.y - c.b.y, s.x - c.b.x), n = c.crew.length;
      c.crew.sort((a, e) => a.n - e.n).forEach((d, k) => { d.target = c.b; d.slot = base + (k - (n - 1) / 2) * T.spread; });
    });
  }

  // the block the wing has the most drones on, within maxD of the ship (for the ship's auto-aim)
  function wingFocus(maxD) {
    if (!D.WING.team.shipAssist || !w.wing.length) return null;
    const s = w.ship, count = new Map();
    w.wing.forEach(d => { if (d.target && d.target.alive) count.set(d.target, (count.get(d.target) || 0) + 1); });
    let best = null, bn = 0, bd = Infinity;
    count.forEach((n, b) => {
      const dd = Math.hypot(b.x - s.x, b.y - s.y);
      if (dd <= maxD && (n > bn || (n === bn && dd < bd))) { best = b; bn = n; bd = dd; }
    });
    return best;
  }
  function autoTarget(maxD) { return wingFocus(maxD) || nearestBlock(maxD); }

  function updateWing(dt) {
    const s = w.ship;
    w.wingPlan = (w.wingPlan || 0) - dt;
    if (w.wingPlan <= 0 || w.wing.some(d => d.target && !d.target.alive)) { planWing(); w.wingPlan = D.WING.team.replan; }
    w.wing.forEach(d => {
      const DS = d.st;
      droneModules(d, dt);
      if (d.relic) { // relic collector run takes priority
        const r = d.relic, dx = r.x - d.x, dy = r.y - d.y, dist = Math.hypot(dx, dy) || 1;
        d.vx += (dx / dist * DS.speed - d.vx) * Math.min(1, dt * 6); d.vy += (dy / dist * DS.speed - d.vy) * Math.min(1, dt * 6);
        d.x += d.vx * dt; d.y += d.vy * dt; d.a = Math.atan2(dy, dx); d.firing = false;
        if (!r.alive) d.relic = null;
        else if (dist < 14) { collectRelic(r, `Drone ${d.n} fetched a relic`); d.relic = null; }
        return;
      }
      if (d.target && (!d.target.alive || Math.hypot(d.target.x - s.x, d.target.y - s.y) > DS.reach + 30)) d.target = null;
      // where to fly: this drone's slot beside the team's block, or a slow orbit around the ship
      let gx, gy;
      if (d.target) {
        const a = d.slot != null ? d.slot : Math.atan2(d.y - d.target.y, d.x - d.target.x);
        gx = d.target.x + Math.cos(a) * 38; gy = d.target.y + Math.sin(a) * 38;
      } else {
        const a = w.elapsed * 0.9 + d.phase;
        gx = s.x + Math.cos(a) * 42; gy = s.y + Math.sin(a) * 42;
      }
      const dx = gx - d.x, dy = gy - d.y, dist = Math.hypot(dx, dy) || 1;
      const sp = Math.min(DS.speed, dist * 4);
      d.vx += (dx / dist * sp - d.vx) * Math.min(1, dt * 6); d.vy += (dy / dist * sp - d.vy) * Math.min(1, dt * 6);
      d.x += d.vx * dt; d.y += d.vy * dt;
      const look = d.target || { x: d.x + d.vx, y: d.y + d.vy };
      d.a = Math.atan2(look.y - d.y, look.x - d.x);
      // mine + heat (vents at the limit, then resumes by itself like the ship laser)
      d.firing = false;
      if (d.venting) { d.heat -= DS.fire / D.WING.coolTime * dt; if (d.heat <= 0) { d.heat = 0; d.venting = false; } }
      else if (d.target && Math.hypot(d.target.x - d.x, d.target.y - d.y) < 60) {
        d.firing = true; d.heat += dt;
        const t = d.target;
        hurtBlock(t, DS.dps * dt, true);
        if (d.heat >= DS.fire) d.venting = true;
        if (!t.alive) { d.target = null; w.wingPlan = 0; }
      } else d.heat = Math.max(0, d.heat - dt);
    });
  }

  function collectRelic(r, label) {
    r.alive = false; w.relicCount++; w.relicCredits += r.value; w.credits += r.value; w.xp += 10;
    if (r.crate) { r.ev.credits += r.value; label = 'Salvage crate'; }
    SM.Audio.contract(); vibrate(50);
    w.pops.push({ x: r.x, y: r.y - 8, text: '+' + r.value + ' relic', t: 0, color: '#f2c14e', size: 16 });
    caption(`${label} +${r.value} cr`, 'good');
  }
  // drone weapon + gear behaviour
  function droneModules(d, dt) {
    const s = w.ship, W = D.WING;
    d.wcd -= dt; d.gcd = Math.max(0, d.gcd - dt);
    if (d.weapon === 'pod' && d.wcd <= 0 && d.ammo > 0 && d.target && d.target.alive) {
      const m = W.weapons.find(x => x.id === 'pod');
      const a = Math.atan2(d.target.y - d.y, d.target.x - d.x);
      w.proj.push({ kind: 'missile', small: true, x: d.x, y: d.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, a, t: 0, target: d.target, dmg: m.dmg, r: m.radius, color: '#57e39a' });
      d.ammo--; d.wcd = m.cd; SM.Audio.launch();
    }
    if (d.weapon === 'flak' && d.wcd <= 0) {
      const m = W.weapons.find(x => x.id === 'flak');
      const i = w.debris.findIndex(o => Math.hypot(o.x - s.x, o.y - s.y) < m.range || Math.hypot(o.x - d.x, o.y - d.y) < m.range);
      const foe = i < 0 && nearestFoe(d.x, d.y, m.range);
      if (foe) {
        w.fx.push({ kind: 'beam', x1: d.x, y1: d.y, x2: foe.x, y2: foe.y, t: 0, life: 0.2, color: '#ff9a3c' });
        SM.Audio.hit(); hurtBlock(foe, 30 * TH.hp); d.wcd = m.cd;
      } else if (i >= 0) {
        const o = w.debris[i];
        w.fx.push({ kind: 'beam', x1: d.x, y1: d.y, x2: o.x, y2: o.y, t: 0, life: 0.2, color: '#ff9a3c' });
        for (let k = 0; k < 12; k++) w.particles.push({ x: o.x, y: o.y, vx: rand(-140, 140), vy: rand(-140, 140), t: 0, life: 0.5, color: k % 2 ? '#ff6b6b' : '#ffd76a', size: 3 });
        SM.Audio.hit(); SM.Audio.crack();
        w.debris[i] = newDebris(w.region, s);
        d.wcd = m.cd;
      }
    }
    if (d.weapon === 'pulse' && d.wcd <= 0 && d.target && d.target.alive) {
      const m = W.weapons.find(x => x.id === 'pulse');
      explode(d.target.x, d.target.y, m.radius, m.dmg, '#7fe3ff', true);
      SM.Audio.zap(); d.wcd = m.cd;
    }
    if (d.gear === 'collector' && !d.relic) {
      d.relic = w.relics.find(r => r.alive && !r.evaOnly && Math.hypot(r.x - s.x, r.y - s.y) < d.st.reach * 1.5 && !w.wing.some(o => o.relic === r)) || null;
    }
  }
  // Shield projectors: returns true if a shield absorbed the hit.
  function shieldBlock() {
    if (w.S.deflectCd > 0 && w.deflect <= 0) { // the ship's own deflector goes first
      w.deflect = w.S.deflectCd; w.deflected++;
      w.fx.push({ kind: 'ring', x: w.ship.x, y: w.ship.y, r: 30, t: 0, life: 0.5, color: '#b48cff' });
      SM.Audio.zap(); caption('Deflector absorbed the hit', 'good');
      return true;
    }
    const d = w.wing.find(o => o.gear === 'shield' && o.gcd <= 0);
    if (!d) return false;
    d.gcd = D.WING.gear.find(x => x.id === 'shield').cd;
    w.fx.push({ kind: 'ring', x: w.ship.x, y: w.ship.y, r: 26, t: 0, life: 0.5, color: '#7fe3ff' });
    SM.Audio.zap(); caption(`Drone ${d.n} shield blocked the hit`, 'good');
    return true;
  }

  // ---------- spacewalk (EVA) ----------
  function toggleEva() {
    if (!w) return;
    if (!w.eva) {
      if (w.o2 < 3) { SM.Audio.deny(); caption('Oxygen still refilling', 'warn'); return; }
      const s = w.ship;
      w.eva = true;
      s.vx *= 0.2; s.vy *= 0.2;
      w.miner = { x: s.x, y: s.y + 4, vx: 0, vy: 0, a: s.a, drilling: false, target: null, reel: false, inv: 0 };
      caption('Spacewalk: drill ignores resistance, grab glowing relics', 'good');
      if (w.tut >= 0) tutorialStep(99);
    } else if (w.miner) {
      w.miner.reel = true; // tether pulls the miner home
      caption('Reeling back to the ship');
    }
    applyEvaUi();
  }
  function applyEvaUi() {
    if (!w) return;
    $('tglEva').classList.toggle('on', w.eva);
    $('tglEva').querySelector('small').textContent = w.eva ? 'BOARD' : 'EXIT SHIP';
    $('hbarO2').hidden = !w.eva && w.o2 >= w.S.evaO2;
  }
  function updateEva(dt, mx, my, mag) {
    const m = w.miner, s = w.ship, S = w.S;
    w.o2 = Math.max(0, w.o2 - dt);
    if (w.o2 <= 0 && !m.reel) { m.reel = true; caption('Oxygen empty - tether reeling you in', 'danger'); SM.Audio.alarm(); vibrate([80, 60, 80]); }
    // auto EVA drives the miner whenever the player isn't steering (manual stick input always wins)
    if (m.auto && !m.reel && mag < 0.1 && w.idle > 0.6) {
      const a = autoEvaSteer(dt);
      if (a) { mx = a.x; my = a.y; mag = Math.hypot(mx, my); }
    }
    if (w.o2 < 8 && !w.warned.o2 && !m.reel && !m.auto) { w.warned.o2 = 1; SM.Audio.alarm(); caption('Oxygen low - head back to the ship', 'warn'); }
    let tvx, tvy;
    if (m.reel) {
      const dx = s.x - m.x, dy = s.y - m.y, d = Math.hypot(dx, dy) || 1;
      tvx = dx / d * 260; tvy = dy / d * 260;
      if (d < 16) { // back aboard
        w.eva = false; w.miner = null; w.warned.o2 = 0;
        caption('Back aboard', 'good'); applyEvaUi(); return;
      }
    } else { tvx = mx * S.evaSpeed; tvy = my * S.evaSpeed; }
    m.vx += (tvx - m.vx) * Math.min(1, dt * 6); m.vy += (tvy - m.vy) * Math.min(1, dt * 6);
    m.x += m.vx * dt; m.y += m.vy * dt;
    if (mag > 0.1) m.a = Math.atan2(my, mx);
    // tether limit
    const tx = m.x - s.x, ty = m.y - s.y, td = Math.hypot(tx, ty);
    if (td > D.EVA.tether) { m.x = s.x + tx / td * D.EVA.tether; m.y = s.y + ty / td * D.EVA.tether; }
    if (!m.reel) collideBlocks(m, 6, true);
    // hand drill: short range, ignores resistance
    m.drilling = false;
    if (!m.reel && (input.mine || settings().autoFire || m.auto)) {
      if (!m.target || !m.target.alive || Math.hypot(m.target.x - m.x, m.target.y - m.y) > D.EVA.drillRange + BS / 2) {
        m.target = null; let bd = D.EVA.drillRange + BS / 2;
        const gx = Math.floor(m.x / BS), gy = Math.floor(m.y / BS);
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
          const b = w.grid.get(key(gx + dx, gy + dy)); if (!b || !b.alive || !drillCan(b)) continue;
          const d = Math.hypot(b.x - m.x, b.y - m.y) - (b.part === 'core' ? 6 : 0); // inside a giant, prefer its core
          if (d < bd) { bd = d; m.target = b; }
        }
      }
      if (m.target) {
        m.drilling = true;
        const t = m.target;
        hurtBlock(t, S.drillDps * M[t.mat].res * dt, true, true); // x res cancels resistance
        if (S.drillSplash > 0) [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { // wide drill head
          const nb = w.grid.get(key(t.gx + dx, t.gy + dy));
          if (nb && nb.alive && drillCan(nb)) hurtBlock(nb, S.drillDps * S.drillSplash * M[nb.mat].res * dt, true, true);
        });
        if (S.drillDiag > 0) [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([dx, dy]) => { // past 100%: diagonals too
          const nb = w.grid.get(key(t.gx + dx, t.gy + dy));
          if (nb && nb.alive && drillCan(nb)) hurtBlock(nb, S.drillDps * S.drillDiag * M[nb.mat].res * dt, true, true);
        });
        if (Math.random() < 0.3 && !settings().reducedFx) w.particles.push({ x: t.x + rand(-5, 5), y: t.y + rand(-5, 5), vx: rand(-50, 50), vy: rand(-50, 50), t: 0, life: 0.3, color: '#ffd76a', size: 2 });
        if (!t.alive) m.target = null;
      }
    }
    // relics
    w.relics.forEach(r => { if (r.alive && Math.hypot(r.x - m.x, r.y - m.y) < 18) collectRelic(r, 'Relic recovered'); });
    // hazards hit the suit (oxygen), not the hull. Inside a giant rock the walls shelter you.
    const sheltered = inGiant(m);
    if (!sheltered) w.debris.forEach(d => {
      const dist = Math.hypot(d.x - m.x, d.y - m.y);
      if (dist < d.r + 7 && !(m.inv > 0)) {
        w.o2 = Math.max(0, w.o2 - D.EVA.debrisO2); m.inv = 1; SM.Audio.damage(); vibrate(60);
        caption(`Debris hit your suit -${D.EVA.debrisO2}s oxygen`, 'danger');
        m.vx = (m.x - d.x) / (dist || 1) * 200; m.vy = (m.y - d.y) / (dist || 1) * 200;
      }
    });
    if (m.inv > 0) m.inv -= dt;
    if (!sheltered) w.fields.forEach(f => { if (f.phase === 2 && Math.hypot(f.x - m.x, f.y - m.y) < f.r) w.o2 = Math.max(0, w.o2 - 4 * dt); });
  }

  // ---------- auto EVA (settings().autoEva, added 2026-11-07) ----------
  // Aboard with a full tank and hands off the stick, the ship sends the miner out on its own:
  // into a giant rock when parked at its hatch (autopilot parks there), or out to a loose relic within tether reach.
  // On foot it walks the job, drills automatically, and reels home with enough oxygen left to get back.
  const EVA_REEL_SPEED = 260;
  // a giant rock worth going into: not hollow yet, and diggable in the time left (or already started)
  function evaGiant() {
    const s = w.ship, S = w.S;
    let best = null, bd = Infinity;
    for (const G of w.giants) {
      if (G.open || G.cracked) continue;
      if (G.started) { if (w.time < 8) continue; }
      else {
        let hp = 0; G.cells.forEach(c => { if (c.alive && c.part === 'core') hp += c.hp; });
        const secs = G.digEst = hp / Math.max(0.1, S.drillDps * (1 + 2 * (S.drillSplash || 0) + (S.drillDiag || 0))) * 1.6; // x1.6 for oxygen refills
        if (secs > w.time - 10) continue;
      }
      const d = Math.hypot(G.hx - s.x, G.hy - s.y);
      if (!G.started && d < bd && w.route && w.route.giant === G && w.route.cost * 1.3 + G.digEst > w.time - 10) continue; // too far to get there in time
      if (d < bd) { bd = d; best = G; }
    }
    return best;
  }
  function parkPoint(G) { return { x: G.hx + G.nx * BS * 1.6, y: G.hy + G.ny * BS * 1.6 }; }
  // nearest loose relic (to point p) that the ship's tether reaches and no drone is already fetching
  function evaRelic(p) {
    const s = w.ship, reach = D.EVA.tether * 0.85;
    let best = null, bd = Infinity;
    for (const r of w.relics) {
      if (!r.alive || r.evaSkip || w.wing.some(d => d.relic === r) || Math.hypot(r.x - s.x, r.y - s.y) > reach) continue;
      const d = Math.hypot(r.x - p.x, r.y - p.y);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
  function autoEvaLaunch() {
    const s = w.ship;
    if (w.eva || w.time < 8 || w.o2 < w.S.evaO2) return;
    let job = null;
    const G = evaGiant();
    if (G) { const p = parkPoint(G); if (Math.hypot(p.x - s.x, p.y - s.y) < 40 && Math.hypot(s.vx, s.vy) < 40) job = { giant: G }; }
    if (!job) { const r = evaRelic(s); if (r) job = { relic: r }; }
    if (!job) return;
    toggleEva();
    if (!w.eva || !w.miner) return;
    w.miner.auto = true; w.miner.job = job;
    caption(job.giant ? 'Auto EVA: going into the giant rock' : 'Auto EVA: fetching a relic', 'good');
  }
  // steering vector for the miner, or null to hold still (it may also start the reel home)
  function autoEvaSteer(dt) {
    const m = w.miner, s = w.ship, job = m.job;
    const home = Math.hypot(s.x - m.x, s.y - m.y) / EVA_REEL_SPEED + 5; // seconds of oxygen the trip home needs, plus margin (no alarm on auto)
    if (w.o2 < home) {
      if (job.relic) job.relic.evaSkip = true; // couldn't reach it on one tank: don't keep trying
      m.reel = true; caption('Auto EVA: reeling in to refill oxygen'); return null;
    }
    if (w.time < 4) { m.reel = true; caption('Auto EVA: shift ending - back aboard'); return null; }
    let goal = null, stop = 0;
    const G = job.giant;
    if (G) {
      if (G.open || G.cracked) { m.reel = true; return null; } // hollow: the ship takes it from here
      const half = G.size * BS / 2;
      if (Math.abs(m.x - G.x) < half && Math.abs(m.y - G.y) < half) {
        // inside: walk to the nearest core cell still standing (the drill picks its own targets in reach)
        let bd = Infinity;
        G.cells.forEach(c => { if (c.alive && c.part === 'core') { const d = Math.hypot(c.x - m.x, c.y - m.y); if (d < bd) { bd = d; goal = c; } } });
        stop = BS * 0.9;
      } else {
        // outside: line up one cell out from the hatch, then walk straight in through it
        const ex = G.hx + G.nx * BS, ey = G.hy + G.ny * BS;
        const lined = Math.hypot(m.x - ex, m.y - ey) < 10 || Math.hypot(m.x - G.hx, m.y - G.hy) < BS * 0.8;
        goal = lined ? { x: G.hx - G.nx * BS, y: G.hy - G.ny * BS } : { x: ex, y: ey };
      }
    } else {
      if (!job.relic || !job.relic.alive || job.relic.evaSkip) { job.relic = evaRelic(m); job.stuck = 0; }
      if (!job.relic) { m.reel = true; caption(job.blocked ? 'Auto EVA: relic blocked by rock - back aboard' : 'Auto EVA: all relics in reach collected'); return null; }
      goal = job.relic;
      // walking into a wall? give up on this relic after 2 s and try the next one
      if (Math.hypot(m.vx, m.vy) < 12) { job.stuck = (job.stuck || 0) + dt; if (job.stuck > 2) { job.relic.evaSkip = true; job.relic = null; job.blocked = true; return null; } }
      else job.stuck = 0;
    }
    if (!goal) { m.reel = true; return null; }
    const dx = goal.x - m.x, dy = goal.y - m.y, d = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, Math.min(1, (d - stop) / 30));
    let x = dx / d * k, y = dy / d * k;
    if (!inGiant(m)) for (const db of w.debris) { // sidestep debris in open space
      const ex = m.x - db.x, ey = m.y - db.y, dist = Math.hypot(ex, ey), r = db.r + 60;
      if (dist < r) { const f = (r - dist) / 60 * 1.5; x += ex / (dist || 1) * f; y += ey / (dist || 1) * f; }
    }
    const mg = Math.hypot(x, y);
    if (mg < 0.05) return null;
    return mg > 1 ? { x: x / mg, y: y / mg } : { x, y };
  }

  // draw helpers for the wing, the miner and relics
  function drawWingAndEva() {
    const paint = w.look.paint.color;
    const now = performance.now() / 1000;
    // derelict ship (rare event): a broken hull with its salvage crates around it
    const dr = w.derelict;
    if (dr) {
      g.save(); g.translate(dr.x, dr.y); g.rotate(dr.a + now * 0.05);
      g.fillStyle = '#2b3240'; g.strokeStyle = '#6c7a93'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(40, 0); g.lineTo(10, -16); g.lineTo(-30, -18); g.lineTo(-36, -6); g.lineTo(-22, 0); g.lineTo(-36, 8); g.lineTo(-28, 18); g.lineTo(12, 15); g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = '#1a1f29'; g.lineWidth = 3; g.beginPath(); g.moveTo(-4, -17); g.lineTo(4, -2); g.lineTo(-6, 15); g.stroke(); // hull breach
      g.fillStyle = Math.floor(now * 2) % 2 ? '#ff9a3c' : '#5a3a1c'; g.beginPath(); g.arc(24, 0, 3, 0, Math.PI * 2); g.fill(); // dying beacon
      g.restore();
      if (!dr.ev.done) { g.fillStyle = '#9fb3d9'; g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.fillText('DERELICT', dr.x, dr.y - 34); }
    }
    // relics
    w.relics.forEach(r => {
      if (!r.alive) return;
      if (r.crate) { // salvage crate (derelict event)
        g.save(); g.translate(r.x, r.y); g.rotate(Math.sin(now + r.t) * 0.3);
        g.globalAlpha = 0.3 + 0.2 * Math.sin(now * 4 + r.t); g.fillStyle = '#7fe3ff'; g.fillRect(-11, -11, 22, 22); g.globalAlpha = 1;
        g.fillStyle = '#8a6a3a'; g.strokeStyle = '#ffd76a'; g.lineWidth = 1.5; g.fillRect(-7, -7, 14, 14); g.strokeRect(-7, -7, 14, 14);
        g.beginPath(); g.moveTo(-7, 0); g.lineTo(7, 0); g.stroke();
        g.restore();
        return;
      }
      const pulse = 0.6 + Math.sin(now * 4 + r.t) * 0.4;
      g.save(); g.translate(r.x, r.y);
      g.globalAlpha = 0.35 * pulse; g.fillStyle = '#f2c14e';
      g.beginPath(); g.arc(0, 0, 14, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1; g.fillStyle = '#fff3c4'; g.strokeStyle = '#a07a1c'; g.lineWidth = 1.5;
      g.rotate(now + r.t);
      g.beginPath(); g.moveTo(0, -7); g.lineTo(6, 0); g.lineTo(0, 7); g.lineTo(-6, 0); g.closePath(); g.fill(); g.stroke();
      g.restore();
      if (Math.hypot(r.x - w.ship.x, r.y - w.ship.y) < w.S.scan * 1.5) {
        g.fillStyle = '#f2c14e'; g.font = 'bold 9px system-ui'; g.textAlign = 'center'; g.fillText('RELIC', r.x, r.y - 16);
      }
    });
    // escort drones: green corner brackets on the blocks the wing is cutting together
    const focus = new Set(w.wing.filter(d => d.target && d.target.alive && !d.relic).map(d => d.target));
    g.strokeStyle = 'rgba(87,227,154,0.75)'; g.lineWidth = 1.5;
    focus.forEach(b => {
      const h = BS / 2 + 3, k = 6;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
        g.beginPath(); g.moveTo(b.x + sx * h, b.y + sy * (h - k)); g.lineTo(b.x + sx * h, b.y + sy * h); g.lineTo(b.x + sx * (h - k), b.y + sy * h); g.stroke();
      });
    });
    w.wing.forEach(d => {
      if (d.firing && d.target) {
        g.strokeStyle = 'rgba(87,227,154,0.5)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.target.x, d.target.y); g.stroke();
        g.strokeStyle = '#d9ffe9'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.target.x + rand(-2, 2), d.target.y + rand(-2, 2)); g.stroke();
      }
      g.save(); g.translate(d.x, d.y); g.rotate(d.a);
      g.fillStyle = paint; g.strokeStyle = '#1a2233'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, -6); g.lineTo(-2, 0); g.lineTo(-5, 6); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = d.venting ? '#ff8a5c' : '#57e39a'; g.fillRect(-1, -1.5, 3, 3);
      if (d.weapon) { g.fillStyle = d.weapon === 'flak' ? '#ff9a3c' : d.weapon === 'pod' ? '#57e39a' : '#7fe3ff'; g.fillRect(-4, -8, 6, 2); g.fillRect(-4, 6, 6, 2); }
      g.restore();
      if (d.gear === 'shield' && d.gcd <= 0) { g.strokeStyle = 'rgba(127,227,255,0.5)'; g.lineWidth = 1; g.beginPath(); g.arc(d.x, d.y, 10, 0, Math.PI * 2); g.stroke(); }
    });
    // miner + tether
    const m = w.miner;
    if (m) {
      g.strokeStyle = 'rgba(255,215,106,0.55)'; g.lineWidth = 1.5; g.setLineDash([3, 4]);
      g.beginPath(); g.moveTo(w.ship.x, w.ship.y); g.quadraticCurveTo((w.ship.x + m.x) / 2 + 12, (w.ship.y + m.y) / 2 + 12, m.x, m.y); g.stroke();
      g.setLineDash([]);
      if (m.drilling && m.target) {
        g.strokeStyle = '#ffd76a'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(m.x, m.y); g.lineTo(m.target.x + rand(-3, 3), m.target.y + rand(-3, 3)); g.stroke();
      }
      if (!(m.inv > 0 && Math.floor(m.inv * 12) % 2 === 0)) {
        g.save(); g.translate(m.x, m.y);
        g.fillStyle = paint; g.strokeStyle = '#1a2233'; g.lineWidth = 1.2;
        g.beginPath(); g.arc(0, 2, 6, 0, Math.PI * 2); g.fill(); g.stroke();       // suit
        g.fillStyle = '#4fb8ff'; g.beginPath(); g.arc(Math.cos(m.a) * 2, -3 + Math.sin(m.a) * 2, 3.2, 0, Math.PI * 2); g.fill(); // visor
        g.fillStyle = '#8a96ad'; g.fillRect(-7, 0, 3, 6);                             // backpack
        g.restore();
      }
      // drill reach ring
      g.strokeStyle = 'rgba(255,215,106,0.15)'; g.lineWidth = 1;
      g.beginPath(); g.arc(m.x, m.y, D.EVA.drillRange + BS / 2, 0, Math.PI * 2); g.stroke();
    }
  }

  // ---------- secondary weapons ----------
  function cycleWeapon() {
    if (!w) return;
    const ids = D.WEAPONS.map(x => x.id).filter(id => id in w.ammo);
    if (ids.length < 2) return;
    w.weapon = ids[(ids.indexOf(w.weapon) + 1) % ids.length];
    const st = SM.State.get(); st.weapons.equipped = w.weapon;
    caption(SM.State.weaponDef(w.weapon).name + ' ready');
    hud();
  }
  function aimPoint() {
    const s = w.ship;
    const t = (w.target && w.target.alive) ? w.target : nearestBlock(400);
    return t ? { x: t.x, y: t.y, b: t } : { x: s.x + Math.cos(s.a) * 200, y: s.y + Math.sin(s.a) * 200, b: null };
  }
  function fireWeapon() {
    if (!w || !w.weapon) return;
    const id = w.weapon, def = SM.State.weaponDef(id), ws = SM.State.weaponStats(id);
    if (!(w.ammo[id] > 0)) { SM.Audio.deny(); caption(def.name + ' out of ammo - restocks next sortie', 'warn'); return false; }
    if (w.wcd > 0) return false;
    w.ammo[id]--; w.wcd = 0.35;
    const s = w.ship, aim = aimPoint();
    const a = Math.atan2(aim.y - s.y, aim.x - s.x);
    vibrate(25);
    if (id === 'missile') {
      SM.Audio.launch();
      w.proj.push({ kind: id, x: s.x, y: s.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, a, t: 0, target: aim.b, dmg: ws.dmg, r: ws.radius, color: def.color });
    } else if (id === 'grenade') {
      SM.Audio.launch();
      const d = Math.min(240, Math.hypot(aim.x - s.x, aim.y - s.y));
      const sp = d / 0.9; // arrives about when it detonates
      w.proj.push({ kind: id, x: s.x, y: s.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, a, t: 0, fuse: 1.0, dmg: ws.dmg, r: ws.radius, color: def.color });
    } else if (id === 'lance') {
      SM.Audio.zap();
      const len = ws.range, hit = new Set();
      for (let d = 10; d <= len; d += 8) {
        const x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d;
        const b = w.grid.get(key(Math.floor(x / BS), Math.floor(y / BS)));
        if (b && b.alive && !hit.has(b)) { hit.add(b); hurtBlock(b, ws.dmg); }
      }
      w.fx.push({ kind: 'beam', x1: s.x, y1: s.y, x2: s.x + Math.cos(a) * len, y2: s.y + Math.sin(a) * len, t: 0, life: 0.35, color: def.color });
      if (settings().shake) w.shake = Math.max(w.shake, 3);
    } else if (id === 'shock') {
      SM.Audio.boom();
      explode(s.x, s.y, ws.radius * 0.75, ws.dmg, def.color, true);
      // knock out debris and short any electrical field in reach
      w.debris.forEach((d, i) => {
        if (Math.hypot(d.x - s.x, d.y - s.y) < ws.radius + d.r) {
          for (let k = 0; k < 10; k++) w.particles.push({ x: d.x, y: d.y, vx: rand(-120, 120), vy: rand(-120, 120), t: 0, life: 0.6, color: '#ff6b6b', size: 3 });
          w.debris[i] = newDebris(w.region, s); // respawns far away
        }
      });
      w.fields.forEach(f => { if (Math.hypot(f.x - s.x, f.y - s.y) < ws.radius + f.r) f.t = 0; });
      w.mines.forEach(m => { if (m.alive && Math.hypot(m.x - s.x, m.y - s.y) < ws.radius + 20) disarmMine(m); });
      w.fx.push({ kind: 'ring', x: s.x, y: s.y, r: ws.radius, t: 0, life: 0.5, color: def.color });
    }
    hud();
    return true;
  }
  // ---------- reloading ----------
  function needsAmmo(id) { return id in w.ammo && w.ammo[id] < w.maxAmmo[id]; }
  // Salvage from broken blocks reloads the equipped weapon first, then any other owned weapon that isn't full.
  function addSalvage(n) {
    if (!w.weapon) return;
    const T = D.SALVAGE_PER_SHOT;
    w.salvage += n;
    while (w.salvage >= T) {
      const id = needsAmmo(w.weapon) ? w.weapon : Object.keys(w.ammo).find(needsAmmo);
      if (!id) { w.salvage = T; break; } // everything full: meter waits at 100%
      w.ammo[id]++; w.salvage -= T; w.shotsSalvaged++;
      SM.Audio.buy();
      caption(`Salvage reloaded +1 ${SM.State.weaponDef(id).name}`, 'good');
    }
  }
  // Buy one shot of the equipped weapon. Paid from this sortie's credits first, then the wallet.
  function buyReload() {
    if (!w || !w.weapon) return;
    const id = w.weapon, def = SM.State.weaponDef(id), st = SM.State.get();
    if (!needsAmmo(id)) { caption(def.name + ' is fully loaded'); return; }
    const cost = SM.State.reloadCost(id);
    if (w.credits + st.credits < cost) { SM.Audio.deny(); caption(`Need ${cost} cr to reload`, 'warn'); return; }
    purchaseShot(id, cost, false);
  }
  // runOnly: the autoloader never touches the wallet, only credits mined this sortie.
  function purchaseShot(id, cost, runOnly) {
    const def = SM.State.weaponDef(id), st = SM.State.get();
    const fromRun = Math.min(w.credits, cost), fromWallet = runOnly ? 0 : cost - fromRun;
    if (fromRun + fromWallet < cost) return false;
    w.credits -= fromRun; st.credits -= fromWallet;
    w.ammoRun += fromRun; w.ammoWallet += fromWallet; w.shotsBought++;
    if (fromWallet) SM.State.save();
    w.ammo[id]++;
    SM.Audio.buy();
    caption(`${runOnly ? 'Autoloader bought' : 'Bought'} 1 ${def.name} shot -${cost} cr`);
    hud();
    return true;
  }

  // ---------- ship automation (DATA.AUTO, bought in Upgrades > Weapons) ----------
  function blocksNear(x, y, r) {
    const gr = Math.ceil(r / BS) + 1, gx = Math.floor(x / BS), gy = Math.floor(y / BS);
    let n = 0;
    for (let dx = -gr; dx <= gr; dx++) for (let dy = -gr; dy <= gr; dy++) {
      const b = w.grid.get(key(gx + dx, gy + dy));
      if (b && b.alive && Math.hypot(b.x - x, b.y - y) <= r + BS / 2) n++;
    }
    return n;
  }
  // How good a shot with weapon id would be right now. >= 1 means "worth the ammo".
  //   missile: target needs more than 2 s of laser time    -> secs / 2
  //   grenade: blocks inside the blast where it will land   -> count / 3
  //   lance:   blocks along the beam                        -> count / 3
  //   shock:   debris about to hit = 3, live field on us = 2, else blocks in reach / 5
  function shotScore(id) {
    const s = w.ship, S = w.S, ws = SM.State.weaponStats(id), aim = aimPoint();
    if (id === 'missile') {
      const t = aim.b;
      if (!t || Math.hypot(t.x - s.x, t.y - s.y) > S.range * 2) return 0;
      return t.hp * M[t.mat].res / S.dps / 2;
    }
    if (id === 'grenade') {
      if (!aim.b) return 0;
      const a = Math.atan2(aim.y - s.y, aim.x - s.x), d = Math.min(240, Math.hypot(aim.x - s.x, aim.y - s.y));
      return blocksNear(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, ws.radius) / 3;
    }
    if (id === 'lance') {
      if (!aim.b) return 0;
      const a = Math.atan2(aim.y - s.y, aim.x - s.x), hit = new Set();
      for (let d = 10; d <= ws.range; d += 8) {
        const b = w.grid.get(key(Math.floor((s.x + Math.cos(a) * d) / BS), Math.floor((s.y + Math.sin(a) * d) / BS)));
        if (b && b.alive) hit.add(b);
      }
      return hit.size / 3;
    }
    if (id === 'shock') {
      if (w.debris.some(d => Math.hypot(d.x - s.x, d.y - s.y) < ws.radius * 0.6 + d.r)) return 3;
      if (w.fields.some(f => f.phase >= 1 && Math.hypot(f.x - s.x, f.y - s.y) < f.r + SHIP_R)) return 2;
      return blocksNear(s.x, s.y, ws.radius * 0.75) / 5;
    }
    return 0;
  }
  function updateAuto(dt) {
    if (!w.weapon || w.tut === 0) return;
    const St = SM.State, loaded = id => w.ammo[id] > 0;
    w.autoCd -= dt; w.loadCd -= dt;
    // current weapon empty -> switch to one that still has ammo (doesn't change your saved pick).
    // The weapon selector does this on its own; the fire-control computer has it built in.
    if (!loaded(w.weapon) && (St.autoOn('selector') || St.autoOn('fcs'))) {
      const next = D.WEAPONS.map(x => x.id).find(id => loaded(id));
      if (next) { w.weapon = next; caption(St.weaponDef(next).name + ' selected (empty weapon swapped)'); hud(); }
    }
    // autoloader: everything we'd use is empty -> buy a shot from this sortie's credits
    if (!loaded(w.weapon) && St.autoOn('loader') && w.loadCd <= 0) {
      w.loadCd = 1;
      if (purchaseShot(w.weapon, St.reloadCost(w.weapon), true)) w.autoLoads++;
    }
    // fire-control computer
    if (!St.autoOn('fcs') || w.autoCd > 0 || w.wcd > 0) return;
    // every loaded weapon is considered; the best-fitting shot wins (ties go to the weapon with more ammo left)
    const ids = D.WEAPONS.map(x => x.id).filter(loaded);
    let best = null, bestScore = 1;
    ids.forEach(id => {
      const sc = shotScore(id) + w.ammo[id] * 0.01;
      if (sc >= bestScore) { best = id; bestScore = sc; }
    });
    if (!best) { w.autoCd = 0.25; return; } // check again shortly
    if (best !== w.weapon) caption(St.weaponDef(best).name + ' selected');
    w.weapon = best;
    if (fireWeapon()) { w.autoShots++; w.autoCd = St.fcsDelay(); }
  }

  // ---------- ship weapons & systems (DATA.SHIP_GEAR, levels in Upgrades > Shuttle) ----------
  // Wide beam and split beam: run every frame the main laser is firing at block b.
  function laserExtras(b, dt) {
    if (!w) return;
    const s = w.ship, S = w.S;
    if (S.wideBeam > 0 && !b.foe) { // like the Wide drill head: burn the 4 blocks around the target
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!w) return;
        const nb = w.grid.get(key(b.gx + dx, b.gy + dy));
        if (nb && nb.alive && shipCan(nb)) hurtBlock(nb, S.dps * S.wideBeam * dt, true);
      }
      if (S.wideDiag > 0) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { // past 100%: the diagonals too
        if (!w) return;
        const nb = w.grid.get(key(b.gx + dx, b.gy + dy));
        if (nb && nb.alive && shipCan(nb)) hurtBlock(nb, S.dps * S.wideDiag * dt, true);
      }
    }
    if (!w) return;
    if (S.splitBeam > 0) { // a second beam on the nearest other block in lock range (no extra heat)
      let t = w.splitTarget;
      if (!t || !t.alive || t === b || Math.hypot(t.x - s.x, t.y - s.y) > S.range) t = w.splitTarget = nearestNear(s.x, s.y, S.range, b);
      if (t) hurtBlock(t, S.dps * S.splitBeam * dt, true);
      if (w && S.splitBeam2 > 0) { // past 100%: a third beam on yet another block
        let t2 = w.splitTarget2;
        if (!t2 || !t2.alive || t2 === b || t2 === w.splitTarget || Math.hypot(t2.x - s.x, t2.y - s.y) > S.range) t2 = w.splitTarget2 = nearestNear(s.x, s.y, S.range, b, w.splitTarget);
        if (t2) hurtBlock(t2, S.dps * S.splitBeam2 * dt, true);
      }
    }
  }
  function zapDebris(i, x, y, color) {
    const o = w.debris[i];
    w.fx.push({ kind: 'beam', x1: x, y1: y, x2: o.x, y2: o.y, t: 0, life: 0.2, color });
    for (let k = 0; k < 12; k++) w.particles.push({ x: o.x, y: o.y, vx: rand(-140, 140), vy: rand(-140, 140), t: 0, life: 0.5, color: k % 2 ? '#ff6b6b' : '#ffd76a', size: 3 });
    SM.Audio.hit(); SM.Audio.crack();
    w.debris[i] = newDebris(w.region, w.ship);
  }
  function updateShipGear(dt) {
    const s = w.ship, S = w.S, G = D.SHIP_GEAR;
    // deflector recharge
    if (S.deflectCd > 0 && w.deflect > 0) {
      w.deflect -= dt;
      if (w.deflect <= 0) w.fx.push({ kind: 'ring', x: s.x, y: s.y, r: 24, t: 0, life: 0.4, color: '#b48cff' });
    }
    // point defence: zap the nearest debris rock that comes close
    if (S.pdCd > 0) {
      w.pdCd -= dt;
      if (w.pdCd <= 0) {
        let bi = -1, bd = G.pd.range;
        w.debris.forEach((d, i) => { const dd = Math.hypot(d.x - s.x, d.y - s.y) - d.r; if (dd < bd) { bd = dd; bi = i; } });
        if (bi >= 0) { zapDebris(bi, s.x, s.y, '#b48cff'); w.pdCd = S.pdCd; w.pdZaps++; }
      }
    }
    // twin miniguns: fire with the laser, never overheat. Scavengers first, then the laser's target, then the nearest block.
    w.gunTarget = null;
    if (S.gunDps > 0 && w.wantFire) {
      const range = S.range * G.minigun.range;
      let t = nearestFoe(s.x, s.y, range);
      if (!t && w.target && w.target.alive && shipCan(w.target) && Math.hypot(w.target.x - s.x, w.target.y - s.y) <= range) t = w.target;
      if (!t) t = nearestBlock(range);
      if (t) {
        w.gunTarget = t;
        w.gunTick -= dt;
        if (w.gunTick <= 0) {
          w.gunTick = G.minigun.rate; w.gunSide = -w.gunSide;
          const ga = s.a + w.gunSide * Math.PI / 2;
          w.fx.push({ kind: 'tracer', x1: s.x + Math.cos(ga) * 8, y1: s.y + Math.sin(ga) * 8, x2: t.x + rand(-6, 6), y2: t.y + rand(-6, 6), t: 0, life: 0.07, color: '#ffd76a' });
          if (!settings().reducedFx && Math.random() < 0.35) w.particles.push({ x: t.x + rand(-6, 6), y: t.y + rand(-6, 6), vx: rand(-80, 80), vy: rand(-80, 80), t: 0, life: 0.2, color: '#ffe9a8', size: 2 });
        }
        hurtBlock(t, S.gunDps * dt, true);
        if (!w) return;
      }
    }
    // sentry turrets: the ship drops one where it is mining; idle ones left behind jump back to the ship
    if (S.sentries > 0) {
      const R = G.sentry.range;
      // who the sentries guard: the miner on a spacewalk, otherwise the ship
      const guard = w.eva && w.miner ? w.miner : s;
      w.sentryCd -= dt;
      if ((w.firing || (w.eva && w.miner)) && w.sentryCd <= 0 && !w.sentries.some(q => Math.hypot(q.x - guard.x, q.y - guard.y) < R * 0.6)) {
        let q = null;
        if (w.sentries.length < S.sentries) { q = { idle: 0, a: s.a, shot: null, target: null, flakCd: 0 }; w.sentries.push(q); }
        else {
          // on a spacewalk the sentry farthest from the miner comes along; otherwise an idle one jumps to the ship
          q = guard !== s ? w.sentries.reduce((a, o) => Math.hypot(o.x - guard.x, o.y - guard.y) > Math.hypot(a.x - guard.x, a.y - guard.y) ? o : a)
            : w.sentries.find(o => o.idle > 1.5);
          if (q) w.fx.push({ kind: 'ring', x: q.x, y: q.y, r: 16, t: 0, life: 0.4, color: '#57e39a' });
        }
        if (q) {
          q.x = guard.x + (guard === s ? 0 : rand(-25, 25)); q.y = guard.y + (guard === s ? 0 : rand(-25, 25));
          q.idle = 0; q.target = null; w.sentryCd = G.sentry.dropEvery;
          w.fx.push({ kind: 'ring', x: q.x, y: q.y, r: 20, t: 0, life: 0.4, color: '#57e39a' });
          SM.Audio.click();
        }
      }
      for (const q of w.sentries) {
        if (!w) return;
        // flak: shoot down an incoming asteroid, the one closest to the miner / ship first
        q.flakCd = (q.flakCd || 0) - dt;
        if (q.flakCd <= 0) {
          let bi = -1, bd = Infinity;
          w.debris.forEach((d, i) => {
            if (Math.hypot(d.x - q.x, d.y - q.y) - d.r > G.sentry.flakRange) return;
            const dd = Math.min(Math.hypot(d.x - guard.x, d.y - guard.y), Math.hypot(d.x - s.x, d.y - s.y));
            if (dd < bd) { bd = dd; bi = i; }
          });
          if (bi >= 0) {
            q.a = Math.atan2(w.debris[bi].y - q.y, w.debris[bi].x - q.x);
            zapDebris(bi, q.x, q.y, '#57e39a');
            q.flakCd = S.sentryFlakCd; w.sentryZaps = (w.sentryZaps || 0) + 1;
          }
        }
        let t = nearestFoe(q.x, q.y, R);
        if (!t) {
          if (!q.target || !q.target.alive || Math.hypot(q.target.x - q.x, q.target.y - q.y) > R) q.target = nearestNear(q.x, q.y, R);
          t = q.target;
        }
        q.shot = t;
        if (!t) { q.idle += dt; continue; }
        q.idle = 0; q.a = Math.atan2(t.y - q.y, t.x - q.x);
        hurtBlock(t, S.sentryDps * dt, true);
      }
    }
  }
  function drawShipGear() {
    const s = w.ship, S = w.S;
    // split beam
    if (w.firing) [w.splitTarget, S.splitBeam2 > 0 ? w.splitTarget2 : null].forEach(t => {
      if (!t || !t.alive) return;
      const ex = s.x + Math.cos(s.a) * 10, ey = s.y + Math.sin(s.a) * 10;
      g.strokeStyle = 'rgba(255,107,214,0.35)'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(ex, ey); g.lineTo(t.x, t.y); g.stroke();
      g.strokeStyle = '#ffd1f2'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(ex, ey); g.lineTo(t.x + rand(-2, 2), t.y + rand(-2, 2)); g.stroke();
    });
    // wide beam glow on the neighbours
    if (w.firing && S.wideBeam > 0 && w.target && !w.target.foe) {
      const b = w.target;
      g.strokeStyle = `rgba(120,230,255,${0.15 + 0.3 * S.wideBeam})`; g.lineWidth = 4;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nb = w.grid.get(key(b.gx + dx, b.gy + dy));
        if (!nb || !nb.alive || !shipCan(nb)) return;
        g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(nb.x, nb.y); g.stroke();
      });
    }
    // sentries
    w.sentries.forEach(q => {
      if (q.shot) {
        g.strokeStyle = 'rgba(87,227,154,0.6)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(q.shot.x + rand(-2, 2), q.shot.y + rand(-2, 2)); g.stroke();
      }
      g.save(); g.translate(q.x, q.y);
      g.fillStyle = '#2a3b33'; g.strokeStyle = '#57e39a'; g.lineWidth = 1.5;
      g.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.lineTo(Math.cos(a) * 8, Math.sin(a) * 8); } g.closePath(); g.fill(); g.stroke();
      g.rotate(q.a); g.fillStyle = '#57e39a'; g.fillRect(0, -1.5, 10, 3);
      g.restore();
    });
    // deflector bubble when charged
    if (S.deflectCd > 0 && w.deflect <= 0 && !w.eva) {
      g.strokeStyle = 'rgba(180,140,255,0.45)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(s.x, s.y, 20, 0, Math.PI * 2); g.stroke();
    }
  }

  // weapon damage goes through block resistance just like the laser
  function hurtBlock(b, dmg, quiet, drill) {
    if (!b.alive) return;
    if (b.giant && !(drill ? drillCan(b) : shipCan(b))) return; // giant rock: shell is closed / core is drill-only
    const m = M[b.mat];
    b.hp -= dmg / m.res; b.flash = 0.12; b.hitAt = w.elapsed;
    if (b.foe) { if (b.hp <= 0) killFoe(b); return; }
    const prev = b.state || 0, frac = b.hp / b.maxHp;
    b.state = frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;
    if (b.state > prev && !quiet) SM.Audio.crack();
    if (b.hp <= 0) breakBlock(b);
  }
  function explode(x, y, r, dmg, color, quiet) {
    if (!quiet) SM.Audio.boom();
    vibrate(60);
    if (settings().shake) w.shake = Math.max(w.shake, 7);
    const gr = Math.ceil(r / BS) + 1, gx = Math.floor(x / BS), gy = Math.floor(y / BS);
    const hits = [];
    for (let dx = -gr; dx <= gr; dx++) for (let dy = -gr; dy <= gr; dy++) {
      const b = w.grid.get(key(gx + dx, gy + dy));
      if (!b || !b.alive) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d <= r + BS / 2) hits.push([b, d]);
    }
    hits.forEach(([b, d]) => hurtBlock(b, dmg * (d < r * 0.5 ? 1 : 0.6))); // full damage in the middle
    w.foes.forEach(f => { if (f.alive && Math.hypot(f.x - x, f.y - y) < r + (f.r || 14)) hurtBlock(f, dmg); });
    w.mines.forEach(m => { if (m.alive && m.arm < 0 && Math.hypot(m.x - x, m.y - y) < r + 20) m.arm = 0.25; }); // chain
    const n = settings().reducedFx ? 10 : 34;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(60, r * 4);
      w.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: rand(0.3, 0.7), color: i % 2 ? color : '#fff3c4', size: rand(2, 5) });
    }
    if (r > 0) w.fx.push({ kind: 'ring', x, y, r, t: 0, life: 0.35, color });
  }
  function updateWeapons(dt) {
    if (w.wcd > 0) w.wcd -= dt;
    w.proj = w.proj.filter(p => {
      p.t += dt;
      if (p.kind === 'missile') {
        if (!p.target || !p.target.alive) p.target = nearestBlockTo(p.x, p.y, 500);
        const sp = Math.min(520, 120 + p.t * 900);
        if (p.target) {
          const ta = Math.atan2(p.target.y - p.y, p.target.x - p.x);
          let da = ta - p.a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
          p.a += Math.max(-7 * dt, Math.min(7 * dt, da));
        }
        p.vx = Math.cos(p.a) * sp; p.vy = Math.sin(p.a) * sp;
        if (!settings().reducedFx) w.particles.push({ x: p.x, y: p.y, vx: rand(-20, 20), vy: rand(-20, 20), t: 0, life: 0.4, color: '#ffd76a', size: 2 });
      } else { p.vx *= 1 - 1.2 * dt; p.vy *= 1 - 1.2 * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const b = w.grid.get(key(Math.floor(p.x / BS), Math.floor(p.y / BS)));
      const out = p.x < 0 || p.y < 0 || p.x > W || p.y > H;
      const boom = (p.kind === 'missile' && (b || p.t > 3 || (p.target && p.target.foe && Math.hypot(p.target.x - p.x, p.target.y - p.y) < 16))) || (p.kind === 'grenade' && (p.t >= p.fuse || (b && p.t > 0.15)));
      if (boom || out) { if (!out) explode(p.x, p.y, p.r, p.dmg, p.color); return false; }
      return true;
    });
    w.fx = w.fx.filter(f => (f.t += dt) < f.life);
  }
  function nearestBlockTo(x, y, maxD) {
    let best = null, bd = maxD;
    for (const b of w.blocks) { if (!b.alive || !shipCan(b)) continue; const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
    return best;
  }

  function breakBlock(b) {
    b.alive = false; w.grid.delete(key(b.gx, b.gy));
    const m = M[b.mat];
    w.credits += b.value; w.fieldCr += b.value; w.broken++; w.xp += m.xp;
    if (!b.giant || b.counted) w.left--;
    w.surveyed[w.region.id] = true;
    w.byMatCr[b.mat] = (w.byMatCr[b.mat] || 0) + b.value;
    w.byMat[b.mat] = (w.byMat[b.mat] || 0) + 1;
    addSalvage(m.xp);
    if (m.fx === 'fuel') { w.fuel = Math.min(w.S.fuel, w.fuel + w.S.fuel * 0.03); w.pops.push({ x: b.x, y: b.y + 10, text: '+fuel', t: 0, color: '#9fe3ff', size: 11 }); }
    else if (m.fx === 'energy') { w.energy = w.S.energy; w.heat = Math.max(0, w.heat - w.S.heat * 0.5); w.pops.push({ x: b.x, y: b.y + 10, text: '+energy', t: 0, color: '#c77dff', size: 11 }); }
    else if (m.fx === 'boom') w.booms.push({ x: b.x, y: b.y, t: 0.18 });
    const st = SM.State.get();
    if (!st.discovered[b.mat]) { st.discovered[b.mat] = true; w.xp += 5; caption('New material discovered: ' + m.name, 'good'); }
    SM.Audio.brk(m.value);
    vibrate(m.value >= 50 ? 40 : 15);
    if (settings().shake) w.shake = Math.max(w.shake, m.value >= 50 ? 5 : 2);
    const n = settings().reducedFx ? 5 : (m.value >= 50 ? 26 : 14);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(40, m.value >= 50 ? 200 : 130);
      w.particles.push({ x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: rand(0.4, 0.8), color: i % 3 ? m.color : '#fff', size: rand(2, 4.5) });
    }
    w.pops.push({ x: b.x, y: b.y - 6, text: '+' + b.value, t: 0, color: '#ffd76a', size: m.value >= 50 ? 18 : 14 });
    if (w.target === b) {
      w.target = settings().aimAssist ? autoTarget(w.S.range) : null;
    }
    if (b.giant) giantCellGone(b);
    if (w.tut >= 0 && w.tut <= 2) tutorialStep(3);
    else if (w.tut === 3 && w.broken >= 3) tutorialStep(4);
    if (cb.onBreak) cb.onBreak();
  }

  // ---------- giant hollow rocks (DATA.GIANT) ----------
  function giantCellGone(b) {
    const G = b.giant;
    if (b.part === 'core') {
      G.coreLeft--; G.started = true;
      if (G.coreLeft > 0) caption(`Giant rock hollowed ${G.core - G.coreLeft}/${G.core}`);
      else openGiant(G);
    } else if (--G.shellLeft <= 0 && !G.cracked) crackGiant(G);
  }
  // core gone: the shell turns weak, counts toward the field and the ship can break it
  function openGiant(G) {
    G.open = true;
    G.cells.forEach(c => { if (!c.alive) return; if (c.part === 'hatch') c.part = 'shell'; c.counted = true; w.left++; });
    w.pops.push({ x: G.x, y: G.y - G.size * BS / 2 - 14, text: 'HOLLOW! BREAK THE SHELL', t: 0, color: '#ffb35c', size: 18 });
    caption('Giant rock is hollow - board and break the shell for the jackpot!', 'good');
    SM.Audio.contract(); vibrate([40, 40, 80]);
    if (settings().shake) w.shake = Math.max(w.shake, 6);
  }
  function crackGiant(G) {
    G.cracked = true;
    const pay = G.jackpot, xp = D.GIANT.xp * (G.tier + 1);
    w.credits += pay; w.fieldCr += pay; w.giantsCracked++; w.giantCr += pay; w.xp += xp;
    w.pops.push({ x: G.x, y: G.y, text: `GIANT CRACKED +${pay.toLocaleString()}`, t: 0, color: '#ffd76a', size: 22 });
    caption(`Giant rock cracked! +${pay.toLocaleString()} cr jackpot, +${xp} XP`, 'good');
    SM.Audio.boom(); SM.Audio.contract(); vibrate([60, 40, 140]);
    if (settings().shake) w.shake = Math.max(w.shake, 10);
    const n = settings().reducedFx ? 16 : 70;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(60, 320);
      w.particles.push({ x: G.x, y: G.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: rand(0.5, 1.1), color: i % 3 ? '#ffd76a' : M.crust.color, size: rand(2, 5) });
    }
    w.fx.push({ kind: 'ring', x: G.x, y: G.y, r: G.size * BS * 0.8, t: 0, life: 0.6, color: '#ffd76a' });
  }
  // underlay (the cave you've dug) and overlay (outline, hatch marker, progress label)
  function drawGiants(over, vx0, vx1, vy0, vy1) {
    const now = performance.now() / 1000;
    w.giants.forEach(G => {
      const half = G.size * BS / 2;
      if (G.cracked || G.x + half < vx0 || G.x - half > vx1 || G.y + half < vy0 - 30 || G.y - half > vy1) return;
      const x0 = G.gx0 * BS, y0 = G.gy0 * BS, side = G.size * BS;
      if (!over) {
        g.fillStyle = '#140d08'; g.fillRect(x0 + BS, y0 + BS, side - BS * 2, side - BS * 2); // dug-out cavity
        g.fillStyle = 'rgba(255,179,92,0.06)'; g.fillRect(x0 + BS, y0 + BS, side - BS * 2, side - BS * 2);
        return;
      }
      g.save();
      g.strokeStyle = G.open ? `rgba(255,154,60,${0.55 + 0.35 * Math.sin(now * 6)})` : 'rgba(205,170,130,0.55)';
      g.lineWidth = 3; g.setLineDash(G.open ? [] : [10, 6]);
      g.beginPath(); g.roundRect ? g.roundRect(x0 - 4, y0 - 4, side + 8, side + 8, BS * 0.9) : g.rect(x0 - 4, y0 - 4, side + 8, side + 8); g.stroke();
      g.setLineDash([]);
      // hatch: gold frame + arrow pointing in (until it is open)
      if (!G.open) {
        const h = BS / 2 - 1, p = 0.5 + 0.5 * Math.sin(now * 4);
        g.strokeStyle = '#ffd76a'; g.lineWidth = 2.5; g.strokeRect(G.hx - h, G.hy - h, h * 2, h * 2);
        const ax = G.hx + G.nx * (BS * 0.9 + p * 6), ay = G.hy + G.ny * (BS * 0.9 + p * 6), a = Math.atan2(-G.ny, -G.nx);
        g.save(); g.translate(ax, ay); g.rotate(a); g.fillStyle = '#ffd76a';
        g.beginPath(); g.moveTo(8, 0); g.lineTo(-6, -7); g.lineTo(-6, 7); g.closePath(); g.fill(); g.restore();
        g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.7)';
        const tx = G.hx + G.nx * BS * 1.6, ty = G.hy + G.ny * BS * 1.6 + (G.nx ? -12 : 0);
        g.strokeText('EVA IN', tx, ty); g.fillStyle = '#ffd76a'; g.fillText('EVA IN', tx, ty);
      }
      // label
      const label = G.open ? `BREAK THE SHELL  +${G.jackpot.toLocaleString()}` : `GIANT ROCK  hollowed ${G.core - G.coreLeft}/${G.core}`;
      g.font = '800 12px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.strokeText(label, G.x, y0 - 16);
      g.fillStyle = G.open ? '#ffb35c' : '#e8d6bf'; g.fillText(label, G.x, y0 - 16);
      g.restore();
    });
  }

  // ---------- rendering ----------
  function render() {
    if (!w) return;
    const s = w.ship;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // background
    const bg = g.createLinearGradient(0, 0, 0, ch);
    bg.addColorStop(0, w.region.bg[0]); bg.addColorStop(1, w.region.bg[1]);
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
    // parallax stars
    g.fillStyle = '#fff';
    w.stars.forEach(st => {
      const px = ((st.x - w.cam.x * st.z) * scale * 0.6 + cw / 2) % cw, py = ((st.y - w.cam.y * st.z) * scale * 0.6 + ch / 2) % ch;
      g.globalAlpha = 0.25 + st.z * 0.6;
      g.fillRect(px < 0 ? px + cw : px, py < 0 ? py + ch : py, st.s, st.s);
    });
    g.globalAlpha = 1;

    const shx = w.shake ? rand(-w.shake, w.shake) : 0, shy = w.shake ? rand(-w.shake, w.shake) : 0;
    g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (cw / 2 - w.cam.x * scale + shx), dpr * (ch / 2 - w.cam.y * scale + shy));

    const vx0 = w.cam.x - cw / 2 / scale - BS, vx1 = w.cam.x + cw / 2 / scale + BS;
    const vy0 = w.cam.y - ch / 2 / scale - BS, vy1 = w.cam.y + ch / 2 / scale + BS;

    // world border
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2; g.setLineDash([10, 10]);
    g.strokeRect(0, 0, W, H); g.setLineDash([]);

    // dock
    drawDock(w.dock);

    // gravity wells
    w.wells.forEach(wl => {
      if (wl.x + wl.r < vx0 || wl.x - wl.r > vx1 || wl.y + wl.r < vy0 || wl.y - wl.r > vy1) return;
      g.save();
      const gr = g.createRadialGradient(wl.x, wl.y, 0, wl.x, wl.y, wl.r);
      gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(0.12, 'rgba(60,20,110,0.55)'); gr.addColorStop(1, 'rgba(60,20,110,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(wl.x, wl.y, wl.r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(190,140,255,0.35)'; g.lineWidth = 2;
      for (let i = 0; i < 3; i++) { // rings sliding inward
        const k = ((wl.t * 0.35 + i / 3) % 1), rr = wl.r * (1 - k);
        g.globalAlpha = k * 0.8; g.beginPath(); g.arc(wl.x, wl.y, rr, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1; g.strokeStyle = '#d6b8ff'; g.lineWidth = 2;
      for (let i = 0; i < 4; i++) { const a = wl.t * 1.6 + i * Math.PI / 2; g.beginPath(); g.arc(wl.x, wl.y, wl.core + 10, a, a + 0.9); g.stroke(); }
      g.fillStyle = '#000'; g.beginPath(); g.arc(wl.x, wl.y, wl.core, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#ff6b6b'; g.setLineDash([4, 4]); g.beginPath(); g.arc(wl.x, wl.y, wl.core + SHIP_R, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.restore();
    });

    // electrical fields
    w.fields.forEach(f => {
      if (f.x + f.r < vx0 || f.x - f.r > vx1 || f.y + f.r < vy0 || f.y - f.r > vy1) return;
      g.save();
      const blink = f.phase === 1 && Math.floor(f.t * 8) % 2 === 0;
      g.strokeStyle = f.phase === 2 ? '#ffe45c' : f.phase === 1 ? (blink ? '#ffe45c' : '#a08a2a') : 'rgba(255,228,92,0.25)';
      g.lineWidth = f.phase === 2 ? 3 : 2;
      g.setLineDash(f.phase === 0 ? [6, 8] : []);
      g.beginPath(); g.arc(f.x, f.y, f.r, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      if (f.phase === 2) {
        g.fillStyle = 'rgba(255,228,92,0.12)'; g.fill();
        g.strokeStyle = '#fff6b0'; g.lineWidth = 1.5;
        for (let i = 0; i < (settings().reducedFx ? 2 : 5); i++) {
          g.beginPath(); let a = rand(0, Math.PI * 2), r = 0;
          g.moveTo(f.x, f.y);
          while (r < f.r) { r += rand(10, 22); a += rand(-0.5, 0.5); g.lineTo(f.x + Math.cos(a) * Math.min(r, f.r), f.y + Math.sin(a) * Math.min(r, f.r)); }
          g.stroke();
        }
      }
      // hazard icon so it doesn't rely on colour
      g.fillStyle = g.strokeStyle; g.font = 'bold 18px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('⚡', f.x, f.y);
      g.restore();
    });

    // lock range ring
    g.strokeStyle = 'rgba(120,200,255,0.10)'; g.lineWidth = 1;
    g.beginPath(); g.arc(s.x, s.y, w.S.range, 0, Math.PI * 2); g.stroke();

    // blocks (giant rocks get their dug-out cave drawn underneath first)
    drawGiants(false, vx0, vx1, vy0, vy1);
    const hc = settings().highContrast;
    for (const b of w.blocks) {
      if (!b.alive || b.x < vx0 || b.x > vx1 || b.y < vy0 || b.y > vy1) continue;
      drawBlock(b, hc);
    }
    // scanner value tags
    g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const b of w.blocks) {
      if (!b.alive || b.x < vx0 || b.x > vx1 || b.y < vy0 || b.y > vy1) continue;
      if (Math.hypot(b.x - s.x, b.y - s.y) > w.S.scan) continue;
      const v = b.value; if (M[b.mat].value < 12 || !shipCan(b) && b.part !== 'core') continue;
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(b.x - 13, b.y - BS / 2 - 9, 26, 12);
      g.fillStyle = '#ffd76a'; g.fillText(v, b.x, b.y - BS / 2 - 3);
    }

    drawGiants(true, vx0, vx1, vy0, vy1);

    // target reticle + laser
    if (w.target && w.target.alive) {
      const b = w.target, inR = Math.hypot(b.x - s.x, b.y - s.y) <= w.S.range;
      const pulse = 2 + Math.sin(performance.now() / 120) * 2;
      g.strokeStyle = inR ? '#7fe3ff' : '#ff9a3c'; g.lineWidth = 2.5;
      const h = BS / 2 + 4 + pulse, l = 8;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
        g.beginPath(); g.moveTo(b.x + sx * h, b.y + sy * (h - l)); g.lineTo(b.x + sx * h, b.y + sy * h); g.lineTo(b.x + sx * (h - l), b.y + sy * h); g.stroke();
      });
      if (!inR && w.autopilot) {
        g.setLineDash([2, 8]); g.strokeStyle = 'rgba(87,227,154,0.6)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      } else if (!inR) { // dashed guide line telling the player to get closer
        g.setLineDash([4, 6]); g.strokeStyle = 'rgba(255,154,60,0.5)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      }
      if (w.firing) {
        const ex = s.x + Math.cos(s.a) * 10, ey = s.y + Math.sin(s.a) * 10;
        const heatC = w.heat / w.S.heat;
        g.strokeStyle = heatC > 0.75 ? 'rgba(255,120,80,0.35)' : w.look.beam.glow; g.lineWidth = 7;
        g.beginPath(); g.moveTo(ex, ey); g.lineTo(b.x, b.y); g.stroke();
        g.strokeStyle = w.look.beam.core; g.lineWidth = 2;
        g.beginPath(); g.moveTo(ex, ey); g.lineTo(b.x + rand(-2, 2), b.y + rand(-2, 2)); g.stroke();
      }
    }

    // mines
    w.mines.forEach(m => {
      if (!m.alive || m.x < vx0 - 30 || m.x > vx1 + 30 || m.y < vy0 - 30 || m.y > vy1 + 30) return;
      const armed = m.arm >= 0, blink = armed ? Math.floor(m.arm * 12) % 2 === 0 : Math.floor(m.t * 1.5) % 2 === 0;
      g.save(); g.translate(m.x, m.y); g.rotate(m.t * 0.5);
      g.strokeStyle = armed ? '#ff4d4d' : '#a35a5a'; g.lineWidth = 2.5;
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.beginPath(); g.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); g.lineTo(Math.cos(a) * 14, Math.sin(a) * 14); g.stroke(); }
      g.fillStyle = '#3a2626'; g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = blink ? '#ff4d4d' : '#552020'; g.beginPath(); g.arc(0, 0, 3.5, 0, Math.PI * 2); g.fill();
      g.restore();
      if (armed) { g.strokeStyle = 'rgba(255,77,77,0.5)'; g.setLineDash([5, 5]); g.beginPath(); g.arc(m.x, m.y, 95, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
    });
    // scavenger drones
    w.foes.forEach(f => {
      if (!f.alive || f.x < vx0 - 40 || f.x > vx1 + 40 || f.y < vy0 - 40 || f.y > vy1 + 40) return;
      if (f.kind) return drawEventFoe(f);
      g.save(); g.translate(f.x, f.y); g.rotate(f.a);
      g.fillStyle = f.flash > 0 ? '#fff' : M.scav.color; g.strokeStyle = M.scav.edge; g.lineWidth = 2;
      g.beginPath(); g.moveTo(13, 0); g.lineTo(-9, -10); g.lineTo(-4, 0); g.lineTo(-9, 10); g.closePath(); g.fill(); g.stroke();
      if (f.prey && Math.hypot(f.prey.x - f.x, f.prey.y - f.y) < 30) { // chewing
        g.strokeStyle = '#ffd76a'; g.lineWidth = 2; g.beginPath(); g.moveTo(13, 0); g.lineTo(20 + rand(-2, 2), rand(-3, 3)); g.stroke();
      }
      g.restore();
      if (f.hp < f.maxHp) { g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(f.x - 12, f.y - 20, 24, 4); g.fillStyle = M.scav.color; g.fillRect(f.x - 12, f.y - 20, 24 * Math.max(0, f.hp / f.maxHp), 4); }
    });

    // debris
    w.debris.forEach(d => {
      if (d.x < vx0 - 30 || d.x > vx1 + 30 || d.y < vy0 - 30 || d.y > vy1 + 30) return;
      g.save(); g.translate(d.x, d.y); g.rotate(d.rot);
      g.fillStyle = '#4a3a3a'; g.strokeStyle = '#ff6b6b'; g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, r = d.r * (0.75 + ((i * 37) % 10) / 40); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill(); g.stroke();
      g.restore();
      // direction hint
      g.strokeStyle = 'rgba(255,107,107,0.35)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x + d.vx * 0.5, d.y + d.vy * 0.5); g.stroke();
    });

    // weapon projectiles and effects
    w.proj.forEach(p => {
      g.save(); g.translate(p.x, p.y);
      if (p.kind === 'missile') {
        g.rotate(p.a); if (p.small) g.scale(0.6, 0.6); g.fillStyle = p.color; g.fillRect(-7, -2.5, 12, 5);
        g.fillStyle = '#fff'; g.beginPath(); g.moveTo(5, -2.5); g.lineTo(9, 0); g.lineTo(5, 2.5); g.fill();
      } else {
        const blink = Math.floor(p.t * 10) % 2;
        g.fillStyle = blink ? '#ffffff' : p.color; g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); g.fill();
        g.strokeStyle = p.color; g.globalAlpha = 0.35; g.setLineDash([4, 4]);
        g.beginPath(); g.arc(0, 0, p.r, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; // shows the blast zone
      }
      g.restore();
    });
    w.fx.forEach(f => {
      const k = f.t / f.life;
      g.globalAlpha = 1 - k;
      if (f.kind === 'ring') {
        g.strokeStyle = f.color; g.lineWidth = 4 * (1 - k) + 1;
        g.beginPath(); g.arc(f.x, f.y, f.r * (0.4 + 0.6 * k), 0, Math.PI * 2); g.stroke();
      } else if (f.kind === 'tracer') {
        g.strokeStyle = f.color; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(f.x1 + (f.x2 - f.x1) * k * 0.5, f.y1 + (f.y2 - f.y1) * k * 0.5); g.lineTo(f.x2, f.y2); g.stroke();
      } else if (f.kind === 'beam') {
        g.strokeStyle = f.color; g.lineWidth = 10 * (1 - k) + 2;
        g.beginPath(); g.moveTo(f.x1, f.y1); g.lineTo(f.x2, f.y2); g.stroke();
        g.strokeStyle = '#fff'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(f.x1, f.y1); g.lineTo(f.x2, f.y2); g.stroke();
      }
      g.globalAlpha = 1;
    });

    // particles
    w.particles.forEach(p => {
      g.globalAlpha = 1 - p.t / p.life; g.fillStyle = p.color;
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    });
    g.globalAlpha = 1;

    // nebula fog: only a bubble around the ship (or the miner on a spacewalk) is visible
    if (w.region.fog) {
      const fo = w.eva && w.miner ? w.miner : s, R = w.region.fog;
      const fg = g.createRadialGradient(fo.x, fo.y, R * 0.45, fo.x, fo.y, R);
      fg.addColorStop(0, 'rgba(14,6,26,0)'); fg.addColorStop(1, 'rgba(14,6,26,0.96)');
      g.fillStyle = fg; g.fillRect(vx0 - BS, vy0 - BS, vx1 - vx0 + BS * 2, vy1 - vy0 + BS * 2);
    }

    drawShipGear();
    drawWingAndEva();
    drawShip(s);

    // popups
    g.textAlign = 'center'; g.textBaseline = 'middle';
    w.pops.forEach(p => {
      g.globalAlpha = Math.min(1, 1.6 - p.t * 1.3);
      g.font = `800 ${p.size}px system-ui`;
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(p.text, p.x, p.y);
      g.fillStyle = p.color; g.fillText(p.text, p.x, p.y);
    });
    g.globalAlpha = 1;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // solar flare: the sky above burns orange; warning pulses before it hits
    if (w.region.flares) {
      const F = w.region.flares, on = w.flareOn > 0, warn = !on && w.flare <= F.warn;
      if (on || warn) {
        const a = on ? 0.38 : 0.12 + 0.12 * Math.sin(performance.now() / 90);
        const fl = g.createLinearGradient(0, 0, 0, ch);
        fl.addColorStop(0, `rgba(255,150,40,${a})`); fl.addColorStop(1, 'rgba(255,150,40,0)');
        g.fillStyle = fl; g.fillRect(0, 0, cw, ch);
        const safe = shaded(s.x, s.y);
        g.font = 'bold 14px system-ui'; g.textAlign = 'center'; g.textBaseline = 'top';
        g.fillStyle = on ? (safe ? '#57e39a' : '#ff6b6b') : '#ffd76a';
        g.fillText(on ? (safe ? '\u2600 FLARE - shaded by rock' : '\u2600 FLARE - exposed, get under rock') : '\u2600 Flare incoming', cw / 2, 92);
      }
    }
    // off-screen target arrow
    if (w.target && w.target.alive) {
      const sx = (w.target.x - w.cam.x) * scale + cw / 2, sy = (w.target.y - w.cam.y) * scale + ch / 2;
      if (sx < 0 || sx > cw || sy < 0 || sy > ch) {
        const a = Math.atan2(sy - ch / 2, sx - cw / 2);
        const ax = cw / 2 + Math.cos(a) * (Math.min(cw, ch) / 2 - 40), ay = ch / 2 + Math.sin(a) * (Math.min(cw, ch) / 2 - 40);
        g.save(); g.translate(ax, ay); g.rotate(a); g.fillStyle = '#7fe3ff';
        g.beginPath(); g.moveTo(12, 0); g.lineTo(-8, -8); g.lineTo(-8, 8); g.closePath(); g.fill(); g.restore();
      }
    }
    // virtual stick
    if (input.stick) {
      const st = input.stick, op = settings().stickOpacity;
      g.globalAlpha = 0.3 + op * 0.5;
      g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(st.ox, st.oy, 60, 0, Math.PI * 2); g.stroke();
      const dx = st.x - st.ox, dy = st.y - st.oy, d = Math.hypot(dx, dy), m = Math.min(d, 60);
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(st.ox + (d ? dx / d * m : 0), st.oy + (d ? dy / d * m : 0), 24, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
  }

  function drawEventFoe(f) {
    const hpBar = (wid, y, col) => { g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(f.x - wid / 2, f.y + y, wid, 5); g.fillStyle = col; g.fillRect(f.x - wid / 2, f.y + y, wid * Math.max(0, f.hp / f.maxHp), 5); };
    if (f.kind === 'comet') {
      const gr = g.createRadialGradient(f.x, f.y, 2, f.x, f.y, 34);
      gr.addColorStop(0, 'rgba(223,246,255,0.9)'); gr.addColorStop(1, 'rgba(127,214,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(f.x, f.y, 34, 0, Math.PI * 2); g.fill();
      g.save(); g.translate(f.x, f.y); g.rotate(f.a);
      g.fillStyle = f.flash > 0 ? '#fff' : '#dff6ff'; g.strokeStyle = '#8fc3d9'; g.lineWidth = 2;
      g.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, r = f.r * (0.8 + ((i * 53) % 10) / 40); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); g.stroke();
      g.restore();
      hpBar(40, -30, '#7fd6ff');
      g.fillStyle = '#dff6ff'; g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.fillText('COMET +' + f.value, f.x, f.y - 36);
      return;
    }
    // scavenger mothership
    const E = D.EVENTS.kinds.boss;
    if (f.charge > 0) { // pulse warning
      g.strokeStyle = 'rgba(255,61,113,' + (0.4 + 0.4 * Math.sin(performance.now() / 60)) + ')'; g.lineWidth = 3; g.setLineDash([8, 6]);
      g.beginPath(); g.arc(f.x, f.y, E.pulseR * (1 - f.charge / 1.2 * 0.3), 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }
    g.save(); g.translate(f.x, f.y); g.rotate(f.a);
    g.fillStyle = f.flash > 0 ? '#fff' : '#7a1430'; g.strokeStyle = M.scav.color; g.lineWidth = 3;
    g.beginPath(); g.moveTo(34, 0); g.lineTo(6, -22); g.lineTo(-24, -26); g.lineTo(-14, -8); g.lineTo(-30, 0); g.lineTo(-14, 8); g.lineTo(-24, 26); g.lineTo(6, 22); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = M.scav.color; g.beginPath(); g.arc(6, 0, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd76a'; g.beginPath(); g.arc(8, 0, 3, 0, Math.PI * 2); g.fill();
    g.restore();
    hpBar(64, -42, M.scav.color);
    g.fillStyle = '#ffb3c6'; g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.fillText('MOTHERSHIP', f.x, f.y - 48);
  }

  function drawDock(d) {
    g.save(); g.translate(d.x, d.y);
    g.fillStyle = '#1c2840'; g.strokeStyle = '#5b7bb5'; g.lineWidth = 2;
    g.beginPath(); g.roundRect ? g.roundRect(-60, -14, 120, 40, 8) : g.rect(-60, -14, 120, 40); g.fill(); g.stroke();
    g.fillStyle = '#5b7bb5'; g.fillRect(-40, -18, 80, 4);
    g.fillStyle = (Math.floor(performance.now() / 500) % 2) ? '#7fe3ff' : '#2a5a6a';
    g.fillRect(-56, 16, 6, 6); g.fillRect(50, 16, 6, 6);
    g.fillStyle = '#9fb3d9'; g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.fillText('HANGAR', 0, 8);
    g.restore();
  }

  function drawShip(s) {
    if (s.inv > 0 && Math.floor(s.inv * 12) % 2 === 0) return;
    g.save(); g.translate(s.x, s.y); g.rotate(s.a);
    drawHull(g, w.look, { thrust: s.thrust, boosting: w.boosting, flicker: rand(0, 4) });
    g.restore();
  }
  // Colour of a trail at this moment ('rainbow' cycles).
  function trailColor(c) { return c === 'rainbow' ? `hsl(${Math.floor(performance.now() / 8) % 360},90%,65%)` : c; }
  // The ship hull with its cosmetics (SM.Meta.look()), at the origin facing +x. Shared with the hangar preview.
  // o = { thrust 0-1, boosting, flicker } ; upgrade bits (laser emitter, miniguns, armour) come from the save.
  function drawHull(c, look, o) {
    o = o || {};
    const St = SM.State, paint = look.paint.color;
    if (o.thrust > 0.1) {
      c.fillStyle = trailColor(o.boosting ? look.trail.boost : look.trail.color);
      c.beginPath(); c.moveTo(-10, -5); c.lineTo(-10 - o.thrust * (o.boosting ? 18 : 10) - (o.flicker || 0), 0); c.lineTo(-10, 5); c.fill();
    }
    c.fillStyle = paint; c.strokeStyle = '#1a2233'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(15, 0); c.lineTo(-8, -11); c.lineTo(-11, -4); c.lineTo(-11, 4); c.lineTo(-8, 11); c.closePath(); c.fill(); c.stroke();
    if (look.paint.shine) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.beginPath(); c.moveTo(12, -1); c.lineTo(-6, -9); c.lineTo(-7, -6); c.closePath(); c.fill(); }
    drawDecal(c, look.decal.id);
    c.fillStyle = '#4fb8ff'; c.beginPath(); c.ellipse(3, 0, 4.5, 3, 0, 0, Math.PI * 2); c.fill();
    const lv = St.lvl('laser');
    c.fillStyle = lv >= 3 ? '#ff6bd6' : '#7fe3ff'; c.fillRect(11, -1.5, 4 + Math.min(lv, 8), 3); // laser emitter grows with level
    if (St.lvl('minigun') >= 2) { c.fillStyle = '#9aa6b8'; c.fillRect(-2, -10, 11, 2.5); c.fillRect(-2, 7.5, 11, 2.5); } // twin miniguns
    if (St.lvl('hull') >= 3) { c.strokeStyle = '#8a96ad'; c.lineWidth = 2; c.beginPath(); c.moveTo(-6, -9); c.lineTo(4, -5); c.moveTo(-6, 9); c.lineTo(4, 5); c.stroke(); }
  }
  function drawDecal(c, id) {
    c.save();
    if (id === 'stripe') { c.strokeStyle = 'rgba(20,28,45,0.7)'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(-10, 0); c.lineTo(13, 0); c.stroke(); }
    else if (id === 'chevron') { c.strokeStyle = 'rgba(20,28,45,0.75)'; c.lineWidth = 1.6; [-3, -7].forEach(x => { c.beginPath(); c.moveTo(x - 3, -5); c.lineTo(x + 1, 0); c.lineTo(x - 3, 5); c.stroke(); }); }
    else if (id === 'star') { c.fillStyle = '#ffd76a'; [-1, 1].forEach(sy => { c.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 1.2 : 2.8; c.lineTo(-5 + Math.cos(a) * r, sy * 6.5 + Math.sin(a) * r); } c.fill(); }); }
    else if (id === 'hazard') { [-1, 1].forEach(sy => { for (let i = 0; i < 3; i++) { c.fillStyle = i % 2 ? '#1a1a1a' : '#ffcf3f'; c.beginPath(); c.moveTo(-9 + i * 2, sy * 10); c.lineTo(-7 + i * 2, sy * 10); c.lineTo(-5 + i * 2, sy * 6); c.lineTo(-7 + i * 2, sy * 6); c.fill(); } }); }
    else if (id === 'skull') { c.fillStyle = '#f2f2f2'; c.beginPath(); c.arc(-5, 0, 3.2, 0, Math.PI * 2); c.fill(); c.fillStyle = '#1a1a1a'; c.fillRect(-6.3, -1.4, 1.1, 1.1); c.fillRect(-6.3, 0.4, 1.1, 1.1); }
    else if (id === 'crown') { c.fillStyle = '#ffcf3f'; c.beginPath(); c.moveTo(-8, -3.5); c.lineTo(-3, -3.5); c.lineTo(-5, -1.5); c.lineTo(-3, 0); c.lineTo(-5, 1.5); c.lineTo(-3, 3.5); c.lineTo(-8, 3.5); c.closePath(); c.fill(); }
    c.restore();
  }

  function drawGiantCell(b, hc) {
    const h = BS / 2, G = b.giant, m = M[b.mat];
    if (b.part === 'core') { // rich core: its material, a little darker, seen through the cave
      g.fillStyle = b.flash > 0 ? '#ffffff' : m.color; if (b.flash > 0) b.flash -= 0.016;
      g.fillRect(b.x - h + 1, b.y - h + 1, h * 2 - 2, h * 2 - 2);
      g.fillStyle = 'rgba(20,12,6,0.32)'; g.fillRect(b.x - h + 1, b.y - h + 1, h * 2 - 2, h * 2 - 2);
      g.fillStyle = g.strokeStyle = hc ? '#000' : 'rgba(0,0,0,0.45)'; glyph(m.glyph, b.x, b.y, 7);
    } else if (b.part === 'hatch') {
      g.fillStyle = '#0b0705'; g.fillRect(b.x - h, b.y - h, h * 2, h * 2);
      g.fillStyle = 'rgba(255,215,106,0.18)'; g.fillRect(b.x - h + 5, b.y - h + 5, h * 2 - 10, h * 2 - 10);
      return;
    } else { // shell: one solid mass (no gaps between cells) with rivet-like grain
      g.fillStyle = b.flash > 0 ? '#ffffff' : (G.open ? '#8a6c50' : m.color); if (b.flash > 0) b.flash -= 0.016;
      g.fillRect(b.x - h, b.y - h, h * 2, h * 2);
      g.fillStyle = hc ? '#000' : 'rgba(0,0,0,0.22)';
      const r = b.seed;
      for (let i = 0; i < 4; i++) g.fillRect(b.x + Math.cos(r + i * 1.7) * h * 0.6 - 2, b.y + Math.sin(r * 1.3 + i * 2.1) * h * 0.6 - 2, 4, 4);
      if (G.open) { // glowing seams: the shell is weak now
        g.strokeStyle = '#ff9a3c'; g.lineWidth = 1.6; g.beginPath();
        g.moveTo(b.x - h * 0.8, b.y + Math.sin(r) * h * 0.5); g.lineTo(b.x, b.y + Math.cos(r) * h * 0.3); g.lineTo(b.x + h * 0.8, b.y - Math.sin(r) * h * 0.5);
        g.stroke();
      }
    }
    const st = b.state || 0;
    if (st > 0) {
      g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 1.6; g.beginPath();
      for (let i = 0; i < (st === 1 ? 2 : 5); i++) {
        const a = b.seed + i * 2.1;
        g.moveTo(b.x + Math.cos(a) * 3, b.y + Math.sin(a) * 3); g.lineTo(b.x + Math.cos(a - 0.1) * h * 0.9, b.y + Math.sin(a - 0.1) * h * 0.9);
      }
      g.stroke();
    }
  }
  function drawBlock(b, hc) {
    if (b.giant) return drawGiantCell(b, hc);
    const m = M[b.mat], h = BS / 2 - 1;
    g.fillStyle = b.flash > 0 ? '#ffffff' : m.color;
    if (b.flash > 0) b.flash -= 0.016;
    g.fillRect(b.x - h, b.y - h, h * 2, h * 2);
    g.strokeStyle = hc ? '#000' : m.edge; g.lineWidth = hc ? 3 : 2;
    g.strokeRect(b.x - h + 1, b.y - h + 1, h * 2 - 2, h * 2 - 2);
    // material glyph
    g.fillStyle = g.strokeStyle = hc ? '#000' : 'rgba(0,0,0,0.38)';
    glyph(m.glyph, b.x, b.y, 7);
    // damage state cracks
    const st = b.state || 0;
    if (st > 0) {
      g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 1.6;
      const r = b.seed;
      const lines = st === 1 ? 2 : 5;
      g.beginPath();
      for (let i = 0; i < lines; i++) {
        const a = r + i * 2.1, ox = Math.cos(a) * 3, oy = Math.sin(a) * 3;
        g.moveTo(b.x + ox, b.y + oy);
        g.lineTo(b.x + Math.cos(a + 0.4) * h * 0.6, b.y + Math.sin(a + 0.4) * h * 0.6);
        g.lineTo(b.x + Math.cos(a - 0.1) * h * 0.95, b.y + Math.sin(a - 0.1) * h * 0.95);
      }
      g.stroke();
    }
    if (b.tutorial && w.tut >= 0 && w.tut < 3) {
      g.strokeStyle = '#ffd76a'; g.lineWidth = 2; g.setLineDash([4, 4]);
      g.strokeRect(b.x - h - 5, b.y - h - 5, h * 2 + 10, h * 2 + 10); g.setLineDash([]);
    }
  }

  function glyph(type, x, y, r) {
    g.lineWidth = 2;
    switch (type) {
      case 'dot': g.beginPath(); g.arc(x, y, r * 0.4, 0, Math.PI * 2); g.fill(); break;
      case 'bars': g.fillRect(x - r, y - r * 0.6, r * 2, 2.5); g.fillRect(x - r, y + r * 0.4, r * 2, 2.5); break;
      case 'diamond': g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.7, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.7, y); g.closePath(); g.stroke(); break;
      case 'tri': g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y + r * 0.7); g.lineTo(x - r, y + r * 0.7); g.closePath(); g.fill(); break;
      case 'ring': g.beginPath(); g.arc(x, y, r * 0.8, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x, y, r * 0.3, 0, Math.PI * 2); g.fill(); break;
      case 'cross': g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke(); break;
      case 'wave': g.beginPath(); g.moveTo(x - r, y - 2); g.quadraticCurveTo(x - r / 2, y - r, x, y - 2); g.quadraticCurveTo(x + r / 2, y + r * 0.6, x + r, y - 2); g.stroke(); break;
      case 'burst': for (let i = 0; i < 4; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke(); } break;
      case 'hex': g.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85); } g.closePath(); g.stroke(); break;
      case 'plus': g.fillRect(x - r, y - 1.5, r * 2, 3); g.fillRect(x - 1.5, y - r, 3, r * 2); break;
      case 'square': g.strokeRect(x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4); g.fillRect(x - r * 0.25, y - r * 0.25, r * 0.5, r * 0.5); break;
      case 'coin': g.beginPath(); g.arc(x, y, r * 0.75, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x - 1, y - r * 0.5, 2, r); break;
      case 'hash': g.fillRect(x - r, y - r * 0.4 - 1, r * 2, 2); g.fillRect(x - r, y + r * 0.4 - 1, r * 2, 2); g.fillRect(x - r * 0.4 - 1, y - r, 2, r * 2); g.fillRect(x + r * 0.4 - 1, y - r, 2, r * 2); break;
      case 'eye': g.beginPath(); g.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x, y, r * 0.3, 0, Math.PI * 2); g.fill(); break;
      case 'star':
        g.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        g.closePath(); g.fill(); break;
    }
  }

  // ---------- HUD ----------
  function bar(id, frac, warn) {
    const el = $(id);
    el.style.width = Math.max(0, Math.min(100, frac * 100)) + '%';
    el.parentElement.classList.toggle('warn', !!warn);
  }
  function hud() {
    const S = w.S;
    bar('barHull', w.hull / S.hull, w.hull / S.hull < 0.3);
    bar('barFuel', w.fuel / S.fuel, w.fuel / S.fuel < 0.25);
    bar('barEnergy', w.energy / S.energy, false);
    bar('barHeat', w.heat / S.heat, w.overheated);
    bar('barO2', w.o2 / S.evaO2, w.eva && w.o2 < 8);
    $('hudCredits').textContent = w.credits.toLocaleString();
    const t = Math.max(0, Math.ceil(w.time));
    $('hudTime').textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    $('hudTime').classList.toggle('warn', t <= 30);
    const ti = $('targetInfo');
    if (w.target && w.target.alive) {
      const m = M[w.target.mat];
      ti.hidden = false;
      $('tName').textContent = w.target.kind ? D.EVENTS.kinds[w.target.kind].name : m.name;
      $('tValue').textContent = w.target.value + ' cr';
      $('tHp').style.width = (w.target.hp / w.target.maxHp * 100) + '%';
      const dist = Math.hypot(w.target.x - w.ship.x, w.target.y - w.ship.y);
      const secs = w.target.hp * m.res / S.dps;
      $('tHint').textContent = dist > S.range ? (w.autopilot ? 'Autopilot: flying to target' : 'Out of range - fly closer') : (w.overheated ? `Cooling - resumes in ${Math.max(0, (w.heat - S.heat * D.BASE.resumeAt) / S.cool).toFixed(1)}s` : `~${secs.toFixed(1)}s to break` + (m.res >= 2 ? ' - hard material, laser upgrades help' : ''));
    } else ti.hidden = true;
    $('btnBoost').classList.toggle('empty', w.energy < 5);
    if (w.weapon) {
      const def = SM.State.weaponDef(w.weapon), n = w.ammo[w.weapon] || 0;
      $('wpnIcon').textContent = def.icon; $('wpnName').textContent = def.short; $('wpnAmmo').textContent = 'x' + n;
      $('btnWeapon').style.background = `radial-gradient(circle, ${def.color}cc, #111c)`;
      $('btnWeapon').classList.toggle('empty', n <= 0);
      $('btnWeapon').setAttribute('aria-label', `Fire ${def.name}, ${n} left`);
      const full = !needsAmmo(w.weapon);
      $('wpnWrap').style.setProperty('--salv', (Math.min(1, w.salvage / D.SALVAGE_PER_SHOT) * 360) + 'deg');
      const rc = SM.State.reloadCost(w.weapon);
      $('btnReload').innerHTML = full ? 'FULL' : `+1<small>${rc}cr</small>`;
      $('btnReload').classList.toggle('off', full || w.credits + SM.State.get().credits < rc);
      $('btnReload').setAttribute('aria-label', full ? 'Weapon full' : `Buy 1 shot for ${rc} credits`);
    }
  }

  return { init, start, end, pause, isRunning, isPaused, snapshot, applyLayout, drawHull, _debug: () => w, _event: kind => w && startEvent(kind), _advance: () => w && advanceWorld(), _hurt: (b, d, drill) => hurtBlock(b, d, true, drill), _route: (x, y) => planRoute(x, y), _eva: () => toggleEva(), clearBonus };
})();
