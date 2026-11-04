// Data page: import historical orders from any CSV layout, then match CSV products
// to shop products (app.data.match.jsx). Kept apart from the daily Recommendations page.

import { useMemo, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Select,
  Banner,
  Badge,
  DropZone,
  Box,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatNumber, formatDateTime } from "../format";
import { importCsvOrders } from "../csv-import.server";
import { guessDateFormat, guessRoles, parseDate, previewCsv, REQUIRED_ROLES, ROLES } from "../csv-format";

const ROLE_LABELS = {
  ignore: "Ignore",
  orderId: "Order ID (required)",
  productCode: "Product code / SKU (required)",
  productName: "Product name",
  quantity: "Quantity",
  date: "Order date",
  price: "Price",
  customerId: "Customer",
};
const ROLE_OPTIONS = ["ignore", ...ROLES].map((value) => ({ value, label: ROLE_LABELS[value] }));
const DATE_FORMATS = [
  { value: "dmy", label: "Day/Month/Year (31/12/2024)" },
  { value: "mdy", label: "Month/Day/Year (12/31/2024)" },
  { value: "iso", label: "Year-Month-Day (2024-12-31)" },
];
const PREVIEW_BYTES = 256 * 1024;
const WINDOW_OPTIONS = [
  { value: "all", label: "All orders" },
  { value: "1", label: "Last month" },
  { value: "3", label: "Last 3 months" },
  { value: "6", label: "Last 6 months" },
  { value: "12", label: "Last 12 months" },
  { value: "24", label: "Last 2 years" },
  { value: "custom", label: "Custom dates" },
];
// HitRate@10 from the offline evaluation in docs/eval (UCI Online Retail, newest 20% of orders).
const STRATEGY_OPTIONS = [
  { value: "apriori", label: "Apriori: built-in baseline (HitRate@10 0.745)" },
  { value: "fpgrowth", label: "FP-Growth: most accurate (HitRate@10 0.782)" },
  { value: "hybrid", label: "Hybrid FP-Growth + kNN + DEC: always answers, widest coverage (0.774)" },
  { value: "itemknn", label: "Item-kNN: fast, wide coverage (0.726)" },
  { value: "dec", label: "DEC deep clustering: similar-style products (0.679)" },
];
const RANK_OPTIONS = [
  { value: "balanced", label: "Balanced: most likely to be bought together" },
  { value: "revenue", label: "Revenue: prefer higher priced products" },
  { value: "quantity", label: "Quantity: prefer best sellers" },
  { value: "interaction", label: "Interaction: prefer most clicked (best sellers until click data exists)" },
];
const SCHEDULE_OPTIONS = [
  { value: "none", label: "Only when I press Train" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];
const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [imports, csvProducts, matched, csvOrders, settings, dateRange] = await Promise.all([
    prisma.csvImport.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.csvProduct.count({ where: { shop } }),
    prisma.csvProduct.count({ where: { shop, shopProductKey: { not: null } } }),
    prisma.orderHistory.count({ where: { shop, source: "csv_import" } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.orderHistory.aggregate({ where: { shop }, _min: { orderDate: true }, _max: { orderDate: true } }),
  ]);
  return {
    imports,
    csvProducts,
    matched,
    csvOrders,
    settings: {
      window: settings?.trainLastMonths ? String(settings.trainLastMonths) : settings?.trainFrom || settings?.trainTo ? "custom" : "all",
      from: toDateInput(settings?.trainFrom),
      to: toDateInput(settings?.trainTo),
      strategy: settings?.strategy ?? "apriori",
      rankBy: settings?.rankBy ?? "balanced",
      retrainSchedule: settings?.retrainSchedule ?? "none",
      lastTrainedAt: settings?.lastTrainedAt ?? null,
      lastTrainSummary: settings?.lastTrainSummary ? JSON.parse(settings.lastTrainSummary) : null,
    },
    orderDates: { min: toDateInput(dateRange._min.orderDate), max: toDateInput(dateRange._max.orderDate) },
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("intent") === "settings") {
    const window = String(formData.get("window") ?? "all");
    const parseDay = (name, endOfDay) => {
      const value = String(formData.get(name) ?? "");
      return value ? new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`) : null;
    };
    const pick = (name, options, fallback) => {
      const value = String(formData.get(name) ?? "");
      return options.some((option) => option.value === value) ? value : fallback;
    };
    const data = {
      ...(window === "custom"
        ? { trainLastMonths: null, trainFrom: parseDay("from"), trainTo: parseDay("to", true) }
        : { trainLastMonths: window === "all" ? null : Number(window), trainFrom: null, trainTo: null }),
      strategy: pick("strategy", STRATEGY_OPTIONS, "apriori"),
      rankBy: pick("rankBy", RANK_OPTIONS, "balanced"),
      retrainSchedule: pick("retrainSchedule", SCHEDULE_OPTIONS, "none"),
    };
    await prisma.shopSettings.upsert({ where: { shop: session.shop }, update: data, create: { shop: session.shop, ...data } });
    return Response.json({ success: true, intent: "settings" });
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return Response.json({ success: false, error: "Choose a CSV file first." }, { status: 400 });
  }

  const columnMap = JSON.parse(String(formData.get("columnMap") ?? "{}"));
  const missing = REQUIRED_ROLES.filter((role) => !columnMap[role]);
  if (missing.length) {
    return Response.json(
      { success: false, error: `Choose a column for: ${missing.map((role) => ROLE_LABELS[role]).join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const result = await importCsvOrders({
      shop: session.shop,
      file,
      fileName: file.name,
      delimiter: String(formData.get("delimiter") || ","),
      columnMap,
      dateFormat: String(formData.get("dateFormat") || "dmy"),
      mode: formData.get("mode") === "append" ? "append" : "replace",
    });
    return Response.json({ success: true, result });
  } catch (error) {
    console.error("CSV import failed:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
};

export default function DataPage() {
  const { imports, csvProducts, matched, csvOrders, settings, orderDates } = useLoaderData();
  const fetcher = useFetcher();
  const settingsFetcher = useFetcher();
  const [trainWindow, setTrainWindow] = useState(settings.window);
  const [trainFrom, setTrainFrom] = useState(settings.from);
  const [trainTo, setTrainTo] = useState(settings.to);
  const [strategy, setStrategy] = useState(settings.strategy);
  const [rankBy, setRankBy] = useState(settings.rankBy);
  const [retrainSchedule, setRetrainSchedule] = useState(settings.retrainSchedule);
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [roles, setRoles] = useState({});
  const [dateFormat, setDateFormat] = useState("dmy");
  const [mode, setMode] = useState("replace");
  const [readError, setReadError] = useState(null);

  const importing = fetcher.state !== "idle";
  const result = fetcher.data;

  const handleDrop = async (_dropped, accepted) => {
    const chosen = accepted[0];
    if (!chosen) return;
    setReadError(null);
    try {
      const text = await chosen.slice(0, PREVIEW_BYTES).text();
      const parsed = previewCsv(text, 10);
      if (parsed.headers.length < 2) throw new Error("Could not find columns in this file.");
      const guessed = guessRoles(parsed.headers, parsed.rows);
      const dateHeader = Object.keys(guessed).find((header) => guessed[header] === "date");
      const dateIndex = parsed.headers.indexOf(dateHeader);
      setFile(chosen);
      setPreview(parsed);
      setRoles(guessed);
      setDateFormat(dateIndex >= 0 ? guessDateFormat(parsed.rows.map((row) => row[dateIndex])) : "dmy");
    } catch (error) {
      setReadError(error.message);
    }
  };

  // Each role can be given to one column only.
  const setRole = (header, role) => {
    setRoles((current) => {
      const next = { ...current };
      if (role !== "ignore") {
        Object.keys(next).forEach((key) => { if (next[key] === role) next[key] = "ignore"; });
      }
      next[header] = role;
      return next;
    });
  };

  const columnMap = useMemo(() => Object.fromEntries(
    Object.entries(roles).filter(([, role]) => role !== "ignore").map(([header, role]) => [role, header]),
  ), [roles]);
  const missing = REQUIRED_ROLES.filter((role) => !columnMap[role]);

  const dateExample = useMemo(() => {
    if (!preview || !columnMap.date) return null;
    const raw = preview.rows[0]?.[preview.headers.indexOf(columnMap.date)];
    const parsed = parseDate(raw, dateFormat);
    return { raw, parsed: parsed ? parsed.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "cannot read" };
  }, [preview, columnMap.date, dateFormat]);

  const submit = () => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("columnMap", JSON.stringify(columnMap));
    formData.append("delimiter", preview.delimiter);
    formData.append("dateFormat", dateFormat);
    formData.append("mode", mode);
    fetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
  };

  return (
    <Page title="Data" backAction={{ content: "Recommendations", url: "/app" }}>
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Order history from CSV</Text>
              <InlineStack gap="200">
                <Badge>{`${formatNumber(csvOrders)} CSV orders`}</Badge>
                <Badge tone={matched > 0 ? "success" : "attention"}>{`${matched}/${csvProducts} products matched`}</Badge>
              </InlineStack>
            </InlineStack>
            <Text as="p" tone="subdued">
              Upload past orders from any system. Then tell us what each column contains: the
              order ID and product code are required, the rest is optional.
            </Text>

            <DropZone accept=".csv,text/csv,text/plain" type="file" allowMultiple={false} onDrop={handleDrop}>
              {file ? (
                <Box padding="400">
                  <Text as="p" alignment="center">{`${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`}</Text>
                </Box>
              ) : (
                <DropZone.FileUpload actionTitle="Choose CSV file" actionHint="or drop it here" />
              )}
            </DropZone>
            {readError && <Banner tone="critical">{readError}</Banner>}

            {preview && (
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  {`Preview (first ${preview.rows.length} rows). Choose what each column is:`}
                </Text>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                    <thead>
                      <tr>
                        {preview.headers.map((header) => (
                          <th key={header} style={{ padding: 8, textAlign: "left", verticalAlign: "bottom", minWidth: 170 }}>
                            <BlockStack gap="100">
                              <Text as="span" fontWeight="semibold">{header || "(no name)"}</Text>
                              <Select
                                label={`Role of ${header}`}
                                labelHidden
                                options={ROLE_OPTIONS}
                                value={roles[header] ?? "ignore"}
                                onChange={(value) => setRole(header, value)}
                              />
                            </BlockStack>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} style={{ borderTop: "1px solid #e3e3e3" }}>
                          {preview.headers.map((header, index) => (
                            <td
                              key={header}
                              style={{ padding: 8, whiteSpace: "nowrap", opacity: roles[header] === "ignore" ? 0.45 : 1 }}
                            >
                              {row[index]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <InlineStack gap="400" blockAlign="end" wrap>
                  {columnMap.date && (
                    <Select
                      label="Date format"
                      options={DATE_FORMATS}
                      value={dateFormat}
                      onChange={setDateFormat}
                      helpText={dateExample ? `"${dateExample.raw}" is read as ${dateExample.parsed}` : undefined}
                    />
                  )}
                  <Select
                    label="Existing CSV orders"
                    options={[
                      { value: "replace", label: "Replace them with this file" },
                      { value: "append", label: "Keep them and add this file" },
                    ]}
                    value={mode}
                    onChange={setMode}
                  />
                  <Button variant="primary" onClick={submit} loading={importing} disabled={missing.length > 0}>
                    Import orders
                  </Button>
                </InlineStack>
                {missing.length > 0 && (
                  <Text as="p" tone="critical">
                    {`Choose a column for: ${missing.map((role) => ROLE_LABELS[role]).join(", ")}`}
                  </Text>
                )}
              </BlockStack>
            )}

            {result?.success && (
              <Banner tone="success" title="Import finished">
                <p>
                  {`${formatNumber(result.result.orderCount)} orders from ${formatNumber(result.result.rowCount)} rows ` +
                    `(${formatNumber(result.result.skippedRows)} rows skipped: returns, cancellations or missing values). `}
                  Next, match the CSV products to products in your shop.
                </p>
              </Banner>
            )}
            {result && !result.success && <Banner tone="critical" title="Import failed">{result.error}</Banner>}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Match CSV products to shop products</Text>
            <Text as="p" tone="subdued">
              Recommendations can only use CSV products that are linked to a product in this shop.
            </Text>
            <InlineStack>
              <Button disabled={csvProducts === 0} onClick={() => navigate("/app/data/match")}>
                Match products in shop
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Training</Text>
            {settings.lastTrainedAt && (
              <Text as="p" tone="subdued">
                {`Last trained ${formatDateTime(settings.lastTrainedAt)}` +
                  (settings.lastTrainSummary ? ` with ${settings.lastTrainSummary.strategy}, ${formatNumber(settings.lastTrainSummary.rules)} rules` : "") +
                  (settings.lastTrainSummary?.strategyError ? " (Python failed, the built-in Apriori was used)" : "")}
              </Text>
            )}
            <InlineStack gap="300" wrap>
              <Select label="Algorithm" options={STRATEGY_OPTIONS} value={strategy} onChange={setStrategy} />
              <Select label="Prioritise" options={RANK_OPTIONS} value={rankBy} onChange={setRankBy} />
              <Select label="Retrain automatically" options={SCHEDULE_OPTIONS} value={retrainSchedule} onChange={setRetrainSchedule} />
            </InlineStack>
            <Text as="p" tone="subdued">
              {"Old orders may not match current trends. Only orders inside this window are used when the model is trained" +
                (orderDates.min ? ` (stored orders range from ${orderDates.min} to ${orderDates.max}).` : ".")}
            </Text>
            <InlineStack gap="300" blockAlign="end" wrap>
              <Select label="Orders used" options={WINDOW_OPTIONS} value={trainWindow} onChange={setTrainWindow} />
              {trainWindow === "custom" && (
                <>
                  <TextField label="From" type="date" value={trainFrom} onChange={setTrainFrom} autoComplete="off" />
                  <TextField label="To" type="date" value={trainTo} onChange={setTrainTo} autoComplete="off" />
                </>
              )}
              <Button
                loading={settingsFetcher.state !== "idle"}
                onClick={() => settingsFetcher.submit(
                  { intent: "settings", window: trainWindow, from: trainFrom, to: trainTo, strategy, rankBy, retrainSchedule },
                  { method: "post" },
                )}
              >
                Save
              </Button>
            </InlineStack>
            {settingsFetcher.data?.success && <Text as="p" tone="success">Saved. Train the model again to apply it.</Text>}
          </BlockStack>
        </Card>

        {imports.length > 0 && (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Recent imports</Text>
              {imports.map((item) => (
                <InlineStack key={item.id} align="space-between">
                  <Text as="span">{item.fileName}</Text>
                  <Text as="span" tone="subdued">
                    {`${formatNumber(item.orderCount)} orders · ${item.mode} · ${formatDateTime(item.createdAt)}`}
                  </Text>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
