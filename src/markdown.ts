import { Hono } from 'hono'
import { Mistral } from '@mistralai/mistralai'
import { truncateFile, FileTooLargeError } from './operations/truncation.js'
import { pdfToMarkdown, InvalidFileTypeError, guessMimeType } from './operations/ocr.js'

const GENERIC_MIME_TYPES = ['application/octet-stream', 'binary/octet-stream', '']

const MAX_PAGES = 999
const MAX_SIZE_BYTES = 49 * 1024 * 1024 // 49MB

const markdownRouter = new Hono()

markdownRouter.post('/', async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || ''
    let fileBytes: Uint8Array
    let mimeType: string = 'application/pdf'
    let maxPages = MAX_PAGES
    let maxSizeBytes = MAX_SIZE_BYTES

    if (contentType.includes('multipart/form-data')) {
      const body = await c.req.parseBody()
      const file = body['file']

      if (!file) {
        return c.json({ error: 'File is required in form field "file"' }, 400)
      }

      if (typeof file === 'string') {
        return c.json({ error: 'File must be a binary file, not a string' }, 400)
      }

      fileBytes = await file.bytes()
      const providedType = file.type || ''
      mimeType = GENERIC_MIME_TYPES.includes(providedType)
        ? guessMimeType(file.name, providedType)
        : providedType
      maxPages = body['maxPages'] ? parseInt(body['maxPages'] as string) : MAX_PAGES
      maxSizeBytes = body['maxSizeBytes'] ? parseInt(body['maxSizeBytes'] as string) : MAX_SIZE_BYTES
    } else {
      const body = await c.req.json()
      const { url, maxPages: mp = MAX_PAGES, maxSizeBytes: ms = MAX_SIZE_BYTES } = body

      if (!url || typeof url !== 'string') {
        return c.json({ error: 'URL is required and must be a string' }, 400)
      }

      const response = await fetch(url)
      if (!response.ok) {
        return c.json({ error: `Failed to fetch file: ${response.status}` }, 400)
      }

      const headerType = response.headers.get('Content-Type')?.split(';')[0] || ''
      mimeType = GENERIC_MIME_TYPES.includes(headerType)
        ? guessMimeType(url, headerType)
        : headerType
      const arrayBuffer = await response.arrayBuffer()
      fileBytes = new Uint8Array(arrayBuffer)
      maxPages = mp
      maxSizeBytes = ms
    }

    const apiKey = process.env.MISTRAL_API_KEY
    if (!apiKey) {
      return c.json({ error: 'MISTRAL_API_KEY environment variable not set' }, 500)
    }

    const client = new Mistral({ apiKey })
    const truncationResult = await truncateFile(fileBytes, mimeType, {
      maxPages,
      maxSizeBytes,
    })
    const result = await pdfToMarkdown(truncationResult.bytes, client, mimeType)

    return c.json({
      ...result,
      truncation: {
        wasTruncated: truncationResult.wasTruncated,
        originalSize: truncationResult.originalSize,
        finalSize: truncationResult.finalSize,
      },
    })
  } catch (error) {
    if (error instanceof InvalidFileTypeError) {
      return c.json({ error: error.message }, 400)
    }
    if (error instanceof FileTooLargeError) {
      return c.json({ error: error.message }, 413)
    }
    console.error('Error converting file to markdown:', error)
    return c.json({
      error: 'Failed to convert file to markdown',
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
})

markdownRouter.get('/', async (c) => {
  try {
    const url = c.req.query('url')
    const maxPages = parseInt(c.req.query('maxPages') || String(MAX_PAGES))
    const maxSizeBytes = parseInt(c.req.query('maxSizeBytes') || String(MAX_SIZE_BYTES))

    if (!url) {
      return c.json({ error: 'URL query parameter is required' }, 400)
    }

    const apiKey = process.env.MISTRAL_API_KEY
    if (!apiKey) {
      return c.json({ error: 'MISTRAL_API_KEY environment variable not set' }, 500)
    }

    const client = new Mistral({ apiKey })

    const response = await fetch(url)
    if (!response.ok) {
      return c.json({ error: `Failed to fetch file: ${response.status}` }, 400)
    }

    const headerType = response.headers.get('Content-Type')?.split(';')[0] || ''
    const mimeType = GENERIC_MIME_TYPES.includes(headerType)
      ? guessMimeType(url, headerType)
      : headerType
    const arrayBuffer = await response.arrayBuffer()
    const fileBytes = new Uint8Array(arrayBuffer)
    const truncationResult = await truncateFile(fileBytes, mimeType, {
      maxPages,
      maxSizeBytes,
    })
    const result = await pdfToMarkdown(truncationResult.bytes, client, mimeType)

    return c.json({
      ...result,
      truncation: {
        wasTruncated: truncationResult.wasTruncated,
        originalSize: truncationResult.originalSize,
        finalSize: truncationResult.finalSize,
      },
    })
  } catch (error) {
    if (error instanceof InvalidFileTypeError) {
      return c.json({ error: error.message }, 400)
    }
    if (error instanceof FileTooLargeError) {
      return c.json({ error: error.message }, 413)
    }
    console.error('Error converting file to markdown:', error)
    return c.json({
      error: 'Failed to convert file to markdown',
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
})

export default markdownRouter
