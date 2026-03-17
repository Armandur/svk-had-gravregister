/**
 * Gravregister – Lightbox-funktioner.
 * Extraherat från gravplatser.js. Laddas före gravplatser.js.
 */

let lightboxIndex = 0;
/** 'extramaterial' | 'halvor' | 'skisser' – vilken källa lightboxen visar. */
let lightboxMode = 'extramaterial';
/** Vid mode 'halvor': URL:er för aktuell gravplatsens bilder. */
let lightboxHalvorUrls = [];
/** Vid mode 'skisser': lista med skiss-objekt (för att ladda fullupplöst crop). */
let lightboxSkisserList = [];
/** Zoomnivå i lightbox (1 = 100% naturlig storlek). 0 = auto-fit vid nästa render. */
let lightboxZoom = 0;
const LIGHTBOX_ZOOM_MIN = 0.1;
const LIGHTBOX_ZOOM_MAX = 8;
const LIGHTBOX_ZOOM_STEG = 1.25;

function uppdateraLightboxKnappar() {
  const prevBtn = document.getElementById('gp-lightbox-prev');
  const nextBtn = document.getElementById('gp-lightbox-next');
  const n = lightboxMode === 'halvor' ? lightboxHalvorUrls.length
    : lightboxMode === 'skisser' ? lightboxSkisserList.length
    : state.currentExtramaterial.length;
  if (prevBtn) prevBtn.disabled = n <= 1;
  if (nextBtn) nextBtn.disabled = n <= 1;
}

function _lightboxResetInner() {
  const inner = document.getElementById('gp-lightbox-img-inner');
  if (inner) { inner.style.width = ''; inner.style.height = ''; inner.classList.remove('gp-lightbox-zoomed'); }
}

function openLightbox(index) {
  if (state.currentExtramaterial.length === 0 || !state.currentExtramaterialMapp) return;
  lightboxMode = 'extramaterial';
  const idx = Math.max(0, Math.min(index, state.currentExtramaterial.length - 1));
  lightboxIndex = idx;
  lightboxZoom = 0;
  const em = state.currentExtramaterial[idx];
  const bildUrl = `${API}/mappar/${encodeURIComponent(state.currentExtramaterialMapp)}/fil/${encodeURIComponent(em.filnamn)}/bild?_v=${state.cacheBust}`;
  const lightbox = document.getElementById('gp-lightbox');
  const imgEl = document.getElementById('gp-lightbox-img');
  if (lightbox && imgEl) {
    _lightboxResetInner();
    imgEl.src = bildUrl;
    imgEl.alt = em.filnamn;
    imgEl.style.transform = '';
    imgEl.onload = () => lightboxZoomApplicera();
    const z = document.getElementById('gp-lightbox-zoom');
    if (z) z.hidden = false;
    lightbox.hidden = false;
    uppdateraLightboxKnappar();
  }
}

function openLightboxHalvor(index) {
  const halvorEl = document.getElementById('gp-halvor');
  const figures = halvorEl ? halvorEl.querySelectorAll('.gravplatser-halva') : [];
  if (figures.length === 0) return;
  /* Bygg URL-lista utifrån aktuellt visningsläge (halva vs hela sida). */
  lightboxHalvorUrls = Array.from(figures).map((fig) => {
    const useHela = state.visarHelaSidor && fig.dataset.kanHela === 'true';
    return useHela ? (fig.dataset.helaUrl || '') : (fig.dataset.halvaUrl || '');
  }).filter(Boolean);
  if (lightboxHalvorUrls.length === 0) return;
  lightboxMode = 'halvor';
  lightboxIndex = Math.max(0, Math.min(index, lightboxHalvorUrls.length - 1));
  lightboxZoom = 0;
  const lightbox = document.getElementById('gp-lightbox');
  const imgEl = document.getElementById('gp-lightbox-img');
  if (lightbox && imgEl) {
    _lightboxResetInner();
    imgEl.src = lightboxHalvorUrls[lightboxIndex];
    imgEl.alt = '';
    imgEl.style.transform = '';
    imgEl.onload = () => lightboxZoomApplicera();
    const z = document.getElementById('gp-lightbox-zoom');
    if (z) z.hidden = false;
    lightbox.hidden = false;
    uppdateraLightboxKnappar();
  }
}

/** Laddar källbilden för en skiss och returnerar en Promise med data-URL för fullupplöst crop. */
function loadSkissFullRes(s) {
  return new Promise((resolve, reject) => {
    if (!s) {
      reject(new Error('Ingen skiss'));
      return;
    }
    const url = getSkissKallaUrl(s);
    if (!url) {
      reject(new Error('Kunde inte hitta källbild'));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const x = (s.x ?? 0) * w;
      const y = (s.y ?? 0) * h;
      const sw = Math.max(1, (s.width ?? 0) * w);
      const sh = Math.max(1, (s.height ?? 0) * h);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(sw);
      canvas.height = Math.round(sh);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas stöd saknas'));
        return;
      }
      ctx.drawImage(img, x, y, sw, sh, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Kunde inte ladda källbild'));
    img.src = url;
  });
}

function openLightboxSkisser(skisserArray, index) {
  if (!skisserArray || skisserArray.length === 0) return;
  lightboxSkisserList = skisserArray;
  lightboxMode = 'skisser';
  lightboxIndex = Math.max(0, Math.min(index, skisserArray.length - 1));
  lightboxZoom = 0;
  const lightbox = document.getElementById('gp-lightbox');
  const imgEl = document.getElementById('gp-lightbox-img');
  const zoomPanel = document.getElementById('gp-lightbox-zoom');
  if (!lightbox || !imgEl) return;
  _lightboxResetInner();
  imgEl.onload = () => lightboxZoomApplicera();
  imgEl.alt = 'Skiss';
  if (zoomPanel) zoomPanel.hidden = false;
  lightbox.hidden = false;
  uppdateraLightboxKnappar();
  const loadingIndex = lightboxIndex;
  const s = lightboxSkisserList[loadingIndex];
  loadSkissFullRes(s).then(
    (dataUrl) => {
      if (lightboxMode !== 'skisser' || lightboxIndex !== loadingIndex) return;
      imgEl.src = dataUrl;
      lightboxZoomApplicera();
    },
    () => {
      imgEl.src = '';
      imgEl.alt = 'Kunde inte ladda skiss';
    }
  );
}

/**
 * Applicerar aktuell zoomnivå och hanterar scroll-position.
 * opts: { focalX, focalY, viewportX, viewportY }
 *   focalX/Y: position i scroll-koordinater före zoom (fokuspunkt)
 *   viewportX/Y: position i wrap-viewport där fokuspunkten ska stanna
 */
function lightboxZoomApplicera(opts) {
  const imgEl = document.getElementById('gp-lightbox-img');
  const innerEl = document.getElementById('gp-lightbox-img-inner');
  const nivaEl = document.getElementById('gp-lightbox-zoom-niva');
  const wrapEl = document.getElementById('gp-lightbox-img-wrap');
  if (!imgEl || !innerEl || !wrapEl) return;
  const natW = imgEl.naturalWidth;
  const natH = imgEl.naturalHeight;
  if (!natW || !natH) return;

  /* Auto-fit: beräkna zoom så bilden fyller tillgängligt utrymme */
  if (lightboxZoom <= 0) {
    const cw = wrapEl.clientWidth || 1;
    const ch = wrapEl.clientHeight || 1;
    lightboxZoom = Math.min(cw / natW, ch / natH);
  }
  lightboxZoom = Math.max(LIGHTBOX_ZOOM_MIN, Math.min(LIGHTBOX_ZOOM_MAX, lightboxZoom));

  const newW = Math.round(natW * lightboxZoom);
  const newH = Math.round(natH * lightboxZoom);
  const oldW = innerEl.offsetWidth || 0;
  const oldH = innerEl.offsetHeight || 0;

  let newScrollLeft, newScrollTop;
  if (opts && opts.focalX !== undefined && oldW > 0) {
    /* Zoom mot specifik punkt (t.ex. muspekarens position) */
    newScrollLeft = opts.focalX * (newW / oldW) - opts.viewportX;
    newScrollTop  = opts.focalY * (newH / oldH) - opts.viewportY;
  } else if (oldW > 0) {
    /* Håll mitten av viewport fix */
    const cx = wrapEl.scrollLeft + wrapEl.clientWidth  / 2;
    const cy = wrapEl.scrollTop  + wrapEl.clientHeight / 2;
    newScrollLeft = cx * (newW / oldW) - wrapEl.clientWidth  / 2;
    newScrollTop  = cy * (newH / oldH) - wrapEl.clientHeight / 2;
  } else {
    /* Initialt: centrera bilden */
    newScrollLeft = (newW - wrapEl.clientWidth)  / 2;
    newScrollTop  = (newH - wrapEl.clientHeight) / 2;
  }

  innerEl.style.width  = newW + 'px';
  innerEl.style.height = newH + 'px';
  innerEl.classList.add('gp-lightbox-zoomed');
  imgEl.style.transform = '';
  if (nivaEl) nivaEl.textContent = Math.round(lightboxZoom * 100) + '%';
  wrapEl.scrollLeft = Math.max(0, newScrollLeft);
  wrapEl.scrollTop  = Math.max(0, newScrollTop);
}

function lightboxZoomIn() {
  lightboxZoom = Math.min(LIGHTBOX_ZOOM_MAX, lightboxZoom * LIGHTBOX_ZOOM_STEG);
  lightboxZoomApplicera();
}

function lightboxZoomOut() {
  lightboxZoom = Math.max(LIGHTBOX_ZOOM_MIN, lightboxZoom / LIGHTBOX_ZOOM_STEG);
  lightboxZoomApplicera();
}

function closeLightbox() {
  const lightbox = document.getElementById('gp-lightbox');
  const zoomPanel = document.getElementById('gp-lightbox-zoom');
  if (lightbox) lightbox.hidden = true;
  if (zoomPanel) zoomPanel.hidden = true;
  lightboxZoom = 0;
}

function lightboxPrev() {
  const n = lightboxMode === 'halvor' ? lightboxHalvorUrls.length
    : lightboxMode === 'skisser' ? lightboxSkisserList.length
    : state.currentExtramaterial.length;
  if (n <= 1) return;
  lightboxIndex = (lightboxIndex - 1 + n) % n;
  const imgEl = document.getElementById('gp-lightbox-img');
  if (!imgEl) return;
  if (lightboxMode === 'halvor') {
    lightboxZoom = 0;
    _lightboxResetInner();
    imgEl.src = lightboxHalvorUrls[lightboxIndex];
    imgEl.onload = () => lightboxZoomApplicera();
  } else if (lightboxMode === 'skisser') {
    lightboxZoom = 0;
    _lightboxResetInner();
    const s = lightboxSkisserList[lightboxIndex];
    loadSkissFullRes(s).then(
      (dataUrl) => { imgEl.src = dataUrl; lightboxZoomApplicera(); },
      () => { imgEl.src = ''; }
    );
  } else {
    openLightbox(lightboxIndex);
  }
  uppdateraLightboxKnappar();
}

function lightboxNext() {
  const n = lightboxMode === 'halvor' ? lightboxHalvorUrls.length
    : lightboxMode === 'skisser' ? lightboxSkisserList.length
    : state.currentExtramaterial.length;
  if (n <= 1) return;
  lightboxIndex = (lightboxIndex + 1) % n;
  const imgEl = document.getElementById('gp-lightbox-img');
  if (!imgEl) return;
  if (lightboxMode === 'halvor') {
    lightboxZoom = 0;
    _lightboxResetInner();
    imgEl.src = lightboxHalvorUrls[lightboxIndex];
    imgEl.onload = () => lightboxZoomApplicera();
  } else if (lightboxMode === 'skisser') {
    lightboxZoom = 0;
    _lightboxResetInner();
    const s = lightboxSkisserList[lightboxIndex];
    loadSkissFullRes(s).then(
      (dataUrl) => { imgEl.src = dataUrl; lightboxZoomApplicera(); },
      () => { imgEl.src = ''; }
    );
  } else {
    openLightbox(lightboxIndex);
  }
  uppdateraLightboxKnappar();
}

/* ── Fönsterresize: räkna om zoom när lightboxen är öppen ────────────────── */
(function () {
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    const lb = document.getElementById('gp-lightbox');
    if (!lb || lb.hidden) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      /* Spara relativ scroll-position (0–1) för att återställa efter zoom */
      const wrap = document.getElementById('gp-lightbox-img-wrap');
      const inner = document.getElementById('gp-lightbox-img-inner');
      if (!wrap || !inner) return;
      const relX = inner.offsetWidth  > wrap.clientWidth  ? (wrap.scrollLeft + wrap.clientWidth  / 2) / inner.offsetWidth  : 0.5;
      const relY = inner.offsetHeight > wrap.clientHeight ? (wrap.scrollTop  + wrap.clientHeight / 2) / inner.offsetHeight : 0.5;
      /* Sätt zoom = 0 för att trigga auto-fit med nytt fönstermått */
      lightboxZoom = 0;
      lightboxZoomApplicera();
      /* Återställ relativ position efter auto-fit */
      const newW = inner.offsetWidth;
      const newH = inner.offsetHeight;
      wrap.scrollLeft = Math.max(0, relX * newW - wrap.clientWidth  / 2);
      wrap.scrollTop  = Math.max(0, relY * newH - wrap.clientHeight / 2);
    }, 100);
  });
})();

/* ── Drag-to-pan + scroll-wheel-zoom ─────────────────────────────────────── */
(function () {
  const wrap = document.getElementById('gp-lightbox-img-wrap');
  if (!wrap) return;

  /* Dra med mus */
  let dragging = false, dragX = 0, dragY = 0, dragSL = 0, dragST = 0;

  wrap.addEventListener('mousedown', (e) => {
    const lb = document.getElementById('gp-lightbox');
    if (!lb || lb.hidden) return;
    if (e.button !== 0) return;
    if (e.target.closest('button')) return;
    dragging = true;
    dragX = e.clientX; dragY = e.clientY;
    dragSL = wrap.scrollLeft; dragST = wrap.scrollTop;
    wrap.style.cursor = 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    wrap.scrollLeft = dragSL - (e.clientX - dragX);
    wrap.scrollTop  = dragST - (e.clientY - dragY);
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    wrap.style.cursor = '';
  });

  /* Dra med touch */
  let touchX = 0, touchY = 0, touchSL = 0, touchST = 0;

  wrap.addEventListener('touchstart', (e) => {
    const lb = document.getElementById('gp-lightbox');
    if (!lb || lb.hidden) return;
    if (e.touches.length === 1) {
      touchX = e.touches[0].clientX; touchY = e.touches[0].clientY;
      touchSL = wrap.scrollLeft; touchST = wrap.scrollTop;
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', (e) => {
    const lb = document.getElementById('gp-lightbox');
    if (!lb || lb.hidden) return;
    if (e.touches.length === 1) {
      wrap.scrollLeft = touchSL - (e.touches[0].clientX - touchX);
      wrap.scrollTop  = touchST - (e.touches[0].clientY - touchY);
      e.preventDefault();
    }
  }, { passive: false });

  /* Zoom med scroll-hjul mot muspekaren */
  wrap.addEventListener('wheel', (e) => {
    const lb = document.getElementById('gp-lightbox');
    if (!lb || lb.hidden) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? LIGHTBOX_ZOOM_STEG : 1 / LIGHTBOX_ZOOM_STEG;
    const newZoom = Math.max(LIGHTBOX_ZOOM_MIN, Math.min(LIGHTBOX_ZOOM_MAX, lightboxZoom * factor));
    if (newZoom === lightboxZoom) return;
    lightboxZoom = newZoom;
    const rect = wrap.getBoundingClientRect();
    const viewportX = e.clientX - rect.left;
    const viewportY = e.clientY - rect.top;
    lightboxZoomApplicera({
      focalX: wrap.scrollLeft + viewportX,
      focalY: wrap.scrollTop  + viewportY,
      viewportX,
      viewportY,
    });
  }, { passive: false });
})();
