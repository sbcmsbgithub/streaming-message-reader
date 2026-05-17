# Message Reader

A Tampermonkey/Violentmonkey userscript that reads new chat messages aloud on **any website** using the browser's built-in text-to-speech, with a floating control panel for playback (Start / Pause / Skip / Stop) and per-user filtering.

The default container selector targets the Angular-based chat layout used on the primary site, so users of that site need zero manual configuration.

---

## Features

- **Works on any website** — use the "Pick Message Area" button to select any element on any page as the message source
- **Live chat narration** — new messages are spoken as they arrive
- **Playback controls** — Start, Pause, Skip current message, Stop (clears the queue)
- **Smart sender formatting** — extracts sender and body from common DOM patterns (`<strong>`, `<b>`, class-name hints, `name: body` fallback)
- **Optional first-name only** — "Alice Smith" → "Alice"
- **Optional timestamp announcement** — toggle whether to read "10:57 AM" out loud
- **Ignore list** — comma-separated usernames to skip (matches full or first name)
- **Skip-own-messages** — don't read messages you yourself sent
- **Voice / rate / volume picker** — uses any voice installed in your OS
- **Collapsible UI** — playback controls remain visible while settings collapse
- **Draggable panel** — move it out of the way
- **Persistent config** — settings saved to `localStorage`, survive page reloads
- **Live queue counter** — see how many messages are waiting to be read

---

## Installation

1. Install **[Tampermonkey](https://www.tampermonkey.net/)** (Chrome / Edge / Firefox / Safari) or **[Violentmonkey](https://violentmonkey.github.io/)**.
2. Open the Tampermonkey dashboard.
3. Click **+ → Create a new script**.
4. Delete the template code.
5. Paste the contents of [`message-reader.user.js`](./message-reader.user.js).
6. Save (`Ctrl+S`).
7. Open the target site. The orange-bordered **Message Reader** panel appears in the top-right corner.

---

## Usage

### Quick start
1. Click **Test Voice** to confirm audio works.
2. (Optional) Click **Pick Message Area** and click the chat message list to lock in the exact DOM selector. Auto-detect handles this automatically for common chat patterns.
3. Click **▶ Start**.

New messages in the watched container will be spoken as they arrive.

### Playback controls

| Button | Behavior |
|---|---|
| **▶ Start** | Begins reading new messages. If paused, resumes. |
| **⏸ Pause** | Pauses the current utterance. Queue is preserved. |
| **⏭ Skip** | Cancels the current message and immediately starts the next queued message. |
| **⏹ Stop** | Cancels current utterance, clears the queue, ignores incoming messages until Start. |

### Settings

| Setting | Default | Description |
|---|---|---|
| Read new messages as they arrive | off | Master toggle for queueing new messages |
| First name only | on | Read "Alice" instead of "Alice Smith" |
| Announce sender name | on | Prepend the sender to every message |
| Announce timestamp | off | Prepend "10:57 AM" to every message |
| Skip my own messages | on | Combined with "My username" below |
| My username | empty | Your display name, used for the self-skip filter |
| Skip messages from these users | empty | Comma-separated ignore list (matches full or first name) |
| Voice / Rate / Volume | system default / 1.0 / 1.0 | Standard text-to-speech parameters |

---

## How it works

1. Locates the chat container (uses the configured CSS selector, then auto-detects, then falls back to the element picker).
2. Attaches a `MutationObserver` to that container with `subtree: true`.
3. When new nodes are added, tries Angular-specific extraction (`<app-st-compactmessage>`) first, then falls back to generic extraction.
4. Generic extraction: finds sender in `<strong>`, `<b>`, or elements with common class names; strips timestamps; falls back to `name: body` splitting.
5. De-duplicates against a 200-entry recent-messages buffer.
6. Filters using the ignore list / self-skip.
7. Builds the spoken string: `[time] FirstName: message` (parts individually toggleable).
8. Pushes onto a queue and feeds the browser's `SpeechSynthesis` one utterance at a time.

A generation counter invalidates pending `onend` callbacks when the user hits Skip or Stop, so playback control is always precise.

---

## Browser support

- **Chrome / Edge** — fully supported (recommended).
- **Firefox** — supported; voice list may be smaller.
- **Safari** — supported with caveats; speech rate behavior differs.

Requires the Web Speech API (`window.speechSynthesis`), available in all modern browsers.

---

## Known limitations

- Voice availability depends on your OS. Windows ships with "Microsoft David" / "Microsoft Zira"; macOS has many more.
- Chrome stops speech synthesis after ~15 seconds of continuous audio in some versions — usually fine since individual messages are short.
- On Angular SPAs, Angular component names can change between builds. The manual **Pick Message Area** button always works as a fallback.
- The script runs in the top frame only (`@all-frames false`).

---

## Development

Single-file userscript — no build step required.

```bash
git clone https://github.com/sbcmsbgithub/message-reader.git
cd message-reader

# Edit
vim message-reader.user.js

# Test: paste the updated source into Tampermonkey's editor and reload the target tab.
```

See [`CLAUDE.md`](./CLAUDE.md) for in-depth project context (architecture, DOM specifics, extraction strategy) — useful when iterating with Claude Code.

---

## Contributing

Pull requests welcome. Please:

1. Bump the `// @version` field in the userscript header following [semver](https://semver.org/).
2. Add an entry to [`CHANGELOG.md`](./CHANGELOG.md).
3. Test on a live session before submitting.

---

## License

[MIT](./LICENSE)

---

## Acknowledgments

- The Tampermonkey project for making userscripts trivial to install.
