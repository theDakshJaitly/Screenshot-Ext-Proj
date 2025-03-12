// This function is injected into the page to detect receipts
function detectReceipt() {
  // Get settings from storage
  return new Promise((resolve) => {
    chrome.storage.sync.get({
      // Default values
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
      ]
    }, function(settings) {
      // Run detection with custom settings
      const result = runDetection(settings.strongKeywords, settings.supportingKeywords, settings.detectionThreshold);
      resolve(result);
    });
  });
}

// Main detection function
function runDetection(strongKeywords, supportingKeywords, threshold) {
  const pageText = document.body.innerText.toLowerCase();
  const url = window.location.href.toLowerCase();
  
  // Convert threshold value to scoring requirements
  const thresholdMultiplier = {
      5: 1.0,    // Very high sensitivity
      7: 1.2,    // High sensitivity (default)
      9: 1.5,    // Medium sensitivity
      11: 2.0    // Low sensitivity
  }[threshold] || 1.2;
  
  // URL-based pre-filtering with adjusted threshold
  const urlScore = getUrlScore(url) * thresholdMultiplier;
  
  // Check for strong keywords with context
  const strongKeywordScore = checkStrongKeywords(pageText, strongKeywords) * thresholdMultiplier;
  if (strongKeywordScore === 0) {
      return false;
  }

  // Collect all scores with adjusted weights
  const scores = {
      url: urlScore,
      strongKeyword: strongKeywordScore,
      structure: detectStructure() * thresholdMultiplier,
      content: analyzeContent(pageText, supportingKeywords) * thresholdMultiplier,
      semantic: analyzeSemanticContext(pageText) * thresholdMultiplier,
      visual: checkVisualPatterns() * thresholdMultiplier,
      headerFooter: checkHeaderFooter() * thresholdMultiplier,
      pattern: recognizeReceiptPatterns(pageText) * thresholdMultiplier,
      negative: checkNegativeIndicators(pageText)
  };

  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  
  // Log detection details
  console.log('Receipt detection scores:', {
      ...scores,
      total: totalScore,
      threshold: threshold,
      multiplier: thresholdMultiplier
  });
  
  return totalScore >= threshold;
}

function checkStrongKeywords(pageText, strongKeywords) {
  let score = 0;
  
  for (const keyword of strongKeywords) {
      if (pageText.includes(keyword.toLowerCase())) {
          score += 2;
          break;
      }
  }
  
  return score;
}

function getUrlScore(url) {
  let score = 0;
  const receiptUrlPatterns = [
      /receipt/i, /invoice/i, /order.*confirm/i, 
      /payment.*confirm/i, /checkout.*confirm/i,
      /purchase.*confirm/i, /transaction/i
  ];

  // Check URL patterns
  for (const pattern of receiptUrlPatterns) {
      if (pattern.test(url)) {
          score += 2;
          break;
      }
  }

  // Common receipt domains
  const receiptDomains = [
      'receipt', 'invoice', 'billing', 
      'orders', 'checkout', 'payment'
  ];

  const hostname = new URL(url).hostname.toLowerCase();
  for (const domain of receiptDomains) {
      if (hostname.includes(domain)) {
          score += 1;
      }
  }

  return score;
}

function detectStructure() {
  let score = 0;

  // Safer table detection
  try {
      const tables = Array.from(document.getElementsByTagName('table'));
      for (const table of tables) {
          // Check if table has price-like content
          if (table.innerText.match(/[\$\€\£]\s*\d+\.\d{2}/)) {
              score += 2;
              break;
          }
      }
  } catch (e) {
      console.warn('Table detection failed:', e);
  }

  // Grid structure detection
  try {
      const gridContainers = [
          ...document.querySelectorAll('div[class*="grid"]'),
          ...document.querySelectorAll('div[class*="row"]'),
          ...document.querySelectorAll('div[style*="grid"]'),
          ...document.querySelectorAll('div[style*="flex"]')
      ];
      
      if (gridContainers.length > 0) {
          score += 1;
      }
  } catch (e) {
      console.warn('Grid detection failed:', e);
  }

  // List structure detection
  try {
      const lists = document.querySelectorAll('ul, ol');
      for (const list of lists) {
          if (list.children.length >= 2 && list.innerText.match(/[\$\€\£]\s*\d+\.\d{2}/)) {
              score += 1;
              break;
          }
      }
  } catch (e) {
      console.warn('List detection failed:', e);
  }

  // Add check for visual patterns
  try {
      score += checkVisualPatterns();
  } catch (e) {
      console.warn('Visual pattern detection failed:', e);
  }

  return score;
}

function analyzeContent(pageText, supportingKeywords) {
  let score = 0;

  // Enhanced currency patterns
  const currencyPatterns = [
      /[\$\€\£]\s*\d+[,.]\d{2}/g,  // Standard format
      /\d+[,.]\d{2}\s*[\$\€\£]/g,   // Trailing currency
      /\d+[,.]\d{2}\s*(?:EUR|USD|GBP|CAD|AUD|JPY|CNY)/gi,  // Currency codes
      /(?:EUR|USD|GBP|CAD|AUD|JPY|CNY)\s*\d+[,.]\d{2}/gi,  // Leading currency codes
      /(?:total|subtotal|tax):\s*[\$\€\£]?\s*\d+[,.]\d{2}/gi  // Labeled amounts
  ];

  let totalCurrencyMatches = 0;
  for (const pattern of currencyPatterns) {
      const matches = pageText.match(pattern) || [];
      totalCurrencyMatches += matches.length;
  }

  if (totalCurrencyMatches >= 3) score += 3;

  // Supporting keywords with context
  let keywordScore = 0;
  for (const keyword of supportingKeywords) {
      const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (keywordRegex.test(pageText)) {
          keywordScore++;
      }
  }

  if (keywordScore >= 3) score += 2;
  if (keywordScore >= 5) score += 2;

  // Date patterns
  const datePatterns = [
      /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/,  // DD/MM/YYYY
      /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/,    // YYYY/MM/DD
      /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}/i  // Month DD, YYYY
  ];

  for (const pattern of datePatterns) {
      if (pattern.test(pageText)) {
          score += 1;
          break;
      }
  }

  return score;
}

// New function: Analyze semantic context
function analyzeSemanticContext(pageText) {
  let score = 0;
  
  // Check for key phrases with proper context
  const receiptPhrases = [
      /thank you for your (purchase|order)/i,
      /order (number|#):\s*\w+/i,
      /payment (processed|received)/i,
      /item\s+quantity\s+price/i,
      /billing address/i,
      /shipping address/i,
      /payment method/i
  ];
  
  for (const phrase of receiptPhrases) {
      if (phrase.test(pageText)) {
          score += 2;
      }
  }
  
  return score;
}

// New function: Check visual patterns
function checkVisualPatterns() {
  let score = 0;
  
  // Look for columns of aligned numbers (common in receipts)
  try {
      const textNodes = document.createTreeWalker(
          document.body, 
          NodeFilter.SHOW_TEXT
      );
      
      let numberAlignmentCount = 0;
      let node;
      while (node = textNodes.nextNode()) {
          if (/^\s*[\$\€\£]?\s*\d+[,.]\d{2}\s*$/.test(node.textContent)) {
              numberAlignmentCount++;
          }
      }
      
      if (numberAlignmentCount >= 3) score += 2;
  } catch (e) {
      console.warn('Number alignment check failed:', e);
  }
  
  // Check for receipt-like layout (items on left, prices on right)
  try {
      const contentDivs = document.querySelectorAll('div, p, li');
      let layoutMatchCount = 0;
      
      for (const div of contentDivs) {
          // Check if element has text on left and price on right
          if (/^.{10,50}[\$\€\£]\s*\d+[,.]\d{2}\s*$/.test(div.textContent)) {
              layoutMatchCount++;
          }
      }
      
      if (layoutMatchCount >= 3) score += 2;
  } catch (e) {
      console.warn('Layout check failed:', e);
  }
  
  return score;
}

// New function: Check header/footer
function checkHeaderFooter() {
  let score = 0;
  
  // Check headers
  try {
      const headers = document.querySelectorAll('header, .header, h1, h2');
      for (const header of headers) {
          if (/(receipt|invoice|order confirmation|payment confirmation)/i.test(header.textContent)) {
              score += 3;
              break;
          }
      }
  } catch (e) {
      console.warn('Header check failed:', e);
  }
  
  // Check footers
  try {
      const footers = document.querySelectorAll('footer, .footer');
      for (const footer of footers) {
          if (/(thank you for your (purchase|order)|keep this receipt)/i.test(footer.textContent)) {
              score += 2;
              break;
          }
      }
  } catch (e) {
      console.warn('Footer check failed:', e);
  }
  
  return score;
}

// New function: Recognize receipt patterns
function recognizeReceiptPatterns(pageText) {
  let score = 0;
  
  // Check for typical receipt section ordering
  const sections = [
      /merchant|store|business name/i,
      /date|time/i,
      /items|products|services/i,
      /subtotal/i,
      /tax/i,
      /total/i,
      /payment method/i
  ];
  
  let lastFoundIndex = -1;
  let sequentialMatches = 0;
  
  for (const pattern of sections) {
      // Find all matches
      const matches = [...pageText.matchAll(pattern)];
      if (matches.length > 0) {
          // Get index of first match
          const matchIndex = matches[0].index;
          if (matchIndex > lastFoundIndex) {
              sequentialMatches++;
              lastFoundIndex = matchIndex;
          }
      }
  }
  
  // If we found several sections in the expected order
  if (sequentialMatches >= 4) {
      score += 3;
  }
  
  return score;
}

// New function: Check negative indicators
function checkNegativeIndicators(pageText) {
  let negativeScore = 0;
  
  // Pages that are unlikely to be receipts
  const negativePatterns = [
      /add to cart/i,
      /product description/i,
      /leave a comment/i,
      /sign up|register|create account/i,
      /search results/i
  ];
  
  for (const pattern of negativePatterns) {
      if (pattern.test(pageText)) {
          negativeScore += 2;
      }
  }
  
  return -negativeScore; // Return as negative value
}

// Enhanced findReceiptContainer function
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
      
      // Fallback to main content
      return document.querySelector('main') || document.body;
  } catch (error) {
      console.warn('Error finding receipt container:', error);
      return document.body;
  }
}

function isPriceContainer(element) {
  if (!element) return false;
  
  const text = element.innerText.toLowerCase();
  return (
      // Has price amounts
      /[\$\€\£]\s*\d+\.\d{2}/.test(text) &&
      // Has receipt-like keywords
      /(sub)?total|amount|price/i.test(text) &&
      // Has at least one strong receipt indicator
      /(invoice|receipt|order\s+confirmation|payment)/i.test(text)
  );
}