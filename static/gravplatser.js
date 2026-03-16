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
/** Halvor + URL-info för att matcha skisser till källbild (samma ordning som halvor). */
let currentHalvorList = [];
let currentHalvorUrlList = [];
/** start_sida för aktuell gravplats (för att bygga skiss-bild-URL). */
let currentGravplatsStartSida = null;
let visarHelaSidor = false;
let vertikalVy = true;
/** true = bläddrar användares registreringar (admin); Föregående/Nästa utan kvarterbyten. */
let granskaAnvandareMode = false;
/** true om inloggad användare är admin – sätts vid auth-init. */
let currentUserIsAdmin = false;
let granskaAnvandareId = null;
let batchJobbMode = false;
let batchJobbId = null;
let currentGravplatsId = null;
let lastInmatningGravplatsId = null;
let inmatningData = null;
let inmatningDirty = false;
/** true = visa formulärfält (redigera), false = visa läsvy (layout). */
let inmatningRedigerar = false;
let sparatClaudeSvar = null; // { svar_json, ocr_kommentar, skapad_den, username }
let _gravplatsHarBatchPagar = false;   // om aktuell gravplats är i pågående batch
let _claudeBatchBlockEnskild = true;   // inställning: blockera enskild körning
/** Ordning på inmatningssektioner för aktuell användare. */
let inmatningSectionsOrder = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];


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
    const res = await fetch(`${API}/gravplatser/trad`, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
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
      const res = await fetch(`${API}/gravplatser?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
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
    const res = await fetch(`${API}/gravplatser?${params}`, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
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
    if (innehall) {
      const rubrik = innehall.querySelector('#gp-rubrik');
      if (rubrik) rubrik.textContent = 'Kunde inte ladda gravplatser.';
    }
    document.title = 'Gravplatser';
  }
}

/**
 * Hämtar info om huruvida gravplatsen ingår i ett pågående batch-jobb och visar banner om så är fallet.
 */
async function hamtaBatchPagarInfo() {
  _gravplatsHarBatchPagar = false;
  const banner = document.getElementById('gp-batch-pagar-banner');
  if (banner) { banner.hidden = true; banner.innerHTML = ''; }
  if (currentGravplatsId == null) return;
  try {
    const [batchRes, settingsRes] = await Promise.all([
      fetch(`${API}/batch-claude/gravplats/${currentGravplatsId}/pagar`, { credentials: 'include' }),
      fetch(`${API}/settings/api-keys`, { credentials: 'include' }),
    ]);
    if (settingsRes.ok) {
      const s = await settingsRes.json();
      _claudeBatchBlockEnskild = s.claude_batch_block_enskild !== false;
    }
    if (!batchRes.ok) return;
    const data = await batchRes.json();
    if (!data.pagar) return;
    _gravplatsHarBatchPagar = true;
    // Uppdatera knappens tillstånd
    const ocrBtn = document.getElementById('gp-claude-ocr-btn');
    if (ocrBtn) ocrBtn.disabled = _claudeBatchBlockEnskild;
    if (banner) {
      const datum = data.skapad_den
        ? new Date(data.skapad_den).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })
        : '';
      const jobbLank = document.createElement('a');
      jobbLank.href = '/batch-claude';
      jobbLank.textContent = data.jobb_namn || ('Jobb ' + data.jobb_id);
      banner.appendChild(document.createTextNode('Gravplatsen ingår i batch-jobbet '));
      banner.appendChild(jobbLank);
      if (datum) banner.appendChild(document.createTextNode(` (startat ${datum})`));
      banner.appendChild(document.createTextNode(' och väntar på svar från Anthropic.'));
      banner.hidden = false;
    }
  } catch (_) { /* nätverksfel – visa ingenting */ }
}

/**
 * Uppdaterar vy (halvor, extramaterial, dolda).
 * @param {boolean} [behallInmatningState=false] – om true nollställs inte inmatningsläge (redigera/osparat); använd vid t.ex. Dölj/Visa igen.
 */
async function uppdateraVy(behallInmatningState = false) {
  const ocrBanner = document.getElementById('gp-ocr-kommentar-banner');
  if (ocrBanner) { ocrBanner.hidden = true; ocrBanner.textContent = ''; }
  const batchBanner = document.getElementById('gp-batch-pagar-banner');
  if (batchBanner) { batchBanner.hidden = true; batchBanner.innerHTML = ''; }
  const rubrikEl = document.getElementById('gp-rubrik');
  const halvorEl = document.getElementById('gp-halvor');
  const btnTillbaka = document.getElementById('gp-btn-tillbaka');
  const btnNasta = document.getElementById('gp-btn-nasta');
  if (!rubrikEl || !halvorEl) return;

  const n = gravplatserLista.length;
  if (n === 0) {
    rubrikEl.textContent = `Inga gravplatser i ${valdKyrkogard} ${valdKvarter}.`;
    document.title = 'Gravplatser';
    halvorEl.innerHTML = '';
    if (btnTillbaka) btnTillbaka.disabled = true;
    if (btnNasta) btnNasta.disabled = true;
    currentGravplatsId = null;
    inmatningData = null;
    lastInmatningGravplatsId = null;
    inmatningDirty = false;
    inmatningRedigerar = false;
    sparatClaudeSvar = null;
    const sparaWrap = document.getElementById('gp-inmatning-spara-wrap');
    if (sparaWrap) sparaWrap.hidden = true;
    const redigeraBtn = document.getElementById('gp-btn-redigera');
    if (redigeraBtn) redigeraBtn.textContent = 'Redigera gravplatsen';
    const sparatPanelEmpty = document.getElementById('gp-claude-sparat-panel');
    if (sparatPanelEmpty) sparatPanelEmpty.hidden = true;
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
  if (granskaAnvandareMode || batchJobbMode) {
    valdKyrkogard = gp.kyrkogard || null;
    valdKvarter = gp.kvarter || null;
  }

  rubrikEl.textContent = gp.fullstandigt || [gp.kyrkogard, gp.kvarter, gp.gravplatsnummer].filter(Boolean).join(' ') || '–';
  document.title = rubrikEl.textContent || 'Gravplats';

  await ensureTradData(gp.kyrkogard);
  const nastaKv = getNastaKvarter(gp.kyrkogard, gp.kvarter);
  const foregaendeKv = getForegaendeKvarter(gp.kyrkogard, gp.kvarter);
  const paSistaGravplats = idx >= n - 1;
  const paForstaGravplats = idx <= 0;

  if (granskaAnvandareMode || batchJobbMode) {
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
  if (granskaAnvandareMode && granskaAnvandareId) {
    fullUrl += '?granska_anvandare=' + encodeURIComponent(granskaAnvandareId);
    if (!vertikalVy) fullUrl += '&vy=horisontell';
  } else if (batchJobbMode && batchJobbId) {
    fullUrl += '?batch_jobb_id=' + encodeURIComponent(batchJobbId);
    if (!vertikalVy) fullUrl += '&vy=horisontell';
  } else if (!vertikalVy) {
    fullUrl += '?vy=horisontell';
  }
  if (window.location.pathname + (window.location.search || '') !== fullUrl) {
    history.replaceState(null, '', fullUrl);
  }

  const granskaInfoEl = document.getElementById('gp-granska-anvandare-info');
  if (granskaInfoEl) {
    if (granskaAnvandareMode && n > 0) {
      granskaInfoEl.innerHTML = 'Granskar användares registreringar (' + (idx + 1) + ' av ' + n + '). <a href="/databasunderhall/granska-anvandare">Avsluta granskning</a>';
      granskaInfoEl.hidden = false;
    } else if (batchJobbMode && n > 0) {
      granskaInfoEl.innerHTML = 'Granskar batch-jobb (' + (idx + 1) + ' av ' + n + '). <a href="/batch-claude">Avsluta granskning</a>';
      granskaInfoEl.hidden = false;
    } else {
      granskaInfoEl.hidden = true;
    }
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
    const halvorRes = await fetch(`${API}/mappar/${encodeURIComponent(mappNamn)}/gravplats/halvor?${params}`, { credentials: 'include' });
    if (!halvorRes.ok) throw new Error('Kunde inte hämta halvor');
    const halvorData = await halvorRes.json();
    const halvor = halvorData.halvor || [];
    const config = halvorData.config || {};
    const delaSidor = config.dela_sidor || 'hojdled';
    const extramaterial = halvorData.extramaterial || [];
    currentExtramaterial = extramaterial;
    currentExtramaterialMapp = mappNamn;
    const gpFromApi = halvorData.gravplats;
    currentGravplatsStartSida = gpFromApi?.start_sida ?? gp?.start_sida ?? null;

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
    currentHalvorUrls = halvorMedUrl.map((x) => initialUrl(x.halvaUrl, x.helaUrl));
    currentHalvorList = halvor;
    currentHalvorUrlList = halvorMedUrl;

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
        if (isNaN(contentSida) || (segmentIndex == null && !halva) || currentGravplatsId == null) return;
        btn.disabled = true;
        try {
          const body = { content_sida: contentSida };
          if (segmentIndex != null) body.segment_index = segmentIndex;
          if (halva) body.halva = halva;
          const res = await fetch(`${API}/gravplats/${currentGravplatsId}/dold-halva`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'include',
          });
          if (!res.ok) throw new Error('Kunde inte uppdatera');
          await uppdateraVy(true);
        } catch (err) {
          btn.disabled = false;
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
    currentHalvorList = [];
    currentHalvorUrlList = [];
    currentGravplatsStartSida = null;
    uppdateraExtramaterialSektion([], null);
    uppdateraDoldaSektion([], null, null, 0);
  }
  if (!behallInmatningState) {
    inmatningDirty = false;
    uppdateraInmatningSektionerVidGravplatsbyte();
  }
  uppdateraInmatningSparaKnapp();
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
  sparatClaudeSvar = null;
  const sparaWrap = document.getElementById('gp-inmatning-spara-wrap');
  if (sparaWrap) sparaWrap.hidden = true;
  const redigeraBtn = document.getElementById('gp-btn-redigera');
  if (redigeraBtn) redigeraBtn.textContent = 'Redigera gravplatsen';
  const sparatPanel = document.getElementById('gp-claude-sparat-panel');
  if (sparatPanel) sparatPanel.hidden = true;
  expandAllInmatningSektioner();
  uppdateraInmatningSparaKnapp();
  uppdateraInmatningRubrikCounts();
  const ok = await ensureInmatningData();
  if (ok) {
    const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
    sektioner.forEach((s) => renderInmatningSektion(s));
  }
  uppdateraFardigtranskriberadKnapp();
  if (batchJobbMode) await batchAutoLaddaClaude();
}

/**
 * I batch-granskningsläge: gå automatiskt in i redigeringsläge och ladda in det sparade
 * Claude-svaret. Om gravplatsen redan har inmatad data visas panelen för manuell
 * bekräftelse; annars appliceras svaret direkt.
 */
async function batchAutoLaddaClaude() {
  if (!batchJobbMode || currentGravplatsId == null) return;
  const gpId = currentGravplatsId;

  // Gå in i redigeringsläge
  inmatningRedigerar = true;
  const sparaWrap = document.getElementById('gp-inmatning-spara-wrap');
  if (sparaWrap) sparaWrap.hidden = false;
  const redigeraBtn = document.getElementById('gp-btn-redigera');
  if (redigeraBtn) redigeraBtn.textContent = 'Sluta redigera gravplats';
  uppdateraInmatningSparaKnapp();
  uppdateraFardigtranskriberadKnapp();
  const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
  sektioner.forEach((s) => renderInmatningSektion(s));
  if (currentExtramaterial.length > 0 && currentExtramaterialMapp) {
    uppdateraExtramaterialSektion(currentExtramaterial, currentExtramaterialMapp);
  }

  // Hämta sparat Claude-svar
  try {
    const res = await fetch(`${API}/ocr/gravplats/${gpId}/svar`, { credentials: 'include' });
    if (!res.ok || currentGravplatsId !== gpId) return;
    const data = await res.json();
    if (currentGravplatsId !== gpId) return;
    sparatClaudeSvar = data;

    const bannerEl = document.getElementById('gp-ocr-kommentar-banner');
    if (!inmatningHarNagonData()) {
      // Ingen befintlig data – applicera direkt (inget pling, svaret är redan sparat sedan batch-körningen)
      prefillFranClaude(data.svar_json);
      markInmatningDirty();
      uppdateraFardigtranskriberadKnapp();
      if (data.ocr_kommentar && bannerEl) {
        bannerEl.innerHTML = formatOcrKommentar(data.ocr_kommentar);
        bannerEl.hidden = false;
      }
    } else {
      // Befintlig data finns – visa panel för manuell bekräftelse
      visaSparatClaudeSvar(data);
    }
  } catch (e) {}
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
    const kommentar = em.kommentar || '';
    const kommentarHtml = inmatningRedigerar
      ? `<label class="gp-em-kommentar-label">Kommentar/titel <input type="text" class="gp-em-kommentar-inp" data-em-id="${em.id}" value="${esc(kommentar)}" placeholder="Titel eller kommentar" /></label>`
      : (kommentar ? `<p class="gp-em-kommentar-text">${esc(kommentar)}</p>` : '');
    return `<div class="gp-em-item">
      <button type="button" class="gp-em-miniatyr" data-em-index="${i}" data-bild-url="${esc(bildUrl)}" title="${esc(em.filnamn)}">
        <img src="${bildUrl}" alt="${esc(em.filnamn)}" loading="lazy" />
      </button>
      <div class="gp-em-knapprad">
        <button type="button" class="gp-em-visa-som-grav" data-em-id="${em.id}" data-redan-halva="${redanHalva ? '1' : '0'}" title="${redanHalva ? 'Ta bort från gravplatsbilderna' : 'Lägg till bland gravplatsbilderna'}">${esc(knappText)}</button>
      </div>
      ${kommentarHtml}
    </div>`;
  }).join('');

  miniatyrerEl.querySelectorAll('.gp-em-miniatyr').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.bildUrl;
      const idx = parseInt(btn.dataset.emIndex, 10);
      if (url != null && !isNaN(idx)) openLightbox(idx);
    });
  });

  miniatyrerEl.querySelectorAll('.gp-em-kommentar-inp').forEach((inp) => {
    inp.addEventListener('input', () => markInmatningDirty());
    inp.addEventListener('change', () => markInmatningDirty());
  });

  miniatyrerEl.querySelectorAll('.gp-em-visa-som-grav').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const emId = btn.dataset.emId;
      const redanHalva = btn.dataset.redanHalva === '1';
      if (!emId || !currentExtramaterialMapp) return;
      btn.disabled = true;
      try {
        const res = await fetch(`${API}/mappar/${encodeURIComponent(currentExtramaterialMapp)}/extramaterial/${emId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ redan_halva: !redanHalva }),
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Kunde inte uppdatera');
        await uppdateraVy(true);
      } catch (err) {
        btn.disabled = false;
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
        btn.disabled = true;
        try {
          const res = await fetch(
            `${API}/gravplats/${currentGravplatsId}/dold-halva?content_sida=${contentSida}&halva=${encodeURIComponent(halva)}`,
            { method: 'DELETE' }
          );
          if (!res.ok) throw new Error('Kunde inte uppdatera');
          await uppdateraVy(true);
        } catch (err) {
          btn.disabled = false;
          alert('Kunde inte uppdatera: ' + (err.message || 'nätverksfel'));
        }
      } else {
        const emId = btn.dataset.emId;
        if (!emId || !currentExtramaterialMapp) return;
        btn.disabled = true;
        try {
          const res = await fetch(`${API}/mappar/${encodeURIComponent(currentExtramaterialMapp)}/extramaterial/${emId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dold: false }),
            credentials: 'include',
          });
          if (!res.ok) throw new Error('Kunde inte uppdatera');
          await uppdateraVy(true);
        } catch (err) {
          btn.disabled = false;
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
  const fullUrl = path + (vertikalVy ? '' : '?vy=horisontell');
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


document.getElementById('gp-btn-tillbaka-kvarter')?.addEventListener('click', () => {
  window.location.href = '/gravplatser';
});
document.getElementById('gp-btn-tillbaka')?.addEventListener('click', () => {
  if (granskaAnvandareMode || batchJobbMode) {
    tillbaka();
    return;
  }
  const foregaendeKv = getForegaendeKvarter();
  if (currentIndex <= 0 && foregaendeKv) {
    bytTillForegaendeKvarter();
  } else {
    tillbaka();
  }
});
document.getElementById('gp-btn-nasta')?.addEventListener('click', () => {
  if (granskaAnvandareMode || batchJobbMode) {
    nasta();
    return;
  }
  const nastaKv = getNastaKvarter();
  if (currentIndex >= gravplatserLista.length - 1 && nastaKv) {
    bytTillNastaKvarter();
  } else {
    nasta();
  }
});
document.getElementById('gp-btn-toggle-hela')?.addEventListener('click', toggleHelaSidor);
document.getElementById('gp-btn-vy')?.addEventListener('click', toggleVertikalVy);


document.getElementById('gp-btn-rapport')?.addEventListener('click', openRapportModal);
document.getElementById('gp-rapport-avbryt')?.addEventListener('click', () => {
  const m = document.getElementById('gp-rapport-modal');
  if (m) m.hidden = true;
});
document.getElementById('gp-rapport-skapa')?.addEventListener('click', () => {
  skapaRapportUtskrift().catch((e) => alert('Rapport: ' + (e.message || 'fel')));
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
document.addEventListener('keydown', (e) => {
  const lb = document.getElementById('gp-lightbox');
  if (lb && !lb.hidden) {
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') { lightboxPrev(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { lightboxNext(); e.preventDefault(); }
    return;
  }
  if (e.key === 'Escape' && ocrVantarPaBild) {
    ocrVantarPaBild = false;
    ocrNamnLage = null;
    ocrAdressLage = false;
    ocrFoddenamnFalt = null;
    uppdateraOcrKnapp();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName.toUpperCase())) return;
  if (!document.getElementById('gp-innehall') || document.getElementById('gp-innehall').hidden) return;
  const lb = document.getElementById('gp-lightbox');
  if (lb && !lb.hidden) return;
  const ocrModal = document.getElementById('gp-ocr-modal');
  if (ocrModal && !ocrModal.hidden) return;
  if (e.key === 'ArrowLeft') {
    if (currentIndex > 0) tillbaka();
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    if (currentIndex < gravplatserLista.length - 1) nasta();
    e.preventDefault();
  }
});


async function ensureInmatningData() {
  if (currentGravplatsId == null) return false;
  if (lastInmatningGravplatsId === currentGravplatsId && inmatningData) return true;
  const idForFetch = currentGravplatsId;
  try {
    const res = await fetch(`${API}/gravplats/${idForFetch}/inmatning`, { credentials: 'include' });
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

function inmatningHarNagonData() {
  if (!inmatningData) return false;
  const s = (v) => (v != null && String(v).trim() !== '');
  if (s(inmatningData.storlek) || s(inmatningData.underhall_text) || s(inmatningData.gravrattstid) || s(inmatningData.monument) ||
      s(inmatningData.gravens_utformning) || s(inmatningData.karta_nr) || s(inmatningData.gravbrev_nr) || s(inmatningData.utfordat_den) || s(inmatningData.kommentar))
    return true;
  const inv = inmatningData.innehavare || [];
  if (inv.some((i) => s(i.fornamn) || s(i.efternamn) || s(i.yrke) || s(i.gatuadress) || s(i.postnummer) || s(i.postort) || s(i.kommentar))) return true;
  const na = inmatningData.narmast_anhoriga || [];
  if (na.some((n) => s(n.fornamn) || s(n.efternamn) || s(n.yrke) || s(n.adress) || s(n.kommentar))) return true;
  const gs = inmatningData.gravsatta || [];
  if (gs.some((g) => g.ar_beteckning || s(g.fornamn) || s(g.efternamn) || s(g.gatuadress) || s(g.postnummer) || s(g.postort) || s(g.gravsatt_den) || s(g.kommentar))) return true;
  if (inmatningData.has_skiss || ((inmatningData.skisser || []).length > 0)) return true;
  return false;
}

function uppdateraFardigtranskriberadKnapp() {
  const btn = document.getElementById('gp-btn-fardigtranskriberad');
  if (!btn) return;
  const arFardig = inmatningData && inmatningData.fardigtranskriberad === true;
  const harData = inmatningHarNagonData();
  btn.classList.remove('gp-fardigtranskriberad-ja', 'gp-fardigtranskriberad-paborjad', 'gp-fardigtranskriberad-nej');
  if (arFardig) {
    btn.classList.add('gp-fardigtranskriberad-ja');
    btn.textContent = 'Färdigtranskriberad';
  } else if (harData) {
    btn.classList.add('gp-fardigtranskriberad-paborjad');
    btn.textContent = 'Transkribering påbörjad';
  } else {
    btn.classList.add('gp-fardigtranskriberad-nej');
    btn.textContent = 'Ej transkriberad';
  }
  btn.disabled = currentGravplatsId == null || !inmatningRedigerar;
  uppdateraOcrKnapp();
  uppdateraSenastRedigerad();
}

function uppdateraSenastRedigerad() {
  const el = document.getElementById('gp-senast-redigerad');
  if (!el) return;
  const when = inmatningData && inmatningData.last_edited_at;
  const who = inmatningData && inmatningData.last_edited_by_username;
  if (!when && !who) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  let text = '';
  if (who) text = 'Senast redigerad: ' + who;
  if (when) {
    try {
      const d = new Date(when);
      if (!Number.isNaN(d.getTime())) {
        const datumStr = d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });
        const tidStr = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
        const dt = datumStr + ' kl. ' + tidStr;
        text = text ? text + ' ' + dt : 'Senast redigerad: ' + dt;
      }
    } catch (_) {
      text = text ? text + ' ' + when : 'Senast redigerad: ' + when;
    }
  }
  if (!text && who) text = 'Senast redigerad: ' + who;
  el.textContent = text.trim();
  el.hidden = false;
}

function uppdateraOcrKnapp() {
  const btn = document.getElementById('gp-btn-ocr-omrade');
  const halvorEl = document.getElementById('gp-halvor');
  const harHalvor = halvorEl && halvorEl.querySelectorAll('.gravplatser-halva').length > 0;
  const kanStarta = !!ocrTargetElement && inmatningRedigerar && currentGravplatsId != null && harHalvor;
  const iconSynlig = ocrFaltIkonBtn && ocrFaltIkonBtn.parentElement != null;
  document.body.classList.toggle('gp-ocr-vantar-pa-bild', ocrVantarPaBild);
  const ocrStatusEl = document.getElementById('gp-ocr-status');
  if (ocrStatusEl) ocrStatusEl.textContent = ocrVantarPaBild ? 'Klicka och dra på bildavsnittet för att markera texten.' : '';
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

/** Returnerar true om sektionen saknar data (i visningsläge ska klick då inte fälla ut). */
function arSektionTom(sektion) {
  const d = inmatningData || {};
  switch (sektion) {
    case 'innehavare':
      return (d.innehavare || []).length === 0;
    case 'narmast_anhoriga':
      return (d.narmast_anhoriga || []).length === 0;
    case 'gravplatsen': {
      const s = (v) => (v != null && String(v).trim() !== '');
      return !s(d.underhall_text) && !d.underhall_overstruket && !s(d.gravrattstid) && !s(d.monument) && !s(d.gravens_utformning) && !s(d.utfordat_den) && !s(d.kommentar) && !s(d.karta_nr) && !s(d.gravbrev_nr);
    }
    case 'skiss':
      return (d.skisser || []).length === 0 && !(d.storlek != null && String(d.storlek).trim() !== '');
    case 'gravsatta':
      return (d.gravsatta || []).length === 0;
    default:
      return false;
  }
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
      if (!inmatningRedigerar && arSektionTom(sektion)) {
        btn.setAttribute('aria-expanded', 'false');
        innehall.hidden = true;
        return;
      }
    } else {
      innehall.innerHTML = '<p class="gravplatser-fel">Kunde inte ladda.</p>';
    }
    btn.setAttribute('aria-expanded', 'true');
    innehall.hidden = false;
  });
}

/** Returnerar källbild-URL för en skiss (halva eller extramaterial). */
function getSkissKallaUrl(s) {
  if (!s) return null;
  const cacheQ = `_v=${cacheBust}`;
  const mapp = currentExtramaterialMapp;
  if (!mapp) return null;
  if (s.source_type === 'halva' && s.content_sida != null && s.halva) {
    const base = `${API}/mappar/${encodeURIComponent(mapp)}/sida`;
    const offsetQ = 'offset=0';
    // Matcha mot samma halva som gravplatsvyn (segment + position) så att skissen pekar på rätt bild
    const halvor = currentHalvorList || [];
    const seg = s.segment_index != null ? s.segment_index : (s.halva === 'ovre' ? 0 : 1);
    const match = halvor.find((h) => h.content_sida === s.content_sida && (h.segment_index != null ? h.segment_index === seg : (h.halva === s.halva)));
    if (match && match.segment_index != null) {
      let url = `${base}/${s.content_sida}/halva?${offsetQ}&segment=${match.segment_index}&${cacheQ}`;
      if (match.position != null && match.position >= 1 && match.position <= 3) url += `&position=${match.position}`;
      return url;
    }
    // Fallback för gamla skisser eller när halvor inte laddats: använd halva + split
    const start = currentGravplatsStartSida != null ? currentGravplatsStartSida : 0;
    const pos = s.content_sida - start;
    const split1och3 = (727 / 1597).toFixed(4);
    const split2 = (870 / 1595).toFixed(4);
    const split = pos === 1 ? split2 : split1och3;
    return `${base}/${s.content_sida}/halva?${offsetQ}&halva=${encodeURIComponent(s.halva)}&split=${split}&${cacheQ}`;
  }
  if (s.source_type === 'extramaterial' && s.extramaterial_id != null) {
    const em = (currentExtramaterial || []).find((e) => e.id === s.extramaterial_id);
    if (em && em.filnamn) return `${API}/mappar/${encodeURIComponent(mapp)}/fil/${encodeURIComponent(em.filnamn)}/bild?${cacheQ}`;
  }
  return null;
}

/** Rita skissens crop i en container (img eller canvas med crop). */
function renderSkissCropMiniatyr(container, s) {
  if (!container || !s) return;
  const url = getSkissKallaUrl(s);
  if (!url) {
    container.innerHTML = '<span class="gp-skiss-miniatyr-placeholder">—</span>';
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
    const maxSize = 120;
    const cw = sw >= sh ? maxSize : Math.round(maxSize * (sw / sh));
    const ch = sh >= sw ? maxSize : Math.round(maxSize * (sh / sw));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, cw);
    canvas.height = Math.max(1, ch);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, x, y, sw, sh, 0, 0, canvas.width, canvas.height);
      container.innerHTML = '';
      const thumb = document.createElement('img');
      thumb.src = canvas.toDataURL('image/png');
      thumb.alt = 'Skiss';
      thumb.className = 'gp-skiss-miniatyr-img';
      container.appendChild(thumb);
    }
  };
  img.onerror = () => {
    container.innerHTML = '<span class="gp-skiss-miniatyr-placeholder">Kunde inte ladda</span>';
  };
  img.src = url;
}

/** Drag-and-drop för skisser (ändra ordning). */
function bindSkissDragDrop(container) {
  if (!container) return;
  container.querySelectorAll('.gp-skiss-drag-handle').forEach((handle) => {
    const rad = handle.closest('.gp-skiss-rad');
    if (!rad) return;
    handle.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', rad.dataset.skissId || '');
      e.dataTransfer.effectAllowed = 'move';
      rad.classList.add('gp-skiss-dragging');
    });
    handle.addEventListener('dragend', () => rad.classList.remove('gp-skiss-dragging'));
  });
  container.querySelectorAll('.gp-skiss-rad').forEach((rad) => {
    rad.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.gp-skiss-drag-over').forEach((r) => r.classList.remove('gp-skiss-drag-over'));
      if (!rad.classList.contains('gp-skiss-dragging')) rad.classList.add('gp-skiss-drag-over');
    });
    rad.addEventListener('dragleave', () => rad.classList.remove('gp-skiss-drag-over'));
    rad.addEventListener('drop', async (e) => {
      e.preventDefault();
      rad.classList.remove('gp-skiss-drag-over');
      const fromId = e.dataTransfer.getData('text/plain');
      const fromRad = container.querySelector(`.gp-skiss-rad[data-skiss-id="${fromId}"]`);
      if (!fromRad || fromRad === rad || currentGravplatsId == null) return;
      const rader = Array.from(container.querySelectorAll('.gp-skiss-rad'));
      const ids = rader.map((r) => parseInt(r.dataset.skissId, 10)).filter((n) => !isNaN(n));
      const fromIdx = ids.indexOf(parseInt(fromId, 10));
      const toIdx = ids.indexOf(parseInt(rad.dataset.skissId, 10));
      if (fromIdx === -1 || toIdx === -1) return;
      const newIds = [...ids];
      newIds.splice(fromIdx, 1);
      newIds.splice(toIdx, 0, ids[fromIdx]);
      const res = await fetch(`${API}/gravplats/${currentGravplatsId}/skisser/ordning`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skiss_ids: newIds }),
        credentials: 'include',
      });
      if (res.ok) {
        await ensureInmatningData();
        renderInmatningSektion('skiss');
      }
    });
  });
}

/** Öppna modal för att lägga till skiss: välj bild, markera område, spara. */
function oppnaSkissModal() {
  const modal = document.getElementById('gp-skiss-modal');
  const rubrik = document.getElementById('gp-skiss-modal-rubrik');
  const bilderEl = document.getElementById('gp-skiss-modal-bilder');
  const markeraEl = document.getElementById('gp-skiss-modal-markera');
  const imgEl = document.getElementById('gp-skiss-modal-img');
  const rectEl = document.getElementById('gp-skiss-modal-rect');
  const cacheQ = `_v=${cacheBust}`;
  const mapp = currentExtramaterialMapp;
  if (!modal || !bilderEl || !markeraEl || !imgEl || !rectEl || !mapp || currentGravplatsId == null) return;

  let valdKalla = null; // { source_type, content_sida?, halva?, extramaterial_id?, url }

  function visaSteg1() {
    markeraEl.hidden = true;
    bilderEl.hidden = false;
    rubrik.textContent = 'Välj bild att markera skiss på';
    bilderEl.innerHTML = '';
    (currentHalvorList || []).forEach((h, i) => {
      let url;
      if (h.redan_halva && h.filnamn) {
        url = `${API}/mappar/${encodeURIComponent(mapp)}/fil/${encodeURIComponent(h.filnamn)}/bild?${cacheQ}`;
      } else {
        const base = `${API}/mappar/${encodeURIComponent(mapp)}/sida`;
        const offsetQ = 'offset=0';
        if (h.segment_index != null) {
          url = `${base}/${h.content_sida}/halva?${offsetQ}&segment=${h.segment_index}&${cacheQ}`;
          if (h.position != null && h.position >= 1 && h.position <= 3) url += `&position=${h.position}`;
        } else {
          const start = currentGravplatsStartSida != null ? currentGravplatsStartSida : 0;
          const pos = (h.content_sida || 0) - start;
          const split = pos === 1 ? (870 / 1595).toFixed(4) : (727 / 1597).toFixed(4);
          url = `${base}/${h.content_sida}/halva?${offsetQ}&halva=${encodeURIComponent(h.halva)}&split=${split}&${cacheQ}`;
        }
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gp-skiss-modal-bild';
      btn.innerHTML = `<img src="${url}" alt="" /><span>Sida ${h.content_sida || ''} ${h.halva || ''} ${h.filnamn || ''}</span>`;
      btn.addEventListener('click', () => {
        valdKalla = {
          source_type: 'halva',
          content_sida: h.content_sida,
          halva: h.halva,
          segment_index: h.segment_index,
          position: h.position,
          url,
        };
        visaSteg2();
      });
      bilderEl.appendChild(btn);
    });
    (currentExtramaterial || []).forEach((em) => {
      const url = `${API}/mappar/${encodeURIComponent(mapp)}/fil/${encodeURIComponent(em.filnamn)}/bild?${cacheQ}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gp-skiss-modal-bild';
      btn.innerHTML = `<img src="${url}" alt="" /><span>${em.filnamn}</span>`;
      btn.addEventListener('click', () => {
        valdKalla = { source_type: 'extramaterial', extramaterial_id: em.id, url };
        visaSteg2();
      });
      bilderEl.appendChild(btn);
    });
    setAvbrytHandler();
  }

  function visaSteg2() {
    if (!valdKalla || !valdKalla.url) return;
    bilderEl.hidden = true;
    markeraEl.hidden = false;
    rubrik.textContent = 'Markera skissområde';
    imgEl.draggable = false;
    imgEl.ondragstart = (e) => e.preventDefault();
    imgEl.src = valdKalla.url;
    rectEl.style.display = 'none';
    rectEl.style.left = rectEl.style.top = rectEl.style.width = rectEl.style.height = '';

    let dragStart = null;
    let currentRect = { x: 0, y: 0, w: 0, h: 0 };

    function updateRectEl() {
      const ir = imgEl.getBoundingClientRect();
      const wr = imgEl.parentElement?.getBoundingClientRect();
      if (!wr) return;
      rectEl.style.left = (currentRect.x * ir.width + (ir.left - wr.left)) + 'px';
      rectEl.style.top = (currentRect.y * ir.height + (ir.top - wr.top)) + 'px';
      rectEl.style.width = (currentRect.w * ir.width) + 'px';
      rectEl.style.height = (currentRect.h * ir.height) + 'px';
      rectEl.style.display = currentRect.w > 0 && currentRect.h > 0 ? 'block' : 'none';
    }

    imgEl.onload = () => {
      const wrap = imgEl.parentElement;
      if (!wrap) return;
      wrap.addEventListener('mousedown', (e) => {
        if (e.target !== imgEl && e.target !== rectEl && e.target !== wrap) return;
        e.preventDefault();
        const ir = imgEl.getBoundingClientRect();
        const nx = (e.clientX - ir.left) / ir.width;
        const ny = (e.clientY - ir.top) / ir.height;
        dragStart = { x: nx, y: ny };
        currentRect = { x: nx, y: ny, w: 0, h: 0 };
        updateRectEl();
      });
      wrap.addEventListener('mousemove', (e) => {
        if (!dragStart) return;
        e.preventDefault();
        const ir = imgEl.getBoundingClientRect();
        const nx = (e.clientX - ir.left) / ir.width;
        const ny = (e.clientY - ir.top) / ir.height;
        const x = Math.min(dragStart.x, nx);
        const y = Math.min(dragStart.y, ny);
        const w = Math.abs(nx - dragStart.x);
        const h = Math.abs(ny - dragStart.y);
        currentRect = { x, y, w, h };
        updateRectEl();
      });
      wrap.addEventListener('mouseup', (e) => {
        e.preventDefault();
        dragStart = null;
      });
      wrap.addEventListener('mouseleave', () => { dragStart = null; });
    };

    document.getElementById('gp-skiss-spara').onclick = async () => {
      if (currentRect.w < 0.01 || currentRect.h < 0.01) {
        alert('Markera ett område genom att dra på bilden.');
        return;
      }
      const body = {
        source_type: valdKalla.source_type,
        content_sida: valdKalla.content_sida ?? null,
        halva: valdKalla.halva ?? null,
        segment_index: valdKalla.segment_index ?? null,
        position: valdKalla.position ?? null,
        extramaterial_id: valdKalla.extramaterial_id ?? null,
        x: currentRect.x,
        y: currentRect.y,
        width: currentRect.w,
        height: currentRect.h,
      };
      const sparaBtn = document.getElementById('gp-skiss-spara');
      if (sparaBtn) sparaBtn.disabled = true;
      let res;
      try {
        res = await fetch(`${API}/gravplats/${currentGravplatsId}/skisser`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'include',
        });
      } finally {
        if (sparaBtn) sparaBtn.disabled = false;
      }
      if (!res.ok) {
        alert('Kunde inte spara skiss.');
        return;
      }
      modal.hidden = true;
      const savedInmatning = inmatningData ? { ...inmatningData } : null;
      lastInmatningGravplatsId = null;
      await ensureInmatningData();
      if (savedInmatning && inmatningData) {
        Object.assign(inmatningData, { ...savedInmatning, skisser: inmatningData.skisser });
      }
      renderInmatningSektion('skiss');
    };
    setAvbrytHandler();
  }

  const avbrytBtn = document.getElementById('gp-skiss-avbryt');
  function setAvbrytHandler() {
    if (!avbrytBtn) return;
    avbrytBtn.onclick = markeraEl.hidden ? () => { modal.hidden = true; } : () => visaSteg1();
  }
  visaSteg1();
  setAvbrytHandler();
  modal.hidden = false;
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
      const fn = v(i.fornamn); const en = v(i.efternamn); const yrke = v(i.yrke); const gata = v(i.gatuadress || i.adress); const postOrtInv = [i.postnummer, i.postort].filter(Boolean).join(' ').trim();
      const namn = [fn, en].filter(Boolean).join(' ') || '';
      const rader = radOmFyllt('Namn', namn) +
        radOmFyllt('Yrke', i.yrke) +
        radOmFyllt('Gatuadress', gata) +
        radOmFyllt('Postnummer / ort', postOrtInv || null) +
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
        radOmFyllt('Yrke', n.yrke) +
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
    const ovrigt = radOmFyllt('Utfärdat den', formatUtfordatDenForDisplay(d.utfordat_den)) +
      radOmFyllt('Kommentar', d.kommentar) +
      radOmFyllt('Karta nr', d.karta_nr) +
      radOmFyllt('Gravbrev nr', d.gravbrev_nr);
    const innehallHtml = rader + (ovrigt ? '<h4 class="gp-inmatning-delrubrik">Övrigt</h4>' + ovrigt : '');
    innehall.innerHTML = innehallHtml ? '<div class="gp-inmatning-las">' + innehallHtml + '</div>' : '';
    return;
  }

  if (sektion === 'skiss') {
    const d = inmatningData || {};
    const skisser = d.skisser || [];
    const rader = radOmFyllt('Storlek', d.storlek);
    if (skisser.length > 0) {
      innehall.innerHTML = '<div class="gp-inmatning-las">' + (rader || '') + '<div class="gp-skiss-las-galleri" id="gp-skiss-las-galleri"></div></div>';
      const galleri = innehall.querySelector('#gp-skiss-las-galleri');
      if (galleri) {
        skisser.forEach((s, idx) => {
          const wrap = document.createElement('figure');
          wrap.className = 'gp-skiss-las-item gp-skiss-las-item-klickbar';
          wrap.setAttribute('role', 'button');
          wrap.setAttribute('tabindex', '0');
          wrap.setAttribute('aria-label', 'Visa skiss ' + (idx + 1) + ' i förstoring');
          wrap.innerHTML = '<div class="gp-skiss-las-miniatyr"></div><figcaption class="gp-skiss-las-nummer">' + (idx + 1) + '</figcaption>';
          galleri.appendChild(wrap);
          renderSkissCropMiniatyr(wrap.querySelector('.gp-skiss-las-miniatyr'), s);
          wrap.addEventListener('click', () => {
            const i = Array.from(galleri.querySelectorAll('.gp-skiss-las-item')).indexOf(wrap);
            openLightboxSkisser(skisser, i >= 0 ? i : 0);
          });
          wrap.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              wrap.click();
            }
          });
        });
      }
    } else {
      innehall.innerHTML = rader ? '<div class="gp-inmatning-las">' + rader + '</div>' : '';
    }
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
      if (g.ar_beteckning) {
        html += radOmFyllt('Beteckning', g.efternamn);
      } else {
        html += radOmFyllt('Namn', namn);
      }
      const fodelseVarde = fodelse
        ? (g.fod_nr ? `${fodelse} (Födelsenummer: ${esc(g.fod_nr)})` : fodelse)
        : (g.fod_nr ? `Födelsenummer: ${esc(g.fod_nr)}` : '');
      const dodsVarde = dods
        ? (g.dodsbok_nr ? `${dods} (Db. nummer: ${esc(g.dodsbok_nr)})` : dods)
        : (g.dodsbok_nr ? `Db. nummer: ${esc(g.dodsbok_nr)}` : '');
      const rader = radOmFyllt('Yrke', g.yrke) +
        radOmFyllt('Gatuadress', g.gatuadress || g.adress || '') +
        radOmFyllt('Postnummer / ort', [g.postnummer, g.postort].filter(Boolean).join(' ').trim() || null) +
        radOmFyllt('Födelsedatum', fodelseVarde || null) +
        radOmFyllt('Dödsdatum', dodsVarde || null) +
        radOmFyllt('Gravsatt den', g.gravsatt_den) +
        radOmFyllt('Urna/Kista', g.urna) +
        radOmFyllt('Kommentar', g.kommentar);
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
        <label>Gatuadress <textarea name="inv_gatuadress" class="gp-falt-expanderbar" rows="1">${esc(i.gatuadress || i.adress || '')}</textarea></label>
        <label>Postnummer <textarea name="inv_postnummer" class="gp-falt-expanderbar" rows="1">${esc(i.postnummer || '')}</textarea></label>
        <label>Postort <textarea name="inv_postort" class="gp-falt-expanderbar" rows="1">${esc(i.postort || '')}</textarea></label>
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
      rad.innerHTML = '<span class="gp-innehavare-drag-handle" draggable="true" title="Dra för att ändra ordning" aria-label="Ändra ordning">⋮⋮</span><label>Förnamn <textarea name="inv_fornamn" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Efternamn <textarea name="inv_efternamn" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Yrke <textarea name="inv_yrke" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Gatuadress <textarea name="inv_gatuadress" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Postnummer <textarea name="inv_postnummer" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Postort <textarea name="inv_postort" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Kommentar <textarea class="gp-falt-expanderbar gp-inv-kommentar" rows="2"></textarea></label><button type="button" class="gp-rad-ta-bort">Ta bort</button>';
      innehall.insertBefore(rad, innehall.querySelector('.gp-lagg-till-innehavare'));
      rad.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
        <label>Yrke <textarea name="na_yrke" class="gp-falt-expanderbar" rows="1">${esc(n.yrke || '')}</textarea></label>
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
      rad.innerHTML = '<span class="gp-na-drag-handle" draggable="true" title="Dra för att ändra ordning" aria-label="Ändra ordning">⋮⋮</span><label>Förnamn <textarea name="na_fornamn" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Efternamn <textarea name="na_efternamn" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Yrke <textarea name="na_yrke" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Gatuadress <textarea name="na_gatuadress" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Postnummer <textarea name="na_postnummer" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Postort <textarea name="na_postort" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Telefon <textarea name="na_telefon" class="gp-falt-expanderbar" rows="1"></textarea></label><label>Kommentar <textarea class="gp-falt-expanderbar gp-na-kommentar" rows="2"></textarea></label><button type="button" class="gp-na-ta-bort">Ta bort</button>';
      innehall.insertBefore(rad, innehall.querySelector('.gp-lagg-till-na'));
      rad.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
      <div class="gp-gravplatsen-tvakolumn">
        <div class="gp-gravplatsen-kolumn gp-gravplatsen-anteckningar">
          <h4 class="gp-inmatning-delrubrik">Anteckningar</h4>
          <label>Underhåll inbetalt för all framtid den <textarea name="underhall_text" class="gp-falt-expanderbar" rows="1">${esc(d.underhall_text)}</textarea></label>
          <label><input type="checkbox" name="underhall_overstruket" ${d.underhall_overstruket ? 'checked' : ''} /> "För all framtid" överstruket</label>
          <label>Gravrättstid <textarea name="gravrattstid" class="gp-falt-expanderbar" rows="1">${esc(d.gravrattstid)}</textarea></label>
          <label>Monument <textarea name="monument" class="gp-falt-expanderbar" rows="1">${esc(d.monument)}</textarea></label>
          <label>Gravens utformning <textarea name="gravens_utformning" class="gp-falt-expanderbar" rows="1">${esc(d.gravens_utformning)}</textarea></label>
        </div>
        <div class="gp-gravplatsen-kolumn gp-gravplatsen-ovrigt">
          <h4 class="gp-inmatning-delrubrik">Övrigt</h4>
          <label>Utfärdat den <textarea name="utfordat_den" class="gp-falt-expanderbar" rows="1" aria-describedby="utfordat_den_fel" title="Ange datum enligt YYYY-MM-DD (år-månad-dag). Endast år eller år och månad går också att ange.">${esc(formatUtfordatDenForDisplay(d.utfordat_den))}</textarea></label>
          <span class="gp-datum-fel" id="utfordat_den_fel" hidden aria-live="polite"></span>
          <label>Karta nr <textarea name="karta_nr" class="gp-falt-expanderbar" rows="1">${esc(d.karta_nr)}</textarea></label>
          <label>Gravbrev nr <textarea name="gravbrev_nr" class="gp-falt-expanderbar" rows="1">${esc(d.gravbrev_nr)}</textarea></label>
          <label>Kommentar <textarea name="kommentar" rows="2">${esc(d.kommentar)}</textarea></label>
        </div>
      </div>`;
    innehall.querySelectorAll('textarea.gp-falt-expanderbar').forEach(autoExpandTextarea);
    const utfordatInp = innehall.querySelector('[name="utfordat_den"]');
    const utfordatFel = document.getElementById('utfordat_den_fel');
    if (utfordatInp && utfordatFel) {
      utfordatInp.addEventListener('blur', () => {
        const fore = utfordatInp.value;
        normaliseraDatumFalt(utfordatInp);
        if (utfordatInp.value !== fore) markInmatningDirty();
        utfordatInp.value = formatUtfordatDenForDisplay(utfordatInp.value);
        visaDatumValidering(utfordatInp, utfordatFel);
      });
      utfordatInp.addEventListener('input', () => visaDatumValidering(utfordatInp, utfordatFel));
      visaDatumValidering(utfordatInp, utfordatFel);
    }
    return;
  }

  if (sektion === 'skiss') {
    innehall.innerHTML = `
      <label>Storlek <textarea name="storlek" class="gp-falt-expanderbar" rows="1">${esc(d.storlek)}</textarea></label>
      <div class="gp-skisser-lista" id="gp-skisser-lista"></div>
      <button type="button" class="gp-lagg-till-skiss" id="gp-lagg-till-skiss">+ Lägg till skiss</button>
      <p class="gp-skiss-info" id="gp-lagg-till-skiss-hint">Skisser sparas direkt till gravplatsen när du markerat skissen och klickat på "Spara skiss" - du behöver inte klicka på "Spara" på gravplatsen.</p>`;
    innehall.querySelectorAll('textarea.gp-falt-expanderbar').forEach(autoExpandTextarea);
    const skisser = d.skisser || [];
    const listEl = innehall.querySelector('#gp-skisser-lista');
    const cacheQ = `_v=${cacheBust}`;
    skisser.forEach((s, i) => {
      const rad = document.createElement('div');
      rad.className = 'gp-skiss-rad';
      rad.dataset.skissId = String(s.id);
      rad.innerHTML = `
        <span class="gp-skiss-drag-handle" draggable="true" title="Dra för att ändra ordning" aria-label="Ändra ordning">⋮⋮</span>
        <div class="gp-skiss-miniatyr" data-skiss-id="${s.id}"></div>
        <button type="button" class="gp-skiss-ta-bort" title="Ta bort skiss">Ta bort</button>`;
      listEl.appendChild(rad);
      renderSkissCropMiniatyr(rad.querySelector('.gp-skiss-miniatyr'), s);
    });
    bindSkissDragDrop(listEl);
    innehall.querySelectorAll('.gp-skiss-ta-bort').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const rad = btn.closest('.gp-skiss-rad');
        const id = rad?.dataset.skissId;
        if (id && currentGravplatsId != null) {
          btn.disabled = true;
          try {
            const res = await fetch(`${API}/gravplats/${currentGravplatsId}/skisser/${id}`, { method: 'DELETE', credentials: 'include' });
            if (res.ok) {
              lastInmatningGravplatsId = null;
              await ensureInmatningData();
              renderInmatningSektion('skiss');
            }
          } finally {
            btn.disabled = false;
          }
        }
      });
    });
    innehall.querySelector('#gp-lagg-till-skiss')?.addEventListener('click', () => oppnaSkissModal());
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
    bindGravsattBeteckningToggle(innehall);
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
      rad.scrollIntoView({ block: 'start', behavior: 'smooth' });
      bindDatumValidering(rad);
      bindGravsattBeteckningToggle(innehall);
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

function bindGravsattBeteckningToggle(container) {
  container.querySelectorAll('.gp-gravsatt-block').forEach((blk) => {
    const idx = blk.dataset.gsIndex;
    const cb = blk.querySelector(`[name="gs_ar_beteckning_${idx}"]`);
    if (!cb) return;
    const labelSpan = blk.querySelector('.gp-gravsatt-efternamn-label');
    const updateUi = () => {
      const checked = cb.checked;
      blk.classList.toggle('gp-gravsatt-beteckning-checked', checked);
      if (labelSpan) labelSpan.textContent = checked ? 'Beteckning' : 'Efternamn';
    };
    cb.addEventListener('change', () => {
      updateUi();
      markInmatningDirty();
    });
    updateUi();
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

/** Formatera lagrat Utfärdat den-värde för visning i fältet: YYYY-00-00 → YYYY, YYYY-MM-00 → YYYY-MM. */
function formatUtfordatDenForDisplay(s) {
  if (s == null || typeof s !== 'string') return '';
  const t = s.trim();
  if (!t) return '';
  const m = /^(\d{4})-00-00$/.exec(t);
  if (m) return m[1];
  const m2 = /^(\d{4})-(\d{1,2})-00$/.exec(t);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}`;
  return t;
}

/** Expandera kort format till lagringsformat vid submit: YYYY → YYYY-00-00, YYYY-MM → YYYY-MM-00. */
function expandUtfordatDenForSubmit(s) {
  if (s == null || typeof s !== 'string') return '';
  const t = s.trim();
  if (!t) return '';
  if (/^\d{4}$/.test(t)) return `${t}-00-00`;
  const ym = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (ym) return `${ym[1]}-${ym[2].padStart(2, '0')}-00`;
  return t;
}

/** Om värdet är exakt 8 siffror (YYYYMMDD), formatera till YYYY-MM-DD. Endast 8 siffror konverteras; YYYY-MM skrivs manuellt.
 * För fältet utfordat_den: först YYYYMMDD→YYYY-MM-DD vid manuell inmatning, sedan övriga format via normaliseraUtfordatDen. */
function normaliseraDatumFalt(inp) {
  if (!inp || typeof inp.value !== 'string') return;
  const name = inp.getAttribute && inp.getAttribute('name');
  const raw = inp.value.trim().replace(/\s/g, '');
  if (name === 'utfordat_den') {
    if (/^\d{8}$/.test(raw)) {
      inp.value = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      return;
    }
    const normaliserat = normaliseraUtfordatDen(inp.value);
    if (normaliserat) inp.value = normaliserat;
    return;
  }
  if (/^\d{8}$/.test(raw)) {
    inp.value = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
}

/** Validera datumfält: tomt är ok, annars YYYY, YYYY-MM eller YYYY-MM-DD med rimliga tal.
 * Månad 0 (YYYY-00-00) och dag 0 (YYYY-MM-00) accepteras för ofullständiga datum (t.ex. Utfärdat den). */
function validDatum(s) {
  const t = (s || '').trim();
  if (!t) return { valid: true };
  const part = t.split('-');
  if (part.length > 3) return { valid: false, message: DATUM_FORMAT_TEXT };
  const num = part.map((x) => parseInt(x, 10));
  if (num.some((n, i) => isNaN(n) || (i === 0 && (n < 1000 || n > 2100)) || (i === 1 && (n < 0 || n > 12)) || (i === 2 && (n < 0 || n > 31)))) {
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
  const arBeteckning = !!g.ar_beteckning;
  const beteckningCheckbox = `<label class="gp-gravsatt-beteckning"><input type="checkbox" name="gs_ar_beteckning_${idx}" ${arBeteckning ? 'checked' : ''} /> Gravsatt använd som beteckning (t.ex. familjegrav)</label>`;
  const beteckningKlass = arBeteckning ? ' gp-gravsatt-beteckning-checked' : '';
  const efternamnLabel = arBeteckning ? 'Beteckning' : 'Efternamn';
  const fodelseDatum = formatDatum(g.fodelse_ar, g.fodelse_manad, g.fodelse_dag);
  const dodsDatum = formatDatum(g.dods_ar, g.dods_manad, g.dods_dag);
  const urnaVal = (g.urna || '').toLowerCase();
  const urnaSelected = ['urna', 'kista', 'okant'].includes(urnaVal) ? urnaVal : '';
  const urnaOptions = URNA_VAL.map((o) => `<option value="${esc(o.v)}" ${o.v === urnaSelected ? 'selected' : ''}>${o.l}</option>`).join('');
  return `
    <div class="gp-gravsatt-block${beteckningKlass}" data-gs-index="${idx}">
      <h4><span class="gp-gravsatt-drag-handle" draggable="true" title="Dra för att ändra ordning">⋮⋮</span> Gravsatt ${pos}</h4>
      ${beteckningCheckbox}
      <div class="gp-gravsatt-rad gp-gravsatt-rad-namn-yrke">
        <span class="gp-gravsatt-fornamn-wrap">
          <label>Förnamn <textarea name="gs_fornamn_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.fornamn)}</textarea></label>
        </span>
        <label><span class="gp-gravsatt-efternamn-label">${esc(efternamnLabel)}</span> <textarea name="gs_efternamn_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.efternamn)}</textarea></label>
        <span class="gp-gravsatt-rad-hoger">
          <label>Yrke <textarea name="gs_yrke_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.yrke || '')}</textarea></label>
          <label>Gatuadress <textarea name="gs_gatuadress_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.gatuadress || g.adress || '')}</textarea></label>
          <label>Postnummer <textarea name="gs_postnummer_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.postnummer || '')}</textarea></label>
          <label>Postort <textarea name="gs_postort_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.postort || '')}</textarea></label>
        </span>
      </div>
      <div class="gp-gravsatt-rad gp-gravsatt-rad-datum">
        <label>Födelsedatum <textarea name="gs_fodelse_datum_${idx}" class="gp-falt-expanderbar" rows="1" aria-describedby="gs_fodelse_datum_fel_${idx}">${esc(fodelseDatum)}</textarea></label>
        <span class="gp-datum-fel" id="gs_fodelse_datum_fel_${idx}" hidden aria-live="polite"></span>
        <label>Födelsenummer <textarea name="gs_fod_nr_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.fod_nr)}</textarea></label>
        <label>Dödsdatum <textarea name="gs_dods_datum_${idx}" class="gp-falt-expanderbar" rows="1" aria-describedby="gs_dods_datum_fel_${idx}">${esc(dodsDatum)}</textarea></label>
        <span class="gp-datum-fel" id="gs_dods_datum_fel_${idx}" hidden aria-live="polite"></span>
        <label>Db. nummer <textarea name="gs_dodsbok_nr_${idx}" class="gp-falt-expanderbar" rows="1">${esc(g.dodsbok_nr)}</textarea></label>
        <label>Gravsatt den <textarea name="gs_gravsatt_den_${idx}" class="gp-falt-expanderbar" rows="1" aria-describedby="gs_gravsatt_den_fel_${idx}">${esc(g.gravsatt_den)}</textarea></label>
        <span class="gp-datum-fel" id="gs_gravsatt_den_fel_${idx}" hidden aria-live="polite"></span>
      </div>
      <div class="gp-gravsatt-rad gp-gravsatt-rad-gravsatt-urna">
        <label class="gp-gravsatt-urna-hoger">Urna/Kista <select name="gs_urna_${idx}">${urnaOptions}</select></label>
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
      const gatuadress = (rad.querySelector('[name="inv_gatuadress"]')?.value ?? '').trim();
      const postnummer = (rad.querySelector('[name="inv_postnummer"]')?.value ?? '').trim();
      const postort = (rad.querySelector('[name="inv_postort"]')?.value ?? '').trim();
      const kommentar = (rad.querySelector('.gp-inv-kommentar')?.value ?? '').trim();
      innehavare.push({ fornamn, efternamn, yrke, gatuadress, postnummer, postort, kommentar, sort_order: innehavare.length });
    });
  }
  // Vid 0 rader skickar vi tom lista (användaren har tagit bort alla), inte gamla inmatningData.

  let narmast_anhoriga = [];
  const naRader = root.querySelectorAll('.gp-na-rad');
  if (naRader.length > 0) {
    naRader.forEach((rad) => {
      const fornamn = (rad.querySelector('[name="na_fornamn"]')?.value ?? '').trim();
      const efternamn = (rad.querySelector('[name="na_efternamn"]')?.value ?? '').trim();
      const yrke = (rad.querySelector('[name="na_yrke"]')?.value ?? '').trim();
      const adress = (rad.querySelector('[name="na_gatuadress"]')?.value ?? '').trim();
      const postnummer = (rad.querySelector('[name="na_postnummer"]')?.value ?? '').trim();
      const postort = (rad.querySelector('[name="na_postort"]')?.value ?? '').trim();
      const telefon = (rad.querySelector('[name="na_telefon"]')?.value ?? '').trim();
      const kommentar = (rad.querySelector('.gp-na-kommentar')?.value ?? '').trim();
      if (fornamn || efternamn) narmast_anhoriga.push({ fornamn, efternamn, yrke, adress, postnummer, postort, telefon, kommentar, sort_order: narmast_anhoriga.length });
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
      fornamn: (block.querySelector(`[name="gs_ar_beteckning_${i}"]`)?.checked) ? '' : p('gs_fornamn'),
      efternamn: p('gs_efternamn'),
      yrke: p('gs_yrke'),
      gatuadress: p('gs_gatuadress'),
      postnummer: p('gs_postnummer'),
      postort: p('gs_postort'),
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
  const utfordat_den = gravplatsenOppnad ? expandUtfordatDenForSubmit(get('utfordat_den')) : (d.utfordat_den || '');
  const kommentar = gravplatsenOppnad ? (root.querySelector('textarea[name="kommentar"]')?.value ?? '').trim() : (d.kommentar || '');
  const fardigtranskriberad = inmatningData && inmatningData.fardigtranskriberad === true;

  const extramaterial_kommentarer = [];
  document.querySelectorAll('#gp-em-miniatyrer .gp-em-kommentar-inp').forEach((inp) => {
    const id = parseInt(inp.dataset.emId, 10);
    if (!isNaN(id)) extramaterial_kommentarer.push({ id, kommentar: (inp.value || '').trim() });
  });

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
    extramaterial_kommentarer,
    version: inmatningData != null && typeof inmatningData.version === 'number' ? inmatningData.version : null,
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

function hamtaSparatClaudeSvar() {
  if (currentGravplatsId == null) return;
  const panel = document.getElementById('gp-claude-sparat-panel');
  sparatClaudeSvar = null;
  if (panel) panel.hidden = true;
  fetch(`${API}/ocr/gravplats/${currentGravplatsId}/svar`, { credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data) return;
      sparatClaudeSvar = data;
      visaSparatClaudeSvar(data);
    })
    .catch(function() {});
}

function formatOcrKommentar(text) {
  if (!text) return '';
  var rader = text.split('\n').map(function(r) { return r.trim(); }).filter(function(r) { return r.length > 0; });
  if (rader.length === 0) return '';
  if (rader.length === 1) return '<span>' + rader[0].replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span>';
  return '<ul style="margin:0.2rem 0 0 1.1rem;padding:0">' + rader.map(function(r) {
    return '<li>' + r.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</li>';
  }).join('') + '</ul>';
}

function visaSparatClaudeSvar(data) {
  if (!inmatningRedigerar) return;
  const panel = document.getElementById('gp-claude-sparat-panel');
  const metaEl = document.getElementById('gp-claude-sparat-meta');
  const kommentarEl = document.getElementById('gp-claude-sparat-kommentar');
  if (!panel) return;

  var datum = data.skapad_den ? new Date(data.skapad_den).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '';
  if (metaEl) metaEl.textContent = 'Sparat Claude-svar – ' + datum + (data.username ? ' av ' + data.username : '');
  if (kommentarEl) kommentarEl.hidden = true;
  panel.hidden = false;
}

function byggDiff(claudeData) {
  if (!inmatningData || !claudeData) return [];
  var andringar = [];

  function jmf(etikett, gammalt, nytt) {
    var g = gammalt == null ? '' : String(gammalt);
    var n = nytt == null ? '' : String(nytt);
    if (g !== n) andringar.push({ etikett: etikett, gammalt: g, nytt: n });
  }

  // Skalarfält
  var skalar = [
    ['Storlek', inmatningData.storlek, claudeData.storlek],
    ['Underhåll text', inmatningData.underhall_text, claudeData.underhall_text],
    ['Underhåll överstruket', inmatningData.underhall_overstruket, claudeData.underhall_overstruket],
    ['Gravrattstid', inmatningData.gravrattstid, claudeData.gravrattstid],
    ['Monument', inmatningData.monument, claudeData.monument],
    ['Gravens utformning', inmatningData.gravens_utformning, claudeData.gravens_utformning],
    ['Karta nr', inmatningData.karta_nr, claudeData.karta_nr],
    ['Gravbrev nr', inmatningData.gravbrev_nr, claudeData.gravbrev_nr],
    ['Utfärdat den', inmatningData.utfordat_den, claudeData.utfardat_den],
    ['Kommentar', inmatningData.kommentar, claudeData.kommentar],
  ];
  skalar.forEach(function(r) { jmf(r[0], r[1], r[2]); });

  // Innehavare
  var cInnh = (claudeData.innehavare || []);
  var nInnh = (inmatningData.innehavare || []);
  var maxInnh = Math.max(cInnh.length, nInnh.length);
  for (var i = 0; i < maxInnh; i++) {
    var ci = cInnh[i] || {};
    var ni = nInnh[i] || {};
    var prefix = 'Innehavare ' + (i + 1);
    jmf(prefix + ' förnamn', ni.fornamn, ci.fornamn);
    jmf(prefix + ' efternamn', ni.efternamn, ci.efternamn);
    jmf(prefix + ' yrke', ni.yrke, ci.yrke);
  }
  if (cInnh.length !== nInnh.length) {
    andringar.push({ etikett: 'Antal innehavare', gammalt: String(nInnh.length), nytt: String(cInnh.length) });
  }

  // Gravsatta
  var cGs = (claudeData.gravsatta || []);
  var nGs = (inmatningData.gravsatta || []);
  var maxGs = Math.max(cGs.length, nGs.length);
  for (var j = 0; j < maxGs; j++) {
    var cg = cGs[j] || {};
    var ng = nGs[j] || {};
    var gPrefix = 'Gravsatt ' + (j + 1);
    jmf(gPrefix + ' förnamn', ng.fornamn, cg.fornamn);
    jmf(gPrefix + ' efternamn', ng.efternamn, cg.efternamn);
    jmf(gPrefix + ' föd.år', ng.fodelse_ar, cg.fodelse_ar);
    jmf(gPrefix + ' dödsår', ng.dods_ar, cg.dods_ar);
    jmf(gPrefix + ' gravsatt den', ng.gravsatt_den, cg.gravsatt_den);
  }
  if (cGs.length !== nGs.length) {
    andringar.push({ etikett: 'Antal gravsatta', gammalt: String(nGs.length), nytt: String(cGs.length) });
  }

  return andringar;
}

function visaDiffDialog(claudeData, onApplicera) {
  var diff = byggDiff(claudeData);
  if (diff.length === 0) { onApplicera(); return; }
  var dialog = document.getElementById('gp-claude-diff-dialog');
  var innehall = document.getElementById('gp-claude-diff-innehall');
  if (!dialog || !innehall) { onApplicera(); return; }

  {
    innehall.innerHTML = diff.map(function(d) {
      return '<div class="gp-diff-rad">' +
        '<span class="gp-diff-etikett">' + d.etikett + '</span>' +
        '<span class="gp-diff-varde">' +
          (d.gammalt ? '<del>' + d.gammalt + '</del>' : '') +
          '<ins>' + (d.nytt || '–') + '</ins>' +
        '</span></div>';
    }).join('');
  }

  var applicera = document.getElementById('gp-claude-diff-applicera');
  var avbryt = document.getElementById('gp-claude-diff-avbryt');
  function stang() { dialog.close(); applicera.onclick = null; avbryt.onclick = null; }
  applicera.onclick = function() { stang(); onApplicera(); };
  avbryt.onclick = stang;
  dialog.showModal();
}


document.getElementById('gp-btn-historik')?.addEventListener('click', oppnaHistorikModal);
document.getElementById('gp-historik-modal-stang')?.addEventListener('click', function() {
  document.getElementById('gp-historik-modal')?.close();
});
document.getElementById('gp-historik-modal')?.addEventListener('click', function(e) {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

/**
 * Fyll i formuläret med data från Claude OCR-svar.
 * Ersätter inmatningData och ritar om alla öppna sektioner.
 */
function prefillFranClaude(data) {
  if (!inmatningData || !data) return;

  // Mappa Claude-fält till inmatningData-format
  const innehavare = (data.innehavare || []).map((inv, i) => ({
    id: null,
    fornamn: inv.fornamn || '',
    efternamn: inv.efternamn || '',
    yrke: inv.yrke || '',
    gatuadress: inv.gatuadress || '',
    postnummer: inv.postnummer || '',
    postort: inv.postort || '',
    kommentar: inv.kommentar || '',
    sort_order: i,
  }));

  const narmast_anhoriga = (data.narmast_anhoriga || []).map((na, i) => ({
    id: null,
    fornamn: na.fornamn || '',
    efternamn: na.efternamn || '',
    yrke: na.yrke || '',
    adress: na.adress || '',
    postnummer: na.postnummer || '',
    postort: na.postort || '',
    telefon: na.telefon || '',
    kommentar: na.kommentar || '',
    sort_order: i,
  }));

  const gravsatta = (data.gravsatta || []).map((gs) => ({
    id: null,
    position: gs.position,
    ar_beteckning: gs.ar_beteckning || false,
    fornamn: gs.fornamn || '',
    efternamn: gs.efternamn || '',
    yrke: gs.yrke || '',
    gatuadress: gs.gatuadress || '',
    postnummer: gs.postnummer || '',
    postort: gs.postort || '',
    fodelse_ar: gs.fodelse_ar ?? null,
    fodelse_manad: gs.fodelse_manad ?? null,
    fodelse_dag: gs.fodelse_dag ?? null,
    fod_nr: gs.fod_nr || '',
    dods_ar: gs.dods_ar ?? null,
    dods_manad: gs.dods_manad ?? null,
    dods_dag: gs.dods_dag ?? null,
    dodsbok_nr: gs.dodsbok_nr || '',
    gravsatt_den: gs.gravsatt_den || '',
    urna: gs.urna || '',
    kommentar: gs.kommentar || '',
  }));

  inmatningData = {
    ...inmatningData,
    innehavare,
    narmast_anhoriga,
    storlek: data.storlek != null ? String(data.storlek) : (inmatningData.storlek || ''),
    underhall_text: data.underhall_text != null ? data.underhall_text : (inmatningData.underhall_text || ''),
    underhall_overstruket: data.underhall_overstruket != null ? Boolean(data.underhall_overstruket) : (inmatningData.underhall_overstruket || false),
    gravrattstid: data.gravrattstid != null ? data.gravrattstid : (inmatningData.gravrattstid || ''),
    monument: data.monument != null ? data.monument : (inmatningData.monument || ''),
    gravens_utformning: data.gravens_utformning != null ? data.gravens_utformning : (inmatningData.gravens_utformning || ''),
    karta_nr: data.karta_nr != null ? data.karta_nr : (inmatningData.karta_nr || ''),
    gravbrev_nr: data.gravbrev_nr != null ? data.gravbrev_nr : (inmatningData.gravbrev_nr || ''),
    // Claude använder utfardat_den (med a), backend/frontend utfordat_den (med o)
    utfordat_den: data.utfardat_den != null ? data.utfardat_den : (inmatningData.utfordat_den || ''),
    kommentar: data.kommentar != null ? data.kommentar : (inmatningData.kommentar || ''),
    gravsatta,
  };

  // Rita om alla sektioner (återställ dirty-flaggan tillfälligt så renderInmatningSektion inte hoppar över)
  inmatningDirty = false;
  const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
  sektioner.forEach((sektion) => {
    const btn = document.querySelector(`.gp-sektion-rubrik[data-sektion="${sektion}"]`);
    const innehall = document.getElementById(`gp-innehall-${sektion}`);
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (innehall) innehall.hidden = false;
    renderInmatningSektion(sektion);
  });
  markInmatningDirty();
}

async function sparaInmatning() {
  if (currentGravplatsId == null) return;
  if (!inmatningDirty) return;
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
    const res = await fetch(`${API}/gravplats/${currentGravplatsId}/inmatning`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      visaSparStatus(data.detail || 'Gravplatsen har ändrats av någon annan. Ladda om sidan.', false);
      lastInmatningGravplatsId = null;
      inmatningData = null;
      await ensureInmatningData();
      const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
      sektioner.forEach((s) => renderInmatningSektion(s));
      return;
    }
    if (!res.ok) throw new Error('Kunde inte spara');
    const data = await res.json();
    if (data.gravplats_id != null && data.gravplats_id === currentGravplatsId) {
      inmatningData = data;
      lastInmatningGravplatsId = currentGravplatsId;
    }
    (payload.extramaterial_kommentarer || []).forEach((item) => {
      const em = currentExtramaterial.find((e) => e.id === item.id);
      if (em) em.kommentar = item.kommentar || '';
    });
    inmatningDirty = false;
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

let _claudeOcrAbortController = null;

document.getElementById('gp-claude-ocr-btn')?.addEventListener('click', async function () {
  if (currentGravplatsId == null) return;
  if (_gravplatsHarBatchPagar && !_claudeBatchBlockEnskild) {
    if (!confirm('Gravplatsen ingår i ett pågående batch-jobb. Vill du ändå köra en enskild körning nu?')) return;
  }
  const btn = document.getElementById('gp-claude-ocr-btn');
  const avbrytBtn = document.getElementById('gp-claude-avbryt-btn');
  const bannerEl = document.getElementById('gp-ocr-kommentar-banner');
  _claudeOcrAbortController = new AbortController();
  btn.disabled = true;
  btn.textContent = 'Hämtar…';
  if (avbrytBtn) avbrytBtn.hidden = false;
  if (bannerEl) { bannerEl.hidden = true; bannerEl.textContent = ''; }
  try {
    const res = await fetch(`${API}/ocr/gravplats/${currentGravplatsId}`, {
      method: 'POST',
      credentials: 'include',
      signal: _claudeOcrAbortController.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    await ensureInmatningData();
    prefillFranClaude(data);
    gpPlayPling();
    if (data.ocr_kommentar && bannerEl) {
      bannerEl.innerHTML = formatOcrKommentar(data.ocr_kommentar);
      bannerEl.hidden = false;
    }
    sparatClaudeSvar = { svar_json: data, ocr_kommentar: data.ocr_kommentar || '', skapad_den: new Date().toISOString(), username: '' };
  } catch (err) {
    if (err.name === 'AbortError') { /* användaren avbröt – inget felmeddelande */ }
    else alert('Kunde inte hämta data från Claude: ' + (err.message || 'okänt fel'));
  } finally {
    _claudeOcrAbortController = null;
    btn.disabled = false;
    btn.textContent = 'Hämta från Claude';
    if (avbrytBtn) avbrytBtn.hidden = true;
  }
});

document.getElementById('gp-claude-avbryt-btn')?.addEventListener('click', function () {
  if (_claudeOcrAbortController) _claudeOcrAbortController.abort();
});

const gpInmatningEl = document.getElementById('gp-inmatning');
if (gpInmatningEl) {
  gpInmatningEl.addEventListener('input', () => { inmatningDirty = true; uppdateraInmatningSparaKnapp(); });
  gpInmatningEl.addEventListener('change', () => { inmatningDirty = true; uppdateraInmatningSparaKnapp(); });
}
uppdateraInmatningSparaKnapp();

function toggleRedigeraVy() {
  if (inmatningRedigerar) {
    if (inmatningDirty) {
      if (!confirm('Du har osparade ändringar. Sluta redigera utan att spara?')) return;
      inmatningDirty = false;
    }
    inmatningRedigerar = false;
    lastInmatningGravplatsId = null;
    const sparaWrap = document.getElementById('gp-inmatning-spara-wrap');
    if (sparaWrap) sparaWrap.hidden = true;
    sparatClaudeSvar = null;
    const sparatPanel = document.getElementById('gp-claude-sparat-panel');
    if (sparatPanel) sparatPanel.hidden = true;
    const batchBannerClose = document.getElementById('gp-batch-pagar-banner');
    if (batchBannerClose) { batchBannerClose.hidden = true; batchBannerClose.innerHTML = ''; }
    _gravplatsHarBatchPagar = false;
    const ocrBtnClose = document.getElementById('gp-claude-ocr-btn');
    if (ocrBtnClose) ocrBtnClose.disabled = false;
    const btn = document.getElementById('gp-btn-redigera');
    if (btn) btn.textContent = 'Redigera gravplatsen';
    expandAllInmatningSektioner();
    const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
    sektioner.forEach((s) => {
      ensureInmatningData().then((ok) => { if (ok) renderInmatningSektion(s); });
    });
    if (currentExtramaterial.length > 0 && currentExtramaterialMapp) {
      uppdateraExtramaterialSektion(currentExtramaterial, currentExtramaterialMapp);
    }
    uppdateraFardigtranskriberadKnapp();
  } else {
    inmatningRedigerar = true;
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
    if (currentExtramaterial.length > 0 && currentExtramaterialMapp) {
      uppdateraExtramaterialSektion(currentExtramaterial, currentExtramaterialMapp);
    }
    uppdateraInmatningSparaKnapp();
    uppdateraFardigtranskriberadKnapp();
  }
}

document.getElementById('gp-btn-redigera')?.addEventListener('click', toggleRedigeraVy);

document.getElementById('gp-claude-applicera-btn')?.addEventListener('click', function() {
  if (!sparatClaudeSvar) return;
  visaDiffDialog(sparatClaudeSvar.svar_json, function() {
    prefillFranClaude(sparatClaudeSvar.svar_json);
    gpPlayPling();
    const bannerEl = document.getElementById('gp-ocr-kommentar-banner');
    if (sparatClaudeSvar.ocr_kommentar && bannerEl) {
      bannerEl.innerHTML = formatOcrKommentar(sparatClaudeSvar.ocr_kommentar);
      bannerEl.hidden = false;
    }
  });
});


document.getElementById('gp-btn-fardigtranskriberad')?.addEventListener('click', async () => {
  if (!inmatningRedigerar || currentGravplatsId == null || !inmatningData) return;
  inmatningData.fardigtranskriberad = !inmatningData.fardigtranskriberad;
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
    const res = await fetch(`${API}/gravplats/${currentGravplatsId}/inmatning`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    if (res.status === 409) {
      lastInmatningGravplatsId = null;
      inmatningData = null;
      await ensureInmatningData();
      uppdateraFardigtranskriberadKnapp();
      visaSparStatus('Gravplatsen har ändrats av någon annan. Ladda om sidan.', false);
      return;
    }
    if (!res.ok) throw new Error('Kunde inte spara');
    const data = await res.json();
    if (data.gravplats_id != null && data.gravplats_id === currentGravplatsId) {
      inmatningData = data;
      lastInmatningGravplatsId = currentGravplatsId;
    }
    (payload.extramaterial_kommentarer || []).forEach((item) => {
      const em = currentExtramaterial.find((e) => e.id === item.id);
      if (em) em.kommentar = item.kommentar || '';
    });
    inmatningDirty = false;
    uppdateraInmatningSparaKnapp();
    visaSparStatus('Sparat.', true);
    visaSparToasts(achievementsBefore, data);
    if (inmatningData.fardigtranskriberad) {
      toggleRedigeraVy();
    }
  } catch (e) {
    inmatningData.fardigtranskriberad = !inmatningData.fardigtranskriberad;
    uppdateraFardigtranskriberadKnapp();
    visaSparStatus('Kunde inte spara: ' + (e && e.message ? e.message : 'okänt fel'), false);
  } finally {
    uppdateraFardigtranskriberadKnapp();
  }
});

function applyVyFromUrl() {
  const params = new URLSearchParams(window.location.search);
  vertikalVy = params.get('vy') !== 'horisontell';
  const innehall = document.getElementById('gp-innehall');
  const btn = document.getElementById('gp-btn-vy');
  if (innehall) innehall.classList.toggle('gp-vertikal-vy', vertikalVy);
  if (btn) btn.textContent = vertikalVy ? 'Horisontell vy' : 'Vertikal vy';
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
    valdKyrkogard = parsed.kyrkogard;
    valdKvarter = parsed.kvarter;
    if (tradVy) tradVy.hidden = true;
    if (innehall) innehall.hidden = false;
    try {
      const res = await fetch(`${API}/admin/databasunderhall/anvandare/${encodeURIComponent(granskaAnv)}/registreringar`, { credentials: 'include' });
      if (!res.ok) throw new Error('Kunde inte hämta registreringar');
      const data = await res.json();
      gravplatserLista = data.registreringar || [];
      if (gravplatserLista.length === 0) {
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
      let idx = gravplatserLista.findIndex(function (g) {
        const fs = (g.fullstandigt || [g.kyrkogard, g.kvarter, g.gravplatsnummer].filter(Boolean).join(' ')).trim();
        return fs === currentSlugDecoded;
      });
      if (idx < 0) idx = 0;
      currentIndex = idx;
      granskaAnvandareMode = true;
      granskaAnvandareId = granskaAnv;
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
    valdKyrkogard = parsed.kyrkogard;
    valdKvarter = parsed.kvarter;
    if (tradVy) tradVy.hidden = true;
    if (innehall) innehall.hidden = false;
    try {
      const res = await fetch(`${API}/batch-claude/jobb/${encodeURIComponent(batchJobbIdParam)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Kunde inte hämta batch-jobb');
      const data = await res.json();
      // Only include gravplatser with status 'klar' (have Claude responses)
      const poster = (data.poster || []).filter(function(p) { return p.status === 'klar'; });
      gravplatserLista = poster.map(function(p) {
        return {
          id: p.gravplats_id,
          kyrkogard: p.kyrkogard,
          kvarter: p.kvarter,
          gravplatsnummer: p.gravplatsnummer,
          mapp_namn: p.mapp_namn,
        };
      });
      let idx = gravplatserLista.findIndex(function(g) { return g.kyrkogard === parsed.kyrkogard && g.kvarter === parsed.kvarter && String(g.gravplatsnummer) === String(parsed.gravplatsnummer); });
      if (idx < 0) idx = 0;
      currentIndex = idx;
      batchJobbMode = true;
      batchJobbId = batchJobbIdParam;
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
  valdKyrkogard = parsed.kyrkogard;
  valdKvarter = parsed.kvarter;
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
        applyInmatningSectionsOrder(inmatningSectionsOrder);
      }
      if (me && !me.claude_tillganglig) {
        ['gp-claude-ocr-btn', 'gp-claude-avbryt-btn',
         'gp-claude-sparat-panel', 'gp-ocr-kommentar-banner', 'gp-claude-diff-dialog'].forEach(function(id) {
          var el = document.getElementById(id);
          if (el) el.remove();
        });
      }
      if (me && me.is_admin) {
        currentUserIsAdmin = true;
        const historikBtn = document.getElementById('gp-btn-historik');
        if (historikBtn) historikBtn.hidden = false;
      }
    })
    .catch(() => {
      applyInmatningSectionsOrder(inmatningSectionsOrder);
    });
} catch (_) {
  applyInmatningSectionsOrder(inmatningSectionsOrder);
}

initFromUrl();
