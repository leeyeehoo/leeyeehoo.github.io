/* Games/Gallery scanning renderer */
(function(){
  const SRC = '../../assets/images/cyberpunk.png';
  const canvas = document.getElementById('pxCanvas');
  const ctx = canvas.getContext('2d');
  const fg = getVar('--fg', '#39ff14');
  const bg = getVar('--bg', '#0b0f10');
  const fgDim = getVar('--fg-dim', '#9cff6b');
  // Scan animation tuning (smaller values = slower)
  const SCAN = { sliceHeight: 3, slicesPerFrame: 1, highlightAlpha: 0.25 };
  // Particle reveal tuning
  const PARTICLE = { cell: 6, perFrame: 220, glowAlpha: 0.22 };
  // Old TV/CRT reveal tuning
  const CRT = { beamSpeed: 2, glowHeight: 56, scanlineAlpha: 0.18, noiseCount: 70 };

  function getVar(name, fallback){ 
    const v = getComputedStyle(document.documentElement).getPropertyValue(name); 
    return v && v.trim() ? v.trim() : fallback; 
  }

  function ensureCanvasSize(){
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width * ratio));
    const h = Math.max(1, Math.floor(rect.height * ratio));
    if (canvas.width !== w || canvas.height !== h){ 
      canvas.width = w; 
      canvas.height = h; 
    }
    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.imageSmoothingEnabled = false;
    return {w: rect.width, h: rect.height, ratio};
  }
  
  let resizeTimeout;
  new ResizeObserver(() => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => render(), 100);
  }).observe(canvas);

  const BAYER = [
    [0,48,12,60,3,51,15,63],
    [32,16,44,28,35,19,47,31],
    [8,56,4,52,11,59,7,55],
    [40,24,36,20,43,27,39,23],
    [2,50,14,62,1,49,13,61],
    [34,18,46,30,33,17,45,29],
    [10,58,6,54,9,57,5,53],
    [42,26,38,22,41,25,37,21]
  ];

  function toMonoPixels(img, targetW, targetH){
    // Scale to fit canvas while maintaining aspect ratio
    const scale = Math.min(targetW / img.width, targetH / img.height);
    const w = Math.max(32, Math.min(200, Math.floor(img.width * scale * 0.3))); // Reduce resolution for better pixelization
    const h = Math.max(32, Math.min(200, Math.floor(img.height * scale * 0.3)));
    
    const off = document.createElement('canvas'); 
    off.width = w; 
    off.height = h; 
    const ox = off.getContext('2d');
    ox.imageSmoothingEnabled = false;
    ox.drawImage(img, 0, 0, w, h);
    
    const data = ox.getImageData(0, 0, w, h);
    const out = new Uint8Array(w*h);
    
    for (let y = 0; y < h; y++){
      for (let x = 0; x < w; x++){
        const i = (y*w + x) * 4; 
        const r = data.data[i], g = data.data[i+1], b = data.data[i+2];
        const lum = (0.299*r + 0.587*g + 0.114*b) / 255; // Luminance 0-1
        const threshold = (BAYER[y&7][x&7] + 0.5) / 64; // Bayer threshold 0-1
        out[y*w + x] = lum > threshold ? 1 : 0; // 1 = draw pixel, 0 = background
      }
    }
    return {w, h, mask: out};
  }

  // Create a low-res offscreen canvas to avoid CORS-tainted getImageData on file://
  function pixelateImage(img, targetW, targetH){
    const scale = Math.min(targetW / img.width, targetH / img.height);
    // Increase base resolution and allow a higher cap for crisper pixels
    const w = Math.max(48, Math.min(360, Math.floor(img.width * scale * 0.5)));
    const h = Math.max(48, Math.min(360, Math.floor(img.height * scale * 0.5)));

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ox = off.getContext('2d');
    ox.imageSmoothingEnabled = false;
    ox.drawImage(img, 0, 0, w, h);
    return off;
  }

  function drawPixelated(off, target){
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cellX = Math.max(2, Math.floor(target.w / off.width));
    const cellY = Math.max(2, Math.floor(target.h / off.height));
    const cell = Math.max(1, Math.min(cellX, cellY));
    const drawW = off.width * cell;
    const drawH = off.height * cell;
    const dx = Math.floor((target.w - drawW) / 2);
    const dy = Math.floor((target.h - drawH) / 2);

    ctx.imageSmoothingEnabled = false;
    // 1) draw as grayscale with higher contrast/brightness
    ctx.filter = 'grayscale(100%) contrast(160%) brightness(145%)';
    ctx.drawImage(off, 0, 0, off.width, off.height, dx, dy, drawW, drawH);
    ctx.filter = 'none';
    // 2) tint using terminal foreground color while preserving luminance
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = fg;
    ctx.fillRect(dx, dy, drawW, drawH);
    // 3) subtle screen blend to brighten overall result
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = fg;
    ctx.fillRect(dx, dy, drawW, drawH);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Compose a tinted, scaled bitmap once; used for static draw and scan animation
  function composeTinted(off, target){
    const cellX = Math.max(2, Math.floor(target.w / off.width));
    const cellY = Math.max(2, Math.floor(target.h / off.height));
    const cell = Math.max(2, Math.min(cellX, cellY));
    const drawW = off.width * cell;
    const drawH = off.height * cell;
    const comp = document.createElement('canvas');
    comp.width = drawW;
    comp.height = drawH;
    const cx = comp.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.filter = 'grayscale(100%) contrast(160%) brightness(145%)';
    cx.drawImage(off, 0, 0, off.width, off.height, 0, 0, drawW, drawH);
    cx.filter = 'none';
    cx.globalCompositeOperation = 'multiply';
    cx.fillStyle = fg;
    cx.fillRect(0, 0, drawW, drawH);
    cx.globalCompositeOperation = 'screen';
    cx.globalAlpha = 0.18;
    cx.fillStyle = fg;
    cx.fillRect(0, 0, drawW, drawH);
    cx.globalAlpha = 1;
    cx.globalCompositeOperation = 'source-over';
    return {comp, drawW, drawH};
  }

  // Full-resolution tinted composition for final image (non-mosaic)
  function composeTintedFull(img, target){
    const scale = Math.min(target.w / img.width, target.h / img.height);
    const drawW = Math.floor(img.width * scale);
    const drawH = Math.floor(img.height * scale);
    const comp = document.createElement('canvas');
    comp.width = drawW;
    comp.height = drawH;
    const cx = comp.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.filter = 'grayscale(100%) contrast(160%) brightness(150%)';
    cx.drawImage(img, 0, 0, drawW, drawH);
    cx.filter = 'none';
    cx.globalCompositeOperation = 'multiply';
    cx.fillStyle = fg;
    cx.fillRect(0, 0, drawW, drawH);
    cx.globalCompositeOperation = 'screen';
    cx.globalAlpha = 0.18;
    cx.fillStyle = fg;
    cx.fillRect(0, 0, drawW, drawH);
    cx.globalAlpha = 1;
    cx.globalCompositeOperation = 'source-over';
    return {comp, drawW, drawH};
  }

  function scanReveal(comp, target, token){
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const dx = Math.floor((target.w - comp.drawW) / 2);
    const dy = Math.floor((target.h - comp.drawH) / 2);
    let row = 0;
    const totalRows = comp.drawH;
    function step(){
      if (token !== scanToken) return;
      const start = performance.now();
      let slicesProcessed = 0;
      while (row < totalRows && performance.now() - start < 12 && slicesProcessed < SCAN.slicesPerFrame){
        const sliceH = Math.min(SCAN.sliceHeight, totalRows - row);
        ctx.drawImage(comp.comp, 0, 0, comp.drawW, row + sliceH, dx, dy, comp.drawW, row + sliceH);
        // scanline highlight
        ctx.globalAlpha = SCAN.highlightAlpha;
        ctx.fillStyle = fg;
        ctx.fillRect(dx, dy + row, comp.drawW, Math.max(2, sliceH));
        ctx.globalAlpha = 1;
        row += sliceH;
        slicesProcessed++;
      }
      if (row < totalRows){
        requestAnimationFrame(step);
      } else {
        updateStatus('Scan complete! Press R to restart.');
      }
    }
    requestAnimationFrame(step);
  }

  // Random particle-style reveal
  function particleReveal(comp, full, target, token){
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const dx = Math.floor((target.w - comp.drawW) / 2);
    const dy = Math.floor((target.h - comp.drawH) / 2);
    const dxFull = Math.floor((target.w - full.drawW) / 2);
    const dyFull = Math.floor((target.h - full.drawH) / 2);
    const cell = PARTICLE.cell;
    const cols = Math.ceil(comp.drawW / cell);
    const rows = Math.ceil(comp.drawH / cell);
    const total = cols * rows;

    // Create and shuffle indices
    const idx = new Uint32Array(total);
    for (let i = 0; i < total; i++) idx[i] = i;
    for (let i = total - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }

    let p = 0;
    function step(){
      if (token !== scanToken) return;
      const start = performance.now();
      let processed = 0;
      while (p < total && performance.now() - start < 14 && processed < PARTICLE.perFrame){
        const id = idx[p++];
        const cx = id % cols;
        const cy = (id - cx) / cols;
        const sx = cx * cell;
        const sy = cy * cell;
        const w = Math.min(cell, comp.drawW - sx);
        const h = Math.min(cell, comp.drawH - sy);
        // draw the tile from composed image
        ctx.drawImage(comp.comp, sx, sy, w, h, dx + sx, dy + sy, w, h);
        // particle glow
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = PARTICLE.glowAlpha;
        ctx.fillStyle = fg;
        const r = Math.max(2, Math.min(10, Math.floor(cell * 0.9)));
        ctx.beginPath();
        ctx.arc(dx + sx + w * 0.5, dy + sy + h * 0.5, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        processed++;
      }
      if (p < total){
        requestAnimationFrame(step);
      } else {
        // Crossfade to full-resolution composed image
        updateStatus('Enhancing details...');
        const start = performance.now();
        (function fade(){
          if (token !== scanToken) return;
          const t = Math.min(1, (performance.now() - start) / 450);
          ctx.globalAlpha = t;
          ctx.drawImage(full.comp, dxFull, dyFull);
          ctx.globalAlpha = 1;
          if (t < 1){
            requestAnimationFrame(fade);
          } else {
            updateStatus('Scan complete! Press R to restart.');
          }
        })();
      }
    }
    requestAnimationFrame(step);
  }

  // Build scanline overlay once per size
  function createScanlineOverlay(w, h){
    const lay = document.createElement('canvas');
    lay.width = w;
    lay.height = h;
    const lx = lay.getContext('2d');
    lx.fillStyle = 'rgba(0,0,0,' + CRT.scanlineAlpha + ')';
    for (let y = 0; y < h; y += 2){
      lx.fillRect(0, y, w, 1);
    }
    // subtle vignette
    const g = lx.createRadialGradient(w*0.5, h*0.5, Math.min(w,h)*0.35, w*0.5, h*0.5, Math.max(w,h)*0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    lx.fillStyle = g;
    lx.fillRect(0,0,w,h);
    return lay;
  }

  // Old TV style horizontal beam reveal with glow, scanlines, noise and jitter
  function crtReveal(full, target, token){
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const dx = Math.floor((target.w - full.drawW) / 2);
    const dy = Math.floor((target.h - full.drawH) / 2);
    const overlay = createScanlineOverlay(full.drawW, full.drawH);
    let beam = 0;
    function step(){
      if (token !== scanToken) return;
      const t = performance.now();
      const jitter = Math.sin(t / 90) * 1.2;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // draw revealed portion with slight jitter
      if (beam > 0){
        ctx.drawImage(full.comp, 0, 0, full.drawW, beam, dx + jitter, dy, full.drawW, beam);
      }
      // beam glow
      ctx.globalCompositeOperation = 'screen';
      const gh = CRT.glowHeight;
      const grad = ctx.createLinearGradient(0, dy + beam - gh*0.5, 0, dy + beam + gh*0.5);
      grad.addColorStop(0, 'rgba(57,255,20,0)');
      grad.addColorStop(0.5, 'rgba(57,255,20,0.6)');
      grad.addColorStop(1, 'rgba(57,255,20,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(dx, dy + beam - gh*0.5, full.drawW, gh);
      // noise sparkles near the beam
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = fg;
      for (let i = 0; i < CRT.noiseCount; i++){
        const nx = dx + Math.random() * full.drawW;
        const ny = dy + (beam - gh*0.5) + Math.random() * gh;
        ctx.fillRect(nx, ny, 1, 1);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      // scanlines + vignette
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(overlay, dx, dy);
      ctx.globalCompositeOperation = 'source-over';

      beam += CRT.beamSpeed;
      if (beam < full.drawH){
        requestAnimationFrame(step);
      } else {
        updateStatus('Scan complete! Press R to restart.');
      }
    }
    requestAnimationFrame(step);
  }

  function scanDraw(pix, target, token){
    // Clear canvas with background color
    ctx.fillStyle = bg; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Calculate pixel size to fit the image centered on canvas
    const cellX = Math.max(2, Math.floor(target.w / pix.w));
    const cellY = Math.max(2, Math.floor(target.h / pix.h));
    const dx = Math.floor((target.w - pix.w * cellX) / 2);
    const dy = Math.floor((target.h - pix.h * cellY) / 2);
    
    let row = 0;
    console.log(`Starting scan animation: ${pix.w}x${pix.h} pixels, cell size: ${cellX}x${cellY}`);
    
    function step(){
      if (token !== scanToken) {
        console.log('Animation cancelled due to new token');
        return;
      }
      
      const start = performance.now();
      let rowsProcessed = 0;
      
      // Process multiple rows per frame for smooth animation, but limit time
      while (row < pix.h && performance.now() - start < 8 && rowsProcessed < 3){
        ctx.fillStyle = fg;
        
        // Draw pixels for this row
        for (let x = 0; x < pix.w; x++){
          if (pix.mask[row * pix.w + x]){
            ctx.fillRect(dx + x * cellX, dy + row * cellY, cellX, cellY);
          }
        }
        
        // Draw scanline effect
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = fg;
        ctx.fillRect(dx, dy + row * cellY, pix.w * cellX, 2);
        ctx.globalAlpha = 1.0;
        
        row++;
        rowsProcessed++;
      }
      
      // Continue animation if more rows to process
      if (row < pix.h) {
        requestAnimationFrame(step);
      } else {
        console.log('Scan animation complete');
        updateStatus('Scan complete! Press R to restart.');
      }
    }
    
    // Start the animation
    requestAnimationFrame(step);
  }

  // Draw the entire pixelized image at once (no scan animation)
  function drawStatic(pix, target){
    // Clear canvas with background color
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate pixel size to fit the image centered on canvas
    const cellX = Math.max(2, Math.floor(target.w / pix.w));
    const cellY = Math.max(2, Math.floor(target.h / pix.h));
    const dx = Math.floor((target.w - pix.w * cellX) / 2);
    const dy = Math.floor((target.h - pix.h * cellY) / 2);

    ctx.fillStyle = fg;
    for (let y = 0; y < pix.h; y++){
      for (let x = 0; x < pix.w; x++){
        if (pix.mask[y * pix.w + x]){
          ctx.fillRect(dx + x * cellX, dy + y * cellY, cellX, cellY);
        }
      }
    }
  }

  let lastUrl = null;
  let lastW = 0, lastH = 0;
  let scanToken = 0;
  
  function render(){
    console.log('Render called');
    const target = ensureCanvasSize();
    // Resolve the image URL against the current document to avoid relative path issues
    const url = new URL(SRC, document.baseURI).href;
    
    if (!url) {
      console.error('No image URL provided');
      return;
    }
    
    // Check if we need to re-render
    const sizeChanged = (target.w !== lastW || target.h !== lastH);
    if (!sizeChanged && url === lastUrl) {
      console.log('No changes detected, skipping render');
      return;
    }
    
    // Cancel any previous animation
    const token = ++scanToken;
    console.log(`Loading image: ${url}, token: ${token}`);
    
    const img = new Image();
    // Avoid setting crossOrigin explicitly; it can trigger errors for file:// or strict hosts
    // img.crossOrigin = 'anonymous';
    
    img.onload = () => { 
      if (token !== scanToken) {
        console.log('Image load cancelled due to new token');
        return;
      }
      console.log(`Image loaded: ${img.width}x${img.height}`);
      updateStatus('Converting to pixels...');
      const pixelated = pixelateImage(img, target.w, target.h);
      updateStatus('Preparing scan...');
      const fullComposed = composeTintedFull(img, target);
      updateStatus('Initializing scan...');
      const tokenForThis = token; // keep local
      crtReveal(fullComposed, target, tokenForThis);
      lastW = target.w; 
      lastH = target.h; 
      lastUrl = url;
    };
    
    img.onerror = (e) => { 
      console.error('Image failed to load:', e);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Draw error message
      ctx.fillStyle = fg;
      ctx.font = '16px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Image failed to load', target.w / 2, target.h / 2);
    };
    
    img.src = url;
  }

  // Status updates
  const statusEl = document.getElementById('status');
  function updateStatus(message) {
    if (statusEl){
      statusEl.textContent = message;
      // Use theme primary color for key states, dim for others
      if (message === 'Scan complete! Press R to restart.' || message === 'Initializing scan...'){
        statusEl.style.color = fg;
      } else {
        statusEl.style.color = fgDim;
      }
    }
    console.log('Status:', message);
  }

  // Restart button
  const restartBtn = document.getElementById('restartBtn');
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      updateStatus('Restarting render...');
      lastUrl = null; // Force re-render
      render();
    });
  }

  // back navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' || e.key.toLowerCase() === 'b' || e.key === 'Escape') {
      window.location.href = '../../misc.html';
    } else if (e.key === 'r' || e.key === 'R') {
      // R key to restart
      if (restartBtn) restartBtn.click();
    }
  });

  // Initial render with proper timing
  function init(){
    console.log('Initializing gallery...');
    // Give the page a moment to layout before rendering
    setTimeout(() => {
      render();
    }, 100);
  }

  // Initialize when DOM is ready and when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  window.addEventListener('load', init);
})();


