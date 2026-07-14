# Sarabun Sync API

Backend เล็กๆ ที่เชื่อมระบบสารบรรณโรงเรียน (เว็บแอปที่เก็บข้อมูลใน `localStorage`)
เข้ากับ Google Sheet ผ่าน **Google Sheets API** โดยตรง (ไม่ใช้ Google Apps Script แล้ว)
สำหรับ deploy ขึ้น GitHub + Railway

**อัปเดตล่าสุด:** ตอนนี้ตัว Railway URL นี้ **เสิร์ฟหน้าเว็บแอปสารบรรณเองด้วยเลย**
(ไฟล์ `public/index.html`) ไม่ต้องเปิดไฟล์ HTML จากเครื่องตัวเองอีกต่อไป —
เปิด URL ของ Railway ตรงๆ ก็เจอตัวแอปที่ใช้งานได้จริงทันที

- `https://your-app.up.railway.app/` → เปิดแล้วเจอตัวแอปสารบรรณ (หน้าตาที่ใช้งานทุกวัน)
- `https://your-app.up.railway.app/api/health` → ใช้เช็คว่า backend ยังทำงานอยู่ (คืนค่า JSON)
- ตัวแอปจะยิง sync request (POST) ไปที่โดเมนเดียวกันนี้เองโดยอัตโนมัติ

ฝั่งเว็บแอป (ไฟล์ `sarabun_school_v32.html` ซึ่งตอนนี้อยู่ใน `public/index.html` แล้ว)
**ไม่ต้องแก้โค้ดใดๆ** — พอ deploy เสร็จ เปิด URL ของ Railway แล้วไปที่เมนู "ตั้งค่า"
ในตัวแอปเอง ใส่ URL ของ Railway เดียวกันนี้ (เช่น `https://your-app.up.railway.app/`)
พร้อม Token ที่ตั้งไว้ ก็ใช้งานได้เลย (โดเมนเดียวกับที่เปิดแอปอยู่)

---

## ภาพรวมขั้นตอนทั้งหมด

1. สร้าง Google Cloud Service Account (บัญชีเสมือนที่ backend ใช้เข้าถึง Google Sheets)
2. สร้าง Google Sheet แล้วแชร์สิทธิ์แก้ไขให้ Service Account
3. Push โค้ดนี้ขึ้น GitHub
4. สร้างโปรเจกต์บน Railway จาก GitHub repo นี้ ตั้งค่า Environment Variables
5. เอา URL ที่ Railway ให้มาใส่ในหน้าตั้งค่าของเว็บแอป

---

## ขั้นที่ 1 — สร้าง Google Service Account

1. ไปที่ [Google Cloud Console](https://console.cloud.google.com/)
2. สร้างโปรเจกต์ใหม่ (หรือใช้โปรเจกต์เดิม)
3. เมนู **APIs & Services > Library** → ค้นหา **Google Sheets API** → กด **Enable**
4. เมนู **APIs & Services > Credentials** → **Create Credentials > Service Account**
   - ตั้งชื่ออะไรก็ได้ เช่น `sarabun-sync`
   - กด Done (ไม่ต้องตั้งค่า role เพิ่มก็ได้)
5. คลิกที่ Service Account ที่สร้าง → แท็บ **Keys** → **Add Key > Create new key** → เลือก **JSON** → กด Create
   - ไฟล์ JSON จะถูกดาวน์โหลดลงเครื่อง **เก็บไฟล์นี้ไว้ให้ดี ห้ามเผยแพร่**
6. เปิดไฟล์ JSON นั้น จะเจอ 2 ค่าที่ต้องใช้ต่อ:
   - `client_email` → เช่น `sarabun-sync@xxxxx.iam.gserviceaccount.com`
   - `private_key` → ก้อนข้อความยาวๆ ที่ขึ้นต้นด้วย `-----BEGIN PRIVATE KEY-----`

## ขั้นที่ 2 — สร้าง Google Sheet และแชร์สิทธิ์

1. สร้าง Google Sheet ใหม่ (sheet เปล่าๆ ก็ได้ ระบบจะสร้างแท็บย่อยให้เองอัตโนมัติ)
2. คัดลอก **Spreadsheet ID** จาก URL:
   ```
   https://docs.google.com/spreadsheets/d/์นี่คือ_SPREADSHEET_ID/edit
   ```
3. กด **Share** (แชร์) ที่มุมขวาบนของชีต → นำ `client_email` จากขั้นที่ 1 มาเพิ่มเป็นผู้มีสิทธิ์
   **Editor** (ต้องเป็น Editor ไม่ใช่ Viewer เพราะต้องเขียนข้อมูลได้)

## ขั้นที่ 3 — Push ขึ้น GitHub

1. สร้าง repository ใหม่บน GitHub (private repo แนะนำ เพราะมีโค้ดเกี่ยวกับข้อมูลโรงเรียน)
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้นไป (**อย่าอัปโหลดไฟล์ `.env` จริงเด็ดขาด** — มีแค่
   `.env.example` เป็นตัวอย่างพอ ซึ่ง `.gitignore` กันไว้ให้แล้ว)

   ตัวอย่างคำสั่ง (ถ้าถนัด git จากเครื่อง):
   ```bash
   git init
   git add .
   git commit -m "init sarabun sync api"
   git branch -M main
   git remote add origin https://github.com/USERNAME/REPO_NAME.git
   git push -u origin main
   ```
   หรือจะใช้วิธีลากไฟล์ขึ้นผ่านหน้าเว็บ GitHub โดยตรงก็ได้เช่นกัน

## ขั้นที่ 4 — Deploy บน Railway

1. เข้า [railway.app](https://railway.app) → **New Project > Deploy from GitHub repo**
2. เลือก repository ที่เพิ่ง push ไป
3. Railway จะ detect เป็น Node.js โปรเจกต์อัตโนมัติ (จาก `package.json`)
4. เข้าไปที่แท็บ **Variables** ของโปรเจกต์ แล้วเพิ่มตัวแปรตามนี้:

   | ชื่อตัวแปร | ค่า |
   |---|---|
   | `SECRET_TOKEN` | รหัสลับที่ท่านตั้งเอง (ใช้ตัวเดียวกับที่จะใส่ในหน้าตั้งค่าเว็บแอป) |
   | `SPREADSHEET_ID` | ID ของ Google Sheet จากขั้นที่ 2 |
   | `GOOGLE_CLIENT_EMAIL` | client_email จากไฟล์ JSON |
   | `GOOGLE_PRIVATE_KEY` | private_key จากไฟล์ JSON (คัดลอกทั้งก้อน ใส่ในเครื่องหมาย `"..."` และคง `\n` ไว้ตามเดิม) |

   > **หมายเหตุเรื่อง private_key:** ถ้าคัดลอกจากไฟล์ JSON มาทั้งบรรทัด จะมี `\n` เป็นตัวอักษร
   > (ไม่ใช่ขึ้นบรรทัดจริง) ซึ่งเป็นเรื่องปกติ — โค้ดใน `server.js` จะแปลงให้เป็นขึ้นบรรทัดจริงเอง
   > ไม่ต้องไปแก้ไขอะไรเพิ่ม แค่คัดลอกมาวางทั้งก้อนตามที่อยู่ในไฟล์ JSON

5. กด **Deploy** รอสักครู่ Railway จะ build และรันให้อัตโนมัติ
6. ไปที่แท็บ **Settings > Networking** → กด **Generate Domain** เพื่อให้ได้ URL สาธารณะ
   เช่น `https://sarabun-sync-api-production.up.railway.app`
7. ทดสอบเปิด URL นั้นในเบราว์เซอร์ ควรเห็น `{"status":"ok","message":"Sarabun Sync API is running"}`

## ขั้นที่ 5 — เชื่อมกับเว็บแอปสารบรรณ

1. เปิดเว็บแอป `sarabun_school_v32.html` → เมนู **ตั้งค่า** → การ์ด "เชื่อมต่อ Google Sheet"
2. ช่อง **Web App URL** → ใส่ URL ของ Railway ที่ได้จากขั้นที่ 4.6 (URL เต็ม เช่น
   `https://sarabun-sync-api-production.up.railway.app/`)
3. ช่อง **Secret Token** → ใส่ค่าเดียวกับ `SECRET_TOKEN` ที่ตั้งใน Railway
4. กด **บันทึกการตั้งค่า** → กด **ทดสอบการเชื่อมต่อ** ควรขึ้น "✅ เชื่อมต่อสำเร็จ"
5. กด **ส่งข้อมูลทั้งหมดขึ้น Sheet** เพื่อสำรองข้อมูลชุดแรก หรือเปิดออโต้ซิงค์ไว้ก็ได้

---

## รูปแบบการเก็บข้อมูลใน Sheet

ข้อมูลแต่ละประเภท (เช่น `lettersIn`, `lettersOut`, `meetings`, `teachers`, `settings` ฯลฯ)
จะถูกสร้างเป็นแท็บ (sheet tab) แยกกันอัตโนมัติ โดยเก็บทั้งก้อนเป็นข้อความ JSON ไว้ที่
เซลล์ A2 (แถวที่ 1 เป็นหัวคอลัมน์อธิบาย, เวลาอัปเดตล่าสุดอยู่ที่ B2)

เหตุผลที่ไม่แยกเป็นแถว/คอลัมน์ตามฟิลด์ เพราะแต่ละประเภทเอกสารมีโครงสร้างฟิลด์ไม่เหมือนกัน
การเก็บเป็น JSON ก้อนเดียวจึงรองรับได้ทุกประเภทโดยไม่ต้องแก้โค้ดเพิ่มทุกครั้งที่แอปมีฟีเจอร์ใหม่

> หากต้องการให้บางประเภท (เช่น หนังสือเข้า-ออก) แสดงเป็นตารางแถว/คอลัมน์อ่านง่ายใน Sheet
> ด้วย (เผื่ออยากเปิดดูตรงๆ ใน Google Sheets) แจ้งเพิ่มได้ จะทำ endpoint เสริมให้เฉพาะ
> ประเภทที่ต้องการ

## รันทดสอบในเครื่องตัวเอง (ไม่บังคับ)

```bash
npm install
cp .env.example .env   # แล้วแก้ค่าใน .env ให้ครบ
npm start
```

จะรันที่ `http://localhost:3000`

## ความปลอดภัย

- อย่าเปิดเผย `SECRET_TOKEN`, ไฟล์ Service Account JSON หรือ `GOOGLE_PRIVATE_KEY` ให้ผู้อื่น
- แนะนำให้ repo บน GitHub เป็น **private**
- Service Account มีสิทธิ์แค่ Google Sheet ที่แชร์ให้เท่านั้น ไม่กระทบ Google Drive/บัญชีอื่นๆ ของท่าน
