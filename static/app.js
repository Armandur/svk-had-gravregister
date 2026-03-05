/**
 * Gravregister PoC – välj mapp, visa 3 PDF-sidor per gravplats.
 */

const API = '/api';

let mappar = [];
let valdMapp = null;
let filer = [];
let startSida = 1; // 1-baserat: första innehållssidan för aktuell gravplats (efter försättssidor)
let forstattOffset = 0; // 0, 1 eller 2 – antal försättssidor att hoppa över

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
    document.getElementById('kontext').hidden = true;
    document.getElementById('visning').hidden = true;
    return;
  }
  valdMapp = mappNamn;
  document.getElementById('kontext').hidden = false;
  forstattOffset = parseInt(document.getElementById('forsattssidor').value, 10) || 0;

  try {
    const res = await fetch(`${API}/mappar/${encodeURIComponent(mappNamn)}/filer`);
    const data = await res.json();
    filer = data.filer || [];
    const innehållsSidor = Math.max(0, filer.length - forstattOffset);
    document.getElementById('mapp-status').textContent =
      filer.length + ' PDF-filer i mappen. Efter ' + forstattOffset + ' försättssidor: ' + innehållsSidor + ' innehållssidor.';

    if (innehållsSidor >= 3) {
      document.getElementById('visning').hidden = false;
      startSida = 1;
      uppdateraPdfBilder();
    } else {
      document.getElementById('visning').hidden = true;
      document.getElementById('mapp-status').textContent += ' Behöver minst 3 innehållssidor (efter försättssidor) för att visa en gravplats.';
    }
  } catch (e) {
    document.getElementById('mapp-status').textContent = 'Kunde inte ladda filer: ' + e.message;
    document.getElementById('visning').hidden = true;
  }
}

function antalInnehållsSidor() {
  return Math.max(0, filer.length - forstattOffset);
}

function uppdateraPdfBilder() {
  forstattOffset = parseInt(document.getElementById('forsattssidor').value, 10) || 0;
  const s1 = startSida;
  const s2 = startSida + 1;
  const s3 = startSida + 2;
  const pdfBase = `${API}/mappar/${encodeURIComponent(valdMapp)}/pdf`;
  const offsetQ = `offset=${forstattOffset}`;

  // Samma beskärningar (splits) i båda vyerna – bara layout skiljer
  const splitSida1och3 = (727 / 1597).toFixed(4);
  const splitSida2 = (870 / 1595).toFixed(4);
  const halvaBase = `${API}/mappar/${encodeURIComponent(valdMapp)}/sida`;
  const url1 = `${halvaBase}/${s1}/halva?${offsetQ}&halva=nedre&split=${splitSida1och3}`;
  const url2 = `${halvaBase}/${s2}/halva?${offsetQ}&halva=nedre&split=${splitSida2}`;
  const url3 = `${halvaBase}/${s3}/halva?${offsetQ}&halva=ovre&split=${splitSida1och3}`;

  // Horisontell vy: samma tre bilder
  document.getElementById('img-sida-1').src = url1;
  document.getElementById('img-sida-2').src = url2;
  document.getElementById('img-sida-3').src = url3;

  // Filnamn och länkar till PDF
  const idx1 = forstattOffset + startSida - 1;
  const idx2 = forstattOffset + startSida;
  const idx3 = forstattOffset + startSida + 1;
  const filnamn1 = filer[idx1] || '–';
  const filnamn2 = filer[idx2] || '–';
  const filnamn3 = filer[idx3] || '–';
  document.getElementById('filnamn-sida-1').textContent = filnamn1;
  document.getElementById('filnamn-sida-2').textContent = filnamn2;
  document.getElementById('filnamn-sida-3').textContent = filnamn3;
  document.getElementById('link-sida-1').href = `${pdfBase}/${s1}?${offsetQ}`;
  document.getElementById('link-sida-2').href = `${pdfBase}/${s2}?${offsetQ}`;
  document.getElementById('link-sida-3').href = `${pdfBase}/${s3}?${offsetQ}`;

  const maxSida = antalInnehållsSidor();
  document.getElementById('btn-föregående').disabled = startSida <= 1;
  document.getElementById('btn-nästa').disabled = s3 > maxSida;

  // Vertikal vy: samma tre bilder
  document.getElementById('halva-img-1').src = url1;
  document.getElementById('halva-img-2').src = url2;
  document.getElementById('halva-img-3').src = url3;
  document.getElementById('halva-filnamn-1').textContent = filnamn1;
  document.getElementById('halva-filnamn-2').textContent = filnamn2;
  document.getElementById('halva-filnamn-3').textContent = filnamn3;
  document.getElementById('halva-link-1').href = `${pdfBase}/${s1}?${offsetQ}`;
  document.getElementById('halva-link-2').href = `${pdfBase}/${s2}?${offsetQ}`;
  document.getElementById('halva-link-3').href = `${pdfBase}/${s3}?${offsetQ}`;

  preloadGravplatsBilder(maxSida);
  uppdateraVyVal();
}

/** Preload bilder för föregående och nästa gravplats (max 6 bilder) för snabbare bläddring. */
function preloadGravplatsBilder(maxSida) {
  if (!valdMapp || filer.length === 0) return;
  const offsetQ = `offset=${forstattOffset}`;
  const splitSida1och3 = (727 / 1597).toFixed(4);
  const splitSida2 = (870 / 1595).toFixed(4);
  const base = `${API}/mappar/${encodeURIComponent(valdMapp)}/sida`;

  const urls = [];
  // Nästa gravplats (startSida+2, +3, +4)
  if (startSida + 2 + 2 <= maxSida) {
    const n1 = startSida + 2, n2 = startSida + 3, n3 = startSida + 4;
    urls.push(
      `${base}/${n1}/halva?${offsetQ}&halva=nedre&split=${splitSida1och3}`,
      `${base}/${n2}/halva?${offsetQ}&halva=nedre&split=${splitSida2}`,
      `${base}/${n3}/halva?${offsetQ}&halva=ovre&split=${splitSida1och3}`,
    );
  }
  // Föregående gravplats (startSida-2, -1, startSida)
  if (startSida >= 3) {
    const p1 = startSida - 2, p2 = startSida - 1, p3 = startSida;
    urls.push(
      `${base}/${p1}/halva?${offsetQ}&halva=nedre&split=${splitSida1och3}`,
      `${base}/${p2}/halva?${offsetQ}&halva=nedre&split=${splitSida2}`,
      `${base}/${p3}/halva?${offsetQ}&halva=ovre&split=${splitSida1och3}`,
    );
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

document.getElementById('btn-föregående').addEventListener('click', () => {
  if (startSida > 1) {
    startSida -= 2; // föregående gravplats: tidigare ruta 1 blir nu ruta 3
    if (startSida < 1) startSida = 1;
    uppdateraPdfBilder();
  }
});

document.getElementById('btn-nästa').addEventListener('click', () => {
  const maxSida = antalInnehållsSidor();
  if (startSida + 2 <= maxSida) {
    startSida += 2; // nästa gravplats: tidigare ruta 3 (gravrätt nästa) blir nu ruta 1
    uppdateraPdfBilder();
  }
});

document.querySelectorAll('input[name="vy"]').forEach((radio) => {
  radio.addEventListener('change', uppdateraVyVal);
});

document.addEventListener('keydown', (e) => {
  if (document.getElementById('visning').hidden) return;
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  const maxSida = antalInnehållsSidor();
  if (e.key === 'ArrowLeft') {
    if (startSida > 1) {
      startSida -= 2;
      if (startSida < 1) startSida = 1;
      uppdateraPdfBilder();
    }
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    if (startSida + 2 <= maxSida) {
      startSida += 2;
      uppdateraPdfBilder();
    }
    e.preventDefault();
  }
});

document.getElementById('forsattssidor').addEventListener('change', () => {
  if (!valdMapp || filer.length === 0) return;
  forstattOffset = parseInt(document.getElementById('forsattssidor').value, 10) || 0;
  const innehållsSidor = antalInnehållsSidor();
  document.getElementById('mapp-status').textContent =
    filer.length + ' PDF-filer. Efter ' + forstattOffset + ' försättssidor: ' + innehållsSidor + ' innehållssidor.';
  document.getElementById('visning').hidden = innehållsSidor < 3;
  if (startSida + 2 > innehållsSidor && startSida > 1) {
    startSida = Math.max(1, innehållsSidor - 2);
  }
  uppdateraPdfBilder();
});

laddaMappar();
