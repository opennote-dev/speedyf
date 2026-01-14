import { Hono } from 'hono'
import { Mistral } from '@mistralai/mistralai'
import { truncatePdf } from './operations/truncation.js'
import { pdfToMarkdown } from './operations/ocr.js'

const MAX_PAGES = 999
const MAX_SIZE_BYTES = 49 * 1024 * 1024 // 49MB

const markdownRouter = new Hono()

markdownRouter.post('/', async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || ''
    let pdfBytes: Uint8Array
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

    const apiKey = process.env.MISTRAL_API_KEY
    if (!apiKey) {
      return c.json({ error: 'MISTRAL_API_KEY environment variable not set' }, 500)
    }

    const client = new Mistral({ apiKey })
    const truncatedBytes = await truncatePdf(pdfBytes, maxPages, maxSizeBytes)
    const result = await pdfToMarkdown(truncatedBytes, client)

    return c.json(result)
  } catch (error) {
    console.error('Error converting PDF to markdown:', error)
    return c.json({
      error: 'Failed to convert PDF to markdown',
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
      return c.json({ error: `Failed to fetch PDF: ${response.status}` }, 400)
    }

    const arrayBuffer = await response.arrayBuffer()
    const pdfBytes = new Uint8Array(arrayBuffer)
    const truncatedBytes = await truncatePdf(pdfBytes, maxPages, maxSizeBytes)
    const result = await pdfToMarkdown(truncatedBytes, client)

    return c.json(result)
  } catch (error) {
    console.error('Error converting PDF to markdown:', error)
    return c.json({
      error: 'Failed to convert PDF to markdown',
      details: error instanceof Error ? error.message : String(error)
    }, 500)
  }
})

export default markdownRouter
