/**
 * Helpers to edit a single top-level key of the Xray template JSON (dns, routing, outbounds, …).
 */

export function extractSectionJson(root: Record<string, unknown>, key: string): string {
  if (!(key in root)) {
    return "{}";
  }
  return JSON.stringify(root[key], null, 2);
}

export function mergeSectionIntoTemplate(
  templateStr: string,
  key: string,
  sectionJson: string,
): string {
  const root = JSON.parse(templateStr) as Record<string, unknown>;
  const parsed = JSON.parse(sectionJson) as unknown;
  root[key] = parsed;
  return JSON.stringify(root, null, 2);
}

export function isTemplateJsonValid(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}
