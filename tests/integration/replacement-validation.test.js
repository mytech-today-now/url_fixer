import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { AppController } from '../../src/controllers/AppController.js';
import { AppView } from '../../src/views/AppView.js';
import { DocumentModel } from '../../src/models/DocumentModel.js';
import { URLProcessorModel } from '../../src/models/URLProcessorModel.js';
import { URLValidationService } from '../../src/services/URLValidationService.js';
import { SearchService } from '../../src/services/SearchService.js';
import { StorageService } from '../../src/services/StorageService.js';
import { Logger } from '../../src/utils/Logger.js';
import { ErrorHandler } from '../../src/utils/ErrorHandler.js';

describe('Replacement URL Validation', () => {
  let dom;
  let app;
  let mockServices;

  beforeEach(async () => {
    // Set up DOM
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head><title>Test</title></head>
        <body>
          <div id="upload-area"></div>
          <input id="file-input" type="file" />
          <input id="url-input" type="url" />
          <button id="scan-url-btn"></button>
          <button id="process-btn"></button>
          <button id="download-btn"></button>
          <button id="clear-btn"></button>
          <div id="table-container"></div>
          <div id="progress-container"></div>
          <div id="progress-fill"></div>
          <div id="progress-text"></div>
          <button id="readme-btn"></button>
          <div id="readme-modal"></div>
          <div id="readme-content"></div>
          <button id="readme-close"></button>
          <div id="error-toast"></div>
          <div id="toast-message"></div>
        </body>
      </html>
    `, { url: 'http://localhost:3000' });

    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Event = dom.window.Event;
    global.CustomEvent = dom.window.CustomEvent;
    global.fetch = vi.fn();

    // Mock services
    mockServices = {
      urlValidation: {
        validateURL: vi.fn(),
        isSuccessStatus: vi.fn()
      },
      search: {
        findReplacementURL: vi.fn(),
        validateReplacementURL: vi.fn(),
        parseURL: vi.fn()
      },
      storage: {
        getCachedURLResult: vi.fn(),
        cacheURLResult: vi.fn()
      }
    };

    // Create app instance
    const logger = new Logger('test');
    const errorHandler = new ErrorHandler(logger);

    // Mock error handler methods to avoid DOM dependencies
    errorHandler.showToast = vi.fn();
    errorHandler.handleError = vi.fn();
    
    const models = {
      document: new DocumentModel(logger),
      urlProcessor: new URLProcessorModel(
        mockServices.urlValidation,
        mockServices.search,
        mockServices.storage,
        logger
      )
    };

    const views = {
      app: new AppView(logger, errorHandler)
    };

    // Mock the table instance to avoid DOM initialization issues
    views.app.tableInstance = {
      updateURL: vi.fn(),
      setData: vi.fn(),
      render: vi.fn()
    };

    // Mock the view's init method
    views.app.init = vi.fn().mockResolvedValue();

    app = new AppController(models, views, mockServices, logger, errorHandler);

    // Initialize the app to set up event listeners
    await app.init();
  });

  afterEach(() => {
    dom.window.close();
  });

  describe('validateReplacementURL method', () => {
    it('should validate replacement URL with HTTP and keyword validation', async () => {
      // Setup test data
      const urlData = {
        id: 'test-url-1',
        originalURL: 'https://example.com/old-page.html',
        status: 'invalid',
        statusCode: 404
      };

      app.models.document.urls = [urlData];

      // Mock the URLProcessorModel validation method
      const mockValidationResult = {
        originalURL: 'https://example.com/old-page.html',
        replacementURL: 'https://example.com/new-page.html',
        httpValidation: {
          status: 200,
          statusText: 'OK',
          responseTime: 500,
          headers: { 'content-type': 'text/html' },
          timestamp: new Date().toISOString(),
          isValid: true
        },
        keywordValidation: {
          isValid: true,
          confidence: 0.8,
          domainRelevance: 0.9,
          contentRelevance: { score: 0.7 },
          accessibilityResult: { score: 0.8 }
        },
        overallValid: true,
        validatedAt: new Date().toISOString()
      };

      app.models.urlProcessor.validateReplacementURL = vi.fn().mockResolvedValue(mockValidationResult);

      // Execute validation
      await app.validateReplacementURL('test-url-1', 'https://example.com/new-page.html');

      // Verify validation was called
      expect(app.models.urlProcessor.validateReplacementURL).toHaveBeenCalledWith(
        'https://example.com/old-page.html',
        'https://example.com/new-page.html',
        expect.any(Object)
      );

      // Verify URL was updated with validation results
      const updatedUrl = app.models.document.urls.find(url => url.id === 'test-url-1');
      expect(updatedUrl.replacementValidationStatus).toBe('valid');
      expect(updatedUrl.status).toBe('fixed');
    });

    it('should handle HTTP validation failure', async () => {
      // Setup test data
      const urlData = {
        id: 'test-url-2',
        originalURL: 'https://example.com/old-page.html',
        status: 'invalid',
        statusCode: 404
      };

      app.models.document.urls = [urlData];

      // Mock failed validation result
      const mockValidationResult = {
        originalURL: 'https://example.com/old-page.html',
        replacementURL: 'https://example.com/broken-page.html',
        httpValidation: {
          status: 404,
          statusText: 'Not Found',
          responseTime: 1000,
          headers: {},
          timestamp: new Date().toISOString(),
          isValid: false
        },
        keywordValidation: null,
        overallValid: false,
        validatedAt: new Date().toISOString()
      };

      app.models.urlProcessor.validateReplacementURL = vi.fn().mockResolvedValue(mockValidationResult);

      // Execute validation
      await app.validateReplacementURL('test-url-2', 'https://example.com/broken-page.html');

      // Verify URL was updated with failure status
      const updatedUrl = app.models.document.urls.find(url => url.id === 'test-url-2');
      expect(updatedUrl.replacementValidationStatus).toBe('invalid');
      expect(updatedUrl.status).toBe('replacement-invalid');
      expect(updatedUrl.replacementValidationError).toContain('HTTP Error: 404');
    });

    it('should handle keyword validation failure', async () => {
      // Setup test data
      const urlData = {
        id: 'test-url-3',
        originalURL: 'https://example.com/old-page.html',
        status: 'invalid',
        statusCode: 404
      };

      app.models.document.urls = [urlData];

      // Mock validation result with keyword failure
      const mockValidationResult = {
        originalURL: 'https://example.com/old-page.html',
        replacementURL: 'https://different-site.com/page.html',
        httpValidation: {
          status: 200,
          statusText: 'OK',
          responseTime: 500,
          headers: { 'content-type': 'text/html' },
          timestamp: new Date().toISOString(),
          isValid: true
        },
        keywordValidation: {
          isValid: false,
          reason: 'Domain not relevant enough',
          confidence: 0.2,
          domainRelevance: 0.1
        },
        overallValid: false,
        validatedAt: new Date().toISOString()
      };

      app.models.urlProcessor.validateReplacementURL = vi.fn().mockResolvedValue(mockValidationResult);

      // Execute validation
      await app.validateReplacementURL('test-url-3', 'https://different-site.com/page.html');

      // Verify URL was updated with failure status
      const updatedUrl = app.models.document.urls.find(url => url.id === 'test-url-3');
      expect(updatedUrl.replacementValidationStatus).toBe('invalid');
      expect(updatedUrl.status).toBe('replacement-invalid');
    });
  });

  describe('URL acceptance with validation', () => {
    it('should validate URL when replacement is accepted', async () => {
      // Setup test data
      const urlData = {
        id: 'test-url-4',
        originalURL: 'https://example.com/old-page.html',
        replacementURL: 'https://example.com/new-page.html',
        status: 'replacement-found'
      };

      app.models.document.urls = [urlData];

      // Mock validation
      const validateSpy = vi.spyOn(app, 'validateReplacementURL').mockResolvedValue();

      // Simulate accepting replacement
      app.views.app.emit('urlAcceptReplacement', {
        urlId: 'test-url-4',
        replacementURL: 'https://example.com/new-page.html'
      });

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0));

      // Verify validation was triggered
      expect(validateSpy).toHaveBeenCalledWith('test-url-4', 'https://example.com/new-page.html');

      // Verify URL status was updated
      const updatedUrl = app.models.document.urls.find(url => url.id === 'test-url-4');
      expect(updatedUrl.status).toBe('fixed');
      expect(updatedUrl.newURL).toBe('https://example.com/new-page.html');
    });

    it('should validate URL when manually edited', async () => {
      // Setup test data
      const urlData = {
        id: 'test-url-5',
        originalURL: 'https://example.com/old-page.html',
        status: 'invalid'
      };

      app.models.document.urls = [urlData];

      // Mock validation
      const validateSpy = vi.spyOn(app, 'validateReplacementURL').mockResolvedValue();

      // Simulate manual URL edit
      app.views.app.emit('urlEdited', {
        urlId: 'test-url-5',
        newURL: 'https://example.com/manually-entered.html'
      });

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0));

      // Verify validation was triggered
      expect(validateSpy).toHaveBeenCalledWith('test-url-5', 'https://example.com/manually-entered.html');

      // Verify URL was updated
      const updatedUrl = app.models.document.urls.find(url => url.id === 'test-url-5');
      expect(updatedUrl.newURL).toBe('https://example.com/manually-entered.html');
    });
  });
});
