/**
 * Test setup file for Vitest
 * Configures the testing environment and global utilities
 */

import { vi } from 'vitest';

// Mock IndexedDB for testing
const mockIndexedDB = {
  open: vi.fn(),
  deleteDatabase: vi.fn(),
  cmp: vi.fn()
};

// Mock IDBRequest
class MockIDBRequest extends EventTarget {
  constructor() {
    super();
    this.result = null;
    this.error = null;
    this.readyState = 'pending';
  }

  set onsuccess(handler) {
    this.addEventListener('success', handler);
  }

  set onerror(handler) {
    this.addEventListener('error', handler);
  }
}

// Mock IDBTransaction
class MockIDBTransaction extends EventTarget {
  constructor(storeNames, mode) {
    super();
    this.objectStoreNames = Array.isArray(storeNames) ? storeNames : [storeNames];
    this.mode = mode;
    this.error = null;
  }

  objectStore(name) {
    return new MockIDBObjectStore(name);
  }

  set oncomplete(handler) {
    this.addEventListener('complete', handler);
  }

  set onerror(handler) {
    this.addEventListener('error', handler);
  }

  set onabort(handler) {
    this.addEventListener('abort', handler);
  }
}

// Mock IDBObjectStore
class MockIDBObjectStore {
  constructor(name) {
    this.name = name;
    this.indexNames = [];
    this.keyPath = 'id';
    this.autoIncrement = true;
  }

  add(value) {
    const request = new MockIDBRequest();
    setTimeout(() => {
      request.result = { ...value, id: Date.now() };
      request.readyState = 'done';
      request.dispatchEvent(new Event('success'));
    }, 0);
    return request;
  }

  put(value) {
    const request = new MockIDBRequest();
    setTimeout(() => {
      request.result = value;
      request.readyState = 'done';
      request.dispatchEvent(new Event('success'));
    }, 0);
    return request;
  }

  get(key) {
    const request = new MockIDBRequest();
    setTimeout(() => {
      request.result = null; // Mock empty result
      request.readyState = 'done';
      request.dispatchEvent(new Event('success'));
    }, 0);
    return request;
  }

  clear() {
    const request = new MockIDBRequest();
    setTimeout(() => {
      request.readyState = 'done';
      request.dispatchEvent(new Event('success'));
    }, 0);
    return request;
  }

  createIndex(name, keyPath, options) {
    this.indexNames.push(name);
    return new MockIDBIndex(name, keyPath, options);
  }

  index(name) {
    return new MockIDBIndex(name);
  }

  openCursor(range, direction) {
    const request = new MockIDBRequest();
    setTimeout(() => {
      request.result = null; // Mock empty cursor
      request.readyState = 'done';
      request.dispatchEvent(new Event('success'));
    }, 0);
    return request;
  }
}

// Mock IDBIndex
class MockIDBIndex {
  constructor(name, keyPath, options) {
    this.name = name;
    this.keyPath = keyPath;
    this.unique = options?.unique || false;
  }

  openCursor(range, direction) {
    const request = new MockIDBRequest();
    setTimeout(() => {
      request.result = null;
      request.readyState = 'done';
      request.dispatchEvent(new Event('success'));
    }, 0);
    return request;
  }
}

// Mock IDBDatabase
class MockIDBDatabase extends EventTarget {
  constructor(name, version) {
    super();
    this.name = name;
    this.version = version;
    this.objectStoreNames = [];
  }

  transaction(storeNames, mode) {
    return new MockIDBTransaction(storeNames, mode);
  }

  createObjectStore(name, options) {
    this.objectStoreNames.push(name);
    const store = new MockIDBObjectStore(name);
    if (options) {
      store.keyPath = options.keyPath;
      store.autoIncrement = options.autoIncrement;
    }
    return store;
  }

  close() {
    // Mock close
  }
}

// Mock the indexedDB.open method
mockIndexedDB.open = vi.fn((name, version) => {
  const request = new MockIDBRequest();
  setTimeout(() => {
    const db = new MockIDBDatabase(name, version);
    request.result = db;
    request.readyState = 'done';
    
    // Trigger upgrade if needed
    if (version > 1) {
      const upgradeEvent = new Event('upgradeneeded');
      upgradeEvent.target = request;
      upgradeEvent.oldVersion = 0;
      upgradeEvent.newVersion = version;
      request.dispatchEvent(upgradeEvent);
    }
    
    request.dispatchEvent(new Event('success'));
  }, 0);
  return request;
});

// Set up global mocks
global.indexedDB = mockIndexedDB;
global.IDBKeyRange = {
  only: vi.fn((value) => ({ only: value })),
  bound: vi.fn((lower, upper) => ({ lower, upper })),
  lowerBound: vi.fn((value) => ({ lowerBound: value })),
  upperBound: vi.fn((value) => ({ upperBound: value }))
};

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
