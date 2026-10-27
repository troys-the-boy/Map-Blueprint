// A number box that lets you type freely.
//
// While typing, the value is passed on only when it's a valid number inside
// the allowed range, so clearing the box or typing "1" on the way to "12"
// never gets "corrected" mid-keystroke. When you leave the box (or press
// Enter) an out-of-range value is clamped and an empty box goes back to the
// last good value.

import { useEffect, useState } from "react";

interface Props {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Whole numbers only (default true). */
  whole?: boolean;
  title?: string;
  "aria-label"?: string;
  disabled?: boolean;
}

export function NumberField({ value, min, max, onChange, whole = true, title, ...rest }: Props) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);

  // Follow outside changes (e.g. Reset settings) when not typing.
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);

  const parse = (s: string) => {
    if (s.trim() === "") return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return whole ? Math.round(n) : n;
  };

  const commit = () => {
    setEditing(false);
    const n = parse(text);
    if (n === null) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <input
      type="text"
      inputMode={whole ? "numeric" : "decimal"}
      pattern={whole ? "[0-9]*" : undefined}
      value={text}
      title={title}
      aria-label={rest["aria-label"]}
      disabled={rest.disabled}
      onFocus={(e) => {
        setEditing(true);
        e.target.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = parse(e.target.value);
        if (n !== null && n >= min && n <= max && n !== value) onChange(n);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
