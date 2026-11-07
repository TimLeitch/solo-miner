const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function game(seed) {
  let randomState = seed, frame, time = 0;
  const math = Object.create(Math);
  math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  const ctx = new Proxy({}, { get: (obj, key) => {
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return obj[key] || (() => {});
  } });
  function element() {
    const el = {
      style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, addEventListener() {}, appendChild() {}, remove() {},
      querySelector() { return element(); }, getContext() { return ctx; },
      children: [], parentElement: { classList: { toggle() {} } },
    };
    return el;
  }
  const els = new Map();
  const document = { body: element(), getElementById(id) {
    if (!els.has(id)) els.set(id, element());
    return els.get(id);
  }, createElement: element };
  const sandbox = { document, navigator: {}, localStorage: { getItem() { return null; }, setItem() {} },
    performance: { now: () => time }, Math: math, console, setTimeout() {},
    requestAnimationFrame(fn) { frame = fn; return 1; }, cancelAnimationFrame() {},
    innerWidth: 390, innerHeight: 844, addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['data', 'state', 'sortie']) vm.runInContext(fs.readFileSync(`js/${file}.js`, 'utf8'), sandbox);
  sandbox.SM.Audio = new Proxy({}, { get: () => () => {} });
  sandbox.SM.State.load();
  sandbox.SM.State.get().settings.autoEva = false; // off by default here so other tests see the ship alone; auto EVA has its own tests
  sandbox.SM.Sortie.init();
  return {
    SM: sandbox.SM,
    advance(seconds) {
      for (let i = 0; i < seconds * 20 && sandbox.SM.Sortie.isRunning(); i++) {
        time += 50;
        frame(time);
      }
    },
  };
}

test('fresh fields have large, varied deposits and a safe dock', () => {
  const { SM } = game(42);
  SM.State.get().tutorial = false;
  for (const region of SM.DATA.REGIONS) {
    SM.Sortie.start(region.id);
    const first = SM.Sortie._debug();
    assert.ok(first.blocks.length > 500, `${region.id}: ${first.blocks.length} blocks`);
    assert.equal(first.grid.size, first.blocks.length);
    assert.equal(first.relics.length, SM.DATA.EVA.relicsPerField);
    assert.ok(first.blocks.every(b => b.x > 0 && b.x < 1400 && b.y > 0 && b.y < 2100 &&
      Math.hypot(b.x - first.dock.x, b.y - first.dock.y) >= 150));
    const layout = first.blocks.map(b => `${b.gx},${b.gy},${b.mat}`).join('|');
    SM.Sortie.start(region.id);
    assert.notEqual(SM.Sortie._debug().blocks.map(b => `${b.gx},${b.gy},${b.mat}`).join('|'), layout);
  }
});

test('tutorial still creates a damaged common block', () => {
  const { SM } = game(10);
  SM.Sortie.start('nearside');
  const starter = SM.Sortie._debug().blocks.find(b => b.tutorial);
  assert.ok(starter);
  assert.equal(starter.mat, 'rock');
  assert.equal(starter.hp, starter.maxHp * 0.45);
});

test('laser upgrades make actual Nearside mining faster and more profitable', () => {
  function run(level, seed) {
    const { SM, advance } = game(seed);
    const state = SM.State.get();
    state.tutorial = false;
    state.levels.laser = level;
    SM.Sortie.start('nearside');
    const world = SM.Sortie._debug();
    world.debris = [];
    advance(75);
    return { blocks: world.broken, credits: world.credits, threat: SM.State.threat(), dps: world.S.dps };
  }
  let lowBlocks = 0, highBlocks = 0, lowCredits = 0, highCredits = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const low = run(1, seed), high = run(15, seed);
    assert.ok(high.threat.hp / high.dps < low.threat.hp / low.dps * 0.45);
    lowBlocks += low.blocks; highBlocks += high.blocks;
    lowCredits += low.credits; highCredits += high.credits;
  }
  assert.ok(highBlocks > lowBlocks * 1.5, `${lowBlocks} -> ${highBlocks} blocks`);
  assert.ok(highCredits > lowCredits * 3, `${lowCredits} -> ${highCredits} credits`);
});

test('ranks extend past 10 with existing XP and progress at each threshold', () => {
  const { SM } = game(5);
  const state = SM.State.get();
  for (let r = 1; r <= 100; r++) {
    const xp = SM.State.rankXp(r);
    state.xp = xp;
    assert.equal(SM.State.rank(), r);
    assert.equal(SM.State.rank(xp), r);
    assert.equal(SM.State.rankProgress(), 0);
    if (r > 1) assert.equal(SM.State.rank(xp - 1), r - 1);
    state.xp = xp + (SM.State.rankXp(r + 1) - xp) / 2;
    assert.equal(SM.State.rankProgress(), 0.5);
  }
  assert.equal(SM.State.rankXp(10), 4000);
  assert.equal(SM.State.rankXp(11), 5200);
  assert.equal(SM.State.rankXp(12), 6700);
  SM.State.replace({ xp: 6700 });
  assert.equal(SM.State.rank(), 12);
});

test('rank strengthens laser and drill, stacks with upgrades and applies on launch', () => {
  const { SM } = game(8);
  const state = SM.State.get();
  state.tutorial = false;
  state.levels.laser = 5;
  state.levels.drill = 3;
  const base = SM.State.stats();
  SM.Sortie.start('nearside');
  state.xp = SM.State.rankXp(11);
  assert.equal(SM.Sortie._debug().S.dps, base.dps);
  const stronger = SM.State.stats();
  assert.ok(Math.abs(stronger.dps / base.dps - 1.5) < 1e-10);
  assert.ok(Math.abs(stronger.drillDps / base.drillDps - 1.5) < 1e-10);
  assert.ok(SM.State.threat().level > 1);
  SM.Sortie.start('nearside');
  assert.equal(SM.Sortie._debug().S.dps, stronger.dps);
});

test('higher rank improves mining speed and earnings in a sortie', () => {
  function run(rank) {
    const { SM, advance } = game(17);
    SM.State.get().tutorial = false;
    SM.State.get().xp = SM.State.rankXp(rank);
    SM.Sortie.start('nearside');
    const world = SM.Sortie._debug();
    world.debris = [];
    advance(75);
    return world;
  }
  const low = run(1), high = run(30);
  assert.ok(high.broken > low.broken, `${low.broken} -> ${high.broken} blocks`);
  assert.ok(high.credits > low.credits, `${low.credits} -> ${high.credits} credits`);
});

test('clearing every block before the timer advances to the next unlocked world', () => {
  const { SM, advance } = game(7);
  const st = SM.State.get();
  st.tutorial = false;
  st.unlocked = ['nearside', 'redshard'];
  let ended = null;
  SM.Sortie.start('nearside', { onEnd: r => { ended = r; } });
  const w = SM.Sortie._debug();
  assert.equal(w.left, w.blocks.filter(b => !b.giant).length, 'giant rock cells do not count until the shell opens');
  const timeBefore = w.time;
  w.fieldCr = 1000;
  w.left = 0; // pretend the last block just broke
  advance(0.1);
  assert.equal(SM.Sortie.isRunning(), true, 'sortie keeps going');
  assert.equal(w.region.id, 'redshard');
  assert.equal(w.cleared, 1);
  assert.equal(w.left, w.blocks.filter(b => !b.giant).length);
  assert.ok(w.blocks.length > 500 && w.blocks.every(b => b.alive));
  assert.ok(w.time > timeBefore + SM.DATA.CLEAR.time - 1, 'remaining time carries over plus clear bonus time');
  const expected = SM.Sortie.clearBonus(1000, timeBefore - 0.1, 1, SM.DATA.REGIONS[0], SM.State.threat().value);
  assert.ok(Math.abs(w.clearBonus - expected) <= 2, `bonus ${w.clearBonus} ~ ${expected}`);
  assert.ok(w.clearBonus > 1000, 'clearing pays more than the field itself');
  assert.equal(w.fieldCr, 0);
  assert.equal(st.region, 'redshard', 'hangar selection follows');
  // no further unlocked world: a fresh field of the same region
  w.left = 0;
  advance(0.1);
  assert.equal(w.region.id, 'redshard');
  assert.equal(w.cleared, 2);
  SM.Sortie.end('return');
  assert.equal(ended.region, 'nearside', 'contracts still score against the launch field');
  assert.equal(ended.endRegion, 'redshard');
  assert.equal(ended.cleared, 2);
  assert.ok(ended.credits >= w.clearBonus);
});

test('clear bonus grows with time left and with a streak of clears', () => {
  const { SM } = game(3);
  const r = SM.DATA.REGIONS[0];
  const a = SM.Sortie.clearBonus(5000, 0, 1, r, 1);
  const b = SM.Sortie.clearBonus(5000, 60, 1, r, 1);
  const c = SM.Sortie.clearBonus(5000, 60, 2, r, 1);
  assert.ok(a >= 5000 && b > a && c > b, `${a} ${b} ${c}`);
});

test('an emergency return never cuts the clear bonus', () => {
  const { SM, advance } = game(5);
  SM.State.get().tutorial = false;
  let res = null;
  SM.Sortie.start('nearside', { onEnd: r => { res = r; } });
  const w = SM.Sortie._debug();
  w.fieldCr = 2000; w.credits = 2000; w.left = 0;
  advance(0.1);
  const bonus = w.clearBonus;
  w.hull = 0;
  advance(0.1);
  assert.equal(res.reason, 'hull');
  assert.equal(res.credits, Math.floor(2000 * res.share) + bonus);
});

test('breaking blocks counts down the field', () => {
  const { SM, advance } = game(11);
  SM.State.get().tutorial = false;
  SM.State.get().settings.autoFire = true;
  SM.State.get().settings.autopilot = true;
  SM.Sortie.start('nearside', {});
  const w = SM.Sortie._debug();
  advance(30);
  assert.ok(w.broken > 0);
  assert.equal(w.left, w.blocks.filter(b => b.alive && (!b.giant || b.counted)).length);
});

test('every field plays for a minute on autopilot without errors and has its own features', () => {
  const { SM } = game(11);
  const ids = SM.DATA.REGIONS.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (let i = 1; i < SM.DATA.REGIONS.length; i++) {
    assert.ok(SM.DATA.REGIONS[i].lifetime > SM.DATA.REGIONS[i - 1].lifetime, 'unlock order');
  }
  for (const region of SM.DATA.REGIONS) {
    const g2 = game(100 + ids.indexOf(region.id));
    const st = g2.SM.State.get();
    st.tutorial = false; st.levels.laser = 12; st.levels.hull = 12;
    g2.SM.Sortie.start(region.id);
    const w = g2.SM.Sortie._debug();
    assert.equal(w.wells.length, region.wells || 0, `${region.id} wells`);
    assert.equal(w.foes.length, region.scavs || 0, `${region.id} scavengers`);
    if (region.mines) assert.ok(w.mines.length >= region.mines - 2, `${region.id} mines ${w.mines.length}`);
    g2.advance(70); // Corona Shelf is slow on purpose: a lone alloy block can take ~60 s at this laser
    assert.ok(w.broken > 0, `${region.id}: mined something (${w.broken})`);
  }
});

test('scavengers eat blocks and count down the field, and pay a bounty when shot', () => {
  const { SM, advance } = game(21);
  const st = SM.State.get(); st.tutorial = false; st.settings.autoFire = false; st.settings.autopilot = false;
  SM.Sortie.start('scrapyard');
  const w = SM.Sortie._debug();
  w.debris = [];
  const left = w.left;
  advance(20);
  assert.ok(w.left < left, `scavengers ate ${left - w.left} blocks`);
  const f = w.foes.find(x => x.alive);
  const before = w.credits;
  f.x = w.ship.x + 40; f.y = w.ship.y; f.wait = 99;
  st.settings.autoFire = true;
  advance(10);
  assert.equal(f.alive, false, 'the laser prefers scavengers in range');
  assert.ok(w.credits >= before + f.value);
});

test('volatile ore chain-explodes, ice refuels, coral regrows', () => {
  const { SM, advance } = game(5);
  const st = SM.State.get(); st.tutorial = false; st.settings.autoFire = false; st.settings.autopilot = false;
  SM.Sortie.start('ember');
  let w = SM.Sortie._debug();
  w.debris = []; w.flare = 999;
  const vol = w.blocks.filter(b => b.mat === 'volatile' && b.alive);
  const brokenBefore = w.broken;
  vol[0].hp = 0.01; w.target = vol[0]; w.ship.x = vol[0].x; w.ship.y = vol[0].y + 150; st.settings.autoFire = true;
  advance(1.5); st.settings.autoFire = false;
  assert.ok(w.broken > brokenBefore + 1, `blast broke ${w.broken - brokenBefore} blocks`);

  SM.Sortie.start('comet');
  w = SM.Sortie._debug(); w.debris = [];
  w.fuel = w.S.fuel * 0.5;
  const ice = w.blocks.find(b => b.mat === 'ice');
  ice.hp = 0.01; w.target = ice; w.ship.x = ice.x; w.ship.y = ice.y + 60; st.settings.autoFire = true;
  advance(0.3);
  assert.equal(ice.alive, false);
  assert.ok(w.fuel > w.S.fuel * 0.5, 'ice refuelled the ship');
  st.settings.autoFire = false;

  SM.Sortie.start('reef');
  w = SM.Sortie._debug(); w.debris = []; w.foes = [];
  const coral = w.blocks.find(b => b.mat === 'coral');
  coral.hp = coral.maxHp * 0.3; coral.hitAt = w.elapsed;
  advance(5);
  assert.ok(coral.hp > coral.maxHp * 0.6, 'coral grew back');
});

test('every field but the tutorial has a giant hollow rock, sealed until the core is drilled out', () => {
  const { SM } = game(9);
  SM.State.get().tutorial = false;
  for (const region of SM.DATA.REGIONS) {
    SM.Sortie.start(region.id);
    const w = SM.Sortie._debug();
    assert.equal(w.giants.length, SM.DATA.giantCount(region), `${region.id} giants`);
    w.giants.forEach(G => {
      assert.ok(G.core >= 16 && G.shellLeft >= 16, `${region.id}: ${G.core} core, ${G.shellLeft} shell`);
      assert.equal(G.cells.filter(c => c.part === 'hatch').length, 1, 'one hatch');
      G.cells.forEach(c => assert.equal(w.grid.get(c.gx * 100000 + c.gy), c, 'cells are solid'));
      assert.ok(Math.hypot(G.x - w.dock.x, G.y - w.dock.y) > 500, 'away from the dock');
    });
    assert.equal(w.grid.size, w.blocks.length);
    SM.Sortie.end('abort');
  }
  SM.State.get().tutorial = true;
  SM.Sortie.start('nearside');
  assert.equal(SM.Sortie._debug().giants.length, 0, 'no giant in the tutorial');
});

test('giant rock: ship cannot hurt it, the drill hollows it, then the ship breaks the shell for a jackpot', () => {
  const { SM, advance } = game(13);
  const st = SM.State.get(); st.tutorial = false; st.settings.autoFire = false; st.settings.autopilot = false;
  let res = null;
  SM.Sortie.start('nearside', { onEnd: r => { res = r; } });
  const w = SM.Sortie._debug();
  w.debris = [];
  const G = w.giants[0], shell = G.cells.filter(c => c.part !== 'core'), core = G.cells.filter(c => c.part === 'core');
  // ship weapons and lasers bounce off the closed shell, and can't reach the core either
  shell.concat(core).forEach(c => SM.Sortie._hurt(c, 9999, false));
  assert.ok(G.cells.every(c => c.alive), 'ship damage does nothing to a sealed giant');
  // and the hand drill can't cut the closed shell from outside
  shell.forEach(c => SM.Sortie._hurt(c, 9999, true));
  assert.ok(shell.every(c => c.alive && c.hp === c.maxHp), 'drill cannot cut the closed shell');
  // drill out the core: each cell pays, and the shell opens
  const left = w.left, credits = w.credits;
  core.forEach(c => SM.Sortie._hurt(c, 9999, true));
  assert.ok(core.every(c => !c.alive) && G.open, 'hollow -> open');
  assert.equal(w.left, left + shell.length, 'the open shell now counts toward clearing the field');
  assert.ok(w.credits > credits, 'core cells pay out');
  assert.ok(shell.every(c => c.part === 'shell'), 'hatch becomes ordinary shell');
  // the ship's laser now breaks the shell
  const before = w.credits;
  shell.slice(1).forEach(c => SM.Sortie._hurt(c, 9999, false));
  assert.equal(G.cracked, false);
  const lastCell = shell[0];
  // the real laser finishes the last cell (the rest of the shell is gone, so the ship sits where it was)
  w.target = lastCell; w.ship.x = lastCell.x; w.ship.y = lastCell.y; st.settings.autoFire = true;
  advance(15);
  assert.equal(lastCell.alive, false, 'laser broke the last shell cell');
  assert.ok(G.cracked, 'giant cracked');
  assert.ok(w.credits >= before + G.jackpot, 'jackpot paid');
  SM.Sortie.end('return');
  assert.equal(res.giants, 1);
  assert.equal(res.giantCr, G.jackpot);
});

test('giant rock: the miner walks in through the hatch and drills the core; the ship cannot enter', () => {
  const { SM, advance } = game(17);
  const st = SM.State.get(); st.tutorial = false; st.settings.autoFire = false; st.settings.autopilot = false;
  st.levels.o2 = 20; // plenty of air for the test
  SM.Sortie.start('nearside');
  const w = SM.Sortie._debug();
  w.debris = []; w.fields = [];
  const G = w.giants[0], BS = 34;
  // park outside the hatch and try to fly in
  w.ship.x = G.hx + G.nx * BS * 2; w.ship.y = G.hy + G.ny * BS * 2;
  for (let i = 0; i < 40; i++) { w.ship.vx = -G.nx * 300; w.ship.vy = -G.ny * 300; advance(0.05); }
  const depth = (w.ship.x - G.hx) * G.nx + (w.ship.y - G.hy) * G.ny;
  assert.ok(depth > BS / 2, `ship stays outside the hatch (${depth.toFixed(0)})`);
  // go EVA and walk the miner straight in, drilling as it goes
  w.o2 = w.S.evaO2;
  w.eva = true; // same as tapping EVA, with the miner placed just outside the hatch
  w.miner = { x: G.hx + G.nx * BS, y: G.hy + G.ny * BS, vx: 0, vy: 0, a: 0, drilling: false, target: null, reel: false, inv: 0 };
  st.settings.autoFire = true;
  const core0 = G.coreLeft;
  for (let i = 0; i < 300 && G.coreLeft > 0; i++) {
    // steer toward the nearest core cell still standing
    const c = G.cells.filter(x => x.part === 'core' && x.alive).sort((a, b) => Math.hypot(a.x - w.miner.x, a.y - w.miner.y) - Math.hypot(b.x - w.miner.x, b.y - w.miner.y))[0];
    if (!c) break;
    const dx = c.x - w.miner.x, dy = c.y - w.miner.y, d = Math.hypot(dx, dy) || 1;
    w.miner.vx = dx / d * 60; w.miner.vy = dy / d * 60;
    advance(0.5);
    w.o2 = w.S.evaO2;
  }
  assert.ok(G.coreLeft < core0, `miner drilled ${core0 - G.coreLeft} core cells`);
  assert.ok(Math.abs(w.miner.x - G.x) < G.size * BS / 2 && Math.abs(w.miner.y - G.y) < G.size * BS / 2, 'miner is inside the giant');
});

test('wide drill head cuts neighbouring cells', () => {
  const { SM } = game(19);
  const st = SM.State.get();
  assert.equal(SM.State.stats().drillSplash, 0);
  st.levels.bit = 3;
  assert.equal(SM.State.stats().drillSplash, 0.5);
  st.levels.bit = 30;
  assert.equal(SM.State.stats().drillSplash, 1, 'capped at 100%');
});

// ---------- ship weapons & systems (DATA.SHIP_GEAR) ----------
function gearGame(seed, levels) {
  const g = game(seed);
  const st = g.SM.State.get();
  st.tutorial = false; st.settings.autoFire = false; st.settings.autopilot = false;
  Object.assign(st.levels, levels);
  g.SM.Sortie.start('nearside');
  const w = g.SM.Sortie._debug();
  w.debris = [];
  return Object.assign(g, { st, w });
}
// a normal block with all 4 neighbours standing, and the ship parked in range of it
function aimAtCluster(w) {
  const at = (x, y) => w.grid.get(x * 100000 + y);
  const b = w.blocks.find(c => c.alive && !c.giant && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => { const n = at(c.gx + dx, c.gy + dy); return n && n.alive && !n.giant; }));
  const nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => at(b.gx + dx, b.gy + dy));
  nbs.concat(b).forEach(c => { c.hp = c.maxHp = 1e6; });
  w.target = b; w.ship.x = b.x; w.ship.y = b.y; // collision pushes the ship out next to it
  return { b, nbs };
}

test('ship gear: nothing is fitted at level 1, and fitted gear raises Threat', () => {
  const { SM } = game(31);
  const st = SM.State.get();
  const S = SM.State.stats(), t0 = SM.State.threat().power;
  ['wideBeam', 'splitBeam', 'gunDps', 'sentries', 'sentryDps', 'pdCd', 'deflectCd'].forEach(k => assert.equal(S[k], 0, k));
  Object.assign(st.levels, { wide: 3, split: 3, minigun: 3, sentry: 3, pd: 3, deflector: 3 });
  const S2 = SM.State.stats();
  assert.equal(S2.wideBeam, 0.5); assert.equal(S2.splitBeam, 0.5); assert.equal(S2.sentries, 2);
  assert.ok(S2.gunDps > SM.DATA.SHIP_GEAR.minigun.dps && S2.pdCd < SM.DATA.SHIP_GEAR.pd.cd && S2.deflectCd < SM.DATA.SHIP_GEAR.deflector.recharge);
  assert.ok(SM.State.threat().power > t0, 'weapons count toward Threat');
  st.levels.wide = 40; st.levels.split = 40;
  assert.equal(SM.State.stats().wideBeam, 1, 'wide beam capped at 100%');
  assert.equal(SM.State.stats().splitBeam, 1, 'split beam capped at 100%');
  assert.ok(SM.DATA.SHUTTLE.filter(u => u.gear).length === 6);
});

test('wide beam burns the 4 blocks around the laser target; without it they are untouched', () => {
  for (const lvl of [1, 3]) {
    const { st, w, advance } = gearGame(33, { wide: lvl });
    const { b, nbs } = aimAtCluster(w);
    st.settings.autoFire = true;
    advance(1);
    assert.ok(b.hp < b.maxHp, 'main target is being cut');
    const cut = nbs.filter(n => n.hp < n.maxHp).length;
    if (lvl === 1) assert.equal(cut, 0, 'no side burn without the upgrade');
    else assert.equal(cut, 4, 'all 4 neighbours burn');
  }
});

test('split beam cuts a second block at the same time', () => {
  const { st, w, advance } = gearGame(35, { split: 5 });
  const { b } = aimAtCluster(w);
  st.settings.autoFire = true;
  advance(0.5);
  const t = w.splitTarget;
  assert.ok(t && t !== b, 'second beam picked another block');
  assert.ok(t.hp < t.maxHp || !t.alive, 'and hurt it');
});

test('miniguns keep shooting while the laser vents, and shoot scavengers', () => {
  const { st, w, advance } = gearGame(37, { minigun: 3 });
  const { b } = aimAtCluster(w);
  w.overheated = true; w.heat = 1e9; st.settings.autoFire = true;
  advance(1);
  assert.equal(w.firing, false, 'laser is venting');
  assert.ok(b.hp < b.maxHp, 'guns still cut the target');
  assert.ok(w.fx.some(f => f.kind === 'tracer') || w.gunTarget, 'tracers fly');
});

test('sentries are dropped where the ship mines, up to level - 1, and mine on their own', () => {
  const { st, w, advance } = gearGame(39, { sentry: 4, laser: 6 });
  st.settings.autoFire = true; st.settings.autopilot = true;
  advance(40);
  assert.equal(w.sentries.length, 3, `${w.sentries.length} sentries out`);
  const g0 = gearGame(39, { sentry: 1 });
  g0.st.settings.autoFire = true; g0.st.settings.autopilot = true;
  g0.advance(10);
  assert.equal(g0.w.sentries.length, 0, 'none without the upgrade');
  // a sentry on its own breaks blocks
  const g2 = gearGame(41, { sentry: 2 });
  const { b } = aimAtCluster(g2.w);
  b.hp = b.maxHp = 5;
  g2.w.sentries.push({ x: b.x, y: b.y + 10, idle: 0, a: 0, shot: null, target: null }); // b is the nearest block to it
  g2.w.ship.x = 100; g2.w.ship.y = 100;
  g2.advance(5);
  assert.equal(b.alive, false, 'sentry broke the block by itself');
});

test('point defence zaps debris that comes close', () => {
  const { w, advance } = gearGame(43, { pd: 2 });
  w.ship.x = 700; w.ship.y = 1000; w.ship.vx = 0; w.ship.vy = 0;
  const rock = { x: 760, y: 1000, vx: 0, vy: 0, r: 12, rot: 0, vr: 0 };
  w.debris = [rock];
  advance(0.2);
  assert.notEqual(w.debris[0], rock, 'the rock was destroyed and replaced far away');
  assert.equal(w.pdZaps, 1);
});

test('deflector absorbs a hit, then recharges', () => {
  const { w, advance } = gearGame(45, { deflector: 2 });
  w.ship.x = 700; w.ship.y = 1000;
  const hull = w.hull;
  w.debris = [{ x: 700, y: 1000, vx: 0, vy: 0, r: 12, rot: 0, vr: 0 }];
  advance(0.1);
  assert.equal(w.hull, hull, 'no damage');
  assert.equal(w.deflected, 1);
  assert.ok(w.deflect > 0, 'recharging');
  w.debris = [{ x: w.ship.x, y: w.ship.y, vx: 0, vy: 0, r: 12, rot: 0, vr: 0 }]; w.ship.inv = 0;
  advance(0.1);
  assert.ok(w.hull < hull, 'a second hit right away gets through');
});

test('every field plays with all ship gear fitted without errors', () => {
  const ids = SM_IDS();
  for (const id of ids) {
    const g = game(200 + ids.indexOf(id));
    const st = g.SM.State.get();
    st.tutorial = false; st.levels.laser = 8; st.levels.hull = 12;
    Object.assign(st.levels, { wide: 5, split: 5, minigun: 5, sentry: 5, pd: 5, deflector: 5 });
    g.SM.Sortie.start(id);
    const w = g.SM.Sortie._debug();
    g.advance(25);
    assert.ok(w.broken > 0, `${id}: mined ${w.broken}`);
  }
});
function SM_IDS() { return game(1).SM.DATA.REGIONS.map(r => r.id); }

test('auto EVA: autopilot parks at a giant hatch, the miner goes in by itself, hollows it over several tanks', () => {
  const { SM, advance } = game(17);
  const st = SM.State.get(); st.tutorial = false;
  Object.assign(st.settings, { autoFire: true, autopilot: true, autoEva: true });
  // base drill: the core takes ~43 s, longer than one 30 s tank
  SM.Sortie.start('nearside');
  const w = SM.Sortie._debug();
  w.debris = []; w.fields = []; w.relics = []; w.time = 1e4; w.fuel = 1e9;
  const G = w.giants[0], BS = 34;
  w.ship.x = G.hx + G.nx * BS * 5; w.ship.y = G.hy + G.ny * BS * 5;
  let evas = 0, was = false, inside = false;
  for (let i = 0; i < 4000 && !G.open; i++) {
    advance(0.05); w.hull = 100;
    if (w.eva && !was) evas++;
    was = w.eva;
    if (w.miner && Math.abs(w.miner.x - G.x) < G.size * BS / 2 && Math.abs(w.miner.y - G.y) < G.size * BS / 2) inside = true;
  }
  assert.ok(inside, 'the miner walked in through the hatch');
  assert.ok(G.open, `giant hollowed (${G.coreLeft}/${G.core} core left after ${evas} trips)`);
  assert.ok(evas >= 2, `went out more than once on oxygen refills (${evas})`);
  // then it boards, and the ship breaks the shell on autopilot
  for (let i = 0; i < 3000 && !G.cracked; i++) { advance(0.05); w.hull = 100; }
  assert.ok(G.cracked, 'ship cracked the opened giant');
});

test('auto EVA: fetches a relic in tether reach and comes back aboard', () => {
  const { SM, advance } = game(23);
  const st = SM.State.get(); st.tutorial = false;
  Object.assign(st.settings, { autoFire: false, autopilot: false, autoEva: true });
  SM.Sortie.start('nearside');
  const w = SM.Sortie._debug();
  w.debris = []; w.fields = []; w.giants = []; w.mines = []; w.foes = [];
  const r = w.relics[0];
  // put the ship in open space 150 units from the relic
  w.blocks.forEach(b => { if (Math.hypot(b.x - r.x, b.y - r.y) < 220) { b.alive = false; w.grid.delete(b.gx * 100000 + b.gy); } });
  w.relics = [r]; w.ship.x = r.x + 150; w.ship.y = r.y;
  advance(1);
  assert.ok(w.eva && w.miner && w.miner.auto, 'miner went out by itself');
  for (let i = 0; i < 400 && (r.alive || w.eva); i++) advance(0.05);
  assert.equal(r.alive, false, 'relic collected');
  assert.equal(w.eva, false, 'back aboard');
});

test('auto EVA off: the miner never leaves on its own', () => {
  const { SM, advance } = game(23);
  const st = SM.State.get(); st.tutorial = false;
  Object.assign(st.settings, { autopilot: true, autoEva: false });
  SM.Sortie.start('nearside');
  const w = SM.Sortie._debug();
  w.debris = []; w.time = 1e4;
  let went = false;
  for (let i = 0; i < 600; i++) { advance(0.05); w.hull = 100; if (w.eva) went = true; }
  assert.equal(went, false);
});

test('every field plays two minutes with autopilot and auto EVA without errors', () => {
  const { SM, advance } = game(41);
  const st = SM.State.get(); st.tutorial = false;
  Object.assign(st.settings, { autoFire: true, autopilot: true, autoEva: true });
  let evas = 0;
  for (const region of SM.DATA.REGIONS) {
    SM.Sortie.start(region.id);
    const w = SM.Sortie._debug();
    for (let i = 0; i < 1200 && SM.Sortie.isRunning(); i++) { advance(0.1); if (w.eva && w.miner && w.miner.auto) { evas++; break; } }
    for (let i = 0; i < 1200 && SM.Sortie.isRunning(); i++) advance(0.1);
    if (SM.Sortie.isRunning()) SM.Sortie.end('return');
  }
  assert.ok(evas > 0, `auto EVA went out in ${evas} fields`);
});

test('auto upgrade: off by default and buys nothing while off', () => {
  const { SM } = game(5);
  const st = SM.State.get();
  assert.equal(st.settings.autoUpgrade, false);
  st.credits = 5000;
  assert.equal(SM.State.autoUpgrade().bought.length, 0);
  assert.equal(st.credits, 5000);
});

test('auto upgrade: spends credits across several upgrades, cheapest-weighted first, keeps repair money', () => {
  const { SM } = game(6);
  const st = SM.State.get();
  st.settings.autoUpgrade = true;
  st.hull = 40; // damaged: keep enough to repair
  const reserve = SM.State.repairCost();
  assert.ok(reserve > 0);
  st.credits = 3000 + reserve;
  const r = SM.State.autoUpgrade();
  assert.ok(r.bought.length >= 5, `bought ${r.bought.length}`);
  assert.ok(st.credits >= SM.State.repairCost(), 'repair money kept');
  assert.ok(SM.State.lvl('laser') >= 3 && SM.State.lvl('heatsink') >= 3, 'laser and heat sink lead');
  // first pick at a fresh save is the laser or heat sink (80 cr, weight 1)
  assert.ok(st.levels.laser > 1 && st.levels.heatsink > 1);
  // nothing affordable left (within the quarter rule): a second call buys nothing
  assert.equal(SM.State.autoUpgrade().bought.length, 0);
});

test('auto upgrade: never buys new drones, weapons or modules, but levels owned ones; stops at capped side cuts', () => {
  const { SM } = game(7);
  const st = SM.State.get();
  st.settings.autoUpgrade = true;
  st.credits = 1e6;
  st.levels.bit = 5; st.levels.wide = 5; // already at 100% side cut / side burn
  SM.State.autoUpgrade();
  assert.equal(st.wing.count, 0);
  assert.equal(Object.keys(st.weapons.owned).length, 0);
  assert.equal(Object.keys(st.auto.lv).length, 0);
  assert.equal(st.levels.bit, 5);
  assert.equal(st.levels.wide, 5);
  // with a drone, a weapon and a module owned, those get levelled too
  st.wing.count = 1; st.wing.drones.push({ lv: { wlaser: 1, wcool: 1, wengine: 1 }, weapon: null, gear: null, owned: {} });
  const wid = SM.DATA.WEAPONS[0].id;
  st.weapons.owned[wid] = 1; st.auto.lv.racks = 1;
  st.credits = 1e6;
  SM.State.autoUpgrade(); SM.State.autoUpgrade(); SM.State.autoUpgrade();
  assert.ok(st.wing.drones[0].lv.wlaser > 1, 'drone laser levelled');
  assert.ok(st.weapons.owned[wid] > 1, 'weapon levelled');
  assert.ok(st.auto.lv.racks > 1, 'module levelled');
  assert.equal(st.wing.count, 1);
});

test('sentries shoot down incoming asteroids and guard the miner on a spacewalk', () => {
  const { w, advance } = gearGame(47, { sentry: 3 });
  w.ship.x = 700; w.ship.y = 1000;
  w.sentries.push({ x: 760, y: 1000, idle: 0, a: 0, shot: null, target: null, flakCd: 0 });
  const rock = { x: 900, y: 1000, vx: -80, vy: 0, r: 12, rot: 0, vr: 0 }; // heading for the ship
  w.debris = [rock];
  const hull = w.hull;
  advance(0.2);
  assert.notEqual(w.debris[0], rock, 'the sentry shot the asteroid down');
  assert.equal(w.sentryZaps, 1);
  assert.equal(w.hull, hull);
  // spacewalk: sentries come to the miner and shoot what is coming at it
  w.debris = [];
  w.eva = true;
  w.miner = { x: 300, y: 600, vx: 0, vy: 0, a: 0, drilling: false, target: null, reel: false, inv: 0 };
  w.sentryCd = 0;
  advance(0.1);
  assert.ok(w.sentries.some(q => Math.hypot(q.x - w.miner.x, q.y - w.miner.y) < 60), 'a sentry is beside the miner');
  const rock2 = { x: w.miner.x + 150, y: w.miner.y, vx: -60, vy: 0, r: 12, rot: 0, vr: 0 };
  w.debris = [rock2];
  w.sentries.forEach(q => { q.flakCd = 0; });
  advance(0.2);
  assert.notEqual(w.debris[0], rock2, 'asteroid heading for the miner was shot down');
});
