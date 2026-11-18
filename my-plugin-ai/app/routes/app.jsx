// Layout for the embedded admin app.
//
// AppProvider (Shopify) loads App Bridge with the app's API key: it adds the session token to
// every request the app makes, so navigating inside the app (useNavigate, fetchers) stays
// authenticated. Without it, in-app navigation is redirected to the login page.
//
// The admin language (English / Vietnamese) comes from the shop's setting, or with "auto" from
// the locale Shopify Admin passes on load. LanguageContext gives it to every page (useT).

import { Outlet, useLoaderData, useRouteError } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import viTranslations from "@shopify/polaris/locales/vi.json";
import "../styles.css";

import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getShopLanguage } from "../language.server";
import { LanguageContext, translate } from "../i18n";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const locale = new URL(request.url).searchParams.get("locale");
  const { lang, setting } = await getShopLanguage(session.shop, locale);
  // eslint-disable-next-line no-undef -- server-only loader
  return { apiKey: process.env.SHOPIFY_API_KEY || "", lang, languageSetting: setting };
};

export default function App() {
  const { apiKey, lang } = useLoaderData();
  const t = (text) => translate(lang, null, text);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={lang === "vi" ? viTranslations : enTranslations}>
        <LanguageContext.Provider value={lang}>
          <ui-nav-menu>
            <a href="/app" rel="home">{t("Recommendations")}</a>
            <a href="/app/rules">{t("Rules")}</a>
            <a href="/app/data">{t("Data")}</a>
            <a href="/app/insights">{t("Insights")}</a>
          </ui-nav-menu>
          <Outlet />
        </LanguageContext.Provider>
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify's boundary handles expired sessions (re-authentication) and shows other errors.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
