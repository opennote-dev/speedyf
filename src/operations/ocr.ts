import { Mistral } from "@mistralai/mistralai";
import type { OCRResponse } from "@mistralai/mistralai/models/components/ocrresponse.js";
import mimeTypes from "mime-types";
import { docxToMarkdown } from "./docx.js";
import { truncateFile } from "./truncation.js";
import { extractPptx, pptxToMarkdown } from "./pptx.js";

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
  maxPages: number,
  maxSizeBytes: number,
): Promise<
  OCRResponse & {
    markdown: string;
    message?: string;
  } & {
    truncation: {
      wasTruncated: boolean;
      originalSize: number;
      finalSize: number;
    };
  }
> {
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
      truncation: {
        wasTruncated: false,
        originalSize: fileBytes.length,
        finalSize: fileBytes.length,
      },
    };
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    try {
      const markdown = await docxToMarkdown(fileBytes);

      if (markdown.trim().length >= 100) {
        return {
          markdown,
          pages: [
            {
              markdown,
              index: 0,
              images: [],
              dimensions: { width: 0, height: 0, dpi: 0 },
            },
          ],
          model: "mammoth-converter",
          usageInfo: { pagesProcessed: 1, docSizeBytes: fileBytes.length },
          truncation: {
            wasTruncated: false,
            originalSize: fileBytes.length,
            finalSize: fileBytes.length,
          },
        };
      }
      console.warn(
        "DOCX conversion resulted in <100 characters, falling back to Mistral OCR",
      );
    } catch (error) {
      console.error(
        "Error converting DOCX with mammoth, falling back to Mistral:",
        error,
      );
    }
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    try {
      const parsed = await extractPptx(fileBytes);
      const markdown = pptxToMarkdown(parsed);

      if (markdown.trim().length >= 100) {
        return {
          markdown,
          pages: parsed.slides.map((slide, index) => ({
            markdown: slide.content.map((c) => c.text.join(" ")).join("\n"),
            index,
            images: [],
            dimensions: { width: 0, height: 0, dpi: 0 },
          })),
          model: "pptx-converter",
          usageInfo: {
            pagesProcessed: parsed.slides.length,
            docSizeBytes: fileBytes.length,
          },
          truncation: {
            wasTruncated: false,
            originalSize: fileBytes.length,
            finalSize: fileBytes.length,
          },
        };
      }
      console.warn(
        "PPTX conversion resulted in <100 characters, falling back to Mistral OCR",
      );
    } catch (error) {
      console.error("Error converting PPTX, falling back to Mistral:", error);
    }
  }

  const truncationResult = await truncateFile(fileBytes, mimeType, {
    maxPages,
    maxSizeBytes,
  });

  const dataUrl = `data:${mimeType};base64,${toBase64(truncationResult.bytes)}`;

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
    truncation: {
      wasTruncated: truncationResult.wasTruncated,
      originalSize: truncationResult.originalSize,
      finalSize: truncationResult.finalSize,
    },
  };
}
