'use strict';

/**
 * @fileoverview Cron-Jobs und Email-Benachrichtigungen
 *
 * Enthält:
 * - createMailTransporter  — Nodemailer SMTP-Transporter
 * - checkAndSendStampAlerts — 18:00 Warnung für nicht ausgestempelte Mitarbeiter
 * - registerCronJobs        — Registriert alle Cron-Jobs beim Server-Start
 *
 * Cron-Jobs:
 * - 18:00 Mo-Fr: Stamp-Alert Email
 * - 02:00 täglich: Auto-Transmit aller User
 * - 12:00 Mo: Auto-Lock vergangene Woche
 */

const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { formatDateKey } = require('./holidays');

// ─────────────────────────────────────────────────────────────────────────────
// Mail-Transporter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt einen Nodemailer SMTP-Transporter.
 * Konfiguration kommt aus .env Variablen.
 *
 * @returns {import('nodemailer').Transporter}
 */
function createMailTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.infomaniak.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    family: 4, // IPv4 erzwingen
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stamp-Alert
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Email-Empfänger pro Team (aus .env).
 * Nur Teams mit konfigurierten Adressen werden geprüft.
 */
const ALERT_TEAMS = {
  montage: (process.env.ALERT_EMAIL_MONTAGE || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  service: (process.env.ALERT_EMAIL_SERVICE || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

/**
 * Prüft live_stamps und sendet Email an Teamleiter wenn jemand
 * um 18:00 noch eingestempelt ist.
 *
 * @param {import('pg').Pool} db
 */
async function checkAndSendStampAlerts(db) {
  const todayKey = formatDateKey(new Date());

  const result = await db.query(
    `SELECT l.username, l.stamps, l.today_key, u.team_id
     FROM live_stamps l
     LEFT JOIN users u ON u.username = l.username
     WHERE l.today_key = $1`,
    [todayKey]
  );

  const alertTeams = Object.keys(ALERT_TEAMS).filter(
    (t) => ALERT_TEAMS[t].length > 0
  );
  if (alertTeams.length === 0) return;

  const alertsByTeam = {};

  for (const row of result.rows) {
    const teamId = row.team_id || '';
    if (!alertTeams.includes(teamId)) continue;

    const stamps = Array.isArray(row.stamps) ? row.stamps : [];
    if (stamps.length === 0) continue;

    const sorted = [...stamps].sort((a, b) => a.time.localeCompare(b.time));
    const lastStamp = sorted[sorted.length - 1];
    if (lastStamp.type !== 'in') continue;

    if (!alertsByTeam[teamId]) alertsByTeam[teamId] = [];
    alertsByTeam[teamId].push({
      username: row.username,
      lastTime: lastStamp.time,
    });
  }

  if (Object.keys(alertsByTeam).length === 0) {
    console.log('[StampAlert] Alle ausgestempelt — keine Meldung nötig.');
    return;
  }

  const transporter = createMailTransporter();

  for (const [teamId, users] of Object.entries(alertsByTeam)) {
    const recipients = ALERT_TEAMS[teamId];
    if (!recipients.length) continue;

    const teamLabel = teamId.charAt(0).toUpperCase() + teamId.slice(1);
    const userList = users
      .map((u) => `• ${u.username} — eingestempelt seit ${u.lastTime} Uhr`)
      .join('\n');

    const text = `Guten Abend\n\nFolgende Mitarbeiter des Teams ${teamLabel} sind um 18:00 Uhr noch eingestempelt:\n\n${userList}\n\nBitte prüfen.\n\nFreundliche Grüsse\nNorm Aufzüge AG`;

    try {
      await transporter.sendMail({
        from: `"Norm Aufzüge" <${process.env.SMTP_USER}>`,
        to: recipients.join(', '),
        subject: `⚠️ Nicht ausgestempelt – Team ${teamLabel} – ${todayKey}`,
        text,
      });
      console.log(
        `[StampAlert] Email gesendet für Team ${teamId} an ${recipients.join(', ')}`
      );
    } catch (err) {
      console.error(`[StampAlert] Email-Fehler Team ${teamId}:`, err.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron-Jobs registrieren
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registriert alle Cron-Jobs.
 * Muss nach dem Server-Start aufgerufen werden.
 *
 * @param {import('pg').Pool} db
 * @param {{ autoTransmitForUser: Function, autoLockPreviousWeek: Function, listUsersFromDb: Function }} deps
 */
function registerCronJobs(
  db,
  { autoTransmitForUser, autoLockPreviousWeek, listUsersFromDb }
) {
  // 18:00 Mo-Fr — Stamp-Alert
  cron.schedule(
    '0 18 * * 1-5',
    async () => {
      console.log('[StampAlert] Prüfe nicht ausgestempelte Mitarbeiter...');
      try {
        await checkAndSendStampAlerts(db);
      } catch (err) {
        console.error('[StampAlert] Fehler:', err);
      }
    },
    { timezone: 'Europe/Zurich' }
  );

  // 02:00 täglich — Auto-Transmit
  cron.schedule(
    '0 2 * * *',
    async () => {
      console.log('[AutoTransmit] Starte tägliche Auto-Übertragung...');
      try {
        const users = await listUsersFromDb({ role: 'user' });
        for (const user of users) {
          try {
            await autoTransmitForUser(user);
          } catch (err) {
            console.error(
              `[AutoTransmit] Fehler bei ${user.username}:`,
              err.message
            );
          }
        }
        console.log('[AutoTransmit] Abgeschlossen.');
      } catch (err) {
        console.error('[AutoTransmit] Kritischer Fehler:', err);
      }
    },
    { timezone: 'Europe/Zurich' }
  );

  // 12:00 Mo — Auto-Lock vergangene Woche
  cron.schedule('0 12 * * 1', () => autoLockPreviousWeek(listUsersFromDb), {
    timezone: 'Europe/Zurich',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  createMailTransporter,
  checkAndSendStampAlerts,
  registerCronJobs,
};
