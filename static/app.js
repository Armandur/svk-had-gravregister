/**
 * Gravregister PoC – välj mapp, visa 3 PDF-sidor per gravplats.
 */

const API = '/api';

let mappar = [];
let valdMapp = null;
let filer = [];
let startSida = 1; // 1-baserat: första innehållssidan för aktuell gravplats
/** Filnamn för de tre rutorna (uppdateras i uppdateraPdfBilder) – används av menyn "Klipp ut". */
let currentFilnamn1 = '', currentFilnamn2 = '', currentFilnamn3 = '';
/** Post för varje ruta: antingen { t: 'f', v: filnamn } eller { t: 'b', id: number } – för menyval. */
let currentItem1 = null, currentItem2 = null, currentItem3 = null;
/** Urklipp: filnamn som användaren "klippt ut" för att infoga som extramaterial på gravplats eller mapp. */
let urklipp = [];
/** Ökas vid extramaterial-ändring så att bild-URL:er får ny query och cache ogiltigförklaras. */
let cacheBust = 0;
/** Startposition för serie gravplatsnummer (1-baserat start_sida), null om ej satt. */
let seriesStartSida = null;

async function laddaMappar() {
  const select = document.getElementById('mapp');
  select.disabled = true;
  select.innerHTML = '<option value="">– laddar mappar –</option>';
  document.getElementById('mapp-status').textContent = '';

  try {
    const res = await fetch(`${API}/mappar`);
    const data = await res.json();
    mappar = data.mappar || [];
    select.innerHTML = '<option value="">– välj mapp –</option>';
    mappar.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    });
    select.disabled = false;
    if (mappar.length === 0) {
      document.getElementById('mapp-status').textContent = 'Inga mappar hittades under källdata. Lägg dina PDF-mappar i källdata/.';
    }
  } catch (e) {
    select.disabled = false;
    document.getElementById('mapp-status').textContent = 'Kunde inte ladda mappar: ' + e.message;
  }
}

async function valjMapp(mappNamn) {
  if (!mappNamn) {
    valdMapp = null;
    filer = [];
    seriesStartSida = null;
    document.getElementById('visning').hidden = true;
    return;
  }
  valdMapp = mappNamn;
  seriesStartSida = null;

  try {
    const [filerRes, configRes, gravplatsRes] = await Promise.all([
      fetch(`${API}/mappar/${encodeURIComponent(mappNamn)}/filer?${Date.now()}`),
      fetch(`${API}/mappar/${encodeURIComponent(mappNamn)}/config`),
      fetch(`${API}/mappar/${encodeURIComponent(mappNamn)}/gravplats`),
    ]);
    const data = await filerRes.json();
    const raw = data.effective_filer || data.filer || [];
    filer = raw.map((item) => (typeof item === 'string' ? { t: 'f', v: item } : item));
    if (data.extramaterial && data.extramaterial.length > 0) {
      window.extramaterial = data.extramaterial;
    } else {
      window.extramaterial = [];
    }
    const configData = await configRes.json();
    window.mappForsettAntal = configData.forsett_antal ?? 0;
    const kyrkogardEl = document.getElementById('kyrkogard');
    const gravkvarterEl = document.getElementById('gravkvarter');
    if (kyrkogardEl) kyrkogardEl.value = configData.kyrkogard || '';
    if (gravkvarterEl) gravkvarterEl.value = configData.gravkvarter || '';
    const gravplatsData = await gravplatsRes.json();
    window.gravplatser = gravplatsData.gravplatser || [];

    const innehållsSidor = filer.length;
    let status = filer.length + ' innehållssidor';
    if (window.extramaterial.length > 0) {
      status += ' (' + window.extramaterial.length + ' extramaterial exkluderat)';
    }
    status += '.';
    document.getElementById('mapp-status').textContent = status;

    ogiltigförklaraBildcache(); // alltid färska bilder vid mappval (t.ex. efter databasåterställning)

    if (innehållsSidor >= 3) {
      document.getElementById('visning').hidden = false;
      startSida = 1;
      uppdateraPdfBilder();
    } else {
      document.getElementById('visning').hidden = true;
      document.getElementById('mapp-status').textContent += ' Behöver minst 3 innehållssidor för att visa en gravplats.';
    }
  } catch (e) {
    document.getElementById('mapp-status').textContent = 'Kunde inte ladda filer: ' + e.message;
    document.getElementById('visning').hidden = true;
  }
}

/** Lista som ska visas i flödet: filer minus de som ligger i urklipp (ännu inte infogade). Varje post är { t, v } eller { t, id }. */
function getEffectiveFiler() {
  if (!filer.length) return [];
  if (!urklipp.length) return filer;
  return filer.filter((item) => item.t !== 'f' || !urklipp.includes(item.v));
}

function antalInnehållsSidor() {
  return Math.max(0, getEffectiveFiler().length);
}

/** Alla start_sida för gravplatsblock (1, 3, 5, … upp till sista blocket). */
function allaGravplatsStartSidor() {
  const max = antalInnehållsSidor();
  const out = [];
  for (let s = 1; s + 2 <= max; s += 2) out.push(s);
  return out;
}

/** Räknar hur många gravplatser som saknar respektive fält. Returnerar { kyrkogard, kvarter, gravplatsnummer }. */
function antalSaknarPerFalt() {
  const gravplatser = window.gravplatser || [];
  const alla = allaGravplatsStartSidor();
  let kyrkogard = 0, kvarter = 0, gravplatsnummer = 0;
  for (const s of alla) {
    const g = gravplatser.find((x) => x.start_sida === s);
    if (!g || !String(g.kyrkogard || '').trim()) kyrkogard++;
    if (!g || !String(g.kvarter || '').trim()) kvarter++;
    if (!g || !String(g.gravplatsnummer || '').trim()) gravplatsnummer++;
  }
  return { kyrkogard, kvarter, gravplatsnummer };
}

function uppdateraSaknadAntal() {
  const { kyrkogard, kvarter, gravplatsnummer } = antalSaknarPerFalt();
  const elK = document.getElementById('saknar-kyrkogard-count');
  const elKv = document.getElementById('saknar-kvarter-count');
  const elG = document.getElementById('saknar-gravplatsnummer-count');
  if (elK) elK.textContent = '(' + kyrkogard + ')';
  if (elKv) elKv.textContent = '(' + kvarter + ')';
  if (elG) elG.textContent = '(' + gravplatsnummer + ')';
}

/** Returnerar true om gravplatsen (g eller undefined) saknar minst ett av de valda fälten. */
function gravplatsSaknarValt(g, saknarKyrkogard, saknarKvarter, saknarGravplatsnummer) {
  const saknarK = saknarKyrkogard && (!g || !String(g.kyrkogard || '').trim());
  const saknarKv = saknarKvarter && (!g || !String(g.kvarter || '').trim());
  const saknarG = saknarGravplatsnummer && (!g || !String(g.gravplatsnummer || '').trim());
  return saknarK || saknarKv || saknarG;
}

function visaHoppaSaknadTooltip(text) {
  const el = document.getElementById('hoppa-saknad-tooltip');
  if (!el) return;
  el.textContent = text;
  el.classList.add('visibel');
  clearTimeout(visaHoppaSaknadTooltip._tid);
  visaHoppaSaknadTooltip._tid = setTimeout(() => {
    el.classList.remove('visibel');
  }, 3500);
}

function hoppaTillNastaSaknad() {
  const saknarKyrkogard = document.getElementById('saknar-kyrkogard')?.checked ?? false;
  const saknarKvarter = document.getElementById('saknar-kvarter')?.checked ?? false;
  const saknarGravplatsnummer = document.getElementById('saknar-gravplatsnummer')?.checked ?? false;
  if (!saknarKyrkogard && !saknarKvarter && !saknarGravplatsnummer) {
    visaHoppaSaknadTooltip('Välj minst ett fält (kyrkogård, kvarter eller gravplatsnr).');
    return;
  }
  const gravplatser = window.gravplatser || [];
  const alla = allaGravplatsStartSidor();
  const nasta = alla.find((s) => s > startSida && gravplatsSaknarValt(
    gravplatser.find((x) => x.start_sida === s),
    saknarKyrkogard,
    saknarKvarter,
    saknarGravplatsnummer,
  ));
  if (nasta != null) {
    startSida = nasta;
    uppdateraPdfBilder();
  } else {
    visaHoppaSaknadTooltip('Ingen gravplats hittades som saknar valt fält.');
  }
}

function hoppaTillFöregåendeSaknad() {
  const saknarKyrkogard = document.getElementById('saknar-kyrkogard')?.checked ?? false;
  const saknarKvarter = document.getElementById('saknar-kvarter')?.checked ?? false;
  const saknarGravplatsnummer = document.getElementById('saknar-gravplatsnummer')?.checked ?? false;
  if (!saknarKyrkogard && !saknarKvarter && !saknarGravplatsnummer) {
    visaHoppaSaknadTooltip('Välj minst ett fält (kyrkogård, kvarter eller gravplatsnr).');
    return;
  }
  const gravplatser = window.gravplatser || [];
  const alla = allaGravplatsStartSidor();
  const foregaende = [...alla].reverse().find((s) => s < startSida && gravplatsSaknarValt(
    gravplatser.find((x) => x.start_sida === s),
    saknarKyrkogard,
    saknarKvarter,
    saknarGravplatsnummer,
  ));
  if (foregaende != null) {
    startSida = foregaende;
    uppdateraPdfBilder();
  } else {
    visaHoppaSaknadTooltip('Ingen gravplats hittades som saknar valt fält.');
  }
}

/** 1-baserat sidnummer i den fullständiga PDF-listan för denna gravplats första sida – för visning i extramaterial-rubriken. */
function getDisplayStartSida() {
  const effectiveFiler = getEffectiveFiler();
  const first = effectiveFiler[startSida - 1];
  if (!first || !filer.length) return startSida;
  if (first.t === 'b') return startSida;
  const baseFiler = effectiveFiler.filter((x) => x.t === 'f').map((x) => x.v);
  const idx = baseFiler.indexOf(first.v);
  return idx >= 0 ? idx + 1 : startSida;
}

function uppdateraPdfBilder() {
  const effectiveFiler = getEffectiveFiler();
  const excludeQ = urklipp.length ? '&exclude=' + encodeURIComponent(urklipp.join(',')) : '';

  const s1 = startSida;
  const s2 = startSida + 1;
  const s3 = startSida + 2;
  const pdfBase = `${API}/mappar/${encodeURIComponent(valdMapp)}/pdf`;
  const offsetQ = 'offset=0';
  const cacheQ = `_v=${cacheBust}`;
  const sidaBase = `${API}/mappar/${encodeURIComponent(valdMapp)}/sida`;
  const visaHelaSidor = document.getElementById('visa-hela-sidor')?.checked === true;

  let url1, url2, url3;
  if (visaHelaSidor) {
    url1 = `${sidaBase}/${s1}?${offsetQ}&${cacheQ}${excludeQ}`;
    url2 = `${sidaBase}/${s2}?${offsetQ}&${cacheQ}${excludeQ}`;
    url3 = `${sidaBase}/${s3}?${offsetQ}&${cacheQ}${excludeQ}`;
  } else {
    const splitSida1och3 = (727 / 1597).toFixed(4);
    const splitSida2 = (870 / 1595).toFixed(4);
    url1 = `${sidaBase}/${s1}/halva?${offsetQ}&halva=nedre&split=${splitSida1och3}&${cacheQ}${excludeQ}`;
    url2 = `${sidaBase}/${s2}/halva?${offsetQ}&halva=nedre&split=${splitSida2}&${cacheQ}${excludeQ}`;
    url3 = `${sidaBase}/${s3}/halva?${offsetQ}&halva=ovre&split=${splitSida1och3}&${cacheQ}${excludeQ}`;
  }

  // Horisontell vy: samma tre bilder
  document.getElementById('img-sida-1').src = url1;
  document.getElementById('img-sida-2').src = url2;
  document.getElementById('img-sida-3').src = url3;

  const idx1 = startSida - 1;
  const idx2 = startSida;
  const idx3 = startSida + 1;
  const item1 = effectiveFiler[idx1] || null;
  const item2 = effectiveFiler[idx2] || null;
  const item3 = effectiveFiler[idx3] || null;
  currentItem1 = item1;
  currentItem2 = item2;
  currentItem3 = item3;
  const label = (item) => (!item ? '–' : item.t === 'f' ? item.v : 'Tom sida');
  const pdfHref = (item, sid) => (item && item.t === 'f' ? `${pdfBase}/${sid}?${offsetQ}${excludeQ}` : '#');
  currentFilnamn1 = label(item1);
  currentFilnamn2 = label(item2);
  currentFilnamn3 = label(item3);
  document.getElementById('filnamn-sida-1').textContent = label(item1);
  document.getElementById('filnamn-sida-2').textContent = label(item2);
  document.getElementById('filnamn-sida-3').textContent = label(item3);
  document.getElementById('link-sida-1').href = pdfHref(item1, s1);
  document.getElementById('link-sida-2').href = pdfHref(item2, s2);
  document.getElementById('link-sida-3').href = pdfHref(item3, s3);

  const maxSida = antalInnehållsSidor();
  document.getElementById('btn-föregående').disabled = startSida <= 1;
  document.getElementById('btn-nästa').disabled = s3 > maxSida;

  const registreratEl = document.getElementById('gravplats-registrerat');
  const g = (window.gravplatser || []).find((x) => x.start_sida === startSida);
  if (registreratEl) {
    registreratEl.textContent = g && g.fullstandigt ? 'Registrerat: ' + g.fullstandigt : '';
  }
  const cb3 = document.getElementById('sida3-ovre-nasta');
  if (cb3) cb3.checked = !!(g && g.sida3_ovre_tillhor_nasta);
  const gravplatsnummerEl = document.getElementById('gravplatsnummer');
  const gravkvarterEl = document.getElementById('gravkvarter');
  if (gravplatsnummerEl) gravplatsnummerEl.value = g ? (g.gravplatsnummer || '') : '';
  if (gravkvarterEl && g && g.kvarter && String(g.kvarter).trim()) gravkvarterEl.value = g.kvarter.trim();

  // Vertikal vy: samma tre bilder
  document.getElementById('halva-img-1').src = url1;
  document.getElementById('halva-img-2').src = url2;
  document.getElementById('halva-img-3').src = url3;
  document.getElementById('halva-filnamn-1').textContent = label(item1);
  document.getElementById('halva-filnamn-2').textContent = label(item2);
  document.getElementById('halva-filnamn-3').textContent = label(item3);
  document.getElementById('halva-link-1').href = pdfHref(item1, s1);
  document.getElementById('halva-link-2').href = pdfHref(item2, s2);
  document.getElementById('halva-link-3').href = pdfHref(item3, s3);

  preloadGravplatsBilder(maxSida);
  uppdateraVyVal();
  uppdateraExtramaterialLista();
  uppdateraUrklippUI();
  uppdateraSaknadAntal();
  uppdateraSerieVisning();
}

function uppdateraSerieVisning() {
  const startVisa = document.getElementById('serie-start-visa');
  const slutVisa = document.getElementById('serie-slut-visa');
  if (startVisa) startVisa.textContent = seriesStartSida != null ? 'Start: sida ' + seriesStartSida : 'Start: –';
  if (slutVisa) slutVisa.textContent = 'Slut: sida ' + startSida;
}

/** Parsar inledande heltal från gravplatsnummer (t.ex. "5" → 5, "1+2" → 1). */
function parseLeadingNumber(s) {
  const m = String(s || '').trim().match(/^\d+/);
  return m ? parseInt(m[0], 10) : NaN;
}

async function verkställSerie() {
  if (!valdMapp) return;
  if (seriesStartSida == null) {
    visaSerieTooltip('Sätt startposition först (gå till första gravplatsen och klicka Sätt start).');
    return;
  }
  const startNrStr = document.getElementById('serie-start-nr')?.value?.trim() ?? '';
  const startNr = parseLeadingNumber(startNrStr);
  if (Number.isNaN(startNr)) {
    visaSerieTooltip('Ange startgravplatsnummer (t.ex. 1 eller 5).');
    return;
  }
  const maxSida = antalInnehållsSidor();
  if (startSida < seriesStartSida) {
    visaSerieTooltip('Slutposition måste vara efter start. Gå till sista gravplatsen i serien.');
    return;
  }
  if ((startSida - seriesStartSida) % 2 !== 0) {
    visaSerieTooltip('Start och slut måste vara samma typ av position (båda udda start_sida).');
    return;
  }
  const kvarter = document.getElementById('gravkvarter')?.value?.trim() ?? '';
  const gravplatser = window.gravplatser || [];
  const antal = (startSida - seriesStartSida) / 2 + 1;
  try {
    for (let i = 0; i < antal; i++) {
      const s = seriesStartSida + i * 2;
      const g = gravplatser.find((x) => x.start_sida === s);
      const gravplatsnummer = String(startNr + i);
      await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/gravplats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_sida: s,
          kvarter,
          gravplatsnummer,
          sida1_ovre_tillhor_denna: false,
          sida3_ovre_tillhor_nasta: g ? !!g.sida3_ovre_tillhor_nasta : false,
        }),
      });
    }
    const res = await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/gravplats`);
    const data = await res.json();
    window.gravplatser = data.gravplatser || [];
    visaSerieTooltip('Serie sparad: ' + antal + ' gravplatser från ' + startNr + ' till ' + (startNr + antal - 1) + '.');
    uppdateraPdfBilder();
  } catch (e) {
    visaSerieTooltip('Kunde inte spara: ' + e.message);
  }
}

function visaSerieTooltip(text) {
  const el = document.getElementById('serie-tooltip');
  if (!el) return;
  el.textContent = text;
  el.classList.add('visibel');
  clearTimeout(visaSerieTooltip._tid);
  visaSerieTooltip._tid = setTimeout(() => el.classList.remove('visibel'), 4000);
}

function getFilnamnForRuta(ruta) {
  if (ruta === 1) return currentFilnamn1;
  if (ruta === 2) return currentFilnamn2;
  if (ruta === 3) return currentFilnamn3;
  return '';
}

function getItemForRuta(ruta) {
  if (ruta === 1) return currentItem1;
  if (ruta === 2) return currentItem2;
  if (ruta === 3) return currentItem3;
  return null;
}

function uppdateraExtramaterialLista() {
  const el = document.getElementById('extramaterial-lista');
  const currentEl = document.getElementById('em-current-start');
  if (!el || !currentEl) return;
  currentEl.textContent = getDisplayStartSida();
  const forDenna = (window.extramaterial || []).filter((e) => Number(e.grav_start_sida) === startSida);
  if (forDenna.length === 0) {
    el.innerHTML = '<p class="em-tom">Inga registrerade.</p>';
  } else {
    el.innerHTML = '<ul class="em-lista-med-ta-bort">' + forDenna.map((e) => {
      let label = e.typ ? e.filnamn + ' (' + e.typ + ')' : e.filnamn;
      if (e.redan_halva) label += ' [färdig halva]';
      const filUrl = `${API}/mappar/${encodeURIComponent(valdMapp)}/fil/${encodeURIComponent(e.filnamn)}`;
      const id = e.id != null ? String(e.id) : '';
      return `<li><a href="${filUrl}" target="_blank" rel="noopener">${label}</a> <button type="button" class="em-ta-bort" data-em-id="${id}" data-em-filnamn="${encodeURIComponent(e.filnamn)}" data-em-grav-start="${e.grav_start_sida != null ? e.grav_start_sida : ''}" title="Koppla bort">Ta bort</button></li>`;
    }).join('') + '</ul>';
  }
}

function uppdateraUrklippUI() {
  const statusEl = document.getElementById('em-urklipp-status');
  const aktionerEl = document.getElementById('em-urklipp-aktioner');
  if (!statusEl || !aktionerEl) return;
  if (urklipp.length === 0) {
    statusEl.textContent = 'Inga sidor i urklippet.';
    aktionerEl.hidden = true;
  } else {
    statusEl.textContent = urklipp.length + ' sida(or) i urklippet: ' + urklipp.join(', ');
    aktionerEl.hidden = false;
  }
}

/** Ogiltigförklarar bildcache så att efterföljande sidor laddas om med rätt innehåll. */
function ogiltigförklaraBildcache() {
  cacheBust = Date.now();
}

/** Klipp ut en sida – läggs i urklipp och plockas bort från visningen; flödet och startSida räknas om. */
function klippUtSomExtramaterial(filnamn) {
  if (!filnamn || filnamn === '–' || filnamn === 'Tom sida') return;
  urklipp.push(filnamn);
  uppdateraUrklippUI();
  const effectiveFiler = getEffectiveFiler();
  if (effectiveFiler.length >= 3 && startSida + 2 > effectiveFiler.length) {
    startSida = Math.max(1, effectiveFiler.length - 2);
  }
  uppdateraPdfBilder();
}

function synaMenyForRuta(dropdown, ruta) {
  if (!dropdown) return;
  const item = getItemForRuta(ruta);
  const effectiveFiler = getEffectiveFiler();
  const index = startSida + ruta - 2;
  const isFile = item && item.t === 'f';
  const isBlank = item && item.t === 'b';
  dropdown.querySelectorAll('.meny-item').forEach((btn) => {
    const action = btn.getAttribute('data-action');
    let show = false;
    if (action === 'klipp-ut' || action === 'infoga-tom-sida') show = isFile;
    else if (action === 'ta-bort-infogad') show = isBlank;
    else if (action === 'flytta-vanster') show = isFile && index > 0;
    else if (action === 'flytta-hoger') show = isFile && index < effectiveFiler.length - 1;
    else if (action === 'redan-halva-flode') {
      show = isFile;
      if (show) btn.textContent = item && item.redan_halva ? 'Avmarkera redan halva' : 'Markera som redan halva';
    } else show = true;
    btn.hidden = !show;
  });
}

async function infogaTomSidaEfter(filnamn) {
  if (!valdMapp || !filnamn) return;
  try {
    const res = await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/infoga-tom-sida`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ efter_filnamn: filnamn }),
    });
    if (!res.ok) throw new Error(await res.text());
    ogiltigförklaraBildcache();
    await refreshFiler();
  } catch (e) {
    alert('Kunde inte infoga tom sida: ' + e.message);
  }
}

async function taBortInfogadSida(blankId) {
  if (!valdMapp || blankId == null) return;
  try {
    const res = await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/infogad-tom-sida/${blankId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(await res.text());
    ogiltigförklaraBildcache();
    await refreshFiler();
  } catch (e) {
    alert('Kunde inte ta bort infogad sida: ' + e.message);
  }
}

async function flyttaSida(filnamn, riktning) {
  if (!valdMapp || !filnamn || !riktning) return;
  try {
    const res = await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/flytta-sida`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filnamn, riktning }),
    });
    if (!res.ok) throw new Error(await res.text());
    ogiltigförklaraBildcache();
    await refreshFiler();
  } catch (e) {
    alert('Kunde inte flytta sida: ' + e.message);
  }
}

/** Markera/avmarkera en sida i flödet som "redan halva" – sidan stannar kvar i flödet och visas som en bild. */
async function setRedanHalvaFlode(filnamn, redanHalva) {
  if (!valdMapp || !filnamn) return;
  try {
    const res = await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/sida-redan-halva`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filnamn, redan_halva: redanHalva }),
    });
    if (!res.ok) throw new Error(await res.text());
    ogiltigförklaraBildcache();
    await refreshFiler();
  } catch (e) {
    alert('Kunde inte uppdatera: ' + e.message);
  }
}

async function infogaUrklippPåGravplats() {
  if (urklipp.length === 0 || !valdMapp) return;
  const typ = document.getElementById('em-urklipp-typ')?.value?.trim() || null;
  const redanHalva = document.getElementById('em-urklipp-redan-halva')?.checked ?? false;
  try {
    for (const filnamn of urklipp) {
      const res = await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/extramaterial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filnamn, typ, grav_start_sida: startSida, redan_halva: redanHalva }),
      });
      if (!res.ok) throw new Error(await res.text());
    }
    urklipp = [];
    document.getElementById('em-urklipp-typ').value = '';
    uppdateraUrklippUI();
    ogiltigförklaraBildcache();
    await refreshFiler();
  } catch (e) {
    alert('Kunde inte infoga: ' + e.message);
  }
}

async function infogaUrklippPåMapp() {
  if (urklipp.length === 0 || !valdMapp) return;
  const typ = document.getElementById('em-urklipp-typ')?.value?.trim() || null;
  const redanHalva = document.getElementById('em-urklipp-redan-halva')?.checked ?? false;
  try {
    for (const filnamn of urklipp) {
      const res = await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/extramaterial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filnamn, typ, grav_start_sida: null, redan_halva: redanHalva }),
      });
      if (!res.ok) throw new Error(await res.text());
    }
    urklipp = [];
    document.getElementById('em-urklipp-typ').value = '';
    uppdateraUrklippUI();
    ogiltigförklaraBildcache();
    await refreshFiler();
  } catch (e) {
    alert('Kunde inte infoga: ' + e.message);
  }
}

/** Ta bort/avknyt extramaterial. Cachning ogiltigförklaras så att bilder efter i ordningen laddas om. */
async function taBortExtramaterial(emIdOrRef) {
  if (!valdMapp) return;
  const mappListaSynlig = document.getElementById('em-visa-mapp')?.getAttribute('aria-expanded') === 'true';
  try {
    let url;
    if (typeof emIdOrRef === 'object' && emIdOrRef !== null && 'filnamn' in emIdOrRef) {
      const params = new URLSearchParams({ filnamn: emIdOrRef.filnamn });
      if (emIdOrRef.grav_start_sida != null && emIdOrRef.grav_start_sida !== '') {
        params.set('grav_start_sida', String(emIdOrRef.grav_start_sida));
      }
      url = `${API}/mappar/${encodeURIComponent(valdMapp)}/extramaterial-by-ref?${params}`;
    } else {
      const id = typeof emIdOrRef === 'number' ? emIdOrRef : parseInt(emIdOrRef, 10);
      if (Number.isNaN(id) || id < 1) return;
      url = `${API}/mappar/${encodeURIComponent(valdMapp)}/extramaterial/${id}`;
    }
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    ogiltigförklaraBildcache(); // nödvändigt när extramaterial plockas bort – ordningen ändras
    await refreshFiler();
    if (mappListaSynlig) await uppdateraExtramaterialMappLista();
  } catch (e) {
    alert('Kunde inte ta bort: ' + e.message);
  }
}

function stangAllaMenyDropdowns() {
  document.querySelectorAll('.meny-dropdown').forEach((d) => { d.hidden = true; });
}

async function refreshFiler() {
  if (!valdMapp) return;
  const cacheBuster = `_v=${Date.now()}`;
  const res = await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/filer?${cacheBuster}`, { cache: 'no-store' });
  const data = await res.json();
  const raw = data.effective_filer || data.filer || [];
  filer = raw.map((item) => (typeof item === 'string' ? { t: 'f', v: item } : item));
  window.extramaterial = data.extramaterial || [];
  uppdateraPdfBilder();
}

/** Preload bilder för föregående och nästa gravplats (max 6 bilder) för snabbare bläddring. */
function preloadGravplatsBilder(maxSida) {
  if (!valdMapp || filer.length === 0) return;
  const offsetQ = 'offset=0';
  const cacheQ = `_v=${cacheBust}`;
  const excludeQ = urklipp.length ? '&exclude=' + encodeURIComponent(urklipp.join(',')) : '';
  const base = `${API}/mappar/${encodeURIComponent(valdMapp)}/sida`;
  const visaHela = document.getElementById('visa-hela-sidor')?.checked === true;

  const urls = [];
  const q = `${offsetQ}&${cacheQ}${excludeQ}`;
  if (visaHela) {
    if (startSida + 2 + 2 <= maxSida) {
      const n1 = startSida + 2, n2 = startSida + 3, n3 = startSida + 4;
      urls.push(`${base}/${n1}?${q}`, `${base}/${n2}?${q}`, `${base}/${n3}?${q}`);
    }
    if (startSida >= 3) {
      const p1 = startSida - 2, p2 = startSida - 1, p3 = startSida;
      urls.push(`${base}/${p1}?${q}`, `${base}/${p2}?${q}`, `${base}/${p3}?${q}`);
    }
  } else {
    const splitSida1och3 = (727 / 1597).toFixed(4);
    const splitSida2 = (870 / 1595).toFixed(4);
    if (startSida + 2 + 2 <= maxSida) {
      const n1 = startSida + 2, n2 = startSida + 3, n3 = startSida + 4;
      urls.push(
        `${base}/${n1}/halva?${offsetQ}&halva=nedre&split=${splitSida1och3}&${cacheQ}${excludeQ}`,
        `${base}/${n2}/halva?${offsetQ}&halva=nedre&split=${splitSida2}&${cacheQ}${excludeQ}`,
        `${base}/${n3}/halva?${offsetQ}&halva=ovre&split=${splitSida1och3}&${cacheQ}${excludeQ}`,
      );
    }
    if (startSida >= 3) {
      const p1 = startSida - 2, p2 = startSida - 1, p3 = startSida;
      urls.push(
        `${base}/${p1}/halva?${offsetQ}&halva=nedre&split=${splitSida1och3}&${cacheQ}${excludeQ}`,
        `${base}/${p2}/halva?${offsetQ}&halva=nedre&split=${splitSida2}&${cacheQ}${excludeQ}`,
        `${base}/${p3}/halva?${offsetQ}&halva=ovre&split=${splitSida1och3}&${cacheQ}${excludeQ}`,
      );
    }
  }
  urls.forEach((url) => {
    const img = new Image();
    img.src = url;
  });
}

function arHalvvy() {
  return document.querySelector('input[name="vy"]:checked')?.value === 'halvor';
}

function uppdateraVyVal() {
  const hela = document.getElementById('vy-hela');
  const halvor = document.getElementById('vy-halvor');
  if (!hela || !halvor) return;
  if (arHalvvy()) {
    hela.hidden = true;
    hela.style.display = 'none';
    halvor.hidden = false;
    halvor.style.display = 'block';
  } else {
    hela.hidden = false;
    hela.style.display = '';
    halvor.hidden = true;
    halvor.style.display = 'none';
  }
}

document.getElementById('mapp').addEventListener('change', (e) => {
  valjMapp(e.target.value || null);
});

async function sparaMappConfig() {
  if (!valdMapp) return;
  const kyrkogard = document.getElementById('kyrkogard')?.value?.trim() || null;
  const gravkvarter = document.getElementById('gravkvarter')?.value?.trim() || null;
  try {
    await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kyrkogard, gravkvarter, forsett_antal: window.mappForsettAntal ?? 0 }),
    });
  } catch (e) {
    console.warn('Kunde inte spara mappconfig:', e);
  }
}
document.getElementById('kyrkogard')?.addEventListener('change', sparaMappConfig);
document.getElementById('gravkvarter')?.addEventListener('blur', sparaMappConfig);

document.getElementById('gravplatsnummer')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.getElementById('enter-ga-nasta')?.checked) {
    e.preventDefault();
    const maxSida = antalInnehållsSidor();
    if (startSida + 2 <= maxSida) sparaGravplatsOchGåNästa();
  }
});

document.getElementById('btn-föregående').addEventListener('click', () => {
  if (startSida > 1) {
    startSida -= 2; // föregående gravplats: tidigare ruta 1 blir nu ruta 3
    if (startSida < 1) startSida = 1;
    uppdateraPdfBilder();
  }
});

async function sparaHalvaKoppling() {
  if (!valdMapp) return;
  const g = (window.gravplatser || []).find((x) => x.start_sida === startSida);
  let kvarter = document.getElementById('gravkvarter')?.value?.trim() ?? '';
  let gravplatsnummer = document.getElementById('gravplatsnummer')?.value?.trim() ?? '';
  if (!kvarter && g && g.kvarter && String(g.kvarter).trim()) kvarter = g.kvarter.trim();
  if (!gravplatsnummer && g && g.gravplatsnummer && String(g.gravplatsnummer).trim()) gravplatsnummer = g.gravplatsnummer.trim();
  const sida3OvreNasta = document.getElementById('sida3-ovre-nasta')?.checked ?? false;
  try {
    await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/gravplats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kvarter,
        gravplatsnummer,
        start_sida: startSida,
        sida1_ovre_tillhor_denna: false,
        sida3_ovre_tillhor_nasta: sida3OvreNasta,
      }),
    });
    const res = await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/gravplats`);
    const data = await res.json();
    window.gravplatser = data.gravplatser || [];
  } catch (e) {
    console.warn('Kunde inte spara halva-koppling:', e);
  }
}

/** Returnerar true om formulärets värden skiljer sig från sparad gravplats för aktuell startSida. */
function harGravplatsDataAndrats() {
  const g = (window.gravplatser || []).find((x) => x.start_sida === startSida);
  let kvarter = document.getElementById('gravkvarter')?.value?.trim() ?? '';
  let gravplatsnummer = document.getElementById('gravplatsnummer')?.value?.trim() ?? '';
  if (!kvarter && g && g.kvarter && String(g.kvarter).trim()) kvarter = g.kvarter.trim();
  if (!gravplatsnummer && g && g.gravplatsnummer && String(g.gravplatsnummer).trim()) gravplatsnummer = g.gravplatsnummer.trim();
  const sida3OvreNasta = document.getElementById('sida3-ovre-nasta')?.checked ?? false;
  if (!g) return kvarter !== '' || gravplatsnummer !== '' || sida3OvreNasta;
  return (g.kvarter || '') !== kvarter
    || (g.gravplatsnummer || '') !== gravplatsnummer
    || !!g.sida3_ovre_tillhor_nasta !== sida3OvreNasta;
}

/** Sparar aktuell gravplats (kvarter, gravplatsnummer, halva-koppling) utan att byta sida. Skippar POST om inget ändrats. */
async function sparaGravplats() {
  if (!valdMapp) return;
  if (!harGravplatsDataAndrats()) return;
  const g = (window.gravplatser || []).find((x) => x.start_sida === startSida);
  let kvarter = document.getElementById('gravkvarter')?.value?.trim() ?? '';
  let gravplatsnummer = document.getElementById('gravplatsnummer')?.value?.trim() ?? '';
  if (!kvarter && g && g.kvarter && String(g.kvarter).trim()) kvarter = g.kvarter.trim();
  if (!gravplatsnummer && g && g.gravplatsnummer && String(g.gravplatsnummer).trim()) gravplatsnummer = g.gravplatsnummer.trim();
  const sida3OvreNasta = document.getElementById('sida3-ovre-nasta')?.checked ?? false;
  try {
    await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/gravplats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kvarter,
        gravplatsnummer,
        start_sida: startSida,
        sida1_ovre_tillhor_denna: false,
        sida3_ovre_tillhor_nasta: sida3OvreNasta,
      }),
    });
    const res = await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/gravplats`);
    const data = await res.json();
    window.gravplatser = data.gravplatser || [];
    uppdateraPdfBilder();
  } catch (e) {
    console.warn('Kunde inte spara gravplats:', e);
  }
}

async function sparaGravplatsOchGåNästa() {
  const maxSida = antalInnehållsSidor();
  if (startSida + 2 > maxSida) return;
  await sparaGravplats();
  document.getElementById('gravplatsnummer').value = '';
  startSida += 2;
  uppdateraPdfBilder();
}

document.getElementById('btn-spara-gravplats')?.addEventListener('click', () => { sparaGravplats(); });
document.getElementById('btn-nästa').addEventListener('click', () => {
  const maxSida = antalInnehållsSidor();
  if (startSida + 2 <= maxSida) sparaGravplatsOchGåNästa();
});

document.getElementById('btn-föregående-saknad')?.addEventListener('click', hoppaTillFöregåendeSaknad);
document.getElementById('btn-nasta-saknad')?.addEventListener('click', hoppaTillNastaSaknad);

document.getElementById('btn-serie-start')?.addEventListener('click', () => {
  seriesStartSida = startSida;
  uppdateraSerieVisning();
  visaSerieTooltip('Startposition satt till sida ' + startSida + '. Gå till sista gravplatsen och klicka Verkställ serie.');
});

document.getElementById('btn-serie-verkstall')?.addEventListener('click', () => { verkställSerie(); });

document.querySelectorAll('input[name="vy"]').forEach((radio) => {
  radio.addEventListener('change', uppdateraVyVal);
});
document.getElementById('visa-hela-sidor')?.addEventListener('change', () => {
  if (valdMapp && document.getElementById('visning') && !document.getElementById('visning').hidden) {
    uppdateraPdfBilder();
  }
});

document.getElementById('sida3-ovre-nasta')?.addEventListener('change', () => { sparaHalvaKoppling(); });

document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if (document.getElementById('visning').hidden) return;
  const maxSida = antalInnehållsSidor();
  if (e.key === 'ArrowLeft') {
    if (startSida > 1) {
      startSida -= 2;
      if (startSida < 1) startSida = 1;
      uppdateraPdfBilder();
    }
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    if (startSida + 2 <= maxSida) sparaGravplatsOchGåNästa();
    e.preventDefault();
  }
});

document.getElementById('em-infoga-grav')?.addEventListener('click', infogaUrklippPåGravplats);
document.getElementById('em-infoga-mapp')?.addEventListener('click', infogaUrklippPåMapp);

document.getElementById('em-rubrik')?.addEventListener('click', () => {
  const innehall = document.getElementById('em-innehall');
  const rubrik = document.getElementById('em-rubrik');
  const ikon = rubrik?.querySelector('.em-rubrik-ikon');
  if (!innehall || !rubrik) return;
  const isOpen = rubrik.getAttribute('aria-expanded') === 'true';
  innehall.hidden = isOpen;
  rubrik.setAttribute('aria-expanded', !isOpen);
  if (ikon) ikon.textContent = isOpen ? '▶' : '▼';
});

function onTaBortExtramaterialClick(e) {
  const btn = e.target.closest('.em-ta-bort');
  if (!btn || !valdMapp) return;
  const idStr = btn.getAttribute('data-em-id');
  const filnamn = btn.getAttribute('data-em-filnamn');
  const gravStart = btn.getAttribute('data-em-grav-start');
  let id = parseInt(idStr, 10);
  if ((Number.isNaN(id) || id < 1) && filnamn) {
    const decoded = decodeURIComponent(filnamn);
    const grav_start_sida = (gravStart !== '' && gravStart != null) ? parseInt(gravStart, 10) : null;
    if (grav_start_sida === null || !Number.isNaN(grav_start_sida)) {
      e.preventDefault();
      e.stopPropagation();
      taBortExtramaterial({ filnamn: decoded, grav_start_sida: grav_start_sida });
      return;
    }
  }
  if (Number.isNaN(id) || id < 1) return;
  e.preventDefault();
  e.stopPropagation();
  taBortExtramaterial(id);
}

document.addEventListener('click', onTaBortExtramaterialClick, true);

document.querySelector('.visning')?.addEventListener('click', (e) => {
  const menyKnapp = e.target.closest('.meny-knapp');
  const menyItem = e.target.closest('.meny-item');
  if (menyKnapp) {
    const wrapper = menyKnapp.closest('.meny-wrapper');
    const dropdown = wrapper?.querySelector('.meny-dropdown');
    const isOpen = dropdown && !dropdown.hidden;
    const ruta = parseInt(menyKnapp.getAttribute('data-ruta'), 10);
    stangAllaMenyDropdowns();
    if (dropdown && !isOpen && !isNaN(ruta)) synaMenyForRuta(dropdown, ruta);
    if (dropdown && !isOpen) dropdown.hidden = false;
    e.stopPropagation();
    return;
  }
  if (menyItem) {
    const wrapper = menyItem.closest('.meny-wrapper');
    const knapp = wrapper?.querySelector('.meny-knapp');
    const ruta = knapp ? parseInt(knapp.getAttribute('data-ruta'), 10) : NaN;
    const action = menyItem.getAttribute('data-action');
    const item = !isNaN(ruta) ? getItemForRuta(ruta) : null;
    if (action === 'klipp-ut' && item && item.t === 'f') {
      klippUtSomExtramaterial(item.v);
    } else if (action === 'infoga-tom-sida' && item && item.t === 'f') {
      infogaTomSidaEfter(item.v);
    } else if (action === 'ta-bort-infogad' && item && item.t === 'b') {
      taBortInfogadSida(item.id);
    } else if (action === 'flytta-vanster' && item && item.t === 'f') {
      flyttaSida(item.v, 'vänster');
    } else if (action === 'flytta-hoger' && item && item.t === 'f') {
      flyttaSida(item.v, 'höger');
    } else if (action === 'redan-halva-flode' && item && item.t === 'f') {
      setRedanHalvaFlode(item.v, !item.redan_halva);
    }
    stangAllaMenyDropdowns();
    e.stopPropagation();
  }
});

document.addEventListener('click', () => stangAllaMenyDropdowns());

/** Hämtar och renderar listan "extramaterial knutet till mappen". Anropas vid öppning och efter Ta bort. */
async function uppdateraExtramaterialMappLista() {
  const listaEl = document.getElementById('extramaterial-mapp-lista');
  if (!listaEl || !valdMapp) return;
  try {
    const res = await fetch(`${API}/mappar/${encodeURIComponent(valdMapp)}/extramaterial-mapp`);
    const data = await res.json();
    const items = data.extramaterial || [];
    const pdfBase = `${API}/mappar/${encodeURIComponent(valdMapp)}/fil`;
    if (items.length === 0) {
      listaEl.innerHTML = '<p class="extramaterial-mapp-tom">Inget extramaterial knutet endast till mappen.</p>';
    } else {
      listaEl.innerHTML = '<ul class="em-lista-med-ta-bort">' + items.map((e) => {
        const label = e.typ ? `${e.filnamn} (${e.typ})` : e.filnamn;
        const id = e.id != null ? String(e.id) : '';
        return `<li><a href="${pdfBase}/${encodeURIComponent(e.filnamn)}" target="_blank" rel="noopener">${label}</a> <button type="button" class="em-ta-bort" data-em-id="${id}" data-em-filnamn="${encodeURIComponent(e.filnamn)}" data-em-grav-start="" title="Koppla bort">Ta bort</button></li>`;
      }).join('') + '</ul>';
    }
  } catch (e) {
    listaEl.innerHTML = '<p class="extramaterial-mapp-fel">Kunde inte ladda: ' + e.message + '</p>';
  }
}

async function visaExtramaterialMapp() {
  const btn = document.getElementById('em-visa-mapp');
  const listaEl = document.getElementById('extramaterial-mapp-lista');
  if (!btn || !listaEl || !valdMapp) return;
  const isOpen = btn.getAttribute('aria-expanded') === 'true';
  if (isOpen) {
    listaEl.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = 'Visa extramaterial knutet till mappen';
    return;
  }
  await uppdateraExtramaterialMappLista();
  listaEl.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  btn.textContent = 'Dölj extramaterial knutet till mappen';
}
document.getElementById('em-visa-mapp')?.addEventListener('click', visaExtramaterialMapp);

document.getElementById('dev-meny-toggle')?.addEventListener('click', () => {
  const innehall = document.getElementById('dev-meny-innehall');
  if (innehall) innehall.hidden = !innehall.hidden;
});
document.getElementById('dev-nolla-cache')?.addEventListener('click', () => {
  ogiltigförklaraBildcache();
  if (valdMapp && document.getElementById('visning') && !document.getElementById('visning').hidden) {
    uppdateraPdfBilder();
  }
});
document.getElementById('dev-stang-av')?.addEventListener('click', () => {
  fetch(`${API}/dev/shutdown`, { method: 'POST' }).catch(() => {});
});

laddaMappar();
