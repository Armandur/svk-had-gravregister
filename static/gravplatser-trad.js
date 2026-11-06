/**
 * Gravplatsvyn: Trädet (kyrkogård, kvarter), gravplatslistan och adresser per grav.
 * Laddas före gravplatser.js och delar dess globala state.
 */

/** Bygg URL-slug för aktuell gravplats (t.ex. "HKG 01 1+2" → "HKG%2001%201%2B2"). */
function slugForGravplats(gp) {
  const s = (gp.fullstandigt || [gp.kyrkogard, gp.kvarter, gp.gravplatsnummer].filter(Boolean).join(' ') || '').trim();
  return s ? encodeURIComponent(s) : '';
}

/** Parsar pathname /gravplatser/slug till { kyrkogard, kvarter, gravplatsnummer } eller null. */
function parseGravplatsSlugFromPath() {
  const path = window.location.pathname;
  const prefix = '/gravplatser/';
  if (!path.startsWith(prefix)) return null;
  const slug = path.slice(prefix.length).replace(/\/$/, '');
  if (!slug) return null;
  const decoded = decodeURIComponent(slug);
  const parts = decoded.trim().split(/\s+/);
  if (parts.length < 3) return null;
  return {
    kyrkogard: parts[0],
    kvarter: parts.slice(1, -1).join(' '),
    gravplatsnummer: parts[parts.length - 1],
  };
}

/** Tar ut inledande tal från gravplatsnummer för numerisk sortering. */
function ledandeTal(s) {
  const m = String(s || '').trim().match(/^\d+/);
  return m ? parseInt(m[0], 10) : -1;
}

function sorteradLista(lista) {
  return [...lista].sort((a, b) => {
    const numA = ledandeTal(a.gravplatsnummer);
    const numB = ledandeTal(b.gravplatsnummer);
    if (numA !== numB) return numA - numB;
    return (a.gravplatsnummer || '').trim().localeCompare((b.gravplatsnummer || '').trim(), 'sv');
  });
}

async function fetchTradData() {
  try {
    const res = await fetch(`${API}/gravplatser/trad`, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.tradData = {
      kyrkogardar: data.kyrkogardar || [],
      kvarter_per_kyrkogard: data.kvarter_per_kyrkogard || {},
      antal_per_kvarter: data.antal_per_kvarter || {},
      antal_per_kyrkogard: data.antal_per_kyrkogard || {},
    };
  } catch (e) {
    state.tradData = { kyrkogardar: [], kvarter_per_kyrkogard: {}, antal_per_kvarter: {}, antal_per_kyrkogard: {} };
  }
}

async function laddaTrad() {
  await fetchTradData();
  const container = document.getElementById('gp-trad');
  const tomEl = document.getElementById('gp-trad-tom');
  if (!container) return;
  container.innerHTML = '';
  if (state.tradData.kyrkogardar.length === 0) {
    if (tomEl) tomEl.hidden = false;
    return;
  }
  if (tomEl) tomEl.hidden = true;
  state.tradData.kyrkogardar.forEach((kg) => {
    const kvarterLista = state.tradData.kvarter_per_kyrkogard[kg] || [];
    const div = document.createElement('div');
    div.className = 'trad-kyrkogard';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'trad-kyrkogard-btn';
    btn.setAttribute('aria-expanded', 'false');
    const kgAntal = (state.tradData.antal_per_kyrkogard && state.tradData.antal_per_kyrkogard[kg]) ?? 0;
    const kgPil = document.createElement('span');
    kgPil.className = 'trad-pil';
    kgPil.setAttribute('aria-hidden', 'true');
    btn.appendChild(kgPil);
    btn.appendChild(document.createTextNode(` ${kg} (${kgAntal})`));
    const ul = document.createElement('ul');
    ul.className = 'trad-kvarter-list';
    ul.hidden = true;
    kvarterLista.forEach((kv) => {
      const li = document.createElement('li');
      const kvWrap = document.createElement('div');
      kvWrap.className = 'trad-kvarter';
      const kvBtn = document.createElement('button');
      kvBtn.type = 'button';
      kvBtn.className = 'trad-kvarter-btn';
      kvBtn.setAttribute('aria-expanded', 'false');
      const kvAntal = (state.tradData.antal_per_kvarter && state.tradData.antal_per_kvarter[kg] && state.tradData.antal_per_kvarter[kg][kv]) ?? 0;
      const pilSpan = document.createElement('span');
      pilSpan.className = 'trad-pil';
      pilSpan.setAttribute('aria-hidden', 'true');
      kvBtn.appendChild(pilSpan);
      kvBtn.appendChild(document.createTextNode(` ${kv} (${kvAntal})`));
      kvBtn.dataset.kyrkogard = kg;
      kvBtn.dataset.kvarter = kv;
      const gpList = document.createElement('ul');
      gpList.className = 'trad-gravplats-list';
      gpList.hidden = true;
      kvBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const expanded = kvBtn.getAttribute('aria-expanded') === 'true';
        kvBtn.setAttribute('aria-expanded', !expanded);
        gpList.hidden = expanded;
        if (!expanded && gpList.children.length === 0) {
          await fyllGravplatsLista(kg, kv, gpList);
        }
      });
      kvWrap.appendChild(kvBtn);
      kvWrap.appendChild(gpList);
      li.appendChild(kvWrap);
      ul.appendChild(li);
    });
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', !expanded);
      ul.hidden = expanded;
    });
    div.appendChild(btn);
    div.appendChild(ul);
    container.appendChild(div);
  });
}

/** Fyller en ul.trad-gravplats-list med gravplatser för kyrkogård+kvarter (hämtar vid behov, cachar). */
async function fyllGravplatsLista(kyrkogard, kvarter, listEl) {
  const cacheKey = `${kyrkogard}\n${kvarter}`;
  if (!state.gravplatserTradCache[cacheKey]) {
    try {
      const params = new URLSearchParams({ kyrkogard: kyrkogard, kvarter: kvarter });
      const res = await fetch(`${API}/gravplatser?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      state.gravplatserTradCache[cacheKey] = sorteradLista(data.gravplatser || []);
    } catch (e) {
      state.gravplatserTradCache[cacheKey] = [];
    }
  }
  const lista = state.gravplatserTradCache[cacheKey];
  listEl.innerHTML = '';
  lista.forEach((gp, idx) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'trad-gravplats-btn';
    btn.textContent = gp.gravplatsnummer || gp.fullstandigt || `#${idx + 1}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      valjGravplats(kyrkogard, kvarter, lista, idx);
    });
    li.appendChild(btn);
    listEl.appendChild(li);
  });
}

/** Välj en specifik gravplats från trädet – navigera till visaren för den gravplatsen. */
function valjGravplats(kyrkogard, kvarter, lista, index) {
  const gp = lista[Math.max(0, Math.min(index, lista.length - 1))];
  if (!gp) return;
  const slug = slugForGravplats(gp);
  if (slug) window.location.href = '/gravplatser/' + slug;
}

function valjKvarter(kyrkogard, kvarter) {
  state.valdKyrkogard = kyrkogard;
  state.valdKvarter = kvarter;
  const tradVy = document.getElementById('gp-trad-vy');
  tradVy.hidden = true;
  tradVy.classList.remove('gravplatser-trad-panel');
  document.getElementById('gp-innehall').hidden = false;
  laddaGravplatserForKvarter();
}

function toggleTradMeny() {
  const tradVy = document.getElementById('gp-trad-vy');
  if (!tradVy) return;
  if (!state.valdKyrkogard) return; // bara när vi redan har valt kvarter
  const skaVisa = tradVy.hidden;
  tradVy.hidden = !skaVisa;
  if (skaVisa) {
    tradVy.classList.add('gravplatser-trad-panel');
  } else {
    tradVy.classList.remove('gravplatser-trad-panel');
  }
}

async function laddaGravplatserForKvarter(targetGravplatsnummer, tillSista) {
  if (!state.valdKyrkogard || !state.valdKvarter) return;
  const innehall = document.getElementById('gp-innehall');
  try {
    const params = new URLSearchParams({ kyrkogard: state.valdKyrkogard, kvarter: state.valdKvarter });
    const res = await fetch(`${API}/gravplatser?${params}`, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.gravplatserLista = sorteradLista(data.gravplatser || []);
    if (targetGravplatsnummer != null && targetGravplatsnummer !== '') {
      const idx = state.gravplatserLista.findIndex(
        (g) => (g.gravplatsnummer || '').trim() === String(targetGravplatsnummer).trim()
      );
      state.currentIndex = idx >= 0 ? idx : 0;
    } else if (tillSista && state.gravplatserLista.length > 0) {
      state.currentIndex = state.gravplatserLista.length - 1;
    } else {
      state.currentIndex = 0;
    }
    await uppdateraVy();
  } catch (e) {
    state.gravplatserLista = [];
    if (innehall) {
      const rubrik = innehall.querySelector('#gp-rubrik');
      if (rubrik) rubrik.textContent = 'Kunde inte ladda gravplatser.';
    }
    document.title = 'Gravplatser';
  }
}

/**
 * Hämtar info om huruvida gravplatsen ingår i ett pågående batch-jobb och visar banner om så är fallet.
 */
async function hamtaBatchPagarInfo() {
  state._gravplatsHarBatchPagar = false;
  const banner = document.getElementById('gp-batch-pagar-banner');
  if (banner) { banner.hidden = true; banner.innerHTML = ''; }
  if (state.currentGravplatsId == null) return;
  try {
    const [batchRes, settingsRes] = await Promise.all([
      fetch(`${API}/batch-claude/gravplats/${state.currentGravplatsId}/pagar`, { credentials: 'include' }),
      fetch(`${API}/settings/api-keys`, { credentials: 'include' }),
    ]);
    if (settingsRes.ok) {
      const s = await settingsRes.json();
      state._claudeBatchBlockEnskild = s.claude_batch_block_enskild !== false;
    }
    if (!batchRes.ok) return;
    const data = await batchRes.json();
    if (!data.pagar) return;
    state._gravplatsHarBatchPagar = true;
    // Uppdatera knappens tillstånd
    ['gp-claude-ocr-btn', 'gp-lokal-ocr-btn'].forEach((id) => {
      const ocrBtn = document.getElementById(id);
      if (ocrBtn) ocrBtn.disabled = state._claudeBatchBlockEnskild;
    });
    if (banner) {
      const datum = data.skapad_den
        ? new Date(data.skapad_den).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })
        : '';
      const jobbLank = document.createElement('a');
      jobbLank.href = '/batch-ai';
      jobbLank.textContent = data.jobb_namn || ('Jobb ' + data.jobb_id);
      banner.appendChild(document.createTextNode('Gravplatsen ingår i batch-jobbet '));
      banner.appendChild(jobbLank);
      if (datum) banner.appendChild(document.createTextNode(` (startat ${datum})`));
      banner.appendChild(document.createTextNode(' och väntar på svar från Anthropic.'));
      banner.hidden = false;
    }
  } catch (_) { /* nätverksfel – visa ingenting */ }
}
