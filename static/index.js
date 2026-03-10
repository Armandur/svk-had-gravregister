/**
 * Startsida – sök på fullständigt gravplatsnummer med lazy autocomplete.
 */

(function () {
  const API = '/api';
  let sokTimeout = null;
  let sokForslag = [];
  let aktivIndex = -1;

  const inputEl = document.getElementById('startsida-sok-input');
  const listEl = document.getElementById('startsida-sok-list');
  if (!inputEl || !listEl) return;

  (window.gpEnsureAuthPromise || gpEnsureAuth()).then(function(me) {
    if (!me) return;
    var el = document.getElementById('inloggad-anvandare');
    if (el) el.textContent = 'Inloggad som: ' + (me.username || '');
    var listvyLink = document.getElementById('startsida-listvy-lank');
    if (listvyLink) {
      if (me.is_admin) listvyLink.removeAttribute('hidden');
      else listvyLink.remove();
    }
    var adminLink = document.getElementById('startsida-admin-lank');
    if (adminLink) {
      if (me.is_admin) adminLink.removeAttribute('hidden');
      else adminLink.remove();
    }
    var loggarLink = document.getElementById('startsida-loggar-lank');
    if (loggarLink) {
      if (me.is_admin) loggarLink.removeAttribute('hidden');
      else loggarLink.remove();
    }
    var dbuhLink = document.getElementById('startsida-databasunderhall-lank');
    if (dbuhLink) {
      if (me.is_admin) dbuhLink.removeAttribute('hidden');
      else dbuhLink.remove();
    }
  });

  document.getElementById('startsida-logga-ut')?.addEventListener('click', function(e) {
    e.preventDefault();
    fetch(API + '/logout', { method: 'POST', credentials: 'include' }).then(function() {
      window.location.href = '/login';
    });
  });

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
      li.className = 'startsida-sok-item';
      li.role = 'option';
      li.id = 'startsida-sok-item-' + i;
      li.setAttribute('data-index', String(i));
      const full = (gp.fullstandigt || '').trim();
      const mapp = gp.mapp_namn ? ' (' + escapeHtml(gp.mapp_namn) + ')' : '';
      li.innerHTML = full ? '<strong>' + escapeHtml(full) + '</strong>' + (mapp ? '<small>' + mapp + '</small>' : '') : '–';
      li.addEventListener('click', function () { valjForslag(i); });
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
    listEl.querySelectorAll('.startsida-sok-item').forEach(function (el, i) {
      el.classList.toggle('startsida-sok-item-active', i === aktivIndex);
      el.setAttribute('aria-selected', i === aktivIndex);
    });
    if (aktivIndex >= 0 && sokForslag[aktivIndex]) {
      const itemEl = document.getElementById('startsida-sok-item-' + aktivIndex);
      if (itemEl) itemEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function hamtaForslag(q) {
    const t = (q || '').trim();
    if (!t) {
      visaForslag([]);
      return;
    }
    fetch(API + '/gravplatser/sok?q=' + encodeURIComponent(t) + '&limit=25', { credentials: 'include' })
      .then(function (res) { return res.json(); })
      .then(function (data) { visaForslag(data.gravplatser || []); })
      .catch(function () { visaForslag([]); });
  }

  function onInput() {
    if (sokTimeout) clearTimeout(sokTimeout);
    sokTimeout = setTimeout(function () { hamtaForslag(inputEl.value); }, 220);
  }

  function onKeydown(e) {
    if (listEl.hidden) {
      if (e.key === 'Escape') inputEl.blur();
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

  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('keydown', onKeydown);
  inputEl.addEventListener('focus', function () {
    if (inputEl.value.trim() && sokForslag.length > 0) {
      listEl.hidden = false;
      listEl.setAttribute('aria-expanded', 'true');
    }
  });

  document.addEventListener('click', function (e) {
    if (!listEl.hidden && e.target !== inputEl && !listEl.contains(e.target)) {
      listEl.hidden = true;
      listEl.setAttribute('aria-expanded', 'false');
    }
  });

  // Gå till nästa ej färdiga gravplats (ej transkriberad eller påbörjad men inte slutförd)
  const nastaBtn = document.getElementById('startsida-nasta-ej-transkriberad');
  if (nastaBtn) {
    nastaBtn.addEventListener('click', function () {
      nastaBtn.disabled = true;
      fetch(API + '/gravplatser/nasta-ej-fardig', { credentials: 'include' })
        .then(function (res) {
          if (res.status === 404) {
            alert('Ingen ej färdig gravplats hittades. Alla gravplatser är markerade som färdigtranskriberade.');
            return null;
          }
          if (!res.ok) throw new Error(res.statusText || 'Nätverksfel');
          return res.json();
        })
        .then(function (data) {
          if (data && data.fullstandigt) {
            var slug = slugFromFullstandigt(data.fullstandigt);
            if (slug) window.location.href = '/gravplatser/' + slug;
          }
        })
        .catch(function (err) {
          alert('Kunde inte hämta nästa gravplats: ' + (err.message || 'nätverksfel'));
        })
        .finally(function () {
          nastaBtn.disabled = false;
        });
    });
  }

  // Statistik
  const statListEl = document.getElementById('startsida-statistik-lista');
  const statistikSection = document.getElementById('startsida-statistik');
  if (statistikSection) {
    statistikSection.addEventListener('click', function (e) {
      var klickbar = e.target && e.target.closest('.startsida-transkriberingsstatus-kyrkogard-klickbar');
      if (!klickbar) return;
      var id = klickbar.getAttribute('aria-controls');
      var list = id ? document.getElementById(id) : null;
      if (!list) return;
      var expanded = klickbar.getAttribute('aria-expanded') === 'true';
      list.hidden = expanded;
      klickbar.setAttribute('aria-expanded', !expanded);
      var chevron = klickbar.querySelector('.startsida-transkriberingsstatus-chevron');
      if (chevron) chevron.textContent = expanded ? '\u25B6' : '\u25BC';
    });
    statistikSection.addEventListener('keydown', function (e) {
      var klickbar = e.target && e.target.closest('.startsida-transkriberingsstatus-kyrkogard-klickbar');
      if (!klickbar || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      klickbar.click();
    });
  }
  if (statListEl) {
    fetch(API + '/statistik', { credentials: 'include' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data) {
          statListEl.innerHTML = '<li><span>Kunde inte ladda statistik</span><span class="stat-varde">–</span></li>';
          return;
        }
        const rader = [
          { label: 'Antal mappar (arkivvolymer)', key: 'antal_mappar' },
          { label: 'Antal PDF:er', key: 'antal_pdf' },
          { label: 'Gravplatser som saknar kyrkogård, kvarter eller gravplatsnummer', key: 'gravplatser_saknar_kyrkogard_kvarter_eller_nummer' },
          { label: 'Gravplatser med fullständigt gravplatsnummer', key: 'gravplatser_fullstandiga' },
          { label: 'Gravplatser markerade som färdigtranskriberade', key: 'gravplatser_fardigtranskriberade' },
          { label: 'Antal extramaterial', key: 'antal_extramaterial' },
          { label: 'Antal gravrättsinnehavare', key: 'antal_innehavare' },
          { label: 'Antal närmast anhöriga', key: 'antal_narmast_anhoriga' },
          { label: 'Antal gravsatta', key: 'antal_gravsatta' },
          { label: 'Antal unika yrken', key: 'antal_unika_yrken', link: '/yrken' },
        ];
        statListEl.innerHTML = rader.map(function (r) {
          const v = data[r.key];
          const varde = typeof v === 'number' ? String(v) : '–';
          const valHtml = r.link
            ? '<a href="' + escapeHtml(r.link) + '" class="stat-varde stat-varde-lank">' + escapeHtml(varde) + '</a>'
            : '<span class="stat-varde">' + escapeHtml(varde) + '</span>';
          return '<li><span>' + escapeHtml(r.label) + '</span>' + valHtml + '</li>';
        }).join('');

        var stapelWrap = document.getElementById('startsida-statistik-stapel-wrap');
        if (stapelWrap) stapelWrap.setAttribute('hidden', '');

        var transkWrap = document.getElementById('startsida-transkriberingsstatus-wrap');
        if (transkWrap && data.transkriberingsstatus) {
          var ts = data.transkriberingsstatus;
          var total = ts.total;
          var kyrkogardar = ts.kyrkogardar || [];
          function procentStr(t, f) {
            if (typeof t !== 'number' || t <= 0) return '0';
            var fardiga = typeof f === 'number' ? f : 0;
            return String(Math.min(100, Math.round((fardiga / t) * 100)));
          }
          function barHtml(label, totalVal, fardigaVal) {
            var p = procentStr(totalVal, fardigaVal);
            var text = label + ' – ' + fardigaVal + ' av ' + totalVal + ', ' + p + '%';
            return '<div class="startsida-statistik-stapel-label">' + escapeHtml(text) + '</div>' +
              '<div class="startsida-statistik-stapel" role="img" aria-label="' + escapeHtml(p) + ' procent">' +
              '<div class="startsida-statistik-stapel-fardiga" style="width:' + p + '%"></div>' +
              '<div class="startsida-statistik-stapel-rest" style="width:' + (100 - parseInt(p, 10)) + '%"></div></div>';
          }
          var html = '<h3>Transkriberingsstatus</h3>';
          if (total && typeof total.total === 'number' && total.total > 0) {
            html += '<div class="startsida-transkriberingsstatus-rad">' +
              barHtml('Totalt', total.total, total.fardiga) + '</div>';
          }
          kyrkogardar.forEach(function (kg, kgIndex) {
            var kvarterList = kg.kvarter || [];
            var nKvarter = kvarterList.length;
            var kvarterListId = 'transk-kvarter-' + kgIndex;
            html += '<div class="startsida-transkriberingsstatus-kyrkogard-block">';
            if (nKvarter > 0) {
              html += '<div class="startsida-transkriberingsstatus-kyrkogard-klickbar startsida-transkriberingsstatus-rad startsida-transkriberingsstatus-kyrkogard" role="button" tabindex="0" aria-expanded="false" aria-controls="' + kvarterListId + '" aria-label="' + escapeHtml(kg.kyrkogard + ', klicka för att visa kvarter') + '">';
            } else {
              html += '<div class="startsida-transkriberingsstatus-rad startsida-transkriberingsstatus-kyrkogard">';
            }
            html += '<div class="startsida-statistik-stapel-label">' + escapeHtml(kg.kyrkogard + ' – ' + kg.fardiga + ' av ' + kg.total + ', ' + procentStr(kg.total, kg.fardiga) + '%');
            if (nKvarter > 0) {
              html += ' <span class="startsida-transkriberingsstatus-chevron" aria-hidden="true">&#9654;</span>';
            }
            html += '</div>';
            html += '<div class="startsida-statistik-stapel" role="img" aria-label="' + escapeHtml(procentStr(kg.total, kg.fardiga)) + ' procent">' +
              '<div class="startsida-statistik-stapel-fardiga" style="width:' + procentStr(kg.total, kg.fardiga) + '%"></div>' +
              '<div class="startsida-statistik-stapel-rest" style="width:' + (100 - parseInt(procentStr(kg.total, kg.fardiga), 10)) + '%"></div></div>';
            html += '</div>';
            if (nKvarter > 0) {
              html += '<div class="startsida-transkriberingsstatus-kvarter-list" id="' + kvarterListId + '" hidden>';
              kvarterList.forEach(function (kv) {
                var kvarterLabel = kg.kyrkogard + ' – ' + kv.kvarter;
                html += '<div class="startsida-transkriberingsstatus-rad startsida-transkriberingsstatus-kvarter">' +
                  barHtml(kvarterLabel, kv.total, kv.fardiga) + '</div>';
              });
              html += '</div>';
            }
            html += '</div>';
          });
          transkWrap.innerHTML = html;
          transkWrap.removeAttribute('hidden');
          transkWrap.setAttribute('aria-hidden', 'false');
        } else if (transkWrap) {
          transkWrap.setAttribute('hidden', '');
          transkWrap.setAttribute('aria-hidden', 'true');
          transkWrap.innerHTML = '';
        }

        if (stapelWrap) {
          var total = data.total_gravplatser;
          var fardiga = data.gravplatser_fardigtranskriberade;
          if (!data.transkriberingsstatus && typeof total === 'number' && total > 0 && typeof fardiga === 'number') {
            var procent = Math.min(100, Math.round((fardiga / total) * 100));
            stapelWrap.innerHTML = '<p class="startsida-statistik-stapel-label">Färdigtranskriberade gravplatser (' + fardiga + ' av ' + total + ', ' + procent + '%)</p><div class="startsida-statistik-stapel" role="img" aria-label="' + procent + ' procent färdigtranskriberade"><div class="startsida-statistik-stapel-fardiga" style="width:' + procent + '%"></div><div class="startsida-statistik-stapel-rest" style="width:' + (100 - procent) + '%"></div></div>';
            stapelWrap.removeAttribute('hidden');
            stapelWrap.setAttribute('aria-hidden', 'false');
          } else {
            stapelWrap.setAttribute('hidden', '');
            stapelWrap.setAttribute('aria-hidden', 'true');
            stapelWrap.innerHTML = '';
          }
        }
      })
      .catch(function () {
        if (statListEl) statListEl.innerHTML = '<li><span>Kunde inte ladda statistik</span><span class="stat-varde">–</span></li>';
      });
  }
})();
