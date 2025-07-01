# URL Fixer 🔗

A powerful web service that validates and fixes broken URLs in documents using intelligent search and replacement.

## Features

- **Multi-format Support**: Process HTML, CSS, Markdown, DOC, DOCX, TXT, RTF, and PDF files
- **URL Validation**: Check HTTP status of all URLs in documents with real-time status indicators
- **Intelligent Replacement**: Use DuckDuckGo search to find replacement URLs for broken links
- **Auto-Population**: Replacement URL fields automatically populate based on validation status
- **Interactive Editing**: Edit results in a responsive, accessible table with instant updates
- **Document Download**: Download corrected documents with fixed URLs
- **Offline Support**: PWA with service worker for offline functionality
- **Accessibility**: Full WCAG compliance with keyboard navigation and screen reader support
- **Processing History**: IndexedDB storage for tracking and resuming processing sessions

## Quick Start

1. **Upload a document** or **enter a URL** to scan
2. Click **Process URLs** to validate all links
3. Review and edit results in the interactive table
4. **Download** the corrected document

## Supported File Types

- **Web Documents**: `.htm`, `.html`, `.asp`, `.aspx`
- **Stylesheets**: `.css`
- **Markdown**: `.md`, `.markdown`
- **Office Documents**: `.doc`, `.docx`
- **Text Files**: `.txt`, `.rtf`
- **PDFs**: `.pdf`

## How It Works

1. **URL Extraction**: Parse documents to find all URLs with position tracking
2. **Validation**: Send HTTP GET requests to check URL status with caching
3. **Auto-Population**: Replacement fields automatically populate based on validation results
4. **Smart Search**: For 404/403 errors, search DuckDuckGo using domain + filename patterns
5. **Verification**: Scrape search results to verify replacement URLs
6. **Interactive Editing**: Review and modify suggestions in real-time
7. **Replacement**: Update documents with working URLs and download corrected versions

## Technology Stack

- **Frontend**: Vanilla JavaScript with MVC architecture
- **Build Tool**: Vite for fast development and optimized builds
- **Storage**: IndexedDB for local data persistence
- **Testing**: Vitest with JSDOM for comprehensive testing
- **PWA**: Service Worker for offline support and caching

## Development

### Prerequisites

- Node.js 18+ and npm

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd url_fixer

# Install dependencies
npm install

# Start development server
npm run dev
```

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run proxy` - Start CORS proxy server
- `npm run dev:full` - Start both development server and proxy
- `npm test` - Run tests
- `npm run test:ui` - Run tests with UI
- `npm run test:run` - Run tests once
- `npm run lint` - Lint code
- `npm run format` - Format code

### Project Structure

```text
url_fixer/
├── src/
│   ├── controllers/     # MVC Controllers
│   ├── models/         # Data models
│   ├── views/          # UI views
│   ├── services/       # Business logic services
│   ├── utils/          # Utility functions
│   ├── workers/        # Web workers
│   └── styles/         # CSS styles
├── public/             # Static assets
├── tests/              # Test files
├── docs/               # Documentation
├── scripts/            # Build and utility scripts
└── proxy-server.js     # CORS proxy for development
```

## Architecture

The application follows the **Model-View-Controller (MVC)** pattern:

- **Models**: Manage data and business logic
- **Views**: Handle UI rendering and user interactions
- **Controllers**: Coordinate between models and views
- **Services**: Encapsulate external API interactions and complex operations

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Privacy & Security

- **Local Processing**: All document processing happens in your browser
- **No Data Collection**: No personal data is stored or transmitted
- **Secure Context**: HTTPS required for full functionality
- **Content Security Policy**: Strict CSP headers for security

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

ISC License - see LICENSE file for details

## Version History

### v1.1.0 (Current)

- **Enhanced URL Processing**: Auto-population of replacement URL fields based on validation status
- **Improved User Experience**: Real-time status indicators and instant field updates
- **CORS Proxy Support**: Development proxy server for handling CORS restrictions
- **Extended Testing**: Additional test coverage for new features
- **Documentation Updates**: Comprehensive feature implementation documentation

### v1.0.0

- Initial release with core functionality
- Multi-format document support (HTML, CSS, Markdown, DOC, DOCX, TXT, RTF, PDF)
- URL validation and intelligent replacement system
- PWA functionality with offline support
- Full accessibility compliance (WCAG 2.1 AA)
- MVC architecture with comprehensive testing

---

## Built with Modern Web Technologies

This project leverages cutting-edge web technologies to deliver a fast, reliable, and accessible user experience.
