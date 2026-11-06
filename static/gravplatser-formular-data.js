/**
 * Gravplatsvyn: Gravsatt-blocken och insamlingen av formulärdata.
 * Laddas före gravplatser.js och delar dess globala state.
 */

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
  const d = state.inmatningData || {};
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
  // Vid 0 rader skickar vi tom lista (användaren har tagit bort alla), inte gamla state.inmatningData.

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
  const fardigtranskriberad = state.inmatningData && state.inmatningData.fardigtranskriberad === true;

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
    version: state.inmatningData != null && typeof state.inmatningData.version === 'number' ? state.inmatningData.version : null,
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
