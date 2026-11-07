# Solo Miner

## Build Status (browser version)

> Built by Claude on 2026-11-04. The game is a mobile-first **browser game** (works on phones, tablets and desktop) built from the design document below. Items marked **[DONE]** are playable now; **[TODO]** is not built yet; **[NEEDS DECISION]** is something I guessed at and need you to confirm or change.

### How to run

- No build step, no dependencies. Plain HTML/CSS/JavaScript.
- Quick look: open `index.html` directly in a browser (offline caching won't be active this way).
- Proper (phone) testing: serve the folder over HTTP, e.g. `python3 -m http.server 8080` in this folder, then open `http://<your-computer-ip>:8080` on your phone (same Wi-Fi). On Android Chrome use **menu > Add to Home screen / Install app** to get a full-screen app icon.
- [DONE] **Hosting: GitHub Pages.** `.github/workflows/pages.yml` deploys the repo root on every push to `main` (no build step). Live URL once Pages is enabled: **https://timleitch.github.io/solo-miner/**. All paths (service worker, manifest, scripts) are relative, so they work under `/solo-miner/`. HTTPS from Pages is what makes install + offline play work.
- [NEEDS DECISION] Pages on a **private** repo needs a paid GitHub plan (Pro/Team). On a free plan, make the repo public (Settings > General > Danger Zone > Change visibility). Then Settings > Pages > Build and deployment > Source: **GitHub Actions**, and re-run the "Deploy to GitHub Pages" workflow from the Actions tab.
- Desktop keys for testing: WASD/arrows move, Space mine, Shift boost, Tab target nearest, R return, P/Esc pause.

### Files

| File | Purpose |
| ---- | ------- |
| `index.html` | Page layout: hangar screens, sortie HUD, controls, modals |
| `css/style.css` | All styling, mobile-first, safe-area aware |
| `js/data.js` | **All tuning numbers** (materials, regions, upgrade costs, drone rates, base stats). Edit here to rebalance. |
| `js/meta.js` | Long-term goals: daily / weekly orders, lifetime counters (and later achievements, collection log) |
| `js/state.js` | Save/load (localStorage), derived stats, purchases, region unlocks, **offline gains**, contracts |
| `js/sortie.js` | The mining run: world generation (6 layouts), touch stick, laser/heat, debris, field hazards (electrical fields, wind, gravity wells, flares, fog, mines, scavengers), rendering, HUD |
| `js/ui.js` | Hangar, upgrade bay, fields, contracts, settings, summary and welcome-back screens |
| `js/audio.js` | Synthesized sound effects (no audio files needed) |
| `js/cloud.js` | **Accounts + cloud saves**: sign up / sign in / sign out / delete account, sync with Firebase, merging a cloud save with this device's save |
| `js/cloud-config.js` | Firebase `apiKey` + `projectId` (public values). Empty = cloud saves off, game works exactly as before |
| `js/main.js` | Boot, game flow, autosave, pause-on-background, crash recovery, service worker registration |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app (PWA) + offline caching. Bump `CACHE` in `sw.js` when you ship changes. |

### Offline gains - Mining drone (new - not in the original design)

- **[DONE]** The drone mines in **real time** into a storage bin, whether the game is open, in the background or fully closed. You collect the bin from the hangar.
- **[DONE]** Exact formulas (code: `js/state.js` > `accrue()` / `droneStatus()`; numbers: `js/data.js` > `DRONE`):

  ```
  rate (cr/hr)   = ratePerHour[droneLevel] x drone multiplier of your best unlocked field (REGIONS[].drone)
  capacity (cr)  = rate x capHours[droneLevel]
  stored         = min(capacity, stored + rate x hoursSinceLastUpdate)
  full in (hrs)  = (capacity - stored) / rate
  stored after H hours away = min(capacity, stored + rate x H)
  ```

  | Drone level | Base rate | Storage time | Upgrade cost |
  | ----------- | --------: | -----------: | -----------: |
  | 1 | 120 cr/hr | 2 h | (start) |
  | 2 | 300 cr/hr | 4 h | 200 |
  | 3 | 600 cr/hr | 6 h | 500 |
  | 4 | 1,100 cr/hr | 8 h | 1,200 |
  | 5 | 1,800 cr/hr | 12 h | 2,800 |

  Field bonus (best field unlocked): Nearside x1, Red Shard x1.5, Glass Moon x2.2, Far Orbit x3.
- **[DONE]** When the rate changes (drone upgrade or new field) the bin is settled first, so time before the change pays the old rate and time after pays the new one.
- **[DONE]** "Know where you'll be when you log on": the hangar drone card shows the live bin (e.g. 140 / 240 cr), **full in Xh Ym (at 9:45 PM)**, and a table of *"If you come back in 1h / 4h / 8h"* with both the drone amount and your **wallet total** at that point. A "How it's calculated" panel shows the formula with your actual numbers.
- **[DONE]** Welcome-back screen shows the math: stored when you left, `hours counted x rate = gained`, storage now, how much time was wasted if the bin filled up, and your wallet after collecting.
- **[DONE]** Clock set backwards earns nothing. Drone credits count toward lifetime credits (field unlocks) when collected.
- **[NEEDS DECISION]** Are these rates right? At Level 1, a full bin (240 cr) is about 1-2 active sorties.
- **[NEEDS DECISION]** Should drone credits count toward field unlocks, or only credits from active play?

### Auto-play controls (added 2026-11-04)

- **[DONE]** Three toggle buttons above MINE/BOOST during a sortie: **FIRE**, **BOOST** and **PILOT**. Each one is AUTO ON or AUTO OFF, saves with your settings, and is also in Settings. Desktop keys: F / B / G. A fourth, **A-EVA** (key J), was added 2026-11-07 (see *Auto EVA*).
- **[DONE]** Auto-fire (on by default): the laser fires by itself at whatever is in range. No need to hold MINE.
- **[DONE]** Auto-boost (off by default): boosts whenever you're moving and have energy. It stops at empty and restarts at 50% energy. Boosting burns more fuel.
- **[DONE]** Autopilot (on by default, only during a sortie): when you stop steering for about half a second and nothing is in range, the ship flies itself to the next block and mines it. It goes to your tapped target first, otherwise it picks the nearest block, favouring valuable ones. It steers around debris and live electrical fields, and picks a new block if it gets stuck. Touch the stick and you're back in control instantly. A green dotted line shows where it's heading.
- **[DONE - Tim, 2026-11-05]** Autopilot parks right next to the block it is mining (about 1.4 block widths away, `AP_CLOSE` in `js/sortie.js`) instead of hanging back at laser range, so the escort wing has more blocks within reach. In a test with 3 drones, the average distance to the target dropped from 146 to 87 units, and 8 blocks broke in 20 s instead of 5.
- **[DECIDED - Tim, 2026-11-04]** Autopilot keeps mining until fuel or time runs out, then the automatic tow-home banks everything. It does not return early on its own.

### Laser heat (changed 2026-11-04 at Tim's request)

- **[DONE]** The laser never maxes out its heat. At **90% heat** it pauses on its own and vents, cools down to **20%**, then **starts mining again automatically**. This works with auto-fire and with holding MINE. The HUD shows "Cooling - resumes in X s".
- **[DONE]** Base: 10 s of heat capacity and 3 heat/s cooling, so about 9 s of firing then about 2.3 s of cooling at Level 1.
- **[DONE]** Easier upgrades. These replace the README table values for these two systems:
  - Mining laser: **+25% power per level** (was +20%), costs **80 / 200 / 450 / 1,000** (were 100 / 250 / 600 / 1,400).
  - Heat sink: **+25% heat capacity and +25% cooling speed per level** (was +15% capacity only), costs **80 / 200 / 450 / 1,000** (were 140 / 340 / 800 / 1,900).
  - The Upgrades screen shows the actual fire time and cool time for your current heat sink.

### Secondary weapons (added 2026-11-04 at Tim's request)

- **[DONE]** New **Weapons** tab in Upgrades. Buy a weapon once, upgrade it to Lv 3 (+30% damage and +1 ammo per level), and pick which one is **equipped**. Ammo restocks free on every launch.
- **[DONE]** During a sortie the orange weapon button (next to BOOST) fires the equipped weapon and shows ammo left. The small swap button cycles between owned weapons. Desktop: Q fire, E swap.
- **[DONE]** Weapon damage goes through block resistance like the laser, and destroyed blocks pay their normal credits.

| Weapon | What it does | Damage | Area | Ammo | Cost (buy / Lv2 / Lv3) |
| ------ | ------------ | -----: | ---- | ---: | ---------------------- |
| Seeker missile | Homes in on your target (or the nearest block), small blast | 45 | 34 radius | 4 | 300 / 600 / 1,200 |
| Space grenade | Lobbed toward the target, bursts after 1 s, big blast. Its blast zone is drawn while in flight | 28 | 74 radius | 3 | 450 / 900 / 1,800 |
| Plasma lance | Instant beam that pierces every block in a straight line | 32 | 380 long | 5 | 600 / 1,200 / 2,400 |
| Shockwave | Pulse around the ship: destroys nearby debris, resets electrical fields to dormant, damages close blocks | 18 | 150 radius | 2 | 350 / 700 / 1,400 |

- **[DONE]** Ammo is full at every launch. **Reloading during a run** works two ways:
  - **Salvage:** every destroyed block adds salvage equal to its material XP (rock 1, iron 2, nickel crystal 3, cobalt 5, glass 6, iridium 8, alloy 12). Every **8 salvage** reloads 1 shot, going to the equipped weapon first and then to any other owned weapon that isn't full. A gold ring around the weapon button shows progress.
  - **Buy:** the gold **+1** button buys one shot of the equipped weapon: missile 30, grenade 40, lance 50, shockwave 35 cr. It is paid from that run's credits first, then your wallet. The sortie summary shows the cost. Desktop: X.
  - Tuning lives in `js/data.js`: `SALVAGE_PER_SHOT` and each weapon's `reload` price.
- **[NEEDS DECISION]** Are 8 salvage per shot and these reload prices right?
- **[TODO]** Ideas for more weapons if you want them: tractor beam (pull loose blocks), mining drone escort (auto-mines beside you), cryo charge (freeze debris).

### Ship automation: auto weapons, ammo and repairs (added 2026-11-06 at Tim's request)

Tim asked for "auto action use" plus upgrades for buying ammo and switching weapons. These are modules in **Upgrades > Weapons > Ship automation** (shown once you own a weapon). Each one has an ON/OFF button after you buy it. Saves from before this change load with nothing bought (`s.auto = { lv: {}, on: {} }`). Tuning lives in `DATA.AUTO` in `js/data.js`.

| Module | What it does | Cost | Levels |
| ------ | ------------ | ---- | ------ |
| Fire-control computer | Fires your weapons by itself when the shot is worth it, switching to whichever owned weapon fits best and away from empty ones (rules below). A **WPN** auto toggle appears next to FIRE/BOOST/PILOT in the sortie (key H). | 500 / 1,200 / 2,800, then x1.5 | No cap. Wait between auto-shots: 3.0 s x 0.8 per level, never under 0.6 s |
| Weapon selector | When your weapon runs dry, switches to one that still has ammo, even with the fire-control computer off (for manual firing). Auto-switches don't change your saved equipped weapon. | 350 | One-time |
| Ammo autoloader | When the weapon is empty (and the selector has nothing loaded to switch to), buys a shot automatically. **Only pays from that sortie's credits, never your wallet.** Each level makes every reload 10% cheaper, manual +1 too. | 400 / 1,000 / 2,400, then x1.5 | No cap (discount compounds: 10%, 19%, 27%...) |
| Ammo racks | +1 starting ammo on every weapon per level. | 300 / 750 / 1,800, then x1.5 | No cap |
| Dock repair crew | Repairs the hull automatically when you return from a sortie, from the wallet (partial repair if short). | 250 | One-time |

- **[DONE]** Fire-control rules (a shot fires when its score is 1 or more; the highest score wins):
  - Seeker missile: the target needs more than 2 s of laser time (score = seconds / 2).
  - Space grenade: 3+ blocks inside the blast where it will land (score = blocks / 3).
  - Plasma lance: 3+ blocks along the beam (score = blocks / 3).
  - Shockwave: debris about to hit you (score 3), an electrical field warming up or live on you (score 2), or 5+ blocks close by.
  - It does not fire during the first-flight tutorial or while you're on a spacewalk.
  - **[FIXED - Tim, 2026-11-06]** Tim saw it never switch weapons. Cause: switching needed the separate Weapon selector. The computer now always weighs every loaded weapon, switches to the best fit (ties go to the one with more ammo), and swaps away from empty weapons on its own. Missile and grenade thresholds were lowered (2 s, 3 blocks) so the other weapons come into play more often.
- **[DONE]** The sortie summary reports auto-shots fired, shots the autoloader bought, and what the dock crew repaired.
- **[DONE]** Tested in a 390x844 phone viewport: an old save loads with no modules; with all modules bought the computer fired 8 shots in 26 s and switched weapons by situation; with every weapon empty the autoloader bought a shot once sortie credits covered it and the wallet stayed untouched; the dock crew repaired 60 hull on return.
- **[NEEDS DECISION]** Prices and the 2 s / 3-block / 3-block thresholds are my first guesses. Should the autoloader be allowed to dip into the wallet (as manual +1 does)? Should ammo racks or the fire-control computer count toward Threat (right now they don't)?
- **[TODO]** Other "auto" ideas if you want them: auto-spacewalk to grab relics, auto-collect the drone bay on launch, auto-return when hull is low.

### Escort wing (added 2026-11-04 at Tim's request)

- **[DONE]** Buy up to **4 escort drones** in **Upgrades > Drones** for 400 / 900 / 1,800 / 3,500 cr. During a sortie they fly around the ship. They work blocks within reach of the ship (190 at base) as a team (see below), fly next to them and mine with their own lasers. Like your laser, they vent heat and resume by themselves. Credits from their blocks go into the run as usual.
- **[DONE]** **Every drone has its own loadout** (Upgrades > Drones, one card per drone). Existing saves carry their old fleet-wide levels over to each drone.
  - Own upgrades, 5 levels each: **Laser** +30% power (250 / 600 / 1,300 / 2,800), **Heat sink** +30% fire time (200 / 500 / 1,100 / 2,400), **Engines** +20% speed and reach (200 / 500 / 1,100 / 2,400). Base: 2.5 dmg/s, fires 4 s then cools 2 s, reach 190. Your base ship laser is 7.5 dmg/s.
  - **Weapon slot** (buy once per drone, then equip freely):
    - Mini-missile pod (500 cr): fires a small seeker at the drone's block every 5 s, 6 per sortie, 22 damage, small blast.
    - Flak gun (400 cr): every 2.5 s shoots down debris that gets within 150 of you or the drone.
    - Pulse charge (600 cr): every 7 s, a 46-radius pulse does 14 damage around the drone's target.
  - **Gear slot:**
    - Shield projector (450 cr): blocks one debris hit on your ship, recharges in 20 s. Several shield drones stack.
    - Relic collector (350 cr): flies out to grab relics near you, so no spacewalk is needed.
    - Overclock (400 cr): +40% drone laser power, but heats up 30% faster.
- **[DONE - Tim, 2026-11-06]** **Drones mine as a team** instead of each grabbing its own block. About 3 times a second the wing makes one plan (`planWing()` in `js/sortie.js`, numbers in `js/data.js` > `WING.team`):
  1. Rank blocks within reach by **value / (seconds to break with the whole team + seconds to fly there)**, with a bonus for blocks already being cut so drones finish what they start.
  2. Walk that list and send the **closest free drones** to each block until it will break within **1.5 s** (`focusSecs`). Your ship laser counts when it is on that block, so drones don't waste time on a block you are about to finish.
  3. Extra drones spill to the next block. Once everything in reach is covered, leftovers join the block that will take longest, so **no drone sits idle** while there is a block in reach.
  - Drones sharing a block fan out around it (on your side), and the blocks the wing is cutting get **green corner brackets**.
  - With aim assist on, your ship's auto-target prefers the block the wing is focusing (your own tapped target is never overridden). Set `WING.team.shipAssist` to `false` to turn that off.
  - Test (headless, same seeded fields, autopilot + auto-fire, 75 s, 5 runs each, credits per sortie, old -> new): Nearside 3 drones 357 -> 363 (+2%), Nearside 6 drones 528 -> 611 (+16%), Red Shard 4 drones 230 -> 274 (+19%), Glass Moon 8 drones 548 -> 1,699 (about 3x). Idle drone time dropped from 3-27% to about 2%. The gain grows with drone count and block hardness; with few drones in a soft field the old way was already near the limit.
  - No save changes.
- **[NEEDS DECISION]** The offline drone bay rate does not include this teamwork boost (still +15% per drone). Should teamwork raise it, or keep offline gains as they are?
- **[DONE]** Every escort drone you own also adds **+15% to the offline drone bay rate**. It's included in the "How it's calculated" panel.
- **[DECIDED - Tim, 2026-11-04]** Drones get their own equipment and weapons (per-drone loadouts above).
- **[NEEDS DECISION]** Module prices and cooldowns are first guesses.

### Spacewalk / EVA (added 2026-11-04 at Tim's request)

- **[DONE]** Tap **EVA** (gold button with the auto toggles, desktop V) to leave the ship on a 260-unit tether. The ship parks, the stick now moves the miner, and your escort drones keep mining.
- **[DONE]** **Hand drill** with short range. It **ignores block resistance**, so it is better than the base laser on cobalt, iridium and alloy. It uses MINE or auto-fire.
- **[DONE]** **Relics:** 4 glowing pickups per field, only collectable on foot. They're worth 60 / 140 / 240 / 380 cr (±30%) by field, plus 10 XP each, and are listed in the summary.
- **[DONE]** **Oxygen** (30 s base) is shown as an O2 bar. Debris hits cost 6 s of oxygen and active electrical fields drain it. The hull is never hurt on a spacewalk. At empty oxygen the tether reels you back automatically. Tap EVA again to reel back early. Oxygen refills while you're aboard.
- **[DONE]** New miner upgrades (Upgrades > Miner): **EVA mobility** (+15% speed), **Oxygen tank** (+25% oxygen), **Hand drill** (+30% drill power).
- **[DONE]** Giant hollow rocks give the spacewalk its main job: the core can only be drilled out from inside (see *Giant hollow rocks* below). New miner upgrade: **Wide drill head**.
- **[TODO]** Discovery contracts for relics, and boarding/repair events for the reinforced suit.

### No level caps (added 2026-11-04 at Tim's request)

- **[DONE]** Every upgrade can be bought forever: all 8 shuttle systems, all miner gear, the offline drone bay, secondary weapons and each escort drone's laser, heat sink and engines. The pips fill every 5 levels and the level number keeps counting.
- **[DONE]** Price formula: the listed prices are used first. After that, each level costs **1.5x the previous one**, rounded to a tidy number. Example for the mining laser: 80, 200, 450, 1,000, then 1,500, 2,300, 3,400, 5,100, 7,600, 11,000, 17,000, 26,000 and so on. The knob is `UPGRADE_GROWTH` in `js/data.js`.
- **[DONE]** Effects keep stacking linearly, e.g. laser +25% per level means Lv 13 = 30 dmg/s at Rank 1 (4x the start), before the separate rank bonus.
- **[DONE]** Two stats approach 100% instead of breaking it: **Repair training** is -8% compounding (Lv 16 = -71%), and **Reinforced suit** goes 75%, 80%, 84%... toward 100%, with a 95% limit on emergency payouts.
- **[DONE]** Offline drone bay past Lv 5: rate x1.5 per level, storage +2 h per level up to a 24 h maximum.
- **[DONE]** Escort wing raised from 4 to **8 drones** (6,000 / 10,000 / 16,000 / 25,000 for drones 5-8).
- **[DONE]** Decided by Tim: fields now get tougher and richer as the ship grows (see Threat scaling below).

### Threat scaling (added 2026-11-04 at Tim's request)

- **[DONE]** Every field now has a **Threat level** that rises with your ship's power. It is shown in the Fields tab, on the hangar launch card and in the sortie header.
- **[DONE]** Formula: `power = laser multiplier + 0.5 x (escort drone dps / base laser dps) + 0.1 x total weapon levels`, and `threat = max(1, power)`.
- **[DONE]** What scales: block health x threat^0.4, credits per block x threat^0.95, debris and electrical damage x threat^0.5, debris speed up to 1.8x, and +1 debris per doubling of threat. Relics and contract rewards also pay x threat^0.95.
- **[DONE]** The base laser deals 7.5 damage/s. Block health grows more slowly than laser power: with only a Lv 15 laser, Nearside blocks have about 1.8x health but the laser has 4.5x power, so the same material takes about 41% as long to mine and pays about 4.2x as much.
- **[DONE]** Every launch generates a fresh layout, with larger irregular clusters and more mineable blocks. The dock stays clear and the tutorial retains its damaged starter block.
- **[DONE]** Knobs: `THREAT` in `js/data.js` (`hp`, `value`, `hazard` exponents).
- **[NEEDS DECISION]** Should the offline drone bay also scale with threat? Right now it does not, so offline income stays modest.

### Auto-advance on a cleared field (added 2026-11-06 at Tim's request)

- [DONE] Break every block in the field before the sortie timer runs out and the run automatically warps to the **next world**: the next unlocked region after the one you are in (in the unlock order listed under *More fields* below). The remaining time, fuel, hull, ammo and credits carry over (plus the clear bonus below); the ship and wing reappear at the dock of a fresh field. A caption and chime announce it.
- [DONE] If there is no further unlocked region, you warp into a fresh field of the same region, so clearing is never wasted.
- [DONE] The hangar's selected region follows you, so your next launch starts in the world you reached.
- [DONE] The sortie summary shows how many fields you cleared and where you ended up; every region you mined in pays its first-survey bonus. Contracts still score against the region you launched into.
- [DONE] If you are out on a spacewalk when the last block breaks, the warp waits until the miner is back aboard.
- [DONE] **Field-clear bonus** (Tim: "it should pay a bonus and be valuable"). Tunables in `DATA.CLEAR` (`js/data.js`):
  - payout = credits mined in that field x (100% + 1% per second left on the clock) x streak, + 50% of the region's first-survey bonus (scaled by Threat)
  - streak: the 2nd field cleared in one sortie pays x1.5, the 3rd x2, and so on
  - also +45 s on the clock, half a tank of fuel back, and 40 XP x region tier
  - the bonus is banked safely: an emergency (hull) return never cuts it
  - example at Threat 1: a full Nearside field is about 7,300 cr, so clearing it with 60 s left pays about 11,700 cr on top. Red Shard is about 24,000 cr per field, Glass Moon 47,000, Far Orbit 116,000.
- **[NEEDS DECISION]** Are these numbers right? And should clearing a field also unlock the next region early? Right now it only advances to regions you have already unlocked.

### More fields: 13 worlds with their own hazards (added 2026-11-07 at Tim's request)

Tim: "lets get a bunch more fields to play with different things in them". There are now **13 fields** (9 new), each with its own rock layout, materials and hazards. Everything is tunable in `js/data.js` > `REGIONS` and `MATERIALS`; the mechanics are in `js/sortie.js` > `generate()` and `updateHazards()`. Fields unlock in this order, and a field clear warps you along it.

| Field | Unlock | What's different |
| ----- | ------ | ---------------- |
| Nearside Belt | start | unchanged |
| **Comet Wake** (new) | 1,000 cr, Laser 1 | long ore **seams** of comet ice; a **solar wind** current drags the ship; **ice refuels** you |
| Red Shard Field | 2,500 cr, Laser 2 | unchanged |
| **Scrapyard Drift** (new) | 5,000 cr, Laser 2 | hundreds of **small scattered rocks**; **scavenger drones** fly around eating blocks. The laser locks onto them first; kill one for a bounty (missiles, grenades, mines and drone flak hit them too) |
| Glass Moon | 8,000 cr, Laser 3 | unchanged |
| **Ember Reach** (new) | 12,000 cr, Laser 3 | **volatile ore** explodes when it breaks and sets off its neighbours (chain reactions); **solar flares** every ~24 s make the laser run hot and burn the hull unless a rock is above you ("shaded" shows on screen) |
| **Veil Nebula** (new) | 16,000 cr, Laser 3 | **fog**: you only see ~250 units around the ship; hidden **proximity mines**; **plasma pearls** refill boost and dump half your laser heat |
| Far Orbit | 22,000 cr, Laser 4 | unchanged |
| **Singularity Edge** (new) | 35,000 cr, Laser 5 | **gravity wells** pull you in and crush the hull at the core; rock **rings** orbit them with **star gold** on the inner edge; **void stone** armour |
| **Living Reef** (new) | 55,000 cr, Laser 5 | **geodes**: a shell of **living coral** (regrows if you stop cutting) around a rich gold/alloy centre; scavengers; electrical fields |
| **Old Warfront** (new) | 80,000 cr, Laser 6 | **barricade walls** of void stone across the field with gaps; alloy pockets between them; lots of mines |
| **Corona Shelf** (new) | 120,000 cr, Laser 7 | seams packed with gold and volatile ore, strong swinging solar wind, frequent flares |
| **Void Rift** (new) | 200,000 cr, Laser 8 | everything at once: fog, gravity wells, mines and scavengers around void-stone geodes full of alloy |

- [DONE] New materials: Comet ice (refuels), Volatile ore (explodes), Plasma pearl (energy + cools laser), Living coral (regrows), Void stone (armour: 3.5x resistance, cheap; blast it, drill it on a spacewalk, or go around), Star gold (190 cr, between iridium and alloy). Each has its own glyph so they don't rely on colour.
- [DONE] New hazards and their counters: shockwave disarms mines in its radius and any explosion sets mines off early; autopilot steers around mines and well cores; a wing shield blocks a mine blast.
- [DONE] The Fields screen lists each field's features in plain words (material notes stay hidden until you discover that material or unlock the field), plus its drone-bay multiplier.
- [DONE] Offline drone bay: each field now carries its own multiplier (`drone` in `REGIONS`, replaces `DRONE.regionMult`). Old fields keep x1 / x1.5 / x2.2 / x3; new ones go Comet x1.2 ... Void Rift x7.5.
- [DONE] Relic value is per field (`relic` in `REGIONS`).
- [DONE] Tests: every field is played for a minute on autopilot without errors; scavengers, volatile chains, ice refuel and coral regrowth each have a test (`node --test tests/`).
- **[NEEDS DECISION]** Unlock costs and Laser levels for the late fields (35k to 200k lifetime, Laser 5 to 8) are my guesses. Without drones or weapons, late fields are slow (an alloy block takes ~60 s at the recommended laser), so the wing and weapons matter there. Tell me if you want them faster.
- **[NEEDS DECISION]** Existing saves with enough lifetime credits will unlock Comet Wake, Scrapyard Drift and so on right away, and auto-advance now steps through them (e.g. Nearside > Comet Wake > Red Shard). OK, or should new fields only unlock going forward?

### Giant hollow rocks: EVA in and mine from the inside (added 2026-11-07 at Tim's request)

Tim: "a larger block ... you have to EVA and enter it ... hollow it out from the inside out before your ship can break it on the outside. Decent rewards, but more reasons to level up your miner and then actually use the miner."

- **[DONE]** Every field (not the tutorial) now has a **giant rock**: a 6x6-cell rock (7x7 from Singularity Edge on, and **two** of them from Living Reef on). It sits in its own clearing, at least 520 units from the hangar, with a 2-cell gap around it so the ship can park. It's labelled **GIANT ROCK - hollowed 0/16** with a dashed outline.
- **[DONE]** **The ship can't hurt it at first.** The laser, weapons, escort drones and scavengers ignore it, and aim assist and autopilot skip it. Tapping it shows a hint. The ship bumps off it like any other rock.
- **[DONE]** **The way in is a gold hatch** on one side, usually the side facing the hangar. A pulsing arrow and **EVA IN** mark it. Only the miner fits through it: the ship can't enter. Coming near the rock for the first time shows a one-time caption.
- **[DONE]** **Hollow it from inside:** park at the hatch, tap **EVA**, float through the hatch and drill out every **core cell** with the hand drill. Core cells are made of the field's rich core ore and each one pays when it breaks. The hand drill can't cut the closed shell from outside, so you have to go in. The dug-out cave shows dark. Each cell shows a "hollowed 5/16" caption.
- **[DONE]** **Shelter inside:** debris and electrical fields can't reach the miner inside the rock, but oxygen still runs down. It refills aboard, so a bigger rock usually takes 2 or 3 trips at base gear.
- **[DONE]** **Break the shell:** when the last core cell breaks, the shell turns weak. It gets glowing orange seams, the label changes to **BREAK THE SHELL +jackpot**, and the hatch seals into ordinary shell. Now the ship's laser, weapons and wing can break it, and the shell cells count toward clearing the field. Breaking the last shell cell **cracks the giant** and pays the **jackpot**, with a big burst and +30 XP x field tier.
- **[DONE]** Auto-advance waits while you have a giant **started but not cracked**, so a field clear can't warp you away halfway through. A giant you never touch doesn't block the clear.
- **[DONE]** The sortie summary shows **Giant rocks cracked xN (jackpot)**. The Fields screen lists the giant rock as a feature. The Miner upgrades tab explains it.
- **[DONE]** **New miner upgrade: Wide drill head** (Upgrades > Miner, 300 / 750 / 1,600 / 3,400 cr, then x1.5). The hand drill also cuts the 4 cells next to its target at 25% of its power per level (max 100%). It works on normal blocks too.
- **[DONE]** **Why level the miner now:** core cells get tougher in later fields and with Threat, but the drill doesn't count toward Threat. So **Hand drill**, **Wide drill head**, **Oxygen tank**, **EVA mobility** and miner rank all directly shorten the dig.
- **Numbers at Threat 1** (all in `DATA.GIANT` in `js/data.js`; the code is in `js/sortie.js` > `placeGiants()`, `giantCellGone()`, `openGiant()`, `crackGiant()`, `drawGiants()`):

| Field | Giants | Size | HP per core cell | Drill time, base drill | Drill Lv 4 + wide head Lv 3 (approx.) | Pays per giant (core + shell + jackpot) |
| ----- | ------ | ---- | ---------------- | ---------------------- | -------------------------------- | ---------------------------------------- |
| Nearside Belt | 1 | 6x6, 16 core cells | 16 | 43 s | 15 s | 2,652 (jackpot 1,500) |
| Comet Wake | 1 | 6x6, 16 core cells | 22 | 58 s | 20 s | 3,978 (jackpot 2,250) |
| Red Shard Field | 1 | 6x6, 16 core cells | 27 | 73 s | 25 s | 6,188 (jackpot 3,500) |
| Scrapyard Drift | 1 | 6x6, 16 core cells | 33 | 87 s | 31 s | 8,398 (jackpot 4,750) |
| Glass Moon | 1 | 6x6, 16 core cells | 38 | 102 s | 36 s | 10,608 (jackpot 6,000) |
| Ember Reach | 1 | 6x6, 16 core cells | 44 | 117 s | 41 s | 12,818 (jackpot 7,250) |
| Veil Nebula | 1 | 6x6, 16 core cells | 50 | 132 s | 46 s | 14,586 (jackpot 8,250) |
| Far Orbit | 1 | 6x6, 16 core cells | 55 | 147 s | 52 s | 16,796 (jackpot 9,500) |
| Singularity Edge | 1 | 7x7, 25 core cells | 61 | 253 s | 89 s | 25,440 (jackpot 12,000) |
| Living Reef | 2 | 7x7, 25 core cells | 66 | 277 s | 97 s | 31,800 (jackpot 15,000) |
| Old Warfront | 2 | 7x7, 25 core cells | 72 | 300 s | 105 s | 39,750 (jackpot 18,750) |
| Corona Shelf | 2 | 7x7, 25 core cells | 78 | 323 s | 113 s | 50,350 (jackpot 23,750) |
| Void Rift | 2 | 7x7, 25 core cells | 83 | 347 s | 122 s | 63,600 (jackpot 30,000) |

  Drill time is drilling only; floating in and the oxygen trips add to it. For scale, a whole Nearside field is about 7,300 cr, so one Nearside giant is worth about a third of a field. Shell cells have 14 HP x the same tier factor and resistance 1, so the ship sweeps the open shell quickly. The jackpot is 25x the field's relic value; credits and HP also scale with Threat.
- **[DONE]** Tests: every field except the tutorial gets its giant(s) with one hatch, solid cells and a safe distance from the dock. Ship damage and the drill on the closed shell do nothing. Drilling the core opens the shell and adds it to the field count. The real laser breaks the last cell and pays the jackpot. The miner walks in through the hatch while the ship can't, and the wide drill head caps at 100% (`node --test tests/*.test.js`, 17 tests pass). Also played in Chromium at phone size with no console errors.
- **[DONE]** Existing tests adjusted: giant cells aren't counted in `w.left` until the shell opens. The "every field plays for a minute" test now runs 70 s, because Corona Shelf on that seed spent the whole minute on one alloy block (slow on purpose, not a bug).
- **[NEEDS DECISION]** **Late-field dig time.** From Singularity Edge on, a giant takes longer to drill than a whole 3-minute sortie with a base drill, and progress doesn't carry over to the next sortie (fields are new every launch). That pushes drill upgrades hard, which is the point, but it may feel like a wall. Options: keep it, lower `tierHp` (0.35), or let a half-dug giant persist for the next launch.
- **[NEEDS DECISION]** **Rewards:** are ~1/3 of a field's value per giant (Nearside) and the jackpot sizes right? Should a cracked giant also drop a guaranteed relic, or count toward contracts (e.g. a "Crack a giant rock" contract)?
- **[DONE - Tim, 2026-11-07]** Autopilot now parks at the hatch and the miner goes in on its own when **Auto EVA** is on (see *Auto EVA* below). With Auto EVA off it is still fully manual.
- **[TODO]** Sound: it reuses the existing chimes and booms; no dedicated "shell opens" sound yet.

### Auto EVA (added 2026-11-07 at Tim's request)

Tim: "Let's add an automatic EVA system, just like we have autopilot, auto weapon... Let's also add an auto EVA."

- **[DONE]** New **A-EVA** toggle with the other auto buttons (FIRE / BOOST / PILOT / WPN), also in Settings as *Auto EVA*. Desktop key **J**. It is a free setting like autopilot, **on by default** (existing saves get it switched on too).
- **[DONE]** Like autopilot, it only acts when you are not steering (about half a second hands-off). Touch the stick during a spacewalk and you drive the miner; let go and the auto EVA picks up again. Tapping EVA yourself still works as before (a spacewalk you start by hand stays manual).
- **[DONE]** **Giant rocks:** with autopilot on, the ship flies to the nearest giant that still needs hollowing and parks just outside its gold hatch. With a full oxygen tank the miner goes out, lines up with the hatch, walks in and drills the nearest core cell, cell after cell. It reels home with enough oxygen to get back (no low-oxygen alarm), the ship waits at the hatch while the tank refills (~15 s), and it goes back in. Once the core is gone the miner boards and autopilot breaks the shell for the jackpot. The ship laser keeps firing at anything in range while it waits.
- **[DONE]** It skips a giant it can't finish in the time left (estimated from your drill power, with time for refills), so a late-field giant doesn't eat the whole sortie. A giant you have already started is always finished if there's time.
- **[DONE]** **Relics:** when the ship is idle and a relic is within tether reach (220 units), the miner goes out to fetch it, then any other relic in reach, and comes back. Relics an escort collector drone is already fetching are left to the drone. If it can't reach a relic on one tank, or walks into a wall for 2 s, it gives up on that relic for the rest of the field.
- **[DONE]** On the walk it sidesteps debris, drills anything in reach automatically (even with auto-fire off), and comes home with 4 s left on the shift clock.
- **[DONE]** Toggle bar buttons are a little narrower (min 48 px) so all six fit on a 360 px phone. Checked in Chromium at 360x740.
- **[DONE]** Tests: autopilot + auto EVA parks at a giant, goes in through the hatch, hollows it over more than one tank and then the ship cracks it; it fetches a relic and comes back aboard; with it off the miner never leaves; every field plays two minutes with it on, no errors. The other tests run with auto EVA off so they still see the ship on its own. `node --test tests/` 29 pass. Service worker cache bumped to v23.
- **[DONE - fix, Tim 2026-11-07: "doesn't seem to be working quite right"]** The first version flew in a straight line to the giant and ground against every block in the way, so on most fields the ship sat still for most of the sortie and never arrived (base ship: 0 of 12 test runs on Nearside/Comet/Red Shard/Scrapyard reached the giant, ~450 cr per sortie). Now autopilot plans the cheapest route (open space costs flying time, a block costs the time the laser needs to cut it) and lasers through only what is on that route. Same test runs: all 12 reach the giant in 10-30 s (one in 64 s), all 12 hollow it, and sorties earn ~2,500-4,300 cr. Also: once a giant is hollow, autopilot goes straight for its shell (jackpot) instead of wandering off; the miner now heads home with ~5 s of oxygen spare so the low-oxygen alarm no longer fires on auto; and a relic it can't reach says "relic blocked by rock" instead of "all relics collected".
- **[TODO]** On Red Shard / Scrapyard with a base drill the giant opens at ~2:25, too late to break the shell before the timer. The "can I finish this?" check only counts drilling time, not breaking the shell.
- **[NEEDS DECISION]** **Free or bought?** I made it a free setting like autopilot. It could instead be a module you buy (e.g. an "EVA suit computer" in Upgrades > Miner) if you want another reason to spend credits. Say which.
- **[NEEDS DECISION]** **On by default?** It is on for everyone, including existing saves. Relic runs pause the ship for a few seconds while the miner is out. Turn it off by default instead?

### Auto upgrade (added 2026-11-07 at Tim's request)

Tim: "So as they're getting money and collecting things, they can turn on auto upgrade and the game will choose what to upgrade for them and will automatically do it. It can be a lot like the autopilot feature. It's just turned on and it does all auto upgrades, or they can turn it off."

- **[DONE]** On/off switch at the top of the **Upgrades** screen (shows what it will buy next) and in **Settings** as *Auto upgrade*. Free setting like autopilot, saved as `settings.autoUpgrade`.
- **[DONE]** While it is on, the hangar checks every second and buys whatever it can afford: after a sortie, after collecting the drone, after the welcome-back payout. Never during a sortie (sortie credits are only banked when you dock anyway). A toast lists what it bought, e.g. "Auto upgrade: Mining laser Lv 3, Heat sink Lv 3 +10 more (-2,400 cr)".
- **[DONE]** **How it chooses:** each upgrade gets a score = next price x a weight; it buys the lowest score first. Lower weight = favoured: laser and heat sink 1, drone bay 0.9, thrusters/fuel/hull 1.2, ... repair training 2, reinforced suit 2.2. So money spreads over everything, leaning toward what makes runs pay. If the top pick is too dear it saves up for it, but still buys anything costing a quarter of it or less. All weights are in `DATA.AUTO_UPGRADE` (`js/data.js`).
- **[DONE]** It always keeps enough credits to fully repair the hull.
- **[DONE]** It levels what you already have: Shuttle, Miner, drone bay, ship weapons & systems (fitting one counts), each escort drone's lasers/heat sinks/engines, owned secondary weapons and owned automation modules. It skips Wide beam, Split beam and Wide drill head once they reach 100% (more levels do nothing).
- **[DONE]** Tests: off by default and buys nothing while off; spends across several upgrades and keeps repair money; never buys new drones/weapons/modules but levels owned ones; stops at capped side cuts. `node --test tests/` 32 pass. Checked in Chromium at 360x740 (no errors). Service worker cache bumped to v25.
- **[NEEDS DECISION]** **New purchases:** it never buys a new escort drone, a new secondary weapon, a new automation module or a drone module (those felt like your choices and are big spends). Should it buy those too?
- **[NEEDS DECISION]** **Off by default** (spending is not undoable). Turn it on by default for new players instead? And are the weights right (e.g. should it favour the drone bay more for offline gains)?

### Ship weapons & systems: wide beam, miniguns, sentries and more (added 2026-11-07 at Tim's request)

Tim: "a widening of the laser, kind of like the miner has the widening ... some miniguns, some sentries, about 5 or 6 new upgrades to the ship that will make it even better and stronger."

Six new shuttle upgrades in a new **Ship weapons & systems** section under Upgrades > Shuttle. They are always on: no ammo and no button. Level 1 means "not fitted", so the first purchase fits the part. Like every upgrade, they have no level cap (the listed prices, then x1.5 per level).

| Upgrade | Prices (fit, Lv 3, Lv 4, Lv 5) | What it does |
| ------- | ------------------------------ | ------------ |
| **Wide beam** | 250 / 600 / 1,300 / 2,800 | The ship's version of the Wide drill head. While the laser fires, it also burns the 4 blocks next to its target at 25% of laser power per level (max 100%). Glowing side beams show it. |
| **Split beam** | 400 / 900 / 1,900 / 4,000 | A second pink beam locks the nearest *other* block in lock range at 25% of laser power per level (max 100%). Only the main beam makes heat. |
| **Twin miniguns** | 350 / 800 / 1,700 / 3,600 | 3 dmg/s (+50% per level after the first), x rank power. They fire with FIRE, **never overheat** (they keep going while the laser vents), and shoot scavengers first, then the laser's target, then the nearest block. Range is 90% of lock range. Gun barrels show on the ship. |
| **Sentry turrets** | 500 / 1,100 / 2,300 / 4,800 | One sentry per level bought. While you mine, the ship drops a sentry where it is (at most one every 3 s, not on top of another). Once all are out, a sentry with nothing in reach jumps to the ship instead. Each one mines or shoots scavengers within 130 units at 2.5 dmg/s (+25% per level after the first) x rank power. **Guard duty:** each sentry also shoots down an incoming asteroid within 200 units every 3 s (x0.9 per level after the first), the one closest to the miner or ship first. On a spacewalk they guard the miner: they deploy beside it, and the farthest one hops over as the miner moves on. |
| **Point defence** | 300 / 700 / 1,500 / 3,200 | Zaps the nearest debris rock within 125 units of the ship, every 7 s (x0.85 per level after the first). |
| **Deflector shield** | 450 / 1,000 / 2,100 / 4,400 | Absorbs one debris or mine hit, then recharges in 30 s (x0.85 per level after the first). A faint purple bubble shows when it's charged. It goes before the drone shield projectors, so they stack. |

- **[DONE]** All numbers are in `DATA.SHIP_GEAR` (plus the price rows in `DATA.SHUTTLE`, flagged `gear: true`) in `js/data.js`. Stats are in `SM.State.stats()` > `gearStats()`. The sortie code is `laserExtras()`, `updateShipGear()` and `drawShipGear()` in `js/sortie.js`. The deflector hooks into `shieldBlock()`.
- **[DONE]** Giant rocks still work: the beams, guns and sentries can't hurt a closed giant shell or its core, just like the laser.
- **[DONE]** **Threat:** the damage upgrades count toward Threat at half weight, the way the escort wing does. Side burn and sentries count half again, because not every target has 4 neighbours and sentries sit still. Point defence and the deflector don't count. Fully kitting a ship therefore makes fields a bit tougher and richer, as it does for the laser.
- **[DONE]** Sentries are left behind when a cleared field warps you to the next one, and the ship drops new ones there.
- **[DONE]** **Sentries shoot asteroids and protect the miner** (Tim, 2026-11-07: "need to shoot asteroids that are flying in and help protect the miner"). Numbers are `flakRange`, `flakCd` and `flakShrink` in `DATA.SHIP_GEAR.sentry`. Tested: a sentry shoots down an asteroid heading for the ship, one deploys beside the miner on a spacewalk, and it shoots down an asteroid heading for the miner (33 tests pass).
- **[DONE]** Tests: nothing works at level 1, the caps hold, and Threat rises. The wide beam hurts all 4 neighbours, the split beam cuts a second block, and the miniguns cut while the laser vents. Sentries deploy up to level-1 and break blocks by themselves. Point defence zaps debris, the deflector blocks one hit and then lets the next one through, and every field plays 25 s with all gear at Lv 5 (`node --test tests/*.test.js`, 25 tests pass). I also played it in Chromium at phone size with no game errors.
- **[NEEDS DECISION]** **Prices and power:** the prices are mine, placed between the base shuttle upgrades and the escort wing. The miniguns at Lv 2 add about 40% of a base laser, which is strong early. Should these unlock by rank or field instead of being available from the start?
- **[NEEDS DECISION]** **Sentry behaviour:** sentries drop by themselves wherever you mine. Would you rather have a button to place them by hand, or have them follow the ship like the escort wing?
- **[TODO]** Dedicated sounds for the miniguns and sentries (they reuse the existing hit and click sounds for now).
- **[TODO]** The hangar ship preview doesn't show the new parts yet; only the in-sortie ship has gun barrels.

### Daily and weekly orders (added 2026-11-07 at Tim's request)

- **[DONE]** **Contracts** tab now starts with **Orders**: 3 daily orders (new at local midnight) and 3 weekly orders (new on Monday). No accepting: progress counts on every sortie. Hangar card shows "Daily orders 2 / 3 done - streak 3 days - new in 5h".
- **[DONE]** Order kinds: break N blocks, bank N cr from sorties, break N of a material from your fields, fly N sorties, recover N relics, collect N cr from the drone bay; plus shoot scavengers (once you have a scavenger field), clear a field / crack a giant (once you have done it once), and find a rare event (weekly only). Sizes scale with your best field; weekly = about 6x a daily.
- **[DONE]** Rewards: credits = `120 x (1 + field tier) x Threat value x kind weight` (weekly x6), XP, and **stars** (1 per daily, 4 per weekly). All three dailies = bonus (one order's credits + 3 stars); all three weeklies = bonus (2x + 10 stars). Stars are for cosmetics.
- **[DONE]** **Streak:** finishing all three dailies on days in a row raises daily rewards by 10% per day (up to +70%). Missing a day resets it.
- **[DONE]** Rewards show in the sortie summary (and as a toast when the drone bay finishes one). Lifetime counters behind this (blocks, materials, relics, giants, scavengers, clears, per-field runs/best) are in `s.meta` and also drive achievements and the collection log. Older saves start their counters from the stats they already had.
- Code: `js/meta.js` (orders, counters), numbers in `DATA.ORDERS` (`js/data.js`). Tests: order generation and reset, payment once, streak, old-save migration.
- **[NEEDS DECISION]** Reward sizes and the streak bonus are my guesses. Should missing a day keep part of the streak instead of resetting it?

### Rebirth / prestige (added 2026-11-07 at Tim's request)

- **[DONE]** New **Career** tab (star icon) with a **Rebirth** page. Once you have earned **25,000 cr lifetime** you can start over for **core shards**: `shards = floor(sqrt(lifetime credits this life / 25,000))` (25k = 1, 100k = 2, 225k = 3, 1M = 6, 4M = 12).
- **[DONE]** Every core shard you own gives **+10% to all credits** (blocks, relics, bounties, clear bonus, giant jackpots, contracts, orders - it rides on Threat value) and **+10% to the drone bay**. Shown on the Rebirth page and in the drone bay's "How it's calculated".
- **[DONE]** Resets: wallet, upgrades, drone bay level, fields (back to Nearside), escort drones, weapons, automation modules, active contracts, first-survey bonuses (paid again). The drone bay is collected first. Keeps: rank/XP, stars, cosmetics, orders and streak, achievements, collection log, settings, account. Lifetime credits of earlier lives are kept as `prestige.allTime` (used by the leaderboard).
- **[DONE]** Confirmation dialog shows the gain; a gold dot on Career when your first rebirth is available. Tunables in `DATA.PRESTIGE`. Test: reset/keep lists, +20% block values and drone rate after 2 shards, save round trip.
- **[NEEDS DECISION]** Keeping **rank** across rebirths (rank adds laser power, so the second life starts a bit stronger). Reset rank too? And is 25k the right first rebirth point (about when Scrapyard / Glass Moon open)?

### Achievements and collection log (added 2026-11-07 at Tim's request)

- **[DONE]** **Career > Awards**: 16 achievement ladders, 49 rungs in all (e.g. Rock breaker I-IV: break 100 / 1k / 10k / 100k blocks; Prospector: earn 10k ... 10M cr over all lives; Giant slayer, Pest control, Clean sweep, Contractor, Daily grind, Clockwork (daily streak), Veteran (rank), Explorer (fields), Geologist (materials), Idle tycoon (drone bay), Born again (rebirths)). Each rung pays stars: 2 / 5 / 10 / 20 by rung. Shows the next rung of each ladder with a progress bar, plus the latest ones earned.
- **[DONE]** New achievements appear in the sortie summary, as a toast in the hangar (drone bay, rebirth, auto upgrade), and put a gold dot on the Career tab until you look.
- **[DONE]** **Career > Log** (collection log): all 14 materials (count broken, or ??? until found), every field (runs, best sortie, times cleared, ??? while locked), and lifetime records (sorties, blocks, credits, relics, giants, scavengers, contracts, orders, streak, drone bay, rebirths).
- Ladders and goals are in `DATA.ACHIEVEMENTS` / `DATA.STARS_BY_RUNG`; code in `js/meta.js`. Achievements are earned once and survive a rebirth. Test: unlock from counters, rank and fields, paid once, unseen dot count.
- **[NEEDS DECISION]** Should achievements also pay credits, or only stars (as now)?

### Rare sortie events (added 2026-11-07 at Tim's request)

- **[DONE]** About **30%** of fields (each launch, and each warp after a clear) get one rare event, 15-45 s in. Never in the tutorial.
  - **Comet:** streaks across the field once. Laser (or guns, missiles) it before it leaves: pays 6x the field's relic value and refuels 25%. If it gets away, it's missed.
  - **Derelict ship:** a wreck drifts into open space nearby with **4 salvage crates** (2.5x relic value each). Only the miner can grab them on a spacewalk (escort relic collectors leave them alone).
  - **Scavenger mothership** (Red Shard and later): 14x a scavenger's health, eats blocks fast, launches a scavenger every 12 s (up to 3), and every 8 s charges a pulse (1.2 s red warning ring) that hits a ship within 110 for 14 x hazard. Bounty 15x relic value.
- **[DONE]** **Autopilot copes:** it chases a comet (leading its path), cuts a route through rock to the mothership (same route planner as giant rocks) and then holds just outside its pulse range while firing, and - with **Auto EVA** on - parks by a derelict so the miner fetches every crate by itself.
- **[DONE]** Events show in the sortie summary (destroyed / salvaged with credits, or "got away"), count for the weekly "Find a rare event" order and the **Storm chaser** achievement, and are listed under **Career > Log > Rare finds**.
- Numbers in `DATA.EVENTS`. Tests: comet shot and paid / escapes; derelict salvaged by autopilot + auto EVA; mothership launches drones and is taken down on autopilot; roll chances, no tutorial events, mothership only from Red Shard; every field x every event plays without errors.
- **[NEEDS DECISION]** 30% chance and the rewards are guesses. Should events be rarer but bigger, and should the mothership drop something special (e.g. stars)?

### Accounts and cloud saves (added 2026-11-05 at Tim's request)

Players can make an account (email + password), sign in on any phone or computer, and get their credits, ship, upgrades, drones, weapons, contracts and rank back.

- [DONE] **Backend: Firebase** (free Spark plan). Chosen over Supabase because free Supabase projects pause after a week with no traffic, which would break sign-in for a small game. Firebase Auth does the accounts; Cloud Firestore holds one save per player at `saves/{uid}`.
- [DONE] Called over Firebase's plain REST APIs, no SDK download. The game still boots and plays fully offline; the cloud is a copy, the save on the device is always written first.
- [DONE] Sign up, sign in, forgot password (email reset link), sign out (keep progress on this device), sign out and clear this device, delete account. Cloud button in the top bar (green = signed in, red = sync problem, gold dot = not signed in yet). Also under Settings.
- [DONE] Hangar card "Keep your progress - Sign up" appears after the first sortie for players without an account. Signing up uploads the progress they already have.
- [DONE] **When it syncs:** after every sortie, about every 30s while there is new progress, when the app goes to the background, when the connection comes back, and a check every 5 min for progress made on another device. An idle phone never uploads (the check ignores the drone timer and timestamps).
- [DONE] **Merging a cloud save with a device save:**
  - New device / no progress yet: takes the cloud save automatically.
  - Only one side changed since the last sync: that side wins automatically (play on phone, then open on PC = PC gets the phone's progress).
  - Both changed (played offline on two devices, or signed into an account on a device that already had its own progress): the player picks, with credits / rank / upgrades / sorties / lifetime earnings shown side by side. The one further along is highlighted.
  - Every upload is conditional on the cloud copy being the version this device last saw, so two devices can never silently overwrite each other.
- [DONE] The drone bay keeps earning across devices (its timer travels with the save).
- [DONE] Tested against a mock Firebase in a headless phone browser: sign up, wrong password, new device adopts cloud save, progress moves between two devices both ways, conflict prompt, offline play then upload on reconnect, stays signed in after reload, sign out and clear. Tested against the real Firebase project on 2026-11-06 (sign up, save, load, another player's save refused, delete account).
- [TODO] Google / Apple sign-in buttons (email + password only for now). Easy to add on Firebase if you want them.
- [TODO] Leaderboards (the save document already stores `credits` and `rank` as fields, so this is a small step later).

**[DONE] Firebase setup** (Tim did this 2026-11-06; project `solo-miner-2daec`, keys in `js/cloud-config.js`). Steps kept here in case it ever needs redoing:
1. Go to https://console.firebase.google.com, **Add project**, name it e.g. `solo-miner`. Google Analytics is optional (off is fine).
2. **Build > Authentication > Get started > Sign-in method > Email/Password > Enable** (leave "Email link" off). Save.
3. **Build > Firestore Database > Create database**, pick a location near your players, start in **production mode**.
4. Firestore **Rules** tab, replace everything with this and **Publish**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /saves/{uid} {
         allow read, delete: if request.auth != null && request.auth.uid == uid;
         allow create, update: if request.auth != null && request.auth.uid == uid
           && request.resource.data.data is string
           && request.resource.data.data.size() < 200000;
       }
     }
   }
   ```
   (Each player can only read and write their own save, and a save can't be bigger than 200 KB.)
5. **Project settings (gear) > General > Your apps > Web (`</>`)**, register an app (no hosting needed). From the config it shows, copy `apiKey` and `projectId` into `js/cloud-config.js` (or paste them to me in the project chat and I'll commit them). These are public by design, not secrets.
6. Recommended: in Google Cloud Console > APIs & Services > Credentials, open the "Browser key" and restrict it to HTTP referrers `https://timleitch.github.io/*` and `http://localhost:*/*`.
7. Free tier limits: 50,000 reads and 20,000 writes per day. One active player is roughly 2 writes a minute while playing, so this covers a few hundred daily players.

### Checklist against the design document

**Core loop & mining**
- [DONE] Hangar > choose field > launch > mine > return > summary > upgrade > repeat.
- [DONE] Blocks have health, resistance, credit value and material type; credits only paid on destruction; partial damage persists for the sortie.
- [DONE] Four damage states (intact, cracked, heavily damaged, destroyed) with cracks, particles, sound and a "+credits" pop-up.
- [DONE] Each material has its own colour **and** its own symbol (dot, bars, diamond, triangle, ring, cross, star) so type never relies on colour alone.
- [DONE] All 7 materials from the table (plus "Moon glass" for Glass Moon, which had no named block - **[NEEDS DECISION]** name/stats: 60 health, 1.4x, 90 cr).
- [DONE] Continuous laser damage (chosen over discrete pulses) with a heat bar and overheat cooldown.

**Controls (touch)**
- [DONE] Floating virtual stick: drag anywhere on the left half to fly.
- [DONE] Tap a block to target it (forgiving touch radius); hold MINE to fire; hold BOOST to move fast (uses energy + extra fuel); RETURN banks credits any time.
- [DONE] Aim assist (auto-picks nearest block in range) - on by default, toggleable.
- [DONE] Auto-fire, auto-boost and autopilot toggles (see *Auto-play controls* above).
- [DONE] Left-handed layout, control opacity, UI scale, vibration toggle.
- [DONE] Pauses automatically when the app/tab loses focus.
- [DONE] Portrait-first; landscape also works (wider view).
- [TODO] Fully remappable/movable buttons (only left/right swap exists now).

**Sorties, fuel and risk**
- [DONE] Fuel budget (only movement/boost burns fuel, mining doesn't). Fuel empty = towed home with all credits.
- [DONE] Soft time limit (3:00 base, scales with fuel tank upgrades). Time out = autopilot home with all credits.
- [DONE] Hull; drifting debris (red outline + direction line, telegraphed) damages hull. Bumping into blocks never damages you.
- [DONE] Hull at zero = emergency return keeping 75% of sortie credits (Reinforced suit raises this).
- [DONE] Repair quote shown in hangar and in the summary; repair button. Hull persists between sorties.
- [DONE] Never soft-locks: if you can't afford repair and hull is under 25%, the station patches you to 25% for free.
- [DONE] Electrical fields hazard (Glass Moon, Far Orbit): dormant > flashing warning > active, damage while inside.
- [DONE] Low fuel, critical hull, 30-seconds-left warnings with sound, vibration and on-screen captions.
- [NEEDS DECISION] Sortie length: 3 minutes base. Fuel lasts about 3 minutes of continuous flying. Tell me if you want shorter/longer runs.

**Economy & upgrades**
- [DONE] Credits, lifetime credits, payout pop-ups, sortie summary split into blocks / contracts / bonuses / emergency loss / repair quote.
- [DONE] First-time region bonus (150 / 500 / 1,200 / 3,000 cr) - **[NEEDS DECISION]** values are mine.
- [DONE] All 8 shuttle systems with the README's costs, 5 levels each, stat preview before buying.
- [DONE] "Recommended upgrade" hint on the hangar and summary screens (points at the laser if a field needs it).
- [DONE] Visual upgrades: laser emitter grows/changes colour, armour plates at Hull 3, engine glow in hangar preview.
- [DONE] Region unlocks by lifetime credits + laser level, exactly as the table.
- [DONE] Secondary weapons (see *Secondary weapons* above).
- [DONE] Ship automation: auto-fire weapons, weapon selector, ammo autoloader, ammo racks, dock repair crew (see *Ship automation* above).
- [DONE] Ship weapons & systems: wide beam, split beam, twin miniguns, sentry turrets, point defence, deflector shield (see *Ship weapons & systems* above).
- [TODO] Cosmetic shop (only rank-unlocked paints exist).

**Miner / character**
- [DONE] Repair training (-8%/level, capped -32%).
- [DONE] Reinforced suit - **reinterpreted** as "+5% credits kept after hull failure" since there are no boarding events yet.
- [DONE] Field scanner - **reinterpreted** as "+15% contract rewards" since there are no discovery objects yet.
- [DONE] Miner rank from XP (blocks, first discoveries, contracts). Rank 3 = second contract slot; ranks 2/4/6/8 unlock shuttle paints.
- [DONE] Miner rank has no level cap. The existing first ten thresholds are unchanged; Rank 11 starts at 5,200 XP, and each later rank requires 300 more XP than the previous one. Existing XP automatically counts toward higher ranks. Each rank after 1 adds 5% laser and hand drill power, multiplying equipment upgrades; the bonus takes effect on the next launch and laser power contributes to threat.
- [NEEDS DECISION] Miner upgrade costs are not in the README; I used 140-2,100 cr ranges. Confirm or replace.
- [DONE] EVA mobility, oxygen tank and hand drill (see *Spacewalk / EVA* above).
- [DONE] Wide drill head and giant hollow rocks that need the miner (see *Giant hollow rocks* above).
- [TODO] Utility belt and consumables.

**Contracts**
- [DONE] Material order, Speed extraction, Safe pilot. Shown with requirements and rewards up front, 3 offers refresh every 4 hours, 1 active slot (2 at Rank 3). Unlocked after the first sortie.
- [TODO] Survey run and Discovery contracts (need scan targets / rare formations).
- [DONE] Daily objectives: daily and weekly orders with a streak (see *Daily and weekly orders*).

**Screens, audio, accessibility, saves**
- [DONE] Hangar, Upgrades (Shuttle / Miner / Drone tabs), Fields, Contracts, Settings, Sortie HUD, Sortie summary, Welcome back.
- [DONE] Synthesized sound effects with volume; per-material break sounds scaled by value.
- [DONE] High-contrast mode, captions, reduced effects, screen shake toggle, reduced-motion respected.
- [DONE] Auto-save every 5s, after purchases and sorties, and when backgrounded. If the browser kills the game mid-sortie, those credits are banked on next launch ("Recovered" summary).
- [DONE] First play session: guided hints (fly, tap the cracked block, hold MINE, keep mining, return) shown once; a pre-damaged rock sits near the hangar.
- [TODO] Ambient music track, separate music/SFX volume.
- [DONE] Accounts and cloud save / sync between devices (live on Firebase project `solo-miner-2daec` since 2026-11-06).
- [TODO] Analytics for the playtest metrics listed at the bottom of this doc.

### Questions for you (please answer inline or in the project chat)

1. ~~**Hosting:**~~ Answered: GitHub Pages (see How to run). Remaining step for you: enable Pages and decide public repo vs paid plan.
2. **Native Android:** the original doc targets Android. Do you want this wrapped as a real Android app later (e.g. Capacitor/TWA), or is the browser/PWA version the goal?
3. **Offline gains balance** (see the two decisions above).
4. **Sortie length** - is ~3 minutes the right feel?
5. **Monetization** - left out entirely per the fair-play section. Confirm that's fine for now.
6. **Cloud saves:** ~~Firebase setup~~ done. Still open: do you want Google sign-in as well as email + password? Recommended: restrict the API key to your site (step 6 of the Firebase setup).
7. **Ship automation:** are the module prices and auto-fire thresholds OK, and should the autoloader be allowed to spend from your wallet? (See *Ship automation* above.)
8. **New fields:** are the late-field unlock costs and pace right, and is it OK that existing saves unlock the new early fields immediately? (See *More fields* above.)
9. **Giant rocks:** is the late-field dig time OK (it is longer than a sortie with a base drill), are the rewards right, and should a half-dug giant carry over to the next launch? (See *Giant hollow rocks* above.)
10. **Ship weapons & systems:** are the prices and power right, should they unlock by rank or field, and should sentries be placed by hand? (See *Ship weapons & systems* above.)
11. **Auto EVA:** keep it a free setting that is on by default, or make it a bought upgrade / off by default? (See *Auto EVA* above.)
12. **Auto upgrade:** should it also buy new escort drones, weapons and modules, should it be on by default, and are the weights right? (See *Auto upgrade* above.)

## Game Design Document

### Overview

- **Genre:** Casual arcade mining / incremental progression
- **Platform:** Android phones and tablets
- **Mode:** Single-player, offline-friendly
- **Audience:** Players who enjoy short action runs, breaking things, and steadily improving their gear
- **Working title:** *Solo Miner*

**High concept:** Pilot a small mining shuttle through asteroid fields, break valuable rocks one block at a time, earn credits for every destroyed block, and upgrade the shuttle and the miner to reach tougher, richer worlds.

### Design Pillars

1. **Every hit feels useful.** Damage is visible, destruction is satisfying, and each destroyed block pays credits immediately.
2. **Progress is easy to understand.** Better tools break harder material; better equipment lets the player stay out longer and reach new places.
3. **Runs are short and replayable.** A sortie should be enjoyable in a few minutes, with a clear reason to launch again.
4. **The player is always in control.** The game is designed around touch, with forgiving aiming and readable targets on a phone screen.

### Player Fantasy and Story

The player is an independent miner working the edge of settled space. Their compact shuttle and patched-together suit are all they own. Each successful expedition funds better equipment, deeper routes, and a growing reputation. The story is intentionally light: new regions, mission briefings, and discoveries provide context without interrupting the mining action.

### Core Gameplay Loop

1. Choose an unlocked asteroid field and optional contract.
2. Launch with the current shuttle and miner equipment.
3. Aim at nearby blocks and mine them until they break.
4. Receive the block's credit payout immediately on destruction.
5. Avoid hazards and manage the sortie's time and fuel limits.
6. Return to the hangar, collect the run summary, and buy upgrades.
7. Unlock tougher fields, complete contracts, and repeat.

### Mining and Block Rules

- Every mineable block has **health**, **mining resistance**, **credit value**, and a **material type**.
- The player earns the listed credits when a block is destroyed, not for each hit. Partial damage persists for the current sortie; it does not pay out early.
- Mining power reduces the time and number of hits needed to destroy a block. Tool upgrades are especially important against high-resistance materials.
- Blocks have clear damage states: intact, cracked, heavily damaged, and destroyed. Distinct particles, sound, and a small payout pop-up confirm the break.
- A basic tool can damage every standard material, but hard blocks take a long time. Special regions may contain blocks requiring a minimum tool level.
- Values below are initial balancing targets. They should be tuned through playtesting.

| Material / block | Example health | Resistance | Payout per block | First region          |
| ---------------- | -------------: | ---------: | ---------------: | --------------------- |
| Common rock      |             10 |       1.0x |        5 credits | Nearside Belt         |
| Iron-rich rock   |             22 |       1.2x |       12 credits | Nearside Belt         |
| Nickel crystal   |             38 |       1.5x |       24 credits | Nearside Belt         |
| Dense cobalt     |             70 |       2.0x |       55 credits | Red Shard Field       |
| Iridium core     |            125 |       2.6x |      130 credits | Red Shard Field       |
| Ancient alloy    |            220 |       3.2x |      320 credits | Far Orbit (late game) |

**Payout principle:** Tougher blocks take longer but pay more. As a starting target, ordinary blocks should usually provide about 1-3 credits per second of mining with an appropriately equipped tool. Rare blocks can exceed that rate but should be less common or riskier to reach.

### Controls and Android Experience

- **Move:** Drag on the left side of the screen or use an optional virtual stick.
- **Aim and mine:** Tap a block to target it; hold the mine button to keep firing. An optional aim-assist selects the nearest block in the reticle.
- **Boost:** Hold the boost button to move quickly, consuming shuttle energy.
- **Return:** Tap the clearly marked return control to end a sortie early and bank its earnings.
- Support portrait play for one-handed sessions, with landscape as an optional expanded layout if practical.
- Keep targets and controls large enough for touch. Provide adjustable joystick position, button opacity, vibration, and aim assist.
- Pause when the app loses focus. Save after purchases, unlocks, and completed sorties so interruptions do not erase progress.
- Target smooth performance on common Android devices; offer reduced effects and battery-friendly settings.

### Sorties, Fuel, and Risk

- A sortie has a **fuel budget** and an optional soft time limit. Movement and boosting consume fuel; mining does not.
- The player can return at any time and keeps all credits earned from destroyed blocks.
- If the shuttle is disabled by a hazard, the player keeps a reduced share of the sortie's credits (starting target: 75%) and returns to the hangar. This makes failure costly without wiping out a run.
- The shuttle's hull absorbs collisions and environmental damage. At zero hull, the emergency return triggers.
- Repair costs are shown before launching and after a damaged return. Ordinary mining should not unexpectedly destroy the shuttle.
- Later regions add hazards such as drifting debris, electrical fields, and unstable rocks. Hazards are telegraphed and avoidable.

### Economy

- **Primary currency:** Credits, earned from destroyed blocks, contracts, and first-time region bonuses.
- Credits are spent on shuttle parts, miner equipment, repairs, and cosmetic items.
- There are no random paid loot boxes and no required real-money purchase to access progression.
- Show a payout pop-up at each block and a sortie summary separating block earnings, contract rewards, bonuses, and repair costs.
- Upgrade prices rise by tier, while new fields introduce enough higher-value blocks to make the next tier attainable.
- Early target: a first useful upgrade should be affordable within 1-3 sorties. A major region unlock should take several successful sorties, not an unexplained grind.

### Shuttle Upgrade System

Upgrades are purchased in the hangar. Each part has multiple levels; the displayed stat preview shows exactly what changes before purchase. The following figures are starter tuning targets, not final balance.

| Shuttle system         | Effect                                           | Example progression                                                 |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| Mining laser           | Increases damage to blocks                       | +20% mining power per level; 100, 250, 600, 1,400 credits           |
| Reactor                | Increases energy capacity and boost availability | +15% energy per level; 120, 300, 700, 1,600 credits                 |
| Thrusters              | Improves movement and dodge response             | +10% movement speed per level; 90, 220, 520, 1,200 credits          |
| Fuel tank              | Extends sortie distance and duration             | +20% fuel per level; 110, 270, 650, 1,500 credits                   |
| Hull plating           | Increases health and collision tolerance         | +20% hull per level; 130, 320, 760, 1,800 credits                   |
| Targeting array        | Improves lock range and aim assist               | +15% target range per level; 150, 360, 850, 2,000 credits           |
| Cargo / payout scanner | Reveals valuable blocks and bonus opportunities  | Better scan range and value preview; 180, 450, 1,050, 2,500 credits |
| Heat sink              | Reduces laser overheat and downtime              | +15% heat capacity per level; 140, 340, 800, 1,900 credits          |

**Upgrade rules:**

- Most systems have five levels, with each level costing more than the last. *(Build note: caps removed - see "No level caps" above.)*
- Some regions require a minimum laser level or shuttle rating. Requirements are visible before the player spends credits.
- Major upgrades can change appearance as well as stats: upgraded emitters, reactor glow, armor plates, and engine trails.
- A clear recommended-upgrade hint can point out a useful improvement, but purchases are always the player's choice.
- Keep the systems distinct: laser improves mining, reactor supports energy, fuel extends trips, thrusters improve movement, and hull helps survival.

### Miner / Character Progression

The miner has a separate equipment track so progression is not limited to the shuttle. Character upgrades improve survivability and convenience; shuttle upgrades remain the main source of mining power.

| Miner upgrade   | Effect                                                                | Example progression                       |
| --------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| Reinforced suit | Reduces damage during boarding events and emergency returns           | +10% protection per level                 |
| EVA mobility    | Improves movement during optional close-up repair or discovery events | +10% movement per level                   |
| Utility belt    | Adds one consumable slot, up to three slots                           | Unlock at player levels 2 and 5           |
| Field scanner   | Improves discovery and contract-object detection                      | +15% scan range per level                 |
| Repair training | Reduces hangar repair costs                                           | -8% repair cost per level, capped at -32% |
| Miner rank      | Unlocks contracts and cosmetic rewards                                | Earn XP from mining and contracts         |

- Miner rank XP is awarded for blocks destroyed, new material discoveries, and completed contracts. Credits remain the spending currency.
- Rank rewards should be useful but not mandatory: equipment slots, cosmetics, and access to new contracts are good rewards.
- Character appearance, suit color, helmet, and shuttle paint are cosmetic and do not change competitive balance.

### Regions and Unlocks

| Region          | Unlock target                             | New content                                                 |
| --------------- | ----------------------------------------- | ----------------------------------------------------------- |
| Nearside Belt   | Available from the start                  | Common rock, iron-rich rock, nickel crystal; gentle hazards |
| Red Shard Field | 2,500 lifetime credits and Laser Level 2  | Dense cobalt, iridium; debris and short boost routes        |
| Glass Moon      | 8,000 lifetime credits and Laser Level 3  | Brittle high-value formations; electrical fields            |
| Far Orbit       | 22,000 lifetime credits and Laser Level 4 | Ancient alloy, rare discoveries, advanced contracts         |

Unlock requirements are based on lifetime earnings and equipment readiness, not unspent wallet balance. This prevents a player from accidentally locking away progress by buying an upgrade.

### Contracts and Replay Goals

- **Material order:** Destroy a stated number of a specific block type.
- **Survey run:** Scan marked formations and return safely.
- **Speed extraction:** Earn a credit target before the sortie timer expires.
- **Safe pilot:** Complete a run without hull damage.
- **Discovery:** Find a rare formation in a named region.
- Contracts refresh on a predictable schedule and always show requirements and rewards up front.
- One active contract is available early; more slots can unlock through miner rank.
- Daily objectives are optional and should not be required for core progression.

### Hangar and Main Screens

- **Hangar:** Current credit balance, shuttle and miner status, upgrade access, launch button, and recent earnings.
- **Region select:** Unlocked destinations, block previews, hazard rating, and recommended equipment.
- **Sortie HUD:** Hull, fuel, energy, current target health, credits earned this run, pause, and return controls.
- **Upgrade bay:** Shuttle and miner tabs, level, price, stat comparison, and purchase confirmation.
- **Sortie summary:** Blocks destroyed by material, credits earned, contract completion, damage, repair quote, and launch-again action.
- Keep the most important next action obvious: launch when ready, upgrade when a purchase is affordable, or return when risk is high.

### Audio and Visual Direction

- Space feels open and calm between mining actions; the break moment is bright, punchy, and easy to read.
- Use distinct silhouettes, colors, crack patterns, and hit sounds for each material. Never rely on color alone to communicate block type or damage.
- Give common blocks quick, crisp feedback. Rare blocks receive a stronger sound, particles, and payout treatment without obscuring nearby targets.
- The soundtrack is restrained ambient science fiction, with a stronger rhythmic layer during dangerous events.
- Provide independent volume controls, vibration toggle, screen shake toggle, and reduced flashing / reduced particles options.

### Accessibility and Usability

- Remappable on-screen controls, left-handed layout, adjustable UI scale, and aim-assist options.
- High-contrast HUD mode and block labels or icons that do not depend on color perception.
- Captions for important audio cues, including low fuel, critical hull, and contract completion.
- No essential information conveyed only by vibration, color, or sound.
- Pause and resume safely; avoid long unskippable sequences.

### Monetization and Fair Play

The intended baseline is a complete, enjoyable single-player game without pay-to-win purchases. If monetization is added later, prioritize optional cosmetics or a clearly priced premium edition. Do not sell credits, power upgrades, paid loot boxes, or energy that blocks ordinary play. Any optional ads should be opt-in and must never interrupt a sortie.

### First Play Session

1. A short opening introduces the miner, shuttle, and one damaged common block.
2. The player aims and destroys a block, immediately seeing the credit reward.
3. The first sortie teaches boost, fuel, and safe return without requiring a tutorial wall of text.
4. Back in the hangar, the player can afford the first laser upgrade after a small number of blocks.
5. The next launch demonstrates that the upgraded laser breaks common material faster.
6. The first contract and region unlock are introduced only after the basic loop is understood.

### MVP Scope

The first playable release should include:

- Android touch controls, pause/resume, and persistent local save.
- One playable shuttle, one miner, and a functioning hangar.
- Three block materials with health, damage feedback, and per-block credit payouts.
- A short sortie loop with fuel, hull, return, and a run summary.
- Laser, fuel, hull, and thruster upgrades, plus at least two miner progression rewards.
- Two regions, one hazard type, and a small set of contracts.
- Basic audio, accessibility settings, and performance options.

Defer additional regions, elaborate story scenes, online features, leaderboards, and monetization until the core mining-and-upgrade loop is fun and stable.

### Success Criteria and Playtest Questions

- New players understand that each destroyed block pays credits without needing an explanation from another player.
- Players can identify why a block is taking longer to break and which upgrade will help.
- The first upgrade arrives quickly enough to make the first return feel rewarding.
- Players can finish a short sortie and understand the earnings summary.
- Test whether tough blocks feel rewarding rather than tedious; tune health, payout, spawn frequency, and laser power together.
- Test whether players notice and use return, fuel, and hull information before a failure.
- Track first-session completion, first upgrade purchase, average sortie length, return rate, and region unlock progression.

### Open Tuning Decisions

- Final view: portrait-only or support both portrait and landscape.
- Exact sortie duration, fuel consumption, and target session length.
- Whether mining is continuous laser damage or discrete tool pulses; either way, block payout occurs only on destruction.
- Final block values, upgrade costs, region unlock targets, and hazard damage after playtesting.
- Whether miner rank is needed in addition to lifetime-credit region gates.

These are tuning decisions, not blockers for prototyping the core loop.
