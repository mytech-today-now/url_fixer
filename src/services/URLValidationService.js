/**
 * URLValidationService - Validate URLs and check their HTTP status
 * Includes caching, retry logic, and timeout handling
 */

'use strict';

import { Logger } from '../utils/Logger.js';

export class URLValidationService {
  constructor(storageService = null) {
    this.logger = new Logger('URLValidationService');
    this.storageService = storageService;
    this.defaultTimeout = 10000; // 10 seconds
    this.maxRetries = 2;
    this.retryDelay = 1000; // 1 second
    this.concurrentLimit = 5; // Max concurrent requests
    this.activeRequests = new Set();
    this.requestQueue = [];
  }

  /**
   * Validate a single URL
   */
  async validateURL(url, options = {}) {
    const {
      timeout = this.defaultTimeout,
      useCache = true,
      maxAge = 3600000, // 1 hour
      retries = this.maxRetries
    } = options;

    try {
      this.logger.debug(`Validating URL: ${url}`);
      
      // Check cache first
      if (useCache && this.storageService) {
        const cached = await this.storageService.getCachedURLResult(url, maxAge);
        if (cached) {
          this.logger.debug(`Using cached result for ${url}`);
          return {
            url,
            status: cached.status,
            statusText: this.getStatusText(cached.status),
            responseTime: cached.responseTime,
            headers: cached.headers,
            fromCache: true,
            timestamp: cached.lastChecked
          };
        }
      }

      // Validate URL format
      if (!this.isValidURL(url)) {
        return {
          url,
          status: 0,
          statusText: 'Invalid URL format',
          responseTime: 0,
          headers: {},
          fromCache: false,
          timestamp: new Date().toISOString(),
          error: 'Invalid URL format'
        };
      }

      // Perform HTTP request with retries
      const result = await this.performRequestWithRetries(url, timeout, retries);
      
      // Cache the result
      if (this.storageService && result.status > 0) {
        await this.storageService.cacheURLResult(
          url,
          result.status,
          result.responseTime,
          result.headers
        );
      }

      return result;
      
    } catch (error) {
      this.logger.error(`URL validation failed for ${url}`, error);
      return {
        url,
        status: 0,
        statusText: error.message,
        responseTime: 0,
        headers: {},
        fromCache: false,
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  /**
   * Validate multiple URLs with concurrency control
   */
  async validateURLs(urls, options = {}) {
    const {
      concurrency = this.concurrentLimit,
      onProgress = null,
      onResult = null
    } = options;

    this.logger.info(`Validating ${urls.length} URLs with concurrency ${concurrency}`);
    
    const results = [];
    const batches = this.createBatches(urls, concurrency);
    let completed = 0;

    for (const batch of batches) {
      const batchPromises = batch.map(async (url) => {
        try {
          const result = await this.validateURL(url, options);
          completed++;
          
          if (onProgress) {
            onProgress(completed, urls.length, result);
          }
          
          if (onResult) {
            onResult(result);
          }
          
          return result;
        } catch (error) {
          completed++;
          const errorResult = {
            url,
            status: 0,
            statusText: error.message,
            responseTime: 0,
            headers: {},
            fromCache: false,
            timestamp: new Date().toISOString(),
            error: error.message
          };
          
          if (onProgress) {
            onProgress(completed, urls.length, errorResult);
          }
          
          if (onResult) {
            onResult(errorResult);
          }
          
          return errorResult;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    this.logger.info(`Completed validation of ${urls.length} URLs`);
    return results;
  }

  /**
   * Perform HTTP request with retry logic
   */
  async performRequestWithRetries(url, timeout, retries) {
    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          this.logger.debug(`Retry attempt ${attempt} for ${url}`);
          await this.delay(this.retryDelay * attempt);
        }
        
        return await this.performRequest(url, timeout);
        
      } catch (error) {
        lastError = error;
        
        // Don't retry for certain error types
        if (this.isNonRetryableError(error)) {
          break;
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Perform a single HTTP request
   */
  async performRequest(url, timeout) {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'HEAD', // Use HEAD to minimize data transfer
        signal: controller.signal,
        headers: {
          'User-Agent': 'URL-Fixer/1.0 (+https://url-fixer.app)',
          'Accept': '*/*',
          'Cache-Control': 'no-cache'
        },
        mode: 'cors',
        redirect: 'follow'
      });

      const responseTime = Date.now() - startTime;
      clearTimeout(timeoutId);

      // Extract relevant headers
      const headers = {};
      const relevantHeaders = ['content-type', 'content-length', 'last-modified', 'etag'];
      relevantHeaders.forEach(header => {
        const value = response.headers.get(header);
        if (value) {
          headers[header] = value;
        }
      });

      return {
        url,
        status: response.status,
        statusText: response.statusText,
        responseTime,
        headers,
        fromCache: false,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }

      // Handle different error types
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error or CORS policy blocked the request');
      }

      throw error;
    }
  }

  /**
   * Check if an error should not be retried
   */
  isNonRetryableError(error) {
    const nonRetryableMessages = [
      'Invalid URL format',
      'CORS policy',
      'Network error',
      'SSL certificate',
      'DNS resolution failed'
    ];

    return nonRetryableMessages.some(msg => 
      error.message.toLowerCase().includes(msg.toLowerCase())
    );
  }

  /**
   * Validate URL format
   */
  isValidURL(url) {
    try {
      const urlObj = new URL(url);
      return ['http:', 'https:'].includes(urlObj.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Get human-readable status text
   */
  getStatusText(status) {
    const statusTexts = {
      0: 'Network Error',
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      301: 'Moved Permanently',
      302: 'Found',
      304: 'Not Modified',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      408: 'Request Timeout',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout'
    };

    return statusTexts[status] || `HTTP ${status}`;
  }

  /**
   * Check if status indicates a successful response
   */
  isSuccessStatus(status) {
    return status >= 200 && status < 400;
  }

  /**
   * Check if status indicates a redirect
   */
  isRedirectStatus(status) {
    return status >= 300 && status < 400;
  }

  /**
   * Check if status indicates a client error
   */
  isClientErrorStatus(status) {
    return status >= 400 && status < 500;
  }

  /**
   * Check if status indicates a server error
   */
  isServerErrorStatus(status) {
    return status >= 500 && status < 600;
  }

  /**
   * Create batches for concurrent processing
   */
  createBatches(items, batchSize) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Delay utility for retries
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get validation statistics
   */
  getValidationStats(results) {
    const stats = {
      total: results.length,
      successful: 0,
      redirects: 0,
      clientErrors: 0,
      serverErrors: 0,
      networkErrors: 0,
      averageResponseTime: 0,
      fromCache: 0
    };

    let totalResponseTime = 0;

    results.forEach(result => {
      if (result.fromCache) {
        stats.fromCache++;
      }

      if (result.status === 0) {
        stats.networkErrors++;
      } else if (this.isSuccessStatus(result.status)) {
        stats.successful++;
      } else if (this.isRedirectStatus(result.status)) {
        stats.redirects++;
      } else if (this.isClientErrorStatus(result.status)) {
        stats.clientErrors++;
      } else if (this.isServerErrorStatus(result.status)) {
        stats.serverErrors++;
      }

      totalResponseTime += result.responseTime || 0;
    });

    stats.averageResponseTime = results.length > 0 
      ? Math.round(totalResponseTime / results.length) 
      : 0;

    return stats;
  }

  /**
   * Clear URL cache
   */
  async clearCache() {
    if (this.storageService) {
      // This would need to be implemented in StorageService
      this.logger.info('Clearing URL validation cache');
      // await this.storageService.clearURLCache();
    }
  }
}
