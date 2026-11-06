/**
 * Gravplatsvyn: Inmatningssektionerna: läsvy och formulär.
 * Laddas före gravplatser.js och delar dess globala state.
 */

/** Läsvy: rendera sektionens innehåll som text/layout utan formulärfält. Tomma fält visas inte. */
function renderInmatningSektionLäs(sektion) {
  const d = state.inmatningData || {};
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
    const d = state.inmatningData || {};
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
  const d = state.inmatningData || {};
  const innehall = document.getElementById(`gp-innehall-${sektion}`);
  if (!innehall) return;

  if (!state.inmatningRedigerar) {
    renderInmatningSektionLäs(sektion);
    return;
  }

  if (sektion === 'innehavare') {
    const inv = d.innehavare || [];
    const innehallHarRader = innehall.querySelectorAll('.gp-innehavare-rad').length > 0;
    if (state.inmatningRedigerar && state.inmatningDirty && innehallHarRader) {
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
    if (state.inmatningRedigerar && state.inmatningDirty && innehallHarRader) {
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
      <div class="gp-skissforslag" id="gp-skissforslag" hidden></div>
      <button type="button" class="gp-lagg-till-skiss" id="gp-lagg-till-skiss">+ Lägg till skiss</button>
      <p class="gp-skiss-info" id="gp-lagg-till-skiss-hint">Skisser sparas direkt till gravplatsen när du markerat skissen och klickat på "Spara skiss" - du behöver inte klicka på "Spara" på gravplatsen.</p>`;
    innehall.querySelectorAll('textarea.gp-falt-expanderbar').forEach(autoExpandTextarea);
    const skisser = d.skisser || [];
    const listEl = innehall.querySelector('#gp-skisser-lista');
    const cacheQ = `_v=${state.cacheBust}`;
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
        if (id && state.currentGravplatsId != null) {
          btn.disabled = true;
          try {
            const res = await fetch(`${API}/gravplats/${state.currentGravplatsId}/skisser/${id}`, { method: 'DELETE', credentials: 'include' });
            if (res.ok) {
              state.lastInmatningGravplatsId = null;
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
    if (skisser.length === 0) visaSkissforslag(innehall.querySelector('#gp-skissforslag'));
    return;
  }

  if (sektion === 'gravsatta') {
    const gs = d.gravsatta || [];
    const innehallHarBlock = innehall.querySelectorAll('.gp-gravsatt-block').length > 0;
    if (state.inmatningRedigerar && state.inmatningDirty && innehallHarBlock) {
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
