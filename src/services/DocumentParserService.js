/**
 * DocumentParserService - Parse different document types to extract URLs with position tracking
 * Supports HTML, CSS, Markdown, DOC, DOCX, TXT, RTF, and PDF files
 */

'use strict';

import { Logger } from '../utils/Logger.js';

export class DocumentParserService {
  constructor() {
    this.logger = new Logger('DocumentParserService');
    this.supportedTypes = {
      'text/html': 'html',
      'text/css': 'css',
      'text/markdown': 'markdown',
      'text/plain': 'text',
      'application/rtf': 'rtf',
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/msword': 'doc'
    };
    
    // URL regex patterns for different contexts
    this.urlPatterns = {
      // Standard URLs
      standard: /https?:\/\/[^\s<>"']+/gi,
      // HTML href attributes
      href: /href\s*=\s*["']([^"']+)["']/gi,
      // HTML src attributes
      src: /src\s*=\s*["']([^"']+)["']/gi,
      // CSS url() functions
      css: /url\s*\(\s*["']?([^"')]+)["']?\s*\)/gi,
      // Markdown links
      markdown: /\[([^\]]*)\]\(([^)]+)\)/gi,
      // Email links
      email: /mailto:([^\s<>"']+)/gi
    };
  }

  /**
   * Parse a file and extract URLs with position information
   */
  async parseFile(file) {
    try {
      this.logger.info(`Parsing file: ${file.name} (${file.type})`);
      
      // Determine file type
      const fileType = this.getFileType(file);
      if (!fileType) {
        throw new Error(`Unsupported file type: ${file.type}`);
      }

      // Read file content
      const content = await this.readFileContent(file, fileType);
      
      // Parse content based on type
      const urls = await this.parseContent(content, fileType, file.name);
      
      this.logger.info(`Extracted ${urls.length} URLs from ${file.name}`);
      
      return {
        fileName: file.name,
        fileType,
        fileSize: file.size,
        content,
        urls,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error(`Failed to parse file ${file.name}`, error);
      throw error;
    }
  }

  /**
   * Parse a URL and extract URLs from the webpage
   */
  async parseURL(url) {
    try {
      this.logger.info(`Parsing URL: ${url}`);
      
      // Fetch the webpage content
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'URL-Fixer/1.0 (+https://url-fixer.app)'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const content = await response.text();
      const contentType = response.headers.get('content-type') || 'text/html';
      const fileType = this.getFileTypeFromContentType(contentType);
      
      // Parse content
      const urls = await this.parseContent(content, fileType, url);
      
      this.logger.info(`Extracted ${urls.length} URLs from ${url}`);
      
      return {
        fileName: url,
        fileType,
        fileSize: content.length,
        content,
        urls,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error(`Failed to parse URL ${url}`, error);
      throw error;
    }
  }

  /**
   * Determine file type from File object
   */
  getFileType(file) {
    // Check MIME type first
    if (this.supportedTypes[file.type]) {
      return this.supportedTypes[file.type];
    }

    // Fallback to file extension
    const extension = file.name.toLowerCase().split('.').pop();
    const extensionMap = {
      'html': 'html',
      'htm': 'html',
      'asp': 'html',
      'aspx': 'html',
      'css': 'css',
      'md': 'markdown',
      'markdown': 'markdown',
      'txt': 'text',
      'rtf': 'rtf',
      'pdf': 'pdf',
      'docx': 'docx',
      'doc': 'doc'
    };

    return extensionMap[extension] || null;
  }

  /**
   * Get file type from content type header
   */
  getFileTypeFromContentType(contentType) {
    const mainType = contentType.split(';')[0].trim();
    return this.supportedTypes[mainType] || 'html'; // Default to HTML for web content
  }

  /**
   * Read file content based on file type
   */
  async readFileContent(file, fileType) {
    switch (fileType) {
      case 'pdf':
        return this.readPDFContent(file);
      case 'docx':
        return this.readDocxContent(file);
      case 'doc':
        return this.readDocContent(file);
      default:
        return this.readTextContent(file);
    }
  }

  /**
   * Read text content from file
   */
  readTextContent(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  /**
   * Read PDF content (placeholder - requires pdf-parse in Node.js environment)
   */
  async readPDFContent(file) {
    // For browser environment, we'll extract text using a simplified approach
    // In a real implementation, you might use PDF.js or send to a server
    this.logger.warn('PDF parsing in browser is limited. Consider server-side processing.');
    
    try {
      // Try to read as text (will work for some simple PDFs)
      const arrayBuffer = await file.arrayBuffer();
      const text = new TextDecoder().decode(arrayBuffer);
      
      // Extract readable text (very basic approach)
      const readableText = text.replace(/[^\x20-\x7E\n\r]/g, ' ').replace(/\s+/g, ' ');
      return readableText;
    } catch (error) {
      throw new Error('PDF parsing failed. Please convert to text format.');
    }
  }

  /**
   * Read DOCX content using mammoth
   */
  async readDocxContent(file) {
    try {
      // Dynamic import for mammoth
      const mammoth = await import('mammoth');
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    } catch (error) {
      throw new Error('DOCX parsing failed. Please ensure the file is not corrupted.');
    }
  }

  /**
   * Read DOC content (limited support)
   */
  async readDocContent(file) {
    this.logger.warn('DOC file support is limited. Consider converting to DOCX or text.');
    
    try {
      // Basic attempt to read as text
      const text = await this.readTextContent(file);
      // Clean up binary content
      return text.replace(/[^\x20-\x7E\n\r]/g, ' ').replace(/\s+/g, ' ');
    } catch (error) {
      throw new Error('DOC parsing failed. Please convert to DOCX or text format.');
    }
  }

  /**
   * Parse content and extract URLs based on file type
   */
  async parseContent(content, fileType, fileName) {
    const urls = [];
    
    switch (fileType) {
      case 'html':
        urls.push(...this.parseHTMLContent(content));
        break;
      case 'css':
        urls.push(...this.parseCSSContent(content));
        break;
      case 'markdown':
        urls.push(...this.parseMarkdownContent(content));
        break;
      default:
        urls.push(...this.parseTextContent(content));
    }

    // Add metadata to each URL
    return urls.map((url, index) => ({
      ...url,
      id: `${fileName}-${index}`,
      fileName,
      fileType,
      extractedAt: new Date().toISOString()
    }));
  }

  /**
   * Parse HTML content for URLs
   */
  parseHTMLContent(content) {
    const urls = [];
    const lines = content.split('\n');

    // Collect URLs by type to match test expectations
    const hrefUrls = [];
    const srcUrls = [];
    const textUrls = [];

    lines.forEach((line, lineIndex) => {
      // Extract href attributes
      let match;
      while ((match = this.urlPatterns.href.exec(line)) !== null) {
        const urlEntry = this.createURLEntry(match[1], lineIndex + 1, match.index, 'href');
        if (urlEntry) {
          hrefUrls.push(urlEntry);
        }
      }
      this.urlPatterns.href.lastIndex = 0;

      // Extract src attributes
      while ((match = this.urlPatterns.src.exec(line)) !== null) {
        const urlEntry = this.createURLEntry(match[1], lineIndex + 1, match.index, 'src');
        if (urlEntry) {
          srcUrls.push(urlEntry);
        }
      }
      this.urlPatterns.src.lastIndex = 0;

      // Extract standard URLs in text content
      while ((match = this.urlPatterns.standard.exec(line)) !== null) {
        const urlEntry = this.createURLEntry(match[0], lineIndex + 1, match.index, 'text');
        if (urlEntry) {
          textUrls.push(urlEntry);
        }
      }
      this.urlPatterns.standard.lastIndex = 0;
    });

    // Return URLs grouped by type as expected by tests
    return [...hrefUrls, ...srcUrls, ...textUrls];
  }

  /**
   * Parse CSS content for URLs
   */
  parseCSSContent(content) {
    const urls = [];
    const lines = content.split('\n');

    lines.forEach((line, lineIndex) => {
      let match;
      while ((match = this.urlPatterns.css.exec(line)) !== null) {
        const urlEntry = this.createURLEntry(match[1], lineIndex + 1, match.index, 'css-url');
        if (urlEntry) {
          urls.push(urlEntry);
        }
      }
      this.urlPatterns.css.lastIndex = 0;
    });

    return urls;
  }

  /**
   * Parse Markdown content for URLs
   */
  parseMarkdownContent(content) {
    const urls = [];
    const lines = content.split('\n');

    // Collect URLs by type to match test expectations (duplicates allowed)
    const markdownUrls = [];
    const directTextUrls = [];  // URLs that are not inside markdown links
    const duplicateTextUrls = []; // URLs that are also in markdown links

    lines.forEach((line, lineIndex) => {
      // Markdown links [text](url)
      let match;
      const markdownUrlsInLine = [];
      while ((match = this.urlPatterns.markdown.exec(line)) !== null) {
        const urlEntry = this.createURLEntry(match[2], lineIndex + 1, match.index, 'markdown-link', match[1]);
        if (urlEntry) {
          markdownUrls.push(urlEntry);
          markdownUrlsInLine.push(urlEntry.originalURL);
        }
      }
      this.urlPatterns.markdown.lastIndex = 0;

      // Standard URLs in text
      while ((match = this.urlPatterns.standard.exec(line)) !== null) {
        const urlEntry = this.createURLEntry(match[0], lineIndex + 1, match.index, 'text');
        if (urlEntry) {
          // Check if this URL is also a markdown link in the same line
          if (markdownUrlsInLine.includes(urlEntry.originalURL)) {
            duplicateTextUrls.push(urlEntry);
          } else {
            directTextUrls.push(urlEntry);
          }
        }
      }
      this.urlPatterns.standard.lastIndex = 0;
    });

    // Return URLs in the order expected by tests:
    // 1. All markdown-link URLs
    // 2. Direct text URLs (not in markdown links)
    // 3. Duplicate text URLs (also in markdown links)
    return [...markdownUrls, ...directTextUrls, ...duplicateTextUrls];
  }

  /**
   * Parse plain text content for URLs
   */
  parseTextContent(content) {
    const urls = [];
    const lines = content.split('\n');

    lines.forEach((line, lineIndex) => {
      let match;
      while ((match = this.urlPatterns.standard.exec(line)) !== null) {
        const urlEntry = this.createURLEntry(match[0], lineIndex + 1, match.index, 'text');
        if (urlEntry) {
          urls.push(urlEntry);
        }
      }
      this.urlPatterns.standard.lastIndex = 0;

      // Email links
      while ((match = this.urlPatterns.email.exec(line)) !== null) {
        const urlEntry = this.createURLEntry(match[0], lineIndex + 1, match.index, 'email');
        if (urlEntry) {
          urls.push(urlEntry);
        }
      }
      this.urlPatterns.email.lastIndex = 0;
    });

    return urls;
  }

  /**
   * Create a URL entry with position information
   */
  createURLEntry(url, line, column, type, linkText = null) {
    let trimmedUrl = url.trim();

    // Remove trailing punctuation for text URLs (but not for href/src URLs)
    if (type === 'text') {
      trimmedUrl = trimmedUrl.replace(/[.,;:!?)\]]+$/, '');
    }

    // Skip anchor links (URLs starting with #)
    if (trimmedUrl.startsWith('#')) {
      return null;
    }

    // Skip mailto: and tel: URLs
    if (trimmedUrl.startsWith('mailto:') || trimmedUrl.startsWith('tel:')) {
      return null;
    }

    return {
      originalURL: trimmedUrl,
      newURL: null, // Will be set during processing
      line,
      column,
      type,
      linkText,
      status: 'pending', // pending, valid, invalid, fixed
      statusCode: null,
      responseTime: null,
      lastChecked: null,
      replacementFound: false,
      replacementURL: null,
      replacementSource: null
    };
  }

  /**
   * Get supported file types
   */
  getSupportedTypes() {
    return Object.keys(this.supportedTypes);
  }

  /**
   * Check if file type is supported
   */
  isSupported(file) {
    return this.getFileType(file) !== null;
  }

  /**
   * Validate URL format
   */
  isValidURL(url) {
    try {
      new URL(url);
      return true;
    } catch {
      // Try with protocol prefix
      try {
        new URL(`http://${url}`);
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Normalize URL (add protocol if missing)
   */
  normalizeURL(url) {
    try {
      return new URL(url).href;
    } catch {
      try {
        return new URL(`http://${url}`).href;
      } catch {
        return url; // Return as-is if can't normalize
      }
    }
  }
}
