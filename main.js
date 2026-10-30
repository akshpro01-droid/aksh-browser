const { app, BrowserWindow, WebContentsView, ipcMain, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const INTERNAL_NEW_TAB = "aksh://newtab";
const SEARCH_ENGINES = {
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q="
};
const MAX_HISTORY = 500;
const DEFAULT_SHORTCUTS = [
  { title: "Google", url: "https://www.google.com/" },
  { title: "YouTube", url: "https://www.youtube.com/" },
  { title: "Wikipedia", url: "https://www.wikipedia.org/" },
  { title: "GitHub", url: "https://github.com/" }
];

let mainWindow;
let nextTabId = 1;
let activeTabId = null;
let attachedView = null;
let chromeOverlayVisible = false;
let layoutBounds = { x: 0, y: 0, width: 0, height: 0 };
const tabs = new Map();
let store;
let storePath;

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function normalizeDestination(input) {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return { error: "Enter a website address or search query." };
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    if (!isHttpUrl(value)) return { error: "Only HTTP and HTTPS websites can be opened." };
    return { url: new URL(value).href };
  }
  if (/\s/.test(value) || (!value.includes(".") && value !== "localhost" && !value.startsWith("localhost:"))) {
    const engine = SEARCH_ENGINES[store.settings.searchEngine] || SEARCH_ENGINES.google;
    return { url: `${engine}${encodeURIComponent(value)}` };
  }
  const candidate = `https://${value}`;
  if (!isHttpUrl(candidate)) return { error: "That address is not a valid website." };
  return { url: new URL(candidate).href };
}

function validShortcut(value) {
  return value && typeof value.title === "string" && value.title.trim().length > 0 &&
    typeof value.url === "string" && isHttpUrl(value.url);
}

function safeFavicon(value) {
  return typeof value === "string" && value.length < 4096 &&
    (/^https?:\/\//i.test(value) || /^data:image\/(?:png|gif|jpeg|webp|x-icon);base64,/i.test(value))
    ? value
    : "";
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const bookmarks = Array.isArray(parsed.bookmarks)
      ? parsed.bookmarks.filter((item) => item && typeof item.url === "string" && isHttpUrl(item.url) &&
        typeof item.title === "string").slice(0, 500).map((item) => ({
          id: typeof item.id === "string" ? item.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: item.title.slice(0, 200),
          url: new URL(item.url).href,
          favicon: safeFavicon(item.favicon)
        }))
      : [];
    const history = Array.isArray(parsed.history)
      ? parsed.history.filter((item) => item && typeof item.url === "string" && isHttpUrl(item.url) &&
        typeof item.title === "string" && Number.isFinite(item.visitedAt)).slice(-MAX_HISTORY).map((item) => ({
          id: typeof item.id === "string" ? item.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: item.title.slice(0, 200),
          url: new URL(item.url).href,
          favicon: safeFavicon(item.favicon),
          visitedAt: item.visitedAt
        }))
      : [];
    const settings = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {};
    const searchEngine = Object.hasOwn(SEARCH_ENGINES, settings.searchEngine) ? settings.searchEngine : "google";
    const shortcuts = Array.isArray(settings.shortcuts)
      ? settings.shortcuts.filter(validShortcut).slice(0, 12).map((item) => ({
        title: item.title.trim().slice(0, 40),
        url: new URL(item.url).href
      }))
      : DEFAULT_SHORTCUTS;
    return { bookmarks, history, settings: { searchEngine, shortcuts } };
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Could not read AKSH Browser data. Starting with an empty library.", error);
    }
    return {
      bookmarks: [],
      history: [],
      settings: { searchEngine: "google", shortcuts: DEFAULT_SHORTCUTS }
    };
  }
}

function persistStore() {
  const temporaryPath = `${storePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify(store, null, 2), "utf8");
    fs.renameSync(temporaryPath, storePath);
  } catch (error) {
    console.error("Could not save AKSH Browser data.", error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("browser:error", "Your browser data could not be saved.");
    }
  }
}

function serializeTab(tab) {
  const contents = tab.view.webContents;
  const alive = !contents.isDestroyed();
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    favicon: tab.favicon,
    loading: tab.loading,
    progress: tab.progress,
    error: tab.error,
    failedInput: tab.failedInput || "",
    isNewTab: tab.isNewTab,
    canGoBack: alive && contents.navigationHistory.canGoBack(),
    canGoForward: alive && contents.navigationHistory.canGoForward()
  };
}

function sendState() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send("browser:state", {
    tabs: [...tabs.values()].map(serializeTab),
    activeId: activeTabId
  });
}

function sendLibrary() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("browser:library", {
    bookmarks: store.bookmarks,
    history: store.history,
    settings: store.settings
  });
}

function updateTab(tab, patch) {
  if (!tabs.has(tab.id)) return;
  Object.assign(tab, patch);
  sendState();
}

function clearProgressTimer(tab) {
  if (tab.progressTimer) clearInterval(tab.progressTimer);
  tab.progressTimer = null;
}

function startProgress(tab) {
  clearProgressTimer(tab);
  updateTab(tab, { loading: true, progress: 8, error: "" });
  tab.progressTimer = setInterval(() => {
    if (!tabs.has(tab.id) || !tab.loading) {
      clearProgressTimer(tab);
      return;
    }
    tab.progress = Math.min(90, tab.progress + Math.max(1, (90 - tab.progress) * 0.14));
    sendState();
  }, 180);
}

function setActiveTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return false;
  activeTabId = tabId;
  if (attachedView && attachedView !== tab.view) {
    mainWindow.contentView.removeChildView(attachedView);
    attachedView = null;
  }
  if (!chromeOverlayVisible && !tab.isNewTab) {
    if (attachedView !== tab.view) {
      mainWindow.contentView.addChildView(tab.view);
      attachedView = tab.view;
    }
    tab.view.setBounds(layoutBounds);
    tab.view.webContents.focus();
  } else if (attachedView) {
    mainWindow.contentView.removeChildView(attachedView);
    attachedView = null;
    if (!chromeOverlayVisible) mainWindow.webContents.focus();
  }
  sendState();
  return true;
}

function recordVisit(tab, url) {
  if (!isHttpUrl(url)) return;
  const normalized = new URL(url).href;
  const last = store.history[store.history.length - 1];
  if (last && last.url === normalized) {
    last.title = tab.title;
    last.visitedAt = Date.now();
    last.favicon = tab.favicon;
  } else {
    store.history.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: tab.title,
      url: normalized,
      favicon: tab.favicon,
      visitedAt: Date.now()
    });
    store.history = store.history.slice(-MAX_HISTORY);
  }
  persistStore();
  sendLibrary();
}

function refreshSavedPage(tab) {
  if (!isHttpUrl(tab.url)) return;
  const visit = store.history.slice().reverse().find((item) => item.url === tab.url);
  let changed = false;
  if (visit) {
    visit.title = tab.title.slice(0, 200);
    visit.favicon = tab.favicon;
    changed = true;
  }
  store.bookmarks.forEach((bookmark) => {
    if (bookmark.url === tab.url) {
      bookmark.title = tab.title.slice(0, 200);
      bookmark.favicon = tab.favicon;
      changed = true;
    }
  });
  if (changed) {
    persistStore();
    sendLibrary();
  }
}

function addTab({ activate = true } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: "persist:aksh-browser"
    }
  });
  const tab = {
    id: nextTabId++,
    title: "New tab",
    url: INTERNAL_NEW_TAB,
    favicon: "",
    loading: false,
    progress: 0,
    progressTimer: null,
    error: "",
    failedInput: "",
    isNewTab: true,
    view
  };
  const contents = view.webContents;
  tabs.set(tab.id, tab);

  const openNewTab = (url) => {
    if (isHttpUrl(url)) {
      const newTab = addTab();
      if (newTab) navigateTab(newTab, url);
    }
  };

  contents.setWindowOpenHandler(({ url }) => {
    openNewTab(url);
    return { action: "deny" };
  });

  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    const command = input.control || input.meta;
    if (command && key === "t") {
      event.preventDefault();
      addTab();
    } else if (command && key === "w") {
      event.preventDefault();
      closeTab(tab.id);
    } else if (command && key === "tab") {
      event.preventDefault();
      cycleTab(input.shift ? -1 : 1);
    } else if (command && key === "l") {
      event.preventDefault();
      mainWindow.webContents.send("browser:focus-address");
    } else if (command && key === "r") {
      event.preventDefault();
      reloadTab(tab.id);
    } else if (input.alt && key === "arrowleft") {
      event.preventDefault();
      goBack(tab.id);
    } else if (input.alt && key === "arrowright") {
      event.preventDefault();
      goForward(tab.id);
    }
  });

  contents.on("will-navigate", (event, url) => {
    if (!isHttpUrl(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isHttpUrl(url)) event.preventDefault();
  });
  contents.on("did-start-loading", () => startProgress(tab));
  contents.on("did-stop-loading", () => {
    clearProgressTimer(tab);
    updateTab(tab, { loading: false, progress: 100 });
  });
  contents.on("did-navigate", (_event, url) => {
    if (!isHttpUrl(url)) return;
    tab.isNewTab = false;
    tab.url = new URL(url).href;
    tab.title = (contents.getTitle() || new URL(url).hostname).slice(0, 200);
    tab.error = "";
    tab.failedInput = "";
    updateTab(tab, { isNewTab: false, url: tab.url, title: tab.title, error: "", failedInput: "" });
    recordVisit(tab, tab.url);
  });
  contents.on("did-navigate-in-page", (_event, url) => {
    if (!isHttpUrl(url)) return;
    updateTab(tab, { url: new URL(url).href });
  });
  contents.on("page-title-updated", (_event, title) => {
    tab.title = (title || "Untitled page").slice(0, 200);
    updateTab(tab, { title: tab.title });
    refreshSavedPage(tab);
  });
  contents.on("page-favicon-updated", (_event, favicons) => {
    tab.favicon = safeFavicon(Array.isArray(favicons) ? favicons[0] : "");
    updateTab(tab, { favicon: tab.favicon });
    refreshSavedPage(tab);
  });
  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !tabs.has(tab.id)) return;
    clearProgressTimer(tab);
    updateTab(tab, { loading: false, progress: 0, error: `Could not load page: ${errorDescription || validatedURL}` });
  });
  contents.on("render-process-gone", (_event, details) => {
    clearProgressTimer(tab);
    updateTab(tab, { loading: false, error: `This page stopped unexpectedly (${details.reason}).` });
  });
  contents.on("destroyed", () => {
    clearProgressTimer(tab);
    if (!tabs.has(tab.id)) return;
    tabs.delete(tab.id);
    if (activeTabId === tab.id && !mainWindow.isDestroyed()) {
      activeTabId = null;
      const next = tabs.values().next().value || addTab({ activate: false });
      if (next) setActiveTab(next.id);
    }
    sendState();
  });

  if (activate) setActiveTab(tab.id);
  return tab;
}

function navigateTab(tab, input) {
  if (!tab || !tabs.has(tab.id)) return;
  const destination = normalizeDestination(input);
  if (destination.error) {
    updateTab(tab, {
      error: destination.error,
      failedInput: typeof input === "string" ? input.slice(0, 2000) : "",
      loading: false,
      progress: 0
    });
    return;
  }
  tab.isNewTab = false;
  tab.error = "";
  tab.failedInput = "";
  tab.progress = 6;
  setActiveTab(tab.id);
  updateTab(tab, { isNewTab: false, error: "", loading: true, progress: 6 });
  tab.view.webContents.loadURL(destination.url).catch((error) => {
    if (!tabs.has(tab.id) || error.code === "ERR_ABORTED") return;
    clearProgressTimer(tab);
    updateTab(tab, { loading: false, progress: 0, error: `Could not load page: ${error.message}` });
  });
}

function closeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  const wasActive = activeTabId === tabId;
  tabs.delete(tabId);
  if (attachedView === tab.view) {
    mainWindow.contentView.removeChildView(tab.view);
    attachedView = null;
  }
  clearProgressTimer(tab);
  if (wasActive) activeTabId = null;
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.destroy();
  if (wasActive) {
    const next = [...tabs.values()].at(-1) || addTab({ activate: false });
    if (next) setActiveTab(next.id);
  }
  sendState();
}

function cycleTab(direction) {
  const ids = [...tabs.keys()];
  if (ids.length < 2) return;
  const current = ids.indexOf(activeTabId);
  const next = (current + direction + ids.length) % ids.length;
  setActiveTab(ids[next]);
}

function goBack(tabId) {
  const tab = tabs.get(tabId);
  if (tab && tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
}

function goForward(tabId) {
  const tab = tabs.get(tabId);
  if (tab && tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
}

function reloadTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  if (tab.loading) tab.view.webContents.stop();
  else if (!tab.isNewTab) tab.view.webContents.reload();
}

function installIpcHandlers() {
  ipcMain.handle("browser:snapshot", () => ({
    tabs: [...tabs.values()].map(serializeTab),
    activeId: activeTabId,
    bookmarks: store.bookmarks,
    history: store.history,
    settings: store.settings
  }));
  ipcMain.handle("browser:open-tab", () => {
    const tab = addTab();
    return tab && tab.id;
  });
  ipcMain.handle("browser:activate-tab", (_event, tabId) => setActiveTab(tabId));
  ipcMain.handle("browser:close-tab", (_event, tabId) => closeTab(tabId));
  ipcMain.handle("browser:navigate", (_event, tabId, input) => {
    const tab = tabs.get(tabId);
    if (tab) navigateTab(tab, input);
  });
  ipcMain.handle("browser:back", (_event, tabId) => goBack(tabId));
  ipcMain.handle("browser:forward", (_event, tabId) => goForward(tabId));
  ipcMain.handle("browser:reload", (_event, tabId) => reloadTab(tabId));
  ipcMain.handle("browser:layout", (_event, bounds) => {
    const values = [bounds?.x, bounds?.y, bounds?.width, bounds?.height];
    if (!values.every(Number.isFinite)) return;
    layoutBounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height))
    };
    const tab = tabs.get(activeTabId);
    if (tab && !tab.isNewTab && attachedView === tab.view) tab.view.setBounds(layoutBounds);
  });
  ipcMain.handle("browser:chrome-overlay", (_event, visible) => {
    chromeOverlayVisible = Boolean(visible);
    if (chromeOverlayVisible && attachedView) {
      mainWindow.contentView.removeChildView(attachedView);
      attachedView = null;
    } else if (!chromeOverlayVisible && activeTabId !== null) {
      setActiveTab(activeTabId);
    }
  });
  ipcMain.handle("browser:add-bookmark", (_event, item) => {
    if (!item || typeof item.url !== "string" || !isHttpUrl(item.url)) return false;
    const url = new URL(item.url).href;
    const existing = store.bookmarks.find((bookmark) => bookmark.url === url);
    if (existing) return false;
    store.bookmarks.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: typeof item.title === "string" ? item.title.slice(0, 200) : new URL(url).hostname,
      url,
      favicon: safeFavicon(item.favicon)
    });
    store.bookmarks = store.bookmarks.slice(0, 500);
    persistStore();
    sendLibrary();
    return true;
  });
  ipcMain.handle("browser:remove-bookmark", (_event, id) => {
    const before = store.bookmarks.length;
    store.bookmarks = store.bookmarks.filter((item) => item.id !== id);
    if (before !== store.bookmarks.length) {
      persistStore();
      sendLibrary();
    }
  });
  ipcMain.handle("browser:clear-history", () => {
    store.history = [];
    persistStore();
    sendLibrary();
  });
  ipcMain.handle("browser:set-settings", (_event, settings) => {
    if (!settings || !Object.hasOwn(SEARCH_ENGINES, settings.searchEngine)) return false;
    store.settings.searchEngine = settings.searchEngine;
    persistStore();
    sendLibrary();
    return true;
  });
  ipcMain.handle("browser:add-shortcut", (_event, input) => {
    if (!input || typeof input.title !== "string" || typeof input.url !== "string" ||
        !isHttpUrl(input.url) || store.settings.shortcuts.length >= 12) return false;
    const shortcut = { title: input.title.trim().slice(0, 40), url: new URL(input.url).href };
    if (!shortcut.title || store.settings.shortcuts.some((item) => item.url === shortcut.url)) return false;
    store.settings.shortcuts.push(shortcut);
    persistStore();
    sendLibrary();
    return true;
  });
  ipcMain.handle("browser:remove-shortcut", (_event, url) => {
    store.settings.shortcuts = store.settings.shortcuts.filter((item) => item.url !== url);
    persistStore();
    sendLibrary();
  });
}

function createWindow() {
  chromeOverlayVisible = false;
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#000000",
    title: "AKSH Browser",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const interfaceUrl = pathToFileURL(path.join(__dirname, "index.html")).href;
    if (url !== interfaceUrl) event.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, "index.html")).catch((error) => {
    console.error("Could not load the AKSH Browser interface.", error);
  });
  mainWindow.on("resize", () => {
    if (attachedView) attachedView.setBounds(layoutBounds);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    attachedView = null;
    tabs.forEach(clearProgressTimer);
    tabs.clear();
  });
  addTab();
}

app.whenReady().then(() => {
  storePath = path.join(app.getPath("userData"), "browser-data.json");
  store = readStore();
  session.fromPartition("persist:aksh-browser").setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  installIpcHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
