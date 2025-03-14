// Core receipt detection module
class ReceiptDetector {
  constructor(settings) {
    this.settings = settings;
    this.patterns = {
      currency: [
        /[\$\€\£]\s*\d+[,.]\d{2}/g,
        /\d+[,.]\d{2}\s*[\$\€\£]/g,
        /\d+[,.]\d{2}\s*(?:EUR|USD|GBP|CAD|AUD|JPY|CNY)/gi,
        /(?:EUR|USD|GBP|CAD|AUD|JPY|CNY)\s*\d+[,.]\d{2}/gi,
        /(?:total|subtotal|tax):\s*[\$\€\£]?\s*\d+[,.]\d{2}/gi
      ],
      dates: [
        /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/,
        /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/,
        /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}/i
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
      ],
      urlPatterns: [
        /receipt/i, /invoice/i, /order.*confirm/i,
        /payment.*confirm/i, /checkout.*confirm/i,
        /purchase.*confirm/i, /transaction/i
      ]
    };
  }

  async detect() {
    try {
      const pageText = document.body.innerText.toLowerCase();
      if (!this._hasStrongKeyword(pageText)) {
        return false;
      }

      const scores = await this._calculateScores(pageText);
      const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);

      this._logDetectionResults(scores, totalScore);
      return totalScore >= this.settings.detectionThreshold;
    } catch (error) {
      console.error('Detection error:', error);
      return false;
    }
  }

  _hasStrongKeyword(pageText) {
    return this.settings.strongKeywords.some(keyword =>
      pageText.includes(keyword.toLowerCase())
    );
  }

  async _calculateScores(pageText) {
    const url = window.location.href.toLowerCase();
    const multiplier = this._getThresholdMultiplier();

    return {
      url: this._getUrlScore(url) * multiplier,
      structure: await this._detectStructure() * multiplier,
      content: this._analyzeContent(pageText) * multiplier,
      semantic: this._analyzeSemanticContext(pageText) * multiplier,
      visual: await this._checkVisualPatterns() * multiplier,
      headerFooter: this._checkHeaderFooter() * multiplier,
      negative: this._checkNegativeIndicators(pageText)
    };
  }

  _getThresholdMultiplier() {
    const multipliers = {
      5: 1.0,    // Very high sensitivity
      7: 1.2,    // High sensitivity (default)
      9: 1.5,    // Medium sensitivity
      11: 2.0    // Low sensitivity
    };
    return multipliers[this.settings.detectionThreshold] || 1.2;
  }

  _getUrlScore(url) {
    let score = 0;
    const hostname = new URL(url).hostname.toLowerCase();

    // Check URL patterns
    if (this.patterns.urlPatterns.some(pattern => pattern.test(url))) {
      score += 2;
    }

    // Check common receipt domains
    const receiptDomains = ['receipt', 'invoice', 'billing', 'orders', 'checkout', 'payment'];
    score += receiptDomains.filter(domain => hostname.includes(domain)).length;

    return score;
  }

  async _detectStructure() {
    const structureDetector = new StructureDetector();
    return await structureDetector.analyze();
  }

  _analyzeContent(pageText) {
    const contentAnalyzer = new ContentAnalyzer(this.settings, this.patterns);
    return contentAnalyzer.analyze(pageText);
  }

  _analyzeSemanticContext(pageText) {
    return this.patterns.phrases.reduce((score, phrase) => 
      score + (phrase.test(pageText) ? 2 : 0), 0);
  }

  async _checkVisualPatterns() {
    const visualAnalyzer = new VisualAnalyzer();
    return await visualAnalyzer.analyze();
  }

  _checkHeaderFooter() {
    const headerFooterChecker = new HeaderFooterChecker();
    return headerFooterChecker.analyze();
  }

  _checkNegativeIndicators(pageText) {
    return -this.patterns.negative.filter(pattern => 
      pattern.test(pageText)).length * 2;
  }

  _logDetectionResults(scores, totalScore) {
    console.log('Receipt detection scores:', {
      ...scores,
      total: totalScore,
      threshold: this.settings.detectionThreshold,
      multiplier: this._getThresholdMultiplier()
    });
  }
}

// Initialize detection
function detectReceipt() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({
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
    }, async (settings) => {
      const detector = new ReceiptDetector(settings);
      const result = await detector.detect();
      resolve(result);
    });
  });
}