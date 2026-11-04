// Formatting shared by server and browser renders. Locale and time zone are fixed so the
// server-rendered HTML matches what the browser renders during hydration; a mismatch makes
// React re-render the whole page (visible as a flash of unstyled content in development).

const numberFormat = new Intl.NumberFormat("en-US");
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export const formatNumber = (value) => numberFormat.format(Number(value ?? 0));

export const formatDateTime = (value) => (value ? `${dateTimeFormat.format(new Date(value))} UTC` : "");
