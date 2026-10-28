// A tiny schema checker for files the user opens.
//
// Opened files are treated as untrusted data: every value is checked for type,
// size and allowed keys before the app uses it, and anything unexpected is
// rejected with a message that says exactly where the problem is.

export class FileFormatError extends Error {
  constructor(
    readonly path: string,
    readonly problem: string,
  ) {
    super(path ? `${path}: ${problem}` : problem);
    this.name = "FileFormatError";
  }
}

/** A checker takes an unknown value and its location, and returns the checked value or throws. */
export type Check<T> = (value: unknown, path: string) => T;

function fail(path: string, problem: string): never {
  throw new FileFormatError(path, problem);
}

function describe(value: unknown): string {
  if (value === null) return "nothing (null)";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "string") return "text";
  return `a ${typeof value}`;
}

export const str =
  (maxLength = 200, pattern?: RegExp): Check<string> =>
  (v, path) => {
    if (typeof v !== "string") fail(path, `expected text, found ${describe(v)}`);
    if (v.length > maxLength) fail(path, `text is too long (${v.length} characters, limit ${maxLength})`);
    if (pattern && !pattern.test(v)) fail(path, `"${v.slice(0, 40)}" is not in the expected format`);
    return v;
  };

export const num =
  (min: number, max: number, integer = true): Check<number> =>
  (v, path) => {
    if (typeof v !== "number" || !Number.isFinite(v)) fail(path, `expected a number, found ${describe(v)}`);
    if (integer && !Number.isInteger(v)) fail(path, `expected a whole number, found ${v}`);
    if (v < min || v > max) fail(path, `${v} is outside the allowed range ${min}…${max}`);
    return v;
  };

export const bool: Check<boolean> = (v, path) => {
  if (typeof v !== "boolean") fail(path, `expected true or false, found ${describe(v)}`);
  return v;
};

export const literal =
  <T extends string | number>(expected: T): Check<T> =>
  (v, path) => {
    if (v !== expected) fail(path, `expected ${JSON.stringify(expected)}, found ${JSON.stringify(v)?.slice(0, 40)}`);
    return expected;
  };

export const oneOf =
  <T extends string>(options: readonly T[]): Check<T> =>
  (v, path) => {
    if (typeof v !== "string" || !(options as readonly string[]).includes(v))
      fail(path, `expected one of ${options.join(", ")}; found ${JSON.stringify(v)?.slice(0, 40)}`);
    return v as T;
  };

export const nullValue: Check<null> = (v, path) => {
  if (v !== null) fail(path, `must be null in this version of the file format`);
  return null;
};

export const nullable =
  <T>(inner: Check<T>): Check<T | null> =>
  (v, path) =>
    v === null ? null : inner(v, path);

export const arrayOf =
  <T>(item: Check<T>, maxLength: number): Check<T[]> =>
  (v, path) => {
    if (!Array.isArray(v)) fail(path, `expected a list, found ${describe(v)}`);
    if (v.length > maxLength) fail(path, `list is too long (${v.length} items, limit ${maxLength})`);
    return v.map((x, i) => item(x, `${path}[${i}]`));
  };

/** A list of whole numbers, checked quickly (used for large grids). */
export const intArray =
  (min: number, max: number, maxLength: number): Check<number[]> =>
  (v, path) => {
    if (!Array.isArray(v)) fail(path, `expected a list of numbers, found ${describe(v)}`);
    if (v.length > maxLength) fail(path, `list is too long (${v.length} items, limit ${maxLength})`);
    for (let i = 0; i < v.length; i++) {
      const n = v[i];
      if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max)
        fail(`${path}[${i}]`, `expected a whole number from ${min} to ${max}, found ${JSON.stringify(n)?.slice(0, 20)}`);
    }
    return v as number[];
  };

type Shape = Record<string, Check<unknown>>;
type FromShape<S extends Shape> = { [K in keyof S]: S[K] extends Check<infer T> ? T : never };

/** An object with exactly these keys. Unknown keys are rejected. */
export const object =
  <S extends Shape>(shape: S, optionalKeys: readonly (keyof S)[] = []): Check<FromShape<S>> =>
  (v, path) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) fail(path, `expected a group of fields, found ${describe(v)}`);
    const rec = v as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (!Object.prototype.hasOwnProperty.call(shape, key)) fail(path, `unknown field "${key.slice(0, 40)}"`);
    }
    // Build a fresh plain object so nothing from the file (such as "__proto__") is copied through.
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      const sub = path ? `${path}.${key}` : key;
      if (!Object.prototype.hasOwnProperty.call(rec, key)) {
        if (optionalKeys.includes(key)) continue;
        fail(sub, "this field is missing");
      }
      out[key] = shape[key](rec[key], sub);
    }
    return out as FromShape<S>;
  };

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** An object used as a dictionary of simple values (text, numbers, true/false). */
export const simpleRecord =
  (maxKeys: number, maxTextLength: number): Check<Record<string, string | number | boolean>> =>
  (v, path) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) fail(path, `expected a group of fields, found ${describe(v)}`);
    const keys = Object.keys(v);
    if (keys.length > maxKeys) fail(path, `too many fields (${keys.length}, limit ${maxKeys})`);
    const out: Record<string, string | number | boolean> = Object.create(null);
    for (const key of keys) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || FORBIDDEN_KEYS.has(key))
        fail(path, `field name "${key.slice(0, 40)}" is not allowed`);
      const val = (v as Record<string, unknown>)[key];
      const sub = `${path}.${key}`;
      if (typeof val === "string") out[key] = str(maxTextLength)(val, sub);
      else if (typeof val === "number") out[key] = num(-1e9, 1e9, false)(val, sub);
      else if (typeof val === "boolean") out[key] = val;
      else fail(sub, `expected text, a number or true/false, found ${describe(val)}`);
    }
    return { ...out };
  };

/** An object used as a dictionary whose values all pass the same check (keys are ids). */
export const recordOf =
  <T>(item: Check<T>, maxKeys: number): Check<Record<string, T>> =>
  (v, path) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) fail(path, `expected a group of fields, found ${describe(v)}`);
    const keys = Object.keys(v);
    if (keys.length > maxKeys) fail(path, `too many fields (${keys.length}, limit ${maxKeys})`);
    const out: Record<string, T> = Object.create(null);
    for (const key of keys) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || FORBIDDEN_KEYS.has(key)) fail(path, `field name "${key.slice(0, 40)}" is not allowed`);
      out[key] = item((v as Record<string, unknown>)[key], `${path}.${key}`);
    }
    return { ...out };
  };
