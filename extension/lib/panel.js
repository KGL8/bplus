// Pure panel-geometry logic for the resizable/hideable B+ sidebar.
//
// Kept dependency-free and UMD-exported so the same functions run in the content
// script AND under Node in tests. The panel is a RIGHT-ANCHORED fixed overlay,
// so its width is a percentage of the viewport (stored as `panelWidthPercent`),
// and the drag handle sits on its LEFT edge — dragging that edge left widens it.
(function (root) {
  "use strict";

  const MIN = 10;   // % of viewport — "open but very narrow" (distinct from hidden)
  const MAX = 95;   // % of viewport — never fully covers the page
  const DEFAULT = 34;
  const PRESETS = [25, 50, 75, 95];
  const STEP = 3;   // keyboard / +- nudge

  function clampPercent(pct) {
    const n = Math.round(Number(pct));
    if (!Number.isFinite(n)) return DEFAULT;
    return Math.min(MAX, Math.max(MIN, n));
  }

  // The handle's left edge is at clientX; the panel spans clientX → right edge.
  function percentFromPointer(clientX, viewportWidth) {
    if (!viewportWidth) return DEFAULT;
    return clampPercent(((viewportWidth - clientX) / viewportWidth) * 100);
  }

  function step(pct, delta) {
    return clampPercent(clampPercent(pct) + delta);
  }

  const api = { MIN, MAX, DEFAULT, PRESETS, STEP, clampPercent, percentFromPointer, step };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BBPanel = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
