/**
 * Gravplatsvyn: Skisser: källbild, miniatyrer, skissförslag och skissmodalen.
 * Laddas före gravplatser.js och delar dess globala state.
 */

/** Returnerar källbild-URL för en skiss (halva eller extramaterial). */
function getSkissKallaUrl(s) {
  if (!s) return null;
  const cacheQ = `_v=${state.cacheBust}`;
  const mapp = state.currentExtramaterialMapp;
  if (!mapp) return null;
  if (s.source_type === 'halva' && s.content_sida != null && s.halva) {
    const base = `${API}/mappar/${encodeURIComponent(mapp)}/sida`;
    const offsetQ = 'offset=0';
    // Matcha mot samma halva som gravplatsvyn (segment + position) så att skissen pekar på rätt bild
    const halvor = state.currentHalvorList || [];
    const seg = s.segment_index != null ? s.segment_index : (s.halva === 'ovre' ? 0 : 1);
    const match = halvor.find((h) => h.content_sida === s.content_sida && (h.segment_index != null ? h.segment_index === seg : (h.halva === s.halva)));
    if (match && match.segment_index != null) {
      let url = `${base}/${s.content_sida}/halva?${offsetQ}&segment=${match.segment_index}&${cacheQ}`;
      if (match.position != null && match.position >= 1 && match.position <= 3) url += `&position=${match.position}`;
      return url;
    }
    // Fallback för gamla skisser eller när halvor inte laddats: använd halva + split
    const start = state.currentGravplatsStartSida != null ? state.currentGravplatsStartSida : 0;
    const pos = s.content_sida - start;
    const split1och3 = (727 / 1597).toFixed(4);
    const split2 = (870 / 1595).toFixed(4);
    const split = pos === 1 ? split2 : split1och3;
    return `${base}/${s.content_sida}/halva?${offsetQ}&halva=${encodeURIComponent(s.halva)}&split=${split}&${cacheQ}`;
  }
  if (s.source_type === 'extramaterial' && s.extramaterial_id != null) {
    const em = (state.currentExtramaterial || []).find((e) => e.id === s.extramaterial_id);
    if (em && em.filnamn) return `${API}/mappar/${encodeURIComponent(mapp)}/fil/${encodeURIComponent(em.filnamn)}/bild?${cacheQ}`;
  }
  return null;
}

/** Rita skissens crop i en container (img eller canvas med crop). */
function renderSkissCropMiniatyr(container, s) {
  if (!container || !s) return;
  const url = getSkissKallaUrl(s);
  if (!url) {
    container.innerHTML = '<span class="gp-skiss-miniatyr-placeholder">—</span>';
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const x = (s.x ?? 0) * w;
    const y = (s.y ?? 0) * h;
    const sw = Math.max(1, (s.width ?? 0) * w);
    const sh = Math.max(1, (s.height ?? 0) * h);
    const maxSize = 120;
    const cw = sw >= sh ? maxSize : Math.round(maxSize * (sw / sh));
    const ch = sh >= sw ? maxSize : Math.round(maxSize * (sh / sw));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, cw);
    canvas.height = Math.max(1, ch);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, x, y, sw, sh, 0, 0, canvas.width, canvas.height);
      container.innerHTML = '';
      const thumb = document.createElement('img');
      thumb.src = canvas.toDataURL('image/png');
      thumb.alt = 'Skiss';
      thumb.className = 'gp-skiss-miniatyr-img';
      container.appendChild(thumb);
    }
  };
  img.onerror = () => {
    container.innerHTML = '<span class="gp-skiss-miniatyr-placeholder">Kunde inte ladda</span>';
  };
  img.src = url;
}

/** Drag-and-drop för skisser (ändra ordning). */
function bindSkissDragDrop(container) {
  if (!container) return;
  container.querySelectorAll('.gp-skiss-drag-handle').forEach((handle) => {
    const rad = handle.closest('.gp-skiss-rad');
    if (!rad) return;
    handle.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', rad.dataset.skissId || '');
      e.dataTransfer.effectAllowed = 'move';
      rad.classList.add('gp-skiss-dragging');
    });
    handle.addEventListener('dragend', () => rad.classList.remove('gp-skiss-dragging'));
  });
  container.querySelectorAll('.gp-skiss-rad').forEach((rad) => {
    rad.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.gp-skiss-drag-over').forEach((r) => r.classList.remove('gp-skiss-drag-over'));
      if (!rad.classList.contains('gp-skiss-dragging')) rad.classList.add('gp-skiss-drag-over');
    });
    rad.addEventListener('dragleave', () => rad.classList.remove('gp-skiss-drag-over'));
    rad.addEventListener('drop', async (e) => {
      e.preventDefault();
      rad.classList.remove('gp-skiss-drag-over');
      const fromId = e.dataTransfer.getData('text/plain');
      const fromRad = container.querySelector(`.gp-skiss-rad[data-skiss-id="${fromId}"]`);
      if (!fromRad || fromRad === rad || state.currentGravplatsId == null) return;
      const rader = Array.from(container.querySelectorAll('.gp-skiss-rad'));
      const ids = rader.map((r) => parseInt(r.dataset.skissId, 10)).filter((n) => !isNaN(n));
      const fromIdx = ids.indexOf(parseInt(fromId, 10));
      const toIdx = ids.indexOf(parseInt(rad.dataset.skissId, 10));
      if (fromIdx === -1 || toIdx === -1) return;
      const newIds = [...ids];
      newIds.splice(fromIdx, 1);
      newIds.splice(toIdx, 0, ids[fromIdx]);
      const res = await fetch(`${API}/gravplats/${state.currentGravplatsId}/skisser/ordning`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skiss_ids: newIds }),
        credentials: 'include',
      });
      if (res.ok) {
        await ensureInmatningData();
        renderInmatningSektion('skiss');
      }
    });
  });
}

/** Öppna modal för att lägga till skiss: välj bild, markera område, spara. */
/**
 * Visa ett förslag på skissmarkering (bildmätning i app/utils/skissforslag.py) för en grav
 * utan skiss. "Använd förslaget" sparar direkt, "Justera" öppnar markeringen med förslaget inritat.
 */
async function visaSkissforslag(el) {
  if (!el || state.currentGravplatsId == null) return;
  const gpId = state.currentGravplatsId;
  let forslag = null;
  try {
    const res = await fetch(`${API}/gravplats/${gpId}/skissforslag`, { credentials: 'include' });
    if (!res.ok || gpId !== state.currentGravplatsId) return;
    forslag = (await res.json()).forslag;
  } catch (e) { return; }
  if (!forslag || !el.isConnected) return;
  const ruta = forslag.ruta === 'mitten' ? 'mittrutan' : 'vänstra rutan';
  el.innerHTML = `
    <div class="gp-skissforslag-rubrik">Förslag på skiss: ${ruta}</div>
    ${forslag.sakerhet === 'kanske' ? '<div class="gp-skissforslag-kanske">Svagt bläck i rutan. Kontrollera att det verkligen är en skiss.</div>' : ''}
    <div class="gp-skiss-miniatyr gp-skissforslag-miniatyr"></div>
    <div class="gp-skissforslag-knappar">
      <button type="button" class="gp-skissforslag-anvand">Använd förslaget</button>
      <button type="button" class="gp-skissforslag-justera">Justera</button>
    </div>`;
  el.hidden = false;
  renderSkissCropMiniatyr(el.querySelector('.gp-skissforslag-miniatyr'), forslag);
  el.querySelector('.gp-skissforslag-anvand').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const ok = await sparaSkiss({ ...forslag, position: null });
    if (!ok) e.target.disabled = false;
  });
  el.querySelector('.gp-skissforslag-justera').addEventListener('click', () => {
    oppnaSkissModal({ kalla: { ...forslag, url: getSkissKallaUrl(forslag) },
                      rect: { x: forslag.x, y: forslag.y, w: forslag.width, h: forslag.height } });
  });
}

/** Spara en skiss och rita om skissektionen. Svarar true om det gick. */
async function sparaSkiss(skiss) {
  const res = await fetch(`${API}/gravplats/${state.currentGravplatsId}/skisser`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({
      source_type: skiss.source_type, content_sida: skiss.content_sida ?? null, halva: skiss.halva ?? null,
      segment_index: skiss.segment_index ?? null, position: skiss.position ?? null,
      extramaterial_id: skiss.extramaterial_id ?? null, x: skiss.x, y: skiss.y, width: skiss.width, height: skiss.height,
    }),
  }).catch(() => null);
  if (!res || !res.ok) { showToast('Kunde inte spara skiss.', 'fel'); return false; }
  const savedInmatning = state.inmatningData ? { ...state.inmatningData } : null;
  state.lastInmatningGravplatsId = null;
  await ensureInmatningData();
  if (savedInmatning && state.inmatningData) {
    Object.assign(state.inmatningData, { ...savedInmatning, skisser: state.inmatningData.skisser });
  }
  renderInmatningSektion('skiss');
  return true;
}

function oppnaSkissModal(forval) {
  const modal = document.getElementById('gp-skiss-modal');
  const rubrik = document.getElementById('gp-skiss-modal-rubrik');
  const bilderEl = document.getElementById('gp-skiss-modal-bilder');
  const markeraEl = document.getElementById('gp-skiss-modal-markera');
  const imgEl = document.getElementById('gp-skiss-modal-img');
  const rectEl = document.getElementById('gp-skiss-modal-rect');
  const cacheQ = `_v=${state.cacheBust}`;
  const mapp = state.currentExtramaterialMapp;
  if (!modal || !bilderEl || !markeraEl || !imgEl || !rectEl || !mapp || state.currentGravplatsId == null) return;

  let valdKalla = null; // { source_type, content_sida?, halva?, extramaterial_id?, url }

  function visaSteg1() {
    markeraEl.hidden = true;
    bilderEl.hidden = false;
    rubrik.textContent = 'Välj bild att markera skiss på';
    bilderEl.innerHTML = '';
    (state.currentHalvorList || []).forEach((h, i) => {
      let url;
      if (h.redan_halva && h.filnamn) {
        url = `${API}/mappar/${encodeURIComponent(mapp)}/fil/${encodeURIComponent(h.filnamn)}/bild?${cacheQ}`;
      } else {
        const base = `${API}/mappar/${encodeURIComponent(mapp)}/sida`;
        const offsetQ = 'offset=0';
        if (h.segment_index != null) {
          url = `${base}/${h.content_sida}/halva?${offsetQ}&segment=${h.segment_index}&${cacheQ}`;
          if (h.position != null && h.position >= 1 && h.position <= 3) url += `&position=${h.position}`;
        } else {
          const start = state.currentGravplatsStartSida != null ? state.currentGravplatsStartSida : 0;
          const pos = (h.content_sida || 0) - start;
          const split = pos === 1 ? (870 / 1595).toFixed(4) : (727 / 1597).toFixed(4);
          url = `${base}/${h.content_sida}/halva?${offsetQ}&halva=${encodeURIComponent(h.halva)}&split=${split}&${cacheQ}`;
        }
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gp-skiss-modal-bild';
      btn.innerHTML = `<img src="${url}" alt="" /><span>Sida ${h.content_sida || ''} ${h.halva || ''} ${h.filnamn || ''}</span>`;
      btn.addEventListener('click', () => {
        valdKalla = {
          source_type: 'halva',
          content_sida: h.content_sida,
          halva: h.halva,
          segment_index: h.segment_index,
          position: h.position,
          url,
        };
        visaSteg2();
      });
      bilderEl.appendChild(btn);
    });
    (state.currentExtramaterial || []).forEach((em) => {
      const url = `${API}/mappar/${encodeURIComponent(mapp)}/fil/${encodeURIComponent(em.filnamn)}/bild?${cacheQ}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gp-skiss-modal-bild';
      btn.innerHTML = `<img src="${url}" alt="" /><span>${em.filnamn}</span>`;
      btn.addEventListener('click', () => {
        valdKalla = { source_type: 'extramaterial', extramaterial_id: em.id, url };
        visaSteg2();
      });
      bilderEl.appendChild(btn);
    });
    setAvbrytHandler();
  }

  function visaSteg2() {
    if (!valdKalla || !valdKalla.url) return;
    bilderEl.hidden = true;
    markeraEl.hidden = false;
    rubrik.textContent = 'Markera skissområde';
    imgEl.draggable = false;
    imgEl.ondragstart = (e) => e.preventDefault();
    imgEl.src = valdKalla.url;
    rectEl.style.display = 'none';
    rectEl.style.left = rectEl.style.top = rectEl.style.width = rectEl.style.height = '';

    let dragStart = null;
    let currentRect = forval && forval.rect ? { ...forval.rect } : { x: 0, y: 0, w: 0, h: 0 };

    function updateRectEl() {
      const ir = imgEl.getBoundingClientRect();
      const wr = imgEl.parentElement?.getBoundingClientRect();
      if (!wr) return;
      rectEl.style.left = (currentRect.x * ir.width + (ir.left - wr.left)) + 'px';
      rectEl.style.top = (currentRect.y * ir.height + (ir.top - wr.top)) + 'px';
      rectEl.style.width = (currentRect.w * ir.width) + 'px';
      rectEl.style.height = (currentRect.h * ir.height) + 'px';
      rectEl.style.display = currentRect.w > 0 && currentRect.h > 0 ? 'block' : 'none';
    }

    // Markeringen kan ritas ny, flyttas (dra inuti) eller ändras sida för sida (dra i kant eller hörn).
    // Pekarhändelser, så det fungerar med mus, penna och finger. Hanterarna sätts (inte läggs till),
    // så de inte samlas på hög när modalen öppnas flera gånger.
    if (!rectEl.querySelector('.gp-skiss-handtag')) {
      ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((pos) => {
        const h = document.createElement('span');
        h.className = 'gp-skiss-handtag gp-skiss-handtag-' + pos;
        rectEl.appendChild(h);
      });
    }
    const GREPP_PX = 10;
    let lage = null;  // { typ: 'ny'|'flytta'|'kant', kanter: {l,r,t,b}, start: {x,y}, fran: {...rect} }

    function punkt(e) {
      const ir = imgEl.getBoundingClientRect();
      return { x: (e.clientX - ir.left) / ir.width, y: (e.clientY - ir.top) / ir.height, ir: ir };
    }
    function traff(p, grepp) {
      if (currentRect.w <= 0 || currentRect.h <= 0) return null;
      const gx = (grepp || GREPP_PX) / p.ir.width, gy = (grepp || GREPP_PX) / p.ir.height;
      const r = currentRect;
      const inomY = p.y >= r.y - gy && p.y <= r.y + r.h + gy;
      const inomX = p.x >= r.x - gx && p.x <= r.x + r.w + gx;
      const kanter = {
        l: inomY && Math.abs(p.x - r.x) <= gx,
        r: inomY && Math.abs(p.x - (r.x + r.w)) <= gx,
        t: inomX && Math.abs(p.y - r.y) <= gy,
        b: inomX && Math.abs(p.y - (r.y + r.h)) <= gy,
      };
      if (kanter.l || kanter.r || kanter.t || kanter.b) return { typ: 'kant', kanter: kanter };
      if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return { typ: 'flytta' };
      return null;
    }
    function markor(t) {
      if (!t) return 'crosshair';
      if (t.typ === 'flytta') return 'move';
      const k = t.kanter;
      if ((k.l && k.t) || (k.r && k.b)) return 'nwse-resize';
      if ((k.r && k.t) || (k.l && k.b)) return 'nesw-resize';
      return k.l || k.r ? 'ew-resize' : 'ns-resize';
    }
    const klamp = (v) => Math.max(0, Math.min(1, v));

    imgEl.onload = () => {
      const wrap = imgEl.parentElement;
      if (!wrap) return;
      wrap.style.touchAction = 'none';
      updateRectEl();  // ett förslag syns direkt och kan justeras
      wrap.onpointerdown = (e) => {
        if (e.target !== imgEl && e.target !== rectEl && e.target !== wrap && !rectEl.contains(e.target)) return;
        e.preventDefault();
        const p = punkt(e);
        const t = traff(p, e.pointerType === 'touch' ? 2 * GREPP_PX : GREPP_PX);
        lage = t ? { ...t, start: { x: p.x, y: p.y }, fran: { ...currentRect } } : { typ: 'ny', start: { x: p.x, y: p.y } };
        if (lage.typ === 'ny') { currentRect = { x: p.x, y: p.y, w: 0, h: 0 }; updateRectEl(); }
        try { wrap.setPointerCapture(e.pointerId); } catch (_) { /* äldre webbläsare */ }
      };
      wrap.onpointermove = (e) => {
        const p = punkt(e);
        if (!lage) { wrap.style.cursor = markor(traff(p)); return; }
        e.preventDefault();
        if (lage.typ === 'ny') {
          const nx = klamp(p.x), ny = klamp(p.y);
          currentRect = { x: Math.min(lage.start.x, nx), y: Math.min(lage.start.y, ny), w: Math.abs(nx - lage.start.x), h: Math.abs(ny - lage.start.y) };
        } else if (lage.typ === 'flytta') {
          const f = lage.fran;
          currentRect = { x: klamp(Math.min(1 - f.w, f.x + p.x - lage.start.x)), y: klamp(Math.min(1 - f.h, f.y + p.y - lage.start.y)), w: f.w, h: f.h };
        } else {
          const f = lage.fran, k = lage.kanter;
          let x0 = f.x, y0 = f.y, x1 = f.x + f.w, y1 = f.y + f.h;
          if (k.l) x0 = klamp(p.x);
          if (k.r) x1 = klamp(p.x);
          if (k.t) y0 = klamp(p.y);
          if (k.b) y1 = klamp(p.y);
          currentRect = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
        }
        updateRectEl();
      };
      const slapp = () => { lage = null; };
      wrap.onpointerup = slapp;
      wrap.onpointercancel = slapp;
    };

    document.getElementById('gp-skiss-spara').onclick = async () => {
      if (currentRect.w < 0.01 || currentRect.h < 0.01) {
        showToast('Markera ett område genom att dra på bilden.', 'info');
        return;
      }
      const body = {
        source_type: valdKalla.source_type,
        content_sida: valdKalla.content_sida ?? null,
        halva: valdKalla.halva ?? null,
        segment_index: valdKalla.segment_index ?? null,
        position: valdKalla.position ?? null,
        extramaterial_id: valdKalla.extramaterial_id ?? null,
        x: currentRect.x,
        y: currentRect.y,
        width: currentRect.w,
        height: currentRect.h,
      };
      const sparaBtn = document.getElementById('gp-skiss-spara');
      if (sparaBtn) sparaBtn.disabled = true;
      let res;
      try {
        res = await fetch(`${API}/gravplats/${state.currentGravplatsId}/skisser`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'include',
        });
      } finally {
        if (sparaBtn) sparaBtn.disabled = false;
      }
      if (!res.ok) {
        showToast('Kunde inte spara skiss.', 'fel');
        return;
      }
      modal.hidden = true;
      const savedInmatning = state.inmatningData ? { ...state.inmatningData } : null;
      state.lastInmatningGravplatsId = null;
      await ensureInmatningData();
      if (savedInmatning && state.inmatningData) {
        Object.assign(state.inmatningData, { ...savedInmatning, skisser: state.inmatningData.skisser });
      }
      renderInmatningSektion('skiss');
    };
    setAvbrytHandler();
  }

  const avbrytBtn = document.getElementById('gp-skiss-avbryt');
  function setAvbrytHandler() {
    if (!avbrytBtn) return;
    avbrytBtn.onclick = markeraEl.hidden ? () => { modal.hidden = true; } : () => visaSteg1();
  }
  if (forval && forval.kalla && forval.kalla.url) {
    valdKalla = forval.kalla;
    visaSteg2();
  } else {
    visaSteg1();
  }
  setAvbrytHandler();
  modal.hidden = false;
}
