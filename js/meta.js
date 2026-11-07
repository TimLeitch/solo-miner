/* Solo Miner - long-term goals: daily and weekly orders, lifetime counters.
 * Everything here lives in the save under s.meta (see freshMeta() in state.js).
 * Counters only ever go up. An order remembers the counter value when it was handed out (start), so its
 * progress is simply counter - start: no per-order bookkeeping during a sortie. */
window.SM = window.SM || {};

SM.Meta = (function () {
  const D = SM.DATA, St = SM.State;
  const DAY = 86400000;
  const meta = () => St.get().meta;

  // ---------- counters ----------
  function counter(key) {
    const m = meta();
    if (key.startsWith('mat:')) return m.mats[key.slice(4)] || 0;
    return m.counters[key] || 0;
  }
  function add(key, n) {
    if (!n) return;
    const m = meta();
    if (key.startsWith('mat:')) { const id = key.slice(4); m.mats[id] = (m.mats[id] || 0) + n; }
    else m.counters[key] = (m.counters[key] || 0) + n;
  }

  // ---------- calendar (player's local time) ----------
  const pad = n => String(n).padStart(2, '0');
  function dayKey(now) { const d = new Date(now || Date.now()); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function weekKey(now) { // the Monday the week started on
    const d = new Date(now || Date.now()); d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return dayKey(d.getTime());
  }
  function nextMidnight(now) { const d = new Date(now || Date.now()); d.setHours(24, 0, 0, 0); return d.getTime(); }
  function nextMonday(now) { const d = new Date(now || Date.now()); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 7 - ((d.getDay() + 6) % 7)); return d.getTime(); }
  function yesterday(now) { return dayKey((now || Date.now()) - DAY); }

  // ---------- orders ----------
  function tier() { const s = St.get(); return Math.max(0, ...s.unlocked.map(id => D.REGIONS.findIndex(r => r.id === id))); }
  function tidy(n) { const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(1, n))) - 1)); return Math.max(1, Math.round(n / p) * p); }
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  // materials the player can actually find in their unlocked fields (excluding giant crust and scavengers)
  function minableMats() {
    const s = St.get(), out = new Set();
    D.REGIONS.filter(r => s.unlocked.includes(r.id)).forEach(r => [...Object.keys(r.shell), ...Object.keys(r.core)].forEach(m => out.add(m)));
    return [...out];
  }
  function available(kind, weekly) {
    const k = D.ORDERS.kinds[kind], s = St.get();
    if (k.weeklyOnly && !weekly) return false;
    if (k.needs === 'scavs') return D.REGIONS.some(r => r.scavs && s.unlocked.includes(r.id));
    if (k.needs === 'clears') return counter('clears') > 0;
    if (k.needs === 'giants') return counter('giants') > 0;
    if (k.needs === 'events') return !!D.EVENTS;
    return true;
  }
  function makeOrder(kind, weekly) {
    const O = D.ORDERS, K = O.kinds[kind], s = St.get(), t = tier(), mult = weekly ? O.weeklyNeed : 1;
    let need, key = kind, mat = null;
    if (kind === 'blocks') need = tidy((50 + 10 * t) * mult);
    else if (kind === 'credits') need = tidy(Math.max(400, (s.stats.best || 0) * 2) * mult);
    else if (kind === 'mat') {
      const mats = minableMats();
      mat = mats[rnd(0, mats.length - 1)];
      need = Math.max(4, Math.round(35 * Math.sqrt(8 / D.MATERIALS[mat].value) * mult));
      key = 'mat:' + mat;
    }
    else if (kind === 'offline') need = tidy(St.droneRate() * 2 * mult);
    else need = Math.max(1, Math.round((K.n || 1) * (weekly ? (kind === 'clears' || kind === 'giants' || kind === 'events' ? 3 : 5) : 1)));
    const credits = Math.round(O.base * (1 + t) * St.threat().value * K.w * (weekly ? O.weeklyMult : 1) / 5) * 5;
    const name = K.name.replace('{n}', need.toLocaleString()).replace('{mat}', mat ? D.MATERIALS[mat].name : '') + (need > 1 && /field$|rock$|event$/.test(K.name) ? 's' : '');
    return { id: Math.random().toString(36).slice(2, 9), kind, key, mat, need, start: counter(key), credits,
      xp: O.xp * (1 + t) * (weekly ? 3 : 1), stars: weekly ? O.weeklyStars : O.stars, name, done: false };
  }
  function pickOrders(weekly) {
    const kinds = Object.keys(D.ORDERS.kinds).filter(k => available(k, weekly));
    const out = [];
    while (out.length < 3 && kinds.length) out.push(makeOrder(kinds.splice(rnd(0, kinds.length - 1), 1)[0], weekly));
    return out;
  }
  // Hand out new orders when the day / week has rolled over. Returns { daily, weekly } = true for each that is new.
  function refresh(now) {
    const m = meta(), today = dayKey(now), wk = weekKey(now), fresh = { daily: false, weekly: false };
    if (m.daily.day !== today) { m.daily.day = today; m.daily.orders = pickOrders(false); m.daily.bonus = false; fresh.daily = true; }
    if (m.weekly.week !== wk) { m.weekly.week = wk; m.weekly.orders = pickOrders(true); m.weekly.bonus = false; fresh.weekly = true; }
    return fresh;
  }
  function progress(o) { return Math.max(0, Math.min(o.need, counter(o.key) - o.start)); }
  // Current streak of days with all three dailies done (0 once a day is missed).
  function streak(now) {
    const d = meta().daily;
    return d.lastFull === dayKey(now) || d.lastFull === yesterday(now) ? d.streak || 0 : 0;
  }
  function streakMult(now) { return 1 + D.ORDERS.streakStep * Math.min(D.ORDERS.streakMax, streak(now)); }
  function pay(label, credits, xp, stars) {
    const s = St.get();
    if (credits) St.earn(credits);
    if (xp) s.xp += xp;
    if (stars) meta().stars += stars;
    return { label, credits: credits || 0, xp: xp || 0, stars: stars || 0 };
  }
  // Pays every order that is complete. Returns [{ label, credits, xp, stars }] for the summary / toasts.
  function checkOrders(now) {
    refresh(now);
    const m = meta(), O = D.ORDERS, paid = [];
    const sm = streakMult(now);
    m.daily.orders.forEach(o => {
      if (o.done || progress(o) < o.need) return;
      o.done = true; add('dailies', 1);
      paid.push(pay(`Daily order: ${o.name}`, Math.round(o.credits * sm), o.xp, o.stars));
    });
    if (!m.daily.bonus && m.daily.orders.length && m.daily.orders.every(o => o.done)) {
      m.daily.bonus = true;
      const today = dayKey(now);
      m.daily.streak = m.daily.lastFull === yesterday(now) ? (m.daily.streak || 0) + 1 : 1;
      m.daily.lastFull = today;
      m.daily.best = Math.max(m.daily.best || 0, m.daily.streak);
      const base = Math.max(...m.daily.orders.map(o => o.credits));
      paid.push(pay(`All daily orders done - streak ${m.daily.streak} day${m.daily.streak === 1 ? '' : 's'}`, Math.round(base * O.allDailyCredits * streakMult(now)), 0, O.allDailyStars));
    }
    m.weekly.orders.forEach(o => {
      if (o.done || progress(o) < o.need) return;
      o.done = true; add('weeklies', 1);
      paid.push(pay(`Weekly order: ${o.name}`, o.credits, o.xp, o.stars));
    });
    if (!m.weekly.bonus && m.weekly.orders.length && m.weekly.orders.every(o => o.done)) {
      m.weekly.bonus = true;
      const base = Math.max(...m.weekly.orders.map(o => o.credits));
      paid.push(pay('All weekly orders done', Math.round(base * O.allWeeklyCredits), 0, O.allWeeklyStars));
    }
    return paid;
  }

  // ---------- achievements (DATA.ACHIEVEMENTS) ----------
  function achValue(what) {
    const s = St.get();
    if (what === 'allTime') return St.allTimeCredits();
    if (what === 'rank') return St.rank();
    if (what === 'fields') return s.unlocked.length;
    if (what === 'streak') return Math.max(meta().daily.best || 0, streak());
    if (what === 'mats') return Object.keys(s.discovered).filter(m => D.MATERIALS[m] && !D.MATERIALS[m].foe).length;
    if (what === 'shards') return s.prestige.shards;
    return counter(what);
  }
  // Every rung of every ladder: { id, ladder, name, text, goal, stars, have, done, at }
  function achievements() {
    const got = meta().ach;
    const out = [];
    D.ACHIEVEMENTS.forEach(([id, name, what, goals, text]) => {
      const have = achValue(what);
      goals.forEach((goal, i) => {
        const aid = `${id}.${i + 1}`;
        out.push({ id: aid, ladder: id, rung: i + 1, rungs: goals.length, name: goals.length > 1 ? `${name} ${['I', 'II', 'III', 'IV', 'V'][i]}` : name,
          text: text.replace('{n}', goal.toLocaleString()), goal, stars: D.STARS_BY_RUNG[i] || 20, have, done: !!got[aid], at: got[aid] || 0 });
      });
    });
    return out;
  }
  // Unlock everything newly reached and pay its stars. Returns the new ones.
  function checkAchievements() {
    const got = meta().ach, fresh = [];
    achievements().forEach(a => {
      if (a.done || a.have < a.goal) return;
      got[a.id] = Date.now(); meta().stars += a.stars; fresh.push(a);
    });
    return fresh;
  }
  function unseenAchievements() { return Math.max(0, Object.keys(meta().ach).length - (meta().achSeen || 0)); }
  function seeAchievements() { meta().achSeen = Object.keys(meta().ach).length; }

  // ---------- cosmetics (DATA.PAINTS + DATA.COSMETICS) ----------
  const KINDS = ['paint', 'trail', 'decal', 'beam'];
  function cosmList(kind) { return kind === 'paint' ? D.PAINTS : D.COSMETICS[kind]; }
  function cosmDef(kind, id) { const l = cosmList(kind); return l.find(x => x.id === id) || l[0]; }
  function equipped(kind) { const s = St.get(); return kind === 'paint' ? s.paint : s.cosm[kind]; }
  // free (no requirement), rank reached, achievement earned, or bought with stars
  function owns(kind, id) {
    const d = cosmDef(kind, id), s = St.get();
    if (d.rank) return St.rank() >= d.rank;
    if (d.ach) return !!meta().ach[d.ach];
    if (d.stars) return !!s.cosm.owned[kind + '.' + id];
    return true;
  }
  // 'equipped' | 'bought' | 'poor' | 'locked'
  function useCosmetic(kind, id) {
    const s = St.get(), d = cosmDef(kind, id);
    if (!owns(kind, id)) {
      if (!d.stars) return 'locked';
      if (meta().stars < d.stars) return 'poor';
      meta().stars -= d.stars; s.cosm.owned[kind + '.' + id] = true;
      if (kind === 'paint') s.paint = id; else s.cosm[kind] = id;
      St.save(); return 'bought';
    }
    if (kind === 'paint') s.paint = id; else s.cosm[kind] = id;
    St.save(); return 'equipped';
  }
  // What the ship looks like now: { paint, trail, decal, beam } item definitions.
  function look() { const o = {}; KINDS.forEach(k => { const d = cosmDef(k, equipped(k)); o[k] = owns(k, d.id) ? d : cosmList(k)[0]; }); return o; }

  // ---------- hooks ----------
  // After a sortie (main.js finishRun). res = the sortie result from SM.Sortie.end().
  function onRun(res, now) {
    refresh(now);
    add('sorties', 1);
    add('blocks', res.blocks || 0);
    add('credits', Math.max(0, res.credits || 0));
    add('relics', res.relicCount || 0);
    add('giants', res.giants || 0);
    add('scavs', res.foeKills || 0);
    add('clears', res.cleared || 0);
    (res.events || []).filter(e => e.done).forEach(e => { add('events', 1); add('ev:' + e.kind, 1); });
    Object.keys(res.byMat || {}).forEach(id => add('mat:' + id, res.byMat[id]));
    const f = meta().fields, r = res.region;
    f[r] = f[r] || { runs: 0, best: 0, cleared: 0 };
    f[r].runs++; f[r].best = Math.max(f[r].best, res.credits || 0); f[r].cleared += res.cleared || 0;
    const orders = checkOrders(now);
    return { orders, achievements: checkAchievements() };
  }
  // Something counted outside a sortie (drone bay collection, contract completed). Returns paid orders.
  function track(key, n, now) { add(key, n); return checkOrders(now); }

  return { cosmList, cosmDef, equipped, owns, useCosmetic, look, achievements, checkAchievements, unseenAchievements, seeAchievements, achValue, counter, add, dayKey, weekKey, nextMidnight, nextMonday, refresh, progress, streak, streakMult, checkOrders, onRun, track, tier };
})();
