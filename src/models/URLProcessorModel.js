/**
 * URLProcessorModel - Orchestrates URL validation and replacement
 * Coordinates between validation service, search service, and storage
 */

'use strict';

import { Logger } from '../utils/Logger.js';

export class URLProcessorModel {
  constructor(validationService, searchService, storageService) {
    this.logger = new Logger('URLProcessorModel');
    this.validationService = validationService;
    this.searchService = searchService;
    this.storageService = storageService;
    
    // Processing state
    this.isProcessing = false;
    this.currentBatch = null;
    this.abortController = null;
    
    // Configuration
    this.config = {
      batchSize: 5,
      maxRetries: 2,
      timeout: 10000,
      searchTimeout: 15000,
      useCache: true,
      strictDomainSearch: true,
      autoFix: false
    };
    
    // Event listeners
    this.listeners = new Map();
  }

  /**
   * Process URLs for validation and replacement
   */
  async processURLs(urls, options = {}) {
    if (this.isProcessing) {
      throw new Error('URL processing is already in progress');
    }

    const {
      onProgress = null,
      onURLProcessed = null,
      onBatchComplete = null,
      signal = null
    } = options;

    try {
      this.isProcessing = true;
      this.abortController = new AbortController();
      
      // Use provided signal or create our own
      const combinedSignal = signal ? this.combineSignals([signal, this.abortController.signal]) : this.abortController.signal;
      
      this.logger.info(`Starting URL processing for ${urls.length} URLs`);
      this.emit('processingStarted', { totalUrls: urls.length });

      const results = [];
      const batches = this.createBatches(urls, this.config.batchSize);
      let processedCount = 0;

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        if (combinedSignal.aborted) {
          throw new Error('Processing was aborted');
        }

        const batch = batches[batchIndex];
        this.currentBatch = { index: batchIndex, urls: batch };
        
        this.logger.debug(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} URLs)`);
        
        const batchResults = await this.processBatch(batch, {
          signal: combinedSignal,
          onURLProcessed: (result) => {
            processedCount++;
            const progress = Math.round((processedCount / urls.length) * 100);
            
            if (onProgress) {
              onProgress(processedCount, urls.length, progress, result);
            }
            
            if (onURLProcessed) {
              onURLProcessed(result);
            }
            
            this.emit('urlProcessed', { result, progress, processedCount, totalUrls: urls.length });
          }
        });

        results.push(...batchResults);
        
        if (onBatchComplete) {
          onBatchComplete(batchIndex + 1, batches.length, batchResults);
        }
        
        this.emit('batchComplete', {
          batchIndex: batchIndex + 1,
          totalBatches: batches.length,
          batchResults,
          overallProgress: Math.round((processedCount / urls.length) * 100)
        });
      }

      this.logger.info(`URL processing completed. Processed ${results.length} URLs`);
      this.emit('processingComplete', { results, stats: this.calculateStats(results) });
      
      return results;

    } catch (error) {
      this.logger.error('URL processing failed', error);
      this.emit('processingError', error);
      throw error;
      
    } finally {
      this.isProcessing = false;
      this.currentBatch = null;
      this.abortController = null;
    }
  }

  /**
   * Process a batch of URLs
   */
  async processBatch(urls, options = {}) {
    const { signal, onURLProcessed } = options;
    
    const batchPromises = urls.map(async (url) => {
      try {
        const result = await this.processURL(url, { signal });
        
        if (onURLProcessed) {
          onURLProcessed(result);
        }
        
        return result;
        
      } catch (error) {
        const errorResult = {
          ...url,
          status: 'error',
          error: error.message,
          processedAt: new Date().toISOString()
        };
        
        if (onURLProcessed) {
          onURLProcessed(errorResult);
        }
        
        return errorResult;
      }
    });

    return Promise.all(batchPromises);
  }

  /**
   * Process a single URL
   */
  async processURL(url, options = {}) {
    const { signal } = options;
    
    try {
      this.logger.debug(`Processing URL: ${url.originalURL}`);
      
      // Step 1: Validate the URL
      const validationResult = await this.validationService.validateURL(url.originalURL, {
        timeout: this.config.timeout,
        useCache: this.config.useCache,
        signal
      });

      const processedUrl = {
        ...url,
        status: this.determineStatus(validationResult.status),
        statusCode: validationResult.status,
        responseTime: validationResult.responseTime,
        lastChecked: validationResult.timestamp,
        fromCache: validationResult.fromCache,
        processedAt: new Date().toISOString()
      };

      // Step 2: If URL is broken, try to find a replacement
      if (processedUrl.status === 'invalid' && validationResult.status === 404) {
        try {
          const replacement = await this.findReplacement(url.originalURL, { signal });
          
          if (replacement) {
            processedUrl.status = this.config.autoFix ? 'fixed' : 'replacement-found';
            processedUrl.replacementFound = true;
            processedUrl.replacementURL = replacement.replacementURL;
            processedUrl.replacementSource = replacement.source;
            processedUrl.replacementConfidence = replacement.confidence;
            processedUrl.searchQuery = replacement.searchQuery;
            
            if (this.config.autoFix) {
              processedUrl.newURL = replacement.replacementURL;
            }
            
            this.logger.info(`Replacement found for ${url.originalURL}: ${replacement.replacementURL}`);
          }
          
        } catch (searchError) {
          this.logger.warn(`Failed to find replacement for ${url.originalURL}`, searchError);
          processedUrl.searchError = searchError.message;
        }
      }

      return processedUrl;
      
    } catch (error) {
      this.logger.error(`Failed to process URL ${url.originalURL}`, error);
      
      return {
        ...url,
        status: 'error',
        error: error.message,
        processedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Find replacement URL for a broken link
   */
  async findReplacement(originalURL, options = {}) {
    const { signal } = options;
    
    try {
      const replacement = await this.searchService.findReplacementURL(originalURL, {
        timeout: this.config.searchTimeout,
        strictDomain: this.config.strictDomainSearch,
        signal
      });
      
      if (replacement) {
        // Validate the replacement URL
        const validationResult = await this.validationService.validateURL(replacement.replacementURL, {
          timeout: this.config.timeout,
          useCache: this.config.useCache,
          signal
        });
        
        if (this.validationService.isSuccessStatus(validationResult.status)) {
          return {
            ...replacement,
            validated: true,
            validationStatus: validationResult.status,
            validationTime: validationResult.responseTime
          };
        } else {
          this.logger.warn(`Replacement URL validation failed: ${replacement.replacementURL} (${validationResult.status})`);
          return null;
        }
      }
      
      return null;
      
    } catch (error) {
      this.logger.error(`Replacement search failed for ${originalURL}`, error);
      throw error;
    }
  }

  /**
   * Determine URL status based on HTTP status code
   */
  determineStatus(statusCode) {
    if (statusCode === 0) {
      return 'error';
    } else if (this.validationService.isSuccessStatus(statusCode)) {
      return 'valid';
    } else if (this.validationService.isRedirectStatus(statusCode)) {
      return 'redirect';
    } else {
      return 'invalid';
    }
  }

  /**
   * Create batches for processing
   */
  createBatches(items, batchSize) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Combine multiple abort signals
   */
  combineSignals(signals) {
    const controller = new AbortController();
    
    signals.forEach(signal => {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', () => controller.abort());
      }
    });
    
    return controller.signal;
  }

  /**
   * Calculate processing statistics
   */
  calculateStats(results) {
    const stats = {
      total: results.length,
      valid: 0,
      invalid: 0,
      redirects: 0,
      errors: 0,
      replacementFound: 0,
      fixed: 0,
      averageResponseTime: 0,
      fromCache: 0
    };

    let totalResponseTime = 0;
    let responseTimeCount = 0;

    results.forEach(result => {
      switch (result.status) {
        case 'valid':
          stats.valid++;
          break;
        case 'invalid':
          stats.invalid++;
          break;
        case 'redirect':
          stats.redirects++;
          break;
        case 'error':
          stats.errors++;
          break;
        case 'replacement-found':
          stats.replacementFound++;
          break;
        case 'fixed':
          stats.fixed++;
          break;
      }

      if (result.fromCache) {
        stats.fromCache++;
      }

      if (result.responseTime) {
        totalResponseTime += result.responseTime;
        responseTimeCount++;
      }
    });

    if (responseTimeCount > 0) {
      stats.averageResponseTime = Math.round(totalResponseTime / responseTimeCount);
    }

    return stats;
  }

  /**
   * Abort current processing
   */
  abort() {
    if (this.isProcessing && this.abortController) {
      this.logger.info('Aborting URL processing');
      this.abortController.abort();
      this.emit('processingAborted');
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Get processing status
   */
  getStatus() {
    return {
      isProcessing: this.isProcessing,
      currentBatch: this.currentBatch,
      config: this.config
    };
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
}
