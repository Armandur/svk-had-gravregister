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
})();
