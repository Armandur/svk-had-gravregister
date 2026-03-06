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

async function laddaTrad() {
  const container = document.getElementById('gp-trad');
  const tomEl = document.getElementById('gp-trad-tom');
  if (!container) return;
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

async function laddaGravplatserForKvarter(targetGravplatsnummer) {
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
  if (btnTillbaka) btnTillbaka.disabled = idx <= 0;
  if (btnNasta) btnNasta.disabled = idx >= n - 1;

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
      const figcap = pdfKnapp ? `<figcaption class="gravplatser-halva-figcap">${pdfKnapp}</figcaption>` : '';
      return `<figure class="gravplatser-halva" data-halva-url="${esc(x.halvaUrl)}" data-hela-url="${esc(x.helaUrl)}" data-kan-hela="${x.halvaUrl !== x.helaUrl}" data-index="${i}">
        <img src="${imgSrc}" alt="" />
        ${figcap}
      </figure>`;
    }).join('');

    uppdateraToggleHelaKnapp();
    uppdateraExtramaterialSektion(extramaterial, mappNamn);
  } catch (e) {
    halvorEl.innerHTML = '<p class="gravplatser-fel">Kunde inte ladda halvor: ' + e.message + '</p>';
    currentExtramaterial = [];
    currentHalvorUrls = [];
    uppdateraExtramaterialSektion([], null);
  }
  inmatningDirty = false;
  uppdateraInmatningSparaKnapp();
  uppdateraInmatningSektionerVidGravplatsbyte();
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
  uppdateraInmatningSparaKnapp();
  uppdateraInmatningRubrikCounts();
  const ok = await ensureInmatningData();
  if (ok) {
    const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
    const oppna = sektioner.filter((s) => {
      const innehall = document.getElementById(`gp-innehall-${s}`);
      return innehall && !innehall.hidden;
    });
    oppna.forEach((s) => renderInmatningSektion(s));
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
    return `<button type="button" class="gp-em-miniatyr" data-em-index="${i}" data-bild-url="${esc(bildUrl)}" title="${esc(em.filnamn)}">
      <img src="${bildUrl}" alt="${esc(em.filnamn)}" loading="lazy" />
    </button>`;
  }).join('');

  miniatyrerEl.querySelectorAll('.gp-em-miniatyr').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.bildUrl;
      const idx = parseInt(btn.dataset.emIndex, 10);
      if (url != null && !isNaN(idx)) openLightbox(idx);
    });
  });
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

function scrollGalleri(riktning) {
  const miniatyrerEl = document.getElementById('gp-em-miniatyrer');
  if (!miniatyrerEl) return;
  const step = 140;
  miniatyrerEl.scrollBy({ left: riktning * step, behavior: 'smooth' });
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

document.getElementById('gp-btn-tillbaka-kvarter')?.addEventListener('click', () => {
  window.location.href = '/gravplatser';
});
document.getElementById('gp-btn-tillbaka')?.addEventListener('click', tillbaka);
document.getElementById('gp-btn-nasta')?.addEventListener('click', nasta);
document.getElementById('gp-btn-toggle-hela')?.addEventListener('click', toggleHelaSidor);
document.getElementById('gp-btn-vy')?.addEventListener('click', toggleVertikalVy);

document.getElementById('gp-em-rubrik')?.addEventListener('click', toggleExtramaterialInnehall);
document.getElementById('gp-em-prev')?.addEventListener('click', () => scrollGalleri(-1));
document.getElementById('gp-em-next')?.addEventListener('click', () => scrollGalleri(1));

document.getElementById('gp-halvor')?.addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const fig = e.target.closest('.gravplatser-halva');
  if (!fig) return;
  const idx = fig.getAttribute('data-index');
  if (idx != null && idx !== '') openLightboxHalvor(parseInt(idx, 10));
});

document.getElementById('gp-lightbox-stang')?.addEventListener('click', closeLightbox);
document.getElementById('gp-lightbox-prev')?.addEventListener('click', lightboxPrev);
document.getElementById('gp-lightbox-next')?.addEventListener('click', lightboxNext);
document.getElementById('gp-lightbox')?.addEventListener('click', (e) => {
  if (e.target.id === 'gp-lightbox') closeLightbox();
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
    tillbaka();
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    nasta();
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

/** Läsvy: rendera sektionens innehåll som text/layout utan formulärfält. */
function renderInmatningSektionLäs(sektion) {
  const d = inmatningData || {};
  const innehall = document.getElementById(`gp-innehall-${sektion}`);
  if (!innehall) return;
  const v = (x) => (x != null && String(x).trim() !== '' ? esc(String(x).trim()) : '');
  const rad = (label, value) => {
    const val = value != null && String(value).trim() !== '' ? String(value).trim() : '';
    return `<div class="gp-las-rad"><span class="gp-las-label">${esc(label)}</span><span class="gp-las-varde ${val ? '' : 'gp-las-tom'}">${val ? esc(val) : '—'}</span></div>`;
  };

  if (sektion === 'innehavare') {
    const inv = d.innehavare || [];
    if (inv.length === 0) {
      innehall.innerHTML = '<div class="gp-inmatning-las"><p class="gp-las-tom">Inga gravrättsinnehavare registrerade.</p></div>';
      return;
    }
    innehall.innerHTML = '<div class="gp-inmatning-las"><ul class="gp-las-lista">' + inv.map((i) => {
      const fn = v(i.fornamn); const en = v(i.efternamn); const yrke = v(i.yrke); const adr = v(i.adress);
      const namn = [fn, en].filter(Boolean).join(' ') || '—';
      return `<li class="gp-las-kort"><div class="gp-las-rad"><span class="gp-las-label">Namn</span><span class="gp-las-varde">${namn}</span></div>` +
        (yrke ? rad('Yrke', i.yrke) : '') +
        (adr ? rad('Adress', i.adress) : '') + '</li>';
    }).join('') + '</ul></div>';
    return;
  }

  if (sektion === 'narmast_anhoriga') {
    const na = d.narmast_anhoriga || [];
    if (na.length === 0) {
      innehall.innerHTML = '<div class="gp-inmatning-las"><p class="gp-las-tom">Inga närmast anhöriga registrerade.</p></div>';
      return;
    }
    innehall.innerHTML = '<div class="gp-inmatning-las"><ul class="gp-las-lista">' + na.map((n) => {
      const fn = v(n.fornamn); const en = v(n.efternamn);
      const namn = [fn, en].filter(Boolean).join(' ') || '—';
      let html = `<li class="gp-las-kort"><div class="gp-las-rad"><span class="gp-las-label">Namn</span><span class="gp-las-varde">${namn}</span></div>`;
      if (n.adress) html += rad('Gatuadress', n.adress);
      if (n.postnummer || n.postort) html += rad('Postnummer / ort', [n.postnummer, n.postort].filter(Boolean).join(' '));
      if (n.telefon) html += rad('Telefon', n.telefon);
      return html + '</li>';
    }).join('') + '</ul></div>';
    return;
  }

  if (sektion === 'gravplatsen') {
    const r = (lbl, val) => rad(lbl, val);
    innehall.innerHTML = '<div class="gp-inmatning-las">' +
      r('Underhåll inbetalt för alla framtid den', d.underhall_text) +
      (d.underhall_overstruket ? '<div class="gp-las-rad"><span class="gp-las-label"></span><span class="gp-las-varde">"För all framtid" överstruket</span></div>' : '') +
      r('Gravrättstid', d.gravrattstid) +
      r('Monument', d.monument) +
      r('Gravens utformning', d.gravens_utformning) +
      '<h4 class="gp-inmatning-delrubrik">Övrigt</h4>' +
      r('Karta nr', d.karta_nr) +
      r('Gravbrev nr', d.gravbrev_nr) +
      r('Utfärdat den', d.utfordat_den) +
      r('Kommentar', d.kommentar) +
      '</div>';
    return;
  }

  if (sektion === 'skiss') {
    innehall.innerHTML = '<div class="gp-inmatning-las">' + rad('Storlek', d.storlek) + '<p class="gp-skiss-info">Här kommer du senare kunna ange/croppa skiss från bilden.</p></div>';
    return;
  }

  if (sektion === 'gravsatta') {
    const gs = d.gravsatta || [];
    if (gs.length === 0) {
      innehall.innerHTML = '<div class="gp-inmatning-las"><p class="gp-las-tom">Inga gravsatta registrerade.</p></div>';
      return;
    }
    innehall.innerHTML = '<div class="gp-inmatning-las"><ul class="gp-las-lista">' + gs.map((g, idx) => {
      const namn = [v(g.fornamn), v(g.efternamn)].filter(Boolean).join(' ') || '—';
      const fodelse = formatDatum(g.fodelse_ar, g.fodelse_manad, g.fodelse_dag);
      const dods = formatDatum(g.dods_ar, g.dods_manad, g.dods_dag);
      let html = `<li class="gp-las-kort"><h4 class="gp-inmatning-delrubrik">Gravsatt ${idx + 1}</h4>`;
      if (g.ar_beteckning) html += '<div class="gp-las-rad"><span class="gp-las-label"></span><span class="gp-las-varde">Använd som beteckning (t.ex. familjegrav)</span></div>';
      html += rad('Namn', namn) + rad('Adress', g.adress) + rad('Födelsedatum', fodelse) + rad('Födelsenummer', g.fod_nr) +
        rad('Dödsdatum', dods) + rad('Db. nummer', g.dodsbok_nr) + rad('Gravsatt den', g.gravsatt_den) + rad('Urna/Kista', g.urna);
      return html + '</li>';
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
    let html = inv.map((i) => `
      <div class="gp-inmatning-rad gp-innehavare-rad">
        <label>Förnamn <input type="text" name="inv_fornamn" value="${esc(i.fornamn)}" /></label>
        <label>Efternamn <input type="text" name="inv_efternamn" value="${esc(i.efternamn)}" /></label>
        <label>Yrke <input type="text" name="inv_yrke" value="${esc(i.yrke)}" /></label>
        <label>Adress <input type="text" name="inv_adress" value="${esc(i.adress)}" /></label>
        <button type="button" class="gp-rad-ta-bort">Ta bort</button>
      </div>`).join('');
    html += '<button type="button" class="gp-lagg-till-innehavare">+ Lägg till innehavare</button>';
    innehall.innerHTML = html;
    innehall.querySelectorAll('.gp-innehavare-rad .gp-rad-ta-bort').forEach((b) => b.addEventListener('click', () => {
      b.closest('.gp-innehavare-rad')?.remove();
      markInmatningDirty();
      uppdateraInmatningRubrikCounts();
    }));
    innehall.querySelector('.gp-lagg-till-innehavare')?.addEventListener('click', () => {
      const rad = document.createElement('div');
      rad.className = 'gp-inmatning-rad gp-innehavare-rad';
      rad.innerHTML = '<label>Förnamn <input type="text" name="inv_fornamn" /></label><label>Efternamn <input type="text" name="inv_efternamn" /></label><label>Yrke <input type="text" name="inv_yrke" /></label><label>Adress <input type="text" name="inv_adress" /></label><button type="button" class="gp-rad-ta-bort">Ta bort</button>';
      innehall.insertBefore(rad, innehall.querySelector('.gp-lagg-till-innehavare'));
      rad.querySelector('.gp-rad-ta-bort').addEventListener('click', () => { rad.remove(); markInmatningDirty(); uppdateraInmatningRubrikCounts(); });
      markInmatningDirty();
      uppdateraInmatningRubrikCounts();
    });
    uppdateraInmatningRubrikCounts();
    return;
  }

  if (sektion === 'narmast_anhoriga') {
    const na = d.narmast_anhoriga || [];
    let html = na.map((n) => `
      <div class="gp-inmatning-rad gp-na-rad">
        <label>Förnamn <input type="text" name="na_fornamn" value="${esc(n.fornamn)}" /></label>
        <label>Efternamn <input type="text" name="na_efternamn" value="${esc(n.efternamn)}" /></label>
        <label>Gatuadress <input type="text" name="na_gatuadress" value="${esc(n.adress)}" /></label>
        <label>Postnummer <input type="text" name="na_postnummer" value="${esc(n.postnummer)}" /></label>
        <label>Postort <input type="text" name="na_postort" value="${esc(n.postort)}" /></label>
        <label>Telefon <input type="text" name="na_telefon" value="${esc(n.telefon)}" /></label>
        <button type="button" class="gp-na-ta-bort">Ta bort</button>
      </div>`).join('');
    html += '<button type="button" class="gp-lagg-till-na">+ Lägg till närmast anhörig</button>';
    innehall.innerHTML = html;
    innehall.querySelectorAll('.gp-na-rad .gp-na-ta-bort').forEach((b) => b.addEventListener('click', () => {
      b.closest('.gp-na-rad')?.remove();
      markInmatningDirty();
      uppdateraInmatningRubrikCounts();
    }));
    innehall.querySelector('.gp-lagg-till-na')?.addEventListener('click', () => {
      const rad = document.createElement('div');
      rad.className = 'gp-inmatning-rad gp-na-rad';
      rad.innerHTML = '<label>Förnamn <input type="text" name="na_fornamn" /></label><label>Efternamn <input type="text" name="na_efternamn" /></label><label>Gatuadress <input type="text" name="na_gatuadress" /></label><label>Postnummer <input type="text" name="na_postnummer" /></label><label>Postort <input type="text" name="na_postort" /></label><label>Telefon <input type="text" name="na_telefon" /></label><button type="button" class="gp-na-ta-bort">Ta bort</button>';
      innehall.insertBefore(rad, innehall.querySelector('.gp-lagg-till-na'));
      rad.querySelector('.gp-na-ta-bort').addEventListener('click', () => { rad.remove(); markInmatningDirty(); uppdateraInmatningRubrikCounts(); });
      markInmatningDirty();
      uppdateraInmatningRubrikCounts();
    });
    uppdateraInmatningRubrikCounts();
    return;
  }

  if (sektion === 'gravplatsen') {
    innehall.innerHTML = `
      <label>Underhåll inbetalt för all framtid den <input type="text" name="underhall_text" value="${esc(d.underhall_text)}" /></label>
      <label><input type="checkbox" name="underhall_overstruket" ${d.underhall_overstruket ? 'checked' : ''} /> "För all framtid" överstruket</label>
      <label>Gravrättstid <input type="text" name="gravrattstid" value="${esc(d.gravrattstid)}" /></label>
      <label>Monument <input type="text" name="monument" value="${esc(d.monument)}" /></label>
      <label>Gravens utformning <input type="text" name="gravens_utformning" value="${esc(d.gravens_utformning)}" /></label>
      <h4 class="gp-inmatning-delrubrik">Övrigt</h4>
      <label>Karta nr <input type="text" name="karta_nr" value="${esc(d.karta_nr)}" /></label>
      <label>Gravbrev nr <input type="text" name="gravbrev_nr" value="${esc(d.gravbrev_nr)}" /></label>
      <label>Utfärdat den <input type="text" name="utfordat_den" value="${esc(d.utfordat_den)}" /></label>
      <label>Kommentar <textarea name="kommentar" rows="2">${esc(d.kommentar)}</textarea></label>`;
    return;
  }

  if (sektion === 'skiss') {
    innehall.innerHTML = `
      <label>Storlek <input type="text" name="storlek" value="${esc(d.storlek)}" /></label>
      <p class="gp-skiss-info">Här kommer du senare kunna ange/croppa skiss från bilden.</p>`;
    return;
  }

  if (sektion === 'gravsatta') {
    const gs = d.gravsatta || [];
    let html = gs.map((g, idx) => blockGravsatt(idx, g)).join('');
    html += '<button type="button" class="gp-lagg-till-gravsatt">+ Lägg till gravsatt</button>';
    innehall.innerHTML = html;
    bindDatumValidering(innehall);
    bindGravsattDragDrop(innehall);
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
      markInmatningDirty();
      uppdateraInmatningRubrikCounts();
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

function bindDatumValidering(container) {
  const block = container.classList?.contains('gp-gravsatt-block') ? container : null;
  const blocks = block ? [block] : container.querySelectorAll('.gp-gravsatt-block');
  blocks.forEach((blk) => {
    const idx = blk.dataset.gsIndex != null ? blk.dataset.gsIndex : '';
    const felIds = { gs_fodelse_datum: `gs_fodelse_datum_fel_${idx}`, gs_dods_datum: `gs_dods_datum_fel_${idx}`, gs_gravsatt_den: `gs_gravsatt_den_fel_${idx}` };
    ['gs_fodelse_datum', 'gs_dods_datum', 'gs_gravsatt_den'].forEach((base) => {
      const inp = blk.querySelector(`[name="${base}_${idx}"]`);
      const felSpan = document.getElementById(felIds[base]);
      if (!inp) return;
      const run = () => visaDatumValidering(inp, felSpan);
      inp.addEventListener('blur', () => {
        const fore = inp.value;
        normaliseraDatumFalt(inp);
        if (inp.value !== fore) markInmatningDirty();
        run();
      });
      inp.addEventListener('input', run);
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
  const ph = 'YYYY, YYYY-MM eller YYYY-MM-DD';
  return `
    <div class="gp-gravsatt-block" data-gs-index="${idx}">
      <h4><span class="gp-gravsatt-drag-handle" draggable="true" title="Dra för att ändra ordning">⋮⋮</span> Gravsatt ${pos}</h4>
      ${beteckning}
      <div class="gp-gravsatt-rad">
        <label>Förnamn <input type="text" name="gs_fornamn_${idx}" value="${esc(g.fornamn)}" /></label>
        <label>Efternamn <input type="text" name="gs_efternamn_${idx}" value="${esc(g.efternamn)}" /></label>
      </div>
      <div class="gp-gravsatt-rad">
        <label>Adress <input type="text" name="gs_adress_${idx}" value="${esc(g.adress)}" /></label>
      </div>
      <div class="gp-gravsatt-rad">
        <label>Födelsedatum <input type="text" name="gs_fodelse_datum_${idx}" value="${esc(fodelseDatum)}" placeholder="${ph}" aria-describedby="gs_fodelse_datum_fel_${idx}" /></label>
        <span class="gp-datum-fel" id="gs_fodelse_datum_fel_${idx}" hidden aria-live="polite"></span>
        <label>Födelsenummer <input type="text" name="gs_fod_nr_${idx}" value="${esc(g.fod_nr)}" /></label>
      </div>
      <div class="gp-gravsatt-rad">
        <label>Dödsdatum <input type="text" name="gs_dods_datum_${idx}" value="${esc(dodsDatum)}" placeholder="${ph}" aria-describedby="gs_dods_datum_fel_${idx}" /></label>
        <span class="gp-datum-fel" id="gs_dods_datum_fel_${idx}" hidden aria-live="polite"></span>
        <label>Db. nummer <input type="text" name="gs_dodsbok_nr_${idx}" value="${esc(g.dodsbok_nr)}" /></label>
      </div>
      <div class="gp-gravsatt-rad">
        <label>Gravsatt den <input type="text" name="gs_gravsatt_den_${idx}" value="${esc(g.gravsatt_den)}" placeholder="${ph}" aria-describedby="gs_gravsatt_den_fel_${idx}" /></label>
        <span class="gp-datum-fel" id="gs_gravsatt_den_fel_${idx}" hidden aria-live="polite"></span>
      </div>
      <div class="gp-gravsatt-rad">
        <label>Urna/Kista <select name="gs_urna_${idx}">${urnaOptions}</select></label>
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
      const fornamn = (rad.querySelector('input[name="inv_fornamn"]')?.value ?? '').trim();
      const efternamn = (rad.querySelector('input[name="inv_efternamn"]')?.value ?? '').trim();
      const yrke = (rad.querySelector('input[name="inv_yrke"]')?.value ?? '').trim();
      const adress = (rad.querySelector('input[name="inv_adress"]')?.value ?? '').trim();
      innehavare.push({ fornamn, efternamn, yrke, adress, sort_order: innehavare.length });
    });
  } else {
    innehavare = (d.innehavare || []).map((i, idx) => ({ fornamn: i.fornamn || '', efternamn: i.efternamn || '', yrke: i.yrke || '', adress: i.adress || '', sort_order: idx }));
  }

  let narmast_anhoriga = [];
  const naRader = root.querySelectorAll('.gp-na-rad');
  if (naRader.length > 0) {
    naRader.forEach((rad) => {
      const fornamn = (rad.querySelector('input[name="na_fornamn"]')?.value ?? '').trim();
      const efternamn = (rad.querySelector('input[name="na_efternamn"]')?.value ?? '').trim();
      const adress = (rad.querySelector('input[name="na_gatuadress"]')?.value ?? '').trim();
      const postnummer = (rad.querySelector('input[name="na_postnummer"]')?.value ?? '').trim();
      const postort = (rad.querySelector('input[name="na_postort"]')?.value ?? '').trim();
      const telefon = (rad.querySelector('input[name="na_telefon"]')?.value ?? '').trim();
      if (fornamn || efternamn) narmast_anhoriga.push({ fornamn, efternamn, adress, postnummer, postort, telefon, sort_order: narmast_anhoriga.length });
    });
  } else {
    narmast_anhoriga = (d.narmast_anhoriga || []).map((n, idx) => ({
      fornamn: n.fornamn || '', efternamn: n.efternamn || '', adress: n.adress || '', postnummer: n.postnummer || '', postort: n.postort || '', telefon: n.telefon || '', sort_order: idx,
    }));
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
    });
  });
  } else {
    gravsatta = (d.gravsatta || []).map((g, i) => ({
      position: i + 1,
      ar_beteckning: g.ar_beteckning ?? false,
      fornamn: g.fornamn || '',
      efternamn: g.efternamn || '',
      adress: g.adress || '',
      fodelse_ar: g.fodelse_ar ?? null,
      fodelse_manad: g.fodelse_manad ?? null,
      fodelse_dag: g.fodelse_dag ?? null,
      fod_nr: g.fod_nr || '',
      dods_ar: g.dods_ar ?? null,
      dods_manad: g.dods_manad ?? null,
      dods_dag: g.dods_dag ?? null,
      dodsbok_nr: g.dodsbok_nr || '',
      gravsatt_den: g.gravsatt_den || '',
      urna: g.urna || '',
    }));
  }

  const gravplatsenOppnad = root.querySelector('input[name="underhall_text"]') != null;
  const skissOppnad = root.querySelector('#gp-innehall-skiss input[name="storlek"]') != null;
  const storlek = skissOppnad ? (root.querySelector('#gp-innehall-skiss input[name="storlek"]')?.value ?? '').trim() : (d.storlek || '');
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
    const idx = blk.dataset.gsIndex != null ? blk.dataset.gsIndex : '';
    ['gs_fodelse_datum', 'gs_dods_datum', 'gs_gravsatt_den'].forEach((base) => {
      const inp = blk.querySelector(`[name="${base}_${idx}"]`);
      const felSpan = document.getElementById(`${base}_fel_${idx}`);
      if (!inp) return;
      const r = validDatum(inp.value);
      if (r.valid) {
        if (felSpan) { felSpan.hidden = true; felSpan.textContent = ''; }
        inp.setCustomValidity('');
      } else {
        if (felSpan) { felSpan.textContent = r.message || DATUM_FORMAT_TEXT; felSpan.hidden = false; }
        inp.setCustomValidity(r.message || DATUM_FORMAT_TEXT);
        if (!firstInvalid) firstInvalid = inp;
      }
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
    const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
    sektioner.forEach((s) => {
      const innehall = document.getElementById(`gp-innehall-${s}`);
      if (innehall && !innehall.hidden) ensureInmatningData().then((ok) => { if (ok) renderInmatningSektion(s); });
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

document.getElementById('gp-btn-fardigtranskriberad')?.addEventListener('click', () => {
  if (!inmatningRedigerar || currentGravplatsId == null || !inmatningData) return;
  inmatningData.fardigtranskriberad = !inmatningData.fardigtranskriberad;
  markInmatningDirty();
  uppdateraFardigtranskriberadKnapp();
  uppdateraInmatningSparaKnapp();
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
