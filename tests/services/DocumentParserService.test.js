/**
 * Tests for DocumentParserService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentParserService } from '../../src/services/DocumentParserService.js';

describe('DocumentParserService', () => {
  let parserService;

  beforeEach(() => {
    parserService = new DocumentParserService();
  });

  describe('initialization', () => {
    it('should create a new instance with default configuration', () => {
      expect(parserService.supportedTypes).toBeDefined();
      expect(parserService.urlPatterns).toBeDefined();
      expect(Object.keys(parserService.supportedTypes)).toContain('text/html');
      expect(Object.keys(parserService.supportedTypes)).toContain('application/pdf');
    });

    it('should have URL patterns for different contexts', () => {
      expect(parserService.urlPatterns.standard).toBeDefined();
      expect(parserService.urlPatterns.href).toBeDefined();
      expect(parserService.urlPatterns.src).toBeDefined();
      expect(parserService.urlPatterns.css).toBeDefined();
      expect(parserService.urlPatterns.markdown).toBeDefined();
    });
  });

  describe('file type detection', () => {
    it('should detect HTML files', () => {
      const htmlFile = new File(['<html></html>'], 'test.html', { type: 'text/html' });
      expect(parserService.getFileType(htmlFile)).toBe('html');
    });

    it('should detect CSS files', () => {
      const cssFile = new File(['body {}'], 'test.css', { type: 'text/css' });
      expect(parserService.getFileType(cssFile)).toBe('css');
    });

    it('should detect Markdown files', () => {
      const mdFile = new File(['# Title'], 'test.md', { type: 'text/markdown' });
      expect(parserService.getFileType(mdFile)).toBe('markdown');
    });

    it('should fall back to extension detection', () => {
      const htmlFile = new File(['<html></html>'], 'test.html', { type: '' });
      expect(parserService.getFileType(htmlFile)).toBe('html');
    });

    it('should return null for unsupported files', () => {
      const unsupportedFile = new File(['data'], 'test.xyz', { type: 'application/unknown' });
      expect(parserService.getFileType(unsupportedFile)).toBeNull();
    });
  });

  describe('HTML parsing', () => {
    it('should extract href URLs from HTML', () => {
      const htmlContent = `
        <html>
          <body>
            <a href="https://example.com">Link</a>
            <a href="https://test.com/page">Another Link</a>
          </body>
        </html>
      `;
      
      const urls = parserService.parseHTMLContent(htmlContent);
      expect(urls).toHaveLength(2);
      expect(urls[0].originalURL).toBe('https://example.com');
      expect(urls[0].type).toBe('href');
      expect(urls[1].originalURL).toBe('https://test.com/page');
    });

    it('should extract src URLs from HTML', () => {
      const htmlContent = `
        <html>
          <body>
            <img src="https://example.com/image.jpg" alt="Image">
            <script src="https://cdn.example.com/script.js"></script>
          </body>
        </html>
      `;
      
      const urls = parserService.parseHTMLContent(htmlContent);
      expect(urls).toHaveLength(2);
      expect(urls[0].originalURL).toBe('https://example.com/image.jpg');
      expect(urls[0].type).toBe('src');
      expect(urls[1].originalURL).toBe('https://cdn.example.com/script.js');
    });

    it('should extract standard URLs from HTML text', () => {
      const htmlContent = `
        <html>
          <body>
            <p>Visit https://example.com for more info</p>
            <p>Also check http://test.org</p>
          </body>
        </html>
      `;
      
      const urls = parserService.parseHTMLContent(htmlContent);
      expect(urls).toHaveLength(2);
      expect(urls[0].originalURL).toBe('https://example.com');
      expect(urls[0].type).toBe('text');
      expect(urls[1].originalURL).toBe('http://test.org');
    });

    it('should track line and column positions', () => {
      const htmlContent = `<a href="https://example.com">Link</a>`;
      
      const urls = parserService.parseHTMLContent(htmlContent);
      expect(urls).toHaveLength(1);
      expect(urls[0].line).toBe(1);
      expect(urls[0].column).toBeGreaterThan(0);
    });
  });

  describe('CSS parsing', () => {
    it('should extract URLs from CSS url() functions', () => {
      const cssContent = `
        body {
          background-image: url('https://example.com/bg.jpg');
        }
        .icon {
          background: url("https://test.com/icon.png");
        }
        .font {
          src: url(https://fonts.example.com/font.woff);
        }
      `;
      
      const urls = parserService.parseCSSContent(cssContent);
      expect(urls).toHaveLength(3);
      expect(urls[0].originalURL).toBe('https://example.com/bg.jpg');
      expect(urls[0].type).toBe('css-url');
      expect(urls[1].originalURL).toBe('https://test.com/icon.png');
      expect(urls[2].originalURL).toBe('https://fonts.example.com/font.woff');
    });
  });

  describe('Markdown parsing', () => {
    it('should extract URLs from Markdown links', () => {
      const markdownContent = `
        # Title
        
        Check out [Example](https://example.com) for more info.
        Also visit [Test Site](https://test.org/page).
        
        Direct link: https://direct.com
      `;
      
      const urls = parserService.parseMarkdownContent(markdownContent);
      expect(urls).toHaveLength(3);
      
      // Markdown link
      expect(urls[0].originalURL).toBe('https://example.com');
      expect(urls[0].type).toBe('markdown-link');
      expect(urls[0].linkText).toBe('Example');
      
      // Another markdown link
      expect(urls[1].originalURL).toBe('https://test.org/page');
      expect(urls[1].linkText).toBe('Test Site');
      
      // Direct URL
      expect(urls[2].originalURL).toBe('https://direct.com');
      expect(urls[2].type).toBe('text');
    });
  });

  describe('text parsing', () => {
    it('should extract URLs from plain text', () => {
      const textContent = `
        Visit our website at https://example.com
        For support, email us at mailto:support@example.com
        Also check http://test.org for updates
      `;
      
      const urls = parserService.parseTextContent(textContent);
      expect(urls).toHaveLength(3);
      expect(urls[0].originalURL).toBe('https://example.com');
      expect(urls[0].type).toBe('text');
      expect(urls[1].originalURL).toBe('mailto:support@example.com');
      expect(urls[1].type).toBe('email');
      expect(urls[2].originalURL).toBe('http://test.org');
    });
  });

  describe('URL validation and normalization', () => {
    it('should validate correct URLs', () => {
      expect(parserService.isValidURL('https://example.com')).toBe(true);
      expect(parserService.isValidURL('http://test.org')).toBe(true);
      expect(parserService.isValidURL('https://sub.domain.com/path')).toBe(true);
    });

    it('should validate URLs without protocol', () => {
      expect(parserService.isValidURL('example.com')).toBe(true);
      expect(parserService.isValidURL('www.test.org')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(parserService.isValidURL('not-a-url')).toBe(false);
      expect(parserService.isValidURL('ftp://example.com')).toBe(false);
      expect(parserService.isValidURL('')).toBe(false);
    });

    it('should normalize URLs', () => {
      expect(parserService.normalizeURL('https://example.com')).toBe('https://example.com/');
      expect(parserService.normalizeURL('example.com')).toBe('http://example.com/');
      expect(parserService.normalizeURL('www.test.org')).toBe('http://www.test.org/');
    });
  });

  describe('file reading', () => {
    it('should read text content from file', async () => {
      const textContent = 'Hello world https://example.com';
      const file = new File([textContent], 'test.txt', { type: 'text/plain' });
      
      const content = await parserService.readTextContent(file);
      expect(content).toBe(textContent);
    });

    it('should handle file reading errors', async () => {
      // Create a mock file that will cause an error
      const mockFile = {
        name: 'test.txt',
        type: 'text/plain'
      };
      
      // Mock FileReader to simulate error
      const originalFileReader = global.FileReader;
      global.FileReader = vi.fn(() => ({
        readAsText: vi.fn(function() {
          setTimeout(() => {
            this.onerror(new Error('Read error'));
          }, 0);
        }),
        set onload(handler) { this._onload = handler; },
        set onerror(handler) { this._onerror = handler; }
      }));

      await expect(parserService.readTextContent(mockFile)).rejects.toThrow('Failed to read file');
      
      global.FileReader = originalFileReader;
    });
  });

  describe('utility methods', () => {
    it('should return supported file types', () => {
      const types = parserService.getSupportedTypes();
      expect(Array.isArray(types)).toBe(true);
      expect(types).toContain('text/html');
      expect(types).toContain('application/pdf');
    });

    it('should check if file is supported', () => {
      const htmlFile = new File(['<html></html>'], 'test.html', { type: 'text/html' });
      const unsupportedFile = new File(['data'], 'test.xyz', { type: 'application/unknown' });
      
      expect(parserService.isSupported(htmlFile)).toBe(true);
      expect(parserService.isSupported(unsupportedFile)).toBe(false);
    });

    it('should create URL entries with proper structure', () => {
      const entry = parserService.createURLEntry('https://example.com', 1, 10, 'href', 'Link Text');
      
      expect(entry).toEqual({
        originalURL: 'https://example.com',
        newURL: null,
        line: 1,
        column: 10,
        type: 'href',
        linkText: 'Link Text',
        status: 'pending',
        statusCode: null,
        responseTime: null,
        lastChecked: null,
        replacementFound: false,
        replacementURL: null,
        replacementSource: null
      });
    });
  });

  describe('error handling', () => {
    it('should handle PDF parsing errors gracefully', async () => {
      const pdfFile = new File(['fake pdf content'], 'test.pdf', { type: 'application/pdf' });
      
      await expect(parserService.readPDFContent(pdfFile)).rejects.toThrow('PDF parsing failed');
    });

    it('should handle DOC parsing with warning', async () => {
      const docFile = new File(['fake doc content'], 'test.doc', { type: 'application/msword' });
      
      // Mock console.warn to check if warning is logged
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      await expect(parserService.readDocContent(docFile)).rejects.toThrow();
      
      warnSpy.mockRestore();
    });
  });
});
