/**
 * LongScreenshot Preview, Canvas Stitcher, Interactive Cropper & Native PDF Generator
 * นำเฟรมภาพทั้งหมดมาต่อกันอย่างแม่นยำ พร้อมเครื่องมือ Crop 8 ทิศทาง (Auto-scroll + Undo)
 * และรองรับการส่งออก PNG, JPG, Clipboard และ PDF (ทั้งแบบหน้าเดียวยาว และแบ่งหน้า A4)
 */

const pageTitleEl = document.getElementById('pageTitle');
const imageMetaEl = document.getElementById('imageMeta');
const canvas = document.getElementById('resultCanvas');
const canvasWrapper = document.getElementById('canvasWrapper');
const statusBanner = document.getElementById('statusBanner');
const zoomToggleBtn = document.getElementById('zoomToggleBtn');
const cropToggleBtn = document.getElementById('cropToggleBtn');
const resetCropBtn = document.getElementById('resetCropBtn');
const copyBtn = document.getElementById('copyBtn');
const pdfModeSelect = document.getElementById('pdfModeSelect');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const downloadJpgBtn = document.getElementById('downloadJpgBtn');
const downloadPngBtn = document.getElementById('downloadPngBtn');

// Crop UI elements
const cropOverlay = document.getElementById('cropOverlay');
const cropBox = document.getElementById('cropBox');
const cropSizeBadge = document.getElementById('cropSizeBadge');
const applyCropBtn = document.getElementById('applyCropBtn');
const cancelCropBtn = document.getElementById('cancelCropBtn');

let captureMeta = null;
let isActualSize = false;
let originalFullCanvas = null; // สำรองภาพเต็มก่อน Crop เพื่อให้กด Undo/Reset ได้ตลอดเวลา
let totalFrameCount = 0;

// สถานะของเครื่องมือ Crop (เก็บค่าในหน่วยพิกเซลจริงของ Canvas เพื่อให้แม่นยำแม้สลับซูมหรือย่อหน้าต่าง)
let cropState = {
  active: false,
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  dragMode: null, // 'create' | 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
  startCanvasX: 0,
  startCanvasY: 0,
  initialRect: null,
  lastClientX: 0,
  lastClientY: 0,
  autoScrollRaf: null
};

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

function updateImageMetaText(suffix = '') {
  const extra = suffix ? ` • ${suffix}` : '';
  imageMetaEl.textContent = `ขนาดภาพ: ${canvas.width.toLocaleString()} × ${canvas.height.toLocaleString()} px (${totalFrameCount} เฟรม${extra})`;
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
  totalFrameCount = frames.length;
  pageTitleEl.textContent = data.pageTitle || 'Long Screenshot';

  const firstImg = await loadImage(frames[0].dataUrl);
  const scaleX = firstImg.naturalWidth / (data.viewportWidth || firstImg.naturalWidth);
  const scaleY = firstImg.naturalHeight / (data.viewportHeight || firstImg.naturalHeight);

  const firstCrop = frames[0].cropRect;
  const outputWidth = Math.round(firstCrop.width * scaleX);

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

  const MAX_CANVAS_DIMENSION = 32700;
  const finalHeight = Math.min(totalOutputHeight, MAX_CANVAS_DIMENSION);

  canvas.width = outputWidth;
  canvas.height = finalHeight;

  const ctx = canvas.getContext('2d');
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

  // สำรองภาพต้นฉบับไว้ใน Offscreen Canvas สำหรับปุ่ม Reset / Undo
  originalFullCanvas = document.createElement('canvas');
  originalFullCanvas.width = canvas.width;
  originalFullCanvas.height = canvas.height;
  originalFullCanvas.getContext('2d').drawImage(canvas, 0, 0);

  updateImageMetaText();
  chrome.storage.local.remove(['latestCaptureData']);
}

/* =========================================================
   ระบบ Interactive Image Cropper (8 ทิศทาง + Auto-Scroll + Undo)
   ========================================================= */

function getCanvasScale() {
  const rect = canvas.getBoundingClientRect();
  return {
    rect,
    scaleX: canvas.width / Math.max(1, rect.width),
    scaleY: canvas.height / Math.max(1, rect.height)
  };
}

function clientToCanvasCoords(clientX, clientY) {
  const { rect, scaleX, scaleY } = getCanvasScale();
  const rawX = (clientX - rect.left) * scaleX;
  const rawY = (clientY - rect.top) * scaleY;
  return {
    x: Math.max(0, Math.min(canvas.width, rawX)),
    y: Math.max(0, Math.min(canvas.height, rawY))
  };
}

function renderCropBox() {
  if (!cropState.active) return;
  const { rect, scaleX, scaleY } = getCanvasScale();
  if (!rect.width || !rect.height) return;

  const cssLeft = cropState.x / scaleX;
  const cssTop = cropState.y / scaleY;
  const cssWidth = cropState.w / scaleX;
  const cssHeight = cropState.h / scaleY;

  cropBox.style.left = `${cssLeft}px`;
  cropBox.style.top = `${cssTop}px`;
  cropBox.style.width = `${cssWidth}px`;
  cropBox.style.height = `${cssHeight}px`;

  const wPx = Math.max(1, Math.round(cropState.w));
  const hPx = Math.max(1, Math.round(cropState.h));
  cropSizeBadge.textContent = `${wPx.toLocaleString()} × ${hPx.toLocaleString()} px`;
}

function enterCropMode() {
  if (!canvas.width || !canvas.height) return;
  cropState.active = true;
  cropOverlay.classList.remove('hidden');
  cropToggleBtn.classList.add('active-tool');
  cropToggleBtn.textContent = '✂️ กำลังเลือกพื้นที่...';

  // สร้างกรอบเริ่มต้นครอบบริเวณที่ผู้ใช้กำลังมองเห็นอยู่ในหน้าจอปัจจุบัน (Viewport)
  const { rect, scaleY } = getCanvasScale();
  const topbarHeight = 64;
  const visibleTopCss = Math.max(0, topbarHeight - rect.top);
  const visibleBottomCss = Math.min(rect.height, window.innerHeight - rect.top);
  const visibleHeightCss = Math.max(120, visibleBottomCss - visibleTopCss);

  const marginX = Math.round(canvas.width * 0.06);
  const startY = Math.round(visibleTopCss * scaleY + visibleHeightCss * scaleY * 0.08);
  const startH = Math.round(visibleHeightCss * scaleY * 0.82);

  cropState.x = marginX;
  cropState.y = Math.max(0, Math.min(canvas.height - 60, startY));
  cropState.w = Math.max(60, canvas.width - marginX * 2);
  cropState.h = Math.max(60, Math.min(canvas.height - cropState.y, startH));

  renderCropBox();
  showToast('💡 ลากมุม/ขอบเพื่อปรับขนาด หรือคลิก-ลากพื้นที่ใหม่ แล้วกด Enter เพื่อตัดภาพ', 3500);
}

function exitCropMode() {
  stopAutoScrollLoop();
  cropState.active = false;
  cropState.dragMode = null;
  cropOverlay.classList.add('hidden');
  cropToggleBtn.classList.remove('active-tool');
  cropToggleBtn.textContent = '✂️ ตัดภาพ (Crop)';
}

function applyCrop() {
  if (!cropState.active) return;

  const sx = Math.max(0, Math.round(cropState.x));
  const sy = Math.max(0, Math.round(cropState.y));
  const sw = Math.min(canvas.width - sx, Math.round(cropState.w));
  const sh = Math.min(canvas.height - sy, Math.round(cropState.h));

  if (sw < 20 || sh < 20) {
    showToast('⚠️ กรอบขนาดเล็กเกินไป กรุณาลากเลือกพื้นที่ให้ใหญ่ขึ้น');
    return;
  }

  const temp = document.createElement('canvas');
  temp.width = sw;
  temp.height = sh;
  temp.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext('2d').drawImage(temp, 0, 0);

  exitCropMode();
  resetCropBtn.classList.remove('hidden');
  updateImageMetaText('ตัดภาพแล้ว');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast(`✂️ ตัดภาพขนาด ${sw.toLocaleString()} × ${sh.toLocaleString()} px เรียบร้อยแล้ว`);
}

function resetToOriginalImage() {
  if (!originalFullCanvas) return;
  exitCropMode();
  canvas.width = originalFullCanvas.width;
  canvas.height = originalFullCanvas.height;
  canvas.getContext('2d').drawImage(originalFullCanvas, 0, 0);
  resetCropBtn.classList.add('hidden');
  updateImageMetaText();
  showToast('↩️ คืนค่าภาพเต็มต้นฉบับเรียบร้อยแล้ว');
}

function updateCropDragFromPointer(clientX, clientY) {
  if (!cropState.dragMode) return;
  const pt = clientToCanvasCoords(clientX, clientY);
  const dx = pt.x - cropState.startCanvasX;
  const dy = pt.y - cropState.startCanvasY;
  const init = cropState.initialRect;
  const minSize = 30;

  if (cropState.dragMode === 'create') {
    const x1 = Math.min(cropState.startCanvasX, pt.x);
    const y1 = Math.min(cropState.startCanvasY, pt.y);
    const x2 = Math.max(cropState.startCanvasX, pt.x);
    const y2 = Math.max(cropState.startCanvasY, pt.y);
    cropState.x = x1;
    cropState.y = y1;
    cropState.w = Math.max(minSize, x2 - x1);
    cropState.h = Math.max(minSize, y2 - y1);
  } else if (cropState.dragMode === 'move') {
    cropState.x = Math.max(0, Math.min(canvas.width - init.w, init.x + dx));
    cropState.y = Math.max(0, Math.min(canvas.height - init.h, init.y + dy));
  } else {
    let left = init.x;
    let top = init.y;
    let right = init.x + init.w;
    let bottom = init.y + init.h;
    const dir = cropState.dragMode;

    if (dir.includes('w')) {
      left = Math.max(0, Math.min(right - minSize, init.x + dx));
    }
    if (dir.includes('e')) {
      right = Math.min(canvas.width, Math.max(left + minSize, init.x + init.w + dx));
    }
    if (dir.includes('n')) {
      top = Math.max(0, Math.min(bottom - minSize, init.y + dy));
    }
    if (dir.includes('s')) {
      bottom = Math.min(canvas.height, Math.max(top + minSize, init.y + init.h + dy));
    }

    cropState.x = left;
    cropState.y = top;
    cropState.w = right - left;
    cropState.h = bottom - top;
  }

  renderCropBox();
}

function startAutoScrollLoop() {
  if (cropState.autoScrollRaf) return;

  function step() {
    if (!cropState.dragMode) {
      cropState.autoScrollRaf = null;
      return;
    }

    const edgeThreshold = 65;
    const maxSpeed = 22;
    const y = cropState.lastClientY;
    const vh = window.innerHeight;
    let scrollDelta = 0;

    if (y > vh - edgeThreshold) {
      const ratio = Math.min(1, (y - (vh - edgeThreshold)) / edgeThreshold);
      scrollDelta = Math.ceil(ratio * maxSpeed);
    } else if (y < edgeThreshold + 55) {
      const ratio = Math.min(1, (edgeThreshold + 55 - y) / (edgeThreshold + 55));
      scrollDelta = -Math.ceil(ratio * maxSpeed);
    }

    if (scrollDelta !== 0) {
      window.scrollBy(0, scrollDelta);
      updateCropDragFromPointer(cropState.lastClientX, cropState.lastClientY);
    }

    cropState.autoScrollRaf = requestAnimationFrame(step);
  }

  cropState.autoScrollRaf = requestAnimationFrame(step);
}

function stopAutoScrollLoop() {
  if (cropState.autoScrollRaf) {
    cancelAnimationFrame(cropState.autoScrollRaf);
    cropState.autoScrollRaf = null;
  }
}

cropOverlay.addEventListener('mousedown', (e) => {
  if (!cropState.active || e.button !== 0) return;
  if (e.target.closest('#cropFloatingBar')) return;

  e.preventDefault();
  const pt = clientToCanvasCoords(e.clientX, e.clientY);
  cropState.startCanvasX = pt.x;
  cropState.startCanvasY = pt.y;
  cropState.lastClientX = e.clientX;
  cropState.lastClientY = e.clientY;
  cropState.initialRect = {
    x: cropState.x,
    y: cropState.y,
    w: cropState.w,
    h: cropState.h
  };

  const handle = e.target.closest('.crop-handle');
  if (handle && handle.dataset.dir) {
    cropState.dragMode = handle.dataset.dir;
  } else if (e.target.closest('#cropBox')) {
    cropState.dragMode = 'move';
  } else {
    cropState.dragMode = 'create';
    cropState.x = pt.x;
    cropState.y = pt.y;
    cropState.w = 1;
    cropState.h = 1;
    renderCropBox();
  }

  startAutoScrollLoop();
});

window.addEventListener('mousemove', (e) => {
  if (!cropState.active || !cropState.dragMode) return;
  cropState.lastClientX = e.clientX;
  cropState.lastClientY = e.clientY;
  updateCropDragFromPointer(e.clientX, e.clientY);
});

window.addEventListener('mouseup', () => {
  if (!cropState.dragMode) return;
  cropState.dragMode = null;
  stopAutoScrollLoop();
});

window.addEventListener('resize', () => {
  if (cropState.active) {
    renderCropBox();
  }
});

// ดักคีย์ลัด Enter (ยืนยันการตัด) และ Esc (ยกเลิกโหมด Crop)
window.addEventListener('keydown', (e) => {
  if (!cropState.active) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    applyCrop();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    exitCropMode();
  }
});

cropToggleBtn.addEventListener('click', () => {
  if (cropState.active) {
    exitCropMode();
  } else {
    enterCropMode();
  }
});

applyCropBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  applyCrop();
});

cancelCropBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  exitCropMode();
});

resetCropBtn.addEventListener('click', resetToOriginalImage);

/* =========================================================
   ระบบสร้างไฟล์ PDF มาตรฐาน (Single Long Page & Multi-page A4)
   ========================================================= */

function sliceCanvasToJpegBytes(sourceCanvas, sy, sh) {
  return new Promise((resolve, reject) => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = sourceCanvas.width;
    tempCanvas.height = sh;
    const ctx = tempCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    ctx.drawImage(
      sourceCanvas,
      0,
      sy,
      sourceCanvas.width,
      sh,
      0,
      0,
      sourceCanvas.width,
      sh
    );

    tempCanvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('ไม่สามารถแปลงภาพเป็น JPEG สำหรับ PDF ได้'));
          return;
        }
        const arrayBuf = await blob.arrayBuffer();
        resolve({
          bytes: new Uint8Array(arrayBuf),
          widthPx: tempCanvas.width,
          heightPx: tempCanvas.height
        });
      },
      'image/jpeg',
      0.92
    );
  });
}

function buildPdfBlobFromSlices(pageSlices) {
  const encoder = new TextEncoder();
  const chunks = [];
  let byteOffset = 0;

  function writeStr(str) {
    const bytes = encoder.encode(str);
    chunks.push(bytes);
    byteOffset += bytes.length;
  }

  function writeBytes(bytes) {
    chunks.push(bytes);
    byteOffset += bytes.length;
  }

  const totalObjects = 2 + pageSlices.length * 3;
  const xrefOffsets = new Array(totalObjects + 1).fill(0);

  writeStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  xrefOffsets[1] = byteOffset;
  writeStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kidsRefs = pageSlices.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  xrefOffsets[2] = byteOffset;
  writeStr(`2 0 obj\n<< /Type /Pages /Kids [ ${kidsRefs} ] /Count ${pageSlices.length} >>\nendobj\n`);

  for (let i = 0; i < pageSlices.length; i++) {
    const slice = pageSlices[i];
    const pageObjId = 3 + i * 3;
    const contentObjId = 4 + i * 3;
    const imageObjId = 5 + i * 3;
    const imgName = `/Im${i + 1}`;

    const pw = slice.pageWidthPt.toFixed(2);
    const ph = slice.pageHeightPt.toFixed(2);
    const dw = slice.drawWidthPt.toFixed(2);
    const dh = slice.drawHeightPt.toFixed(2);
    const dy = slice.drawYPt.toFixed(2);

    const contentStream = `q\n${dw} 0 0 ${dh} 0 ${dy} cm\n${imgName} Do\nQ\n`;
    const contentBytes = encoder.encode(contentStream);

    xrefOffsets[pageObjId] = byteOffset;
    writeStr(
      `${pageObjId} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${pw} ${ph} ] ` +
        `/Resources << /XObject << ${imgName} ${imageObjId} 0 R >> >> ` +
        `/Contents ${contentObjId} 0 R >>\n` +
        `endobj\n`
    );

    xrefOffsets[contentObjId] = byteOffset;
    writeStr(`${contentObjId} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    writeBytes(contentBytes);
    writeStr('\nendstream\nendobj\n');

    xrefOffsets[imageObjId] = byteOffset;
    writeStr(
      `${imageObjId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${slice.widthPx} /Height ${slice.heightPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${slice.bytes.length} >>\n` +
        `stream\n`
    );
    writeBytes(slice.bytes);
    writeStr('\nendstream\nendobj\n');
  }

  const startXref = byteOffset;
  writeStr(`xref\n0 ${totalObjects + 1}\n`);
  writeStr('0000000000 65535 f \n');
  for (let objId = 1; objId <= totalObjects; objId++) {
    const offsetStr = String(xrefOffsets[objId]).padStart(10, '0');
    writeStr(`${offsetStr} 00000 n \n`);
  }

  writeStr(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`
  );

  return new Blob(chunks, { type: 'application/pdf' });
}

async function exportToPdf(mode = 'single') {
  if (!canvas.width || !canvas.height) return;

  downloadPdfBtn.disabled = true;
  const originalText = downloadPdfBtn.textContent;
  downloadPdfBtn.textContent = '⏳ กำลังสร้าง PDF...';

  try {
    const pageSlices = [];
    const totalW = canvas.width;
    const totalH = canvas.height;

    if (mode === 'a4') {
      const a4WidthPt = 595.28;
      const a4HeightPt = 841.89;
      const sliceHeightPx = Math.max(100, Math.floor(totalW * (a4HeightPt / a4WidthPt)));

      for (let sy = 0; sy < totalH; sy += sliceHeightPx) {
        const sh = Math.min(sliceHeightPx, totalH - sy);
        const jpegSlice = await sliceCanvasToJpegBytes(canvas, sy, sh);
        const drawHeightPt = (sh / totalW) * a4WidthPt;
        const drawYPt = a4HeightPt - drawHeightPt;

        pageSlices.push({
          ...jpegSlice,
          pageWidthPt: a4WidthPt,
          pageHeightPt: a4HeightPt,
          drawWidthPt: a4WidthPt,
          drawHeightPt,
          drawYPt
        });
      }
    } else {
      const pageWidthPt = 800;
      const maxPageHeightPt = 14000;
      const maxSliceHeightPx = Math.floor(totalW * (maxPageHeightPt / pageWidthPt));

      for (let sy = 0; sy < totalH; sy += maxSliceHeightPx) {
        const sh = Math.min(maxSliceHeightPx, totalH - sy);
        const jpegSlice = await sliceCanvasToJpegBytes(canvas, sy, sh);
        const pageHeightPt = (sh / totalW) * pageWidthPt;

        pageSlices.push({
          ...jpegSlice,
          pageWidthPt,
          pageHeightPt,
          drawWidthPt: pageWidthPt,
          drawHeightPt: pageHeightPt,
          drawYPt: 0
        });
      }
    }

    const pdfBlob = buildPdfBlobFromSlices(pageSlices);
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildFileName('pdf');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);

    const modeLabel = mode === 'a4' ? `แบ่งหน้า A4 (${pageSlices.length} หน้า)` : 'หน้าเดียวยาว';
    showToast(`✅ บันทึกไฟล์ PDF (${modeLabel}) เรียบร้อยแล้ว`);
  } catch (err) {
    showToast('❌ เกิดข้อผิดพลาดในการสร้าง PDF: ' + err.message);
  } finally {
    downloadPdfBtn.disabled = false;
    downloadPdfBtn.textContent = originalText;
  }
}

// สลับโหมดซูม (พอดีหน้าจอ <-> ขนาดจริง 100%)
function toggleZoom() {
  if (cropState.active) return; // ขณะอยู่ในโหมด Crop ไม่ให้คลิกรูปสลับซูมโดยไม่ตั้งใจ
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

zoomToggleBtn.addEventListener('click', () => {
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
  if (cropState.active) {
    setTimeout(renderCropBox, 20);
  }
});

canvas.addEventListener('click', toggleZoom);

downloadPdfBtn.addEventListener('click', () => {
  const mode = pdfModeSelect ? pdfModeSelect.value : 'single';
  exportToPdf(mode);
});

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
