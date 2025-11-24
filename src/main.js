import './style.css';

// --- DOM references (common) --- //

const dayButtons = document.querySelectorAll('.day-button');
const daySections = document.querySelectorAll('.day-content');
const titleEl = document.getElementById('dayTitle');
const weekLabelEl = document.getElementById('weekLabel');
const dayDateSpans = document.querySelectorAll('.day-date');
const weekPrevBtn = document.getElementById('weekPrev');
const weekNextBtn = document.getElementById('weekNext');
const dayTotalEl = document.getElementById('dayTotal');

const STORAGE_KEY = 'wochenplan-v1';

const topNavTabs = document.querySelectorAll('.top-nav-tab');
const appViews = document.querySelectorAll('.app-view');

const pikettAddBtn = document.getElementById('pikettAddBtn');
const PIKETT_STORAGE_KEY = 'pikett-v1';
const pikettMonthLabelEl = document.getElementById('pikettMonthLabel');
const pikettMonthPrevBtn = document.getElementById('pikettMonthPrev');
const pikettMonthNextBtn = document.getElementById('pikettMonthNext');
const pikettMonthTotalEl = document.getElementById('pikettMonthTotal');

// --- Top navigation (Wochenplan / Pikett / Dashboard / Dokumente) --- //

topNavTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view; // "wochenplan", "pikett", "dashboard", "dokumente"

    // Switch active tab
    topNavTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    // Switch active view
    appViews.forEach((v) => {
      v.classList.toggle('active', v.id === `view-${view}`);
    });
  });
});

// --- Wochenplan state + storage --- //

let weekOffset = 0; // 0 = current week, -1 = previous, +1 = next, etc.
let currentDayId = 'montag'; // active weekday

// mapping weekday -> offset from Monday
const DAY_OFFSETS = {
  montag: 0,
  dienstag: 1,
  mittwoch: 2,
  donnerstag: 3,
  freitag: 4,
};

// In-memory store: dateKey -> { flags: {...}, entries: [...] }
const dayStore = {}; // e.g. { "2025-11-25": { flags: { sick: true, ... }, entries: [...] } }

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      Object.assign(dayStore, parsed);
    }
  } catch (err) {
    console.error('Failed to load from storage', err);
  }
}

function saveToStorage() {
  try {
    const json = JSON.stringify(dayStore);
    localStorage.setItem(STORAGE_KEY, json);
  } catch (err) {
    console.error('Failed to save to storage', err);
  }
}

// --- Pikett localStorage helpers --- //

function loadPikettStore() {
  const raw = localStorage.getItem(PIKETT_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePikettStore() {
  localStorage.setItem(PIKETT_STORAGE_KEY, JSON.stringify(pikettStore));
}

// Create a new empty Pikett-Einsatz entry (default date = today)
function createEmptyPikettEntry() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const today = `${yyyy}-${mm}-${dd}`;

  return {
    date: today,
    komNr: '',
    hours: 0,
    note: '',
  };
}

// Global store for Pikett entries
let pikettStore = loadPikettStore();

// 0 = aktueller Monat, -1 = Vormonat, +1 = nächster Monat
let pikettMonthOffset = 0;

// Info über den aktuell ausgewählten Pikett-Monat
function getCurrentPikettMonthInfo() {
  const today = new Date();

  const base = new Date(today.getFullYear(), today.getMonth(), 1);
  base.setMonth(base.getMonth() + pikettMonthOffset);

  const year = base.getFullYear();
  const monthIndex = base.getMonth(); // 0–11

  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 1);

  const label = base.toLocaleString('de-DE', {
    month: 'long',
    year: 'numeric',
  });

  return {
    year,
    monthIndex,
    start,
    end,
    label,
  };
}

// Pikett-Liste für aktuellen Monat rendern
function renderPikettList() {
  const listEl = document.getElementById('pikettList');
  if (!listEl) return;

  const info = getCurrentPikettMonthInfo();

  // Monatstitel aktualisieren
  if (pikettMonthLabelEl) {
    const text =
      info.label.charAt(0).toUpperCase() + info.label.slice(1);
    pikettMonthLabelEl.textContent = text;
  }

  listEl.innerHTML = '';

  const monthEntries = [];

  pikettStore.forEach((entry, index) => {
    if (!entry.date) return;

    const d = new Date(entry.date);
    if (Number.isNaN(d.getTime())) return;

    const y = d.getFullYear();
    const m = d.getMonth();

    if (y !== info.year || m !== info.monthIndex) return;

    monthEntries.push({ entry, index, dateObj: d });
  });

  // Keine Einträge im Monat → Hinweis + 0,0 h
  if (monthEntries.length === 0) {
    if (pikettMonthTotalEl) {
      pikettMonthTotalEl.textContent = '0,0 h';
    }

    const emptyCard = document.createElement('div');
    emptyCard.className = 'pikett-card';
    emptyCard.textContent =
      'Noch keine Pikett-Einsätze in diesem Monat erfasst.';
    listEl.appendChild(emptyCard);

    return;
  }

  // Sortieren nach Datum (aufsteigend)
  monthEntries.sort((a, b) => a.dateObj - b.dateObj);

  let monthTotal = 0;

  monthEntries.forEach(({ entry, index }) => {
    if (typeof entry.hours === 'number' && !Number.isNaN(entry.hours)) {
      monthTotal += entry.hours;
    }

    const card = document.createElement('div');
    card.className = 'pikett-card';
    card.dataset.index = String(index);

    // Header: Date + Kom.Nummer + remove
    const header = document.createElement('div');
    header.className = 'pikett-card-header';

    const fieldGroup = document.createElement('div');
    fieldGroup.className = 'pikett-field-group';

    // Date
    const dateLabel = document.createElement('label');
    dateLabel.className = 'pikett-label';

    const dateSpan = document.createElement('span');
    dateSpan.textContent = 'Datum';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'pikett-date';
    dateInput.value = entry.date || '';

    dateLabel.appendChild(dateSpan);
    dateLabel.appendChild(dateInput);

    // Kom.Nummer
    const komLabel = document.createElement('label');
    komLabel.className = 'pikett-label';

    const komSpan = document.createElement('span');
    komSpan.textContent = 'Kom.Nummer (Anlage)';

    const komInput = document.createElement('input');
    komInput.type = 'text';
    komInput.className = 'pikett-kom';
    komInput.placeholder = 'z.B. 123456';
    komInput.value = entry.komNr || '';

    komLabel.appendChild(komSpan);
    komLabel.appendChild(komInput);

    fieldGroup.appendChild(dateLabel);
    fieldGroup.appendChild(komLabel);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'pikett-remove-btn';
    removeBtn.textContent = '✕';

    header.appendChild(fieldGroup);
    header.appendChild(removeBtn);

    // Body: hours + note
    const body = document.createElement('div');
    body.className = 'pikett-card-body';

    const hoursLabel = document.createElement('label');
    hoursLabel.className = 'pikett-label';

    const hoursSpan = document.createElement('span');
    hoursSpan.textContent = 'Pikett-Stunden';

    const hoursInput = document.createElement('input');
    hoursInput.type = 'number';
    hoursInput.min = '0';
    hoursInput.step = '0.25';
    hoursInput.placeholder = '0,0';
    hoursInput.className = 'pikett-hours';

    if (
      typeof entry.hours === 'number' &&
      !Number.isNaN(entry.hours) &&
      entry.hours !== 0
    ) {
      hoursInput.value = entry.hours.toString().replace('.', ',');
    }

    hoursLabel.appendChild(hoursSpan);
    hoursLabel.appendChild(hoursInput);

    const noteLabel = document.createElement('label');
    noteLabel.className = 'pikett-label';

    const noteSpan = document.createElement('span');
    noteSpan.textContent = 'Notiz (optional)';

    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.className = 'pikett-note';
    noteInput.placeholder = 'z.B. kurze Beschreibung';
    noteInput.value = entry.note || '';

    noteLabel.appendChild(noteSpan);
    noteLabel.appendChild(noteInput);

    body.appendChild(hoursLabel);
    body.appendChild(noteLabel);

    card.appendChild(header);
    card.appendChild(body);

    listEl.appendChild(card);
  });

  // Monatstotal anzeigen
  if (pikettMonthTotalEl) {
    const formatted = monthTotal.toFixed(1).replace('.', ',') + ' h';
    pikettMonthTotalEl.textContent = formatted;
  }
}

// Nur die Monatssumme für Pikett neu berechnen, ohne neu zu rendern
function updatePikettMonthTotal() {
  if (!pikettMonthTotalEl) return;

  const info = getCurrentPikettMonthInfo();
  let monthTotal = 0;

  pikettStore.forEach((entry) => {
    if (!entry.date) return;

    const d = new Date(entry.date);
    if (Number.isNaN(d.getTime())) return;

    const y = d.getFullYear();
    const m = d.getMonth();
    if (y !== info.year || m !== info.monthIndex) return;

    if (typeof entry.hours === 'number' && !Number.isNaN(entry.hours)) {
      monthTotal += entry.hours;
    }
  });

  const formatted = monthTotal.toFixed(1).replace('.', ',') + ' h';
  pikettMonthTotalEl.textContent = formatted;
}

// Add new Pikett-Einsatz when clicking the button
if (pikettAddBtn) {
  pikettAddBtn.addEventListener('click', () => {
    pikettStore.push(createEmptyPikettEntry());
    savePikettStore();
    renderPikettList();
    updatePikettMonthTotal();
  });
}

// Update Pikett entries when the user edits fields
document.addEventListener('input', (event) => {
  const target = event.target;
  if (!target) return;

  // Only care about elements inside a .pikett-card
  const card = target.closest('.pikett-card');
  if (!card) return;

  const index = Number(card.dataset.index);
  if (Number.isNaN(index) || !pikettStore[index]) return;

  const entry = pikettStore[index];

  if (target.classList.contains('pikett-date')) {
    entry.date = target.value || '';
  } else if (target.classList.contains('pikett-kom')) {
    const normalized = normalizeKomNr(target.value);
    target.value = normalized;
    entry.komNr = normalized;
  } else if (target.classList.contains('pikett-hours')) {
    const raw = target.value.trim();
    const num = raw ? parseFloat(raw.replace(',', '.')) : 0;
    entry.hours = Number.isNaN(num) ? 0 : num;
  } else if (target.classList.contains('pikett-note')) {
    entry.note = target.value;
  } else {
    return;
  }

  savePikettStore();
  updatePikettMonthTotal(); // nur Summe aktualisieren
});

// Remove a Pikett-Einsatz card
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!target) return;

  if (target.classList.contains('pikett-remove-btn')) {
    const card = target.closest('.pikett-card');
    if (!card) return;

    const index = Number(card.dataset.index);
    if (Number.isNaN(index)) return;

    pikettStore.splice(index, 1);
    savePikettStore();
    renderPikettList();
    updatePikettMonthTotal();
  }
});

// Pikett-Monat wechseln
if (pikettMonthPrevBtn) {
  pikettMonthPrevBtn.addEventListener('click', () => {
    pikettMonthOffset -= 1;
    renderPikettList();
    updatePikettMonthTotal();
  });
}

if (pikettMonthNextBtn) {
  pikettMonthNextBtn.addEventListener('click', () => {
    pikettMonthOffset += 1;
    renderPikettList();
    updatePikettMonthTotal();
  });
}

// --- Helpers --- //

// Normalize Kom.Nummer: remove all whitespace (spaces, tabs, line breaks)
function normalizeKomNr(value) {
  if (!value) return '';
  return value.replace(/\s+/g, '');
}

// --- Date helpers for Wochenplan --- //

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getISOWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;

  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  const year = d.getUTCFullYear();

  return { week: weekNo, year };
}

function formatShortDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

function getMondayForCurrentWeek() {
  const today = new Date();
  const baseMonday = getMonday(today);
  const monday = new Date(baseMonday);
  monday.setDate(baseMonday.getDate() + weekOffset * 7);
  return monday;
}

function getCurrentDateKey() {
  const monday = getMondayForCurrentWeek();
  const offset = DAY_OFFSETS[currentDayId] ?? 0;
  const d = new Date(monday);
  d.setDate(monday.getDate() + offset);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getOrCreateDayData(dateKey) {
  if (!dayStore[dateKey]) {
    dayStore[dateKey] = {
      flags: {
        sick: false,
        vacation: false,
        training: false,
        homeOffice: false,
        travelDay: false,
        other: false,
      },
      entries: [],
      // NEW: Verpflegungspauschale (1=Frühstück, 2=Mittag, 3=Abend)
      mealAllowance: {
        '1': false,
        '2': false,
        '3': false,
      },
    };
  }

  if (!dayStore[dateKey].entries) {
    dayStore[dateKey].entries = [];
  }

  // In case we loaded old data from localStorage without mealAllowance
  if (!dayStore[dateKey].mealAllowance) {
    dayStore[dateKey].mealAllowance = {
      '1': false,
      '2': false,
      '3': false,
    };
  }

  return dayStore[dateKey];
}

function createEmptyEntry() {
  return {
    komNr: '',
    hours: {
      option1: 0,
      option2: 0,
      option3: 0,
      option4: 0,
      option5: 0,
      option6: 0,
    },
  };
}

function getOrCreateEntry(dayData, index) {
  if (!dayData.entries) {
    dayData.entries = [];
  }
  while (dayData.entries.length <= index) {
    dayData.entries.push(createEmptyEntry());
  }
  return dayData.entries[index];
}

function getOrCreateFirstEntry(dayData) {
  return getOrCreateEntry(dayData, 0);
}

// --- Week info (KW label + weekday dates) --- //

function renderWeekInfo() {
  const monday = getMondayForCurrentWeek();
  const { week } = getISOWeekInfo(monday);

  if (weekLabelEl) {
    weekLabelEl.textContent = `KW ${week}`;
  }

  dayDateSpans.forEach((span) => {
    const key = span.dataset.day;
    const offset = DAY_OFFSETS[key] ?? 0;
    const d = new Date(monday);
    d.setDate(monday.getDate() + offset);
    span.textContent = formatShortDate(d);
  });
}

// --- Total hours for currently active day --- //

function updateDayTotalFromInputs() {
  if (!dayTotalEl) return;

  const activeSection = document.querySelector('.day-content.active');
  if (!activeSection) {
    dayTotalEl.textContent = '0,0 h';
    return;
  }

  let total = 0;

  const inputs = activeSection.querySelectorAll('.hours-input');
  inputs.forEach((input) => {
    const raw = input.value.trim();
    if (!raw) return;

    const asNumber = parseFloat(raw.replace(',', '.'));
    if (!Number.isNaN(asNumber)) {
      total += asNumber;
    }
  });

  const formatted = total.toFixed(1).replace('.', ',') + ' h';
  dayTotalEl.textContent = formatted;
}

// --- Flags: apply + save per day --- //

function applyFlagsForCurrentDay() {
  const activeSection = document.querySelector('.day-content.active');
  if (!activeSection) return;

  const dateKey = getCurrentDateKey();
  const dayData = getOrCreateDayData(dateKey);
  const flags = dayData.flags;

  const flagInputs = activeSection.querySelectorAll('.day-flag');
  flagInputs.forEach((input) => {
    const key = input.dataset.flag;
    input.checked = !!flags[key];
  });
}

// --- Helper function for Meal selection --- //
function applyMealAllowanceForCurrentDay() {
  const activeSection = document.querySelector('.day-content.active');
  if (!activeSection) return;

  const dateKey = getCurrentDateKey();
  const dayData = getOrCreateDayData(dateKey);
  const mealAllowance = dayData.mealAllowance || {
    '1': false,
    '2': false,
    '3': false,
  };

  const pills = activeSection.querySelectorAll('.meal-pill');
  pills.forEach((pill) => {
    const key = pill.dataset.meal; // "1", "2", "3"
    if (!key) return;
    const isOn = !!mealAllowance[key];
    pill.classList.toggle('active', isOn);
  });
}


// --- Kom.Nummer + Stunden: apply per day --- //

function applyKomForCurrentDay() {
  const activeSection = document.querySelector('.day-content.active');
  if (!activeSection) return;

  const dateKey = getCurrentDateKey();
  const dayData = getOrCreateDayData(dateKey);

  if (!dayData.entries || dayData.entries.length === 0) {
    dayData.entries = [createEmptyEntry()];
  }

  const komSection = activeSection.querySelector('.kom-section');
  if (!komSection) return;

  let addWrapper = komSection.querySelector('.kom-add-wrapper');
  if (!addWrapper) {
    addWrapper = document.createElement('div');
    addWrapper.className = 'kom-add-wrapper';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kom-add-btn';
    btn.textContent = '+ Kom.Nummer hinzufügen';
    addWrapper.appendChild(btn);
    komSection.appendChild(addWrapper);
  } else if (addWrapper.parentElement !== komSection) {
    addWrapper.parentElement.removeChild(addWrapper);
    komSection.appendChild(addWrapper);
  }

  const oldCards = komSection.querySelectorAll('.kom-card');
  oldCards.forEach((card) => card.remove());

  const optionKeys = ['option1', 'option2', 'option3', 'option4', 'option5', 'option6'];

  dayData.entries.forEach((entry, index) => {
    const card = document.createElement('div');
    card.className = 'kom-card';
    card.dataset.entryIndex = String(index);

    const header = document.createElement('div');
    header.className = 'kom-card-header';

    const label = document.createElement('label');
    label.className = 'kom-label';

    const labelSpan = document.createElement('span');
    labelSpan.textContent = 'Kom.Nummer';

    const komInput = document.createElement('input');
    komInput.type = 'text';
    komInput.className = 'kom-input';
    komInput.placeholder = 'z.B. 123456';
    komInput.value = entry.komNr || '';

    label.appendChild(labelSpan);
    label.appendChild(komInput);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'kom-remove-btn';
    removeBtn.textContent = '✕';

    header.appendChild(label);
    header.appendChild(removeBtn);

    const grid = document.createElement('div');
    grid.className = 'kom-grid';

    optionKeys.forEach((key, idx) => {
      const optDiv = document.createElement('div');
      optDiv.className = 'kom-option';

      const optLabel = document.createElement('span');
      optLabel.className = 'kom-option-label';
      optLabel.textContent = `Option ${idx + 1}`;

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '0.25';
      input.className = 'hours-input';
      input.dataset.option = key;
      input.placeholder = '0,0';

      const val = entry.hours && entry.hours[key];
      if (typeof val === 'number' && !Number.isNaN(val) && val !== 0) {
        input.value = val.toString().replace('.', ',');
      }

      optDiv.appendChild(optLabel);
      optDiv.appendChild(input);
      grid.appendChild(optDiv);
    });

    card.appendChild(header);
    card.appendChild(grid);

    komSection.insertBefore(card, addWrapper);
  });
}

// --- Global input listener: Stunden + Kom.Nummer im Wochenplan --- //

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!target || !target.classList) return;

  // Stunden-Felder: Gesamt aktualisieren + in Store schreiben
  if (target.classList.contains('hours-input')) {
    // ignore if it's a Pikett hours field (we handle those in the other listener)
    if (target.classList.contains('pikett-hours')) return;

    updateDayTotalFromInputs();

    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);

    const card = target.closest('.kom-card');
    if (!card) return;
    const entryIndex = Number(card.dataset.entryIndex || '0');
    const entry = getOrCreateEntry(dayData, entryIndex);

    const optionKey = target.dataset.option;
    if (optionKey) {
      const raw = target.value.trim();
      const num = raw ? parseFloat(raw.replace(',', '.')) : 0;
      entry.hours[optionKey] = Number.isNaN(num) ? 0 : num;
    }

    saveToStorage();
  }

  // Kom.Nummer-Eingabe im Wochenplan: in Store schreiben
  if (target.classList.contains('kom-input')) {
    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);

    const card = target.closest('.kom-card');
    if (!card) return;
    const entryIndex = Number(card.dataset.entryIndex || '0');
    const entry = getOrCreateEntry(dayData, entryIndex);

    const normalized = normalizeKomNr(target.value);
    target.value = normalized;
    entry.komNr = normalized;

    saveToStorage();
  }
});

// Tages-Flags speichern
document.addEventListener('change', (event) => {
  const target = event.target;
  if (
    !target ||
    !target.classList ||
    !target.classList.contains('day-flag')
  ) {
    return;
  }

  const dateKey = getCurrentDateKey();
  const dayData = getOrCreateDayData(dateKey);
  const flagKey = target.dataset.flag;
  dayData.flags[flagKey] = target.checked;

  saveToStorage();
});

// Add / remove Kom cards + Verpflegungspauschale + info
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!target) return;

  // + Kom.Nummer hinzufügen
  if (target.classList.contains('kom-add-btn')) {
    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);

    dayData.entries.push(createEmptyEntry());
    saveToStorage();
    applyKomForCurrentDay();
    updateDayTotalFromInputs();
  }

  // Kom-Karte entfernen (✕) – nur für Wochenplan, nicht Pikett
  if (
    target.classList.contains('kom-remove-btn') &&
    !target.classList.contains('pikett-remove-btn')
  ) {
    const card = target.closest('.kom-card');
    if (!card) return;

    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);
    const index = Number(card.dataset.entryIndex || '0');

    if (dayData.entries && dayData.entries.length > 1) {
      dayData.entries.splice(index, 1);
    } else {
      dayData.entries = [createEmptyEntry()];
    }

    saveToStorage();
    applyKomForCurrentDay();
    updateDayTotalFromInputs();
  }

  // NEW: Verpflegungspauschale-Pills (1, 2, 3)
  if (target.classList.contains('meal-pill')) {
    const activeSection = target.closest('.day-content');
    if (!activeSection || !activeSection.classList.contains('active')) {
      // nur aktuell aktiver Tag reagiert
      return;
    }

    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);

    if (!dayData.mealAllowance) {
      dayData.mealAllowance = { '1': false, '2': false, '3': false };
    }

    const key = target.dataset.meal; // "1", "2", "3"
    if (!key) return;

    // toggle this one
    const current = !!dayData.mealAllowance[key];
    dayData.mealAllowance[key] = !current;

    saveToStorage();
    applyMealAllowanceForCurrentDay();
  }

  // NEW: Info-Button für Verpflegungspauschale
  if (target.classList.contains('meal-info-btn')) {
    const section = target.closest('.meal-section');
    if (!section) return;
    section.classList.toggle('open-info');
  }
});




// --- Week navigation buttons --- //

if (weekPrevBtn) {
  weekPrevBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    weekOffset -= 1;
    renderWeekInfo();
    applyFlagsForCurrentDay();
    applyMealAllowanceForCurrentDay();  // NEW
    applyKomForCurrentDay();
    updateDayTotalFromInputs();
  });
}

if (weekNextBtn) {
  weekNextBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    weekOffset += 1;
    renderWeekInfo();
    applyFlagsForCurrentDay();
    applyMealAllowanceForCurrentDay();  // NEW
    applyKomForCurrentDay();
    updateDayTotalFromInputs();
  });
}

// --- Day switching logic --- //

function showDay(dayId, titleText) {
  daySections.forEach((section) => {
    section.classList.toggle('active', section.id === dayId);
  });

  if (titleEl && titleText) {
    titleEl.textContent = titleText;
  }
}

dayButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const day = btn.dataset.day;
    const title = btn.dataset.title;

    currentDayId = day;

    dayButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    showDay(day, title);

    applyFlagsForCurrentDay();
    applyMealAllowanceForCurrentDay();   // NEW
    applyKomForCurrentDay();
    updateDayTotalFromInputs();
  });
});

// --- Initial render --- //

loadFromStorage();
renderWeekInfo();
applyFlagsForCurrentDay();
applyMealAllowanceForCurrentDay();   // NEW
applyKomForCurrentDay();
updateDayTotalFromInputs();
renderPikettList();
updatePikettMonthTotal();
