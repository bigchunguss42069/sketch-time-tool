'use strict';

/**
 * @fileoverview Anwendungskonstanten für sketch-time-tool
 *
 * Dieses Modul enthält alle fixen Konfigurationswerte der Anwendung:
 * - Teams (Norm Aufzüge AG)
 * - Lohnperioden-Konfiguration pro Jahr (Vorarbeitsziel)
 * - Seed-User für initiales DB-Setup
 * - Kommissions-Optionen und Labels
 *
 * Neue Jahre: PAYROLL_YEAR_CONFIG und Feiertage in holidays.js ergänzen.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Teams
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Teams der Norm Aufzüge AG.
 * Die `id` wird als Fremdschlüssel in DB-Tabellen verwendet.
 *
 * @type {Array<{ id: string, name: string }>}
 */
const TEAMS = [
  { id: 'montage', name: 'Team Montage' },
  { id: 'werkstatt', name: 'Team Werkstatt' },
  { id: 'service', name: 'Team Service' },
  { id: 'büro', name: 'Team Büro' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Lohnperioden-Konfiguration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vorarbeitsziel in Stunden pro Jahr (100% Pensum).
 * Bei Teilzeit wird das Ziel proportional reduziert.
 *
 * Neues Jahr hinzufügen wenn nötig — gleichzeitig Feiertage in holidays.js ergänzen.
 *
 * @type {Record<number, { vorarbeitRequired: number }>}
 */
const PAYROLL_YEAR_CONFIG = {
  2025: { vorarbeitRequired: 39 },
  2026: { vorarbeitRequired: 59 },
};

/**
 * Gibt die Lohnkonfiguration für ein Jahr zurück.
 * Gibt { vorarbeitRequired: 0 } zurück wenn das Jahr nicht konfiguriert ist.
 *
 * @param {number} year
 * @returns {{ vorarbeitRequired: number }}
 */
function getPayrollYearConfig(year) {
  return PAYROLL_YEAR_CONFIG[year] || { vorarbeitRequired: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed-User
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initial-User die beim ersten Server-Start angelegt werden wenn sie nicht existieren.
 * Passwörter kommen aus Umgebungsvariablen (nie im Code hardcoden).
 *
 * @type {Array<{ id: string, username: string, passwordEnv: string, role: string, teamId: string }>}
 */
const INITIAL_USERS = [
  {
    id: 'u1',
    username: 'demo',
    passwordEnv: 'SEED_PASSWORD_DEMO',
    role: 'user',
    teamId: 'montage',
  },
  {
    id: 'u2',
    username: 'chef',
    passwordEnv: 'SEED_PASSWORD_CHEF',
    role: 'admin',
    teamId: 'montage',
  },
  {
    id: 'u3',
    username: 'markus',
    passwordEnv: 'SEED_PASSWORD_MARKUS',
    role: 'user',
    teamId: 'montage',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Kommissions-Optionen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Labels für die Kommissions-Optionen in der Day Card.
 * Keys entsprechen den Feldern in `dayData.entries[].hours`.
 *
 * @type {Record<string, string>}
 */
const OPTION_LABELS = {
  option1: 'Montage',
  option2: 'Demontage',
  option3: 'Transport',
  option4: 'Inbetreibnahme',
  option5: 'Abnahme',
  option6: 'Werk',
  _regie: 'Regie',
  _fehler: 'Fehler',
};

/**
 * Gibt das lesbare Label für einen Operationsschlüssel zurück.
 * Gibt den Key selbst zurück wenn kein Label definiert ist.
 *
 * @param {string} opKey
 * @returns {string}
 */
function getOperationLabel(opKey) {
  return OPTION_LABELS[opKey] || opKey;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  TEAMS,
  PAYROLL_YEAR_CONFIG,
  getPayrollYearConfig,
  INITIAL_USERS,
  OPTION_LABELS,
  getOperationLabel,
};
