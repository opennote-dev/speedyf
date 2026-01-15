# SpeedyF

Documents are hard. Especially in serverless environments. SpeedyF ("sPDF") is a one-click deployable solution for file manipulation, with support for using object-storage URLs as input.

Contrary to the name, SpeedyF is not just for PDFs, but can be used to manipulate a variety of files. The details for that are below. 

### Supported Document Formats

| Format | Extension | MIME Type |
|--------|-----------|-----------|
| PDF | `.pdf` | `application/pdf` |
| Word | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| PowerPoint | `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| EPUB | `.epub` | `application/epub+zip` |
| RTF | `.rtf` | `application/rtf` |
| OpenDocument Text | `.odt` | `application/vnd.oasis.opendocument.text` |
| XML DocBook / JATS XML / OPML | `.xml` or `.opml` | `application/xml` |
| FictionBook | `.fb2` | `application/x-fictionbook+xml` |
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
> A `MISTRAL_API_KEY` is required for the `markdown` endpoint. You can make an API account and keys [here](https://console.mistral.ai/home?workspace_dialog=apiKeys).

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

## File Truncation

### POST `/truncate`

Truncate files to fit within specified page count and file size limits. For PDFs, uses binary search optimization. For DOCX files, truncates based on paragraph count with a configurable heuristic for pages-to-paragraphs conversion.

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
| `url` | string | Yes | - | URL of the file to truncate |
| `maxPages` | number | No | 1000 | Maximum number of pages |
| `maxSizeBytes` | number | No | 52428800 (50MB) | Maximum file size in bytes |
| `paragraphsPerPage` | number | No | 15 | (DOCX only) Paragraphs per page heuristic for estimating page count |

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
| `file` | File | Yes | - | File to truncate |
| `maxPages` | string | No | "1000" | Maximum number of pages |
| `maxSizeBytes` | string | No | "52428800" | Maximum file size in bytes |
| `paragraphsPerPage` | string | No | "15" | (DOCX only) Paragraphs per page heuristic for estimating page count |

**Response:**
- **Content-Type:** Matches input file MIME type
- **Body:** Binary file data (truncated)
- **Headers:**
  - `X-Was-Truncated`: `"true"` or `"false"`
  - `X-Original-Size`: Original file size in bytes
  - `X-Final-Size`: Final file size in bytes

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
const fileBlob = await response.blob()

// With File Upload
const formData = new FormData()
formData.append('file', Bun.file('/path/to/document.docx'))
formData.append('maxPages', '10')
formData.append('paragraphsPerPage', '20')  // Adjust if document has dense formatting

const response = await fetch('http://localhost:3000/truncate', {
  method: 'POST',
  body: formData
})
const docxBlob = await response.blob()
```

---

### GET `/truncate`

Truncate a file from a URL using query parameters.

**Request:**
```bash
curl -X GET "http://localhost:3000/truncate?url=https://example.com/document.pdf&maxPages=1000&maxSizeBytes=52428800"
```

**Query Parameters:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | - | URL of the file to truncate |
| `maxPages` | number | No | 1000 | Maximum number of pages |
| `maxSizeBytes` | number | No | 52428800 (50MB) | Maximum file size in bytes |
| `paragraphsPerPage` | number | No | 15 | (DOCX only) Paragraphs per page heuristic for estimating page count |

**Response:**
Same as POST `/truncate` above.

**Example (TypeScript):**
```typescript
const url = 'https://example.com/document.pdf'
const response = await fetch(`http://localhost:3000/truncate?url=${encodeURIComponent(url)}&maxPages=500`)
const fileBlob = await response.blob()

// For DOCX with custom paragraphs per page
const docxUrl = 'https://example.com/document.docx'
const response2 = await fetch(`http://localhost:3000/truncate?url=${encodeURIComponent(docxUrl)}&maxPages=10&paragraphsPerPage=20`)
const docxBlob = await response2.blob()
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
