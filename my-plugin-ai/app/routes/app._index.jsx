// Home page: train the model and jump to the rules and data pages.

import { useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatNumber, formatDateTime } from "../format";
import {
  Page,
  Button,
  Banner,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import "../styles.css";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [activeRules, merchantRules, orders, settings] = await Promise.all([
    prisma.recommendationRule.count({ where: { shop, status: "active" } }),
    prisma.recommendationRule.count({ where: { shop, source: "merchant" } }),
    prisma.orderHistory.count({ where: { shop } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);
  return {
    activeRules,
    merchantRules,
    orders,
    strategy: settings?.strategy ?? "apriori",
    lastTrainedAt: settings?.lastTrainedAt ?? null,
  };
};

export default function TrainAIPage() {
  const { activeRules, merchantRules, orders, strategy, lastTrainedAt } = useLoaderData();
  const navigate = useNavigate();
  const [trainResult, setTrainResult] = useState(null);
  const [trainLoading, setTrainLoading] = useState(false);

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
              Learn which products are bought together from your order history, then recommend them
              in the cart, on product pages and on the home page.
            </Text>
            <InlineStack gap="200" wrap>
              <Badge>{`${formatNumber(orders)} orders`}</Badge>
              <Badge tone="success">{`${formatNumber(activeRules)} active rules`}</Badge>
              <Badge tone="info">{`${formatNumber(merchantRules)} of your own rules`}</Badge>
              <Badge>{`Algorithm: ${strategy}`}</Badge>
              {lastTrainedAt && <Badge>{`Last trained ${formatDateTime(lastTrainedAt)}`}</Badge>}
            </InlineStack>
            <InlineStack gap="200" wrap>
              <Button variant="primary" loading={trainLoading} onClick={handleTrain}>
                {trainLoading ? "Training..." : "Train AI Model"}
              </Button>
              <Button onClick={() => navigate("/app/rules")}>Manage rules</Button>
              <Button variant="plain" onClick={() => navigate("/app/data")}>Data and training settings</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {trainResult && (
          <div className="main-page-box">
            <Card>
              {trainResult.success ? (
                <Banner tone="success" title={trainResult.message || "Training successful!"}>
                  <BlockStack gap="200">
                    <Text>Orders processed: {formatNumber(trainResult.stats?.ordersProcessed)}</Text>
                    <Text>Total rules: {formatNumber(trainResult.stats?.totalRules)}</Text>
                    <Text>Cart 1 product → Recommend: {formatNumber(trainResult.stats?.cart1Rules)} rules</Text>
                    <Text>Cart 2 products → Recommend: {formatNumber(trainResult.stats?.cart2Rules)} rules</Text>
                    <Text>Rules from CSV: {formatNumber(trainResult.stats?.rulesFromCsv)}</Text>
                    <Text>Rules from Shopify orders: {formatNumber(trainResult.stats?.rulesFromShopify)}</Text>
                    <Text>Shopify orders fetched: {formatNumber(trainResult.stats?.shopifyOrdersFetched)}</Text>
                    <Text>Shopify orders saved: {formatNumber(trainResult.stats?.shopifyOrdersSaved)}</Text>
                    <Text>Shopify orders (single-item): {formatNumber(trainResult.stats?.shopifyOrdersSavedSingleItem)}</Text>
                    {/* <Text>Shopify orders skipped (no products): {formatNumber(trainResult.stats?.shopifyOrdersSkippedNoProducts)}</Text>
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
