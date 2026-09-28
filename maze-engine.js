(function () {
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

  class MazeEngine {
    constructor(wrap, cfg, cb) {
      this.wrap = wrap; this.cfg = cfg; this.cb = cb || {};
      this.rows = cfg.rows; this.R = this.rows.length; this.C = this.rows[0].length;
      this.edges = new Set(cfg.edges.map(e => e.join(',')));
      this.goalSet = new Set(cfg.goals.map(g => g.join(',')));
      this.canvas = document.createElement('canvas');
      this.canvas.style.display = 'block';
      this.canvas.style.borderRadius = '10px';
      this.canvas.style.boxShadow = '0 6px 24px rgba(31,52,50,0.18)';
      wrap.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.debug = false; this.state = 'ready'; this.t = 0;
      this.img = new Image();
      this.img.onload = () => { this.fit(); this.draw(); };
      this.img.src = cfg.image;
      this.reach = this.bfs(cfg.start);
      this.shortest = Math.min(...cfg.goals.map(g => this.reach.get(g.join(',')) ?? Infinity));
      this.fullReset();
      this.ro = new ResizeObserver(() => { this.fit(); this.draw(); });
      this.ro.observe(wrap);
      this.onKey = this.onKey.bind(this);
      window.addEventListener('keydown', this.onKey);
      this.bindSwipe();
      this.last = performance.now();
      this.loop = this.loop.bind(this);
      this.raf = requestAnimationFrame(this.loop);
    }
    destroy() {
      cancelAnimationFrame(this.raf); this.ro.disconnect();
      window.removeEventListener('keydown', this.onKey);
      this.canvas.remove();
    }
    walkable(x, y) { return x >= 0 && y >= 0 && x < this.C && y < this.R && this.rows[y][x] !== '#'; }
    canMove(x, y, d) {
      const [dx, dy] = DIRS[d]; const nx = x + dx, ny = y + dy;
      if (!this.walkable(nx, ny)) return false;
      const k = [Math.min(x, nx), Math.min(y, ny), dx ? 'h' : 'v'].join(',');
      return !this.edges.has(k);
    }
    bfs(from) {
      const dist = new Map(); const q = [from]; dist.set(from.join(','), 0);
      while (q.length) {
        const [x, y] = q.shift(); const d0 = dist.get(x + ',' + y);
        for (const d in DIRS) {
          if (!this.canMove(x, y, d)) continue;
          const k = (x + DIRS[d][0]) + ',' + (y + DIRS[d][1]);
          if (dist.has(k)) continue; dist.set(k, d0 + 1); q.push([x + DIRS[d][0], y + DIRS[d][1]]);
        }
      }
      return dist;
    }
    nearestReachable(p) {
      if (this.reach.has(p.join(','))) return p.slice();
      let best = null, bd = 1e9;
      for (const k of this.reach.keys()) { const [x, y] = k.split(',').map(Number); const d = Math.abs(x - p[0]) + Math.abs(y - p[1]); if (d < bd) { bd = d; best = [x, y]; } }
      return best;
    }
    fullReset() {
      this.lives = 3; this.score = 0;
      this.dots = new Set();
      const cherryKeys = new Set(this.cfg.cherries.map(c => this.nearestReachable(c).join(',')));
      this.cherries = [...cherryKeys].map(k => k.split(',').map(Number));
      const [sx, sy] = this.cfg.start;
      for (const k of this.reach.keys()) {
        const [x, y] = k.split(',').map(Number);
        if ((x + y) % 2 !== 0) continue;
        if (this.goalSet.has(k) || cherryKeys.has(k)) continue;
        if (Math.abs(x - sx) + Math.abs(y - sy) < 2) continue;
        this.dots.add(k);
      }
      this.cb.onScore && this.cb.onScore(0);
      this.cb.onLives && this.cb.onLives(3);
      this.resetPositions();
      this.state = 'ready';
    }
    resetPositions() {
      const [sx, sy] = this.cfg.start;
      this.player = { x: sx, y: sy, tx: sx, ty: sy, dir: null, next: null, face: 'right' };
      this.fright = 0;
      this.obs = this.cfg.obstacles.map((o, i) => {
        const p = this.nearestReachable(o.at);
        return { x: p[0], y: p[1], tx: p[0], ty: p[1], home: p, dir: null, color: o.color, delay: o.delay ?? i * 1.5, seed: i * 1.7 };
      });
      this.playerDist = this.bfs([sx, sy]);
      this.pTile = sx + ',' + sy;
    }
    start() { if (this.state === 'ready' || this.state === 'paused') { this.state = 'play'; this.last = performance.now(); } }
    pause() { if (this.state === 'play') this.state = 'paused'; }
    restart() { this.fullReset(); this.start(); }
    setDir(d) {
      if (!DIRS[d]) return;
      const p = this.player; p.next = d;
      if (p.dir && OPP[p.dir] === d && (p.x !== p.tx || p.y !== p.ty)) {
        const bx = Math.round(p.x - DIRS[p.dir][0] * 0.5), by = Math.round(p.y - DIRS[p.dir][1] * 0.5);
        p.tx = p.tx - DIRS[p.dir][0]; p.ty = p.ty - DIRS[p.dir][1]; p.dir = d; p.face = d;
      }
    }
    onKey(e) {
      const k = e.key.toLowerCase();
      const map = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (map[k]) { e.preventDefault(); if (this.state === 'play') this.setDir(map[k]); }
      else if (k === 'g') { this.debug = !this.debug; this.draw(); }
      else if (k === 'p' || k === 'escape') { this.cb.onPauseKey && this.cb.onPauseKey(); }
    }
    bindSwipe() {
      let sx = 0, sy = 0, active = false;
      this.wrap.addEventListener('pointerdown', e => { active = true; sx = e.clientX; sy = e.clientY; });
      this.wrap.addEventListener('pointermove', e => {
        if (!active) return; const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 24) {
          if (this.state === 'ready' && this.cb.onIntent) this.cb.onIntent();
          if (this.state === 'play') this.setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
          sx = e.clientX; sy = e.clientY;
        }
      });
      const end = () => { active = false; };
      this.wrap.addEventListener('pointerup', end); this.wrap.addEventListener('pointercancel', end);
    }
    fit() {
      if (!this.img.naturalWidth) return;
      const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
      if (!w || !h) return;
      const iw = this.img.naturalWidth, ih = this.img.naturalHeight;
      const s = Math.min(w / iw, h / ih);
      const dw = Math.floor(iw * s), dh = Math.floor(ih * s);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.style.width = dw + 'px'; this.canvas.style.height = dh + 'px';
      this.canvas.width = Math.round(dw * dpr); this.canvas.height = Math.round(dh * dpr);
      this.dw = dw; this.dh = dh; this.dpr = dpr;
      this.tw = dw / this.C; this.th = dh / this.R;
    }
    beep(f, dur, type, vol) {
      if (!this.cb.sound || !this.cb.sound()) return;
      try {
        const A = MazeEngine.ac || (MazeEngine.ac = new (window.AudioContext || window.webkitAudioContext)());
        const o = A.createOscillator(), g = A.createGain();
        o.type = type || 'sine'; o.frequency.value = f; g.gain.value = vol || 0.05;
        g.gain.exponentialRampToValueAtTime(0.0001, A.currentTime + dur);
        o.connect(g); g.connect(A.destination); o.start(); o.stop(A.currentTime + dur);
      } catch (e) {}
    }
    step(ent, speed, dt, choose) {
      let remain = speed * dt;
      let guard = 0;
      while (remain > 0 && guard++ < 4) {
        if (ent.x === ent.tx && ent.y === ent.ty) {
          const d = choose(ent);
          if (!d) { ent.dir = null; return; }
          ent.dir = d; ent.tx = ent.x + DIRS[d][0]; ent.ty = ent.y + DIRS[d][1];
          if (ent.onTile) ent.onTile();
        }
        const dx = ent.tx - ent.x, dy = ent.ty - ent.y; const dist = Math.abs(dx) + Math.abs(dy);
        if (dist <= remain) { ent.x = ent.tx; ent.y = ent.ty; remain -= dist; this.arrive(ent); }
        else { ent.x += Math.sign(dx) * remain; ent.y += Math.sign(dy) * remain; remain = 0; }
      }
    }
    arrive(ent) {
      if (ent !== this.player) return;
      const k = ent.x + ',' + ent.y;
      if (k !== this.pTile) { this.pTile = k; this.playerDist = this.bfs([ent.x, ent.y]); }
      if (this.dots.delete(k)) { this.score += 1; this.cb.onScore && this.cb.onScore(this.score); this.beep(660, 0.06, 'triangle', 0.025); }
      const ci = this.cherries.findIndex(c => c[0] === ent.x && c[1] === ent.y);
      if (ci >= 0) {
        this.cherries.splice(ci, 1); this.fright = 6; this.score += 5; this.cb.onScore && this.cb.onScore(this.score);
        this.obs.forEach(o => { if (o.dir && (o.x !== o.tx || o.y !== o.ty)) { o.tx -= DIRS[o.dir][0]; o.ty -= DIRS[o.dir][1]; o.dir = OPP[o.dir]; } });
        this.beep(520, 0.12, 'sine', 0.06); setTimeout(() => this.beep(780, 0.18, 'sine', 0.06), 110);
      }
      if (this.goalSet.has(k)) {
        this.state = 'won'; this.beep(523, 0.15); setTimeout(() => this.beep(659, 0.15), 140); setTimeout(() => this.beep(784, 0.3), 280);
        this.cb.onWin && this.cb.onWin(this.score);
      }
    }
    choosePlayer(p) {
      if (p.next && this.canMove(p.x, p.y, p.next)) { p.face = p.next; return p.next; }
      if (p.dir && this.canMove(p.x, p.y, p.dir)) return p.dir;
      return null;
    }
    chooseObs(o) {
      const opts = Object.keys(DIRS).filter(d => this.canMove(o.x, o.y, d));
      let cand = opts.filter(d => !o.dir || d !== OPP[o.dir]);
      if (!cand.length) cand = opts;
      if (!cand.length) return null;
      const score = d => this.playerDist.get((o.x + DIRS[d][0]) + ',' + (o.y + DIRS[d][1])) ?? 999;
      if (this.fright > 0) { cand.sort((a, b) => score(b) - score(a)); return Math.random() < 0.8 ? cand[0] : cand[Math.floor(Math.random() * cand.length)]; }
      if (Math.random() < (this.cfg.wander ?? 0.3)) return cand[Math.floor(Math.random() * cand.length)];
      cand.sort((a, b) => score(a) - score(b)); return cand[0];
    }
    update(dt) {
      this.t += dt;
      if (this.state === 'hit') { this.hitT -= dt; if (this.hitT <= 0) { this.resetPositions(); this.state = 'play'; } return; }
      if (this.state !== 'play') return;
      if (this.fright > 0) this.fright = Math.max(0, this.fright - dt);
      this.step(this.player, this.cfg.playerSpeed || 4.6, dt, p => this.choosePlayer(p));
      if (this.state !== 'play') return;
      for (const o of this.obs) {
        if (o.delay > 0) { o.delay -= dt; continue; }
        const sp = this.fright > 0 ? (this.cfg.obsSpeed || 2.6) * 0.65 : (this.cfg.obsSpeed || 2.6);
        this.step(o, sp, dt, e => this.chooseObs(e));
        if (this.fright <= 0 && Math.hypot(o.x - this.player.x, o.y - this.player.y) < 0.7) {
          this.lives -= 1; this.cb.onLives && this.cb.onLives(this.lives); this.beep(200, 0.35, 'sine', 0.07);
          if (this.lives <= 0) { this.state = 'over'; this.cb.onOver && this.cb.onOver(); }
          else { this.state = 'hit'; this.hitT = 1.1; }
          return;
        }
      }
    }
    loop(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      this.update(dt); this.draw();
      this.raf = requestAnimationFrame(this.loop);
    }
    cx(x) { return (x + 0.5) * this.tw; }
    cy(y) { return (y + 0.5) * this.th; }
    draw() {
      const c = this.ctx; if (!this.tw) return;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.dw, this.dh);
      c.drawImage(this.img, 0, 0, this.dw, this.dh);
      const u = Math.min(this.tw, this.th);
      this.drawGoal(c, u);
      c.fillStyle = '#F2B84B'; c.strokeStyle = 'rgba(31,52,50,0.55)'; c.lineWidth = Math.max(1, u * 0.04);
      for (const k of this.dots) { const [x, y] = k.split(',').map(Number); c.beginPath(); c.arc(this.cx(x), this.cy(y), u * 0.1, 0, 7); c.fill(); c.stroke(); }
      for (const [x, y] of this.cherries) this.drawCherry(c, this.cx(x), this.cy(y) + Math.sin(this.t * 3) * u * 0.05, u);
      for (const o of this.obs) this.drawBlob(c, o, u);
      if (!(this.state === 'hit' && Math.floor(this.t * 10) % 2)) this.drawPlayer(c, u);
      if (this.debug) this.drawDebug(c, u);
    }
    drawGoal(c, u) {
      const gs = this.cfg.goals; const xs = gs.map(g => g[0]), ys = gs.map(g => g[1]);
      const x0 = Math.min(...xs) * this.tw, x1 = (Math.max(...xs) + 1) * this.tw, y0 = Math.min(...ys) * this.th, y1 = (Math.max(...ys) + 1) * this.th;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 3);
      c.save();
      c.shadowColor = 'rgba(255,214,102,0.95)'; c.shadowBlur = u * (0.4 + 0.5 * pulse);
      c.strokeStyle = `rgba(255,200,70,${0.65 + 0.35 * pulse})`; c.lineWidth = u * 0.12;
      c.beginPath(); c.roundRect(x0 - u * 0.1, y0 - u * 0.1, x1 - x0 + u * 0.2, y1 - y0 + u * 0.2, u * 0.25); c.stroke();
      c.fillStyle = `rgba(255,220,120,${0.18 + 0.15 * pulse})`; c.fill();
      c.restore();
      const ax = (x0 + x1) / 2, ay = y0 - u * 0.35 - Math.abs(Math.sin(this.t * 3)) * u * 0.25;
      c.save(); c.fillStyle = '#F2A93B'; c.strokeStyle = '#1F3432'; c.lineWidth = u * 0.06;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax - u * 0.32, ay - u * 0.36); c.lineTo(ax - u * 0.12, ay - u * 0.36); c.lineTo(ax - u * 0.12, ay - u * 0.7); c.lineTo(ax + u * 0.12, ay - u * 0.7); c.lineTo(ax + u * 0.12, ay - u * 0.36); c.lineTo(ax + u * 0.32, ay - u * 0.36); c.closePath();
      c.fill(); c.stroke(); c.restore();
    }
    drawCherry(c, x, y, u) {
      c.save(); c.strokeStyle = '#4E7F36'; c.lineWidth = u * 0.06; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x - u * 0.15, y + u * 0.08); c.quadraticCurveTo(x - u * 0.05, y - u * 0.2, x + u * 0.08, y - u * 0.32); c.moveTo(x + u * 0.16, y + u * 0.12); c.quadraticCurveTo(x + u * 0.12, y - u * 0.12, x + u * 0.08, y - u * 0.32); c.stroke();
      c.fillStyle = '#7DB85A'; c.beginPath(); c.ellipse(x + u * 0.2, y - u * 0.32, u * 0.12, u * 0.06, -0.4, 0, 7); c.fill();
      c.fillStyle = '#D5413A'; c.strokeStyle = '#7A1F1A'; c.lineWidth = u * 0.04;
      for (const [ox, oy] of [[-0.16, 0.16], [0.16, 0.2]]) { c.beginPath(); c.arc(x + u * ox, y + u * oy, u * 0.16, 0, 7); c.fill(); c.stroke(); }
      c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.arc(x - u * 0.2, y + u * 0.11, u * 0.04, 0, 7); c.fill();
      c.restore();
    }
    drawBlob(c, o, u) {
      const x = this.cx(o.x), y = this.cy(o.y);
      const fr = this.fright > 0; const flash = fr && this.fright < 1.5 && Math.floor(this.t * 6) % 2;
      const r = u * 0.38; const wob = Math.sin(this.t * 4 + o.seed) * 0.05;
      c.save(); c.translate(x, y); c.scale(1 + wob, 1 - wob);
      c.fillStyle = fr ? (flash ? '#FFFFFF' : '#E4EEF0') : o.color;
      c.strokeStyle = fr ? '#6F8D93' : 'rgba(31,52,50,0.6)'; c.lineWidth = u * 0.05;
      if (fr) c.setLineDash([u * 0.08, u * 0.06]);
      c.beginPath();
      const n = 7;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2; const a2 = ((i + 0.5) / n) * Math.PI * 2;
        const px = Math.cos(a) * r, py = Math.sin(a) * r, qx = Math.cos(a2) * r * 1.25, qy = Math.sin(a2) * r * 1.25;
        if (i === 0) c.moveTo(px, py); else c.quadraticCurveTo(Math.cos(a - Math.PI / n) * r * 1.25, Math.sin(a - Math.PI / n) * r * 1.25, px, py);
      }
      c.closePath(); c.fill(); c.stroke(); c.setLineDash([]);
      const dx = o.dir ? DIRS[o.dir][0] * u * 0.04 : 0, dy = o.dir ? DIRS[o.dir][1] * u * 0.04 : 0;
      c.fillStyle = '#1F3432';
      c.beginPath(); c.ellipse(-r * 0.32 + dx, -r * 0.1 + dy, u * 0.045, u * 0.065, 0, 0, 7); c.ellipse(r * 0.32 + dx, -r * 0.1 + dy, u * 0.045, u * 0.065, 0, 0, 7); c.fill();
      c.strokeStyle = '#1F3432'; c.lineWidth = u * 0.035; c.lineCap = 'round';
      c.beginPath();
      if (fr) { c.moveTo(-r * 0.25, r * 0.3); c.quadraticCurveTo(-r * 0.12, r * 0.2, 0, r * 0.3); c.quadraticCurveTo(r * 0.12, r * 0.4, r * 0.25, r * 0.3); }
      else { c.arc(0, r * 0.18, r * 0.18, 0.2 * Math.PI, 0.8 * Math.PI); }
      c.stroke();
      if (!fr) { c.fillStyle = 'rgba(255,150,140,0.55)'; c.beginPath(); c.arc(-r * 0.55, r * 0.15, u * 0.05, 0, 7); c.arc(r * 0.55, r * 0.15, u * 0.05, 0, 7); c.fill(); }
      c.restore();
    }
    drawPlayer(c, u) {
      const p = this.player; const x = this.cx(p.x), y = this.cy(p.y);
      const bob = p.dir && this.state === 'play' ? Math.abs(Math.sin(this.t * 12)) * u * 0.06 : 0;
      c.save(); c.translate(x, y);
      c.fillStyle = 'rgba(31,52,50,0.22)'; c.beginPath(); c.ellipse(0, u * 0.48, u * 0.3, u * 0.08, 0, 0, 7); c.fill();
      const A = MazeEngine.avatar;
      if (A && A.complete && A.naturalWidth) {
        const h = u * 1.12, w = h * A.naturalWidth / A.naturalHeight;
        if (p.face === 'left') c.scale(-1, 1);
        c.drawImage(A, -w / 2, u * 0.52 - h - bob, w, h);
      }
      c.restore();
    }
    drawDebug(c, u) {
      c.save(); c.font = `${Math.max(8, u * 0.22)}px monospace`;
      for (let y = 0; y < this.R; y++) for (let x = 0; x < this.C; x++) {
        const k = x + ',' + y; const solid = this.rows[y][x] === '#';
        c.fillStyle = solid ? 'rgba(220,40,40,0.35)' : this.goalSet.has(k) ? 'rgba(255,200,0,0.5)' : this.reach.has(k) ? 'rgba(40,180,70,0.25)' : 'rgba(40,80,255,0.35)';
        c.fillRect(x * this.tw, y * this.th, this.tw, this.th);
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.5; c.strokeRect(x * this.tw, y * this.th, this.tw, this.th);
      }
      c.strokeStyle = '#FF00FF'; c.lineWidth = Math.max(2, u * 0.12);
      for (const e of this.edges) { const [x, y, t] = e.split(','); const X = +x, Y = +y; c.beginPath(); if (t === 'h') { c.moveTo((X + 1) * this.tw, Y * this.th); c.lineTo((X + 1) * this.tw, (Y + 1) * this.th); } else { c.moveTo(X * this.tw, (Y + 1) * this.th); c.lineTo((X + 1) * this.tw, (Y + 1) * this.th); } c.stroke(); }
      c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(6, 6, u * 7.5, u * 0.9);
      c.fillStyle = '#fff'; c.fillText(`DEBUG ${this.C}×${this.R} · shortest path ${this.shortest} tiles`, 12, 6 + u * 0.6);
      c.restore();
    }
  }
  MazeEngine.avatar = new Image();
  MazeEngine.avatar.src = (window.__resources && window.__resources.avatar) || 'assets/avatar.png';
  window.MazeEngine = MazeEngine;
})();
