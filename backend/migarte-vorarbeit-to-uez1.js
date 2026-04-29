'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. vorarbeit_balance → ueZ1 umbuchen pro User
    const result = await client.query(`
      SELECT user_id, username, vorarbeit_balance, ue_z1
      FROM konten
      WHERE vorarbeit_balance != 0
    `);

    console.log(`Migriere ${result.rows.length} User...`);

    for (const row of result.rows) {
      const newUeZ1 =
        Math.round((Number(row.ue_z1) + Number(row.vorarbeit_balance)) * 10) /
        10;
      await client.query(
        `UPDATE konten SET ue_z1 = $1, vorarbeit_balance = 0 WHERE user_id = $2`,
        [newUeZ1, row.user_id]
      );
      console.log(
        `  ${row.username}: vorarbeit ${row.vorarbeit_balance}h → ueZ1 ${row.ue_z1}h + ${row.vorarbeit_balance}h = ${newUeZ1}h`
      );
    }

    // 2. konten_snapshots: vorarbeit_balance auf 0 setzen
    await client.query(`UPDATE konten_snapshots SET vorarbeit_balance = 0`);
    console.log('konten_snapshots.vorarbeit_balance → 0 gesetzt');

    await client.query('COMMIT');
    console.log('Migration erfolgreich abgeschlossen.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration fehlgeschlagen:', err);
    process.exit(1);
  } finally {
    client.release();
    await db.end();
  }
}

migrate();
