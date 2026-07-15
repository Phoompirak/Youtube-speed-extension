# ⚡ Speed Controller Turbo

ส่วนขยาย Chrome สำหรับควบคุมความเร็ววิดีโอ (x1 - x16), ปิดเสียงและเร่งสปีดโฆษณาอัตโนมัติ (Ad Turbo), บล็อกป๊อปอัป (Ad Blocker) และจดจำสปีดแยกรายเว็บ

## 🛠️ วิธีติดตั้ง (Developer Mode)
(โหลดไฟล์ Zip มาก็ได้ แล้วแตกไฟล์)
1. เปิดเบราว์เซอร์ Chrome ไปที่หน้า `chrome://extensions/`
2. เปิดโหมดนักพัฒนา **(Developer mode)** ที่มุมขวาบน
3. คลิกปุ่ม **โหลดส่วนขยายที่คลายบีบอัดแล้ว (Load unpacked)** ที่มุมซ้ายบน
4. เลือกโฟลเดอร์ของโปรเจกต์นี้ เพื่อเริ่มใช้งานได้ทันที

---

## 🌟 ฟีเจอร์หลัก

* **⚡ Ad Turbo (x16 Ads):** เร่งสปีดโฆษณาอัตโนมัติ 16 เท่า พร้อมปิดเสียงและกดข้าม (Skip) ให้อัตโนมัติ คืนค่าเสียง/สปีดเมื่อโฆษณาจบ
* **🛡️ Ad Blocker (7-Layer):** ระบบบล็อกแบนเนอร์ ป๊อปอัป และองค์ประกอบโฆษณาทั่วไปบนเว็บ
* **🪟 Floating Panel:** แผงควบคุมลอยน้ำบนหน้าเว็บ ปรับสปีดสะดวก ลากย้ายตำแหน่งได้ตามใจชอบ
* **📌 Per-Site Speed:** จำความเร็วในการเล่นวิดีโอแยกเป็นรายโดเมนเว็บ
* **⌨️ Keyboard Shortcuts:**
  * `]` : เพิ่มความเร็ววิดีโอ
  * `[` : ลดความเร็ววิดีโอ
  * `\` : รีเซ็ตความเร็วเป็น x1
  * `t` : เปิด/ปิด Turbo Mode

---

## 📂 โครงสร้างไฟล์สำคัญ

* [manifest.json](file:///E:/Elearning-เกษตร-Python/youtube-speed-extension/manifest.json) : ข้อมูลส่วนขยาย สิทธิ์การเข้าถึง และการตั้งค่าไอคอน
* [content.js](file:///E:/Elearning-เกษตร-Python/youtube-speed-extension/content.js) : ตัวควบคุมความเร็ว คีย์ลัด แผงลอย และระบบ Ad Turbo/Blocker
* [popup.html](file:///E:/Elearning-เกษตร-Python/youtube-speed-extension/popup.html) & [popup.js](file:///E:/Elearning-เกษตร-Python/youtube-speed-extension/popup.js) : หน้าต่างควบคุมเมื่อกดไอคอนบนทาสก์บาร์
* [styles.css](file:///E:/Elearning-เกษตร-Python/youtube-speed-extension/styles.css) : สไตล์ชีทของแผงลอย (Floating Panel)
