/* Solo Miner - tiny synthesized sound effects (no audio files needed). */
window.SM = window.SM || {};

SM.Audio = (function () {
  let ctx = null, master = null, laserOsc = null, laserGain = null, ambient = null;

  function vol() { const st = SM.State.get(); return st ? st.settings.volume : 0.6; }

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = vol();
    master.connect(ctx.destination);
  }
  function setVolume(v) { if (master) master.gain.value = v; }

  function tone(freq, dur, type, gain, slideTo) {
    if (!ctx || vol() <= 0) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, gain, hp) {
    if (!ctx || vol() <= 0) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 400;
    const g = ctx.createGain(); g.gain.value = gain || 0.25;
    src.connect(f); f.connect(g); g.connect(master); src.start();
  }

  function laser(on) {
    if (!ctx) return;
    if (on && !laserOsc) {
      laserOsc = ctx.createOscillator(); laserGain = ctx.createGain();
      laserOsc.type = 'sawtooth'; laserOsc.frequency.value = 180;
      laserGain.gain.value = 0.035;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      laserOsc.connect(f); f.connect(laserGain); laserGain.connect(master);
      laserOsc.start();
    } else if (!on && laserOsc) {
      try { laserOsc.stop(); } catch (e) {}
      laserOsc = null; laserGain = null;
    }
  }

  return {
    unlock, setVolume, laser,
    hit()      { tone(520 + Math.random() * 80, 0.04, 'square', 0.03); },
    crack()    { noise(0.08, 0.12, 1500); },
    brk(value) { // pitch & weight scale with block value
      const big = value >= 50;
      noise(big ? 0.35 : 0.18, big ? 0.35 : 0.22, big ? 300 : 800);
      tone(big ? 660 : 880, 0.12, 'triangle', 0.12, big ? 1320 : 1760);
      if (big) setTimeout(() => tone(990, 0.2, 'triangle', 0.1, 1980), 80);
    },
    buy()      { tone(660, 0.1, 'triangle', 0.15); setTimeout(() => tone(990, 0.15, 'triangle', 0.15), 90); },
    deny()     { tone(200, 0.15, 'square', 0.08, 140); },
    damage()   { noise(0.25, 0.4, 120); tone(110, 0.25, 'sawtooth', 0.15, 60); },
    alarm()    { tone(880, 0.12, 'square', 0.07); setTimeout(() => tone(660, 0.12, 'square', 0.07), 150); },
    overheat() { tone(300, 0.3, 'sawtooth', 0.08, 120); },
    contract() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.13), i * 90)); },
    click()    { tone(1200, 0.03, 'sine', 0.06); },
  };
})();
