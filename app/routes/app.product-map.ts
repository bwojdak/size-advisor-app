import { type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { requestT } from "../lib/i18n";
import { loadShopSettings } from "../lib/shop-settings.server";
import { PLAN, planCaps, UNLIMITED } from "../lib/plans";

// Mapowanie / odmapowanie produktów na współdzielony system rozmiarów.
// Zmapowany produkt to „skonfigurowany produkt" — dostaje wiersz ProductRule
// (bez własnej tabeli) i wlicza się do limitu planu jak zwykła reguła.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const t = requestT(request);
  const settings = await loadShopSettings(session.shop);
  const caps = planCaps(settings.plan);

  const body = (await request.json()) as {
    productIds?: unknown;
    products?: unknown; // [{ id, title }]
    sizingSystemId?: string | null;
  };

  const rawProducts = Array.isArray(body.products) ? body.products : [];
  const titleById = new Map<string, string>();
  for (const p of rawProducts) {
    if (p && typeof p === "object") {
      const id = String((p as { id?: unknown }).id ?? "").replace(/\D/g, "");
      const title = String((p as { title?: unknown }).title ?? "").slice(0, 255);
      if (id) titleById.set(id, title);
    }
  }
  const ids = Array.from(
    new Set(
      (Array.isArray(body.productIds) ? body.productIds : [...titleById.keys()])
        .map((v) => String(v).replace(/\D/g, ""))
        .filter(Boolean),
    ),
  ).slice(0, 500);

  if (ids.length === 0) {
    return Response.json({ error: t("error.noProduct") }, { status: 400 });
  }

  const systemId = body.sizingSystemId ? String(body.sizingSystemId) : null;

  if (systemId) {
    const system = await db.sizingSystem.findFirst({
      where: { id: systemId, shopId: settings.id },
      select: { id: true },
    });
    if (!system) {
      return Response.json({ error: t("error.status", { status: 404 }) }, { status: 404 });
    }

    const existing = await db.productRule.findMany({
      where: { shopId: settings.id, productId: { in: ids } },
      select: { productId: true },
    });
    const have = new Set(existing.map((r) => r.productId));
    const newCount = ids.filter((id) => !have.has(id)).length;

    if (caps.productRuleLimit < UNLIMITED) {
      const total = await db.productRule.count({ where: { shopId: settings.id } });
      if (total + newCount > caps.productRuleLimit) {
        return Response.json(
          {
            error:
              caps.productRuleLimit === 0
                ? t("gate.locked_from", { plan: PLAN.STARTER })
                : t("gate.products_limit_reached", {
                    n: caps.productRuleLimit,
                    plan: settings.plan,
                  }),
          },
          { status: 403 },
        );
      }
    }

    for (const id of ids) {
      await db.productRule.upsert({
        where: { shopId_productId: { shopId: settings.id, productId: id } },
        update: { sizingSystemId: systemId },
        create: {
          shopId: settings.id,
          productId: id,
          productTitle: titleById.get(id) || null,
          sizingSystemId: systemId,
        },
      });
    }
    // Konfiguracja zastępuje leniwy cache analizy dla tych produktów.
    await db.productAnalysis.deleteMany({
      where: { shopId: settings.id, productId: { in: ids } },
    });
    return Response.json({ success: true, mapped: ids.length });
  }

  // Odmapowanie: reguła bez własnej tabeli znika, z tabelą — tylko zerujemy link.
  const rules = await db.productRule.findMany({
    where: { shopId: settings.id, productId: { in: ids } },
  });
  for (const r of rules) {
    const hasOwnChart =
      Boolean(r.parsedSizeData?.trim()) || Boolean(r.sizeChartImage);
    if (hasOwnChart) {
      await db.productRule.update({
        where: { id: r.id },
        data: { sizingSystemId: null },
      });
    } else {
      await db.productRule.delete({ where: { id: r.id } });
    }
  }
  return Response.json({ success: true, unmapped: ids.length });
};
