// SmartCart RCM bundle discount (Shopify Discount Function).
//
// The app writes the merchant's discounted rules into the discount's metafield
// ($app:smartcart / discount-rules), as numeric product ids:
//   { "rules": [{ "when": [111, 222], "product": 333, "percent": 10 }, ...] }
// A rule applies when every product in `when` and the suggested `product` are in the cart:
// the suggested product's lines get `percent` off. When several rules discount the same
// product, the highest percentage wins.

import { DiscountClass, ProductDiscountSelectionStrategy } from '../generated/api';

const MAX_PERCENT = 90;

/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

const numericId = (gid) => Number(String(gid).split('/').pop());

/**
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const lines = input.cart.lines;
  if (!lines.length || !input.discount.discountClasses.includes(DiscountClass.Product)) {
    return { operations: [] };
  }

  const rules = input.discount.metafield?.jsonValue?.rules;
  if (!Array.isArray(rules) || rules.length === 0) return { operations: [] };

  // Cart lines grouped by product id.
  const linesByProduct = new Map();
  for (const line of lines) {
    if (line.merchandise.__typename !== 'ProductVariant') continue;
    const id = numericId(line.merchandise.product.id);
    if (!linesByProduct.has(id)) linesByProduct.set(id, []);
    linesByProduct.get(id).push(line.id);
  }

  // Best percentage per suggested product.
  const best = new Map();
  for (const rule of rules) {
    const percent = Math.min(Number(rule?.percent) || 0, MAX_PERCENT);
    if (percent <= 0 || !linesByProduct.has(rule.product)) continue;
    if (!Array.isArray(rule.when) || rule.when.length === 0) continue;
    if (!rule.when.every((id) => id !== rule.product && linesByProduct.has(id))) continue;
    if (percent > (best.get(rule.product) ?? 0)) best.set(rule.product, percent);
  }
  if (best.size === 0) return { operations: [] };

  const candidates = [...best.entries()].map(([product, percent]) => ({
    message: `Bought together -${percent}%`,
    targets: linesByProduct.get(product).map((id) => ({ cartLine: { id } })),
    value: { percentage: { value: percent } },
  }));

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}
