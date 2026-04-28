// Alles aus der IIFE kopieren, aber statt IIFE eine exportierte Funktion:
export function initDinoGame({ authFetch, escapeHtml }) {
  const userDisplayEl = document.getElementById('userDisplay');
  const dinoModal = document.getElementById('dinoModal');
  const dinoCanvas = document.getElementById('dinoCanvas');
  const dinoModalClose = document.getElementById('dinoModalClose');

  if (!userDisplayEl || !dinoModal || !dinoCanvas) return;

  (function () {
    if (!userDisplayEl || !dinoModal || !dinoCanvas) return;

    let dinoClickCount = 0;
    let dinoClickTimer = null;

    userDisplayEl.addEventListener('click', () => {
      dinoClickCount++;
      clearTimeout(dinoClickTimer);
      dinoClickTimer = setTimeout(() => {
        dinoClickCount = 0;
      }, 600);
      if (dinoClickCount >= 3) {
        dinoClickCount = 0;
        dinoModal.classList.remove('hidden');
        loadHighscores();
        startDino();
      }
    });

    dinoModalClose?.addEventListener('click', stopDino);
    dinoModal?.addEventListener('click', (e) => {
      if (e.target === dinoModal) stopDino();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') stopDino();
    });

    const dinoHighscoresEl = document.getElementById('dinoHighscores');
    const rankLabels = [
      { label: '🥇', cls: 'gold' },
      { label: '🥈', cls: 'silver' },
      { label: '🥉', cls: 'bronze' },
    ];

    async function loadHighscores() {
      if (!dinoHighscoresEl) return;
      try {
        const res = await authFetch('/api/dino-scores/top');
        const data = await res.json();
        if (!data.ok) return;
        dinoHighscoresEl.innerHTML = '';
        data.scores.forEach((s, i) => {
          const entry = document.createElement('div');
          entry.className = 'dino-score-entry';
          entry.innerHTML = `
          <span class="dino-score-rank ${rankLabels[i].cls}">${rankLabels[i].label}</span>
          <span class="dino-score-name">${escapeHtml(s.username)}</span>
          <span class="dino-score-val">${s.score}</span>
        `;
          dinoHighscoresEl.appendChild(entry);
        });
      } catch {}
    }

    async function saveScore(s) {
      try {
        await authFetch('/api/dino-score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ score: s }),
        });
        await loadHighscores();
      } catch {}
    }

    let animFrame = null;
    let gameRunning = false;
    let W, H, GROUND;
    let dino, obstacles, score, speed, frameCount, gameOver;

    function initCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const logicalW = dinoCanvas.parentElement.clientWidth - 32 || 560;
      const logicalH = 200;
      W = logicalW;
      H = logicalH;
      GROUND = H - 80;
      dinoCanvas.width = logicalW * dpr;
      dinoCanvas.height = logicalH * dpr;
      dinoCanvas.style.width = logicalW + 'px';
      dinoCanvas.style.height = logicalH + 'px';
      const ctx = dinoCanvas.getContext('2d');
      ctx.scale(dpr, dpr);
    }

    function getCtx() {
      return dinoCanvas.getContext('2d');
    }

    function resetGame() {
      dino = { x: 60, y: GROUND, w: 4, h: 58, vy: 0, onGround: true };
      obstacles = [];
      score = 0;
      speed = 5.5;
      frameCount = 0;
      gameOver = false;
    }

    function jump() {
      if (dino.onGround) {
        dino.vy = -13;
        dino.onGround = false;
      }
    }

    function drawDino(ctx, x, y, onGround, frame) {
      const p = 3;
      const runFrame = onGround && Math.floor(frame / 8) % 2 === 0;

      if (!onGround) {
        // Jump frame
        ctx.fillStyle = '#3a4a5c';
        ctx.fillRect(x + 20 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 27 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 28 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 27 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 28 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 27 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 28 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 27 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 20 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 20 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 20 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 20 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 20 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 20 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 20 * p, p, p);
        ctx.fillStyle = '#8dd4b2';
        ctx.fillRect(x + 20 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 27 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 20 * p, p, p);
        ctx.fillStyle = '#4a5568';
        ctx.fillRect(x + 19 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 27 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 28 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 28 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 19 * p, p, p);
        ctx.fillStyle = '#f1f6f9';
        ctx.fillRect(x + 26 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 27 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 16 * p, p, p);
        ctx.fillStyle = '#2d3748';
        ctx.fillRect(x + 28 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 29 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 29 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 28 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 21 * p, p, p);
      } else if (runFrame) {
        // Walking frame 1 (normal)
        ctx.fillStyle = '#3a4a5c';
        ctx.fillRect(x + 18 * p, y + 0 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 0 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 19 * p, p, p);
        ctx.fillStyle = '#8dd4b2';
        ctx.fillRect(x + 18 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 19 * p, p, p);
        ctx.fillStyle = '#4a5568';
        ctx.fillRect(x + 17 * p, y + 0 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 0 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 0 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 17 * p, p, p);
        ctx.fillStyle = '#f1f6f9';
        ctx.fillRect(x + 24 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 15 * p, p, p);
        ctx.fillStyle = '#2d3748';
        ctx.fillRect(x + 26 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 27 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 27 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 20 * p, p, p);
      } else {
        // Walking frame 2
        ctx.fillStyle = '#3a4a5c';
        ctx.fillRect(x + 18 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 2 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 3 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 5 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 6 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 19 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 20 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 20 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 20 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 20 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 20 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 20 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 20 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 20 * p, p, p);
        ctx.fillStyle = '#8dd4b2';
        ctx.fillRect(x + 18 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 14 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 12 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 9 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 10 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 14 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 15 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 13 * p, y + 18 * p, p, p);
        ctx.fillStyle = '#4a5568';
        ctx.fillRect(x + 17 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 21 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 1 * p, p, p);
        ctx.fillRect(x + 22 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 23 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 24 * p, y + 2 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 5 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 10 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 4 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 7 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 8 * p, y + 17 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 18 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 19 * p, p, p);
        ctx.fillStyle = '#f1f6f9';
        ctx.fillRect(x + 24 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 25 * p, y + 4 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 11 * p, p, p);
        ctx.fillRect(x + 19 * p, y + 13 * p, p, p);
        ctx.fillRect(x + 17 * p, y + 15 * p, p, p);
        ctx.fillRect(x + 16 * p, y + 16 * p, p, p);
        ctx.fillStyle = '#2d3748';
        ctx.fillRect(x + 26 * p, y + 3 * p, p, p);
        ctx.fillRect(x + 0 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 1 * p, y + 6 * p, p, p);
        ctx.fillRect(x + 27 * p, y + 7 * p, p, p);
        ctx.fillRect(x + 27 * p, y + 8 * p, p, p);
        ctx.fillRect(x + 26 * p, y + 9 * p, p, p);
        ctx.fillRect(x + 20 * p, y + 16 * p, p, p);
        ctx.fillRect(x + 11 * p, y + 21 * p, p, p);
        ctx.fillRect(x + 12 * p, y + 21 * p, p, p);
        ctx.fillRect(x + 18 * p, y + 21 * p, p, p);
      }
    }

    function handleInput(e) {
      if (e.type === 'keydown') {
        if (e.code === 'Space' || e.code === 'ArrowUp') {
          e.preventDefault();
          jump();
        }
      } else {
        e.preventDefault();
        if (gameOver) {
          resetGame();
        } else {
          jump();
        }
      }
    }

    // Background layers
    let bgOffset1 = 0; // clouds
    let bgOffset2 = 0; // mountains
    let bgOffset3 = 0; // ground detail

    function drawBackground(ctx) {
      // Sky
      ctx.fillStyle = '#dbeafe';
      ctx.fillRect(0, 0, W, H);

      // Clouds
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const cloudPositions = [0, 200, 420, 620];
      cloudPositions.forEach((cx) => {
        const x = ((((cx - bgOffset1) % (W + 120)) + W + 120) % (W + 120)) - 60;
        ctx.beginPath();
        ctx.ellipse(x, 28, 30, 12, 0, 0, Math.PI * 2);
        ctx.ellipse(x + 18, 22, 22, 14, 0, 0, Math.PI * 2);
        ctx.ellipse(x - 14, 24, 18, 11, 0, 0, Math.PI * 2);
        ctx.fill();
      });

      // Mountains
      ctx.fillStyle = '#bfdbfe';
      const mtnPositions = [80, 260, 440, 600];
      mtnPositions.forEach((mx) => {
        const x = ((((mx - bgOffset2) % (W + 200)) + W + 200) % (W + 200)) - 80;
        ctx.beginPath();
        ctx.moveTo(x - 70, GROUND + dino.h);
        ctx.lineTo(x, GROUND + dino.h - 90);
        ctx.lineTo(x + 70, GROUND + dino.h);
        ctx.fill();
      });

      // Ground strip
      ctx.fillStyle = '#6b8c42';
      ctx.fillRect(0, GROUND + dino.h, W, 8);
      ctx.fillStyle = '#8fb45a';
      ctx.fillRect(0, GROUND + dino.h + 8, W, H - GROUND - dino.h - 8);

      // Ground detail pixels
      ctx.fillStyle = '#5a7a35';
      const detailPositions = [0, 60, 130, 210, 290, 380, 470, 560];
      detailPositions.forEach((dx) => {
        const x = (((dx - bgOffset3) % (W + 40)) + W + 40) % (W + 40);
        ctx.fillRect(x, GROUND + dino.h, 8, 4);
      });
    }

    function drawObstacle(ctx, o) {
      const p = 3;
      const g = (px, py, pw, ph, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(
          o.x + px * p,
          GROUND + dino.h - o.h + py * p,
          pw * p,
          ph * p
        );
      };

      if (o.type === 'cactus') {
        // Kaktus
        g(3, 0, 3, 20, '#2d7a2d');
        g(0, 5, 3, 2, '#2d7a2d');
        g(0, 3, 2, 4, '#2d7a2d');
        g(6, 6, 3, 2, '#2d7a2d');
        g(7, 4, 2, 4, '#2d7a2d');
        g(3, 0, 1, 2, '#1a5c1a');
        g(0, 3, 2, 1, '#1a5c1a');
        g(7, 4, 2, 1, '#1a5c1a');
      } else if (o.type === 'cactus2') {
        // Doppelkaktus
        g(2, 0, 3, 16, '#2d7a2d');
        g(0, 4, 2, 2, '#2d7a2d');
        g(0, 2, 1, 4, '#2d7a2d');
        g(5, 5, 2, 2, '#2d7a2d');
        g(6, 3, 1, 4, '#2d7a2d');
        g(8, 2, 3, 13, '#2d7a2d');
        g(7, 5, 1, 2, '#2d7a2d');
        g(11, 4, 1, 2, '#2d7a2d');
      } else if (o.type === 'rock') {
        // Fels
        g(1, 0, 12, 3, '#888');
        g(0, 3, 15, 7, '#888');
        g(1, 1, 3, 2, '#aaa');
        g(5, 0, 2, 2, '#aaa');
        g(9, 1, 4, 2, '#aaa');
        g(0, 4, 4, 3, '#999');
        g(6, 4, 6, 3, '#999');
      } else if (o.type === 'tree') {
        // Baum
        g(3, 0, 3, 26, '#5a3e1b');
        g(0, 6, 9, 2, '#5a3e1b');
        g(0, 0, 4, 8, '#3a9a3a');
        g(5, 2, 4, 6, '#2d7a2d');
        g(1, 0, 7, 4, '#4ab84a');
      }
    }

    const obstacleTypes = ['cactus', 'cactus', 'cactus2', 'rock', 'tree'];
    const obstacleHeights = { cactus: 60, cactus2: 48, rock: 30, tree: 78 };
    const obstacleWidths = { cactus: 27, cactus2: 36, rock: 45, tree: 27 };

    function startDino() {
      initCanvas();
      resetGame();
      bgOffset1 = 0;
      bgOffset2 = 0;
      bgOffset3 = 0;
      gameRunning = true;
      document.addEventListener('keydown', handleInput);
      dinoCanvas.addEventListener('touchstart', handleInput, {
        passive: false,
      });
      dinoCanvas.addEventListener('click', handleInput);

      function loop() {
        if (!gameRunning) return;
        const ctx = getCtx();

        // Scroll background
        if (!gameOver) {
          bgOffset1 += speed * 0.15;
          bgOffset2 += speed * 0.3;
          bgOffset3 += speed;
        }

        drawBackground(ctx);

        // Physics
        dino.vy += 0.7;
        dino.y += dino.vy;
        if (dino.y >= GROUND) {
          dino.y = GROUND;
          dino.vy = 0;
          dino.onGround = true;
        }

        // Dino
        drawDino(ctx, dino.x, dino.y, dino.onGround, frameCount);

        // Obstacles
        if (!gameOver) frameCount++;
        speed = 5.5 + Math.floor(score / 300) * 0.6;
        const interval = Math.max(45, 80 - Math.floor(score / 150));
        if (!gameOver && frameCount % interval === 0) {
          const type =
            obstacleTypes[Math.floor(Math.random() * obstacleTypes.length)];
          const h = obstacleHeights[type];
          const w = obstacleWidths[type];
          obstacles.push({ x: W, w, h, type });
          if (score > 300 && Math.random() < 0.25) {
            const type2 =
              obstacleTypes[Math.floor(Math.random() * obstacleTypes.length)];
            obstacles.push({
              x: W + obstacleWidths[type] + 20,
              w: obstacleWidths[type2],
              h: obstacleHeights[type2],
              type: type2,
            });
          }
        }

        for (let i = obstacles.length - 1; i >= 0; i--) {
          const o = obstacles[i];
          if (!gameOver) o.x -= speed;
          drawObstacle(ctx, o);
          if (
            dino.x + 8 < o.x + o.w &&
            dino.x + dino.w - 8 > o.x &&
            dino.y + 10 < GROUND + dino.h &&
            dino.y + dino.h > GROUND + dino.h - o.h
          ) {
            if (!gameOver) saveScore(score);
            gameOver = true;
          }
          if (o.x + o.w < 0) {
            obstacles.splice(i, 1);
            if (!gameOver) score += 10;
          }
        }

        // Score
        ctx.fillStyle = '#1e40af';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${score}`, W - 60, 24);

        if (gameOver) {
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 20px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('GAME OVER', W / 2, H / 2 - 12);
          ctx.font = '13px monospace';
          ctx.fillText('Tippen oder ↑ zum Neustart', W / 2, H / 2 + 14);
          ctx.textAlign = 'left';
        }

        animFrame = requestAnimationFrame(loop);
      }

      animFrame = requestAnimationFrame(loop);
    }

    function stopDino() {
      gameRunning = false;
      if (animFrame) cancelAnimationFrame(animFrame);
      document.removeEventListener('keydown', handleInput);
      dinoCanvas.removeEventListener('touchstart', handleInput);
      dinoCanvas.removeEventListener('click', handleInput);
      dinoModal.classList.add('hidden');
      getCtx().clearRect(0, 0, W, H);
    }
  })();
}
