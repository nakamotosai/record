import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, clipboard, desktopCapturer, screen, shell, systemPreferences, session, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// 异常捕获：防止程序直接崩溃
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  try {
    const logPath = path.join(app.getPath('userData'), 'crash.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] CRASH: ${error.stack}\n`);
  } catch (e) {
    console.error('Failed to write crash log:', e);
  }
  // 尝试弹窗（如果有活动窗口）
  if (app.isReady() && !app.isQuiting) { // 修正: isQuiting -> isQuitting (but electron app property is custom?) electron has 'before-quit' etc. safest is just check ready
    // Electron dialog.showErrorBox is safe to call after ready
    try {
      dialog.showErrorBox('ScreenCap Pro 错误', `发生意外错误：\n${error.message}\n请查看 crash.log`);
    } catch (e) { }
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// CRITICAL FIX: Polyfill global.__dirname for dependencies like fluent-ffmpeg/ffmpeg-static
(global as any).__dirname = __dirname;

// 单实例锁定：确保只有一个程序实例在运行
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 当用户尝试启动第二个实例时，显示一个提示通知
    try {
      if (screen) {
        showNotification('程序已在后台运行', { x: screen.getPrimaryDisplay().bounds.width / 2, y: screen.getPrimaryDisplay().bounds.height / 2 });
      }
    } catch (e) { }
  });
}

interface AppSettings {
  savePath: string;
  imageFormat: 'png' | 'jpg';
  videoFormat: 'mp4' | 'webm';
  audioSource: 'none' | 'system' | 'mic';
  frameRate: 30 | 60 | 90;
  shortcutMode: 'standard' | 'alternative';
}

let settings: AppSettings = {
  savePath: app.getPath('desktop'),
  imageFormat: 'png',
  videoFormat: 'mp4',
  audioSource: 'system',
  frameRate: 60,
  shortcutMode: 'standard'
};

// 1. 防止后台节流 - 关键！
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// 辅助函数：获取资源文件的正确路径（兼容开发和打包环境）
function getResourcePath(relativePath: string): string {
  // app.getAppPath() 在打包后返回 .../resources/app.asar
  return path.join(app.getAppPath(), relativePath);
}

let tray: Tray | null = null;
let selectorWindow: BrowserWindow | null = null;
let recorderWindow: BrowserWindow | null = null;
let notificationWindow: BrowserWindow | null = null;
let isRecording = false;

// 创建后台录制窗口
function createRecorderWindow() {
  recorderWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 防止后台被冻结
      sandbox: false
    },
    icon: getResourcePath('public/icon.png')
  });

  const url = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}?mode=recorder`
    : `file://${path.join(__dirname, '../dist/index.html')}?mode=recorder`;

  recorderWindow.loadURL(url);

  // 仅在 macOS 上请求权限
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone');
  }

  // 调试日志
  recorderWindow.webContents.on('console-message', (e, level, msg) => {
    console.log('[Recorder]:', msg);
  });
}

function showNotification(message: string, mousePos: { x: number, y: number }) {
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    notificationWindow.destroy();
  }

  const notifWidth = 140;
  const notifHeight = 36;

  let x = mousePos.x - notifWidth / 2;
  let y = mousePos.y - notifHeight - 20;

  try {
    const { width, height } = screen.getPrimaryDisplay().bounds;
    if (x < 10) x = 10;
    if (x + notifWidth > width - 10) x = width - notifWidth - 10;
    if (y < 10) y = mousePos.y + 30;

    notificationWindow = new BrowserWindow({
      width: notifWidth,
      height: notifHeight,
      x: Math.round(x),
      y: Math.round(y),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      hasShadow: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
      icon: getResourcePath('public/icon.png')
    });

    notificationWindow.setIgnoreMouseEvents(true);

    const html = `<!DOCTYPE html><html><head><style>
        *{margin:0;padding:0;box-sizing:border-box}
        html,body{overflow:hidden}
        body{display:flex;align-items:center;justify-content:center;height:100vh;background:transparent;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
        .pill{
        display:flex;align-items:center;gap:6px;
        background:rgba(30,30,30,0.75);
        backdrop-filter:blur(12px);
        -webkit-backdrop-filter:blur(12px);
        color:rgba(220,220,220,0.95);
        padding:8px 16px;
        border-radius:20px;
        font-size:13px;
        font-weight:500;
        letter-spacing:0.3px;
        border:1px solid rgba(255,255,255,0.1);
        box-shadow:0 4px 16px rgba(0,0,0,0.3);
        animation:pop 0.6s cubic-bezier(0.34,1.56,0.64,1);
        }
        .check{width:14px;height:14px;fill:rgba(160,160,160,0.9)}
        @keyframes pop{
        0%{opacity:0;transform:scale(0.85) translateY(8px)}
        100%{opacity:1;transform:scale(1) translateY(0)}
        }
    </style></head><body>
        <div class="pill">
        <svg class="check" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
        <span>${message}</span>
        </div>
    </body></html>`;

    notificationWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    setTimeout(() => {
      try {
        if (notificationWindow && !notificationWindow.isDestroyed()) {
          notificationWindow.destroy();
          notificationWindow = null;
        }
      } catch (e) { }
    }, 800);
  } catch (e) {
    console.error('showNotification error:', e);
  }
}

function closeSelectorWindow() {
  if (selectorWindow && !selectorWindow.isDestroyed()) {
    selectorWindow.destroy();
    selectorWindow = null;
  }
}

function createSelectorWindow(mode: 'clipboard' | 'file' | 'record') {
  closeSelectorWindow();

  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.bounds;

  selectorWindow = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: getResourcePath('public/icon.png')
  });

  selectorWindow.setAlwaysOnTop(true, 'screen-saver');
  selectorWindow.setContentProtection(true);
  selectorWindow.on('closed', () => { selectorWindow = null; });

  const url = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}?mode=${mode}`
    : `file://${path.join(__dirname, '../dist/index.html')}?mode=${mode}`;

  selectorWindow.loadURL(url);

  if (mode === 'record' && process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone');
  }

  return selectorWindow;
}

function registerShortcuts() {
  try {
    globalShortcut.unregisterAll();
    console.log(`[Main] Registering shortcuts in mode: ${settings.shortcutMode}`);

    const registerOne = (accelerator: string, callback: () => void) => {
      try {
        const success = globalShortcut.register(accelerator, callback);
        if (!success) {
          console.error(`Global shortcut registration failed: ${accelerator}`);
          try {
            showNotification(`注册失败: ${accelerator} 被占用`, { x: screen.getPrimaryDisplay().bounds.width / 2, y: screen.getPrimaryDisplay().bounds.height / 2 });
          } catch (e) { console.error('Notify failed:', e); }
        } else {
          console.log(`Global shortcut registered: ${accelerator}`);
        }
      } catch (e) {
        console.error(e);
      }
    };

    const actions = {
      clipboard: () => createSelectorWindow('clipboard'),
      file: () => createSelectorWindow('file'),
      record: () => {
        console.log('[Main] Record Shortcut Pressed');
        if (isRecording) {
          try {
            showNotification('正在停止录制...', { x: screen.getPrimaryDisplay().bounds.width / 2, y: screen.getPrimaryDisplay().bounds.height / 2 });
          } catch (e) { }
          if (recorderWindow) recorderWindow.webContents.send('stop-recording');
          if (selectorWindow) selectorWindow.webContents.send('stop-recording');
        } else {
          try {
            showNotification('准备开始录制...', { x: screen.getPrimaryDisplay().bounds.width / 2, y: screen.getPrimaryDisplay().bounds.height / 2 });
          } catch (e) { }
          createSelectorWindow('record');
          isRecording = true;
        }
      }
    };

    if (settings.shortcutMode === 'standard') {
      registerOne('F1', actions.clipboard);
      registerOne('F2', actions.file);
      registerOne('F3', actions.record);
    } else {
      registerOne('Alt+F1', actions.clipboard);
      registerOne('Alt+F2', actions.file);
      registerOne('Alt+F3', actions.record);
    }
  } catch (e) {
    console.error('registerShortcuts error:', e);
  }
}

function createTray() {
  try {
    const updateSettings = (key: keyof AppSettings, value: any) => {
      (settings as any)[key] = value;
      createTray();
      if (key === 'shortcutMode') {
        registerShortcuts();
        try {
          showNotification(`已切换模式: ${value === 'standard' ? '标准' : '防冲突'}`, { x: screen.getPrimaryDisplay().bounds.width / 2, y: screen.getPrimaryDisplay().bounds.height / 2 });
        } catch (e) { }
      }
    };

    const getShortcutLabel = (base: string) => {
      const prefix = settings.shortcutMode === 'standard' ? '' : 'Alt+';
      return `${prefix}${base}`;
    };

    const menu = Menu.buildFromTemplate([
      { label: 'ScreenCap Pro', enabled: false },
      { type: 'separator' },
      { label: `截图到剪贴板 (${getShortcutLabel('F1')})`, click: () => createSelectorWindow('clipboard') },
      { label: `截图到文件 (${getShortcutLabel('F2')})`, click: () => createSelectorWindow('file') },
      { label: `录屏 (${getShortcutLabel('F3')})`, click: () => { if (!isRecording) { createSelectorWindow('record'); isRecording = true; } } },
      { type: 'separator' },
      {
        label: '⌨️ 快捷键模式',
        submenu: [
          {
            label: '标准 (F1 / F2 / F3)',
            type: 'radio',
            checked: settings.shortcutMode === 'standard',
            click: () => updateSettings('shortcutMode', 'standard')
          },
          {
            label: '防冲突 (Alt + F1/2/3)',
            type: 'radio',
            checked: settings.shortcutMode === 'alternative',
            click: () => updateSettings('shortcutMode', 'alternative')
          }
        ]
      },
      { type: 'separator' },
      {
        label: '🔊 音频源',
        submenu: [
          { label: '无', type: 'radio', checked: settings.audioSource === 'none', click: () => updateSettings('audioSource', 'none') },
          { label: '系统声音', type: 'radio', checked: settings.audioSource === 'system', click: () => updateSettings('audioSource', 'system') },
          { label: '麦克风', type: 'radio', checked: settings.audioSource === 'mic', click: () => updateSettings('audioSource', 'mic') }
        ]
      },
      { type: 'separator' },
      { label: '打开保存目录', click: () => shell.openPath(settings.savePath) },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]);

    if (tray) {
      tray.setContextMenu(menu);
    } else {
      const iconPath = getResourcePath('public/icon.png');
      tray = new Tray(iconPath); // try-catch protects this
      tray.setToolTip('ScreenCap Pro');
      tray.setContextMenu(menu);
    }
  } catch (e) {
    console.error('createTray failed:', e);
    // Fallback: don't crash main process
  }
}

// IPC Handlers
ipcMain.handle('get-settings', () => settings);

ipcMain.handle('get-screen-source-id', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources[0]?.id;
});

ipcMain.handle('capture-region', async (_event, rect, mode, mousePos) => {
  console.log(`[Main] capture-region called. Mode: ${mode}, Rect:`, rect);
  closeSelectorWindow();
  await new Promise(resolve => setTimeout(resolve, 50));

  try {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.bounds;

    const thumbSize = {
      width: width * display.scaleFactor,
      height: height * display.scaleFactor
    };

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: thumbSize
    });

    if (!sources[0]) throw new Error('No screen source');

    const img = nativeImage.createFromBuffer(sources[0].thumbnail.toPNG());
    const imgSize = img.getSize();

    const scaleX = imgSize.width / width;
    const scaleY = imgSize.height / height;

    const cropRect = {
      x: Math.round(rect.x * scaleX),
      y: Math.round(rect.y * scaleY),
      width: Math.round(rect.width * scaleX),
      height: Math.round(rect.height * scaleY)
    };

    const cropped = img.crop(cropRect);

    if (mode === 'clipboard') {
      clipboard.writeImage(cropped);
      showNotification('已复制', { x: width / 2, y: height / 2 });
    } else if (mode === 'file') {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
      const filepath = path.join(settings.savePath, `screenshot-${timestamp}.png`);
      fs.writeFileSync(filepath, cropped.toPNG());
      showNotification('已保存', { x: width / 2, y: height / 2 });
    }
    return 'success';
  } catch (e) {
    console.error(e);
    throw e;
  }
});

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Worker 录制逻辑
ipcMain.handle('start-recording-worker', async (_e, rect) => {
  console.log('[Main] start-recording-worker called', rect);

  if (recorderWindow && !recorderWindow.isDestroyed()) {
    recorderWindow.destroy();
    recorderWindow = null;
  }

  createRecorderWindow();

  await new Promise<void>((resolve) => {
    recorderWindow!.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        resolve();
      }, 100);
    });
  });

  isRecording = true;
  recorderWindow?.webContents.send('start-recording', rect, settings);
});

ipcMain.handle('stop-recording-worker', () => {
  recorderWindow?.webContents.send('stop-recording');
});

ipcMain.handle('recording-finished', async (_e, buffer) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
  const { width, height } = screen.getPrimaryDisplay().bounds;
  const debugLogPath = path.join(settings.savePath, `debug-${timestamp}.log`);

  const logDebug = (msg: string) => {
    console.log(msg);
    try { fs.appendFileSync(debugLogPath, `[${new Date().toISOString()}] ${msg}\n`); } catch (e) { }
  };

  isRecording = false;

  const bufLength = buffer ? (buffer.length !== undefined ? buffer.length : buffer.byteLength) : 0;

  if (!buffer || bufLength === 0) {
    showNotification('录制失败：数据为空', { x: width / 2, y: height / 2 });
    return;
  }

  showNotification('正在保存：写入文件...', { x: width / 2, y: height / 2 });

  const webmPath = path.join(settings.savePath, `recording-${timestamp}.webm`);

  try {
    fs.writeFileSync(webmPath, Buffer.from(buffer));
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (err) {
    showNotification('保存失败：临时文件写入错误', { x: width / 2, y: height / 2 });
    return;
  }

  if (settings.videoFormat === 'mp4') {
    const mp4Path = path.join(settings.savePath, `recording-${timestamp}.mp4`);
    showNotification('正在保存：开始转码...', { x: width / 2, y: height / 2 });

    try {
      // DYNAMIC LOAD: Prevent startup crash
      const ffmpeg = require('fluent-ffmpeg');
      let staticPath = require('ffmpeg-static');
      if (typeof staticPath !== 'string' && staticPath.path) staticPath = staticPath.path;

      let ffmpegPath = staticPath;
      if (app.isPackaged) {
        ffmpegPath = staticPath.replace('app.asar', 'app.asar.unpacked');
      }

      ffmpeg.setFfmpegPath(ffmpegPath);

      await new Promise((resolve, reject) => {
        ffmpeg(webmPath)
          .inputOption('-fflags +genpts')
          .videoCodec('libx264')
          .addOutputOption('-preset', 'ultrafast')
          .save(mp4Path)
          .on('end', () => {
            resolve(null);
          })
          .on('error', (err: any) => {
            reject(err);
          });
      });

      showNotification('保存成功 (MP4+WebM)', { x: width / 2, y: height / 2 });

    } catch (e: any) {
      logDebug(`Conversion failed: ${e.message}`);
      showNotification('转码失败，已保存WebM', { x: width / 2, y: height / 2 });
    }
  } else {
    showNotification('保存成功 (WebM)', { x: width / 2, y: height / 2 });
  }
});

ipcMain.handle('close-selector', () => {
  isRecording = false;
  closeSelectorWindow();
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (ignore) {
      win.setIgnoreMouseEvents(true, { forward: true });
    } else {
      win.setIgnoreMouseEvents(false);
    }
  }
});

app.whenReady().then(() => {
  try {
    registerShortcuts();
    createTray();
    createRecorderWindow();

    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' });
      });
    });
  } catch (e) {
    console.error('AppReady error:', e);
  }
});

app.on('render-process-gone', (event, webContents, details) => {
  console.error('Render process gone:', details.reason, details.exitCode);
});

app.on('will-quit', () => {
  if (app.isReady()) {
    globalShortcut.unregisterAll();
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }
});
