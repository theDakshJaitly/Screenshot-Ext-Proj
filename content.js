// Configuration for auto-detection
let autoDetectEnabled = true;
let settings = {
  strongKeywords: [],
  supportingKeywords: [],
  detectionThreshold: 7,
  showNotifications: true,
  screenshotDelay: true,
  delayTime: 500
};

// Load settings from storage
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
}, function(items) {
  autoDetectEnabled = items.autoDetect;
  settings = items;
});

// Initialize and listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggleAutoDetect') {
    autoDetectEnabled = message.enabled;
    sendResponse({success: true});
  } else if (message.action === 'takeScreenshot') {
    captureReceipt()
      .then(() => sendResponse({success: true}))
      .catch(error => {
        console.error('Screenshot error:', error);
        sendResponse({success: false, error: error.toString()});
      });
    return true; // Keep the message channel open for async response
  }
});

// Add listener for settings updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'settingsUpdated') {
        // Update local settings
        settings = message.settings;
        
        // Re-run detection if needed
        if (autoDetectEnabled) {
            detectReceipt().then(isReceipt => {
                if (isReceipt) {
                    console.log('Receipt detected after settings update!');
                    if (settings.showNotifications) {
                        showToast('Receipt detected! Taking screenshot...');
                    }
                    captureReceipt();
                }
            });
        }
        
        sendResponse({success: true});
    }
});

// Function to detect receipts on the page
function detectReceipt() {
  try {
    // Get the page text content
    const pageText = document.body.innerText.toLowerCase();
    
    // First check for strong keywords - need at least one
    let hasStrongKeyword = false;
    for (const keyword of settings.strongKeywords) {
      if (pageText.includes(keyword.toLowerCase())) {
        hasStrongKeyword = true;
        break;
      }
    }

    if (!hasStrongKeyword) {
      return false;
    }
    
    // Count supporting keywords
    let supportingKeywordCount = 0;
    for (const keyword of settings.supportingKeywords) {
      if (pageText.includes(keyword.toLowerCase())) {
        supportingKeywordCount++;
      }
    }
    
    // Check for receipt-like structure
    const hasTable = document.querySelector('table') !== null;
    const hasList = document.querySelectorAll('ul, ol').length > 0;
    const hasGrid = document.querySelectorAll('div[class*="grid"], div[class*="row"]').length > 0;
    
    // Enhanced currency amounts pattern
    const currencyPatterns = [
      /[\$\€\£]\s*\d+[,.]\d{2}/g,  // Standard format
      /\d+[,.]\d{2}\s*[\$\€\£]/g,   // Trailing currency
      /\d+[,.]\d{2}\s*(?:EUR|USD|GBP|CAD|AUD|JPY|CNY)/gi,  // Currency codes
      /(?:EUR|USD|GBP|CAD|AUD|JPY|CNY)\s*\d+[,.]\d{2}/gi,  // Leading currency codes
      /(?:total|subtotal|tax):\s*[\$\€\£]?\s*\d+[,.]\d{2}/gi  // Labeled amounts
    ];
    
    let currencyMatches = 0;
    for (const pattern of currencyPatterns) {
      const matches = pageText.match(pattern) || [];
      currencyMatches += matches.length;
    }
    
    // Check for semantic context
    const receiptPhrases = [
      /thank you for your (purchase|order)/i,
      /order (number|#):\s*\w+/i,
      /payment (processed|received)/i,
      /item\s+quantity\s+price/i,
      /billing address/i,
      /shipping address/i,
      /payment method/i
    ];
    
    let phraseMatches = 0;
    for (const phrase of receiptPhrases) {
      if (phrase.test(pageText)) {
        phraseMatches++;
      }
    }
    
    // Check for header/footer indicators
    let headerFooterScore = 0;
    const headers = document.querySelectorAll('header, .header, h1, h2');
    for (const header of headers) {
      if (/(receipt|invoice|order confirmation|payment confirmation)/i.test(header.textContent)) {
        headerFooterScore += 2;
        break;
      }
    }
    
    const footers = document.querySelectorAll('footer, .footer');
    for (const footer of footers) {
      if (/(thank you for your (purchase|order)|keep this receipt)/i.test(footer.textContent)) {
        headerFooterScore++;
        break;
      }
    }
    
    // Check for negative indicators
    const negativePatterns = [
      /add to cart/i,
      /product description/i,
      /leave a comment/i,
      /sign up|register|create account/i,
      /search results/i
    ];
    
    let negativeScore = 0;
    for (const pattern of negativePatterns) {
      if (pattern.test(pageText)) {
        negativeScore++;
      }
    }
    
    // Score the page based on receipt characteristics
    let score = 0;
    if (supportingKeywordCount >= 3) score += 3;
    if (supportingKeywordCount >= 5) score += 2;
    if (hasTable) score += 2;
    if (hasList) score += 1;
    if (hasGrid) score += 1;
    if (currencyMatches >= 3) score += 3;
    if (currencyMatches >= 6) score += 2;
    if (phraseMatches >= 2) score += 3;
    if (headerFooterScore >= 2) score += 2;
    score -= negativeScore; // Subtract negative indicators
    
    console.log('Receipt detection score:', score, 'threshold:', settings.detectionThreshold);
    
    return score >= settings.detectionThreshold;
  } catch (error) {
    console.error('Error in receipt detection:', error);
    return false;
  }
}

// Function to find the receipt container using enhanced logic
function findReceiptContainer() {
  try {
    // Collect candidate containers
    const candidates = [];
    
    // Strategy 1: Look for receipt-specific class/id elements
    document.querySelectorAll('[id*="receipt"],[class*="receipt"],[id*="invoice"],[class*="invoice"],[id*="order-confirmation"],[class*="order-confirmation"]')
      .forEach(el => candidates.push({element: el, score: 5}));
    
    // Strategy 2: Look for elements with the most currency matches
    const elements = document.querySelectorAll('div, section, article, main');
    elements.forEach(el => {
      const currencyMatches = (el.innerText.match(/[\$\€\£]\s*\d+[,.]\d{2}/g) || []).length;
      if (currencyMatches >= 3) {
        candidates.push({element: el, score: currencyMatches});
      }
    });
    
    // Strategy 3: Tables with item/price structure
    document.querySelectorAll('table').forEach(table => {
      let score = 0;
      const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.toLowerCase());
      
      // Check for receipt-like headers
      if (headers.some(h => /(item|description|product)/i.test(h)) && 
          headers.some(h => /(price|amount|total)/i.test(h))) {
        score += 4;
      }
      
      // Check for price content
      const priceMatches = (table.innerText.match(/[\$\€\£]\s*\d+[,.]\d{2}/g) || []).length;
      score += Math.min(priceMatches, 5);
      
      candidates.push({element: table, score: score});
    });
    
    // Sort candidates by score and select the best one
    candidates.sort((a, b) => b.score - a.score);
    
    if (candidates.length > 0 && candidates[0].score >= 3) {
      return candidates[0].element;
    }
    
    // Fallback to prior implementation as safety
    const possibleContainers = [
      document.querySelector('div[id*="receipt"], div[class*="receipt"]'),
      document.querySelector('div[id*="invoice"], div[class*="invoice"]'),
      document.querySelector('div[id*="order"], div[class*="order"]'),
      document.querySelector('div[id*="confirmation"], div[class*="confirmation"]'),
      document.querySelector('div[id*="summary"], div[class*="summary"]'),
      document.querySelector('.order-details, .payment-details, .receipt-container')
    ].filter(Boolean);
    
    if (possibleContainers.length > 0) {
      return possibleContainers[0];
    }
    
    // Fallback to main content
    return document.querySelector('main') || document.body;
  } catch (error) {
    console.warn('Error finding receipt container:', error);
    return document.body;
  }
}

// Function to show an in-page toast notification
function showToast(message, type = 'success') {
  // Create toast element
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.padding = '10px 20px';
  toast.style.borderRadius = '4px';
  toast.style.color = '#fff';
  toast.style.zIndex = '10000';
  toast.style.opacity = '0';
  toast.style.transition = 'opacity 0.3s ease-in-out';
  
  // Set background color based on type
  if (type === 'success') {
    toast.style.backgroundColor = 'rgba(46, 125, 50, 0.9)';
  } else {
    toast.style.backgroundColor = 'rgba(211, 47, 47, 0.9)';
  }
  
  // Add to document
  document.body.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => {
    toast.style.opacity = '1';
  }, 10);
  
  // Remove after timeout
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 300);
  }, 3000);
}

// Function to capture and save receipt screenshot
async function captureReceipt() {
  try {
    const receiptElement = findReceiptContainer();
    
    if (!receiptElement) {
      console.error('No receipt element found');
      if (settings.showNotifications) {
        showToast('No receipt found on this page', 'error');
      }
      return false;
    }
    
    const originalBorder = receiptElement.style.border;
    receiptElement.style.border = '2px solid rgba(66, 133, 244, 0.7)';
    receiptElement.scrollIntoView({behavior: 'smooth', block: 'center'});
    
    if (settings.screenshotDelay) {
      await new Promise(resolve => setTimeout(resolve, settings.delayTime));
    }
    
    if (settings.showNotifications) {
      showToast('Taking receipt screenshot...');
    }
    
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'receiptDetected' },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            setTimeout(() => {
              receiptElement.style.border = originalBorder;
            }, 1000);
            resolve(response?.success || false);
          }
        }
      );
    });
  } catch (error) {
    console.error('Error capturing receipt:', error);
    if (settings.showNotifications) {
      showToast('Error capturing receipt', 'error');
    }
    return false;
  }
}

// Initialize - run receipt detection when page fully loads
window.addEventListener('load', () => {
  // Short delay to ensure all content is loaded
  setTimeout(() => {
    if (autoDetectEnabled && detectReceipt()) {
      console.log('Receipt detected on page!');
      if (settings.showNotifications) {
        showToast('Receipt detected! Taking screenshot...');
      }
      captureReceipt();
    }
  }, 1500);
});