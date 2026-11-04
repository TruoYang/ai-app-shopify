/* eslint-env node */
// Build an Asian-style catalog from Tstars-VTON (Taobao/Tmall, CC BY-NC-ND 4.0).
//
// 1. Picks items per category and gender from data/catalog/tstars/metadata.json
//    (fetch-tstars-metadata.mjs), keeping the number of parquet row groups small.
// 2. Downloads only the chosen images to data/catalog/tstars/images (skipped if present).
// 3. Reads each image's dominant colour (the dataset has no colour attribute).
// 4. Writes data/catalog/tstars/catalog.json in the same format as fashion-catalog.json,
//    with English titles/descriptions plus Vietnamese ones (titleVi, descriptionHtmlVi)
//    for storefront translations.
//
// Usage (from my-plugin-ai/):
//   node scripts/catalog/build-tstars-catalog.mjs
//   node scripts/catalog/seed-shopify-catalog.mjs --catalog data/catalog/tstars/catalog.json --shop <shop>

import fs from "fs";
import path from "path";
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { tstarsFileUrl } from "./fetch-tstars-metadata.mjs";

const DIR = path.join("data", "catalog", "tstars");
const STORE_BRAND = "Aurelia";
const SKU_PREFIX = "AUR-AS";
const COLLECTION_TAG = "Asia Edit";

// Items per slot and gender.
const QUOTAS = {
  up: { Female: 26, Male: 10, Unisex: 4 },
  coat: { Female: 24, Male: 10, Unisex: 4 },
  pant: { Female: 12, Male: 8, Unisex: 2 },
  skirt: { Female: 20 },
  dress: { Female: 28 },
  shoes: { Female: 16, Male: 8, Unisex: 4 },
  bag: { Female: 16, Male: 4, Unisex: 6 },
  hat: { Female: 8, Male: 3, Unisex: 6 },
};

// Allowed styles: [English name, Vietnamese name]. Anything else is skipped
// (kids' wear, costumes, sleepwear, swim caps...).
const STYLES = {
  up: {
    "T-Shirt": ["T-Shirt", "Áo thun"], Shirt: ["Shirt", "Áo sơ mi"], Sweatshirt: ["Sweatshirt", "Áo nỉ"],
    Sweater: ["Sweater", "Áo len"], "Knit Top": ["Knit Top", "Áo len mỏng"], "Sport T-Shirt": ["Sport T-Shirt", "Áo thun thể thao"],
    Camisole: ["Camisole", "Áo hai dây"], "Polo Shirt": ["Polo Shirt", "Áo polo"], "Chiffon Top": ["Chiffon Top", "Áo voan"],
    "Print Shirt": ["Print Shirt", "Áo sơ mi họa tiết"], "Cashmere Top": ["Cashmere Top", "Áo cashmere"], "Knit Vest": ["Knit Vest", "Áo gile len"],
    "LS T-Shirt": ["Long Sleeve T-Shirt", "Áo thun dài tay"],
  },
  coat: {
    "Down Jacket": ["Down Jacket", "Áo phao lông vũ"], Jacket: ["Jacket", "Áo khoác"], "Padded Jacket": ["Padded Jacket", "Áo phao"],
    "Short Jacket": ["Cropped Jacket", "Áo khoác lửng"], "Wool Coat": ["Wool Coat", "Áo khoác dạ"], Blazer: ["Blazer", "Áo blazer"],
    "Knit Coat": ["Knit Cardigan", "Áo cardigan len"], "Shell Jacket": ["Shell Jacket", "Áo khoác gió"], "Denim Jacket": ["Denim Jacket", "Áo khoác jean"],
    "Leather Jacket": ["Leather Jacket", "Áo khoác da"], "Trench Coat": ["Trench Coat", "Áo măng tô"], "Sherpa Coat": ["Sherpa Coat", "Áo khoác lông cừu"],
    "Sun-Protection": ["Sun Protection Jacket", "Áo chống nắng"], "Sport Jacket": ["Sport Jacket", "Áo khoác thể thao"], "Hooded Coat": ["Hooded Coat", "Áo khoác có mũ"],
  },
  pant: {
    "Casual Pants": ["Casual Pants", "Quần dài"], Jeans: ["Jeans", "Quần jean"], Shorts: ["Shorts", "Quần short"],
    "Wide-Leg Pants": ["Wide-Leg Pants", "Quần ống rộng"], "Skinny Pants": ["Skinny Pants", "Quần ôm"], "Dress Pants": ["Dress Pants", "Quần âu"],
    "Sport Pants": ["Joggers", "Quần thể thao"], "Cargo Pants": ["Cargo Pants", "Quần túi hộp"], "Straight Pants": ["Straight Pants", "Quần ống đứng"],
    Trousers: ["Trousers", "Quần tây"], "Denim Shorts": ["Denim Shorts", "Quần short jean"], "Casual Shorts": ["Casual Shorts", "Quần short"],
  },
  skirt: {
    "Midi Skirt": ["Midi Skirt", "Chân váy midi"], "Pleated Skirt": ["Pleated Skirt", "Chân váy xếp ly"], "Denim Skirt": ["Denim Skirt", "Chân váy jean"],
    "Maxi Skirt": ["Maxi Skirt", "Chân váy maxi"], "Mini Skirt": ["Mini Skirt", "Chân váy ngắn"], "Plaid Skirt": ["Plaid Skirt", "Chân váy kẻ caro"],
    "Horse-Face Skirt": ["Mamianqun Skirt", "Chân váy mã diện"], "A-Line Skirt": ["A-Line Skirt", "Chân váy chữ A"], "Pencil Skirt": ["Pencil Skirt", "Chân váy bút chì"],
  },
  dress: {
    "Print Dress": ["Print Dress", "Đầm họa tiết"], "Slip Dress": ["Slip Dress", "Đầm hai dây"], "Knit Dress": ["Knit Dress", "Đầm len"],
    Qipao: ["Qipao Dress", "Sườn xám"], "Shirt Dress": ["Shirt Dress", "Đầm sơ mi"], "Sleeveless Dress": ["Sleeveless Dress", "Đầm sát nách"],
    "Lace Dress": ["Lace Dress", "Đầm ren"], "Embroid. Dress": ["Embroidered Dress", "Đầm thêu"], "Puff-Sleeve Dress": ["Puff Sleeve Dress", "Đầm tay phồng"],
    "Denim Dress": ["Denim Dress", "Đầm jean"], "Plaid Dress": ["Plaid Dress", "Đầm kẻ caro"], "Halter Dress": ["Halter Dress", "Đầm cổ yếm"],
    "Solid Dress": ["Dress", "Đầm trơn"], "Knit Sweater Dress": ["Sweater Dress", "Đầm len dáng dài"],
  },
  shoes: {
    Sandals: ["Sandals", "Dép sandal"], "Leather Shoes": ["Leather Shoes", "Giày da"], "Ankle Boots": ["Ankle Boots", "Bốt cổ ngắn"],
    "Canvas Shoes": ["Canvas Shoes", "Giày vải"], "Martin Boots": ["Combat Boots", "Bốt Martin"], "Flat Shoes": ["Flats", "Giày bệt"],
    "Skate Shoes": ["Skate Shoes", "Giày trượt ván"], "German Army Trainers": ["Retro Trainers", "Giày Đức"], Clogs: ["Clogs", "Dép sục"],
    Loafers: ["Loafers", "Giày lười"], "Ballet Flats": ["Ballet Flats", "Giày búp bê"], Pumps: ["Pumps", "Giày cao gót mũi nhọn"],
    "High Heels": ["High Heels", "Giày cao gót"], Sneakers: ["Sneakers", "Giày sneaker"], "Dad Shoes": ["Chunky Sneakers", "Giày đế độn"],
    "Walking Shoes": ["Walking Shoes", "Giày đi bộ"], "Gladiator Sandals": ["Gladiator Sandals", "Sandal chiến binh"],
  },
  bag: {
    Backpack: ["Backpack", "Ba lô"], Handbag: ["Handbag", "Túi xách tay"], Crossbody: ["Crossbody Bag", "Túi đeo chéo"],
    "Bucket Bag": ["Bucket Bag", "Túi bucket"], "Underarm Bag": ["Shoulder Baguette", "Túi kẹp nách"], "Saddle Bag": ["Saddle Bag", "Túi yên ngựa"],
    "Tote Bag": ["Tote Bag", "Túi tote"], Wallet: ["Wallet", "Ví"], "Belt Bag": ["Belt Bag", "Túi đeo hông"],
    "Shoulder Bag": ["Shoulder Bag", "Túi đeo vai"], "Square Bag": ["Box Bag", "Túi hộp"], "Chest Bag": ["Chest Bag", "Túi đeo ngực"],
    Clutch: ["Clutch", "Ví cầm tay"], "Canvas Bag": ["Canvas Bag", "Túi vải canvas"], "Woven Bag": ["Woven Bag", "Túi đan"],
  },
  hat: {
    "Sun Hat": ["Sun Hat", "Mũ rộng vành"], Beanie: ["Beanie", "Mũ len"], "Baseball Cap": ["Baseball Cap", "Mũ lưỡi trai"],
    "Straw Hat": ["Straw Hat", "Mũ cói"], "Newsboy Cap": ["Newsboy Cap", "Mũ nồi newsboy"], "Bucket Hat": ["Bucket Hat", "Mũ bucket"],
    Beret: ["Beret", "Mũ nồi beret"], "Cowboy Hat": ["Cowboy Hat", "Mũ cao bồi"], "Peaked Cap": ["Peaked Cap", "Mũ kết"],
  },
};

const DEPARTMENTS = {
  up: ["Tops", "TOP"], coat: ["Outerwear", "OUT"], pant: ["Bottoms", "BTM"], skirt: ["Bottoms", "SKR"],
  dress: ["Dresses", "DRS"], shoes: ["Shoes", "SHO"], bag: ["Bags", "BAG"], hat: ["Hats & Caps", "HAT"],
};
const PRICES = {
  up: [12, 32], coat: [35, 95], pant: [18, 42], skirt: [16, 38], dress: [22, 60], shoes: [25, 65], bag: [15, 48], hat: [8, 22],
};

const VI = {
  Normal: "dáng tiêu chuẩn", Long: "dáng dài", Short: "dáng ngắn",
  LongSleeve: "tay dài", ShortSleeve: "tay ngắn", Sleeveless: "sát nách",
  Regular: "form vừa", Loose: "form rộng", Tight: "form ôm",
  Cotton: "cotton", Knit: "len dệt kim", Silk: "lụa", Woolen: "dạ", Denim: "jean", Lace: "ren", Leather: "da",
  Lambswool: "lông cừu", Fur: "lông", Fleece: "nỉ lông", Wool: "len", Other: "chất liệu hỗn hợp",
};
const EN = {
  Normal: "Regular length", Long: "Long", Short: "Cropped", LongSleeve: "Long sleeves", ShortSleeve: "Short sleeves",
  Sleeveless: "Sleeveless", Regular: "Regular fit", Loose: "Relaxed fit", Tight: "Slim fit", Woolen: "Wool blend",
  Other: "Mixed fabric",
};

// Colour names: [English, Vietnamese, rgb].
const PALETTE = [
  ["Black", "đen", [25, 25, 25]], ["White", "trắng", [245, 245, 242]], ["Gray", "xám", [140, 140, 140]],
  ["Charcoal", "xám đậm", [70, 70, 75]], ["Beige", "be", [220, 205, 180]], ["Cream", "kem", [240, 232, 210]],
  ["Khaki", "kaki", [190, 175, 130]], ["Camel", "nâu lạc đà", [190, 145, 95]], ["Brown", "nâu", [110, 75, 50]],
  ["Navy", "xanh navy", [30, 40, 80]], ["Blue", "xanh dương", [60, 110, 190]], ["Light Blue", "xanh nhạt", [160, 195, 230]],
  ["Green", "xanh lá", [60, 140, 80]], ["Mint", "xanh bạc hà", [195, 225, 205]], ["Olive", "xanh rêu", [110, 110, 60]], ["Red", "đỏ", [200, 40, 45]],
  ["Burgundy", "đỏ đô", [120, 30, 45]], ["Pink", "hồng", [235, 160, 180]], ["Purple", "tím", [120, 80, 150]],
  ["Yellow", "vàng", [235, 205, 70]], ["Orange", "cam", [235, 130, 50]],
];

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function seeded(seed) {
  let state = hashString(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}
const toPrice = (value) => Math.max(1, Math.round(value)) - 0.01;
const slugify = (value) => value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const styleOf = (item) => item.info["Clothing-Style"] || item.info["Accessory-Style"];
const genderOf = (item) => item.info.Gender_fit || item.modelGender || "Unisex";
const isAllowed = (item) => Boolean(STYLES[item.slot]?.[styleOf(item)]);

// Fewest row groups that fill the quotas (greedy set cover), as for the KAGL catalog.
function select(items) {
  const needs = new Map();
  for (const [slot, genders] of Object.entries(QUOTAS)) {
    for (const [gender, count] of Object.entries(genders)) needs.set(`${slot}|${gender}`, count);
  }
  const candidates = items.filter((item) => isAllowed(item) && needs.has(`${item.slot}|${genderOf(item)}`));
  const groups = new Map();
  for (const item of candidates) {
    const key = `${item.file}:${item.rowGroup}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const remaining = new Map(needs);
  const chosenGroups = new Set();
  for (;;) {
    let best = null;
    let bestGain = 0;
    for (const [key, list] of groups) {
      if (chosenGroups.has(key)) continue;
      const counts = new Map();
      list.forEach((item) => counts.set(`${item.slot}|${genderOf(item)}`, (counts.get(`${item.slot}|${genderOf(item)}`) ?? 0) + 1));
      let gain = 0;
      counts.forEach((count, need) => { gain += Math.min(count, remaining.get(need) ?? 0); });
      if (gain > bestGain) {
        best = key;
        bestGain = gain;
      }
    }
    if (!best) break;
    chosenGroups.add(best);
    groups.get(best).forEach((item) => {
      const need = `${item.slot}|${genderOf(item)}`;
      remaining.set(need, Math.max(0, (remaining.get(need) ?? 0) - 1));
    });
  }

  // Within the chosen groups, prefer variety of styles.
  const selected = [];
  for (const [need, count] of needs) {
    const [slot, gender] = need.split("|");
    const pool = candidates
      .filter((item) => item.slot === slot && genderOf(item) === gender && chosenGroups.has(`${item.file}:${item.rowGroup}`))
      .sort((a, b) => hashString(a.id) - hashString(b.id));
    const byStyle = new Map();
    pool.forEach((item) => {
      if (!byStyle.has(styleOf(item))) byStyle.set(styleOf(item), []);
      byStyle.get(styleOf(item)).push(item);
    });
    const queues = [...byStyle.values()];
    const picked = [];
    while (picked.length < count && queues.some((queue) => queue.length)) {
      for (const queue of queues) if (queue.length && picked.length < count) picked.push(queue.shift());
    }
    if (picked.length < count) console.warn(`Only ${picked.length}/${count} for ${need}`);
    selected.push(...picked);
  }
  return { selected, groups: chosenGroups.size };
}

async function downloadImages(selected) {
  const missing = selected.filter((item) => !fs.existsSync(path.join(DIR, "images", `${item.id}.img`)));
  if (missing.length === 0) return;
  fs.mkdirSync(path.join(DIR, "images"), { recursive: true });
  const byGroup = new Map();
  missing.forEach((item) => {
    const key = `${item.file}:${item.rowGroup}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(item);
  });
  console.log(`Downloading ${missing.length} images from ${byGroup.size} row groups`);
  const files = new Map();
  let done = 0;
  for (const list of byGroup.values()) {
    const fileIndex = list[0].file;
    if (!files.has(fileIndex)) {
      const file = await asyncBufferFromUrl({ url: tstarsFileUrl(fileIndex) });
      files.set(fileIndex, { file, metadata: await parquetMetadataAsync(file) });
    }
    const { file, metadata } = files.get(fileIndex);
    const slots = [...new Set(list.map((item) => item.slot))];
    const rowStart = Math.min(...list.map((item) => item.row));
    const rowEnd = Math.max(...list.map((item) => item.row)) + 1;
    const rows = await parquetReadObjects({ file, metadata, columns: slots, rowStart, rowEnd, utf8: false });
    for (const item of list) {
      const bytes = rows[item.row - rowStart]?.[item.slot]?.bytes;
      if (!bytes) throw new Error(`No image for ${item.id}`);
      fs.writeFileSync(path.join(DIR, "images", `${item.id}.img`), Buffer.from(bytes));
    }
    done += list.length;
    console.log(`  ${done}/${missing.length}`);
  }
}

function decode(buffer) {
  if (buffer[0] === 0x89) return { ...PNG.sync.read(buffer), format: "png" };
  return { ...jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true }), format: "jpg" };
}

const distance2 = ([r1, g1, b1], [r2, g2, b2]) => (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;

// Background colours estimated from the image border (walls, floors, studio paper).
function backgroundColours(image) {
  const { width, height, data } = image;
  const samples = [];
  const band = Math.max(2, Math.floor(Math.min(width, height) * 0.04));
  const step = Math.max(1, Math.floor(Math.max(width, height) / 80));
  for (let x = 0; x < width; x += step) {
    for (const y of [Math.floor(band / 2), height - 1 - Math.floor(band / 2)]) samples.push(x + y * width);
  }
  for (let y = 0; y < height; y += step) {
    for (const x of [Math.floor(band / 2), width - 1 - Math.floor(band / 2)]) samples.push(x + y * width);
  }
  // Coarse clusters of border pixels; every cluster holding >= 10% of them is background.
  const buckets = new Map();
  for (const index of samples) {
    const i = index * 4;
    if (data[i + 3] < 128) continue;
    const key = `${data[i] >> 5},${data[i + 1] >> 5},${data[i + 2] >> 5}`;
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++;
    bucket.r += data[i];
    bucket.g += data[i + 1];
    bucket.b += data[i + 2];
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .filter((bucket) => bucket.n >= samples.length * 0.1)
    .map((bucket) => [bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n]);
}

// Most common palette colour of the product: central region, minus the background
// colours found on the border, white/transparent pixels and (on a person) skin tones.
// Saturated pixels count more than greyish ones so a coloured garment beats grey shadows.
function dominantColour(image, onModel) {
  const { width, height, data } = image;
  const background = backgroundColours(image);
  const votes = new Map();
  const [x0, x1] = [Math.floor(width * 0.25), Math.ceil(width * 0.75)];
  const [y0, y1] = onModel ? [Math.floor(height * 0.3), Math.ceil(height * 0.8)] : [Math.floor(height * 0.15), Math.ceil(height * 0.85)];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 120));
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 128 || (r > 238 && g > 238 && b > 238)) continue;
      if (background.some((colour) => distance2(colour, [r, g, b]) < 40 ** 2)) continue;
      const skin = r > 150 && g > 100 && b > 80 && r > g && g > b && r - b > 30 && r - b < 110;
      if (onModel && skin) continue;
      let best = 0;
      let bestDistance = Infinity;
      PALETTE.forEach(([, , [pr, pg, pb]], index) => {
        const distance = (r - pr) ** 2 * 0.3 + (g - pg) ** 2 * 0.59 + (b - pb) ** 2 * 0.11;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      votes.set(best, (votes.get(best) ?? 0) + 1 + 2 * saturation);
    }
  }
  const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return PALETTE[winner ? winner[0] : 0];
}

const LETTERS = { Female: ["XS", "S", "M", "L", "XL"], Male: ["S", "M", "L", "XL", "XXL"] };
const SHOES = { Female: ["5", "6", "7", "8", "9"], Male: ["7", "8", "9", "10", "11"] };

function sizeOption(slot, gender) {
  const g = gender === "Male" ? "Male" : "Female";
  if (["up", "coat", "pant", "skirt", "dress"].includes(slot)) return { name: "Size", values: LETTERS[g] };
  if (slot === "shoes") return { name: "US Size", values: SHOES[g] };
  return { name: "Size", values: ["One Size"] };
}

function buildProduct(item, image, usedTitles) {
  const random = seeded(`tstars-${item.id}`);
  const [styleEn, styleVi] = STYLES[item.slot][styleOf(item)];
  const onModel = (item.info["Clothing-Display_format"] || item.info["Accessory-Display_format"]) === "OnModel";
  const [colourEn, colourVi] = dominantColour(image, onModel);
  const material = item.info["Clothing-Material"];
  const materialEn = material && !["Other", "Cotton"].includes(material) && !styleEn.includes(material)
    ? (EN[material] ?? material) : "";

  let title = [colourEn, materialEn, styleEn].filter(Boolean).join(" ");
  // Skip the material when the Vietnamese style name already says it ("Áo len" + "len dệt kim").
  const materialVi = material && material !== "Other" ? VI[material] : "";
  const repeats = materialVi && materialVi.split(" ").some((word) => styleVi.toLowerCase().split(" ").includes(word));
  let titleVi = `${styleVi}${materialVi && !repeats ? ` ${materialVi}` : ""} màu ${colourVi}`;
  let suffix = 2;
  const base = title;
  const baseVi = titleVi;
  while (usedTitles.has(title)) {
    title = `${base} ${["II", "III", "IV", "V", "VI", "VII", "VIII"][suffix - 2] ?? suffix}`;
    titleVi = `${baseVi} ${["II", "III", "IV", "V", "VI", "VII", "VIII"][suffix - 2] ?? suffix}`;
    suffix++;
  }
  usedTitles.add(title);

  const gender = item.info.Gender_fit || item.modelGender || "Unisex";
  const genderTag = gender === "Female" ? "Women" : gender === "Male" ? "Men" : "Unisex";
  const [dept, deptCode] = DEPARTMENTS[item.slot];
  const [low, high] = PRICES[item.slot];
  const price = toPrice(low + random() * (high - low));
  const onSale = random() < 0.25;
  const compareAtPrice = onSale ? toPrice(price * (1.2 + random() * 0.25)) : null;
  const option = sizeOption(item.slot, gender);
  const code = `${item.file}${String(item.row).padStart(3, "0")}${Object.keys(QUOTAS).indexOf(item.slot)}`;
  const baseSku = `${SKU_PREFIX}-${deptCode}-${code}`;

  const specs = [
    ["Color", colourEn, "Màu sắc", colourVi],
    ["Material", material ? (EN[material] ?? material) : "", "Chất liệu", material ? VI[material] ?? material : ""],
    ["Length", EN[item.info["Clothing-Length"]] ?? "", "Độ dài", VI[item.info["Clothing-Length"]] ?? ""],
    ["Sleeves", EN[item.info["Clothing-Sleeve_length"]] ?? "", "Tay áo", VI[item.info["Clothing-Sleeve_length"]] ?? ""],
    ["Fit", EN[item.info["Clothing-Fit"]] ?? "", "Form", VI[item.info["Clothing-Fit"]] ?? ""],
  ].filter(([, value]) => value);
  const designEn = item.info["Clothing-Design_detail"] === "DesignComplex" ? "Statement details that stand out." : "Clean, minimal design that is easy to mix and match.";
  const designVi = item.info["Clothing-Design_detail"] === "DesignComplex" ? "Thiết kế nhiều chi tiết, nổi bật." : "Thiết kế tối giản, dễ phối đồ.";
  const sizes = option.values.join(", ");

  const descriptionHtml =
    `<p>${escapeHtml(styleEn)} in ${escapeHtml(colourEn.toLowerCase())}, inspired by the latest street style from Asia. ${designEn}</p>` +
    `<h3>Specifications</h3><ul>${specs.map(([key, value]) => `<li><strong>${key}:</strong> ${escapeHtml(value)}</li>`).join("")}</ul>` +
    `<h3>Size guide</h3><p>Available in ${escapeHtml(sizes)}. Asian sizing: if you are between sizes, choose the larger one.</p>` +
    `<h3>Shipping &amp; returns</h3><p>Free standard shipping on orders over $75. Free returns within 30 days on unworn items with tags attached.</p>` +
    `<p><small>Product photo: Tstars-VTON dataset by Taobao/Tmall, CC BY-NC-ND 4.0.</small></p>`;
  const descriptionHtmlVi =
    `<p>${escapeHtml(styleVi)} màu ${escapeHtml(colourVi)}, phong cách thời trang đường phố châu Á. ${designVi}</p>` +
    `<h3>Thông số</h3><ul>${specs.map(([, , key, value]) => `<li><strong>${key}:</strong> ${escapeHtml(value)}</li>`).join("")}</ul>` +
    `<h3>Hướng dẫn chọn size</h3><p>Có các size ${escapeHtml(sizes)}. Size châu Á: nếu phân vân giữa hai size, hãy chọn size lớn hơn.</p>` +
    `<h3>Giao hàng &amp; đổi trả</h3><p>Miễn phí giao hàng cho đơn từ $75. Đổi trả miễn phí trong 30 ngày với sản phẩm chưa qua sử dụng, còn nguyên tem.</p>` +
    `<p><small>Ảnh sản phẩm: bộ dữ liệu Tstars-VTON của Taobao/Tmall, giấy phép CC BY-NC-ND 4.0.</small></p>`;

  const metafields = [
    ["color", colourEn], ["material", material ? (EN[material] ?? material) : "Mixed"], ["fit", EN[item.info["Clothing-Fit"]] ?? "One size"],
    ["department", dept], ["gender", genderTag], ["style", styleEn],
  ].map(([key, value]) => ({ namespace: "custom", key, type: "single_line_text_field", value: String(value) }));

  return {
    handle: slugify(`${title}-${code}`),
    title,
    titleVi,
    descriptionHtml,
    descriptionHtmlVi,
    vendor: `${STORE_BRAND} Asia`,
    productType: styleEn,
    tags: [...new Set([genderTag, dept, styleEn, colourEn, COLLECTION_TAG, onSale ? "Sale" : null].filter(Boolean))],
    seo: { title: `${title} | ${STORE_BRAND}`, description: `${styleEn} in ${colourEn.toLowerCase()}, Asian street style. Free returns within 30 days.` },
    metafields,
    weightGrams: { up: 220, coat: 700, pant: 450, skirt: 300, dress: 350, shoes: 850, bag: 600, hat: 120 }[item.slot],
    baseSku,
    attributes: { gender: genderTag, department: dept, color: colourEn, material: material ?? null, style: styleEn },
    image: {
      source: "TaobaoTmall-AlgorithmProducts/Tstars-VTON",
      file: item.file,
      row: item.row,
      slot: item.slot,
      itemId: item.id,
      path: `images/${item.id}.img`,
      mimeType: image.format === "png" ? "image/png" : "image/jpeg",
      alt: title,
    },
    option,
    variants: option.values.map((value) => ({
      option: value,
      sku: option.values.length === 1 ? baseSku : `${baseSku}-${value}`,
      price,
      compareAtPrice,
    })),
  };
}

async function main() {
  const items = JSON.parse(fs.readFileSync(path.join(DIR, "metadata.json"), "utf8"));
  const { selected, groups } = select(items);
  console.log(`Selected ${selected.length} items from ${groups} row groups`);
  await downloadImages(selected);

  const usedTitles = new Set();
  const products = selected.map((item) => {
    const image = decode(fs.readFileSync(path.join(DIR, "images", `${item.id}.img`)));
    return buildProduct(item, image, usedTitles);
  });

  const collections = [{
    title: COLLECTION_TAG,
    handle: slugify(COLLECTION_TAG),
    descriptionHtml: "<p>Street style from Asia: Taobao and Tmall favourites.</p>",
    rules: [{ column: "TAG", relation: "EQUALS", condition: COLLECTION_TAG }],
  }];
  const catalog = {
    store: STORE_BRAND,
    source: "Tstars-VTON (Taobao/Tmall), https://huggingface.co/datasets/TaobaoTmall-AlgorithmProducts/Tstars-VTON, CC BY-NC-ND 4.0",
    products,
    collections,
  };
  fs.writeFileSync(path.join(DIR, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  const byDept = {};
  products.forEach((product) => { byDept[product.attributes.department] = (byDept[product.attributes.department] ?? 0) + 1; });
  console.log(`Catalog: ${products.length} products, ${products.reduce((sum, p) => sum + p.variants.length, 0)} variants`, byDept);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
