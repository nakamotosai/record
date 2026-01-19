import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    getScreenSourceId: () => ipcRenderer.invoke('get-screen-source-id'),

    captureRegion: (rect, mode, mousePos) =>
        ipcRenderer.invoke('capture-region', rect, mode, mousePos),

    // UI -> Main -> Worker
    startRecordingWorker: (rect) => ipcRenderer.invoke('start-recording-worker', rect),
    stopRecordingWorker: () => ipcRenderer.invoke('stop-recording-worker'),

    // Worker -> Main
    recordingFinished: (blob) => ipcRenderer.invoke('recording-finished', blob),

    // Worker events
    onStartRecording: (callback) => {
        ipcRenderer.on('start-recording', callback);
        return () => ipcRenderer.removeListener('start-recording', callback);
    },
    onStopRecording: (callback) => {
        ipcRenderer.on('stop-recording', callback);
        return () => ipcRenderer.removeListener('stop-recording', callback);
    },
    onInitScreenshot: (callback: (buffer: Uint8Array) => void) => {
        ipcRenderer.on('init-screenshot', (_event, buffer) => callback(buffer));
    },

    // 通知主进程截图已加载完成
    screenshotReady: () => ipcRenderer.send('screenshot-ready'),

    // 监听主进程清除截图的事件
    onClearScreenshot: (callback: () => void) => {
        ipcRenderer.on('clear-screenshot', callback);
    },

    closeSelector: () => ipcRenderer.invoke('close-selector'),
    log: (msg) => ipcRenderer.send('renderer-log', msg),
    setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options)
});
