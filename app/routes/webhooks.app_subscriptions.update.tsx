import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { PLAN, PLAN_LIMITS } from "../lib/plans";
import db from "../db.server";

// Utrzymuje `ShopSettings.plan` / `monthlyLimit` w zgodzie z subskrypcją Shopify:
// aktywacja → plan płatny, każdy inny stan (CANCELLED / EXPIRED / DECLINED /
// FROZEN) → powrót na Free.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  if (topic !== "APP_SUBSCRIPTIONS_UPDATE") {
    return new Response();
  }

  const sub = (payload as {
    app_subscription?: { admin_graphql_api_id?: string; name?: string; status?: string };
  }).app_subscription;

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    return new Response();
  }

  const status = String(sub?.status || "").toUpperCase();
  const name = sub?.name;

  if (status === "ACTIVE" && name && PLAN_LIMITS[name]) {
    await db.shopSettings.update({
      where: { id: settings.id },
      data: {
        plan: name,
        monthlyLimit: PLAN_LIMITS[name],
        subscriptionId: sub?.admin_graphql_api_id ?? null,
      },
    });
    console.log(`[app_subscriptions/update] ${shop}: plan → ${name}`);
  } else {
    await db.shopSettings.update({
      where: { id: settings.id },
      data: {
        plan: PLAN.FREE,
        monthlyLimit: PLAN_LIMITS[PLAN.FREE],
        subscriptionId: null,
      },
    });
    console.log(`[app_subscriptions/update] ${shop}: subskrypcja ${status || "?"} → Free`);
  }

  return new Response();
};
