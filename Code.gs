/**
 * ===================================================================
 *  ระบบหลังบ้านใบรายการขาย (Backend) — Google Apps Script  [เวอร์ชันเต็ม]
 * ===================================================================
 *  ต้องมีแท็บทั้งหมด 6 แท็บ ในไฟล์ Google Sheet เดียวกัน (ชื่อต้องตรงเป๊ะ):
 *
 *  1. "พนักงาน"        รหัสพนักงาน | ชื่อ-นามสกุล | ชื่อเล่น | รหัสสาขา | ชื่อสาขา
 *
 *  2. "สาขา"           รหัสสาขา | ชื่อสาขา | กลุ่มหัวหน้าดูแล | สายรถวิ่ง
 *                      (ข้อมูลหลังบ้านล้วนๆ ไม่โผล่ในใบรายการขาย ใช้สำหรับ
 *                       รายงาน/แดชบอร์ดที่จะทำต่อในเฟสถัดไป)
 *
 *  3. "บันทึกการขาย"   ปล่อยว่างไว้ก่อน ระบบสร้างหัวคอลัมน์ให้เองตอนบันทึกครั้งแรก
 *                      (แบบ APPEND-ONLY — ไม่มีการเขียนทับ/ลบแถวเดิมเด็ดขาด)
 *
 *  4. "ตั้งค่า"         รายการ | ค่า
 *                      ราคาแก้วจัมโบ้ | 35
 *                      ราคาแก้วใหญ่ | 30
 *                      ราคาแก้วเล็ก | 25
 *                      ราคาน้ำเต้าหู้ | 15
 *                      ราคาไข่มุก/วุ้นต่อช้อน | 5
 *                      เป้าคอมมิชชั่น A (บาท/วัน) | 190000
 *                      เป้าคอมมิชชั่น B (บาท/วัน) | 142500
 *                      อัตราคอมมิชชั่น A (บาท/แก้ว) | 1
 *                      อัตราคอมมิชชั่น B (บาท/แก้ว) | 0.5
 *
 *  5. "สิทธิ์ผู้ใช้งาน" รหัสอ้างอิง | ชื่อ | ระดับสิทธิ์ | ขอบเขต(สาย ถ้ามี)
 *                      ระดับสิทธิ์ 1=Owner 2=Admin 3=บัญชี 4=ผู้จัดการ
 *                      5=หัวหน้าสาย 6=พนักงาน 7=Viewer
 *                      (ใช้กับหน้ารายงาน/แดชบอร์ดในเฟสถัดไป ฟอร์มขายไม่ต้อง
 *                       ล็อกอิน จึงยังไม่ผูกกับฟังก์ชันในไฟล์นี้ทั้งหมด)
 *
 *  6. "ตรวจนับแก้ว"    รหัสสาขา | วันที่ขาย | ชนิดแก้ว | พนักงานแจ้งคงเหลือ |
 *                      นับจริงได้ | สถานะ | ผู้นับ | วันที่นับ | บัญชีแก้ไขเป็น | ผู้แก้ไข(บัญชี)
 *                      (แผนกแก้วใช้บันทึกผลนับจริงเทียบกับที่พนักงานแจ้ง)
 *
 *  ตั้งค่าเพิ่มเติมใน Project Settings > Script Properties (ถ้าจะใช้แจ้งเตือน LINE):
 *     LINE_CHANNEL_ACCESS_TOKEN = (จาก LINE Developers Console)
 *     LINE_GROUP_ID              = (ID ของกลุ่มไลน์ที่จะส่งแจ้งเตือน)
 *  ถ้ายังไม่ตั้งค่า 2 ค่านี้ ระบบจะข้ามการแจ้งเตือนไปเงียบๆ ไม่ error
 * ===================================================================
 */

const SHEET_ID = '1H4ngsx-JVl-w_s7qQjc14UjJGwilVxC_SStPzTdb2e8';

const SHEET_EMPLOYEE  = 'พนักงาน';
const SHEET_BRANCH     = 'สาขา';
const SHEET_SALES      = 'บันทึกการขาย';
const SHEET_SETTINGS   = 'ตั้งค่า';
const SHEET_PERMISSION = 'สิทธิ์ผู้ใช้งาน';
const SHEET_CUPCHECK   = 'ตรวจนับแก้ว';

const CUP_PRICES = { jumbo: 35, large: 30, small: 25 }; // ไม่รวมน้ำเต้าหู้ (ใช้คิดค่าคอม)

/* =========================== ROUTER =========================== */

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'lookupEmployee')     return jsonResponse(lookupEmployee(e.parameter.code));
  if (action === 'lookupBranch')       return jsonResponse(lookupBranch(e.parameter.branchCode));
  if (action === 'listBranches')       return jsonResponse(listBranches());
  if (action === 'getSettings')        return jsonResponse(getSettings());
  if (action === 'getCarryover')       return jsonResponse(getCarryover(e.parameter.branchCode));
  if (action === 'checkExisting')      return jsonResponse(checkExisting(e.parameter.branchCode, e.parameter.saleDate));
  if (action === 'getCommissionStatus')return jsonResponse(getCommissionStatus(e.parameter.saleDate));
  if (action === 'getVersion')         return jsonResponse({ version: 'v4-debugbox-2026-07-14', hasReadSlipImages: typeof readSlipImages === 'function', hasReadLinemanOrders: typeof readLinemanOrders === 'function' });
  if (action === 'testGemini')         return jsonResponse(testGemini());
  return jsonResponse({ error: 'ไม่รู้จักคำสั่งนี้ (unknown action)' });
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.action === 'saveSale')          return jsonResponse(saveSale(body.data));
  if (body.action === 'saveCupCheck')      return jsonResponse(saveCupCheck(body.data));
  if (body.action === 'readSlipImages')    return jsonResponse(readSlipImages(body.images, body.mimeTypes));
  if (body.action === 'readLinemanOrders') return jsonResponse(readLinemanOrders(body.images, body.mimeTypes));
  return jsonResponse({ error: 'ไม่รู้จักคำสั่งนี้ (unknown action)' });
}

/* ===================== พนักงาน / สาขา ===================== */

function lookupEmployee(code) {
  if (!code) return { found: false };
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_EMPLOYEE);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[0]).trim() === String(code).trim()) {
      return { found: true, empCode: row[0], name: row[1], nickname: row[2], branchCode: row[3], branch: row[4] };
    }
  }
  return { found: false };
}

// ใช้ตอนกรอก "รหัสสาขาที่ไปขายแทน" — ดึงแค่ชื่อสาขา เพื่อขึ้นป๊อปอัพยืนยัน
function lookupBranch(branchCode) {
  if (!branchCode) return { found: false };
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_BRANCH);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(branchCode).trim()) {
      return { found: true, branchCode: data[i][0], branch: data[i][1], careGroup: data[i][2], routeLine: data[i][3] };
    }
  }
  return { found: false };
}

// ใช้สำหรับปุ่ม "เลือกสาขา" (ค้นหาจากชื่อ แล้วได้รหัสสาขากลับมา)
function listBranches() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_BRANCH);
  const data = sheet.getDataRange().getValues();
  const branches = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) branches.push({ branchCode: data[i][0], branch: data[i][1] });
  }
  return { branches: branches };
}

function getSettings() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_SETTINGS);
  const data = sheet.getDataRange().getValues();
  const settings = {};
  for (let i = 1; i < data.length; i++) settings[data[i][0]] = data[i][1];
  return settings;
}

/* ===================== บันทึกการขาย (APPEND-ONLY) ===================== */

// เช็คก่อนว่าสาขา+วันนี้เคยมีบันทึกไปแล้วหรือยัง (ฟอร์มเรียกก่อนกดบันทึกจริง
// เพื่อเตือนพนักงาน — ไม่ใช่การบล็อก แค่ให้ยืนยันก่อนว่าตั้งใจส่งซ้ำจริงไหม)
function checkExisting(branchCode, saleDate) {
  if (!branchCode || !saleDate) return { exists: false };
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_SALES);
  if (sheet.getLastRow() < 2) return { exists: false };

  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const branchIdx = header.indexOf('branchCode');
  const dateIdx = header.indexOf('saleDate');
  const timeIdx = header.indexOf('submittedAt');
  if (branchIdx === -1 || dateIdx === -1) return { exists: false };

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][branchIdx]).trim() === String(branchCode).trim() &&
        String(data[i][dateIdx]).trim() === String(saleDate).trim()) {
      return { exists: true, submittedAt: timeIdx !== -1 ? data[i][timeIdx] : '' };
    }
  }
  return { exists: false };
}

// บันทึกรายการขาย — เพิ่มแถวใหม่เสมอ ไม่มีวันทับ/ลบข้อมูลเดิม (append-only)
// ถ้าสถานะติดส้ม/แดง(ขออนุมัติ) จะส่งแจ้งเตือนเข้ากลุ่มไลน์ให้อัตโนมัติ
function saveSale(data) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_SALES);
  data.submittedAt = new Date().toISOString();

  const keys = Object.keys(data);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(keys);
  }
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = header.map(h => (data[h] !== undefined ? data[h] : ''));
  sheet.appendRow(row);

  notifyIfNeeded(data);

  return { success: true, message: 'บันทึกข้อมูลเรียบร้อย' };
}

function notifyIfNeeded(data) {
  if (data.flagStatus === 'orange') {
    sendLineGroupMessage(
      `🟠 พบข้อมูลติดสถานะส้ม (บันทึกแล้ว รอตรวจสอบ)\n` +
      `สาขา: ${data.branchCode}  วันที่: ${data.saleDate}\n` +
      `รายละเอียด: ${data.flagReasons || '-'}`
    );
  } else if (data.flagStatus === 'red_override') {
    sendLineGroupMessage(
      `🔴 ขออนุมัติส่งข้อมูล (ติดสถานะแดง)\n` +
      `สาขา: ${data.branchCode}  วันที่: ${data.saleDate}\n` +
      `ปัญหา: ${data.flagReasons || '-'}\n` +
      `หมายเหตุจากพนักงาน: ${data.overrideNote || '-'}\n` +
      `⚠️ กรุณาตรวจสอบและอนุมัติโดยเร็ว`
    );
  }
}

/* ===================== ยอดยกมา (น้ำเต้าหู้ + เครื่องซีล) ===================== */

function getCarryover(branchCode) {
  if (!branchCode) return { found: false, soyRemaining: 0, sealClose: 0 };
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_SALES);
  if (sheet.getLastRow() < 2) return { found: false, soyRemaining: 0, sealClose: 0 };

  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const branchColIdx = header.indexOf('branchCode');
  const cupsColIdx = header.indexOf('cups');
  const sealCloseColIdx = header.indexOf('sealClose');
  if (branchColIdx === -1 || cupsColIdx === -1) return { found: false, soyRemaining: 0, sealClose: 0 };

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][branchColIdx]).trim() === String(branchCode).trim()) {
      let soyRemaining = 0;
      try {
        const cups = JSON.parse(data[i][cupsColIdx] || '{}');
        soyRemaining = (cups.soy && cups.soy.remaining) || 0;
      } catch (err) { soyRemaining = 0; }
      const sealClose = sealCloseColIdx !== -1 ? (data[i][sealCloseColIdx] || 0) : 0;
      return { found: true, soyRemaining: soyRemaining, sealClose: sealClose };
    }
  }
  return { found: false, soyRemaining: 0, sealClose: 0 };
}

/* ===================== ค่าคอมมิชชั่นรายวัน (ไม่ส่งตัวเลขกลับ) ===================== */

// สำคัญ: ฟังก์ชันนี้จะไม่คืนตัวเลขบาท/เป้า/ยอดขายกลับไปเด็ดขาด
// เพราะระดับพนักงาน (4-7) ห้ามเห็นตัวเลขเหล่านี้ตามนโยบายบริษัท
// ส่งกลับแค่ข้อความให้กำลังใจ/แสดงความยินดีเท่านั้น
function getCommissionStatus(saleDate) {
  if (!saleDate) return { ready: false, message: 'ข้อมูลยังไม่ครบ' };

  const branchSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_BRANCH);
  const totalBranches = Math.max(branchSheet.getLastRow() - 1, 0); // ลบแถวหัวตาราง

  const salesSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_SALES);
  if (salesSheet.getLastRow() < 2 || totalBranches === 0) {
    return { ready: false, message: 'ข้อมูลยังไม่ครบ' };
  }

  const data = salesSheet.getDataRange().getValues();
  const header = data[0];
  const dateIdx = header.indexOf('saleDate');
  const branchIdx = header.indexOf('branchCode');
  const cupsIdx = header.indexOf('cups');
  if (dateIdx === -1 || branchIdx === -1 || cupsIdx === -1) {
    return { ready: false, message: 'ข้อมูลยังไม่ครบ' };
  }

  const seenBranches = new Set();
  let totalEligibleSales = 0;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][dateIdx]).trim() !== String(saleDate).trim()) continue;
    seenBranches.add(String(data[i][branchIdx]).trim());
    try {
      const cups = JSON.parse(data[i][cupsIdx] || '{}');
      Object.keys(CUP_PRICES).forEach(key => {
        if (cups[key]) {
          const soldTotal = (Number(cups[key].sold) || 0) + (Number(cups[key].transfer) || 0);
          totalEligibleSales += soldTotal * CUP_PRICES[key];
        }
      });
    } catch (err) { /* ข้ามแถวที่ parse ไม่ได้ */ }
  }

  // ยังส่งข้อมูลมาไม่ครบทุกสาขา -> ยังฟันธงไม่ได้
  if (seenBranches.size < totalBranches) {
    return { ready: false, message: 'ข้อมูลยังไม่ครบ' };
  }

  const settings = getSettings();
  const targetA = Number(settings['เป้าคอมมิชชั่น A (บาท/วัน)']) || 190000;
  const targetB = Number(settings['เป้าคอมมิชชั่น B (บาท/วัน)']) || 142500;

  let message;
  if (totalEligibleSales >= targetA)       message = 'ยินดีด้วยได้รับค่าคอม A';
  else if (totalEligibleSales >= targetB)  message = 'ยินดีด้วยได้รับค่าคอม B';
  else                                     message = 'เป็นกำลังใจให้นะคะ';

  return { ready: true, message: message };
}

/* ===================== แผนกแก้ว (ตรวจนับ) ===================== */

function saveCupCheck(data) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_CUPCHECK);
  data.checkedAt = new Date().toISOString();
  const keys = Object.keys(data);
  if (sheet.getLastRow() === 0) sheet.appendRow(keys);
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = header.map(h => (data[h] !== undefined ? data[h] : ''));
  sheet.appendRow(row);
  return { success: true };
}

/* ===================== แจ้งเตือนกลุ่มไลน์ ===================== */

// ถ้ายังไม่ตั้งค่า Script Properties (LINE_CHANNEL_ACCESS_TOKEN, LINE_GROUP_ID)
// ฟังก์ชันนี้จะข้ามไปเงียบๆ ไม่ทำให้การบันทึกข้อมูล error
function sendLineGroupMessage(text) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const groupId = props.getProperty('LINE_GROUP_ID');
  if (!token || !groupId) return;

  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: groupId, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    // เงียบไว้ ไม่ให้กระทบการบันทึกข้อมูลหลัก
  }
}

/* ===================== ตัวช่วยส่ง JSON ===================== */

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ===================================================================
 *  อ่านภาพด้วย Gemini API (OCR)
 *  หมายเหตุ: คีย์นี้ฝังตรงในโค้ดตามที่ขอ (ใช้คนเดียว) — ถ้าในอนาคตแชร์สิทธิ์แก้ไข
 *  สคริปต์นี้ให้คนอื่น หรือส่งไฟล์นี้ต่อให้ใครโดยไม่ได้ตั้งใจ คนนั้นจะเห็นคีย์นี้ด้วย
 *  ถ้าอยากเปลี่ยนกลับไปเก็บแบบปลอดภัยกว่า (Script Properties) ทีหลังบอกได้เสมอ
 * =================================================================== */

const GEMINI_API_KEY_HARDCODED = 'AQ.Ab8RN6IkB0O6am2b2A6hwuswMQHRKkzxcwUpgHIKLkA1XAM9rw';

// ทดสอบง่ายๆ ว่า Gemini API เชื่อมต่อได้ไหม (ไม่ใช้ภาพเลย ตัดตัวแปรเรื่องภาพออก)
// เรียกดูผ่านลิงก์ตรงๆ ได้เลย: (ลิงก์.../exec)?action=testGemini
function testGemini(){
  const apiKey = GEMINI_API_KEY_HARDCODED || PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if(!apiKey){
    return { ok:false, step:'apiKey', error:'ไม่มี API key เลย (ทั้ง hardcode และ Script Properties ว่างเปล่า)' };
  }
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey;
  const payload = { contents: [{ parts: [{ text: 'ตอบคำว่า OK คำเดียวเท่านั้น' }] }] };
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true,
    });
    const httpCode = res.getResponseCode();
    const rawText = res.getContentText();
    return {
      ok: httpCode === 200,
      httpCode: httpCode,
      apiKeyPrefix: apiKey.slice(0,8) + '...' + apiKey.slice(-4),
      rawResponse: rawText.slice(0, 800),
    };
  } catch(err){
    return { ok:false, step:'fetch', error: String(err) };
  }
}

function callGemini_(promptText, base64Image, mimeType){
  const apiKey = GEMINI_API_KEY_HARDCODED || PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if(!apiKey){
    return { ok:false, error:'ยังไม่ได้ตั้งค่า GEMINI_API_KEY' };
  }
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey;
  const payload = {
    contents: [{
      parts: [
        { text: promptText },
        { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Image } }
      ]
    }],
    generationConfig: { temperature: 0 }
  };
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true,
    });
    const httpCode = res.getResponseCode();
    const result = JSON.parse(res.getContentText());
    if(httpCode !== 200){
      return { ok:false, error: 'HTTP ' + httpCode + ': ' + ((result.error && result.error.message) || res.getContentText().slice(0,200)) };
    }
    if(!result.candidates || !result.candidates[0]){
      return { ok:false, error: (result.error && result.error.message) || 'ไม่มีคำตอบกลับมาจาก Gemini (อาจโดนบล็อกด้วยตัวกรองความปลอดภัย)' };
    }
    let text = result.candidates[0].content.parts[0].text || '';
    text = text.replace(/```json/gi,'').replace(/```/g,'').trim();
    return { ok:true, text: text };
  } catch(err){
    return { ok:false, error: String(err) };
  }
}

// อ่านยอดเงินจากภาพสลิปโอนหลายภาพ แล้วรวมยอดทั้งหมดให้
function readSlipImages(base64Images, mimeTypes){
  if(!base64Images || !base64Images.length) return { success:false, error:'ไม่มีภาพส่งมา' };

  const prompt = 'อ่านยอดเงินโอนจากภาพสลิปธนาคาร/พร้อมเพย์นี้ ตอบกลับเป็นตัวเลขจำนวนเงินอย่างเดียว ' +
                  'ห้ามมีข้อความอื่น ห้ามมีเครื่องหมายจุลภาค ถ้าอ่านไม่ออกให้ตอบคำว่า ไม่พบ';

  let total = 0;
  let readCount = 0;
  let errors = [];
  let debugRaw = [];

  for (let idx = 0; idx < base64Images.length; idx++) {
    const b64 = base64Images[idx];
    const mt = (mimeTypes && mimeTypes[idx]) || 'image/jpeg';
    let result;
    try {
      result = callGemini_(prompt, b64, mt);
    } catch(e) {
      result = { ok:false, error: 'Exception ตอนเรียก Gemini: ' + String(e) };
    }

    debugRaw.push('ภาพ' + (idx+1) + ': ' + JSON.stringify(result).slice(0, 400));

    if (result && result.ok) {
      const num = parseFloat(String(result.text).replace(/[^0-9.]/g,''));
      if (!isNaN(num)) {
        total += num;
        readCount++;
      } else {
        errors.push('ภาพที่ ' + (idx+1) + ': Gemini ตอบว่า "' + result.text + '" (แปลงเป็นตัวเลขไม่ได้)');
      }
    } else {
      errors.push('ภาพที่ ' + (idx+1) + ': ' + (result ? result.error : 'ไม่มีผลลัพธ์กลับมาเลย'));
    }
  }

  return {
    success: true,
    total: total,
    readCount: readCount,
    totalImages: base64Images.length,
    errors: errors,
    debugRaw: debugRaw, // ข้อมูลดิบเต็มๆ สำหรับดีบัก ลบออกได้ทีหลังเมื่อใช้งานได้แล้ว
  };
}

// อ่านออเดอร์ไลน์แมนจากภาพหลายภาพ แยกเลขออเดอร์ + จำนวนแก้วแต่ละไซส์
function readLinemanOrders(base64Images, mimeTypes){
  if(!base64Images || !base64Images.length) return { success:false, error:'ไม่มีภาพส่งมา' };

  const prompt =
    'อ่านภาพหน้าจอออเดอร์ไลน์แมน (LINE MAN) นี้ ร้านนี้ขายเครื่องดื่ม 4 ขนาด: ' +
    'แก้วจัมโบ้, แก้วใหญ่, แก้วเล็ก, น้ำเต้าหู้ ' +
    'ให้หาเลขออเดอร์ (มักขึ้นต้นด้วย # ตามด้วยตัวเลข) และนับจำนวนแก้วแต่ละขนาดที่สั่งในออเดอร์นี้ ' +
    'ตอบกลับเป็น JSON เท่านั้น รูปแบบนี้ ไม่ต้องมีข้อความอื่นเลย: ' +
    '{"order":"#1234","jumbo":0,"large":0,"small":0,"soy":0} ' +
    'ถ้าอ่านเลขออเดอร์ไม่ได้ให้ใส่ "ไม่ทราบ" ถ้าไม่มีแก้วขนาดนั้นให้ใส่ 0';

  const orders = [];

  base64Images.forEach(function(b64, idx){
    const mt = (mimeTypes && mimeTypes[idx]) || 'image/jpeg';
    const result = callGemini_(prompt, b64, mt);
    if(result.ok){
      try {
        const parsed = JSON.parse(result.text);
        orders.push({
          order: parsed.order || 'ไม่ทราบ',
          jumbo: Number(parsed.jumbo) || 0,
          large: Number(parsed.large) || 0,
          small: Number(parsed.small) || 0,
          soy: Number(parsed.soy) || 0,
        });
      } catch(err){
        orders.push({ order:'อ่านไม่สำเร็จ: ตอบไม่ใช่ JSON (' + result.text.slice(0,60) + ')', jumbo:0, large:0, small:0, soy:0 });
      }
    } else {
      orders.push({ order:'อ่านไม่สำเร็จ: ' + result.error, jumbo:0, large:0, small:0, soy:0 });
    }
  });

  return { success:true, orders: orders };
}
