import { type Context } from "hono";
import { truncateFile, FileTooLargeError } from "./operations/truncation.js";
import { guessMimeType } from "./operations/ocr.js";
import {
  DEFAULT_MAX_PAGES,
  MAX_CHUNK_SIZE_BYTES,
  MAX_STREAMED_FILE_SIZE_BYTES,
  ONE_MIB,
} from "./config.js";

export const truncateStream = async (c: Context) => {
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
      c.req.header("X-Max-Size-Bytes") || String(MAX_CHUNK_SIZE_BYTES),
    );
    const paragraphsPerPage = c.req.header("X-Paragraphs-Per-Page")
      ? parseInt(c.req.header("X-Paragraphs-Per-Page")!)
      : undefined;
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

    const result = await truncateFile(fileBytes, mimeType, {
      maxPages,
      maxSizeBytes,
      paragraphsPerPage,
    });

    return c.body(new Uint8Array(result.bytes), 200, {
      "Content-Type": mimeType,
      "Content-Length": result.bytes.length.toString(),
      "X-Was-Truncated": result.wasTruncated.toString(),
      "X-Original-Size": result.originalSize.toString(),
      "X-Final-Size": result.finalSize.toString(),
    });
  } catch (error) {
    if (error instanceof FileTooLargeError) {
      return c.json({ error: error.message }, 413);
    }
    console.error("Error truncating file (stream):", error);
    return c.json(
      {
        error: "Failed to truncate file",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
};
