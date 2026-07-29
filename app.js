/* ============================================================
   app.js — 画面と操作、シーケンサー本体
   ============================================================ */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const STEPS = Music.STEPS;
  const SAVE_KEYS = { adult: 'musicMaker.v1', kids: 'musicMaker.kids.v1' };
  let saveKey = SAVE_KEYS.adult;

  /* ---------- 状態 ---------- */
  let S = Music.defaultSong();
  let clip = null;                 // パターンのコピー用
  const undoStack = [];
  let mode = 'adult';              // 'adult' | 'kids'
  let stash = null;                // こどもモード中、おとなモードの曲を預かる

  /* ---------- 表示のサイズ ---------- */
  const GUT = 46;                  // 左のラベル欄
  let cellW = 34;
  const RH = { lead: 17, chord: 30, bass: 18, drum: 25 };
  const COLOR = { lead: '#ff6ea9', chord: '#4dd6c1', bass: '#a98bff', drum: '#ffb154' };
  const CV = { lead: $('#cvLead'), chord: $('#cvChord'), bass: $('#cvBass'), drum: $('#cvDrum') };
  let dirty = true;

  const rowCount = (name) =>
    name === 'lead' ? Music.leadRows(S) :
    name === 'bass' ? Music.bassRows(S) :
    name === 'drum' ? Music.DRUMS.length : 1;

  const gridOf = (name, pat) =>
    name === 'chord' ? [pat.chordCells] : pat[name];

  /* ============================================================
     オーディオ
     ============================================================ */
  let actx = null, graph = null;
  let playing = false, timer = null;
  let step = 0, chainPos = 0, nextTime = 0, queue = [];
  let dispStep = -1, dispPat = -1;

  function ensureAudio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      graph = AudioEngine.buildGraph(actx, S);
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function syncAudioParams() {
    if (!graph) return;
    graph.master.gain.value = S.master;
    graph.revOut.gain.value = S.reverb;
    graph.dlyOut.gain.value = S.delay;
    graph.delay.delayTime.value = Math.min(1.9, (60 / S.bpm) * 0.75);
    for (const k of ['lead', 'chord', 'bass', 'drum']) {
      graph.track[k].gain.value = S.tracks[k].mute ? 0 : S.tracks[k].vol;
    }
  }

  function play() {
    ensureAudio();
    playing = true; step = 0; chainPos = 0; queue = [];
    nextTime = actx.currentTime + 0.1;
    syncAudioParams();
    timer = setInterval(scheduler, 25);
    $('#btnPlay').textContent = '■';
    $('#btnPlay').classList.add('playing');
  }
  function stop() {
    playing = false;
    clearInterval(timer); timer = null;
    queue = []; dispStep = -1; dispPat = -1; dirty = true;
    $('#btnPlay').textContent = '▶';
    $('#btnPlay').classList.remove('playing');
  }
  function toggle() { playing ? stop() : play(); }

  function scheduler() {
    const stepDur = 60 / S.bpm / 4;
    while (nextTime < actx.currentTime + 0.12) {
      const patIdx = S.playMode === 'song'
        ? S.chain[chainPos % S.chain.length]
        : S.cur;
      const t = nextTime + AudioEngine.swingOffset(S, step, stepDur);
      AudioEngine.scheduleStep(actx, graph, S, patIdx, step, t, stepDur);
      queue.push({ step, pat: patIdx, t });
      nextTime += stepDur;
      if (++step >= STEPS) {
        step = 0;
        if (S.playMode === 'song') chainPos = (chainPos + 1) % S.chain.length;
      }
    }
  }

  // 音を1つ試聴する
  function audition(name, row, pat) {
    ensureAudio(); syncAudioParams();
    const t = actx.currentTime + 0.01;
    if (name === 'drum') AudioEngine.playDrum(actx, graph.track.drum, graph, Music.DRUMS[row].id, t, 0.9);
    else if (name === 'lead') AudioEngine.playInst(actx, graph.track.lead, S.tracks.lead.inst, Music.leadMidi(S, row), t, 0.35, 0.9);
    else if (name === 'bass') AudioEngine.playInst(actx, graph.track.bass, S.tracks.bass.inst, Music.bassMidi(S, row), t, 0.35, 0.9);
    else if (name === 'chord') auditionChord(pat);
  }
  function auditionChord(pat) {
    ensureAudio(); syncAudioParams();
    const info = Music.chordInfo(S, pat.chord, pat.seventh);
    const t = actx.currentTime + 0.01;
    info.midis.forEach((m, i) => AudioEngine.playInst(actx, graph.track.chord, S.tracks.chord.inst, m, t + i * 0.02, 0.7, 0.9));
  }

  /* ============================================================
     描画
     ============================================================ */
  function layout() {
    const body = document.querySelector('.lane-body');
    const w = (body ? body.clientWidth : 700) - 8;
    cellW = Math.max(22, Math.min(64, Math.floor((w - GUT) / STEPS)));
    dirty = true;
  }

  function drawAll() {
    for (const name of ['lead', 'chord', 'bass', 'drum']) drawLane(name);
  }

  function drawLane(name) {
    const cv = CV[name], g = cv.getContext('2d');
    const rows = rowCount(name), rh = RH[name];
    const W = GUT + STEPS * cellW, H = rows * rh;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const pat = S.patterns[S.cur];
    const grid = gridOf(name, pat);
    const col = COLOR[name];
    const info = Music.chordInfo(S, pat.chord, pat.seventh);
    const chordPcs = info.pcs.map(p => ((p % 12) + 12) % 12);

    // --- 行の背景とラベル ---
    for (let dr = 0; dr < rows; dr++) {
      const row = (name === 'drum' || name === 'chord') ? dr : rows - 1 - dr;
      const y = dr * rh;

      let bg = (dr % 2 === 0) ? '#1a2030' : '#171c2a';
      let isChordTone = false;
      if (name === 'lead' || name === 'bass') {
        const midi = name === 'lead' ? Music.leadMidi(S, row) : Music.bassMidi(S, row);
        isChordTone = chordPcs.includes(((midi % 12) + 12) % 12);
        if (isChordTone) bg = '#1f2b3f';
      }
      g.fillStyle = bg;
      g.fillRect(0, y, W, rh - 1);

      // ラベル欄
      g.fillStyle = '#131722';
      g.fillRect(0, y, GUT, rh - 1);
      g.fillStyle = isChordTone ? '#cfe0ff' : '#8e9ab4';
      g.font = `${name === 'drum' ? 10 : 11}px system-ui, sans-serif`;
      g.textBaseline = 'middle';
      let label = '';
      if (name === 'drum') label = Music.DRUMS[row].name;
      else if (name === 'chord') label = info.name;
      else label = Music.rowLabel(S, row);
      if (name === 'chord') { g.fillStyle = COLOR.chord; g.font = 'bold 13px system-ui, sans-serif'; }
      g.fillText(label, 5, y + rh / 2, GUT - 8);
    }

    // --- たての線（拍） ---
    for (let s = 0; s <= STEPS; s++) {
      const x = GUT + s * cellW;
      g.fillStyle = (s % 4 === 0) ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.06)';
      g.fillRect(x, 0, s % 4 === 0 ? 1.5 : 1, H);
    }

    // --- マス ---
    for (let dr = 0; dr < rows; dr++) {
      const row = (name === 'drum' || name === 'chord') ? dr : rows - 1 - dr;
      const y = dr * rh;
      for (let s = 0; s < STEPS; s++) {
        const v = grid[row] ? grid[row][s] : 0;
        if (!v) continue;
        const x = GUT + s * cellW;
        const cont = s > 0 && grid[row][s - 1];      // 前とつながっている？
        const nxt = grid[row][s + 1];
        g.fillStyle = v === 2 ? '#ffe066' : col;
        const pad = 2;
        roundRect(g, x + (cont ? -1 : pad), y + pad, cellW - (cont ? 0 : pad) - (nxt ? -1 : pad), rh - 1 - pad * 2, 4);
        g.fill();
        if (v === 2) {
          g.fillStyle = 'rgba(0,0,0,.35)';
          g.fillRect(x + pad + 2, y + rh / 2 - 1, 3, 2);
        }
      }
    }

    // --- 再生位置 ---
    if (playing && dispStep >= 0 && dispPat === S.cur) {
      const x = GUT + dispStep * cellW;
      g.fillStyle = 'rgba(255,255,255,.15)';
      g.fillRect(x, 0, cellW, H);
      g.fillStyle = 'rgba(255,255,255,.5)';
      g.fillRect(x, 0, 2, H);
    }

    // 枠
    g.strokeStyle = 'rgba(255,255,255,.08)';
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* ============================================================
     マスの編集
     ============================================================ */
  function bindCanvas(name) {
    const cv = CV[name];
    let paint = null, lastCell = '';

    const hit = (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (x < GUT) return null;
      const s = Math.floor((x - GUT) / cellW);
      const rows = rowCount(name);
      const dr = Math.floor(y / RH[name]);
      if (s < 0 || s >= STEPS || dr < 0 || dr >= rows) return null;
      const row = (name === 'drum' || name === 'chord') ? dr : rows - 1 - dr;
      return { s, row };
    };

    const apply = (e, first) => {
      const h = hit(e);
      if (!h) return;
      const key = h.row + ':' + h.s;
      if (!first && key === lastCell) return;
      lastCell = key;
      const pat = S.patterns[S.cur];
      const grid = gridOf(name, pat);
      if (first) {
        pushUndo();
        paint = grid[h.row][h.s] ? 0 : (e.shiftKey ? 2 : 1);
      }
      grid[h.row][h.s] = paint;
      if (paint) audition(name, h.row, pat);
      dirty = true; save();
    };

    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      apply(e, true);
    });
    cv.addEventListener('pointermove', (e) => { if (paint !== null && e.buttons) apply(e, false); });
    cv.addEventListener('pointerup', () => { paint = null; lastCell = ''; });
    cv.addEventListener('pointercancel', () => { paint = null; lastCell = ''; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* ============================================================
     もどす（Undo）／保存
     ============================================================ */
  function snapshot() {
    return JSON.stringify({ p: S.patterns, c: S.chain, k: S.keyIdx, sc: S.scale });
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 40) undoStack.shift();
  }
  function undo() {
    const s = undoStack.pop();
    if (!s) return toast('もどせる操作がありません');
    const o = JSON.parse(s);
    S.patterns = o.p; S.chain = o.c; S.keyIdx = o.k; S.scale = o.sc;
    refreshAll(); save(); toast('ひとつ前にもどしました');
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(saveKey, JSON.stringify(S)); } catch (e) {}
    }, 400);
  }
  function loadSong(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.patterns || o.patterns.length !== 4) return null;
      const song = Object.assign(Music.defaultSong(), o);
      Music.resizeGrids(song);
      return song;
    } catch (e) { return null; }
  }
  function load() {
    const song = loadSong(SAVE_KEYS.adult);
    if (!song) return false;
    S = song;
    return true;
  }

  /* ---------- モード切替（こども／おとな） ---------- */
  function enterKids(song) {
    stop();
    stash = S; S = song; mode = 'kids'; saveKey = SAVE_KEYS.kids;
    document.body.classList.add('kids-on');
    if (graph) syncAudioParams();
    save();
  }
  function exitKids() {
    stop();
    const kid = S;
    S = stash || Music.defaultSong(); stash = null;
    mode = 'adult'; saveKey = SAVE_KEYS.adult;
    document.body.classList.remove('kids-on');
    refreshAll(); save();
    return kid;
  }

  /* ============================================================
     UI の組み立て
     ============================================================ */
  function buildUI() {
    // セレクト類
    fill($('#genre'), Music.GENRES.map(g => [g.id, g.name]));
    fill($('#key'), Music.NOTE.map((n, i) => [i, n]));
    fill($('#scale'), Object.entries(Music.SCALES).map(([k, v]) => [k, v.label]));
    $$('.inst').forEach(sel => fill(sel, Music.INSTS[sel.dataset.t]));

    // パターンボタン
    const pb = $('#patBtns'); pb.innerHTML = '';
    ['A', 'B', 'C', 'D'].forEach((n, i) => {
      const b = document.createElement('button');
      b.className = 'btn pat'; b.textContent = n; b.dataset.i = i;
      b.onclick = () => { S.cur = i; refreshPattern(); dirty = true; save(); };
      pb.appendChild(b);
    });

    // コードボタン
    const cb = $('#chordBtns'); cb.innerHTML = '';
    for (let d = 0; d < 7; d++) {
      const b = document.createElement('button');
      b.className = 'btn chordbtn'; b.dataset.d = d;
      b.onclick = () => {
        pushUndo();
        const pat = S.patterns[S.cur];
        pat.chord = d;
        // ベースがコードの根音に自動で追従（ベースを自分で書いていない場合のみ）
        refreshChords(); auditionChord(pat); dirty = true; save();
      };
      cb.appendChild(b);
    }
  }
  function fill(sel, pairs) {
    sel.innerHTML = '';
    for (const [v, t] of pairs) {
      const o = document.createElement('option');
      o.value = v; o.textContent = t; sel.appendChild(o);
    }
  }

  function refreshChords() {
    $$('#chordBtns .chordbtn').forEach(b => {
      const d = +b.dataset.d;
      const info = Music.chordInfo(S, d, S.patterns[S.cur].seventh);
      b.innerHTML = `${info.name}<small>${Music.chordRoman(S, d)}</small>`;
      b.classList.toggle('sel', S.patterns[S.cur].chord === d);
    });
    $('#btn7th').classList.toggle('on', !!S.patterns[S.cur].seventh);
    $('#btnArp').classList.toggle('on', !!S.patterns[S.cur].arp);
  }

  function refreshChain() {
    const el = $('#chain'); el.innerHTML = '';
    S.chain.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'chip btn' + (playing && S.playMode === 'song' && (chainPos % S.chain.length) === i ? ' now' : '');
      b.textContent = 'ABCD'[p];
      b.onclick = () => { pushUndo(); S.chain[i] = (S.chain[i] + 1) % 4; refreshChain(); save(); };
      el.appendChild(b);
    });
  }

  function refreshPattern() {
    $$('#patBtns .pat').forEach(b => b.classList.toggle('sel', +b.dataset.i === S.cur));
    refreshChords();
  }

  function refreshAll() {
    $('#bpm').value = S.bpm; $('#bpmOut').textContent = S.bpm;
    $('#swing').value = Math.round(S.swing * 100); $('#swingOut').textContent = Math.round(S.swing * 100);
    $('#master').value = Math.round(S.master * 100);
    $('#reverb').value = Math.round(S.reverb * 100);
    $('#delay').value = Math.round(S.delay * 100);
    $('#key').value = S.keyIdx;
    $('#scale').value = S.scale;
    $('#follow').checked = S.follow;
    $('#modeSong').classList.toggle('sel', S.playMode === 'song');
    $('#modePat').classList.toggle('sel', S.playMode !== 'song');
    $('#btnMetro').classList.toggle('on', S.metronome);
    $$('.inst').forEach(sel => { sel.value = S.tracks[sel.dataset.t].inst; });
    $$('.vol').forEach(sl => { sl.value = Math.round(S.tracks[sl.dataset.t].vol * 100); });
    $$('.mute').forEach(b => {
      const m = S.tracks[b.dataset.t].mute;
      b.textContent = m ? '🔇' : '🔊'; b.classList.toggle('on', m);
    });
    refreshProgs(); refreshPattern(); refreshChain();
    syncAudioParams(); layout(); dirty = true;
  }

  function refreshProgs() {
    const list = Music.progsFor(S);
    fill($('#prog'), list.map((p, i) => [i, p.name]));
  }

  /* ============================================================
     イベント
     ============================================================ */
  function bindUI() {
    $('#btnPlay').onclick = toggle;

    $('#bpm').oninput = e => { S.bpm = +e.target.value; $('#bpmOut').textContent = S.bpm; syncAudioParams(); save(); };
    $('#swing').oninput = e => { S.swing = +e.target.value / 100; $('#swingOut').textContent = e.target.value; save(); };
    $('#master').oninput = e => { S.master = +e.target.value / 100; syncAudioParams(); save(); };
    $('#reverb').oninput = e => { S.reverb = +e.target.value / 100; syncAudioParams(); save(); };
    $('#delay').oninput = e => { S.delay = +e.target.value / 100; syncAudioParams(); save(); };

    $('#key').onchange = e => { pushUndo(); S.keyIdx = +e.target.value; refreshChords(); dirty = true; save(); };
    $('#scale').onchange = e => {
      pushUndo();
      S.scale = e.target.value;
      Music.resizeGrids(S);
      refreshProgs(); refreshChords(); layout(); dirty = true; save();
      toast('スケールを変えました：' + Music.SCALES[S.scale].label);
    };

    $('#modeSong').onclick = () => { S.playMode = 'song'; refreshAll(); save(); };
    $('#modePat').onclick = () => { S.playMode = 'pattern'; refreshAll(); save(); };
    $('#btnMetro').onclick = () => { S.metronome = !S.metronome; $('#btnMetro').classList.toggle('on', S.metronome); save(); };
    $('#follow').onchange = e => { S.follow = e.target.checked; save(); };

    // トラック操作
    $$('.inst').forEach(sel => sel.onchange = () => { S.tracks[sel.dataset.t].inst = sel.value; save(); });
    $$('.vol').forEach(sl => sl.oninput = () => { S.tracks[sl.dataset.t].vol = +sl.value / 100; syncAudioParams(); save(); });
    $$('.mute').forEach(b => b.onclick = () => {
      const t = S.tracks[b.dataset.t];
      t.mute = !t.mute;
      b.textContent = t.mute ? '🔇' : '🔊'; b.classList.toggle('on', t.mute);
      syncAudioParams(); save();
    });

    // パターン操作
    $('#btnCopy').onclick = () => { clip = JSON.parse(JSON.stringify(S.patterns[S.cur])); toast('パターン' + 'ABCD'[S.cur] + ' をコピーしました'); };
    $('#btnPaste').onclick = () => {
      if (!clip) return toast('先に「コピー」を押してください');
      pushUndo();
      S.patterns[S.cur] = JSON.parse(JSON.stringify(clip));
      Music.resizeGrids(S); refreshChords(); dirty = true; save();
      toast('はりつけました');
    };
    $('#btnClearPat').onclick = () => {
      pushUndo();
      const chord = S.patterns[S.cur].chord;
      S.patterns[S.cur] = Music.blankPattern(S);
      S.patterns[S.cur].chord = chord;
      refreshChords(); dirty = true; save(); toast('このパターンを消しました');
    };

    $('#chainAdd').onclick = () => {
      if (S.chain.length >= 16) return toast('これ以上ふやせません');
      pushUndo(); S.chain.push(S.chain[S.chain.length - 1] ?? 0); refreshChain(); save();
    };
    $('#chainDel').onclick = () => {
      if (S.chain.length <= 1) return;
      pushUndo(); S.chain.pop(); refreshChain(); save();
    };

    // コード
    $('#btn7th').onclick = () => { pushUndo(); const p = S.patterns[S.cur]; p.seventh = !p.seventh; refreshChords(); auditionChord(p); save(); };
    $('#btnArp').onclick = () => { pushUndo(); const p = S.patterns[S.cur]; p.arp = !p.arp; refreshChords(); save(); };
    $('#btnProg').onclick = () => {
      const list = Music.progsFor(S);
      const p = list[+$('#prog').value] || list[0];
      pushUndo();
      Music.applyProgression(S, p.deg);
      // ベースも新しいコードに合わせて置きなおす
      S.patterns.forEach(pat => Music.fillBass(S, pat, 'root8'));
      refreshChords(); dirty = true; save();
      toast(p.name + ' をあてはめました');
    };

    // おまかせ作曲
    $('#btnAuto').onclick = () => {
      pushUndo();
      const key = S.keyIdx;
      const G = Music.generate(S, $('#genre').value);
      S.keyIdx = key;
      refreshAll(); save();
      toast('🎲 ' + G.name + ' の曲をつくりました');
      if (!playing) play();
    };

    // 保存・読込・書き出し
    $('#btnSave').onclick = () => {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
      download(blob, 'music-maker-' + stamp() + '.json');
      toast('保存しました');
    };
    $('#btnLoad').onclick = () => $('#fileIn').click();
    $('#fileIn').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const o = JSON.parse(r.result);
          if (!o.patterns || o.patterns.length !== 4) throw 0;
          pushUndo();
          S = Object.assign(Music.defaultSong(), o);
          Music.resizeGrids(S);
          refreshAll(); save(); toast('読み込みました');
        } catch (err) { toast('このファイルは読めませんでした'); }
      };
      r.readAsText(f);
      e.target.value = '';
    };

    $('#btnWav').onclick = async () => {
      const loops = +$('#wavLoops').value;
      const bars = (S.playMode === 'song' ? S.chain.length : 1) * loops;
      const btn = $('#btnWav'); const old = btn.textContent;
      btn.textContent = '書き出し中…'; btn.disabled = true;
      try {
        const blob = await AudioEngine.renderWav(S, bars);
        download(blob, 'music-maker-' + stamp() + '.wav');
        toast('WAVを書き出しました（' + bars + '小節）');
      } catch (err) {
        console.error(err); toast('書き出しに失敗しました');
      }
      btn.textContent = old; btn.disabled = false;
    };

    $('#btnReset').onclick = () => {
      if (!confirm('ぜんぶ消して最初からにします。よろしいですか？')) return;
      pushUndo();
      const keep = { keyIdx: S.keyIdx, scale: S.scale };
      S = Music.defaultSong();
      S.keyIdx = keep.keyIdx; S.scale = keep.scale;
      Music.resizeGrids(S);
      refreshAll(); save(); toast('まっさらにしました');
    };

    $('#btnHelp').onclick = () => $('#help').classList.add('show');
    $('#help').onclick = (e) => { if (e.target === $('#help')) $('#help').classList.remove('show'); };

    // キーボード
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      else if (mode === 'kids') { /* こどもモードではショートカットはこれだけ */ }
      else if (e.key >= '1' && e.key <= '4') { S.cur = +e.key - 1; refreshPattern(); dirty = true; }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'Escape') $('#help').classList.remove('show');
    });

    window.addEventListener('resize', () => { layout(); });
    // 最初のクリックで音を起こす（ブラウザの自動再生制限）
    document.addEventListener('pointerdown', () => ensureAudio(), { once: true });
  }

  /* ---------- こまごま ---------- */
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function stamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
  }

  /* ---------- 画面更新ループ ---------- */
  function frame() {
    if (playing && actx) {
      const now = actx.currentTime;
      let changed = false;
      while (queue.length && queue[0].t <= now + 0.001) {
        const q = queue.shift();
        dispStep = q.step; dispPat = q.pat; changed = true;
      }
      if (changed) {
        if (mode === 'adult') {
          if (S.follow && S.playMode === 'song' && S.cur !== dispPat) {
            S.cur = dispPat; refreshPattern();
          }
          if (dispStep === 0) refreshChain();
        }
        dirty = true;
      }
    }
    if (dirty && mode === 'adult') { drawAll(); dirty = false; }
    requestAnimationFrame(frame);
  }

  /* ============================================================
     起動
     ============================================================ */
  function init() {
    buildUI();
    if (!load()) {
      // はじめての人にも音が出る状態で見せる
      Music.generate(S, 'pop');
    }
    bindUI();
    ['lead', 'chord', 'bass', 'drum'].forEach(bindCanvas);
    refreshAll();
    requestAnimationFrame(frame);
    window.MM = {
      S: () => S, play, stop, toggle, drawAll, audition, ensureAudio, save, toast, download, stamp,
      isPlaying: () => playing,
      playhead: () => ({ step: dispStep, pat: dispPat, playing }),
      mode: () => mode,
      enterKids, exitKids, loadSong, KEYS: SAVE_KEYS,
      get graph() { return graph; }, get actx() { return actx; },
    };
    document.dispatchEvent(new CustomEvent('mm-ready'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
