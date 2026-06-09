import path from "node:path";
import type { MetadataParts } from "../../shared/types";

function cleanText(value: string): string {
  return value
    .replace(/[_]+/g, " ")
    .replace(/\s+-\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferMetadataFromPath(filePath: string, sourceRoot: string): MetadataParts {
  const ext = path.extname(filePath);
  const stem = cleanText(path.basename(filePath, ext));
  const folderName = cleanText(path.basename(path.dirname(filePath)));
  const rootName = cleanText(path.basename(sourceRoot));

  const numberMatch =
    stem.match(/\b([A-Za-z]{0,6}[-_ ]?\d{2,}[A-Za-z0-9-]*)\b/) ??
    stem.match(/\b([A-Za-z0-9]{3,})\b/);

  const designNumber = cleanText(numberMatch?.[1] ?? stem);
  const variant = cleanText(stem.replace(numberMatch?.[0] ?? "", "")) || stem;
  const designName = folderName || rootName || "Uncategorized";

  return {
    designNumber,
    designName,
    variant
  };
}
