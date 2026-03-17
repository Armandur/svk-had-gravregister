/**
 * Gravregister – Achievement och toast-funktioner.
 * Extraherat från gravplatser.js. Laddas före gravplatser.js.
 */

function gpAchievementLevelRank(level) {
  if (!level) return 0;
  if (level === 'bronze') return 1;
  if (level === 'silver') return 2;
  if (level === 'gold') return 3;
  return 0;
}

/** Returnerar listan achievement som just uppnåtts (högre nivå än före). */
function gpNewlyEarnedAchievements(beforeNivaer, afterNivaer) {
  const beforeByKey = {};
  (beforeNivaer || []).forEach(function (n) {
    beforeByKey[n.achievement_key] = n.earned_level;
  });
  const result = [];
  (afterNivaer || []).forEach(function (n) {
    const afterRank = gpAchievementLevelRank(n.earned_level);
    const beforeRank = gpAchievementLevelRank(beforeByKey[n.achievement_key]);
    if (afterRank > beforeRank) {
      const level = n.earned_level;
      const thresholds = n || {};
      const levelInfo = level && thresholds[level] ? thresholds[level] : null;
      const threshold = levelInfo && typeof levelInfo.threshold === 'number' ? levelInfo.threshold : null;
      result.push({
        key: n.achievement_key,
        level,
        label: n.label || n.achievement_key,
        threshold,
        current: typeof n.current_value === 'number' ? n.current_value : null,
      });
    }
  });
  return result;
}

/** Visar achievement- och yrkes-toasts efter sparning. Anropas från sparaInmatning och fardigtranskriberad-knappen. */
function visaSparToasts(achievementsBefore, data) {
  if (!data) return;
  if (data.new_unique_yrken && data.new_unique_yrken.length > 0) {
    fetch(`${API}/me`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((me) => {
        const p = (me && me.preferences) || {};
        if (p.fun_enabled !== false) {
          if (p.toast_on_new_yrke !== false) {
            (data.new_unique_yrken || []).forEach((yrke) => {
              gpShowToast(gpToastTextFörNyttYrke([yrke]));
            });
          }
          if (p.sound_on_new_yrke !== false) {
            gpPlayPling();
          }
        }
      })
      .catch(() => {});
  }
  if (data.achievements_snapshot && Array.isArray(data.achievements_snapshot) && data.achievements_snapshot.length > 0) {
    const newlyEarned = gpNewlyEarnedAchievements(achievementsBefore && achievementsBefore.nivaer ? achievementsBefore.nivaer : [], data.achievements_snapshot);
    if (newlyEarned.length > 0) {
      fetch(`${API}/me`, { credentials: 'include' })
        .then((r) => r.ok ? r.json() : null)
        .then((me) => {
          const p = (me && me.preferences) || {};
          if (p.fun_enabled !== false) {
            newlyEarned.forEach((item) => {
              gpShowToast(gpToastTextFörAchievement(item.level, item.label, item.threshold, item.current));
            });
            if (p.sound_on_new_yrke !== false) {
              gpPlayPling();
            }
          }
        })
        .catch(() => {});
    }
  }
}

function gpToastTextFörAchievement(level, label, threshold, current) {
  const nivåNamn = level === 'bronze' ? 'brons' : level === 'silver' ? 'silver' : level === 'gold' ? 'guld' : (level || '');
  const emoji = level === 'bronze' ? '🥉' : level === 'silver' ? '🥈' : level === 'gold' ? '🥇' : '🎉';
  const labelHtml = label ? `<strong>${esc(label)}</strong>` : '';
  const countText = typeof current === 'number' ? `${current} st` : null;
  const thresholdText = typeof threshold === 'number' ? `${threshold} st` : null;
  const formuleringar = [
    thresholdText && countText
      ? `${emoji} Du har nått ${nivåNamn} i ${labelHtml} – ${countText}!.`
      : `${emoji} Du har nått ${nivåNamn} i ${labelHtml}!`,
    thresholdText && countText
      ? `${emoji} Ny utmärkelse i ${labelHtml}: ${nivåNamn} (${countText} totalt!`
      : `${emoji} Ny utmärkelse i ${labelHtml}: nivån ${nivåNamn}.`,
    thresholdText && countText
      ? `${emoji} Bra jobbat – du har precis klättrat till ${nivåNamn}-nivå i ${labelHtml} genom att nå ${countText}!`
      : `${emoji} Bra jobbat – du har precis klättrat till ${nivåNamn}-nivå i ${labelHtml}.`,
  ];
  return formuleringar[Math.floor(Math.random() * formuleringar.length)];
}

/** Slumpad gratulation när användaren upptäcker ett nytt unikt yrke. */
function gpToastTextFörNyttYrke(yrkenLista) {
  const yrken = yrkenLista && yrkenLista.length ? yrkenLista : [];
  const yrkeText = yrken.length > 1 ? yrken.join(', ') : (yrken[0] || '');
  const yrkeHtml = yrkeText ? `<strong>${esc(yrkeText)}</strong>` : '';
  const formuleringar = [
    'Nytt yrke upptäckt: ' + yrkeHtml + '!',
    'Du upptäckte yrket ' + yrkeHtml + '!',
    'Ett yrke vi inte sett förut: ' + yrkeHtml + '!',
    'Upptäckt! ' + yrkeHtml + ' fanns inte i registret tidigare.',
    'Pling! Yrket ' + yrkeHtml + ' har vi inte sett förut!.',
    'Första gången vi ser ' + yrkeHtml + ' i arkivet!',
    'Snyggt - du hittade yrket ' + yrkeHtml + '!',
    'Yrket ' + yrkeHtml + ' dyker upp för första gången.',
    'Ny upptäckt i registret: ' + yrkeHtml + '.',
    'Oj, ' + yrkeHtml + ' - det hade vi inte sett tidigare!',
    'Kanon - ett nytt yrke upptäckt: ' + yrkeHtml + '.',
    'Rätt coolt - ' + yrkeHtml + ' syns nu i systemet för första gången!',
  ];
  return formuleringar[Math.floor(Math.random() * formuleringar.length)];
}

/** Toast för "roliga saker" (t.ex. nytt unikt yrke). */
function gpShowToast(text) {
  let container = document.getElementById('gp-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'gp-toast-container';
    container.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;display:flex;flex-direction:column;gap:0.5rem;align-items:flex-end;z-index:10000;';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = 'max-width:20rem;padding:0.75rem 1rem;background:#1e293b;color:#fff;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.25);font-size:0.9rem;animation:gp-toast-in 0.2s ease;';
  el.innerHTML = text;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'gp-toast-out 0.2s ease forwards';
    setTimeout(() => el.remove(), 220);
  }, 5500);
}

/** Kort pling-ljud (spelar Ping-sound.mp3 från static, faller tillbaka till Web Audio om fil saknas). */
function gpPlayPling() {
  try {
    const audio = new Audio('/static/Ping-sound.mp3');
    audio.volume = 0.6;
    audio.play().catch(function () { /* ignorerar om autoplay blockeras eller fil saknas */ });
  } catch (e) {
    try {
      const C = typeof AudioContext !== 'undefined' ? AudioContext : (window.webkitAudioContext || window.AudioContext);
      if (!C) return;
      const ctx = new C();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (e2) { /* ignorerar om ljud inte stöds */ }
  }
}
