// Service Worker Lifecycle
const ServiceWorker = {
  init() {
    self.addEventListener('activate', () => console.log('Service worker activated'));
    self.addEventListener('install', () => console.log('Service worker installed'));
    chrome.runtime.onStartup.addListener(() => ContextMenuManager.create());
  }
};

// Context Menu Management
const ContextMenuManager = {
  isCreated: false,

  create() {
    if (this.isCreated) return;
    
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'captureReceipt',
        title: 'Capture Receipt',
        contexts: ['page']
      });
      this.isCreated = true;
    });
  },

  init() {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === 'captureReceipt') {
        chrome.tabs.sendMessage(tab.id, { action: 'takeScreenshot' });
      }
    });
  }
};

// Storage Management
const StorageManager = {
  async get(key, defaultValue) {
    const result = await chrome.storage.sync.get({ [key]: defaultValue });
    return result[key];
  },

  async set(key, value) {
    await chrome.storage.sync.set({ [key]: value });
  },

  async getSettings() {
    return await this.get('settings', DEFAULT_SETTINGS);
  }
};

// Screenshot Management
const ScreenshotManager = {
  async capture() {
    const tab = await TabManager.getCurrentTab();
    if (!tab) throw new Error('No active tab found');

    const settings = await StorageManager.getSettings();
    
    if (settings.screenshotDelay) {
      await new Promise(resolve => setTimeout(resolve, settings.delayTime || 500));
    }

    const screenshotUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    await this.save(screenshotUrl, tab.url);
    return true;
  },

  async save(imageData, originalUrl) {
    if (!this._isValidImageData(imageData)) {
      throw new Error('Invalid image data');
    }

    const settings = await StorageManager.get('settings', {});
    const filename = this._generateFilename(originalUrl, settings);

    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: imageData,
        filename: filename,
        saveAs: false,
        conflictAction: 'uniquify'
      }, this._handleDownloadCallback.bind(this, resolve, reject, filename));
    });
  },

  _isValidImageData(imageData) {
    return imageData && (
      imageData.startsWith('data:image/png;base64,') || 
      imageData.startsWith('chrome-extension://')
    );
  },

  _generateFilename(url, settings) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const hostname = new URL(url).hostname;
    
    let filename = (settings.filenameFormat || 'receipt_{hostname}_{date}')
      .replace('{hostname}', hostname)
      .replace('{date}', timestamp)
      + '.png';

    if (settings.saveFolder?.trim()) {
      filename = `${settings.saveFolder.trim()}/${filename}`;
    }

    return filename;
  },

  _handleDownloadCallback(resolve, reject, filename, downloadId) {
    if (chrome.runtime.lastError) {
      reject(chrome.runtime.lastError);
    } else if (!downloadId) {
      reject(new Error('No download ID returned'));
    } else {
      resolve({ success: true, downloadId, path: filename });
    }
  }
};

// Tab Management
const TabManager = {
  async getCurrentTab() {
    const [tab] = await chrome.tabs.query({ 
      active: true, 
      currentWindow: true 
    });
    return tab;
  },

  async getCurrentHostname() {
    const tab = await this.getCurrentTab();
    return new URL(tab.url).hostname;
  }
};

// Website Blocking Management
const BlockingManager = {
  async blockWebsite(url) {
    const hostname = typeof url === 'string' ? url : new URL(url).hostname;
    const blockedSites = await StorageManager.get('blockedWebsites', []);
    
    if (blockedSites.includes(hostname)) {
      return 'This website is already blocked';
    }
    
    await StorageManager.set('blockedWebsites', [...blockedSites, hostname]);
    return 'Website blocked successfully';
  },

  async unblockWebsite(hostname) {
    const blockedSites = await StorageManager.get('blockedWebsites', []);
    const updatedSites = blockedSites.filter(site => site !== hostname);
    await StorageManager.set('blockedWebsites', updatedSites);
    return 'Website unblocked successfully';
  }
};

// Message Handler
const MessageHandler = {
  async handleMessage(request, sender, sendResponse) {
    try {
      const handler = this._getMessageHandler(request.action);
      if (!handler) return false;

      const result = await handler(request, sender);
      sendResponse(result);
      return true;
    } catch (error) {
      console.error('Message handling error:', error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  },

  _getMessageHandler(action) {
    const handlers = {
      'takeScreenshot': () => ScreenshotManager.capture(),
      'saveScreenshot': (req) => ScreenshotManager.save(req.imageData, req.originalUrl),
      'blockWebsite': async () => BlockingManager.blockWebsite(await TabManager.getCurrentHostname()),
      'unblockWebsite': (req) => BlockingManager.unblockWebsite(req.hostname),
      'updateSettings': (req) => StorageManager.set('settings', req.settings)
    };
    return handlers[action];
  }
};

// Initialize Extension
async function initializeExtension() {
  ServiceWorker.init();
  ContextMenuManager.init();
  
  // Setup message listener
  chrome.runtime.onMessage.addListener(
    MessageHandler.handleMessage.bind(MessageHandler)
  );
  
  // Setup tab update listener
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
      const settings = await StorageManager.getSettings();
      if (!settings.autoDetect) return;
      
      const blockedSites = await StorageManager.get('blockedWebsites', []);
      const hostname = new URL(tab.url).hostname;
      
      if (!blockedSites.includes(hostname)) {
        // Content script will handle detection
      }
    }
  });
}

// Start the extension
initializeExtension();