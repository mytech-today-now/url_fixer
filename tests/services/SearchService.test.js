/**
 * Tests for SearchService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SearchService } from '../../src/services/SearchService.js';

describe('SearchService', () => {
  let searchService;

  beforeEach(() => {
    searchService = new SearchService();
    global.fetch = vi.fn();
  });

  describe('initialization', () => {
    it('should create a new instance with default configuration', () => {
      expect(searchService.searchEndpoint).toBe('https://api.duckduckgo.com/');
      expect(searchService.maxResults).toBe(5);
      expect(searchService.searchTimeout).toBe(15000);
      expect(searchService.enhancedSearchConfig).toBeDefined();
      expect(searchService.enhancedSearchConfig.maxSerpResults).toBe(5);
      expect(searchService.enhancedSearchConfig.minKeywordMatchRatio).toBe(0.5);
    });
  });

  describe('URL parsing', () => {
    it('should parse URLs correctly', () => {
      const url = 'https://example.com/path/to/file.html?query=1#section';
      const parsed = searchService.parseURL(url);
      
      expect(parsed.domain).toBe('example.com');
      expect(parsed.protocol).toBe('https:');
      expect(parsed.pathname).toBe('/path/to/file.html');
      expect(parsed.fileName).toBe('file.html');
      expect(parsed.fileNameWithoutExt).toBe('file');
      expect(parsed.pathParts).toEqual(['path', 'to', 'file.html']);
    });

    it('should handle URLs without file extensions', () => {
      const url = 'https://example.com/about';
      const parsed = searchService.parseURL(url);
      
      expect(parsed.fileName).toBe('about');
      expect(parsed.fileNameWithoutExt).toBe('about');
    });

    it('should handle root URLs', () => {
      const url = 'https://example.com/';
      const parsed = searchService.parseURL(url);

      expect(parsed.fileName).toBe('');
      expect(parsed.pathParts).toEqual([]);
    });

    it('should return null for invalid URLs', () => {
      const parsed = searchService.parseURL('not-a-url');
      expect(parsed).toBeNull();
    });
  });

  describe('search query generation', () => {
    it('should generate site-specific queries with filename', () => {
      const urlInfo = {
        domain: 'example.com',
        fileName: 'article.html',
        fileNameWithoutExt: 'article',
        pathParts: ['blog', 'article.html']
      };
      
      const queries = searchService.generateSearchQueries(urlInfo, true);
      
      expect(queries).toContain('site:example.com "article"');
      expect(queries).toContain('site:example.com article');
    });

    it('should generate queries with path components', () => {
      const urlInfo = {
        domain: 'example.com',
        fileName: 'index.html',
        fileNameWithoutExt: 'index',
        pathParts: ['products', 'widgets', 'index.html']
      };
      
      const queries = searchService.generateSearchQueries(urlInfo, true);
      
      expect(queries.some(q => q.includes('products widgets index'))).toBe(true);
    });

    it('should generate broader queries when strict domain is disabled', () => {
      const urlInfo = {
        domain: 'example.com',
        fileName: 'article.html',
        fileNameWithoutExt: 'article',
        pathParts: ['blog', 'article.html']
      };
      
      const queries = searchService.generateSearchQueries(urlInfo, false);
      
      expect(queries.some(q => q.includes('"article" example.com'))).toBe(true);
      expect(queries.some(q => q === 'article')).toBe(true);
    });
  });

  describe('search term cleaning', () => {
    it('should clean search terms properly', () => {
      expect(searchService.cleanSearchTerm('hello-world_test')).toBe('hello world test');
      expect(searchService.cleanSearchTerm('file@#$%name')).toBe('file name');
      expect(searchService.cleanSearchTerm('  Multiple   Spaces  ')).toBe('multiple spaces');
    });
  });

  describe('search execution', () => {
    it('should perform search and return results', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          AbstractURL: 'https://example.com/new-article',
          Heading: 'New Article',
          AbstractText: 'This is the new article content',
          RelatedTopics: [
            {
              FirstURL: 'https://example.com/related',
              Text: 'Related article'
            }
          ]
        })
      };
      
      global.fetch.mockResolvedValue(mockResponse);

      const results = await searchService.performSearch('test query', 5, 10000);
      
      expect(results).toHaveLength(2);
      expect(results[0].url).toBe('https://example.com/new-article');
      expect(results[0].title).toBe('New Article');
      expect(results[1].url).toBe('https://example.com/related');
    });

    it('should handle search API errors', async () => {
      global.fetch.mockRejectedValue(new Error('API Error'));

      await expect(searchService.performSearch('test query', 5, 10000))
        .rejects.toThrow('API Error');
    });

    it('should handle search timeouts', async () => {
      global.fetch.mockImplementation((url, options) =>
        new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => resolve({
            ok: true,
            json: () => Promise.resolve({})
          }), 2000);

          // Handle abort signal
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              clearTimeout(timeoutId);
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }
        })
      );

      await expect(searchService.performSearch('test query', 5, 1000))
        .rejects.toThrow('Search request timeout');
    });
  });

  describe('DuckDuckGo response parsing', () => {
    it('should parse instant answer responses', () => {
      const data = {
        AbstractURL: 'https://example.com/answer',
        Heading: 'Test Heading',
        AbstractText: 'Test abstract text'
      };
      
      const results = searchService.parseDuckDuckGoResponse(data, 5);
      
      expect(results).toHaveLength(1);
      expect(results[0].url).toBe('https://example.com/answer');
      expect(results[0].title).toBe('Test Heading');
      expect(results[0].source).toBe('instant_answer');
    });

    it('should parse related topics', () => {
      const data = {
        RelatedTopics: [
          {
            FirstURL: 'https://example.com/topic1',
            Text: 'Topic 1 text'
          },
          {
            FirstURL: 'https://example.com/topic2',
            Text: 'Topic 2 text'
          }
        ]
      };
      
      const results = searchService.parseDuckDuckGoResponse(data, 5);
      
      expect(results).toHaveLength(2);
      expect(results[0].source).toBe('related_topic');
      expect(results[1].source).toBe('related_topic');
    });

    it('should respect max results limit', () => {
      const data = {
        RelatedTopics: Array.from({ length: 10 }, (_, i) => ({
          FirstURL: `https://example.com/topic${i}`,
          Text: `Topic ${i} text`
        }))
      };
      
      const results = searchService.parseDuckDuckGoResponse(data, 3);
      
      expect(results).toHaveLength(3);
    });
  });

  describe('confidence scoring', () => {
    it('should score exact domain matches highly', () => {
      const originalUrlInfo = {
        domain: 'example.com',
        fileName: 'test.html',
        fileNameWithoutExt: 'test',
        pathParts: ['blog', 'test.html']
      };
      
      const resultUrlInfo = {
        domain: 'example.com',
        fileName: 'test.html',
        fileNameWithoutExt: 'test',
        pathParts: ['articles', 'test.html']
      };
      
      const result = {
        title: 'Test Article',
        snippet: 'This is a test article'
      };
      
      const confidence = searchService.calculateConfidenceScore(
        originalUrlInfo,
        resultUrlInfo,
        result,
        true
      );
      
      expect(confidence).toBeGreaterThan(0.7); // High confidence for domain + filename match
    });

    it('should return zero confidence for different domains in strict mode', () => {
      const originalUrlInfo = {
        domain: 'example.com',
        fileName: 'test.html',
        fileNameWithoutExt: 'test',
        pathParts: ['blog', 'test.html']
      };
      
      const resultUrlInfo = {
        domain: 'different.com',
        fileName: 'test.html',
        fileNameWithoutExt: 'test',
        pathParts: ['articles', 'test.html']
      };
      
      const result = {
        title: 'Test Article',
        snippet: 'This is a test article'
      };
      
      const confidence = searchService.calculateConfidenceScore(
        originalUrlInfo,
        resultUrlInfo,
        result,
        true
      );
      
      expect(confidence).toBe(0);
    });

    it('should allow partial domain matches in non-strict mode', () => {
      const originalUrlInfo = {
        domain: 'blog.example.com',
        fileName: 'test.html',
        fileNameWithoutExt: 'test',
        pathParts: ['test.html']
      };
      
      const resultUrlInfo = {
        domain: 'www.example.com',
        fileName: 'test.html',
        fileNameWithoutExt: 'test',
        pathParts: ['articles', 'test.html']
      };
      
      const result = {
        title: 'Test Article',
        snippet: 'This is a test article'
      };
      
      const confidence = searchService.calculateConfidenceScore(
        originalUrlInfo,
        resultUrlInfo,
        result,
        false
      );
      
      expect(confidence).toBeGreaterThan(0.3); // Some confidence for partial domain match
    });
  });

  describe('path similarity calculation', () => {
    it('should calculate path similarity correctly', () => {
      const originalParts = ['blog', 'articles', 'test.html'];
      const resultParts = ['articles', 'test.html'];
      
      const similarity = searchService.calculatePathSimilarity(originalParts, resultParts);
      
      expect(similarity).toBeCloseTo(0.67, 2); // 2/3 parts match
    });

    it('should handle empty paths', () => {
      expect(searchService.calculatePathSimilarity([], [])).toBe(1);
      expect(searchService.calculatePathSimilarity(['test'], [])).toBe(0);
      expect(searchService.calculatePathSimilarity([], ['test'])).toBe(0);
    });
  });

  describe('text relevance calculation', () => {
    it('should calculate text relevance correctly', () => {
      const searchTerm = 'test article';
      const resultText = 'This is a test article about testing';
      
      const relevance = searchService.calculateTextRelevance(searchTerm, resultText);
      
      expect(relevance).toBe(1); // Exact match
    });

    it('should handle partial matches', () => {
      const searchTerm = 'test article guide';
      const resultText = 'This is a test article';
      
      const relevance = searchService.calculateTextRelevance(searchTerm, resultText);
      
      expect(relevance).toBeCloseTo(0.67, 2); // 2/3 words match
    });

    it('should handle no matches', () => {
      const searchTerm = 'completely different';
      const resultText = 'This is a test article';
      
      const relevance = searchService.calculateTextRelevance(searchTerm, resultText);
      
      expect(relevance).toBe(0);
    });
  });

  describe('rate limiting', () => {
    it('should enforce rate limiting between requests', async () => {
      const startTime = Date.now();
      
      await searchService.enforceRateLimit();
      await searchService.enforceRateLimit();
      
      const endTime = Date.now();
      const elapsed = endTime - startTime;
      
      expect(elapsed).toBeGreaterThanOrEqual(1000); // Should wait at least 1 second
    });
  });

  describe('replacement URL finding', () => {
    it('should find and validate replacement URLs', async () => {
      // Mock enhanced SERP search to return null so it falls back to regular search
      searchService.performEnhancedSerpSearch = vi.fn().mockResolvedValue(null);

      // Mock validation methods to return successful validation
      searchService.validateSearchResults = vi.fn().mockResolvedValue([
        {
          url: 'https://example.com/new-article',
          title: 'New Article',
          snippet: 'This is the new article',
          confidence: 0.8
        }
      ]);

      // Mock validateReplacementURL to return successful validation
      searchService.validateReplacementURL = vi.fn().mockResolvedValue({
        valid: true,
        score: 0.9,
        domainRelevance: 0.8,
        accessibilityResult: { accessible: true, score: 1.0 },
        contentRelevance: { score: 0.9 }
      });

      // Mock search response
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          AbstractURL: 'https://example.com/new-article',
          Heading: 'New Article',
          AbstractText: 'This is the new article'
        })
      });

      const replacement = await searchService.findReplacementURL('https://example.com/old-article');

      expect(replacement).toBeDefined();
      expect(replacement.replacementURL).toBe('https://example.com/new-article');
      expect(replacement.validated).toBe(true);
      expect(replacement.confidence).toBeGreaterThan(0);
    });

    it('should return null when no replacement found', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({})
      });

      const replacement = await searchService.findReplacementURL('https://example.com/not-found');
      
      expect(replacement).toBeNull();
    });
  });
});
