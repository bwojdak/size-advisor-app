import { type LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated, BILLING_IS_TEST } from "../shopify.server";
import {
  PAID_PLANS,
  PLAN,
  PLAN_LIMITS,
  PLAN_PRICE,
  PLAN_PRICE_ANNUAL,
  TRIAL_DAYS,
} from "../lib/plans";
import db from "../db.server";
import { loadShopSettings } from "../lib/shop-settings.server";

const APP_URL_ENV = process.env.SHOPIFY_APP_URL || "";
const API_KEY = process.env.SHOPIFY_API_KEY || "";

// Resource route wołana `fetch`em z /app/plans.
// Biling wykonujemy przez `unauthenticated.admin(shop)` (surowy zapisany token
// offline — identycznie jak GraphiQL), bo `billing.request` na sesji z token
// exchange zwracało 403 na mutacjach subskrypcji.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request); // weryfikacja żądania
  const shop = session.shop;

  const url = new URL(request.url);
  const intent = url.searchParams.get("intent");

  // Po akceptacji Shopify przekierowuje na returnUrl. Deep-link do panelu admina
  // wraca prosto do osadzonej apki; fallback na URL aplikacji, gdy brak API key.
  const shopHandle = shop.replace(/\.myshopify\.com$/, "");
  const returnUrl = API_KEY
    ? `https://admin.shopify.com/store/${shopHandle}/apps/${API_KEY}/app/plans`
    : `${APP_URL_ENV || url.origin}/app/plans`;

  const { admin } = await unauthenticated.admin(shop);

  if (intent === "cancel") {
    const settings = await loadShopSettings(shop);
    const listResp = await admin.graphql(
      `#graphql
      { currentAppInstallation { activeSubscriptions { id } } }`,
    );
    const listBody = await listResp.json();
    const subs: Array<{ id: string }> =
      listBody?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    for (const sub of subs) {
      await admin.graphql(
        `#graphql
        mutation SizeAdvisorCancel($id: ID!) {
          appSubscriptionCancel(id: $id) { userErrors { message } }
        }`,
        { variables: { id: sub.id } },
      );
    }
    await db.shopSettings.update({
      where: { id: settings.id },
      data: {
        plan: PLAN.FREE,
        monthlyLimit: PLAN_LIMITS[PLAN.FREE],
        subscriptionId: null,
      },
    });
    return Response.json({ ok: true, plan: PLAN.FREE });
  }

  const plan = url.searchParams.get("plan");
  if (!plan || !(PAID_PLANS as readonly string[]).includes(plan)) {
    return Response.json({ ok: false, error: "Unknown billing intent" }, { status: 400 });
  }

  const annual = url.searchParams.get("interval") === "annual";
  const amount = annual ? PLAN_PRICE_ANNUAL[plan] : PLAN_PRICE[plan];
  const interval = annual ? "ANNUAL" : "EVERY_30_DAYS";

  const resp = await admin.graphql(
    `#graphql
    mutation SizeAdvisorSubscribe(
      $name: String!
      $returnUrl: URL!
      $trialDays: Int
      $test: Boolean
      $lineItems: [AppSubscriptionLineItemInput!]!
    ) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        trialDays: $trialDays
        test: $test
        lineItems: $lineItems
      ) {
        confirmationUrl
        userErrors { field message }
      }
    }`,
    {
      variables: {
        name: plan,
        returnUrl,
        trialDays: TRIAL_DAYS,
        test: BILLING_IS_TEST,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount, currencyCode: "USD" },
                interval,
              },
            },
          },
        ],
      },
    },
  );

  const body = (await resp.json()) as {
    data?: { appSubscriptionCreate?: { confirmationUrl?: string; userErrors?: Array<{ field?: string; message?: string }> } };
    errors?: unknown;
  };
  const result = body?.data?.appSubscriptionCreate;
  const userErrors: Array<{ message?: string }> = result?.userErrors ?? [];

  if (userErrors.length || !result?.confirmationUrl) {
    console.error("[billing] appSubscriptionCreate failed", {
      plan,
      returnUrl,
      test: BILLING_IS_TEST,
      userErrors,
      graphqlErrors: body?.errors,
    });
    // Szczegóły trafiają do logów serwera (wyżej); klientowi tylko komunikat.
    return Response.json(
      { error: userErrors[0]?.message || "Nie udało się utworzyć subskrypcji." },
      { status: 500 },
    );
  }

  return Response.json({ confirmationUrl: result.confirmationUrl });
};
