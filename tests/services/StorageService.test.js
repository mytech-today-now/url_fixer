/**
 * Tests for StorageService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageService } from '../../src/services/StorageService.js';

describe('StorageService', () => {
  let storageService;

  beforeEach(() => {
    // Clear mock data before each test
    if (global.clearMockIndexedDBData) {
      global.clearMockIndexedDBData();
    }
    storageService = new StorageService();
  });

  describe('initialization', () => {
    it('should create a new instance with default configuration', () => {
      expect(storageService.dbName).toBe('URLFixerDB');
      expect(storageService.version).toBe(1);
      expect(storageService.isInitialized).toBe(false);
      expect(storageService.db).toBeNull();
    });

    it('should have proper schema definition', () => {
      expect(storageService.schema).toBeDefined();
      expect(storageService.schema[1]).toBeDefined();
      expect(storageService.schema[1].stores).toBeDefined();
      
      const stores = storageService.schema[1].stores;
      expect(stores).toHaveProperty('processing_history');
      expect(stores).toHaveProperty('session_data');
      expect(stores).toHaveProperty('url_cache');
      expect(stores).toHaveProperty('settings');
    });

    it('should initialize database connection', async () => {
      await expect(storageService.init()).resolves.toBeDefined();
      expect(storageService.isInitialized).toBe(true);
      expect(storageService.db).toBeDefined();
    });

    it('should return existing connection if already initialized', async () => {
      await storageService.init();
      const firstDb = storageService.db;
      
      await storageService.init();
      expect(storageService.db).toBe(firstDb);
    });

    it('should handle IndexedDB not supported', async () => {
      const originalIndexedDB = global.indexedDB;
      global.indexedDB = undefined;
      
      await expect(storageService.init()).rejects.toThrow('IndexedDB is not supported');
      
      global.indexedDB = originalIndexedDB;
    });
  });

  describe('processing history', () => {
    beforeEach(async () => {
      await storageService.init();
    });

    it('should store processing history record', async () => {
      const testData = {
        documentName: 'test.html',
        status: 'completed',
        urlCount: 5,
        fixedCount: 2
      };

      await expect(storageService.storeProcessingHistory(testData)).resolves.toBeUndefined();
    });

    it('should retrieve processing history', async () => {
      const history = await storageService.getProcessingHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should retrieve processing history with filters', async () => {
      const filters = {
        status: 'completed',
        limit: 10
      };

      const history = await storageService.getProcessingHistory(filters);
      expect(Array.isArray(history)).toBe(true);
    });

    it('should retrieve processing history with date range', async () => {
      const filters = {
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2025-12-31T23:59:59.999Z',
        limit: 20
      };

      const history = await storageService.getProcessingHistory(filters);
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('session data', () => {
    beforeEach(async () => {
      await storageService.init();
    });

    it('should store and retrieve session data', async () => {
      const testKey = 'test-session';
      const testData = { currentDocument: 'test.html', progress: 50 };

      await storageService.storeSessionData(testKey, testData);
      const retrieved = await storageService.getSessionData(testKey);

      expect(retrieved).toEqual(testData);
    });

    it('should return null for non-existent session data', async () => {
      const result = await storageService.getSessionData('non-existent-key');
      expect(result).toBeNull();
    });
  });

  describe('URL caching', () => {
    beforeEach(async () => {
      await storageService.init();
    });

    it('should cache URL validation result', async () => {
      const testUrl = 'https://example.com';
      const status = 200;
      const responseTime = 150;
      const headers = { 'content-type': 'text/html' };

      await expect(
        storageService.cacheURLResult(testUrl, status, responseTime, headers)
      ).resolves.toBeUndefined();
    });

    it('should retrieve cached URL result', async () => {
      const testUrl = 'https://example.com';
      const status = 200;
      const responseTime = 150;
      const headers = { 'content-type': 'text/html' };

      // First cache a URL result
      await storageService.cacheURLResult(testUrl, status, responseTime, headers);

      // Then retrieve it
      const result = await storageService.getCachedURLResult(testUrl);

      expect(result).toBeDefined();
      expect(result.url).toBe(testUrl);
      expect(result.status).toBe(status);
      expect(result.responseTime).toBe(responseTime);
      expect(result.headers).toEqual(headers);
    });

    it('should return null for non-existent cached URL', async () => {
      const result = await storageService.getCachedURLResult('https://nonexistent.com');
      expect(result).toBeNull();
    });

    it('should respect cache max age', async () => {
      const testUrl = 'https://expired.com';
      const status = 200;
      const responseTime = 150;
      const headers = { 'content-type': 'text/html' };
      const maxAge = 10; // 10 milliseconds - very short for testing

      // First cache a URL result
      await storageService.cacheURLResult(testUrl, status, responseTime, headers);

      // Wait for it to expire
      await new Promise(resolve => setTimeout(resolve, 20));

      // Try to retrieve it with the short max age - should be null
      const result = await storageService.getCachedURLResult(testUrl, maxAge);
      expect(result).toBeNull();
    });
  });

  describe('settings', () => {
    beforeEach(async () => {
      await storageService.init();
    });

    it('should store and retrieve settings', async () => {
      const key = 'theme';
      const value = 'dark';

      await storageService.storeSetting(key, value);
      const retrieved = await storageService.getSetting(key);

      expect(retrieved).toBe(value);
    });

    it('should return default value for non-existent setting', async () => {
      const defaultValue = 'light';
      const result = await storageService.getSetting('non-existent', defaultValue);
      expect(result).toBe(defaultValue);
    });
  });

  describe('utility methods', () => {
    beforeEach(async () => {
      await storageService.init();
    });

    it('should clear all data', async () => {
      await expect(storageService.clearAllData()).resolves.toBeUndefined();
    });

    it('should get storage statistics', async () => {
      const stats = await storageService.getStorageStats();
      expect(stats).toEqual({
        quota: 1000000,
        usage: 500000,
        usagePercentage: 50
      });
    });

    it('should handle missing storage.estimate API', async () => {
      const originalNavigator = global.navigator;
      global.navigator = { ...navigator, storage: undefined };
      
      const stats = await storageService.getStorageStats();
      expect(stats).toBeNull();
      
      global.navigator = originalNavigator;
    });

    it('should close database connection', () => {
      storageService.close();
      expect(storageService.db).toBeNull();
      expect(storageService.isInitialized).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle database open errors', async () => {
      // Create a fresh StorageService instance for this test
      const testStorageService = new StorageService();

      const mockError = new Error('Database error');
      const originalOpen = global.indexedDB.open;

      global.indexedDB.open = vi.fn(() => {
        const request = {
          addEventListener: vi.fn(),
          set onsuccess(handler) { this.addEventListener('success', handler); },
          set onerror(handler) {
            this.addEventListener('error', handler);
            setTimeout(() => {
              this.error = mockError;
              handler({ target: { error: mockError } });
            }, 0);
          },
          set onupgradeneeded(handler) { this.addEventListener('upgradeneeded', handler); },
          set onblocked(handler) { this.addEventListener('blocked', handler); }
        };
        return request;
      });

      await expect(testStorageService.init()).rejects.toThrow('Database error');

      // Restore the original mock
      global.indexedDB.open = originalOpen;
    });

    it('should handle transaction errors gracefully', async () => {
      await storageService.init();
      
      // Mock a transaction error
      const originalTransaction = storageService.db.transaction;
      storageService.db.transaction = vi.fn(() => {
        throw new Error('Transaction failed');
      });

      await expect(
        storageService.storeProcessingHistory({ test: 'data' })
      ).rejects.toThrow('Transaction failed');

      storageService.db.transaction = originalTransaction;
    });
  });
});
