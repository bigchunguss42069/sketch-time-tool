const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// ---- Middleware ----
app.use(cors());
app.use(express.json());

// ---- "Database": users + sessions (in memory for now) ----

// Teams
const TEAMS = [
  { id: 'montage', name: 'Team Montage' },
  // später: { id: 'service', name: 'Team Service' }, ...
];

const USERS = [
  { id: 'u1', username: 'demo',  password: 'demo123',  role: 'user',  teamId: 'montage' },
  { id: 'u2', username: 'chef',  password: 'chef123',  role: 'admin', teamId: 'montage' },
];

const sessions = new Map(); // token -> userId

function findUserByCredentials(username, password) {
  return USERS.find(
    (u) => u.username === username && u.password === password
  );
}

function findUserById(id) {
  return USERS.find((u) => u.id === id);
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ---- Auth middleware ----

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res
      .status(401)
      .json({ ok: false, error: 'Missing or invalid Authorization header' });
  }

  const userId = sessions.get(token);
  if (!userId) {
    return res
      .status(401)
      .json({ ok: false, error: 'Invalid or expired token' });
  }

  const user = findUserById(userId);
  if (!user) {
    return res
      .status(401)
      .json({ ok: false, error: 'User not found for this token' });
  }

  req.user = user;
  req.token = token;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res
      .status(403)
      .json({ ok: false, error: 'Admin role required' });
  }
  next();
}

// ---- Auth routes ----

// Login: POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res
      .status(400)
      .json({ ok: false, error: 'Missing username or password' });
  }

  const user = findUserByCredentials(username, password);
  if (!user) {
    return res
      .status(401)
      .json({ ok: false, error: 'Ungültige Zugangsdaten' });
  }

  const token = createToken();
  // Store the session by *user.id* (stable, independent of username text)
  sessions.set(token, user.id);

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
});


// Current user: GET /api/auth/me
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

// ---- Health check ----
app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Backend is running 🚀' });
});

// ---- File storage helpers ----

const BASE_DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(BASE_DATA_DIR)) {
  fs.mkdirSync(BASE_DATA_DIR, { recursive: true });
}

// Helper: get (and create) the folder for a given user
// We use username as the folder id (consistent with existing files)
function getUserDir(userId) {
  const safeId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(BASE_DATA_DIR, safeId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ---- Month transmission routes ----

// Receive monthly transmission (protected)
app.post('/api/transmit-month', requireAuth, (req, res) => {
  const payload = req.body;

  console.log('Received monthly transmission from', req.user.username);
  console.log(JSON.stringify(payload, null, 2));

  // Basic validation
  if (
    typeof payload.year !== 'number' ||
    typeof payload.monthIndex !== 'number' ||
    typeof payload.monthLabel !== 'string'
  ) {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  // Logged-in user → we store by username
  const userId = req.user.username;

  const monthNumber = payload.monthIndex + 1; // 0–11 -> 1–12
  const monthStr = String(monthNumber).padStart(2, '0');

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');

  const fileName = `${payload.year}-${monthStr}-${timestamp}.json`;

  const userDir = getUserDir(userId);
  const filePath = path.join(userDir, fileName);

  const submission = {
    ...payload,
    userId,
    receivedAt: now.toISOString(),
  };

  // 1) Save full submission
  try {
    fs.writeFileSync(filePath, JSON.stringify(submission, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save submission:', err);
    return res
      .status(500)
      .json({ ok: false, error: 'Could not save data on server' });
  }

  // 2) Update user's index.json (simple list of transmissions)
  const indexPath = path.join(userDir, 'index.json');
  let index = [];
  try {
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath, 'utf8');
      index = JSON.parse(raw);
      if (!Array.isArray(index)) index = [];
    }
  } catch (err) {
    console.warn('Could not read existing index.json, starting fresh', err);
    index = [];
  }

  const stats = fs.statSync(filePath);
  const meta = {
    id: fileName,
    year: payload.year,
    monthIndex: payload.monthIndex,
    monthLabel: payload.monthLabel,
    sentAt: now.toISOString(),
    sizeBytes: stats.size,
  };

  index.push(meta);

  try {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to update index.json:', err);
    // Not fatal for the client; main file is already saved
  }

  res.json({
    ok: true,
    message: `Month ${payload.monthLabel} received and saved as ${fileName}`,
    submissionId: fileName,
  });
});

// List all transmissions for the logged-in user
app.get('/api/transmissions', requireAuth, (req, res) => {
  const userId = req.user.username; // consistent with above
  const userDir = getUserDir(userId);
  const indexPath = path.join(userDir, 'index.json');

  let index = [];
  try {
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath, 'utf8');
      index = JSON.parse(raw);
      if (!Array.isArray(index)) index = [];
    }
  } catch (err) {
    console.error('Failed to read index.json:', err);
    index = [];
  }

  res.json({
    ok: true,
    transmissions: index,
  });
});

// ---- Admin: summary of transmissions per user ----
// Only accessible for admins
app.get(
  '/api/admin/transmissions-summary',
  requireAuth,
  requireAdmin,
  (req, res) => {
    const summaries = USERS.map((user) => {
      const userDir = getUserDir(user.username); // stored by username
      const indexPath = path.join(userDir, 'index.json');

      let transmissions = [];
      if (fs.existsSync(indexPath)) {
        try {
          const raw = fs.readFileSync(indexPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            transmissions = parsed;
          }
        } catch (err) {
          console.warn(
            `Could not read index.json for user ${user.username}`,
            err
          );
        }
      }

      const transmissionsCount = transmissions.length;
      let lastSentAt = null;
      let lastMonthLabel = null;

      if (transmissionsCount > 0) {
        // find the newest by sentAt
        const latest = transmissions.reduce((best, tx) => {
          if (!tx.sentAt) return best;
          const d = new Date(tx.sentAt);
          if (Number.isNaN(d.getTime())) return best;

          if (!best) return { tx, date: d };
          return d > best.date ? { tx, date: d } : best;
        }, null);

        if (latest) {
          lastSentAt = latest.date.toISOString();
          lastMonthLabel = latest.tx.monthLabel || null;
        }
      }

      const team = TEAMS.find((t) => t.id === user.teamId) || null;

      return {
        userId: user.id,
        username: user.username,
        role: user.role,
        teamId: user.teamId || null,
        teamName: team ? team.name : null,
        transmissionsCount,
        lastSentAt,
        lastMonthLabel,
      };
    });

    res.json({
      ok: true,
      users: summaries,
    });
  }
);

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
