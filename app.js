/* =====================================================================
 * تخته نرد (Backgammon / Takhteh Nard) — موتور کامل بازی + رابط + آنلاین
 * - حالت‌ها: دو نفره (local)، با کامپیوتر (bot)، آنلاین (online via PeerJS)
 * - بدون هیچ وابستگی جز PeerJS. اسکریپت معمولی (non-module).
 * ===================================================================== */
window.addEventListener('DOMContentLoaded', function () {
'use strict';

/* ---------------- ابزارهای عمومی ---------------- */

function $(id) { return document.getElementById(id); }

var FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶'];
function faNum(n) {
  n = String(n);
  var out = '';
  for (var i = 0; i < n.length; i++) {
    var c = n.charAt(i);
    if (c >= '0' && c <= '9') out += FA_DIGITS[parseInt(c, 10)];
    else out += c;
  }
  return out;
}

function colorName(c) { return c === 'w' ? 'سفید' : 'مشکی'; }
function opp(c) { return c === 'w' ? 'b' : 'w'; }
function secureInt(n) {
  // عدد صحیح رندوم امن در بازه [0,n) با crypto.getRandomValues (مثل بقیه گیم‌ها) + fallback
  try {
    if (typeof window.crypto !== 'undefined' && window.crypto.getRandomValues) {
      var buf = new Uint32Array(1);
      var max = 0xFFFFFFFF;
      var limit = max - (max % n);
      do { window.crypto.getRandomValues(buf); } while (buf[0] >= limit);
      return buf[0] % n;
    }
  } catch (e) { /* fallback پایین */ }
  return Math.floor(Math.random() * n);
}
function randFloat01() {
  try {
    if (typeof window.crypto !== 'undefined' && window.crypto.getRandomValues) {
      var b = new Uint32Array(1);
      window.crypto.getRandomValues(b);
      return b[0] / 0xFFFFFFFF;
    }
  } catch (e) {}
  return Math.random();
}
function randDie() { return 1 + secureInt(6); }

function makeCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < 5; i++) s += chars.charAt(secureInt(chars.length));
  return s;
}

/* انیمیشن تاس مثل بازی‌های واقعی: چرخش چهره‌ها و لرزش، بعد نمایش نتیجه نهایی */
var isRolling = false;
function animateDiceFaces(ms, done) {
  var d0 = $('die-0'), d1 = $('die-1');
  d0.className = 'die rolling'; d1.className = 'die rolling';
  var t0 = Date.now();
  var iv = setInterval(function () {
    try {
      paintDie(d0, 1 + secureInt(6));
      paintDie(d1, 1 + secureInt(6));
    } catch (e) {}
    if (Date.now() - t0 >= ms) {
      clearInterval(iv);
      d0.classList.remove('rolling'); d1.classList.remove('rolling');
      if (done) done();
    }
  }, 90);
  // صدای قل خوردن
  tone(300, 60, 'square', 0, 0.08); tone(420, 60, 'square', 130, 0.08);
  tone(360, 60, 'square', 260, 0.08); tone(500, 60, 'square', 390, 0.08);
}
function dicePop() {
  var d0 = $('die-0'), d1 = $('die-1');
  [d0, d1].forEach(function (elx) {
    if (!elx) return;
    elx.classList.remove('pop'); void elx.offsetWidth; elx.classList.add('pop');
  });
}
function flashBoard() {
  var b = $('board');
  if (!b) return;
  b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
}
function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 60); } catch (e) {} }

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------------- صدا با WebAudio (بدون فایل) ---------------- */

var audioCtx = null;
function ac() {
  if (!audioCtx) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function tone(freq, durMs, type, delayMs, vol) {
  var ctx = ac();
  if (!ctx) return;
  var t = ctx.currentTime + (delayMs || 0) / 1000;
  var o = ctx.createOscillator();
  var g = ctx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(vol || 0.18, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + durMs / 1000);
  o.connect(g); g.connect(ctx.destination);
  o.start(t); o.stop(t + durMs / 1000 + 0.02);
}
function sndDice() { tone(700, 70, 'square', 0, 0.12); tone(520, 80, 'square', 90, 0.12); }
function sndMove() { tone(440, 110, 'sine', 0, 0.2); }
function sndHit() { tone(170, 220, 'sawtooth', 0, 0.22); tone(120, 200, 'sawtooth', 120, 0.18); }
function sndSelect() { tone(880, 50, 'sine', 0, 0.1); }
function sndCube() { tone(660, 120, 'triangle', 0, 0.2); tone(990, 140, 'triangle', 130, 0.2); }
function sndWin() {
  var seq = [523, 659, 784, 1046, 784, 1046];
  for (var i = 0; i < seq.length; i++) tone(seq[i], 180, 'triangle', i * 170, 0.2);
}
function sndLose() { tone(300, 250, 'sawtooth', 0, 0.15); tone(200, 350, 'sawtooth', 200, 0.15); }

/* ---------------- وضعیت بازی ---------------- */

var G = freshState();

function freshState() {
  return {
    points: blankPoints(),
    bar: { w: 0, b: 0 },
    off: { w: 0, b: 0 },
    turn: 'w',
    dice: [],        // تاس‌های ریخته‌شده برای نمایش [d1,d2]
    movesLeft: [],   // تاس‌های باقی‌مانده قابل بازی
    phase: 'roll',   // roll | move | over
    cube: { value: 1, owner: 'center' }, // owner: center|w|b
    winner: null,
    winKind: null,   // normal|gammon|backgammon
    selected: null,  // ایندکس 0..23 یا 'bar'
    dests: [],       // مقصدهای {to,die} برای مهره انتخاب‌شده
    moveLog: []
  };
}

function blankPoints() {
  var a = [];
  for (var i = 0; i < 24; i++) a.push({ color: null, count: 0 });
  return a;
}

// چیدمان استاندارد. ایندکس 0 = خانه ۱ ... ایندکس 23 = خانه ۲۴.
function setupBoard() {
  G.points = blankPoints();
  // سفید: ۲@۲۴، ۵@۱۳، ۳@۸، ۵@۶
  setPoint(23, 'w', 2); setPoint(12, 'w', 5); setPoint(7, 'w', 3); setPoint(5, 'w', 5);
  // مشکی: ۲@۱، ۵@۱۲، ۳@۱۷، ۵@۱۹
  setPoint(0, 'b', 2); setPoint(11, 'b', 5); setPoint(16, 'b', 3); setPoint(18, 'b', 5);
  G.bar = { w: 0, b: 0 };
  G.off = { w: 0, b: 0 };
}
function setPoint(idx, color, count) {
  G.points[idx].color = color;
  G.points[idx].count = count;
}

/* ---------------- حالت‌ها و آنلاین ---------------- */

var mode = 'local';          // local | bot | online
var peer = null, conn = null;
var isHost = false;
var myColor = 'w';
var roomCode = null;
var isConnected = false;

/* -------- ذخیره و ادامه بازی بعد از رفرش -------- */
var SESSION_KEY = 'takhtenard-session-v1';
var sessionOn = false;      // فقط وقتی بازی واقعی شروع شده ذخیره کن
var userLeft = false;       // خروج عمدی کاربر → تلاش مجدد نکن
var reconnectTimer = null, reconnectTries = 0;
var hostRetries = 0;
function saveSession() {
  if (!sessionOn) return;
  try {
    if (G.moveLog && G.moveLog.length > 60) G.moveLog = G.moveLog.slice(-60);
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      mode: mode, roomCode: roomCode, isHost: isHost, myColor: myColor, G: G
    }));
  } catch (e) {}
}
function loadSession() {
  try {
    var s = JSON.parse(localStorage.getItem(SESSION_KEY));
    return (s && s.G) ? s : null;
  } catch (e) { return null; }
}
function clearSession() {
  sessionOn = false;
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectTries = 0;
}
var PEER_PREFIX = 'takhtenard-v1-';
var pendingCubeOffer = 1;

/* ---------------- منطق خالص روی بورد ---------------- */
// این توابع روی آبجکت {points,bar,off} کار می‌کنند تا شبیه‌سازی ممکن شود.

function entryIndex(color, die) {
  // سفید: ورود به ۲۴-die (ایندکس) | مشکی: ورود به die-1 (ایندکس)
  return color === 'w' ? (24 - die) : (die - 1);
}
function isHomeIdx(color, idx) {
  return color === 'w' ? (idx >= 0 && idx <= 5) : (idx >= 18 && idx <= 23);
}
function distToOff(color, idx) {
  return color === 'w' ? (idx + 1) : (24 - idx);
}
function countOnBoard(b, color) {
  var n = b.bar[color] + b.off[color];
  for (var i = 0; i < 24; i++) if (b.points[i].color === color) n += b.points[i].count;
  return n;
}
function allInHome(b, color) {
  // همه ۱۵ مهره در خانه خودی یا خارج‌شده
  var home = 0;
  for (var i = 0; i < 24; i++) {
    if (b.points[i].color === color && isHomeIdx(color, i)) home += b.points[i].count;
  }
  return (home + b.off[color]) === 15;
}
function higherOccupied(b, color, idx) {
  // آیا مهره خودی در خانه‌های «بالاتر» (فاصله بیشتر تا خروج) هست؟
  var i;
  if (color === 'w') {
    for (i = idx + 1; i <= 5; i++) {
      if (b.points[i].color === 'w' && b.points[i].count > 0) return true;
    }
  } else {
    for (i = 18; i <= idx - 1; i++) {
      if (b.points[i].color === 'b' && b.points[i].count > 0) return true;
    }
  }
  return false;
}
function blockedAt(b, color, idx) {
  var p = b.points[idx];
  return p.color === opp(color) && p.count >= 2;
}
function cloneBoard(b) {
  var pts = [];
  for (var i = 0; i < 24; i++) pts.push({ color: b.points[i].color, count: b.points[i].count });
  return { points: pts, bar: { w: b.bar.w, b: b.bar.b }, off: { w: b.off.w, b: b.off.b } };
}
function boardOf(g) {
  return { points: g.points, bar: g.bar, off: g.off };
}

// همه حرکت‌های قانونی برای یک تاس مشخص. from می‌تواند 'bar' یا ایندکس باشد.
function movesForDieOn(b, color, die) {
  var out = [];
  var i, to;
  // اگر مهره روی بار هست، فقط ورود
  if (b.bar[color] > 0) {
    to = entryIndex(color, die);
    if (!blockedAt(b, color, to)) {
      out.push({ from: 'bar', to: to, die: die, hit: isHit(b, color, to) });
    }
    return out;
  }
  for (i = 0; i < 24; i++) {
    if (b.points[i].color !== color || b.points[i].count === 0) continue;
    if (!isHomeIdx(color, i)) {
      // حرکت عادی (خارج از خانه خودی نمی‌توان خارج شد)
      to = color === 'w' ? (i - die) : (i + die);
      if (to >= 0 && to <= 23) {
        if (!blockedAt(b, color, to)) {
          out.push({ from: i, to: to, die: die, hit: isHit(b, color, to) });
        }
      }
    } else {
      // داخل خانه خودی: حرکت عادی یا خروج
      to = color === 'w' ? (i - die) : (i + die);
      if (to >= 0 && to <= 23) {
        if (!blockedAt(b, color, to)) {
          out.push({ from: i, to: to, die: die, hit: isHit(b, color, to) });
        }
      } else {
        // عبور از لبه = تلاش برای خروج
        var dist = distToOff(color, i);
        if (!allInHome(b, color)) continue;
        if (die === dist) {
          out.push({ from: i, to: 'off', die: die, hit: false });
        } else if (die > dist && !higherOccupied(b, color, i)) {
          out.push({ from: i, to: 'off', die: die, hit: false });
        }
      }
    }
  }
  return out;
}
function isHit(b, color, idx) {
  var p = b.points[idx];
  return p.color === opp(color) && p.count === 1;
}

// اعمال حرکت روی بورد (بدون بررسی قانونی‌بودن)
function applyMoveTo(b, color, m) {
  // برداشتن مبدأ
  if (m.from === 'bar') {
    b.bar[color]--;
  } else {
    b.points[m.from].count--;
    if (b.points[m.from].count === 0) b.points[m.from].color = null;
  }
  // نشستن در مقصد
  if (m.to === 'off') {
    b.off[color]++;
    return;
  }
  var p = b.points[m.to];
  if (p.color === opp(color) && p.count === 1) {
    // زدن بلات حریف
    p.color = color;
    p.count = 1;
    b.bar[opp(color)]++;
  } else if (p.color === null || p.color === color) {
    p.color = color;
    p.count++;
  }
}

// آیا با این دو تاس می‌توان ترتیبی یافت که هر دو مصرف شوند؟
function sequenceUsesBoth(b, color, d1, d2) {
  var ms1 = movesForDieOn(b, color, d1);
  var i, j, k, c2, ms2;
  for (i = 0; i < ms1.length; i++) {
    c2 = cloneBoard(b);
    applyMoveTo(c2, color, ms1[i]);
    ms2 = movesForDieOn(c2, color, d2);
    if (ms2.length > 0) return true;
  }
  var msA = movesForDieOn(b, color, d2);
  for (k = 0; k < msA.length; k++) {
    c2 = cloneBoard(b);
    applyMoveTo(c2, color, msA[k]);
    var msB = movesForDieOn(c2, color, d1);
    if (msB.length > 0) return true;
  }
  return false;
}

// قانون «باید از هر دو تاس استفاده شود»: خروجی = تاس‌های مجاز ابتدای نوبت
function computeAllowedDice(b, color, d1, d2) {
  if (d1 === d2) return [d1, d1, d1, d1]; // دوبل = ۴ حرکت
  var m1 = movesForDieOn(b, color, d1);
  var m2 = movesForDieOn(b, color, d2);
  if (m1.length === 0 && m2.length === 0) return [];
  if (m1.length === 0) return [d2];
  if (m2.length === 0) return [d1];
  // هر دو جداگانه ممکن‌اند؛ آیا ترتیبی هست که هر دو مصرف شوند؟
  if (sequenceUsesBoth(b, color, d1, d2)) return [d1, d2];
  // وگرنه فقط تاس بزرگ‌تر
  return [Math.max(d1, d2)];
}

// مقصدهای قانونی یک مهره مشخص با تاس‌های باقی‌مانده (خروجی یکتا بر اساس مقصد)
function destsForFrom(b, color, from, diceLeft) {
  var seen = {};
  var out = [];
  var tried = {};
  var i, mv, key;
  for (i = 0; i < diceLeft.length; i++) {
    var d = diceLeft[i];
    if (tried[d]) continue;
    tried[d] = true;
    var list = movesForDieOn(b, color, d);
    for (var j = 0; j < list.length; j++) {
      mv = list[j];
      if (mv.from !== from) continue;
      key = String(mv.to);
      if (seen[key]) continue;
      // برای خروج با تاس بزرگ‌تر، کوچک‌ترین تاسِ مجاز را انتخاب کن
      if (mv.to === 'off') {
        var best = pickOffDie(b, color, from, diceLeft);
        if (best === null) continue;
        seen[key] = true;
        out.push({ to: 'off', die: best });
      } else {
        seen[key] = true;
        out.push({ to: mv.to, die: mv.die });
      }
    }
  }
  return out;
}

// کوچک‌ترین تاس که اجازه خروج از from را می‌دهد (دقیق یا بزرگ‌ترِ مجاز)
function pickOffDie(b, color, from, diceLeft) {
  if (from === 'bar') return null;
  var dist = distToOff(color, from);
  var uniq = [];
  var seenD = {};
  for (var i = 0; i < diceLeft.length; i++) {
    if (!seenD[diceLeft[i]]) { seenD[diceLeft[i]] = true; uniq.push(diceLeft[i]); }
  }
  uniq.sort(function (a, z) { return a - z; });
  for (var k = 0; k < uniq.length; k++) {
    var d = uniq[k];
    if (d === dist) return d;
    if (d > dist && allInHome(b, color) && !higherOccupied(b, color, from)) return d;
  }
  return null;
}

function anyMoveExists(b, color, diceLeft) {
  var uniq = {};
  for (var i = 0; i < diceLeft.length; i++) {
    var d = diceLeft[i];
    if (uniq[d]) continue;
    uniq[d] = true;
    if (movesForDieOn(b, color, d).length > 0) return true;
  }
  return false;
}

/* ---------------- جریان نوبت ---------------- */

function startGame(newMode) {
  mode = newMode || mode;
  sessionOn = true; userLeft = false;
  var keepLog = [];
  G = freshState();
  G.moveLog = keepLog;
  setupBoard();
  addLog('بازی جدید شروع شد (' + modeName() + '). تاس‌کشی آغازین...');
  // تاس‌کشی آغازین: هر طرف یک تاس
  var dw, db;
  do {
    dw = randDie(); db = randDie();
  } while (dw === db);
  G.turn = dw > db ? 'w' : 'b';
  G.dice = [];
  G.movesLeft = [];
  G.phase = 'roll';
  addLog('تاس‌کشی: سفید ' + faNum(dw) + ' — مشکی ' + faNum(db) + '. شروع‌کننده: ' + colorName(G.turn));
  showMsg('تاس‌کشی: سفید ' + faNum(dw) + '، مشکی ' + faNum(db) + ' → شروع با ' + colorName(G.turn));
  sndDice();
  closeAllModals();
  render();
  broadcastState();
  maybeBotTurn();
}

function modeName() {
  if (mode === 'local') return 'دو نفره';
  if (mode === 'bot') return 'با کامپیوتر';
  return 'آنلاین';
}

function canAct() {
  if (G.phase === 'over') return false;
  if (mode === 'local') return true;
  if (mode === 'bot') return G.turn === 'w';
  if (mode === 'online') {
    if (!isConnected) return isHost; // میزبان تا اتصال، صفحه را می‌بیند
    return G.turn === myColor;
  }
  return false;
}

function rollDice() {
  if (isRolling) return;
  if (G.phase !== 'roll') { showMsg('الان وقت تاس ریختن نیست.'); return; }
  if (!canAct()) { showMsg('نوبت شما نیست.'); return; }
  // نتیجه نهایی همین لحظه با RNG امن مشخص می‌شود؛ انیمیشن فقط نمایش است (مثل بازی‌های واقعی)
  var d1 = randDie(), d2 = randDie();
  isRolling = true;
  var rb = $('btn-roll');
  if (rb) rb.disabled = true;
  renderDice();
  animateDiceFaces(650, function () {
    isRolling = false;
    if (rb) rb.disabled = false;
    finalizeRoll(d1, d2);
  });
}

function finalizeRoll(d1, d2) {
  G.dice = [d1, d2];
  var allowed = computeAllowedDice(boardOf(G), G.turn, d1, d2);
  sndDice();
  dicePop();
  if (allowed.length === 0) {
    G.movesLeft = [];
    G.phase = 'move';
    addLog(colorName(G.turn) + ' تاس ' + faNum(d1) + ' و ' + faNum(d2) + ' آورد ولی حرکتی نداشت.');
    showMsg('تاس ' + faNum(d1) + ' و ' + faNum(d2) + ' — هیچ حرکت قانونی نیست، نوبت رد می‌شود.');
    render();
    broadcastState();
    setTimeout(function () { endTurn(true); }, 1400);
    return;
  }
  G.movesLeft = allowed.slice();
  G.phase = 'move';
  G.selected = null; G.dests = [];
  var dbl = (d1 === d2) ? ' (جفت! چهار حرکت)' : '';
  addLog(colorName(G.turn) + ' تاس آورد: ' + faNum(d1) + ' و ' + faNum(d2) + dbl);
  if (allowed.length === 1 && d1 !== d2) {
    showMsg('تاس ' + faNum(d1) + ' و ' + faNum(d2) + ' — طبق قانون فقط تاس ' + faNum(allowed[0]) + ' قابل بازی است.');
    addLog('طبق قانون استفاده حداکثری، فقط تاس ' + faNum(allowed[0]) + ' بازی می‌شود.');
  } else {
    showMsg('نوبت ' + colorName(G.turn) + ': تاس ' + faNum(d1) + ' و ' + faNum(d2) + dbl + ' — مهره‌ای را انتخاب کنید.');
  }
  render();
  dicePop();
  broadcastState();
  maybeBotTurn();
}

function doMove(from, to) {
  if (G.phase !== 'move') return false;
  if (!canAct()) { showMsg('نوبت شما نیست.'); return false; }
  // پیدا کردن تاس مصرفی
  var die = dieForMove(from, to);
  if (die === null) { showMsg('این حرکت با تاس‌های باقی‌مانده ممکن نیست.'); return false; }
  // اعتبارسنجی نهایی
  var cands = movesForDieOn(boardOf(G), G.turn, die);
  var found = null;
  for (var i = 0; i < cands.length; i++) {
    var cf = String(cands[i].from), ff = String(from);
    var ct = String(cands[i].to), tt = String(to);
    if (cf === ff && ct === tt) { found = cands[i]; break; }
  }
  if (!found) { showMsg('حرکت غیرمجاز است.'); return false; }

  applyMoveTo(boardOf(G), G.turn, found);
  // مصرف یک تاس هم‌مقدار
  var k = G.movesLeft.indexOf(die);
  if (k >= 0) G.movesLeft.splice(k, 1);

  if (found.hit) {
    sndHit();
    addLog(colorName(G.turn) + ' مهره ' + colorName(opp(G.turn)) + ' را زد! (' + pointName(from) + ' → ' + pointName(to) + ')');
  } else {
    sndMove();
    addLog(colorName(G.turn) + ': ' + pointName(from) + ' → ' + pointName(to) + ' (تاس ' + faNum(die) + ')');
  }
  G.selected = null; G.dests = [];

  // برد؟
  if (G.off[G.turn] === 15) {
    finishGame(G.turn);
    return true;
  }
  if (G.movesLeft.length === 0) {
    showMsg('حرکت‌ها تمام شد.');
    render();
    broadcastState();
    setTimeout(function () { endTurn(false); }, 700);
    return true;
  }
  if (!anyMoveExists(boardOf(G), G.turn, G.movesLeft)) {
    showMsg('حرکت دیگری با تاس باقی‌مانده نیست. نوبت تمام شد.');
    addLog(colorName(G.turn) + ' حرکت دیگری ندارد.');
    render();
    broadcastState();
    setTimeout(function () { endTurn(false); }, 1100);
    return true;
  }
  render();
  broadcastState();
  maybeBotTurn();
  return true;
}

function dieForMove(from, to) {
  var c = G.turn;
  if (from === 'bar') {
    // تاس ورود مشخص است
    for (var i = 0; i < G.movesLeft.length; i++) {
      if (entryIndex(c, G.movesLeft[i]) === to) return G.movesLeft[i];
    }
    return null;
  }
  if (to === 'off') {
    return pickOffDie(boardOf(G), c, from, G.movesLeft);
  }
  var dist = c === 'w' ? (from - to) : (to - from);
  if (dist <= 0) return null;
  return G.movesLeft.indexOf(dist) >= 0 ? dist : null;
}

function endTurn(auto) {
  if (G.phase === 'over') return;
  G.turn = opp(G.turn);
  G.phase = 'roll';
  G.dice = [];
  G.movesLeft = [];
  G.selected = null; G.dests = [];
  if (auto) addLog('نوبت به ' + colorName(G.turn) + ' رسید.');
  else addLog('نوبت ' + colorName(G.turn) + ' است. تاس بریزید.');
  showMsg('نوبت ' + colorName(G.turn) + ' — تاس بریزید.' + turnHint());
  render();
  broadcastState();
  maybeBotTurn();
}

function turnHint() {
  if (mode === 'online' && isConnected) {
    return G.turn === myColor ? ' (نوبت شماست)' : ' (نوبت حریف)';
  }
  if (mode === 'bot') return G.turn === 'w' ? ' (نوبت شما)' : ' (نوبت کامپیوتر)';
  return '';
}

function pointName(x) {
  if (x === 'bar') return 'بار';
  if (x === 'off') return 'خارج';
  return 'خانه ' + faNum(x + 1);
}

function finishGame(winner) {
  G.phase = 'over';
  G.winner = winner;
  var loser = opp(winner);
  var kind = 'normal';
  if (G.off[loser] === 0) {
    // بک‌گمون؟ مهره روی بار یا در خانه برنده
    var inWinnerHome = false;
    var i;
    if (G.bar[loser] > 0) inWinnerHome = true;
    else {
      for (i = 0; i < 24; i++) {
        if (G.points[i].color === loser && isHomeIdx(winner, i) && G.points[i].count > 0) { inWinnerHome = true; break; }
      }
    }
    kind = inWinnerHome ? 'backgammon' : 'gammon';
  }
  G.winKind = kind;
  var mult = G.cube.value;
  var title, text;
  if (kind === 'gammon') {
    title = '🏆 مارس! برنده: ' + colorName(winner);
    text = colorName(winner) + ' با مارس برد! (امتیاز ×' + faNum(2 * mult) + ' با احتساب کیوب ' + faNum(mult) + ')';
  } else if (kind === 'backgammon') {
    title = '🏆🏆 سه‌خال! برنده: ' + colorName(winner);
    text = colorName(winner) + ' با سه‌خال (بک‌گمون) برد! (امتیاز ×' + faNum(3 * mult) + ' با احتساب کیوب ' + faNum(mult) + ')';
  } else {
    title = '🏆 برنده: ' + colorName(winner);
    text = colorName(winner) + ' بازی را برد! (امتیاز ×' + faNum(mult) + ' با احتساب کیوب ' + faNum(mult) + ')';
  }
  addLog(title + ' — ' + text);
  sndWin();
  render();
  $('gameover-title').textContent = title;
  $('gameover-text').textContent = text;
  openModal('modal-gameover');
  broadcastState();
}

/* ---------------- کیوب دوبل ---------------- */

function cubeNext() { return Math.min(64, G.cube.value * 2); }

function canOfferCube() {
  if (G.phase !== 'roll') return false;
  if (G.cube.value >= 64) return false;
  if (G.dice.length > 0 || G.movesLeft.length > 0) return false; // فقط قبل از تاس
  if (G.cube.owner !== 'center' && G.cube.owner !== G.turn) return false;
  return canAct();
}

function offerCube() {
  if (!canOfferCube()) { showMsg('الان نمی‌توانید دوبل بدهید (فقط قبل از تاس، با مالکیت کیوب).'); return; }
  var nv = cubeNext();
  sndCube();
  if (mode === 'online') {
    pendingCubeOffer = nv;
    addLog(colorName(G.turn) + ' پیشنهاد دوبل داد: کیوب ' + faNum(nv));
    showMsg('پیشنهاد دوبل (' + faNum(nv) + ') برای حریف فرستاده شد...');
    sendMsg({ t: 'cube-offer', value: nv, from: G.turn });
    render();
    return;
  }
  if (mode === 'bot') {
    if (G.turn === 'w') {
      addLog('شما پیشنهاد دوبل دادید: کیوب ' + faNum(nv));
      // کامپیوتر: معمولاً قبول، گاهی در مقادیر بالا رد
      var accept = nv <= 8 ? true : randFloat01() < 0.6;
      setTimeout(function () {
        if (accept) {
          G.cube.value = nv; G.cube.owner = 'b';
          addLog('کامپیوتر دوبل را قبول کرد. کیوب ' + faNum(nv) + ' در دست مشکی.');
          showMsg('کامپیوتر قبول کرد! کیوب ' + faNum(nv));
          sndCube(); render();
        } else {
          addLog('کامپیوتر دوبل را رد کرد.');
          finishGame('w');
        }
      }, 800);
      showMsg('پیشنهاد دوبل (' + faNum(nv) + ') به کامپیوتر...');
      return;
    } else {
      return; // کامپیوتر پیشنهاد نمی‌دهد
    }
  }
  // دو نفره: از بازیکن مقابل بپرس
  pendingCubeOffer = nv;
  $('cube-offer-text').textContent = colorName(opp(G.turn)) + ' عزیز! ' + colorName(G.turn) +
    ' کیوب را به ' + faNum(nv) + ' رساند. قبول می‌کنید؟ (رد = باخت)';
  openModal('modal-cube');
}

function cubeRespond(accept) {
  closeModal('modal-cube');
  var nv = pendingCubeOffer;
  if (mode === 'online') {
    sendMsg({ t: 'cube-response', accept: accept, value: nv, from: myColor });
    if (accept) {
      G.cube.value = nv; G.cube.owner = myColor;
      addLog('شما دوبل را قبول کردید. کیوب ' + faNum(nv) + ' در دست ' + colorName(myColor) + '.');
      showMsg('قبول کردید! کیوب ' + faNum(nv));
      sndCube(); render(); broadcastState();
    } else {
      addLog('شما دوبل را رد کردید.');
      finishGame(opp(myColor));
    }
    return;
  }
  // دو نفره
  if (accept) {
    G.cube.value = nv; G.cube.owner = opp(G.turn);
    addLog(colorName(opp(G.turn)) + ' دوبل را قبول کرد. کیوب ' + faNum(nv) + '.');
    showMsg('قبول شد! کیوب ' + faNum(nv));
    sndCube(); render();
  } else {
    addLog(colorName(opp(G.turn)) + ' دوبل را رد کرد.');
    finishGame(G.turn);
  }
}

/* ---------------- هوش کامپیوتر (مشکی) ---------------- */

var botTimer = null;

function maybeBotTurn() {
  if (mode !== 'bot' || G.phase === 'over') return;
  if (G.turn !== 'b') return;
  clearTimeout(botTimer);
  botTimer = setTimeout(function () {
    if (G.phase === 'roll') {
      // تاس کامپیوتر
      var d1 = randDie(), d2 = randDie();
      G.dice = [d1, d2];
      var allowed = computeAllowedDice(boardOf(G), 'b', d1, d2);
      sndDice();
      if (allowed.length === 0) {
        G.movesLeft = []; G.phase = 'move';
        addLog('کامپیوتر تاس ' + faNum(d1) + ' و ' + faNum(d2) + ' آورد ولی حرکتی نداشت.');
        showMsg('کامپیوتر حرکتی ندارد. نوبت شما.');
        render();
        setTimeout(function () { endTurn(true); }, 1200);
        return;
      }
      G.movesLeft = allowed.slice();
      G.phase = 'move';
      addLog('کامپیوتر تاس آورد: ' + faNum(d1) + ' و ' + faNum(d2));
      showMsg('نوبت کامپیوتر...');
      render();
      botTimer = setTimeout(botStep, 800);
    } else if (G.phase === 'move') {
      botTimer = setTimeout(botStep, 800);
    }
  }, 800);
}

function botStep() {
  if (mode !== 'bot' || G.turn !== 'b' || G.phase !== 'move') return;
  if (G.movesLeft.length === 0) { endTurn(false); return; }
  var all = enumerateMoves(boardOf(G), 'b', G.movesLeft);
  if (all.length === 0) {
    showMsg('کامپیوتر حرکت دیگری ندارد.');
    setTimeout(function () { endTurn(false); }, 800);
    return;
  }
  var best = pickBotMove(all);
  forceMove('b', best);
  if (G.phase === 'move' && G.turn === 'b' && G.movesLeft.length > 0) {
    botTimer = setTimeout(botStep, 800);
  }
}

// اجرای حرکت برای بات (دور زدن canAct که فقط سفید را مجاز می‌داند)
function forceMove(color, m) {
  applyMoveTo(boardOf(G), color, m);
  var k = G.movesLeft.indexOf(m.die);
  if (k >= 0) G.movesLeft.splice(k, 1);
  if (m.hit) {
    sndHit();
    addLog('کامپیوتر مهره شما را زد! (' + pointName(m.from) + ' → ' + pointName(m.to) + ')');
  } else {
    sndMove();
    addLog('کامپیوتر: ' + pointName(m.from) + ' → ' + pointName(m.to) + ' (تاس ' + faNum(m.die) + ')');
  }
  G.selected = null; G.dests = [];
  if (G.off[color] === 15) { finishGame(color); return; }
  if (G.movesLeft.length === 0) {
    render();
    setTimeout(function () { endTurn(false); }, 700);
    return;
  }
  if (!anyMoveExists(boardOf(G), color, G.movesLeft)) {
    render();
    setTimeout(function () { endTurn(false); }, 900);
    return;
  }
  render();
}

function enumerateMoves(b, color, diceLeft) {
  var out = [];
  var uniq = {};
  for (var i = 0; i < diceLeft.length; i++) {
    var d = diceLeft[i];
    if (uniq[d]) continue;
    uniq[d] = true;
    var list = movesForDieOn(b, color, d);
    // برای خروج با تاس بزرگ‌تر، تاس واقعی را اصلاح کن
    for (var j = 0; j < list.length; j++) {
      var m = list[j];
      if (m.to === 'off') {
        var bd = pickOffDie(b, color, m.from, diceLeft);
        if (bd === null) continue;
        out.push({ from: m.from, to: 'off', die: bd, hit: false });
      } else {
        out.push(m);
      }
    }
  }
  // یکتاسازی (from,to,die)
  var seen = {}, res = [];
  for (var k = 0; k < out.length; k++) {
    var key = String(out[k].from) + '|' + String(out[k].to) + '|' + out[k].die;
    if (!seen[key]) { seen[key] = true; res.push(out[k]); }
  }
  return res;
}

function pickBotMove(moves) {
  // اولویت: خروج > زدن > خانه‌سازی > فرار از بار > جلوترین مهره
  var best = null, bestScore = -1e9;
  for (var i = 0; i < moves.length; i++) {
    var m = moves[i];
    var s = randFloat01() * 2;
    if (m.to === 'off') s += 100;
    if (m.hit) s += 50;
    if (m.from === 'bar') s += 40;
    if (m.to !== 'off') {
      var p = G.points[m.to];
      if (p.color === 'b' && p.count >= 1) s += 30; // خانه‌سازی / تقویت
      else if (p.color === null) s += 12;
      // مهره عقب‌تر را جلو بکش (ایندکس کوچک‌تر برای مشکی عقب‌تر است)
      if (typeof m.from === 'number') s += (23 - m.from) * 0.4;
      s += (m.to - (typeof m.from === 'number' ? m.from : -1)) * 0.2;
    } else {
      if (typeof m.from === 'number') s += (m.from) * 0.3;
    }
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

/* ---------------- آنلاین با PeerJS ---------------- */

function peerAvailable() { return typeof window.Peer !== 'undefined'; }

function hostGame(keep) {
  if (!peerAvailable()) { showMsg('کتابخانه PeerJS بارگذاری نشد؛ اینترنت را بررسی کنید.'); return; }
  closeAllModals();
  cleanupPeer();
  userLeft = false; hostRetries = 0;
  mode = 'online'; isHost = true; isConnected = false;
  if (keep && roomCode) {
    myColor = 'w';
    addLog('اتاق ' + roomCode + ' دوباره باز شد؛ در انتظار وصل شدن مجدد حریف...');
  } else {
    myColor = 'w';
    roomCode = makeCode();
    G = freshState(); setupBoard();
    // تاس‌کشی آغازین همگام: میزبان می‌ریزد و در state می‌فرستد
    var dw, db;
    do { dw = randDie(); db = randDie(); } while (dw === db);
    G.turn = dw > db ? 'w' : 'b';
    addLog('اتاق ' + roomCode + ' ساخته شد. شما سفید هستید.');
    addLog('تاس‌کشی: سفید ' + faNum(dw) + ' — مشکی ' + faNum(db) + '. شروع‌کننده: ' + colorName(G.turn));
  }
  sessionOn = true;
  try {
    peer = new Peer(PEER_PREFIX + roomCode);
  } catch (e) { showMsg('خطا در ساخت اتصال: ' + e.message); return; }
  $('wait-code').textContent = roomCode;
  var link = shareLinkFor(roomCode);
  $('wait-link').href = link;
  $('wait-link').textContent = '🔗 ' + link;
  $('wait-status').textContent = 'در حال آماده‌سازی...';
  openModal('modal-wait');
  updateRoomBar();
  peer.on('open', function () {
    hostRetries = 0;
    $('wait-status').textContent = 'منتظر حریف... لینک را بفرستید.';
    showMsg('اتاق آماده است. کد: ' + roomCode);
  });
  peer.on('connection', function (c) {
    conn = c;
    wireConn();
  });
  peer.on('error', function (err) {
    var t = err && err.type ? err.type : '';
    if (keep && t === 'unavailable-id' && hostRetries < 6) {
      // بعد از رفرش، شناسه قبلی هنوز آزاد نشده؛ چند ثانیه بعد دوباره تلاش کن
      hostRetries++;
      $('wait-status').textContent = 'در حال باز کردن مجدد اتاق... (' + faNum(hostRetries) + ')';
      setTimeout(function () { if (mode === 'online' && isHost && !userLeft) hostGame(true); }, 2500);
      return;
    }
    $('wait-status').textContent = 'خطا: ' + (t || 'نامشخص');
    showMsg('خطای اتصال. دوباره تلاش کنید.');
  });
  render();
}

function joinGame(code, keep) {
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) { showMsg('کد اتاق باید ۵ حرف/عدد باشد.'); return; }
  if (!peerAvailable()) { showMsg('کتابخانه PeerJS بارگذاری نشد؛ اینترنت را بررسی کنید.'); return; }
  closeAllModals();
  cleanupPeer();
  userLeft = false;
  mode = 'online'; isHost = false; isConnected = false;
  roomCode = code;
  if (keep && G) {
    myColor = 'b';
    addLog('وصل شدن مجدد به اتاق ' + code + ' ...');
  } else {
    myColor = 'b';
    G = freshState(); setupBoard();
    addLog('در حال اتصال به اتاق ' + code + ' ... شما مشکی هستید.');
  }
  sessionOn = true;
  updateRoomBar();
  try {
    peer = new Peer();
  } catch (e) { showMsg('خطا در ساخت اتصال: ' + e.message); return; }
  peer.on('open', function () {
    try { conn = peer.connect(PEER_PREFIX + code, { reliable: true }); }
    catch (e) { showMsg('خطا در اتصال: ' + e.message); return; }
    wireConn();
  });
  peer.on('error', function (err) {
    var t = err && err.type ? err.type : '';
    if (t === 'peer-unavailable') showMsg('اتاق پیدا نشد. کد را بررسی کنید.');
    else showMsg('خطای اتصال (' + t + '). دوباره تلاش کنید.');
  });
  render();
}

/* وصل مجدد مهمان بدون از دست دادن صفحه بازی (بعد از رفرش یا قطعی) */
function reconnectGuest() {
  if (mode !== 'online' || isHost || !roomCode || userLeft) return;
  try { if (conn) conn.close(); } catch (e) {}
  try { if (peer) peer.destroy(); } catch (e) {}
  conn = null; peer = null;
  var code = roomCode;
  try {
    peer = new Peer();
  } catch (e) { scheduleReconnect(); return; }
  peer.on('open', function () {
    try { conn = peer.connect(PEER_PREFIX + code, { reliable: true }); }
    catch (e) { scheduleReconnect(); return; }
    wireConn();
  });
  peer.on('error', function () { scheduleReconnect(); });
}

function scheduleReconnect() {
  if (mode !== 'online' || isHost || !roomCode || userLeft) return;
  if (G.phase === 'over') return;
  if (reconnectTimer) return;
  reconnectTries++;
  if (reconnectTries > 25) {
    reconnectTries = 0;
    showMsg('وصل نشد. کد اتاق: ' + roomCode + ' — از منو دوباره وارد شوید.');
    return;
  }
  var st = $('conn-status');
  if (st) st.textContent = 'تلاش مجدد... 🔄 (' + faNum(reconnectTries) + ')';
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    if (mode === 'online' && !isHost && !isConnected && !userLeft) reconnectGuest();
  }, 3000);
}

function wireConn() {
  if (!conn) return;
  conn.on('open', function () {
    isConnected = true;
    reconnectTries = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    updateRoomBar();
    showMsg('حریف وصل شد! ' + (G.turn === myColor ? 'نوبت شماست.' : 'نوبت حریف است.'));
    addLog('حریف وصل شد.');
    closeAllModals();
    $('chat-box').classList.remove('hidden');
    if (isHost) broadcastState();
    render();
  });
  conn.on('data', onNetData);
  conn.on('close', function () {
    isConnected = false;
    updateRoomBar();
    if (mode === 'online' && !isHost && !userLeft && roomCode && G.phase !== 'over') {
      // قطع شدن ناخواسته مهمان (مثلاً رفرش میزبان) → تلاش خودکار برای وصل مجدد
      showMsg('اتصال قطع شد؛ تلاش برای وصل شدن مجدد... 🔄');
      addLog('اتصال قطع شد؛ تلاش مجدد برای ورود به اتاق...');
      scheduleReconnect();
    } else {
      showMsg('اتصال حریف قطع شد.');
      addLog('اتصال حریف قطع شد.');
    }
  });
  conn.on('error', function () {
    isConnected = false;
    updateRoomBar();
  });
}

function onNetData(msg) {
  if (!msg || typeof msg.t !== 'string') return;
  if (msg.t === 'state') {
    var prev = G;
    var prevDice = prev && prev.dice ? prev.dice.join(',') : '';
    var prevTurn = prev ? prev.turn : null;
    var prevBar = prev ? (prev.bar.w + prev.bar.b) : 0;
    G = msg.G;
    G.selected = null; G.dests = [];
    if (G.moveLog && G.moveLog.length > 60) G.moveLog = G.moveLog.slice(-60);
    render();
    // --- به‌روزرسانی زنده حرکات حریف: صدا + انیمیشن + پیام ---
    var newDice = (G.dice && G.dice.length === 2) ? G.dice.join(',') : '';
    if (newDice && newDice !== prevDice) {
      // حریف تازه تاس ریخته — زنده نمایش بده
      sndDice();
      dicePop();
      if (G.turn !== myColor) showMsg('حریف تاس آورد: ' + faNum(G.dice[0]) + ' و ' + faNum(G.dice[1]));
    } else if (G.turn !== myColor || G.phase === 'over') {
      // حریف مهره‌ای حرکت داده
      if ((G.bar.w + G.bar.b) > prevBar) { sndHit(); showMsg('⚡ حریف مهره شما را زد!'); }
      else sndMove();
      flashBoard();
    }
    if (G.turn === myColor && prevTurn !== myColor && G.phase !== 'over') {
      showMsg('🎲 نوبت شماست! تاس بریزید.');
      buzz(80);
    }
    if (G.phase === 'over' && G.winner) {
      var w = G.winner;
      var title = w === myColor ? '🏆 شما بردید!' : '😞 حریف برد.';
      var kindTxt = G.winKind === 'backgammon' ? ' (سه‌خال)' : (G.winKind === 'gammon' ? ' (مارس)' : '');
      $('gameover-title').textContent = title;
      $('gameover-text').textContent = 'برنده: ' + colorName(w) + kindTxt + ' — کیوب ' + faNum(G.cube.value);
      openModal('modal-gameover');
      if (w === myColor) sndWin(); else sndLose();
    }
  } else if (msg.t === 'chat') {
    appendChat(colorName(opp(myColor)), msg.text);
  } else if (msg.t === 'restart') {
    G = msg.G;
    G.selected = null; G.dests = [];
    closeAllModals();
    addLog('بازی دوباره شروع شد.');
    render();
  } else if (msg.t === 'cube-offer') {
    pendingCubeOffer = msg.value;
    $('cube-offer-text').textContent = 'حریف کیوب را به ' + faNum(msg.value) + ' رساند. قبول می‌کنید؟ (رد = باخت)';
    sndCube();
    openModal('modal-cube');
  } else if (msg.t === 'cube-response') {
    if (msg.accept) {
      G.cube.value = msg.value; G.cube.owner = msg.from;
      addLog('حریف دوبل را قبول کرد. کیوب ' + faNum(msg.value) + '.');
      showMsg('حریف قبول کرد! کیوب ' + faNum(msg.value));
      sndCube(); render(); broadcastState();
    } else {
      addLog('حریف دوبل را رد کرد.');
      finishGame(G.turn);
    }
  }
}

function sendMsg(obj) {
  try {
    if (conn && conn.open) conn.send(obj);
  } catch (e) { /* نادیده */ }
}

function broadcastState() {
  if (mode !== 'online') return;
  sendMsg({ t: 'state', G: G });
}

function cleanupPeer() {
  try { if (conn) conn.close(); } catch (e) {}
  try { if (peer) peer.destroy(); } catch (e) {}
  conn = null; peer = null; isConnected = false;
}

function shareLinkFor(code) {
  var base = location.origin + location.pathname;
  // برای فایل لوکال هم کار کند
  if (base.indexOf('http') !== 0) base = location.href.split('?')[0];
  return base + '?join=' + code;
}

function updateRoomBar() {
  var bar = $('room-bar');
  if (mode === 'online' && roomCode) {
    bar.classList.remove('hidden');
    $('room-code').textContent = roomCode;
    var link = shareLinkFor(roomCode);
    var a = $('share-link');
    a.href = link;
    a.textContent = '🔗 لینک دعوت';
    a.title = link;
    var st = $('conn-status');
    st.textContent = isConnected ? 'متصل 🟢' : 'در انتظار... 🟡';
    st.classList.toggle('on', isConnected);
    $('chat-box').classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
    $('chat-box').classList.add('hidden');
  }
}

/* ---------------- چت ---------------- */

function appendChat(who, text) {
  var log = $('chat-log');
  var div = document.createElement('div');
  div.innerHTML = '<b>' + escHtml(who) + ':</b> ' + escHtml(text);
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
function sendChat() {
  var inp = $('chat-input');
  var text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  appendChat('شما', text);
  sendMsg({ t: 'chat', text: text });
}

/* ---------------- لاگ و پیام ---------------- */

function addLog(text) {
  G.moveLog.push(text);
  if (G.moveLog.length > 80) G.moveLog = G.moveLog.slice(-80);
  renderLog();
}
function renderLog() {
  var box = $('move-log');
  box.innerHTML = '';
  for (var i = 0; i < G.moveLog.length; i++) {
    var div = document.createElement('div');
    div.textContent = G.moveLog[i];
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}
function showMsg(text) {
  $('message-box').textContent = text;
}

/* ---------------- رندر ---------------- */

var pointDivs = [];
var PIP = {
  1: [4], 2: [0, 8], 3: [0, 4, 8],
  4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
};

function buildPoints() {
  var top = $('points-top'), bottom = $('points-bottom');
  top.innerHTML = ''; bottom.innerHTML = '';
  pointDivs = [];
  var i, d, k;
  // ردیف بالا: خانه‌های ۱۳ تا ۲۴ (ایندکس ۱۲ تا ۲۳)
  for (k = 0; k < 12; k++) {
    i = 12 + k;
    d = makePointDiv(i);
    d.style.gridColumn = String(k < 6 ? (k + 1) : (k + 2));
    d.style.gridRow = '1';
    top.appendChild(d);
  }
  // ردیف پایین: خانه‌های ۱۲ تا ۱ (ایندکس ۱۱ تا ۰)
  for (k = 0; k < 12; k++) {
    i = 11 - k;
    d = makePointDiv(i);
    d.style.gridColumn = String(k < 6 ? (k + 1) : (k + 2));
    d.style.gridRow = '1';
    bottom.appendChild(d);
  }
}

function makePointDiv(i) {
  var pnum = i + 1;
  var d = document.createElement('div');
  d.className = 'point' + ((pnum % 2 === 0) ? ' alt' : '');
  d.id = 'point-' + i;
  var tri = document.createElement('div');
  tri.className = 'tri';
  d.appendChild(tri);
  var stack = document.createElement('div');
  stack.className = 'checkers';
  d.appendChild(stack);
  pointDivs[i] = d;
  (function (idx) {
    d.addEventListener('click', function () { onPointClick(idx); });
  })(i);
  return d;
}
function render() {
  var i, p, d, stack, c, j;
  for (i = 0; i < 24; i++) {
    d = pointDivs[i];
    if (!d) continue;
    p = G.points[i];
    stack = d.querySelector('.checkers');
    stack.innerHTML = '';
    var show = Math.min(p.count, 5);
    for (j = 0; j < show; j++) {
      c = document.createElement('div');
      c.className = 'checker ' + (p.color === 'w' ? 'white' : 'black');
      stack.appendChild(c);
    }
    var old = d.querySelector('.count-badge');
    if (old) old.remove();
    if (p.count > 5) {
      var badge = document.createElement('div');
      badge.className = 'count-badge';
      badge.textContent = '×' + faNum(p.count);
      stack.appendChild(badge);
    }
    d.classList.toggle('selected', G.selected === i);
    var isDest = false;
    for (var k = 0; k < G.dests.length; k++) {
      if (G.dests[k].to === i) { isDest = true; break; }
    }
    d.classList.toggle('legal-dest', isDest);
  }
  // بار
  $('bar-w-count').textContent = faNum(G.bar.w);
  $('bar-b-count').textContent = faNum(G.bar.b);
  $('bar-w').classList.toggle('selected', G.selected === 'bar');
  $('bar-b').classList.toggle('selected', G.selected === 'bar');
  // خارج‌شده‌ها
  $('off-w-count').textContent = faNum(G.off.w);
  $('off-b-count').textContent = faNum(G.off.b);
  // تاس‌ها
  renderDice();
  // نوبت
  var banner = $('turn-indicator');
  if (G.phase === 'over') {
    banner.textContent = '🏁 پایان بازی — برنده: ' + colorName(G.winner);
  } else {
    var t = 'نوبت ' + colorName(G.turn) + ' (' + (G.phase === 'roll' ? 'تاس بریزید' : 'حرکت کنید') + ')';
    if (mode === 'online' && isConnected) t += G.turn === myColor ? ' — نوبت شماست ✅' : ' — نوبت حریف ⏳';
    if (mode === 'bot') t += G.turn === 'w' ? ' — نوبت شماست ✅' : ' — نوبت کامپیوتر 🤖';
    banner.textContent = t;
  }
  // کیوب
  $('cube-value').textContent = faNum(G.cube.value);
  $('cube-owner').textContent = G.cube.owner === 'center' ? 'وسط' : colorName(G.cube.owner);
  // دکمه‌ها
  var act = canAct();
  $('btn-roll').disabled = !(act && G.phase === 'roll');
  $('btn-pass').disabled = !(act && G.phase === 'move');
  $('btn-cube').disabled = !canOfferCube();
  $('btn-roll').style.opacity = $('btn-roll').disabled ? 0.45 : 1;
  $('btn-pass').style.opacity = $('btn-pass').disabled ? 0.45 : 1;
  $('btn-cube').style.opacity = $('btn-cube').disabled ? 0.45 : 1;
  // هایلایت خروج (اگر انتخاب شده و خروج ممکن است)
  markOffTray();
  renderLog();
  updateRoomBar();
  saveSession();
}

function markOffTray() {
  var canOff = false;
  for (var i = 0; i < G.dests.length; i++) {
    if (G.dests[i].to === 'off') { canOff = true; break; }
  }
  var w = $('off-w'), b = $('off-b');
  w.classList.toggle('legal-dest', canOff && G.turn === 'w');
  b.classList.toggle('legal-dest', canOff && G.turn === 'b');
}

function renderDice() {
  var d0 = $('die-0'), d1 = $('die-1');
  if (!G.dice || G.dice.length < 2) {
    d0.className = 'die hidden'; d1.className = 'die hidden';
    d0.innerHTML = ''; d1.innerHTML = '';
    return;
  }
  paintDie(d0, G.dice[0]);
  paintDie(d1, G.dice[1]);
  // تاس مصرف‌شده را کم‌رنگ کن
  var tmp = G.movesLeft.slice();
  [[d0, G.dice[0]], [d1, G.dice[1]]].forEach(function (pair) {
    var elx = pair[0], v = pair[1];
    var k = tmp.indexOf(v);
    if (k >= 0) { tmp.splice(k, 1); elx.classList.remove('used'); }
    else elx.classList.add('used');
  });
  if (G.dice[0] === G.dice[1]) {
    d0.title = 'جفت! باقی‌مانده: ' + G.movesLeft.length;
    d1.title = 'جفت! باقی‌مانده: ' + G.movesLeft.length;
  }
}

function paintDie(elx, v) {
  elx.className = 'die';
  elx.innerHTML = '';
  var on = PIP[v] || [];
  for (var i = 0; i < 9; i++) {
    var s = document.createElement('span');
    s.className = on.indexOf(i) >= 0 ? 'pip' : 'pip blank';
    elx.appendChild(s);
  }
}

/* ---------------- تعامل کاربر ---------------- */

function onPointClick(idx) {
  if (G.phase !== 'move') {
    if (G.phase === 'roll') showMsg('اول تاس بریزید.');
    return;
  }
  if (!canAct()) { showMsg('نوبت شما نیست.'); return; }
  var c = G.turn;
  // اگر مهره روی بار است، باید اول وارد شود
  if (G.bar[c] > 0 && G.selected !== 'bar' && idx !== G.selected) {
    if (G.selected === 'bar') {
      tryGoTo(idx);
      return;
    }
    showMsg('مهره روی بار دارید؛ اول باید وارد زمین شود. روی بار بزنید.');
    selectBar();
    return;
  }
  // آیا روی مقصد قانونی کلیک شد؟
  if (G.selected !== null) {
    for (var i = 0; i < G.dests.length; i++) {
      if (G.dests[i].to === idx) {
        sndSelect();
        doMove(G.selected, idx);
        return;
      }
    }
  }
  // انتخاب / تغییر انتخاب
  if (idx === G.selected) {
    G.selected = null; G.dests = [];
    render();
    return;
  }
  var p = G.points[idx];
  if (p.color === c && p.count > 0) {
    G.selected = idx;
    G.dests = destsForFrom(boardOf(G), c, idx, G.movesLeft);
    if (G.dests.length === 0) showMsg('این مهره با تاس‌های باقی‌مانده حرکتی ندارد.');
    else { sndSelect(); showMsg('مهره انتخاب شد. روی خانه سبز مقصد بزنید.'); }
    render();
  } else if (G.selected !== null) {
    showMsg('مقصد نامعتبر است. خانه سبز را انتخاب کنید.');
  } else {
    showMsg('مهره‌ای از خودتان انتخاب کنید (' + colorName(c) + ').');
  }
}

function selectBar() {
  if (G.phase !== 'move' || !canAct()) return;
  var c = G.turn;
  if (G.bar[c] === 0) { showMsg('مهره‌ای روی بار ندارید.'); return; }
  if (G.selected === 'bar') { G.selected = null; G.dests = []; render(); return; }
  G.selected = 'bar';
  G.dests = destsForFrom(boardOf(G), c, 'bar', G.movesLeft);
  if (G.dests.length === 0) showMsg('ورود با تاس‌های باقی‌مانده ممکن نیست (مسدود است).');
  else { sndSelect(); showMsg('ورود از بار انتخاب شد. روی خانه سبز بزنید.'); }
  render();
}

function tryGoTo(idx) {
  for (var i = 0; i < G.dests.length; i++) {
    if (G.dests[i].to === idx) {
      doMove(G.selected, idx);
      return;
    }
  }
  showMsg('این خانه برای ورود مجاز نیست.');
}

function onOffTrayClick() {
  if (G.phase !== 'move' || !canAct() || G.selected === null) return;
  for (var i = 0; i < G.dests.length; i++) {
    if (G.dests[i].to === 'off') {
      doMove(G.selected, 'off');
      return;
    }
  }
  showMsg('خروج ممکن نیست (همه مهره‌ها باید در خانه خودی باشند و تاس مناسب داشته باشید).');
}

function onPass() {
  if (G.phase !== 'move' || !canAct()) return;
  if (G.movesLeft.length > 0 && anyMoveExists(boardOf(G), G.turn, G.movesLeft)) {
    showMsg('هنوز حرکت قانونی دارید؛ نمی‌توانید رد کنید.');
    return;
  }
  addLog(colorName(G.turn) + ' نوبت را تمام کرد.');
  endTurn(false);
}

/* ---------------- مودال‌ها ---------------- */

function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }
function closeAllModals() {
  var ms = document.querySelectorAll('.modal');
  for (var i = 0; i < ms.length; i++) ms[i].classList.remove('open');
}

/* ---------------- اتصال دکمه‌ها ---------------- */

function bindUI() {
  $('btn-roll').addEventListener('click', rollDice);
  $('btn-pass').addEventListener('click', onPass);
  $('btn-cube').addEventListener('click', offerCube);
  $('btn-cube-accept').addEventListener('click', function () { cubeRespond(true); });
  $('btn-cube-decline').addEventListener('click', function () { cubeRespond(false); });

  $('bar-w').addEventListener('click', function () { if (G.turn === 'w') selectBar(); });
  $('bar-b').addEventListener('click', function () { if (G.turn === 'b') selectBar(); });
  $('off-w').addEventListener('click', function () { if (G.turn === 'w') onOffTrayClick(); });
  $('off-b').addEventListener('click', function () { if (G.turn === 'b') onOffTrayClick(); });

  // منو
  $('btn-online').addEventListener('click', function () { openModal('modal-home'); });
  $('btn-local').addEventListener('click', function () { roomCode = null; startGame('local'); });
  $('btn-bot').addEventListener('click', function () { roomCode = null; startGame('bot'); });
  $('btn-help').addEventListener('click', function () { openModal('modal-help'); });
  $('btn-home-help').addEventListener('click', function () { openModal('modal-help'); });
  $('btn-close-help').addEventListener('click', function () { closeModal('modal-help'); });

  // خانه
  $('btn-start-online').addEventListener('click', hostGame);
  $('btn-join-room').addEventListener('click', function () { joinGame($('join-code-input').value); });
  $('btn-start-local').addEventListener('click', function () { roomCode = null; startGame('local'); });
  $('btn-start-bot').addEventListener('click', function () { roomCode = null; startGame('bot'); });
  $('btn-cancel-wait').addEventListener('click', function () {
    userLeft = true; clearSession();
    closeModal('modal-wait'); cleanupPeer(); mode = 'local'; roomCode = null; updateRoomBar();
  });

  // پایان
  $('btn-again').addEventListener('click', function () {
    closeModal('modal-gameover');
    if (mode === 'online') {
      // شروع دوباره همگام
      var ng = freshState();
      var keepMode = mode;
      G = ng; setupBoard();
      var dw, db;
      do { dw = randDie(); db = randDie(); } while (dw === db);
      G.turn = dw > db ? 'w' : 'b';
      G.mode = keepMode;
      addLog('بازی دوباره شروع شد. شروع‌کننده: ' + colorName(G.turn));
      render();
      sendMsg({ t: 'restart', G: G });
    } else {
      startGame(mode);
    }
  });
  $('btn-to-home').addEventListener('click', function () {
    userLeft = true; clearSession();
    closeModal('modal-gameover'); openModal('modal-home');
  });

  // اتاق — کپی کد و لینک
  function copyText(txt, okMsg) {
    var done = function () { showMsg(okMsg); };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { showMsg('کپی نشد: ' + txt); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, fallback);
    } else fallback();
  }
  $('btn-copy').addEventListener('click', function () {
    copyText($('room-code').textContent, 'کد اتاق کپی شد: ' + $('room-code').textContent);
  });
  $('btn-copy-code-wait').addEventListener('click', function () {
    copyText(roomCode || '', 'کد اتاق کپی شد: ' + (roomCode || ''));
  });
  $('btn-copy-link-wait').addEventListener('click', function () {
    copyText(shareLinkFor(roomCode || ''), 'لینک دعوت کپی شد! بفرستید برای دوستتان ✅');
  });
  $('share-link').addEventListener('click', function (e) {
    var link = shareLinkFor(roomCode || '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      e.preventDefault();
      navigator.clipboard.writeText(link).then(function () { showMsg('لینک دعوت کپی شد!'); });
    }
  });

  // چت
  $('btn-send-chat').addEventListener('click', sendChat);
  $('chat-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendChat();
  });

  // بستن مودال راهنما با کلیک بیرون
  var ms = document.querySelectorAll('.modal');
  for (var i = 0; i < ms.length; i++) {
    (function (m) {
      m.addEventListener('click', function (e) {
        if (e.target === m && m.id !== 'modal-wait') m.classList.remove('open');
      });
    })(ms[i]);
  }
}

/* ---------------- شروع ---------------- */

function init() {
  buildPoints();
  bindUI();
  setupBoard();
  // تاس‌کشی نمایشی برای صفحه اول
  var dw, db;
  do { dw = randDie(); db = randDie(); } while (dw === db);
  G.turn = dw > db ? 'w' : 'b';
  addLog('به تخته نرد خوش آمدید! یک حالت را انتخاب کنید.');
  showMsg('از منوی خانه یک حالت بازی انتخاب کنید.');
  render();
  // لینک دعوت ?join=CODE (اولویت با لینک است) وگرنه ادامه بازی قبلی بعد از رفرش
  try {
    var m = location.search.match(/[?&]join=([A-Za-z0-9]{5})/);
    if (m) {
      clearSession();
      $('join-code-input').value = m[1].toUpperCase();
      showMsg('لینک دعوت دریافت شد. در حال ورود به اتاق ' + m[1].toUpperCase() + ' ...');
      joinGame(m[1]);
    } else {
      var s = loadSession();
      if (s && s.G && s.G.phase !== 'over') restoreSession(s);
      else clearSession();
    }
  } catch (e) {}
  updateRoomBar();
}

/* برگرداندن بازی ذخیره‌شده بعد از رفرش صفحه */
function restoreSession(s) {
  mode = s.mode || 'local';
  roomCode = s.roomCode || null;
  isHost = !!s.isHost;
  myColor = s.myColor || 'w';
  G = s.G;
  G.selected = null; G.dests = [];
  sessionOn = true; userLeft = false;
  closeAllModals();
  if (mode === 'online' && roomCode) {
    if (isHost) {
      addLog('بازی قبلی برگردانده شد؛ اتاق ' + roomCode + ' دوباره باز می‌شود...');
      showMsg('ادامه بازی قبلی — در انتظار وصل شدن مجدد حریف... 🔄');
      hostGame(true);
    } else {
      addLog('بازی قبلی برگردانده شد؛ وصل شدن مجدد به اتاق ' + roomCode + ' ...');
      showMsg('ادامه بازی قبلی — در حال وصل شدن به اتاق... 🔄');
      updateRoomBar();
      render();
      reconnectGuest();
    }
  } else {
    addLog('بازی قبلی برگردانده شد 👍 ادامه بدهید!');
    showMsg('ادامه بازی قبلی — موفق باشید! 🎲');
    updateRoomBar();
    render();
  }
  maybeBotTurn();
}

/* هوک تست خودکار (اثری روی بازی ندارد) */
window.__nardTest = {
  computeAllowedDice: computeAllowedDice,
  movesForDieOn: movesForDieOn,
  cloneBoard: cloneBoard,
  applyMoveTo: applyMoveTo,
  blankPoints: blankPoints,
  boardOf: boardOf,
  entryIndex: entryIndex,
  allInHome: allInHome,
  freshState: freshState,
  setupBoard: setupBoard,
  getG: function () { return G; }
};

init();

});
