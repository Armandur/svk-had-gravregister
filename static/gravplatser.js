/**
 * Gravregister – Visa och Inmatning: träd (kyrkogård → kvarter), sedan visning av gravplatser.
 */

const API = '/api';

let tradData = { kyrkogardar: [], kvarter_per_kyrkogard: {}, antal_per_kvarter: {}, antal_per_kyrkogard: {} };
/** Cache av gravplatslistor per kyrkogård+kvarter (för trädets utfallna kvarter). */
let gravplatserTradCache = {};
let valdKyrkogard = null;
let valdKvarter = null;
let gravplatserLista = [];
let currentIndex = 0;
let cacheBust = Date.now();
let currentExtramaterial = [];
let currentExtramaterialMapp = null;
/** URL:er för aktuell gravplatsens halvor (för lightbox). */
let currentHalvorUrls = [];
let visarHelaSidor = false;
let vertikalVy = false;
let currentGravplatsId = null;
let lastInmatningGravplatsId = null;
let inmatningData = null;
let inmatningDirty = false;
/** true = visa formulärfält (redigera), false = visa läsvy (layout). */
let inmatningRedigerar = false;

/** Input/textarea som ska få extraherad text (Alternativ B: sätts vid fokus). */
let ocrTargetElement = null;
/** true = användaren klickade "Markera område" och ska nu klicka på en bild. */
let ocrVantarPaBild = false;
/** true direkt efter att en OCR-markering avslutats – används för att inte öppna lightbox av efterföljande klick. */
let ocrJustAvslutad = false;
/** Ikonknapp för "Markera område" som visas bredvid fokuserat fält (skapas vid behov). */
let ocrFaltIkonBtn = null;
/** 'ef' | 'fe' när användaren valt EF/FE och väntar på bildmarkering; null annars. */
let ocrNamnLage = null;
/** I namn-split-modal: valt delningsindex (0..n) eller null om användaren inte klickat. */
let ocrNamnSplitIndex = null;
/** 'ef' | 'fe' när modalen visar namn-split; null annars. */
let ocrModalNamnLage = null;
/** true om fokus sattes via mus/pekare (klick); false vid tabb – ikonen visas bara vid pekare. */
let focusViaPointer = false;

/** Returnerar true om fältet är ett namnfält (förnamn/efternamn) där EF/FE-knapparna ska visas. */
function arNamnFaltForOcr(element) {
  const name = element && element.getAttribute('name');
  if (!name) return false;
  return name === 'inv_fornamn' || name === 'inv_efternamn' ||
    name === 'na_fornamn' || name === 'na_efternamn' ||
    (name.startsWith('gs_fornamn_') && /^gs_fornamn_\d+$/.test(name)) ||
    (name.startsWith('gs_efternamn_') && /^gs_efternamn_\d+$/.test(name));
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
}

/** Visar textextraheringsikonen bredvid det angivna textfältet (wrap + ikon). Anropa vid klick-fokus eller klick i redan fokuserat fält. */
function visaOcrIkonForFalt(input) {
  if (!inmatningRedigerar || !input.closest('#gp-inmatning')) return;
  if (input.matches('input[type="checkbox"], input[type="radio"], select')) return;
  const existingWrap = input.parentElement;
  const isNamnFalt = arNamnFaltForOcr(input);
  const par = isNamnFalt ? getNamnParFalt(input) : null;
  const arFornamn = par && input === par.fornamn;
  const arEfternamn = par && input === par.efternamn;
  if (existingWrap?.classList?.contains('gp-ocr-falt-wrap')) {
    const group = existingWrap.querySelector('.gp-ocr-falt-ikon-grupp');
    const hasMainBtn = ocrFaltIkonBtn && existingWrap.contains(ocrFaltIkonBtn);
    const hasFullGroup = group && (arEfternamn ? group.contains(ocrFaltIkonBtn) : true);
    if (hasMainBtn || hasFullGroup) return;
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
      group.appendChild(ocrFaltIkonBtn);
      group.appendChild(window.gpOcrBtnEf);
      group.appendChild(window.gpOcrBtnFe);
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
      group.appendChild(ocrFaltIkonBtn);
      group.appendChild(window.gpOcrBtnEf);
      group.appendChild(window.gpOcrBtnFe);
      if (!wrap.contains(group)) wrap.appendChild(group);
    }
  } else {
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

/** Bygg URL-slug för aktuell gravplats (t.ex. "HKG 01 1+2" → "HKG%2001%201%2B2"). */
function slugForGravplats(gp) {
  const s = (gp.fullstandigt || [gp.kyrkogard, gp.kvarter, gp.gravplatsnummer].filter(Boolean).join(' ') || '').trim();
  return s ? encodeURIComponent(s) : '';
}

/** Parsar pathname /gravplatser/slug till { kyrkogard, kvarter, gravplatsnummer } eller null. */
function parseGravplatsSlugFromPath() {
  const path = window.location.pathname;
  const prefix = '/gravplatser/';
  if (!path.startsWith(prefix)) return null;
  const slug = path.slice(prefix.length).replace(/\/$/, '');
  if (!slug) return null;
  const decoded = decodeURIComponent(slug);
  const parts = decoded.trim().split(/\s+/);
  if (parts.length < 3) return null;
  return {
    kyrkogard: parts[0],
    kvarter: parts.slice(1, -1).join(' '),
    gravplatsnummer: parts[parts.length - 1],
  };
}

/** Tar ut inledande tal från gravplatsnummer för numerisk sortering. */
function ledandeTal(s) {
  const m = String(s || '').trim().match(/^\d+/);
  return m ? parseInt(m[0], 10) : -1;
}

function sorteradLista(lista) {
  return [...lista].sort((a, b) => {
    const numA = ledandeTal(a.gravplatsnummer);
    const numB = ledandeTal(b.gravplatsnummer);
    if (numA !== numB) return numA - numB;
    return (a.gravplatsnummer || '').trim().localeCompare((b.gravplatsnummer || '').trim(), 'sv');
  });
}

async function fetchTradData() {
  try {
    const res = await fetch(`${API}/gravplatser/trad`);
    const data = await res.json();
    tradData = {
      kyrkogardar: data.kyrkogardar || [],
      kvarter_per_kyrkogard: data.kvarter_per_kyrkogard || {},
      antal_per_kvarter: data.antal_per_kvarter || {},
      antal_per_kyrkogard: data.antal_per_kyrkogard || {},
    };
  } catch (e) {
    tradData = { kyrkogardar: [], kvarter_per_kyrkogard: {}, antal_per_kvarter: {}, antal_per_kyrkogard: {} };
  }
}

async function laddaTrad() {
  await fetchTradData();
  const container = document.getElementById('gp-trad');
  const tomEl = document.getElementById('gp-trad-tom');
  if (!container) return;
  container.innerHTML = '';
  if (tradData.kyrkogardar.length === 0) {
    if (tomEl) tomEl.hidden = false;
    return;
  }
  if (tomEl) tomEl.hidden = true;
  tradData.kyrkogardar.forEach((kg) => {
    const kvarterLista = tradData.kvarter_per_kyrkogard[kg] || [];
    const div = document.createElement('div');
    div.className = 'trad-kyrkogard';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'trad-kyrkogard-btn';
    btn.setAttribute('aria-expanded', 'false');
    const kgAntal = (tradData.antal_per_kyrkogard && tradData.antal_per_kyrkogard[kg]) ?? 0;
    const kgPil = document.createElement('span');
    kgPil.className = 'trad-pil';
    kgPil.setAttribute('aria-hidden', 'true');
    btn.appendChild(kgPil);
    btn.appendChild(document.createTextNode(` ${kg} (${kgAntal})`));
    const ul = document.createElement('ul');
    ul.className = 'trad-kvarter-list';
    ul.hidden = true;
    kvarterLista.forEach((kv) => {
      const li = document.createElement('li');
      const kvWrap = document.createElement('div');
      kvWrap.className = 'trad-kvarter';
      const kvBtn = document.createElement('button');
      kvBtn.type = 'button';
      kvBtn.className = 'trad-kvarter-btn';
      kvBtn.setAttribute('aria-expanded', 'false');
      const kvAntal = (tradData.antal_per_kvarter && tradData.antal_per_kvarter[kg] && tradData.antal_per_kvarter[kg][kv]) ?? 0;
      const pilSpan = document.createElement('span');
      pilSpan.className = 'trad-pil';
      pilSpan.setAttribute('aria-hidden', 'true');
      kvBtn.appendChild(pilSpan);
      kvBtn.appendChild(document.createTextNode(` ${kv} (${kvAntal})`));
      kvBtn.dataset.kyrkogard = kg;
      kvBtn.dataset.kvarter = kv;
      const gpList = document.createElement('ul');
      gpList.className = 'trad-gravplats-list';
      gpList.hidden = true;
      kvBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const expanded = kvBtn.getAttribute('aria-expanded') === 'true';
        kvBtn.setAttribute('aria-expanded', !expanded);
        gpList.hidden = expanded;
        if (!expanded && gpList.children.length === 0) {
          await fyllGravplatsLista(kg, kv, gpList);
        }
      });
      kvWrap.appendChild(kvBtn);
      kvWrap.appendChild(gpList);
      li.appendChild(kvWrap);
      ul.appendChild(li);
    });
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', !expanded);
      ul.hidden = expanded;
    });
    div.appendChild(btn);
    div.appendChild(ul);
    container.appendChild(div);
  });
}

/** Fyller en ul.trad-gravplats-list med gravplatser för kyrkogård+kvarter (hämtar vid behov, cachar). */
async function fyllGravplatsLista(kyrkogard, kvarter, listEl) {
  const cacheKey = `${kyrkogard}\n${kvarter}`;
  if (!gravplatserTradCache[cacheKey]) {
    try {
      const params = new URLSearchParams({ kyrkogard: kyrkogard, kvarter: kvarter });
      const res = await fetch(`${API}/gravplatser?${params}`);
      const data = await res.json();
      gravplatserTradCache[cacheKey] = sorteradLista(data.gravplatser || []);
    } catch (e) {
      gravplatserTradCache[cacheKey] = [];
    }
  }
  const lista = gravplatserTradCache[cacheKey];
  listEl.innerHTML = '';
  lista.forEach((gp, idx) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'trad-gravplats-btn';
    btn.textContent = gp.gravplatsnummer || gp.fullstandigt || `#${idx + 1}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      valjGravplats(kyrkogard, kvarter, lista, idx);
    });
    li.appendChild(btn);
    listEl.appendChild(li);
  });
}

/** Välj en specifik gravplats från trädet – navigera till visaren för den gravplatsen. */
function valjGravplats(kyrkogard, kvarter, lista, index) {
  const gp = lista[Math.max(0, Math.min(index, lista.length - 1))];
  if (!gp) return;
  const slug = slugForGravplats(gp);
  if (slug) window.location.href = '/gravplatser/' + slug;
}

function valjKvarter(kyrkogard, kvarter) {
  valdKyrkogard = kyrkogard;
  valdKvarter = kvarter;
  const tradVy = document.getElementById('gp-trad-vy');
  tradVy.hidden = true;
  tradVy.classList.remove('gravplatser-trad-panel');
  document.getElementById('gp-innehall').hidden = false;
  laddaGravplatserForKvarter();
}

function toggleTradMeny() {
  const tradVy = document.getElementById('gp-trad-vy');
  if (!tradVy) return;
  if (!valdKyrkogard) return; // bara när vi redan har valt kvarter
  const skaVisa = tradVy.hidden;
  tradVy.hidden = !skaVisa;
  if (skaVisa) {
    tradVy.classList.add('gravplatser-trad-panel');
  } else {
    tradVy.classList.remove('gravplatser-trad-panel');
  }
}

async function laddaGravplatserForKvarter(targetGravplatsnummer, tillSista) {
  if (!valdKyrkogard || !valdKvarter) return;
  const innehall = document.getElementById('gp-innehall');
  try {
    const params = new URLSearchParams({ kyrkogard: valdKyrkogard, kvarter: valdKvarter });
    const res = await fetch(`${API}/gravplatser?${params}`);
    const data = await res.json();
    gravplatserLista = sorteradLista(data.gravplatser || []);
    if (targetGravplatsnummer != null && targetGravplatsnummer !== '') {
      const idx = gravplatserLista.findIndex(
        (g) => (g.gravplatsnummer || '').trim() === String(targetGravplatsnummer).trim()
      );
      currentIndex = idx >= 0 ? idx : 0;
    } else if (tillSista && gravplatserLista.length > 0) {
      currentIndex = gravplatserLista.length - 1;
    } else {
      currentIndex = 0;
    }
    await uppdateraVy();
  } catch (e) {
    gravplatserLista = [];
    if (innehall) innehall.querySelector('#gp-rubrik').textContent = 'Kunde inte ladda gravplatser.';
  }
}

async function uppdateraVy() {
  const rubrikEl = document.getElementById('gp-rubrik');
  const halvorEl = document.getElementById('gp-halvor');
  const btnTillbaka = document.getElementById('gp-btn-tillbaka');
  const btnNasta = document.getElementById('gp-btn-nasta');
  if (!rubrikEl || !halvorEl) return;

  const n = gravplatserLista.length;
  if (n === 0) {
    rubrikEl.textContent = `Inga gravplatser i ${valdKyrkogard} ${valdKvarter}.`;
    halvorEl.innerHTML = '';
    if (btnTillbaka) btnTillbaka.disabled = true;
    if (btnNasta) btnNasta.disabled = true;
    currentGravplatsId = null;
    inmatningData = null;
    lastInmatningGravplatsId = null;
    inmatningDirty = false;
    inmatningRedigerar = false;
    const sparaWrap = document.getElementById('gp-inmatning-spara-wrap');
    if (sparaWrap) sparaWrap.hidden = true;
    const redigeraBtn = document.getElementById('gp-btn-redigera');
    if (redigeraBtn) redigeraBtn.textContent = 'Redigera gravplatsen';
    uppdateraInmatningSparaKnapp();
    currentExtramaterial = [];
    currentHalvorUrls = [];
    uppdateraExtramaterialSektion([], null);
    uppdateraInmatningRubrikCounts();
    uppdateraFardigtranskriberadKnapp();
    return;
  }

  const idx = Math.max(0, Math.min(currentIndex, n - 1));
  currentIndex = idx;
  const gp = gravplatserLista[idx];
  currentGravplatsId = gp.id;
  const mappNamn = gp.mapp_namn;

  rubrikEl.textContent = gp.fullstandigt || [gp.kyrkogard, gp.kvarter, gp.gravplatsnummer].filter(Boolean).join(' ') || '–';

  await ensureTradData(gp.kyrkogard);
  const nastaKv = getNastaKvarter(gp.kyrkogard, gp.kvarter);
  const foregaendeKv = getForegaendeKvarter(gp.kyrkogard, gp.kvarter);
  const paSistaGravplats = idx >= n - 1;
  const paForstaGravplats = idx <= 0;

  if (btnTillbaka) {
    btnTillbaka.disabled = paForstaGravplats && !foregaendeKv;
    btnTillbaka.textContent = paForstaGravplats && foregaendeKv ? '← Byt till föregående kvarter' : '← Föregående';
  }
  if (btnNasta) {
    btnNasta.disabled = paSistaGravplats && !nastaKv;
    btnNasta.textContent = paSistaGravplats && nastaKv ? 'Byt till nästa kvarter →' : 'Nästa →';
  }

  const slug = slugForGravplats(gp);
  const path = slug ? `/gravplatser/${slug}` : '/gravplatser';
  const fullUrl = path + (vertikalVy ? '?vy=vertikal' : '');
  if (window.location.pathname + (window.location.search || '') !== fullUrl) {
    history.replaceState(null, '', fullUrl);
  }

  const base = `${API}/mappar/${encodeURIComponent(mappNamn)}/sida`;
  const offsetQ = 'offset=0';
  const cacheQ = `_v=${cacheBust}`;
  const split1och3 = (727 / 1597).toFixed(4);
  const split2 = (870 / 1595).toFixed(4);

  try {
    const params = new URLSearchParams();
    if (gp.kyrkogard) params.set('kyrkogard', gp.kyrkogard);
    if (gp.kvarter) params.set('kvarter', gp.kvarter);
    if (gp.gravplatsnummer) params.set('gravplatsnummer', gp.gravplatsnummer);
    const halvorRes = await fetch(`${API}/mappar/${encodeURIComponent(mappNamn)}/gravplats/halvor?${params}`);
    if (!halvorRes.ok) throw new Error('Kunde inte hämta halvor');
    const halvorData = await halvorRes.json();
    const halvor = halvorData.halvor || [];
    const extramaterial = halvorData.extramaterial || [];
    currentExtramaterial = extramaterial;
    currentExtramaterialMapp = mappNamn;

    const initialUrl = (halvaUrl, helaUrl) => (visarHelaSidor && halvaUrl !== helaUrl ? helaUrl : halvaUrl);

    const halvorMedUrl = halvor.map((h) => {
      let halvaUrl;
      let helaUrl;
      let pdfUrl = null;
      if (h.redan_halva && h.filnamn) {
        halvaUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/fil/${encodeURIComponent(h.filnamn)}/bild?${cacheQ}`;
        helaUrl = halvaUrl;
        pdfUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/fil/${encodeURIComponent(h.filnamn)}`;
      } else {
        const pos = h.content_sida - (gp.start_sida || 0);
        const split = pos === 1 ? split2 : split1och3;
        halvaUrl = `${base}/${h.content_sida}/halva?${offsetQ}&halva=${h.halva}&split=${split}&${cacheQ}`;
        helaUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/sida/${h.content_sida}?${cacheQ}`;
        if (h.filnamn) {
          pdfUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/fil/${encodeURIComponent(h.filnamn)}`;
        }
      }
      return { halvaUrl, helaUrl, pdfUrl };
    });
    currentHalvorUrls = halvorMedUrl.map((x) => initialUrl(x.halvaUrl, x.helaUrl));

    const esc = (s) => (s || '').replace(/"/g, '&quot;');
    halvorEl.innerHTML = halvorMedUrl.map((x, i) => {
      const imgSrc = initialUrl(x.halvaUrl, x.helaUrl);
      const pdfKnapp = x.pdfUrl
        ? `<a href="${x.pdfUrl}" target="_blank" rel="noopener" class="gravplatser-halva-knapp">Öppna PDF</a>`
        : '';
      const h = halvor[i];
      const isRegularHalva = h && h.content_sida != null && h.halva != null;
      const doljKnapp = isRegularHalva
        ? `<button type="button" class="gravplatser-halva-dolj" data-content-sida="${h.content_sida}" data-halva="${esc(h.halva)}" title="Dölj från gravplatsbilderna">Dölj</button>`
        : '';
      const figcapContent = [pdfKnapp, doljKnapp].filter(Boolean).join(' ');
      const figcap = figcapContent ? `<figcaption class="gravplatser-halva-figcap">${figcapContent}</figcaption>` : '';
      return `<figure class="gravplatser-halva" data-halva-url="${esc(x.halvaUrl)}" data-hela-url="${esc(x.helaUrl)}" data-kan-hela="${x.halvaUrl !== x.helaUrl}" data-index="${i}">
        <img src="${imgSrc}" alt="" />
        ${figcap}
      </figure>`;
    }).join('');

    halvorEl.querySelectorAll('.gravplatser-halva-dolj').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const contentSida = parseInt(btn.dataset.contentSida, 10);
        const halva = btn.dataset.halva;
        if (isNaN(contentSida) || !halva || currentGravplatsId == null) return;
        try {
          const res = await fetch(`${API}/gravplats/${currentGravplatsId}/dold-halva`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content_sida: contentSida, halva: halva }),
          });
          if (!res.ok) throw new Error('Kunde inte uppdatera');
          await uppdateraVy();
        } catch (err) {
          alert('Kunde inte uppdatera: ' + (err.message || 'nätverksfel'));
        }
      });
    });

    uppdateraToggleHelaKnapp();
    uppdateraExtramaterialSektion(extramaterial, mappNamn);
    const dolda = halvorData.dolda || [];
    uppdateraDoldaSektion(dolda, mappNamn, gp.start_sida, extramaterial.length);
    uppdateraOcrKnapp();
  } catch (e) {
    halvorEl.innerHTML = '<p class="gravplatser-fel">Kunde inte ladda halvor: ' + e.message + '</p>';
    currentExtramaterial = [];
    currentHalvorUrls = [];
    uppdateraExtramaterialSektion([], null);
    uppdateraDoldaSektion([], null, null, 0);
  }
  inmatningDirty = false;
  uppdateraInmatningSparaKnapp();
  uppdateraInmatningSektionerVidGravplatsbyte();
}

/** I visa-läget: fäll ut alla inmatningssektioner (aria-expanded, innehall synlig). */
function expandAllInmatningSektioner() {
  const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
  sektioner.forEach((s) => {
    const btn = document.querySelector(`.gp-sektion-rubrik[data-sektion="${s}"]`);
    const innehall = document.getElementById(`gp-innehall-${s}`);
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (innehall) innehall.hidden = false;
  });
}

/** Vid gravplatsbyte: invalidera inmatningscache och återrendera öppna sektioner med ny gravplats data. */
async function uppdateraInmatningSektionerVidGravplatsbyte() {
  if (currentGravplatsId == null) {
    inmatningData = null;
    lastInmatningGravplatsId = null;
    uppdateraFardigtranskriberadKnapp();
    return;
  }
  inmatningData = null;
  lastInmatningGravplatsId = null;
  inmatningDirty = false;
  inmatningRedigerar = false;
  const sparaWrap = document.getElementById('gp-inmatning-spara-wrap');
  if (sparaWrap) sparaWrap.hidden = true;
  const redigeraBtn = document.getElementById('gp-btn-redigera');
  if (redigeraBtn) redigeraBtn.textContent = 'Redigera gravplatsen';
  expandAllInmatningSektioner();
  uppdateraInmatningSparaKnapp();
  uppdateraInmatningRubrikCounts();
  const ok = await ensureInmatningData();
  if (ok) {
    const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
    sektioner.forEach((s) => renderInmatningSektion(s));
  }
  uppdateraFardigtranskriberadKnapp();
}

function uppdateraExtramaterialSektion(extramaterial, mappNamn) {
  const rubrikBtn = document.getElementById('gp-em-rubrik');
  const innehallEl = document.getElementById('gp-em-innehall');
  const miniatyrerEl = document.getElementById('gp-em-miniatyrer');
  if (!rubrikBtn || !innehallEl || !miniatyrerEl) return;

  const n = extramaterial.length;
  rubrikBtn.textContent = `Extramaterial (${n})`;
  rubrikBtn.disabled = n === 0;
  rubrikBtn.setAttribute('aria-expanded', 'false');
  innehallEl.hidden = true;

  if (n === 0) {
    miniatyrerEl.innerHTML = '';
    return;
  }

  const cacheQ = `_v=${cacheBust}`;
  miniatyrerEl.innerHTML = extramaterial.map((em, i) => {
    const bildUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/fil/${encodeURIComponent(em.filnamn)}/bild?${cacheQ}`;
    const esc = (s) => (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const redanHalva = em.redan_halva === true;
    const knappText = redanHalva ? 'Endast i extramaterial' : 'Visa som gravplatsbild';
    return `<div class="gp-em-item">
      <button type="button" class="gp-em-miniatyr" data-em-index="${i}" data-bild-url="${esc(bildUrl)}" title="${esc(em.filnamn)}">
        <img src="${bildUrl}" alt="${esc(em.filnamn)}" loading="lazy" />
      </button>
      <div class="gp-em-knapprad">
        <button type="button" class="gp-em-visa-som-grav" data-em-id="${em.id}" data-redan-halva="${redanHalva ? '1' : '0'}" title="${redanHalva ? 'Ta bort från gravplatsbilderna' : 'Lägg till bland gravplatsbilderna'}">${esc(knappText)}</button>
      </div>
    </div>`;
  }).join('');

  miniatyrerEl.querySelectorAll('.gp-em-miniatyr').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.bildUrl;
      const idx = parseInt(btn.dataset.emIndex, 10);
      if (url != null && !isNaN(idx)) openLightbox(idx);
    });
  });

  miniatyrerEl.querySelectorAll('.gp-em-visa-som-grav').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const emId = btn.dataset.emId;
      const redanHalva = btn.dataset.redanHalva === '1';
      if (!emId || !currentExtramaterialMapp) return;
      try {
        const res = await fetch(`${API}/mappar/${encodeURIComponent(currentExtramaterialMapp)}/extramaterial/${emId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ redan_halva: !redanHalva }),
        });
        if (!res.ok) throw new Error('Kunde inte uppdatera');
        await uppdateraVy();
      } catch (err) {
        alert('Kunde inte uppdatera: ' + (err.message || 'nätverksfel'));
      }
    });
  });
}

function uppdateraDoldaSektion(dolda, mappNamn, startSida, extramaterialCount) {
  const rubrikBtn = document.getElementById('gp-em-rubrik');
  const doldaRubrikBtn = document.getElementById('gp-em-dolda-rubrik');
  const innehallEl = document.getElementById('gp-em-dolda-innehall');
  const miniatyrerEl = document.getElementById('gp-em-dolda-miniatyrer');
  if (!doldaRubrikBtn || !innehallEl || !miniatyrerEl) return;

  const n = dolda.length;
  if (rubrikBtn) {
    const emCount = extramaterialCount ?? 0;
    rubrikBtn.textContent = n === 0
      ? `Extramaterial (${emCount})`
      : `Extramaterial (${emCount}), Dolda (${n})`;
    rubrikBtn.disabled = emCount + n === 0;
  }
  doldaRubrikBtn.textContent = `Dolda (${n})`;
  doldaRubrikBtn.disabled = n === 0;
  doldaRubrikBtn.setAttribute('aria-expanded', 'false');
  innehallEl.hidden = true;

  if (n === 0) {
    miniatyrerEl.innerHTML = '';
    return;
  }

  const cacheQ = `_v=${cacheBust}`;
  const split1och3 = (727 / 1597).toFixed(4);
  const split2 = (870 / 1595).toFixed(4);
  const base = mappNamn ? `${API}/mappar/${encodeURIComponent(mappNamn)}/sida` : '';

  miniatyrerEl.innerHTML = dolda.map((item) => {
    const esc = (s) => (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    if (item.type === 'halva' && item.content_sida != null && item.halva != null) {
      const pos = startSida != null ? item.content_sida - startSida : 0;
      const split = pos === 1 ? split2 : split1och3;
      const bildUrl = base
        ? `${base}/${item.content_sida}/halva?offset=0&halva=${encodeURIComponent(item.halva)}&split=${split}&${cacheQ}`
        : '';
      return `<div class="gp-em-item" data-dold-type="halva">
        <button type="button" class="gp-em-miniatyr gp-em-dolda-miniatyr" data-bild-url="${esc(bildUrl)}" title="Sida ${item.content_sida} ${item.halva}">
          <img src="${bildUrl}" alt="" loading="lazy" />
        </button>
        <button type="button" class="gp-em-visa-som-grav gp-em-visa-igen" data-dold-type="halva" data-content-sida="${item.content_sida}" data-halva="${esc(item.halva)}" title="Visa igen bland gravplatsbilderna">Visa igen</button>
      </div>`;
    }
    const bildUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/fil/${encodeURIComponent(item.filnamn)}/bild?${cacheQ}`;
    return `<div class="gp-em-item" data-dold-type="extramaterial">
      <button type="button" class="gp-em-miniatyr gp-em-dolda-miniatyr" data-bild-url="${esc(bildUrl)}" title="${esc(item.filnamn)}">
        <img src="${bildUrl}" alt="${esc(item.filnamn)}" loading="lazy" />
      </button>
      <button type="button" class="gp-em-visa-som-grav gp-em-visa-igen" data-dold-type="extramaterial" data-em-id="${item.id}" title="Visa igen bland gravplatsbilderna">Visa igen</button>
    </div>`;
  }).join('');

  miniatyrerEl.querySelectorAll('.gp-em-visa-igen').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const type = btn.dataset.doldType;
      if (type === 'halva') {
        const contentSida = parseInt(btn.dataset.contentSida, 10);
        const halva = btn.dataset.halva;
        if (isNaN(contentSida) || !halva || currentGravplatsId == null) return;
        try {
          const res = await fetch(
            `${API}/gravplats/${currentGravplatsId}/dold-halva?content_sida=${contentSida}&halva=${encodeURIComponent(halva)}`,
            { method: 'DELETE' }
          );
          if (!res.ok) throw new Error('Kunde inte uppdatera');
          await uppdateraVy();
        } catch (err) {
          alert('Kunde inte uppdatera: ' + (err.message || 'nätverksfel'));
        }
      } else {
        const emId = btn.dataset.emId;
        if (!emId || !currentExtramaterialMapp) return;
        try {
          const res = await fetch(`${API}/mappar/${encodeURIComponent(currentExtramaterialMapp)}/extramaterial/${emId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dold: false }),
          });
          if (!res.ok) throw new Error('Kunde inte uppdatera');
          await uppdateraVy();
        } catch (err) {
          alert('Kunde inte uppdatera: ' + (err.message || 'nätverksfel'));
        }
      }
    });
  });
}

function toggleDoldaInnehall() {
  const rubrikBtn = document.getElementById('gp-em-dolda-rubrik');
  const innehallEl = document.getElementById('gp-em-dolda-innehall');
  if (!rubrikBtn || !innehallEl || rubrikBtn.disabled) return;
  const expanded = rubrikBtn.getAttribute('aria-expanded') === 'true';
  rubrikBtn.setAttribute('aria-expanded', !expanded);
  innehallEl.hidden = expanded;
}

function toggleExtramaterialInnehall() {
  const rubrikBtn = document.getElementById('gp-em-rubrik');
  const innehallEl = document.getElementById('gp-em-innehall');
  if (!rubrikBtn || !innehallEl || rubrikBtn.disabled) return;
  const expanded = rubrikBtn.getAttribute('aria-expanded') === 'true';
  rubrikBtn.setAttribute('aria-expanded', !expanded);
  innehallEl.hidden = expanded;
}

let lightboxIndex = 0;
/** 'extramaterial' | 'halvor' – vilken källa lightboxen visar. */
let lightboxMode = 'extramaterial';
/** Vid mode 'halvor': URL:er för aktuell gravplatsens bilder. */
let lightboxHalvorUrls = [];

function uppdateraLightboxKnappar() {
  const prevBtn = document.getElementById('gp-lightbox-prev');
  const nextBtn = document.getElementById('gp-lightbox-next');
  const n = lightboxMode === 'halvor' ? lightboxHalvorUrls.length : currentExtramaterial.length;
  if (prevBtn) prevBtn.disabled = n <= 1;
  if (nextBtn) nextBtn.disabled = n <= 1;
}

function openLightbox(index) {
  if (currentExtramaterial.length === 0 || !currentExtramaterialMapp) return;
  lightboxMode = 'extramaterial';
  const idx = Math.max(0, Math.min(index, currentExtramaterial.length - 1));
  lightboxIndex = idx;
  const em = currentExtramaterial[idx];
  const bildUrl = `${API}/mappar/${encodeURIComponent(currentExtramaterialMapp)}/fil/${encodeURIComponent(em.filnamn)}/bild?_v=${cacheBust}`;
  const lightbox = document.getElementById('gp-lightbox');
  const imgEl = document.getElementById('gp-lightbox-img');
  if (lightbox && imgEl) {
    imgEl.src = bildUrl;
    imgEl.alt = em.filnamn;
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
  const lightbox = document.getElementById('gp-lightbox');
  const imgEl = document.getElementById('gp-lightbox-img');
  if (lightbox && imgEl) {
    imgEl.src = lightboxHalvorUrls[lightboxIndex];
    imgEl.alt = '';
    lightbox.hidden = false;
    uppdateraLightboxKnappar();
  }
}

function closeLightbox() {
  const lightbox = document.getElementById('gp-lightbox');
  if (lightbox) lightbox.hidden = true;
}

function lightboxPrev() {
  const n = lightboxMode === 'halvor' ? lightboxHalvorUrls.length : currentExtramaterial.length;
  if (n <= 1) return;
  lightboxIndex = (lightboxIndex - 1 + n) % n;
  if (lightboxMode === 'halvor') {
    const imgEl = document.getElementById('gp-lightbox-img');
    if (imgEl) imgEl.src = lightboxHalvorUrls[lightboxIndex];
  } else {
    openLightbox(lightboxIndex);
  }
}

function lightboxNext() {
  const n = lightboxMode === 'halvor' ? lightboxHalvorUrls.length : currentExtramaterial.length;
  if (n <= 1) return;
  lightboxIndex = (lightboxIndex + 1) % n;
  if (lightboxMode === 'halvor') {
    const imgEl = document.getElementById('gp-lightbox-img');
    if (imgEl) imgEl.src = lightboxHalvorUrls[lightboxIndex];
  } else {
    openLightbox(lightboxIndex);
  }
}

function uppdateraToggleHelaKnapp() {
  const btn = document.getElementById('gp-btn-toggle-hela');
  if (!btn) return;
  const harNagonHela = document.querySelectorAll('.gravplatser-halva[data-kan-hela="true"]').length > 0;
  btn.hidden = !harNagonHela;
  btn.textContent = visarHelaSidor ? 'Visa halva' : 'Visa hela sidan';
}

function toggleVertikalVy() {
  vertikalVy = !vertikalVy;
  const innehall = document.getElementById('gp-innehall');
  const btn = document.getElementById('gp-btn-vy');
  if (innehall) innehall.classList.toggle('gp-vertikal-vy', vertikalVy);
  if (btn) btn.textContent = vertikalVy ? 'Horisontell vy' : 'Vertikal vy';
  const path = window.location.pathname;
  const fullUrl = path + (vertikalVy ? '?vy=vertikal' : '');
  history.replaceState(null, '', fullUrl);
}

function toggleHelaSidor() {
  const halvorEl = document.getElementById('gp-halvor');
  if (!halvorEl) return;
  visarHelaSidor = !visarHelaSidor;
  halvorEl.querySelectorAll('.gravplatser-halva[data-kan-hela="true"]').forEach((fig) => {
    const img = fig.querySelector('img');
    if (!img) return;
    img.src = visarHelaSidor ? fig.dataset.helaUrl : fig.dataset.halvaUrl;
  });
  uppdateraToggleHelaKnapp();
}

function tillbaka() {
  if (currentIndex > 0) {
    currentIndex--;
    uppdateraVy();
  }
}

function nasta() {
  if (currentIndex < gravplatserLista.length - 1) {
    currentIndex++;
    uppdateraVy();
  }
}

/** Returnerar nästa kvarter på angiven kyrkogård, eller null. Om kyrkogard/kvarter utelämnas används valdKyrkogard/valdKvarter. */
function getNastaKvarter(kyrkogard, kvarter) {
  const kg = (kyrkogard != null ? kyrkogard : valdKyrkogard) || '';
  const kv = (kvarter != null ? kvarter : valdKvarter) || '';
  if (!kg || !kv) return null;
  const lista = getKvarterListaForKyrkogard(kg);
  const vald = String(kv).trim();
  const i = lista.findIndex((k) => kvarterMatch((k || '').trim(), vald));
  return i >= 0 && i < lista.length - 1 ? (lista[i + 1] || '').trim() : null;
}

/** Returnerar föregående kvarter på angiven kyrkogård, eller null. */
function getForegaendeKvarter(kyrkogard, kvarter) {
  const kg = (kyrkogard != null ? kyrkogard : valdKyrkogard) || '';
  const kv = (kvarter != null ? kvarter : valdKvarter) || '';
  if (!kg || !kv) return null;
  const lista = getKvarterListaForKyrkogard(kg);
  const vald = String(kv).trim();
  const i = lista.findIndex((k) => kvarterMatch((k || '').trim(), vald));
  return i > 0 ? (lista[i - 1] || '').trim() : null;
}

/** Jämför två kvartersträngar (t.ex. "01" och "1" räknas som samma). */
function kvarterMatch(a, b) {
  if (a === b) return true;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return parseInt(a, 10) === parseInt(b, 10);
  return false;
}

/** Hämtar kvarterlistan för kyrkogård (från tradData). Matchar kyrkogårdsnyckel med trim. */
function getKvarterListaForKyrkogard(kyrkogard) {
  const k = (kyrkogard || '').trim();
  if (!k) return [];
  const raw = tradData.kvarter_per_kyrkogard[kyrkogard] || tradData.kvarter_per_kyrkogard[k];
  if (Array.isArray(raw)) return raw;
  const key = Object.keys(tradData.kvarter_per_kyrkogard || {}).find(
    (kk) => (kk || '').trim().toLowerCase() === k.toLowerCase()
  );
  return key ? (tradData.kvarter_per_kyrkogard[key] || []) : [];
}

/** Ser till att tradData har kvarterlistan för kyrkogården (hämtar trädet vid behov). */
let tradDataLaddas = null;
async function ensureTradData(kyrkogard) {
  const kg = (kyrkogard || valdKyrkogard || '').trim();
  if (!kg) return;
  const lista = getKvarterListaForKyrkogard(kg);
  if (lista.length > 0) return;
  if (tradDataLaddas) return tradDataLaddas;
  tradDataLaddas = fetchTradData();
  await tradDataLaddas;
  tradDataLaddas = null;
}

/** Byt till nästa kvarter (första gravplatsen). Endast vid klick – inte piltangent. */
async function bytTillNastaKvarter() {
  const nastaKv = getNastaKvarter();
  if (!nastaKv) return;
  valdKvarter = nastaKv;
  await laddaGravplatserForKvarter();
}

/** Byt till föregående kvarter (sista gravplatsen). Endast vid klick – inte piltangent. */
async function bytTillForegaendeKvarter() {
  const foregaende = getForegaendeKvarter();
  if (!foregaende) return;
  valdKvarter = foregaende;
  await laddaGravplatserForKvarter(null, true);
}

/** OCR: visa overlay på figuren, användaren drar rektangel, kör Tesseract på crop och visar modal.
 * Om initialEvent anges (mousedown på bilden) startar markeringen direkt med den punkten. */
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

  function onUp(e) {
    document.removeEventListener('mousemove', onMove);
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
    runOcr(halvaUrl, rectNatural).then((text) => {
      const trimmed = (text || '').trim();
      if (!ocrTargetElement) return;
      if (trimmed === '') {
        if (arDatumFaltForOcr(ocrTargetElement)) return;
        ocrNamnLage = null;
        visaIkonSomTomExtrahering();
        return;
      }
      if (ocrNamnLage) {
        const lage = ocrNamnLage;
        ocrNamnLage = null;
        const normaliserad = trimmed.replace(/\s+/g, ' ').trim();
        const parts = normaliserad.split(/\s+/).filter(Boolean);
        if (parts.length === 2) {
          const par = getNamnParFalt(ocrTargetElement);
          if (par && ocrTargetElement) {
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
        showOcrModalNamnSplit(normaliserad, lage);
        return;
      }
      if (arDatumFaltForOcr(ocrTargetElement)) {
        const normaliserat = normaliseraUtfordatDen(trimmed);
        ocrTargetElement.value = normaliserat || '';
        ocrTargetElement.focus();
        const len = ocrTargetElement.value.length;
        try {
          ocrTargetElement.setSelectionRange(len, len);
        } catch (_) {}
        markInmatningDirty();
        if (ocrTargetElement.tagName === 'TEXTAREA') autoExpandTextarea(ocrTargetElement);
      } else {
        infogaOcrIFalt(trimmed);
      }
    }).catch((err) => {
      alert('OCR misslyckades: ' + (err && err.message ? err.message : 'okänt fel'));
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
 * Accepterar t.ex. DD/MM/YYYY, DD.MM.YYYY, DD/MM YYYY, YYYY-MM-DD, månadsnamn + år.
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

  return s;
}

/** Visar textextraheringsikonen i rött bredvid aktuellt fält när ingen text kunde extraheras. */
function visaIkonSomTomExtrahering() {
  if (!ocrTargetElement || !ocrFaltIkonBtn) return;
  ocrFaltIkonBtn.classList.add('gp-ocr-falt-ikon-fel');
  ocrFaltIkonBtn.remove();
  ocrFaltIkonBtn.title = 'Ingen text kunde extraheras – försök igen';
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
    group.appendChild(ocrFaltIkonBtn);
    if (window.gpOcrBtnEf) group.appendChild(window.gpOcrBtnEf);
    if (window.gpOcrBtnFe) group.appendChild(window.gpOcrBtnFe);
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
  document.getElementById('gp-ocr-modal-namn')?.setAttribute('hidden', '');
  document.getElementById('gp-ocr-modal-hint')?.removeAttribute('hidden');
  document.getElementById('gp-ocr-modal-text')?.removeAttribute('hidden');
  let text = extractedText;
  if (ocrTargetElement && arDatumFaltForOcr(ocrTargetElement)) {
    text = normaliseraUtfordatDen(text);
  }
  textarea.value = text;
  modal.hidden = false;
  textarea.focus();
  autoExpandTextarea(textarea);
}

function showOcrModalNamnSplit(text, lage) {
  const modal = document.getElementById('gp-ocr-modal');
  const namnWrap = document.getElementById('gp-ocr-modal-namn');
  const namnTextEl = document.getElementById('gp-ocr-namn-text');
  const rubrikEl = document.getElementById('gp-ocr-modal-rubrik');
  const hintEl = document.getElementById('gp-ocr-modal-hint');
  const textarea = document.getElementById('gp-ocr-modal-text');
  const knapparEl = document.getElementById('gp-ocr-modal-knappar');
  if (!modal || !namnWrap || !namnTextEl) return;
  ocrModalNamnLage = lage;
  hintEl?.setAttribute('hidden', '');
  textarea?.setAttribute('hidden', '');
  if (knapparEl) knapparEl.setAttribute('hidden', '');
  namnWrap.removeAttribute('hidden');
  if (rubrikEl) rubrikEl.textContent = lage === 'ef' ? 'Dela namn (Efternamn, Förnamn)' : 'Dela namn (Förnamn, Efternamn)';
  namnTextEl.innerHTML = '';
  const n = text.length;
  const applyAndClose = (splitIndex) => {
    const par = getNamnParFalt(ocrTargetElement);
    if (par && ocrTargetElement) {
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
  if (ocrModalNamnLage) {
    ocrModalNamnLage = null;
    ocrNamnSplitIndex = null;
    if (namnWrap) namnWrap.setAttribute('hidden', '');
    if (rubrikEl) rubrikEl.textContent = 'Extraherad text';
    document.getElementById('gp-ocr-modal-hint')?.removeAttribute('hidden');
    textarea.removeAttribute('hidden');
    document.getElementById('gp-ocr-modal-knappar')?.removeAttribute('hidden');
    modal.hidden = true;
    return;
  }
  if (anvand && ocrTargetElement) {
    let value = textarea.value;
    if (arDatumFaltForOcr(ocrTargetElement)) {
      value = normaliseraUtfordatDen(value);
    }
    ocrTargetElement.value = value;
    if (ocrTargetElement.tagName === 'TEXTAREA') autoExpandTextarea(ocrTargetElement);
    markInmatningDirty();
  }
  modal.hidden = true;
}

document.getElementById('gp-btn-tillbaka-kvarter')?.addEventListener('click', () => {
  window.location.href = '/gravplatser';
});
document.getElementById('gp-btn-tillbaka')?.addEventListener('click', () => {
  const foregaendeKv = getForegaendeKvarter();
  if (currentIndex <= 0 && foregaendeKv) {
    bytTillForegaendeKvarter();
  } else {
    tillbaka();
  }
});
document.getElementById('gp-btn-nasta')?.addEventListener('click', () => {
  const nastaKv = getNastaKvarter();
  if (currentIndex >= gravplatserLista.length - 1 && nastaKv) {
    bytTillNastaKvarter();
  } else {
    nasta();
  }
});
document.getElementById('gp-btn-toggle-hela')?.addEventListener('click', toggleHelaSidor);
document.getElementById('gp-btn-vy')?.addEventListener('click', toggleVertikalVy);

document.getElementById('gp-em-rubrik')?.addEventListener('click', toggleExtramaterialInnehall);
document.getElementById('gp-em-dolda-rubrik')?.addEventListener('click', toggleDoldaInnehall);

document.getElementById('gp-inmatning')?.addEventListener('pointerdown', (e) => {
  if (e.target.matches('input, textarea') && !e.target.matches('input[type="checkbox"], input[type="radio"], select')) {
    focusViaPointer = true;
    if (document.activeElement === e.target) {
      ocrTargetElement = e.target;
      visaOcrIkonForFalt(e.target);
    }
  }
});

document.getElementById('gp-inmatning')?.addEventListener('focusin', (e) => {
  if (!e.target.matches('input, textarea')) return;
  ocrTargetElement = e.target;
  if (e.target.matches('input[type="checkbox"], input[type="radio"], select')) return;
  if (!inmatningRedigerar || !e.target.closest('#gp-inmatning')) return;
  if (!focusViaPointer) return;
  focusViaPointer = false;
  visaOcrIkonForFalt(e.target);
});

document.getElementById('gp-inmatning')?.addEventListener('input', (e) => {
  if (e.target.matches('textarea.gp-falt-expanderbar')) autoExpandTextarea(e.target);
});

document.getElementById('gp-inmatning')?.addEventListener('focusout', (e) => {
  if (!e.target.matches('input, textarea')) return;
  const inmatning = document.getElementById('gp-inmatning');
  const next = e.relatedTarget;
  if (next && inmatning && (inmatning.contains(next) || next === ocrFaltIkonBtn || next === window.gpOcrBtnEf || next === window.gpOcrBtnFe)) return;
  if (!ocrFaltIkonBtn?.parentElement) return;
  let wrapToUnwrap = ocrFaltIkonBtn.parentElement;
  if (wrapToUnwrap.classList?.contains('gp-ocr-falt-ikon-grupp')) wrapToUnwrap = wrapToUnwrap.parentElement;
  if (wrapToUnwrap?.classList?.contains('gp-ocr-falt-wrap')) {
    unwrapOcrFaltWrap(wrapToUnwrap);
  }
  uppdateraOcrKnapp();
});

document.getElementById('gp-btn-ocr-omrade')?.addEventListener('click', () => {
  if (ocrVantarPaBild) {
    ocrVantarPaBild = false;
    uppdateraOcrKnapp();
    return;
  }
  if (!ocrTargetElement) return;
  ocrVantarPaBild = true;
  uppdateraOcrKnapp();
});

document.getElementById('gp-halvor')?.addEventListener('mousedown', (e) => {
  if (!ocrVantarPaBild) return;
  if (e.target.closest('.gravplatser-halva-figcap')) return;
  const fig = e.target.closest('.gravplatser-halva');
  if (!fig) return;
  e.preventDefault();
  e.stopPropagation();
  ocrVantarPaBild = false;
  uppdateraOcrKnapp();
  startOcrOverlay(fig, e);
});

document.getElementById('gp-halvor')?.addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const fig = e.target.closest('.gravplatser-halva');
  if (!fig) return;
  if (ocrJustAvslutad) {
    ocrJustAvslutad = false;
    return;
  }
  if (e.target.closest('.gravplatser-halva-figcap')) return;
  const imgEl = fig.querySelector('img');
  if (e.target !== imgEl) return;
  const idx = fig.getAttribute('data-index');
  if (idx != null && idx !== '') openLightboxHalvor(parseInt(idx, 10));
});

document.getElementById('gp-lightbox-stang')?.addEventListener('click', closeLightbox);
document.getElementById('gp-lightbox-prev')?.addEventListener('click', lightboxPrev);
document.getElementById('gp-lightbox-next')?.addEventListener('click', lightboxNext);
document.getElementById('gp-lightbox')?.addEventListener('click', (e) => {
  if (e.target.id === 'gp-lightbox') closeLightbox();
});
document.getElementById('gp-ocr-anvand')?.addEventListener('click', () => closeOcrModal(true));
document.getElementById('gp-ocr-avbryt')?.addEventListener('click', () => closeOcrModal(false));
document.getElementById('gp-ocr-modal-text')?.addEventListener('input', function () {
  autoExpandTextarea(this);
});
document.getElementById('gp-ocr-modal')?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeOcrModal(false);
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (ocrModalNamnLage && ocrNamnSplitIndex == null) closeOcrModal(false);
    else closeOcrModal(true);
  }
});
document.addEventListener('keydown', (e) => {
  const lb = document.getElementById('gp-lightbox');
  if (lb && !lb.hidden) {
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') { lightboxPrev(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { lightboxNext(); e.preventDefault(); }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName.toUpperCase())) return;
  if (!document.getElementById('gp-innehall') || document.getElementById('gp-innehall').hidden) return;
  const lb = document.getElementById('gp-lightbox');
  if (lb && !lb.hidden) return;
  if (e.key === 'ArrowLeft') {
    if (currentIndex > 0) tillbaka();
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    if (currentIndex < gravplatserLista.length - 1) nasta();
    e.preventDefault();
  }
});

function esc(s) {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

async function ensureInmatningData() {
  if (currentGravplatsId == null) return false;
  if (lastInmatningGravplatsId === currentGravplatsId && inmatningData) return true;
  const idForFetch = currentGravplatsId;
  try {
    const res = await fetch(`${API}/gravplats/${idForFetch}/inmatning`);
    if (!res.ok) throw new Error('Kunde inte hämta inmatning');
    const data = await res.json();
    // Acceptera endast data för aktuell gravplats (undvik att visa 1+2:s data på 3 vid snabb navigering)
    if (data.gravplats_id != null && data.gravplats_id !== currentGravplatsId) return false;
    inmatningData = data;
    lastInmatningGravplatsId = currentGravplatsId;
    uppdateraInmatningRubrikCounts();
    uppdateraFardigtranskriberadKnapp();
    return true;
  } catch (e) {
    return false;
  }
}

/** Uppdatera rubrikknapparna för Gravrättsinnehavare, Närmast anhöriga och Gravsatta med antal (N). */
function uppdateraInmatningRubrikCounts() {
  const root = document.getElementById('gp-inmatning');
  if (!root) return;
  const nInnehavare = root.querySelectorAll('.gp-innehavare-rad').length || (inmatningData && (inmatningData.innehavare || []).length) || 0;
  const nAnhoriga = root.querySelectorAll('.gp-na-rad').length || (inmatningData && (inmatningData.narmast_anhoriga || []).length) || 0;
  const nGravsatta = root.querySelectorAll('.gp-gravsatt-block').length || (inmatningData && (inmatningData.gravsatta || []).length) || 0;
  const setRubrik = (sektion, text) => {
    const btn = document.querySelector(`.gp-sektion-rubrik[data-sektion="${sektion}"]`);
    if (btn) btn.textContent = text;
  };
  setRubrik('innehavare', `Gravrättsinnehavare (${nInnehavare})`);
  setRubrik('narmast_anhoriga', `Närmast anhöriga (${nAnhoriga})`);
  setRubrik('gravsatta', `Gravsatta (${nGravsatta})`);
}

function uppdateraInmatningSparaKnapp() {
  const btn = document.getElementById('gp-inmatning-spara');
  if (btn) btn.disabled = !inmatningDirty;
}

function uppdateraFardigtranskriberadKnapp() {
  const btn = document.getElementById('gp-btn-fardigtranskriberad');
  if (!btn) return;
  const arFardig = inmatningData && inmatningData.fardigtranskriberad === true;
  btn.classList.remove('gp-fardigtranskriberad-ja', 'gp-fardigtranskriberad-nej');
  btn.classList.add(arFardig ? 'gp-fardigtranskriberad-ja' : 'gp-fardigtranskriberad-nej');
  btn.textContent = arFardig ? 'Färdigtranskriberad' : 'Ej färdigtranskriberad';
  btn.disabled = currentGravplatsId == null || !inmatningRedigerar;
  uppdateraOcrKnapp();
}

function uppdateraOcrKnapp() {
  const btn = document.getElementById('gp-btn-ocr-omrade');
  const halvorEl = document.getElementById('gp-halvor');
  const harHalvor = halvorEl && halvorEl.querySelectorAll('.gravplatser-halva').length > 0;
  const kanStarta = !!ocrTargetElement && inmatningRedigerar && currentGravplatsId != null && harHalvor;
  const iconSynlig = ocrFaltIkonBtn && ocrFaltIkonBtn.parentElement != null;
  document.body.classList.toggle('gp-ocr-vantar-pa-bild', ocrVantarPaBild);
  if (btn) {
    btn.disabled = !kanStarta && !ocrVantarPaBild;
    btn.textContent = ocrVantarPaBild ? 'Avbryt' : 'Markera område på bild';
    btn.hidden = iconSynlig;
  }
  if (ocrFaltIkonBtn) {
    ocrFaltIkonBtn.disabled = !kanStarta && !ocrVantarPaBild;
    ocrFaltIkonBtn.title = ocrVantarPaBild ? 'Avbryt' : 'Markera område på bild';
  }
}

function markInmatningDirty() {
  inmatningDirty = true;
  uppdateraInmatningSparaKnapp();
}

function toggleInmatningSektion(sektion) {
  const btn = document.querySelector(`.gp-sektion-rubrik[data-sektion="${sektion}"]`);
  const innehall = document.getElementById(`gp-innehall-${sektion}`);
  if (!btn || !innehall) return;
  const expanded = btn.getAttribute('aria-expanded') === 'true';
  if (expanded) {
    btn.setAttribute('aria-expanded', 'false');
    innehall.hidden = true;
    return;
  }
  if (currentGravplatsId == null) return;
  ensureInmatningData().then((ok) => {
    if (ok) {
      renderInmatningSektion(sektion);
    } else {
      innehall.innerHTML = '<p class="gravplatser-fel">Kunde inte ladda.</p>';
    }
    btn.setAttribute('aria-expanded', 'true');
    innehall.hidden = false;
  });
}

/** Läsvy: rendera sektionens innehåll som text/layout utan formulärfält. Tomma fält visas inte. */
function renderInmatningSektionLäs(sektion) {
  const d = inmatningData || {};
  const innehall = document.getElementById(`gp-innehall-${sektion}`);
  if (!innehall) return;
  const v = (x) => (x != null && String(x).trim() !== '' ? esc(String(x).trim()) : '');
  /** Returnerar rad-HTML endast om value har innehåll (efter trim). */
  const radOmFyllt = (label, value) => {
    const val = value != null && String(value).trim() !== '' ? String(value).trim() : '';
    if (!val) return '';
    return `<div class="gp-las-rad"><span class="gp-las-label">${esc(label)}</span><span class="gp-las-varde">${esc(val)}</span></div>`;
  };

  if (sektion === 'innehavare') {
    const inv = d.innehavare || [];
    if (inv.length === 0) {
      innehall.innerHTML = '';
      return;
    }
    innehall.innerHTML = '<div class="gp-inmatning-las"><ul class="gp-las-lista">' + inv.map((i) => {
      const fn = v(i.fornamn); const en = v(i.efternamn); const yrke = v(i.yrke); const adr = v(i.adress);
      const namn = [fn, en].filter(Boolean).join(' ') || '';
      const rader = radOmFyllt('Namn', namn) +
        radOmFyllt('Yrke', i.yrke) +
        radOmFyllt('Adress', i.adress) +
        radOmFyllt('Kommentar', i.kommentar);
      if (!rader) return '<li class="gp-las-kort"><span class="gp-las-tom">—</span></li>';
      return `<li class="gp-las-kort">${rader}</li>`;
    }).join('') + '</ul></div>';
    return;
  }

  if (sektion === 'narmast_anhoriga') {
    const na = d.narmast_anhoriga || [];
    if (na.length === 0) {
      innehall.innerHTML = '';
      return;
    }
    innehall.innerHTML = '<div class="gp-inmatning-las"><ul class="gp-las-lista">' + na.map((n) => {
      const fn = v(n.fornamn); const en = v(n.efternamn);
      const namn = [fn, en].filter(Boolean).join(' ') || '';
      const postOrt = [n.postnummer, n.postort].filter(Boolean).join(' ').trim();
      const rader = radOmFyllt('Namn', namn) +
        radOmFyllt('Gatuadress', n.adress) +
        radOmFyllt('Postnummer / ort', postOrt || null) +
        radOmFyllt('Telefon', n.telefon) +
        radOmFyllt('Kommentar', n.kommentar);
      if (!rader) return '<li class="gp-las-kort"><span class="gp-las-tom">—</span></li>';
      return `<li class="gp-las-kort">${rader}</li>`;
    }).join('') + '</ul></div>';
    return;
  }

  if (sektion === 'gravplatsen') {
    const rader = radOmFyllt('Underhåll inbetalt för all framtid den', d.underhall_text) +
      (d.underhall_overstruket ? '<div class="gp-las-rad"><span class="gp-las-label"></span><span class="gp-las-varde">"För all framtid" överstruket</span></div>' : '') +
      radOmFyllt('Gravrättstid', d.gravrattstid) +
      radOmFyllt('Monument', d.monument) +
      radOmFyllt('Gravens utformning', d.gravens_utformning);
    const ovrigt = radOmFyllt('Utfärdat den', d.utfordat_den) +
      radOmFyllt('Kommentar', d.kommentar) +
      radOmFyllt('Karta nr', d.karta_nr) +
      radOmFyllt('Gravbrev nr', d.gravbrev_nr);
    const innehallHtml = rader + (ovrigt ? '<h4 class="gp-inmatning-delrubrik">Övrigt</h4>' + ovrigt : '');
    innehall.innerHTML = innehallHtml ? '<div class="gp-inmatning-las">' + innehallHtml + '</div>' : '';
    return;
  }

  if (sektion === 'skiss') {
    const rader = radOmFyllt('Storlek', d.storlek);
    innehall.innerHTML = rader ? '<div class="gp-inmatning-las">' + rader + '</div>' : '';
    return;
  }

  if (sektion === 'gravsatta') {
    const gs = d.gravsatta || [];
    if (gs.length === 0) {
      innehall.innerHTML = '';
      return;
    }
    innehall.innerHTML = '<div class="gp-inmatning-las"><ul class="gp-las-lista">' + gs.map((g, idx) => {
      const namn = [v(g.fornamn), v(g.efternamn)].filter(Boolean).join(' ') || '';
      const fodelse = formatDatum(g.fodelse_ar, g.fodelse_manad, g.fodelse_dag);
      const dods = formatDatum(g.dods_ar, g.dods_manad, g.dods_dag);
      let html = `<li class="gp-las-kort"><h4 class="gp-inmatning-delrubrik">Gravsatt ${idx + 1}</h4>`;
      if (g.ar_beteckning) html += '<div class="gp-las-rad"><span class="gp-las-label"></span><span class="gp-las-varde">Använd som beteckning (t.ex. familjegrav)</span></div>';
      const rader = radOmFyllt('Namn', namn) + radOmFyllt('Yrke', g.yrke) + radOmFyllt('Adress', g.adress) + radOmFyllt('Födelsedatum', fodelse) +
        radOmFyllt('Födelsenummer', g.fod_nr) + radOmFyllt('Dödsdatum', dods) + radOmFyllt('Db. nummer', g.dodsbok_nr) +
        radOmFyllt('Gravsatt den', g.gravsatt_den) + radOmFyllt('Urna/Kista', g.urna) + radOmFyllt('Kommentar', g.kommentar);
      html += rader + '</li>';
      return html;
    }).join('') + '</ul></div>';
    return;
  }
}

function renderInmatningSektion(sektion) {
  const d = inmatningData || {};
  const innehall = document.getElementById(`gp-innehall-${sektion}`);
  if (!innehall) return;

  if (!inmatningRedigerar) {
    renderInmatningSektionLäs(sektion);
    return;
  }

  if (sektion === 'innehavare') {
    const inv = d.innehavare || [];
    const innehallHarRader = innehall.querySelectorAll('.gp-innehavare-rad').length > 0;
    if (inmatningRedigerar && inmatningDirty && innehallHarRader) {
      uppdateraInmatningRubrikCounts();
      return;
    }
    let html = inv.map((i) => `
      <div class="gp-inmatning-rad gp-innehavare-rad">
        <span class="gp-innehavare-drag-handle" draggable="true" title="Dra för att ändra ordning" aria-label="Ändra ordning">⋮⋮</span>
        <label>Förnamn <textarea name="inv_fornamn" class="gp-falt-expanderbar" rows="1">${esc(i.fornamn)}</textarea></label>
        <label>Efternamn <textarea name="inv_efternamn" class="gp-falt-expanderbar" rows="1">${esc(i.efternamn)}</textarea></label>
        <label>Yrke <textarea name="inv_yrke" class="gp-falt-expanderbar" rows="1">${esc(i.yrke)}</textarea></label>
        <label>Adress <textarea name="inv_adress" class="gp-falt-expanderbar" rows="1">${esc(i.adress)}</textarea></label>
        <label>Kommentar <textarea class="gp-falt-expanderbar gp-inv-kommentar" rows="2">${esc(i.kommentar || '')}</textarea></label>
        <button type="button" class="gp-rad-ta-bort">Ta bort</button>
      </div>`).join('');
    html += '<button type="button" class="gp-lagg-till-innehavare">+ Lägg till innehavare</button>';
    innehall.innerHTML = html;
    innehall.querySelectorAll('textarea.gp-falt-expanderbar').forEach(autoExpandTextarea);
    bindInnehavareDragDrop(innehall);
    innehall.querySelectorAll('.gp-innehavare-rad .gp-rad-ta-bort').forEach((b) => b.addEventListener('click', () => {
      b.closest('.gp-innehavare-rad')?.remove();
      markInmatningDirty();
      uppdateraInmatningRubrikCounts();
    }));
    innehall.querySelector('.gp-lagg-till-innehavare')?.addEventListener('click', () => {
      const rad = document.createElement('div');
      rad.className = 'gp-inmatning-rad gp-innehavare-rad';
      rad.innerHTML = '<span class="gp-innehavare-drag-handle" draggable="true" title="Dra för att ändra ordning" aria-label="Ändra ordning">⋮⋮</span><label>Förnamn <textarea name="inv_fornamn" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Efternamn <textarea name="inv_efternamn" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Yrke <textarea name="inv_yrke" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Adress <textarea name="inv_adress" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Kommentar <textarea class="gp-falt-expanderbar gp-inv-kommentar" rows="2"></textarea></label><button type="button" class="gp-rad-ta-bort">Ta bort</button>';
      innehall.insertBefore(rad, innehall.querySelector('.gp-lagg-till-innehavare'));
      rad.querySelectorAll('textarea.gp-falt-expanderbar').forEach(autoExpandTextarea);
      bindInnehavareDragDrop(innehall);
      rad.querySelector('.gp-rad-ta-bort').addEventListener('click', () => { rad.remove(); markInmatningDirty(); uppdateraInmatningRubrikCounts(); });
      markInmatningDirty();
      uppdateraInmatningRubrikCounts();
      const fornamnFalt = rad.querySelector('[name="inv_fornamn"]');
      if (fornamnFalt) {
        fornamnFalt.focus();
        visaOcrIkonForFalt(fornamnFalt);
      }
    });
    uppdateraInmatningRubrikCounts();
    return;
  }

  if (sektion === 'narmast_anhoriga') {
    const na = d.narmast_anhoriga || [];
    const innehallHarRader = innehall.querySelectorAll('.gp-na-rad').length > 0;
    if (inmatningRedigerar && inmatningDirty && innehallHarRader) {
      uppdateraInmatningRubrikCounts();
      return;
    }
    let html = na.map((n) => `
      <div class="gp-inmatning-rad gp-na-rad">
        <span class="gp-na-drag-handle" draggable="true" title="Dra för att ändra ordning" aria-label="Ändra ordning">⋮⋮</span>
        <label>Förnamn <textarea name="na_fornamn" class="gp-falt-expanderbar" rows="1">${esc(n.fornamn)}</textarea></label>
        <label>Efternamn <textarea name="na_efternamn" class="gp-falt-expanderbar" rows="1">${esc(n.efternamn)}</textarea></label>
        <label>Gatuadress <textarea name="na_gatuadress" class="gp-falt-expanderbar" rows="1">${esc(n.adress)}</textarea></label>
        <label>Postnummer <textarea name="na_postnummer" class="gp-falt-expanderbar" rows="1">${esc(n.postnummer)}</textarea></label>
        <label>Postort <textarea name="na_postort" class="gp-falt-expanderbar" rows="1">${esc(n.postort)}</textarea></label>
        <label>Telefon <textarea name="na_telefon" class="gp-falt-expanderbar" rows="1">${esc(n.telefon)}</textarea></label>
        <label>Kommentar <textarea class="gp-falt-expanderbar gp-na-kommentar" rows="2">${esc(n.kommentar || '')}</textarea></label>
        <button type="button" class="gp-na-ta-bort">Ta bort</button>
      </div>`).join('');
    html += '<button type="button" class="gp-lagg-till-na">+ Lägg till närmast anhörig</button>';
    innehall.innerHTML = html;
    innehall.querySelectorAll('textarea.gp-falt-expanderbar').forEach(autoExpandTextarea);
    bindNaDragDrop(innehall);
    innehall.querySelectorAll('.gp-na-rad .gp-na-ta-bort').forEach((b) => b.addEventListener('click', () => {
      b.closest('.gp-na-rad')?.remove();
      markInmatningDirty();
      uppdateraInmatningRubrikCounts();
    }));
    innehall.querySelector('.gp-lagg-till-na')?.addEventListener('click', () => {
      const rad = document.createElement('div');
      rad.className = 'gp-inmatning-rad gp-na-rad';
      rad.innerHTML = '<span class="gp-na-drag-handle" draggable="true" title="Dra för att ändra ordning" aria-label="Ändra ordning">⋮⋮</span><label>Förnamn <textarea name="na_fornamn" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Efternamn <textarea name="na_efternamn" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Gatuadress <textarea name="na_gatuadress" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Postnummer <textarea name="na_postnummer" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Postort <textarea name="na_postort" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Telefon <textarea name="na_telefon" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Kommentar <textarea class="gp-falt-expanderbar gp-na-kommentar" rows="2"></textarea></label><button type="button" class="gp-na-ta-bort">Ta bort</button>';
      innehall.insertBefore(rad, innehall.querySelector('.gp-lagg-till-na'));
      rad.querySelectorAll('textarea.gp-falt-expanderbar').forEach(autoExpandTextarea);
      bindNaDragDrop(innehall);
      rad.querySelector('.gp-na-ta-bort').addEventListener('click', () => { rad.remove(); markInmatningDirty(); uppdateraInmatningRubrikCounts(); });
      markInmatningDirty();
      uppdateraInmatningRubrikCounts();
      const fornamnFalt = rad.querySelector('[name="na_fornamn"]');
      if (fornamnFalt) {
        fornamnFalt.focus();
        visaOcrIkonForFalt(fornamnFalt);
      }
    });
    uppdateraInmatningRubrikCounts();
    return;
  }

  if (sektion === 'gravplatsen') {
    innehall.innerHTML = `
      <label>Underhåll inbetalt för all framtid den <textarea name="underhall_text" class="gp-falt-expanderbar" rows="1">${esc(d.underhall_text)}</textarea></label>
      <label><input type="checkbox" name="underhall_overstruket" ${d.underhall_overstruket ? 'checked' : ''} /> "För all framtid" överstruket</label>
      <label>Gravrättstid <textarea name="gravrattstid" class="gp-falt-expanderbar" rows="1">${esc(d.gravrattstid)}</textarea></label>
      <label>Monument <textarea name="monument" class="gp-falt-expanderbar" rows="1">${esc(d.monument)}</textarea></label>
      <label>Gravens utformning <textarea name="gravens_utformning" class="gp-falt-expanderbar" rows="1">${esc(d.gravens_utformning)}</textarea></label>
      <h4 class="gp-inmatning-delrubrik">Övrigt</h4>
      <label>Utfärdat den <textarea name="utfordat_den" class="gp-falt-expanderbar" rows="1" title="Format: YYYY-MM-DD. Endast år: YYYY-00-00. År och månad: YYYY-MM-00">${esc(d.utfordat_den)}</textarea></label>
      <label>Kommentar <textarea name="kommentar" rows="2">${esc(d.kommentar)}</textarea></label>
      <label>Karta nr <textarea name="karta_nr" class="gp-falt-expanderbar" rows="1">${esc(d.karta_nr)}</textarea></label>
      <label>Gravbrev nr <textarea name="gravbrev_nr" class="gp-falt-expanderbar" rows="1">${esc(d.gravbrev_nr)}</textarea></label>`;
    innehall.querySelectorAll('textarea.gp-falt-expanderbar').forEach(autoExpandTextarea);
    return;
  }

  if (sektion === 'skiss') {
    innehall.innerHTML = `
      <label>Storlek <textarea name="storlek" class="gp-falt-expanderbar" rows="1">${esc(d.storlek)}</textarea></label>
      <p class="gp-skiss-info">Här kommer du senare kunna ange/croppa skiss från bilden.</p>`;
    innehall.querySelectorAll('textarea.gp-falt-expanderbar').forEach(autoExpandTextarea);
    return;
  }

  if (sektion === 'gravsatta') {
    const gs = d.gravsatta || [];
    const innehallHarBlock = innehall.querySelectorAll('.gp-gravsatt-block').length > 0;
    if (inmatningRedigerar && inmatningDirty && innehallHarBlock) {
      uppdateraInmatningRubrikCounts();
      return;
    }
    let html = gs.map((g, idx) => blockGravsatt(idx, g)).join('');
    html += '<button type="button" class="gp-lagg-till-gravsatt">+ Lägg till gravsatt</button>';
    innehall.innerHTML = html;
    bindDatumValidering(innehall);
    bindGravsattDragDrop(innehall);
    innehall.querySelectorAll('textarea.gp-falt-expanderbar').forEach(autoExpandTextarea);
    innehall.querySelector('.gp-lagg-till-gravsatt')?.addEventListener('click', () => {
      const list = innehall.querySelectorAll('.gp-gravsatt-block');
      if (list.length >= 10) return;
      const newIndex = list.length;
      const temp = document.createElement('div');
      temp.innerHTML = blockGravsatt(newIndex, {}).trim();
      const rad = temp.firstElementChild;
      if (!rad) return;
      rad.dataset.gsIndex = String(newIndex);
      innehall.insertBefore(rad, innehall.querySelector('.gp-lagg-till-gravsatt'));
      bindDatumValidering(rad);
      bindGravsattDragDrop(innehall);
      rad.querySelectorAll('textarea.gp-falt-expanderbar').forEach(autoExpandTextarea);
      markInmatningDirty();
      uppdateraInmatningRubrikCounts();
      const fornamnFalt = rad.querySelector('[name="gs_fornamn_' + newIndex + '"]');
      if (fornamnFalt) {
        fornamnFalt.focus();
        visaOcrIkonForFalt(fornamnFalt);
      }
    });
    uppdateraInmatningRubrikCounts();
    return;
  }
}

function renumberGravsattBlocks(container) {
  const blocks = container.querySelectorAll('.gp-gravsatt-block');
  blocks.forEach((blk, i) => {
    const oldIdx = blk.dataset.gsIndex;
    blk.dataset.gsIndex = String(i);
    const h4 = blk.querySelector('h4');
    if (h4) {
      const handle = h4.querySelector('.gp-gravsatt-drag-handle');
      if (handle) {
        const text = Array.from(h4.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
        if (text) text.textContent = ` Gravsatt ${i + 1}`;
        else h4.appendChild(document.createTextNode(` Gravsatt ${i + 1}`));
      } else {
        h4.textContent = `Gravsatt ${i + 1}`;
      }
    }
    blk.querySelectorAll('[name^="gs_"]').forEach((el) => {
      el.name = el.name.replace(/_[0-9]+$/, '_' + i);
    });
    blk.querySelectorAll('[id^="gs_"][id*="_fel_"]').forEach((el) => {
      el.id = el.id.replace(/_fel_[0-9]+$/, '_fel_' + i);
    });
    blk.querySelectorAll('[aria-describedby^="gs_"]').forEach((el) => {
      el.setAttribute('aria-describedby', (el.getAttribute('aria-describedby') || '').replace(/_fel_[0-9]+$/, '_fel_' + i));
    });
  });
}

function bindGravsattDragDrop(container) {
  container.querySelectorAll('.gp-gravsatt-drag-handle').forEach((handle) => {
    const blk = handle.closest('.gp-gravsatt-block');
    if (!blk) return;
    handle.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', blk.dataset.gsIndex);
      e.dataTransfer.effectAllowed = 'move';
      blk.classList.add('gp-gravsatt-dragging');
    });
    handle.addEventListener('dragend', () => blk.classList.remove('gp-gravsatt-dragging'));
  });
  const blocks = container.querySelectorAll('.gp-gravsatt-block');
  blocks.forEach((blk) => {
    blk.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.gp-gravsatt-drag-over').forEach((b) => b.classList.remove('gp-gravsatt-drag-over'));
      if (!blk.classList.contains('gp-gravsatt-dragging')) e.currentTarget.classList.add('gp-gravsatt-drag-over');
    });
    blk.addEventListener('dragleave', (e) => e.currentTarget.classList.remove('gp-gravsatt-drag-over'));
    blk.addEventListener('drop', (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove('gp-gravsatt-drag-over');
      const fromIndex = e.dataTransfer.getData('text/plain');
      const fromBlk = container.querySelector(`.gp-gravsatt-block[data-gs-index="${fromIndex}"]`);
      const toBlk = e.currentTarget;
      if (!fromBlk || fromBlk === toBlk) return;
      container.insertBefore(fromBlk, toBlk);
      renumberGravsattBlocks(container);
      markInmatningDirty();
      uppdateraInmatningRubrikCounts();
    });
  });
  container.addEventListener('click', (e) => {
    if (e.target.closest('.gp-gravsatt-ta-bort')) {
      const block = e.target.closest('.gp-gravsatt-block');
      if (block) {
        block.remove();
        renumberGravsattBlocks(container);
        markInmatningDirty();
        uppdateraInmatningRubrikCounts();
      }
    }
  });
}

function bindInnehavareDragDrop(container) {
  const rowSelector = '.gp-innehavare-rad';
  const handleSelector = '.gp-innehavare-drag-handle';
  container.querySelectorAll(handleSelector).forEach((handle) => {
    const row = handle.closest(rowSelector);
    if (!row) return;
    handle.addEventListener('dragstart', (e) => {
      const rows = container.querySelectorAll(rowSelector);
      const idx = Array.from(rows).indexOf(row);
      e.dataTransfer.setData('text/plain', String(idx));
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('gp-innehavare-dragging');
    });
    handle.addEventListener('dragend', () => row.classList.remove('gp-innehavare-dragging'));
  });
  container.querySelectorAll(rowSelector).forEach((row) => {
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll(rowSelector).forEach((r) => r.classList.remove('gp-innehavare-drag-over'));
      if (!row.classList.contains('gp-innehavare-dragging')) row.classList.add('gp-innehavare-drag-over');
    });
    row.addEventListener('dragleave', (e) => e.currentTarget.classList.remove('gp-innehavare-drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove('gp-innehavare-drag-over');
      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const rows = container.querySelectorAll(rowSelector);
      const fromRow = rows[fromIndex];
      const toRow = e.currentTarget;
      if (!fromRow || fromRow === toRow) return;
      container.insertBefore(fromRow, toRow);
      markInmatningDirty();
      uppdateraInmatningRubrikCounts();
    });
  });
}

function bindNaDragDrop(container) {
  const rowSelector = '.gp-na-rad';
  const handleSelector = '.gp-na-drag-handle';
  container.querySelectorAll(handleSelector).forEach((handle) => {
    const row = handle.closest(rowSelector);
    if (!row) return;
    handle.addEventListener('dragstart', (e) => {
      const rows = container.querySelectorAll(rowSelector);
      const idx = Array.from(rows).indexOf(row);
      e.dataTransfer.setData('text/plain', String(idx));
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('gp-na-dragging');
    });
    handle.addEventListener('dragend', () => row.classList.remove('gp-na-dragging'));
  });
  container.querySelectorAll(rowSelector).forEach((row) => {
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll(rowSelector).forEach((r) => r.classList.remove('gp-na-drag-over'));
      if (!row.classList.contains('gp-na-dragging')) row.classList.add('gp-na-drag-over');
    });
    row.addEventListener('dragleave', (e) => e.currentTarget.classList.remove('gp-na-drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove('gp-na-drag-over');
      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const rows = container.querySelectorAll(rowSelector);
      const fromRow = rows[fromIndex];
      const toRow = e.currentTarget;
      if (!fromRow || fromRow === toRow) return;
      container.insertBefore(fromRow, toRow);
      markInmatningDirty();
      uppdateraInmatningRubrikCounts();
    });
  });
}

function bindDatumValidering(container) {
  const block = container.classList?.contains('gp-gravsatt-block') ? container : null;
  const blocks = block ? [block] : container.querySelectorAll('.gp-gravsatt-block');
  blocks.forEach((blk) => {
    const idx = blk.dataset.gsIndex != null ? blk.dataset.gsIndex : '';
    const felIds = { gs_fodelse_datum: `gs_fodelse_datum_fel_${idx}`, gs_dods_datum: `gs_dods_datum_fel_${idx}`, gs_gravsatt_den: `gs_gravsatt_den_fel_${idx}` };
    const runBlock = () => valideraGravsattBlockDatum(blk);
    ['gs_fodelse_datum', 'gs_dods_datum', 'gs_gravsatt_den'].forEach((base) => {
      const inp = blk.querySelector(`[name="${base}_${idx}"]`);
      if (!inp) return;
      inp.addEventListener('blur', () => {
        const fore = inp.value;
        normaliseraDatumFalt(inp);
        if (inp.value !== fore) markInmatningDirty();
        runBlock();
      });
      inp.addEventListener('input', runBlock);
    });
  });
}

/** Formatera födelse/dödsdatum från ar, manad, dag till YYYY, YYYY-MM eller YYYY-MM-DD. */
function formatDatum(ar, manad, dag) {
  if (ar == null) return '';
  const y = String(ar);
  if (manad == null) return y;
  const m = String(manad).padStart(2, '0');
  if (dag == null) return `${y}-${m}`;
  const d = String(dag).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parsa datumsträng (YYYY, YYYY-MM eller YYYY-MM-DD) till { ar, manad, dag }. */
function parseDatum(s) {
  const t = (s || '').trim();
  if (!t) return { ar: null, manad: null, dag: null };
  const part = t.split('-').map((x) => parseInt(x, 10));
  if (part.length >= 3 && !isNaN(part[0]) && !isNaN(part[1]) && !isNaN(part[2])) {
    return { ar: part[0], manad: part[1], dag: part[2] };
  }
  if (part.length >= 2 && !isNaN(part[0]) && !isNaN(part[1])) {
    return { ar: part[0], manad: part[1], dag: null };
  }
  if (part.length >= 1 && !isNaN(part[0])) {
    return { ar: part[0], manad: null, dag: null };
  }
  return { ar: null, manad: null, dag: null };
}

const DATUM_FORMAT_TEXT = 'Giltiga format: YYYY, YYYY-MM eller YYYY-MM-DD';

/** Ger tidigast möjliga datum för partiellt datum (för jämförelse). YYYY → 1 jan, YYYY-MM → 1:e i månaden. */
function parsedToEarliest(p) {
  if (!p || p.ar == null) return null;
  const y = p.ar;
  const m = p.manad != null ? p.manad : 1;
  const d = p.dag != null ? p.dag : 1;
  return y * 10000 + m * 100 + d;
}

/** Ger senast möjliga datum för partiellt datum. YYYY → 31 dec, YYYY-MM → sista dagen i månaden. */
function parsedToLatest(p) {
  if (!p || p.ar == null) return null;
  const y = p.ar;
  let m, d;
  if (p.manad != null && p.dag != null) {
    m = p.manad;
    d = p.dag;
  } else if (p.manad != null) {
    m = p.manad;
    d = new Date(y, m, 0).getDate();
  } else {
    m = 12;
    d = 31;
  }
  return y * 10000 + m * 100 + d;
}

/** Rimlighetskontroll för gravsatt-block: dödsdatum >= födelsedatum, gravsatt den >= dödsdatum. Returnerar { dodsFel?, gravsattFel? } med meddelande. */
function valideraDatumRimlighetGravsattBlock(blk) {
  const idx = blk.dataset.gsIndex != null ? blk.dataset.gsIndex : '';
  const p = (name) => (blk.querySelector(`[name="${name}_${idx}"]`)?.value ?? '').trim();
  const fodelse = parseDatum(p('gs_fodelse_datum'));
  const dods = parseDatum(p('gs_dods_datum'));
  const gravsattDen = parseDatum(p('gs_gravsatt_den'));
  const err = {};
  if (fodelse.ar != null && dods.ar != null) {
    const latestDods = parsedToLatest(dods);
    const earliestFodelse = parsedToEarliest(fodelse);
    if (latestDods < earliestFodelse) {
      err.dodsFel = 'Dödsdatum kan inte vara tidigare än födelsedatum.';
    }
  }
  if (dods.ar != null && gravsattDen.ar != null) {
    const latestGravsatt = parsedToLatest(gravsattDen);
    const earliestDods = parsedToEarliest(dods);
    if (latestGravsatt < earliestDods) {
      err.gravsattFel = 'Gravsättningsdatum kan inte vara tidigare än dödsdatum.';
    }
  }
  return err;
}

/** Om värdet är exakt 8 siffror (YYYYMMDD), formatera till YYYY-MM-DD. Endast 8 siffror konverteras; YYYY-MM skrivs manuellt. */
function normaliseraDatumFalt(inp) {
  if (!inp || typeof inp.value !== 'string') return;
  const t = inp.value.trim().replace(/\s/g, '');
  if (/^\d{8}$/.test(t)) {
    const y = t.slice(0, 4);
    const m = t.slice(4, 6);
    const d = t.slice(6, 8);
    inp.value = `${y}-${m}-${d}`;
  }
}

/** Validera datumfält: tomt är ok, annars YYYY, YYYY-MM eller YYYY-MM-DD med rimliga tal. Returnerar { valid, message }. */
function validDatum(s) {
  const t = (s || '').trim();
  if (!t) return { valid: true };
  const part = t.split('-');
  if (part.length > 3) return { valid: false, message: DATUM_FORMAT_TEXT };
  const num = part.map((x) => parseInt(x, 10));
  if (num.some((n, i) => isNaN(n) || (i === 0 && (n < 1000 || n > 2100)) || (i === 1 && (n < 1 || n > 12)) || (i === 2 && (n < 1 || n > 31)))) {
    return { valid: false, message: DATUM_FORMAT_TEXT };
  }
  if (part.length === 1) return { valid: true };
  if (part.length === 2) return { valid: true };
  return { valid: true };
}

function visaDatumValidering(inp, felSpan) {
  const r = validDatum(inp.value);
  if (r.valid) {
    if (felSpan) { felSpan.hidden = true; felSpan.textContent = ''; }
    inp.setCustomValidity('');
  } else {
    if (felSpan) { felSpan.textContent = r.message || DATUM_FORMAT_TEXT; felSpan.hidden = false; }
    inp.setCustomValidity(r.message || DATUM_FORMAT_TEXT);
  }
}

/** Kör format- och rimlighetsvalidering för ett gravsatt-blocks tre datumfält. Uppdaterar felSpan och setCustomValidity. */
function valideraGravsattBlockDatum(blk) {
  const idx = blk.dataset.gsIndex != null ? blk.dataset.gsIndex : '';
  const bases = ['gs_fodelse_datum', 'gs_dods_datum', 'gs_gravsatt_den'];
  const formatResults = {};
  bases.forEach((base) => {
    const inp = blk.querySelector(`[name="${base}_${idx}"]`);
    const felSpan = document.getElementById(`${base}_fel_${idx}`);
    if (!inp) return;
    const r = validDatum(inp.value);
    formatResults[base] = { valid: r.valid, message: r.message };
    if (r.valid) {
      if (felSpan) { felSpan.hidden = true; felSpan.textContent = ''; felSpan.className = 'gp-datum-fel'; }
      inp.setCustomValidity('');
    } else {
      if (felSpan) { felSpan.textContent = r.message || DATUM_FORMAT_TEXT; felSpan.className = 'gp-datum-fel'; felSpan.hidden = false; }
      inp.setCustomValidity(r.message || DATUM_FORMAT_TEXT);
    }
  });
  const rimlighet = valideraDatumRimlighetGravsattBlock(blk);
  const dodsInp = blk.querySelector(`[name="gs_dods_datum_${idx}"]`);
  const dodsFel = document.getElementById(`gs_dods_datum_fel_${idx}`);
  if (dodsInp && dodsFel) {
    if (rimlighet.dodsFel) {
      dodsFel.textContent = rimlighet.dodsFel;
      dodsFel.className = 'gp-datum-fel gp-datum-varning';
      dodsFel.hidden = false;
      dodsInp.setCustomValidity(''); // varning spärrar inte – grundmaterialet kan ha så
    } else if (formatResults['gs_dods_datum'].valid) {
      dodsFel.hidden = true;
      dodsFel.textContent = '';
      dodsFel.className = 'gp-datum-fel';
      dodsInp.setCustomValidity('');
    }
  }
  const gravsattInp = blk.querySelector(`[name="gs_gravsatt_den_${idx}"]`);
  const gravsattFel = document.getElementById(`gs_gravsatt_den_fel_${idx}`);
  if (gravsattInp && gravsattFel) {
    if (rimlighet.gravsattFel) {
      gravsattFel.textContent = rimlighet.gravsattFel;
      gravsattFel.className = 'gp-datum-fel gp-datum-varning';
      gravsattFel.hidden = false;
      gravsattInp.setCustomValidity(''); // varning spärrar inte
    } else if (formatResults['gs_gravsatt_den'].valid) {
      gravsattFel.hidden = true;
      gravsattFel.textContent = '';
      gravsattFel.className = 'gp-datum-fel';
      gravsattInp.setCustomValidity('');
    }
  }
}

const URNA_VAL = [
  { v: '', l: 'Ej valt' },
  { v: 'urna', l: 'Urna' },
  { v: 'kista', l: 'Kista' },
  { v: 'okant', l: 'Okänt' },
];

/** idx = 0-baserat index (används för unika name/data-gs-index). */
function blockGravsatt(idx, g) {
  const pos = idx + 1;
  const beteckning = pos === 1
    ? `<label class="gp-gravsatt-beteckning"><input type="checkbox" name="gs_ar_beteckning_${idx}" ${g.ar_beteckning ? 'checked' : ''} /> Gravsatt använd som beteckning (t.ex. familjegrav)</label>`
    : '';
  const fodelseDatum = formatDatum(g.fodelse_ar, g.fodelse_manad, g.fodelse_dag);
  const dodsDatum = formatDatum(g.dods_ar, g.dods_manad, g.dods_dag);
  const urnaVal = (g.urna || '').toLowerCase();
  const urnaSelected = ['urna', 'kista', 'okant'].includes(urnaVal) ? urnaVal : '';
  const urnaOptions = URNA_VAL.map((o) => `<option value="${esc(o.v)}" ${o.v === urnaSelected ? 'selected' : ''}>${o.l}</option>`).join('');
  return `
    <div class="gp-gravsatt-block" data-gs-index="${idx}">
      <h4><span class="gp-gravsatt-drag-handle" draggable="true" title="Dra för att ändra ordning">⋮⋮</span> Gravsatt ${pos}</h4>
      ${beteckning}
      <div class="gp-gravsatt-rad">
        <label>Förnamn <textarea name="gs_fornamn_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.fornamn)}</textarea></label>
        <label>Efternamn <textarea name="gs_efternamn_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.efternamn)}</textarea></label>
      </div>
      <div class="gp-gravsatt-rad">
        <label>Yrke <textarea name="gs_yrke_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.yrke || '')}</textarea></label>
        <label>Adress <textarea name="gs_adress_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.adress)}</textarea></label>
      </div>
      <div class="gp-gravsatt-rad">
        <label>Födelsedatum <textarea name="gs_fodelse_datum_${idx}" class="gp-falt-expanderbar" rows="1" aria-describedby="gs_fodelse_datum_fel_${idx}">${esc(fodelseDatum)}</textarea></label>
        <span class="gp-datum-fel" id="gs_fodelse_datum_fel_${idx}" hidden aria-live="polite"></span>
        <label>Födelsenummer <textarea name="gs_fod_nr_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.fod_nr)}</textarea></label>
      </div>
      <div class="gp-gravsatt-rad">
        <label>Dödsdatum <textarea name="gs_dods_datum_${idx}" class="gp-falt-expanderbar" rows="1" aria-describedby="gs_dods_datum_fel_${idx}">${esc(dodsDatum)}</textarea></label>
        <span class="gp-datum-fel" id="gs_dods_datum_fel_${idx}" hidden aria-live="polite"></span>
        <label>Db. nummer <textarea name="gs_dodsbok_nr_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.dodsbok_nr)}</textarea></label>
      </div>
      <div class="gp-gravsatt-rad">
        <label>Gravsatt den <textarea name="gs_gravsatt_den_${idx}" class="gp-falt-expanderbar" rows="1" aria-describedby="gs_gravsatt_den_fel_${idx}">${esc(g.gravsatt_den)}</textarea></label>
        <span class="gp-datum-fel" id="gs_gravsatt_den_fel_${idx}" hidden aria-live="polite"></span>
      </div>
      <div class="gp-gravsatt-rad">
        <label>Urna/Kista <select name="gs_urna_${idx}">${urnaOptions}</select></label>
      </div>
      <div class="gp-gravsatt-rad">
        <label>Kommentar <textarea name="gs_kommentar_${idx}" class="gp-falt-expanderbar" rows="2">${esc(g.kommentar || '')}</textarea></label>
      </div>
      <button type="button" class="gp-gravsatt-ta-bort">Ta bort</button>
    </div>`;
}

function samlaInmatningData() {
  const root = document.getElementById('gp-inmatning');
  if (!root) return null;
  const d = inmatningData || {};
  const get = (name) => (root.querySelector(`[name="${name}"]`)?.value ?? '').trim();
  const getBool = (name) => root.querySelector(`[name="${name}"]`)?.checked ?? false;

  let innehavare = [];
  const innehavareRader = root.querySelectorAll('.gp-innehavare-rad');
  if (innehavareRader.length > 0) {
    innehavareRader.forEach((rad) => {
      const fornamn = (rad.querySelector('[name="inv_fornamn"]')?.value ?? '').trim();
      const efternamn = (rad.querySelector('[name="inv_efternamn"]')?.value ?? '').trim();
      const yrke = (rad.querySelector('[name="inv_yrke"]')?.value ?? '').trim();
      const adress = (rad.querySelector('[name="inv_adress"]')?.value ?? '').trim();
      const kommentar = (rad.querySelector('.gp-inv-kommentar')?.value ?? '').trim();
      innehavare.push({ fornamn, efternamn, yrke, adress, kommentar, sort_order: innehavare.length });
    });
  }
  // Vid 0 rader skickar vi tom lista (användaren har tagit bort alla), inte gamla inmatningData.

  let narmast_anhoriga = [];
  const naRader = root.querySelectorAll('.gp-na-rad');
  if (naRader.length > 0) {
    naRader.forEach((rad) => {
      const fornamn = (rad.querySelector('[name="na_fornamn"]')?.value ?? '').trim();
      const efternamn = (rad.querySelector('[name="na_efternamn"]')?.value ?? '').trim();
      const adress = (rad.querySelector('[name="na_gatuadress"]')?.value ?? '').trim();
      const postnummer = (rad.querySelector('[name="na_postnummer"]')?.value ?? '').trim();
      const postort = (rad.querySelector('[name="na_postort"]')?.value ?? '').trim();
      const telefon = (rad.querySelector('[name="na_telefon"]')?.value ?? '').trim();
      const kommentar = (rad.querySelector('.gp-na-kommentar')?.value ?? '').trim();
      if (fornamn || efternamn) narmast_anhoriga.push({ fornamn, efternamn, adress, postnummer, postort, telefon, kommentar, sort_order: narmast_anhoriga.length });
    });
  }

  let gravsatta = [];
  const gravsattBlock = root.querySelectorAll('.gp-gravsatt-block');
  if (gravsattBlock.length > 0) {
  root.querySelectorAll('.gp-gravsatt-block').forEach((block, idx) => {
    const i = block.dataset.gsIndex != null ? block.dataset.gsIndex : String(idx);
    const p = (n) => (block.querySelector(`[name="${n}_${i}"]`)?.value ?? '').trim();
    const fodelse = parseDatum(p('gs_fodelse_datum'));
    const dods = parseDatum(p('gs_dods_datum'));
    gravsatta.push({
      position: idx + 1,
      ar_beteckning: block.querySelector(`[name="gs_ar_beteckning_${i}"]`)?.checked ?? false,
      fornamn: p('gs_fornamn'),
      efternamn: p('gs_efternamn'),
      yrke: p('gs_yrke'),
      adress: p('gs_adress'),
      fodelse_ar: fodelse.ar,
      fodelse_manad: fodelse.manad,
      fodelse_dag: fodelse.dag,
      fod_nr: p('gs_fod_nr'),
      dods_ar: dods.ar,
      dods_manad: dods.manad,
      dods_dag: dods.dag,
      dodsbok_nr: p('gs_dodsbok_nr'),
      gravsatt_den: p('gs_gravsatt_den'),
      urna: p('gs_urna'),
      kommentar: p('gs_kommentar'),
    });
  });
  }
  // Vid 0 gravsatta skickar vi tom lista (användaren har tagit bort alla).

  const gravplatsenOppnad = root.querySelector('[name="underhall_text"]') != null;
  const skissOppnad = root.querySelector('#gp-innehall-skiss [name="storlek"]') != null;
  const storlek = skissOppnad ? (root.querySelector('#gp-innehall-skiss [name="storlek"]')?.value ?? '').trim() : (d.storlek || '');
  const underhall_text = gravplatsenOppnad ? get('underhall_text') : (d.underhall_text || '');
  const underhall_overstruket = gravplatsenOppnad ? getBool('underhall_overstruket') : (d.underhall_overstruket ?? false);
  const gravrattstid = gravplatsenOppnad ? get('gravrattstid') : (d.gravrattstid || '');
  const monument = gravplatsenOppnad ? get('monument') : (d.monument || '');
  const gravens_utformning = gravplatsenOppnad ? get('gravens_utformning') : (d.gravens_utformning || '');
  const karta_nr = gravplatsenOppnad ? get('karta_nr') : (d.karta_nr || '');
  const gravbrev_nr = gravplatsenOppnad ? get('gravbrev_nr') : (d.gravbrev_nr || '');
  const utfordat_den = gravplatsenOppnad ? get('utfordat_den') : (d.utfordat_den || '');
  const kommentar = gravplatsenOppnad ? (root.querySelector('textarea[name="kommentar"]')?.value ?? '').trim() : (d.kommentar || '');
  const fardigtranskriberad = inmatningData && inmatningData.fardigtranskriberad === true;

  return {
    innehavare,
    narmast_anhoriga,
    storlek,
    underhall_text,
    underhall_overstruket,
    gravrattstid,
    monument,
    gravens_utformning,
    karta_nr,
    gravbrev_nr,
    utfordat_den,
    kommentar,
    fardigtranskriberad,
    gravsatta,
    skiss_bild_b64: null,
  };
}

function valideraAllaDatumFalt() {
  const root = document.getElementById('gp-inmatning');
  if (!root) return true;
  let firstInvalid = null;
  root.querySelectorAll('.gp-gravsatt-block').forEach((blk) => {
    valideraGravsattBlockDatum(blk);
    const idx = blk.dataset.gsIndex != null ? blk.dataset.gsIndex : '';
    ['gs_fodelse_datum', 'gs_dods_datum', 'gs_gravsatt_den'].forEach((base) => {
      const inp = blk.querySelector(`[name="${base}_${idx}"]`);
      if (inp && !validDatum(inp.value).valid && !firstInvalid) firstInvalid = inp;
    });
  });
  if (firstInvalid) {
    firstInvalid.focus();
    return false;
  }
  return true;
}

async function sparaInmatning() {
  if (currentGravplatsId == null) return;
  if (!inmatningDirty) return;
  await ensureInmatningData();
  if (!valideraAllaDatumFalt()) return;
  const payload = samlaInmatningData();
  if (!payload) return;
  try {
    const res = await fetch(`${API}/gravplats/${currentGravplatsId}/inmatning`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Kunde inte spara');
    const data = await res.json();
    if (data.gravplats_id != null && data.gravplats_id === currentGravplatsId) {
      inmatningData = data;
      lastInmatningGravplatsId = currentGravplatsId;
    }
    inmatningDirty = false;
    uppdateraInmatningSparaKnapp();
    visaSparStatus('Sparat.', true);
  } catch (e) {
    visaSparStatus('Kunde inte spara: ' + e.message, false);
  }
}

function visaSparStatus(meddelande, ok) {
  const el = document.getElementById('gp-inmatning-status');
  if (!el) return;
  el.textContent = meddelande;
  el.className = 'gp-inmatning-status gp-inmatning-status-' + (ok ? 'ok' : 'fel');
  el.hidden = false;
  clearTimeout(visaSparStatus.timeoutId);
  visaSparStatus.timeoutId = setTimeout(() => {
    el.textContent = '';
    el.hidden = true;
  }, 4000);
}

document.querySelectorAll('.gp-sektion-rubrik').forEach((btn) => {
  btn.addEventListener('click', () => toggleInmatningSektion(btn.dataset.sektion));
});
document.getElementById('gp-inmatning-spara')?.addEventListener('click', sparaInmatning);

const gpInmatningEl = document.getElementById('gp-inmatning');
if (gpInmatningEl) {
  gpInmatningEl.addEventListener('input', () => { inmatningDirty = true; uppdateraInmatningSparaKnapp(); });
  gpInmatningEl.addEventListener('change', () => { inmatningDirty = true; uppdateraInmatningSparaKnapp(); });
}
uppdateraInmatningSparaKnapp();

function toggleRedigeraVy() {
  if (inmatningRedigerar) {
    if (inmatningDirty) {
      if (!confirm('Du har osparade ändringar. Visa vy utan att spara?')) return;
      inmatningDirty = false;
    }
    inmatningRedigerar = false;
    lastInmatningGravplatsId = null;
    const sparaWrap = document.getElementById('gp-inmatning-spara-wrap');
    if (sparaWrap) sparaWrap.hidden = true;
    const btn = document.getElementById('gp-btn-redigera');
    if (btn) btn.textContent = 'Redigera gravplatsen';
    expandAllInmatningSektioner();
    const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
    sektioner.forEach((s) => {
      ensureInmatningData().then((ok) => { if (ok) renderInmatningSektion(s); });
    });
    uppdateraFardigtranskriberadKnapp();
  } else {
    inmatningRedigerar = true;
    const sparaWrap = document.getElementById('gp-inmatning-spara-wrap');
    if (sparaWrap) sparaWrap.hidden = false;
    const btn = document.getElementById('gp-btn-redigera');
    if (btn) btn.textContent = 'Visa vy';
    const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
    sektioner.forEach((s) => {
      const innehall = document.getElementById(`gp-innehall-${s}`);
      if (innehall && !innehall.hidden) renderInmatningSektion(s);
    });
    uppdateraInmatningSparaKnapp();
    uppdateraFardigtranskriberadKnapp();
  }
}

document.getElementById('gp-btn-redigera')?.addEventListener('click', toggleRedigeraVy);

document.getElementById('gp-btn-fardigtranskriberad')?.addEventListener('click', async () => {
  if (!inmatningRedigerar || currentGravplatsId == null || !inmatningData) return;
  inmatningData.fardigtranskriberad = !inmatningData.fardigtranskriberad;
  uppdateraFardigtranskriberadKnapp();

  await ensureInmatningData();
  const payload = samlaInmatningData();
  if (!payload) return;
  try {
    const res = await fetch(`${API}/gravplats/${currentGravplatsId}/inmatning`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Kunde inte spara');
    const data = await res.json();
    if (data.gravplats_id != null && data.gravplats_id === currentGravplatsId) {
      inmatningData = data;
      lastInmatningGravplatsId = currentGravplatsId;
    }
    inmatningDirty = false;
    uppdateraInmatningSparaKnapp();
    visaSparStatus('Sparat.', true);
  } catch (e) {
    inmatningData.fardigtranskriberad = !inmatningData.fardigtranskriberad;
    uppdateraFardigtranskriberadKnapp();
    visaSparStatus('Kunde inte spara: ' + (e && e.message ? e.message : 'okänt fel'), false);
  }
});

function applyVyFromUrl() {
  const params = new URLSearchParams(window.location.search);
  vertikalVy = params.get('vy') === 'vertikal';
  const innehall = document.getElementById('gp-innehall');
  const btn = document.getElementById('gp-btn-vy');
  if (innehall) innehall.classList.toggle('gp-vertikal-vy', vertikalVy);
  if (btn) btn.textContent = vertikalVy ? 'Horisontell vy' : 'Vertikal vy';
}

async function initFromUrl() {
  applyVyFromUrl();
  const parsed = parseGravplatsSlugFromPath();
  const tradVy = document.getElementById('gp-trad-vy');
  const innehall = document.getElementById('gp-innehall');
  if (!parsed) {
    if (tradVy) tradVy.hidden = false;
    if (innehall) innehall.hidden = true;
    laddaTrad();
    return;
  }
  await laddaTrad();
  valdKyrkogard = parsed.kyrkogard;
  valdKvarter = parsed.kvarter;
  if (tradVy) tradVy.hidden = true;
  if (innehall) innehall.hidden = false;
  await laddaGravplatserForKvarter(parsed.gravplatsnummer);
  applyVyFromUrl();
}

initFromUrl();
