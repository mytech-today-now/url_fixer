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
      autoFix: false,

      // Enhanced search configuration
      enhancedSearch: {
        enabled: true,
        maxSerpResults: 5,
        contentScrapeTimeout: 10000,
        minKeywordMatchRatio: 0.5,
        maxRetries: 2,
        fallbackToOriginalSearch: true,
        enableFor404: true,
        enableFor403: true
      }
    };
    
    // Event listeners
    this.listeners = new Map();

    // Initialize search service with enhanced configuration
    this.updateSearchServiceConfig();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
      enhancedSearch: {
        ...this.config.enhancedSearch,
        ...(newConfig.enhancedSearch || {})
      }
    };

    this.updateSearchServiceConfig();
    this.logger.info('Configuration updated:', this.config);
  }

  /**
   * Update search service configuration
   */
  updateSearchServiceConfig() {
    if (this.searchService && typeof this.searchService.updateEnhancedSearchConfig === 'function') {
      this.searchService.updateEnhancedSearchConfig(this.config.enhancedSearch);
    }
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
        httpStatus: validationResult.status, // Add httpStatus for test compatibility
        responseTime: validationResult.responseTime,
        lastChecked: validationResult.timestamp,
        fromCache: validationResult.fromCache,
        processedAt: new Date().toISOString(),
        searchAttempted: false // Initialize search tracking
      };

      // Step 2: If URL is broken (404 or 403), try to find a replacement
      const shouldSearchForReplacement = processedUrl.status === 'invalid' &&
        ((validationResult.status === 404 && this.config.enhancedSearch.enableFor404) ||
         (validationResult.status === 403 && this.config.enhancedSearch.enableFor403));

      if (shouldSearchForReplacement) {
        processedUrl.searchAttempted = true;

        try {
          this.logger.info(`Attempting to find replacement for ${validationResult.status} error: ${url.originalURL}`);
          const replacement = await this.findReplacement(url.originalURL, {
            signal,
            statusCode: validationResult.status
          });

          if (replacement) {
            processedUrl.status = this.config.autoFix ? 'fixed' : 'replacement-found';
            processedUrl.replacementFound = true;
            processedUrl.replacementURL = replacement.replacementURL;
            processedUrl.replacementSource = replacement.source;
            processedUrl.replacementConfidence = replacement.confidence;
            processedUrl.searchQuery = replacement.searchQuery;
            processedUrl.originalStatusCode = validationResult.status;
            processedUrl.validated = replacement.validated;
            processedUrl.replacementValidated = replacement.validated;

            // Transfer alternatives for cycling functionality
            if (replacement.alternatives && replacement.alternatives.length > 0) {
              processedUrl.alternatives = replacement.alternatives;
              processedUrl.totalAlternatives = replacement.totalAlternatives;
              processedUrl.currentAlternativeIndex = replacement.currentAlternativeIndex || 0;
            }

            if (this.config.autoFix) {
              processedUrl.newURL = replacement.replacementURL;
            }

            this.logger.info(`Replacement found for ${validationResult.status} error ${url.originalURL}: ${replacement.replacementURL}${replacement.alternatives ? ` (${replacement.alternatives.length} alternatives available)` : ''}`);
          } else {
            this.logger.warn(`No replacement found for ${validationResult.status} error: ${url.originalURL}`);
          }

        } catch (searchError) {
          this.logger.warn(`Failed to find replacement for ${validationResult.status} error ${url.originalURL}`, searchError);
          processedUrl.searchError = searchError.message;
        }
      }

      return processedUrl;
      
    } catch (error) {
      this.logger.error(`Failed to process URL ${url.originalURL}`, error);

      return {
        ...url,
        status: 'error',
        statusCode: 0,
        httpStatus: 0,
        error: error.message,
        processedAt: new Date().toISOString(),
        searchAttempted: false
      };
    }
  }

  /**
   * Find replacement URL for a broken link
   */
  async findReplacement(originalURL, options = {}) {
    const { signal, statusCode } = options;

    try {
      const replacement = await this.searchService.findReplacementURL(originalURL, {
        timeout: this.config.searchTimeout,
        strictDomain: this.config.strictDomainSearch,
        statusCode,
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
          const validatedReplacement = {
            ...replacement,
            validated: true,
            validationStatus: validationResult.status,
            validationTime: validationResult.responseTime
          };

          // Also validate alternatives if they exist (but don't block on failures)
          if (replacement.alternatives && replacement.alternatives.length > 0) {
            this.logger.debug(`Validating ${replacement.alternatives.length} alternative URLs in background`);

            // Validate alternatives in parallel without blocking the main result
            Promise.all(
              replacement.alternatives.map(async (alt, index) => {
                try {
                  const altValidationResult = await this.validationService.validateURL(alt.replacementURL, {
                    timeout: this.config.timeout,
                    useCache: this.config.useCache,
                    signal
                  });

                  return {
                    ...alt,
                    validated: this.validationService.isSuccessStatus(altValidationResult.status),
                    validationStatus: altValidationResult.status,
                    validationTime: altValidationResult.responseTime
                  };
                } catch (error) {
                  this.logger.warn(`Failed to validate alternative ${index + 1}: ${alt.replacementURL}`, error);
                  return {
                    ...alt,
                    validated: false,
                    validationError: error.message
                  };
                }
              })
            ).then(validatedAlternatives => {
              // Update the alternatives with validation results
              validatedReplacement.alternatives = validatedAlternatives;
              this.logger.debug(`Completed validation of ${validatedAlternatives.length} alternatives`);
            }).catch(error => {
              this.logger.warn('Failed to validate some alternatives', error);
            });
          }

          return validatedReplacement;
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
   * Validate a replacement URL after it has been selected
   * This includes HTTP validation and keyword scraping validation
   */
  async validateReplacementURL(originalURL, replacementURL, options = {}) {
    const { signal } = options;

    try {
      this.logger.info(`Validating replacement URL: ${replacementURL} for original: ${originalURL}`);

      // Step 1: HTTP validation
      const validationResult = await this.validationService.validateURL(replacementURL, {
        timeout: this.config.timeout,
        useCache: false, // Don't use cache for replacement validation to ensure fresh results
        signal
      });

      const result = {
        originalURL,
        replacementURL,
        httpValidation: {
          status: validationResult.status,
          statusText: validationResult.statusText,
          responseTime: validationResult.responseTime,
          headers: validationResult.headers,
          timestamp: validationResult.timestamp,
          isValid: this.validationService.isSuccessStatus(validationResult.status)
        },
        keywordValidation: null,
        overallValid: false,
        validatedAt: new Date().toISOString()
      };

      // Step 2: If HTTP validation passes, perform keyword scraping validation
      if (result.httpValidation.isValid) {
        try {
          this.logger.debug(`HTTP validation passed for ${replacementURL}, performing keyword validation`);

          // Use the search service to validate keywords/content relevance
          const originalUrlInfo = this.searchService.parseURL(originalURL);
          const searchTerms = this.extractSearchTermsFromURL(originalURL);

          const keywordValidation = await this.searchService.validateReplacementURL(
            replacementURL,
            originalUrlInfo,
            searchTerms
          );

          result.keywordValidation = {
            isValid: keywordValidation.valid,
            reason: keywordValidation.reason,
            confidence: keywordValidation.score || 0,
            domainRelevance: keywordValidation.domainRelevance,
            contentRelevance: keywordValidation.contentRelevance,
            accessibilityResult: keywordValidation.accessibilityResult
          };

          // Overall validation passes if both HTTP and keyword validation pass
          result.overallValid = result.httpValidation.isValid && result.keywordValidation.isValid;

          this.logger.info(`Replacement validation complete for ${replacementURL}: HTTP=${result.httpValidation.isValid}, Keywords=${result.keywordValidation.isValid}, Overall=${result.overallValid}`);

        } catch (keywordError) {
          this.logger.warn(`Keyword validation failed for ${replacementURL}`, keywordError);
          result.keywordValidation = {
            isValid: false,
            reason: `Keyword validation error: ${keywordError.message}`,
            confidence: 0
          };
          // If keyword validation fails, we still consider it valid if HTTP validation passed
          result.overallValid = result.httpValidation.isValid;
        }
      } else {
        this.logger.warn(`HTTP validation failed for replacement URL ${replacementURL}: ${validationResult.status} ${validationResult.statusText}`);
        result.overallValid = false;
      }

      return result;

    } catch (error) {
      this.logger.error(`Failed to validate replacement URL ${replacementURL}`, error);
      return {
        originalURL,
        replacementURL,
        httpValidation: {
          status: 0,
          statusText: error.message,
          responseTime: 0,
          headers: {},
          timestamp: new Date().toISOString(),
          isValid: false
        },
        keywordValidation: {
          isValid: false,
          reason: `Validation error: ${error.message}`,
          confidence: 0
        },
        overallValid: false,
        validatedAt: new Date().toISOString(),
        error: error.message
      };
    }
  }

  /**
   * Extract search terms from a URL for keyword validation
   */
  extractSearchTermsFromURL(url) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
      const searchTerms = [];

      // Extract terms from path segments
      pathParts.forEach(part => {
        // Split on common separators and extract meaningful terms
        const terms = part.split(/[-_.]/).filter(term =>
          term.length > 2 &&
          !/^\d+$/.test(term) && // Exclude pure numbers
          !/^(html?|php|asp|jsp|cfm)$/i.test(term) // Exclude file extensions
        );
        searchTerms.push(...terms);
      });

      // Extract terms from query parameters
      urlObj.searchParams.forEach((value, key) => {
        if (key.length > 2 && value.length > 2) {
          searchTerms.push(key, value);
        }
      });

      // Extract terms from domain (excluding TLD)
      const domainParts = urlObj.hostname.split('.').slice(0, -1);
      searchTerms.push(...domainParts.filter(part => part.length > 2));

      return [...new Set(searchTerms)]; // Remove duplicates
    } catch (error) {
      this.logger.warn(`Failed to extract search terms from URL ${url}`, error);
      return [];
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
        case 'replaced':
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
      stats.averageResponseTime = Math.floor(totalResponseTime / responseTimeCount);
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
   * Get current configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return {
      isProcessing: this.isProcessing,
      currentBatch: this.currentBatch,
      config: { ...this.config },
      listeners: this.listeners.size,
      searchServiceStats: this.searchService ? this.searchService.getSearchStats() : null
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
