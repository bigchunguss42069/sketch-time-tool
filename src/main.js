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
const ABSENCE_STORAGE_KEY = 'absenceRequests-v1';
const pikettMonthLabelEl = document.getElementById('pikettMonthLabel');
const pikettMonthPrevBtn = document.getElementById('pikettMonthPrev');
const pikettMonthNextBtn = document.getElementById('pikettMonthNext');
const pikettMonthTotalEl = document.getElementById('pikettMonthTotal');

const dashboardMonthLabelEl = document.getElementById('dashboardMonthLabel');
const dashboardMonthPrevBtn = document.getElementById('dashboardMonthPrev');
const dashboardMonthNextBtn = document.getElementById('dashboardMonthNext');

const dashTotalKomEl = document.getElementById('dashTotalKom');
const dashTotalDayhoursEl = document.getElementById('dashTotalDayhours');
const dashTotalPikettEl = document.getElementById('dashTotalPikett');
const dashTotalOvertime3El = document.getElementById('dashTotalOvertime3');
const dashTotalHoursEl = document.getElementById('dashTotalHours');

// Dashboard: Überzeit & Vorarbeit (Jahr)
const overtimeYearUeZ1El = document.getElementById('overtimeYearUeZ1');
const overtimeYearUeZ2El = document.getElementById('overtimeYearUeZ2');
const overtimeYearUeZ3El = document.getElementById('overtimeYearUeZ3');
const overtimeYearVorarbeitEl = document.getElementById('overtimeYearVorarbeit');

// Ferien-Card (Jahr)
const vacationYearSummaryEl = document.getElementById('vacationYearSummary');
// Abwesenheiten (Ferien-Card & Formular)
const absenceListEl = document.getElementById('absenceList');
const absenceTypeEl = document.getElementById('absenceType');
const absenceFromEl = document.getElementById('absenceFrom');
const absenceToEl = document.getElementById('absenceTo');
const absenceDaysEl = document.getElementById('absenceDays');
const absenceCommentEl = document.getElementById('absenceComment');
const absenceSaveBtn = document.getElementById('absenceSaveBtn');

const dashboardTransmitBtn = document.getElementById('dashboardTransmitBtn');

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

    // Wenn Dashboard aktiv wird: Monatswerte neu berechnen
    if (view === 'dashboard') {
      updateDashboardForCurrentMonth();
      updateOvertimeYearCard();
    }
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
// mapping labels for option inputs
const OPTION_LABELS = {
  option1: 'Montage',
  option2: 'Demontage',
  option3: 'Transport',
  option4: 'Inmebreibnahme',
  option5: 'Abnahme',
  option6: 'Werk',
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
    if (!Array.isArray(parsed)) return [];
    // Ensure old entries also have isOvertime3
    return parsed.map((entry) => ({
      ...entry,
      isOvertime3: !!(entry.isOvertime3 ?? entry.overtime3),
    }));
  } catch {
    return [];
  }
}


function savePikettStore() {
  localStorage.setItem(PIKETT_STORAGE_KEY, JSON.stringify(pikettStore));
}

function loadAbsenceRequests() {
  const raw = localStorage.getItem(ABSENCE_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      id:
        item.id ||
        'abs-' +
          Date.now().toString(36) +
          Math.random().toString(36).slice(2, 8),
      type: (item.type || '').toLowerCase(),
      from: item.from || '',
      to: item.to || '',
      days:
        typeof item.days === 'number' && !Number.isNaN(item.days)
          ? item.days
          : undefined,
      comment: item.comment || '',
      status:
        item.status === 'accepted' ||
        item.status === 'rejected' ||
        item.status === 'pending'
          ? item.status
          : 'pending',
    }));
  } catch {
    return [];
  }
}

function saveAbsenceRequests() {
  localStorage.setItem(ABSENCE_STORAGE_KEY, JSON.stringify(absenceRequests));
}

function createAbsenceId() {
  return (
    'abs-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 8)
  );
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
    isOvertime3: false,
  };
}

// Global store for Pikett entries
let pikettStore = loadPikettStore();

// Global store for Abwesenheits-Anträge
let absenceRequests = loadAbsenceRequests();

// 0 = aktueller Monat, -1 = Vormonat, +1 = nächster Monat
let pikettMonthOffset = 0;

// 0 = aktueller Monat, -1 = Vormonat, +1 = nächster Monat (Dashboard)
let dashboardMonthOffset = 0;

// --- Jahres-Konfiguration für Vorarbeit & (später) Startsaldi --- //

// Hier kannst du später pro Jahr einstellen, wie viel Vorarbeit nötig ist,
// und optional Startsaldi aus dem Vorjahr eintragen.
const OVERTIME_YEAR_CONFIG = {
  // Beispiel: für 2026 brauchen wir 39h Vorarbeit
  2026: {
    vorarbeitRequired: 39,
    ueZ1CarryIn: 0, // später: Überzeit 1-Startsaldo aus Vorjahr
    ueZ2CarryIn: 0,
    ueZ3CarryIn: 0,
    vacationDaysPerYear: 21,
    vacationCarryInDays: 0,
  },

  2025: {
    vorarbeitRequired: 39,
    ueZ1CarryIn: 0, 
    ueZ2CarryIn: 0,
    ueZ3CarryIn: 0,
    vacationDaysPerYear: 21,
    vacationCarryInDays: 0,
  },
  // weitere Jahre kannst du einfach ergänzen:
  // 2027: { vorarbeitRequired: 42, ueZ1CarryIn: 0, ueZ2CarryIn: 0, ueZ3CarryIn: 0 },
};

function getYearConfig(year) {
  const cfg = OVERTIME_YEAR_CONFIG[year];
  if (cfg) return cfg;
  // Default: keine Vorarbeit, keine Startsaldi
  return {
    vorarbeitRequired: 0,
    ueZ1CarryIn: 0,
    ueZ2CarryIn: 0,
    ueZ3CarryIn: 0,
    vacationDaysPerYear: 21,
    vacationCarryInDays: 0,
  };
}


// --- Feiertage Kanton Bern (für Ferien-Berechnung) --- //

const BERN_HOLIDAYS = {
  2025: new Set([
    '2025-01-01', // Neujahr
    '2025-01-02', // Berchtoldstag
    '2025-04-18', // Karfreitag
    '2025-04-20', // Ostersonntag
    '2025-04-21', // Ostermontag
    '2025-05-29', // Auffahrt
    '2025-06-09', // Pfingstmontag
    '2025-08-01', // Bundesfeier
    '2025-09-21', // Bettag
    '2025-12-25', // Weihnachten
    '2025-12-26', // Stephanstag
  ]),

  2026: new Set([
    '2026-01-01', // Neujahr
    '2026-01-02', // Berchtoldstag
    '2026-04-03', // Karfreitag
    '2026-04-05', // Ostersonntag
    '2026-04-06', // Ostermontag
    '2026-05-14', // Auffahrt
    '2026-05-25', // Pfingstmontag
    '2026-08-01', // Bundesfeier
    '2026-09-20', // Bettag
    '2026-12-25', // Weihnachten
    '2026-12-26', // Stephanstag
  ]),

  2027: new Set([
    '2027-01-01', // Neujahr
    '2027-01-02', // Berchtoldstag
    '2027-03-26', // Karfreitag
    '2027-03-28', // Ostersonntag
    '2027-03-29', // Ostermontag
    '2027-05-06', // Auffahrt
    '2027-05-17', // Pfingstmontag
    '2027-08-01', // Bundesfeier
    '2027-09-19', // Bettag
    '2027-12-25', // Weihnachten
    '2027-12-26', // Stephanstag
  ]),
};

// Prüft, ob ein Datum im Kanton Bern ein Feiertag ist
function isBernHoliday(date) {
  const year = date.getFullYear();
  const set = BERN_HOLIDAYS[year];
  if (!set) return false;

  const key = formatDateKey(date); // z.B. "2025-08-01"
  return set.has(key);
}

// Zählt Ferientage in einem Bereich anhand der Ferien-Flags im Wochenplan,
// berücksichtigt nur Mo–Fr und zieht Feiertage ab.
function computeVacationDaysFromFlagsInRange(rangeStart, rangeEnd, year) {
  let days = 0;
  const cursor = new Date(rangeStart);

  while (cursor <= rangeEnd) {
    if (cursor.getFullYear() === year) {
      const weekday = cursor.getDay(); // 0=So, 6=Sa

      // nur Arbeitstage
      if (weekday >= 1 && weekday <= 5) {
        // Feiertage nicht als Ferien zählen
        if (!isBernHoliday(cursor)) {
          const key = formatDateKey(cursor);
          const data = dayStore[key];

          if (data && data.flags && data.flags.ferien) {
            days += 1;
          }
        }
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

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

        // --- NEW: Überzeit 3 (150%) toggle section ---
    const overtimeSection = document.createElement('div');
    overtimeSection.className = 'pikett-overtime3-section';

    // Header with title + info button
    const overtimeHeader = document.createElement('div');
    overtimeHeader.className = 'pikett-overtime3-header';

    const overtimeTitle = document.createElement('span');
    overtimeTitle.className = 'pikett-overtime3-title';
    overtimeTitle.textContent = 'Überzeit 3 (150%)';

    const overtimeInfoBtn = document.createElement('button');
    overtimeInfoBtn.type = 'button';
    overtimeInfoBtn.className = 'pikett-overtime3-info-btn';
    overtimeInfoBtn.setAttribute('aria-label', 'Info Überzeit 3');
    overtimeInfoBtn.textContent = 'i';

    overtimeHeader.appendChild(overtimeTitle);
    overtimeHeader.appendChild(overtimeInfoBtn);

    // Info box (collapsed by default, opened via CSS class on the card)
    const overtimeInfoBox = document.createElement('div');
    overtimeInfoBox.className = 'pikett-overtime3-info-box';
    overtimeInfoBox.innerHTML = `
      <p><strong>Wochenendarbeit ohne Pikett-Dienst:</strong></p>
      <p>Aktiviere diese Option nur, wenn du am Wochenende gearbeitet hast, ohne offizielle Pikett-Woche.</p>
    `;

    // Checkbox toggle
    const overtimeToggle = document.createElement('label');
    overtimeToggle.className = 'pikett-overtime3-toggle';

    const overtimeCheckbox = document.createElement('input');
    overtimeCheckbox.type = 'checkbox';
    overtimeCheckbox.className = 'pikett-overtime3-checkbox';
    overtimeCheckbox.checked = !!entry.isOvertime3;

    const overtimeText = document.createElement('span');
    overtimeText.textContent =
      'Dieser Einsatz ist Wochenendarbeit ohne Pikett (Überzeit 3 – 150%)';

    overtimeToggle.appendChild(overtimeCheckbox);
    overtimeToggle.appendChild(overtimeText);

    overtimeSection.appendChild(overtimeHeader);
    overtimeSection.appendChild(overtimeInfoBox);
    overtimeSection.appendChild(overtimeToggle);

    body.appendChild(overtimeSection);


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

// Abwesenheits-Antrag speichern
if (absenceSaveBtn) {
  absenceSaveBtn.addEventListener('click', () => {
    if (!absenceTypeEl || !absenceFromEl || !absenceToEl) return;

    const type = absenceTypeEl.value.trim().toLowerCase();
    const from = absenceFromEl.value;
    const to = absenceToEl.value;
    const daysRaw = absenceDaysEl ? absenceDaysEl.value.trim() : '';
    const comment = absenceCommentEl
      ? absenceCommentEl.value.trim()
      : '';

    // Minimale Validierung: ohne Typ/Von/Bis kein Eintrag
    if (!type || !from || !to) {
      return;
    }

    let fromDate = new Date(from);
    let toDate = new Date(to);
    if (
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(toDate.getTime())
    ) {
      return;
    }

    // Falls "Bis" vor "Von" liegt, still tauschen
    if (toDate < fromDate) {
      const tmp = fromDate;
      fromDate = toDate;
      toDate = tmp;
    }

    let daysValue;
    if (daysRaw) {
      let num = parseFloat(daysRaw.replace(',', '.'));
      if (!Number.isNaN(num) && num > 0) {
        // auf 0.25 runden
        num = Math.round(num * 4) / 4;
        daysValue = num;
      }
    }

    const request = {
      id: createAbsenceId(),
      type,
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      days: daysValue,
      comment,
      status: 'pending',
    };

    absenceRequests.push(request);
    saveAbsenceRequests();

    // Formular leeren
    absenceTypeEl.value = '';
    absenceFromEl.value = '';
    absenceToEl.value = '';
    if (absenceDaysEl) absenceDaysEl.value = '';
    if (absenceCommentEl) absenceCommentEl.value = '';

    // Dashboard-Karten aktualisieren
    updateOvertimeYearCard();
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
  let num = raw ? parseFloat(raw.replace(',', '.')) : 0;
  if (!Number.isNaN(num)) {
    num = roundToQuarter(num);
  }
  entry.hours = Number.isNaN(num) ? 0 : num;

  
  }

   else if (target.classList.contains('pikett-note')) {
    entry.note = target.value;
  } else {
    return;
  }

  savePikettStore();
  updatePikettMonthTotal(); // nur Summe aktualisieren
});

// --- NEW: handle Überzeit 3 checkbox on Pikett cards --- //
document.addEventListener('change', (event) => {
  const target = event.target;
  if (!target) return;

  if (!target.classList || !target.classList.contains('pikett-overtime3-checkbox')) {
    return;
  }

  const card = target.closest('.pikett-card');
  if (!card) return;

  const index = Number(card.dataset.index);
  if (Number.isNaN(index) || !pikettStore[index]) return;

  pikettStore[index].isOvertime3 = target.checked;
  savePikettStore();
  // no need to re-render; checkbox already shows current state
});


// Remove a Pikett-Einsatz card (mit Bestätigung)
// + Info-Toggle für Überzeit 3
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!target) return;

  // 1) Info-Button "i" für Überzeit 3 toggeln
  if (target.classList.contains('pikett-overtime3-info-btn')) {
    const card = target.closest('.pikett-card');
    if (!card) return;
    card.classList.toggle('open-overtime3-info');
    return; // fertig, nicht weiter runterlaufen
  }

  // 2) Klick auf ✕ → Bestätigungszeile anzeigen
  if (target.classList.contains('pikett-remove-btn')) {
    const card = target.closest('.pikett-card');
    if (!card) return;

    // Wenn Karte schon im Bestätigungsmodus ist, nichts tun
    if (card.classList.contains('pikett-confirm-mode')) {
      return;
    }

    card.classList.add('pikett-confirm-mode');

    const row = document.createElement('div');
    row.className = 'pikett-confirm-row';

    const text = document.createElement('span');
    text.className = 'pikett-confirm-text';
    text.textContent = 'Pikett-Einsatz wirklich löschen?';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'pikett-confirm-cancel';
    cancelBtn.textContent = 'Abbrechen';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'pikett-confirm-delete';
    deleteBtn.textContent = 'Löschen';

    row.appendChild(text);
    row.appendChild(cancelBtn);
    row.appendChild(deleteBtn);

    card.appendChild(row);
    return;
  }

  // 3) Abbrechen in der Bestätigungszeile
  if (target.classList.contains('pikett-confirm-cancel')) {
    const card = target.closest('.pikett-card');
    if (!card) return;

    const row = card.querySelector('.pikett-confirm-row');
    if (row) row.remove();

    card.classList.remove('pikett-confirm-mode');
    return;
  }

  // 4) Löschen in der Bestätigungszeile
  if (target.classList.contains('pikett-confirm-delete')) {
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

// Abwesenheits-Antrag löschen – mit Bestätigungszeile
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!target || !target.classList) return;

  // 1) Klick auf "Löschen" → Bestätigungszeile einblenden
  if (target.classList.contains('absence-delete-btn')) {
    const item = target.closest('.absence-item');
    if (!item) return;

    // Wenn schon im Bestätigungsmodus, nichts tun
    if (item.classList.contains('absence-confirm-mode')) {
      return;
    }

    item.classList.add('absence-confirm-mode');

    const row = document.createElement('div');
    row.className = 'absence-confirm-row';

    const text = document.createElement('span');
    text.className = 'absence-confirm-text';
    text.textContent = 'Abwesenheit wirklich löschen?';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'absence-confirm-cancel';
    cancelBtn.textContent = 'Abbrechen';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'absence-confirm-delete';
    deleteBtn.textContent = 'Löschen';

    row.appendChild(text);
    row.appendChild(cancelBtn);
    row.appendChild(deleteBtn);

    item.appendChild(row);
    return;
  }

  // 2) "Abbrechen" in der Bestätigungszeile
  if (target.classList.contains('absence-confirm-cancel')) {
    const item = target.closest('.absence-item');
    if (!item) return;

    const row = item.querySelector('.absence-confirm-row');
    if (row) row.remove();

    item.classList.remove('absence-confirm-mode');
    return;
  }

  // 3) Endgültig löschen
  if (target.classList.contains('absence-confirm-delete')) {
    const item = target.closest('.absence-item');
    if (!item) return;

    const id = item.dataset.absenceId;
    if (!id) return;

    const index = absenceRequests.findIndex((r) => r.id === id);
    if (index === -1) return;

    absenceRequests.splice(index, 1);
    saveAbsenceRequests();
    updateOvertimeYearCard(); // rendert Liste neu + Ferienstand
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

if (dashboardTransmitBtn) {
  dashboardTransmitBtn.addEventListener('click', () => {
    const payload = buildPayloadForCurrentDashboardMonth();

    // Jetzt: nur lokales "Senden" – später durch API-Call ersetzen
    console.log('Transmit payload for current month:', payload);
    alert(`Daten für ${payload.monthLabel} vorbereitet (siehe Konsole).`);

    //  Später mit Backend:
    // fetch('/api/transmit-month', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(payload),
    // })
    //   .then((res) => {
    //     if (!res.ok) throw new Error('Server-Fehler');
    //     return res.json();
    //   })
    //   .then(() => {
    //     alert(`Daten für ${payload.monthLabel} erfolgreich übertragen.`);
    //   })
    //   .catch((err) => {
    //     console.error(err);
    //     alert('Übertragung fehlgeschlagen. Bitte später erneut versuchen.');
    //   });
  });
}




// --- Dashboard month info + aggregation --- //
function getCurrentDashboardMonthInfo() {
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), 1);
  base.setMonth(base.getMonth() + dashboardMonthOffset);

  const year = base.getFullYear();
  const monthIndex = base.getMonth(); // 0–11

  const label = base.toLocaleString('de-DE', {
    month: 'long',
    year: 'numeric',
  });

  return { year, monthIndex, label };
}

function buildPayloadForCurrentDashboardMonth() {
  const info = getCurrentDashboardMonthInfo();
  const { year, monthIndex, label } = info;

  // 1) Alle Tage dieses Monats aus dayStore
  const monthDays = {};
  Object.entries(dayStore).forEach(([dateKey, dayData]) => {
    const d = new Date(dateKey);
    if (Number.isNaN(d.getTime())) return;
    if (d.getFullYear() !== year || d.getMonth() !== monthIndex) return;

    monthDays[dateKey] = dayData;
  });

  // 2) Pikett-Einsätze dieses Monats
  const monthPikett = pikettStore.filter((entry) => {
    if (!entry.date) return false;
    const d = new Date(entry.date);
    if (Number.isNaN(d.getTime())) return false;
    return d.getFullYear() === year && d.getMonth() === monthIndex;
  });

  // 3) Abwesenheiten, die diesen Monat berühren (optional)
  const monthAbsences = absenceRequests.filter((req) => {
    if (!req.from || !req.to) return false;

    const fromDate = new Date(req.from);
    const toDate = new Date(req.to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return false;
    }

    const monthStart = new Date(year, monthIndex, 1);
    const monthEnd = new Date(year, monthIndex + 1, 0);

    // Überschneidung mit Monat?
    return !(toDate < monthStart || fromDate > monthEnd);
  });

  return {
    year,
    monthIndex,        // 0–11
    monthLabel: label, // z.B. "März 2025"
    days: monthDays,
    pikett: monthPikett,
    absences: monthAbsences,
  };
}


// --- Abwesenheiten-Helper: Tage pro Jahr berechnen & Liste rendern --- //

function datesOverlapYear(fromDate, toDate, year) {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  const start = fromDate > yearStart ? fromDate : yearStart;
  const end = toDate < yearEnd ? toDate : yearEnd;

  return start <= end;
}

// Berechnet, wie viele Tage eines Abwesenheits-Antrags in ein bestimmtes Jahr fallen.
// Speziell für "Ferien":
//   → zählt nur Tage, an denen im Wochenplan das Ferien-Flag gesetzt ist,
//   → nur Mo–Fr,
//   → Feiertage werden NICHT als Ferientag gezählt.
function computeAbsenceDaysForYear(request, year) {
  if (!request.from || !request.to) return 0;

  const fromDate = new Date(request.from);
  const toDate = new Date(request.to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return 0;
  }

  let start = fromDate;
  let end = toDate;
  if (end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  if (!datesOverlapYear(start, end, year)) {
    return 0;
  }

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  const rangeStart = start < yearStart ? yearStart : start;
  const rangeEnd = end > yearEnd ? yearEnd : end;

  // Explizite Tage nur verwenden, wenn der Antrag komplett in diesem Jahr liegt.
  if (
    typeof request.days === 'number' &&
    !Number.isNaN(request.days) &&
    request.days > 0 &&
    start.getFullYear() === end.getFullYear() &&
    start.getFullYear() === year
  ) {
    return request.days;
  }

  let days = 0;
  const cursor = new Date(rangeStart);
  while (cursor <= rangeEnd) {
    const day = cursor.getDay(); // 0=So, 6=Sa
    if (day >= 1 && day <= 5) {
      days += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function calculateUsedVacationDaysFromFlags(year) {
  const DAILY_SOLL = 8.0;
  let totalDays = 0;

  Object.entries(dayStore).forEach(([dateKey, dayData]) => {
    const d = new Date(dateKey);
    if (Number.isNaN(d.getTime())) return;
    if (d.getFullYear() !== year) return;

    const weekday = d.getDay(); // 0=So, 6=Sa
    // Nur Mo–Fr
    if (weekday < 1 || weekday > 5) return;

    // Nur Tage mit Ferien-Flag
    if (!dayData.flags || !dayData.flags.ferien) return;

    // Feiertage zählen nicht als Ferienverbrauch
    if (isBernHoliday(d)) return;

    // --- Gearbeitete Stunden an diesem Tag (alles außer Pikett) --- //
    let hoursWorked = 0;

    // 1) Kommissionsstunden
    if (Array.isArray(dayData.entries)) {
      dayData.entries.forEach((entry) => {
        if (!entry || !entry.hours) return;
        Object.values(entry.hours).forEach((val) => {
          if (typeof val === 'number' && !Number.isNaN(val)) {
            hoursWorked += val;
          }
        });
      });
    }

    // 2) Tagesbezogene Stunden (Schulung / Sitzung/Kurs / Arzt/Krank)
    if (dayData.dayHours) {
      const { schulung, sitzungKurs, arztKrank } = dayData.dayHours;
      [schulung, sitzungKurs, arztKrank].forEach((val) => {
        if (typeof val === 'number' && !Number.isNaN(val)) {
          hoursWorked += val;
        }
      });
    }

    // 3) Spezialbuchungen (Regie / Fehler)
    if (Array.isArray(dayData.specialEntries)) {
      dayData.specialEntries.forEach((special) => {
        if (!special) return;
        const val = special.hours;
        if (typeof val === 'number' && !Number.isNaN(val)) {
          hoursWorked += val;
        }
      });
    }

    // --- Aus Stunden -> Ferien-Tagesanteil --- //
    let dayFraction = 0;

    if (hoursWorked <= 0) {
      // 0 h Arbeit → ganzer Ferientag
      dayFraction = 1;
    } else if (hoursWorked < DAILY_SOLL) {
      // z.B. 4h Arbeit + Rest Ferien → halber Ferientag
      dayFraction = 0.5;
    } else {
      // 8h oder mehr gearbeitet → kein Ferienverbrauch
      dayFraction = 0;
    }

    totalDays += dayFraction;
  });

  return totalDays;
}



// Gibt alle Abwesenheiten zurück, die irgendeinen Anteil im angegebenen Jahr haben
function getAbsencesForYear(year) {
  return absenceRequests.filter((req) => {
    if (!req.from || !req.to) return false;

    const fromDate = new Date(req.from);
    const toDate = new Date(req.to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return false;
    }

    let start = fromDate;
    let end = toDate;
    if (end < start) {
      const tmp = start;
      start = end;
      end = tmp;
    }

    return datesOverlapYear(start, end, year);
  });
}


// Baut die Abwesenheits-Liste im Dashboard für das aktuell ausgewählte Jahr
function renderAbsenceListForCurrentYear() {
  if (!absenceListEl) return;

  const { year } = getCurrentDashboardMonthInfo();

  const items = getAbsencesForYear(year).slice();
  absenceListEl.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'special-empty-text';
    empty.textContent = 'Keine Abwesenheiten für dieses Jahr erfasst.';
    absenceListEl.appendChild(empty);
    return;
  }

  // Nach Startdatum sortieren
  items.sort((a, b) => {
    const da = new Date(a.from);
    const db = new Date(b.from);
    return da - db;
  });

  items.forEach((req) => {
    const container = document.createElement('div');
    container.className = 'absence-item';
    container.dataset.absenceId = req.id;

    const header = document.createElement('div');
    header.className = 'absence-item-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'absence-title';

    const fromDate = new Date(req.from);
    const toDate = new Date(req.to);
    const fromStr = Number.isNaN(fromDate.getTime())
      ? req.from
      : formatShortDate(fromDate);
    const toStr = Number.isNaN(toDate.getTime())
      ? req.to
      : formatShortDate(toDate);

    const daysForYear = computeAbsenceDaysForYear(req, year);
    const daysText = formatDays(daysForYear);

    titleSpan.textContent = `${
      req.type || 'Abwesenheit'
    } · ${fromStr} – ${toStr} (${daysText} Tage)`;

    const meta = document.createElement('div');
    meta.className = 'absence-meta';
    meta.textContent = req.comment
      ? `Kommentar: ${req.comment}`
      : 'Kein Kommentar';

    header.appendChild(titleSpan);

    const statusRow = document.createElement('div');
    statusRow.className = 'absence-status-row';

    const statusSelect = document.createElement('select');
    statusSelect.className = 'absence-status-select';
    statusSelect.dataset.absenceId = req.id;

    const optPending = document.createElement('option');
    optPending.value = 'pending';
    optPending.textContent = 'Offen';

    const optAccepted = document.createElement('option');
    optAccepted.value = 'accepted';
    optAccepted.textContent = 'Akzeptiert';

    const optRejected = document.createElement('option');
    optRejected.value = 'rejected';
    optRejected.textContent = 'Abgelehnt';

    statusSelect.appendChild(optPending);
    statusSelect.appendChild(optAccepted);
    statusSelect.appendChild(optRejected);
    statusSelect.value =
      req.status === 'accepted' || req.status === 'rejected'
        ? req.status
        : 'pending';

    const badge = document.createElement('span');
    badge.className = 'absence-status-badge';
    if (statusSelect.value === 'pending') {
      badge.classList.add('pending');
      badge.textContent = 'Offen';
    } else if (statusSelect.value === 'accepted') {
      badge.classList.add('accepted');
      badge.textContent = 'Akzeptiert';
    } else {
      badge.classList.add('rejected');
      badge.textContent = 'Abgelehnt';
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'absence-delete-btn';
    deleteBtn.dataset.absenceId = req.id;
    deleteBtn.textContent = 'Löschen';

    statusRow.appendChild(statusSelect);
    statusRow.appendChild(badge);
    statusRow.appendChild(deleteBtn);

    container.appendChild(header);
    container.appendChild(meta);
    container.appendChild(statusRow);

    absenceListEl.appendChild(container);
  });
}

// Geht alle Absenzen durch und setzt Ferien-Flags aus akzeptierten Ferien-Anträgen.
// Entfernt dabei vorher alle "von Absenzen" gesetzten Ferien-Flags.
function syncVacationFlagsFromAbsences() {
  // 1) Alle "ferienFromAbsences" zurücksetzen
  Object.values(dayStore).forEach((dayData) => {
    if (!dayData.flags) {
      dayData.flags = {};
    }
    if (typeof dayData.flags.ferienManual !== 'boolean') {
      dayData.flags.ferienManual = !!dayData.flags.ferien;
    }
    dayData.flags.ferienFromAbsences = false;
  });

  // 2) Für jede akzeptierte Ferien-Absenz die passenden Tage markieren
  absenceRequests.forEach((request) => {
    const type = (request.type || '').toLowerCase();
    if (type !== 'ferien') return;
    if (request.status !== 'accepted') return;
    if (!request.from || !request.to) return;

    let fromDate = new Date(request.from);
    let toDate = new Date(request.to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return;
    }

    if (toDate < fromDate) {
      const tmp = fromDate;
      fromDate = toDate;
      toDate = tmp;
    }

    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const weekday = cursor.getDay(); // 0=So, 6=Sa

      // Nur Arbeitstage und keine Feiertage
      if (weekday >= 1 && weekday <= 5 && !isBernHoliday(cursor)) {
        const key = formatDateKey(cursor);
        const dayData = getOrCreateDayData(key);
        if (!dayData.flags) {
          dayData.flags = {};
        }
        if (typeof dayData.flags.ferienManual !== 'boolean') {
          dayData.flags.ferienManual = !!dayData.flags.ferien;
        }
        dayData.flags.ferienFromAbsences = true;
      }

      cursor.setDate(cursor.getDate() + 1);
    }
  });

  // 3) Sichtbares Ferien-Flag neu berechnen (Manual OR Absenz)
  Object.values(dayStore).forEach((dayData) => {
    if (!dayData.flags) {
      dayData.flags = {};
    }
    const manual = !!dayData.flags.ferienManual;
    const fromAbs = !!dayData.flags.ferienFromAbsences;
    dayData.flags.ferien = manual || fromAbs;
  });

  saveToStorage();
}




function updateDashboardForCurrentMonth() {
  const info = getCurrentDashboardMonthInfo();

  // Monatstitel aktualisieren
  if (dashboardMonthLabelEl) {
    const text =
      info.label.charAt(0).toUpperCase() + info.label.slice(1);
    dashboardMonthLabelEl.textContent = text;
  }

  let totalKom = 0;
  let totalDayHours = 0;
  let totalPikett = 0;
  let totalOvertime3 = 0;

  // 1) Wochenplan-Daten (dayStore) aggregieren
  Object.entries(dayStore).forEach(([dateKey, dayData]) => {
    const d = new Date(dateKey);
    if (Number.isNaN(d.getTime())) return;

    const y = d.getFullYear();
    const m = d.getMonth();
    if (y !== info.year || m !== info.monthIndex) return;

    // Kommissionsstunden: Summe aller option1..6
    if (Array.isArray(dayData.entries)) {
      dayData.entries.forEach((entry) => {
        if (!entry || !entry.hours) return;
        Object.values(entry.hours).forEach((val) => {
          if (typeof val === 'number' && !Number.isNaN(val)) {
            totalKom += val;
          }
        });
      });
    }

    // Tagesbezogene Stunden (Schulung / Sitzung / Arzt)
    if (dayData.dayHours) {
      const { schulung, sitzungKurs, arztKrank } = dayData.dayHours;
      [schulung, sitzungKurs, arztKrank].forEach((val) => {
        if (typeof val === 'number' && !Number.isNaN(val)) {
          totalDayHours += val;
        }
      });
    }

        // Spezialbuchungen (Regie / Fehler) zählen als ÜZ1 / Kommissionsstunden
    if (Array.isArray(dayData.specialEntries)) {
      dayData.specialEntries.forEach((special) => {
        if (!special) return;
        const val = special.hours;
        if (typeof val === 'number' && !Number.isNaN(val)) {
          totalKom += val;
        }
      });
    }

  });



  // 2) Pikett-Daten (pikettStore) aggregieren
  pikettStore.forEach((entry) => {
    if (!entry.date) return;
    const d = new Date(entry.date);
    if (Number.isNaN(d.getTime())) return;

    const y = d.getFullYear();
    const m = d.getMonth();
    if (y !== info.year || m !== info.monthIndex) return;

    const hours =
      typeof entry.hours === 'number' && !Number.isNaN(entry.hours)
        ? entry.hours
        : 0;

    if (entry.isOvertime3) {
      totalOvertime3 += hours;
    } else {
      totalPikett += hours;
    }
  });



  const totalAll = totalKom + totalDayHours + totalPikett + totalOvertime3;

  // 3) Werte in das Dashboard schreiben
  if (dashTotalKomEl) {
    dashTotalKomEl.textContent =
      totalKom.toFixed(1).replace('.', ',') + ' h';
  }
  if (dashTotalDayhoursEl) {
    dashTotalDayhoursEl.textContent =
      totalDayHours.toFixed(1).replace('.', ',') + ' h';
  }
  if (dashTotalPikettEl) {
    dashTotalPikettEl.textContent =
      totalPikett.toFixed(1).replace('.', ',') + ' h';
  }
  if (dashTotalOvertime3El) {
    dashTotalOvertime3El.textContent =
      totalOvertime3.toFixed(1).replace('.', ',') + ' h';
  }
  if (dashTotalHoursEl) {
    dashTotalHoursEl.textContent =
      totalAll.toFixed(1).replace('.', ',') + ' h';
  }

  // 4) Wochenstatus für diesen Monat aktualisieren
  updateDashboardWeekListForCurrentMonth();
}

function updateOvertimeYearCard() {
  if (
    !overtimeYearUeZ1El ||
    !overtimeYearUeZ2El ||
    !overtimeYearUeZ3El ||
    !overtimeYearVorarbeitEl
  ) {
    return;
  }
  // Ferien-Flags mit akzeptierten Ferien-Anträgen synchronisieren
  syncVacationFlagsFromAbsences();

  const { year: selectedYear } = getCurrentDashboardMonthInfo();

  // Soll-Arbeitszeit pro Tag
  const DAILY_SOLL = 8.0;

  // pro Jahr:
  // - net       = Summe aller (Über-/Unterstunden nach Ferienregel)
  // - positive  = nur positive Anteile (für Vorarbeit)
  const perYear = {}; // year -> { net, positive }

  // --- 1) ÜZ1 + Ferien-Effekt aus dayStore berechnen (für Vorarbeit & Saldo ÜZ1) --- //
  Object.entries(dayStore).forEach(([dateKey, dayData]) => {
    const d = new Date(dateKey);
    if (Number.isNaN(d.getTime())) return;

    const y = d.getFullYear();
    if (!perYear[y]) {
      perYear[y] = { net: 0, positive: 0 };
    }

    let dayTotalUeZ1 = 0;

    // Spezialbuchungen (Regie/Fehler)
    if (Array.isArray(dayData.specialEntries)) {
      dayData.specialEntries.forEach((special) => {
        if (!special) return;
        const val = special.hours;
        if (typeof val === 'number' && !Number.isNaN(val)) {
          dayTotalUeZ1 += val;
        }
      });
    }

    // Kommissionsstunden
    if (Array.isArray(dayData.entries)) {
      dayData.entries.forEach((entry) => {
        if (!entry || !entry.hours) return;
        Object.values(entry.hours).forEach((val) => {
          if (typeof val === 'number' && !Number.isNaN(val)) {
            dayTotalUeZ1 += val;
          }
        });
      });
    }

    // Tagesbezogene Stunden (Schulung / Sitzung/Kurs / Arzt/Krank)
    if (dayData.dayHours) {
      const { schulung, sitzungKurs, arztKrank } = dayData.dayHours;
      [schulung, sitzungKurs, arztKrank].forEach((val) => {
        if (typeof val === 'number' && !Number.isNaN(val)) {
          dayTotalUeZ1 += val;
        }
      });
    }

    const flags = dayData.flags || {};
    const isFerien = !!flags.ferien;

    const hasAnyHours = dayTotalUeZ1 > 0;
    const hasAnyFlag = Object.values(flags).some(Boolean);

    // Komplett leerer Tag (keine Stunden, keine Flags) → ignorieren
    if (!hasAnyHours && !hasAnyFlag) {
      return;
    }

    let diff = 0;

    if (isFerien) {
      if (!hasAnyHours) {
        // Reiner Ferientag → 8h Ferien, keine Über-/Unterzeit (nur für Vorarbeit/Saldo relevant)
        diff = 0;
      } else if (dayTotalUeZ1 < DAILY_SOLL) {
        // Teil gearbeitet, Rest Ferien → keine Minusstunden
        diff = 0;
      } else {
        // Mehr als 8h gearbeitet trotz Ferien → Überzeit 1
        diff = dayTotalUeZ1 - DAILY_SOLL;
      }
    } else {
      if (hasAnyHours) {
        // normale Tage ohne Ferien: echte Über-/Unterzeit
        diff = dayTotalUeZ1 - DAILY_SOLL;
      } else {
        diff = 0;
      }
    }

    perYear[y].net += diff;
    if (diff > 0) {
      perYear[y].positive += diff;
    }
  });

  // --- 2) Gesamt-ÜZ1 über alle Jahre + gefüllte Vorarbeit --- //
  let ueZ1NetAllYears = 0;
  let vorarbeitFilledAllYears = 0;

  Object.keys(perYear).forEach((yearStr) => {
    const y = Number(yearStr);
    if (Number.isNaN(y)) return;

    const data = perYear[y];
    if (!data) return;

    ueZ1NetAllYears += data.net;

    const cfg = getYearConfig(y) || {};
    const req = cfg.vorarbeitRequired || 0;
    const filledYear = Math.min(Math.max(data.positive, 0), req);
    vorarbeitFilledAllYears += filledYear;
  });

  const cfgSelected = getYearConfig(selectedYear) || {};
  const vorarbeitRequiredSelected = cfgSelected.vorarbeitRequired || 0;
  const ueZ1CarryIn = cfgSelected.ueZ1CarryIn || 0;
  const ueZ2CarryIn = cfgSelected.ueZ2CarryIn || 0;
  const ueZ3CarryIn = cfgSelected.ueZ3CarryIn || 0;

  // ÜZ1-Lebenszeit-Saldo
  const ueZ1Saldo =
    ueZ1CarryIn + ueZ1NetAllYears - vorarbeitFilledAllYears;

  // --- 3) ÜZ2 & ÜZ3 (lebenszeit) aus pikettStore --- //
  let ueZ2RawAllYears = 0;
  let ueZ3RawAllYears = 0;

  pikettStore.forEach((entry) => {
    if (!entry.date) return;
    const d = new Date(entry.date);
    if (Number.isNaN(d.getTime())) return;

    const hours =
      typeof entry.hours === 'number' && !Number.isNaN(entry.hours)
        ? entry.hours
        : 0;
    if (hours <= 0) return;

    if (entry.isOvertime3) {
      ueZ3RawAllYears += hours;
    } else {
      ueZ2RawAllYears += hours;
    }
  });

  const ueZ2Saldo = ueZ2CarryIn + ueZ2RawAllYears;
  const ueZ3Saldo = ueZ3CarryIn + ueZ3RawAllYears;

  // --- 4) Vorarbeit-Fortschritt nur für das aktuell ausgewählte Jahr --- //
  const selectedYearData = perYear[selectedYear] || { positive: 0 };
  const posSelected = selectedYearData.positive || 0;
  const vorarbeitFilledSelected = Math.min(
    Math.max(posSelected, 0),
    vorarbeitRequiredSelected
  );

  // --- 5) Anzeige ÜZ-Salden --- //
  overtimeYearUeZ1El.textContent = formatHoursSigned(ueZ1Saldo);
  overtimeYearUeZ2El.textContent = formatHours(ueZ2Saldo);
  overtimeYearUeZ3El.textContent = formatHours(ueZ3Saldo);

  const vorarbeitFilledText = formatHours(vorarbeitFilledSelected);
  const vorarbeitRequiredText = formatHours(vorarbeitRequiredSelected);
  overtimeYearVorarbeitEl.textContent =
    `${vorarbeitFilledText} / ${vorarbeitRequiredText}`;

    // --- 6) Ferien-Card für das aktuell ausgewählte Jahr (Zählung über Ferien-Flags) --- //
  if (vacationYearSummaryEl) {
    // Verbrauch nur anhand der Ferien-Flags im Wochenplan (inkl. Feiertagslogik)
    const usedVacationDaysSelected =
      calculateUsedVacationDaysFromFlags(selectedYear);

    const vacationDaysPerYear =
      cfgSelected.vacationDaysPerYear || 21;
    const vacationCarryInDays =
      cfgSelected.vacationCarryInDays || 0;

    const totalEntitlementDays =
      vacationDaysPerYear + vacationCarryInDays;

    const remainingDays =
      totalEntitlementDays - usedVacationDaysSelected;

    const remainingStr = formatDays(remainingDays);
    const totalStr = formatDays(totalEntitlementDays);

    vacationYearSummaryEl.textContent =
      `${remainingStr} / ${totalStr} Tage`;
  }


  // --- 7) Abwesenheiten-Liste aktualisieren --- //
  renderAbsenceListForCurrentYear();
}

/**
 * Baut die KW-Übersicht für den aktuell gewählten Dashboard-Monat.
 * Zeigt pro KW:
 *  - Datumsbereich, Anzahl Arbeitstage im Monat
 *  - ob alle Mo–Fr im Monat erfasst sind
 *  - Total Stunden (Kom + Tagesstunden + Pikett) in diesem Monat
 */
function updateDashboardWeekListForCurrentMonth() {
  const weekListEl = document.getElementById('dashboardWeekList');
  if (!weekListEl) return;

  const info = getCurrentDashboardMonthInfo();
  const { year, monthIndex } = info;

  // weekKey -> { year, week, minDate, maxDate, totalHours, days: { dateKey -> { weekday, hasData, hours } } }
  const weekMap = {};

  // 1) Skeleton für alle Kalendertage in diesem Monat bauen
  let cursor = new Date(year, monthIndex, 1);
  while (cursor.getMonth() === monthIndex) {
    const d = new Date(cursor);
    const { week, year: weekYear } = getISOWeekInfo(d);
    const weekKey = `${weekYear}-W${week}`;

    if (!weekMap[weekKey]) {
      weekMap[weekKey] = {
        year: weekYear,
        week,
        minDate: null,
        maxDate: null,
        totalHours: 0,
        days: {}, // dateKey -> { weekday, hasData, hours }
      };
    }

    const w = weekMap[weekKey];

    if (!w.minDate || d < w.minDate) w.minDate = new Date(d);
    if (!w.maxDate || d > w.maxDate) w.maxDate = new Date(d);

    const dateKey = formatDateKey(d);
    const weekday = d.getDay(); // 0=So .. 6=Sa

    if (!w.days[dateKey]) {
      w.days[dateKey] = {
        weekday,
        hasData: false,
        hours: 0,
      };
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  // 2) Wochenplan (dayStore) drüberlegen
  Object.entries(dayStore).forEach(([dateKey, dayData]) => {
    const d = new Date(dateKey);
    if (Number.isNaN(d.getTime())) return;
    if (d.getFullYear() !== year || d.getMonth() !== monthIndex) return;

    const { week, year: weekYear } = getISOWeekInfo(d);
    const weekKey = `${weekYear}-W${week}`;
    const w = weekMap[weekKey];
    if (!w) return;

    let nonPikettHours = 0;

    // Kommissionsstunden
    if (Array.isArray(dayData.entries)) {
      dayData.entries.forEach((entry) => {
        if (!entry || !entry.hours) return;
        Object.values(entry.hours).forEach((val) => {
          if (typeof val === 'number' && !Number.isNaN(val)) {
            nonPikettHours += val;
          }
        });
      });
    }

    // Tagesbezogene Stunden
    if (dayData.dayHours) {
      const { schulung, sitzungKurs, arztKrank } = dayData.dayHours;
      [schulung, sitzungKurs, arztKrank].forEach((val) => {
        if (typeof val === 'number' && !Number.isNaN(val)) {
          nonPikettHours += val;
        }
      });
    }

    // Spezialbuchungen ebenfalls im Tages-Total berücksichtigen
    if (Array.isArray(dayData.specialEntries)) {
      dayData.specialEntries.forEach((special) => {
        if (!special) return;
        const val = special.hours;
        if (typeof val === 'number' && !Number.isNaN(val)) {
          nonPikettHours += val;
        }
      });
    }

    const flags = dayData.flags || {};
    const isFerien = !!flags.ferien;

    // "Erfasst" = Stunden (inkl. Spezial) oder Ferien
    const hasDayData = nonPikettHours > 0 || isFerien;

    const dayInfo = w.days[dateKey];
    if (!dayInfo) return;

    dayInfo.hours += nonPikettHours;
    if (hasDayData) {
      dayInfo.hasData = true;
    }

    w.totalHours += nonPikettHours;
  });

  // 3) Pikett (pikettStore) drüberlegen
  pikettStore.forEach((entry) => {
    if (!entry.date) return;
    const d = new Date(entry.date);
    if (Number.isNaN(d.getTime())) return;
    if (d.getFullYear() !== year || d.getMonth() !== monthIndex) return;

    const { week, year: weekYear } = getISOWeekInfo(d);
    const weekKey = `${weekYear}-W${week}`;
    const w = weekMap[weekKey];
    if (!w) return;

    const hours =
      typeof entry.hours === 'number' && !Number.isNaN(entry.hours)
        ? entry.hours
        : 0;

    const dateKey = entry.date;
    const dayInfo = w.days[dateKey];
    if (dayInfo) {
      dayInfo.hours += hours;
      if (hours > 0) {
        dayInfo.hasData = true;
      }
    }

    w.totalHours += hours;
  });

    // 3b) Akzeptierte Abwesenheiten (alle Typen) als "erfasst" markieren
  absenceRequests.forEach((req) => {
    // nur akzeptierte Anträge berücksichtigen
    if (!req.from || !req.to || req.status !== 'accepted') return;

    let fromDate = new Date(req.from);
    let toDate = new Date(req.to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return;

    // Reihenfolge korrigieren
    if (toDate < fromDate) {
      const tmp = fromDate;
      fromDate = toDate;
      toDate = tmp;
    }

    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      // nur Tage im aktuell angezeigten Monat
      if (cursor.getFullYear() !== year || cursor.getMonth() !== monthIndex) {
        cursor.setDate(cursor.getDate() + 1);
        continue;
      }

      const weekday = cursor.getDay(); // 0=So..6=Sa
      // nur Mo–Fr
      if (weekday < 1 || weekday > 5) {
        cursor.setDate(cursor.getDate() + 1);
        continue;
      }

      const { week, year: weekYear } = getISOWeekInfo(cursor);
      const weekKey = `${weekYear}-W${week}`;
      const w = weekMap[weekKey];
      if (!w) {
        cursor.setDate(cursor.getDate() + 1);
        continue;
      }

      const dateKey = formatDateKey(cursor);
      const di = w.days[dateKey];
      if (!di) {
        cursor.setDate(cursor.getDate() + 1);
        continue;
      }

      // Tag gilt als erfasst, auch wenn 0 Stunden
      di.hasData = true;

      cursor.setDate(cursor.getDate() + 1);
    }
  });

  // 4) Rendern
  weekListEl.innerHTML = '';

  const weeks = Object.values(weekMap).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.week - b.week;
  });

  if (weeks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dashboard-week-row';
    empty.textContent = 'Keine Einträge in diesem Monat.';
    weekListEl.appendChild(empty);
    return;
  }

  weeks.forEach((w) => {
    const row = document.createElement('div');
    row.className = 'dashboard-week-row';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'dashboard-week-label';

    const fromStr = w.minDate ? formatShortDate(w.minDate) : '';
    const toStr = w.maxDate ? formatShortDate(w.maxDate) : '';

    const workDaysInMonth = Object.values(w.days).filter(
      (di) => di.weekday >= 1 && di.weekday <= 5
    ).length;

    labelSpan.textContent = `KW ${w.week} · ${fromStr} – ${toStr} (${workDaysInMonth} Tage)`;

    const statusSpan = document.createElement('span');
    statusSpan.className = 'dashboard-week-status';

    const expectedDates = Object.entries(w.days)
      .filter(([, di]) => di.weekday >= 1 && di.weekday <= 5)
      .map(([dateKey]) => dateKey);

    let missingCount = 0;
    expectedDates.forEach((dateKey) => {
      const di = w.days[dateKey];
      if (!di || !di.hasData) {
        missingCount += 1;
      }
    });

    if (expectedDates.length === 0) {
      statusSpan.textContent = 'Nur Wochenende im Monat';
    } else if (missingCount === 0) {
      statusSpan.textContent = 'Alle Tage erfasst';
      statusSpan.classList.add('status-ok');
    } else {
      statusSpan.textContent = `Fehlende Einträge: ${missingCount} Tag(e)`;
      statusSpan.classList.add('status-missing');
    }

    const totalSpan = document.createElement('span');
    totalSpan.className = 'dashboard-week-total';
    totalSpan.textContent =
      w.totalHours.toFixed(1).replace('.', ',') + ' h';

    row.appendChild(labelSpan);
    row.appendChild(statusSpan);
    row.appendChild(totalSpan);

    weekListEl.appendChild(row);
  });
}

    
  

// Dashboard-Monat wechseln
if (dashboardMonthPrevBtn) {
  dashboardMonthPrevBtn.addEventListener('click', () => {
    dashboardMonthOffset -= 1;
    updateDashboardForCurrentMonth();
    updateOvertimeYearCard();
  });
}

if (dashboardMonthNextBtn) {
  dashboardMonthNextBtn.addEventListener('click', () => {
    dashboardMonthOffset += 1;
    updateDashboardForCurrentMonth();
    updateOvertimeYearCard();
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

function formatDateKey(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatHours(value) {
  const rounded = Math.round(value * 10) / 10;
  return rounded.toFixed(1).replace('.', ',') + ' h';
}

function formatHoursSigned(value) {
  const rounded = Math.round(value * 10) / 10;
  if (rounded > 0) {
    return '+' + rounded.toFixed(1).replace('.', ',') + ' h';
  }
  if (rounded < 0) {
    return '-' + Math.abs(rounded).toFixed(1).replace('.', ',') + ' h';
  }
  return '0,0 h';
}

function roundToQuarter(num) {
  // round to nearest 0.25
  return Math.round(num * 4) / 4;
}

function formatHoursForInput(num) {
  let s = num.toFixed(2);    // e.g. "2.25"
  s = s.replace('.', ',');   // -> "2,25"
  s = s.replace(/,00$/, ''); // "2,00" -> "2"
  return s;
}

function formatDays(value) {
  const rounded = Math.round(value * 10) / 10; // 1 Nachkommastelle
  return rounded.toFixed(1).replace('.', ','); // "12.5" -> "12,5"
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
  let data = dayStore[dateKey];

  if (!data) {
    data = {};
    dayStore[dateKey] = data;
  }

  // Flags: nur noch Ferien + Schmutzzulage
    // Flags: Ferien (mit Unterscheidung Manual / Absenz), Schmutzzulage, Nebenauslagen
  if (!data.flags) {
    data.flags = {};
  }

  // Migration / Defaults:
  // - Alte Daten: flags.ferien -> als "manual" interpretieren
  if (typeof data.flags.ferienManual !== 'boolean') {
    data.flags.ferienManual = !!data.flags.ferien;
  }
  if (typeof data.flags.ferienFromAbsences !== 'boolean') {
    data.flags.ferienFromAbsences = false;
  }

  // Sichtbares Ferien-Flag: OR aus beiden Quellen
  data.flags.ferien =
    !!data.flags.ferienManual || !!data.flags.ferienFromAbsences;

  if (typeof data.flags.schmutzzulage !== 'boolean') {
    data.flags.schmutzzulage = false;
  }
  if (typeof data.flags.nebenauslagen !== 'boolean') {
    data.flags.nebenauslagen = false;
  }


  // Tagesbezogene Stunden (Schulung, Sitzung/Kurs, Arzt/Krank)
  if (!data.dayHours) {
    data.dayHours = {
      schulung: 0,
      sitzungKurs: 0,
      arztKrank: 0,
    };
  } else {
    if (typeof data.dayHours.schulung !== 'number') {
      data.dayHours.schulung = 0;
    }
    if (typeof data.dayHours.sitzungKurs !== 'number') {
      data.dayHours.sitzungKurs = 0;
    }
    if (typeof data.dayHours.arztKrank !== 'number') {
      data.dayHours.arztKrank = 0;
    }
  }

  // Kom-Einträge
  if (!data.entries) {
    data.entries = [];
  }

  // Verpflegungspauschale (1=Frühstück, 2=Mittag, 3=Abend)
  if (!data.mealAllowance) {
    data.mealAllowance = {
      '1': false,
      '2': false,
      '3': false,
    };
  }

    // Spezialbuchungen (Regie / Fehler)
  if (!Array.isArray(data.specialEntries)) {
    data.specialEntries = [];
  }


  return data;
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

function createEmptySpecialEntry() {
  return {
    type: 'regie',     // "regie" oder "fehler"
    komNr: '',
    hours: 0,
    rapportNr: '',
    description: '',
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

  // 1) Kommissions-Stunden
  const inputs = activeSection.querySelectorAll('.hours-input');
  inputs.forEach((input) => {
    const raw = input.value.trim();
    if (!raw) return;

    const asNumber = parseFloat(raw.replace(',', '.'));
    if (!Number.isNaN(asNumber)) {
      total += asNumber;
    }
  });

  // 2) Tagesbezogene Stunden (Schulung / Sitzung / Arzt)
  const dayHourInputs = activeSection.querySelectorAll('.day-hours-input');
  dayHourInputs.forEach((input) => {
    const raw = input.value.trim();
    if (!raw) return;

    const asNumber = parseFloat(raw.replace(',', '.'));
    if (!Number.isNaN(asNumber)) {
      total += asNumber;
    }
  });

  // 3) Spezialbuchungen-Stunden
  const specialInputs = activeSection.querySelectorAll('.special-hours-input');
  specialInputs.forEach((input) => {
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

// --- Tagesbezogene Stunden (Schulung / Sitzung/Kurs / Arzt/Krank) --- //
function applyDayHoursForCurrentDay() {
  const activeSection = document.querySelector('.day-content.active');
  if (!activeSection) return;

  const dateKey = getCurrentDateKey();
  const dayData = getOrCreateDayData(dateKey);
  const dayHours = dayData.dayHours || {
    schulung: 0,
    sitzungKurs: 0,
    arztKrank: 0,
  };

  const inputs = activeSection.querySelectorAll('.day-hours-input');
  inputs.forEach((input) => {
    const key = input.dataset.dayhour; // "schulung", "sitzungKurs", "arztKrank"
    if (!key) return;

    const val = dayHours[key];
    if (typeof val === 'number' && !Number.isNaN(val) && val !== 0) {
      input.value = val.toString().replace('.', ',');
    } else {
      input.value = '';
    }
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
    labelSpan.textContent = 'Kommissions Nummer';

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

      const labelText = OPTION_LABELS[key] ?? `Option ${idx + 1}`;
      optLabel.textContent = labelText;


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

function applySpecialEntriesForCurrentDay() {
  const activeSection = document.querySelector('.day-content.active');
  if (!activeSection) return;

  const section = activeSection.querySelector('.special-section');
  if (!section) return;

  const listEl = section.querySelector('.special-list');
  if (!listEl) return;

  const dateKey = getCurrentDateKey();
  const dayData = getOrCreateDayData(dateKey);

  if (!Array.isArray(dayData.specialEntries)) {
    dayData.specialEntries = [];
  }

  listEl.innerHTML = '';

  if (dayData.specialEntries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'special-empty-text';
    empty.textContent = 'Keine Spezialbuchungen erfasst.';
    listEl.appendChild(empty);
    return;
  }

  dayData.specialEntries.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'special-row';
    row.dataset.specialIndex = String(index);

    // --- Top: Art + Stunden + Entfernen ---
    const top = document.createElement('div');
    top.className = 'special-row-top';

    // Art (Regie / Fehler)
    const typeField = document.createElement('label');
    typeField.className = 'special-field';
    const typeLabel = document.createElement('span');
    typeLabel.textContent = 'Art';

    const typeSelect = document.createElement('select');
    typeSelect.className = 'special-type-select';

    const optRegie = document.createElement('option');
    optRegie.value = 'regie';
    optRegie.textContent = 'Regiearbeit';

    const optFehler = document.createElement('option');
    optFehler.value = 'fehler';
    optFehler.textContent = 'Fehler';

    typeSelect.appendChild(optRegie);
    typeSelect.appendChild(optFehler);
    typeSelect.value = entry.type === 'fehler' ? 'fehler' : 'regie';

    typeField.appendChild(typeLabel);
    typeField.appendChild(typeSelect);

    // Stunden
    const hoursField = document.createElement('label');
    hoursField.className = 'special-field small';
    const hoursLabel = document.createElement('span');
    hoursLabel.textContent = 'Stunden';

    const hoursInput = document.createElement('input');
    hoursInput.type = 'number';
    hoursInput.min = '0';
    hoursInput.step = '0.25';
    hoursInput.placeholder = '0,0';
    hoursInput.className = 'special-hours-input';

    if (typeof entry.hours === 'number' && !Number.isNaN(entry.hours) && entry.hours !== 0) {
      hoursInput.value = entry.hours.toString().replace('.', ',');
    }

    hoursField.appendChild(hoursLabel);
    hoursField.appendChild(hoursInput);

    // Remove
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'special-remove-btn';
    removeBtn.textContent = '✕';

    top.appendChild(typeField);
    top.appendChild(hoursField);
    top.appendChild(removeBtn);

    // --- Mitte: Kom.Nummer ---
    const middle = document.createElement('div');
    middle.className = 'special-row-middle';

    const komField = document.createElement('label');
    komField.className = 'special-field';
    const komLabel = document.createElement('span');
    komLabel.textContent = 'Kom.Nummer';
    const komInput = document.createElement('input');
    komInput.type = 'text';
    komInput.className = 'special-kom-input';
    komInput.placeholder = 'z.B. 123456';
    komInput.value = entry.komNr || '';

    komField.appendChild(komLabel);
    komField.appendChild(komInput);
    middle.appendChild(komField);

    // --- Unten: Rapport-Nr. oder Fehlerbeschreibung ---
    const bottom = document.createElement('div');
    bottom.className = 'special-row-bottom';

    const detailField = document.createElement('label');
    detailField.className = 'special-field';
    const detailLabel = document.createElement('span');
    detailLabel.className = 'special-detail-label';

    const detailInput = document.createElement('input');
    detailInput.type = 'text';
    detailInput.className = 'special-detail-input';

    if (entry.type === 'fehler') {
      detailLabel.textContent = 'Fehlerbeschreibung';
      detailInput.placeholder = 'kurze Beschreibung';
      detailInput.value = entry.description || '';
    } else {
      detailLabel.textContent = 'Rapport-Nr.';
      detailInput.placeholder = 'z.B. R-2025-001';
      detailInput.value = entry.rapportNr || '';
    }

    detailField.appendChild(detailLabel);
    detailField.appendChild(detailInput);
    bottom.appendChild(detailField);

    row.appendChild(top);
    row.appendChild(middle);
    row.appendChild(bottom);

    listEl.appendChild(row);
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

  const dateKey = getCurrentDateKey();
  const dayData = getOrCreateDayData(dateKey);

  const card = target.closest('.kom-card');
  if (!card) return;
  const entryIndex = Number(card.dataset.entryIndex || '0');
  const entry = getOrCreateEntry(dayData, entryIndex);

  const optionKey = target.dataset.option;
  if (optionKey) {
    const raw = target.value.trim();
    let num = raw ? parseFloat(raw.replace(',', '.')) : 0;
    if (!Number.isNaN(num)) {
      num = roundToQuarter(num);
    }
    entry.hours[optionKey] = Number.isNaN(num) ? 0 : num;
  }

  saveToStorage();
  updateDayTotalFromInputs();
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

    // Tagesbezogene Stunden (Schulung / Sitzung/Kurs / Arzt/Krank)
  if (target.classList.contains('day-hours-input')) {
  const dateKey = getCurrentDateKey();
  const dayData = getOrCreateDayData(dateKey);

  const key = target.dataset.dayhour; // "schulung", "sitzungKurs", "arztKrank"
  if (!key) return;

  const raw = target.value.trim();
  let num = raw ? parseFloat(raw.replace(',', '.')) : 0;
  if (!Number.isNaN(num)) {
    num = roundToQuarter(num);
  }
  dayData.dayHours[key] = Number.isNaN(num) ? 0 : num;


  saveToStorage();
  updateDayTotalFromInputs();
  }


    // Spezialbuchungen-Felder
  if (
    target.classList.contains('special-type-select') ||
    target.classList.contains('special-kom-input') ||
    target.classList.contains('special-hours-input') ||
    target.classList.contains('special-detail-input')
  ) {
    const row = target.closest('.special-row');
    if (!row) return;

    const index = Number(row.dataset.specialIndex || '0');
    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);

    if (!Array.isArray(dayData.specialEntries)) {
      dayData.specialEntries = [];
    }
    while (dayData.specialEntries.length <= index) {
      dayData.specialEntries.push(createEmptySpecialEntry());
    }

    const special = dayData.specialEntries[index];

    if (target.classList.contains('special-type-select')) {
      special.type = target.value === 'fehler' ? 'fehler' : 'regie';
      saveToStorage();
      applySpecialEntriesForCurrentDay(); // Label/Placeholder aktualisieren
      updateDayTotalFromInputs();
      return;
    }

    if (target.classList.contains('special-kom-input')) {
      const normalized = normalizeKomNr(target.value);
      target.value = normalized;
      special.komNr = normalized;
      } else if (target.classList.contains('special-hours-input')) {
      const raw = target.value.trim();
      let num = raw ? parseFloat(raw.replace(',', '.')) : 0;
      if (!Number.isNaN(num)) {
        num = roundToQuarter(num);
      }
      special.hours = Number.isNaN(num) ? 0 : num;

   
      }

    else if (target.classList.contains('special-detail-input')) {
      if (special.type === 'fehler') {
        special.description = target.value;
      } else {
        special.rapportNr = target.value;
      }
    }

    saveToStorage();
    updateDayTotalFromInputs();
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

  if (!dayData.flags) {
    dayData.flags = {};
  }

  if (flagKey === 'ferien') {
    // Benutzer setzt/entfernt manuelles Ferien-Flag
    if (typeof dayData.flags.ferienFromAbsences !== 'boolean') {
      dayData.flags.ferienFromAbsences = false;
    }
    dayData.flags.ferienManual = target.checked;
    dayData.flags.ferien =
      !!dayData.flags.ferienManual || !!dayData.flags.ferienFromAbsences;
  } else {
    // andere Flags wie bisher
    dayData.flags[flagKey] = target.checked;
  }

  saveToStorage();
});


// Status eines Abwesenheits-Antrags ändern (Offen / Akzeptiert / Abgelehnt)
document.addEventListener('change', (event) => {
  const target = event.target;
  if (!target || !target.classList) return;

  if (!target.classList.contains('absence-status-select')) {
    return;
  }

  const select = target;
  const id = select.dataset.absenceId;
  if (!id) return;

  const req = absenceRequests.find((r) => r.id === id);
  if (!req) return;

  const value = select.value;
  if (
    value !== 'pending' &&
    value !== 'accepted' &&
    value !== 'rejected'
  ) {
    return;
  }

  req.status = value;
  saveAbsenceRequests();

  // Badge im gleichen Item updaten
  const container = select.closest('.absence-item');
  if (!container) return;

  const badge = container.querySelector('.absence-status-badge');
  if (!badge) return;

  badge.classList.remove('pending', 'accepted', 'rejected');

  if (value === 'pending') {
    badge.classList.add('pending');
    badge.textContent = 'Offen';
  } else if (value === 'accepted') {
    badge.classList.add('accepted');
    badge.textContent = 'Akzeptiert';
  } else {
    badge.classList.add('rejected');
    badge.textContent = 'Abgelehnt';
  }

  // Ferien-Stand aktualisieren
  updateOvertimeYearCard();
  // Wochenstatus (Fehlende Einträge) direkt aktualisieren
  updateDashboardWeekListForCurrentMonth();
});


// Add / remove Kom cards + Verpflegungspauschale + info
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!target) return;

  // + Kom.Nummer hinzufügen
  if (target.classList.contains('kom-add-btn')) {
    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);

    // Neue leere Kom-Eintrag anhängen
    dayData.entries.push(createEmptyEntry());
    saveToStorage();
    applyKomForCurrentDay();
    updateDayTotalFromInputs();
  }

  // ✕ auf einer Kom-Karte: inline Bestätigung einblenden (nicht für Pikett)
  if (
    target.classList.contains('kom-remove-btn') &&
    !target.classList.contains('pikett-remove-btn')
  ) {
    const card = target.closest('.kom-card');
    if (!card) return;

    // Wenn bereits im Bestätigungsmodus → nichts tun
    if (card.classList.contains('kom-confirm-mode')) {
      return;
    }

    card.classList.add('kom-confirm-mode');

    // Bestätigungszeile bauen
    const row = document.createElement('div');
    row.className = 'kom-confirm-row';

    const text = document.createElement('span');
    text.className = 'kom-confirm-text';
    text.textContent = 'Kommission wirklich löschen?';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'kom-confirm-cancel';
    cancelBtn.textContent = 'Abbrechen';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'kom-confirm-delete';
    deleteBtn.textContent = 'Löschen';

    row.appendChild(text);
    row.appendChild(cancelBtn);
    row.appendChild(deleteBtn);

    card.appendChild(row);
  }

  // Klick auf "Abbrechen" in der Bestätigungszeile
  if (target.classList.contains('kom-confirm-cancel')) {
    const card = target.closest('.kom-card');
    if (!card) return;

    const row = card.querySelector('.kom-confirm-row');
    if (row) row.remove();

    card.classList.remove('kom-confirm-mode');
  }

  // Klick auf "Löschen" in der Bestätigungszeile
  if (target.classList.contains('kom-confirm-delete')) {
    const card = target.closest('.kom-card');
    if (!card) return;

    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);
    const index = Number(card.dataset.entryIndex || '0');

    if (dayData.entries && dayData.entries.length > 1) {
      dayData.entries.splice(index, 1);
    } else {
      // mindestens eine Karte behalten → leeren Eintrag zurücksetzen
      dayData.entries = [createEmptyEntry()];
    }

    saveToStorage();
    applyKomForCurrentDay();
    updateDayTotalFromInputs();
  }

  // Verpflegungspauschale-Pills (1, 2, 3) toggeln
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

    const current = !!dayData.mealAllowance[key];
    dayData.mealAllowance[key] = !current;

    saveToStorage();
    applyMealAllowanceForCurrentDay();
  }

  // Info-Button für Verpflegungspauschale
  if (target.classList.contains('meal-info-btn')) {
    const section = target.closest('.meal-section');
    if (!section) return;
    section.classList.toggle('open-info');
  }

    // + Spezialbuchung hinzufügen
  if (target.classList.contains('special-add-btn')) {
    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);

    if (!Array.isArray(dayData.specialEntries)) {
      dayData.specialEntries = [];
    }

    dayData.specialEntries.push(createEmptySpecialEntry());
    saveToStorage();
    applySpecialEntriesForCurrentDay();
    updateDayTotalFromInputs();
  }

      // Spezialbuchung entfernen – mit Bestätigung
  if (target.classList.contains('special-remove-btn')) {
    const row = target.closest('.special-row');
    if (!row) return;

    // Schon im Bestätigungsmodus? Dann nichts tun.
    if (row.classList.contains('special-confirm-mode')) {
      return;
    }

    row.classList.add('special-confirm-mode');

    const confirmRow = document.createElement('div');
    confirmRow.className = 'special-confirm-row';

    const text = document.createElement('span');
    text.className = 'special-confirm-text';
    text.textContent = 'Spezialbuchung wirklich löschen?';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'special-confirm-cancel';
    cancelBtn.textContent = 'Abbrechen';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'special-confirm-delete';
    deleteBtn.textContent = 'Löschen';

    confirmRow.appendChild(text);
    confirmRow.appendChild(cancelBtn);
    confirmRow.appendChild(deleteBtn);

    row.appendChild(confirmRow);
  }

  // Bestätigung abbrechen
  if (target.classList.contains('special-confirm-cancel')) {
    const row = target.closest('.special-row');
    if (!row) return;

    const confirmRow = row.querySelector('.special-confirm-row');
    if (confirmRow) confirmRow.remove();

    row.classList.remove('special-confirm-mode');
  }

  // Endgültig löschen
  if (target.classList.contains('special-confirm-delete')) {
    const row = target.closest('.special-row');
    if (!row) return;

    const index = Number(row.dataset.specialIndex || '0');
    const dateKey = getCurrentDateKey();
    const dayData = getOrCreateDayData(dateKey);

    if (Array.isArray(dayData.specialEntries)) {
      dayData.specialEntries.splice(index, 1);
    }

    saveToStorage();
    applySpecialEntriesForCurrentDay();
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
    applyDayHoursForCurrentDay(); 
    applyMealAllowanceForCurrentDay();  
    applyKomForCurrentDay();
    applySpecialEntriesForCurrentDay(); 
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
    applyMealAllowanceForCurrentDay();  
    applyKomForCurrentDay();
    applySpecialEntriesForCurrentDay(); 
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
    applyDayHoursForCurrentDay();
    applyMealAllowanceForCurrentDay();   
    applyKomForCurrentDay();
    applySpecialEntriesForCurrentDay(); 
    updateDayTotalFromInputs();
  });
});

// --- Initial render --- //

loadFromStorage();
renderWeekInfo();
applyFlagsForCurrentDay();
applyDayHoursForCurrentDay(); 
applyMealAllowanceForCurrentDay();   
applyKomForCurrentDay();
applySpecialEntriesForCurrentDay();
updateDayTotalFromInputs();
renderPikettList();
updatePikettMonthTotal();
updateDashboardForCurrentMonth();
updateOvertimeYearCard();

