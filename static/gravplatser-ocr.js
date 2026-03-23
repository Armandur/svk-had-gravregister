/**
 * Gravregister – OCR-funktioner (textextrahering från bilder).
 * Extraherat från gravplatser.js. Laddas före gravplatser.js.
 */

/** Input/textarea som ska få extraherad text (Alternativ B: sätts vid fokus). */
let ocrTargetElement = null;
/** true = användaren klickade "Markera område" och ska nu klicka på en bild. */
let ocrVantarPaBild = false;
/** true direkt efter att en OCR-markering avslutats – används för att inte öppna lightbox av efterföljande klick. */
let ocrJustAvslutad = false;
/** Ikonknapp för "Markera område" som visas bredvid fokuserat fält (skapas vid behov). */
let ocrFaltIkonBtn = null;
/** 'ef' | 'fe' när användaren valt EF/FE och väntar på bildmarkering; null annars. 'f' = namn som ogift (f. född), samma flöde. */
let ocrNamnLage = null;
/** true när användaren valt Adress och väntar på bildmarkering. */
let ocrAdressLage = false;
/** När ocrNamnLage === 'f': efternamnsfältet där " f. " + extraherad text ska läggas till. */
let ocrFoddenamnFalt = null;
/** I namn-split-modal: valt delningsindex (0..n) eller null om användaren inte klickat. */
let ocrNamnSplitIndex = null;
/** 'ef' | 'fe' när modalen visar namn-split; null annars. */
let ocrModalNamnLage = null;
/** Targetfält för aktuell OCR-modal (namn- eller adress-split). */
let ocrModalTargetElement = null;
/** true när modalen visar adress-split (dela gatuadress | postnummer+postort). */
let ocrModalAdressLage = false;
/** true om fokus sattes via mus/pekare (klick); false vid tabb – ikonen visas bara vid pekare. */
let focusViaPointer = false;

/** Returnerar true om fältet är ett namnfält (förnamn/efternamn) där EF/FE-knapparna ska visas. */
function arNamnFaltForOcr(element) {
  const name = element && element.getAttribute('name');
  if (!name) return false;
  if (isBeteckningFalt(element)) return false;
  return name === 'inv_fornamn' || name === 'inv_efternamn' ||
    name === 'na_fornamn' || name === 'na_efternamn' ||
    (name.startsWith('gs_fornamn_') && /^gs_fornamn_\d+$/.test(name)) ||
    (name.startsWith('gs_efternamn_') && /^gs_efternamn_\d+$/.test(name));
}

/** True om fältet är Beteckning (efternamn när "Gravsatt använd som beteckning" är ikryssat) – då ska inte FE/EF visas. */
function isBeteckningFalt(element) {
  const block = element && element.closest('.gp-gravsatt-block');
  if (!block) return false;
  const idx = block.dataset.gsIndex;
  if (idx === undefined) return false;
  const name = element.getAttribute('name');
  if (name !== 'gs_efternamn_' + idx) return false;
  const cb = block.querySelector(`[name="gs_ar_beteckning_${idx}"]`);
  return cb ? cb.checked : false;
}

/** Returnerar { fornamn, efternamn } – DOM-elementen för förnamn och efternamn i samma rad som element. */
function getNamnParFalt(element) {
  if (!element) return null;
  const row = element.closest('.gp-innehavare-rad, .gp-na-rad, .gp-gravsatt-block');
  if (!row) return null;
  const fornamn = row.querySelector('[name="inv_fornamn"], [name="na_fornamn"], [name^="gs_fornamn_"]');
  const efternamn = row.querySelector('[name="inv_efternamn"], [name="na_efternamn"], [name^="gs_efternamn_"]');
  if (!fornamn || !efternamn) return null;
  return { fornamn, efternamn };
}

/** Returnerar true om fältet är ett adressfält (Gatuadress, Postnummer eller Postort) där Adress-OCR-knappen ska visas. */
function arAdressFaltForOcr(element) {
  const name = element && element.getAttribute('name');
  if (!name) return false;
  return name === 'inv_gatuadress' || name === 'inv_postnummer' || name === 'inv_postort' ||
    name === 'na_gatuadress' || name === 'na_postnummer' || name === 'na_postort' ||
    (name.startsWith('gs_gatuadress_') && /^gs_gatuadress_\d+$/.test(name)) ||
    (name.startsWith('gs_postnummer_') && /^gs_postnummer_\d+$/.test(name)) ||
    (name.startsWith('gs_postort_') && /^gs_postort_\d+$/.test(name));
}

/** Returnerar { gatuadress, postnummer, postort } – DOM-elementen för de tre adressfälten i samma rad som element. */
function getAdressTrioFalt(element) {
  if (!element) return null;
  const row = element.closest('.gp-innehavare-rad, .gp-na-rad, .gp-gravsatt-block');
  if (!row) return null;
  const gatuadress = row.querySelector('[name="inv_gatuadress"], [name="na_gatuadress"], [name^="gs_gatuadress_"]');
  const postnummer = row.querySelector('[name="inv_postnummer"], [name="na_postnummer"], [name^="gs_postnummer_"]');
  const postort = row.querySelector('[name="inv_postort"], [name="na_postort"], [name^="gs_postort_"]');
  if (!gatuadress || !postnummer || !postort) return null;
  return { gatuadress, postnummer, postort };
}

function applyInmatningSectionsOrder(order) {
  const root = document.getElementById('gp-inmatning');
  if (!root) return;
  const allowed = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
  const unique = [];
  (order || []).forEach((s) => {
    if (allowed.indexOf(s) !== -1 && unique.indexOf(s) === -1) unique.push(s);
  });
  allowed.forEach((s) => {
    if (unique.indexOf(s) === -1) unique.push(s);
  });
  state.inmatningSectionsOrder = unique;
  const sectionsById = {};
  allowed.forEach((s) => {
    const btn = root.querySelector('.gp-sektion-rubrik[data-sektion="' + s + '"]');
    if (btn) {
      const sektionEl = btn.closest('.gp-inmatning-sektion');
      if (sektionEl) sectionsById[s] = sektionEl;
    }
  });
  unique.forEach((s) => {
    const el = sectionsById[s];
    if (el && el.parentNode === root) {
      root.appendChild(el);
    }
  });
}

/**
 * Parsar text efter gatuadress till postnummer (NNN NN) och postort.
 * NNNNN normaliseras till NNN NN; resten tolkas som postort.
 */
function parsePostnummerPostort(rest) {
  const s = (rest || '').trim();
  if (!s) return { postnummer: '', postort: '' };
  const withSpace = /^(\d{3})\s+(\d{2})\s*(.*)$/.exec(s);
  if (withSpace) return { postnummer: withSpace[1] + ' ' + withSpace[2], postort: (withSpace[3] || '').trim() };
  const fiveDigits = /^(\d{5})\s*(.*)$/.exec(s);
  if (fiveDigits) return { postnummer: fiveDigits[1].slice(0, 3) + ' ' + fiveDigits[1].slice(3), postort: (fiveDigits[2] || '').trim() };
  return { postnummer: '', postort: s };
}

/** Tar bort wrap från ett fält (om det har gp-ocr-falt-wrap) och eventuellt från det andra fältet i namnparet. */
function unwrapOcrFaltWrap(wrap) {
  if (!wrap?.classList?.contains('gp-ocr-falt-wrap')) return;
  const field = wrap.querySelector('input, textarea');
  const group = wrap.querySelector('.gp-ocr-falt-ikon-grupp');
  if (group) group.remove();
  else if (ocrFaltIkonBtn?.parentElement === wrap) ocrFaltIkonBtn.remove();
  if (field && wrap.parentNode) {
    wrap.parentNode.insertBefore(field, wrap);
    wrap.remove();
  }
  if (field && arNamnFaltForOcr(field)) {
    const par = getNamnParFalt(field);
    if (par) {
      const other = par.fornamn === field ? par.efternamn : par.fornamn;
      const otherWrap = other.parentElement;
      if (otherWrap?.classList?.contains('gp-ocr-falt-wrap')) {
        const otherGroup = otherWrap.querySelector('.gp-ocr-falt-ikon-grupp');
        if (otherGroup) otherGroup.remove();
        const otherField = otherWrap.querySelector('input, textarea');
        if (otherField && otherWrap.parentNode) {
          otherWrap.parentNode.insertBefore(otherField, otherWrap);
          otherWrap.remove();
        }
      }
    }
  }
  if (field && arAdressFaltForOcr(field)) {
    const trio = getAdressTrioFalt(field);
    if (trio) {
      for (const f of [trio.gatuadress, trio.postnummer, trio.postort]) {
        if (f === field) continue;
        const otherWrap = f.parentElement;
        if (otherWrap?.classList?.contains('gp-ocr-falt-wrap')) {
          const otherGroup = otherWrap.querySelector('.gp-ocr-falt-ikon-grupp');
          if (otherGroup) otherGroup.remove();
          const otherField = otherWrap.querySelector('input, textarea');
          if (otherField && otherWrap.parentNode) {
            otherWrap.parentNode.insertBefore(otherField, otherWrap);
            otherWrap.remove();
          }
        }
      }
    }
  }
}

/** Visar textextraheringsikonen bredvid det angivna textfältet (wrap + ikon). Anropa vid klick-fokus eller klick i redan fokuserat fält. */
function visaOcrIkonForFalt(input) {
  if (!state.inmatningRedigerar || !input.closest('#gp-inmatning')) return;
  if (input.matches('input[type="checkbox"], input[type="radio"], select')) return;
  const existingWrap = input.parentElement;
  const isNamnFalt = arNamnFaltForOcr(input);
  const par = isNamnFalt ? getNamnParFalt(input) : null;
  const arFornamn = par && input === par.fornamn;
  const arEfternamn = par && input === par.efternamn;
  const isAdressFalt = arAdressFaltForOcr(input);
  if (existingWrap?.classList?.contains('gp-ocr-falt-wrap')) {
    const group = existingWrap.querySelector('.gp-ocr-falt-ikon-grupp');
    const hasMainBtn = ocrFaltIkonBtn && existingWrap.contains(ocrFaltIkonBtn);
    const hasFullGroup = group && (arEfternamn ? group.contains(ocrFaltIkonBtn) : true);
    if (hasMainBtn || hasFullGroup) return;
    if (isAdressFalt && group && window.gpOcrBtnAdress && group.contains(window.gpOcrBtnAdress)) return;
  }
  if (!ocrFaltIkonBtn) {
    ocrFaltIkonBtn = document.createElement('button');
    ocrFaltIkonBtn.type = 'button';
    ocrFaltIkonBtn.className = 'gp-ocr-falt-ikon';
    ocrFaltIkonBtn.setAttribute('aria-label', 'Markera område på bild');
    ocrFaltIkonBtn.title = 'Markera område på bild';
    ocrFaltIkonBtn.innerHTML = '<span aria-hidden="true">📄</span>';
    ocrFaltIkonBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (ocrVantarPaBild) {
        ocrVantarPaBild = false;
        ocrNamnLage = null;
        ocrAdressLage = false;
        ocrFoddenamnFalt = null;
        uppdateraOcrKnapp();
        return;
      }
      if (!ocrTargetElement) return;
      ocrVantarPaBild = true;
      const parent = ocrFaltIkonBtn.parentElement;
      if (parent?.classList?.contains('gp-ocr-falt-ikon-grupp')) parent.remove();
      else ocrFaltIkonBtn.remove();
      uppdateraOcrKnapp();
    });
  }
  ocrFaltIkonBtn.classList.remove('gp-ocr-falt-ikon-fel');
  ocrFaltIkonBtn.title = 'Markera område på bild';
  ocrFaltIkonBtn.setAttribute('aria-label', 'Markera område på bild');
  let wrapToUnwrap = ocrFaltIkonBtn.parentElement;
  if (wrapToUnwrap?.classList?.contains('gp-ocr-falt-ikon-grupp')) wrapToUnwrap = wrapToUnwrap.parentElement;
  if (wrapToUnwrap?.classList?.contains('gp-ocr-falt-wrap')) {
    unwrapOcrFaltWrap(wrapToUnwrap);
  } else if (ocrFaltIkonBtn.parentElement) {
    ocrFaltIkonBtn.remove();
  }
  if (isNamnFalt && par) {
    if (arEfternamn) {
      unwrapOcrFaltWrap(par.fornamn.parentElement?.classList?.contains('gp-ocr-falt-wrap') ? par.fornamn.parentElement : null);
    } else if (arFornamn) {
      unwrapOcrFaltWrap(par.efternamn.parentElement?.classList?.contains('gp-ocr-falt-wrap') ? par.efternamn.parentElement : null);
    }
  }
  function ensureEfFeButtons() {
    if (!window.gpOcrBtnEf) {
      window.gpOcrBtnEf = document.createElement('button');
      window.gpOcrBtnEf.type = 'button';
      window.gpOcrBtnEf.className = 'gp-ocr-falt-ikon gp-ocr-falt-ikon-ef';
      window.gpOcrBtnEf.setAttribute('aria-label', 'Efternamn först – markera område på bild');
      window.gpOcrBtnEf.title = 'Efternamn, förnamn – markera område på bild';
      window.gpOcrBtnEf.textContent = 'EF';
      window.gpOcrBtnEf.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (!ocrTargetElement) return;
        ocrNamnLage = 'ef';
        ocrVantarPaBild = true;
        const g = ev.target.closest('.gp-ocr-falt-ikon-grupp');
        if (g) g.remove();
        uppdateraOcrKnapp();
      });
    }
    if (!window.gpOcrBtnFe) {
      window.gpOcrBtnFe = document.createElement('button');
      window.gpOcrBtnFe.type = 'button';
      window.gpOcrBtnFe.className = 'gp-ocr-falt-ikon gp-ocr-falt-ikon-fe';
      window.gpOcrBtnFe.setAttribute('aria-label', 'Förnamn först – markera område på bild');
      window.gpOcrBtnFe.title = 'Förnamn, efternamn – markera område på bild';
      window.gpOcrBtnFe.textContent = 'FE';
      window.gpOcrBtnFe.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (!ocrTargetElement) return;
        ocrNamnLage = 'fe';
        ocrVantarPaBild = true;
        const g = ev.target.closest('.gp-ocr-falt-ikon-grupp');
        if (g) g.remove();
        uppdateraOcrKnapp();
      });
    }
    if (!window.gpOcrBtnF) {
      window.gpOcrBtnF = document.createElement('button');
      window.gpOcrBtnF.type = 'button';
      window.gpOcrBtnF.className = 'gp-ocr-falt-ikon gp-ocr-falt-ikon-f';
      window.gpOcrBtnF.setAttribute('aria-label', 'Lägg till namn som ogift (f. född) – markera område på bild');
      window.gpOcrBtnF.title = 'Lägg till f. (född) – namn som ogift; markera område på bild med flicknamnet, texten läggs till i slutet av efternamnsfältet';
      window.gpOcrBtnF.textContent = 'f.';
      window.gpOcrBtnF.addEventListener('click', (ev) => {
        ev.preventDefault();
        const wrap = ev.target.closest('.gp-ocr-falt-wrap');
        const efternamnFalt = wrap && wrap.querySelector('[name="inv_efternamn"], [name="na_efternamn"], [name^="gs_efternamn_"]');
        if (!efternamnFalt || isBeteckningFalt(efternamnFalt)) return;
        ocrFoddenamnFalt = efternamnFalt;
        ocrNamnLage = 'f';
        ocrVantarPaBild = true;
        const g = ev.target.closest('.gp-ocr-falt-ikon-grupp');
        if (g) g.remove();
        uppdateraOcrKnapp();
      });
    }
  }
  if (isNamnFalt && par) {
    if (arFornamn) {
      wrap = input.parentElement?.classList?.contains('gp-ocr-falt-wrap') ? input.parentElement : null;
      if (!wrap) {
        wrap = document.createElement('span');
        wrap.className = 'gp-ocr-falt-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
      }
      wrap.classList.remove('gp-ocr-falt-wrap-namn');
      wrap.appendChild(ocrFaltIkonBtn);
      const efternamnWrap = par.efternamn.parentElement?.classList?.contains('gp-ocr-falt-wrap') ? par.efternamn.parentElement : null;
      let wrapEfter = efternamnWrap;
      if (!wrapEfter) {
        wrapEfter = document.createElement('span');
        wrapEfter.className = 'gp-ocr-falt-wrap gp-ocr-falt-wrap-namn';
        par.efternamn.parentNode.insertBefore(wrapEfter, par.efternamn);
        wrapEfter.appendChild(par.efternamn);
      } else {
        wrapEfter.classList.add('gp-ocr-falt-wrap-namn');
      }
      ensureEfFeButtons();
      let groupEfFe = wrapEfter.querySelector('.gp-ocr-falt-ikon-grupp');
      if (!groupEfFe) {
        groupEfFe = document.createElement('div');
        groupEfFe.className = 'gp-ocr-falt-ikon-grupp';
      }
      groupEfFe.innerHTML = '';
      groupEfFe.appendChild(window.gpOcrBtnEf);
      groupEfFe.appendChild(window.gpOcrBtnFe);
      groupEfFe.appendChild(window.gpOcrBtnF);
      if (!wrapEfter.contains(groupEfFe)) wrapEfter.appendChild(groupEfFe);
    } else if (arEfternamn) {
      wrap = input.parentElement?.classList?.contains('gp-ocr-falt-wrap') ? input.parentElement : null;
      if (!wrap) {
        wrap = document.createElement('span');
        wrap.className = 'gp-ocr-falt-wrap gp-ocr-falt-wrap-namn';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
      } else {
        wrap.classList.add('gp-ocr-falt-wrap-namn');
      }
      ensureEfFeButtons();
      let group = wrap.querySelector('.gp-ocr-falt-ikon-grupp');
      if (!group) {
        group = document.createElement('div');
        group.className = 'gp-ocr-falt-ikon-grupp';
      }
      group.innerHTML = '';
      group.appendChild(window.gpOcrBtnEf);
      group.appendChild(window.gpOcrBtnFe);
      group.appendChild(window.gpOcrBtnF);
      group.appendChild(ocrFaltIkonBtn);
      if (!wrap.contains(group)) wrap.appendChild(group);
    } else {
      wrap = input.parentElement?.classList?.contains('gp-ocr-falt-wrap') ? input.parentElement : null;
      if (!wrap) {
        wrap = document.createElement('span');
        wrap.className = 'gp-ocr-falt-wrap gp-ocr-falt-wrap-namn';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
      } else {
        wrap.classList.add('gp-ocr-falt-wrap-namn');
      }
      ensureEfFeButtons();
      let group = wrap.querySelector('.gp-ocr-falt-ikon-grupp');
      if (!group) {
        group = document.createElement('div');
        group.className = 'gp-ocr-falt-ikon-grupp';
      }
      group.innerHTML = '';
      group.appendChild(window.gpOcrBtnEf);
      group.appendChild(window.gpOcrBtnFe);
      group.appendChild(ocrFaltIkonBtn);
      if (!wrap.contains(group)) wrap.appendChild(group);
    }
  }
  function ensureOcrBtnAdress() {
    if (!window.gpOcrBtnAdress) {
      window.gpOcrBtnAdress = document.createElement('button');
      window.gpOcrBtnAdress.type = 'button';
      window.gpOcrBtnAdress.className = 'gp-ocr-falt-ikon gp-ocr-falt-ikon-adress';
      window.gpOcrBtnAdress.setAttribute('aria-label', 'Extrahera hel adressrad – markera område på bild');
      window.gpOcrBtnAdress.title = 'Extrahera hel adressrad till Gatuadress, Postnummer, Postort – markera område på bild';
      window.gpOcrBtnAdress.textContent = 'Adress';
      window.gpOcrBtnAdress.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (!ocrTargetElement) return;
        ocrAdressLage = true;
        ocrVantarPaBild = true;
        const g = ev.target.closest('.gp-ocr-falt-ikon-grupp');
        if (g) g.remove();
        uppdateraOcrKnapp();
      });
    }
  }
  if (isAdressFalt) {
    let wrap = input.parentElement?.classList?.contains('gp-ocr-falt-wrap') ? input.parentElement : null;
    if (!wrap) {
      wrap = document.createElement('span');
      wrap.className = 'gp-ocr-falt-wrap gp-ocr-falt-wrap-adress';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
    } else {
      wrap.classList.add('gp-ocr-falt-wrap-adress');
    }
    ensureOcrBtnAdress();
    let group = wrap.querySelector('.gp-ocr-falt-ikon-grupp');
    if (!group) {
      group = document.createElement('div');
      group.className = 'gp-ocr-falt-ikon-grupp';
    }
    group.innerHTML = '';
    group.appendChild(ocrFaltIkonBtn);
    group.appendChild(window.gpOcrBtnAdress);
    if (!wrap.contains(group)) wrap.appendChild(group);
  } else if (!isNamnFalt) {
    let wrap = input.parentElement?.classList?.contains('gp-ocr-falt-wrap') ? input.parentElement : null;
    if (!wrap) {
      wrap = document.createElement('span');
      wrap.className = 'gp-ocr-falt-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
    }
    wrap.classList.remove('gp-ocr-falt-wrap-namn');
    wrap.appendChild(ocrFaltIkonBtn);
  }
  uppdateraOcrKnapp();
  requestAnimationFrame(() => input.focus());
}

function startOcrOverlay(fig, initialEvent) {
  const img = fig.querySelector('img');
  const halvaUrl = fig.dataset.halvaUrl;
  if (!img || !halvaUrl) return;
  const overlay = document.createElement('div');
  overlay.className = 'gp-ocr-overlay';
  const rectEl = document.createElement('div');
  rectEl.className = 'gp-ocr-rektangel';
  rectEl.hidden = true;
  overlay.appendChild(rectEl);

  const figRect = fig.getBoundingClientRect();
  const imgRect = img.getBoundingClientRect();
  overlay.style.position = 'absolute';
  overlay.style.top = (imgRect.top - figRect.top) + 'px';
  overlay.style.left = (imgRect.left - figRect.left) + 'px';
  overlay.style.width = imgRect.width + 'px';
  overlay.style.height = imgRect.height + 'px';
  fig.appendChild(overlay);

  let startX = 0, startY = 0;

  /** Konverterar clientX/clientY till overlay-koordinater och klampar till overlay-ytan. */
  function clientToOverlay(clientX, clientY) {
    const r = overlay.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    const y = Math.max(0, Math.min(r.height, clientY - r.top));
    return { x, y };
  }

  function setRect(left, top, width, height) {
    rectEl.style.left = left + 'px';
    rectEl.style.top = top + 'px';
    rectEl.style.width = Math.max(0, width) + 'px';
    rectEl.style.height = Math.max(0, height) + 'px';
    rectEl.hidden = width === 0 && height === 0;
  }

  function startDrag(offsetX, offsetY) {
    startX = offsetX;
    startY = offsetY;
    setRect(startX, startY, 0, 0);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
  }

  function onDown(e) {
    startDrag(e.offsetX, e.offsetY);
  }

  function onMove(e) {
    const { x, y } = clientToOverlay(e.clientX, e.clientY);
    const left = Math.min(startX, x);
    const top = Math.min(startY, y);
    const width = Math.abs(x - startX);
    const height = Math.abs(y - startY);
    setRect(left, top, width, height);
  }

  function onEscapeOverlay(e) {
    if (e.key === 'Escape') {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onEscapeOverlay);
      overlay.remove();
    }
  }
  document.addEventListener('keydown', onEscapeOverlay);

  function onUp(e) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('keydown', onEscapeOverlay);
    const { x, y } = clientToOverlay(e.clientX, e.clientY);
    const left = Math.min(startX, x);
    const top = Math.min(startY, y);
    let width = Math.abs(x - startX);
    let height = Math.abs(y - startY);
    if (width < 4 || height < 4) {
      overlay.remove();
      return;
    }
    ocrJustAvslutad = true;
    setTimeout(() => { ocrJustAvslutad = false; }, 300);
    overlay.remove();
    const scaleX = img.naturalWidth / imgRect.width;
    const scaleY = img.naturalHeight / imgRect.height;
    const rectNatural = {
      x: left * scaleX,
      y: top * scaleY,
      w: width * scaleX,
      h: height * scaleY,
    };
    // Frys vilket fält som ska uppdateras – även om användaren hinner flytta fokus innan OCR-resultatet kommer.
    const targetElement = ocrTargetElement;
    runOcr(halvaUrl, rectNatural).then((text) => {
      const trimmed = (text || '').trim();
      const target = targetElement;
      if (!target) return;
      if (!document.body.contains(target)) return;
      if (trimmed === '') {
        if (!arDatumFaltForOcr(target)) {
          if (ocrNamnLage === 'f') {
            ocrNamnLage = null;
            ocrFoddenamnFalt = null;
          }
          ocrNamnLage = null;
          ocrAdressLage = false;
        }
        visaIkonSomTomExtrahering();
        return;
      }
      if (ocrNamnLage === 'f') {
        const falt = ocrFoddenamnFalt || getNamnParFalt(target)?.efternamn;
        ocrNamnLage = null;
        ocrFoddenamnFalt = null;
        if (falt) {
          const val = (falt.value || '').trim();
          falt.value = val ? val + ' f. ' + trimmed : ' f. ' + trimmed;
          markInmatningDirty();
          if (falt.tagName === 'TEXTAREA') autoExpandTextarea(falt);
          falt.focus();
          const len = falt.value.length;
          try { falt.setSelectionRange(len, len); } catch (_) {}
        }
        return;
      }
      if (ocrNamnLage) {
        const lage = ocrNamnLage;
        ocrNamnLage = null;
        const normaliserad = trimmed.replace(/\s+/g, ' ').trim();
        const parts = normaliserad.split(/\s+/).filter(Boolean);
        if (parts.length === 2) {
          const par = getNamnParFalt(target);
          if (par && target) {
            const part1 = parts[0];
            const part2 = parts[1];
            if (lage === 'ef') {
              par.efternamn.value = part1;
              par.fornamn.value = part2;
            } else {
              par.fornamn.value = part1;
              par.efternamn.value = part2;
            }
            if (par.fornamn.tagName === 'TEXTAREA') autoExpandTextarea(par.fornamn);
            if (par.efternamn.tagName === 'TEXTAREA') autoExpandTextarea(par.efternamn);
            markInmatningDirty();
          }
          return;
        }
        showOcrModalNamnSplit(normaliserad, lage, target);
        return;
      }
      if (ocrAdressLage) {
        ocrAdressLage = false;
        showOcrModalAdressSplit(trimmed, target);
        return;
      }
      if (arDatumFaltForOcr(target)) {
        const normaliserat = normaliseraUtfordatDen(trimmed);
        if (normaliserat) {
          target.value = normaliserat;
          target.focus();
          const len = target.value.length;
          try {
            target.setSelectionRange(len, len);
          } catch (_) {}
          markInmatningDirty();
          if (target.tagName === 'TEXTAREA') autoExpandTextarea(target);
        } else {
          visaIkonSomTomExtrahering();
        }
      } else {
        // Infoga i det fält som gällde när markeringen gjordes, oavsett nuvarande fokus.
        const befintlig = target.value || '';
        target.value = befintlig + (trimmed || '');
        target.focus();
        const len = target.value.length;
        try {
          target.setSelectionRange(len, len);
        } catch (_) {}
        markInmatningDirty();
        if (target.tagName === 'TEXTAREA') autoExpandTextarea(target);
      }
    }).catch((err) => {
      showToast('OCR misslyckades: ' + (err && err.message ? err.message : 'okänt fel'), 'fel');
    });
  }

  if (initialEvent) {
    const ox = initialEvent.target === img
      ? initialEvent.offsetX
      : initialEvent.clientX - imgRect.left;
    const oy = initialEvent.target === img
      ? initialEvent.offsetY
      : initialEvent.clientY - imgRect.top;
    startDrag(ox, oy);
  } else {
    overlay.addEventListener('mousedown', onDown);
  }
}

function runOcr(imageUrl, rect) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(rect.w));
      canvas.height = Math.max(1, Math.floor(rect.h));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas stöd saknas'));
        return;
      }
      ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
      if (typeof Tesseract === 'undefined') {
        reject(new Error('Tesseract.js är inte laddad'));
        return;
      }
      Tesseract.recognize(canvas, 'swe+eng', { logger: () => {} })
        .then((result) => resolve((result && result.data && result.data.text) ? result.data.text.trim() : ''))
        .catch(reject);
    };
    img.onerror = () => reject(new Error('Kunde inte ladda bilden'));
    img.src = imageUrl;
  });
}

/**
 * Normaliserar fritext-datum till formatet YYYY-MM-DD.
 * - Endast år -> YYYY-00-00
 * - År + månad -> YYYY-MM-00
 * - Fullständigt datum -> YYYY-MM-DD
 * Accepterar t.ex. YYYY MM DD, YY MM DD (mellanslag, inga bindestreck – OCR),
 * YYYY.MM.DD, DD/MM/YYYY, DD.MM.YYYY, DD/MM YYYY, YYYY-MM-DD, månadsnamn + år.
 */
function normaliseraUtfordatDen(str) {
  const s = (str || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';

  const pad = (n, len = 2) => String(n).padStart(len, '0');

  // Redan YYYY-MM-DD eller YYYY-MM-00 eller YYYY-00-00
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10);
    const d = parseInt(iso[3], 10);
    if (y >= 1000 && y <= 9999) {
      if (m === 0) return `${y}-00-00`;
      if (d === 0) return `${y}-${pad(m)}-00`;
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad(m)}-${pad(d)}`;
    }
  }

  // YYYY MM DD eller YYYY MM (mellanslag, inga bindestreck – t.ex. OCR)
  const ymdSpace = /^(\d{4})\s+(\d{1,2})\s+(\d{1,2})$/.exec(s);
  if (ymdSpace) {
    const y = parseInt(ymdSpace[1], 10);
    const m = parseInt(ymdSpace[2], 10);
    const d = parseInt(ymdSpace[3], 10);
    if (y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad(m)}-${pad(d)}`;
  }
  const ymSpace = /^(\d{4})\s+(\d{1,2})$/.exec(s);
  if (ymSpace) {
    const y = parseInt(ymSpace[1], 10);
    const m = parseInt(ymSpace[2], 10);
    if (y >= 1000 && y <= 9999 && m >= 1 && m <= 12) return `${y}-${pad(m)}-00`;
  }

  // YYYY.MM.DD eller YYYY.MM (punkt som avgränsare)
  const ymdDot = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(s);
  if (ymdDot) {
    const y = parseInt(ymdDot[1], 10);
    const m = parseInt(ymdDot[2], 10);
    const d = parseInt(ymdDot[3], 10);
    if (y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad(m)}-${pad(d)}`;
  }
  const ymDot = /^(\d{4})\.(\d{1,2})$/.exec(s);
  if (ymDot) {
    const y = parseInt(ymDot[1], 10);
    const m = parseInt(ymDot[2], 10);
    if (y >= 1000 && y <= 9999 && m >= 1 && m <= 12) return `${y}-${pad(m)}-00`;
  }

  const kortDatum = /^(\d{2})\s*[\/\.\-]?\s*(\d{1,2})\s*[\/\.\-]?\s*(\d{1,2})$/.exec(s);
  if (kortDatum) {
    const yy = parseInt(kortDatum[1], 10);
    const m = parseInt(kortDatum[2], 10);
    const d = parseInt(kortDatum[3], 10);
    const y = 1900 + yy;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad(m)}-${pad(d)}`;
  }
  const sexSiffror = /^(\d{2})(\d{2})(\d{2})$/.exec(s.replace(/\s/g, ''));
  if (sexSiffror) {
    const yy = parseInt(sexSiffror[1], 10);
    const m = parseInt(sexSiffror[2], 10);
    const d = parseInt(sexSiffror[3], 10);
    const y = 1900 + yy;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad(m)}-${pad(d)}`;
  }

  // DD/MM/YYYY eller DD.MM.YYYY eller DD-MM-YYYY eller DD/MM YYYY
  const dmy = /^(\d{1,2})[\/\.\-](\d{1,2})(?:[\/\.\-]?\s*(\d{4}))?$/.exec(s);
  if (dmy) {
    let a = parseInt(dmy[1], 10);
    let b = parseInt(dmy[2], 10);
    const year = dmy[3] ? parseInt(dmy[3], 10) : null;
    let day, month;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { day = b; month = a; }
    else { day = a; month = b; }
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1000 && year <= 9999) {
      return `${year}-${pad(month)}-${pad(day)}`;
    }
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && !year) return '';
  }

  // YYYY/MM eller YYYY-MM (utan dag)
  const ym = /^(\d{4})[\/\-](\d{1,2})$/.exec(s);
  if (ym) {
    const y = parseInt(ym[1], 10);
    const m = parseInt(ym[2], 10);
    if (y >= 1000 && y <= 9999 && m >= 1 && m <= 12) return `${y}-${pad(m)}-00`;
  }

  // Endast fyra siffror (år)
  const yOnly = /^(\d{4})$/.exec(s);
  if (yOnly) {
    const y = parseInt(yOnly[1], 10);
    if (y >= 1000 && y <= 9999) return `${y}-00-00`;
  }

  const months = { jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, mars: 3, apr: 4, april: 4, maj: 5, jun: 6, juni: 6, jul: 7, juli: 7, aug: 8, augusti: 8, sep: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12 };
  const monthYear = /^([a-zåäö]+)\s+(\d{4})$/i.exec(s);
  if (monthYear) {
    const mon = monthYear[1].toLowerCase().replace(/é/g, 'e');
    const key = Object.keys(months).find((k) => mon.startsWith(k));
    const m = key ? months[key] : 0;
    const y = parseInt(monthYear[2], 10);
    if (m >= 1 && m <= 12 && y >= 1000 && y <= 9999) return `${y}-${pad(m)}-00`;
  }

  return '';
}

/** Visar textextraheringsikonen i rött bredvid aktuellt fält när ingen text kunde extraheras. */
function visaIkonSomTomExtrahering() {
  if (!ocrTargetElement || !ocrFaltIkonBtn) return;
  ocrFaltIkonBtn.classList.add('gp-ocr-falt-ikon-fel');
  ocrFaltIkonBtn.remove();
  ocrFaltIkonBtn.title = 'Ingen text kunde extraheras – försök igen';
  ocrFaltIkonBtn.setAttribute('aria-label', 'Ingen text kunde extraheras – försök igen');
  const input = ocrTargetElement;
  let wrap = input.parentElement?.classList?.contains('gp-ocr-falt-wrap') ? input.parentElement : null;
  if (!wrap) {
    wrap = document.createElement('span');
    wrap.className = 'gp-ocr-falt-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
  }
  if (arNamnFaltForOcr(input)) {
    wrap.classList.add('gp-ocr-falt-wrap-namn');
    let group = wrap.querySelector('.gp-ocr-falt-ikon-grupp');
    if (!group) {
      group = document.createElement('div');
      group.className = 'gp-ocr-falt-ikon-grupp';
    }
    group.innerHTML = '';
    if (window.gpOcrBtnEf) group.appendChild(window.gpOcrBtnEf);
    if (window.gpOcrBtnFe) group.appendChild(window.gpOcrBtnFe);
    if (window.gpOcrBtnF) group.appendChild(window.gpOcrBtnF);
    group.appendChild(ocrFaltIkonBtn);
    wrap.appendChild(group);
  } else {
    wrap.appendChild(ocrFaltIkonBtn);
  }
  uppdateraOcrKnapp();
}

/** Infogar OCR-text direkt i målfältet, fokuserar och sätter markören i slutet så användaren kan korrigera. */
function infogaOcrIFalt(text) {
  if (!ocrTargetElement) return;
  const befintlig = ocrTargetElement.value || '';
  ocrTargetElement.value = befintlig + (text || '');
  ocrTargetElement.focus();
  const len = ocrTargetElement.value.length;
  try {
    ocrTargetElement.setSelectionRange(len, len);
  } catch (_) {}
  markInmatningDirty();
  if (ocrTargetElement.tagName === 'TEXTAREA') autoExpandTextarea(ocrTargetElement);
}

/** Gör att en textarea radbryter text och växer nedåt (scrollHeight). Anropa vid input och när värde sätts programmatiskt. */
function autoExpandTextarea(ta) {
  if (!ta || ta.tagName !== 'TEXTAREA') return;
  ta.style.height = '0';
  ta.style.height = Math.max(ta.scrollHeight, 38) + 'px';
}

/** Returnerar true om fältet är ett datumfält (t.ex. födelse/döds/gravsatt den) där OCR-text tolkas till YYYY-MM-DD och infogas direkt. */
function arDatumFaltForOcr(element) {
  const name = element && element.getAttribute('name');
  if (!name) return false;
  return name === 'utfordat_den' ||
    name.startsWith('gs_fodelse_datum_') ||
    name.startsWith('gs_dods_datum_') ||
    name.startsWith('gs_gravsatt_den_');
}

function showOcrModal(extractedText) {
  const modal = document.getElementById('gp-ocr-modal');
  const textarea = document.getElementById('gp-ocr-modal-text');
  if (!modal || !textarea) return;
  ocrModalNamnLage = null;
  /* För datumfält (t.ex. Utfärdat den) visas ingen modal – normalisera och infoga direkt eller inte alls. */
  if (ocrTargetElement && arDatumFaltForOcr(ocrTargetElement)) {
    const normaliserat = normaliseraUtfordatDen(extractedText || '');
    if (normaliserat) {
      ocrTargetElement.value = normaliserat;
      ocrTargetElement.focus();
      const len = ocrTargetElement.value.length;
      try { ocrTargetElement.setSelectionRange(len, len); } catch (_) {}
      markInmatningDirty();
      if (ocrTargetElement.tagName === 'TEXTAREA') autoExpandTextarea(ocrTargetElement);
    }
    return;
  }
  document.getElementById('gp-ocr-modal-namn')?.setAttribute('hidden', '');
  document.getElementById('gp-ocr-modal-hint')?.removeAttribute('hidden');
  document.getElementById('gp-ocr-modal-text')?.removeAttribute('hidden');
  textarea.value = extractedText || '';
  modal.hidden = false;
  textarea.focus();
  autoExpandTextarea(textarea);
}

function showOcrModalNamnSplit(text, lage, targetElement) {
  const modal = document.getElementById('gp-ocr-modal');
  const namnWrap = document.getElementById('gp-ocr-modal-namn');
  const namnTextEl = document.getElementById('gp-ocr-namn-text');
  const rubrikEl = document.getElementById('gp-ocr-modal-rubrik');
  const hintEl = document.getElementById('gp-ocr-modal-hint');
  const textarea = document.getElementById('gp-ocr-modal-text');
  const knapparEl = document.getElementById('gp-ocr-modal-knappar');
  if (!modal || !namnWrap || !namnTextEl) return;
  ocrModalTargetElement = targetElement || ocrTargetElement;
  ocrModalNamnLage = lage;
  hintEl?.setAttribute('hidden', '');
  textarea?.setAttribute('hidden', '');
  if (knapparEl) knapparEl.setAttribute('hidden', '');
  namnWrap.removeAttribute('hidden');
  if (rubrikEl) rubrikEl.textContent = lage === 'ef' ? 'Dela namn (Efternamn, Förnamn)' : 'Dela namn (Förnamn, Efternamn)';
  namnTextEl.innerHTML = '';
  const n = text.length;
  const applyAndClose = (splitIndex) => {
    const par = getNamnParFalt(ocrModalTargetElement);
    if (par && ocrModalTargetElement) {
      const part1 = text.slice(0, splitIndex).trim();
      const part2 = text.slice(splitIndex).trim();
      if (lage === 'ef') {
        par.efternamn.value = part1;
        par.fornamn.value = part2;
      } else {
        par.fornamn.value = part1;
        par.efternamn.value = part2;
      }
      if (par.fornamn.tagName === 'TEXTAREA') autoExpandTextarea(par.fornamn);
      if (par.efternamn.tagName === 'TEXTAREA') autoExpandTextarea(par.efternamn);
      markInmatningDirty();
    }
    ocrModalNamnLage = null;
    ocrModalTargetElement = null;
    namnWrap.setAttribute('hidden', '');
    if (rubrikEl) rubrikEl.textContent = 'Extraherad text';
    hintEl?.removeAttribute('hidden');
    textarea?.removeAttribute('hidden');
    if (knapparEl) knapparEl.removeAttribute('hidden');
    modal.hidden = true;
  };
  for (let i = 0; i <= n; i++) {
    const splitSpan = document.createElement('span');
    splitSpan.className = 'gp-ocr-namn-split';
    splitSpan.dataset.index = String(i);
    splitSpan.setAttribute('role', 'button');
    splitSpan.setAttribute('tabindex', '0');
    splitSpan.setAttribute('aria-label', `Dela efter tecken ${i}`);
    splitSpan.addEventListener('click', () => applyAndClose(i));
    splitSpan.addEventListener('mouseenter', () => splitSpan.classList.add('gp-ocr-namn-split-hover'));
    splitSpan.addEventListener('mouseleave', () => splitSpan.classList.remove('gp-ocr-namn-split-hover'));
    splitSpan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        applyAndClose(i);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const splits = [...namnTextEl.querySelectorAll('.gp-ocr-namn-split')];
        const idx = splits.indexOf(e.currentTarget);
        const next = e.key === 'ArrowRight' ? splits[idx + 1] : splits[idx - 1];
        if (next) next.focus();
      }
    });
    namnTextEl.appendChild(splitSpan);
    if (i < n) {
      const charSpan = document.createElement('span');
      charSpan.className = 'gp-ocr-namn-char';
      charSpan.textContent = text[i];
      namnTextEl.appendChild(charSpan);
    }
  }
  modal.hidden = false;
  const firstSplit = namnTextEl.querySelector('.gp-ocr-namn-split');
  if (firstSplit) firstSplit.focus();
}

function showOcrModalAdressSplit(text, targetElement) {
  const modal = document.getElementById('gp-ocr-modal');
  const namnWrap = document.getElementById('gp-ocr-modal-namn');
  const namnTextEl = document.getElementById('gp-ocr-namn-text');
  const rubrikEl = document.getElementById('gp-ocr-modal-rubrik');
  const hintEl = document.getElementById('gp-ocr-modal-hint');
  const namnHintEl = document.getElementById('gp-ocr-modal-namn-hint');
  const textarea = document.getElementById('gp-ocr-modal-text');
  const knapparEl = document.getElementById('gp-ocr-modal-knappar');
  if (!modal || !namnWrap || !namnTextEl) return;
  ocrModalTargetElement = targetElement || ocrTargetElement;
  ocrModalAdressLage = true;
  ocrModalNamnLage = null;
  hintEl?.setAttribute('hidden', '');
  textarea?.setAttribute('hidden', '');
  if (knapparEl) knapparEl.setAttribute('hidden', '');
  namnWrap.removeAttribute('hidden');
  if (rubrikEl) rubrikEl.textContent = 'Dela adress (Gatuadress | Postnummer, Postort)';
  if (namnHintEl) namnHintEl.textContent = 'Klicka mellan två tecken för att ange var gatuadressen slutar och postnummer börjar.';
  namnTextEl.innerHTML = '';
  const n = text.length;
  const applyAndClose = (splitIndex) => {
    const trio = getAdressTrioFalt(ocrModalTargetElement);
    if (trio && ocrModalTargetElement) {
      const gatuadress = text.slice(0, splitIndex).trim();
      const rest = text.slice(splitIndex);
      const { postnummer, postort } = parsePostnummerPostort(rest);
      trio.gatuadress.value = gatuadress;
      trio.postnummer.value = postnummer;
      trio.postort.value = postort;
      if (trio.gatuadress.tagName === 'TEXTAREA') autoExpandTextarea(trio.gatuadress);
      if (trio.postnummer.tagName === 'TEXTAREA') autoExpandTextarea(trio.postnummer);
      if (trio.postort.tagName === 'TEXTAREA') autoExpandTextarea(trio.postort);
      markInmatningDirty();
    }
    ocrModalAdressLage = false;
    ocrModalTargetElement = null;
    namnWrap.setAttribute('hidden', '');
    if (rubrikEl) rubrikEl.textContent = 'Extraherad text';
    if (namnHintEl) namnHintEl.textContent = 'Klicka mellan två tecken för att ange var namnet ska delas.';
    hintEl?.removeAttribute('hidden');
    textarea?.removeAttribute('hidden');
    if (knapparEl) knapparEl.removeAttribute('hidden');
    modal.hidden = true;
  };
  for (let i = 0; i <= n; i++) {
    const splitSpan = document.createElement('span');
    splitSpan.className = 'gp-ocr-namn-split';
    splitSpan.dataset.index = String(i);
    splitSpan.setAttribute('role', 'button');
    splitSpan.setAttribute('tabindex', '0');
    splitSpan.setAttribute('aria-label', `Dela efter tecken ${i}`);
    splitSpan.addEventListener('click', () => applyAndClose(i));
    splitSpan.addEventListener('mouseenter', () => splitSpan.classList.add('gp-ocr-namn-split-hover'));
    splitSpan.addEventListener('mouseleave', () => splitSpan.classList.remove('gp-ocr-namn-split-hover'));
    splitSpan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        applyAndClose(i);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const splits = [...namnTextEl.querySelectorAll('.gp-ocr-namn-split')];
        const idx = splits.indexOf(e.currentTarget);
        const next = e.key === 'ArrowRight' ? splits[idx + 1] : splits[idx - 1];
        if (next) next.focus();
      }
    });
    namnTextEl.appendChild(splitSpan);
    if (i < n) {
      const charSpan = document.createElement('span');
      charSpan.className = 'gp-ocr-namn-char';
      charSpan.textContent = text[i];
      namnTextEl.appendChild(charSpan);
    }
  }
  modal.hidden = false;
  const firstSplit = namnTextEl.querySelector('.gp-ocr-namn-split');
  if (firstSplit) firstSplit.focus();
}

function closeOcrModal(anvand) {
  const modal = document.getElementById('gp-ocr-modal');
  const textarea = document.getElementById('gp-ocr-modal-text');
  const namnWrap = document.getElementById('gp-ocr-modal-namn');
  const rubrikEl = document.getElementById('gp-ocr-modal-rubrik');
  if (!modal || !textarea) return;
  const returnFocusTill = ocrModalTargetElement || ocrTargetElement;
  if (ocrModalNamnLage) {
    ocrModalNamnLage = null;
    ocrNamnSplitIndex = null;
    ocrModalTargetElement = null;
    if (namnWrap) namnWrap.setAttribute('hidden', '');
    if (rubrikEl) rubrikEl.textContent = 'Extraherad text';
    document.getElementById('gp-ocr-modal-hint')?.removeAttribute('hidden');
    textarea.removeAttribute('hidden');
    document.getElementById('gp-ocr-modal-knappar')?.removeAttribute('hidden');
    modal.hidden = true;
    if (returnFocusTill) returnFocusTill.focus();
    return;
  }
  if (ocrModalAdressLage) {
    ocrModalAdressLage = false;
    ocrModalTargetElement = null;
    const namnHintEl = document.getElementById('gp-ocr-modal-namn-hint');
    if (namnHintEl) namnHintEl.textContent = 'Klicka mellan två tecken för att ange var namnet ska delas.';
    if (namnWrap) namnWrap.setAttribute('hidden', '');
    if (rubrikEl) rubrikEl.textContent = 'Extraherad text';
    document.getElementById('gp-ocr-modal-hint')?.removeAttribute('hidden');
    textarea.removeAttribute('hidden');
    document.getElementById('gp-ocr-modal-knappar')?.removeAttribute('hidden');
    modal.hidden = true;
    if (returnFocusTill) returnFocusTill.focus();
    return;
  }
  if (anvand && ocrTargetElement) {
    let value = textarea.value;
    if (arDatumFaltForOcr(ocrTargetElement)) {
      value = normaliseraUtfordatDen(value);
      if (value === '') {
        modal.hidden = true;
        if (returnFocusTill) returnFocusTill.focus();
        return;
      }
    }
    ocrTargetElement.value = value;
    if (ocrTargetElement.tagName === 'TEXTAREA') autoExpandTextarea(ocrTargetElement);
    markInmatningDirty();
  }
  modal.hidden = true;
  if (returnFocusTill) returnFocusTill.focus();
}
