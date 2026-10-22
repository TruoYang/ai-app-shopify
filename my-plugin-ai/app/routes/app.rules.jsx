import { useMemo } from "react";
import { useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
import {
  Page,
  Card,
  Text,
  IndexTable,
  Badge,
  InlineStack,
  Button,
  TextField,
} from "@shopify/polaris";
import "../styles.css";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

function clampInt(value, { min, max, fallback }) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeCartProducts(value) {
  const parsed = safeJsonParse(value);
  if (Array.isArray(parsed)) return parsed.map((item) => String(item));
  if (parsed == null) return [];
  return [String(parsed)];
}

function chunkArray(items, chunkSize) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function fetchSkuTitleMap(admin, skus) {
  const uniqueSkus = Array.from(
    new Set(
      (skus ?? [])
        .map((sku) => String(sku ?? "").trim())
        .filter((sku) => sku.length > 0)
    )
  );

  if (!admin || uniqueSkus.length === 0) return {};

  const requestedSkuSet = new Set(uniqueSkus);
  const resultMap = new Map();

  // Keep query size reasonable; Shopify search string can get large.
  const skuChunks = chunkArray(uniqueSkus, 40);

  const query = `
    query productsBySkus($query: String!) {
      products(first: 250, query: $query) {
        edges {
          node {
            title
            variants(first: 100) {
              edges {
                node {
                  sku
                  title
                }
              }
            }
          }
        }
      }
    }
  `;

  for (const chunk of skuChunks) {
    const searchQuery = chunk.map((sku) => `sku:${sku}`).join(" OR ");
    try {
      const response = await admin.graphql(query, {
        variables: { query: searchQuery },
      });
      const json = await response.json();
      const edges = json?.data?.products?.edges ?? [];

      for (const edge of edges) {
        const product = edge?.node;
        if (!product) continue;
        const productTitle = product.title;
        const variantEdges = product?.variants?.edges ?? [];
        for (const variantEdge of variantEdges) {
          const variant = variantEdge?.node;
          const sku = String(variant?.sku ?? "").trim();
          if (!sku || !requestedSkuSet.has(sku)) continue;

          const variantTitle = String(variant?.title ?? "").trim();
          const displayTitle =
            variantTitle && variantTitle !== "Default Title"
              ? `${productTitle} - ${variantTitle}`
              : productTitle;

          if (!resultMap.has(sku)) {
            resultMap.set(sku, displayTitle);
          }
        }
      }
    } catch {
      // Best-effort lookup; fall back to SKU-only display if Shopify search fails.
    }
  }

  return Object.fromEntries(resultMap.entries());
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const page = clampInt(url.searchParams.get("page"), {
    min: 1,
    max: 10_000,
    fallback: 1,
  });
  const pageSize = clampInt(url.searchParams.get("pageSize"), {
    min: 10,
    max: 200,
    fallback: 50,
  });
  const source = url.searchParams.get("source") || "all";

  const skip = (page - 1) * pageSize;

  const where = { shop: session.shop };

  const [allRules, shopifyOrderSkus] = await Promise.all([
    prisma.recommendationRule.findMany({
      where,
      orderBy: [{ cartSize: "desc" }, { confidence: "desc" }],
    }),
    prisma.orderHistory.findMany({
      where: { shop: session.shop, source: "shopify" },
      select: { productIds: true },
    }),
  ]);

  const shopifySkuSet = new Set(
    shopifyOrderSkus
      .flatMap((order) => normalizeCartProducts(order.productIds))
      .filter((sku) => sku && sku.trim().length > 0)
  );

  const filteredRules = allRules.filter((rule) => {
    if (source === "all") return true;
    const cartItems = normalizeCartProducts(rule.cartProducts);
    if (cartItems.length === 0) return false;

    const allInShopify = cartItems.every((item) => shopifySkuSet.has(item));

    if (source === "shopify") return allInShopify;
    if (source === "csv") return !allInShopify;
    return true;
  });

  const total = filteredRules.length;
  const rules = filteredRules.slice(skip, skip + pageSize);

  const displaySkus = rules
    .flatMap((rule) => {
      const cartSkus = normalizeCartProducts(rule.cartProducts);
      const suggestSku = String(rule.suggestProduct ?? "").trim();
      return suggestSku ? [...cartSkus, suggestSku] : cartSkus;
    })
    .filter((sku) => sku && sku.trim().length > 0);

  const skuTitleMap = await fetchSkuTitleMap(admin, displaySkus);

  return {
    shop: session.shop,
    total,
    page,
    pageSize,
    rules,
    source,
    skuTitleMap,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = String(formData.get("action") ?? "");

  if (actionType === "delete") {
    const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
    if (!Number.isInteger(id)) {
      return Response.json({ success: false, error: "Invalid rule id" }, { status: 400 });
    }

    await prisma.recommendationRule.deleteMany({ where: { id, shop: session.shop } });
    return Response.json({ success: true });
  }

  if (actionType === "create") {
    const cartProducts = String(formData.get("cartProducts") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const suggestProduct = String(formData.get("suggestProduct") ?? "").trim();
    const priority = Number.parseInt(String(formData.get("priority") ?? "0"), 10);
    const discountValue = Number.parseFloat(String(formData.get("discountPercent") ?? ""));

    if (cartProducts.length === 0 || !suggestProduct) {
      return Response.json({ success: false, error: "Cart products and suggestion are required" }, { status: 400 });
    }
    if (cartProducts.includes(suggestProduct)) {
      return Response.json({ success: false, error: "Suggested product must not be in the cart" }, { status: 400 });
    }
    if (Number.isFinite(discountValue) && (discountValue < 0 || discountValue > 100)) {
      return Response.json({ success: false, error: "Discount must be between 0 and 100" }, { status: 400 });
    }

    await prisma.recommendationRule.create({
      data: {
        shop: session.shop,
        cartProducts: JSON.stringify([...new Set(cartProducts)].sort()),
        cartSize: cartProducts.length,
        suggestProduct,
        confidence: 1,
        support: 0,
        source: "merchant",
        status: "active",
        priority: Number.isFinite(priority) ? priority : 0,
        discountPercent: Number.isFinite(discountValue) ? discountValue : null,
      },
    });
    return Response.json({ success: true });
  }

  return Response.json({ success: false, error: "Unsupported action" }, { status: 400 });
};

export default function RulesPage() {
  const { shop, total, page, pageSize, rules, source, skuTitleMap } =
    useLoaderData();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const ruleFetcher = useFetcher();

  const hasPrev = page > 1;
  const hasNext = page * pageSize < total;

  const paginationLabel = useMemo(() => {
    if (total === 0) return "0";
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    return `${start.toLocaleString()}-${end.toLocaleString()} / ${total.toLocaleString()}`;
  }, [page, pageSize, total]);

  const rows = rules.map((rule) => {
    const cartSkus = normalizeCartProducts(rule.cartProducts);
    const cartText = cartSkus
      .map((sku) => {
        const title = skuTitleMap?.[sku];
        return title ? `${sku} (${title})` : sku;
      })
      .join(", ");

    const suggestSku = String(rule.suggestProduct ?? "").trim();
    const suggestTitle = suggestSku ? skuTitleMap?.[suggestSku] : undefined;
    const suggestText = suggestSku
      ? suggestTitle
        ? `${suggestSku} (${suggestTitle})`
        : suggestSku
      : "";

    return [
      cartText,
      suggestText,
      rule.cartSize,
      `${(rule.confidence * 100).toFixed(1)}%`,
      rule.support,
      new Date(rule.updatedAt).toLocaleString(),
    ];
  });

  const goToPage = (nextPage) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(nextPage));
    next.set("pageSize", String(pageSize));
    navigate(`/app/rules?${next.toString()}`);
  };

  const setSourceFilter = (nextSource) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", "1");
    next.set("pageSize", String(pageSize));
    if (nextSource === "all") {
      next.delete("source");
    } else {
      next.set("source", nextSource);
    }
    navigate(`/app/rules?${next.toString()}`);
  };

  return (
    <Page
      title="Recommendation rules"
      subtitle={`Shop: ${shop}`}
      backAction={{ content: "Back", onAction: () => navigate("/app") }}
    >
      <Card>
        <ruleFetcher.Form method="post">
          <TextField
            label="Cart products (comma-separated SKU)"
            name="cartProducts"
            placeholder="SKU-A, SKU-B"
            autoComplete="off"
          />
          <TextField
            label="Suggested SKU"
            name="suggestProduct"
            placeholder="SKU-C"
            autoComplete="off"
          />
          <InlineStack gap="300" blockAlign="end">
            <TextField label="Priority" name="priority" type="number" defaultValue="0" autoComplete="off" />
            <TextField label="Discount %" name="discountPercent" type="number" min={0} max={100} autoComplete="off" />
            <input type="hidden" name="action" value="create" />
            <Button submit variant="primary">Add rule</Button>
          </InlineStack>
        </ruleFetcher.Form>

        <InlineStack align="space-between" blockAlign="center" gap="300">
          <div className="InlineStack-summary">
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="bodyMd">
                Total: <strong>{total.toLocaleString()}</strong>
              </Text>
              <Badge tone="info">DB: RecommendationRule</Badge>
            </InlineStack>
          </div>

          <div className="InlineStack-buttons">
            <InlineStack gap="500" blockAlign="center">
              <Button
                pressed={source === "all"}
                onClick={() => setSourceFilter("all")}
              >
                All
              </Button>
              <Button
                pressed={source === "shopify"}
                onClick={() => setSourceFilter("shopify")}
              >
                Shopify
              </Button>
              <Button
                pressed={source === "csv"}
                onClick={() => setSourceFilter("csv")}
              >
                CSV
              </Button>
              <Text as="span" tone="subdued">
                {paginationLabel}
              </Text>
              <Button disabled={!hasPrev} onClick={() => goToPage(page - 1)}>
                Prev
              </Button>
              <Button disabled={!hasNext} onClick={() => goToPage(page + 1)}>
                Next
              </Button>
            </InlineStack>
          </div>
        </InlineStack>

        <div style={{ marginTop: 12 }}>
          <IndexTable
            itemCount={rules.length}
            headings={[
              { title: "Cart products (SKU + name)" },
              { title: "Suggest (SKU + name)" },
              { title: "Cart size" },
              { title: "Confidence" },
              { title: "Support" },
              { title: "Updated" },
              { title: "Actions" },
            ]}
            selectable={false}
          >
            {rows.map((row, index) => (
              <IndexTable.Row id={String(index)} key={index} position={index}>
                {row.map((cell, cellIndex) => (
                  <IndexTable.Cell key={cellIndex}>{cell}</IndexTable.Cell>
                ))}
                <IndexTable.Cell>
                  <ruleFetcher.Form method="post">
                    <input type="hidden" name="action" value="delete" />
                    <input type="hidden" name="id" value={rules[index].id} />
                    <Button submit tone="critical">Delete</Button>
                  </ruleFetcher.Form>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </div>
      </Card>
    </Page>
  );
}
