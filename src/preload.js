// The only bridge between the app's pages and the main process.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("gaik", {
  engine: {
    get: () => ipcRenderer.invoke("engine:get"),
    restart: () => ipcRenderer.invoke("engine:restart"),
    onChange: (fn) => {
      const listener = (_event, state) => fn(state);
      ipcRenderer.on("engine", listener);
      return () => ipcRenderer.removeListener("engine", listener);
    },
  },
  api: (route, body) => ipcRenderer.invoke("api", route, body),
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (form) => ipcRenderer.invoke("settings:save", form),
  },
  files: {
    pick: (options) => ipcRenderer.invoke("files:pick", options),
    expand: (paths, extensions) => ipcRenderer.invoke("files:expand", paths, extensions),
    reveal: (file) => ipcRenderer.invoke("files:reveal", file),
    pathFor: (file) => webUtils.getPathForFile(file),
  },
  save: {
    text: (options) => ipcRenderer.invoke("save:text", options),
    xlsx: (options) => ipcRenderer.invoke("save:xlsx", options),
    folder: (options) => ipcRenderer.invoke("save:folder", options),
  },
  data: {
    get: (name) => ipcRenderer.invoke("data:get", name),
    set: (name, value) => ipcRenderer.invoke("data:set", name, value),
  },
  app: {
    info: () => ipcRenderer.invoke("app:info"),
    openLogs: () => ipcRenderer.invoke("app:openLogs"),
  },
});
