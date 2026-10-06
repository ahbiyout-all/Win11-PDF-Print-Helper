import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import ptp from 'pdf-to-printer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    const devPort = process.env.PORT || 3000;
    win.loadURL(`http://localhost:${devPort}`);
    // win.webContents.openDevTools(); // Uncomment to open DevTools automatically in dev
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  // Handle PDF printing from renderer
  ipcMain.handle('print-pdf', async (event, { buffer, options }) => {
    try {
      // Create a temporary file path
      const tempFilePath = path.join(os.tmpdir(), `print_${Date.now()}.pdf`);
      
      // Write the buffer to the temp file
      fs.writeFileSync(tempFilePath, Buffer.from(buffer));
      
      // Print the file silently using pdf-to-printer
      // You can pass options like printer name if needed
      await ptp.print(tempFilePath, options);
      
      // Clean up the temp file
      fs.unlinkSync(tempFilePath);
      
      return { success: true };
    } catch (error) {
      console.error('Print failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Handle getting list of printers
  ipcMain.handle('get-printers', async (event) => {
    try {
      // Use Electron's native API to avoid character encoding issues (Korean text garbling)
      const electronPrinters = await event.sender.getPrintersAsync();
      const printers = electronPrinters.map(p => ({
        deviceId: p.name,
        name: p.displayName || p.name,
        status: p.status,
        isDefault: p.isDefault
      }));
      return { success: true, printers };
    } catch (error) {
      console.error('Failed to get printers:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle checking specific printer status
  ipcMain.handle('check-printer-status', async (event, printerName) => {
    try {
      const printers = await event.sender.getPrintersAsync();
      const printer = printers.find(p => p.name === printerName);
      
      if (!printer) {
        return { success: false, error: 'Printer not found' };
      }

      // Status 9 is Offline in many systems, but let's be more general
      // Common status codes: 0=Ready, 1=Printing, 2=Paused, 3=Error, 9=Offline
      return { 
        success: true, 
        status: printer.status,
        isOnline: printer.status !== 9 && printer.status !== 3, // Basic online check
        statusText: getStatusText(printer.status)
      };
    } catch (error) {
      console.error('Failed to check printer status:', error);
      return { success: false, error: error.message };
    }
  });

  function getStatusText(status) {
    const statusMap = {
      0: '준비 완료',
      1: '인쇄 중',
      2: '일시 중지됨',
      3: '오류',
      4: '삭제 대기 중',
      5: '용지 걸림',
      6: '용지 없음',
      7: '수동 급지 필요',
      8: '용지 문제',
      9: '오프라인',
      10: '통신 중',
      11: '바쁨',
      13: '출력함 가득 참',
      15: '토너 부족',
      19: '덮개 열림'
    };
    return statusMap[status] || `기타 상태 (${status})`;
  }

  // Handle saving logs
  ipcMain.handle('save-log', async (event, { message, type = 'INFO' }) => {
    try {
      const logDir = path.join(app.getPath('documents'), 'PDF_Helper_Logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      const date = new Date();
      const dateString = date.toISOString().split('T')[0];
      const timeString = date.toTimeString().split(' ')[0];
      const logFilePath = path.join(logDir, `print_log_${dateString}.txt`);
      
      const logEntry = `[${dateString} ${timeString}] [${type}] ${message}\n`;
      
      fs.appendFileSync(logFilePath, logEntry);
      
      return { success: true, path: logFilePath };
    } catch (error) {
      console.error('Failed to save log:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle opening log folder
  ipcMain.handle('open-log-folder', async () => {
    try {
      const { shell } = require('electron');
      const logDir = path.join(app.getPath('documents'), 'PDF_Helper_Logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      await shell.openPath(logDir);
      return { success: true };
    } catch (error) {
      console.error('Failed to open log folder:', error);
      return { success: false, error: error.message };
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
