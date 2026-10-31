# 📸 ScrollSnap — Full Page Screenshot Extension

**ScrollSnap** (LongScreenshot) เป็นส่วนขยายเบราว์เซอร์ (Browser Extension) บนมาตรฐาน **Manifest V3** สำหรับแคปหน้าเว็บแบบยาวทั้งหน้า (Full Page Scrolling Screenshot) โดยอัตโนมัติ พัฒนาด้วย Vanilla JavaScript ล้วน โหลดไว ไม่พึ่งพาไลบรารีภายนอก

---

## ✨ ฟีเจอร์หลัก (Key Features)

* **Seamless Full-Page Capture**: เลื่อนหน้าจอและแคปภาพทีละส่วนอัตโนมัติ พร้อมนำมาต่อกันด้วย HTML5 Canvas อย่างแม่นยำ (รองรับหน้าจอความละเอียดสูง / Retina Display `devicePixelRatio`)
* **Smart Sticky & Fixed Element Removal**:
  * แสดงแถบเมนูด้านบน (Navbar / Sticky Header) เฉพาะในเฟรมแรกอย่างเป็นธรรมชาติ และซ่อนอัตโนมัติในเฟรมถัดๆ ไปเพื่อไม่ให้บังเนื้อหา
  * ซ่อนปุ่มลอย (Floating Chat, ปุ่ม Back-to-top, แบนเนอร์คุกกี้ด้านล่าง) ตั้งแต่เฟรมแรกเพื่อไม่ให้ติดค้างกลางภาพ
* **Layout-Shift Compensation**: ชดเชยระยะกระตุกของหน้าเว็บอัตโนมัติ เมื่อเว็บไซต์เปลี่ยนสถานะของ Navbar จาก `relative/static` ไปเป็น `position: fixed` ขณะเลื่อนหน้าจอ ทำให้รอยต่อระหว่างเฟรมที่ 1 และ 2 ต่อกันสนิทไม่แหว่ง
* **Inner Scroll Container Detection**: รองรับทั้งหน้าเว็บปกติและ Web App สมัยใหม่ที่เลื่อนเนื้อหาภายใน `<div>` (`overflow-y: auto/scroll`)
* **Infinite Scroll Protection & Early Stop**: ตั้งเพดานความสูงสูงสุดได้ (10,000 / 20,000 / 30,000 px) และกดปุ่ม `Esc` หรือคลิกไอคอนซ้ำเพื่อหยุดแคปและรวมภาพได้ทันที
* **Built-in Preview & Export**: หน้าแท็บแสดงตัวอย่างภาพขนาดใหญ่ สลับซูมดูขนาดจริง 100%, คัดลอกลง **Clipboard** หรือบันทึกเป็นไฟล์ **PNG** และ **JPG**

---

## 🚀 วิธีติดตั้ง (Installation - Developer Mode)

1. Clone หรือดาวน์โหลด Repository นี้ลงเครื่อง:
   ```bash
   git clone https://github.com/titipon71/ScrollSnap.git
   ```
2. เปิดเบราว์เซอร์ Chrome หรือ Microsoft Edge แล้วไปที่หน้า `chrome://extensions/` (หรือ `edge://extensions/`)
3. เปิดสวิตช์ **Developer mode** (โหมดนักพัฒนา) ที่มุมขวาบน
4. คลิกปุ่ม **Load unpacked** (โหลดส่วนขยายที่ยังไม่ได้แพ็ก)
5. เลือกโฟลเดอร์โปรเจกต์ `ScrollSnap` (หรือ `LongScreenshot`)

---

## ⌨️ การใช้งานและคีย์ลัด (Usage)

* **คลิกที่ไอคอนส่วนขยาย** บนแถบเบราว์เซอร์ แล้วกดปุ่ม **"แคปทั้งหน้าเว็บ (Full Page)"**
* หรือใช้คีย์ลัด **`Alt + Shift + S`** เพื่อเริ่ม/หยุดแคปหน้าจอยาวทันที
* ระหว่างที่หน้าจอกำลังเลื่อนแคป สามารถกดปุ่ม **`Esc`** บนคีย์บอร์ดเพื่อสั่งหยุดและรวมภาพเท่าที่แคปได้ทันที

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
ScrollSnap/
├── manifest.json          # กำหนดค่า Manifest V3, สิทธิ์การใช้งาน และคีย์ลัด
├── background.js          # Service Worker ควบคุมลูปการแคปและอัปเดตสถานะ Badge
├── content.js             # สคริปต์จัดการการเลื่อนหน้าจอ, ซ่อน Sticky Header และชดเชย Layout Shift
├── popup/                 # หน้าต่างเมนูตั้งค่าและกดเริ่มแคป
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── preview/               # หน้าแสดงผลลัพธ์ ต่อภาพด้วย Canvas และส่งออกไฟล์ PNG/JPG/Clipboard
│   ├── preview.html
│   ├── preview.css
│   └── preview.js
└── icons/                 # ไอคอนส่วนขยาย (16x16, 48x48, 128x128)
```
