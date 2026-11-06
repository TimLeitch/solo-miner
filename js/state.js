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
      auto: { lv: {}, on: {} },                // ship automation modules: id -> level, id -> switched on
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
      if (raw) normalize(JSON.parse(raw));
    } catch (e) { console.warn('Save load failed', e); s = null; }
    if (!s) s = fresh();
    return s;
  }

  // Fill in anything missing from an older or partial save (used for local and cloud saves).
  function normalize(parsed) {
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
    s.auto = Object.assign({ lv: {}, on: {} }, parsed.auto || {}); // older saves: nothing bought
    if (!parsed.drone) s.drone = { store: 0, tick: parsed.lastSeen || Date.now() }; // migrate v1 saves
    return s;
  }

  // keepSeen: write to storage without moving lastSeen (used by background cloud sync so the
  // "welcome back" offline report still measures from when the player actually left).
  function save(keepSeen) {
    if (!s) return;
    if (!keepSeen) s.lastSeen = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { console.warn('Save failed', e); }
  }

  // Reset keeps the cloud account link, so the fresh save is what gets synced next.
  function reset() { const cloud = s && s.cloud; s = fresh(); if (cloud) s.cloud = cloud; save(); return s; }

  // ---------- Cloud save helpers (see js/cloud.js) ----------
  // The part of the save that goes to the cloud: everything except per-device bookkeeping.
  function exportSave(src) {
    const o = JSON.parse(JSON.stringify(src || s));
    delete o.cloud; delete o.pendingRun;
    return o;
  }
  // Fingerprint of real progress. Ignores fields that tick on their own (timestamps, drone storage),
  // so a phone sitting idle never looks like it has new progress to upload.
  function progressHash(src) {
    const o = exportSave(src);
    delete o.lastSeen; delete o.drone;
    const str = JSON.stringify(o);
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(36) + ':' + str.length;
  }
  // Swap in a save that came from the cloud. Keeps this device's sortie recovery snapshot out of it.
  function replace(obj, cloudLink) {
    s = null;
    normalize(JSON.parse(JSON.stringify(obj)));
    if (cloudLink) s.cloud = cloudLink;
    save();
    return s;
  }
  // A save with no real progress yet (brand new player or fresh install).
  function isFresh(src) {
    const o = src || s;
    return !o.lifetime && !o.xp && !(o.stats && o.stats.sorties);
  }
  function get() { return s; }

  // ---------- Derived stats ----------
  function lvl(id) { return s.levels[id] || 1; }
  function shuttleMult(id) {
    const u = D.SHUTTLE.find(x => x.id === id);
    return 1 + u.per * (lvl(id) - 1);
  }
  function stats() {
    const B = D.BASE;
    const rankPower = 1 + D.RANK_POWER * (rank() - 1);
    return {
      dps: B.dps * shuttleMult('laser') * rankPower,
      energy: B.energy * shuttleMult('reactor'),
      energyRegen: B.energyRegen * shuttleMult('reactor'),
      speed: B.speed * shuttleMult('thruster'),
      fuel: B.fuel * shuttleMult('fuel'),
      hull: B.hull * shuttleMult('hull'),
      range: B.range * shuttleMult('targeting'),
      scan: B.scan * shuttleMult('scanner'),
      heat: B.heat * shuttleMult('heatsink'),
      cool: B.heatCool * (1 + D.SHUTTLE.find(u => u.id === 'heatsink').coolPer * (lvl('heatsink') - 1)),
      repairMult: Math.pow(0.92, lvl('repair') - 1),                                    // -8% per level, compounding (never reaches zero)
      emergencyShare: 1 - (1 - D.BASE.emergencyShare) * Math.pow(0.8, lvl('suit') - 1), // 75% -> 80% -> 84%... approaches 100%
      contractBonus: 1 + 0.15 * (lvl('fscan') - 1),
      // spacewalk
      evaSpeed: D.EVA.speed * (1 + 0.15 * (lvl('eva') - 1)),
      evaO2: D.EVA.o2 * (1 + 0.25 * (lvl('o2') - 1)),
      drillDps: D.EVA.drillDps * (1 + 0.30 * (lvl('drill') - 1)) * rankPower,
    };
  }
  function maxHull() { return stats().hull; }
  function repairCost() {
    const missing = Math.max(0, maxHull() - s.hull);
    return Math.ceil(missing * D.BASE.repairPerHull * stats().repairMult);
  }

  function rankXp(r) {
    if (r <= D.RANKS.length) return D.RANKS[r - 1];
    const n = r - D.RANKS.length;
    return D.RANKS[D.RANKS.length - 1] + 1200 * n + 150 * n * (n - 1);
  }
  function rank(xp) {
    if (xp == null) xp = s.xp;
    let r = 1;
    for (let i = 0; i < D.RANKS.length; i++) if (xp >= D.RANKS[i]) r = i + 1;
    if (r === D.RANKS.length) {
      r += Math.floor((Math.sqrt(1050 * 1050 + 600 * (xp - D.RANKS[r - 1])) - 1050) / 300);
    }
    return r;
  }
  function rankProgress() {
    const r = rank();
    const lo = rankXp(r), hi = rankXp(r + 1);
    return (s.xp - lo) / (hi - lo);
  }
  function contractSlots() { return rank() >= 3 ? 2 : 1; }

  // ---------- Purchases ----------
  // Price of the next level for any upgrade table: listed prices first, then x UPGRADE_GROWTH per level.
  function tidy(n) { const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) - 1)); return Math.round(n / p) * p; }
  function tierCost(costs, idx) {
    if (idx < costs.length) return costs[idx];
    return tidy(costs[costs.length - 1] * Math.pow(D.UPGRADE_GROWTH, idx - costs.length + 1));
  }
  // Offline drone bay past its table: rate x1.5 per level, storage +2h per level up to 24h.
  function droneBaseRate(l) { const t = D.DRONE.ratePerHour; return l <= t.length ? t[l - 1] : tidy(t[t.length - 1] * Math.pow(1.5, l - t.length)); }
  function droneCapHours(l) { const t = D.DRONE.capHours; return l <= t.length ? t[l - 1] : Math.min(24, t[t.length - 1] + 2 * (l - t.length)); }
  function upgradeCost(id) {
    const def = id === 'drone' ? D.DRONE : (D.SHUTTLE.find(x => x.id === id) || D.MINER.find(x => x.id === id));
    const l = lvl(id);
    return tierCost(def.costs, l - 1);
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

  // ---------- Threat (field scaling) ----------
  function threat() {
    const S = stats();
    const laser = S.dps / D.BASE.dps;
    const wing = (s.wing.drones || []).reduce((a, d) => a + droneStats(d).dps, 0) / D.BASE.dps * 0.5;
    const weap = Object.values(s.weapons.owned).reduce((a, l) => a + (l || 0), 0) * 0.1;
    const power = laser + wing + weap;
    const t = Math.max(1, power);
    return { power, level: t, hp: Math.pow(t, D.THREAT.hp), value: Math.pow(t, D.THREAT.value), hazard: Math.pow(t, D.THREAT.hazard) };
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
    return tierCost(u.costs, l - 1);
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
    return { dmg: d.dmg * (1 + D.WEAPON_LEVEL.dmg * (lv - 1)), ammo: d.ammo + D.WEAPON_LEVEL.ammo * (lv - 1) + autoLvl('racks'), radius: d.radius, range: d.range };
  }
  function weaponCost(id) { const l = weaponLvl(id), d = weaponDef(id); return tierCost(d.costs, l); }
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

  // ---------- Ship automation (DATA.AUTO) ----------
  function autoDef(id) { return D.AUTO.modules.find(m => m.id === id); }
  function autoLvl(id) { return (s.auto && s.auto.lv[id]) || 0; }           // 0 = not bought
  function autoOn(id) { return autoLvl(id) > 0 && s.auto.on[id] !== false; } // owned and switched on
  function autoCost(id) { const d = autoDef(id), l = autoLvl(id); return d.max != null && l >= d.max ? null : tierCost(d.costs, l); }
  function buyAuto(id) {
    const c = autoCost(id);
    if (c == null || s.credits < c) return false;
    s.credits -= c; s.auto.lv[id] = autoLvl(id) + 1;
    if (s.auto.on[id] == null) s.auto.on[id] = true;
    save(); return true;
  }
  function toggleAuto(id, on) { if (!autoLvl(id)) return; s.auto.on[id] = on == null ? !autoOn(id) : !!on; save(); }
  // Credits for one bought shot of weapon id (autoloader levels make it cheaper).
  function reloadCost(id, lv) {
    const l = lv == null ? autoLvl('loader') : lv;
    return Math.max(1, Math.round(weaponDef(id).reload * Math.pow(D.AUTO.loaderStep, Math.max(0, l - 1))));
  }
  // Seconds the fire-control computer waits between automatic shots.
  function fcsDelay(lv) {
    const l = lv == null ? autoLvl('fcs') : lv;
    return Math.max(D.AUTO.fcsMin, D.AUTO.fcsDelay * Math.pow(D.AUTO.fcsStep, Math.max(0, l - 1)));
  }

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
    return droneBaseRate(l) * D.DRONE.regionMult[best] * (1 + D.WING.offlineBonus * (s.wing ? s.wing.count : 0));
  }
  function droneCap() { return droneCapHours(lvl('drone')); }
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
      const reward = Math.round(n * D.MATERIALS[m].value * threat().value * 0.6 / 5) * 5;
      return { id, kind, mat: m, region: r.id, need: n, have: 0, reward, xp: 10 * tier,
        title: `Material order: ${D.MATERIALS[m].name}`, text: `Destroy ${n} ${D.MATERIALS[m].name} blocks (any sortie).` };
    }
    if (kind === 'speed') {
      const target = Math.round(([150, 450, 1100, 2500][tier - 1] + rnd(0, 4) * 25) * threat().value / 5) * 5;
      return { id, kind, region: r.id, need: target, have: 0, reward: Math.round(target * 0.5 / 5) * 5, xp: 12 * tier,
        title: 'Speed extraction', text: `Earn ${target} credits in a single sortie in ${r.name}.` };
    }
    const blocks = rnd(8, 15);
    return { id, kind: 'safe', region: r.id, need: blocks, have: 0, reward: Math.round([120, 350, 800, 1800][tier - 1] * threat().value / 5) * 5, xp: 15 * tier,
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
    load, save, reset, get, exportSave, progressHash, replace, isFresh, lvl, stats, maxHull, repairCost, rank, rankXp, rankProgress, contractSlots,
    upgradeCost, buy, repair, regionStatus, checkUnlocks, earn,
    tierCost, droneBaseRate, droneCapHours, threat,
    wingCost, buyWingDrone, droneStats, droneUpCost, buyDroneUp, moduleDef, moduleSlot, droneModule, droneAffordable,
    weaponDef, weaponLvl, weaponStats, weaponCost, buyWeapon, equipWeapon,
    autoDef, autoLvl, autoOn, autoCost, buyAuto, toggleAuto, reloadCost, fcsDelay,
    droneRate, droneCap, droneCapCredits, droneStatus, collectDrone, collectOffline, accrue,
    refreshContracts, nextRefreshMs, acceptContract, abandonContract, applyContracts,
  };
})();
