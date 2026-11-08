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
  for (const file of ['data', 'state', 'meta', 'sortie']) vm.runInContext(fs.readFileSync(`js/${file}.js`, 'utf8'), sandbox);
  sandbox.SM.Audio = new Proxy({}, { get: () => () => {} });
  sandbox.SM.State.load();
  sandbox.SM.DATA.EVENTS.chance = 0; // rare events off here so seeded runs stay the same; they have their own tests
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
  st.levels.bit = 5;
  assert.equal(SM.State.stats().drillSplash, 1);
  assert.equal(SM.State.stats().drillDiag, 0, 'diagonals start once the sides reach 100%');
  st.levels.bit = 7;
  assert.equal(SM.State.stats().drillDiag, 0.5);
  st.levels.bit = 11; // 10 bought: sides and diagonals 100%, then +10% x 2
  assert.ok(Math.abs(SM.State.stats().drillSplash - 1.2) < 1e-9 && Math.abs(SM.State.stats().drillDiag - 1.2) < 1e-9, 'keeps growing past 100%');
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
  st.levels.wide = 5; st.levels.split = 5;
  assert.equal(SM.State.stats().wideBeam, 1); assert.equal(SM.State.stats().wideDiag, 0);
  assert.equal(SM.State.stats().splitBeam, 1); assert.equal(SM.State.stats().splitBeam2, 0);
  st.levels.wide = 7; st.levels.split = 7;
  assert.equal(SM.State.stats().wideDiag, 0.5, 'then the diagonals'); assert.equal(SM.State.stats().splitBeam2, 0.5, 'then a third beam');
  st.levels.wide = 19; st.levels.split = 19; // 18 bought: 10 past both tiers
  assert.ok(Math.abs(SM.State.stats().wideBeam - 2) < 1e-9 && Math.abs(SM.State.stats().wideDiag - 2) < 1e-9, 'no cap on the wide beam');
  assert.ok(Math.abs(SM.State.stats().splitBeam2 - 2) < 1e-9, 'no cap on the split beam');
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

// ---------- retention features (added 2026-11-07) ----------
function runResult(over) {
  return Object.assign({ reason: 'return', region: 'nearside', raw: 0, credits: 0, share: 1, byMat: {}, blocks: 0, xp: 0,
    damaged: false, emergency: false, hullEnd: 100, hullLost: 0, time: 60, cleared: 0, relicCount: 0, giants: 0, foeKills: 0, events: [] }, over || {});
}
const DAY_MS = 86400000;
const NOON = new Date(2026, 10, 4, 12).getTime(); // a Wednesday

test('daily and weekly orders: three each, distinct kinds, weekly asks for more', () => {
  const { SM } = game(3);
  const m = SM.State.get().meta;
  const fresh = SM.Meta.refresh(NOON);
  assert.deepEqual({ ...fresh }, { daily: true, weekly: true });
  assert.equal(m.daily.orders.length, 3);
  assert.equal(m.weekly.orders.length, 3);
  assert.equal(new Set(m.daily.orders.map(o => o.kind)).size, 3);
  assert.ok(m.daily.orders.every(o => !['scavs', 'clears', 'giants', 'events'].includes(o.kind)), 'locked kinds stay out for a new player');
  assert.ok(m.weekly.orders.every(o => o.stars > m.daily.orders[0].stars));
  assert.deepEqual({ ...SM.Meta.refresh(NOON + 3600000) }, { daily: false, weekly: false }); // same day: same orders
  assert.equal(SM.Meta.refresh(NOON + DAY_MS).daily, true);
  assert.equal(SM.Meta.refresh(NOON + DAY_MS).weekly, false);
  assert.equal(SM.Meta.refresh(NOON + 5 * DAY_MS).weekly, true); // Monday
});

test('orders fill from sortie results and pay credits, XP and stars once', () => {
  const { SM } = game(4);
  const s = SM.State.get(), m = s.meta;
  SM.Meta.refresh(NOON);
  m.daily.orders = [{ id: 'a', kind: 'blocks', key: 'blocks', need: 10, start: SM.Meta.counter('blocks'), credits: 100, xp: 5, stars: 1, name: 'Break 10 blocks', done: false }];
  m.weekly.orders = [{ id: 'b', kind: 'mat', key: 'mat:iron', need: 5, start: 0, credits: 900, xp: 20, stars: 4, name: 'Break 5 Iron', done: false },
    { id: 'c', kind: 'sorties', key: 'sorties', need: 50, start: 0, credits: 1, xp: 1, stars: 1, name: 'x', done: false }];
  let r = SM.Meta.onRun(runResult({ blocks: 6, byMat: { iron: 3, rock: 3 } }), NOON);
  assert.equal(r.orders.length, 0);
  assert.equal(SM.Meta.progress(m.daily.orders[0]), 6);
  r = SM.Meta.onRun(runResult({ blocks: 6, byMat: { iron: 3 } }), NOON);
  const labels = r.orders.map(o => o.label);
  assert.ok(labels.some(l => l.startsWith('Daily order')));
  assert.ok(labels.some(l => l.startsWith('All daily orders done')), 'one daily = all dailies here');
  assert.ok(labels.some(l => l.startsWith('Weekly order')));
  assert.ok(s.credits >= 100 + 900);
  assert.equal(m.stars, 1 + SM.DATA.ORDERS.allDailyStars + 4);
  assert.equal(SM.Meta.onRun(runResult({ blocks: 50 }), NOON).orders.length, 0, 'never paid twice');
  assert.equal(SM.Meta.counter('sorties'), 3);
  assert.equal(m.fields.nearside.runs, 3);
});

test('daily streak grows on consecutive days, resets after a missed day, and raises daily rewards', () => {
  const { SM } = game(5);
  const m = SM.State.get().meta;
  function finishDay(t) {
    SM.Meta.refresh(t);
    m.daily.orders.forEach(o => { o.key = 'sorties'; o.start = SM.Meta.counter('sorties'); o.need = 1; });
    return SM.Meta.onRun(runResult(), t).orders;
  }
  finishDay(NOON); assert.equal(SM.Meta.streak(NOON), 1);
  finishDay(NOON + DAY_MS); assert.equal(SM.Meta.streak(NOON + DAY_MS), 2);
  const paid = finishDay(NOON + 2 * DAY_MS);
  assert.equal(SM.Meta.streak(NOON + 2 * DAY_MS), 3);
  const o = m.daily.orders[0];
  assert.equal(paid[0].credits, Math.round(o.credits * (1 + 2 * SM.DATA.ORDERS.streakStep)), 'yesterday\'s streak of 2 boosts today');
  assert.equal(SM.Meta.streak(NOON + 4 * DAY_MS), 0, 'missed a day');
  finishDay(NOON + 4 * DAY_MS); assert.equal(SM.Meta.streak(NOON + 4 * DAY_MS), 1);
  assert.equal(m.daily.best, 3);
});

test('older saves get meta counters seeded from their stats; drone collection counts toward orders', () => {
  const { SM } = game(6);
  SM.State.replace({ credits: 10, stats: { sorties: 7, blocks: 300, best: 0, offlineEarned: 50 } });
  assert.equal(SM.Meta.counter('sorties'), 7);
  assert.equal(SM.Meta.counter('blocks'), 300);
  const s = SM.State.get();
  SM.Meta.refresh();
  s.meta.daily.orders = [{ id: 'z', kind: 'offline', key: 'offline', need: 20, start: SM.Meta.counter('offline'), credits: 40, xp: 1, stars: 1, name: 'Collect', done: false }];
  s.drone.store = 25;
  const r = SM.State.collectDrone();
  assert.equal(r.credits, 25);
  assert.ok(r.orders.some(o => o.label.startsWith('Daily order')));
});

test('rebirth: needs lifetime credits, resets the ship, keeps rank and stars, and boosts all credits', () => {
  const { SM } = game(11);
  const s = SM.State.get();
  s.tutorial = false;
  assert.equal(SM.State.canRebirth(), false);
  assert.equal(SM.State.rebirth(), null);
  s.xp = 900;
  const baseValue = SM.State.threat().value, baseDrone = SM.State.droneRate();
  s.lifetime = 120000; s.credits = 5000; s.meta.stars = 7;
  s.levels.laser = 6; s.unlocked.push('comet', 'redshard'); s.region = 'redshard';
  s.wing.count = 1; s.wing.drones.push({ lv: { wlaser: 1, wcool: 1, wengine: 1 }, weapon: null, gear: null, owned: {} });
  s.weapons.owned.missile = 2; s.drone.store = 40;
  assert.equal(SM.State.shardsFor(120000), 2);
  const r = SM.State.rebirth();
  assert.deepEqual({ ...r }, { gain: 2, shards: 2 });
  assert.equal(s.credits, 0); assert.equal(s.lifetime, 0);
  assert.equal(SM.State.lvl('laser'), 1);
  assert.deepEqual([...s.unlocked], ['nearside']); assert.equal(s.region, 'nearside');
  assert.equal(s.wing.count, 0); assert.equal(Object.keys(s.weapons.owned).length, 0);
  assert.equal(s.xp, 900); assert.equal(s.meta.stars, 7);
  assert.equal(s.prestige.allTime, 120040, 'drone bay banked first'); assert.equal(SM.State.allTimeCredits(), 120040);
  assert.ok(Math.abs(SM.State.threat().value / baseValue - 1.2) < 1e-9);
  assert.ok(Math.abs(SM.State.droneRate() / baseDrone - 1.2) < 1e-9);
  assert.equal(SM.Meta.counter('rebirths'), 1);
  // blocks in the next sortie are worth 20% more
  SM.Sortie.start('nearside');
  const b = SM.Sortie._debug().blocks.find(x => x.mat === 'rock');
  assert.equal(b.value, Math.round(SM.DATA.MATERIALS.rock.value * SM.State.threat().value));
  // survives a save round trip
  SM.State.replace(SM.State.exportSave());
  assert.equal(SM.State.get().prestige.shards, 2);
});

test('achievements unlock once from lifetime counters, rank and fields, and pay stars', () => {
  const { SM } = game(12);
  const s = SM.State.get();
  assert.equal(SM.Meta.checkAchievements().length, 0, 'a new player has nothing yet');
  const r = SM.Meta.onRun(runResult({ blocks: 120, giants: 1, cleared: 1 }));
  const ids = [...r.achievements.map(a => a.id)].sort();
  assert.deepEqual(ids, ['blocks.1', 'clears.1', 'giants.1']);
  assert.equal(s.meta.stars, 3 * SM.DATA.STARS_BY_RUNG[0] + r.orders.reduce((a, o) => a + o.stars, 0));
  assert.equal(SM.Meta.checkAchievements().length, 0, 'never twice');
  s.xp = SM.State.rankXp(10); s.unlocked.push('comet', 'redshard');
  const more = [...SM.Meta.checkAchievements().map(a => a.id)].sort();
  assert.deepEqual(more, ['fields.1', 'rank.1', 'rank.2']);
  assert.equal(SM.Meta.unseenAchievements(), 6);
  SM.Meta.seeAchievements();
  assert.equal(SM.Meta.unseenAchievements(), 0);
  const all = SM.Meta.achievements();
  assert.ok(all.length > 40 && all.every(a => a.goal > 0 && a.stars > 0));
});

test('rare events: a comet crosses the field and pays when shot; autopilot chases it', () => {
  const { SM, advance } = game(21);
  const s = SM.State.get(); s.tutorial = false; s.levels.laser = 8;
  SM.Sortie.start('nearside');
  const w = SM.Sortie._debug();
  w.debris = [];
  const ev = SM.Sortie._event('comet');
  const comet = w.foes.find(f => f.kind === 'comet');
  assert.ok(comet && comet.value > 0);
  let res = null;
  SM.Sortie.start('nearside', { onEnd: r => (res = r) }); // fresh run to check the result plumbing
  const w2 = SM.Sortie._debug(); w2.debris = [];
  SM.Sortie._event('comet');
  const c2 = w2.foes.find(f => f.kind === 'comet');
  c2.x = w2.ship.x + 60; c2.y = w2.ship.y - 60; c2.vx = 5; c2.vy = 0; // drifting slowly right next to the ship
  advance(20);
  assert.equal(c2.alive, false, 'laser broke the comet');
  assert.equal(w2.events[0].done, true);
  SM.Sortie.end('return');
  assert.equal(res.events.length, 1); assert.equal(res.events[0].done, true);
  assert.ok(res.events[0].credits === c2.value);
  const meta = SM.Meta.onRun(res);
  assert.equal(SM.Meta.counter('ev:comet'), 1);
  assert.ok(meta.achievements.some(a => a.id === 'events.1'));
  assert.equal(ev.kind, 'comet');
});

test('rare events: an unshot comet escapes and counts as missed', () => {
  const { SM, advance } = game(22);
  const s = SM.State.get(); s.tutorial = false; s.settings.autoFire = false; s.settings.autopilot = false;
  SM.Sortie.start('nearside');
  const w = SM.Sortie._debug(); w.debris = [];
  SM.Sortie._event('comet');
  const c = w.foes.find(f => f.kind === 'comet');
  c.vx *= 6; c.vy *= 6;
  advance(30);
  assert.equal(c.alive, false);
  assert.equal(w.events[0].done, false);
  assert.equal(w.events[0].gone, true);
});

test('rare events: autopilot parks at a derelict and auto EVA salvages every crate', () => {
  const { SM, advance } = game(23);
  const s = SM.State.get(); s.tutorial = false; s.settings.autoEva = true;
  SM.Sortie.start('nearside');
  const w = SM.Sortie._debug(); w.debris = [];
  w.relics.forEach(r => (r.alive = false)); // only the crates are left to fetch
  SM.Sortie._event('derelict');
  assert.ok(w.derelict && w.derelict.crates.length === SM.DATA.EVENTS.kinds.derelict.crates);
  const credits0 = w.credits;
  advance(100);
  assert.ok(w.derelict.crates.every(c => !c.alive), `${w.derelict.crates.filter(c => c.alive).length} crates left`);
  assert.equal(w.derelict.ev.done, true);
  assert.ok(w.credits - credits0 >= w.derelict.ev.credits);
});

test('rare events: the mothership launches drones, pulses, and autopilot + guns take it down', () => {
  const { SM, advance } = game(24);
  const s = SM.State.get(); s.tutorial = false; s.levels.laser = 12; s.levels.hull = 8; s.hull = 400; s.unlocked.push('comet', 'redshard');
  SM.Sortie.start('redshard');
  const w = SM.Sortie._debug(); w.debris = [];
  SM.Sortie._event('boss');
  const boss = w.foes.find(f => f.kind === 'boss');
  assert.ok(boss.maxHp > SM.DATA.MATERIALS.scav.health * 10);
  advance(90);
  assert.ok(w.foes.some(f => f.mother === boss), 'launched scavengers');
  assert.equal(boss.alive, false, `boss hp ${Math.round(boss.hp)} / ${Math.round(boss.maxHp)}`);
  assert.equal(w.events[0].done, true);
});

test('rare events roll by chance, never in the tutorial, mothership only from Red Shard', () => {
  const { SM } = game(25);
  const s = SM.State.get();
  SM.DATA.EVENTS.chance = 1;
  SM.Sortie.start('nearside');
  assert.equal(SM.Sortie._debug().event, null, 'tutorial');
  s.tutorial = false;
  const kinds = new Set();
  for (let i = 0; i < 60; i++) { SM.Sortie.start('nearside'); kinds.add(SM.Sortie._debug().event.kind); }
  assert.ok(!kinds.has('boss') && kinds.has('comet') && kinds.has('derelict'));
  s.unlocked.push('comet', 'redshard');
  for (let i = 0; i < 60; i++) { SM.Sortie.start('redshard'); kinds.add(SM.Sortie._debug().event.kind); }
  assert.ok(kinds.has('boss'));
  SM.DATA.EVENTS.chance = 0;
  SM.Sortie.start('nearside');
  assert.equal(SM.Sortie._debug().event, null);
});

test('every field plays each rare event on autopilot + auto EVA without errors', () => {
  const { SM, advance } = game(26);
  const s = SM.State.get(); s.tutorial = false; s.settings.autoEva = true;
  SM.DATA.REGIONS.forEach(r => { if (!s.unlocked.includes(r.id)) s.unlocked.push(r.id); });
  for (const kind of ['comet', 'derelict', 'boss']) for (const r of SM.DATA.REGIONS) {
    SM.Sortie.start(r.id);
    SM.Sortie._event(kind);
    advance(25);
    assert.ok(SM.Sortie._debug() === null || SM.Sortie._debug().events.length >= 1, `${kind} in ${r.id}`);
    if (SM.Sortie.isRunning()) SM.Sortie.end('return');
  }
});

test('cosmetics: stars buy items once, rank and achievement items unlock on their own, the sortie uses the look', () => {
  const { SM } = game(31);
  const s = SM.State.get(), M = SM.Meta;
  assert.equal(M.look().trail.id, 'standard');
  assert.equal(M.useCosmetic('trail', 'ember'), 'poor');
  s.meta.stars = 25;
  assert.equal(M.useCosmetic('trail', 'ember'), 'bought');
  assert.equal(s.meta.stars, 5);
  assert.equal(M.useCosmetic('trail', 'standard'), 'equipped');
  assert.equal(M.useCosmetic('trail', 'ember'), 'equipped', 'owned: no second charge');
  assert.equal(s.meta.stars, 5);
  assert.equal(M.useCosmetic('trail', 'toxic'), 'locked'); // rank 12
  s.xp = SM.State.rankXp(12);
  assert.equal(M.useCosmetic('trail', 'toxic'), 'equipped');
  assert.equal(M.useCosmetic('decal', 'skull'), 'locked'); // achievement
  s.meta.ach['scavs.2'] = 1;
  assert.equal(M.useCosmetic('decal', 'skull'), 'equipped');
  s.xp = 0;
  assert.equal(M.useCosmetic('paint', 'gold'), 'locked');
  assert.equal(M.look().trail.id, 'standard', 'a rank item below its rank falls back to the standard look');
  SM.Sortie.start('nearside');
  assert.equal(SM.Sortie._debug().look.decal.id, 'skull');
  SM.State.replace(SM.State.exportSave());
  assert.equal(SM.State.get().cosm.decal, 'skull');
  assert.ok(SM.State.get().cosm.owned['trail.ember']);
});

test('storage silo adds offline hours on top of the drone bay, capped at the max, and settles earnings first', () => {
  const { SM } = game(41);
  const s = SM.State.get(), D = SM.DATA;
  assert.equal(SM.State.droneCap(), D.DRONE.capHours[0]);
  const t0 = Date.now();
  s.drone = { store: 0, tick: t0 - 3600000 }; // 1 h of earnings waiting at the old storage size
  s.credits = 100000;
  assert.ok(SM.State.buy('silo'));
  assert.equal(SM.State.droneCap(), D.DRONE.capHours[0] + D.SILO.hoursPer);
  assert.ok(Math.abs(s.drone.store - SM.State.droneRate()) < SM.State.droneRate() * 0.01, 'the hour before the purchase was banked');
  // storage after 30 hours away: limited by bay + silo
  s.drone = { store: 0, tick: t0 - 30 * 3600000 };
  const st = SM.State.droneStatus(t0);
  assert.ok(Math.abs(st.store - SM.State.droneRate() * SM.State.droneCap()) < 1);
  // it stops being sold once total storage hits the max
  s.levels.drone = 30; s.levels.silo = 1;
  let n = 0; s.credits = 1e12;
  while (SM.State.upgradeCost('silo') != null && n < 100) { SM.State.buy('silo'); n++; }
  assert.equal(SM.State.droneCap(), D.SILO.maxHours);
  assert.ok(n > 0 && n < 100);
  // auto upgrade knows about it
  const { SM: SM2 } = game(42);
  SM2.State.get().credits = 400;
  assert.ok(SM2.State.autoUpgradeOptions().some(o => o.key === 'silo'));
});

test('welcome back: a full bin still reports after an hour away, with the hours lost', () => {
  const { SM } = game(43);
  const s = SM.State.get(), now = Date.now();
  s.drone = { store: SM.State.droneCapCredits(), tick: now - 5 * 3600000 };
  s.lastSeen = now - 5 * 3600000;
  const o = SM.State.collectOffline(now);
  assert.ok(o, 'reported even though nothing new was stored');
  assert.equal(o.gained, 0);
  assert.equal(o.capped, true);
  assert.ok(Math.abs(o.hoursAway - o.hoursCounted - 5) < 0.01);
  s.lastSeen = now - 30 * 60000; // half an hour, bin full: no report
  assert.equal(SM.State.collectOffline(now), null);
});

test('the ship keeps shooting during a spacewalk but stays where it is', () => {
  const { SM, advance } = game(19);
  const st = SM.State.get(); st.tutorial = false;
  Object.assign(st.settings, { autoFire: true, autopilot: true, autoEva: false });
  st.levels.minigun = 3;
  SM.Sortie.start('nearside');
  const w = SM.Sortie._debug();
  w.debris = []; w.fields = []; w.time = 1e4;
  advance(6); // fly to a block and start mining
  const x0 = w.ship.x, y0 = w.ship.y, broke0 = w.broken;
  SM.Sortie._eva();
  assert.ok(w.eva, 'miner is out');
  let fired = false;
  for (let i = 0; i < 200 && w.eva; i++) { advance(0.05); if (w.firing || w.gunTarget) fired = true; w.o2 = w.S.evaO2; }
  assert.ok(w.eva, 'still out');
  assert.ok(fired, 'laser or guns fired while the miner was out');
  assert.ok(w.broken > broke0, `ship broke blocks during the spacewalk (${w.broken - broke0})`);
  assert.ok(Math.hypot(w.ship.x - x0, w.ship.y - y0) < 5, 'ship held its position');
});

test('fire-control computer keeps paying after its delay floor: +10% weapon damage a level', () => {
  const { SM } = game(3);
  const st = SM.State.get();
  st.weapons.owned.missile = 1;
  const base = SM.State.weaponStats('missile').dmg;
  const cap = SM.State.fcsCapLevel();
  assert.equal(cap, 9);
  st.auto.lv.fcs = cap - 1;
  assert.equal(SM.State.weaponStats('missile').dmg, base, 'no bonus before the floor');
  st.auto.lv.fcs = cap;
  assert.equal(SM.State.fcsDelay(), 0.6);
  assert.ok(Math.abs(SM.State.weaponStats('missile').dmg - base * 1.1) < 1e-9);
  st.auto.lv.fcs = cap + 5;
  assert.ok(Math.abs(SM.State.weaponStats('missile').dmg - base * 1.6) < 1e-9);
  assert.ok(SM.State.autoCost('fcs') > 0, 'still for sale');
});

test('wide beam diagonals and the third split beam actually cut blocks', () => {
  const { st, w, advance } = gearGame(33, { wide: 7, split: 7 });
  const { b } = aimAtCluster(w);
  const at = (x, y) => w.grid.get(x * 100000 + y);
  const diags = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => at(b.gx + dx, b.gy + dy)).filter(c => c && c.alive && !c.giant);
  diags.forEach(c => { c.hp = c.maxHp = 1e6; });
  st.settings.autoFire = true;
  advance(1);
  assert.ok(diags.length && diags.every(c => c.hp < c.maxHp), 'diagonals burn');
  assert.ok(w.splitTarget2 && w.splitTarget2 !== w.splitTarget && w.splitTarget2.hp < w.splitTarget2.maxHp, 'third beam cuts');
});
