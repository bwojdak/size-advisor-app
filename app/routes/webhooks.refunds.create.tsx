import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Zwrot / refund na zamówieniu. Jeśli zamówienie było przypisane do rekomendacji
// (webhook orders/create wpisał `orderId` na AdvisorLog), oznaczamy je jako
// zwrócone — do liczenia realnego wskaźnika zwrotów w Analityce.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  if (topic !== "REFUNDS_CREATE") {
    return new Response();
  }

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    return new Response();
  }

  const p = payload as {
    order_id?: number | string;
    refund_line_items?: Array<{
      line_item?: {
        properties?: Array<{ name?: string; value?: string }> | null;
      } | null;
    }> | null;
  };
  const orderId = String(p.order_id ?? "");
  if (!orderId) {
    return new Response();
  }

  // Dopasuj po KONKRETNEJ pozycji zwróconej, nie po całym zamówieniu — inaczej
  // częściowy zwrot innego produktu z tego samego zamówienia (albo zwrot samej
  // wysyłki) fałszywie oznaczał jako "zwróconą" TEŻ rekomendację, której zwrot
  // wcale nie dotyczył, zawyżając wskaźnik zwrotów w Analityce. Ten sam wzorzec
  // odczytu `_size_advisor` co w orders/create, tylko z `refund_line_items`.
  const refundLineItems = Array.isArray(p.refund_line_items)
    ? p.refund_line_items
    : null;
  let sawAnyProperties = false;
  const logIds = new Set<string>();
  for (const rli of refundLineItems ?? []) {
    const props = rli?.line_item?.properties;
    if (Array.isArray(props)) {
      sawAnyProperties = true;
      for (const prop of props) {
        if (prop?.name === "_size_advisor" && typeof prop.value === "string" && prop.value) {
          logIds.add(prop.value);
        }
      }
    }
  }

  // Trzy sytuacje:
  //  1. Payload ma `refund_line_items` z właściwościami pozycji → wierzymy
  //     dokładnemu dopasowaniu (nawet gdy wyszło 0 — ten zwrot po prostu nie
  //     dotyczył żadnej rekomendacji).
  //  2. `refund_line_items` w ogóle nie mają pola `properties` (starsza wersja
  //     API / inny kształt payloadu niż oczekiwany) → nie mamy jak dopasować
  //     precyzyjnie, bezpieczniejszy fallback to całe zamówienie (jak dawniej),
  //     żeby nie zgubić prawdziwego zwrotu przez nieznany kształt danych.
  const where = sawAnyProperties
    ? logIds.size > 0
      ? { shopId: settings.id, id: { in: [...logIds] }, orderId, purchased: true, returned: false }
      : null
    : { shopId: settings.id, orderId, purchased: true, returned: false };

  if (!where) {
    return new Response();
  }

  const result = await db.advisorLog.updateMany({
    where,
    data: { returned: true, returnedAt: new Date() },
  });

  if (result.count > 0) {
    console.log(
      `[refunds/create] ${shop} zamówienie ${orderId}: oznaczono ${result.count} rekomendacji jako zwrócone.`,
    );
  }

  return new Response();
};
