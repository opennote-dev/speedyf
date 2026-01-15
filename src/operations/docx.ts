import * as mammoth from "../lib/mammoth.browser.js";
import TurndownService from "turndown";

export async function docxToMarkdown(fileBuffer: Uint8Array): Promise<string> {
  try {
    const td = new TurndownService();

    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(fileBuffer) },
      {
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Heading 4'] => h4:fresh",
          "p[style-name='Heading 5'] => h5:fresh",
          "p[style-name='Heading 6'] => h6:fresh",
        ],
      },
    );

    const markdown = td.turndown(result.value);

    return markdown;
  } catch (error) {
    console.error("Error converting DOCX to markdown:", error);
    throw new Error(
      `Failed to convert DOCX: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
