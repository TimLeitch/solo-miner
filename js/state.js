/* Solo Miner - persistent state, derived stats, offline gains and contracts. */
window.SM = window.SM || {};

SM.State = (function () {
  const D = SM.DATA;
  const KEY = 'solominer.save.v1';
  const VERSION = 1;
  const CONTRACT_REFRESH_MS = 4 * 60 * 60 * 1000; // offers refresh every 4 hours

  function fresh() {
    const lv = {};
    D.SHUTTLE.forEach(u => (lv[u.id] = 1));
    D.MINER.forEach(u => (lv[u.id] = 1));
    lv.drone = 1;
    return {
      v: VERSION,
      credits: 0,
      lifetime: 0,
      xp: 0,
      levels: lv,
      hull: 100,              // current hull (absolute); max derived from upgrades
      unlocked: ['nearside'],
      region: 'nearside',
      discovered: {},         // material id -> true
      stats: { sorties: 0, blocks: 0, best: 0, offlineEarned: 0 },
      contracts: { offers: [], active: [], refreshedAt: 0, done: 0 },
      paint: 'standard',
      weapons: { owned: {}, equipped: null }, // id -> level
      wing: { count: 0, drones: [] },          // escort drones and their loadouts
      tutorial: true,
      lastSeen: Date.now(),
      drone: { store: 0, tick: Date.now() }, // offline/idle drone storage
      settings: {
        volume: 0.6, vibration: true, shake: true, reducedFx: false,
        aimAssist: true, autoFire: true, autoBoost: false, autopilot: true, leftHanded: false,
        highContrast: false, uiScale: 1, stickOpacity: 0.5, captions: true,
      },
    };
  }

  let s = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const base = fresh();
        s = Object.assign(base, parsed);
        s.levels = Object.assign(fresh().levels, parsed.levels || {});
        s.settings = Object.assign(fresh().settings, parsed.settings || {});
        s.stats = Object.assign(fresh().stats, parsed.stats || {});
        s.contracts = Object.assign(fresh().contracts, parsed.contracts || {});
        s.wing = Object.assign({ count: 0 }, parsed.wing || {});
        if (!s.wing.drones) { // migrate fleet-wide upgrade levels onto each drone
          const L = parsed.levels || {};
          s.wing.drones = Array.from({ length: s.wing.count }, () => newDrone(L.wlaser || 1, L.wcool || 1, L.wengine || 1));
        }
        s.weapons = Object.assign({ owned: {}, equipped: null }, parsed.weapons || {});
        if (!parsed.drone) s.drone = { store: 0, tick: parsed.lastSeen || Date.now() }; // migrate v1 saves
      }
    } catch (e) { console.warn('Save load failed', e); }
    if (!s) s = fresh();
    return s;
  }

  function save() {
    if (!s) return;
    s.lastSeen = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { console.warn('Save failed', e); }
  }

  function reset() { s = fresh(); save(); return s; }
  function get() { return s; }

  // ---------- Derived stats ----------
  function lvl(id) { return s.levels[id] || 1; }
  function shuttleMult(id) {
    const u = D.SHUTTLE.find(x => x.id === id);
    return 1 + u.per * (lvl(id) - 1);
  }
  function stats() {
    const B = D.BASE;
    return {
      dps: B.dps * shuttleMult('laser'),
      energy: B.energy * shuttleMult('reactor'),
      energyRegen: B.energyRegen * shuttleMult('reactor'),
      speed: B.speed * shuttleMult('thruster'),
      fuel: B.fuel * shuttleMult('fuel'),
      hull: B.hull * shuttleMult('hull'),
      range: B.range * shuttleMult('targeting'),
      scan: B.scan * shuttleMult('scanner'),
      heat: B.heat * shuttleMult('heatsink'),
      cool: B.heatCool * (1 + D.SHUTTLE.find(u => u.id === 'heatsink').coolPer * (lvl('heatsink') - 1)),
      repairMult: Math.max(0.68, 1 - 0.08 * (lvl('repair') - 1)),
      emergencyShare: D.BASE.emergencyShare + 0.05 * (lvl('suit') - 1),
      contractBonus: 1 + 0.15 * (lvl('fscan') - 1),
      // spacewalk
      evaSpeed: D.EVA.speed * (1 + 0.15 * (lvl('eva') - 1)),
      evaO2: D.EVA.o2 * (1 + 0.25 * (lvl('o2') - 1)),
      drillDps: D.EVA.drillDps * (1 + 0.30 * (lvl('drill') - 1)),
    };
  }
  function maxHull() { return stats().hull; }
  function repairCost() {
    const missing = Math.max(0, maxHull() - s.hull);
    return Math.ceil(missing * D.BASE.repairPerHull * stats().repairMult);
  }

  function rank() {
    let r = 1;
    for (let i = 0; i < D.RANKS.length; i++) if (s.xp >= D.RANKS[i]) r = i + 1;
    return r;
  }
  function rankProgress() {
    const r = rank();
    const lo = D.RANKS[r - 1], hi = D.RANKS[r] ?? lo;
    return hi === lo ? 1 : (s.xp - lo) / (hi - lo);
  }
  function contractSlots() { return rank() >= 3 ? 2 : 1; }

  // ---------- Purchases ----------
  function upgradeCost(id) {
    const def = id === 'drone' ? D.DRONE : (D.SHUTTLE.find(x => x.id === id) || D.MINER.find(x => x.id === id));
    const l = lvl(id);
    return l - 1 < def.costs.length ? def.costs[l - 1] : null;
  }
  function buy(id) {
    const c = upgradeCost(id);
    if (c == null || s.credits < c) return false;
    const oldMax = maxHull();
    if (id === 'drone') accrue(); // earnings so far use the old rate
    s.credits -= c;
    s.levels[id] = lvl(id) + 1;
    if (id === 'hull') s.hull += maxHull() - oldMax; // new plating arrives intact
    save();
    return true;
  }
  function repair() {
    const c = repairCost();
    if (c <= 0) return 0;
    if (s.credits >= c) { s.credits -= c; s.hull = maxHull(); }
    else { // partial repair with whatever is available
      const per = D.BASE.repairPerHull * stats().repairMult;
      const pts = Math.floor(s.credits / per);
      s.credits -= Math.ceil(pts * per);
      s.hull = Math.min(maxHull(), s.hull + pts);
    }
    save();
    return c;
  }

  // ---------- Escort wing ----------
  function newDrone(laser, cool, engine) {
    return { lv: { wlaser: laser || 1, wcool: cool || 1, wengine: engine || 1 }, weapon: null, gear: null, owned: {} };
  }
  // Stats for one drone from its own levels and gear.
  function droneStats(d) {
    const W = D.WING, oc = d.gear === 'overclock' ? W.gear.find(g => g.id === 'overclock') : null;
    return {
      dps: W.dps * (1 + 0.30 * (d.lv.wlaser - 1)) * (oc ? oc.dpsMult : 1),
      fire: W.fireTime * (1 + 0.30 * (d.lv.wcool - 1)) / (oc ? oc.heatMult : 1),
      speed: W.speed * (1 + 0.20 * (d.lv.wengine - 1)),
      reach: W.reach * (1 + 0.20 * (d.lv.wengine - 1)),
    };
  }
  function droneUpCost(i, id) {
    const d = s.wing.drones[i], u = D.WING.upgrades.find(x => x.id === id), l = d.lv[id];
    return l - 1 < u.costs.length ? u.costs[l - 1] : null;
  }
  function buyDroneUp(i, id) {
    const c = droneUpCost(i, id);
    if (c == null || s.credits < c) return false;
    s.credits -= c; s.wing.drones[i].lv[id]++; save(); return true;
  }
  function moduleDef(id) { return D.WING.weapons.find(m => m.id === id) || D.WING.gear.find(m => m.id === id); }
  function moduleSlot(id) { return D.WING.weapons.some(m => m.id === id) ? 'weapon' : 'gear'; }
  // Buy (if needed) and equip a module on drone i. Tapping an equipped module unequips it.
  function droneModule(i, id) {
    const d = s.wing.drones[i], def = moduleDef(id), slot = moduleSlot(id);
    if (!d.owned[id]) {
      if (s.credits < def.cost) return 'poor';
      s.credits -= def.cost; d.owned[id] = true; d[slot] = id; save(); return 'bought';
    }
    d[slot] = d[slot] === id ? null : id; save();
    return d[slot] ? 'equipped' : 'removed';
  }
  function droneAffordable() {
    return s.wing.drones.some((d, i) => D.WING.upgrades.some(u => { const c = droneUpCost(i, u.id); return c != null && c <= s.credits; })
      || [...D.WING.weapons, ...D.WING.gear].some(m => !d.owned[m.id] && m.cost <= s.credits));
  }
  function wingCost() { const n = s.wing.count; return n < D.WING.max ? D.WING.buyCosts[n] : null; }
  function buyWingDrone() {
    const c = wingCost();
    if (c == null || s.credits < c) return false;
    accrue(); // offline rate bonus changes with drone count
    s.credits -= c; s.wing.count++; s.wing.drones.push(newDrone());
    save();
    return true;
  }

  // ---------- Weapons ----------
  function weaponDef(id) { return D.WEAPONS.find(x => x.id === id); }
  function weaponLvl(id) { return s.weapons.owned[id] || 0; }
  function weaponStats(id, lv) {
    const d = weaponDef(id); lv = lv || weaponLvl(id) || 1;
    return { dmg: d.dmg * (1 + D.WEAPON_LEVEL.dmg * (lv - 1)), ammo: d.ammo + D.WEAPON_LEVEL.ammo * (lv - 1), radius: d.radius, range: d.range };
  }
  function weaponCost(id) { const l = weaponLvl(id), d = weaponDef(id); return l < d.costs.length ? d.costs[l] : null; }
  function buyWeapon(id) {
    const c = weaponCost(id);
    if (c == null || s.credits < c) return false;
    s.credits -= c;
    s.weapons.owned[id] = weaponLvl(id) + 1;
    if (!s.weapons.equipped) s.weapons.equipped = id;
    save();
    return true;
  }
  function equipWeapon(id) { if (weaponLvl(id)) { s.weapons.equipped = id; save(); } }

  // ---------- Regions ----------
  function regionStatus(r) {
    const okCredits = s.lifetime >= r.lifetime;
    const okLaser = lvl('laser') >= r.laser;
    return { unlocked: s.unlocked.includes(r.id), ready: okCredits && okLaser, okCredits, okLaser };
  }
  // Returns newly unlocked regions.
  function checkUnlocks() {
    accrue(); // lock in drone earnings at the old field bonus before it changes
    const out = [];
    D.REGIONS.forEach(r => {
      if (!s.unlocked.includes(r.id) && regionStatus(r).ready) { s.unlocked.push(r.id); out.push(r); }
    });
    return out;
  }
  function earn(amount) { s.credits += amount; s.lifetime += amount; }

  // ---------- Offline gains ----------
  function droneRate() { // credits per hour
    const l = lvl('drone');
    const best = Math.max(0, ...s.unlocked.map(id => D.REGIONS.findIndex(r => r.id === id)));
    return D.DRONE.ratePerHour[l - 1] * D.DRONE.regionMult[best] * (1 + D.WING.offlineBonus * (s.wing ? s.wing.count : 0));
  }
  function droneCap() { return D.DRONE.capHours[lvl('drone') - 1]; }
  function droneCapCredits() { return droneRate() * droneCap(); }
  /* Drone storage formula (runs in real time, whether the game is open, in the background or closed):
   *   rate      = ratePerHour[droneLevel] x regionMult[best unlocked field]      (credits / hour)
   *   capacity  = rate x capHours[droneLevel]                                    (credits)
   *   storage   = min(capacity, storage + rate x hoursSinceLastTick)
   * Any time the rate changes (drone upgrade, new field) we accrue first, so earnings
   * before the change use the old rate and earnings after use the new one. */
  function accrue(now) {
    now = now || Date.now();
    const d = s.drone;
    if (now < d.tick) { d.tick = now; return 0; } // clock moved backwards: earn nothing
    const before = d.store;
    d.store = Math.min(droneCapCredits(), d.store + droneRate() * (now - d.tick) / 3600000);
    d.tick = now;
    return d.store - before;
  }
  function droneStatus(now) {
    now = now || Date.now();
    accrue(now);
    const rate = droneRate(), cap = droneCapCredits(), store = s.drone.store;
    const fullInMs = store >= cap ? 0 : (cap - store) / rate * 3600000;
    return { rate, cap, capHours: droneCap(), store, fullInMs, fullAt: now + fullInMs, frac: cap ? store / cap : 0,
      project: h => Math.floor(Math.min(cap, store + rate * h)) };
  }
  function collectDrone() {
    accrue();
    const amt = Math.floor(s.drone.store);
    if (amt <= 0) return { credits: 0, unlocked: [] };
    s.drone.store -= amt;
    earn(amt);
    s.stats.offlineEarned += amt;
    const unlocked = checkUnlocks();
    save();
    return { credits: amt, unlocked };
  }
  // On launch / return to the tab: how long were we gone and how much did the drone add meanwhile?
  function collectOffline(now) {
    now = now || Date.now();
    const away = now - (s.lastSeen || now);
    const storeBefore = s.drone.store, rate = droneRate(), cap = droneCapCredits();
    const gained = accrue(now);
    s.lastSeen = now;
    if (away < 60 * 1000 || gained < 1) return null;
    const hoursAway = away / 3600000;
    const hoursUntilFull = (cap - storeBefore) / rate;
    return { awayMs: away, hoursAway, gained: Math.floor(gained), storeBefore: Math.floor(storeBefore), store: Math.floor(s.drone.store),
      rate, cap, capHours: droneCap(), hoursCounted: Math.min(hoursAway, hoursUntilFull), capped: hoursAway > hoursUntilFull };
  }

  // ---------- Contracts ----------
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function makeContract() {
    const regions = D.REGIONS.filter(r => s.unlocked.includes(r.id));
    const r = regions[rnd(0, regions.length - 1)];
    const tier = D.REGIONS.indexOf(r) + 1;
    const mats = Array.from(new Set([...Object.keys(r.shell), ...Object.keys(r.core)]));
    const kind = ['material', 'material', 'speed', 'safe'][rnd(0, 3)];
    const id = Math.random().toString(36).slice(2, 9);
    if (kind === 'material') {
      const m = mats[rnd(0, mats.length - 1)];
      const n = Math.max(3, Math.round(rnd(8, 16) * 12 / Math.max(8, D.MATERIALS[m].value) * 3));
      const reward = Math.round(n * D.MATERIALS[m].value * 0.6 / 5) * 5;
      return { id, kind, mat: m, region: r.id, need: n, have: 0, reward, xp: 10 * tier,
        title: `Material order: ${D.MATERIALS[m].name}`, text: `Destroy ${n} ${D.MATERIALS[m].name} blocks (any sortie).` };
    }
    if (kind === 'speed') {
      const target = [150, 450, 1100, 2500][tier - 1] + rnd(0, 4) * 25;
      return { id, kind, region: r.id, need: target, have: 0, reward: Math.round(target * 0.5 / 5) * 5, xp: 12 * tier,
        title: 'Speed extraction', text: `Earn ${target} credits in a single sortie in ${r.name}.` };
    }
    const blocks = rnd(8, 15);
    return { id, kind: 'safe', region: r.id, need: blocks, have: 0, reward: [120, 350, 800, 1800][tier - 1], xp: 15 * tier,
      title: 'Safe pilot', text: `Destroy ${blocks} blocks in ${r.name} and return without hull damage.` };
  }
  function refreshContracts(force) {
    const c = s.contracts;
    const now = Date.now();
    if (force || now - c.refreshedAt > CONTRACT_REFRESH_MS || c.offers.length === 0) {
      c.offers = [makeContract(), makeContract(), makeContract()];
      c.refreshedAt = now;
    }
  }
  function nextRefreshMs() { return Math.max(0, s.contracts.refreshedAt + CONTRACT_REFRESH_MS - Date.now()); }
  function acceptContract(id) {
    const c = s.contracts;
    if (c.active.length >= contractSlots()) return false;
    const i = c.offers.findIndex(o => o.id === id);
    if (i < 0) return false;
    c.active.push(c.offers.splice(i, 1)[0]);
    save();
    return true;
  }
  function abandonContract(id) {
    s.contracts.active = s.contracts.active.filter(x => x.id !== id);
    save();
  }
  // Called at the end of a sortie. run = {region, byMat, credits, damaged, emergency}
  function applyContracts(run) {
    const done = [];
    s.contracts.active.forEach(c => {
      if (c.kind === 'material') c.have = Math.min(c.need, c.have + (run.byMat[c.mat] || 0));
      else if (c.region === run.region) {
        if (c.kind === 'speed') c.have = Math.max(c.have, run.credits);
        if (c.kind === 'safe' && !run.damaged && !run.emergency) c.have = Math.max(c.have, run.blocks);
      }
      if (c.have >= c.need) done.push(c);
    });
    const mult = stats().contractBonus;
    done.forEach(c => {
      c.paid = Math.round(c.reward * mult);
      earn(c.paid); s.xp += c.xp; s.contracts.done++;
    });
    s.contracts.active = s.contracts.active.filter(c => !done.includes(c));
    return done;
  }

  return {
    load, save, reset, get, lvl, stats, maxHull, repairCost, rank, rankProgress, contractSlots,
    upgradeCost, buy, repair, regionStatus, checkUnlocks, earn,
    wingCost, buyWingDrone, droneStats, droneUpCost, buyDroneUp, moduleDef, moduleSlot, droneModule, droneAffordable,
    weaponDef, weaponLvl, weaponStats, weaponCost, buyWeapon, equipWeapon,
    droneRate, droneCap, droneCapCredits, droneStatus, collectDrone, collectOffline, accrue,
    refreshContracts, nextRefreshMs, acceptContract, abandonContract, applyContracts,
  };
})();
