# Changelog

All notable changes to **Message Reader** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.7.2] - 2026-05-18

### Fixed
- **Old messages being re-read repeatedly** — two root causes fixed:
  1. **Key mismatch between seeding and live handling:** startup seeding computed the dedup key from raw extraction output, but `handleNode` applied additional body-cleaning (safety-net strips) before computing its key. If those strips changed the body text the keys differed, so VTF's virtual scroller re-adding a DOM node would bypass the dedup check and re-queue the message. Fixed by extracting a `normalizeMsg()` helper that is called in both places, guaranteeing identical keys.
  2. **`RECENT_MAX` too small:** with a cap of 200, an active session evicted old messages from the dedup set well within a normal trading day. When VTF's virtual scroller re-inserted those DOM nodes they were no longer in the set and were re-read. Cap raised to 5000.

---

## [1.7.1] - 2026-05-17

### Fixed
- **Panel appearing on every browser tab** — `allowedUrls` now defaults to `vtf.t3live.com` instead of empty. Fresh installs only show the panel on the intended site. Users can add more sites via the "Allowed sites" field in settings, or clear it to show on all sites.

---

## [1.7.0] - 2026-05-16

### Added
- **URL allowlist** — new `allowedUrls` setting (textarea in settings panel). Enter URL keywords or patterns (one per line); the panel only mounts on matching sites. Leave empty to show on all sites. Includes an "+ Add this site" button that appends the current hostname in one click.
- **`TS_LEADING` safety-net regex** — strips any bare time (`HH:MM` with or without AM/PM) from the very start of the extracted body, catching timestamps that `TS_BARE` missed because they lacked an AM/PM suffix.
- **Double-announcement safety net in `handleNode`** — after extraction, re-strips the sender name and any leading timestamp from the body before assembling the spoken string.

### Changed
- **Settings panel starts collapsed** — playback controls are always visible; click `▸` in the header to expand settings. Reduces visual noise on load.
- **Rate and Volume sliders are now side by side** (2-column grid), saving vertical space.
- **Four option checkboxes arranged in a 2×2 grid**: Sender name / First name only / Timestamp / Skip own msgs — with shorter labels to fit the compact layout.
- **Checkbox labels shortened**: "Announce sender name" → "Sender name", "First name only (e.g. …)" → "First name only", "Announce timestamp (e.g. …)" → "Timestamp", "Skip my own messages" → "Skip own msgs".
- Removed all `t3live.com` URL references from README, CHANGELOG, CLAUDE.md, and SETUP.md. The project is fully generic.
- CLAUDE.md console probe examples updated to match current panel ID (`msg-reader-panel`) and guard flag (`__messageReaderLoaded`).
- `stripSenderFromStart` extracted as a named helper to avoid duplicated do-while pattern across VTF and generic extractors.

---

## [1.6.0] - 2026-05-14

### Added
- **Generic site support** — now matches `*://*/*`; works on any website, not just VTF. Pick any element on the page as the message container using the "Pick Message Area" button.
- **Generic message extraction** — falls back to `extractMessageGeneric` for non-VTF elements: looks for sender in `<strong>`, `<b>`, and common class-name patterns; strips timestamps; falls back to `"name: body"` splitting.
- **Generic auto-detect heuristics** — `autoDetectChatContainer` now tries common chat/message list CSS class and id patterns when VTF elements are not present.
- **Generic seeding** — when no VTF `app-st-compactmessage` elements exist, seeds existing container children as already-spoken so history is not re-read on startup.
- **Default selector** — pre-filled to the VTF main chat path so VTF users need no manual configuration.

### Changed
- **Project renamed** from `vtf-message-reader` to `message-reader`. Script file renamed to `message-reader.user.js`. Panel title, console prefix, `@name`, `@namespace`, and `localStorage` key updated accordingly.
- Storage key changed from `vtf_reader_config_v1` to `message_reader_config_v1` (existing users will need to re-enter settings once).
- Observer now passes any newly added element to `handleNode`, which routes to VTF-specific or generic extraction automatically.
- UI label "Main Chat container" → "Message container (CSS selector)". "My VTF username" → "My username".
- Picker prompt updated to "Click a message area on the page."
- Ignore-list placeholder no longer contains example names — replaced with "comma-separated usernames".
- Top comment block and internal code comments no longer reference personal example names.

---

## [1.5.0] - 2026-05-13

### Added
- **Ignore list** — comma-separated usernames to skip; matches both full and first names. Includes a quick-add input field.
- **First-name only toggle** — speak "Joshua" instead of "Joshua Lefler" (default: on).
- **Announce timestamp toggle** — optionally prepend "10:57 AM" to spoken text (default: off).
- **Collapsed panel keeps playback controls visible** — settings collapse independently of the playback bar.

### Changed
- Restructured panel HTML into two zones: `.playback` (always visible) and `.settings` (collapsible).
- Skip behavior tightened: introduced a generation counter (`utteranceGen`) so `synth.cancel()` doesn't trigger double-advances via stale `onend` callbacks.
- Message extraction is more aggressive about removing duplicate sender mentions and stray timestamps anywhere in the body.

### Fixed
- "Name announced twice + time twice" issue caused by VTF rendering the sender label in both the avatar tooltip and the visible name.

---

## [1.4.0] - 2026-05-13

### Added
- **Skip button** (`⏭`) — cancels the current message and immediately starts the next queued one.

### Changed
- Playback buttons now disable contextually (Skip is greyed out when nothing is playing or queued).

---

## [1.3.0] - 2026-05-13

### Added
- **Playback controls** — Start (`▶`), Pause (`⏸`), Stop (`⏹`) buttons with state indicator.
- **Queue counter** in the panel header showing pending utterances.
- VTF-specific extraction targeting `<app-st-compactmessage>` components.
- Badge-word filtering (T3TG, ADMIN, MOD, VIP, PRO, OWNER, STAFF, TEAM).

### Changed
- Stop now also disables reading of new incoming messages until Start is pressed (matches media-player conventions).
- Test Voice bypasses the enable flag so users can always verify audio.

### Fixed
- UI chrome strings like "Mention", "Private Chat", "User Info" no longer get read as messages.

---

## [1.2.0] - 2026-05-13

### Added
- Verbose console logging prefixed with `[VTF Reader]` for diagnostics.
- `waitForBody` polling so the script defers all setup until `document.body` exists.
- `!important` on panel positioning to prevent VTF's CSS from hiding the panel.
- Orange border on the panel for visibility.

### Changed
- Script now runs in the top frame only (`@all-frames false`) — previous behavior of injecting into every iframe was causing silent crashes in sub-frames.
- All risky operations wrapped in `try/catch` with explicit error logging.

---

## [1.1.0] - 2026-05-13

### Added
- Site-specific `@match` patterns for the primary target site.
- Auto-detection of the chat container using Angular component patterns and class-name heuristics.
- Retry loop for chat container detection (every 3s until found).
- "Auto-detect" and "Clear Selector" buttons.

### Changed
- MutationObserver now uses `subtree: true` to handle Angular's re-renders of the message feed.

---

## [1.0.0] - 2026-05-13

### Added
- Initial release.
- Generic chat-message reader with text-to-speech using the Web Speech API.
- Visual element picker for manually selecting the message container.
- Voice / rate / volume controls.
- Self-skip filter using configured username.
- Floating draggable control panel with collapse toggle.
- Settings persisted to `localStorage`.

---

[1.7.2]: https://github.com/sbcmsbgithub/message-reader/releases/tag/v1.7.2
[1.7.1]: https://github.com/sbcmsbgithub/message-reader/releases/tag/v1.7.1
[1.7.0]: https://github.com/sbcmsbgithub/message-reader/releases/tag/v1.7.0
[1.6.0]: https://github.com/sbcmsbgithub/message-reader/releases/tag/v1.6.0
[1.5.0]: https://github.com/sbcmsbgithub/message-reader/releases/tag/v1.5.0
[1.4.0]: https://github.com/sbcmsbgithub/message-reader/releases/tag/v1.4.0
[1.3.0]: https://github.com/sbcmsbgithub/message-reader/releases/tag/v1.3.0
[1.2.0]: https://github.com/sbcmsbgithub/message-reader/releases/tag/v1.2.0
[1.1.0]: https://github.com/sbcmsbgithub/message-reader/releases/tag/v1.1.0
[1.0.0]: https://github.com/sbcmsbgithub/message-reader/releases/tag/v1.0.0
