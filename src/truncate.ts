import { Hono } from 'hono'
import { truncatePdf } from './operations/truncation.js'

const MAX_PAGES = 1000
const MAX_SIZE_BYTES = 50 * 1024 * 1024

const pdfRouter = new Hono()

pdfRouter.post('/', async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || ''
    let pdfBytes: Uint8Array
    let maxPages = MAX_PAGES
    let maxSizeBytes = MAX_SIZE_BYTES

    if (contentType.includes('multipart/form-data')) {
      // Handle file upload
      const body = await c.req.parseBody()
      const file = body['file']

      if (!file) {
        return c.json({ error: 'File is required in form field "file"' }, 400)
      }

      if (typeof file === 'string') {
        return c.json({ error: 'File must be a binary file, not a string' }, 400)
      }

      pdfBytes = await file.bytes()
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
        return c.json({ error: `Failed to fetch PDF: ${response.status}` }, 400)
      }

      const arrayBuffer = await response.arrayBuffer()
      pdfBytes = new Uint8Array(arrayBuffer)
      maxPages = mp
      maxSizeBytes = ms
    }

    const truncatedBytes = await truncatePdf(pdfBytes, maxPages, maxSizeBytes)

    return c.body(new Uint8Array(truncatedBytes), 200, {
      'Content-Type': 'application/pdf',
      'Content-Length': truncatedBytes.length.toString(),
      'Content-Disposition': 'inline; filename="truncated.pdf"',
    })
  } catch (error) {
    console.error('Error truncating PDF:', error)
    return c.json({
      error: 'Failed to truncate PDF',
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
})

pdfRouter.get('/', async (c) => {
  try {
    const url = c.req.query('url')
    const maxPages = parseInt(c.req.query('maxPages') || String(MAX_PAGES))
    const maxSizeBytes = parseInt(c.req.query('maxSizeBytes') || String(MAX_SIZE_BYTES))

    if (!url) {
      return c.json({ error: 'URL query parameter is required' }, 400)
    }

    const response = await fetch(url)
    if (!response.ok) {
      return c.json({ error: `Failed to fetch PDF: ${response.status}` }, 400)
    }

    const arrayBuffer = await response.arrayBuffer()
    const pdfBytes = new Uint8Array(arrayBuffer)

    const truncatedBytes = await truncatePdf(pdfBytes, maxPages, maxSizeBytes)

    return c.body(new Uint8Array(truncatedBytes), 200, {
      'Content-Type': 'application/pdf',
      'Content-Length': truncatedBytes.length.toString(),
      'Content-Disposition': 'inline; filename="truncated.pdf"',
    })
  } catch (error) {
    console.error('Error truncating PDF:', error)
    return c.json({
      error: 'Failed to truncate PDF',
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
})

export default pdfRouter
