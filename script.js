const stickerBoard = document.querySelector('.sticker-board');

if (stickerBoard) {
  const STORAGE_KEY = 'sticker-board-layout-v1';
  const stickers = Array.from(stickerBoard.querySelectorAll('.sticker'));
  const resetBtn = document.querySelector('.sticker-board__reset');
  let topZ = stickers.length + 1;

  const readLayout = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (err) {
      return {};
    }
  };

  const saveLayout = () => {
    const layout = {};
    stickers.forEach((s) => {
      layout[s.dataset.id] = { x: s._state.x, y: s._state.y, z: Number(s.style.zIndex) || 0 };
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch (err) {
      /* storage unavailable: layout just won't persist */
    }
    if (resetBtn) resetBtn.hidden = false;
  };

  const saved = readLayout();
  const hasSaved = Object.keys(saved).length > 0;
  if (resetBtn) resetBtn.hidden = !hasSaved;

  stickers.forEach((sticker, i) => {
    const homeX = parseFloat(sticker.style.left);
    const homeY = parseFloat(sticker.style.top);
    const homeZ = i + 1;
    const pos = saved[sticker.dataset.id];

    // Positions are percentages of the board so the layout scales with it.
    const state = {
      homeX,
      homeY,
      homeZ,
      x: pos ? pos.x : homeX,
      y: pos ? pos.y : homeY,
      curX: pos ? pos.x : homeX,
      curY: pos ? pos.y : homeY,
      rotation: 0,
      dragging: false,
      grabX: 0,
      grabY: 0,
      animating: false,
    };
    sticker._state = state;
    sticker.style.zIndex = pos && pos.z ? pos.z : homeZ;
    if (pos && pos.z) topZ = Math.max(topZ, pos.z + 1);

    const render = () => {
      sticker.style.left = `${state.curX}%`;
      sticker.style.top = `${state.curY}%`;
      const scale = state.dragging ? 1.08 : 1;
      sticker.style.transform = `rotate(${state.rotation.toFixed(2)}deg) scale(${scale})`;
    };

    const tick = () => {
      state.curX += (state.x - state.curX) * 0.2;
      state.curY += (state.y - state.curY) * 0.2;

      const boardW = stickerBoard.clientWidth || 1;
      const velocityPx = ((state.x - state.curX) / 100) * boardW;
      const targetRotation = state.dragging ? Math.max(-14, Math.min(14, velocityPx * 0.6)) : 0;
      state.rotation += (targetRotation - state.rotation) * 0.15;

      render();

      const settled =
        !state.dragging &&
        Math.abs(state.x - state.curX) < 0.01 &&
        Math.abs(state.y - state.curY) < 0.01 &&
        Math.abs(state.rotation) < 0.05;

      if (settled) {
        state.curX = state.x;
        state.curY = state.y;
        state.rotation = 0;
        render();
        state.animating = false;
        return;
      }
      requestAnimationFrame(tick);
    };

    sticker._animate = () => {
      if (state.animating) return;
      state.animating = true;
      requestAnimationFrame(tick);
    };

    render();

    sticker._startDrag = (e) => {
      const rect = sticker.getBoundingClientRect();
      state.grabX = e.clientX - rect.left;
      state.grabY = e.clientY - rect.top;
      state.dragging = true;
      sticker.style.zIndex = topZ++;
      sticker.classList.add('is-dragging');
      stickerBoard.classList.add('is-decorating');
      try {
        sticker.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer already gone */
      }
      sticker._animate();
    };

    sticker.addEventListener('pointermove', (e) => {
      if (!state.dragging) return;
      const board = stickerBoard.getBoundingClientRect();
      const w = sticker.offsetWidth;
      const h = sticker.offsetHeight;
      // Keep at least a third of the sticker on the board so it can't get lost.
      const minX = -w * 0.66;
      const maxX = board.width - w * 0.34;
      const minY = -h * 0.66;
      const maxY = board.height - h * 0.34;
      const px = Math.max(minX, Math.min(maxX, e.clientX - board.left - state.grabX));
      const py = Math.max(minY, Math.min(maxY, e.clientY - board.top - state.grabY));
      state.x = (px / board.width) * 100;
      state.y = (py / board.height) * 100;
    });

    const endDrag = (e) => {
      if (!state.dragging) return;
      state.dragging = false;
      sticker.classList.remove('is-dragging');
      stickerBoard.classList.remove('is-decorating');
      if (sticker.hasPointerCapture(e.pointerId)) sticker.releasePointerCapture(e.pointerId);
      sticker._animate();
      saveLayout();
    };

    sticker.addEventListener('pointerup', endDrag);
    sticker.addEventListener('pointercancel', endDrag);
  });

  // Grab the topmost sticker whose visible pixels are under the pointer,
  // so transparent corners don't block the stickers beneath them.
  const alphaCache = new Map();
  const getAlpha = (img) => {
    if (alphaCache.has(img)) return alphaCache.get(img);
    let data = null;
    try {
      const w = Math.min(img.naturalWidth, 200);
      const h = Math.round((img.naturalHeight / img.naturalWidth) * w) || 1;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      data = { w, h, pixels: ctx.getImageData(0, 0, w, h).data };
    } catch (err) {
      data = null; // e.g. canvas tainted when opened from file://
    }
    alphaCache.set(img, data);
    return data;
  };

  const isOpaqueAt = (img, clientX, clientY) => {
    const a = getAlpha(img);
    if (!a) return true;
    const rect = img.getBoundingClientRect();
    // Undo the sticker's current tilt so we sample the right pixel.
    const angle = (-(img._state ? img._state.rotation : 0) * Math.PI) / 180;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const lx = dx * Math.cos(angle) - dy * Math.sin(angle) + img.offsetWidth / 2;
    const ly = dx * Math.sin(angle) + dy * Math.cos(angle) + img.offsetHeight / 2;
    const px = Math.floor((lx / img.offsetWidth) * a.w);
    const py = Math.floor((ly / img.offsetHeight) * a.h);
    if (px < 0 || py < 0 || px >= a.w || py >= a.h) return false;
    return a.pixels[(py * a.w + px) * 4 + 3] > 24;
  };

  stickerBoard.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const hits = document
      .elementsFromPoint(e.clientX, e.clientY)
      .filter((el) => el.classList && el.classList.contains('sticker'));
    if (!hits.length) return;
    const target = hits.find((el) => isOpaqueAt(el, e.clientX, e.clientY));
    if (!target) return;
    e.preventDefault();
    target._startDrag(e);
  });

  stickerBoard.addEventListener('pointermove', (e) => {
    if (stickerBoard.classList.contains('is-decorating')) return;
    const hits = document
      .elementsFromPoint(e.clientX, e.clientY)
      .filter((el) => el.classList && el.classList.contains('sticker'));
    const target = hits.find((el) => isOpaqueAt(el, e.clientX, e.clientY));
    stickers.forEach((s) => s.classList.toggle('is-hovered', s === target));
  });

  stickerBoard.addEventListener('pointerleave', () => {
    stickers.forEach((s) => s.classList.remove('is-hovered'));
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      stickers.forEach((s) => {
        s._state.x = s._state.homeX;
        s._state.y = s._state.homeY;
        s.style.zIndex = s._state.homeZ;
        s._animate();
      });
      topZ = stickers.length + 1;
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (err) {
        /* ignore */
      }
      resetBtn.hidden = true;
    });
  }
}

const navToggle = document.querySelector('.nav__toggle');
const navLinks = document.querySelector('.nav__links');

if (navToggle && navLinks) {
  const closeMenu = () => {
    navToggle.classList.remove('is-open');
    navLinks.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
  };

  navToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = navToggle.classList.toggle('is-open');
    navLinks.classList.toggle('is-open', isOpen);
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('click', (e) => {
    if (!navToggle.contains(e.target) && !navLinks.contains(e.target)) {
      closeMenu();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 640) closeMenu();
  });
}

const revealEls = document.querySelectorAll('.reveal');

if (revealEls.length) {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  } else {
    const onloadEls = document.querySelectorAll('.reveal.reveal-onload');
    const scrollEls = document.querySelectorAll('.reveal:not(.reveal-onload)');

    onloadEls.forEach((el) => el.classList.add('is-visible'));

    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -8% 0px' }
    );

    scrollEls.forEach((el) => revealObserver.observe(el));
  }
}


