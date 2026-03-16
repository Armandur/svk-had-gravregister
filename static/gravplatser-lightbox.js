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
/** Zoomnivå i lightbox för skisser (1 = 100%). */
let lightboxZoom = 1;
const LIGHTBOX_ZOOM_MIN = 0.5;
const LIGHTBOX_ZOOM_MAX = 4;
const LIGHTBOX_ZOOM_STEG = 1.25;

function uppdateraLightboxKnappar() {
  const prevBtn = document.getElementById('gp-lightbox-prev');
  const nextBtn = document.getElementById('gp-lightbox-next');
  const n = lightboxMode === 'halvor' ? lightboxHalvorUrls.length
    : lightboxMode === 'skisser' ? lightboxSkisserList.length
    : currentExtramaterial.length;
  if (prevBtn) prevBtn.disabled = n <= 1;
  if (nextBtn) nextBtn.disabled = n <= 1;
}

function openLightbox(index) {
  if (currentExtramaterial.length === 0 || !currentExtramaterialMapp) return;
  lightboxMode = 'extramaterial';
  const idx = Math.max(0, Math.min(index, currentExtramaterial.length - 1));
  lightboxIndex = idx;
  lightboxZoom = 1;
  const em = currentExtramaterial[idx];
  const bildUrl = `${API}/mappar/${encodeURIComponent(currentExtramaterialMapp)}/fil/${encodeURIComponent(em.filnamn)}/bild?_v=${cacheBust}`;
  const lightbox = document.getElementById('gp-lightbox');
  const imgEl = document.getElementById('gp-lightbox-img');
  if (lightbox && imgEl) {
    imgEl.src = bildUrl;
    imgEl.alt = em.filnamn;
    imgEl.style.transform = '';
    imgEl.onload = () => lightboxZoomApplicera();
    const z = document.getElementById('gp-lightbox-zoom');
    if (z) z.hidden = false;
    const wrap = document.getElementById('gp-lightbox-img-wrap');
    if (wrap) { wrap.scrollTop = 0; wrap.scrollLeft = 0; }
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
    const useHela = visarHelaSidor && fig.dataset.kanHela === 'true';
    return useHela ? (fig.dataset.helaUrl || '') : (fig.dataset.halvaUrl || '');
  }).filter(Boolean);
  if (lightboxHalvorUrls.length === 0) return;
  lightboxMode = 'halvor';
  lightboxIndex = Math.max(0, Math.min(index, lightboxHalvorUrls.length - 1));
  lightboxZoom = 1;
  const lightbox = document.getElementById('gp-lightbox');
  const imgEl = document.getElementById('gp-lightbox-img');
  if (lightbox && imgEl) {
    imgEl.src = lightboxHalvorUrls[lightboxIndex];
    imgEl.alt = '';
    imgEl.style.transform = '';
    imgEl.onload = () => lightboxZoomApplicera();
    const z = document.getElementById('gp-lightbox-zoom');
    if (z) z.hidden = false;
    const wrap = document.getElementById('gp-lightbox-img-wrap');
    if (wrap) { wrap.scrollTop = 0; wrap.scrollLeft = 0; }
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
  lightboxZoom = 1;
  const lightbox = document.getElementById('gp-lightbox');
  const imgEl = document.getElementById('gp-lightbox-img');
  const zoomPanel = document.getElementById('gp-lightbox-zoom');
  if (!lightbox || !imgEl) return;
  imgEl.onload = () => lightboxZoomApplicera();
  imgEl.alt = 'Skiss';
  if (zoomPanel) zoomPanel.hidden = false;
  const wrap = document.getElementById('gp-lightbox-img-wrap');
  if (wrap) { wrap.scrollTop = 0; wrap.scrollLeft = 0; }
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

function lightboxZoomApplicera() {
  const imgEl = document.getElementById('gp-lightbox-img');
  const innerEl = document.getElementById('gp-lightbox-img-inner');
  const nivaEl = document.getElementById('gp-lightbox-zoom-niva');
  const wrapEl = document.getElementById('gp-lightbox-img-wrap');
  const harBild = innerEl && imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0;
  const kanZoomaHalvorSkiss = (lightboxMode === 'skisser' || lightboxMode === 'halvor') && harBild;
  const kanZoomaExtramaterial = lightboxMode === 'extramaterial' && harBild;

  if (kanZoomaHalvorSkiss) {
    const w = Math.round(imgEl.naturalWidth * lightboxZoom);
    const h = Math.round(imgEl.naturalHeight * lightboxZoom);
    innerEl.style.width = w + 'px';
    innerEl.style.height = h + 'px';
    innerEl.classList.add('gp-lightbox-zoomed');
    imgEl.style.transform = '';
  } else if (kanZoomaExtramaterial) {
    /* Extramaterial: alltid explicit storlek (inkl. zoom ut < 100 %) så bilden kan skalas ned och få plats */
    const w = Math.round(imgEl.naturalWidth * lightboxZoom);
    const h = Math.round(imgEl.naturalHeight * lightboxZoom);
    innerEl.style.width = w + 'px';
    innerEl.style.height = h + 'px';
    innerEl.classList.add('gp-lightbox-zoomed');
    imgEl.style.transform = '';
  } else {
    if (innerEl) {
      innerEl.style.width = '';
      innerEl.style.height = '';
      innerEl.classList.remove('gp-lightbox-zoomed');
    }
    if (imgEl) imgEl.style.transform = '';
  }
  if (nivaEl) nivaEl.textContent = Math.round(lightboxZoom * 100) + '%';
  if (wrapEl) { wrapEl.scrollTop = 0; wrapEl.scrollLeft = 0; }
}

function lightboxZoomIn() {
  if (lightboxMode !== 'skisser' && lightboxMode !== 'halvor' && lightboxMode !== 'extramaterial') return;
  lightboxZoom = Math.min(LIGHTBOX_ZOOM_MAX, lightboxZoom * LIGHTBOX_ZOOM_STEG);
  lightboxZoomApplicera();
}

function lightboxZoomOut() {
  if (lightboxMode !== 'skisser' && lightboxMode !== 'halvor' && lightboxMode !== 'extramaterial') return;
  lightboxZoom = Math.max(LIGHTBOX_ZOOM_MIN, lightboxZoom / LIGHTBOX_ZOOM_STEG);
  lightboxZoomApplicera();
}

function closeLightbox() {
  const lightbox = document.getElementById('gp-lightbox');
  const zoomPanel = document.getElementById('gp-lightbox-zoom');
  if (lightbox) lightbox.hidden = true;
  if (zoomPanel) zoomPanel.hidden = true;
  lightboxZoom = 1;
  lightboxZoomApplicera();
}

function lightboxPrev() {
  const n = lightboxMode === 'halvor' ? lightboxHalvorUrls.length
    : lightboxMode === 'skisser' ? lightboxSkisserList.length
    : currentExtramaterial.length;
  if (n <= 1) return;
  lightboxIndex = (lightboxIndex - 1 + n) % n;
  const imgEl = document.getElementById('gp-lightbox-img');
  if (!imgEl) return;
  if (lightboxMode === 'halvor') {
    imgEl.src = lightboxHalvorUrls[lightboxIndex];
    imgEl.onload = () => lightboxZoomApplicera();
  } else if (lightboxMode === 'skisser') {
    const s = lightboxSkisserList[lightboxIndex];
    lightboxZoom = 1;
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
    : currentExtramaterial.length;
  if (n <= 1) return;
  lightboxIndex = (lightboxIndex + 1) % n;
  const imgEl = document.getElementById('gp-lightbox-img');
  if (!imgEl) return;
  if (lightboxMode === 'halvor') {
    imgEl.src = lightboxHalvorUrls[lightboxIndex];
    imgEl.onload = () => lightboxZoomApplicera();
  } else if (lightboxMode === 'skisser') {
    const s = lightboxSkisserList[lightboxIndex];
    lightboxZoom = 1;
    loadSkissFullRes(s).then(
      (dataUrl) => { imgEl.src = dataUrl; lightboxZoomApplicera(); },
      () => { imgEl.src = ''; }
    );
  } else {
    openLightbox(lightboxIndex);
  }
  uppdateraLightboxKnappar();
}
