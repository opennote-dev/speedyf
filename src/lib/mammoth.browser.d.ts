export interface ConvertToHtmlOptions {
  arrayBuffer?: ArrayBuffer;
  styleMap?: string[];
}

export interface ConvertToHtmlResult {
  value: string;
  messages: Array<{
    type: string;
    message: string;
  }>;
}

export function convertToHtml(
  input: ConvertToHtmlOptions,
  options?: { styleMap?: string[] },
): Promise<ConvertToHtmlResult>;
