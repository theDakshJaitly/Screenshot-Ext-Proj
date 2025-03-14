// Core state management with better encapsulation
const ExtensionState = {
  _state: {
    autoDetectEnabled: true,
    lastScreenshotUrl: null,
    screenshotCooldown: false,
    detectionActive: true,
    observer: null,
    settings: {
      strongKeywords: [],
      supportingKeywords: [],
      detectionThreshold: 7,
      showNotifications: true,
      screenshotDelay: true,
      delayTime: 500,
      cropScreenshot: true
    }
  },

  get settings() { return this._state.settings; },
  get isDetectionActive() { return this._state.detectionActive; },
  get isAutoDetectEnabled() { return this._state.autoDetectEnabled; },
  get isCooldownActive() { return this._state.screenshotCooldown; },
  get lastUrl() { return this._state.lastScreenshotUrl; },
  get observer() { return this._state.observer; },

  updateSettings(newSettings) {
    Object.assign(this._state.settings, newSettings);
  },

  setDetectionState(active) {
    this._state.detectionActive = active;
  },

  setCooldown(active) {
    this._state.screenshotCooldown = active;
  },

  setLastUrl(url) {
    this._state.lastScreenshotUrl = url;
  },

  setObserver(observer) {
    this._state.observer = observer;
  },

  setAutoDetect(enabled) {
    this._state.autoDetectEnabled = enabled;
  }
};

// Pattern collections for receipt detection
const Patterns = {
  currency: [
    /[\$\€\£]\s*\d+[,.]\d{2}/g,
    /\d+[,.]\d{2}\s*[\$\€\£]/g,
    /\d+[,.]\d{2}\s*(?:EUR|USD|GBP|CAD|AUD|JPY|CNY)/gi,
    /(?:EUR|USD|GBP|CAD|AUD|JPY|CNY)\s*\d+[,.]\d{2}/gi,
    /(?:total|subtotal|tax):\s*[\$\€\£]?\s*\d+[,.]\d{2}/gi
  ],
  phrases: [
    /thank you for your (purchase|order)/i,
    /order (number|#):\s*\w+/i,
    /payment (processed|received)/i,
    /item\s+quantity\s+price/i,
    /billing address/i,
    /shipping address/i,
    /payment method/i
  ],
  negative: [
    /add to cart/i,
    /product description/i,
    /leave a comment/i,
    /sign up|register|create account/i,
    /search results/i
  ]
};

// Detection utilities
const DetectionUtils = {
  async detectReceipt() {
    try {
      const pageText = document.body.innerText.toLowerCase();
      if (!this.hasStrongKeyword(pageText)) return false;
      const score = this.calculateScore(pageText);
      return score >= ExtensionState.settings.detectionThreshold;
    } catch (error) {
      console.error('Detection error:', error);
      return false;
    }
  },

  hasStrongKeyword(pageText) {
    return ExtensionState.settings.strongKeywords.some(keyword => 
      pageText.includes(keyword.toLowerCase())
    );
  },

  calculateScore(pageText) {
    let score = 0;
    score += this.getKeywordScore(pageText);
    score += this.getStructureScore();
    score += this.getCurrencyScore(pageText);
    score += this.getPhraseScore(pageText);
    score += this.getHeaderFooterScore();
    score -= this.getNegativeScore(pageText);
    return score;
  }
  // ... split other scoring methods into smaller functions
};

// Screenshot handling
const ScreenshotManager = {
  async capture() {
    try {
      const element = this.findReceiptContainer();
      if (!element) return false;

      await this.scrollIntoView(element);
      const highlighter = this.showHighlighter(element);
      const imageData = await this.takeScreenshot(element);
      this.removeHighlighter(highlighter);

      return this.saveScreenshot(imageData);
    } catch (error) {
      console.error('Capture error:', error);
      throw error;
    }
  }
  // ... split other capture methods into smaller functions
};

// Notification manager
const NotificationManager = {
  show(message, type = 'success') {
    const toast = this._createToastElement(message, type);
    this._animateToast(toast);
  },

  _createToastElement(message, type) {
    const toast = document.createElement('div');
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      padding: '10px 20px',
      borderRadius: '4px',
      color: '#fff',
      zIndex: '10000',
      opacity: '0',
      transition: 'opacity 0.3s ease-in-out',
      backgroundColor: type === 'success' ? 
        'rgba(46, 125, 50, 0.9)' : 
        'rgba(211, 47, 47, 0.9)'
    });
    document.body.appendChild(toast);
    return toast;
  },

  _animateToast(toast) {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => document.body.removeChild(toast), 300);
      }, 3000);
    });
  }
};

// Message handler with improved organization
const MessageHandler = {
  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.action) {
        case 'toggleAutoDetect':
          return this._handleToggleAutoDetect(message, sendResponse);
        case 'takeScreenshot':
          return this._handleTakeScreenshot(sendResponse);
        case 'settingsUpdated':
          return this._handleSettingsUpdate(message, sendResponse);
        default:
          return false;
      }
    } catch (error) {
      console.error('Message handling error:', error);
      sendResponse({ success: false, error: error.message });
      return false;
    }
  },

  _handleToggleAutoDetect(message, sendResponse) {
    ExtensionState.setAutoDetect(message.enabled);
    sendResponse({ success: true });
    return false;
  },

  async _handleTakeScreenshot(sendResponse) {
    if (ExtensionState.isCooldownActive || 
        ExtensionState.lastUrl === window.location.href) {
      sendResponse({
        success: false,
        error: 'Screenshot already taken for this page'
      });
      return true;
    }

    try {
      ExtensionState.setLastUrl(window.location.href);
      ExtensionState.setCooldown(true);
      ExtensionState.setDetectionState(false);

      await ScreenshotManager.capture();
      sendResponse({ success: true });
    } catch (error) {
      ExtensionState.setCooldown(false);
      ExtensionState.setDetectionState(true);
      console.error('Screenshot error:', error);
      sendResponse({ success: false, error: error.toString() });
    }
    return true;
  },

  async _handleSettingsUpdate(message, sendResponse) {
    ExtensionState.updateSettings(message.settings);
    if (this._shouldDetectAfterUpdate()) {
      await this._detectAndCapture();
    }
    sendResponse({ success: true });
    return true;
  },

  _shouldDetectAfterUpdate() {
    return ExtensionState.isAutoDetectEnabled && 
           !ExtensionState.isCooldownActive &&
           window.location.href !== ExtensionState.lastUrl;
  },

  async _detectAndCapture() {
    const isReceipt = await DetectionUtils.detectReceipt();
    if (isReceipt) {
      ExtensionState.setLastUrl(window.location.href);
      ExtensionState.setCooldown(true);
      await ScreenshotManager.capture();
      setTimeout(() => ExtensionState.setCooldown(false), 5000);
    }
  }
};

// Observer setup with better error handling
const ObserverSetup = {
  init() {
    const observer = new MutationObserver(this._handleMutations.bind(this));
    ExtensionState.setObserver(observer);
    this._setupLoadListener();
  },

  _handleMutations(mutations) {
    clearTimeout(ExtensionState.observer.timeout);
    ExtensionState.observer.timeout = setTimeout(
      this._checkForReceipt.bind(this), 
      1000
    );
  },

  async _checkForReceipt() {
    if (!this._shouldCheckReceipt()) return;

    const isReceipt = await DetectionUtils.detectReceipt();
    if (isReceipt && window.location.href !== ExtensionState.lastUrl) {
      await this._handleReceiptDetected();
    }
  },

  _shouldCheckReceipt() {
    return ExtensionState.isAutoDetectEnabled && 
           ExtensionState.isDetectionActive && 
           !ExtensionState.isCooldownActive;
  },

  async _handleReceiptDetected() {
    console.log('Receipt detected after DOM mutation!');
    if (ExtensionState.settings.showNotifications) {
      NotificationManager.show('Receipt detected! Taking screenshot...');
    }
    ExtensionState.setLastUrl(window.location.href);
    ExtensionState.setCooldown(true);
    ExtensionState.setDetectionState(false);
    await ScreenshotManager.capture();
  },

  _setupLoadListener() {
    window.addEventListener('load', () => {
      setTimeout(this._checkForReceipt.bind(this), 1500);
      ExtensionState.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: false
      });
    });
  }
};

// Initialize the extension
function initializeExtension() {
  chrome.storage.sync.get({
    // Default values
    autoDetect: true,
    showNotifications: true,
    detectionThreshold: 7,
    strongKeywords: [
      'receipt', 'invoice', 'order confirmation', 'payment confirmation',
      'tax invoice', 'billing statement', 'purchase receipt'
    ],
    supportingKeywords: [
      'subtotal', 'total', 'amount paid', 'order summary', 'tax', 
      'purchase', 'payment method', 'billing', 'order number',
      'transaction', 'date of purchase', 'merchant', 'item', 'quantity',
      'unit price', 'discount', 'payment', 'due date', 'account number'
    ],
    screenshotDelay: true,
    delayTime: 500
  }, items => {
    ExtensionState.updateSettings(items);
    ObserverSetup.init();
    chrome.runtime.onMessage.addListener(MessageHandler.handleMessage.bind(MessageHandler));
  });
}

initializeExtension();