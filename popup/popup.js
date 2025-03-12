document.addEventListener('DOMContentLoaded', function() {
  // Get elements
  const autoDetectToggle = document.getElementById('autoDetect');
  const manualScreenshotButton = document.getElementById('manualScreenshot');
  const blockSiteButton = document.getElementById('blockSite');
  const statusElement = document.getElementById('status');
  const blockedSitesElement = document.getElementById('blockedSites');
  
  // Load saved state
  chrome.storage.sync.get(['autoDetect'], function(result) {
    if (result.autoDetect !== undefined) {
      autoDetectToggle.checked = result.autoDetect;
    }
  });
  
  // Load blocked websites
  loadBlockedWebsites();
  
  // Save toggle state when changed
  autoDetectToggle.addEventListener('change', function() {
    chrome.storage.sync.set({autoDetect: autoDetectToggle.checked});
    
    statusElement.textContent = autoDetectToggle.checked ? 
      'Auto-detection enabled' : 'Auto-detection disabled';
  });
  
  // Handle manual screenshot button click
  document.getElementById('manualScreenshot').addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs[0]) {
        console.error('No active tab found');
        return;
      }
  
      const statusElement = document.getElementById('status');
      statusElement.textContent = 'Taking screenshot...';
  
      chrome.runtime.sendMessage(
        { action: 'manualCapture' },
        function(response) {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
            statusElement.textContent = 'Error taking screenshot';
          } else if (response && response.success) {
            statusElement.textContent = 'Screenshot saved!';
            setTimeout(() => {
              statusElement.textContent = 'Ready';
            }, 2000);
          } else {
            statusElement.textContent = 'Failed to take screenshot';
          }
        }
      );
    });
  });
  
  // Handle block site button click
  blockSiteButton.addEventListener('click', function() {
    chrome.runtime.sendMessage({action: 'blockWebsite'}, function(response) {
      if (response && response.success) {
        statusElement.textContent = response.message;
        loadBlockedWebsites();
      } else {
        statusElement.textContent = response.message || 'Error blocking website';
      }
    });
  });
  
  // Handle open options button click
  document.getElementById('openOptions').addEventListener('click', function() {
    chrome.runtime.openOptionsPage();
  });
  
  // Function to load blocked websites
  function loadBlockedWebsites() {
    chrome.storage.sync.get(['blockedWebsites'], function(data) {
      const blockedWebsites = data.blockedWebsites || [];
      
      if (blockedWebsites.length === 0) {
        blockedSitesElement.innerHTML = '<div class="site-item">No websites blocked yet</div>';
        return;
      }
      
      let html = '';
      blockedWebsites.forEach(site => {
        html += `
          <div class="site-item">
            <span>${site}</span>
            <button class="remove-btn" data-site="${site}">Remove</button>
          </div>
        `;
      });
      
      blockedSitesElement.innerHTML = html;
      
      // Add event listeners to remove buttons
      document.querySelectorAll('.remove-btn').forEach(button => {
        button.addEventListener('click', function() {
          const hostname = this.getAttribute('data-site');
          chrome.runtime.sendMessage(
            {action: 'unblockWebsite', hostname: hostname}, 
            function(response) {
              if (response && response.success) {
                loadBlockedWebsites();
                statusElement.textContent = response.message;
              }
            }
          );
        });
      });
    });
  }
});