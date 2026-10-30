const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, listener) {
  const wrapped = (_event, value) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("aksh", Object.freeze({
  snapshot: () => ipcRenderer.invoke("browser:snapshot"),
  openTab: () => ipcRenderer.invoke("browser:open-tab"),
  activateTab: (id) => ipcRenderer.invoke("browser:activate-tab", id),
  closeTab: (id) => ipcRenderer.invoke("browser:close-tab", id),
  navigate: (id, value) => ipcRenderer.invoke("browser:navigate", id, value),
  back: (id) => ipcRenderer.invoke("browser:back", id),
  forward: (id) => ipcRenderer.invoke("browser:forward", id),
  reload: (id) => ipcRenderer.invoke("browser:reload", id),
  setLayout: (bounds) => ipcRenderer.invoke("browser:layout", bounds),
  setChromeOverlay: (visible) => ipcRenderer.invoke("browser:chrome-overlay", visible),
  addBookmark: (bookmark) => ipcRenderer.invoke("browser:add-bookmark", bookmark),
  removeBookmark: (id) => ipcRenderer.invoke("browser:remove-bookmark", id),
  clearHistory: () => ipcRenderer.invoke("browser:clear-history"),
  setSettings: (settings) => ipcRenderer.invoke("browser:set-settings", settings),
  addShortcut: (shortcut) => ipcRenderer.invoke("browser:add-shortcut", shortcut),
  removeShortcut: (url) => ipcRenderer.invoke("browser:remove-shortcut", url),
  onState: (listener) => subscribe("browser:state", listener),
  onLibrary: (listener) => subscribe("browser:library", listener),
  onFocusAddress: (listener) => subscribe("browser:focus-address", listener),
  onError: (listener) => subscribe("browser:error", listener)
}));
