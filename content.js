// Configuration for auto-detection
let autoDetectEnabled = true;
let lastScreenshotUrl = null; // Track last screenshot URL
let screenshotCooldown = false; // Prevent rapid screenshots
let settings = {
  strongKeywords: [],
  supportingKeywords: [],
  detectionThreshold: 7,
  showNotifications: true,
  screenshotDelay: true,
  delayTime: 500,
  cropScreenshot: true  // Add this line
};

// Add at the top with other variables
let detectionActive = true; // New flag to control detection state

// Define observer at the top with other variables
let observer;

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
  
  // Initialize observer
  observer = new MutationObserver((mutations) => {
    clearTimeout(observer.timeout);
    observer.timeout = setTimeout(async () => {
      // Check if detection is still active
      if (autoDetectEnabled && detectionActive && !screenshotCooldown) {
        const isReceipt = await detectReceipt();
        if (isReceipt && window.location.href !== lastScreenshotUrl) {
          console.log('Receipt detected after DOM mutation!');
          if (settings.showNotifications) {
            showToast('Receipt detected! Taking screenshot...');
          }
          lastScreenshotUrl = window.location.href;
          screenshotCooldown = true;
          detectionActive = false; // Stop further detection
          await captureReceipt();
          // We don't reset the cooldown or detectionActive flag
        }
      }
    }, 1000);
  });

  // Initialize detection on page load
  window.addEventListener('load', () => {
    setTimeout(async () => {
      if (autoDetectEnabled && detectionActive && !screenshotCooldown) {
        const isReceipt = await detectReceipt();
        if (isReceipt && window.location.href !== lastScreenshotUrl) {
          console.log('Receipt detected on page!');
          if (settings.showNotifications) {
            showToast('Receipt detected! Taking screenshot...');
          }
          lastScreenshotUrl = window.location.href;
          screenshotCooldown = true;
          detectionActive = false; // Stop further detection
          await captureReceipt();
        }
      }

      // Start observing for dynamic changes
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: false
      });
    }, 1500);
  });
});

// Update listeners to a single message handler at the top level
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggleAutoDetect') {
    autoDetectEnabled = message.enabled;
    sendResponse({success: true});
  } 
  else if (message.action === 'takeScreenshot') {
    if (screenshotCooldown || lastScreenshotUrl === window.location.href) {
      sendResponse({
        success: false, 
        error: 'Screenshot already taken for this page'
      });
      return true;
    }
    
    lastScreenshotUrl = window.location.href;
    screenshotCooldown = true;
    detectionActive = false; // Stop further detection
    
    captureReceipt()
      .then(() => {
        sendResponse({success: true});
      })
      .catch(error => {
        screenshotCooldown = false;
        detectionActive = true; // Re-enable detection only on error
        console.error('Screenshot error:', error);
        sendResponse({success: false, error: error.toString()});
      });
    return true;
  }
  else if (message.action === 'settingsUpdated') {
    settings = message.settings;
    
    // Re-run detection only if we haven't captured this page yet
    if (autoDetectEnabled && window.location.href !== lastScreenshotUrl && !screenshotCooldown) {
      (async () => {
        const isReceipt = await detectReceipt();
        if (isReceipt) {
          lastScreenshotUrl = window.location.href;
          screenshotCooldown = true;
          await captureReceipt();
          setTimeout(() => {
            screenshotCooldown = false;
          }, 5000);
        }
      })();
    }
    
    sendResponse({success: true});
    return true;
  }
});

// Function to detect receipts on the page
async function detectReceipt() {
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
    const candidates = [];
    
    // Strategy 1: Precise receipt containers with weighted scoring
    const receiptSelectors = [
      '[id*="receipt"]', '[class*="receipt"]',
      '[id*="invoice"]', '[class*="invoice"]',
      '[id*="order-confirmation"]', '[class*="order-confirmation"]',
      '[id*="order-details"]', '[class*="order-details"]',
      '[id*="payment-confirmation"]', '[class*="payment-confirmation"]'
    ];

    document.querySelectorAll(receiptSelectors.join(',')).forEach(el => {
      const score = evaluateContainer(el);
      if (score > 0) {
        candidates.push({ element: el, score });
      }
    });

    // Strategy 2: Table-based detection with strict structure analysis
    document.querySelectorAll('table').forEach(table => {
      const score = evaluateTable(table);
      if (score > 0) {
        candidates.push({ element: table, score });
      }
    });

    // Strategy 3: Structural analysis of content sections
    document.querySelectorAll('div, section, article').forEach(el => {
      if (el.children.length > 0) {  // Only check elements with children
        const score = evaluateStructure(el);
        if (score > 0) {
          candidates.push({ element: el, score });
        }
      }
    });

    // Debug logging
    console.log('Receipt candidates:', candidates.map(c => ({
      element: c.element.tagName,
      id: c.element.id,
      class: c.element.className,
      score: c.score
    })));

    // Sort and select best candidate
    candidates.sort((a, b) => b.score - a.score);
    
    if (candidates.length > 0 && candidates[0].score >= 5) {
      // Find the most compact container that includes all receipt content
      return findOptimalContainer(candidates[0].element);
    }

    return document.querySelector('main') || document.body;
  } catch (error) {
    console.warn('Error finding receipt container:', error);
    return document.body;
  }
}

function evaluateContainer(element) {
  let score = 0;
  const text = element.innerText.toLowerCase();
  
  // Check for essential receipt components
  if (/(sub)?total|amount paid|grand total/i.test(text)) score += 3;
  if (/order\s*(#|number|id)/i.test(text)) score += 2;
  if (/date|payment method/i.test(text)) score += 2;
  
  // Check price patterns
  const prices = text.match(/[\$\€\£]\s*\d+[,.]\d{2}/g) || [];
  score += Math.min(prices.length, 5);
  
  // Check layout structure
  if (element.querySelector('table')) score += 2;
  if (element.querySelectorAll('div[class*="row"], div[class*="item"]').length > 2) score += 2;
  
  // Check dimensions and position
  const rect = element.getBoundingClientRect();
  if (rect.width > 200 && rect.width < window.innerWidth * 0.9) score += 1;
  if (rect.height > 200 && rect.height < document.body.scrollHeight * 0.9) score += 1;

  return score;
}

function evaluateTable(table) {
  let score = 0;
  const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.toLowerCase());
  
  // Check for receipt-like columns
  if (headers.some(h => /(item|description|product)/i.test(h))) score += 2;
  if (headers.some(h => /(price|amount|total)/i.test(h))) score += 2;
  if (headers.some(h => /(quantity|qty)/i.test(h))) score += 1;
  
  // Check for price content
  const rows = table.querySelectorAll('tr');
  let priceColumns = 0;
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    cells.forEach(cell => {
      if (/[\$\€\£]\s*\d+[,.]\d{2}/.test(cell.textContent)) {
        priceColumns++;
      }
    });
  });
  
  score += Math.min(priceColumns / rows.length, 3);
  return score;
}

function evaluateStructure(element) {
  let score = 0;
  const text = element.innerText.toLowerCase();

  // Check content structure
  const contentStructure = {
    // Receipt header checks
    hasHeader: /(receipt|invoice|order confirmation)/i.test(element.querySelector('header, .header, h1, h2')?.textContent || ''),
    
    // Item list checks
    hasItemList: element.querySelectorAll('li, tr, div[class*="item"]').length > 2,
    
    // Price patterns
    hasPricePatterns: /[\$\€\£]\s*\d+[,.]\d{2}/g.test(text),
    
    // Receipt footer checks
    hasFooter: /(thank you|total|subtotal|balance)/i.test(element.querySelector('footer, .footer, *:last-child')?.textContent || '')
  };

  // Score based on structure
  if (contentStructure.hasHeader) score += 3;
  if (contentStructure.hasItemList) score += 2;
  if (contentStructure.hasPricePatterns) score += 2;
  if (contentStructure.hasFooter) score += 2;

  // Check for receipt-like layout
  const layout = {
    hasTable: element.querySelector('table') !== null,
    hasGrid: element.querySelectorAll('div[class*="grid"], div[class*="row"]').length > 0,
    hasColumns: element.querySelectorAll('div[class*="col"], td').length > 0
  };

  if (layout.hasTable) score += 2;
  if (layout.hasGrid) score += 1;
  if (layout.hasColumns) score += 1;

  // Check content density and size
  const rect = element.getBoundingClientRect();
  const contentDensity = text.length / (rect.width * rect.height);
  
  if (contentDensity > 0.01) score += 1; // Dense content
  if (rect.width > 300 && rect.width < window.innerWidth * 0.8) score += 1; // Good width
  if (rect.height > 200 && rect.height < window.innerHeight * 0.9) score += 1; // Good height

  return score;
}

function findOptimalContainer(element) {
  // Look for the smallest container that contains all receipt content
  let current = element;
  let best = element;
  let bestScore = evaluateContainer(element);

  while (current.parentElement && 
         current.parentElement !== document.body && 
         current.parentElement.tagName !== 'MAIN') {
    const parent = current.parentElement;
    const parentScore = evaluateContainer(parent);
    
    if (parentScore > bestScore) {
      best = parent;
      bestScore = parentScore;
    }
    current = parent;
  }

  return best;
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

    console.log('Receipt element found:', receiptElement);

    // Scroll the element into view and wait
    receiptElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });

    // Wait for scroll and animations
    await new Promise(resolve => setTimeout(resolve, settings.delayTime || 500));

    // Add visual feedback
    const rect = receiptElement.getBoundingClientRect();
    const highlighter = document.createElement('div');
    highlighter.style.position = 'fixed';
    highlighter.style.border = '2px solid rgba(66, 133, 244, 0.7)';
    highlighter.style.backgroundColor = 'rgba(66, 133, 244, 0.1)';
    highlighter.style.zIndex = '9999';
    highlighter.style.pointerEvents = 'none';
    Object.assign(highlighter.style, {
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px'
    });
    document.body.appendChild(highlighter);

    if (settings.showNotifications) {
      showToast('Taking receipt screenshot...');
    }

    // Take screenshot
    const canvas = await html2canvas(receiptElement, {
      backgroundColor: '#ffffff',
      logging: true, // Enable logging for debugging
      scale: window.devicePixelRatio || 1,
      useCORS: true,
      allowTaint: true
    });

    // Clean up
    document.body.removeChild(highlighter);

    // Convert to data URL
    const imageData = canvas.toDataURL('image/png');
    console.log('Image data created, length:', imageData.length); // Debug log

    // Send to background script
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'saveScreenshot',
        imageData: imageData,
        originalUrl: window.location.href
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Message sending failed:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          console.log('Save response:', response); // Debug log
          if (response && response.success) {
            if (settings.showNotifications) {
              showToast('Receipt saved successfully!');
            }
            resolve(true);
          } else {
            reject(new Error(response?.error || 'Failed to save screenshot'));
          }
        }
      });
    });

  } catch (error) {
    console.error('Error capturing receipt:', error);
    if (settings.showNotifications) {
      showToast('Error capturing receipt: ' + error.message, 'error');
    }
    throw error;
  }
}