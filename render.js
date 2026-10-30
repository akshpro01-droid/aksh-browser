const api = window.aksh;
const elements = {
  tabs: document.querySelector("#tabs"),
  newTab: document.querySelector("#newTab"),
  back: document.querySelector("#back"),
  forward: document.querySelector("#forward"),
  reload: document.querySelector("#reload"),
  addressForm: document.querySelector("#addressForm"),
  addressBar: document.querySelector("#addressBar"),
  bookmarkCurrent: document.querySelector("#bookmarkCurrent"),
  content: document.querySelector("#content"),
  newTabPage: document.querySelector("#newTabPage"),
  homeSearchForm: document.querySelector("#homeSearchForm"),
  homeSearch: document.querySelector("#homeSearch"),
  shortcuts: document.querySelector("#shortcuts"),
  bookmarkBar: document.querySelector("#bookmarkBar"),
  clockTime: document.querySelector("#clockTime"),
  clockPeriod: document.querySelector("#clockPeriod"),
  clockDate: document.querySelector("#clockDate"),
  pageNotice: document.querySelector("#pageNotice"),
  libraryOverlay: document.querySelector("#libraryOverlay"),
  libraryTitle: document.querySelector("#libraryTitle"),
  libraryList: document.querySelector("#libraryList"),
  settingsDialog: document.querySelector("#settingsDialog"),
  searchEngine: document.querySelector("#searchEngine")
};

let browserState = { tabs: [], activeId: null };
let libraryState = {
  bookmarks: [],
  history: [],
  settings: { searchEngine: "google", shortcuts: [] }
};
let libraryMode = "bookmarks";
let noticeTimer;
let displayedTabError = "";

function activeTab() {
  return browserState.tabs.find((tab) => tab.id === browserState.activeId);
}

function makeIcon(favicon, label) {
  const wrapper = document.createElement("span");
  wrapper.className = "site-icon";
  const allowedFavicon = typeof favicon === "string" &&
    (/^https?:\/\//i.test(favicon) || /^data:image\/(?:png|gif|jpeg|webp|x-icon);base64,/i.test(favicon));
  if (allowedFavicon) {
    const image = document.createElement("img");
    image.src = favicon;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      image.remove();
      wrapper.textContent = (label || "A").trim().charAt(0).toUpperCase();
    }, { once: true });
    wrapper.append(image);
  } else {
    wrapper.textContent = (label || "A").trim().charAt(0).toUpperCase();
  }
  return wrapper;
}

function renderTabs() {
  elements.tabs.replaceChildren();
  browserState.tabs.forEach((tab) => {
    const tabElement = document.createElement("div");
    tabElement.className = `tab${tab.id === browserState.activeId ? " active" : ""}`;
    tabElement.role = "tab";
    tabElement.tabIndex = 0;
    tabElement.setAttribute("aria-selected", String(tab.id === browserState.activeId));
    tabElement.dataset.tabId = tab.id;
    tabElement.title = tab.title;

    if (tab.loading) {
      const spinner = document.createElement("span");
      spinner.className = "tab-spinner";
      spinner.setAttribute("aria-label", "Loading");
      tabElement.append(spinner);
    } else {
      tabElement.append(makeIcon(tab.favicon, tab.title));
    }

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title || "New tab";
    tabElement.append(title);
    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.setAttribute("aria-label", `Close ${tab.title || "tab"}`);
    close.textContent = "×";
    tabElement.append(close);
    elements.tabs.append(tabElement);
  });
}

function renderShortcuts() {
  elements.shortcuts.replaceChildren();
  const shortcuts = libraryState.settings.shortcuts || [];
  shortcuts.forEach((shortcut) => {
    const tile = document.createElement("div");
    tile.className = "shortcut-tile";
    const open = document.createElement("button");
    open.className = "shortcut-open";
    open.type = "button";
    open.title = shortcut.url;
    open.dataset.url = shortcut.url;
    const icon = document.createElement("span");
    icon.className = "shortcut-icon";
    const favicon = document.createElement("img");
    favicon.alt = "";
    favicon.referrerPolicy = "no-referrer";
    favicon.src = `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(shortcut.url)}&sz=64`;
    favicon.addEventListener("error", () => {
      favicon.remove();
      icon.textContent = shortcut.title.trim().charAt(0).toUpperCase();
    }, { once: true });
    icon.append(favicon);
    const label = document.createElement("span");
    label.textContent = shortcut.title;
    open.append(icon, label);
    const remove = document.createElement("button");
    remove.className = "shortcut-remove";
    remove.type = "button";
    remove.title = `Remove ${shortcut.title}`;
    remove.setAttribute("aria-label", `Remove ${shortcut.title}`);
    remove.dataset.removeShortcut = shortcut.url;
    remove.textContent = "×";
    tile.append(open, remove);
    elements.shortcuts.append(tile);
  });
  if (shortcuts.length < 12) {
    const add = document.createElement("button");
    add.className = "shortcut-add";
    add.type = "button";
    add.dataset.addShortcut = "true";
    const icon = document.createElement("span");
    icon.className = "shortcut-add-icon";
    icon.textContent = "+";
    const label = document.createElement("span");
    label.textContent = "Add shortcut";
    add.append(icon, label);
    elements.shortcuts.append(add);
  }
}

function renderBookmarkBar() {
  elements.bookmarkBar.replaceChildren();
  if (!libraryState.bookmarks.length) {
    const hint = document.createElement("span");
    hint.className = "bookmark-hint";
    hint.textContent = "For quick access, add bookmarks to your bookmarks bar.";
    elements.bookmarkBar.append(hint);
    return;
  }

  libraryState.bookmarks.slice(0, 10).forEach((bookmark) => {
    const button = document.createElement("button");
    button.className = "bookmark-bar-item";
    button.type = "button";
    button.dataset.url = bookmark.url;
    button.title = bookmark.url;
    button.append(makeIcon(bookmark.favicon, bookmark.title));
    const title = document.createElement("span");
    title.textContent = bookmark.title;
    button.append(title);
    elements.bookmarkBar.append(button);
  });
}

function renderLibrary() {
  const isHistory = libraryMode === "history";
  elements.libraryTitle.textContent = isHistory ? "History" : "Bookmarks";
  elements.libraryList.replaceChildren();
  const entries = isHistory ? libraryState.history.slice().reverse() : libraryState.bookmarks;

  if (isHistory && entries.length) {
    const clear = document.createElement("button");
    clear.className = "clear-history";
    clear.type = "button";
    clear.dataset.clearHistory = "true";
    clear.textContent = "Clear browsing history";
    elements.libraryList.append(clear);
  }

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "library-empty";
    const symbol = document.createElement("span");
    symbol.className = "empty-symbol";
    symbol.textContent = isHistory ? "↺" : "☆";
    const message = document.createElement("strong");
    message.textContent = isHistory ? "Nothing here yet" : "Your bookmarks live here";
    const detail = document.createElement("p");
    detail.textContent = isHistory
      ? "Pages you visit will appear in your history."
      : "Save a page with the star in the address bar.";
    empty.append(symbol, message, detail);
    elements.libraryList.append(empty);
    return;
  }

  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "library-item";
    const open = document.createElement("button");
    open.className = "library-open";
    open.type = "button";
    open.dataset.url = entry.url;
    open.append(makeIcon(entry.favicon, entry.title));
    const text = document.createElement("span");
    text.className = "library-text";
    const title = document.createElement("strong");
    title.textContent = entry.title || entry.url;
    const address = document.createElement("small");
    address.textContent = isHistory ? `${new URL(entry.url).hostname} · ${new Date(entry.visitedAt).toLocaleString()}` : entry.url;
    text.append(title, address);
    open.append(text);
    row.append(open);
    if (!isHistory) {
      const remove = document.createElement("button");
      remove.className = "library-remove";
      remove.type = "button";
      remove.dataset.removeBookmark = entry.id;
      remove.setAttribute("aria-label", `Remove ${entry.title} bookmark`);
      remove.title = "Remove bookmark";
      remove.textContent = "×";
      row.append(remove);
    }
    elements.libraryList.append(row);
  });
}

function render() {
  renderTabs();
  const tab = activeTab();
  const isHome = !tab || tab.isNewTab;
  elements.newTabPage.hidden = !isHome;
  if (document.activeElement !== elements.addressBar) {
    elements.addressBar.value = isHome ? (tab && tab.failedInput ? tab.failedInput : "") : tab.url;
  }
  elements.addressBar.placeholder = isHome ? "Search or enter address" : "Search or enter address";
  elements.back.disabled = !tab || !tab.canGoBack;
  elements.forward.disabled = !tab || !tab.canGoForward;
  elements.reload.disabled = !tab;
  elements.reload.classList.toggle("is-loading", Boolean(tab && tab.loading));
  elements.reload.setAttribute("aria-label", tab && tab.loading ? "Stop loading" : "Reload");
  elements.reload.title = tab && tab.loading ? "Stop loading" : "Reload (Ctrl+R)";
  elements.bookmarkCurrent.disabled = !tab || isHome;
  const bookmarked = Boolean(tab && libraryState.bookmarks.some((item) => item.url === tab.url));
  elements.bookmarkCurrent.classList.toggle("is-bookmarked", bookmarked);
  elements.bookmarkCurrent.setAttribute("aria-label", bookmarked ? "Remove bookmark" : "Bookmark this page");
  elements.bookmarkCurrent.title = bookmarked ? "Remove bookmark" : "Bookmark this page";

  const loading = Boolean(tab && tab.loading);
  document.querySelector("#loadTrack").classList.toggle("visible", loading);
  document.querySelector("#loadProgress").style.width = `${tab ? tab.progress : 0}%`;
  if (tab && tab.error && tab.error !== displayedTabError) {
    displayedTabError = tab.error;
    showNotice(tab.error);
  } else if (!tab || !tab.error) {
    displayedTabError = "";
  }
  document.title = tab && !tab.isNewTab ? `${tab.title} — AKSH Browser` : "AKSH Browser";
  if (!elements.libraryOverlay.hidden) renderLibrary();
  syncLayout();
}

function syncLayout() {
  const bounds = elements.content.getBoundingClientRect();
  api.setLayout({
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height
  });
}

function showNotice(message, persistent = false) {
  elements.pageNotice.textContent = message;
  elements.pageNotice.hidden = false;
  elements.pageNotice.classList.add("shown");
  clearTimeout(noticeTimer);
  if (!persistent) {
    noticeTimer = setTimeout(() => {
      elements.pageNotice.classList.remove("shown");
      elements.pageNotice.hidden = true;
    }, 4200);
  }
}

function openLibrary(mode) {
  libraryMode = mode;
  renderLibrary();
  api.setChromeOverlay(true);
  elements.libraryOverlay.hidden = false;
  document.querySelector("#closeLibrary").focus();
}

function closeLibrary() {
  elements.libraryOverlay.hidden = true;
  api.setChromeOverlay(false);
}

function navigate(input) {
  const tab = activeTab();
  if (tab) api.navigate(tab.id, input);
}

elements.tabs.addEventListener("click", (event) => {
  const tabButton = event.target.closest("[data-tab-id]");
  if (!tabButton) return;
  const tabId = Number(tabButton.dataset.tabId);
  if (event.target.closest(".tab-close")) api.closeTab(tabId);
  else api.activateTab(tabId);
});

elements.tabs.addEventListener("auxclick", (event) => {
  if (event.button !== 1) return;
  const tabButton = event.target.closest("[data-tab-id]");
  if (tabButton) api.closeTab(Number(tabButton.dataset.tabId));
});

elements.newTab.addEventListener("click", () => api.openTab());
document.querySelector("#appsButton").addEventListener("click", () => api.openTab());
elements.back.addEventListener("click", () => {
  const tab = activeTab();
  if (tab) api.back(tab.id);
});
elements.forward.addEventListener("click", () => {
  const tab = activeTab();
  if (tab) api.forward(tab.id);
});
elements.reload.addEventListener("click", () => {
  const tab = activeTab();
  if (tab) api.reload(tab.id);
});
elements.addressForm.addEventListener("submit", (event) => {
  event.preventDefault();
  navigate(elements.addressBar.value);
  elements.addressBar.blur();
});
elements.homeSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  navigate(elements.homeSearch.value);
  elements.homeSearch.blur();
});
let selectAddressOnFocus = true;
elements.addressBar.addEventListener("pointerdown", () => {
  selectAddressOnFocus = false;
  setTimeout(() => {
    selectAddressOnFocus = true;
  }, 0);
});
elements.addressBar.addEventListener("focus", () => {
  if (selectAddressOnFocus) elements.addressBar.select();
  selectAddressOnFocus = true;
});
elements.bookmarkCurrent.addEventListener("click", async () => {
  const tab = activeTab();
  if (!tab || tab.isNewTab) return;
  const bookmark = libraryState.bookmarks.find((item) => item.url === tab.url);
  if (bookmark) await api.removeBookmark(bookmark.id);
  else await api.addBookmark({ title: tab.title, url: tab.url, favicon: tab.favicon });
});
document.querySelector("#showBookmarks").addEventListener("click", () => openLibrary("bookmarks"));
document.querySelector("#showHistory").addEventListener("click", () => openLibrary("history"));
document.querySelector("#closeLibrary").addEventListener("click", () => {
  closeLibrary();
});
elements.libraryOverlay.addEventListener("click", (event) => {
  if (event.target === elements.libraryOverlay) closeLibrary();
});
elements.libraryOverlay.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeLibrary();
});
elements.libraryList.addEventListener("click", (event) => {
  const open = event.target.closest("[data-url]");
  const remove = event.target.closest("[data-remove-bookmark]");
  if (remove) {
    api.removeBookmark(remove.dataset.removeBookmark);
    return;
  }
  if (event.target.closest("[data-clear-history]")) {
    api.clearHistory();
    return;
  }
  if (open) {
    closeLibrary();
    navigate(open.dataset.url);
  }
});
elements.bookmarkBar.addEventListener("click", (event) => {
  const bookmark = event.target.closest("[data-url]");
  if (bookmark) navigate(bookmark.dataset.url);
});

async function addShortcut() {
  const url = window.prompt("Enter a website address for your shortcut:");
  if (!url) return;
  let hostname;
  try {
    hostname = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    showNotice("Enter a valid website address for your shortcut.");
    return;
  }
  const title = window.prompt("Give this shortcut a name:", hostname);
  if (!title) return;
  const added = await api.addShortcut({ title, url });
  if (!added) showNotice("That shortcut is invalid, already saved, or the shortcut limit has been reached.");
}

elements.shortcuts.addEventListener("click", (event) => {
  if (event.target.closest("[data-add-shortcut]")) {
    addShortcut();
    return;
  }
  const remove = event.target.closest("[data-remove-shortcut]");
  if (remove) {
    api.removeShortcut(remove.dataset.removeShortcut);
    return;
  }
  const open = event.target.closest("[data-url]");
  if (open) navigate(open.dataset.url);
});

function openSettings() {
  api.setChromeOverlay(true);
  elements.settingsDialog.showModal();
}

document.querySelector("#settingsButton").addEventListener("click", openSettings);
document.querySelector("#homeSettings").addEventListener("click", openSettings);
elements.searchEngine.addEventListener("change", async () => {
  const saved = await api.setSettings({ searchEngine: elements.searchEngine.value });
  if (!saved) showNotice("The search preference could not be saved.");
});
elements.settingsDialog.addEventListener("click", (event) => {
  if (event.target === elements.settingsDialog) elements.settingsDialog.close();
});
elements.settingsDialog.addEventListener("close", () => api.setChromeOverlay(false));

document.querySelector(".brand").addEventListener("click", (event) => event.preventDefault());

document.addEventListener("keydown", (event) => {
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "l") {
    event.preventDefault();
    elements.addressBar.focus();
    elements.addressBar.select();
  } else if (command && event.key.toLowerCase() === "t") {
    event.preventDefault();
    api.openTab();
  } else if (command && event.key.toLowerCase() === "w") {
    event.preventDefault();
    const tab = activeTab();
    if (tab) api.closeTab(tab.id);
  } else if (command && event.key.toLowerCase() === "r") {
    event.preventDefault();
    const tab = activeTab();
    if (tab) api.reload(tab.id);
  } else if (command && event.key === "Tab" && browserState.tabs.length > 1) {
    event.preventDefault();
    const current = browserState.tabs.findIndex((tab) => tab.id === browserState.activeId);
    const offset = event.shiftKey ? -1 : 1;
    const next = (current + offset + browserState.tabs.length) % browserState.tabs.length;
    api.activateTab(browserState.tabs[next].id);
  } else if (event.altKey && event.key === "ArrowLeft") {
    const tab = activeTab();
    if (tab) {
      event.preventDefault();
      api.back(tab.id);
    }
  } else if (event.altKey && event.key === "ArrowRight") {
    const tab = activeTab();
    if (tab) {
      event.preventDefault();
      api.forward(tab.id);
    }
  }
});

api.onState((state) => {
  browserState = state;
  render();
});
api.onLibrary((library) => {
  libraryState = library;
  elements.searchEngine.value = library.settings.searchEngine;
  renderShortcuts();
  renderBookmarkBar();
  render();
});
api.onFocusAddress(() => {
  elements.addressBar.focus();
  elements.addressBar.select();
});
api.onError((message) => showNotice(message));

function updateDate() {
  const now = new Date();
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).formatToParts(now);
  elements.clockTime.textContent = time
    .filter((part) => part.type === "hour" || part.type === "minute" || part.type === "literal")
    .map((part) => part.value)
    .join("")
    .trim();
  elements.clockPeriod.textContent = time.find((part) => part.type === "dayPeriod")?.value || "";
  elements.clockDate.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date());
}

window.addEventListener("resize", syncLayout);
new ResizeObserver(syncLayout).observe(elements.content);
updateDate();
setInterval(updateDate, 15_000);

api.snapshot().then((snapshot) => {
  browserState = { tabs: snapshot.tabs, activeId: snapshot.activeId };
  libraryState = {
    bookmarks: snapshot.bookmarks,
    history: snapshot.history,
    settings: snapshot.settings
  };
  elements.searchEngine.value = libraryState.settings.searchEngine;
  renderShortcuts();
  renderBookmarkBar();
  render();
}).catch((error) => {
  console.error("Could not initialize browser UI.", error);
  showNotice("AKSH Browser could not load its saved browser state.");
});
