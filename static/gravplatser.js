/**
 * Gravregister – Visa och Inmatning: träd (kyrkogård → kvarter), sedan visning av gravplatser.
 */

const API = '/api';

const state = {
  tradData: { kyrkogardar: [], kvarter_per_kyrkogard: {}, antal_per_kvarter: {}, antal_per_kyrkogard: {} },
  /** Cache av gravplatslistor per kyrkogård+kvarter (för trädets utfallna kvarter). */
  gravplatserTradCache: {},
  valdKyrkogard: null,
  valdKvarter: null,
  gravplatserLista: [],
  currentIndex: 0,
  cacheBust: Date.now(),
  currentExtramaterial: [],
  currentExtramaterialMapp: null,
  /** URL:er för aktuell gravplatsens halvor (för lightbox). */
  currentHalvorUrls: [],
  /** Halvor + URL-info för att matcha skisser till källbild (samma ordning som halvor). */
  currentHalvorList: [],
  currentHalvorUrlList: [],
  /** start_sida för aktuell gravplats (för att bygga skiss-bild-URL). */
  currentGravplatsStartSida: null,
  visarHelaSidor: false,
  vertikalVy: true,
  /** true = bläddrar användares registreringar (admin); Föregående/Nästa utan kvarterbyten. */
  granskaAnvandareMode: false,
  /** true om inloggad användare är admin – sätts vid auth-init. */
  currentUserIsAdmin: false,
  granskaAnvandareId: null,
  batchJobbMode: false,
  batchJobbId: null,
  currentGravplatsId: null,
  lastInmatningGravplatsId: null,
  inmatningData: null,
  inmatningDirty: false,
  /** true = visa formulärfält (redigera), false = visa läsvy (layout). */
  inmatningRedigerar: false,
  sparatClaudeSvar: null, // { svar_json, ocr_kommentar, skapad_den, username }
  _gravplatsHarBatchPagar: false,   // om aktuell gravplats är i pågående batch
  _claudeBatchBlockEnskild: true,   // inställning: blockera enskild körning
  /** Ordning på inmatningssektioner för aktuell användare. */
  inmatningSectionsOrder: ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'],
  /** Används för att hålla ett pågående fetch av tradData (undviker dubbelhämtning). */
  tradDataLaddas: null,
  _claudeOcrAbortController: null,
};

/**
 * Uppdaterar vy (halvor, extramaterial, dolda).
 * @param {boolean} [behallInmatningState=false] – om true nollställs inte inmatningsläge (redigera/osparat); använd vid t.ex. Dölj/Visa igen.
 */
async function uppdateraVy(behallInmatningState = false) {
  const ocrBanner = document.getElementById('gp-ocr-kommentar-banner');
  if (ocrBanner) { ocrBanner.hidden = true; ocrBanner.textContent = ''; }
  visaFaltmarkeringar([], {});
  state.aiForslag = null;
  visaAiForslagBanner();
  const batchBanner = document.getElementById('gp-batch-pagar-banner');
  if (batchBanner) { batchBanner.hidden = true; batchBanner.innerHTML = ''; }
  const rubrikEl = document.getElementById('gp-rubrik');
  const halvorEl = document.getElementById('gp-halvor');
  const btnTillbaka = document.getElementById('gp-btn-tillbaka');
  const btnNasta = document.getElementById('gp-btn-nasta');
  if (!rubrikEl || !halvorEl) return;

  const n = state.gravplatserLista.length;
  if (n === 0) {
    rubrikEl.textContent = `Inga gravplatser i ${state.valdKyrkogard} ${state.valdKvarter}.`;
    document.title = 'Gravplatser';
    halvorEl.innerHTML = '';
    if (btnTillbaka) btnTillbaka.disabled = true;
    if (btnNasta) btnNasta.disabled = true;
    state.currentGravplatsId = null;
    state.inmatningData = null;
    state.lastInmatningGravplatsId = null;
    state.inmatningDirty = false;
    state.inmatningRedigerar = false;
    state.sparatClaudeSvar = null;
    const sparaWrap = document.getElementById('gp-inmatning-spara-wrap');
    if (sparaWrap) sparaWrap.hidden = true;
    const avbrytPanelReset = document.getElementById('gp-avbryt-bekraftelse');
    if (avbrytPanelReset) avbrytPanelReset.hidden = true;
    const redigeraBtn = document.getElementById('gp-btn-redigera');
    if (redigeraBtn) redigeraBtn.textContent = 'Redigera gravplatsen';
    const sparatPanelEmpty = document.getElementById('gp-claude-sparat-panel');
    if (sparatPanelEmpty) sparatPanelEmpty.hidden = true;
    uppdateraInmatningSparaKnapp();
    state.currentExtramaterial = [];
    state.currentHalvorUrls = [];
    uppdateraExtramaterialSektion([], null);
    uppdateraInmatningRubrikCounts();
    uppdateraFardigtranskriberadKnapp();
    return;
  }

  const idx = Math.max(0, Math.min(state.currentIndex, n - 1));
  state.currentIndex = idx;
  const gp = state.gravplatserLista[idx];
  state.currentGravplatsId = gp.id;
  const mappNamn = gp.mapp_namn;
  if (state.granskaAnvandareMode || state.batchJobbMode) {
    state.valdKyrkogard = gp.kyrkogard || null;
    state.valdKvarter = gp.kvarter || null;
  }

  rubrikEl.textContent = gp.fullstandigt || [gp.kyrkogard, gp.kvarter, gp.gravplatsnummer].filter(Boolean).join(' ') || '–';
  document.title = rubrikEl.textContent || 'Gravplats';

  await ensureTradData(gp.kyrkogard);
  const nastaKv = getNastaKvarter(gp.kyrkogard, gp.kvarter);
  const foregaendeKv = getForegaendeKvarter(gp.kyrkogard, gp.kvarter);
  const paSistaGravplats = idx >= n - 1;
  const paForstaGravplats = idx <= 0;

  if (state.granskaAnvandareMode || state.batchJobbMode) {
    if (btnTillbaka) {
      btnTillbaka.disabled = paForstaGravplats;
      btnTillbaka.textContent = '← Föregående';
    }
    if (btnNasta) {
      btnNasta.disabled = paSistaGravplats;
      btnNasta.textContent = 'Nästa →';
    }
  } else {
    if (btnTillbaka) {
      btnTillbaka.disabled = paForstaGravplats && !foregaendeKv;
      btnTillbaka.textContent = paForstaGravplats && foregaendeKv ? '← Byt till föregående kvarter' : '← Föregående';
    }
    if (btnNasta) {
      btnNasta.disabled = paSistaGravplats && !nastaKv;
      btnNasta.textContent = paSistaGravplats && nastaKv ? 'Byt till nästa kvarter →' : 'Nästa →';
    }
  }

  const slug = slugForGravplats(gp);
  const path = slug ? `/gravplatser/${slug}` : '/gravplatser';
  let fullUrl = path;
  if (state.granskaAnvandareMode && state.granskaAnvandareId) {
    fullUrl += '?granska_anvandare=' + encodeURIComponent(state.granskaAnvandareId);
    if (!state.vertikalVy) fullUrl += '&vy=horisontell';
  } else if (state.batchJobbMode && state.batchJobbId) {
    fullUrl += '?batch_jobb_id=' + encodeURIComponent(state.batchJobbId);
    if (!state.vertikalVy) fullUrl += '&vy=horisontell';
  } else if (!state.vertikalVy) {
    fullUrl += '?vy=horisontell';
  }
  if (window.location.pathname + (window.location.search || '') !== fullUrl) {
    history.replaceState(null, '', fullUrl);
  }

  const granskaInfoEl = document.getElementById('gp-granska-anvandare-info');
  if (granskaInfoEl) {
    if (state.granskaAnvandareMode && n > 0) {
      granskaInfoEl.innerHTML = 'Granskar användares registreringar (' + (idx + 1) + ' av ' + n + '). <a href="/databasunderhall/granska-anvandare">Avsluta granskning</a>';
      granskaInfoEl.hidden = false;
    } else if (state.batchJobbMode && n > 0) {
      granskaInfoEl.innerHTML = 'Granskar batch-jobb (' + (idx + 1) + ' av ' + n + '). <a href="/batch-ai">Avsluta granskning</a>';
      granskaInfoEl.hidden = false;
    } else {
      granskaInfoEl.hidden = true;
    }
  }

    const base = `${API}/mappar/${encodeURIComponent(mappNamn)}/sida`;
    const offsetQ = 'offset=0';
    const cacheQ = `_v=${state.cacheBust}`;
    const split1och3 = (727 / 1597).toFixed(4);
    const split2 = (870 / 1595).toFixed(4);

  try {
    const params = new URLSearchParams();
    if (gp.kyrkogard) params.set('kyrkogard', gp.kyrkogard);
    if (gp.kvarter) params.set('kvarter', gp.kvarter);
    if (gp.gravplatsnummer) params.set('gravplatsnummer', gp.gravplatsnummer);
    const halvorRes = await fetch(`${API}/mappar/${encodeURIComponent(mappNamn)}/gravplats/halvor?${params}`, { credentials: 'include' });
    if (!halvorRes.ok) throw new Error('Kunde inte hämta halvor');
    const halvorData = await halvorRes.json();
    const halvor = halvorData.halvor || [];
    const config = halvorData.config || {};
    const delaSidor = config.dela_sidor || 'hojdled';
    const extramaterial = halvorData.extramaterial || [];
    state.currentExtramaterial = extramaterial;
    state.currentExtramaterialMapp = mappNamn;
    const gpFromApi = halvorData.gravplats;
    state.currentGravplatsStartSida = gpFromApi?.start_sida ?? gp?.start_sida ?? null;

    const initialUrl = (halvaUrl, helaUrl) => (state.visarHelaSidor && halvaUrl !== helaUrl ? helaUrl : halvaUrl);

    const halvorMedUrl = halvor.map((h) => {
      let halvaUrl;
      let helaUrl;
      let pdfUrl = null;
      if (h.redan_halva && h.filnamn) {
        halvaUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/fil/${encodeURIComponent(h.filnamn)}/bild?${cacheQ}`;
        helaUrl = halvaUrl;
        pdfUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/fil/${encodeURIComponent(h.filnamn)}`;
      } else {
        helaUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/sida/${h.content_sida}?${cacheQ}`;
        if (h.filnamn) {
          pdfUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/fil/${encodeURIComponent(h.filnamn)}`;
        }
        if (delaSidor === 'ingen') {
          halvaUrl = helaUrl;
        } else if (h.segment_index != null) {
          halvaUrl = `${base}/${h.content_sida}/halva?${offsetQ}&segment=${h.segment_index}&${cacheQ}`;
          if (h.position != null && h.position >= 1 && h.position <= 3) {
            halvaUrl += `&position=${h.position}`;
          }
        } else {
          const pos = h.content_sida - (gp.start_sida || 0);
          const split = pos === 1 ? split2 : split1och3;
          halvaUrl = `${base}/${h.content_sida}/halva?${offsetQ}&halva=${h.halva}&split=${split}&${cacheQ}`;
        }
      }
      return { halvaUrl, helaUrl, pdfUrl };
    });
    state.currentHalvorUrls = halvorMedUrl.map((x) => initialUrl(x.halvaUrl, x.helaUrl));
    state.currentHalvorList = halvor;
    state.currentHalvorUrlList = halvorMedUrl;

    const esc = (s) => (s || '').replace(/"/g, '&quot;');
    halvorEl.innerHTML = halvorMedUrl.map((x, i) => {
      const imgSrc = initialUrl(x.halvaUrl, x.helaUrl);
      const pdfKnapp = x.pdfUrl
        ? `<a href="${x.pdfUrl}" target="_blank" rel="noopener" class="gravplatser-halva-knapp">Öppna PDF</a>`
        : '';
      const h = halvor[i];
      const seg = h.segment_index != null ? h.segment_index : (h.halva === 'ovre' ? 0 : 1);
      const isRegularHalva = h && h.content_sida != null && (h.halva != null || h.segment_index != null);
      const doljKnapp = isRegularHalva
        ? `<button type="button" class="gravplatser-halva-dolj" data-content-sida="${h.content_sida}" data-segment-index="${seg}" data-halva="${esc(h.halva || (seg === 0 ? 'ovre' : 'nedre'))}" title="Dölj från gravplatsbilderna">Dölj</button>`
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
        const segmentIndex = btn.dataset.segmentIndex != null ? parseInt(btn.dataset.segmentIndex, 10) : null;
        const halva = btn.dataset.halva;
        if (isNaN(contentSida) || (segmentIndex == null && !halva) || state.currentGravplatsId == null) return;
        btn.disabled = true;
        try {
          const body = { content_sida: contentSida };
          if (segmentIndex != null) body.segment_index = segmentIndex;
          if (halva) body.halva = halva;
          const res = await fetch(`${API}/gravplats/${state.currentGravplatsId}/dold-halva`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'include',
          });
          if (!res.ok) throw new Error('Kunde inte uppdatera');
          await uppdateraVy(true);
        } catch (err) {
          btn.disabled = false;
          showToast('Kunde inte uppdatera: ' + (err.message || 'nätverksfel'), 'fel');
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
    state.currentExtramaterial = [];
    state.currentHalvorUrls = [];
    state.currentHalvorList = [];
    state.currentHalvorUrlList = [];
    state.currentGravplatsStartSida = null;
    uppdateraExtramaterialSektion([], null);
    uppdateraDoldaSektion([], null, null, 0);
  }
  if (!behallInmatningState) {
    state.inmatningDirty = false;
    uppdateraInmatningSektionerVidGravplatsbyte();
  }
  uppdateraInmatningSparaKnapp();
}

/**
 * Om det finns osparade ändringar: visa bekräftelsepanelen och lagra action att köra vid bekräftelse.
 * Returnerar false om blockerad, true om fritt att navigera.
 * @param {Function|null} [action] - Körs om användaren väljer "Avbryt ändå". Null = avsluta redigeringsläget.
 */
let _pendingNavigeringAction = null;
function dirtyGuard(action) {
  if (state.inmatningDirty && !state.batchJobbMode) {
    _pendingNavigeringAction = action || null;
    const panel = document.getElementById('gp-avbryt-bekraftelse');
    if (panel) panel.hidden = false;
    return false;
  }
  return true;
}

function tillbaka() {
  if (state.currentIndex > 0) {
    state.currentIndex--;
    uppdateraVy();
  }
}

function nasta() {
  if (state.currentIndex < state.gravplatserLista.length - 1) {
    state.currentIndex++;
    uppdateraVy();
  }
}

/** Returnerar nästa kvarter på angiven kyrkogård, eller null. Om kyrkogard/kvarter utelämnas används state.valdKyrkogard/state.valdKvarter. */
function getNastaKvarter(kyrkogard, kvarter) {
  const kg = (kyrkogard != null ? kyrkogard : state.valdKyrkogard) || '';
  const kv = (kvarter != null ? kvarter : state.valdKvarter) || '';
  if (!kg || !kv) return null;
  const lista = getKvarterListaForKyrkogard(kg);
  const vald = String(kv).trim();
  const i = lista.findIndex((k) => kvarterMatch((k || '').trim(), vald));
  return i >= 0 && i < lista.length - 1 ? (lista[i + 1] || '').trim() : null;
}

/** Returnerar föregående kvarter på angiven kyrkogård, eller null. */
function getForegaendeKvarter(kyrkogard, kvarter) {
  const kg = (kyrkogard != null ? kyrkogard : state.valdKyrkogard) || '';
  const kv = (kvarter != null ? kvarter : state.valdKvarter) || '';
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

/** Hämtar kvarterlistan för kyrkogård (från state.tradData). Matchar kyrkogårdsnyckel med trim. */
function getKvarterListaForKyrkogard(kyrkogard) {
  const k = (kyrkogard || '').trim();
  if (!k) return [];
  const raw = state.tradData.kvarter_per_kyrkogard[kyrkogard] || state.tradData.kvarter_per_kyrkogard[k];
  if (Array.isArray(raw)) return raw;
  const key = Object.keys(state.tradData.kvarter_per_kyrkogard || {}).find(
    (kk) => (kk || '').trim().toLowerCase() === k.toLowerCase()
  );
  return key ? (state.tradData.kvarter_per_kyrkogard[key] || []) : [];
}

/** Ser till att state.tradData har kvarterlistan för kyrkogården (hämtar trädet vid behov). */
async function ensureTradData(kyrkogard) {
  const kg = (kyrkogard || state.valdKyrkogard || '').trim();
  if (!kg) return;
  const lista = getKvarterListaForKyrkogard(kg);
  if (lista.length > 0) return;
  if (state.tradDataLaddas) return state.tradDataLaddas;
  state.tradDataLaddas = fetchTradData();
  await state.tradDataLaddas;
  state.tradDataLaddas = null;
}

/** Byt till nästa kvarter (första gravplatsen). Endast vid klick – inte piltangent. */
async function bytTillNastaKvarter() {
  const nastaKv = getNastaKvarter();
  if (!nastaKv) return;
  state.valdKvarter = nastaKv;
  await laddaGravplatserForKvarter();
}

/** Byt till föregående kvarter (sista gravplatsen). Endast vid klick – inte piltangent. */
async function bytTillForegaendeKvarter() {
  const foregaende = getForegaendeKvarter();
  if (!foregaende) return;
  state.valdKvarter = foregaende;
  await laddaGravplatserForKvarter(null, true);
}


document.getElementById('gp-btn-tillbaka-kvarter')?.addEventListener('click', () => {
  window.location.href = '/gravplatser';
});
document.getElementById('gp-btn-tillbaka')?.addEventListener('click', () => {
  function doNav() {
    if (state.granskaAnvandareMode || state.batchJobbMode) { tillbaka(); return; }
    const foregaendeKv = getForegaendeKvarter();
    if (state.currentIndex <= 0 && foregaendeKv) bytTillForegaendeKvarter();
    else tillbaka();
  }
  if (!dirtyGuard(doNav)) return;
  doNav();
});
document.getElementById('gp-btn-nasta')?.addEventListener('click', () => {
  function doNav() {
    if (state.granskaAnvandareMode || state.batchJobbMode) { nasta(); return; }
    const nastaKv = getNastaKvarter();
    if (state.currentIndex >= state.gravplatserLista.length - 1 && nastaKv) bytTillNastaKvarter();
    else nasta();
  }
  if (!dirtyGuard(doNav)) return;
  doNav();
});
document.getElementById('gp-btn-toggle-hela')?.addEventListener('click', toggleHelaSidor);
document.getElementById('gp-btn-vy')?.addEventListener('click', toggleVertikalVy);


document.getElementById('gp-btn-rapport')?.addEventListener('click', openRapportModal);
document.getElementById('gp-rapport-avbryt')?.addEventListener('click', () => {
  const m = document.getElementById('gp-rapport-modal');
  if (m) m.hidden = true;
});
document.getElementById('gp-rapport-skapa')?.addEventListener('click', () => {
  skapaRapportUtskrift().catch((e) => showToast('Rapport: ' + (e.message || 'fel'), 'fel'));
});

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
  if (!state.inmatningRedigerar || !e.target.closest('#gp-inmatning')) return;
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
  if (next && inmatning && (inmatning.contains(next) || next === ocrFaltIkonBtn || next === window.gpOcrBtnEf || next === window.gpOcrBtnFe || next === window.gpOcrBtnF || next === window.gpOcrBtnAdress)) return;
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
    ocrNamnLage = null;
    ocrAdressLage = false;
    ocrFoddenamnFalt = null;
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
document.getElementById('gp-lightbox-zoom-in')?.addEventListener('click', lightboxZoomIn);
document.getElementById('gp-lightbox-zoom-out')?.addEventListener('click', lightboxZoomOut);
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
    if (ocrModalAdressLage) closeOcrModal(false);
    else if (ocrModalNamnLage && ocrNamnSplitIndex == null) closeOcrModal(false);
    else closeOcrModal(true);
  }
});
/* ── Samlad keydown-lyssnare ──────────────────────────────────────────────────
   Prioritetsordning:
   1. Lightbox (fångar alla tangenter när den är öppen)
   2. Modals med Escape-hantering (OCR, skiss, rapport)
   3. Escape i inmatningsfält → blur
   4. OCR väntar-på-bild-läge (Escape)
   5. Sidan är inte laddad / gömd → avbryt
   6. Native <dialog>-modals öppna (historik, kortkommandon) → avbryt
   7. Ctrl+S → spara
   8. Övriga genvägar (kräver att inget inputfält har fokus)
─────────────────────────────────────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  // 1. Lightbox
  const lb = document.getElementById('gp-lightbox');
  if (lb && !lb.hidden) {
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') { lightboxPrev(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { lightboxNext(); e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') { lightboxZoomIn(); e.preventDefault(); }
    else if (e.key === '-') { lightboxZoomOut(); e.preventDefault(); }
    return;
  }

  // 2. Modals med explicit Escape-hantering
  const ocrModal = document.getElementById('gp-ocr-modal');
  if (ocrModal && !ocrModal.hidden) {
    if (e.key === 'Escape') { closeOcrModal(false); e.preventDefault(); }
    return;
  }
  const skissModal = document.getElementById('gp-skiss-modal');
  if (skissModal && !skissModal.hidden) {
    if (e.key === 'Escape') { document.getElementById('gp-skiss-avbryt')?.click(); e.preventDefault(); }
    return;
  }
  const rapportModal = document.getElementById('gp-rapport-modal');
  if (rapportModal && !rapportModal.hidden) {
    if (e.key === 'Escape') { rapportModal.hidden = true; e.preventDefault(); }
    return;
  }

  // 3. Escape i inmatningsfält → blur (möjliggör nästa tangenttryck som genväg)
  if (e.target.tagName && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName.toUpperCase())) {
    if (e.key === 'Escape') { e.target.blur(); e.preventDefault(); }
    return;
  }

  // 4. OCR väntar på bild-läge
  if (e.key === 'Escape' && ocrVantarPaBild) {
    ocrVantarPaBild = false;
    ocrNamnLage = null;
    ocrAdressLage = false;
    ocrFoddenamnFalt = null;
    uppdateraOcrKnapp();
    return;
  }

  // 5. Sidan inte laddad
  if (!document.getElementById('gp-innehall') || document.getElementById('gp-innehall').hidden) return;

  // 6. Native <dialog>-modals öppna → låt webbläsaren hantera Escape, blockera övriga genvägar
  const historikModal = document.getElementById('gp-historik-modal');
  if (historikModal && historikModal.open) return;
  const kortDialog = document.getElementById('gp-kortkommandon-dialog');
  if (kortDialog && kortDialog.open) return;

  // 7. Ctrl+S → spara
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    if (state.inmatningRedigerar) { sparaInmatning(); e.preventDefault(); }
    return;
  }

  // 8. Övriga genvägar (ej när inputfält har fokus – redan hanterat i steg 3)
  if (e.key === 'ArrowLeft') {
    if (state.currentIndex > 0) {
      if (!dirtyGuard(() => tillbaka())) { e.preventDefault(); return; }
      tillbaka();
    }
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    if (state.currentIndex < state.gravplatserLista.length - 1) {
      if (!dirtyGuard(() => nasta())) { e.preventDefault(); return; }
      nasta();
    }
    e.preventDefault();
  } else if (e.key === 'e' || e.key === 'E') {
    toggleRedigeraVy();
    e.preventDefault();
  } else if (e.key === 'h' || e.key === 'H') {
    const helaSidorBtn = document.getElementById('gp-btn-toggle-hela');
    if (helaSidorBtn && !helaSidorBtn.hidden) { toggleHelaSidor(); e.preventDefault(); }
  } else if (e.key === 'v' || e.key === 'V') {
    toggleVertikalVy();
    e.preventDefault();
  } else if (e.key === 'r' || e.key === 'R') {
    openRapportModal();
    e.preventDefault();
  } else if (e.key === 'f' || e.key === 'F') {
    const fardigBtn = document.getElementById('gp-btn-fardigtranskriberad');
    if (fardigBtn && !fardigBtn.hidden && !fardigBtn.disabled) { fardigBtn.click(); e.preventDefault(); }
  } else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey) {
    const skissBtn = document.getElementById('gp-lagg-till-skiss');
    if (skissBtn && !skissBtn.hidden && !skissBtn.disabled) { skissBtn.click(); e.preventDefault(); }
  } else if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey) {
    const historikBtn = document.getElementById('gp-btn-historik');
    if (historikBtn && !historikBtn.hidden && !historikBtn.disabled) { historikBtn.click(); e.preventDefault(); }
  } else if (e.key === '?') {
    kortDialog?.showModal();
    e.preventDefault();
  } else if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
    const claudeBtn = document.getElementById('gp-claude-ocr-btn');
    if (claudeBtn && !claudeBtn.hidden && !claudeBtn.disabled) { claudeBtn.click(); e.preventDefault(); }
  }
});

(function () {
  const dialog = document.getElementById('gp-kortkommandon-dialog');
  const openBtn = document.getElementById('gp-btn-kortkommandon');
  const closeBtn = document.getElementById('gp-kortkommandon-stang');
  if (!dialog) return;

  function uppdateraKortkommandoDialog() {
    const villkorliga = {
      'gp-kortk-rad-claude':      document.getElementById('gp-claude-ocr-btn'),
      'gp-kortk-rad-historik':    document.getElementById('gp-btn-historik'),
      'gp-kortk-rad-hela-sidan':  document.getElementById('gp-btn-toggle-hela'),
    };
    for (const [rowId, btn] of Object.entries(villkorliga)) {
      const row = document.getElementById(rowId);
      if (row) row.hidden = !btn || btn.hidden;
    }
  }

  openBtn?.addEventListener('click', () => { uppdateraKortkommandoDialog(); dialog.showModal(); });
  closeBtn?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
})();

const DATUM_FORMAT_TEXT = 'Giltiga format: YYYY, YYYY-MM eller YYYY-MM-DD';

const URNA_VAL = [
  { v: '', l: 'Ej valt' },
  { v: 'urna', l: 'Urna' },
  { v: 'kista', l: 'Kista' },
  { v: 'okant', l: 'Okänt' },
];


document.getElementById('gp-btn-historik')?.addEventListener('click', oppnaHistorikModal);
document.getElementById('gp-historik-modal-stang')?.addEventListener('click', function() {
  document.getElementById('gp-historik-modal')?.close();
});
document.getElementById('gp-historik-modal')?.addEventListener('click', function(e) {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

async function sparaInmatning() {
  if (state.currentGravplatsId == null) return;
  if (!state.inmatningDirty) return;
  await ensureInmatningData();
  if (!valideraAllaDatumFalt()) return;
  const payload = samlaInmatningData();
  if (!payload) return;
  const sparaKnapp = document.getElementById('gp-inmatning-spara');
  if (sparaKnapp) sparaKnapp.disabled = true;
  let achievementsBefore = null;
  try {
    const beforeRes = await fetch(`${API}/me/achievements`, { credentials: 'include' });
    if (beforeRes.ok) achievementsBefore = await beforeRes.json();
  } catch (_) { /* ignorerar */ }
  try {
    const res = await fetch(`${API}/gravplats/${state.currentGravplatsId}/inmatning`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      visaSparStatus(data.detail || 'Gravplatsen har ändrats av någon annan. Ladda om sidan.', false);
      state.lastInmatningGravplatsId = null;
      state.inmatningData = null;
      await ensureInmatningData();
      const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
      sektioner.forEach((s) => renderInmatningSektion(s));
      return;
    }
    if (!res.ok) throw new Error('Kunde inte spara');
    const data = await res.json();
    if (data.gravplats_id != null && data.gravplats_id === state.currentGravplatsId) {
      state.inmatningData = data;
      state.lastInmatningGravplatsId = state.currentGravplatsId;
    }
    (payload.extramaterial_kommentarer || []).forEach((item) => {
      const em = state.currentExtramaterial.find((e) => e.id === item.id);
      if (em) em.kommentar = item.kommentar || '';
    });
    state.inmatningDirty = false;
    state.aiForslag = null;  // sparat: graven är nu påbörjad, inte längre bara AI-läst
    visaAiForslagBanner();
    visaOsakraFalt({});
    hamtaSparadRimlighet();
    uppdateraInmatningSparaKnapp();
    uppdateraFardigtranskriberadKnapp();
    visaSparStatus('Sparat.', true);
    visaSparToasts(achievementsBefore, data);
  } catch (e) {
    visaSparStatus('Kunde inte spara: ' + e.message, false);
  } finally {
    uppdateraInmatningSparaKnapp();
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

async function hamtaOcr(lokal) {
  if (state.currentGravplatsId == null) return;
  if (state._gravplatsHarBatchPagar && !state._claudeBatchBlockEnskild) {
    if (!await showConfirm('Gravplatsen ingår i ett pågående batch-jobb. Vill du ändå köra en enskild körning nu?')) return;
  }
  const btn = document.getElementById(lokal ? 'gp-lokal-ocr-btn' : 'gp-claude-ocr-btn');
  const andraBtn = document.getElementById(lokal ? 'gp-claude-ocr-btn' : 'gp-lokal-ocr-btn');
  const knapptext = btn.textContent;
  const kalla = lokal ? 'den lokala modellen' : 'Claude';
  const avbrytBtn = document.getElementById('gp-claude-avbryt-btn');
  const bannerEl = document.getElementById('gp-ocr-kommentar-banner');
  state._claudeOcrAbortController = new AbortController();
  btn.disabled = true;
  if (andraBtn) andraBtn.disabled = true;
  btn.textContent = 'Hämtar…';
  if (avbrytBtn) avbrytBtn.hidden = false;
  if (bannerEl) { bannerEl.hidden = true; bannerEl.textContent = ''; }
  try {
    const url = lokal ? `${API}/ocr/lokal/gravplats/${state.currentGravplatsId}` : `${API}/ocr/gravplats/${state.currentGravplatsId}`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      signal: state._claudeOcrAbortController.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    await ensureInmatningData();
    prefillFranClaude(data);
    visaFaltmarkeringar(data._varningar, data._osakra);
    gpPlayPling();
    if (data.ocr_kommentar && bannerEl) {
      bannerEl.innerHTML = formatOcrKommentar(data.ocr_kommentar);
      bannerEl.hidden = false;
    }
    hamtaSparatClaudeSvar();
  } catch (err) {
    if (err.name === 'AbortError') { /* användaren avbröt – inget felmeddelande */ }
    else showToast('Kunde inte hämta data från ' + kalla + ': ' + (err.message || 'okänt fel'), 'fel');
  } finally {
    state._claudeOcrAbortController = null;
    btn.disabled = false;
    if (andraBtn) andraBtn.disabled = false;
    btn.textContent = knapptext;
    if (avbrytBtn) avbrytBtn.hidden = true;
  }
}

document.getElementById('gp-claude-ocr-btn')?.addEventListener('click', () => hamtaOcr(false));
document.getElementById('gp-lokal-ocr-btn')?.addEventListener('click', () => hamtaOcr(true));

document.getElementById('gp-claude-avbryt-btn')?.addEventListener('click', function () {
  if (state._claudeOcrAbortController) state._claudeOcrAbortController.abort();
});

const gpInmatningEl = document.getElementById('gp-inmatning');
if (gpInmatningEl) {
  gpInmatningEl.addEventListener('input', () => { state.inmatningDirty = true; uppdateraInmatningSparaKnapp(); });
  gpInmatningEl.addEventListener('change', () => { state.inmatningDirty = true; uppdateraInmatningSparaKnapp(); });
}
uppdateraInmatningSparaKnapp();

function avbrytRedigeringBekraftad() {
  const panel = document.getElementById('gp-avbryt-bekraftelse');
  if (panel) panel.hidden = true;
  state.inmatningDirty = false;
  if (_pendingNavigeringAction) {
    state.inmatningRedigerar = false;
    const action = _pendingNavigeringAction;
    _pendingNavigeringAction = null;
    action();
  } else {
    toggleRedigeraVy();
  }
}

document.getElementById('gp-avbryt-bekraftelse-ja')?.addEventListener('click', avbrytRedigeringBekraftad);
document.getElementById('gp-avbryt-bekraftelse-nej')?.addEventListener('click', () => {
  _pendingNavigeringAction = null;
  const panel = document.getElementById('gp-avbryt-bekraftelse');
  if (panel) panel.hidden = true;
});

function toggleRedigeraVy() {
  if (state.inmatningRedigerar) {
    if (state.inmatningDirty) {
      dirtyGuard(); // ingen pending action = avsluta redigeringsläget vid bekräftelse
      return;
    }
    state.inmatningRedigerar = false;
    state.lastInmatningGravplatsId = null;
    const sparaWrap = document.getElementById('gp-inmatning-spara-wrap');
    if (sparaWrap) sparaWrap.hidden = true;
    const avbrytPanel = document.getElementById('gp-avbryt-bekraftelse');
    if (avbrytPanel) avbrytPanel.hidden = true;
    state.sparatClaudeSvar = null;
    const sparatPanel = document.getElementById('gp-claude-sparat-panel');
    if (sparatPanel) sparatPanel.hidden = true;
    const batchBannerClose = document.getElementById('gp-batch-pagar-banner');
    if (batchBannerClose) { batchBannerClose.hidden = true; batchBannerClose.innerHTML = ''; }
    state._gravplatsHarBatchPagar = false;
    ['gp-claude-ocr-btn', 'gp-lokal-ocr-btn'].forEach((id) => {
      const ocrBtnClose = document.getElementById(id);
      if (ocrBtnClose) ocrBtnClose.disabled = false;
    });
    const btn = document.getElementById('gp-btn-redigera');
    if (btn) btn.textContent = 'Redigera gravplatsen';
    expandAllInmatningSektioner();
    const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
    sektioner.forEach((s) => {
      ensureInmatningData().then((ok) => { if (ok) renderInmatningSektion(s); });
    });
    // Lämnar man utan att spara visas AI-förslaget igen, som när graven öppnades
    if (state.aiForslag) {
      state.aiForslag = null;
      ensureInmatningData().then(() => visaAiForslagOmAiLast());
    }
    if (state.currentExtramaterial.length > 0 && state.currentExtramaterialMapp) {
      uppdateraExtramaterialSektion(state.currentExtramaterial, state.currentExtramaterialMapp);
    }
    visaAiForslagBanner();
    uppdateraFardigtranskriberadKnapp();
  } else {
    state.inmatningRedigerar = true;
    const sparaWrap = document.getElementById('gp-inmatning-spara-wrap');
    if (sparaWrap) sparaWrap.hidden = false;
    hamtaSparatClaudeSvar();
    hamtaBatchPagarInfo();
    const btn = document.getElementById('gp-btn-redigera');
    if (btn) btn.textContent = 'Sluta redigera gravplats';
    expandAllInmatningSektioner();
    const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
    sektioner.forEach((s) => {
      const innehall = document.getElementById(`gp-innehall-${s}`);
      if (innehall) renderInmatningSektion(s);
    });
    if (state.currentExtramaterial.length > 0 && state.currentExtramaterialMapp) {
      uppdateraExtramaterialSektion(state.currentExtramaterial, state.currentExtramaterialMapp);
    }
    if (state.aiForslag && state.aiForslag.gravplatsId === state.currentGravplatsId) {
      markInmatningDirty();
      visaAiForslagBanner();
      visaFaltmarkeringar(state.aiForslag.svar.varningar, state.aiForslag.svar.osakra);
    }
    else if ((state.rimlighetsvarningar || []).length) {
      // Varningar på sparad data hämtades i visningsläget, utan textfält. Rama in fälten nu.
      visaRimlighetsvarningar(state.rimlighetsvarningar);
    }
    uppdateraInmatningSparaKnapp();
    uppdateraFardigtranskriberadKnapp();
  }
}

document.getElementById('gp-btn-redigera')?.addEventListener('click', toggleRedigeraVy);

document.getElementById('gp-claude-applicera-btn')?.addEventListener('click', function() {
  if (!state.sparatClaudeSvar) return;
  visaDiffDialog(state.sparatClaudeSvar.svar_json, function() {
    prefillFranClaude(state.sparatClaudeSvar.svar_json);
    visaFaltmarkeringar(state.sparatClaudeSvar.varningar, state.sparatClaudeSvar.osakra);
    gpPlayPling();
    const bannerEl = document.getElementById('gp-ocr-kommentar-banner');
    if (state.sparatClaudeSvar.ocr_kommentar && bannerEl) {
      bannerEl.innerHTML = formatOcrKommentar(state.sparatClaudeSvar.ocr_kommentar);
      bannerEl.hidden = false;
    }
  });
});


document.getElementById('gp-btn-fardigtranskriberad')?.addEventListener('click', async () => {
  if (!state.inmatningRedigerar || state.currentGravplatsId == null || !state.inmatningData) return;
  state.inmatningData.fardigtranskriberad = !state.inmatningData.fardigtranskriberad;
  uppdateraFardigtranskriberadKnapp();
  const fardigBtn = document.getElementById('gp-btn-fardigtranskriberad');
  if (fardigBtn) fardigBtn.disabled = true;

  let achievementsBefore = null;
  try {
    const beforeRes = await fetch(`${API}/me/achievements`, { credentials: 'include' });
    if (beforeRes.ok) achievementsBefore = await beforeRes.json();
  } catch (_) { /* ignorerar */ }

  await ensureInmatningData();
  const payload = samlaInmatningData();
  if (!payload) { if (fardigBtn) fardigBtn.disabled = false; return; }
  try {
    const res = await fetch(`${API}/gravplats/${state.currentGravplatsId}/inmatning`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    if (res.status === 409) {
      state.lastInmatningGravplatsId = null;
      state.inmatningData = null;
      await ensureInmatningData();
      uppdateraFardigtranskriberadKnapp();
      visaSparStatus('Gravplatsen har ändrats av någon annan. Ladda om sidan.', false);
      return;
    }
    if (!res.ok) throw new Error('Kunde inte spara');
    const data = await res.json();
    if (data.gravplats_id != null && data.gravplats_id === state.currentGravplatsId) {
      state.inmatningData = data;
      state.lastInmatningGravplatsId = state.currentGravplatsId;
    }
    (payload.extramaterial_kommentarer || []).forEach((item) => {
      const em = state.currentExtramaterial.find((e) => e.id === item.id);
      if (em) em.kommentar = item.kommentar || '';
    });
    state.inmatningDirty = false;
    uppdateraInmatningSparaKnapp();
    visaSparStatus('Sparat.', true);
    visaSparToasts(achievementsBefore, data);
    if (state.inmatningData.fardigtranskriberad) {
      toggleRedigeraVy();
    }
  } catch (e) {
    state.inmatningData.fardigtranskriberad = !state.inmatningData.fardigtranskriberad;
    uppdateraFardigtranskriberadKnapp();
    visaSparStatus('Kunde inte spara: ' + (e && e.message ? e.message : 'okänt fel'), false);
  } finally {
    uppdateraFardigtranskriberadKnapp();
  }
});

function applyVyFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.vertikalVy = params.get('vy') !== 'horisontell';
  const innehall = document.getElementById('gp-innehall');
  const btn = document.getElementById('gp-btn-vy');
  if (innehall) innehall.classList.toggle('gp-vertikal-vy', state.vertikalVy);
  if (btn) btn.textContent = state.vertikalVy ? 'Horisontell vy' : 'Vertikal vy';
}

async function initFromUrl() {
  applyVyFromUrl();
  const params = new URLSearchParams(window.location.search);
  const granskaAnv = params.get('granska_anvandare');
  const parsed = parseGravplatsSlugFromPath();
  const tradVy = document.getElementById('gp-trad-vy');
  const innehall = document.getElementById('gp-innehall');

  if (parsed && granskaAnv) {
    await laddaTrad();
    state.valdKyrkogard = parsed.kyrkogard;
    state.valdKvarter = parsed.kvarter;
    if (tradVy) tradVy.hidden = true;
    if (innehall) innehall.hidden = false;
    try {
      const res = await fetch(`${API}/admin/databasunderhall/anvandare/${encodeURIComponent(granskaAnv)}/registreringar`, { credentials: 'include' });
      if (!res.ok) throw new Error('Kunde inte hämta registreringar');
      const data = await res.json();
      state.gravplatserLista = data.registreringar || [];
      if (state.gravplatserLista.length === 0) {
        if (innehall) {
          const rubrik = innehall.querySelector('#gp-rubrik');
          if (rubrik) rubrik.textContent = 'Användaren har inga registreringar.';
        }
        document.title = 'Gravplatser';
        applyVyFromUrl();
        return;
      }
      const pathSlug = window.location.pathname.replace(/^\/gravplatser\/?/, '').replace(/\/$/, '');
      const currentSlugDecoded = pathSlug ? decodeURIComponent(pathSlug) : '';
      let idx = state.gravplatserLista.findIndex(function (g) {
        const fs = (g.fullstandigt || [g.kyrkogard, g.kvarter, g.gravplatsnummer].filter(Boolean).join(' ')).trim();
        return fs === currentSlugDecoded;
      });
      if (idx < 0) idx = 0;
      state.currentIndex = idx;
      state.granskaAnvandareMode = true;
      state.granskaAnvandareId = granskaAnv;
      await uppdateraVy();
      applyVyFromUrl();
      return;
    } catch (e) {
      if (innehall) {
        const rubrik = innehall.querySelector('#gp-rubrik');
        if (rubrik) rubrik.textContent = 'Kunde inte ladda användarens registreringar.';
      }
      document.title = 'Gravplatser';
      applyVyFromUrl();
      return;
    }
  }

  const batchJobbIdParam = params.get('batch_jobb_id');
  if (parsed && batchJobbIdParam) {
    await laddaTrad();
    state.valdKyrkogard = parsed.kyrkogard;
    state.valdKvarter = parsed.kvarter;
    if (tradVy) tradVy.hidden = true;
    if (innehall) innehall.hidden = false;
    try {
      const res = await fetch(`${API}/batch-claude/jobb/${encodeURIComponent(batchJobbIdParam)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Kunde inte hämta batch-jobb');
      const data = await res.json();
      // Only include gravplatser with status 'klar' (have Claude responses)
      const poster = (data.poster || []).filter(function(p) { return p.status === 'klar'; });
      state.gravplatserLista = poster.map(function(p) {
        return {
          id: p.gravplats_id,
          kyrkogard: p.kyrkogard,
          kvarter: p.kvarter,
          gravplatsnummer: p.gravplatsnummer,
          mapp_namn: p.mapp_namn,
        };
      });
      let idx = state.gravplatserLista.findIndex(function(g) { return g.kyrkogard === parsed.kyrkogard && g.kvarter === parsed.kvarter && String(g.gravplatsnummer) === String(parsed.gravplatsnummer); });
      if (idx < 0) idx = 0;
      state.currentIndex = idx;
      state.batchJobbMode = true;
      state.batchJobbId = batchJobbIdParam;
      state.batchJobbLokal = data.jobb_typ === 'lokal';
      await uppdateraVy();
      applyVyFromUrl();
      return;
    } catch(e) {
      console.error('Batch-jobb-fel:', e);
    }
  }

  if (!parsed) {
    if (tradVy) tradVy.hidden = false;
    if (innehall) innehall.hidden = true;
    laddaTrad();
    return;
  }
  await laddaTrad();
  state.valdKyrkogard = parsed.kyrkogard;
  state.valdKvarter = parsed.kvarter;
  if (tradVy) tradVy.hidden = true;
  if (innehall) innehall.hidden = false;
  await laddaGravplatserForKvarter(parsed.gravplatsnummer);
  applyVyFromUrl();
}

// Hämta användarpreferenser (inkl. sektionordning) och tillämpa på inmatningssektionerna.
try {
  (window.gpEnsureAuthPromise || (typeof gpEnsureAuth === 'function' && gpEnsureAuth()) || Promise.resolve(null))
    .then((me) => {
      if (me && me.preferences && Array.isArray(me.preferences.inmatning_sections_order)) {
        applyInmatningSectionsOrder(me.preferences.inmatning_sections_order);
      } else {
        applyInmatningSectionsOrder(state.inmatningSectionsOrder);
      }
      if (me) state.currentUsername = me.username || '';
      if (me && me.lokal_ocr_tillganglig) {
        var lokalBtn = document.getElementById('gp-lokal-ocr-btn');
        if (lokalBtn) lokalBtn.hidden = false;
      }
      if (me && !me.claude_tillganglig) {
        var claudeId = ['gp-claude-ocr-btn'];
        if (!me.lokal_ocr_tillganglig) {
          claudeId = claudeId.concat(['gp-lokal-ocr-btn', 'gp-claude-avbryt-btn',
            'gp-claude-sparat-panel', 'gp-ocr-kommentar-banner', 'gp-claude-diff-dialog']);
        }
        claudeId.forEach(function(id) {
          var el = document.getElementById(id);
          if (el) el.remove();
        });
      }
      if (me && me.is_admin) {
        state.currentUserIsAdmin = true;
        const historikBtn = document.getElementById('gp-btn-historik');
        if (historikBtn) historikBtn.hidden = false;
      }
    })
    .catch(() => {
      applyInmatningSectionsOrder(state.inmatningSectionsOrder);
    });
} catch (_) {
  applyInmatningSectionsOrder(state.inmatningSectionsOrder);
}

initFromUrl();
