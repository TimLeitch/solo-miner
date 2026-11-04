/* Solo Miner - the sortie (in-flight mining) scene. Canvas world + DOM HUD. */
window.SM = window.SM || {};

SM.Sortie = (function () {
  const D = SM.DATA, M = D.MATERIALS;
  const BS = 34;              // block size (world units)
  const W = 1400, H = 2100;   // world size
  const SHIP_R = 13;

  let canvas, g, dpr = 1, cw = 0, ch = 0, scale = 1;
  let running = false, paused = false, raf = 0, lastT = 0;
  let w = null;               // world state for the current run
  let cb = {};                // callbacks {onEnd}
  const input = { stick: null, mine: false, boost: false, keys: {} };
  let hudTimer = 0;

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
      const b = { gx, gy, x: cx, y: cy, mat, maxHp: m.health, hp: m.health * (hpFrac || 1),
        alive: true, seed: Math.random() * 1000, flash: 0 };
      blocks.push(b); grid.set(k, b);
    }
    const centers = [];
    for (let c = 0; c < region.clusters; c++) {
      let cx, cy, tries = 0;
      do {
        cx = rand(160, W - 160); cy = rand(160, H - 420); tries++;
      } while (tries < 40 && centers.some(p => Math.hypot(p.x - cx, p.y - cy) < 260));
      centers.push({ x: cx, y: cy });
      const R = rand(2, 4.3);
      const gcx = Math.round(cx / BS), gcy = Math.round(cy / BS);
      const wob = [rand(0, 6), rand(0.3, 0.9), rand(0, 6), rand(0.2, 0.6)];
      for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) {
        const a = Math.atan2(dy, dx);
        const edge = R * (1 + 0.22 * Math.sin(a * 3 + wob[0]) * wob[1] + 0.15 * Math.sin(a * 5 + wob[2]) * wob[3]);
        const d = Math.hypot(dx, dy);
        if (d <= edge) place(gcx + dx, gcy + dy, pick(d < edge * 0.45 ? region.core : region.shell));
      }
    }
    // a few loose blocks drifting near the dock so the first targets are close
    for (let i = 0; i < 10; i++) {
      const gx = Math.round(rand(dock.x - 360, dock.x + 360) / BS);
      const gy = Math.round(rand(dock.y - 480, dock.y - 170) / BS);
      place(gx, gy, pick(region.shell));
    }
    if (tutorial) { // the README's "one damaged common block"
      const gx = Math.floor(dock.x / BS), gy = Math.floor((dock.y - 200) / BS);
      grid.delete(key(gx, gy));
      for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].gx === gx && blocks[i].gy === gy) blocks.splice(i, 1);
      place(gx, gy + 0, 'rock', 0.45);
      const t = grid.get(key(gx, gy)); if (t) t.tutorial = true;
    }
    // debris
    const debris = [];
    for (let i = 0; i < region.debris.count; i++) debris.push(newDebris(region, dock));
    // electrical fields
    const fields = [];
    for (let i = 0; i < region.fields; i++) {
      fields.push({ x: rand(150, W - 150), y: rand(150, H - 500), r: rand(70, 115), t: rand(0, 6) });
    }
    // relics: small salvage only the miner can pick up on a spacewalk
    const relics = [];
    const tier = D.REGIONS.indexOf(region);
    for (let i = 0, tries = 0; i < D.EVA.relicsPerField && tries < 200; tries++) {
      const c = centers[Math.floor(Math.random() * centers.length)];
      const x = c.x + rand(-200, 200), y = c.y + rand(-200, 200);
      if (x < 40 || y < 40 || x > W - 40 || y > H - 300) continue;
      if (grid.has(key(Math.floor(x / BS), Math.floor(y / BS)))) continue;
      relics.push({ x, y, value: Math.round([60, 140, 240, 380][tier] * rand(0.8, 1.3)), alive: true, t: rand(0, 6) });
      i++;
    }
    // stars
    const stars = [];
    for (let i = 0; i < 260; i++) stars.push({ x: rand(0, W), y: rand(0, H), z: rand(0.2, 1), s: rand(0.5, 1.8) });
    return { blocks, grid, dock, debris, fields, stars, relics };
  }
  function newDebris(region, dock) {
    let x, y;
    do { x = rand(60, W - 60); y = rand(60, H - 300); } while (dock && Math.hypot(x - dock.x, y - dock.y) < 400);
    const a = rand(0, Math.PI * 2), sp = region.debris.speed * rand(0.6, 1.2);
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
    const world = generate(region, st.tutorial);
    w = Object.assign(world, {
      region, S,
      ship: { x: world.dock.x, y: world.dock.y - 30, vx: 0, vy: 0, a: -Math.PI / 2, inv: 0, thrust: 0 },
      hull: Math.min(st.hull, S.hull), hullStart: Math.min(st.hull, S.hull),
      fuel: S.fuel, energy: S.energy, heat: 0, overheated: false,
      time: D.BASE.sortieTime * (S.fuel / D.BASE.fuel), elapsed: 0,
      credits: 0, byMat: {}, broken: 0, xp: 0, damaged: false,
      target: null, firing: false, hitTick: 0,
      particles: [], pops: [], shake: 0,
      cam: { x: world.dock.x, y: world.dock.y - 200 },
      warned: {}, tut: st.tutorial ? 0 : -1, ended: false,
      boosting: false,
      wing: [], eva: false, miner: null, o2: 0, relicCount: 0, relicCredits: 0,
      proj: [], fx: [], ammo: {}, maxAmmo: {}, weapon: null, salvage: 0, ammoRun: 0, ammoWallet: 0, shotsBought: 0, shotsSalvaged: 0,
    });
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
    input.mine = false; input.boost = false; input.stick = null;
    paused = false; running = true;
    document.body.classList.add('in-sortie');
    $('sortie').hidden = false;
    $('pauseMenu').hidden = true;
    $('captions').innerHTML = '';
    $('regionLabel').textContent = region.name;
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
    [['tglFire', 'autoFire'], ['tglBoost', 'autoBoost'], ['tglPilot', 'autopilot']].forEach(([id, k]) => {
      const el = $(id); el.classList.toggle('on', !!s[k]); el.setAttribute('aria-pressed', s[k] ? 'true' : 'false');
      el.querySelector('small').textContent = s[k] ? 'AUTO ON' : 'AUTO OFF';
    });
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
      reason, region: w.region.id, raw: w.credits, credits: Math.floor(w.credits * share), share,
      relicCount: w.relicCount, relicCredits: w.relicCredits,
      ammoRun: w.ammoRun, ammoWallet: w.ammoWallet, shotsBought: w.shotsBought, shotsSalvaged: w.shotsSalvaged,
      byMat: w.byMat, blocks: w.broken, xp: w.xp, damaged: w.damaged, emergency,
      hullEnd: Math.max(0, Math.ceil(w.hull)), hullLost: Math.max(0, Math.round(w.hullStart - w.hull)),
      time: w.elapsed, wasTutorial: w.tut >= 0,
    };
    w = null;
    cb.onEnd && cb.onEnd(result);
  }
  // Snapshot used to bank progress if the app is killed mid-sortie.
  function snapshot() {
    if (!w || w.ended) return null;
    return { region: w.region.id, credits: w.credits, byMat: w.byMat, blocks: w.broken, xp: w.xp,
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
    [['tglFire', 'autoFire', 'Auto-fire'], ['tglBoost', 'autoBoost', 'Auto-boost'], ['tglPilot', 'autopilot', 'Autopilot']].forEach(([id, k, label]) => {
      $(id).addEventListener('click', () => {
        SM.Audio.unlock(); SM.Audio.click();
        const st = settings(); st[k] = !st[k]; SM.State.save(); applyLayout();
        caption(label + (st[k] ? ' on' : ' off'));
      });
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
    let best = null, bd = 34; // forgiving touch radius
    const gx = Math.floor(p.x / BS), gy = Math.floor(p.y / BS);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      const b = w.grid.get(key(gx + dx, gy + dy));
      if (!b || !b.alive) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) {
      w.target = best; SM.Audio.click();
      if (w.tut >= 0 && w.tut <= 1) tutorialStep(2);
    }
  }
  function nearestBlock(maxD) {
    const s = w.ship; let best = null, bd = maxD;
    const r = Math.ceil(maxD / BS), gx = Math.floor(s.x / BS), gy = Math.floor(s.y / BS);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const b = w.grid.get(key(gx + dx, gy + dy));
      if (!b || !b.alive) continue;
      const d = Math.hypot(b.x - s.x, b.y - s.y);
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
    // already have something to shoot? hold still and mine it
    if (w.target && w.target.alive && Math.hypot(w.target.x - s.x, w.target.y - s.y) <= S.range * 0.9) { w.apGoal = w.target; return avoid(0, 0); }
    const near = nearestBlock(S.range * 0.9);
    if (near) { w.target = near; w.apGoal = near; return avoid(0, 0); }
    // pick a goal: the player's chosen target, else the best nearby block (closer and more valuable wins)
    if (!w.apGoal || !w.apGoal.alive) {
      w.apGoal = (w.target && w.target.alive) ? w.target : null;
      if (!w.apGoal) {
        let best = null, bs = Infinity;
        for (const b of w.blocks) {
          if (!b.alive) continue;
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
    const stopAt = S.range * 0.7;
    const m = Math.max(0, Math.min(1, (d - stopAt) / 80));
    // stuck against other blocks? give up on this goal and take whatever is nearest
    if (Math.hypot(s.vx, s.vy) < 12 && m > 0.5) { w.apStuck = (w.apStuck || 0) + dt; if (w.apStuck > 1.2) { w.apGoal = null; w.target = nearestBlock(400); w.apStuck = 0; } }
    else w.apStuck = 0;
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

    // spacewalk: the stick drives the miner, the ship holds position
    if (w.eva) { updateEva(dt, mx, my, mag); mx = 0; my = 0; mag = 0; w.apIdle = 0; }
    else if (w.o2 < S.evaO2) { w.o2 = Math.min(S.evaO2, w.o2 + dt * 2); if (w.o2 >= S.evaO2) applyEvaUi(); } // refills aboard

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
        t: 0, life: 0.35, color: w.boosting ? '#7fd6ff' : '#ffb35c', size: w.boosting ? 3 : 2 });
    }

    // targeting
    if (w.target && !w.target.alive) w.target = null;
    const wantFire = !w.eva && (input.mine || settings().autoFire);
    let inRange = w.target && Math.hypot(w.target.x - s.x, w.target.y - s.y) <= S.range;
    if (wantFire && (!w.target || (!inRange && settings().autoFire)) && settings().aimAssist) {
      const nb = nearestBlock(S.range);
      if (nb && (!w.target || !inRange)) { w.target = nb; inRange = true; }
    }
    // laser + heat
    const canFire = wantFire && w.target && inRange && !w.overheated;
    w.firing = !!canFire;
    if (canFire) {
      const b = w.target, m = M[b.mat];
      b.hp -= S.dps / m.res * dt;
      b.flash = 0.08;
      w.heat += dt;
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
      if (b.hp <= 0) breakBlock(b);
    } else {
      w.heat = Math.max(0, w.heat - S.cool * dt);
      if (w.overheated && w.heat <= S.heat * D.BASE.resumeAt) { w.overheated = false; caption('Laser cooled - mining again', 'good'); }
    }
    if (!w) return; // the sortie may have ended inside updateEva
    SM.Audio.laser(w.firing || !!(w.miner && w.miner.drilling) || w.wing.some(d => d.firing));
    updateWeapons(dt);
    updateWing(dt);

    // debris
    w.debris.forEach(d => {
      d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
      if (d.x < d.r || d.x > W - d.r) d.vx *= -1;
      if (d.y < d.r || d.y > H - d.r) d.vy *= -1;
      const dist = Math.hypot(d.x - s.x, d.y - s.y);
      if (dist < d.r + SHIP_R) {
        const nx = (s.x - d.x) / (dist || 1), ny = (s.y - d.y) / (dist || 1);
        if (s.inv <= 0) { if (!shieldBlock()) damage(w.region.debris.dmg, 'Debris impact'); s.inv = 1; }
        s.vx = nx * 220; s.vy = ny * 220; d.vx = -nx * Math.hypot(d.vx, d.vy); d.vy = -ny * Math.hypot(d.vx, d.vy);
        s.x = d.x + nx * (d.r + SHIP_R + 1); s.y = d.y + ny * (d.r + SHIP_R + 1);
      }
    });
    // electrical fields: 3s dormant, 1.2s warning, 2s active
    w.fields.forEach(f => {
      f.t = (f.t + dt) % 6.2;
      f.phase = f.t < 3 ? 0 : f.t < 4.2 ? 1 : 2;
      if (f.phase === 2 && Math.hypot(f.x - s.x, f.y - s.y) < f.r) damage(11 * dt, null, true);
    });

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
  }

  function collideBlocks(s, R0) {
    const SR = R0 || SHIP_R;
    const gx = Math.floor(s.x / BS), gy = Math.floor(s.y / BS);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const b = w.grid.get(key(gx + dx, gy + dy));
      if (!b || !b.alive) continue;
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
      w.warned.zap = w.elapsed; SM.Audio.damage(); vibrate(40); caption('Electrical field - taking damage', 'danger');
    }
  }

  // ---------- escort wing ----------
  function updateWing(dt) {
    const s = w.ship, S = w.S, claimed = new Set();
    w.wing.forEach(d => { if (d.target && d.target.alive) claimed.add(d.target); });
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
      if (d.target && (!d.target.alive || Math.hypot(d.target.x - s.x, d.target.y - s.y) > DS.reach + 30)) { claimed.delete(d.target); d.target = null; }
      if (!d.target) { // nearest unclaimed block within reach of the ship
        let best = null, bd = DS.reach;
        for (const b of w.blocks) {
          if (!b.alive || claimed.has(b)) continue;
          const dd = Math.hypot(b.x - s.x, b.y - s.y);
          if (dd < bd) { bd = dd; best = b; }
        }
        if (best) { d.target = best; claimed.add(best); }
      }
      // where to fly: next to the target, or a slow orbit around the ship
      let gx, gy;
      if (d.target) {
        const a = Math.atan2(d.y - d.target.y, d.x - d.target.x);
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
        if (!t.alive) d.target = null;
      } else d.heat = Math.max(0, d.heat - dt);
    });
  }

  function collectRelic(r, label) {
    r.alive = false; w.relicCount++; w.relicCredits += r.value; w.credits += r.value; w.xp += 10;
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
      if (i >= 0) {
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
      d.relic = w.relics.find(r => r.alive && Math.hypot(r.x - s.x, r.y - s.y) < d.st.reach * 1.5 && !w.wing.some(o => o.relic === r)) || null;
    }
  }
  // Shield projectors: returns true if a shield absorbed the hit.
  function shieldBlock() {
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
    if (w.o2 < 8 && !w.warned.o2) { w.warned.o2 = 1; SM.Audio.alarm(); caption('Oxygen low - head back to the ship', 'warn'); }
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
    if (!m.reel) collideBlocks(m, 6);
    // hand drill: short range, ignores resistance
    m.drilling = false;
    if (!m.reel && (input.mine || settings().autoFire)) {
      if (!m.target || !m.target.alive || Math.hypot(m.target.x - m.x, m.target.y - m.y) > D.EVA.drillRange + BS / 2) {
        m.target = null; let bd = D.EVA.drillRange + BS / 2;
        const gx = Math.floor(m.x / BS), gy = Math.floor(m.y / BS);
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
          const b = w.grid.get(key(gx + dx, gy + dy)); if (!b || !b.alive) continue;
          const d = Math.hypot(b.x - m.x, b.y - m.y); if (d < bd) { bd = d; m.target = b; }
        }
      }
      if (m.target) {
        m.drilling = true;
        const t = m.target;
        hurtBlock(t, S.drillDps * M[t.mat].res * dt, true); // x res cancels resistance
        if (Math.random() < 0.3 && !settings().reducedFx) w.particles.push({ x: t.x + rand(-5, 5), y: t.y + rand(-5, 5), vx: rand(-50, 50), vy: rand(-50, 50), t: 0, life: 0.3, color: '#ffd76a', size: 2 });
        if (!t.alive) m.target = null;
      }
    }
    // relics
    w.relics.forEach(r => { if (r.alive && Math.hypot(r.x - m.x, r.y - m.y) < 18) collectRelic(r, 'Relic recovered'); });
    // hazards hit the suit (oxygen), not the hull
    w.debris.forEach(d => {
      const dist = Math.hypot(d.x - m.x, d.y - m.y);
      if (dist < d.r + 7 && !(m.inv > 0)) {
        w.o2 = Math.max(0, w.o2 - D.EVA.debrisO2); m.inv = 1; SM.Audio.damage(); vibrate(60);
        caption(`Debris hit your suit -${D.EVA.debrisO2}s oxygen`, 'danger');
        m.vx = (m.x - d.x) / (dist || 1) * 200; m.vy = (m.y - d.y) / (dist || 1) * 200;
      }
    });
    if (m.inv > 0) m.inv -= dt;
    w.fields.forEach(f => { if (f.phase === 2 && Math.hypot(f.x - m.x, f.y - m.y) < f.r) w.o2 = Math.max(0, w.o2 - 4 * dt); });
  }

  // draw helpers for the wing, the miner and relics
  function drawWingAndEva() {
    const paint = (D.PAINTS.find(p => p.id === SM.State.get().paint) || D.PAINTS[0]).color;
    const now = performance.now() / 1000;
    // relics
    w.relics.forEach(r => {
      if (!r.alive) return;
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
    // escort drones
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
    if (!(w.ammo[id] > 0)) { SM.Audio.deny(); caption(def.name + ' out of ammo - restocks next sortie', 'warn'); return; }
    if (w.wcd > 0) return;
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
      w.fx.push({ kind: 'ring', x: s.x, y: s.y, r: ws.radius, t: 0, life: 0.5, color: def.color });
    }
    hud();
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
    const cost = def.reload;
    if (w.credits + st.credits < cost) { SM.Audio.deny(); caption(`Need ${cost} cr to reload`, 'warn'); return; }
    const fromRun = Math.min(w.credits, cost), fromWallet = cost - fromRun;
    w.credits -= fromRun; st.credits -= fromWallet;
    w.ammoRun += fromRun; w.ammoWallet += fromWallet; w.shotsBought++;
    if (fromWallet) SM.State.save();
    w.ammo[id]++;
    SM.Audio.buy();
    caption(`Bought 1 ${def.name} shot -${cost} cr`);
    hud();
  }

  // weapon damage goes through block resistance just like the laser
  function hurtBlock(b, dmg, quiet) {
    if (!b.alive) return;
    const m = M[b.mat];
    b.hp -= dmg / m.res; b.flash = 0.12;
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
      const boom = (p.kind === 'missile' && (b || p.t > 3)) || (p.kind === 'grenade' && (p.t >= p.fuse || (b && p.t > 0.15)));
      if (boom || out) { if (!out) explode(p.x, p.y, p.r, p.dmg, p.color); return false; }
      return true;
    });
    w.fx = w.fx.filter(f => (f.t += dt) < f.life);
  }
  function nearestBlockTo(x, y, maxD) {
    let best = null, bd = maxD;
    for (const b of w.blocks) { if (!b.alive) continue; const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
    return best;
  }

  function breakBlock(b) {
    b.alive = false; w.grid.delete(key(b.gx, b.gy));
    const m = M[b.mat];
    w.credits += m.value; w.broken++; w.xp += m.xp;
    w.byMat[b.mat] = (w.byMat[b.mat] || 0) + 1;
    addSalvage(m.xp);
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
    w.pops.push({ x: b.x, y: b.y - 6, text: '+' + m.value, t: 0, color: '#ffd76a', size: m.value >= 50 ? 18 : 14 });
    if (w.target === b) {
      w.target = settings().aimAssist ? nearestBlock(w.S.range) : null;
    }
    if (w.tut >= 0 && w.tut <= 2) tutorialStep(3);
    else if (w.tut === 3 && w.broken >= 3) tutorialStep(4);
    if (cb.onBreak) cb.onBreak();
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

    // blocks
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
      const v = M[b.mat].value; if (v < 12) continue;
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(b.x - 13, b.y - BS / 2 - 9, 26, 12);
      g.fillStyle = '#ffd76a'; g.fillText(v, b.x, b.y - BS / 2 - 3);
    }

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
        g.strokeStyle = heatC > 0.75 ? 'rgba(255,120,80,0.35)' : 'rgba(120,230,255,0.35)'; g.lineWidth = 7;
        g.beginPath(); g.moveTo(ex, ey); g.lineTo(b.x, b.y); g.stroke();
        g.strokeStyle = '#fff'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(ex, ey); g.lineTo(b.x + rand(-2, 2), b.y + rand(-2, 2)); g.stroke();
      }
    }

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

    // off-screen target arrow
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    const paint = (D.PAINTS.find(p => p.id === SM.State.get().paint) || D.PAINTS[0]).color;
    g.save(); g.translate(s.x, s.y); g.rotate(s.a);
    if (s.thrust > 0.1) {
      g.fillStyle = w.boosting ? '#7fd6ff' : '#ffb35c';
      g.beginPath(); g.moveTo(-10, -5); g.lineTo(-10 - s.thrust * (w.boosting ? 18 : 10) - rand(0, 4), 0); g.lineTo(-10, 5); g.fill();
    }
    g.fillStyle = paint; g.strokeStyle = '#1a2233'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(15, 0); g.lineTo(-8, -11); g.lineTo(-11, -4); g.lineTo(-11, 4); g.lineTo(-8, 11); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#4fb8ff'; g.beginPath(); g.ellipse(3, 0, 4.5, 3, 0, 0, Math.PI * 2); g.fill();
    const lv = SM.State.lvl('laser');
    g.fillStyle = lv >= 3 ? '#ff6bd6' : '#7fe3ff'; g.fillRect(11, -1.5, 4 + lv, 3); // laser emitter grows with level
    if (SM.State.lvl('hull') >= 3) { g.strokeStyle = '#8a96ad'; g.lineWidth = 2; g.beginPath(); g.moveTo(-6, -9); g.lineTo(4, -5); g.moveTo(-6, 9); g.lineTo(4, 5); g.stroke(); }
    g.restore();
  }

  function drawBlock(b, hc) {
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
      $('tName').textContent = m.name;
      $('tValue').textContent = m.value + ' cr';
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
      $('btnReload').innerHTML = full ? 'FULL' : `+1<small>${def.reload}cr</small>`;
      $('btnReload').classList.toggle('off', full || w.credits + SM.State.get().credits < def.reload);
      $('btnReload').setAttribute('aria-label', full ? 'Weapon full' : `Buy 1 shot for ${def.reload} credits`);
    }
  }

  return { init, start, end, pause, isRunning, isPaused, snapshot, applyLayout, _debug: () => w };
})();
