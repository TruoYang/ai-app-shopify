// Layout for the embedded admin app.
//
// AppProvider (Shopify) loads App Bridge with the app's API key: it adds the session token to
// every request the app makes, so navigating inside the app (useNavigate, fetchers) stays
// authenticated. Without it, in-app navigation is redirected to the login page.

import { Outlet, useLoaderData, useRouteError } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import translations from "@shopify/polaris/locales/en.json";
import "../styles.css";

import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={translations}>
        <ui-nav-menu>
          <a href="/app" rel="home">Recommendations</a>
          <a href="/app/rules">Rules</a>
          <a href="/app/data">Data</a>
        </ui-nav-menu>
        <Outlet />
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify's boundary handles expired sessions (re-authentication) and shows other errors.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
