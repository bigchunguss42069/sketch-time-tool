const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware – MUST be before routes
app.use(cors());
app.use(express.json());

// Where we store the submissions
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Backend is running 🚀' });
});

// NEW: receive monthly transmission
app.post('/api/transmit-month', (req, res) => {
  const payload = req.body;

  console.log('Received monthly transmission:');
  console.log(JSON.stringify(payload, null, 2));

  // Basic validation
  if (
    typeof payload.year !== 'number' ||
    typeof payload.monthIndex !== 'number' ||
    typeof payload.monthLabel !== 'string'
  ) {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  // ⚠️ In the future this should come from login / auth.
  // For now you can hardcode a userId or send it along in the payload.
  const userId = payload.userId || 'demo-user';

  const monthNumber = payload.monthIndex + 1; // 0–11 -> 1–12
  const monthStr = String(monthNumber).padStart(2, '0');
  const timestamp = Date.now();

  const fileName = `${payload.year}-${monthStr}-${userId}-${timestamp}.json`;
  const filePath = path.join(DATA_DIR, fileName);

  const submission = {
    ...payload,
    userId,
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

// Start server
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
