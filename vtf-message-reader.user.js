// ==UserScript==
// @name         VTF Message Reader
// @namespace    https://vtf.t3live.com/
// @version      1.5.0
// @description  Reads VTF (Virtual Trading Floor) Main Chat messages aloud, with playback controls, ignore list, and time/first-name options.
// @match        https://vtf.t3live.com/*
// @match        https://*.t3live.com/*
// @grant        none
// @run-at       document-idle
// @all-frames   false
// ==/UserScript==

/*
 * VTF Message Reader (v1.5)
 * --------------------------
 *  • Spoken format:         "[<time>] <FirstName>: <message>"
 *      e.g. "10:57 AM Joshua: i shorted some $AMD here"
 *  • Time can be toggled off → "Joshua: i shorted some $AMD here"
 *  • First-name only by default (Joshua Lefler → Joshua), can be toggled.
 *  • Playback controls: ▶ Start / ⏸ Pause / ⏭ Skip / ⏹ Stop  (always visible).
 *  • Settings (voice, rate, volume, ignore list…) collapse independently.
 *  • Ignore list = comma-separated usernames (matched on full or first name).
 *  • Skip cancels the current utterance and immediately moves to the next one.
 */

(function () {
  'use strict';

  const LOG = (...a) => console.log('[VTF Reader]', ...a);
  const ERR = (...a) => console.error('[VTF Reader]', ...a);

  if (window.__vtfReaderLoaded) { LOG('Already loaded.'); return; }
  window.__vtfReaderLoaded = true;

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
    const STORAGE_KEY = 'vtf_reader_config_v1';
    const defaults = {
      enabled: false,
      selector: '',
      rate: 1.0, pitch: 1.0, volume: 1.0,
      voiceURI: '',
      readSender: true,
      firstNameOnly: true,        // NEW: speak first name only ("Joshua Lefler" → "Joshua")
      announceTime: false,        // NEW: prepend "[10:57 AM]" to spoken text
      skipOwnMessages: true,
      myUsername: '',
      ignoreUsers: '',            // NEW: comma-separated list of usernames to skip
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
      if (playbackState === 'stopped') return;       // user explicitly stopped
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
        if (myGen !== utteranceGen) return;          // superseded by skip/stop
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
      // Stop mid-message. Immediately advance to the next queued message
      // (or go idle if queue is empty). Does NOT toggle the enable flag.
      if (!synth) return;
      utteranceGen++;                                 // invalidate pending onend
      try { synth.cancel(); } catch {}
      if (playbackState === 'paused') {
        // Drop current item; user must hit Start to resume the next one.
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
    // Message extraction (VTF-specific)
    // -------------------------------------------------------------------------
    const BADGE_WORDS = new Set([
      'T3TG', 'ADMIN', 'MOD', 'MODERATOR', 'VIP', 'PRO', 'OWNER',
      'STAFF', 'TEAM', 'T3', 'LIVE'
    ]);

    // Captures both [10:57 AM] and bare 10:57 / 10:57 AM tokens.
    const TS_BRACKET = /\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*\]/gi;
    const TS_BARE    = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\b/gi;

    function getMessageRoot(node) {
      if (!(node instanceof HTMLElement)) return null;
      if (node.tagName && node.tagName.toLowerCase() === 'app-st-compactmessage') return node;
      return node.closest && node.closest('app-st-compactmessage');
    }

    function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function extractMessageFromRoot(root) {
      if (!root) return null;

      // Pull sender from a known sender-ish element. (Done first because we
      // need it to scrub from the body even if it appears in odd positions.)
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

      // Capture the FIRST timestamp seen, in case we want to read it aloud.
      let raw = (root.innerText || '').replace(/\u00a0/g, ' ');
      let timeText = '';
      const tsMatch = raw.match(TS_BRACKET) || raw.match(TS_BARE);
      if (tsMatch && tsMatch.length) {
        timeText = tsMatch[0].replace(/[\[\]]/g, '').trim();
      }

      // Aggressive cleanup: strip ALL timestamps, normalize whitespace.
      let body = raw.replace(TS_BRACKET, ' ')
                    .replace(TS_BARE, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
      if (!body) return null;

      // Strip the sender name from the start of the body — possibly several
      // times, since some renderings repeat the name (avatar tooltip + label).
      if (sender) {
        const senderRe = new RegExp('^' + escapeRegex(sender) + '\\s*[:·|>-]?\\s*', 'i');
        let prev;
        do { prev = body; body = body.replace(senderRe, '').trim(); } while (body !== prev);
      }

      // Strip leading badge words.
      let words = body.split(/\s+/);
      while (words.length && BADGE_WORDS.has(words[0].toUpperCase())) words.shift();
      body = words.join(' ').trim();

      // Fallback: "Name: body" if we still have no sender.
      if (!sender) {
        const m = body.match(/^\s*([^:\n]{1,60}):\s*(.+)/s);
        if (m && !BADGE_WORDS.has(m[1].trim().toUpperCase())) {
          sender = m[1].trim();
          body = m[2].trim();
        }
      }

      if (!body) return null;
      if (body.length > config.maxLength) body = body.slice(0, config.maxLength) + '…';

      // Sanity: ignore ultra-short junk.
      if (!sender && body.length < 2) return null;
      if (!sender && BADGE_WORDS.has(body.toUpperCase())) return null;

      // Build the "displayed" sender using first-name-only preference. We
      // keep the FULL sender for ignore-list matching below.
      const fullSender = sender;
      let spokenSender = sender;
      if (config.firstNameOnly && spokenSender) {
        spokenSender = spokenSender.split(/\s+/)[0];
      }

      return { fullSender, sender: spokenSender, body, timeText };
    }

    function isIgnoredUser(fullSender) {
      if (!fullSender) return false;
      const sLower = fullSender.toLowerCase();
      const sFirst = sLower.split(/\s+/)[0];

      // Existing "skip my own" filter.
      if (config.skipOwnMessages && config.myUsername) {
        const my = config.myUsername.toLowerCase();
        if (sLower === my || sFirst === my.split(/\s+/)[0]) return true;
      }
      // New comma-separated ignore list.
      if (config.ignoreUsers) {
        const list = config.ignoreUsers.split(',')
          .map(s => s.trim().toLowerCase()).filter(Boolean);
        for (const name of list) {
          if (!name) continue;
          // Match either full name OR first-name token (so "Dennis" hides
          // both "Dennis" and "Dennis Smith").
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
      const msgs = document.querySelectorAll('app-st-compactmessage');
      if (msgs.length === 0) return null;
      let el = msgs[0].parentElement;
      while (el && el !== document.body) {
        const count = el.querySelectorAll('app-st-compactmessage').length;
        if (count >= Math.min(3, msgs.length)) return el;
        el = el.parentElement;
      }
      return msgs[0].parentElement;
    }

    // -------------------------------------------------------------------------
    // Observer + dedupe
    // -------------------------------------------------------------------------
    let observer = null, targetEl = null;
    const recentSpoken = [], recentSet = new Set();
    const RECENT_MAX = 200;
    const markSpoken = (key) => {
      recentSpoken.push(key);
      recentSet.add(key);
      if (recentSpoken.length > RECENT_MAX) recentSet.delete(recentSpoken.shift());
    };

    function handleRootNode(root) {
      const msg = extractMessageFromRoot(root);
      if (!msg) return;
      const key = (msg.fullSender + '|' + msg.body).slice(0, 500);
      if (recentSet.has(key)) return;
      markSpoken(key);

      if (isIgnoredUser(msg.fullSender)) {
        LOG('Ignored:', msg.fullSender, '→', msg.body);
        return;
      }
      if (!config.enabled) return;

      // Build the spoken text: [time] FirstName: body
      const parts = [];
      if (config.announceTime && msg.timeText) parts.push(msg.timeText);
      if (config.readSender && msg.sender)     parts.push(msg.sender + ':');
      parts.push(msg.body);
      const spoken = parts.join(' ').trim();

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
        setStatus('Main Chat not found — retrying…');
        scheduleRetry(); return;
      }
      // Seed existing messages so we don't read history.
      targetEl.querySelectorAll('app-st-compactmessage').forEach(root => {
        const m = extractMessageFromRoot(root);
        if (m) markSpoken((m.fullSender + '|' + m.body).slice(0, 500));
      });
      observer = new MutationObserver(mutations => {
        for (const m of mutations) {
          m.addedNodes.forEach(n => {
            if (n.nodeType !== 1) return;
            const root = getMessageRoot(n);
            if (root) { handleRootNode(root); return; }
            try {
              n.querySelectorAll && n.querySelectorAll('app-st-compactmessage')
                .forEach(handleRootNode);
            } catch {}
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
      setStatus('Click the Main Chat list. (Esc to cancel)');
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
    panel.id = 'vtf-reader-panel';
    panel.innerHTML = `
      <style>
        #vtf-reader-panel {
          position: fixed !important; top: 80px !important; right: 16px !important;
          z-index: 2147483647 !important; width: 310px !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
          font-size: 12px !important; color: #e6e9ef !important;
          background: #1a1d24 !important; border: 1px solid #ff6b35 !important;
          border-radius: 8px !important;
          box-shadow: 0 8px 24px rgba(0,0,0,0.6) !important; user-select: none !important;
        }
        #vtf-reader-panel * { box-sizing: border-box; }
        #vtf-reader-panel header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 12px; background: #13151b; border-bottom: 1px solid #2a2f3a;
          border-radius: 8px 8px 0 0; cursor: move;
        }
        #vtf-reader-panel h3 {
          margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
          text-transform: uppercase; color: #ff6b35;
        }
        /* Always-visible playback section */
        #vtf-reader-panel .playback {
          padding: 10px 12px; display: grid; gap: 8px;
          border-bottom: 1px solid #2a2f3a;
        }
        /* Collapsible settings section */
        #vtf-reader-panel .settings { padding: 10px 12px; display: grid; gap: 8px; }
        #vtf-reader-panel.collapsed .settings { display: none; }
        #vtf-reader-panel.collapsed .playback { border-bottom: none; }
        #vtf-reader-panel label { display: grid; gap: 4px; font-size: 11px; color: #9aa3b2; }
        #vtf-reader-panel input[type="text"], #vtf-reader-panel select, #vtf-reader-panel textarea {
          width: 100%; padding: 5px 7px; background: #0f1116; color: #e6e9ef;
          border: 1px solid #2a2f3a; border-radius: 4px; font-size: 12px;
          font-family: inherit;
        }
        #vtf-reader-panel textarea { resize: vertical; min-height: 38px; }
        #vtf-reader-panel input[type="range"] { width: 100%; }
        #vtf-reader-panel .row { display: flex; gap: 6px; align-items: center; }
        #vtf-reader-panel .row button { flex: 1; }
        #vtf-reader-panel button {
          padding: 6px 8px; background: #2a2f3a; color: #e6e9ef;
          border: 1px solid #3a3f4a; border-radius: 4px; font-size: 11px;
          cursor: pointer; font-weight: 500;
        }
        #vtf-reader-panel button:hover:not(:disabled) { background: #353b48; }
        #vtf-reader-panel button:disabled { opacity: 0.4; cursor: not-allowed; }
        #vtf-reader-panel button.primary { background: #ff6b35; border-color: #ff6b35; color: #fff; }
        #vtf-reader-panel button.start { background: #22c55e; border-color: #22c55e; color: #fff; }
        #vtf-reader-panel button.pause { background: #eab308; border-color: #eab308; color: #1a1d24; }
        #vtf-reader-panel button.skip  { background: #3b82f6; border-color: #3b82f6; color: #fff; }
        #vtf-reader-panel button.stop  { background: #ef4444; border-color: #ef4444; color: #fff; }
        #vtf-reader-panel .toggle {
          display: flex; align-items: center; gap: 8px; cursor: pointer;
          padding: 4px 0; font-size: 12px; color: #e6e9ef;
        }
        #vtf-reader-panel .pb-state {
          display: flex; align-items: center; justify-content: space-between;
          font-size: 11px; color: #9aa3b2; padding: 4px 8px;
          background: #0f1116; border: 1px solid #2a2f3a; border-radius: 4px;
        }
        #vtf-reader-panel .pb-state .dot {
          display: inline-block; width: 8px; height: 8px; border-radius: 50%;
          margin-right: 6px; background: #6a7280;
        }
        #vtf-reader-panel .pb-state.playing .dot { background: #22c55e; animation: vtfpulse 1.2s infinite; }
        #vtf-reader-panel .pb-state.paused  .dot { background: #eab308; }
        #vtf-reader-panel .pb-state.stopped .dot { background: #ef4444; }
        @keyframes vtfpulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        #vtf-reader-panel .status {
          font-size: 10px; color: #6a7280; padding-top: 6px; margin-top: 4px;
          border-top: 1px solid #2a2f3a; word-break: break-all;
        }
        #vtf-reader-panel .collapse-btn {
          background: transparent; border: none; color: #6a7280;
          font-size: 14px; padding: 0 4px; cursor: pointer;
        }
        #vtf-reader-panel hr.sep { border: 0; border-top: 1px solid #2a2f3a; margin: 2px 0; }
        #vtf-reader-panel .ignore-row { display: flex; gap: 6px; }
        #vtf-reader-panel .ignore-row input { flex: 1; }
        #vtf-reader-panel .ignore-row button { flex: 0 0 auto; padding: 5px 10px; }
      </style>

      <header id="vtf-reader-header">
        <h3>VTF Reader</h3>
        <button class="collapse-btn" id="vtf-collapse" title="Collapse / expand settings">▾</button>
      </header>

      <!-- ALWAYS VISIBLE: playback controls + state -->
      <div class="playback">
        <div class="pb-state" id="vtf-pb-state">
          <span><span class="dot"></span><span id="vtf-pb-label">Idle</span></span>
          <span id="vtf-pb-queue" style="opacity:0.7;">queue: 0</span>
        </div>
        <div class="row">
          <button id="vtf-start" class="start">▶ Start</button>
          <button id="vtf-pause" class="pause">⏸ Pause</button>
          <button id="vtf-skip"  class="skip">⏭ Skip</button>
          <button id="vtf-stop"  class="stop">⏹ Stop</button>
        </div>
      </div>

      <!-- COLLAPSIBLE: all the settings -->
      <div class="settings">
        <label class="toggle">
          <input type="checkbox" id="vtf-enabled">
          <span>Read new messages as they arrive</span>
        </label>

        <label>Main Chat container
          <input type="text" id="vtf-selector" placeholder="auto-detect active…">
        </label>
        <div class="row">
          <button id="vtf-pick" class="primary">Pick Message Area</button>
          <button id="vtf-redetect">Auto-detect</button>
        </div>
        <div class="row">
          <button id="vtf-test">Test Voice</button>
          <button id="vtf-clear">Clear Selector</button>
        </div>

        <hr class="sep">

        <label>Voice <select id="vtf-voice"></select></label>
        <label>Rate: <span id="vtf-rate-val">1.00</span>
          <input type="range" id="vtf-rate" min="0.5" max="2" step="0.05">
        </label>
        <label>Volume: <span id="vtf-volume-val">1.00</span>
          <input type="range" id="vtf-volume" min="0" max="1" step="0.05">
        </label>

        <hr class="sep">

        <label class="toggle">
          <input type="checkbox" id="vtf-read-sender">
          <span>Announce sender name</span>
        </label>
        <label class="toggle">
          <input type="checkbox" id="vtf-first-name">
          <span>First name only (e.g. "Joshua" not "Joshua Lefler")</span>
        </label>
        <label class="toggle">
          <input type="checkbox" id="vtf-announce-time">
          <span>Announce timestamp (e.g. "10:57 AM")</span>
        </label>

        <hr class="sep">

        <label class="toggle">
          <input type="checkbox" id="vtf-skip-own">
          <span>Skip my own messages</span>
        </label>
        <label>My VTF username
          <input type="text" id="vtf-username" placeholder="optional">
        </label>

        <label>Skip messages from these users (comma-separated)
          <textarea id="vtf-ignore-users" rows="2" placeholder="e.g. Dennis, Pat H, Joshua Lefler"></textarea>
        </label>
        <div class="ignore-row">
          <input type="text" id="vtf-ignore-add" placeholder="add a username…">
          <button id="vtf-ignore-add-btn">+ Add</button>
        </div>

        <div class="status" id="vtf-status">Idle.</div>
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
      const sel = panel.querySelector('#vtf-voice');
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
        selectorInput = panel.querySelector('#vtf-selector');
        statusEl      = panel.querySelector('#vtf-status');
        pbStateEl     = panel.querySelector('#vtf-pb-state');
        pbLabelEl     = panel.querySelector('#vtf-pb-label');
        pbQueueEl     = panel.querySelector('#vtf-pb-queue');
        btnStart      = panel.querySelector('#vtf-start');
        btnPause      = panel.querySelector('#vtf-pause');
        btnSkip       = panel.querySelector('#vtf-skip');
        btnStop       = panel.querySelector('#vtf-stop');
        cbEnabled     = panel.querySelector('#vtf-enabled');

        // Hydrate from config.
        cbEnabled.checked = config.enabled;
        panel.querySelector('#vtf-selector').value = config.selector;
        panel.querySelector('#vtf-rate').value = config.rate;
        panel.querySelector('#vtf-rate-val').textContent = Number(config.rate).toFixed(2);
        panel.querySelector('#vtf-volume').value = config.volume;
        panel.querySelector('#vtf-volume-val').textContent = Number(config.volume).toFixed(2);
        panel.querySelector('#vtf-read-sender').checked = config.readSender;
        panel.querySelector('#vtf-first-name').checked = config.firstNameOnly;
        panel.querySelector('#vtf-announce-time').checked = config.announceTime;
        panel.querySelector('#vtf-skip-own').checked = config.skipOwnMessages;
        panel.querySelector('#vtf-username').value = config.myUsername;
        panel.querySelector('#vtf-ignore-users').value = config.ignoreUsers;
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
        panel.querySelector('#vtf-selector').addEventListener('change', e => {
          config.selector = e.target.value.trim(); saveConfig(); startObserving();
        });
        panel.querySelector('#vtf-pick').addEventListener('click', startPicker);
        panel.querySelector('#vtf-redetect').addEventListener('click', () => {
          config.selector = ''; saveConfig();
          selectorInput.value = '';
          startObserving();
        });
        panel.querySelector('#vtf-clear').addEventListener('click', () => {
          config.selector = ''; saveConfig();
          selectorInput.value = '';
          setStatus('Selector cleared.');
        });
        panel.querySelector('#vtf-test').addEventListener('click', () => {
          const u = new SpeechSynthesisUtterance('This is a test of the V T F message reader.');
          u.rate = config.rate; u.volume = config.volume;
          const v = voices.find(v => v.voiceURI === config.voiceURI);
          if (v) u.voice = v;
          try { synth && synth.speak(u); } catch {}
        });
        panel.querySelector('#vtf-voice').addEventListener('change', e => {
          config.voiceURI = e.target.value; saveConfig();
        });
        panel.querySelector('#vtf-rate').addEventListener('input', e => {
          config.rate = parseFloat(e.target.value);
          panel.querySelector('#vtf-rate-val').textContent = config.rate.toFixed(2);
          saveConfig();
        });
        panel.querySelector('#vtf-volume').addEventListener('input', e => {
          config.volume = parseFloat(e.target.value);
          panel.querySelector('#vtf-volume-val').textContent = config.volume.toFixed(2);
          saveConfig();
        });
        panel.querySelector('#vtf-read-sender').addEventListener('change', e => {
          config.readSender = e.target.checked; saveConfig();
        });
        panel.querySelector('#vtf-first-name').addEventListener('change', e => {
          config.firstNameOnly = e.target.checked; saveConfig();
        });
        panel.querySelector('#vtf-announce-time').addEventListener('change', e => {
          config.announceTime = e.target.checked; saveConfig();
        });
        panel.querySelector('#vtf-skip-own').addEventListener('change', e => {
          config.skipOwnMessages = e.target.checked; saveConfig();
        });
        panel.querySelector('#vtf-username').addEventListener('change', e => {
          config.myUsername = e.target.value.trim(); saveConfig();
        });
        // Ignore-users textarea (commit on blur or Enter).
        const ignoreEl = panel.querySelector('#vtf-ignore-users');
        const commitIgnore = () => {
          // Normalize: trim each entry, drop empties, join with ', '.
          const arr = ignoreEl.value.split(',').map(s => s.trim()).filter(Boolean);
          config.ignoreUsers = arr.join(', ');
          ignoreEl.value = config.ignoreUsers;
          saveConfig();
          setStatus(arr.length ? `Ignoring ${arr.length} user(s).` : 'No users ignored.');
        };
        ignoreEl.addEventListener('blur', commitIgnore);
        ignoreEl.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commitIgnore();
            ignoreEl.blur();
          }
        });
        // "Add user" helper field — appends to the list.
        const addEl = panel.querySelector('#vtf-ignore-add');
        const addBtn = panel.querySelector('#vtf-ignore-add-btn');
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
        addEl.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
        });

        // Collapse / expand.
        const collapseBtn = panel.querySelector('#vtf-collapse');
        collapseBtn.addEventListener('click', () => {
          panel.classList.toggle('collapsed');
          collapseBtn.textContent = panel.classList.contains('collapsed') ? '▸' : '▾';
        });

        makeDraggable(panel, panel.querySelector('#vtf-reader-header'));
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
