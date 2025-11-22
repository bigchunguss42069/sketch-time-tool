import './style.css';

const dayButtons = document.querySelectorAll('.day-button');
const daySections = document.querySelectorAll('.day-content');
const titleEl = document.getElementById('dayTitle');
const weekLabelEl = document.getElementById('weekLabel');
const dayDateSpans = document.querySelectorAll('.day-date');
const weekPrevBtn = document.getElementById('weekPrev');
const weekNextBtn = document.getElementById('weekNext');
const dayTotalEl = document.getElementById('dayTotal');

let weekOffset = 0; // 0 = current week, -1 = previous, +1 = next, etc.
let currentDayId = 'montag'; // active weekday ("montag", "dienstag", ...)

// shared mapping for offsets and later date calculations
const DAY_OFFSETS = {
  montag: 0,
  dienstag: 1,
  mittwoch: 2,
  donnerstag: 3,
  freitag: 4,
};

// In-memory store: dateKey -> { flags: {...}, entries: [...] }
const dayStore = {}; // e.g. { "2025-11-25": { flags: { sick: true, ... }, entries: [...] } }

// --- Date helpers --- //

// Get Monday of the current week (ISO: Monday = first day)
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // if Sunday, go back 6, else go back (day-1)
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Get ISO week number + year (for KW)
function getISOWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Sunday=0 → 7

  // Set to Thursday of this week (ISO trick)
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  const year = d.getUTCFullYear();

  return { week: weekNo, year };
}

// Format date as "dd.mm.yy"
function formatShortDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

// Monday of the currently selected week
function getMondayForCurrentWeek() {
  const today = new Date();
  const baseMonday = getMonday(today);
  const monday = new Date(baseMonday);
  monday.setDate(baseMonday.getDate() + weekOffset * 7);
  return monday;
}

// Get "YYYY-MM-DD" for the currently selected week + weekday
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

// Ensure we have a dayData object for a given dateKey
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
    };
  }

  if (!dayStore[dateKey].entries) {
    dayStore[dateKey].entries = [];
  }

  return dayStore[dateKey];
}

// For now: exactly one Kom.-Eintrag pro Tag
function getOrCreateFirstEntry(dayData) {
  if (!dayData.entries || dayData.entries.length === 0) {
    dayData.entries = [
      {
        komNr: '',
        hours: {
          option1: 0,
          option2: 0,
          option3: 0,
          option4: 0,
          option5: 0,
          option6: 0,
        },
      },
    ];
  }
  return dayData.entries[0];
}

// --- Week info (KW label + weekday dates) --- //

function renderWeekInfo() {
  const monday = getMondayForCurrentWeek();
  const { week } = getISOWeekInfo(monday);

  if (weekLabelEl) {
    weekLabelEl.textContent = `KW ${week}`;
  }

  dayDateSpans.forEach((span) => {
    const key = span.dataset.day; // "montag" etc.
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
    const key = input.dataset.flag; // "sick", "vacation", ...
    input.checked = !!flags[key];
  });
}

// --- Kom.Nummer + Stunden: apply per day --- //

function applyKomForCurrentDay() {
  const activeSection = document.querySelector('.day-content.active');
  if (!activeSection) return;

  const dateKey = getCurrentDateKey();
  const dayData = getOrCreateDayData(dateKey);
  const entry = getOrCreateFirstEntry(dayData);

  // Kom.Nummer input
  const komInput = activeSection.querySelector('.kom-input');
  if (komInput) {
    komInput.value = entry.komNr || '';
  }

  // Stunden-Optionen
  const hourInputs = activeSection.querySelectorAll('.hours-input');
  hourInputs.forEach((input) => {
    const optionKey = input.dataset.option; // e.g. "option3"
    if (!optionKey || !entry.hours) return;

    const val = entry.hours[optionKey];
    if (typeof val === 'number' && !Number.isNaN(val) && val !== 0) {
      input.value = val.toString().replace('.', ',');
    } else {
      input.value = '';
    }
  });
}

// --- Global input listener: hours + Kom.Nummer --- //

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!target || !target.classList) return;

  // Stunden-Felder: Gesamt aktualisieren + in Store schreiben
  if (target.classList.contains('hours-input')) {
    updateDayTotalFromInputs();

    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);
    const entry = getOrCreateFirstEntry(dayData);

    const optionKey = target.dataset.option; // "option1"..."option6"
    if (optionKey) {
      const raw = target.value.trim();
      const num = raw ? parseFloat(raw.replace(',', '.')) : 0;
      entry.hours[optionKey] = Number.isNaN(num) ? 0 : num;
    }
  }

  // Kom.Nummer-Eingabe: in Store schreiben
  if (target.classList.contains('kom-input')) {
    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);
    const entry = getOrCreateFirstEntry(dayData);
    entry.komNr = target.value.trim();
  }
});

// When a flag checkbox changes, update the store
document.addEventListener('change', (event) => {
  const target = event.target;
  if (!target || !target.classList || !target.classList.contains('day-flag')) {
    return;
  }

  const dateKey = getCurrentDateKey();
  const dayData = getOrCreateDayData(dateKey);
  const flagKey = target.dataset.flag;
  dayData.flags[flagKey] = target.checked;
});

// --- Week navigation buttons --- //

if (weekPrevBtn) {
  weekPrevBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    weekOffset -= 1;
    renderWeekInfo();
    applyFlagsForCurrentDay();
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

    currentDayId = day; // track active weekday

    // Switch active button
    dayButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    // Switch visible day section
    showDay(day, title);

    // Apply per-day data
    applyFlagsForCurrentDay();
    applyKomForCurrentDay();
    updateDayTotalFromInputs();
  });
});

// --- Initial render --- //

renderWeekInfo();
applyFlagsForCurrentDay();
applyKomForCurrentDay();
updateDayTotalFromInputs();
