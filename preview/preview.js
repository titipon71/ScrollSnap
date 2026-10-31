/**
 * LongScreenshot Preview & Canvas Stitcher
 * นำเฟรมภาพทั้งหมดมาต่อกันอย่างแม่นยำ (รองรับทั้ง Window Scroll และ Inner Element Scroll)
 */

const pageTitleEl = document.getElementById('pageTitle');
const imageMetaEl = document.getElementById('imageMeta');
const canvas = document.getElementById('resultCanvas');
const canvasWrapper = document.getElementById('canvasWrapper');
const statusBanner = document.getElementById('statusBanner');
const zoomToggleBtn = document.getElementById('zoomToggleBtn');
const copyBtn = document.getElementById('copyBtn');
const downloadJpgBtn = document.getElementById('downloadJpgBtn');
const downloadPngBtn = document.getElementById('downloadPngBtn');

let captureMeta = null;
let isActualSize = false;

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = dataUrl;
  });
}

function showToast(text, duration = 2600) {
  statusBanner.textContent = text;
  statusBanner.classList.remove('hidden');
  setTimeout(() => {
    statusBanner.classList.add('hidden');
  }, duration);
}

/**
 * สร้างชื่อไฟล์ที่สะอาดและปลอดภัยสำหรับบันทึก
 */
function buildFileName(ext) {
  const rawTitle = (captureMeta && captureMeta.pageTitle) || 'longscreenshot';
  const cleanTitle = rawTitle
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60);
  const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${cleanTitle}_${dateStr}.${ext}`;
}

/**
 * นำชุดเฟรมภาพมาคำนวณระยะเลื่อนจริงและต่อกันลงบน HTML5 Canvas
 */
async function stitchFrames(data) {
  const frames = data.frames || [];
  if (frames.length === 0) {
    pageTitleEl.textContent = 'ไม่พบข้อมูลภาพที่แคป';
    return;
  }

  captureMeta = data;
  pageTitleEl.textContent = data.pageTitle || 'Long Screenshot';

  // โหลดรูปแรกเพื่อเช็คสัดส่วนจริงของภาพที่แคปได้เทียบกับ Viewport
  const firstImg = await loadImage(frames[0].dataUrl);
  const scaleX = firstImg.naturalWidth / (data.viewportWidth || firstImg.naturalWidth);
  const scaleY = firstImg.naturalHeight / (data.viewportHeight || firstImg.naturalHeight);

  const firstCrop = frames[0].cropRect;
  const outputWidth = Math.round(firstCrop.width * scaleX);

  // คำนวณความสูงรวมของภาพหลังจากตัดส่วนที่ซ้ำกันในแต่ละเฟรมออก
  const segments = [];
  let totalOutputHeight = 0;

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const crop = f.cropRect;

    if (i === 0) {
      const sh = Math.round(crop.height * scaleY);
      segments.push({
        frameIndex: i,
        sx: Math.round(crop.x * scaleX),
        sy: Math.round(crop.y * scaleY),
        sw: outputWidth,
        sh,
        dy: 0
      });
      totalOutputHeight += sh;
    } else {
      const prevFrame = frames[i - 1];
      const deltaLogicalY = f.scrollTop - prevFrame.scrollTop;
      if (deltaLogicalY <= 0) continue;

      // ถ้าเลื่อนลงมาน้อยกว่าความสูงของกรอบ (เช่น เฟรมสุดท้าย) ให้ตัดเอาเฉพาะส่วนล่างสุดที่เพิ่งเลื่อนขึ้นมาใหม่
      const newLogicalHeight = Math.min(deltaLogicalY, crop.height);
      const overlapLogicalHeight = crop.height - newLogicalHeight;

      const sy = Math.round((crop.y + overlapLogicalHeight) * scaleY);
      const sh = Math.round(newLogicalHeight * scaleY);

      segments.push({
        frameIndex: i,
        sx: Math.round(crop.x * scaleX),
        sy,
        sw: outputWidth,
        sh,
        dy: totalOutputHeight
      });
      totalOutputHeight += sh;
    }
  }

  // ป้องกันไม่ให้เกินขีดจำกัดสูงสุดของ HTML5 Canvas บน Chromium (ประมาณ 32,767 px)
  const MAX_CANVAS_DIMENSION = 32700;
  const finalHeight = Math.min(totalOutputHeight, MAX_CANVAS_DIMENSION);

  canvas.width = outputWidth;
  canvas.height = finalHeight;

  const ctx = canvas.getContext('2d');
  // เติมพื้นหลังสีขาวเผื่อกรณีบันทึกเป็นไฟล์ JPG
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const seg of segments) {
    if (seg.dy >= finalHeight) break;
    const img = seg.frameIndex === 0 ? firstImg : await loadImage(frames[seg.frameIndex].dataUrl);
    const drawHeight = Math.min(seg.sh, finalHeight - seg.dy);

    ctx.drawImage(
      img,
      seg.sx,
      seg.sy,
      seg.sw,
      drawHeight,
      0,
      seg.dy,
      outputWidth,
      drawHeight
    );
  }

  imageMetaEl.textContent = `ขนาดภาพ: ${canvas.width.toLocaleString()} × ${canvas.height.toLocaleString()} px (${frames.length} เฟรม)`;

  // ล้างข้อมูลภาพดิบออกจาก storage เพื่อคืนพื้นที่หน่วยความจำ
  chrome.storage.local.remove(['latestCaptureData']);
}

// สลับโหมดซูม (พอดีหน้าจอ <-> ขนาดจริง 100%)
function toggleZoom() {
  isActualSize = !isActualSize;
  if (isActualSize) {
    canvasWrapper.classList.remove('fit-width');
    canvasWrapper.classList.add('actual-size');
    zoomToggleBtn.textContent = '📐 พอดีหน้าจอ';
  } else {
    canvasWrapper.classList.remove('actual-size');
    canvasWrapper.classList.add('fit-width');
    zoomToggleBtn.textContent = '🔍 ซูม 100%';
  }
}

zoomToggleBtn.addEventListener('click', toggleZoom);
canvas.addEventListener('click', toggleZoom);

// ปุ่มบันทึกเป็น PNG
downloadPngBtn.addEventListener('click', () => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildFileName('png');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast('✅ บันทึกไฟล์ PNG เรียบร้อยแล้ว');
  }, 'image/png');
});

// ปุ่มบันทึกเป็น JPG
downloadJpgBtn.addEventListener('click', () => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildFileName('jpg');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast('✅ บันทึกไฟล์ JPG เรียบร้อยแล้ว');
  }, 'image/jpeg', 0.92);
});

// ปุ่มคัดลอกภาพลง Clipboard
copyBtn.addEventListener('click', () => {
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      showToast('📋 คัดลอกภาพไปยัง Clipboard เรียบร้อยแล้ว!');
    } catch (err) {
      showToast('❌ ไม่สามารถคัดลอกลง Clipboard ได้: ' + err.message);
    }
  }, 'image/png');
});

// เริ่มต้นโหลดเฟรมภาพเมื่อเปิดหน้า Preview
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get(['latestCaptureData']);
  if (!stored || !stored.latestCaptureData) {
    pageTitleEl.textContent = 'ไม่พบภาพที่แคปไว้ล่าสุด';
    imageMetaEl.textContent = 'กรุณากดแคปหน้าจอใหม่จากไอคอน Extension';
    return;
  }

  try {
    await stitchFrames(stored.latestCaptureData);
  } catch (err) {
    pageTitleEl.textContent = 'เกิดข้อผิดพลาดในการรวมภาพ';
    imageMetaEl.textContent = err.message;
  }
});
