export function imageFilesFromFiles(files: readonly File[]) {
  return files.filter((file) => file.type.startsWith("image/"));
}

export function filesFromList(files: FileList | File[]) {
  return Array.from(files);
}

export function imageFilesFromClipboardItems(items: DataTransferItemList) {
  return Array.from(items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

function firstImageSrcFromHtml(html: string) {
  if (!html.trim()) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.querySelector("img[src]")?.getAttribute("src")?.trim() || "";
  } catch {
    const match = html.match(/<img\b[^>]*\bsrc=(["']?)([^"'\s>]+)\1/i);
    return match?.[2]?.trim() || "";
  }
}

function isImageLikeClipboardUrl(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (text.startsWith("data:image/")) return true;
  if (/\/api\/results\/[^/]+\/(?:image|download)(?:[?#].*)?$/i.test(text)) return true;
  return /^https?:\/\/.+\.(?:png|jpe?g|webp|gif|bmp|avif)(?:[?#].*)?$/i.test(text);
}

export function imageSourcesFromClipboardData(data: Pick<DataTransfer, "getData">) {
  const sources = [
    firstImageSrcFromHtml(data.getData("text/html") || ""),
    data.getData("text/uri-list") || "",
    data.getData("text/plain") || "",
  ];
  return sources
    .map((source) => source.trim())
    .filter(isImageLikeClipboardUrl)
    .filter((source, index, list) => list.indexOf(source) === index);
}

export function mergeFloorPlanFiles(current: File[], incoming: readonly File[], append = false, limit = 8) {
  const imageFiles = imageFilesFromFiles(incoming);
  const next = append ? [...current, ...imageFiles] : imageFiles;
  return next
    .filter((file, index, list) => list.findIndex((item) => item.name === file.name && item.size === file.size) === index)
    .slice(0, limit);
}
