import { Mistral } from '@mistralai/mistralai'
import type { OCRResponse } from '@mistralai/mistralai/models/components/ocrresponse.js'

const MISTRAL_OCR_MODEL = 'mistral-ocr-latest'

const toBase64 = (bytes: Uint8Array): string => {
  return Buffer.from(bytes).toString('base64')
}

export async function pdfToMarkdown(
  pdfBytes: Uint8Array,
  client: Mistral
): Promise<OCRResponse & { markdown: string }> {
  const dataUrl = `data:application/pdf;base64,${toBase64(pdfBytes)}`

  const ocrResponse = await client.ocr.process({
    model: MISTRAL_OCR_MODEL,
    document: {
      type: 'document_url',
      documentUrl: dataUrl,
    },
    tableFormat: 'markdown',
    includeImageBase64: false,
  })

  const markdown = (ocrResponse.pages ?? [])
    .map((page) => page.markdown)
    .filter(Boolean)
    .join('\n\n---\n\n')

  return {
    markdown,
    ...ocrResponse
  }
}
