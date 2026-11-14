// Finds names the shell uses but never defines or imports (a missing import only breaks when that screen draws,
// so parsing alone misses it). ESLint's no-undef over shell/ and tests/, with Node's globals plus the browser's.
// verify.mjs runs it in "Files parse, no undefined names"; by hand: node undefined-names.mjs <file>…

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../../../", import.meta.url).pathname;
const { Linter } = createRequire(join(root, "package.json"))("eslint");

// The browser names the shell can use without importing them; Node's come from globalThis.
const BROWSER = `window self document navigator location history localStorage sessionStorage indexedDB caches screen
visualViewport devicePixelRatio innerWidth innerHeight scrollX scrollY scrollTo scrollBy open close print focus blur
alert confirm prompt getComputedStyle getSelection matchMedia requestAnimationFrame cancelAnimationFrame
requestIdleCallback cancelIdleCallback createImageBitmap Image Audio Option HTMLElement HTMLInputElement
HTMLTextAreaElement HTMLImageElement HTMLVideoElement HTMLAudioElement HTMLCanvasElement HTMLSelectElement Element
Node NodeFilter Text DocumentFragment Range Selection DOMParser XMLSerializer CSS CSSStyleSheet FileReader FileList
DataTransfer ClipboardItem IntersectionObserver ResizeObserver MutationObserver PointerEvent KeyboardEvent MouseEvent
TouchEvent InputEvent FocusEvent UIEvent WheelEvent StorageEvent PopStateEvent HashChangeEvent ErrorEvent
EventSource WebSocket XMLHttpRequest Notification speechSynthesis SpeechSynthesisUtterance MediaRecorder MediaSource
MediaStream AudioContext OfflineAudioContext webkitAudioContext OffscreenCanvas ImageData ImageBitmap Path2D
SpeechRecognition webkitSpeechRecognition customElements trustedTypes origin isSecureContext frames parent top
opener name status onload onerror addEventListener removeEventListener dispatchEvent`.split(/\s+/);
const globals = Object.fromEntries([...Object.getOwnPropertyNames(globalThis), ...BROWSER].map((n) => [n, "readonly"]));

const linter = new Linter();
const config = {
  languageOptions: { ecmaVersion: "latest", sourceType: "module", globals },
  rules: { "no-undef": "error" },
};

/** ["file:line  'x' is not defined.", …] for the given files (paths relative to the repository or absolute). */
export async function undefinedNames(files) {
  const out = [];
  for (const f of files) {
    const text = await readFile(f.startsWith("/") ? f : join(root, f), "utf8");
    for (const m of linter.verify(text, config, { filename: f })) out.push(`${f}:${m.line}  ${m.message}`);
  }
  return out;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const out = await undefinedNames(process.argv.slice(2));
  for (const line of out) console.log(line);
  process.exit(out.length ? 1 : 0);
}
