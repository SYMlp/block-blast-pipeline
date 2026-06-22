// CanvasRenderer — draws a GameEngine to a canvas + drives juice (screen shake,
// particle burst, place squash, line-clear flash, score popups). Reads its
// feel parameters from config.juice — every field here is one A/B dimension.
// This layer is intentionally OUT of the harness: logic is testable headless,
// feel is verified by eye.

const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa', '#f783ac', '#3bc9db'];
const STAGE_W = 360;
const STAGE_H = 520;
const PLAY = 300;

export class CanvasRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bind(engine);
    this.fit();
  }

  bind(engine) {
    this.engine = engine;
    this.juice = engine.config.juice;
    const bw = engine.width;
    const bh = engine.height;
    this.cell = Math.floor(Math.min(PLAY / bw, PLAY / bh));
    this.gx = Math.round((STAGE_W - this.cell * bw) / 2);
    this.gy = 18;
    this.trayCell = Math.max(12, Math.round(this.cell * 0.5));
    this.trayY = this.gy + this.cell * bh + 24;
    this.placeAnim = {};
    this.clearing = [];
    this.particles = [];
    this.popups = [];
    this.shakeT = 0;
    this.shakeMag = 0;
    this.dispScore = engine.score;
    this.tick = 0;
  }

  fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = STAGE_W * dpr;
    this.canvas.height = STAGE_H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Called by the input layer after engine.applyMove succeeds.
  onMove(result) {
    if (!result) return;
    const { piece, row, col, lineCount, clearedCells, combo } = result;
    for (const [dr, dc] of piece.shape) {
      this.placeAnim[(row + dr) * this.engine.width + (col + dc)] = this.tick;
    }
    if (lineCount > 0) {
      const j = this.juice;
      const trauma = j.line_clear_trauma + lineCount * 0.15 + combo * 0.08;
      this.addShake(trauma);
      for (const key of clearedCells) {
        const r = Math.floor(key / this.engine.width);
        const c = key % this.engine.width;
        const color = COLORS[piece.color] || '#fff';
        this.clearing.push({ x: this.gx + c * this.cell, y: this.gy + r * this.cell, color: piece.color, t: -(((c + r) % 4)) * 1.5 });
        this.burst(this.gx + c * this.cell + this.cell / 2, this.gy + r * this.cell + this.cell / 2, color, Math.round(j.particles_per_cell * 0.8));
      }
      this.popup(STAGE_W / 2, this.gy + PLAY * 0.25, combo > 1 ? `连击 x${combo}!` : `+${result.gain}`, combo > 1 ? '#7ee787' : '#ffd23f');
    }
  }

  addShake(m) { this.shakeT = Math.max(this.shakeT, 12); this.shakeMag = Math.max(this.shakeMag, m); }
  burst(x, y, color, n) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3.5; this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 1, color }); } }
  popup(x, y, text, color) { this.popups.push({ x, y, text, t: 0, color }); }

  update() {
    this.tick++;
    const s = this.engine.score;
    this.dispScore += (s - this.dispScore) * 0.25;
    if (Math.abs(s - this.dispScore) < 0.5) this.dispScore = s;
    if (this.shakeT > 0) this.shakeT--; else this.shakeMag = 0;
    for (const p of this.particles) { p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.life -= 0.035; }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const c of this.clearing) c.t++;
    this.clearing = this.clearing.filter((c) => c.t < 16);
    for (const u of this.popups) { u.t++; u.y -= 0.9; }
    this.popups = this.popups.filter((u) => u.t < 55);
  }

  roundRect(x, y, w, h, r) { const ctx = this.ctx; ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  block(x, y, size, color, alpha) {
    const ctx = this.ctx; ctx.save(); ctx.globalAlpha = alpha ?? 1;
    const g = ctx.createLinearGradient(x, y, x, y + size); g.addColorStop(0, '#ffffff55'); g.addColorStop(0.18, color); g.addColorStop(1, color);
    ctx.fillStyle = g; this.roundRect(x + 1.5, y + 1.5, size - 3, size - 3, size * 0.22); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.2)'; this.roundRect(x + 1.5, y + 1.5, size - 3, (size - 3) * 0.4, size * 0.2); ctx.fill(); ctx.restore();
  }

  // held = { piece, pointer:{x,y} } passed in by input layer for the drag ghost.
  render(held) {
    const ctx = this.ctx, eng = this.engine, bw = eng.width, bh = eng.height, cell = this.cell;
    ctx.clearRect(0, 0, STAGE_W, STAGE_H); ctx.save();
    if (this.shakeT > 0) { const m = this.shakeMag * 8 * (this.shakeT / 12); ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m); }

    for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) { ctx.fillStyle = 'rgba(255,255,255,.05)'; this.roundRect(this.gx + c * cell + 1.5, this.gy + r * cell + 1.5, cell - 3, cell - 3, 7); ctx.fill(); }

    if (held && held.piece) {
      const p = held.piece;
      const py = held.pointer.y - p.rows * cell - 20, px = held.pointer.x - p.cols * cell / 2;
      const row = Math.round((py - this.gy) / cell), col = Math.round((px - this.gx) / cell);
      const valid = eng.canPlace(p, row, col);
      for (const [dr, dc] of p.shape) { const r = row + dr, c = col + dc; if (r >= 0 && r < bh && c >= 0 && c < bw) { ctx.fillStyle = valid ? 'rgba(126,231,135,.30)' : 'rgba(255,107,107,.25)'; this.roundRect(this.gx + c * cell + 1.5, this.gy + r * cell + 1.5, cell - 3, cell - 3, 7); ctx.fill(); } }
    }

    for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) {
      if (eng.board[r][c] === -1) continue;
      const key = r * bw + c, start = this.placeAnim[key];
      if (start !== undefined) {
        const age = this.tick - start;
        if (age < 12) { const k = easeOutBack(clamp01(age / 12)), sz = cell * (0.4 + 0.6 * k); this.block(this.gx + c * cell + (cell - sz) / 2, this.gy + r * cell + (cell - sz) / 2, sz, COLORS[eng.board[r][c]]); continue; }
        delete this.placeAnim[key];
      }
      this.block(this.gx + c * cell, this.gy + r * cell, cell, COLORS[eng.board[r][c]]);
    }

    for (const cl of this.clearing) {
      if (cl.t < 0) continue;
      const k = cl.t / 16, grow = cell * (1 + k * 0.5), off = (grow - cell) / 2;
      this.block(cl.x - off, cl.y - off, grow, COLORS[cl.color], 1 - k);
      ctx.save(); ctx.globalAlpha = (1 - k) * this.juice.flash_alpha * 2; ctx.fillStyle = '#fff'; this.roundRect(cl.x - off + 1.5, cl.y - off + 1.5, grow - 3, grow - 3, grow * 0.22); ctx.fill(); ctx.restore();
    }

    for (const p of this.particles) { ctx.save(); ctx.globalAlpha = clamp01(p.life); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, 3 * p.life + 1, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }

    const slotW = STAGE_W / eng.tray.length;
    for (let i = 0; i < eng.tray.length; i++) {
      const p = eng.tray[i]; if (!p || (held && held.index === i)) continue;
      const pw = p.cols * this.trayCell, ph = p.rows * this.trayCell, ox = slotW * i + slotW / 2 - pw / 2, oy = this.trayY + 44 - ph / 2;
      for (const [dr, dc] of p.shape) this.block(ox + dc * this.trayCell, oy + dr * this.trayCell, this.trayCell, COLORS[p.color]);
    }

    if (held && held.piece) {
      const p = held.piece, ox = held.pointer.x - p.cols * cell / 2, oy = held.pointer.y - p.rows * cell - 20;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 8;
      for (const [dr, dc] of p.shape) this.block(ox + dc * cell, oy + dr * cell, cell, COLORS[p.color]); ctx.restore();
    }

    ctx.restore();

    for (const u of this.popups) { ctx.save(); ctx.globalAlpha = u.t < 8 ? u.t / 8 : (1 - easeOutCubic(clamp01((u.t - 8) / 47))); ctx.fillStyle = u.color; ctx.font = '800 24px -apple-system,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(u.text, u.x, u.y); ctx.restore(); }
  }
}

export { STAGE_W, STAGE_H, PLAY };
