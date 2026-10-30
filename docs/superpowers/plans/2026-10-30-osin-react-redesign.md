# OSIN React Redesign Implementation Plan

> **For agentic workers:** Implement this plan task by task. Keep OSIN copy,
> identity, links, terminal capture, and Cloudflare Pages compatibility.

**Goal:** Rebuild OSIN's `WEB/` landing page as a responsive React application
that uses the OSIEN portfolio's component-led visual language.

**Architecture:** Add an isolated Vite app under `WEB/` so the CLI package and
its existing uncommitted root changes remain untouched. Use OSIN-specific
React sections, adapting the portfolio's atmosphere, scroll reveal, nav, and
scroll-progress concepts; keep the current semantic content and assets.

**Tech Stack:** React, React DOM, Vite, TypeScript, Framer Motion, CSS.

**Spec:** Approved design brief in the conversation: reuse portfolio component
patterns, retain OSIN branding/copy/terminal capture, and preserve static Pages
deployment from `WEB/`.

## Global Constraints

- Keep all implementation and package changes within `WEB/`.
- Preserve OSIN's name, public copy, GitHub/NPM destinations, real terminal
  screenshot, copy-command behavior, and accessible navigation.
- Honor `prefers-reduced-motion`; never hide essential information behind motion.
- Keep Cloudflare Pages compatible with a static Vite build from `WEB/`.
- Do not modify the portfolio repository or existing root working-tree changes.

## Review Focus

- Direct route load and static asset paths: build output must contain the page,
  scripts, styles, logo, and terminal screenshot.
- Narrow viewport and menu interaction: no horizontal overflow; menu remains
  keyboard accessible and exposes correct expanded state.
- Reduced-motion preference: reveal and atmosphere effects stop or simplify.
- Clipboard denied/unavailable: copy buttons report failure without crashing.
- WebGL/canvas unavailable or background rendering disabled: content remains
  readable and interactive.

---

### Task 1: Isolated Vite application and static build

**Files:**
- Create: `WEB/package.json`
- Create: `WEB/vite.config.ts`
- Create: `WEB/tsconfig.json`
- Create: `WEB/tsconfig.app.json`
- Modify: `WEB/index.html`

**Interfaces:**
- Produces: `npm run build` in `WEB/` emits a static site to `WEB/dist/`.

- [ ] Add local app scripts and dependencies without changing the CLI root
  `package.json` or lockfile.
- [ ] Configure Vite React build output and asset paths for Pages.
- [ ] Make `WEB/index.html` the Vite app shell and retain SEO metadata.
- [ ] Install the isolated web dependencies and run the first production build.

### Task 2: React page structure and OSIN content

**Files:**
- Create: `WEB/src/main.tsx`
- Create: `WEB/src/App.tsx`
- Create: `WEB/src/components/SiteHeader.tsx`
- Create: `WEB/src/components/Hero.tsx`
- Create: `WEB/src/components/TerminalShowcase.tsx`
- Create: `WEB/src/components/FeatureSections.tsx`
- Create: `WEB/src/components/GettingStarted.tsx`
- Create: `WEB/src/components/SiteFooter.tsx`
- Create: `WEB/src/data/content.ts`

**Interfaces:**
- `App` composes the site shell, ambience, header, page sections, and footer.
- `SiteHeader` owns responsive navigation and `aria-expanded` state.
- `GettingStarted` owns clipboard interaction with visible live status.

- [ ] Port all existing page copy, anchors, links, and imagery into semantic
  React sections; do not invent new product claims.
- [ ] Keep the actual terminal capture as the hero's primary visual proof.
- [ ] Rebuild mobile menu and clipboard interactions with React state/events.

### Task 3: Portfolio-inspired motion and visual system

**Files:**
- Create: `WEB/src/components/LightBg.tsx`
- Create: `WEB/src/components/InteractiveAtmosphere.tsx`
- Create: `WEB/src/components/ScrollReveal.tsx`
- Create: `WEB/src/components/ScrollProgress.tsx`
- Create: `WEB/src/styles.css`

**Interfaces:**
- `LightBg` provides the fixed dot-grid canvas.
- `InteractiveAtmosphere` provides a lightweight pointer glow/cursor; no
  Three.js scene is required for the OSIN product landing page.
- `ScrollReveal` accepts children and an optional reveal direction/delay.
- `ScrollProgress` maps page scroll progress to the portfolio-style wave.

- [ ] Use portfolio black canvas, subtle dot field, lightweight display type,
  mono section markers, hairline dividers, and restrained warm/cool accents.
- [ ] Apply motion sparingly and disable it when reduced motion is requested.
- [ ] Keep touch devices on native cursors and avoid blocking pointer events.

### Task 4: Verification and deployment readiness

**Files:**
- Create: `WEB/public/_redirects` only if the static host requires SPA fallback.

- [ ] Run `npm run build` and verify static output paths and image references.
- [ ] Run the existing OSIN CLI test suite from repository root without editing
  its user-owned changes.
- [ ] Inspect desktop and mobile renders, console errors, and keyboard flow.
- [ ] Confirm Cloudflare Pages build output configuration points to `WEB/dist`
  before claiming deployment readiness; do not alter Cloudflare settings unless
  needed for the approved rebuild.
