/* ============================================================
   kids.js — こどもモード
   ・8マス × 5音（ペンタトニック）＋ ドラム3つ だけ
   ・かいたメロディは A〜D 全部のパターンに書きこむので、
     コードが変わりながら同じフレーズがくりかえされる＝曲になる
   ・ベースとコードは自動（子どもは触らない）
   ============================================================ */
const Kids = (function () {
  const KSTEPS = 8;                 // 8マス（8分音符）＝1小節
  const MEL_ROWS = 6;
  const BASE_DEG = 5;               // メジャーペンタの5番目＝ど（C5）
  const MEL = [                     // 下（低い）から上（高い）
    { n: 'ど', c: '#ff5b5b' },
    { n: 'れ', c: '#ff9b34' },
    { n: 'み', c: '#f5cd2f' },
    { n: 'そ', c: '#57c463' },
    { n: 'ら', c: '#37a9ec' },
    { n: 'ど', c: '#9b6cf0' },
  ];
  const DRUM = [                    // row = Music.DRUMS の番号
    { row: 0, n: 'どん', e: '🥁', c: '#6b7fd7' },
    { row: 1, n: 'たん', e: '👏', c: '#f2686a' },
    { row: 3, n: 'しゃか', e: '✨', c: '#e8a33b' },
  ];
  const INSTS = [['marimba', '🔔'], ['epiano', '🎹'], ['pluck', '🎸'], ['pico', '👾']];
  const SPEEDS = [['🐢', 84], ['🚶', 108], ['🐇', 138]];
  const BEATS = [                   // おまかせで使うリズム（8マス）
    { kick: [0, 4], snare: [2, 6], hat: [0, 1, 2, 3, 4, 5, 6, 7] },
    { kick: [0, 3, 4], snare: [2, 6], hat: [0, 2, 4, 6] },
    { kick: [0, 4, 6], snare: [2, 6], hat: [1, 3, 5, 7] },
  ];

  const GUT = 58;
  let cellW = 62, rowH = 46;
  let el, cvMel, cvDrum, running = false, dirty = true, lastCell = -1;

  /* ---------- 曲データの読み書き（8マス ⇔ 16ステップ） ---------- */
  const melRow = (r) => BASE_DEG + r;

  function getMel(S, r, i) { return S.patterns[0].lead[melRow(r)][i * 2] ? 1 : 0; }
  function setMel(S, r, i, v) {
    S.patterns.forEach(p => {
      p.lead[melRow(r)][i * 2] = v ? 1 : 0;
      p.lead[melRow(r)][i * 2 + 1] = v ? 1 : 0;
    });
  }
  function getDrum(S, r, i) { return S.patterns[0].drum[DRUM[r].row][i * 2] ? 1 : 0; }
  function setDrum(S, r, i, v) {
    S.patterns.forEach(p => {
      p.drum[DRUM[r].row][i * 2] = v ? 1 : 0;
      p.drum[DRUM[r].row][i * 2 + 1] = 0;
    });
  }
  function clearMel(S) { for (let r = 0; r < MEL_ROWS; r++) for (let i = 0; i < KSTEPS; i++) setMel(S, r, i, 0); }
  function clearDrum(S) { for (let r = 0; r < DRUM.length; r++) for (let i = 0; i < KSTEPS; i++) setDrum(S, r, i, 0); }

  function putBeat(S, b) {
    clearDrum(S);
    b.kick.forEach(i => setDrum(S, 0, i, 1));
    b.snare.forEach(i => setDrum(S, 1, i, 1));
    b.hat.forEach(i => setDrum(S, 2, i, 1));
  }

  /* ---------- 曲を作る ---------- */
  function makeSong() {
    const S = Music.defaultSong();
    S.scale = 'majorPenta'; S.bpm = 108; S.keyIdx = 0;
    S.playMode = 'song'; S.chain = [0, 1, 2, 3]; S.follow = false;
    S.tracks.lead.inst = 'marimba'; S.tracks.lead.vol = 0.85;
    S.tracks.chord.inst = 'pad'; S.tracks.chord.vol = 0.42;
    S.tracks.bass.inst = 'bassRound'; S.tracks.bass.vol = 0.7;
    S.tracks.drum.vol = 0.85;
    S.reverb = 0.3; S.delay = 0.1;
    S.patterns = [0, 1, 2, 3].map(() => Music.blankPattern(S));
    Music.applyProgression(S, [0, 4, 5, 3]);          // ど → そ → らm → ふぁ
    S.patterns.forEach(p => { Music.fillChordRhythm(p, 'beat'); Music.fillBass(S, p, 'root4'); });
    putBeat(S, BEATS[0]);
    [0, 2, 3, 2, 4, 3, 2, 0].forEach((r, i) => setMel(S, r, i, 1));   // ど み そ み ら そ み ど
    return S;
  }

  // おまかせ：山なりの輪郭でメロディを作りなおす
  function randomize(S) {
    clearMel(S);
    let row = 1 + Math.floor(Math.random() * 3);
    const density = 0.68 + Math.random() * 0.27;
    for (let i = 0; i < KSTEPS; i++) {
      if (i > 0 && Math.random() > density) continue;
      const arc = Math.round(0.6 + 3.6 * Math.sin(Math.PI * (i + 0.5) / KSTEPS));
      const dir = arc > row ? 1 : arc < row ? -1 : (Math.random() < 0.5 ? 1 : -1);
      if (i > 0) row += (Math.random() < 0.75 ? 1 : 2) * dir;
      row = Math.max(0, Math.min(MEL_ROWS - 1, row));
      setMel(S, row, i, 1);
    }
    for (let r = 0; r < MEL_ROWS; r++) setMel(S, r, KSTEPS - 1, 0);
    setMel(S, 0, KSTEPS - 1, 1);                       // さいごは「ど」でおわる
    putBeat(S, BEATS[Math.floor(Math.random() * BEATS.length)]);
  }

  /* ---------- 描画 ---------- */
  function layout() {
    const w = Math.min(window.innerWidth - 20, 940);
    cellW = Math.max(32, Math.floor((w - GUT) / KSTEPS));
    const avail = window.innerHeight - 250;   // 上下のボタン列のぶんを引く
    rowH = Math.max(26, Math.min(56, Math.floor(avail / 9)));
    dirty = true;
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function drawGrid(cv, rows, meta, get) {
    const S = MM.S();
    const g = cv.getContext('2d');
    const W = GUT + KSTEPS * cellW, H = rows * rowH;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const ph = MM.playhead();
    const cell = ph.playing && ph.step >= 0 ? Math.floor(ph.step / 2) : -1;

    // 再生中の列
    if (cell >= 0) {
      g.fillStyle = 'rgba(255,214,102,.45)';
      roundRect(g, GUT + cell * cellW + 1, 0, cellW - 2, H, 10); g.fill();
    }

    for (let dr = 0; dr < rows; dr++) {
      const r = rows - 1 - dr;                        // 上が高い音
      const y = dr * rowH;
      const m = meta[r];

      // ラベル
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = m.c;
      if (m.e) {
        g.font = `${Math.min(20, rowH * 0.5)}px system-ui`;
        g.fillText(m.e, 6, y + rowH / 2);
        g.font = `bold ${Math.min(13, rowH * 0.32)}px system-ui, sans-serif`;
        g.fillText(m.n, 28, y + rowH / 2);
      } else {
        g.font = `bold ${Math.min(24, rowH * 0.62)}px system-ui, sans-serif`;
        g.fillText(m.n, 12, y + rowH / 2);
      }

      for (let i = 0; i < KSTEPS; i++) {
        const on = get(S, r, i);
        const x = GUT + i * cellW, pad = 3;
        const big = on && i === cell;
        const px = x + pad - (big ? 2 : 0), py = y + pad - (big ? 2 : 0);
        const pw = cellW - pad * 2 + (big ? 4 : 0), phh = rowH - pad * 2 + (big ? 4 : 0);
        if (on) {
          g.fillStyle = m.c;
          roundRect(g, px, py, pw, phh, 9); g.fill();
          g.fillStyle = 'rgba(255,255,255,.35)';
          roundRect(g, px + 4, py + 3, pw - 8, phh * 0.34, 6); g.fill();
          if (big) { g.strokeStyle = '#fff'; g.lineWidth = 3; roundRect(g, px, py, pw, phh, 9); g.stroke(); }
        } else {
          g.fillStyle = i % 2 === 0 ? '#f3e8d8' : '#efe2cf';
          roundRect(g, px, py, pw, phh, 9); g.fill();
        }
      }
    }
  }

  function draw() {
    drawGrid(cvMel, MEL_ROWS, MEL, getMel);
    drawGrid(cvDrum, DRUM.length, DRUM, getDrum);
  }

  function loop() {
    if (!running) return;
    const ph = MM.playhead();
    const cell = ph.playing ? Math.floor(ph.step / 2) : -1;
    if (cell !== lastCell) { lastCell = cell; dirty = true; }
    if (dirty) { draw(); dirty = false; }
    requestAnimationFrame(loop);
  }

  /* ---------- 操作 ---------- */
  function bind(cv, rows, get, set, kind) {
    let paint = null, last = '';
    const hit = (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (x < GUT) return null;
      const i = Math.floor((x - GUT) / cellW), dr = Math.floor(y / rowH);
      if (i < 0 || i >= KSTEPS || dr < 0 || dr >= rows) return null;
      return { i, r: rows - 1 - dr };
    };
    const apply = (e, first) => {
      const h = hit(e); if (!h) return;
      const key = h.r + ':' + h.i;
      if (!first && key === last) return;
      last = key;
      const S = MM.S();
      if (first) paint = get(S, h.r, h.i) ? 0 : 1;
      set(S, h.r, h.i, paint);
      if (paint) {
        if (kind === 'mel') MM.audition('lead', melRow(h.r));
        else MM.audition('drum', DRUM[h.r].row);
      }
      dirty = true; MM.save();
    };
    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      MM.ensureAudio();
      apply(e, true);
    });
    cv.addEventListener('pointermove', (e) => { if (paint !== null && e.buttons) apply(e, false); });
    cv.addEventListener('pointerup', () => { paint = null; last = ''; });
    cv.addEventListener('pointercancel', () => { paint = null; last = ''; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function refreshButtons() {
    const S = MM.S();
    document.querySelectorAll('#kInst .kbtn').forEach(b =>
      b.classList.toggle('sel', b.dataset.v === S.tracks.lead.inst));
    document.querySelectorAll('#kSpeed .kbtn').forEach(b =>
      b.classList.toggle('sel', +b.dataset.v === S.bpm));
    const p = MM.isPlaying();
    const btn = document.getElementById('kPlay');
    btn.textContent = p ? '■' : '▶';
    btn.classList.toggle('on', p);
  }

  /* ---------- 出入り ---------- */
  const MODE_KEY = 'musicMaker.mode';
  function rememberMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) {} }

  function enter() {
    const song = MM.loadSong(MM.KEYS.kids) || makeSong();
    MM.enterKids(song);
    el.classList.add('show');
    document.documentElement.classList.remove('boot-kids');
    running = true; lastCell = -1;
    layout(); refreshButtons();
    rememberMode('kids');
    requestAnimationFrame(loop);
  }
  function exit() {
    running = false;
    MM.exitKids();
    el.classList.remove('show');
    document.documentElement.classList.remove('boot-kids');
    rememberMode('adult');
  }

  // 起動時にどちらの画面を出すか（判定は index.html の head で済ませてある）
  function boot() {
    if (document.documentElement.classList.contains('boot-kids')) enter();
    else { document.documentElement.classList.remove('boot-kids'); rememberMode('adult'); }
  }

  /* ---------- 組み立て ---------- */
  function init() {
    el = document.getElementById('kids');
    cvMel = document.getElementById('kMel');
    cvDrum = document.getElementById('kDrum');

    const mk = (parent, label, val, fn) => {
      const b = document.createElement('button');
      b.className = 'kbtn'; b.textContent = label; b.dataset.v = val;
      b.onclick = () => { fn(); refreshButtons(); MM.save(); };
      parent.appendChild(b); return b;
    };
    INSTS.forEach(([id, emo]) => mk(document.getElementById('kInst'), emo, id,
      () => { MM.S().tracks.lead.inst = id; MM.audition('lead', melRow(2)); }));
    SPEEDS.forEach(([emo, bpm]) => mk(document.getElementById('kSpeed'), emo, bpm,
      () => { MM.S().bpm = bpm; }));

    document.getElementById('kPlay').onclick = () => { MM.toggle(); refreshButtons(); };
    document.getElementById('kRandom').onclick = () => {
      randomize(MM.S()); dirty = true; MM.save();
      if (!MM.isPlaying()) { MM.play(); refreshButtons(); }
    };
    document.getElementById('kClear').onclick = () => {
      clearMel(MM.S()); clearDrum(MM.S()); dirty = true; MM.save();
    };
    document.getElementById('kWav').onclick = async () => {
      const b = document.getElementById('kWav'), old = b.textContent;
      b.textContent = 'まってね…'; b.disabled = true;
      try {
        const blob = await AudioEngine.renderWav(MM.S(), 8);
        MM.download(blob, 'kids-song-' + MM.stamp() + '.wav');
        MM.toast('おんがくを ほぞんしたよ');
      } catch (e) { MM.toast('ほぞんできませんでした'); }
      b.textContent = old; b.disabled = false;
    };
    document.getElementById('kExit').onclick = exit;
    document.getElementById('btnKids').onclick = enter;

    window.addEventListener('resize', () => { if (running) layout(); });

    bind(cvMel, MEL_ROWS, getMel, setMel, 'mel');
    bind(cvDrum, DRUM.length, getDrum, setDrum, 'drum');

    // 再生／停止ボタンの見た目をときどき合わせる（スペースキー対策）
    setInterval(() => { if (running) refreshButtons(); }, 400);

    window.KIDS = { enter, exit, boot, makeSong, randomize, getMel, setMel, getDrum, setDrum, MEL_ROWS, KSTEPS, melRow };
    boot();
  }

  if (window.MM) init();
  else document.addEventListener('mm-ready', init, { once: true });

  return { enter, exit };
})();
