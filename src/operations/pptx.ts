// Implementation inspired by: https://github.com/OpenSourceLasagna/pptx-content-extractor/blob/main/main.ts

import JSZip, { type JSZipObject } from "jszip";
import { parseStringPromise } from "xml2js";

export interface ParsedContent {
  name: string;
  content: unknown;
}

/**
 * @property content: { id: string; type: string; text: string[] }[] - id type and text of slide elements
 * @property mediaNames: string[] - names of media Files
 */
export interface ParsedSlide extends ParsedContent {
  content: { id: string; type: string; text: string[] }[];
  mediaNames: string[];
}

/**
 * @property content: string is base64 encoded
 */
export interface ParsedMedia extends ParsedContent {
  content: string;
}

export interface ParsedNote extends ParsedContent {
  content: string;
}

export interface ParsedPptx {
  notes: ParsedNote[];
  media: ParsedMedia[];
  slides: ParsedSlide[];
}

/**
 * Extract text (slides + notes) and images from a .pptx file.
 * @param fileBuffer Buffer containing the .pptx file
 * @returns Promise of ParsedPptx with notes, media and slides
 */
export async function extractPptx(fileBuffer: Uint8Array): Promise<ParsedPptx> {
  const files = await loadFilesFromBuffer(fileBuffer);
  const {
    slides: rawSlides,
    media: rawMedia,
    notes: rawNotes,
  } = extractParts(files);

  const slides = await parsePart(rawSlides, parseSlideContent);
  const media = await parsePart(rawMedia, parseMediaContent);
  const notes = await parsePart(rawNotes, parseNotesContent);

  return {
    slides,
    media,
    notes,
  };
}

export async function extractPptxSlides(
  fileBuffer: Uint8Array,
): Promise<ParsedSlide[]> {
  const files = await loadFilesFromBuffer(fileBuffer);
  const rawSlides = getSlides(files);
  return await parsePart(rawSlides, parseSlideContent);
}

export async function extractPptxMedia(
  fileBuffer: Uint8Array,
): Promise<ParsedMedia[]> {
  const files = await loadFilesFromBuffer(fileBuffer);
  const rawSlides = getMedia(files);
  return await parsePart(rawSlides, parseMediaContent);
}

export async function extractPptxNotes(
  fileBuffer: Uint8Array,
): Promise<ParsedNote[]> {
  const files = await loadFilesFromBuffer(fileBuffer);
  const rawSlides = getNotes(files);
  return await parsePart(rawSlides, parseNotesContent);
}

async function loadFilesFromBuffer(
  fileBuffer: Uint8Array,
): Promise<{ [key: string]: JSZipObject }> {
  return (await loadPpt(fileBuffer)).files;
}

async function loadPpt(fileBuffer: Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(fileBuffer).catch((e) => {
    console.error(e);
    throw new Error("Failed to load .pptx file");
  });
}

async function parsePart<T extends ParsedContent>(
  toParse: JSZipObject[],
  parser: (a: JSZipObject) => Promise<T>,
): Promise<T[]> {
  return await Promise.all(toParse.map(async (part) => await parser(part)));
}

async function parseNotesContent(note: JSZipObject): Promise<ParsedNote> {
  const xml = await note.async("string");
  const parsed = await parseStringPromise(xml);

  // Extract text from notes
  let content = "";
  try {
    const textBody =
      parsed["p:notes"]?.["p:cSld"]?.[0]?.["p:spTree"]?.[0]?.["p:sp"];
    if (textBody) {
      const texts: string[] = [];
      textBody.forEach((shape: any) => {
        const paragraphs = shape["p:txBody"]?.[0]?.["a:p"];
        if (paragraphs) {
          paragraphs.forEach(
            (paragraph: { ["a:r"]?: { ["a:t"]?: string[] }[] }) => {
              const text =
                paragraph["a:r"]?.map((run) => run["a:t"]?.[0]).join(" ") || "";
              if (text) texts.push(text);
            },
          );
        }
      });
      content = texts.join("\n");
    }
  } catch (e) {
    console.error("Error parsing notes:", e);
  }

  return { name: note.name, content };
}

async function parseMediaContent(media: JSZipObject): Promise<ParsedMedia> {
  const binaries = await media.async("base64");
  const fileName = media.name.split("/").pop() || media.name;
  const mediaType = fileName.split(".").pop() || "unknown";
  return {
    name: media.name,
    content: `data:image/${mediaType};base64,${binaries}`,
  };
}

function getMediaIndexesInSlide(
  parsedSlide: string,
  search: string = "media/",
) {
  const indexes = [];
  let index = parsedSlide.indexOf(search);
  while (index !== -1) {
    indexes.push(index);
    index = parsedSlide.indexOf(search, index + 1);
  }
  return indexes;
}

function getMediaReferencesInSlide(
  parsedSlide: string,
  mediaIndex: number[],
  startOffset: number = 6,
) {
  return mediaIndex.map((i) => {
    const startIndex = i + startOffset;
    const endIndex = parsedSlide.indexOf('"', startIndex);
    return parsedSlide.slice(startIndex, endIndex);
  });
}

async function parseSlideContent(slide: JSZipObject): Promise<ParsedSlide> {
  const xml = await slide.async("string");
  const parsed = await parseStringPromise(xml);
  const parsedStringified = JSON.stringify(parsed);

  const results: ParsedSlide["content"] = [];
  const shapes = parsed["p:sld"]?.["p:cSld"]?.[0]?.["p:spTree"]?.[0]?.["p:sp"];

  const mediaNames = getMediaReferencesInSlide(
    parsedStringified,
    getMediaIndexesInSlide(parsedStringified),
  );

  if (shapes) {
    shapes.forEach((shape: any) => {
      const cNvPr = shape["p:nvSpPr"]?.[0]?.["p:cNvPr"]?.[0]?.["$"];
      const phType =
        shape["p:nvSpPr"]?.[0]?.["p:nvPr"]?.[0]?.["p:ph"]?.[0]?.["$"]?.[
          "type"
        ] || "unknown";
      const texts: string[] =
        (shape["p:txBody"]?.[0]?.["a:p"]
          ?.map((paragraph: { ["a:r"]?: { ["a:t"]?: string[] }[] }) => {
            return (
              paragraph["a:r"]?.map((run) => run["a:t"]?.[0]).join(" ") || ""
            );
          })
          .filter((text: string) => text) satisfies string[]) ||
        ([] satisfies string[]);

      if (cNvPr && texts.length > 0) {
        results.push({
          id: cNvPr.id,
          type: phType,
          text: texts,
        });
      }
    });
  }

  return {
    name: slide.name,
    content: results,
    mediaNames,
  };
}

function extractNumberFromName(fileName: string, pattern: RegExp): number {
  const match = fileName.match(pattern);
  return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function getPartByBasePathAndPattern(
  files: { [key: string]: JSZipObject },
  basePath: string,
  pattern: RegExp,
): JSZipObject[] {
  const partObjects = Object.keys(files)
    .filter((fileName) => fileName.startsWith(basePath))
    .map((fileName) => files[fileName]);

  partObjects.sort((a, b) => {
    const aNum = extractNumberFromName(a.name, pattern);
    const bNum = extractNumberFromName(b.name, pattern);
    return aNum - bNum;
  });

  return partObjects;
}

function getSlides(files: { [key: string]: JSZipObject }): JSZipObject[] {
  const slidesBasePath = "ppt/slides/";
  const slidePattern = /slide(\d+)\.xml(\.rels)?$/;
  return getPartByBasePathAndPattern(files, slidesBasePath, slidePattern);
}

function getMedia(files: { [key: string]: JSZipObject }): JSZipObject[] {
  const mediaBasePath = "ppt/media/";
  const mediaPattern = /(\d+)\.(jpg|jpeg|png|gif)$/;
  return getPartByBasePathAndPattern(files, mediaBasePath, mediaPattern);
}

function getNotes(files: { [key: string]: JSZipObject }): JSZipObject[] {
  const notesBasePath = "ppt/notesSlides/";
  const notesPattern = /notesSlide(\d+)\.xml(\.rels)?$/;
  return getPartByBasePathAndPattern(files, notesBasePath, notesPattern);
}

function extractParts(files: { [key: string]: JSZipObject }): {
  slides: JSZipObject[];
  media: JSZipObject[];
  notes: JSZipObject[];
} {
  return {
    slides: getSlides(files),
    media: getMedia(files),
    notes: getNotes(files),
  };
}

/**
 * Convert parsed PPTX to markdown text
 */
export function pptxToMarkdown(parsed: ParsedPptx): string {
  const markdownParts: string[] = [];

  parsed.slides.forEach((slide, index) => {
    markdownParts.push(`# Slide ${index + 1}\n`);

    slide.content.forEach((element) => {
      const text = element.text.join(" ");
      if (text) {
        if (element.type === "title" || element.type === "ctrTitle") {
          markdownParts.push(`## ${text}\n`);
        } else {
          markdownParts.push(`${text}\n`);
        }
      }
    });

    // Add notes if available
    if (parsed.notes[index] && parsed.notes[index].content) {
      markdownParts.push(`\n**Notes:** ${parsed.notes[index].content}\n`);
    }

    markdownParts.push("\n---\n");
  });

  return markdownParts.join("\n");
}