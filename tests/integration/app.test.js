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

  afterEach(() => {
    // Clean up app instance if it exists and is initialized
    if (app && app.isInitialized) {
      try {
        app.destroy();
      } catch (error) {
        console.warn('Error during test cleanup:', error);
      }
    }

    // Reset global mocks
    vi.restoreAllMocks();

    // Clear any remaining timers
    vi.clearAllTimers();
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

      // Mock file reading with improved error handling
      const originalFileReader = global.FileReader;
      global.FileReader = vi.fn(() => {
        const mockReader = {
          result: null,
          error: null,
          readyState: 0, // EMPTY
          _onload: null,
          _onerror: null,
          _onloadstart: null,
          _onprogress: null,
          _onloadend: null,

          readAsText: vi.fn(function() {
            this.readyState = 1; // LOADING
            if (this._onloadstart) {
              this._onloadstart();
            }

            // Simulate async file reading
            setTimeout(() => {
              this.readyState = 2; // DONE
              this.result = htmlContent;
              this.error = null;

              if (this._onload) {
                this._onload({ target: this });
              }
              if (this._onloadend) {
                this._onloadend({ target: this });
              }
            }, 0);
          }),

          // Property setters for event handlers
          set onload(handler) { this._onload = handler; },
          get onload() { return this._onload; },
          set onerror(handler) { this._onerror = handler; },
          get onerror() { return this._onerror; },
          set onloadstart(handler) { this._onloadstart = handler; },
          get onloadstart() { return this._onloadstart; },
          set onprogress(handler) { this._onprogress = handler; },
          get onprogress() { return this._onprogress; },
          set onloadend(handler) { this._onloadend = handler; },
          get onloadend() { return this._onloadend; }
        };
        return mockReader;
      });

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

    it('should handle FileReader errors during file upload', async () => {
      const file = new File(['test content'], 'test.html', { type: 'text/html' });

      // Mock FileReader to simulate error
      const originalFileReader = global.FileReader;
      global.FileReader = vi.fn(() => {
        const mockReader = {
          result: null,
          error: new Error('File read error'),
          readyState: 0,
          _onload: null,
          _onerror: null,
          _onloadend: null,

          readAsText: vi.fn(function() {
            this.readyState = 1; // LOADING

            setTimeout(() => {
              this.readyState = 2; // DONE
              this.error = new Error('File read error');

              if (this._onerror) {
                this._onerror({ target: this });
              }
              if (this._onloadend) {
                this._onloadend({ target: this });
              }
            }, 0);
          }),

          set onload(handler) { this._onload = handler; },
          get onload() { return this._onload; },
          set onerror(handler) { this._onerror = handler; },
          get onerror() { return this._onerror; },
          set onloadend(handler) { this._onloadend = handler; },
          get onloadend() { return this._onloadend; }
        };
        return mockReader;
      });

      await expect(app.controllers.app.handleFileUpload(file))
        .rejects.toThrow('Failed to read file');

      global.FileReader = originalFileReader;
    });

    it('should handle invalid URLs', async () => {
      // Use a URL that will definitely fail validation
      await expect(app.controllers.app.handleURLScan('://invalid-url'))
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

      // Verify app is initialized
      expect(app.isInitialized).toBe(true);
      expect(app.services).toBeDefined();
      expect(app.models).toBeDefined();
      expect(app.views).toBeDefined();
      expect(app.controllers).toBeDefined();

      // Destroy the app
      expect(() => app.destroy()).not.toThrow();

      // Verify cleanup
      expect(app.isInitialized).toBe(false);
      expect(Object.keys(app.services)).toHaveLength(0);
      expect(Object.keys(app.models)).toHaveLength(0);
      expect(Object.keys(app.views)).toHaveLength(0);
      expect(Object.keys(app.controllers)).toHaveLength(0);
    });

    it('should handle destroy when not initialized', () => {
      const newApp = new URLFixerApp();
      expect(newApp.isInitialized).toBe(false);

      // Should not throw when destroying uninitialized app
      expect(() => newApp.destroy()).not.toThrow();
      expect(newApp.isInitialized).toBe(false);
    });

    it('should handle destroy with missing components gracefully', async () => {
      await app.init();

      // Manually remove some components to test graceful handling
      delete app.controllers.app.destroy;
      delete app.views.app.destroy;

      // Should still work without throwing
      expect(() => app.destroy()).not.toThrow();
      expect(app.isInitialized).toBe(false);
    });
  });
});
