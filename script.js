// Any page visit counts as having entered the site, so the home intro won't replay this session.
try { sessionStorage.setItem('garden-intro-seen', '1'); } catch (e) { /* storage blocked */ }

const stickerBoard = document.querySelector('.sticker-board');

if (stickerBoard) {
  const STORAGE_KEY = 'sticker-board-layout-v4';
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
    if (typeof closeDrop === 'function') closeDrop();
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

  // Hovering (or focusing / tapping) an item opens its dropdown panel below the bag.
  const drop = document.getElementById('bag-drop');
  const dropPanel = drop && drop.querySelector('.bag-drop__panel');
  const dropPointer = drop && drop.querySelector('.bag-drop__pointer');
  let dropFor = null;
  let closeTimer = 0;

  const fitDrop = () => {
    // The panel content is designed at 1030x516; scale it to the panel's width (min 0.62, then scroll).
    const scale = Math.max(0.62, Math.min(1, (dropPanel.clientWidth || 1026) / 1026));
    drop.style.setProperty('--scale', scale.toFixed(4));
  };

  const pointAt = (item) => {
    const box = drop.getBoundingClientRect();
    const obj = item.querySelector('.bag-item__obj').getBoundingClientRect();
    drop.style.setProperty('--pointer-x', `${obj.left + obj.width / 2 - box.left}px`);
  };

  const openDrop = (item) => {
    if (!drop || !isOpen) return;
    clearTimeout(closeTimer);
    const slug = item.dataset.slug;
    pointAt(item);
    if (dropFor !== slug) {
      drop.querySelectorAll('.bag-drop__item').forEach((sec) => { sec.hidden = sec.dataset.for !== slug; });
      items.forEach((it) => it.querySelector('.bag-item__btn').setAttribute('aria-expanded', String(it === item)));
      dropFor = slug;
    }
    fitDrop();
    drop.classList.add('is-open');
  };

  const closeDrop = () => {
    if (!drop) return;
    clearTimeout(closeTimer);
    drop.classList.remove('is-open');
    items.forEach((it) => it.querySelector('.bag-item__btn').setAttribute('aria-expanded', 'false'));
    dropFor = null;
  };

  const closeSoon = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(closeDrop, 350);
  };

  if (drop) {
    items.forEach((item) => {
      const btn = item.querySelector('.bag-item__btn');
      btn.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') openDrop(item); });
      btn.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') closeSoon(); });
      btn.addEventListener('focus', () => openDrop(item));
      btn.addEventListener('click', () => {
        if (busy || !isOpen) return;
        if (dropFor === item.dataset.slug && matchMedia('(hover: none)').matches) closeDrop();
        else openDrop(item);
      });
    });
    drop.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    drop.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') closeSoon(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrop(); });
    window.addEventListener('resize', () => {
      fitDrop();
      const current = items.find((it) => it.dataset.slug === dropFor);
      if (current) pointAt(current);
    });
    fitDrop();
  }

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

  // Throw the items out on its own once the bag scrolls into the middle of the screen.
  if ('IntersectionObserver' in window) {
    const autoToss = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      autoToss.disconnect();
      if (!isOpen && !busy) setTimeout(() => { if (!isOpen && !busy) tossOut(); }, 250);
    }, { rootMargin: '-35% 0px -35% 0px' });
    autoToss.observe(bagScene);
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

const intro = document.querySelector('.intro');

if (intro) {
  const root = document.documentElement;
  const timers = [];
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    try { sessionStorage.setItem('garden-intro-seen', '1'); } catch (e) { /* ignore */ }
    intro.classList.add('is-running', 'is-done');
    // Land on the top of the home page (the garden), whatever the scroll position was.
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    root.style.scrollBehavior = '';
    // Releasing the class lets the home page's load-in animations play as the intro fades.
    root.classList.remove('intro-on');
    document.dispatchEvent(new Event('garden:intro-done'));
    setTimeout(() => intro.remove(), 700);
  };

  if (!root.classList.contains('intro-on')) {
    intro.remove();
  } else {
    intro.classList.add('is-running');
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    root.style.scrollBehavior = '';
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      at(1200, finish);
    } else {
      // The window starts opening as soon as it appears.
      at(2300, () => intro.classList.add('is-window'));
      at(2450, () => intro.classList.add('is-open'));
      at(4150, () => intro.classList.add('is-zoom'));
      at(4950, finish);
    }
    // Esc (or Enter/Space) still skips straight to the page.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish();
    });
  }
}

const bouquet = document.querySelector('.bouquet');

if (bouquet) {
  const flowers = Array.from(document.querySelectorAll('.bouquet-flower'));
  const resetBtn = document.querySelector('.bouquet-reset');
  const wrap = bouquet.querySelector('[data-layer="Cream-paper-wrap"]');
  const MAX_EXTRA = 24;

  // Each loose flower's SVG split into its leaf and head, so an added flower can be redrawn
  // on one long stem instead of its own short one.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const parts = new Map();
  flowers.forEach((flower) => {
    const src = flower.querySelector('img').src;
    fetch(src)
      .then((res) => res.text())
      .then((text) => {
        const paths = Array.from(new DOMParser().parseFromString(text, 'image/svg+xml').querySelectorAll('path'));
        // Paint order in the Figma export: stem, leaf, petals, centre.
        parts.set(flower, { leaf: paths[1], head: paths.slice(2) });
      })
      .catch(() => { /* falls back to drawing the stem only */ });
  });

  // In the loose flower's own coordinates: the head's centre, and where the leaf meets the stem.
  const HEAD = [29, 34];
  const LEAF = [29.5, 75];
  // Every stem gathers at the ribbon, hidden behind the paper wrap.
  const TIE = [117, 205];

  const svgEl = (name, attrs) => {
    const el = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  };

  // The bouquet starts full (as in Figma); each flower dropped in adds another one,
  // tucked in behind the paper wrap at a random spot among the others.
  const place = (flower) => {
    const scale = 0.62 + Math.random() * 0.14;
    // Spread flowers out: try several random spots and keep the one with the most room
    // around it (away from the original flowers and any already added).
    const taken = [[74, 103], [134, 64], [175, 119], [117, 136], [165, 80]];
    bouquet.querySelectorAll('.bouquet__add').forEach((el) => {
      taken.push([parseFloat(el.dataset.x), parseFloat(el.dataset.y)]);
    });
    let hx = 0;
    let hy = 0;
    let best = -1;
    for (let i = 0; i < 16; i++) {
      const cx = 76 + Math.random() * 84;
      const cy = 55 + Math.random() * 55;
      const room = Math.min(...taken.map(([tx, ty]) => Math.hypot(cx - tx, cy - ty)));
      if (room > best) { best = room; hx = cx; hy = cy; }
    }

    // One smooth stem from the head down to the tie, with a slight random bow.
    const [tx, ty] = TIE;
    const len = Math.hypot(tx - hx, ty - hy);
    const bow = (Math.random() * 2 - 1) * len * 0.06;
    const nx = -(ty - hy) / len;
    const ny = (tx - hx) / len;
    const cx = (hx + tx) / 2 + nx * bow;
    const cy = (hy + ty) / 2 + ny * bow;
    const at = (t) => [
      (1 - t) ** 2 * hx + 2 * (1 - t) * t * cx + t ** 2 * tx,
      (1 - t) ** 2 * hy + 2 * (1 - t) * t * cy + t ** 2 * ty,
    ];
    // Angle of the stem (in degrees from straight down) at a point along it.
    const tilt = (t) => {
      const dx = 2 * (1 - t) * (cx - hx) + 2 * t * (tx - cx);
      const dy = 2 * (1 - t) * (cy - hy) + 2 * t * (ty - cy);
      return (Math.atan2(dy, dx) * 180) / Math.PI - 90;
    };

    const svg = svgEl('svg', { viewBox: '0 0 260 280', class: 'bouquet__add-art' });
    svg.append(svgEl('path', {
      d: `M${hx.toFixed(1)} ${hy.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${tx} ${ty}`,
      stroke: '#79A859',
      'stroke-width': (5 * scale).toFixed(2),
      'stroke-linecap': 'round',
      fill: 'none',
    }));
    const art = parts.get(flower);
    if (art) {
      // The leaf sits on the stem the same distance below the head as on the loose flower,
      // turned to follow the stem there; the head leans the way the stem leaves it.
      const t = Math.min(0.9, ((LEAF[1] - HEAD[1]) * scale) / len);
      const [lx, ly] = at(t);
      const leaf = svgEl('g', { transform: `translate(${lx.toFixed(1)} ${ly.toFixed(1)}) rotate(${tilt(t).toFixed(1)}) scale(${scale.toFixed(2)}) translate(${-LEAF[0]} ${-LEAF[1]})` });
      leaf.append(art.leaf.cloneNode());
      const head = svgEl('g', { transform: `translate(${hx.toFixed(1)} ${hy.toFixed(1)}) rotate(${(tilt(0) * 0.7).toFixed(1)}) scale(${scale.toFixed(2)}) translate(${-HEAD[0]} ${-HEAD[1]})` });
      art.head.forEach((path) => head.append(path.cloneNode()));
      svg.append(leaf, head);
    }

    const group = document.createElement('div');
    group.className = 'bouquet__add';
    group.dataset.x = hx.toFixed(1);
    group.dataset.y = hy.toFixed(1);
    group.append(svg);
    wrap.parentNode.insertBefore(group, wrap);
    const groups = bouquet.querySelectorAll('.bouquet__add');
    if (groups.length > MAX_EXTRA) groups[0].remove();
    if (resetBtn) resetBtn.hidden = false;
    flower.style.translate = '';
  };

  const overBouquet = (x, y) => {
    const r = bouquet.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  flowers.forEach((flower) => {
    let start = null;
    let moved = false;

    flower.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY };
      moved = false;
      flower.setPointerCapture(e.pointerId);
    });

    flower.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      flower.classList.add('is-dragging');
      flower.style.translate = `${dx}px ${dy}px`;
      bouquet.classList.toggle('is-target', overBouquet(e.clientX, e.clientY));
    });

    const end = (e) => {
      if (!start) return;
      start = null;
      flower.classList.remove('is-dragging');
      bouquet.classList.remove('is-target');
      if (moved && overBouquet(e.clientX, e.clientY)) place(flower);
      // The loose flower always springs back so it can be added again.
      flower.style.translate = '';
    };

    flower.addEventListener('pointerup', end);
    flower.addEventListener('pointercancel', end);

    // Keyboard (and a plain tap) adds the flower straight to the bouquet.
    flower.addEventListener('click', () => {
      if (!moved) place(flower);
      moved = false;
    });
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      bouquet.querySelectorAll('.bouquet__add').forEach((el) => el.remove());
      resetBtn.hidden = true;
    });
  }
}

const gardenSky = document.querySelector('.garden-art__sky');

if (gardenSky) {
  // Start each cloud partway through its loop so it begins at its Figma position.
  const startClouds = () => {
    const vw = gardenSky.clientWidth;
    const stageLeft = (vw - 1200) / 2;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    gardenSky.querySelectorAll('.garden-art__cloud').forEach((cloud) => {
      const x = stageLeft + Number(cloud.dataset.x);
      if (still) {
        cloud.style.animation = 'none';
        cloud.style.translate = `${x}px 0`;
        return;
      }
      // One loop moves a pair exactly one screen-width, so its progress is just x / width.
      const dur = parseFloat(getComputedStyle(cloud).animationDuration);
      const progress = (((x % vw) + vw) % vw) / vw;
      cloud.style.animationDelay = `${-progress * dur}s`;
    });
    gardenSky.classList.add('is-ready');
  };
  startClouds();
}


const gardenArt = document.querySelector('.garden-art');

if (gardenArt) {
  // Click the grass to grow a little flower, like baothiento.com.
  const PETAL = 'M14.2 6.72194C14.2 10.442 12.4554 13.4439 10.2869 13.4439C8.11844 13.4439 6.37387 10.442 6.37387 6.72194C6.37387 3.00185 8.11844 0 10.2869 0C12.4554 0 14.2 3.00185 14.2 6.72194ZM15.9934 14.6226C12.863 15.7644 9.79778 14.8067 9.12931 12.4863C8.46083 10.1658 10.45 7.3481 13.5804 6.20629C16.6945 5.06448 19.776 6.02213 20.4445 8.34259C21.113 10.663 19.1239 13.4623 15.9934 14.6226ZM9.89561 18.9872C7.9717 15.9854 7.82495 12.3758 9.56952 10.9393C11.3141 9.50282 14.2978 10.7735 16.238 13.7938C18.1619 16.7957 18.3087 20.3868 16.5641 21.8233C14.8195 23.2598 11.8358 21.9891 9.89561 18.9872ZM4.33582 13.7938C6.27604 10.7735 9.25974 9.50282 11.0043 10.9393C12.7489 12.3758 12.6021 15.9854 10.6782 18.9872C8.738 21.9891 5.75431 23.2598 4.00974 21.8233C2.26518 20.3868 2.41191 16.7957 4.33582 13.7938ZM6.99344 6.20629C10.1239 7.3481 12.113 10.1658 11.4445 12.4863C10.776 14.8067 7.71083 15.7644 4.58039 14.6226C1.44996 13.4623 -0.539178 10.663 0.1293 8.34259C0.797778 6.02213 3.87931 5.06448 6.99344 6.20629Z';
  const CENTER = 'M10.2869 14.2719C11.8628 14.2719 13.1402 13.2825 13.1402 12.0619C13.1402 10.8414 11.8628 9.85196 10.2869 9.85196C8.71113 9.85196 7.43368 10.8414 7.43368 12.0619C7.43368 13.2825 8.71113 14.2719 10.2869 14.2719Z';
  const COLORS = [
    ['#FFFDE4', '#F2CF75'],
    ['#F8B48B', '#F2CF75'],
    ['#F9C9D4', '#E8899E'],
    ['#D5EAF9', '#80A9D6'],
    ['#E6D8F7', '#A98BD6'],
    ['#FFFFFF', '#F4C95D'],
    ['#FBE38E', '#E9A23B'],
  ];
  const GRASS_TOP = 470;
  const GRASS_BOTTOM = 770;
  const MAX_FLOWERS = 60;
  const planted = document.createElement('div');
  planted.className = 'garden-art__planted';
  gardenArt.appendChild(planted);

  const plant = (x, y, color, fixedSize) => {
    const [petal, center] = color || COLORS[Math.floor(Math.random() * COLORS.length)];
    const size = fixedSize || 16 + Math.random() * 12;
    const flower = document.createElement('span');
    flower.className = 'garden-flower';
    flower.style.cssText = `left:${x}px;top:${y}px;width:${size}px;--r:${(Math.random() * 50 - 25).toFixed(1)}deg`;
    flower.innerHTML = `<svg viewBox="0 0 20.5738 22.4146" aria-hidden="true"><path d="${PETAL}" fill="${petal}"/><path d="${CENTER}" fill="${center}"/></svg>`;
    planted.appendChild(flower);

    if (planted.children.length > MAX_FLOWERS) {
      const oldest = planted.firstElementChild;
      oldest.classList.add('is-leaving');
      setTimeout(() => oldest.remove(), 400);
    }
  };

  document.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, textarea, select, label, header, .project-card, .hero__status')) return;
    const r = gardenArt.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (y < GRASS_TOP || y > GRASS_BOTTOM || x < 0 || x > r.width) return;
    plant(x, y);
  });

  // On arrival, the little flowers already in the garden pop up one by one,
  // hinting that the grass can be clicked.
  const showcase = () => gardenArt.classList.add('is-blooming');
  if (document.documentElement.classList.contains('intro-on')) {
    document.addEventListener('garden:intro-done', showcase, { once: true });
  } else {
    showcase();
  }
}
