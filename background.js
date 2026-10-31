/**
 * LongScreenshot Background Service Worker
 * ประสานงานระหว่าง Popup, Content Script และหน้า Preview
 */

let currentSession = {
  isCapturing: false,
  stopRequested: false,
  tabId: null,
  windowId: null,
  progress: 0,
  frameCount: 0
};

const CAPTURE_INTERVAL_MS = 520; // ป้องกัน MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND (จำกัด 2 ครั้ง/วินาที)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * อัปเดตข้อความ Badge บนไอคอน Extension
 */
async function updateBadge(text, color = '#4F46E5') {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text: text || '' });
  } catch (_) {}
}

/**
 * ส่งข้อความหา Content Script ในแท็บเป้าหมาย
 */
function sendToTab(tabId, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * แคปหน้าจอส่วนที่มองเห็นอยู่ในปัจจุบัน (Visible Tab)
 */
function captureTabImage(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        reject(new Error(chrome.runtime.lastError?.message || 'ไม่สามารถแคปหน้าจอได้'));
      } else {
        resolve(dataUrl);
      }
    });
  });
}

/**
 * ตรวจสอบว่า URL ของแท็บสามารถรัน Content Script ได้หรือไม่
 */
function isRestrictedUrl(url = '') {
  return (
    !url ||
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-extension://') ||
    url.includes('chrome.google.com/webstore') ||
    url.includes('chromewebstore.google.com')
  );
}

/**
 * กระบวนการหลักในการแคปหน้าจอยาวทีละเฟรม
 */
async function startFullPageCapture(tab, options = {}) {
  if (currentSession.isCapturing) {
    return { ok: false, error: 'กำลังแคปหน้าจออยู่แล้ว' };
  }

  if (isRestrictedUrl(tab.url)) {
    return {
      ok: false,
      error: 'ไม่สามารถแคปหน้าระบบของเบราว์เซอร์หรือ Chrome Web Store ได้ กรุณาลองบนหน้าเว็บทั่วไป'
    };
  }

  const hideSticky = options.hideSticky !== false;
  const maxHeightLimit = Number(options.maxHeight) || 20000;

  currentSession = {
    isCapturing: true,
    stopRequested: false,
    tabId: tab.id,
    windowId: tab.windowId,
    progress: 0,
    frameCount: 0
  };

  await updateBadge('0%', '#4F46E5');

  try {
    // 1. Inject content.js ลงในแท็บ
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    // 2. สั่งเตรียมหน้าเว็บและเลื่อนไปบนสุด
    const prepRes = await sendToTab(tab.id, { type: 'PREPARE_PAGE', hideFixed: hideSticky });
    if (!prepRes || !prepRes.ok) {
      throw new Error('ไม่สามารถเตรียมหน้าเว็บสำหรับการแคปได้');
    }

    let metrics = prepRes.info;
    const pageTitle = metrics.pageTitle;
    const pageUrl = metrics.pageUrl;
    const frames = [];

    // รอให้หน้าเว็บเลื่อนขึ้นบนสุดและแสดงผลนิ่งก่อนแคปเฟรมแรก
    await sleep(350);

    let currentScrollTop = metrics.scrollTop;
    let capturedLogicalHeight = 0;

    while (!currentSession.stopRequested) {
      const frameStartTime = Date.now();

      // แคปภาพหน้าจอปัจจุบัน
      const dataUrl = await captureTabImage(tab.windowId);

      // คำนวณว่าเฟรมนี้เป็นเฟรมแรก หรือเลื่อนต่อมาเท่าไหร่
      const isFirstFrame = frames.length === 0;
      const stepHeight = metrics.stepHeight;

      frames.push({
        dataUrl,
        scrollTop: currentScrollTop,
        cropRect: metrics.cropRect,
        dpr: metrics.dpr,
        isFirstFrame
      });

      currentSession.frameCount = frames.length;
      capturedLogicalHeight = currentScrollTop + stepHeight;

      // คำนวณเปอร์เซ็นต์ความคืบหน้าเทียบกับความสูงเป้าหมาย
      const effectiveTotalHeight = Math.min(metrics.totalHeight, maxHeightLimit);
      const percent = Math.min(99, Math.round((capturedLogicalHeight / effectiveTotalHeight) * 100));
      currentSession.progress = percent;
      await updateBadge(`${percent}%`, '#4F46E5');

      // แจ้งความคืบหน้าเผื่อ Popup เปิดอยู่
      chrome.runtime.sendMessage({
        type: 'CAPTURE_PROGRESS',
        progress: percent,
        frameCount: frames.length
      }).catch(() => {});

      // ตรวจสอบว่าถึงจุดสิ้นสุดหรือถึงเพดานความสูงสูงสุดแล้วหรือยัง
      if (capturedLogicalHeight >= effectiveTotalHeight - 2) {
        break;
      }

      // คำนวณระยะเลื่อนถัดไป
      const nextTargetY = Math.min(
        currentScrollTop + stepHeight,
        effectiveTotalHeight - stepHeight
      );

      if (nextTargetY <= currentScrollTop + 1) {
        break;
      }

      // สั่งเลื่อนหน้าจอไปยังเฟรมถัดไป (พร้อมซ่อน Sticky/Fixed ตั้งแต่เฟรมที่ 2)
      const scrollRes = await sendToTab(tab.id, {
        type: 'SCROLL_TO',
        targetY: nextTargetY,
        hideFixed: hideSticky
      });

      if (!scrollRes || !scrollRes.ok) {
        break;
      }

      metrics = scrollRes.metrics;
      const actualNewScrollTop = metrics.scrollTop;

      // ถ้าสั่งเลื่อนแล้วแต่หน้าเว็บไม่ขยับลงอีก แปลว่าสุดหน้าเว็บแล้ว
      if (actualNewScrollTop <= currentScrollTop + 1) {
        break;
      }

      currentScrollTop = actualNewScrollTop;

      // หน่วงเวลาให้ครบ CAPTURE_INTERVAL_MS เพื่อไม่ให้ติด Rate Limit ของ Chrome และรอ Lazy-load
      const elapsed = Date.now() - frameStartTime;
      const waitTime = Math.max(250, CAPTURE_INTERVAL_MS - elapsed);
      await sleep(waitTime);
    }

    // 3. คืนค่าหน้าเว็บกลับสู่สภาพปกติทันที
    await sendToTab(tab.id, { type: 'RESTORE_PAGE' }).catch(() => {});

    if (frames.length === 0) {
      throw new Error('ไม่มีเฟรมภาพที่ถูกแคปได้');
    }

    await updateBadge('100%', '#10B981');

    // 4. บันทึกข้อมูลเฟรมภาพลง chrome.storage.local แล้วเปิดแท็บ Preview
    await chrome.storage.local.set({
      latestCaptureData: {
        createdAt: Date.now(),
        pageTitle,
        pageUrl,
        targetType: metrics.targetType,
        viewportWidth: metrics.viewportWidth,
        viewportHeight: metrics.viewportHeight,
        dpr: metrics.dpr,
        frames
      }
    });

    await chrome.tabs.create({
      url: chrome.runtime.getURL('preview/preview.html')
    });

    setTimeout(() => updateBadge(''), 1500);
    currentSession.isCapturing = false;
    return { ok: true };
  } catch (err) {
    try {
      await sendToTab(tab.id, { type: 'RESTORE_PAGE' });
    } catch (_) {}

    await updateBadge('ERR', '#EF4444');
    setTimeout(() => updateBadge(''), 3000);
    currentSession.isCapturing = false;
    return { ok: false, error: err.message || 'เกิดข้อผิดพลาดระหว่างแคปหน้าจอ' };
  }
}

// รับข้อความจาก Popup และ Content Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    sendResponse({
      isCapturing: currentSession.isCapturing,
      progress: currentSession.progress,
      frameCount: currentSession.frameCount
    });
    return true;
  }

  if (message.type === 'START_CAPTURE') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const activeTab = tabs && tabs[0];
      if (!activeTab) {
        sendResponse({ ok: false, error: 'ไม่พบแท็บที่กำลังเปิดอยู่' });
        return;
      }
      // เริ่มกระบวนการแคปแบบ Asynchronous แล้วตอบกลับทันทีเพื่อให้ Popup ทราบว่าเริ่มแล้ว
      startFullPageCapture(activeTab, message.options);
      sendResponse({ ok: true, started: true });
    });
    return true;
  }

  if (message.type === 'USER_STOP_CAPTURE') {
    if (currentSession.isCapturing) {
      currentSession.stopRequested = true;
      updateBadge('...', '#F59E0B');
    }
    sendResponse({ ok: true });
    return true;
  }
});

// รองรับคีย์ลัด (Alt+Shift+S)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'start-capture') {
    if (currentSession.isCapturing) {
      currentSession.stopRequested = true;
      return;
    }
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      const stored = await chrome.storage.local.get(['captureSettings']);
      const settings = stored.captureSettings || { hideSticky: true, maxHeight: 20000 };
      startFullPageCapture(activeTab, settings);
    }
  }
});
