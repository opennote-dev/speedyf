import { type Context } from "hono";
import { Mistral } from "@mistralai/mistralai";
import { truncateFile, FileTooLargeError } from "./operations/truncation.js";
import {
  pdfToMarkdown,
  InvalidFileTypeError,
  guessMimeType,
} from "./operations/ocr.js";
import {
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_MAX_PAGES,
  MAX_STREAMED_FILE_SIZE_BYTES,
  ONE_MIB,
} from "./config.js";

export const markdownStream = async (c: Context) => {
  try {
    const contentType = c.req.header("Content-Type") || "";

    if (
      !contentType.includes("application/octet-stream") &&
      !contentType.includes("multipart/form-data")
    ) {
      return c.json(
        {
          error:
            "Content-Type must be application/octet-stream or multipart/form-data for streaming",
        },
        400,
      );
    }

    const mimeTypeHeader = c.req.header("X-File-MimeType") || "application/pdf";
    const maxPages = parseInt(
      c.req.header("X-Max-Pages") || String(DEFAULT_MAX_PAGES),
    );
    const maxSizeBytes = parseInt(
      c.req.header("X-Max-Size-Bytes") || String(DEFAULT_MAX_FILE_SIZE_BYTES),
    );
    const filename = c.req.header("X-File-Name") || "";

    const reader = c.req.raw.body?.getReader();
    if (!reader) {
      return c.json({ error: "No request body found" }, 400);
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        if (value) {
          chunks.push(value);
          totalSize += value.length;

          if (totalSize > MAX_STREAMED_FILE_SIZE_BYTES) {
            return c.json(
              {
                error: `File too large: exceeds ${MAX_STREAMED_FILE_SIZE_BYTES / ONE_MIB}MB streaming limit`,
              },
              413,
            );
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const fileBytes = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      fileBytes.set(chunk, offset);
      offset += chunk.length;
    }

    const mimeType =
      mimeTypeHeader === "application/octet-stream" && filename
        ? guessMimeType(filename, mimeTypeHeader)
        : mimeTypeHeader;

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      return c.json(
        { error: "MISTRAL_API_KEY environment variable not set" },
        500,
      );
    }

    const client = new Mistral({ apiKey });
    const truncationResult = await truncateFile(fileBytes, mimeType, {
      maxPages,
      maxSizeBytes,
    });
    const result = await pdfToMarkdown(
      truncationResult.bytes,
      client,
      mimeType,
    );

    return c.json({
      ...result,
      truncation: {
        wasTruncated: truncationResult.wasTruncated,
        originalSize: truncationResult.originalSize,
        finalSize: truncationResult.finalSize,
      },
    });
  } catch (error) {
    if (error instanceof InvalidFileTypeError) {
      return c.json({ error: error.message }, 400);
    }
    if (error instanceof FileTooLargeError) {
      return c.json({ error: error.message }, 413);
    }
    console.error("Error converting file to markdown (stream):", error);
    return c.json(
      {
        error: "Failed to convert file to markdown",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
};
