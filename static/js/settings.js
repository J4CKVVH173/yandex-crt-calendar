(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const NUM = new Set(['fx', 'fontScale', 'safe', 'days', 'warnMinutes', 'nightFrom', 'nightTo', 'nightLevel']);
const REFETCH = new Set(['days', 'hideDeclined', 'timezone']);
let ME = null, pvAt = '', pvAr = '4/3', pendingRefetch = false;

async function api(method, url, body) {
  const r = await fetch(url, {method, headers: body ? {'content-type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  if (r.status === 401) { location.href = '/login'; throw new Error('Нужно войти'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || 'Ошибка ' + r.status);
  return j;
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const hhmm = ts => new Date(ts * 1000).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});

// ----------------------------------------------------------------------------------- Яндекс
function renderYandex() {
  const y = ME.yandex, el = $('#y-body');
  if (!y) {
    el.innerHTML = `
      <ol class="steps">
        <li>Откройте <a href="https://id.yandex.ru/security/app-passwords" target="_blank" rel="noopener">id.yandex.ru → Безопасность → Пароли приложений</a>.</li>
        <li>Нажмите «Создать пароль приложения», выберите тип <b>«Календарь»</b> и скопируйте пароль — он показывается один раз.</li>
        <li>Введите ниже логин Яндекса (полный адрес; для Яндекс 360 для бизнеса — адрес на домене организации) и этот пароль.</li>
      </ol>
      <label for="y-email">Логин (почта)</label>
      <input type="text" id="y-email" placeholder="login@yandex.ru" autocomplete="off" spellcheck="false">
      <label for="y-pass">Пароль приложения</label>
      <input type="password" id="y-pass" placeholder="xxxxxxxxxxxxxxxx" autocomplete="new-password">
      <div class="row" style="margin-top:16px"><button id="y-go">Подключить</button></div>
      <div class="msg" id="y-msg"></div>
      <p class="hint">Основной пароль от Яндекса не подойдёт: к календарю по протоколу CalDAV Яндекс пускает только по паролю приложения. Он хранится на малинке в зашифрованном виде и открывает только календарь. Иногда новый пароль начинает работать не сразу.</p>`;
    $('#y-go').onclick = connect;
    return;
  }
  const bad = !!y.lastError;
  el.innerHTML = `
    <div class="status"><span class="dot ${bad ? 'bad' : ''}"></span>
      <div><b>${esc(y.email)}</b><br><small>${bad ? esc(y.lastError) : (y.lastOk ? 'Данные обновлены в ' + hhmm(y.lastOk) : 'Загружаю…')}${bad && y.lastOk ? ' · последние данные от ' + hhmm(y.lastOk) : ''}</small></div></div>
    <div class="row">
      <button id="y-refresh">Обновить сейчас</button>
      <button class="ghost" id="y-disc">Найти новые календари</button>
      <button class="danger" id="y-off">Отключить</button>
    </div>
    <div class="msg" id="y-msg"></div>`;
  $('#y-refresh').onclick = async e => {
    e.target.disabled = true; setMsg('#y-msg', 'Читаю календарь…');
    try { const r = await api('POST', '/api/refresh'); setMsg('#y-msg', r.error ? r.error : `Готово — событий: ${r.events}`, r.error ? 'err' : 'ok'); await load(false); reloadPreview(); }
    catch (err) { setMsg('#y-msg', err.message, 'err'); } finally { e.target.disabled = false; }
  };
  $('#y-disc').onclick = async e => {
    e.target.disabled = true; setMsg('#y-msg', 'Ищу календари…');
    try { await api('POST', '/api/yandex/rediscover'); await load(false); setMsg('#y-msg', 'Список календарей обновлён', 'ok'); }
    catch (err) { setMsg('#y-msg', err.message, 'err'); } finally { e.target.disabled = false; }
  };
  $('#y-off').onclick = async () => {
    if (!confirm('Отключить Яндекс? Пароль приложения и список календарей будут удалены с малинки.')) return;
    await api('DELETE', '/api/yandex'); await load(); reloadPreview();
  };
}
async function connect(e) {
  const email = $('#y-email').value.trim(), password = $('#y-pass').value;
  if (!email || !password) return setMsg('#y-msg', 'Заполните логин и пароль приложения', 'err');
  e.target.disabled = true; setMsg('#y-msg', 'Проверяю подключение к caldav.yandex.ru…');
  try { await api('POST', '/api/yandex/connect', {email, password}); await load(); setTimeout(reloadPreview, 2500); }
  catch (err) { setMsg('#y-msg', err.message, 'err'); e.target.disabled = false; }
}
function setMsg(sel, text, cls = '') { const m = $(sel); if (m) { m.textContent = text; m.className = 'msg ' + cls; } }

// ------------------------------------------------------------------------------- календари
function renderCals() {
  const el = $('#cals');
  if (!ME.yandex) { el.innerHTML = '<p class="dim">Сначала подключите Яндекс Календарь.</p>'; return; }
  if (!ME.calendars.length) { el.innerHTML = '<p class="dim">Календари не найдены.</p>'; return; }
  el.innerHTML = ME.calendars.map(c => `
    <div class="cal" data-id="${c.id}">
      <div class="name"><i class="g g${c.glyph}" style="--c:${c.color}"></i><span>${esc(c.name)}</span></div>
      <label class="check"><input type="checkbox" data-c="enabled" ${c.enabled ? 'checked' : ''}>показывать</label>
      <div class="fields">
        <div><label>Название на экране</label><input type="text" data-c="customName" maxlength="40" value="${esc(c.customName)}" placeholder="${esc(c.name)}"></div>
        <div><label>Коротко</label><input type="text" data-c="short" maxlength="8" value="${esc(c.short)}" placeholder="${esc(c.name.slice(0, 6))}"></div>
        <div><label>Цвет</label><input type="color" data-c="color" value="${c.color}"></div>
        <div><label>Фигурка</label><div class="shapes">${[0, 1, 2, 3, 4, 5].map(g =>
          `<button type="button" data-glyph="${g}" class="${g === c.glyph ? 'on' : ''}"><i class="g g${g}"></i></button>`).join('')}</div></div>
      </div>
      <label class="check" style="grid-column:1/-1"><input type="checkbox" data-c="hideTitles" ${c.hideTitles ? 'checked' : ''}>скрывать названия событий («Занято») — если монитор виден посторонним</label>
    </div>`).join('');
}
const saveCal = debounce(async (id, patch) => {
  try { const r = await api('PUT', '/api/calendars/' + id, patch); ME.calendars = r.calendars; reloadPreviewSoon(); }
  catch (err) { alert(err.message); }
}, 350);
$('#cals').addEventListener('input', e => {
  const t = e.target, card = t.closest('.cal'); if (!card || !t.dataset.c) return;
  const id = +card.dataset.id, k = t.dataset.c;
  const v = t.type === 'checkbox' ? t.checked : t.value;
  const c = ME.calendars.find(x => x.id === id); c[k] = v;
  if (k === 'color') card.querySelector('.name .g').style.setProperty('--c', v);
  saveCal(id, {[k]: v});
});
$('#cals').addEventListener('click', e => {
  const b = e.target.closest('[data-glyph]'); if (!b) return;
  const card = b.closest('.cal'), id = +card.dataset.id, g = +b.dataset.glyph;
  card.querySelectorAll('.shapes button').forEach(x => x.classList.toggle('on', x === b));
  card.querySelector('.name .g').className = 'g g' + g;
  ME.calendars.find(x => x.id === id).glyph = g;
  saveCal(id, {glyph: g});
});

// ------------------------------------------------------------------------------ настройки
function fillTimezones() {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) {}
  if (!zones.length) zones = ['Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka'];
  if (!zones.includes(ME.settings.timezone)) zones.unshift(ME.settings.timezone);
  $('#tz').innerHTML = zones.map(z => `<option>${z}</option>`).join('');
}
function fillSettings() {
  const s = ME.settings;
  document.querySelectorAll('[data-s]').forEach(el => {
    const k = el.dataset.s;
    if (el.type === 'radio') el.checked = s[k] === el.value;
    else if (el.type === 'checkbox') el.checked = !!s[k];
    else el.value = s[k];
  });
  showValues();
}
function showValues() {
  const s = ME.settings;
  $('#fx-v').textContent = ['выкл', 'лёгкие', 'как у ЭЛТ', 'максимум'][s.fx];
  $('#fontScale-v').textContent = Math.round(s.fontScale * 100) + '%';
  $('#safe-v').textContent = s.safe + '%';
  $('#nightLevel-v').textContent = Math.round(s.nightLevel * 100) + '%';
}
const persist = debounce(async () => {
  const refetch = pendingRefetch; pendingRefetch = false;
  try {
    ME.settings = await api('PUT', '/api/settings', ME.settings);
    setMsg('#s-msg', 'Сохранено', 'ok'); setTimeout(() => setMsg('#s-msg', ''), 1500);
    if (refetch) { await api('POST', '/api/refresh'); reloadPreview(); }
  } catch (err) { setMsg('#s-msg', err.message, 'err'); }
}, 500);
document.addEventListener('input', onSetting);
document.addEventListener('change', onSetting);
function onSetting(e) {
  const el = e.target, k = el.dataset && el.dataset.s; if (!k) return;
  if (el.type === 'radio' && !el.checked) return;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (NUM.has(k)) v = Number(v);
  if (ME.settings[k] === v) return;
  ME.settings[k] = v; showValues();
  postToPreview();
  pendingRefetch = pendingRefetch || REFETCH.has(k);
  persist();
}
function postToPreview() {
  const w = $('#pv').contentWindow;
  if (w) w.postMessage({type: 'settings', settings: ME.settings}, location.origin);
}

// ------------------------------------------------------------------------- адрес и превью
function monitorUrl() { return `${location.origin}/d/${ME.displayToken}`; }
function renderUrl() {
  $('#u-code').textContent = monitorUrl();
  $('#u-open').href = monitorUrl();
  $('#kiosk').textContent = `chromium-browser --kiosk --noerrdialogs --disable-infobars --incognito \\\n  "${monitorUrl()}"`;
}
$('#u-copy').onclick = async e => {
  try { await navigator.clipboard.writeText(monitorUrl()); e.target.textContent = 'Скопировано'; }
  catch (err) { const r = document.createRange(); r.selectNodeContents($('#u-code')); getSelection().removeAllRanges(); getSelection().addRange(r); e.target.textContent = 'Выделено — Ctrl+C'; }
  setTimeout(() => e.target.textContent = 'Копировать', 2000);
};
$('#u-regen').onclick = async () => {
  if (!confirm('Старый адрес перестанет работать, и монитор нужно будет открыть по новому. Сменить?')) return;
  ME.displayToken = (await api('POST', '/api/token/regenerate')).displayToken; renderUrl(); setPreview();
};
function setPreview() {
  $('#pv').src = `/d/${ME.displayToken}?preview=1${pvAt ? '&at=' + encodeURIComponent(pvAt) : ''}`;
}
function reloadPreview() { setPreview(); }
const reloadPreviewSoon = debounce(reloadPreview, 700);
$('#pv').addEventListener('load', () => setTimeout(postToPreview, 400));
$('#fmt').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  pvAr = b.dataset.ar; $('#in').style.setProperty('--ar', pvAr);
  document.querySelectorAll('#fmt button').forEach(x => x.className = x === b ? 'on' : 'ghost');
});
function zonedToUtc(local, tz) {          // «2026-11-02T09:47» в часовом поясе tz → момент времени
  const [d, t] = local.split('T'), [y, mo, da] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number);
  const target = Date.UTC(y, mo - 1, da, h, mi);
  const f = new Intl.DateTimeFormat('en-GB', {timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
  let utc = target;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(f.formatToParts(utc).map(x => [x.type, x.value]));
    utc -= Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - target;
  }
  return new Date(utc).toISOString();
}
$('#at').addEventListener('change', e => { pvAt = e.target.value ? zonedToUtc(e.target.value, ME.settings.timezone) : ''; setPreview(); });
$('#at-reset').onclick = () => { $('#at').value = ''; pvAt = ''; setPreview(); };
$('#logout').onclick = async () => { await api('POST', '/api/logout'); location.href = '/login'; };

// ------------------------------------------------------------------------------------ старт
async function load(full = true) {
  ME = await api('GET', '/api/me');
  $('#who').textContent = ME.login;
  renderYandex(); renderCals();
  if (full) { fillTimezones(); fillSettings(); renderUrl(); if (!$('#pv').src) setPreview(); }
}
load();
// статус подключения обновляется сам, пока страница открыта
setInterval(() => { if (!document.hidden && ME && ME.yandex) api('GET', '/api/me').then(m => { ME.yandex = m.yandex; if (!document.activeElement || document.activeElement.tagName === 'BODY') renderYandex(); }).catch(() => {}); }, 20000);
})();
