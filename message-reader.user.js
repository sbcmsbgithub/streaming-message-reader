// ==UserScript==
// @name         Message Reader
// @namespace    https://github.com/sbcmsbgithub/message-reader
// @version      1.7.5
// @description  Reads chat messages aloud on configured sites. Pick any element as the watched container. Includes playback controls, ignore list, voice/rate/volume settings, and time/first-name options.
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// @all-frames   false
// ==/UserScript==

/*
 * Message Reader (v1.7)
 * --------------------------
 *  • Only activates on sites listed in the "Allowed sites" setting.
 *  • Works on any website — pick any element as the watched container.
 *  • Spoken format:  "<FirstName>: <message>"
 *  • Time and sender-name announcement are individually toggleable.
 *  • First-name only by default, can be toggled.
 *  • Playback controls: ▶ Start / ⏸ Pause / ⏭ Skip / ⏹ Stop  (always visible).
 *  • Settings (voice, rate, volume, ignore list…) collapse independently.
 *  • Ignore list = comma-separated usernames (matched on full or first name).
 *  • Skip cancels the current utterance and immediately moves to the next one.
 */

(function () {
  'use strict';

  const LOG = (...a) => console.log('[Message Reader]', ...a);
  const ERR = (...a) => console.error('[Message Reader]', ...a);

  if (window.__messageReaderLoaded) { LOG('Already loaded.'); return; }
  window.__messageReaderLoaded = true;

  function waitForBody(cb, tries = 0) {
    if (document.body) cb();
    else if (tries < 100) setTimeout(() => waitForBody(cb, tries + 1), 100);
    else ERR('document.body never appeared.');
  }
  waitForBody(() => { try { main(); } catch (e) { ERR('Fatal:', e); } });

  function main() {
    // -------------------------------------------------------------------------
    // Config
    // -------------------------------------------------------------------------
    const STORAGE_KEY = 'message_reader_config_v1';
    const defaults = {
      enabled: false,
      allowedUrls: 'vtf.t3live.com', // default site; add more patterns (one per line) or clear to show everywhere
      selector: 'as-split-area.alert-chat-box.as-split-area:nth-of-type(1) > as-split.as-percent.as-vertical > as-split-area.chat-box.as-split-area:nth-of-type(2) > app-chat > div.chat.d-flex > app-roomscroller',
      rate: 1.0, pitch: 1.0, volume: 1.0,
      voiceURI: '',
      readSender: false,
      firstNameOnly: true,
      announceTime: false,
      skipOwnMessages: true,
      myUsername: '',
      ignoreUsers: '',
      maxLength: 400,
    };
    let config;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      config = raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
    } catch { config = { ...defaults }; }

    const saveConfig = () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch {}
    };

    // -------------------------------------------------------------------------
    // URL allowlist gate — skip mounting entirely on non-allowed sites
    // -------------------------------------------------------------------------
    function isCurrentUrlAllowed() {
      const list = config.allowedUrls;
      if (!list || !list.trim()) return true; // empty = allow all sites
      const href = window.location.href;
      return list.split(/[\n,]/).map(s => s.trim()).filter(Boolean).some(pattern => {
        try { return new RegExp(pattern, 'i').test(href); } catch { return href.includes(pattern); }
      });
    }

    if (!isCurrentUrlAllowed()) {
      LOG('Not on an allowed URL — panel not mounted. Add this site via the allowed-sites setting on a permitted page.');
      return;
    }

    // -------------------------------------------------------------------------
    // Speech + playback
    // -------------------------------------------------------------------------
    const synth = window.speechSynthesis || null;
    let voices = [];
    let playbackState = 'idle';   // 'idle' | 'playing' | 'paused' | 'stopped'
    const queue = [];
    // Generation counter — every time we manually skip / cancel an utterance,
    // we bump this so the previous utterance's onend handler knows it has
    // been superseded and shouldn't auto-advance.
    let utteranceGen = 0;

    function loadVoices() {
      try { voices = synth ? (synth.getVoices() || []) : []; populateVoiceDropdown(); }
      catch (e) { ERR('loadVoices failed:', e); }
    }
    if (synth) {
      loadVoices();
      try { synth.onvoiceschanged = loadVoices; } catch {}
    }

    function enqueueSpeak(text) {
      if (!synth || !text) return;
      if (playbackState === 'stopped') return;
      queue.push(text);
      LOG(`queued (${queue.length}):`, text);
      if (playbackState === 'idle') playNext();
      updatePlaybackUI();
    }

    function playNext() {
      if (!synth) return;
      if (playbackState === 'paused' || playbackState === 'stopped') return;
      const next = queue.shift();
      if (!next) {
        playbackState = 'idle';
        updatePlaybackUI();
        return;
      }
      playbackState = 'playing';
      updatePlaybackUI();

      const myGen = ++utteranceGen;
      const u = new SpeechSynthesisUtterance(next);
      u.rate   = clamp(config.rate, 0.5, 2);
      u.pitch  = clamp(config.pitch, 0, 2);
      u.volume = clamp(config.volume, 0, 1);
      const v = voices.find(v => v.voiceURI === config.voiceURI);
      if (v) u.voice = v;

      u.onend = () => {
        if (myGen !== utteranceGen) return;
        if (playbackState === 'playing') playNext();
      };
      u.onerror = (e) => {
        LOG('utterance error:', e?.error || e);
        if (myGen !== utteranceGen) return;
        if (playbackState === 'playing') playNext();
      };
      try { synth.speak(u); } catch (e) { ERR('speak failed:', e); }
    }

    function ctrlStart() {
      if (!synth) return;
      if (playbackState === 'paused') {
        try { synth.resume(); } catch {}
        playbackState = 'playing';
      } else if (playbackState === 'stopped' || playbackState === 'idle') {
        playbackState = 'idle';
        playNext();
      }
      config.enabled = true; saveConfig();
      refreshEnabledCheckbox();
      updatePlaybackUI();
      setStatus('Playback started.');
    }
    function ctrlPause() {
      if (!synth) return;
      if (playbackState === 'playing') {
        try { synth.pause(); } catch {}
        playbackState = 'paused';
        updatePlaybackUI();
        setStatus('Paused.');
      }
    }
    function ctrlSkip() {
      if (!synth) return;
      utteranceGen++;
      try { synth.cancel(); } catch {}
      if (playbackState === 'paused') {
        playbackState = 'paused';
        setStatus(queue.length ? 'Skipped (still paused).' : 'Skipped. Queue empty.');
      } else {
        playbackState = 'idle';
        if (queue.length) {
          setStatus('Skipped to next message.');
          playNext();
        } else {
          setStatus('Skipped. Queue empty.');
        }
      }
      updatePlaybackUI();
    }
    function ctrlStop() {
      if (!synth) return;
      utteranceGen++;
      try { synth.cancel(); } catch {}
      queue.length = 0;
      playbackState = 'stopped';
      config.enabled = false; saveConfig();
      refreshEnabledCheckbox();
      updatePlaybackUI();
      setStatus('Stopped. New messages will be ignored until Start.');
    }

    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));

    // -------------------------------------------------------------------------
    // Message extraction (VTF-specific + generic fallback)
    // -------------------------------------------------------------------------
    const BADGE_WORDS = new Set([
      'T3TG', 'ADMIN', 'MOD', 'MODERATOR', 'VIP', 'PRO', 'OWNER',
      'STAFF', 'TEAM', 'T3', 'LIVE'
    ]);

    const TS_BRACKET = /\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*\]/gi;
    const TS_BARE    = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\b/gi;
    // Strips a bare time (with or without AM/PM) anchored to the very start of a string —
    // used as a safety-net pass after the main timestamp stripping.
    const TS_LEADING = /^\[?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\]?\s*/i;
    // Matches http/https URLs and bare www. links — replaced with "URL posted" before speaking.
    const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
    // Matches date stamps like "May 18" or "May 18, 2026" injected by the chat UI into
    // the element's innerText — stripped from the body before speaking.
    const DATE_RE = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s*\d{4})?\b/gi;

    function getMessageRoot(node) {
      if (!(node instanceof HTMLElement)) return null;
      if (node.tagName && node.tagName.toLowerCase() === 'app-st-compactmessage') return node;
      return node.closest && node.closest('app-st-compactmessage');
    }

    function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function stripSenderFromStart(body, sender) {
      if (!sender) return body;
      // \W* after the name absorbs any separator (colon, dash, space, etc.)
      // without restricting to a narrow character class.
      const re = new RegExp('^' + escapeRegex(sender) + '\\W*', 'i');
      let prev;
      do { prev = body; body = body.replace(re, '').trim(); } while (body !== prev);
      return body;
    }

    function extractMessageFromRoot(root) {
      if (!root) return null;

      let sender = '';
      const senderEl = root.querySelector(
        '[class*="sender" i], [class*="author" i], [class*="username" i], ' +
        '[class*="user-name" i], [class*="display-name" i], [class*="name" i], strong, b'
      );
      if (senderEl) {
        const t = (senderEl.innerText || '').trim();
        if (t && t.length < 80 && !BADGE_WORDS.has(t.toUpperCase())) {
          sender = t.replace(/[:·|>]+$/, '').trim();
        }
      }

      let raw = (root.innerText || '').replace(/ /g, ' ');
      let timeText = '';
      const tsMatch = raw.match(TS_BRACKET) || raw.match(TS_BARE);
      if (tsMatch && tsMatch.length) {
        timeText = tsMatch[0].replace(/[\[\]]/g, '').trim();
      }

      let body = raw.replace(TS_BRACKET, ' ')
                    .replace(TS_BARE, ' ')
                    .replace(DATE_RE, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
      // Safety-net: strip any leading bare time that TS_BARE missed (no AM/PM suffix).
      body = body.replace(TS_LEADING, '').trim();
      if (!body) return null;

      body = stripSenderFromStart(body, sender);
      // Also strip first-name only — VTF can format the body as "FirstName: message"
      // even when the sender element contains the full name.
      const senderFirst = sender.split(/\s+/)[0];
      if (senderFirst !== sender) body = stripSenderFromStart(body, senderFirst);

      // Strip leading badge words.
      let words = body.split(/\s+/);
      while (words.length && BADGE_WORDS.has(words[0].toUpperCase())) words.shift();
      body = words.join(' ').trim();

      // Fallback: "Name: body" if DOM-based sender extraction failed.
      if (!sender) {
        const m = body.match(/^\s*([^:\n]{1,60}):\s*(.+)/s);
        if (m && !BADGE_WORDS.has(m[1].trim().toUpperCase())) {
          sender = m[1].trim();
          body = m[2].trim();
        }
      }

      if (!body) return null;
      if (body.length > config.maxLength) body = body.slice(0, config.maxLength) + '…';

      if (!sender && body.length < 2) return null;
      if (!sender && BADGE_WORDS.has(body.toUpperCase())) return null;

      const fullSender = sender;
      let spokenSender = sender;
      if (config.firstNameOnly && spokenSender) {
        spokenSender = spokenSender.split(/\s+/)[0];
      }

      return { fullSender, sender: spokenSender, body, timeText };
    }

    function extractMessageGeneric(node) {
      if (!node) return null;
      const raw = (node.innerText || node.textContent || '')
        .replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      if (!raw || raw.length < 2) return null;

      let sender = '';
      const senderEl = node.querySelector(
        'strong, b, [class*="sender" i], [class*="author" i], ' +
        '[class*="username" i], [class*="user-name" i], [class*="display-name" i], [class*="name" i]'
      );
      if (senderEl) {
        const t = (senderEl.innerText || '').trim();
        if (t && t.length < 80) sender = t.replace(/[:·|>]+$/, '').trim();
      }

      let timeText = '';
      const tsMatch = raw.match(TS_BRACKET) || raw.match(TS_BARE);
      if (tsMatch && tsMatch.length) timeText = tsMatch[0].replace(/[\[\]]/g, '').trim();

      let body = raw.replace(TS_BRACKET, ' ').replace(TS_BARE, ' ')
                    .replace(DATE_RE, ' ')
                    .replace(/\s+/g, ' ').trim();
      body = body.replace(TS_LEADING, '').trim();
      if (!body) return null;

      body = stripSenderFromStart(body, sender);
      const senderFirst = sender.split(/\s+/)[0];
      if (senderFirst !== sender) body = stripSenderFromStart(body, senderFirst);

      if (!sender) {
        const m = body.match(/^\s*([^:\n]{1,60}):\s*(.+)/s);
        if (m) { sender = m[1].trim(); body = m[2].trim(); }
      }

      if (!body || body.length < 2) return null;
      if (body.length > config.maxLength) body = body.slice(0, config.maxLength) + '…';

      const fullSender = sender;
      let spokenSender = sender;
      if (config.firstNameOnly && spokenSender) spokenSender = spokenSender.split(/\s+/)[0];
      return { fullSender, sender: spokenSender, body, timeText };
    }

    function isIgnoredUser(fullSender) {
      if (!fullSender) return false;
      const sLower = fullSender.toLowerCase();
      const sFirst = sLower.split(/\s+/)[0];

      if (config.skipOwnMessages && config.myUsername) {
        const my = config.myUsername.toLowerCase();
        if (sLower === my || sFirst === my.split(/\s+/)[0]) return true;
      }
      if (config.ignoreUsers) {
        const list = config.ignoreUsers.split(',')
          .map(s => s.trim().toLowerCase()).filter(Boolean);
        for (const name of list) {
          if (!name) continue;
          if (sLower === name) return true;
          if (sFirst === name.split(/\s+/)[0]) return true;
        }
      }
      return false;
    }

    // -------------------------------------------------------------------------
    // Container detection
    // -------------------------------------------------------------------------
    function autoDetectChatContainer() {
      const scroller = document.querySelector('app-roomscroller');
      if (scroller) return scroller;
      const siteMsgs = document.querySelectorAll('app-st-compactmessage');
      if (siteMsgs.length > 0) {
        let el = siteMsgs[0].parentElement;
        while (el && el !== document.body) {
          const count = el.querySelectorAll('app-st-compactmessage').length;
          if (count >= Math.min(3, siteMsgs.length)) return el;
          el = el.parentElement;
        }
        return siteMsgs[0].parentElement;
      }
      return document.querySelector(
        '[class*="message-list" i], [class*="chat-list" i], [class*="message-feed" i], ' +
        '[class*="chat-feed" i], [class*="msg-list" i], ' +
        '[id*="message-list" i], [id*="chat-list" i], [id*="messages" i]'
      );
    }

    // -------------------------------------------------------------------------
    // Observer + dedupe
    // -------------------------------------------------------------------------
    let observer = null, targetEl = null;
    const recentSpoken = [], recentSet = new Set();
    // 5000 keeps a full session's worth of messages in the dedup set so that
    // VTF's virtual scroller re-adding old DOM nodes never triggers a re-read.
    const RECENT_MAX = 5000;
    const markSpoken = (key) => {
      recentSpoken.push(key);
      recentSet.add(key);
      if (recentSpoken.length > RECENT_MAX) recentSet.delete(recentSpoken.shift());
    };

    // Applies the same safety-net body cleanup used in handleNode.
    // Must be called before computing the dedup key — both during seeding and
    // during live handling — so the keys always match.
    function normalizeMsg(msg) {
      if (!msg || !msg.body) return null;
      msg.body = msg.body.replace(DATE_RE, ' ').replace(/\s+/g, ' ').trim();
      msg.body = stripSenderFromStart(msg.body, msg.fullSender);
      msg.body = stripSenderFromStart(msg.body, msg.sender);
      // Extra pass with just the first name of fullSender — covers the case where
      // VTF formats the body as "FirstName: message" even when fullSender is a full name.
      const firstName = (msg.fullSender || '').split(/\s+/)[0];
      if (firstName && firstName !== msg.fullSender && firstName !== msg.sender) {
        msg.body = stripSenderFromStart(msg.body, firstName);
      }
      msg.body = msg.body.replace(TS_LEADING, '').trim();
      // Final catch-all: if a "Name: " or "First Last: " prefix survived all the
      // sender-specific passes, remove it. Targets the chat UI injecting the
      // username into the body element itself.
      msg.body = msg.body.replace(/^[A-Za-z][A-Za-z'-]{0,29}(?:\s+[A-Za-z][A-Za-z'-]{0,29})?:\s+/, '').trim();
      return msg.body ? msg : null;
    }

    function handleNode(node) {
      const isVtf = node.tagName && node.tagName.toLowerCase() === 'app-st-compactmessage';
      const raw = isVtf ? extractMessageFromRoot(node) : extractMessageGeneric(node);
      const msg = normalizeMsg(raw);
      if (!msg) return;

      const key = (msg.fullSender + '|' + msg.body).slice(0, 500);
      if (recentSet.has(key)) return;
      markSpoken(key);

      if (isIgnoredUser(msg.fullSender)) {
        LOG('Ignored:', msg.fullSender, '→', msg.body);
        return;
      }
      if (!config.enabled) return;

      const parts = [];
      if (config.announceTime && msg.timeText) parts.push(msg.timeText);
      if (config.readSender && msg.sender)     parts.push(msg.sender + ':');
      parts.push(msg.body);
      const spoken = parts.join(' ').replace(URL_RE, 'URL posted').replace(/\s+/g, ' ').trim();

      LOG('NEW →', spoken);
      enqueueSpeak(spoken);
    }

    function startObserving() {
      stopObserving();
      targetEl = null;
      if (config.selector) {
        try { targetEl = document.querySelector(config.selector); } catch {}
      }
      if (!targetEl) targetEl = autoDetectChatContainer();
      if (!targetEl) {
        setStatus('Message container not found — retrying…');
        scheduleRetry(); return;
      }
      const existingMsgs = targetEl.querySelectorAll('app-st-compactmessage');
      if (existingMsgs.length > 0) {
        existingMsgs.forEach(root => {
          const m = normalizeMsg(extractMessageFromRoot(root));
          if (m) markSpoken((m.fullSender + '|' + m.body).slice(0, 500));
        });
      } else {
        Array.from(targetEl.children).forEach(child => {
          const text = ((child.innerText || child.textContent) || '').trim();
          if (text) markSpoken(text.slice(0, 500));
        });
      }
      observer = new MutationObserver(mutations => {
        for (const m of mutations) {
          m.addedNodes.forEach(n => {
            if (n.nodeType !== 1) return;
            const root = getMessageRoot(n);
            if (root) { handleNode(root); return; }
            try {
              const siteMsgs = n.querySelectorAll && n.querySelectorAll('app-st-compactmessage');
              if (siteMsgs && siteMsgs.length) { siteMsgs.forEach(handleNode); return; }
            } catch {}
            handleNode(n);
          });
        }
      });
      observer.observe(targetEl, { childList: true, subtree: true });
      setStatus(`Watching: ${describeEl(targetEl)}`);
    }
    function stopObserving() {
      if (observer) { try { observer.disconnect(); } catch {} }
      observer = null;
    }
    let retryTimer = null;
    function scheduleRetry() {
      if (retryTimer) return;
      retryTimer = setTimeout(() => { retryTimer = null; startObserving(); }, 3000);
    }
    function describeEl(el) {
      if (!el) return '(none)';
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).filter(Boolean).join('.')
        : '';
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    }

    // -------------------------------------------------------------------------
    // Element picker
    // -------------------------------------------------------------------------
    let pickerActive = false, pickerHighlight = null;
    function startPicker() {
      if (pickerActive) return;
      pickerActive = true;
      document.body.style.cursor = 'crosshair';
      pickerHighlight = document.createElement('div');
      Object.assign(pickerHighlight.style, {
        position: 'fixed', pointerEvents: 'none',
        border: '2px solid #ff6b35', background: 'rgba(255,107,53,0.12)',
        zIndex: 2147483646, transition: 'all 60ms linear', boxSizing: 'border-box',
      });
      document.body.appendChild(pickerHighlight);
      document.addEventListener('mousemove', onPickerMove, true);
      document.addEventListener('click', onPickerClick, true);
      document.addEventListener('keydown', onPickerKey, true);
      setStatus('Click a message area on the page. (Esc to cancel)');
    }
    function stopPicker() {
      pickerActive = false;
      document.body.style.cursor = '';
      if (pickerHighlight) pickerHighlight.remove();
      pickerHighlight = null;
      document.removeEventListener('mousemove', onPickerMove, true);
      document.removeEventListener('click', onPickerClick, true);
      document.removeEventListener('keydown', onPickerKey, true);
    }
    function onPickerMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === pickerHighlight || panel.contains(el)) return;
      const r = el.getBoundingClientRect();
      Object.assign(pickerHighlight.style, {
        top: r.top + 'px', left: r.left + 'px',
        width: r.width + 'px', height: r.height + 'px',
      });
    }
    function onPickerClick(e) {
      e.preventDefault(); e.stopPropagation();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || panel.contains(el)) return;
      const sel = buildSelector(el);
      config.selector = sel; saveConfig();
      selectorInput.value = sel;
      stopPicker();
      startObserving();
    }
    function onPickerKey(e) {
      if (e.key === 'Escape') { stopPicker(); setStatus('Picker cancelled.'); }
    }
    function buildSelector(el) {
      if (!el) return '';
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts = []; let cur = el;
      while (cur && cur.nodeType === 1 && parts.length < 6) {
        let part = cur.tagName.toLowerCase();
        if (cur.id) { parts.unshift(`#${CSS.escape(cur.id)}`); break; }
        if (typeof cur.className === 'string' && cur.className.trim()) {
          const cls = cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
          if (cls.length) part += '.' + cls.map(c => CSS.escape(c)).join('.');
        }
        const parent = cur.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter(s => s.tagName === cur.tagName);
          if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
        }
        parts.unshift(part);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }

    // -------------------------------------------------------------------------
    // UI
    // -------------------------------------------------------------------------
    const panel = document.createElement('div');
    panel.id = 'msg-reader-panel';
    panel.innerHTML = `
      <style>
        #msg-reader-panel {
          position: fixed !important; top: 80px !important; right: 16px !important;
          z-index: 2147483647 !important; width: 310px !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
          font-size: 12px !important; color: #e6e9ef !important;
          background: #1a1d24 !important; border: 1px solid #ff6b35 !important;
          border-radius: 8px !important;
          box-shadow: 0 8px 24px rgba(0,0,0,0.6) !important; user-select: none !important;
        }
        #msg-reader-panel * { box-sizing: border-box; }
        #msg-reader-panel header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 12px; background: #13151b; border-bottom: 1px solid #2a2f3a;
          border-radius: 8px 8px 0 0; cursor: move;
        }
        #msg-reader-panel h3 {
          margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
          text-transform: uppercase; color: #ff6b35;
        }
        #msg-reader-panel .playback {
          padding: 10px 12px; display: grid; gap: 8px;
          border-bottom: 1px solid #2a2f3a;
        }
        #msg-reader-panel .settings { padding: 10px 12px; display: grid; gap: 8px; }
        #msg-reader-panel.collapsed .settings { display: none; }
        #msg-reader-panel.collapsed .playback { border-bottom: none; }
        #msg-reader-panel label { display: grid; gap: 4px; font-size: 11px; color: #9aa3b2; }
        #msg-reader-panel input[type="text"], #msg-reader-panel select, #msg-reader-panel textarea {
          width: 100%; padding: 5px 7px; background: #0f1116; color: #e6e9ef;
          border: 1px solid #2a2f3a; border-radius: 4px; font-size: 12px;
          font-family: inherit;
        }
        #msg-reader-panel textarea { resize: vertical; min-height: 38px; }
        #msg-reader-panel input[type="range"] { width: 100%; }
        #msg-reader-panel .row { display: flex; gap: 6px; align-items: center; }
        #msg-reader-panel .row button { flex: 1; }
        #msg-reader-panel button {
          padding: 6px 8px; background: #2a2f3a; color: #e6e9ef;
          border: 1px solid #3a3f4a; border-radius: 4px; font-size: 11px;
          cursor: pointer; font-weight: 500;
        }
        #msg-reader-panel button:hover:not(:disabled) { background: #353b48; }
        #msg-reader-panel button:disabled { opacity: 0.4; cursor: not-allowed; }
        #msg-reader-panel button.primary { background: #ff6b35; border-color: #ff6b35; color: #fff; }
        #msg-reader-panel button.start { background: #22c55e; border-color: #22c55e; color: #fff; }
        #msg-reader-panel button.pause { background: #eab308; border-color: #eab308; color: #1a1d24; }
        #msg-reader-panel button.skip  { background: #3b82f6; border-color: #3b82f6; color: #fff; }
        #msg-reader-panel button.stop  { background: #ef4444; border-color: #ef4444; color: #fff; }
        #msg-reader-panel .toggle {
          display: flex; align-items: center; gap: 8px; cursor: pointer;
          padding: 4px 0; font-size: 12px; color: #e6e9ef;
        }
        #msg-reader-panel .cb-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 2px 4px;
        }
        #msg-reader-panel .cb-grid .toggle { font-size: 11px; padding: 3px 0; }
        #msg-reader-panel .rv-row {
          display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
        }
        #msg-reader-panel .pb-state {
          display: flex; align-items: center; justify-content: space-between;
          font-size: 11px; color: #9aa3b2; padding: 4px 8px;
          background: #0f1116; border: 1px solid #2a2f3a; border-radius: 4px;
        }
        #msg-reader-panel .pb-state .dot {
          display: inline-block; width: 8px; height: 8px; border-radius: 50%;
          margin-right: 6px; background: #6a7280;
        }
        #msg-reader-panel .pb-state.playing .dot { background: #22c55e; animation: msgpulse 1.2s infinite; }
        #msg-reader-panel .pb-state.paused  .dot { background: #eab308; }
        #msg-reader-panel .pb-state.stopped .dot { background: #ef4444; }
        @keyframes msgpulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        #msg-reader-panel .status {
          font-size: 10px; color: #6a7280; padding-top: 6px; margin-top: 4px;
          border-top: 1px solid #2a2f3a; word-break: break-all;
        }
        #msg-reader-panel .collapse-btn {
          background: transparent; border: none; color: #6a7280;
          font-size: 14px; padding: 0 4px; cursor: pointer;
        }
        #msg-reader-panel hr.sep { border: 0; border-top: 1px solid #2a2f3a; margin: 2px 0; }
        #msg-reader-panel .ignore-row { display: flex; gap: 6px; }
        #msg-reader-panel .ignore-row input { flex: 1; }
        #msg-reader-panel .ignore-row button { flex: 0 0 auto; padding: 5px 10px; }
      </style>

      <header id="msg-reader-header">
        <h3>Message Reader</h3>
        <button class="collapse-btn" id="msg-collapse" title="Collapse / expand settings">▸</button>
      </header>

      <!-- ALWAYS VISIBLE: playback controls + state -->
      <div class="playback">
        <div class="pb-state" id="msg-pb-state">
          <span><span class="dot"></span><span id="msg-pb-label">Idle</span></span>
          <span id="msg-pb-queue" style="opacity:0.7;">queue: 0</span>
        </div>
        <div class="row">
          <button id="msg-start" class="start">▶ Start</button>
          <button id="msg-pause" class="pause">⏸ Pause</button>
          <button id="msg-skip"  class="skip">⏭ Skip</button>
          <button id="msg-stop"  class="stop">⏹ Stop</button>
        </div>
      </div>

      <!-- COLLAPSIBLE: all the settings -->
      <div class="settings">
        <label class="toggle">
          <input type="checkbox" id="msg-enabled">
          <span>Read new messages as they arrive</span>
        </label>

        <hr class="sep">

        <!-- 4 toggles in a 2×2 grid -->
        <div class="cb-grid">
          <label class="toggle">
            <input type="checkbox" id="msg-read-sender">
            <span>Sender name</span>
          </label>
          <label class="toggle">
            <input type="checkbox" id="msg-first-name">
            <span>First name only</span>
          </label>
          <label class="toggle">
            <input type="checkbox" id="msg-announce-time">
            <span>Timestamp</span>
          </label>
          <label class="toggle">
            <input type="checkbox" id="msg-skip-own">
            <span>Skip own msgs</span>
          </label>
        </div>

        <hr class="sep">

        <label>Message container (CSS selector)
          <input type="text" id="msg-selector" placeholder="auto-detect active…">
        </label>
        <div class="row">
          <button id="msg-pick" class="primary">Pick Message Area</button>
          <button id="msg-redetect">Auto-detect</button>
        </div>
        <div class="row">
          <button id="msg-test">Test Voice</button>
          <button id="msg-clear">Clear Selector</button>
        </div>

        <hr class="sep">

        <label>Voice <select id="msg-voice"></select></label>

        <!-- Rate and Volume side by side -->
        <div class="rv-row">
          <label>Rate <span id="msg-rate-val">1.00</span>
            <input type="range" id="msg-rate" min="0.5" max="2" step="0.05">
          </label>
          <label>Volume <span id="msg-volume-val">1.00</span>
            <input type="range" id="msg-volume" min="0" max="1" step="0.05">
          </label>
        </div>

        <hr class="sep">

        <label>My username
          <input type="text" id="msg-username" placeholder="optional — for skip-own filter">
        </label>

        <label>Skip these users (comma-separated)
          <textarea id="msg-ignore-users" rows="2" placeholder="comma-separated usernames"></textarea>
        </label>
        <div class="ignore-row">
          <input type="text" id="msg-ignore-add" placeholder="add a username…">
          <button id="msg-ignore-add-btn">+ Add</button>
        </div>

        <hr class="sep">

        <label>Allowed sites (URL keywords, one per line)
          <textarea id="msg-allowed-urls" rows="3" placeholder="e.g. example.com&#10;&#10;Leave empty to show on all sites."></textarea>
        </label>
        <div class="row">
          <button id="msg-add-site">+ Add this site</button>
        </div>

        <div class="status" id="msg-status">Idle.</div>
      </div>
    `;

    let selectorInput, statusEl, pbStateEl, pbLabelEl, pbQueueEl,
        btnStart, btnPause, btnSkip, btnStop, cbEnabled;

    function setStatus(m) { if (statusEl) statusEl.textContent = m; LOG('status:', m); }

    function refreshEnabledCheckbox() { if (cbEnabled) cbEnabled.checked = !!config.enabled; }

    function updatePlaybackUI() {
      if (!pbStateEl) return;
      pbStateEl.classList.remove('playing', 'paused', 'stopped');
      let label = 'Idle';
      if (playbackState === 'playing') { pbStateEl.classList.add('playing'); label = 'Playing'; }
      else if (playbackState === 'paused') { pbStateEl.classList.add('paused'); label = 'Paused'; }
      else if (playbackState === 'stopped') { pbStateEl.classList.add('stopped'); label = 'Stopped'; }
      pbLabelEl.textContent = label;
      pbQueueEl.textContent = `queue: ${queue.length}`;
      btnStart.disabled = (playbackState === 'playing');
      btnPause.disabled = (playbackState !== 'playing');
      btnSkip.disabled  = (playbackState !== 'playing' && playbackState !== 'paused');
      btnStop.disabled  = (playbackState === 'stopped' || playbackState === 'idle') && queue.length === 0;
    }

    function populateVoiceDropdown() {
      const sel = panel.querySelector('#msg-voice');
      if (!sel) return;
      sel.innerHTML = '';
      voices.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = `${v.name} (${v.lang})`;
        if (v.voiceURI === config.voiceURI) opt.selected = true;
        sel.appendChild(opt);
      });
    }

    function mountUI() {
      try {
        document.body.appendChild(panel);

        // Start collapsed — user expands when needed.
        panel.classList.add('collapsed');

        selectorInput = panel.querySelector('#msg-selector');
        statusEl      = panel.querySelector('#msg-status');
        pbStateEl     = panel.querySelector('#msg-pb-state');
        pbLabelEl     = panel.querySelector('#msg-pb-label');
        pbQueueEl     = panel.querySelector('#msg-pb-queue');
        btnStart      = panel.querySelector('#msg-start');
        btnPause      = panel.querySelector('#msg-pause');
        btnSkip       = panel.querySelector('#msg-skip');
        btnStop       = panel.querySelector('#msg-stop');
        cbEnabled     = panel.querySelector('#msg-enabled');

        // Hydrate from config.
        cbEnabled.checked = config.enabled;
        panel.querySelector('#msg-selector').value = config.selector;
        panel.querySelector('#msg-rate').value = config.rate;
        panel.querySelector('#msg-rate-val').textContent = Number(config.rate).toFixed(2);
        panel.querySelector('#msg-volume').value = config.volume;
        panel.querySelector('#msg-volume-val').textContent = Number(config.volume).toFixed(2);
        panel.querySelector('#msg-read-sender').checked = config.readSender;
        panel.querySelector('#msg-first-name').checked = config.firstNameOnly;
        panel.querySelector('#msg-announce-time').checked = config.announceTime;
        panel.querySelector('#msg-skip-own').checked = config.skipOwnMessages;
        panel.querySelector('#msg-username').value = config.myUsername;
        panel.querySelector('#msg-ignore-users').value = config.ignoreUsers;
        panel.querySelector('#msg-allowed-urls').value = config.allowedUrls;
        populateVoiceDropdown();
        updatePlaybackUI();

        // Playback buttons.
        btnStart.addEventListener('click', ctrlStart);
        btnPause.addEventListener('click', ctrlPause);
        btnSkip.addEventListener('click',  ctrlSkip);
        btnStop.addEventListener('click',  ctrlStop);

        // Settings.
        cbEnabled.addEventListener('change', e => {
          config.enabled = e.target.checked; saveConfig();
          setStatus(config.enabled ? 'Enabled — will read new messages.' : 'Disabled.');
          if (!config.enabled) {
            utteranceGen++;
            try { synth && synth.cancel(); } catch {}
            queue.length = 0;
            playbackState = 'idle';
            updatePlaybackUI();
          }
        });
        panel.querySelector('#msg-selector').addEventListener('change', e => {
          config.selector = e.target.value.trim(); saveConfig(); startObserving();
        });
        panel.querySelector('#msg-pick').addEventListener('click', startPicker);
        panel.querySelector('#msg-redetect').addEventListener('click', () => {
          config.selector = ''; saveConfig();
          selectorInput.value = '';
          startObserving();
        });
        panel.querySelector('#msg-clear').addEventListener('click', () => {
          config.selector = ''; saveConfig();
          selectorInput.value = '';
          setStatus('Selector cleared.');
        });
        panel.querySelector('#msg-test').addEventListener('click', () => {
          const u = new SpeechSynthesisUtterance('This is a test of the message reader.');
          u.rate = config.rate; u.volume = config.volume;
          const v = voices.find(v => v.voiceURI === config.voiceURI);
          if (v) u.voice = v;
          try { synth && synth.speak(u); } catch {}
        });
        panel.querySelector('#msg-voice').addEventListener('change', e => {
          config.voiceURI = e.target.value; saveConfig();
        });
        panel.querySelector('#msg-rate').addEventListener('input', e => {
          config.rate = parseFloat(e.target.value);
          panel.querySelector('#msg-rate-val').textContent = config.rate.toFixed(2);
          saveConfig();
        });
        panel.querySelector('#msg-volume').addEventListener('input', e => {
          config.volume = parseFloat(e.target.value);
          panel.querySelector('#msg-volume-val').textContent = config.volume.toFixed(2);
          saveConfig();
        });
        panel.querySelector('#msg-read-sender').addEventListener('change', e => {
          config.readSender = e.target.checked; saveConfig();
        });
        panel.querySelector('#msg-first-name').addEventListener('change', e => {
          config.firstNameOnly = e.target.checked; saveConfig();
        });
        panel.querySelector('#msg-announce-time').addEventListener('change', e => {
          config.announceTime = e.target.checked; saveConfig();
        });
        panel.querySelector('#msg-skip-own').addEventListener('change', e => {
          config.skipOwnMessages = e.target.checked; saveConfig();
        });
        panel.querySelector('#msg-username').addEventListener('change', e => {
          config.myUsername = e.target.value.trim(); saveConfig();
        });

        // Ignore-users textarea.
        const ignoreEl = panel.querySelector('#msg-ignore-users');
        const commitIgnore = () => {
          const arr = ignoreEl.value.split(',').map(s => s.trim()).filter(Boolean);
          config.ignoreUsers = arr.join(', ');
          ignoreEl.value = config.ignoreUsers;
          saveConfig();
          setStatus(arr.length ? `Ignoring ${arr.length} user(s).` : 'No users ignored.');
        };
        ignoreEl.addEventListener('blur', commitIgnore);
        ignoreEl.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitIgnore(); ignoreEl.blur(); }
        });

        // Quick-add user.
        const addEl = panel.querySelector('#msg-ignore-add');
        const addBtn = panel.querySelector('#msg-ignore-add-btn');
        const doAdd = () => {
          const v = (addEl.value || '').trim();
          if (!v) return;
          const existing = config.ignoreUsers.split(',').map(s => s.trim()).filter(Boolean);
          if (!existing.some(x => x.toLowerCase() === v.toLowerCase())) {
            existing.push(v);
            config.ignoreUsers = existing.join(', ');
            ignoreEl.value = config.ignoreUsers;
            saveConfig();
            setStatus(`Added "${v}" to ignore list.`);
          } else {
            setStatus(`"${v}" is already in the ignore list.`);
          }
          addEl.value = '';
        };
        addBtn.addEventListener('click', doAdd);
        addEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });

        // Allowed URLs textarea.
        const allowedEl = panel.querySelector('#msg-allowed-urls');
        const commitAllowed = () => {
          const arr = allowedEl.value.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
          config.allowedUrls = arr.join('\n');
          allowedEl.value = config.allowedUrls;
          saveConfig();
          setStatus(arr.length ? `Active on ${arr.length} site pattern(s). Reload to apply.` : 'No site filter — active everywhere.');
        };
        allowedEl.addEventListener('blur', commitAllowed);
        allowedEl.addEventListener('keydown', e => {
          if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); commitAllowed(); }
        });

        // "Add this site" button — appends current hostname.
        panel.querySelector('#msg-add-site').addEventListener('click', () => {
          const host = window.location.hostname;
          const existing = config.allowedUrls.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
          if (!existing.includes(host)) {
            existing.push(host);
            config.allowedUrls = existing.join('\n');
            allowedEl.value = config.allowedUrls;
            saveConfig();
            setStatus(`Added "${host}". Reload page to confirm site gating.`);
          } else {
            setStatus(`"${host}" is already in the allowed list.`);
          }
        });

        // Collapse / expand.
        const collapseBtn = panel.querySelector('#msg-collapse');
        collapseBtn.addEventListener('click', () => {
          panel.classList.toggle('collapsed');
          collapseBtn.textContent = panel.classList.contains('collapsed') ? '▸' : '▾';
        });

        makeDraggable(panel, panel.querySelector('#msg-reader-header'));
        startObserving();
        setInterval(updatePlaybackUI, 1000);
        LOG('UI mounted.');
      } catch (e) {
        ERR('mountUI failed:', e);
      }
    }

    function makeDraggable(el, handle) {
      let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
      handle.addEventListener('mousedown', e => {
        if (e.target.tagName === 'BUTTON') return;
        dragging = true; sx = e.clientX; sy = e.clientY;
        const r = el.getBoundingClientRect();
        ox = r.left; oy = r.top;
        el.style.right = 'auto';
        e.preventDefault();
      });
      document.addEventListener('mousemove', e => {
        if (!dragging) return;
        el.style.left = (ox + e.clientX - sx) + 'px';
        el.style.top  = (oy + e.clientY - sy) + 'px';
      });
      document.addEventListener('mouseup', () => { dragging = false; });
    }

    mountUI();
  }
})();
