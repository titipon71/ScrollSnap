const idleView = document.getElementById('idleView');
const capturingView = document.getElementById('capturingView');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const hideStickyToggle = document.getElementById('hideStickyToggle');
const maxHeightSelect = document.getElementById('maxHeightSelect');
const progressText = document.getElementById('progressText');
const progressBarFill = document.getElementById('progressBarFill');
const errorBox = document.getElementById('errorBox');

// โหลดการตั้งค่าที่บันทึกไว้และเช็คสถานะปัจจุบันจาก Background
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get(['captureSettings']);
  if (stored.captureSettings) {
    hideStickyToggle.checked = stored.captureSettings.hideSticky !== false;
    if (stored.captureSettings.maxHeight) {
      maxHeightSelect.value = String(stored.captureSettings.maxHeight);
    }
  }

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
    if (status && status.isCapturing) {
      // ถ้าระหว่างกำลังแคปอยู่แล้ว ผู้ใช้คลิกที่ไอคอน Extension อีกครั้ง ให้สั่งหยุดและรวมภาพทันทีตามที่ตกลงไว้
      chrome.runtime.sendMessage({ type: 'USER_STOP_CAPTURE' }, () => {
        window.close();
      });
    }
  });
});

function saveSettings() {
  const captureSettings = {
    hideSticky: hideStickyToggle.checked,
    maxHeight: Number(maxHeightSelect.value)
  };
  chrome.storage.local.set({ captureSettings });
  return captureSettings;
}

hideStickyToggle.addEventListener('change', saveSettings);
maxHeightSelect.addEventListener('change', saveSettings);

startBtn.addEventListener('click', () => {
  errorBox.classList.add('hidden');
  const options = saveSettings();

  chrome.runtime.sendMessage({ type: 'START_CAPTURE', options }, (res) => {
    if (res && res.ok) {
      // ปิด Popup ทันทีเพื่อไม่ให้บังหน้าจอหรือรบกวนเวลาแคป
      window.close();
    } else if (res && res.error) {
      errorBox.textContent = res.error;
      errorBox.classList.remove('hidden');
    }
  });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'USER_STOP_CAPTURE' }, () => {
    window.close();
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CAPTURE_PROGRESS') {
    idleView.classList.add('hidden');
    capturingView.classList.remove('hidden');
    progressText.textContent = `กำลังเลื่อนและแคปหน้าจอ... (${message.progress}%)`;
    progressBarFill.style.width = `${message.progress}%`;
  }
});
