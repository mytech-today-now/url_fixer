/**
 * Integration Tests for 404/403 URL Replacement
 * Tests the complete flow from URL validation to replacement
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { URLProcessorModel } from '../../src/models/URLProcessorModel.js';
import { SearchService } from '../../src/services/SearchService.js';
import { URLValidationService } from '../../src/services/URLValidationService.js';
import { StorageService } from '../../src/services/StorageService.js';
import { Logger } from '../../src/utils/Logger.js';

describe('URL Replacement Integration Tests', () => {
  let urlProcessor;
  let searchService;
  let validationService;
  let storageService;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    // Create service instances
    searchService = new SearchService(mockLogger);
    validationService = new URLValidationService(mockLogger);
    storageService = new StorageService(mockLogger);
    
    // Create URL processor with services
    urlProcessor = new URLProcessorModel(validationService, searchService, storageService);

    // Mock fetch globally
    global.fetch = vi.fn();
    global.DOMParser = vi.fn(() => ({
      parseFromString: vi.fn(() => ({
        querySelector: vi.fn(),
        querySelectorAll: vi.fn(() => [])
      }))
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('404 Error Replacement Flow', () => {
    it('should successfully replace a 404 URL with enhanced search', async () => {
      const testURL = {
        id: 'test-1',
        originalURL: 'https://example.com/old-path/strategy-document.html',
        fileName: 'strategy-document.html',
        status: 'pending'
      };

      // Mock validation service to return 404
      validationService.validateURL = vi.fn().mockResolvedValue({
        url: testURL.originalURL,
        status: 404,
        statusText: 'Not Found',
        responseTime: 1000,
        headers: {},
        fromCache: false,
        timestamp: new Date().toISOString()
      });

      // Mock search service to find replacement
      searchService.findReplacementURL = vi.fn().mockResolvedValue({
        originalURL: testURL.originalURL,
        replacementURL: 'https://example.com/new-path/strategy-document.html',
        confidence: 0.85,
        source: 'enhanced-serp',
        searchQuery: 'site:example.com strategy document',
        title: 'Strategy Document - Example',
        snippet: 'Strategic planning document',
        validated: true,
        validationScore: 0.9,
        timestamp: new Date().toISOString()
      });

      // Mock validation of replacement URL
      validationService.validateURL = vi.fn()
        .mockResolvedValueOnce({
          // First call - original URL (404)
          url: testURL.originalURL,
          status: 404,
          statusText: 'Not Found',
          responseTime: 1000,
          headers: {},
          fromCache: false,
          timestamp: new Date().toISOString()
        })
        .mockResolvedValueOnce({
          // Second call - replacement URL (200)
          url: 'https://example.com/new-path/strategy-document.html',
          status: 200,
          statusText: 'OK',
          responseTime: 500,
          headers: { 'content-type': 'text/html' },
          fromCache: false,
          timestamp: new Date().toISOString()
        });

      const result = await urlProcessor.processURL(testURL);

      expect(result.status).toBe('replaced');
      expect(result.replacementURL).toBe('https://example.com/new-path/strategy-document.html');
      expect(result.replacementSource).toBe('enhanced-serp');
      expect(result.replacementConfidence).toBe(0.85);
      expect(result.validated).toBe(true);
      expect(searchService.findReplacementURL).toHaveBeenCalledWith(
        testURL.originalURL,
        expect.objectContaining({
          statusCode: 404
        })
      );
    });

    it('should handle case where no replacement is found', async () => {
      const testURL = {
        id: 'test-2',
        originalURL: 'https://example.com/very-specific-document.html',
        fileName: 'very-specific-document.html',
        status: 'pending'
      };

      // Mock validation service to return 404
      validationService.validateURL = vi.fn().mockResolvedValue({
        url: testURL.originalURL,
        status: 404,
        statusText: 'Not Found',
        responseTime: 1000,
        headers: {},
        fromCache: false,
        timestamp: new Date().toISOString()
      });

      // Mock search service to return no replacement
      searchService.findReplacementURL = vi.fn().mockResolvedValue(null);

      const result = await urlProcessor.processURL(testURL);

      expect(result.status).toBe('invalid');
      expect(result.httpStatus).toBe(404);
      expect(result.replacementURL).toBeUndefined();
      expect(result.searchAttempted).toBe(true);
    });
  });

  describe('403 Error Replacement Flow', () => {
    it('should successfully replace a 403 URL', async () => {
      const testURL = {
        id: 'test-3',
        originalURL: 'https://example.com/restricted/document.pdf',
        fileName: 'document.pdf',
        status: 'pending'
      };

      // Mock validation service to return 403
      validationService.validateURL = vi.fn().mockResolvedValue({
        url: testURL.originalURL,
        status: 403,
        statusText: 'Forbidden',
        responseTime: 800,
        headers: {},
        fromCache: false,
        timestamp: new Date().toISOString()
      });

      // Mock search service to find replacement
      searchService.findReplacementURL = vi.fn().mockResolvedValue({
        originalURL: testURL.originalURL,
        replacementURL: 'https://example.com/public/document.pdf',
        confidence: 0.75,
        source: 'enhanced-serp',
        validated: true,
        validationScore: 0.8,
        timestamp: new Date().toISOString()
      });

      // Mock validation of replacement URL
      validationService.validateURL = vi.fn()
        .mockResolvedValueOnce({
          // First call - original URL (403)
          url: testURL.originalURL,
          status: 403,
          statusText: 'Forbidden',
          responseTime: 800,
          headers: {},
          fromCache: false,
          timestamp: new Date().toISOString()
        })
        .mockResolvedValueOnce({
          // Second call - replacement URL (200)
          url: 'https://example.com/public/document.pdf',
          status: 200,
          statusText: 'OK',
          responseTime: 600,
          headers: { 'content-type': 'application/pdf' },
          fromCache: false,
          timestamp: new Date().toISOString()
        });

      const result = await urlProcessor.processURL(testURL);

      expect(result.status).toBe('replaced');
      expect(result.replacementURL).toBe('https://example.com/public/document.pdf');
      expect(result.httpStatus).toBe(403); // Original status
      expect(result.replacementValidated).toBe(true);
    });
  });

  describe('Batch Processing with Replacements', () => {
    it('should process multiple URLs with mixed results', async () => {
      const testURLs = [
        {
          id: 'batch-1',
          originalURL: 'https://example.com/valid-page.html',
          fileName: 'valid-page.html',
          status: 'pending'
        },
        {
          id: 'batch-2',
          originalURL: 'https://example.com/broken-page.html',
          fileName: 'broken-page.html',
          status: 'pending'
        },
        {
          id: 'batch-3',
          originalURL: 'https://example.com/another-broken.html',
          fileName: 'another-broken.html',
          status: 'pending'
        }
      ];

      // Mock validation responses
      validationService.validateURL = vi.fn()
        .mockResolvedValueOnce({
          // First URL - valid (200)
          url: testURLs[0].originalURL,
          status: 200,
          statusText: 'OK',
          responseTime: 500,
          headers: { 'content-type': 'text/html' },
          fromCache: false,
          timestamp: new Date().toISOString()
        })
        .mockResolvedValueOnce({
          // Second URL - broken (404)
          url: testURLs[1].originalURL,
          status: 404,
          statusText: 'Not Found',
          responseTime: 1000,
          headers: {},
          fromCache: false,
          timestamp: new Date().toISOString()
        })
        .mockResolvedValueOnce({
          // Third URL - broken (404)
          url: testURLs[2].originalURL,
          status: 404,
          statusText: 'Not Found',
          responseTime: 1200,
          headers: {},
          fromCache: false,
          timestamp: new Date().toISOString()
        })
        .mockResolvedValueOnce({
          // Replacement for second URL
          url: 'https://example.com/fixed-page.html',
          status: 200,
          statusText: 'OK',
          responseTime: 600,
          headers: { 'content-type': 'text/html' },
          fromCache: false,
          timestamp: new Date().toISOString()
        });

      // Mock search service
      searchService.findReplacementURL = vi.fn()
        .mockResolvedValueOnce({
          // Replacement found for second URL
          originalURL: testURLs[1].originalURL,
          replacementURL: 'https://example.com/fixed-page.html',
          confidence: 0.8,
          source: 'enhanced-serp',
          validated: true,
          timestamp: new Date().toISOString()
        })
        .mockResolvedValueOnce(null); // No replacement for third URL

      const results = await urlProcessor.processURLs(testURLs);

      expect(results).toHaveLength(3);
      
      // First URL should be valid
      expect(results[0].status).toBe('valid');
      expect(results[0].httpStatus).toBe(200);
      
      // Second URL should be replaced
      expect(results[1].status).toBe('replaced');
      expect(results[1].replacementURL).toBe('https://example.com/fixed-page.html');
      
      // Third URL should remain invalid
      expect(results[2].status).toBe('invalid');
      expect(results[2].httpStatus).toBe(404);
    });
  });

  describe('Error Handling', () => {
    it('should handle search service errors gracefully', async () => {
      const testURL = {
        id: 'error-test',
        originalURL: 'https://example.com/broken-page.html',
        fileName: 'broken-page.html',
        status: 'pending'
      };

      // Mock validation service to return 404
      validationService.validateURL = vi.fn().mockResolvedValue({
        url: testURL.originalURL,
        status: 404,
        statusText: 'Not Found',
        responseTime: 1000,
        headers: {},
        fromCache: false,
        timestamp: new Date().toISOString()
      });

      // Mock search service to throw error
      searchService.findReplacementURL = vi.fn().mockRejectedValue(new Error('Search service unavailable'));

      const result = await urlProcessor.processURL(testURL);

      expect(result.status).toBe('invalid');
      expect(result.httpStatus).toBe(404);
      expect(result.searchError).toBe('Search service unavailable');
    });

    it('should handle validation service errors', async () => {
      const testURL = {
        id: 'validation-error-test',
        originalURL: 'https://example.com/test-page.html',
        fileName: 'test-page.html',
        status: 'pending'
      };

      // Mock validation service to throw error
      validationService.validateURL = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await urlProcessor.processURL(testURL);

      expect(result.status).toBe('error');
      expect(result.error).toBe('Network error');
    });
  });
});
