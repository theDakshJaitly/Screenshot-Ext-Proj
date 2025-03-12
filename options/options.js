document.addEventListener('DOMContentLoaded', function() {
    // Get form elements
    const autoDetectToggle = document.getElementById('autoDetect');
    const showNotificationsToggle = document.getElementById('showNotifications');
    const detectionThreshold = document.getElementById('detectionThreshold');
    const saveFolderInput = document.getElementById('saveFolder');
    const chooseFolderBtn = document.getElementById('chooseFolderBtn');
    const filenameFormat = document.getElementById('filenameFormat');
    const strongKeywordsContainer = document.getElementById('strongKeywords');
    const supportingKeywordsContainer = document.getElementById('supportingKeywords');
    const newStrongKeywordInput = document.getElementById('newStrongKeyword');
    const addStrongKeywordBtn = document.getElementById('addStrongKeyword');
    const newSupportingKeywordInput = document.getElementById('newSupportingKeyword');
    const addSupportingKeywordBtn = document.getElementById('addSupportingKeyword');
    const screenshotDelayToggle = document.getElementById('screenshotDelay');
    const delayTimeInput = document.getElementById('delayTime');
    const saveSettingsBtn = document.getElementById('saveSettings');
    const statusElement = document.getElementById('status');
    
    // Default detection keywords
    const defaultStrongKeywords = [
      'receipt', 'invoice', 'order confirmation', 'payment confirmation',
      'tax invoice', 'billing statement', 'purchase receipt'
    ];
    
    const defaultSupportingKeywords = [
      'subtotal', 'total', 'amount paid', 'order summary', 'tax', 
      'purchase', 'payment method', 'billing', 'order number',
      'transaction', 'date of purchase', 'merchant', 'item', 'quantity',
      'unit price', 'discount', 'payment', 'due date', 'account number'
    ];
    
    // Load saved settings
    loadSettings();
    
    // Event listeners
    chooseFolderBtn.addEventListener('click', chooseSaveFolder);
    addStrongKeywordBtn.addEventListener('click', () => addKeyword('strong'));
    addSupportingKeywordBtn.addEventListener('click', () => addKeyword('supporting'));
    saveSettingsBtn.addEventListener('click', saveSettings);
    
    // Function to load settings
    function loadSettings() {
      chrome.storage.sync.get({
        // Default values
        autoDetect: true,
        showNotifications: true,
        detectionThreshold: 7,
        saveFolder: '',
        filenameFormat: 'receipt_{hostname}_{date}',
        strongKeywords: defaultStrongKeywords,
        supportingKeywords: defaultSupportingKeywords,
        screenshotDelay: true,
        delayTime: 500
      }, function(items) {
        // Set form values
        autoDetectToggle.checked = items.autoDetect;
        showNotificationsToggle.checked = items.showNotifications;
        detectionThreshold.value = items.detectionThreshold;
        saveFolderInput.value = items.saveFolder;
        filenameFormat.value = items.filenameFormat;
        screenshotDelayToggle.checked = items.screenshotDelay;
        delayTimeInput.value = items.delayTime;
        
        // Render keywords
        renderKeywords('strong', items.strongKeywords);
        renderKeywords('supporting', items.supportingKeywords);

        // Update sensitivity description
        updateSensitivityDescription(items.detectionThreshold);
      });
    }
    
    // Add new function to update sensitivity description
    function updateSensitivityDescription(threshold) {
      const description = document.getElementById('sensitivityDescription');
      if (description) {
        const descriptions = {
          5: 'Very high (may have false positives)',
          7: 'High (recommended)',
          9: 'Medium (fewer false positives)',
          11: 'Low (strict detection)'
        };
        description.textContent = descriptions[threshold] || descriptions[7];
      }
    }

    // Function to save settings
    function saveSettings() {
      // Get current strong keywords
      const strongKeywords = [];
      document.querySelectorAll('#strongKeywords .keyword').forEach(element => {
        strongKeywords.push(element.dataset.keyword);
      });
      
      // Get current supporting keywords
      const supportingKeywords = [];
      document.querySelectorAll('#supportingKeywords .keyword').forEach(element => {
        supportingKeywords.push(element.dataset.keyword);
      });
      
      // Save all settings
      const settings = {
        autoDetect: autoDetectToggle.checked,
        showNotifications: showNotificationsToggle.checked,
        detectionThreshold: parseInt(detectionThreshold.value),
        saveFolder: saveFolderInput.value,
        filenameFormat: filenameFormat.value,
        strongKeywords: strongKeywords,
        supportingKeywords: supportingKeywords,
        screenshotDelay: screenshotDelayToggle.checked,
        delayTime: parseInt(delayTimeInput.value)
      };

      chrome.storage.sync.set(settings, function() {
        // Show saved message
        showSavedMessage();
        
        // Notify content script of settings change
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'settingsUpdated',
              settings: settings
            });
          }
        });
      });
    }
    
    // Function to render keywords
    function renderKeywords(type, keywords) {
      const container = type === 'strong' ? strongKeywordsContainer : supportingKeywordsContainer;
      container.innerHTML = '';
      
      keywords.forEach(keyword => {
        const keywordElement = document.createElement('div');
        keywordElement.className = 'keyword';
        keywordElement.dataset.keyword = keyword;
        
        const keywordSpan = document.createElement('span');
        keywordSpan.textContent = keyword;
        
        const removeButton = document.createElement('button');
        removeButton.textContent = '×';
        removeButton.title = 'Remove';
        removeButton.addEventListener('click', () => removeKeyword(type, keywordElement));
        
        keywordElement.appendChild(keywordSpan);
        keywordElement.appendChild(removeButton);
        container.appendChild(keywordElement);
      });
    }
    
    // Function to add new keyword
    function addKeyword(type) {
      const input = type === 'strong' ? newStrongKeywordInput : newSupportingKeywordInput;
      const keyword = input.value.trim();
      
      if (!keyword) {
        return;
      }
      
      // Create new keyword element
      const container = type === 'strong' ? strongKeywordsContainer : supportingKeywordsContainer;
      const keywordElement = document.createElement('div');
      keywordElement.className = 'keyword';
      keywordElement.dataset.keyword = keyword;
      
      const keywordSpan = document.createElement('span');
      keywordSpan.textContent = keyword;
      
      const removeButton = document.createElement('button');
      removeButton.textContent = '×';
      removeButton.title = 'Remove';
      removeButton.addEventListener('click', () => removeKeyword(type, keywordElement));
      
      keywordElement.appendChild(keywordSpan);
      keywordElement.appendChild(removeButton);
      container.appendChild(keywordElement);
      
      // Clear input
      input.value = '';
    }
    
    // Function to remove keyword
    function removeKeyword(type, element) {
      const container = type === 'strong' ? strongKeywordsContainer : supportingKeywordsContainer;
      container.removeChild(element);
    }
    
    // Function to choose save folder
    function chooseSaveFolder() {
      // Chrome doesn't provide a direct way to select folders via JavaScript
      // Instead, we'll use the downloads API to trigger a file picker
      chrome.downloads.showDefaultFolder();
      
      // Show a message to the user
      statusElement.textContent = 'Please select a folder in the opened window';
      
      // Since we can't directly access the folder selection dialog,
      // we'll provide a way for users to manually enter the folder path
      const folderPath = prompt('Enter the folder path where you want to save screenshots:');
      
      if (folderPath) {
        saveFolderInput.value = folderPath;
        statusElement.textContent = 'Save location updated';
      }
    }
  });