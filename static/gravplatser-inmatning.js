/**
 * Gravplatsvyn: Inmatningens tillstånd: laddning, räknare, knappar, sektioner och dra-och-släpp.
 * Laddas före gravplatser.js och delar dess globala state.
 */

async function ensureInmatningData() {
  if (state.currentGravplatsId == null) return false;
  if (state.lastInmatningGravplatsId === state.currentGravplatsId && state.inmatningData) return true;
  const idForFetch = state.currentGravplatsId;
  try {
    const res = await fetch(`${API}/gravplats/${idForFetch}/inmatning`, { credentials: 'include' });
    if (!res.ok) throw new Error('Kunde inte hämta inmatning');
    const data = await res.json();
    // Acceptera endast data för aktuell gravplats (undvik att visa 1+2:s data på 3 vid snabb navigering)
    if (data.gravplats_id != null && data.gravplats_id !== state.currentGravplatsId) return false;
    state.inmatningData = data;
    state.lastInmatningGravplatsId = state.currentGravplatsId;
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
  const nInnehavare = root.querySelectorAll('.gp-innehavare-rad').length || (state.inmatningData && (state.inmatningData.innehavare || []).length) || 0;
  const nAnhoriga = root.querySelectorAll('.gp-na-rad').length || (state.inmatningData && (state.inmatningData.narmast_anhoriga || []).length) || 0;
  const nGravsatta = root.querySelectorAll('.gp-gravsatt-block').length || (state.inmatningData && (state.inmatningData.gravsatta || []).length) || 0;
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
  if (btn) btn.disabled = !state.inmatningDirty;
}

function inmatningHarNagonData() {
  if (!state.inmatningData) return false;
  const s = (v) => (v != null && String(v).trim() !== '');
  if (s(state.inmatningData.storlek) || s(state.inmatningData.underhall_text) || s(state.inmatningData.gravrattstid) || s(state.inmatningData.monument) ||
      s(state.inmatningData.gravens_utformning) || s(state.inmatningData.karta_nr) || s(state.inmatningData.gravbrev_nr) || s(state.inmatningData.utfordat_den) || s(state.inmatningData.kommentar))
    return true;
  const inv = state.inmatningData.innehavare || [];
  if (inv.some((i) => s(i.fornamn) || s(i.efternamn) || s(i.yrke) || s(i.gatuadress) || s(i.postnummer) || s(i.postort) || s(i.kommentar))) return true;
  const na = state.inmatningData.narmast_anhoriga || [];
  if (na.some((n) => s(n.fornamn) || s(n.efternamn) || s(n.yrke) || s(n.adress) || s(n.kommentar))) return true;
  const gs = state.inmatningData.gravsatta || [];
  if (gs.some((g) => g.ar_beteckning || s(g.fornamn) || s(g.efternamn) || s(g.gatuadress) || s(g.postnummer) || s(g.postort) || s(g.gravsatt_den) || s(g.kommentar))) return true;
  if (state.inmatningData.has_skiss || ((state.inmatningData.skisser || []).length > 0)) return true;
  return false;
}

function uppdateraFardigtranskriberadKnapp() {
  const btn = document.getElementById('gp-btn-fardigtranskriberad');
  if (!btn) return;
  const arFardig = state.inmatningData && state.inmatningData.fardigtranskriberad === true;
  const harData = inmatningHarNagonData();
  btn.classList.remove('gp-fardigtranskriberad-ja', 'gp-fardigtranskriberad-paborjad', 'gp-fardigtranskriberad-nej', 'gp-fardigtranskriberad-ai');
  if (arFardig) {
    btn.classList.add('gp-fardigtranskriberad-ja');
    btn.textContent = 'Färdigtranskriberad';
  } else if (state.aiForslag && state.aiForslag.gravplatsId === state.currentGravplatsId) {
    const n = (state.aiForslag.svar.varningar || []).filter(function(v) { return !v.kvitterad; }).length + Object.keys(state.aiForslag.svar.osakra || {}).length;
    btn.classList.add('gp-fardigtranskriberad-ai');
    btn.textContent = 'AI-läst, ej granskad' + (n ? ' (' + n + (n === 1 ? ' varning)' : ' varningar)') : '');
  } else if (harData) {
    btn.classList.add('gp-fardigtranskriberad-paborjad');
    btn.textContent = 'Transkribering påbörjad';
  } else if (state.inmatningData && state.inmatningData.ai_svar_finns) {
    const n = state.inmatningData.ai_varningar || 0;
    btn.classList.add('gp-fardigtranskriberad-ai');
    btn.textContent = 'AI-läst, ej granskad' + (n ? ' (' + n + (n === 1 ? ' varning)' : ' varningar)') : '');
  } else {
    btn.classList.add('gp-fardigtranskriberad-nej');
    btn.textContent = 'Ej transkriberad';
  }
  btn.disabled = state.currentGravplatsId == null || !state.inmatningRedigerar;
  uppdateraOcrKnapp();
  uppdateraSenastRedigerad();
}

function uppdateraSenastRedigerad() {
  const el = document.getElementById('gp-senast-redigerad');
  if (!el) return;
  const when = state.inmatningData && state.inmatningData.last_edited_at;
  const who = state.inmatningData && state.inmatningData.last_edited_by_username;
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
  const kanStarta = !!ocrTargetElement && state.inmatningRedigerar && state.currentGravplatsId != null && harHalvor;
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
  state.inmatningDirty = true;
  uppdateraInmatningSparaKnapp();
}

/** Returnerar true om sektionen saknar data (i visningsläge ska klick då inte fälla ut). */
function arSektionTom(sektion) {
  const d = state.inmatningData || {};
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
  if (state.currentGravplatsId == null) return;
  ensureInmatningData().then((ok) => {
    if (ok) {
      renderInmatningSektion(sektion);
      if (!state.inmatningRedigerar && arSektionTom(sektion)) {
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
