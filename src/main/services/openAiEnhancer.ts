import fs from "node:fs/promises";
import path from "node:path";
import type { SearchResult } from "../../shared/types";

interface Enhancement {
  designId: number;
  explanation?: string;
  tags?: string[];
}

const DEFAULT_OPENAI_MODEL = process.env.FABRIC_FINDER_OPENAI_MODEL || "gpt-5.4-mini";

export class OpenAiEnhancer {
  async enhanceTopResults(options: {
    apiKey: string;
    queryImagePath: string;
    results: SearchResult[];
  }): Promise<Map<number, Enhancement>> {
    if (!options.apiKey || options.results.length === 0) return new Map();

    const topResults = options.results.slice(0, 3);
    const content: unknown[] = [
      {
        type: "input_text",
        text:
          "You are helping a textile manufacturer compare fabric designs. " +
          "For each candidate image, explain briefly why it visually matches the query and provide 3-6 concise tags. " +
          "Return JSON only as {\"matches\":[{\"designId\":number,\"explanation\":string,\"tags\":string[]}]}."
      },
      {
        type: "input_text",
        text: "Query image:"
      },
      await imagePart(options.queryImagePath)
    ];

    for (const result of topResults) {
      content.push({
        type: "input_text",
        text: `Candidate designId=${result.design.id}, number=${result.design.designNumber}, name=${result.design.designName}`
      });
      content.push(await imagePart(result.design.thumbnailPath || result.design.filePath));
    }

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: DEFAULT_OPENAI_MODEL,
          input: [
            {
              role: "user",
              content
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI enhancement failed: ${response.status} ${await response.text()}`);
      }

      const body = (await response.json()) as { output_text?: string; output?: unknown[] };
      const text = extractOutputText(body);
      const parsed = JSON.parse(text) as { matches?: Enhancement[] };
      return new Map((parsed.matches ?? []).map((match) => [match.designId, match]));
    } catch (error) {
      console.warn("Optional OpenAI enhancement failed.", error);
      return new Map();
    }
  }
}

async function imagePart(filePath: string): Promise<{ type: "input_image"; image_url: string }> {
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
          ? "image/gif"
          : "image/jpeg";
  const base64 = await fs.readFile(filePath, "base64");
  return {
    type: "input_image",
    image_url: `data:${mime};base64,${base64}`
  };
}

function extractOutputText(body: { output_text?: string; output?: unknown[] }): string {
  if (body.output_text) return body.output_text;

  const output = body.output ?? [];
  for (const item of output) {
    const record = item as { content?: Array<{ type?: string; text?: string }> };
    const text = record.content?.find((part) => part.type === "output_text" || part.text)?.text;
    if (text) return text;
  }

  return "{}";
}
