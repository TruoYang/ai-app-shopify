// Rules page: every recommendation rule as "cart product(s) -> suggested product" with
// product cards (image, name, price, link to the product), plus filters and rule controls.
/* eslint-disable react/prop-types -- the project does not use the prop-types package */

import { useMemo, useState } from "react";
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
  Badge,
  Banner,
  Pagination,
  Thumbnail,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatNumber } from "../format";
import { getShopCatalog, toProductKey } from "../catalog.server";

const PAGE_SIZE = 25;
const DEPARTMENTS = ["Tops", "Outerwear", "Bottoms", "Dresses", "Shoes", "Bags", "Hats & Caps", "Accessories"];
const GENDERS = ["Women", "Men", "Unisex"];
const CATEGORY_OPTIONS = [
  { value: "all", label: "All" },
  { value: "combo", label: "Combo (different categories)" },
  ...DEPARTMENTS.map((department) => ({ value: department, label: `Suggests ${department.toLowerCase()}` })),
];
const SORTS = {
  priority: [{ priority: "desc" }, { confidence: "desc" }, { support: "desc" }],
  confidence: [{ confidence: "desc" }, { support: "desc" }],
  support: [{ support: "desc" }, { confidence: "desc" }],
  newest: [{ updatedAt: "desc" }],
};

const toCard = (product, key) => product
  ? {
    key: product.key,
    title: product.title,
    image: product.image,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    currency: product.currency,
    handle: product.handle,
  }
  : { key, title: key, image: null, price: null, missing: true };

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const source = url.searchParams.get("source") ?? "all";
  const status = url.searchParams.get("status") ?? "all";
  const sort = SORTS[url.searchParams.get("sort")] ? url.searchParams.get("sort") : "priority";
  const type = ["1", "2"].includes(url.searchParams.get("type")) ? url.searchParams.get("type") : "all";
  const category = url.searchParams.get("category") ?? "all";
  const gender = GENDERS.includes(url.searchParams.get("gender")) ? url.searchParams.get("gender") : "all";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const catalog = await getShopCatalog(shop, admin);
  const products = [...catalog.products.values()];
  // Department and gender come from the product tags set by the catalog builders.
  const traits = new Map(products.map((product) => [product.key, {
    department: DEPARTMENTS.find((department) => product.tags.includes(department)) ?? null,
    gender: GENDERS.find((value) => product.tags.includes(value)) ?? null,
  }]));

  // Search by product name or SKU: rules that mention any matching product.
  let productFilter = {};
  if (query) {
    const needle = query.toLowerCase();
    const keys = products
      .filter((product) => `${product.title} ${product.key}`.toLowerCase().includes(needle))
      .map((product) => product.key)
      .slice(0, 40);
    if (needle && !keys.includes(query)) keys.push(query);
    productFilter = {
      OR: [
        { suggestProduct: { in: keys } },
        ...keys.map((key) => ({ cartProducts: { contains: `"${key}` } })),
      ],
    };
  }

  // "Suggests <department>" filters in SQL; "combo" and gender need the cart products too,
  // so those rules are scanned in memory and paginated afterwards.
  const suggestKeys = DEPARTMENTS.includes(category)
    ? products.filter((product) => traits.get(product.key).department === category).map((product) => product.key)
    : null;
  const where = {
    shop,
    ...(source !== "all" ? { source } : {}),
    ...(status !== "all" ? { status } : {}),
    ...(type !== "all" ? { cartSize: Number(type) } : {}),
    ...(suggestKeys ? { suggestProduct: { in: suggestKeys } } : {}),
    ...productFilter,
  };

  const keysOf = (rule) => {
    let cart = [];
    try {
      cart = JSON.parse(rule.cartProducts);
    } catch {
      cart = [];
    }
    return { cart: cart.map((sku) => toProductKey(catalog, String(sku).trim())), suggest: toProductKey(catalog, rule.suggestProduct) };
  };
  const matchesTraits = (rule) => {
    const { cart, suggest } = keysOf(rule);
    if (category === "combo") {
      const suggestDepartment = traits.get(suggest)?.department;
      if (!suggestDepartment || cart.some((key) => traits.get(key)?.department === suggestDepartment)) return false;
    }
    if (gender !== "all") {
      return [...cart, suggest].every((key) => [gender, "Unisex"].includes(traits.get(key)?.gender));
    }
    return true;
  };

  let rules;
  let total;
  if (category === "combo" || gender !== "all") {
    const candidates = await prisma.recommendationRule.findMany({
      where, orderBy: SORTS[sort], select: { id: true, cartProducts: true, suggestProduct: true },
    });
    const kept = candidates.filter(matchesTraits);
    total = kept.length;
    const ids = kept.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((rule) => rule.id);
    const byId = new Map((await prisma.recommendationRule.findMany({ where: { id: { in: ids } } })).map((rule) => [rule.id, rule]));
    rules = ids.map((id) => byId.get(id)).filter(Boolean);
  } else {
    [rules, total] = await Promise.all([
      prisma.recommendationRule.findMany({ where, orderBy: SORTS[sort], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      prisma.recommendationRule.count({ where }),
    ]);
  }

  const [counts] = await Promise.all([
    prisma.recommendationRule.groupBy({ by: ["source", "status"], where: { shop }, _count: true }),
  ]);

  const cardFor = (sku) => {
    const key = toProductKey(catalog, String(sku).trim());
    return toCard(catalog.products.get(key), key);
  };
  const rows = rules.map((rule) => {
    let cart = [];
    try {
      cart = JSON.parse(rule.cartProducts);
    } catch {
      cart = [];
    }
    return {
      id: rule.id,
      cart: cart.map(cardFor),
      suggest: cardFor(rule.suggestProduct),
      confidence: rule.confidence,
      support: rule.support,
      source: rule.source,
      status: rule.status,
      priority: rule.priority,
      discountPercent: rule.discountPercent,
    };
  });

  const summary = { model: 0, merchant: 0, active: 0, disabled: 0 };
  counts.forEach((row) => {
    summary[row.source] = (summary[row.source] ?? 0) + row._count;
    summary[row.status] = (summary[row.status] ?? 0) + row._count;
  });

  return {
    shop,
    rows,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    filters: { query, source, status, sort, type, category, gender },
    summary,
    options: products
      .map((product) => ({ value: product.key, label: `${product.title} (${product.key})` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);

  if (intent === "create") {
    const cart = [String(formData.get("cartA") ?? "").trim(), String(formData.get("cartB") ?? "").trim()].filter(Boolean);
    const suggest = String(formData.get("suggest") ?? "").trim();
    const priority = Number.parseInt(String(formData.get("priority") ?? "0"), 10);
    const discount = Number.parseFloat(String(formData.get("discountPercent") ?? ""));
    if (cart.length === 0 || !suggest || cart.includes(suggest)) {
      return Response.json({ success: false, error: "Choose a cart product and a different product to suggest." }, { status: 400 });
    }
    if (Number.isFinite(discount) && (discount < 0 || discount > 100)) {
      return Response.json({ success: false, error: "Discount must be between 0 and 100." }, { status: 400 });
    }
    await prisma.recommendationRule.create({
      data: {
        shop,
        cartProducts: JSON.stringify([...new Set(cart)].sort()),
        cartSize: new Set(cart).size,
        suggestProduct: suggest,
        confidence: 1,
        support: 0,
        source: "merchant",
        status: "active",
        priority: Number.isFinite(priority) ? priority : 0,
        discountPercent: Number.isFinite(discount) ? discount : null,
      },
    });
    return Response.json({ success: true, message: "Rule added." });
  }

  if (!Number.isInteger(id)) return Response.json({ success: false, error: "Invalid rule" }, { status: 400 });

  if (intent === "delete") {
    await prisma.recommendationRule.deleteMany({ where: { id, shop } });
    return Response.json({ success: true });
  }
  if (intent === "toggle") {
    const status = formData.get("status") === "active" ? "active" : "disabled";
    await prisma.recommendationRule.updateMany({ where: { id, shop }, data: { status } });
    return Response.json({ success: true });
  }
  if (intent === "update") {
    const rawDiscount = String(formData.get("discountPercent") ?? "").trim();
    const discount = rawDiscount === "" ? null : Number.parseFloat(rawDiscount);
    const priority = Number.parseInt(String(formData.get("priority") ?? "0"), 10);
    if (discount !== null && (!Number.isFinite(discount) || discount < 0 || discount > 100)) {
      return Response.json({ success: false, error: "Discount must be between 0 and 100." }, { status: 400 });
    }
    await prisma.recommendationRule.updateMany({
      where: { id, shop },
      data: { discountPercent: discount, priority: Number.isFinite(priority) ? priority : 0 },
    });
    return Response.json({ success: true });
  }
  return Response.json({ success: false, error: "Unknown action" }, { status: 400 });
};

function formatPrice(value, currency) {
  if (value === null || value === undefined) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(value);
}

// One product: image, name, SKU and price; opens the product page on the storefront.
function ProductCard({ product, shop }) {
  const body = (
    <div className={`rule-card${product.missing ? " rule-card--missing" : ""}`}>
      <Thumbnail source={product.image || ""} alt={product.title} size="large" />
      <div className="rule-card__info">
        <Text as="span" fontWeight="semibold" truncate>{product.missing ? "Not in shop" : product.title}</Text>
        <Text as="span" tone="subdued" variant="bodySm">{product.key}</Text>
        {product.price !== null && (
          <InlineStack gap="150" blockAlign="baseline">
            <Text as="span">{formatPrice(product.price, product.currency)}</Text>
            {product.compareAtPrice && (
              <Text as="span" tone="subdued" textDecorationLine="line-through" variant="bodySm">
                {formatPrice(product.compareAtPrice, product.currency)}
              </Text>
            )}
          </InlineStack>
        )}
      </div>
    </div>
  );
  if (product.missing) return body;
  return (
    <a className="rule-card__link" href={`https://${shop}/products/${product.handle}`} target="_blank" rel="noreferrer">
      {body}
    </a>
  );
}

function RuleRow({ rule, shop }) {
  const fetcher = useFetcher();
  const [discount, setDiscount] = useState(rule.discountPercent ?? "");
  const [priority, setPriority] = useState(String(rule.priority));
  const busy = fetcher.state !== "idle";
  const submit = (data) => fetcher.submit({ id: String(rule.id), ...data }, { method: "post" });

  return (
    <Card>
      <BlockStack gap="300">
        <div className="rule-row">
          <div className="rule-row__cart">
            {rule.cart.map((product) => <ProductCard key={product.key} product={product} shop={shop} />)}
          </div>
          <div className="rule-row__arrow" aria-label="suggests">→</div>
          <div className="rule-row__suggest">
            <ProductCard product={rule.suggest} shop={shop} />
          </div>
        </div>

        <InlineStack align="space-between" blockAlign="end" gap="300" wrap>
          <InlineStack gap="200" blockAlign="center" wrap>
            <Badge tone={rule.status === "active" ? "success" : "critical"}>{rule.status}</Badge>
            <Badge tone={rule.source === "merchant" ? "info" : undefined}>{rule.source === "merchant" ? "Your rule" : "Model"}</Badge>
            {rule.source === "model" && (
              <Text as="span" tone="subdued">
                {`${Math.round(rule.confidence * 100)}% of orders with the cart also bought it · ${rule.support} orders`}
              </Text>
            )}
            {rule.discountPercent ? <Badge tone="warning">{`-${rule.discountPercent}%`}</Badge> : null}
          </InlineStack>
          <InlineStack gap="200" blockAlign="end" wrap>
            <div style={{ width: 90 }}>
              <TextField label="Discount %" type="number" min={0} max={100} value={String(discount)} onChange={setDiscount} autoComplete="off" />
            </div>
            <div style={{ width: 80 }}>
              <TextField label="Priority" type="number" value={priority} onChange={setPriority} autoComplete="off" />
            </div>
            <Button loading={busy} onClick={() => submit({ intent: "update", discountPercent: String(discount), priority })}>Save</Button>
            <Button
              tone={rule.status === "active" ? "critical" : undefined}
              onClick={() => submit({ intent: "toggle", status: rule.status === "active" ? "disabled" : "active" })}
            >
              {rule.status === "active" ? "Disable" : "Enable"}
            </Button>
            <Button tone="critical" variant="tertiary" onClick={() => submit({ intent: "delete" })}>Delete</Button>
          </InlineStack>
        </InlineStack>
        {fetcher.data?.error && <Text as="p" tone="critical">{fetcher.data.error}</Text>}
      </BlockStack>
    </Card>
  );
}

function AddRuleCard({ options }) {
  const fetcher = useFetcher();
  const [search, setSearch] = useState("");
  const [cartA, setCartA] = useState("");
  const [cartB, setCartB] = useState("");
  const [suggest, setSuggest] = useState("");
  const [priority, setPriority] = useState("0");
  const [discount, setDiscount] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return options.filter((option) => !q || option.label.toLowerCase().includes(q)).slice(0, 150);
  }, [options, search]);
  const withSelected = (value) => {
    const selected = options.find((option) => option.value === value);
    return selected && !filtered.includes(selected) ? [selected, ...filtered] : filtered;
  };

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">Add your own rule</Text>
        <TextField label="Find products" value={search} onChange={setSearch} placeholder="Name or SKU" autoComplete="off"
          helpText="Filters the three lists below." />
        <InlineStack gap="300" wrap>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Select label="When the cart has" options={[{ label: "Choose a product", value: "" }, ...withSelected(cartA)]} value={cartA} onChange={setCartA} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Select label="and (optional)" options={[{ label: "No second product", value: "" }, ...withSelected(cartB)]} value={cartB} onChange={setCartB} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Select label="Suggest" options={[{ label: "Choose a product", value: "" }, ...withSelected(suggest)]} value={suggest} onChange={setSuggest} />
          </div>
        </InlineStack>
        <InlineStack gap="300" blockAlign="end">
          <div style={{ width: 100 }}><TextField label="Priority" type="number" value={priority} onChange={setPriority} autoComplete="off" /></div>
          <div style={{ width: 110 }}><TextField label="Discount %" type="number" min={0} max={100} value={discount} onChange={setDiscount} autoComplete="off" /></div>
          <Button
            variant="primary"
            loading={fetcher.state !== "idle"}
            onClick={() => fetcher.submit({ intent: "create", cartA, cartB, suggest, priority, discountPercent: discount }, { method: "post" })}
          >
            Add rule
          </Button>
        </InlineStack>
        {fetcher.data?.error && <Banner tone="critical">{fetcher.data.error}</Banner>}
        {fetcher.data?.success && <Banner tone="success">{fetcher.data.message}</Banner>}
      </BlockStack>
    </Card>
  );
}

export default function RulesPage() {
  const { shop, rows, total, page, pageCount, filters, summary, options } = useLoaderData();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Search and filters are edited locally and applied together with "Execute",
  // so changing several filters reloads the rules only once.
  const applied = {
    q: filters.query, type: filters.type, category: filters.category,
    gender: filters.gender, source: filters.source, status: filters.status,
  };
  const [draft, setDraft] = useState(applied);
  const setFilter = (key) => (value) => setDraft((current) => ({ ...current, [key]: value }));
  const pending = Object.keys(applied).some((key) => (draft[key] ?? "") !== (applied[key] ?? ""));
  const DEFAULT_FILTERS = { q: "", type: "all", category: "all", gender: "all", source: "all", status: "all" };

  const updateParams = (changes) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => (value && value !== "all" ? next.set(key, value) : next.delete(key)));
    if (!("page" in changes)) next.delete("page");
    setSearchParams(next);
  };

  return (
    <Page
      title="Recommendation rules"
      subtitle={`${formatNumber(summary.model ?? 0)} from the model · ${formatNumber(summary.merchant ?? 0)} yours · ${formatNumber(summary.disabled ?? 0)} disabled`}
      backAction={{ content: "Recommendations", onAction: () => navigate("/app") }}
    >
      <BlockStack gap="400">
        <AddRuleCard options={options} />

        <Card>
          <BlockStack gap="300">
            <form onSubmit={(event) => { event.preventDefault(); updateParams({ ...draft, q: draft.q.trim() }); }}>
              <TextField
                label="Search rules"
                value={draft.q}
                onChange={setFilter("q")}
                placeholder="Product name or SKU"
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setFilter("q")("")}
              />
            </form>
            <InlineStack gap="300" blockAlign="end" wrap>
              <Select label="Rule type" value={draft.type} onChange={setFilter("type")}
                options={[{ value: "all", label: "All" }, { value: "1", label: "1 product → 1" }, { value: "2", label: "2 products → 1" }]} />
              <Select label="Category" value={draft.category} onChange={setFilter("category")}
                options={CATEGORY_OPTIONS} />
              <Select label="Gender" value={draft.gender} onChange={setFilter("gender")}
                options={[{ value: "all", label: "All" }, ...GENDERS.map((value) => ({ value, label: value }))]} />
              <Select label="Source" value={draft.source} onChange={setFilter("source")}
                options={[{ value: "all", label: "All" }, { value: "model", label: "Model" }, { value: "merchant", label: "Yours" }]} />
              <Select label="Status" value={draft.status} onChange={setFilter("status")}
                options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]} />
            </InlineStack>
            <InlineStack gap="200" blockAlign="center">
              <Button variant="primary" onClick={() => updateParams({ ...draft, q: draft.q.trim() })}>Execute</Button>
              <Button onClick={() => { setDraft(DEFAULT_FILTERS); updateParams(DEFAULT_FILTERS); }}>Reset</Button>
              {pending && <Text as="span" tone="caution">Changes not applied yet</Text>}
            </InlineStack>
          </BlockStack>
        </Card>

        <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
          <Text as="p" tone="subdued">{`${formatNumber(total)} rules match. Click a product to open it in the store.`}</Text>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" tone="subdued">Sort by</Text>
            <Select label="Sort by" labelHidden value={filters.sort} onChange={(value) => updateParams({ sort: value })}
              options={[
                { value: "priority", label: "Priority" },
                { value: "confidence", label: "Confidence" },
                { value: "support", label: "Most orders" },
                { value: "newest", label: "Recently changed" },
              ]} />
          </InlineStack>
        </InlineStack>
        {rows.length === 0 ? (
          <Card><Text as="p">No rules match. Train the model on the home page or add your own rule above.</Text></Card>
        ) : (
          rows.map((rule) => <RuleRow key={rule.id} rule={rule} shop={shop} />)
        )}

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
    </Page>
  );
}
