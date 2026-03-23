/**
 * Gravregister – Rapportfunktioner (utskrift).
 * Extraherat från gravplatser.js. Laddas före gravplatser.js.
 */

function buildRapportInmatningHtml(d, rubrik, skissDataUrlsParam) {
  if (!d) return '';
  const v = (x) => (x != null && String(x).trim() !== '' ? esc(String(x).trim()) : '');
  const radOmFyllt = (label, value) => {
    const val = value != null && String(value).trim() !== '' ? String(value).trim() : '';
    if (!val) return '';
    return `<div class="gp-las-rad"><span class="gp-las-label">${esc(label)}</span><span class="gp-las-varde">${esc(val)}</span></div>`;
  };
  let html = `<h2>${esc(rubrik || 'Gravplats')}</h2>`;

  const inv = d.innehavare || [];
  if (inv.length > 0) {
    html += '<div class="gp-rapport-sektion"><h3>Gravrättsinnehavare</h3><ul class="gp-las-lista">';
    html += inv.map((i) => {
      const namn = [v(i.fornamn), v(i.efternamn)].filter(Boolean).join(' ') || '';
      const rader = radOmFyllt('Namn', namn) + radOmFyllt('Yrke', i.yrke) + radOmFyllt('Gatuadress', i.gatuadress || i.adress || '') + radOmFyllt('Postnummer / ort', [i.postnummer, i.postort].filter(Boolean).join(' ').trim() || null) + radOmFyllt('Kommentar', i.kommentar);
      return `<li class="gp-las-kort">${rader || '<span class="gp-las-tom">—</span>'}</li>`;
    }).join('') + '</ul></div>';
  }

  const na = d.narmast_anhoriga || [];
  if (na.length > 0) {
    html += '<div class="gp-rapport-sektion"><h3>Närmast anhöriga</h3><ul class="gp-las-lista">';
    html += na.map((n) => {
      const namn = [v(n.fornamn), v(n.efternamn)].filter(Boolean).join(' ') || '';
      const postOrt = [n.postnummer, n.postort].filter(Boolean).join(' ').trim();
      const rader = radOmFyllt('Namn', namn) + radOmFyllt('Yrke', n.yrke) + radOmFyllt('Gatuadress', n.adress) + radOmFyllt('Postnummer / ort', postOrt || null) + radOmFyllt('Telefon', n.telefon) + radOmFyllt('Kommentar', n.kommentar);
      return `<li class="gp-las-kort">${rader || '<span class="gp-las-tom">—</span>'}</li>`;
    }).join('') + '</ul></div>';
  }

  const raderGp = radOmFyllt('Underhåll inbetalt för all framtid den', d.underhall_text) +
    (d.underhall_overstruket ? '<div class="gp-las-rad"><span class="gp-las-label"></span><span class="gp-las-varde">"För all framtid" överstruket</span></div>' : '') +
    radOmFyllt('Gravrättstid', d.gravrattstid) + radOmFyllt('Monument', d.monument) + radOmFyllt('Gravens utformning', d.gravens_utformning);
  const ovrigt = radOmFyllt('Utfärdat den', formatUtfordatDenForDisplay(d.utfordat_den)) + radOmFyllt('Kommentar', d.kommentar) + radOmFyllt('Karta nr', d.karta_nr) + radOmFyllt('Gravbrev nr', d.gravbrev_nr);
  if (raderGp || ovrigt) {
    html += '<div class="gp-rapport-sektion"><h3>Gravplatsen</h3><div class="gp-inmatning-las">' + raderGp + (ovrigt ? '<h4 class="gp-inmatning-delrubrik">Övrigt</h4>' + ovrigt : '') + '</div></div>';
  }

  const skisser = d.skisser || [];
  const storlek = radOmFyllt('Storlek', d.storlek);
  const skissDataUrls = typeof skissDataUrlsParam !== 'undefined' ? skissDataUrlsParam : [];
  let skissHtml = storlek || '';
  if (skissDataUrls.length > 0) {
    skissHtml += '<div class="gp-rapport-skisser">';
    skissDataUrls.forEach((dataUrl, i) => {
      if (dataUrl) skissHtml += '<figure class="gp-rapport-skiss-fig"><img src="' + (dataUrl.replace(/"/g, '&quot;')) + '" alt="Skiss" /><figcaption>' + (i + 1) + '</figcaption></figure>';
    });
    skissHtml += '</div>';
  }
  html += '<div class="gp-rapport-sektion"><h3>Skiss och gravplatsstorlek</h3><div class="gp-inmatning-las">' + skissHtml + '</div></div>';

  const gs = d.gravsatta || [];
  if (gs.length > 0) {
    html += '<div class="gp-rapport-sektion"><h3>Gravsatta</h3><ul class="gp-las-lista">';
    html += gs.map((g, idx) => {
      const namn = [v(g.fornamn), v(g.efternamn)].filter(Boolean).join(' ') || '';
      const fodelse = formatDatum(g.fodelse_ar, g.fodelse_manad, g.fodelse_dag);
      const dods = formatDatum(g.dods_ar, g.dods_manad, g.dods_dag);
      let li = `<li class="gp-las-kort"><h4 class="gp-inmatning-delrubrik">Gravsatt ${idx + 1}</h4>`;
      if (g.ar_beteckning) li += radOmFyllt('Beteckning', g.efternamn);
      else li += radOmFyllt('Namn', namn);
      li += radOmFyllt('Yrke', g.yrke) + radOmFyllt('Gatuadress', g.gatuadress || g.adress || '') + radOmFyllt('Postnummer / ort', [g.postnummer, g.postort].filter(Boolean).join(' ').trim() || null) + radOmFyllt('Födelsedatum', fodelse) + radOmFyllt('Födelsenummer', g.fod_nr) + radOmFyllt('Dödsdatum', dods) + radOmFyllt('Db. nummer', g.dodsbok_nr) + radOmFyllt('Gravsatt den', g.gravsatt_den) + radOmFyllt('Urna/Kista', g.urna) + radOmFyllt('Kommentar', g.kommentar) + '</li>';
      return li;
    }).join('') + '</ul></div>';
  }
  return html;
}

function openRapportModal() {
  const modal = document.getElementById('gp-rapport-modal');
  if (!modal) return;
  modal.hidden = false;
}

function preloadRapportImages(container) {
  const imgs = container.querySelectorAll('img[src]');
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(Array.from(imgs).map((img) => {
    return new Promise((resolve) => {
      if (img.complete && img.naturalWidth) return resolve();
      img.onload = resolve;
      img.onerror = resolve;
    });
  }));
}

async function skapaRapportUtskrift() {
  const modal = document.getElementById('gp-rapport-modal');
  const container = document.getElementById('gp-rapport-utskrift');
  if (!modal || !container) return;
  const medSektioner = document.getElementById('gp-rapport-sektioner')?.checked === true;
  const medHela = document.getElementById('gp-rapport-hela')?.checked === true;
  const medDolda = document.getElementById('gp-rapport-dolda')?.checked === true;
  const medExtramaterial = document.getElementById('gp-rapport-extramaterial')?.checked === true;

  const gp = state.gravplatserLista[state.currentIndex];
  if (!gp || state.currentGravplatsId == null) {
    showToast('Ingen gravplats vald.', 'info');
    return;
  }
  const mappNamn = gp.mapp_namn;
  const rubrik = gp.fullstandigt || [gp.kyrkogard, gp.kvarter, gp.gravplatsnummer].filter(Boolean).join(' ') || '–';

  const ok = await ensureInmatningData();
  if (!ok) {
    showToast('Kunde inte ladda transkriberad information.', 'fel');
    return;
  }

  const skisser = (state.inmatningData && state.inmatningData.skisser) || [];
  let skissDataUrls = [];
  if (skisser.length > 0) {
    skissDataUrls = await Promise.all(skisser.map((s) => loadSkissFullRes(s).catch(() => null)));
  }

  const params = new URLSearchParams();
  if (gp.kyrkogard) params.set('kyrkogard', gp.kyrkogard);
  if (gp.kvarter) params.set('kvarter', gp.kvarter);
  if (gp.gravplatsnummer) params.set('gravplatsnummer', gp.gravplatsnummer);
  let halvorData;
  try {
    const halvorRes = await fetch(`${API}/mappar/${encodeURIComponent(mappNamn)}/gravplats/halvor?${params}`, { credentials: 'include' });
    if (!halvorRes.ok) throw new Error('Kunde inte hämta bilder');
    halvorData = await halvorRes.json();
  } catch (e) {
    showToast('Kunde inte hämta gravplatsbilder: ' + (e.message || 'nätverksfel'), 'fel');
    return;
  }

  const halvor = halvorData.halvor || [];
  const extramaterial = halvorData.extramaterial || [];
  const dolda = halvorData.dolda || [];
  const config = halvorData.config || {};
  const delaSidor = config.dela_sidor || 'hojdled';
  const cacheQ = `_v=${state.cacheBust}`;
  const base = `${API}/mappar/${encodeURIComponent(mappNamn)}/sida`;
  const split1och3 = (727 / 1597).toFixed(4);
  const split2 = (870 / 1595).toFixed(4);
  const startSida = halvorData.gravplats?.start_sida ?? gp.start_sida ?? null;

  const halvorMedUrl = halvor.map((h) => {
    let halvaUrl, helaUrl;
    if (h.redan_halva && h.filnamn) {
      halvaUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/fil/${encodeURIComponent(h.filnamn)}/bild?${cacheQ}`;
      helaUrl = halvaUrl;
    } else {
      helaUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/sida/${h.content_sida}?${cacheQ}`;
      if (delaSidor === 'ingen') {
        halvaUrl = helaUrl;
      } else if (h.segment_index != null) {
        halvaUrl = `${base}/${h.content_sida}/halva?offset=0&segment=${h.segment_index}&${cacheQ}`;
        if (h.position != null && h.position >= 1 && h.position <= 3) {
          halvaUrl += `&position=${h.position}`;
        }
      } else {
        const pos = h.content_sida - (startSida || 0);
        const split = pos === 1 ? split2 : split1och3;
        halvaUrl = `${base}/${h.content_sida}/halva?offset=0&halva=${h.halva}&split=${split}&${cacheQ}`;
      }
    }
    return { halvaUrl, helaUrl };
  });

  let html = '';
  const headerRubrik = esc(rubrik);
  html += '<div class="gp-rapport-sida-1"><div class="gp-rapport-print-header" aria-hidden="true">' + headerRubrik + '</div>' + buildRapportInmatningHtml(state.inmatningData, rubrik, skissDataUrls) + '</div>';

  if (medSektioner && halvorMedUrl.length > 0) {
    html += '<div class="gp-rapport-sida-sektioner"><h3 class="gp-rapport-sektion-rubrik">Gravplatsbilder (sektioner)</h3><div class="gp-rapport-sektioner">';
    halvorMedUrl.forEach((x) => {
      html += `<figure><img src="${esc(x.halvaUrl)}" alt="" /></figure>`;
    });
    html += '</div></div>';
  }
  if (medHela && halvorMedUrl.length > 0) {
    html += '<div class="gp-rapport-hela-sidor"><h3 class="gp-rapport-hela-sidor-rubrik">Fullständiga inskanningar</h3>';
    halvorMedUrl.forEach((x) => {
      html += `<div class="gp-rapport-hela-sida-sida"><figure><img src="${esc(x.helaUrl)}" alt="" /></figure></div>`;
    });
    html += '</div>';
  }

  if (medExtramaterial && extramaterial.length > 0) {
    html += '<div class="gp-rapport-extramaterial gp-rapport-bilder-section"><h3>Extramaterial</h3><div class="gp-rapport-bilder-grid">';
    extramaterial.forEach((em) => {
      const bildUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/fil/${encodeURIComponent(em.filnamn)}/bild?${cacheQ}`;
      const cap = (em.kommentar || em.filnamn || '').trim() ? `<figcaption>${esc(em.kommentar || em.filnamn)}</figcaption>` : '';
      html += `<figure><img src="${esc(bildUrl)}" alt="${esc(em.filnamn)}" />${cap}</figure>`;
    });
    html += '</div></div>';
  }

  if (medDolda && dolda.length > 0) {
    html += '<div class="gp-rapport-dolda gp-rapport-bilder-section"><h3>Dolda bilder</h3><div class="gp-rapport-bilder-grid">';
    dolda.forEach((item) => {
      let bildUrl;
      if (item.type === 'halva' && item.content_sida != null) {
        if (item.segment_index != null) {
          bildUrl = `${base}/${item.content_sida}/halva?offset=0&segment=${item.segment_index}&${cacheQ}`;
          if (item.position != null && item.position >= 1 && item.position <= 3) {
            bildUrl += `&position=${item.position}`;
          }
        } else if (item.halva != null) {
          const pos = startSida != null ? item.content_sida - startSida : 0;
          const split = pos === 1 ? split2 : split1och3;
          bildUrl = `${base}/${item.content_sida}/halva?offset=0&halva=${encodeURIComponent(item.halva)}&split=${split}&${cacheQ}`;
        } else {
          bildUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/sida/${item.content_sida}?${cacheQ}`;
        }
      } else {
        bildUrl = `${API}/mappar/${encodeURIComponent(mappNamn)}/fil/${encodeURIComponent(item.filnamn)}/bild?${cacheQ}`;
      }
      const cap = item.filnamn ? `<figcaption>${esc(item.filnamn)}</figcaption>` : '';
      html += `<figure><img src="${esc(bildUrl)}" alt="" />${cap}</figure>`;
    });
    html += '</div></div>';
  }

  container.innerHTML = html;
  container.hidden = false;
  modal.hidden = true;

  await preloadRapportImages(container);
  window.print();
  container.hidden = true;
  container.innerHTML = '';
}
