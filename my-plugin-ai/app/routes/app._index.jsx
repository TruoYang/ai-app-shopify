// Main page APP

import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  Page,
  Button,
  Banner,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Modal,
  TextField,
  Select,
  Badge,
} from "@shopify/polaris";
import "../styles.css";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ruleSelect = {
    id: true,
    cartProducts: true,
    suggestProduct: true,
    confidence: true,
    support: true,
    source: true,
    status: true,
    priority: true,
    discountPercent: true,
  };
  const [activeRules, disabledRules] = await Promise.all([
    prisma.recommendationRule.findMany({
      where: { shop: session.shop, status: "active" },
      orderBy: [{ priority: "desc" }, { confidence: "desc" }],
      take: 100,
      select: ruleSelect,
    }),
    prisma.recommendationRule.findMany({
      where: { shop: session.shop, status: "disabled" },
      orderBy: [{ priority: "desc" }, { confidence: "desc" }],
      take: 100,
      select: ruleSelect,
    }),
  ]);
  const rules = [...activeRules, ...disabledRules];

  const productResponse = await admin.graphql(`
    query RecommendationProducts {
      products(first: 250) {
        nodes {
          title
          variants(first: 100) {
            nodes {
              sku
              title
            }
          }
        }
      }
    }
  `);
  const productData = await productResponse.json();
  const products = (productData.data?.products?.nodes ?? []).flatMap((product) =>
    (product.variants?.nodes ?? [])
      .filter((variant) => variant.sku)
      .map((variant) => ({
        sku: variant.sku.trim(),
        title: variant.title && variant.title !== "Default Title"
          ? `${product.title} - ${variant.title}`
          : product.title,
      }))
  );

  return { rules, products };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = String(formData.get("action") ?? "");
  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);

  if (actionType === "delete" && Number.isInteger(id)) {
    await prisma.recommendationRule.deleteMany({ where: { id, shop: session.shop } });
    return Response.json({ success: true });
  }

  if (actionType === "create") {
    const cartProducts = [
      String(formData.get("cartProductA") ?? "").trim(),
      String(formData.get("cartProductB") ?? "").trim(),
    ].filter(Boolean);
    const suggestProduct = String(formData.get("suggestProduct") ?? "").trim();
    const priority = Number.parseInt(String(formData.get("priority") ?? "0"), 10);
    const discountValue = Number.parseFloat(String(formData.get("discountPercent") ?? ""));

    if (cartProducts.length === 0 || !suggestProduct || cartProducts.includes(suggestProduct)) {
      return Response.json({ success: false, error: "Choose cart products and a different suggested product" }, { status: 400 });
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

  if (actionType === "updateDiscount" && Number.isInteger(id)) {
    const rawDiscount = String(formData.get("discountPercent") ?? "").trim();
    const discountValue = rawDiscount === "" ? null : Number.parseFloat(rawDiscount);
    if (discountValue !== null && (!Number.isFinite(discountValue) || discountValue < 0 || discountValue > 100)) {
      return Response.json({ success: false, error: "Discount must be between 0 and 100" }, { status: 400 });
    }

    await prisma.recommendationRule.updateMany({
      where: { id, shop: session.shop },
      data: { discountPercent: discountValue },
    });
    return Response.json({ success: true });
  }

  if (actionType !== "toggle" || !Number.isInteger(id)) {
    return Response.json({ success: false, error: "Invalid rule action" }, { status: 400 });
  }

  const status = String(formData.get("status") ?? "") === "active" ? "active" : "disabled";
  await prisma.recommendationRule.updateMany({
    where: { id, shop: session.shop },
    data: { status },
  });

  return Response.json({ success: true });
};

// Component
export default function TrainAIPage() {
  const { rules, products } = useLoaderData();
  const ruleFetcher = useFetcher();
  const [trainResult, setTrainResult] = useState(null);
  const [trainLoading, setTrainLoading] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [cartProductA, setCartProductA] = useState("");
  const [cartProductB, setCartProductB] = useState("");
  const [suggestProduct, setSuggestProduct] = useState("");
  const [priority, setPriority] = useState("0");
  const [discountPercent, setDiscountPercent] = useState("");

  const productMap = Object.fromEntries(products.map((product) => [product.sku, product.title]));
  const productOptions = products
    .filter((product) => {
      const query = productSearch.trim().toLowerCase();
      return !query || `${product.sku} ${product.title}`.toLowerCase().includes(query);
    })
    .slice(0, 100)
    .map((product) => ({
      label: `${product.title} (${product.sku})`,
      value: product.sku,
    }));

  const formatRuleProducts = (value) => {
    try {
      const skus = JSON.parse(value);
      if (!Array.isArray(skus)) return value;
      return skus.map((sku) => productMap[sku] ? `${productMap[sku]} (${sku})` : sku).join(" + ");
    } catch {
      return value;
    }
  };

  const handleTrain = async () => {
    setTrainResult(null);
    setTrainLoading(true);

    try {
      const shop = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("shop")
        : null;

      if (!shop) {
        setTrainResult({
          success: false,
          error: "Missing shop param in URL",
        });
        return;
      }

      const response = await fetch(`/api/train?shop=${encodeURIComponent(shop)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (response.redirected) {
        setTrainResult({
          success: false,
          error: "Session expired. Please reload and log in again.",
        });
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setTrainResult({
          success: false,
          error: "Unexpected response (not JSON). Please reload and try again.",
        });
        return;
      }

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setTrainResult({
          success: false,
          error: data?.error || `Request failed (${response.status})`,
        });
        return;
      }

      setTrainResult(data);
    } catch (error) {
      setTrainResult({
        success: false,
        error: error?.message || "Unknown error",
      });
    } finally {
      setTrainLoading(false);
    }
  };

  return (
    <Page title="AI Product Recommendations">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Train AI Model</Text>
            <Text as="p" tone="subdued">
              Analyze order data in the database to create product recommendation rules.
              Logic: Customer buys [A, B] → Recommend C
            </Text>

            <Button
              variant="primary"
              loading={trainLoading}
              onClick={handleTrain}
            >
              {trainLoading ? "Training..." : "Train AI Model"}
            </Button>
            <Button onClick={() => setRulesOpen(true)}>Choose rules</Button>
          </BlockStack>
        </Card>

        <Modal
          open={rulesOpen}
          large
          className="rules-modal"
          onClose={() => setRulesOpen(false)}
          title="Recommendation rules"
          primaryAction={{ content: "Done", onAction: () => setRulesOpen(false) }}
        >
          <Modal.Section>
            <BlockStack gap="500">
              <Card background="bg-surface-secondary">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Add a custom rule</Text>
                  <TextField
                    label="Search product catalog"
                    value={productSearch}
                    onChange={setProductSearch}
                    helpText="Search filters the dropdowns below by product name or SKU."
                    placeholder="e.g. camera, jacket, or SKU"
                    autoComplete="off"
                  />
                  <Select label="Cart trigger: product A" helpText="The customer already has this product in the cart." options={productOptions} value={cartProductA} onChange={setCartProductA} />
                  <Select label="Cart trigger: product B (optional)" helpText="Use this for a rule that requires two products in the cart." options={[{ label: "No second product", value: "" }, ...productOptions]} value={cartProductB} onChange={setCartProductB} />
                  <Select label="Recommendation: product to suggest" helpText="This is the product shown to the customer when the cart trigger matches." options={productOptions} value={suggestProduct} onChange={setSuggestProduct} />
                  <InlineStack gap="300" blockAlign="end">
                    <TextField label="Priority" type="number" value={priority} onChange={setPriority} autoComplete="off" />
                    <TextField label="Discount %" type="number" min={0} max={100} value={discountPercent} onChange={setDiscountPercent} autoComplete="off" />
                    <ruleFetcher.Form method="post">
                      <input type="hidden" name="action" value="create" />
                      <input type="hidden" name="cartProductA" value={cartProductA} />
                      <input type="hidden" name="cartProductB" value={cartProductB} />
                      <input type="hidden" name="suggestProduct" value={suggestProduct} />
                      <input type="hidden" name="priority" value={priority} />
                      <input type="hidden" name="discountPercent" value={discountPercent} />
                      <Button submit variant="primary">Add rule</Button>
                    </ruleFetcher.Form>
                  </InlineStack>
                </BlockStack>
              </Card>

              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingMd">Rules in this shop</Text>
                  <Badge tone="info">{rules.length} loaded</Badge>
                </InlineStack>
                {rules.length === 0 ? (
                  <Text tone="subdued">No rules have been trained for this shop yet.</Text>
                ) : (
                  rules.map((rule) => (
                    <Card key={rule.id}>
                      <InlineStack align="space-between" blockAlign="center" gap="400" wrap>
                        <BlockStack gap="100">
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {formatRuleProducts(rule.cartProducts)}
                          </Text>
                          <Text as="span" tone="subdued">
                            → {productMap[rule.suggestProduct] || rule.suggestProduct} ({rule.suggestProduct})
                          </Text>
                          <InlineStack gap="200">
                            <Badge tone={rule.status === "active" ? "success" : "critical"}>
                              {rule.status}
                            </Badge>
                            <Text as="span" tone="subdued">{(rule.confidence * 100).toFixed(1)}% purchase confidence</Text>
                            <Text as="span" tone="subdued">support {rule.support}</Text>
                            {rule.discountPercent ? <Badge tone="warning">-{rule.discountPercent}%</Badge> : null}
                          </InlineStack>
                          <ruleFetcher.Form method="post">
                            <InlineStack gap="200" blockAlign="end">
                              <input type="hidden" name="action" value="updateDiscount" />
                              <input type="hidden" name="id" value={rule.id} />
                              <TextField
                                label="Discount %"
                                name="discountPercent"
                                type="number"
                                min={0}
                                max={100}
                                defaultValue={rule.discountPercent ?? ""}
                                autoComplete="off"
                              />
                              <Button submit>Save discount</Button>
                            </InlineStack>
                          </ruleFetcher.Form>
                        </BlockStack>
                        <InlineStack gap="200">
                          <ruleFetcher.Form method="post">
                            <input type="hidden" name="action" value="toggle" />
                            <input type="hidden" name="id" value={rule.id} />
                            <input type="hidden" name="status" value={rule.status === "active" ? "disabled" : "active"} />
                            <Button submit tone={rule.status === "active" ? "critical" : undefined}>
                              {rule.status === "active" ? "Disable" : "Enable"}
                            </Button>
                          </ruleFetcher.Form>
                          <ruleFetcher.Form method="post">
                            <input type="hidden" name="action" value="delete" />
                            <input type="hidden" name="id" value={rule.id} />
                            <Button submit tone="critical">Delete</Button>
                          </ruleFetcher.Form>
                        </InlineStack>
                      </InlineStack>
                    </Card>
                  ))
                )}
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {trainResult && (
          <div className="main-page-box">
            <Card>
              {trainResult.success ? (
                <Banner tone="success" title={trainResult.message || "Training successful!"}>
                  <BlockStack gap="200">
                    <Text>Orders processed: {trainResult.stats?.ordersProcessed?.toLocaleString()}</Text>
                    <Text>Total rules: {trainResult.stats?.totalRules?.toLocaleString()}</Text>
                    <Text>Cart 1 product → Recommend: {trainResult.stats?.cart1Rules?.toLocaleString()} rules</Text>
                    <Text>Cart 2 products → Recommend: {trainResult.stats?.cart2Rules?.toLocaleString()} rules</Text>
                    <Text>Rules from CSV: {trainResult.stats?.rulesFromCsv?.toLocaleString()}</Text>
                    <Text>Rules from Shopify orders: {trainResult.stats?.rulesFromShopify?.toLocaleString()}</Text>
                    <Text>Shopify orders fetched: {trainResult.stats?.shopifyOrdersFetched?.toLocaleString()}</Text>
                    <Text>Shopify orders saved: {trainResult.stats?.shopifyOrdersSaved?.toLocaleString()}</Text>
                    <Text>Shopify orders (single-item): {trainResult.stats?.shopifyOrdersSavedSingleItem?.toLocaleString()}</Text>
                    {/* <Text>Shopify orders skipped (no products): {trainResult.stats?.shopifyOrdersSkippedNoProducts?.toLocaleString()}</Text>
                    <Text>Shopify sync attempted: {String(trainResult.stats?.shopifySyncAttempted)}</Text>
                    <Text>Auth state: {trainResult.stats?.authState}</Text> */}
                    {trainResult.stats?.shopifySyncError && (
                      <Text>Shopify sync error: {trainResult.stats.shopifySyncError}</Text>
                    )}
                    {trainResult.stats?.authError && (
                      <Text>Auth error: {trainResult.stats.authError}</Text>
                    )}
                  </BlockStack>
                </Banner>
              ) : (
                <Banner tone="critical" title="Training Error">
                  <Text>{trainResult.error}</Text>
                </Banner>
              )}
            </Card></div>
        )}
      </BlockStack>
    </Page>
  );
}