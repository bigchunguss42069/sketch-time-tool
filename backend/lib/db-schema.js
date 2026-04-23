'use strict';

/**
 * @fileoverview Datenbank-Schema: Tabellenerstellung und initiales Seeding
 *
 * Alle `ensureXxxTable()` Funktionen sind idempotent — sie verwenden
 * `CREATE TABLE IF NOT EXISTS` und `ADD COLUMN IF NOT EXISTS`.
 * Sie können bei jedem Server-Start sicher aufgerufen werden.
 *
 * Reihenfolge beim Start (wegen Foreign Keys):
 * 1. ensureUsersTable        — Basis für alle anderen Tabellen
 * 2. ensureSessionsTable     — braucht users
 * 3. ensureMonthSubmissionsTable
 * 4. ensureKontenTables      — inkl. konto_adjustments, password_reset_tokens
 * 5. ensureAbsencesTable
 * 6. ensureWeekLocksTable
 * 7. ensureDraftsTable
 * 8. ensureLiveStampsTable
 * 9. ensureStampEditsTable
 * 10. ensureWorkSchedulesTable
 * 11. ensureAnlagenTables
 * 12. seedInitialUsers       — nur wenn DB leer
 *
 * @example
 * const { initializeDatabase } = require('./lib/db-schema');
 * await initializeDatabase(db, INITIAL_USERS);
 */

const argon2 = require('argon2');

// ─────────────────────────────────────────────────────────────────────────────
// Users + Dino Scores
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt die users und dino_scores Tabellen.
 * Fügt neue Spalten via ALTER TABLE IF NOT EXISTS hinzu (Migration).
 *
 * @param {import('pg').Pool} db
 */
async function ensureUsersTable(db) {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
      team_id TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Migrations
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
  await db.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_start DATE`
  );
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_year INT`);
  await db.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_non_smoker BOOLEAN NOT NULL DEFAULT FALSE`
  );
  await db.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_kader BOOLEAN NOT NULL DEFAULT FALSE`
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS dino_scores (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      score INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Month Submissions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt die month_submissions Tabelle mit Indizes.
 *
 * @param {import('pg').Pool} db
 */
async function ensureMonthSubmissionsTable(db) {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS month_submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      team_id TEXT,
      year INTEGER NOT NULL,
      month_index INTEGER NOT NULL CHECK (month_index BETWEEN 0 AND 11),
      month_label TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      totals JSONB NOT NULL DEFAULT '{}'::jsonb,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_month_submissions_username_month_sent_at
    ON month_submissions (username, year, month_index, sent_at DESC, created_at DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_month_submissions_username_sent_at
    ON month_submissions (username, sent_at DESC, created_at DESC)
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Konten, Snapshots, Adjustments, Password Reset
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt konten, konten_snapshots, konto_adjustments und password_reset_tokens.
 *
 * @param {import('pg').Pool} db
 */
async function ensureKontenTables(db) {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS konten (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL UNIQUE,
      team_id TEXT,
      ue_z1 DOUBLE PRECISION NOT NULL DEFAULT 0,
      ue_z2 DOUBLE PRECISION NOT NULL DEFAULT 0,
      ue_z3 DOUBLE PRECISION NOT NULL DEFAULT 0,
      ue_z1_positive_by_year JSONB NOT NULL DEFAULT '{}'::jsonb,
      vacation_days DOUBLE PRECISION NOT NULL DEFAULT 0,
      vacation_days_per_year DOUBLE PRECISION NOT NULL DEFAULT 21,
      credited_years JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS konten_snapshots (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      year INTEGER NOT NULL,
      month_index INTEGER NOT NULL CHECK (month_index BETWEEN 0 AND 11),
      month_key TEXT NOT NULL,
      ue_z1 DOUBLE PRECISION NOT NULL DEFAULT 0,
      ue_z1_positive DOUBLE PRECISION NOT NULL DEFAULT 0,
      ue_z2 DOUBLE PRECISION NOT NULL DEFAULT 0,
      ue_z3 DOUBLE PRECISION NOT NULL DEFAULT 0,
      vac_used DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, year, month_index)
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_konten_snapshots_username_month
    ON konten_snapshots (username, year, month_index)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_konten_snapshots_username_month_key
    ON konten_snapshots (username, month_key)
  `);

  // Migrations
  await db.query(
    `ALTER TABLE konten ADD COLUMN IF NOT EXISTS vorarbeit_balance DOUBLE PRECISION NOT NULL DEFAULT 0`
  );
  await db.query(
    `ALTER TABLE konten_snapshots ADD COLUMN IF NOT EXISTS vorarbeit_balance DOUBLE PRECISION NOT NULL DEFAULT 0`
  );
  await db.query(
    `ALTER TABLE konten ADD COLUMN IF NOT EXISTS ue_z1_correction DOUBLE PRECISION NOT NULL DEFAULT 0`
  );
  await db.query(
    `ALTER TABLE konten ADD COLUMN IF NOT EXISTS ue_z2_correction DOUBLE PRECISION NOT NULL DEFAULT 0`
  );
  await db.query(
    `ALTER TABLE konten ADD COLUMN IF NOT EXISTS ue_z3_correction DOUBLE PRECISION NOT NULL DEFAULT 0`
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS konto_adjustments (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      admin_username TEXT NOT NULL,
      field TEXT NOT NULL,
      old_value DOUBLE PRECISION,
      new_value DOUBLE PRECISION,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Absenzen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt die absences Tabelle mit Indizes.
 *
 * @param {import('pg').Pool} db
 */
async function ensureAbsencesTable(db) {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS absences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      team_id TEXT,
      type TEXT NOT NULL,
      from_date DATE NOT NULL,
      to_date DATE NOT NULL,
      days DOUBLE PRECISION,
      comment TEXT,
      status TEXT NOT NULL CHECK (
        status IN ('pending', 'accepted', 'rejected', 'cancel_requested', 'cancelled')
      ),
      created_at TIMESTAMPTZ NOT NULL,
      created_by TEXT,
      decided_at TIMESTAMPTZ,
      decided_by TEXT,
      cancel_requested_at TIMESTAMPTZ,
      cancel_requested_by TEXT
    )
  `);

  // Migration
  await db.query(
    `ALTER TABLE absences ADD COLUMN IF NOT EXISTS hours DOUBLE PRECISION`
  );

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_absences_username_created
    ON absences (username, created_at DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_absences_status_created
    ON absences (status, created_at DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_absences_username_range
    ON absences (username, from_date, to_date)
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Week Locks, Drafts, Live Stamps, Stamp Edits, Work Schedules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {import('pg').Pool} db
 */
async function ensureWeekLocksTable(db) {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS week_locks (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      week_year INTEGER NOT NULL,
      week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 53),
      locked_at TIMESTAMPTZ NOT NULL,
      locked_by TEXT,
      PRIMARY KEY (user_id, week_year, week)
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_week_locks_username_week
    ON week_locks (username, week_year, week)
  `);
}

/**
 * @param {import('pg').Pool} db
 */
async function ensureDraftsTable(db) {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_drafts (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * @param {import('pg').Pool} db
 */
async function ensureLiveStampsTable(db) {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS live_stamps (
      user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      username  TEXT NOT NULL,
      today_key TEXT NOT NULL,
      stamps    JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * @param {import('pg').Pool} db
 */
async function ensureStampEditsTable(db) {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS stamp_edits (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username    TEXT NOT NULL,
      date_key    TEXT NOT NULL,
      action      TEXT NOT NULL CHECK (action IN ('added','edited','deleted')),
      old_time    TEXT,
      new_time    TEXT,
      old_type    TEXT,
      new_type    TEXT,
      transmitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      year        INTEGER NOT NULL,
      month_index INTEGER NOT NULL
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_stamp_edits_username_month
    ON stamp_edits (username, year, month_index, transmitted_at DESC)
  `);
}

/**
 * @param {import('pg').Pool} db
 */
async function ensureWorkSchedulesTable(db) {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS work_schedules (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username    TEXT NOT NULL,
      employment_pct INTEGER NOT NULL DEFAULT 100,
      work_days   JSONB NOT NULL DEFAULT '{"mon":8.0,"tue":8.0,"wed":8.0,"thu":8.0,"fri":8.0}'::jsonb,
      valid_from  DATE NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_work_schedules_user_valid
    ON work_schedules (user_id, valid_from DESC)
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Anlagen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt alle Anlagen-Tabellen: archive, snapshots, ledger, index_state.
 *
 * @param {import('pg').Pool} db
 */
async function ensureAnlagenTables(db) {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS anlagen_archive (
      team_id TEXT NOT NULL,
      kom_nr TEXT NOT NULL,
      archived_at TIMESTAMPTZ NOT NULL,
      archived_by TEXT,
      PRIMARY KEY (team_id, kom_nr)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS anlagen_month_snapshots (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      team_id TEXT,
      year INTEGER NOT NULL,
      month_index INTEGER NOT NULL CHECK (month_index BETWEEN 0 AND 11),
      month_key TEXT NOT NULL,
      snapshot JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, year, month_index)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS anlagen_ledger_entries (
      team_id TEXT NOT NULL,
      kom_nr TEXT NOT NULL,
      username TEXT NOT NULL,
      date_key DATE NOT NULL,
      hours DOUBLE PRECISION NOT NULL,
      PRIMARY KEY (team_id, kom_nr, username, date_key)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS anlagen_index_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_anlagen_archive_team
    ON anlagen_archive (team_id, kom_nr)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_anlagen_snapshots_username_month
    ON anlagen_month_snapshots (username, year, month_index)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_anlagen_ledger_team_kom
    ON anlagen_ledger_entries (team_id, kom_nr, username, date_key)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_anlagen_ledger_username_date
    ON anlagen_ledger_entries (username, date_key)
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Seeding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Legt Initial-User an wenn die DB noch leer ist.
 * Wird nur beim allerersten Server-Start ausgeführt.
 *
 * @param {import('pg').Pool} db
 * @param {Array} initialUsers - aus constants.js
 */
async function seedInitialUsers(db, initialUsers) {
  if (!db) return;

  const existing = await db.query('SELECT COUNT(*)::int AS count FROM users');
  const count = existing.rows[0]?.count || 0;
  if (count > 0) return;

  for (const user of initialUsers) {
    const plainPassword = process.env[user.passwordEnv];
    if (!plainPassword) {
      throw new Error(`Missing required env var: ${user.passwordEnv}`);
    }

    const passwordHash = await argon2.hash(plainPassword, {
      type: argon2.argon2id,
    });

    await db.query(
      `INSERT INTO users (id, username, password_hash, role, team_id, active)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [user.id, user.username, passwordHash, user.role, user.teamId]
    );
  }

  console.log('Initial users seeded into Postgres.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: alle Tabellen auf einmal initialisieren
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialisiert alle DB-Tabellen und seeded Initial-User.
 * Wird in startServer() aufgerufen.
 *
 * @param {import('pg').Pool} db
 * @param {Array} initialUsers - aus constants.js
 */
async function initializeDatabase(db, initialUsers) {
  await ensureUsersTable(db);
  await ensureSessionsTable(db);
  await ensureMonthSubmissionsTable(db);
  await ensureKontenTables(db);
  await ensureAbsencesTable(db);
  await ensureWeekLocksTable(db);
  await ensureDraftsTable(db);
  await ensureLiveStampsTable(db);
  await ensureStampEditsTable(db);
  await ensureWorkSchedulesTable(db);
  await ensureAnlagenTables(db);
  await seedInitialUsers(db, initialUsers);
}

// Stub für ensureSessionsTable — wird von auth.js geliefert
// aber auch hier gebraucht für den Call in initializeDatabase
async function ensureSessionsTable(db) {
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
    ON auth_sessions (user_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked
    ON auth_sessions (revoked_at)
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  ensureUsersTable,
  ensureSessionsTable,
  ensureMonthSubmissionsTable,
  ensureKontenTables,
  ensureAbsencesTable,
  ensureWeekLocksTable,
  ensureDraftsTable,
  ensureLiveStampsTable,
  ensureStampEditsTable,
  ensureWorkSchedulesTable,
  ensureAnlagenTables,
  seedInitialUsers,
  initializeDatabase,
};
