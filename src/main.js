import './style.css';

const dayButtons = document.querySelectorAll('.day-button');
const daySections = document.querySelectorAll('.day-content');
const titleEl = document.getElementById('dayTitle');
const weekLabelEl = document.getElementById('weekLabel');
const dayDateSpans = document.querySelectorAll('.day-date');
const weekPrevBtn = document.getElementById('weekPrev');
const weekNextBtn = document.getElementById('weekNext');
const dayTotalEl = document.getElementById('dayTotal');

const STORAGE_KEY = 'wochenplan-v1'; // NEW: key for localStorage

const topNavTabs = document.querySelectorAll('.top-nav-tab'); // NEW
const appViews = document.querySelectorAll('.app-view');      // NEW




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



function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      // copy into our existing dayStore object
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

  // Ensure at least one entry exists
  if (!dayData.entries || dayData.entries.length === 0) {
    dayData.entries = [createEmptyEntry()];
  }

  const komSection = activeSection.querySelector('.kom-section');
  if (!komSection) return;

  // Make sure there is an add-wrapper inside THIS komSection
  let addWrapper = komSection.querySelector('.kom-add-wrapper');
  if (!addWrapper) {
    // create one if it doesn't exist
    addWrapper = document.createElement('div');
    addWrapper.className = 'kom-add-wrapper';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kom-add-btn';
    btn.textContent = '+ Kom.Nummer hinzufügen';
    addWrapper.appendChild(btn);
    komSection.appendChild(addWrapper);
  } else if (addWrapper.parentElement !== komSection) {
    // if it's in the wrong place, move it into this komSection
    addWrapper.parentElement.removeChild(addWrapper);
    komSection.appendChild(addWrapper);
  }

  // Remove all existing Kom-Karten
  const oldCards = komSection.querySelectorAll('.kom-card');
  oldCards.forEach((card) => card.remove());

  const optionKeys = ['option1', 'option2', 'option3', 'option4', 'option5', 'option6'];

  dayData.entries.forEach((entry, index) => {
    const card = document.createElement('div');
    card.className = 'kom-card';
    card.dataset.entryIndex = String(index);

    // Header: Kom.Nummer + X
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

    // Stunden-Grid
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

    // SAFE insert: addWrapper is guaranteed to be in this komSection now
    komSection.insertBefore(card, addWrapper);
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

    const card = target.closest('.kom-card');
    if (!card) return;
    const entryIndex = Number(card.dataset.entryIndex || '0');
    const entry = getOrCreateEntry(dayData, entryIndex);

    const optionKey = target.dataset.option; // "option1"..."option6"
    if (optionKey) {
      const raw = target.value.trim();
      const num = raw ? parseFloat(raw.replace(',', '.')) : 0;
      entry.hours[optionKey] = Number.isNaN(num) ? 0 : num;
    }

    if (typeof saveToStorage === 'function') {
      saveToStorage();
    }
  }

  // Kom.Nummer-Eingabe: in Store schreiben
  if (target.classList.contains('kom-input')) {
    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);

    const card = target.closest('.kom-card');
    if (!card) return;
    const entryIndex = Number(card.dataset.entryIndex || '0');
    const entry = getOrCreateEntry(dayData, entryIndex);

    entry.komNr = target.value.trim();

    if (typeof saveToStorage === 'function') {
      saveToStorage();
    }
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

     saveToStorage(); // NEW

});



document.addEventListener('click', (event) => {
  const target = event.target;
  if (!target) return;

  // + Kom.Nummer hinzufügen
  if (target.classList.contains('kom-add-btn')) {
    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);

    dayData.entries.push(createEmptyEntry());

    if (typeof saveToStorage === 'function') {
      saveToStorage();
    }

    applyKomForCurrentDay();
    updateDayTotalFromInputs();
  }

  // Kom-Karte entfernen (✕)
  if (target.classList.contains('kom-remove-btn')) {
    const card = target.closest('.kom-card');
    if (!card) return;

    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);
    const index = Number(card.dataset.entryIndex || '0');

    if (dayData.entries && dayData.entries.length > 1) {
      // remove this entry completely
      dayData.entries.splice(index, 1);
    } else {
      // keep at least one entry: just reset it
      dayData.entries = [createEmptyEntry()];
    }

    if (typeof saveToStorage === 'function') {
      saveToStorage();
    }

    applyKomForCurrentDay();
    updateDayTotalFromInputs();
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

loadFromStorage();  
renderWeekInfo();
applyFlagsForCurrentDay();
applyKomForCurrentDay();
updateDayTotalFromInputs();
