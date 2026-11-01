/* eslint-env node */
// Build the demo fashion catalog from the KAGL dataset metadata.
//
// Source: Marqo/KAGL on Hugging Face (Kaggle "Fashion Product Images", MIT-tagged),
// fetched with scripts/catalog/fetch-kagl-metadata.mjs.
//
// Output (deterministic for the same input):
//   data/catalog/fashion-catalog.json   products, variants, SKUs, collections
//   data/catalog/fashion-catalog-skus.csv   one row per variant, for SKU matching
//
// Usage (from my-plugin-ai/):
//   node scripts/catalog/build-fashion-catalog.mjs data/catalog/kagl-metadata.json

import fs from "fs";
import path from "path";

const STORE_BRAND = "Aurelia";
const SKU_PREFIX = "AUR";
const OUTPUT_DIR = path.join("data", "catalog");

// How many products to take per gender and KAGL category3.
const SELECTION = {
  Men: {
    Tshirts: 10, Shirts: 10, Sweatshirts: 5, Jackets: 5, Sweaters: 3,
    Jeans: 6, Trousers: 5, Shorts: 4, "Track Pants": 3,
    "Casual Shoes": 6, "Sports Shoes": 5, "Formal Shoes": 4, "Flip Flops": 3,
    Caps: 8, Belts: 4, Wallets: 4, Backpacks: 4, Sunglasses: 3, Watches: 3, Socks: 3, Ties: 3,
  },
  Women: {
    Tops: 12, Tshirts: 8, Shirts: 4, Sweaters: 5, Sweatshirts: 3, Jackets: 4,
    Dresses: 10, Skirts: 6, Jeans: 6, Trousers: 5, Shorts: 3, Leggings: 3,
    Heels: 8, Flats: 6, "Casual Shoes": 5, "Sports Shoes": 3, Sandals: 2,
    Handbags: 10, Clutches: 4, Sunglasses: 4, Watches: 4, Scarves: 4, Caps: 2,
  },
  Unisex: { Caps: 4, Hat: 2, Backpacks: 3, Sunglasses: 2 },
};

// Display name, department and price range (USD) per KAGL category3.
const TYPES = {
  Tshirts: { type: "T-Shirts", noun: "T-Shirt", dept: "Tops", price: [18, 35] },
  Shirts: { type: "Shirts", noun: "Shirt", dept: "Tops", price: [35, 65] },
  Tops: { type: "Tops", noun: "Top", dept: "Tops", price: [22, 45] },
  Sweaters: { type: "Sweaters", noun: "Sweater", dept: "Tops", price: [45, 85] },
  Sweatshirts: { type: "Sweatshirts", noun: "Sweatshirt", dept: "Tops", price: [38, 65] },
  Jackets: { type: "Jackets", noun: "Jacket", dept: "Outerwear", price: [70, 150] },
  Jeans: { type: "Jeans", noun: "Jeans", dept: "Bottoms", price: [45, 90] },
  Trousers: { type: "Pants", noun: "Pants", dept: "Bottoms", price: [40, 75] },
  Shorts: { type: "Shorts", noun: "Shorts", dept: "Bottoms", price: [25, 45] },
  Skirts: { type: "Skirts", noun: "Skirt", dept: "Bottoms", price: [30, 60] },
  "Track Pants": { type: "Joggers", noun: "Joggers", dept: "Bottoms", price: [30, 55] },
  Leggings: { type: "Leggings", noun: "Leggings", dept: "Bottoms", price: [22, 40] },
  Dresses: { type: "Dresses", noun: "Dress", dept: "Dresses", price: [45, 110] },
  "Casual Shoes": { type: "Casual Shoes", noun: "Casual Shoes", dept: "Shoes", price: [55, 110] },
  "Sports Shoes": { type: "Running Shoes", noun: "Running Shoes", dept: "Shoes", price: [70, 140] },
  "Formal Shoes": { type: "Dress Shoes", noun: "Dress Shoes", dept: "Shoes", price: [80, 160] },
  Heels: { type: "Heels", noun: "Heels", dept: "Shoes", price: [55, 120] },
  Flats: { type: "Flats", noun: "Flats", dept: "Shoes", price: [35, 70] },
  Sandals: { type: "Sandals", noun: "Sandals", dept: "Shoes", price: [30, 65] },
  "Flip Flops": { type: "Flip-Flops", noun: "Flip-Flops", dept: "Shoes", price: [15, 30] },
  Handbags: { type: "Handbags", noun: "Handbag", dept: "Bags", price: [60, 180] },
  Clutches: { type: "Clutches", noun: "Clutch", dept: "Bags", price: [35, 80] },
  Backpacks: { type: "Backpacks", noun: "Backpack", dept: "Bags", price: [45, 95] },
  Caps: { type: "Caps", noun: "Cap", dept: "Hats & Caps", price: [18, 32] },
  Hat: { type: "Hats", noun: "Hat", dept: "Hats & Caps", price: [25, 45] },
  Belts: { type: "Belts", noun: "Belt", dept: "Accessories", price: [25, 55] },
  Wallets: { type: "Wallets", noun: "Wallet", dept: "Accessories", price: [25, 60] },
  Sunglasses: { type: "Sunglasses", noun: "Sunglasses", dept: "Accessories", price: [25, 90] },
  Watches: { type: "Watches", noun: "Watch", dept: "Accessories", price: [80, 220] },
  Scarves: { type: "Scarves", noun: "Scarf", dept: "Accessories", price: [20, 45] },
  Socks: { type: "Socks", noun: "Socks (3-Pack)", dept: "Accessories", price: [9, 16] },
  Ties: { type: "Ties", noun: "Tie", dept: "Accessories", price: [20, 40] },
};

const DEPT_CODES = {
  Tops: "TOP", Outerwear: "OUT", Bottoms: "BTM", Dresses: "DRS",
  Shoes: "SHO", Bags: "BAG", "Hats & Caps": "HAT", Accessories: "ACC",
};

const LETTER_SIZES = { Men: ["S", "M", "L", "XL", "XXL"], Women: ["XS", "S", "M", "L", "XL"] };
const WAIST_SIZES = { Men: ["30", "32", "34", "36", "38"], Women: ["25", "26", "28", "30", "32"] };
const SHOE_SIZES = { Men: ["7", "8", "9", "10", "11", "12"], Women: ["5", "6", "7", "8", "9", "10"] };

function sizeOption(category, gender) {
  const g = gender === "Women" ? "Women" : "Men";
  const { dept } = TYPES[category];
  if (category === "Jeans" || category === "Trousers") return { name: "Waist", values: WAIST_SIZES[g] };
  if (dept === "Shoes") return { name: "US Size", values: SHOE_SIZES[g] };
  if (["Tops", "Outerwear", "Bottoms", "Dresses"].includes(dept)) return { name: "Size", values: LETTER_SIZES[g] };
  if (category === "Belts") return { name: "Size", values: ["S", "M", "L"] };
  return { name: "Size", values: ["One Size"] };
}

// Materials, fit and care are not in the dataset; they are picked per product type
// so descriptions carry the attributes later used for comparison and category matching.
const DETAILS = {
  Tops: { materials: ["100% cotton", "Cotton-modal blend", "Organic cotton jersey", "Linen-cotton blend"], fits: ["Regular fit", "Relaxed fit", "Slim fit"], care: "Machine wash cold, tumble dry low" },
  Outerwear: { materials: ["Recycled polyester shell", "Cotton twill", "Denim", "Nylon with fleece lining"], fits: ["Regular fit", "Relaxed fit"], care: "Machine wash cold, hang dry" },
  Bottoms: { materials: ["Stretch cotton denim", "Cotton twill", "Cotton-elastane blend", "Soft French terry"], fits: ["Slim fit", "Straight fit", "Relaxed fit"], care: "Machine wash cold, inside out" },
  Dresses: { materials: ["Viscose crepe", "Cotton poplin", "Chiffon", "Jersey knit"], fits: ["A-line", "Shift", "Fit-and-flare"], care: "Hand wash or gentle cycle, line dry" },
  Shoes: { materials: ["Leather upper, rubber sole", "Mesh upper, EVA sole", "Canvas upper, rubber sole", "Faux suede upper"], fits: ["True to size", "Runs slightly small, consider half size up"], care: "Wipe clean with a damp cloth" },
  Bags: { materials: ["Vegan leather", "Genuine leather", "Water-resistant canvas", "Recycled nylon"], fits: ["Fits a 13-inch laptop", "Fits phone, wallet and keys", "Adjustable strap"], care: "Spot clean only" },
  "Hats & Caps": { materials: ["Cotton twill", "Wool blend", "Washed canvas"], fits: ["Adjustable strap", "One size fits most"], care: "Spot clean only" },
  Accessories: { materials: ["Genuine leather", "Stainless steel", "Polycarbonate", "Cotton blend", "Silk blend"], fits: ["One size", "Adjustable"], care: "Wipe clean, store in a dry place" },
};

// Product types whose material does not follow their department.
const CATEGORY_MATERIALS = {
  Jeans: ["Stretch cotton denim", "Rigid cotton denim", "Washed cotton denim"],
  Leggings: ["Cotton-elastane blend", "Recycled nylon-spandex"],
  "Track Pants": ["Soft French terry", "Brushed cotton fleece"],
  Shorts: ["Cotton twill", "Linen-cotton blend", "Stretch cotton denim"],
  Sweaters: ["Cotton-wool blend", "Merino wool", "Soft acrylic knit"],
  Sweatshirts: ["Brushed cotton fleece", "Soft French terry"],
  Watches: ["Stainless steel case, leather strap", "Stainless steel case and bracelet", "Alloy case, silicone strap"],
  Sunglasses: ["Polycarbonate frame, UV400 lenses", "Metal frame, polarized UV400 lenses"],
  Belts: ["Genuine leather, metal buckle", "Woven canvas, metal buckle"],
  Wallets: ["Genuine leather", "Vegan leather"],
  Socks: ["Combed cotton blend", "Cotton-polyester blend"],
  Ties: ["Silk blend", "Microfibre"],
  Scarves: ["Viscose", "Silk blend", "Soft acrylic knit"],
  "Flip Flops": ["EVA foam sole, rubber straps"],
  "Sports Shoes": ["Breathable mesh upper, EVA midsole", "Knit upper, cushioned foam sole"],
};

const INTROS = {
  Tops: "An easy everyday {noun} you will reach for again and again.",
  Outerwear: "A versatile layer that keeps you comfortable from morning to evening.",
  Bottoms: "Comfortable {noun} with a clean shape that pairs with almost anything.",
  Dresses: "A flattering {noun} that moves easily from day plans to dinner.",
  Shoes: "{Noun} made for all-day wear, with cushioned support and a clean silhouette.",
  Bags: "A practical {noun} with room for your daily essentials.",
  "Hats & Caps": "A finishing touch for casual outfits and sunny days.",
  Accessories: "A small detail that pulls your whole look together.",
};

// Four of these are picked per product for the "Details" list.
const FEATURES = {
  Tops: [
    "Soft, breathable fabric for all-day comfort", "Neckline reinforced to keep its shape wash after wash",
    "Double-stitched hems for durability", "Pre-shrunk to hold its size", "Easy to layer under jackets and cardigans",
    "Colour-fast dye that resists fading",
  ],
  Outerwear: [
    "Full-length zip with a covered placket", "Two side pockets plus an inner chest pocket",
    "Wind-resistant shell", "Ribbed cuffs that keep out the chill", "Light enough to pack in a weekend bag",
    "Water-repellent finish for light showers",
  ],
  Bottoms: [
    "Mid-rise waist that sits comfortably", "Belt loops and a secure button fastening",
    "Classic five-pocket styling", "Stretch for ease of movement", "Reinforced seams at stress points",
    "Hem that can be rolled or worn straight",
  ],
  Dresses: [
    "Fully lined bodice", "Concealed back zip", "Falls just above the knee",
    "Soft drape that flatters every silhouette", "Breathable fabric for warm days", "Easy to dress up with heels or down with flats",
  ],
  Shoes: [
    "Cushioned insole for all-day comfort", "Flexible, non-slip rubber outsole", "Padded collar to prevent rubbing",
    "Breathable lining", "Lightweight construction", "Secure fit that holds its shape",
  ],
  Bags: [
    "Zip-top closure keeps belongings secure", "Inner zip pocket and two slip pockets",
    "Sturdy top handles with reinforced stitching", "Metal feet protect the base", "Lined interior that is easy to wipe clean",
    "Detachable, adjustable strap",
  ],
  "Hats & Caps": [
    "Curved brim shades the eyes", "Breathable eyelets keep you cool", "Adjustable back strap",
    "Structured crown that keeps its shape", "Sweat-wicking inner band", "Packable without losing its form",
  ],
  Accessories: [
    "Gift-ready packaging", "Minimal design that goes with everything", "Durable everyday construction",
    "Lightweight and comfortable to wear", "Finished edges for a clean look", "Easy to care for",
  ],
};

// Styling tip that points to departments people commonly buy together.
const PAIRS_WITH = {
  Tops: "Pair it with slim jeans or chinos and clean sneakers for an effortless weekend look.",
  Outerwear: "Layer it over a crew-neck tee and finish with jeans and boots.",
  Bottoms: "Style with a tucked-in shirt, a leather belt and your favourite casual shoes.",
  Dresses: "Add heels and a clutch for the evening, or flats and a tote for the day.",
  Shoes: "Wear them with cropped trousers or jeans and matching socks.",
  Bags: "Complements both workwear and weekend outfits; match it with your shoes for a polished look.",
  "Hats & Caps": "Throw it on with a tee, shorts and sunglasses for sunny days out.",
  Accessories: "A finishing touch for any outfit, and an easy gift idea.",
};

const WEIGHT_GRAMS = {
  Tops: 220, Outerwear: 650, Bottoms: 480, Dresses: 350,
  Shoes: 900, Bags: 700, "Hats & Caps": 120, Accessories: 150,
};

// Body measurements in inches for each letter size.
const SIZE_CHARTS = {
  Men: { S: [36, 30], M: [39, 33], L: [42, 36], XL: [45, 39], XXL: [48, 42] },
  Women: { XS: [32, 25], S: [34, 27], M: [36, 29], L: [39, 32], XL: [42, 35] },
};
const SHOE_EU = {
  Men: { 7: 40, 8: 41, 9: 42, 10: 43, 11: 44, 12: 45 },
  Women: { 5: 35, 6: 36, 7: 37, 8: 38, 9: 39, 10: 40 },
};

const SHIPPING_HTML =
  "<p>Free standard shipping on orders over $75. Orders ship within 1–2 business days. " +
  "Free returns and exchanges within 30 days on unworn items with tags attached.</p>";

function sizeGuideHtml(option, gender) {
  const g = gender === "Women" ? "Women" : "Men";
  const table = (head, rows) =>
    `<table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

  if (option.name === "US Size") {
    return table(["US", "EU"], option.values.map((size) => [size, SHOE_EU[g][size] ?? "-"]));
  }
  if (option.name === "Waist") {
    return `<p>Sizes are waist measurements in inches. If you are between sizes, choose the larger one.</p>`;
  }
  if (option.values.every((size) => SIZE_CHARTS[g][size])) {
    return table(["Size", "Chest (in)", "Waist (in)"], option.values.map((size) => [size, ...SIZE_CHARTS[g][size]]));
  }
  return "<p>One size fits most.</p>";
}

// Words copied from the original product name when present. Brand and team names are dropped.
// Patterns go before the colour ("Striped Navy Shirt"), styles after it ("Navy Polo T-Shirt").
const PATTERN_WORDS = [
  ["striped", "Striped"], ["stripes", "Striped"], ["checked", "Check"], ["check", "Check"],
  ["printed", "Printed"], ["print", "Printed"], ["graphic", "Graphic"], ["floral", "Floral"],
  ["polka", "Polka Dot"], ["solid", "Solid"],
];
const STYLE_WORDS = [
  ["denim", "Denim"], ["leather", "Leather"], ["suede", "Suede"],
  ["canvas", "Canvas"], ["knit", "Knit"], ["hooded", "Hooded"], ["hoodie", "Hooded"],
  ["slim", "Slim"], ["skinny", "Skinny"], ["cargo", "Cargo"], ["chino", "Chino"], ["polo", "Polo"],
  ["henley", "Henley"], ["v-neck", "V-Neck"], ["lace", "Lace"], ["sleeveless", "Sleeveless"],
  ["running", "Running"], ["training", "Training"], ["slip-on", "Slip-On"], ["loafers", "Loafer"],
  ["boots", "Boot"], ["wedge", "Wedge"], ["stiletto", "Stiletto"], ["peep", "Peep-Toe"],
  ["aviator", "Aviator"], ["wayfarer", "Wayfarer"], ["chronograph", "Chronograph"],
  ["analog", "Analog"], ["digital", "Digital"], ["tote", "Tote"], ["sling", "Sling"],
  ["shoulder", "Shoulder"], ["baseball", "Baseball"], ["reversible", "Reversible"],
];

const NAME_PREFIXES = [
  "Everyday", "Weekend", "Coastal", "Studio", "Harbor", "Meadow", "Urban", "Classic",
  "Essential", "Heritage", "Summit", "Avenue", "Canyon", "Breeze", "Willow", "Metro",
];

// Skip sports and licensed brands whose logos dominate the product photo.
const BLOCKED_TEXT = /\b(nike|adidas|puma|reebok|fila|lotto|kappa|converse|vans|asics|manchester|arsenal|chelsea|barcelona|madrid|liverpool|juventus|ferrari|mercedes|bmw|disney|marvel|batman|superman|spiderman|mickey|kitty|ben 10|playboy|wwe|star wars|jockey|quiksilver|roxy|billabong|lacoste|tommy|hilfiger|superdry|ed hardy|guess|diesel|levis|wrangler|lee cooper|benetton|jack & jones|being human|wildcraft|fastrack|titan|casio|timex|fossil|ray-ban|polaroid|skechers|crocs|woodland|red tape|basics|catwalk|carrera|police)\b/i;

// Deterministic pseudo-random numbers so the catalog is reproducible.
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

const pick = (random, list) => list[Math.floor(random() * list.length)];
const toPrice = (value) => Math.max(1, Math.round(value)) - 0.01;
const slugify = (value) =>
  value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const escapeHtml = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);

const groupKey = (row) => `${row.file}:${row.rowGroup}`;

const isCandidate = (row, gender, category) =>
  row.gender === gender &&
  row.category3 === category &&
  row.usage !== "Ethnic" &&
  typeof row.text === "string" &&
  !BLOCKED_TEXT.test(row.text);

// Images are stored ~30 MB per parquet row group, so pick the fewest row groups
// that can still fill every quota (greedy set cover).
function chooseRowGroups(rows) {
  const needs = new Map();
  const groups = new Map();
  for (const [gender, categories] of Object.entries(SELECTION)) {
    for (const [category, count] of Object.entries(categories)) {
      const key = `${gender}|${category}`;
      needs.set(key, count);
      for (const row of rows) {
        if (!isCandidate(row, gender, category)) continue;
        if (!groups.has(groupKey(row))) groups.set(groupKey(row), new Map());
        const counts = groups.get(groupKey(row));
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  const chosen = new Set();
  for (;;) {
    let best = null;
    let bestGain = 0;
    for (const [group, counts] of groups) {
      if (chosen.has(group)) continue;
      let gain = 0;
      counts.forEach((count, key) => { gain += Math.min(count, needs.get(key)); });
      if (gain > bestGain || (gain === bestGain && best && group < best)) {
        best = group;
        bestGain = gain;
      }
    }
    if (!best || bestGain === 0) break;
    chosen.add(best);
    groups.get(best).forEach((count, key) => needs.set(key, Math.max(0, needs.get(key) - count)));
  }
  return chosen;
}

function selectItems(rows) {
  const allowedGroups = chooseRowGroups(rows);
  const selected = [];
  for (const [gender, categories] of Object.entries(SELECTION)) {
    for (const [category, count] of Object.entries(categories)) {
      const candidates = rows
        .filter((row) => allowedGroups.has(groupKey(row)) && isCandidate(row, gender, category))
        .sort((a, b) => hashString(`pick-${a.item_ID}`) - hashString(`pick-${b.item_ID}`));

      // Round-robin over colours so a category is not ten black items.
      const byColour = new Map();
      for (const row of candidates) {
        const key = row.baseColour || "Other";
        if (!byColour.has(key)) byColour.set(key, []);
        byColour.get(key).push(row);
      }
      const queues = [...byColour.values()];
      const chosen = [];
      while (chosen.length < count && queues.some((queue) => queue.length)) {
        for (const queue of queues) {
          if (queue.length && chosen.length < count) chosen.push(queue.shift());
        }
      }
      if (chosen.length < count) {
        console.warn(`Only ${chosen.length}/${count} items for ${gender} ${category}`);
      }
      selected.push(...chosen);
    }
  }
  return selected;
}

function findWords(text, dictionary, noun) {
  const words = text.toLowerCase().split(/[^a-z-]+/);
  const found = [];
  for (const [needle, label] of dictionary) {
    if (words.includes(needle) && !found.includes(label) && !noun.includes(label)) found.push(label);
  }
  return found;
}

function buildProduct(row, usedTitles) {
  const info = TYPES[row.category3];
  const random = seeded(`product-${row.item_ID}`);
  const colour = row.baseColour && row.baseColour !== "Multi" ? row.baseColour : "Multicolor";
  const pattern = findWords(row.text, PATTERN_WORDS, info.noun)[0];
  const style = findWords(row.text, STYLE_WORDS, info.noun)[0];

  let title = [pattern, colour, style, info.noun].filter(Boolean).join(" ");
  if (usedTitles.has(title)) {
    const prefixes = [...NAME_PREFIXES].sort(() => random() - 0.5);
    title = prefixes.map((prefix) => `${prefix} ${title}`).find((candidate) => !usedTitles.has(candidate))
      ?? `${title} ${row.item_ID}`;
  }
  usedTitles.add(title);

  const gender = row.gender;
  const [low, high] = info.price;
  const price = toPrice(low + random() * (high - low));
  const onSale = random() < 0.2;
  const compareAtPrice = onSale ? toPrice(price * (1.25 + random() * 0.2)) : null;

  const details = DETAILS[info.dept];
  const material = pick(random, CATEGORY_MATERIALS[row.category3] ?? details.materials);
  const fit = pick(random, details.fits);
  const option = sizeOption(row.category3, gender);
  const baseSku = `${SKU_PREFIX}-${DEPT_CODES[info.dept]}-${row.item_ID}`;

  const intro = INTROS[info.dept]
    .replace("{noun}", info.noun.toLowerCase())
    .replace("{Noun}", capitalize(info.noun));
  const season = row.season || "All season";
  const occasion = row.usage || "Casual";
  const attributes = [
    ["Color", colour],
    ["Material", material],
    ["Fit", fit],
    ["Season", season],
    ["Occasion", occasion],
    ["Care", details.care],
  ];
  const features = [...FEATURES[info.dept]].sort(() => random() - 0.5).slice(0, 4);
  const descriptionHtml =
    `<p>${escapeHtml(intro)} Finished in ${escapeHtml(colour.toLowerCase())} for an easy match with the rest of your wardrobe.</p>` +
    `<h3>Details</h3><ul>${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul>` +
    `<h3>Specifications</h3><ul>${attributes.map(([key, value]) => `<li><strong>${key}:</strong> ${escapeHtml(value)}</li>`).join("")}</ul>` +
    `<h3>Size guide</h3>${sizeGuideHtml(option, gender)}` +
    `<h3>How to style it</h3><p>${escapeHtml(PAIRS_WITH[info.dept])}</p>` +
    `<h3>Shipping &amp; returns</h3>${SHIPPING_HTML}`;

  // Structured copies of the attributes, used later for comparison and category matching.
  const metafields = [
    ["color", colour], ["material", material], ["fit", fit], ["season", season],
    ["occasion", occasion], ["care", details.care], ["department", info.dept], ["gender", gender],
  ].map(([key, value]) => ({ namespace: "custom", key, type: "single_line_text_field", value: String(value) }));
  metafields.push({ namespace: "custom", key: "features", type: "multi_line_text_field", value: features.join("\n") });

  const vendor =
    info.dept === "Shoes" ? `${STORE_BRAND} Footwear`
      : ["Bags", "Hats & Caps", "Accessories"].includes(info.dept) ? `${STORE_BRAND} Accessories`
        : `${STORE_BRAND} ${gender}`;

  const tags = [gender, info.dept, info.type, colour, row.season, row.usage, onSale ? "Sale" : null]
    .filter(Boolean);

  return {
    handle: slugify(`${title}-${row.item_ID}`),
    title,
    descriptionHtml,
    vendor,
    productType: info.type,
    tags: [...new Set(tags)],
    seo: {
      title: `${title} | ${STORE_BRAND}`,
      description: `${intro} ${material}, ${fit.toLowerCase()}. Free returns within 30 days.`,
    },
    metafields,
    weightGrams: WEIGHT_GRAMS[info.dept],
    baseSku,
    attributes: {
      gender, department: info.dept, color: colour, material, fit,
      season: row.season, occasion: row.usage,
    },
    image: {
      source: "Marqo/KAGL",
      file: row.file,
      row: row.row,
      rowGroup: row.rowGroup,
      itemId: row.item_ID,
      path: `images/${row.item_ID}.jpg`,
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

const tagRule = (condition) => ({ column: "TAG", relation: "EQUALS", condition });

const COLLECTIONS = [
  { title: "Women", rules: [tagRule("Women"), tagRule("Unisex")], disjunctive: true },
  { title: "Men", rules: [tagRule("Men"), tagRule("Unisex")], disjunctive: true },
  { title: "Tops", rules: [tagRule("Tops")] },
  { title: "Outerwear", rules: [tagRule("Outerwear")] },
  { title: "Bottoms", rules: [tagRule("Bottoms")] },
  { title: "Dresses", rules: [tagRule("Dresses")] },
  { title: "Shoes", rules: [tagRule("Shoes")] },
  { title: "Bags", rules: [tagRule("Bags")] },
  { title: "Hats & Caps", rules: [tagRule("Hats & Caps")] },
  { title: "Accessories", rules: [tagRule("Accessories")] },
  { title: "Sale", rules: [tagRule("Sale")] },
].map((collection) => ({
  ...collection,
  handle: slugify(collection.title),
  descriptionHtml: `<p>Shop ${escapeHtml(collection.title.toLowerCase())} from ${STORE_BRAND}.</p>`,
}));

function toCsv(products) {
  const header = ["sku", "base_sku", "title", "option", "product_type", "department", "gender", "color", "price"];
  const quote = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [header.join(",")];
  for (const product of products) {
    for (const variant of product.variants) {
      lines.push([
        variant.sku, product.baseSku, product.title, variant.option, product.productType,
        product.attributes.department, product.attributes.gender, product.attributes.color,
        variant.price.toFixed(2),
      ].map(quote).join(","));
    }
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const input = process.argv[2] ?? path.join(OUTPUT_DIR, "kagl-metadata.json");
  const rows = JSON.parse(fs.readFileSync(input, "utf8"));
  const usedTitles = new Set();
  const products = selectItems(rows).map((row) => buildProduct(row, usedTitles));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const catalog = {
    store: STORE_BRAND,
    source: "Marqo/KAGL (Kaggle Fashion Product Images), https://huggingface.co/datasets/Marqo/KAGL",
    generatedFrom: path.basename(input),
    products,
    collections: COLLECTIONS,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, "fashion-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  fs.writeFileSync(path.join(OUTPUT_DIR, "fashion-catalog-skus.csv"), toCsv(products));

  const variantCount = products.reduce((sum, product) => sum + product.variants.length, 0);
  const byDept = {};
  products.forEach((product) => {
    byDept[product.attributes.department] = (byDept[product.attributes.department] ?? 0) + 1;
  });
  console.log(`Catalog: ${products.length} products, ${variantCount} variants`);
  console.log(byDept);
}

main();
