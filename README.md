# Solo Miner

## Build Status (browser version)

> Built by Claude on 2026-11-04. The game is a mobile-first **browser game** (works on phones, tablets and desktop) built from the design document below. Items marked **[DONE]** are playable now; **[TODO]** is not built yet; **[NEEDS DECISION]** is something I guessed at and need you to confirm or change.

### How to run

- No build step, no dependencies. Plain HTML/CSS/JavaScript.
- Quick look: open `index.html` directly in a browser (offline caching won't be active this way).
- Proper (phone) testing: serve the folder over HTTP, e.g. `python3 -m http.server 8080` in this folder, then open `http://<your-computer-ip>:8080` on your phone (same Wi-Fi). On Android Chrome use **menu > Add to Home screen / Install app** to get a full-screen app icon.
- To host for real, drop the folder on any static host (GitHub Pages, Netlify, an internal web server). Installing as an app and offline play need **HTTPS** (or localhost).
- Desktop keys for testing: WASD/arrows move, Space mine, Shift boost, Tab target nearest, R return, P/Esc pause.

### Files

| File | Purpose |
| ---- | ------- |
| `index.html` | Page layout: hangar screens, sortie HUD, controls, modals |
| `css/style.css` | All styling, mobile-first, safe-area aware |
| `js/data.js` | **All tuning numbers** (materials, regions, upgrade costs, drone rates, base stats). Edit here to rebalance. |
| `js/state.js` | Save/load (localStorage), derived stats, purchases, region unlocks, **offline gains**, contracts |
| `js/sortie.js` | The mining run: world generation, touch stick, laser/heat, debris, electrical fields, rendering, HUD |
| `js/ui.js` | Hangar, upgrade bay, fields, contracts, settings, summary and welcome-back screens |
| `js/audio.js` | Synthesized sound effects (no audio files needed) |
| `js/main.js` | Boot, game flow, autosave, pause-on-background, crash recovery, service worker registration |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app (PWA) + offline caching. Bump `CACHE` in `sw.js` when you ship changes. |

### Offline gains - Mining drone (new - not in the original design)

- **[DONE]** The drone mines in **real time** into a storage bin, whether the game is open, in the background or fully closed. You collect the bin from the hangar.
- **[DONE]** Exact formulas (code: `js/state.js` > `accrue()` / `droneStatus()`; numbers: `js/data.js` > `DRONE`):

  ```
  rate (cr/hr)   = ratePerHour[droneLevel] x regionMult[best unlocked field]
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

- **[DONE]** Three toggle buttons above MINE/BOOST during a sortie: **FIRE**, **BOOST** and **PILOT**. Each one is AUTO ON or AUTO OFF, saves with your settings, and is also in Settings. Desktop keys: F / B / G.
- **[DONE]** Auto-fire (on by default): the laser fires by itself at whatever is in range. No need to hold MINE.
- **[DONE]** Auto-boost (off by default): boosts whenever you're moving and have energy. It stops at empty and restarts at 50% energy. Boosting burns more fuel.
- **[DONE]** Autopilot (on by default, only during a sortie): when you stop steering for about half a second and nothing is in range, the ship flies itself to the next block and mines it. It goes to your tapped target first, otherwise it picks the nearest block, favouring valuable ones. It steers around debris and live electrical fields, and picks a new block if it gets stuck. Touch the stick and you're back in control instantly. A green dotted line shows where it's heading.
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
- [TODO] Cosmetic shop (only rank-unlocked paints exist).

**Miner / character**
- [DONE] Repair training (-8%/level, capped -32%).
- [DONE] Reinforced suit - **reinterpreted** as "+5% credits kept after hull failure" since there are no boarding events yet.
- [DONE] Field scanner - **reinterpreted** as "+15% contract rewards" since there are no discovery objects yet.
- [DONE] Miner rank from XP (blocks, first discoveries, contracts). Rank 3 = second contract slot; ranks 2/4/6/8 unlock shuttle paints.
- [NEEDS DECISION] Miner upgrade costs are not in the README; I used 140-2,100 cr ranges. Confirm or replace.
- [TODO] EVA mobility, utility belt and consumables (need EVA/boarding events and consumable items to be designed first).

**Contracts**
- [DONE] Material order, Speed extraction, Safe pilot. Shown with requirements and rewards up front, 3 offers refresh every 4 hours, 1 active slot (2 at Rank 3). Unlocked after the first sortie.
- [TODO] Survey run and Discovery contracts (need scan targets / rare formations).
- [TODO] Daily objectives.

**Screens, audio, accessibility, saves**
- [DONE] Hangar, Upgrades (Shuttle / Miner / Drone tabs), Fields, Contracts, Settings, Sortie HUD, Sortie summary, Welcome back.
- [DONE] Synthesized sound effects with volume; per-material break sounds scaled by value.
- [DONE] High-contrast mode, captions, reduced effects, screen shake toggle, reduced-motion respected.
- [DONE] Auto-save every 5s, after purchases and sorties, and when backgrounded. If the browser kills the game mid-sortie, those credits are banked on next launch ("Recovered" summary).
- [DONE] First play session: guided hints (fly, tap the cracked block, hold MINE, keep mining, return) shown once; a pre-damaged rock sits near the hangar.
- [TODO] Ambient music track, separate music/SFX volume.
- [TODO] Cloud save / sync between devices (save lives in this browser only - clearing browser data erases it).
- [TODO] Analytics for the playtest metrics listed at the bottom of this doc.

### Questions for you (please answer inline or in the project chat)

1. **Hosting:** where should this live so you can play it on your phone (GitHub Pages, internal server, something else)? HTTPS is needed for install + offline.
2. **Native Android:** the original doc targets Android. Do you want this wrapped as a real Android app later (e.g. Capacitor/TWA), or is the browser/PWA version the goal?
3. **Offline gains balance** (see the two decisions above).
4. **Sortie length** - is ~3 minutes the right feel?
5. **Monetization** - left out entirely per the fair-play section. Confirm that's fine for now.

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

- Most systems have five levels, with each level costing more than the last.
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
