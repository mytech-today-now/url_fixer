# URL Fixer API Documentation

This document describes the internal API structure of the URL Fixer application.

## Architecture Overview

The application follows the Model-View-Controller (MVC) pattern with the following components:

- **Models**: Manage data and business logic
- **Views**: Handle UI rendering and user interactions  
- **Controllers**: Coordinate between models and views
- **Services**: Encapsulate external API interactions and complex operations
- **Utils**: Provide utility functions and helpers

## Core Services

### DocumentParserService

Parses different document types to extract URLs with position tracking.

#### Methods

##### `parseFile(file: File): Promise<DocumentData>`

Parses a file and extracts URLs.

**Parameters:**
- `file` - File object to parse

**Returns:**
- Promise resolving to DocumentData object

**Example:**
```javascript
const parser = new DocumentParserService();
const result = await parser.parseFile(htmlFile);
console.log(result.urls); // Array of extracted URLs
```

##### `parseURL(url: string): Promise<DocumentData>`

Fetches and parses a webpage URL.

**Parameters:**
- `url` - URL to fetch and parse

**Returns:**
- Promise resolving to DocumentData object

##### `isSupported(file: File): boolean`

Checks if a file type is supported.

**Parameters:**
- `file` - File object to check

**Returns:**
- Boolean indicating support

#### Supported File Types

- HTML (.html, .htm, .asp, .aspx)
- CSS (.css)
- Markdown (.md, .markdown)
- Text (.txt, .rtf)
- Office Documents (.doc, .docx)
- PDF (.pdf)

### URLValidationService

Validates URLs and checks their HTTP status with caching and retry logic.

#### Methods

##### `validateURL(url: string, options?: ValidationOptions): Promise<ValidationResult>`

Validates a single URL.

**Parameters:**
- `url` - URL to validate
- `options` - Optional configuration object

**Options:**
```typescript
interface ValidationOptions {
  timeout?: number;        // Request timeout (default: 10000ms)
  useCache?: boolean;      // Use cached results (default: true)
  maxAge?: number;         // Cache max age (default: 1 hour)
  retries?: number;        // Max retry attempts (default: 2)
}
```

**Returns:**
```typescript
interface ValidationResult {
  url: string;
  status: number;
  statusText: string;
  responseTime: number;
  headers: object;
  fromCache: boolean;
  timestamp: string;
  error?: string;
}
```

##### `validateURLs(urls: string[], options?: BatchValidationOptions): Promise<ValidationResult[]>`

Validates multiple URLs with concurrency control.

**Parameters:**
- `urls` - Array of URLs to validate
- `options` - Optional configuration object

**Options:**
```typescript
interface BatchValidationOptions extends ValidationOptions {
  concurrency?: number;                                    // Max concurrent requests (default: 5)
  onProgress?: (completed: number, total: number) => void; // Progress callback
  onResult?: (result: ValidationResult) => void;          // Individual result callback
}
```

#### Status Classification Methods

- `isSuccessStatus(status: number): boolean` - 2xx status codes
- `isRedirectStatus(status: number): boolean` - 3xx status codes  
- `isClientErrorStatus(status: number): boolean` - 4xx status codes
- `isServerErrorStatus(status: number): boolean` - 5xx status codes

### SearchService

Finds replacement URLs using DuckDuckGo search with intelligent strategies.

#### Methods

##### `findReplacementURL(originalURL: string, options?: SearchOptions): Promise<ReplacementResult | null>`

Finds a replacement URL for a broken link.

**Parameters:**
- `originalURL` - The broken URL to find a replacement for
- `options` - Optional search configuration

**Options:**
```typescript
interface SearchOptions {
  maxResults?: number;     // Max search results (default: 5)
  timeout?: number;        // Search timeout (default: 15000ms)
  strictDomain?: boolean;  // Restrict to same domain (default: true)
}
```

**Returns:**
```typescript
interface ReplacementResult {
  originalURL: string;
  replacementURL: string;
  confidence: number;      // 0-1 confidence score
  source: string;          // 'duckduckgo'
  searchQuery: string;     // Query used to find replacement
  title: string;           // Page title
  snippet: string;         // Page snippet
  timestamp: string;
}
```

#### Search Strategies

1. **Site-specific search with filename** - `site:domain.com "filename"`
2. **Site-specific search with path components** - `site:domain.com path terms`
3. **Broader search** (if strictDomain=false) - `"filename" domain.com`

### StorageService

Promise-based IndexedDB wrapper for local data persistence.

#### Methods

##### `init(): Promise<IDBDatabase>`

Initializes the database connection.

##### `storeProcessingHistory(data: HistoryRecord): Promise<void>`

Stores a processing history record.

##### `getProcessingHistory(filters?: HistoryFilters): Promise<HistoryRecord[]>`

Retrieves processing history with optional filters.

**Filters:**
```typescript
interface HistoryFilters {
  limit?: number;
  status?: string;
  documentName?: string;
  startDate?: string;
  endDate?: string;
}
```

##### `storeSessionData(key: string, data: any): Promise<void>`

Stores session data.

##### `getSessionData(key: string): Promise<any>`

Retrieves session data.

##### `cacheURLResult(url: string, status: number, responseTime: number, headers?: object): Promise<void>`

Caches URL validation result.

##### `getCachedURLResult(url: string, maxAge?: number): Promise<CachedResult | null>`

Retrieves cached URL result.

## Core Models

### DocumentModel

Manages document state and URL data.

#### Methods

##### `loadDocument(documentData: DocumentData): Promise<void>`

Loads a document and extracts URLs.

##### `updateURL(urlId: string, updates: Partial<URLData>): boolean`

Updates a specific URL's data.

##### `setProcessingState(state: ProcessingState, progress?: number): void`

Sets the processing state.

**States:** `'idle' | 'processing' | 'completed' | 'error'`

##### `generateFixedDocument(): FixedDocument`

Generates a document with fixed URLs.

#### Events

- `documentLoaded` - Document loaded successfully
- `urlUpdated` - URL data updated
- `processingStateChanged` - Processing state changed
- `documentCleared` - Document cleared

### URLProcessorModel

Orchestrates URL validation and replacement.

#### Methods

##### `processURLs(urls: URLData[], options?: ProcessingOptions): Promise<ProcessedURL[]>`

Processes URLs for validation and replacement.

**Options:**
```typescript
interface ProcessingOptions {
  onProgress?: (completed: number, total: number, progress: number, result: ProcessedURL) => void;
  onURLProcessed?: (result: ProcessedURL) => void;
  onBatchComplete?: (batchIndex: number, totalBatches: number, results: ProcessedURL[]) => void;
  signal?: AbortSignal;
}
```

##### `abort(): void`

Aborts current processing.

##### `updateConfig(config: Partial<ProcessorConfig>): void`

Updates processor configuration.

#### Events

- `processingStarted` - Processing started
- `urlProcessed` - Individual URL processed
- `batchComplete` - Batch completed
- `processingComplete` - All processing completed
- `processingError` - Processing error occurred
- `processingAborted` - Processing aborted

## Views

### AppView

Main application view handling UI interactions.

#### Methods

##### `init(): Promise<void>`

Initializes the view.

##### `displayDocument(document: DocumentData, urls: URLData[]): void`

Displays document and URLs in the interface.

##### `updateProcessingControls(hasDocument: boolean, canDownload?: boolean): void`

Updates processing control states.

##### `showProgress(show: boolean): void`

Shows/hides progress indicator.

##### `updateProgress(percentage: number, text: string): void`

Updates progress display.

#### Events

- `fileSelected` - File selected for upload
- `urlScanRequested` - URL scan requested
- `processRequested` - Processing requested
- `downloadRequested` - Download requested
- `clearRequested` - Clear requested
- `urlEdited` - URL edited in table
- `urlAcceptReplacement` - Replacement accepted
- `urlRejectReplacement` - Replacement rejected

## Controllers

### AppController

Main application controller coordinating between models and views.

#### Methods

##### `init(): Promise<void>`

Initializes the controller.

##### `handleFileUpload(file: File): Promise<void>`

Handles file upload.

##### `handleURLScan(url: string): Promise<void>`

Handles URL scanning.

##### `handleProcessURLs(): Promise<void>`

Handles URL processing.

##### `handleDownload(): void`

Handles document download.

##### `handleClear(): void`

Handles clearing current document.

## Data Types

### DocumentData

```typescript
interface DocumentData {
  fileName: string;
  fileType: string;
  fileSize: number;
  content: string;
  urls: URLData[];
  timestamp: string;
}
```

### URLData

```typescript
interface URLData {
  id: string;
  originalURL: string;
  newURL?: string;
  line: number;
  column: number;
  type: string;
  linkText?: string;
  status: 'pending' | 'valid' | 'invalid' | 'redirect' | 'error' | 'fixed';
  statusCode?: number;
  responseTime?: number;
  lastChecked?: string;
  replacementFound?: boolean;
  replacementURL?: string;
  replacementSource?: string;
  replacementConfidence?: number;
}
```

### ProcessingStats

```typescript
interface ProcessingStats {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  fixed: number;
}
```

## Error Handling

All services and models implement comprehensive error handling:

- Network errors are caught and reported
- Invalid inputs are validated
- Timeouts are handled gracefully
- User-friendly error messages are provided
- Errors are logged with context information

## Event System

The application uses a custom event system for loose coupling:

```javascript
// Listen for events
model.on('eventName', (data) => {
  console.log('Event received:', data);
});

// Emit events
model.emit('eventName', { key: 'value' });

// Remove listeners
model.off('eventName', listener);
```

## Configuration

Services can be configured through their constructors or update methods:

```javascript
const validator = new URLValidationService();
validator.updateConfig({
  timeout: 15000,
  maxRetries: 3,
  concurrentLimit: 10
});
```
