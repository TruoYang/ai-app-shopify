/* eslint-env node */
// Shared location of the Marqo/KAGL parquet files on Hugging Face.

export const KAGL_FILE_COUNT = 35;

export const kaglFileUrl = (index) =>
  `https://huggingface.co/datasets/Marqo/KAGL/resolve/main/data/data-${String(index).padStart(5, "0")}-of-${String(KAGL_FILE_COUNT).padStart(5, "0")}.parquet`;
