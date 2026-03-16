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

  // Visa version (commit + branch) från API
  fetch(API + '/version', { credentials: 'include' }).then(function(res) { return res.ok ? res.json() : null; }).then(function(v) {
    var el = document.getElementById('startsida-version');
    if (!el || !v) return;
    var parts = [];
    if (v.commit) parts.push(v.commit);
    if (v.branch) parts.push(v.branch);
    if (parts.length) el.textContent = 'Version: ' + parts.join(' · ');
  }).catch(function() {});

  (window.gpEnsureAuthPromise || gpEnsureAuth()).then(function(me) {
    if (!me) return;
    var el = document.getElementById('inloggad-anvandare');
    if (el) {
      var username = (me.username || '').trim();
      var safe = username.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      el.innerHTML = 'Inloggad som: <a href="/prestationer">' + safe + '</a>';
    }
    var listvyLink = document.getElementById('startsida-listvy-lank');
    if (listvyLink) {
      if (me.is_admin) listvyLink.removeAttribute('hidden');
      else listvyLink.remove();
    }
    var installningarLink = document.getElementById('startsida-installningar-lank');
    if (installningarLink) {
      if (me.is_admin) installningarLink.removeAttribute('hidden');
      else installningarLink.remove();
    }
    var batchLank = document.getElementById('startsida-batch-claude-lank');
    if (batchLank) {
      if (me.claude_batch_tillganglig) batchLank.removeAttribute('hidden');
      else batchLank.remove();
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
      li.innerHTML = full ? '<strong>' + escapeHtml(full) + '</strong>' : '–';
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
      var gotoBtn = e.target && e.target.closest('.startsida-transk-goto-nasta');
      if (gotoBtn) {
        e.preventDefault();
        e.stopPropagation();
        var kyrkogard = gotoBtn.getAttribute('data-kyrkogard');
        if (!kyrkogard) return;
        var params = new URLSearchParams();
        params.set('kyrkogard', kyrkogard);
        gotoBtn.disabled = true;
        fetch(API + '/gravplatser/nasta-ej-fardig?' + params.toString(), { credentials: 'include' })
          .then(function (res) {
            if (res.status === 404) {
              alert('Ingen ej färdig gravplats i ' + kyrkogard + '. Alla är färdigtranskriberade.');
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
            alert('Kunde inte hämta gravplats: ' + (err.message || 'nätverksfel'));
          })
          .finally(function () {
            gotoBtn.disabled = false;
          });
        return;
      }
      var gotoKvarter = e.target && e.target.closest('.startsida-transk-goto-nasta-kvarter');
      if (gotoKvarter) {
        e.preventDefault();
        e.stopPropagation();
        var kyrkogard = gotoKvarter.getAttribute('data-kyrkogard');
        var kvarter = gotoKvarter.getAttribute('data-kvarter');
        if (!kyrkogard || !kvarter) return;
        var params = new URLSearchParams();
        params.set('kyrkogard', kyrkogard);
        params.set('kvarter', kvarter);
        gotoKvarter.disabled = true;
        fetch(API + '/gravplatser/nasta-ej-fardig?' + params.toString(), { credentials: 'include' })
          .then(function (res) {
            if (res.status === 404) {
              alert('Ingen ej färdig gravplats i ' + kyrkogard + ' ' + kvarter + '. Alla är färdigtranskriberade.');
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
            alert('Kunde inte hämta gravplats: ' + (err.message || 'nätverksfel'));
          })
          .finally(function () {
            gotoKvarter.disabled = false;
          });
        return;
      }
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
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var gotoKvarter = e.target && e.target.closest('.startsida-transk-goto-nasta-kvarter');
      if (gotoKvarter) {
        e.preventDefault();
        gotoKvarter.click();
        return;
      }
      var klickbar = e.target && e.target.closest('.startsida-transkriberingsstatus-kyrkogard-klickbar');
      if (!klickbar) return;
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
          var N_TONER = 6;
          function segmentBarHtml(segments, opts) {
            opts = opts || {};
            if (!segments || segments.length === 0) {
              return '<div class="startsida-statistik-stapel startsida-statistik-stapel-segmentbar" role="img" aria-label="Inga sektioner">' +
                '<div class="startsida-statistik-stapel-segment startsida-statistik-stapel-segment-ej-fardig startsida-statistik-stapel-segment-ej-fardig-v0" style="width:100%"></div></div>';
            }
            var barTotal = segments.reduce(function (s, seg) { return s + (seg.total || 0); }, 0);
            if (barTotal <= 0) {
              return '<div class="startsida-statistik-stapel startsida-statistik-stapel-segmentbar" role="img" aria-label="Inga gravplatser">' +
                '<div class="startsida-statistik-stapel-segment startsida-statistik-stapel-segment-ej-fardig startsida-statistik-stapel-segment-ej-fardig-v0" style="width:100%"></div></div>';
            }
            var useGap = opts.kyrkogardGap === true;
            var segmentDivs;
            if (useGap && segments.some(function (s) { return s.kyrkogardStart; })) {
              var groups = [];
              var current = [];
              segments.forEach(function (seg) {
                if (seg.kyrkogardStart && current.length > 0) {
                  groups.push(current);
                  current = [];
                }
                current.push(seg);
              });
              if (current.length > 0) groups.push(current);
              var globalIdx = 0;
              segmentDivs = groups.map(function (group) {
                var groupTotal = group.reduce(function (s, seg) { return s + (seg.total || 0); }, 0);
                var inner = group.map(function (seg) {
                  var segTotal = seg.total || 0;
                  var segFardiga = seg.fardiga || 0;
                  var v = globalIdx % N_TONER;
                  globalIdx += 1;
                  var vClassF = ' startsida-statistik-stapel-segment-fardig-v' + v;
                  var vClassR = ' startsida-statistik-stapel-segment-ej-fardig-v' + v;
                  var title = (seg.kvarter ? seg.kvarter + ': ' : '') + segFardiga + ' av ' + segTotal + ' klara';
                  var h = '';
                  if (segFardiga > 0) {
                    h += '<div class="startsida-statistik-stapel-segment startsida-statistik-stapel-segment-fardig' + vClassF + '" style="flex:' + segFardiga + ' 0 0" title="' + title + '"></div>';
                  }
                  if (segTotal - segFardiga > 0) {
                    h += '<div class="startsida-statistik-stapel-segment startsida-statistik-stapel-segment-ej-fardig' + vClassR + '" style="flex:' + (segTotal - segFardiga) + ' 0 0" title="' + title + '"></div>';
                  }
                  return h;
                }).join('');
                return '<div class="startsida-statistik-stapel-kyrkogard-block" style="flex:' + groupTotal + ' 0 0">' + inner + '</div>';
              }).join('<div class="startsida-statistik-stapel-gap" aria-hidden="true"></div>');
            } else {
              segmentDivs = segments.map(function (seg, segIdx) {
                var segTotal = seg.total || 0;
                var segFardiga = seg.fardiga || 0;
                var v = segIdx % N_TONER;
                var vClassF = ' startsida-statistik-stapel-segment-fardig-v' + v;
                var vClassR = ' startsida-statistik-stapel-segment-ej-fardig-v' + v;
                var title = (seg.kvarter ? seg.kvarter + ': ' : '') + segFardiga + ' av ' + segTotal + ' klara';
                var html = '';
                if (useGap && seg.kyrkogardStart && segIdx > 0) {
                  html += '<div class="startsida-statistik-stapel-gap" aria-hidden="true"></div>';
                }
                if (useGap) {
                  if (segFardiga > 0) {
                    html += '<div class="startsida-statistik-stapel-segment startsida-statistik-stapel-segment-fardig' + vClassF + '" style="flex:' + segFardiga + ' 0 0" title="' + title + '"></div>';
                  }
                  if (segTotal - segFardiga > 0) {
                    html += '<div class="startsida-statistik-stapel-segment startsida-statistik-stapel-segment-ej-fardig' + vClassR + '" style="flex:' + (segTotal - segFardiga) + ' 0 0" title="' + title + '"></div>';
                  }
                } else {
                  var w = Math.max(0, Math.min(100, (segTotal / barTotal) * 100));
                  var pFardig = segTotal > 0 ? Math.min(1, segFardiga / segTotal) : 0;
                  var wGreen = w * pFardig;
                  var wRed = w * (1 - pFardig);
                  if (wGreen > 0) {
                    html += '<div class="startsida-statistik-stapel-segment startsida-statistik-stapel-segment-fardig' + vClassF + '" style="width:' + wGreen + '%" title="' + title + '"></div>';
                  }
                  if (wRed > 0) {
                    html += '<div class="startsida-statistik-stapel-segment startsida-statistik-stapel-segment-ej-fardig' + vClassR + '" style="width:' + wRed + '%" title="' + title + '"></div>';
                  }
                }
                return html;
              }).join('');
            }
            var barClass = 'startsida-statistik-stapel startsida-statistik-stapel-segmentbar';
            if (useGap) barClass += ' startsida-statistik-stapel-segmentbar-med-gap';
            return '<div class="' + barClass + '" role="img" aria-label="Grönt är färdigtranskriberat, rött återstår">' + segmentDivs + '</div>';
          }
          function radMedStapel(labelHtml, segments, opts) {
            return '<div class="startsida-statistik-stapel-label">' + labelHtml + '</div>' + segmentBarHtml(segments, opts);
          }
          function kvarterTillSegment(kv) {
            if (kv.gravplatser_fardiga && Array.isArray(kv.gravplatser_fardiga)) {
              return kv.gravplatser_fardiga.map(function (f) {
                return { total: 1, fardiga: f ? 1 : 0 };
              });
            }
            return [{ total: kv.total, fardiga: kv.fardiga }];
          }
          var allSegments = [];
          kyrkogardar.forEach(function (kg) {
            var kvarter = kg.kvarter || [];
            kvarter.forEach(function (kv, i) {
              allSegments.push({
                total: kv.total,
                fardiga: kv.fardiga,
                kyrkogardStart: i === 0,
                kvarter: kv.kvarter,
                kyrkogard: kg.kyrkogard
              });
            });
          });
          var html = '<h3>Transkriberingsstatus</h3>';
          if (total && typeof total.total === 'number' && total.total > 0) {
            var totalLabel = 'Totalt – ' + total.fardiga + ' av ' + total.total + ', ' + procentStr(total.total, total.fardiga) + '%';
            html += '<div class="startsida-transkriberingsstatus-rad">' +
              radMedStapel(escapeHtml(totalLabel), allSegments, { kyrkogardGap: true }) + '</div>';
          }
          kyrkogardar.forEach(function (kg, kgIndex) {
            var kvarterList = kg.kvarter || [];
            var nKvarter = kvarterList.length;
            var kvarterListId = 'transk-kvarter-' + kgIndex;
            var kgLabel = kg.kyrkogard + ' – ' + kg.fardiga + ' av ' + kg.total + ', ' + procentStr(kg.total, kg.fardiga) + '%';
            html += '<div class="startsida-transkriberingsstatus-kyrkogard-block">';
            if (nKvarter > 0) {
              html += '<div class="startsida-transkriberingsstatus-kyrkogard-klickbar startsida-transkriberingsstatus-rad startsida-transkriberingsstatus-kyrkogard" role="button" tabindex="0" aria-expanded="false" aria-controls="' + kvarterListId + '" aria-label="' + escapeHtml(kg.kyrkogard + ', klicka för att visa kvarter') + '">';
              html += '<div class="startsida-statistik-stapel-label">';
              html += '<button type="button" class="startsida-transk-goto-nasta" data-kyrkogard="' + escapeHtml(kg.kyrkogard) + '" title="Gå till nästa ej färdigtranskriberade i ' + escapeHtml(kg.kyrkogard) + '">' + escapeHtml(kgLabel) + '</button>';
              html += ' <span class="startsida-transkriberingsstatus-chevron" aria-hidden="true">&#9654;</span>';
              html += '</div>';
            } else {
              html += '<div class="startsida-transkriberingsstatus-rad startsida-transkriberingsstatus-kyrkogard">';
              html += '<div class="startsida-statistik-stapel-label">';
              html += '<button type="button" class="startsida-transk-goto-nasta" data-kyrkogard="' + escapeHtml(kg.kyrkogard) + '" title="Gå till nästa ej färdigtranskriberade i ' + escapeHtml(kg.kyrkogard) + '">' + escapeHtml(kgLabel) + '</button>';
              html += '</div>';
            }
            html += segmentBarHtml(kvarterList.map(function (kv) { return { total: kv.total, fardiga: kv.fardiga, kvarter: kv.kvarter, kyrkogard: kg.kyrkogard }; }));
            html += '</div>';
            if (nKvarter > 0) {
              html += '<div class="startsida-transkriberingsstatus-kvarter-list" id="' + kvarterListId + '" hidden>';
              kvarterList.forEach(function (kv) {
                var kvarterLabel = kg.kyrkogard + ' – ' + kv.kvarter + ' – ' + kv.fardiga + ' av ' + kv.total + ', ' + procentStr(kv.total, kv.fardiga) + '%';
                html += '<div class="startsida-transkriberingsstatus-rad startsida-transkriberingsstatus-kvarter startsida-transk-goto-nasta-kvarter" role="button" tabindex="0" data-kyrkogard="' + escapeHtml(kg.kyrkogard) + '" data-kvarter="' + escapeHtml(kv.kvarter) + '" title="Gå till nästa ej färdigtranskriberade i ' + escapeHtml(kg.kyrkogard) + ' ' + escapeHtml(kv.kvarter) + '">' +
                  radMedStapel(escapeHtml(kvarterLabel), kvarterTillSegment(kv)) +
                  '</div>';
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
