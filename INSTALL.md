# ขั้นตอนติดตั้ง (เครื่องใหม่)

ติดตั้งด้วยการดับเบิลคลิก แล้วตั้งค่าบัญชีและล็อกอิน Facebook บนเครื่องนั้น

| # | ขั้นตอน | ใครทำ |
|---|---|---|
| 1 | ดาวน์โหลด ZIP จาก GitHub แล้วแตกไฟล์ | คุณ (คลิกเดียว) |
| 2 | ดับเบิลคลิก `install.bat` | อัตโนมัติ |
| 3 | แก้ `accounts.json` | คุณ (แก้ไฟล์) |
| 4 | Login Facebook ทีละบัญชี | คุณ (ทำมือ) |
| 5 | เช็ค login ครบไหม | อัตโนมัติ |
| 6 | ทดสอบ (dry-run) | อัตโนมัติ |
| 7 | เปิดเผยแพร่จริง | คุณ + อัตโนมัติ |
| 8 | ตั้งเวลารันอัตโนมัติ | อัตโนมัติ |

## ก่อนเริ่ม

> [!TIP]
> ไม่ต้องเตรียมอะไรก่อนก็ได้ — ขั้นตอนที่ 2 จะเช็ค Node.js กับ Google Chrome ให้เอง ถ้าไม่มีจะติดตั้งให้อัตโนมัติผ่าน `winget` (อาจมีหน้าต่างขออนุญาต admin ของ Windows โผล่มา ให้กด Yes)

## ขั้นตอน

### 1. ดาวน์โหลดและแตกไฟล์จาก GitHub

เปิด [ดาวน์โหลด ZIP ล่าสุดจาก GitHub](https://github.com/mktteamsevenfive-source/facebook-sheet-autoposter/archive/refs/heads/main.zip) แล้วแตกไฟล์ไปที่ไหนก็ได้ในเครื่อง เช่น `Documents\facebook-sheet-autoposter-main` ไม่ต้องติดตั้ง Git

### 2. ดับเบิลคลิก `install.bat`

จะเปิดหน้าต่างดำ ทำอัตโนมัติให้ทั้งหมด:

- เช็ค Node.js / Chrome ว่ามีไหม
- ติดตั้ง Node.js 20+ และ Google Chrome ผ่าน `winget` หากยังไม่มี
- ติดตั้ง dependencies ตาม lock file
- สร้างโฟลเดอร์ `secrets\`, `data\`, `logs\`
- สร้าง `.env` และ `accounts.json` จาก template (`PUBLISH_ENABLED=false` เป็นค่าเริ่มต้น)
- Copy `google-service-account.json` (ถ้าวางไว้ข้าง `install.bat`) ไปวางที่ถูกที่ให้อัตโนมัติ

เสร็จแล้วจะพิมพ์ขั้นตอนที่เหลือให้ดู — กด Enter เพื่อปิดหน้าต่าง

> [!NOTE]
> ถ้าไม่มี `google-service-account.json` ตอนติดตั้ง ให้ขอไฟล์จากคนดูแล Google Cloud project แล้ววางไว้ที่ `secrets\google-service-account.json` เอง

> [!CAUTION]
> ไฟล์ `google-service-account.json` เป็นความลับ — ห้ามอัปโหลดขึ้น GitHub หรือที่สาธารณะเด็ดขาด ส่งต่อผ่านช่องทางส่วนตัวเท่านั้น (Line, email, USB)

เมื่อ setup เสร็จ ขอไฟล์ `google-service-account.json` จากผู้ดูแลเป็นการส่วนตัว แล้ววางที่ `secrets\google-service-account.json` ตรวจ `PUBLISH_ENABLED` ใน `.env` ก่อน จากนั้นทำขั้นตอน login และ dry-run ด้านล่างก่อนเปิดการโพสต์จริง

### 3. แก้ `accounts.json`

เปิดด้วย Notepad แก้ให้ตรงกับบัญชี Facebook ที่ชีตใช้บนเครื่องนี้ — แต่ละบัญชีมี 3 ช่อง:

```json
{
  "accounts": [
    {
      "sheetAccount": "ชื่อที่พิมพ์ในคอลัมน์ Facebook Account ของชีต",
      "expectedDisplayName": "ชื่อโปรไฟล์ Facebook จริง (ต้องตรงเป๊ะ)",
      "profileDir": "./data/facebook-profiles/ชื่อโฟลเดอร์-ไม่ซ้ำกัน"
    }
  ]
}
```

บัญชีคนละคนต้องใช้ `profileDir` คนละอัน (ไม่งั้นจะใช้ session เดียวกันโดยไม่ตั้งใจ)

### 4. Login Facebook ทีละบัญชี

**ทำมือ ข้อจำกัดของ Facebook เอง ทำอัตโนมัติไม่ได้** — เปิด PowerShell ในโฟลเดอร์โปรเจกต์ แล้วรัน:

```powershell
npm run login:facebook -- "ชื่อบัญชีตามชีต"
```

จะมีหน้าต่าง Chrome เปิดขึ้นมาให้ login จริงด้วยตัวเอง พอ login เสร็จกลับมาที่หน้าต่าง PowerShell แล้วกด **Enter** ทำซ้ำทีละบัญชีจนครบ

### 5. เช็คว่า login ครบทุกบัญชี

```powershell
npm run check:facebook
```

ต้องเห็น **OK** ทุกบัญชี ถ้าบัญชีไหนขึ้น **NOT READY** ให้กลับไปทำขั้นตอน 4 ใหม่สำหรับบัญชีนั้น

### 6. ทดสอบก่อนใช้จริง

```powershell
npm test
npm run dry-run
```

`dry-run` จะอ่านชีตและเลือกแถวที่พร้อมโพสต์ แต่**ไม่โพสต์จริง** ใช้ตรวจว่า logic เลือกแถวถูกต้องก่อน (ใช้ `npm run dry-run:all` ถ้าอยากดูทุกแถวที่พร้อมโพสต์ ไม่ใช่แค่แถวแรก)

### 7. เปิดเผยแพร่จริง

แก้ในไฟล์ `.env`:

```text
PUBLISH_ENABLED=true
```

ทดสอบหนึ่งรอบด้วย `npm start` — คำสั่งนี้โพสต์จริงทันทีถ้ามีแถว Approved ที่เข้าเกณฑ์ (โพสต์แค่ 1 แถวต่อครั้ง) ตรวจผลในชีตและใน Facebook ให้แน่ใจก่อนไปขั้นตอนต่อไป

ถ้าต้องการโพสต์ทุกแถวที่ Approved ค้างอยู่รวดเดียว (ทีละแถวเหมือนเดิม แค่ไม่ต้องรันซ้ำเอง) ใช้ `npm run start:all` แทน

### 8. ตั้งเวลารันอัตโนมัติ

ค่าเริ่มต้นคือทุก 20 นาที:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1
```

หรือกำหนดความถี่เองด้วย `-IntervalMinutes` เช่น ทุก 5 นาที หรือทุก 10 นาที (เหมาะกับตอนทดสอบ ให้เห็นผลไวขึ้น):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1 -IntervalMinutes 5
powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1 -IntervalMinutes 10
```

รันซ้ำเพื่อเปลี่ยนความถี่ทีหลังได้ตลอด (script เขียนทับ task เดิม) เสร็จแล้วเครื่องนี้จะเช็คชีตตามรอบที่ตั้งไว้และโพสต์ตามเงื่อนไขเองอัตโนมัติ — เครื่องต้องเปิดอยู่และ login Windows ค้างไว้ตลอด

ถ้าต้องการถอด schedule ทีหลัง: `powershell -ExecutionPolicy Bypass -File .\scripts\remove-task.ps1`

---

**เสร็จแล้ว!** เครื่องนี้จะเช็คชีตและโพสต์ตามเงื่อนไขเองอัตโนมัติต่อจากนี้ — เครื่องต้องเปิดอยู่และ login Windows ค้างไว้ตลอด

## แก้ปัญหาเบื้องต้น

ดูหัวข้อ "การแก้ปัญหาเบื้องต้น" ใน [README.md](README.md)
