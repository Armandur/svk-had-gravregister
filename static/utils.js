/**
 * Gravregister – gemensamma utilities.
 * Laddas tidigt, före alla andra skript.
 */

/** HTML-escapar en sträng (skyddar mot XSS vid dynamisk HTML-generering). */
function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

/** Alias för esc() – används i äldre delar av koden. */
const escapeHtml = esc;

/**
 * Visar en tillfällig toast-notifikation längst ned till höger.
 * @param {string} meddelande - Texten att visa (plaintext, ej HTML).
 * @param {'fel'|'ok'|'info'} [typ='info'] - Typ av meddelande.
 */
function showToast(meddelande, typ) {
  typ = typ || 'info';
  let container = document.getElementById('gp-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'gp-toast-container';
    container.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;display:flex;flex-direction:column;gap:0.5rem;align-items:flex-end;z-index:10000;pointer-events:none;';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = 'gp-toast gp-toast--' + typ;
  el.setAttribute('role', typ === 'fel' ? 'alert' : 'status');
  el.setAttribute('aria-live', typ === 'fel' ? 'assertive' : 'polite');
  el.textContent = meddelande;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('gp-toast--ut');
    setTimeout(() => el.remove(), 220);
  }, 4000);
}
