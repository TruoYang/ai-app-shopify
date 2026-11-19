// Home page: train the model and jump to the rules and data pages.

import { useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useRouteLoaderData } from "react-router";
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
  Select,
  Box,
} from "@shopify/polaris";
import "../styles.css";
import { LANGUAGE_OPTIONS, useT } from "../i18n";

const VI = {
  "AI Product Recommendations": "Gợi ý sản phẩm bằng AI",
  "Train AI Model": "Train mô hình AI",
  "Training...": "Đang train...",
  "Learn which products are bought together from your order history, then recommend them in the cart, on product pages and on the home page.":
    "Học từ lịch sử đơn hàng các sản phẩm thường được mua cùng nhau, sau đó gợi ý chúng ở giỏ hàng, trang sản phẩm và trang chủ.",
  "{count} orders": "{count} đơn hàng",
  "{count} active rules": "{count} luật đang bật",
  "{count} of your own rules": "{count} luật đã tạo thủ công",
  "Algorithm: {name}": "Thuật toán: {name}",
  "Last trained {date}": "Học luật lần cuối {date}",
  "Manage rules": "Quản lý luật",
  "Data and training settings": "Dữ liệu và cài đặt train",
  "Training successful!": "Train thành công!",
  "Training finished": "Đã train xong",
  "Training Error": "Lỗi khi train",
  "Orders processed: {count}": "Số đơn đã xử lý: {count}",
  "Total rules: {count}": "Tổng số luật: {count}",
  "Cart 1 product → Recommend: {count} rules": "Giỏ 1 sản phẩm → gợi ý: {count} luật",
  "Cart 2 products → Recommend: {count} rules": "Giỏ 2 sản phẩm → gợi ý: {count} luật",
  "Rules from CSV: {count}": "Luật từ CSV: {count}",
  "Rules from Shopify orders: {count}": "Luật từ đơn Shopify: {count}",
  "Shopify orders fetched: {count}": "Đơn Shopify đã tải: {count}",
  "Shopify orders saved: {count}": "Đơn Shopify đã lưu: {count}",
  "Shopify orders (single-item): {count}": "Đơn Shopify chỉ có 1 sản phẩm: {count}",
  "Shopify sync error: {error}": "Lỗi đồng bộ Shopify: {error}",
  "Auth error: {error}": "Lỗi xác thực: {error}",
  "Missing shop param in URL": "Thiếu tham số shop trong URL",
  "Session expired. Please reload and log in again.": "Phiên đăng nhập đã hết hạn. Hãy tải lại trang và đăng nhập lại.",
  "Unexpected response (not JSON). Please reload and try again.": "Phản hồi không hợp lệ. Hãy tải lại trang và thử lại.",
  "Request failed ({status})": "Yêu cầu thất bại ({status})",
  "Unknown error": "Lỗi không xác định",
  "Admin language for this app": "Ngôn ngữ giao diện của app",
};

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
  const t = useT(VI);
  const layout = useRouteLoaderData("routes/app");
  const languageFetcher = useFetcher();
  const languageSetting = languageFetcher.formData?.get("language") ?? layout?.languageSetting ?? "auto";
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
          error: t("Missing shop param in URL"),
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
          error: t("Session expired. Please reload and log in again."),
        });
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setTrainResult({
          success: false,
          error: t("Unexpected response (not JSON). Please reload and try again."),
        });
        return;
      }

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setTrainResult({
          success: false,
          error: data?.error || t("Request failed ({status})", { status: response.status }),
        });
        return;
      }

      setTrainResult(data);
    } catch (error) {
      setTrainResult({
        success: false,
        error: error?.message || t("Unknown error"),
      });
    } finally {
      setTrainLoading(false);
    }
  };

  return (
    <Page title={t("AI Product Recommendations")}>
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">{t("Train AI Model")}</Text>
            <Text as="p" tone="subdued">
              {t("Learn which products are bought together from your order history, then recommend them in the cart, on product pages and on the home page.")}
            </Text>
            <InlineStack gap="200" wrap>
              <Badge>{t("{count} orders", { count: formatNumber(orders) })}</Badge>
              <Badge tone="success">{t("{count} active rules", { count: formatNumber(activeRules) })}</Badge>
              <Badge tone="info">{t("{count} of your own rules", { count: formatNumber(merchantRules) })}</Badge>
              <Badge>{t("Algorithm: {name}", { name: strategy })}</Badge>
              {lastTrainedAt && <Badge>{t("Last trained {date}", { date: formatDateTime(lastTrainedAt) })}</Badge>}
            </InlineStack>
            <InlineStack gap="200" wrap>
              <Button variant="primary" loading={trainLoading} onClick={handleTrain}>
                {trainLoading ? t("Training...") : t("Train AI Model")}
              </Button>
              <Button onClick={() => navigate("/app/rules")}>{t("Manage rules")}</Button>
              <Button variant="plain" onClick={() => navigate("/app/data")}>{t("Data and training settings")}</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {trainResult && (
          <div className="main-page-box">
            <Card>
              {trainResult.success ? (
                <Banner tone="success" title={t(trainResult.message || "Training successful!")}>
                  <BlockStack gap="200">
                    <Text>{t("Orders processed: {count}", { count: formatNumber(trainResult.stats?.ordersProcessed) })}</Text>
                    <Text>{t("Total rules: {count}", { count: formatNumber(trainResult.stats?.totalRules) })}</Text>
                    <Text>{t("Cart 1 product → Recommend: {count} rules", { count: formatNumber(trainResult.stats?.cart1Rules) })}</Text>
                    <Text>{t("Cart 2 products → Recommend: {count} rules", { count: formatNumber(trainResult.stats?.cart2Rules) })}</Text>
                    <Text>{t("Rules from CSV: {count}", { count: formatNumber(trainResult.stats?.rulesFromCsv) })}</Text>
                    <Text>{t("Rules from Shopify orders: {count}", { count: formatNumber(trainResult.stats?.rulesFromShopify) })}</Text>
                    <Text>{t("Shopify orders fetched: {count}", { count: formatNumber(trainResult.stats?.shopifyOrdersFetched) })}</Text>
                    <Text>{t("Shopify orders saved: {count}", { count: formatNumber(trainResult.stats?.shopifyOrdersSaved) })}</Text>
                    <Text>{t("Shopify orders (single-item): {count}", { count: formatNumber(trainResult.stats?.shopifyOrdersSavedSingleItem) })}</Text>
                    {/* <Text>Shopify orders skipped (no products): {formatNumber(trainResult.stats?.shopifyOrdersSkippedNoProducts)}</Text>
                    <Text>Shopify sync attempted: {String(trainResult.stats?.shopifySyncAttempted)}</Text>
                    <Text>Auth state: {trainResult.stats?.authState}</Text> */}
                    {trainResult.stats?.shopifySyncError && (
                      <Text>{t("Shopify sync error: {error}", { error: trainResult.stats.shopifySyncError })}</Text>
                    )}
                    {trainResult.stats?.authError && (
                      <Text>{t("Auth error: {error}", { error: trainResult.stats.authError })}</Text>
                    )}
                  </BlockStack>
                </Banner>
              ) : (
                <Banner tone="critical" title={t("Training Error")}>
                  <Text>{trainResult.error}</Text>
                </Banner>
              )}
            </Card></div>
        )}

        <Card>
          <InlineStack gap="300" blockAlign="end">
            <Box minWidth="260px">
              <Select
                label={`${t("Language")} / Language`}
                helpText={t("Admin language for this app")}
                options={LANGUAGE_OPTIONS}
                value={languageSetting}
                onChange={(language) => languageFetcher.submit({ language }, { method: "post", action: "/app/language" })}
              />
            </Box>
          </InlineStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
