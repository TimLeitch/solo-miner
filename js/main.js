/* Solo Miner - boot, game flow, autosave, offline gains, PWA. */
window.SM = window.SM || {};

SM.Main = (function () {
  const D = SM.DATA, St = SM.State;
  let autosave = 0;

  function boot() {
    St.load();
    SM.Sortie.init();
    SM.UI.bind();
    const s = St.get();
    const off = St.collectOffline(); // must run before anything that saves (save() advances lastSeen)
    const news = { contractsDue: St.nextRefreshMs() === 0, fresh: SM.Meta.refresh() }; // for the welcome-back summary
    // A sortie interrupted by the app being killed: bank it rather than lose it.
    if (s.pendingRun) {
      const p = s.pendingRun; delete s.pendingRun;
      s.hull = Math.min(St.maxHull(), p.hull);
      finishRun({ reason: 'recovered', region: p.region, raw: p.credits, credits: p.credits, share: 1, byMat: p.byMat,
        blocks: p.blocks, xp: p.xp, damaged: p.damaged, emergency: false, hullEnd: p.hull, hullLost: 0, time: 0 });
    }
    St.refreshContracts(false);
    SM.Meta.refresh();
    St.save();
    SM.UI.goto('home');
    SM.Cloud.init(); // signs back in from the stored session and syncs in the background (never blocks play)
    if (off) {
      if (!document.getElementById('modal').hidden) SM.UI.toast(`Drone stored +${SM.fmt(off.gained)} cr while you were away`);
      else SM.UI.showOffline(off, news);
    }

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', () => { stashRun(); St.save(); });
    setInterval(() => {
      if (document.visibilityState !== 'visible') return; // never advance lastSeen while hidden
      stashRun(); St.save();
      SM.Cloud.tick();
    }, 5000);
    registerSW();
  }

  function stashRun() {
    const snap = SM.Sortie.snapshot();
    const s = St.get();
    if (snap) s.pendingRun = snap; else delete s.pendingRun;
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      if (SM.Sortie.isRunning()) SM.Sortie.pause(true); // README: pause when the app loses focus
      stashRun(); St.save();
      SM.Cloud.flush();
    } else {
      const off = St.collectOffline();
      const news = { contractsDue: St.nextRefreshMs() === 0, fresh: SM.Meta.refresh() };
      St.save();
      if (off) {
        if (SM.Sortie.isRunning()) SM.UI.toast(`Drone stored +${SM.fmt(off.gained)} cr while you were away`);
        else { SM.UI.render(); SM.UI.showOffline(off, news); }
      }
      SM.Cloud.sync(); // pick up progress made on another device while we were away
    }
  }

  function launch() {
    const s = St.get();
    const max = St.maxHull();
    if (s.hull / max < 0.25) {
      if (St.repairCost() <= s.credits) St.repair();
      else { // never soft-lock the player: free emergency patch up to 25%
        St.repair();
        if (s.hull < max * 0.25) { s.hull = Math.ceil(max * 0.25); SM.UI.toast('Station crew patched your hull for free'); }
      }
    }
    if (!s.unlocked.includes(s.region)) s.region = 'nearside';
    St.save();
    SM.UI.closeModal();
    SM.Sortie.start(s.region, { onEnd: res => { delete St.get().pendingRun; finishRun(res); } });
  }

  function finishRun(res) {
    const s = St.get();
    const rankBefore = St.rank();
    St.earn(res.credits);
    s.xp += res.xp;
    s.hull = Math.max(0, Math.min(St.maxHull(), res.hullEnd));
    s.stats.sorties++; s.stats.blocks += res.blocks; s.stats.best = Math.max(s.stats.best, res.credits);
    const bonuses = [];
    s.visited = s.visited || {};
    // a cleared field can carry the run into further worlds, so every field mined in can pay its survey bonus
    const surveyed = res.surveyed || (res.blocks > 0 ? [res.region] : []);
    surveyed.forEach(id => {
      if (s.visited[id]) return;
      s.visited[id] = true;
      const r = D.REGIONS.find(x => x.id === id);
      bonuses.push({ label: `First survey of ${r.name}`, amount: r.bonus });
      St.earn(r.bonus);
    });
    const contracts = St.applyContracts(res);
    const meta = SM.Meta.onRun(res); // lifetime counters + daily / weekly orders
    if (res.wasTutorial) s.tutorial = false;
    if (s.stats.sorties === 1) St.refreshContracts(true);
    const unlocked = St.checkUnlocks();
    meta.achievements.push(...SM.Meta.checkAchievements()); // new fields / rank ups
    // Dock repair crew: patch the hull now with whatever is in the wallet
    let autoRepair = null;
    if (St.autoOn('dockfix') && St.repairCost() > 0 && s.credits > 0) {
      const before = s.credits, hullBefore = s.hull;
      St.repair();
      if (s.hull > hullBefore) autoRepair = { pts: Math.round(s.hull - hullBefore), cost: before - s.credits };
    }
    s.lastRun = { region: res.region, blocks: res.blocks, credits: res.credits + contracts.reduce((a, c) => a + c.paid, 0) + bonuses.reduce((a, b) => a + b.amount, 0) + meta.orders.reduce((a, o) => a + o.credits, 0) };
    St.save();
    if (contracts.length) SM.Audio.contract();
    const rankAfter = St.rank();
    SM.UI.goto('home');
    SM.UI.showSummary(res, { contracts, bonuses, unlocked, rankUp: rankAfter > rankBefore ? rankAfter : 0, autoRepair, orders: meta.orders, achievements: meta.achievements });
    SM.Cloud.sync();
  }

  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e));
    }
  }

  return { boot, launch };
})();

window.addEventListener('DOMContentLoaded', SM.Main.boot);
