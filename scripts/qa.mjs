#!/usr/bin/env node
/**
 * Multi-Browser Interactive QA Driver for Codebusters
 *
 * Launches and controls two isolated, persistent Chrome instances side-by-side
 * over loopback Chrome DevTools Protocol (CDP) with zero external dependencies:
 *   - Browser A: ../qa/user-a (127.0.0.1:9222, left window)
 *   - Browser B: ../qa/user-b (127.0.0.1:9223, right window)
 *
 * Security invariants:
 *   - CDP binds strictly to 127.0.0.1 (never 0.0.0.0).
 *   - Navigation URLs are restricted to http://localhost:5173 (required by Firebase OAuth).
 *   - Profile and screenshot paths are resolved and boundary-checked inside ../qa/.
 *   - Never reads or logs auth tokens, cookies, or raw email addresses.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, '..');
const QA_ROOT = path.resolve(APP_ROOT, '..', 'qa');
const SCREENSHOTS_DIR = path.join(QA_ROOT, 'screenshots');

const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_APP_ORIGIN = 'http://localhost:5173';

const SLOTS = {
  a: {
    id: 'a',
    label: 'Browser A',
    port: 9222,
    profileDir: path.join(QA_ROOT, 'user-a'),
    windowPos: '30,50',
    windowSize: '700,860',
  },
  b: {
    id: 'b',
    label: 'Browser B',
    port: 9223,
    profileDir: path.join(QA_ROOT, 'user-b'),
    windowPos: '750,50',
    windowSize: '700,860',
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensurePrivateDir(dirPath) {
  const resolved = path.resolve(dirPath);
  if (resolved !== QA_ROOT && !resolved.startsWith(QA_ROOT + path.sep)) {
    throw new Error(`Refusing to create directory outside QA root: ${resolved}`);
  }
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
}

function resolveSlots(targetArg = 'both') {
  const normalized = String(targetArg).toLowerCase();
  if (normalized === 'both' || normalized === 'all') {
    return [SLOTS.a, SLOTS.b];
  }
  if (normalized === 'a' || normalized === 'user-a') {
    return [SLOTS.a];
  }
  if (normalized === 'b' || normalized === 'user-b') {
    return [SLOTS.b];
  }
  throw new Error(`Invalid browser slot "${targetArg}". Expected "a", "b", or "both".`);
}

function normalizeLocalAppUrl(rawInput) {
  if (!rawInput) return DEFAULT_APP_ORIGIN;
  const candidate = rawInput.startsWith('/')
    ? `${DEFAULT_APP_ORIGIN}${rawInput}`
    : rawInput;
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'http:' || parsed.hostname !== 'localhost') {
    throw new Error(
      `Refusing non-localhost URL "${rawInput}". Use http://localhost:5173/... so Firebase OAuth works safely.`
    );
  }
  return parsed.toString();
}

function maskEmails(text) {
  if (!text) return '';
  return String(text).replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    '***@***'
  );
}

async function fetchJson(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function isCdpAlive(port) {
  const info = await fetchJson(`http://127.0.0.1:${port}/json/version`, 1000);
  return Boolean(info && info.webSocketDebuggerUrl);
}

async function getAppPageTarget(slot) {
  const targets = await fetchJson(`http://127.0.0.1:${slot.port}/json/list`, 1500);
  if (!Array.isArray(targets)) {
    throw new Error(
      `${slot.label} (127.0.0.1:${slot.port}) is not reachable. Run "launch" first.`
    );
  }
  const pages = targets.filter(
    (t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string'
  );
  const appPage =
    pages.find((t) => String(t.url || '').startsWith(DEFAULT_APP_ORIGIN)) ||
    pages.find(
      (t) =>
        !String(t.url || '').startsWith('devtools://') &&
        !String(t.url || '').startsWith('chrome-extension://')
    );
  if (!appPage) {
    throw new Error(`No page target found in ${slot.label}.`);
  }
  return appPage;
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Timed out connecting to CDP WebSocket ${this.wsUrl}`));
      }, 4000);

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`CDP WebSocket error: ${err?.message || 'connection failed'}`));
      });
      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
            const entry = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) {
              entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
              entry.resolve(msg.result);
            }
          }
        } catch {
          // Ignore malformed event frames
        }
      });
      ws.addEventListener('close', () => {
        for (const [, entry] of this.pending) {
          entry.reject(new Error('CDP WebSocket closed unexpectedly'));
        }
        this.pending.clear();
      });
    });
  }

  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP WebSocket is not open'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res?.exceptionDetails) {
      const desc =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        'Runtime evaluation error';
      throw new Error(desc);
    }
    return res?.result?.value;
  }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

function viewportFileForSlot(slot) {
  return path.join(slot.profileDir, 'qa-viewport.json');
}

function readSavedViewport(slot) {
  try {
    const raw = fs.readFileSync(viewportFileForSlot(slot), 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number' &&
      parsed.width > 0 &&
      parsed.height > 0
    ) {
      return {
        width: parsed.width,
        height: parsed.height,
        mobile: Boolean(parsed.mobile),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function withPageSession(slot, fn) {
  const target = await getAppPageTarget(slot);
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.connect();
  try {
    const savedViewport = readSavedViewport(slot);
    if (savedViewport) {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: savedViewport.width,
        height: savedViewport.height,
        deviceScaleFactor: 2,
        mobile: savedViewport.mobile,
      });
      await session.evaluate(
        "window.dispatchEvent(new Event('resize')); window.visualViewport?.dispatchEvent(new Event('resize')); true"
      );
      await sleep(60);
    }
    return await fn(session, target);
  } finally {
    session.close();
  }
}

function pidFileForSlot(slot) {
  return path.join(slot.profileDir, 'qa.pid');
}

function readSavedPid(slot) {
  try {
    const raw = fs.readFileSync(pidFileForSlot(slot), 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function closeSlot(slot) {
  const alive = await isCdpAlive(slot.port);
  if (alive) {
    const ver = await fetchJson(`http://127.0.0.1:${slot.port}/json/version`, 1000);
    if (ver?.webSocketDebuggerUrl) {
      const session = new CdpSession(ver.webSocketDebuggerUrl);
      try {
        await session.connect();
        await session.send('Browser.close');
      } catch {
        // Ignore close race
      } finally {
        session.close();
      }
    }
  }

  const pid = readSavedPid(slot);
  if (pid && isPidAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Ignore if already exited
    }
  }

  for (let i = 0; i < 20; i++) {
    const stillCdp = await isCdpAlive(slot.port);
    const stillPid = pid ? isPidAlive(pid) : false;
    if (!stillCdp && !stillPid) break;
    await sleep(150);
  }

  try {
    fs.unlinkSync(pidFileForSlot(slot));
  } catch {
    // Ignore missing pid file
  }
}

async function launchSlot(slot, appUrl, { withCdp = true } = {}) {
  if (!fs.existsSync(CHROME_BIN)) {
    throw new Error(`Google Chrome binary not found at ${CHROME_BIN}`);
  }
  ensurePrivateDir(QA_ROOT);
  ensurePrivateDir(slot.profileDir);

  if (withCdp && (await isCdpAlive(slot.port))) {
    console.log(
      `[${slot.label}] Already running on 127.0.0.1:${slot.port} (${slot.profileDir})`
    );
    return;
  }

  const args = [
    `--user-data-dir=${slot.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-position=${slot.windowPos}`,
    `--window-size=${slot.windowSize}`,
  ];

  if (withCdp) {
    args.push(
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${slot.port}`
    );
  }

  args.push(appUrl);

  const child = spawn(CHROME_BIN, args, {
    detached: true,
    stdio: 'ignore',
    shell: false,
  });
  child.unref();

  if (child.pid) {
    fs.writeFileSync(pidFileForSlot(slot), String(child.pid), { mode: 0o600 });
  }

  if (!withCdp) {
    console.log(
      `[${slot.label}] Launched in login-only mode (PID ${child.pid}) at ${appUrl}`
    );
    return;
  }

  for (let i = 0; i < 40; i++) {
    if (await isCdpAlive(slot.port)) {
      console.log(
        `[${slot.label}] Ready on 127.0.0.1:${slot.port} -> ${appUrl} (${slot.profileDir})`
      );
      return;
    }
    await sleep(200);
  }
  throw new Error(
    `[${slot.label}] Timed out waiting for CDP on 127.0.0.1:${slot.port}. Close any existing Chrome using ${slot.profileDir} and retry.`
  );
}

const DOM_INSPECT_SNIPPET = `(() => {
  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter(isVisible)
    .map((el) => clean(el.textContent))
    .filter(Boolean);

  const authBadgeEl = document.querySelector(
    '.auth-user-name, .user-badge, .header-auth, .login-card, .access-denied-card'
  );
  const authSummary = authBadgeEl && isVisible(authBadgeEl) ? clean(authBadgeEl.textContent) : null;

  const banners = Array.from(
    document.querySelectorAll('.teammate-submit-banner, [role="status"], .cohort-error-banner')
  )
    .filter(isVisible)
    .map((el) => clean(el.textContent))
    .filter(Boolean);

  const openDialog = Array.from(
    document.querySelectorAll('[role="dialog"], .cohort-modal-card, .briefing-modal, .confirm-modal')
  ).find(isVisible);

  let modal = null;
  if (openDialog) {
    const titleEl = openDialog.querySelector('h1, h2, h3');
    const rollcallRows = Array.from(openDialog.querySelectorAll('.team-rollcall-row'))
      .filter(isVisible)
      .map((row) => ({
        check: clean(row.querySelector('.rollcall-check')?.textContent),
        name: clean(row.querySelector('.rollcall-name')?.textContent),
        state: clean(row.querySelector('.rollcall-state')?.textContent),
      }));
    const checkboxes = Array.from(openDialog.querySelectorAll('input[type="checkbox"]'))
      .filter((cb) => isVisible(cb) || isVisible(cb.parentElement))
      .map((cb) => ({
        label: clean(cb.closest('label')?.textContent || cb.getAttribute('aria-label') || 'checkbox'),
        checked: Boolean(cb.checked),
      }));
    const modalButtons = Array.from(openDialog.querySelectorAll('button'))
      .filter(isVisible)
      .map((b) => ({
        text: clean(b.textContent),
        disabled: Boolean(b.disabled),
      }));
    const rosterItems = Array.from(
      openDialog.querySelectorAll('.cohort-group-card, .cohort-unassigned-chip, .cohort-attempt-bar')
    )
      .filter(isVisible)
      .map((el) => clean(el.textContent));

    modal = {
      title: clean(titleEl?.textContent),
      text: clean(openDialog.textContent).slice(0, 500),
      rollcallRows,
      checkboxes,
      rosterItems,
      buttons: modalButtons,
    };
  }

  const testRows = Array.from(document.querySelectorAll('.test-list-row, .test-row, .practice-test-card, .test-list-item'))
    .filter(isVisible)
    .map((row) => ({
      text: clean(row.textContent),
      buttons: Array.from(row.querySelectorAll('button'))
        .filter(isVisible)
        .map((b) => clean(b.textContent)),
    }));

  let runner = null;
  const navTabs = Array.from(document.querySelectorAll('.test-nav-tab')).filter(isVisible);
  if (navTabs.length > 0) {
    const clock = clean(document.querySelector('.test-countdown-clock')?.textContent);
    const headerMeta = clean(document.querySelector('.test-header-meta')?.textContent);
    const tabs = navTabs.map((t) => ({
      label: clean(t.querySelector('.tab-q-label')?.textContent),
      status: clean(t.querySelector('.tab-status-icon')?.textContent),
      presence: Array.from(t.querySelectorAll('.tab-presence-chip')).map((c) =>
        clean(c.textContent)
      ),
      active: t.classList.contains('tab-active'),
    }));

    const alphaInputs = Array.from(document.querySelectorAll('.tile-native-input'));
    const activeAlphaIdx = alphaInputs.findIndex((inp) =>
      inp.closest('.char-tile')?.classList.contains('active-tile')
    );

    const words = Array.from(document.querySelectorAll('.word-cluster'))
      .slice(0, 12)
      .map((cluster, wIdx) => {
        const tiles = Array.from(cluster.querySelectorAll('.char-tile'));
        const cipherChars = tiles
          .map((t) => clean(t.querySelector('.tile-cipher')?.textContent || t.querySelector('.tile-punct')?.textContent))
          .join('');
        const userChars = tiles
          .map((t) => {
            const inp = t.querySelector('.tile-native-input');
            if (!inp) return clean(t.querySelector('.tile-punct')?.textContent) || '';
            return inp.value ? inp.value : '_';
          })
          .join('');
        return \`W\${wIdx + 1}:\${userChars}(\${cipherChars})\`;
      });

    runner = {
      headerMeta,
      clock,
      tabs,
      totalAlphaTiles: alphaInputs.length,
      filledAlphaTiles: alphaInputs.filter((inp) => Boolean(inp.value)).length,
      activeAlphaIdx,
      wordsPreview: words,
    };
  }

  const resultsEl = document.querySelector('.test-results-container, .results-hero-card, .results-summary');
  const resultsSummary = resultsEl && isVisible(resultsEl) ? clean(resultsEl.textContent).slice(0, 500) : null;

  const buttons = Array.from(document.querySelectorAll('button'))
    .filter(isVisible)
    .map((b) => ({
      text: clean(b.textContent || b.getAttribute('aria-label') || b.getAttribute('title')),
      disabled: Boolean(b.disabled),
    }))
    .filter((b) => Boolean(b.text));

  return {
    url: window.location.href,
    title: document.title,
    viewport: \`\${window.innerWidth}x\${window.innerHeight}\`,
    headings,
    authSummary,
    banners,
    modal,
    testRows,
    runner,
    resultsSummary,
    buttons,
  };
})()`;

function printSnapshot(slot, snap, compact = false) {
  console.log(`\n=== ${slot.label} (127.0.0.1:${slot.port}) ===`);
  console.log(`URL:      ${snap.url}  [Viewport: ${snap.viewport}]`);
  if (snap.headings?.length) {
    console.log(`Headings: ${maskEmails(snap.headings.join(' | '))}`);
  }
  if (snap.authSummary) {
    console.log(`Auth UI:  ${maskEmails(snap.authSummary)}`);
  }
  if (snap.banners?.length) {
    console.log(`Banners:  ${maskEmails(snap.banners.join(' || '))}`);
  }
  if (snap.modal) {
    console.log(`Modal:    ${maskEmails(snap.modal.title || '(Open Dialog)')}`);
    if (snap.modal.rollcallRows?.length) {
      for (const r of snap.modal.rollcallRows) {
        console.log(`  RollCall: [${r.check}] ${maskEmails(r.name)} — ${maskEmails(r.state)}`);
      }
    }
    if (snap.modal.checkboxes?.length) {
      for (const cb of snap.modal.checkboxes) {
        console.log(`  Checkbox: [${cb.checked ? 'x' : ' '}] ${maskEmails(cb.label)}`);
      }
    }
    if (!compact && snap.modal.rosterItems?.length) {
      for (const item of snap.modal.rosterItems) {
        console.log(`  CohortUI: ${maskEmails(item)}`);
      }
    }
    if (snap.modal.buttons?.length) {
      console.log(
        `  ModalBtns: ${snap.modal.buttons
          .map((b) => `${maskEmails(b.text)}${b.disabled ? ' (disabled)' : ''}`)
          .join(' | ')}`
      );
    }
  }
  if (!compact && snap.testRows?.length) {
    for (const row of snap.testRows) {
      console.log(`TestRow:  ${maskEmails(row.text)}`);
    }
  }
  if (snap.runner) {
    const r = snap.runner;
    console.log(`Runner:   ${r.headerMeta} | ${r.clock}`);
    console.log(
      `  Tabs:   ${r.tabs
        .map((t) => {
          const pres = t.presence.length ? ` {👥 ${t.presence.join(',')}}` : '';
          return `${t.active ? '*' : ''}[${t.label}${t.status ? ' ' + t.status : ''}${pres}]`;
        })
        .join(' ')}`
    );
    console.log(
      `  Tiles:  ${r.filledAlphaTiles}/${r.totalAlphaTiles} filled (activeAlphaIdx=${r.activeAlphaIdx})`
    );
    if (r.wordsPreview?.length) {
      console.log(`  Words:  ${r.wordsPreview.join('  ')}`);
    }
  }
  if (snap.resultsSummary) {
    console.log(`Results:  ${maskEmails(snap.resultsSummary)}`);
  }
  if (!compact && snap.buttons?.length) {
    console.log(
      `Buttons:  ${snap.buttons
        .slice(0, 25)
        .map((b) => `[${maskEmails(b.text)}${b.disabled ? ':disabled' : ''}]`)
        .join(' ')}`
    );
  }
}

async function cmdStatus() {
  for (const slot of [SLOTS.a, SLOTS.b]) {
    const alive = await isCdpAlive(slot.port);
    if (!alive) {
      const pid = readSavedPid(slot);
      console.log(
        `\n=== ${slot.label} (127.0.0.1:${slot.port}) ===\nStatus: OFFLINE${
          pid && isPidAlive(pid) ? ` (running in login-only mode, PID ${pid})` : ''
        }`
      );
      continue;
    }
    try {
      await withPageSession(slot, async (session) => {
        const snap = await session.evaluate(DOM_INSPECT_SNIPPET);
        printSnapshot(slot, snap, true);
      });
    } catch (err) {
      console.log(`\n=== ${slot.label} ===\nError: ${err.message}`);
    }
  }
}

async function cmdInspect(targetArg = 'both') {
  const slots = resolveSlots(targetArg);
  for (const slot of slots) {
    await withPageSession(slot, async (session) => {
      const snap = await session.evaluate(DOM_INSPECT_SNIPPET);
      printSnapshot(slot, snap, false);
    });
  }
}

async function cmdClick(slotArg, query, indexArg = '0') {
  const [slot] = resolveSlots(slotArg);
  if (!query) throw new Error('Usage: qa.mjs click <a|b> <textOrCssQuery> [index]');
  const occurrence = Number.parseInt(indexArg, 10) || 0;

  await withPageSession(slot, async (session) => {
    const clickExpr = `((query, occ) => {
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      let matches = [];
      if (query.startsWith('css:')) {
        const sel = query.slice(4);
        matches = Array.from(document.querySelectorAll(sel)).filter(isVisible);
      } else {
        const needle = query.toLowerCase().trim();
        // Prefer elements inside an open dialog first if one is open
        const openDialog = Array.from(
          document.querySelectorAll('[role="dialog"], .cohort-modal-card, .briefing-modal, .confirm-modal')
        ).find(isVisible);

        const searchRoot = openDialog || document;
        const candidates = Array.from(
          searchRoot.querySelectorAll('button, a, label, [role="button"], input[type="checkbox"]')
        ).filter(isVisible);

        const exact = candidates.filter((el) => {
          const label = clean(
            el.textContent || el.getAttribute('aria-label') || el.getAttribute('title')
          ).toLowerCase();
          return label === needle;
        });

        const partial = candidates.filter((el) => {
          const label = clean(
            el.textContent || el.getAttribute('aria-label') || el.getAttribute('title')
          ).toLowerCase();
          return label.includes(needle);
        });

        matches = exact.length > 0 ? exact : partial;

        // Fallback to full document if openDialog didn't contain needle
        if (matches.length === 0 && openDialog) {
          const docCandidates = Array.from(
            document.querySelectorAll('button, a, label, [role="button"], input[type="checkbox"]')
          ).filter(isVisible);
          matches = docCandidates.filter((el) => {
            const label = clean(
              el.textContent || el.getAttribute('aria-label') || el.getAttribute('title')
            ).toLowerCase();
            return label.includes(needle);
          });
        }
      }

      const target = matches[occ];
      if (!target) {
        return { ok: false, count: matches.length };
      }
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return {
        ok: true,
        tag: target.tagName.toLowerCase(),
        label: clean(target.textContent || target.getAttribute('aria-label') || target.getAttribute('title')).slice(0, 120),
      };
    })(${JSON.stringify(query)}, ${occurrence})`;

    const res = await session.evaluate(clickExpr);
    if (!res?.ok) {
      throw new Error(
        `[${slot.label}] Could not find clickable match #${occurrence} for "${query}".`
      );
    }
    console.log(`[${slot.label}] Clicked <${res.tag}> "${maskEmails(res.label)}"`);
    await sleep(350);
    const snap = await session.evaluate(DOM_INSPECT_SNIPPET);
    printSnapshot(slot, snap, true);
  });
}

async function cmdFill(slotArg, query, value = '') {
  const [slot] = resolveSlots(slotArg);
  if (!query) throw new Error('Usage: qa.mjs fill <a|b> <cssOrPlaceholder> <value>');

  await withPageSession(slot, async (session) => {
    const fillExpr = `((query, val) => {
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      let el = null;
      if (query.startsWith('css:')) {
        el = Array.from(document.querySelectorAll(query.slice(4))).find(isVisible);
      } else {
        const needle = query.toLowerCase();
        el = Array.from(document.querySelectorAll('input, textarea'))
          .filter(isVisible)
          .find((inp) => {
            const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
            const aria = (inp.getAttribute('aria-label') || '').toLowerCase();
            return ph.includes(needle) || aria.includes(needle);
          });
      }
      if (!el) return { ok: false };
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(el, val);
      } else {
        el.value = val;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })(${JSON.stringify(query)}, ${JSON.stringify(value)})`;

    const res = await session.evaluate(fillExpr);
    if (!res?.ok) {
      throw new Error(`[${slot.label}] Could not find input matching "${query}".`);
    }
    console.log(`[${slot.label}] Filled "${query}"`);
    await sleep(200);
  });
}

async function cmdFocusTile(slotArg, indexStr = '0') {
  const [slot] = resolveSlots(slotArg);
  const alphaIdx = Number.parseInt(indexStr, 10);
  if (!Number.isFinite(alphaIdx) || alphaIdx < 0) {
    throw new Error('Usage: qa.mjs focus-tile <a|b> <alphaIndex>');
  }

  await withPageSession(slot, async (session) => {
    const res = await session.evaluate(`((idx) => {
      const inputs = Array.from(document.querySelectorAll('.tile-native-input'));
      const target = inputs[idx];
      if (!target) return { ok: false, total: inputs.length };
      target.closest('.char-tile')?.click();
      target.focus({ preventScroll: true });
      return { ok: true, total: inputs.length, currentVal: target.value };
    })(${alphaIdx})`);

    if (!res?.ok) {
      throw new Error(
        `[${slot.label}] Alpha tile index ${alphaIdx} out of range (total=${res?.total ?? 0}).`
      );
    }
    console.log(
      `[${slot.label}] Focused alpha tile #${alphaIdx} (of ${res.total})`
    );
  });
}

const KEY_DEFS = {
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
};

async function dispatchCharKey(session, ch) {
  const upper = ch.toUpperCase();
  const isAlpha = upper >= 'A' && upper <= 'Z';
  const vk = isAlpha ? upper.charCodeAt(0) : ch.charCodeAt(0);
  const code = isAlpha ? `Key${upper}` : '';

  await session.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: ch,
    code,
    text: ch,
    unmodifiedText: ch,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: ch,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
}

async function cmdType(slotArg, text = '') {
  const [slot] = resolveSlots(slotArg);
  if (!text) throw new Error('Usage: qa.mjs type <a|b> <letters>');

  await withPageSession(slot, async (session) => {
    for (const ch of String(text)) {
      if (ch === ' ') continue; // QuoteTileGrid skips spaces automatically
      await dispatchCharKey(session, ch);
      await sleep(40);
    }
    // Allow 220ms so 150ms per-cell Firestore debounce flushes cleanly!
    await sleep(220);
    const snap = await session.evaluate(DOM_INSPECT_SNIPPET);
    printSnapshot(slot, snap, true);
  });
}

async function cmdKey(slotArg, keyName) {
  const [slot] = resolveSlots(slotArg);
  const def = KEY_DEFS[keyName];
  if (!def) {
    throw new Error(
      `Unsupported key "${keyName}". Supported: ${Object.keys(KEY_DEFS).join(', ')}`
    );
  }

  await withPageSession(slot, async (session) => {
    await session.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.vk,
      nativeVirtualKeyCode: def.vk,
    });
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.vk,
      nativeVirtualKeyCode: def.vk,
    });
    await sleep(220);
    const snap = await session.evaluate(DOM_INSPECT_SNIPPET);
    printSnapshot(slot, snap, true);
  });
}

async function cmdGoto(targetArg, rawUrl) {
  const slots = resolveSlots(targetArg);
  const url = normalizeLocalAppUrl(rawUrl || '/');
  for (const slot of slots) {
    await withPageSession(slot, async (session) => {
      await session.send('Page.navigate', { url });
      await sleep(600);
      const snap = await session.evaluate(DOM_INSPECT_SNIPPET);
      printSnapshot(slot, snap, true);
    });
  }
}

async function cmdViewport(targetArg, preset = 'desktop') {
  const slots = resolveSlots(targetArg);
  for (const slot of slots) {
    ensurePrivateDir(slot.profileDir);
    const vpFile = viewportFileForSlot(slot);
    if (preset === 'reset' || preset === 'clear') {
      try {
        fs.unlinkSync(vpFile);
      } catch {
        // Ignore if not present
      }
      await withPageSession(slot, async (session) => {
        await session.send('Emulation.clearDeviceMetricsOverride');
      });
      console.log(`[${slot.label}] Cleared viewport override`);
      continue;
    }

    let width = 1280;
    let height = 800;
    let mobile = false;
    if (preset === 'mobile') {
      width = 390;
      height = 844;
      mobile = true;
    } else if (/^\d+x\d+$/i.test(preset)) {
      const [w, h] = preset.toLowerCase().split('x').map(Number);
      width = w;
      height = h;
      mobile = w < 600;
    }

    fs.writeFileSync(
      vpFile,
      JSON.stringify({ width, height, mobile }),
      { mode: 0o600 }
    );
    await withPageSession(slot, async () => {});
    console.log(`[${slot.label}] Viewport set to ${width}x${height} (mobile=${mobile})`);
  }
}

async function cmdScreenshot(targetArg = 'both', rawName = 'capture') {
  const slots = resolveSlots(targetArg);
  ensurePrivateDir(QA_ROOT);
  ensurePrivateDir(SCREENSHOTS_DIR);

  const safeBase = path
    .basename(String(rawName))
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/\.png$/i, '');

  for (const slot of slots) {
    const fileName =
      slots.length > 1 ? `${safeBase}-${slot.id}.png` : `${safeBase}.png`;
    const outPath = path.resolve(SCREENSHOTS_DIR, fileName);
    if (!outPath.startsWith(SCREENSHOTS_DIR + path.sep)) {
      throw new Error('Invalid screenshot output path');
    }

    await withPageSession(slot, async (session) => {
      const res = await session.send('Page.captureScreenshot', { format: 'png' });
      if (!res?.data) throw new Error('Empty screenshot payload');
      fs.writeFileSync(outPath, Buffer.from(res.data, 'base64'), { mode: 0o600 });
      console.log(`[${slot.label}] Saved screenshot -> ${outPath}`);
    });
  }
}

function printHelp() {
  console.log(`Usage: node scripts/qa.mjs <command> [args]

Commands:
  launch [a|b|both] [url]        Launch side-by-side Chrome instances with loopback CDP
  launch-login [a|b|both] [url]  Fallback: launch without CDP flag for Google OAuth sign-in
  close [a|b|both]               Cleanly close QA Chrome instance(s)
  status                         Compact status of Browser A & Browser B
  inspect [a|b|both]             Detailed DOM & state inspection
  click <a|b> <query> [index]    Click button/link/label/checkbox by text or "css:<sel>"
  fill <a|b> <query> <value>     Fill text input by placeholder/aria-label or "css:<sel>"
  focus-tile <a|b> <alphaIndex>  Focus the N-th alphabetic tile in QuoteTileGrid
  type <a|b> <letters>           Type letters via native CDP key events
  key <a|b> <keyName>            Send special key (Backspace, ArrowLeft, ArrowRight, Enter, Escape)
  goto <a|b|both> <pathOrUrl>    Navigate to http://localhost:5173/...
  viewport <a|b|both> <preset>   Set viewport (desktop | mobile | WxH | reset)
  screenshot [a|b|both] [name]   Save PNG screenshot(s) under ../qa/screenshots/
`);
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || cmd === 'help' || cmd === '--help') {
    printHelp();
    return;
  }

  switch (cmd) {
    case 'launch': {
      const slotCandidate = args[0] && ['a', 'b', 'both', 'all'].includes(args[0]) ? args[0] : 'both';
      const urlCandidate = slotCandidate === args[0] ? args[1] : args[0];
      const appUrl = normalizeLocalAppUrl(urlCandidate || DEFAULT_APP_ORIGIN);
      for (const slot of resolveSlots(slotCandidate)) {
        await launchSlot(slot, appUrl, { withCdp: true });
      }
      break;
    }
    case 'launch-login': {
      const slotCandidate = args[0] && ['a', 'b', 'both', 'all'].includes(args[0]) ? args[0] : 'both';
      const urlCandidate = slotCandidate === args[0] ? args[1] : args[0];
      const appUrl = normalizeLocalAppUrl(urlCandidate || DEFAULT_APP_ORIGIN);
      for (const slot of resolveSlots(slotCandidate)) {
        await closeSlot(slot);
        await launchSlot(slot, appUrl, { withCdp: false });
      }
      break;
    }
    case 'close': {
      for (const slot of resolveSlots(args[0] || 'both')) {
        await closeSlot(slot);
        console.log(`[${slot.label}] Closed.`);
      }
      break;
    }
    case 'status':
      await cmdStatus();
      break;
    case 'inspect':
      await cmdInspect(args[0] || 'both');
      break;
    case 'click':
      await cmdClick(args[0], args[1], args[2]);
      break;
    case 'fill':
      await cmdFill(args[0], args[1], args[2]);
      break;
    case 'focus-tile':
      await cmdFocusTile(args[0], args[1]);
      break;
    case 'type':
      await cmdType(args[0], args[1]);
      break;
    case 'key':
      await cmdKey(args[0], args[1]);
      break;
    case 'goto':
      await cmdGoto(args[0], args[1]);
      break;
    case 'viewport':
      await cmdViewport(args[0], args[1]);
      break;
    case 'screenshot':
      await cmdScreenshot(args[0] || 'both', args[1] || 'capture');
      break;
    default:
      throw new Error(`Unknown command "${cmd}". Run with --help for usage.`);
  }
}

main().catch((err) => {
  console.error(`QA Error: ${err?.message || String(err)}`);
  process.exitCode = 1;
});
