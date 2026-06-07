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

export function mergeFloorPlanFiles(current: File[], incoming: readonly File[], append = false, limit = 8) {
  const imageFiles = imageFilesFromFiles(incoming);
  const next = append ? [...current, ...imageFiles] : imageFiles;
  return next
    .filter((file, index, list) => list.findIndex((item) => item.name === file.name && item.size === file.size) === index)
    .slice(0, limit);
}
