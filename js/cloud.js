/* Solo Miner - player accounts and cloud saves.
 *
 * Backend: Firebase Auth (email + password) and Cloud Firestore, called over their plain REST APIs.
 * No SDK is downloaded, so the game still boots and plays with no connection; cloud sync just waits.
 *
 * One Firestore document per player: saves/{uid} = { data: <save JSON string>, savedAt, credits, rank, v }.
 *
 * Sync rules (St.get().cloud = { uid, updateTime, hash } remembers the last version this device agreed with):
 *   - "dirty"   = this device has progress the cloud hasn't seen (progress hash changed since last sync)
 *   - "changed" = the cloud copy was updated by another device since our last sync (updateTime differs)
 *   not changed + dirty  -> upload
 *   changed + not dirty  -> download (another phone played; take its progress)
 *   changed + dirty      -> ask the player which save to keep (shows credits/rank/ship for each)
 *   Every upload is conditional on the cloud copy still being the one we last saw, so two phones can
 *   never silently overwrite each other.
 *   The local save is always written first; the cloud is a copy. Offline play never waits on the network. */
window.SM = window.SM || {};

SM.Cloud = (function () {
  const St = SM.State;
  const AUTH_KEY = 'solominer.auth.v1';
  const PUSH_EVERY_MS = 30 * 1000;     // upload new progress at most this often while playing
  const PULL_EVERY_MS = 5 * 60 * 1000; // check for progress from other devices this often
  const cfg = SM.CLOUD_CONFIG || {};
  const $ = id => document.getElementById(id);
  const fmt = n => Math.floor(n || 0).toLocaleString();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let auth = null;          // { uid, email, idToken, refreshToken, expiresAt }
  let status = 'signedout'; // signedout | syncing | synced | offline | error
  let lastError = '', lastSync = 0, lastPush = 0, busy = null;

  function enabled() { return !!(cfg.apiKey && cfg.projectId); }
  function signedIn() { return !!auth; }

  function loadAuth() { try { auth = JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch (e) { auth = null; } }
  function saveAuth() {
    try { if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); else localStorage.removeItem(AUTH_KEY); } catch (e) { /* storage blocked */ }
  }

  // ---------- errors ----------
  const ERRORS = {
    EMAIL_EXISTS: 'That email already has an account. Try signing in instead.',
    INVALID_EMAIL: "That email address doesn't look right.",
    MISSING_EMAIL: 'Enter your email address.',
    MISSING_PASSWORD: 'Enter your password.',
    EMAIL_NOT_FOUND: 'Wrong email or password.',
    INVALID_PASSWORD: 'Wrong email or password.',
    INVALID_LOGIN_CREDENTIALS: 'Wrong email or password.',
    WEAK_PASSWORD: 'Password must be at least 6 characters.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many tries. Wait a few minutes and try again.',
    USER_DISABLED: 'This account has been disabled.',
    OPERATION_NOT_ALLOWED: 'Email sign-in is not switched on for this game yet.',
    CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'For safety, sign out and back in, then try again.',
    PERMISSION_DENIED: 'The cloud refused this save (check the Firestore rules).',
  };
  function nice(code) {
    code = String(code || '').split(/[ :]/)[0];
    if (ERRORS[code]) return ERRORS[code];
    if (/API_KEY|API key/i.test(code)) return 'Cloud settings are wrong (check js/cloud-config.js).';
    return code ? 'Cloud error: ' + code : 'Cloud error';
  }
  class CloudError extends Error {}
  class Offline extends Error {}
  async function net(url, opts) {
    try { return await fetch(url, opts); } catch (e) { throw new Offline('offline'); }
  }

  // ---------- Firebase Auth (REST) ----------
  async function idp(path, body) {
    const r = await net(`https://identitytoolkit.googleapis.com/v1/${path}?key=${encodeURIComponent(cfg.apiKey)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new CloudError(nice(j.error && j.error.message));
    return j;
  }
  function setAuth(j) {
    auth = {
      uid: j.localId || j.user_id,
      email: j.email || (auth && auth.email) || '',
      idToken: j.idToken || j.id_token,
      refreshToken: j.refreshToken || j.refresh_token,
      expiresAt: Date.now() + (parseInt(j.expiresIn || j.expires_in, 10) - 120) * 1000,
    };
    saveAuth();
  }
  async function token() {
    if (!auth) throw new CloudError('Not signed in');
    if (Date.now() < auth.expiresAt) return auth.idToken;
    const r = await net(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(auth.refreshToken),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const code = (j.error && j.error.message) || '';
      if (/TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND|INVALID_REFRESH_TOKEN/.test(code)) {
        forgetAccount();
        throw new CloudError('Your sign-in expired. Please sign in again.');
      }
      throw new CloudError(nice(code));
    }
    setAuth(j);
    return auth.idToken;
  }

  // ---------- Firestore (REST) ----------
  function docUrl(query) {
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/(default)/documents/saves/${encodeURIComponent(auth.uid)}${query || ''}`;
  }
  async function fs(method, query, body, keepalive) {
    const t = await token();
    const json = body ? JSON.stringify(body) : undefined;
    return net(docUrl(query), {
      method, body: json, keepalive: !!(keepalive && json && json.length < 60000),
      headers: Object.assign({ Authorization: 'Bearer ' + t }, json ? { 'Content-Type': 'application/json' } : {}),
    });
  }
  async function fsError(r) {
    const j = await r.json().catch(() => ({}));
    const e = j.error || {};
    if (e.status === 'PERMISSION_DENIED') return new CloudError(ERRORS.PERMISSION_DENIED);
    return new CloudError(nice(e.status || e.message || ('HTTP ' + r.status)));
  }
  // -> null (no cloud save yet) or { save, updateTime, savedAt }
  async function pull() {
    const r = await fs('GET');
    if (r.status === 404) {
      const j = await r.clone().json().catch(() => ({}));
      if (/database/i.test((j.error && j.error.message) || '')) throw new CloudError('Firestore database not created yet (see README).');
      return null;
    }
    if (!r.ok) throw await fsError(r);
    const j = await r.json();
    const f = j.fields || {};
    let save = null;
    try { save = JSON.parse(f.data.stringValue); } catch (e) { throw new CloudError('Cloud save is damaged'); }
    return { save, updateTime: j.updateTime, savedAt: parseInt((f.savedAt && f.savedAt.integerValue) || '0', 10) };
  }
  // Upload this device's save. expectUpdateTime: the cloud version we're replacing (null = must not exist yet).
  // Returns 'ok' or 'conflict' (someone else changed the cloud copy first).
  async function push(expectUpdateTime, keepalive) {
    const s = St.get();
    const hash = St.progressHash();
    const q = '?' + (expectUpdateTime ? 'currentDocument.updateTime=' + encodeURIComponent(expectUpdateTime) : 'currentDocument.exists=false');
    const body = { fields: {
      data: { stringValue: JSON.stringify(St.exportSave()) },
      savedAt: { integerValue: String(Date.now()) },
      credits: { integerValue: String(Math.floor(s.credits)) },
      rank: { integerValue: String(St.rank()) },
      v: { integerValue: '1' },
    } };
    const r = await fs('PATCH', q, body, keepalive);
    if (r.status === 409 || r.status === 404 || r.status === 412) return 'conflict';
    if (!r.ok) {
      const err = await fsError(r);
      if (/FAILED_PRECONDITION|ALREADY_EXISTS|NOT_FOUND/.test(err.message)) return 'conflict';
      throw err;
    }
    const j = await r.json();
    St.get().cloud = { uid: auth.uid, updateTime: j.updateTime, hash };
    St.save(true);
    lastPush = lastSync = Date.now();
    return 'ok';
  }

  // ---------- sync ----------
  function link() { const c = St.get().cloud; return c && auth && c.uid === auth.uid ? c : null; }
  function dirty() { const l = link(); return !l || St.progressHash() !== l.hash; }
  function inSortie() { return !!(SM.Sortie && SM.Sortie.isRunning && SM.Sortie.isRunning()); }

  function adopt(remote) {
    St.replace(remote.save);
    St.get().cloud = { uid: auth.uid, updateTime: remote.updateTime, hash: St.progressHash() };
    St.refreshContracts(false);
    St.save();
    if (SM.UI) { SM.UI.render(); SM.UI.toast('Loaded your saved progress from the cloud'); }
  }

  // Full sync: download, compare, then upload / adopt / ask. Safe to call any time; never runs mid-sortie.
  function sync() {
    if (!enabled() || !auth || inSortie()) return Promise.resolve();
    if (busy) return busy;
    setStatus('syncing');
    busy = (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const remote = await pull();
          if (inSortie()) return setStatus('synced'); // player launched while we were waiting; try again later
          const l = link(), isDirty = dirty();
          let result;
          if (!remote) result = await push(null);
          else if (l && remote.updateTime === l.updateTime) {
            if (!isDirty) { lastSync = Date.now(); return setStatus('synced'); }
            result = await push(remote.updateTime);
          } else if (!isDirty || St.isFresh()) { adopt(remote); lastSync = Date.now(); return setStatus('synced'); }
          else if (St.isFresh(remote.save)) result = await push(remote.updateTime);
          else {
            const pick = await askWhichSave(remote);
            if (pick === 'cloud') { adopt(remote); lastSync = Date.now(); return setStatus('synced'); }
            result = await push(remote.updateTime);
            if (result === 'ok' && SM.UI) SM.UI.toast('This device\'s progress is now your cloud save');
          }
          if (result === 'ok') return setStatus('synced');
        }
        throw new CloudError('Cloud save kept changing; will try again shortly.');
      } catch (e) { fail(e); }
      finally { busy = null; refreshUi(); }
    })();
    return busy;
  }

  // Called every few seconds by the autosave loop.
  function tick() {
    if (!enabled() || !auth || busy || inSortie() || !navigator.onLine) return;
    const now = Date.now();
    if ((dirty() && now - lastPush > PUSH_EVERY_MS) || now - lastSync > PULL_EVERY_MS) sync();
  }

  // App going to the background: best-effort upload of anything new, without waiting for the answer.
  function flush() {
    if (!enabled() || !auth || busy) return;
    const l = link();
    if (!l || !dirty()) return;
    push(l.updateTime, true).catch(() => {}); // a conflict here is sorted out by the next full sync
  }

  function fail(e) {
    if (e instanceof Offline) { setStatus('offline'); return; }
    lastError = e.message || String(e);
    setStatus(auth ? 'error' : 'signedout');
    console.warn('Cloud save:', e);
  }
  function setStatus(st) { status = st; refreshUi(); }
  function forgetAccount() {
    auth = null; saveAuth();
    const s = St.get(); if (s) { delete s.cloud; St.save(true); }
    status = 'signedout';
  }

  // ---------- account actions ----------
  async function signUp(email, password) {
    setAuth(await idp('accounts:signUp', { email, password, returnSecureToken: true }));
    await sync();
  }
  async function signIn(email, password) {
    setAuth(await idp('accounts:signInWithPassword', { email, password, returnSecureToken: true }));
    await sync();
  }
  async function resetPassword(email) { await idp('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email }); }
  async function signOut(clearDevice) {
    try { if (dirty() && link()) await push(link().updateTime); } catch (e) { /* offline: progress stays on this device */ }
    forgetAccount();
    if (clearDevice) { St.reset(); St.refreshContracts(true); St.save(); }
    if (SM.UI) { SM.UI.goto('home'); }
  }
  async function deleteAccount() {
    const r = await fs('DELETE');
    if (!r.ok && r.status !== 404) throw await fsError(r);
    await idp('accounts:delete', { idToken: await token() });
    forgetAccount();
  }

  // ---------- UI ----------
  function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    return Math.floor(s / 3600) + 'h ago';
  }
  function statusText() {
    if (!enabled()) return 'Cloud saves are not switched on yet';
    if (!auth) return 'Not signed in - progress is saved on this device only';
    if (status === 'syncing') return 'Syncing...';
    if (status === 'offline' || !navigator.onLine) return 'Offline - saved on this device, will upload when you reconnect';
    if (status === 'error') return lastError;
    if (dirty()) return 'New progress waiting to upload';
    return lastSync ? 'Saved to cloud ' + ago(lastSync) : 'Signed in';
  }
  function refreshUi() {
    const b = $('btnAccount');
    if (b) {
      b.classList.toggle('on', !!auth && status !== 'error');
      b.classList.toggle('warn', !!auth && status === 'error');
      const dot = $('acctDot'); if (dot) dot.hidden = !(enabled() && !auth && St.get().stats.sorties >= 1);
    }
    const st = $('acctStatus'); if (st) st.textContent = statusText();
  }
  // Nudge on the hangar screen: create an account once the player has something worth keeping.
  function homeCardHtml() {
    if (!enabled() || auth || St.get().stats.sorties < 1) return '';
    return `<div class="row"><div><div class="label">Keep your progress</div>
      <div class="small">Make a free account so your credits, ship and upgrades are waiting on any phone or computer.</div></div>
      <button class="btn gold small-btn" data-account>Sign up</button></div>`;
  }

  function stat(o) {
    const rank = St.rank(o.xp || 0);
    const lv = Object.values(o.levels || {}).reduce((a, b) => a + (b - 1), 0);
    return `<div class="sum"><span>Credits</span><b>${fmt(o.credits)} cr</b></div>
      <div class="sum"><span>Rank</span><span>${rank}</span></div>
      <div class="sum"><span>Upgrades bought</span><span>${lv}</span></div>
      <div class="sum"><span>Sorties flown</span><span>${fmt(o.stats && o.stats.sorties)}</span></div>
      <div class="sum"><span>Lifetime earnings</span><span>${fmt(o.lifetime)} cr</span></div>`;
  }
  function askWhichSave(remote) {
    return new Promise(resolve => {
      const local = St.get();
      const best = (remote.save.lifetime || 0) >= (local.lifetime || 0) ? 'cloud' : 'local';
      SM.UI.openModal(`<h2>Which save do you want?</h2>
        <p class="small">This account already has progress in the cloud, and this device has different progress. Pick one to keep. The other is replaced.</p>
        <div class="card"><div class="label">Cloud save${remote.savedAt ? ' - ' + new Date(remote.savedAt).toLocaleString() : ''}${best === 'cloud' ? ' (further along)' : ''}</div>${stat(remote.save)}
          <button class="btn ${best === 'cloud' ? 'gold' : 'ghost'}" id="pickCloud">Use cloud save</button></div>
        <div class="card"><div class="label">This device${best === 'local' ? ' (further along)' : ''}</div>${stat(local)}
          <button class="btn ${best === 'local' ? 'gold' : 'ghost'}" id="pickLocal">Keep this device's save</button></div>`, true);
      $('pickCloud').addEventListener('click', () => { SM.UI.closeModal(); resolve('cloud'); });
      $('pickLocal').addEventListener('click', () => { SM.UI.closeModal(); resolve('local'); });
    });
  }

  function openAccount(mode) {
    if (!enabled()) {
      SM.UI.openModal(`<h2>Account</h2>
        <p>Cloud saves aren't switched on for this copy of the game yet, so your progress is saved on this device only.</p>
        <p class="small muted">Game owner: add your Firebase apiKey and projectId to js/cloud-config.js (steps in the README).</p>
        <button class="btn" id="acctClose">OK</button>`);
      $('acctClose').addEventListener('click', SM.UI.closeModal);
      return;
    }
    if (auth) return openSignedIn();
    mode = mode || 'signup';
    const isUp = mode === 'signup';
    SM.UI.openModal(`<h2>${isUp ? 'Create account' : 'Sign in'}</h2>
      <p class="small">${isUp
        ? 'Save your credits, ship, upgrades and drones to the cloud. Sign in on any phone or computer to pick up where you left off. Your current progress comes with you.'
        : 'Sign in to load your saved progress on this device.'}</p>
      <form id="acctForm" class="acct-form" novalidate>
        <label class="field"><span class="label">Email</span><input id="acctEmail" type="email" autocomplete="email" inputmode="email" required></label>
        <label class="field"><span class="label">Password${isUp ? ' (6+ characters)' : ''}</span><input id="acctPass" type="password" autocomplete="${isUp ? 'new-password' : 'current-password'}" minlength="6" required></label>
        <div class="small acct-msg" id="acctMsg" role="alert"></div>
        <button class="btn" type="submit" id="acctGo">${isUp ? 'Create account' : 'Sign in'}</button>
      </form>
      <button class="btn ghost" id="acctSwap">${isUp ? 'I already have an account - sign in' : 'New here? Create an account'}</button>
      ${isUp ? '' : '<button class="btn ghost small-btn" id="acctForgot">Forgot password?</button>'}
      <p class="small muted">Playing without an account still works; progress just stays on this device. ${navigator.onLine ? '' : '<b>You are offline right now.</b>'}</p>`);
    const msg = (t, good) => { $('acctMsg').textContent = t; $('acctMsg').className = 'small acct-msg ' + (good ? 'pos' : 'neg'); };
    $('acctSwap').addEventListener('click', () => openAccount(isUp ? 'signin' : 'signup'));
    if (!isUp) $('acctForgot').addEventListener('click', async () => {
      const email = $('acctEmail').value.trim();
      if (!email) return msg('Type your email above first.');
      try { await resetPassword(email); msg('If that email has an account, a reset link is on its way.', true); }
      catch (e) { msg(e instanceof Offline ? "You're offline. Try again when connected." : e.message); }
    });
    $('acctForm').addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('acctEmail').value.trim(), pass = $('acctPass').value;
      if (!email || !pass) return msg('Enter your email and password.');
      if (isUp && pass.length < 6) return msg(ERRORS.WEAK_PASSWORD);
      $('acctGo').disabled = true; msg('Working...', true);
      try {
        await (isUp ? signUp(email, pass) : signIn(email, pass));
        if (!$('pickCloud')) { SM.UI.closeModal(); SM.UI.render(); }
        SM.UI.toast(isUp ? 'Account created - progress saved to the cloud' : 'Signed in as ' + auth.email);
      } catch (err) {
        $('acctGo').disabled = false;
        msg(err instanceof Offline ? "You're offline. Connect to the internet to sign in." : err.message);
      }
    });
  }

  function openSignedIn() {
    SM.UI.openModal(`<h2>Account</h2>
      <div class="sum"><span>Signed in as</span><b>${esc(auth.email)}</b></div>
      <div class="small" id="acctStatus">${esc(statusText())}</div>
      <button class="btn" id="acctSync">Sync now</button>
      <button class="btn ghost" id="acctOut">Sign out</button>
      <button class="btn ghost" id="acctOutClear">Sign out and clear this device</button>
      <button class="btn ghost small-btn" id="acctDelete" style="color:var(--danger)">Delete account</button>
      <p class="small muted">Progress saves to this device instantly and uploads about every 30 seconds while you play, after each sortie, and when you leave the game. If you're offline it uploads when you reconnect.</p>`);
    $('acctSync').addEventListener('click', async () => {
      await sync();
      if ($('acctStatus')) $('acctStatus').textContent = statusText();
    });
    $('acctOut').addEventListener('click', async () => { await signOut(false); SM.UI.closeModal(); SM.UI.toast('Signed out. Your progress is still on this device.'); });
    $('acctOutClear').addEventListener('click', async () => {
      if (!confirm('Sign out and remove this progress from this device? It stays safe in your cloud save.')) return;
      await signOut(true); SM.UI.closeModal(); SM.UI.toast('Signed out and cleared this device');
    });
    $('acctDelete').addEventListener('click', async () => {
      if (!confirm('Delete your account and cloud save for good? Progress on this device is kept. This cannot be undone.')) return;
      try { await deleteAccount(); SM.UI.closeModal(); SM.UI.render(); SM.UI.toast('Account deleted'); }
      catch (e) { $('acctStatus').textContent = e instanceof Offline ? "You're offline. Try again when connected." : e.message; }
    });
  }

  function init() {
    loadAuth();
    status = auth ? 'synced' : 'signedout';
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-account]');
      if (t) { if (SM.Audio) { SM.Audio.unlock(); SM.Audio.click(); } openAccount(); }
    });
    window.addEventListener('online', () => sync());
    window.addEventListener('offline', () => setStatus(auth ? 'offline' : 'signedout'));
    refreshUi();
    if (auth && enabled()) sync();
  }

  return { init, sync, tick, flush, enabled, signedIn, openAccount, homeCardHtml, refreshUi, status: () => status };
})();
