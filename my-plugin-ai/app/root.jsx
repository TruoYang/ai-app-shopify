import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
// Polaris is both imported and linked. The link puts the styles in the server-rendered HTML;
// the import keeps a copy injected by JavaScript in development, so the page does not flash
// unstyled while React re-creates the <link> during hydration.
import "@shopify/polaris/build/esm/styles.css";
import polarisStylesUrl from "@shopify/polaris/build/esm/styles.css?url";
import stylesheetUrl from "./styles.css?url";

export const links = () => [
  { rel: "stylesheet", href: polarisStylesUrl },
  { rel: "stylesheet", href: stylesheetUrl },
];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
