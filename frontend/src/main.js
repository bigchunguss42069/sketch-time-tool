import './style.css';

/**
 * DOM references and top-level UI handles
 */

const dayButtons = document.querySelectorAll('.day-button');
const daySections = document.querySelectorAll('.day-content');
const titleEl = document.getElementById('dayTitle');
const weekLabelEl = document.getElementById('weekLabel');
const dayDateSpans = document.querySelectorAll('.day-num');
const weekPrevBtn = document.getElementById('weekPrev');
const weekNextBtn = document.getElementById('weekNext');
const dayTotalEl = document.getElementById('dayTotal');

let STORAGE_KEY = 'wochenplan-v1';
let PIKETT_STORAGE_KEY = 'pikett-v1';
let ABSENCE_STORAGE_KEY = 'absenceRequests-v1';

const topNavTabs = document.querySelectorAll('.top-nav-tab');
const appViews = document.querySelectorAll('.app-view');

const adminTab = document.getElementById('adminTab');
const adminSummaryContainer = document.getElementById('adminSummaryContainer');
const adminInnerTabButtons = document.querySelectorAll('.admin-tab-btn');
const adminTabContents = document.querySelectorAll('.admin-tab-content');
const adminMonthPrevBtn = document.getElementById('adminMonthPrev');
const adminMonthNextBtn = document.getElementById('adminMonthNext');
const adminMonthLabelEl = document.getElementById('adminMonthLabel');
const adminDayDetailCache = new Map(); // key: username|year|monthIndex|dateKey
let adminMonthOffset = 0;

/**
 * Admin / Anlagen tab DOM handles
 */
const anlagenSearchInput = document.getElementById('anlagenSearchInput');
const anlagenStatusSelect = document.getElementById('anlagenStatusSelect');
const anlagenRefreshBtn = document.getElementById('anlagenRefreshBtn');
const adminAnlagenList = document.getElementById('adminAnlagenList');
const adminAnlagenDetail = document.getElementById('adminAnlagenDetail');

/**
 * Admin / Anlagen tab state and caches
 */
let adminActiveInnerTab = 'overview';
let anlagenStatusFilter = 'active';
let anlagenSearchTerm = '';
let selectedKomNr = null;
let allUsers = [];
let editingUserId = null;
let myWeekLocks = {}; // weekKey -> { locked, lockedAt, lockedBy }

const anlagenSummaryCache = new Map(); // key: `${status}` -> anlagen[]
const anlagenDetailCache = new Map(); // key: komNr -> detail

// Teams — sync mit server.js TEAMS
const TEAMS = [
  { id: 'montage', name: 'Team Montage' },
  { id: 'werkstatt', name: 'Team Werkstatt' },
  { id: 'service', name: 'Team Service' },
  { id: 'büro', name: 'Team Büro' },
];

/**
 * Admin / Personnel and payroll DOM handles
 */
const adminAbsenceListEl = document.getElementById('adminAbsenceList');
const adminAbsenceStatusFilterEl = document.getElementById(
  'adminAbsenceStatusFilter'
);
const adminAbsenceSearchEl = document.getElementById('adminAbsenceSearch');
const adminPersonnelRefreshBtn = document.getElementById(
  'adminPersonnelRefreshBtn'
);
const adminKontenGridEl = document.getElementById('adminKontenGrid');

const payrollPeriodFromEl = document.getElementById('payrollPeriodFrom');
const payrollPeriodToEl = document.getElementById('payrollPeriodTo');
const payrollRefreshBtn = document.getElementById('payrollRefreshBtn');
const payrollSummaryBarEl = document.getElementById('payrollSummaryBar');
const adminPayrollGridEl = document.getElementById('adminPayrollGrid');

const pikettAddBtn = document.getElementById('pikettAddBtn');
const pikettMonthLabelEl = document.getElementById('pikettMonthLabel');
const pikettMonthPrevBtn = document.getElementById('pikettMonthPrev');
const pikettMonthNextBtn = document.getElementById('pikettMonthNext');
const pikettMonthTotalEl = document.getElementById('pikettMonthTotal');

const dashboardMonthLabelEl = document.getElementById('dashboardMonthLabel');
const dashboardMonthPrevBtn = document.getElementById('dashboardMonthPrev');
const dashboardMonthNextBtn = document.getElementById('dashboardMonthNext');

const dashTotalStampHoursEl = document.getElementById('dashTotalStampHours');
const dashTotalPikettEl = document.getElementById('dashTotalPikett');
const dashTotalOvertime3El = document.getElementById('dashTotalOvertime3');
const dashTotalHoursEl = document.getElementById('dashTotalHours');

/**
 * Admin / User management DOM handles
 */
const adminUsersSearch = document.getElementById('adminUsersSearch');
const adminUsersAddBtn = document.getElementById('adminUsersAddBtn');
const adminUsersGrid = document.getElementById('adminUsersGrid');
const adminUserModal = document.getElementById('adminUserModal');
const adminUserModalTitle = document.getElementById('adminUserModalTitle');
const adminUserModalClose = document.getElementById('adminUserModalClose');
const adminUserModalCancel = document.getElementById('adminUserModalCancel');
const adminUserModalSave = document.getElementById('adminUserModalSave');
const adminUserModalError = document.getElementById('adminUserModalError');
const modalUsername = document.getElementById('modalUsername');
const modalEmail = document.getElementById('modalEmail');
const modalPassword = document.getElementById('modalPassword');
const modalRole = document.getElementById('modalRole');
const modalTeam = document.getElementById('modalTeam');
const modalEmploymentStart = document.getElementById('modalEmploymentStart');

/**
 * Dashboard / yearly overtime and Vorarbeit cards
 */
const overtimeYearUeZ1El = document.getElementById('overtimeYearUeZ1');
const overtimeYearUeZ2El = document.getElementById('overtimeYearUeZ2');
const overtimeYearUeZ3El = document.getElementById('overtimeYearUeZ3');
const overtimeYearVorarbeitEl = document.getElementById(
  'overtimeYearVorarbeit'
);

const overtimeYearSourceEl = document.getElementById('overtimeYearSource');

/**
 * Dashboard / vacation and absences DOM handles
 */
const vacationYearSummaryEl = document.getElementById('vacationYearSummary');
// Abwesenheiten (Ferien-Card & Formular)
const absenceListEl = document.getElementById('absenceList');
const absenceTypeEl = document.getElementById('absenceType');
const absenceFromEl = document.getElementById('absenceFrom');
const absenceToEl = document.getElementById('absenceTo');
const absenceDaysEl = document.getElementById('absenceDays');
const absenceCommentEl = document.getElementById('absenceComment');
const absenceSaveBtn = document.getElementById('absenceSaveBtn');
/**
 * Dashboard / transmission controls
 */
const dashboardTransmitBtn = document.getElementById('dashboardTransmitBtn');
/**
 * Auth / login and app shell DOM handles
 */
const loginView = document.getElementById('loginView');
const mainApp = document.getElementById('mainApp');
const loginForm = document.getElementById('loginForm');
const loginUsernameInput = document.getElementById('loginUsername');
const loginPasswordInput = document.getElementById('loginPassword');
const loginErrorEl = document.getElementById('loginError');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');
const loginLoader = document.getElementById('loginLoader');
const userDisplayEl = document.getElementById('userDisplay');
const dinoModal = document.getElementById('dinoModal');
const dinoCanvas = document.getElementById('dinoCanvas');
const dinoModalClose = document.getElementById('dinoModalClose');
const logoutBtn = document.getElementById('logoutBtn');
let _floorInterval = null;

// Stamp Card DOM handles
const stampBtn = document.getElementById('stampBtn');
const stampBtnLabel = document.getElementById('stampBtnLabel');
const stampBtnIcon = document.getElementById('stampBtnIcon');
const stampCardDate = document.getElementById('stampCardDate');
const stampCardNet = document.getElementById('stampCardNet');
const stampLog = document.getElementById('stampLog');
const stampEditDate = document.getElementById('stampEditDate');
const stampEditLog = document.getElementById('stampEditLog');
const stampEditAddBtn = document.getElementById('stampEditAddBtn');
const stampEditSchmutzzulage = document.getElementById(
  'stampEditSchmutzzulage'
);
const stampEditNebenauslagen = document.getElementById(
  'stampEditNebenauslagen'
);
const stampModal = document.getElementById('stampModal');
const stampModalTitle = document.getElementById('stampModalTitle');
const stampModalClose = document.getElementById('stampModalClose');
const stampModalCancel = document.getElementById('stampModalCancel');
const stampModalSave = document.getElementById('stampModalSave');
const stampModalTime = document.getElementById('stampModalTime');
const stampModalTypeIn = document.getElementById('stampModalTypeIn');
const stampModalTypeOut = document.getElementById('stampModalTypeOut');
/**
 *  Login Loader
 */

function setLoginLoading(isLoading) {
  const loginForm = document.getElementById('loginForm');

  if (loginForm) loginForm.classList.toggle('hidden', isLoading);

  if (loginLoader) {
    loginLoader.classList.toggle('hidden', !isLoading);
    loginLoader.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
  }

  const floorNum = document.getElementById('loaderFloorNum');
  const floors = ['G', '1', '2', '3', '4', '5'];
  if (isLoading && floorNum) {
    let i = 0;
    _floorInterval = setInterval(() => {
      i = (i + 1) % floors.length;
      floorNum.textContent = floors[i];
    }, 500);
  } else {
    if (_floorInterval) {
      clearInterval(_floorInterval);
      _floorInterval = null;
    }
    if (floorNum) floorNum.textContent = 'G';
  }
}

// ── Toast Notifications ──────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast${type !== 'info' ? ` toast--${type}` : ''}`;
  toast.textContent = message;
  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('toast--visible'));
  });

  // Animate out + remove
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), {
      once: true,
    });
  }, duration);
}

// ── XSS Protection ───────────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Auth / sync status pill
 */
const syncStatusEl = document.getElementById('syncStatus');
const syncLabelEl = document.getElementById('syncLabel');

/**
 * Admin / payroll helpers and card rendering
 */
let payrollUsersCache = null;

function formatDateInputValue(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Seed the payroll period picker with the current month start and today when empty.
 */
function ensurePayrollDefaultPeriod() {
  if (!payrollPeriodFromEl || !payrollPeriodToEl) return;

  if (payrollPeriodFromEl.value && payrollPeriodToEl.value) return;

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  payrollPeriodFromEl.value = formatDateInputValue(monthStart);
  payrollPeriodToEl.value = formatDateInputValue(today);
}

function getPayrollSelectedPeriod() {
  ensurePayrollDefaultPeriod();

  return {
    from: payrollPeriodFromEl?.value || '',
    to: payrollPeriodToEl?.value || '',
  };
}

/**
 * Load and cache the payroll user list for admin payroll UI helpers.
 */
async function fetchAdminPayrollUsers() {
  if (payrollUsersCache) return payrollUsersCache;

  const res = await authFetch('/api/admin/payroll-users');
  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'Mitarbeiter konnten nicht geladen werden');
  }

  payrollUsersCache = Array.isArray(data.users) ? data.users : [];
  return payrollUsersCache;
}

function createPayrollMetric(label, value) {
  const item = document.createElement('div');
  item.className = 'admin-payroll-metric';

  const labelEl = document.createElement('span');
  labelEl.className = 'admin-payroll-metric-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'admin-payroll-metric-value';
  valueEl.textContent = value;

  item.appendChild(labelEl);
  item.appendChild(valueEl);
  return item;
}

function formatPayrollSignedHours(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0,0 h';

  const abs = Math.abs(n).toFixed(1).replace('.', ',');
  if (n > 0) return `+${abs} h`;
  if (n < 0) return `-${abs} h`;
  return '0,0 h';
}

function formatPayrollCounterHours(current, total) {
  const a = Number.isFinite(Number(current))
    ? Number(current).toFixed(1).replace('.', ',')
    : '0,0';

  const b = Number.isFinite(Number(total))
    ? Number(total).toFixed(1).replace('.', ',')
    : '0,0';

  return `${a} / ${b} h`;
}

/**
 * Download the server-generated payroll PDF for one employee and the currently selected period.
 */
async function exportPayrollPdf(username, displayName) {
  const { from, to } = getPayrollSelectedPeriod();

  if (!from || !to) {
    throw new Error('Bitte zuerst einen Zeitraum auswählen.');
  }

  const resp = await authFetch(
    `/api/admin/payroll-export-pdf?username=${encodeURIComponent(username)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );

  if (!resp.ok) {
    let msg = 'PDF Export fehlgeschlagen';
    try {
      const j = await resp.json();
      msg = j?.error || msg;
    } catch {}
    throw new Error(msg);
  }

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `Lohnabrechnung_${username}_${from}_${to}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function renderAdminPayrollCards(rows) {
  if (!adminPayrollGridEl) return;

  adminPayrollGridEl.innerHTML = '';

  if (!Array.isArray(rows) || !rows.length) {
    adminPayrollGridEl.innerHTML =
      '<div class="admin-payroll-empty">Keine Mitarbeiter gefunden.</div>';
    return;
  }

  const { from, to } = getPayrollSelectedPeriod();
  const fromLabel = formatDateDisplayEU(from);
  const toLabel = formatDateDisplayEU(to);

  rows.forEach((row) => {
    const totals = row?.totals || {};
    const overtime = row?.overtime || {};
    const vorarbeit = row?.vorarbeit || {};

    const card = document.createElement('div');
    card.className = 'admin-payroll-card';

    const head = document.createElement('div');
    head.className = 'admin-payroll-card-head';

    const left = document.createElement('div');

    const title = document.createElement('h4');
    title.className = 'admin-payroll-card-title';
    title.textContent = row.displayName || row.username || '–';

    const period = document.createElement('div');
    period.className = 'admin-payroll-card-period';
    period.textContent = `Zeitraum: ${fromLabel} – ${toLabel}`;

    left.appendChild(title);
    left.appendChild(period);

    const actions = document.createElement('div');

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'anlagen-export-btn';
    exportBtn.textContent = 'Export PDF';

    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      const prevText = exportBtn.textContent;
      exportBtn.textContent = 'Export läuft…';

      try {
        await exportPayrollPdf(row.username, row.displayName);
      } catch (err) {
        console.error(err);
        showToast(err?.message || 'PDF Export fehlgeschlagen');
      } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = prevText;
      }
    });

    actions.appendChild(exportBtn);

    head.appendChild(left);
    head.appendChild(actions);

    const metrics = document.createElement('div');
    metrics.className = 'admin-payroll-metrics';

    // Hauptmetriken
    metrics.appendChild(
      createPayrollMetric('Präsenz', formatPayrollHours(totals.praesenzStunden))
    );
    metrics.appendChild(
      createPayrollMetric('Pikett', formatPayrollHours(totals.pikettHours))
    );
    metrics.appendChild(
      createPayrollMetric(
        'ÜZ3 Wochenende',
        formatPayrollHours(totals.ueZ3Hours)
      )
    );
    metrics.appendChild(
      createPayrollMetric(
        'Morgenessen',
        formatPayrollCount(totals.morgenessenCount)
      )
    );
    metrics.appendChild(
      createPayrollMetric(
        'Mittagessen',
        formatPayrollCount(totals.mittagessenCount)
      )
    );
    metrics.appendChild(
      createPayrollMetric(
        'Abendessen',
        formatPayrollCount(totals.abendessenCount)
      )
    );
    metrics.appendChild(
      createPayrollMetric(
        'Schmutzzulage',
        formatPayrollCount(totals.schmutzzulageCount)
      )
    );
    metrics.appendChild(
      createPayrollMetric(
        'Nebenauslagen',
        formatPayrollCount(totals.nebenauslagenCount)
      )
    );

    // Absenzen-Sektion
    const absMap = row.absencesByType || {};

    const absDivider = document.createElement('div');
    absDivider.className = 'admin-payroll-divider';
    const absTitle = document.createElement('div');
    absTitle.className = 'admin-payroll-subtitle';
    absTitle.textContent = 'Absenzen im Zeitraum';
    const absMetrics = document.createElement('div');
    absMetrics.className =
      'admin-payroll-metrics admin-payroll-metrics--secondary';

    const TYPE_LABELS = {
      ferien: 'Ferien',
      krank: 'Krank / Arztbesuch',
      unfall: 'Unfall',
      militaer: 'Militär',
      mutterschaft: 'Mutterschaft',
      vaterschaft: 'Vaterschaftsurlaub',
      bezahlteabwesenheit: 'Bezahlte Abwesenheit',
      sonstiges: 'Sonstiges',
    };

    Object.entries(absMap).forEach(([type, data]) => {
      if (data.days <= 0 && data.hours <= 0) return;
      const label = TYPE_LABELS[type] || type;
      const value =
        data.hours > 0 ? `${data.days}d / ${data.hours}h` : `${data.days}d`;
      absMetrics.appendChild(createPayrollMetric(label, value));
    });

    const overtimeDivider = document.createElement('div');
    overtimeDivider.className = 'admin-payroll-divider';

    const overtimeTitle = document.createElement('div');
    overtimeTitle.className = 'admin-payroll-subtitle';
    overtimeTitle.textContent = 'Überzeit in dieser Lohnperiode';

    const overtimeMetrics = document.createElement('div');
    overtimeMetrics.className =
      'admin-payroll-metrics admin-payroll-metrics--secondary';

    overtimeMetrics.appendChild(
      createPayrollMetric('ÜZ1 roh', formatPayrollSignedHours(overtime.ueZ1Raw))
    );
    overtimeMetrics.appendChild(
      createPayrollMetric(
        'Vorarbeit angerechnet',
        formatPayrollSignedHours(overtime.vorarbeitApplied)
      )
    );
    overtimeMetrics.appendChild(
      createPayrollMetric(
        'ÜZ1 nach Vorarbeit',
        formatPayrollSignedHours(overtime.ueZ1AfterVorarbeit)
      )
    );
    overtimeMetrics.appendChild(
      createPayrollMetric('ÜZ2', formatPayrollSignedHours(overtime.ueZ2))
    );
    overtimeMetrics.appendChild(
      createPayrollMetric('ÜZ3', formatPayrollSignedHours(overtime.ueZ3))
    );

    const vorarbeitDivider = document.createElement('div');
    vorarbeitDivider.className = 'admin-payroll-divider';

    const vorarbeitTitle = document.createElement('div');
    vorarbeitTitle.className = 'admin-payroll-subtitle';
    vorarbeitTitle.textContent = `Vorarbeitszeit (${vorarbeit.year || '–'})`;

    const vorarbeitMetrics = document.createElement('div');
    vorarbeitMetrics.className =
      'admin-payroll-metrics admin-payroll-metrics--secondary';

    vorarbeitMetrics.appendChild(
      createPayrollMetric(
        'Stand per Periodenende',
        formatPayrollCounterHours(vorarbeit.filled, vorarbeit.required)
      )
    );
    vorarbeitMetrics.appendChild(
      createPayrollMetric(
        'Änderung im Zeitraum',
        formatPayrollSignedHours(vorarbeit.changeInPeriod)
      )
    );

    card.appendChild(head);
    card.appendChild(metrics);

    if (Object.keys(absMap).length > 0) {
      card.appendChild(absDivider);
      card.appendChild(absTitle);
      card.appendChild(absMetrics);
    }

    card.appendChild(overtimeDivider);
    card.appendChild(overtimeTitle);
    card.appendChild(overtimeMetrics);
    card.appendChild(vorarbeitDivider);
    card.appendChild(vorarbeitTitle);
    card.appendChild(vorarbeitMetrics);

    adminPayrollGridEl.appendChild(card);
  });
}

/**
 * Load the payroll period summary from the server and render one card per employee.
 */
async function loadAdminPayroll() {
  if (!payrollSummaryBarEl || !adminPayrollGridEl) return;

  const { from, to } = getPayrollSelectedPeriod();

  if (!from || !to) {
    payrollSummaryBarEl.textContent = 'Bitte Zeitraum auswählen.';
    adminPayrollGridEl.innerHTML =
      '<div class="admin-payroll-empty">Bitte Zeitraum auswählen.</div>';
    return;
  }

  payrollSummaryBarEl.textContent = 'Lade Lohndaten …';
  adminPayrollGridEl.innerHTML =
    '<div class="admin-payroll-empty">Lohndaten werden geladen …</div>';

  try {
    const res = await authFetch(
      `/api/admin/payroll-period?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || 'Lohndaten konnten nicht geladen werden');
    }

    const rows = Array.isArray(data.rows) ? data.rows : [];
    const filteredRows = adminActiveTeamFilterPayroll
      ? rows.filter((r) => r.teamId === adminActiveTeamFilterPayroll)
      : rows;
    const summary = data.summary || {};

    payrollSummaryBarEl.textContent =
      `${summary.usersCount || rows.length} Mitarbeiter · ` +
      `Zeitraum ${formatDateDisplayEU(data.period?.from || from)} – ${formatDateDisplayEU(data.period?.to || to)} · ` +
      `Nur übertragene Daten berücksichtigt`;

    renderAdminPayrollCards(filteredRows);
  } catch (err) {
    console.error(err);
    payrollSummaryBarEl.textContent = 'Lohndaten konnten nicht geladen werden.';
    adminPayrollGridEl.innerHTML = `<div class="admin-payroll-empty">${err.message || 'Fehler beim Laden.'}</div>`;
  }
}
/**
 * Top-level navigation
 * Switches the active main view and triggers view-specific refreshes.
 */

topNavTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    if (_draftLoadComplete) syncDraftToServer();
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
      syncMyAbsencesFromServer();
      loadSyncStatus();
    } else if (view === 'wochenplan') {
      loadMyWeekLocks();
      renderStampCard();
    } else if (view === 'pikett') {
      loadMyWeekLocks();
    } else if (view === 'admin') {
      loadAdminSummary();
    }
  });
});

window.addEventListener('beforeunload', () => {
  if (_draftLoadComplete) syncDraftToServer();
});

/**
 * Wochenplan runtime state
 * Per-user draft data continues to live in localStorage until a month is transmitted.
 */

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
  option4: 'Inbetreibnahme',
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
    // Nur setzen wenn User aktiv bearbeitet, nicht wenn vom Server geladen
    scheduleDraftSync();
  } catch (err) {
    console.error('Failed to save to storage', err);
  }
}

// Draft Sync — debounced, sendet aktuellen Monat an Server
let _draftSyncTimer = null;
let _draftLoadComplete = false;

function scheduleDraftSync() {
  if (_draftSyncTimer) clearTimeout(_draftSyncTimer);
  _draftSyncTimer = setTimeout(() => syncDraftToServer(), 3000);
}

// savedAt nur beim echten Sync updaten:
async function syncDraftToServer() {
  const user = getCurrentUser();
  if (!user) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const savedAt = now.toISOString();

  const monthData = {};
  Object.entries(dayStore).forEach(([dateKey, dayData]) => {
    const d = new Date(dateKey + 'T00:00:00');
    if (d.getFullYear() === year && d.getMonth() === month) {
      monthData[dateKey] = dayData;
    }
  });

  const basedOn = localStorage.getItem(STORAGE_KEY + '_savedAt') || null;
  const data = { dayStore: monthData, pikettStore, year, month, savedAt };

  try {
    const res = await authFetch('/api/draft/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, basedOn }),
    });

    if (res.status === 409) {
      // Anderes Gerät hat neuere Daten — Server-Stand laden
      console.warn('Draft conflict: reloading from server');
      await loadDraftFromServer();
      showToast('Daten von anderem Gerät übernommen');
      return;
    }

    const syncData = await res.json().catch(() => null);
    const serverSavedAt = syncData?.updatedAt || savedAt;
    localStorage.setItem(STORAGE_KEY + '_savedAt', serverSavedAt);
  } catch (err) {
    console.error('Draft sync failed', err);
  }
}

/**
 * Auth and API helpers
 */
const BACKEND_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || window.location.origin;
const AUTH_SESSION_KEY = 'authSession';

// session = { token: string, user: { id, username, role, ... } }
function setAuthSession(token, user) {
  const session = { token, user };
  try {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  } catch (err) {
    console.error('Failed to store auth session', err);
  }
}

function getAuthSession() {
  const raw = localStorage.getItem(AUTH_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.token !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
}

function getAuthToken() {
  const session = getAuthSession();
  return session?.token || '';
}

function getCurrentUser() {
  const session = getAuthSession();
  return session?.user || null;
}

// Wrapper for fetch that automatically adds Authorization header
function authFetch(path, options = {}) {
  const token = getAuthToken();
  const headers = {
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch(`${BACKEND_BASE_URL}${path}`, {
    ...options,
    headers,
  }).then((res) => {
    // Wenn Token ungültig → Session löschen und Login anzeigen
    if (res.status === 401) {
      clearAuthSession();
      showLogin();
    }
    return res;
  });
}

// Fetch official konto values and transmitted months from server
async function loadMyKontoFromServer() {
  try {
    const token = getAuthToken();
    if (!token) return null;

    const res = await authFetch('/api/konten/me');
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.ok) return null;

    return {
      konto: data.konto,
      transmittedMonths: new Set(data.transmittedMonths || []),
    };
  } catch (e) {
    console.error('Failed to load konto from server:', e);
    return null;
  }
}

// Check if a date falls within a transmitted month
function isDateInTransmittedMonth(dateKey, transmittedMonths) {
  // dateKey format: "2025-01-15"
  // transmittedMonths format: Set of "2025-01", "2025-02", etc.
  const monthKey = dateKey.slice(0, 7); // "2025-01"
  return transmittedMonths.has(monthKey);
}

// Replace local dayStore + pikettStore for a given month with the server-authoritative saved payload
/**
 * Replace the local draft representation of a transmitted month with the server-confirmed payload.
 */
function applySavedMonthPayloadToLocalStores(savedPayload) {
  if (!savedPayload || typeof savedPayload !== 'object') return;

  const year = Number(savedPayload.year);
  const monthIndex = Number(savedPayload.monthIndex);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return;

  // 1) Overwrite dayStore for that month
  Object.keys(dayStore).forEach((dateKey) => {
    const d = new Date(dateKey + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return;
    if (d.getFullYear() === year && d.getMonth() === monthIndex) {
      delete dayStore[dateKey];
    }
  });

  const daysObj =
    savedPayload.days && typeof savedPayload.days === 'object'
      ? savedPayload.days
      : {};

  Object.entries(daysObj).forEach(([dateKey, dayData]) => {
    dayStore[dateKey] = { ...dayData, stampEditLog: [] };
  });

  saveToStorage();

  // 2) Overwrite pikettStore for that month
  const newPikett = Array.isArray(savedPayload.pikett)
    ? savedPayload.pikett
    : [];

  pikettStore = pikettStore.filter((p) => {
    if (!p || !p.date) return true;
    const d = new Date(String(p.date).slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return true;
    return !(d.getFullYear() === year && d.getMonth() === monthIndex);
  });

  newPikett.forEach((p) => {
    if (!p || !p.date) return;
    pikettStore.push({
      ...p,
      isOvertime3: !!(p.isOvertime3 ?? p.overtime3),
    });
  });

  savePikettStore();
}

/**
 * Local persistence helpers / Pikett and absences
 */

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

    return parsed.map((item) => {
      const st = String(item.status || '').toLowerCase();
      const allowed = new Set([
        'pending',
        'accepted',
        'rejected',
        'cancel_requested',
        'cancelled',
      ]);

      return {
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
        status: allowed.has(st) ? st : 'pending',
      };
    });
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

function absenceTypeLabel(type) {
  const key = String(type || '')
    .trim()
    .toLowerCase();

  const map = {
    ferien: 'Ferien',
    unfall: 'Unfall',
    militaer: 'Militär',
    bezahlteabwesenheit: 'Bezahlte Abwesenheit',
    vaterschaft: 'Vaterschaftsurlaub',
  };

  return map[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : '–');
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
    saved: false,
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

/**
 * Year configuration / Vorarbeit targets and seeded balances
 */

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

/**
 * Holiday calendar / Kanton Bern
 */

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
    const text = info.label.charAt(0).toUpperCase() + info.label.slice(1);
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
    emptyCard.style.cssText =
      'color:#94a3b8;font-size:14px;font-weight:600;text-align:center;padding:32px 24px;';
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

    const locked = isDateLocked(entry.date);

    const card = document.createElement('div');
    card.className = 'pikett-card' + (locked ? ' pikett-card-locked' : '');
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
    dateInput.lang = 'de-CH';
    dateInput.value = entry.date || '';
    dateInput.disabled = locked;
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
    komInput.disabled = locked;

    // Remove Button im Kom-Wrapper
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.disabled = locked;
    const komWrap = document.createElement('div');
    komWrap.className = 'pikett-kom-wrap';
    komWrap.appendChild(komInput);
    removeBtn.className = 'pikett-remove-btn';
    removeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    komWrap.appendChild(removeBtn);
    komLabel.appendChild(komSpan);
    komLabel.appendChild(komWrap);

    fieldGroup.appendChild(dateLabel);
    fieldGroup.appendChild(komLabel);
    header.appendChild(fieldGroup);

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
    hoursInput.disabled = locked;

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
    noteLabel.className = 'pikett-label pikett-note-row';

    const noteSpan = document.createElement('span');
    noteSpan.textContent = 'Notiz (optional)';

    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.className = 'pikett-note';
    noteInput.placeholder = 'z.B. kurze Beschreibung';
    noteInput.value = entry.note || '';
    noteInput.disabled = locked;

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
    overtimeCheckbox.disabled = locked;

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
    if (locked) {
      const lockBadge = document.createElement('div');
      lockBadge.className = 'pikett-lock-badge';
      lockBadge.textContent = '🔒 Gesperrt';
      card.appendChild(lockBadge);
    }

    card.appendChild(body);

    if (!locked) {
      const cardFooter = document.createElement('div');
      cardFooter.className = 'pikett-card-footer';

      const statusBadge = document.createElement('span');
      statusBadge.className =
        'pikett-save-status ' + (entry.saved ? 'saved' : 'unsaved');
      statusBadge.textContent = entry.saved
        ? '✓ Gespeichert'
        : 'Nicht gespeichert';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'pikett-save-btn';
      saveBtn.textContent = 'Speichern';
      saveBtn.disabled = !!entry.saved;
      saveBtn.dataset.index = String(index);

      cardFooter.appendChild(statusBadge);
      cardFooter.appendChild(saveBtn);
      card.appendChild(cardFooter);
    }

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
  absenceSaveBtn.addEventListener('click', async () => {
    const type = absenceTypeEl.value;
    const from = absenceFromEl.value;
    const to = absenceToEl.value;
    const comment = absenceCommentEl.value.trim();

    let days = null;
    let hours = null;

    if (type === 'ferien') {
      const halberTag = document.getElementById('absenceHalberTag')?.checked;
      days = halberTag ? 0.5 : countAbsenceWorkdays(from, to);
      if (halberTag) hours = 4; // halber Tag = 4h Ferien
    } else if (type === 'krank') {
      const hoursRaw = document.getElementById('absenceHours')?.value;
      hours = hoursRaw ? Number(hoursRaw) : null;
      days = hours ? hours / 8 : 1;
    }
    if (!type || !from || !to) {
      showToast('Bitte Typ, Von und Bis ausfüllen.');
      return;
    }

    const localId = `abs-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    try {
      const res = await authFetch('/api/absences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: localId,
          type,
          from,
          to,
          days,
          hours,
          comment,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Absenz konnte nicht gespeichert werden');
      }

      // Reset form
      absenceFromEl.value = '';
      absenceToEl.value = '';
      absenceCommentEl.value = '';

      await syncMyAbsencesFromServer();
    } catch (e) {
      console.error(e);
      showToast(e.message || 'Fehler beim Speichern');
    }
  });
}

const BRIDGE_DAYS = new Set([
  '2026-05-15',
  '2026-12-28',
  '2026-12-29',
  '2026-12-30',
  '2026-12-31',
]);
const BERN_HOLIDAYS_CLIENT = {
  2025: new Set([
    '2025-01-01',
    '2025-01-02',
    '2025-04-18',
    '2025-04-20',
    '2025-04-21',
    '2025-05-29',
    '2025-06-09',
    '2025-08-01',
    '2025-09-21',
    '2025-12-25',
    '2025-12-26',
  ]),
  2026: new Set([
    '2026-01-01',
    '2026-01-02',
    '2026-04-03',
    '2026-04-05',
    '2026-04-06',
    '2026-05-14',
    '2026-05-25',
    '2026-08-01',
    '2026-09-20',
    '2026-12-25',
    '2026-12-26',
  ]),
  2027: new Set([
    '2027-01-01',
    '2027-01-02',
    '2027-03-26',
    '2027-03-28',
    '2027-03-29',
    '2027-05-06',
    '2027-05-17',
    '2027-08-01',
    '2027-09-19',
    '2027-12-25',
    '2027-12-26',
  ]),
};

function countAbsenceWorkdays(from, to) {
  if (!from || !to) return 0;
  let count = 0;
  const cursor = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cursor <= end) {
    const wd = cursor.getDay();
    const key = cursor.toISOString().slice(0, 10);
    const year = cursor.getFullYear();
    const holidays = BERN_HOLIDAYS_CLIENT[year] || new Set();
    if (wd >= 1 && wd <= 5 && !holidays.has(key) && !BRIDGE_DAYS.has(key))
      count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function updateAbsenceFormForType() {
  const type = absenceTypeEl?.value;
  const ferienExtra = document.getElementById('absenceFerienExtra');
  const krankExtra = document.getElementById('absenceKrankExtra');
  const halberTag = document.getElementById('absenceHalberTag');

  ferienExtra?.classList.toggle('hidden', type !== 'ferien');
  krankExtra?.classList.toggle('hidden', type !== 'krank');

  if (type === 'ferien') updateAbsenceCalcBadge();
}

function updateAbsenceCalcBadge() {
  const from = absenceFromEl?.value;
  const to = absenceToEl?.value;
  const badge = document.getElementById('absenceCalcBadge');
  const halberTag = document.getElementById('absenceHalberTag');
  if (!badge) return;

  const isSameDay = from && to && from === to;
  halberTag?.closest('label')?.classList.toggle('hidden', !isSameDay);
  if (isSameDay && halberTag?.checked) {
    badge.textContent = '0.5 Werktage';
  } else {
    const count = countAbsenceWorkdays(from, to);
    badge.textContent = `${count} Werktag${count !== 1 ? 'e' : ''}`;
  }
}

absenceTypeEl?.addEventListener('change', updateAbsenceFormForType);
absenceFromEl?.addEventListener('change', updateAbsenceCalcBadge);
absenceToEl?.addEventListener('change', updateAbsenceCalcBadge);
document
  .getElementById('absenceHalberTag')
  ?.addEventListener('change', updateAbsenceCalcBadge);

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
  } else if (target.classList.contains('pikett-note')) {
    entry.note = target.value;
  } else {
    return;
  }

  entry.saved = false;
  savePikettStore();
  updatePikettMonthTotal();

  const footer = card.querySelector('.pikett-card-footer');
  if (footer) {
    const badge = footer.querySelector('.pikett-save-status');
    const btn = footer.querySelector('.pikett-save-btn');
    if (badge) {
      badge.className = 'pikett-save-status unsaved';
      badge.textContent = 'Nicht gespeichert';
    }
    if (btn) btn.disabled = false;
  }
});

// --- NEW: handle Überzeit 3 checkbox on Pikett cards --- //
document.addEventListener('change', (event) => {
  const target = event.target;
  if (!target) return;

  if (
    !target.classList ||
    !target.classList.contains('pikett-overtime3-checkbox')
  ) {
    return;
  }

  const card = target.closest('.pikett-card');
  if (!card) return;

  const index = Number(card.dataset.index);
  if (Number.isNaN(index) || !pikettStore[index]) return;

  pikettStore[index].isOvertime3 = target.checked;
  pikettStore[index].saved = false;
  savePikettStore();

  const footer = card.querySelector('.pikett-card-footer');
  if (footer) {
    const badge = footer.querySelector('.pikett-save-status');
    const btn = footer.querySelector('.pikett-save-btn');
    if (badge) {
      badge.className = 'pikett-save-status unsaved';
      badge.textContent = 'Nicht gespeichert';
    }
    if (btn) btn.disabled = false;
  }
});

// Pikett Date Lock-Check
document.addEventListener('change', (event) => {
  const target = event.target;
  if (!target || !target.classList.contains('pikett-date')) return;

  const card = target.closest('.pikett-card');
  if (!card) return;

  const dateKey = target.value;
  const locked = isDateLocked(dateKey);

  // Bestehende Lock-Message entfernen
  let lockMsg = card.querySelector('.pikett-lock-msg');
  if (lockMsg) lockMsg.remove();

  if (locked) {
    // Alle Inputs/Buttons ausser Date-Input deaktivieren
    card.querySelectorAll('button, input:not(.pikett-date)').forEach((el) => {
      el.disabled = true;
    });

    // Lock-Message nach dem Date-Input einfügen
    lockMsg = document.createElement('div');
    lockMsg.className = 'pikett-lock-msg';
    lockMsg.textContent =
      'Diese Woche ist gesperrt — keine Änderungen möglich.';
    target.closest('.pikett-label').after(lockMsg);
  } else {
    // Alles wieder aktivieren
    card.querySelectorAll('button, input').forEach((el) => {
      el.disabled = false;
    });
  }
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!target || !target.classList.contains('pikett-save-btn')) return;

  const index = Number(target.dataset.index);
  if (Number.isNaN(index) || !pikettStore[index]) return;

  const entry = pikettStore[index];

  if (!entry.date) {
    showToast('Bitte zuerst ein Datum eingeben.');
    return;
  }

  authFetch('/api/week-locks/me')
    .then((res) => res.json())
    .then((data) => {
      if (data.ok) myWeekLocks = data.locks || {};

      if (isDateLocked(entry.date)) return;

      entry.saved = true;
      savePikettStore();
      renderPikettList();
    })
    .catch((err) => {
      console.error('Lock check failed', err);
      showToast('Fehler beim Speichern — bitte nochmal versuchen.');
    });
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
document.addEventListener('click', async (event) => {
  const target = event.target;
  if (!target || !target.classList) return;

  if (target.classList.contains('absence-delete-direct-btn')) {
    const item = target.closest('.absence-item');
    if (!item) return;
    const id = item.dataset.absenceId;
    if (!id) return;
    try {
      const res = await authFetch(`/api/absences/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.ok)
        throw new Error(data.error || 'Löschen nicht möglich');
      await syncMyAbsencesFromServer();
    } catch (e) {
      console.error(e);
      showToast(e.message || 'Fehler beim Löschen');
    }
    return;
  }

  if (target.classList.contains('absence-cancel-btn')) {
    const item = target.closest('.absence-item');
    if (!item) return;

    const id = item.dataset.absenceId;
    if (!id) return;

    try {
      const res = await authFetch(
        `/api/absences/${encodeURIComponent(id)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok)
        throw new Error(data.error || 'Aktion nicht möglich');

      await syncMyAbsencesFromServer();
    } catch (e) {
      console.error(e);
      showToast(e.message || 'Fehler');
    }
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

  // 3) Endgültig löschen (Stornieren) in der Bestätigungszeile
  if (target.classList.contains('absence-confirm-delete')) {
    const item = target.closest('.absence-item');
    if (!item) return;

    const id = item.dataset.absenceId;
    if (!id) return;

    try {
      const res = await authFetch(`/api/absences/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.ok)
        throw new Error(data.error || 'Stornieren nicht möglich');

      // Refresh local state from server (single source of truth)
      await syncMyAbsencesFromServer();
    } catch (e) {
      console.error(e);
      showToast(e.message || 'Fehler beim Stornieren');
    }
    return;
  }
});

if (adminMonthPrevBtn) {
  adminMonthPrevBtn.addEventListener('click', () => {
    if (adminActiveInnerTab !== 'overview') return;
    adminMonthOffset -= 1;
    updateAdminMonthLabel();
    loadAdminSummary();
  });
}

if (adminMonthNextBtn) {
  adminMonthNextBtn.addEventListener('click', () => {
    adminMonthOffset += 1;
    updateAdminMonthLabel();
    loadAdminSummary();
  });
}

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
    const token = getAuthToken();
    if (!token) {
      showToast(
        'Bitte zuerst einloggen, bevor Sie die Monatsdaten übertragen.'
      );
      showLogin();
      return;
    }

    const payload = buildPayloadForCurrentDashboardMonth();

    authFetch('/api/transmit-month', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) {
          // differentiate 401 vs others (optional)
          if (res.status === 401) {
            throw new Error('UNAUTHORIZED');
          }
          throw new Error('SERVER_ERROR');
        }
        return res.json();
      })
      .then((data) => {
        if (!data.ok) {
          showToast(
            `Übertragung fehlgeschlagen: ${data.error || 'Unbekannter Fehler'}`
          );
          return;
        }
        showToast(
          `Daten für ${payload.monthLabel} erfolgreich übertragen.\nServer: ${data.message}`
        );

        // Sync-Status direkt aktualisieren
        loadSyncStatus();

        // If the backend preserved locked days (or otherwise normalized the payload),
        // sync the local stores to the authoritative saved payload to keep user/admin views consistent.
        if (data.savedPayload) {
          applySavedMonthPayloadToLocalStores(data.savedPayload);

          // Optional: if locks were involved, you can surface this to the user later (toast/banner)
          if (data.lockInfo && data.lockInfo.preservedDaysCount > 0) {
            console.info(
              'Hinweis: Server hat gesperrte Tage beibehalten:',
              data.lockInfo
            );
          }

          updateDashboardForCurrentMonth();
          renderPikettList();
          updatePikettMonthTotal();
          updateOvertimeYearCard();
        }
      })
      .catch((err) => {
        console.error(err);
        if (err.message === 'UNAUTHORIZED') {
          clearAuthSession();
          showLogin();
          showToast('Sitzung ist abgelaufen. Bitte neu einloggen.');
        } else {
          showToast(
            'Übertragung fehlgeschlagen (Netzwerk oder Server nicht erreichbar).'
          );
        }
      });
  });
}

let openAdminDayRow = null;

function getDrawerForRow(row) {
  const el = row.nextElementSibling;
  return el && el.classList.contains('admin-day-drawer') ? el : null;
}

function createDrawerForRow(row) {
  const drawer = document.createElement('div');
  drawer.className = 'admin-day-drawer';
  drawer.innerHTML = `<div class="admin-day-drawer-loading">Details werden geladen …</div>`;
  row.insertAdjacentElement('afterend', drawer);
  return drawer;
}

function openDrawer(row, drawer) {
  row.classList.add('expanded');
  drawer.classList.add('is-open');

  // animate height
  drawer.style.maxHeight = '0px';
  requestAnimationFrame(() => {
    drawer.style.maxHeight = drawer.scrollHeight + 'px';
  });
}

function closeDrawer(row, drawer) {
  // animate to 0 then remove (prevents the “instant pop”)
  drawer.style.maxHeight = drawer.scrollHeight + 'px';
  requestAnimationFrame(() => {
    drawer.style.maxHeight = '0px';
    drawer.classList.remove('is-open');
  });

  row.classList.remove('expanded');

  const onEnd = (ev) => {
    if (ev.propertyName !== 'max-height') return;
    drawer.removeEventListener('transitionend', onEnd);
    drawer.remove();
  };
  drawer.addEventListener('transitionend', onEnd);
}

function refreshDrawerHeight(drawer) {
  // call after you inject real content
  requestAnimationFrame(() => {
    drawer.style.maxHeight = drawer.scrollHeight + 'px';
  });
}

document.addEventListener('click', (e) => {
  const row = e.target.closest('.admin-day-row');
  if (!row) return;

  const username = row.dataset.username;
  const year = Number(row.dataset.year);
  const monthIndex = Number(row.dataset.monthIndex);
  const dateKey = row.dataset.date;

  if (!username || !dateKey || Number.isNaN(year) || Number.isNaN(monthIndex))
    return;

  // If another day is open → close it (accordion behavior)
  if (openAdminDayRow && openAdminDayRow !== row) {
    const prevDrawer = getDrawerForRow(openAdminDayRow);
    if (prevDrawer) closeDrawer(openAdminDayRow, prevDrawer);
    openAdminDayRow = null;
  }

  // Toggle this row
  const existing = getDrawerForRow(row);
  if (existing) {
    closeDrawer(row, existing);
    openAdminDayRow = null;
    return;
  }

  // Create + open drawer
  const drawer = createDrawerForRow(row);
  openDrawer(row, drawer);
  openAdminDayRow = row;

  const cacheKey = `${username}|${year}|${monthIndex}|${dateKey}`;
  const cached = adminDayDetailCache.get(cacheKey);

  if (cached) {
    drawer.innerHTML = '';
    drawer.appendChild(buildAdminDayDrawer(cached));
    refreshDrawerHeight(drawer);
    return;
  }

  authFetch(
    `/api/admin/day-detail?username=${encodeURIComponent(username)}&year=${year}&monthIndex=${monthIndex}&date=${encodeURIComponent(dateKey)}`
  )
    .then((res) => res.json())
    .then((data) => {
      if (!data.ok) throw new Error(data.error || 'Fehler beim Laden');

      adminDayDetailCache.set(cacheKey, data);

      // If user clicked elsewhere and this drawer got closed in the meantime:
      const stillThere = getDrawerForRow(row);
      if (!stillThere) return;

      stillThere.innerHTML = '';
      stillThere.appendChild(buildAdminDayDrawer(data));
      refreshDrawerHeight(stillThere);
    })
    .catch((err) => {
      console.error(err);

      const stillThere = getDrawerForRow(row);
      if (!stillThere) return;

      stillThere.innerHTML = `<div class="admin-day-drawer-error">Fehler: ${err.message || 'Unbekannt'}</div>`;
      refreshDrawerHeight(stillThere);
    });
});

function buildAdminDayDrawer(data) {
  const wrap = document.createElement('div');
  wrap.className = 'admin-day-drawer-content';

  // -------- helpers --------
  const el = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };

  const badgeClassForStatus = (s) => {
    if (s === 'ok') return 'is-ok';
    if (s === 'missing') return 'is-missing';
    if (s === 'ferien') return 'is-ferien';
    if (s === 'absence') return 'is-absence';
    return 'is-unknown';
  };

  const addSection = (titleText, bodyNode) => {
    const section = el('div', 'admin-day-section');
    const title = el('div', 'admin-day-section-title', titleText);
    const body = el('div', 'admin-day-section-body');
    body.appendChild(bodyNode);
    section.appendChild(title);
    section.appendChild(body);
    return section;
  };

  const chip = (text, variant) => {
    const c = el('span', 'admin-day-chip', text);
    if (variant) c.classList.add(variant);
    return c;
  };

  const kv = (label, value) => {
    const row = el('div', 'admin-day-kv');
    row.appendChild(el('div', 'admin-day-kv-label', label));
    row.appendChild(el('div', 'admin-day-kv-value', value));
    return row;
  };

  const emptyMuted = (text = '–') => el('div', 'admin-day-muted', text);

  // If backend returns ok:true but transmitted:false for this day/month
  if (data && data.transmitted === false) {
    wrap.appendChild(
      el(
        'div',
        'admin-day-muted',
        'Für diesen Tag sind keine übertragenen Daten vorhanden.'
      )
    );
    return wrap;
  }

  // -------- header: date + status badge --------
  const dateKey = data?.dateKey ? String(data.dateKey).slice(0, 10) : '';
  const dateLabel = dateKey
    ? formatShortDateFromKey(dateKey)
    : data?.dateKey || '–';

  const header = el('div', 'admin-day-header');
  const headerLeft = el('div', 'admin-day-header-left');

  const title = el('div', 'admin-day-title', `Tag: ${dateLabel}`);
  const subtitle = el(
    'div',
    'admin-day-subtitle',
    data?.month?.monthLabel ? `${data.month.monthLabel}` : ''
  );

  headerLeft.appendChild(title);
  if (subtitle.textContent) headerLeft.appendChild(subtitle);

  const statusBadge = el(
    'div',
    'admin-day-status-badge',
    statusLabel(data?.status)
  );
  statusBadge.classList.add(badgeClassForStatus(data?.status));

  header.appendChild(headerLeft);
  header.appendChild(statusBadge);

  // -------- chips row (Flags / Meals / Absence) --------
  const chipsRow = el('div', 'admin-day-chips');

  // Flags
  const flags = data?.flags || {};
  const flagsActive = [];
  if (flags.ferien) flagsActive.push('Ferien');
  if (flags.schmutzzulage) flagsActive.push('Schmutzzulage');
  if (flags.nebenauslagen) flagsActive.push('Nebenauslagen');
  if (flagsActive.length) {
    flagsActive.forEach((f) => chipsRow.appendChild(chip(f, 'chip-flag')));
  } else {
    chipsRow.appendChild(chip('Keine Flags', 'chip-muted'));
  }

  // Meal allowance
  const meal = data?.mealAllowance || {};
  const mealsOn = ['1', '2', '3'].filter((k) => !!meal[k]);
  chipsRow.appendChild(
    mealsOn.length
      ? chip(`Verpflegung: ${mealsOn.join(' / ')}`, 'chip-meal')
      : chip('Keine Verpflegung', 'chip-muted')
  );

  // Absence
  const abs = data?.acceptedAbsence || null;
  if (abs) {
    const absTypeLabel =
      abs.type === 'krank'
        ? 'Krank/Arzt'
        : abs.type === 'ferien'
          ? 'Ferien'
          : abs.type || 'Absenz';
    const hoursLabel = abs.hours != null ? ` · ${abs.hours}h` : '';
    const absText = `${absTypeLabel}${hoursLabel}`;
    chipsRow.appendChild(chip(absText, 'chip-absence'));
  }

  // -------- totals grid --------
  const t = data?.totals || {};
  const totalsGrid = el('div', 'admin-day-totals');

  totalsGrid.appendChild(kv('Kommissionen', formatHoursSafe(t.komHours)));
  totalsGrid.appendChild(kv('Tagesstunden', formatHoursSafe(t.dayHoursTotal)));
  totalsGrid.appendChild(kv('Spezial', formatHoursSafe(t.specialHours)));
  totalsGrid.appendChild(kv('Pikett', formatHoursSafe(t.pikettHours)));

  const totalStrong = kv('Total', formatHoursSafe(t.totalHours));
  totalStrong.classList.add('is-total');
  totalsGrid.appendChild(totalStrong);

  // optional: show breakdown of dayHours if useful
  const dayHours = data?.breakdown?.dayHours || null;
  if (
    dayHours &&
    (dayHours.schulung || dayHours.sitzungKurs || dayHours.arztKrank)
  ) {
    const mini = el('div', 'admin-day-mini-breakdown');
    mini.appendChild(el('div', 'admin-day-mini-title', 'Tagesstunden Details'));
    mini.appendChild(
      el(
        'div',
        'admin-day-mini-line',
        `Schulung: ${formatHoursSafe(dayHours.schulung)}`
      )
    );
    mini.appendChild(
      el(
        'div',
        'admin-day-mini-line',
        `Sitzung/Kurs: ${formatHoursSafe(dayHours.sitzungKurs)}`
      )
    );
    mini.appendChild(
      el(
        'div',
        'admin-day-mini-line',
        `Transport: ${formatHoursSafe(dayHours.arztKrank)}`
      )
    );
    totalsGrid.appendChild(mini);
  }

  // -------- section: Kommissionen --------
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  let komBody;
  if (!entries.length) {
    komBody = emptyMuted();
  } else {
    const list = el('div', 'admin-day-list');
    entries.forEach((e) => {
      const line = el('div', 'admin-day-list-row');

      const komNr = e && e.komNr ? String(e.komNr) : '–';
      const hoursObj =
        e && e.hours && typeof e.hours === 'object' ? e.hours : {};

      const parts = [];
      Object.entries(hoursObj).forEach(([k, v]) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return;
        const label = OPTION_LABELS?.[k] || k;
        parts.push(
          `${label}: ${n.toFixed(2).replace('.', ',').replace(/,00$/, '')} h`
        );
      });

      const left = el('div', 'admin-day-list-left', komNr);
      const right = el(
        'div',
        'admin-day-list-right',
        parts.length ? parts.join(' · ') : '–'
      );

      line.appendChild(left);
      line.appendChild(right);
      list.appendChild(line);
    });
    komBody = list;
  }

  // -------- section: Spezialbuchungen --------
  const specials = Array.isArray(data?.specialEntries)
    ? data.specialEntries
    : [];
  let specialBody;
  if (!specials.length) {
    specialBody = emptyMuted();
  } else {
    const list = el('div', 'admin-day-list');
    specials.forEach((s) => {
      const line = el('div', 'admin-day-list-row');

      const type = s?.type === 'fehler' ? 'Fehler' : 'Regie';
      const kom = s?.komNr || '–';
      const h = formatHoursSafe(s?.hours);
      const ref =
        s?.type === 'fehler' ? s?.description || '' : s?.rapportNr || '';

      const left = el('div', 'admin-day-list-left', type);
      const right = el(
        'div',
        'admin-day-list-right',
        `${kom} · ${h}${ref ? ' · ' + ref : ''}`
      );

      line.appendChild(left);
      line.appendChild(right);
      list.appendChild(line);
    });
    specialBody = list;
  }

  // -------- section: Pikett --------
  const pikett = Array.isArray(data?.pikettEntries) ? data.pikettEntries : [];
  let pikettBody;
  if (!pikett.length) {
    pikettBody = emptyMuted();
  } else {
    const list = el('div', 'admin-day-list');
    pikett.forEach((p) => {
      const line = el('div', 'admin-day-list-row');

      const h = formatHoursSafe(p?.hours);
      const tag = p?.isOvertime3 ? 'ÜZ3' : 'ÜZ2';
      const note = p?.note ? String(p.note) : '';

      const left = el('div', 'admin-day-list-left', tag);
      const right = el(
        'div',
        'admin-day-list-right',
        `${h}${note ? ' · ' + note : ''}`
      );

      line.appendChild(left);
      line.appendChild(right);
      list.appendChild(line);
    });
    pikettBody = list;
  }

  // Präsenz / Stempelungen
  const stampsData = data?.stamps || [];
  const stampHoursVal = data?.stampHours ?? null;

  const presenzBody = el('div', 'admin-day-presenz');

  if (stampsData.length === 0) {
    presenzBody.appendChild(emptyMuted('Keine Stempelungen'));
  } else {
    const sorted = [...stampsData].sort((a, b) => a.time.localeCompare(b.time));
    const pillRow = el('div', 'admin-day-stamp-pills');
    sorted.forEach((s) => {
      const pill = el(
        'span',
        `admin-stamp-pill ${s.type === 'in' ? 'stamp-in' : 'stamp-out'}`
      );
      pill.textContent = `${s.type === 'in' ? 'Ein' : 'Aus'} ${s.time}`;
      pillRow.appendChild(pill);
    });
    presenzBody.appendChild(pillRow);
    if (stampHoursVal !== null) {
      const net = el(
        'div',
        'admin-day-stamp-net',
        `Netto: ${stampHoursVal.toFixed(1).replace('.', ',')}h`
      );
      presenzBody.appendChild(net);
    }
  }

  // -------- assemble --------
  wrap.appendChild(header);
  wrap.appendChild(chipsRow);
  wrap.appendChild(totalsGrid);
  wrap.appendChild(addSection('Präsenz', presenzBody));
  wrap.appendChild(addSection('Kommissionen', komBody));
  wrap.appendChild(addSection('Spezialbuchungen', specialBody));
  wrap.appendChild(addSection('Pikett', pikettBody));

  return wrap;
}

function statusLabel(s) {
  if (s === 'ok') return 'OK';
  if (s === 'missing') return 'Fehlt';
  if (s === 'ferien') return 'Ferien';
  if (s === 'absence') return 'Absenz';
  return '–';
}

function formatHoursSafe(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '0,0 h';
  return n.toFixed(1).replace('.', ',') + ' h';
}

function formatPayrollHours(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0,0 h';
  return `${n.toFixed(1).replace('.', ',')} h`;
}

function formatPayrollDays(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return `${String(n).replace('.', ',')} Tage`;
}

function formatPayrollCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n));
}

/**
 * Dashboard month aggregation and admin month helpers
 */
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

function getCurrentAdminMonthInfo() {
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), 1);
  base.setMonth(base.getMonth() + adminMonthOffset);

  const year = base.getFullYear();
  const monthIndex = base.getMonth();

  const labelRaw = base.toLocaleString('de-DE', {
    month: 'long',
    year: 'numeric',
  });
  const label = labelRaw.charAt(0).toUpperCase() + labelRaw.slice(1);

  return { year, monthIndex, label };
}

function updateAdminMonthLabel() {
  if (!adminMonthLabelEl) return;
  const info = getCurrentAdminMonthInfo();
  adminMonthLabelEl.textContent = info.label;
}

function parseDateKeyToDate(dateKey) {
  // dateKey = "YYYY-MM-DD"
  return new Date(dateKey + 'T00:00:00');
}

function formatShortDateFromKey(dateKey) {
  const d = parseDateKeyToDate(dateKey);
  return formatShortDate(d); // your existing dd.mm.yy
}

function formatDateDisplayEU(dateStr) {
  const raw = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return String(dateStr || '–');

  const [yyyy, mm, dd] = raw.split('-');
  return `${dd}.${mm}.${yyyy}`;
}

function formatDayLabelFromKey(dateKey, weekdayNum) {
  const d = parseDateKeyToDate(dateKey);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');

  const map = { 1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr' };
  const wd = map[weekdayNum] || '';
  return `${wd} ${dd}.${mm}`;
}

function adminStatusText(status) {
  if (status === 'ok') return 'OK';
  if (status === 'ferien') return 'Ferien';
  if (status === 'absence') return 'Absenz';
  return 'Fehlt';
}

/**
 * Build the exact month payload that will be transmitted to the server from local draft data.
 */
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
    if (!entry.saved) return false;
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

  // Stamp Edit-Log aus dayStore sammeln
  const stampEditLog = [];
  Object.values(monthDays).forEach((dayData) => {
    if (Array.isArray(dayData.stampEditLog)) {
      stampEditLog.push(...dayData.stampEditLog);
    }
  });

  return {
    year,
    monthIndex,
    monthLabel: label,
    days: monthDays,
    pikett: monthPikett,
    absences: monthAbsences,
    stampEditLog, // ← NEU
  };
}

/**
 * Load admin personnel data: absence requests and konten cards.
 */
async function loadAdminPersonnel() {
  if (!adminAbsenceListEl || !adminKontenGridEl) return;

  const status = adminAbsenceStatusFilterEl
    ? adminAbsenceStatusFilterEl.value
    : 'pending';
  const search = adminAbsenceSearchEl
    ? adminAbsenceSearchEl.value.trim().toLowerCase()
    : '';

  adminAbsenceListEl.innerHTML = 'Lade…';
  adminKontenGridEl.innerHTML = 'Lade…';

  try {
    const [absRes, kontRes] = await Promise.all([
      authFetch(`/api/admin/absences?status=${encodeURIComponent(status)}`),
      authFetch('/api/admin/konten'),
    ]);

    const absData = await absRes.json();
    const kontData = await kontRes.json();

    if (!absRes.ok || !absData.ok)
      throw new Error(absData.error || 'Absenzen konnten nicht geladen werden');
    if (!kontRes.ok || !kontData.ok)
      throw new Error(kontData.error || 'Konten konnten nicht geladen werden');

    let absences = Array.isArray(absData.absences) ? absData.absences : [];
    if (adminActiveTeamFilterAbsences) {
      absences = absences.filter(
        (a) => a.teamId === adminActiveTeamFilterAbsences
      );
    }
    if (search) {
      absences = absences.filter((a) => {
        const hay =
          `${a.username || ''} ${a.type || ''} ${a.comment || ''}`.toLowerCase();
        return hay.includes(search);
      });
    }

    renderAdminAbsenceList(absences);
    const kontenUsers = Array.isArray(kontData.users) ? kontData.users : [];
    renderAdminKontenGrid(
      adminActiveTeamFilterAbsences
        ? kontenUsers.filter((u) => u.teamId === adminActiveTeamFilterAbsences)
        : kontenUsers
    );
  } catch (e) {
    console.error(e);
    adminAbsenceListEl.innerHTML = `<div class="admin-error">${e.message || 'Fehler'}</div>`;
    adminKontenGridEl.innerHTML = `<div class="admin-error">${e.message || 'Fehler'}</div>`;
  }
}

function renderAdminAbsenceList(absences) {
  adminAbsenceListEl.innerHTML = '';

  if (!absences.length) {
    adminAbsenceListEl.innerHTML =
      '<div class="admin-empty">Keine Einträge.</div>';
    return;
  }

  const formatDaysValue = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? String(n).replace('.', ',') : '–';
  };

  const statusText = {
    pending: 'Offen',
    accepted: 'Akzeptiert',
    rejected: 'Abgelehnt',
    cancel_requested: 'Storno angefragt',
    cancelled: 'Storniert',
  };

  absences.forEach((a) => {
    const item = document.createElement('div');
    item.className = 'admin-absence-item';

    const top = document.createElement('div');
    top.className = 'admin-absence-top';

    const title = document.createElement('div');
    title.className = 'admin-absence-title';
    title.textContent = `${a.username || '–'} · ${absenceTypeLabel(a.type)}`;

    const badge = document.createElement('span');
    badge.className = `absence-status-badge ${a.status}`;
    badge.textContent =
      statusText[String(a.status || '').toLowerCase()] || 'Offen';

    top.appendChild(title);
    top.appendChild(badge);

    const meta = document.createElement('div');
    meta.className = 'admin-absence-meta';

    const rangeRow = document.createElement('div');
    const fromLabel = formatDateDisplayEU(a.from);
    const toLabel = formatDateDisplayEU(a.to);

    rangeRow.textContent = `Zeitraum: ${fromLabel} → ${toLabel}`;

    const currentYear =
      Number(String(a.from || '').slice(0, 4)) || new Date().getFullYear();

    const displayDays = computeAbsenceDaysForYear(a, currentYear);

    const daysRow = document.createElement('div');
    daysRow.textContent = `Tage: ${String(displayDays).replace('.', ',')}`;

    meta.appendChild(rangeRow);
    meta.appendChild(daysRow);

    const comment = document.createElement('div');
    comment.className = 'admin-absence-comment';
    comment.textContent = a.comment
      ? `Kommentar: ${a.comment}`
      : 'Kommentar: –';

    item.appendChild(top);
    item.appendChild(meta);
    item.appendChild(comment);

    if (a.status === 'pending') {
      const actions = document.createElement('div');
      actions.className = 'admin-absence-actions';

      const acceptBtn = document.createElement('button');
      acceptBtn.type = 'button';
      acceptBtn.className = 'admin-absence-accept';
      acceptBtn.textContent = 'Akzeptieren';
      acceptBtn.dataset.username = a.username;
      acceptBtn.dataset.absenceId = a.id;

      const rejectBtn = document.createElement('button');
      rejectBtn.type = 'button';
      rejectBtn.className = 'admin-absence-reject';
      rejectBtn.textContent = 'Ablehnen';
      rejectBtn.dataset.username = a.username;
      rejectBtn.dataset.absenceId = a.id;

      actions.appendChild(acceptBtn);
      actions.appendChild(rejectBtn);
      item.appendChild(actions);
    }

    if (a.status === 'cancel_requested') {
      const actions = document.createElement('div');
      actions.className = 'admin-absence-actions';

      const approveCancel = document.createElement('button');
      approveCancel.type = 'button';
      approveCancel.className = 'admin-absence-cancel-approve';
      approveCancel.textContent = 'Storno genehmigen';
      approveCancel.dataset.username = a.username;
      approveCancel.dataset.absenceId = a.id;

      const denyCancel = document.createElement('button');
      denyCancel.type = 'button';
      denyCancel.className = 'admin-absence-cancel-deny';
      denyCancel.textContent = 'Storno ablehnen';
      denyCancel.dataset.username = a.username;
      denyCancel.dataset.absenceId = a.id;

      actions.appendChild(approveCancel);
      actions.appendChild(denyCancel);
      item.appendChild(actions);
    }

    adminAbsenceListEl.appendChild(item);
  });
}

function renderAdminKontenGrid(rows) {
  if (!adminKontenGridEl) return;

  adminKontenGridEl.innerHTML = '';

  if (!Array.isArray(rows) || rows.length === 0) {
    adminKontenGridEl.innerHTML = `<div class="admin-empty">Keine Konten-Daten.</div>`;
    return;
  }

  const toNum = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  // Use the same year context as the admin month navigation (so the admin can switch month/year)
  const { year: selectedYear } = getCurrentAdminMonthInfo();
  const yearCfg = getYearConfig(selectedYear);
  const vorarbeitRequired = Math.max(0, toNum(yearCfg?.vorarbeitRequired, 0));

  rows.forEach(({ username, konto }) => {
    const rawUeZ1 = toNum(konto?.ueZ1, 0);

    // Backend already maintains this field per user for Vorarbeit logic:
    // vorarbeitBalance wird direkt beim Transmit korrekt berechnet und gespeichert
    const vorarbeitFilled = Math.min(
      vorarbeitRequired,
      Math.max(0, toNum(konto?.vorarbeitBalance, 0))
    );
    const ueZ1AfterVorarbeit = rawUeZ1; // konto.ueZ1 ist bereits netto — Vorarbeit wurde beim Transmit nie darin eingerechnet

    const card = document.createElement('div');
    card.className = 'admin-konto-card';

    const ueZ1Corr = toNum(konto?.ueZ1Correction, 0);
    const ueZ2Corr = toNum(konto?.ueZ2Correction, 0);
    const ueZ3Corr = toNum(konto?.ueZ3Correction, 0);
    const ueZ1Display = formatHoursSigned(rawUeZ1 + ueZ1Corr);
    const ueZ2Display = formatHoursSigned(toNum(konto?.ueZ2, 0) + ueZ2Corr);
    const ueZ3Display = formatHoursSigned(toNum(konto?.ueZ3, 0) + ueZ3Corr);
    const vacBalance = toNum(konto?.vacationDays, 0);
    const vacPerYear = toNum(konto?.vacationDaysPerYear, 21);
    const vorarbeitBalance = toNum(konto?.vorarbeitBalance, 0);

    card.innerHTML = `
      <div class="admin-konto-header">
        <div class="admin-konto-user">${escapeHtml(username)}</div>
      </div>

      <div class="admin-konto-metrics">
        <div class="admin-konto-metric-row">
          <div class="admin-konto-metric-label">ÜZ1 Saldo</div>
          <div class="admin-konto-metric-value">${ueZ1Display}</div>
        </div>
        <div class="admin-konto-metric-row">
          <div class="admin-konto-metric-label">ÜZ2 Saldo</div>
          <div class="admin-konto-metric-value">${ueZ2Display}</div>
        </div>
        <div class="admin-konto-metric-row">
          <div class="admin-konto-metric-label">ÜZ3 Saldo</div>
          <div class="admin-konto-metric-value">${ueZ3Display}</div>
        </div>
        <div class="admin-konto-metric-row">
          <div class="admin-konto-metric-label">Vorarbeit (${selectedYear})</div>
          <div class="admin-konto-metric-value">${formatHours(vorarbeitBalance)} / ${formatHours(vorarbeitRequired)}</div>
        </div>
        <div class="admin-konto-metric-row">
          <div class="admin-konto-metric-label">Ferien-Guthaben</div>
          <div class="admin-konto-metric-value">${formatDays(vacBalance)} / ${formatDays(vacPerYear)} Tage</div>
        </div>
      </div>

      <div class="admin-konto-divider"></div>

      <div class="admin-konto-edit-title">Bearbeitung</div>

      <div class="admin-konto-grid">
        <label>ÜZ1 Anpassung
          <input class="admin-konto-input" data-field="ueZ1Correction" type="number" step="0.1" value="0" placeholder="z.B. -10.0">
        </label>
        <label>ÜZ2 Anpassung
          <input class="admin-konto-input" data-field="ueZ2Correction" type="number" step="0.1" value="0" placeholder="z.B. -5.0">
        </label>
        <label>ÜZ3 Anpassung
          <input class="admin-konto-input" data-field="ueZ3Correction" type="number" step="0.1" value="0" placeholder="z.B. -2.0">
        </label>
        <label>Ferien-Guthaben
          <input class="admin-konto-input" data-field="vacationDays" type="number" step="0.25" value="${vacBalance}">
        </label>
        <label>Ferien/Jahr
          <input class="admin-konto-input" data-field="vacationDaysPerYear" type="number" step="1" value="${vacPerYear}">
        </label>
      </div>

      <label class="admin-konto-reason-label">Grund (optional)
        <input class="admin-konto-reason" type="text" placeholder="z.B. ÜZ-Auszahlung Januar 2026">
      </label>

      <div class="admin-konto-actions">
        <button type="button" class="admin-konto-save" data-username="${username}">Speichern</button>
      </div>

      <details class="admin-konto-history">
        <summary class="admin-konto-history-summary" data-username="${username}">Verlauf</summary>
        <div class="admin-konto-history-body" data-history-username="${username}">
          <div class="admin-konto-history-loading">Wird geladen…</div>
        </div>
      </details>
    `;

    adminKontenGridEl.appendChild(card);
    card
      .querySelector('.admin-konto-history')
      ?.addEventListener('toggle', async (e) => {
        if (!e.target.open) return;
        const body = card.querySelector('.admin-konto-history-body');
        if (!body || body.dataset.loaded) return;
        body.dataset.loaded = 'true';
        try {
          const res = await authFetch(
            `/api/admin/konten/adjustments/${encodeURIComponent(username)}`
          );
          const data = await res.json();
          if (!data.ok) throw new Error(data.error);
          body.innerHTML = '';
          if (!data.adjustments.length) {
            body.innerHTML =
              '<div class="admin-konto-history-empty">Keine Änderungen.</div>';
            return;
          }
          const fieldLabels = {
            ueZ1Correction: 'ÜZ1 Anpassung',
            ueZ2Correction: 'ÜZ2 Anpassung',
            ueZ3Correction: 'ÜZ3 Anpassung',
            vacationDays: 'Ferien-Guthaben',
            vacationDaysPerYear: 'Ferien/Jahr',
          };
          data.adjustments.forEach((a) => {
            const row = document.createElement('div');
            row.className = 'admin-konto-history-row';
            const date = new Date(a.created_at).toLocaleString('de-CH', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            const label = fieldLabels[a.field] || a.field;
            const delta = a.new_value - a.old_value;
            const deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(1);
            row.innerHTML = `
            <div class="admin-konto-history-date">${date}</div>
            <div class="admin-konto-history-field">${label}</div>
            <div class="admin-konto-history-delta ${delta >= 0 ? 'positive' : 'negative'}">${deltaStr}</div>
            <div class="admin-konto-history-who">${escapeHtml(a.admin_username)}</div>
            ${a.reason ? `<div class="admin-konto-history-reason">${escapeHtml(a.reason)}</div>` : ''}
          `;
            body.appendChild(row);
          });
        } catch (err) {
          body.innerHTML = `<div class="admin-konto-history-empty">Fehler: ${err.message}</div>`;
        }
      });
  });
}

/**
 * Absence helpers and yearly vacation calculations
 */

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

    // 2) Tagesbezogene Stunden (Schulung / Sitzung/Kurs / Transport)
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

    // --- Option C: Ferienanteil = 1 - Stunden/8, keine Minusstunden --- //
    let fraction = 1 - hoursWorked / DAILY_SOLL;

    // Untergrenze 0 (wenn > 8h gearbeitet wurde, keine Ferien)
    if (fraction < 0) fraction = 0;

    // Auf Viertel-Tage runden (0.25, 0.5, 0.75, 1.0, ...)
    fraction = Math.round(fraction * 4) / 4;

    totalDays += fraction;
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

    const typeLabel = absenceTypeLabel(req.type);

    titleSpan.textContent = `${typeLabel} · ${fromStr} – ${toStr} (${daysText} Tage)`;

    const meta = document.createElement('div');
    meta.className = 'absence-meta';
    meta.textContent = req.comment
      ? `Kommentar: ${req.comment}`
      : 'Kein Kommentar';

    header.appendChild(titleSpan);

    const statusRow = document.createElement('div');
    statusRow.className = 'absence-status-row';

    const badge = document.createElement('span');
    badge.className = 'absence-status-badge';

    const st = String(req.status || 'pending').toLowerCase();
    badge.classList.add(st);
    badge.textContent =
      st === 'accepted'
        ? 'Akzeptiert'
        : st === 'rejected'
          ? 'Abgelehnt'
          : st === 'cancel_requested'
            ? 'Storno angefragt'
            : st === 'cancelled'
              ? 'Storniert'
              : 'Offen';

    statusRow.appendChild(badge);

    // Actions:
    // pending  -> user can delete (stornieren)
    // accepted -> user can request cancellation (storno anfragen)
    if (st === 'pending') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'absence-cancel-btn';
      btn.textContent = 'Stornieren';
      statusRow.appendChild(btn);
    }

    if (st === 'accepted') {
      const btn = document.createElement('button');
      btn.type = 'button';
      if (req.type === 'krank') {
        btn.className = 'absence-delete-direct-btn';
        btn.textContent = 'Löschen';
      } else {
        btn.className = 'absence-cancel-btn';
        btn.textContent = 'Storno anfragen';
      }
      statusRow.appendChild(btn);
    }

    // IMPORTANT: do NOT append deleteBtn outside the if-block
    meta.appendChild(statusRow);
    container.appendChild(header);
    container.appendChild(meta);
    absenceListEl.appendChild(container);
  });
}

// Setzt Ferien-Flags basierend auf akzeptierten Ferien-Anträgen
function syncVacationFlagsFromAbsences() {
  // 1) Alle ferien flags zurücksetzen
  Object.values(dayStore).forEach((dayData) => {
    if (!dayData.flags) {
      dayData.flags = {};
    }
    dayData.flags.ferien = false;
  });

  // 2) Für jede akzeptierte Ferien-Absenz die passenden Tage markieren
  absenceRequests.forEach((request) => {
    const type = (request.type || '').toLowerCase();
    if (type !== 'ferien') return;

    const st = String(request.status || '').toLowerCase();
    if (!(st === 'accepted' || st === 'cancel_requested')) return;

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
        dayData.flags.ferien = true;
      }

      cursor.setDate(cursor.getDate() + 1);
    }
  });

  saveToStorage();
}

/**
 * Recompute all dashboard totals and cards for the currently selected month.
 */
function updateDashboardForCurrentMonth() {
  const info = getCurrentDashboardMonthInfo();

  if (dashboardMonthLabelEl) {
    const text = info.label.charAt(0).toUpperCase() + info.label.slice(1);
    dashboardMonthLabelEl.textContent = text;
  }

  let totalStampHours = 0;
  let totalPikett = 0;
  let totalOvertime3 = 0;

  // 1) Präsenzstunden aus Stempelungen
  Object.entries(dayStore).forEach(([dateKey, dayData]) => {
    const d = new Date(dateKey);
    if (Number.isNaN(d.getTime())) return;
    if (d.getFullYear() !== info.year || d.getMonth() !== info.monthIndex)
      return;

    if (Array.isArray(dayData.stamps) && dayData.stamps.length > 0) {
      totalStampHours += computeNetWorkingHoursFromStamps(dayData.stamps);
    }
  });

  // 2) Pikett und Wochenendarbeit
  pikettStore.forEach((entry) => {
    if (!entry.date) return;
    const d = new Date(entry.date);
    if (Number.isNaN(d.getTime())) return;
    if (d.getFullYear() !== info.year || d.getMonth() !== info.monthIndex)
      return;

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

  const totalAll = totalStampHours + totalPikett + totalOvertime3;

  if (dashTotalStampHoursEl) {
    dashTotalStampHoursEl.textContent =
      totalStampHours.toFixed(1).replace('.', ',') + ' h';
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
    dashTotalHoursEl.textContent = totalAll.toFixed(1).replace('.', ',') + ' h';
  }

  updateDashboardWeekListForCurrentMonth();
}

function updateSyncStatus(transmissions) {
  if (!syncStatusEl || !syncLabelEl) return;

  // Reset base class
  syncStatusEl.className = 'sync-chip';

  if (!Array.isArray(transmissions) || transmissions.length === 0) {
    syncLabelEl.textContent = 'Nie gesendet';
    syncStatusEl.classList.add('sync-age-unknown');
    syncStatusEl.title = 'Noch keine Übertragung zum Server.';
    return;
  }

  // Find the newest transmission by sentAt
  const latest = transmissions.reduce((best, tx) => {
    if (!tx.sentAt) return best;

    const d = new Date(tx.sentAt);
    if (Number.isNaN(d.getTime())) return best;

    if (!best) return { tx, date: d };
    return d > best.date ? { tx, date: d } : best;
  }, null);

  if (!latest) {
    syncLabelEl.textContent = 'Nie gesendet';
    syncStatusEl.classList.add('sync-age-unknown');
    syncStatusEl.title = 'Noch keine Übertragung zum Server.';
    return;
  }

  const { date } = latest;
  const now = new Date();
  const diffMs = now - date;
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  // Show last sync time in the label
  syncLabelEl.textContent = date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Age → color & tooltip
  if (diffHours <= 24) {
    syncStatusEl.classList.add('sync-age-ok');
    syncStatusEl.title =
      'Daten sind aktuell (Übertragung innerhalb der letzten 24 Stunden).';
  } else if (diffDays <= 7) {
    syncStatusEl.classList.add('sync-age-warn');
    syncStatusEl.title = 'Daten sind leicht veraltet (älter als 1 Tag).';
  } else {
    syncStatusEl.classList.add('sync-age-bad');
    syncStatusEl.title =
      'Daten sind veraltet (länger als eine Woche keine Übertragung).';
  }
}

function loadSyncStatus() {
  if (!syncStatusEl || !syncLabelEl) return;

  // Optional mini "loading" state
  syncLabelEl.textContent = '…';
  syncStatusEl.className = 'sync-chip sync-age-unknown';
  syncStatusEl.title = 'Lade Server-Status…';

  authFetch('/api/transmissions')
    .then((res) => {
      if (!res.ok) {
        throw new Error('Serverfehler');
      }
      return res.json();
    })
    .then((data) => {
      if (!data.ok) {
        throw new Error(data.error || 'Fehler beim Laden der Übertragungen');
      }
      updateSyncStatus(data.transmissions || []);
    })
    .catch((err) => {
      console.error('Failed to load sync status', err);
      syncLabelEl.textContent = 'Unbekannt';
      syncStatusEl.className = 'sync-chip sync-age-unknown';
      syncStatusEl.title = 'Server-Status konnte nicht geladen werden.';
    });
}

async function syncMyAbsencesFromServer() {
  try {
    const res = await authFetch('/api/absences');
    if (!res.ok) throw new Error('Absenzen konnten nicht geladen werden');

    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || 'Absenzen konnten nicht geladen werden');
    }

    absenceRequests = Array.isArray(data.absences) ? data.absences : [];
    saveAbsenceRequests();

    // Render the list immediately from the freshly synced server data
    renderAbsenceListForCurrentYear();

    // Keep the rest of the dashboard in sync too
    await updateOvertimeYearCard();
    updateDashboardWeekListForCurrentMonth();
  } catch (e) {
    console.error(e);
  }
}

/**
 * Load and render the server-side overtime and Vorarbeit yearly summary for the current user.
 */
async function updateOvertimeYearCard() {
  if (
    !overtimeYearUeZ1El ||
    !overtimeYearUeZ2El ||
    !overtimeYearUeZ3El ||
    !overtimeYearVorarbeitEl
  ) {
    return;
  }

  // Keep existing side effect:
  // accepted vacation absences still sync local "ferien" flags
  syncVacationFlagsFromAbsences();

  const { year: selectedYear } = getCurrentDashboardMonthInfo();

  if (overtimeYearSourceEl) {
    overtimeYearSourceEl.classList.remove('is-error');
    overtimeYearSourceEl.textContent = 'Lade offiziellen Stand …';
  }

  try {
    const serverData = await loadMyKontoFromServer();
    const konto = serverData?.konto;

    if (!konto) {
      throw new Error('NO_KONTO_DATA');
    }

    const cfgSelected = getYearConfig(selectedYear) || {};
    const vorarbeitRequired = Number(cfgSelected.vorarbeitRequired) || 0;
    // vacationDaysPerYear kommt vom Server-Konto, nicht aus der lokalen Config
    const vacationDaysPerYear =
      Number(konto.vacationDaysPerYear) ||
      Number(cfgSelected.vacationDaysPerYear) ||
      21;

    const officialUeZ1Raw =
      (Number(konto.ueZ1) || 0) + (Number(konto.ueZ1Correction) || 0);
    const officialUeZ2 =
      (Number(konto.ueZ2) || 0) + (Number(konto.ueZ2Correction) || 0);
    const officialUeZ3 =
      (Number(konto.ueZ3) || 0) + (Number(konto.ueZ3Correction) || 0);
    const officialVacationDays = Number(konto.vacationDays) || 0;

    const vorarbeitFilled = Number(konto.vorarbeitBalance) || 0;
    const officialUeZ1AfterVorarbeit = officialUeZ1Raw; // ÜZ1 ist bereits nach Vorarbeit

    overtimeYearUeZ1El.textContent = formatHoursSigned(
      officialUeZ1AfterVorarbeit
    );
    overtimeYearUeZ2El.textContent = formatHours(officialUeZ2);
    overtimeYearUeZ3El.textContent = formatHours(officialUeZ3);
    overtimeYearVorarbeitEl.textContent = `${formatHours(vorarbeitFilled)} / ${formatHours(vorarbeitRequired)}`;

    if (vacationYearSummaryEl) {
      vacationYearSummaryEl.textContent = `${formatDays(officialVacationDays)} / ${formatDays(vacationDaysPerYear)} Tage`;
    }

    if (overtimeYearSourceEl) {
      const updatedAt = konto.updatedAt ? new Date(konto.updatedAt) : null;

      if (updatedAt && !Number.isNaN(updatedAt.getTime())) {
        overtimeYearSourceEl.textContent =
          `Offizieller Stand nach letzter Übertragung: ` +
          updatedAt.toLocaleString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
      } else {
        overtimeYearSourceEl.textContent =
          'Offizieller Stand nach letzter Übertragung';
      }
    }
  } catch (err) {
    console.error('Failed to load official overtime card:', err);

    overtimeYearUeZ1El.textContent = '–';
    overtimeYearUeZ2El.textContent = '–';
    overtimeYearUeZ3El.textContent = '–';
    overtimeYearVorarbeitEl.textContent = '–';

    if (vacationYearSummaryEl) {
      vacationYearSummaryEl.textContent = '– / – Tage';
    }

    if (overtimeYearSourceEl) {
      overtimeYearSourceEl.classList.add('is-error');
      overtimeYearSourceEl.textContent =
        'Offizieller Stand konnte nicht geladen werden.';
    }
  }
}

/**
 * Baut die KW-Übersicht für den aktuell gewählten Dashboard-Monat.
 * Zeigt pro KW:
 *  - Datumsbereich, Anzahl Arbeitstage im Monat
 *  - ob alle Mo–Fr im Monat erfasst sind
 *  - Total Stunden (Kom + Tagesstunden + Pikett) in diesem Monat
 */
function computeNetWorkingHoursFromStamps(stamps) {
  if (!Array.isArray(stamps) || stamps.length === 0) return 0;
  let totalMinutes = 0;
  let lastIn = null;
  const sorted = [...stamps].sort((a, b) => a.time.localeCompare(b.time));
  for (const s of sorted) {
    if (!/^\d{2}:\d{2}$/.test(s.time || '')) continue;
    const [hh, mm] = s.time.split(':').map(Number);
    const minutes = hh * 60 + mm;
    if (s.type === 'in') lastIn = minutes;
    else if (s.type === 'out' && lastIn !== null) {
      const diff = minutes - lastIn;
      if (diff > 0) totalMinutes += diff;
      lastIn = null;
    }
  }
  return Math.round((totalMinutes / 60) * 100) / 100;
}

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
  // 2) Stempelungen aus dayStore
  Object.entries(dayStore).forEach(([dateKey, dayData]) => {
    const d = new Date(dateKey);
    if (Number.isNaN(d.getTime())) return;
    if (d.getFullYear() !== year || d.getMonth() !== monthIndex) return;

    const { week, year: weekYear } = getISOWeekInfo(d);
    const weekKey = `${weekYear}-W${week}`;
    const w = weekMap[weekKey];
    if (!w) return;

    const flags = dayData.flags || {};
    const isFerien = !!flags.ferien;

    const stampHours =
      Array.isArray(dayData.stamps) && dayData.stamps.length > 0
        ? computeNetWorkingHoursFromStamps(dayData.stamps)
        : 0;

    const hasData = stampHours > 0 || isFerien;

    const dayInfo = w.days[dateKey];
    if (!dayInfo) return;

    dayInfo.hours += stampHours;
    if (hasData) dayInfo.hasData = true;

    w.totalHours += stampHours;
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
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()))
      return;

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
    row.className = 'week-row';

    // Header
    const header = document.createElement('div');
    header.className = 'week-row-header';

    // Zeile 1: KW + Badge + Stunden + Chevron
    const topRow = document.createElement('div');
    topRow.className = 'week-row-top';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'week-label';
    labelSpan.textContent = `KW ${w.week}`;

    const fromStr = w.minDate ? formatShortDate(w.minDate) : '';
    const toStr = w.maxDate ? formatShortDate(w.maxDate) : '';
    const workDaysInMonth = Object.values(w.days).filter(
      (di) => di.weekday >= 1 && di.weekday <= 5
    ).length;

    // Zeile 2: Datum
    const datesSpan = document.createElement('span');
    datesSpan.className = 'week-dates';
    datesSpan.textContent = `${fromStr}\u00A0–\u00A0${toStr}\u00A0(${workDaysInMonth}d)`;
    const expectedDates = Object.entries(w.days)
      .filter(([, di]) => di.weekday >= 1 && di.weekday <= 5)
      .map(([dateKey]) => dateKey);

    let missingCount = 0;
    expectedDates.forEach((dateKey) => {
      const di = w.days[dateKey];
      if (!di || !di.hasData) missingCount += 1;
    });

    const statusBadge = document.createElement('div');
    if (expectedDates.length === 0) {
      statusBadge.className = 'week-status-badge status-weekend';
      statusBadge.innerHTML = `<svg class="week-status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>Wochenende`;
    } else if (missingCount === 0) {
      statusBadge.className = 'week-status-badge status-ok';
      statusBadge.innerHTML = `<svg class="week-status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Erfasst`;
    } else {
      statusBadge.className = 'week-status-badge status-missing';
      statusBadge.innerHTML = `<svg class="week-status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${missingCount} fehlend`;
    }

    const totalSpan = document.createElement('span');
    totalSpan.className = 'week-total';
    totalSpan.textContent = w.totalHours.toFixed(1).replace('.', ',') + ' h';

    const chevron = document.createElement('span');
    chevron.className = 'week-chevron';
    chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

    topRow.appendChild(labelSpan);
    topRow.appendChild(statusBadge);
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    topRow.appendChild(spacer);
    topRow.appendChild(totalSpan);
    topRow.appendChild(chevron);
    topRow.appendChild(totalSpan);
    topRow.appendChild(chevron);

    header.appendChild(topRow);
    header.appendChild(datesSpan);

    // Tagesdetails
    const daysEl = document.createElement('div');
    daysEl.className = 'week-days';

    const DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

    Object.entries(w.days)
      .filter(([, di]) => di.weekday >= 1 && di.weekday <= 5)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([dateKey, di]) => {
        const dayRow = document.createElement('div');
        dayRow.className = 'day-row';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'day-name';
        nameSpan.textContent = DAY_NAMES[di.weekday];

        const dateSpan = document.createElement('span');
        dateSpan.className = 'day-date';
        const d = new Date(dateKey + 'T00:00:00');
        dateSpan.textContent = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;

        const hoursSpan = document.createElement('span');
        if (!di.hasData) {
          hoursSpan.className = 'day-hours missing';
          hoursSpan.textContent = '–';
        } else {
          hoursSpan.className = 'day-hours';
          hoursSpan.textContent = di.hours.toFixed(1).replace('.', ',') + ' h';
        }

        dayRow.appendChild(nameSpan);
        dayRow.appendChild(dateSpan);
        dayRow.appendChild(hoursSpan);
        daysEl.appendChild(dayRow);
      });

    // Toggle
    header.addEventListener('click', () => {
      daysEl.classList.toggle('open');
      chevron.classList.toggle('open');
    });

    row.appendChild(header);
    row.appendChild(daysEl);
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

/**
 * Generic helpers
 */

function updateStorageKeysForUser(user) {
  const name = user && user.username ? user.username : 'anon';
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_');

  STORAGE_KEY = `wochenplan-v1-${safe}`;
  PIKETT_STORAGE_KEY = `pikett-v1-${safe}`;
  ABSENCE_STORAGE_KEY = `absenceRequests-v1-${safe}`;
}
// Normalize Kom.Nummer: remove all whitespace (spaces, tabs, line breaks)
function normalizeKomNr(value) {
  if (!value) return '';
  return value.replace(/\s+/g, '');
}

/**
 * Date helpers for Wochenplan and dashboard timelines
 */

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getISOWeekInfo(date) {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
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
  let s = num.toFixed(2); // e.g. "2.25"
  s = s.replace('.', ','); // -> "2,25"
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

function formatFullDateSlash(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function updateDayTitleWithDate() {
  if (!titleEl) return;

  const activeBtn = document.querySelector(
    `.day-button[data-day="${currentDayId}"]`
  );
  const baseTitle = activeBtn
    ? activeBtn.dataset.title || ''
    : currentDayId.charAt(0).toUpperCase() + currentDayId.slice(1);

  const monday = getMondayForCurrentWeek();
  const offset = DAY_OFFSETS[currentDayId] ?? 0;
  const d = new Date(monday);
  d.setDate(monday.getDate() + offset);

  const dateStr = formatFullDateSlash(d);
  const dateKey = formatDateKey(d);
  const dayData = dayStore[dateKey] || {};

  const stampHours =
    Array.isArray(dayData.stamps) && dayData.stamps.length > 0
      ? computeNetWorkingHoursFromStamps(dayData.stamps)
      : null;

  let komHours = 0;
  const activeSection = document.querySelector('.day-content.active');
  if (activeSection) {
    activeSection
      .querySelectorAll('.hours-input, .day-hours-input, .special-hours-input')
      .forEach((input) => {
        const v = parseFloat(input.value.replace(',', '.'));
        if (!isNaN(v)) komHours += v;
      });
  }

  const stampStr =
    stampHours !== null ? stampHours.toFixed(1).replace('.', ',') + 'h' : '–';
  const komStr = komHours.toFixed(1).replace('.', ',') + 'h';

  titleEl.innerHTML = `
    <span class="day-title-text">${baseTitle}</span>
    <span class="day-title-date">${dateStr} · <span class="day-header-totals">${komStr} / ${stampStr}</span></span>
  `;
}

function showLogin() {
  document.body.classList.remove('admin-only');
  if (loginView) loginView.classList.remove('hidden');
  if (mainApp) mainApp.classList.add('hidden');
}

function showApp() {
  if (loginView) loginView.classList.add('hidden');
  if (mainApp) mainApp.classList.remove('hidden');
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

  // Sichtbares Ferien-Flag: OR aus beiden Quellen
  data.flags.ferien = !!data.flags.ferien;

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
      1: false,
      2: false,
      3: false,
    };
  }

  // Spezialbuchungen (Regie / Fehler)
  if (!Array.isArray(data.specialEntries)) {
    data.specialEntries = [];
  }

  // Stempel-Einträge
  if (!Array.isArray(data.stamps)) {
    data.stamps = [];
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
    type: 'regie', // "regie" oder "fehler"
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

/**
 * Weeklock loading for userpanel
 */
async function loadMyWeekLocks() {
  try {
    const res = await authFetch('/api/week-locks/me');
    const data = await res.json();
    if (data.ok) {
      myWeekLocks = data.locks || {};
      applyWeekLockUI();
    }
  } catch (err) {
    console.error('Failed to load week locks', err);
  }
}

function getISOWeekKey(date) {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

function isCurrentWeekLocked() {
  const monday = getMondayForCurrentWeek();
  const wk = getISOWeekKey(monday);
  return !!(myWeekLocks[wk] && myWeekLocks[wk].locked);
}

function isDateLocked(dateKey) {
  if (!dateKey) return false;
  const d = new Date(dateKey + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return false;
  const wk = getISOWeekKey(d);
  return !!(myWeekLocks[wk] && myWeekLocks[wk].locked);
}

function applyWeekLockUI() {
  const locked = isCurrentWeekLocked();

  // Inputs in day-content deaktivieren
  document
    .querySelectorAll(
      '.day-content input, .day-content select, .day-content textarea, .day-content button:not(.week-arrow):not(.top-nav-tab):not(.day-button)'
    )
    .forEach((el) => {
      el.disabled = locked;
    });

  // Overlay nur auf jeder day-content Section
  document.querySelectorAll('.day-content').forEach((section) => {
    section.classList.toggle('week-locked-overlay', locked);

    let overlay = section.querySelector('.week-lock-overlay-msg');
    if (locked) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'week-lock-overlay-msg';
        const msg = document.createElement('div');
        msg.className = 'week-lock-overlay-text';
        msg.textContent =
          'Diese Woche ist gesperrt — keine Änderungen möglich.';
        overlay.appendChild(msg);
        section.appendChild(overlay);
      }
    } else {
      if (overlay) overlay.remove();
    }
  });

  // Sidebar-Body visuell ausgegraut aber klickbar
  const sidebarBody = document.querySelector('.sidebar-body');
  if (sidebarBody) sidebarBody.style.opacity = locked ? '10' : '';

  // Alten Overlay/Banner entfernen
  const oldOverlay = document.getElementById('weekLockOverlay');
  if (oldOverlay) oldOverlay.remove();
  const indicator = document.getElementById('weekLockIndicator');
  if (indicator) indicator.classList.remove('visible');
  const oldBanner = document.getElementById('weekLockBanner');
  if (oldBanner) oldBanner.remove();
  // Dynamisch gerenderte Kom-Inputs auch sperren
  if (locked) {
    document
      .querySelectorAll(
        '.day-content.active .kom-input, .day-content.active .hours-input, .day-content.active .kom-remove-btn'
      )
      .forEach((el) => {
        el.disabled = true;
      });
  }
}
/**
 * Wochenplan header rendering / week label and day dates
 */

/**
 * Render the currently selected Wochenplan week header and visible weekday dates.
 */
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
    span.textContent = String(d.getDate()).padStart(2, '0');
  });
}

function switchToView(viewName) {
  const tab = document.querySelector(`.top-nav-tab[data-view="${viewName}"]`);
  if (tab) {
    tab.click();
  }
}

/**
 * Show or hide admin-only UI based on the authenticated user role.
 */
function updateUIForRole() {
  const user = getCurrentUser();

  document.body.classList.toggle(
    'admin-only',
    !!(user && user.role === 'admin')
  );

  if (user && user.role === 'admin') {
    // Admin: only show Admin tab
    document.querySelectorAll('.top-nav-tab').forEach((tab) => {
      const view = tab.dataset.view;
      if (view === 'admin') {
        tab.classList.remove('hidden');
        tab.classList.add('active');
      } else {
        tab.classList.add('hidden');
        tab.classList.remove('active');
      }
    });

    // Show only admin view
    document.querySelectorAll('.app-view').forEach((viewEl) => {
      if (viewEl.id === 'view-admin') {
        viewEl.classList.add('active');
      } else {
        viewEl.classList.remove('active');
      }
    });

    // Load admin data when switching to admin view
    loadAdminSummary();

    return;
  }

  // Normal user: hide admin tab, show all others
  if (adminTab) {
    adminTab.classList.add('hidden');
    adminTab.classList.remove('active');
  }

  document.querySelectorAll('.top-nav-tab').forEach((tab) => {
    const view = tab.dataset.view;
    if (view !== 'admin') {
      tab.classList.remove('hidden');
    }
  });

  // If we were in admin view somehow, go back to Wochenplan
  const currentActive = document.querySelector('.app-view.active');
  if (currentActive && currentActive.id === 'view-admin') {
    const firstTab = document.querySelector(
      '.top-nav-tab[data-view="wochenplan"]'
    );
    if (firstTab) {
      firstTab.click();
    }
  }
}

if (anlagenStatusSelect) {
  anlagenStatusSelect.addEventListener('change', () => {
    anlagenStatusFilter = anlagenStatusSelect.value || 'active';
    selectedKomNr = null; // re-select from list
    loadAdminAnlagenSummary({ force: true });
  });
}

if (anlagenSearchInput) {
  anlagenSearchInput.addEventListener(
    'input',
    debounce(() => {
      anlagenSearchTerm = anlagenSearchInput.value || '';
      // re-render from cache if possible
      const cacheKey = `${anlagenStatusFilter}`;
      const base = anlagenSummaryCache.get(cacheKey) || [];
      renderAnlagenList(base);
    }, 150)
  );
}

if (anlagenRefreshBtn) {
  anlagenRefreshBtn.addEventListener('click', () => {
    anlagenSummaryCache.clear();
    anlagenDetailCache.clear();
    selectedKomNr = null;
    loadAdminAnlagenSummary({ force: true });
  });
}

if (payrollRefreshBtn) {
  payrollRefreshBtn.addEventListener('click', () => {
    loadAdminPayroll();
  });
}

if (payrollPeriodFromEl) {
  payrollPeriodFromEl.addEventListener('change', () => {
    loadAdminPayroll();
  });
}

if (payrollPeriodToEl) {
  payrollPeriodToEl.addEventListener('change', () => {
    loadAdminPayroll();
  });
}

/**
 * Event wiring / delegated admin actions
 * Handles admin approval, konto save, payroll export, and similar button actions.
 */

document.addEventListener('click', async (event) => {
  const t = event.target;
  if (!t || !t.classList) return;

  if (
    t.classList.contains('admin-absence-accept') ||
    t.classList.contains('admin-absence-reject')
  ) {
    const username = t.dataset.username;
    const id = t.dataset.absenceId;
    const status = t.classList.contains('admin-absence-accept')
      ? 'accepted'
      : 'rejected';

    try {
      const res = await authFetch('/api/admin/absences/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, id, status }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok)
        throw new Error(data.error || 'Entscheid fehlgeschlagen');
      loadAdminPersonnel();
    } catch (e) {
      console.error(e);
      showToast(e.message || 'Fehler');
    }
  }

  if (t.classList.contains('admin-konto-save')) {
    const username = t.dataset.username;
    const card = t.closest('.admin-konto-card');
    if (!card) return;

    const inputs = card.querySelectorAll('.admin-konto-input');
    const body = { username };

    inputs.forEach((inp) => {
      const field = inp.dataset.field;
      body[field] = Number(inp.value);
    });
    const reasonEl = card.querySelector('.admin-konto-reason');
    if (reasonEl) body.reason = reasonEl.value.trim() || null;

    try {
      const res = await authFetch('/api/admin/konten/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok)
        throw new Error(data.error || 'Speichern fehlgeschlagen');
      loadAdminPersonnel();
    } catch (e) {
      console.error(e);
      showToast(e.message || 'Fehler');
    }
  }
  // Admin: approve or deny cancellation request
  if (
    t.classList.contains('admin-absence-cancel-approve') ||
    t.classList.contains('admin-absence-cancel-deny')
  ) {
    const username = t.dataset.username;
    const id = t.dataset.absenceId;
    const status = t.classList.contains('admin-absence-cancel-approve')
      ? 'cancelled'
      : 'accepted';

    try {
      const res = await authFetch('/api/admin/absences/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, id, status }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok)
        throw new Error(data.error || 'Entscheid fehlgeschlagen');

      // Show feedback if vacation days were restored
      if (data.vacationRestored > 0) {
        showToast(
          `Storno genehmigt. ${data.vacationRestored} Ferientag(e) wurden dem Konto von ${username} gutgeschrieben.`
        );
      }

      loadAdminPersonnel();
    } catch (e) {
      console.error(e);
      showToast(e.message || 'Fehler');
    }
  }
});

if (adminPersonnelRefreshBtn) {
  adminPersonnelRefreshBtn.addEventListener('click', () =>
    loadAdminPersonnel()
  );
}
if (adminAbsenceStatusFilterEl) {
  adminAbsenceStatusFilterEl.addEventListener('change', () =>
    loadAdminPersonnel()
  );
}
if (adminAbsenceSearchEl) {
  adminAbsenceSearchEl.addEventListener('input', () => loadAdminPersonnel());
}

const adminTeamFilterEl = document.getElementById('adminTeamFilter');
const adminTeamFilterAbsencesEl = document.getElementById(
  'adminTeamFilterAbsences'
);
const adminTeamFilterPayrollEl = document.getElementById(
  'adminTeamFilterPayroll'
);
let adminActiveTeamFilter = '';
let adminActiveTeamFilterAbsences = '';
let adminActiveTeamFilterPayroll = '';

if (adminTeamFilterEl)
  adminTeamFilterEl.addEventListener('change', (e) => {
    adminActiveTeamFilter = e.target.value;
    loadAdminSummary();
  });
if (adminTeamFilterAbsencesEl)
  adminTeamFilterAbsencesEl.addEventListener('change', (e) => {
    adminActiveTeamFilterAbsences = e.target.value;
    loadAdminPersonnel();
  });
if (adminTeamFilterPayrollEl)
  adminTeamFilterPayrollEl.addEventListener('change', (e) => {
    adminActiveTeamFilterPayroll = e.target.value;
    loadAdminPayroll();
  });
/**
 * Current-day total calculation
 */

function updateDayTotalFromInputs() {
  const activeSection = document.querySelector('.day-content.active');
  if (!activeSection) {
    if (dayTotalEl) dayTotalEl.textContent = '0,0 h';
    return;
  }

  let total = 0;

  activeSection.querySelectorAll('.hours-input').forEach((input) => {
    const asNumber = parseFloat(input.value.trim().replace(',', '.'));
    if (!Number.isNaN(asNumber)) total += asNumber;
  });
  activeSection.querySelectorAll('.day-hours-input').forEach((input) => {
    const asNumber = parseFloat(input.value.trim().replace(',', '.'));
    if (!Number.isNaN(asNumber)) total += asNumber;
  });
  activeSection.querySelectorAll('.special-hours-input').forEach((input) => {
    const asNumber = parseFloat(input.value.trim().replace(',', '.'));
    if (!Number.isNaN(asNumber)) total += asNumber;
  });

  const formatted = total.toFixed(1).replace('.', ',') + ' h';
  if (dayTotalEl) dayTotalEl.textContent = formatted; // schreibt nur wenn Element da
  updateDayTitleWithDate(); // läuft immer
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const username = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value;

    if (!username || !password) {
      if (loginErrorEl) {
        loginErrorEl.textContent = 'Bitte Benutzername und Passwort eingeben.';
        loginErrorEl.style.display = 'block';
      }
      return;
    }

    if (loginErrorEl) {
      loginErrorEl.textContent = '';
      loginErrorEl.style.display = 'none';
    }

    setLoginLoading(true);

    try {
      const res = await fetch(`${BACKEND_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const text = await res.text();
      let data = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Login-Antwort war kein JSON (${res.status})`);
      }

      if (!res.ok) {
        throw new Error(data?.error || `Login fehlgeschlagen (${res.status})`);
      }

      if (!data?.ok || !data?.token) {
        throw new Error(data?.error || 'Login fehlgeschlagen');
      }

      const user = data.user || { username };

      setAuthSession(data.token, user);
      updateUIForRole();
      reloadAllDataForCurrentUser();
      syncMyAbsencesFromServer();
      loadMyWeekLocks(); // NEU
      renderStampCard();

      if (userDisplayEl) {
        userDisplayEl.textContent = user.username || username;
      }

      loginPasswordInput.value = '';
      showApp();

      if (user.role === 'admin') {
        switchToView('admin');
      } else {
        switchToView('wochenplan');
      }

      loadSyncStatus();
    } catch (err) {
      console.error('Login error', err);

      if (loginErrorEl) {
        loginErrorEl.textContent = err.message || 'Login fehlgeschlagen.';
        loginErrorEl.style.display = 'block';
      }
    } finally {
      setLoginLoading(false);
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    clearAuthSession();
    _draftLoadComplete = false;
    if (userDisplayEl) {
      userDisplayEl.textContent = '–';
    }
    showLogin();
  });
}

/**
 * Restore the existing session if possible and bootstrap the main app view.
 */
function initAuthView() {
  const session = getAuthSession(); // { token, user }

  if (!session || !session.token) {
    showLogin();
    return;
  }

  // Show last known username immediately
  if (userDisplayEl && session.user && session.user.username) {
    userDisplayEl.textContent = session.user.username;
  }

  // Make sure role-based UI is applied from stored session
  updateUIForRole();

  // Load all local data for this user + render UI
  reloadAllDataForCurrentUser();
  syncMyAbsencesFromServer();
  loadMyWeekLocks(); // NEU
  renderStampCard();
  showApp();

  // Enforce default view based on stored role
  const user = getCurrentUser();
  if (user && user.role === 'admin') {
    switchToView('admin');
  } else {
    switchToView('wochenplan');
  }

  loadSyncStatus();

  // Optional: verify token against backend and refresh user info
  authFetch('/api/auth/me')
    .then((res) => {
      if (!res.ok) {
        throw new Error('Unauthorized');
      }
      return res.json();
    })
    .then((data) => {
      if (!data.ok || !data.user) {
        throw new Error('Invalid session');
      }

      const currentSession = getAuthSession();
      if (!currentSession || !currentSession.token) {
        throw new Error('No token in session anymore');
      }

      setAuthSession(currentSession.token, data.user);

      if (userDisplayEl) {
        userDisplayEl.textContent = data.user.username || 'Unbekannt';
      }

      // Role might have changed → re-apply UI
      updateUIForRole();
    })
    .catch((err) => {
      console.error('Auth check failed', err);
      clearAuthSession();
      showLogin();
    });
}

function getAdminSyncStatusInfo(lastSentAt) {
  // No transmission yet
  if (!lastSentAt) {
    return {
      className: 'sync-age-unknown',
      label: 'Nie gesendet',
      title: 'Noch keine Übertragung zum Server.',
    };
  }

  const date = new Date(lastSentAt);
  if (Number.isNaN(date.getTime())) {
    return {
      className: 'sync-age-unknown',
      label: 'Unbekannt',
      title: 'Letztes Übertragungsdatum ist ungültig.',
    };
  }

  const now = new Date();
  const diffMs = now - date;
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  const label = date.toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  let className;
  let statusText;

  if (diffHours <= 24) {
    className = 'sync-age-ok';
    statusText =
      'Daten sind aktuell (Übertragung innerhalb der letzten 24 Stunden).';
  } else if (diffDays <= 7) {
    className = 'sync-age-warn';
    statusText = 'Daten sind leicht veraltet (älter als 1 Tag).';
  } else {
    className = 'sync-age-bad';
    statusText =
      'Daten sind veraltet (länger als eine Woche keine Übertragung).';
  }

  return {
    className,
    label,
    title: `${statusText} Letzte Übertragung: ${label}`,
  };
}

function operationLabel(opKey) {
  if (!opKey) return '–';

  // split specials (adapt if your backend keys differ)
  if (opKey === '_specialRegie') return 'Spezial: Regie';
  if (opKey === '_specialFehler') return 'Spezial: Fehler';
  if (opKey === '_special') return 'Spezial';

  // normal options (option1..option6)
  const label = OPTION_LABELS[opKey];
  return label || opKey;
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Load the admin Anlagen summary list with the active filters and cache the result.
 */
function loadAdminAnlagenSummary({ force } = {}) {
  if (!adminAnlagenList || !adminAnlagenDetail) return;

  const cacheKey = `${anlagenStatusFilter}`;
  if (!force && anlagenSummaryCache.has(cacheKey)) {
    const cached = anlagenSummaryCache.get(cacheKey);
    renderAnlagenList(cached);
    return;
  }

  adminAnlagenList.innerHTML = `<div class="admin-day-drawer-loading">Lade Anlagen …</div>`;

  const anlagenTeamParam = adminActiveTeamFilter
    ? `&teamId=${encodeURIComponent(adminActiveTeamFilter)}`
    : '';
  authFetch(
    `/api/admin/anlagen-summary?status=${encodeURIComponent(anlagenStatusFilter)}${anlagenTeamParam}`
  )
    .then((res) => res.json())
    .then((data) => {
      if (!data.ok || !Array.isArray(data.anlagen)) {
        throw new Error(data.error || 'Ungültige Antwort');
      }
      anlagenSummaryCache.set(cacheKey, data.anlagen);
      renderAnlagenList(data.anlagen);
    })
    .catch((err) => {
      console.error(err);
      adminAnlagenList.innerHTML = `<div class="admin-day-drawer-error">Fehler: ${err.message || 'Unbekannt'}</div>`;
    });
}

function renderAnlagenList(anlagen) {
  if (!adminAnlagenList) return;

  const term = (anlagenSearchTerm || '').trim();
  const filtered = !term
    ? anlagen
    : anlagen.filter((a) => String(a.komNr || '').includes(term));

  if (filtered.length === 0) {
    adminAnlagenList.innerHTML = `<div style="padding:12px;opacity:.75;">Keine Anlagen gefunden.</div>`;
    // also clear detail if selection no longer visible
    if (adminAnlagenDetail) {
      adminAnlagenDetail.innerHTML = `<div class="anlagen-detail-empty">Wähle links eine Kommissionsnummer aus.</div>`;
    }
    selectedKomNr = null;
    return;
  }

  adminAnlagenList.innerHTML = '';

  filtered.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'anlagen-row';
    row.dataset.komnr = a.komNr;

    if (selectedKomNr && selectedKomNr === a.komNr)
      row.classList.add('is-selected');

    const kom = document.createElement('div');
    kom.className = 'anlagen-komnr';
    kom.textContent = a.komNr || '–';

    const meta = document.createElement('div');
    meta.className = 'anlagen-meta';

    const last = a.lastActivity ? formatShortDateFromKey(a.lastActivity) : '–';
    const topOp = a.topOperationKey ? operationLabel(a.topOperationKey) : '–';
    meta.textContent = `Top: ${topOp} · Letzte Aktivität: ${last}${a.archived ? ' · Archiviert' : ''}`;

    const hours = document.createElement('div');
    hours.className = 'anlagen-hours';
    hours.textContent = formatHours(Number(a.totalHours || 0));

    row.appendChild(kom);
    row.appendChild(hours);
    row.appendChild(meta);

    row.addEventListener('click', () => {
      selectedKomNr = a.komNr;
      // rerender to update selection highlight
      renderAnlagenList(anlagen);
      loadAdminAnlagenDetail(a.komNr, { force: false });
    });

    adminAnlagenList.appendChild(row);
  });

  // auto-select first if none selected
  if (!selectedKomNr) {
    selectedKomNr = filtered[0].komNr;
    loadAdminAnlagenDetail(selectedKomNr, { force: false });
    // highlight
    renderAnlagenList(anlagen);
  }
}

/**
 * Load and render one Anlagen detail record for the selected Kommissionsnummer.
 */
function loadAdminAnlagenDetail(komNr, { force } = {}) {
  if (!adminAnlagenDetail) return;
  if (!komNr) return;

  if (!force && anlagenDetailCache.has(komNr)) {
    renderAnlagenDetail(anlagenDetailCache.get(komNr));
    return;
  }

  adminAnlagenDetail.innerHTML = `<div class="admin-day-drawer-loading">Details werden geladen …</div>`;

  authFetch(`/api/admin/anlagen-detail?komNr=${encodeURIComponent(komNr)}`)
    .then((res) => res.json())
    .then((data) => {
      if (!data.ok) throw new Error(data.error || 'Fehler beim Laden');
      anlagenDetailCache.set(komNr, data);
      renderAnlagenDetail(data);
    })
    .catch((err) => {
      console.error(err);
      adminAnlagenDetail.innerHTML = `<div class="admin-day-drawer-error">Fehler: ${err.message || 'Unbekannt'}</div>`;
    });
}

function renderAnlagenDetail(data) {
  if (!adminAnlagenDetail) return;

  const komNr = data.komNr || '–';
  const total = Number(data.totalHours || 0);
  const last = data.lastActivity
    ? formatShortDateFromKey(data.lastActivity)
    : '–';
  const archived = !!data.archived;

  adminAnlagenDetail.innerHTML = '';

  // header
  const head = document.createElement('div');
  head.className = 'anlagen-detail-head';

  const left = document.createElement('div');

  const title = document.createElement('div');
  title.className = 'anlagen-detail-title';
  title.textContent = `Kom.-Nr. ${komNr}`;

  const sub = document.createElement('div');
  sub.className = 'anlagen-detail-sub';
  sub.textContent = `Total: ${formatHours(total)} · Letzte Aktivität: ${last}`;

  left.appendChild(title);
  left.appendChild(sub);

  // --- NEW: actions container (right side) ---
  const actions = document.createElement('div');
  actions.className = 'anlagen-detail-actions';

  // archive button (your existing logic)
  const archiveBtn = document.createElement('button');
  archiveBtn.type = 'button';
  archiveBtn.className = 'anlagen-archive-btn';
  archiveBtn.classList.toggle('is-archived', archived);
  archiveBtn.textContent = archived ? 'Archiviert (aktivieren)' : 'Archivieren';

  archiveBtn.addEventListener('click', () => {
    archiveBtn.disabled = true;

    authFetch('/api/admin/anlagen-archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        komNr,
        archived: !archived,
        // teamId optional: backend can default to admin team
      }),
    })
      .then((res) => res.json())
      .then((resp) => {
        if (!resp.ok)
          throw new Error(resp.error || 'Archivierung fehlgeschlagen');

        // clear caches so summary reflects new state
        anlagenSummaryCache.clear();
        anlagenDetailCache.delete(komNr);

        // reload summary + detail
        loadAdminAnlagenSummary({ force: true });
        loadAdminAnlagenDetail(komNr, { force: true });
      })
      .catch((err) => {
        console.error(err);
        showToast(err.message || 'Archivierung fehlgeschlagen');
      })
      .finally(() => {
        archiveBtn.disabled = false;
      });
  });

  // --- NEW: export button ---
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'anlagen-export-btn';
  exportBtn.textContent = 'Export PDF';

  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    const prevText = exportBtn.textContent;
    exportBtn.textContent = 'Export läuft…';

    try {
      // must exist from step 5.6
      await exportAnlagePdf(komNr);
    } catch (err) {
      console.error(err);
      showToast(err?.message || 'PDF Export fehlgeschlagen');
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = prevText;
    }
  });

  // assemble header
  actions.appendChild(archiveBtn);
  actions.appendChild(exportBtn);

  head.appendChild(left);
  head.appendChild(actions);
  adminAnlagenDetail.appendChild(head);

  // charts wrapper
  const charts = document.createElement('div');
  charts.className = 'anlagen-charts';

  // operations donut
  const opsCard = document.createElement('div');
  opsCard.className = 'anlagen-card';
  opsCard.innerHTML = `<h4>Stunden nach Tätigkeit</h4>`;
  opsCard.appendChild(buildOperationsDonut(data.operations || [], total));

  // users bars
  const usersCard = document.createElement('div');
  usersCard.className = 'anlagen-card';
  usersCard.innerHTML = `<h4>Stunden nach Benutzer</h4>`;
  usersCard.appendChild(buildUsersBars(data.users || []));

  charts.appendChild(opsCard);
  charts.appendChild(usersCard);
  adminAnlagenDetail.appendChild(charts);
}
async function exportAnlagePdf(komNr) {
  if (!komNr) throw new Error('Kom.-Nr fehlt');

  const user = getCurrentUser();
  const teamId = user?.teamId || '';

  // 1) Detail laden
  const detailRes = await authFetch(
    `/api/admin/anlagen-detail?komNr=${encodeURIComponent(komNr)}&teamId=${encodeURIComponent(teamId)}`
  );

  if (!detailRes.ok) {
    let msg = 'Detail konnte nicht geladen werden';
    try {
      const j = await detailRes.json();
      msg = j?.error || msg;
    } catch {}
    throw new Error(msg);
  }

  const detail = await detailRes.json();
  if (!detail.ok)
    throw new Error(detail.error || 'Detail konnte nicht geladen werden');

  // Build labels once for PDF (and charts) so everything is consistent
  const mappedOperations = (detail.operations || []).map((o) => ({
    ...o,
    label: operationLabel(o.key), // uses OPTION_LABELS + special buckets
  }));

  // Use a dedicated object so you don't accidentally mutate cached detail objects
  const detailForPdf = {
    ...detail,
    operations: mappedOperations,
  };

  // 2) Ledger (optional)
  let ledger = null;
  try {
    const ledgerRes = await authFetch(
      `/api/admin/anlagen-ledger?komNr=${encodeURIComponent(komNr)}&teamId=${encodeURIComponent(teamId)}`
    );
    if (ledgerRes.ok) {
      const ledgerJson = await ledgerRes.json();
      if (ledgerJson?.ok) ledger = ledgerJson;
    }
  } catch {
    ledger = null; // optional -> PDF Export soll trotzdem gehen
  }

  const donutSvg = buildDonutChartSvg(
    detailForPdf.operations || [],
    Number(detailForPdf.totalHours || 0),
    {
      title: `Kom.-Nr. ${komNr}`,
      width: 500, // ← Make it smaller and more square
      height: 500, // ← Square = no warp in PDF
    }
  );

  const usersSvg = buildUsersBarsSvg(detailForPdf.users || [], {
    title: '',
    width: 500, // ← Match donut chart width
    height: 500, // ← Make it taller (square)
  });

  const donutPngDataUrl = await svgToPngDataUrl(donutSvg, 1000, 1000);
  const usersPngDataUrl = await svgToPngDataUrl(usersSvg, 1000, 1000);

  // 4) PDF Export Request (WICHTIG: resp variable!)
  const resp = await authFetch('/api/admin/anlagen-export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      komNr,
      teamId,
      detail: detailForPdf,
      ledger,
      donutPngDataUrl,
      usersPngDataUrl,
    }),
  });

  if (!resp.ok) {
    let msg = 'Export fehlgeschlagen';
    try {
      const j = await resp.json();
      msg = j?.error || msg;
    } catch {}
    throw new Error(msg);
  }

  // 5) Download
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `Anlage_${komNr}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // revoke after a short delay (some browsers need a tick)
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- PDF export chart helpers (SVG -> PNG) ----------

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// You can swap these colors to match your UI.
// Keep it deterministic so PDF always looks the same.
function exportOpColor(opKey) {
  const map = {
    option1: '#4E79A7',
    option2: '#F28E2B',
    option3: '#E15759',
    option4: '#76B7B2',
    option5: '#59A14F',
    option6: '#EDC948',
    Regie: '#B07AA1',
    Fehler: '#FF9DA7',
    _special_regie: '#B07AA1',
    _special_fehler: '#FF9DA7',
    _special: '#9C755F',
  };
  return map[opKey] || '#9AA0A6';
}
function exportOpLabel(opKey) {
  // If you already have OPTION_LABELS in your file, reuse it safely:
  if (
    typeof OPTION_LABELS === 'object' &&
    OPTION_LABELS &&
    OPTION_LABELS[opKey]
  ) {
    return OPTION_LABELS[opKey];
  }

  const map = {
    option1: 'Montage',
    option2: 'Demontage',
    option3: 'Transport',
    option4: 'Inbetriebnahme',
    option5: 'Abnahme',
    option6: 'Werk',

    _regie: 'Regie',
    _fehler: 'Fehler',

    // legacy / fallback variants
    Regie: 'Regie',
    Fehler: 'Fehler',
    _special_regie: 'Regie',
    _special_fehler: 'Fehler',
    _special: 'Spezial',
  };

  return map[opKey] || opKey;
}

function buildDonutChartSvg(operations, totalHours, opts = {}) {
  const width = opts.width ?? 900;
  const height = opts.height ?? 420;

  const cx = 160;
  const cy = height / 2;
  const r = 110;
  const strokeW = 44;
  const circ = 2 * Math.PI * r;

  const total = Number(totalHours || 0);
  const items = Array.isArray(operations) ? operations : [];
  const normalized = items
    .map((it) => ({
      key: String(it?.key || '').trim(),
      label: String(it?.label || '').trim(), // NEW
      hours: Number(it?.hours || 0),
    }))
    .filter((it) => it.key && it.hours > 0);

  // Empty state (still render something so PDF layout stays consistent)
  if (total <= 0 || normalized.length === 0) {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
  <text x="40" y="60" font-family="Arial" font-size="22" fill="#111"></text>
  <text x="40" y="110" font-family="Arial" font-size="16" fill="#666">Keine Daten vorhanden</text>
</svg>`;
  }

  // Donut slices: stacked circles with dashoffset
  let offset = 0;
  const slices = normalized
    .map((it) => {
      const frac = it.hours / total;
      const len = frac * circ;
      const dash = `${len} ${circ - len}`;
      const dashOffset = -offset;
      offset += len;

      return `
<circle cx="${cx}" cy="${cy}" r="${r}"
  fill="none"
  stroke="${exportOpColor(it.key)}"
  stroke-width="${strokeW}"
  stroke-linecap="butt"
  stroke-dasharray="${dash}"
  stroke-dashoffset="${dashOffset}"
  transform="rotate(-90 ${cx} ${cy})"
/>`;
    })
    .join('');

  // Legend (right side)
  const legendX = cx + 135;
  let legendY = height / 2;
  const legend = normalized
    .map((it) => {
      const pct = (it.hours / total) * 100;
      const line = `
<rect x="${legendX}" y="${legendY - 14}" width="14" height="14" fill="${exportOpColor(it.key)}"/>
<text x="${legendX + 22}" y="${legendY - 2}" font-family="Arial" font-size="16" fill="#111">
 ${escapeXml(it.label || exportOpLabel(it.key))}: ... ${it.hours.toFixed(1).replace('.', ',')} h
</text>`;
      legendY += 26;
      return line;
    })
    .join('');

  const centerText = `
<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-family="Arial" font-size="16" fill="#666">Total</text>
<text x="${cx}" y="${cy + 22}" text-anchor="middle" font-family="Arial" font-size="28" fill="#111">
  ${total.toFixed(1).replace('.', ',')} h
</text>`;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
  <text x="40" y="60" font-family="Arial" font-size="22" fill="#111"></text>

  ${slices}
  ${centerText}

  ${legend}
</svg>`;
}

function buildUsersBarsSvg(users, opts = {}) {
  const width = opts.width ?? 900;
  const height = opts.height ?? 420;

  const items = (Array.isArray(users) ? users : [])
    .map((u) => ({
      username: String(u.username || ''),
      hours: Number(u.hours || 0),
    }))
    .filter((u) => u.username);

  if (items.length === 0) {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
  <text x="40" y="60" font-family="Arial" font-size="22" fill="#111"></text>
  <text x="40" y="110" font-family="Arial" font-size="16" fill="#666">Keine Daten vorhanden</text>
</svg>`;
  }

  const max = Math.max(...items.map((i) => i.hours), 0.1);

  // Layout
  const chartX = 60;
  const chartY = 90;
  const chartW = width - 120;
  const chartH = height - 150;

  const barGap = 10;
  const barCount = items.length;
  const barW = Math.max(10, (chartW - barGap * (barCount - 1)) / barCount);

  // Simple grid lines
  const gridLines = [0.25, 0.5, 0.75, 1]
    .map((p) => {
      const y = chartY + chartH - p * chartH;
      const val = (p * max).toFixed(1).replace('.', ',');
      return `
<line x1="${chartX}" y1="${y}" x2="${chartX + chartW}" y2="${y}" stroke="#E5E7EB" stroke-width="1"/>
<text x="${chartX - 10}" y="${y + 5}" text-anchor="end" font-family="Arial" font-size="12" fill="#666">${val}</text>`;
    })
    .join('');

  const bars = items
    .map((it, idx) => {
      const h = (it.hours / max) * chartH;
      const x = chartX + idx * (barW + barGap);
      const y = chartY + chartH - h;

      const label = escapeXml(it.username);
      const hoursLabel = it.hours.toFixed(1).replace('.', ',');

      return `
<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="#4E79A7"/>
<text x="${x + barW / 2}" y="${chartY + chartH + 18}" text-anchor="middle"
  font-family="Arial" font-size="16" fill="#111">${label}</text>
<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle"
  font-family="Arial" font-size="16" fill="#111">${hoursLabel}</text>`;
    })
    .join('');

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
  <text x="40" y="60" font-family="Arial" font-size="22" fill="#111">Stunden nach Benutzer</text>

  ${gridLines}
  ${bars}

  <line x1="${chartX}" y1="${chartY + chartH}" x2="${chartX + chartW}" y2="${chartY + chartH}" stroke="#111" stroke-width="1"/>
</svg>`;
}

async function svgToPngDataUrl(svgString, outW, outH) {
  // Ensure the SVG has a viewBox; otherwise browser may report 0x0 size
  // (If your SVG builder already sets viewBox + width/height, this is still fine.)
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.decoding = 'async';
  img.src = url;

  // Wait until the image is decoded
  if (img.decode) {
    await img.decode();
  } else {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
  }

  // Use natural size (important for SVG)
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;

  const ctx = canvas.getContext('2d');

  // White background (PDF-friendly)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);

  // Preserve aspect ratio: "contain" the source image inside the canvas
  const scale = Math.min(outW / srcW, outH / srcH);
  const drawW = Math.round(srcW * scale);
  const drawH = Math.round(srcH * scale);
  const dx = Math.round((outW - drawW) / 2);
  const dy = Math.round((outH - drawH) / 2);

  ctx.drawImage(img, dx, dy, drawW, drawH);

  URL.revokeObjectURL(url);
  return canvas.toDataURL('image/png');
}

function buildOperationsDonut(operations, totalHours) {
  const wrap = document.createElement('div');

  const ops = Array.isArray(operations)
    ? operations.filter((o) => Number(o.hours || 0) > 0)
    : [];
  const total =
    Number(totalHours || 0) ||
    ops.reduce((s, o) => s + Number(o.hours || 0), 0);

  if (!ops.length || total <= 0) {
    wrap.innerHTML = `<div style="opacity:.75;">Keine Daten.</div>`;
    return wrap;
  }

  const colors = ops.map((_, i) => {
    // stable, readable palette without dependencies
    const hue = (i * 47) % 360;
    return `hsl(${hue} 55% 55%)`;
  });

  let acc = 0;
  const stops = ops.map((o, i) => {
    const pct = (Number(o.hours) / total) * 100;
    const from = acc;
    const to = acc + pct;
    acc = to;
    return `${colors[i]} ${from}% ${to}%`;
  });

  const donut = document.createElement('div');
  donut.className = 'anlagen-donut';
  donut.style.background = `conic-gradient(${stops.join(',')})`;

  const legend = document.createElement('div');
  legend.className = 'anlagen-legend';

  ops.forEach((o, i) => {
    const item = document.createElement('div');
    item.className = 'anlagen-legend-item';

    const dot = document.createElement('div');
    dot.className = 'anlagen-legend-dot';
    dot.style.background = colors[i];

    const label = document.createElement('div');
    label.textContent = operationLabel(o.key);

    const val = document.createElement('div');
    val.textContent = formatHours(Number(o.hours || 0));

    item.appendChild(dot);
    item.appendChild(label);
    item.appendChild(val);
    legend.appendChild(item);
  });

  wrap.appendChild(donut);
  wrap.appendChild(legend);
  return wrap;
}

function buildUsersBars(users) {
  const wrap = document.createElement('div');

  const list = Array.isArray(users)
    ? users.filter((u) => Number(u.hours || 0) > 0)
    : [];
  if (!list.length) {
    wrap.innerHTML = `<div style="opacity:.75;">Keine Daten.</div>`;
    return wrap;
  }

  // limit to top 12 for readability (scales better)
  const top = list.slice(0, 12);
  const max = Math.max(...top.map((u) => Number(u.hours || 0)));

  const bars = document.createElement('div');
  bars.className = 'anlagen-bars';

  top.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'anlagen-bar-row';

    const name = document.createElement('div');
    name.textContent = u.username || '–';

    const hrs = document.createElement('div');
    hrs.textContent = formatHours(Number(u.hours || 0));

    const track = document.createElement('div');
    track.className = 'anlagen-bar-track';

    const fill = document.createElement('div');
    fill.className = 'anlagen-bar-fill';
    const pct = max > 0 ? (Number(u.hours || 0) / max) * 100 : 0;
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;

    track.appendChild(fill);

    row.appendChild(name);
    row.appendChild(hrs);
    row.appendChild(track);

    bars.appendChild(row);
  });

  wrap.appendChild(bars);
  return wrap;
}

function chartColorByIndex(i) {
  // stable color palette
  const hue = (i * 47) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

/**
 * Render the operations donut chart SVG into a PNG data URL for PDF export.
 */
function renderDonutChartToPng(operations, totalHours) {
  // operations: [{ key, hours }]
  const ops = Array.isArray(operations)
    ? operations.filter((o) => (Number(o.hours) || 0) > 0)
    : [];
  const total =
    Number(totalHours) || ops.reduce((s, o) => s + (Number(o.hours) || 0), 0);

  const W = 1100;
  const H = 520;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');

  // background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // title
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Stunden nach Tätigkeit', 40, 42);

  // donut geometry
  const cx = 260;
  const cy = 290;
  const rOuter = 160;
  const rInner = 92;

  // empty state
  if (!(total > 0) || ops.length === 0) {
    ctx.fillStyle = '#334155';
    ctx.font =
      '500 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText('Keine Stunden vorhanden.', 40, 80);
    return canvas.toDataURL('image/png');
  }

  // draw segments
  let start = -Math.PI / 2;
  ops.forEach((o, i) => {
    const h = Number(o.hours) || 0;
    const angle = (h / total) * Math.PI * 2;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rOuter, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = chartColorByIndex(i);
    ctx.fill();

    start += angle;
  });

  // punch hole
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // center label
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(formatHours(total), cx, cy + 8);

  // legend (right side)
  const lx = 520;
  let ly = 110;

  ctx.textAlign = 'left';
  ctx.font = '600 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillStyle = '#0f172a';
  ctx.fillText('Legende', lx, ly);
  ly += 18;

  ctx.font = '500 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

  ops.forEach((o, i) => {
    const label = operationLabel(o.key);
    const h = Number(o.hours) || 0;
    const pct = total > 0 ? Math.round((h / total) * 100) : 0;

    // color dot
    ctx.fillStyle = chartColorByIndex(i);
    ctx.beginPath();
    ctx.arc(lx + 8, ly + 8, 6, 0, Math.PI * 2);
    ctx.fill();

    // text
    ctx.fillStyle = '#0f172a';
    ctx.fillText(`${label}`, lx + 22, ly + 12);

    ctx.fillStyle = '#334155';
    ctx.fillText(`${formatHours(h)} · ${pct}%`, lx + 320, ly + 12);

    ly += 26;
    if (ly > H - 30) {
      // stop legend if it would overflow (optional)
      return;
    }
  });

  return canvas.toDataURL('image/png');
}

function renderUsersBarsToPng(users) {
  // users: [{ username, hours }]
  const list = Array.isArray(users)
    ? users.filter((u) => (Number(u.hours) || 0) > 0)
    : [];
  const max = list.reduce((m, u) => Math.max(m, Number(u.hours) || 0), 0);

  const W = 1100;
  const rowH = 34;
  const topPad = 80;
  const bottomPad = 30;
  const H = Math.max(260, topPad + list.length * rowH + bottomPad);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#0f172a';
  ctx.font = '700 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Stunden nach Mitarbeiter', 40, 42);

  if (!list.length || !(max > 0)) {
    ctx.fillStyle = '#334155';
    ctx.font =
      '500 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText('Keine Stunden vorhanden.', 40, 80);
    return canvas.toDataURL('image/png');
  }

  const nameX = 40;
  const barX = 260;
  const barW = 680;
  const valX = barX + barW + 18;

  ctx.font = '500 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

  list.forEach((u, i) => {
    const y = topPad + i * rowH;
    const h = Number(u.hours) || 0;
    const w = Math.round((h / max) * barW);

    // name
    ctx.fillStyle = '#0f172a';
    ctx.fillText(u.username || '–', nameX, y + 20);

    // track
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(barX, y + 6, barW, 16);

    // fill
    ctx.fillStyle = '#334155';
    ctx.fillRect(barX, y + 6, w, 16);

    // value
    ctx.fillStyle = '#0f172a';
    ctx.fillText(formatHours(h), valX, y + 20);
  });

  return canvas.toDataURL('image/png');
}

function loadAdminSummary() {
  if (!adminSummaryContainer) return;

  updateAdminMonthLabel();

  const info = getCurrentAdminMonthInfo();
  adminSummaryContainer.innerHTML = '<p>Übersicht wird geladen …</p>';

  authFetch(
    `/api/admin/month-overview?year=${info.year}&monthIndex=${info.monthIndex}`
  )
    .then((res) => {
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json();
    })
    .then((data) => {
      if (!data.ok || !Array.isArray(data.users)) {
        throw new Error(data.error || 'Ungültige Antwort vom Server');
      }

      adminSummaryContainer.innerHTML = '';

      // Only show real employees in overview
      const allUsers = data.users;
      const users = adminActiveTeamFilter
        ? allUsers.filter((u) => u.teamId === adminActiveTeamFilter)
        : allUsers;

      if (users.length === 0) {
        adminSummaryContainer.innerHTML = '<p>Keine Benutzer gefunden.</p>';
        return;
      }

      users.forEach((u) => {
        const card = document.createElement('div');
        card.className = 'admin-user-card';

        // --- Header: Name/Team (left) + Sync pill (right) ---
        const header = document.createElement('div');
        header.className = 'admin-user-header';

        const titleBlock = document.createElement('div');
        titleBlock.className = 'admin-user-title-block';

        const title = document.createElement('div');
        title.className = 'admin-user-title';
        title.textContent = u.username || 'Unbekannter Benutzer';

        const team = document.createElement('div');
        team.className = 'admin-user-team';
        team.textContent = u.teamName || 'kein Team';

        titleBlock.appendChild(title);
        titleBlock.appendChild(team);

        const syncInfo = getAdminSyncStatusInfo(u.lastSentAt);

        const pill = document.createElement('div');
        pill.className = `sync-chip admin-user-sync-chip ${syncInfo.className}`;
        pill.title = syncInfo.title;

        const dot = document.createElement('span');
        dot.className = 'sync-dot';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'sync-label';
        labelSpan.textContent = syncInfo.label;

        pill.appendChild(dot);
        pill.appendChild(labelSpan);

        header.appendChild(titleBlock);
        header.appendChild(pill);

        // --- Month micro-row (Monat + Total + transmitted badge) ---
        const monthRow = document.createElement('div');
        monthRow.className = 'admin-user-month-row';

        const monthLeft = document.createElement('div');
        monthLeft.textContent = `Monat: ${u.month?.monthLabel || info.label}`;

        const monthRight = document.createElement('div');
        monthRight.style.display = 'inline-flex';
        monthRight.style.alignItems = 'center';
        monthRight.style.gap = '10px';

        const totalText = document.createElement('span');
        if (
          u.month &&
          u.month.transmitted &&
          typeof u.month.monthTotalHours === 'number'
        ) {
          totalText.textContent = `Total: ${formatHours(u.month.monthTotalHours)}`;
        } else {
          totalText.textContent = 'Total: –';
        }

        monthRow.appendChild(monthLeft);
        monthRow.appendChild(monthRight);

        // --- Week blocks (KW) + 5-day rows ---
        const weekList = document.createElement('div');
        weekList.className = 'admin-week-list';

        if (!u.month || !u.month.transmitted) {
          const empty = document.createElement('div');
          empty.className = 'admin-week-block';
          empty.textContent =
            'Für diesen Monat wurden noch keine Daten übertragen.';
          weekList.appendChild(empty);
        } else {
          const weeks = Array.isArray(u.month.weeks) ? u.month.weeks : [];

          if (weeks.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'admin-week-block';
            empty.textContent = 'Keine Wochen-Daten vorhanden.';
            weekList.appendChild(empty);
          } else {
            weeks.forEach((w) => {
              const block = document.createElement('div');
              block.className = 'admin-week-block';
              if (w.locked) block.classList.add('locked');

              const headerRow = document.createElement('div');
              headerRow.className = 'admin-week-header';

              const fromStr = w.minDateKey
                ? formatShortDateFromKey(w.minDateKey)
                : '';
              const toStr = w.maxDateKey
                ? formatShortDateFromKey(w.maxDateKey)
                : '';

              // --- Top line: KW + date range ---
              const left = document.createElement('div');
              left.className = 'admin-week-header-left';
              left.textContent = `KW ${w.week} · ${fromStr} – ${toStr} (${w.workDaysInMonth} Tage)`;

              // --- Status (missing/ok) ---
              const mid = document.createElement('div');
              mid.className = 'admin-week-status';

              const missingCount = Number(w.missingCount || 0);
              mid.classList.remove('status-ok', 'status-missing');

              if (missingCount === 0) {
                mid.textContent = 'Alle Tage erfasst';
                mid.classList.add('status-ok');
              } else {
                mid.textContent = `Fehlende Einträge: ${missingCount} Tag(e)`;
                mid.classList.add('status-missing');
              }

              // --- Total line (goes below KW/date range) ---
              const totalLine = document.createElement('div');
              totalLine.className = 'admin-week-total';
              const weekDisplayHours =
                w.weekStampHours != null ? w.weekStampHours : w.weekTotalHours;
              totalLine.textContent = `Total: ${formatHours(Number(weekDisplayHours || 0))}`;

              // --- Left stack: (KW/date range) + (Total + status) ---
              const leftStack = document.createElement('div');
              leftStack.className = 'admin-week-left-stack';

              const subLine = document.createElement('div');
              subLine.className = 'admin-week-subline';
              subLine.appendChild(totalLine);
              subLine.appendChild(mid);

              leftStack.appendChild(left);
              leftStack.appendChild(subLine);

              // --- Right group: only lock button ---
              const rightGroup = document.createElement('div');
              rightGroup.className = 'admin-week-header-right';

              const lockBtn = document.createElement('button');
              lockBtn.type = 'button';
              lockBtn.className = 'admin-week-lock-btn';
              lockBtn.classList.toggle('is-locked', !!w.locked);
              lockBtn.textContent = w.locked ? 'Gesperrt' : 'Sperren';

              // optional tooltip meta (keeps it nice)
              const metaBits = [];
              if (w.lockedBy) metaBits.push(`von ${w.lockedBy}`);
              if (w.lockedAt)
                metaBits.push(
                  `am ${new Date(w.lockedAt).toLocaleString('de-CH')}`
                );
              lockBtn.title = w.locked
                ? `Woche ist gesperrt${metaBits.length ? ' (' + metaBits.join(', ') + ')' : ''}`
                : 'Woche sperren';

              lockBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();

                lockBtn.disabled = true;
                const nextLocked = !w.locked;

                authFetch('/api/admin/week-lock', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    username: u.username,
                    weekYear: w.weekYear,
                    week: w.week,
                    locked: nextLocked,
                  }),
                })
                  .then((res) => res.json())
                  .then((resp) => {
                    if (!resp.ok)
                      throw new Error(resp.error || 'Lock fehlgeschlagen');

                    w.locked = !!resp.locked;
                    w.lockedAt = resp.lockedAt || null;
                    w.lockedBy = resp.lockedBy || null;

                    block.classList.toggle('locked', w.locked);
                    lockBtn.classList.toggle('is-locked', w.locked);
                    lockBtn.textContent = w.locked ? 'Gesperrt' : 'Sperren';

                    const mb = [];
                    if (w.lockedBy) mb.push(`von ${w.lockedBy}`);
                    if (w.lockedAt)
                      mb.push(
                        `am ${new Date(w.lockedAt).toLocaleString('de-CH')}`
                      );
                    lockBtn.title = w.locked
                      ? `Woche ist gesperrt${mb.length ? ' (' + mb.join(', ') + ')' : ''}`
                      : 'Woche sperren';
                  })
                  .catch((err) => {
                    console.error(err);
                    showToast(err.message || 'Lock fehlgeschlagen');
                  })
                  .finally(() => {
                    lockBtn.disabled = false;
                  });
              });

              rightGroup.appendChild(lockBtn);

              // assemble header
              headerRow.appendChild(leftStack);
              headerRow.appendChild(rightGroup);

              // --- Day rows (Mo–Fr) (unchanged) ---
              const dayList = document.createElement('div');
              dayList.className = 'admin-day-list';

              const days = Array.isArray(w.days) ? w.days : [];
              days.forEach((d) => {
                const row = document.createElement('div');
                row.className = 'admin-day-row';
                row.dataset.username = u.username || '';
                row.dataset.year = String(info.year);
                row.dataset.monthIndex = String(info.monthIndex);
                row.dataset.date = d.dateKey;

                if (d.status === 'ferien') row.classList.add('is-ferien');
                if (d.status === 'absence') row.classList.add('is-absence');

                const dayLeft = document.createElement('div');
                dayLeft.textContent = formatDayLabelFromKey(
                  d.dateKey,
                  d.weekday
                );

                const dayCenter = document.createElement('div');
                dayCenter.className = 'admin-day-hours';

                const hoursText = document.createElement('span');
                const displayHours =
                  d.stampHours != null ? d.stampHours : d.totalHours;
                hoursText.textContent = formatHours(Number(displayHours || 0));

                const bar = document.createElement('div');
                bar.className = 'admin-hours-bar';

                const fill = document.createElement('div');
                fill.className = 'admin-hours-bar-fill';

                const h = Number(displayHours || 0);
                const pct = Math.max(0, Math.min(1, h / 8)) * 100;
                fill.style.width = `${pct}%`;

                bar.appendChild(fill);
                dayCenter.appendChild(hoursText);
                dayCenter.appendChild(bar);

                const dayRight = document.createElement('div');
                dayRight.className = `admin-status ${d.status || 'missing'}`;

                const sdot = document.createElement('span');
                sdot.className = 'admin-status-dot';

                const stxt = document.createElement('span');
                stxt.textContent = adminStatusText(d.status);

                dayRight.appendChild(sdot);
                dayRight.appendChild(stxt);

                row.appendChild(dayLeft);
                row.appendChild(dayCenter);
                row.appendChild(dayRight);
                dayList.appendChild(row);
              });

              block.appendChild(headerRow);
              block.appendChild(dayList);
              weekList.appendChild(block);
            });
          }
        }

        // Assemble card
        card.appendChild(header);
        card.appendChild(monthRow);
        card.appendChild(weekList);

        adminSummaryContainer.appendChild(card);
      });
    })
    .catch((err) => {
      console.error('Admin summary error', err);
      adminSummaryContainer.innerHTML =
        '<p>Fehler beim Laden der Übersicht.</p>';
    });
}

let praesenzPollInterval = null;
let stampEditMonthOffset = 0;
let praesenzTeamFilter = 'all';
let praesenzEditFilter = 0; // 0 = alle, 10 = nur flagged
let _liveStatusData = [];
let _stampEditsData = [];

function loadAdminPraesenz() {
  renderPraesenzControls(); // ← NEU
  loadLiveStatus();
  loadStampEditLog();
  if (praesenzPollInterval) clearInterval(praesenzPollInterval);
  praesenzPollInterval = setInterval(loadLiveStatus, 30000);
}

function renderPraesenzControls() {
  const container = document.getElementById('praesenzLiveGrid');
  if (!container) return;

  // Controls nur einmal rendern
  let controls = document.getElementById('praesenzControls');
  if (!controls) {
    controls = document.createElement('div');
    controls.id = 'praesenzControls';
    controls.className = 'praesenz-controls';
    container.parentElement.insertBefore(controls, container);
  }

  controls.innerHTML = `
    <div class="praesenz-controls-row">
      <select id="praesenzTeamFilter" class="praesenz-filter-select">
        <option value="all">Alle Teams</option>
        ${TEAMS.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}
      </select>
      <select id="praesenzEditFilter" class="praesenz-filter-select">
        <option value="0">Alle Mitarbeiter</option>
        <option value="10">Nur flagged (≥10 Edits)</option>
      </select>
      <button id="auditPdfBtn" class="praesenz-audit-btn">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Audit PDF (5 Jahre)
      </button>
    </div>
  `;

  document
    .getElementById('praesenzTeamFilter')
    ?.addEventListener('change', (e) => {
      praesenzTeamFilter = e.target.value;
      renderLiveStatusFromCache();
      renderStampEditLogFromCache();
    });

  document
    .getElementById('praesenzEditFilter')
    ?.addEventListener('change', (e) => {
      praesenzEditFilter = Number(e.target.value);
      renderStampEditLogFromCache();
    });

  document
    .getElementById('auditPdfBtn')
    ?.addEventListener('click', downloadAuditPdf);
}

function stopPraesenzPolling() {
  if (praesenzPollInterval) {
    clearInterval(praesenzPollInterval);
    praesenzPollInterval = null;
  }
}

async function loadLiveStatus() {
  try {
    const res = await authFetch('/api/admin/live-status');
    const data = await res.json();
    if (!data.ok) return;
    _liveStatusData = data.users;
    renderLiveStatusFromCache();
  } catch (err) {
    console.error('Live status load failed', err);
  }
}

function renderLiveStatusFromCache() {
  const container = document.getElementById('praesenzLiveGrid');
  if (!container) return;

  const todayKey = getTodayKey();
  container.innerHTML = '';

  const filtered = _liveStatusData.filter(
    (u) => praesenzTeamFilter === 'all' || u.teamId === praesenzTeamFilter
  );

  if (filtered.length === 0) {
    container.innerHTML =
      '<div class="stamp-edit-empty">Noch keine Stempel-Daten vorhanden.</div>';
    return;
  }

  filtered.forEach((u) => {
    const stamps = Array.isArray(u.stamps) ? u.stamps : [];
    const isToday = u.todayKey === todayKey;
    const stamped = isToday && isStampedIn(stamps);
    const sorted = [...stamps].sort((a, b) => a.time.localeCompare(b.time));
    const last = sorted[sorted.length - 1];
    const timeLabel = last
      ? `${last.type === 'in' ? 'Ein' : 'Aus'} ${last.time}`
      : '–';

    const chip = document.createElement('div');
    chip.className = 'praesenz-user-chip';

    const dot = document.createElement('div');
    dot.className = `praesenz-dot ${stamped ? 'is-in' : 'is-out'}`;

    const name = document.createElement('div');
    name.className = 'praesenz-name';
    name.textContent = u.username;

    const time = document.createElement('div');
    time.className = 'praesenz-time';
    time.textContent = isToday ? timeLabel : 'kein Eintrag heute';

    chip.appendChild(dot);
    chip.appendChild(name);
    chip.appendChild(time);
    container.appendChild(chip);
  });
}

function getStampEditMonthInfo() {
  const now = new Date();
  const d = new Date(
    now.getFullYear(),
    now.getMonth() + stampEditMonthOffset,
    1
  );
  return {
    year: d.getFullYear(),
    monthIndex: d.getMonth(),
    label: d.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' }),
  };
}

async function loadStampEditLog() {
  const container = document.getElementById('stampEditLogContainer');
  if (!container) return;

  const info = getStampEditMonthInfo();
  try {
    const res = await authFetch(
      `/api/admin/stamp-edits?year=${info.year}&monthIndex=${info.monthIndex}`
    );
    const data = await res.json();
    if (!data.ok) return;
    _stampEditsData = data.users;
    renderStampEditLogFromCache(info);
  } catch (err) {
    console.error('Stamp edit log load failed', err);
  }
}

function renderStampEditLogFromCache(info) {
  const container = document.getElementById('stampEditLogContainer');
  if (!container) return;
  if (!info) info = getStampEditMonthInfo();

  container.innerHTML = '';

  // ── Header mit Navigation ──
  const header = document.createElement('div');
  header.className = 'stamp-edit-log-header';

  const title = document.createElement('div');
  title.className = 'stamp-edit-log-title';
  title.textContent = 'Stempel-Bearbeitungen';

  const monthControl = document.createElement('div');
  monthControl.className = 'stamp-edit-month-control';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'stamp-edit-month-arrow';
  prevBtn.textContent = '‹';
  prevBtn.addEventListener('click', () => {
    stampEditMonthOffset -= 1;
    loadStampEditLog();
  });

  const monthLabel = document.createElement('span');
  monthLabel.className = 'stamp-edit-month-label';
  const lbl = info.label;
  monthLabel.textContent = lbl.charAt(0).toUpperCase() + lbl.slice(1);

  const nextBtn = document.createElement('button');
  nextBtn.className = 'stamp-edit-month-arrow';
  nextBtn.textContent = '›';
  nextBtn.addEventListener('click', () => {
    stampEditMonthOffset += 1;
    loadStampEditLog();
  });

  monthControl.appendChild(prevBtn);
  monthControl.appendChild(monthLabel);
  monthControl.appendChild(nextBtn);
  header.appendChild(title);
  header.appendChild(monthControl);
  container.appendChild(header);

  // Filter anwenden
  let filtered = _stampEditsData.filter(
    (u) => praesenzTeamFilter === 'all' || u.teamId === praesenzTeamFilter
  );
  if (praesenzEditFilter >= 10) {
    filtered = filtered.filter((u) => u.flagged);
  }

  // ── Leaderboard Chart ──
  if (filtered.length > 0) {
    const chartWrap = document.createElement('div');
    chartWrap.className = 'stamp-edit-chart';

    const chartTitle = document.createElement('div');
    chartTitle.className = 'stamp-edit-chart-title';
    chartTitle.textContent = 'Edits pro Mitarbeiter';
    chartWrap.appendChild(chartTitle);

    const maxEdits = Math.max(...filtered.map((u) => u.editCount), 1);
    const svgNS = 'http://www.w3.org/2000/svg';
    const barHeight = 28;
    const barGap = 8;
    const labelWidth = 100;
    const chartWidth = 380;
    const svgHeight = filtered.length * (barHeight + barGap);

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute(
      'viewBox',
      `0 0 ${labelWidth + chartWidth + 50} ${svgHeight}`
    );

    filtered.forEach((u, i) => {
      const y = i * (barHeight + barGap);
      const barW = Math.max(4, (u.editCount / maxEdits) * chartWidth);
      const color = u.flagged ? '#ef4444' : '#6366f1';

      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', labelWidth - 8);
      label.setAttribute('y', y + barHeight / 2 + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('font-size', '12');
      label.setAttribute('fill', '#475569');
      label.setAttribute('font-family', 'sans-serif');
      label.textContent = u.username;

      const bar = document.createElementNS(svgNS, 'rect');
      bar.setAttribute('x', labelWidth);
      bar.setAttribute('y', y);
      bar.setAttribute('width', barW);
      bar.setAttribute('height', barHeight);
      bar.setAttribute('rx', '6');
      bar.setAttribute('fill', color);
      bar.setAttribute('opacity', '0.85');

      const countLabel = document.createElementNS(svgNS, 'text');
      countLabel.setAttribute('x', labelWidth + barW + 6);
      countLabel.setAttribute('y', y + barHeight / 2 + 4);
      countLabel.setAttribute('font-size', '12');
      countLabel.setAttribute('fill', color);
      countLabel.setAttribute('font-weight', 'bold');
      countLabel.setAttribute('font-family', 'sans-serif');
      countLabel.textContent = u.editCount;

      svg.appendChild(label);
      svg.appendChild(bar);
      svg.appendChild(countLabel);
    });

    chartWrap.appendChild(svg);
    container.appendChild(chartWrap);
  }

  // ── Edit-Log Liste ──
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'stamp-edit-empty';
    empty.textContent = 'Keine Stempel-Bearbeitungen in diesem Monat.';
    container.appendChild(empty);
    return;
  }

  filtered.forEach((u) => {
    const block = document.createElement('div');
    block.className = `stamp-edit-user-block${u.flagged ? ' is-flagged' : ''}`;

    const blockHeader = document.createElement('div');
    blockHeader.className = 'stamp-edit-user-header';

    const name = document.createElement('div');
    name.className = 'stamp-edit-user-name';
    name.textContent = u.username;

    const right = document.createElement('div');
    right.className = 'stamp-edit-user-right';

    const countBadge = document.createElement('span');
    countBadge.className = `stamp-edit-count ${u.flagged ? 'flagged' : 'normal'}`;
    countBadge.textContent = `${u.editCount} Edit${u.editCount !== 1 ? 's' : ''}`;

    const chevron = document.createElement('span');
    chevron.className = 'stamp-edit-chevron';
    chevron.textContent = '▾';

    right.appendChild(countBadge);
    right.appendChild(chevron);
    blockHeader.appendChild(name);
    blockHeader.appendChild(right);

    const entries = document.createElement('div');
    entries.className = 'stamp-edit-entries';

    u.edits.forEach((edit) => {
      const row = document.createElement('div');
      row.className = 'stamp-edit-entry';

      const action = document.createElement('span');
      action.className = `stamp-edit-action ${edit.action}`;
      action.textContent =
        edit.action === 'added'
          ? 'hinzugefügt'
          : edit.action === 'deleted'
            ? 'gelöscht'
            : 'bearbeitet';

      const detail = document.createElement('div');
      detail.className = 'stamp-edit-detail';
      if (edit.action === 'edited') {
        detail.textContent = `${edit.oldType === 'in' ? 'Ein' : 'Aus'} ${edit.oldTime} → ${edit.newType === 'in' ? 'Ein' : 'Aus'} ${edit.newTime}`;
      } else if (edit.action === 'added') {
        detail.textContent = `${edit.newType === 'in' ? 'Ein' : 'Aus'} ${edit.newTime}`;
      } else {
        detail.textContent = `${edit.oldType === 'in' ? 'Ein' : 'Aus'} ${edit.oldTime}`;
      }

      const dateLabel = document.createElement('div');
      dateLabel.className = 'stamp-edit-date-label';
      dateLabel.textContent = edit.dateKey;

      row.appendChild(action);
      row.appendChild(detail);
      row.appendChild(dateLabel);
      entries.appendChild(row);
    });

    blockHeader.addEventListener('click', () => {
      entries.classList.toggle('open');
      chevron.classList.toggle('open');
    });

    block.appendChild(blockHeader);
    block.appendChild(entries);
    container.appendChild(block);
  });
}

async function downloadAuditPdf() {
  const btn = document.getElementById('auditPdfBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Wird erstellt…';
  }
  try {
    const res = await authFetch('/api/admin/audit-pdf');
    if (!res.ok) throw new Error('PDF-Erstellung fehlgeschlagen');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Praesenz-Audit_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Audit PDF download failed', err);
    showToast('PDF konnte nicht erstellt werden.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Audit PDF (5 Jahre)`;
    }
  }
}

/**
 * Push weekday checkbox and flag inputs into the current day draft object and persist them.
 */
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
    1: false,
    2: false,
    3: false,
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

/**
 * Push Kommissionsnummer rows into the current day draft object and persist them.
 */
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

  const optionKeys = [
    'option1',
    'option2',
    'option3',
    'option4',
    'option5',
    'option6',
  ];

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

/**
 * Push special booking rows into the current day draft object and persist them.
 */
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

    const selectWrap = document.createElement('div');
    selectWrap.className = 'special-select-wrap';

    const chevron = document.createElement('span');
    chevron.className = 'special-select-chevron';
    chevron.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

    selectWrap.appendChild(typeSelect);
    selectWrap.appendChild(chevron);
    typeField.appendChild(typeLabel);
    typeField.appendChild(selectWrap);

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

    if (
      typeof entry.hours === 'number' &&
      !Number.isNaN(entry.hours) &&
      entry.hours !== 0
    ) {
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
    } else if (target.classList.contains('special-detail-input')) {
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
  if (!target || !target.classList || !target.classList.contains('day-flag')) {
    return;
  }

  const dateKey = getCurrentDateKey();
  const dayData = getOrCreateDayData(dateKey);
  const flagKey = target.dataset.flag;

  if (!dayData.flags) {
    dayData.flags = {};
  }

  // Ferien is now only set via absence requests, skip if somehow triggered
  if (flagKey === 'ferien') {
    return;
  }

  dayData.flags[flagKey] = target.checked;

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
  if (value !== 'pending' && value !== 'accepted' && value !== 'rejected') {
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
      dayData.mealAllowance = { 1: false, 2: false, 3: false };
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

/**
 * Event wiring / week navigation
 */

if (weekPrevBtn) {
  weekPrevBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    weekOffset -= 1;

    renderWeekInfo();
    updateDayTitleWithDate();
    applyFlagsForCurrentDay();
    applyDayHoursForCurrentDay();
    applyMealAllowanceForCurrentDay();
    applyKomForCurrentDay();
    applySpecialEntriesForCurrentDay();
    updateDayTotalFromInputs();
    applyWeekLockUI();
  });
}

if (weekNextBtn) {
  weekNextBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    weekOffset += 1;

    renderWeekInfo();
    updateDayTitleWithDate();
    applyFlagsForCurrentDay();
    applyDayHoursForCurrentDay();
    applyMealAllowanceForCurrentDay();
    applyKomForCurrentDay();
    applySpecialEntriesForCurrentDay();
    updateDayTotalFromInputs();
    applyWeekLockUI();
  });
}

// ============================================================================
// Admin — Account Management
// ============================================================================

async function loadAdminUsers() {
  if (!adminUsersGrid) return;
  adminUsersGrid.innerHTML =
    '<p style="color:var(--muted);font-size:13px;">Wird geladen…</p>';
  try {
    const res = await authFetch('/api/admin/users');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    allUsers = data.users || [];
    renderAdminUsers(allUsers);
  } catch (err) {
    adminUsersGrid.innerHTML = `<p style="color:#ef4444;font-size:13px;">Fehler: ${err.message}</p>`;
  }
}

// Work Schedule — laden und rendern
async function loadWorkScheduleForModal(userId) {
  const listEl = document.getElementById('modalScheduleList');
  if (!listEl) return;
  listEl.innerHTML =
    '<span style="font-size:12px;color:#94a3b8;">Wird geladen…</span>';

  try {
    const res = await authFetch(`/api/admin/work-schedule/${userId}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    listEl.innerHTML = '';
    if (data.schedules.length === 0) {
      listEl.innerHTML =
        '<span style="font-size:12px;color:#94a3b8;">Kein Modell hinterlegt — Standard 100% wird verwendet.</span>';
      return;
    }

    data.schedules.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'modal-schedule-item';

      const wd = s.work_days || {};
      const days = ['mon', 'tue', 'wed', 'thu', 'fri'];
      const dayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
      const daysStr = days
        .map((d, i) => (wd[d] > 0 ? `${dayLabels[i]}:${wd[d]}h` : null))
        .filter(Boolean)
        .join(' · ');

      const info = document.createElement('div');
      info.innerHTML = `<strong>Ab ${s.valid_from.slice(0, 10)}</strong><br>
        <span style="font-size:11px;color:#64748b;">${daysStr}</span>`;

      const delBtn = document.createElement('button');
      delBtn.className = 'modal-schedule-delete';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', async () => {
        if (!confirm('Dieses Modell löschen?')) return;
        await authFetch(`/api/admin/work-schedule/${s.id}`, {
          method: 'DELETE',
        });
        loadWorkScheduleForModal(userId);
      });

      item.appendChild(info);
      item.appendChild(delBtn);
      listEl.appendChild(item);
    });
  } catch (err) {
    listEl.innerHTML = `<span style="font-size:12px;color:#ef4444;">Fehler: ${err.message}</span>`;
  }
}

// Pensum-Input → Tagessoll automatisch anpassen
const modalEmploymentPctEl = document.getElementById('modalEmploymentPct');
if (modalEmploymentPctEl) {
  modalEmploymentPctEl.addEventListener('input', () => {
    const pct = Number(modalEmploymentPctEl.value);
    if (!pct || pct < 10 || pct > 100) return;
    const dailyHours = Math.round(((8 * pct) / 100) * 10) / 10; // auf 0.1 runden
    ['schedMon', 'schedTue', 'schedWed', 'schedThu', 'schedFri'].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.value = dailyHours;
      }
    );
  });
}

// Work Schedule — neues Modell speichern
async function saveWorkSchedule(userId) {
  const pct = Number(document.getElementById('modalEmploymentPct')?.value);
  const validFrom = document.getElementById('modalScheduleValidFrom')?.value;

  if (!pct || !validFrom) {
    showToast('Bitte Pensum und Datum eingeben.');
    return;
  }

  const workDays = {
    mon: Number(document.getElementById('schedMon')?.value || 0),
    tue: Number(document.getElementById('schedTue')?.value || 0),
    wed: Number(document.getElementById('schedWed')?.value || 0),
    thu: Number(document.getElementById('schedThu')?.value || 0),
    fri: Number(document.getElementById('schedFri')?.value || 0),
  };

  try {
    const res = await authFetch('/api/admin/work-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, employmentPct: pct, workDays, validFrom }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    loadWorkScheduleForModal(userId);
  } catch (err) {
    showToast(`Fehler: ${err.message}`);
  }
}

function renderAdminUsers(users) {
  if (!adminUsersGrid) return;
  const search = adminUsersSearch ? adminUsersSearch.value.toLowerCase() : '';
  const filtered = users.filter(
    (u) =>
      u.username.toLowerCase().includes(search) ||
      (u.email || '').toLowerCase().includes(search)
  );

  if (!filtered.length) {
    adminUsersGrid.innerHTML =
      '<p style="color:var(--muted);font-size:13px;">Keine Mitarbeiter gefunden.</p>';
    return;
  }

  adminUsersGrid.innerHTML = filtered
    .map(
      (u) => `
    <div class="admin-user-item">
      <div class="admin-user-item-header">
        <span class="admin-user-item-name">${escapeHtml(u.username)}</span>
        <span class="admin-user-item-badge ${u.active === false ? 'inactive' : u.role}">
          ${u.active === false ? 'Inaktiv' : u.role === 'admin' ? 'Admin' : 'Mitarbeiter'}
        </span>
      </div>
      <div class="admin-user-item-meta">
        <span>${escapeHtml(u.email) || '–'}</span>
        <span>${escapeHtml(u.teamId) || '–'}</span>
      </div>
      <div class="admin-user-item-actions">
        <button class="admin-user-btn" data-action="edit" data-id="${u.id}">Bearbeiten</button>
        <button class="admin-user-btn" data-action="password" data-id="${u.id}" data-username="${u.username}">Passwort</button>
        ${`<button class="admin-user-btn danger" data-action="deactivate" data-id="${u.id}" data-username="${u.username}">Löschen</button>`}
      </div>
    </div>
  `
    )
    .join('');

  adminUsersGrid.querySelectorAll('.admin-user-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const username = btn.dataset.username;
      if (action === 'edit') openEditUserModal(id);
      else if (action === 'password') await resetUserPassword(id, username);
      else if (action === 'deactivate') {
        const username = btn.dataset.username;
        if (
          !confirm(
            `${username} und alle Daten wirklich löschen? Dies kann nicht rückgängig gemacht werden.`
          )
        )
          return;
        await toggleUserActive(id, false);
      }
    });
  });
}

function populateTeamDropdown() {
  if (!modalTeam) return;
  modalTeam.innerHTML = TEAMS.map(
    (t) => `<option value="${t.id}">${t.name}</option>`
  ).join('');
}

function openNewUserModal() {
  editingUserId = null;
  adminUserModalTitle.textContent = 'Neuer Mitarbeiter';
  modalUsername.value = '';
  modalEmail.value = '';
  modalPassword.value = '';
  modalRole.value = 'user';
  populateTeamDropdown();
  modalTeam.value = 'montage';
  if (modalEmploymentStart) modalEmploymentStart.value = '';
  if (document.getElementById('modalBirthYear'))
    document.getElementById('modalBirthYear').value = '';
  if (document.getElementById('modalIsNonSmoker'))
    document.getElementById('modalIsNonSmoker').checked = false;
  if (document.getElementById('modalIsKader'))
    document.getElementById('modalIsKader').checked = false;
  updateVacPreview();
  modalUsername.disabled = false;
  modalPassword.placeholder = 'Passwort';
  adminUserModalError.classList.add('hidden');
  adminUserModal.classList.remove('hidden');
}

function updateVacPreview() {
  const preview = document.getElementById('modalVacPreview');
  if (!preview) return;
  const birthYear = Number(document.getElementById('modalBirthYear')?.value);
  const isNonSmoker = document.getElementById('modalIsNonSmoker')?.checked;
  const isKader = document.getElementById('modalIsKader')?.checked;

  let base = 20;
  if (birthYear) {
    const age = new Date().getFullYear() - birthYear;
    if (age <= 20 || age >= 50) base = 25;
  }
  if (isNonSmoker) base += 1;
  if (isKader) base += 5;

  preview.textContent = birthYear
    ? `Ferien/Jahr: ${base} Tage`
    : 'Ferien/Jahr: Geburtsjahr eingeben';
}

// Event Listeners für Live-Preview
['modalBirthYear', 'modalIsNonSmoker', 'modalIsKader'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', updateVacPreview);
  document.getElementById(id)?.addEventListener('change', updateVacPreview);
});

function openEditUserModal(userId) {
  const user = allUsers.find((u) => u.id === userId);
  if (!user) return;
  editingUserId = userId;
  adminUserModalTitle.textContent = 'Mitarbeiter bearbeiten';
  modalUsername.value = user.username;
  modalEmail.value = user.email || '';
  modalPassword.value = '';
  modalRole.value = user.role || 'user';
  populateTeamDropdown();
  modalTeam.value = user.teamId || 'montage';
  if (modalEmploymentStart)
    modalEmploymentStart.value = user.employmentStart || '';
  if (document.getElementById('modalBirthYear'))
    document.getElementById('modalBirthYear').value = user.birthYear || '';
  if (document.getElementById('modalIsNonSmoker'))
    document.getElementById('modalIsNonSmoker').checked = !!user.isNonSmoker;
  if (document.getElementById('modalIsKader'))
    document.getElementById('modalIsKader').checked = !!user.isKader;
  updateVacPreview();
  modalUsername.disabled = true;
  modalPassword.placeholder = 'Leer lassen um nicht zu ändern';
  adminUserModalError.classList.add('hidden');
  adminUserModal.classList.remove('hidden');
  loadWorkScheduleForModal(userId);
}

function closeUserModal() {
  adminUserModal.classList.add('hidden');
  editingUserId = null;
}

async function saveUserModal() {
  adminUserModalError.classList.add('hidden');
  const username = modalUsername.value.trim();
  const email = modalEmail.value.trim();
  const password = modalPassword.value;
  const role = modalRole.value;
  const teamId = modalTeam.value;

  if (!editingUserId && (!username || !password)) {
    adminUserModalError.textContent =
      'Benutzername und Passwort sind erforderlich.';
    adminUserModalError.classList.remove('hidden');
    return;
  }

  try {
    adminUserModalSave.disabled = true;

    if (!editingUserId) {
      const res = await authFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, role, teamId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
    } else {
      const employmentStart = modalEmploymentStart?.value || null;
      const birthYear =
        document.getElementById('modalBirthYear')?.value || null;
      const isNonSmoker =
        document.getElementById('modalIsNonSmoker')?.checked ?? false;
      const isKader = document.getElementById('modalIsKader')?.checked ?? false;
      const body = {
        email,
        role,
        teamId,
        employmentStart,
        birthYear,
        isNonSmoker,
        isKader,
      };
      if (password) body.password = password;

      const patchRes = await authFetch(`/api/admin/users/${editingUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const patchData = await patchRes.json();
      if (!patchData.ok) throw new Error(patchData.error);

      if (password) {
        const pwRes = await authFetch(
          `/api/admin/users/${editingUserId}/reset-password`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          }
        );
        const pwData = await pwRes.json();
        if (!pwData.ok) throw new Error(pwData.error);
      }
    }

    closeUserModal();
    await loadAdminUsers();
    await loadAdminPersonnel();
  } catch (err) {
    adminUserModalError.textContent = err.message;
    adminUserModalError.classList.remove('hidden');
  } finally {
    adminUserModalSave.disabled = false;
  }
}

async function resetUserPassword(userId, username) {
  const newPassword = prompt(`Neues Passwort für ${username}:`);
  if (!newPassword || newPassword.length < 6) return;

  try {
    const res = await authFetch(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    showToast(`Passwort für ${username} wurde geändert.`);
  } catch (err) {
    showToast(`Fehler: ${err.message}`);
  }
}

async function toggleUserActive(userId, active) {
  const action = active ? 'activate' : 'deactivate';
  try {
    const res = await authFetch(`/api/admin/users/${userId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    await loadAdminUsers();
  } catch (err) {
    showToast(`Fehler: ${err.message}`);
  }
}

if (adminUsersAddBtn)
  adminUsersAddBtn.addEventListener('click', openNewUserModal);
if (adminUserModalClose)
  adminUserModalClose.addEventListener('click', closeUserModal);
if (adminUserModalCancel)
  adminUserModalCancel.addEventListener('click', closeUserModal);
if (adminUserModalSave)
  adminUserModalSave.addEventListener('click', saveUserModal);
if (adminUsersSearch)
  adminUsersSearch.addEventListener('input', () => renderAdminUsers(allUsers));

// Work Schedule Add-Button ← NEU
document
  .getElementById('modalScheduleAddBtn')
  ?.addEventListener('click', () => {
    if (editingUserId) saveWorkSchedule(editingUserId);
    else
      showToast(
        'Bitte erst speichern bevor ein Arbeitszeitmodell hinzugefügt wird.'
      );
  });

/**
 * View helpers / active weekday switching
 */
function showDay(dayId) {
  currentDayId = dayId;

  daySections.forEach((section) => {
    section.classList.toggle('active', section.id === dayId);
  });

  // Titel "Montag 22/02/2020" aktualisieren
  updateDayTitleWithDate();
  applyWeekLockUI();
}

// ============================================================================
// Stamp Card
// ============================================================================

function getTodayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatTimeHHMM(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDateDE(dateKey) {
  const d = new Date(dateKey + 'T00:00:00');
  return d.toLocaleDateString('de-CH', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function getStampNet(stamps) {
  if (!Array.isArray(stamps) || stamps.length === 0) return null;
  let total = 0;
  let lastIn = null;
  const sorted = [...stamps].sort((a, b) => a.time.localeCompare(b.time));
  for (const s of sorted) {
    const [hh, mm] = s.time.split(':').map(Number);
    const minutes = hh * 60 + mm;
    if (s.type === 'in') lastIn = minutes;
    else if (s.type === 'out' && lastIn !== null) {
      total += minutes - lastIn;
      lastIn = null;
    }
  }
  if (total === 0) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function isStampedIn(stamps) {
  if (!Array.isArray(stamps) || stamps.length === 0) return false;
  const sorted = [...stamps].sort((a, b) => a.time.localeCompare(b.time));
  return sorted[sorted.length - 1].type === 'in';
}

function renderStampLog(dateKey, logEl, editMode) {
  if (!logEl) return;
  const dayData = getOrCreateDayData(dateKey);
  const stamps = dayData.stamps || [];
  logEl.innerHTML = '';

  if (stamps.length === 0) return;

  const sorted = [...stamps].sort((a, b) => a.time.localeCompare(b.time));
  sorted.forEach((stamp, idx) => {
    const entry = document.createElement('div');
    entry.className = 'stamp-log-entry';

    const left = document.createElement('div');
    left.className = 'stamp-log-entry-left';

    const badge = document.createElement('span');
    badge.className = `stamp-log-type ${stamp.type}`;
    badge.textContent = stamp.type === 'in' ? 'Ein' : 'Aus';

    const time = document.createElement('span');
    time.className = 'stamp-log-time';
    time.textContent = stamp.time;

    left.appendChild(badge);
    left.appendChild(time);

    const editBtn = document.createElement('button');
    editBtn.className = 'stamp-log-edit-btn';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      const existing = entry.querySelector('.stamp-log-actions');
      if (existing) {
        existing.remove();
        return;
      }

      const actions = document.createElement('div');
      actions.className = 'stamp-log-actions';

      const editAction = document.createElement('button');
      editAction.className = 'stamp-log-action-btn';
      editAction.textContent = 'Zeit ändern';
      editAction.addEventListener('click', () => {
        openStampModal({
          title: 'Zeit ändern',
          time: stamp.time,
          type: stamp.type,
          onSave: (type, newTime) => {
            const sortedOriginal = [...dayData.stamps].sort((a, b) =>
              a.time.localeCompare(b.time)
            );
            const realIdx = dayData.stamps.indexOf(sortedOriginal[idx]);
            const oldTime = dayData.stamps[realIdx]?.time;
            const oldType = dayData.stamps[realIdx]?.type;
            if (realIdx !== -1) {
              dayData.stamps[realIdx].time = newTime;
              dayData.stamps[realIdx].type = type;
            }
            logStampEdit(
              dateKey,
              'edited',
              { time: oldTime, type: oldType },
              { time: newTime, type }
            );
            saveToStorage();
            if (dateKey === getTodayKey())
              sendLiveStamp(dateKey, dayData.stamps);
            if (editMode) renderStampEditSection(dateKey);
            else renderStampCard();
          },
        });
      });

      const deleteAction = document.createElement('button');
      deleteAction.className = 'stamp-log-action-btn danger';
      deleteAction.textContent = 'Löschen';
      deleteAction.addEventListener('click', () => {
        const sortedOriginal = [...dayData.stamps].sort((a, b) =>
          a.time.localeCompare(b.time)
        );
        const realIdx = dayData.stamps.indexOf(sortedOriginal[idx]);
        if (realIdx !== -1) {
          logStampEdit(dateKey, 'deleted', sortedOriginal[idx], null);
          dayData.stamps.splice(realIdx, 1);
        }
        saveToStorage();
        if (dateKey === getTodayKey()) sendLiveStamp(dateKey, dayData.stamps);
        if (editMode) renderStampEditSection(dateKey);
        else renderStampCard();
      });

      actions.appendChild(editAction);
      actions.appendChild(deleteAction);
      entry.appendChild(actions);

      setTimeout(() => {
        document.addEventListener('click', () => actions.remove(), {
          once: true,
        });
      }, 0);
    });

    entry.appendChild(left);
    entry.appendChild(editBtn);
    logEl.appendChild(entry);
  });
}

function renderStampCard() {
  const todayKey = getTodayKey();
  const dayData = getOrCreateDayData(todayKey);
  const stamps = dayData.stamps || [];

  if (stampCardDate) stampCardDate.textContent = formatDateDE(todayKey);

  const net = getStampNet(stamps);
  const netWrap = document.getElementById('stampCardNetWrap');
  if (stampCardNet) stampCardNet.textContent = net || '0h';
  if (netWrap) netWrap.style.display = 'flex';

  const stamped = isStampedIn(stamps);
  if (stampBtn) {
    stampBtn.classList.toggle('stamped-in', stamped);
    if (stampBtnLabel)
      stampBtnLabel.textContent = stamped ? 'Ausstempeln' : 'Einstempeln';
    if (stampBtnIcon) stampBtnIcon.textContent = stamped ? '■' : '▶';
  }

  renderStampLog(todayKey, stampLog, false);

  // Zulagen Pills
  const flags = dayData.flags || {};
  document.querySelectorAll('.stamp-pill[data-stamp-flag]').forEach((pill) => {
    const flag = pill.dataset.stampFlag;
    pill.classList.toggle('zulage-active', !!flags[flag]);
  });

  // Meal Pills
  const meal = dayData.mealAllowance || {};
  document.querySelectorAll('.stamp-meal-pill').forEach((pill) => {
    const key = pill.dataset.stampMeal;
    pill.classList.toggle('meal-active', !!meal[key]);
  });

  updateDayTitleWithDate();
}

function renderStampEditSection(dateKey) {
  if (!dateKey) return;
  const dayData = getOrCreateDayData(dateKey);

  renderStampLog(dateKey, stampEditLog, true);
  // Total-Badge aktualisieren
  const badge = document.getElementById('stampEditTotalBadge');
  const valueEl = document.getElementById('stampEditTotalValue');
  if (badge && valueEl) {
    const net = getStampNet(dayData.stamps || []);
    if (net) {
      valueEl.textContent = net;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  if (stampEditSchmutzzulage) {
    stampEditSchmutzzulage.classList.toggle(
      'zulage-active',
      !!dayData.flags?.schmutzzulage
    );
  }
  if (stampEditNebenauslagen) {
    stampEditNebenauslagen.classList.toggle(
      'zulage-active',
      !!dayData.flags?.nebenauslagen
    );
  }

  document.querySelectorAll('.stamp-edit-meal-pill').forEach((pill) => {
    const key = pill.dataset.stampMeal;
    pill.classList.toggle('meal-active', !!dayData.mealAllowance?.[key]);
  });

  updateDayTitleWithDate();
}

// Stamp Button
if (stampBtn) {
  stampBtn.addEventListener('click', () => {
    const todayKey = getTodayKey();
    const dayData = getOrCreateDayData(todayKey);
    const stamped = isStampedIn(dayData.stamps);
    const now = formatTimeHHMM(new Date());

    dayData.stamps.push({ type: stamped ? 'out' : 'in', time: now });

    saveToStorage();
    renderStampCard();
    sendLiveStamp(todayKey, dayData.stamps); // ← NEU
  });
}

async function sendLiveStamp(todayKey, stamps) {
  try {
    await authFetch('/api/stamps/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todayKey, stamps }),
    });
  } catch (err) {
    console.error('Live stamp send failed', err);
  }
}

// Edit-Log in dayStore mitschreiben
function logStampEdit(dateKey, action, oldStamp, newStamp) {
  const dayData = getOrCreateDayData(dateKey);
  if (!Array.isArray(dayData.stampEditLog)) dayData.stampEditLog = [];
  dayData.stampEditLog.push({
    dateKey,
    action,
    oldTime: oldStamp?.time || null,
    newTime: newStamp?.time || null,
    oldType: oldStamp?.type || null,
    newType: newStamp?.type || null,
    editedAt: new Date().toISOString(),
  });
}

// Zulagen Pills (heute)
document.querySelectorAll('.stamp-pill[data-stamp-flag]').forEach((pill) => {
  pill.addEventListener('click', () => {
    const todayKey = getTodayKey();
    const dayData = getOrCreateDayData(todayKey);
    const flag = pill.dataset.stampFlag;
    dayData.flags[flag] = !dayData.flags[flag];
    saveToStorage();
    pill.classList.toggle('zulage-active', dayData.flags[flag]);
  });
});

// Meal Pills (heute)
document.querySelectorAll('.stamp-meal-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    const todayKey = getTodayKey();
    const dayData = getOrCreateDayData(todayKey);
    const key = pill.dataset.stampMeal;
    dayData.mealAllowance[key] = !dayData.mealAllowance[key];
    saveToStorage();
    pill.classList.toggle('meal-active', dayData.mealAllowance[key]);
  });
});

// Edit Section — Datepicker
if (stampEditDate) {
  stampEditDate.max = getTodayKey();
  stampEditDate.addEventListener('change', () => {
    const dateKey = stampEditDate.value;
    const todayKey = getTodayKey();
    renderStampEditSection(dateKey);
    stampEditDate.max = getTodayKey(); // ← im renderStampCard() oder beim Init

    // Zukunft verhindern
    if (dateKey > todayKey) {
      showToast('Zukünftige Tage können nicht bearbeitet werden.');
      stampEditDate.value = todayKey;
      return;
    }

    const locked = isDateLocked(dateKey);
    const body = document.querySelector('.stamp-edit-body');
    if (!body) return;

    let lockMsg = body.querySelector('.stamp-edit-lock-msg');

    if (locked) {
      // Alle Inputs/Buttons ausser Datepicker deaktivieren
      body
        .querySelectorAll('button, input:not(#stampEditDate)')
        .forEach((el) => {
          el.disabled = true;
        });

      if (!lockMsg) {
        lockMsg = document.createElement('div');
        lockMsg.className = 'stamp-edit-lock-msg';
        lockMsg.textContent =
          'Diese Woche ist gesperrt — keine Änderungen möglich.';
        stampEditDate.after(lockMsg);
      }
    } else {
      body.querySelectorAll('button, input').forEach((el) => {
        el.disabled = false;
      });
      if (lockMsg) lockMsg.remove();
    }
  });
}

// 🔒 Dev-Shortcut: 5s Long-Press → Tagesstempel 07:00/12:00/12:30/16:30
if (stampEditAddBtn) {
  let devPressTimer = null;

  stampEditAddBtn.addEventListener('pointerdown', () => {
    devPressTimer = setTimeout(() => {
      devPressTimer = null;
      const dateKey = stampEditDate?.value;
      if (!dateKey) return;
      if (isDateLocked(dateKey)) return;
      if (dateKey > getTodayKey()) return;

      const dayData = getOrCreateDayData(dateKey);
      const autoStamps = [
        { type: 'in', time: '07:00' },
        { type: 'out', time: '12:00' },
        { type: 'in', time: '12:30' },
        { type: 'out', time: '16:30' },
      ];
      autoStamps.forEach((s) => {
        dayData.stamps.push(s);
        logStampEdit(dateKey, 'added', null, s);
      });
      saveToStorage();
      renderStampEditSection(dateKey);
      showToast('Dev: Tagesstempel eingefügt', 'success');
    }, 5000);
  });

  stampEditAddBtn.addEventListener('pointerup', () => {
    if (devPressTimer) {
      clearTimeout(devPressTimer);
      devPressTimer = null;
    }
  });

  stampEditAddBtn.addEventListener('pointerleave', () => {
    if (devPressTimer) {
      clearTimeout(devPressTimer);
      devPressTimer = null;
    }
  });
}

// Edit Section — Stempel hinzufügen
if (stampEditAddBtn) {
  stampEditAddBtn.addEventListener('click', () => {
    const dateKey = stampEditDate?.value;
    if (!dateKey) {
      showToast('Bitte zuerst ein Datum auswählen.');
      return;
    }
    if (isDateLocked(dateKey)) {
      showToast('Diese Woche ist gesperrt.');
      return;
    }
    if (isDateLocked(dateKey)) {
      showToast('Diese Woche ist gesperrt.');
      return;
    }
    if (dateKey > getTodayKey()) {
      showToast('Zukünftige Tage können nicht bearbeitet werden.');
      return;
    }

    openStampModal({
      title: 'Stempel hinzufügen',
      time: '',
      type: 'in',
      onSave: (type, time) => {
        const dayData = getOrCreateDayData(dateKey);
        dayData.stamps.push({ type, time });
        logStampEdit(dateKey, 'added', null, { type, time }); // ← NEU

        saveToStorage();
        renderStampEditSection(dateKey);
      },
    });
  });
}

// Edit Section — Zulagen
if (stampEditSchmutzzulage) {
  stampEditSchmutzzulage.addEventListener('click', () => {
    const dateKey = stampEditDate?.value;
    if (!dateKey) return;
    if (isDateLocked(dateKey)) {
      showToast('Diese Woche ist gesperrt.');
      return;
    }
    const dayData = getOrCreateDayData(dateKey);
    dayData.flags.schmutzzulage = !dayData.flags.schmutzzulage;
    saveToStorage();
    stampEditSchmutzzulage.classList.toggle(
      'zulage-active',
      dayData.flags.schmutzzulage
    );
  });
}

if (stampEditNebenauslagen) {
  stampEditNebenauslagen.addEventListener('click', () => {
    const dateKey = stampEditDate?.value;
    if (!dateKey) return;
    if (isDateLocked(dateKey)) {
      showToast('Diese Woche ist gesperrt.');
      return;
    }
    const dayData = getOrCreateDayData(dateKey);
    dayData.flags.nebenauslagen = !dayData.flags.nebenauslagen;
    saveToStorage();
    stampEditNebenauslagen.classList.toggle(
      'zulage-active',
      dayData.flags.nebenauslagen
    );
  });
}

// Edit Section — Meal Pills
document.querySelectorAll('.stamp-edit-meal-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    const dateKey = stampEditDate?.value;
    if (!dateKey) return;
    if (isDateLocked(dateKey)) {
      showToast('Diese Woche ist gesperrt.');
      return;
    }
    const dayData = getOrCreateDayData(dateKey);
    const key = pill.dataset.stampMeal;
    dayData.mealAllowance[key] = !dayData.mealAllowance[key];
    saveToStorage();
    pill.classList.toggle('meal-active', dayData.mealAllowance[key]);
  });
});

let stampModalCallback = null;
let stampModalSelectedType = 'in';

function openStampModal({ title, time = '', type = 'in', onSave }) {
  if (!stampModal) return;
  stampModalTitle.textContent = title;
  stampModalTime.value = time;
  stampModalSelectedType = type;
  stampModalTypeIn.classList.toggle('active', type === 'in');
  stampModalTypeOut.classList.toggle('active', type === 'out');
  stampModalCallback = onSave;
  stampModal.classList.remove('hidden');
}

function closeStampModal() {
  if (stampModal) stampModal.classList.add('hidden');
  stampModalCallback = null;
}

if (stampModalTypeIn) {
  stampModalTypeIn.addEventListener('click', () => {
    stampModalSelectedType = 'in';
    stampModalTypeIn.classList.add('active');
    stampModalTypeOut.classList.remove('active');
  });
}

if (stampModalTypeOut) {
  stampModalTypeOut.addEventListener('click', () => {
    stampModalSelectedType = 'out';
    stampModalTypeOut.classList.add('active');
    stampModalTypeIn.classList.remove('active');
  });
}

if (stampModalClose) stampModalClose.addEventListener('click', closeStampModal);
if (stampModalCancel)
  stampModalCancel.addEventListener('click', closeStampModal);

if (stampModalSave) {
  stampModalSave.addEventListener('click', () => {
    const time = stampModalTime.value;
    if (!time) return;

    // Zukunft verhindern wenn Datum = heute
    const dateKey = stampEditDate?.value || getTodayKey();
    if (dateKey === getTodayKey()) {
      const nowStr = formatTimeHHMM(new Date());
      if (time > nowStr) {
        showToast(`Zeit darf nicht in der Zukunft liegen (jetzt: ${nowStr}).`);
        return;
      }
    }

    if (stampModalCallback) stampModalCallback(stampModalSelectedType, time);
    closeStampModal();
  });
}

adminInnerTabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.adminTab;
    if (!target) return;

    stopPraesenzPolling();

    adminActiveInnerTab = target;

    adminInnerTabButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.admin-tab-content').forEach((c) => {
      c.classList.remove('active');
      if (c.dataset.adminContent === target) c.classList.add('active');
    });
    if (target === 'overview') {
      loadAdminSummary();
    } else if (target === 'anlagen') {
      const previouslySelectedKomNr = selectedKomNr;

      anlagenSummaryCache.clear();
      anlagenDetailCache.clear();

      loadAdminAnlagenSummary({ force: true });

      if (previouslySelectedKomNr) {
        selectedKomNr = previouslySelectedKomNr;
        loadAdminAnlagenDetail(previouslySelectedKomNr, { force: true });
      }
    } else if (target === 'payroll') {
      loadAdminPayroll();
    } else if (target === 'users') {
      loadAdminUsers();
    } else if (target === 'praesenz') {
      loadAdminPraesenz();
    } else if (target === 'personnel') {
      loadAdminPersonnel();
    }
  });
});

dayButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const day = btn.dataset.day;

    // Aktiven Button setzen
    dayButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    // WICHTIG: Inhalt + Titel aktualisieren
    showDay(day);

    applyFlagsForCurrentDay();
    applyDayHoursForCurrentDay();
    applyMealAllowanceForCurrentDay();
    applyKomForCurrentDay();
    applySpecialEntriesForCurrentDay();
    updateDayTotalFromInputs();
    applyWeekLockUI();
  });
});

async function loadDraftFromServer() {
  try {
    const res = await authFetch('/api/draft/load');
    const data = await res.json();

    if (!data.ok || !data.draft) return; // kein Draft vorhanden

    const draft = data.draft;
    const serverTime = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;

    // Lokalen Timestamp prüfen
    const localRaw = localStorage.getItem(STORAGE_KEY + '_savedAt');
    const localTime = localRaw ? new Date(localRaw).getTime() : 0;

    if (serverTime > localTime) {
      if (draft.dayStore && typeof draft.dayStore === 'object') {
        const { year, month } = draft;
        Object.keys(dayStore).forEach((dateKey) => {
          const d = new Date(dateKey + 'T00:00:00');
          if (d.getFullYear() === year && d.getMonth() === month) {
            delete dayStore[dateKey];
          }
        });
        Object.assign(dayStore, draft.dayStore);

        // WICHTIG: saveToStorage() NICHT aufrufen — würde _savedAt überschreiben
        // Direkt in localStorage schreiben ohne Timestamp-Update:
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(dayStore));
          // _savedAt auf Server-Zeit setzen damit nächster Vergleich korrekt ist
          localStorage.setItem(STORAGE_KEY + '_savedAt', data.updatedAt);
        } catch (err) {
          console.error('Failed to write draft to localStorage', err);
        }
      }
      if (Array.isArray(draft.pikettStore)) {
        pikettStore = draft.pikettStore;
        savePikettStore();
      }
    }
  } catch (err) {
    console.error('Draft load failed', err);
  }
}

// ============================================================================
// 🦕 Dino Easter Egg
// ============================================================================
(function () {
  if (!userDisplayEl || !dinoModal || !dinoCanvas) return;

  let dinoClickCount = 0;
  let dinoClickTimer = null;

  userDisplayEl.addEventListener('click', () => {
    dinoClickCount++;
    clearTimeout(dinoClickTimer);
    dinoClickTimer = setTimeout(() => {
      dinoClickCount = 0;
    }, 600);
    if (dinoClickCount >= 3) {
      dinoClickCount = 0;
      dinoModal.classList.remove('hidden');
      loadHighscores();
      startDino();
    }
  });

  dinoModalClose?.addEventListener('click', stopDino);
  dinoModal?.addEventListener('click', (e) => {
    if (e.target === dinoModal) stopDino();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') stopDino();
  });

  const dinoHighscoresEl = document.getElementById('dinoHighscores');
  const rankLabels = [
    { label: '🥇', cls: 'gold' },
    { label: '🥈', cls: 'silver' },
    { label: '🥉', cls: 'bronze' },
  ];

  async function loadHighscores() {
    if (!dinoHighscoresEl) return;
    try {
      const res = await authFetch('/api/dino-scores/top');
      const data = await res.json();
      if (!data.ok) return;
      dinoHighscoresEl.innerHTML = '';
      data.scores.forEach((s, i) => {
        const entry = document.createElement('div');
        entry.className = 'dino-score-entry';
        entry.innerHTML = `
          <span class="dino-score-rank ${rankLabels[i].cls}">${rankLabels[i].label}</span>
          <span class="dino-score-name">${escapeHtml(s.username)}</span>
          <span class="dino-score-val">${s.score}</span>
        `;
        dinoHighscoresEl.appendChild(entry);
      });
    } catch {}
  }

  async function saveScore(s) {
    try {
      await authFetch('/api/dino-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: s }),
      });
      await loadHighscores();
    } catch {}
  }

  let animFrame = null;
  let gameRunning = false;
  let W, H, GROUND;
  let dino, obstacles, score, speed, frameCount, gameOver;

  function initCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const logicalW = dinoCanvas.parentElement.clientWidth - 32 || 560;
    const logicalH = 200;
    W = logicalW;
    H = logicalH;
    GROUND = H - 80;
    dinoCanvas.width = logicalW * dpr;
    dinoCanvas.height = logicalH * dpr;
    dinoCanvas.style.width = logicalW + 'px';
    dinoCanvas.style.height = logicalH + 'px';
    const ctx = dinoCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
  }

  function getCtx() {
    return dinoCanvas.getContext('2d');
  }

  function resetGame() {
    dino = { x: 60, y: GROUND, w: 54, h: 58, vy: 0, onGround: true };
    obstacles = [];
    score = 0;
    speed = 5.5;
    frameCount = 0;
    gameOver = false;
  }

  function jump() {
    if (dino.onGround) {
      dino.vy = -13;
      dino.onGround = false;
    }
  }

  function drawDino(ctx, x, y, onGround, frame) {
    const p = 4; // pixel size
    const runFrame = onGround && Math.floor(frame / 8) % 2 === 0;

    const g = (px, py, pw, ph, color) => {
      ctx.fillStyle = color || '#16a34a';
      ctx.fillRect(x + px * p, y + py * p, pw * p, ph * p);
    };

    // Spikes
    g(4, 0, 2, 2);
    g(6, 0, 2, 3);
    g(8, 0, 2, 2);
    // Head
    g(8, 2, 6, 2);
    g(7, 4, 8, 3);
    // Eye
    g(11, 4, 2, 2, 'white');
    g(12, 5, 1, 1, '#111');
    g(12, 4, 1, 1, 'white');
    // Jaw
    g(8, 7, 6, 1);
    g(9, 8, 5, 1);
    // Teeth
    g(9, 8, 1, 1, 'white');
    g(11, 8, 1, 1, 'white');
    g(13, 8, 1, 1, 'white');
    // Tongue
    g(13, 7, 2, 1, '#ef4444');
    // Neck
    g(5, 5, 3, 3);
    // Body
    g(1, 7, 8, 6);
    // Belly
    g(2, 8, 5, 4, '#4ade80');
    // Arm
    g(7, 8, 2, 2);
    g(7, 9, 3, 1);
    // Tail
    g(0, 9, 2, 3);
    g(0, 11, 1, 1);

    // Legs — animation
    if (!onGround) {
      // Tucked
      g(1, 13, 2, 2);
      g(1, 14, 3, 1);
      g(4, 13, 2, 2);
      g(4, 14, 3, 1);
    } else if (runFrame) {
      // Frame 1
      g(1, 13, 2, 3);
      g(1, 15, 3, 1);
      g(4, 13, 2, 3);
      g(4, 15, 3, 1);
    } else {
      // Frame 2 — left leg raised
      g(1, 12, 2, 2);
      g(2, 13, 3, 1);
      g(4, 13, 2, 3);
      g(4, 15, 3, 1);
    }
  }

  function handleInput(e) {
    if (e.type === 'keydown') {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        jump();
      }
    } else {
      e.preventDefault();
      if (gameOver) {
        resetGame();
      } else {
        jump();
      }
    }
  }

  // Background layers
  let bgOffset1 = 0; // clouds
  let bgOffset2 = 0; // mountains
  let bgOffset3 = 0; // ground detail

  function drawBackground(ctx) {
    // Sky
    ctx.fillStyle = '#dbeafe';
    ctx.fillRect(0, 0, W, H);

    // Clouds
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const cloudPositions = [0, 200, 420, 620];
    cloudPositions.forEach((cx) => {
      const x = ((((cx - bgOffset1) % (W + 120)) + W + 120) % (W + 120)) - 60;
      ctx.beginPath();
      ctx.ellipse(x, 28, 30, 12, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 18, 22, 22, 14, 0, 0, Math.PI * 2);
      ctx.ellipse(x - 14, 24, 18, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // Mountains
    ctx.fillStyle = '#bfdbfe';
    const mtnPositions = [80, 260, 440, 600];
    mtnPositions.forEach((mx) => {
      const x = ((((mx - bgOffset2) % (W + 200)) + W + 200) % (W + 200)) - 80;
      ctx.beginPath();
      ctx.moveTo(x - 70, GROUND + dino.h);
      ctx.lineTo(x, GROUND + dino.h - 90);
      ctx.lineTo(x + 70, GROUND + dino.h);
      ctx.fill();
    });

    // Ground strip
    ctx.fillStyle = '#6b8c42';
    ctx.fillRect(0, GROUND + dino.h, W, 8);
    ctx.fillStyle = '#8fb45a';
    ctx.fillRect(0, GROUND + dino.h + 8, W, H - GROUND - dino.h - 8);

    // Ground detail pixels
    ctx.fillStyle = '#5a7a35';
    const detailPositions = [0, 60, 130, 210, 290, 380, 470, 560];
    detailPositions.forEach((dx) => {
      const x = (((dx - bgOffset3) % (W + 40)) + W + 40) % (W + 40);
      ctx.fillRect(x, GROUND + dino.h, 8, 4);
    });
  }

  function drawObstacle(ctx, o) {
    const p = 3;
    const g = (px, py, pw, ph, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(
        o.x + px * p,
        GROUND + dino.h - o.h + py * p,
        pw * p,
        ph * p
      );
    };

    if (o.type === 'cactus') {
      // Kaktus
      g(3, 0, 3, 20, '#2d7a2d');
      g(0, 5, 3, 2, '#2d7a2d');
      g(0, 3, 2, 4, '#2d7a2d');
      g(6, 6, 3, 2, '#2d7a2d');
      g(7, 4, 2, 4, '#2d7a2d');
      g(3, 0, 1, 2, '#1a5c1a');
      g(0, 3, 2, 1, '#1a5c1a');
      g(7, 4, 2, 1, '#1a5c1a');
    } else if (o.type === 'cactus2') {
      // Doppelkaktus
      g(2, 0, 3, 16, '#2d7a2d');
      g(0, 4, 2, 2, '#2d7a2d');
      g(0, 2, 1, 4, '#2d7a2d');
      g(5, 5, 2, 2, '#2d7a2d');
      g(6, 3, 1, 4, '#2d7a2d');
      g(8, 2, 3, 13, '#2d7a2d');
      g(7, 5, 1, 2, '#2d7a2d');
      g(11, 4, 1, 2, '#2d7a2d');
    } else if (o.type === 'rock') {
      // Fels
      g(1, 0, 12, 3, '#888');
      g(0, 3, 15, 7, '#888');
      g(1, 1, 3, 2, '#aaa');
      g(5, 0, 2, 2, '#aaa');
      g(9, 1, 4, 2, '#aaa');
      g(0, 4, 4, 3, '#999');
      g(6, 4, 6, 3, '#999');
    } else if (o.type === 'tree') {
      // Baum
      g(3, 0, 3, 26, '#5a3e1b');
      g(0, 6, 9, 2, '#5a3e1b');
      g(0, 0, 4, 8, '#3a9a3a');
      g(5, 2, 4, 6, '#2d7a2d');
      g(1, 0, 7, 4, '#4ab84a');
    }
  }

  const obstacleTypes = ['cactus', 'cactus', 'cactus2', 'rock', 'tree'];
  const obstacleHeights = { cactus: 60, cactus2: 48, rock: 30, tree: 78 };
  const obstacleWidths = { cactus: 27, cactus2: 36, rock: 45, tree: 27 };

  function startDino() {
    initCanvas();
    resetGame();
    bgOffset1 = 0;
    bgOffset2 = 0;
    bgOffset3 = 0;
    gameRunning = true;
    document.addEventListener('keydown', handleInput);
    dinoCanvas.addEventListener('touchstart', handleInput, { passive: false });
    dinoCanvas.addEventListener('click', handleInput);

    function loop() {
      if (!gameRunning) return;
      const ctx = getCtx();

      // Scroll background
      if (!gameOver) {
        bgOffset1 += speed * 0.15;
        bgOffset2 += speed * 0.3;
        bgOffset3 += speed;
      }

      drawBackground(ctx);

      // Physics
      dino.vy += 0.7;
      dino.y += dino.vy;
      if (dino.y >= GROUND) {
        dino.y = GROUND;
        dino.vy = 0;
        dino.onGround = true;
      }

      // Dino
      drawDino(ctx, dino.x, dino.y, dino.onGround, frameCount);

      // Obstacles
      if (!gameOver) frameCount++;
      speed = 5.5 + Math.floor(score / 300) * 0.6;
      const interval = Math.max(45, 80 - Math.floor(score / 150));
      if (!gameOver && frameCount % interval === 0) {
        const type =
          obstacleTypes[Math.floor(Math.random() * obstacleTypes.length)];
        const h = obstacleHeights[type];
        const w = obstacleWidths[type];
        obstacles.push({ x: W, w, h, type });
        if (score > 300 && Math.random() < 0.25) {
          const type2 =
            obstacleTypes[Math.floor(Math.random() * obstacleTypes.length)];
          obstacles.push({
            x: W + obstacleWidths[type] + 20,
            w: obstacleWidths[type2],
            h: obstacleHeights[type2],
            type: type2,
          });
        }
      }

      for (let i = obstacles.length - 1; i >= 0; i--) {
        const o = obstacles[i];
        if (!gameOver) o.x -= speed;
        drawObstacle(ctx, o);
        if (
          dino.x + 8 < o.x + o.w &&
          dino.x + dino.w - 8 > o.x &&
          dino.y + 10 < GROUND + dino.h &&
          dino.y + dino.h > GROUND + dino.h - o.h
        ) {
          if (!gameOver) saveScore(score);
          gameOver = true;
        }
        if (o.x + o.w < 0) {
          obstacles.splice(i, 1);
          if (!gameOver) score += 10;
        }
      }

      // Score
      ctx.fillStyle = '#1e40af';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${score}`, W - 60, 24);

      if (gameOver) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', W / 2, H / 2 - 12);
        ctx.font = '13px monospace';
        ctx.fillText('Tippen oder ↑ zum Neustart', W / 2, H / 2 + 14);
        ctx.textAlign = 'left';
      }

      animFrame = requestAnimationFrame(loop);
    }

    animFrame = requestAnimationFrame(loop);
  }

  function stopDino() {
    gameRunning = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    document.removeEventListener('keydown', handleInput);
    dinoCanvas.removeEventListener('touchstart', handleInput);
    dinoCanvas.removeEventListener('click', handleInput);
    dinoModal.classList.add('hidden');
    getCtx().clearRect(0, 0, W, H);
  }
})();

/**
 * Reload all per-user draft stores after login/logout/session restoration and refresh the visible UI.
 */
function reloadAllDataForCurrentUser() {
  const user = getCurrentUser();
  updateStorageKeysForUser(user);

  Object.keys(dayStore).forEach((k) => delete dayStore[k]);
  loadFromStorage();
  pikettStore = loadPikettStore();
  absenceRequests = loadAbsenceRequests();

  // Draft vom Server laden (async, überschreibt wenn Server neuer)
  loadDraftFromServer().then(() => {
    _draftLoadComplete = true;

    // Polling: alle 30s Server-Stand abholen (Multi-Device Sync)
    if (!import.meta.env.DEV) {
      setInterval(async () => {
        if (_draftLoadComplete) await loadDraftFromServer();
      }, 30_000);
    }
    renderWeekInfo();
    updateDayTitleWithDate();
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
    applyWeekLockUI();
  });
}

/**
 * Bootstrap
 */
initAuthView();
