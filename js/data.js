/* Solo Miner - static game data and tuning tables.
 * Every number in here is a starting tuning target from the README and is
 * expected to change after playtesting. */
window.SM = window.SM || {};

SM.DATA = (function () {
  // Materials. glyph = shape drawn on the block so type never relies on colour alone.
  const MATERIALS = {
    rock:    { name: 'Common rock',    health: 10,  res: 1.0, value: 5,   color: '#8a8f98', edge: '#5d6169', glyph: 'dot',     xp: 1 },
    iron:    { name: 'Iron-rich rock', health: 22,  res: 1.2, value: 12,  color: '#b0674a', edge: '#7a412b', glyph: 'bars',    xp: 2 },
    nickel:  { name: 'Nickel crystal', health: 38,  res: 1.5, value: 24,  color: '#6fd3c9', edge: '#3a8f88', glyph: 'diamond', xp: 3 },
    cobalt:  { name: 'Dense cobalt',   health: 70,  res: 2.0, value: 55,  color: '#4a6cf0', edge: '#2b3f99', glyph: 'tri',     xp: 5 },
    iridium: { name: 'Iridium core',   health: 125, res: 2.6, value: 130, color: '#e8e2f4', edge: '#9a8fb5', glyph: 'ring',    xp: 8 },
    glass:   { name: 'Moon glass',     health: 60,  res: 1.4, value: 90,  color: '#b5f0ff', edge: '#5fb3cc', glyph: 'cross',   xp: 6 },
    alloy:   { name: 'Ancient alloy',  health: 220, res: 3.2, value: 320, color: '#f2c14e', edge: '#a07a1c', glyph: 'star',    xp: 12 },
  };

  // Regions. weights = relative spawn weight per material, "core" materials appear deeper in clusters.
  const REGIONS = [
    { id: 'nearside', name: 'Nearside Belt', lifetime: 0, laser: 1, hazard: 'Low',
      desc: 'Calm belt close to the station. Gentle drifting debris.',
      bg: ['#070b18', '#101a33'], clusters: 9,
      shell: { rock: 70, iron: 30 }, core: { iron: 45, nickel: 55 },
      debris: { count: 3, speed: 40, dmg: 8 }, fields: 0, bonus: 150 },
    { id: 'redshard', name: 'Red Shard Field', lifetime: 2500, laser: 2, hazard: 'Medium',
      desc: 'Shattered red rock. Faster debris, rich cobalt and iridium.',
      bg: ['#14070a', '#2a0f14'], clusters: 10,
      shell: { rock: 35, iron: 40, cobalt: 25 }, core: { nickel: 30, cobalt: 45, iridium: 25 },
      debris: { count: 6, speed: 60, dmg: 12 }, fields: 0, bonus: 500 },
    { id: 'glassmoon', name: 'Glass Moon', lifetime: 8000, laser: 3, hazard: 'High',
      desc: 'Brittle high-value glass. Watch for electrical fields.',
      bg: ['#06121a', '#0d2a36'], clusters: 10,
      shell: { iron: 30, nickel: 30, glass: 40 }, core: { glass: 50, cobalt: 25, iridium: 25 },
      debris: { count: 5, speed: 55, dmg: 12 }, fields: 4, bonus: 1200 },
    { id: 'farorbit', name: 'Far Orbit', lifetime: 22000, laser: 4, hazard: 'Severe',
      desc: 'Ancient wrecks drift here. Alloy pays very well.',
      bg: ['#0c0814', '#1d1230'], clusters: 11,
      shell: { cobalt: 40, glass: 30, iridium: 30 }, core: { iridium: 45, alloy: 55 },
      debris: { count: 8, speed: 70, dmg: 16 }, fields: 5, bonus: 3000 },
  ];

  // Shuttle upgrades. Level 1 is the starting level; costs[i] buys level i+2. Max level 5.
  const SHUTTLE = [
    { id: 'laser',    name: 'Mining laser',    stat: 'Mining power',  per: 0.25, costs: [80, 200, 450, 1000], unit: '%' },
    { id: 'reactor',  name: 'Reactor',         stat: 'Boost energy',  per: 0.15, costs: [120, 300, 700, 1600], unit: '%' },
    { id: 'thruster', name: 'Thrusters',       stat: 'Move speed',    per: 0.10, costs: [90, 220, 520, 1200],  unit: '%' },
    { id: 'fuel',     name: 'Fuel tank',       stat: 'Fuel',          per: 0.20, costs: [110, 270, 650, 1500], unit: '%' },
    { id: 'hull',     name: 'Hull plating',    stat: 'Hull',          per: 0.20, costs: [130, 320, 760, 1800], unit: '%' },
    { id: 'targeting',name: 'Targeting array', stat: 'Lock range',    per: 0.15, costs: [150, 360, 850, 2000], unit: '%' },
    { id: 'scanner',  name: 'Payout scanner',  stat: 'Scan range',    per: 0.25, costs: [180, 450, 1050, 2500], unit: '%' },
    { id: 'heatsink', name: 'Heat sink',       stat: 'Heat capacity', per: 0.25, coolPer: 0.25, costs: [80, 200, 450, 1000], unit: '%' },
  ];

  // Miner upgrades. Costs are NOT in the README - placeholder values (see README "Needs decision").
  const MINER = [
    { id: 'repair',  name: 'Repair training', stat: 'Repair cost',        per: -0.08, costs: [150, 400, 900, 2000], unit: '%' },
    { id: 'suit',    name: 'Reinforced suit', stat: 'Emergency payout',   per: 0.05,  costs: [160, 420, 950, 2100], unit: 'pts' },
    { id: 'fscan',   name: 'Field scanner',   stat: 'Contract rewards', per: 0.15,  costs: [140, 380, 850, 1900], unit: '%' },
    { id: 'eva',     name: 'EVA mobility',    stat: 'Spacewalk speed',  per: 0.15,  costs: [150, 400, 900, 2000], unit: '%' },
    { id: 'o2',      name: 'Oxygen tank',     stat: 'Spacewalk time',   per: 0.25,  costs: [150, 400, 900, 2000], unit: '%' },
    { id: 'drill',   name: 'Hand drill',      stat: 'Drill power',      per: 0.30,  costs: [200, 500, 1100, 2400], unit: '%' },
  ];

  // Escort wing: drones that fly around the ship during a sortie and mine on their own.
  // Buy up to 4; the three wing upgrades apply to every drone you own.
  const WING = {
    max: 8,
    buyCosts: [400, 900, 1800, 3500, 6000, 10000, 16000, 25000],
    dps: 2.5,          // per drone, before block resistance
    fireTime: 4,       // seconds of fire before a drone vents
    coolTime: 2,       // seconds to cool
    speed: 170, reach: 190, // reach = how far from the ship a drone will go to mine
    offlineBonus: 0.15, // +15% offline drone-bay rate per escort drone owned
    // Teamwork: the wing plans together every `replan` s instead of each drone grabbing its own block.
    // Blocks are ranked by value / (seconds to break + seconds to fly there). The closest free drones
    // pile onto the best block until it will break within `focusSecs` (the ship's laser counts too),
    // then the rest spill over to the next block. No drone sits idle while there is a block in reach.
    team: {
      focusSecs: 1.5,   // aim to break each focused block this fast; lower = more drones per block
      replan: 0.3,      // seconds between plans (a broken block replans at once)
      stick: 1.3,       // score bonus for blocks the wing is already cutting, so drones finish what they start
      spread: 0.8,      // radians between drones sharing a block, so they fan out instead of stacking
      shipAssist: true, // with aim assist on, the ship's auto-target prefers a block the wing is cutting
    },
    upgrades: [
      { id: 'wlaser',  name: 'Drone lasers',     stat: 'Drone mining power', per: 0.30, costs: [250, 600, 1300, 2800], unit: '%' },
      { id: 'wcool',   name: 'Drone heat sinks', stat: 'Drone fire time',    per: 0.30, costs: [200, 500, 1100, 2400], unit: '%' },
      { id: 'wengine', name: 'Drone engines',    stat: 'Drone speed & reach', per: 0.20, costs: [200, 500, 1100, 2400], unit: '%' },
    ],
    // Each drone has one weapon slot and one gear slot. Buy a module for that drone once, then equip freely.
    weapons: [
      { id: 'pod',   name: 'Mini-missile pod', icon: '\u27B6', cost: 500, cd: 5, ammo: 6, dmg: 22, radius: 22,
        desc: 'Fires a small seeker at the drone\'s block every 5 s (6 per sortie).' },
      { id: 'flak',  name: 'Flak gun',         icon: '\u2739', cost: 400, cd: 2.5, range: 150,
        desc: 'Shoots down debris that comes near you or the drone.' },
      { id: 'pulse', name: 'Pulse charge',     icon: '\u25C9', cost: 600, cd: 7, dmg: 14, radius: 46,
        desc: 'Every 7 s, a pulse cracks the blocks around the drone\'s target.' },
    ],
    gear: [
      { id: 'shield',    name: 'Shield projector', icon: '\u26E8', cost: 450, cd: 20,
        desc: 'Blocks one debris hit on your ship, recharges in 20 s.' },
      { id: 'collector', name: 'Relic collector',  icon: '\u2726', cost: 350,
        desc: 'Fetches relics within reach, no spacewalk needed.' },
      { id: 'overclock', name: 'Overclock',        icon: '\u26A1', cost: 400, dpsMult: 1.4, heatMult: 1.3,
        desc: '+40% laser power, heats up 30% faster.' },
    ],
  };

  // Spacewalk (EVA): the miner leaves the ship on a tether.
  const EVA = {
    o2: 30,           // seconds of oxygen
    speed: 80,        // movement speed
    drillDps: 6,      // hand drill damage/s - IGNORES block resistance, so it's great on hard blocks
    drillRange: 40,
    tether: 260,      // max distance from the ship
    debrisO2: 6,      // oxygen lost when debris hits the miner
    relicsPerField: 4,
  };

  // Offline mining drone (not in the original README - added for offline gains).
  const DRONE = {
    name: 'Mining drone bay',
    ratePerHour: [120, 300, 600, 1100, 1800], // credits / hour at each level, Nearside
    capHours:    [2, 4, 6, 8, 12],            // max hours that accrue while away
    costs:       [200, 500, 1200, 2800],
    regionMult:  [1, 1.5, 2.2, 3],             // multiplier by best unlocked region
  };

  // Base shuttle stats (level 1).
  const BASE = {
    dps: 7.5,          // laser damage per second before resistance
    energy: 100, energyRegen: 9, boostDrain: 28,
    speed: 150, boostMult: 1.9,
    fuel: 100, fuelBurn: 0.55, // fuel per second at full thrust
    hull: 100,
    range: 170,        // lock range in world units
    scan: 140,         // payout scan radius
    heat: 10,          // seconds of continuous fire from cold to the safety limit
    heatCool: 3,       // heat lost per second while not firing (in seconds-of-fire units)
    ventAt: 0.9,       // laser pauses itself at 90% heat...
    resumeAt: 0.2,     // ...and starts again once cooled to 20%
    sortieTime: 180,   // soft time limit (s)
    emergencyShare: 0.75,
    repairPerHull: 1.2, // credits per hull point
  };

  // Secondary weapons. Buy once, upgrade to Lv 3, ammo restocks free every sortie.
  // dmg is raw damage before block resistance. Costs: [unlock, Lv2, Lv3].
  const WEAPONS = [
    { id: 'missile', name: 'Seeker missile', short: 'MSL', icon: '➶', color: '#ff9a3c',
      desc: 'Locks on to your target (or the nearest block) and blows a small crater.',
      dmg: 45, radius: 34, ammo: 4, reload: 30, costs: [300, 600, 1200] },
    { id: 'grenade', name: 'Space grenade', short: 'GRN', icon: '✵', color: '#57e39a',
      desc: 'Lobbed ahead of the ship, bursts after a second. Big blast, cracks whole clusters.',
      dmg: 28, radius: 74, ammo: 3, reload: 40, costs: [450, 900, 1800] },
    { id: 'lance', name: 'Plasma lance', short: 'LNC', icon: '⌁', color: '#a77bff',
      desc: 'Instant beam that pierces every block in a long straight line.',
      dmg: 32, radius: 0, range: 380, ammo: 5, reload: 50, costs: [600, 1200, 2400] },
    { id: 'shock', name: 'Shockwave', short: 'SHK', icon: '◎', color: '#7fe3ff',
      desc: 'Pulse around the ship. Destroys nearby debris, shorts electrical fields, hits blocks close by.',
      dmg: 18, radius: 150, ammo: 2, reload: 35, costs: [350, 700, 1400] },
  ];
  // Per weapon level: damage multiplier and extra ammo.
  const WEAPON_LEVEL = { dmg: 0.3, ammo: 1 };
  // Mid-run reloads: every destroyed block adds salvage (= its material XP: rock 1, iron 2, crystal 3 ... alloy 12).
  // Each SALVAGE_PER_SHOT points reloads 1 shot. Or buy a shot for the weapon's `reload` price in credits.
  const SALVAGE_PER_SHOT = 8;

  // Ship automation (added 2026-11-06 at Tim's request): modules that use weapons and handle ammo for you.
  // Bought in Upgrades > Weapons. Each has an on/off switch once owned (s.auto.on). max: null = no level cap.
  //   fcs      Lv n: waits fcsDelay x fcsStep^(n-1) seconds between automatic shots (never below fcsMin)
  //   loader   Lv n: every bought shot costs reload x loaderStep^(n-1) (manual +1 too); auto-buys only from this sortie's credits
  //   racks    Lv n: +(n-1) starting ammo on every weapon (Lv 1 = not bought)
  const AUTO = {
    fcsDelay: 3, fcsStep: 0.8, fcsMin: 0.6,
    loaderStep: 0.9,
    modules: [
      { id: 'fcs', name: 'Fire-control computer', icon: '⌖', costs: [500, 1200, 2800], max: null, toggle: true,
        desc: 'Fires your weapons by itself when the shot is worth it, switching to whichever weapon fits: missiles at tough blocks, grenades and lances into crowds, shockwave when debris gets close. Swaps away from empty weapons.' },
      { id: 'selector', name: 'Weapon selector', icon: '⇄', costs: [350], max: 1, toggle: true,
        desc: 'Switches to a loaded weapon when the current one runs dry, even with the fire-control computer off (for manual firing).' },
      { id: 'loader', name: 'Ammo autoloader', icon: '↻', costs: [400, 1000, 2400], max: null, toggle: true,
        desc: 'Buys a shot automatically when your weapon is empty, paid only from this sortie\'s credits (never your wallet). Each level makes every reload 10% cheaper.' },
      { id: 'racks', name: 'Ammo racks', icon: '≡', costs: [300, 750, 1800], max: null, toggle: false,
        desc: '+1 starting ammo on every weapon per level.' },
      { id: 'dockfix', name: 'Dock repair crew', icon: '⚒', costs: [250], max: 1, toggle: true,
        desc: 'Repairs your hull automatically when you dock (uses your wallet, partial repair if you are short).' },
    ],
  };

  // Field-clear bonus: break every block before the timer and the run pays out, then warps to the next world.
  //   payout = fieldCredits x (pct + perSec x secondsLeft) x (1 + streak x (fieldsClearedThisSortie - 1)), + region bonus x THREAT value
  //   it is banked safely (an emergency return never cuts it), adds `time` seconds to the clock, and refills `fuel` of the tank.
  const CLEAR = { pct: 1.0, perSec: 0.01, streak: 0.5, regionBonus: 0.5, time: 45, fuel: 0.5, xp: 40 };

  // No level caps. Each table above lists the first prices; after the table runs out,
  // every further level costs UPGRADE_GROWTH x the previous one (rounded to a tidy number).
  const UPGRADE_GROWTH = 1.5;

  // Threat: fields scale with your power so they stay a challenge as you upgrade.
  //   power  = laser multiplier + 0.5 x (escort drone laser power / ship base laser) + 0.1 x weapon levels
  //   threat = max(1, power)
  //   block health x threat^hp, block & relic credits x threat^value, hazards x threat^hazard
  // Health grows slower than mining power, so familiar fields become faster to mine.
  const THREAT = { hp: 0.4, value: 0.95, hazard: 0.5 };

  const RANKS = [0, 40, 120, 260, 480, 800, 1250, 1900, 2800, 4000];
  const RANK_POWER = 0.05; // laser and drill power per rank after rank 1
  const PAINTS = [
    { id: 'standard', name: 'Station white', color: '#dfe6f0', rank: 1 },
    { id: 'orange',   name: 'Survey orange', color: '#ff9a3c', rank: 2 },
    { id: 'teal',     name: 'Deep teal',     color: '#3cc9b8', rank: 4 },
    { id: 'violet',   name: 'Nebula violet', color: '#a77bff', rank: 6 },
    { id: 'gold',     name: 'Prospector gold', color: '#f2c14e', rank: 8 },
  ];

  return { MATERIALS, REGIONS, SHUTTLE, MINER, DRONE, BASE, RANKS, RANK_POWER, PAINTS, WEAPONS, WEAPON_LEVEL, SALVAGE_PER_SHOT, WING, EVA, UPGRADE_GROWTH, THREAT, AUTO, CLEAR };
})();
