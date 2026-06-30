"use strict";

/* ============================================================ storage abstraction
 * One interface, runtime-detected backend, shared by every build of the app:
 *   - server      : the serve.py dev server (fetch /timeline + /mtime polling)
 *   - desktop      : Neutralino (direct filesystem read/write + stat polling)
 *   - fsaccess     : Chromium File System Access API (in-place file handle)
 *   - browser      : Firefox/Safari fallback (IndexedDB autosave + import/export)
 *
 * Public surface (see `store` at the bottom):
 *   store.init()                  -> picks a backend, sets store.capabilities
 *   store.load()                  -> { content, label, needsFile? }
 *   store.save(text)
 *   store.watch(cb)               -> cb(content) on external change (where supported)
 *   store.setBusyCheck(fn)        -> watcher skips while fn() is truthy (mid-edit)
 *   store.openFile/importFile/exportFile/pickSave (presence varies by backend)
 */

const DESKTOP_DOWNLOAD_URL = "https://github.com/USER/REPO/releases/latest";

/* ---- tiny IndexedDB key/value (file handles + browser-local document) ---- */
const IDB_NAME = "timeline-store", IDB_STORE = "kv";
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
    tx.onsuccess = () => res(tx.result);
    tx.onerror = () => rej(tx.error);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
const baseName = (p) => (p || "timeline").split(/[\\/]/).pop();

/* ---- desktop diagnostics: record bridge + dialog behaviour to a file we can read ---- */
const DIAG = [];
function neuLog(msg) {
  DIAG.push(new Date().toISOString().slice(11, 23) + " " + msg);
  try { Neutralino.filesystem.writeFile((window.NL_PATH || ".") + "/nl-diag.txt", DIAG.join("\n")); } catch (e) {}
}
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error((label || "call") + " timed out after " + ms + "ms")), ms))]);

// Neutralino's native os.showOpenDialog/showSaveDialog hang on some Linux (Wayland/GTK) setups,
// so on Linux we drive zenity (then yad) via execCommand instead — os.* calls themselves work.
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
// run a dialog helper as a tracked child process so we can kill it if the app closes mid-dialog
let dialogProc = null;
async function killDialog() {
  const p = dialogProc;
  if (!p) return;
  dialogProc = null;
  try { await Neutralino.os.updateSpawnedProcess(p.id, "exit"); } catch (e) {}
  // spawnProcess runs the helper under a shell, so also reap the actual dialog by name/parent
  try { await Neutralino.os.execCommand("pkill -P " + p.pid + " 2>/dev/null; pkill -f 'zenity --file-selection' 2>/dev/null; pkill -f 'yad --file' 2>/dev/null"); } catch (e) {}
}
function spawnDialog(cmd) {
  return new Promise((resolve, reject) => {
    let out = "";
    Neutralino.os.spawnProcess(cmd).then((proc) => {
      dialogProc = proc;
      const handler = (evt) => {
        if (!evt.detail || evt.detail.id !== proc.id) return;
        if (evt.detail.action === "stdOut") out += evt.detail.data;
        else if (evt.detail.action === "exit") {
          Neutralino.events.off("spawnedProcess", handler);
          if (dialogProc && dialogProc.id === proc.id) dialogProc = null;
          resolve({ exitCode: parseInt(evt.detail.data, 10) || 0, stdOut: out });
        }
      };
      Neutralino.events.on("spawnedProcess", handler);
    }).catch(reject);
  });
}
// run the helper so it dies if the app process (NL_PID) exits, regardless of JS shutdown timing,
// while still forwarding its stdout (the chosen path) and exit code to spawnProcess
function withWatchdog(inner) {
  const pid = window.NL_PID;
  if (!pid) return inner;
  return `f=$(mktemp); ${inner} >"$f" & cpid=$!; ( while kill -0 ${pid} 2>/dev/null; do sleep 0.4; done; kill "$cpid" 2>/dev/null ) & wpid=$!; wait "$cpid"; code=$?; kill "$wpid" 2>/dev/null; cat "$f"; rm -f "$f"; exit $code`;
}
async function linuxFileDialog({ save, suggested }) {
  const z = withWatchdog(save
    ? `zenity --file-selection --save --confirm-overwrite --title="Save timeline"${suggested ? " --filename=" + shq(suggested) : ""} --file-filter="Markdown | *.md *.markdown" --file-filter="All files | *"`
    : `zenity --file-selection --title="Open timeline" --file-filter="Markdown | *.md *.markdown" --file-filter="All files | *"`);
  const y = withWatchdog(save
    ? `yad --file --save --confirm-overwrite --title="Save timeline"${suggested ? " --filename=" + shq(suggested) : ""}`
    : `yad --file --title="Open timeline"`);
  for (const cmd of [z, y]) {
    let r;
    try { r = await spawnDialog(cmd); } catch (e) { neuLog("spawnDialog threw: " + (e && e.message ? e.message : e)); continue; }
    neuLog("dialog exit=" + r.exitCode + " out=" + JSON.stringify((r.stdOut || "").trim()));
    if (r.exitCode === 0) { const p = (r.stdOut || "").trim(); return p || null; }
    if (r.exitCode === 127) continue; // helper not installed -> try the next one
    return null; // user cancelled
  }
  return null;
}
const isLinux = () => window.NL_OS === "Linux";

/* ---- backend: serve.py dev server ---- */
function makeServerBackend(initial) {
  let mtime = initial.mtime || 0;
  return {
    capabilities: { name: "server", inPlace: true, watch: true, importExport: false },
    async load() { return { content: initial.content || "", label: baseName(initial.path) }; },
    async save(text) {
      const res = await fetch("/timeline", { method: "POST", headers: { "Content-Type": "text/markdown" }, body: text });
      const d = await res.json().catch(() => ({}));
      if (d.mtime) mtime = d.mtime;
    },
    watch(cb, busy) {
      setInterval(async () => {
        if (busy()) return;
        try {
          const d = await (await fetch("/mtime")).json();
          if (!d.mtime || d.mtime === mtime) return;
          const d2 = await (await fetch("/timeline")).json();
          mtime = d2.mtime || mtime;
          cb(d2.content);
        } catch (e) { /* server momentarily unavailable */ }
      }, 1200);
    },
  };
}
async function detectServer() {
  try {
    const res = await fetch("/timeline", { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") || "").includes("json")) return null;
    const data = await res.json();
    if (typeof data.content !== "string" || !("path" in data)) return null;
    return makeServerBackend(data);
  } catch (e) { return null; }
}

/* ---- backend: Neutralino desktop ---- */
async function detectNeutralino() {
  const inNeu = typeof window.NL_PORT !== "undefined" || typeof window.NL_TOKEN !== "undefined" || typeof window.NL_ARGS !== "undefined";
  if (!inNeu || !window.Neutralino) return null;
  try {
    await Neutralino.init();
    neuLog("init done; NL_OS=" + window.NL_OS + " NL_PORT=" + window.NL_PORT + " NL_MODE=" + window.NL_MODE + " NL_VERSION=" + window.NL_VERSION);
    // kill any open native dialog so it doesn't linger after the window is gone
    Neutralino.events.on("windowClose", async () => {
      await killDialog();
      Neutralino.app.exit();
    });
    // fire-and-forget bridge probe (does not block startup); records to nl-diag.txt
    withTimeout(Neutralino.os.getEnv("HOME"), 5000, "getEnv")
      .then((h) => neuLog("bridge OK; getEnv HOME=" + h))
      .catch((e) => neuLog("bridge PROBE FAILED: " + (e && e.message ? e.message : e)));
    let path = null;
    try { path = await Neutralino.storage.getData("timelinePath"); } catch (e) { path = null; }
    return makeNeutralinoBackend(path);
  } catch (e) { return null; }
}
function makeNeutralinoBackend(path) {
  let mtime = 0;
  const readMtime = async () => { try { const st = await Neutralino.filesystem.getStats(path); mtime = st.modifiedAt || 0; } catch (e) {} };
  return {
    capabilities: { name: "desktop", inPlace: true, watch: true, importExport: true },
    async load() {
      if (!path) return { content: "", label: "(no file)", needsFile: true };
      let content = "";
      try { content = await Neutralino.filesystem.readFile(path); } catch (e) { content = ""; }
      await readMtime();
      return { content, label: baseName(path) };
    },
    async save(text) {
      if (!path) return;
      await Neutralino.filesystem.writeFile(path, text);
      await readMtime();
    },
    watch(cb, busy) {
      setInterval(async () => {
        if (busy() || !path) return;
        try {
          const st = await Neutralino.filesystem.getStats(path);
          if (st.modifiedAt && st.modifiedAt !== mtime) { mtime = st.modifiedAt; cb(await Neutralino.filesystem.readFile(path)); }
        } catch (e) {}
      }, 1200);
    },
    async openFile() {
      let opened;
      if (isLinux()) opened = await linuxFileDialog({ save: false });
      else { const r = await Neutralino.os.showOpenDialog("Open a timeline (.md)", { filters: [{ name: "Markdown", extensions: ["md"] }] }); opened = r && r.length ? r[0] : null; }
      if (!opened) return null;
      path = opened;
      await Neutralino.storage.setData("timelinePath", path);
      return this.load();
    },
    async pickSave(text) {
      let dest;
      if (isLinux()) dest = await linuxFileDialog({ save: true, suggested: "timeline.md" });
      else dest = await Neutralino.os.showSaveDialog("New timeline (.md)", { defaultPath: "timeline.md", filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (!dest) return null;
      if (!/\.md$/i.test(dest)) dest += ".md";
      path = dest;
      await Neutralino.storage.setData("timelinePath", path);
      await Neutralino.filesystem.writeFile(path, text || "");
      await readMtime();
      return { content: text || "", label: baseName(path) };
    },
    async exportFile(text) {
      let dest;
      if (isLinux()) dest = await linuxFileDialog({ save: true, suggested: "timeline.md" });
      else dest = await Neutralino.os.showSaveDialog("Export a copy (.md)", { filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (!dest) return;
      if (!/\.md$/i.test(dest)) dest += ".md";
      await Neutralino.filesystem.writeFile(dest, text);
    },
    async forgetFile() { path = null; try { await Neutralino.storage.setData("timelinePath", ""); } catch (e) {} },
  };
}

/* ---- backend: Chromium File System Access ---- */
function makeFsAccessBackend() {
  const HKEY = "fsaHandle";
  let handle = null, lastMod = 0;
  const MD_TYPES = [{ description: "Markdown", accept: { "text/markdown": [".md"], "text/plain": [".md", ".markdown", ".txt"] } }];
  const granted = async (h) => { try { return (await h.queryPermission({ mode: "readwrite" })) === "granted"; } catch (e) { return false; } };
  const request = async (h) => { try { return (await h.requestPermission({ mode: "readwrite" })) === "granted"; } catch (e) { return false; } };
  const readFrom = async (h) => { const f = await h.getFile(); lastMod = f.lastModified; return f.text(); };
  const writeTo = async (h, text) => { const w = await h.createWritable(); await w.write(text); await w.close(); try { lastMod = (await h.getFile()).lastModified; } catch (e) {} };
  return {
    capabilities: { name: "fsaccess", inPlace: true, watch: true, importExport: true },
    async load() {
      handle = (await idbGet(HKEY)) || null;
      if (handle && (await granted(handle))) return { content: await readFrom(handle), label: handle.name };
      handle = null;
      return { content: "", label: "(no file)", needsFile: true };
    },
    async save(text) { if (handle) await writeTo(handle, text); },
    watch(cb, busy) {
      setInterval(async () => {
        if (busy() || !handle) return;
        try { const f = await handle.getFile(); if (f.lastModified !== lastMod) { lastMod = f.lastModified; cb(await f.text()); } } catch (e) {}
      }, 1500);
    },
    async openFile() {
      const [h] = await window.showOpenFilePicker({ types: MD_TYPES });
      if (!(await granted(h)) && !(await request(h))) return null;
      handle = h; await idbSet(HKEY, handle);
      return { content: await readFrom(h), label: h.name };
    },
    async pickSave(text) {
      const h = await window.showSaveFilePicker({ suggestedName: "timeline.md", types: MD_TYPES });
      handle = h; await idbSet(HKEY, handle); await writeTo(h, text || "");
      return { content: text || "", label: h.name };
    },
    async importFile() { return this.openFile(); },
    async exportFile(text) { return this.pickSave(text); },
    async forgetFile() { handle = null; try { await idbSet(HKEY, null); } catch (e) {} },
  };
}

/* ---- backend: browser-local (Firefox / Safari) ---- */
function makeBrowserBackend() {
  const KEY = "timelineDoc";
  return {
    capabilities: { name: "browser", inPlace: false, watch: false, importExport: true },
    async load() { const content = await idbGet(KEY); return { content: typeof content === "string" ? content : "", label: "(browser storage)" }; },
    async save(text) { await idbSet(KEY, text); },
    importFile() {
      return new Promise((resolve) => {
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = ".md,.markdown,text/markdown,text/plain";
        inp.onchange = async () => {
          const f = inp.files && inp.files[0];
          if (!f) { resolve(null); return; }
          const content = await f.text();
          await idbSet(KEY, content);
          resolve({ content, label: f.name });
        };
        inp.click();
      });
    },
    exportFile(text) {
      const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
      const a = document.createElement("a");
      a.href = url; a.download = "timeline.md";
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    async forgetFile() { await idbSet(KEY, ""); },
  };
}

async function detectBackend() {
  return (await detectNeutralino())
    || (await detectServer())
    || ((typeof window.showSaveFilePicker === "function" && window.isSecureContext) ? makeFsAccessBackend() : makeBrowserBackend());
}

const store = {
  backend: null,
  label: "epochlore",
  capabilities: { name: "none", inPlace: false, watch: false, importExport: false },
  desktopUrl: DESKTOP_DOWNLOAD_URL,
  _busy: () => false,
  setBusyCheck(fn) { this._busy = fn; },
  async init() {
    this.backend = await detectBackend();
    this.capabilities = this.backend.capabilities;
    return this.capabilities;
  },
  async load() { const r = await this.backend.load(); this.label = r.label || this.label; return r; },
  save(text) { return this.backend.save(text); },
  watch(cb) { if (this.backend.watch) this.backend.watch(cb, () => this._busy()); },
  async openFile() { if (!this.backend.openFile) return null; const r = await this.backend.openFile(); if (r) this.label = r.label || this.label; return r; },
  async importFile() { if (!this.backend.importFile) return null; const r = await this.backend.importFile(); if (r) this.label = r.label || this.label; return r; },
  exportFile(text) { return this.backend.exportFile ? this.backend.exportFile(text) : null; },
  async pickSave(text) { if (!this.backend.pickSave) return null; const r = await this.backend.pickSave(text); if (r) this.label = r.label || this.label; return r; },
  async forgetFile() { if (this.backend.forgetFile) await this.backend.forgetFile(); this.label = "(no file)"; },
};
