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
const resultatListaEl = document.getElementById('gp-sok-resultat-lista');
const resultatTomEl = document.getElementById('gp-sok-resultat-tom');
const submitBtn = document.getElementById('gp-sok-submit');

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
    const res = await fetch(API + '/gravplatser/sok?q=' + encodeURIComponent(t) + '&limit=25');
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
  ['gravsatt_fodda_fran', 'gravsatt_fodda_till', 'Födda mellan: ange både Från och Till som ÅÅÅÅ-MM-DD'],
  ['gravsatt_doda_fran', 'gravsatt_doda_till', 'Döda mellan: ange både Från och Till som ÅÅÅÅ-MM-DD'],
  ['gravsatt_gravsatta_fran', 'gravsatt_gravsatta_till', 'Gravsatta mellan: ange både Från och Till som ÅÅÅÅ-MM-DD'],
  ['utfardad_fran', 'utfardad_till', 'Graven utfärdad mellan: ange både Från och Till som ÅÅÅÅ-MM-DD'],
];

/** Avancerad sökning: bygg query från formuläret och visa resultat. */
async function koraAvanceradSok(e) {
  if (e) e.preventDefault();
  if (!formEl || !resultatEl || !resultatListaEl || !resultatTomEl) return;
  const fd = new FormData(formEl);

  for (const [namnFran, namnTill, meddelande] of DATUM_PAR) {
    const fran = (fd.get(namnFran) ?? '').toString().trim();
    const till = (fd.get(namnTill) ?? '').toString().trim();
    if (fran || till) {
      if (!fran || !till) {
        alert(meddelande);
        return;
      }
      if (!arGiltigtDatum(fran) || !arGiltigtDatum(till)) {
        alert('Datum ska anges som ÅÅÅÅ-MM-DD (t.ex. 1800-01-01). Du kan skriva ÅÅÅÅMMDD så läggs bindestreck till.');
        return;
      }
      if (till < fran) {
        alert('Till-datumet får inte vara tidigare än Från-datumet.');
        return;
      }
    }
  }

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

  if (submitBtn) submitBtn.disabled = true;
  resultatEl.hidden = false;
  resultatListaEl.innerHTML = '';
  resultatTomEl.hidden = true;
  if (resultatRubrikEl) resultatRubrikEl.textContent = 'Laddar…';

  try {
    const res = await fetch(API + '/gravplatser/avancerad-sok?' + params.toString());
    const data = await res.json();
    const lista = data.gravplatser || [];
    const antal = data.antal != null ? data.antal : lista.length;
    if (resultatRubrikEl) resultatRubrikEl.textContent = 'Träffar: ' + antal;
    if (lista.length === 0) {
      resultatTomEl.hidden = false;
    } else {
      lista.forEach((gp) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        const full = (gp.fullstandigt || '').trim() || '–';
        a.textContent = full;
        a.href = '/gravplatser/' + slugFromFullstandigt(gp.fullstandigt);
        li.appendChild(a);
        resultatListaEl.appendChild(li);
      });
    }
  } catch (err) {
    if (resultatRubrikEl) resultatRubrikEl.textContent = 'Träffar';
    resultatTomEl.textContent = 'Kunde inte söka: ' + (err.message || 'nätverksfel');
    resultatTomEl.hidden = false;
  }
  if (submitBtn) submitBtn.disabled = false;
}

if (formEl) formEl.addEventListener('submit', koraAvanceradSok);

/** Lazy-förslag för kyrkogård och kvarter */
const kyrkogardInputEl = document.getElementById('gp-sok-kyrkogard');
const kyrkogardListEl = document.getElementById('gp-sok-kyrkogard-list');
const kvarterInputEl = document.getElementById('gp-sok-kvarter');
const kvarterListEl = document.getElementById('gp-sok-kvarter');

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
    const res = await fetch(API + '/gravplatser/forslag/kyrkogardar?q=' + encodeURIComponent(q) + '&limit=30');
    const data = await res.json();
    return data.forslag || [];
  });
}

if (kvarterInputEl && kvarterListEl) {
  setupForslagFalt(kvarterInputEl, kvarterListEl, async (q, extra) => {
    const params = new URLSearchParams({ q, limit: '30' });
    if (extra && extra.kyrkogard) params.set('kyrkogard', extra.kyrkogard);
    const res = await fetch(API + '/gravplatser/forslag/kvarter?' + params.toString());
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
