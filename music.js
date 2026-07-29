/* ============================================================
   music.js — 音楽まわりの「知識」担当
   スケール／コード／進行プリセット／ジャンル／自動作曲
   （音を鳴らすのは audio.js、画面は app.js）
   ============================================================ */
const Music = (function () {
  const STEPS = 16;                 // 1パターン = 1小節 = 16分音符 16個
  const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

  /* ---------- スケール ----------
     deg は「移動ド」の読み。マイナー系は日本の教え方に合わせてラ始まり。 */
  const SCALES = {
    major:      { label: 'メジャー（明るい）',      steps: [0, 2, 4, 5, 7, 9, 11], deg: ['ド', 'レ', 'ミ', 'ファ', 'ソ', 'ラ', 'シ'], parent: 'major' },
    minor:      { label: 'マイナー（せつない）',    steps: [0, 2, 3, 5, 7, 8, 10], deg: ['ラ', 'シ', 'ド', 'レ', 'ミ', 'ファ', 'ソ'], parent: 'minor' },
    majorPenta: { label: 'メジャーペンタ（かんたん）', steps: [0, 2, 4, 7, 9],     deg: ['ド', 'レ', 'ミ', 'ソ', 'ラ'],            parent: 'major' },
    minorPenta: { label: 'マイナーペンタ（クール）',  steps: [0, 3, 5, 7, 10],     deg: ['ラ', 'ド', 'レ', 'ミ', 'ソ'],            parent: 'minor' },
    blues:      { label: 'ブルース',                steps: [0, 3, 5, 6, 7, 10],   deg: ['ラ', 'ド', 'レ', 'ミ♭', 'ミ', 'ソ'],      parent: 'minor' },
    ryukyu:     { label: '琉球（沖縄）',            steps: [0, 4, 5, 7, 11],      deg: ['ド', 'ミ', 'ファ', 'ソ', 'シ'],          parent: 'major' },
  };

  /* ---------- ドラムの並び（上から） ---------- */
  const DRUMS = [
    { id: 'kick',   name: 'キック' },
    { id: 'snare',  name: 'スネア' },
    { id: 'clap',   name: 'クラップ' },
    { id: 'hatC',   name: 'ハイハット' },
    { id: 'hatO',   name: 'オープン' },
    { id: 'tom',    name: 'タム' },
    { id: 'shaker', name: 'シェイカー' },
    { id: 'crash',  name: 'シンバル' },
  ];

  /* ---------- 楽器（音色）の選択肢 ---------- */
  const INSTS = {
    lead:  [['pico', 'ピコピコ'], ['saw', 'シンセ'], ['soft', 'やわらか'], ['epiano', 'エレピ'], ['pluck', 'つまびき'], ['marimba', 'マリンバ'], ['organ', 'オルガン']],
    chord: [['pad', 'パッド'], ['organ', 'オルガン'], ['pluck', 'つまびき'], ['epiano', 'エレピ'], ['saw', 'シンセ'], ['soft', 'やわらか']],
    bass:  [['bassSynth', 'シンセベース'], ['bassRound', 'まるいベース'], ['bassPluck', 'はじきベース']],
  };

  /* ---------- 音の高さの基準（MIDIノート番号） ---------- */
  const BASE = { lead: 60, chord: 48, bass: 36 };   // C4 / C3 / C2

  /* =====================================================
     基本ヘルパー
     ===================================================== */
  const sc = (S) => SCALES[S.scale] || SCALES.major;
  const parentSteps = (S) => SCALES[sc(S).parent].steps;

  function leadRows(S) { return sc(S).steps.length * 2 + 1; }   // 2オクターブ + 1
  function bassRows(S) { return sc(S).steps.length + 1; }       // 1オクターブ + 1

  // スケール上の i 番目（0=主音）の半音数
  function scaleStep(S, i) {
    const st = sc(S).steps, n = st.length;
    return st[((i % n) + n) % n] + 12 * Math.floor(i / n);
  }
  function leadMidi(S, i) { return BASE.lead + S.keyIdx + scaleStep(S, i); }
  function bassMidi(S, i) { return BASE.bass + S.keyIdx + scaleStep(S, i); }

  // 行ラベル（ド / ド• / ド•• …）
  function rowLabel(S, i) {
    const s = sc(S), n = s.steps.length;
    const oct = Math.floor(i / n);
    return s.deg[i % n] + (oct > 0 ? '•'.repeat(oct) : '');
  }

  /* =====================================================
     コード
     ===================================================== */
  // degree: 0=I, 1=ii, ... 6=vii（親スケール上のディグリー）
  function chordInfo(S, degree, seventh) {
    const P = parentSteps(S);
    const at = (d) => P[d % 7] + 12 * Math.floor(d / 7);
    const root = at(degree), third = at(degree + 2), fifth = at(degree + 4), sev = at(degree + 6);
    const i3 = third - root, i5 = fifth - root, i7 = sev - root;

    let quality = 'major', suffix = '';
    if (i3 === 3 && i5 === 7) { quality = 'minor'; suffix = 'm'; }
    else if (i3 === 3 && i5 === 6) { quality = 'dim'; suffix = 'm(♭5)'; }
    else if (i3 === 4 && i5 === 8) { quality = 'aug'; suffix = 'aug'; }

    if (seventh) {
      if (quality === 'major') suffix += (i7 === 11) ? 'M7' : '7';
      else if (quality === 'minor') suffix += (i7 === 10) ? '7' : 'M7';
      else if (quality === 'dim') suffix += '7';
    }

    const rootPc = (S.keyIdx + root) % 12;
    const base = BASE.chord + S.keyIdx;
    const midis = [base + root, base + third, base + fifth];
    if (seventh) midis.push(base + sev);

    // 高くなりすぎたら 1 オクターブ下げる（IV〜vii で暴れないように）
    const shift = midis[0] >= 60 ? -12 : 0;

    return {
      degree, quality,
      name: NOTE[rootPc] + suffix,
      rootPc,
      midis: midis.map(m => m + shift),
      pcs: midis.map(m => m % 12),
    };
  }

  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  function chordRoman(S, degree) {
    const info = chordInfo(S, degree, false);
    const r = ROMAN[degree];
    return (info.quality === 'major' || info.quality === 'aug') ? r : r.toLowerCase();
  }

  // 指定した音名クラス(pc)に一番近い行を探す（ペンタ等でコードの音が無い場合の保険）
  function findRow(S, lane, pc, from, to) {
    const rows = lane === 'bass' ? bassRows(S) : leadRows(S);
    const lo = Math.max(0, from ?? 0), hi = Math.min(rows - 1, to ?? rows - 1);
    let best = lo, bestD = 99;
    for (let i = lo; i <= hi; i++) {
      const m = lane === 'bass' ? bassMidi(S, i) : leadMidi(S, i);
      let d = Math.abs(((m - pc) % 12 + 12) % 12);
      d = Math.min(d, 12 - d);
      if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
    }
    return best;
  }

  /* ---------- コード進行プリセット ---------- */
  const PROGS = [
    { name: 'ポップ王道（I-V-vi-IV）',     type: 'major', deg: [0, 4, 5, 3] },
    { name: 'カノン進行（I-V-vi-iii）',    type: 'major', deg: [0, 4, 5, 2] },
    { name: '王道進行（IV-V-iii-vi）',     type: 'major', deg: [3, 4, 2, 5] },
    { name: '小室進行（vi-IV-V-I）',       type: 'major', deg: [5, 3, 4, 0] },
    { name: 'かんたん（I-IV-V-I）',        type: 'major', deg: [0, 3, 4, 0] },
    { name: 'しっとり（I-vi-IV-V）',       type: 'major', deg: [0, 5, 3, 4] },
    { name: 'マイナー王道（i-VI-III-VII）', type: 'minor', deg: [0, 5, 2, 6] },
    { name: 'せつない（i-iv-VI-v）',        type: 'minor', deg: [0, 3, 5, 4] },
    { name: 'ロック（i-VII-VI-VII）',      type: 'minor', deg: [0, 6, 5, 6] },
    { name: 'ミステリアス（i-VI-iv-v）',    type: 'minor', deg: [0, 5, 3, 4] },
  ];
  function progsFor(S) {
    const t = sc(S).parent === 'minor' ? 'minor' : 'major';
    return PROGS.filter(p => p.type === t);
  }

  /* =====================================================
     パターンの器
     ===================================================== */
  function blankGrid(rows) {
    return Array.from({ length: rows }, () => new Array(STEPS).fill(0));
  }
  function blankPattern(S) {
    return {
      chord: 0, seventh: false, arp: false,
      drum: blankGrid(DRUMS.length),
      bass: blankGrid(bassRows(S)),
      lead: blankGrid(leadRows(S)),
      chordCells: new Array(STEPS).fill(0),
    };
  }
  // スケールを変えたときに行数を作り直す（重なる範囲は残す）
  function resizeGrids(S) {
    for (const p of S.patterns) {
      p.lead = remap(p.lead, leadRows(S));
      p.bass = remap(p.bass, bassRows(S));
    }
    function remap(old, rows) {
      const g = blankGrid(rows);
      for (let r = 0; r < Math.min(rows, old.length); r++) g[r] = old[r].slice(0, STEPS);
      return g;
    }
  }

  function defaultSong() {
    const S = {
      v: 1,
      bpm: 108, swing: 0, keyIdx: 0, scale: 'major',
      playMode: 'song', follow: true, metronome: false,
      master: 0.85, reverb: 0.28, delay: 0.14,
      chain: [0, 1, 2, 3],
      cur: 0,
      tracks: {
        lead:  { inst: 'pico',      vol: 0.75, mute: false },
        chord: { inst: 'pad',       vol: 0.55, mute: false },
        bass:  { inst: 'bassSynth', vol: 0.80, mute: false },
        drum:  { inst: 'kit',       vol: 0.90, mute: false },
      },
      patterns: [],
    };
    S.patterns = [0, 1, 2, 3].map(() => blankPattern(S));
    return S;
  }

  /* =====================================================
     ジャンル（おまかせ作曲のもと）
     x = 鳴らす / X = アクセント / - = 休み
     ===================================================== */
  const GENRES = [
    {
      id: 'pop', name: 'ポップス', bpm: 112, swing: 0, scale: 'major',
      inst: { lead: 'pico', chord: 'pad', bass: 'bassSynth' },
      progs: [[0, 4, 5, 3], [0, 4, 5, 2], [3, 4, 2, 5]],
      chordRhythm: 'beat', bass: 'root8', leadStyle: 'flow', seventh: false, arp: false,
      A: { kick: 'X-------x-------', snare: '----x-------X---', hatC: 'x-x-x-x-x-x-x-x-' },
      B: { kick: 'X-------x---x---', snare: '----x-------X---', hatC: 'x-x-x-x-x-x-x---', tom: '--------------x-' },
    },
    {
      id: 'rock', name: 'ロック', bpm: 132, swing: 0, scale: 'minorPenta',
      inst: { lead: 'saw', chord: 'organ', bass: 'bassPluck' },
      progs: [[0, 6, 5, 6], [0, 5, 2, 6]],
      chordRhythm: 'eighth', bass: 'root8', leadStyle: 'riff', seventh: false, arp: false,
      A: { kick: 'X-------x-x-----', snare: '----x-------X---', hatC: 'x-x-x-x-x-x-x-x-', crash: 'x---------------' },
      B: { kick: 'X-------x-x-----', snare: '----x-------X-x-', hatC: 'x-x-x-x-x-x-----', tom: '------------x-x-' },
    },
    {
      id: 'citypop', name: 'シティポップ', bpm: 98, swing: 0.14, scale: 'major',
      inst: { lead: 'epiano', chord: 'epiano', bass: 'bassRound' },
      progs: [[3, 4, 2, 5], [0, 4, 5, 2]],
      chordRhythm: 'sync', bass: 'walk', leadStyle: 'flow', seventh: true, arp: false,
      A: { kick: 'X-------x-------', clap: '----x-------X---', hatC: 'x-x-x-x-x-x-x-x-', shaker: '--x---x---x---x-' },
      B: { kick: 'X-----x-x-------', clap: '----x-------X---', hatC: 'x-x-x-x-x-x-x-x-', hatO: '--------------x-' },
    },
    {
      id: 'hiphop', name: 'ヒップホップ', bpm: 88, swing: 0.2, scale: 'minorPenta',
      inst: { lead: 'marimba', chord: 'epiano', bass: 'bassRound' },
      progs: [[0, 5, 3, 4], [0, 5, 2, 6]],
      chordRhythm: 'whole', bass: 'sub', leadStyle: 'sparse', seventh: true, arp: false,
      A: { kick: 'X-----x---x-----', snare: '----X-------X---', hatC: 'x-x-x-x-x-x-x-x-' },
      B: { kick: 'X-----x---x---x-', snare: '----X-------X---', hatC: 'x-xxx-x-x-x-x-x-' },
    },
    {
      id: 'techno', name: 'テクノ／EDM', bpm: 126, swing: 0, scale: 'minor',
      inst: { lead: 'saw', chord: 'saw', bass: 'bassSynth' },
      progs: [[0, 5, 2, 6], [0, 3, 5, 4]],
      chordRhythm: 'eighth', bass: 'off', leadStyle: 'arp', seventh: false, arp: true,
      A: { kick: 'X---x---x---x---', clap: '----x-------x---', hatO: '--x---x---x---x-', hatC: 'x-x-x-x-x-x-x-x-' },
      B: { kick: 'X---x---x---x---', clap: '----x-------x---', hatO: '--x---x---x---x-', shaker: 'xxxxxxxxxxxxxxxx' },
    },
    {
      id: 'chip', name: 'ゲーム（チップチューン）', bpm: 150, swing: 0, scale: 'major',
      inst: { lead: 'pico', chord: 'pico', bass: 'bassSynth' },
      progs: [[0, 4, 5, 3], [0, 3, 4, 0], [5, 3, 4, 0]],
      chordRhythm: 'eighth', bass: 'root8', leadStyle: 'chip', seventh: false, arp: true,
      A: { kick: 'X-------x-------', snare: '----x-------x---', hatC: 'x-x-x-x-x-x-x-x-' },
      B: { kick: 'X---x---x---x---', snare: '----x-------x-x-', hatC: 'x-x-x-x-x-x-x-x-' },
    },
    {
      id: 'ballad', name: 'バラード', bpm: 74, swing: 0, scale: 'major',
      inst: { lead: 'soft', chord: 'pad', bass: 'bassRound' },
      progs: [[0, 5, 3, 4], [0, 4, 5, 3]],
      chordRhythm: 'whole', bass: 'sub', leadStyle: 'sparse', seventh: true, arp: false,
      A: { kick: 'X-------x-------', snare: '----x-------x---', hatC: 'x---x---x---x---', crash: 'x---------------' },
      B: { kick: 'X-------x-------', snare: '----x-------x---', hatC: 'x---x---x---x---', shaker: '--x---x---x---x-' },
    },
    {
      id: 'okinawa', name: '沖縄ふう', bpm: 118, swing: 0, scale: 'ryukyu',
      inst: { lead: 'pluck', chord: 'pluck', bass: 'bassPluck' },
      progs: [[0, 3, 4, 0], [0, 4, 3, 0]],
      chordRhythm: 'eighth', bass: 'root4', leadStyle: 'flow', seventh: false, arp: false,
      A: { kick: 'X-------x-------', clap: '----x-------x---', shaker: 'x-x-x-x-x-x-x-x-' },
      B: { kick: 'X-----x-x-------', clap: '----x-------x---', shaker: 'x-x-x-x-x-x-x-x-', tom: '------------x-x-' },
    },
  ];

  /* =====================================================
     自動作曲
     ===================================================== */
  const rnd = (n) => Math.floor(Math.random() * n);
  const pick = (a) => a[rnd(a.length)];

  function applyProgression(S, deg) {
    for (let i = 0; i < 4; i++) S.patterns[i].chord = deg[i % deg.length];
  }

  function generate(S, genreId, opts = {}) {
    const G = GENRES.find(g => g.id === genreId) || GENRES[0];
    S.bpm = G.bpm; S.swing = G.swing; S.scale = G.scale;
    S.tracks.lead.inst = G.inst.lead;
    S.tracks.chord.inst = G.inst.chord;
    S.tracks.bass.inst = G.inst.bass;
    S.chain = [0, 1, 2, 3];

    S.patterns = [0, 1, 2, 3].map(() => blankPattern(S));
    const prog = pick(G.progs);

    // メロディの「型」（リズム）はパターン共通にして、まとまりを出す
    const motif = leadRhythm(G.leadStyle);
    const motif2 = leadRhythm(G.leadStyle);
    let lastDeg = null;

    for (let p = 0; p < 4; p++) {
      const pat = S.patterns[p];
      pat.chord = prog[p % prog.length];
      pat.seventh = G.seventh;
      pat.arp = G.arp;

      // --- ドラム ---
      const set = (p % 2 === 0) ? G.A : G.B;
      for (const [id, str] of Object.entries(set)) {
        const row = DRUMS.findIndex(d => d.id === id);
        if (row < 0) continue;
        for (let s = 0; s < STEPS; s++) {
          const c = str[s];
          pat.drum[row][s] = c === 'X' ? 2 : c === 'x' ? 1 : 0;
        }
      }

      // --- コード ---
      fillChordRhythm(pat, G.chordRhythm);

      // --- ベース ---
      fillBass(S, pat, G.bass);

      // --- メロディ ---
      if (!opts.noLead) {
        const rhythm = (p % 2 === 0) ? motif : motif2;
        lastDeg = fillLead(S, pat, rhythm, lastDeg, p === 3);
      }
    }
    return G;
  }

  function fillChordRhythm(pat, style) {
    const c = pat.chordCells;
    c.fill(0);
    if (style === 'whole') c[0] = 1;
    else if (style === 'beat') { c[0] = 1; c[4] = 1; c[8] = 1; c[12] = 1; }
    else if (style === 'eighth') { for (let s = 0; s < STEPS; s += 2) c[s] = 1; }
    else if (style === 'sync') { c[0] = 1; c[3] = 1; c[6] = 1; c[10] = 1; c[14] = 1; }
    else c[0] = 1;
  }

  function fillBass(S, pat, style) {
    const rows = bassRows(S);
    for (let r = 0; r < rows; r++) pat.bass[r].fill(0);
    const info = chordInfo(S, pat.chord, false);
    const rootRow = findRow(S, 'bass', info.pcs[0], 0, rows - 1);
    const fifthRow = findRow(S, 'bass', info.pcs[2], 0, rows - 1);
    const octRow = Math.min(rows - 1, rootRow + sc(S).steps.length);

    const put = (r, s, len, acc) => {
      for (let i = 0; i < len && s + i < STEPS; i++) pat.bass[r][s + i] = (i === 0 && acc) ? 2 : 1;
    };
    if (style === 'sub') put(rootRow, 0, 16, true);
    else if (style === 'root4') { [0, 4, 8, 12].forEach((s, i) => put(i === 2 ? fifthRow : rootRow, s, 3, s === 0)); }
    else if (style === 'root8') { for (let s = 0; s < STEPS; s += 2) put(s === 12 ? fifthRow : rootRow, s, 1, s % 8 === 0); }
    else if (style === 'off') { for (let s = 2; s < STEPS; s += 4) put(rootRow, s, 1, false); put(rootRow, 0, 1, true); }
    else if (style === 'walk') { put(rootRow, 0, 3, true); put(rootRow, 4, 1); put(fifthRow, 6, 2); put(rootRow, 8, 3, true); put(octRow, 12, 2); put(fifthRow, 14, 2); }
    else put(rootRow, 0, 16, true);
  }

  // メロディのリズム: [開始ステップ, 長さ] の並び
  function leadRhythm(style) {
    const bank = {
      flow:   [[[0, 2], [2, 2], [4, 4], [10, 2], [12, 4]], [[0, 3], [3, 1], [4, 2], [6, 2], [8, 4], [12, 4]], [[0, 4], [4, 2], [6, 2], [8, 2], [11, 3], [14, 2]]],
      sparse: [[[0, 4], [6, 2], [8, 6]], [[0, 6], [8, 4], [12, 4]], [[2, 4], [8, 4], [12, 4]]],
      riff:   [[[0, 2], [2, 1], [3, 1], [4, 2], [8, 2], [10, 1], [11, 1], [12, 4]], [[0, 1], [1, 1], [2, 2], [6, 2], [8, 1], [9, 1], [10, 2], [14, 2]]],
      arp:    [[[0, 1], [2, 1], [4, 1], [6, 1], [8, 1], [10, 1], [12, 1], [14, 1]], [[0, 1], [1, 1], [2, 1], [4, 1], [6, 1], [8, 1], [9, 1], [10, 1], [12, 1], [14, 2]]],
      chip:   [[[0, 1], [1, 1], [2, 2], [4, 1], [5, 1], [6, 2], [8, 1], [9, 1], [10, 2], [12, 4]], [[0, 2], [2, 1], [3, 1], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]]],
    };
    return pick(bank[style] || bank.flow);
  }

  function fillLead(S, pat, rhythm, startDeg, isLast) {
    const rows = leadRows(S);
    for (let r = 0; r < rows; r++) pat.lead[r].fill(0);
    const n = sc(S).steps.length;
    const lo = Math.max(0, n - 2), hi = Math.min(rows - 1, rows - 3);   // 使う音域
    const info = chordInfo(S, pat.chord, false);

    // コードの音になっている行
    const chordRows = [];
    for (let i = lo; i <= hi; i++) {
      const pc = ((leadMidi(S, i) % 12) + 12) % 12;
      if (info.pcs.some(p => ((p % 12) + 12) % 12 === pc)) chordRows.push(i);
    }
    const snap = (d) => {
      if (!chordRows.length) return Math.max(lo, Math.min(hi, d));
      let best = chordRows[0], bd = 99;
      for (const r of chordRows) {
        const x = Math.abs(r - d);
        if (x < bd || (x === bd && Math.random() < 0.5)) { bd = x; best = r; }
      }
      return best;
    };

    // 山なりの輪郭（だんだん上がって下がる）をねらって音を選ぶ
    const span = Math.max(3, hi - lo);
    let deg = startDeg == null ? snap(Math.round((lo + hi) / 2)) : Math.max(lo, Math.min(hi, startDeg));
    let prevDeg = -99, prevEnd = -99;

    rhythm.forEach(([s, len], idx) => {
      const arc = Math.round(lo + span * (0.18 + 0.78 * Math.sin(Math.PI * (idx + 0.5) / rhythm.length)));
      const strong = (s % 4 === 0);
      if (strong || idx === 0) {
        deg = snap(arc + (Math.random() < 0.6 ? 0 : (Math.random() < 0.5 ? -1 : 1)));
      } else {
        const dir = arc > deg ? 1 : arc < deg ? -1 : (Math.random() < 0.5 ? 1 : -1);
        deg += (Math.random() < 0.75 ? 1 : 2) * dir;
      }
      deg = Math.max(lo, Math.min(hi, deg));
      // 同じ高さの音がすき間なく続くと1つの長い音になってしまうのでずらす
      if (deg === prevDeg && s === prevEnd) {
        deg += (deg < hi && arc >= deg) ? 1 : (deg > lo ? -1 : 1);
        deg = Math.max(lo, Math.min(hi, deg));
      }
      for (let i = 0; i < len && s + i < STEPS; i++) pat.lead[deg][s + i] = (i === 0 && strong) ? 2 : 1;
      prevDeg = deg; prevEnd = s + len;
    });

    // 最後のパターンは主音か3度で終わって、まとまりよく
    if (isLast) {
      const last = rhythm[rhythm.length - 1];
      if (last) {
        const [s, len] = last;
        for (let r = 0; r < rows; r++) for (let i = 0; i < len && s + i < STEPS; i++) pat.lead[r][s + i] = 0;
        const tonic = findRow(S, 'lead', (S.keyIdx) % 12, lo, hi);
        for (let i = 0; i < Math.max(len, 2) && s + i < STEPS; i++) pat.lead[tonic][s + i] = i === 0 ? 2 : 1;
        deg = tonic;
      }
    }
    return deg;
  }

  /* ---------- 音の長さ（同じ行で連続しているぶんを1音にまとめる） ---------- */
  function runLength(row, s) {
    let n = 1;
    while (s + n < STEPS && row[s + n]) n++;
    return n;
  }

  return {
    STEPS, NOTE, SCALES, DRUMS, INSTS, BASE, GENRES, PROGS,
    sc, parentSteps, leadRows, bassRows, scaleStep, leadMidi, bassMidi, rowLabel,
    chordInfo, chordRoman, findRow, progsFor,
    blankGrid, blankPattern, resizeGrids, defaultSong,
    generate, applyProgression, fillBass, fillChordRhythm, runLength,
  };
})();
