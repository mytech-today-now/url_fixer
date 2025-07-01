import { describe, it, expect, beforeEach, vi } from 'vitest';
import { URLProcessorModel } from '../../src/models/URLProcessorModel.js';
import { Logger } from '../../src/utils/Logger.js';

describe('URLProcessorModel - Replacement Validation', () => {
  let urlProcessor;
  let mockValidationService;
  let mockSearchService;
  let mockStorageService;
  let logger;

  beforeEach(() => {
    logger = new Logger('test');
    
    mockValidationService = {
      validateURL: vi.fn(),
      isSuccessStatus: vi.fn()
    };

    mockSearchService = {
      validateReplacementURL: vi.fn(),
      parseURL: vi.fn()
    };

    mockStorageService = {
      getCachedURLResult: vi.fn(),
      cacheURLResult: vi.fn()
    };

    urlProcessor = new URLProcessorModel(
      mockValidationService,
      mockSearchService,
      mockStorageService,
      logger
    );
  });

  describe('validateReplacementURL', () => {
    it('should perform complete validation with HTTP and keyword checks', async () => {
      const originalURL = 'https://example.com/old-page.html';
      const replacementURL = 'https://example.com/new-page.html';

      // Mock HTTP validation success
      mockValidationService.validateURL.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        responseTime: 500,
        headers: { 'content-type': 'text/html' },
        timestamp: new Date().toISOString()
      });

      mockValidationService.isSuccessStatus.mockReturnValue(true);

      // Mock URL parsing
      mockSearchService.parseURL.mockReturnValue({
        domain: 'example.com',
        pathname: '/old-page.html',
        fileName: 'old-page.html'
      });

      // Mock keyword validation success
      mockSearchService.validateReplacementURL.mockResolvedValue({
        valid: true,
        score: 0.8,
        domainRelevance: 0.9,
        contentRelevance: { score: 0.7 },
        accessibilityResult: { score: 0.8 }
      });

      const result = await urlProcessor.validateReplacementURL(originalURL, replacementURL);

      // Verify HTTP validation was called correctly
      expect(mockValidationService.validateURL).toHaveBeenCalledWith(
        replacementURL,
        expect.objectContaining({
          useCache: false
        })
      );

      // Verify keyword validation was called
      expect(mockSearchService.validateReplacementURL).toHaveBeenCalledWith(
        replacementURL,
        expect.objectContaining({ domain: 'example.com' }),
        expect.any(Array)
      );

      // Verify result structure
      expect(result).toEqual({
        originalURL,
        replacementURL,
        httpValidation: {
          status: 200,
          statusText: 'OK',
          responseTime: 500,
          headers: { 'content-type': 'text/html' },
          timestamp: expect.any(String),
          isValid: true
        },
        keywordValidation: {
          isValid: true,
          reason: undefined,
          confidence: 0.8,
          domainRelevance: 0.9,
          contentRelevance: { score: 0.7 },
          accessibilityResult: { score: 0.8 }
        },
        overallValid: true,
        validatedAt: expect.any(String)
      });
    });

    it('should fail validation when HTTP check fails', async () => {
      const originalURL = 'https://example.com/old-page.html';
      const replacementURL = 'https://example.com/broken-page.html';

      // Mock HTTP validation failure
      mockValidationService.validateURL.mockResolvedValue({
        status: 404,
        statusText: 'Not Found',
        responseTime: 1000,
        headers: {},
        timestamp: new Date().toISOString()
      });

      mockValidationService.isSuccessStatus.mockReturnValue(false);

      const result = await urlProcessor.validateReplacementURL(originalURL, replacementURL);

      // Verify keyword validation was not called
      expect(mockSearchService.validateReplacementURL).not.toHaveBeenCalled();

      // Verify result
      expect(result.overallValid).toBe(false);
      expect(result.httpValidation.isValid).toBe(false);
      expect(result.httpValidation.status).toBe(404);
      expect(result.keywordValidation).toBeNull();
    });

    it('should handle keyword validation failure gracefully', async () => {
      const originalURL = 'https://example.com/old-page.html';
      const replacementURL = 'https://different-site.com/page.html';

      // Mock HTTP validation success
      mockValidationService.validateURL.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        responseTime: 500,
        headers: { 'content-type': 'text/html' },
        timestamp: new Date().toISOString()
      });

      mockValidationService.isSuccessStatus.mockReturnValue(true);

      // Mock URL parsing
      mockSearchService.parseURL.mockReturnValue({
        domain: 'example.com',
        pathname: '/old-page.html',
        fileName: 'old-page.html'
      });

      // Mock keyword validation failure
      mockSearchService.validateReplacementURL.mockResolvedValue({
        valid: false,
        reason: 'Domain not relevant enough',
        score: 0.2,
        domainRelevance: 0.1
      });

      const result = await urlProcessor.validateReplacementURL(originalURL, replacementURL);

      // Verify result - should still be valid overall since HTTP passed
      expect(result.overallValid).toBe(false);
      expect(result.httpValidation.isValid).toBe(true);
      expect(result.keywordValidation.isValid).toBe(false);
      expect(result.keywordValidation.reason).toBe('Domain not relevant enough');
    });

    it('should handle keyword validation errors', async () => {
      const originalURL = 'https://example.com/old-page.html';
      const replacementURL = 'https://example.com/new-page.html';

      // Mock HTTP validation success
      mockValidationService.validateURL.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        responseTime: 500,
        headers: { 'content-type': 'text/html' },
        timestamp: new Date().toISOString()
      });

      mockValidationService.isSuccessStatus.mockReturnValue(true);

      // Mock URL parsing
      mockSearchService.parseURL.mockReturnValue({
        domain: 'example.com',
        pathname: '/old-page.html',
        fileName: 'old-page.html'
      });

      // Mock keyword validation error
      mockSearchService.validateReplacementURL.mockRejectedValue(new Error('Network error'));

      const result = await urlProcessor.validateReplacementURL(originalURL, replacementURL);

      // Verify result - should be valid overall since HTTP passed and keyword error is handled
      expect(result.overallValid).toBe(true);
      expect(result.httpValidation.isValid).toBe(true);
      expect(result.keywordValidation.isValid).toBe(false);
      expect(result.keywordValidation.reason).toContain('Keyword validation error: Network error');
    });

    it('should handle complete validation failure', async () => {
      const originalURL = 'https://example.com/old-page.html';
      const replacementURL = 'invalid-url';

      // Mock validation service error
      mockValidationService.validateURL.mockRejectedValue(new Error('Invalid URL'));

      const result = await urlProcessor.validateReplacementURL(originalURL, replacementURL);

      // Verify error result
      expect(result.overallValid).toBe(false);
      expect(result.httpValidation.isValid).toBe(false);
      expect(result.httpValidation.statusText).toBe('Invalid URL');
      expect(result.keywordValidation.isValid).toBe(false);
      expect(result.error).toBe('Invalid URL');
    });
  });

  describe('extractSearchTermsFromURL', () => {
    it('should extract meaningful terms from URL components', () => {
      const url = 'https://example.com/blog/web-development/javascript-tutorial.html?category=frontend&level=beginner';
      
      const terms = urlProcessor.extractSearchTermsFromURL(url);
      
      expect(terms).toContain('blog');
      expect(terms).toContain('web');
      expect(terms).toContain('development');
      expect(terms).toContain('javascript');
      expect(terms).toContain('tutorial');
      expect(terms).toContain('category');
      expect(terms).toContain('frontend');
      expect(terms).toContain('level');
      expect(terms).toContain('beginner');
      expect(terms).toContain('example');
      
      // Should not contain file extensions or numbers
      expect(terms).not.toContain('html');
      expect(terms).not.toContain('com');
    });

    it('should handle URLs with minimal content', () => {
      const url = 'https://site.com/';
      
      const terms = urlProcessor.extractSearchTermsFromURL(url);
      
      expect(terms).toContain('site');
      expect(terms.length).toBeGreaterThan(0);
    });

    it('should handle malformed URLs gracefully', () => {
      const url = 'not-a-valid-url';
      
      const terms = urlProcessor.extractSearchTermsFromURL(url);
      
      expect(Array.isArray(terms)).toBe(true);
      expect(terms.length).toBe(0);
    });
  });
});
