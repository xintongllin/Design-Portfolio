document.querySelectorAll('.sticker').forEach((sticker) => {
  let grabX = 0;
  let grabY = 0;
  let targetX = 0;
  let targetY = 0;
  let curX = 0;
  let curY = 0;
  let rotation = 0;
  let initialized = false;
  let dragging = false;

  const ensureInitialized = () => {
    if (initialized) return;
    const parentRect = sticker.offsetParent.getBoundingClientRect();
    const stickerRect = sticker.getBoundingClientRect();
    curX = targetX = stickerRect.left - parentRect.left;
    curY = targetY = stickerRect.top - parentRect.top;
    initialized = true;
  };

  const tick = () => {
    ensureInitialized();

    curX += (targetX - curX) * 0.18;
    curY += (targetY - curY) * 0.18;

    const velocityX = targetX - curX;
    const targetRotation = Math.max(-14, Math.min(14, velocityX * 0.6));
    rotation += (targetRotation - rotation) * 0.15;

    sticker.style.left = `${curX}px`;
    sticker.style.top = `${curY}px`;
    sticker.style.right = 'auto';
    sticker.style.bottom = 'auto';
    sticker.style.transform = `rotate(${rotation.toFixed(2)}deg)`;

    requestAnimationFrame(tick);
  };

  sticker.addEventListener('pointerdown', (e) => {
    ensureInitialized();

    const stickerRect = sticker.getBoundingClientRect();
    grabX = e.clientX - stickerRect.left;
    grabY = e.clientY - stickerRect.top;

    dragging = true;
    sticker.classList.add('is-dragging');
    sticker.setPointerCapture(e.pointerId);
  });

  sticker.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const parentRect = sticker.offsetParent.getBoundingClientRect();
    targetX = e.clientX - parentRect.left - grabX;
    targetY = e.clientY - parentRect.top - grabY;
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    sticker.classList.remove('is-dragging');
    sticker.releasePointerCapture(e.pointerId);
  };

  sticker.addEventListener('pointerup', endDrag);
  sticker.addEventListener('pointercancel', endDrag);

  requestAnimationFrame(tick);
});

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
