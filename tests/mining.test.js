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
  assert.equal(w.left, w.blocks.length);
  const timeBefore = w.time;
  w.fieldCr = 1000;
  w.left = 0; // pretend the last block just broke
  advance(0.1);
  assert.equal(SM.Sortie.isRunning(), true, 'sortie keeps going');
  assert.equal(w.region.id, 'redshard');
  assert.equal(w.cleared, 1);
  assert.equal(w.left, w.blocks.length);
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
  assert.equal(w.left, w.blocks.filter(b => b.alive).length);
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
    g2.advance(60);
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
