const stickerBoard = document.querySelector('.sticker-board');

if (stickerBoard) {
  const STORAGE_KEY = 'sticker-board-layout-v3';
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



const bagScene = document.querySelector('.bag-scene');

if (bagScene) {
  const tote = bagScene.querySelector('.bag-tote');
  const items = Array.from(bagScene.querySelectorAll('.bag-item'));
  const page = document.querySelector('.bag-page');
  const circles = page.querySelectorAll('.bag-page__circle');
  const pageTitle = page.querySelector('.bag-page__title');
  const pageIcon = page.querySelector('.bag-page__icon');
  const backBtn = page.querySelector('.bag-page__back');
  const inertEls = document.querySelectorAll('.page > header, .page > main, .page > footer');
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CLOSE_MS = 720;
  let isOpen = false;
  let busy = false;
  let openItem = null;

  const centerOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  // Offset from an item's resting spot back to the mouth of the bag.
  const offsetToBag = (item) => {
    const bag = tote.getBoundingClientRect();
    const mouth = { x: bag.left + bag.width / 2, y: bag.top + bag.height * 0.45 };
    const c = centerOf(item);
    return { dx: mouth.x - c.x, dy: mouth.y - c.y };
  };

  const setItemsFocusable = (on) => {
    items.forEach((item) => {
      item.querySelector('.bag-item__btn').tabIndex = on ? 0 : -1;
    });
  };

  const setOpenState = (open) => {
    isOpen = open;
    tote.setAttribute('aria-expanded', String(open));
    tote.setAttribute('aria-label', open ? 'Pack my bag back up' : 'Open my bag');
  };

  const tossOut = () => {
    busy = true;
    setOpenState(true);
    bagScene.classList.add('is-open');

    if (reduceMotion()) {
      bagScene.classList.add('is-settled');
      setItemsFocusable(true);
      busy = false;
      return;
    }

    // The bag zooms in, then tips forward as it throws everything out.
    tote.querySelector('img').animate(
      [
        { transform: 'none' },
        { transform: 'scale(1.16)', offset: 0.3 },
        { transform: 'scale(1.08) rotate(14deg)', offset: 0.55 },
        { transform: 'scale(0.97) rotate(-4deg)', offset: 0.8 },
        { transform: 'none' },
      ],
      { duration: 900, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
    );

    const flights = items.map((item, i) => {
      const { dx, dy } = offsetToBag(item);
      const lift = 70 + (i % 3) * 25;
      const spin = (i % 2 ? 1 : -1) * (18 + i * 4);
      return item.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(0.15) rotate(0deg)`, opacity: 0 },
          { opacity: 1, offset: 0.1 },
          { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(0.85) rotate(${spin}deg)`, offset: 0.5 },
          { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
        ],
        { duration: 950, delay: 260 + i * 90, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)', fill: 'backwards' }
      ).finished;
    });

    // A timer backs up the animation promises, which can stall in background tabs.
    const settle = () => {
      if (!busy || !isOpen) return;
      bagScene.classList.add('is-settled');
      setItemsFocusable(true);
      busy = false;
    };
    Promise.all(flights).then(settle);
    setTimeout(settle, 260 + items.length * 90 + 1000);
  };

  const packUp = () => {
    busy = true;
    setOpenState(false);
    setItemsFocusable(false);
    bagScene.classList.remove('is-settled');

    const finish = () => {
      bagScene.classList.remove('is-open');
      busy = false;
    };

    if (reduceMotion()) {
      finish();
      return;
    }

    const flights = items.map((item, i) => {
      const { dx, dy } = offsetToBag(item);
      return item.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(0.7)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${dx}px, ${dy}px) scale(0.15)`, opacity: 0 },
        ],
        { duration: 520, delay: (items.length - 1 - i) * 60, easing: 'cubic-bezier(0.55, 0, 0.45, 1)', fill: 'forwards' }
      );
    });

    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      finish();
      flights.forEach((f) => f.cancel());
    };
    Promise.all(flights.map((f) => f.finished)).then(settle);
    setTimeout(settle, items.length * 60 + 600);
  };

  tote.addEventListener('click', () => {
    if (busy) return;
    if (isOpen) packUp();
    else tossOut();
  });

  const setPageInert = (on) => {
    inertEls.forEach((el) => {
      if (on) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    });
    document.documentElement.style.overflow = on ? 'hidden' : '';
  };

  const sizeCircles = (item) => {
    const { x, y } = centerOf(item.querySelector('.bag-item__obj'));
    // Big enough to cover the viewport from the item's center.
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 24;

    circles.forEach((c) => {
      c.style.left = `${x - radius}px`;
      c.style.top = `${y - radius}px`;
      c.style.width = c.style.height = `${radius * 2}px`;
    });
    page.style.setProperty('--tone', item.dataset.tone);
  };

  // Items with their own page zoom the circle over the screen, then navigate.
  const OPEN_MS = 1000;
  const navigateTo = (item) => {
    sizeCircles(item);
    openItem = item;
    item.classList.add('is-opened');
    page.classList.add('is-navigating');
    page.classList.remove('is-closing');
    page.hidden = false;
    setPageInert(true);
    requestAnimationFrame(() => requestAnimationFrame(() => page.classList.add('is-open')));
    setTimeout(() => { location.href = item.dataset.href; }, reduceMotion() ? 0 : OPEN_MS);
  };

  const openPage = (item, { pushHistory = true } = {}) => {
    if (item.dataset.href) {
      navigateTo(item);
      return;
    }
    const btn = item.querySelector('.bag-item__btn');
    sizeCircles(item);
    pageTitle.textContent = item.querySelector('.bag-item__label').textContent;
    pageIcon.src = item.querySelector('img').src;
    openItem = item;
    item.classList.add('is-opened');

    page.hidden = false;
    page.classList.remove('is-closing');
    setPageInert(true);
    requestAnimationFrame(() => requestAnimationFrame(() => page.classList.add('is-open')));
    backBtn.focus({ preventScroll: true });

    if (pushHistory) history.pushState({ bagItem: item.dataset.slug }, '', `#bag-${item.dataset.slug}`);
    btn.blur();
  };

  const closePage = () => {
    if (!openItem) return;
    const item = openItem;
    openItem = null;
    page.classList.remove('is-open');
    page.classList.add('is-closing');
    setPageInert(false);

    setTimeout(() => {
      page.hidden = true;
      page.classList.remove('is-closing', 'is-navigating');
      item.classList.remove('is-opened');
      item.querySelector('.bag-item__btn').focus({ preventScroll: true });
    }, reduceMotion() ? 0 : CLOSE_MS);
  };

  const requestClose = () => {
    if (history.state && history.state.bagItem) history.back();
    else {
      history.replaceState(null, '', location.pathname);
      closePage();
    }
  };

  items.forEach((item) => {
    item.querySelector('.bag-item__btn').addEventListener('click', () => {
      if (!busy && isOpen && !openItem) openPage(item);
    });
  });

  backBtn.addEventListener('click', requestClose);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openItem) requestClose();
  });

  window.addEventListener('popstate', () => {
    if (openItem) closePage();
  });

  const showBagOpen = () => {
    setOpenState(true);
    bagScene.classList.add('is-open', 'is-settled');
    setItemsFocusable(true);
    document.documentElement.style.scrollBehavior = 'auto';
    bagScene.scrollIntoView({ block: 'center' });
    document.documentElement.style.scrollBehavior = '';
  };

  const findItem = (prefix) => location.hash.startsWith(prefix)
    && items.find((item) => `${prefix}${item.dataset.slug}` === location.hash);

  // Support linking straight to an item, e.g. /about/#bag-camera.
  const linked = findItem('#bag-');
  if (linked) {
    showBagOpen();
    requestAnimationFrame(() => openPage(linked, { pushHistory: false }));
  }

  // Coming back from an item's page: start fully zoomed in, then shrink into the item.
  const returning = findItem('#from-');
  if (returning) {
    showBagOpen();
    history.replaceState(null, '', location.pathname);
    sizeCircles(returning);
    openItem = returning;
    returning.classList.add('is-opened');
    page.classList.add('is-navigating', 'no-anim', 'is-open');
    page.hidden = false;
    setPageInert(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      page.classList.remove('no-anim');
      closePage();
    }));
  }

  // Leaving via the browser back button can restore this page mid-zoom.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && openItem && page.classList.contains('is-navigating')) closePage();
  });
}

const albumBoard = document.querySelector('.album-board');

if (albumBoard) {
  const cards = Array.from(albumBoard.querySelectorAll('.album-card'));
  const resetBtn = document.querySelector('.album__reset');
  const lightbox = document.querySelector('.album-lightbox');
  const lightboxImg = lightbox.querySelector('.album-lightbox__img');
  const DRAG_THRESHOLD = 5;
  let topZ = cards.length + 1;
  let lastOpened = null;

  const home = new Map(cards.map((card, i) => [card, {
    x: parseFloat(card.style.getPropertyValue('--x')),
    y: parseFloat(card.style.getPropertyValue('--y')),
    r: card.style.getPropertyValue('--r'),
    z: i + 1,
  }]));

  cards.forEach((card) => { card.style.zIndex = home.get(card).z; });

  cards.forEach((card) => {
    let start = null;
    let dragged = false;
    let lastX = 0;
    let tilt = 0;

    card.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      start = {
        px: e.clientX,
        py: e.clientY,
        x: parseFloat(card.style.getPropertyValue('--x')),
        y: parseFloat(card.style.getPropertyValue('--y')),
      };
      dragged = false;
      lastX = e.clientX;
      tilt = 0;
      card.setPointerCapture(e.pointerId);
    });

    card.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.px;
      const dy = e.clientY - start.py;
      if (!dragged) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragged = true;
        card.classList.add('is-dragging');
        card.style.zIndex = ++topZ;
      }
      const board = albumBoard.getBoundingClientRect();
      // Prints can slide past the edge (the board clips them) but their centre stays on the board.
      const x = Math.min(100, Math.max(0, start.x + (dx / board.width) * 100));
      const y = Math.min(100, Math.max(0, start.y + (dy / board.height) * 100));
      card.style.setProperty('--x', x.toFixed(2));
      card.style.setProperty('--y', y.toFixed(2));
      // Lean into the direction of travel, easing back as it slows.
      tilt = tilt * 0.8 + Math.max(-14, Math.min(14, (e.clientX - lastX) * 0.9)) * 0.2;
      lastX = e.clientX;
      card.style.setProperty('--r', `calc(${home.get(card).r} + ${tilt.toFixed(2)}deg)`);
    });

    const endDrag = () => {
      if (!start) return;
      start = null;
      if (dragged) {
        card.classList.remove('is-dragging');
        card.style.setProperty('--r', home.get(card).r);
        if (resetBtn) resetBtn.hidden = false;
      }
    };

    card.addEventListener('pointerup', endDrag);
    card.addEventListener('pointercancel', endDrag);

    // A click that wasn't a drag (or Enter/Space) opens the photo.
    card.addEventListener('click', (e) => {
      if (dragged) {
        e.preventDefault();
        dragged = false;
        return;
      }
      openLightbox(card);
    });
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      cards.forEach((card) => {
        const h = home.get(card);
        card.style.setProperty('--x', h.x);
        card.style.setProperty('--y', h.y);
        card.style.setProperty('--r', h.r);
        card.style.zIndex = h.z;
      });
      topZ = cards.length + 1;
      resetBtn.hidden = true;
    });
  }

  const openLightbox = (card) => {
    lastOpened = card;
    const img = card.querySelector('img');
    lightboxImg.src = card.dataset.full;
    lightboxImg.alt = img.alt;
    lightbox.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(() => requestAnimationFrame(() => lightbox.classList.add('is-open')));
    lightbox.focus({ preventScroll: true });
  };

  const closeLightbox = () => {
    if (lightbox.hidden) return;
    lightbox.classList.remove('is-open');
    document.documentElement.style.overflow = '';
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      lightbox.hidden = true;
      if (lastOpened) lastOpened.focus({ preventScroll: true });
    }, reduce ? 0 : 450);
  };

  lightbox.tabIndex = -1;
  lightbox.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });
}
