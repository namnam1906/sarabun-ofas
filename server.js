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
app.use(express.text({ type: () => true, limit: '25mb' }));

const PORT = process.env.PORT || 3000;
const SECRET_TOKEN = process.env.SECRET_TOKEN || '';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '';
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL || '';
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

if (!SECRET_TOKEN) console.warn('⚠️  ยังไม่ได้ตั้งค่า SECRET_TOKEN — ควรตั้งก่อนใช้งานจริง');
if (!ANTHROPIC_API_KEY) console.warn('⚠️  ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — ฟีเจอร์ AI สแกนเอกสาร/สรุปโครงการจะใช้ไม่ได้');
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// เรียก Google API พร้อม retry แบบ backoff เมื่อเจอ rate limit (429 / RESOURCE_EXHAUSTED)
async function withRetry(fn, retries = 4) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const code = err.code || (err.response && err.response.status);
      const isRateLimit = code === 429 || /quota|rate limit/i.test(err.message || '');
      if (!isRateLimit || i === retries) throw err;
      await sleep(1000 * Math.pow(2, i)); // 1s, 2s, 4s, 8s...
    }
  }
  throw lastErr;
}

async function listSheetTitles() {
  const meta = await withRetry(() => sheetsApi.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID }));
  return (meta.data.sheets || []).map(s => s.properties.title);
}

async function readBucket(bucket) {
  const title = safeSheetName(bucket);
  const titles = await listSheetTitles();
  if (!titles.includes(title)) return null;
  const res = await withRetry(() => sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${title}'!A2:A2`,
  }));
  const val = res.data.values && res.data.values[0] && res.data.values[0][0];
  return safeParse(val);
}

// เขียน bucket เดียว — ลองเขียนตรงๆ ก่อน (1 API call) ถ้าชีตยังไม่มีค่อยสร้างแล้วลองใหม่
// (ใช้กับ auto-sync ที่ยิงทีละ bucket ตอนมีการบันทึกข้อมูล)
async function writeBucket(bucket, data) {
  const title = safeSheetName(bucket);
  const values = [[JSON.stringify(data === undefined ? null : data), new Date().toISOString()]];
  try {
    await withRetry(() => sheetsApi.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${title}'!A2:B2`,
      valueInputOption: 'RAW',
      requestBody: { values },
    }));
  } catch (err) {
    // ชีตยังไม่มี → สร้างแล้วลองเขียนใหม่ (รวม header ไปด้วย)
    await withRetry(() => sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    }));
    await withRetry(() => sheetsApi.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${title}'!A1:B2`,
      valueInputOption: 'RAW',
      requestBody: { values: [['ข้อมูล (JSON)', 'อัปเดตล่าสุด'], values[0]] },
    }));
  }
}

// เขียนทุก bucket พร้อมกันด้วย batchUpdate เดียว — ไม่ว่าจะมีกี่ประเภทข้อมูล
// ก็ใช้แค่ ~3 API calls รวม (กัน quota "write requests per minute" หมด)
async function writeAllBucketsBatch(dataMap) {
  const items = Object.keys(dataMap).map(bucket => ({ bucket, title: safeSheetName(bucket) }));
  if (!items.length) return;

  const existingTitles = await listSheetTitles(); // 1 call
  const missing = items.filter(it => !existingTitles.includes(it.title));
  if (missing.length) {
    await withRetry(() => sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: missing.map(it => ({ addSheet: { properties: { title: it.title } } })) },
    })); // 1 call สร้างชีตที่ขาดทั้งหมดพร้อมกัน
  }

  const data = items.map(it => ({
    range: `'${it.title}'!A1:B2`,
    values: [
      ['ข้อมูล (JSON)', 'อัปเดตล่าสุด'],
      [JSON.stringify(dataMap[it.bucket] === undefined ? null : dataMap[it.bucket]), new Date().toISOString()],
    ],
  }));
  await withRetry(() => sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  })); // 1 call เขียนข้อมูลทุก bucket พร้อมกัน
}

// อ่านทุก bucket พร้อมกันด้วย batchGet เดียว
async function readAllBuckets() {
  const titles = await listSheetTitles(); // 1 call
  if (!titles.length) return {};
  const ranges = titles.map(t => `'${t}'!A2:A2`);
  const res = await withRetry(() => sheetsApi.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges,
  })); // 1 call
  const result = {};
  titles.forEach((title, i) => {
    const vr = res.data.valueRanges[i];
    const val = vr && vr.values && vr.values[0] && vr.values[0][0];
    result[title] = safeParse(val);
  });
  return result;
}

// ── routes ───────────────────────────────────────────────

// health check (เดิมอยู่ที่ '/' ย้ายมาที่นี่ เพราะ '/' ตอนนี้เสิร์ฟหน้าเว็บแอปแทน)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Sarabun Sync API is running' });
});

// ตัวกลางยิงไปหา Anthropic API แทนฝั่งเบราว์เซอร์ (กันเรื่อง CORS และไม่ต้องเผย API key ให้ผู้ใช้เห็น)
// ฟีเจอร์ AI สแกนเอกสาร / สรุปโครงการอัตโนมัติ ในตัวแอปจะยิงมาที่นี่แทน api.anthropic.com ตรงๆ
app.post('/api/ai', async (req, res) => {
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (err) {
    return res.status(400).json({ error: 'invalid request body: ' + err.message });
  }

  if ((body.token || '') !== SECRET_TOKEN) {
    return res.status(401).json({ error: 'unauthorized: token ไม่ถูกต้อง' });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY' });
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens || 2000,
        ...(body.system ? { system: body.system } : {}),
        messages: body.messages || [],
      }),
    });
    const data = await anthropicRes.json();
    return res.status(anthropicRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
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
        await writeAllBucketsBatch(data);
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
