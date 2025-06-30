/**
 * StorageService - Promise-based IndexedDB wrapper for local data persistence
 * Handles processing history, session data, and schema migrations
 */

'use strict';

import { Logger } from '../utils/Logger.js';

export class StorageService {
  constructor() {
    this.logger = new Logger('StorageService');
    this.dbName = 'URLFixerDB';
    this.version = 1;
    this.db = null;
    this.isInitialized = false;
    
    // Define database schema
    this.schema = {
      1: {
        stores: {
          'processing_history': {
            keyPath: 'id',
            autoIncrement: true,
            indexes: {
              'timestamp': { keyPath: 'timestamp', unique: false },
              'documentName': { keyPath: 'documentName', unique: false },
              'status': { keyPath: 'status', unique: false }
            }
          },
          'session_data': {
            keyPath: 'key',
            autoIncrement: false,
            indexes: {
              'timestamp': { keyPath: 'timestamp', unique: false }
            }
          },
          'url_cache': {
            keyPath: 'url',
            autoIncrement: false,
            indexes: {
              'status': { keyPath: 'status', unique: false },
              'lastChecked': { keyPath: 'lastChecked', unique: false }
            }
          },
          'settings': {
            keyPath: 'key',
            autoIncrement: false,
            indexes: {}
          }
        }
      }
    };
  }

  /**
   * Initialize the database connection
   */
  async init() {
    if (this.isInitialized) {
      return this.db;
    }

    try {
      this.logger.info('Initializing IndexedDB connection');
      
      // Check if IndexedDB is supported
      if (!window.indexedDB) {
        throw new Error('IndexedDB is not supported in this browser');
      }

      this.db = await this.openDatabase();
      this.isInitialized = true;
      
      this.logger.info('IndexedDB initialized successfully');
      return this.db;
      
    } catch (error) {
      this.logger.error('Failed to initialize IndexedDB', error);
      throw error;
    }
  }

  /**
   * Open database connection with version management
   */
  openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        this.logger.info(`Upgrading database from version ${event.oldVersion} to ${event.newVersion}`);
        this.handleUpgrade(event.target.result, event.oldVersion, event.newVersion);
      };

      request.onblocked = () => {
        this.logger.warn('Database upgrade blocked by another connection');
        reject(new Error('Database upgrade blocked. Please close other tabs and try again.'));
      };
    });
  }

  /**
   * Handle database schema upgrades
   */
  handleUpgrade(db, oldVersion, newVersion) {
    try {
      // Apply migrations for each version
      for (let version = oldVersion + 1; version <= newVersion; version++) {
        if (this.schema[version]) {
          this.applySchemaVersion(db, version);
        }
      }
    } catch (error) {
      this.logger.error('Database upgrade failed', error);
      throw error;
    }
  }

  /**
   * Apply schema for a specific version
   */
  applySchemaVersion(db, version) {
    const versionSchema = this.schema[version];
    
    for (const [storeName, storeConfig] of Object.entries(versionSchema.stores)) {
      this.logger.debug(`Creating/updating store: ${storeName}`);
      
      // Create object store if it doesn't exist
      let store;
      if (!db.objectStoreNames.contains(storeName)) {
        store = db.createObjectStore(storeName, {
          keyPath: storeConfig.keyPath,
          autoIncrement: storeConfig.autoIncrement
        });
      } else {
        // Note: In a real upgrade scenario, you might need to handle existing stores
        continue;
      }

      // Create indexes
      for (const [indexName, indexConfig] of Object.entries(storeConfig.indexes)) {
        if (!store.indexNames.contains(indexName)) {
          store.createIndex(indexName, indexConfig.keyPath, {
            unique: indexConfig.unique
          });
        }
      }
    }
  }

  /**
   * Execute a transaction with error handling
   */
  async executeTransaction(storeNames, mode, operation) {
    if (!this.isInitialized) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(storeNames, mode);
        const stores = Array.isArray(storeNames) 
          ? storeNames.map(name => transaction.objectStore(name))
          : transaction.objectStore(storeNames);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(new Error('Transaction aborted'));

        // Execute the operation
        const result = operation(stores, transaction);
        
        // If operation returns a request, handle it
        if (result && typeof result.onsuccess === 'function') {
          result.onsuccess = () => resolve(result.result);
          result.onerror = () => reject(result.error);
        } else {
          // If operation doesn't return a request, resolve with the result
          resolve(result);
        }
        
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Store processing history record
   */
  async storeProcessingHistory(data) {
    const record = {
      ...data,
      timestamp: new Date().toISOString(),
      id: undefined // Let IndexedDB auto-generate
    };

    return this.executeTransaction('processing_history', 'readwrite', (store) => {
      return store.add(record);
    });
  }

  /**
   * Get processing history with optional filters
   */
  async getProcessingHistory(filters = {}) {
    return this.executeTransaction('processing_history', 'readonly', (store) => {
      const { limit = 50, status, documentName, startDate, endDate } = filters;
      
      // If no filters, get all records
      if (!status && !documentName && !startDate && !endDate) {
        return this.getAllRecords(store, limit);
      }

      // Use appropriate index for filtering
      if (status) {
        return this.getRecordsByIndex(store, 'status', status, limit);
      }
      
      if (documentName) {
        return this.getRecordsByIndex(store, 'documentName', documentName, limit);
      }

      // For date range, use timestamp index
      if (startDate || endDate) {
        return this.getRecordsByDateRange(store, startDate, endDate, limit);
      }

      return this.getAllRecords(store, limit);
    });
  }

  /**
   * Get all records from a store
   */
  getAllRecords(store, limit) {
    return new Promise((resolve, reject) => {
      const records = [];
      const request = store.openCursor(null, 'prev'); // Most recent first
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && records.length < limit) {
          records.push(cursor.value);
          cursor.continue();
        } else {
          resolve(records);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get records by index
   */
  getRecordsByIndex(store, indexName, value, limit) {
    return new Promise((resolve, reject) => {
      const records = [];
      const index = store.index(indexName);
      const request = index.openCursor(IDBKeyRange.only(value), 'prev');
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && records.length < limit) {
          records.push(cursor.value);
          cursor.continue();
        } else {
          resolve(records);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get records by date range
   */
  getRecordsByDateRange(store, startDate, endDate, limit) {
    return new Promise((resolve, reject) => {
      const records = [];
      const index = store.index('timestamp');
      
      let range;
      if (startDate && endDate) {
        range = IDBKeyRange.bound(startDate, endDate);
      } else if (startDate) {
        range = IDBKeyRange.lowerBound(startDate);
      } else if (endDate) {
        range = IDBKeyRange.upperBound(endDate);
      }
      
      const request = index.openCursor(range, 'prev');
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && records.length < limit) {
          records.push(cursor.value);
          cursor.continue();
        } else {
          resolve(records);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Store session data
   */
  async storeSessionData(key, data) {
    const record = {
      key,
      data,
      timestamp: new Date().toISOString()
    };

    return this.executeTransaction('session_data', 'readwrite', (store) => {
      return store.put(record);
    });
  }

  /**
   * Get session data
   */
  async getSessionData(key) {
    return this.executeTransaction('session_data', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => {
          const result = request.result;
          resolve(result ? result.data : null);
        };
        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Cache URL validation result
   */
  async cacheURLResult(url, status, responseTime, headers = {}) {
    const record = {
      url,
      status,
      responseTime,
      headers,
      lastChecked: new Date().toISOString()
    };

    return this.executeTransaction('url_cache', 'readwrite', (store) => {
      return store.put(record);
    });
  }

  /**
   * Get cached URL result
   */
  async getCachedURLResult(url, maxAge = 3600000) { // 1 hour default
    return this.executeTransaction('url_cache', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.get(url);
        request.onsuccess = () => {
          const result = request.result;
          if (!result) {
            resolve(null);
            return;
          }

          // Check if cache is still valid
          const age = Date.now() - new Date(result.lastChecked).getTime();
          if (age > maxAge) {
            resolve(null);
            return;
          }

          resolve(result);
        };
        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Store application settings
   */
  async storeSetting(key, value) {
    const record = { key, value };
    return this.executeTransaction('settings', 'readwrite', (store) => {
      return store.put(record);
    });
  }

  /**
   * Get application setting
   */
  async getSetting(key, defaultValue = null) {
    return this.executeTransaction('settings', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => {
          const result = request.result;
          resolve(result ? result.value : defaultValue);
        };
        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Clear all data (factory reset)
   */
  async clearAllData() {
    const storeNames = ['processing_history', 'session_data', 'url_cache', 'settings'];
    
    return this.executeTransaction(storeNames, 'readwrite', (stores) => {
      const promises = stores.map(store => {
        return new Promise((resolve, reject) => {
          const request = store.clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      });
      
      return Promise.all(promises);
    });
  }

  /**
   * Get storage usage statistics
   */
  async getStorageStats() {
    if (!navigator.storage || !navigator.storage.estimate) {
      return null;
    }

    try {
      const estimate = await navigator.storage.estimate();
      return {
        quota: estimate.quota,
        usage: estimate.usage,
        usagePercentage: estimate.quota ? (estimate.usage / estimate.quota) * 100 : 0
      };
    } catch (error) {
      this.logger.warn('Failed to get storage estimate', error);
      return null;
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      this.logger.info('Database connection closed');
    }
  }
}
