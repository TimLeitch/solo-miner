/* Solo Miner - hangar screens, upgrade bay, regions, contracts and modals. */
window.SM = window.SM || {};

SM.UI = (function () {
  const D = SM.DATA, St = SM.State;
  const $ = id => document.getElementById(id);
  let screen = 'home', seg = 'shuttle';
  const fmt = n => Math.floor(n).toLocaleString();

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- navigation ----------
  function goto(name) {
    screen = name;
    document.querySelectorAll('.screen').forEach(s => (s.hidden = s.id !== 'scr-' + name));
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.goto === name));
    $('screens').scrollTop = 0;
    render();
  }

  function bind() {
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-goto]');
      if (t) { SM.Audio.unlock(); SM.Audio.click(); goto(t.dataset.goto); }
    });
    document.querySelectorAll('#scr-upgrades .seg button').forEach(b => b.addEventListener('click', () => {
      seg = b.dataset.seg; SM.Audio.click();
      document.querySelectorAll('#scr-upgrades .seg button').forEach(x => x.classList.toggle('on', x === b));
      renderUpgrades();
    }));
    $('btnSettings').addEventListener('click', () => { SM.Audio.unlock(); SM.Audio.click(); openSettings(); });
    $('rankBtn').addEventListener('click', () => goto('contracts'));
    $('btnRepair').addEventListener('click', () => {
      SM.Audio.unlock();
      const c = St.repairCost();
      if (c <= 0) return;
      if (St.get().credits <= 0) { SM.Audio.deny(); return toast('Not enough credits to repair'); }
      St.repair(); SM.Audio.buy(); render();
    });
    $('btnLaunch').addEventListener('click', () => { SM.Audio.unlock(); SM.Main.launch(); });
    document.addEventListener('click', e => {
      if (!e.target.closest('[data-collect]')) return;
      SM.Audio.unlock();
      collectToast(St.collectDrone());
      closeModal(); render();
    });
    // live drone counter while the hangar is on screen (keeps <details> open state)
    setInterval(() => {
      if (document.visibilityState !== 'visible' || document.body.classList.contains('in-sortie')) return;
      if (screen === 'home') {
        const open = $('droneCard').querySelector('details')?.open;
        renderDrone();
        if (open) $('droneCard').querySelector('details').open = true;
      }
      runAutoUpgrade();
      const newAch = SM.Meta.checkAchievements(); // anything reached outside a sortie (drone bay, rebirth, auto upgrade...)
      if (newAch.length) { SM.Audio.contract(); newAch.forEach(a => toast(`Achievement: ${a.name} +${a.stars} \u2605`)); St.save(); render(); }
      $('upDot').hidden = !affordableAny();
    }, 1000);
    $('modal').addEventListener('click', e => { if (e.target.id === 'modal' && !$('modal').dataset.locked) closeModal(); });
  }

  // ---------- render ----------
  function render() {
    const s = St.get();
    $('credits').textContent = fmt(s.credits);
    $('rank').textContent = St.rank();
    $('xpFill').style.width = (St.rankProgress() * 100) + '%';
    document.body.classList.toggle('hc', !!s.settings.highContrast);
    document.documentElement.style.setProperty('--ui', s.settings.uiScale);
    $('upDot').hidden = !affordableAny();
    if (SM.Cloud) SM.Cloud.refreshUi();
    $('ctDot').hidden = !(s.stats.sorties >= 1 && s.contracts.active.length < St.contractSlots() && s.contracts.offers.length);
    if (screen === 'home') renderHome();
    if (screen === 'upgrades') renderUpgrades();
    if (screen === 'regions') renderRegions();
    if (screen === 'contracts') renderContracts();
    if (screen === 'career') renderCareer();
    $('crDot').hidden = !careerDot();
  }

  // ---------- career (rebirth, achievements, collection, cosmetics, leaderboards) ----------
  let cseg = 'achievements';
  const CAREER_SEGS = [['achievements', 'Awards'], ['collection', 'Log'], ['style', 'Style'], ['rebirth', 'Rebirth']];
  function careerDot() { return SM.Meta.unseenAchievements() > 0 || (St.canRebirth() && !St.get().prestige.count); }
  function renderCareer() {
    $('careerSeg').innerHTML = CAREER_SEGS.map(([id, n]) => `<button data-cseg="${id}" class="${cseg === id ? 'on' : ''}">${n}</button>`).join('');
    $('careerSeg').hidden = CAREER_SEGS.length < 2;
    $('careerSeg').querySelectorAll('[data-cseg]').forEach(b => b.addEventListener('click', () => { cseg = b.dataset.cseg; SM.Audio.click(); renderCareer(); }));
    const fn = { rebirth: renderRebirth, achievements: renderAchievements, collection: renderCollection, style: renderStyle }[cseg];
    $('careerBody').innerHTML = '';
    fn && fn($('careerBody'));
  }
  function renderAchievements(el) {
    const all = SM.Meta.achievements(), done = all.filter(a => a.done).length;
    const newSince = SM.Meta.unseenAchievements();
    // one row per ladder: the next rung to earn (or the top rung once all are done)
    const ladders = [...new Set(all.map(a => a.ladder))].map(id => {
      const rungs = all.filter(a => a.ladder === id);
      return rungs.find(a => !a.done) || rungs[rungs.length - 1];
    });
    const recent = all.filter(a => a.done).sort((x, y) => y.at - x.at).slice(0, Math.max(3, newSince));
    el.innerHTML = `<h2>Achievements</h2>
      <div class="small muted">${done} / ${all.length} earned - ${fmt(St.get().meta.stars)} &#9733; stars to spend on cosmetics.</div>
      ${recent.length ? `<div class="card"><div class="label">Latest</div>${recent.map(a => `<div class="sum"><span>&#127942; ${esc(a.name)}</span><span class="small">+${a.stars} &#9733;</span></div>`).join('')}</div>` : ''}
      ${ladders.map(a => `<div class="card ach ${a.done ? 'done' : ''}">
        <div class="row"><b>${a.done ? '&#10003; ' : ''}${esc(a.name)}</b><span class="small">+${a.stars} &#9733;</span></div>
        <div class="small muted">${esc(a.text)} - rung ${a.rung} of ${a.rungs}</div>
        <div class="prog"><i style="width:${Math.min(100, a.have / a.goal * 100)}%"></i></div>
        <div class="small">${fmt(Math.min(a.have, a.goal))} / ${fmt(a.goal)}</div></div>`).join('')}`;
    SM.Meta.seeAchievements(); St.save();
    $('crDot').hidden = !careerDot();
  }
  function renderCollection(el) {
    const s = St.get(), m = s.meta, C = m.counters;
    const mats = Object.keys(D.MATERIALS).filter(k => !D.MATERIALS[k].foe);
    const found = mats.filter(k => s.discovered[k]).length;
    const matHtml = mats.map(k => {
      const md = D.MATERIALS[k], got = s.discovered[k];
      return `<div class="coll ${got ? '' : 'locked'}"><span class="sw" style="background:${got ? md.color : '#333'};border-color:${got ? md.edge : '#555'}"></span>
        <span><b>${got ? esc(md.name) : '???'}</b><br><span class="small muted">${got ? `${fmt(m.mats[k] || 0)} broken - ${md.value} cr base` : 'Not found yet'}</span></span></div>`;
    }).join('');
    const fieldHtml = D.REGIONS.map(r => {
      const f = m.fields[r.id], open = s.unlocked.includes(r.id);
      return `<div class="sum"><span>${open || f ? esc(r.name) : '??? (locked)'}</span><span class="small">${f ? `${f.runs} run${f.runs === 1 ? '' : 's'} - best ${fmt(f.best)} cr${f.cleared ? ` - cleared ${f.cleared}x` : ''}` : open ? 'not flown yet' : ''}</span></div>`;
    }).join('');
    const rec = [['Sorties flown', C.sorties], ['Blocks broken', C.blocks], ['Credits banked from sorties', C.credits], ['Credits ever (all lives)', St.allTimeCredits()],
      ['Best sortie', s.stats.best], ['Relics recovered', C.relics], ['Giant rocks cracked', C.giants], ['Scavengers shot down', C.scavs], ['Fields cleared', C.clears],
      ['Contracts done', C.contracts], ['Daily orders done', C.dailies], ['Weekly orders done', C.weeklies], ['Best daily streak', m.daily.best],
      ['Drone bay collected', C.offline], ['Rebirths', s.prestige.count]];
    el.innerHTML = `<h2>Collection log</h2>
      <div class="card"><div class="label">Materials - ${found} / ${mats.length} found</div><div class="coll-grid">${matHtml}</div></div>
      <div class="card"><div class="label">Rare finds</div>${Object.keys(D.EVENTS.kinds).map(k => { const n = SM.Meta.counter('ev:' + k); return `<div class="sum"><span>${n ? esc(D.EVENTS.kinds[k].name) : '???'}</span><b>${fmt(n)}</b></div>`; }).join('')}
        <div class="small muted">About ${Math.round(D.EVENTS.chance * 100)}% of fields have one: a comet to shoot, a derelict to salvage on a spacewalk, or a scavenger mothership.</div></div>
      <div class="card"><div class="label">Fields</div>${fieldHtml}</div>
      <div class="card"><div class="label">Records</div>${rec.map(([n, v]) => `<div class="sum"><span>${n}</span><b>${fmt(v || 0)}</b></div>`).join('')}</div>`;
  }
  // Career > Style: the cosmetics shop (paints, engine trails, decals, laser colours)
  function renderStyle(el) {
    const s = St.get(), M = SM.Meta, look = M.look();
    const kinds = [['paint', 'Paint'], ['trail', 'Engine trail'], ['decal', 'Decal'], ['beam', 'Laser colour']];
    const achName = id => { const a = M.achievements().find(x => x.id === id); return a ? a.name : id; };
    const swatch = (kind, d) => {
      if (kind === 'paint') return `<span class="sw" style="background:${d.color}"></span>`;
      if (kind === 'trail') return `<span class="sw" style="background:${d.color === 'rainbow' ? 'linear-gradient(90deg,#f55,#fd5,#5f8,#5af,#c6f)' : `linear-gradient(90deg,${d.color},${d.boost})`}"></span>`;
      if (kind === 'beam') return `<span class="sw" style="background:${d.core};box-shadow:0 0 6px 2px ${d.glow}"></span>`;
      return '';
    };
    el.innerHTML = `<h2>Ship style</h2>
      <div class="card" style="text-align:center"><canvas id="stylePreview" width="240" height="140" aria-hidden="true"></canvas>
        <div class="small">Stars: <b>${fmt(s.meta.stars)} &#9733;</b> <span class="muted">- earn them from daily / weekly orders and achievements</span></div></div>
      ${kinds.map(([kind, label]) => `<div class="card"><div class="label">${label}</div><div class="cosm-grid">${M.cosmList(kind).map(d => {
        const own = M.owns(kind, d.id), on = look[kind].id === d.id;
        const need = d.rank ? `Rank ${d.rank}` : d.ach ? esc(achName(d.ach)) : `${d.stars} &#9733;`;
        const tag = on ? '<b class="pos">Equipped</b>' : own ? 'Tap to use' : d.stars ? `<b>${need}</b>` : `<span class="muted">${need}</span>`;
        return `<button class="chip cosm ${on ? 'on' : ''} ${own ? '' : 'locked'}" data-cosm="${kind}:${d.id}" ${!own && !d.stars ? 'aria-disabled="true"' : ''}>${swatch(kind, d)}<span>${esc(d.name)}<br><small>${tag}</small></span></button>`;
      }).join('')}</div></div>`).join('')}`;
    drawShipPreview($('stylePreview'), look);
    el.querySelectorAll('[data-cosm]').forEach(b => b.addEventListener('click', () => {
      const [kind, id] = b.dataset.cosm.split(':');
      const r = M.useCosmetic(kind, id), d = M.cosmDef(kind, id);
      if (r === 'poor') { SM.Audio.deny(); toast(`Needs ${d.stars} stars - you have ${fmt(St.get().meta.stars)}`); return; }
      if (r === 'locked') { SM.Audio.deny(); toast(d.rank ? `Unlocks at rank ${d.rank}` : `Earn the "${achName(d.ach)}" achievement`); return; }
      if (r === 'bought') { SM.Audio.buy(); toast(`${d.name} unlocked`); } else SM.Audio.click();
      render();
    }));
  }
  function renderRebirth(el) {
    const s = St.get(), P = s.prestige, PD = D.PRESTIGE;
    const gain = St.shardsFor(s.lifetime), ok = St.canRebirth();
    const after = P.shards + gain;
    const nextAt = PD.base * Math.pow(gain + 1, 2);
    el.innerHTML = `<h2>Rebirth</h2>
      <div class="card"><div class="row"><div><div class="label">Core shards</div><div class="big">${P.shards} <span class="small muted">(${P.count} rebirth${P.count === 1 ? '' : 's'})</span></div></div>
        <div style="text-align:right"><div class="small">All credits <b class="pos">+${Math.round((St.prestigeMult() - 1) * 100)}%</b></div><div class="small">Drone bay <b class="pos">+${Math.round((St.prestigeDroneMult() - 1) * 100)}%</b></div></div></div></div>
      <div class="card">
        <p class="small">Start a new life with a permanent bonus. Each core shard adds <b>+${Math.round(PD.creditPer * 100)}%</b> to every credit you earn and <b>+${Math.round(PD.dronePer * 100)}%</b> to the drone bay, forever.</p>
        <div class="sum"><span>Lifetime credits this life</span><b>${fmt(s.lifetime)} cr</b></div>
        <div class="sum"><span>Shards from a rebirth now</span><b class="${gain ? 'pos' : ''}">+${gain}</b></div>
        <div class="sum"><span>Next shard at</span><span>${fmt(nextAt)} cr lifetime</span></div>
        ${gain ? `<div class="sum"><span>Bonus after rebirth</span><b class="pos">+${Math.round(PD.creditPer * after * 100)}% credits</b></div>` : ''}
        <p class="small muted"><b>Resets:</b> wallet, upgrades, drone bay level, fields (back to Nearside), escort drones, weapons, automation modules, active contracts, first-survey bonuses (you get them again).<br>
        <b>Keeps:</b> rank and XP, stars, cosmetics, daily / weekly orders and streak, achievements, collection log, settings, account.</p>
        <button class="btn ${ok ? 'gold' : 'ghost'}" id="btnRebirth" ${ok ? '' : 'disabled'}>${ok ? `Rebirth for +${gain} shard${gain === 1 ? '' : 's'}` : `Needs ${fmt(PD.minLifetime)} cr lifetime (${fmt(s.lifetime)} so far)`}</button>
      </div>`;
    const b = $('btnRebirth');
    if (ok) b.addEventListener('click', () => {
      openModal(`<h2>Rebirth?</h2><p>You start again at Nearside with an empty wallet and level 1 upgrades, and gain <b>+${gain} core shard${gain === 1 ? '' : 's'}</b> (all credits +${Math.round(PD.creditPer * after * 100)}%, drone bay +${Math.round(PD.dronePer * after * 100)}%). Your drone bay is collected first. This cannot be undone.</p>
        <button class="btn gold" id="rbYes">Rebirth</button><button class="btn ghost" id="rbNo">Not yet</button>`);
      $('rbNo').addEventListener('click', closeModal);
      $('rbYes').addEventListener('click', () => {
        const r = St.rebirth(); closeModal();
        if (r) { SM.Audio.contract(); toast(`Reborn! ${r.shards} core shard${r.shards === 1 ? '' : 's'}: all credits +${Math.round((St.prestigeMult() - 1) * 100)}%`); }
        goto('home');
      });
    });
  }

  function affordableAny() {
    const s = St.get();
    return St.droneAffordable() || [...D.SHUTTLE, ...D.MINER, { id: 'drone' }, { id: 'silo' }].some(u => { const c = St.upgradeCost(u.id); return c != null && c <= s.credits; })
      || (St.wingCost() != null && St.wingCost() <= s.credits)
      || D.WEAPONS.some(d => { const c = St.weaponCost(d.id); return c != null && c <= s.credits; })
      || (D.WEAPONS.some(d => St.weaponLvl(d.id)) && D.AUTO.modules.some(m => { const c = St.autoCost(m.id); return c != null && c <= s.credits; }));
  }

  function dur(ms) {
    const m = Math.ceil(ms / 60000), h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  }
  function clock(t) { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (new Date(t).toDateString() !== new Date().toDateString() ? ' tomorrow' : ''); }
  function droneMult() {
    const best = Math.max(0, ...St.get().unlocked.map(id => D.REGIONS.findIndex(r => r.id === id)));
    return D.REGIONS[best].drone;
  }
  // Plain-language formula block, shared by the hangar card, the drone tab and the welcome-back screen.
  function droneFormula(ds) {
    const l = St.lvl('drone');
    return `<details class="formula"><summary>How it's calculated</summary>
      <div class="sum"><span>Drone Lv ${l} base rate</span><span>${fmt(St.droneBaseRate(l))} cr/hr</span></div>
      <div class="sum"><span>x Best field bonus</span><span>x${droneMult()}</span></div>
      ${St.get().prestige.shards ? `<div class="sum"><span>x Rebirth bonus (${St.get().prestige.shards} core shards)</span><span>x${St.prestigeDroneMult().toFixed(2)}</span></div>` : ''}
      <div class="sum"><span>x Escort wing bonus (${St.get().wing.count} drones x ${Math.round(D.WING.offlineBonus * 100)}%)</span><span>x${(1 + D.WING.offlineBonus * St.get().wing.count).toFixed(2)}</span></div>
      <div class="sum"><span>= Rate</span><b>${fmt(ds.rate)} cr/hr</b></div>
      <div class="sum"><span>Storage = rate x ${ds.capHours}h${St.siloHours() ? ` (${St.droneCapHours(l)}h bay + ${St.siloHours()}h silo)` : ''}</span><b>${fmt(ds.cap)} cr</b></div>
      <p class="small muted">Stored = min(storage, stored + rate x hours passed). The drone works in real time, whether the game is open, in the background or closed. Once storage is full it stops until you collect.</p>
    </details>`;
  }
  function renderDrone() {
    const el = $('droneCard'); if (!el) return;
    const ds = St.droneStatus(), s = St.get();
    const full = ds.store >= ds.cap - 0.5;
    el.innerHTML = `<div class="row">
        <div><div class="label">Mining drone - Lv ${St.lvl('drone')}</div>
          <div class="big">${fmt(ds.store)} <span class="small muted">/ ${fmt(ds.cap)} cr stored</span></div>
          <div class="small">${fmt(ds.rate)} cr/hr - ${full ? '<b class="neg">Storage full - collect it!</b>' : `full in <b>${dur(ds.fullInMs)}</b> (at ${clock(ds.fullAt)})`}</div>
        </div>
        <div class="drone-anim ${full ? 'idle' : ''}" aria-hidden="true"><span></span></div>
      </div>
      <div class="meter drone-meter"><i style="width:${ds.frac * 100}%"></i></div>
      <div class="proj">
        <div class="label">If you come back in...</div>
        ${[1, 4, 8].map(hh => `<div class="sum"><span>${hh}h${hh >= ds.capHours ? ' (full)' : ''}</span><span>drone ${fmt(ds.project(hh))} cr - wallet <b>${fmt(s.credits + ds.project(hh))}</b></span></div>`).join('')}
      </div>
      ${droneFormula(ds)}
      <button class="btn ${ds.store >= 1 ? 'gold' : 'ghost'}" data-collect ${ds.store >= 1 ? '' : 'disabled'}>Collect ${fmt(ds.store)} cr</button>`;
  }

  function renderHome() {
    const s = St.get();
    const max = St.maxHull();
    $('homeHull').style.width = (s.hull / max * 100) + '%';
    $('homeHull').parentElement.classList.toggle('low', s.hull / max < 0.35);
    $('homeHullText').textContent = `${Math.ceil(s.hull)} / ${Math.round(max)}`;
    const rc = St.repairCost();
    $('btnRepair').hidden = rc <= 0;
    $('btnRepair').textContent = `Repair - ${fmt(rc)} cr`;
    renderDrone();
    const r = D.REGIONS.find(x => x.id === s.region);
    $('homeRegion').textContent = r.name;
    const th = St.threat();
    $('homeRegionInfo').textContent = `Hazard: ${r.hazard} - Threat ${th.level.toFixed(1)} (blocks x${th.hp.toFixed(1)} health, x${th.value.toFixed(1)} credits)`;
    // daily / weekly orders
    SM.Meta.refresh();
    const dly = s.meta.daily, dn = dly.orders.filter(o => o.done).length, stk = SM.Meta.streak();
    $('homeOrders').innerHTML = `<div class="row"><div><div class="label">Daily orders</div>
      <div class="small"><b>${dn} / ${dly.orders.length}</b> done${stk ? ` - streak <b>${stk}</b> day${stk === 1 ? '' : 's'} (+${Math.round((SM.Meta.streakMult() - 1) * 100)}% rewards)` : ''} - new in ${dur(SM.Meta.nextMidnight() - Date.now())}</div></div>
      <button class="btn ghost small-btn" data-goto="contracts">View</button></div>`;
    // contract
    const hc = $('homeContract');
    if (s.contracts.active.length) {
      hc.innerHTML = '<div class="label">Active contract</div>' + s.contracts.active.map(contractHtml).join('');
    } else {
      hc.innerHTML = `<div class="row"><div><div class="label">Contracts</div><div class="small">${s.stats.sorties < 1 ? 'Finish your first sortie to unlock contracts.' : 'No active contract. Pick one for bonus credits.'}</div></div>${s.stats.sorties >= 1 ? '<button class="btn ghost small-btn" data-goto="contracts">View</button>' : ''}</div>`;
    }
    // recommendation hint
    const rec = recommended();
    const hint = $('homeHint');
    if (rec) {
      hint.hidden = false;
      hint.innerHTML = `<div class="row"><div><div class="label">Recommended</div><b>${esc(rec.name)}</b> <span class="small muted">${esc(rec.why)}</span></div><button class="btn gold small-btn" data-goto="upgrades">${fmt(rec.cost)} cr</button></div>`;
    } else hint.hidden = true;
    // recent
    const last = s.lastRun;
    const rec2 = $('recent');
    if (last) {
      rec2.hidden = false;
      rec2.innerHTML = `<div class="label">Last sortie</div>
        <div class="rl"><span>${esc(D.REGIONS.find(x => x.id === last.region).name)}</span><span>${last.blocks} block${last.blocks === 1 ? '' : 's'}</span></div>
        <div class="rl"><span>Banked</span><b class="pos">+${fmt(last.credits)} cr</b></div>`;
    } else rec2.hidden = true;
    const acct = SM.Cloud ? SM.Cloud.homeCardHtml() : '';
    $('homeAccount').hidden = !acct;
    $('homeAccount').innerHTML = acct;
    drawShipPreview();
    const lowHull = s.hull / max < 0.25;
    $('btnLaunch').textContent = lowHull ? 'REPAIR & LAUNCH' : 'LAUNCH';
  }

  function recommended() {
    const s = St.get();
    const next = D.REGIONS.find(r => !s.unlocked.includes(r.id));
    const laserCost = St.upgradeCost('laser');
    if (next && St.lvl('laser') < next.laser && laserCost != null && laserCost <= s.credits)
      return { name: 'Mining laser', cost: laserCost, why: `- needed for ${next.name}` };
    const order = ['laser', 'fuel', 'drone', 'thruster', 'hull', 'heatsink', 'targeting', 'reactor', 'scanner'];
    for (const id of order) {
      const c = St.upgradeCost(id);
      if (c != null && c <= s.credits) {
        const name = id === 'drone' ? D.DRONE.name : D.SHUTTLE.find(u => u.id === id).name;
        const why = { laser: '- breaks blocks faster', fuel: '- longer sorties', drone: '- more offline credits', thruster: '- faster flying', hull: '- survive debris', heatsink: '- fire longer', targeting: '- longer lock range', reactor: '- more boost', scanner: '- see block values' }[id];
        return { name, cost: c, why };
      }
    }
    return null;
  }

  function drawShipPreview(canvas, look) {
    const c = canvas || $('shipPreview'); if (!c) return;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.save(); g.translate(c.width / 2, c.height / 2 + 2); g.scale(c.height / 35, c.height / 35);
    SM.Sortie.drawHull(g, look || SM.Meta.look(), { thrust: 0.5 + 0.1 * Math.min(5, St.lvl('thruster')), boosting: St.lvl('reactor') >= 3 });
    g.restore();
  }

  // ---------- upgrades ----------
  function upgradeRow(def, id, effect) {
    const s = St.get();
    const l = St.lvl(id), max = 5, cost = St.upgradeCost(id);
    const pips = Array.from({ length: max }, (_, i) => `<i class="${i < ((l - 1) % max) + 1 ? 'on' : ''}"></i>`).join(''); // fills every 5 levels
    const can = cost != null && s.credits >= cost;
    const btn = cost == null ? '<span class="tag grey">MAX</span>'
      : `<button class="btn ${can ? '' : 'ghost'} small-btn buy" data-buy="${id}" ${can ? '' : 'aria-disabled="true"'}>${fmt(cost)} cr</button>`;
    return `<div class="card up">
      <div><div class="name">${esc(def.name)} <span class="small muted">Lv ${l}</span></div><div class="pips">${pips}</div></div>
      ${btn}
      <div class="eff">${effect}</div>
    </div>`;
  }
  function pct(v) { return (v >= 0 ? '+' : '') + Math.round(v * 100) + '%'; }

  // ---------- auto upgrade (settings.autoUpgrade) ----------
  // Runs every second in the hangar (never during a sortie) and spends whatever new credits came in.
  function runAutoUpgrade() {
    if (document.body.classList.contains('in-sortie')) return false;
    const r = St.autoUpgrade();
    if (!r.bought.length) return false;
    SM.Audio.buy();
    const names = r.bought.map(b => `${b.name} Lv ${b.lv}`);
    const total = r.bought.reduce((a, b) => a + b.cost, 0);
    toast(`Auto upgrade: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3} more` : ''} (-${fmt(total)} cr)`);
    r.unlocked.forEach(x => toast(`New field unlocked: ${x.name}!`));
    render();
    return true;
  }
  function renderAutoUpCard() {
    const el = $('autoUpCard'); if (!el) return;
    const s = St.get(), on = !!s.settings.autoUpgrade;
    const next = St.autoUpgradeOptions()[0], reserve = St.autoUpgradeReserve();
    const status = !on ? 'Off. Turn it on and the hangar buys upgrades for you as credits come in.'
      : next ? `Next: <b>${esc(next.name)} Lv ${next.lv}</b> (${fmt(next.cost)} cr)${reserve > 0 ? ` - keeping ${fmt(reserve)} cr for repairs` : ''}`
      : 'Everything it can buy is maxed out.';
    el.innerHTML = `<label class="setting"><span><b>Auto upgrade</b><br><span class="small muted">${status}</span></span>
      <input type="checkbox" class="switch" id="autoUpTgl" ${on ? 'checked' : ''} aria-label="Auto upgrade"></label>`;
    $('autoUpTgl').addEventListener('change', e => {
      s.settings.autoUpgrade = e.target.checked; St.save(); SM.Audio.click();
      toast(`Auto upgrade ${s.settings.autoUpgrade ? 'on' : 'off'}`);
      if (!runAutoUpgrade()) render();
    });
  }

  function renderUpgrades() {
    renderAutoUpCard();
    const list = $('upgradeList');
    let html = '';
    const S = St.stats();
    if (seg === 'shuttle') {
      D.SHUTTLE.filter(u => !u.gear).forEach(u => {
        const l = St.lvl(u.id), cur = u.per * (l - 1), nxt = u.per * l;
        const maxed = St.upgradeCost(u.id) == null;
        let extra = '';
        if (u.id === 'laser') extra = ` (${S.dps.toFixed(1)} dmg/s)`;
        let eff = `${u.stat}: ${pct(cur)}${extra}` + (maxed ? '' : ` &rarr; <b>${pct(nxt)}</b>`);
        if (u.id === 'heatsink') {
          const fire = S.heat * D.BASE.ventAt, coolT = S.heat * (D.BASE.ventAt - D.BASE.resumeAt) / S.cool;
          eff = `Heat capacity ${pct(cur)}${maxed ? '' : ` &rarr; <b>${pct(nxt)}</b>`}, cooling speed ${pct(u.coolPer * (l - 1))}${maxed ? '' : ` &rarr; <b>${pct(u.coolPer * l)}</b>`}<br>Now: fires ${fire.toFixed(1)}s, then cools ${coolT.toFixed(1)}s`;
        }
        html += upgradeRow(u, u.id, eff);
      });
      // ship weapons & systems (DATA.SHIP_GEAR): level 1 = not fitted
      html += `<h3>Ship weapons &amp; systems</h3><div class="card small muted">Fitted to the shuttle and always on: no ammo, no button. Guns and beams fire with <b>FIRE</b>; sentries, point defence and the deflector work by themselves. The first purchase fits the part.</div>`;
      const G = D.SHIP_GEAR, rp = 1 + D.RANK_POWER * (St.rank() - 1);
      const per = id => D.SHUTTLE.find(u => u.id === id).per;
      const grow = (l, k) => (1 + k * (l - 2)) * rp;
      const gearEff = {
        wide: l => l < 2 ? 'Not fitted' : `Laser also burns the 4 blocks around its target at ${Math.round(Math.min(1, per('wide') * (l - 1)) * 100)}% power`,
        split: l => l < 2 ? 'Not fitted' : `Second beam on the next-nearest block at ${Math.round(Math.min(1, per('split') * (l - 1)) * 100)}% power (no extra heat)`,
        minigun: l => l < 2 ? 'Not fitted' : `${(G.minigun.dps * grow(l, G.minigun.perLevel)).toFixed(1)} dmg/s, never overheats, hits scavengers first`,
        sentry: l => l < 2 ? 'Not fitted' : `${l - 1} sentr${l === 2 ? 'y' : 'ies'} at ${(G.sentry.dps * grow(l, G.sentry.perLevel)).toFixed(1)} dmg/s each, dropped where you mine. Each shoots down an asteroid every ${(G.sentry.flakCd * Math.pow(G.sentry.flakShrink, l - 2)).toFixed(1)}s and guards the miner on a spacewalk`,
        pd: l => l < 2 ? 'Not fitted' : `Zaps a nearby debris rock every ${(G.pd.cd * Math.pow(G.pd.shrink, l - 2)).toFixed(1)}s`,
        deflector: l => l < 2 ? 'Not fitted' : `Absorbs one debris or mine hit, recharges in ${Math.round(G.deflector.recharge * Math.pow(G.deflector.shrink, l - 2))}s`,
      };
      D.SHUTTLE.filter(u => u.gear).forEach(u => {
        const l = St.lvl(u.id);
        html += upgradeRow(u, u.id, gearEff[u.id](l) + (St.upgradeCost(u.id) == null ? '' : ` &rarr; <b>${gearEff[u.id](l + 1)}</b>`));
      });
    } else if (seg === 'miner') {
      const u0 = D.MINER[0], u1 = D.MINER[1], u2 = D.MINER[2];
      const rl = St.lvl('repair');
      html += upgradeRow(u0, 'repair', `Repair cost: -${Math.round((1 - S.repairMult) * 100)}%` + ` &rarr; <b>-${Math.round((1 - Math.pow(0.92, rl)) * 100)}%</b>`);
      const sl = St.lvl('suit');
      html += upgradeRow(u1, 'suit', `Credits kept after hull failure: ${Math.round(S.emergencyShare * 100)}%` + ` &rarr; <b>${Math.round((1 - (1 - D.BASE.emergencyShare) * Math.pow(0.8, sl)) * 100)}%</b>`);
      const fl = St.lvl('fscan');
      html += upgradeRow(u2, 'fscan', `Contract rewards: ${pct(S.contractBonus - 1)}` + (St.upgradeCost('fscan') == null ? '' : ` &rarr; <b>${pct(0.15 * fl)}</b>`));
      html += `<h3>Spacewalk gear</h3><div class="card small muted">Tap <b>EVA</b> during a sortie to leave the ship on a tether. The hand drill <b>ignores block resistance</b> (great on cobalt, iridium and alloy), and glowing <b>relics</b> can only be picked up on foot. Oxygen refills once you're back aboard; debris and electrical fields drain it.</div>`;
      html += `<div class="card small muted"><b>Giant rocks:</b> every field has a giant hollow rock the ship's laser can't hurt. Park at its gold hatch, go EVA, squeeze inside and drill out the whole core (inside, the walls shelter you from debris). Then the shell turns weak: break it with the ship for a jackpot. A stronger drill, more oxygen and a wide drill head make this much faster, and the core gets tougher in later fields.</div>`;
      const evaEff = {
        eva: l => `Speed ${Math.round(D.EVA.speed * (1 + 0.15 * (l - 1)))}`,
        o2: l => `Oxygen ${Math.round(D.EVA.o2 * (1 + 0.25 * (l - 1)))}s`,
        drill: l => `Drill ${(D.EVA.drillDps * (1 + 0.30 * (l - 1)) * (1 + D.RANK_POWER * (St.rank() - 1))).toFixed(1)} dmg/s (ignores resistance)`,
        bit: l => `Also cuts the 4 cells around the target at ${Math.round(Math.min(1, D.MINER.find(x => x.id === 'bit').per * (l - 1)) * 100)}% power`,
      };
      ['eva', 'o2', 'drill', 'bit'].forEach(id => {
        const u = D.MINER.find(x => x.id === id), l = St.lvl(id);
        html += upgradeRow(u, id, evaEff[id](l) + (St.upgradeCost(id) == null ? '' : ` &rarr; <b>${evaEff[id](l + 1)}</b>`));
      });
      html += `<div class="card small muted">Miner rank (Rank ${St.rank()}) is earned from mining, discoveries and contracts. Each rank after 1 adds ${Math.round(D.RANK_POWER * 100)}% laser and drill power, applied on the next launch. Rank 3 unlocks a second contract slot; ranks also unlock shuttle paints (see Contracts tab).</div>`;
    } else if (seg === 'weapons') {
      const wp = St.get().weapons;
      html += `<div class="card small muted">Secondary weapons fire from the button next to BOOST during a sortie. Buy once, then upgrade (+30% damage, +1 ammo per level). Ammo restocks free on every launch. <b>Reloading mid-run:</b> every destroyed block adds salvage (rock 1, iron 2, crystal 3, cobalt 5, iridium 8, glass 6, alloy 12) and every ${D.SALVAGE_PER_SHOT} salvage reloads 1 shot (gold ring around the button). Or tap <b>+1</b> to buy a shot with credits. Owning more than one adds a swap button.</div>`;
      D.WEAPONS.forEach(d => {
        const lv = St.weaponLvl(d.id), cost = St.weaponCost(d.id), st = St.weaponStats(d.id, Math.max(1, lv));
        const nx = lv && cost != null ? St.weaponStats(d.id, lv + 1) : null;
        const can = cost != null && St.get().credits >= cost;
        const eq = wp.equipped === d.id;
        const chips = [`Damage ${Math.round(st.dmg)}${nx ? ` &rarr; <b>${Math.round(nx.dmg)}</b>` : ''}`,
          d.radius ? `Blast ${d.radius}` : `Length ${d.range}`, `Ammo ${st.ammo}${nx ? ` &rarr; <b>${nx.ammo}</b>` : ''}`, `Reload ${St.reloadCost(d.id)} cr/shot`]
          .map(c => `<span class="chip">${c}</span>`).join('');
        html += `<div class="card wcard ${eq ? 'region sel' : ''}">
          <div class="row" style="justify-content:flex-start"><div class="wicon" style="color:${d.color}">${d.icon}</div>
            <div><b>${esc(d.name)}</b> ${lv ? `<span class="small muted">Lv ${lv}</span>` : '<span class="tag grey">LOCKED</span>'}${eq ? ' <span class="tag blue">EQUIPPED</span>' : ''}
            <div class="small muted">${esc(d.desc)}</div></div></div>
          <div class="wstats">${chips}</div>
          <div class="btns">
            ${cost == null ? '<span class="tag grey">MAX</span>' : `<button class="btn ${can ? '' : 'ghost'} small-btn" data-wbuy="${d.id}">${lv ? 'Upgrade' : 'Buy'} - ${fmt(cost)} cr</button>`}
            ${lv && !eq ? `<button class="btn ghost small-btn" data-equip="${d.id}">Equip</button>` : ''}
          </div>
        </div>`;
      });
      html += renderAuto();
    } else {
      // ----- escort wing -----
      const wing = St.get().wing, wc = St.wingCost(), canW = wc != null && St.get().credits >= wc;
      html += `<h3>Escort wing</h3><div class="card">
        <div class="row"><div><b>Escort drones</b> <span class="small muted">${wing.count}/${D.WING.max} owned</span>
          <div class="small muted">They fly around you during a sortie, each picks its own block within reach and mines it. They vent heat and resume by themselves. Every drone has its own upgrades plus a weapon slot and a gear slot (below). Each one also adds +${Math.round(D.WING.offlineBonus * 100)}% to the drone bay's offline rate.</div></div></div>
        <div class="wstats" style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">${Array.from({ length: D.WING.max }, (_, i) => `<span class="chip">${i < wing.count ? '&#9650; Drone ' + (i + 1) : '&#9651; empty'}</span>`).join('')}</div>
        ${wc == null ? '<span class="tag grey">WING FULL</span>' : `<button class="btn ${canW ? '' : 'ghost'} small-btn" data-wingbuy>Buy drone ${wing.count + 1} - ${fmt(wc)} cr</button>`}
      </div>`;
      // ----- per-drone loadouts -----
      wing.drones.forEach((d, i) => {
        const ds = St.droneStats(d);
        const ups = D.WING.upgrades.map(u => {
          const l = d.lv[u.id], c = St.droneUpCost(i, u.id), can = c != null && St.get().credits >= c;
          const pips = Array.from({ length: 5 }, (_, k) => `<i class="${k < ((l - 1) % 5) + 1 ? 'on' : ''}"></i>`).join('');
          return `<div class="dup"><div><b>${{ wlaser: 'Laser', wcool: 'Heat sink', wengine: 'Engines' }[u.id]}</b> <span class="small muted">Lv ${l}</span><div class="pips">${pips}</div></div>
            ${c == null ? '<span class="tag grey">MAX</span>' : `<button class="btn ${can ? '' : 'ghost'} small-btn" data-dup="${i}:${u.id}">${fmt(c)} cr</button>`}</div>`;
        }).join('');
        const mods = (list, slot) => list.map(m => {
          const own = d.owned[m.id], on = d[slot] === m.id, can = St.get().credits >= m.cost;
          const label = on ? 'Equipped' : own ? 'Equip' : `${fmt(m.cost)} cr`;
          return `<button class="mod ${on ? 'on' : ''} ${!own && !can ? 'poor' : ''}" data-mod="${i}:${m.id}" title="${esc(m.desc)}">
            <span class="micon">${m.icon}</span><b>${esc(m.name)}</b><small>${esc(m.desc)}</small><em>${label}</em></button>`;
        }).join('');
        html += `<div class="card dcard">
          <div class="row"><b>&#9650; Drone ${i + 1}</b><span class="small muted">${ds.dps.toFixed(1)} dmg/s - fires ${ds.fire.toFixed(1)}s - reach ${Math.round(ds.reach)}</span></div>
          <div class="dups">${ups}</div>
          <div class="label" style="margin-top:10px">Weapon slot</div><div class="mods">${mods(D.WING.weapons, 'weapon')}</div>
          <div class="label" style="margin-top:10px">Gear slot</div><div class="mods">${mods(D.WING.gear, 'gear')}</div>
        </div>`;
      });
      html += `<h3>Offline drone bay</h3>`;
      const l = St.lvl('drone');
      const best = Math.max(0, ...St.get().unlocked.map(id => D.REGIONS.findIndex(r => r.id === id)));
      const mult = D.REGIONS[best].drone;
      const wingMult = (1 + D.WING.offlineBonus * St.get().wing.count) * St.prestigeDroneMult();
      const nxt = ` &rarr; <b>${fmt(St.droneBaseRate(l + 1) * mult * wingMult)} cr/hr, ${St.droneCapAt(l + 1)}h</b>`;
      html += upgradeRow(D.DRONE, 'drone', `${fmt(St.droneRate())} cr/hr, stores ${St.droneCap()}h (${fmt(St.droneCapCredits())} cr)` + nxt);
      const sl = St.lvl('silo'), sMax = St.upgradeCost('silo') == null;
      html += upgradeRow(D.SILO, 'silo', `+${St.siloHours()}h storage${sMax ? ` (max ${D.SILO.maxHours}h total)` : ` &rarr; <b>+${St.siloHours(sl + 1)}h, ${fmt(St.droneRate() * St.droneCapAt(l, sl + 1))} cr max</b>`}`);
      const ds = St.droneStatus();
      html += `<div class="card"><div class="small muted">The drone mines in real time, even while the game is closed. Collect its storage from the hangar. Unlocking richer fields raises its rate (current field bonus: x${mult}).</div>${droneFormula(ds).replace('<details class="formula">', '<details class="formula" open>')}
        <div class="label" style="margin-top:8px">Your next levels (no cap) at current bonuses</div>
        ${[0, 1, 2, 3, 4].map(k => { const L = l + k, r = St.droneBaseRate(L) * mult * wingMult, h = St.droneCapAt(L); return `<div class="sum ${k === 0 ? 'pos' : ''}"><span>Lv ${L}${k === 0 ? ' (you)' : ''}</span><span>${fmt(r)} cr/hr - ${h}h - ${fmt(r * h)} cr max</span></div>`; }).join('')}
      </div>`;
    }
    list.innerHTML = html;
    list.querySelectorAll('[data-dup]').forEach(b => b.addEventListener('click', () => {
      const [i, id] = b.dataset.dup.split(':');
      if (St.buyDroneUp(+i, id)) { SM.Audio.buy(); render(); } else { SM.Audio.deny(); toast('Not enough credits'); }
    }));
    list.querySelectorAll('[data-mod]').forEach(b => b.addEventListener('click', () => {
      const [i, id] = b.dataset.mod.split(':');
      const r = St.droneModule(+i, id), name = St.moduleDef(id).name;
      if (r === 'poor') { SM.Audio.deny(); return toast('Not enough credits'); }
      SM.Audio[r === 'bought' ? 'buy' : 'click']();
      toast(r === 'bought' ? `${name} installed on drone ${+i + 1}` : r === 'equipped' ? `${name} equipped` : `${name} removed`);
      render();
    }));
    list.querySelectorAll('[data-wingbuy]').forEach(b => b.addEventListener('click', () => {
      SM.Audio.unlock();
      if (St.buyWingDrone()) { SM.Audio.buy(); toast(`Escort drone ${St.get().wing.count} joined your wing`); render(); }
      else { SM.Audio.deny(); toast('Not enough credits'); }
    }));
    list.querySelectorAll('[data-wbuy]').forEach(b => b.addEventListener('click', () => {
      SM.Audio.unlock();
      if (St.buyWeapon(b.dataset.wbuy)) { SM.Audio.buy(); toast(St.weaponDef(b.dataset.wbuy).name + ' ready'); render(); }
      else { SM.Audio.deny(); toast('Not enough credits'); }
    }));
    list.querySelectorAll('[data-abuy]').forEach(b => b.addEventListener('click', () => {
      SM.Audio.unlock();
      if (St.buyAuto(b.dataset.abuy)) { SM.Audio.buy(); toast(St.autoDef(b.dataset.abuy).name + ' installed'); render(); }
      else { SM.Audio.deny(); toast('Not enough credits'); }
    }));
    list.querySelectorAll('[data-atgl]').forEach(b => b.addEventListener('click', () => {
      SM.Audio.click(); St.toggleAuto(b.dataset.atgl);
      toast(St.autoDef(b.dataset.atgl).name + (St.autoOn(b.dataset.atgl) ? ' on' : ' off')); render();
    }));
    list.querySelectorAll('[data-equip]').forEach(b => b.addEventListener('click', () => { St.equipWeapon(b.dataset.equip); SM.Audio.click(); render(); }));
    list.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
      SM.Audio.unlock();
      const id = b.dataset.buy;
      if (St.buy(id)) {
        SM.Audio.buy();
        const un = St.checkUnlocks(); St.save();
        un.forEach(r => toast(`New field unlocked: ${r.name}!`));
        render();
      } else { SM.Audio.deny(); toast('Not enough credits'); }
    }));
  }

  // ---------- ship automation (Upgrades > Weapons) ----------
  function autoEffect(id, l) {
    const A = D.AUTO, nx = l + 1;
    if (id === 'fcs') return l ? `Auto-shot every ${St.fcsDelay(l).toFixed(1)}s at most` + (St.fcsDelay(nx) < St.fcsDelay(l) ? ` &rarr; <b>${St.fcsDelay(nx).toFixed(1)}s</b>` : '') : `Fires at most every ${A.fcsDelay.toFixed(1)}s`;
    if (id === 'loader') return l ? `Reloads ${Math.round((1 - Math.pow(A.loaderStep, l - 1)) * 100)}% cheaper &rarr; <b>${Math.round((1 - Math.pow(A.loaderStep, l)) * 100)}%</b>` : 'Auto-buys from sortie credits only';
    if (id === 'racks') return `Extra ammo per weapon: +${l}` + ` &rarr; <b>+${nx}</b>`;
    return '';
  }
  function renderAuto() {
    const s = St.get();
    let html = `<h3>Ship automation</h3>`;
    if (!D.WEAPONS.some(d => St.weaponLvl(d.id))) return html + `<div class="card small muted">Buy a secondary weapon first. Automation modules then fire it, swap it and keep it loaded for you.</div>`;
    html += `<div class="card small muted">Modules that use your weapons for you. Switch any of them off here at any time; the fire-control computer also has a <b>WPN</b> auto switch in the sortie controls (key H). Auto-shots skip the tutorial and spacewalks.</div>`;
    D.AUTO.modules.forEach(m => {
      const l = St.autoLvl(m.id), cost = St.autoCost(m.id), can = cost != null && s.credits >= cost, on = St.autoOn(m.id);
      const lvTag = l ? (m.max === 1 ? '<span class="tag blue">OWNED</span>' : `<span class="small muted">Lv ${l}</span>`) : '<span class="tag grey">LOCKED</span>';
      const eff = autoEffect(m.id, l);
      html += `<div class="card wcard">
        <div class="row" style="justify-content:flex-start"><div class="wicon">${m.icon}</div>
          <div><b>${esc(m.name)}</b> ${lvTag}<div class="small muted">${esc(m.desc)}</div></div></div>
        ${eff ? `<div class="wstats"><span class="chip">${eff}</span></div>` : ''}
        <div class="btns">
          ${cost == null ? (m.max === 1 ? '' : '<span class="tag grey">MAX</span>') : `<button class="btn ${can ? '' : 'ghost'} small-btn" data-abuy="${m.id}">${l ? 'Upgrade' : 'Buy'} - ${fmt(cost)} cr</button>`}
          ${l && m.toggle ? `<button class="btn ${on ? '' : 'ghost'} small-btn" data-atgl="${m.id}" aria-pressed="${on}">${on ? 'ON' : 'OFF'}</button>` : ''}
        </div>
      </div>`;
    });
    return html;
  }

  // ---------- regions ----------
  function renderRegions() {
    const s = St.get();
    const th = St.threat();
    const thCard = `<div class="card"><div class="row"><div><div class="label">Threat level</div><div class="big">${th.level.toFixed(2)}</div></div><div class="small muted" style="text-align:right">Blocks x${th.hp.toFixed(2)} health<br>Credits x${th.value.toFixed(2)}<br>Hazards x${th.hazard.toFixed(2)}</div></div>
      <div class="small muted" style="margin-top:6px">Fields change each launch. Power (rank, laser, escort drones, weapons) makes blocks richer and hazards stronger; laser upgrades outpace block health so mining gets faster.</div></div>`;
    $('regionList').innerHTML = thCard + D.REGIONS.map(r => {
      const rs = St.regionStatus(r);
      const mats = Array.from(new Set([...Object.keys(r.shell), ...Object.keys(r.core)]));
      const chips = mats.map(m => {
        const md = D.MATERIALS[m], known = s.discovered[m] || rs.unlocked;
        return `<span class="chip"><span class="sw" style="background:${md.color}"></span>${known ? esc(md.name) + ' - ' + fmt(md.value * th.value) + 'cr' : 'Unknown'}</span>`;
      }).join('');
      const sel = s.region === r.id;
      const recLaser = r.laser;
      const feats = D.features(r, m => s.discovered[m] || rs.unlocked);
      let foot;
      if (rs.unlocked) {
        foot = sel ? '<span class="tag blue">SELECTED</span>' : `<button class="btn small-btn" data-region="${r.id}">Select</button>`;
      } else {
        foot = `<div class="req">Requires: <span class="${rs.okCredits ? 'ok' : 'no'}">${fmt(r.lifetime)} lifetime credits (${fmt(Math.min(s.lifetime, r.lifetime))})</span> and <span class="${rs.okLaser ? 'ok' : 'no'}">Laser Lv ${r.laser}</span></div>`;
      }
      return `<div class="card region ${sel ? 'sel' : ''} ${rs.unlocked ? '' : 'locked'}">
        <div class="row"><b>${rs.unlocked ? '' : '&#128274; '}${esc(r.name)}</b><span class="small muted">Hazard: ${r.hazard}</span></div>
        <div class="small muted">${esc(r.desc)}</div>
        <div class="mats">${chips}</div>
        ${feats.length ? `<ul class="feats small">${feats.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        <div class="small muted">Recommended: Laser Lv ${recLaser}+${D.REGIONS.indexOf(r) >= 4 ? ', Hull Lv 3+' : ''}. First-visit bonus: ${fmt(r.bonus)} cr. Drone bay x${r.drone}</div>
        <div style="margin-top:8px">${foot}</div>
      </div>`;
    }).join('');
    $('regionList').querySelectorAll('[data-region]').forEach(b => b.addEventListener('click', () => {
      St.get().region = b.dataset.region; St.save(); SM.Audio.click(); render();
    }));
  }

  // ---------- daily / weekly orders (js/meta.js) ----------
  function orderHtml(o, mult) {
    const have = SM.Meta.progress(o);
    return `<div class="contract order ${o.done ? 'done' : ''}" style="margin-top:6px">
      <div class="row"><b>${o.done ? '&#10003; ' : ''}${esc(o.name)}</b><span class="coin" style="font-weight:800">${fmt(Math.round(o.credits * (mult || 1)))} cr</span></div>
      <div class="prog"><i style="width:${Math.min(100, have / o.need * 100)}%"></i></div>
      <div class="small">${fmt(have)} / ${fmt(o.need)} <span class="muted">+${o.xp} XP, +${o.stars} &#9733;</span></div>
    </div>`;
  }
  function renderOrders() {
    const s = St.get(), m = s.meta, O = D.ORDERS;
    SM.Meta.refresh();
    const stk = SM.Meta.streak(), sm = SM.Meta.streakMult();
    const dAll = m.daily.orders.every(o => o.done), wAll = m.weekly.orders.every(o => o.done);
    $('orderList').innerHTML = `<div class="small muted">Progress counts on every sortie - no need to accept. Stars: <b>${fmt(m.stars)} &#9733;</b></div>
      <div class="card"><div class="row"><b>Daily orders</b><span class="small muted">new in ${dur(SM.Meta.nextMidnight() - Date.now())}</span></div>
        <div class="small">${stk ? `Streak: <b>${stk}</b> day${stk === 1 ? '' : 's'} in a row (+${Math.round((sm - 1) * 100)}% daily rewards). ` : ''}Finish all three for a bonus (+${O.allDailyStars} &#9733;)${dAll ? ' - <b class="pos">done today!</b>' : ''}. Each day in a row adds ${Math.round(O.streakStep * 100)}% (up to ${O.streakMax} days).</div>
        ${m.daily.orders.map(o => orderHtml(o, sm)).join('')}</div>
      <div class="card"><div class="row"><b>Weekly orders</b><span class="small muted">new in ${dur(SM.Meta.nextMonday() - Date.now())}</span></div>
        <div class="small">Finish all three for +${O.allWeeklyStars} &#9733;${wAll ? ' - <b class="pos">done this week!</b>' : ''}</div>
        ${m.weekly.orders.map(o => orderHtml(o)).join('')}</div>`;
  }

  // ---------- contracts ----------
  function contractHtml(c, offer) {
    const reg = D.REGIONS.find(r => r.id === c.region);
    const reward = Math.round(c.reward * St.stats().contractBonus);
    return `<div class="contract" style="margin-top:6px">
      <div class="row"><b>${esc(c.title)}</b><span class="coin" style="font-weight:800">${fmt(reward)} cr</span></div>
      <div class="small muted">${esc(c.text)}${c.kind === 'material' ? '' : ''} <span class="small">(+${c.xp} XP)</span></div>
      ${offer ? '' : `<div class="prog"><i style="width:${Math.min(100, c.have / c.need * 100)}%"></i></div><div class="small">${fmt(c.have)} / ${fmt(c.need)}${c.kind === 'speed' ? ' best run' : ''}</div>`}
      ${offer ? `<button class="btn small-btn" data-accept="${c.id}" style="margin-top:8px">Accept</button>` : ''}
      ${!offer && screen === 'contracts' ? `<button class="btn ghost small-btn" data-abandon="${c.id}" style="margin-top:8px">Abandon</button>` : ''}
      ${reg && c.kind !== 'material' ? '' : ''}
    </div>`;
  }
  function renderContracts() {
    const s = St.get();
    renderOrders();
    if (s.stats.sorties < 1) {
      $('contractInfo').textContent = 'Contracts open up after your first sortie.';
      $('contractActive').innerHTML = ''; $('contractOffers').innerHTML = '';
    } else {
      St.refreshContracts(false); St.save();
      const ms = St.nextRefreshMs();
      $('contractInfo').textContent = `Slots: ${s.contracts.active.length}/${St.contractSlots()}. New offers in ${Math.floor(ms / 3600000)}h ${Math.floor(ms / 60000) % 60}m. Completed: ${s.contracts.done}.`;
      $('contractActive').innerHTML = s.contracts.active.length ? s.contracts.active.map(c => `<div class="card">${contractHtml(c)}</div>`).join('') : '<div class="small muted">None yet.</div>';
      const full = s.contracts.active.length >= St.contractSlots();
      $('contractOffers').innerHTML = s.contracts.offers.map(c => `<div class="card">${contractHtml(c, !full)}</div>`).join('') || '<div class="small muted">No offers right now.</div>';
    }
    // rank rewards
    const r = St.rank();
    let rr = `<div class="card"><div class="small">Rank ${r} - ${fmt(s.xp)} XP (next at ${fmt(St.rankXp(r + 1))})</div>
      <div class="small muted">Rank bonus: +${Math.round((r - 1) * D.RANK_POWER * 100)}% laser and drill power. Each rank adds ${Math.round(D.RANK_POWER * 100)}%.</div>`;
    rr += `<div class="small muted" style="margin:6px 0">Rank 3: second contract slot ${r >= 3 ? '&#10003;' : ''}</div>`;
    rr += `<div class="small muted">Ranks 2 / 4 / 6 / 8 unlock paints, 12 and 15 an engine trail and a laser colour. <button class="btn ghost small-btn" data-goto="career" id="toStyle">Ship style</button></div></div>`;
    $('rankRewards').innerHTML = rr;
    document.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', () => { St.acceptContract(b.dataset.accept); SM.Audio.buy(); render(); }));
    document.querySelectorAll('[data-abandon]').forEach(b => b.addEventListener('click', () => { St.abandonContract(b.dataset.abandon); SM.Audio.click(); render(); }));
    $('toStyle').addEventListener('click', () => { cseg = 'style'; });
  }

  // ---------- modals ----------
  function openModal(html, locked) {
    $('modalBody').innerHTML = html;
    $('modal').hidden = false;
    if (locked) $('modal').dataset.locked = '1'; else delete $('modal').dataset.locked;
  }
  function closeModal() { $('modal').hidden = true; }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2400);
  }

  function showSummary(res, extra) {
    const reasons = { return: 'Returned safely', fuel: 'Fuel empty - towed home', time: 'Shift over - autopilot home', hull: 'Hull failure - emergency return', recovered: 'Recovered from an interrupted sortie' };
    const mats = Object.keys(res.byMat).map(m => `<div class="sum"><span>${esc(D.MATERIALS[m].name)} x${res.byMat[m]}</span><span>${fmt(res.byMatCr ? res.byMatCr[m] || 0 : res.byMat[m] * D.MATERIALS[m].value)}</span></div>`).join('') || '<div class="sum muted"><span>No blocks destroyed</span><span>0</span></div>';
    let rows = mats;
    if (res.cleared > 0) {
      const endR = D.REGIONS.find(x => x.id === res.endRegion);
      rows += `<div class="sum"><span>Fields cleared x${res.cleared} - reached ${esc(endR ? endR.name : '')}</span><span class="pos">+${fmt(res.clearBonus || 0)}</span></div>`;
    }
    (res.events || []).forEach(e => {
      const n = D.EVENTS.kinds[e.kind].name;
      rows += e.done ? `<div class="sum"><span>&#9733; ${esc(n)}${e.kind === 'derelict' ? ' salvaged' : ' destroyed'}</span><span>${fmt(e.credits)}</span></div>`
        : `<div class="sum muted"><span>${esc(n)} ${e.kind === 'comet' ? 'got away' : 'left behind'}</span><span>0</span></div>`;
    });
    if (res.giants > 0) rows += `<div class="sum"><span>Giant rocks cracked x${res.giants} (jackpot)</span><span>${fmt(res.giantCr)}</span></div>`;
    if (res.relicCount > 0) rows += `<div class="sum"><span>Relics recovered x${res.relicCount}</span><span>${fmt(res.relicCredits)}</span></div>`;
    if (res.ammoRun > 0) rows += `<div class="sum"><span>Ammo reloads bought (${res.shotsBought})</span><span class="neg">-${fmt(res.ammoRun)}</span></div>`;
    if (res.emergency) rows += `<div class="sum"><span>Emergency loss (kept ${Math.round(res.share * 100)}%)</span><span class="neg">-${fmt(res.raw - res.credits)}</span></div>`;
    (extra.contracts || []).forEach(c => (rows += `<div class="sum"><span>Contract: ${esc(c.title)}</span><span class="pos">+${fmt(c.paid)}</span></div>`));
    (extra.bonuses || []).forEach(b => (rows += `<div class="sum"><span>${esc(b.label)}</span><span class="pos">+${fmt(b.amount)}</span></div>`));
    (extra.orders || []).forEach(o => (rows += `<div class="sum"><span>${esc(o.label)}${o.stars ? ` <span class="small">+${o.stars} &#9733;</span>` : ''}</span><span class="pos">+${fmt(o.credits)}</span></div>`));
    const total = res.credits + (extra.contracts || []).reduce((a, c) => a + c.paid, 0) + (extra.bonuses || []).reduce((a, b) => a + b.amount, 0) + (extra.orders || []).reduce((a, o) => a + o.credits, 0);
    rows += `<div class="sum total"><span>Total banked</span><span>+${fmt(total)} cr</span></div>`;
    const repair = St.repairCost();
    const notes = [];
    if (res.ammoWallet > 0) notes.push(`Also paid ${fmt(res.ammoWallet)} cr from your wallet for reloads.`);
    if (res.autoShots > 0) notes.push(`Fire-control computer fired ${res.autoShots} shot${res.autoShots === 1 ? '' : 's'}.`);
    if (res.autoLoads > 0) notes.push(`Autoloader bought ${res.autoLoads} shot${res.autoLoads === 1 ? '' : 's'} from sortie credits.`);
    if (extra.autoRepair) notes.push(`Dock repair crew fixed ${extra.autoRepair.pts} hull for ${fmt(extra.autoRepair.cost)} cr.`);
    if (res.shotsSalvaged > 0) notes.push(`Salvage reloaded ${res.shotsSalvaged} weapon shot${res.shotsSalvaged === 1 ? '' : 's'}.`);
    if (res.hullLost > 0) notes.push(`Hull damage: -${res.hullLost}. Repair quote: <b>${fmt(repair)} cr</b>.`);
    if (extra.rankUp) notes.push(`<b class="pos">Rank up! You are now Rank ${extra.rankUp}, with +${Math.round((extra.rankUp - 1) * D.RANK_POWER * 100)}% laser and drill power.</b>`);
    (extra.unlocked || []).forEach(r => notes.push(`<b class="pos">New field unlocked: ${esc(r.name)}!</b>`));
    (extra.achievements || []).forEach(a => notes.push(`<b class="pos">&#127942; Achievement: ${esc(a.name)}</b> - ${esc(a.text)} (+${a.stars} &#9733;)`));
    const rec = recommended();
    if (rec) notes.push(`You can afford: <b>${esc(rec.name)}</b> ${esc(rec.why)}`);
    openModal(`<h2>Sortie summary</h2>
      <div class="small muted">${reasons[res.reason] || ''} - ${res.blocks} block${res.blocks === 1 ? '' : 's'} in ${Math.round(res.time || 0)}s - +${res.xp} XP</div>
      <div>${rows}</div>
      ${notes.map(n => `<div class="small">${n}</div>`).join('')}
      <button class="btn launch" id="sumAgain">LAUNCH AGAIN</button>
      <button class="btn ghost" id="sumHangar">${rec ? 'Go to upgrades' : 'Back to hangar'}</button>`, true);
    $('sumAgain').addEventListener('click', () => { closeModal(); SM.Main.launch(); });
    $('sumHangar').addEventListener('click', () => { closeModal(); goto(rec ? 'upgrades' : 'home'); });
  }

  // Welcome back: what the drone did, plus what changed while away (orders, streak, contracts, rebirth).
  // news = { fresh: { daily, weekly } from SM.Meta.refresh(), contractsDue } (see main.js)
  function awayNews(o, news) {
    news = news || {};
    const s = St.get(), M = SM.Meta, m = s.meta, out = [];
    const fresh = news.fresh || {};
    const stk = M.streak();
    if (fresh.daily) {
      out.push(`<b>New daily orders</b> are in: ${m.daily.orders.map(x => esc(x.name)).join(', ')}.`);
      if (stk > 0) out.push(`Your <b>${stk}-day streak</b> is alive - finish today's three to make it ${stk + 1} (+${Math.round(D.ORDERS.streakStep * Math.min(D.ORDERS.streakMax, stk) * 100)}% daily rewards now).`);
      else if (m.daily.lastFull) out.push('Your daily streak ended. Finish all three today to start a new one.');
    } else {
      const left = m.daily.orders.filter(x => !x.done).length;
      if (left) out.push(`${left} daily order${left === 1 ? '' : 's'} left today (new ones in ${dur(M.nextMidnight() - Date.now())}).`);
    }
    if (fresh.weekly) out.push('<b>New weekly orders</b> are in.');
    else {
      const wl = M.nextMonday() - Date.now(), wd = m.weekly.orders.filter(x => x.done).length;
      if (wl < 86400000 && wd < m.weekly.orders.length) out.push(`Weekly orders end in <b>${dur(wl)}</b> (${wd} / ${m.weekly.orders.length} done).`);
    }
    if (news.contractsDue && s.stats.sorties >= 1) out.push('New contract offers are waiting.');
    if (St.canRebirth()) out.push(`Rebirth is available: <b>+${St.shardsFor(s.lifetime)} core shard${St.shardsFor(s.lifetime) === 1 ? '' : 's'}</b> (Career tab).`);
    return out;
  }
  function showOffline(o, news) {
    const ds = St.droneStatus(), lines = awayNews(o, news);
    const siloCost = St.upgradeCost('silo');
    const lost = o.capped ? (o.hoursAway - o.hoursCounted) : 0;
    openModal(`<h2>Welcome back, miner</h2>
      <div class="drone-anim" style="margin:6px auto" aria-hidden="true"><span></span></div>
      <p>You were away for <b>${dur(o.awayMs)}</b>. Here's what your drone did:</p>
      <div class="sum"><span>Stored when you left</span><span>${fmt(o.storeBefore)} cr</span></div>
      <div class="sum"><span>${o.hoursCounted.toFixed(2)}h x ${fmt(o.rate)} cr/hr</span><span class="pos">+${fmt(o.gained)} cr</span></div>
      <div class="sum total"><span>In storage now</span><span>${fmt(o.store)} cr</span></div>
      ${o.capped ? `<p class="small muted">Storage hit its ${fmt(o.cap)} cr limit (${o.capHours}h) part-way through, so the last <b>${dur(lost * 3600000)}</b> earned nothing (about ${fmt(lost * o.rate)} cr missed).
        ${siloCost != null ? `A <b>${esc(D.SILO.name)}</b> level adds ${D.SILO.hoursPer}h of storage for ${fmt(siloCost)} cr.` : 'Upgrade the drone bay to store more.'}</p>` : ''}
      <div class="sum"><span>Wallet after collecting</span><b>${fmt(St.get().credits + Math.floor(o.store))} cr</b></div>
      ${lines.length ? `<div class="card" style="margin:8px 0"><div class="label">While you were away</div>${lines.map(l => `<div class="small" style="margin-top:4px">&bull; ${l}</div>`).join('')}</div>` : ''}
      <button class="btn gold" data-collect>Collect ${fmt(o.store)} cr</button>
      <button class="btn launch" id="offLaunch">Collect &amp; launch</button>
      ${o.capped && siloCost != null ? '<button class="btn ghost" id="offSilo">Collect &amp; see storage upgrades</button>' : ''}
      <button class="btn ghost" id="offLater">Leave it in storage</button>
      ${droneFormula(ds)}`);
    $('offLater').addEventListener('click', () => { closeModal(); render(); });
    $('offLaunch').addEventListener('click', () => { SM.Audio.unlock(); collectToast(St.collectDrone()); closeModal(); SM.Main.launch(); });
    if ($('offSilo')) $('offSilo').addEventListener('click', () => {
      collectToast(St.collectDrone()); closeModal();
      seg = 'drone'; document.querySelectorAll('#scr-upgrades .seg button').forEach(x => x.classList.toggle('on', x.dataset.seg === 'drone'));
      goto('upgrades');
    });
  }
  function collectToast(r) {
    if (r.credits > 0) { SM.Audio.buy(); toast(`+${fmt(r.credits)} cr from the drone`); }
    (r.orders || []).forEach(o => toast(`${o.label} +${fmt(o.credits)} cr`));
    r.unlocked.forEach(x => toast(`New field unlocked: ${x.name}!`));
  }

  function openSettings() {
    const s = St.get().settings;
    const sw = (k, label, desc) => `<label class="setting"><span>${label}${desc ? `<br><span class="small muted">${desc}</span>` : ''}</span><input type="checkbox" class="switch" data-set="${k}" ${s[k] ? 'checked' : ''}></label>`;
    const rg = (k, label, min, max, step) => `<label class="setting"><span>${label}</span><input type="range" data-range="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}"></label>`;
    openModal(`<h2>Settings</h2>
      <button class="btn ghost" data-account>Account &amp; cloud save${SM.Cloud && SM.Cloud.signedIn() ? '' : ' - sign in / sign up'}</button>
      ${rg('volume', 'Volume', 0, 1, 0.05)}
      ${sw('vibration', 'Vibration')}
      ${sw('shake', 'Screen shake')}
      ${sw('reducedFx', 'Reduced effects', 'Fewer particles, better battery')}
      ${sw('aimAssist', 'Aim assist', 'Auto-select the nearest block')}
      ${sw('autoFire', 'Auto-fire', 'Laser fires on its own at anything in range')}
      ${sw('autoBoost', 'Auto-boost', 'Boosts while flying when energy allows (burns more fuel)')}
      ${sw('autopilot', 'Autopilot', 'When you stop steering, fly to the next block and mine it')}
      ${sw('autoEva', 'Auto EVA', 'When you stop steering, the miner spacewalks by itself: into giant rocks (autopilot parks at the hatch) and out to relics in reach')}
      ${sw('autoUpgrade', 'Auto upgrade', 'In the hangar, buys upgrades for you as credits come in (keeps enough for repairs; never buys new drones, weapons or modules)')}
      ${sw('leftHanded', 'Left-handed layout', 'Buttons on the left, steer on the right')}
      ${sw('highContrast', 'High-contrast mode')}
      ${sw('captions', 'Captions', 'Text for warnings and audio cues')}
      ${rg('uiScale', 'UI scale', 0.85, 1.3, 0.05)}
      ${rg('stickOpacity', 'Control opacity', 0, 1, 0.1)}
      <button class="btn" id="setDone">Done</button>
      <button class="btn ghost" id="setReset" style="color:var(--danger)">Reset all progress</button>
      <p class="small muted">Desktop keys: WASD/arrows move, Space mine, Shift boost, Q weapon, E swap weapon, X buy reload, V spacewalk, Tab target, F/B/G toggle auto fire/boost/pilot, R return, P pause.</p>`);
    document.querySelectorAll('[data-set]').forEach(i => i.addEventListener('change', () => {
      s[i.dataset.set] = i.checked; St.save(); render(); SM.Sortie.applyLayout();
    }));
    document.querySelectorAll('[data-range]').forEach(i => i.addEventListener('input', () => {
      s[i.dataset.range] = parseFloat(i.value); St.save();
      if (i.dataset.range === 'volume') SM.Audio.setVolume(s.volume);
      if (i.dataset.range === 'uiScale') render();
    }));
    $('setDone').addEventListener('click', closeModal);
    $('setReset').addEventListener('click', () => {
      if (confirm('Erase all progress and start over? This cannot be undone.')) { St.reset(); closeModal(); goto('home'); toast('Progress reset'); }
    });
  }

  return { bind, render, goto, toast, showSummary, showOffline, openModal, closeModal, recommended };
})();
