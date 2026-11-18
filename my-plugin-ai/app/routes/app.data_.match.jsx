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
import { useT } from "../i18n";

const PAGE_SIZE = 50;

const VI = {
  "Match products in shop": "Khớp sản phẩm trong shop",
  "{matched} matched · {count} products in shop": "{matched} đã khớp · {count} sản phẩm trong shop",
  "Search CSV products": "Tìm sản phẩm CSV",
  "Name or code": "Tên hoặc mã",
  Show: "Hiển thị",
  "Not matched": "Chưa khớp",
  Matched: "Đã khớp",
  "{count} CSV products, most ordered first. Each shop product can be matched to one CSV product.":
    "{count} sản phẩm CSV, nhiều đơn hàng nhất xếp trước. Mỗi sản phẩm trong shop chỉ khớp được với một sản phẩm CSV.",
  "Change shop product": "Đổi sản phẩm shop",
  "Choose shop product": "Chọn sản phẩm shop",
  "{code} · {count} orders": "{code} · {count} đơn hàng",
  Unlink: "Bỏ khớp",
  "{key} (not in shop)": "{key} (không có trong shop)",
  "Page {page} of {count}": "Trang {page}/{count}",
  'Shop product for “{name}”': "Sản phẩm shop cho “{name}”",
  "Search shop products": "Tìm sản phẩm trong shop",
  "Name, SKU or type": "Tên, SKU hoặc loại",
  "Choose {name}": "Chọn {name}",
  "{key} · already matched to “{name}”": "{key} · đã khớp với “{name}”",
  "CSV product not found": "Không tìm thấy sản phẩm CSV",
  "Choose a shop product": "Hãy chọn một sản phẩm shop",
  "That shop product is already matched to “{name}”. Unlink it first.":
    "Sản phẩm shop này đã khớp với “{name}”. Hãy bỏ khớp trước.",
};

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
      {
        success: false,
        error: "That shop product is already matched to “{name}”. Unlink it first.",
        errorVars: { name: taken.name || taken.code },
      },
      { status: 409 },
    );
  }
  await prisma.csvProduct.update({ where: { id }, data: { shopProductKey: productKey } });
  return Response.json({ success: true });
};

function ProductPicker({ csvRow, products, matchedTo, onClose }) {
  const t = useT(VI);
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
      title={t("Shop product for “{name}”", { name: csvRow.name || csvRow.code })}
      secondaryActions={[{ content: t("Cancel"), onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <TextField
            label={t("Search shop products")}
            value={search}
            onChange={setSearch}
            autoComplete="off"
            placeholder={t("Name, SKU or type")}
          />
          {fetcher.data?.error && <Banner tone="critical">{t(fetcher.data.error, fetcher.data.errorVars)}</Banner>}
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
                  accessibilityLabel={t("Choose {name}", { name: product.title })}
                >
                  <BlockStack gap="050">
                    <Text as="span" fontWeight="semibold" tone={usedElsewhere ? "subdued" : undefined}>{product.title}</Text>
                    <Text as="span" tone="subdued">
                      {usedElsewhere
                        ? t("{key} · already matched to “{name}”", { key: product.key, name: owner.label })
                        : `${product.key} · ${product.productType}`}
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
  const t = useT(VI);
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
      title={t("Match products in shop")}
      subtitle={t("{matched} matched · {count} products in shop", {
        matched: formatNumber(matchedTotal),
        count: formatNumber(products.length),
      })}
      backAction={{ content: t("Data"), onAction: () => navigate("/app/data") }}
    >
      <Card>
        <BlockStack gap="300">
          <InlineStack gap="300" blockAlign="end" wrap>
            <div style={{ flex: 1, minWidth: 220 }}>
              <TextField
                label={t("Search CSV products")}
                value={search}
                onChange={setSearch}
                onBlur={() => updateParams({ q: search.trim() })}
                connectedRight={<Button onClick={() => updateParams({ q: search.trim() })}>{t("Search")}</Button>}
                autoComplete="off"
                placeholder={t("Name or code")}
              />
            </div>
            <Select
              label={t("Show")}
              options={[
                { value: "all", label: t("All") },
                { value: "unmatched", label: t("Not matched") },
                { value: "matched", label: t("Matched") },
              ]}
              value={filter}
              onChange={(value) => updateParams({ filter: value === "all" ? "" : value })}
            />
          </InlineStack>

          <Text as="p" tone="subdued">
            {t("{count} CSV products, most ordered first. Each shop product can be matched to one CSV product.", {
              count: formatNumber(total),
            })}
          </Text>

          {rows.map((row) => {
            const product = row.shopProductKey ? productByKey[row.shopProductKey] : null;
            return (
              <InlineStack key={row.id} gap="400" blockAlign="center" wrap={false}>
                <div style={{ width: 210, flexShrink: 0 }}>
                  <Button onClick={() => setPicking(row)} variant={product ? "secondary" : "primary"} fullWidth>
                    {product ? t("Change shop product") : t("Choose shop product")}
                  </Button>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <BlockStack gap="050">
                    <Text as="span" fontWeight="semibold" truncate>{row.name || row.code}</Text>
                    <Text as="span" tone="subdued">{t("{code} · {count} orders", { code: row.code, count: formatNumber(row.orderCount) })}</Text>
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
                          {t("Unlink")}
                        </Button>
                      </BlockStack>
                    </InlineStack>
                  ) : row.shopProductKey ? (
                    <Badge tone="warning">{t("{key} (not in shop)", { key: row.shopProductKey })}</Badge>
                  ) : (
                    <Badge>{t("Not matched")}</Badge>
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
              label={t("Page {page} of {count}", { page: formatNumber(page), count: formatNumber(pageCount) })}
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
