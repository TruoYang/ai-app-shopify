/* eslint-env node */
// Download the attribute columns of the Tstars-VTON dataset (Taobao/Tmall, CC BY-NC-ND 4.0).
//
// Each dataset row is one outfit: up to 8 garment/accessory images (up, coat, pant, skirt,
// dress, shoes, bag, hat) with VLM-generated attributes. Only the text columns are read here;
// images are fetched later by download-tstars-images.mjs for the chosen items only.
//
// Usage (from my-plugin-ai/):
//   node scripts/catalog/fetch-tstars-metadata.mjs [output=data/catalog/tstars/metadata.json]

import fs from "fs";
import path from "path";
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from "hyparquet";

export const TSTARS_FILE_COUNT = 5;
export const TSTARS_SLOTS = ["up", "coat", "pant", "skirt", "dress", "shoes", "bag", "hat"];
export const tstarsFileUrl = (index) =>
  `https://huggingface.co/datasets/TaobaoTmall-AlgorithmProducts/Tstars-VTON/resolve/main/Tstars-VTON-${String(index).padStart(5, "0")}.parquet`;

const parseInfo = (value) => {
  try {
    const info = JSON.parse(value || "{}");
    return info && Object.keys(info).length ? info : null;
  } catch {
    return null;
  }
};

async function main() {
  const output = process.argv[2] ?? path.join("data", "catalog", "tstars", "metadata.json");
  const items = [];

  for (let fileIndex = 0; fileIndex < TSTARS_FILE_COUNT; fileIndex++) {
    const file = await asyncBufferFromUrl({ url: tstarsFileUrl(fileIndex) });
    const metadata = await parquetMetadataAsync(file);
    const columns = ["model_info", "short_caption", ...TSTARS_SLOTS.map((slot) => `${slot}_info`)];
    const rows = await parquetReadObjects({ file, metadata, columns });

    const groupOfRow = [];
    metadata.row_groups.forEach((group, groupIndex) => {
      for (let i = 0; i < Number(group.num_rows); i++) groupOfRow.push(groupIndex);
    });
    // Which slots actually hold an image: a garment is present when its bytes column is not null.
    const presence = await parquetReadObjects({
      file, metadata, columns: TSTARS_SLOTS.map((slot) => `${slot}.path`),
    }).catch(() => null);

    rows.forEach((row, rowIndex) => {
      const model = parseInfo(row.model_info);
      for (const slot of TSTARS_SLOTS) {
        const info = parseInfo(row[`${slot}_info`]);
        const hasImage = presence ? Boolean(presence[rowIndex]?.[slot]?.path ?? presence[rowIndex]?.[`${slot}.path`]) : Boolean(info);
        if (!info || !hasImage) continue;
        items.push({
          id: `${fileIndex}-${rowIndex}-${slot}`,
          file: fileIndex,
          row: rowIndex,
          rowGroup: groupOfRow[rowIndex],
          slot,
          modelGender: model?.Gender ?? null,
          info,
        });
      }
    });
    process.stdout.write(`${fileIndex + 1}/${TSTARS_FILE_COUNT} `);
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(items));
  console.log(`\nSaved ${items.length} items to ${output}`);
}

if (process.argv[1]?.endsWith("fetch-tstars-metadata.mjs")) main().catch((error) => {
  console.error(error);
  process.exit(1);
});
