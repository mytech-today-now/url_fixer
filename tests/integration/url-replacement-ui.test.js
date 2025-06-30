/**
 * Integration Tests for URL Replacement UI Functionality
 * Tests the complete flow from URL processing to UI display and download
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { URLFixerApp } from '../../src/main.js';

// Mock DOM environment
const mockDOM = () => {
  document.body.innerHTML = `
    <div id="file-input"></div>
    <div id="upload-area"></div>
    <div id="url-input"></div>
    <div id="scan-url-btn"></div>
    <div id="process-btn"></div>
    <div id="download-btn"></div>
    <div id="clear-btn"></div>
    <div id="table-container"></div>
    <div id="progress-container"></div>
    <div id="progress-fill"></div>
    <div id="progress-text"></div>
    <div id="readme-btn"></div>
    <div id="readme-modal"></div>
    <div id="readme-close"></div>
    <div id="readme-content"></div>
    <div id="error-toast"></div>
    <div id="toast-message"></div>
  `;
};

describe('URL Replacement UI Integration Tests', () => {
  let app;

  beforeEach(async () => {
    mockDOM();
    
    // Mock fetch globally
    global.fetch = vi.fn();
    global.DOMParser = vi.fn(() => ({
      parseFromString: vi.fn(() => ({
        querySelector: vi.fn(),
        querySelectorAll: vi.fn(() => [])
      }))
    }));

    app = URLFixerApp.getInstance();
    await app.init();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clear the app instance
    if (app && app.models) {
      app.models.document.clear();
    }
  });

  describe('Replacement URL Display', () => {
    it('should display replacement URL in input field when found', async () => {
      // Create test document with broken URL
      const documentData = {
        fileName: 'test.html',
        fileType: 'html',
        fileSize: 1000,
        content: '<a href="https://example.com/broken-link">Broken Link</a>',
        urls: [
          {
            id: 'test-url-1',
            originalURL: 'https://example.com/broken-link',
            line: 1,
            column: 10,
            type: 'href',
            status: 'pending'
          }
        ]
      };

      await app.models.document.loadDocument(documentData);

      // Mock URL validation to return 404 first, then 200 for replacement
      app.services.urlValidation.validateURL = vi.fn()
        .mockResolvedValueOnce({
          url: 'https://example.com/broken-link',
          status: 404,
          statusText: 'Not Found',
          responseTime: 1000,
          headers: {},
          fromCache: false,
          timestamp: new Date().toISOString()
        })
        .mockResolvedValueOnce({
          url: 'https://example.com/fixed-link',
          status: 200,
          statusText: 'OK',
          responseTime: 500,
          headers: { 'content-type': 'text/html' },
          fromCache: false,
          timestamp: new Date().toISOString()
        });

      // Mock search service to find replacement
      app.services.search.findReplacementURL = vi.fn().mockResolvedValue({
        originalURL: 'https://example.com/broken-link',
        replacementURL: 'https://example.com/fixed-link',
        confidence: 0.85,
        source: 'enhanced-serp',
        searchQuery: 'site:example.com broken link',
        validated: true,
        validationStatus: 200,
        validationTime: 500
      });

      // Process the URLs
      await app.controllers.app.handleProcessURLs();

      // Check that the URL was updated with replacement data
      const urls = app.models.document.urls;
      expect(urls[0].status).toBe('replacement-found');
      expect(urls[0].replacementURL).toBe('https://example.com/fixed-link');
      expect(urls[0].replacementConfidence).toBe(0.85);

      // Check that the table displays the replacement correctly
      const tableContainer = document.getElementById('table-container');
      const replacementInput = tableContainer.querySelector('.replacement-input');
      expect(replacementInput).toBeTruthy();
      expect(replacementInput.value).toBe('https://example.com/fixed-link');
    });

    it('should allow editing replacement URL in input field', async () => {
      // Set up URL with replacement found
      const documentData = {
        fileName: 'test.html',
        fileType: 'html',
        fileSize: 1000,
        content: '<a href="https://example.com/broken-link">Broken Link</a>',
        urls: [
          {
            id: 'test-url-1',
            originalURL: 'https://example.com/broken-link',
            line: 1,
            column: 10,
            type: 'href',
            status: 'replacement-found',
            replacementURL: 'https://example.com/suggested-fix',
            replacementConfidence: 0.8
          }
        ]
      };

      await app.models.document.loadDocument(documentData);

      // Get the input field and simulate editing
      const tableContainer = document.getElementById('table-container');
      const replacementInput = tableContainer.querySelector('.replacement-input');
      
      expect(replacementInput.value).toBe('https://example.com/suggested-fix');

      // Simulate user editing the input
      replacementInput.value = 'https://example.com/manual-fix';
      replacementInput.dispatchEvent(new Event('blur'));

      // Check that the URL was updated
      const urls = app.models.document.urls;
      expect(urls[0].newURL).toBe('https://example.com/manual-fix');
    });
  });

  describe('Download with Replacement URLs', () => {
    it('should include replacement URLs in downloaded document', async () => {
      // Set up document with replacement URLs
      const documentData = {
        fileName: 'test.html',
        fileType: 'html',
        fileSize: 1000,
        content: '<a href="https://example.com/broken1">Link 1</a>\n<a href="https://example.com/broken2">Link 2</a>',
        urls: [
          {
            id: 'test-url-1',
            originalURL: 'https://example.com/broken1',
            line: 1,
            column: 10,
            type: 'href',
            status: 'replacement-found',
            replacementURL: 'https://example.com/fixed1',
            replacementConfidence: 0.9
          },
          {
            id: 'test-url-2',
            originalURL: 'https://example.com/broken2',
            line: 2,
            column: 10,
            type: 'href',
            status: 'fixed',
            newURL: 'https://example.com/manual-fix2'
          }
        ]
      };

      await app.models.document.loadDocument(documentData);

      // Generate fixed document
      const fixedDocument = app.models.document.generateFixedDocument();

      // Check that both replacement URLs are included
      expect(fixedDocument.content).toContain('https://example.com/fixed1');
      expect(fixedDocument.content).toContain('https://example.com/manual-fix2');
      expect(fixedDocument.content).not.toContain('https://example.com/broken1');
      expect(fixedDocument.content).not.toContain('https://example.com/broken2');

      // Check replacement metadata
      expect(fixedDocument.replacements).toHaveLength(2);
      // The order might be different due to sorting, so check both possibilities
      const sources = fixedDocument.replacements.map(r => r.source);
      expect(sources).toContain('replacement-suggestion');
      expect(sources).toContain('manual');
    });

    it('should handle mixed URL states in download', async () => {
      // Set up document with various URL states
      const documentData = {
        fileName: 'test.html',
        fileType: 'html',
        fileSize: 1000,
        content: '<a href="https://example.com/valid">Valid</a>\n<a href="https://example.com/broken">Broken</a>\n<a href="https://example.com/replaced">Replaced</a>',
        urls: [
          {
            id: 'test-url-1',
            originalURL: 'https://example.com/valid',
            line: 1,
            column: 10,
            type: 'href',
            status: 'valid'
          },
          {
            id: 'test-url-2',
            originalURL: 'https://example.com/broken',
            line: 2,
            column: 10,
            type: 'href',
            status: 'invalid'
          },
          {
            id: 'test-url-3',
            originalURL: 'https://example.com/replaced',
            line: 3,
            column: 10,
            type: 'href',
            status: 'replacement-found',
            replacementURL: 'https://example.com/new-location'
          }
        ]
      };

      await app.models.document.loadDocument(documentData);

      // Generate fixed document
      const fixedDocument = app.models.document.generateFixedDocument();

      // Check that only the replacement URL is changed
      expect(fixedDocument.content).toContain('https://example.com/valid'); // unchanged
      expect(fixedDocument.content).toContain('https://example.com/broken'); // unchanged
      expect(fixedDocument.content).toContain('https://example.com/new-location'); // replaced
      expect(fixedDocument.content).not.toContain('https://example.com/replaced');

      // Check that only one replacement was made
      expect(fixedDocument.replacements).toHaveLength(1);
      expect(fixedDocument.replacements[0].originalURL).toBe('https://example.com/replaced');
      expect(fixedDocument.replacements[0].newURL).toBe('https://example.com/new-location');
    });
  });

  describe('Accept/Reject Replacement Actions', () => {
    it('should accept replacement when accept button is clicked', async () => {
      // Set up URL with replacement found
      const documentData = {
        fileName: 'test.html',
        fileType: 'html',
        fileSize: 1000,
        content: '<a href="https://example.com/broken-link">Broken Link</a>',
        urls: [
          {
            id: 'test-url-1',
            originalURL: 'https://example.com/broken-link',
            line: 1,
            column: 10,
            type: 'href',
            status: 'replacement-found',
            replacementURL: 'https://example.com/suggested-fix',
            replacementConfidence: 0.8
          }
        ]
      };

      await app.models.document.loadDocument(documentData);

      // Find and click the accept button
      const tableContainer = document.getElementById('table-container');
      const acceptBtn = tableContainer.querySelector('.btn-accept');
      expect(acceptBtn).toBeTruthy();

      acceptBtn.click();

      // Check that the URL was updated to fixed status
      const urls = app.models.document.urls;
      expect(urls[0].status).toBe('fixed');
      expect(urls[0].newURL).toBe('https://example.com/suggested-fix');
    });

    it('should reject replacement when reject button is clicked', async () => {
      // Set up URL with replacement found
      const documentData = {
        fileName: 'test.html',
        fileType: 'html',
        fileSize: 1000,
        content: '<a href="https://example.com/broken-link">Broken Link</a>',
        urls: [
          {
            id: 'test-url-1',
            originalURL: 'https://example.com/broken-link',
            line: 1,
            column: 10,
            type: 'href',
            status: 'replacement-found',
            replacementURL: 'https://example.com/suggested-fix',
            replacementConfidence: 0.8
          }
        ]
      };

      await app.models.document.loadDocument(documentData);

      // Find and click the reject button
      const tableContainer = document.getElementById('table-container');
      const rejectBtn = tableContainer.querySelector('.btn-reject');
      expect(rejectBtn).toBeTruthy();

      rejectBtn.click();

      // Check that the replacement was removed
      const urls = app.models.document.urls;
      expect(urls[0].replacementFound).toBe(false);
      expect(urls[0].replacementURL).toBe(null);
    });
  });
});
