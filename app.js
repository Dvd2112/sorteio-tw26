(() => {
  const STORAGE_KEY = 'tw26_sorteio';
  const MAX_LANES = 10;       // raias na pista; o resultado é sorteado antes, a pista é só o show
  const BASE_MS = 8000;       // tempo do 1º colocado
  const GAP_MS = 480;         // diferença entre colocações
  const COLORS = ['#ffd23f', '#ff6b6b', '#4ecdc4', '#bf40ff', '#6bcb77', '#4d96ff', '#ff9f1c', '#f368e0', '#ffffff', '#a0e7e5'];
  const MEDALS = ['🥇', '🥈', '🥉'];

  const $ = (id) => document.getElementById(id);
  const el = {
    names: $('names'), file: $('file'), count: $('count'), qty: $('qty'), remove: $('remove'),
    draw: $('draw'), copy: $('copy'), clear: $('clear'), wcount: $('wcount'), empty: $('empty'),
    list: $('list'), confetti: $('confetti'), track: $('track'), race: $('race'),
    hudLeft: $('hud-left'), hudLeader: $('hud-leader'), countdown: $('countdown'), countText: $('count-text'),
    result: $('result'), resultTitle: $('result-title'), resultList: $('result-list'),
    resultClose: $('result-close'), mute: $('mute'), note: $('note'),
  };

  let winners = [];
  let busy = false;
  let muted = false;

  /* ---------- utilidades ---------- */
  function randomInt(max) {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / max) * max;
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % max;
  }
  const rand = (a, b) => a + (randomInt(10001) / 10000) * (b - a);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // sorteia k itens distintos, em ordem, uniformemente (Fisher-Yates parcial)
  function sample(arr, k) {
    const a = [...arr];
    for (let i = 0; i < k; i += 1) {
      const j = i + randomInt(a.length - i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, k);
  }

  function parseNames(text) {
    const seen = new Set();
    const out = [];
    text.split(/\r?\n/).forEach((line) => {
      const name = line.split(/[;\t]/)[0].replace(/^["']|["']$/g, '').trim();
      const key = name.toLowerCase();
      if (name && !seen.has(key)) { seen.add(key); out.push(name); }
    });
    return out;
  }

  const pool = () => {
    const all = parseNames(el.names.value);
    return el.remove.checked ? all.filter((n) => !winners.includes(n)) : all;
  };

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- som ---------- */
  let audio;
  function quack(delay = 0, pitch = 1) {
    if (muted) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime + delay;
      const osc = audio.createOscillator();
      const filter = audio.createBiquadFilter();
      const gain = audio.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(520 * pitch, t);
      osc.frequency.exponentialRampToValueAtTime(260 * pitch, t + 0.14);
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      filter.Q.value = 2;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(filter).connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    } catch { /* áudio indisponível */ }
  }

  function beep(freq, dur = 0.15) {
    if (muted) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch { /* áudio indisponível */ }
  }

  /* ---------- pato (SVG voltado para a direita) ---------- */
  function duckSvg(color) {
    return `<svg viewBox="0 0 76 52" aria-hidden="true">
      <path d="M6 24 L0 14 L16 20 Z" fill="${color}"/>
      <ellipse cx="32" cy="32" rx="25" ry="15" fill="${color}"/>
      <circle cx="52" cy="17" r="11" fill="${color}"/>
      <path d="M60 15 L74 20 L60 25 Z" fill="#ff9f1c"/>
      <circle cx="55" cy="14" r="2.2" fill="#111"/>
      <ellipse cx="30" cy="33" rx="13" ry="8" fill="rgba(0,0,0,.2)"/>
      <path d="M6 46 q8 -5 16 0 t16 0 t16 0" stroke="rgba(255,255,255,.35)" stroke-width="2" fill="none"/>
    </svg>`;
  }

  /* ---------- pista ---------- */
  function buildTrack(lanes, idle) {
    el.track.className = `track${idle ? ' idle' : ''}`;
    el.track.innerHTML = lanes.map((l, i) => `
      <div class="lane" data-i="${i}">
        <div class="lane-name"><b>${esc(l.name)}</b></div>
        <div class="water"><div class="run">
          <div class="duck">${duckSvg(COLORS[i % COLORS.length])}</div>
        </div></div>
      </div>`).join('');
    const laneEls = [...el.track.querySelectorAll('.lane')];
    lanes.forEach((l, i) => {
      l.lane = laneEls[i];
      l.duck = laneEls[i].querySelector('.duck');
      l.nameEl = laneEls[i].querySelector('.lane-name');
    });
  }

  function showIdle() {
    const demo = Array.from({ length: 5 }, (_, i) => ({ name: `Pato ${i + 1}` }));
    buildTrack(demo, true);
    el.hudLeft.textContent = 'Pronto para largar';
    el.hudLeader.textContent = '';
  }

  /* ---------- corrida ---------- */
  async function countdown() {
    el.countdown.hidden = false;
    for (const n of ['3', '2', '1']) {
      el.countText.textContent = n;
      el.countText.style.animation = 'none';
      void el.countText.offsetWidth;
      el.countText.style.animation = '';
      beep(440);
      await wait(900);
    }
    el.countText.textContent = 'JÁ!';
    el.countText.style.animation = 'none';
    void el.countText.offsetWidth;
    el.countText.style.animation = '';
    beep(880, 0.35);
    quack(0.05);
    await wait(600);
    el.countdown.hidden = true;
  }

  function setup() {
    const candidates = pool();
    const n = Math.min(Math.max(parseInt(el.qty.value, 10) || 1, 1), candidates.length);
    const laneCount = Math.min(candidates.length, Math.max(MAX_LANES, n));
    const picked = sample(candidates, laneCount);     // [0..n) = premiados, em ordem de chegada

    const ducks = picked.map((name, rank) => ({
      name, rank,
      T: BASE_MS + rank * GAP_MS + rand(0, GAP_MS * 0.3),
      a1: rand(0.04, 0.09), f1: rand(1.5, 3.5), p1: rand(0, 6.28),
      a2: rand(0.02, 0.05), f2: rand(4, 7), p2: rand(0, 6.28),
      last: 0, done: false,
    }));

    // embaralha em qual raia cada pato fica, para o vencedor não ser sempre o da mesma raia
    const lanes = sample(ducks, ducks.length);
    return { ducks, lanes, n };
  }

  function runRace({ ducks, lanes, n }) {
    return new Promise((resolve) => {
      let finished = 0;
      let leaderName = '';
      const t0 = performance.now();
      el.track.classList.add('racing');
      el.hudLeft.textContent = `${lanes.length} patos na pista`;
      let quackAt = 0;

      (function frame(now) {
        const t = now - t0;
        let best = null;

        ducks.forEach((d) => {
          if (d.done) return;
          const x = Math.min(t / d.T, 1);
          let p = x + (d.a1 * Math.sin(d.f1 * x * 6.283 + d.p1) + d.a2 * Math.sin(d.f2 * x * 6.283 + d.p2)) * Math.sin(Math.PI * x);
          p = Math.min(Math.max(p, d.last, 0), x >= 1 ? 1 : 0.995);
          d.last = p;
          if (x >= 1) {
            d.last = 1;
            d.done = true;
            finished += 1;
            d.duck.classList.add('done');
            if (d.rank < n) {
              const badge = document.createElement('span');
              badge.className = 'medal';
              badge.textContent = MEDALS[d.rank] ?? `#${d.rank + 1}`;
              d.duck.appendChild(badge);
              d.lane.classList.add('win');
              quack(0, 1 + (n - d.rank) * 0.02);
              if (d.rank === 0) launchConfetti(70);
            }
          }
          d.duck.style.left = `${d.last * 100}%`;
        });

        ducks.forEach((d) => { if (!best || d.last > best.last) best = d; });
        if (best.name !== leaderName) {
          leaderName = best.name;
          lanes.forEach((l) => l.lane.classList.toggle('lead', l === best));
          el.hudLeader.textContent = `🏃 Na frente: ${leaderName}`;
        }
        if (now - quackAt > 1400 && finished === 0) { quackAt = now; quack(0, rand(0.9, 1.3)); }

        if (finished < ducks.length) requestAnimationFrame(frame);
        else resolve();
      })(t0);
    });
  }

  async function start() {
    if (busy || !pool().length) return;
    busy = true;
    render();
    el.result.hidden = true;

    const race = setup();
    buildTrack(race.lanes, false);
    el.hudLeft.textContent = 'Preparar...';
    el.hudLeader.textContent = '';
    await countdown();
    await runRace(race);
    await wait(700);

    const podium = race.ducks.filter((d) => d.rank < race.n).sort((a, b) => a.rank - b.rank).map((d) => d.name);
    winners = [...podium, ...winners];
    el.hudLeft.textContent = 'Corrida encerrada';
    el.resultTitle.textContent = podium.length > 1 ? 'Ganhadores' : 'Ganhador';
    el.resultList.innerHTML = podium.map((n, i) => `<li>${MEDALS[i] ?? `${i + 1}º`} ${esc(n)}</li>`).join('');
    el.result.hidden = false;
    launchConfetti(160);
    busy = false;
    render();
  }

  /* ---------- confete ---------- */
  function launchConfetti(amount = 140) {
    const c = el.confetti;
    const ctx = c.getContext('2d');
    c.width = innerWidth;
    c.height = innerHeight;
    const colors = ['#8a00c4', '#bf40ff', '#ffd23f', '#ffffff', '#4ecdc4'];
    const parts = Array.from({ length: amount }, () => ({
      x: c.width / 2, y: c.height / 2.5,
      vx: (Math.random() - 0.5) * 18, vy: Math.random() * -15 - 2,
      s: Math.random() * 7 + 3, color: colors[randomInt(colors.length)], rot: Math.random() * 6,
    }));
    let frames = 0;
    (function step() {
      ctx.clearRect(0, 0, c.width, c.height);
      parts.forEach((p) => {
        p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.rot += 0.1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      });
      frames += 1;
      if (frames < 160) requestAnimationFrame(step);
      else ctx.clearRect(0, 0, c.width, c.height);
    })();
  }

  /* ---------- estado / UI ---------- */
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ text: el.names.value, winners, remove: el.remove.checked }));
    } catch { /* storage indisponível */ }
  }

  function render() {
    const total = parseNames(el.names.value).length;
    const available = pool().length;
    el.count.textContent = `${total} participantes · ${available} disponíveis`;
    el.draw.disabled = busy || !available;
    [el.names, el.qty, el.remove, el.clear].forEach((x) => { x.disabled = busy; });
    el.qty.max = Math.max(available, 1);
    el.note.textContent = available > MAX_LANES
      ? `A pista mostra ${Math.max(MAX_LANES, parseInt(el.qty.value, 10) || 1)} patos; todos os ${available} concorrem ao prêmio.`
      : '';
    el.wcount.textContent = winners.length;
    el.empty.hidden = winners.length > 0;
    el.list.replaceChildren(...winners.map((w) => {
      const li = document.createElement('li');
      li.textContent = w;
      return li;
    }));
    save();
  }

  el.names.addEventListener('input', render);
  el.qty.addEventListener('input', render);
  el.remove.addEventListener('change', render);
  el.draw.addEventListener('click', start);
  el.resultClose.addEventListener('click', () => { el.result.hidden = true; showIdle(); });
  el.clear.addEventListener('click', () => { winners = []; render(); });
  el.mute.addEventListener('click', () => {
    muted = !muted;
    el.mute.textContent = muted ? '🔇 Mudo' : '🔊 Som';
    el.mute.setAttribute('aria-pressed', String(muted));
  });
  el.copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(winners.join('\n')); el.copy.textContent = 'Copiado!'; }
    catch { el.copy.textContent = 'Falhou'; }
    setTimeout(() => { el.copy.textContent = 'Copiar'; }, 1500);
  });
  el.file.addEventListener('change', () => {
    const f = el.file.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { el.names.value = String(reader.result); render(); };
    reader.readAsText(f);
    el.file.value = '';
  });

  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
    el.names.value = s.text ?? '';
    winners = s.winners ?? [];
    el.remove.checked = s.remove ?? true;
  } catch { /* ignora */ }
  showIdle();
  render();
})();
