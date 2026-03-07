/**
 * Auth-hjälp: kräv inloggning. Anropas vid sidladdning.
 * Vid 401 omdirigeras användaren till /login?redirect=...
 * Vid 200 returnerar användarobjektet { id, username, is_admin }.
 */
window.gpEnsureAuth = function () {
  return fetch('/api/me', { credentials: 'include' }).then(function (r) {
    if (r.status === 401) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
      return null;
    }
    if (!r.ok) return null;
    return r.json();
  }).then(function (me) {
    if (me) {
      var el = document.getElementById('inloggad-anvandare');
      if (el) el.textContent = 'Inloggad som: ' + (me.username || '');
    }
    return me;
  }).catch(function () {
    window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
    return null;
  });
};

/** Fetch med credentials och 401 → redirect till login */
window.gpFetch = function (url, opts) {
  opts = opts || {};
  opts.credentials = 'include';
  return fetch(url, opts).then(function (res) {
    if (res.status === 401) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
      throw new Error('Unauthorized');
    }
    return res;
  });
};
