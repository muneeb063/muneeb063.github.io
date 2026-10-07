// Page motion and interactions. Classic script (no modules) so it also runs from file://.
(function () {
  'use strict';

  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const { gsap, ScrollTrigger, Lenis } = window;
  window.__siteReady = true;

  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  /* ---------- WebGL scene: loads in the background, the page never waits on it ---------- */
  const sceneState = { morph: 0, intro: reduced ? 1 : 0, scroll: 0, introStarted: false };
  let scene = null;
  const stages = [...document.querySelectorAll('[data-stage]')]
    .sort((a, b) => Number(a.dataset.stage) - Number(b.dataset.stage));

  if (window.PortfolioScene) {
    window.PortfolioScene.create(document.querySelector('.webgl'), { reduced, stages })
      .then((s) => {
        if (!s) return;
        scene = s;
        scene.setMorph(sceneState.morph);
        scene.setScroll(sceneState.scroll);
        // If the page intro already ran, gather the particles now instead of popping them in.
        if (sceneState.introStarted && gsap && !reduced) {
          const o = { v: 0 };
          gsap.to(o, { v: 1, duration: 2.6, ease: 'power2.out', onUpdate: () => scene.setIntro(o.v) });
        } else {
          scene.setIntro(sceneState.intro);
        }
      })
      .catch((err) => console.warn('3D scene unavailable:', err));
  }
  const setMorph = (v) => { sceneState.morph = v; scene?.setMorph(v); };
  const setScroll = (v) => { sceneState.scroll = v; scene?.setScroll(v); };
  const setIntro = (v) => { sceneState.intro = v; scene?.setIntro(v); };

  /* ---------- Fallback when the animation libraries failed to load ---------- */
  if (!gsap || !ScrollTrigger) {
    root.classList.remove('motion', 'is-loading');
    setIntro(1);
    bindMenu(null);
    bindEmail();
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* ---------- Smooth scroll ---------- */
  let lenis = null;
  if (!reduced && Lenis) {
    lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  const scrollVelocity = () => (lenis ? lenis.velocity : 0);

  const nav = document.querySelector('[data-nav]');
  let autoScrolling = false;

  bindMenu(lenis);
  bindEmail();
  splitHero();
  splitHeadings();
  buildRail();
  buildMarquee();
  buildMorph();
  buildReveals();
  buildHeroScroll();
  buildNav();
  buildPointerFx();
  runIntro();

  window.addEventListener('load', () => ScrollTrigger.refresh());
  document.fonts?.ready.then(() => ScrollTrigger.refresh());

  /* =====================================================================
     Navigation: smooth section jumps, sliding indicator, progress line
     ===================================================================== */
  function bindMenu(lenisRef) {
    const toggle = document.querySelector('[data-menu-toggle]');
    const menu = document.querySelector('[data-menu]');
    menu.inert = true;

    function setMenu(open) {
      document.body.classList.toggle('menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      menu.setAttribute('aria-hidden', String(!open));
      menu.inert = !open;
      if (lenisRef) open ? lenisRef.stop() : lenisRef.start();
    }
    toggle.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

    const easeInOutQuart = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);

    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', (e) => {
        const id = link.getAttribute('href');
        const target = id === '#top' ? null : document.querySelector(id);
        if (id !== '#top' && !target) return;
        e.preventDefault();
        setMenu(false);
        if (lenisRef) {
          const distance = Math.abs(target ? target.getBoundingClientRect().top : window.scrollY);
          const duration = Math.min(2.4, Math.max(1.1, 0.9 + distance / 3200));
          autoScrolling = true;
          nav?.classList.remove('is-hidden');
          lenisRef.scrollTo(target || 0, {
            duration,
            easing: easeInOutQuart,
            onComplete: () => { autoScrolling = false; },
          });
          setTimeout(() => { autoScrolling = false; }, duration * 1000 + 200);
        } else if (target) {
          target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
        } else {
          window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
        }
      });
    });
  }

  function buildNav() {
    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => {
        setScroll(self.scroll());
        const hide = !autoScrolling && self.direction === 1 && self.scroll() > window.innerHeight * 0.6
          && !document.body.classList.contains('menu-open');
        nav.classList.toggle('is-hidden', hide);
      },
    });

    gsap.fromTo('.nav-progress span', { scaleX: 0 }, {
      scaleX: 1, ease: 'none',
      scrollTrigger: { start: 0, end: 'max', scrub: 0.3 },
    });

    const indicator = nav.querySelector('.nav-indicator');
    const links = [...nav.querySelectorAll('[data-nav-link]')];
    let current = null;
    const moveTo = (link) => {
      if (link === current) return;
      current = link;
      links.forEach((l) => l.setAttribute('aria-current', String(l === link)));
      if (!link) { gsap.to(indicator, { opacity: 0, duration: 0.3, ease: 'power2.out' }); return; }
      gsap.to(indicator, {
        x: link.offsetLeft, width: link.offsetWidth, opacity: 1,
        duration: indicator.style.opacity === '1' || gsap.getProperty(indicator, 'opacity') > 0 ? 0.7 : 0,
        ease: 'expo.out',
      });
    };
    links.forEach((link) => {
      const section = document.getElementById(link.dataset.navLink);
      if (!section) return;
      ScrollTrigger.create({
        trigger: section,
        start: 'top 55%',
        end: 'bottom 55%',
        onToggle: (self) => {
          if (self.isActive) moveTo(link);
          else if (current === link) moveTo(null);
        },
      });
    });
    window.addEventListener('resize', () => { if (current) gsap.set(indicator, { x: current.offsetLeft, width: current.offsetWidth }); });
  }

  /* =====================================================================
     Text: hero characters, heading word masks, scramble labels
     ===================================================================== */
  function splitHero() {
    document.querySelectorAll('[data-split]').forEach((el) => {
      const text = el.textContent.trim();
      el.textContent = '';
      for (const ch of text) {
        const span = document.createElement('span');
        span.className = 'char';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = ch;
        el.appendChild(span);
      }
    });
    if (!reduced) gsap.set('.hero-title .char', { yPercent: 115 });
  }

  // Wrap every word of a heading in a mask so it can slide up from below, keeping inner spans.
  function splitHeadings() {
    document.querySelectorAll('[data-heading]').forEach((heading) => {
      heading.setAttribute('aria-label', heading.textContent.replace(/\s+/g, ' ').trim());
      const wrapText = (node) => {
        [...node.childNodes].forEach((child) => {
          if (child.nodeType === Node.TEXT_NODE) {
            const parts = child.textContent.split(/(\s+)/);
            const frag = document.createDocumentFragment();
            parts.forEach((part) => {
              if (!part) return;
              if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
              const w = document.createElement('span');
              w.className = 'w';
              w.setAttribute('aria-hidden', 'true');
              const inner = document.createElement('span');
              inner.className = 'w-in';
              inner.textContent = part;
              w.appendChild(inner);
              frag.appendChild(w);
            });
            child.replaceWith(frag);
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            wrapText(child);
          }
        });
      };
      wrapText(heading);
      if (reduced) return;
      const words = heading.querySelectorAll('.w-in');
      gsap.set(words, { yPercent: 115, rotate: 4 });
      ScrollTrigger.create({
        trigger: heading,
        start: 'top 86%',
        once: true,
        onEnter: () => gsap.to(words, { yPercent: 0, rotate: 0, duration: 1.2, ease: 'expo.out', stagger: 0.07 }),
      });
    });
  }

  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&/+';
  function scramble(el, duration = 1.2) {
    const final = el.dataset.text || el.textContent;
    el.dataset.text = final;
    const state = { p: 0 };
    return gsap.to(state, {
      p: 1,
      duration,
      ease: 'power2.out',
      onUpdate: () => {
        const reveal = Math.floor(state.p * final.length);
        let out = '';
        for (let i = 0; i < final.length; i++) {
          const ch = final[i];
          out += i < reveal || ch === ' ' ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
        el.textContent = out;
      },
      onComplete: () => { el.textContent = final; },
    });
  }

  /* =====================================================================
     Work rail: endless auto-scroll, scroll-velocity boost, drag, hover tilt
     ===================================================================== */
  function buildRail() {
    const rail = document.querySelector('[data-rail]');
    const track = rail?.querySelector('[data-rail-track]');
    if (!rail || !track) return;
    if (reduced) { rail.classList.add('is-native'); return; }

    const originals = [...track.children];
    originals.forEach((card) => {
      const clone = card.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.inert = true;
      track.appendChild(clone);
    });
    rail.classList.add('is-looping');
    track.querySelectorAll('img').forEach((img) => { img.draggable = false; });

    let setWidth = 1;
    const measure = () => {
      setWidth = track.children[originals.length].offsetLeft - track.children[0].offsetLeft || 1;
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);

    const BASE = finePointer ? 46 : 34; // px per second
    let x = 0, dir = -1, hover = 0, hoverTarget = 0, skew = 0;
    let dragging = false, dragVel = 0, lastX = 0, lastT = 0, moved = 0, active = true, captured = false;

    ScrollTrigger.create({ trigger: rail, start: 'top bottom', end: 'bottom top', onToggle: (s) => { active = s.isActive; } });

    gsap.ticker.add((_, deltaMs) => {
      if (!active) return;
      const dt = Math.min(deltaMs / 1000, 0.05);
      hover += (hoverTarget - hover) * (1 - Math.exp(-dt * 5));
      const sv = scrollVelocity();
      if (Math.abs(sv) > 0.4) dir = sv > 0 ? -1 : 1;
      const boost = 1 + Math.min(Math.abs(sv) * 0.14, 7);
      let v = 0;
      if (!dragging) {
        dragVel *= Math.exp(-dt * 3.2);
        v = BASE * dir * boost * (1 - hover) + dragVel;
        x += v * dt;
      } else {
        v = dragVel;
      }
      x = ((x % setWidth) - setWidth) % setWidth;
      const targetSkew = gsap.utils.clamp(-7, 7, (Math.abs(v) > BASE * 1.6 ? v : 0) * -0.006);
      skew += (targetSkew - skew) * (1 - Math.exp(-dt * 6));
      track.style.transform = `translate3d(${x.toFixed(2)}px,0,0) skewX(${skew.toFixed(3)}deg)`;
    });

    // Drag (mouse and touch). Vertical page scroll stays native thanks to touch-action: pan-y.
    rail.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true; captured = false; moved = 0; dragVel = 0;
      lastX = e.clientX; lastT = e.timeStamp;
    });
    rail.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dtm = Math.max(1, e.timeStamp - lastT);
      lastX = e.clientX; lastT = e.timeStamp;
      x += dx; moved += Math.abs(dx);
      dragVel = gsap.utils.clamp(-2600, 2600, (dx / dtm) * 1000);
      if (moved > 6 && !captured) {
        captured = true;
        rail.setPointerCapture(e.pointerId);
        rail.classList.add('is-dragging');
      }
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      rail.classList.remove('is-dragging');
    };
    rail.addEventListener('pointerup', endDrag);
    rail.addEventListener('pointercancel', endDrag);
    rail.addEventListener('click', (e) => { if (moved > 6) { e.preventDefault(); e.stopPropagation(); } }, true);

    // Hover: the rail eases to a stop, the card lifts and tilts toward the cursor.
    track.querySelectorAll('.project').forEach((project) => {
      const card = project.querySelector('.project-card');
      const img = project.querySelector('.project-media img');
      gsap.set(card, { transformPerspective: 900 });
      const rx = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3' });
      const ry = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3' });
      const ix = gsap.quickTo(img, 'xPercent', { duration: 0.8, ease: 'power3' });
      const iy = gsap.quickTo(img, 'yPercent', { duration: 0.8, ease: 'power3' });

      project.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse') return;
        hoverTarget = 1;
        project.classList.add('is-hover');
        rail.classList.add('has-hover');
        gsap.to(card, { y: -14, scale: 1.025, duration: 0.6, ease: 'expo.out', overwrite: 'auto' });
        gsap.to(img, { scale: 1.12, duration: 1.2, ease: 'expo.out' });
      });
      project.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse' || dragging) return;
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        rx(-py * 9); ry(px * 11);
        ix(-px * 4); iy(-py * 4);
        card.style.setProperty('--mx', `${(px + 0.5) * 100}%`);
        card.style.setProperty('--my', `${(py + 0.5) * 100}%`);
      });
      project.addEventListener('pointerleave', () => {
        hoverTarget = 0;
        project.classList.remove('is-hover');
        rail.classList.remove('has-hover');
        rx(0); ry(0); ix(0); iy(0);
        gsap.to(card, { y: 0, scale: 1, duration: 0.7, ease: 'expo.out', overwrite: 'auto' });
        gsap.to(img, { scale: 1.02, duration: 0.9, ease: 'expo.out' });
      });
    });

    // Keyboard: pause and bring the focused card into view.
    originals.forEach((project) => {
      project.addEventListener('focusin', () => {
        hoverTarget = 1;
        x = -(project.offsetLeft - track.children[0].offsetLeft);
      });
      project.addEventListener('focusout', () => { hoverTarget = 0; });
    });

    // Entrance: cards fly in from the right when the section arrives.
    gsap.set(originals, { xPercent: 40, opacity: 0 });
    ScrollTrigger.create({
      trigger: rail,
      start: 'top 85%',
      once: true,
      onEnter: () => gsap.to(originals, { xPercent: 0, opacity: 1, duration: 1.4, ease: 'expo.out', stagger: 0.08 }),
    });
  }

  /* ---------- Tech strip: drifts and reacts to scroll speed and direction ---------- */
  function buildMarquee() {
    const marquee = document.querySelector('.marquee');
    const track = marquee?.querySelector('.marquee-track');
    if (!track || reduced) return;
    marquee.classList.add('is-looping');
    let x = 0, dir = -1, active = true;
    ScrollTrigger.create({ trigger: marquee, start: 'top bottom', end: 'bottom top', onToggle: (s) => { active = s.isActive; } });
    gsap.ticker.add((_, deltaMs) => {
      if (!active) return;
      const dt = Math.min(deltaMs / 1000, 0.05);
      const sv = scrollVelocity();
      if (Math.abs(sv) > 0.4) dir = sv > 0 ? -1 : 1;
      const half = track.scrollWidth / 2 || 1;
      x += 60 * dir * (1 + Math.min(Math.abs(sv) * 0.2, 9)) * dt;
      x = ((x % half) - half) % half;
      track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
    });
  }

  /* =====================================================================
     Scroll position drives the particle morph between sections
     ===================================================================== */
  function buildMorph() {
    const sections = ['#about', '#projects', '#skills', '#experience', '#contact'].map((s) => document.querySelector(s));
    const progress = sections.map(() => 0);
    const apply = () => setMorph(progress.reduce((a, b) => a + b, 0));
    sections.forEach((section, i) => {
      ScrollTrigger.create({
        trigger: section,
        start: 'top 85%',
        end: 'top 20%',
        onUpdate: (self) => { progress[i] = self.progress; apply(); },
        onRefresh: (self) => { progress[i] = self.progress; apply(); },
      });
    });
  }

  /* =====================================================================
     Reveals: fades, drawn rules, word scrub, counters, timeline
     ===================================================================== */
  function buildReveals() {
    if (reduced) return;

    ScrollTrigger.batch('[data-reveal]', {
      start: 'top 88%',
      once: true,
      onEnter: (els) => gsap.fromTo(els,
        { opacity: 0, y: 48 },
        { opacity: 1, y: 0, duration: 1.2, ease: 'expo.out', stagger: 0.09, overwrite: true }),
    });

    // Capability rows: slide in and draw their top rule.
    ScrollTrigger.batch('.cap', {
      start: 'top 90%',
      once: true,
      onEnter: (els) => {
        els.forEach((el) => el.classList.add('is-in'));
        gsap.fromTo(els, { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 1.1, ease: 'expo.out', stagger: 0.1 });
      },
    });

    // Stats: rule draws, number counts up.
    document.querySelectorAll('.stat').forEach((stat) => {
      const num = stat.querySelector('[data-counter]');
      const end = Number(num.dataset.counter);
      const counter = { v: 0 };
      num.textContent = '0';
      ScrollTrigger.create({
        trigger: stat,
        start: 'top 92%',
        once: true,
        onEnter: () => {
          stat.classList.add('is-in');
          gsap.to(counter, { v: end, duration: 2, ease: 'power3.out', onUpdate: () => { num.textContent = Math.round(counter.v); } });
        },
      });
    });

    // About statement lights up word by word as it scrolls past.
    const statement = document.querySelector('[data-words]');
    if (statement) {
      const words = statement.textContent.trim().split(/\s+/);
      statement.setAttribute('aria-label', words.join(' '));
      statement.textContent = '';
      words.forEach((w, i) => {
        const span = document.createElement('span');
        span.className = 'word';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = w;
        statement.appendChild(span);
        if (i < words.length - 1) statement.appendChild(document.createTextNode(' '));
      });
      gsap.fromTo(statement.querySelectorAll('.word'), { opacity: 0.12, y: 10 }, {
        opacity: 1, y: 0, ease: 'none', stagger: 0.05,
        scrollTrigger: { trigger: statement, start: 'top 82%', end: 'bottom 52%', scrub: 0.6 },
      });
    }

    // Timeline: line fills with scroll, each node lights up as it passes the middle.
    gsap.fromTo('.xp-line span', { scaleY: 0 }, {
      scaleY: 1, ease: 'none',
      scrollTrigger: { trigger: '.xp-list', start: 'top 62%', end: 'bottom 62%', scrub: 0.4 },
    });
    document.querySelectorAll('.xp-item').forEach((item) => {
      ScrollTrigger.create({
        trigger: item,
        start: 'top 62%',
        onEnter: () => item.classList.add('is-active'),
        onLeaveBack: () => item.classList.remove('is-active'),
      });
    });

    // Contact: portrait swings in, eyebrow decodes.
    gsap.fromTo('.portal img', { scale: 0.6, rotate: -12, opacity: 0 }, {
      scale: 1, rotate: 0, opacity: 1, duration: 1.6, ease: 'expo.out',
      scrollTrigger: { trigger: '.portal', start: 'top 80%', once: true },
    });
    const contactEyebrow = document.querySelector('.contact [data-scramble]');
    if (contactEyebrow) {
      ScrollTrigger.create({ trigger: contactEyebrow, start: 'top 90%', once: true, onEnter: () => scramble(contactEyebrow, 1.4) });
    }
  }

  /* ---------- Hero drifts up and fades as you leave it ---------- */
  function buildHeroScroll() {
    if (reduced) return;
    gsap.to('.hero-content', {
      yPercent: -14, opacity: 0.1, ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
    });
  }

  /* =====================================================================
     Pointer effects: hero letters, project label, magnetic buttons
     ===================================================================== */
  function buildPointerFx() {
    document.querySelectorAll('[data-magnetic]').forEach((btn) => {
      btn.addEventListener('pointerdown', () => gsap.to(btn, { scale: 0.96, duration: 0.12, ease: 'power2.out' }));
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) =>
        btn.addEventListener(type, () => gsap.to(btn, { scale: 1, duration: 0.4, ease: 'power3.out' })));
    });

    if (!finePointer || reduced) return;

    // Hero letters rise toward the cursor like a ripple.
    const hero = document.querySelector('.hero');
    const chars = [...document.querySelectorAll('.hero-title .char')].map((el) => ({
      el,
      y: gsap.quickTo(el, 'y', { duration: 0.7, ease: 'power3' }),
      c: gsap.quickTo(el, '--heat', { duration: 0.5, ease: 'power2' }),
    }));
    hero.addEventListener('pointermove', (e) => {
      chars.forEach((ch) => {
        const r = ch.el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = (e.clientY - (r.top + r.height / 2)) * 1.3;
        const f = Math.max(0, 1 - Math.hypot(dx, dy) / 280);
        ch.y(-f * f * 26);
        ch.c(f);
      });
    });
    hero.addEventListener('pointerleave', () => chars.forEach((ch) => { ch.y(0); ch.c(0); }));

    // "Open" label follows the cursor over project images.
    const pill = document.querySelector('.cursor-pill');
    gsap.set(pill, { xPercent: -50, yPercent: -50, scale: 0.5 });
    const px = gsap.quickTo(pill, 'x', { duration: 0.45, ease: 'power3' });
    const py = gsap.quickTo(pill, 'y', { duration: 0.45, ease: 'power3' });
    window.addEventListener('pointermove', (e) => { px(e.clientX); py(e.clientY); }, { passive: true });
    document.querySelector('[data-rail-track]')?.addEventListener('pointerover', (e) => {
      const media = e.target.closest('[data-cursor]');
      gsap.to(pill, media
        ? { opacity: 1, scale: 1, duration: 0.35, ease: 'power3.out', overwrite: 'auto' }
        : { opacity: 0, scale: 0.5, duration: 0.25, ease: 'power2.out', overwrite: 'auto' });
    });
    document.querySelector('[data-rail]')?.addEventListener('pointerleave', () =>
      gsap.to(pill, { opacity: 0, scale: 0.5, duration: 0.25, ease: 'power2.out', overwrite: 'auto' }));

    // Buttons lean toward the cursor.
    document.querySelectorAll('[data-magnetic]').forEach((btn) => {
      const xTo = gsap.quickTo(btn, 'x', { duration: 0.8, ease: 'elastic.out(1, 0.45)' });
      const yTo = gsap.quickTo(btn, 'y', { duration: 0.8, ease: 'elastic.out(1, 0.45)' });
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * 0.28);
        yTo((e.clientY - (r.top + r.height / 2)) * 0.38);
      });
      btn.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
    });
  }

  /* =====================================================================
     Preloader and hero entrance
     ===================================================================== */
  function runIntro() {
    if (reduced) {
      root.classList.remove('is-loading');
      setIntro(1);
      return;
    }

    window.scrollTo(0, 0);
    lenis?.stop();

    const loader = document.querySelector('.loader');
    const count = loader.querySelector('[data-count]');
    const bar = loader.querySelector('.loader-line span');
    const progress = { v: 0 };
    const draw = () => {
      count.textContent = Math.round(progress.v);
      bar.style.transform = `scaleX(${progress.v / 100})`;
    };

    const ready = Promise.race([
      document.fonts?.ready ?? Promise.resolve(),
      new Promise((res) => setTimeout(res, 3000)),
    ]);
    const minTime = new Promise((res) => setTimeout(res, 1000));
    const fill = gsap.to(progress, { v: 88, duration: 1.6, ease: 'power2.out', onUpdate: draw });
    const eyebrow = document.querySelector('.hero [data-scramble]');

    Promise.all([ready, minTime]).then(() => {
      fill.kill();
      const intro = { v: 0 };
      gsap.timeline({ onComplete: () => lenis?.start() })
        .to(progress, { v: 100, duration: 0.4, ease: 'power2.inOut', onUpdate: draw })
        .to('.loader-row', { yPercent: -40, opacity: 0, duration: 0.5, ease: 'power3.in' })
        .to('.loader-line', { opacity: 0, duration: 0.3 }, '<')
        .to(loader, { clipPath: 'inset(0 0 100% 0)', duration: 1.05, ease: 'expo.inOut' }, '-=0.1')
        .add(() => { root.classList.remove('is-loading'); sceneState.introStarted = true; })
        .to(intro, { v: 1, duration: 2.8, ease: 'power2.out', onUpdate: () => setIntro(intro.v) }, '-=0.9')
        .to('.hero-title .char', {
          yPercent: 0, duration: 1.3, ease: 'expo.out', stagger: 0.035,
          // Drop the line masks once the letters are in, so the cursor ripple can lift them freely.
          onComplete: () => document.querySelector('.hero-title').classList.add('is-revealed'),
        }, '-=2.6')
        .fromTo('[data-hero-fade]', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.09 }, '-=1.1')
        .add(() => { if (eyebrow) scramble(eyebrow, 1.3); }, '<');
    });
  }

  /* ---------- Copy email ---------- */
  function bindEmail() {
    const email = document.querySelector('[data-copy]');
    if (!email) return;
    const label = email.querySelector('[data-copy-label]');
    const icon = email.querySelector('.email-state i');
    let timer;
    const swap = (text, iconName) => {
      email.classList.add('is-swapping');
      setTimeout(() => {
        label.textContent = text;
        icon.className = `ph-light ${iconName}`;
        email.classList.remove('is-swapping');
      }, 160);
    };
    email.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(email.dataset.copy);
        email.classList.add('is-copied');
        swap('Copied', 'ph-check');
        clearTimeout(timer);
        timer = setTimeout(() => { email.classList.remove('is-copied'); swap('Copy', 'ph-copy'); }, 2200);
      } catch {
        window.location.href = `mailto:${email.dataset.copy}`;
      }
    });
  }
})();
