/**
 * ══════════════════════════════════════════════════════════════
 * Sarabun Sync API — เชื่อมระบบสารบรรณโรงเรียนกับ Google Sheet
 * ══════════════════════════════════════════════════════════════
 * Express server สำหรับ deploy บน Railway
 * ทำหน้าที่แทน Google Apps Script เดิม โดยคุยกับ Google Sheets ผ่าน
 * Google Sheets API (ใช้ Service Account) แทนการรัน Apps Script
 *
 * Protocol เดียวกับตัว Apps Script เดิมทุกประการ (ฝั่งเว็บแอปไม่ต้องแก้โค้ด
 * ใดๆ) — ส่ง POST มาที่ endpoint นี้ด้วย body เป็น JSON string:
 *   { action: 'ping' | 'get' | 'getAll' | 'set' | 'setAll', token, bucket, data }
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');

const app = express();
app.use(cors());
// เสิร์ฟตัวแอปสารบรรณ (public/index.html) ให้เปิดได้ตรงจาก URL ของ Railway เลย
app.use(express.static(path.join(__dirname, 'public')));
// รับ body เป็น text เสมอ (ฝั่งเว็บแอปส่งมาเป็น Content-Type: text/plain
// เพื่อเลี่ยง CORS preflight) แล้วค่อย JSON.parse เอง
app.use(express.text({ type: () => true, limit: '15mb' }));

const PORT = process.env.PORT || 3000;
const SECRET_TOKEN = process.env.SECRET_TOKEN || '';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '';
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL || '';
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

if (!SECRET_TOKEN) console.warn('⚠️  ยังไม่ได้ตั้งค่า SECRET_TOKEN — ควรตั้งก่อนใช้งานจริง');
if (!SPREADSHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
  console.warn('⚠️  ยังตั้งค่า Google Sheets ไม่ครบ (SPREADSHEET_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY)');
}

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: GOOGLE_CLIENT_EMAIL,
    private_key: GOOGLE_PRIVATE_KEY,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheetsApi = google.sheets({ version: 'v4', auth });

// ── helpers ──────────────────────────────────────────────

function safeSheetName(name) {
  return String(name || '').replace(/[\[\]\*\/\\\?:]/g, '_').slice(0, 90) || 'unnamed';
}

function safeParse(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

async function listSheetTitles() {
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return (meta.data.sheets || []).map(s => s.properties.title);
}

async function ensureSheetExists(title) {
  const titles = await listSheetTitles();
  if (titles.includes(title)) return;
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  // ใส่หัวคอลัมน์อธิบาย
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${title}'!A1:B1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['ข้อมูล (JSON)', 'อัปเดตล่าสุด']] },
  });
}

async function readBucket(bucket) {
  const title = safeSheetName(bucket);
  const titles = await listSheetTitles();
  if (!titles.includes(title)) return null;
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${title}'!A2:A2`,
  });
  const val = res.data.values && res.data.values[0] && res.data.values[0][0];
  return safeParse(val);
}

async function writeBucket(bucket, data) {
  const title = safeSheetName(bucket);
  await ensureSheetExists(title);
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${title}'!A2:B2`,
    valueInputOption: 'RAW',
    requestBody: { values: [[JSON.stringify(data === undefined ? null : data), new Date().toISOString()]] },
  });
}

async function readAllBuckets() {
  const titles = await listSheetTitles();
  const result = {};
  for (const title of titles) {
    const res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${title}'!A2:A2`,
    });
    const val = res.data.values && res.data.values[0] && res.data.values[0][0];
    result[title] = safeParse(val);
  }
  return result;
}

// ── routes ───────────────────────────────────────────────

// health check (เดิมอยู่ที่ '/' ย้ายมาที่นี่ เพราะ '/' ตอนนี้เสิร์ฟหน้าเว็บแอปแทน)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Sarabun Sync API is running' });
});

app.post('/', async (req, res) => {
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (err) {
    return res.json({ error: 'invalid request body: ' + err.message });
  }

  if ((body.token || '') !== SECRET_TOKEN) {
    return res.json({ error: 'unauthorized: token ไม่ถูกต้อง กรุณาตรวจสอบ Secret Token' });
  }

  try {
    switch (body.action) {
      case 'ping':
        return res.json({ ok: true, message: 'connected' });

      case 'get': {
        const data = await readBucket(body.bucket);
        return res.json({ ok: true, data });
      }

      case 'getAll': {
        const data = await readAllBuckets();
        return res.json({ ok: true, data });
      }

      case 'set': {
        await writeBucket(body.bucket, body.data);
        return res.json({ ok: true });
      }

      case 'setAll': {
        const data = body.data || {};
        for (const bucket of Object.keys(data)) {
          await writeBucket(bucket, data[bucket]);
        }
        return res.json({ ok: true, count: Object.keys(data).length });
      }

      default:
        return res.json({ error: 'unknown action: ' + body.action });
    }
  } catch (err) {
    console.error(err);
    return res.json({ error: err.message || 'internal error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sarabun Sync API listening on port ${PORT}`);
});
