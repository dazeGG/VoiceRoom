'use strict';

const { app, BrowserWindow, desktopCapturer, dialog, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const runtimeConfig = readRuntimeConfig();
const APP_URL = process.env.VOICE_ROOM_URL || runtimeConfig.voiceRoomUrl || '';
const TRUSTED_ORIGIN = APP_URL ? new URL(APP_URL).origin : '';

function readRuntimeConfig() {
  const configPath = path.join(__dirname, 'runtime-config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function isTrustedUrl(rawUrl) {
  try {
    return new URL(rawUrl).origin === TRUSTED_ORIGIN;
  } catch {
    return false;
  }
}

function configurePermissions() {
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = new Set(['display-capture', 'media', 'mediaKeySystem', 'clipboard-sanitized-write']);
    const allowed = allowedPermissions.has(permission) && isTrustedUrl(webContents.getURL());
    callback(allowed);
  });

  defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const allowedPermissions = new Set(['display-capture', 'media', 'mediaKeySystem', 'clipboard-sanitized-write']);
    return Boolean(TRUSTED_ORIGIN) && allowedPermissions.has(permission) && requestingOrigin === TRUSTED_ORIGIN && isTrustedUrl(webContents.getURL());
  });

  defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          fetchWindowIcons: true,
          types: ['screen', 'window']
        });
        const source = sources[0];
        if (!source) {
          callback({});
          return;
        }
        callback({ video: source, audio: 'loopback' });
      } catch (error) {
        console.error('Display media request failed:', error);
        callback({});
      }
    },
    { useSystemPicker: true }
  );
}

function createWindow() {
  if (!APP_URL) {
    dialog.showErrorBox('Voice Room', 'Не задан VOICE_ROOM_URL. Создайте .env или electron/runtime-config.json.');
    app.quit();
    return;
  }

  const mainWindow = new BrowserWindow({
    backgroundColor: '#10110f',
    height: 820,
    minHeight: 620,
    minWidth: 420,
    show: false,
    title: 'Voice Room',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true
    },
    width: 1180
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) return { action: 'allow' };
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isTrustedUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => {});
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details);
  });

  mainWindow.loadURL(APP_URL).catch((error) => {
    dialog.showErrorBox('Voice Room', `Не удалось открыть ${APP_URL}\n\n${error.message}`);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(() => {
    configurePermissions();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
