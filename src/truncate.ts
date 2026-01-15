import { Hono } from 'hono'
import { truncateFile, FileTooLargeError } from './operations/truncation.js'
import { guessMimeType } from './operations/ocr.js'

const GENERIC_MIME_TYPES = ['application/octet-stream', 'binary/octet-stream', '']

const MAX_PAGES = 1000
const MAX_SIZE_BYTES = 50 * 1024 * 1024

const truncationRouter = new Hono()

truncationRouter.post('/', async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || ''
    let fileBytes: Uint8Array
    let mimeType: string = 'application/pdf'
    let maxPages = MAX_PAGES
    let maxSizeBytes = MAX_SIZE_BYTES
    let paragraphsPerPage: number | undefined = undefined

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
      paragraphsPerPage = body['paragraphsPerPage'] ? parseInt(body['paragraphsPerPage'] as string) : undefined
    } else {
      const body = await c.req.json()
      const { url, maxPages: mp = MAX_PAGES, maxSizeBytes: ms = MAX_SIZE_BYTES, paragraphsPerPage: ppp } = body

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
      paragraphsPerPage = ppp
    }

    const result = await truncateFile(fileBytes, mimeType, { maxPages, maxSizeBytes, paragraphsPerPage })

    return c.body(new Uint8Array(result.bytes), 200, {
      'Content-Type': mimeType,
      'Content-Length': result.bytes.length.toString(),
      'X-Was-Truncated': result.wasTruncated.toString(),
      'X-Original-Size': result.originalSize.toString(),
      'X-Final-Size': result.finalSize.toString(),
    })
  } catch (error) {
    if (error instanceof FileTooLargeError) {
      return c.json({ error: error.message }, 413)
    }
    console.error('Error truncating file:', error)
    return c.json({
      error: 'Failed to truncate file',
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
})

truncationRouter.get('/', async (c) => {
  try {
    const url = c.req.query('url')
    const maxPages = parseInt(c.req.query('maxPages') || String(MAX_PAGES))
    const maxSizeBytes = parseInt(c.req.query('maxSizeBytes') || String(MAX_SIZE_BYTES))
    const paragraphsPerPage = c.req.query('paragraphsPerPage') ? parseInt(c.req.query('paragraphsPerPage')!) : undefined

    if (!url) {
      return c.json({ error: 'URL query parameter is required' }, 400)
    }

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

    const result = await truncateFile(fileBytes, mimeType, { maxPages, maxSizeBytes, paragraphsPerPage })

    return c.body(new Uint8Array(result.bytes), 200, {
      'Content-Type': mimeType,
      'Content-Length': result.bytes.length.toString(),
      'X-Was-Truncated': result.wasTruncated.toString(),
      'X-Original-Size': result.originalSize.toString(),
      'X-Final-Size': result.finalSize.toString(),
    })
  } catch (error) {
    if (error instanceof FileTooLargeError) {
      return c.json({ error: error.message }, 413)
    }
    console.error('Error truncating file:', error)
    return c.json({
      error: 'Failed to truncate file',
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
})

export default truncationRouter;
