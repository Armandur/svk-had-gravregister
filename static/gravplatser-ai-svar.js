/**
 * Gravplatsvyn: Sparade AI-svar: osäkra fält, rimlighetsvarningar, kvittering, diff och förifyllning.
 * Laddas före gravplatser.js och delar dess globala state.
 */

function hamtaSparatClaudeSvar() {
  if (state.currentGravplatsId == null) return;
  const panel = document.getElementById('gp-claude-sparat-panel');
  const gravId = state.currentGravplatsId;
  state.sparatClaudeSvar = null;
  state.sparadeOcrSvar = [];
  if (panel) panel.hidden = true;
  fetch(`${API}/ocr/gravplats/${gravId}/svar-alla`, { credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data || !data.svar || data.svar.length === 0 || gravId !== state.currentGravplatsId) return;
      state.sparadeOcrSvar = data.svar;
      state.sparatClaudeSvar = data.svar[0];
      visaSparatClaudeSvar();
    })
    .catch(function() {});
}

/** Formulärfältet för en sökväg i AI-svaret, t.ex. "gravsatta.0.dods_ar" -> "gs_dods_datum_0". */
function osakertFaltNamn(vag) {
  if (vag === 'utfardat_den') return 'utfordat_den';
  const m = /^gravsatta\.(\d+)\.(\w+)$/.exec(vag);
  if (!m) return null;
  const idx = m[1], falt = m[2];
  if (falt.startsWith('fodelse_')) return 'gs_fodelse_datum_' + idx;
  if (falt.startsWith('dods_')) return 'gs_dods_datum_' + idx;
  const prefix = { fod_nr: 'gs_fod_nr_', dodsbok_nr: 'gs_dodsbok_nr_', gravsatt_den: 'gs_gravsatt_den_' }[falt];
  return prefix ? prefix + idx : null;
}

/** Andrahandsvalet som helt värde: för en datumdel byts bara den delen ut i fältets datum. */
function osakertAlternativ(vag, info, faltVarde) {
  if (!info.kanske) return '';
  const del = /\.(fodelse|dods)_(ar|manad|dag)$/.exec(vag);
  if (!del) return info.kanske;
  const delar = String(faltVarde || '').split('-');
  const i = { ar: 0, manad: 1, dag: 2 }[del[2]];
  if (delar.length <= i) return info.kanske;
  delar[i] = i === 0 ? info.kanske : String(info.kanske).padStart(2, '0');
  return delar.join('-');
}

/**
 * Gul ram på siffror som den lokala modellen var osäker på, med dess andrahandsval.
 * Ett datumfält samlar år, månad och dag, så den minst säkra delen bestämmer.
 */
function visaOsakraFalt(osakra) {
  document.querySelectorAll('.gp-falt-osaker').forEach(function(el) {
    el.classList.remove('gp-falt-osaker');
    if (el.dataset.titelFore !== undefined) { el.title = el.dataset.titelFore; delete el.dataset.titelFore; }
  });
  const banner = document.getElementById('gp-osaker-banner');
  const rader = [];
  const root = document.getElementById('gp-inmatning');
  if (!root) return;
  const perFalt = {};
  Object.entries(osakra || {}).forEach(function([vag, info]) {
    const namn = osakertFaltNamn(vag);
    if (namn && (!perFalt[namn] || info.sakerhet < perFalt[namn].info.sakerhet)) perFalt[namn] = { vag: vag, info: info };
  });
  Object.entries(perFalt).forEach(function([namn, { vag, info }]) {
    const el = root.querySelector('[name="' + namn + '"]');
    if (!el) return;
    const kanske = osakertAlternativ(vag, info, el.value);
    rader.push(osakertFaltEtikett(namn) + ': ' + el.value + ' (' + Math.round(info.sakerhet * 100) + ' % säker)' +
      (kanske && kanske !== el.value ? ', kanske ' + kanske : ''));
    if (el.dataset.titelFore === undefined) el.dataset.titelFore = el.title || '';
    el.classList.add('gp-falt-osaker');
    el.title = 'Modellen var osäker på en siffra här (' + Math.round(info.sakerhet * 100) + ' %).' +
      (kanske && kanske !== el.value ? ' Kanske ' + kanske + '?' : '') + ' Kontrollera mot kortet.';
    el.addEventListener('input', function() {
      el.classList.remove('gp-falt-osaker');
      el.title = el.dataset.titelFore || '';
      delete el.dataset.titelFore;
    }, { once: true });
  });
  if (banner) {
    banner.innerHTML = rader.length
      ? '<strong>Modellen var osäker på de här siffrorna:</strong><ul>' + rader.map(function(r) { return '<li>' + escapeHtml(r) + '</li>'; }).join('') + '</ul>'
      : '';
    banner.hidden = rader.length === 0;
  }
}

/** Läsbar etikett för ett formulärfält, t.ex. "gs_dods_datum_0" -> "Gravsatt 1, dödsdatum". */
function osakertFaltEtikett(namn) {
  if (namn === 'utfordat_den') return 'Utfärdat den';
  const m = /^gs_(.+)_(\d+)$/.exec(namn);
  if (!m) return namn;
  const falt = { fodelse_datum: 'födelsedatum', dods_datum: 'dödsdatum', fod_nr: 'födelsenummer', dodsbok_nr: 'db. nummer', gravsatt_den: 'gravsatt den' }[m[1]] || m[1];
  return 'Gravsatt ' + (parseInt(m[2], 10) + 1) + ', ' + falt;
}

function visaFaltmarkeringar(varningar, osakra) {
  visaRimlighetsvarningar(varningar);
  visaOsakraFalt(osakra);
}

/** Fält som en rimlighetsvarning gäller, som namn på formulärets textfält. */
function rimlighetsFalt(v) {
  const idx = v.gravsatt - 1;
  if (v.falt.startsWith('fodelse')) return ['gs_fodelse_datum_' + idx];
  if (v.falt === 'dods_manad') return ['gs_dods_datum_' + idx, 'gs_gravsatt_den_' + idx];
  return ['gs_dods_datum_' + idx];
}

/**
 * Visa varningar om orimliga datum i AI-svaret, i en ruta och vid fälten.
 * En fältmarkering försvinner när någon ändrar fältet.
 */
function visaRimlighetsvarningar(varningar) {
  document.querySelectorAll('.gp-falt-varning').forEach(function(el) {
    el.classList.remove('gp-falt-varning');
    el.removeAttribute('title');
  });
  state.rimlighetsvarningar = varningar || [];
  const banner = document.getElementById('gp-rimlighet-banner');
  if (!banner) return;
  const lista = state.rimlighetsvarningar;
  if (lista.length === 0) { banner.hidden = true; banner.innerHTML = ''; return; }
  const aktiva = lista.filter(function(v) { return !v.kvitterad; });
  const kanKvittera = state.currentGravplatsId != null && lista.every(function(v) { return v.nyckel; });
  banner.classList.toggle('gp-rimlighet-banner-kvitterad', aktiva.length === 0);
  banner.innerHTML = '<strong>' + (aktiva.length ? 'Kontrollera mot kortet:' : 'Kontrollerat mot kortet:') + '</strong><ul>' +
    lista.map(function(v, i) {
      if (v.kvitterad) {
        const k = v.kvitterad;
        return '<li class="gp-rimlighet-kvitterad">' + escapeHtml(v.meddelande) +
          '<div class="gp-rimlighet-kvitto">Stämmer med kortet' + (k.username ? ' enligt ' + escapeHtml(k.username) : '') +
          (k.kommentar ? ': ' + escapeHtml(k.kommentar) : '') +
          (kanKvittera ? ' <button type="button" class="gp-rimlighet-angra" data-i="' + i + '">Ångra</button>' : '') + '</div></li>';
      }
      return '<li>' + escapeHtml(v.meddelande) +
        (kanKvittera ? ' <button type="button" class="gp-rimlighet-kvittera" data-i="' + i + '">Stämmer med kortet</button>' +
          '<div class="gp-rimlighet-kvittoform" data-i="' + i + '" hidden>' +
          '<input type="text" class="gp-rimlighet-kommentar" maxlength="1000" placeholder="Kommentar (valfri), t.ex. vad kortet säger" aria-label="Kommentar till kvitteringen" />' +
          '<button type="button" class="gp-rimlighet-spara" data-i="' + i + '">Spara</button>' +
          '<button type="button" class="gp-rimlighet-avbryt" data-i="' + i + '">Avbryt</button></div>' : '') +
        '</li>';
    }).join('') + '</ul>';
  banner.hidden = false;
  kopplaKvittering(banner);
  const root = document.getElementById('gp-inmatning');
  aktiva.forEach(function(v) {
    const falt = rimlighetsFalt(v)
      .map(function(namn) { return root && root.querySelector('[name="' + namn + '"]'); })
      .filter(Boolean);
    // Rättar man ett av fälten är varningen hanterad, så markeringen släpps på alla
    const slapp = function() {
      falt.forEach(function(el) { el.classList.remove('gp-falt-varning'); el.removeAttribute('title'); });
    };
    falt.forEach(function(el) {
      el.classList.add('gp-falt-varning');
      el.title = v.meddelande;
      el.addEventListener('input', slapp, { once: true });
    });
  });
}

/** Knapparna i varningsrutan: kvittera att kortet faktiskt säger så, eller ångra. */
function kopplaKvittering(banner) {
  const gpId = state.currentGravplatsId;
  const url = function(v) { return `${API}/gravplats/${gpId}/rimlighet/${encodeURIComponent(v.nyckel)}/kvittera`; };
  const form = function(i) { return banner.querySelector('.gp-rimlighet-kvittoform[data-i="' + i + '"]'); };
  banner.querySelectorAll('.gp-rimlighet-kvittera').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const f = form(btn.dataset.i);
      f.hidden = false;
      btn.hidden = true;
      f.querySelector('input').focus();
    });
  });
  banner.querySelectorAll('.gp-rimlighet-avbryt').forEach(function(btn) {
    btn.addEventListener('click', function() {
      form(btn.dataset.i).hidden = true;
      banner.querySelector('.gp-rimlighet-kvittera[data-i="' + btn.dataset.i + '"]').hidden = false;
    });
  });
  const spara = async function(i) {
    const v = state.rimlighetsvarningar[i];
    const kommentar = form(i).querySelector('input').value.trim();
    try {
      const res = await fetch(url(v), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kommentar: kommentar }) });
      if (!res.ok) throw new Error();
      if (gpId !== state.currentGravplatsId) return;
      v.kvitterad = { kommentar: kommentar, username: state.currentUsername || '', skapad_den: new Date().toISOString() };
      visaRimlighetsvarningar(state.rimlighetsvarningar);
      uppdateraVarningsantal(-1);
    } catch (e) {
      showToast('Kunde inte spara kvitteringen. Försök igen.', 'fel');
    }
  };
  banner.querySelectorAll('.gp-rimlighet-spara').forEach(function(btn) {
    btn.addEventListener('click', function() { spara(btn.dataset.i); });
  });
  banner.querySelectorAll('.gp-rimlighet-kommentar').forEach(function(inp) {
    inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); spara(inp.closest('[data-i]').dataset.i); } });
  });
  banner.querySelectorAll('.gp-rimlighet-angra').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      const v = state.rimlighetsvarningar[btn.dataset.i];
      try {
        const res = await fetch(url(v), { method: 'DELETE', credentials: 'include' });
        if (!res.ok) throw new Error();
        if (gpId !== state.currentGravplatsId) return;
        v.kvitterad = null;
        visaRimlighetsvarningar(state.rimlighetsvarningar);
        uppdateraVarningsantal(1);
      } catch (e) {
        showToast('Kunde inte ångra kvitteringen. Försök igen.', 'fel');
      }
    });
  });
}

/** Håll statusknappens antal varningar i takt med kvitteringar. */
function uppdateraVarningsantal(andring) {
  if (state.inmatningData && typeof state.inmatningData.ai_varningar === 'number') {
    state.inmatningData.ai_varningar = Math.max(0, state.inmatningData.ai_varningar + andring);
  }
  if (state.aiForslag && state.aiForslag.svar) {
    (state.aiForslag.svar.varningar || []).forEach(function(v) {
      const motsv = (state.rimlighetsvarningar || []).find(function(x) { return x.nyckel === v.nyckel; });
      if (motsv) v.kvitterad = motsv.kvitterad;
    });
  }
  uppdateraFardigtranskriberadKnapp();
}

/** Varningar på det som är sparat för graven (inte på ett AI-förslag). */
async function hamtaSparadRimlighet() {
  const gpId = state.currentGravplatsId;
  if (gpId == null || state.aiForslag) return;
  try {
    const res = await fetch(`${API}/gravplats/${gpId}/rimlighet`, { credentials: 'include' });
    if (!res.ok || gpId !== state.currentGravplatsId || state.aiForslag) return;
    visaRimlighetsvarningar((await res.json()).varningar);
  } catch (e) { /* varningarna är en hjälp, vyn fungerar utan dem */ }
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

function visaSparatClaudeSvar() {
  if (!state.inmatningRedigerar) return;
  const panel = document.getElementById('gp-claude-sparat-panel');
  const lista = document.getElementById('gp-ocr-svar-lista');
  const kommentarEl = document.getElementById('gp-claude-sparat-kommentar');
  const svar = state.sparadeOcrSvar || [];
  if (!panel || !lista || svar.length === 0) return;
  lista.innerHTML = svar.map(function(s, i) {
    var datum = s.skapad_den ? new Date(s.skapad_den).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '';
    var kalla = s.kalla === 'lokal' ? 'lokal modell' : 'Claude';
    var modell = s.modell && s.modell !== 'Claude' ? ' (' + escapeHtml(s.modell) + ')' : '';
    return '<div class="gp-ocr-svar-rad">' +
      '<div class="gp-claude-sparat-meta">Sparat svar från ' + kalla + modell + ' – ' +
      escapeHtml(datum) + (s.username ? ' av ' + escapeHtml(s.username) : '') +
      (s.varningar && s.varningar.length ? ' <span class="gp-ocr-svar-varning">' + s.varningar.length + (s.varningar.length === 1 ? ' varning' : ' varningar') + '</span>' : '') + '</div>' +
      '<button type="button" class="gp-claude-applicera-btn gp-ocr-svar-ladda" data-index="' + i + '">Ladda in i formuläret</button>' +
      '</div>';
  }).join('');
  lista.querySelectorAll('.gp-ocr-svar-ladda').forEach(function(btn) {
    btn.addEventListener('click', function() {
      state.sparatClaudeSvar = state.sparadeOcrSvar[parseInt(btn.dataset.index, 10)];
      document.getElementById('gp-claude-applicera-btn')?.click();
    });
  });
  if (kommentarEl) kommentarEl.hidden = true;
  panel.hidden = false;
}

function byggDiff(claudeData) {
  if (!state.inmatningData || !claudeData) return [];
  var andringar = [];

  function jmf(etikett, gammalt, nytt) {
    var g = gammalt == null ? '' : String(gammalt);
    var n = nytt == null ? '' : String(nytt);
    if (g !== n) andringar.push({ etikett: etikett, gammalt: g, nytt: n });
  }

  // Skalarfält
  var skalar = [
    ['Storlek', state.inmatningData.storlek, claudeData.storlek],
    ['Underhåll text', state.inmatningData.underhall_text, claudeData.underhall_text],
    ['Underhåll överstruket', state.inmatningData.underhall_overstruket, claudeData.underhall_overstruket],
    ['Gravrattstid', state.inmatningData.gravrattstid, claudeData.gravrattstid],
    ['Monument', state.inmatningData.monument, claudeData.monument],
    ['Gravens utformning', state.inmatningData.gravens_utformning, claudeData.gravens_utformning],
    ['Karta nr', state.inmatningData.karta_nr, claudeData.karta_nr],
    ['Gravbrev nr', state.inmatningData.gravbrev_nr, claudeData.gravbrev_nr],
    ['Utfärdat den', state.inmatningData.utfordat_den, claudeData.utfardat_den],
    ['Kommentar', state.inmatningData.kommentar, claudeData.kommentar],
  ];
  skalar.forEach(function(r) { jmf(r[0], r[1], r[2]); });

  // Innehavare
  var cInnh = (claudeData.innehavare || []);
  var nInnh = (state.inmatningData.innehavare || []);
  var maxInnh = Math.max(cInnh.length, nInnh.length);
  for (var i = 0; i < maxInnh; i++) {
    var ci = cInnh[i] || {};
    var ni = nInnh[i] || {};
    var prefix = 'Innehavare ' + (i + 1);
    jmf(prefix + ' förnamn', ni.fornamn, ci.fornamn);
    jmf(prefix + ' efternamn', ni.efternamn, ci.efternamn);
    jmf(prefix + ' yrke', ni.yrke, ci.yrke);
    jmf(prefix + ' gatuadress', ni.gatuadress, ci.gatuadress);
    jmf(prefix + ' postnummer', ni.postnummer, ci.postnummer);
    jmf(prefix + ' postort', ni.postort, ci.postort);
  }
  if (cInnh.length !== nInnh.length) {
    andringar.push({ etikett: 'Antal innehavare', gammalt: String(nInnh.length), nytt: String(cInnh.length) });
  }

  // Gravsatta
  var cGs = (claudeData.gravsatta || []);
  var nGs = (state.inmatningData.gravsatta || []);
  var maxGs = Math.max(cGs.length, nGs.length);
  for (var j = 0; j < maxGs; j++) {
    var cg = cGs[j] || {};
    var ng = nGs[j] || {};
    var gPrefix = 'Gravsatt ' + (j + 1);
    jmf(gPrefix + ' förnamn', ng.fornamn, cg.fornamn);
    jmf(gPrefix + ' efternamn', ng.efternamn, cg.efternamn);
    jmf(gPrefix + ' föd.år', ng.fodelse_ar, cg.fodelse_ar);
    jmf(gPrefix + ' föd.mån', ng.fodelse_manad, cg.fodelse_manad);
    jmf(gPrefix + ' föd.dag', ng.fodelse_dag, cg.fodelse_dag);
    jmf(gPrefix + ' föd.nr', ng.fod_nr, cg.fod_nr);
    jmf(gPrefix + ' dödsår', ng.dods_ar, cg.dods_ar);
    jmf(gPrefix + ' döds.mån', ng.dods_manad, cg.dods_manad);
    jmf(gPrefix + ' döds.dag', ng.dods_dag, cg.dods_dag);
    jmf(gPrefix + ' db.nr', ng.dodsbok_nr, cg.dodsbok_nr);
    jmf(gPrefix + ' gravsatt den', ng.gravsatt_den, cg.gravsatt_den);
    jmf(gPrefix + ' urna', ng.urna, cg.urna);
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

/**
 * Fyll i formuläret med data från Claude OCR-svar.
 * Ersätter state.inmatningData och ritar om alla öppna sektioner.
 */
function prefillFranClaude(data) {
  if (!state.inmatningData || !data) return;

  // Mappa Claude-fält till state.inmatningData-format
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

  state.inmatningData = {
    ...state.inmatningData,
    innehavare,
    narmast_anhoriga,
    storlek: data.storlek != null ? String(data.storlek) : (state.inmatningData.storlek || ''),
    underhall_text: data.underhall_text != null ? data.underhall_text : (state.inmatningData.underhall_text || ''),
    underhall_overstruket: data.underhall_overstruket != null ? Boolean(data.underhall_overstruket) : (state.inmatningData.underhall_overstruket || false),
    gravrattstid: data.gravrattstid != null ? data.gravrattstid : (state.inmatningData.gravrattstid || ''),
    monument: data.monument != null ? data.monument : (state.inmatningData.monument || ''),
    gravens_utformning: data.gravens_utformning != null ? data.gravens_utformning : (state.inmatningData.gravens_utformning || ''),
    karta_nr: data.karta_nr != null ? data.karta_nr : (state.inmatningData.karta_nr || ''),
    gravbrev_nr: data.gravbrev_nr != null ? data.gravbrev_nr : (state.inmatningData.gravbrev_nr || ''),
    // Claude använder utfardat_den (med a), backend/frontend utfordat_den (med o)
    utfordat_den: data.utfardat_den != null ? data.utfardat_den : (state.inmatningData.utfordat_den || ''),
    kommentar: data.kommentar != null ? data.kommentar : (state.inmatningData.kommentar || ''),
    gravsatta,
  };

  // Rita om alla sektioner (återställ dirty-flaggan tillfälligt så renderInmatningSektion inte hoppar över)
  state.inmatningDirty = false;
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
