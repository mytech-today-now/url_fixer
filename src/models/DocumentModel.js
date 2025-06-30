/**
 * DocumentModel - Manages document state and URL data
 * Handles document loading, URL extraction, and state management
 */

'use strict';

import { Logger } from '../utils/Logger.js';

export class DocumentModel {
  constructor(storageService) {
    this.logger = new Logger('DocumentModel');
    this.storageService = storageService;
    
    // Document state
    this.currentDocument = null;
    this.urls = [];
    this.processingState = 'idle'; // idle, processing, completed, error
    this.processingProgress = 0;
    this.processingStats = {
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      fixed: 0
    };
    
    // Event listeners
    this.listeners = new Map();
  }

  /**
   * Load a document and extract URLs
   */
  async loadDocument(documentData) {
    try {
      this.logger.info(`Loading document: ${documentData.fileName}`);
      
      this.currentDocument = {
        ...documentData,
        loadedAt: new Date().toISOString(),
        id: this.generateDocumentId(documentData)
      };
      
      // Set URLs from the parsed document
      this.urls = documentData.urls.map((url, index) => ({
        ...url,
        id: url.id || `${this.currentDocument.id}-url-${index}`,
        documentId: this.currentDocument.id
      }));
      
      // Update processing stats
      this.processingStats = {
        total: this.urls.length,
        processed: 0,
        successful: 0,
        failed: 0,
        fixed: 0
      };
      
      this.processingState = 'idle';
      this.processingProgress = 0;
      
      // Store in session storage
      if (this.storageService) {
        await this.storageService.storeSessionData('currentDocument', this.currentDocument);
        await this.storageService.storeSessionData('currentUrls', this.urls);
      }
      
      this.emit('documentLoaded', {
        document: this.currentDocument,
        urls: this.urls
      });
      
      this.logger.info(`Document loaded with ${this.urls.length} URLs`);
      
    } catch (error) {
      this.logger.error('Failed to load document', error);
      this.processingState = 'error';
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Update URL processing result
   */
  updateURL(urlId, updates) {
    const urlIndex = this.urls.findIndex(url => url.id === urlId);
    if (urlIndex === -1) {
      this.logger.warn(`URL not found: ${urlId}`);
      return false;
    }

    const oldUrl = this.urls[urlIndex];
    this.urls[urlIndex] = {
      ...oldUrl,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    // Update processing stats
    this.updateProcessingStats();

    this.emit('urlUpdated', {
      urlId,
      oldUrl,
      newUrl: this.urls[urlIndex]
    });

    return true;
  }

  /**
   * Update multiple URLs
   */
  updateURLs(updates) {
    const updatedUrls = [];
    
    updates.forEach(({ urlId, ...updateData }) => {
      if (this.updateURL(urlId, updateData)) {
        updatedUrls.push(urlId);
      }
    });

    if (updatedUrls.length > 0) {
      this.emit('urlsUpdated', {
        updatedUrls,
        stats: this.processingStats
      });
    }

    return updatedUrls;
  }

  /**
   * Set processing state
   */
  setProcessingState(state, progress = null) {
    const oldState = this.processingState;
    this.processingState = state;
    
    if (progress !== null) {
      this.processingProgress = Math.max(0, Math.min(100, progress));
    }

    this.emit('processingStateChanged', {
      oldState,
      newState: state,
      progress: this.processingProgress,
      stats: this.processingStats
    });
  }

  /**
   * Update processing stats based on current URL states
   */
  updateProcessingStats() {
    const stats = {
      total: this.urls.length,
      processed: 0,
      successful: 0,
      failed: 0,
      fixed: 0
    };

    this.urls.forEach(url => {
      if (url.status !== 'pending') {
        stats.processed++;
      }
      
      if (url.status === 'valid') {
        stats.successful++;
      } else if (url.status === 'invalid') {
        stats.failed++;
      } else if (url.status === 'fixed') {
        stats.fixed++;
      }
    });

    this.processingStats = stats;
    
    // Update progress
    if (stats.total > 0) {
      this.processingProgress = Math.round((stats.processed / stats.total) * 100);
    }
  }

  /**
   * Get URLs by status
   */
  getURLsByStatus(status) {
    return this.urls.filter(url => url.status === status);
  }

  /**
   * Get URLs that need processing
   */
  getPendingURLs() {
    return this.getURLsByStatus('pending');
  }

  /**
   * Get URLs that failed validation
   */
  getFailedURLs() {
    return this.getURLsByStatus('invalid');
  }

  /**
   * Get URLs that were successfully fixed
   */
  getFixedURLs() {
    return this.getURLsByStatus('fixed');
  }

  /**
   * Generate document with fixed URLs
   */
  generateFixedDocument() {
    if (!this.currentDocument) {
      throw new Error('No document loaded');
    }

    let content = this.currentDocument.content;
    const replacements = [];

    // Sort URLs by position (reverse order to maintain positions during replacement)
    const sortedUrls = [...this.urls]
      .filter(url => url.newURL && url.newURL !== url.originalURL)
      .sort((a, b) => {
        if (a.line !== b.line) {
          return b.line - a.line; // Reverse line order
        }
        return b.column - a.column; // Reverse column order
      });

    // Apply replacements
    sortedUrls.forEach(url => {
      const lines = content.split('\n');
      const lineIndex = url.line - 1;
      
      if (lineIndex >= 0 && lineIndex < lines.length) {
        const line = lines[lineIndex];
        const newLine = line.replace(url.originalURL, url.newURL);
        
        if (newLine !== line) {
          lines[lineIndex] = newLine;
          content = lines.join('\n');
          
          replacements.push({
            line: url.line,
            column: url.column,
            originalURL: url.originalURL,
            newURL: url.newURL,
            type: url.type
          });
        }
      }
    });

    return {
      ...this.currentDocument,
      content,
      replacements,
      fixedAt: new Date().toISOString(),
      stats: this.processingStats
    };
  }

  /**
   * Save processing history
   */
  async saveProcessingHistory() {
    if (!this.storageService || !this.currentDocument) {
      return;
    }

    try {
      const historyRecord = {
        documentName: this.currentDocument.fileName,
        documentType: this.currentDocument.fileType,
        documentSize: this.currentDocument.fileSize,
        stats: this.processingStats,
        processingState: this.processingState,
        urls: this.urls.map(url => ({
          originalURL: url.originalURL,
          newURL: url.newURL,
          status: url.status,
          statusCode: url.statusCode,
          type: url.type,
          line: url.line,
          column: url.column
        }))
      };

      await this.storageService.storeProcessingHistory(historyRecord);
      this.logger.info('Processing history saved');
      
    } catch (error) {
      this.logger.error('Failed to save processing history', error);
    }
  }

  /**
   * Clear current document and reset state
   */
  clear() {
    this.currentDocument = null;
    this.urls = [];
    this.processingState = 'idle';
    this.processingProgress = 0;
    this.processingStats = {
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      fixed: 0
    };

    this.emit('documentCleared');
    this.logger.info('Document cleared');
  }

  /**
   * Generate unique document ID
   */
  generateDocumentId(documentData) {
    const timestamp = Date.now();
    const nameHash = this.simpleHash(documentData.fileName);
    return `doc-${nameHash}-${timestamp}`;
  }

  /**
   * Simple hash function for generating IDs
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Event system
   */
  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  off(event, listener) {
    if (this.listeners.has(event)) {
      const listeners = this.listeners.get(event);
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          this.logger.error(`Error in event listener for ${event}`, error);
        }
      });
    }
  }

  /**
   * Get current state
   */
  getState() {
    return {
      document: this.currentDocument,
      urls: this.urls,
      processingState: this.processingState,
      processingProgress: this.processingProgress,
      stats: this.processingStats
    };
  }

  /**
   * Restore state from storage
   */
  async restoreState() {
    if (!this.storageService) {
      return false;
    }

    try {
      const document = await this.storageService.getSessionData('currentDocument');
      const urls = await this.storageService.getSessionData('currentUrls');

      if (document && urls) {
        this.currentDocument = document;
        this.urls = urls;
        this.updateProcessingStats();
        
        this.emit('stateRestored', {
          document: this.currentDocument,
          urls: this.urls
        });
        
        this.logger.info('State restored from storage');
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.logger.error('Failed to restore state', error);
      return false;
    }
  }
}
