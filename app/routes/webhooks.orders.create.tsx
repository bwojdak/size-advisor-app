import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Zamyka pętlę pomiaru: gdy klient dodał do koszyka rozmiar z rekomendacji,
// pozycja koszyka dostaje ukrytą właściwość `_size_advisor` = id wpisu AdvisorLog.
// Ten webhook odczytuje ją z zamówienia i oznacza wpis jako zakupiony.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CREATE") {
    return new Response();
  }

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    return new Response();
  }

  const p = payload as {
    id?: number | string;
    total_price?: string | number;
    currency?: string;
    line_items?: unknown[];
  };
  const orderId = String(p.id ?? "");
  const orderTotal = Number(p.total_price);
  const orderCurrency =
    typeof p.currency === "string" ? p.currency : null;
  const lineItems = Array.isArray(p.line_items)
    ? (p.line_items as Array<{
        properties?: Array<{ name?: string; value?: string }> | null;
      }>)
    : [];

  const logIds = new Set<string>();
  for (const item of lineItems) {
    for (const prop of item.properties ?? []) {
      if (prop?.name === "_size_advisor" && typeof prop.value === "string" && prop.value) {
        logIds.add(prop.value);
      }
    }
  }

  if (logIds.size > 0) {
    const result = await db.advisorLog.updateMany({
      where: { id: { in: [...logIds] }, shopId: settings.id, purchased: false },
      data: {
        purchased: true,
        orderId,
        orderTotal: Number.isFinite(orderTotal) ? orderTotal : null,
        orderCurrency,
        purchasedAt: new Date(),
      },
    });
    console.log(
      `[orders/create] ${shop} zamówienie ${orderId}: oznaczono ${result.count} rekomendacji jako zakupione.`,
    );
  }

  return new Response();
};
