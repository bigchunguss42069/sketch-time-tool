// Diagnose-Skript: prüft, ob eine Ferien-Absenz vom Transmit-Code korrekt
// erkannt wird. Läuft gegen die echte DB, benutzt die echten Funktionen
// aus dem Projekt (keine Simulation).
//
// Aufruf: node diagnose-ferien-bug.js <username>
// (Pfade ggf. anpassen, falls das Skript nicht im Projekt-Root liegt)

'use strict';

const { Pool } = require('pg');
const path = require('path');

// Pfad zu deinem lokalen sketch-time-tool Projekt anpassen:
const PROJECT_ROOT = process.env.PROJECT_ROOT || '/var/www/sketch-time-tool';

const { toDateOnlyString } = require(
  path.join(PROJECT_ROOT, 'backend/lib/absences.js')
);
const { buildAcceptedAbsenceHoursMap, buildAcceptedVacationDaysSet } = require(
  path.join(PROJECT_ROOT, 'backend/lib/compute.js')
);

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Aufruf: node diagnose-ferien-bug.js <username>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL }); // nutzt DATABASE_URL aus der Umgebung

  const userResult = await pool.query(
    'SELECT id FROM users WHERE username = $1',
    [username]
  );
  if (userResult.rows.length === 0) {
    console.error('User nicht gefunden:', username);
    process.exit(1);
  }
  const userId = userResult.rows[0].id;

  const absenceResult = await pool.query(
    'SELECT * FROM absences WHERE user_id = $1 ORDER BY from_date',
    [userId]
  );

  console.log(
    `\n${absenceResult.rows.length} Absenz(en) gefunden für ${username}\n`
  );

  // So, wie es die BUGGY Version in transmit.js macht (vor dem Fix):
  const buggyAbsences = absenceResult.rows.map((row) => ({
    id: row.id,
    type: row.type,
    from: String(row.from_date).slice(0, 10),
    to: String(row.to_date).slice(0, 10),
    hours: row.hours == null ? null : Number(row.hours),
    status: row.status,
  }));

  // So, wie es KORREKT sein sollte (mit toDateOnlyString, wie /api/absences):
  const fixedAbsences = absenceResult.rows.map((row) => ({
    id: row.id,
    type: row.type,
    from: toDateOnlyString(row.from_date),
    to: toDateOnlyString(row.to_date),
    hours: row.hours == null ? null : Number(row.hours),
    status: row.status,
  }));

  absenceResult.rows.forEach((row, i) => {
    console.log(`— ${row.type} | status=${row.status} | hours=${row.hours}`);
    console.log(`  raw from_date (aus pg):`, row.from_date);
    console.log(`  BUGGY  from-Wert: "${buggyAbsences[i].from}"`);
    console.log(`  FIXED  from-Wert: "${fixedAbsences[i].from}"`);
  });

  const monthStart = '2000-01-01'; // weiter Bereich, damit alles erfasst wird
  const monthEnd = '2100-01-01';

  const buggyMap = buildAcceptedAbsenceHoursMap(
    buggyAbsences,
    monthStart,
    monthEnd
  );
  const buggyVacSet = buildAcceptedVacationDaysSet(
    buggyAbsences,
    monthStart,
    monthEnd
  );

  const fixedMap = buildAcceptedAbsenceHoursMap(
    fixedAbsences,
    monthStart,
    monthEnd
  );
  const fixedVacSet = buildAcceptedVacationDaysSet(
    fixedAbsences,
    monthStart,
    monthEnd
  );

  console.log('\n=== Ergebnis ===');
  console.log(
    'BUGGY  Version: erkannte Absenz-Tage:',
    buggyMap.size,
    '| erkannte Ferien-Tage:',
    buggyVacSet.size
  );
  console.log(
    'FIXED  Version: erkannte Absenz-Tage:',
    fixedMap.size,
    '| erkannte Ferien-Tage:',
    fixedVacSet.size
  );

  if (
    buggyMap.size !== fixedMap.size ||
    buggyVacSet.size !== fixedVacSet.size
  ) {
    console.log(
      '\n⚠ UNTERSCHIED GEFUNDEN — der Bug tritt bei diesen Daten auf.'
    );
  } else {
    console.log(
      '\n✓ Kein Unterschied — bei diesen konkreten Daten macht sich der Bug nicht bemerkbar.'
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Fehler:', err);
  process.exit(1);
});
