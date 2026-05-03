const { app, BrowserWindow, globalShortcut, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const DEFAULT_WIDGET_URL = "https://easy-loan-finance-booking.onrender.com/widget?desktop=1";
const widgetUrl = process.env.ELF_WIDGET_URL || DEFAULT_WIDGET_URL;

let mainWindow;

function statePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}

function saveWindowState(window) {
  if (!window || window.isDestroyed()) return;
  const bounds = window.getBounds();
  const state = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  };
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

function createWindow() {
  const saved = readWindowState();
  mainWindow = new BrowserWindow({
    width: saved.width || 390,
    height: saved.height || 720,
    minWidth: 320,
    minHeight: 480,
    x: saved.x,
    y: saved.y,
    frame: false,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    title: "ELF Booking Widget",
    backgroundColor: "#121715",
    icon: path.join(__dirname, "..", "public", "elf-logo.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true
    }
  });

  mainWindow.setMenu(null);
  mainWindow.setAlwaysOnTop(true, "floating");

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.loadURL(widgetUrl);

  mainWindow.on("moved", () => saveWindowState(mainWindow));
  mainWindow.on("resized", () => saveWindowState(mainWindow));
  mainWindow.on("close", () => saveWindowState(mainWindow));
}

app.whenReady().then(() => {
  ipcMain.on("elf-widget-close", () => mainWindow?.close());

  createWindow();

  globalShortcut.register("CommandOrControl+R", () => mainWindow?.reload());
  globalShortcut.register("CommandOrControl+W", () => mainWindow?.close());
  globalShortcut.register("Escape", () => mainWindow?.close());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
