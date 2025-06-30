/**
 * Test setup file for Vitest
 * Configures the testing environment and global utilities
 */

import { vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

// Function to clear all mock data (useful for test cleanup)
global.clearMockIndexedDBData = () => {
  // Clear all databases in fake-indexeddb
  if (global.indexedDB && global.indexedDB.databases) {
    global.indexedDB.databases().then(databases => {
      databases.forEach(db => {
        global.indexedDB.deleteDatabase(db.name);
      });
    });
  }
};

// fake-indexeddb automatically sets up global.indexedDB, global.IDBKeyRange, etc.
// We just need to ensure window.indexedDB is also set for browser environment simulation
if (typeof window === 'undefined') {
  global.window = {
    indexedDB: global.indexedDB
  };
} else {
  global.window = global.window || {};
  global.window.indexedDB = global.indexedDB;
}

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
};
global.localStorage = localStorageMock;

// Mock sessionStorage
const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
};
global.sessionStorage = sessionStorageMock;

// Mock navigator
global.navigator = {
  userAgent: 'test-agent',
  storage: {
    estimate: vi.fn().mockResolvedValue({
      quota: 1000000,
      usage: 500000
    })
  }
};

// Mock fetch
global.fetch = vi.fn();

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  time: vi.fn(),
  timeEnd: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn()
};

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});
