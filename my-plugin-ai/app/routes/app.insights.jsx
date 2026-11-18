/* eslint-disable react/prop-types -- small local display components */
// Insights page (Phase 5): how shoppers use the recommendation widget, the A/B test
// (AI suggestions vs best sellers) with a two-proportion z-test, and the replay simulation
// that produces A/B data from held-out orders while the demo shop has no real traffic.

import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Button,
  Select,
  Banner,
  Badge,
  Checkbox,
  DataTable,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatDateTime, formatNumber } from "../format";
import { getInsights } from "../insights.server";
import { getShopCatalog } from "../catalog.server";
import { clearExperimentCache } from "../events.server";
import { clearSimulatedEvents, runReplay, SHOPPER_MODEL } from "../replay.server";
import { useT } from "../i18n";

const VI = {
  // Revenue added by the app
  "Revenue added by the app": "Doanh thu tăng thêm nhờ app",
  "Extra revenue from AI suggestions compared with showing best sellers": "Doanh thu tăng thêm khi gợi ý bằng AI so với chỉ hiện sản phẩm bán chạy",
  "Each AI visitor brought {diff} more than a visitor who saw best sellers (95% interval [{low}, {high}], p = {p}).":
    "Mỗi khách nhóm AI mang lại nhiều hơn {diff} so với khách thấy sản phẩm bán chạy (khoảng tin cậy 95% [{low}, {high}], p = {p}).",
  "Over {count} AI visitors, that is about {extra} (95% interval [{low}, {high}]).":
    "Với {count} khách nhóm AI, tổng cộng khoảng {extra} (khoảng tin cậy 95% [{low}, {high}]).",
  "Revenue added per visitor compared with no widget: AI {ai}, best sellers {control}.":
    "Doanh thu tăng thêm mỗi khách so với khi không có widget: AI {ai}, sản phẩm bán chạy {control}.",
  "Replay: each visit is compared with the expected order of the same shopper without the widget.":
    "Replay: mỗi lượt ghé được so với đơn hàng kỳ vọng của chính khách đó khi không có widget.",
  "Live data: all order value of visitors who saw the widget. Order sizes vary a lot, so many visitors are needed.":
    "Dữ liệu thật: tính toàn bộ giá trị đơn của khách đã thấy widget. Giá trị đơn chênh lệch nhiều nên cần nhiều khách.",
  "About {count} visitors per group are needed to confirm this revenue difference.":
    "Cần khoảng {count} khách mỗi nhóm để khẳng định chênh lệch doanh thu này.",
  "Turn on the A/B test (or run a replay) to measure the revenue the app adds: it needs visitors in both groups.":
    "Bật A/B test (hoặc chạy replay) để đo doanh thu app mang lại: cần có khách ở cả hai nhóm.",
  "“Revenue from suggestions” counts every product sold through the widget, like an affiliate link. “Revenue added by the app” counts only what the AI brought on top of best sellers.":
    "“Doanh thu từ gợi ý” tính mọi sản phẩm bán qua widget, giống link affiliate. “Doanh thu tăng thêm nhờ app” chỉ tính phần AI mang lại thêm so với sản phẩm bán chạy.",
  "Significant (95%)": "Có ý nghĩa thống kê (95%)",
  "{added} added with the widget · {clicked} clicked, then bought within 24 h":
    "{added} thêm bằng widget · {clicked} bấm rồi mua trong 24 giờ",
  "How shoppers use the suggestions, and whether AI suggestions beat best sellers":
    "Khách dùng gợi ý thế nào, và gợi ý AI có tốt hơn sản phẩm bán chạy không",
  "Last 7 days": "7 ngày qua",
  "Last 30 days": "30 ngày qua",
  "Last 90 days": "90 ngày qua",
  "All time": "Toàn bộ thời gian",
  "Live shoppers": "Khách thật",
  "Simulated replay": "Mô phỏng replay",
  "{value}% of visitors see best sellers": "{value}% khách xem sản phẩm bán chạy",
  "{count} visits": "{count} lượt ghé",
  "Bought together (trained rules)": "Hay mua cùng (luật đã train)",
  "Same category": "Cùng danh mục",
  "Recent orders": "Đơn hàng gần đây",
  "Best seller": "Bán chạy",
  "New arrival": "Hàng mới",
  "AI suggestions": "Gợi ý AI",
  "Best sellers (control)": "Sản phẩm bán chạy (đối chứng)",
  "A/B test is running.": "A/B test đang chạy.",
  "A/B test stopped. Every visitor sees AI suggestions.": "Đã dừng A/B test. Mọi khách đều thấy gợi ý AI.",
  "Replayed {count} visits in {seconds} s.": "Đã replay {count} lượt ghé trong {seconds} giây.",
  "Deleted {count} simulated events.": "Đã xóa {count} sự kiện mô phỏng.",
  "Unknown action": "Thao tác không hợp lệ",
  "{title}: needs visitors in both groups.": "{title}: cần có khách ở cả hai nhóm.",
  "AI is better (95% confidence)": "AI tốt hơn (độ tin cậy 95%)",
  "AI is worse (95% confidence)": "AI kém hơn (độ tin cậy 95%)",
  "Not significant yet": "Chưa có ý nghĩa thống kê",
  "{metric}: AI {ai} vs control {control}": "{metric}: AI {ai} so với nhóm đối chứng {control}",
  " (lift {lift})": " (mức tăng {lift})",
  "Difference {diff}, 95% interval [{low}, {high}], z = {z}, p = {p}.":
    "Chênh lệch {diff}, khoảng tin cậy 95% [{low}, {high}], z = {z}, p = {p}.",
  "About {count} visitors per group are needed to confirm a difference this size.":
    "Cần khoảng {count} khách mỗi nhóm để khẳng định mức chênh lệch này.",
  Period: "Khoảng thời gian",
  "{count} events": "{count} sự kiện",
  "Simulated data: real held-out orders replayed through the live recommendation code with a simple shopper model. Use it to check the method and compare groups, not as real shopper behaviour.":
    "Dữ liệu mô phỏng: đơn hàng giữ lại (mô hình chưa thấy) được replay qua code gợi ý thật với một mô hình khách đơn giản. Dùng để kiểm tra phương pháp và so sánh các nhóm, không phải hành vi thật của khách.",
  "No shopper events yet. They appear when visitors see, click or add suggestions in the store (after the new widget is deployed). Switch Data to “Simulated replay” to see a replayed A/B test.":
    "Chưa có sự kiện nào từ khách. Sự kiện sẽ xuất hiện khi khách xem, bấm hoặc thêm gợi ý trong cửa hàng (sau khi deploy widget mới). Chuyển Dữ liệu sang “Mô phỏng replay” để xem A/B test được replay.",
  "Visitors who saw suggestions": "Khách đã thấy gợi ý",
  "{count} widget views": "{count} lượt xem widget",
  "Click-through rate": "Tỷ lệ bấm (CTR)",
  "{clicks} clicks on {shown} shown products": "{clicks} lượt bấm trên {shown} sản phẩm hiển thị",
  "Visitors who added a suggestion": "Khách đã thêm gợi ý vào giỏ",
  "{count} products added to cart": "{count} sản phẩm được thêm vào giỏ",
  "Revenue from suggestions": "Doanh thu từ gợi ý",
  "{count} orders from widget visitors": "{count} đơn hàng từ khách đã thấy widget",
  "A/B test: AI suggestions vs best sellers": "A/B test: gợi ý AI so với sản phẩm bán chạy",
  Replay: "Replay",
  Running: "Đang chạy",
  Off: "Tắt",
  "Counting from {date}.": "Tính từ {date}.",
  Group: "Nhóm",
  Visitors: "Khách",
  Clicked: "Đã bấm",
  "Added to cart": "Đã thêm vào giỏ",
  Orders: "Đơn hàng",
  "Per visitor": "Mỗi khách",
  "No data for this period.": "Không có dữ liệu trong khoảng thời gian này.",
  "Add to cart": "Thêm vào giỏ",
  Click: "Bấm",
  "Visitors who clicked a suggestion": "Khách đã bấm vào gợi ý",
  "Two-proportion z-test per visitor, two-sided, 5% significance. A visitor stays in the same group on every visit (hash of an anonymous browser id).":
    "Kiểm định z hai tỷ lệ theo từng khách, hai phía, mức ý nghĩa 5%. Mỗi khách luôn ở cùng một nhóm qua mọi lượt ghé (hash từ id trình duyệt ẩn danh).",
  "By suggestion type": "Theo loại gợi ý",
  Type: "Loại",
  Shown: "Hiển thị",
  Clicks: "Lượt bấm",
  Added: "Đã thêm",
  "Most added suggestions": "Gợi ý được thêm vào giỏ nhiều nhất",
  Product: "Sản phẩm",
  "Choose the “Interaction” priority on the Data page to rank suggestions by live clicks and adds.":
    "Chọn ưu tiên “Tương tác” ở trang Dữ liệu để xếp hạng gợi ý theo lượt bấm và thêm vào giỏ thực tế.",
  "Live A/B test": "A/B test thật",
  "Some visitors see best sellers instead of AI suggestions. Their add-to-cart rate and revenue show how much the AI adds.":
    "Một phần khách sẽ thấy sản phẩm bán chạy thay vì gợi ý AI. Tỷ lệ thêm vào giỏ và doanh thu của họ cho thấy AI mang lại thêm bao nhiêu.",
  "Run the A/B test": "Chạy A/B test",
  "Control group": "Nhóm đối chứng",
  "Replay simulation": "Mô phỏng replay",
  "Replays held-out orders as visits: half of each order is the cart, the rest are the products the shopper really bought. Visits are split 50/50 between the groups. A shopper model clicks real purchases with {relevant} chance and other products with {other} (less for lower positions).":
    "Replay các đơn hàng giữ lại (mô hình chưa thấy) thành lượt ghé: một nửa mỗi đơn là giỏ hàng, phần còn lại là sản phẩm khách thật sự đã mua. Lượt ghé được chia 50/50 cho hai nhóm. Mô hình khách bấm vào sản phẩm thật sự mua với xác suất {relevant} và sản phẩm khác với {other} (thấp hơn ở vị trí phía dưới).",
  Visits: "Lượt ghé",
  "A/A check: both groups get AI suggestions (should not be significant)":
    "Kiểm tra A/A: cả hai nhóm đều nhận gợi ý AI (không nên có ý nghĩa thống kê)",
  "Run replay": "Chạy replay",
  "Delete simulated data": "Xóa dữ liệu mô phỏng",
  "Last run {date}: {count} visits from {orders} orders ({from} to {to})":
    "Lần chạy cuối {date}: {count} lượt ghé từ {orders} đơn hàng ({from} đến {to})",
  ", A/A check": ", kiểm tra A/A",
  "These orders were also used for training, so the result is optimistic. For a fair test, set the training window to end before the replay period (Data page, custom dates), train, then replay.":
    "Các đơn hàng này cũng đã được dùng để train, nên kết quả sẽ lạc quan hơn thực tế. Để kiểm tra công bằng, đặt khoảng train kết thúc trước giai đoạn replay (trang Dữ liệu, chọn ngày tùy chỉnh), train, rồi replay.",
  "Fair test: the model was trained only on orders up to {date}.":
    "Kiểm tra công bằng: mô hình chỉ được train trên đơn hàng đến {date}.",
};

const PERIOD_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];
const DATA_OPTIONS = [
  { value: "live", label: "Live shoppers" },
  { value: "sim", label: "Simulated replay" },
];
const SHARE_VALUES = ["10", "20", "30", "50"];
const SESSION_VALUES = ["1000", "2000", "5000"];
const REASON_LABELS = {
  rule: "Bought together (trained rules)",
  same_category: "Same category",
  recent_orders: "Recent orders",
  best_seller: "Best seller",
  new_arrival: "New arrival",
};
const VARIANT_LABELS = { ai: "AI suggestions", control: "Best sellers (control)" };

const pct = (value, digits = 1) => (value == null ? "–" : `${(value * 100).toFixed(digits)}%`);
const money = (value) => `$${Number(value ?? 0).toFixed(2)}`;
const pValueText = (value) => (value < 0.0001 ? "< 0.0001" : value.toFixed(4));

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const liveCount = await prisma.recommendationEvent.count({ where: { shop, simulated: false } });

  const data = url.searchParams.get("data") ?? (liveCount > 0 ? "live" : "sim");
  const period = url.searchParams.get("days") ?? (data === "sim" ? "all" : "30");
  const simulated = data === "sim";
  const experiment = {
    enabled: Boolean(settings?.abEnabled),
    controlShare: settings?.abControlShare ?? 50,
    startedAt: settings?.abStartedAt?.toISOString() ?? null,
  };
  const insights = await getInsights({
    shop,
    simulated,
    days: period === "all" ? null : Number(period),
    // Live A/B numbers only count from the start of the current experiment.
    since: !simulated && experiment.enabled ? experiment.startedAt : null,
  });

  let titles = {};
  try {
    const catalog = await getShopCatalog(shop, admin);
    titles = Object.fromEntries(insights.topProducts.map((row) => [row.productKey, catalog.products.get(row.productKey)?.title]));
  } catch {
    // Titles are optional: product keys are shown instead.
  }

  let replay = null;
  try {
    replay = settings?.lastReplaySummary ? JSON.parse(settings.lastReplaySummary) : null;
  } catch {
    replay = null;
  }

  return { data, period, liveCount, experiment, insights, titles, replay, rankBy: settings?.rankBy ?? "balanced", shopperModel: SHOPPER_MODEL };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "experiment") {
    const enabled = form.get("enabled") === "true";
    const controlShare = Math.min(50, Math.max(10, Number(form.get("controlShare")) || 50));
    const current = await prisma.shopSettings.findUnique({ where: { shop } });
    // A new start time (and so a new visitor split) only when the test is switched on.
    const abStartedAt = enabled ? (current?.abEnabled ? current.abStartedAt : new Date()) : current?.abStartedAt ?? null;
    await prisma.shopSettings.upsert({
      where: { shop },
      update: { abEnabled: enabled, abControlShare: controlShare, abStartedAt },
      create: { shop, abEnabled: enabled, abControlShare: controlShare, abStartedAt },
    });
    clearExperimentCache(shop);
    return { ok: true, message: enabled ? "A/B test is running." : "A/B test stopped. Every visitor sees AI suggestions." };
  }

  if (intent === "replay") {
    try {
      const summary = await runReplay({
        shop,
        admin,
        sessions: Math.min(5000, Math.max(100, Number(form.get("sessions")) || 2000)),
        controlShare: 50,
        aaTest: form.get("aaTest") === "true",
      });
      return {
        ok: true,
        message: "Replayed {count} visits in {seconds} s.",
        vars: { count: formatNumber(summary.sessions), seconds: summary.seconds },
      };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  if (intent === "clear") {
    const { count } = await clearSimulatedEvents(shop);
    await prisma.shopSettings.update({ where: { shop }, data: { lastReplaySummary: null } }).catch(() => {});
    return { ok: true, message: "Deleted {count} simulated events.", vars: { count: formatNumber(count) } };
  }

  return { ok: false, message: "Unknown action" };
};

function Kpi({ label, value, help }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="h3" variant="bodySm" tone="subdued">{label}</Text>
        <Text as="p" variant="headingLg">{value}</Text>
        {help ? <Text as="p" variant="bodySm" tone="subdued">{help}</Text> : null}
      </BlockStack>
    </Card>
  );
}

const signedMoney = (value) => `${value < 0 ? "-" : "+"}${Math.abs(Number(value ?? 0)).toFixed(2)}`;

function RevenueUplift({ uplift }) {
  const t = useT(VI);
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="050">
            <Text as="h2" variant="headingMd">{t("Revenue added by the app")}</Text>
            <Text as="p" variant="bodySm" tone="subdued">{t("Extra revenue from AI suggestions compared with showing best sellers")}</Text>
          </BlockStack>
          {uplift ? (uplift.significant
            ? <Badge tone={uplift.diff > 0 ? "success" : "critical"}>{t("Significant (95%)")}</Badge>
            : <Badge>{t("Not significant yet")}</Badge>) : null}
        </InlineStack>
        {uplift ? (
          <>
            <Text as="p" variant="heading2xl">{signedMoney(uplift.extraRevenue)}</Text>
            <Text as="p">
              {t("Each AI visitor brought {diff} more than a visitor who saw best sellers (95% interval [{low}, {high}], p = {p}).", {
                diff: signedMoney(uplift.diff),
                low: signedMoney(uplift.ci95[0]),
                high: signedMoney(uplift.ci95[1]),
                p: pValueText(uplift.pValue),
              })}{" "}
              {t("Over {count} AI visitors, that is about {extra} (95% interval [{low}, {high}]).", {
                count: formatNumber(uplift.aiVisitors),
                extra: signedMoney(uplift.extraRevenue),
                low: signedMoney(uplift.extraRevenueCi[0]),
                high: signedMoney(uplift.extraRevenueCi[1]),
              })}
            </Text>
            {uplift.vsBaseline ? (
              <>
                <Text as="p">
                  {t("Revenue added per visitor compared with no widget: AI {ai}, best sellers {control}.", {
                    ai: signedMoney(uplift.meanB),
                    control: signedMoney(uplift.meanA),
                  })}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("Replay: each visit is compared with the expected order of the same shopper without the widget.")}
                </Text>
              </>
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">
                {t("Live data: all order value of visitors who saw the widget. Order sizes vary a lot, so many visitors are needed.")}
              </Text>
            )}
            {!uplift.significant && uplift.neededPerGroup ? (
              <Text as="p" tone="subdued">
                {t("About {count} visitors per group are needed to confirm this revenue difference.", {
                  count: formatNumber(uplift.neededPerGroup),
                })}
              </Text>
            ) : null}
          </>
        ) : (
          <Text as="p" tone="subdued">
            {t("Turn on the A/B test (or run a replay) to measure the revenue the app adds: it needs visitors in both groups.")}
          </Text>
        )}
        <Text as="p" variant="bodySm" tone="subdued">
          {t("“Revenue from suggestions” counts every product sold through the widget, like an affiliate link. “Revenue added by the app” counts only what the AI brought on top of best sellers.")}
        </Text>
      </BlockStack>
    </Card>
  );
}

function TestResult({ title, test, metric }) {
  const t = useT(VI);
  if (!test) {
    return <Text as="p" tone="subdued">{t("{title}: needs visitors in both groups.", { title })}</Text>;
  }
  const better = test.diff > 0;
  return (
    <BlockStack gap="100">
      <InlineStack gap="200" blockAlign="center">
        <Text as="h3" variant="headingSm">{title}</Text>
        {test.significant
          ? <Badge tone={better ? "success" : "critical"}>
              {better ? t("AI is better (95% confidence)") : t("AI is worse (95% confidence)")}
            </Badge>
          : <Badge>{t("Not significant yet")}</Badge>}
      </InlineStack>
      <Text as="p">
        {t("{metric}: AI {ai} vs control {control}", { metric, ai: pct(test.pB), control: pct(test.pA) })}
        {test.lift != null ? t(" (lift {lift})", { lift: `${test.lift >= 0 ? "+" : ""}${pct(test.lift)}` }) : ""}.{" "}
        {t("Difference {diff}, 95% interval [{low}, {high}], z = {z}, p = {p}.", {
          diff: pct(test.diff),
          low: pct(test.ci95[0]),
          high: pct(test.ci95[1]),
          z: test.z.toFixed(2),
          p: pValueText(test.pValue),
        })}
      </Text>
      {!test.significant && test.neededPerGroup ? (
        <Text as="p" tone="subdued">
          {t("About {count} visitors per group are needed to confirm a difference this size.", {
            count: formatNumber(test.neededPerGroup),
          })}
        </Text>
      ) : null}
    </BlockStack>
  );
}

export default function Insights() {
  const { data, period, liveCount, experiment, insights, titles, replay, rankBy, shopperModel } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const t = useT(VI);
  const busy = fetcher.state !== "idle";
  const busyIntent = busy ? fetcher.formData?.get("intent") : null;

  const [enabled, setEnabled] = useState(experiment.enabled);
  const [share, setShare] = useState(String(experiment.controlShare));
  const [sessions, setSessions] = useState("2000");
  const [aaTest, setAaTest] = useState(false);
  useEffect(() => {
    setEnabled(experiment.enabled);
    setShare(String(experiment.controlShare));
  }, [experiment.enabled, experiment.controlShare]);

  const setParam = (name, value) => {
    const next = new URLSearchParams(searchParams);
    next.set(name, value);
    setSearchParams(next);
  };
  const submit = (fields) => fetcher.submit(fields, { method: "post" });

  const { totals, groups, tests } = insights;
  const shownGroups = groups.filter((group) => group.visitors > 0 || group.orders > 0);
  const simulated = data === "sim";

  const periodOptions = PERIOD_OPTIONS.map((option) => ({ ...option, label: t(option.label) }));
  const dataOptions = DATA_OPTIONS.map((option) => ({ ...option, label: t(option.label) }));
  const shareOptions = SHARE_VALUES.map((value) => ({ value, label: t("{value}% of visitors see best sellers", { value }) }));
  const sessionOptions = SESSION_VALUES.map((value) => ({ value, label: t("{count} visits", { count: formatNumber(value) }) }));

  return (
    <Page title={t("Insights")} subtitle={t("How shoppers use the suggestions, and whether AI suggestions beat best sellers")}>
      <Layout>
        <Layout.Section>
          <InlineStack gap="300" blockAlign="end">
            <Box minWidth="200px">
              <Select label={t("Data")} options={dataOptions} value={data} onChange={(value) => setParam("data", value)} />
            </Box>
            <Box minWidth="200px">
              <Select label={t("Period")} options={periodOptions} value={period} onChange={(value) => setParam("days", value)} />
            </Box>
            <Text as="span" tone="subdued">{t("{count} events", { count: formatNumber(insights.events) })}</Text>
          </InlineStack>
        </Layout.Section>

        {fetcher.data?.message ? (
          <Layout.Section>
            <Banner tone={fetcher.data.ok ? "success" : "critical"}>{t(fetcher.data.message, fetcher.data.vars)}</Banner>
          </Layout.Section>
        ) : null}

        {simulated ? (
          <Layout.Section>
            <Banner tone="info">
              {t(
                "Simulated data: real held-out orders replayed through the live recommendation code with a simple shopper model. Use it to check the method and compare groups, not as real shopper behaviour.",
              )}
            </Banner>
          </Layout.Section>
        ) : liveCount === 0 ? (
          <Layout.Section>
            <Banner tone="info">
              {t(
                "No shopper events yet. They appear when visitors see, click or add suggestions in the store (after the new widget is deployed). Switch Data to “Simulated replay” to see a replayed A/B test.",
              )}
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
            <Kpi
              label={t("Visitors who saw suggestions")}
              value={formatNumber(totals.visitors)}
              help={t("{count} widget views", { count: formatNumber(totals.impressions) })}
            />
            <Kpi
              label={t("Click-through rate")}
              value={pct(totals.itemCtr)}
              help={t("{clicks} clicks on {shown} shown products", {
                clicks: formatNumber(totals.clicks),
                shown: formatNumber(totals.shownItems),
              })}
            />
            <Kpi
              label={t("Visitors who added a suggestion")}
              value={pct(totals.addRate)}
              help={t("{count} products added to cart", { count: formatNumber(totals.adds) })}
            />
            <Kpi
              label={t("Revenue from suggestions")}
              value={money(totals.recRevenue)}
              help={t("{added} added with the widget · {clicked} clicked, then bought within 24 h", {
                added: money(totals.addedRevenue),
                clicked: money(totals.clickedRevenue),
              })}
            />
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">{t("A/B test: AI suggestions vs best sellers")}</Text>
                {simulated ? <Badge tone="info">{t("Replay")}</Badge>
                  : experiment.enabled ? <Badge tone="success">{t("Running")}</Badge> : <Badge>{t("Off")}</Badge>}
              </InlineStack>
              {!simulated && experiment.enabled ? (
                <Text as="p" tone="subdued">{t("Counting from {date}.", { date: formatDateTime(experiment.startedAt) })}</Text>
              ) : null}
              {shownGroups.length ? (
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric", "numeric", "numeric"]}
                  headings={[
                    t("Group"),
                    t("Visitors"),
                    t("Clicked"),
                    t("Added to cart"),
                    t("Orders"),
                    t("Revenue from suggestions"),
                    t("Per visitor"),
                  ]}
                  rows={shownGroups.map((group) => [
                    VARIANT_LABELS[group.variant] ? t(VARIANT_LABELS[group.variant]) : group.variant,
                    formatNumber(group.visitors),
                    pct(group.clickRate),
                    pct(group.addRate),
                    formatNumber(group.orders),
                    money(group.recRevenue),
                    money(group.recRevenuePerVisitor),
                  ])}
                />
              ) : (
                <Text as="p" tone="subdued">{t("No data for this period.")}</Text>
              )}
              <TestResult title={t("Add to cart")} metric={t("Visitors who added a suggestion")} test={tests.addToCart} />
              <TestResult title={t("Click")} metric={t("Visitors who clicked a suggestion")} test={tests.click} />
              <Text as="p" variant="bodySm" tone="subdued">
                {t(
                  "Two-proportion z-test per visitor, two-sided, 5% significance. A visitor stays in the same group on every visit (hash of an anonymous browser id).",
                )}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <RevenueUplift uplift={insights.revenueUplift} />
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{t("By suggestion type")}</Text>
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
                headings={[t("Type"), t("Shown"), t("Clicks"), "CTR", t("Added")]}
                rows={insights.reasons.map((row) => [
                  REASON_LABELS[row.reason] ? t(REASON_LABELS[row.reason]) : row.reason,
                  formatNumber(row.shown),
                  formatNumber(row.clicks),
                  pct(row.ctr),
                  formatNumber(row.adds),
                ])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{t("Most added suggestions")}</Text>
              <DataTable
                columnContentTypes={["text", "numeric", "numeric"]}
                headings={[t("Product"), t("Clicks"), t("Added")]}
                rows={insights.topProducts.map((row) => [
                  titles[row.productKey] ?? row.productKey,
                  formatNumber(row.clicks),
                  formatNumber(row.adds),
                ])}
              />
              {rankBy === "interaction" ? null : (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("Choose the “Interaction” priority on the Data page to rank suggestions by live clicks and adds.")}
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{t("Live A/B test")}</Text>
              <Text as="p">
                {t(
                  "Some visitors see best sellers instead of AI suggestions. Their add-to-cart rate and revenue show how much the AI adds.",
                )}
              </Text>
              <Checkbox label={t("Run the A/B test")} checked={enabled} onChange={setEnabled} />
              <Select label={t("Control group")} options={shareOptions} value={share} onChange={setShare} disabled={!enabled} />
              <InlineStack>
                <Button
                  variant="primary"
                  loading={busyIntent === "experiment"}
                  onClick={() => submit({ intent: "experiment", enabled: String(enabled), controlShare: share })}
                >
                  {t("Save")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{t("Replay simulation")}</Text>
              <Text as="p">
                {t(
                  "Replays held-out orders as visits: half of each order is the cart, the rest are the products the shopper really bought. Visits are split 50/50 between the groups. A shopper model clicks real purchases with {relevant} chance and other products with {other} (less for lower positions).",
                  { relevant: pct(shopperModel.clickRelevant, 0), other: pct(shopperModel.clickOther, 0) },
                )}
              </Text>
              <Select label={t("Visits")} options={sessionOptions} value={sessions} onChange={setSessions} />
              <Checkbox
                label={t("A/A check: both groups get AI suggestions (should not be significant)")}
                checked={aaTest}
                onChange={setAaTest}
              />
              <InlineStack gap="200">
                <Button
                  variant="primary"
                  loading={busyIntent === "replay"}
                  disabled={busy}
                  onClick={() => submit({ intent: "replay", sessions, aaTest: String(aaTest) })}
                >
                  {t("Run replay")}
                </Button>
                <Button tone="critical" variant="plain" disabled={busy || !replay} onClick={() => submit({ intent: "clear" })}>
                  {t("Delete simulated data")}
                </Button>
              </InlineStack>
              {replay ? (
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("Last run {date}: {count} visits from {orders} orders ({from} to {to})", {
                      date: formatDateTime(replay.ranAt),
                      count: formatNumber(replay.sessions),
                      orders: formatNumber(replay.availableOrders),
                      from: replay.ordersFrom?.slice(0, 10),
                      to: replay.ordersTo?.slice(0, 10),
                    })}
                    {replay.aaTest ? t(", A/A check") : ""}.
                  </Text>
                  {replay.overlap ? (
                    <Banner tone="warning">
                      {t(
                        "These orders were also used for training, so the result is optimistic. For a fair test, set the training window to end before the replay period (Data page, custom dates), train, then replay.",
                      )}
                    </Banner>
                  ) : (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("Fair test: the model was trained only on orders up to {date}.", {
                        date: replay.trainingWindowEnd?.slice(0, 10),
                      })}
                    </Text>
                  )}
                </BlockStack>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
