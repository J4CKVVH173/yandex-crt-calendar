/* Праздничные украшения экрана: «сцена» внизу, летающие и падающие детали на холсте, гирлянда.
   Самодостаточный модуль: display.js вызывает DECOR.setup(тема, включено) и задаёт DECOR.nowParts. */
'use strict';
const DECOR = (() => {
  const $ = id => document.getElementById(id);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const pc = $('particles'), px = pc.getContext('2d');
  const api = {nowParts: () => ({mo: 0, d: 0, h: 12, mi: 0, s: 0}), setup: null, art: {}};

  // ------------------------------------------------------------------------------- формы 24×24
  const MAPLE = 'M12 1.5L14 6L17 4.6L16.2 9.3L21.5 8L19.3 12.6L22 14.5L16.3 15.5L17 18.6L12.8 17.5L12.8 22.5L11.2 22.5L11.2 17.5L7 18.6L7.7 15.5L2 14.5L4.7 12.6L2.5 8L7.8 9.3L7 4.6L10 6Z';
  const LEAF = 'M12 1.5C21.5 5 23 14 12 22.5C1 14 2.5 5 12 1.5Z M11.4 6.5H12.6V19H11.4Z M12.6 11L17 8.6L17.4 9.6L12.6 12.6Z M11.4 14L7 11.6L6.6 12.6L11.4 15.6Z';
  const GHOST = 'M12 2C7 2 4.5 5.5 4.5 10L4.5 21.8L7.5 19.2L10 21.8L12 19.6L14 21.8L16.5 19.2L19.5 21.8L19.5 10C19.5 5.5 17 2 12 2Z ' +
    'M9.6 7.4c-.9 0-1.5.9-1.5 2s.6 2 1.5 2 1.5-.9 1.5-2-.6-2-1.5-2Z M14.4 7.4c-.9 0-1.5.9-1.5 2s.6 2 1.5 2 1.5-.9 1.5-2-.6-2-1.5-2Z M12 13.2c-1 0-1.7.7-1.7 1.7s.7 1.7 1.7 1.7 1.7-.7 1.7-1.7-.7-1.7-1.7-1.7Z';
  const flakePath = () => {
    let d = '';
    for (let k = 0; k < 3; k++) {
      const a = (90 + 60 * k) * Math.PI / 180;
      for (const s of [1, -1]) {
        d += `M12 12L${(12 + s * 10 * Math.cos(a)).toFixed(2)} ${(12 - s * 10 * Math.sin(a)).toFixed(2)}`;
        const bx = 12 + s * 6.2 * Math.cos(a), by = 12 - s * 6.2 * Math.sin(a);
        for (const t of [1, -1]) {
          const b = a + t * 50 * Math.PI / 180;
          d += `M${bx.toFixed(2)} ${by.toFixed(2)}L${(bx + s * 3.2 * Math.cos(b)).toFixed(2)} ${(by - s * 3.2 * Math.sin(b)).toFixed(2)}`;
        }
      }
    }
    return d;
  };
  const P2 = {maple: new Path2D(MAPLE), leaf: new Path2D(LEAF), ghost: new Path2D(GHOST), flake: new Path2D(flakePath())};

  // ================================================================ СЦЕНА (SVG 960×90, внизу экрана)
  const svg = inner => `<svg viewBox="0 0 960 90" preserveAspectRatio="xMidYMax slice"><style>` +
    `.so{fill:var(--bg-hi);stroke:currentColor;stroke-opacity:.5;stroke-width:1;stroke-linejoin:round}` +
    `.se{fill:none;stroke:currentColor;stroke-opacity:.28;stroke-width:.8;stroke-linecap:round}` +
    `.sl{fill:none;stroke-linecap:round;stroke-linejoin:round}</style>${inner}</svg>`;

  const rim = (op = .5) => `style="fill:var(--bg-hi);stroke:currentColor;stroke-opacity:${op};stroke-width:1;stroke-linejoin:round"`;

  // --- кладбище
  const grave = (x, y, kind, k = 1, rot = 0) => {
    let d, eng = '';
    if (kind === 'arch') {
      d = `M${-8 * k} 0V${-22 * k}A${8 * k} ${8 * k} 0 0 1 ${8 * k} ${-22 * k}V0Z`;
      eng = `<path class="se" d="M${-5 * k} ${-3 * k}V${-21 * k}A${5 * k} ${5 * k} 0 0 1 ${5 * k} ${-21 * k}V${-3 * k}"/><path class="se" d="M0 ${-19 * k}v${8 * k}M${-2.8 * k} ${-16.5 * k}h${5.6 * k}" style="stroke-opacity:.45"/>`;
    } else if (kind === 'cross') {
      d = `M${-3 * k} 0V${-14 * k}H${-9 * k}V${-19 * k}H${-3 * k}V${-29 * k}H${3 * k}V${-19 * k}H${9 * k}V${-14 * k}H${3 * k}V0Z`;
      eng = `<path class="se" d="M0 ${-26 * k}V${-4 * k}"/>`;
    } else if (kind === 'obelisk') {
      d = `M${-7 * k} 0L${-5 * k} ${-27 * k}L0 ${-35 * k}L${5 * k} ${-27 * k}L${7 * k} 0Z`;
      eng = `<path class="se" d="M${-5 * k} ${-27 * k}H${5 * k}M${-6 * k} ${-12 * k}H${6 * k}"/>`;
    } else {
      d = `M${-10 * k} 0V${-14 * k}L${-7 * k} ${-18 * k}H${7 * k}L${10 * k} ${-14 * k}V0Z`;
      eng = `<path class="se" d="M${-5 * k} ${-12 * k}H${5 * k}M${-5 * k} ${-8 * k}H${3 * k}M${-5 * k} ${-4 * k}H${5 * k}"/>`;
    }
    const grass = `<path class="sl" stroke="currentColor" stroke-opacity=".4" stroke-width="1" d="M${-12 * k} 1q1.5-5 2.5 0M${-8 * k} 1q1-6 2.2 0M${9 * k} 1q1.2-5 2.4 0M${12 * k} 1q1-4 2 0"/>`;
    return `<g transform="translate(${x} ${y}) rotate(${rot})"><path d="${d}" ${rim(.55)}/>${eng}${grass}</g>`;
  };
  const fence = (x0, x1, y) => {
    let d = '';
    for (let x = x0; x <= x1; x += 8) d += `M${x} ${y}V${y - 19}l1.6-3.4 1.6 3.4V${y}Z`;
    return `<path d="M${x0} ${y - 13}H${x1}M${x0} ${y - 6}H${x1}" class="sl" stroke="currentColor" stroke-opacity=".4" stroke-width="1.2"/>` +
      `<path d="${d}" ${rim(.4)} style="fill:var(--bg-hi);stroke:currentColor;stroke-opacity:.4;stroke-width:.8"/>`;
  };
  const pumpkin = (x, y, r, lit = true) => {
    const c = 'style="fill:var(--fg);fill-opacity:.82"';
    const lobe = (cx, rx, ry) => `<ellipse cx="${cx}" cy="${-ry * .95}" rx="${rx}" ry="${ry}" ${c}/>`;
    return `<g transform="translate(${x} ${y})">` +
      (lit ? `<circle cy="${-r * .9}" r="${r * 2.1}" fill="url(#pg)"/>` : '') +
      lobe(-r * .62, r * .62, r * .82) + lobe(r * .62, r * .62, r * .82) + lobe(0, r * .72, r * .95) +
      `<path d="M${-r * .25} ${-r * 1.8}c0-.8.2-1.8 1.6-2.4l1.2 1c-.7.5-.8 1-.7 1.7Z" fill="#6a8a3a"/>` +
      `<path d="M${-r * .27} ${-r * .15}Q${-r * .3} ${-r * 1.0} ${-r * .27} ${-r * 1.75}M${r * .27} ${-r * .15}Q${r * .3} ${-r * 1.0} ${r * .27} ${-r * 1.75}" fill="none" stroke="#000" stroke-opacity=".3" stroke-width=".9"/>` +
      `<g fill="${lit ? '#ffe08a' : '#000'}" fill-opacity="${lit ? 1 : .45}">` +
      `<path d="M${-r * .5} ${-r * 1.05}l${r * .3} 0 ${-r * .15} ${-r * .3}Z M${r * .2} ${-r * 1.05}l${r * .3} 0 ${-r * .15} ${-r * .3}Z"/>` +
      `<path d="M${-r * .5} ${-r * .62}l${r * .22} ${r * .2} ${r * .14} ${-r * .12} ${r * .14} ${r * .12} ${r * .14} ${-r * .12} ${r * .22} ${r * .12} ${-r * .12} ${r * .3} ${-r * .76} 0Z"/></g></g>`;
  };
  const bare = (x, y, k = 1) => {
    const L = (d, w) => `<path class="sl" stroke="currentColor" stroke-opacity=".6" stroke-width="${w * k}" d="${d}"/>`;
    return `<g transform="translate(${x} ${y}) scale(${k})">` +
      L('M0 0C-1.5-10 1.5-22 0-36', 3.6) + L('M0-20C-6-24-10-30-16-41', 2.2) + L('M-9.5-30l-6-1M-13-36l-6-3', 1.2) +
      L('M0-27C5-31 9-36 14-47', 2.2) + L('M8.5-36l7-1M12-42l6-4', 1.2) + L('M0-36L-3.5-48M-2-43l4-5', 1.5) +
      `</g>`;
  };
  const moonbat = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" style="fill:currentColor;fill-opacity:.5">` +
    `<path d="M0 0l2-3 1 3c3-1 7-2 12-5-1 3-1 6 0 9-2-2-5-1-6 1-1-2-3-2-4 0-1 3-2 5-3 8-1-3-2-5-3-8-1-2-3-2-4 0-1-2-4-3-6-1 1-3 1-6 0-9 5 3 9 4 12 5Z"/></g>`;

  // --- зима
  const fir = (x, y, w, h, tiers, body, snow) => {
    let o = '';
    for (let i = 0; i < tiers; i++) {
      const top = y - h + (h * .78) * i / tiers, bot = y - h * .18 + (h * .18) * (i + 1) / tiers - (tiers - 1 - i) * 0 ;
      const tb = y - h + h * .52 * (i + 1) / tiers + h * .30 * (i + 1) / tiers, ww = w * (.42 + .58 * (i + 1) / tiers);
      o += `<path d="M${x} ${top}L${x + ww} ${tb}Q${x + ww * .5} ${tb - h * .05} ${x} ${tb - h * .01}Q${x - ww * .5} ${tb - h * .05} ${x - ww} ${tb}Z" fill="${body}"/>`;
      if (snow) o += `<path d="M${x} ${top}L${x + ww * .55} ${top + (tb - top) * .5}Q${x + ww * .2} ${top + (tb - top) * .42} ${x} ${top + (tb - top) * .52}Q${x - ww * .2} ${top + (tb - top) * .42} ${x - ww * .55} ${top + (tb - top) * .5}Z" fill="#eaf8ff" fill-opacity=".8"/>`;
    }
    return o + `<rect x="${x - w * .1}" y="${y - h * .1}" width="${w * .2}" height="${h * .12}" fill="#3b2a1a" fill-opacity=".8"/>`;
  };
  const cabin = (x, y) => `<g transform="translate(${x} ${y})">` +
    `<circle cx="-4" cy="-13" r="26" fill="url(#wg)"/>` +
    `<path d="M-24 0V-20H24V0Z" ${rim(.5)}/>` +
    `<path d="M-28 -19L0 -38L28 -19Z" style="fill:var(--bg-hi);stroke:currentColor;stroke-opacity:.5" />` +
    `<path d="M-28 -19L0 -38L28 -19L22 -19L0 -33L-22 -19Z" fill="#eaf8ff" fill-opacity=".85"/>` +
    `<rect x="13" y="-38" width="6" height="12" ${rim(.5)}/><rect x="12" y="-40" width="8" height="3" fill="#eaf8ff" fill-opacity=".85"/>` +
    `<rect x="-17" y="-15" width="13" height="10" fill="#ffcf6b"/><path d="M-10.5 -15V-5M-17 -10H-4" stroke="#6b3d10" stroke-width="1"/>` +
    `<rect x="6" y="-14" width="9" height="14" fill="#2a1a0c" fill-opacity=".8"/>` +
    `<path class="sl" stroke="#eaf8ff" stroke-opacity=".35" stroke-width="2.2" d="M16 -43C12 -50 22 -53 17 -61C14 -66 20 -70 18 -76"/></g>`;
  const snowman = (x, y) => `<g transform="translate(${x} ${y})">` +
    `<circle cy="-7" r="7" fill="#eaf8ff" fill-opacity=".85"/><circle cy="-18" r="5.2" fill="#eaf8ff" fill-opacity=".85"/><circle cy="-26.5" r="3.8" fill="#eaf8ff" fill-opacity=".9"/>` +
    `<path d="M-4 -29.5h8l-1.4-5h-5.2Z" fill="#2c4b66"/><path d="M-3.8 -29.2h7.6" stroke="#ff5a5a" stroke-width="1"/>` +
    `<path d="M0 -26.4l5 .8-5 .9Z" fill="#ff9a2e"/><circle cx="-1.4" cy="-27.6" r=".5" fill="#10202c"/><circle cx="1.4" cy="-27.6" r=".5" fill="#10202c"/>` +
    `<path d="M-4 -22.2c2.5 1.2 5.5 1.2 8 0l.4 2c-2.8 1.2-5.8 1.2-8.8 0Z" fill="#ff5a5a" fill-opacity=".9"/>` +
    `<circle cy="-8" r=".9" fill="#10202c"/><circle cy="-13" r=".9" fill="#10202c"/>` +
    `<path class="sl" stroke="#6b4a2a" stroke-width="1.2" d="M-5-17l-8-5M5-17l8-5"/></g>`;
  const sparkle = (x, y, r) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="#fff" fill-opacity=".7"/>`;

  // --- Новый год
  const gift = (x, y, w, h, c1, c2) => `<g transform="translate(${x} ${y})"><rect x="${-w / 2}" y="${-h}" width="${w}" height="${h}" fill="${c1}" fill-opacity=".9"/>` +
    `<rect x="${-w / 2}" y="${-h}" width="${w}" height="${h * .22}" fill="#000" fill-opacity=".18"/>` +
    `<rect x="${-1.1}" y="${-h}" width="2.2" height="${h}" fill="${c2}"/><rect x="${-w / 2}" y="${-h * .55}" width="${w}" height="2.2" fill="${c2}"/>` +
    `<path d="M0 ${-h}C-4 ${-h - 5} -7 ${-h - 1} 0 ${-h}C4 ${-h - 5} 7 ${-h - 1} 0 ${-h}Z" fill="${c2}"/></g>`;
  const bigTree = (x, y, w, h) => {
    let o = fir(x, y, w, h, 5, '#2c7a52', false);
    const cols = ['#ff4d4d', '#ffd24d', '#4dd2ff', '#ff9be6', '#6dff8a'];
    // гирлянда зигзагом и шарики
    for (let i = 0; i < 5; i++) {
      const tb = y - h + h * .52 * (i + 1) / 5 + h * .30 * (i + 1) / 5, ww = w * (.42 + .58 * (i + 1) / 5) * .8;
      o += `<path class="sl" stroke="#ffd24d" stroke-opacity=".85" stroke-width="1" stroke-dasharray="2 1.6" d="M${x - ww} ${tb - h * .06}Q${x} ${tb + h * .02} ${x + ww} ${tb - h * .06}"/>`;
      for (let k = 0; k < 3; k++) {
        const px_ = x + (k - 1) * ww * .62 + ((i % 2) ? ww * .18 : -ww * .18), py_ = tb - h * (.03 + (k === 1 ? .0 : .05));
        o += `<circle class="sb" style="animation-delay:-${((i * 3 + k) * .43 % 2.2).toFixed(2)}s" cx="${px_.toFixed(1)}" cy="${py_.toFixed(1)}" r="1.9" fill="${cols[(i + k * 2) % 5]}"/>`;
      }
    }
    return o + `<path d="M${x} ${y - h - 7}l2 4.4 4.8.5-3.6 3.2 1.1 4.8-4.3-2.5-4.3 2.5 1.1-4.8-3.6-3.2 4.8-.5Z" fill="#ffe08a"/><circle cx="${x}" cy="${y - h - 3}" r="9" fill="url(#sg)"/>`;
  };

  // --- осень
  const mushroom = (x, y, r) => `<g transform="translate(${x} ${y})"><path d="M${-r * .35} 0L${-r * .3} ${-r * .9}H${r * .3}L${r * .35} 0Z" fill="#f3e2c0" fill-opacity=".85"/>` +
    `<path d="M${-r} ${-r * .9}C${-r} ${-r * 2.1} ${r} ${-r * 2.1} ${r} ${-r * .9}Z" fill="#d6492a" fill-opacity=".92"/>` +
    `<circle cx="${-r * .4}" cy="${-r * 1.35}" r="${r * .17}" fill="#fff" fill-opacity=".85"/><circle cx="${r * .3}" cy="${-r * 1.5}" r="${r * .14}" fill="#fff" fill-opacity=".85"/><circle cx="${r * .5}" cy="${-r * 1.1}" r="${r * .12}" fill="#fff" fill-opacity=".85"/></g>`;
  const mleaf = (x, y, s, r, c, o = .8, kind = 'maple') => `<path transform="translate(${x} ${y}) rotate(${r}) scale(${s / 12}) translate(-12 -12)" d="${kind === 'maple' ? MAPLE : LEAF}" fill="${c}" fill-opacity="${o}" fill-rule="evenodd"/>`;

  const SCENE = {
    halloween: () => svg(`<defs>
        <radialGradient id="pg"><stop offset="0" stop-color="#ff9a2e" stop-opacity=".5"/><stop offset="1" stop-color="#ff9a2e" stop-opacity="0"/></radialGradient>
        <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="1" stop-color="currentColor" stop-opacity=".3"/></linearGradient></defs>
      <path d="M0 90V70C80 62 150 72 230 66S380 60 480 66S690 72 770 64S900 62 960 66V90Z" fill="currentColor" opacity=".12"/>
      <rect y="60" width="960" height="30" fill="url(#mist)"/>
      ${fence(334, 750, 67)}
      <path d="M240 90C300 76 380 66 460 68S660 64 770 74C800 78 830 84 850 90Z" style="fill:var(--bg)" fill-opacity=".92"/>
      ${bare(728, 72, 1.05)}${moonbat(690, 30, .7)}${moonbat(712, 22, .5)}
      ${grave(368, 72, 'slab', 1, -4)}${grave(404, 73, 'cross', 1, 3)}${grave(590, 72, 'arch', 1.1, 0)}${grave(628, 73, 'obelisk', .9, -2)}
      ${pumpkin(460, 76, 10)}${pumpkin(522, 77, 7)}${pumpkin(680, 76, 12)}`),
    winter: () => svg(`<defs>
        <radialGradient id="wg"><stop offset="0" stop-color="#ffcf6b" stop-opacity=".5"/><stop offset="1" stop-color="#ffcf6b" stop-opacity="0"/></radialGradient></defs>
      <path d="M0 90V62C100 50 180 64 270 56S440 46 520 58S760 66 850 52S930 54 960 56V90Z" fill="#dff3ff" opacity=".16"/>
      ${fir(364, 70, 20, 38, 4, '#9cc4e2', true)}${fir(398, 72, 15, 28, 4, '#8eb6d4', true)}
      ${cabin(500, 74)}
      ${fir(590, 72, 17, 32, 4, '#9cc4e2', true)}${fir(620, 73, 21, 40, 4, '#9cc4e2', true)}
      ${snowman(676, 76)}
      <path d="M0 90V76C120 66 200 80 330 72S560 64 680 76S880 74 960 70V90Z" fill="#eaf8ff" opacity=".2"/>
      <path d="M250 90C330 76 440 80 560 76S720 74 820 90Z" fill="#f4fbff" opacity=".28"/>
      ${sparkle(430, 80, 2.4)}${sparkle(566, 82, 2)}${sparkle(716, 80, 2.6)}${sparkle(346, 84, 1.8)}`),
    newyear: () => svg(`<defs>
        <radialGradient id="sg"><stop offset="0" stop-color="#ffe08a" stop-opacity=".7"/><stop offset="1" stop-color="#ffe08a" stop-opacity="0"/></radialGradient></defs>
      <style>.sb{animation:tw 2.2s ease-in-out infinite}</style>
      <path d="M0 90V80C150 74 330 82 480 77S800 74 960 80V90Z" fill="#ffe08a" opacity=".07"/>
      ${fir(420, 80, 14, 34, 4, '#24664a', false)}${fir(660, 80, 15, 38, 4, '#24664a', false)}
      ${bigTree(540, 82, 25, 54)}
      ${gift(494, 82, 12, 9, '#c9363a', '#ffd24d')}${gift(510, 82, 9, 7, '#2f86c9', '#fff')}${gift(572, 82, 11, 8, '#2f9a5a', '#ff9be6')}${gift(588, 82, 8, 10, '#8d4bc2', '#ffd24d')}
      <path d="M260 90C340 80 440 84 540 81S720 80 800 90Z" fill="#eaf8ff" opacity=".16"/>`),
    autumn: () => {
      const C = ['#e4572e', '#f29e4c', '#d9a441', '#a8431f', '#c9772d', '#bf3b22'];
      let o = '';
      for (let i = 0; i < 46; i++) {
        const t = i / 45, x = 420 + t * 240 + ((i * 17) % 21 - 10), top = 80 - 20 * Math.sin(t * Math.PI), y = top + ((i * 29) % 9) + 1;
        o += mleaf(x, y, 8 + (i * 7) % 5, (i * 53) % 360, C[i % 6], .7, i % 3 ? 'maple' : 'leaf');
      }
      return svg(`<path d="M0 90V64C100 54 180 68 280 60S470 50 560 62S790 70 880 58S940 58 960 60V90Z" fill="#e2562a" opacity=".16"/>
        <path d="M0 90V76C140 66 260 80 380 73S640 66 760 77S910 74 960 72V90Z" fill="#f29e4c" opacity=".16"/>
        <path d="M380 90C440 78 500 58 560 58S660 70 720 90Z" fill="#a8431f" fill-opacity=".5"/>${o}
        ${mushroom(380, 86, 7)}${mushroom(704, 87, 5)}
        <g transform="translate(724 86)"><ellipse rx="9" ry="7" cy="-7" fill="var(--fg)" fill-opacity=".8"/><ellipse rx="5" ry="7" cy="-7" fill="var(--fg)" fill-opacity=".55"/><path d="M-1-14l1-3h2.4l-.8 3Z" fill="#6a8a3a"/></g>`);
    },
  };

  // ============================================================ КАНВАС: падающие и летающие детали
  const LEAFC = ['#e4572e', '#f29e4c', '#d9a441', '#a8431f', '#c9772d'];
  const EMBER = ['#ff8a1f', '#ffb347', '#a96bff', '#ff6a1a'];
  const FWC = ['#ffe08a', '#ff5a5a', '#6dd5ff', '#8dff9a', '#ff9be6'];
  let PK = null, PP = [], STARS = [], BAT = null, GH = null, nextBat = 0, nextGh = 0, lastDraw = 0, PTHEME = '';
  let FW = [], SPARK = [], nextFW = 0;

  function spawn(kind, anywhere, sc) {
    const W = pc.width, H = pc.height;
    const o = {x: rnd(0, W), y: anywhere ? rnd(0, H) : -24, ph: rnd(0, 6.28), t: 0};
    if (kind === 'leaves') Object.assign(o, {s: rnd(10, 17) * sc, vy: rnd(22, 44) * sc, sw: rnd(14, 36) * sc, rot: rnd(0, 6.28), vr: rnd(-1.4, 1.4), c: pick(LEAFC), k: Math.random() < .45 ? 'maple' : 'leaf', fl: Math.random() < .5 ? 1 : -1});
    else if (kind === 'embers') Object.assign(o, {s: rnd(1.3, 3.4) * sc, vy: -rnd(10, 26) * sc, sw: rnd(6, 18) * sc, c: pick(EMBER), y: anywhere ? rnd(0, H) : H + 10});
    else {
      const big = Math.random() < (PTHEME === 'winter' ? .38 : .14);
      Object.assign(o, {big, s: big ? rnd(5, 8.5) * sc : rnd(1.3, 3.2) * sc, vy: rnd(16, 40) * sc, sw: rnd(8, 24) * sc, rot: rnd(0, 6.28), vr: rnd(-.5, .5)});
    }
    return o;
  }

  function setup(theme, on) {
    PTHEME = theme;
    PK = on ? ({autumn: 'leaves', halloween: 'embers', newyear: 'snow', winter: 'snow'})[theme] || null : null;
    pc.width = innerWidth; pc.height = innerHeight;
    pc.style.display = PK ? '' : 'none';
    PP = []; STARS = []; BAT = null; GH = null; FW = []; SPARK = [];
    nextBat = performance.now() + 5000; nextGh = performance.now() + 22000; nextFW = performance.now() + 4000;
    document.body.classList.toggle('has-garland', !!on && theme === 'newyear');
    const sc0 = !!on && SCENE[theme];
    document.body.classList.toggle('has-scene', !!sc0);
    $('scene').innerHTML = sc0 ? SCENE[theme]() : '';
    buildGarland();
    if (!PK) return;
    const sc = Math.max(.6, Math.min(2, innerHeight / 768));
    const n = {leaves: 20, embers: 30, snow: theme === 'winter' ? 46 : 34}[PK];
    for (let i = 0; i < n; i++) PP.push(spawn(PK, true, sc));
    if (theme === 'newyear') for (let i = 0; i < 12; i++) STARS.push({x: rnd(0, pc.width), y: rnd(pc.height * .08, pc.height * .9), r: rnd(5, 11) * sc, ph: rnd(0, 6.28), sp: rnd(1, 2.4)});
  }

  // --- гирлянда: провод и настоящие лампочки (цоколь + колба + блик + мягкое свечение)
  function buildGarland() {
    const g = $('garland');
    if (!document.body.classList.contains('has-garland')) { g.innerHTML = ''; return; }
    const W = innerWidth, h = Math.max(26, Math.round(innerHeight * .045)), n = Math.max(8, Math.round(W / (innerHeight * .085)));
    const seg = W / n, k = h / 30;
    const cols = ['#ff4d4d', '#ffd24d', '#4dd2ff', '#6dff8a'];
    let d = 'M0 3', bulbs = '';
    for (let i = 0; i < n; i++) {
      const x0 = i * seg, bx = x0 + seg / 2;
      d += ` Q${bx.toFixed(1)} ${(h * .62).toFixed(1)} ${(x0 + seg).toFixed(1)} 3`;
      const c = cols[i % 4], dl = ((i * 0.37) % 1.8).toFixed(2), by = 3 + (h * .62 - 3) / 2 - 1;   // середина провиса
      bulbs += `<g transform="translate(${bx.toFixed(1)} ${by.toFixed(1)}) scale(${k.toFixed(2)})">` +
        `<circle class="h" cy="9" r="11" fill="${c}"/>` +
        `<g class="b" style="animation-delay:-${dl}s"><path d="M0 2.4c-3.5 0-4.6 4.2-3.1 7.2.9 1.9 2.1 2.7 3.1 2.7s2.2-.8 3.1-2.7c1.5-3 .4-7.2-3.1-7.2Z" fill="${c}"/>` +
        `<ellipse cx="-1.2" cy="6" rx=".9" ry="1.6" fill="#fff" fill-opacity=".7"/></g>` +
        `<rect x="-1.9" y="-.4" width="3.8" height="3.2" rx=".6" fill="#1d4a33"/></g>`;
    }
    g.innerHTML = `<svg width="${W}" height="${h}" viewBox="0 0 ${W} ${h}"><path class="w" d="${d}"/>${bulbs}</svg>`;
  }

  // ------------------------------------------------------------------------------------ рисовалки
  function drawPath(p, x, y, size, rot, flip) {
    px.save(); px.translate(x, y); px.rotate(rot); px.scale(size / 12 * flip, size / 12); px.translate(-12, -12); return p;
  }
  function leaf(p) {
    drawPath(null, p.x, p.y, p.s, p.rot, Math.cos(p.t * 1.7 + p.ph) * p.fl);     // «переворот» листа в полёте
    px.globalAlpha = .7; px.fillStyle = p.c; px.fill(P2[p.k], 'evenodd');
    if (p.k === 'maple') { px.globalAlpha = .35; px.strokeStyle = '#000'; px.lineWidth = .7; px.beginPath(); px.moveTo(12, 8); px.lineTo(12, 22); px.stroke(); }
    px.restore();
  }
  function snow(p) {
    px.globalAlpha = .78; px.fillStyle = '#eaf7ff'; px.strokeStyle = '#eaf7ff';
    if (p.big) {
      px.save(); px.translate(p.x, p.y); px.rotate(p.rot); px.scale(p.s / 10, p.s / 10); px.translate(-12, -12);
      px.lineWidth = 1.7; px.lineCap = 'round'; px.stroke(P2.flake); px.restore();
    } else { px.beginPath(); px.arc(p.x, p.y, p.s, 0, 6.3); px.fill(); }
  }
  function bat(b) {
    const s = b.s, up = Math.sin(b.ph * 14);
    px.save(); px.translate(b.x, b.y + Math.sin(b.ph * 2.6) * 9); px.scale(b.dir, 1);
    px.rotate(Math.sin(b.ph * 2.6) * .08);
    px.fillStyle = 'rgba(196,150,255,.72)'; px.strokeStyle = 'rgba(235,215,255,.55)'; px.lineWidth = 1; px.lineJoin = 'round';
    for (const m of [1, -1]) {
      px.save(); px.scale(m, 1); px.beginPath();
      px.moveTo(s * .1, -s * .04);
      px.quadraticCurveTo(s * .42, -s * (.46 + .36 * up), s * .8, -s * (.36 + .52 * up));        // передняя кромка до запястья
      px.quadraticCurveTo(s * 1.22, -s * (.42 + .78 * up), s * 1.66, -s * (.02 + .95 * up));    // кончик крыла
      px.quadraticCurveTo(s * 1.4, s * (.08 - .14 * up), s * 1.32, s * (.36 - .3 * up));        // три фестона задней кромки
      px.quadraticCurveTo(s * 1.08, s * (.16 - .08 * up), s * .96, s * (.5 - .2 * up));
      px.quadraticCurveTo(s * .7, s * (.24 - .02 * up), s * .52, s * .56);
      px.quadraticCurveTo(s * .3, s * .3, s * .12, s * .5);
      px.closePath(); px.fill(); px.stroke();
      px.globalAlpha = .4; px.beginPath();                                                       // косточки крыла
      px.moveTo(s * .8, -s * (.36 + .52 * up)); px.lineTo(s * .96, s * (.5 - .2 * up));
      px.moveTo(s * .8, -s * (.36 + .52 * up)); px.lineTo(s * .52, s * .56);
      px.moveTo(s * .8, -s * (.36 + .52 * up)); px.lineTo(s * 1.32, s * (.36 - .3 * up)); px.stroke();
      px.globalAlpha = 1; px.restore();
    }
    px.fillStyle = 'rgba(170,120,240,.9)';
    px.beginPath(); px.ellipse(0, s * .17, s * .14, s * .32, 0, 0, 6.3); px.fill();              // тело
    px.beginPath(); px.arc(0, -s * .15, s * .13, 0, 6.3); px.fill();                             // голова
    px.beginPath(); px.moveTo(-s * .12, -s * .2); px.lineTo(-s * .1, -s * .42); px.lineTo(-s * .01, -s * .24);
    px.moveTo(s * .12, -s * .2); px.lineTo(s * .1, -s * .42); px.lineTo(s * .01, -s * .24); px.fill();  // уши
    px.fillStyle = '#ffe08a'; px.beginPath(); px.arc(-s * .05, -s * .15, s * .025, 0, 6.3); px.arc(s * .05, -s * .15, s * .025, 0, 6.3); px.fill();
    px.restore();
  }
  function ghost(g, t) {
    px.save(); px.translate(g.x, g.y); px.rotate(Math.sin(t * 1.1 + g.ph) * .12); px.scale(g.s / 12, g.s / 12 * (1 + Math.sin(t * 2.2) * .04)); px.translate(-12, -12);
    px.globalAlpha = g.a; px.fillStyle = '#e6d8ff'; px.shadowColor = '#b58cff'; px.shadowBlur = 14; px.fill(P2.ghost, 'evenodd'); px.restore();
  }
  function star(st, t) {
    const a = .25 + .75 * Math.max(0, Math.sin(t * st.sp + st.ph)), r = st.r * (.6 + .4 * a);
    px.save(); px.translate(st.x, st.y); px.globalAlpha = a * .5; px.fillStyle = '#ffe08a';
    px.beginPath(); px.arc(0, 0, r * 1.5, 0, 6.3); px.globalAlpha = a * .12; px.fill(); px.globalAlpha = a * .85;
    px.beginPath(); px.moveTo(0, -r); px.quadraticCurveTo(0, 0, r, 0); px.quadraticCurveTo(0, 0, 0, r); px.quadraticCurveTo(0, 0, -r, 0); px.quadraticCurveTo(0, 0, 0, -r); px.fill();
    px.restore();
  }
  function fireworks(now, dt, W, H, sc) {
    const p = api.nowParts();
    const midnight = p.mo === 1 && p.d === 1 && p.h === 0 && p.mi === 0 && p.s < 40;
    if (now > nextFW) {
      FW.push({x: rnd(.12, .88) * W, y: H, ty: rnd(.18, .5) * H, c: pick(FWC)});
      nextFW = now + (midnight ? rnd(300, 800) : rnd(14000, 26000));
    }
    for (let i = FW.length - 1; i >= 0; i--) {
      const r = FW[i]; r.y -= 340 * sc * dt;
      px.globalAlpha = .8; px.fillStyle = '#fff'; px.fillRect(r.x, r.y, 2 * sc, 6 * sc);
      if (r.y <= r.ty) {
        const n = 44, v = rnd(95, 150) * sc;
        for (let k = 0; k < n; k++) { const a = k / n * 6.283 + rnd(-.08, .08), s = v * rnd(.6, 1); SPARK.push({x: r.x, y: r.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, a: 1, c: r.c}); }
        FW.splice(i, 1);
      }
    }
    for (let i = SPARK.length - 1; i >= 0; i--) {
      const s = SPARK[i]; s.vy += 55 * sc * dt; s.vx *= .985; s.x += s.vx * dt; s.y += s.vy * dt; s.a -= dt * .45;
      if (s.a <= 0) { SPARK.splice(i, 1); continue; }
      px.globalAlpha = s.a * .85; px.fillStyle = s.c; px.fillRect(s.x, s.y, 3 * sc, 3 * sc);
    }
    px.globalAlpha = 1;
  }
  function spider(t, W, H, sc) {
    const x = W * .965 + Math.sin(t * .8) * 2 * sc, y = H * (.07 + .09 * (.5 + .5 * Math.sin(t * .35))), r = 6.5 * sc;
    px.save(); px.lineCap = 'round'; px.lineJoin = 'round';
    px.globalAlpha = .5; px.strokeStyle = '#e3d5ff'; px.lineWidth = Math.max(1, sc * .9);
    px.beginPath(); px.moveTo(x, 0); px.lineTo(x, y - r * .8); px.stroke();
    px.globalAlpha = .85; px.strokeStyle = '#8f5be0'; px.lineWidth = Math.max(1.3, sc * 1.5); px.beginPath();
    for (const m of [-1, 1]) for (let k = 0; k < 4; k++) {         // восемь ног с коленками
      const by = y - r * .1 + (k - 1.5) * r * .32, w = Math.sin(t * 4 + k * 1.3 + (m > 0 ? 0 : 2)) * r * .18;
      px.moveTo(x + m * r * .45, by);
      px.lineTo(x + m * r * (1.5 + k * .12), by - r * (1.25 - k * .18) + w);
      px.lineTo(x + m * r * (2.5 - k * .05), by + r * (.5 + k * .4) + w * .5);
    }
    px.stroke();
    px.fillStyle = '#a56bff'; px.beginPath(); px.ellipse(x, y + r * .5, r * .85, r * 1.05, 0, 0, 6.3); px.fill();         // брюшко
    px.fillStyle = '#7a45c8'; px.beginPath(); px.ellipse(x, y + r * .5, r * .3, r * .5, 0, 0, 6.3); px.fill();             // узор
    px.fillStyle = '#b98cff'; px.beginPath(); px.arc(x, y - r * .55, r * .5, 0, 6.3); px.fill();                           // голова
    px.fillStyle = '#ff5a3a'; px.globalAlpha = 1; px.beginPath(); px.arc(x - r * .18, y - r * .62, r * .1, 0, 6.3); px.arc(x + r * .18, y - r * .62, r * .1, 0, 6.3); px.fill();
    px.restore();
  }

  function step(now) {
    requestAnimationFrame(step);
    if (!PK || document.hidden || now - lastDraw < 45) return;
    const dt = Math.min(.12, (now - lastDraw) / 1000); lastDraw = now;
    const W = pc.width, H = pc.height, t = now / 1000, sc = Math.max(.6, Math.min(2, H / 768));
    px.clearRect(0, 0, W, H);
    for (let i = 0; i < PP.length; i++) {
      const p = PP[i]; p.t += dt;
      p.y += p.vy * dt; p.x += Math.sin(p.t * .9 + p.ph) * p.sw * dt;
      if (PK === 'leaves') { p.rot += p.vr * dt; leaf(p); }
      else if (PK === 'embers') {
        const a = .35 + .4 * Math.sin(t * 3 + p.ph); px.fillStyle = p.c;
        px.globalAlpha = Math.max(.05, a) * .25; px.beginPath(); px.arc(p.x, p.y, p.s * 3, 0, 6.3); px.fill();
        px.globalAlpha = Math.max(.1, a); px.beginPath(); px.arc(p.x, p.y, p.s, 0, 6.3); px.fill();
      } else { p.rot += p.vr * dt; snow(p); }
      if (p.y > H + 30 || p.y < -40 || p.x < -40 || p.x > W + 40) PP[i] = spawn(PK, false, sc);
    }
    px.globalAlpha = 1;
    for (const st of STARS) star(st, t);
    if (PTHEME === 'newyear') fireworks(now, dt, W, H, sc);
    if (PTHEME === 'halloween') {
      spider(t, W, H, sc);
      if (!BAT && now > nextBat) { const dir = Math.random() < .5 ? 1 : -1; BAT = {dir, x: dir > 0 ? -60 : W + 60, y: rnd(.1, .5) * H, vx: dir * rnd(110, 170) * sc, ph: 0, s: rnd(20, 28) * sc}; }
      if (BAT) { BAT.x += BAT.vx * dt; BAT.ph += dt; bat(BAT); if (BAT.x < -90 || BAT.x > W + 90) { BAT = null; nextBat = now + rnd(14000, 28000); } }
      if (!GH && now > nextGh) GH = {x: rnd(.15, .85) * W, y: H + 40 * sc, s: 30 * sc, a: 0, ph: rnd(0, 6), age: 0};
      if (GH) {
        GH.age += dt; GH.y -= 26 * sc * dt; GH.x += Math.sin(GH.age * .9 + GH.ph) * 22 * sc * dt;
        GH.a = Math.min(.26, GH.age * .12, Math.max(0, (GH.y + 40) / H * .3)); ghost(GH, t);
        if (GH.y < -60 * sc) { GH = null; nextGh = now + rnd(30000, 55000); }
      }
    }
  }
  requestAnimationFrame(step);

  api.setup = setup;
  return api;
})();
