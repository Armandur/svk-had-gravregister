/**
 * Avancerad sökning – snabbsök på fullständigt gravplatsnummer + filterformulär.
 */

const API = '/api';
let sokTimeout = null;
let sokForslag = [];
let aktivIndex = -1;

const inputEl = document.getElementById('gp-sok-input');
const listEl = document.getElementById('gp-sok-list');
const formEl = document.getElementById('gp-sok-form');
const resultatEl = document.getElementById('gp-sok-resultat');
const resultatRubrikEl = document.getElementById('gp-sok-resultat-rubrik');
const resultatTomEl = document.getElementById('gp-sok-resultat-tom');
const resultatTabellHead = document.getElementById('gp-sok-tabell-head');
const resultatTabellBody = document.getElementById('gp-sok-tabell-body');
const pagesizeSelect = document.getElementById('gp-sok-pagesize');
const pagineringText = document.getElementById('gp-sok-paginering-text');
const prevBtn = document.getElementById('gp-sok-prev');
const nextBtn = document.getElementById('gp-sok-next');
const visaAllaCheck = document.getElementById('gp-sok-visa-alla');
const kolumnerBtn = document.getElementById('gp-sok-kolumner-btn');
const kolumnerPopup = document.getElementById('gp-sok-kolumner-popup');
const kolumnerList = document.getElementById('gp-sok-kolumner-list');
const submitBtn = document.getElementById('gp-sok-submit');

const SOK_KOLUMNER = [
  { id: 'fullstandigt', label: 'Gravplats', defaultVisible: true },
  { id: 'antal_innehavare', label: 'Innehavare', defaultVisible: true },
  { id: 'antal_narmast_anhoriga', label: 'Närmast anhöriga', defaultVisible: true },
  { id: 'antal_gravsatta', label: 'Gravsatta', defaultVisible: true },
  { id: 'utfordat_den', label: 'Utfärdad den', defaultVisible: true },
  { id: 'har_extramaterial', label: 'Extramaterial', defaultVisible: true },
  { id: 'antal_extramaterial', label: 'Antal extramaterial', defaultVisible: true },
];

const INNEHAVARE_KOLUMNER = [
  { id: 'fornamn', label: 'Förnamn', defaultVisible: true },
  { id: 'efternamn', label: 'Efternamn', defaultVisible: true },
  { id: 'fullstandigt', label: 'Gravplats', defaultVisible: true },
  { id: 'yrke', label: 'Yrke', defaultVisible: true },
  { id: 'gatuadress', label: 'Gatuadress', defaultVisible: true },
  { id: 'postnummer', label: 'Postnummer', defaultVisible: true },
  { id: 'postort', label: 'Ort', defaultVisible: true },
  { id: 'kommentar', label: 'Kommentar', defaultVisible: true },
];

const ANHORIG_KOLUMNER = [
  { id: 'fornamn', label: 'Förnamn', defaultVisible: true },
  { id: 'efternamn', label: 'Efternamn', defaultVisible: true },
  { id: 'fullstandigt', label: 'Gravplats', defaultVisible: true },
  { id: 'yrke', label: 'Yrke', defaultVisible: true },
  { id: 'adress', label: 'Adress', defaultVisible: true },
  { id: 'postnummer', label: 'Postnummer', defaultVisible: true },
  { id: 'postort', label: 'Ort', defaultVisible: true },
  { id: 'telefon', label: 'Telefon', defaultVisible: true },
  { id: 'kommentar', label: 'Kommentar', defaultVisible: true },
];

const GRAVSATTA_KOLUMNER = [
  { id: 'fornamn', label: 'Förnamn', defaultVisible: true },
  { id: 'efternamn', label: 'Efternamn', defaultVisible: true },
  { id: 'fullstandigt', label: 'Gravplats', defaultVisible: true },
  { id: 'position', label: 'Nr', defaultVisible: true },
  { id: 'yrke', label: 'Yrke', defaultVisible: true },
  { id: 'gatuadress', label: 'Gatuadress', defaultVisible: true },
  { id: 'postnummer', label: 'Postnummer', defaultVisible: true },
  { id: 'postort', label: 'Ort', defaultVisible: true },
  { id: 'fodelse', label: 'Födelse', defaultVisible: true },
  { id: 'dods', label: 'Död', defaultVisible: true },
  { id: 'gravsatt_den', label: 'Gravsatt den', defaultVisible: true },
  { id: 'urna', label: 'Urna/Kista', defaultVisible: true },
  { id: 'kommentar', label: 'Kommentar', defaultVisible: true },
];

function getKolumnerForTyp(typ) {
  switch (typ) {
    case 'innehavare': return INNEHAVARE_KOLUMNER;
    case 'narmast_anhoriga': return ANHORIG_KOLUMNER;
    case 'gravsatta': return GRAVSATTA_KOLUMNER;
    default: return SOK_KOLUMNER;
  }
}

const SOK_KOLUMNER_STORAGE = 'gp-sok-kolumner';
function getKolumnerVisibility() {
  try {
    const s = localStorage.getItem(SOK_KOLUMNER_STORAGE);
    if (s) {
      const o = JSON.parse(s);
      return SOK_KOLUMNER.reduce((acc, col) => {
        acc[col.id] = o[col.id] !== false;
        return acc;
      }, {});
    }
  } catch (_) {}
  return SOK_KOLUMNER.reduce((acc, col) => {
    acc[col.id] = col.defaultVisible !== false;
    return acc;
  }, {});
}
function setKolumnerVisibility(vis) {
  try {
    localStorage.setItem(SOK_KOLUMNER_STORAGE, JSON.stringify(vis));
  } catch (_) {}
}

let sokResultat = [];
let sokResultatTyp = 'gravplatser';
let sokCurrentPage = 1;
let sokKolumnerVisible = getKolumnerVisibility();
let sokSortCol = null;
let sokSortDir = 'asc';

function slugFromFullstandigt(fullstandigt) {
  const s = (fullstandigt || '').trim();
  return s ? encodeURIComponent(s) : '';
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function visaForslag(lista) {
  sokForslag = lista || [];
  aktivIndex = -1;
  if (!listEl) return;
  listEl.innerHTML = '';
  if (sokForslag.length === 0) {
    listEl.hidden = true;
    listEl.setAttribute('aria-expanded', 'false');
    return;
  }
  listEl.hidden = false;
  listEl.setAttribute('aria-expanded', 'true');
  sokForslag.forEach((gp, i) => {
    const li = document.createElement('li');
    li.className = 'gp-sok-item';
    li.role = 'option';
    li.id = 'gp-sok-item-' + i;
    li.setAttribute('data-index', String(i));
    const full = (gp.fullstandigt || '').trim();
    const mapp = gp.mapp_namn ? ' (' + escapeHtml(gp.mapp_namn) + ')' : '';
    li.innerHTML = full ? '<strong>' + escapeHtml(full) + '</strong>' + (mapp ? '<small>' + mapp + '</small>' : '') : '–';
    li.addEventListener('click', () => valjForslag(i));
    listEl.appendChild(li);
  });
}

function valjForslag(index) {
  const gp = sokForslag[index];
  if (!gp || !gp.fullstandigt) return;
  const slug = slugFromFullstandigt(gp.fullstandigt);
  if (slug) window.location.href = '/gravplatser/' + slug;
}

function uppdateraAktivItem() {
  if (!listEl) return;
  listEl.querySelectorAll('.gp-sok-item').forEach((el, i) => {
    el.classList.toggle('gp-sok-item-active', i === aktivIndex);
    el.setAttribute('aria-selected', i === aktivIndex);
  });
  if (aktivIndex >= 0 && sokForslag[aktivIndex]) {
    const itemEl = document.getElementById('gp-sok-item-' + aktivIndex);
    if (itemEl) itemEl.scrollIntoView({ block: 'nearest' });
  }
}

async function hamtaForslag(q) {
  const t = (q || '').trim();
  if (!t) {
    visaForslag([]);
    return;
  }
  try {
    const res = await fetch(API + '/gravplatser/sok?q=' + encodeURIComponent(t) + '&limit=25', { credentials: 'include' });
    const data = await res.json();
    visaForslag(data.gravplatser || []);
  } catch (e) {
    visaForslag([]);
  }
}

function onInput() {
  if (sokTimeout) clearTimeout(sokTimeout);
  sokTimeout = setTimeout(() => hamtaForslag(inputEl ? inputEl.value : ''), 220);
}

function onKeydown(e) {
  if (!listEl || listEl.hidden) {
    if (e.key === 'Escape' && inputEl) inputEl.blur();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    aktivIndex = aktivIndex < sokForslag.length - 1 ? aktivIndex + 1 : 0;
    uppdateraAktivItem();
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    aktivIndex = aktivIndex <= 0 ? sokForslag.length - 1 : aktivIndex - 1;
    uppdateraAktivItem();
    return;
  }
  if (e.key === 'Enter' && aktivIndex >= 0 && sokForslag[aktivIndex]) {
    e.preventDefault();
    valjForslag(aktivIndex);
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    listEl.hidden = true;
    listEl.setAttribute('aria-expanded', 'false');
    aktivIndex = -1;
  }
}

if (inputEl && listEl) {
  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('keydown', onKeydown);
  inputEl.addEventListener('focus', () => {
    if (inputEl.value.trim() && sokForslag.length > 0) {
      listEl.hidden = false;
      listEl.setAttribute('aria-expanded', 'true');
    }
  });
  document.addEventListener('click', (e) => {
    if (!listEl.hidden && e.target !== inputEl && !listEl.contains(e.target)) {
      listEl.hidden = true;
      listEl.setAttribute('aria-expanded', 'false');
    }
  });
}

/** Datumpar som kräver båda fält och giltigt ÅÅÅÅ-MM-DD. */
const DATUM_PAR = [
  ['gravsatt_fodda_fran', 'gravsatt_fodda_till', 'Ange både Från och Till som ÅÅÅÅ-MM-DD'],
  ['gravsatt_doda_fran', 'gravsatt_doda_till', 'Ange både Från och Till som ÅÅÅÅ-MM-DD'],
  ['gravsatt_gravsatta_fran', 'gravsatt_gravsatta_till', 'Ange både Från och Till som ÅÅÅÅ-MM-DD'],
  ['utfardad_fran', 'utfardad_till', 'Ange både Från och Till som ÅÅÅÅ-MM-DD'],
];

const DATUM_FORMAT_MEDDELANDE = 'Ange datum som ÅÅÅÅ-MM-DD (t.ex. 1800-01-01). Du kan skriva ÅÅÅÅMMDD så läggs bindestreck till.';
const DATUM_ORDNING_MEDDELANDE = 'Till-datumet får inte vara tidigare än Från-datumet.';

/** Validerar alla datumpar i formuläret; visar fel i respektive .gp-sok-datum-fel. Returnerar true om allt är ok. focusOnFirst om true sätter fokus på första ogiltiga fält. */
function valideraDatumFaltSok(focusOnFirst = true) {
  if (!formEl) return true;
  const felSpanar = formEl.querySelectorAll('.gp-sok-datum-fel');
  felSpanar.forEach((el) => { el.textContent = ''; el.hidden = true; });
  let firstInvalid = null;
  for (const [namnFran, namnTill, meddelandeBada] of DATUM_PAR) {
    const fran = (formEl.querySelector(`[name="${namnFran}"]`)?.value ?? '').toString().trim();
    const till = (formEl.querySelector(`[name="${namnTill}"]`)?.value ?? '').toString().trim();
    const felEl = formEl.querySelector(`.gp-sok-datum-fel[data-fran="${namnFran}"]`);
    if (!fran && !till) continue;
    if (!fran || !till) {
      if (felEl) { felEl.textContent = meddelandeBada; felEl.hidden = false; }
      if (!firstInvalid) firstInvalid = formEl.querySelector(`[name="${fran ? namnTill : namnFran}"]`);
      continue;
    }
    if (!arGiltigtDatum(fran) || !arGiltigtDatum(till)) {
      if (felEl) { felEl.textContent = DATUM_FORMAT_MEDDELANDE; felEl.hidden = false; }
      if (!firstInvalid) firstInvalid = arGiltigtDatum(fran) ? formEl.querySelector(`[name="${namnTill}"]`) : formEl.querySelector(`[name="${namnFran}"]`);
      continue;
    }
    if (till < fran) {
      if (felEl) { felEl.textContent = DATUM_ORDNING_MEDDELANDE; felEl.hidden = false; }
      if (!firstInvalid) firstInvalid = formEl.querySelector(`[name="${namnTill}"]`);
    }
  }
  const harFel = Array.from(felSpanar).some((el) => el.textContent.trim() !== '');
  if (focusOnFirst && firstInvalid && harFel) firstInvalid.focus();
  return !harFel;
}

/** Avancerad sökning: bygg query från formuläret och visa resultat. */
async function koraAvanceradSok(e) {
  if (e) e.preventDefault();
  if (!formEl || !resultatEl || !resultatTomEl) return;
  const fd = new FormData(formEl);

  if (!valideraDatumFaltSok()) return;

  const params = new URLSearchParams();
  const set = (name, val) => {
    const v = (val ?? '').toString().trim();
    if (v) params.set(name, v);
  };
  const setArFromDatum = (name, datumStr) => {
    const ar = arFranDatumstr((datumStr ?? '').toString());
    if (ar != null) params.set(name, String(ar));
  };
  set('kyrkogard', fd.get('kyrkogard'));
  set('kvarter', fd.get('kvarter'));
  const resultatTyp = (fd.get('resultat_typ') || 'gravplatser').toString().trim();
  params.set('resultat_typ', resultatTyp);
  set('innehavare_fornamn', fd.get('innehavare_fornamn'));
  set('innehavare_efternamn', fd.get('innehavare_efternamn'));
  set('innehavare_yrke', fd.get('innehavare_yrke'));
  set('anhorig_fornamn', fd.get('anhorig_fornamn'));
  set('anhorig_efternamn', fd.get('anhorig_efternamn'));
  set('gravsatt_fornamn', fd.get('gravsatt_fornamn'));
  set('gravsatt_efternamn', fd.get('gravsatt_efternamn'));
  setArFromDatum('gravsatt_fodda_fran', fd.get('gravsatt_fodda_fran'));
  setArFromDatum('gravsatt_fodda_till', fd.get('gravsatt_fodda_till'));
  setArFromDatum('gravsatt_doda_fran', fd.get('gravsatt_doda_fran'));
  setArFromDatum('gravsatt_doda_till', fd.get('gravsatt_doda_till'));
  setArFromDatum('gravsatt_gravsatta_fran', fd.get('gravsatt_gravsatta_fran'));
  setArFromDatum('gravsatt_gravsatta_till', fd.get('gravsatt_gravsatta_till'));
  setArFromDatum('utfardad_fran', fd.get('utfardad_fran'));
  setArFromDatum('utfardad_till', fd.get('utfardad_till'));
  if (fd.get('har_extramaterial') === '1') params.set('har_extramaterial', 'true');
  const transkStatus = (fd.get('transkriberingsstatus') || '').trim();
  if (transkStatus === 'ej' || transkStatus === 'paborjad' || transkStatus === 'fardig') params.set('transkriberingsstatus', transkStatus);
  params.set('limit', '5000');

  const harNagonFiltret = Array.from(params.keys()).some((k) => k !== 'limit');
  if (!harNagonFiltret) {
    alert('Ange minst ett sökvillkor (t.ex. kyrkogård, kvarter, namn eller ett datumintervall) innan du söker.');
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  resultatEl.hidden = false;
  if (resultatTabellHead) resultatTabellHead.innerHTML = '';
  if (resultatTabellBody) resultatTabellBody.innerHTML = '';
  resultatTomEl.hidden = true;
  if (resultatRubrikEl) resultatRubrikEl.textContent = 'Laddar…';

  try {
    const res = await fetch(API + '/gravplatser/avancerad-sok?' + params.toString(), { credentials: 'include' });
    const data = await res.json();
    const typ = data.resultat_typ || 'gravplatser';
    sokResultatTyp = typ;
    sokResultat = data.gravplatser || data.innehavare || data.narmast_anhoriga || data.gravsatta || [];
    const antal = sokResultat.length;
    if (resultatRubrikEl) resultatRubrikEl.textContent = 'Träffar: ' + antal;
    if (sokResultat.length === 0) {
      resultatTomEl.hidden = false;
      resultatTomEl.textContent = sokResultatTyp === 'gravplatser'
        ? 'Inga gravplatser matchade filtren.'
        : 'Inga träffar.';
      uppdateraPaginering();
    } else {
      resultatTomEl.hidden = true;
      sokCurrentPage = 1;
      if (visaAllaCheck) visaAllaCheck.checked = false;
      renderResultatTabell();
      uppdateraPaginering();
    }
    if (kolumnerBtn) kolumnerBtn.style.display = sokResultatTyp === 'gravplatser' ? '' : 'none';
  } catch (err) {
    if (resultatRubrikEl) resultatRubrikEl.textContent = 'Träffar';
    resultatTomEl.textContent = 'Kunde inte söka: ' + (err.message || 'nätverksfel');
    resultatTomEl.hidden = false;
  }
  if (submitBtn) submitBtn.disabled = false;
}

function getSortValue(row, colId, typ) {
  if (typ !== 'gravplatser') {
    if (colId === 'fullstandigt') return (row.fullstandigt || '').trim() || '';
    if (colId === 'fodelse') return formatDatumArManadDag(row.fodelse_ar, row.fodelse_manad, row.fodelse_dag);
    if (colId === 'dods') return formatDatumArManadDag(row.dods_ar, row.dods_manad, row.dods_dag);
    if (colId === 'position') return row.position != null ? Number(row.position) : 0;
    const v = row[colId];
    if (typeof v === 'number') return v;
    return (v != null ? String(v) : '').trim();
  }
  const gp = row;
  switch (colId) {
    case 'fullstandigt':
      return (gp.fullstandigt || '').trim() || '';
    case 'antal_innehavare':
      return gp.antal_innehavare != null ? Number(gp.antal_innehavare) : 0;
    case 'antal_narmast_anhoriga':
      return gp.antal_narmast_anhoriga != null ? Number(gp.antal_narmast_anhoriga) : 0;
    case 'antal_gravsatta':
      return gp.antal_gravsatta != null ? Number(gp.antal_gravsatta) : 0;
    case 'utfordat_den':
      return (gp.utfordat_den || '').trim() || '';
    case 'har_extramaterial':
      return gp.har_extramaterial ? 1 : 0;
    case 'antal_extramaterial':
      return gp.antal_extramaterial != null ? Number(gp.antal_extramaterial) : 0;
    default:
      return gp[colId] != null ? gp[colId] : '';
  }
}

function formatDatumArManadDag(ar, manad, dag) {
  if (ar == null && manad == null && dag == null) return '';
  const a = ar != null ? String(ar) : '';
  const m = manad != null ? String(manad).padStart(2, '0') : '';
  const d = dag != null ? String(dag).padStart(2, '0') : '';
  if (a && m && d) return `${a}-${m}-${d}`;
  if (a) return a;
  return '';
}

/** Visningsformat för Utfärdat den: YYYY-00-00 → YYYY, YYYY-MM-00 → YYYY-MM (samma som gravsatta-datum). */
function formatUtfordatDenForDisplay(s) {
  if (s == null || typeof s !== 'string') return '';
  const t = s.trim();
  if (!t) return '';
  if (/^(\d{4})-00-00$/.test(t)) return t.slice(0, 4);
  const m = /^(\d{4})-(\d{1,2})-00$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  return t;
}

function cellValue(row, colId, typ) {
  if (typ !== 'gravplatser') {
    if (colId === 'fullstandigt') return (row.fullstandigt || '').trim() || '–';
    if (colId === 'fodelse') {
      const s = formatDatumArManadDag(row.fodelse_ar, row.fodelse_manad, row.fodelse_dag);
      return s || '–';
    }
    if (colId === 'dods') {
      const s = formatDatumArManadDag(row.dods_ar, row.dods_manad, row.dods_dag);
      return s || '–';
    }
    const v = row[colId];
    return v != null && v !== '' ? String(v) : '–';
  }
  const gp = row;
  switch (colId) {
    case 'fullstandigt':
      return (gp.fullstandigt || '').trim() || '–';
    case 'antal_innehavare':
      return gp.antal_innehavare != null ? String(gp.antal_innehavare) : '0';
    case 'antal_narmast_anhoriga':
      return gp.antal_narmast_anhoriga != null ? String(gp.antal_narmast_anhoriga) : '0';
    case 'antal_gravsatta':
      return gp.antal_gravsatta != null ? String(gp.antal_gravsatta) : '0';
    case 'utfordat_den':
      return formatUtfordatDenForDisplay((gp.utfordat_den || '').trim()) || '–';
    case 'har_extramaterial':
      return gp.har_extramaterial ? 'Ja' : 'Nej';
    case 'antal_extramaterial':
      return gp.antal_extramaterial != null ? String(gp.antal_extramaterial) : '0';
    default:
      return gp[colId] != null ? String(gp[colId]) : '';
  }
}

function renderResultatTabell() {
  if (!resultatTabellHead || !resultatTabellBody) return;
  const allCols = getKolumnerForTyp(sokResultatTyp);
  const cols = sokResultatTyp === 'gravplatser'
    ? allCols.filter((c) => sokKolumnerVisible[c.id])
    : allCols;
  if (sokSortCol && !cols.some((c) => c.id === sokSortCol)) sokSortCol = null;
  resultatTabellHead.innerHTML = '';
  resultatTabellBody.innerHTML = '';

  const trHead = document.createElement('tr');
  cols.forEach((c) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.setAttribute('role', 'columnheader');
    const isSorted = sokSortCol === c.id;
    th.setAttribute('aria-sort', isSorted ? (sokSortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gp-sok-th-sort';
    btn.textContent = c.label + (isSorted ? (sokSortDir === 'asc' ? ' ↑' : ' ↓') : '');
    btn.title = isSorted ? (sokSortDir === 'asc' ? 'Sortera fallande (klicka igen)' : 'Sortera stigande (klicka igen)') : 'Sortera på denna kolumn';
    btn.addEventListener('click', () => {
      if (sokSortCol === c.id) sokSortDir = sokSortDir === 'asc' ? 'desc' : 'asc';
      else { sokSortCol = c.id; sokSortDir = 'asc'; }
      renderResultatTabell();
    });
    th.appendChild(btn);
    trHead.appendChild(th);
  });
  resultatTabellHead.appendChild(trHead);

  const sorted = sokSortCol
    ? [...sokResultat].sort((a, b) => {
        const va = getSortValue(a, sokSortCol, sokResultatTyp);
        const vb = getSortValue(b, sokSortCol, sokResultatTyp);
        const isNum = typeof va === 'number' && typeof vb === 'number';
        if (isNum) return sokSortDir === 'asc' ? va - vb : vb - va;
        const sa = String(va);
        const sb = String(vb);
        const cmp = sa.localeCompare(sb, 'sv');
        return sokSortDir === 'asc' ? cmp : -cmp;
      })
    : sokResultat;

  const visaAlla = visaAllaCheck && visaAllaCheck.checked;
  const pageSizeVal = pagesizeSelect ? pagesizeSelect.value : '25';
  const perPage = visaAlla || pageSizeVal === 'alla' ? sorted.length : Math.max(1, parseInt(pageSizeVal, 10) || 25);
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const page = Math.min(sokCurrentPage, totalPages);
  const start = (page - 1) * perPage;
  const slice = sorted.slice(start, start + perPage);

  slice.forEach((row) => {
    const tr = document.createElement('tr');
    cols.forEach((c) => {
      const td = document.createElement('td');
      if (c.id === 'fullstandigt') {
        const a = document.createElement('a');
        a.href = '/gravplatser/' + slugFromFullstandigt(row.fullstandigt);
        a.textContent = cellValue(row, c.id, sokResultatTyp);
        td.appendChild(a);
      } else {
        td.textContent = cellValue(row, c.id, sokResultatTyp);
      }
      tr.appendChild(td);
    });
    resultatTabellBody.appendChild(tr);
  });
}

function uppdateraPaginering() {
  const visaAlla = visaAllaCheck && visaAllaCheck.checked;
  const pageSizeVal = pagesizeSelect ? pagesizeSelect.value : '25';
  const perPage = visaAlla || pageSizeVal === 'alla' ? sokResultat.length : Math.max(1, parseInt(pageSizeVal, 10) || 25);
  const totalPages = Math.max(1, Math.ceil(sokResultat.length / perPage));
  const page = Math.min(sokCurrentPage, totalPages);
  sokCurrentPage = page;
  const start = (page - 1) * perPage;
  const end = Math.min(start + perPage, sokResultat.length);

  if (pagineringText) {
    if (sokResultat.length === 0) pagineringText.textContent = '';
    else if (visaAlla || pageSizeVal === 'alla') pagineringText.textContent = `Visar alla ${sokResultat.length} träffar`;
    else pagineringText.textContent = `Visar ${start + 1}–${end} av ${sokResultat.length}`;
  }
  if (prevBtn) prevBtn.disabled = page <= 1 || sokResultat.length === 0;
  if (nextBtn) nextBtn.disabled = page >= totalPages || sokResultat.length === 0;
}

if (formEl) formEl.addEventListener('submit', koraAvanceradSok);
// Direkt fältvalidering för datum vid blur (uppdaterar bara meddelanden, flyttar inte fokus)
if (formEl) {
  const datumNamn = new Set(DATUM_PAR.flatMap(([a, b]) => [a, b]));
  formEl.querySelectorAll('input.gp-sok-datum').forEach((input) => {
    if (datumNamn.has(input.name)) input.addEventListener('blur', () => valideraDatumFaltSok(false));
  });
}

function byggKolumnerPopup() {
  if (!kolumnerList) return;
  kolumnerList.innerHTML = '';
  SOK_KOLUMNER.forEach((col) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = sokKolumnerVisible[col.id] !== false;
    cb.dataset.colId = col.id;
    cb.addEventListener('change', () => {
      sokKolumnerVisible[col.id] = cb.checked;
      setKolumnerVisibility(sokKolumnerVisible);
      renderResultatTabell();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(col.label));
    kolumnerList.appendChild(label);
  });
}

if (kolumnerBtn && kolumnerPopup) {
  kolumnerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !kolumnerPopup.hidden;
    kolumnerPopup.hidden = !open;
    kolumnerBtn.setAttribute('aria-expanded', !open);
    if (!open) byggKolumnerPopup();
  });
  document.addEventListener('click', () => {
    kolumnerPopup.hidden = true;
    if (kolumnerBtn) kolumnerBtn.setAttribute('aria-expanded', 'false');
  });
  kolumnerPopup.addEventListener('click', (e) => e.stopPropagation());
}

if (pagesizeSelect) {
  pagesizeSelect.addEventListener('change', () => {
    sokCurrentPage = 1;
    renderResultatTabell();
    uppdateraPaginering();
  });
}
if (prevBtn) prevBtn.addEventListener('click', () => { sokCurrentPage--; renderResultatTabell(); uppdateraPaginering(); });
if (nextBtn) nextBtn.addEventListener('click', () => { sokCurrentPage++; renderResultatTabell(); uppdateraPaginering(); });
if (visaAllaCheck) {
  visaAllaCheck.addEventListener('change', () => {
    sokCurrentPage = 1;
    renderResultatTabell();
    uppdateraPaginering();
  });
}

/** Lazy-förslag för kyrkogård och kvarter */
const kyrkogardInputEl = document.getElementById('gp-sok-kyrkogard');
const kyrkogardListEl = document.getElementById('gp-sok-kyrkogard-list');
const kvarterInputEl = document.getElementById('gp-sok-kvarter');
const kvarterListEl = document.getElementById('gp-sok-kvarter-list');

function setupForslagFalt(inputEl, listEl, fetchForslag, getExtraParams) {
  if (!inputEl || !listEl) return;
  let timeout = null;
  let forslag = [];
  let aktivIndex = -1;

  function visa(lista) {
    forslag = lista || [];
    aktivIndex = -1;
    listEl.innerHTML = '';
    if (forslag.length === 0) {
      listEl.hidden = true;
      listEl.setAttribute('aria-expanded', 'false');
      return;
    }
    listEl.hidden = false;
    listEl.setAttribute('aria-expanded', 'true');
    forslag.forEach((v, i) => {
      const li = document.createElement('li');
      li.className = 'gp-sok-item';
      li.role = 'option';
      li.setAttribute('data-value', v);
      li.textContent = v;
      li.addEventListener('click', () => {
        inputEl.value = v;
        listEl.hidden = true;
        listEl.setAttribute('aria-expanded', 'false');
      });
      listEl.appendChild(li);
    });
  }

  function uppdateraAktiv() {
    const items = listEl.querySelectorAll('.gp-sok-item');
    items.forEach((el, i) => {
      el.classList.toggle('gp-sok-item-active', i === aktivIndex);
      el.setAttribute('aria-selected', i === aktivIndex);
    });
    if (aktivIndex >= 0 && items[aktivIndex]) {
      items[aktivIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  function onInput() {
    if (timeout) clearTimeout(timeout);
    const q = (inputEl.value || '').trim();
    if (!q) {
      visa([]);
      return;
    }
    timeout = setTimeout(async () => {
      try {
        const extra = getExtraParams ? getExtraParams() : {};
        const lista = await fetchForslag(q, extra);
        visa(lista || []);
      } catch (e) {
        visa([]);
      }
    }, 220);
  }

  function onKeydown(e) {
    if (listEl.hidden) {
      if (e.key === 'Escape') inputEl.blur();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      aktivIndex = aktivIndex < forslag.length - 1 ? aktivIndex + 1 : 0;
      uppdateraAktiv();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      aktivIndex = aktivIndex <= 0 ? forslag.length - 1 : aktivIndex - 1;
      uppdateraAktiv();
      return;
    }
    if (e.key === 'Enter' && aktivIndex >= 0 && forslag[aktivIndex]) {
      e.preventDefault();
      inputEl.value = forslag[aktivIndex];
      listEl.hidden = true;
      listEl.setAttribute('aria-expanded', 'false');
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      listEl.hidden = true;
      listEl.setAttribute('aria-expanded', 'false');
    }
  }

  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('focus', () => {
    const q = (inputEl.value || '').trim();
    if (q && forslag.length > 0) {
      listEl.hidden = false;
      listEl.setAttribute('aria-expanded', 'true');
    }
  });
  inputEl.addEventListener('keydown', onKeydown);
}

/** En gemensam klick-lyssnare: stäng endast förslagslistor när klick sker utanför respektive input och lista. */
function sokForslagStangVidKlickUtanfor(e) {
  const target = e.target && e.target.nodeType === 1 ? e.target : null;
  if (!target) return;
  if (kyrkogardListEl && !kyrkogardListEl.hidden) {
    if (target !== kyrkogardInputEl && !kyrkogardListEl.contains(target)) {
      kyrkogardListEl.hidden = true;
      kyrkogardListEl.setAttribute('aria-expanded', 'false');
    }
  }
  if (kvarterListEl && !kvarterListEl.hidden) {
    if (target !== kvarterInputEl && !kvarterListEl.contains(target)) {
      kvarterListEl.hidden = true;
      kvarterListEl.setAttribute('aria-expanded', 'false');
    }
  }
}

if (kyrkogardInputEl && kyrkogardListEl) {
  setupForslagFalt(kyrkogardInputEl, kyrkogardListEl, async (q) => {
    const res = await fetch(API + '/gravplatser/forslag/kyrkogardar?q=' + encodeURIComponent(q) + '&limit=30', { credentials: 'include' });
    const data = await res.json();
    return data.forslag || [];
  });
}

if (kvarterInputEl && kvarterListEl) {
  setupForslagFalt(kvarterInputEl, kvarterListEl, async (q, extra) => {
    const params = new URLSearchParams({ q, limit: '30' });
    if (extra && extra.kyrkogard) params.set('kyrkogard', extra.kyrkogard);
    const res = await fetch(API + '/gravplatser/forslag/kvarter?' + params.toString(), { credentials: 'include' });
    const data = await res.json();
    return data.forslag || [];
  }, () => ({ kyrkogard: kyrkogardInputEl ? kyrkogardInputEl.value.trim() : '' }));
}

if (kyrkogardListEl || kvarterListEl) {
  document.addEventListener('click', sokForslagStangVidKlickUtanfor);
}

/** Formatera YYYYMMDD till YYYY-MM-DD vid inmatning. */
function formateraDatumInput(el) {
  if (!el || !el.value) return;
  const endastSiffror = el.value.replace(/\D/g, '');
  if (endastSiffror.length >= 8) {
    const y = endastSiffror.slice(0, 4);
    const m = endastSiffror.slice(4, 6);
    const d = endastSiffror.slice(6, 8);
    el.value = y + '-' + m + '-' + d;
  }
}

document.querySelectorAll('.gp-sok-datum').forEach((el) => {
  el.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '');
    if (v.length > 8) v = v.slice(0, 8);
    if (v.length <= 4) {
      this.value = v;
    } else if (v.length <= 6) {
      this.value = v.slice(0, 4) + '-' + v.slice(4);
    } else {
      this.value = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
    }
  });
  el.addEventListener('blur', function () { formateraDatumInput(this); });
});

/** Returnerar true om s är giltigt datum ÅÅÅÅ-MM-DD. */
function arGiltigtDatum(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  const [y, m, d] = t.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Hämtar årtal från datumsträng ÅÅÅÅ-MM-DD (för API). */
function arFranDatumstr(s) {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim();
  const m = t.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}
