# URL Fixer 🔗

A powerful web service that validates and fixes broken URLs in documents using intelligent search and replacement.

## Features

- **Multi-format Support**: Process HTML, CSS, Markdown, DOC, DOCX, TXT, RTF, and PDF files
- **URL Validation**: Check HTTP status of all URLs in documents
- **Intelligent Replacement**: Use DuckDuckGo search to find replacement URLs for broken links
- **Interactive Editing**: Edit results in a responsive, accessible table
- **Document Download**: Download corrected documents with fixed URLs
- **Offline Support**: PWA with service worker for offline functionality
- **Accessibility**: Full WCAG compliance with keyboard navigation and screen reader support

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
2. **Validation**: Send HTTP GET requests to check URL status
3. **Smart Search**: For 404 errors, search DuckDuckGo using domain + filename
4. **Verification**: Scrape search results to verify replacement URLs
5. **Replacement**: Update documents with working URLs

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
- `npm test` - Run tests
- `npm run test:ui` - Run tests with UI
- `npm run lint` - Lint code
- `npm run format` - Format code

### Project Structure

```
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
└── docs/               # Documentation
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

### v1.0.0 (Current)
- Initial release
- Multi-format document support
- URL validation and replacement
- PWA functionality
- Accessibility compliance

---

**Built with ❤️ using modern web technologies**
