# VTF Message Reader

A Tampermonkey/Violentmonkey userscript that reads incoming **VTF (Virtual Trading Floor — [vtf.t3live.com](https://vtf.t3live.com/))** Main Chat messages aloud using the browser's built-in text-to-speech, with a floating control panel for playback (Start / Pause / Skip / Stop) and per-user filtering.

Built for traders who want to keep eyes on charts while still hearing the room.

---

## Features

- **Live chat narration** — new messages in the VTF Main Chat are spoken as they arrive
- **Playback controls** — Start, Pause, Skip current message, Stop (clears the queue)
- **Smart sender formatting** — reads "Joshua: I shorted some $AMD" instead of "[10:57 AM] Joshua Lefler T3TG Joshua Lefler I shorted..."
- **Optional first-name only** — "Joshua Lefler" → "Joshua"
- **Optional timestamp announcement** — toggle whether to read "10:57 AM" out loud
- **Ignore list** — comma-separated usernames to skip (matches full or first name)
- **Skip-own-messages** — don't read messages you yourself sent
- **Voice / rate / volume picker** — uses any voice installed in your OS
- **Collapsible UI** — playback controls remain visible while settings collapse
- **Draggable panel** — move it out of the way of the trading UI
- **Persistent config** — settings saved to `localStorage`, survive page reloads
- **Live queue counter** — see how many messages are waiting to be read

---

## Installation

1. Install **[Tampermonkey](https://www.tampermonkey.net/)** (Chrome / Edge / Firefox / Safari) or **[Violentmonkey](https://violentmonkey.github.io/)**.
2. Open the Tampermonkey dashboard.
3. Click **+ → Create a new script**.
4. Delete the template code.
5. Paste the contents of [`vtf-message-reader.user.js`](./vtf-message-reader.user.js).
6. Save (`Ctrl+S`).
7. Open [https://vtf.t3live.com/](https://vtf.t3live.com/) and log in.
8. The orange-bordered **VTF Reader** panel appears in the top-right corner.

---

## Usage

### Quick start
1. Click **Test Voice** to confirm audio works.
2. (Optional) Click **Pick Message Area** and click the Main Chat message list — locks in the exact DOM selector. Auto-detect usually handles this automatically.
3. Click **▶ Start**.

That's it. New messages in Main Chat will be spoken as they arrive.

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
| First name only | on | Read "Joshua" instead of "Joshua Lefler" |
| Announce sender name | on | Prepend the sender to every message |
| Announce timestamp | off | Prepend "10:57 AM" to every message |
| Skip my own messages | on | Combined with "My VTF username" below |
| My VTF username | empty | Your name, used for the self-skip filter |
| Skip messages from these users | empty | Comma-separated ignore list (matches full or first name) |
| Voice / Rate / Volume | system default / 1.0 / 1.0 | Standard text-to-speech parameters |

---

## How it works

VTF is an Angular SPA. Each chat message is rendered inside an `<app-st-compactmessage>` custom element, and the scrollable container is `<app-roomscroller>`. The script:

1. Locates the chat container (auto-detects or via manual picker).
2. Attaches a `MutationObserver` to that container with `subtree: true`.
3. When new nodes are added, finds any `app-st-compactmessage` inside them.
4. Extracts the timestamp, sender, badges (T3TG, ADMIN, etc.), and message body.
5. Strips noise (badges, duplicate sender mentions, timestamps where the user doesn't want them).
6. De-duplicates against a 200-entry recent-messages buffer (Angular re-renders nodes; we don't want to re-read).
7. Filters using the ignore list / self-skip.
8. Builds the spoken string: `[time] FirstName: message` (parts toggleable).
9. Pushes onto a queue and feeds the browser's `SpeechSynthesis` one utterance at a time.

A generation counter invalidates pending `onend` callbacks when the user hits Skip or Stop, so playback control is always precise.

---

## Browser support

- **Chrome / Edge** — fully supported (recommended).
- **Firefox** — supported; voice list may be smaller.
- **Safari** — supported with caveats; speech rate behavior differs.

Requires the Web Speech API (`window.speechSynthesis`), which is available in all modern browsers.

---

## Known limitations

- Voice availability depends on your OS. Windows ships with "Microsoft David" / "Microsoft Zira"; macOS has many more voices.
- Speech synthesis on Chrome stops after ~15 seconds of continuous speech in some versions — usually not an issue because each message is short, but very long messages may cut off.
- VTF's Angular component names (`app-st-compactmessage`, `app-roomscroller`) are hashed by the build system. If T3 Trading Group rebuilds the site with different component names, the script's auto-detection may need updating — the manual **Pick Message Area** button will still work as a fallback.
- The script runs in the top frame only. If T3 ever moves chat into a cross-origin iframe, the script will need a permissions update.

---

## Development

This project is a single-file userscript. No build step required.

```bash
# Clone
git clone https://github.com/YOUR-USERNAME/vtf-message-reader.git
cd vtf-message-reader

# Edit
vim vtf-message-reader.user.js

# Test by pasting the updated source into Tampermonkey's editor and reloading the VTF tab.
```

See [`CLAUDE.md`](./CLAUDE.md) for in-depth project context (architecture, DOM specifics, extraction strategy, etc.) — useful if you're iterating with Claude Code.

---

## Contributing

Pull requests welcome. Please:

1. Bump the `// @version` field in the userscript header following [semver](https://semver.org/).
2. Add an entry to [`CHANGELOG.md`](./CHANGELOG.md).
3. Test on a live VTF session before submitting.

---

## License

[MIT](./LICENSE)

---

## Acknowledgments

- T3 Live for building VTF.
- The Tampermonkey project for making userscripts trivial to install.
