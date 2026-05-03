const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("elfWidget", {
  close: () => ipcRenderer.send("elf-widget-close")
});
