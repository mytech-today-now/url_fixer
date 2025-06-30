/**
 * AppView - Main application view
 * Handles UI interactions, file uploads, and table management
 */

'use strict';

import { Logger } from '../utils/Logger.js';

export class AppView {
  constructor() {
    this.logger = new Logger('AppView');
    this.listeners = new Map();
    this.elements = {};
    this.currentDocument = null;
    this.currentUrls = [];
    this.tableInstance = null;
  }

  /**
   * Initialize the view
   */
  async init() {
    try {
      this.logger.info('Initializing AppView');
      
      // Get DOM elements
      this.getElements();
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Initialize components
      this.initializeFileUpload();
      this.initializeTable();
      this.initializeReadmeModal();
      
      // Set initial state
      this.updateProcessingControls(false);
      
      this.logger.info('AppView initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize AppView', error);
      throw error;
    }
  }

  /**
   * Get DOM elements
   */
  getElements() {
    this.elements = {
      // Upload elements
      fileInput: document.getElementById('file-input'),
      uploadArea: document.getElementById('upload-area'),
      uploadTrigger: document.querySelector('.upload-trigger'),
      urlInput: document.getElementById('url-input'),
      scanUrlBtn: document.getElementById('scan-url-btn'),
      
      // Control elements
      processBtn: document.getElementById('process-btn'),
      downloadBtn: document.getElementById('download-btn'),
      clearBtn: document.getElementById('clear-btn'),
      
      // Table elements
      tableContainer: document.getElementById('table-container'),
      
      // Progress elements
      progressContainer: document.getElementById('progress-container'),
      progressFill: document.getElementById('progress-fill'),
      progressText: document.getElementById('progress-text'),
      
      // Modal elements
      readmeBtn: document.getElementById('readme-btn'),
      readmeModal: document.getElementById('readme-modal'),
      readmeClose: document.getElementById('readme-close'),
      readmeContent: document.getElementById('readme-content'),
      
      // Toast elements
      errorToast: document.getElementById('error-toast'),
      toastMessage: document.getElementById('toast-message'),
      toastClose: document.querySelector('.toast-close')
    };

    // Validate required elements
    const requiredElements = ['fileInput', 'uploadArea', 'processBtn', 'tableContainer'];
    requiredElements.forEach(elementName => {
      if (!this.elements[elementName]) {
        throw new Error(`Required element not found: ${elementName}`);
      }
    });
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // File upload events
    this.elements.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.emit('fileSelected', e.target.files[0]);
      }
    });

    this.elements.uploadTrigger?.addEventListener('click', () => {
      this.elements.fileInput.click();
    });

    // Drag and drop
    this.elements.uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.elements.uploadArea.classList.add('drag-over');
    });

    this.elements.uploadArea.addEventListener('dragleave', () => {
      this.elements.uploadArea.classList.remove('drag-over');
    });

    this.elements.uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      this.elements.uploadArea.classList.remove('drag-over');
      
      if (e.dataTransfer.files.length > 0) {
        this.emit('fileSelected', e.dataTransfer.files[0]);
      }
    });

    // URL scan
    this.elements.scanUrlBtn?.addEventListener('click', () => {
      const url = this.elements.urlInput.value.trim();
      if (url) {
        this.emit('urlScanRequested', url);
      }
    });

    this.elements.urlInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.elements.scanUrlBtn?.click();
      }
    });

    // Control buttons
    this.elements.processBtn.addEventListener('click', () => {
      this.emit('processRequested');
    });

    this.elements.downloadBtn?.addEventListener('click', () => {
      this.emit('downloadRequested');
    });

    this.elements.clearBtn?.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear the current document?')) {
        this.emit('clearRequested');
      }
    });

    // README modal
    this.elements.readmeBtn?.addEventListener('click', () => {
      this.showReadmeModal();
    });

    this.elements.readmeClose?.addEventListener('click', () => {
      this.hideReadmeModal();
    });

    this.elements.readmeModal?.addEventListener('click', (e) => {
      if (e.target === this.elements.readmeModal || e.target.classList.contains('modal-backdrop')) {
        this.hideReadmeModal();
      }
    });

    // Toast close
    this.elements.toastClose?.addEventListener('click', () => {
      this.hideToast();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'o':
            e.preventDefault();
            this.elements.fileInput.click();
            break;
          case 'Enter':
            if (!this.elements.processBtn.disabled) {
              e.preventDefault();
              this.emit('processRequested');
            }
            break;
        }
      }
      
      if (e.key === 'Escape') {
        this.hideReadmeModal();
        this.hideToast();
      }
    });
  }

  /**
   * Initialize file upload component
   */
  initializeFileUpload() {
    // Set up file input accept attribute
    const supportedTypes = [
      '.htm', '.html', '.asp', '.aspx',
      '.css', '.md', '.markdown',
      '.doc', '.docx', '.txt', '.rtf', '.pdf'
    ].join(',');
    
    this.elements.fileInput.setAttribute('accept', supportedTypes);
  }

  /**
   * Initialize table component
   */
  initializeTable() {
    this.tableInstance = new URLTable(this.elements.tableContainer);
    
    // Set up table event listeners
    this.tableInstance.on('urlEdited', (data) => {
      this.emit('urlEdited', data);
    });

    this.tableInstance.on('acceptReplacement', (data) => {
      this.emit('urlAcceptReplacement', data);
    });

    this.tableInstance.on('rejectReplacement', (data) => {
      this.emit('urlRejectReplacement', data);
    });
  }

  /**
   * Initialize README modal
   */
  initializeReadmeModal() {
    // Load README content when first opened
    this.readmeLoaded = false;
  }

  /**
   * Display document and URLs
   */
  displayDocument(document, urls) {
    this.currentDocument = document;
    this.currentUrls = urls;
    
    // Update table
    this.tableInstance.setData(urls);
    
    // Update UI state
    this.elements.urlInput.value = '';
    
    this.logger.info(`Displayed document with ${urls.length} URLs`);
  }

  /**
   * Update URL in table
   */
  updateURLInTable(urlId, urlData) {
    this.tableInstance.updateURL(urlId, urlData);
  }

  /**
   * Update processing controls
   */
  updateProcessingControls(hasDocument, canDownload = false) {
    this.elements.processBtn.disabled = !hasDocument;
    
    if (this.elements.downloadBtn) {
      this.elements.downloadBtn.disabled = !canDownload;
    }
    
    if (this.elements.clearBtn) {
      this.elements.clearBtn.disabled = !hasDocument;
    }
  }

  /**
   * Update processing state
   */
  updateProcessingState(state, progress) {
    const isProcessing = state === 'processing';
    
    this.elements.processBtn.disabled = isProcessing;
    this.elements.processBtn.textContent = isProcessing ? 'Processing...' : 'Process URLs';
    
    if (isProcessing) {
      this.showProgress(true);
      this.updateProgress(progress, 'Processing URLs...');
    }
  }

  /**
   * Update processing stats
   */
  updateProcessingStats(stats) {
    // This could update a stats display if we had one
    this.logger.debug('Processing stats updated', stats);
  }

  /**
   * Show/hide progress indicator
   */
  showProgress(show) {
    if (this.elements.progressContainer) {
      this.elements.progressContainer.hidden = !show;
    }
  }

  /**
   * Update progress
   */
  updateProgress(percentage, text) {
    if (this.elements.progressFill) {
      this.elements.progressFill.style.width = `${percentage}%`;
    }
    
    if (this.elements.progressText) {
      this.elements.progressText.textContent = text;
    }
  }

  /**
   * Show loading state
   */
  showLoading(show, text = 'Loading...') {
    if (show) {
      this.showProgress(true);
      this.updateProgress(0, text);
    } else {
      this.showProgress(false);
    }
  }

  /**
   * Clear document display
   */
  clearDocument() {
    this.currentDocument = null;
    this.currentUrls = [];
    
    // Clear table
    this.tableInstance.clear();
    
    // Reset form
    this.elements.fileInput.value = '';
    this.elements.urlInput.value = '';
    
    // Hide progress
    this.showProgress(false);
  }

  /**
   * Show notification
   */
  showNotification(message, type = 'info') {
    // For now, just use the toast system
    this.showToast(message, type);
  }

  /**
   * Show toast message
   */
  showToast(message, type = 'info') {
    if (!this.elements.errorToast || !this.elements.toastMessage) {
      return;
    }

    this.elements.toastMessage.textContent = message;
    this.elements.errorToast.className = `toast toast-${type}`;
    this.elements.errorToast.hidden = false;

    // Auto-hide after 5 seconds
    setTimeout(() => {
      this.hideToast();
    }, 5000);
  }

  /**
   * Hide toast message
   */
  hideToast() {
    if (this.elements.errorToast) {
      this.elements.errorToast.hidden = true;
    }
  }

  /**
   * Show README modal
   */
  async showReadmeModal() {
    if (!this.elements.readmeModal) return;

    this.elements.readmeModal.hidden = false;
    
    // Load README content if not already loaded
    if (!this.readmeLoaded) {
      try {
        const response = await fetch('/README.md');
        const markdown = await response.text();
        
        // Convert markdown to HTML (basic conversion)
        const html = this.markdownToHtml(markdown);
        this.elements.readmeContent.innerHTML = html;
        
        this.readmeLoaded = true;
      } catch (error) {
        this.elements.readmeContent.innerHTML = '<p>Failed to load documentation.</p>';
        this.logger.error('Failed to load README', error);
      }
    }
  }

  /**
   * Hide README modal
   */
  hideReadmeModal() {
    if (this.elements.readmeModal) {
      this.elements.readmeModal.hidden = true;
    }
  }

  /**
   * Basic markdown to HTML conversion
   */
  markdownToHtml(markdown) {
    return markdown
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>')
      .replace(/`([^`]+)`/gim, '<code>$1</code>')
      .replace(/\n/gim, '<br>');
  }

  /**
   * Event system
   */
  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  off(event, listener) {
    if (this.listeners.has(event)) {
      const listeners = this.listeners.get(event);
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          this.logger.error(`Error in event listener for ${event}`, error);
        }
      });
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    this.logger.info('Destroying AppView');
    
    if (this.tableInstance) {
      this.tableInstance.destroy();
    }
    
    this.listeners.clear();
  }
}

/**
 * URLTable component for displaying and editing URLs
 */
class URLTable {
  constructor(container) {
    this.container = container;
    this.data = [];
    this.listeners = new Map();
    this.table = null;
    
    this.init();
  }

  init() {
    this.createTable();
  }

  createTable() {
    this.container.innerHTML = `
      <div class="table-wrapper">
        <table class="url-table" role="table" aria-label="URL processing results">
          <thead>
            <tr role="row">
              <th role="columnheader" scope="col">Line</th>
              <th role="columnheader" scope="col">Type</th>
              <th role="columnheader" scope="col">Original URL</th>
              <th role="columnheader" scope="col">Status</th>
              <th role="columnheader" scope="col">New URL</th>
              <th role="columnheader" scope="col">Actions</th>
            </tr>
          </thead>
          <tbody class="url-table-body">
          </tbody>
        </table>
      </div>
    `;
    
    this.table = this.container.querySelector('.url-table');
    this.tbody = this.container.querySelector('.url-table-body');
  }

  setData(urls) {
    this.data = urls;
    this.render();
  }

  updateURL(urlId, urlData) {
    const index = this.data.findIndex(url => url.id === urlId);
    if (index !== -1) {
      this.data[index] = { ...this.data[index], ...urlData };
      this.renderRow(index);
    }
  }

  render() {
    if (!this.tbody) return;

    if (this.data.length === 0) {
      this.container.innerHTML = `
        <div class="table-placeholder">
          <div class="placeholder-icon">🔍</div>
          <p>Upload a document or enter a URL to start scanning for links</p>
        </div>
      `;
      return;
    }

    this.tbody.innerHTML = '';
    this.data.forEach((url, index) => {
      this.renderRow(index);
    });
  }

  renderRow(index) {
    const url = this.data[index];
    const row = document.createElement('tr');
    row.className = `url-row status-${url.status}`;
    row.setAttribute('data-url-id', url.id);
    
    row.innerHTML = `
      <td>${url.line}</td>
      <td><span class="url-type">${url.type}</span></td>
      <td>
        <a href="${url.originalURL}" target="_blank" rel="noopener" class="url-link">
          ${this.truncateUrl(url.originalURL)}
        </a>
      </td>
      <td>
        <span class="status-badge status-${url.status}">
          ${this.getStatusText(url.status, url.statusCode)}
        </span>
      </td>
      <td>
        ${this.renderNewUrlCell(url)}
      </td>
      <td>
        ${this.renderActionsCell(url)}
      </td>
    `;

    if (this.tbody.children[index]) {
      this.tbody.replaceChild(row, this.tbody.children[index]);
    } else {
      this.tbody.appendChild(row);
    }

    this.setupRowEvents(row, url);
  }

  renderNewUrlCell(url) {
    if (url.newURL) {
      return `
        <a href="${url.newURL}" target="_blank" rel="noopener" class="url-link">
          ${this.truncateUrl(url.newURL)}
        </a>
      `;
    } else if (url.replacementURL) {
      return `
        <div class="replacement-suggestion">
          <a href="${url.replacementURL}" target="_blank" rel="noopener" class="url-link suggested">
            ${this.truncateUrl(url.replacementURL)}
          </a>
          <small class="confidence">Confidence: ${Math.round((url.replacementConfidence || 0) * 100)}%</small>
          <input type="url" class="url-input-field replacement-input" placeholder="Enter replacement URL"
                 value="${url.replacementURL}" data-url-id="${url.id}">
        </div>
      `;
    } else {
      return `
        <input type="url" class="url-input-field" placeholder="Enter replacement URL"
               value="${url.newURL || ''}" data-url-id="${url.id}">
      `;
    }
  }

  renderActionsCell(url) {
    if (url.replacementURL && !url.newURL) {
      return `
        <div class="action-buttons">
          <button type="button" class="btn-accept" data-url-id="${url.id}" title="Accept suggestion">
            ✓
          </button>
          <button type="button" class="btn-reject" data-url-id="${url.id}" title="Reject suggestion">
            ✗
          </button>
        </div>
      `;
    }
    return '';
  }

  setupRowEvents(row, url) {
    // URL input events
    const urlInput = row.querySelector('.url-input-field');
    if (urlInput) {
      urlInput.addEventListener('blur', () => {
        const newValue = urlInput.value.trim();
        // For replacement inputs, compare against replacementURL, otherwise against newURL
        const currentValue = urlInput.classList.contains('replacement-input')
          ? (url.replacementURL || '')
          : (url.newURL || '');

        if (newValue !== currentValue) {
          this.emit('urlEdited', { urlId: url.id, newURL: newValue });
        }
      });

      urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          urlInput.blur();
        }
      });
    }

    // Action button events
    const acceptBtn = row.querySelector('.btn-accept');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', () => {
        this.emit('acceptReplacement', { 
          urlId: url.id, 
          replacementURL: url.replacementURL 
        });
      });
    }

    const rejectBtn = row.querySelector('.btn-reject');
    if (rejectBtn) {
      rejectBtn.addEventListener('click', () => {
        this.emit('rejectReplacement', { urlId: url.id });
      });
    }
  }

  getStatusText(status, statusCode) {
    const statusMap = {
      'pending': 'Pending',
      'valid': `Valid (${statusCode})`,
      'invalid': `Invalid (${statusCode})`,
      'redirect': `Redirect (${statusCode})`,
      'error': 'Error',
      'fixed': 'Fixed',
      'replacement-found': 'Replacement Found'
    };
    
    return statusMap[status] || status;
  }

  truncateUrl(url, maxLength = 50) {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + '...';
  }

  clear() {
    this.data = [];
    this.render();
  }

  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in table event listener for ${event}`, error);
        }
      });
    }
  }

  destroy() {
    this.listeners.clear();
  }
}
