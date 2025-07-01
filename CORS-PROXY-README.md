# CORS Proxy Server with Chrome Headless for URL Validation

## Overview

The URL Fixer application includes an enhanced CORS proxy server with Chrome Headless support to handle URL validation and web scraping requests that would otherwise be blocked by browser CORS policies. This proxy server allows the application to validate external URLs, perform web searches, and scrape content without being restricted by cross-origin policies.

## 🚀 Chrome Headless Features

The proxy server now includes Chrome Headless functionality that provides:

- **CORS-free URL validation** with JavaScript rendering support
- **Enhanced web search** across Google, Bing, and DuckDuckGo
- **Content scraping** with text, links, and image extraction
- **Screenshot capture** for visual verification
- **Automatic browser management** with resource optimization

## How It Works

1. **Direct Validation**: The application first attempts to validate URLs directly using the browser's `fetch()` API.
2. **CORS Detection**: If a CORS error is detected, the application automatically falls back to using the proxy server.
3. **Proxy Validation**: The proxy server makes the HTTP request on behalf of the browser and returns the results.

## Running the Proxy Server

### Option 1: Run Both Services Together (Recommended)
```bash
npm run dev:full
```
This command starts both the Vite development server (port 3000) and the CORS proxy server (port 3001) simultaneously.

### Option 2: Run Services Separately
```bash
# Terminal 1: Start the proxy server
npm run proxy

# Terminal 2: Start the main application
npm run dev
```

## Proxy Server Endpoints

### Health Check
```
GET http://localhost:3001/health
```
Returns the server status and timestamp.

### Single URL Validation
```
GET http://localhost:3001/validate-url?url=<url>&method=<HEAD|GET>&timeout=<ms>
```
Validates a single URL and returns status information.

**Parameters:**
- `url` (required): The URL to validate
- `method` (optional): HTTP method to use (default: HEAD)
- `timeout` (optional): Request timeout in milliseconds (default: 10000)

**Example:**
```
GET http://localhost:3001/validate-url?url=https://example.com&method=HEAD&timeout=5000
```

### Batch URL Validation
```
POST http://localhost:3001/validate-urls
Content-Type: application/json

{
  "urls": ["https://example.com", "https://google.com"],
  "method": "HEAD",
  "timeout": 10000,
  "concurrency": 5
}
```

### Chrome Headless URL Validation (Enhanced)
```
GET http://localhost:3001/validate-url-headless?url=<url>&timeout=<ms>&screenshot=<true|false>&waitForSelector=<selector>
```
Validates a URL using Chrome Headless with JavaScript rendering support.

**Parameters:**
- `url` (required): The URL to validate
- `timeout` (optional): Request timeout in milliseconds (default: 30000)
- `screenshot` (optional): Capture a screenshot of the page (default: false)
- `waitForSelector` (optional): CSS selector to wait for before considering page loaded

**Example:**
```
GET http://localhost:3001/validate-url-headless?url=https://example.com&screenshot=true&timeout=30000
```

### Chrome Headless Web Search (Enhanced)
```
GET http://localhost:3001/web-search-headless?q=<query>&maxResults=<number>&engine=<google|bing|duckduckgo>&timeout=<ms>
```
Performs web search using Chrome Headless for better result extraction.

**Parameters:**
- `q` (required): Search query
- `maxResults` (optional): Maximum number of results (default: 5)
- `engine` (optional): Search engine to use (default: duckduckgo)
- `timeout` (optional): Request timeout in milliseconds (default: 30000)

**Example:**
```
GET http://localhost:3001/web-search-headless?q=site:example.com+test&maxResults=5&engine=google
```

### Chrome Headless Content Scraping
```
GET http://localhost:3001/scrape-content?url=<url>&extractText=<true|false>&extractLinks=<true|false>&extractImages=<true|false>&timeout=<ms>&waitForSelector=<selector>
```
Scrapes content from a webpage using Chrome Headless.

**Parameters:**
- `url` (required): The URL to scrape
- `extractText` (optional): Extract text content (default: true)
- `extractLinks` (optional): Extract all links (default: false)
- `extractImages` (optional): Extract all images (default: false)
- `timeout` (optional): Request timeout in milliseconds (default: 30000)
- `waitForSelector` (optional): CSS selector to wait for before scraping

**Example:**
```
GET http://localhost:3001/scrape-content?url=https://example.com&extractText=true&extractLinks=true
```

## Configuration

The proxy server can be configured through environment variables:

- `PROXY_PORT`: Port for the proxy server (default: 3001)

## Security Considerations

### Development vs Production

**Development**: The proxy server is designed for development use and includes CORS headers that allow requests from `localhost:3000`.

**Production**: For production deployments, consider:
1. Implementing authentication/authorization
2. Rate limiting
3. URL allowlisting
4. Proper logging and monitoring
5. Running behind a reverse proxy

### URL Restrictions

The proxy server only allows HTTP and HTTPS protocols and validates URL formats before making requests.

## Troubleshooting

### Proxy Server Not Starting
1. Check if port 3001 is available
2. Ensure all dependencies are installed: `npm install`
3. Check for any error messages in the console

### CORS Errors Still Occurring
1. Verify the proxy server is running on port 3001
2. Check browser console for proxy availability messages
3. Ensure the URLValidationService is configured to use proxy fallback

### Performance Issues
1. Adjust the `concurrency` parameter for batch requests
2. Increase timeout values for slow networks
3. Monitor proxy server logs for bottlenecks

## Integration with URL Fixer

The URLValidationService automatically detects CORS errors and falls back to using the proxy server. No manual configuration is required for basic usage.

### Proxy Configuration Methods

```javascript
// Configure custom proxy URL
validationService.configureProxy('http://localhost:3001', true);

// Disable proxy fallback
validationService.disableProxy();

// Enable proxy fallback
validationService.enableProxy();

// Check proxy status
const status = validationService.getProxyStatus();
console.log(status); // { enabled: true, url: 'http://localhost:3001', available: true }
```

## Dependencies

The proxy server requires the following npm packages:
- `express`: Web server framework
- `cors`: CORS middleware
- `node-fetch`: HTTP client for Node.js

These are automatically installed when you run `npm install`.
