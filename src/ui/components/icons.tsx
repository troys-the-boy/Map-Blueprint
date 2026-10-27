// Small inline SVG icons (no icon font or network request needed).

const paths: Record<string, string> = {
  pencil: "M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3",
  erase: "M7 20h12M5 15l8-8 6 6-6 6H9l-4-4zM10 10l6 6",
  pan: "M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3",
  pick: "M14 4l6 6-2 2-6-6 2-2zM12 8l-8 8v4h4l8-8",
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
};

export function Icon({ name, size = 22 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ""} />
    </svg>
  );
}
