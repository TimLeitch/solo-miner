# Solo Miner

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
