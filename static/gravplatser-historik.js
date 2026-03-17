/**
 * Gravregister – Historik-modal (diff av redigeringslogg).
 * Extraherat från gravplatser.js. Laddas före gravplatser.js.
 */

function _historikDiffData(ny, gammal) {
  if (!ny || !gammal) return null;
  const items = [];

  // Skalära textfält
  const SKALARER = {
    storlek: 'Storlek', underhall_text: 'Underhållstext',
    gravrattstid: 'Gravrattstid', monument: 'Monument',
    gravens_utformning: 'Gravens utformning', karta_nr: 'Kartnr',
    gravbrev_nr: 'Gravbrevnr', utfordat_den: 'Utfärdat den', kommentar: 'Kommentar',
  };
  for (const [key, etikett] of Object.entries(SKALARER)) {
    const a = (gammal[key] ?? '').toString().trim();
    const b = (ny[key] ?? '').toString().trim();
    if (a !== b) {
      if (!a) items.push({ typ: 'tillagg', text: etikett + ': ' + b });
      else if (!b) items.push({ typ: 'borttagning', text: etikett + ' borttagen' });
      else items.push({ typ: 'andring', text: etikett + ': ' + a + ' → ' + b });
    }
  }

  // Booleanska fält med läsbar svenska
  if ((!!ny.fardigtranskriberad) !== (!!gammal.fardigtranskriberad)) {
    if (ny.fardigtranskriberad) items.push({ typ: 'tillagg', text: 'Markerad som färdigtranskriberad' });
    else items.push({ typ: 'borttagning', text: 'Avmarkerad som färdigtranskriberad' });
  }
  if ((!!ny.underhall_overstruket) !== (!!gammal.underhall_overstruket)) {
    if (ny.underhall_overstruket) items.push({ typ: 'andring', text: 'Underhåll markerat som överstruket' });
    else items.push({ typ: 'andring', text: 'Underhåll – överstruket avmarkerat' });
  }

  // Djupjämförelse av listfält: detekterar tillagda, borttagna och ändrade poster
  function namnKey(x) { return ((x.fornamn || '') + ' ' + (x.efternamn || '')).trim() || '?'; }
  function diffListaDjup(nylista, gamallista, namnFn, etikett, extraFalt) {
    const gaMap = new Map((gamallista || []).map((x) => [namnFn(x), x]));
    const naMap = new Map((nylista || []).map((x) => [namnFn(x), x]));
    for (const [n] of naMap) if (!gaMap.has(n)) items.push({ typ: 'tillagg', text: etikett + ' tillagd: ' + n });
    for (const [n] of gaMap) if (!naMap.has(n)) items.push({ typ: 'borttagning', text: etikett + ' borttagen: ' + n });
    for (const [n, nyX] of naMap) {
      if (!gaMap.has(n)) continue;
      const gaX = gaMap.get(n);
      for (const [falt, faltEtikett] of Object.entries(extraFalt)) {
        const a = (gaX[falt] ?? '').toString().trim();
        const b = (nyX[falt] ?? '').toString().trim();
        if (a !== b) {
          if (!a) items.push({ typ: 'tillagg', text: etikett + ' ' + n + ' – ' + faltEtikett + ': ' + b });
          else if (!b) items.push({ typ: 'borttagning', text: etikett + ' ' + n + ' – ' + faltEtikett + ' borttagen' });
          else items.push({ typ: 'andring', text: etikett + ' ' + n + ' – ' + faltEtikett + ': ' + a + ' → ' + b });
        }
      }
    }
  }
  diffListaDjup(ny.innehavare, gammal.innehavare, namnKey, 'Innehavare',
    { yrke: 'yrke', gatuadress: 'adress', postnummer: 'postnr', postort: 'postort', kommentar: 'kommentar' });
  diffListaDjup(ny.narmast_anhoriga, gammal.narmast_anhoriga, namnKey, 'Anhörig',
    { yrke: 'yrke', adress: 'adress', kommentar: 'kommentar' });
  function namnGravsatt(x) {
    const n = namnKey(x);
    const ar = [x.fodelse_ar, x.dods_ar].filter(Boolean).join('–');
    return ar ? n + ' (' + ar + ')' : n;
  }
  diffListaDjup(ny.gravsatta, gammal.gravsatta, namnGravsatt, 'Gravsatt',
    { yrke: 'yrke', kommentar: 'kommentar' });

  // Skisser (antal)
  const nyS = (ny.skisser || []).length, gaS = (gammal.skisser || []).length;
  if (nyS > gaS) items.push({ typ: 'tillagg', text: 'Skiss tillagd (' + nyS + ' totalt)' });
  else if (nyS < gaS) items.push({ typ: 'borttagning', text: 'Skiss borttagen (' + nyS + ' kvar)' });

  // Sammanfattning
  const nA = items.filter((x) => x.typ === 'andring').length;
  const nT = items.filter((x) => x.typ === 'tillagg').length;
  const nB = items.filter((x) => x.typ === 'borttagning').length;
  const delar = [];
  if (nA) delar.push(nA + (nA === 1 ? ' ändring' : ' ändringar'));
  if (nT) delar.push(nT + (nT === 1 ? ' tillägg' : ' tillägg'));
  if (nB) delar.push(nB + (nB === 1 ? ' borttagning' : ' borttagningar'));
  return { items, sammanfattning: delar.length ? delar.join(', ') : 'Inga ändringar' };
}

/** Öppna historik-modal och hämta redigeringshistorik för aktuell gravplats. */
async function oppnaHistorikModal() {
  if (!state.currentUserIsAdmin || state.currentGravplatsId == null) return;
  const modal = document.getElementById('gp-historik-modal');
  if (!modal) return;

  const laddar = document.getElementById('gp-historik-laddar');
  const tabell = document.getElementById('gp-historik-tabell');
  const tbody = document.getElementById('gp-historik-tbody');
  const tom = document.getElementById('gp-historik-tom');
  const fel = document.getElementById('gp-historik-fel');
  const loggLank = document.getElementById('gp-historik-logg-lank');

  if (laddar) laddar.hidden = false;
  if (tabell) tabell.hidden = true;
  if (tom) tom.hidden = true;
  if (fel) { fel.hidden = true; fel.textContent = ''; }
  if (tbody) tbody.innerHTML = '';
  if (loggLank) loggLank.href = '/loggar?gravplats_id=' + state.currentGravplatsId;

  modal.showModal();

  try {
    const res = await fetch(`${API}/loggar/gravplatser?gravplats_id=${state.currentGravplatsId}&limit=50`, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const loggar = data.loggar || [];
    if (laddar) laddar.hidden = true;
    if (loggar.length === 0) {
      if (tom) tom.hidden = false;
    } else {
      const harSnapshots = loggar.some((r) => r.inmatning_snapshot != null);
      const tHead = tabell ? tabell.querySelector('thead tr') : null;
      if (tHead) {
        tHead.innerHTML = '<th scope="col">Datum och tid</th><th scope="col">Användare</th>' +
          (harSnapshots ? '<th scope="col">Ändringar</th>' : '');
      }
      // Helper: find the next regular (non-skiss-event) snapshot entry at index > i
      function finnNastaRegular(i) {
        for (let j = i + 1; j < loggar.length; j++) {
          const snap = loggar[j].inmatning_snapshot;
          if (snap && !snap._skiss_event) return j;
        }
        return -1;
      }

      function byggChipDetaljer(diffData, colSpan) {
        const detaljTd = document.createElement('td');
        detaljTd.colSpan = colSpan;
        if (diffData && diffData.items.length > 0) {
          const ul = document.createElement('ul');
          ul.className = 'gp-historik-andring-lista';
          diffData.items.forEach(function(item) {
            const li = document.createElement('li');
            const chip = document.createElement('span');
            chip.className = 'gp-historik-chip gp-historik-chip-' + item.typ;
            chip.textContent = item.text;
            li.appendChild(chip);
            ul.appendChild(li);
          });
          detaljTd.appendChild(ul);
        } else {
          const ingen = document.createElement('span');
          ingen.className = 'gp-historik-chip-ingen';
          ingen.textContent = 'Inga detaljerade ändringar registrerades';
          detaljTd.appendChild(ingen);
        }
        return detaljTd;
      }

      let expandCounter = 0;
      loggar.forEach(function(r, i) {
        const tr = document.createElement('tr');
        const datum = document.createElement('td');
        const anvandare = document.createElement('td');
        datum.style.whiteSpace = 'nowrap';
        datum.textContent = r.edited_at ? new Date(r.edited_at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '–';
        anvandare.textContent = r.username || '–';
        tr.appendChild(datum);
        tr.appendChild(anvandare);
        if (harSnapshots) {
          const andringarTd = document.createElement('td');
          const skissEvent = r.inmatning_snapshot && r.inmatning_snapshot._skiss_event;
          if (skissEvent) {
            // Skiss-händelse – enkel chip-rad, ej expanderbar
            const chip = document.createElement('span');
            chip.className = 'gp-historik-chip ' + (skissEvent === 'tillagd' ? 'gp-historik-chip-tillagg' : 'gp-historik-chip-borttagning');
            chip.textContent = skissEvent === 'tillagd' ? 'Skiss tillagd' : 'Skiss borttagen';
            andringarTd.appendChild(chip);
            tr.appendChild(andringarTd);
            tbody.appendChild(tr);
            return;
          }
          const nastaRegularIdx = finnNastaRegular(i);
          const harForegaende = r.inmatning_snapshot && nastaRegularIdx !== -1;
          const arForsta = r.inmatning_snapshot && nastaRegularIdx === -1;
          if (harForegaende) {
            const diffData = _historikDiffData(r.inmatning_snapshot, loggar[nastaRegularIdx].inmatning_snapshot);
            // Färdigtranskriberad-händelse – enkel chip-rad, ej expanderbar
            if (diffData && diffData.items.length === 1 &&
                (diffData.items[0].text === 'Markerad som färdigtranskriberad' || diffData.items[0].text === 'Avmarkerad som färdigtranskriberad')) {
              const chip = document.createElement('span');
              chip.className = 'gp-historik-chip gp-historik-chip-' + diffData.items[0].typ;
              chip.textContent = diffData.items[0].text;
              andringarTd.appendChild(chip);
              tr.appendChild(andringarTd);
              tbody.appendChild(tr);
              return;
            }
            const detaljId = 'gp-historik-detalj-' + (expandCounter++);
            tr.classList.add('gp-historik-rad-expanderbar');
            tr.setAttribute('aria-expanded', 'false');
            tr.setAttribute('role', 'button');
            tr.setAttribute('tabindex', '0');
            tr.setAttribute('aria-controls', detaljId);
            const chevron = document.createElement('span');
            chevron.className = 'gp-historik-chevron';
            chevron.textContent = ' ▶';
            const samm = document.createElement('span');
            samm.className = 'gp-historik-sammanfattning';
            samm.textContent = diffData ? diffData.sammanfattning : 'Inga ändringar';
            andringarTd.appendChild(samm);
            andringarTd.appendChild(chevron);
            const detaljTr = document.createElement('tr');
            detaljTr.id = detaljId;
            detaljTr.className = 'gp-historik-detalj-rad';
            detaljTr.hidden = true;
            detaljTr.appendChild(byggChipDetaljer(diffData, 3));
            function toggleExpand() {
              const expanded = tr.getAttribute('aria-expanded') === 'true';
              tr.setAttribute('aria-expanded', expanded ? 'false' : 'true');
              detaljTr.hidden = expanded;
              chevron.textContent = expanded ? ' ▶' : ' ▼';
            }
            tr.addEventListener('click', toggleExpand);
            tr.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(); } });
            tr.appendChild(andringarTd);
            tbody.appendChild(tr);
            tbody.appendChild(detaljTr);
            return;
          } else if (arForsta) {
            andringarTd.className = 'gp-historik-forsta';
            andringarTd.textContent = '(första sparande)';
          } else {
            andringarTd.textContent = '–';
          }
          tr.appendChild(andringarTd);
        }
        tbody.appendChild(tr);
      });
      if (tabell) tabell.hidden = false;
    }
  } catch (e) {
    if (laddar) laddar.hidden = true;
    if (fel) { fel.textContent = 'Kunde inte hämta historik: ' + (e.message || 'nätverksfel'); fel.hidden = false; }
  }
}
