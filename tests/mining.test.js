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
    if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
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
