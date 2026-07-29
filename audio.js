/* ============================================================
   audio.js — 音を作る担当（Web Audio API）
   ・音源はすべてその場で合成（音声ファイル不要）
   ・同じ関数を「再生用の AudioContext」と
     「書き出し用の OfflineAudioContext」の両方で使う
   ============================================================ */
const AudioEngine = (function () {
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /* ---------- ノイズ／リバーブ用の素材 ---------- */
  function makeNoise(ctx, sec = 2) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function makeIR(ctx, sec = 2.0, decay = 2.6) {
    const rate = ctx.sampleRate, len = Math.floor(rate * sec);
    const b = ctx.createBuffer(2, len, rate);
    const pre = Math.floor(rate * 0.015);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = i < pre ? 0 : (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return b;
  }

  /* ---------- ミキサーを組む ---------- */
  // 戻り値の graph をそのまま scheduleStep に渡す
  function buildGraph(ctx, S) {
    const master = ctx.createGain();
    master.gain.value = S.master;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.16;
    const out = ctx.createGain(); out.gain.value = 0.86;   // 歪まないよう少し余裕をもたせる
    master.connect(comp); comp.connect(out); out.connect(ctx.destination);

    // リバーブ
    const revIn = ctx.createGain(); revIn.gain.value = 1;
    const revLp = ctx.createBiquadFilter(); revLp.type = 'lowpass'; revLp.frequency.value = 5200;
    const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx);
    const revOut = ctx.createGain(); revOut.gain.value = S.reverb;
    revIn.connect(revLp); revLp.connect(conv); conv.connect(revOut); revOut.connect(master);

    // ディレイ（付点8分ふう）
    const dlyIn = ctx.createGain(); dlyIn.gain.value = 1;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = Math.min(1.9, (60 / S.bpm) * 0.75);
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const dlyLp = ctx.createBiquadFilter(); dlyLp.type = 'lowpass'; dlyLp.frequency.value = 3000;
    const dlyOut = ctx.createGain(); dlyOut.gain.value = S.delay;
    dlyIn.connect(delay); delay.connect(dlyLp); dlyLp.connect(fb); fb.connect(delay);
    delay.connect(dlyOut); dlyOut.connect(master);

    // トラックごとのゲイン＋センド量
    const SEND = {
      lead:  { rev: 0.38, dly: 0.40 },
      chord: { rev: 0.55, dly: 0.16 },
      bass:  { rev: 0.04, dly: 0.00 },
      drum:  { rev: 0.14, dly: 0.00 },
    };
    const track = {};
    for (const k of ['lead', 'chord', 'bass', 'drum']) {
      const g = ctx.createGain();
      g.gain.value = S.tracks[k].mute ? 0 : S.tracks[k].vol;
      g.connect(master);
      const rs = ctx.createGain(); rs.gain.value = SEND[k].rev; g.connect(rs); rs.connect(revIn);
      if (SEND[k].dly > 0) { const ds = ctx.createGain(); ds.gain.value = SEND[k].dly; g.connect(ds); ds.connect(dlyIn); }
      track[k] = g;
    }

    return { ctx, master, revOut, dlyOut, delay, track, noise: makeNoise(ctx) };
  }

  /* ---------- エンベロープ ---------- */
  function adsr(ctx, t, dur, a, d, s, r, peak) {
    const g = ctx.createGain(), v = g.gain, tiny = 0.0001;
    const pk = Math.max(tiny * 2, peak), sus = Math.max(tiny * 2, peak * s);
    const hold = Math.max(a + d, dur);
    v.setValueAtTime(tiny, t);
    v.exponentialRampToValueAtTime(pk, t + a);
    v.exponentialRampToValueAtTime(sus, t + a + d);
    v.setValueAtTime(sus, t + hold);
    v.exponentialRampToValueAtTime(tiny, t + hold + r);
    g._end = t + hold + r + 0.02;
    return g;
  }
  function decayGain(ctx, t, peak, time) {   // 打楽器むけの単純減衰
    const g = ctx.createGain(), tiny = 0.0001;
    g.gain.setValueAtTime(Math.max(tiny * 2, peak), t);
    g.gain.exponentialRampToValueAtTime(tiny, t + time);
    g._end = t + time + 0.02;
    return g;
  }

  /* =====================================================
     音色（メロディ・コード・ベース）
     ===================================================== */
  function playInst(ctx, out, inst, midi, t, dur, vel) {
    const f = mtof(midi);
    const stop = (nodes, end) => nodes.forEach(n => { try { n.stop(end); } catch (e) {} });

    switch (inst) {
      case 'pico': {                                   // ファミコンふう矩形波
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
        const g = adsr(ctx, t, dur, 0.004, 0.06, 0.7, 0.05, vel * 0.34);
        o.connect(lp); lp.connect(g); g.connect(out); o.start(t); stop([o], g._end);
        break;
      }
      case 'saw': {                                    // 太いシンセ
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
        o1.type = o2.type = 'sawtooth'; o1.frequency.value = o2.frequency.value = f;
        o1.detune.value = -7; o2.detune.value = 7;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
        lp.frequency.setValueAtTime(Math.min(9000, f * 9), t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(320, f * 2.6), t + Math.min(0.35, dur + 0.05));
        const g = adsr(ctx, t, dur, 0.008, 0.12, 0.6, 0.09, vel * 0.24);
        o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(out);
        o1.start(t); o2.start(t); stop([o1, o2], g._end);
        break;
      }
      case 'soft': {                                   // やわらかい音
        const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
        const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2; o2.detune.value = 4;
        const g2 = ctx.createGain(); g2.gain.value = 0.18;
        const g = adsr(ctx, t, dur, 0.03, 0.1, 0.75, 0.16, vel * 0.42);
        o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(out);
        o1.start(t); o2.start(t); stop([o1, o2], g._end);
        break;
      }
      case 'epiano': {                                 // FM エレピ
        const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f;
        const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * 2;
        const mg = ctx.createGain();
        mg.gain.setValueAtTime(f * 2.2, t);
        mg.gain.exponentialRampToValueAtTime(Math.max(1, f * 0.12), t + 0.35);
        mod.connect(mg); mg.connect(car.frequency);
        const g = adsr(ctx, t, dur, 0.004, 0.5, 0.28, 0.22, vel * 0.4);
        car.connect(g); g.connect(out);
        car.start(t); mod.start(t); stop([car, mod], g._end);
        break;
      }
      case 'pluck': {                                  // つまびき（ギター／ハープふう）
        const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f;
        const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f; o2.detune.value = -6;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
        lp.frequency.setValueAtTime(Math.min(11000, f * 12), t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(280, f * 1.6), t + 0.28);
        const dec = Math.min(1.4, Math.max(0.28, dur * 0.95));
        const g = decayGain(ctx, t, vel * 0.34, dec);
        o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(out);
        o1.start(t); o2.start(t); stop([o1, o2], g._end);
        break;
      }
      case 'marimba': {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 4;
        const g2 = decayGain(ctx, t, vel * 0.12, 0.07);
        const g = decayGain(ctx, t, vel * 0.5, Math.min(0.9, Math.max(0.22, dur)));
        o.connect(g); o2.connect(g2); g2.connect(out); g.connect(out);
        o.start(t); o2.start(t); stop([o], g._end); stop([o2], g2._end);
        break;
      }
      case 'organ': {
        const g = adsr(ctx, t, dur, 0.012, 0.05, 0.9, 0.06, vel * 0.2);
        const parts = [[1, 1], [2, 0.5], [3, 0.28], [4, 0.18], [6, 0.1]];
        const oscs = parts.map(([mul, amp]) => {
          const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul;
          const a = ctx.createGain(); a.gain.value = amp;
          o.connect(a); a.connect(g); o.start(t); return o;
        });
        g.connect(out); stop(oscs, g._end);
        break;
      }
      case 'pad': {                                    // ストリングスふうパッド
        const g = adsr(ctx, t, dur, 0.22, 0.3, 0.72, 0.5, vel * 0.2);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000; lp.Q.value = 0.7;
        const oscs = [-9, 0, 9].map(dt => {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt;
          o.connect(lp); o.start(t); return o;
        });
        lp.connect(g); g.connect(out); stop(oscs, g._end);
        break;
      }
      case 'bassSynth': {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 9;
        lp.frequency.setValueAtTime(Math.min(2600, f * 8), t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(120, f * 2.2), t + 0.16);
        const g = adsr(ctx, t, dur, 0.006, 0.1, 0.75, 0.06, vel * 0.5);
        o.connect(lp); lp.connect(g); g.connect(out); o.start(t); stop([o], g._end);
        break;
      }
      case 'bassRound': {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(f * 1.6, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
        const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f;
        const g2 = ctx.createGain(); g2.gain.value = 0.18;
        const g = adsr(ctx, t, dur, 0.008, 0.12, 0.8, 0.08, vel * 0.62);
        o.connect(g); o2.connect(g2); g2.connect(g); g.connect(out);
        o.start(t); o2.start(t); stop([o, o2], g._end);
        break;
      }
      case 'bassPluck': {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f; o2.detune.value = 5;
        const g2 = ctx.createGain(); g2.gain.value = 0.4;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.setValueAtTime(Math.min(3000, f * 10), t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(120, f * 2), t + 0.2);
        const g = decayGain(ctx, t, vel * 0.6, Math.min(0.9, Math.max(0.2, dur * 0.9)));
        o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(out);
        o.start(t); o2.start(t); stop([o, o2], g._end);
        break;
      }
      default:
        playInst(ctx, out, 'pico', midi, t, dur, vel);
    }
  }

  /* =====================================================
     ドラム
     ===================================================== */
  function noiseSrc(ctx, g) {
    const s = ctx.createBufferSource();
    s.buffer = g.noise;
    s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    return s;
  }

  function playDrum(ctx, out, g, id, t, vel) {
    switch (id) {
      case 'kick': {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
        const gn = decayGain(ctx, t, vel * 0.95, 0.42);
        const click = noiseSrc(ctx, g);
        const chp = ctx.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = 1200;
        const cg = decayGain(ctx, t, vel * 0.14, 0.02);
        o.connect(gn); gn.connect(out);
        click.connect(chp); chp.connect(cg); cg.connect(out);
        o.start(t); o.stop(gn._end); click.start(t); click.stop(t + 0.05);
        break;
      }
      case 'snare': {
        const n = noiseSrc(ctx, g);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
        const ng = decayGain(ctx, t, vel * 0.5, 0.19);
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 190;
        const og = decayGain(ctx, t, vel * 0.3, 0.09);
        n.connect(bp); bp.connect(ng); ng.connect(out);
        o.connect(og); og.connect(out);
        n.start(t); n.stop(ng._end); o.start(t); o.stop(og._end);
        break;
      }
      case 'clap': {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 1.4;
        const gn = ctx.createGain(); const v = gn.gain, tiny = 0.0001;
        v.setValueAtTime(tiny, t);
        [0, 0.012, 0.023].forEach((d, i) => {
          v.setValueAtTime(vel * (0.45 - i * 0.06), t + d);
          v.exponentialRampToValueAtTime(tiny + 0.002, t + d + 0.011);
        });
        v.setValueAtTime(vel * 0.36, t + 0.034);
        v.exponentialRampToValueAtTime(tiny, t + 0.19);
        const n = noiseSrc(ctx, g);
        n.connect(bp); bp.connect(gn); gn.connect(out);
        n.start(t); n.stop(t + 0.22);
        break;
      }
      case 'hatC': case 'hatO': {
        const open = id === 'hatO';
        const n = noiseSrc(ctx, g);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7200;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10500; bp.Q.value = 0.6;
        const gn = decayGain(ctx, t, vel * (open ? 0.3 : 0.26), open ? 0.34 : 0.05);
        n.connect(hp); hp.connect(bp); bp.connect(gn); gn.connect(out);
        n.start(t); n.stop(gn._end);
        break;
      }
      case 'tom': {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(240, t);
        o.frequency.exponentialRampToValueAtTime(110, t + 0.22);
        const gn = decayGain(ctx, t, vel * 0.6, 0.3);
        const n = noiseSrc(ctx, g);
        const ng = decayGain(ctx, t, vel * 0.08, 0.04);
        o.connect(gn); gn.connect(out); n.connect(ng); ng.connect(out);
        o.start(t); o.stop(gn._end); n.start(t); n.stop(t + 0.06);
        break;
      }
      case 'shaker': {
        const n = noiseSrc(ctx, g);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 6200; bp.Q.value = 1.8;
        const gn = ctx.createGain(), tiny = 0.0001;
        gn.gain.setValueAtTime(tiny, t);
        gn.gain.linearRampToValueAtTime(vel * 0.22, t + 0.012);
        gn.gain.exponentialRampToValueAtTime(tiny, t + 0.09);
        n.connect(bp); bp.connect(gn); gn.connect(out);
        n.start(t); n.stop(t + 0.12);
        break;
      }
      case 'crash': {
        const n = noiseSrc(ctx, g);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4200;
        const gn = ctx.createGain(), tiny = 0.0001;
        gn.gain.setValueAtTime(tiny, t);
        gn.gain.linearRampToValueAtTime(vel * 0.3, t + 0.006);
        gn.gain.exponentialRampToValueAtTime(tiny, t + 1.6);
        n.connect(hp); hp.connect(gn); gn.connect(out);
        n.start(t); n.stop(t + 1.7);
        break;
      }
    }
  }

  function playClick(ctx, out, t, strong) {
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.value = strong ? 1600 : 1050;
    const g = decayGain(ctx, t, strong ? 0.14 : 0.08, 0.04);
    o.connect(g); g.connect(out); o.start(t); o.stop(g._end);
  }

  /* =====================================================
     1ステップぶんの発音を予約する
     （再生でも WAV 書き出しでも同じものを使う）
     ===================================================== */
  function scheduleStep(ctx, g, S, patIdx, step, time, stepDur) {
    const pat = S.patterns[patIdx];
    if (!pat) return;
    const V = (c) => (c === 2 ? 1.25 : 0.85);

    // --- ドラム ---
    Music.DRUMS.forEach((d, r) => {
      const c = pat.drum[r] && pat.drum[r][step];
      if (c) playDrum(ctx, g.track.drum, g, d.id, time, V(c) * 0.9);
    });

    // --- ベース ---
    const bRows = pat.bass.length;
    for (let r = 0; r < bRows; r++) {
      const row = pat.bass[r];
      if (!row[step] || (step > 0 && row[step - 1])) continue;   // 連続分は最初だけ鳴らす
      const len = Music.runLength(row, step);
      playInst(ctx, g.track.bass, S.tracks.bass.inst, Music.bassMidi(S, r), time, len * stepDur * 0.92, V(row[step]));
    }

    // --- メロディ ---
    const lRows = pat.lead.length;
    for (let r = 0; r < lRows; r++) {
      const row = pat.lead[r];
      if (!row[step] || (step > 0 && row[step - 1])) continue;
      const len = Music.runLength(row, step);
      playInst(ctx, g.track.lead, S.tracks.lead.inst, Music.leadMidi(S, r), time, len * stepDur * 0.9, V(row[step]));
    }

    // --- コード ---
    if (pat.chordCells[step] && !(step > 0 && pat.chordCells[step - 1] && !pat.arp)) {
      const info = Music.chordInfo(S, pat.chord, pat.seventh);
      const len = pat.arp ? 1 : Music.runLength(pat.chordCells, step);
      const dur = len * stepDur * (pat.arp ? 1.6 : 0.95);
      if (pat.arp) {
        // アルペジオ: 押したマスの順番にコードの音を1つずつ
        let idx = 0;
        for (let s = 0; s < step; s++) if (pat.chordCells[s]) idx++;
        const m = info.midis[idx % info.midis.length] + 12 * Math.floor(idx / info.midis.length % 2);
        playInst(ctx, g.track.chord, S.tracks.chord.inst, m, time, dur, 0.9);
      } else {
        info.midis.forEach((m, i) => {
          playInst(ctx, g.track.chord, S.tracks.chord.inst, m, time + i * 0.008, dur, 0.85);
        });
      }
    }

    // --- メトロノーム（再生時のみ） ---
    if (S.metronome && step % 4 === 0) playClick(ctx, g.master, time, step === 0);
  }

  /* =====================================================
     WAV 書き出し
     ===================================================== */
  async function renderWav(S, bars, onProgress) {
    const stepDur = 60 / S.bpm / 4;
    const total = bars * 16 * stepDur + 2.5;
    const rate = 44100;
    const off = new OfflineAudioContext(2, Math.ceil(total * rate), rate);
    const g = buildGraph(off, S);
    const Sx = Object.assign({}, S, { metronome: false });

    for (let b = 0; b < bars; b++) {
      const patIdx = S.playMode === 'song'
        ? S.chain[b % S.chain.length]
        : S.cur;
      for (let s = 0; s < 16; s++) {
        const t = 0.05 + (b * 16 + s) * stepDur + swingOffset(S, s, stepDur);
        scheduleStep(off, g, Sx, patIdx, s, t, stepDur);
      }
      if (onProgress) onProgress((b + 1) / bars);
    }
    const buf = await off.startRendering();
    return encodeWav(buf);
  }

  function swingOffset(S, step, stepDur) {
    return (step % 2 === 1) ? S.swing * stepDur * 0.55 : 0;
  }

  function encodeWav(buf) {
    const ch = buf.numberOfChannels, len = buf.length;
    const bytes = 44 + len * ch * 2;
    const ab = new ArrayBuffer(bytes), dv = new DataView(ab);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); str(8, 'WAVE');
    str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, buf.sampleRate, true); dv.setUint32(28, buf.sampleRate * ch * 2, true);
    dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, len * ch * 2, true);
    const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < ch; c++) {
        let v = Math.max(-1, Math.min(1, data[c][i]));
        dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
        o += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  return { buildGraph, scheduleStep, playInst, playDrum, playClick, renderWav, swingOffset, mtof };
})();
