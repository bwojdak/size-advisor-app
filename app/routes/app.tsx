import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Outlet,
  isRouteErrorResponse,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider, Banner, BlockStack, Button, Card, Page, Text } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import plTranslations from "@shopify/polaris/locales/pl.json";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  I18nProvider,
  resolveLocale,
  shopifyLocaleFromRequest,
  translate,
} from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const settings = await db.shopSettings.findUnique({
    where: { shop: session.shop },
    select: { language: true },
  });

  // Shopify appends `?locale=` to every embedded-app load; that is our
  // "inherited" signal. ShopSettings.language overrides it when not "auto".
  const locale = resolveLocale(settings?.language, shopifyLocaleFromRequest(request));

  return { locale };
};

/** Cienki pasek postępu u góry — feedback przy przełączaniu zakładek i
 *  odświeżaniu danych (loadery RR blokują widok do czasu pobrania). */
function NavProgress() {
  const nav = useNavigation();
  const active = nav.state !== "idle";
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        insetInline: 0,
        top: 0,
        height: 3,
        zIndex: 520,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          height: "100%",
          width: active ? "92%" : "100%",
          background: "var(--p-color-bg-fill-brand, #2c2c2c)",
          opacity: active ? 1 : 0,
          transition: active
            ? "width 9s cubic-bezier(0.1, 0.7, 0.1, 1)"
            : "opacity 0.35s ease 0.15s, width 0.2s ease",
        }}
      />
    </div>
  );
}

export default function App() {
  const { locale } = useLoaderData<typeof loader>();

  return (
    <AppProvider i18n={locale === "pl" ? plTranslations : enTranslations}>
      <I18nProvider locale={locale}>
        <NavProgress />
        <NavMenu>
          <a href="/app" rel="home">
            {translate(locale, "nav.panel")}
          </a>
          <a href="/app/analytics">{translate(locale, "nav.analytics")}</a>
          <a href="/app/products">{translate(locale, "nav.products")}</a>
          <a href="/app/sizing-systems">
            {translate(locale, "nav.sizingSystems")}
          </a>
          <a href="/app/plans">{translate(locale, "nav.plans")}</a>
          <a href="/app/settings">{translate(locale, "nav.settings")}</a>
        </NavMenu>
        <Outlet />
      </I18nProvider>
    </AppProvider>
  );
}

export const headers: HeadersFunction = () => {
  return {};
};

// Bez tego nieobsłużony wyjątek w KTÓRYMKOLWIEK loaderze/akcji/renderze pod
// /app/* (błąd bazy, awaria zewnętrznego API, bug w komponencie) pokazywał
// gołą, niemarkową stronę błędu React Routera zamiast czegoś spójnego z
// resztą panelu — zły wygląd akurat na etapie publikacji w App Store. Musi
// działać SAMODZIELNIE (bez `useLoaderData` z tego route'a — loader mógł być
// właśnie tym, co rzuciło wyjątek) i nie ujawniać surowego komunikatu błędu
// merchantowi (może zawierać szczegóły wewnętrzne).
export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : null;
  if (process.env.NODE_ENV !== "production" || typeof window === "undefined") {
    console.error("[app] ErrorBoundary caught:", error);
  }

  return (
    <AppProvider i18n={enTranslations}>
      <Page title="Size Advisor">
        <Card>
          <BlockStack gap="400">
            <Banner tone="critical">
              <Text as="p">
                Coś poszło nie tak / Something went wrong
                {status ? ` (${status})` : ""}.
              </Text>
            </Banner>
            <Text as="p" tone="subdued">
              Spróbuj odświeżyć stronę. Jeśli problem się powtarza,
              skontaktuj się z pomocą techniczną.
              <br />
              Try refreshing the page. If this keeps happening, please
              contact support.
            </Text>
            <Button url="/app">Size Advisor</Button>
          </BlockStack>
        </Card>
      </Page>
    </AppProvider>
  );
}
