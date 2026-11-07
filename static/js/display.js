(() => {
'use strict';

const QS = new URLSearchParams(location.search);
const TOKEN = location.pathname.split('/').filter(Boolean).pop();
const PREVIEW = QS.has('preview');
// ?at=2026-11-02T09:47:00+03:00 — «подкрутить часы» (для проверки внешнего вида в разных ситуациях)
const T_OFFSET = QS.get('at') ? Date.parse(QS.get('at')) - Date.now() : 0;
const nowMs = () => Date.now() + T_OFFSET;
const LOADED_AT = Date.now();

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

let S = {timezone: 'Europe/Moscow', theme: 'amber', fx: 2, layout: 'auto', fontScale: 1, safe: 3, days: 3,
  showSeconds: true, burnIn: true, warnMinutes: 15, nightEnabled: true, nightFrom: 23, nightTo: 7, nightLevel: .5};
let OV = {};                       // переопределения из URL (theme, fx, layout, scale, safe)
for (const k of ['theme', 'fx', 'layout', 'safe', 'days', 'decor']) if (QS.has(k)) OV[k] = isNaN(+QS.get(k)) ? QS.get(k) : +QS.get(k);
if (QS.has('scale')) OV.fontScale = +QS.get('scale');

let tz = S.timezone;
let CAL = {}, E = [], STATUS = null, VERSION = null;
let netErr = null, haveData = false, dirty = true, lastMinute = -1, lastHero = '', wide = false, tall = false;

// ------------------------------------------------------------------------- время в нужной зоне
const fmtCache = new Map();
function dtf(key, opts, loc = 'ru-RU', zone = tz) {
  const k = key + '|' + zone + '|' + loc;
  let f = fmtCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat(loc, {timeZone: zone, ...opts}); fmtCache.set(k, f); }
  return f;
}
function P(ts) {
  const o = {};
  for (const p of dtf('p', {hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'}, 'en-GB').formatToParts(ts)) o[p.type] = p.value;
  return {y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second};
}
const dnum = p => Math.floor(Date.UTC(p.y, p.mo - 1, p.d) / 864e5);
const dnStr = s => { const [y, m, d] = s.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 864e5); };
const hm = ts => { const p = P(ts); return pad(p.h) + ':' + pad(p.mi); };
const wdLong = n => dtf('wl', {weekday: 'long'}, 'ru-RU', 'UTC').format(n * 864e5);
const wdShort = n => dtf('ws', {weekday: 'short'}, 'ru-RU', 'UTC').format(n * 864e5).replace('.', '');
const dmShort = n => { const d = new Date(n * 864e5); return pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1); };

// --------------------------------------------------------------------------------- настройки
// «Авто по сезону»: осень, Хэллоуин, Новый год, зима — по дате в часовом поясе экрана
function resolveTheme(t) {
  if (t !== 'season') return t;
  const p = P(nowMs()), md = p.mo * 100 + p.d;
  if (md >= 1024 && md <= 1101) return 'halloween';
  if (md >= 1215 || md <= 110) return 'newyear';
  if (md >= 1201 || md <= 228) return 'winter';
  if (md >= 901 && md <= 1130) return 'autumn';
  return 'amber';
}
let decorKey = '';
function applySettings() {
  const s = {...S, ...OV};
  const b = document.body;
  tz = s.timezone;
  const theme = resolveTheme(s.theme);
  b.dataset.theme = theme;
  b.dataset.fx = String(s.fx);
  document.documentElement.style.setProperty('--fs', s.fontScale);
  b.style.setProperty('--safe', s.safe);
  b.style.setProperty('--line', Math.max(3, Math.round(innerHeight / 190)) + 'px');
  wide = s.layout === 'wide' || (s.layout === 'auto' && innerWidth / innerHeight >= 1.5);
  tall = !wide && innerWidth / innerHeight < 0.9;
  b.classList.toggle('wide', wide);
  b.classList.toggle('tall', tall);
  const key = [theme, !!s.decor && s.decor !== '0', innerWidth, innerHeight].join('|');
  if (key !== decorKey) { decorKey = key; setupDecor(theme, !!s.decor && s.decor !== '0'); }
  dirty = true;
}
function eff() { return {...S, ...OV}; }

function ingest(d) {
  S = d.settings;
  CAL = {};
  d.calendars.forEach((c, i) => { CAL[c.id] = {...c, idx: i}; });
  E = d.events.map(e => e.allDay
    ? {...e, ds: dnStr(e.start), de: dnStr(e.end)}
    : {...e, s: Date.parse(e.start), t: Date.parse(e.end)});
  STATUS = d.status;
  haveData = true;
  applySettings();
}

async function poll() {
  try {
    const r = await fetch('/api/display?t=' + encodeURIComponent(TOKEN), {cache: 'no-store'});
    if (r.status === 404) throw new Error('addr');
    if (!r.ok) throw new Error('http ' + r.status);
    const d = await r.json();
    if (VERSION && d.version !== VERSION && !PREVIEW) { location.reload(); return; }
    VERSION = d.version;
    netErr = null;
    ingest(d);
  } catch (e) {
    netErr = e.message === 'addr' ? 'addr' : 'net';
    dirty = true;
  }
}

// --------------------------------------------------------------------- вспомогательное для вида
const colorOf = c => (eff().theme === 'color' && c) ? ` style="--c:${c.color}"` : '';
const glyph = c => c ? `<i class="g g${c.glyph}"${colorOf(c)}></i>` : '';
const calLabel = c => c ? (c.short || c.name).toUpperCase() : '';

function countHTML(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  if (sec < 300) return `<b>${Math.floor(sec / 60)}:${pad(sec % 60)}</b>`;
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `<b>${m}</b><u>мин</u>`;
  if (m < 1440) {
    const h = Math.floor(m / 60), r = m % 60;
    return `<b>${h}</b><u>ч</u>` + (r ? `<b>${pad(r)}</b><u>мин</u>` : '');
  }
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return `<b>${d}</b><u>сут</u>` + (h ? `<b>${h}</b><u>ч</u>` : '');
}
function relText(ms) {
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m} мин`;
  if (m < 1440) return `${Math.floor(m / 60)} ч` + (m % 60 ? ` ${pad(m % 60)} мин` : '');
  const dd = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60);
  return `${dd} сут` + (hh ? ` ${hh} ч` : '');
}
const meta = e => `${hm(e.s)}–${hm(e.t)}` + (e.location ? ' · ' + e.location : '');
const timed = () => E.filter(e => !e.allDay);
const byStart = (a, b) => a.s - b.s || String(a.id).localeCompare(String(b.id));
const afterRow = (label, event, time = '', extra = 0) =>
  `<span class="after-row"><b class="after-label">${esc(label)}</b>` +
  `<b class="after-title">${esc(event.title)}</b>` +
  (time ? `<span class="after-time">${esc(time)}</span>` : '') +
  (extra ? `<b class="after-extra">+${extra}</b>` : '') + '</span>';

// ----------------------------------------------------------------------------------- главный блок
function renderHero(now) {
  const cfg = eff();
  const warn = cfg.warnMinutes;
  const live = timed().filter(e => e.s <= now && e.t > now).sort(byStart);
  const next = timed().filter(e => e.s > now).sort(byStart);
  const h = {cls: 'calm', color: null, tag: '', cal: '', glyph: '', count: '', title: '', meta: '', p: 0, after: ''};

  if (!haveData) {
    h.cls = 'free'; h.tag = 'ЗАГРУЗКА'; h.count = '<b>...</b>'; h.title = 'Читаю расписание';
  } else if (live.length) {
    const e = live[0], c = CAL[e.cal];
    h.cls = 'live'; h.tag = 'СЕЙЧАС'; h.color = c; h.cal = calLabel(c); h.glyph = glyph(c);
    h.count = '<em>ЕЩЁ</em>' + countHTML(e.t - now);
    h.title = e.title; h.meta = meta(e);
    h.p = Math.min(100, Math.max(0, (now - e.s) / Math.max(1, e.t - e.s) * 100));
    if (e.t - now <= 5 * 60000) h.cls += ' ending';
    const other = live.slice(1).sort((a, b) => a.t - b.t || byStart(a, b))[0];
    const n = next[0];
    if (other) h.after = afterRow('ТАКЖЕ', other, `до ${hm(other.t)}`, live.length - 2);
    else if (n && n.s < e.t) {
      const ms = n.s - now, sec = Math.ceil(ms / 1000);
      const remaining = ms <= 5 * 60000 ? `${Math.floor(sec / 60)}:${pad(sec % 60)}` : relText(ms);
      h.after = afterRow(`ЧЕРЕЗ ${remaining}`, n);
    }
    else if (n) h.after = `ДАЛЬШЕ · через ${relText(n.s - now)} · <b>${hm(n.s)}</b> ${esc(n.title)}`;
    else h.after = 'ДАЛЬШЕ СОБЫТИЙ НЕТ';
  } else if (next.length) {
    const e = next[0], c = CAL[e.cal];
    const ms = e.s - now, m = ms / 60000;
    h.tag = 'СЛЕДУЮЩАЯ'; h.color = c; h.cal = calLabel(c); h.glyph = glyph(c);
    h.title = e.title; h.meta = meta(e);
    const delta = dnum(P(e.s)) - dnum(P(now));
    if (delta === 0) h.count = countHTML(ms);
    else {
      const dn = dnum(P(e.s));
      const big = delta === 1 ? 'ЗАВТРА' : wdLong(dn).toUpperCase();
      const small = (delta === 1 ? wdShort(dn).toUpperCase() + ' ' : '') + dmShort(dn);
      h.count = `<span class="day"><strong>${big}</strong><i>${small}</i></span><b>${hm(e.s)}</b>`;
      h.meta = `через ${relText(ms)} · ${meta(e)}`;
    }
    h.p = m <= 60 ? (1 - m / 60) * 100 : 0;
    h.cls = (delta === 0 && m <= 5 ? 'imminent' : (delta === 0 && m <= warn ? 'soon' : 'calm')) + (delta > 0 ? ' fut' : '');
    const n = next[1];
    h.after = n ? `ПОТОМ <b>${hm(n.s)}</b> ${esc(n.title)}` : 'ПОТОМ СОБЫТИЙ НЕТ';
  } else {
    h.cls = 'free'; h.tag = 'СВОБОДНО'; h.count = '<b>:)</b>'; h.title = 'Событий больше нет';
    h.meta = `в ближайшие ${cfg.days} дн. всё свободно`;
  }

  const sig = JSON.stringify(h) + cfg.theme + wide;
  if (sig === lastHero) return;
  lastHero = sig;
  const hero = $('hero');
  hero.className = h.cls;
  hero.style.setProperty('--accent', cfg.theme === 'color' && h.color ? h.color.color : 'var(--fg)');
  $('h-glyph').className = 'g' + (h.color ? ' g' + h.color.glyph : '');
  $('h-glyph').style.display = h.color ? '' : 'none';
  if (cfg.theme === 'color' && h.color) $('h-glyph').style.setProperty('--c', h.color.color); else $('h-glyph').style.removeProperty('--c');
  $('h-tag').textContent = h.tag;
  $('h-cal').textContent = h.cal ? '· ' + h.cal : '';
  $('h-count').innerHTML = h.count;
  $('h-title').textContent = h.title;
  $('h-meta').textContent = h.meta;
  $('h-bar').style.display = (h.cls.includes('free') || !haveData) ? 'none' : '';
  $('h-bar').firstElementChild.style.setProperty('--p', h.p.toFixed(1) + '%');
  $('h-after').innerHTML = h.after;
  $('h-after').style.display = h.after ? '' : 'none';
}

// ------------------------------------------------------------------------------------ полоса дня
function renderTimeline(now) {
  const el = $('tl');
  const np = P(now), today = dnum(np);
  const nowMin = np.h * 60 + np.mi + np.s / 60;
  const items = [];
  for (const e of timed()) {
    const sp = P(e.s), tp = P(Math.max(e.t, e.s));
    const sd = dnum(sp), td = dnum(tp);
    if (sd > today || td < today) continue;
    const st = sd < today ? 0 : sp.h * 60 + sp.mi;
    const en = td > today ? 1440 : tp.h * 60 + tp.mi;
    if (en <= st && e.t !== e.s) continue;
    items.push({e, st, en: Math.max(en, st + 8)});
  }
  let lo = 8 * 60, hi = 20 * 60;
  for (const it of items) { lo = Math.min(lo, Math.floor(it.st / 60) * 60); hi = Math.max(hi, Math.ceil(it.en / 60) * 60); }
  lo = Math.min(lo, Math.floor(nowMin / 60) * 60);
  hi = Math.max(hi, Math.ceil((nowMin + 1) / 60) * 60);
  lo = Math.max(0, lo); hi = Math.min(1440, hi);
  const span = hi - lo, pct = m => ((m - lo) / span * 100).toFixed(3) + '%';

  items.sort((a, b) => a.st - b.st || a.en - b.en);
  const lanesEnd = [];
  for (const it of items) {
    let l = lanesEnd.findIndex(end => end <= it.st);
    if (l < 0) l = lanesEnd.length < 3 ? lanesEnd.length : 2;
    lanesEnd[l] = Math.max(lanesEnd[l] || 0, it.en);
    it.lane = l;
  }
  const lc = Math.max(1, lanesEnd.length);
  const step = span <= 12 * 60 ? 1 : 2;
  let html = '<div class="lanes">';
  for (let h = Math.ceil(lo / 60); h * 60 <= hi; h++) {
    if ((h - Math.ceil(lo / 60)) % step) continue;
    html += `<i class="tick" style="left:${pct(h * 60)}"></i><span class="lab" style="left:${pct(h * 60)}">${pad(h % 24)}</span>`;
  }
  for (const it of items) {
    const c = CAL[it.e.cal];
    const col = (eff().theme === 'color' && c) ? c.color : 'var(--fg)';
    const lh = (100 / lc).toFixed(2);
    html += `<i class="blk p${c ? c.glyph : 0}${it.e.t <= now ? ' past' : ''}" style="--c:${col};` +
      `left:${pct(it.st)};width:calc(${pct(it.en)} - ${pct(it.st)});` +
      `top:calc(${it.lane} * ${lh}% + .05rem);height:calc(${lh}% - .1rem)"></i>`;
  }
  html += `<i class="shade" style="width:${pct(Math.min(hi, Math.max(lo, nowMin)))}"></i>`;
  html += `<i class="now" style="left:${pct(nowMin)}"></i></div>`;
  el.innerHTML = html;
}

// ------------------------------------------------------------------------------------- повестка
function fitInto(container, items) {
  container.innerHTML = '';
  const nodes = items.map(h => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; });
  const over = () => container.scrollHeight > container.clientHeight + 1;
  let shown = 0;
  for (const n of nodes) { container.appendChild(n); if (over()) { container.removeChild(n); break; } shown++; }
  const rowsLeft = k => nodes.slice(k).filter(n => n.classList.contains('row')).length;
  if (shown < nodes.length) {
    const more = document.createElement('div');
    more.className = 'more';
    container.appendChild(more);
    const upd = () => { more.textContent = '+' + rowsLeft(shown) + ' ЕЩЁ'; };
    upd();
    while (over() && shown > 0) { container.removeChild(nodes[shown - 1]); shown--; upd(); }
    while (shown > 0 && nodes[shown - 1].classList.contains('gh')) { container.removeChild(nodes[shown - 1]); shown--; upd(); }
    if (!rowsLeft(shown)) more.remove();
  }
}

function renderAgenda(now) {
  const cfg = eff();
  const np = P(now), today = dnum(np);
  const groups = new Map();
  for (let d = today; d < today + cfg.days; d++) groups.set(d, {ad: [], ev: []});

  for (const e of E) {
    if (e.allDay) {
      for (let d = Math.max(e.ds, today); d < e.de && d < today + cfg.days; d++) groups.get(d)?.ad.push(e);
    } else if (e.t > now || (e.t === e.s && e.s >= now)) {
      const d = Math.max(dnum(P(e.s)), today);
      groups.get(d)?.ev.push(e);
    }
  }
  const items = [];
  const hadToday = E.some(e => !e.allDay && dnum(P(e.s)) === today);
  [...groups.keys()].forEach((d, i) => {
    const g = groups.get(d);
    g.ev.sort((a, b) => a.s - b.s); g.ad.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    if (i > 0 && !g.ev.length && !g.ad.length) return;
    const name = d === today ? 'СЕГОДНЯ' : d === today + 1 ? 'ЗАВТРА' : wdLong(d).toUpperCase();
    const left = d === today ? name : `${name} · ${dmShort(d)}`;
    if (!wide && g.ad.length) {
      // в узком (4:3) виде события «весь день» живут в заголовке дня — экономят целый ряд
      const chips = g.ad.map(e => `<span>${glyph(CAL[e.cal])}${esc(e.title)}</span>`).join('');
      items.push(`<div class="gh"><span class="l">${left}</span><span class="adl">${chips}</span></div>`);
    } else {
      items.push(`<div class="gh"><span class="l">${left}</span></div>`);
      for (const e of g.ad)
        items.push(`<div class="row ad"><span class="t">ВЕСЬ ДЕНЬ</span>${glyph(CAL[e.cal])}<span class="ti">${esc(e.title)}</span></div>`);
    }
    if (i === 0 && !g.ev.length) items.push(`<div class="empty">— ${hadToday ? 'БОЛЬШЕ СЕГОДНЯ НИЧЕГО' : 'СЕГОДНЯ СОБЫТИЙ НЕТ'} —</div>`);
    for (const e of g.ev) {
      const c = CAL[e.cal];
      const live = e.s <= now;
      const soon = !live && (e.s - now) / 60000 <= cfg.warnMinutes && d === today;
      const t = dnum(P(e.s)) < today ? '…' : hm(e.s);
      items.push(`<div class="row${live ? ' live' : ''}${soon ? ' soon' : ''}"><span class="t">${t}</span>${glyph(c)}` +
        `<span class="ti">${esc(e.title)}</span>${e.location ? `<span class="loc">${esc(e.location)}</span>` : ''}</div>`);
    }
  });
  fitInto($('agenda'), haveData ? items : []);
}

// --------------------------------------------------------------------------------------- подвал
function renderFooter(now) {
  $('legend').innerHTML = Object.values(CAL).map(c => `<span>${glyph(c)}${esc(calLabel(c).slice(0, 12))}</span>`).join('');
  const sync = $('sync');
  let text = '', bad = false;
  if (netErr === 'addr') { text = 'НЕВЕРНЫЙ АДРЕС ЭКРАНА'; bad = true; }
  else if (netErr) { text = 'СЕРВЕР НЕДОСТУПЕН'; bad = true; }
  else if (STATUS && !STATUS.connected) { text = 'ЯНДЕКС НЕ ПОДКЛЮЧЁН'; bad = true; }
  else if (STATUS && STATUS.okAt) {
    const age = (Date.now() - STATUS.okAt) / 60000;   // реальные часы, а не «подкрученные» через ?at=
    if (STATUS.error || age > 12) { text = `! НЕТ СВЯЗИ С ЯНДЕКСОМ · ДАННЫЕ ОТ ${hm(STATUS.okAt)}`; bad = true; }
    else text = `ОБНОВЛЕНО ${hm(STATUS.okAt)}`;
  } else if (STATUS && STATUS.error) { text = '! ' + STATUS.error.slice(0, 40).toUpperCase(); bad = true; }
  sync.textContent = text;
  sync.className = bad ? 'bad' : '';
}

// ---------------------------------------------------------------------------- часы и общий цикл
function renderClock(now) {
  const p = P(now);
  $('hh').textContent = pad(p.h);
  $('mm').textContent = pad(p.mi);
  $('ss').textContent = eff().showSeconds ? pad(p.s) : '';
  $('colon').classList.toggle('off', p.s % 2 === 1);
  const d = dnum(p);
  $('wd').textContent = wdLong(d);
  $('dm').textContent = dtf('dm', {day: 'numeric', month: 'long'}, 'ru-RU', 'UTC').format(d * 864e5);
}

function nightAndShift(now) {
  const cfg = eff(), h = P(now).h;
  let night = false;
  if (cfg.nightEnabled && cfg.nightFrom !== cfg.nightTo)
    night = cfg.nightFrom > cfg.nightTo ? (h >= cfg.nightFrom || h < cfg.nightTo) : (h >= cfg.nightFrom && h < cfg.nightTo);
  document.body.style.setProperty('--dimo', night && !PREVIEW ? String(1 - cfg.nightLevel) : '0');
  const t = Date.now() / 1000, inner = $('inner');
  const k = cfg.burnIn ? 1 : 0;
  document.body.style.setProperty('--sx', Math.round(Math.sin(t / 540 * 6.2832) * 3 * k) + 'px');
  document.body.style.setProperty('--sy', Math.round(Math.cos(t / 420 * 6.2832) * 2 * k) + 'px');
  void inner;
}

function tick() {
  const now = nowMs();
  renderClock(now);
  renderHero(now);
  const minute = Math.floor(now / 60000);
  if (dirty || minute !== lastMinute) {
    lastMinute = minute; dirty = false;
    renderTimeline(now); renderAgenda(now); renderFooter(now); nightAndShift(now);
  }
  if (eff().theme === 'season' && resolveTheme('season') !== document.body.dataset.theme) applySettings();
  if (!PREVIEW && Date.now() - LOADED_AT > 12 * 3600e3 && P(now).h === 4) location.reload();
}

addEventListener('resize', () => { applySettings(); lastHero = ''; });
// высота повестки меняется после загрузки шрифтов и при смене настроек — подгоняем число рядов заново
new ResizeObserver(() => { dirty = true; }).observe($('agenda'));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { dirty = true; });
if (PREVIEW) addEventListener('message', ev => {
  if (ev.origin !== location.origin || !ev.data || ev.data.type !== 'settings') return;
  S = {...S, ...ev.data.settings}; lastHero = ''; applySettings();
});



// -------------------------------------------------------------------------- украшения (модуль decor.js)
DECOR.nowParts = () => P(nowMs());
const setupDecor = (theme, on) => DECOR.setup(theme, on);

applySettings();
if (eff().fx >= 2 && !PREVIEW) { document.body.classList.add('boot'); setTimeout(() => document.body.classList.remove('boot'), 1300); }
tick(); setInterval(tick, 1000);
poll(); setInterval(poll, 30000);
})();
