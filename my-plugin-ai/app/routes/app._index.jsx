// Main page APP

import { useState } from "react";
import { Page, Button, Banner, Card, Text, BlockStack } from "@shopify/polaris";
import "../styles.css";

// Component
export default function TrainAIPage() {
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
          </BlockStack>
        </Card>

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