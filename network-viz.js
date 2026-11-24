/* network-viz.js — two animated views of a LinkedIn Connections.csv
 *   NetworkViz.universe(canvas, data, p, opts)  every connection as a star, forming over time
 *   NetworkViz.shift(canvas, data, p, opts)     who you connected with, period by period
 * data = { cats: [names], pts: [[dayNumber, catIndex], ...] }  (days since 2000-01-01, sorted)
 * p    = progress 0..1. Both are pure functions of p, so they can be scrubbed or played.
 * No names or companies are ever drawn. Only dots, group labels and counts.
 */
(function (root) {
  const COLORS = ['#e8bd4e', '#62b6bd', '#8fc27f', '#a596e0', '#ea8f6f', '#de93ba', '#7ea6e0', '#59626f'];
  const BG = '#0d1016', INK = '#eef1f5', MUTED = '#8a93a1';
  const FONT = "'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif";
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const EPOCH = Date.UTC(2000, 0, 1);

  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const dayToDate = (d) => new Date(EPOCH + d * 864e5);
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function setup(canvas, opts) {
    const dpr = opts.dpr || (root.devicePixelRatio || 1);
    const W = opts.width || canvas.clientWidth, H = opts.height || canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    // safe area: where content may go (lets a vertical video keep clear of app chrome)
    const s = Object.assign({ top: 0.04, right: 0.04, bottom: 0.04, left: 0.04 }, opts.safe || {});
    const box = { x: W * s.left, y: H * s.top, w: W * (1 - s.left - s.right), h: H * (1 - s.top - s.bottom) };
    return { ctx, W, H, box, u: Math.min(box.w, box.h) / 100 };
  }

  /* ---------- universe ---------- */
  const layouts = new WeakMap();
  function layoutUniverse(data, box) {
    const key = box.w + 'x' + box.h;
    let cache = layouts.get(data); if (cache && cache.key === key) return cache;
    const nC = data.cats.length, counts = new Array(nC).fill(0);
    data.pts.forEach((pt) => counts[pt[1]]++);
    const u = Math.min(box.w, box.h) / 100, top = u * 17;                                  // room for the date + counter
    const area = { x: box.x, y: box.y + top, w: box.w, h: box.h - top };
    // radius ~ sqrt(count); scale so the clusters fill about half the area
    const k = Math.sqrt((area.w * area.h * 0.44) / (Math.PI * counts.reduce((a, b) => a + b, 0)));
    const R = counts.map((c) => Math.max(k * Math.sqrt(c), 1));
    // deterministic relaxation: biggest clusters start nearest the middle
    const order = counts.map((c, i) => i).sort((a, b) => counts[b] - counts[a]);
    const C = []; const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
    order.forEach((ci, j) => { const a = j * 2.39996, r = j === 0 ? 0 : 0.2 * Math.min(area.w, area.h) * Math.sqrt(j); C[ci] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) * (area.h / area.w) }; });
    const pad = Math.min(area.w, area.h) * 0.03, labelPad = u * 10;
    for (let it = 0; it < 600; it++) {
      for (let i = 0; i < nC; i++) {
        C[i].x += (cx - C[i].x) * 0.012; C[i].y += (cy - C[i].y) * 0.012;
        for (let j = i + 1; j < nC; j++) {
          const dx = C[j].x - C[i].x, dy = C[j].y - C[i].y, d = Math.hypot(dx, dy) || 0.01, min = R[i] + R[j] + pad + labelPad;
          if (d < min) { const push = (min - d) / 2, ux = dx / d, uy = dy / d; C[i].x -= ux * push; C[i].y -= uy * push; C[j].x += ux * push; C[j].y += uy * push; }
        }
        C[i].x = clamp(C[i].x, area.x + R[i], area.x + area.w - R[i]);
        C[i].y = clamp(C[i].y, area.y + R[i] + labelPad, area.y + area.h - R[i]);
      }
    }
    const seen = new Array(nC).fill(0), rand = rng(7);
    const stars = data.pts.map((pt, i) => {
      const c = pt[1], j = seen[c]++;
      return { c, j, rr: Math.sqrt((j + 0.5) / counts[c]), th: j * 2.39996, from: rand() * Math.PI * 2, tw: rand() * Math.PI * 2, i };
    });
    cache = { key, counts, R, C, stars, k, area };
    layouts.set(data, cache); return cache;
  }

  function universe(canvas, data, p, opts = {}) {
    const { ctx, W, H, box, u } = setup(canvas, opts);
    const L = layoutUniverse(data, box), n = data.pts.length;
    const build = opts.build == null ? 0.8 : opts.build;         // share of the timeline spent forming
    const flight = n * 0.05;                                      // arrival takes this many "stars" of time
    const shown = easeInOut(p / build) * (n + flight * 1.2);      // how many stars have launched
    const spin = p * 0.9;
    const live = new Array(data.cats.length).fill(0);
    const dotR = Math.max(L.k * 0.42, 0.9);
    const far = Math.hypot(W, H) * 0.6;
    ctx.globalCompositeOperation = 'lighter';
    for (const s of L.stars) {
      if (s.i > shown) break;
      live[s.c]++;
      const a = easeOut((shown - s.i) / flight);                  // 0 = just launched, 1 = settled
      const c = L.C[s.c], th = s.th + spin * (s.c % 2 ? -1 : 1);
      const tx = c.x + L.R[s.c] * s.rr * Math.cos(th), ty = c.y + L.R[s.c] * s.rr * Math.sin(th);
      const sx = W / 2 + far * Math.cos(s.from), sy = H / 2 + far * Math.sin(s.from);
      const x = sx + (tx - sx) * a, y = sy + (ty - sy) * a;
      const twinkle = 0.78 + 0.22 * Math.sin(s.tw + p * 40);
      ctx.globalAlpha = (0.25 + 0.75 * a) * twinkle;
      ctx.fillStyle = COLORS[s.c % COLORS.length];
      ctx.beginPath(); ctx.arc(x, y, dotR * (a < 1 ? 1.9 - 0.9 * a : 1), 0, 6.2832); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // cluster labels with a live count
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    data.cats.forEach((name, ci) => {
      if (!live[ci]) return;
      const c = L.C[ci], fade = clamp(live[ci] / Math.max(L.counts[ci] * 0.04, 3));
      ctx.globalAlpha = fade;
      const y = c.y - L.R[ci] - u * 2.2;
      ctx.font = `600 ${u * 3.5}px ${FONT}`; ctx.fillStyle = ci === data.cats.length - 1 ? MUTED : COLORS[ci % COLORS.length];
      ctx.fillText(name, c.x, y);
      ctx.font = `400 ${u * 3}px ${FONT}`; ctx.fillStyle = INK;
      ctx.fillText(live[ci].toLocaleString('en-US'), c.x, y - u * 4.2);
    });
    ctx.globalAlpha = 1;
    // date + running total
    const idx = clamp(Math.floor(shown) - 1, 0, n - 1), d = dayToDate(data.pts[idx][0]);
    ctx.textAlign = 'left';
    ctx.font = `600 ${u * 8}px ${FONT}`; ctx.fillStyle = INK;
    ctx.fillText(`${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, box.x, box.y + u * 8);
    ctx.font = `400 ${u * 3.6}px ${FONT}`; ctx.fillStyle = MUTED;
    ctx.fillText(`${Math.min(n, Math.floor(shown)).toLocaleString('en-US')} connections`, box.x, box.y + u * 13.5);
    if (opts.note) { ctx.textAlign = 'right'; ctx.font = `400 ${u * 2.6}px ${FONT}`; ctx.fillText(opts.note, box.x + box.w, box.y + u * 4); }
  }

  /* ---------- shift ---------- */
  function binShares(data, opts) {
    const per = opts.monthsPerBin || 3, nC = data.cats.length;
    const idx = (day) => { const d = dayToDate(day); return Math.floor((d.getUTCFullYear() * 12 + d.getUTCMonth()) / per); };
    const last = idx(data.pts[data.pts.length - 1][0]);
    const first = opts.fromYear ? Math.floor((opts.fromYear * 12) / per) : idx(data.pts[0][0]);
    const raw = []; for (let b = first; b <= last; b++) raw.push(new Array(nC).fill(0));
    data.pts.forEach((pt) => { const b = idx(pt[0]) - first; if (b >= 0) raw[b][pt[1]]++; });
    // light 1-2-1 smoothing on counts, then shares
    const bins = raw.map((_, i) => { const a = raw[Math.max(i - 1, 0)], b = raw[i], c = raw[Math.min(i + 1, raw.length - 1)]; const v = b.map((x, j) => a[j] + 2 * x + c[j]); const t = v.reduce((s, x) => s + x, 0) || 1; return v.map((x) => x / t); });
    return { bins, first, per };
  }

  function shift(canvas, data, p, opts = {}) {
    const { ctx, W, H, box, u } = setup(canvas, opts);
    const { bins, first, per } = binShares(data, opts), nB = bins.length, nC = data.cats.length;
    const up = opts.rising == null ? 0 : opts.rising, down = opts.falling == null ? 1 : opts.falling;
    // stack order: rising group on the bottom, falling group on top, the rest between
    const order = [up].concat(data.cats.map((_, i) => i).filter((i) => i !== up && i !== down && i !== nC - 1), [nC - 1, down]);
    const head = u * 20, foot = u * 12;
    const plot = { x: box.x, y: box.y + head, w: box.w, h: box.h - head - foot };
    const X = (b) => plot.x + (plot.w * b) / (nB - 1), Y = (v) => plot.y + plot.h * (1 - v);
    const reveal = easeInOut(p / (opts.build == null ? 0.8 : opts.build));
    const edge = reveal * (nB - 1);                                 // fractional bin at the leading edge
    const at = (ci, b) => { const i = Math.floor(clamp(b, 0, nB - 1)), f = clamp(b, 0, nB - 1) - i, j = Math.min(i + 1, nB - 1); return bins[i][ci] * (1 - f) + bins[j][ci] * f; };
    // cumulative tops per band
    const cum = bins.map((bin) => { let s = 0; return order.map((ci) => (s += bin[ci])); });
    const smooth = (pts) => { ctx.lineTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) { const mx = (pts[i - 1][0] + pts[i][0]) / 2; ctx.bezierCurveTo(mx, pts[i - 1][1], mx, pts[i][1], pts[i][0], pts[i][1]); } };
    ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y - 2, plot.w * reveal, plot.h + 4); ctx.clip();
    order.forEach((ci, k) => {
      const topLine = cum.map((c, b) => [X(b), Y(c[k])]), botLine = cum.map((c, b) => [X(b), Y(k ? c[k - 1] : 0)]).reverse();
      ctx.beginPath(); ctx.moveTo(topLine[0][0], topLine[0][1]); smooth(topLine); smooth(botLine); ctx.closePath();
      const hero = ci === up || ci === down;
      ctx.globalAlpha = hero ? 1 : 0.34; ctx.fillStyle = COLORS[ci % COLORS.length]; ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = BG; ctx.lineWidth = u * 0.35; ctx.stroke();
    });
    ctx.restore();
    // leading edge
    const ex = plot.x + plot.w * reveal;
    if (reveal < 1) { ctx.strokeStyle = INK; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ex, plot.y); ctx.lineTo(ex, plot.y + plot.h); ctx.stroke(); ctx.globalAlpha = 1; }
    // year ticks
    ctx.textBaseline = 'alphabetic'; ctx.font = `400 ${u * 3.4}px ${FONT}`; ctx.fillStyle = MUTED;
    const stride = Math.max(1, Math.ceil((u * 11) / ((plot.w * 12) / per / (nB - 1))));   // skip years when they would collide
    for (let b = 0; b < nB; b++) {
      const m = (first + b) * per;
      if (m % 12 !== 0 && b !== 0) continue;
      if (b !== 0 && (Math.floor(m / 12) - Math.floor((first * per) / 12)) % stride !== 0) continue;
      const x = X(b); if (x > ex + 1) continue;
      ctx.textAlign = b === 0 ? 'left' : 'center';
      if (b !== 0 || m % 12 === 0) ctx.fillText(String(Math.floor(m / 12)), x, plot.y + plot.h + u * 5.5);
    }
    // the two numbers that matter, riding the edge
    const pct = (v) => Math.round(v * 100) + '%';
    const upV = at(up, edge), downV = at(down, edge);
    const label = (ci, v, yMid, alignRight) => {
      const x = alignRight ? box.x + box.w : box.x;
      ctx.textAlign = alignRight ? 'right' : 'left';
      ctx.fillStyle = COLORS[ci % COLORS.length]; ctx.font = `700 ${u * 11}px ${FONT}`; ctx.fillText(pct(v), x, yMid);
      ctx.fillStyle = INK; ctx.font = `500 ${u * 3.8}px ${FONT}`; ctx.fillText(data.cats[ci], x, yMid + u * 5);
    };
    label(down, downV, box.y + u * 9.5, false);
    label(up, upV, box.y + u * 9.5, true);
    if (opts.title) { ctx.textAlign = 'center'; ctx.fillStyle = MUTED; ctx.font = `400 ${u * 3.2}px ${FONT}`; ctx.fillText(opts.title, box.x + box.w / 2, box.y + box.h + u * 3); }
    // band names inside the plot once fully revealed
    const nameFade = clamp((p / (opts.build == null ? 0.8 : opts.build) - 1) / 0.12);
    if (nameFade > 0) {
      ctx.globalAlpha = nameFade; ctx.textAlign = 'right'; ctx.font = `500 ${u * 3}px ${FONT}`;
      order.forEach((ci, k) => {
        const hi = cum[nB - 1][k], lo = k ? cum[nB - 1][k - 1] : 0;
        if (hi - lo < 0.055) return;
        ctx.fillStyle = ci === up || ci === down ? BG : INK;
        ctx.fillText(data.cats[ci], plot.x + plot.w - u * 2, Y((hi + lo) / 2) + u * 1);
      });
      ctx.globalAlpha = 1;
    }
  }

  /* ---------- made-up sample data, for demos ---------- */
  function sample(seed = 11, n = 1400) {
    const cats = ['Designers', 'Finance', 'Engineers', 'Healthcare', 'Nonprofit', 'Sales', 'Students', 'Everyone else'];
    const r = rng(seed), pts = [], start = (Date.UTC(2016, 0, 1) - EPOCH) / 864e5, span = 365 * 10;
    for (let i = 0; i < n; i++) {
      const t = Math.pow(r(), 0.55), w = [0.06 + 0.3 * t, 0.3 - 0.24 * t, 0.12, 0.07, 0.06, 0.08, 0.1 - 0.06 * t, 0.25];
      let x = r() * w.reduce((a, b) => a + b, 0), c = 0; while (x > w[c]) { x -= w[c]; c++; }
      pts.push([Math.round(start + t * span), c]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    return { cats, pts };
  }

  /* play helper for the page: animate on scroll into view, with a replay button */
  function play(canvas, fn, data, opts = {}) {
    const dur = opts.duration || 9000; let t0 = null, raf = null;
    const frame = (t) => { if (t0 === null) t0 = t; const p = clamp((t - t0) / dur); fn(canvas, data, p, opts); if (p < 1) raf = requestAnimationFrame(frame); };
    const start = () => { cancelAnimationFrame(raf); t0 = null; raf = requestAnimationFrame(frame); };
    fn(canvas, data, 0, opts);
    if ('IntersectionObserver' in root) { const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { start(); io.disconnect(); } }, { threshold: 0.4 }); io.observe(canvas); } else start();
    return { replay: start };
  }

  root.NetworkViz = { universe, shift, sample, play };
})(typeof window !== 'undefined' ? window : globalThis);
