# SpeedyF

Documents are hard. Especially in serverless environments. SpeedyF ("sPDF") is a one-click deployable solution for file manipulation, with support for using object-storage URLs as input.

Contrary to the name, SpeedyF is not just for PDFs, but can be used to manipulate a variety of files. The details for that are below. 

### Supported Document Formats

| Format | Extension | MIME Type |
|--------|-----------|-----------|
| PDF | `.pdf` | `application/pdf` |
| Word | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| PowerPoint | `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| Text | `.txt` | `text/plain` |
| EPUB | `.epub` | `application/epub+zip` |
| RTF | `.rtf` | `application/rtf` |
| OpenDocument Text | `.odt` | `application/vnd.oasis.opendocument.text` |
| XML DocBook / JATS XML | `.xml` | `application/xml` or `text/xml` |
| BibTeX/BibLaTeX | `.bib` | `text/x-bibtex` |
| FictionBook | `.fb2` | `application/x-fictionbook+xml` |
| LaTeX | `.tex` | `text/x-tex` |
| OPML | `.opml` | `text/x-opml` or `application/xml` |
| Troff man pages | `.1`, `.man` | `application/x-troff-man` |
| Jupyter notebooks | `.ipynb` | `application/x-ipynb+json` |

### Supported Image Formats

| Format | Extension | MIME Type |
|--------|-----------|-----------|
| JPEG | `.jpg`, `.jpeg` | `image/jpeg` |
| PNG | `.png` | `image/png` |
| AVIF | `.avif` | `image/avif` |
| TIFF | `.tiff` | `image/tiff` |
| GIF | `.gif` | `image/gif` |
| HEIC / HEIF | `.heic`, `.heif` | `image/heic`, `image/heif` |
| BMP | `.bmp` | `image/bmp` |
| WebP | `.webp` | `image/webp` |

# Development and Deployment 

To develop locally:

Fill the environment variables:
```
cp .env.example .env.local 
# or 
vc env pull
```

```
bun install
vc dev
```

```
open http://localhost:3000
```

To build locally:

```
npm install
vc build
```

To deploy:

```
npm install
vc deploy
```

# API Documentation

## Authentication

All API endpoints require bearer token authentication. The token is configured via the `INTERNAL_API_KEY` environment variable.

**Include the token in the `Authorization` header:**

```bash
curl -X GET "http://localhost:3000/truncate?url=..." \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Example (TypeScript):**
```typescript
const response = await fetch('http://localhost:3000/truncate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
  },
  body: JSON.stringify({ url: 'https://example.com/document.pdf' })
})
```

Requests without a valid bearer token will receive a `401 Unauthorized` response.

---

## PDF Truncation

### POST `/truncate`

Truncate a PDF to fit within specified page count and file size limits using binary search optimization.

**Accepts both JSON with URL and multipart file upload:**

#### Option 1: JSON with URL

**Request:**
```bash
curl -X POST http://localhost:3000/truncate \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/document.pdf",
    "maxPages": 1000,
    "maxSizeBytes": 52428800
  }'
```

**Request Body:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | - | URL of the PDF to truncate |
| `maxPages` | number | No | 1000 | Maximum number of pages |
| `maxSizeBytes` | number | No | 52428800 (50MB) | Maximum file size in bytes |

#### Option 2: Multipart File Upload

**Request:**
```bash
curl -X POST http://localhost:3000/truncate \
  -F "file=@/path/to/document.pdf" \
  -F "maxPages=1000" \
  -F "maxSizeBytes=52428800"
```

**Form Fields:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `file` | File | Yes | - | PDF file to truncate |
| `maxPages` | string | No | "1000" | Maximum number of pages |
| `maxSizeBytes` | string | No | "52428800" | Maximum file size in bytes |

**Response:**
- **Content-Type:** `application/pdf`
- **Body:** Binary PDF data (truncated)

**Example (TypeScript):**
```typescript
// With URL
const response = await fetch('http://localhost:3000/truncate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://example.com/document.pdf',
    maxPages: 500
  })
})
const pdfBlob = await response.blob()

// With File Upload
const formData = new FormData()
formData.append('file', Bun.file('/path/to/document.pdf'))
formData.append('maxPages', '500')

const response = await fetch('http://localhost:3000/truncate', {
  method: 'POST',
  body: formData
})
const pdfBlob = await response.blob()
```

---

### GET `/truncate`

Truncate a PDF from a URL using query parameters.

**Request:**
```bash
curl -X GET "http://localhost:3000/truncate?url=https://example.com/document.pdf&maxPages=1000&maxSizeBytes=52428800"
```

**Query Parameters:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | - | URL of the PDF to truncate |
| `maxPages` | number | No | 1000 | Maximum number of pages |
| `maxSizeBytes` | number | No | 52428800 (50MB) | Maximum file size in bytes |

**Response:**
Same as POST `/truncate` above.

**Example (TypeScript):**
```typescript
const url = 'https://example.com/document.pdf'
const response = await fetch(`http://localhost:3000/truncate?url=${encodeURIComponent(url)}&maxPages=500`)
const pdfBlob = await response.blob()
```

---

## PDF to Markdown (OCR)

Convert PDFs to markdown using Mistral's OCR API. PDFs are automatically truncated to 999 pages or 49MB before processing.

### POST `/markdown`

Convert a PDF to markdown using binary search optimization.

**Accepts both JSON with URL and multipart file upload:**

#### Option 1: JSON with URL

**Request:**
```bash
curl -X POST http://localhost:3000/markdown \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/document.pdf",
    "maxPages": 999,
    "maxSizeBytes": 51380224
  }'
```

**Request Body:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | - | URL of the PDF to convert |
| `maxPages` | number | No | 999 | Maximum pages before OCR |
| `maxSizeBytes` | number | No | 51380224 (49MB) | Maximum size before OCR |

#### Option 2: Multipart File Upload

**Request:**
```bash
curl -X POST http://localhost:3000/markdown \
  -F "file=@/path/to/document.pdf" \
  -F "maxPages=999" \
  -F "maxSizeBytes=51380224"
```

**Form Fields:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `file` | File | Yes | - | PDF file to convert |
| `maxPages` | string | No | "999" | Maximum pages before OCR |
| `maxSizeBytes` | string | No | "51380224" | Maximum size before OCR |

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `markdown` | string | Extracted markdown content with pages separated by `---` |
| `remainingFields` | object | The remaining fields from the Mistral OCR Response, which are detailed [here](https://docs.mistral.ai/api/endpoint/ocr#operation-ocr_v1_ocr_post). |

**Example (TypeScript):**
```typescript
// With URL
const response = await fetch('http://localhost:3000/markdown', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://example.com/document.pdf',
    maxPages: 500
  })
})
const { markdown, pages, usage } = await response.json()

// With File Upload
const formData = new FormData()
formData.append('file', Bun.file('/path/to/document.pdf'))
formData.append('maxPages', '500')

const response = await fetch('http://localhost:3000/markdown', {
  method: 'POST',
  body: formData
})
const { markdown, ...remainingFields } = await response.json()
```

---

### GET `/markdown`

Convert a PDF from a URL to markdown using query parameters.

**Request:**
```bash
curl -X GET "http://localhost:3000/markdown?url=https://example.com/document.pdf&maxPages=999&maxSizeBytes=51380224"
```

**Query Parameters:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | - | URL of the PDF to convert |
| `maxPages` | number | No | 999 | Maximum pages before OCR |
| `maxSizeBytes` | number | No | 51380224 (49MB) | Maximum size before OCR |

**Response:**
Same as POST `/markdown` above.

**Example (TypeScript):**
```typescript
const url = 'https://example.com/document.pdf'
const response = await fetch(`http://localhost:3000/markdown?url=${encodeURIComponent(url)}&maxPages=500`)
const { markdown, ...remainingFields } = await response.json()
console.log(markdown)
```
