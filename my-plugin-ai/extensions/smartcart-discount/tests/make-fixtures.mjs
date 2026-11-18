// Writes the test fixtures (tests/fixtures/*.json) for the bundle discount function.
// Run: node tests/make-fixtures.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
fs.mkdirSync(dir, { recursive: true });

const line = (id, product) => ({
  id: `gid://shopify/CartLine/${id}`,
  merchandise: { __typename: "ProductVariant", product: { id: `gid://shopify/Product/${product}` } },
});
const input = (lines, rules, classes = ["PRODUCT"]) => ({
  cart: { lines },
  discount: { discountClasses: classes, metafield: rules ? { jsonValue: { rules } } : null },
});
const none = { operations: [] };
const discount = (candidates) => ({
  operations: [{ productDiscountsAdd: { candidates, selectionStrategy: "ALL" } }],
});
const candidate = (percent, lineIds) => ({
  message: `Bought together -${percent}%`,
  targets: lineIds.map((id) => ({ cartLine: { id: `gid://shopify/CartLine/${id}` } })),
  value: { percentage: { value: percent } },
});

const cases = {
  "single-rule-applies": [
    input([line(1, 100), line(2, 300)], [{ when: [100], product: 300, percent: 10 }]),
    discount([candidate(10, [2])]),
  ],
  "suggested-product-missing": [
    input([line(1, 100)], [{ when: [100], product: 300, percent: 10 }]),
    none,
  ],
  "combo-rule-needs-every-product": [
    input([line(1, 100), line(2, 300)], [{ when: [100, 200], product: 300, percent: 20 }]),
    none,
  ],
  "combo-rule-applies": [
    input([line(1, 100), line(2, 200), line(3, 300)], [{ when: [100, 200], product: 300, percent: 20 }]),
    discount([candidate(20, [3])]),
  ],
  "best-percent-wins-all-sizes": [
    input(
      [line(1, 100), line(2, 200), line(3, 300), line(4, 300)],
      [
        { when: [100], product: 300, percent: 10 },
        { when: [100, 200], product: 300, percent: 15 },
      ],
    ),
    discount([candidate(15, [3, 4])]),
  ],
  "no-rules-metafield": [input([line(1, 100), line(2, 300)], null), none],
  "product-class-disabled": [
    input([line(1, 100), line(2, 300)], [{ when: [100], product: 300, percent: 10 }], ["ORDER"]),
    none,
  ],
};

for (const [name, [caseInput, output]] of Object.entries(cases)) {
  const fixture = {
    payload: {
      export: "cart-lines-discounts-generate-run",
      target: "cart.lines.discounts.generate.run",
      input: caseInput,
      output,
    },
  };
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
}
console.log(`Wrote ${Object.keys(cases).length} fixtures to ${dir}`);
