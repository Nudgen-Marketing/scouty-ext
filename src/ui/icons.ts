// The six icons the extension needs, copied from lucide (ISC licence, see THIRD_PARTY.md) as path
// data. No icon package is bundled. Drawn on a 24 × 24 grid with a 2 px round stroke.
export type IconShape = { path: string } | { circle: [number, number, number] };

export const ICONS = {
  check: [{ path: "M20 6 9 17l-5-5" }],
  alert: [
    { path: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" },
    { path: "M12 9v4" },
    { path: "M12 17h.01" },
  ],
  loader: [{ path: "M21 12a9 9 0 1 1-6.219-8.56" }],
  external: [
    { path: "M15 3h6v6" },
    { path: "M10 14 21 3" },
    { path: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" },
  ],
  x: [{ path: "M18 6 6 18" }, { path: "m6 6 12 12" }],
  settings: [
    { path: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" },
    { circle: [12, 12, 3] },
  ],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICONS;
