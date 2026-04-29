'use strict';

/**
 * @fileoverview Präsenz Audit PDF — Route und Generierung
 *
 * Erstellt ein PDF mit allen Stempelzeiten der letzten 5 Jahre
 * für alle aktiven User. Wird für SECO-Kontrollen verwendet.
 *
 * Inhalt pro Mitarbeiter:
 * - Name und Team
 * - Pro Monat: alle gestempelten Tage mit Ein/Aus-Zeiten und Netto-Stunden
 * - Offene Stempel (kein Aus) werden übersprungen
 *
 * Route: GET /api/admin/audit-pdf
 */

const PDFDocument = require('pdfkit');
const { formatDateKey } = require('./holidays');

/**
 * Registriert die Audit-PDF Route.
 *
 * @param {import('express').Application} app
 * @param {import('express').RequestHandler} requireAuth
 * @param {import('express').RequestHandler} requireAdmin
 * @param {import('pg').Pool} db
 * @param {Array<{ id: string, name: string }>} TEAMS
 */
function registerAuditPdfRoute(app, requireAuth, requireAdmin, db, TEAMS) {
  app.get(
    '/api/admin/audit-pdf',
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const now = new Date();
        const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), 1);

        // Aktive User laden
        const usersResult = await db.query(`
        SELECT id, username, team_id FROM users
        WHERE active = TRUE AND role = 'user'
        ORDER BY username ASC
      `);
        const users = usersResult.rows;

        // Neueste Submission pro User/Monat der letzten 5 Jahre
        const subResult = await db.query(
          `SELECT DISTINCT ON (username, year, month_index)
           username, year, month_index, payload
         FROM month_submissions
         WHERE sent_at >= $1
         ORDER BY username ASC, year ASC, month_index ASC, sent_at DESC`,
          [fiveYearsAgo.toISOString()]
        );

        // Submissions nach User gruppieren
        const byUser = {};
        users.forEach((u) => {
          byUser[u.username] = { teamId: u.team_id, submissions: [] };
        });
        subResult.rows.forEach((r) => {
          if (byUser[r.username]) {
            byUser[r.username].submissions.push({
              year: r.year,
              monthIndex: r.month_index,
              payload: r.payload,
            });
          }
        });

        const TEAM_MAP = Object.fromEntries(TEAMS.map((t) => [t.id, t.name]));

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="Praesenz-Audit_${now.toISOString().slice(0, 10)}.pdf"`
        );

        const doc = new PDFDocument({
          size: 'A4',
          margin: 50,
          autoFirstPage: true,
        });
        doc.pipe(res);

        // ── Deckblatt ──────────────────────────────────────────────────────────
        doc
          .fontSize(22)
          .font('Helvetica-Bold')
          .text('Präsenz Audit', { align: 'center' });
        doc.moveDown(0.5);
        doc
          .fontSize(12)
          .font('Helvetica')
          .text(
            `Zeitraum: ${fiveYearsAgo.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' })} – ${now.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' })}`,
            { align: 'center' }
          );
        doc.moveDown(0.3);
        doc
          .fontSize(10)
          .fillColor('#6B7280')
          .text(
            `Exportiert am: ${now.toLocaleString('de-CH')} · Norm Aufzüge`,
            { align: 'center' }
          );
        doc.moveDown(2);

        // ── Inhaltsverzeichnis ─────────────────────────────────────────────────
        doc
          .fontSize(14)
          .font('Helvetica-Bold')
          .fillColor('#1e293b')
          .text('Mitarbeiter');
        doc.moveDown(0.5);
        users.forEach((u) => {
          const team = TEAM_MAP[u.team_id] || u.team_id || '–';
          doc
            .fontSize(10)
            .font('Helvetica')
            .fillColor('#374151')
            .text(`• ${u.username}  (${team})`);
        });

        // ── Pro Mitarbeiter ────────────────────────────────────────────────────
        Object.entries(byUser).forEach(
          ([username, { teamId, submissions }]) => {
            doc.addPage();
            const teamName = TEAM_MAP[teamId] || teamId || '–';

            doc
              .fontSize(16)
              .font('Helvetica-Bold')
              .fillColor('#1e293b')
              .text(username);
            doc
              .fontSize(10)
              .font('Helvetica')
              .fillColor('#6B7280')
              .text(`Team: ${teamName}`);
            doc.moveDown(0.8);

            if (submissions.length === 0) {
              doc
                .fontSize(10)
                .fillColor('#94a3b8')
                .text('Keine übertragenen Daten im Zeitraum.');
              return;
            }

            submissions.forEach((sub) => {
              const monthLabel = new Date(
                sub.year,
                sub.monthIndex,
                1
              ).toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });

              doc
                .fontSize(11)
                .font('Helvetica-Bold')
                .fillColor('#334155')
                .text(monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1));
              doc.moveDown(0.3);

              const daysObj = sub.payload?.days || {};
              const sortedDays = Object.keys(daysObj).sort();
              let hasAnyStamp = false;

              sortedDays.forEach((dateKey) => {
                const dayData = daysObj[dateKey];
                const stamps = Array.isArray(dayData?.stamps)
                  ? dayData.stamps
                  : [];
                if (stamps.length === 0) return;

                const sorted = [...stamps].sort((a, b) =>
                  a.time.localeCompare(b.time)
                );

                // Offene Stempel überspringen
                if (
                  sorted.length % 2 !== 0 &&
                  sorted[sorted.length - 1].type === 'in'
                )
                  return;

                hasAnyStamp = true;

                // Datum formatieren
                const d = new Date(dateKey + 'T00:00:00');
                const dateLabel = d.toLocaleDateString('de-CH', {
                  weekday: 'short',
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                });

                // Netto-Stunden berechnen
                let totalMin = 0,
                  lastIn = null;
                sorted.forEach((s) => {
                  const [hh, mm] = s.time.split(':').map(Number);
                  const mins = hh * 60 + mm;
                  if (s.type === 'in') lastIn = mins;
                  else if (s.type === 'out' && lastIn !== null) {
                    totalMin += mins - lastIn;
                    lastIn = null;
                  }
                });
                const netHours =
                  totalMin > 0
                    ? `${Math.floor(totalMin / 60)}h${totalMin % 60 > 0 ? ` ${totalMin % 60}m` : ''}`
                    : '–';

                // Stempel als Ein/Aus-Paare
                const pairs = [];
                for (let i = 0; i < sorted.length - 1; i++) {
                  if (sorted[i].type === 'in' && sorted[i + 1].type === 'out') {
                    pairs.push(`${sorted[i].time}–${sorted[i + 1].time}`);
                    i++;
                  }
                }
                const stampStr = pairs.join('   |   ');

                doc
                  .fontSize(9)
                  .font('Helvetica')
                  .fillColor('#374151')
                  .text(`${dateLabel}    ${stampStr}    Netto: ${netHours}`);
              });

              if (!hasAnyStamp) {
                doc
                  .fontSize(9)
                  .fillColor('#94a3b8')
                  .text('Keine Stempel in diesem Monat.');
              }

              // Pikett-Einträge dieses Monats
              const pikettEntries = Array.isArray(sub.payload?.pikett)
                ? sub.payload.pikett.filter((p) => {
                    if (!p?.date) return false;
                    const d = new Date(p.date + 'T00:00:00');
                    return (
                      d.getFullYear() === sub.year &&
                      d.getMonth() === sub.monthIndex
                    );
                  })
                : [];

              if (pikettEntries.length > 0) {
                doc.moveDown(0.4);
                doc
                  .fontSize(9)
                  .font('Helvetica-Bold')
                  .fillColor('#334155')
                  .text('Pikett-Einsätze:');
                doc.moveDown(0.2);

                pikettEntries.forEach((p) => {
                  const d = new Date(p.date + 'T00:00:00');
                  const dateLabel = d.toLocaleDateString('de-CH', {
                    weekday: 'short',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  });
                  const zeitLabel = p.von && p.bis ? `${p.von}–${p.bis}` : '–';
                  const stundenLabel =
                    typeof p.hours === 'number' && p.hours > 0
                      ? `${p.hours.toFixed(2).replace('.', ',')} h`
                      : '–';
                  const komLabel = p.komNr ? `Anlage: ${p.komNr}` : '';
                  const noteLabel = p.note ? `· ${p.note}` : '';
                  const ueZ3Label = p.isOvertime3 ? ' · ÜZ3 (150%)' : '';

                  doc
                    .fontSize(9)
                    .font('Helvetica')
                    .fillColor('#374151')
                    .text(
                      `${dateLabel}    ${zeitLabel}    ${stundenLabel}    ${komLabel}${noteLabel}${ueZ3Label}`
                    );
                });
              }

              doc.moveDown(0.8);
            });
          }
        );

        doc.end();
      } catch (err) {
        console.error('Audit PDF error', err);
        if (!res.headersSent) {
          res
            .status(500)
            .json({ ok: false, error: 'PDF konnte nicht erstellt werden' });
        }
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { registerAuditPdfRoute };
