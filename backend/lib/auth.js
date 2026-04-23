'use strict';

/**
 * @fileoverview Authentifizierung und Autorisierung
 *
 * Enthält:
 * - DB-Schema für Sessions und Password-Reset-Tokens
 * - Session-Management (erstellen, validieren, widerrufen)
 * - User-Lookup Funktionen
 * - Express Middleware: requireAuth, requireAdmin
 * - Routes: POST /api/auth/login, GET /api/auth/me, POST /api/auth/logout
 * - Routes: POST /api/auth/forgot-password, POST /api/auth/reset-password
 *
 * Abhängigkeiten: db, crypto, argon2, nodemailer, rateLimit
 */

const crypto = require('crypto');
const argon2 = require('argon2');
const rateLimit = require('express-rate-limit');

// ─────────────────────────────────────────────────────────────────────────────
// DB-Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt die auth_sessions Tabelle wenn sie nicht existiert.
 *
 * @param {import('pg').Pool} db
 */
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
// Session-Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erzeugt einen kryptografisch sicheren Session-Token.
 *
 * @returns {string} 64-stelliger Hex-String
 */
function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Speichert einen neuen Session-Token in der DB.
 *
 * @param {import('pg').Pool} db
 * @param {{ token: string, userId: string }} params
 */
async function createSessionRecord(db, { token, userId }) {
  if (!db) throw new Error('DATABASE_URL is not configured');

  await db.query(
    `INSERT INTO auth_sessions (token, user_id, created_at, last_seen_at, revoked_at)
     VALUES ($1, $2, NOW(), NOW(), NULL)`,
    [token, userId]
  );
}

/**
 * Validiert einen Token und gibt die zugehörige user_id zurück.
 * Aktualisiert last_seen_at bei Erfolg.
 *
 * @param {import('pg').Pool} db
 * @param {string} token
 * @returns {Promise<string|null>} user_id oder null
 */
async function getSessionUserId(db, token) {
  if (!db) return null;

  const result = await db.query(
    `SELECT user_id FROM auth_sessions
     WHERE token = $1 AND revoked_at IS NULL
     LIMIT 1`,
    [token]
  );

  const row = result.rows[0];
  if (!row) return null;

  await db.query(
    `UPDATE auth_sessions SET last_seen_at = NOW() WHERE token = $1`,
    [token]
  );

  return row.user_id || null;
}

/**
 * Widerruft einen Session-Token.
 *
 * @param {import('pg').Pool} db
 * @param {string} token
 */
async function revokeSessionRecord(db, token) {
  if (!db) return;

  await db.query(
    `UPDATE auth_sessions SET revoked_at = NOW()
     WHERE token = $1 AND revoked_at IS NULL`,
    [token]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// User-Mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mappt eine DB-Zeile auf ein User-Objekt.
 * Gibt null zurück wenn row leer ist.
 *
 * @param {object} row - DB-Zeile aus der users-Tabelle
 * @returns {object|null}
 */
function mapDbUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    teamId: row.team_id || null,
    active: row.active,
    email: row.email || null,
    employmentStart: row.employment_start
      ? String(
          row.employment_start instanceof Date
            ? row.employment_start.toLocaleDateString('sv')
            : row.employment_start
        ).slice(0, 10)
      : null,
    birthYear: row.birth_year ? Number(row.birth_year) : null,
    isNonSmoker: !!row.is_non_smoker,
    isKader: !!row.is_kader,
  };
}

/**
 * Sucht einen aktiven User anhand Username.
 *
 * @param {import('pg').Pool} db
 * @param {string} username
 * @returns {Promise<object|null>}
 */
async function findUserByUsername(db, username) {
  if (!db) return null;

  const result = await db.query(
    `SELECT id, username, role, team_id, active
     FROM users WHERE username = $1 LIMIT 1`,
    [username]
  );

  const row = result.rows[0];
  if (!row || !row.active) return null;
  return mapDbUser(row);
}

/**
 * Sucht einen aktiven User anhand ID.
 *
 * @param {import('pg').Pool} db
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function findUserById(db, id) {
  if (!db) return null;

  const result = await db.query(
    `SELECT id, username, role, team_id, active
     FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );

  const row = result.rows[0];
  if (!row || !row.active) return null;
  return mapDbUser(row);
}

/**
 * Verifiziert Username + Passwort und gibt den User zurück.
 * Gibt null zurück wenn Credentials ungültig sind.
 *
 * @param {import('pg').Pool} db
 * @param {string} username
 * @param {string} password
 * @returns {Promise<object|null>}
 */
async function findUserByCredentials(db, username, password) {
  if (!db) return null;

  const result = await db.query(
    `SELECT id, username, password_hash, role, team_id, active
     FROM users WHERE username = $1 LIMIT 1`,
    [username]
  );

  const row = result.rows[0];
  if (!row || !row.active) return null;

  const passwordOk = await argon2.verify(row.password_hash, password);
  if (!passwordOk) return null;

  return mapDbUser(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// Express Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erstellt die requireAuth Middleware mit DB-Zugriff.
 *
 * @param {import('pg').Pool} db
 * @returns {import('express').RequestHandler}
 */
function createRequireAuth(db) {
  return async function requireAuth(req, res, next) {
    try {
      const header = req.headers.authorization || '';
      const [scheme, token] = header.split(' ');

      if (scheme !== 'Bearer' || !token) {
        return res
          .status(401)
          .json({
            ok: false,
            error: 'Missing or invalid Authorization header',
          });
      }

      const userId = await getSessionUserId(db, token);
      if (!userId) {
        return res
          .status(401)
          .json({ ok: false, error: 'Invalid or expired token' });
      }

      const user = await findUserById(db, userId);
      if (!user) {
        return res
          .status(401)
          .json({ ok: false, error: 'User not found for this token' });
      }

      req.user = user;
      req.token = token;
      next();
    } catch (err) {
      console.error('requireAuth failed', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Authentication failed' });
    }
  };
}

/**
 * Middleware die nur Admins durchlässt.
 * Muss nach requireAuth verwendet werden.
 *
 * @type {import('express').RequestHandler}
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin role required' });
  }
  next();
}

// Rate Limiter für Login-Endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 10, // max 10 Versuche pro 15 Minuten
  message: {
    ok: false,
    error: 'Zu viele Login-Versuche, bitte warte 15 Minuten.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registriert alle Auth-Routes auf dem Express-App.
 *
 * @param {import('express').Application} app
 * @param {import('pg').Pool} db
 * @param {import('express').RequestHandler} requireAuth
 * @param {Function} createMailTransporter - Factory für Nodemailer-Transporter
 */
function registerAuthRoutes(app, db, requireAuth, createMailTransporter) {
  // POST /api/auth/login
  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
      const { username, password } = req.body || {};

      if (!username || !password) {
        return res
          .status(400)
          .json({ ok: false, error: 'Missing username or password' });
      }

      const user = await findUserByCredentials(db, username, password);
      if (!user) {
        return res
          .status(401)
          .json({ ok: false, error: 'Ungültige Zugangsdaten' });
      }

      const token = createToken();
      await createSessionRecord(db, { token, userId: user.id });

      return res.json({
        ok: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          teamId: user.teamId,
        },
      });
    } catch (err) {
      console.error('Login failed', err);
      return res.status(500).json({ ok: false, error: 'Login failed' });
    }
  });

  // GET /api/auth/me
  app.get('/api/auth/me', requireAuth, (req, res) => {
    const user = req.user;
    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        teamId: user.teamId,
      },
    });
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', requireAuth, async (req, res) => {
    try {
      if (req.token) {
        await revokeSessionRecord(db, req.token);
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error('Logout failed', err);
      return res.status(500).json({ ok: false, error: 'Logout failed' });
    }
  });

  // POST /api/auth/forgot-password
  app.post('/api/auth/forgot-password', async (req, res) => {
    const username = String(req.body?.username || '').trim();
    if (!username)
      return res.status(400).json({ ok: false, error: 'Benutzername fehlt' });

    try {
      const userRow = await db.query(
        'SELECT id, email FROM users WHERE username = $1 AND active = TRUE',
        [username]
      );
      // Immer ok zurückgeben — kein Username-Leak
      if (!userRow.rows[0] || !userRow.rows[0].email) {
        return res.json({ ok: true });
      }

      const user = userRow.rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h

      await db.query(
        `INSERT INTO password_reset_tokens (token, user_id, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (token) DO NOTHING`,
        [token, user.id, expiresAt]
      );

      const resetUrl = `${process.env.APP_URL || 'https://xn--normaufzge-heb.app'}/?reset=${token}`;

      const transporter = createMailTransporter();
      await transporter.sendMail({
        from: `"Norm Aufzüge" <${process.env.SMTP_USER}>`,
        to: user.email,
        subject: 'Passwort zurücksetzen',
        text: `Hallo ${username}\n\nHier ist dein Link zum Zurücksetzen des Passworts:\n\n${resetUrl}\n\nDer Link ist 1 Stunde gültig.\n\nFalls du kein Passwort-Reset angefordert hast, kannst du diese Email ignorieren.\n\nFreundliche Grüsse\nNorm Aufzüge AG`,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('Forgot password error:', err);
      return res.status(500).json({ ok: false, error: 'Fehler beim Senden' });
    }
  });

  // POST /api/auth/reset-password
  app.post('/api/auth/reset-password', async (req, res) => {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');

    if (!token || password.length < 6) {
      return res.status(400).json({ ok: false, error: 'Ungültige Eingabe' });
    }

    try {
      const row = await db.query(
        `SELECT t.user_id FROM password_reset_tokens t
         WHERE t.token = $1 AND t.used = FALSE AND t.expires_at > NOW()`,
        [token]
      );

      if (!row.rows[0]) {
        return res
          .status(400)
          .json({ ok: false, error: 'Link ungültig oder abgelaufen' });
      }

      const userId = row.rows[0].user_id;
      const hash = await argon2.hash(password);

      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
        hash,
        userId,
      ]);
      await db.query(
        'UPDATE password_reset_tokens SET used = TRUE WHERE token = $1',
        [token]
      );

      return res.json({ ok: true });
    } catch (err) {
      console.error('Reset password error:', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Fehler beim Zurücksetzen' });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // DB-Schema
  ensureSessionsTable,

  // Session
  createToken,
  createSessionRecord,
  getSessionUserId,
  revokeSessionRecord,

  // User
  mapDbUser,
  findUserByUsername,
  findUserById,
  findUserByCredentials,

  // Middleware
  createRequireAuth,
  requireAdmin,

  // Routes
  registerAuthRoutes,
};
