const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Base data directory
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// === User storage (very simple, file-based) ====================== //

const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Create users.json with some demo users if it doesn't exist
function ensureUsersFile() {
  if (!fs.existsSync(USERS_FILE)) {
    const defaultUsers = [
      {
        id: 'u1',
        username: 'user1',
        name: 'Mitarbeiter 1',
        password: 'pass1', // PLAIN TEXT – for dev only!
        role: 'user',
      },
      {
        id: 'admin',
        username: 'boss',
        name: 'Teamleiter',
        password: 'boss', // PLAIN TEXT – for dev only!
        role: 'admin',
      },
    ];

    fs.writeFileSync(
      USERS_FILE,
      JSON.stringify(defaultUsers, null, 2),
      'utf8'
    );
    console.log('Created default users.json with demo users.');
  }
}

// Load all users from file
function loadUsers() {
  ensureUsersFile();
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const users = JSON.parse(raw);
    return Array.isArray(users) ? users : [];
  } catch (err) {
    console.error('Failed to read users.json:', err);
    return [];
  }
}

// Optionally used later if you implement register / admin
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function findUserByUsername(username) {
  const users = loadUsers();
  return users.find((u) => u.username === username);
}

// === Very simple in-memory sessions (token -> user) ============== //

// On restart, sessions are lost and users need to log in again – fine for now.
const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    createdAt: new Date().toISOString(),
  });
  return token;
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res
      .status(401)
      .json({ ok: false, error: 'Missing or malformed Authorization header' });
  }

  const session = sessions.get(token);
  if (!session || !session.user) {
    return res
      .status(401)
      .json({ ok: false, error: 'Invalid or expired token' });
  }

  // Attach user to request so routes can use it
  req.user = session.user;
  next();
}

// === Health check ================================================ //

app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Backend is running 🚀' });
});

// === Auth endpoints ============================================= //

// Login: username + password -> token + user info
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res
      .status(400)
      .json({ ok: false, error: 'username and password are required' });
  }

  const user = findUserByUsername(username);
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  // For now: plain text compare (DEV ONLY – later use hashes / bcrypt)
  if (user.password !== password) {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  const token = createSession(user);

  res.json({
    ok: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
    },
  });
});

// Who am I? (for testing the token)
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({
    ok: true,
    user: req.user,
  });
});

// === Monthly transmission ======================================== //

// We store submissions here as JSON files
const SUBMISSIONS_DIR = path.join(DATA_DIR, 'submissions');
if (!fs.existsSync(SUBMISSIONS_DIR)) {
  fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true });
}

// Receive monthly transmission
// NOTE: currently still open (no authMiddleware) so your existing frontend keeps working.
// Later: app.post('/api/transmit-month', authMiddleware, (req, res) => { ... })
app.post('/api/transmit-month', authMiddleware, (req, res) => {
  const payload = req.body;

  console.log('Received monthly transmission from user:', req.user);
  console.log(JSON.stringify(payload, null, 2));

  if (
    typeof payload.year !== 'number' ||
    typeof payload.monthIndex !== 'number' ||
    typeof payload.monthLabel !== 'string'
  ) {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  const userId = req.user.id;           // from login
  const username = req.user.username;   // also available if you want

  const monthNumber = payload.monthIndex + 1;
  const monthStr = String(monthNumber).padStart(2, '0');
  const timestamp = Date.now();

  const fileName = `${payload.year}-${monthStr}-${userId}-${timestamp}.json`;
  const filePath = path.join(DATA_DIR, fileName);

  const submission = {
    ...payload,
    userId,
    username,
    receivedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(submission, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save submission:', err);
    return res
      .status(500)
      .json({ ok: false, error: 'Could not save data on server' });
  }

  res.json({
    ok: true,
    message: `Month ${payload.monthLabel} received and saved as ${fileName}`,
    submissionId: fileName,
  });
});


// === Start server ================================================ //

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
