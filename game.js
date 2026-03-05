/* ============================================================
   SCRAPZONE — GAME LOGIC v2
   + Серая редкость (x0.3, вес 50)
   + Тапалка (+10 за клик)
   + Копилка (10% в минуту)
   + Апгрейд (ставка → цель, шанс = ставка/цель × 100%, 1–75%)
   ============================================================ */

'use strict';

// ─── STATE ────────────────────────────────────────────────────
const state = {
  balance: 1000,
  isOpening: false,
  history: [],

  // Тапалка
  tapCount: 0,
  tapEarned: 0,

  // Копилка
  bankStored: 0,    // сколько в копилке
  bankInterest: 0,    // накоплено процентов (ещё не изъяты)
  bankInterval: null, // setInterval handle
  bankNextTick: 0,    // timestamp следующего тика (ms)
  bankTimerRaf: null, // requestAnimationFrame handle

  // Апгрейд
  upgInProgress: false,
};

// ─── CONSTANTS ────────────────────────────────────────────────
const CASE_COST = 100;
const SLOT_W = 120;
const SLOT_GAP = 10;
const SLOT_STEP = SLOT_W + SLOT_GAP;
const STRIP_ITEMS = 80;
const WIN_INDEX = 60;

const TAP_REWARD = 10;
const BANK_RATE = 0.10;   // 10% in minuta
const BANK_INTERVAL_MS = 60_000;

const UPG_MIN_CHANCE = 1;    // %
const UPG_MAX_CHANCE = 75;   // %

// ─── RARITIES ─────────────────────────────────────────────────
// «weight» используется для взвешенного случайного выбора.
// Итого weight = 50+50+30+10+4+0.5 = 144.5
const RARITIES = [
  { id: 'grey', name: 'Серая', color: '#888ea8', weight: 50, multiplier: 0.3, emoji: '⚙️' },
  { id: 'blue', name: 'Синяя', color: '#4b9bff', weight: 50, multiplier: 1.5, emoji: '🔵' },
  { id: 'green', name: 'Зелёная', color: '#2ecc71', weight: 30, multiplier: 2, emoji: '🟢' },
  { id: 'purple', name: 'Фиолетовая', color: '#9b59b6', weight: 10, multiplier: 4, emoji: '🟣' },
  { id: 'red', name: 'Красная', color: '#e74c3c', weight: 4, multiplier: 8, emoji: '🔴' },
  { id: 'gold', name: 'Золотая', color: '#f5a623', weight: 0.5, multiplier: 25, emoji: '⭐' },
];

// ─── CASE DEFINITIONS ─────────────────────────────────────────
const CASES = {
  scrap: {
    name: 'Ящик Металлолома', emoji: '🔧',
    items: {
      grey: ['Ржавая гайка', 'Погнутый шуруп', 'Треснутая накладка', 'Мятый лом'],
      blue: ['Ржавый болт', 'Гнутая труба', 'Старый гаечный ключ', 'Лопнувшая шестерня'],
      green: ['Медный провод', 'Бронзовая бляха', 'Алюминиевый лист', 'Трубка с клапаном'],
      purple: ['Стальной слиток', 'Хромовая деталь', 'Цепной привод', 'Редуктор'],
      red: ['Кованая сталь', 'Армированная плита', 'Легированный брус', 'Прецизионный вал'],
      gold: ['Легендарный металл', 'Чистый титан'],
    }
  },
  relics: {
    name: 'Ящик Реликвий', emoji: '💎',
    items: {
      grey: ['Битая черепица', 'Тусклый камень', 'Потёртая монета', 'Обломок глины'],
      blue: ['Старая монета', 'Бронзовый медальон', 'Каменная пластина', 'Фрагмент амулета'],
      green: ['Серебряный знак', 'Антикварный ключ', 'Чеканная монета', 'Рунный камень'],
      purple: ['Кристалл памяти', 'Древний свиток', 'Магический амулет', 'Обломок меча'],
      red: ['Рубиновый кристалл', 'Сапфировый осколок', 'Изумрудный знак', 'Янтарный фолиант'],
      gold: ['Алмазная реликвия', 'Артефакт богов'],
    }
  },
};

// ─── UTILS ────────────────────────────────────────────────────
function rollRarity() {
  const total = RARITIES.reduce((s, r) => s + r.weight, 0);
  let rng = Math.random() * total;
  for (const r of RARITIES) {
    rng -= r.weight;
    if (rng <= 0) return r;
  }
  return RARITIES[0];
}

function pickItem(caseId, rarityId) {
  const pool = CASES[caseId].items[rarityId];
  return pool[Math.floor(Math.random() * pool.length)];
}

function fmt(n) {
  return Math.round(n).toLocaleString('ru-RU');
}

function refreshBalance() {
  const el = document.getElementById('balance-display');
  el.textContent = fmt(state.balance);
  el.classList.remove('updated');
  void el.offsetWidth;
  el.classList.add('updated');
  setTimeout(() => el.classList.remove('updated'), 600);
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

function setButtons(disabled) {
  document.querySelectorAll('.btn-open').forEach(b => b.disabled = disabled);
}

// ─── TAB SWITCHING ────────────────────────────────────────────
function switchTab(id) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`tab-${id}`).classList.add('active');
  document.getElementById(`content-${id}`).classList.add('active');
}

// ═══════════════════════════════════════════════════════════════
//  КЕЙСЫ — ROULETTE
// ═══════════════════════════════════════════════════════════════
function makeSlot(rarity, caseId) {
  const item = pickItem(caseId, rarity.id);
  const el = document.createElement('div');
  el.className = 'roulette-slot';
  el.style.setProperty('--slot-color', rarity.color);

  const emojiEl = document.createElement('span');
  emojiEl.className = 'slot-emoji';
  emojiEl.textContent = rarity.emoji;

  const nameEl = document.createElement('span');
  nameEl.className = 'slot-name';
  nameEl.textContent = item;

  el.appendChild(emojiEl);
  el.appendChild(nameEl);
  return { el, item };
}

function buildStrip(winner, caseId) {
  const strip = document.getElementById('roulette-strip');
  strip.innerHTML = '';
  let winItemName = '';
  for (let i = 0; i < STRIP_ITEMS; i++) {
    const isWinner = (i === WIN_INDEX);
    const rarity = isWinner ? winner : rollRarity();
    const { el, item } = makeSlot(rarity, caseId);
    if (isWinner) winItemName = item;
    strip.appendChild(el);
  }
  return winItemName;
}

function spinRoulette() {
  return new Promise(resolve => {
    const strip = document.getElementById('roulette-strip');
    const viewport = document.getElementById('roulette-viewport');
    const vpCenter = viewport.clientWidth / 2;
    const winCenter = WIN_INDEX * SLOT_STEP + SLOT_W / 2;
    const targetX = -(winCenter - vpCenter);
    const jitter = (Math.random() - 0.5) * 50;

    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0px)';
    void strip.offsetWidth;

    strip.style.transition = 'transform 6s cubic-bezier(0.12, 0.97, 0.26, 1)';
    strip.style.transform = `translateX(${targetX + jitter}px)`;

    setTimeout(() => {
      const slots = strip.querySelectorAll('.roulette-slot');
      if (slots[WIN_INDEX]) slots[WIN_INDEX].classList.add('winner');
      resolve();
    }, 6200);
  });
}

async function openCase(caseId) {
  if (state.isOpening) return;
  if (state.balance < CASE_COST) {
    showToast(`❌ Недостаточно металлолома! Нужно ${CASE_COST} 🔩`);
    return;
  }

  state.balance -= CASE_COST;
  refreshBalance();
  state.isOpening = true;
  setButtons(true);

  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('modal-title');
  const resultDiv = document.getElementById('modal-result');
  const strip = document.getElementById('roulette-strip');

  resultDiv.style.display = 'none';
  resultDiv.style.animation = 'none';
  strip.style.transition = 'none';
  strip.style.transform = 'translateX(0)';

  const caseData = CASES[caseId];
  title.textContent = `🎰 Открываем: ${caseData.name}`;
  overlay.classList.add('active');

  const winner = rollRarity();
  const winItem = buildStrip(winner, caseId);

  await spinRoulette();

  const reward = Math.round(CASE_COST * winner.multiplier);
  const net = reward - CASE_COST;
  state.balance += reward;
  refreshBalance();

  addHistory(caseId, winner, winItem, reward);
  showCaseResult(winner, winItem, reward, net);
}

function showCaseResult(winner, itemName, reward, net) {
  const resultDiv = document.getElementById('modal-result');
  const title = document.getElementById('modal-title');

  title.textContent = net >= 0 ? '🎉 Поздравляем!' : '😞 Не повезло...';

  const rarityEl = document.getElementById('result-rarity');
  rarityEl.textContent = winner.name;
  rarityEl.style.color = winner.color;
  rarityEl.style.textShadow = `0 0 20px ${winner.color}`;

  document.getElementById('result-item').textContent =
    itemName;

  // Покажем потерю красным, если серая редкость
  const earnEl = document.getElementById('result-earn');
  if (net < 0) {
    earnEl.textContent = `${fmt(reward)} 🔩 (x${winner.multiplier}) — потеря`;
    earnEl.style.color = '#e74c3c';
  } else {
    earnEl.textContent = `+${fmt(reward)} 🔩 (x${winner.multiplier})`;
    earnEl.style.color = '';
  }

  document.getElementById('result-balance').textContent =
    `Баланс: ${fmt(state.balance)} металлолома`;

  resultDiv.style.animation = '';
  resultDiv.style.display = 'flex';
  void resultDiv.offsetWidth;
  resultDiv.style.animation = 'fade-up 0.5s ease';
}

function addHistory(caseId, rarity, itemName, reward) {
  const entry = { caseEmoji: CASES[caseId].emoji, rarity, itemName, reward };
  state.history.unshift(entry);
  if (state.history.length > 10) state.history.pop();
  renderHistory();
}

function renderHistory() {
  const section = document.getElementById('history-section');
  const list = document.getElementById('history-list');
  section.style.display = '';
  list.innerHTML = '';
  for (const h of state.history) {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.style.setProperty('--rc', h.rarity.color);
    div.innerHTML = `
      <span class="history-case">${h.caseEmoji}</span>
      <span class="history-rarity">${h.rarity.name}</span>
      <span class="history-item-name">${h.itemName}</span>
      <span class="history-earn">${h.reward >= CASE_COST ? '+' : ''}${fmt(h.reward)} 🔩</span>
    `;
    list.appendChild(div);
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  state.isOpening = false;
  setButtons(false);
}

// ═══════════════════════════════════════════════════════════════
//  ТАПАЛКА
// ═══════════════════════════════════════════════════════════════
function doTap() {
  state.balance += TAP_REWARD;
  state.tapCount += 1;
  state.tapEarned += TAP_REWARD;
  refreshBalance();

  document.getElementById('tap-count').textContent = fmt(state.tapCount);
  document.getElementById('tap-earned').textContent = fmt(state.tapEarned) + ' 🔩';

  // Floating label
  spawnFloatLabel('+' + TAP_REWARD + ' 🔩');
}

function spawnFloatLabel(text) {
  const btn = document.getElementById('tap-btn');
  const rect = btn.getBoundingClientRect();

  const el = document.createElement('div');
  el.className = 'float-label';
  el.textContent = text;

  // Random horizontal spread
  const offsetX = (Math.random() - 0.5) * 100;
  el.style.left = (rect.left + rect.width / 2 + offsetX) + 'px';
  el.style.top = (rect.top + rect.height / 2 - 20) + 'px';

  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// ═══════════════════════════════════════════════════════════════
//  КОПИЛКА
// ═══════════════════════════════════════════════════════════════
function bankDeposit() {
  const input = document.getElementById('bank-deposit-input');
  const amount = Math.floor(Number(input.value));
  input.value = '';

  if (!amount || amount < 1) { showToast('⚠️ Введи корректную сумму'); return; }
  if (amount > state.balance) { showToast('❌ Недостаточно металлолома'); return; }

  state.balance -= amount;
  state.bankStored += amount;
  refreshBalance();
  refreshBankUI();

  // Piggy jiggle
  const pig = document.getElementById('bank-pig');
  pig.classList.remove('jiggle');
  void pig.offsetWidth;
  pig.classList.add('jiggle');

  showToast(`🐷 Положено ${fmt(amount)} 🔩 в копилку!`);
  document.getElementById('btn-bank-withdraw').disabled = false;

  // Start or reset interval
  startBankInterval();
}

function bankWithdraw() {
  if (state.bankStored === 0 && state.bankInterest === 0) return;
  const total = state.bankStored + state.bankInterest;
  state.balance += total;
  state.bankStored = 0;
  state.bankInterest = 0;
  refreshBalance();
  refreshBankUI();

  stopBankInterval();
  document.getElementById('btn-bank-withdraw').disabled = true;
  showToast(`💰 Забрали ${fmt(total)} 🔩 из копилки!`);
}

function startBankInterval() {
  stopBankInterval();
  state.bankNextTick = Date.now() + BANK_INTERVAL_MS;

  state.bankInterval = setInterval(() => {
    if (state.bankStored <= 0) { stopBankInterval(); return; }
    const earned = Math.floor(state.bankStored * BANK_RATE);
    state.bankInterest += earned;
    refreshBankUI();
    showToast(`🐷 Копилка начислила +${fmt(earned)} 🔩`);
    state.bankNextTick = Date.now() + BANK_INTERVAL_MS;
  }, BANK_INTERVAL_MS);

  // Countdown RAF
  bankCountdown();
}

function stopBankInterval() {
  if (state.bankInterval) { clearInterval(state.bankInterval); state.bankInterval = null; }
  if (state.bankTimerRaf) { cancelAnimationFrame(state.bankTimerRaf); state.bankTimerRaf = null; }
}

function bankCountdown() {
  const timerEl = document.getElementById('bank-timer');
  function tick() {
    if (!state.bankInterval) { timerEl.textContent = '—'; return; }
    const remaining = Math.max(0, state.bankNextTick - Date.now());
    const s = Math.ceil(remaining / 1000);
    timerEl.textContent = s + ' сек';
    state.bankTimerRaf = requestAnimationFrame(tick);
  }
  tick();
}

function refreshBankUI() {
  document.getElementById('bank-stored').textContent = fmt(state.bankStored) + ' 🔩';
  document.getElementById('bank-interest').textContent = fmt(state.bankInterest) + ' 🔩';
}

// ═══════════════════════════════════════════════════════════════
//  АПГРЕЙД
// ═══════════════════════════════════════════════════════════════
/**
 * шанс = clamp(stake / want × 100, UPG_MIN_CHANCE, UPG_MAX_CHANCE)
 */
function calcUpgradeChance(stake, want) {
  if (!stake || !want || want <= 0 || stake <= 0) return null;
  const raw = (stake / want) * 100;
  return Math.min(UPG_MAX_CHANCE, Math.max(UPG_MIN_CHANCE, raw));
}

function calcUpgrade() {
  const stakeVal = Math.floor(Number(document.getElementById('upg-stake').value));
  const wantVal = Math.floor(Number(document.getElementById('upg-want').value));
  const btn = document.getElementById('btn-upgrade');
  const result = document.getElementById('upgrade-result');
  result.textContent = '';
  result.className = 'upgrade-result';

  if (!stakeVal || !wantVal || stakeVal < 1 || wantVal < 1) {
    setChanceUI(null);
    btn.disabled = true;
    return;
  }

  const chance = calcUpgradeChance(stakeVal, wantVal);
  setChanceUI(chance);

  // Summary
  document.getElementById('upg-s-stake').textContent = fmt(stakeVal) + ' 🔩';
  document.getElementById('upg-s-want').textContent = fmt(wantVal) + ' 🔩';
  document.getElementById('upg-s-lose').textContent = '-' + fmt(stakeVal) + ' 🔩';

  btn.disabled = (stakeVal > state.balance) || state.upgInProgress;
}

function setChanceUI(chance) {
  const pctEl = document.getElementById('chance-pct');
  const arc = document.getElementById('chance-arc');
  const CIRC = 2 * Math.PI * 50; // ~314.16

  if (chance === null) {
    pctEl.textContent = '—';
    arc.setAttribute('stroke-dasharray', `0 ${CIRC}`);
    arc.style.stroke = '#4b9bff';
    return;
  }

  pctEl.textContent = chance.toFixed(1) + '%';
  const filled = (chance / 100) * CIRC;
  arc.setAttribute('stroke-dasharray', `${filled} ${CIRC - filled}`);

  // Color: green→yellow→red as chance decreases
  if (chance >= 60) arc.style.stroke = '#2ecc71';
  else if (chance >= 30) arc.style.stroke = '#f5a623';
  else arc.style.stroke = '#e74c3c';
}

async function doUpgrade() {
  if (state.upgInProgress) return;

  const stakeVal = Math.floor(Number(document.getElementById('upg-stake').value));
  const wantVal = Math.floor(Number(document.getElementById('upg-want').value));

  if (!stakeVal || !wantVal || stakeVal < 1 || wantVal < 1) {
    showToast('⚠️ Введи ставку и цель'); return;
  }
  if (stakeVal > state.balance) {
    showToast('❌ Недостаточно металлолома'); return;
  }

  const chance = calcUpgradeChance(stakeVal, wantVal);
  if (chance === null) return;

  state.upgInProgress = true;
  state.balance -= stakeVal;
  refreshBalance();

  const btn = document.getElementById('btn-upgrade');
  const result = document.getElementById('upgrade-result');
  btn.disabled = true;
  result.textContent = '';
  result.className = 'upgrade-result';

  // Fake suspense animation
  await new Promise(r => setTimeout(r, 800));

  const roll = Math.random() * 100;
  const win = roll <= chance;

  if (win) {
    state.balance += wantVal;
    refreshBalance();
    result.textContent = `✅ УСПЕХ! +${fmt(wantVal)} 🔩`;
    result.className = 'upgrade-result win';
    showToast(`⚡ Апгрейд успешен! Получено ${fmt(wantVal)} 🔩`);
  } else {
    result.textContent = `❌ НЕУДАЧА! -${fmt(stakeVal)} 🔩`;
    result.className = 'upgrade-result lose';
    showToast(`💀 Апгрейд провалился! Потеряно ${fmt(stakeVal)} 🔩`);
  }

  state.upgInProgress = false;
  btn.disabled = false;
  calcUpgrade(); // re-validate button state
}

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════
(function init() {
  refreshBalance();
  refreshBankUI();

  // Close modal on background click (only when result shown)
  document.getElementById('modal-overlay').addEventListener('click', function (e) {
    if (e.target === this &&
      document.getElementById('modal-result').style.display !== 'none') {
      closeModal();
    }
  });

  // ESC to close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' &&
      document.getElementById('modal-overlay').classList.contains('active') &&
      document.getElementById('modal-result').style.display !== 'none') {
      closeModal();
    }
  });

  console.log('%c⚙ ScrapZone v2 loaded!', 'color:#4b9bff;font-weight:bold');
})();
