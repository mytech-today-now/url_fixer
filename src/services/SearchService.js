/**
 * SearchService - Find replacement URLs using DuckDuckGo search
 * Implements intelligent search strategies for broken links
 */

'use strict';

import { Logger } from '../utils/Logger.js';

export class SearchService {
  constructor() {
    this.logger = new Logger('SearchService');
    this.searchEndpoint = 'https://api.duckduckgo.com/';
    this.maxResults = 5;
    this.searchTimeout = 15000; // 15 seconds
    this.rateLimitDelay = 1000; // 1 second between requests
    this.lastRequestTime = 0;

    // Enhanced search configuration
    this.enhancedSearchConfig = {
      maxSerpResults: 5,
      contentScrapeTimeout: 10000,
      minKeywordMatchRatio: 0.5,
      maxRetries: 2,
      fallbackToOriginalSearch: true
    };
  }

  /**
   * Find replacement URL for a broken link
   */
  async findReplacementURL(originalURL, options = {}) {
    const {
      maxResults = this.maxResults,
      timeout = this.searchTimeout,
      strictDomain = true,
      statusCode = 404
    } = options;

    try {
      this.logger.info(`Searching for replacement for ${statusCode} error: ${originalURL}`);

      // Parse the original URL to extract domain and path components
      const urlInfo = this.parseURL(originalURL);
      if (!urlInfo) {
        throw new Error('Invalid URL format');
      }

      // For 404/403 errors, try enhanced SERP-based search first
      if (statusCode === 404 || statusCode === 403) {
        const serpResult = await this.performEnhancedSerpSearch(originalURL, urlInfo, options);
        if (serpResult) {
          // Validate the SERP result before returning
          const searchTerms = this.parseFilenameForSearch(urlInfo.fileName || urlInfo.fileNameWithoutExt);
          const validationResult = await this.validateReplacementURL(serpResult.replacementURL, urlInfo, searchTerms);

          if (validationResult.valid) {
            return {
              ...serpResult,
              validated: true,
              validationScore: validationResult.score,
              validationDetails: validationResult
            };
          } else {
            this.logger.warn(`SERP result failed validation: ${serpResult.replacementURL} - ${validationResult.reason}`);
            // Continue to fallback search
          }
        }
      }

      // Fallback to original search strategy
      const searchQueries = this.generateSearchQueries(urlInfo, strictDomain);

      // Try each search query until we find a good replacement
      for (const query of searchQueries) {
        this.logger.debug(`Trying fallback search query: ${query}`);

        const searchResults = await this.performSearch(query, maxResults, timeout);

        if (searchResults.length > 0) {
          // Validate and score the results
          const validatedResults = await this.validateSearchResults(
            searchResults,
            urlInfo,
            strictDomain
          );

          if (validatedResults.length > 0) {
            // Try to validate the best results
            for (const result of validatedResults.slice(0, 3)) { // Check top 3 results
              const searchTerms = this.parseFilenameForSearch(urlInfo.fileName || urlInfo.fileNameWithoutExt);
              const validationResult = await this.validateReplacementURL(result.url, urlInfo, searchTerms);

              if (validationResult.valid) {
                this.logger.info(`Found validated replacement via fallback: ${result.url}`);

                return {
                  originalURL,
                  replacementURL: result.url,
                  confidence: Math.min(result.confidence, validationResult.score),
                  source: 'duckduckgo-fallback',
                  searchQuery: query,
                  title: result.title,
                  snippet: result.snippet,
                  validated: true,
                  validationScore: validationResult.score,
                  validationDetails: validationResult,
                  timestamp: new Date().toISOString()
                };
              } else {
                this.logger.debug(`Fallback result failed validation: ${result.url} - ${validationResult.reason}`);
              }
            }

            // If no results pass validation, return the best unvalidated result with a warning
            const bestResult = validatedResults[0];
            this.logger.warn(`No fallback results passed validation, returning best unvalidated result: ${bestResult.url}`);

            return {
              originalURL,
              replacementURL: bestResult.url,
              confidence: bestResult.confidence * 0.7, // Reduce confidence for unvalidated result
              source: 'duckduckgo-fallback',
              searchQuery: query,
              title: bestResult.title,
              snippet: bestResult.snippet,
              validated: false,
              timestamp: new Date().toISOString()
            };
          }
        }
      }

      this.logger.warn(`No replacement found for: ${originalURL}`);
      return null;
      
    } catch (error) {
      this.logger.error(`Search failed for ${originalURL}`, error);
      throw error;
    }
  }

  /**
   * Enhanced SERP-based search for 404/403 errors
   * Implements the strategy: "site:domain.tld file name apart like this"
   */
  async performEnhancedSerpSearch(originalURL, urlInfo, options = {}) {
    const {
      timeout = this.searchTimeout,
      maxResults = this.enhancedSearchConfig.maxSerpResults
    } = options;

    const startTime = Date.now();
    let attemptCount = 0;

    try {
      this.logger.info(`Starting enhanced SERP search for: ${originalURL}`);

      // Extract and parse filename for intelligent search terms
      const searchTerms = this.parseFilenameForSearch(urlInfo.fileName || urlInfo.fileNameWithoutExt);
      if (!searchTerms || searchTerms.length === 0) {
        this.logger.warn(`No suitable search terms found for enhanced SERP search: ${originalURL}`);
        return null;
      }

      this.logger.debug(`Extracted search terms: [${searchTerms.join(', ')}]`);

      // Create site-specific search query
      const domain = urlInfo.domain;
      const searchQuery = `site:${domain} ${searchTerms.join(' ')}`;

      this.logger.info(`Enhanced SERP search query: "${searchQuery}"`);

      // Perform web search to get SERP results with retry logic
      let serpResults = [];
      for (let retry = 0; retry <= this.enhancedSearchConfig.maxRetries; retry++) {
        attemptCount++;
        try {
          serpResults = await this.performWebSearch(searchQuery, maxResults, timeout);
          break;
        } catch (searchError) {
          this.logger.warn(`Web search attempt ${retry + 1} failed:`, searchError.message);
          if (retry === this.enhancedSearchConfig.maxRetries) {
            throw searchError;
          }
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * (retry + 1)));
        }
      }

      if (serpResults.length === 0) {
        this.logger.warn(`No SERP results found for enhanced search: ${searchQuery}`);
        return null;
      }

      this.logger.debug(`Found ${serpResults.length} SERP results to validate`);

      // Process SERP results in order, scraping content to find best match
      let validationErrors = [];
      for (let i = 0; i < serpResults.length; i++) {
        const serpResult = serpResults[i];
        try {
          this.logger.debug(`Validating SERP result ${i + 1}/${serpResults.length}: ${serpResult.url}`);

          const isMatch = await this.validateSerpResultByContent(serpResult, searchTerms, urlInfo);
          if (isMatch) {
            const elapsedTime = Date.now() - startTime;
            this.logger.info(`✅ Enhanced SERP search found match in ${elapsedTime}ms (${attemptCount} attempts): ${serpResult.url}`);

            return {
              originalURL,
              replacementURL: serpResult.url,
              confidence: isMatch.confidence,
              source: 'enhanced-serp',
              searchQuery,
              title: serpResult.title,
              snippet: serpResult.snippet,
              matchedKeywords: isMatch.matchedKeywords,
              searchTime: elapsedTime,
              attempts: attemptCount,
              timestamp: new Date().toISOString()
            };
          }
        } catch (validationError) {
          validationErrors.push({
            url: serpResult.url,
            error: validationError.message
          });
          this.logger.debug(`❌ SERP result validation failed for ${serpResult.url}: ${validationError.message}`);
          continue;
        }
      }

      const elapsedTime = Date.now() - startTime;
      this.logger.warn(`No valid matches found in ${serpResults.length} SERP results after ${elapsedTime}ms`);

      if (validationErrors.length > 0) {
        this.logger.debug('Validation errors summary:', validationErrors);
      }

      return null;

    } catch (error) {
      const elapsedTime = Date.now() - startTime;
      this.logger.error(`Enhanced SERP search failed after ${elapsedTime}ms (${attemptCount} attempts):`, error.message);

      // If enhanced search fails and fallback is enabled, return null to trigger fallback
      if (this.enhancedSearchConfig.fallbackToOriginalSearch) {
        this.logger.info('Will fallback to original search strategy');
      }

      return null;
    }
  }

  /**
   * Enhanced filename parsing with intelligent term extraction
   * Converts "file-name-is-like-this.html" to ["file", "name", "is", "like", "this"]
   */
  parseFilenameForSearch(filename) {
    if (!filename) return [];

    // Remove file extension
    const nameWithoutExt = filename.split('.')[0];

    // Split on common separators and clean
    let terms = nameWithoutExt
      .split(/[-_\s\.]+/)
      .map(term => term.toLowerCase().trim())
      .filter(term => term.length > 2) // Filter out very short terms
      .filter(term => !/^\d+$/.test(term)) // Filter out pure numbers
      .filter(term => !this.isStopWord(term)) // Use enhanced stop word filtering
      .filter(term => !this.isCommonWebTerm(term)); // Filter web-specific terms

    // Add term variations for better matching
    const expandedTerms = [];
    for (const term of terms) {
      expandedTerms.push(term);

      // Add plural/singular variations
      if (term.endsWith('s') && term.length > 3) {
        expandedTerms.push(term.slice(0, -1)); // Remove 's'
      } else if (!term.endsWith('s')) {
        expandedTerms.push(term + 's'); // Add 's'
      }
    }

    // Remove duplicates and limit results
    return [...new Set(expandedTerms)].slice(0, 10);
  }

  /**
   * Enhanced stop word detection
   */
  isStopWord(term) {
    const stopWords = [
      'and', 'or', 'the', 'for', 'with', 'from', 'into', 'of', 'in', 'on', 'at',
      'to', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has',
      'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
      'might', 'can', 'must', 'shall', 'this', 'that', 'these', 'those'
    ];
    return stopWords.includes(term.toLowerCase());
  }

  /**
   * Check if a term is a common web-related term that should be filtered
   */
  isCommonWebTerm(term) {
    const commonWebTerms = [
      'page', 'html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'cfm',
      'index', 'default', 'home', 'main', 'content', 'article',
      'post', 'blog', 'news', 'info', 'about', 'contact',
      'search', 'results', 'list', 'view', 'show', 'display',
      'www', 'http', 'https', 'com', 'org', 'net', 'edu', 'gov'
    ];
    return commonWebTerms.includes(term.toLowerCase());
  }

  /**
   * Validate URL format
   */
  isValidURL(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parse URL to extract useful components for searching
   */
  parseURL(url) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
      const fileName = pathParts[pathParts.length - 1] || '';
      const fileNameWithoutExt = fileName.split('.')[0];

      return {
        domain: urlObj.hostname,
        protocol: urlObj.protocol,
        pathname: urlObj.pathname,
        pathParts,
        fileName,
        fileNameWithoutExt,
        search: urlObj.search,
        hash: urlObj.hash
      };
    } catch (error) {
      this.logger.error('Failed to parse URL', error);
      return null;
    }
  }

  /**
   * Generate search queries based on URL components
   */
  generateSearchQueries(urlInfo, strictDomain) {
    const queries = [];
    const domain = urlInfo.domain;
    const fileName = urlInfo.fileNameWithoutExt;
    const pathParts = urlInfo.pathParts;

    // Strategy 1: Site-specific search with filename
    if (fileName && fileName.length > 3) {
      const cleanFileName = this.cleanSearchTerm(fileName);
      queries.push(`site:${domain} "${cleanFileName}"`);
      queries.push(`site:${domain} ${cleanFileName}`);
    }

    // Strategy 2: Site-specific search with path components
    if (pathParts.length > 1) {
      const pathTerms = pathParts
        .map(part => this.cleanSearchTerm(part))
        .filter(term => term.length > 2)
        .slice(-3); // Last 3 path components
      
      if (pathTerms.length > 0) {
        queries.push(`site:${domain} ${pathTerms.join(' ')}`);
      }
    }

    // Strategy 3: Broader search if strict domain is disabled
    if (!strictDomain) {
      if (fileName && fileName.length > 3) {
        const cleanFileName = this.cleanSearchTerm(fileName);
        queries.push(`"${cleanFileName}" ${domain}`);
        queries.push(cleanFileName);
      }
      
      if (pathParts.length > 0) {
        const lastPathPart = this.cleanSearchTerm(pathParts[pathParts.length - 1]);
        if (lastPathPart.length > 3) {
          queries.push(`"${lastPathPart}" ${domain}`);
        }
      }
    }

    return queries.filter(query => query.length > 0);
  }

  /**
   * Clean search terms by removing special characters and normalizing
   */
  cleanSearchTerm(term) {
    return term
      .replace(/[-_]/g, ' ') // Replace hyphens and underscores with spaces
      .replace(/[^a-zA-Z0-9\s]/g, ' ') // Replace special characters with spaces
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .toLowerCase();
  }

  /**
   * Perform search using DuckDuckGo API
   */
  async performSearch(query, maxResults, timeout) {
    try {
      // Rate limiting
      await this.enforceRateLimit();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // DuckDuckGo Instant Answer API (limited but free)
      const searchURL = new URL(this.searchEndpoint);
      searchURL.searchParams.set('q', query);
      searchURL.searchParams.set('format', 'json');
      searchURL.searchParams.set('no_html', '1');
      searchURL.searchParams.set('skip_disambig', '1');

      let response;
      try {
        response = await fetch(searchURL.toString(), {
          signal: controller.signal,
          headers: {
            'User-Agent': 'URL-Fixer/1.0 (+https://url-fixer.app)'
          }
        });
      } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          throw new Error('Search request timeout');
        }
        throw error;
      }

      clearTimeout(timeoutId);

      if (!response || !response.ok) {
        throw new Error(`Search API returned ${response?.status || 'unknown'}: ${response?.statusText || 'unknown error'}`);
      }

      const data = await response.json();
      
      // Parse DuckDuckGo response
      const results = this.parseDuckDuckGoResponse(data, maxResults);
      
      this.logger.debug(`Search returned ${results.length} results for: ${query}`);
      return results;
      
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Search request timed out');
      }
      throw error;
    }
  }

  /**
   * Parse DuckDuckGo API response
   */
  parseDuckDuckGoResponse(data, maxResults) {
    const results = [];

    // Check for instant answer
    if (data.AbstractURL && data.AbstractURL.length > 0) {
      results.push({
        url: data.AbstractURL,
        title: data.Heading || data.AbstractText || 'No title',
        snippet: data.AbstractText || '',
        source: 'instant_answer'
      });
    }

    // Check for related topics
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      data.RelatedTopics.forEach(topic => {
        if (topic.FirstURL && results.length < maxResults) {
          results.push({
            url: topic.FirstURL,
            title: topic.Text || 'No title',
            snippet: topic.Text || '',
            source: 'related_topic'
          });
        }
      });
    }

    // Check for definition
    if (data.Definition && data.DefinitionURL) {
      results.push({
        url: data.DefinitionURL,
        title: data.DefinitionSource || 'Definition',
        snippet: data.Definition,
        source: 'definition'
      });
    }

    return results.slice(0, maxResults);
  }

  /**
   * Validate search results and score them
   */
  async validateSearchResults(searchResults, originalUrlInfo, strictDomain) {
    const validatedResults = [];

    for (const result of searchResults) {
      try {
        const resultUrlInfo = this.parseURL(result.url);
        if (!resultUrlInfo) continue;

        // Calculate confidence score
        const confidence = this.calculateConfidenceScore(
          originalUrlInfo, 
          resultUrlInfo, 
          result,
          strictDomain
        );

        if (confidence > 0.3) { // Minimum confidence threshold
          validatedResults.push({
            ...result,
            confidence,
            parsedUrl: resultUrlInfo
          });
        }
      } catch (error) {
        this.logger.debug(`Failed to validate result: ${result.url}`, error);
      }
    }

    // Sort by confidence score (highest first)
    return validatedResults.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Calculate confidence score for a search result
   */
  calculateConfidenceScore(originalUrlInfo, resultUrlInfo, result, strictDomain) {
    let score = 0;

    // Domain matching (highest weight)
    if (originalUrlInfo.domain === resultUrlInfo.domain) {
      score += 0.5;
    } else if (strictDomain) {
      return 0; // No score if domains don't match in strict mode
    } else {
      // Partial domain matching
      const originalParts = originalUrlInfo.domain.split('.');
      const resultParts = resultUrlInfo.domain.split('.');
      const commonParts = originalParts.filter(part => resultParts.includes(part));
      score += (commonParts.length / Math.max(originalParts.length, resultParts.length)) * 0.2;
    }

    // Filename matching
    if (originalUrlInfo.fileName && resultUrlInfo.fileName) {
      const originalName = originalUrlInfo.fileNameWithoutExt.toLowerCase();
      const resultName = resultUrlInfo.fileNameWithoutExt.toLowerCase();
      
      if (originalName === resultName) {
        score += 0.3;
      } else if (originalName.includes(resultName) || resultName.includes(originalName)) {
        score += 0.15;
      }
    }

    // Path similarity
    const pathSimilarity = this.calculatePathSimilarity(
      originalUrlInfo.pathParts, 
      resultUrlInfo.pathParts
    );
    score += pathSimilarity * 0.2;

    // Title/snippet relevance
    const textRelevance = this.calculateTextRelevance(
      originalUrlInfo.fileNameWithoutExt,
      result.title + ' ' + result.snippet
    );
    score += textRelevance * 0.1;

    return Math.min(score, 1.0); // Cap at 1.0
  }

  /**
   * Calculate path similarity between two URL paths
   */
  calculatePathSimilarity(originalParts, resultParts) {
    if (originalParts.length === 0 && resultParts.length === 0) return 1;
    if (originalParts.length === 0 || resultParts.length === 0) return 0;

    const commonParts = originalParts.filter(part => 
      resultParts.some(rPart => 
        part.toLowerCase() === rPart.toLowerCase()
      )
    );

    return commonParts.length / Math.max(originalParts.length, resultParts.length);
  }

  /**
   * Calculate text relevance between search terms and result text
   */
  calculateTextRelevance(searchTerm, resultText) {
    if (!searchTerm || !resultText) return 0;

    const cleanSearchTerm = this.cleanSearchTerm(searchTerm);
    const cleanResultText = resultText.toLowerCase();

    if (cleanResultText.includes(cleanSearchTerm)) {
      return 1;
    }

    // Check for partial matches
    const searchWords = cleanSearchTerm.split(' ').filter(word => word.length > 2);
    const matchingWords = searchWords.filter(word => cleanResultText.includes(word));
    
    return searchWords.length > 0 ? matchingWords.length / searchWords.length : 0;
  }

  /**
   * Enforce rate limiting between requests
   */
  async enforceRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      const delay = this.rateLimitDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Perform web search using multiple search strategies
   * Enhanced to provide better SERP results for 404/403 URL replacement
   */
  async performWebSearch(query, maxResults, timeout) {
    try {
      this.logger.debug(`Performing enhanced web search for: ${query}`);

      // Try multiple search strategies in order of preference
      const searchStrategies = [
        () => this.performSerpApiSearch(query, maxResults, timeout),
        () => this.performDuckDuckGoSearch(query, maxResults, timeout),
        () => this.performBingSearch(query, maxResults, timeout),
        () => this.performGoogleScrapeSearch(query, maxResults, timeout)
      ];

      let lastError = null;
      for (const strategy of searchStrategies) {
        try {
          const results = await strategy();
          if (results && results.length > 0) {
            this.logger.debug(`Found ${results.length} results using search strategy`);
            return results;
          }
        } catch (error) {
          lastError = error;
          this.logger.debug(`Search strategy failed, trying next: ${error.message}`);
          continue;
        }
      }

      // If all strategies failed, return empty array (don't throw)
      this.logger.warn('All search strategies failed for query:', query);
      return [];

    } catch (error) {
      this.logger.warn('Web search failed:', error.message);
      return [];
    }
  }

  /**
   * Perform search using SerpApi (if API key is available)
   */
  async performSerpApiSearch(query, maxResults, timeout) {
    // Check if SerpApi key is available in environment
    const apiKey = process.env.SERPAPI_KEY || window.SERPAPI_KEY;
    if (!apiKey) {
      throw new Error('SerpApi key not available');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const searchUrl = new URL('https://serpapi.com/search');
      searchUrl.searchParams.set('engine', 'google');
      searchUrl.searchParams.set('q', query);
      searchUrl.searchParams.set('api_key', apiKey);
      searchUrl.searchParams.set('num', Math.min(maxResults, 10).toString());

      const response = await fetch(searchUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'URL-Fixer/1.0 (+https://url-fixer.app)'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`SerpApi error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.organic_results && data.organic_results.length > 0) {
        return data.organic_results.map(result => ({
          url: result.link,
          title: result.title || 'No title',
          snippet: result.snippet || '',
          source: 'serpapi'
        }));
      }

      return [];

    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Enhanced DuckDuckGo search with HTML scraping fallback
   */
  async performDuckDuckGoSearch(query, maxResults, timeout) {
    try {
      // First try the instant answer API
      const instantResults = await this.performSearch(query, maxResults, timeout);
      if (instantResults && instantResults.length > 0) {
        return instantResults.map(result => ({
          url: result.url,
          title: result.title || 'No title',
          snippet: result.snippet || '',
          source: 'duckduckgo-api'
        }));
      }

      // Fallback to HTML scraping (more comprehensive but slower)
      return await this.scrapeDuckDuckGoResults(query, maxResults, timeout);

    } catch (error) {
      this.logger.debug(`DuckDuckGo search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Scrape DuckDuckGo HTML results for better coverage
   */
  async scrapeDuckDuckGoResults(query, maxResults, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const searchUrl = new URL('https://html.duckduckgo.com/html/');
      searchUrl.searchParams.set('q', query);

      const response = await fetch(searchUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`DuckDuckGo scrape error: ${response.status}`);
      }

      const html = await response.text();
      return this.parseDuckDuckGoHTML(html, maxResults);

    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Parse DuckDuckGo HTML results
   */
  parseDuckDuckGoHTML(html, maxResults) {
    const results = [];

    try {
      // Create a temporary DOM element to parse HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Find result elements (DuckDuckGo uses specific classes)
      const resultElements = doc.querySelectorAll('.result, .web-result');

      for (let i = 0; i < Math.min(resultElements.length, maxResults); i++) {
        const element = resultElements[i];

        // Extract URL
        const linkElement = element.querySelector('a[href]');
        if (!linkElement) continue;

        let url = linkElement.getAttribute('href');
        if (!url) continue;

        // Clean up DuckDuckGo redirect URLs
        if (url.startsWith('/l/?uddg=')) {
          const urlMatch = url.match(/uddg=([^&]+)/);
          if (urlMatch) {
            url = decodeURIComponent(urlMatch[1]);
          }
        }

        // Extract title
        const titleElement = element.querySelector('.result__title, .result__a') || linkElement;
        const title = titleElement ? titleElement.textContent.trim() : 'No title';

        // Extract snippet
        const snippetElement = element.querySelector('.result__snippet, .result__body');
        const snippet = snippetElement ? snippetElement.textContent.trim() : '';

        if (this.isValidURL(url)) {
          results.push({
            url,
            title,
            snippet,
            source: 'duckduckgo-scrape'
          });
        }
      }

    } catch (error) {
      this.logger.debug(`Failed to parse DuckDuckGo HTML: ${error.message}`);
    }

    return results;
  }

  /**
   * Perform Bing search using their API or scraping
   */
  async performBingSearch(query, maxResults, timeout) {
    // Check if Bing API key is available
    const apiKey = process.env.BING_SEARCH_KEY || window.BING_SEARCH_KEY;
    if (apiKey) {
      return await this.performBingApiSearch(query, maxResults, timeout, apiKey);
    }

    // Fallback to scraping (less reliable)
    return await this.scrapeBingResults(query, maxResults, timeout);
  }

  /**
   * Perform Bing API search
   */
  async performBingApiSearch(query, maxResults, timeout, apiKey) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const searchUrl = new URL('https://api.bing.microsoft.com/v7.0/search');
      searchUrl.searchParams.set('q', query);
      searchUrl.searchParams.set('count', Math.min(maxResults, 50).toString());

      const response = await fetch(searchUrl.toString(), {
        signal: controller.signal,
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'User-Agent': 'URL-Fixer/1.0 (+https://url-fixer.app)'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Bing API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.webPages && data.webPages.value && data.webPages.value.length > 0) {
        return data.webPages.value.map(result => ({
          url: result.url,
          title: result.name || 'No title',
          snippet: result.snippet || '',
          source: 'bing-api'
        }));
      }

      return [];

    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Scrape Bing search results
   */
  async scrapeBingResults(query, maxResults, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const searchUrl = new URL('https://www.bing.com/search');
      searchUrl.searchParams.set('q', query);

      const response = await fetch(searchUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Bing scrape error: ${response.status}`);
      }

      const html = await response.text();
      return this.parseBingHTML(html, maxResults);

    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Parse Bing HTML results
   */
  parseBingHTML(html, maxResults) {
    const results = [];

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Find result elements
      const resultElements = doc.querySelectorAll('.b_algo');

      for (let i = 0; i < Math.min(resultElements.length, maxResults); i++) {
        const element = resultElements[i];

        // Extract URL
        const linkElement = element.querySelector('h2 a[href]');
        if (!linkElement) continue;

        const url = linkElement.getAttribute('href');
        if (!url || !this.isValidURL(url)) continue;

        // Extract title
        const title = linkElement.textContent.trim() || 'No title';

        // Extract snippet
        const snippetElement = element.querySelector('.b_caption p, .b_descript');
        const snippet = snippetElement ? snippetElement.textContent.trim() : '';

        results.push({
          url,
          title,
          snippet,
          source: 'bing-scrape'
        });
      }

    } catch (error) {
      this.logger.debug(`Failed to parse Bing HTML: ${error.message}`);
    }

    return results;
  }

  /**
   * Perform Google search using scraping (last resort)
   */
  async performGoogleScrapeSearch(query, maxResults, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const searchUrl = new URL('https://www.google.com/search');
      searchUrl.searchParams.set('q', query);
      searchUrl.searchParams.set('num', Math.min(maxResults, 10).toString());

      const response = await fetch(searchUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Google scrape error: ${response.status}`);
      }

      const html = await response.text();
      return this.parseGoogleHTML(html, maxResults);

    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Parse Google HTML results (basic implementation)
   */
  parseGoogleHTML(html, maxResults) {
    const results = [];

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Find result elements (Google's structure changes frequently)
      const resultElements = doc.querySelectorAll('.g, .tF2Cxc');

      for (let i = 0; i < Math.min(resultElements.length, maxResults); i++) {
        const element = resultElements[i];

        // Extract URL
        const linkElement = element.querySelector('a[href]');
        if (!linkElement) continue;

        const url = linkElement.getAttribute('href');
        if (!url || !this.isValidURL(url)) continue;

        // Extract title
        const titleElement = element.querySelector('h3');
        const title = titleElement ? titleElement.textContent.trim() : 'No title';

        // Extract snippet
        const snippetElement = element.querySelector('.VwiC3b, .s3v9rd');
        const snippet = snippetElement ? snippetElement.textContent.trim() : '';

        results.push({
          url,
          title,
          snippet,
          source: 'google-scrape'
        });
      }

    } catch (error) {
      this.logger.debug(`Failed to parse Google HTML: ${error.message}`);
    }

    return results;
  }

  /**
   * Validate SERP result by scraping content and checking for keywords
   */
  async validateSerpResultByContent(serpResult, searchTerms, originalUrlInfo) {
    try {
      this.logger.debug(`Validating SERP result: ${serpResult.url}`);

      // Scrape the page content with enhanced extraction
      const pageContent = await this.scrapePageContent(serpResult.url);
      if (!pageContent) {
        return false;
      }

      // Check for keyword matches in the content with enhanced scoring
      const matchResult = this.findKeywordMatches(pageContent, searchTerms, originalUrlInfo);

      // Enhanced validation criteria
      const minRequiredMatches = Math.ceil(searchTerms.length * 0.4); // Reduced from 50% to 40%
      const minConfidenceScore = 0.3; // Minimum confidence threshold

      // Check if we meet the minimum requirements
      const meetsMatchRequirement = matchResult.matchedCount >= minRequiredMatches;
      const meetsConfidenceRequirement = matchResult.confidence >= minConfidenceScore;

      if (meetsMatchRequirement && meetsConfidenceRequirement) {
        // Calculate final confidence with enhanced factors
        let finalConfidence = matchResult.confidence;

        // Boost confidence for high-quality matches
        if (matchResult.matchedCount === searchTerms.length) {
          finalConfidence = Math.min(0.95, finalConfidence * 1.2); // All terms found
        } else if (matchResult.matchedCount >= searchTerms.length * 0.8) {
          finalConfidence = Math.min(0.9, finalConfidence * 1.1); // Most terms found
        }

        // Additional boost for title/heading matches
        const hasHighValueMatches = matchResult.matchedTerms.some(match =>
          match.locations && (match.locations.includes('title') || match.locations.some(loc => loc.startsWith('heading')))
        );

        if (hasHighValueMatches) {
          finalConfidence = Math.min(0.95, finalConfidence * 1.1);
        }

        this.logger.debug(`SERP validation successful for ${serpResult.url}: ${matchResult.matchedCount}/${searchTerms.length} terms, confidence: ${finalConfidence.toFixed(3)}`);

        return {
          confidence: finalConfidence,
          matchedKeywords: matchResult.matchedTerms.map(match => match.term),
          totalKeywords: searchTerms.length,
          matchedCount: matchResult.matchedCount,
          detailedMatches: matchResult.matchedTerms,
          normalizedScore: matchResult.normalizedScore,
          bonusScore: matchResult.bonusScore,
          contentMetadata: pageContent.metadata
        };
      }

      this.logger.debug(`SERP validation failed for ${serpResult.url}: ${matchResult.matchedCount}/${searchTerms.length} terms (min: ${minRequiredMatches}), confidence: ${matchResult.confidence.toFixed(3)} (min: ${minConfidenceScore})`);
      return false;

    } catch (error) {
      this.logger.debug(`Content validation failed for ${serpResult.url}:`, error.message);
      return false;
    }
  }

  /**
   * Enhanced page content scraping with multiple extraction strategies
   */
  async scrapePageContent(url) {
    const startTime = Date.now();

    try {
      this.logger.debug(`Scraping content from: ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.enhancedSearchConfig.contentScrapeTimeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check content type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      const html = await response.text();

      if (!html || html.length === 0) {
        throw new Error('Empty response body');
      }

      // Enhanced text extraction with multiple strategies
      const extractedContent = this.extractEnhancedTextFromHTML(html, url);

      if (!extractedContent.text || extractedContent.text.length < 50) {
        throw new Error('Insufficient text content extracted');
      }

      const elapsedTime = Date.now() - startTime;
      this.logger.debug(`Successfully scraped ${extractedContent.text.length} characters in ${elapsedTime}ms from: ${url}`);

      return {
        text: extractedContent.text.toLowerCase(),
        title: extractedContent.title,
        headings: extractedContent.headings,
        metadata: extractedContent.metadata,
        url: url,
        scrapedAt: new Date().toISOString(),
        responseTime: elapsedTime
      };

    } catch (error) {
      const elapsedTime = Date.now() - startTime;

      if (error.name === 'AbortError') {
        this.logger.warn(`Content scraping timed out after ${elapsedTime}ms for: ${url}`);
      } else if (error.message.includes('Failed to fetch')) {
        this.logger.warn(`Network error scraping content from: ${url}`);
      } else {
        this.logger.debug(`Failed to scrape content from ${url} after ${elapsedTime}ms: ${error.message}`);
      }

      return null;
    }
  }

  /**
   * Enhanced text extraction from HTML with structured content analysis
   */
  extractEnhancedTextFromHTML(html, url) {
    try {
      // Parse HTML using DOMParser for better structure analysis
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Extract title
      const titleElement = doc.querySelector('title');
      const title = titleElement ? titleElement.textContent.trim() : '';

      // Extract meta description
      const metaDesc = doc.querySelector('meta[name="description"]');
      const description = metaDesc ? metaDesc.getAttribute('content') : '';

      // Extract headings with hierarchy
      const headings = [];
      const headingElements = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
      headingElements.forEach(heading => {
        headings.push({
          level: parseInt(heading.tagName.charAt(1)),
          text: heading.textContent.trim()
        });
      });

      // Remove unwanted elements
      const elementsToRemove = doc.querySelectorAll('script, style, nav, header, footer, aside, .navigation, .menu, .sidebar, .ads, .advertisement');
      elementsToRemove.forEach(el => el.remove());

      // Extract main content (prioritize main, article, or content areas)
      let mainContent = '';
      const contentSelectors = [
        'main',
        'article',
        '[role="main"]',
        '.content',
        '.main-content',
        '.post-content',
        '.entry-content',
        '#content',
        '#main'
      ];

      for (const selector of contentSelectors) {
        const contentElement = doc.querySelector(selector);
        if (contentElement) {
          mainContent = this.extractTextFromElement(contentElement);
          break;
        }
      }

      // Fallback to body content if no main content found
      if (!mainContent) {
        const bodyElement = doc.querySelector('body');
        if (bodyElement) {
          mainContent = this.extractTextFromElement(bodyElement);
        }
      }

      // Extract all text as fallback
      if (!mainContent) {
        mainContent = this.extractTextFromHTML(html);
      }

      // Combine all text sources with weights
      const combinedText = [
        title,
        description,
        headings.map(h => h.text).join(' '),
        mainContent
      ].filter(text => text && text.length > 0).join(' ');

      return {
        text: this.normalizeText(combinedText),
        title: title,
        description: description,
        headings: headings,
        metadata: {
          url: url,
          hasMainContent: !!mainContent,
          headingCount: headings.length,
          textLength: combinedText.length
        }
      };

    } catch (error) {
      this.logger.debug(`Enhanced text extraction failed, falling back to basic extraction: ${error.message}`);

      // Fallback to basic extraction
      const basicText = this.extractTextFromHTML(html);
      return {
        text: this.normalizeText(basicText),
        title: '',
        description: '',
        headings: [],
        metadata: {
          url: url,
          hasMainContent: false,
          headingCount: 0,
          textLength: basicText.length,
          fallback: true
        }
      };
    }
  }

  /**
   * Extract text content from a DOM element
   */
  extractTextFromElement(element) {
    if (!element) return '';

    // Clone the element to avoid modifying the original
    const clonedElement = element.cloneNode(true);

    // Remove unwanted child elements
    const unwantedElements = clonedElement.querySelectorAll('script, style, nav, .navigation, .menu, .ads');
    unwantedElements.forEach(el => el.remove());

    return clonedElement.textContent || clonedElement.innerText || '';
  }

  /**
   * Basic text extraction from HTML (fallback method)
   */
  extractTextFromHTML(html) {
    // Remove script and style elements
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Remove HTML tags
    text = text.replace(/<[^>]*>/g, ' ');

    // Decode HTML entities (basic ones)
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, ' ');

    return this.normalizeText(text);
  }

  /**
   * Normalize text content
   */
  normalizeText(text) {
    if (!text) return '';

    return text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\w\s\-\.]/g, ' ') // Remove special characters except word chars, spaces, hyphens, dots
      .trim()
      .toLowerCase();
  }

  /**
   * Enhanced keyword matching with weighted scoring
   */
  findKeywordMatches(contentData, searchTerms, originalUrlInfo) {
    const matchedTerms = [];
    let matchedCount = 0;
    let totalScore = 0;

    // Handle both old string format and new enhanced format
    const content = typeof contentData === 'string' ? contentData : contentData.text;
    const title = typeof contentData === 'object' ? contentData.title : '';
    const headings = typeof contentData === 'object' ? contentData.headings : [];

    // Search in main content
    for (const term of searchTerms) {
      const termLower = term.toLowerCase();
      let termScore = 0;
      let found = false;

      // Check main content (weight: 1.0)
      if (content.includes(termLower)) {
        termScore += 1.0;
        found = true;
      }

      // Check title (weight: 2.0 - higher importance)
      if (title && title.toLowerCase().includes(termLower)) {
        termScore += 2.0;
        found = true;
      }

      // Check headings (weight: 1.5)
      if (headings && headings.length > 0) {
        for (const heading of headings) {
          if (heading.text.toLowerCase().includes(termLower)) {
            termScore += 1.5;
            found = true;
            break;
          }
        }
      }

      if (found) {
        matchedTerms.push({
          term: term,
          score: termScore,
          locations: this.findTermLocations(termLower, content, title, headings)
        });
        matchedCount++;
        totalScore += termScore;
      }
    }

    // Bonus scoring for domain and URL components
    let bonusScore = 0;

    // Check for domain name presence (bonus points)
    if (originalUrlInfo.domain) {
      const domainLower = originalUrlInfo.domain.toLowerCase();
      if (content.includes(domainLower)) {
        bonusScore += 0.5;
      }
      if (title && title.toLowerCase().includes(domainLower)) {
        bonusScore += 1.0;
      }
    }

    // Check for filename components
    if (originalUrlInfo.fileNameWithoutExt) {
      const filenameLower = originalUrlInfo.fileNameWithoutExt.toLowerCase();
      if (content.includes(filenameLower)) {
        bonusScore += 0.3;
      }
      if (title && title.toLowerCase().includes(filenameLower)) {
        bonusScore += 0.6;
      }
    }

    // Calculate final confidence score
    const maxPossibleScore = searchTerms.length * 2.0; // Max if all terms found in title
    const normalizedScore = Math.min(1.0, (totalScore + bonusScore) / maxPossibleScore);

    return {
      matchedTerms,
      matchedCount,
      totalTerms: searchTerms.length,
      totalScore,
      bonusScore,
      normalizedScore,
      confidence: normalizedScore
    };
  }

  /**
   * Find locations where a term appears in content
   */
  findTermLocations(term, content, title, headings) {
    const locations = [];

    if (content && content.includes(term)) {
      locations.push('content');
    }

    if (title && title.toLowerCase().includes(term)) {
      locations.push('title');
    }

    if (headings && headings.length > 0) {
      for (const heading of headings) {
        if (heading.text.toLowerCase().includes(term)) {
          locations.push(`heading-h${heading.level}`);
          break;
        }
      }
    }

    return locations;
  }

  /**
   * Comprehensive validation of replacement URL candidates
   */
  async validateReplacementURL(url, originalUrlInfo, searchTerms) {
    try {
      this.logger.debug(`Validating replacement URL: ${url}`);

      // Basic URL format validation
      if (!this.isValidURL(url)) {
        return { valid: false, reason: 'Invalid URL format' };
      }

      // Parse the replacement URL
      const replacementUrlInfo = this.parseURL(url);
      if (!replacementUrlInfo) {
        return { valid: false, reason: 'Failed to parse URL' };
      }

      // Domain relevance check
      const domainRelevance = this.calculateDomainRelevance(originalUrlInfo, replacementUrlInfo);
      if (domainRelevance < 0.3) {
        return { valid: false, reason: 'Domain not relevant enough', domainRelevance };
      }

      // HTTP accessibility check
      const accessibilityResult = await this.checkURLAccessibility(url);
      if (!accessibilityResult.accessible) {
        return { valid: false, reason: 'URL not accessible', accessibilityResult };
      }

      // Content relevance check
      const contentRelevance = await this.checkContentRelevance(url, searchTerms, originalUrlInfo);
      if (contentRelevance.score < 0.4) {
        return { valid: false, reason: 'Content not relevant enough', contentRelevance };
      }

      // Calculate overall validation score
      const overallScore = (domainRelevance * 0.3) + (accessibilityResult.score * 0.3) + (contentRelevance.score * 0.4);

      return {
        valid: true,
        score: overallScore,
        domainRelevance,
        accessibilityResult,
        contentRelevance,
        replacementUrlInfo
      };

    } catch (error) {
      this.logger.debug(`URL validation failed for ${url}: ${error.message}`);
      return { valid: false, reason: 'Validation error', error: error.message };
    }
  }

  /**
   * Calculate domain relevance between original and replacement URLs
   */
  calculateDomainRelevance(originalUrlInfo, replacementUrlInfo) {
    // Exact domain match
    if (originalUrlInfo.domain === replacementUrlInfo.domain) {
      return 1.0;
    }

    // Subdomain match
    if (originalUrlInfo.domain.includes(replacementUrlInfo.domain) ||
        replacementUrlInfo.domain.includes(originalUrlInfo.domain)) {
      return 0.8;
    }

    // Same top-level domain
    const originalTLD = originalUrlInfo.domain.split('.').slice(-2).join('.');
    const replacementTLD = replacementUrlInfo.domain.split('.').slice(-2).join('.');
    if (originalTLD === replacementTLD) {
      return 0.6;
    }

    // Different domains but might be related
    const originalParts = originalUrlInfo.domain.split('.');
    const replacementParts = replacementUrlInfo.domain.split('.');
    const commonParts = originalParts.filter(part => replacementParts.includes(part));

    if (commonParts.length > 0) {
      return Math.min(0.5, commonParts.length / Math.max(originalParts.length, replacementParts.length));
    }

    return 0.0;
  }

  /**
   * Check if URL is accessible via HTTP request
   */
  async checkURLAccessibility(url) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(url, {
        method: 'HEAD', // Use HEAD to avoid downloading content
        signal: controller.signal,
        headers: {
          'User-Agent': 'URL-Fixer/1.0 (+https://url-fixer.app)'
        }
      });

      clearTimeout(timeoutId);

      const accessible = response.ok;
      const score = accessible ? 1.0 : 0.0;

      return {
        accessible,
        score,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      };

    } catch (error) {
      return {
        accessible: false,
        score: 0.0,
        error: error.message
      };
    }
  }

  /**
   * Check content relevance by analyzing page content
   */
  async checkContentRelevance(url, searchTerms, originalUrlInfo) {
    try {
      // Scrape and analyze content
      const contentData = await this.scrapePageContent(url);
      if (!contentData) {
        return { score: 0.0, reason: 'Failed to scrape content' };
      }

      // Find keyword matches
      const matchResult = this.findKeywordMatches(contentData, searchTerms, originalUrlInfo);

      // Calculate relevance score based on matches
      const baseScore = matchResult.confidence;

      // Bonus for high-quality content indicators
      let bonusScore = 0;
      if (contentData.metadata) {
        if (contentData.metadata.hasMainContent) bonusScore += 0.1;
        if (contentData.metadata.headingCount > 0) bonusScore += 0.05;
        if (contentData.title && contentData.title.length > 10) bonusScore += 0.05;
      }

      const finalScore = Math.min(1.0, baseScore + bonusScore);

      return {
        score: finalScore,
        matchResult,
        contentMetadata: contentData.metadata,
        hasTitle: !!contentData.title,
        hasHeadings: contentData.headings && contentData.headings.length > 0
      };

    } catch (error) {
      return {
        score: 0.0,
        reason: 'Content analysis failed',
        error: error.message
      };
    }
  }

  /**
   * Update enhanced search configuration
   */
  updateEnhancedSearchConfig(config) {
    this.enhancedSearchConfig = {
      ...this.enhancedSearchConfig,
      ...config
    };
    this.logger.info('Enhanced search configuration updated:', this.enhancedSearchConfig);
  }

  /**
   * Get search service statistics
   */
  getSearchStats() {
    return {
      endpoint: this.searchEndpoint,
      maxResults: this.maxResults,
      timeout: this.searchTimeout,
      rateLimit: this.rateLimitDelay,
      enhancedSearchConfig: this.enhancedSearchConfig
    };
  }
}
