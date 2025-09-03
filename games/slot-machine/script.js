/* Slot Machine game logic */
(function(){
  const FRUITS = ['apple','banana','cherry'];
  const creditEl = document.getElementById('credit');
  const statusEl = document.getElementById('status');
  const spinBtn = document.getElementById('spinBtn');
  const restartBtn = document.getElementById('restartBtn');
  const reels = Array.from(document.querySelectorAll('canvas.reel'));

  // Per-reel animation state for fancy scrolling
  const reelStates = reels.map((canvas, i) => ({
    canvas,
    currentIndex: i % FRUITS.length,
    startIndex: 0,
    targetIndex: 0,
    totalSymbols: 0,
    totalPx: 0,
    traveledPx: 0,
    velocity: 0,
    acceleration: 0,
    lastTime: 0,
    startTime: 0,
    duration: 0,
    delay: 0,
    spinning: false,
    prevShift: 0,
    lastTickTime: 0,
  }));

  // --- Minimal WebAudio SFX (no external files) ---
  const Sound = (() => {
    let ctx = null;
    function ensure(){ if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx; }
    function beep(freq, durationMs, type='square', gain=0.02){
      const c = ensure();
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type; osc.frequency.value = freq;
      g.gain.value = 0;
      osc.connect(g); g.connect(c.destination);
      const now = c.currentTime;
      // simple attack/decay envelope
      g.gain.linearRampToValueAtTime(gain, now + 0.01);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain*0.001), now + durationMs/1000);
      osc.start(now);
      osc.stop(now + durationMs/1000 + 0.02);
    }
    return {
      spinStart(){ beep(420, 90, 'square', 0.025); },
      tick(){ beep(880, 35, 'square', 0.015); },
      win(){ beep(740, 120, 'square', 0.03); setTimeout(()=>beep(980, 120, 'square', 0.03), 120); },
      lose(){ beep(220, 120, 'square', 0.02); }
    };
  })();

  // Pixel-art drawing using canvas; size adapts to canvas
  function clearCanvas(ctx, size){
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#1e1e1e';
    ctx.fillRect(0,0,size,size);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg') || '#a6e22e';
    ctx.strokeRect(0.5,0.5,size-1,size-1);
  }

  function drawFruit(ctx, size, fruit){
    clearCanvas(ctx, size);
    const unit = Math.max(1, Math.floor(size/24)); // finer grid like CHIP-8 vibe
    ctx.imageSmoothingEnabled = false;
    // Monochrome palette derived from console fg
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--fg') || '#a6e22e';
    const dim = getComputedStyle(document.documentElement).getPropertyValue('--fg-dim') || '#7fc114';
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#1e1e1e';
    ctx.fillStyle = fg;

    if (fruit === 'apple'){
      // rounder silhouette with a notch at top
      rect(ctx, 8, 6, 8, 10, unit);
      rect(ctx, 7, 7, 10, 8, unit);
      rect(ctx, 6, 8, 12, 6, unit);
      // stem and small leaf
      rect(ctx, 11, 4, 2, 3, unit);
      ctx.fillStyle = dim; rect(ctx, 13, 5, 3, 1, unit); ctx.fillStyle = fg;
      // contour accent
      ctx.fillStyle = dim; rect(ctx, 9, 13, 6, 1, unit); ctx.fillStyle = fg;
    } else if (fruit === 'banana'){
      // crescent-shaped banana: outer body
      ctx.fillStyle = fg;
      rect(ctx, 6, 14, 12, 2, unit);
      rect(ctx, 7, 13, 11, 2, unit);
      rect(ctx, 8, 12, 10, 2, unit);
      rect(ctx, 9, 11, 9, 2, unit);
      rect(ctx, 10, 10, 7, 2, unit);
      rect(ctx, 11, 9, 5, 2, unit);
      rect(ctx, 12, 8, 3, 2, unit);
      // carve inner curve with background
      ctx.fillStyle = bg;
      rect(ctx, 8, 12, 3, 1, unit);
      rect(ctx, 9, 11, 3, 1, unit);
      rect(ctx, 10, 10, 3, 1, unit);
      rect(ctx, 11, 9, 2, 1, unit);
      // tip pixels
      ctx.fillStyle = fg;
      rect(ctx, 6, 13, 1, 1, unit);
      rect(ctx, 18, 14, 1, 1, unit);
      // subtle highlight
      ctx.fillStyle = dim; rect(ctx, 14, 12, 3, 1, unit); ctx.fillStyle = fg;
    } else if (fruit === 'cherry'){
      // two circles with stems
      rect(ctx, 7, 12, 4, 4, unit);
      rect(ctx, 13, 12, 4, 4, unit);
      rect(ctx, 6, 13, 6, 2, unit);
      rect(ctx, 12, 13, 6, 2, unit);
      // stems and connector
      rect(ctx, 9, 7, 1, 5, unit);
      rect(ctx, 15, 7, 1, 5, unit);
      rect(ctx, 9, 7, 7, 1, unit);
      // contour accent
      ctx.fillStyle = dim; rect(ctx, 8, 15, 2, 1, unit); rect(ctx, 14, 15, 2, 1, unit); ctx.fillStyle = fg;
    }
  }

  function rect(ctx, gx, gy, gw, gh, unit){
    ctx.fillRect(gx*unit, gy*unit, gw*unit, gh*unit);
  }

  // --- Fancy reel rendering helpers ---
  function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }
  function easeOutQuint(t){ return 1 - Math.pow(1 - t, 5); }
  function mod(n, m){ return ((n % m) + m) % m; }

  function renderReelScrolling(state, offsetPx, centerIndex){
    const canvas = state.canvas; const ctx = canvas.getContext('2d');
    const size = setCanvasSizeToCSSPixels(canvas);
    const unit = Math.max(1, Math.floor(size/24));
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--fg') || '#a6e22e';
    const dim = getComputedStyle(document.documentElement).getPropertyValue('--fg-dim') || '#7fc114';
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#1e1e1e';

    // background & border
    ctx.fillStyle = bg; ctx.fillRect(0,0,size,size);
    ctx.strokeStyle = fg; ctx.strokeRect(0.5,0.5,size-1,size-1);

    // Draw three sprites to simulate wrap-around
    const indices = [mod(centerIndex-1, FRUITS.length), centerIndex, mod(centerIndex+1, FRUITS.length)];
    const positions = [-size + offsetPx, 0 + offsetPx, size + offsetPx];

    for (let i = 0; i < 3; i++){
      ctx.save();
      ctx.translate(0, Math.round(positions[i]));
      drawSprite(ctx, size, indices[i]);
      ctx.restore();
    }

    function drawSprite(ctx2, s, fruitIndex){
      const fruit = FRUITS[fruitIndex];
      const u = unit; ctx2.imageSmoothingEnabled = false;
      ctx2.fillStyle = fg;
      if (fruit === 'apple'){
        rect(ctx2, 8, 6, 8, 10, u); rect(ctx2, 7, 7, 10, 8, u); rect(ctx2, 6, 8, 12, 6, u);
        rect(ctx2, 11, 4, 2, 3, u); ctx2.fillStyle = dim; rect(ctx2, 13, 5, 3, 1, u); rect(ctx2, 9, 13, 6, 1, u); ctx2.fillStyle = fg;
      } else if (fruit === 'banana'){
        rect(ctx2, 6, 14, 12, 2, u); rect(ctx2, 7, 13, 11, 2, u); rect(ctx2, 8, 12, 10, 2, u);
        rect(ctx2, 9, 11, 9, 2, u); rect(ctx2, 10, 10, 7, 2, u); rect(ctx2, 11, 9, 5, 2, u); rect(ctx2, 12, 8, 3, 2, u);
        ctx2.fillStyle = bg; rect(ctx2, 8, 12, 3, 1, u); rect(ctx2, 9, 11, 3, 1, u); rect(ctx2, 10, 10, 3, 1, u); rect(ctx2, 11, 9, 2, 1, u);
        ctx2.fillStyle = fg; rect(ctx2, 6, 13, 1, 1, u); rect(ctx2, 18, 14, 1, 1, u); ctx2.fillStyle = dim; rect(ctx2, 14, 12, 3, 1, u); ctx2.fillStyle = fg;
      } else if (fruit === 'cherry'){
        rect(ctx2, 7, 12, 4, 4, u); rect(ctx2, 13, 12, 4, 4, u); rect(ctx2, 6, 13, 6, 2, u); rect(ctx2, 12, 13, 6, 2, u);
        rect(ctx2, 9, 7, 1, 5, u); rect(ctx2, 15, 7, 1, 5, u); rect(ctx2, 9, 7, 7, 1, u);
        ctx2.fillStyle = dim; rect(ctx2, 8, 15, 2, 1, u); rect(ctx2, 14, 15, 2, 1, u); ctx2.fillStyle = fg;
      }
    }
  }

  function setCanvasSizeToCSSPixels(canvas){
    const rect = canvas.getBoundingClientRect();
    const size = Math.floor(Math.min(rect.width, rect.height));
    if (canvas.width !== size || canvas.height !== size){
      canvas.width = size; canvas.height = size;
    }
    return size;
  }

  function renderAllStatic(){
    reelStates.forEach((st) => {
      const ctx = st.canvas.getContext('2d');
      const size = setCanvasSizeToCSSPixels(st.canvas);
      drawFruit(ctx, size, FRUITS[st.currentIndex]);
    });
  }

  // Game state
  let credit = 10;
  let spinning = false;

  function updateCreditDisplay(){ creditEl.textContent = `credit: ${credit}`; }

  function pickRandomFruit(){
    const r = Math.floor(Math.random() * FRUITS.length);
    return FRUITS[r];
  }

  function spin(){
    if (spinning) return;
    if (credit <= 0){ statusEl.textContent = 'no credit — press Restart'; return; }
    credit -= 1; updateCreditDisplay();
    statusEl.textContent = 'spinning…';
    statusEl.style.color = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#39ff14';
    spinning = true; spinBtn.disabled = true; restartBtn.disabled = true;
    Sound.spinStart();

    const targets = [pickRandomFruit(), pickRandomFruit(), pickRandomFruit()];
    const resultsIdx = targets.map(f => FRUITS.indexOf(f));
    const start = performance.now();

    reelStates.forEach((st, i) => {
      st.startIndex = st.currentIndex;
      st.targetIndex = resultsIdx[i];
      const rotations = 6 + i * 2; // more for later reels
      const step = mod(st.targetIndex - st.startIndex, FRUITS.length);
      st.totalSymbols = rotations * FRUITS.length + step;
      const size = setCanvasSizeToCSSPixels(st.canvas);
      st.totalPx = st.totalSymbols * size;
      st.traveledPx = 0;
      // Choose a constant deceleration and compute initial velocity so it stops exactly
      st.acceleration = - (size * 40); // px/s^2, tuned for feel
      const v0 = Math.sqrt(Math.max(0, -2 * st.acceleration * st.totalPx));
      st.velocity = v0;
      st.duration = (v0 / -st.acceleration) * 1000; // ms until stop
      st.delay = i * 80;
      st.startTime = start;
      st.lastTime = start;
      st.spinning = true;
    st.prevShift = 0; st.lastTickTime = start;
    });

    function animate(){
      const now = performance.now();
      let allDone = true;
      reelStates.forEach((st) => {
        if (!st.spinning){ return; }
        const canvas = st.canvas; const size = setCanvasSizeToCSSPixels(canvas);
        const elapsed = now - st.startTime - st.delay;
        if (elapsed < 0){
          // show current
          renderReelScrolling(st, 0, st.startIndex);
          allDone = false; return;
        }
        // physics-based deceleration ensuring continuous motion to target
        const dt = (now - st.lastTime) / 1000;
        st.lastTime = now;
        // advance with current velocity
        const movePx = Math.min(st.velocity * dt, st.totalPx - st.traveledPx);
        st.traveledPx += movePx;
        st.velocity = Math.max(0, st.velocity + st.acceleration * dt);

        const traveledSymbols = st.traveledPx / size;
        const shift = Math.floor(traveledSymbols);
        const offsetPx = (traveledSymbols - shift) * size;
        const centerIndex = mod(st.startIndex + shift, FRUITS.length);
        renderReelScrolling(st, offsetPx, centerIndex);

        // play mechanical tick on symbol step
        if (shift !== st.prevShift && elapsed >= 0){
          st.prevShift = shift; Sound.tick();
        }

        if (st.traveledPx >= st.totalPx - 0.5){
          // Final align on exact target
          renderReelScrolling(st, 0, st.targetIndex);
          st.currentIndex = st.targetIndex;
          st.spinning = false;
        } else {
          allDone = false;
        }
      });
      if (!allDone) requestAnimationFrame(animate); else endSpin(targets);
    }
    requestAnimationFrame(animate);
  }

  function endSpin(results){
    const win = results[0] === results[1] && results[1] === results[2];
    if (win){
      const payout = 5; // simple payout
      credit += payout; updateCreditDisplay();
      statusEl.textContent = `win! +${payout}`;
      Sound.win();
    } else {
      statusEl.textContent = 'try again';
      statusEl.style.color = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#39ff14';
      Sound.lose();
    }
    spinning = false; spinBtn.disabled = false; restartBtn.disabled = false;
  }

  function restart(){
    credit = 10; updateCreditDisplay(); statusEl.textContent = '';
    renderAllStatic();
  }

  // Events
  spinBtn.addEventListener('click', spin);
  restartBtn.addEventListener('click', restart);
  document.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); spin(); }
    else if (e.key.toLowerCase() === 'r') { restart(); }
    else if (e.key === 'Backspace' || e.key.toLowerCase() === 'b' || e.key === 'Escape') {
      window.location.href = '../../misc.html';
    }
  }, { passive: false });

  // Resize handling for crisp pixel look
  const ro = new ResizeObserver(() => renderAllStatic());
  reels.forEach(c => ro.observe(c));

  // Init
  updateCreditDisplay();
  renderAllStatic();
})();


