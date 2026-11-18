// Admin UI language of a shop: the merchant's choice (ShopSettings.language), or with "auto"
// the locale Shopify Admin passes to the embedded app (?locale=vi, saved as adminLocale).

import prisma from "./db.server";
import { resolveLanguage } from "./i18n";

export async function getShopLanguage(shop, localeParam = null) {
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
    select: { language: true, adminLocale: true },
  });
  let adminLocale = settings?.adminLocale ?? null;
  if (localeParam && localeParam !== adminLocale) {
    adminLocale = localeParam;
    await prisma.shopSettings.upsert({
      where: { shop },
      update: { adminLocale },
      create: { shop, adminLocale },
    });
  }
  const setting = settings?.language ?? "auto";
  return { setting, lang: resolveLanguage(setting, adminLocale) };
}

export async function setShopLanguage(shop, language) {
  const value = ["auto", "en", "vi"].includes(language) ? language : "auto";
  await prisma.shopSettings.upsert({
    where: { shop },
    update: { language: value },
    create: { shop, language: value },
  });
  return value;
}
