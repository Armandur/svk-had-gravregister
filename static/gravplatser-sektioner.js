/**
 * Gravplatsvyn: AI-förslagsbannern, extramaterial, dolda halvor och vyväxlarna.
 * Laddas före gravplatser.js och delar dess globala state.
 */

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
  if (state.currentGravplatsId == null) {
    state.inmatningData = null;
    state.lastInmatningGravplatsId = null;
    uppdateraFardigtranskriberadKnapp();
    return;
  }
  state.inmatningData = null;
  state.lastInmatningGravplatsId = null;
  state.inmatningDirty = false;
  state.inmatningRedigerar = false;
  state.sparatClaudeSvar = null;
  const sparaWrap = document.getElementById('gp-inmatning-spara-wrap');
  if (sparaWrap) sparaWrap.hidden = true;
  const avbrytPanelNav = document.getElementById('gp-avbryt-bekraftelse');
  if (avbrytPanelNav) avbrytPanelNav.hidden = true;
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
  if (state.batchJobbMode) await batchAutoLaddaClaude();
  else await visaAiForslagOmAiLast();
  if (inmatningHarNagonData()) hamtaSparadRimlighet();
}

/** Bästa förslaget att visa: Claudes om det finns, annars senaste lokala. */
function valjAiForslag(alla) {
  return alla.find(function(s) { return s.kalla === 'claude'; }) || alla[0] || null;
}

/**
 * För en AI-läst grav som ingen har sparat något på: visa AI-förslaget direkt i
 * formuläret, så man granskar i stället för att först klicka Ladda in. Förslaget
 * räknas inte som en osparad ändring förrän man går in i redigeringsläget.
 */
async function visaAiForslagOmAiLast() {
  const d = state.inmatningData;
  if (!d || !d.ai_svar_finns || d.fardigtranskriberad || inmatningHarNagonData() || state.inmatningRedigerar) return;
  const gpId = state.currentGravplatsId;
  try {
    const res = await fetch(`${API}/ocr/gravplats/${gpId}/svar-alla`, { credentials: 'include' });
    if (!res.ok || gpId !== state.currentGravplatsId) return;
    const alla = (await res.json()).svar || [];
    const forslag = valjAiForslag(alla);
    if (!forslag || gpId !== state.currentGravplatsId || state.inmatningRedigerar) return;
    state.sparadeOcrSvar = alla;
    state.sparatClaudeSvar = forslag;
    state.aiForslag = { gravplatsId: gpId, svar: forslag };
    prefillFranClaude(forslag.svar_json);
    state.inmatningDirty = false;
    uppdateraInmatningSparaKnapp();
    visaFaltmarkeringar(forslag.varningar, forslag.osakra);
    visaAiForslagBanner();
    uppdateraFardigtranskriberadKnapp();
  } catch (e) { /* förslaget är en bekvämlighet, vyn fungerar utan det */ }
}

function visaAiForslagBanner() {
  const banner = document.getElementById('gp-ai-forslag-banner');
  if (!banner) return;
  const f = state.aiForslag;
  if (!f || f.gravplatsId !== state.currentGravplatsId) { banner.hidden = true; banner.textContent = ''; return; }
  const kalla = f.svar.kalla === 'lokal' ? 'lokal modell (' + f.svar.modell + ')' : 'Claude';
  banner.textContent = state.inmatningRedigerar
    ? 'Formuläret är ifyllt med AI-förslaget från ' + kalla + '. Rätta mot kortet och spara.'
    : 'Visar AI-förslaget från ' + kalla + '. Inget är granskat eller sparat. Klicka Redigera gravplatsen för att rätta och spara.' +
      (Object.keys(f.svar.osakra || {}).length ? ' Siffror som modellen var osäker på ramas in i gult när du redigerar.' : '');
  banner.hidden = false;
}

/**
 * I batch-granskningsläge: gå automatiskt in i redigeringsläge och ladda in det sparade
 * Claude-svaret. Om gravplatsen redan har inmatad data visas panelen för manuell
 * bekräftelse; annars appliceras svaret direkt.
 */
async function batchAutoLaddaClaude() {
  if (!state.batchJobbMode || state.currentGravplatsId == null) return;
  const gpId = state.currentGravplatsId;

  // Gå in i redigeringsläge
  state.inmatningRedigerar = true;
  const sparaWrap = document.getElementById('gp-inmatning-spara-wrap');
  if (sparaWrap) sparaWrap.hidden = false;
  const redigeraBtn = document.getElementById('gp-btn-redigera');
  if (redigeraBtn) redigeraBtn.textContent = 'Sluta redigera gravplats';
  uppdateraInmatningSparaKnapp();
  uppdateraFardigtranskriberadKnapp();
  const sektioner = ['innehavare', 'narmast_anhoriga', 'gravplatsen', 'skiss', 'gravsatta'];
  sektioner.forEach((s) => renderInmatningSektion(s));
  if (state.currentExtramaterial.length > 0 && state.currentExtramaterialMapp) {
    uppdateraExtramaterialSektion(state.currentExtramaterial, state.currentExtramaterialMapp);
  }

  // Hämta jobbets svar: lokala jobb laddar senaste lokala svaret, övriga Claudes
  try {
    const res = await fetch(`${API}/ocr/gravplats/${gpId}/svar-alla`, { credentials: 'include' });
    if (!res.ok || state.currentGravplatsId !== gpId) return;
    const alla = (await res.json()).svar || [];
    if (state.currentGravplatsId !== gpId) return;
    const data = alla.find(function(s) { return s.kalla === (state.batchJobbLokal ? 'lokal' : 'claude'); });
    if (!data) return;
    state.sparadeOcrSvar = alla;
    state.sparatClaudeSvar = data;

    const bannerEl = document.getElementById('gp-ocr-kommentar-banner');
    if (!inmatningHarNagonData()) {
      // Ingen befintlig data – applicera direkt (inget pling, svaret är redan sparat sedan batch-körningen)
      prefillFranClaude(data.svar_json);
      visaFaltmarkeringar(data.varningar, data.osakra);
      markInmatningDirty();
      uppdateraFardigtranskriberadKnapp();
      if (data.ocr_kommentar && bannerEl) {
        bannerEl.innerHTML = formatOcrKommentar(data.ocr_kommentar);
        bannerEl.hidden = false;
      }
    } else {
      // Befintlig data finns – visa panel för manuell bekräftelse
      visaSparatClaudeSvar();
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

  const cacheQ = `_v=${state.cacheBust}`;
  miniatyrerEl.innerHTML = extramaterial.map((em, i) => {
    const bildUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/fil/${encodeURIComponent(em.filnamn)}/bild?${cacheQ}`;
    const esc = (s) => (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const redanHalva = em.redan_halva === true;
    const knappText = redanHalva ? 'Endast i extramaterial' : 'Visa som gravplatsbild';
    const kommentar = em.kommentar || '';
    const kommentarHtml = state.inmatningRedigerar
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
      if (!emId || !state.currentExtramaterialMapp) return;
      btn.disabled = true;
      try {
        const res = await fetch(`${API}/mappar/${encodeURIComponent(state.currentExtramaterialMapp)}/extramaterial/${emId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ redan_halva: !redanHalva }),
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

  const cacheQ = `_v=${state.cacheBust}`;
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
        if (isNaN(contentSida) || !halva || state.currentGravplatsId == null) return;
        btn.disabled = true;
        try {
          const res = await fetch(
            `${API}/gravplats/${state.currentGravplatsId}/dold-halva?content_sida=${contentSida}&halva=${encodeURIComponent(halva)}`,
            { method: 'DELETE' }
          );
          if (!res.ok) throw new Error('Kunde inte uppdatera');
          await uppdateraVy(true);
        } catch (err) {
          btn.disabled = false;
          showToast('Kunde inte uppdatera: ' + (err.message || 'nätverksfel'), 'fel');
        }
      } else {
        const emId = btn.dataset.emId;
        if (!emId || !state.currentExtramaterialMapp) return;
        btn.disabled = true;
        try {
          const res = await fetch(`${API}/mappar/${encodeURIComponent(state.currentExtramaterialMapp)}/extramaterial/${emId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dold: false }),
            credentials: 'include',
          });
          if (!res.ok) throw new Error('Kunde inte uppdatera');
          await uppdateraVy(true);
        } catch (err) {
          btn.disabled = false;
          showToast('Kunde inte uppdatera: ' + (err.message || 'nätverksfel'), 'fel');
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
  btn.textContent = state.visarHelaSidor ? 'Visa halva' : 'Visa hela sidan';
}

function toggleVertikalVy() {
  state.vertikalVy = !state.vertikalVy;
  const innehall = document.getElementById('gp-innehall');
  const btn = document.getElementById('gp-btn-vy');
  if (innehall) innehall.classList.toggle('gp-vertikal-vy', state.vertikalVy);
  if (btn) btn.textContent = state.vertikalVy ? 'Horisontell vy' : 'Vertikal vy';
  const path = window.location.pathname;
  const fullUrl = path + (state.vertikalVy ? '' : '?vy=horisontell');
  history.replaceState(null, '', fullUrl);
}

function toggleHelaSidor() {
  const halvorEl = document.getElementById('gp-halvor');
  if (!halvorEl) return;
  state.visarHelaSidor = !state.visarHelaSidor;
  halvorEl.querySelectorAll('.gravplatser-halva[data-kan-hela="true"]').forEach((fig) => {
    const img = fig.querySelector('img');
    if (!img) return;
    img.src = state.visarHelaSidor ? fig.dataset.helaUrl : fig.dataset.halvaUrl;
  });
  uppdateraToggleHelaKnapp();
}
