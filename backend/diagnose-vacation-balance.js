require('dotenv').config();
const { Pool } = require('pg');
const db = new Pool({ connectionString: process.env.DATABASE_URL });

// Berechnet den KORREKTEN Ferien-Saldo komplett neu aus der Wahrheit:
//   Summe aller Jahresgutschriften (credited_years × aktuelles
//   vacation_days_per_year) minus Summe aller aktuell akzeptierten
//   Ferien-Absenzen (komplett, nicht monatsweise fragmentiert).
// Zeigt Differenz zum aktuell gespeicherten Wert. Schreibt NICHTS, ausser
// mit --apply.
//
// Aufruf (nur anzeigen):  node diagnose-vacation-balance.js
// Aufruf (korrigieren):   node diagnose-vacation-balance.js --apply
// Nur für bestimmte User: node diagnose-vacation-balance.js --apply "Amel Ramulic"

async function main() {
  const { calculateAbsenceVacationDays } = require('./lib/konten');

  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const requestedUsers = args.filter((a) => a !== '--apply');

  const users = (
    await db.query(
      requestedUsers.length > 0
        ? `SELECT id, username FROM users WHERE username = ANY($1)`
        : `SELECT id, username FROM users WHERE active = true`,
      requestedUsers.length > 0 ? [requestedUsers] : []
    )
  ).rows;

  console.log(
    `\n${apply ? 'KORRIGIERE' : 'PRÜFE (nur Anzeige, nichts wird geschrieben)'} ${users.length} User ...\n`
  );

  for (const user of users) {
    const kontoRes = await db.query(
      `SELECT vacation_days, vacation_days_per_year, credited_years
       FROM konten WHERE user_id = $1`,
      [user.id]
    );
    if (kontoRes.rows.length === 0) continue;

    const konto = kontoRes.rows[0];
    const currentBalance = Number(konto.vacation_days) || 0;
    const perYear = Number(konto.vacation_days_per_year) || 0;
    const creditedYears = konto.credited_years || {};

    const creditedYearCount =
      Object.values(creditedYears).filter(Boolean).length;
    const totalCredited = creditedYearCount * perYear;

    const absencesRes = await db.query(
      `SELECT from_date, to_date, hours, status, type
       FROM absences WHERE user_id = $1 AND type = 'ferien' AND status = 'accepted'`,
      [user.id]
    );

    let totalUsed = 0;
    const usedDetails = [];
    for (const row of absencesRes.rows) {
      const absence = {
        from: String(row.from_date).slice(0, 10),
        to: String(row.to_date).slice(0, 10),
        type: row.type,
        hours: row.hours,
      };
      // toDateOnlyString-sicher, falls from_date als Date-Objekt kommt
      const { toDateOnlyString } = require('./lib/absences');
      absence.from = toDateOnlyString(row.from_date);
      absence.to = toDateOnlyString(row.to_date);

      const days = calculateAbsenceVacationDays(absence);
      totalUsed += days;
      usedDetails.push(`${absence.from}–${absence.to}: ${days}d`);
    }

    const correctBalance = Math.round((totalCredited - totalUsed) * 100) / 100;
    const diff = Math.round((correctBalance - currentBalance) * 100) / 100;

    console.log(`--- ${user.username} ---`);
    console.log(
      `  Jahresgutschriften: ${creditedYearCount} × ${perYear}d = ${totalCredited}d`
    );
    console.log(`  Akzeptierte Ferien: ${totalUsed}d`);
    usedDetails.forEach((d) => console.log(`    ${d}`));
    console.log(`  Korrekter Saldo:    ${correctBalance}d`);
    console.log(`  Aktuell gespeichert: ${currentBalance}d`);

    if (Math.abs(diff) < 0.01) {
      console.log(`  ✓ Stimmt bereits überein.\n`);
      continue;
    }

    console.log(`  ⚠ ABWEICHUNG: ${diff > 0 ? '+' : ''}${diff}d`);

    if (apply) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO konto_adjustments
             (user_id, username, admin_username, field, old_value, new_value, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            user.id,
            user.username,
            'admin-vacation-reconcile',
            'vacationDays',
            currentBalance,
            correctBalance,
            'Korrektur: Ferien-Doppelabzug-Bug (Neuberechnung aus Jahresgutschrift - akzeptierte Absenzen)',
          ]
        );
        await client.query(
          `UPDATE konten SET vacation_days = $1, updated_at = NOW(), updated_by = $2 WHERE user_id = $3`,
          [correctBalance, 'admin-vacation-reconcile', user.id]
        );
        await client.query('COMMIT');
        console.log(`  → Korrigiert auf ${correctBalance}d\n`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  Fehler beim Korrigieren: ${err.message}\n`);
      } finally {
        client.release();
      }
    } else {
      console.log('');
    }
  }

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
