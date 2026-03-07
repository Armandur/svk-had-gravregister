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
    fetch(API + '/gravplatser/sok?q=' + encodeURIComponent(t) + '&limit=25')
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

  var sokGravsattaBtn = document.getElementById('startsida-sok-gravsatta');
  if (sokGravsattaBtn) {
    sokGravsattaBtn.addEventListener('click', function (e) {
      e.preventDefault();
    });
  }

  // Statistik
  const statListEl = document.getElementById('startsida-statistik-lista');
  if (statListEl) {
    fetch(API + '/statistik')
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
        ];
        statListEl.innerHTML = rader.map(function (r) {
          const v = data[r.key];
          const varde = typeof v === 'number' ? String(v) : '–';
          return '<li><span>' + escapeHtml(r.label) + '</span><span class="stat-varde">' + escapeHtml(varde) + '</span></li>';
        }).join('');

        var stapelWrap = document.getElementById('startsida-statistik-stapel-wrap');
        if (stapelWrap) {
          var total = data.total_gravplatser;
          var fardiga = data.gravplatser_fardigtranskriberade;
          if (typeof total === 'number' && total > 0 && typeof fardiga === 'number') {
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
