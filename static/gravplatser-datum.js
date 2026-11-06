/**
 * Gravplatsvyn: Datumfält: tolkning, formatering och validering.
 * Laddas före gravplatser.js och delar dess globala state.
 */

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
