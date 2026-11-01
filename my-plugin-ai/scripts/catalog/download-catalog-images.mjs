/* eslint-env node */
// Download the product photos used by data/catalog/fashion-catalog.json.
//
// Images live inside the Marqo/KAGL parquet files (about 30 MB per row group); the
// catalog builder keeps products within a few row groups so this stays around 0.5 GB.
// Files are written to data/catalog/images/<itemId>.jpg and skipped if already present.
//
// Usage (from my-plugin-ai/):
//   node scripts/catalog/download-catalog-images.mjs

import fs from "fs";
import path from "path";
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import { kaglFileUrl } from "./kagl.mjs";

const CATALOG_DIR = path.join("data", "catalog");

async function main() {
  const catalog = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, "fashion-catalog.json"), "utf8"));
  const missing = catalog.products
    .map((product) => product.image)
    .filter((image) => !fs.existsSync(path.join(CATALOG_DIR, image.path)));

  if (missing.length === 0) {
    console.log("All catalog images are already downloaded.");
    return;
  }

  // Group by parquet file and row group so each ~30 MB chunk is read once.
  const groups = new Map();
  for (const image of missing) {
    const key = `${image.file}:${image.rowGroup}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(image);
  }
  fs.mkdirSync(path.join(CATALOG_DIR, "images"), { recursive: true });
  console.log(`Downloading ${missing.length} images from ${groups.size} row groups`);

  const files = new Map();
  let done = 0;
  for (const images of groups.values()) {
    const fileIndex = images[0].file;
    if (!files.has(fileIndex)) {
      const file = await asyncBufferFromUrl({ url: kaglFileUrl(fileIndex) });
      files.set(fileIndex, { file, metadata: await parquetMetadataAsync(file) });
    }
    const { file, metadata } = files.get(fileIndex);

    const rowStart = Math.min(...images.map((image) => image.row));
    const rowEnd = Math.max(...images.map((image) => image.row)) + 1;
    // utf8: false keeps the JPEG bytes as Uint8Array instead of decoding them as text.
    const rows = await parquetReadObjects({
      file, metadata, columns: ["image", "item_ID"], rowStart, rowEnd, utf8: false,
    });

    for (const image of images) {
      const record = rows[image.row - rowStart];
      if (Number(record.item_ID) !== image.itemId) {
        throw new Error(`Row ${image.file}/${image.row} is item ${record.item_ID}, expected ${image.itemId}`);
      }
      const bytes = Buffer.from(record.image.bytes);
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        throw new Error(`Item ${image.itemId} is not a JPEG image`);
      }
      fs.writeFileSync(path.join(CATALOG_DIR, image.path), bytes);
    }
    done += images.length;
    console.log(`  ${done}/${missing.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
