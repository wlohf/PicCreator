import { imageFilesFromFiles, mergeFloorPlanFiles } from "../src/utils/fileAttachments.js";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeFile(name: string, type: string, size = 1) {
  return new File(["x".repeat(size)], name, { type });
}

const floorA = makeFile("floor-a.png", "image/png", 4);
const duplicateFloorA = makeFile("floor-a.png", "image/png", 4);
const floorB = makeFile("floor-b.jpg", "image/jpeg", 6);
const pdf = makeFile("brief.pdf", "application/pdf", 3);

const filtered = imageFilesFromFiles([floorA, pdf, floorB]);
assert(filtered.length === 2, "imageFilesFromFiles should discard non-image files");
assert(filtered[0] === floorA && filtered[1] === floorB, "imageFilesFromFiles should preserve image order");

const merged = mergeFloorPlanFiles([floorA], [duplicateFloorA, floorB, pdf], true);
assert(merged.length === 2, "mergeFloorPlanFiles should dedupe floor plans by name and size");
assert(merged[0] === floorA && merged[1] === floorB, "mergeFloorPlanFiles should append new unique images");

const capped = mergeFloorPlanFiles([], Array.from({ length: 10 }, (_, index) => makeFile(`floor-${index}.png`, "image/png", index + 1)), false);
assert(capped.length === 8, "mergeFloorPlanFiles should cap floor plans at eight images");
