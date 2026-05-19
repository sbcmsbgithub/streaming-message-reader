# CLAUDE.md

Project context for [Claude Code](https://docs.claude.com/en/docs/claude-code). Read this first before making changes.

---

## What this project is

A single-file userscript that reads new chat messages aloud on **any website**. The default container selector targets the Angular-based chat layout used on the primary target site, but the "Pick Message Area" button lets it work on any site. Distributed via Tampermonkey/Violentmonkey. No build step, no package manager, no framework.

The deliverable is **`streaming-message-reader.user.js`** — that is the entire product.

---

## Tech stack

- **Language:** Plain ES6+ JavaScript (no transpilation).
- **Distribution:** [Tampermonkey](https://www.tampermonkey.net/) userscript metadata block (`// ==UserScript== … // ==/UserScript==`).
- **Browser APIs:**
  - `MutationObserver` — for detecting new chat messages.
  - `SpeechSynthesis` (Web Speech API) — for text-to-speech.
  - `localStorage` — for persisting user settings.
- **No dependencies.** No npm, no bundler, no transpiler. Ship the file as-is.
- **No tests.** The script runs in a live browser against a third-party site; testing means loading it in Tampermonkey and observing behavior on the target site.

---

## Primary target site DOM structure

The primary target site is an **Angular Single Page Application**. The page shell (`index.html`) is just `<app-root></app-root>`; everything else is rendered at runtime by a bundled JavaScript file (`main.<hash>.js`).

### Critical DOM elements we rely on

| Element | Role |
|---|---|
| `<app-st-compactmessage>` | Wraps each individual chat message. The unit we observe and extract from. |
| `<app-roomscroller>` | The scrollable container that holds all `<app-st-compactmessage>` children. This is the MutationObserver target. |
| Sender element (varies) | An element inside `<app-st-compactmessage>` with class names matching `*sender*`, `*author*`, `*username*`, `*user-name*`, `*display-name*`, `*name*`, or a `<strong>`/`<b>` tag. |

### Message format in the DOM

Each message renders visually as:

```
[6:05 PM]  Alice Smith  ADMIN  hello everyone
```

Components:
- **Timestamp** in brackets: `[6:05 PM]` (sometimes appears unbracketed as `6:05 PM`).
- **Date stamp**: e.g. `May 18` — injected by the chat UI into the element's `innerText`.
- **Sender** display name: `Alice Smith` (first + last, sometimes single name).
- **Badges**: Short pills like `ADMIN`, `MOD`, `VIP`, `PRO`, `OWNER`, `STAFF`, `TEAM`. Currently treated as noise.
- **Body**: The actual message text. The chat UI may also prefix the body with `"FirstName: "`.

The DOM order of these elements within `<app-st-compactmessage>` is **not** guaranteed to match the visual order — different rendering paths put the sender in the avatar tooltip AND in the visible label, which is why the extractor strips the sender from the body **repeatedly** (see `extractMessageFromRoot` in the script).

---

## Architecture

The entire script lives inside one IIFE in `streaming-message-reader.user.js`. Sections (in order they appear):

1. **Boot & guards** — `__streamingMessageReaderLoaded` to prevent double-injection; `waitForBody` to defer until DOM exists.
2. **Config** — Defaults object, `localStorage` load/save (key: `message_reader_config_v1`).
3. **Speech + playback state machine** — States: `idle` / `playing` / `paused` / `stopped`. Queue array. **Generation counter** (`utteranceGen`) to invalidate stale `onend` callbacks when the user skips or stops.
4. **Extraction** (`extractMessageFromRoot`) — Angular-specific parsing logic. See "Extraction strategy" below.
5. **Container detection** (`autoDetectChatContainer`) — Prefers `app-roomscroller`; falls back to walking up from any `app-st-compactmessage` to find a common ancestor.
6. **Observer + dedupe** — MutationObserver with a 5000-entry recent-spoken set keyed by `sender|body`.
7. **Element picker** — Click-to-select fallback if auto-detection fails. Builds a CSS selector using id/class/nth-of-type.
8. **UI panel** — Vanilla HTML/CSS injected into `document.body`. Two zones:
   - **`.playback`** — Always visible: state indicator + Start/Pause/Skip/Stop buttons.
   - **`.settings`** — Hidden when `panel.classList.contains('collapsed')`.
9. **Mount + event wiring** — `mountUI()`.

### Extraction strategy

The Angular SPA's DOM duplicates the sender name in some renderings (avatar tooltip + visible label). The extractor handles this with three passes:

1. **Get sender from DOM** via selector matching `*sender*`, `*author*`, `*username*`, etc.
2. **Capture the first timestamp** seen anywhere in `innerText` (for the optional "announce time" feature).
3. **Aggressive cleanup of the body**:
   - Strip ALL timestamps (bracketed and bare) via `TS_BRACKET` and `TS_BARE`.
   - Strip date stamps (e.g. `May 18`) via `DATE_RE`.
   - Strip sender name from the body using `stripSenderFromStart` (full name, then first name).
   - Strip leading badge words (`ADMIN`, etc.) using the `BADGE_WORDS` Set.
   - Fallback: `"Name: body"` regex if the DOM-based sender extraction failed.
4. **`normalizeMsg()`** — final cleanup pass applied to all messages before the dedup key is computed: date strip, sender strip (full + first name), leading timestamp strip, and a catch-all `"Name: "` prefix strip.
5. **Apply first-name-only** if `config.firstNameOnly` is true — splits sender on whitespace and keeps only the first word.

Return shape: `{ fullSender, sender, body, timeText }` where:
- `fullSender` — full name (used for ignore-list matching, never changes).
- `sender` — display name (first name only if config says so; used for speaking).
- `body` — cleaned message text.
- `timeText` — extracted timestamp, e.g. `"10:57 AM"` (empty if none found).

### Spoken output construction

In `handleNode`, the spoken string is assembled from parts:

```js
const parts = [];
if (config.announceTime && msg.timeText) parts.push(msg.timeText);
if (config.readSender && msg.sender)     parts.push(msg.sender + ':');
parts.push(msg.body);
const spoken = parts.join(' ').replace(URL_RE, 'URL posted').replace(/\s+/g, ' ').trim();
```

So toggling features just adds/removes parts — no special-case branching. URLs are always replaced with "URL posted".

### Skip semantics (subtle)

`synth.cancel()` triggers `onend` on the currently-speaking utterance, which would normally cause our handler to auto-advance to the next queued item. If we *also* manually call `playNext()` after canceling, we'd double-advance.

**Solution:** every utterance is tagged with `myGen = ++utteranceGen`. The `onend` handler short-circuits if `myGen !== utteranceGen` (i.e., it has been superseded). `ctrlSkip()` / `ctrlStop()` / disabling the script via the checkbox all bump `utteranceGen` before calling `synth.cancel()`.

---

## Code conventions used in this file

- **Single IIFE.** Everything is inside `(function () { 'use strict'; … })()` to keep the global namespace clean.
- **`LOG` / `ERR` helpers** at the top — every notable action logs `[Streaming Message Reader] …` to the console for debuggability.
- **Defensive `try/catch`** around anything that touches the DOM, `localStorage`, or `speechSynthesis`. The script must never throw in a way that breaks the host page.
- **Config is the single source of truth.** UI hydrates from config on mount; any UI change writes back to config and `saveConfig()`s immediately.
- **`!important` on panel positioning** — host-page CSS can aggressively override our panel's position; `!important` keeps it pinned.
- **No external resources.** No CDN imports, no remote fonts. Everything inline so the script works offline / in restricted environments.

---

## Configuration schema

Stored in `localStorage` under key `message_reader_config_v1`. Defaults defined in `main()`:

```js
{
  enabled: false,           // master switch for queueing new messages
  allowedUrls: 'vtf.t3live.com', // URL patterns; empty = all sites
  selector: '',             // CSS selector for the chat container (empty = auto-detect)
  rate: 1.0,                // speech rate (0.5 – 2.0)
  pitch: 1.0,               // speech pitch (0 – 2)
  volume: 1.0,              // speech volume (0 – 1)
  voiceURI: '',             // selected SpeechSynthesisVoice.voiceURI
  readSender: false,        // prepend sender name to spoken text
  firstNameOnly: true,      // "Alice Smith" → "Alice"
  announceTime: false,      // prepend timestamp to spoken text
  skipOwnMessages: true,    // filter using `myUsername`
  myUsername: '',           // user's own display name
  ignoreUsers: '',          // comma-separated list of usernames to skip
  maxLength: 400,           // truncate spoken text past this many chars
}
```

When adding new config fields, **always update `defaults`** so existing users get the new field merged in on load.

---

## How to make changes

1. Edit `streaming-message-reader.user.js`.
2. **Bump the `// @version` field** in the metadata block (semver — patch for bugfix, minor for feature, major for breaking).
3. **Add an entry to `CHANGELOG.md`** with the new version, the date, and a bulleted list of changes.
4. **Test on a live session**:
   - Open Tampermonkey dashboard → edit the installed script → paste the new contents → save.
   - Hard refresh the target tab (`Ctrl+Shift+R`).
   - Open DevTools console; look for `[Streaming Message Reader] UI mounted.` and any errors.
   - Verify the panel renders correctly.
   - Verify a new message gets read aloud as expected.
   - Verify Start/Pause/Skip/Stop all work.
   - Test the ignore list with at least one entry.
5. Commit, push, open PR.

### Useful console probes during testing

```js
// Is the script loaded?
window.__streamingMessageReaderLoaded

// Is the panel mounted?
document.getElementById('msg-reader-panel')

// Inspect current config:
JSON.parse(localStorage.getItem('message_reader_config_v1'))

// Reset config:
localStorage.removeItem('message_reader_config_v1'); location.reload();
```

---

## Important constraints

- **Single file.** Don't split into modules. Tampermonkey loads one .user.js — anything else is friction for end users.
- **No network calls.** The script must not phone home, fetch fonts, or load external CSS. Everything inline.
- **No frameworks.** No jQuery, React, Vue, etc. Vanilla DOM only.
- **No bundler.** No npm, no webpack, no rollup. The source file IS the artifact.
- **Don't break the host page.** Wrap risky operations in try/catch. The script runs inside someone's active browser session; it must never throw an uncaught error that could destabilize the page.
- **Use `allowedUrls` to restrict activation.** The `@match` is `*://*/*` so Tampermonkey can inject everywhere, but configure `allowedUrls` to limit which sites the panel actually mounts on.

---

## Known limitations / future work

These are NOT bugs to "fix" without discussion — they're known tradeoffs:

- **Chrome speech synthesis 15-second cutoff** — known browser bug where long utterances get truncated. Could be worked around by chunking long messages and queueing the pieces. Current `maxLength: 400` mitigates this in practice.
- **Voice list depends on the OS.** Windows has limited voices; macOS / Linux have more. We don't ship voices.
- **`app-st-compactmessage` is the only Angular message component we handle.** Other message types (system messages, polls, images) are silently ignored.
- **Picker doesn't survive Angular re-renders perfectly.** The manual selector picker builds a CSS path from id/class/nth-of-type, but Angular's hashed class names can shift between deployments. Auto-detect (which keys off the stable `app-roomscroller` tag) is more durable; recommend users clear the manual selector if a site update breaks things.
- **No keyboard shortcuts.** Could add hotkeys (e.g., space to pause, → to skip) — has been requested informally.

---

## Files in this repo

```
streaming-message-reader/
├── README.md                                — user-facing docs
├── CLAUDE.md                                — this file (project context for Claude Code)
├── CHANGELOG.md                             — version history
├── LICENSE                                  — MIT
├── .gitignore                               — standard
└── streaming-message-reader.user.js         — the entire product
```

---

## When in doubt

- The shipped product is **one file**. Resist the urge to refactor into multiple files.
- Userscripts are read by humans pasting them into Tampermonkey. Optimize for **readability of the single file** over architectural cleanliness.
- When the target site's DOM changes, prefer fixing the **selector** or **extraction** logic over adding new abstraction.
- Be conservative. Bugs that crash the script or spam audio disrupt the user's active session.
