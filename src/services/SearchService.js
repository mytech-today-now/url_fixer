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
  }

  /**
   * Find replacement URL for a broken link
   */
  async findReplacementURL(originalURL, options = {}) {
    const {
      maxResults = this.maxResults,
      timeout = this.searchTimeout,
      strictDomain = true
    } = options;

    try {
      this.logger.info(`Searching for replacement for: ${originalURL}`);
      
      // Parse the original URL to extract domain and path components
      const urlInfo = this.parseURL(originalURL);
      if (!urlInfo) {
        throw new Error('Invalid URL format');
      }

      // Generate search queries
      const searchQueries = this.generateSearchQueries(urlInfo, strictDomain);
      
      // Try each search query until we find a good replacement
      for (const query of searchQueries) {
        this.logger.debug(`Trying search query: ${query}`);
        
        const searchResults = await this.performSearch(query, maxResults, timeout);
        
        if (searchResults.length > 0) {
          // Validate and score the results
          const validatedResults = await this.validateSearchResults(
            searchResults, 
            urlInfo, 
            strictDomain
          );
          
          if (validatedResults.length > 0) {
            const bestResult = validatedResults[0];
            this.logger.info(`Found replacement: ${bestResult.url}`);
            
            return {
              originalURL,
              replacementURL: bestResult.url,
              confidence: bestResult.confidence,
              source: 'duckduckgo',
              searchQuery: query,
              title: bestResult.title,
              snippet: bestResult.snippet,
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
      .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special characters
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

      const response = await fetch(searchURL.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'URL-Fixer/1.0 (+https://url-fixer.app)'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Search API returned ${response.status}: ${response.statusText}`);
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
   * Get search service statistics
   */
  getSearchStats() {
    return {
      endpoint: this.searchEndpoint,
      maxResults: this.maxResults,
      timeout: this.searchTimeout,
      rateLimit: this.rateLimitDelay
    };
  }
}
