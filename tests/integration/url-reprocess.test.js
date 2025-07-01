/**
 * Integration tests for URL re-processing functionality
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
    <div id="error-toast">
      <div class="toast-icon"></div>
      <div id="toast-message"></div>
    </div>
  `;
};

describe('URL Re-processing Integration Tests', () => {
  let app;

  beforeEach(async () => {
    // Reset DOM
    mockDOM();
    
    // Create fresh app instance
    app = URLFixerApp.getInstance();
    await app.init();
  });

  afterEach(() => {
    if (app) {
      app.destroy();
    }
    // Reset the singleton instance to ensure clean state between tests
    URLFixerApp.instance = null;
    vi.clearAllMocks();
  });

  describe('Re-process button functionality', () => {
    it('should display re-process button when alternatives are available', async () => {
      // Mock URL with alternatives
      const testURL = {
        id: 'test-url-1',
        originalURL: 'https://example.com/broken-link',
        status: 'replacement-found',
        replacementURL: 'https://example.com/alternative-1',
        replacementConfidence: 0.8,
        alternatives: [
          {
            replacementURL: 'https://example.com/alternative-2',
            confidence: 0.7,
            source: 'enhanced-serp'
          },
          {
            replacementURL: 'https://example.com/alternative-3',
            confidence: 0.6,
            source: 'enhanced-serp'
          }
        ],
        totalAlternatives: 2,
        currentAlternativeIndex: 0
      };

      // Add URL to document model
      app.models.document.urls = [testURL];
      
      // Trigger view update
      app.views.app.displayDocument(null, [testURL]);

      // Check that re-process button is present
      const tableContainer = document.getElementById('table-container');
      const reprocessBtn = tableContainer.querySelector('.reprocess-btn');
      
      expect(reprocessBtn).toBeTruthy();
      expect(reprocessBtn.getAttribute('data-url-id')).toBe('test-url-1');
      expect(reprocessBtn.title).toBe('Get next best alternative URL');
    });

    it('should not display re-process button when no alternatives are available', async () => {
      // Mock URL without alternatives
      const testURL = {
        id: 'test-url-2',
        originalURL: 'https://example.com/broken-link',
        status: 'replacement-found',
        replacementURL: 'https://example.com/only-alternative',
        replacementConfidence: 0.8,
        totalAlternatives: 0
      };

      // Add URL to document model
      app.models.document.urls = [testURL];
      
      // Trigger view update
      app.views.app.displayDocument(null, [testURL]);

      // Check that re-process button is not present
      const tableContainer = document.getElementById('table-container');
      const reprocessBtn = tableContainer.querySelector('.reprocess-btn');
      
      expect(reprocessBtn).toBeFalsy();
    });

    it('should cycle through alternatives when re-process button is clicked', async () => {
      // Mock URL with alternatives
      const testURL = {
        id: 'test-url-3',
        originalURL: 'https://example.com/broken-link',
        status: 'replacement-found',
        statusCode: 404,
        originalStatusCode: 404,
        replacementURL: 'https://example.com/alternative-1',
        replacementConfidence: 0.8,
        alternatives: [
          {
            replacementURL: 'https://example.com/alternative-1',
            confidence: 0.8,
            source: 'enhanced-serp'
          },
          {
            replacementURL: 'https://example.com/alternative-2',
            confidence: 0.7,
            source: 'enhanced-serp'
          },
          {
            replacementURL: 'https://example.com/alternative-3',
            confidence: 0.6,
            source: 'enhanced-serp'
          }
        ],
        totalAlternatives: 3,
        currentAlternativeIndex: 0,
        line: 1,
        type: 'link',
        fileName: 'broken-link'
      };

      // Add URL to document model
      app.models.document.urls = [testURL];

      // Test the controller method directly to verify core functionality
      await app.controllers.app.handleReprocessURL('test-url-3');

      // Check that the URL was updated with the next alternative
      const updatedURL = app.models.document.getURL('test-url-3');
      expect(updatedURL.replacementURL).toBe('https://example.com/alternative-2');
      expect(updatedURL.currentAlternativeIndex).toBe(1);
    });

    it('should show notification when no more alternatives are available', async () => {
      // Mock URL with no remaining alternatives
      const testURL = {
        id: 'test-url-4',
        originalURL: 'https://example.com/broken-link',
        status: 'replacement-found',
        replacementURL: 'https://example.com/alternative-3',
        replacementConfidence: 0.6,
        alternatives: [],
        totalAlternatives: 2,
        currentAlternativeIndex: 2
      };

      // Add URL to document model
      app.models.document.urls = [testURL];
      
      // Mock the showNotification method
      const showNotificationSpy = vi.spyOn(app.views.app, 'showNotification');
      
      // Trigger re-process
      await app.controllers.app.handleReprocessURL('test-url-4');

      // Check that notification was shown
      expect(showNotificationSpy).toHaveBeenCalledWith('No more alternatives available', 'info');
    });
  });

  describe('SearchService getNextAlternativeURL method', () => {
    it('should return the next alternative URL', () => {
      const url = {
        originalURL: 'https://example.com/broken-link',
        alternatives: [
          { replacementURL: 'https://example.com/alt-1', confidence: 0.8 },
          { replacementURL: 'https://example.com/alt-2', confidence: 0.7 },
          { replacementURL: 'https://example.com/alt-3', confidence: 0.6 }
        ],
        currentAlternativeIndex: 0,
        totalAlternatives: 3
      };

      const nextAlternative = app.services.search.getNextAlternativeURL(url);
      
      expect(nextAlternative).toBeTruthy();
      expect(nextAlternative.replacementURL).toBe('https://example.com/alt-2');
      expect(nextAlternative.currentAlternativeIndex).toBe(1);
    });

    it('should return null when no alternatives are available', () => {
      const url = {
        originalURL: 'https://example.com/broken-link',
        alternatives: [],
        currentAlternativeIndex: 0,
        totalAlternatives: 0
      };

      const nextAlternative = app.services.search.getNextAlternativeURL(url);
      
      expect(nextAlternative).toBeNull();
    });

    it('should return null when at the end of alternatives', () => {
      const url = {
        originalURL: 'https://example.com/broken-link',
        alternatives: [
          { replacementURL: 'https://example.com/alt-1', confidence: 0.8 },
          { replacementURL: 'https://example.com/alt-2', confidence: 0.7 }
        ],
        currentAlternativeIndex: 1,
        totalAlternatives: 2
      };

      const nextAlternative = app.services.search.getNextAlternativeURL(url);
      
      expect(nextAlternative).toBeNull();
    });
  });
});
