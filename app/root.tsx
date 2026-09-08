import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";
// Wstawiony na sztywno w <head> (nie przez route `links()`), żeby był w dokumencie
// od pierwszego bajtu i nie był rekoncyliowany przy nawigacji — inaczej Polaris CSS
// na ułamek sekundy znika przy przełączaniu zakładek.
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const loader = async () => {
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

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
        <link rel="stylesheet" href={polarisStyles} />
        <meta name="shopify-api-key" content={apiKey} />
        <script
          src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
          data-api-key={apiKey}
        ></script>
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
