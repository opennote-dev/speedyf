import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { parseStringPromise, Builder } from "xml2js";

const DEFAULT_MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const DEFAULT_MAX_PAGES = 100;

const PDF_MIME_TYPES = ["application/pdf"] as const;

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

const TEXT_MIME_TYPES = [
  "application/xml",
  "application/x-troff-man",
  "application/x-ipynb+json",
] as const;

const BINARY_DOCUMENT_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/epub+zip",
  "application/rtf",
  "application/vnd.oasis.opendocument.text", // .odt
  "application/x-fictionbook+xml", // .fb2
] as const;

export class FileTooLargeError extends Error {
  constructor(
    public readonly actualSize: number,
    public readonly maxSize: number,
    public readonly mimeType: string,
  ) {
    const actualMB = (actualSize / (1024 * 1024)).toFixed(2);
    const maxMB = (maxSize / (1024 * 1024)).toFixed(2);
    super(
      `File too large: ${actualMB}MB exceeds maximum ${maxMB}MB for ${mimeType}`,
    );
    this.name = "FileTooLargeError";
  }
}

export interface TruncationOptions {
  maxPages?: number;
  maxSizeBytes?: number;
  paragraphsPerPage?: number;
}

export interface TruncationResult {
  bytes: Uint8Array;
  wasTruncated: boolean;
  originalSize: number;
  finalSize: number;
}

export async function truncateFile(
  fileBytes: Uint8Array,
  mimeType: string,
  options: TruncationOptions = {},
): Promise<TruncationResult> {
  const {
    maxPages = DEFAULT_MAX_PAGES,
    maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
  } = options;

  if (PDF_MIME_TYPES.includes(mimeType as (typeof PDF_MIME_TYPES)[number])) {
    return truncatePdfFile(fileBytes, maxPages, maxSizeBytes);
  }

  if (TEXT_MIME_TYPES.includes(mimeType as (typeof TEXT_MIME_TYPES)[number])) {
    return truncateTextFile(fileBytes, maxSizeBytes);
  }

  if (
    IMAGE_MIME_TYPES.includes(mimeType as (typeof IMAGE_MIME_TYPES)[number])
  ) {
    return validateFileSize(fileBytes, mimeType, maxSizeBytes);
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return truncatePptxFile(fileBytes, maxPages, maxSizeBytes);
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return truncateDocxFile(
      fileBytes,
      maxPages,
      maxSizeBytes,
      options.paragraphsPerPage,
    );
  }

  if (
    BINARY_DOCUMENT_MIME_TYPES.includes(
      mimeType as (typeof BINARY_DOCUMENT_MIME_TYPES)[number],
    )
  ) {
    return validateFileSize(fileBytes, mimeType, maxSizeBytes);
  }

  return validateFileSize(fileBytes, mimeType, maxSizeBytes);
}

function validateFileSize(
  fileBytes: Uint8Array,
  mimeType: string,
  maxSizeBytes: number,
): TruncationResult {
  if (fileBytes.length > maxSizeBytes) {
    throw new FileTooLargeError(fileBytes.length, maxSizeBytes, mimeType);
  }

  return {
    bytes: fileBytes,
    wasTruncated: false,
    originalSize: fileBytes.length,
    finalSize: fileBytes.length,
  };
}

function truncateTextFile(
  fileBytes: Uint8Array,
  maxSizeBytes: number,
): TruncationResult {
  const originalSize = fileBytes.length;

  if (fileBytes.length <= maxSizeBytes) {
    return {
      bytes: fileBytes,
      wasTruncated: false,
      originalSize,
      finalSize: fileBytes.length,
    };
  }

  let truncatedBytes = fileBytes.slice(0, maxSizeBytes);

  // Try to find a good truncation point (newline or space) in the last 1KB
  const searchRange = Math.min(1024, maxSizeBytes);
  const searchStart = maxSizeBytes - searchRange;

  let bestBreakPoint = maxSizeBytes;
  for (let i = maxSizeBytes - 1; i >= searchStart; i--) {
    const byte = truncatedBytes[i];
    // Look for newline (10) or carriage return (13) or space (32)
    if (byte === 10 || byte === 13 || byte === 32) {
      bestBreakPoint = i + 1;
      break;
    }
  }

  truncatedBytes = truncatedBytes.slice(0, bestBreakPoint);

  const truncationNote = "\n\n[Content truncated due to size limits...]";
  const truncationBytes = new TextEncoder().encode(truncationNote);

  const finalBytes = new Uint8Array(
    truncatedBytes.length + truncationBytes.length,
  );
  finalBytes.set(truncatedBytes);
  finalBytes.set(truncationBytes, truncatedBytes.length);

  return {
    bytes: finalBytes,
    wasTruncated: true,
    originalSize,
    finalSize: finalBytes.length,
  };
}

async function truncatePdfFile(
  pdfBytes: Uint8Array,
  maxPages: number,
  maxSizeBytes: number,
): Promise<TruncationResult> {
  const originalSize = pdfBytes.length;
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  if (totalPages <= maxPages && pdfBytes.length <= maxSizeBytes) {
    return {
      bytes: pdfBytes,
      wasTruncated: false,
      originalSize,
      finalSize: pdfBytes.length,
    };
  }

  const targetPageCount = Math.min(totalPages, maxPages);

  // Binary search to find optimal page count that fits within size limit
  let low = 1;
  let high = targetPageCount;
  let bestBytes: Uint8Array | null = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    const dstDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: mid }, (_, i) => i);
    const copiedPages = await dstDoc.copyPages(srcDoc, pageIndices);

    for (const page of copiedPages) {
      dstDoc.addPage(page);
    }

    const truncatedBytes = await dstDoc.save();

    if (truncatedBytes.length <= maxSizeBytes) {
      bestBytes = truncatedBytes;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (bestBytes === null) {
    const dstDoc = await PDFDocument.create();
    const [firstPage] = await dstDoc.copyPages(srcDoc, [0]);
    dstDoc.addPage(firstPage);
    bestBytes = await dstDoc.save();
  }

  return {
    bytes: bestBytes,
    wasTruncated: true,
    originalSize,
    finalSize: bestBytes.length,
  };
}

async function truncatePptxFile(
  fileBytes: Uint8Array,
  maxSlides: number,
  maxSizeBytes: number,
): Promise<TruncationResult> {
  const originalSize = fileBytes.length;
  const buffer = Buffer.from(fileBytes);

  const zip = await JSZip.loadAsync(buffer);

  // Get slide files sorted by number
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] || "0");
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  const totalSlides = slideFiles.length;

  if (totalSlides <= maxSlides && fileBytes.length <= maxSizeBytes) {
    return {
      bytes: fileBytes,
      wasTruncated: false,
      originalSize,
      finalSize: fileBytes.length,
    };
  }

  // Iterative reduction: binary search to find max slides that fit within size limit
  let low = 1;
  let high = Math.min(totalSlides, maxSlides);
  let bestResult: { bytes: Uint8Array; slides: number } | null = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const result = await truncatePptxToSlides(fileBytes, mid);

    if (result.bytes.length <= maxSizeBytes) {
      bestResult = { bytes: result.bytes, slides: mid };
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  // If no result fits, try with just 1 slide
  if (bestResult === null) {
    const result = await truncatePptxToSlides(fileBytes, 1);
    bestResult = { bytes: result.bytes, slides: 1 };
  }

  return {
    bytes: bestResult.bytes,
    wasTruncated: true,
    originalSize,
    finalSize: bestResult.bytes.length,
  };
}

async function truncatePptxToSlides(
  fileBytes: Uint8Array,
  maxSlides: number,
): Promise<{ bytes: Uint8Array }> {
  const buffer = Buffer.from(fileBytes);
  const zip = await JSZip.loadAsync(buffer);
  const builder = new Builder({ headless: true });

  // Get slide files sorted by number
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] || "0");
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  // Track which slides we're keeping (by number)
  const keepSlideNumbers = new Set(
    slideFiles.slice(0, maxSlides).map((f) => f.match(/slide(\d+)/)?.[1]),
  );

  // Remove excess slides and their rels
  for (let i = maxSlides; i < slideFiles.length; i++) {
    const slideFile = slideFiles[i];
    const relsFile = slideFile.replace("slides/", "slides/_rels/") + ".rels";
    zip.remove(slideFile);
    if (zip.files[relsFile]) zip.remove(relsFile);
  }

  // Update presentation.xml.rels
  const presRelsPath = "ppt/_rels/presentation.xml.rels";
  const presRelsXml = await zip.file(presRelsPath)?.async("string");
  const removedSlideRelIds = new Set<string>();

  if (presRelsXml) {
    const parsed = await parseStringPromise(presRelsXml, {
      explicitArray: true,
    });
    const relationships = parsed.Relationships?.Relationship || [];

    const keptRelationships: any[] = [];
    for (const rel of relationships) {
      const target = rel.$?.Target;
      const slideMatch = target?.match(/slides\/slide(\d+)\.xml$/);

      if (!slideMatch) {
        keptRelationships.push(rel);
      } else if (keepSlideNumbers.has(slideMatch[1])) {
        keptRelationships.push(rel);
      } else {
        removedSlideRelIds.add(rel.$?.Id);
      }
    }

    parsed.Relationships.Relationship = keptRelationships;
    zip.file(presRelsPath, builder.buildObject(parsed));
  }

  // Update presentation.xml - remove sldIdLst entries
  const presPath = "ppt/presentation.xml";
  const presXml = await zip.file(presPath)?.async("string");

  if (presXml) {
    const parsed = await parseStringPromise(presXml, { explicitArray: true });
    const sldIdLst = parsed["p:presentation"]?.["p:sldIdLst"]?.[0]?.["p:sldId"];

    if (sldIdLst) {
      // Filter out entries that reference removed slides
      parsed["p:presentation"]["p:sldIdLst"][0]["p:sldId"] = sldIdLst.filter(
        (sld: any) => !removedSlideRelIds.has(sld.$?.["r:id"]),
      );
    }

    zip.file(presPath, builder.buildObject(parsed));
  }

  // Update [Content_Types].xml
  const contentTypesPath = "[Content_Types].xml";
  const contentTypesXml = await zip.file(contentTypesPath)?.async("string");

  if (contentTypesXml) {
    const parsed = await parseStringPromise(contentTypesXml, {
      explicitArray: true,
    });
    const overrides = parsed.Types?.Override || [];

    parsed.Types.Override = overrides.filter((o: any) => {
      const partName = o.$?.PartName;
      const slideMatch = partName?.match(/\/ppt\/slides\/slide(\d+)\.xml$/);
      if (!slideMatch) return true;
      return keepSlideNumbers.has(slideMatch[1]);
    });

    zip.file(contentTypesPath, builder.buildObject(parsed));
  }

  // Clean up orphaned media (images only used by removed slides)
  await cleanupOrphanedPptxMedia(zip, builder);

  const resultBuffer = await zip.generateAsync({ type: "nodebuffer" });

  return {
    bytes: new Uint8Array(resultBuffer),
  };
}

async function cleanupOrphanedPptxMedia(
  zip: JSZip,
  builder: Builder,
): Promise<void> {
  // Collect all relationship targets from remaining slide rels
  const usedMediaPaths = new Set<string>();

  const slideRelFiles = Object.keys(zip.files).filter((f) =>
    /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(f),
  );

  for (const relsFile of slideRelFiles) {
    const xml = await zip.file(relsFile)?.async("string");
    if (!xml) continue;

    const parsed = await parseStringPromise(xml, { explicitArray: true });
    const relationships = parsed.Relationships?.Relationship || [];

    for (const rel of relationships) {
      const target = rel.$?.Target;
      if (target) {
        // Normalize path (targets are relative like ../media/image1.png)
        const normalized = target.replace(/^\.\.\//, "ppt/");
        usedMediaPaths.add(normalized);
      }
    }
  }

  // Remove media files not referenced by any remaining slide
  const mediaFiles = Object.keys(zip.files).filter((f) =>
    f.startsWith("ppt/media/"),
  );

  for (const mediaFile of mediaFiles) {
    if (!usedMediaPaths.has(mediaFile)) {
      zip.remove(mediaFile);
    }
  }

  // Update [Content_Types].xml to remove orphaned media entries
  const contentTypesPath = "[Content_Types].xml";
  const contentTypesXml = await zip.file(contentTypesPath)?.async("string");

  if (contentTypesXml) {
    const parsed = await parseStringPromise(contentTypesXml, {
      explicitArray: true,
    });
    const overrides = parsed.Types?.Override || [];

    parsed.Types.Override = overrides.filter((o: any) => {
      const partName = o.$?.PartName;
      if (!partName?.includes("/ppt/media/")) return true;
      const normalized = partName.startsWith("/")
        ? partName.slice(1)
        : partName;
      return usedMediaPaths.has(normalized);
    });

    zip.file(contentTypesPath, builder.buildObject(parsed));
  }
}

async function truncateDocxFile(
  fileBytes: Uint8Array,
  maxPages: number,
  maxSizeBytes: number,
  paragraphsPerPage?: number,
): Promise<TruncationResult> {
  // Default heuristic: ~15 paragraphs per page (based on typical document formatting)
  const DEFAULT_PARAGRAPHS_PER_PAGE = 15;
  const actualParagraphsPerPage =
    paragraphsPerPage ?? DEFAULT_PARAGRAPHS_PER_PAGE;
  const initialMaxParagraphs = maxPages * actualParagraphsPerPage;
  const originalSize = fileBytes.length;

  // Check if no truncation needed
  const buffer = Buffer.from(fileBytes);
  const zip = await JSZip.loadAsync(buffer);
  const docPath = "word/document.xml";
  const docXml = await zip.file(docPath)?.async("string");
  if (!docXml) {
    throw new Error("Invalid DOCX: missing document.xml");
  }

  const parsed = await parseStringPromise(docXml, { explicitArray: true });
  const body = parsed["w:document"]["w:body"][0];
  const totalParagraphs = (body["w:p"] || []).length;

  if (
    totalParagraphs <= initialMaxParagraphs &&
    fileBytes.length <= maxSizeBytes
  ) {
    return {
      bytes: fileBytes,
      wasTruncated: false,
      originalSize,
      finalSize: fileBytes.length,
    };
  }

  // Iterative reduction: binary search to find max paragraphs that fit within size limit
  let low = 1;
  let high = Math.min(totalParagraphs, initialMaxParagraphs);
  let bestResult: { bytes: Uint8Array; paragraphs: number } | null = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const result = await truncateDocxToParagraphs(fileBytes, mid);

    if (result.bytes.length <= maxSizeBytes) {
      bestResult = { bytes: result.bytes, paragraphs: mid };
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  // If no result fits, try with just 1 paragraph
  if (bestResult === null) {
    const result = await truncateDocxToParagraphs(fileBytes, 1);
    bestResult = { bytes: result.bytes, paragraphs: 1 };
  }

  return {
    bytes: bestResult.bytes,
    wasTruncated: true,
    originalSize,
    finalSize: bestResult.bytes.length,
  };
}

async function truncateDocxToParagraphs(
  fileBytes: Uint8Array,
  maxParagraphs: number,
): Promise<{ bytes: Uint8Array }> {
  const buffer = Buffer.from(fileBytes);
  const zip = await JSZip.loadAsync(buffer);
  const builder = new Builder({ headless: true });

  // 1. Truncate document.xml and collect used relationship IDs
  const docPath = "word/document.xml";
  const docXml = await zip.file(docPath)?.async("string");
  if (!docXml) {
    throw new Error("Invalid DOCX: missing document.xml");
  }

  const parsed = await parseStringPromise(docXml, { explicitArray: true });
  const body = parsed["w:document"]["w:body"][0];

  const paragraphs = body["w:p"] || [];
  const tables = body["w:tbl"] || [];
  const sectPr = body["w:sectPr"]?.[0];

  // Truncate paragraphs
  if (paragraphs.length > maxParagraphs) {
    body["w:p"] = paragraphs.slice(0, maxParagraphs);
  }

  // Remove tables that come after the truncated content
  if (paragraphs.length > maxParagraphs && tables.length > 0) {
    // Keep tables proportionally
    const keepRatio = maxParagraphs / paragraphs.length;
    const keepTables = Math.floor(tables.length * keepRatio);
    body["w:tbl"] = tables.slice(0, keepTables);
  }

  // Preserve section properties
  if (sectPr) {
    body["w:sectPr"] = [sectPr];
  }

  // Collect all relationship IDs still in use
  const usedRelIds = collectRelationshipIds(parsed);

  zip.file(docPath, builder.buildObject(parsed));

  // 2. Clean up document.xml.rels
  const docRelsPath = "word/_rels/document.xml.rels";
  const docRelsXml = await zip.file(docRelsPath)?.async("string");
  const removedTargets = new Set<string>();

  if (docRelsXml) {
    const relsParsed = await parseStringPromise(docRelsXml, {
      explicitArray: true,
    });
    const relationships = relsParsed.Relationships?.Relationship || [];

    const keptRelationships: any[] = [];
    for (const rel of relationships) {
      const id = rel.$?.Id;
      const target = rel.$?.Target;
      const type = rel.$?.Type || "";

      const isRequired = isRequiredDocxRelationship(type);
      if (isRequired || usedRelIds.has(id)) {
        keptRelationships.push(rel);
      } else if (target && !target.startsWith("http")) {
        removedTargets.add(normalizeTarget(target));
      }
    }

    relsParsed.Relationships.Relationship = keptRelationships;
    zip.file(docRelsPath, builder.buildObject(relsParsed));
  }

  // 3. Remove orphaned media/embedding files
  for (const target of removedTargets) {
    const fullPath = target.startsWith("word/") ? target : `word/${target}`;
    if (zip.files[fullPath]) {
      zip.remove(fullPath);
    }
  }

  // 4. Clean up [Content_Types].xml
  const contentTypesPath = "[Content_Types].xml";
  const contentTypesXml = await zip.file(contentTypesPath)?.async("string");

  if (contentTypesXml) {
    const ctParsed = await parseStringPromise(contentTypesXml, {
      explicitArray: true,
    });
    const overrides = ctParsed.Types?.Override || [];

    ctParsed.Types.Override = overrides.filter((o: any) => {
      const partName = o.$?.PartName;
      if (!partName) return true;
      const normalized = partName.startsWith("/")
        ? partName.slice(1)
        : partName;
      return !removedTargets.has(normalized);
    });

    zip.file(contentTypesPath, builder.buildObject(ctParsed));
  }

  // 5. Clean up footnotes, endnotes, comments
  await cleanupFootnotes(zip, parsed, builder);
  await cleanupEndnotes(zip, parsed, builder);
  await cleanupComments(zip, parsed, builder);

  const resultBuffer = await zip.generateAsync({ type: "nodebuffer" });

  return {
    bytes: new Uint8Array(resultBuffer),
  };
}

function collectRelationshipIds(
  obj: any,
  ids = new Set<string>(),
): Set<string> {
  if (!obj || typeof obj !== "object") return ids;

  if (obj.$) {
    for (const attr of Object.keys(obj.$)) {
      if (attr === "r:id" || attr === "r:embed" || attr === "r:link") {
        ids.add(obj.$[attr]);
      }
    }
  }

  for (const key of Object.keys(obj)) {
    if (key === "$") continue;
    const val = obj[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        collectRelationshipIds(item, ids);
      }
    } else if (typeof val === "object") {
      collectRelationshipIds(val, ids);
    }
  }

  return ids;
}

function isRequiredDocxRelationship(type: string): boolean {
  const requiredTypes = [
    "styles",
    "settings",
    "webSettings",
    "fontTable",
    "theme",
    "numbering",
    "footnotes",
    "endnotes",
    "comments",
  ];
  return requiredTypes.some((t) =>
    type.toLowerCase().includes(t.toLowerCase()),
  );
}

function normalizeTarget(target: string): string {
  return target.replace(/^(\.\.\/|\/)+/, "");
}

async function cleanupFootnotes(
  zip: JSZip,
  docParsed: any,
  builder: Builder,
): Promise<void> {
  const footnotesPath = "word/footnotes.xml";
  const footnotesXml = await zip.file(footnotesPath)?.async("string");
  if (!footnotesXml) return;

  const usedFootnoteIds = collectElementIds(
    docParsed,
    "w:footnoteReference",
    "w:id",
  );

  const parsed = await parseStringPromise(footnotesXml, {
    explicitArray: true,
  });
  const footnotes = parsed["w:footnotes"]?.["w:footnote"] || [];

  parsed["w:footnotes"]["w:footnote"] = footnotes.filter((fn: any) => {
    const id = fn.$?.["w:id"];
    // Keep separator/continuation footnotes (ids -1, 0) and used ones
    return id === "-1" || id === "0" || usedFootnoteIds.has(id);
  });

  zip.file(footnotesPath, builder.buildObject(parsed));
}

async function cleanupEndnotes(
  zip: JSZip,
  docParsed: any,
  builder: Builder,
): Promise<void> {
  const endnotesPath = "word/endnotes.xml";
  const endnotesXml = await zip.file(endnotesPath)?.async("string");
  if (!endnotesXml) return;

  const usedEndnoteIds = collectElementIds(
    docParsed,
    "w:endnoteReference",
    "w:id",
  );

  const parsed = await parseStringPromise(endnotesXml, { explicitArray: true });
  const endnotes = parsed["w:endnotes"]?.["w:endnote"] || [];

  parsed["w:endnotes"]["w:endnote"] = endnotes.filter((en: any) => {
    const id = en.$?.["w:id"];
    return id === "-1" || id === "0" || usedEndnoteIds.has(id);
  });

  zip.file(endnotesPath, builder.buildObject(parsed));
}

async function cleanupComments(
  zip: JSZip,
  docParsed: any,
  builder: Builder,
): Promise<void> {
  const commentsPath = "word/comments.xml";
  const commentsXml = await zip.file(commentsPath)?.async("string");
  if (!commentsXml) return;

  const usedCommentIds = new Set<string>();
  collectElementIds(docParsed, "w:commentReference", "w:id", usedCommentIds);
  collectElementIds(docParsed, "w:commentRangeStart", "w:id", usedCommentIds);

  const parsed = await parseStringPromise(commentsXml, { explicitArray: true });
  const comments = parsed["w:comments"]?.["w:comment"] || [];

  parsed["w:comments"]["w:comment"] = comments.filter((c: any) => {
    const id = c.$?.["w:id"];
    return usedCommentIds.has(id);
  });

  zip.file(commentsPath, builder.buildObject(parsed));
}

function collectElementIds(
  obj: any,
  elementName: string,
  attrName: string,
  ids = new Set<string>(),
): Set<string> {
  if (!obj || typeof obj !== "object") return ids;

  if (obj[elementName]) {
    const elements = Array.isArray(obj[elementName])
      ? obj[elementName]
      : [obj[elementName]];
    for (const el of elements) {
      const id = el?.$?.[attrName];
      if (id) ids.add(id);
    }
  }

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        collectElementIds(item, elementName, attrName, ids);
      }
    } else if (typeof val === "object") {
      collectElementIds(val, elementName, attrName, ids);
    }
  }

  return ids;
}
