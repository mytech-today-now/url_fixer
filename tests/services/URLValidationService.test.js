/**
 * Tests for URLValidationService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { URLValidationService } from '../../src/services/URLValidationService.js';

describe('URLValidationService', () => {
  let validationService;
  let mockStorageService;

  beforeEach(() => {
    mockStorageService = {
      getCachedURLResult: vi.fn().mockResolvedValue(null),
      cacheURLResult: vi.fn().mockResolvedValue(undefined)
    };
    
    validationService = new URLValidationService(mockStorageService);
    
    // Mock fetch
    global.fetch = vi.fn();
  });

  describe('initialization', () => {
    it('should create a new instance with default configuration', () => {
      expect(validationService.defaultTimeout).toBe(10000);
      expect(validationService.maxRetries).toBe(2);
      expect(validationService.concurrentLimit).toBe(5);
    });

    it('should work without storage service', () => {
      const service = new URLValidationService();
      expect(service.storageService).toBeNull();
    });
  });

  describe('URL validation', () => {
    it('should validate a successful URL', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([
          ['content-type', 'text/html'],
          ['content-length', '1234']
        ])
      };
      
      global.fetch.mockResolvedValue(mockResponse);

      const result = await validationService.validateURL('https://example.com');
      
      expect(result.url).toBe('https://example.com');
      expect(result.status).toBe(200);
      expect(result.statusText).toBe('OK');
      expect(result.fromCache).toBe(false);
      expect(result.responseTime).toBeGreaterThan(0);
    });

    it('should handle 404 errors', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Map()
      };
      
      global.fetch.mockResolvedValue(mockResponse);

      const result = await validationService.validateURL('https://example.com/notfound');
      
      expect(result.status).toBe(404);
      expect(result.statusText).toBe('Not Found');
    });

    it('should handle network errors', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      const result = await validationService.validateURL('https://example.com');
      
      expect(result.status).toBe(0);
      expect(result.error).toBe('Network error');
    });

    it('should handle timeout errors', async () => {
      global.fetch.mockImplementation(() => 
        new Promise((resolve) => {
          setTimeout(() => resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Map()
          }), 15000);
        })
      );

      const result = await validationService.validateURL('https://example.com', { timeout: 1000 });
      
      expect(result.status).toBe(0);
      expect(result.error).toContain('timeout');
    });

    it('should use cached results when available', async () => {
      const cachedResult = {
        status: 200,
        responseTime: 100,
        headers: {},
        lastChecked: new Date().toISOString()
      };
      
      mockStorageService.getCachedURLResult.mockResolvedValue(cachedResult);

      const result = await validationService.validateURL('https://example.com');
      
      expect(result.fromCache).toBe(true);
      expect(result.status).toBe(200);
      expect(mockStorageService.getCachedURLResult).toHaveBeenCalledWith('https://example.com', 3600000);
    });

    it('should validate invalid URL format', async () => {
      const result = await validationService.validateURL('not-a-url');
      
      expect(result.status).toBe(0);
      expect(result.error).toBe('Invalid URL format');
    });
  });

  describe('batch validation', () => {
    it('should validate multiple URLs', async () => {
      const urls = [
        'https://example.com',
        'https://test.org',
        'https://demo.net'
      ];

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map()
      });

      const results = await validationService.validateURLs(urls);
      
      expect(results).toHaveLength(3);
      expect(results[0].url).toBe('https://example.com');
      expect(results[1].url).toBe('https://test.org');
      expect(results[2].url).toBe('https://demo.net');
    });

    it('should handle progress callbacks', async () => {
      const urls = ['https://example.com', 'https://test.org'];
      const progressCallback = vi.fn();

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map()
      });

      await validationService.validateURLs(urls, {
        onProgress: progressCallback
      });
      
      expect(progressCallback).toHaveBeenCalledTimes(2);
    });

    it('should respect concurrency limits', async () => {
      const urls = Array.from({ length: 10 }, (_, i) => `https://example${i}.com`);
      let concurrentRequests = 0;
      let maxConcurrent = 0;

      global.fetch.mockImplementation(() => {
        concurrentRequests++;
        maxConcurrent = Math.max(maxConcurrent, concurrentRequests);
        
        return new Promise((resolve) => {
          setTimeout(() => {
            concurrentRequests--;
            resolve({
              ok: true,
              status: 200,
              statusText: 'OK',
              headers: new Map()
            });
          }, 100);
        });
      });

      await validationService.validateURLs(urls, { concurrency: 3 });
      
      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });
  });

  describe('retry logic', () => {
    it('should retry failed requests', async () => {
      let callCount = 0;
      global.fetch.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Temporary error'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map()
        });
      });

      const result = await validationService.validateURL('https://example.com');
      
      expect(callCount).toBe(3);
      expect(result.status).toBe(200);
    });

    it('should not retry non-retryable errors', async () => {
      let callCount = 0;
      global.fetch.mockImplementation(() => {
        callCount++;
        return Promise.reject(new Error('CORS policy blocked the request'));
      });

      const result = await validationService.validateURL('https://example.com');
      
      expect(callCount).toBe(1);
      expect(result.status).toBe(0);
    });
  });

  describe('status classification', () => {
    it('should classify success statuses correctly', () => {
      expect(validationService.isSuccessStatus(200)).toBe(true);
      expect(validationService.isSuccessStatus(201)).toBe(true);
      expect(validationService.isSuccessStatus(204)).toBe(true);
      expect(validationService.isSuccessStatus(404)).toBe(false);
    });

    it('should classify redirect statuses correctly', () => {
      expect(validationService.isRedirectStatus(301)).toBe(true);
      expect(validationService.isRedirectStatus(302)).toBe(true);
      expect(validationService.isRedirectStatus(200)).toBe(false);
    });

    it('should classify error statuses correctly', () => {
      expect(validationService.isClientErrorStatus(404)).toBe(true);
      expect(validationService.isServerErrorStatus(500)).toBe(true);
      expect(validationService.isClientErrorStatus(200)).toBe(false);
    });
  });

  describe('statistics', () => {
    it('should calculate validation statistics', () => {
      const results = [
        { status: 200, responseTime: 100, fromCache: false },
        { status: 404, responseTime: 150, fromCache: false },
        { status: 301, responseTime: 200, fromCache: true },
        { status: 0, responseTime: 0, fromCache: false }
      ];

      const stats = validationService.getValidationStats(results);
      
      expect(stats.total).toBe(4);
      expect(stats.successful).toBe(1);
      expect(stats.redirects).toBe(1);
      expect(stats.clientErrors).toBe(1);
      expect(stats.networkErrors).toBe(1);
      expect(stats.fromCache).toBe(1);
      expect(stats.averageResponseTime).toBe(112); // (100+150+200+0)/4 = 112.5 rounded
    });
  });

  describe('URL format validation', () => {
    it('should validate correct URLs', () => {
      expect(validationService.isValidURL('https://example.com')).toBe(true);
      expect(validationService.isValidURL('http://test.org')).toBe(true);
      expect(validationService.isValidURL('https://sub.domain.com/path?query=1')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(validationService.isValidURL('ftp://example.com')).toBe(false);
      expect(validationService.isValidURL('not-a-url')).toBe(false);
      expect(validationService.isValidURL('')).toBe(false);
      expect(validationService.isValidURL('javascript:alert(1)')).toBe(false);
    });
  });

  describe('status text mapping', () => {
    it('should provide human-readable status text', () => {
      expect(validationService.getStatusText(200)).toBe('OK');
      expect(validationService.getStatusText(404)).toBe('Not Found');
      expect(validationService.getStatusText(500)).toBe('Internal Server Error');
      expect(validationService.getStatusText(999)).toBe('HTTP 999');
    });
  });
});
