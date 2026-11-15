// Which shell code each flow ran (Chromium's V8 coverage, recorded by shell-e2e.mjs --coverage), so verify.mjs runs
// only the flows that executed a changed function instead of every flow that opens the same screen. Line numbers
// are those of the git tree the coverage was recorded on; verify.mjs diffs from that tree. Pure.

export const SHELL = "custom-modules/mari-kit/shell/";

/** "…/api/mari-kit/app/v/<hash>/lib/x.js" → "custom-modules/mari-kit/shell/lib/x.js" (the shell serves files as-is). */
export function shellPath(url) {
  const m = /\/api\/mari-kit\/app\/(?:v\/[0-9a-f]{12}\/)?([^?#]+\.js)(?:[?#]|$)/.exec(url);
  return m ? SHELL + m[1] : null;
}

/** "/api/mari-kit/memory/abc/organize" → "mari-kit/memory"; other Engine routes → their first segment. */
export function routeOf(url) {
  const m = /\/api\/(mari-kit\/[\w-]+|[\w-]+)/.exec(url);
  return m && !m[1].startsWith("mari-kit/app") ? m[1] : null;
}

function lineStarts(src) {
  const out = [0];
  for (let i = 0; i < src.length; i += 1) if (src.charCodeAt(i) === 10) out.push(i + 1);
  return out;
}
function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Playwright coverage entries → { [path]: { fns: ["s-e"], ran: ["s-e"] } } (1-based lines; every function V8
 * compiled, and the ones that ran). The whole-script range is left out: top-level code counts as "loaded".
 */
export function summarize(entries, into = {}) {
  for (const e of entries) {
    const path = shellPath(e.url);
    if (!path || typeof e.source !== "string") continue;
    const starts = lineStarts(e.source);
    const f = (into[path] ||= { fns: [], ran: [] });
    const fns = new Set(f.fns);
    const ran = new Set(f.ran);
    for (const fn of e.functions || []) {
      const r = fn.ranges?.[0];
      if (!r || (r.startOffset === 0 && r.endOffset >= e.source.length - 1)) continue;
      const key = `${lineOf(starts, r.startOffset)}-${lineOf(starts, r.endOffset)}`;
      fns.add(key);
      if (r.count > 0) ran.add(key);
    }
    f.fns = [...fns];
    f.ran = [...ran];
  }
  return into;
}

/** Did a flow (its recorded files) run the code at these lines of `path`? Lines outside any function: if loaded. */
export function ranLines(files, path, lines) {
  const f = files?.[path];
  if (!f) return false;
  const fns = f.fns.map((k) => [...k.split("-").map(Number), k]);
  const ran = new Set(f.ran);
  for (const line of lines) {
    let best = null;
    for (const fn of fns) if (fn[0] <= line && line <= fn[1] && (!best || fn[1] - fn[0] < best[1] - best[0])) best = fn;
    if (!best || ran.has(best[2])) return true;
  }
  return false;
}

/**
 * `git diff -U0` text → { old, new, cssOld }: changed lines on each side. For code, a pure insertion marks the old
 * lines around it (the function it lands in); cssOld leaves those out (an added rule changes no neighbouring rule).
 */
export function hunkLines(diff) {
  const out = { old: [], new: [], cssOld: [] };
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [a, b, c, d] = [
      Number(m[1]),
      m[2] === undefined ? 1 : Number(m[2]),
      Number(m[3]),
      m[4] === undefined ? 1 : Number(m[4]),
    ];
    if (b) for (let i = 0; i < b; i += 1) (out.old.push(a + i), out.cssOld.push(a + i));
    else out.old.push(a, a + 1);
    if (d) for (let i = 0; i < d; i += 1) out.new.push(c + i);
    else out.new.push(c, c + 1);
  }
  return out;
}

/**
 * The CSS rules these lines belong to → the classes each rule's selectors need, or "all" when a rule has no class
 * (an element, :root, an @-rule): [Set(classes) per selector] | "all".
 */
export function cssSelectors(css, lines) {
  // owner[line]: the selector of the innermost rule the line is in (undefined: blank or comment at the top level).
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const owner = [];
  const stack = [];
  let pending = [];
  let buf = "";
  let line = 1;
  const touch = () => {
    if (stack.length) owner[line] ??= stack[stack.length - 1];
    else if (buf.trim() && !pending.includes(line)) pending.push(line);
  };
  for (const ch of text) {
    if (ch === "{") {
      touch();
      stack.push(buf.trim());
      for (const l of pending) owner[l] = stack[stack.length - 1];
      pending = [];
      owner[line] = stack[stack.length - 1];
      buf = "";
    } else if (ch === "}") {
      touch();
      stack.pop();
      buf = "";
    } else if (ch === "\n") {
      touch();
      line += 1;
      if (stack.length) owner[line] = stack[stack.length - 1];
    } else {
      if (ch === ";") buf = "";
      else buf += ch;
      if (!/\s/.test(ch)) touch();
    }
  }
  const out = [];
  for (const l of lines) {
    const sel = owner[l];
    if (sel === undefined) continue;
    if (!sel || sel.startsWith("@") || sel.startsWith(":root")) return "all";
    for (const one of sel.split(",")) {
      const classes = new Set([...one.matchAll(/\.([\w-]+)/g)].map((m) => m[1]));
      if (!classes.size) return "all";
      out.push(classes);
    }
  }
  return out;
}

/** Shell source text mentions every class of a selector (as a word: "r two" holds r and two). */
export const mentionsAll = (text, classes) =>
  [...classes].every((c) => new RegExp(`(^|[^\\w-])${c.replace(/[-]/g, "\\-")}($|[^\\w-])`).test(text));
