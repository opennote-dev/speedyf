import { Mistral } from "@mistralai/mistralai";
import type { OCRResponse } from "@mistralai/mistralai/models/components/ocrresponse.js";
import mimeTypes from "mime-types";

const MISTRAL_OCR_MODEL = "mistral-ocr-latest";

const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/epub+zip",
  "application/rtf",
  "application/vnd.oasis.opendocument.text", // .odt
  "application/x-fictionbook+xml", // .fb2
] as const;

const TEXT_MIME_TYPES = [
  "text/plain",
  "application/xml",
  "text/xml",
  "text/x-bibtex",
  "text/x-tex",
  "text/x-opml",
  "application/x-troff-man",
  "application/x-ipynb+json",
] as const;

const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/avif",
  "image/tiff",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/webp",
] as const;

const SUPPORTED_MIME_TYPES = [
  ...DOCUMENT_MIME_TYPES,
  ...IMAGE_MIME_TYPES,
  ...TEXT_MIME_TYPES,
] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export function isTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_TYPES.includes(mimeType as (typeof TEXT_MIME_TYPES)[number]);
}

export class InvalidFileTypeError extends Error {
  constructor(mimeType: string) {
    super(
      `Invalid file type: ${mimeType}. Supported types: ${SUPPORTED_MIME_TYPES.join(", ")}`,
    );
    this.name = "InvalidFileTypeError";
  }
}

export function isSupportedMimeType(
  mimeType: string,
): mimeType is SupportedMimeType {
  return SUPPORTED_MIME_TYPES.includes(mimeType as SupportedMimeType);
}

export function validateMimeType(mimeType: string): void {
  if (!isSupportedMimeType(mimeType)) {
    throw new InvalidFileTypeError(mimeType);
  }
}

export function guessMimeType(filename?: string, fallback?: string): string {
  if (filename) {
    const guessed = mimeTypes.lookup(filename);
    if (guessed) return guessed;
  }
  return fallback || "application/pdf";
}

const toBase64 = (bytes: Uint8Array): string => {
  return Buffer.from(bytes).toString("base64");
};

export async function pdfToMarkdown(
  fileBytes: Uint8Array,
  client: Mistral,
  mimeType: string = "application/pdf",
): Promise<OCRResponse & { markdown: string; message?: string }> {
  validateMimeType(mimeType);

  if (isTextMimeType(mimeType)) {
    const textContent = new TextDecoder().decode(fileBytes);
    return {
      markdown: textContent,
      pages: [
        {
          markdown: textContent,
          index: 0,
          images: [],
          dimensions: { width: 0, height: 0, dpi: 0 },
        },
      ],
      model: "text-passthrough",
      usageInfo: { pagesProcessed: 1, docSizeBytes: fileBytes.length },
      message: "You should think about why a text file needs OCR",
    };
  }

  const dataUrl = `data:${mimeType};base64,${toBase64(fileBytes)}`;

  const ocrResponse = await client.ocr.process({
    model: MISTRAL_OCR_MODEL,
    document: {
      type: "document_url",
      documentUrl: dataUrl,
    },
    tableFormat: "markdown",
    imageLimit: 0,
  });

  const markdown = (ocrResponse.pages ?? [])
    .map((page) => page.markdown)
    .filter(Boolean)
    .join("\n\n---\n\n");

  return {
    markdown,
    ...ocrResponse,
  };
}
