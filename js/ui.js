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
    document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
      seg = b.dataset.seg; SM.Audio.click();
      document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
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
      const r = St.collectDrone();
      if (r.credits > 0) { SM.Audio.buy(); toast(`+${fmt(r.credits)} cr from the drone`); }
      r.unlocked.forEach(x => toast(`New field unlocked: ${x.name}!`));
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
    $('ctDot').hidden = !(s.stats.sorties >= 1 && s.contracts.active.length < St.contractSlots() && s.contracts.offers.length);
    if (screen === 'home') renderHome();
    if (screen === 'upgrades') renderUpgrades();
    if (screen === 'regions') renderRegions();
    if (screen === 'contracts') renderContracts();
  }

  function affordableAny() {
    const s = St.get();
    return [...D.SHUTTLE, ...D.MINER, { id: 'drone' }].some(u => { const c = St.upgradeCost(u.id); return c != null && c <= s.credits; })
      || D.WEAPONS.some(d => { const c = St.weaponCost(d.id); return c != null && c <= s.credits; });
  }

  function dur(ms) {
    const m = Math.ceil(ms / 60000), h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  }
  function clock(t) { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (new Date(t).toDateString() !== new Date().toDateString() ? ' tomorrow' : ''); }
  function droneMult() {
    const best = Math.max(0, ...St.get().unlocked.map(id => D.REGIONS.findIndex(r => r.id === id)));
    return D.DRONE.regionMult[best];
  }
  // Plain-language formula block, shared by the hangar card, the drone tab and the welcome-back screen.
  function droneFormula(ds) {
    const l = St.lvl('drone');
    return `<details class="formula"><summary>How it's calculated</summary>
      <div class="sum"><span>Drone Lv ${l} base rate</span><span>${fmt(D.DRONE.ratePerHour[l - 1])} cr/hr</span></div>
      <div class="sum"><span>x Best field bonus</span><span>x${droneMult()}</span></div>
      <div class="sum"><span>= Rate</span><b>${fmt(ds.rate)} cr/hr</b></div>
      <div class="sum"><span>Storage = rate x ${ds.capHours}h</span><b>${fmt(ds.cap)} cr</b></div>
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
    $('homeRegionInfo').textContent = `Hazard: ${r.hazard}`;
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

  function drawShipPreview() {
    const c = $('shipPreview'), g = c.getContext('2d');
    const s = St.get();
    g.clearRect(0, 0, c.width, c.height);
    const paint = (D.PAINTS.find(p => p.id === s.paint) || D.PAINTS[0]).color;
    g.save(); g.translate(120, 72); g.scale(4, 4);
    const lv = St.lvl('thruster');
    g.fillStyle = St.lvl('reactor') >= 3 ? '#7fd6ff' : '#ffb35c';
    g.globalAlpha = 0.8;
    g.beginPath(); g.moveTo(-10, -4); g.lineTo(-16 - lv * 2, 0); g.lineTo(-10, 4); g.fill();
    g.globalAlpha = 1;
    g.fillStyle = paint; g.strokeStyle = '#1a2233'; g.lineWidth = 0.6;
    g.beginPath(); g.moveTo(15, 0); g.lineTo(-8, -11); g.lineTo(-11, -4); g.lineTo(-11, 4); g.lineTo(-8, 11); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#4fb8ff'; g.beginPath(); g.ellipse(3, 0, 4.5, 3, 0, 0, Math.PI * 2); g.fill();
    const ll = St.lvl('laser');
    g.fillStyle = ll >= 3 ? '#ff6bd6' : '#7fe3ff'; g.fillRect(11, -1.5, 4 + ll, 3);
    if (St.lvl('hull') >= 3) { g.strokeStyle = '#8a96ad'; g.lineWidth = 1; g.beginPath(); g.moveTo(-6, -9); g.lineTo(4, -5); g.moveTo(-6, 9); g.lineTo(4, 5); g.stroke(); }
    g.restore();
  }

  // ---------- upgrades ----------
  function upgradeRow(def, id, effect) {
    const s = St.get();
    const l = St.lvl(id), max = def.costs.length + 1, cost = St.upgradeCost(id);
    const pips = Array.from({ length: max }, (_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('');
    const can = cost != null && s.credits >= cost;
    const btn = cost == null ? '<span class="tag grey">MAX</span>'
      : `<button class="btn ${can ? '' : 'ghost'} small-btn buy" data-buy="${id}" ${can ? '' : 'aria-disabled="true"'}>${fmt(cost)} cr</button>`;
    return `<div class="card up">
      <div><div class="name">${esc(def.name)} <span class="small muted">Lv ${l}/${max}</span></div><div class="pips">${pips}</div></div>
      ${btn}
      <div class="eff">${effect}</div>
    </div>`;
  }
  function pct(v) { return (v >= 0 ? '+' : '') + Math.round(v * 100) + '%'; }

  function renderUpgrades() {
    const list = $('upgradeList');
    let html = '';
    const S = St.stats();
    if (seg === 'shuttle') {
      D.SHUTTLE.forEach(u => {
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
    } else if (seg === 'miner') {
      const u0 = D.MINER[0], u1 = D.MINER[1], u2 = D.MINER[2];
      const rl = St.lvl('repair');
      html += upgradeRow(u0, 'repair', `Repair cost: -${Math.round((1 - S.repairMult) * 100)}%` + (St.upgradeCost('repair') == null ? '' : ` &rarr; <b>-${Math.min(32, rl * 8)}%</b>`));
      const sl = St.lvl('suit');
      html += upgradeRow(u1, 'suit', `Credits kept after hull failure: ${Math.round(S.emergencyShare * 100)}%` + (St.upgradeCost('suit') == null ? '' : ` &rarr; <b>${Math.round((D.BASE.emergencyShare + 0.05 * sl) * 100)}%</b>`));
      const fl = St.lvl('fscan');
      html += upgradeRow(u2, 'fscan', `Contract rewards: ${pct(S.contractBonus - 1)}` + (St.upgradeCost('fscan') == null ? '' : ` &rarr; <b>${pct(0.15 * fl)}</b>`));
      html += `<div class="card small muted">Miner rank (Rank ${St.rank()}) is earned from mining, discoveries and contracts. Rank 3 unlocks a second contract slot; ranks also unlock shuttle paints (see Contracts tab).</div>`;
    } else if (seg === 'weapons') {
      const wp = St.get().weapons;
      html += `<div class="card small muted">Secondary weapons fire from the button next to BOOST during a sortie. Buy once, then upgrade (+30% damage, +1 ammo per level). Ammo restocks free on every launch. <b>Reloading mid-run:</b> every destroyed block adds salvage (rock 1, iron 2, crystal 3, cobalt 5, iridium 8, glass 6, alloy 12) and every ${D.SALVAGE_PER_SHOT} salvage reloads 1 shot (gold ring around the button). Or tap <b>+1</b> to buy a shot with credits. Owning more than one adds a swap button.</div>`;
      D.WEAPONS.forEach(d => {
        const lv = St.weaponLvl(d.id), cost = St.weaponCost(d.id), st = St.weaponStats(d.id, Math.max(1, lv));
        const nx = lv && cost != null ? St.weaponStats(d.id, lv + 1) : null;
        const can = cost != null && St.get().credits >= cost;
        const eq = wp.equipped === d.id;
        const chips = [`Damage ${Math.round(st.dmg)}${nx ? ` &rarr; <b>${Math.round(nx.dmg)}</b>` : ''}`,
          d.radius ? `Blast ${d.radius}` : `Length ${d.range}`, `Ammo ${st.ammo}${nx ? ` &rarr; <b>${nx.ammo}</b>` : ''}`, `Reload ${d.reload} cr/shot`]
          .map(c => `<span class="chip">${c}</span>`).join('');
        html += `<div class="card wcard ${eq ? 'region sel' : ''}">
          <div class="row" style="justify-content:flex-start"><div class="wicon" style="color:${d.color}">${d.icon}</div>
            <div><b>${esc(d.name)}</b> ${lv ? `<span class="small muted">Lv ${lv}/${d.costs.length}</span>` : '<span class="tag grey">LOCKED</span>'}${eq ? ' <span class="tag blue">EQUIPPED</span>' : ''}
            <div class="small muted">${esc(d.desc)}</div></div></div>
          <div class="wstats">${chips}</div>
          <div class="btns">
            ${cost == null ? '<span class="tag grey">MAX</span>' : `<button class="btn ${can ? '' : 'ghost'} small-btn" data-wbuy="${d.id}">${lv ? 'Upgrade' : 'Buy'} - ${fmt(cost)} cr</button>`}
            ${lv && !eq ? `<button class="btn ghost small-btn" data-equip="${d.id}">Equip</button>` : ''}
          </div>
        </div>`;
      });
    } else {
      const l = St.lvl('drone');
      const best = Math.max(0, ...St.get().unlocked.map(id => D.REGIONS.findIndex(r => r.id === id)));
      const mult = D.DRONE.regionMult[best];
      const nxt = l < 5 ? ` &rarr; <b>${fmt(D.DRONE.ratePerHour[l] * mult)} cr/hr, ${D.DRONE.capHours[l]}h</b>` : '';
      html += upgradeRow(D.DRONE, 'drone', `${fmt(St.droneRate())} cr/hr, stores ${St.droneCap()}h (${fmt(St.droneCapCredits())} cr)` + nxt);
      const ds = St.droneStatus();
      html += `<div class="card"><div class="small muted">The drone mines in real time, even while the game is closed. Collect its storage from the hangar. Unlocking richer fields raises its rate (current field bonus: x${mult}).</div>${droneFormula(ds).replace('<details class="formula">', '<details class="formula" open>')}
        <div class="label" style="margin-top:8px">All levels at your current field bonus</div>
        ${D.DRONE.ratePerHour.map((r, i) => `<div class="sum ${i + 1 === l ? 'pos' : ''}"><span>Lv ${i + 1}${i + 1 === l ? ' (you)' : ''}</span><span>${fmt(r * mult)} cr/hr - ${D.DRONE.capHours[i]}h - ${fmt(r * mult * D.DRONE.capHours[i])} cr max</span></div>`).join('')}
      </div>`;
    }
    list.innerHTML = html;
    list.querySelectorAll('[data-wbuy]').forEach(b => b.addEventListener('click', () => {
      SM.Audio.unlock();
      if (St.buyWeapon(b.dataset.wbuy)) { SM.Audio.buy(); toast(St.weaponDef(b.dataset.wbuy).name + ' ready'); render(); }
      else { SM.Audio.deny(); toast('Not enough credits'); }
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

  // ---------- regions ----------
  function renderRegions() {
    const s = St.get();
    $('regionList').innerHTML = D.REGIONS.map(r => {
      const rs = St.regionStatus(r);
      const mats = Array.from(new Set([...Object.keys(r.shell), ...Object.keys(r.core)]));
      const chips = mats.map(m => {
        const md = D.MATERIALS[m], known = s.discovered[m] || rs.unlocked;
        return `<span class="chip"><span class="sw" style="background:${md.color}"></span>${known ? esc(md.name) + ' - ' + md.value + 'cr' : 'Unknown'}</span>`;
      }).join('');
      const sel = s.region === r.id;
      const recLaser = r.laser;
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
        <div class="small muted">Recommended: Laser Lv ${recLaser}+${r.fields ? ', Hull Lv 3+' : ''}. First-visit bonus: ${fmt(r.bonus)} cr</div>
        <div style="margin-top:8px">${foot}</div>
      </div>`;
    }).join('');
    $('regionList').querySelectorAll('[data-region]').forEach(b => b.addEventListener('click', () => {
      St.get().region = b.dataset.region; St.save(); SM.Audio.click(); render();
    }));
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
    let rr = `<div class="card"><div class="small">Rank ${r} - ${fmt(s.xp)} XP${D.RANKS[r] ? ` (next at ${fmt(D.RANKS[r])})` : ' (max)'}</div>`;
    rr += `<div class="small muted" style="margin:6px 0">Rank 3: second contract slot ${r >= 3 ? '&#10003;' : ''}</div>`;
    rr += '<div class="mats" style="display:flex;flex-wrap:wrap;gap:6px">' + D.PAINTS.map(p => {
      const ok = r >= p.rank, sel = s.paint === p.id;
      return `<button class="chip" ${ok ? `data-paint="${p.id}"` : 'disabled'} style="${sel ? 'border-color:var(--accent);' : ''}${ok ? '' : 'opacity:.5'}"><span class="sw" style="background:${p.color}"></span>${esc(p.name)}${ok ? '' : ` (Rank ${p.rank})`}</button>`;
    }).join('') + '</div></div>';
    $('rankRewards').innerHTML = rr;
    document.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', () => { St.acceptContract(b.dataset.accept); SM.Audio.buy(); render(); }));
    document.querySelectorAll('[data-abandon]').forEach(b => b.addEventListener('click', () => { St.abandonContract(b.dataset.abandon); SM.Audio.click(); render(); }));
    document.querySelectorAll('[data-paint]').forEach(b => b.addEventListener('click', () => { St.get().paint = b.dataset.paint; St.save(); SM.Audio.click(); render(); }));
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
    const mats = Object.keys(res.byMat).map(m => `<div class="sum"><span>${esc(D.MATERIALS[m].name)} x${res.byMat[m]}</span><span>${fmt(res.byMat[m] * D.MATERIALS[m].value)}</span></div>`).join('') || '<div class="sum muted"><span>No blocks destroyed</span><span>0</span></div>';
    let rows = mats;
    if (res.ammoRun > 0) rows += `<div class="sum"><span>Ammo reloads bought (${res.shotsBought})</span><span class="neg">-${fmt(res.ammoRun)}</span></div>`;
    if (res.emergency) rows += `<div class="sum"><span>Emergency loss (kept ${Math.round(res.share * 100)}%)</span><span class="neg">-${fmt(res.raw - res.credits)}</span></div>`;
    (extra.contracts || []).forEach(c => (rows += `<div class="sum"><span>Contract: ${esc(c.title)}</span><span class="pos">+${fmt(c.paid)}</span></div>`));
    (extra.bonuses || []).forEach(b => (rows += `<div class="sum"><span>${esc(b.label)}</span><span class="pos">+${fmt(b.amount)}</span></div>`));
    const total = res.credits + (extra.contracts || []).reduce((a, c) => a + c.paid, 0) + (extra.bonuses || []).reduce((a, b) => a + b.amount, 0);
    rows += `<div class="sum total"><span>Total banked</span><span>+${fmt(total)} cr</span></div>`;
    const repair = St.repairCost();
    const notes = [];
    if (res.ammoWallet > 0) notes.push(`Also paid ${fmt(res.ammoWallet)} cr from your wallet for reloads.`);
    if (res.shotsSalvaged > 0) notes.push(`Salvage reloaded ${res.shotsSalvaged} weapon shot${res.shotsSalvaged === 1 ? '' : 's'}.`);
    if (res.hullLost > 0) notes.push(`Hull damage: -${res.hullLost}. Repair quote: <b>${fmt(repair)} cr</b>.`);
    if (extra.rankUp) notes.push(`<b class="pos">Rank up! You are now Rank ${extra.rankUp}.</b>`);
    (extra.unlocked || []).forEach(r => notes.push(`<b class="pos">New field unlocked: ${esc(r.name)}!</b>`));
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

  function showOffline(o) {
    const ds = St.droneStatus();
    openModal(`<h2>Welcome back, miner</h2>
      <div class="drone-anim" style="margin:6px auto" aria-hidden="true"><span></span></div>
      <p>You were away for <b>${dur(o.awayMs)}</b>. Here's what your drone did:</p>
      <div class="sum"><span>Stored when you left</span><span>${fmt(o.storeBefore)} cr</span></div>
      <div class="sum"><span>${o.hoursCounted.toFixed(2)}h x ${fmt(o.rate)} cr/hr</span><span class="pos">+${fmt(o.gained)} cr</span></div>
      <div class="sum total"><span>In storage now</span><span>${fmt(o.store)} cr</span></div>
      ${o.capped ? `<p class="small muted">Storage hit its ${fmt(o.cap)} cr limit (${o.capHours}h) part-way through, so the last ${dur((o.hoursAway - o.hoursCounted) * 3600000)} earned nothing. Upgrade the drone bay to store more.</p>` : ''}
      <div class="sum"><span>Wallet after collecting</span><b>${fmt(St.get().credits + Math.floor(o.store))} cr</b></div>
      <button class="btn gold" data-collect>Collect ${fmt(o.store)} cr</button>
      <button class="btn ghost" id="offLater">Leave it in storage</button>
      ${droneFormula(ds)}`);
    $('offLater').addEventListener('click', () => { closeModal(); render(); });
  }

  function openSettings() {
    const s = St.get().settings;
    const sw = (k, label, desc) => `<label class="setting"><span>${label}${desc ? `<br><span class="small muted">${desc}</span>` : ''}</span><input type="checkbox" class="switch" data-set="${k}" ${s[k] ? 'checked' : ''}></label>`;
    const rg = (k, label, min, max, step) => `<label class="setting"><span>${label}</span><input type="range" data-range="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}"></label>`;
    openModal(`<h2>Settings</h2>
      ${rg('volume', 'Volume', 0, 1, 0.05)}
      ${sw('vibration', 'Vibration')}
      ${sw('shake', 'Screen shake')}
      ${sw('reducedFx', 'Reduced effects', 'Fewer particles, better battery')}
      ${sw('aimAssist', 'Aim assist', 'Auto-select the nearest block')}
      ${sw('autoFire', 'Auto-fire', 'Laser fires on its own at anything in range')}
      ${sw('autoBoost', 'Auto-boost', 'Boosts while flying when energy allows (burns more fuel)')}
      ${sw('autopilot', 'Autopilot', 'When you stop steering, fly to the next block and mine it')}
      ${sw('leftHanded', 'Left-handed layout', 'Buttons on the left, steer on the right')}
      ${sw('highContrast', 'High-contrast mode')}
      ${sw('captions', 'Captions', 'Text for warnings and audio cues')}
      ${rg('uiScale', 'UI scale', 0.85, 1.3, 0.05)}
      ${rg('stickOpacity', 'Control opacity', 0, 1, 0.1)}
      <button class="btn" id="setDone">Done</button>
      <button class="btn ghost" id="setReset" style="color:var(--danger)">Reset all progress</button>
      <p class="small muted">Desktop keys: WASD/arrows move, Space mine, Shift boost, Q weapon, E swap weapon, X buy reload, Tab target, F/B/G toggle auto fire/boost/pilot, R return, P pause.</p>`);
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
