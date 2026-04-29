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
      dino = { x: 60, y: GROUND, w: 55, h: 58, vy: 0, onGround: true };
      obstacles = [];
      score = 0;
      speed = 5.5;
      frameCount = 0;
      gameOver = false;
      powerups = [];
      ufo = null;
      ufoDropCooldown = 0;
      droppedRocks = [];
      meteors = [];
      meteorEventActive = false;
      meteorEventTimer = 0;
      meteorWarningTimer = 0;
      shieldActive = false;
      shieldTimer = 0;
      doubleJumpReady = false;
      inSpace = false;
      spaceTimer = 0;
      doubleJumpUsed = false;
    }

    function jump() {
      if (dino.onGround) {
        dino.vy = -13;
        dino.onGround = false;
      } else if (doubleJumpReady && !doubleJumpUsed) {
        dino.vy = -18;
        doubleJumpUsed = true;
        inSpace = true;
        spaceTimer = 80;
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

    let powerups = [];
    let droppedRocks = [];
    let meteors = [];
    let meteorEventActive = false;
    let meteorEventTimer = 0;
    let meteorWarningTimer = 0;
    let shieldActive = false;
    let shieldTimer = 0;
    let doubleJumpReady = false;
    let ufo = null;
    let ufoDropCooldown = 0;
    let doubleJumpUsed = false;
    let inSpace = false;
    let spaceTimer = 0;

    // Background layers
    let bgOffset1 = 0;
    let bgOffset2 = 0;
    let bgOffset3 = 0;
    let dayNightProgress = 0; // 0=tag, 1=nacht
    let isNight = false;
    let dayNightTransitioning = false;

    function drawBackground(ctx) {
      // Tag/Nacht Wechsel alle 600 Punkte
      const targetNight = Math.floor(score / 600) % 2 === 1;
      if (targetNight !== isNight) {
        isNight = targetNight;
      }
      if (isNight) {
        dayNightProgress = Math.min(1, dayNightProgress + 0.01);
      } else {
        dayNightProgress = Math.max(0, dayNightProgress - 0.01);
      }
      const t = dayNightProgress;
      const skyDay = [219, 234, 254];
      const skyNight = [15, 23, 60];
      const r = Math.round(skyDay[0] + (skyNight[0] - skyDay[0]) * t);
      const g = Math.round(skyDay[1] + (skyNight[1] - skyDay[1]) * t);
      const b = Math.round(skyDay[2] + (skyNight[2] - skyDay[2]) * t);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, W, H);

      // Sterne (nur nachts)
      if (t > 0.3) {
        ctx.fillStyle = `rgba(255,255,255,${(t - 0.3) * 1.4})`;
        [
          [50, 15],
          [120, 8],
          [200, 20],
          [300, 10],
          [400, 18],
          [500, 7],
          [350, 25],
        ].forEach(([sx, sy]) => {
          ctx.fillRect(sx, sy, 2, 2);
        });
      }
      // Mond (nur nachts)
      if (t > 0.5) {
        ctx.fillStyle = `rgba(255,240,180,${(t - 0.5) * 2})`;
        ctx.beginPath();
        ctx.arc(W - 60, 30, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${r},${g},${b},${(t - 0.5) * 2})`;
        ctx.beginPath();
        ctx.arc(W - 54, 26, 11, 0, Math.PI * 2);
        ctx.fill();
      }

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

    function drawPowerup(ctx, p) {
      ctx.save();
      ctx.fillStyle = p.type === 'shield' ? '#facc15' : '#a78bfa';
      ctx.beginPath();
      ctx.arc(p.x + 12, GROUND + dino.h - p.h + 12, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        p.type === 'shield' ? '🛡' : '⚡',
        p.x + 12,
        GROUND + dino.h - p.h + 17
      );
      ctx.restore();
    }

    function drawUfo(ctx, u) {
      ctx.save();
      ctx.fillStyle = '#a78bfa';
      ctx.beginPath();
      ctx.ellipse(u.x, u.y, 28, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7c3aed';
      ctx.beginPath();
      ctx.ellipse(u.x, u.y - 6, 14, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(167,139,250,0.4)';
      ctx.beginPath();
      ctx.ellipse(u.x, u.y + 12, 16, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Lichter
      [-16, 0, 16].forEach((ox, i) => {
        ctx.fillStyle = ['#facc15', '#f87171', '#34d399'][i];
        ctx.beginPath();
        ctx.arc(u.x + ox, u.y + 6, 3, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    function drawDroppedRock(ctx, r) {
      ctx.fillStyle = '#888';
      ctx.beginPath();
      ctx.arc(r.x, r.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#aaa';
      ctx.beginPath();
      ctx.arc(r.x - 2, r.y - 2, 4, 0, Math.PI * 2);
      ctx.fill();
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

        drawBackground(ctx);

        // Weltraum-Overlay bei Doppelsprung
        if (inSpace) {
          spaceTimer--;
          const alpha = Math.min(
            1,
            spaceTimer < 20 ? spaceTimer / 20 : (80 - spaceTimer) / 20 + 0.7
          );
          ctx.save();
          ctx.fillStyle = `rgba(10,10,40,${Math.min(0.85, alpha)})`;
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = 'white';
          [
            [30, 10],
            [80, 25],
            [150, 8],
            [220, 35],
            [310, 15],
            [390, 28],
            [470, 5],
            [530, 20],
          ].forEach(([sx, sy]) => {
            ctx.fillRect(
              sx,
              sy,
              Math.random() < 0.1 ? 3 : 2,
              Math.random() < 0.1 ? 3 : 2
            );
          });
          ctx.fillStyle = '#1d4ed8';
          ctx.beginPath();
          ctx.arc(W / 2, H + 60, 90, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#16a34a';
          ctx.beginPath();
          ctx.arc(W / 2 - 20, H + 50, 30, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          if (spaceTimer <= 0) inSpace = false;
        }

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
        speed = 5.5 + Math.floor(score / 150) * 0.7;
        const interval = Math.max(35, 80 - Math.floor(score / 80));
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

        // Power-up spawnen alle ~400 frames
        if (!gameOver && frameCount % 400 === 200) {
          const type = Math.random() < 0.5 ? 'shield' : 'double';
          powerups.push({ x: W, h: 40, type });
        }

        // Power-ups updaten
        for (let i = powerups.length - 1; i >= 0; i--) {
          const p = powerups[i];
          if (!gameOver) p.x -= speed;
          drawPowerup(ctx, p);
          // Kollision mit Dino
          if (
            dino.x + 14 < p.x + 24 &&
            dino.x + 30 > p.x &&
            dino.y + 12 < GROUND + dino.h &&
            dino.y + dino.h > GROUND + dino.h - p.h
          ) {
            if (p.type === 'shield') {
              shieldActive = true;
              shieldTimer = 300;
            } else {
              doubleJumpReady = true;
              doubleJumpUsed = false;
            }
            powerups.splice(i, 1);
            continue;
          }
          if (p.x + 24 < 0) powerups.splice(i, 1);
        }

        // Timers
        if (shieldActive) {
          shieldTimer--;
          if (shieldTimer <= 0) shieldActive = false;
        }

        // Schild-Aura
        if (shieldActive) {
          ctx.save();
          ctx.strokeStyle = `rgba(250,204,21,${0.4 + 0.3 * Math.sin(frameCount * 0.2)})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(dino.x + 52, dino.y + 28, 36, 40, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        for (let i = obstacles.length - 1; i >= 0; i--) {
          const o = obstacles[i];
          if (!gameOver) o.x -= speed;
          drawObstacle(ctx, o);
          if (
            dino.x + 14 < o.x + o.w - 4 &&
            dino.x + dino.w - 10 > o.x + 4 &&
            dino.y + 12 < GROUND + dino.h &&
            dino.y + dino.h > GROUND + dino.h - o.h + 4
          ) {
            if (shieldActive) {
              shieldActive = false;
              shieldTimer = 0;
              obstacles.splice(i, 1);
              continue;
            }
            if (!gameOver) saveScore(score);
            gameOver = true;
          }
          if (o.x + o.w < 0) {
            obstacles.splice(i, 1);
            if (!gameOver) score += 10;
          }
        }

        // Meteor-Event alle 800 Punkte
        if (
          !gameOver &&
          score > 0 &&
          score % 800 < 10 &&
          !meteorEventActive &&
          meteorWarningTimer <= 0
        ) {
          meteorWarningTimer = 80;
        }
        if (meteorWarningTimer > 0) {
          meteorWarningTimer--;
          // Warnung anzeigen
          ctx.save();
          ctx.fillStyle = `rgba(239,68,68,${0.4 + 0.4 * Math.sin(frameCount * 0.3)})`;
          ctx.font = 'bold 16px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('⚠ METEOR-REGEN ⚠', W / 2, 40);
          ctx.restore();
          if (meteorWarningTimer <= 0) {
            meteorEventActive = true;
            meteorEventTimer = 300;
          }
        }

        // Meteor-Event
        if (meteorEventActive && !gameOver) {
          meteorEventTimer--;
          if (meteorEventTimer <= 0) meteorEventActive = false;
          // Meteore spawnen
          if (frameCount % 18 === 0) {
            meteors.push({
              x: Math.random() * W,
              y: -20,
              vx: (Math.random() - 0.3) * 2,
              vy: 5 + Math.random() * 3,
              size: 6 + Math.random() * 8,
            });
          }
        }

        // Meteore zeichnen und bewegen
        for (let i = meteors.length - 1; i >= 0; i--) {
          const m = meteors[i];
          m.x += m.vx;
          m.y += m.vy;
          // Schweif
          ctx.save();
          ctx.strokeStyle = 'rgba(251,146,60,0.5)';
          ctx.lineWidth = m.size * 0.5;
          ctx.beginPath();
          ctx.moveTo(m.x, m.y);
          ctx.lineTo(m.x - m.vx * 5, m.y - m.vy * 5);
          ctx.stroke();
          // Meteor
          ctx.fillStyle = '#f97316';
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(
            m.x - m.size * 0.3,
            m.y - m.size * 0.3,
            m.size * 0.4,
            0,
            Math.PI * 2
          );
          ctx.fill();
          ctx.restore();

          // Boden erreicht
          if (m.y > GROUND + dino.h) {
            meteors.splice(i, 1);
            continue;
          }
          // Kollision mit Dino
          if (
            !shieldActive &&
            Math.abs(m.x - (dino.x + 52)) < m.size + 16 &&
            Math.abs(m.y - (dino.y + 28)) < m.size + 20
          ) {
            if (!gameOver) saveScore(score);
            gameOver = true;
          }
        }

        // UFO spawnen ab Score 300
        if (!gameOver && score > 300 && !ufo && Math.random() < 0.002) {
          ufo = { x: W + 30, y: 40, dir: -1, phase: 0 };
        }

        // UFO bewegen und zeichnen
        if (ufo) {
          ufo.x += ufo.dir * (speed * 0.5);
          ufo.y = 40 + Math.sin(ufo.phase) * 12;
          ufo.phase += 0.05;
          drawUfo(getCtx(), ufo);

          // UFO droppt Fels
          if (
            !gameOver &&
            ufoDropCooldown <= 0 &&
            ufo.x < W - 50 &&
            ufo.x > 100
          ) {
            droppedRocks.push({ x: ufo.x, y: ufo.y });
            ufoDropCooldown = 60;
          }
          if (ufoDropCooldown > 0) ufoDropCooldown--;

          // UFO verschwindet wenn links raus
          if (ufo.x < -60) ufo = null;
        }

        // Dropped rocks
        for (let i = droppedRocks.length - 1; i >= 0; i--) {
          const r = droppedRocks[i];
          r.y += 4;
          drawDroppedRock(getCtx(), r);
          // Boden erreicht → wird zu Hindernis
          if (r.y >= GROUND + dino.h - 15) {
            obstacles.push({ x: r.x - 15, w: 30, h: 20, type: 'rock' });
            droppedRocks.splice(i, 1);
            continue;
          }
          // Kollision mit Dino in der Luft
          if (
            !shieldActive &&
            Math.abs(r.x - (dino.x + 30)) < 20 &&
            Math.abs(r.y - dino.y) < 20
          ) {
            if (!gameOver) saveScore(score);
            gameOver = true;
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
