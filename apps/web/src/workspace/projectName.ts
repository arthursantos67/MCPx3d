export function normalizeProjectName(name: string): string {
  const normalized = name
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 64);
  return normalized || "model";
}

export function artifactFilename(name: string, revision: number, extension: string): string {
  return `${normalizeProjectName(name)}-r${revision.toString().padStart(4, "0")}.${extension}`;
}
