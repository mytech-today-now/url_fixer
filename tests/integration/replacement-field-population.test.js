/**
 * Test for replacement field population feature
 * 
 * This test verifies that when the submit button is pressed,
 * replacement text fields are populated with the appropriate URLs.
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

describe('Replacement Field Population', () => {
  let app;

  beforeEach(async () => {
    mockDOM();
    app = URLFixerApp.getInstance();
    await app.init();
  });

  afterEach(() => {
    if (app) {
      app.destroy?.();
    }
    vi.clearAllMocks();
  });

  it('should populate replacement fields with original URLs when no replacement is found', async () => {
    // Create a document with URLs that will not have replacements
    const documentData = {
      fileName: 'test-document.html',
      content: '<a href="https://httpstat.us/200">Working Link</a>',
      urls: [
        {
          id: 'url-1',
          originalURL: 'https://httpstat.us/200',
          line: 1,
          column: 10,
          type: 'href',
          status: 'pending'
        }
      ]
    };

    // Load the document
    await app.models.document.loadDocument(documentData);

    // Mock the URL processor to simulate processing without replacement
    const mockProcessURL = vi.fn().mockResolvedValue({
      id: 'url-1',
      originalURL: 'https://httpstat.us/200',
      status: 'valid',
      statusCode: 200,
      processedAt: new Date().toISOString()
    });

    app.models.urlProcessor.processURL = mockProcessURL;

    // Process the URLs
    await app.controllers.app.handleProcessURLs();

    // Check that the URL was processed
    const urls = app.models.document.urls;
    expect(urls[0].status).toBe('valid');

    // Check that the table renders the input field with the original URL
    const tableContainer = document.getElementById('table-container');
    const inputField = tableContainer.querySelector('.url-input-field');
    
    expect(inputField).toBeTruthy();
    expect(inputField.value).toBe('https://httpstat.us/200');
  });

  it('should populate replacement fields with replacement URLs when found', async () => {
    // Create a document with URLs that will have replacements
    const documentData = {
      fileName: 'test-document.html',
      content: '<a href="https://httpstat.us/404">Broken Link</a>',
      urls: [
        {
          id: 'url-2',
          originalURL: 'https://httpstat.us/404',
          line: 1,
          column: 10,
          type: 'href',
          status: 'pending'
        }
      ]
    };

    // Load the document
    await app.models.document.loadDocument(documentData);

    // Mock the URL processor to simulate processing with replacement
    const mockProcessURL = vi.fn().mockResolvedValue({
      id: 'url-2',
      originalURL: 'https://httpstat.us/404',
      status: 'replacement-found',
      statusCode: 404,
      replacementURL: 'https://httpstat.us/200',
      replacementConfidence: 0.85,
      processedAt: new Date().toISOString()
    });

    app.models.urlProcessor.processURL = mockProcessURL;

    // Process the URLs
    await app.controllers.app.handleProcessURLs();

    // Check that the URL was processed with replacement
    const urls = app.models.document.urls;
    expect(urls[0].status).toBe('replacement-found');
    expect(urls[0].replacementURL).toBe('https://httpstat.us/200');

    // Check that the table renders the replacement input field with the replacement URL
    const tableContainer = document.getElementById('table-container');
    const inputField = tableContainer.querySelector('.replacement-input');
    
    expect(inputField).toBeTruthy();
    expect(inputField.value).toBe('https://httpstat.us/200');
  });

  it('should not populate fields for pending URLs', async () => {
    // Create a document with pending URLs
    const documentData = {
      fileName: 'test-document.html',
      content: '<a href="https://example.com">Pending Link</a>',
      urls: [
        {
          id: 'url-3',
          originalURL: 'https://example.com',
          line: 1,
          column: 10,
          type: 'href',
          status: 'pending'
        }
      ]
    };

    // Load the document
    await app.models.document.loadDocument(documentData);

    // Check that the table renders empty input field for pending URLs
    const tableContainer = document.getElementById('table-container');
    const inputField = tableContainer.querySelector('.url-input-field');
    
    expect(inputField).toBeTruthy();
    expect(inputField.value).toBe('');
  });

  it('should populate fields correctly for 404 and 403 errors', async () => {
    // Create a document with 404 and 403 URLs
    const documentData = {
      fileName: 'test-document.html',
      content: `
        <a href="https://httpstat.us/404">404 Link</a>
        <a href="https://httpstat.us/403">403 Link</a>
      `,
      urls: [
        {
          id: 'url-404',
          originalURL: 'https://httpstat.us/404',
          line: 2,
          column: 10,
          type: 'href',
          status: 'invalid',
          statusCode: 404
        },
        {
          id: 'url-403',
          originalURL: 'https://httpstat.us/403',
          line: 3,
          column: 10,
          type: 'href',
          status: 'invalid',
          statusCode: 403
        }
      ]
    };

    // Load the document
    await app.models.document.loadDocument(documentData);

    // Check the table rendering
    const tableContainer = document.getElementById('table-container');
    const inputFields = tableContainer.querySelectorAll('.url-input-field');

    expect(inputFields).toHaveLength(2);

    // Both 404 and 403 URLs should have original URL populated in input field
    expect(inputFields[0].value).toBe('https://httpstat.us/404');
    expect(inputFields[1].value).toBe('https://httpstat.us/403');
  });

  it('should handle mixed URL states correctly', async () => {
    // Create a document with mixed URL states
    const documentData = {
      fileName: 'test-document.html',
      content: `
        <a href="https://httpstat.us/200">Working Link</a>
        <a href="https://httpstat.us/404">Broken Link</a>
        <a href="https://example.com/pending">Pending Link</a>
      `,
      urls: [
        {
          id: 'url-1',
          originalURL: 'https://httpstat.us/200',
          line: 2,
          column: 10,
          type: 'href',
          status: 'valid',
          statusCode: 200
        },
        {
          id: 'url-2',
          originalURL: 'https://httpstat.us/404',
          line: 3,
          column: 10,
          type: 'href',
          status: 'replacement-found',
          statusCode: 404,
          replacementURL: 'https://httpstat.us/200',
          replacementConfidence: 0.85
        },
        {
          id: 'url-3',
          originalURL: 'https://example.com/pending',
          line: 4,
          column: 10,
          type: 'href',
          status: 'pending'
        }
      ]
    };

    // Load the document
    await app.models.document.loadDocument(documentData);

    // Check the table rendering
    const tableContainer = document.getElementById('table-container');
    const inputFields = tableContainer.querySelectorAll('.url-input-field');

    expect(inputFields).toHaveLength(3);

    // First URL (valid) should have original URL in input field
    expect(inputFields[0].value).toBe('https://httpstat.us/200');

    // Second URL (replacement found) should have replacement URL in input field
    expect(inputFields[1].value).toBe('https://httpstat.us/200');
    expect(inputFields[1].classList.contains('replacement-input')).toBe(true);

    // Third URL (pending) should have empty input field
    expect(inputFields[2].value).toBe('');
  });
});
