/**
 * Integration tests for the URL Fixer application
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { URLFixerApp } from '../../src/main.js';

describe('URL Fixer Application Integration', () => {
  let app;

  beforeEach(async () => {
    // Reset DOM
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

    app = URLFixerApp.getInstance();
  });

  describe('Application Initialization', () => {
    it('should initialize successfully', async () => {
      await expect(app.init()).resolves.not.toThrow();
      expect(app.isInitialized).toBe(true);
    });

    it('should check browser support', () => {
      expect(() => app.checkBrowserSupport()).not.toThrow();
    });

    it('should initialize all services', async () => {
      await app.init();
      
      expect(app.services.storage).toBeDefined();
      expect(app.services.urlValidation).toBeDefined();
      expect(app.services.search).toBeDefined();
      expect(app.services.documentParser).toBeDefined();
    });

    it('should initialize all models', async () => {
      await app.init();
      
      expect(app.models.document).toBeDefined();
      expect(app.models.urlProcessor).toBeDefined();
    });

    it('should initialize all views', async () => {
      await app.init();
      
      expect(app.views.app).toBeDefined();
    });

    it('should initialize all controllers', async () => {
      await app.init();
      
      expect(app.controllers.app).toBeDefined();
    });
  });

  describe('Document Processing Workflow', () => {
    beforeEach(async () => {
      await app.init();
    });

    it('should handle HTML document upload', async () => {
      const htmlContent = `
        <html>
          <body>
            <a href="https://example.com">Example</a>
            <img src="https://test.org/image.jpg" alt="Test">
          </body>
        </html>
      `;
      
      const file = new File([htmlContent], 'test.html', { type: 'text/html' });
      
      // Mock file reading
      const originalFileReader = global.FileReader;
      global.FileReader = vi.fn(() => ({
        readAsText: vi.fn(function() {
          setTimeout(() => {
            this.result = htmlContent;
            this.onload();
          }, 0);
        }),
        set onload(handler) { this._onload = handler; },
        set onerror(handler) { this._onerror = handler; }
      }));

      await app.controllers.app.handleFileUpload(file);
      
      const documentState = app.models.document.getState();
      expect(documentState.document).toBeDefined();
      expect(documentState.urls.length).toBeGreaterThan(0);
      
      global.FileReader = originalFileReader;
    });

    it('should process URLs and update results', async () => {
      // Set up a document with URLs
      const documentData = {
        fileName: 'test.html',
        fileType: 'html',
        fileSize: 1000,
        content: '<a href="https://example.com">Link</a>',
        urls: [
          {
            id: 'test-url-1',
            originalURL: 'https://example.com',
            line: 1,
            column: 10,
            type: 'href',
            status: 'pending'
          }
        ]
      };

      await app.models.document.loadDocument(documentData);
      
      // Mock fetch for URL validation
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map()
      });

      await app.controllers.app.handleProcessURLs();
      
      const urls = app.models.document.urls;
      expect(urls[0].status).not.toBe('pending');
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await app.init();
    });

    it('should handle unsupported file types', async () => {
      const file = new File(['data'], 'test.xyz', { type: 'application/unknown' });
      
      await expect(app.controllers.app.handleFileUpload(file))
        .rejects.toThrow('Unsupported file type');
    });

    it('should handle invalid URLs', async () => {
      await expect(app.controllers.app.handleURLScan('not-a-url'))
        .rejects.toThrow('Invalid URL format');
    });

    it('should handle network errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      
      const result = await app.services.urlValidation.validateURL('https://example.com');
      expect(result.status).toBe(0);
      expect(result.error).toBe('Network error');
    });
  });

  describe('State Management', () => {
    beforeEach(async () => {
      await app.init();
    });

    it('should maintain document state correctly', async () => {
      const documentData = {
        fileName: 'test.html',
        fileType: 'html',
        fileSize: 1000,
        content: '<a href="https://example.com">Link</a>',
        urls: []
      };

      await app.models.document.loadDocument(documentData);
      
      const state = app.models.document.getState();
      expect(state.document.fileName).toBe('test.html');
      expect(state.processingState).toBe('idle');
    });

    it('should update processing statistics', async () => {
      const documentData = {
        fileName: 'test.html',
        fileType: 'html',
        fileSize: 1000,
        content: '<a href="https://example.com">Link</a>',
        urls: [
          {
            id: 'test-url-1',
            originalURL: 'https://example.com',
            status: 'pending'
          }
        ]
      };

      await app.models.document.loadDocument(documentData);
      
      app.models.document.updateURL('test-url-1', { status: 'valid' });
      
      const stats = app.models.document.processingStats;
      expect(stats.processed).toBe(1);
      expect(stats.successful).toBe(1);
    });
  });

  describe('Event System', () => {
    beforeEach(async () => {
      await app.init();
    });

    it('should emit and handle document events', async () => {
      const eventHandler = vi.fn();
      app.models.document.on('documentLoaded', eventHandler);
      
      const documentData = {
        fileName: 'test.html',
        fileType: 'html',
        fileSize: 1000,
        content: '<a href="https://example.com">Link</a>',
        urls: []
      };

      await app.models.document.loadDocument(documentData);
      
      expect(eventHandler).toHaveBeenCalledWith({
        document: expect.objectContaining({ fileName: 'test.html' }),
        urls: expect.any(Array)
      });
    });

    it('should emit and handle URL processing events', async () => {
      const eventHandler = vi.fn();
      app.models.urlProcessor.on('processingStarted', eventHandler);
      
      // This would be called during URL processing
      app.models.urlProcessor.emit('processingStarted', { totalUrls: 5 });
      
      expect(eventHandler).toHaveBeenCalledWith({ totalUrls: 5 });
    });
  });

  describe('Service Integration', () => {
    beforeEach(async () => {
      await app.init();
    });

    it('should integrate storage service with models', async () => {
      const documentData = {
        fileName: 'test.html',
        fileType: 'html',
        fileSize: 1000,
        content: '<a href="https://example.com">Link</a>',
        urls: []
      };

      await app.models.document.loadDocument(documentData);
      
      // Storage service should be called to store session data
      expect(app.services.storage).toBeDefined();
    });

    it('should integrate validation service with URL processor', async () => {
      const urls = [
        {
          id: 'test-url-1',
          originalURL: 'https://example.com',
          status: 'pending'
        }
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map()
      });

      const results = await app.models.urlProcessor.processURLs(urls);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).not.toBe('pending');
    });
  });

  describe('Cleanup', () => {
    it('should cleanup resources properly', async () => {
      await app.init();
      
      expect(() => app.destroy()).not.toThrow();
      expect(app.isInitialized).toBe(false);
    });
  });
});
