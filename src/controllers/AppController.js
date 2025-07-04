/**
 * AppController - Main application controller
 * Coordinates between models, views, and services
 */

'use strict';

import { Logger } from '../utils/Logger.js';
import { ErrorHandler } from '../utils/ErrorHandler.js';

export class AppController {
  constructor(models, views, services, logger = null, errorHandler = null) {
    this.logger = logger || new Logger('AppController');
    this.errorHandler = errorHandler || new ErrorHandler();

    // Dependencies
    this.models = models;
    this.views = views;
    this.services = services;

    // State
    this.isInitialized = false;
  }

  /**
   * Initialize the controller
   */
  async init() {
    try {
      this.logger.info('Initializing AppController');
      
      // Set up model event listeners
      this.setupModelListeners();
      
      // Set up view event listeners
      this.setupViewListeners();
      
      // Initialize views
      await this.views.app.init();
      
      // Try to restore previous state
      await this.restoreState();
      
      this.isInitialized = true;
      this.logger.info('AppController initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize AppController', error);
      this.errorHandler.handleError(error, 'Controller initialization failed');
      throw error;
    }
  }

  /**
   * Set up model event listeners
   */
  setupModelListeners() {
    // Document model events
    this.models.document.on('documentLoaded', (data) => {
      this.views.app.displayDocument(data.document, data.urls);
      this.views.app.updateProcessingControls(true);
    });

    this.models.document.on('urlUpdated', (data) => {
      this.views.app.updateURLInTable(data.urlId, data.newUrl);
    });

    this.models.document.on('urlsUpdated', (data) => {
      this.views.app.updateProcessingStats(data.stats);
    });

    this.models.document.on('processingStateChanged', (data) => {
      this.views.app.updateProcessingState(data.newState, data.progress);
      this.views.app.updateProcessingStats(data.stats);
    });

    this.models.document.on('documentCleared', () => {
      this.views.app.clearDocument();
      this.views.app.updateProcessingControls(false);
    });

    // URL processor events
    this.models.urlProcessor.on('processingStarted', (data) => {
      this.models.document.setProcessingState('processing', 0);
      this.views.app.showProgress(true);
    });

    this.models.urlProcessor.on('urlProcessed', (data) => {
      this.models.document.updateURL(data.result.id, data.result);
      this.views.app.updateProgress(data.progress, `Processing URLs... ${data.processedCount}/${data.totalUrls}`);
    });

    this.models.urlProcessor.on('processingComplete', (data) => {
      this.models.document.setProcessingState('completed', 100);
      this.views.app.showProgress(false);
      this.views.app.updateProcessingControls(true, true); // Enable download
      this.models.document.saveProcessingHistory();

      // Populate replacement text fields for all processed URLs
      this.populateReplacementFields();

      this.views.app.showNotification('URL processing completed!', 'success');
    });

    this.models.urlProcessor.on('processingError', (error) => {
      this.models.document.setProcessingState('error');
      this.views.app.showProgress(false);
      this.errorHandler.handleError(error, 'URL processing failed');
    });

    this.models.urlProcessor.on('processingAborted', () => {
      this.models.document.setProcessingState('idle');
      this.views.app.showProgress(false);
      this.views.app.showNotification('Processing was cancelled', 'info');
    });
  }

  /**
   * Set up view event listeners
   */
  setupViewListeners() {
    // File upload events
    this.views.app.on('fileSelected', async (file) => {
      try {
        await this.handleFileUpload(file);
      } catch (error) {
        this.errorHandler.handleError(error, 'File upload failed');
      }
    });

    // URL scan events
    this.views.app.on('urlScanRequested', async (url) => {
      try {
        await this.handleURLScan(url);
      } catch (error) {
        this.errorHandler.handleError(error, 'URL scan failed');
      }
    });

    // Processing control events
    this.views.app.on('processRequested', async () => {
      try {
        await this.handleProcessURLs();
      } catch (error) {
        this.errorHandler.handleError(error, 'URL processing failed');
      }
    });

    this.views.app.on('downloadRequested', () => {
      try {
        this.handleDownload();
      } catch (error) {
        this.errorHandler.handleError(error, 'Download failed');
      }
    });

    this.views.app.on('clearRequested', () => {
      this.handleClear();
    });

    // URL table events
    this.views.app.on('urlEdited', async (data) => {
      // Update the URL with the new value
      this.models.document.updateURL(data.urlId, { newURL: data.newURL });

      // If a new URL was provided, validate it
      if (data.newURL && data.newURL.trim()) {
        await this.validateReplacementURL(data.urlId, data.newURL.trim());
      }
    });

    this.views.app.on('urlAcceptReplacement', async (data) => {
      // Update the URL status to fixed
      this.models.document.updateURL(data.urlId, {
        newURL: data.replacementURL,
        status: 'fixed'
      });

      // Validate the accepted replacement URL
      await this.validateReplacementURL(data.urlId, data.replacementURL);
    });

    this.views.app.on('urlRejectReplacement', (data) => {
      this.models.document.updateURL(data.urlId, {
        replacementFound: false,
        replacementURL: null
      });
    });

    this.views.app.on('reprocessURL', async (data) => {
      try {
        await this.handleReprocessURL(data.urlId);
      } catch (error) {
        this.errorHandler.handleError(error, 'URL re-processing failed');
      }
    });
  }

  /**
   * Handle file upload
   */
  async handleFileUpload(file) {
    this.logger.info(`Handling file upload: ${file.name}`);
    
    // Validate file
    if (!this.services.documentParser.isSupported(file)) {
      throw new Error(`Unsupported file type: ${file.type}`);
    }

    // Show loading state
    this.views.app.showLoading(true, 'Parsing document...');

    try {
      // Parse the document
      const documentData = await this.services.documentParser.parseFile(file);
      
      // Load into document model
      await this.models.document.loadDocument(documentData);
      
      this.views.app.showNotification(`Document loaded with ${documentData.urls.length} URLs`, 'success');
      
    } finally {
      this.views.app.showLoading(false);
    }
  }

  /**
   * Handle URL scan
   */
  async handleURLScan(url) {
    this.logger.info(`Handling URL scan: ${url}`);
    
    // Validate URL
    if (!this.services.documentParser.isValidURL(url)) {
      throw new Error('Invalid URL format');
    }

    // Show loading state
    this.views.app.showLoading(true, 'Scanning webpage...');

    try {
      // Parse the URL
      const documentData = await this.services.documentParser.parseURL(url);
      
      // Load into document model
      await this.models.document.loadDocument(documentData);
      
      this.views.app.showNotification(`Webpage scanned, found ${documentData.urls.length} URLs`, 'success');
      
    } finally {
      this.views.app.showLoading(false);
    }
  }

  /**
   * Handle URL processing
   */
  async handleProcessURLs() {
    const pendingUrls = this.models.document.getPendingURLs();

    if (pendingUrls.length === 0) {
      this.views.app.showNotification('No URLs to process', 'info');
      return;
    }

    this.logger.info(`Processing ${pendingUrls.length} URLs`);

    try {
      await this.models.urlProcessor.processURLs(pendingUrls);
    } catch (error) {
      if (error.message.includes('aborted')) {
        // User cancelled, already handled by event listener
        return;
      }
      throw error;
    }
  }

  /**
   * Populate replacement text fields after processing
   */
  populateReplacementFields() {
    const urls = this.models.document.urls;

    urls.forEach(url => {
      // Skip URLs that already have manual replacements (newURL)
      if (url.newURL) {
        return;
      }

      // For URLs that have been processed, trigger a table update to populate replacement fields
      if (url.status && url.status !== 'pending') {
        // Update the URL in the view to trigger re-rendering with populated fields
        this.views.app.updateURLInTable(url.id, url);
      }
    });

    this.logger.info('Replacement text fields populated after processing');
  }

  /**
   * Validate a replacement URL after it has been selected or entered
   */
  async validateReplacementURL(urlId, replacementURL) {
    try {
      // Find the original URL data
      const urlData = this.models.document.urls.find(url => url.id === urlId);
      if (!urlData) {
        this.logger.warn(`URL with ID ${urlId} not found for replacement validation`);
        return;
      }

      this.logger.info(`Starting replacement validation for URL ${urlId}: ${urlData.originalURL} -> ${replacementURL}`);

      // Update UI to show validation in progress
      this.models.document.updateURL(urlId, {
        replacementValidating: true,
        replacementValidationStatus: 'validating'
      });
      this.views.app.updateURLInTable(urlId, this.models.document.urls.find(url => url.id === urlId));

      // Perform the validation
      const validationResult = await this.models.urlProcessor.validateReplacementURL(
        urlData.originalURL,
        replacementURL,
        { signal: this.abortController?.signal }
      );

      // Update the URL with validation results
      const updateData = {
        replacementValidating: false,
        replacementValidationStatus: validationResult.overallValid ? 'valid' : 'invalid',
        replacementValidationResult: validationResult,
        lastValidated: validationResult.validatedAt
      };

      // If validation failed, update status accordingly
      if (!validationResult.overallValid) {
        updateData.status = 'replacement-invalid';

        // Provide user-friendly error message
        let errorMessage = 'Replacement URL validation failed';
        if (!validationResult.httpValidation.isValid) {
          errorMessage = `HTTP Error: ${validationResult.httpValidation.status} ${validationResult.httpValidation.statusText}`;
        } else if (validationResult.keywordValidation && !validationResult.keywordValidation.isValid) {
          errorMessage = `Content validation failed: ${validationResult.keywordValidation.reason}`;
        }
        updateData.replacementValidationError = errorMessage;
      } else {
        // If validation passed, ensure status reflects this
        if (urlData.status === 'replacement-invalid' || urlData.status === 'invalid') {
          updateData.status = 'fixed';
        }
      }

      this.models.document.updateURL(urlId, updateData);
      this.views.app.updateURLInTable(urlId, this.models.document.urls.find(url => url.id === urlId));

      this.logger.info(`Replacement validation completed for URL ${urlId}: ${validationResult.overallValid ? 'VALID' : 'INVALID'}`);

      // Show user notification for validation result
      if (!validationResult.overallValid) {
        this.errorHandler.showToast(
          `Replacement URL validation failed: ${updateData.replacementValidationError}`,
          'warning'
        );
      } else {
        this.errorHandler.showToast(
          'Replacement URL validated successfully',
          'success'
        );
      }

    } catch (error) {
      this.logger.error(`Failed to validate replacement URL for ${urlId}`, error);

      // Update UI to show validation error
      this.models.document.updateURL(urlId, {
        replacementValidating: false,
        replacementValidationStatus: 'error',
        replacementValidationError: error.message
      });
      this.views.app.updateURLInTable(urlId, this.models.document.urls.find(url => url.id === urlId));

      this.errorHandler.handleError(error, 'Replacement URL validation failed');
    }
  }

  /**
   * Handle document download
   */
  handleDownload() {
    try {
      const fixedDocument = this.models.document.generateFixedDocument();
      
      // Create download blob
      const blob = new Blob([fixedDocument.content], {
        type: this.getContentType(fixedDocument.fileType)
      });
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = this.generateDownloadFilename(fixedDocument.fileName);
      
      // Trigger download
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up
      URL.revokeObjectURL(url);
      
      this.views.app.showNotification('Document downloaded successfully', 'success');
      this.logger.info('Document downloaded');
      
    } catch (error) {
      this.logger.error('Download failed', error);
      throw error;
    }
  }

  /**
   * Handle clear action
   */
  handleClear() {
    if (this.models.urlProcessor.getStatus().isProcessing) {
      this.models.urlProcessor.abort();
    }
    
    this.models.document.clear();
    this.views.app.showNotification('Document cleared', 'info');
  }

  /**
   * Restore previous state
   */
  async restoreState() {
    try {
      const restored = await this.models.document.restoreState();
      if (restored) {
        this.logger.info('Previous state restored');
        this.views.app.showNotification('Previous session restored', 'info');
      }
    } catch (error) {
      this.logger.warn('Failed to restore state', error);
    }
  }

  /**
   * Get content type for download
   */
  getContentType(fileType) {
    const contentTypes = {
      'html': 'text/html',
      'css': 'text/css',
      'markdown': 'text/markdown',
      'text': 'text/plain',
      'rtf': 'application/rtf',
      'pdf': 'application/pdf'
    };
    
    return contentTypes[fileType] || 'text/plain';
  }

  /**
   * Generate download filename
   */
  generateDownloadFilename(originalName) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const nameWithoutExt = originalName.replace(/\.[^/.]+$/, '');
    const extension = originalName.split('.').pop();
    
    return `${nameWithoutExt}_fixed_${timestamp}.${extension}`;
  }

  /**
   * Handle URL re-processing to get next alternative
   */
  async handleReprocessURL(urlId) {
    this.logger.info(`Re-processing URL: ${urlId}`);

    const url = this.models.document.getURL(urlId);
    if (!url) {
      throw new Error(`URL not found: ${urlId}`);
    }

    // Get the next alternative URL from the search service
    const nextAlternative = this.services.search.getNextAlternativeURL(url);

    if (!nextAlternative) {
      this.views.app.showNotification('No more alternatives available', 'info');
      return;
    }

    // Update the URL with the next alternative
    this.models.document.updateURL(urlId, {
      replacementURL: nextAlternative.replacementURL,
      replacementConfidence: nextAlternative.confidence,
      replacementSource: nextAlternative.source,
      currentAlternativeIndex: nextAlternative.currentAlternativeIndex,
      alternatives: nextAlternative.alternatives,
      totalAlternatives: nextAlternative.totalAlternatives,
      // Reset validation status for the new alternative
      replacementValidationStatus: null,
      replacementValidating: false,
      replacementValidationError: null
    });

    this.views.app.showNotification(
      `Switched to alternative ${nextAlternative.currentAlternativeIndex + 1}/${nextAlternative.alternatives.length}`,
      'success'
    );

    this.logger.info(`Updated URL ${urlId} with alternative: ${nextAlternative.replacementURL}`);

    // Automatically validate the new alternative URL
    await this.validateReplacementURL(urlId, nextAlternative.replacementURL);
  }

  /**
   * Get application state
   */
  getState() {
    return {
      isInitialized: this.isInitialized,
      document: this.models.document.getState(),
      processor: this.models.urlProcessor.getStatus()
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.logger.info('Destroying AppController');
    
    // Abort any ongoing processing
    if (this.models.urlProcessor.getStatus().isProcessing) {
      this.models.urlProcessor.abort();
    }
    
    // Clear document
    this.models.document.clear();
    
    // Clean up views
    if (this.views.app.destroy) {
      this.views.app.destroy();
    }
    
    this.isInitialized = false;
  }
}
