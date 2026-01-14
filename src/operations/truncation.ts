import { PDFDocument } from 'pdf-lib'

export async function truncatePdf(
  pdfBytes: Uint8Array,
  pageCount: number = 100,
  sizeBytes: number = 50 * 1024 * 1024 // 50MB
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  const totalPages = srcDoc.getPageCount()

  // Check if truncation is needed
  if (totalPages <= pageCount && pdfBytes.length <= sizeBytes) {
    return pdfBytes
  }

  const targetPageCount = Math.min(totalPages, pageCount)

  // Binary search to find optimal page count that fits within size limit
  let low = 1
  let high = targetPageCount
  let bestBytes: Uint8Array | null = null

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)

    const dstDoc = await PDFDocument.create()
    const pageIndices = Array.from({ length: mid }, (_, i) => i)
    const copiedPages = await dstDoc.copyPages(srcDoc, pageIndices)

    for (const page of copiedPages) {
      dstDoc.addPage(page)
    }

    const truncatedBytes = await dstDoc.save()

    if (truncatedBytes.length <= sizeBytes) {
      bestBytes = truncatedBytes
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  // Fallback to single page if no valid solution found
  if (bestBytes === null) {
    const dstDoc = await PDFDocument.create()
    const [firstPage] = await dstDoc.copyPages(srcDoc, [0])
    dstDoc.addPage(firstPage)
    bestBytes = await dstDoc.save()
  }

  return bestBytes
}
