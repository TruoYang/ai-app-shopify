/* eslint-env node */
// Download the text columns of the Marqo/KAGL fashion dataset (no images).
//
// The parquet files are read with HTTP range requests, so only the small metadata
// columns are transferred (a few MB instead of ~15 GB).
//
// Usage (from my-plugin-ai/):
//   node scripts/catalog/fetch-kagl-metadata.mjs [output=data/catalog/kagl-metadata.json]

import fs from "fs";
import path from "path";
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import { KAGL_FILE_COUNT, kaglFileUrl } from "./kagl.mjs";

const COLUMNS = ["gender", "category1", "category2", "category3", "baseColour", "season", "year", "usage", "text", "item_ID"];

async function main() {
  const output = process.argv[2] ?? path.join("data", "catalog", "kagl-metadata.json");
  const rows = [];

  for (let fileIndex = 0; fileIndex < KAGL_FILE_COUNT; fileIndex++) {
    const file = await asyncBufferFromUrl({ url: kaglFileUrl(fileIndex) });
    const metadata = await parquetMetadataAsync(file);
    const records = await parquetReadObjects({ file, metadata, columns: COLUMNS });

    // Remember the row group of each record: images are stored per row group.
    const groupOfRow = [];
    metadata.row_groups.forEach((group, groupIndex) => {
      for (let i = 0; i < Number(group.num_rows); i++) groupOfRow.push(groupIndex);
    });

    records.forEach((record, rowIndex) => {
      rows.push({
        file: fileIndex,
        row: rowIndex,
        rowGroup: groupOfRow[rowIndex],
        ...record,
        year: record.year == null ? null : Number(record.year),
        item_ID: Number(record.item_ID),
      });
    });
    process.stdout.write(`${fileIndex + 1}/${KAGL_FILE_COUNT} `);
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(rows));
  console.log(`\nSaved ${rows.length} rows to ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
