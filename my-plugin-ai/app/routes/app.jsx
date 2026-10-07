// Layout for app 

// app/routes/app.jsx
import { Outlet, useLoaderData, useRouteError, isRouteErrorResponse } from "react-router";
import { AppProvider as PolarisAppProvider, Frame } from "@shopify/polaris";
import translations from "@shopify/polaris/locales/en.json";
import "../styles.css";

import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const data = useLoaderData();

  return (
    <PolarisAppProvider i18n={translations}>
      <Outlet/>
    </PolarisAppProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  
  if (isRouteErrorResponse(error)) {
    return (
      <html>
        <body style={{ padding: 40 }}>
          <h1>{error.status} - {error.statusText}</h1>
          <p>{error.data}</p>
          <a href="/auth/login">Log in again</a>
        </body>
      </html>
    );
  }

  return (
    <html>
      <body style={{ padding: 40 }}>
        <h1>Application Error</h1>
        <pre>{error?.message || "Unknown error"}</pre>
        <a href="/auth/login">Log in again</a>
      </body>
    </html>
  );
}

export const headers = boundary.headers;
