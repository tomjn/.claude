---
paths:
  - "**/*.vue"
  - "**/*.jsx"
  - "**/*.tsx"
  - "**/*.svelte"
  - "**/*.css"
  - "**/*.scss"
  - "**/*.html"
  - "**/components/**"
  - "**/views/**"
  - "**/pages/**"
  - "**/template-parts/**"
  - "**/templates/**"
  - "**/theme/**"
  - "**/themes/**"
  - "**/blocks/**"
  - "**/patterns/**"
---

# UI/UX & Accessibility

> Design and polish guidance lives in the `impeccable` skill family. This file covers only what should apply while writing code, without being invoked.

## Accessibility (A11Y)
- Use semantic HTML (`main`, `nav`, `section`, `article`). Prefer native HTML elements over ARIA — the first rule of ARIA is "don't use ARIA" when native semantics suffice.
- All interactive elements must have accessible names — prefer visible labels and semantic HTML over `aria-label`. Only use `aria-label` when no visible text exists.
- Check color contrast (AA standard minimum, WCAG 2.2).
- 100% keyboard navigability — focus states must be visible. Prefer `:focus-visible` over plain `:focus` so the ring shows for keyboard users but not on mouse clicks.
- **Touch target size:** interactive elements must be at least 24×24 CSS px (WCAG 2.2 AA, SC 2.5.8); aim for 44×44 where space allows. Use padding to expand hit area rather than enlarging the visible glyph.
- Wrap non-essential motion in `@media (prefers-reduced-motion: reduce)` so it can be disabled.

## Visual / CSS Bugs
- **Assume you cannot see rendered output unless a browser tool is active in this session** (e.g. Chrome DevTools MCP, Playwright/Puppeteer). Without one, do not trace rendering pipelines in your head — you will always be guessing. With one, take an actual screenshot rather than reasoning from the DOM.
- **One-round proposal.** For visual bugs: (1) identify the most likely CSS/DOM cause from the code, (2) propose the fix with your reasoning, (3) ask the user to verify. If wrong, ask what they see — don't theorize further.
- **Screenshots are your only ground truth.** Study what the screenshot shows before reading code. The visual symptom narrows the search space more than tracing call chains.
- **Prefer CSS-level fixes over widget/DOM workarounds.** CSS properties (border, padding, background) apply uniformly across lines and states. Widget-level fixes (character rendering, inline spans) are fragile across fonts, line heights, and empty lines.
