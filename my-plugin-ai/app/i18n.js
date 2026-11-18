// Admin UI translations (English / Vietnamese).
//
// English text is the key: t("Train AI model") returns the English text as is, or its
// Vietnamese translation from the page's dictionary (then COMMON_VI). Placeholders such as
// {count} are filled from the second argument: t("{count} rules", { count: 5 }).
// Missing translations fall back to English, so a page never shows an empty label.

import { createContext, useCallback, useContext } from "react";

export const LANGUAGES = ["en", "vi"];
export const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto (Shopify admin language) / Tự động" },
  { value: "en", label: "English" },
  { value: "vi", label: "Tiếng Việt" },
];

// Shared words used on several pages.
export const COMMON_VI = {
  Recommendations: "Gợi ý",
  Rules: "Luật",
  Data: "Dữ liệu",
  Insights: "Hiệu quả",
  Language: "Ngôn ngữ",
  Save: "Lưu",
  Cancel: "Hủy",
  Delete: "Xóa",
  Search: "Tìm kiếm",
  All: "Tất cả",
  Active: "Đang bật",
  Disabled: "Đã tắt",
  Back: "Quay lại",
  Previous: "Trước",
  Next: "Sau",
};

export const LanguageContext = createContext("en");

const fill = (text, vars) =>
  vars ? String(text).replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match)) : text;

export function translate(lang, dict, text, vars) {
  const out = lang === "vi" ? (dict?.[text] ?? COMMON_VI[text] ?? text) : text;
  return fill(out, vars);
}

// "auto" follows the Shopify admin language; anything not Vietnamese is English.
export function resolveLanguage(setting, adminLocale) {
  if (LANGUAGES.includes(setting)) return setting;
  return String(adminLocale ?? "").toLowerCase().startsWith("vi") ? "vi" : "en";
}

export const useLanguage = () => useContext(LanguageContext);

// t() for a page: const t = useT(VI) with VI = { "English text": "Tiếng Việt", ... }.
export function useT(dict) {
  const lang = useContext(LanguageContext);
  return useCallback((text, vars) => translate(lang, dict, text, vars), [lang, dict]);
}
