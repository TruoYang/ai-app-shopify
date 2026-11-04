// Match products found in imported CSV orders to products in this shop (one to one).
// Training only uses CSV products that are matched (see api.train.jsx).
/* eslint-disable react/prop-types -- the project does not use the prop-types package */

import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Select,
  Modal,
  Badge,
  Banner,
  Thumbnail,
  Pagination,
  ResourceList,
  ResourceItem,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatNumber } from "../format";
import { getShopCatalog } from "../catalog.server";

const PAGE_SIZE = 50;

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const filter = url.searchParams.get("filter") ?? "all";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const where = {
    shop,
    ...(filter === "matched" ? { shopProductKey: { not: null } } : {}),
    ...(filter === "unmatched" ? { shopProductKey: null } : {}),
    ...(query ? { OR: [{ name: { contains: query } }, { code: { contains: query } }] } : {}),
  };

  const [rows, total, matchedTotal, allMatches, catalog] = await Promise.all([
    prisma.csvProduct.findMany({
      where,
      orderBy: [{ orderCount: "desc" }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.csvProduct.count({ where }),
    prisma.csvProduct.count({ where: { shop, shopProductKey: { not: null } } }),
    prisma.csvProduct.findMany({
      where: { shop, shopProductKey: { not: null } },
      select: { id: true, name: true, code: true, shopProductKey: true },
    }),
    getShopCatalog(shop, admin),
  ]);

  const products = [...catalog.products.values()].map((product) => ({
    key: product.key,
    title: product.title,
    image: product.image,
    productType: product.productType,
  }));
  // Shop product key -> the CSV product it is already matched to.
  const matchedTo = Object.fromEntries(allMatches.map((row) => [row.shopProductKey, { id: row.id, label: row.name || row.code }]));

  return { rows, total, matchedTotal, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), query, filter, products, matchedTo };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = Number(formData.get("id"));
  const row = await prisma.csvProduct.findFirst({ where: { id, shop } });
  if (!row) return Response.json({ success: false, error: "CSV product not found" }, { status: 404 });

  if (intent === "unmatch") {
    await prisma.csvProduct.update({ where: { id }, data: { shopProductKey: null } });
    return Response.json({ success: true });
  }

  const productKey = String(formData.get("productKey") ?? "");
  if (!productKey) return Response.json({ success: false, error: "Choose a shop product" }, { status: 400 });
  const taken = await prisma.csvProduct.findFirst({ where: { shop, shopProductKey: productKey, NOT: { id } } });
  if (taken) {
    return Response.json(
      { success: false, error: `That shop product is already matched to "${taken.name || taken.code}". Unlink it first.` },
      { status: 409 },
    );
  }
  await prisma.csvProduct.update({ where: { id }, data: { shopProductKey: productKey } });
  return Response.json({ success: true });
};

function ProductPicker({ csvRow, products, matchedTo, onClose }) {
  const fetcher = useFetcher();
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((product) => !q || `${product.title} ${product.key} ${product.productType}`.toLowerCase().includes(q));
  }, [products, search]);

  useEffect(() => {
    if (fetcher.data?.success) onClose();
  }, [fetcher.data, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Shop product for "${csvRow.name || csvRow.code}"`}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <TextField label="Search shop products" value={search} onChange={setSearch} autoComplete="off" placeholder="Name, SKU or type" />
          {fetcher.data?.error && <Banner tone="critical">{fetcher.data.error}</Banner>}
          <ResourceList
            items={filtered.slice(0, 100)}
            renderItem={(product) => {
              const owner = matchedTo[product.key];
              const usedElsewhere = owner && owner.id !== csvRow.id;
              return (
                <ResourceItem
                  id={product.key}
                  media={<Thumbnail source={product.image || ""} alt={product.title} size="small" />}
                  onClick={() => {
                    if (usedElsewhere || fetcher.state !== "idle") return;
                    fetcher.submit({ intent: "match", id: String(csvRow.id), productKey: product.key }, { method: "post" });
                  }}
                  accessibilityLabel={`Choose ${product.title}`}
                >
                  <BlockStack gap="050">
                    <Text as="span" fontWeight="semibold" tone={usedElsewhere ? "subdued" : undefined}>{product.title}</Text>
                    <Text as="span" tone="subdued">
                      {usedElsewhere ? `${product.key} · already matched to "${owner.label}"` : `${product.key} · ${product.productType}`}
                    </Text>
                  </BlockStack>
                </ResourceItem>
              );
            }}
          />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

export default function MatchPage() {
  const { rows, total, matchedTotal, page, pageCount, query, filter, products, matchedTo } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const unlinkFetcher = useFetcher();
  const [picking, setPicking] = useState(null);
  const [search, setSearch] = useState(query);
  const productByKey = useMemo(() => Object.fromEntries(products.map((product) => [product.key, product])), [products]);

  const updateParams = (changes) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)));
    if (!("page" in changes)) next.delete("page");
    setSearchParams(next);
  };

  return (
    <Page
      title="Match products in shop"
      subtitle={`${matchedTotal} matched · ${products.length} products in shop`}
      backAction={{ content: "Data", onAction: () => navigate("/app/data") }}
    >
      <Card>
        <BlockStack gap="300">
          <InlineStack gap="300" blockAlign="end" wrap>
            <div style={{ flex: 1, minWidth: 220 }}>
              <TextField
                label="Search CSV products"
                value={search}
                onChange={setSearch}
                onBlur={() => updateParams({ q: search.trim() })}
                connectedRight={<Button onClick={() => updateParams({ q: search.trim() })}>Search</Button>}
                autoComplete="off"
                placeholder="Name or code"
              />
            </div>
            <Select
              label="Show"
              options={[
                { value: "all", label: "All" },
                { value: "unmatched", label: "Not matched" },
                { value: "matched", label: "Matched" },
              ]}
              value={filter}
              onChange={(value) => updateParams({ filter: value === "all" ? "" : value })}
            />
          </InlineStack>

          <Text as="p" tone="subdued">
            {`${formatNumber(total)} CSV products, most ordered first. Each shop product can be matched to one CSV product.`}
          </Text>

          {rows.map((row) => {
            const product = row.shopProductKey ? productByKey[row.shopProductKey] : null;
            return (
              <InlineStack key={row.id} gap="400" blockAlign="center" wrap={false}>
                <div style={{ width: 210, flexShrink: 0 }}>
                  <Button onClick={() => setPicking(row)} variant={product ? "secondary" : "primary"} fullWidth>
                    {product ? "Change shop product" : "Choose shop product"}
                  </Button>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <BlockStack gap="050">
                    <Text as="span" fontWeight="semibold" truncate>{row.name || row.code}</Text>
                    <Text as="span" tone="subdued">{`${row.code} · ${formatNumber(row.orderCount)} orders`}</Text>
                  </BlockStack>
                </div>
                <div style={{ width: 300, flexShrink: 0 }}>
                  {product ? (
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <Thumbnail source={product.image || ""} alt={product.title} size="small" />
                      <BlockStack gap="050">
                        <Text as="span" truncate>{product.title}</Text>
                        <Button
                          variant="plain"
                          tone="critical"
                          onClick={() => unlinkFetcher.submit({ intent: "unmatch", id: String(row.id) }, { method: "post" })}
                        >
                          Unlink
                        </Button>
                      </BlockStack>
                    </InlineStack>
                  ) : row.shopProductKey ? (
                    <Badge tone="warning">{`${row.shopProductKey} (not in shop)`}</Badge>
                  ) : (
                    <Badge>Not matched</Badge>
                  )}
                </div>
              </InlineStack>
            );
          })}

          <InlineStack align="center">
            <Pagination
              hasPrevious={page > 1}
              onPrevious={() => updateParams({ page: String(page - 1) })}
              hasNext={page < pageCount}
              onNext={() => updateParams({ page: String(page + 1) })}
              label={`Page ${page} of ${pageCount}`}
            />
          </InlineStack>
        </BlockStack>
      </Card>

      {picking && (
        <ProductPicker csvRow={picking} products={products} matchedTo={matchedTo} onClose={() => setPicking(null)} />
      )}
    </Page>
  );
}
