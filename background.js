// Place at the very top of background.js
self.addEventListener('activate', (event) => {
  console.log('Service worker activated');
});

self.addEventListener('install', (event) => {
  console.log('Service worker installed');
});

// Receipt Screenshot Extension - Background Script

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'receiptDetected' || request.action === 'manualCapture') {
    // Start the capture process
    captureReceipt()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Screenshot error:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true; // Keep the message channel open
  }
  
  else if (request.action === 'takeScreenshot' || request.action === 'captureScreenshot') {
    captureReceipt()
      .then(result => {
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error capturing screenshot:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicate async response
  }
  
  else if (request.action === 'toggleAutoDetect') {
    chrome.storage.sync.set({ autoDetect: request.enabled }, () => {
      sendResponse({ success: true });
    });
    return true; // Indicate async response
  }
  
  else if (request.action === 'blockWebsite') {
    getCurrentTabUrl()
      .then(url => {
        return blockWebsite(url);
      })
      .then(result => {
        sendResponse({ success: true, message: result });
      })
      .catch(error => {
        sendResponse({ success: false, message: error.message });
      });
    return true; // Indicate async response
  }
  
  else if (request.action === 'unblockWebsite') {
    unblockWebsite(request.hostname)
      .then(result => {
        sendResponse({ success: true, message: result });
      })
      .catch(error => {
        sendResponse({ success: false, message: error.message });
      });
    return true; // Indicate async response
  }
  
  else if (request.action === 'updateSettings') {
    // Update user settings
    chrome.storage.sync.set(request.settings, () => {
      sendResponse({ success: true });
    });
    return true; // Indicate async response
  }
});

// Watch for tab updates to check if auto-detection should be enabled
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  // Only run when the page has finished loading
  if (changeInfo.status === 'complete') {
    // Check if auto-detection is enabled
    chrome.storage.sync.get(['autoDetect', 'blockedWebsites'], function(data) {
      const autoDetect = data.autoDetect !== false; // Default to true
      
      if (!autoDetect) {
        return; // Auto-detection is disabled
      }
      
      // Check if the current site is in the blocked list
      const blockedWebsites = data.blockedWebsites || [];
      
      try {
        const currentHostname = new URL(tab.url).hostname;
        
        if (blockedWebsites.includes(currentHostname)) {
          return; // Site is blocked, skip detection
        }
      } catch (error) {
        console.error('Error parsing URL:', error);
        return; // Invalid URL, skip detection
      }
      
      // The content script will handle the detection automatically
      // We don't need to do anything here as the content script 
      // is already injected via the manifest
    });
  }
});

// Function to capture the current tab as a screenshot
async function captureReceipt() {
  try {
    // Get the current tab first
    const tab = await getCurrentTab();
    if (!tab) throw new Error('No active tab found');

    // Get screenshot delay settings
    const settings = await chrome.storage.sync.get(['screenshotDelay', 'delayTime']);
    
    // Add delay if configured
    if (settings.screenshotDelay) {
      await new Promise(resolve => setTimeout(resolve, settings.delayTime || 500));
    }

    // Capture the screenshot
    const screenshotUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png'
    });

    // Generate filename
    const hostname = new URL(tab.url).hostname;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `receipt_${hostname}_${timestamp}.png`;

    // Download the screenshot
    await chrome.downloads.download({
      url: screenshotUrl,
      filename: filename,
      saveAs: false
    });

    return true;
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    throw error;
  }
}

// Function to get the current active tab
async function getCurrentTab() {
  const queryOptions = { active: true, currentWindow: true };
  const [tab] = await chrome.tabs.query(queryOptions);
  return tab;
}

// Function to get the current tab URL
async function getCurrentTabUrl() {
  const tab = await getCurrentTab();
  return new URL(tab.url).hostname;
}

// Function to block a website
async function blockWebsite(url) {
  try {
    // Get the hostname from the URL
    const hostname = typeof url === 'string' ? url : new URL(url).hostname;
    
    // Get the current list of blocked websites
    const data = await chrome.storage.sync.get(['blockedWebsites']);
    const blockedWebsites = data.blockedWebsites || [];
    
    // Check if the website is already blocked
    if (blockedWebsites.includes(hostname)) {
      return 'This website is already blocked';
    }
    
    // Add the hostname to the blocked list
    blockedWebsites.push(hostname);
    
    // Save the updated list
    await chrome.storage.sync.set({ blockedWebsites });
    
    return 'Website blocked successfully';
  } catch (error) {
    console.error('Error blocking website:', error);
    throw new Error('Failed to block website');
  }
}

// Function to unblock a website
async function unblockWebsite(hostname) {
  try {
    // Get the current list of blocked websites
    const data = await chrome.storage.sync.get(['blockedWebsites']);
    let blockedWebsites = data.blockedWebsites || [];
    
    // Remove the hostname from the blocked list
    blockedWebsites = blockedWebsites.filter(site => site !== hostname);
    
    // Save the updated list
    await chrome.storage.sync.set({ blockedWebsites });
    
    return 'Website unblocked successfully';
  } catch (error) {
    console.error('Error unblocking website:', error);
    throw new Error('Failed to unblock website');
  }
}

// Initialize context menu
function createContextMenu() {
  chrome.contextMenus.create({
    id: 'captureReceipt',
    title: 'Capture Receipt',
    contexts: ['page']
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Context menu creation error:', chrome.runtime.lastError);
    }
  });
}

// Set up context menu click handler - MOVED OUTSIDE onInstalled
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'captureReceipt') {
    chrome.tabs.sendMessage(tab.id, { action: 'takeScreenshot' });
  }
});

// Initialize context menu on install
chrome.runtime.onInstalled.addListener((details) => {
  // Create context menu
  createContextMenu();

  // Set default settings on install
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      autoDetect: true,
      showNotifications: true,
      detectionThreshold: 7,
      saveFolder: '',
      filenameFormat: 'receipt_{hostname}_{date}',
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
      delayTime: 500,
      blockedWebsites: []
    });
  }
});

// Re-create context menu when service worker starts
chrome.runtime.onStartup.addListener(createContextMenu);