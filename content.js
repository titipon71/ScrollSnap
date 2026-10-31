/**
 * LongScreenshot Content Script
 * จัดการการค้นหา Scroll Container, เลื่อนหน้าจอ, ซ่อน Sticky/Fixed elements,
 * ชดเชยระยะ Layout Shift เมื่อ Navbar เปลี่ยนเป็น fixed และดักปุ่ม Esc
 */
(() => {
  if (window.__longScreenshotInjected) {
    return;
  }
  window.__longScreenshotInjected = true;

  let captureState = {
    isCapturing: false,
    scrollTarget: null, // 'window' หรือ DOM Element
    originalScrollTop: 0,
    originalScrollLeft: 0,
    initialScrollHeight: 0,
    hiddenElements: [],
    hiddenElementSet: new Set(),
    styleElement: null,
    escListener: null,
    anchorElement: null,
    anchorInitialDocTop: 0
  };

  /**
   * ค้นหา Element ที่เป็นตัวเลื่อนหลักของหน้าเว็บ
   * รองรับทั้งระดับ window ปกติ และเว็บยุคใหม่ที่ใช้ inner scrollable container (overflow-y: auto/scroll)
   */
  function findMainScrollTarget() {
    const docEl = document.scrollingElement || document.documentElement;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    if (docEl && docEl.scrollHeight > viewportHeight + 50) {
      const bodyStyle = window.getComputedStyle(document.body);
      const htmlStyle = window.getComputedStyle(document.documentElement);
      const isLocked =
        bodyStyle.overflowY === 'hidden' && htmlStyle.overflowY === 'hidden';
      if (!isLocked) {
        return { type: 'window', element: docEl };
      }
    }

    let bestCandidate = null;
    let maxScore = 0;

    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el === document.body || el === document.documentElement) continue;

      const scrollH = el.scrollHeight;
      const clientH = el.clientHeight;
      if (scrollH <= clientH + 50) continue;

      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width < viewportWidth * 0.3 || rect.height < viewportHeight * 0.3) {
        continue;
      }

      const area = rect.width * rect.height;
      const scrollableDistance = scrollH - clientH;
      const score = area * Math.min(scrollableDistance, 5000);

      if (score > maxScore) {
        maxScore = score;
        bestCandidate = el;
      }
    }

    if (bestCandidate) {
      return { type: 'element', element: bestCandidate };
    }

    return { type: 'window', element: docEl };
  }

  /**
   * ค้นหา Element อ้างอิงในเนื้อหาหลัก (Anchor) เพื่อใช้วัดระยะเลื่อนจริง
   * ป้องกันปัญหา Navbar เปลี่ยนจาก static/relative ไปเป็น fixed แล้วทำให้เนื้อหาทั้งหน้ากระตุกขึ้น
   */
  function selectContentAnchor() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const target = captureState.scrollTarget;
    const targetEl = target && target.type === 'element' ? target.element : null;

    // สแกนหา Element ในเนื้อหาที่อยู่บริเวณกลางค่อนล่างของหน้าจอแรก และไม่ได้เป็น fixed/sticky
    const candidates = document.querySelectorAll('section, main, article, div, h1, h2, img');
    for (const el of candidates) {
      if (el === document.body || el === document.documentElement) continue;
      if (targetEl && !targetEl.contains(el)) continue;

      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (style.position === 'fixed' || style.position === 'sticky') continue;

      // ต้องไม่อยู่ภายใต้ header หรือ nav
      if (el.closest('header, nav, [role="navigation"], [role="banner"]')) continue;

      const rect = el.getBoundingClientRect();
      if (
        rect.top > viewportHeight * 0.35 &&
        rect.top < viewportHeight * 1.5 &&
        rect.width > viewportWidth * 0.3 &&
        rect.height > 40 &&
        rect.height < viewportHeight * 2
      ) {
        const currentScroll = getRawScrollTop();
        captureState.anchorElement = el;
        captureState.anchorInitialDocTop = rect.top + currentScroll;
        return;
      }
    }
    captureState.anchorElement = null;
    captureState.anchorInitialDocTop = 0;
  }

  function getRawScrollTop() {
    const target = captureState.scrollTarget;
    if (!target || target.type === 'window') {
      const el = document.scrollingElement || document.documentElement;
      return window.scrollY || el.scrollTop || 0;
    }
    return target.element.scrollTop || 0;
  }

  /**
   * คำนวณระยะที่เนื้อหาในหน้าเว็บยุบตัวขึ้นด้านบน (Layout Collapse Shift)
   * เช่น เมื่อ Navbar ที่เคยเป็น relative (สูง 65px) ถูกเปลี่ยนเป็น position: fixed ตอนเลื่อนจอ
   */
  function getLayoutCollapseOffset() {
    const rawScroll = getRawScrollTop();
    if (rawScroll <= 5) return 0;

    if (captureState.anchorElement && document.contains(captureState.anchorElement)) {
      const rect = captureState.anchorElement.getBoundingClientRect();
      const currentDocTop = rect.top + rawScroll;
      const shift = captureState.anchorInitialDocTop - currentDocTop;
      // ถ้าระยะคลาดเคลื่อนอยู่ระหว่าง 15px ถึง 200px แปลว่าเกิดจากการยุบตัวของ Header/Navbar
      if (shift >= 15 && shift <= 200) {
        return Math.round(shift);
      }
    }

    // Fallback: เช็คจาก scrollHeight ที่หดสั้นลง
    const target = captureState.scrollTarget;
    if (!target || target.type === 'window') {
      const el = document.scrollingElement || document.documentElement;
      const currentH = Math.max(
        el.scrollHeight,
        document.body ? document.body.scrollHeight : 0,
        document.documentElement.scrollHeight
      );
      const diff = captureState.initialScrollHeight - currentH;
      if (diff >= 15 && diff <= 200) {
        return Math.round(diff);
      }
    }

    return 0;
  }

  /**
   * อ่านค่าตำแหน่ง Scroll และขนาดของเป้าหมายปัจจุบัน
   */
  function getMetrics() {
    const target = captureState.scrollTarget;
    const dpr = window.devicePixelRatio || 1;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const collapseOffset = getLayoutCollapseOffset();

    if (!target || target.type === 'window') {
      const el = document.scrollingElement || document.documentElement;
      const rawScrollTop = window.scrollY || el.scrollTop || 0;
      const totalHeight = Math.max(
        el.scrollHeight,
        document.body ? document.body.scrollHeight : 0,
        document.documentElement.scrollHeight
      );
      return {
        targetType: 'window',
        rawScrollTop,
        // effectiveScrollTop คือระยะที่เนื้อหาเลื่อนผ่านหน้าจอไปจริง (รวมระยะที่ Navbar ยุบตัวด้วย)
        scrollTop: rawScrollTop + collapseOffset,
        collapseOffset,
        totalHeight: totalHeight + collapseOffset,
        stepHeight: viewportHeight,
        viewportWidth,
        viewportHeight,
        dpr,
        cropRect: {
          x: 0,
          y: 0,
          width: viewportWidth,
          height: viewportHeight
        }
      };
    } else {
      const el = target.element;
      const rect = el.getBoundingClientRect();
      const visibleTop = Math.max(0, rect.top);
      const visibleLeft = Math.max(0, rect.left);
      const visibleBottom = Math.min(viewportHeight, rect.bottom);
      const visibleRight = Math.min(viewportWidth, rect.right);

      const visibleHeight = Math.max(100, visibleBottom - visibleTop);
      const visibleWidth = Math.max(100, visibleRight - visibleLeft);

      return {
        targetType: 'element',
        rawScrollTop: el.scrollTop,
        scrollTop: el.scrollTop + collapseOffset,
        collapseOffset,
        totalHeight: el.scrollHeight + collapseOffset,
        stepHeight: visibleHeight,
        viewportWidth,
        viewportHeight,
        dpr,
        cropRect: {
          x: visibleLeft,
          y: visibleTop,
          width: visibleWidth,
          height: visibleHeight
        }
      };
    }
  }

  /**
   * เลื่อนไปยังตำแหน่ง Y ที่กำหนดทันทีโดยไม่มี Smooth Animation
   */
  function scrollToY(y) {
    const target = captureState.scrollTarget;
    const clampedY = Math.max(0, y);
    if (!target || target.type === 'window') {
      window.scrollTo({ top: clampedY, left: captureState.originalScrollLeft, behavior: 'instant' });
    } else {
      target.element.scrollTop = clampedY;
    }
  }

  /**
   * ซ่อน Element ชั่วคราวด้วยทั้ง visibility: hidden และ opacity: 0
   */
  function hideElementTemporarily(el) {
    if (!el || captureState.hiddenElementSet.has(el)) return;
    captureState.hiddenElementSet.add(el);
    captureState.hiddenElements.push({
      element: el,
      originalVisibility: el.style.getPropertyValue('visibility'),
      originalVisibilityPriority: el.style.getPropertyPriority('visibility'),
      originalOpacity: el.style.getPropertyValue('opacity'),
      originalOpacityPriority: el.style.getPropertyPriority('opacity'),
      originalPointerEvents: el.style.getPropertyValue('pointer-events'),
      originalPointerEventsPriority: el.style.getPropertyPriority('pointer-events')
    });
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('opacity', '0', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
  }

  /**
   * ตรวจว่า Element เป็น Container หลักของหน้าเว็บที่ไม่ควรซ่อนหรือไม่
   */
  function isEssentialPageContainer(el, targetEl, viewportWidth, viewportHeight) {
    if (!el || el === document.body || el === document.documentElement) return true;
    if (targetEl && (el === targetEl || el.contains(targetEl))) return true;

    const rect = el.getBoundingClientRect();
    if (rect.width > viewportWidth * 0.85 && rect.height > viewportHeight * 0.85) {
      return true;
    }
    return false;
  }

  /**
   * ตรวจว่า Element เป็นแถบ Header / Navbar ด้านบนสุดของหน้าเว็บหรือไม่
   */
  function isTopHeaderBanner(el, viewportWidth, viewportHeight) {
    const rect = el.getBoundingClientRect();
    return (
      rect.top >= -15 &&
      rect.top <= 45 &&
      rect.width >= viewportWidth * 0.5 &&
      rect.height <= viewportHeight * 0.28
    );
  }

  /**
   * สำหรับเฟรมที่ 1 (บนสุด):
   * เก็บ Top Navbar ไว้ให้เห็นเป็นธรรมชาติ แต่ซ่อนปุ่มลอย (Floating Chat, ปุ่มช่วยเหลือมุมขวาล่าง, Cookie Banner ล่างจอ)
   * เพื่อไม่ให้ปุ่มลอยไปติดค้างอยู่ตรงรอยต่อกลางภาพ
   */
  function hideBottomFloatingWidgetsOnFirstFrame() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const targetEl =
      captureState.scrollTarget && captureState.scrollTarget.type === 'element'
        ? captureState.scrollTarget.element
        : null;

    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (captureState.hiddenElementSet.has(el)) continue;
      if (isEssentialPageContainer(el, targetEl, viewportWidth, viewportHeight)) continue;

      const style = window.getComputedStyle(el);
      if (style.display === 'none') continue;

      const pos = style.position;
      if (pos === 'fixed' || pos === 'sticky') {
        // ถ้าเป็น Top Header ด้านบนสุด ให้ปล่อยไว้ในเฟรมแรก
        if (isTopHeaderBanner(el, viewportWidth, viewportHeight)) {
          continue;
        }
        // ถ้าเป็นปุ่มลอยมุมขวาล่าง แถบลอยด้านข้าง หรือแบนเนอร์เกาะขอบล่าง ให้ซ่อนตั้งแต่เฟรมแรกเลย
        const rect = el.getBoundingClientRect();
        if (rect.top > viewportHeight * 0.22 || rect.width < viewportWidth * 0.4) {
          hideElementTemporarily(el);
        }
      }
    }
  }

  /**
   * สำหรับเฟรมที่ 2 เป็นต้นไป:
   * ซ่อน Elements ที่มี position: fixed หรือ sticky ทั้งหมด รวมถึง Navbar ที่เกาะขอบจอ
   */
  function hideFixedAndStickyElements() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const currentScrollY = getRawScrollTop();

    const targetEl =
      captureState.scrollTarget && captureState.scrollTarget.type === 'element'
        ? captureState.scrollTarget.element
        : null;

    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (captureState.hiddenElementSet.has(el)) continue;
      if (isEssentialPageContainer(el, targetEl, viewportWidth, viewportHeight)) continue;

      const style = window.getComputedStyle(el);
      if (style.display === 'none') continue;

      const pos = style.position;

      // ชั้นที่ 1: ตรวจจับ CSS position: fixed หรือ sticky โดยตรง
      if (pos === 'fixed' || pos === 'sticky') {
        hideElementTemporarily(el);
        continue;
      }

      // ชั้นที่ 2: กรณีเลื่อนหน้าจอลงมาแล้ว ตรวจจับ Semantic Navbar / Header ที่เกาะขอบบนจอ
      if (currentScrollY > 30) {
        const tag = el.tagName;
        const role = el.getAttribute('role');
        const isNavOrHeader =
          tag === 'NAV' ||
          tag === 'HEADER' ||
          role === 'navigation' ||
          role === 'banner';

        if (isNavOrHeader) {
          const rect = el.getBoundingClientRect();
          const isPinnedAtTop =
            rect.top >= -10 &&
            rect.top <= 30 &&
            rect.height > 20 &&
            rect.height < viewportHeight * 0.3 &&
            rect.width > viewportWidth * 0.5;

          if (isPinnedAtTop) {
            hideElementTemporarily(el);
          }
        }
      }
    }
  }

  /**
   * คืนค่า Elements ที่ถูกซ่อนไว้ทั้งหมด
   */
  function restoreFixedAndStickyElements() {
    for (const item of captureState.hiddenElements) {
      try {
        if (item.originalVisibility) {
          item.element.style.setProperty('visibility', item.originalVisibility, item.originalVisibilityPriority);
        } else {
          item.element.style.removeProperty('visibility');
        }

        if (item.originalOpacity) {
          item.element.style.setProperty('opacity', item.originalOpacity, item.originalOpacityPriority);
        } else {
          item.element.style.removeProperty('opacity');
        }

        if (item.originalPointerEvents) {
          item.element.style.setProperty('pointer-events', item.originalPointerEvents, item.originalPointerEventsPriority);
        } else {
          item.element.style.removeProperty('pointer-events');
        }
      } catch (_) {}
    }
    captureState.hiddenElements = [];
    captureState.hiddenElementSet.clear();
  }

  /**
   * เตรียมหน้าเว็บก่อนเริ่มแคป
   */
  function preparePage(hideSticky = true) {
    cleanupPage();

    captureState.isCapturing = true;
    captureState.scrollTarget = findMainScrollTarget();

    if (captureState.scrollTarget.type === 'window') {
      captureState.originalScrollTop = window.scrollY || 0;
      captureState.originalScrollLeft = window.scrollX || 0;
    } else {
      captureState.originalScrollTop = captureState.scrollTarget.element.scrollTop;
      captureState.originalScrollLeft = captureState.scrollTarget.element.scrollLeft;
    }

    const styleEl = document.createElement('style');
    styleEl.id = '__longscreenshot_hide_scrollbars__';
    styleEl.textContent = `
      * {
        scroll-behavior: auto !important;
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }
      *::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(styleEl);
    captureState.styleElement = styleEl;

    captureState.escListener = (e) => {
      if (e.key === 'Escape' && captureState.isCapturing) {
        e.preventDefault();
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'USER_STOP_CAPTURE' });
      }
    };
    window.addEventListener('keydown', captureState.escListener, true);

    // เลื่อนขึ้นไปบนสุด (เฟรมแรก)
    scrollToY(0);

    // บันทึกความสูงเริ่มต้นและเลือก Element อ้างอิงตอน scrollY = 0
    const docEl = document.scrollingElement || document.documentElement;
    captureState.initialScrollHeight = Math.max(
      docEl.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
      document.documentElement.scrollHeight
    );
    selectContentAnchor();

    // ซ่อนปุ่มลอยมุมขวาล่างตั้งแต่เฟรมแรก (แต่เก็บ Top Navbar ไว้)
    if (hideSticky) {
      hideBottomFloatingWidgetsOnFirstFrame();
    }

    return {
      ...getMetrics(),
      pageTitle: document.title || 'Screenshot',
      pageUrl: window.location.href
    };
  }

  /**
   * คืนค่าหน้าเว็บกลับสู่สภาพปกติ
   */
  function cleanupPage() {
    captureState.isCapturing = false;
    restoreFixedAndStickyElements();

    if (captureState.styleElement) {
      captureState.styleElement.remove();
      captureState.styleElement = null;
    }

    if (captureState.escListener) {
      window.removeEventListener('keydown', captureState.escListener, true);
      captureState.escListener = null;
    }

    if (captureState.scrollTarget) {
      try {
        scrollToY(captureState.originalScrollTop);
      } catch (_) {}
      captureState.scrollTarget = null;
    }

    captureState.anchorElement = null;
    captureState.anchorInitialDocTop = 0;
  }

  // รับคำสั่งจาก Background Service Worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PREPARE_PAGE') {
      const info = preparePage(message.hideFixed !== false);
      sendResponse({ ok: true, info });
      return true;
    }

    if (message.type === 'SCROLL_TO') {
      // 1. คำนวณพิกัด raw scroll เป้าหมาย (หักลบระยะ collapseOffset ที่ตรวจพบก่อนหน้า)
      const currentCollapse = getLayoutCollapseOffset();
      const initialRawTarget = Math.max(1, message.targetY - currentCollapse);
      scrollToY(initialRawTarget);

      // 2. รอให้ Scroll Event ของเว็บไซต์ทำงานเสร็จ (เช่น สลับคลาส Navbar เป็น fixed)
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (message.hideFixed) {
            hideFixedAndStickyElements();
          }

          // 3. ตรวจวัดว่าหลังเลื่อนแล้ว เนื้อหากระโดดขึ้นเพราะ Navbar ยุบตัวออกจาก Flow หรือไม่
          // ถ้าเพิ่งเกิดการยุบตัวในจังหวะนี้ ให้ถอย scroll ลงมาชดเชยทันที ताकिรอยต่อเฟรม 1 กับ 2 ไม่แหว่ง!
          const newCollapse = getLayoutCollapseOffset();
          if (newCollapse > 0 && newCollapse !== currentCollapse) {
            const compensatedRawY = Math.max(1, message.targetY - newCollapse);
            scrollToY(compensatedRawY);
            if (message.hideFixed) {
              hideFixedAndStickyElements();
            }
          }

          requestAnimationFrame(() => {
            const metrics = getMetrics();
            sendResponse({ ok: true, metrics });
          });
        }, 90);
      });
      return true;
    }

    if (message.type === 'RESTORE_PAGE') {
      cleanupPage();
      sendResponse({ ok: true });
      return true;
    }
  });
})();
