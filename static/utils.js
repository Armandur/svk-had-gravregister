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
