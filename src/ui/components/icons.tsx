// Small inline SVG icons (no icon font or network request needed).

const paths: Record<string, string> = {
  pencil: "M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3",
  erase: "M7 20h12M5 15l8-8 6 6-6 6H9l-4-4zM10 10l6 6",
  pan: "M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3",
  elevation: "M3 19l6-10 4 6 3-4 5 8H3zM9 9l1.5 2.5",
  pick: "M14 4l6 6-2 2-6-6 2-2zM12 8l-8 8v4h4l8-8",
  select: "M4 4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4M4 7V4",
  lasso: "M12 4c5 0 8.5 2.2 8.5 5S17 14 12 14 3.5 11.8 3.5 9 7 4 12 4zM7 13c-1.5 1-1.8 2.6-.6 3.6 1 .9 2.6.6 2.6 2.4",
  wand: "M4 20L14 10M15 4v3M15 13v3M11 8h-3M22 8h-3M18.5 4.5l-1.5 1.5M18.5 11.5L17 10M11.5 4.5L13 6",
  grow: "M4 4h16v16H4zM8 12h8M12 8v8",
  shrink: "M4 4h16v16H4zM8 12h8",
  invert: "M4 4h16v16H4zM4 20L20 4",
  all: "M4 4h16v16H4zM8 8h8v8H8z",
  stroke: "M4 18c3-6 6 2 9-4s5-6 7-8M4 18l2 2",
  zones: "M4 4h7v7H4zM13 13h7v7h-7zM13 4l7 7M4 13l7 7",
  things: "M12 21s-6-5.2-6-10a6 6 0 0112 0c0 4.8-6 10-6 10zM12 8.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z",
  lock: "M6 11h12v9H6v-9zM8.5 11V8a3.5 3.5 0 017 0v3",
  unlock: "M6 11h12v9H6v-9zM8.5 11V8a3.5 3.5 0 016.8-1.2",
  copy: "M8 8h11v12H8V8zM5 16V4h11",
  cut: "M6 7a2.5 2.5 0 100 .1M6 17a2.5 2.5 0 100 .1M8 8l12 10M8 16L20 6",
  paste: "M8 4h8v3H8V4zM6 5H5v16h14V5h-1M9 12h6M9 16h6",
  turn: "M20 12a8 8 0 11-2.3-5.7M20 4v5h-5",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  zoomIn: "M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5M11 8v6M8 11h6",
  zoomOut: "M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5M8 11h6",
  maps: "M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2V6zM9 4v14M15 6v14",
  plus: "M12 5v14M5 12h14",
  open: "M3 7h6l2 2h10v10H3V7z",
  save: "M5 4h11l3 3v13H5V4zM8 4v5h8V4M8 20v-6h8v6",
  settings: "M12 9a3 3 0 100 6 3 3 0 000-6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
  close: "M6 6l12 12M18 6L6 18",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  export: "M12 3v12M7 8l5-5 5 5M5 15v5h14v-5",
  generate: "M12 3l1.8 4.7L18 9l-4.2 1.3L12 15l-1.8-4.7L6 9l4.2-1.3L12 3zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15zM5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6L5 15z",
};

export function Icon({ name, size = 22 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ""} />
    </svg>
  );
}
